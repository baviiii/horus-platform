/**
 * AGENTIC PLANNER - Query Planning with GPT-4 Function Calling
 * 
 * This function takes a user query and generates a multi-step retrieval plan.
 * Features:
 * - Query intent classification
 * - Sub-query decomposition
 * - Graph traversal planning
 * - Plan caching for similar queries
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-functions-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// ============================================================================
// AGENT DECISION RUBRIC
// Explicit rules for making assertions - prevents false confidence
// Government-grade: Only assert relationships when verified
// ============================================================================

const ASSERTION_RULES = {
  // Semantic similarity threshold for entity matching
  minSimilarity: 0.88,
  
  // Entity must appear in at least this many documents to be considered established
  minDocumentAppearances: 2,
  
  // All assertions must have explicit textual support
  requireTextualSupport: true,
  
  // Information freshness - documents older than this (years) get lower confidence
  maxAgeYears: 5,
  
  // Entity types must match for same_as relationships
  requireSameEntityType: true,
  
  // Minimum confidence threshold to assert (vs. suggest)
  minConfidenceToAssert: 0.75,
  
  // Minimum confidence threshold to even mention
  minConfidenceToMention: 0.5,
};

/**
 * Validates an assertion against the decision rubric
 * Returns validation result with confidence level and reasoning
 * 
 * @param {Object} assertion - The assertion to validate
 * @param {string} assertion.type - Type of assertion (connection, contradiction, etc.)
 * @param {string} assertion.source - Source entity/document
 * @param {string} assertion.target - Target entity/document
 * @param {number} assertion.similarity - Semantic similarity score (0-1)
 * @param {string} assertion.evidence - Textual evidence supporting the assertion
 * @param {number} assertion.documentAppearances - Number of documents mentioning both entities
 * @param {string} assertion.entityType1 - Type of source entity
 * @param {string} assertion.entityType2 - Type of target entity
 * @param {Date} assertion.documentDate - Date of the source document
 * @returns {Object} Validation result
 */
