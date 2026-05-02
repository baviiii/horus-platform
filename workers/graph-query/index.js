const gremlin = require('gremlin');
const neo4j = require('neo4j-driver');
const { TableClient } = require('@azure/data-tables');

// Cosmos DB Gremlin connection - Lazy initialization to avoid crashes at module load
let cosmosClient = null;

function getCosmosClient() {
  if (!cosmosClient) {
    if (!process.env.COSMOS_GREMLIN_ENDPOINT || !process.env.COSMOS_DATABASE || !process.env.COSMOS_GRAPH || !process.env.COSMOS_PRIMARY_KEY) {
      console.warn('Cosmos DB environment variables not configured - graph queries will return empty results');
      return null; // Return null instead of throwing - prevents worker crash
    }
    try {
      const authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator(
        `/dbs/${process.env.COSMOS_DATABASE}/colls/${process.env.COSMOS_GRAPH}`,
        process.env.COSMOS_PRIMARY_KEY
      );
      cosmosClient = new gremlin.driver.Client(
        process.env.COSMOS_GREMLIN_ENDPOINT,
        {
          authenticator,
          traversalsource: 'g',
          rejectUnauthorized: true,
          mimeType: 'application/vnd.gremlin-v2.0+json'
        }
      );
    } catch (error) {
      console.error('Failed to initialize Cosmos DB client:', error);
      return null; // Return null instead of throwing
    }
  }
  return cosmosClient;
}

// Initialize client on first use (backward compatibility)
// This ensures cosmosClient is available for existing code
function ensureCosmosClient() {
  if (!cosmosClient) {
    cosmosClient = getCosmosClient();
  }
  return cosmosClient;
}

// ============================================================================
// SEMANTIC ENTITY SEARCH
// Uses Azure AI Search entity index for semantic similarity discovery
// This is the "sidecar" semantic index - discovery without graph pollution
// ============================================================================

/**
 * Search for similar entities using semantic similarity
 * This enables finding entities even when names don't match exactly
 * 
 * @param {string} entityName - Entity name to search for
 * @param {string} entityType - Optional entity type filter
 * @param {number} topK - Number of results to return
 * @param {Object} context - Azure Function context for logging
 * @returns {Promise<Array>} Array of similar entities with similarity scores
 */
async function searchSimilarEntities(entityName, entityType = null, topK = 10, context = null) {
  const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const searchKey = process.env.AZURE_SEARCH_KEY;
  const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const openAIKey = process.env.AZURE_OPENAI_KEY;
  const entityIndex = process.env.AZURE_SEARCH_ENTITY_INDEX || 'entities';
  const embeddingDeployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-large';
  
  // Check if entity index is configured
  if (!searchEndpoint || !searchKey || !openAIEndpoint || !openAIKey) {
    if (context) context.log('Semantic entity search not configured - missing credentials');
    return [];
  }
  
  try {
    // Step 1: Generate embedding for search query
    const embeddingResponse = await fetch(
      `${openAIEndpoint}/openai/deployments/${embeddingDeployment}/embeddings?api-version=2024-02-15-preview`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': openAIKey,
        },
        body: JSON.stringify({
          input: entityName.substring(0, 8000),
          model: embeddingDeployment,
        }),
      }
    );
    
    if (!embeddingResponse.ok) {
      if (context) context.log.warn('Failed to generate entity query embedding');
      return [];
    }
    
    const embeddingData = await embeddingResponse.json();
    const queryVector = embeddingData.data[0].embedding;
    
    // Step 2: Build semantic search query
    const searchBody = {
      vectorQueries: [
        {
          kind: 'vector',
          vector: queryVector,
          fields: 'entityVector',
          k: topK
        }
      ],
      select: 'id,entityType,name,canonicalName,description,aliases,confidence,graphVertexId,mentionCount,sector',
      top: topK
    };
    
    // Add entity type filter if specified
    if (entityType) {
      searchBody.filter = `entityType eq '${entityType}'`;
    }
    
    // Step 3: Execute semantic search
    const searchResponse = await fetch(
      `${searchEndpoint}/indexes/${entityIndex}/docs/search?api-version=2023-11-01`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': searchKey,
        },
        body: JSON.stringify(searchBody),
      }
    );
    
    if (!searchResponse.ok) {
      // Entity index might not exist yet - that's okay, fallback to text search
      const errorText = await searchResponse.text();
      if (context) context.log(`Semantic entity search failed (index may not exist): ${errorText.substring(0, 200)}`);
      return [];
    }
    
    const searchData = await searchResponse.json();
    
    // Step 4: Format results with similarity scores and classification
    const similar = (searchData.value || []).map(hit => {
      // Normalize similarity score (Azure Search vector scores are typically 0-1 for cosine)
      // Higher is better, so we use the score directly
      const similarity = hit['@search.score'] || 0;
      
      return {
        id: hit.id,
        name: hit.name,
        canonicalName: hit.canonicalName,
        entityType: hit.entityType,
        description: hit.description || '',
        aliases: hit.aliases || [],
        confidence: hit.confidence || 0.8,
        graphVertexId: hit.graphVertexId, // Link to graph vertex
        mentionCount: hit.mentionCount || 1,
        sector: hit.sector,
        // Similarity metrics
        similarity: similarity,
        similarityPercent: Math.round(similarity * 100),
        // Classification based on decision rubric thresholds
        classification: similarity >= 0.88 ? 'high_similarity' : 
                        similarity >= 0.75 ? 'medium_similarity' : 'low_similarity',
        // Search method indicator
        searchMethod: 'semantic',
        // Verification status (for agent decision rubric)
        needsVerification: similarity < 0.88, // Below high threshold needs doc verification
      };
    });
    
    if (context) context.log(`Semantic entity search found ${similar.length} similar entities for "${entityName}"`);
    
    return similar;
    
  } catch (error) {
    if (context) context.log.warn(`Semantic entity search error: ${error.message}`);
    return []; // Return empty array on error - will fallback to text search
  }
}

// Neo4j connection
let neo4jDriver = null;
function getNeo4jDriver() {
  if (!neo4jDriver && process.env.NEO4J_URI) {
    neo4jDriver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USERNAME || 'neo4j', process.env.NEO4J_PASSWORD)
    );
  }
  return neo4jDriver;
}

