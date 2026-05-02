/**
 * ENTITY EXTRACTION - Extract entities from document chunks for Graph RAG
 * 
 * This function processes document chunks and extracts:
 * - Organizations (SA Government departments, agencies)
 * - Programs (Government initiatives)
 * - Locations (SA regions, suburbs)
 * - Sectors (Industry sectors)
 * - Funding amounts
 * - Key metrics
 * 
 * Can be called:
 * - Per-chunk during PDF processing
 * - In batch mode for existing chunks
 * 
 * Saves to:
 * - Azure Cosmos DB (Gremlin API) - Graph relationships
 * - Azure AI Search (Entity Index) - Semantic similarity discovery
 */

const gremlin = require('gremlin');

// Cosmos DB Gremlin connection
let gremlinClient = null;

function getGremlinClient() {
  if (!gremlinClient) {
    const authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator(
      `/dbs/${process.env.COSMOS_DATABASE}/colls/${process.env.COSMOS_GRAPH}`,
      process.env.COSMOS_PRIMARY_KEY
    );
    gremlinClient = new gremlin.driver.Client(
      process.env.COSMOS_GREMLIN_ENDPOINT,
      {
        authenticator,
        traversalsource: 'g',
        rejectUnauthorized: true,
        mimeType: 'application/vnd.gremlin-v2.0+json'
      }
    );
  }
  return gremlinClient;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-functions-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Entity extraction tools for GPT-4 function calling
const extractionTools = [
  {
    type: "function",
    function: {
      name: "extract_entities",
      description: "Extract named entities from document text",
      parameters: {
        type: "object",
        properties: {
          entities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Entity name as it appears in text"
                },
                canonicalName: {
                  type: "string",
                  description: "Normalized name (lowercase, underscores, no special chars)"
                },
                entityType: {
                  type: "string",
                  enum: ["organization", "program", "policy", "funding", "skill", "occupation", "location", "sector", "qualification", "date_period", "metric", "person"],
                  description: "Type of entity"
                },
                description: {
                  type: "string",
                  description: "Brief description based on context"
                },
                aliases: {
                  type: "array",
                  items: { type: "string" },
                  description: "Alternative names or abbreviations"
                },
                properties: {
                  type: "object",
                  description: "Type-specific properties (e.g., amount for funding, url for organization)"
                },
                confidence: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                  description: "Extraction confidence (0-1)"
                },
                mentionPosition: {
                  type: "integer",
                  description: "Approximate character position in text"
                }
              },
              required: ["name", "canonicalName", "entityType", "confidence"]
            }
          },
          relationships: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sourceEntity: {
                  type: "string",
                  description: "Canonical name of source entity"
                },
                targetEntity: {
                  type: "string",
                  description: "Canonical name of target entity"
                },
                relationshipType: {
                  type: "string",
                  enum: ["funds", "employs", "requires", "located_in", "part_of", "targets", "leads_to", "replaces", "contradicts", "supports", "related_to", "mentions", "allocates", "certifies", "sameAs", "aliasOf", "subDepartmentOf"],
                  description: "Type of relationship. Use sameAs for identical entities, aliasOf for abbreviations/variants, subDepartmentOf for hierarchical org relationships"
                },
                evidence: {
                  type: "string",
                  description: "Text excerpt supporting this relationship"
                },
                strength: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                  description: "Relationship strength (0-1)"
                }
              },
              required: ["sourceEntity", "targetEntity", "relationshipType", "strength"]
            }
          },
          primaryTopics: {
            type: "array",
            items: { type: "string" },
            description: "Canonical names of entities that are the main topic of this text"
          },
          // NEW: Structured Impact Extraction
          impacts: {
            type: "array",
            description: "Policy impacts extracted from the document",
            items: {
              type: "object",
              properties: {
                policyId: {
                  type: "string",
                  description: "Canonical name of the policy/program causing the impact"
                },
                policyName: {
                  type: "string",
                  description: "Human-readable name of the policy"
                },
                affectedEntity: {
                  type: "string",
                  description: "What/who is affected (role, industry, org, location, demographic)"
                },
                affectedEntityType: {
                  type: "string",
                  enum: ["occupation", "sector", "organization", "location", "demographic", "skill", "service", "budget", "outcome", "goal", "capability", "community", "economy"],
                  description: "Type of the affected entity (includes strategy outcomes and goals)"
                },
                impactType: {
                  type: "string",
                  enum: ["cost", "compliance", "hiring", "skills", "service", "funding", "workforce", "training", "regulation", "opportunity", "outcome", "goal", "growth", "capability", "support", "transformation"],
                  description: "Category of impact (includes strategy outcomes and transformations)"
                },
                direction: {
                  type: "string",
                  enum: ["increase", "decrease", "constraint", "enable", "change", "maintain"],
                  description: "Direction of the impact"
                },
                severity: {
                  type: "string",
                  enum: ["high", "medium", "low"],
                  description: "Magnitude of the impact"
                },
                confidence: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                  description: "Confidence in this impact extraction (0-1)"
                },
                evidenceText: {
                  type: "string",
                  description: "Exact quote from the document supporting this impact"
                },
                quantitativeValue: {
                  type: "string",
                  description: "Specific numbers if mentioned (e.g., '$50M', '5000 jobs', '15%')"
                },
                timeframe: {
                  type: "string",
                  description: "When the impact occurs or takes effect (e.g., '2024-2025', 'immediate')"
                }
              },
              required: ["policyId", "affectedEntity", "affectedEntityType", "impactType", "direction", "severity", "confidence", "evidenceText"]
            }
          }
        },
        required: ["entities", "relationships", "primaryTopics", "impacts"]
      }
    }
  }
];

// System prompt for entity extraction
const extractionSystemPrompt = `You are an expert entity and impact extractor specializing in South Australian government documents.

Your job is to identify and extract named entities, their relationships, AND policy impacts from document chunks.

ENTITY TYPES TO EXTRACT:
- organization: SA Government departments, agencies, companies (e.g., "SA Health", "Department for Education", "TAFE SA")
- program: Government programs, initiatives (e.g., "Skills SA", "JobTrainer")
- policy: Regulations, policies, legislation (e.g., "State Budget 2024-25")
- funding: Specific funding allocations (e.g., "$50 million health investment")
- skill: Job skills, competencies (e.g., "data analysis", "project management")
- occupation: Job titles, career paths (e.g., "registered nurse", "software developer")
- location: SA locations (e.g., "Adelaide", "Northern Adelaide", "Whyalla")
- sector: Industry sectors (e.g., "Healthcare", "Defence", "Renewable Energy")
- qualification: Certifications, degrees (e.g., "Certificate III", "Bachelor of Nursing")
- date_period: Time periods, budget years (e.g., "2024-2025", "FY24")
- metric: Statistics, KPIs (e.g., "15% growth", "5,000 jobs")

CANONICAL NAME RULES:
- Lowercase everything
- Replace spaces with underscores
- Remove special characters except underscores
- Use consistent abbreviations (e.g., "sa_health" not "south_australian_health")

RELATIONSHIP TYPES:
- funds: Organization funds Program/Organization
- employs: Organization employs Occupation
- requires: Occupation requires Skill/Qualification
- located_in: Entity located in Location
- part_of: Program part of Policy/Organization
- targets: Program/Policy targets Sector
- leads_to: Qualification leads to Occupation
- allocates: Budget allocates Funding
- sameAs: Two names refer to the SAME entity (e.g., "SA Health" sameAs "South Australian Health")
- aliasOf: One name is an abbreviation/variant of another (e.g., "TAFE" aliasOf "TAFE SA")
- subDepartmentOf: Hierarchical organization relationship (e.g., "Office of Chief Psychiatrist" subDepartmentOf "SA Health")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENTITY CANONICALIZATION (CRITICAL FOR GRAPH QUALITY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALIAS DETECTION RULES:
1. When you see multiple names for the same entity, create sameAs/aliasOf relationships
2. Common patterns to look for:
   - Full name vs abbreviation: "Department for Education" vs "DfE"
   - With/without "SA": "SA Health" vs "Health SA" vs "South Australian Health"
   - Different capitalization or spacing: "TAFE SA" vs "TafeSA"
   - Historical name changes: "Department of Health" might now be "SA Health"

3. Use sameAs when entities are identical (interchangeable)
4. Use aliasOf when one is an abbreviation or informal variant
5. Use subDepartmentOf for organizational hierarchy

KNOWN SA GOVERNMENT ENTITY ALIASES (USE THESE):
- sa_health = south_australian_health = department_of_health_and_wellbeing
- department_for_education = dfe = education_sa
- tafe_sa = tafe = technical_and_further_education
- skills_sa = office_of_skills_sa
- infrastructure_sa = department_of_infrastructure_and_transport
- dpc = department_of_premier_and_cabinet
- dti = department_for_trade_and_investment
- sa_police = sapol = south_australia_police

CANONICALIZATION GUIDELINES:
1. Always use the most common/official name as the canonical name
2. Extract ALL variants as separate entities with aliases array
3. Create sameAs relationships between variant entities
4. Set high confidence (>0.9) only when alias relationship is certain
5. Include evidence text showing both names used interchangeably

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPACT EXTRACTION (CRITICAL FOR GOVERNMENT INTELLIGENCE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Extract POLICY & STRATEGY IMPACTS - how policies, budgets, programs, AND strategies affect entities, outcomes, and goals:

IMPACT TYPES:
- cost: Financial impact on budgets, prices, fees
- compliance: Regulatory requirements, obligations
- hiring: Employment changes, job creation/reduction
- skills: Skills demand, training requirements
- service: Service delivery changes
- funding: Grant availability, budget allocation changes
- workforce: Staffing levels, workforce composition
- training: Education/training program changes
- regulation: Rule changes, policy requirements
- opportunity: New opportunities created
- outcome: Strategic outcomes, expected results from strategies/plans
- goal: Strategic goals, objectives, targets
- growth: Growth targets, expansion, scaling
- capability: Capability building, capacity development
- support: Support mechanisms, enabling actions
- transformation: Transformational changes, reforms

DIRECTION:
- increase: More of something (jobs, funding, requirements)
- decrease: Less of something (budget cuts, job losses)
- constraint: New limitations or restrictions
- enable: Removing barriers, creating pathways
- change: Transformation without clear increase/decrease
- maintain: Continuation of existing state

SEVERITY:
- high: Significant, widespread, or transformative impact
- medium: Moderate impact on specific areas
- low: Minor or limited impact

IMPACT EXTRACTION RULES:
1. ALWAYS include exact evidence text from the document
2. Only extract impacts with explicit textual support
3. Use high confidence (>0.8) only when impact is clearly stated
4. Include quantitative values when numbers are mentioned
5. Link impacts to specific policies/programs when possible
6. Identify the timeframe when mentioned

EXAMPLE IMPACT (BUDGET/POLICY STYLE):
{
  "policyId": "state_budget_2024-25",
  "policyName": "State Budget 2024-25",
  "affectedEntity": "registered_nurse",
  "affectedEntityType": "occupation",
  "impactType": "hiring",
  "direction": "increase",
  "severity": "high",
  "confidence": 0.9,
  "evidenceText": "The budget allocates $50 million to hire 500 additional registered nurses",
  "quantitativeValue": "500 nurses, $50M",
  "timeframe": "2024-2025"
}

EXAMPLE IMPACT (STRATEGY/OUTCOME STYLE):
{
  "policyId": "skills_workforce_strategy_2024",
  "policyName": "SA Skills and Workforce Strategy 2024",
  "affectedEntity": "workforce_participation",
  "affectedEntityType": "outcome",
  "impactType": "growth",
  "direction": "increase",
  "severity": "high",
  "confidence": 0.85,
  "evidenceText": "The strategy aims to increase workforce participation by 15% through targeted skills programs",
  "quantitativeValue": "15% increase",
  "timeframe": "2024-2028"
}

EXAMPLE IMPACT (GOAL/CAPABILITY STYLE):
{
  "policyId": "defence_industry_plan",
  "policyName": "SA Defence Industry Development Plan",
  "affectedEntity": "defence_sector_employment",
  "affectedEntityType": "goal",
  "impactType": "outcome",
  "direction": "enable",
  "severity": "high",
  "confidence": 0.8,
  "evidenceText": "The plan will support the creation of 4,000 new defence industry jobs by 2030",
  "quantitativeValue": "4,000 jobs",
  "timeframe": "by 2030"
}

STRATEGY DOCUMENT TRIGGERS (EXTRACT AS IMPACTS):
- "aims to" / "will aim to" → Extract as impact with direction based on intent
- "will support" / "supports" → Use impactType: "support", direction: "enable"
- "outcomes include" / "expected outcomes" → Use affectedEntityType: "outcome"
- "goals" / "objectives" / "targets" → Use affectedEntityType: "goal"
- "will enable" / "enabling" → Use direction: "enable"
- "will create" / "creation of" → Use direction: "increase"
- "workforce growth" / "job creation" → Use impactType: "growth" or "hiring"
- "capability building" / "capacity" → Use impactType: "capability"
- "transformation" / "reform" → Use impactType: "transformation"

For strategy documents, use policyId for the strategy/plan name (e.g., "skills_workforce_strategy").
Do NOT skip strategy outcomes just because they lack dollar amounts - extract them!

EXTRACTION GUIDELINES:
1. Only extract entities clearly mentioned in the text
2. Use high confidence (>0.8) only when entity is unambiguous
3. Extract relationships only when explicitly stated or strongly implied
4. Mark entities as primary topics if they are the main subject of the text
5. Prefer specific entities over generic ones
6. ALWAYS extract impacts when policies affect jobs, budgets, skills, or services
7. ALWAYS extract strategy outcomes, goals, and "aims to" statements as impacts
8. For strategies without exact numbers, still extract the impact with available evidence

REQUIRED OUTPUT:
- You MUST return the "impacts" array in your response. Use an empty array [] ONLY when the chunk has no policy, strategy, outcome, or goal language (e.g. pure data tables, chart labels, numbers only). For any narrative that mentions aims, outcomes, goals, support, growth, or program effects, populate impacts with at least one entry. Do not omit the impacts key.`;

