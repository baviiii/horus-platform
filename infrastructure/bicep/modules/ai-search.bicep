@description('AI Search service name')
param serviceName string

@description('Location for resources')
param location string = 'australiaeast'

@description('Environment name')
param environment string

@description('Project name')
param projectName string

// Azure AI Search - Basic tier for cost optimization
resource searchService 'Microsoft.Search/searchServices@2023-11-01' = {
  name: serviceName
  location: location
  sku: {
    name: 'basic'
  }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
    publicNetworkAccess: 'enabled'
    semanticSearch: 'free'
  }
  tags: {
    Environment: environment
    Project: projectName
    ManagedBy: 'Bicep'
    CostCenter: 'RAG-Infrastructure'
  }
}

output endpoint string = 'https://${searchService.name}.search.windows.net'
output key string = searchService.listAdminKeys().primaryKey
output serviceName string = serviceName
output region string = location
output replicaCount int = searchService.properties.replicaCount
output partitionCount int = searchService.properties.partitionCount