function validateAssertion(assertion) {
  const validationResults = [];
  let passedRules = 0;
  let totalRules = 0;
  
  // Rule 1: Semantic similarity check
  if (assertion.similarity !== undefined) {
    totalRules++;
    if (assertion.similarity >= ASSERTION_RULES.minSimilarity) {
      passedRules++;
      validationResults.push({
        rule: 'minSimilarity',
        passed: true,
        value: assertion.similarity,
        threshold: ASSERTION_RULES.minSimilarity,
        message: `Similarity ${(assertion.similarity * 100).toFixed(1)}% meets threshold`
      });
    } else {
      validationResults.push({
        rule: 'minSimilarity',
        passed: false,
        value: assertion.similarity,
        threshold: ASSERTION_RULES.minSimilarity,
        message: `Similarity ${(assertion.similarity * 100).toFixed(1)}% below ${ASSERTION_RULES.minSimilarity * 100}% threshold`
      });
    }
  }
  
  // Rule 2: Document appearances check
  if (assertion.documentAppearances !== undefined) {
    totalRules++;
    if (assertion.documentAppearances >= ASSERTION_RULES.minDocumentAppearances) {
      passedRules++;
      validationResults.push({
        rule: 'minDocumentAppearances',
        passed: true,
        value: assertion.documentAppearances,
        threshold: ASSERTION_RULES.minDocumentAppearances,
        message: `Appears in ${assertion.documentAppearances} documents (meets minimum)`
      });
    } else {
      validationResults.push({
        rule: 'minDocumentAppearances',
        passed: false,
        value: assertion.documentAppearances,
        threshold: ASSERTION_RULES.minDocumentAppearances,
        message: `Appears in only ${assertion.documentAppearances} document(s) (needs ${ASSERTION_RULES.minDocumentAppearances})`
      });
    }
  }
  
  // Rule 3: Textual support check
  if (ASSERTION_RULES.requireTextualSupport) {
    totalRules++;
    if (assertion.evidence && assertion.evidence.length > 20) {
      passedRules++;
      validationResults.push({
        rule: 'requireTextualSupport',
        passed: true,
        message: 'Evidence text provided'
      });
    } else {
      validationResults.push({
        rule: 'requireTextualSupport',
        passed: false,
        message: 'No evidence text provided'
      });
    }
  }
  
  // Rule 4: Entity type match (for same_as relationships)
  if (assertion.type === 'same_entity' || assertion.type === 'sameAs') {
    if (ASSERTION_RULES.requireSameEntityType) {
      totalRules++;
      if (assertion.entityType1 === assertion.entityType2) {
        passedRules++;
        validationResults.push({
          rule: 'requireSameEntityType',
          passed: true,
          message: `Entity types match (${assertion.entityType1})`
        });
      } else {
        validationResults.push({
          rule: 'requireSameEntityType',
          passed: false,
          message: `Entity types don't match (${assertion.entityType1} vs ${assertion.entityType2})`
        });
      }
    }
  }
  
  // Rule 5: Document freshness
  if (assertion.documentDate) {
    totalRules++;
    const ageYears = (new Date() - new Date(assertion.documentDate)) / (1000 * 60 * 60 * 24 * 365);
    if (ageYears <= ASSERTION_RULES.maxAgeYears) {
      passedRules++;
      validationResults.push({
        rule: 'maxAgeYears',
        passed: true,
        value: ageYears.toFixed(1),
        threshold: ASSERTION_RULES.maxAgeYears,
        message: `Document is ${ageYears.toFixed(1)} years old (within limit)`
      });
    } else {
      validationResults.push({
        rule: 'maxAgeYears',
        passed: false,
        value: ageYears.toFixed(1),
        threshold: ASSERTION_RULES.maxAgeYears,
        message: `Document is ${ageYears.toFixed(1)} years old (exceeds ${ASSERTION_RULES.maxAgeYears} year limit)`
      });
    }
  }
  
  // Calculate overall confidence and classification
  const rulePassRate = totalRules > 0 ? passedRules / totalRules : 0;
  const confidence = rulePassRate * (assertion.similarity || 0.7);
  
  let classification;
  let canAssert;
  let language;
  
  if (confidence >= ASSERTION_RULES.minConfidenceToAssert && passedRules === totalRules) {
    classification = 'verified';
    canAssert = true;
    language = 'is connected to';
  } else if (confidence >= ASSERTION_RULES.minConfidenceToMention) {
    classification = 'related';
    canAssert = false;
    language = 'may be related to';
  } else {
    classification = 'insufficient';
    canAssert = false;
    language = null; // Don't mention at all
  }
  
  return {
    valid: canAssert,
    classification,
    confidence,
    suggestedLanguage: language,
    passedRules,
    totalRules,
    rulePassRate,
    details: validationResults,
    // Audit trail
    rulesApplied: ASSERTION_RULES,
    timestamp: new Date().toISOString()
  };
}

/**
 * Apply rubric to a list of connections/assertions
 * Filters and classifies based on evidence quality
 */
function applyRubricToConnections(connections) {
  const verified = [];
  const related = [];
  const insufficient = [];
  
  for (const connection of connections) {
    const validation = validateAssertion({
      type: connection.type,
      source: connection.source,
      target: connection.target,
      similarity: connection.strength || connection.similarity,
      evidence: connection.evidence || connection.description,
      documentAppearances: connection.documentAppearances,
      entityType1: connection.sourceType,
      entityType2: connection.targetType,
      documentDate: connection.documentDate
    });
    
    const enrichedConnection = {
      ...connection,
      validation,
      confidence: validation.confidence,
      classification: validation.classification,
      suggestedLanguage: validation.suggestedLanguage
    };
    
    if (validation.classification === 'verified') {
      verified.push(enrichedConnection);
    } else if (validation.classification === 'related') {
      related.push(enrichedConnection);
    } else {
      insufficient.push(enrichedConnection);
    }
  }
  
  return {
    verified,
    related,
    insufficient,
    summary: {
      totalConnections: connections.length,
      verifiedCount: verified.length,
      relatedCount: related.length,
      insufficientCount: insufficient.length,
      verificationRate: connections.length > 0 ? verified.length / connections.length : 0
    }
  };
}