/**
 * Generate embedding for an entity
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
    console.warn('Embedding generation failed:', await response.text());
    return null;
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Extract entities from text using GPT-4
 */
async function extractEntities(openAIEndpoint, openAIKey, text, documentId, chunkId) {
  const chatDeployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini';

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
          { role: 'system', content: extractionSystemPrompt },
          { role: 'user', content: `Extract entities and relationships from this document chunk:\n\nDocument ID: ${documentId}\nChunk ID: ${chunkId}\n\nText:\n${text.substring(0, 6000)}` }
        ],
        tools: extractionTools,
        tool_choice: { type: "function", function: { name: "extract_entities" } },
        temperature: 0.2,
        max_tokens: 12000,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`GPT-4 extraction failed: ${await response.text()}`);
  }

  const data = await response.json();
  const toolCall = data.choices[0]?.message?.tool_calls?.[0];

  if (!toolCall || toolCall.function.name !== 'extract_entities') {
    throw new Error('GPT-4 did not return valid extraction');
  }

  let extraction;
  try {
    extraction = JSON.parse(toolCall.function.arguments);
  } catch (parseErr) {
    throw new Error(`GPT returned malformed JSON: ${parseErr.message}. Raw: ${toolCall.function.arguments.substring(0, 200)}`);
  }

  // Validate required arrays exist
  extraction.entities = Array.isArray(extraction.entities) ? extraction.entities : [];
  extraction.relationships = Array.isArray(extraction.relationships) ? extraction.relationships : [];
  extraction.primaryTopics = Array.isArray(extraction.primaryTopics) ? extraction.primaryTopics : [];

  // Robust impacts: accept multiple keys and stringified JSON so we never drop impacts
  let rawImpacts = extraction.impacts ?? extraction.Impacts ?? extraction.policy_impacts;
  if (typeof rawImpacts === 'string') {
    try {
      rawImpacts = JSON.parse(rawImpacts);
    } catch {
      rawImpacts = [];
    }
  }
  extraction.impacts = Array.isArray(rawImpacts) ? rawImpacts : [];
  // Always log counts so we can see what the model returned (0 impacts = model chose not to extract)
  console.log(`Extraction: ${extraction.entities.length} entities, ${extraction.relationships.length} relationships, ${extraction.impacts.length} impacts`);
  if (extraction.impacts.length === 0 && (extraction.entities.length > 0 || extraction.relationships.length > 0)) {
    const keys = Object.keys(extraction).filter(k => !['entities', 'relationships', 'primaryTopics', 'impacts'].includes(k));
    if (keys.length > 0) console.log(`Extraction top-level keys (check for alternate impact key): ${keys.join(', ')}`);
  }

  return extraction;
}

// ============================================================================
// ENTITY CANONICALIZATION
// Known aliases for SA Government entities to prevent duplicates
// ============================================================================

const KNOWN_ENTITY_ALIASES = {
  // Health
  'sa_health': ['south_australian_health', 'department_of_health_and_wellbeing', 'health_sa', 'dept_health'],
  'wellbeing_sa': ['office_of_wellbeing_sa', 'wellbeing_south_australia'],
  
  // Education
  'department_for_education': ['dfe', 'education_sa', 'dept_education', 'sa_education'],
  'tafe_sa': ['tafe', 'technical_and_further_education', 'tafe_south_australia'],
  
  // Skills & Employment
  'skills_sa': ['office_of_skills_sa', 'skills_south_australia'],
  'workskil': ['workskil_australia', 'work_skil'],
  
  // Infrastructure
  'infrastructure_sa': ['department_of_infrastructure_and_transport', 'dit', 'infrastructure_south_australia'],
  
  // Premier & Cabinet
  'department_of_premier_and_cabinet': ['dpc', 'premier_and_cabinet', 'premiers_office'],
  
  // Trade & Investment
  'department_for_trade_and_investment': ['dti', 'trade_and_investment_sa'],
  
  // Police & Emergency
  'sa_police': ['sapol', 'south_australia_police', 'sa_police_force'],
  'sa_ambulance': ['saas', 'south_australian_ambulance_service'],
  'mfs': ['metropolitan_fire_service', 'sa_mfs'],
  'cfs': ['country_fire_service', 'sa_cfs'],
  
  // Treasury & Finance
  'department_of_treasury_and_finance': ['dtf', 'treasury_sa', 'sa_treasury'],
  
  // Environment
  'department_for_environment_and_water': ['dew', 'environment_sa', 'environment_and_water'],
  
  // Human Services
  'department_of_human_services': ['dhs', 'human_services_sa'],
};

/**
 * Find canonical entity ID for a given entity name
 * Checks against known aliases to prevent duplicates
 */
function resolveCanonicalEntity(canonicalName, entityType) {
  const normalizedName = canonicalName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  
  // Check if this name is a known alias
  for (const [canonical, aliases] of Object.entries(KNOWN_ENTITY_ALIASES)) {
    if (canonical === normalizedName || aliases.includes(normalizedName)) {
      return canonical;
    }
  }
  
  return normalizedName;
}

/**
 * Check if two entity names refer to the same entity
 */
function areEntitiesSame(name1, name2) {
  const norm1 = name1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const norm2 = name2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Exact match after normalization
  if (norm1 === norm2) return true;
  
  // One is substring of other (for abbreviations)
  if (norm1.length > 3 && norm2.length > 3) {
    if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
  }
  
  // Check known aliases
  for (const [canonical, aliases] of Object.entries(KNOWN_ENTITY_ALIASES)) {
    const allNames = [canonical, ...aliases].map(n => n.replace(/_/g, ''));
    if (allNames.includes(norm1) && allNames.includes(norm2)) return true;
  }
  
  return false;
}

/**
 * Save entities to Cosmos DB Gremlin with canonicalization
 */
async function saveEntitiesToCosmos(entities, documentId, chunkId) {
  const client = getGremlinClient();
  const savedEntities = [];
  const processedCanonicals = new Set();
  
  // Get credentials for semantic search
  const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const searchKey = process.env.AZURE_SEARCH_KEY;
  const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const openAIKey = process.env.AZURE_OPENAI_KEY;
  const useSemanticCheck = !!(searchEndpoint && searchKey && openAIEndpoint && openAIKey);

  for (const entity of entities) {
    try {
      // Resolve to canonical name to prevent duplicates
      const resolvedCanonical = resolveCanonicalEntity(entity.canonicalName, entity.entityType);
      const vertexId = `${entity.entityType}_${resolvedCanonical}`;
      
      // Skip if we already processed this canonical in this batch
      if (processedCanonicals.has(vertexId)) {
        savedEntities.push({
          id: vertexId,
          canonical_name: resolvedCanonical,
          entity_type: entity.entityType,
          name: entity.name,
          wasResolved: true
        });
        continue;
      }
      processedCanonicals.add(vertexId);
      
      // Check if vertex exists (exact match)
      const checkQuery = `g.V('${escapeGremlin(vertexId)}')`;
      const existing = await client.submit(checkQuery);
      
      let finalVertexId = vertexId;
      let mergedWithSimilar = false;
      let existingAliases = [];
      
      // If exact match not found, check semantic similarity
      if ((!existing._items || existing._items.length === 0) && useSemanticCheck) {
        try {
          // Search for similar entities in the entity index
          const semanticResult = await searchSimilarEntities(entity.name, entity.entityType, 5);
          
          if (semanticResult.similar && semanticResult.similar.length > 0) {
            const bestMatch = semanticResult.similar[0];
            
            // If similarity is high enough (>= 0.88), merge with existing
            if (bestMatch.similarity >= 0.88 && bestMatch.graphVertexId) {
              // Verify the vertex still exists in Cosmos
              const verifyQuery = `g.V('${escapeGremlin(bestMatch.graphVertexId)}')`;
              const verifyExisting = await client.submit(verifyQuery);
              
              if (verifyExisting._items && verifyExisting._items.length > 0) {
                // Use existing vertex ID
                finalVertexId = bestMatch.graphVertexId;
                mergedWithSimilar = true;
                
                // Get existing aliases
                const existingVertex = verifyExisting._items[0];
                if (existingVertex.properties && existingVertex.properties.aliases) {
                  try {
                    existingAliases = JSON.parse(existingVertex.properties.aliases[0].value || '[]');
                  } catch (e) {
                    existingAliases = [];
                  }
                }
                
                console.log(`Merging "${entity.name}" with existing similar entity "${bestMatch.name}" (similarity: ${(bestMatch.similarity * 100).toFixed(1)}%)`);
              }
            }
          }
        } catch (semanticError) {
          // If semantic search fails, continue with creating new entity
          console.warn(`Semantic similarity check failed for ${entity.name}:`, semanticError.message);
        }
      }
      
      // Store all names/aliases seen for this entity
      const newAliases = entity.aliases || [entity.name];
      const allAliases = Array.from(new Set([...existingAliases, entity.name, ...newAliases]));
      const aliasesJson = JSON.stringify(allAliases);
      
      // Check if final vertex exists
      const finalCheckQuery = `g.V('${escapeGremlin(finalVertexId)}')`;
      const finalExisting = await client.submit(finalCheckQuery);
      
      if (finalExisting._items && finalExisting._items.length > 0) {
        // Update existing vertex - merge aliases and increment mention count
        const existingVertex = finalExisting._items[0];
        const existingCanonical = existingVertex.properties?.canonical_name?.[0]?.value || resolvedCanonical;
        
        const updateQuery = `
          g.V('${escapeGremlin(finalVertexId)}')
            .property('mention_count', g.V('${escapeGremlin(finalVertexId)}').values('mention_count').fold().coalesce(unfold(), constant(0)).math('_ + 1'))
            .property('aliases', '${escapeGremlin(aliasesJson)}')
            .property('last_seen_document', '${escapeGremlin(documentId)}')
            .property('last_updated', '${new Date().toISOString()}')
        `;
        await client.submit(updateQuery);
        
        savedEntities.push({
          id: finalVertexId,
          canonical_name: existingCanonical,
          entity_type: entity.entityType,
          name: entity.name,
          wasResolved: resolvedCanonical !== entity.canonicalName,
          mergedWithSimilar: mergedWithSimilar
        });
      } else {
        // Create new vertex with aliases
        const createQuery = `
          g.addV('${escapeGremlin(entity.entityType)}')
            .property('id', '${escapeGremlin(finalVertexId)}')
            .property('partitionKey', '${escapeGremlin(entity.entityType)}')
            .property('entity_type', '${escapeGremlin(entity.entityType)}')
            .property('name', '${escapeGremlin(entity.name)}')
            .property('canonical_name', '${escapeGremlin(resolvedCanonical)}')
            .property('original_canonical', '${escapeGremlin(entity.canonicalName)}')
            .property('aliases', '${escapeGremlin(aliasesJson)}')
            .property('description', '${escapeGremlin(entity.description || '')}')
            .property('confidence', ${entity.confidence || 0.8})
            .property('source_document', '${escapeGremlin(documentId)}')
            .property('source_chunk', '${escapeGremlin(chunkId)}')
            .property('mention_count', 1)
            .property('created_at', '${new Date().toISOString()}')
        `;
        await client.submit(createQuery);
        
        savedEntities.push({
          id: finalVertexId,
          canonical_name: resolvedCanonical,
          entity_type: entity.entityType,
          name: entity.name,
          wasResolved: resolvedCanonical !== entity.canonicalName,
          mergedWithSimilar: false
        });
      }
    } catch (error) {
      console.warn(`Failed to save entity ${entity.name}:`, error.message);
    }
  }

  return savedEntities;
}

