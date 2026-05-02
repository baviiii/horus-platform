const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-functions-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 300;

// ============================================================================
// EVIDENCE CHAIN ENFORCEMENT
// Validates citations and calculates confidence scores for government-grade trust
// ============================================================================

/**
 * Validates that citations in the AI response map to actual sources
 * @param {string} answer - The AI-generated response
 * @param {Array} sources - Array of source documents
 * @returns {Object} Citation validation results
 */
function validateCitations(answer, sources) {
  // Find all [Source X] references in the answer
  const citationPattern = /\[Source\s*(\d+)\]/gi;
  const matches = [...answer.matchAll(citationPattern)];
  
  const citedSourceIds = new Set();
  const invalidCitations = [];
  const validCitations = [];
  
  for (const match of matches) {
    const sourceNum = parseInt(match[1], 10);
    if (sourceNum >= 1 && sourceNum <= sources.length) {
      citedSourceIds.add(sourceNum);
      validCitations.push({
        reference: match[0],
        sourceIndex: sourceNum - 1,
        sourceTitle: sources[sourceNum - 1]?.title || 'Unknown',
        documentId: sources[sourceNum - 1]?.documentId || 'Unknown'
      });
    } else {
      invalidCitations.push({
        reference: match[0],
        reason: sourceNum > sources.length ? 'Source index out of range' : 'Invalid source number'
      });
    }
  }
  
  // Count sentences/claims to estimate citation coverage
  const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const sentencesWithCitations = sentences.filter(s => citationPattern.test(s)).length;
  const citationCoverage = sentences.length > 0 
    ? Math.round((sentencesWithCitations / sentences.length) * 100) 
    : 0;
  
  // Identify uncited claims (sentences without citations that make factual claims)
  const factualIndicators = /\b(is|are|was|were|will|has|have|shows|indicates|reveals|confirms|according to|data shows|statistics|percent|%|\$|million|billion)\b/i;
  const uncitedClaims = sentences
    .filter(s => !citationPattern.test(s) && factualIndicators.test(s))
    .map(s => s.trim().substring(0, 100) + (s.length > 100 ? '...' : ''));
  
  return {
    totalCitations: matches.length,
    uniqueSourcesCited: citedSourceIds.size,
    totalSourcesAvailable: sources.length,
    validCitations,
    invalidCitations,
    citationCoverage, // Percentage of sentences with citations
    uncitedClaims: uncitedClaims.slice(0, 5), // First 5 uncited factual claims
    allSourcesCited: citedSourceIds.size === sources.length && sources.length > 0
  };
}

/**
 * Calculates evidence-based confidence score for the response
 * @param {Object} citationValidation - Results from validateCitations
 * @param {Array} sources - Source documents with scores
 * @param {string} query - Original query
 * @returns {Object} Confidence assessment
 */
// ============================================================================
// TEMPORAL AWARENESS
// Policy version tracking and temporal status calculation
// ============================================================================

/**
 * Calculate temporal status for a document
 * Determines if document is current, superseded, expired, or historical
 */
function calculateTemporalStatus(document) {
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Check if superseded
  if (document.supersededBy) {
    return {
      status: 'superseded',
      description: `Replaced by ${document.supersededBy}`,
      isCurrentVersion: false,
      recommendAction: 'Use newer version'
    };
  }
  
  // Check if expired
  if (document.expiryDate) {
    const expiryDate = new Date(document.expiryDate);
    if (expiryDate < now) {
      return {
        status: 'expired',
        description: `Expired on ${document.expiryDate}`,
        isCurrentVersion: false,
        recommendAction: 'Check for updated policy'
      };
    }
  }
  
  // Check effective date (not yet effective)
  if (document.effectiveDate) {
    const effectiveDate = new Date(document.effectiveDate);
    if (effectiveDate > now) {
      return {
        status: 'pending',
        description: `Takes effect on ${document.effectiveDate}`,
        isCurrentVersion: false,
        recommendAction: 'Note future effective date'
      };
    }
  }
  
  // Check publication year for freshness
  if (document.publicationYear) {
    const age = currentYear - document.publicationYear;
    if (age > 5) {
      return {
        status: 'historical',
        description: `Published ${age} years ago (${document.publicationYear})`,
        isCurrentVersion: true,
        recommendAction: 'Verify information is still current',
        ageYears: age
      };
    }
    if (age > 2) {
      return {
        status: 'aging',
        description: `Published ${age} years ago (${document.publicationYear})`,
        isCurrentVersion: true,
        recommendAction: 'May have updates available',
        ageYears: age
      };
    }
  }
  
  // Check if this is an amendment
  if (document.amendmentOf) {
    return {
      status: 'amendment',
      description: `Amendment to ${document.amendmentOf}`,
      isCurrentVersion: true,
      recommendAction: 'Read with original document'
    };
  }
  
  // Default to current
  return {
    status: 'current',
    description: 'Current version',
    isCurrentVersion: true,
    recommendAction: null,
    ageYears: document.publicationYear ? currentYear - document.publicationYear : null
  };
}

