/**
 * PROACTIVE IMPACT ALERTS
 * Daily batch processing to detect and alert on critical impact changes
 * Runs once per day via Timer Trigger
 * Cost-optimized: Batched, uses GPT-4o-mini, limits to top entities
 */

const gremlin = require('gremlin');
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

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

/**
 * Get all entities that have impacts
 */
async function getAllEntitiesWithImpacts() {
  const client = getGremlinClient();
  
  try {
    // Find all entities that have incoming 'affects' edges from impact vertices
    const query = `
      g.V()
        .hasLabel('impact')
        .outE('affects')
        .inV()
        .has('entity_type')
        .dedup()
        .project('id', 'name', 'canonical_name', 'entity_type', 'mention_count')
        .by(id)
        .by(coalesce(values('name'), constant('')))
        .by(coalesce(values('canonical_name'), constant('')))
        .by(coalesce(values('entity_type'), constant('')))
        .by(coalesce(values('mention_count'), constant(0)))
        .order()
        .by(select('mention_count'), desc)
        .limit(100)
    `;
    
    const result = await client.submit(query);
    return result._items || [];
  } catch (error) {
    console.error('Failed to get entities with impacts:', error);
    return [];
  }
}

/**
 * Get impacts for an entity
 */
async function getImpactsForEntity(entityId, entityName) {
  const client = getGremlinClient();
  
  try {
    const query = `
      g.V('${escapeGremlin(entityId)}')
        .inE('affects')
        .outV()
        .hasLabel('impact')
        .valueMap(true)
    `;
    
    const result = await client.submit(query);
    return formatImpacts(result._items || []);
  } catch (error) {
    console.error(`Failed to get impacts for ${entityName}:`, error);
    return [];
  }
}

/**
 * Format impact vertices
 */
function formatImpacts(impactVertices) {
  return impactVertices.map(impact => ({
    id: impact.id,
    policyId: impact.properties?.policy_id?.[0]?.value || '',
    policyName: impact.properties?.policy_name?.[0]?.value || '',
    affectedEntity: impact.properties?.affected_entity?.[0]?.value || '',
    impactType: impact.properties?.impact_type?.[0]?.value || '',
    direction: impact.properties?.direction?.[0]?.value || '',
    severity: impact.properties?.severity?.[0]?.value || '',
    confidence: parseFloat(impact.properties?.confidence?.[0]?.value || '0'),
    quantitativeValue: impact.properties?.quantitative_value?.[0]?.value || '',
    timeframe: impact.properties?.timeframe?.[0]?.value || '',
    createdAt: impact.properties?.created_at?.[0]?.value || ''
  }));
}

/**
 * Escape Gremlin strings
 */
function escapeGremlin(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/\\/g, '\\\\');
}

/**
 * Get Azure Storage Table client for alerts
 */
function getAlertsTableClient() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
  }
  
  const tableName = 'impactAlerts';
  const client = TableClient.fromConnectionString(connectionString, tableName);
  return client;
}

/**
 * Store alerts in Azure Storage Table
 * Partition key: date (YYYY-MM-DD)
 * Row key: alertId (type_entity_timestamp)
 */
async function storeAlerts(alerts, summary, context) {
  const tableClient = getAlertsTableClient();
  
  try {
    // Ensure table exists
    await tableClient.createTable();
  } catch (error) {
    // Table might already exist, ignore error
    if (error.statusCode !== 409) {
      context.log.error('Failed to create alerts table:', error);
      throw error;
    }
  }
  
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const timestamp = Date.now();
  
  // Store each alert
  const alertEntities = alerts.map((alert, index) => {
    const alertId = `${alert.type}_${alert.entity}_${timestamp}_${index}`;
    return {
      partitionKey: date,
      rowKey: alertId,
      type: alert.type,
      entity: alert.entity,
      entityType: alert.entityType || '',
      count: alert.count || 0,
      priority: alert.priority,
      severity: alert.severity,
      description: alert.description,
      impacts: JSON.stringify(alert.impacts || []),
      zScore: alert.zScore || null,
      createdAt: new Date().toISOString(),
      timestamp: timestamp
    };
  });
  
  // Batch insert alerts (Azure Tables supports up to 100 entities per batch)
  const batchSize = 100;
  for (let i = 0; i < alertEntities.length; i += batchSize) {
    const batch = alertEntities.slice(i, i + batchSize);
    try {
      await tableClient.submitTransaction(
        batch.map(entity => ({
          operation: 'upsert',
          entity
        }))
      );
    } catch (error) {
      context.log.error(`Failed to store alert batch ${i}-${i + batch.length}:`, error);
      // Continue with next batch
    }
  }
  
  // Store summary in separate row
  const summaryEntity = {
    partitionKey: 'summary',
    rowKey: 'latest',
    summary: summary.summary || '',
    criticalCount: summary.criticalCount || 0,
    totalCount: summary.totalCount || 0,
    recommendations: JSON.stringify(summary.recommendations || []),
    date: date,
    timestamp: timestamp,
    processedEntities: context.processedEntities || 0
  };
  
  try {
    await tableClient.upsertEntity(summaryEntity);
  } catch (error) {
    context.log.error('Failed to store alert summary:', error);
    throw error;
  }
  
  context.log(`Stored ${alertEntities.length} alerts and summary for date ${date}`);
  return { date, alertCount: alertEntities.length };
}