module.exports = async function (context, req) {
  context.log('Graph query function triggered');

  // CORS headers (include x-functions-key so protective browsers allow preflight)
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-functions-key'
  };

  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers };
    return;
  }

  try {
    // Ensure Cosmos DB client is initialized before any queries
    cosmosClient = getCosmosClient(); // May be null if Cosmos not configured - handled per-action below

    const { action, entityName, entityType, depth = 2, limit = 20, backend = 'cosmos' } = req.body || {};

    if (!action) {
      context.res = {
        status: 400,
        headers,
        body: { error: 'Action required: lookup, traverse, path, search, or analytics' }
      };
      return;
    }

    context.log(`Graph query: action=${action}, backend=${backend}`);
    let result;

    // Route to appropriate backend
    if (backend === 'neo4j') {
      result = await executeNeo4jQuery(context, req.body);
    } else {
      // Default to Cosmos DB
      switch (action) {
        case 'lookup':
          result = await lookupEntity(entityName, entityType, context);
          break;

        case 'traverse':
          // For traverse, first find the entity using semantic search if needed
          if (entityName) {
            const foundEntities = await lookupEntity(entityName, entityType, context);
            if (foundEntities.length > 0) {
              // Use the first found entity (highest similarity if semantic)
              const targetEntity = foundEntities[0];
              result = await traverseRelationships(targetEntity.canonical_name || targetEntity.name, depth, limit);
            } else {
              result = [];
            }
          } else {
            result = await traverseRelationships(entityName, depth, limit);
          }
          break;

        case 'path':
          const { fromEntity, toEntity, maxHops = 5 } = req.body;
          // Use semantic search to find both entities first
          const fromEntities = await lookupEntity(fromEntity, null, context);
          const toEntities = await lookupEntity(toEntity, null, context);
          if (fromEntities.length > 0 && toEntities.length > 0) {
            result = await findPath(
              fromEntities[0].canonical_name || fromEntities[0].name,
              toEntities[0].canonical_name || toEntities[0].name,
              maxHops
            );
          } else {
            result = [];
          }
          break;

        case 'search':
          const { query, types } = req.body;
          result = await searchEntities(query, types, limit, context);
          break;

        case 'related':
          const { relationshipType } = req.body;
          result = await getRelatedEntities(entityName, relationshipType, limit);
          break;

        case 'list_all':
          result = await listAllEntities(limit);
          break;

        case 'list_edges':
          result = await listAllEdges(limit);
          break;

        case 'get_impacts':
          const { entityName: impactEntityName, impactType, severity, timeframe, policyId, timeframeFrom, timeframeTo } = req.body;
          result = await getImpactsForEntity(impactEntityName, {
            impactType,
            severity,
            timeframe,
            policyId,
            timeframeFrom,
            timeframeTo,
            limit
          }, context);
          break;

        case 'get_impacts_by_policy':
          const { policyId: policyIdForImpacts } = req.body;
          result = await getImpactsByPolicy(policyIdForImpacts, {
            impactType: req.body.impactType,
            severity: req.body.severity,
            limit
          }, context);
          break;

        case 'aggregate_impacts':
          const { entityName: aggEntityName, policies: policyIds } = req.body;
          result = await aggregateImpactsForEntity(aggEntityName, policyIds, context);
          break;

        case 'analyze_impacts':
          const { entityName: analysisEntityName, analysisType, timeframe: analysisTimeframe, entityNames } = req.body;
          if (analysisType === 'temporal_trends') {
            result = await analyzeImpactTrends(analysisEntityName, analysisTimeframe, context);
          } else if (analysisType === 'compare') {
            result = await compareImpacts(entityNames || [analysisEntityName], req.body.impactType, context);
          } else if (analysisType === 'propagation') {
            result = await analyzeImpactPropagation(analysisEntityName, req.body.maxHops || 2, context);
          } else {
            result = { error: `Unknown analysis type: ${analysisType}` };
          }
          break;

        case 'forecast_impacts':
          const { entityName: forecastEntityName, forecastPeriods = 12 } = req.body;
          result = await forecastImpacts(forecastEntityName, forecastPeriods, context);
          break;

        case 'simulate_scenario':
          const { scenario } = req.body;
          result = await simulateImpactScenario(scenario, context);
          break;

        case 'generate_impact_report':
          const { entityName: reportEntityName, includeTrends = true, includeComparison = false, compareWith = [] } = req.body;
          result = await generateImpactReport(reportEntityName, {
            includeTrends,
            includeComparison,
            compareWith
          }, context);
          break;

        case 'get_alerts':
          const { severity: alertSeverity, entity: alertEntity, dateRange } = req.body;
          result = await getLatestAlerts({
            severity: alertSeverity,
            entity: alertEntity,
            dateRange
          }, context);
          break;

        case 'count_entities':
          result = await countGraphContents(context);
          break;

        case 'clear_graph':
          result = await clearGraph(context);
          break;

        default:
          context.res = {
            status: 400,
            headers,
            body: { error: `Unknown action: ${action}` }
          };
          return;
      }
    }

    // Add semantic search metadata if available
    const semanticMetadata = Array.isArray(result) && result.length > 0 && result[0]._semantic
      ? {
          searchMethod: result[0]._semantic.searchMethod,
          semanticResultsCount: result.filter(r => r._semantic?.searchMethod === 'semantic').length,
          textResultsCount: result.filter(r => r._semantic?.searchMethod === 'text').length,
          avgSimilarity: result
            .filter(r => r._semantic?.similarity !== null && r._semantic?.similarity !== undefined)
            .reduce((sum, r) => sum + (r._semantic.similarity || 0), 0) / 
            Math.max(1, result.filter(r => r._semantic?.similarity !== null).length)
        }
      : null;
    
    context.res = {
      status: 200,
      headers,
      body: {
        success: true,
        action,
        backend,
        data: result,
        count: Array.isArray(result) ? result.length : 1,
        // Semantic search metadata for agent decision rubric
        semanticSearch: semanticMetadata
      }
    };

  } catch (error) {
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      action: req.body?.action || 'unknown'
    };
    context.log.error('Graph query error:', JSON.stringify(errorDetails, null, 2));
    context.res = {
      status: 500,
      headers,
      body: {
        error: 'Graph query failed',
        message: error.message,
        action: req.body?.action || 'unknown',
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
      }
    };
  }
};

// Lookup entity by name OR canonical_name, and optional type
// Uses SEMANTIC SEARCH first to find similar entities, then exact match
async function lookupEntity(entityName, entityType, context = null) {
  // STEP 1: Try semantic search first (finds similar entities)
  const semanticResults = await searchSimilarEntities(entityName, entityType, 5, context);
  
  if (semanticResults.length > 0 && semanticResults[0].similarity >= 0.75) {
    // Found good semantic matches - return them
    const graphResults = semanticResults.map(semanticEntity => ({
      id: semanticEntity.graphVertexId || semanticEntity.id,
      name: semanticEntity.name,
      canonical_name: semanticEntity.canonicalName,
      entity_type: semanticEntity.entityType,
      description: semanticEntity.description,
      aliases: semanticEntity.aliases,
      confidence: semanticEntity.confidence,
      mention_count: semanticEntity.mentionCount,
      _semantic: {
        similarity: semanticEntity.similarity,
        similarityPercent: semanticEntity.similarityPercent,
        classification: semanticEntity.classification,
        searchMethod: 'semantic'
      }
    }));
    
    if (context) {
      context.log(`Entity lookup: Found ${semanticResults.length} entities via semantic search`);
    }
    
    return graphResults;
  }
  
  // STEP 2: Fallback to exact match in graph
  if (context) {
    context.log(`Entity lookup: Semantic search found no good matches, using exact match`);
  }
  
  let query = `g.V().or(has('name', '${escapeGremlin(entityName)}'), has('canonical_name', '${escapeGremlin(entityName)}'))`;
  
  if (entityType) {
    query = `g.V().has('entity_type', '${escapeGremlin(entityType)}').or(has('name', '${escapeGremlin(entityName)}'), has('canonical_name', '${escapeGremlin(entityName)}'))`;
  }
  
  query += `.valueMap(true).limit(10)`;
  
  const result = await cosmosClient.submit(query);
  const exactResults = formatVertices(result._items || []);
  
  // Mark as text search
  exactResults.forEach(r => {
    r._semantic = {
      searchMethod: 'text',
      similarity: null
    };
  });
  
  return exactResults;
}

// Traverse relationships from an entity
async function traverseRelationships(entityName, depth, limit) {
  const query = `
    g.V().has('name', '${escapeGremlin(entityName)}')
      .repeat(bothE().otherV().simplePath())
      .times(${Math.min(depth, 3)})
      .path()
      .by(valueMap(true))
      .limit(${Math.min(limit, 50)})
  `;
  
  const result = await cosmosClient.submit(query);
  return formatPaths(result._items || []);
}

// Find path between two entities
async function findPath(fromEntity, toEntity, maxHops) {
  const query = `
    g.V().has('name', '${escapeGremlin(fromEntity)}')
      .repeat(bothE().otherV().simplePath())
      .until(has('name', '${escapeGremlin(toEntity)}').or().loops().is(gte(${maxHops})))
      .has('name', '${escapeGremlin(toEntity)}')
      .path()
      .by(valueMap(true))
      .limit(5)
  `;
  
  const result = await cosmosClient.submit(query);
  return formatPaths(result._items || []);
}

// Search entities by query string - SEMANTIC FIRST, then text fallback
async function searchEntities(query, types, limit, context = null) {
  // STEP 1: Try semantic entity search first (finds similar entities even with different names)
  const semanticResults = await searchSimilarEntities(query, types?.[0], limit, context);
  
  if (semanticResults.length > 0) {
    // Found semantic matches - convert to graph format and return
    // Map semantic results to graph vertex format
    const graphResults = semanticResults.map(semanticEntity => {
      // If we have graphVertexId, we can fetch full vertex data
      // Otherwise, return the semantic data formatted as a vertex
      return {
        id: semanticEntity.graphVertexId || semanticEntity.id,
        name: semanticEntity.name,
        canonical_name: semanticEntity.canonicalName,
        entity_type: semanticEntity.entityType,
        description: semanticEntity.description,
        aliases: semanticEntity.aliases,
        confidence: semanticEntity.confidence,
        mention_count: semanticEntity.mentionCount,
        sector: semanticEntity.sector,
        // Semantic search metadata
        _semantic: {
          similarity: semanticEntity.similarity,
          similarityPercent: semanticEntity.similarityPercent,
          classification: semanticEntity.classification,
          searchMethod: 'semantic',
          needsVerification: semanticEntity.needsVerification
        }
      };
    });
    
    if (context) {
      context.log(`Entity search: Found ${semanticResults.length} entities via semantic search (similarity: ${semanticResults[0]?.similarityPercent || 0}%)`);
    }
    
    return graphResults;
  }
  
  // STEP 2: Fallback to text search in graph (exact/partial name matching)
  if (context) {
    context.log(`Entity search: Semantic search found no results, falling back to text search`);
  }
  
  let gremlinQuery = `g.V()`;
  
  if (types && types.length > 0) {
    const typeFilter = types.map(t => `'${escapeGremlin(t)}'`).join(',');
    gremlinQuery += `.has('entity_type', within(${typeFilter}))`;
  }
  
  // Search by name OR canonical_name containing the query
  gremlinQuery += `.or(has('name', containing('${escapeGremlin(query)}')), has('canonical_name', containing('${escapeGremlin(query)}')))`;
  gremlinQuery += `.valueMap(true).limit(${Math.min(limit, 50)})`;
  
  const result = await cosmosClient.submit(gremlinQuery);
  const textResults = formatVertices(result._items || []);
  
  // Mark text search results
  textResults.forEach(r => {
    r._semantic = {
      searchMethod: 'text',
      similarity: null,
      needsVerification: true // Text matches always need verification
    };
  });
  
  return textResults;
}