// Query planning tools for GPT-4 function calling
const planningTools = [
  {
    type: "function",
    function: {
      name: "create_retrieval_plan",
      description: "Create a multi-step retrieval plan to answer the user's query comprehensively",
      parameters: {
        type: "object",
        properties: {
          strategy: {
            type: "string",
            enum: ["single_query", "multi_step", "graph_traversal", "comparative", "temporal", "impact_analysis"],
            description: "The overall retrieval strategy. Use 'impact_analysis' for queries about policy impacts on entities (jobs, sectors, organizations)."
          },
          intent: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: ["jobs", "training", "budget", "policy", "funding", "skills", "general"],
                description: "Primary category of the query"
              },
              sectors: {
                type: "array",
                items: { type: "string" },
                description: "Relevant industry sectors"
              },
              entities: {
                type: "array",
                items: { type: "string" },
                description: "Key entities mentioned (organizations, programs, locations)"
              },
              timeframe: {
                type: "string",
                description: "Time period if mentioned (e.g., '2024-2025', 'current')"
              }
            },
            required: ["category"]
          },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "integer", description: "Step number" },
                purpose: { type: "string", description: "What this step retrieves" },
                method: {
                  type: "string",
                  enum: ["hybrid_search", "graph_traversal", "entity_lookup", "filter_search", "get_impacts"],
                  description: "Retrieval method. Use 'get_impacts' to query policy impacts affecting specific entities (jobs, sectors, organizations)."
                },
                query: { type: "string", description: "Search query for this step" },
                filters: {
                  type: "object",
                  properties: {
                    category: { type: "string" },
                    sector: { type: "string" },
                    documentType: { type: "string" }
                  }
                },
                graphParams: {
                  type: "object",
                  properties: {
                    startEntity: { type: "string", description: "Entity to start graph traversal from" },
                    relationships: {
                      type: "array",
                      items: { type: "string" },
                      description: "Relationship types to follow"
                    },
                    depth: { type: "integer", description: "Traversal depth (1-3)" }
                  }
                },
                dependsOn: {
                  type: "array",
                  items: { type: "integer" },
                  description: "Steps this depends on (for sequential execution)"
                }
              },
              required: ["step", "purpose", "method", "query"]
            },
            description: "Ordered retrieval steps"
          },
          synthesisGuidance: {
            type: "string",
            description: "Instructions for how to synthesize results from all steps"
          },
          contradictionChecks: {
            type: "array",
            items: { type: "string" },
            description: "Specific contradictions to look for in results"
          }
        },
        required: ["strategy", "intent", "steps", "synthesisGuidance"]
      }
    }
  }
];