// Escape special characters for Gremlin (backslash first, then single-quote)
function escapeGremlin(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Merge quantitative values from two impacts
 * Handles dollar amounts, job counts, percentages
 */
function mergeQuantitativeValues(value1, value2, direction1, direction2) {
  // If directions are the same, sum the values
  // If directions are opposite, calculate net difference
  
  // Extract dollar amounts
  const dollarMatch1 = value1.match(/\$[\d,]+(?:\.\d+)?\s*(?:million|billion|M|B|k|thousand)?/i);
  const dollarMatch2 = value2.match(/\$[\d,]+(?:\.\d+)?\s*(?:million|billion|M|B|k|thousand)?/i);
  
  if (dollarMatch1 && dollarMatch2) {
    let amount1 = parseFloat(dollarMatch1[0].replace(/[$,]/g, ''));
    let amount2 = parseFloat(dollarMatch2[0].replace(/[$,]/g, ''));
    
    const multiplier1 = dollarMatch1[0].toLowerCase();
    const multiplier2 = dollarMatch2[0].toLowerCase();
    
    if (multiplier1.includes('billion') || multiplier1.includes('b')) amount1 *= 1000000000;
    else if (multiplier1.includes('million') || multiplier1.includes('m')) amount1 *= 1000000;
    else if (multiplier1.includes('thousand') || multiplier1.includes('k')) amount1 *= 1000;
    
    if (multiplier2.includes('billion') || multiplier2.includes('b')) amount2 *= 1000000000;
    else if (multiplier2.includes('million') || multiplier2.includes('m')) amount2 *= 1000000;
    else if (multiplier2.includes('thousand') || multiplier2.includes('k')) amount2 *= 1000;
    
    // Apply direction
    if (direction1 === 'decrease') amount1 = -amount1;
    if (direction2 === 'decrease') amount2 = -amount2;
    
    const netAmount = amount1 + amount2;
    const absAmount = Math.abs(netAmount);
    
    // Format result
    let formatted;
    if (absAmount >= 1000000000) {
      formatted = `$${(absAmount / 1000000000).toFixed(2)} billion`;
    } else if (absAmount >= 1000000) {
      formatted = `$${(absAmount / 1000000).toFixed(2)} million`;
    } else if (absAmount >= 1000) {
      formatted = `$${(absAmount / 1000).toFixed(2)} thousand`;
    } else {
      formatted = `$${absAmount.toFixed(2)}`;
    }
    
    return formatted;
  }
  
  // Extract job counts
  const jobMatch1 = value1.match(/(\d+(?:,\d+)?)\s*(?:jobs?|positions?|workers?|employees?)/i);
  const jobMatch2 = value2.match(/(\d+(?:,\d+)?)\s*(?:jobs?|positions?|workers?|employees?)/i);
  
  if (jobMatch1 && jobMatch2) {
    let jobs1 = parseInt(jobMatch1[1].replace(/,/g, ''), 10);
    let jobs2 = parseInt(jobMatch2[1].replace(/,/g, ''), 10);
    
    // Apply direction
    if (direction1 === 'decrease') jobs1 = -jobs1;
    if (direction2 === 'decrease') jobs2 = -jobs2;
    
    const netJobs = jobs1 + jobs2;
    const absJobs = Math.abs(netJobs);
    
    return `${absJobs.toLocaleString()} jobs`;
  }
  
  // Extract percentages
  const percentMatch1 = value1.match(/(\d+(?:\.\d+)?)\s*%/);
  const percentMatch2 = value2.match(/(\d+(?:\.\d+)?)\s*%/);
  
  if (percentMatch1 && percentMatch2) {
    let percent1 = parseFloat(percentMatch1[1]);
    let percent2 = parseFloat(percentMatch2[1]);
    
    // Apply direction
    if (direction1 === 'decrease') percent1 = -percent1;
    if (direction2 === 'decrease') percent2 = -percent2;
    
    const netPercent = percent1 + percent2;
    const absPercent = Math.abs(netPercent);
    
    return `${absPercent.toFixed(1)}%`;
  }
  
  // If can't parse, return combined string
  return `${value1} + ${value2}`;
}

// ============================================================================
// ENTITY SEMANTIC INDEX
// Indexes entities to Azure AI Search for semantic similarity discovery
// ============================================================================

/**
 * Index entities to Azure AI Search for semantic discovery
 * This creates the "sidecar" semantic index alongside the graph
 * Enables finding similar entities without automatic graph edges
 *
 * Returns detailed stats including skip reasons and embedding retries.
 */
async function indexEntitiesToSearch(entities, savedEntities, documentId, openAIEndpoint, openAIKey) {
  const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const searchKey = process.env.AZURE_SEARCH_KEY;
  const entityIndex = process.env.AZURE_SEARCH_ENTITY_INDEX || 'entities';

  const skippedEntities = [];
  let totalEmbeddingRetries = 0;

  if (!searchEndpoint || !searchKey) {
    console.warn('Azure Search credentials not configured - skipping entity indexing');
    return { indexed: 0, skipped: entities.length, skippedDetails: [{ name: '*', reason: 'search_creds_missing' }], embeddingRetries: 0 };
  }

  const embeddingDeployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-large';
  const indexedEntities = [];

  // Create a map of saved entities for lookup
  const savedEntityMap = new Map(savedEntities.map(e => [e.canonical_name, e]));

  for (const entity of entities) {
    try {
      const savedEntity = savedEntityMap.get(entity.canonicalName) ||
                          savedEntityMap.get(resolveCanonicalEntity(entity.canonicalName, entity.entityType));

      if (!savedEntity) {
        console.warn(`Skipping entity indexing: "${entity.name}" (canonical: ${entity.canonicalName}) not found in savedEntityMap. Map keys: ${[...savedEntityMap.keys()].slice(0, 10).join(', ')}`);
        skippedEntities.push({ name: entity.name, canonical: entity.canonicalName, reason: 'not_in_saved_map' });
        continue;
      }

      // Generate embedding for entity (name + description) with retry
      const textToEmbed = `${entity.name}. ${entity.description || ''}. Type: ${entity.entityType}`;
      const embeddingUrl = `${openAIEndpoint}/openai/deployments/${embeddingDeployment}/embeddings?api-version=2024-02-15-preview`;
      const embeddingBody = JSON.stringify({
        input: textToEmbed.substring(0, 8000),
        model: embeddingDeployment,
      });

      let embeddingResponse = null;
      const maxEmbeddingRetries = 3;
      for (let attempt = 0; attempt < maxEmbeddingRetries; attempt++) {
        try {
          embeddingResponse = await fetch(embeddingUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'api-key': openAIKey },
            body: embeddingBody,
          });
          if (embeddingResponse.ok) break;

          // Retry on 429 (rate limit) or 5xx
          if (embeddingResponse.status === 429 || embeddingResponse.status >= 500) {
            totalEmbeddingRetries++;
            const backoffMs = 1000 * Math.pow(2, attempt);
            console.warn(`Embedding attempt ${attempt + 1}/${maxEmbeddingRetries} failed for "${entity.name}" (HTTP ${embeddingResponse.status}), retrying in ${backoffMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          } else {
            // Non-retryable error (4xx other than 429)
            break;
          }
        } catch (fetchErr) {
          totalEmbeddingRetries++;
          console.warn(`Embedding fetch error for "${entity.name}" (attempt ${attempt + 1}): ${fetchErr.message}`);
          if (attempt < maxEmbeddingRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          }
        }
      }

      if (!embeddingResponse || !embeddingResponse.ok) {
        let errDetail = 'unknown';
        try { errDetail = embeddingResponse ? `HTTP ${embeddingResponse.status}: ${await embeddingResponse.text()}` : 'no response'; } catch (_) {}
        console.warn(`Embedding failed for "${entity.name}" after ${maxEmbeddingRetries} attempts: ${errDetail}`);
        skippedEntities.push({ name: entity.name, reason: 'embedding_failed', status: embeddingResponse?.status, detail: errDetail.substring(0, 200) });
        continue;
      }

      const embeddingData = await embeddingResponse.json();
      const embedding = embeddingData.data[0].embedding;

      // Create entity document for Azure Search
      const entityDoc = {
        id: savedEntity.id.replace(/[^a-zA-Z0-9_-]/g, '_'), // Sanitize ID for Azure Search
        entityType: entity.entityType,
        name: entity.name,
        canonicalName: savedEntity.canonical_name,
        description: entity.description || '',
        aliases: entity.aliases || [entity.name],
        sector: null, // Will be populated if entity is a sector or related to one
        sourceDocuments: [documentId],
        mentionCount: 1,
        confidence: entity.confidence || 0.8,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entityVector: embedding,
        graphVertexId: savedEntity.id,
        relatedEntityIds: []
      };

      // Detect sector from entity type or name
      if (entity.entityType === 'sector') {
        entityDoc.sector = entity.canonicalName;
      }

      indexedEntities.push(entityDoc);

    } catch (error) {
      console.warn(`Failed to index entity ${entity.name}:`, error.message);
      skippedEntities.push({ name: entity.name, reason: 'exception', detail: error.message.substring(0, 200) });
    }
  }

  if (indexedEntities.length === 0) {
    console.warn(`Entity indexing: 0/${entities.length} entities prepared for indexing. Skipped: ${JSON.stringify(skippedEntities.slice(0, 10))}`);
    return { indexed: 0, skipped: entities.length, skippedDetails: skippedEntities, embeddingRetries: totalEmbeddingRetries };
  }

  // Batch upload to Azure Search
  try {
    const searchUrl = `${searchEndpoint}/indexes/${entityIndex}/docs/index?api-version=2023-11-01`;
    const batch = {
      value: indexedEntities.map(doc => ({
        '@search.action': 'mergeOrUpload',
        ...doc
      }))
    };

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': searchKey,
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Failed to index entities to Azure Search: ${errorText}`);
      return { indexed: 0, skipped: entities.length, skippedDetails: skippedEntities, embeddingRetries: totalEmbeddingRetries, error: errorText };
    }

    const result = await response.json();
    const successCount = result.value?.filter(r => r.status === true || r.statusCode === 200 || r.statusCode === 201).length || 0;

    // Log summary
    if (skippedEntities.length > 0) {
      console.log(`Entity indexing: ${successCount}/${entities.length} indexed, ${skippedEntities.length} skipped, ${totalEmbeddingRetries} embedding retries`);
    }

    return {
      indexed: successCount,
      skipped: entities.length - successCount,
      skippedDetails: skippedEntities,
      embeddingRetries: totalEmbeddingRetries,
      results: result.value?.slice(0, 5) // First 5 for debugging
    };

  } catch (error) {
    console.warn('Entity indexing to Azure Search failed:', error.message);
    return { indexed: 0, skipped: entities.length, skippedDetails: skippedEntities, embeddingRetries: totalEmbeddingRetries, error: error.message };
  }
}

/**
 * Search for similar entities in the semantic index
 * Used by agentic planner for entity discovery
 */
async function searchSimilarEntities(entityName, entityType = null, topK = 5) {
  const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const searchKey = process.env.AZURE_SEARCH_KEY;
  const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const openAIKey = process.env.AZURE_OPENAI_KEY;
  const entityIndex = process.env.AZURE_SEARCH_ENTITY_INDEX || 'entities';
  const embeddingDeployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-large';
  
  if (!searchEndpoint || !searchKey || !openAIEndpoint || !openAIKey) {
    return { similar: [], error: 'Search or OpenAI credentials not configured' };
  }
  
  try {
    // Generate embedding for search query
    const embeddingResponse = await fetch(
      `${openAIEndpoint}/openai/deployments/${embeddingDeployment}/embeddings?api-version=2024-02-15-preview`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': openAIKey,
        },
        body: JSON.stringify({
          input: entityName,
          model: embeddingDeployment,
        }),
      }
    );
    
    if (!embeddingResponse.ok) {
      throw new Error('Failed to generate query embedding');
    }
    
    const embeddingData = await embeddingResponse.json();
    const queryVector = embeddingData.data[0].embedding;
    
    // Build search query
    const searchBody = {
      vectorQueries: [
        {
          kind: 'vector',
          vector: queryVector,
          fields: 'entityVector',
          k: topK
        }
      ],
      select: 'id,entityType,name,canonicalName,description,aliases,confidence,graphVertexId,mentionCount'
    };
    
    // Add entity type filter if specified
    if (entityType) {
      searchBody.filter = `entityType eq '${entityType}'`;
    }
    
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
      const errorText = await searchResponse.text();
      throw new Error(`Search failed: ${errorText}`);
    }
    
    const searchData = await searchResponse.json();
    
    // Format results with similarity scores
    const similar = (searchData.value || []).map(hit => ({
      id: hit.id,
      name: hit.name,
      canonicalName: hit.canonicalName,
      entityType: hit.entityType,
      description: hit.description,
      aliases: hit.aliases,
      confidence: hit.confidence,
      graphVertexId: hit.graphVertexId,
      mentionCount: hit.mentionCount,
      similarity: hit['@search.score'] || 0,
      // Classification based on similarity (using rubric thresholds)
      classification: hit['@search.score'] >= 0.88 ? 'high_similarity' : 
                      hit['@search.score'] >= 0.75 ? 'medium_similarity' : 'low_similarity'
    }));
    
    return { similar, searchedFor: entityName };
    
  } catch (error) {
    return { similar: [], error: error.message };
  }
}