// Get related entities by relationship type
async function getRelatedEntities(entityName, relationshipType, limit) {
  // Find entity by name or canonical_name
  let query = `g.V().or(has('name', '${escapeGremlin(entityName)}'), has('canonical_name', '${escapeGremlin(entityName)}'))`;
  
  if (relationshipType) {
    query += `.bothE('${escapeGremlin(relationshipType)}').otherV()`;
  } else {
    query += `.bothE().otherV()`;
  }
  
  query += `.valueMap(true).limit(${Math.min(limit, 50)})`;
  
  const result = await cosmosClient.submit(query);
  return formatVertices(result._items || []);
}

// List all entities (for migration)
async function listAllEntities(limit) {
  const query = `g.V().valueMap(true).limit(${Math.min(limit, 1000)})`;
  const result = await cosmosClient.submit(query);
  return formatVertices(result._items || []);
}

// List all edges (for migration)
async function listAllEdges(limit) {
  const query = `g.E().project('id','label','inV','outV','properties')
    .by(id)
    .by(label)
    .by(inV().values('canonical_name'))
    .by(outV().values('canonical_name'))
    .by(valueMap())
    .limit(${Math.min(limit, 1000)})`;
  const result = await cosmosClient.submit(query);
  return result._items || [];
}

// Escape special characters for Gremlin (backslash first, then single-quote)
function escapeGremlin(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Format vertex results
function formatVertices(items) {
  return items.map(item => {
    const formatted = {};
    for (const [key, value] of Object.entries(item)) {
      if (key === 'id') {
        formatted.id = value;
      } else if (Array.isArray(value) && value.length === 1) {
        formatted[key] = value[0];
      } else {
        formatted[key] = value;
      }
    }
    return formatted;
  });
}

// Format path results
function formatPaths(items) {
  return items.map(path => {
    if (Array.isArray(path)) {
      return path.map(step => {
        if (typeof step === 'object') {
          return formatVertices([step])[0];
        }
        return step;
      });
    }
    return path;
  });
}

// ============================================================================
// IMPACT QUERY AND ANALYSIS FUNCTIONS
// Enterprise-grade impact intelligence capabilities
// ============================================================================

/**
 * Format impact vertices into structured, readable format.
 * Gremlin valueMap(true) returns { key: [value], ... } — extract the first element of each array.
 */
function formatImpacts(impactVertices) {
  return impactVertices.map(impact => {
    // Helper: extract value from valueMap(true) format { key: [value] } or properties format
    const v = (key) => {
      // Try valueMap(true) format first: { key: [value] }
      if (impact[key] !== undefined) {
        return Array.isArray(impact[key]) ? impact[key][0] : impact[key];
      }
      // Fallback: Cosmos DB properties format { properties: { key: [{ value }] } }
      if (impact.properties?.[key]) {
        const prop = impact.properties[key];
        if (Array.isArray(prop) && prop.length > 0) {
          return prop[0]?.value !== undefined ? prop[0].value : prop[0];
        }
        return prop;
      }
      return '';
    };

    return {
      id: impact.id || v('id'),
      policyId: v('policy_id'),
      policyName: v('policy_name'),
      affectedEntity: v('affected_entity'),
      affectedEntityType: v('affected_entity_type'),
      impactType: v('impact_type'),
      direction: v('direction'),
      severity: v('severity'),
      confidence: parseFloat(v('confidence') || '0'),
      evidenceText: v('evidence_text'),
      quantitativeValue: v('quantitative_value'),
      timeframe: v('timeframe'),
      sourceDocument: v('source_document'),
      sourceChunk: v('source_chunk'),
      createdAt: v('created_at'),
    };
  });
}

/**
 * Get all impacts affecting a specific entity
 * Supports filtering by type, severity, timeframe, and policy
 */
async function getImpactsForEntity(entityName, filters = {}, context = null) {
  try {
    // First, find the entity using semantic search
    const entities = await lookupEntity(entityName, filters.entityType || null, context);
    if (entities.length === 0) {
      if (context) context.log(`No entity found for: ${entityName}`);
      return [];
    }
    
    // Use the first (best match) entity
    const targetEntity = entities[0];
    const entityId = targetEntity.id || targetEntity.canonical_name || entityName;
    
    // Build Gremlin query to get impacts via 'affects' edge
    let query = `
      g.V('${escapeGremlin(entityId)}')
        .inE('affects')
        .outV()
        .hasLabel('impact')
    `;
    
    // Apply filters
    if (filters.impactType) {
      query += `.has('impact_type', '${escapeGremlin(filters.impactType)}')`;
    }
    
    if (filters.severity) {
      query += `.has('severity', '${escapeGremlin(filters.severity)}')`;
    }
    
    if (filters.policyId) {
      query += `.has('policy_id', '${escapeGremlin(filters.policyId)}')`;
    }
    
    if (filters.direction) {
      query += `.has('direction', '${escapeGremlin(filters.direction)}')`;
    }
    
    // Get valueMap for all properties
    query += `.valueMap(true)`;
    
    // Apply limit
    const limit = filters.limit || 100;
    query += `.limit(${limit})`;
    
    const result = await cosmosClient.submit(query);
    const impacts = formatImpacts(result._items || []);
    
    // Apply timeframe filter in JavaScript (more flexible)
    if (filters.timeframe) {
      // Simple timeframe matching (e.g., "2024-2025", "2024")
      const timeframePattern = new RegExp(filters.timeframe.replace(/\*/g, '.*'), 'i');
      return impacts.filter(impact => 
        !impact.timeframe || timeframePattern.test(impact.timeframe)
      );
    }
    
    // Apply date range filter if provided
    if (filters.timeframeFrom || filters.timeframeTo) {
      return impacts.filter(impact => {
        if (!impact.timeframe) return false;
        
        // Extract year from timeframe (e.g., "2024-2025" -> 2024)
        const yearMatch = impact.timeframe.match(/\b(20\d{2})\b/);
        if (!yearMatch) return true; // Include if can't parse
        
        const year = parseInt(yearMatch[1], 10);
        const fromYear = filters.timeframeFrom ? parseInt(filters.timeframeFrom, 10) : 0;
        const toYear = filters.timeframeTo ? parseInt(filters.timeframeTo, 10) : 9999;
        
        return year >= fromYear && year <= toYear;
      });
    }
    
    return impacts;
  } catch (error) {
    if (context) context.log.error(`Failed to get impacts for entity ${entityName}:`, error);
    return [];
  }
}

/**
 * Get all impacts from a specific policy
 */
async function getImpactsByPolicy(policyId, filters = {}, context = null) {
  try {
    let query = `
      g.V()
        .hasLabel('impact')
        .has('policy_id', '${escapeGremlin(policyId)}')
    `;
    
    // Apply filters
    if (filters.impactType) {
      query += `.has('impact_type', '${escapeGremlin(filters.impactType)}')`;
    }
    
    if (filters.severity) {
      query += `.has('severity', '${escapeGremlin(filters.severity)}')`;
    }
    
    query += `.valueMap(true)`;
    
    const limit = filters.limit || 100;
    query += `.limit(${limit})`;
    
    const result = await cosmosClient.submit(query);
    return formatImpacts(result._items || []);
  } catch (error) {
    if (context) context.log.error(`Failed to get impacts for policy ${policyId}:`, error);
    return [];
  }
}

/**
 * Aggregate impacts from multiple policies affecting the same entity
 * Combines quantitative values, identifies conflicts, calculates totals
 */
async function aggregateImpactsForEntity(entityName, policyIds = null, context = null) {
  try {
    // Get all impacts for entity
    const filters = policyIds ? { policyId: { $in: policyIds } } : {};
    const allImpacts = await getImpactsForEntity(entityName, { limit: 1000 }, context);
    
    // Filter by specific policies if provided
    let impacts = allImpacts;
    if (policyIds && Array.isArray(policyIds)) {
      impacts = allImpacts.filter(imp => policyIds.includes(imp.policyId));
    }
    
    if (impacts.length === 0) {
      return {
        entity: entityName,
        totalImpacts: 0,
        policies: 0,
        aggregatedByType: {},
        conflicts: [],
        quantitativeSummary: {}
      };
    }
    
    // Group by policy
    const byPolicy = {};
    impacts.forEach(impact => {
      if (!byPolicy[impact.policyId]) {
        byPolicy[impact.policyId] = [];
      }
      byPolicy[impact.policyId].push(impact);
    });
    
    // Group by impact type
    const byType = {};
    impacts.forEach(impact => {
      if (!byType[impact.impactType]) {
        byType[impact.impactType] = [];
      }
      byType[impact.impactType].push(impact);
    });
    
    // Aggregate by type
    const aggregatedByType = {};
    Object.keys(byType).forEach(type => {
      const typeImpacts = byType[type];
      const increases = typeImpacts.filter(i => i.direction === 'increase').length;
      const decreases = typeImpacts.filter(i => i.direction === 'decrease').length;
      const constraints = typeImpacts.filter(i => i.direction === 'constraint').length;
      const enables = typeImpacts.filter(i => i.direction === 'enable').length;
      
      aggregatedByType[type] = {
        total: typeImpacts.length,
        increases,
        decreases,
        constraints,
        enables,
        highSeverity: typeImpacts.filter(i => i.severity === 'high').length,
        mediumSeverity: typeImpacts.filter(i => i.severity === 'medium').length,
        lowSeverity: typeImpacts.filter(i => i.severity === 'low').length
      };
    });
    
    // Aggregate quantitative values
    const quantitativeSummary = aggregateQuantitativeValues(impacts);
    
    // Identify conflicts (same type, opposite directions)
    const conflicts = findImpactConflicts(impacts);
    
    return {
      entity: entityName,
      totalImpacts: impacts.length,
      policies: Object.keys(byPolicy).length,
      policyBreakdown: Object.keys(byPolicy).map(policyId => ({
        policyId,
        policyName: byPolicy[policyId][0]?.policyName || policyId,
        impactCount: byPolicy[policyId].length,
        impacts: byPolicy[policyId]
      })),
      aggregatedByType,
      conflicts,
      quantitativeSummary,
      bySeverity: {
        high: impacts.filter(i => i.severity === 'high').length,
        medium: impacts.filter(i => i.severity === 'medium').length,
        low: impacts.filter(i => i.severity === 'low').length
      }
    };
  } catch (error) {
    if (context) context.log.error(`Failed to aggregate impacts for ${entityName}:`, error);
    return {
      entity: entityName,
      totalImpacts: 0,
      policies: 0,
      aggregatedByType: {},
      conflicts: [],
      quantitativeSummary: {},
      error: error.message
    };
  }
}

/**
 * Aggregate quantitative values from impacts
 */
function aggregateQuantitativeValues(impacts) {
  const summary = {
    totalFunding: 0,
    totalJobs: 0,
    fundingValues: [],
    jobValues: [],
    percentages: []
  };
  
  impacts.forEach(impact => {
    if (!impact.quantitativeValue) return;
    
    const value = impact.quantitativeValue;
    
    // Extract dollar amounts
    const dollarMatch = value.match(/\$[\d,]+(?:\.\d+)?\s*(?:million|billion|M|B|k|thousand)?/i);
    if (dollarMatch) {
      let amount = parseFloat(dollarMatch[0].replace(/[$,]/g, ''));
      const multiplier = dollarMatch[0].toLowerCase();
      if (multiplier.includes('billion') || multiplier.includes('b')) amount *= 1000000000;
      else if (multiplier.includes('million') || multiplier.includes('m')) amount *= 1000000;
      else if (multiplier.includes('thousand') || multiplier.includes('k')) amount *= 1000;
      
      if (impact.direction === 'increase') {
        summary.totalFunding += amount;
      } else if (impact.direction === 'decrease') {
        summary.totalFunding -= amount;
      }
      summary.fundingValues.push({ impact: impact.id, value: amount, direction: impact.direction });
    }
    
    // Extract job counts
    const jobMatch = value.match(/(\d+(?:,\d+)?)\s*(?:jobs?|positions?|workers?|employees?)/i);
    if (jobMatch) {
      const jobs = parseInt(jobMatch[1].replace(/,/g, ''), 10);
      if (impact.direction === 'increase') {
        summary.totalJobs += jobs;
      } else if (impact.direction === 'decrease') {
        summary.totalJobs -= jobs;
      }
      summary.jobValues.push({ impact: impact.id, value: jobs, direction: impact.direction });
    }
    
    // Extract percentages
    const percentMatch = value.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      summary.percentages.push({ impact: impact.id, value: parseFloat(percentMatch[1]) });
    }
  });
  
  return summary;
}