/**
 * Add temporal metadata summary to response
 */
function calculateTemporalSummary(sources) {
  const statusCounts = {
    current: 0,
    superseded: 0,
    expired: 0,
    historical: 0,
    aging: 0,
    pending: 0,
    amendment: 0
  };
  
  const yearDistribution = {};
  let oldestYear = null;
  let newestYear = null;
  
  for (const source of sources) {
    // Count statuses
    const status = source.temporalStatus?.status || 'current';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    
    // Track year distribution
    if (source.publicationYear) {
      yearDistribution[source.publicationYear] = (yearDistribution[source.publicationYear] || 0) + 1;
      if (!oldestYear || source.publicationYear < oldestYear) oldestYear = source.publicationYear;
      if (!newestYear || source.publicationYear > newestYear) newestYear = source.publicationYear;
    }
  }
  
  // Calculate temporal warnings
  const warnings = [];
  if (statusCounts.superseded > 0) {
    warnings.push(`${statusCounts.superseded} source(s) have been superseded - newer versions may exist`);
  }
  if (statusCounts.expired > 0) {
    warnings.push(`${statusCounts.expired} source(s) have expired - information may be outdated`);
  }
  if (statusCounts.historical > 0) {
    warnings.push(`${statusCounts.historical} source(s) are over 5 years old - verify information is current`);
  }
  
  return {
    statusCounts,
    yearDistribution,
    dateRange: oldestYear && newestYear ? { oldest: oldestYear, newest: newestYear } : null,
    warnings,
    hasFreshnessIssues: statusCounts.superseded > 0 || statusCounts.expired > 0 || statusCounts.historical > 0
  };
}

function calculateEvidenceScore(citationValidation, sources, query) {
  // Factor 1: Citation coverage (0-40 points)
  const coverageScore = Math.min(40, citationValidation.citationCoverage * 0.4);
  
  // Factor 2: Source relevance (0-30 points) - based on search scores
  const avgSourceScore = sources.length > 0 
    ? sources.reduce((sum, s) => sum + (s.score || 0), 0) / sources.length 
    : 0;
  // Azure Search semantic scores are 0-1 (cosine similarity), normalize to 0-100 first
  const normalizedScore = avgSourceScore <= 1 ? avgSourceScore * 100 : avgSourceScore;
  const relevanceScore = Math.min(30, normalizedScore * 0.3);
  
  // Factor 3: Citation validity (0-20 points)
  const validityRatio = citationValidation.totalCitations > 0
    ? citationValidation.validCitations.length / citationValidation.totalCitations
    : 0;
  const validityScore = validityRatio * 20;
  
  // Factor 4: Source diversity (0-10 points) - using multiple sources is better
  const diversityScore = Math.min(10, sources.length * 1.5); // Use total sources, not just cited
  
  // Calculate total score
  const totalScore = Math.round(coverageScore + relevanceScore + validityScore + diversityScore);
  
  // Determine confidence level - primarily based on source relevance and count
  // (AI may not always use [Source X] format, so don't penalise heavily for that)
  let confidenceLevel;
  let confidenceDescription;
  
  const hasGoodSources = sources.length >= 5 && normalizedScore >= 50;
  const hasManySources = sources.length >= 8;
  
  if ((totalScore >= 60 || hasGoodSources) && citationValidation.invalidCitations.length === 0) {
    confidenceLevel = 'high';
    confidenceDescription = 'Supported by multiple authoritative sources';
  } else if (totalScore >= 30 || hasManySources) {
    confidenceLevel = 'medium';
    confidenceDescription = 'Based on available government documents';
  } else {
    confidenceLevel = 'low';
    confidenceDescription = 'Limited source coverage for this query';
  }
  
  // Build warnings for weak evidence
  const warnings = [];
  if (citationValidation.invalidCitations.length > 0) {
    warnings.push(`${citationValidation.invalidCitations.length} invalid citation(s) detected`);
  }
  if (citationValidation.uncitedClaims.length > 3) {
    warnings.push(`${citationValidation.uncitedClaims.length} claims lack citations`);
  }
  if (citationValidation.citationCoverage < 50) {
    warnings.push('Low citation coverage - many claims are unsupported');
  }
  if (sources.length === 0) {
    warnings.push('No source documents found');
  }
  
  return {
    score: totalScore,
    maxScore: 100,
    level: confidenceLevel,
    description: confidenceDescription,
    breakdown: {
      citationCoverage: Math.round(coverageScore),
      sourceRelevance: Math.round(relevanceScore),
      citationValidity: Math.round(validityScore),
      sourceDiversity: Math.round(diversityScore)
    },
    warnings,
    isReliable: confidenceLevel !== 'low' && warnings.length === 0
  };
}