// System prompt for query planning
const plannerSystemPrompt = `You are an expert query planner for a South Australian Government intelligence system.

Your job is to analyze user queries and create optimal retrieval plans that will gather all relevant information.

AVAILABLE DATA SOURCES:
- SA Government budget documents (2024-2025)
- Job listings and career information
- Skills and training programs
- Policy documents
- Funding announcements
- Economic reports

RETRIEVAL METHODS:
1. hybrid_search: Combined vector + keyword + semantic search. Best for general document queries.
2. graph_traversal: Follow entity relationships in graph. Best when query involves connections between entities.
3. entity_lookup: SEMANTIC entity search - finds similar entities even with different names. Best when specific organizations/programs are mentioned. Uses semantic similarity to discover related entities (e.g., "SA Health" finds "Department of Health").
4. filter_search: Filtered search by category/sector. Best for scoped queries.
5. get_impacts: Query policy impacts affecting specific entities. Use for queries like "What impacts affect nurses?", "Show hiring impacts on healthcare", "What are the effects of Budget 2024 on IT sector?". Supports filtering by impact type (hiring, cost, compliance, etc.), severity (high, medium, low), and timeframe.

PLANNING GUIDELINES:
- For simple factual queries: Use single_query strategy with 1 step
- For comparison queries: Use comparative strategy with parallel steps
- For "how does X relate to Y" queries: Use graph_traversal strategy
- For queries spanning time periods: Use temporal strategy
- For queries about policy impacts: Use impact_analysis strategy with get_impacts method
- For complex policy questions: Use multi_step with 2-4 steps

**MANDATORY GRAPH USAGE - THIS IS CRITICAL:**
- EVERY multi_step plan MUST include at least ONE of: entity_lookup OR graph_traversal
- Graph data provides relationships, impacts, and connections that documents alone cannot provide
- For ANY query mentioning: jobs, careers, sectors, organizations, programs, skills, funding → include entity_lookup or graph_traversal
- entity_lookup uses SEMANTIC SEARCH - it finds similar entities automatically (e.g., "IT jobs" finds "Software Developer", "Data Analyst")

PREFERRED PLAN STRUCTURE (for most queries):
1. hybrid_search: Get relevant documents first
2. entity_lookup: Find related entities semantically (ALWAYS include this for career/job/sector queries)
3. graph_traversal: Discover relationships from entities found (include when entities are specific)
4. get_impacts: Get policy impacts on entities (include for budget/policy/workforce queries)

Example plan for "job market outlook for IT professionals":
  Step 1: hybrid_search for "IT job market outlook South Australia"
  Step 2: entity_lookup for "IT professionals" (finds Software Developer, Data Analyst, Cybersecurity Specialist)
  Step 3: graph_traversal from "IT sector" to find related programs, employers, skills
  Step 4: get_impacts for IT sector workforce impacts

ENTITY TYPES TO RECOGNIZE:
- Organizations: SA Health, TAFE SA, Department for Education, etc.
- Programs: Skills SA, JobTrainer, etc.
- Sectors: Healthcare, IT, Defence, Renewable Energy, etc.
- Locations: Adelaide, Northern Adelaide, Regional SA, etc.

Always create efficient plans - don't add unnecessary steps. Each step should retrieve distinct information.`;

/**
 * Generate embedding for query (for cache lookup)
 */
async function generateEmbedding(openAIEndpoint, openAIKey, text) {
  const embeddingDeployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-large';
  
  const response = await fetch(
    `${openAIEndpoint}/openai/deployments/${embeddingDeployment}/embeddings?api-version=2024-02-15-preview`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': openAIKey,
      },
      body: JSON.stringify({
        input: text.substring(0, 8000),
        model: embeddingDeployment,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Embedding generation failed: ${await response.text()}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Check for cached similar query plans
 * NOTE: Query plan caching removed - Supabase not powerful enough for graph operations
 * Plans are generated fresh each time for maximum accuracy
 * 
 * @deprecated Caching disabled - always returns null
 */
async function findCachedPlan() {
  // Caching disabled - always return null to generate fresh plans
  // This ensures plans are always up-to-date with latest graph state
  return null;
}

/**
 * Save successful plan to cache
 * NOTE: Query plan caching removed - Supabase not powerful enough for graph operations
 * Plans are generated fresh each time for maximum accuracy
 * 
 * @deprecated Caching disabled - no-op
 */
async function cachePlan() {
  // Caching disabled - no-op
  // Plans are generated fresh to ensure accuracy with latest graph state
  return;
}

/**
 * Get focus area specific context for planning
 */
function getFocusAreaContext(focusArea) {
  const focusContexts = {
    careers: `FOCUS: Career guidance and job opportunities in South Australia.
Prioritize: Job listings, skills requirements, training pathways, career progression, salary information.
Key entities: TAFE SA, universities, employers, industry sectors.`,
    
    entrepreneurship: `FOCUS: Starting and growing businesses in South Australia.
Prioritize: Business grants, startup programs, funding opportunities, regulatory requirements, incubators.
Key entities: Business SA, Innovation Hub, Treasury funding programs, small business grants.`,
    
    policies: `FOCUS: Government policies and regulations in South Australia.
Prioritize: Policy documents, legislation, regulatory changes, compliance requirements.
Key entities: SA Government departments, regulatory bodies, policy frameworks.`,
    
    basic: `FOCUS: General South Australian government information.
Prioritize: Broad coverage across all topics, recent news, general services.
Key entities: All SA Government agencies and services.`,
    
    funding: `FOCUS: Funding and grants available in South Australia.
Prioritize: Grant programs, funding amounts, eligibility criteria, application deadlines.
Key entities: Treasury, funding bodies, industry development funds.`,
  };
  
  return focusContexts[focusArea] || focusContexts.basic;
}

/**
 * Generate query plan using GPT-4 with function calling
 */
async function generatePlan(openAIEndpoint, openAIKey, query, conversationContext = [], focusArea = 'careers') {
  const chatDeployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini';

  // Build context from conversation history
  let contextMessage = '';
  if (conversationContext.length > 0) {
    contextMessage = '\n\nCONVERSATION CONTEXT:\n';
    conversationContext.slice(-3).forEach((msg, i) => {
      contextMessage += `${msg.role}: ${msg.content.substring(0, 200)}...\n`;
    });
  }

  // Add focus area context
  const focusContext = getFocusAreaContext(focusArea);

  const response = await fetch(
    `${openAIEndpoint}/openai/deployments/${chatDeployment}/chat/completions?api-version=2024-02-15-preview`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': openAIKey,
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: plannerSystemPrompt + '\n\n' + focusContext },
          { role: 'user', content: `Create a retrieval plan for this query:\n\n"${query}"${contextMessage}` }
        ],
        tools: planningTools,
        tool_choice: { type: "function", function: { name: "create_retrieval_plan" } },
        temperature: 0.3,
        max_tokens: 2000,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`GPT-4 planning failed: ${await response.text()}`);
  }

  const data = await response.json();
  const toolCall = data.choices[0]?.message?.tool_calls?.[0];

  if (!toolCall || toolCall.function.name !== 'create_retrieval_plan') {
    throw new Error('GPT-4 did not return a valid plan');
  }

  const plan = JSON.parse(toolCall.function.arguments);

  // Add metadata
  plan.generatedAt = new Date().toISOString();
  plan.estimatedTime = estimateExecutionTime(plan);

  return plan;
}

