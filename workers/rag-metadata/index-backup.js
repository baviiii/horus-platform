// RAG Metadata Function - Azure Functions Version
// Ported from Supabase Edge Functions (Deno) to Azure Functions (Node.js)
// Provides document statistics, counts, and metadata without full content
// Powers dashboards and resource listings

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-functions-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// ENTERPRISE: Rate limiting for Azure Search
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // 100ms between requests (10 req/sec max)

// ENTERPRISE: Retry with exponential backoff for throttling
async function fetchWithRetry(url, options, retryCount = 0, maxRetries = 3) {
  // Rate limiting: wait if needed
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();

  try {
    const response = await fetch(url, options);

    // Check for rate limiting (503 or 429)
    if ((response.status === 503 || response.status === 429) && retryCount < maxRetries) {
      const retryAfter = response.headers.get('Retry-After');
      const delay = retryAfter 
        ? parseInt(retryAfter) * 1000 
        : Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s
      
      console.warn(`Azure Search throttled (${response.status}), retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retryCount + 1, maxRetries);
    }

    return response;
  } catch (error) {
    if (retryCount < maxRetries) {
      const delay = Math.pow(2, retryCount) * 1000;
      console.warn(`Request failed, retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retryCount + 1, maxRetries);
    }
    throw error;
  }
}

async function getStats(endpoint, key, indexName, filters) {
  // Build filter expression
  let filterExpr = "";
  const filterParts = [];

  if (filters?.category) {
    filterParts.push(`category eq '${filters.category}'`);
  }
  if (filters?.sector) {
    filterParts.push(`sector eq '${filters.sector}'`);
  }
  if (filters?.documentType && filters.documentType !== 'all') {
    filterParts.push(`documentType eq '${filters.documentType}'`);
  }

  if (filterParts.length > 0) {
    filterExpr = filterParts.join(' and ');
  }

  // OPTIMIZED: Single call to get stats - estimate document count from chunk count
  const searchBody = {
    search: '*',
    queryType: 'simple',
    top: 0, // We only want count and facets
    facets: [
      'category,count:100',
      'sector,count:100',
      'documentType,count:10',
    ],
  };

  if (filterExpr) {
    searchBody.filter = filterExpr;
  }

  let response;
  try {
    const statsUrl = `${endpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01&$count=true`;
    
    response = await fetchWithRetry(statsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': key,
      },
      body: JSON.stringify(searchBody),
    });
  } catch (fetchError) {
    console.error('Fetch error getting stats:', fetchError);
    throw new Error(`Failed to connect to Azure Search: ${fetchError instanceof Error ? fetchError.message : 'Network error'}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Azure Search error response:', response.status, errorText);
    throw new Error(`Azure Search API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const totalChunks = data['@odata.count'] || 0;
  
  // OPTIMIZED: Estimate document count from chunk count (much faster than querying all documents)
  // Average ~10 chunks per document based on typical document structure
  const estimatedDocCount = Math.floor(totalChunks / 10);

  return {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      totalDocuments: estimatedDocCount,
      totalChunks: totalChunks,
      facets: data['@search.facets'] || {},
    }),
  };
}

async function getCategoryStats(endpoint, key, indexName) {
  try {
    const response = await fetchWithRetry(
      `${endpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': key,
        },
        body: JSON.stringify({
          search: '*',
          queryType: 'simple',
          top: 0,
          facets: ['category,count:100', 'sector,count:100'],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Azure Search error in getCategoryStats:', response.status, errorText);
      throw new Error(`Azure Search API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const facets = data['@search.facets'] || {};

    // OPTIMIZED: Use facet counts directly instead of making separate queries
    const categoryStats = [];
    if (facets.category) {
      for (const facet of facets.category) {
        categoryStats.push({
          category: facet.value,
          count: facet.count, // Use facet count as approximation
          documentIds: [], // Empty to save time - can be populated on demand
        });
      }
    }

    return {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: categoryStats,
        sectors: facets.sector || [],
      }),
    };
  } catch (error) {
    console.error('Error in getCategoryStats:', error);
    throw error;
  }
}