/**
 * Save document-entity mappings (stored as properties on vertices in Cosmos)
 * This is now handled during vertex creation/update
 */
async function saveDocumentEntityMappings(savedEntities, documentId, chunkId, primaryTopics, entities) {
  // Document mappings are stored as vertex properties in Cosmos DB
  // Primary topic marking
  const client = getGremlinClient();
  
  for (const savedEntity of savedEntities) {
    const isPrimary = primaryTopics.includes(savedEntity.canonical_name);
    if (isPrimary) {
      try {
        const query = `g.V('${escapeGremlin(savedEntity.id)}').property('is_primary_topic', true)`;
        await client.submit(query);
      } catch (error) {
        console.warn(`Failed to mark primary topic:`, error.message);
      }
    }
  }
}

/**
 * Consolidate relationships after merging entities
 * Redirects all edges from duplicate entity to canonical entity
 */
async function consolidateRelationshipsAfterMerge(duplicateVertexId, canonicalVertexId) {
  const client = getGremlinClient();
  
  try {
    // Find all incoming edges (edges pointing TO the duplicate) with their sources
    const incomingQuery = `
      g.V('${escapeGremlin(duplicateVertexId)}')
        .inE()
        .project('edgeId', 'label', 'sourceId')
        .by(id)
        .by(label)
        .by(outV().id())
    `;
    const incomingResult = await client.submit(incomingQuery);
    const incomingEdges = incomingResult._items || [];
    
    // Find all outgoing edges (edges FROM the duplicate) with their targets
    const outgoingQuery = `
      g.V('${escapeGremlin(duplicateVertexId)}')
        .outE()
        .project('edgeId', 'label', 'targetId')
        .by(id)
        .by(label)
        .by(inV().id())
    `;
    const outgoingResult = await client.submit(outgoingQuery);
    const outgoingEdges = outgoingResult._items || [];
    
    let incomingRedirected = 0;
    let outgoingRedirected = 0;
    
    // Process incoming edges - redirect to canonical
    for (const edge of incomingEdges) {
      try {
        const edgeId = edge.edgeId;
        const edgeLabel = edge.label;
        const sourceVertexId = edge.sourceId;
        
        if (!edgeId || !edgeLabel || !sourceVertexId) continue;
        
        // Check if edge already exists from source to canonical
        const checkQuery = `
          g.V('${escapeGremlin(sourceVertexId)}')
            .outE('${escapeGremlin(edgeLabel)}')
            .where(inV().hasId('${escapeGremlin(canonicalVertexId)}'))
        `;
        const existing = await client.submit(checkQuery);
        
        if (!existing._items || existing._items.length === 0) {
          // Create new edge from source to canonical
          const createQuery = `
            g.V('${escapeGremlin(sourceVertexId)}')
              .addE('${escapeGremlin(edgeLabel)}')
              .to(g.V('${escapeGremlin(canonicalVertexId)}'))
          `;
          await client.submit(createQuery);
          incomingRedirected++;
        }
        
        // Delete old edge
        const deleteQuery = `g.E('${escapeGremlin(edgeId)}').drop()`;
        await client.submit(deleteQuery);
      } catch (edgeError) {
        console.warn(`Failed to redirect incoming edge:`, edgeError.message);
      }
    }
    
    // Process outgoing edges - redirect to canonical
    for (const edge of outgoingEdges) {
      try {
        const edgeId = edge.edgeId;
        const edgeLabel = edge.label;
        const targetVertexId = edge.targetId;
        
        if (!edgeId || !edgeLabel || !targetVertexId) continue;
        
        // Check if edge already exists from canonical to target
        const checkQuery = `
          g.V('${escapeGremlin(canonicalVertexId)}')
            .outE('${escapeGremlin(edgeLabel)}')
            .where(inV().hasId('${escapeGremlin(targetVertexId)}'))
        `;
        const existing = await client.submit(checkQuery);
        
        if (!existing._items || existing._items.length === 0) {
          // Create new edge from canonical to target
          const createQuery = `
            g.V('${escapeGremlin(canonicalVertexId)}')
              .addE('${escapeGremlin(edgeLabel)}')
              .to(g.V('${escapeGremlin(targetVertexId)}'))
          `;
          await client.submit(createQuery);
          outgoingRedirected++;
        }
        
        // Delete old edge
        const deleteQuery = `g.E('${escapeGremlin(edgeId)}').drop()`;
        await client.submit(deleteQuery);
      } catch (edgeError) {
        console.warn(`Failed to redirect outgoing edge:`, edgeError.message);
      }
    }
    
    return {
      incomingRedirected,
      outgoingRedirected
    };
  } catch (error) {
    console.warn(`Failed to consolidate relationships:`, error.message);
    return { incomingRedirected: 0, outgoingRedirected: 0 };
  }
}

/**
 * Normalize display/canonical name to form used as map key (e.g. "SA Health" -> "sa_health").
 */
function normalizeNameToCanonicalForm(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Resolve an entity name to a graph vertex ID.
 * 1. Chunk-local map (exact + normalized + alias-resolved name).
 * 2. Graph lookup by canonical_name and name (so "SA Health" matches vertices).
 * 3. Semantic search fallback. Returns { id, method } or null.
 */
async function resolveEntityId(entityName, entityMap, client) {
  if (!entityName || !String(entityName).trim()) return null;

  const normalized = normalizeNameToCanonicalForm(entityName);
  const aliasResolved = resolveCanonicalEntity(normalized || entityName, null);

  // 1. Chunk-local map: try exact, normalized, and alias-resolved
  const localId = entityMap.get(entityName) || entityMap.get(normalized) || entityMap.get(aliasResolved);
  if (localId) return { id: localId, method: 'local' };

  // 2. Graph lookup: try canonical_name and name (display name on vertex)
  const candidates = [entityName, normalized, aliasResolved].filter(Boolean);
  const seen = new Set();
  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    try {
      const graphQuery = `g.V().or(has('canonical_name', '${escapeGremlin(c)}'), has('name', '${escapeGremlin(c)}')).id()`;
      const graphResult = await client.submit(graphQuery);
      if (graphResult._items && graphResult._items.length > 0) {
        return { id: graphResult._items[0], method: 'graph' };
      }
    } catch (err) {
      console.warn(`Graph lookup failed for "${c}": ${err.message}`);
    }
  }

  // 3. Semantic search fallback
  try {
    const semanticResult = await searchSimilarEntities(entityName, null, 3);
    if (semanticResult.similar && semanticResult.similar.length > 0) {
      const best = semanticResult.similar[0];
      if (best.similarity >= 0.88 && best.graphVertexId) {
        const verifyQuery = `g.V('${escapeGremlin(best.graphVertexId)}').id()`;
        const verifyResult = await client.submit(verifyQuery);
        if (verifyResult._items && verifyResult._items.length > 0) {
          return { id: best.graphVertexId, method: 'semantic' };
        }
      }
    }
  } catch (err) {
    console.warn(`Semantic entity resolution failed for "${entityName}": ${err.message}`);
  }

  return null;
}