/**
 * Estimate execution time based on plan complexity
 */
function estimateExecutionTime(plan) {
  let time = 500; // Base time
  
  for (const step of plan.steps) {
    switch (step.method) {
      case 'hybrid_search':
        time += 1500;
        break;
      case 'graph_traversal':
        time += 2000 + (step.graphParams?.depth || 1) * 500;
        break;
      case 'entity_lookup':
        time += 800;
        break;
      case 'filter_search':
        time += 1000;
        break;
    }
  }

  return time;
}

/**
 * Lookup entities from Cosmos DB graph via graph-query function
 * Now uses SEMANTIC SEARCH automatically - finds similar entities even with different names
 * Applies decision rubric to classify results
 */
async function lookupEntities(entityNames) {
  try {
    const graphQueryUrl = process.env.GRAPH_QUERY_URL || process.env.GRAPH_QUERY_FUNCTION_URL || 'https://careercraft-functions-dev.azurewebsites.net/api/graph-query';
    const results = [];
    const semanticMetadata = {
      totalSearched: entityNames.length,
      semanticFound: 0,
      textFound: 0,
      highSimilarity: 0,
      needsVerification: 0
    };
    
    for (const name of entityNames) {
      const response = await fetch(
        graphQueryUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'search',
            query: name,
            limit: 5  // Get more results to allow semantic discovery
          }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        if (result.data && Array.isArray(result.data)) {
          // Track semantic search metadata
          if (result.semanticSearch) {
            semanticMetadata.semanticFound += result.semanticSearch.semanticResultsCount || 0;
            semanticMetadata.textFound += result.semanticSearch.textResultsCount || 0;
          }
          
          // Apply decision rubric to each entity
          const validatedEntities = result.data.map(entity => {
            // Check if this was found via semantic search
            const isSemantic = entity._semantic?.searchMethod === 'semantic';
            const similarity = entity._semantic?.similarity || null;
            
            if (isSemantic && similarity !== null) {
              // Validate semantic match using decision rubric
              const validation = validateAssertion({
                type: 'entity_match',
                source: name,
                target: entity.name,
                similarity: similarity,
                documentAppearances: entity.mention_count || 1,
                evidence: entity.description || '',
                entityType1: 'unknown',
                entityType2: entity.entity_type
              });
              
              if (validation.classification === 'verified') {
                semanticMetadata.highSimilarity++;
              } else {
                semanticMetadata.needsVerification++;
              }
              
              // Add validation metadata
              entity._validation = validation;
            }
            
            return entity;
          });
          
          results.push(...validatedEntities);
        }
      }
    }

    // Deduplicate by id (prefer semantic matches over text matches)
    const seen = new Map(); // id -> entity
    for (const entity of results) {
      const id = entity.id || entity.graphVertexId;
      if (!id) continue;
      
      if (!seen.has(id)) {
        seen.set(id, entity);
      } else {
        // Prefer semantic matches over text matches
        const existing = seen.get(id);
        const existingIsSemantic = existing._semantic?.searchMethod === 'semantic';
        const currentIsSemantic = entity._semantic?.searchMethod === 'semantic';
        
        if (currentIsSemantic && !existingIsSemantic) {
          seen.set(id, entity); // Replace text match with semantic match
        } else if (currentIsSemantic && existingIsSemantic) {
          // Both semantic - prefer higher similarity
          const currentSim = entity._semantic?.similarity || 0;
          const existingSim = existing._semantic?.similarity || 0;
          if (currentSim > existingSim) {
            seen.set(id, entity);
          }
        }
      }
    }
    
    const deduplicated = Array.from(seen.values());
    
    // Log semantic search success
    if (semanticMetadata.semanticFound > 0) {
      console.log(`Entity lookup: Found ${semanticMetadata.semanticFound} entities via semantic search, ${semanticMetadata.textFound} via text search`);
    }
    
    return deduplicated;
  } catch (error) {
    console.warn('Entity lookup error:', error);
    return [];
  }
}