async function getDocuments(endpoint, key, indexName, filters, top) {
  let filterExpr = "";
  const filterParts = [];

  if (filters?.category) {
    filterParts.push(`category eq '${filters.category}'`);
  }
  if (filters?.sector) {
    filterParts.push(`sector eq '${filters.sector}'`);
  }
  if (filters?.documentType && filters.documentType !== 'all') {
    filterParts.push(`documentType eq '${filters.documentType}'`);
  }
  if (filters?.tags && filters.tags.length > 0) {
    const tagFilters = filters.tags.map(tag => `tags/any(t: t eq '${tag}')`).join(' or ');
    filterParts.push(`(${tagFilters})`);
  }

  if (filterParts.length > 0) {
    filterExpr = filterParts.join(' and ');
  }

  // OPTIMIZED: Get unique documents efficiently
  const maxResults = Math.min(top * 3, 1000); // Get 3x requested to account for duplicates
  
  const searchBody = {
    search: '*',
    queryType: 'simple',
    top: maxResults,
    select: 'documentId,title,category,sector,documentType,tags,url',
    orderby: 'documentId',
  };

  if (filterExpr) {
    searchBody.filter = filterExpr;
  }

  let response;
  try {
    response = await fetchWithRetry(
      `${endpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': key,
        },
        body: JSON.stringify(searchBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Azure Search error in getDocuments:', response.status, errorText);
      throw new Error(`Azure Search API error (${response.status}): ${errorText}`);
    }
  } catch (fetchError) {
    console.error('Fetch error in getDocuments:', fetchError);
    throw new Error(`Failed to connect to Azure Search: ${fetchError instanceof Error ? fetchError.message : 'Network error'}`);
  }

  const data = await response.json();
  
  // Deduplicate by documentId and get metadata
  const documentMap = new Map();
  
  for (const hit of data.value || []) {
    if (!documentMap.has(hit.documentId)) {
      documentMap.set(hit.documentId, {
        documentId: hit.documentId,
        title: hit.title || 'Untitled',
        category: hit.category,
        sector: hit.sector,
        documentType: hit.documentType || 'pdf',
        tags: hit.tags || [],
        url: hit.url,
      });
    }
    
    // Stop if we have enough unique documents
    if (documentMap.size >= top) {
      break;
    }
  }

  const documents = Array.from(documentMap.values()).slice(0, top);

  return {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documents,
      total: documentMap.size,
    }),
  };
}

async function searchDocuments(endpoint, key, indexName, query, filters, top) {
  let filterExpr = "";
  const filterParts = [];

  if (filters?.category) {
    filterParts.push(`category eq '${filters.category}'`);
  }
  if (filters?.sector) {
    filterParts.push(`sector eq '${filters.sector}'`);
  }
  if (filters?.documentType && filters.documentType !== 'all') {
    filterParts.push(`documentType eq '${filters.documentType}'`);
  }

  if (filterParts.length > 0) {
    filterExpr = filterParts.join(' and ');
  }

  const searchBody = {
    search: query,
    queryType: 'semantic',
    semanticConfiguration: 'default',
    top: top,
    select: 'documentId,title,category,sector,documentType,tags,url,pageNumber',
  };

  if (filterExpr) {
    searchBody.filter = filterExpr;
  }

  const response = await fetchWithRetry(
    `${endpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': key,
      },
      body: JSON.stringify(searchBody),
    }
  );

  if (!response.ok) {
    throw new Error('Search failed');
  }

  const data = await response.json();
  
  // Deduplicate and format results
  const documentMap = new Map();
  
  for (const hit of data.value || []) {
    const key = hit.documentId;
    if (!documentMap.has(key)) {
      documentMap.set(key, {
        documentId: hit.documentId,
        title: hit.title || 'Untitled',
        category: hit.category,
        sector: hit.sector,
        documentType: hit.documentType || 'pdf',
        tags: hit.tags || [],
        url: hit.url,
        score: hit['@search.score'] || 0,
        pageNumber: hit.pageNumber,
      });
    } else {
      // Update score if this hit has a higher score
      const existing = documentMap.get(key);
      if ((hit['@search.score'] || 0) > existing.score) {
        existing.score = hit['@search.score'] || 0;
        existing.pageNumber = hit.pageNumber;
      }
    }
  }

  const results = Array.from(documentMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, top);

  return {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      results,
      total: results.length,
    }),
  };
}

module.exports = async function (context, req) {
  // Set default CORS headers for all responses
  const defaultHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-functions-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 200,
      headers: defaultHeaders,
      body: '',
    };
    return;
  }

  // Log request for debugging
  context.log('Request received:', {
    method: req.method,
    url: req.url,
    hasBody: !!req.body,
  });

  try {
    // Parse request body safely
    let request = {};
    try {
      if (typeof req.body === 'string') {
        request = JSON.parse(req.body);
      } else if (req.body) {
        request = req.body;
      }
    } catch (parseError) {
      context.res = {
        status: 400,
        headers: {
          ...defaultHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          error: 'Invalid request body',
          data: null,
        }),
      };
      return;
    }

    const { type, filters = {}, query, top = 100 } = request;

    if (!type) {
      context.res = {
        status: 400,
        headers: {
          ...defaultHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          error: 'Type is required',
          data: null,
        }),
      };
      return;
    }

    const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const searchKey = process.env.AZURE_SEARCH_KEY;
    const searchIndex = process.env.AZURE_SEARCH_INDEX || 'sa-gov-documents';

    if (!searchEndpoint || !searchKey) {
      throw new Error('Azure Search credentials not configured');
    }

    let result;
    switch (type) {
      case 'stats':
        result = await getStats(searchEndpoint, searchKey, searchIndex, filters);
        break;
      
      case 'categories':
        result = await getCategoryStats(searchEndpoint, searchKey, searchIndex);
        break;
      
      case 'documents':
        result = await getDocuments(searchEndpoint, searchKey, searchIndex, filters, top);
        break;
      
      case 'search':
        if (!query) {
          throw new Error('Query is required for search type');
        }
        result = await searchDocuments(searchEndpoint, searchKey, searchIndex, query, filters, top);
        break;
      
      default:
        throw new Error(`Unknown type: ${type}`);
    }

    // Ensure CORS headers are always included and response is properly formatted
    // result should have: { status, headers, body }
    const responseHeaders = {
      ...defaultHeaders,
      'Content-Type': 'application/json',
    };
    
    // Merge any additional headers from result
    if (result.headers) {
      Object.assign(responseHeaders, result.headers);
    }
    
    context.res = {
      status: result.status || 200,
      headers: responseHeaders,
      body: result.body || JSON.stringify(result),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // Log full error for debugging
    context.log('ERROR - Metadata Error:', errorMessage);
    if (errorStack) {
      context.log('ERROR - Stack:', errorStack);
    }
    
    context.res = {
      status: 500,
      headers: {
        ...defaultHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        error: errorMessage,
        data: null,
      }),
    };
  }
};