/**
 * Save relationships as edges in Cosmos DB
 * Resolves missing entities via graph lookup and semantic search before skipping.
 * Returns resolution stats for audit logging.
 */
async function saveRelationshipsToCosmos(relationships, savedEntities, documentId, chunkId) {
  const client = getGremlinClient();
  const entityMap = new Map(savedEntities.map(e => [e.canonical_name, e.id]));

  const stats = {
    created: 0,
    resolvedViaGraph: 0,
    resolvedViaSemantic: 0,
    skipped: 0,
    skippedDetails: [],
    duplicatesSkipped: 0,
    errors: 0
  };

  for (const rel of relationships) {
    try {
      // Resolve both sides
      const sourceResolution = await resolveEntityId(rel.sourceEntity, entityMap, client);
      const targetResolution = await resolveEntityId(rel.targetEntity, entityMap, client);

      if (!sourceResolution || !targetResolution) {
        const missingSide = !sourceResolution && !targetResolution ? 'both'
          : !sourceResolution ? 'source' : 'target';
        const missingNames = !sourceResolution && !targetResolution
          ? `${rel.sourceEntity}, ${rel.targetEntity}`
          : !sourceResolution ? rel.sourceEntity : rel.targetEntity;

        console.warn(`Skipping relationship: unresolvable ${missingSide} entity (${rel.sourceEntity} -[${rel.relationshipType}]-> ${rel.targetEntity}). Missing: ${missingNames}. Attempted: local map, graph lookup, semantic search.`);
        stats.skipped++;
        stats.skippedDetails.push({
          source: rel.sourceEntity,
          target: rel.targetEntity,
          type: rel.relationshipType,
          missingSide,
          missingNames
        });
        continue;
      }

      const sourceId = sourceResolution.id;
      const targetId = targetResolution.id;

      // Track resolution methods
      if (sourceResolution.method === 'graph' || targetResolution.method === 'graph') {
        stats.resolvedViaGraph++;
      }
      if (sourceResolution.method === 'semantic' || targetResolution.method === 'semantic') {
        stats.resolvedViaSemantic++;
      }

      // Check if edge already exists
      const checkQuery = `
        g.V('${escapeGremlin(sourceId)}')
          .outE('${escapeGremlin(rel.relationshipType)}')
          .where(inV().hasId('${escapeGremlin(targetId)}'))
      `;
      const existing = await client.submit(checkQuery);

      if (existing._items && existing._items.length > 0) {
        stats.duplicatesSkipped++;
        continue;
      }

      // Create new edge
      const createQuery = `
        g.V('${escapeGremlin(sourceId)}')
          .addE('${escapeGremlin(rel.relationshipType)}')
          .to(g.V('${escapeGremlin(targetId)}'))
          .property('strength', ${rel.strength || 0.8})
          .property('evidence', '${escapeGremlin(rel.evidence || '')}')
          .property('source_document', '${escapeGremlin(documentId)}')
          .property('source_chunk', '${escapeGremlin(chunkId)}')
          .property('created_at', '${new Date().toISOString()}')
      `;
      await client.submit(createQuery);
      stats.created++;
    } catch (error) {
      console.warn(`Failed to save relationship (${rel.sourceEntity} -> ${rel.targetEntity}):`, error.message);
      stats.errors++;
    }
  }

  // Summary log
  console.log(`Relationships: ${stats.created} created, ${stats.resolvedViaGraph} resolved via graph, ${stats.resolvedViaSemantic} resolved via semantic, ${stats.skipped} skipped, ${stats.duplicatesSkipped} duplicates, ${stats.errors} errors`);

  return stats;
}

/**
 * Aggregate impacts after merging entities
 * Merges impacts from duplicate entity into canonical entity
 */
async function aggregateImpactsAfterMerge(duplicateVertexId, canonicalVertexId) {
  const client = getGremlinClient();
  
  try {
    // Find all impacts linked to duplicate entity (via 'affects' edge)
    const impactsQuery = `
      g.V('${escapeGremlin(duplicateVertexId)}')
        .inE('affects')
        .outV()
        .hasLabel('impact')
        .valueMap(true)
    `;
    const impactsResult = await client.submit(impactsQuery);
    const impacts = impactsResult._items || [];
    
    let impactsRedirected = 0;
    const processedImpacts = new Set();
    
    for (const impact of impacts) {
      try {
        const impactId = impact.id;
        if (!impactId || processedImpacts.has(impactId)) continue;
        processedImpacts.add(impactId);
        
        // Get impact properties
        const policyId = impact.properties?.policy_id?.[0]?.value || '';
        const affectedEntity = impact.properties?.affected_entity?.[0]?.value || '';
        const impactType = impact.properties?.impact_type?.[0]?.value || '';
        
        // Check if similar impact already exists for canonical entity
        const checkQuery = `
          g.V('${escapeGremlin(canonicalVertexId)}')
            .inE('affects')
            .outV()
            .hasLabel('impact')
            .has('policy_id', '${escapeGremlin(policyId)}')
            .has('impact_type', '${escapeGremlin(impactType)}')
        `;
        const existing = await client.submit(checkQuery);
        
        if (existing._items && existing._items.length > 0) {
          // Similar impact exists - merge quantitative values
          const existingImpact = existing._items[0];
          const existingImpactId = existingImpact.id;
          
          // Get quantitative values from both impacts
          const duplicateQuantValue = impact.properties?.quantitative_value?.[0]?.value || '';
          const existingQuantValue = existingImpact.properties?.quantitative_value?.[0]?.value || '';
          const duplicateDirection = impact.properties?.direction?.[0]?.value || '';
          const existingDirection = existingImpact.properties?.direction?.[0]?.value || '';
          
          // Merge quantitative values if both have them
          if (duplicateQuantValue && existingQuantValue) {
            const mergedValue = mergeQuantitativeValues(
              duplicateQuantValue,
              existingQuantValue,
              duplicateDirection,
              existingDirection
            );
            
            // Update existing impact with merged value
            if (mergedValue !== existingQuantValue) {
              const updateQuery = `
                g.V('${escapeGremlin(existingImpactId)}')
                  .property('quantitative_value', '${escapeGremlin(mergedValue)}')
                  .property('updated_at', '${new Date().toISOString()}')
              `;
              await client.submit(updateQuery);
            }
          } else if (duplicateQuantValue && !existingQuantValue) {
            // Use duplicate's value if existing doesn't have one
            const updateQuery = `
              g.V('${escapeGremlin(existingImpactId)}')
                .property('quantitative_value', '${escapeGremlin(duplicateQuantValue)}')
                .property('updated_at', '${new Date().toISOString()}')
            `;
            await client.submit(updateQuery);
          }
          
          // Delete old edge from impact to duplicate
          const deleteOldEdge = `
            g.V('${escapeGremlin(impactId)}')
              .outE('affects')
              .where(inV().hasId('${escapeGremlin(duplicateVertexId)}'))
              .drop()
          `;
          await client.submit(deleteOldEdge);
          
          // Create edge from impact to canonical (if not exists)
          const checkNewEdge = `
            g.V('${escapeGremlin(impactId)}')
              .outE('affects')
              .where(inV().hasId('${escapeGremlin(canonicalVertexId)}'))
          `;
          const newEdgeExists = await client.submit(checkNewEdge);
          
          if (!newEdgeExists._items || newEdgeExists._items.length === 0) {
            const createEdge = `
              g.V('${escapeGremlin(impactId)}')
                .addE('affects')
                .to(g.V('${escapeGremlin(canonicalVertexId)}'))
            `;
            await client.submit(createEdge);
            impactsRedirected++;
          }
        } else {
          // No similar impact - redirect edge to canonical
          const deleteOldEdge = `
            g.V('${escapeGremlin(impactId)}')
              .outE('affects')
              .where(inV().hasId('${escapeGremlin(duplicateVertexId)}'))
              .drop()
          `;
          await client.submit(deleteOldEdge);
          
          const createEdge = `
            g.V('${escapeGremlin(impactId)}')
              .addE('affects')
              .to(g.V('${escapeGremlin(canonicalVertexId)}'))
          `;
          await client.submit(createEdge);
          impactsRedirected++;
        }
      } catch (impactError) {
        console.warn(`Failed to redirect impact:`, impactError.message);
      }
    }
    
    return { impactsRedirected };
  } catch (error) {
    console.warn(`Failed to aggregate impacts:`, error.message);
    return { impactsRedirected: 0 };
  }
}

/**
 * Save impacts to Cosmos DB as vertices with edges to related entities
 * Each impact is stored as a vertex with edges to the policy and affected entity
 */