/**
 * Detect anomalies in impacts (statistical, no API cost)
 */
function detectAnomalies(impacts) {
  const anomalies = [];
  
  if (impacts.length === 0) return anomalies;
  
  // High severity count
  const highSeverityCount = impacts.filter(i => i.severity === 'high').length;
  if (highSeverityCount >= 5) {
    anomalies.push({
      type: 'high_severity',
      count: highSeverityCount,
      severity: 'high',
      description: `${highSeverityCount} high-severity impacts detected`
    });
  }
  
  // Z-score outlier detection for quantitative values
  const values = impacts
    .map(i => parseQuantitativeValue(i.quantitativeValue))
    .filter(v => v > 0);
  
  if (values.length >= 3) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev > 0) {
      impacts.forEach(impact => {
        const value = parseQuantitativeValue(impact.quantitativeValue);
        if (value > 0) {
          const zScore = Math.abs((value - mean) / stdDev);
          if (zScore > 3) {
            anomalies.push({
              type: 'outlier',
              impact,
              zScore,
              severity: 'medium',
              description: `Unusually ${value > mean ? 'high' : 'low'} impact value: ${impact.quantitativeValue}`
            });
          }
        }
      });
    }
  }
  
  // Direction conflicts
  const byType = {};
  impacts.forEach(impact => {
    const key = `${impact.impactType}_${impact.affectedEntity}`;
    if (!byType[key]) {
      byType[key] = [];
    }
    byType[key].push(impact);
  });
  
  Object.keys(byType).forEach(key => {
    const typeImpacts = byType[key];
    const hasIncrease = typeImpacts.some(i => i.direction === 'increase');
    const hasDecrease = typeImpacts.some(i => i.direction === 'decrease');
    
    if (hasIncrease && hasDecrease) {
      anomalies.push({
        type: 'conflict',
        impacts: typeImpacts,
        severity: 'high',
        description: `Conflicting impacts: increases and decreases for same entity/type`
      });
    }
  });
  
  return anomalies;
}

/**
 * Parse quantitative value
 */
function parseQuantitativeValue(value) {
  if (!value) return 0;
  
  const dollarMatch = value.match(/\$[\d,]+(?:\.\d+)?\s*(?:million|billion|M|B|k|thousand)?/i);
  if (dollarMatch) {
    let amount = parseFloat(dollarMatch[0].replace(/[$,]/g, ''));
    const multiplier = dollarMatch[0].toLowerCase();
    if (multiplier.includes('billion') || multiplier.includes('b')) amount *= 1000000000;
    else if (multiplier.includes('million') || multiplier.includes('m')) amount *= 1000000;
    else if (multiplier.includes('thousand') || multiplier.includes('k')) amount *= 1000;
    return amount;
  }
  
  const jobMatch = value.match(/(\d+(?:,\d+)?)\s*(?:jobs?|positions?|workers?|employees?)/i);
  if (jobMatch) {
    return parseInt(jobMatch[1].replace(/,/g, ''), 10);
  }
  
  return 0;
}

/**
 * Generate alert summary using GPT-4o-mini (batched, cost-optimized)
 */