/**
 * Find conflicting impacts (same type, opposite directions)
 */
function findImpactConflicts(impacts) {
  const conflicts = [];
  const byType = {};
  
  // Group by impact type and affected entity
  impacts.forEach(impact => {
    const key = `${impact.impactType}_${impact.affectedEntity}`;
    if (!byType[key]) {
      byType[key] = [];
    }
    byType[key].push(impact);
  });
  
  // Find conflicts (same type, different directions)
  Object.keys(byType).forEach(key => {
    const typeImpacts = byType[key];
    if (typeImpacts.length < 2) return;
    
    const hasIncrease = typeImpacts.some(i => i.direction === 'increase');
    const hasDecrease = typeImpacts.some(i => i.direction === 'decrease');
    const hasConstraint = typeImpacts.some(i => i.direction === 'constraint');
    const hasEnable = typeImpacts.some(i => i.direction === 'enable');
    
    // Conflict: increase + decrease
    if (hasIncrease && hasDecrease) {
      conflicts.push({
        type: 'increase_vs_decrease',
        impactType: typeImpacts[0].impactType,
        affectedEntity: typeImpacts[0].affectedEntity,
        increases: typeImpacts.filter(i => i.direction === 'increase'),
        decreases: typeImpacts.filter(i => i.direction === 'decrease'),
        severity: 'high'
      });
    }
    
    // Conflict: constraint + enable
    if (hasConstraint && hasEnable) {
      conflicts.push({
        type: 'constraint_vs_enable',
        impactType: typeImpacts[0].impactType,
        affectedEntity: typeImpacts[0].affectedEntity,
        constraints: typeImpacts.filter(i => i.direction === 'constraint'),
        enables: typeImpacts.filter(i => i.direction === 'enable'),
        severity: 'medium'
      });
    }
  });
  
  return conflicts;
}

/**
 * Analyze temporal trends of impacts
 */
async function analyzeImpactTrends(entityName, timeframe = null, context = null) {
  try {
    const impacts = await getImpactsForEntity(entityName, { limit: 1000 }, context);
    
    // Group by timeframe
    const byTimeframe = {};
    impacts.forEach(impact => {
      const timeKey = impact.timeframe || 'unknown';
      if (!byTimeframe[timeKey]) {
        byTimeframe[timeKey] = [];
      }
      byTimeframe[timeKey].push(impact);
    });
    
    // Group by impact type over time
    const trendsByType = {};
    Object.keys(byTimeframe).forEach(timeframe => {
      const timeImpacts = byTimeframe[timeframe];
      timeImpacts.forEach(impact => {
        if (!trendsByType[impact.impactType]) {
          trendsByType[impact.impactType] = {};
        }
        if (!trendsByType[impact.impactType][timeframe]) {
          trendsByType[impact.impactType][timeframe] = {
            total: 0,
            increases: 0,
            decreases: 0,
            highSeverity: 0
          };
        }
        trendsByType[impact.impactType][timeframe].total++;
        if (impact.direction === 'increase') trendsByType[impact.impactType][timeframe].increases++;
        if (impact.direction === 'decrease') trendsByType[impact.impactType][timeframe].decreases++;
        if (impact.severity === 'high') trendsByType[impact.impactType][timeframe].highSeverity++;
      });
    });
    
    // Calculate trends (increasing/decreasing)
    const trends = {};
    Object.keys(trendsByType).forEach(type => {
      const timeframes = Object.keys(trendsByType[type]).sort();
      if (timeframes.length >= 2) {
        const first = trendsByType[type][timeframes[0]].total;
        const last = trendsByType[type][timeframes[timeframes.length - 1]].total;
        trends[type] = {
          direction: last > first ? 'increasing' : last < first ? 'decreasing' : 'stable',
          change: last - first,
          changePercent: first > 0 ? ((last - first) / first * 100).toFixed(1) : 0
        };
      }
    });
    
    return {
      entity: entityName,
      totalImpacts: impacts.length,
      byTimeframe,
      trendsByType,
      trends,
      timeframes: Object.keys(byTimeframe).sort()
    };
  } catch (error) {
    if (context) context.log.error(`Failed to analyze trends for ${entityName}:`, error);
    return {
      entity: entityName,
      totalImpacts: 0,
      byTimeframe: {},
      trendsByType: {},
      trends: {},
      error: error.message
    };
  }
}