async function saveImpactsToCosmos(impacts, savedEntities, documentId, chunkId) {
  const emptyResult = { savedImpacts: [], stats: { policyEdgesCreated: 0, affectsEdgesCreated: 0, policyEdgesSkipped: 0, affectsEdgesSkipped: 0, resolvedViaGraph: 0, resolvedViaSemantic: 0, skippedDetails: [], errors: 0 } };
  if (!impacts || impacts.length === 0) return emptyResult;

  const client = getGremlinClient();
  const savedImpacts = [];
  const entityMap = new Map(savedEntities.map(e => [e.canonical_name, e.id]));

  const stats = {
    policyEdgesCreated: 0,
    affectsEdgesCreated: 0,
    policyEdgesSkipped: 0,
    affectsEdgesSkipped: 0,
    resolvedViaGraph: 0,
    resolvedViaSemantic: 0,
    skippedDetails: [],
    errors: 0
  };

  for (const impact of impacts) {
    try {
      // Generate unique impact ID
      const impactId = `impact_${impact.policyId}_${impact.affectedEntity}_${impact.impactType}_${Date.now()}`.substring(0, 100);

      // Create impact vertex (always created -- data is never lost).
      // Cosmos graph partition key is /entity_type (see cosmos-graph.bicep); must set entity_type so partition key is non-null.
      const createQuery = `
        g.addV('impact')
          .property('id', '${escapeGremlin(impactId)}')
          .property('entity_type', 'impact')
          .property('partitionKey', 'impact')
          .property('policy_id', '${escapeGremlin(impact.policyId || '')}')
          .property('policy_name', '${escapeGremlin(impact.policyName || impact.policyId || '')}')
          .property('affected_entity', '${escapeGremlin(impact.affectedEntity || '')}')
          .property('affected_entity_type', '${escapeGremlin(impact.affectedEntityType || '')}')
          .property('impact_type', '${escapeGremlin(impact.impactType || '')}')
          .property('direction', '${escapeGremlin(impact.direction || '')}')
          .property('severity', '${escapeGremlin(impact.severity || 'medium')}')
          .property('confidence', ${impact.confidence || 0.7})
          .property('evidence_text', '${escapeGremlin((impact.evidenceText || '').substring(0, 500))}')
          .property('quantitative_value', '${escapeGremlin(impact.quantitativeValue || '')}')
          .property('timeframe', '${escapeGremlin(impact.timeframe || '')}')
          .property('source_document', '${escapeGremlin(documentId)}')
          .property('source_chunk', '${escapeGremlin(chunkId)}')
          .property('created_at', '${new Date().toISOString()}')
      `;

      await client.submit(createQuery);

      // Resolve policy entity (local map -> graph -> semantic search)
      const policyResolution = impact.policyId ? await resolveEntityId(impact.policyId, entityMap, client) : null;

      if (policyResolution) {
        if (policyResolution.method === 'graph') stats.resolvedViaGraph++;
        if (policyResolution.method === 'semantic') stats.resolvedViaSemantic++;
        try {
          const policyEdgeQuery = `
            g.V('${escapeGremlin(policyResolution.id)}')
              .addE('has_impact')
              .to(g.V('${escapeGremlin(impactId)}'))
              .property('source_document', '${escapeGremlin(documentId)}')
              .property('created_at', '${new Date().toISOString()}')
          `;
          await client.submit(policyEdgeQuery);
          stats.policyEdgesCreated++;
        } catch (edgeErr) {
          console.warn(`Failed to create policy->impact edge (${impact.policyId} -> ${impactId}):`, edgeErr.message);
          stats.errors++;
        }
      } else if (impact.policyId) {
        console.warn(`Impact edge skipped: policy "${impact.policyId}" unresolvable (tried: local map, graph lookup, semantic search). Impact: ${impactId}`);
        stats.policyEdgesSkipped++;
        stats.skippedDetails.push({ impactId, edgeType: 'has_impact', missingEntity: impact.policyId, side: 'policy' });
      }

      // Resolve affected entity (local map -> graph -> semantic search)
      const affectedResolution = impact.affectedEntity ? await resolveEntityId(impact.affectedEntity, entityMap, client) : null;

      if (affectedResolution) {
        if (affectedResolution.method === 'graph') stats.resolvedViaGraph++;
        if (affectedResolution.method === 'semantic') stats.resolvedViaSemantic++;
        try {
          const affectedEdgeQuery = `
            g.V('${escapeGremlin(impactId)}')
              .addE('affects')
              .to(g.V('${escapeGremlin(affectedResolution.id)}'))
              .property('impact_type', '${escapeGremlin(impact.impactType || '')}')
              .property('direction', '${escapeGremlin(impact.direction || '')}')
              .property('severity', '${escapeGremlin(impact.severity || '')}')
              .property('source_document', '${escapeGremlin(documentId)}')
              .property('created_at', '${new Date().toISOString()}')
          `;
          await client.submit(affectedEdgeQuery);
          stats.affectsEdgesCreated++;
        } catch (edgeErr) {
          console.warn(`Failed to create impact->affected edge (${impactId} -> ${impact.affectedEntity}):`, edgeErr.message);
          stats.errors++;
        }
      } else if (impact.affectedEntity) {
        console.warn(`Impact edge skipped: affected entity "${impact.affectedEntity}" unresolvable (tried: local map, graph lookup, semantic search). Impact: ${impactId}`);
        stats.affectsEdgesSkipped++;
        stats.skippedDetails.push({ impactId, edgeType: 'affects', missingEntity: impact.affectedEntity, side: 'affected' });
      }

      savedImpacts.push({
        id: impactId,
        policyId: impact.policyId,
        affectedEntity: impact.affectedEntity,
        impactType: impact.impactType,
        direction: impact.direction,
        severity: impact.severity
      });

    } catch (error) {
      console.warn(`Failed to save impact:`, error.message);
      stats.errors++;
    }
  }

  // Summary log
  const totalEdgesCreated = stats.policyEdgesCreated + stats.affectsEdgesCreated;
  const totalEdgesSkipped = stats.policyEdgesSkipped + stats.affectsEdgesSkipped;
  if (impacts.length > 0) {
    console.log(`Impact edges: ${totalEdgesCreated} created (${stats.policyEdgesCreated} policy, ${stats.affectsEdgesCreated} affects), ${totalEdgesSkipped} skipped, ${stats.resolvedViaGraph} resolved via graph, ${stats.resolvedViaSemantic} resolved via semantic`);
  }

  return { savedImpacts, stats };
}

/**
 * Get all entities from Cosmos DB for post-processing
 */
async function getAllEntitiesFromCosmos(limit = 10000) {
  const entities = [];
  let client;
  try {
    client = getGremlinClient();
    if (!client) return entities;
  } catch (e) {
    console.warn('getAllEntitiesFromCosmos: Gremlin client not available', e.message);
    return entities;
  }
  try {
    const query = `g.V().has('entity_type').valueMap(true).limit(${Math.min(limit, 10000)})`;
    const result = await client.submit(query);
    const items = result && (Array.isArray(result) ? result : (result._items || []));
    if (!Array.isArray(items)) return entities;

    for (const item of items) {
      if (!item || item.id == null) continue;
      const entity = {
        id: item.id,
        entityType: item.properties?.entity_type?.[0]?.value || '',
        name: item.properties?.name?.[0]?.value || '',
        canonicalName: item.properties?.canonical_name?.[0]?.value || '',
        aliases: item.properties?.aliases?.[0]?.value || '[]',
        description: item.properties?.description?.[0]?.value || '',
        mentionCount: parseInt(item.properties?.mention_count?.[0]?.value || '0', 10)
      };
      try {
        entity.aliases = JSON.parse(entity.aliases);
      } catch (e) {
        entity.aliases = [];
      }
      entities.push(entity);
    }
  } catch (error) {
    console.warn('getAllEntitiesFromCosmos failed:', error.message);
  }
  return entities;
}

/**
 * Merge two entities - consolidate duplicate into canonical
 */