async function generateAlertSummary(alerts) {
  const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const openAIKey = process.env.AZURE_OPENAI_KEY;
  const chatDeployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini';
  
  if (!openAIEndpoint || !openAIKey) {
    return {
      summary: 'Impact alerts generated. Review details below.',
      criticalCount: alerts.filter(a => a.severity === 'high').length,
      totalCount: alerts.length
    };
  }
  
  try {
    // Limit to top 10 alerts for cost control
    const topAlerts = alerts.slice(0, 10);
    
    const systemPrompt = `You are an impact intelligence analyst. Summarize critical impact alerts concisely.`;
    
    const userPrompt = `Summarize these ${topAlerts.length} impact alerts in 2-3 sentences. Focus on critical findings:

${topAlerts.map((a, i) => `${i + 1}. ${a.type}: ${a.description} (${a.severity} severity)`).join('\n')}

Return JSON: { summary: string, criticalCount: number, recommendations: string[] }`;

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
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 300, // Limit for cost control
          response_format: { type: 'json_object' }
        }),
      }
    );

    if (response.ok) {
      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      if (content) {
        return JSON.parse(content);
      }
    }
  } catch (error) {
    console.error('Failed to generate alert summary:', error);
  }
  
  // Fallback
  return {
    summary: `${alerts.length} impact alerts detected. ${alerts.filter(a => a.severity === 'high').length} are high severity.`,
    criticalCount: alerts.filter(a => a.severity === 'high').length,
    totalCount: alerts.length,
    recommendations: ['Review high-severity impacts', 'Investigate conflicting impacts', 'Monitor outlier values']
  };
}

/**
 * Main timer trigger function
 */
module.exports = async function (context, myTimer) {
  const startTime = Date.now();
  context.log('Proactive Impact Alerts: Starting daily batch processing...');
  
  try {
    // Get all entities with impacts (limit to top 50 for cost control)
    const entities = await getAllEntitiesWithImpacts();
    const topEntities = entities.slice(0, 50);
    
    context.log(`Processing ${topEntities.length} entities...`);
    
    const alerts = [];
    let processedCount = 0;
    
    for (const entity of topEntities) {
      try {
        const entityId = entity.id || entity.name || entity.canonical_name;
        const entityName = entity.canonical_name || entity.name || entityId;
        
        // Get impacts for entity
        const impacts = await getImpactsForEntity(entityId, entityName);
        
        if (impacts.length === 0) continue;
        
        // Detect anomalies
        const anomalies = detectAnomalies(impacts);
        
        // Check thresholds
        const highSeverityCount = impacts.filter(i => i.severity === 'high').length;
        if (highSeverityCount >= 5) {
          alerts.push({
            type: 'high_severity',
            entity: entityName,
            entityType: entity.entity_type,
            count: highSeverityCount,
            priority: 'high',
            severity: 'high',
            description: `${entityName} has ${highSeverityCount} high-severity impacts`,
            impacts: impacts.filter(i => i.severity === 'high').slice(0, 5)
          });
        }
        
        // Add anomalies
        anomalies.forEach(anomaly => {
          alerts.push({
            ...anomaly,
            entity: entityName,
            entityType: entity.entity_type
          });
        });
        
        processedCount++;
        
        // Small delay to avoid rate limits
        if (processedCount % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        context.log.error(`Failed to process entity ${entity.name}:`, error);
      }
    }
    
    context.log(`Processed ${processedCount} entities, found ${alerts.length} alerts`);
    
    // Generate AI summary (batched, cost-optimized)
    const summary = await generateAlertSummary(alerts);
    
    // Store alerts in Azure Storage Table
    let storageResult = null;
    try {
      storageResult = await storeAlerts(alerts, summary, {
        ...context,
        processedEntities: processedCount
      });
    } catch (error) {
      context.log.error('Failed to store alerts to Azure Storage Table:', error);
      // Continue execution even if storage fails
    }
    
    const alertData = {
      date: new Date().toISOString(),
      alerts,
      summary,
      processedEntities: processedCount,
      totalAlerts: alerts.length,
      criticalAlerts: alerts.filter(a => a.severity === 'high').length,
      storageResult
    };
    
    context.log('Alert Summary:', JSON.stringify(summary, null, 2));
    
    const executionTime = Date.now() - startTime;
    context.log(`Proactive Impact Alerts: Completed in ${executionTime}ms`);
    
    return {
      success: true,
      alerts: alerts.length,
      critical: alerts.filter(a => a.severity === 'high').length,
      summary,
      executionTime
    };
  } catch (error) {
    context.log.error('Proactive Impact Alerts: Failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};