/**
 * Extrapolate trend using linear regression
 */
function extrapolateTrend(historicalData, periods) {
  const timeframes = Object.keys(historicalData).sort();
  if (timeframes.length < 2) {
    return { forecast: [], confidence: 0 };
  }
  
  // Convert timeframes to numeric (extract year)
  const dataPoints = timeframes.map((tf, idx) => {
    const yearMatch = tf.match(/\b(20\d{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : idx;
    const value = historicalData[tf].total || 0;
    return { year, value, timeframe: tf };
  });
  
  // Linear regression
  const n = dataPoints.length;
  const sumX = dataPoints.reduce((sum, p) => sum + p.year, 0);
  const sumY = dataPoints.reduce((sum, p) => sum + p.value, 0);
  const sumXY = dataPoints.reduce((sum, p) => sum + p.year * p.value, 0);
  const sumX2 = dataPoints.reduce((sum, p) => sum + p.year * p.year, 0);
  
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return { forecast: [], confidence: 0 };
  }
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  
  // Calculate R-squared for confidence
  const meanY = sumY / n;
  const ssRes = dataPoints.reduce((sum, p) => {
    const predicted = slope * p.year + intercept;
    return sum + Math.pow(p.value - predicted, 2);
  }, 0);
  const ssTot = dataPoints.reduce((sum, p) => sum + Math.pow(p.value - meanY, 2), 0);
  const rSquared = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
  const confidence = Math.max(0, Math.min(1, rSquared));
  
  // Forecast future periods
  const lastYear = dataPoints[dataPoints.length - 1].year;
  const forecasts = [];
  for (let i = 1; i <= periods; i++) {
    const forecastYear = lastYear + i;
    const forecastValue = Math.max(0, slope * forecastYear + intercept);
    const forecastTimeframe = `${forecastYear}-${forecastYear + 1}`;
    
    // Calculate confidence interval (simplified, guard n=2 division by zero)
    const stdError = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
    const margin = stdError * 1.96; // 95% confidence
    
    forecasts.push({
      timeframe: forecastTimeframe,
      year: forecastYear,
      forecast: Math.round(forecastValue),
      lowerBound: Math.max(0, Math.round(forecastValue - margin)),
      upperBound: Math.round(forecastValue + margin),
      confidence: Math.max(0.3, confidence - (i * 0.05)) // Decrease confidence over time
    });
  }
  
  return { forecast: forecasts, confidence, slope, intercept };
}

/**
 * Forecast future impacts based on historical trends
 */
async function forecastImpacts(entityName, forecastPeriods = 12, context = null) {
  try {
    // Get historical trends
    const trends = await analyzeImpactTrends(entityName, null, context);
    
    if (trends.totalImpacts === 0) {
      return {
        entity: entityName,
        historical: trends,
        forecasts: {},
        confidence: 0,
        error: 'Insufficient historical data for forecasting'
      };
    }
    
    // Forecast for each impact type
    const forecasts = {};
    Object.keys(trends.trendsByType).forEach(type => {
      const historical = trends.trendsByType[type];
      const forecast = extrapolateTrend(historical, forecastPeriods);
      forecasts[type] = forecast;
    });
    
    // Calculate overall confidence (average of all types)
    const confidences = Object.values(forecasts).map(f => f.confidence || 0);
    const overallConfidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;
    
    return {
      entity: entityName,
      historical: trends,
      forecasts,
      confidence: overallConfidence,
      forecastPeriods,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    if (context) context.log.error(`Failed to forecast impacts for ${entityName}:`, error);
    return {
      entity: entityName,
      historical: null,
      forecasts: {},
      confidence: 0,
      error: error.message
    };
  }
}

/**
 * Apply percentage change to quantitative value
 */
function applyChangeToValue(quantitativeValue, changePercent) {
  if (!quantitativeValue) return quantitativeValue;
  
  // Extract numeric value
  const dollarMatch = quantitativeValue.match(/\$[\d,]+(?:\.\d+)?\s*(?:million|billion|M|B|k|thousand)?/i);
  if (dollarMatch) {
    let amount = parseFloat(dollarMatch[0].replace(/[$,]/g, ''));
    const multiplier = dollarMatch[0].toLowerCase();
    if (multiplier.includes('billion') || multiplier.includes('b')) amount *= 1000000000;
    else if (multiplier.includes('million') || multiplier.includes('m')) amount *= 1000000;
    else if (multiplier.includes('thousand') || multiplier.includes('k')) amount *= 1000;
    
    const newAmount = amount * (1 + changePercent / 100);
    
    // Format back
    if (newAmount >= 1000000000) {
      return `$${(newAmount / 1000000000).toFixed(2)} billion`;
    } else if (newAmount >= 1000000) {
      return `$${(newAmount / 1000000).toFixed(2)} million`;
    } else if (newAmount >= 1000) {
      return `$${(newAmount / 1000).toFixed(2)} thousand`;
    } else {
      return `$${newAmount.toFixed(2)}`;
    }
  }
  
  const jobMatch = quantitativeValue.match(/(\d+(?:,\d+)?)\s*(?:jobs?|positions?|workers?|employees?)/i);
  if (jobMatch) {
    const jobs = parseInt(jobMatch[1].replace(/,/g, ''), 10);
    const newJobs = Math.max(0, Math.round(jobs * (1 + changePercent / 100)));
    return `${newJobs.toLocaleString()} jobs`;
  }
  
  const percentMatch = quantitativeValue.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) {
    const percent = parseFloat(percentMatch[1]);
    const newPercent = percent * (1 + changePercent / 100);
    return `${newPercent.toFixed(1)}%`;
  }
  
  return quantitativeValue;
}

/**
 * Adjust severity based on change
 */
function adjustSeverity(severity, changePercent) {
  if (changePercent > 20) {
    // Large increase -> higher severity
    if (severity === 'low') return 'medium';
    if (severity === 'medium') return 'high';
    return 'high';
  } else if (changePercent < -20) {
    // Large decrease -> may reduce severity for negative impacts
    return severity; // Keep same for now
  }
  return severity;
}

/**
 * Simulate impact scenario (what-if analysis)
 */
async function simulateImpactScenario(scenario, context = null) {
  try {
    const { entity, policy, changePercent, affectedSectors } = scenario;
    
    // Get current impacts
    const filters = policy ? { policyId: policy } : {};
    const currentImpacts = await getImpactsForEntity(entity, filters, context);
    
    if (currentImpacts.length === 0) {
      return {
        scenario,
        current: [],
        simulated: [],
        comparison: null,
        error: 'No current impacts found for scenario'
      };
    }
    
    // Filter by sectors if specified
    let impactsToSimulate = currentImpacts;
    if (affectedSectors && affectedSectors.length > 0) {
      impactsToSimulate = currentImpacts.filter(impact => {
        // Check if impact affects specified sectors
        return affectedSectors.some(sector => 
          impact.affectedEntity.toLowerCase().includes(sector.toLowerCase()) ||
          impact.affectedEntityType?.toLowerCase().includes(sector.toLowerCase())
        );
      });
    }
    
    // Apply scenario changes (statistical, no API)
    const simulatedImpacts = impactsToSimulate.map(impact => ({
      ...impact,
      quantitativeValue: applyChangeToValue(impact.quantitativeValue, changePercent),
      severity: adjustSeverity(impact.severity, changePercent),
      scenarioApplied: true,
      originalValue: impact.quantitativeValue,
      changePercent
    }));
    
    // Aggregate current impacts
    const currentAggregation = await aggregateImpactsForEntity(entity, policy ? [policy] : null, context);
    
    // Aggregate simulated impacts (manually, since we modified them)
    const simulatedAggregation = {
      entity,
      totalImpacts: simulatedImpacts.length,
      policies: currentAggregation.policies,
      aggregatedByType: {},
      conflicts: [],
      quantitativeSummary: aggregateQuantitativeValues(simulatedImpacts),
      bySeverity: {
        high: simulatedImpacts.filter(i => i.severity === 'high').length,
        medium: simulatedImpacts.filter(i => i.severity === 'medium').length,
        low: simulatedImpacts.filter(i => i.severity === 'low').length
      }
    };
    
    // Group by type for simulated
    const byType = {};
    simulatedImpacts.forEach(impact => {
      if (!byType[impact.impactType]) {
        byType[impact.impactType] = [];
      }
      byType[impact.impactType].push(impact);
    });
    
    Object.keys(byType).forEach(type => {
      const typeImpacts = byType[type];
      simulatedAggregation.aggregatedByType[type] = {
        total: typeImpacts.length,
        increases: typeImpacts.filter(i => i.direction === 'increase').length,
        decreases: typeImpacts.filter(i => i.direction === 'decrease').length,
        constraints: typeImpacts.filter(i => i.direction === 'constraint').length,
        enables: typeImpacts.filter(i => i.direction === 'enable').length,
        highSeverity: typeImpacts.filter(i => i.severity === 'high').length,
        mediumSeverity: typeImpacts.filter(i => i.severity === 'medium').length,
        lowSeverity: typeImpacts.filter(i => i.severity === 'low').length
      };
    });
    
    // Compare current vs simulated
    const comparison = {
      totalImpacts: {
        current: currentAggregation.totalImpacts,
        simulated: simulatedAggregation.totalImpacts,
        change: simulatedAggregation.totalImpacts - currentAggregation.totalImpacts
      },
      quantitative: {
        funding: {
          current: currentAggregation.quantitativeSummary.totalFunding,
          simulated: simulatedAggregation.quantitativeSummary.totalFunding,
          change: simulatedAggregation.quantitativeSummary.totalFunding - currentAggregation.quantitativeSummary.totalFunding,
          changePercent: currentAggregation.quantitativeSummary.totalFunding > 0
            ? ((simulatedAggregation.quantitativeSummary.totalFunding - currentAggregation.quantitativeSummary.totalFunding) / Math.abs(currentAggregation.quantitativeSummary.totalFunding) * 100).toFixed(1)
            : '0'
        },
        jobs: {
          current: currentAggregation.quantitativeSummary.totalJobs,
          simulated: simulatedAggregation.quantitativeSummary.totalJobs,
          change: simulatedAggregation.quantitativeSummary.totalJobs - currentAggregation.quantitativeSummary.totalJobs,
          changePercent: currentAggregation.quantitativeSummary.totalJobs > 0
            ? ((simulatedAggregation.quantitativeSummary.totalJobs - currentAggregation.quantitativeSummary.totalJobs) / Math.abs(currentAggregation.quantitativeSummary.totalJobs) * 100).toFixed(1)
            : '0'
        }
      },
      bySeverity: {
        high: {
          current: currentAggregation.bySeverity.high,
          simulated: simulatedAggregation.bySeverity.high,
          change: simulatedAggregation.bySeverity.high - currentAggregation.bySeverity.high
        },
        medium: {
          current: currentAggregation.bySeverity.medium,
          simulated: simulatedAggregation.bySeverity.medium,
          change: simulatedAggregation.bySeverity.medium - currentAggregation.bySeverity.medium
        },
        low: {
          current: currentAggregation.bySeverity.low,
          simulated: simulatedAggregation.bySeverity.low,
          change: simulatedAggregation.bySeverity.low - currentAggregation.bySeverity.low
        }
      }
    };
    
    // Generate recommendations
    const recommendations = [];
    if (comparison.quantitative.jobs.change < 0) {
      recommendations.push({
        type: 'job_loss',
        severity: 'high',
        message: `Scenario would result in ${Math.abs(comparison.quantitative.jobs.change).toLocaleString()} job losses`,
        action: 'Consider mitigation strategies or alternative policy approaches'
      });
    }
    if (comparison.bySeverity.high.change > 0) {
      recommendations.push({
        type: 'severity_increase',
        severity: 'high',
        message: `High-severity impacts would increase by ${comparison.bySeverity.high.change}`,
        action: 'Review high-severity impacts and develop response plans'
      });
    }
    if (simulatedAggregation.conflicts.length > currentAggregation.conflicts.length) {
      recommendations.push({
        type: 'conflict_increase',
        severity: 'medium',
        message: 'Scenario would increase policy conflicts',
        action: 'Coordinate policies to reduce contradictions'
      });
    }
    
    return {
      scenario,
      current: currentImpacts,
      simulated: simulatedImpacts,
      currentAggregation,
      simulatedAggregation,
      comparison,
      recommendations,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    if (context) context.log.error(`Failed to simulate scenario:`, error);
    return {
      scenario,
      current: [],
      simulated: [],
      comparison: null,
      error: error.message
    };
  }
}

/**
 * Compare impacts across multiple entities
 */
async function compareImpacts(entityNames, impactType = null, context = null) {
  try {
    const comparisons = [];
    
    for (const entityName of entityNames) {
      const filters = impactType ? { impactType } : {};
      const impacts = await getImpactsForEntity(entityName, filters, context);
      
      const summary = {
        entity: entityName,
        totalImpacts: impacts.length,
        byType: {},
        bySeverity: {
          high: 0,
          medium: 0,
          low: 0
        },
        byDirection: {
          increase: 0,
          decrease: 0,
          constraint: 0,
          enable: 0
        },
        quantitativeSummary: aggregateQuantitativeValues(impacts)
      };
      
      impacts.forEach(impact => {
        if (!summary.byType[impact.impactType]) {
          summary.byType[impact.impactType] = 0;
        }
        summary.byType[impact.impactType]++;
        summary.bySeverity[impact.severity]++;
        summary.byDirection[impact.direction]++;
      });
      
      comparisons.push(summary);
    }
    
    return {
      entities: entityNames,
        impactType,
        comparisons,
        differences: calculateImpactDifferences(comparisons)
    };
  } catch (error) {
    if (context) context.log.error(`Failed to compare impacts:`, error);
    return {
      entities: entityNames,
      comparisons: [],
      error: error.message
    };
  }
}

/**
 * Calculate differences between entity impact summaries
 */
function calculateImpactDifferences(comparisons) {
  if (comparisons.length < 2) return {};
  
  const differences = {};
  const entity1 = comparisons[0];
  const entity2 = comparisons[1];
  
  // Compare totals
  differences.totalImpacts = entity2.totalImpacts - entity1.totalImpacts;
  
  // Compare by type
  differences.byType = {};
  const allTypes = new Set([...Object.keys(entity1.byType), ...Object.keys(entity2.byType)]);
  allTypes.forEach(type => {
    const count1 = entity1.byType[type] || 0;
    const count2 = entity2.byType[type] || 0;
    differences.byType[type] = count2 - count1;
  });
  
  // Compare quantitative
  differences.quantitative = {
    funding: entity2.quantitativeSummary.totalFunding - entity1.quantitativeSummary.totalFunding,
    jobs: entity2.quantitativeSummary.totalJobs - entity1.quantitativeSummary.totalJobs
  };
  
  return differences;
}

/**
 * Analyze impact propagation (multi-hop indirect effects)
 */
async function analyzeImpactPropagation(policyName, maxHops = 2, context = null) {
  try {
    // Find policy entity
    const policies = await lookupEntity(policyName, 'policy', context);
    if (policies.length === 0) {
      return {
        policy: policyName,
        directImpacts: [],
        indirectImpacts: [],
        propagationTree: {},
        error: 'Policy not found'
      };
    }
    
    const policyId = policies[0].id || policies[0].canonical_name;
    
    // Get direct impacts (policy -> impact -> entity)
    const directImpactsQuery = `
      g.V('${escapeGremlin(policyId)}')
        .outE('has_impact')
        .inV()
        .hasLabel('impact')
        .outE('affects')
        .inV()
        .valueMap(true)
    `;
    const directResult = await cosmosClient.submit(directImpactsQuery);
    const directImpacts = formatVertices(directResult._items || []);
    
    // Get indirect impacts (policy -> impact -> entity -> related entity)
    const indirectImpacts = [];
    const propagationTree = {
      policy: policyName,
      direct: [],
      indirect: {}
    };
    
    // Populate the direct array in propagation tree
    for (const entity of directImpacts) {
      propagationTree.direct.push({
        entity: entity.name || entity.id || entity.canonical_name,
        entityType: entity.entity_type || 'unknown'
      });
    }

    // For each directly affected entity, find related entities
    for (const entity of directImpacts.slice(0, 10)) { // Limit to avoid explosion
      const entityId = entity.id || entity.canonical_name;
      
      // Find entities related to this one (via relationships)
      const relatedQuery = `
        g.V('${escapeGremlin(entityId)}')
          .bothE()
          .otherV()
          .has('entity_type')
          .valueMap(true)
          .limit(5)
      `;
      const relatedResult = await cosmosClient.submit(relatedQuery);
      const relatedEntities = formatVertices(relatedResult._items || []);
      
      // Get impacts on related entities
      for (const relatedEntity of relatedEntities) {
        const relatedId = relatedEntity.id || relatedEntity.canonical_name;
        const relatedImpacts = await getImpactsForEntity(relatedId, { limit: 10 }, context);
        
        if (relatedImpacts.length > 0) {
          indirectImpacts.push({
            sourceEntity: entity.name || entityId,
            targetEntity: relatedEntity.name || relatedId,
            impacts: relatedImpacts
          });
          
          if (!propagationTree.indirect[entityId]) {
            propagationTree.indirect[entityId] = [];
          }
          propagationTree.indirect[entityId].push({
            entity: relatedEntity.name || relatedId,
            impactCount: relatedImpacts.length
          });
        }
      }
    }
    
    return {
      policy: policyName,
      directImpacts: directImpacts.map(e => ({
        entity: e.name || e.id,
        entityType: e.entity_type
      })),
      indirectImpacts,
      propagationTree,
      totalDirectEntities: directImpacts.length,
      totalIndirectEntities: indirectImpacts.length
    };
  } catch (error) {
    if (context) context.log.error(`Failed to analyze propagation for ${policyName}:`, error);
    return {
      policy: policyName,
      directImpacts: [],
      indirectImpacts: [],
      propagationTree: {},
      error: error.message
    };
  }
}

/**
 * Generate comprehensive impact report for an entity
 */
async function generateImpactReport(entityName, options = {}, context = null) {
  try {
    const { includeTrends = true, includeComparison = false, compareWith = [] } = options;
    
    // Get aggregated impacts
    const aggregation = await aggregateImpactsForEntity(entityName, null, context);
    
    // Get all impacts for detailed breakdown
    const allImpacts = await getImpactsForEntity(entityName, { limit: 1000 }, context);
    
    // Executive summary
    const executiveSummary = {
      entity: entityName,
      totalImpacts: aggregation.totalImpacts,
      policiesAffecting: aggregation.policies,
      highSeverityCount: aggregation.bySeverity.high,
      criticalFindings: []
    };
    
    // Identify critical findings
    if (aggregation.conflicts.length > 0) {
      executiveSummary.criticalFindings.push({
        type: 'conflicts',
        count: aggregation.conflicts.length,
        description: `${aggregation.conflicts.length} conflicting impacts detected`
      });
    }
    
    if (aggregation.bySeverity.high > 0) {
      executiveSummary.criticalFindings.push({
        type: 'high_severity',
        count: aggregation.bySeverity.high,
        description: `${aggregation.bySeverity.high} high-severity impacts`
      });
    }
    
    // Impact breakdown by type
    const breakdownByType = Object.keys(aggregation.aggregatedByType).map(type => ({
      type,
      ...aggregation.aggregatedByType[type],
      percentage: ((aggregation.aggregatedByType[type].total / aggregation.totalImpacts) * 100).toFixed(1)
    }));
    
    // Policy-by-policy analysis
    const policyAnalysis = aggregation.policyBreakdown || [];
    
    // Quantitative summary
    const quantitativeSummary = aggregation.quantitativeSummary;
    
    // Temporal trends (if requested)
    let trends = null;
    if (includeTrends) {
      trends = await analyzeImpactTrends(entityName, null, context);
    }
    
    // Comparison (if requested)
    let comparison = null;
    if (includeComparison && compareWith.length > 0) {
      comparison = await compareImpacts([entityName, ...compareWith], null, context);
    }
    
    // Recommendations
    const recommendations = generateRecommendations(aggregation, allImpacts);
    
    return {
      executiveSummary,
      impactBreakdown: {
        byType: breakdownByType,
        bySeverity: aggregation.bySeverity,
        byDirection: {
          increases: allImpacts.filter(i => i.direction === 'increase').length,
          decreases: allImpacts.filter(i => i.direction === 'decrease').length,
          constraints: allImpacts.filter(i => i.direction === 'constraint').length,
          enables: allImpacts.filter(i => i.direction === 'enable').length
        }
      },
      policyAnalysis,
      quantitativeSummary,
      conflicts: aggregation.conflicts,
      trends,
      comparison,
      recommendations,
      detailedImpacts: allImpacts.slice(0, 50), // Limit for response size
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    if (context) context.log.error(`Failed to generate report for ${entityName}:`, error);
    return {
      entity: entityName,
      error: error.message,
      generatedAt: new Date().toISOString()
    };
  }
}

/**
 * Generate recommendations based on impact analysis
 */
function generateRecommendations(aggregation, allImpacts) {
  const recommendations = [];
  
  // Conflict recommendations
  if (aggregation.conflicts.length > 0) {
    recommendations.push({
      type: 'conflict_resolution',
      priority: 'high',
      message: `Review ${aggregation.conflicts.length} conflicting impacts. Consider policy coordination to resolve contradictions.`,
      affectedTypes: aggregation.conflicts.map(c => c.impactType)
    });
  }
  
  // High severity recommendations
  if (aggregation.bySeverity.high > 0) {
    recommendations.push({
      type: 'high_severity_review',
      priority: 'high',
      message: `${aggregation.bySeverity.high} high-severity impacts require immediate attention.`,
      count: aggregation.bySeverity.high
    });
  }
  
  // Quantitative recommendations
  if (aggregation.quantitativeSummary.totalFunding !== 0) {
    const fundingDirection = aggregation.quantitativeSummary.totalFunding > 0 ? 'increase' : 'decrease';
    recommendations.push({
      type: 'funding_impact',
      priority: 'medium',
      message: `Net funding ${fundingDirection}: $${Math.abs(aggregation.quantitativeSummary.totalFunding).toLocaleString()}`,
      value: aggregation.quantitativeSummary.totalFunding
    });
  }
  
  if (aggregation.quantitativeSummary.totalJobs !== 0) {
    const jobDirection = aggregation.quantitativeSummary.totalJobs > 0 ? 'increase' : 'decrease';
    recommendations.push({
      type: 'workforce_impact',
      priority: 'medium',
      message: `Net workforce ${jobDirection}: ${Math.abs(aggregation.quantitativeSummary.totalJobs).toLocaleString()} jobs`,
      value: aggregation.quantitativeSummary.totalJobs
    });
  }
  
  // Policy coordination recommendation
  if (aggregation.policies > 1) {
    recommendations.push({
      type: 'policy_coordination',
      priority: 'low',
      message: `Entity affected by ${aggregation.policies} policies. Consider cross-policy impact assessment.`,
      policyCount: aggregation.policies
    });
  }
  
  return recommendations;
}

// ==================== NEO4J FUNCTIONS ====================

async function executeNeo4jQuery(context, params) {
  const driver = getNeo4jDriver();
  if (!driver) {
    throw new Error('Neo4j not configured');
  }

  const session = driver.session();
  try {
    const { action, entityName, query, depth = 3, limit = 20 } = params;

    switch (action) {
      case 'lookup':
        return await neo4jLookup(session, entityName, limit);
      case 'search':
        return await neo4jSearch(session, query, limit);
      case 'traverse':
        return await neo4jTraverse(session, entityName, depth, limit);
      case 'path':
        return await neo4jShortestPath(session, params.fromEntity, params.toEntity);
      case 'analytics':
        return await neo4jAnalytics(session, params.analyticsType, limit);
      case 'create_entity':
        return await neo4jCreateEntity(session, entityName, params.entityType, params.canonicalName, params.properties);
      case 'create_relationship':
        return await neo4jCreateRelationship(session, params.fromCanonical, params.toCanonical, params.relationType, params.properties);
      default:
        throw new Error(`Unknown Neo4j action: ${action}`);
    }
  } finally {
    await session.close();
  }
}

async function neo4jLookup(session, entityName, limit) {
  const result = await session.run(
    `MATCH (n) WHERE n.name CONTAINS $name OR n.canonical_name CONTAINS $name
     RETURN n LIMIT $limit`,
    { name: entityName, limit: neo4j.int(limit) }
  );
  return result.records.map(r => r.get('n').properties);
}

async function neo4jSearch(session, query, limit) {
  const result = await session.run(
    `MATCH (n) WHERE n.name CONTAINS $query OR n.canonical_name CONTAINS $query
     RETURN n LIMIT $limit`,
    { query: query, limit: neo4j.int(limit) }
  );
  return result.records.map(r => r.get('n').properties);
}

async function neo4jTraverse(session, entityName, depth, limit) {
  const result = await session.run(
    `MATCH path = (start)-[*1..${Math.min(depth, 5)}]-(connected)
     WHERE start.name CONTAINS $name OR start.canonical_name CONTAINS $name
     RETURN path LIMIT $limit`,
    { name: entityName, limit: neo4j.int(limit) }
  );
  return result.records.map(r => {
    const path = r.get('path');
    return {
      nodes: path.segments.map(s => s.start.properties).concat([path.end.properties]),
      relationships: path.segments.map(s => ({ type: s.relationship.type, properties: s.relationship.properties }))
    };
  });
}

async function neo4jShortestPath(session, fromEntity, toEntity) {
  const result = await session.run(
    `MATCH (start), (end)
     WHERE (start.name CONTAINS $from OR start.canonical_name CONTAINS $from)
       AND (end.name CONTAINS $to OR end.canonical_name CONTAINS $to)
     MATCH path = shortestPath((start)-[*..10]-(end))
     RETURN path LIMIT 5`,
    { from: fromEntity, to: toEntity }
  );
  return result.records.map(r => {
    const path = r.get('path');
    return {
      nodes: path.segments.map(s => s.start.properties).concat([path.end.properties]),
      relationships: path.segments.map(s => ({ type: s.relationship.type })),
      length: path.length
    };
  });
}

async function neo4jCreateRelationship(session, fromCanonical, toCanonical, relationType, properties) {
  const result = await session.run(
    `MATCH (a:Entity {canonical_name: $from}), (b:Entity {canonical_name: $to})
     MERGE (a)-[r:${relationType || 'RELATED_TO'}]->(b)
     SET r += $properties
     RETURN r`,
    { 
      from: fromCanonical,
      to: toCanonical,
      properties: properties || {}
    }
  );
  return result.records.map(r => ({ type: relationType, from: fromCanonical, to: toCanonical }));
}

async function neo4jCreateEntity(session, entityName, entityType, canonicalName, properties) {
  const result = await session.run(
    `MERGE (n:Entity {canonical_name: $canonicalName})
     SET n.name = $name, n.entity_type = $entityType, n += $properties
     RETURN n`,
    { 
      canonicalName: canonicalName || entityName.toLowerCase().replace(/\s+/g, '_'),
      name: entityName,
      entityType: entityType || 'unknown',
      properties: properties || {}
    }
  );
  return result.records.map(r => r.get('n').properties);
}

/**
 * Get latest alerts from Azure Storage Table
 * @param {Object} filters - Optional filters: severity, entity, dateRange
 * @param {Object} context - Azure Function context for logging
 */
async function getLatestAlerts(filters = {}, context = null) {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    if (context) context.log.warn('AZURE_STORAGE_CONNECTION_STRING not configured');
    return {
      alerts: [],
      summary: {
        summary: 'Alert storage not configured',
        criticalCount: 0,
        totalCount: 0
      }
    };
  }
  
  const tableName = 'impactAlerts';
  const tableClient = TableClient.fromConnectionString(connectionString, tableName);
  
  try {
    // Get latest summary
    let summary = null;
    try {
      const summaryEntity = await tableClient.getEntity('summary', 'latest');
      summary = {
        summary: summaryEntity.summary || '',
        criticalCount: summaryEntity.criticalCount || 0,
        totalCount: summaryEntity.totalCount || 0,
        recommendations: summaryEntity.recommendations ? JSON.parse(summaryEntity.recommendations) : [],
        date: summaryEntity.date || new Date().toISOString().split('T')[0]
      };
    } catch (error) {
      if (context) context.log.warn('No summary found in alerts table');
      summary = {
        summary: 'No alerts available yet',
        criticalCount: 0,
        totalCount: 0,
        recommendations: []
      };
    }
    
    // Get alerts from latest date (today or most recent)
    const today = new Date().toISOString().split('T')[0];
    const dateToQuery = filters.dateRange?.from || today;
    
    // Build filter query
    let filterQuery = `PartitionKey eq '${dateToQuery}'`;
    
    if (filters.severity) {
      filterQuery += ` and severity eq '${filters.severity}'`;
    }
    
    if (filters.entity) {
      filterQuery += ` and entity eq '${filters.entity}'`;
    }
    
    // Query alerts
    const alerts = [];
    const entities = tableClient.listEntities({
      queryOptions: {
        filter: filterQuery
      }
    });
    
    for await (const entity of entities) {
      // Skip summary row
      if (entity.partitionKey === 'summary') continue;
      
      const alert = {
        type: entity.type,
        entity: entity.entity,
        entityType: entity.entityType || '',
        count: entity.count || 0,
        priority: entity.priority,
        severity: entity.severity,
        description: entity.description,
        impacts: entity.impacts ? JSON.parse(entity.impacts) : [],
        zScore: entity.zScore || null,
        createdAt: entity.createdAt,
        timestamp: entity.timestamp
      };
      
      alerts.push(alert);
    }
    
    // Sort by severity (high first) and timestamp (newest first)
    alerts.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
      if (severityDiff !== 0) return severityDiff;
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
    
    // Apply date range filter if specified
    let filteredAlerts = alerts;
    if (filters.dateRange?.to) {
      const toDate = new Date(filters.dateRange.to);
      filteredAlerts = alerts.filter(alert => {
        const alertDate = new Date(alert.createdAt);
        return alertDate <= toDate;
      });
    }
    
    return {
      alerts: filteredAlerts,
      summary: summary,
      date: dateToQuery,
      totalRetrieved: filteredAlerts.length
    };
  } catch (error) {
    if (context) context.log.error('Failed to retrieve alerts:', error);
    return {
      alerts: [],
      summary: {
        summary: 'Failed to retrieve alerts',
        criticalCount: 0,
        totalCount: 0
      },
      error: error.message
    };
  }
}

/**
 * Count entities, relationships, and impacts in the graph
 */
async function countGraphContents(context = null) {
  try {
    // Get Cosmos DB client (lazy initialization)
    const client = getCosmosClient();

    // Helper to extract count from Gremlin result
    const extractCount = (result) => {
      if (typeof result === 'number') return result;
      if (result?._items && Array.isArray(result._items)) {
        return result._items[0] ?? 0;
      }
      if (Array.isArray(result)) {
        return result[0] ?? 0;
      }
      return 0;
    };
    
    if (context) context.log('Starting graph count queries...');
    
    // Count entities (vertices are labeled by entity type, not 'entity', so use entity_type property)
    const entityQuery = `g.V().has('entity_type').count()`;
    if (context) context.log(`Executing query: ${entityQuery}`);
    const entityResult = await client.submit(entityQuery);
    const entityCount = extractCount(entityResult);
    if (context) context.log(`Entity count result: ${JSON.stringify(entityResult)}`);
    
    // Count relationships (edges)
    const edgeQuery = `g.E().count()`;
    if (context) context.log(`Executing query: ${edgeQuery}`);
    const edgeResult = await client.submit(edgeQuery);
    const edgeCount = extractCount(edgeResult);
    if (context) context.log(`Edge count result: ${JSON.stringify(edgeResult)}`);
    
    // Count impacts
    const impactQuery = `g.V().hasLabel('impact').count()`;
    if (context) context.log(`Executing query: ${impactQuery}`);
    const impactResult = await client.submit(impactQuery);
    const impactCount = extractCount(impactResult);
    if (context) context.log(`Impact count result: ${JSON.stringify(impactResult)}`);
    
    if (context) {
      context.log(`Graph counts: ${entityCount} entities, ${edgeCount} relationships, ${impactCount} impacts`);
    }
    
    return {
      count: entityCount,
      entities: entityCount,
      relationships: edgeCount,
      impacts: impactCount,
      total: entityCount + edgeCount + impactCount
    };
  } catch (error) {
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      name: error.name
    };
    if (context) {
      context.log.error('Failed to count graph contents:', JSON.stringify(errorDetails));
    }
    return {
      count: 0,
      entities: 0,
      relationships: 0,
      impacts: 0,
      total: 0,
      error: error.message,
      errorDetails: errorDetails
    };
  }
}

/**
 * Clear all entities, relationships, and impacts from the graph
 * WARNING: This is a destructive operation!
 */
async function clearGraph(context = null) {
  try {
    if (context) context.log.warn('CLEARING GRAPH - This will delete all data!');
    
    // Delete all edges first (to avoid orphaned edges)
    const deleteEdgesQuery = `g.E().drop()`;
    await cosmosClient.submit(deleteEdgesQuery);
    
    // Delete all vertices (entities and impacts)
    const deleteVerticesQuery = `g.V().drop()`;
    await cosmosClient.submit(deleteVerticesQuery);
    
    if (context) context.log('Graph cleared successfully');
    
    return {
      success: true,
      message: 'Graph cleared successfully',
      deleted: {
        entities: 'all',
        relationships: 'all',
        impacts: 'all'
      }
    };
  } catch (error) {
    if (context) context.log.error('Failed to clear graph:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function neo4jAnalytics(session, analyticsType, limit) {
  let query;
  switch (analyticsType) {
    case 'pagerank':
      query = `MATCH (n) RETURN n.name as name, n.entity_type as type ORDER BY n.name LIMIT $limit`;
      break;
    case 'communities':
      query = `MATCH (n)-[r]-(m) RETURN n.name as name, count(r) as connections ORDER BY connections DESC LIMIT $limit`;
      break;
    case 'central':
      query = `MATCH (n)-[r]-() RETURN n.name as name, n.entity_type as type, count(r) as degree ORDER BY degree DESC LIMIT $limit`;
      break;
    default:
      query = `MATCH (n)-[r]-() RETURN n.name as name, count(r) as connections ORDER BY connections DESC LIMIT $limit`;
  }
  const result = await session.run(query, { limit: neo4j.int(limit) });
  return result.records.map(r => r.toObject());
}