async function mergeEntities(duplicateVertexId, canonicalVertexId) {
  const client = getGremlinClient();
  
  try {
    // Get duplicate entity properties
    const duplicateQuery = `g.V('${escapeGremlin(duplicateVertexId)}').valueMap(true)`;
    const duplicateResult = await client.submit(duplicateQuery);
    const duplicateEntity = duplicateResult._items?.[0];
    
    if (!duplicateEntity) {
      return { success: false, error: 'Duplicate entity not found' };
    }
    
    // Get canonical entity properties
    const canonicalQuery = `g.V('${escapeGremlin(canonicalVertexId)}').valueMap(true)`;
    const canonicalResult = await client.submit(canonicalQuery);
    const canonicalEntity = canonicalResult._items?.[0];
    
    if (!canonicalEntity) {
      return { success: false, error: 'Canonical entity not found' };
    }
    
    // Merge aliases
    const duplicateAliases = JSON.parse(duplicateEntity.properties?.aliases?.[0]?.value || '[]');
    const canonicalAliases = JSON.parse(canonicalEntity.properties?.aliases?.[0]?.value || '[]');
    const mergedAliases = Array.from(new Set([...canonicalAliases, ...duplicateAliases]));
    
    // Update canonical entity with merged aliases and increment mention count
    const duplicateMentionCount = parseInt(duplicateEntity.properties?.mention_count?.[0]?.value || '0', 10);
    const canonicalMentionCount = parseInt(canonicalEntity.properties?.mention_count?.[0]?.value || '0', 10);
    
    const updateQuery = `
      g.V('${escapeGremlin(canonicalVertexId)}')
        .property('aliases', '${escapeGremlin(JSON.stringify(mergedAliases))}')
        .property('mention_count', ${canonicalMentionCount + duplicateMentionCount})
        .property('last_updated', '${new Date().toISOString()}')
    `;
    await client.submit(updateQuery);
    
    // Consolidate relationships
    const relationshipResult = await consolidateRelationshipsAfterMerge(duplicateVertexId, canonicalVertexId);
    
    // Aggregate impacts
    const impactResult = await aggregateImpactsAfterMerge(duplicateVertexId, canonicalVertexId);
    
    // Delete duplicate vertex
    const deleteQuery = `g.V('${escapeGremlin(duplicateVertexId)}').drop()`;
    await client.submit(deleteQuery);
    
    return {
      success: true,
      relationshipsRedirected: relationshipResult.incomingRedirected + relationshipResult.outgoingRedirected,
      impactsRedirected: impactResult.impactsRedirected
    };
  } catch (error) {
    console.warn(`Failed to merge entities:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Find potential duplicates (similarity 0.75-0.88) for manual review
 */
async function findPotentialDuplicates() {
  const client = getGremlinClient();
  const potentialDuplicates = [];
  
  try {
    const allEntities = await getAllEntitiesFromCosmos();
    const processed = new Set();
    const entityMap = new Map();
    
    // Build entity map
    for (const entity of allEntities) {
      entityMap.set(entity.id, entity);
    }
    
    for (const entity of allEntities) {
      if (processed.has(entity.id)) continue;
      
      try {
        // Search for similar entities
        const semanticResult = await searchSimilarEntities(entity.name, entity.entityType, 10);
        
        if (semanticResult.similar && semanticResult.similar.length > 0) {
          for (const match of semanticResult.similar) {
            // Skip if same entity or already processed
            if (match.graphVertexId === entity.id || processed.has(match.graphVertexId)) {
              continue;
            }
            
            // Track potential duplicates (similarity 0.75-0.88)
            if (match.similarity >= 0.75 && match.similarity < 0.88) {
              const matchEntity = entityMap.get(match.graphVertexId);
              if (!matchEntity) continue;
              
              potentialDuplicates.push({
                entity1: {
                  id: entity.id,
                  name: entity.name,
                  canonicalName: entity.canonicalName,
                  entityType: entity.entityType,
                  mentionCount: entity.mentionCount
                },
                entity2: {
                  id: match.graphVertexId,
                  name: match.name,
                  canonicalName: match.canonicalName,
                  entityType: match.entityType,
                  mentionCount: match.mentionCount || 0
                },
                similarity: match.similarity,
                similarityPercent: Math.round(match.similarity * 100),
                recommendation: match.similarity >= 0.85 ? 'likely_duplicate' : 'possible_duplicate'
              });
            }
          }
        }
        
        processed.add(entity.id);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        console.warn(`Error checking potential duplicates for ${entity.id}:`, error.message);
      }
    }
    
    // Sort by similarity (highest first)
    potentialDuplicates.sort((a, b) => b.similarity - a.similarity);
    
    return potentialDuplicates;
  } catch (error) {
    console.error(`Failed to find potential duplicates:`, error);
    return [];
  }
}

/**
 * Post-processing deduplication pass
 * Queries all entities and merges duplicates found via semantic similarity
 */
async function postProcessDeduplication() {
  const client = getGremlinClient();
  const stats = {
    totalEntities: 0,
    duplicatesFound: 0,
    duplicatesMerged: 0,
    relationshipsRedirected: 0,
    impactsRedirected: 0,
    potentialDuplicates: [], // NEW: Track potential duplicates for review
    errors: []
  };
  
  try {
    // Get all entities from Cosmos DB
    const allEntities = await getAllEntitiesFromCosmos();
    stats.totalEntities = allEntities.length;
    
    const processed = new Set();
    const entityMap = new Map(); // Map entity ID to entity object
    
    // Build entity map
    for (const entity of allEntities) {
      entityMap.set(entity.id, entity);
    }
    
    console.log(`Post-processing deduplication: Checking ${allEntities.length} entities...`);
    
    // Process each entity
    for (const entity of allEntities) {
      if (processed.has(entity.id)) continue;
      
      try {
        // Search for similar entities
        const semanticResult = await searchSimilarEntities(entity.name, entity.entityType, 10);
        
        if (semanticResult.similar && semanticResult.similar.length > 0) {
          for (const match of semanticResult.similar) {
            // Skip if same entity or already processed
            if (match.graphVertexId === entity.id || processed.has(match.graphVertexId)) {
              continue;
            }
            
            // Track potential duplicates (0.75-0.88) for manual review
            if (match.similarity >= 0.75 && match.similarity < 0.88) {
              const matchEntity = entityMap.get(match.graphVertexId);
              if (matchEntity) {
                stats.potentialDuplicates.push({
                  entity1: {
                    id: entity.id,
                    name: entity.name,
                    canonicalName: entity.canonicalName,
                    mentionCount: entity.mentionCount
                  },
                  entity2: {
                    id: match.graphVertexId,
                    name: match.name,
                    canonicalName: match.canonicalName,
                    mentionCount: matchEntity.mentionCount
                  },
                  similarity: match.similarity,
                  similarityPercent: Math.round(match.similarity * 100),
                  recommendation: match.similarity >= 0.85 ? 'likely_duplicate' : 'possible_duplicate'
                });
              }
            }
            
            // If similarity is high enough (>= 0.88), merge
            if (match.similarity >= 0.88) {
              stats.duplicatesFound++;
              
              // Determine which is canonical (use the one with more mentions)
              const matchEntity = entityMap.get(match.graphVertexId);
              if (!matchEntity) continue;
              
              const canonicalId = entity.mentionCount >= matchEntity.mentionCount 
                ? entity.id 
                : match.graphVertexId;
              const duplicateId = canonicalId === entity.id 
                ? match.graphVertexId 
                : entity.id;
              
              // Merge entities
              const mergeResult = await mergeEntities(duplicateId, canonicalId);
              
              if (mergeResult.success) {
                stats.duplicatesMerged++;
                stats.relationshipsRedirected += mergeResult.relationshipsRedirected || 0;
                stats.impactsRedirected += mergeResult.impactsRedirected || 0;
                
                // Mark both as processed
                processed.add(duplicateId);
                processed.add(canonicalId);
                
                console.log(`Merged duplicate: ${duplicateId} -> ${canonicalId} (similarity: ${(match.similarity * 100).toFixed(1)}%)`);
              } else {
                stats.errors.push({
                  duplicateId,
                  canonicalId,
                  error: mergeResult.error
                });
              }
              
              // Break after first merge to avoid multiple merges
              break;
            }
          }
        }
        
        // Mark as processed if not merged
        if (!processed.has(entity.id)) {
          processed.add(entity.id);
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        stats.errors.push({
          entityId: entity.id,
          error: error.message
        });
        console.warn(`Error processing entity ${entity.id}:`, error.message);
      }
    }
    
    // Sort potential duplicates by similarity (highest first)
    stats.potentialDuplicates.sort((a, b) => b.similarity - a.similarity);
    
    console.log(`Post-processing complete: ${stats.duplicatesMerged} duplicates merged, ${stats.potentialDuplicates.length} potential duplicates found for review`);
    return stats;
  } catch (error) {
    console.error(`Post-processing deduplication failed:`, error);
    stats.errors.push({ error: error.message });
    return stats;
  }
}

/**
 * Refine canonical names - use most common alias as canonical name
 */
async function refineCanonicalNames() {
  const client = getGremlinClient();
  const stats = {
    entitiesProcessed: 0,
    canonicalNamesUpdated: 0,
    errors: []
  };
  
  try {
    const allEntities = await getAllEntitiesFromCosmos();
    stats.entitiesProcessed = allEntities.length;
    
    for (const entity of allEntities) {
      try {
        const aliases = Array.isArray(entity.aliases) ? entity.aliases : [];
        if (aliases.length === 0) continue;
        
        // Count mentions of each alias (simplified - use alias as key)
        const aliasCounts = new Map();
        for (const alias of aliases) {
          // Normalize alias for counting
          const normalized = alias.toLowerCase().replace(/[^a-z0-9_]/g, '_');
          aliasCounts.set(normalized, (aliasCounts.get(normalized) || 0) + 1);
        }
        
        // Find most common alias
        let mostCommonAlias = entity.canonicalName;
        let maxCount = 0;
        
        for (const [alias, count] of aliasCounts.entries()) {
          if (count > maxCount) {
            maxCount = count;
            mostCommonAlias = alias;
          }
        }
        
        // Update if different
        if (mostCommonAlias !== entity.canonicalName) {
          const newVertexId = `${entity.entityType}_${mostCommonAlias}`;
          
          // Check if new vertex ID already exists
          const checkQuery = `g.V('${escapeGremlin(newVertexId)}')`;
          const existing = await client.submit(checkQuery);
          
          if (!existing._items || existing._items.length === 0) {
            // Update canonical name
            const updateQuery = `
              g.V('${escapeGremlin(entity.id)}')
                .property('canonical_name', '${escapeGremlin(mostCommonAlias)}')
                .property('last_updated', '${new Date().toISOString()}')
            `;
            await client.submit(updateQuery);
            stats.canonicalNamesUpdated++;
          }
        }
      } catch (error) {
        stats.errors.push({
          entityId: entity.id,
          error: error.message
        });
        console.warn(`Failed to refine canonical name for ${entity.id}:`, error.message);
      }
    }
    
    return stats;
  } catch (error) {
    console.error(`Canonical name refinement failed:`, error);
    stats.errors.push({ error: error.message });
    return stats;
  }
}

/**
 * Validate entities appearing in multiple documents
 */
async function validateCrossDocumentEntities() {
  const client = getGremlinClient();
  const stats = {
    entitiesProcessed: 0,
    entitiesVerified: 0,
    errors: []
  };
  
  try {
    const allEntities = await getAllEntitiesFromCosmos();
    stats.entitiesProcessed = allEntities.length;
    
    for (const entity of allEntities) {
      try {
        // Count documents this entity appears in
        // This is simplified - in reality, we'd track source_document properties
        const documentCount = entity.mentionCount; // Use mention count as proxy
        
        if (documentCount >= 3) {
          // Mark as verified
          const updateQuery = `
            g.V('${escapeGremlin(entity.id)}')
              .property('is_verified', true)
              .property('verification_date', '${new Date().toISOString()}')
              .property('document_count', ${documentCount})
              .property('last_updated', '${new Date().toISOString()}')
          `;
          await client.submit(updateQuery);
          stats.entitiesVerified++;
        }
      } catch (error) {
        stats.errors.push({
          entityId: entity.id,
          error: error.message
        });
        console.warn(`Failed to validate entity ${entity.id}:`, error.message);
      }
    }
    
    return stats;
  } catch (error) {
    console.error(`Cross-document validation failed:`, error);
    stats.errors.push({ error: error.message });
    return stats;
  }
}

/**
 * Process a batch of chunks
 * @param {string} [documentIdFilter] - If set, only chunks from this documentId are fetched (for focusing on specific docs, e.g. impact tuning).
 */
async function processBatch(openAIEndpoint, openAIKey, searchEndpoint, searchKey, searchIndex, batchSize = 10, offset = 0, documentIdFilter = null) {
  // Fetch chunks from Azure Search
  const searchBody = {
    search: '*',
    queryType: 'simple',
    top: batchSize,
    skip: offset,
    select: 'id,content,documentId,title,category,sector',
    orderby: 'documentId',
  };
  if (documentIdFilter && typeof documentIdFilter === 'string' && documentIdFilter.trim()) {
    // OData filter: escape single quotes in value
    const escaped = documentIdFilter.trim().replace(/'/g, "''");
    searchBody.filter = `documentId eq '${escaped}'`;
  }

  const searchResponse = await fetch(
    `${searchEndpoint}/indexes/${searchIndex}/docs/search?api-version=2023-11-01`,
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
    throw new Error(`Failed to fetch chunks: ${await searchResponse.text()}`);
  }

  const searchData = await searchResponse.json();
  const chunks = searchData.value || [];

  const results = [];

  for (const chunk of chunks) {
    try {
      // Extract entities from chunk
      const extraction = await extractEntities(
        openAIEndpoint, openAIKey,
        chunk.content,
        chunk.documentId,
        chunk.id
      );

      // Save entities to Cosmos DB
      const savedEntities = await saveEntitiesToCosmos(
        extraction.entities,
        chunk.documentId,
        chunk.id
      );

      // Save document-entity mappings
      await saveDocumentEntityMappings(
        savedEntities,
        chunk.documentId,
        chunk.id,
        extraction.primaryTopics,
        extraction.entities
      );

      // Save relationships to Cosmos DB (with cross-chunk resolution)
      const relStats = await saveRelationshipsToCosmos(
        extraction.relationships,
        savedEntities,
        chunk.documentId,
        chunk.id
      );

      // Save impacts to Cosmos DB (with cross-chunk edge resolution)
      const impactResult = await saveImpactsToCosmos(
        extraction.impacts || [],
        savedEntities,
        chunk.documentId,
        chunk.id
      );
      const savedImpacts = impactResult.savedImpacts;
      const impactStats = impactResult.stats;

      // Index entities to Azure Search for semantic discovery
      const indexResult = await indexEntitiesToSearch(
        extraction.entities,
        savedEntities,
        chunk.documentId,
        openAIEndpoint,
        openAIKey
      );

      results.push({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        entitiesExtracted: extraction.entities.length,
        relationshipsExtracted: extraction.relationships.length,
        relationshipsCreated: relStats.created,
        relationshipsResolved: relStats.resolvedViaGraph + relStats.resolvedViaSemantic,
        relationshipsResolvedViaGraph: relStats.resolvedViaGraph,
        relationshipsResolvedViaSemantic: relStats.resolvedViaSemantic,
        relationshipsSkipped: relStats.skipped,
        relationshipsSkippedDetails: relStats.skippedDetails,
        impactsExtracted: savedImpacts.length,
        impactEdgesCreated: impactStats.policyEdgesCreated + impactStats.affectsEdgesCreated,
        impactEdgesSkipped: impactStats.policyEdgesSkipped + impactStats.affectsEdgesSkipped,
        impactEdgesResolvedViaGraph: impactStats.resolvedViaGraph,
        impactEdgesResolvedViaSemantic: impactStats.resolvedViaSemantic,
        impactEdgesSkippedDetails: impactStats.skippedDetails,
        entitiesIndexed: indexResult.indexed,
        entitiesIndexSkipped: indexResult.skipped || 0,
        entitiesIndexSkippedDetails: indexResult.skippedDetails || [],
        entitiesIndexEmbeddingRetries: indexResult.embeddingRetries || 0,
        success: true,
      });

    } catch (error) {
      results.push({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        success: false,
        error: error.message,
      });
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return {
    processed: results.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
    hasMore: chunks.length === batchSize,
    nextOffset: offset + batchSize,
  };
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

  context.log('Entity Extraction request received');

  let requestMode = 'single'; // so outer catch can return 200 for deduplicate
  try {
    // Parse request
    let request = {};
    if (typeof req.body === 'string' && req.body.trim()) {
      request = JSON.parse(req.body);
    } else if (req.body) {
      request = req.body;
    }

    const { 
      mode = 'single', // 'single', 'batch', 'deduplicate', or 'backfill_relationships'
      text,
      documentId,
      chunkId,
      batchSize = 10,
      offset = 0,
      documentIdFilter, // optional: only process chunks from this document (batch mode)
    } = request;
    requestMode = mode;

    // Get credentials
    const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const openAIKey = process.env.AZURE_OPENAI_KEY;
    const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const searchKey = process.env.AZURE_SEARCH_KEY;
    const searchIndex = process.env.AZURE_SEARCH_INDEX || 'sa-gov-documents';

    if (!openAIEndpoint || !openAIKey) {
      throw new Error('Azure OpenAI credentials not configured');
    }

    if (!process.env.COSMOS_GREMLIN_ENDPOINT || !process.env.COSMOS_PRIMARY_KEY) {
      context.res = {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Cosmos DB not configured - entity extraction unavailable', entities: [], relationships: [] }),
      };
      return;
    }

    const startTime = Date.now();

    if (mode === 'deduplicate') {
      // Post-processing deduplication mode - always return 200 so client can read error from body
      context.log('Starting post-processing deduplication...');

      const safeDeduplicateResponse = (success, errorMessage, resultsObj) => {
        const errMsg = errorMessage != null ? String(errorMessage) : null;
        const body = {
          success: !!success,
          executionTime: Date.now() - startTime,
          error: errMsg || undefined,
        };
        if (resultsObj && success) {
          body.deduplication = resultsObj.deduplication;
          body.canonicalRefinement = resultsObj.canonicalRefinement;
          body.validation = resultsObj.validation;
          if (resultsObj.deduplication != null) {
            body.summary = {
              duplicatesMerged: resultsObj.deduplication.duplicatesMerged ?? 0,
              canonicalNamesUpdated: (resultsObj.canonicalRefinement && resultsObj.canonicalRefinement.canonicalNamesUpdated) ?? 0,
              entitiesVerified: (resultsObj.validation && resultsObj.validation.entitiesVerified) ?? 0,
              potentialDuplicatesFound: (resultsObj.deduplication.potentialDuplicates?.length) ?? 0,
              totalErrors: (resultsObj.deduplication?.errors?.length || 0) +
                (resultsObj.canonicalRefinement?.errors?.length || 0) +
                (resultsObj.validation?.errors?.length || 0),
            };
            body.potentialDuplicates = (resultsObj.deduplication.potentialDuplicates || []).slice(0, 50);
          }
        }
        context.res = {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        };
      };

      try {
        if (!process.env.COSMOS_GREMLIN_ENDPOINT || !process.env.COSMOS_PRIMARY_KEY || !process.env.COSMOS_DATABASE || !process.env.COSMOS_GRAPH) {
          context.log.warn('Post-processing skipped: Cosmos DB env vars not set');
          safeDeduplicateResponse(false, 'Cosmos DB not configured. Set COSMOS_GREMLIN_ENDPOINT, COSMOS_PRIMARY_KEY, COSMOS_DATABASE, COSMOS_GRAPH.', null);
          return;
        }

        const results = {
          deduplication: null,
          canonicalRefinement: null,
          validation: null,
        };

        // Step 1: Post-processing deduplication
        context.log('Step 1: Running deduplication pass...');
        results.deduplication = await postProcessDeduplication();

        // Step 2: Canonical name refinement
        context.log('Step 2: Refining canonical names...');
        results.canonicalRefinement = await refineCanonicalNames();

        // Step 3: Cross-document validation
        context.log('Step 3: Validating cross-document entities...');
        results.validation = await validateCrossDocumentEntities();

        context.log(`Post-processing complete in ${Date.now() - startTime}ms`);
        safeDeduplicateResponse(true, null, results);
        return;
      } catch (error) {
        context.log('Post-processing error:', error && error.message ? error.message : error);
        const errMsg = error instanceof Error ? error.message : String(error);
        try {
          safeDeduplicateResponse(false, errMsg, null);
        } catch (serializeErr) {
          context.res = {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: errMsg, executionTime: Date.now() - startTime }),
          };
        }
        return;
      }
    }

    if (mode === 'backfill_relationships') {
      // Backfill skipped relationships after all entities are in the graph.
      // Accepts an array of { source, target, type, strength, evidence, documentId, chunkId }
      // and retries resolution via graph lookup + semantic search.
      context.log('Starting relationship backfill pass...');

      const relationships = request.relationships || [];
      const impactEdges = request.impactEdges || [];

      if (relationships.length === 0 && impactEdges.length === 0) {
        context.res = {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            message: 'No skipped relationships or impact edges to backfill',
            stats: { backfilled: 0, stillUnresolvable: 0, duplicatesSkipped: 0, errors: 0 },
            impactStats: { backfilled: 0, stillUnresolvable: 0, errors: 0 },
            executionTime: Date.now() - startTime,
          }),
        };
        return;
      }

      const client = getGremlinClient();
      const emptyEntityMap = new Map(); // no local map for backfill, rely on graph + semantic

      const stats = {
        total: relationships.length,
        backfilled: 0,
        stillUnresolvable: 0,
        stillUnresolvableDetails: [],
        duplicatesSkipped: 0,
        errors: 0,
      };

      for (const rel of relationships) {
        try {
          const sourceResolution = await resolveEntityId(rel.source, emptyEntityMap, client);
          const targetResolution = await resolveEntityId(rel.target, emptyEntityMap, client);

          if (!sourceResolution || !targetResolution) {
            const missingSide = !sourceResolution && !targetResolution ? 'both'
              : !sourceResolution ? 'source' : 'target';
            stats.stillUnresolvable++;
            stats.stillUnresolvableDetails.push({
              source: rel.source,
              target: rel.target,
              type: rel.type,
              missingSide,
            });
            continue;
          }

          // Check for existing edge (avoid duplicates)
          const checkQuery = `
            g.V('${escapeGremlin(sourceResolution.id)}')
              .outE('${escapeGremlin(rel.type)}')
              .where(inV().hasId('${escapeGremlin(targetResolution.id)}'))
          `;
          const existing = await client.submit(checkQuery);

          if (existing._items && existing._items.length > 0) {
            stats.duplicatesSkipped++;
            continue;
          }

          // Create the edge
          const createQuery = `
            g.V('${escapeGremlin(sourceResolution.id)}')
              .addE('${escapeGremlin(rel.type)}')
              .to(g.V('${escapeGremlin(targetResolution.id)}'))
              .property('strength', ${rel.strength || 0.8})
              .property('evidence', '${escapeGremlin(rel.evidence || '')}')
              .property('source_document', '${escapeGremlin(rel.documentId || '')}')
              .property('source_chunk', '${escapeGremlin(rel.chunkId || '')}')
              .property('created_at', '${new Date().toISOString()}')
              .property('backfilled', true)
          `;
          await client.submit(createQuery);
          stats.backfilled++;
        } catch (error) {
          context.log(`Backfill error for ${rel.source} -> ${rel.target}: ${error.message}`);
          stats.errors++;
        }
      }

      // Backfill impact edges
      const impactBackfillStats = {
        total: impactEdges.length,
        backfilled: 0,
        stillUnresolvable: 0,
        errors: 0,
      };

      for (const ie of impactEdges) {
        try {
          const entityResolution = await resolveEntityId(ie.missingEntity, emptyEntityMap, client);
          if (!entityResolution) {
            impactBackfillStats.stillUnresolvable++;
            continue;
          }

          // Impact edges connect impact vertex <-> entity vertex
          // The impact vertex ID and edge type come from the skipped details
          if (ie.impactId && ie.edgeType) {
            const impactCheckQuery = `g.V('${escapeGremlin(ie.impactId)}').id()`;
            const impactExists = await client.submit(impactCheckQuery);

            if (impactExists._items && impactExists._items.length > 0) {
              const edgeQuery = ie.edgeType === 'has_impact'
                ? `g.V('${escapeGremlin(entityResolution.id)}').addE('has_impact').to(g.V('${escapeGremlin(ie.impactId)}')).property('backfilled', true).property('created_at', '${new Date().toISOString()}')`
                : `g.V('${escapeGremlin(ie.impactId)}').addE('affects').to(g.V('${escapeGremlin(entityResolution.id)}')).property('backfilled', true).property('created_at', '${new Date().toISOString()}')`;
              await client.submit(edgeQuery);
              impactBackfillStats.backfilled++;
            } else {
              impactBackfillStats.stillUnresolvable++;
            }
          } else {
            impactBackfillStats.stillUnresolvable++;
          }
        } catch (error) {
          context.log(`Impact backfill error for ${ie.missingEntity}: ${error.message}`);
          impactBackfillStats.errors++;
        }
      }

      context.log(`Backfill complete: ${stats.backfilled} relationships recovered, ${stats.stillUnresolvable} still unresolvable, ${stats.duplicatesSkipped} duplicates, ${stats.errors} errors`);
      context.log(`Impact backfill: ${impactBackfillStats.backfilled} recovered, ${impactBackfillStats.stillUnresolvable} still unresolvable, ${impactBackfillStats.errors} errors`);

      context.res = {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          stats,
          impactStats: impactBackfillStats,
          executionTime: Date.now() - startTime,
        }),
      };
      return;
    }

    if (mode === 'batch') {
      // Batch processing mode
      if (!searchEndpoint || !searchKey) {
        throw new Error('Azure Search credentials required for batch mode');
      }

      const batchResult = await processBatch(
        openAIEndpoint, openAIKey,
        searchEndpoint, searchKey, searchIndex,
        batchSize, offset,
        documentIdFilter || null
      );

      context.res = {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...batchResult,
          executionTime: Date.now() - startTime,
        }),
      };
      return;
    }

    // Single chunk mode
    if (!text || !documentId) {
      context.res = {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'text and documentId are required for single mode' }),
      };
      return;
    }

    // Extract entities
    const extraction = await extractEntities(
      openAIEndpoint, openAIKey,
      text,
      documentId,
      chunkId || 'manual'
    );

    // Save entities to Cosmos DB
    const savedEntities = await saveEntitiesToCosmos(
      extraction.entities,
      documentId,
      chunkId || 'manual'
    );

    // Save document-entity mappings
    await saveDocumentEntityMappings(
      savedEntities,
      documentId,
      chunkId || 'manual',
      extraction.primaryTopics,
      extraction.entities
    );

    // Save relationships to Cosmos DB
    const relationshipStats = await saveRelationshipsToCosmos(
      extraction.relationships,
      savedEntities,
      documentId,
      chunkId || 'manual'
    );

    // Save impacts to Cosmos DB (was previously missing from single mode)
    const emptyImpactStats = { policyEdgesCreated: 0, affectsEdgesCreated: 0, policyEdgesSkipped: 0, affectsEdgesSkipped: 0, resolvedViaGraph: 0, resolvedViaSemantic: 0, skippedDetails: [], errors: 0 };
    let impactStats = emptyImpactStats;
    if (extraction.impacts && extraction.impacts.length > 0) {
      const impactResult = await saveImpactsToCosmos(
        extraction.impacts,
        savedEntities,
        documentId,
        chunkId || 'manual'
      );
      impactStats = impactResult.stats;
    }

    // Index entities to Azure AI Search for semantic discovery (was previously missing from single mode)
    let indexedCount = 0;
    try {
      indexedCount = await indexEntitiesToSearch(extraction.entities, savedEntities, documentId);
    } catch (indexErr) {
      context.log(`Warning: Entity indexing failed (non-fatal): ${indexErr.message}`);
    }

    context.res = {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entities: extraction.entities,
        relationships: extraction.relationships,
        impacts: extraction.impacts || [],
        primaryTopics: extraction.primaryTopics,
        savedCount: savedEntities.length,
        relationshipStats,
        impactStats,
        indexedCount,
        executionTime: Date.now() - startTime,
      }),
    };

  } catch (error) {
    context.log('Entity Extraction error:', error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    // Deduplicate mode must always return 200 so client can read error from body
    const status = requestMode === 'deduplicate' ? 200 : 500;
    context.res = {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: errMsg,
      }),
    };
  }
};