async function fetchWithRetry(url, options, retryCount = 0, maxRetries = 5) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();

  try {
    const response = await fetch(url, options);

    if ((response.status === 503 || response.status === 429) && retryCount < maxRetries) {
      const retryAfter = response.headers.get('Retry-After');
      const baseDelay = response.status === 503 ? 2000 : 1000;
      const delay = retryAfter 
        ? Math.max(parseInt(retryAfter) * 1000, baseDelay)
        : baseDelay * Math.pow(2, retryCount);
      
      console.warn(`Azure Search throttled (${response.status}), retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retryCount + 1, maxRetries);
    }

    if (response.status === 503 || response.status === 429) {
      return response;
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
    search: '*',
    queryType: 'simple',
    top: 0,
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

    const categoryStats = [];
    if (facets.category) {
      for (const facet of facets.category) {
        categoryStats.push({
          category: facet.value,
          count: facet.count,
          documentIds: [],
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
  const maxResults = Math.min(top * 3, 1000);
  
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

// Full semantic search with embedding + hybrid search + AI response
async function semanticSearchWithAI(endpoint, key, indexName, openAIEndpoint, openAIKey, query, filters, options = {}) {
  const topK = options.topK || 30;
  const embeddingDeployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-large';
  const chatDeployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini';

  // Step 1: Generate query embedding
  const embeddingResponse = await fetch(
    `${openAIEndpoint}/openai/deployments/${embeddingDeployment}/embeddings?api-version=2024-02-15-preview`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': openAIKey,
      },
      body: JSON.stringify({
        input: query.substring(0, 8000),
        model: embeddingDeployment,
      }),
    }
  );

  if (!embeddingResponse.ok) {
    const error = await embeddingResponse.text();
    throw new Error(`Embedding generation failed: ${error}`);
  }

  const embeddingData = await embeddingResponse.json();
  const queryEmbedding = embeddingData.data[0].embedding;

  // Step 2: Build filter expression with TEMPORAL AWARENESS
  let filterExpr = "";
  const filterParts = [];
  if (filters?.category) filterParts.push(`category eq '${filters.category}'`);
  if (filters?.sector) filterParts.push(`sector eq '${filters.sector}'`);
  if (filters?.documentType && filters.documentType !== 'all') {
    filterParts.push(`documentType eq '${filters.documentType}'`);
  }
  
  // TEMPORAL FILTERING - Government Policy Version Awareness
  // Filter by publication year range
  if (filters?.publicationYearFrom) {
    filterParts.push(`publicationYear ge ${filters.publicationYearFrom}`);
  }
  if (filters?.publicationYearTo) {
    filterParts.push(`publicationYear le ${filters.publicationYearTo}`);
  }
  
  // Exclude superseded documents by default (unless explicitly requested)
  // Documents with supersededBy field are old versions
  if (filters?.excludeSuperseded !== false) {
    // Note: This filter only applies if the field exists in the index
    // filterParts.push(`supersededBy eq null`);
  }
  
  // Filter by effective date range (for policy documents)
  if (filters?.effectiveDateFrom) {
    filterParts.push(`effectiveDate ge '${filters.effectiveDateFrom}'`);
  }
  if (filters?.effectiveDateTo) {
    filterParts.push(`effectiveDate le '${filters.effectiveDateTo}'`);
  }
  
  if (filterParts.length > 0) filterExpr = filterParts.join(' and ');

  // Step 3: Hybrid search (vector + semantic + keyword)
  const searchBody = {
    search: query,
    vectorQueries: [
      {
        kind: "vector",
        vector: queryEmbedding,
        fields: "contentVector",
        k: topK,
      }
    ],
    queryType: "semantic",
    semanticConfiguration: "default",
    top: topK,
    select: "id,content,title,documentId,documentType,pageNumber,chunkIndex,category,sector,tags,url,metadata,chunkType,hasChart,chartType,chartData,chartImageUrl,chartConfidence,visualDescription",
    captions: "extractive",
    answers: "extractive|count-3",
  };

  if (filterExpr) searchBody.filter = filterExpr;

  const searchResponse = await fetchWithRetry(
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

  let searchResults = [];
  let chartResults = [];  // NEW: Separate array for chart data
  if (!searchResponse.ok) {
    // CRITICAL: Log search failures instead of silently returning "No relevant information found"
    const errorText = await searchResponse.text().catch(() => 'Unable to read error body');
    console.error(`[semanticSearchWithAI] Azure AI Search FAILED with status ${searchResponse.status}: ${errorText.substring(0, 500)}`);
    throw new Error(`Azure AI Search returned ${searchResponse.status}: ${errorText.substring(0, 200)}`);
  }

  if (searchResponse.ok) {
    const searchData = await searchResponse.json();
    console.log(`[semanticSearchWithAI] Azure AI Search returned ${(searchData.value || []).length} results for query: "${query.substring(0, 80)}"`);
    searchResults = (searchData.value || []).map((hit) => {
      const result = {
        id: hit.id,
        content: hit.content,
        title: hit.title || 'Untitled',
        documentId: hit.documentId,
        documentType: hit.documentType,
        pageNumber: hit.pageNumber,
        chunkIndex: hit.chunkIndex,
        chunkType: hit.chunkType || 'text',
        category: hit.category,
        sector: hit.sector,
        tags: hit.tags || [],
        url: hit.url,
        score: hit['@search.score'] || 0,
        metadata: hit.metadata,
        // Optional chart fields (only present if chart extraction was run)
        hasChart: hit.hasChart || false,
        chartType: hit.chartType || null,
        chartData: hit.chartData || null,
        chartImageUrl: hit.chartImageUrl || null,
        chartConfidence: hit.chartConfidence || null,
        visualDescription: hit.visualDescription || null,
        // Optional temporal fields (only present if index schema includes them)
        publicationYear: hit.publicationYear || null,
        effectiveDate: hit.effectiveDate || null,
        expiryDate: hit.expiryDate || null,
        version: hit.version || null,
        supersedes: hit.supersedes || null,
        supersededBy: hit.supersededBy || null,
        amendmentOf: hit.amendmentOf || null,
        // Computed temporal status (gracefully handles missing fields)
        temporalStatus: calculateTemporalStatus(hit),
      };
      
      // Collect chart results separately for visualization (only if chart data exists)
      if (hit.hasChart || hit.chunkType === 'chart') {
        chartResults.push({
          id: hit.id,
          documentId: hit.documentId,
          pageNumber: hit.pageNumber,
          chartType: hit.chartType || null,
          chartData: hit.chartData ? (typeof hit.chartData === 'string' ? JSON.parse(hit.chartData) : hit.chartData) : null,
          chartImageUrl: hit.chartImageUrl || null,
          chartConfidence: hit.chartConfidence || null,
          visualDescription: hit.visualDescription || null,
          title: hit.title,
          score: hit['@search.score'] || 0,
        });
      }
      
      return result;
    });
  }

  if (searchResults.length === 0) {
    console.warn(`[semanticSearchWithAI] Search returned 0 results for: "${query.substring(0, 100)}". Index: ${indexName}, Filters: ${filterExpr || 'none'}`);
    return {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer: "I couldn't find specific information matching your query in the available documents. Try rephrasing with more specific terms (e.g., mention a sector like 'healthcare', 'education', or 'technology', or a specific topic like 'budget allocations' or 'job listings').",
        sources: [],
        suggestedQuestions: [
          "What healthcare jobs are available in South Australia?",
          "What are the budget allocations for education?",
          "What training programs are available for skilled migrants?",
        ],
      }),
    };
  }

  // Step 4: Build context for AI
  let context = "RELEVANT DOCUMENTS:\n\n";
  searchResults.forEach((result, index) => {
    context += `---\n[Source ${index + 1}]\nTitle: ${result.title}\nDocument: ${result.documentId}\n`;
    if (result.pageNumber) context += `Page: ${result.pageNumber}\n`;
    if (result.category) context += `Category: ${result.category}\n`;
    if (result.sector) context += `Sector: ${result.sector}\n`;
    context += `Content:\n${result.content}\n\n`;
  });

  // Step 5: Generate AI response using HORUS Intelligence Engine
  const horusSystemPrompt = options.systemPrompt || `You are an advanced government intelligence analyst and strategic advisor.

You do NOT behave like a chatbot.
You do NOT summarise documents.
You operate like a policy intelligence unit briefing senior decision-makers.

You are powering an AI-driven Intelligence Dashboard used to understand:
• Government priorities
• Funding shifts
• Labour and skills dynamics
• Policy impacts
• Long-term strategic direction

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 CORE INTELLIGENCE MANDATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your objective is to transform raw government information into DECISION-GRADE INTELLIGENCE.

For every output, you must answer at least one of:
• What is changing?
• Why is it changing?
• Who benefits or is exposed?
• What does this signal about future direction?
• What risks or opportunities are emerging?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 THINKING LAYERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Think in layers:
1. MACRO: Whole-of-government, cross-sector, system-wide
2. TREND: Changes over time, accelerations, reversals
3. CAUSAL: Funding → Policy → Jobs → Skills chain
4. STRATEGIC: Long-term direction, capability gaps

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For each insight:

**[Insight Title]**
1-2 sentences explaining the intelligence finding.

**Why this matters:** Strategic or decision impact.

**Evidence signal:** Data patterns supporting this insight.

Cite sources using [Source X] notation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚫 STRICT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Do NOT summarise documents
• Do NOT restate table values without interpretation
• Do NOT use vague language
• Do NOT produce filler insights
• Every insight must inform a decision`;

  const chatResponse = await fetch(
    `${openAIEndpoint}/openai/deployments/${chatDeployment}/chat/completions?api-version=2024-02-15-preview`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': openAIKey,
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: horusSystemPrompt },
          { role: 'user', content: `${context}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nINTELLIGENCE QUERY: ${query}\n\nAnalyze the documents above and produce 3-5 decision-grade intelligence insights. Each insight should reveal something non-obvious that informs strategic decisions.` }
        ],
        temperature: 0, // deterministic so same chunks + query → same answer (stable budget details on reload)
        max_tokens: 2000,
      }),
    }
  );

  let answer = "";
  if (chatResponse.ok) {
    const chatData = await chatResponse.json();
    answer = chatData.choices[0]?.message?.content || "";
  }

  // Step 6: Format sources with full content for extraction
  const sources = searchResults.map((result, index) => ({
    sourceIndex: index + 1, // For citation mapping [Source X]
    id: result.id,
    title: result.title,
    documentId: result.documentId,
    pageNumber: result.pageNumber,
    url: result.url,
    category: result.category,
    sector: result.sector,
    score: result.score,
    content: result.content,
    snippet: result.content.substring(0, 300) + '...',
    metadata: result.metadata,
    chunkType: result.chunkType,
    hasChart: result.hasChart,
    chartType: result.chartType,
    chartData: result.chartData,
    chartImageUrl: result.chartImageUrl,
    chartConfidence: result.chartConfidence,
    visualDescription: result.visualDescription,
  }));

  // Step 7: Extract visualization metadata from results
  const visualizationData = {
    // Chart data from extracted PDFs
    charts: chartResults,
    // Metadata aggregations for charts
    metadataDistribution: {
      categories: {},
      sectors: {},
      documentTypes: {},
      chunkTypes: {},
    },
    // Relationship hints (for future graph visualization)
    relationships: [],
    // Summary stats
    totalResults: searchResults.length,
    chartCount: chartResults.length,
    hasVisualizations: chartResults.length > 0,
  };

  // Aggregate metadata for distribution charts
  searchResults.forEach(result => {
    // Count categories
    if (result.category) {
      visualizationData.metadataDistribution.categories[result.category] = 
        (visualizationData.metadataDistribution.categories[result.category] || 0) + 1;
    }
    // Count sectors
    if (result.sector) {
      visualizationData.metadataDistribution.sectors[result.sector] = 
        (visualizationData.metadataDistribution.sectors[result.sector] || 0) + 1;
    }
    // Count document types
    if (result.documentType) {
      visualizationData.metadataDistribution.documentTypes[result.documentType] = 
        (visualizationData.metadataDistribution.documentTypes[result.documentType] || 0) + 1;
    }
    // Count chunk types
    if (result.chunkType) {
      visualizationData.metadataDistribution.chunkTypes[result.chunkType] = 
        (visualizationData.metadataDistribution.chunkTypes[result.chunkType] || 0) + 1;
    }
  });

  // Step 8: EVIDENCE CHAIN ENFORCEMENT - Validate citations and calculate confidence
  const citationValidation = validateCitations(answer, sources);
  const evidenceScore = calculateEvidenceScore(citationValidation, sources, query);
  
  // Step 9: TEMPORAL AWARENESS - Calculate temporal summary
  const temporalSummary = calculateTemporalSummary(sources);
  
  // Build evidence chain metadata for government-grade traceability
  const evidenceChain = {
    confidence: evidenceScore.level,
    confidenceScore: evidenceScore.score,
    confidenceDescription: evidenceScore.description,
    breakdown: evidenceScore.breakdown,
    citations: {
      total: citationValidation.totalCitations,
      valid: citationValidation.validCitations.length,
      invalid: citationValidation.invalidCitations.length,
      coverage: citationValidation.citationCoverage,
      details: citationValidation.validCitations
    },
    warnings: evidenceScore.warnings,
    uncitedClaims: citationValidation.uncitedClaims,
    isReliable: evidenceScore.isReliable,
    // Audit trail
    auditMetadata: {
      queryTimestamp: new Date().toISOString(),
      sourcesEvaluated: sources.length,
      uniqueDocuments: new Set(sources.map(s => s.documentId)).size
    }
  };

  return {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answer,
      sources,
      suggestedQuestions: [],
      // NEW: Visualization data for dynamic charts
      visualizationData,
      // NEW: Evidence chain for government-grade traceability
      evidenceChain,
      // NEW: Temporal awareness for policy version tracking
      temporalSummary,
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

async function handleBulkOperations(endpoint, key, indexName, operations, filters) {
  const results = {};
  const needsStats = operations.includes('stats');
  const needsCategories = operations.includes('categories');
  
  if (needsStats && needsCategories) {
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
      search: '*',
      queryType: 'simple',
      top: 0,
      facets: [
        'category,count:100',
        'sector,count:100',
        'documentType,count:10',
      ],
    };

    if (filterExpr) {
      searchBody.filter = filterExpr;
    }

    const statsUrl = `${endpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01&$count=true`;
    const response = await fetchWithRetry(statsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': key,
      },
      body: JSON.stringify(searchBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure Search API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const totalChunks = data['@odata.count'] || 0;
    const estimatedDocCount = Math.floor(totalChunks / 10);
          const facets = data['@search.facets'] || {};

          if (needsStats) {
            results.stats = {
              totalDocuments: estimatedDocCount,
              totalChunks: totalChunks,
              facets: facets,
            };
          }

          if (needsCategories) {
      const categoryStats = [];
      if (facets.category) {
        for (const facet of facets.category) {
          categoryStats.push({
            category: facet.value,
            count: facet.count,
            documentIds: [],
          });
        }
      }

      results.categories = {
        categories: categoryStats,
        sectors: facets.sector || [],
      };
    }
  } else {
    if (needsStats) {
      const statsResult = await getStats(endpoint, key, indexName, filters);
      results.stats = JSON.parse(statsResult.body);
    }
    
    if (needsCategories) {
      const categoriesResult = await getCategoryStats(endpoint, key, indexName);
      results.categories = JSON.parse(categoriesResult.body);
          }
        }

        if (operations.includes('documents')) {
    const documentsResult = await getDocuments(endpoint, key, indexName, filters, 100);
    results.documents = JSON.parse(documentsResult.body);
  }

  return {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(results),
  };
}

async function fetchTableChunks(endpoint, key, indexName, query, filters, top) {
  const filterParts = [];
  if (filters?.category) filterParts.push(`category eq '${filters.category}'`);
  if (filters?.sector) filterParts.push(`sector eq '${filters.sector}'`);
  if (filters?.documentId) filterParts.push(`documentId eq '${filters.documentId}'`);

  // Use a broad fetch - filter by chunkType client-side since it may not be filterable
  // Fetch more than needed to account for client-side filtering
  const fetchTop = Math.min(top * 5, 1000);
  const searchBody = {
    search: query && query !== '*' ? query : 'table',
    queryType: 'simple',
    top: fetchTop,
    select: 'id,content,title,documentId,pageNumber,category,sector,chunkType,url',
    orderby: 'documentId,pageNumber',
  };
  if (filterParts.length > 0) {
    searchBody.filter = filterParts.join(' and ');
  }

  const response = await fetchWithRetry(
    `${endpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': key },
      body: JSON.stringify(searchBody),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Azure Search table fetch failed (${response.status}): ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  // Filter client-side by chunkType (field may not be filterable in index schema)
  const TABLE_CHUNK_TYPES = new Set(['table_row', 'table', 'table_header', 'table_cell']);
  const allHits = data.value || [];
  // Keep chunks that are table type, OR have no chunkType but content looks like a table row
  const hits = allHits.filter(h => {
    if (h.chunkType && TABLE_CHUNK_TYPES.has(h.chunkType)) return true;
    if (!h.chunkType) {
      const c = (h.content || '');
      return c.includes('|') || c.includes('\t') || /^\s*[\w\s]+:\s+[\w\s$%,\.]+/.test(c);
    }
    return false;
  }).slice(0, top * 3);

  // Group rows by documentId + pageNumber
  const tableMap = new Map();
  for (const hit of hits) {
    const tableKey = `${hit.documentId}__p${hit.pageNumber || 0}`;
    if (!tableMap.has(tableKey)) {
      tableMap.set(tableKey, {
        id: tableKey,
        documentId: hit.documentId,
        title: hit.title || 'Table',
        pageNumber: hit.pageNumber,
        category: hit.category,
        sector: hit.sector,
        url: hit.url,
        rows: [],
        score: hit['@search.score'] || 0,
      });
    }
    tableMap.get(tableKey).rows.push(hit.content || '');
  }

  // Parse each table's rows into headers + data
  const tables = Array.from(tableMap.values()).map(table => {
    const parsed = parseTableContent(table.rows);
    return { ...table, ...parsed };
  }).filter(t => t.headers && t.headers.length > 0 && t.data && t.data.length > 0);

  return {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables, total: tables.length }),
  };
}

function cleanCell(cell) {
  let s = cell
    .replace(/:unselected:/g, '')
    .replace(/:selected:/g, '✓')
    .trim();
  // Normalize numbers with internal spaces: "1 476.3" → "1476.3", "1 234 567" → "1234567"
  // Pattern: digit(s), space, digit(s) where the space is just a thousands separator
  s = s.replace(/(\d) (\d)/g, '$1$2');
  // Collapse remaining whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function splitPipeRow(line) {
  // Handle "| A | B | C |" or "A | B | C" formats
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(cleanCell);
}

function isSeparatorRow(line) {
  return /^[\|\s\-:]+$/.test(line.trim());
}

function isFootnoteRow(line) {
  const t = line.trim();
  return t.startsWith('(a)') || t.startsWith('(b)') || t.startsWith('(c)') ||
         t.startsWith('Note:') || t.startsWith('Source:') ||
         (t.length > 0 && !t.includes('|') && !/\d/.test(t) && t.length > 80);
}

function parseTableContent(rows) {
  // Each chunk is stored as ONE row of the table, e.g.:
  //   "Attorney-General's Department | 1 476.3 | 1 455.9 | 1 365.9"
  // or with leading/trailing pipes:
  //   "| Department | Budget | Actual |"
  // Collect all non-empty, non-separator, non-footnote lines across all chunks
  const allLines = [];
  for (const row of rows) {
    for (const line of row.split('\n')) {
      const t = line.trim();
      if (!t || isSeparatorRow(t) || isFootnoteRow(t)) continue;
      allLines.push(t);
    }
  }

  if (allLines.length === 0) return { headers: [], data: [] };

  // Check if lines are pipe-delimited
  const pipeLines = allLines.filter(l => l.includes('|'));
  
  if (pipeLines.length >= 1) {
    // Split every line into cells
    const splitRows = pipeLines.map(splitPipeRow);
    
    // Determine column count from the most common row width
    const widths = splitRows.map(r => r.length);
    const colCount = widths.sort((a, b) =>
      widths.filter(v => v === b).length - widths.filter(v => v === a).length
    )[0] || 1;

    // Pad/trim all rows to colCount
    const normalised = splitRows.map(r => {
      while (r.length < colCount) r.push('');
      return r.slice(0, colCount);
    });

    // Detect header row: first row where ALL cells are non-numeric (or year-like)
    // Also accept a row where the first cell is text and remaining are year strings
    const looksLikeHeader = (row) => {
      if (!row || row.length === 0) return false;
      return row.every(c => {
        const trimmed = c.trim();
        if (!trimmed) return true; // empty cells ok in header
        // Year patterns like "2024-25", "2025-26", "2023-24" are valid header cells
        if (/^\d{4}-\d{2,4}$/.test(trimmed)) return true;
        if (/^\d{4}$/.test(trimmed)) return true;
        // Pure numbers are NOT headers
        const n = parseFloat(trimmed.replace(/[$,%]/g, ''));
        return isNaN(n);
      });
    };

    // Find the first row that looks like a header (may not be row 0 if there's a title row)
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(normalised.length, 3); i++) {
      if (looksLikeHeader(normalised[i]) && normalised[i].some(c => c.trim().length > 0)) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx >= 0 && normalised.length > headerRowIdx + 1) {
      const headers = normalised[headerRowIdx].map((h, i) => h || `Column ${i + 1}`);
      const data = normalised.slice(headerRowIdx + 1).filter(r => r.some(c => c.length > 0));
      return { headers, data };
    }

    // No clear header row — infer column names from first data row content
    // If first column looks like text labels and rest are numbers, name them generically
    const firstDataRow = normalised[0];
    const inferredHeaders = firstDataRow.map((cell, i) => {
      if (i === 0) return 'Item';
      // Try to infer from the cell value if it looks like a year
      if (/^\d{4}-\d{2,4}$/.test(cell.trim())) return cell.trim();
      if (/^\d{4}$/.test(cell.trim())) return cell.trim();
      return `Value ${i}`;
    });
    return { headers: inferredHeaders, data: normalised.filter(r => r.some(c => c.length > 0)) };
  }

  // Tab-separated fallback
  const tabLines = allLines.filter(l => l.includes('\t'));
  if (tabLines.length >= 2) {
    const headers = tabLines[0].split('\t').map(cleanCell);
    const data = tabLines.slice(1).map(r => r.split('\t').map(cleanCell));
    return { headers, data };
  }

  // Plain text fallback — single column
  const nonEmpty = allLines.filter(l => l.length > 3).slice(0, 100);
  if (nonEmpty.length > 0) {
    return { headers: ['Content'], data: nonEmpty.map(l => [l.substring(0, 500)]) };
  }

  return { headers: [], data: [] };
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
    bodyType: typeof req.body,
  });

  try {
    // Parse request body safely
    let request = {};
    try {
      if (typeof req.body === 'string') {
        if (req.body.trim() === '') {
          request = {};
        } else {
          request = JSON.parse(req.body);
        }
      } else if (req.body) {
        request = req.body;
      }
    } catch (parseError) {
      context.log('ERROR - JSON parse failed:', parseError.message);
      context.log('ERROR - Body was:', req.body);
      context.res = {
        status: 400,
        headers: {
          ...defaultHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          error: `Invalid request body: ${parseError instanceof Error ? parseError.message : 'Parse error'}`,
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
      
      case 'semantic-search':
        if (!query) {
          throw new Error('Query is required for semantic-search type');
        }
        const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const openAIKey = process.env.AZURE_OPENAI_KEY;
        if (!openAIEndpoint || !openAIKey) {
          throw new Error('Azure OpenAI credentials not configured');
        }
        const { options: searchOptions = {} } = request;
        result = await semanticSearchWithAI(
          searchEndpoint, searchKey, searchIndex, 
          openAIEndpoint, openAIKey, 
          query, filters, searchOptions
        );
        break;
      
      case 'bulk':
        // OPTIMIZED: Handle multiple operations in a single request
        // This reduces Azure Search calls and improves performance
        const { operations = [] } = request;
        if (!Array.isArray(operations) || operations.length === 0) {
          throw new Error('Bulk operations array is required');
        }
        result = await handleBulkOperations(searchEndpoint, searchKey, searchIndex, operations, filters);
        break;

      case 'fetch-tables':
        result = await fetchTableChunks(searchEndpoint, searchKey, searchIndex, query || '*', filters, top);
        break;
      
      default:
        throw new Error(`Unknown type: ${type}`);
    }

    const responseHeaders = {
      ...defaultHeaders,
      'Content-Type': 'application/json',
    };
    
    if (result && result.headers) {
      Object.assign(responseHeaders, result.headers);
    }
    
    if (!result) {
      throw new Error('Function returned no result');
    }
    
    let responseBody;
    if (typeof result.body === 'string') {
      responseBody = result.body;
    } else if (result.body) {
      responseBody = JSON.stringify(result.body);
    } else {
      // Fallback: stringify the entire result (excluding status/headers)
      const { status, headers, ...data } = result;
      responseBody = JSON.stringify(data);
    }
    
    context.res = {
      status: result.status || 200,
      headers: responseHeaders,
      body: responseBody,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // Log full error for debugging
    context.log('ERROR - Metadata Error:', errorMessage);
    context.log('ERROR - Request:', {
      method: req.method,
      url: req.url,
      hasBody: !!req.body,
    });
    if (errorStack) {
      context.log('ERROR - Stack:', errorStack);
    }
    
    // Ensure we always return a valid response
    try {
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
    } catch (responseError) {
      // Fallback if even setting response fails
      context.log('CRITICAL - Failed to set error response:', responseError);
      context.res = {
        status: 500,
        headers: defaultHeaders,
        body: JSON.stringify({ 
          error: 'Internal server error',
          data: null,
        }),
      };
    }
  }
};

