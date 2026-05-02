// Azure Cosmos DB for Gremlin (Graph) API
// Deploy with: az deployment group create --resource-group rg-careercraft-dev --template-file cosmos-graph.bicep
// Supports multi-tenancy with tenant-specific databases and graphs

@description('Cosmos DB account name')
param accountName string = 'careercraft-graph'

@description('Location for the Cosmos DB account')
param location string = 'australiaeast'

@description('Database name (use tenant-specific name for multi-tenancy)')
param databaseName string = 'graphdb'

@description('Graph container name (use tenant-specific name for multi-tenancy)')
param graphName string = 'career-graph'

@description('Enable serverless for cost optimization')
param enableServerless bool = true

@description('Tenant ID for multi-tenancy support (optional)')
param tenantId string = ''

@description('Enable multi-tenancy mode')
param enableMultiTenancy bool = false

// Calculate tenant-specific names if multi-tenancy is enabled
var actualDatabaseName = enableMultiTenancy && !empty(tenantId) ? '${tenantId}-graphdb' : databaseName
var actualGraphName = enableMultiTenancy && !empty(tenantId) ? '${tenantId}-graph' : graphName

// Cosmos DB Account with Gremlin API
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [
      {
        name: 'EnableGremlin'
      }
      {
        name: 'EnableServerless'
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    enableAutomaticFailover: false
    enableMultipleWriteLocations: false
    publicNetworkAccess: 'Enabled'
  }
}

// Gremlin Database
resource gremlinDatabase 'Microsoft.DocumentDB/databaseAccounts/gremlinDatabases@2023-11-15' = {
  parent: cosmosAccount
  name: actualDatabaseName
  properties: {
    resource: {
      id: actualDatabaseName
    }
  }
}

// Graph Container with partition key
// For multi-tenancy: Each tenant gets their own graph with tenant_id as additional partition consideration
resource graphContainer 'Microsoft.DocumentDB/databaseAccounts/gremlinDatabases/graphs@2023-11-15' = {
  parent: gremlinDatabase
  name: actualGraphName
  properties: {
    resource: {
      id: actualGraphName
      partitionKey: {
        paths: ['/entity_type']
        kind: 'Hash'
        version: 2
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          {
            path: '/*'
          }
        ]
        excludedPaths: [
          {
            path: '/"_etag"/?'
          }
        ]
      }
    }
  }
}

// Outputs for application configuration
output cosmosAccountName string = cosmosAccount.name
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output gremlinEndpoint string = 'wss://${cosmosAccount.name}.gremlin.cosmos.azure.com:443/'
output databaseName string = actualDatabaseName
output graphName string = actualGraphName
output tenantId string = enableMultiTenancy ? tenantId : ''

// Note: Primary key must be retrieved separately for security
// Use: az cosmosdb keys list --name careercraft-graph --resource-group rg-careercraft-dev --query primaryMasterKey -o tsv