/**
 * Main handler
 */
module.exports = async function (context, req) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 200,
      headers: corsHeaders,
      body: '',
    };
    return;
  }

  context.log('Agentic Planner request received');

  try {
    // Parse request
    let request = {};
    if (typeof req.body === 'string' && req.body.trim()) {
      request = JSON.parse(req.body);
    } else if (req.body) {
      request = req.body;
    }

    const { query, conversationContext = [], focusArea = 'careers' } = request;

    if (!query) {
      context.res = {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Query is required' }),
      };
      return;
    }

    // Get credentials
    const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const openAIKey = process.env.AZURE_OPENAI_KEY;

    if (!openAIEndpoint || !openAIKey) {
      throw new Error('Azure OpenAI credentials not configured');
    }

    const startTime = Date.now();
    let plan = null;
    let fromCache = false;

    // Step 1: Generate query embedding (for future use, not caching)
    const queryEmbedding = await generateEmbedding(openAIEndpoint, openAIKey, query);

    // Step 2: Generate fresh plan (caching disabled - Supabase not powerful enough)
    // Always generate new plans to ensure accuracy with latest graph state
    plan = await generatePlan(openAIEndpoint, openAIKey, query, conversationContext, focusArea);
    
    // Step 3: Enhance plan with entity lookups from Cosmos DB/Neo4j
    if (plan.intent.entities?.length > 0) {
      const entities = await lookupEntities(plan.intent.entities);
      if (entities.length > 0) {
        plan.resolvedEntities = entities.map(e => ({
          id: e.id,
          name: e.name,
          type: e.entity_type,
          canonicalName: e.canonical_name,
        }));

        // Update graph traversal steps with resolved entity IDs
        for (const step of plan.steps) {
          if (step.method === 'graph_traversal' && step.graphParams?.startEntity) {
            const matchedEntity = entities.find(e => 
              e.name.toLowerCase().includes(step.graphParams.startEntity.toLowerCase()) ||
              e.canonical_name.includes(step.graphParams.startEntity.toLowerCase().replace(/\s+/g, '_'))
            );
            if (matchedEntity) {
              step.graphParams.startEntityId = matchedEntity.id;
            }
          }
        }
      }
    }

    const executionTime = Date.now() - startTime;

    context.res = {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan,
        fromCache,
        planningTime: executionTime,
        queryEmbedding: queryEmbedding.slice(0, 10), // Return truncated embedding for reference
      }),
    };

  } catch (error) {
    context.log('Agentic Planner error:', error);
    
    context.res = {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        plan: null,
      }),
    };
  }
};
