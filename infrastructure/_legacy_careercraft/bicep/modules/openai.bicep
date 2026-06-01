@description('Azure OpenAI account name')
param accountName string

@description('Location for resources')
param location string = 'australiaeast'

@description('Environment name')
param environment string

@description('Project name')
param projectName string

// Azure OpenAI - for generating embeddings and chat
// IMPORTANT: If resource already exists with different kind (e.g., AIServices),
// this will fail. Use existing resource reference instead or skip this module.
// Bicep deployments are idempotent - existing resources won't be deleted or reset.
resource openAIAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: accountName
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    apiProperties: {}
    customSubDomainName: accountName
    publicNetworkAccess: 'Enabled'
  }
  tags: {
    Environment: environment
    Project: projectName
    ManagedBy: 'Bicep'
    CostCenter: 'RAG-Infrastructure'
  }
}

// Embedding model deployment - for vector search
resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAIAccount
  name: 'text-embedding-3-large'
  sku: {
    name: 'Standard'
    capacity: 120
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'text-embedding-3-large'
      version: '1'
    }
  }
}

// GPT-4o-mini deployment - for generating conversational answers
// Available in Australia East with GlobalStandard SKU
resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAIAccount
  name: 'gpt-4o-mini'
  sku: {
    name: 'GlobalStandard'
    capacity: 50
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o-mini'
      version: '2024-07-18'
    }
  }
  dependsOn: [embeddingDeployment] // Deploy sequentially to avoid conflicts
}

output endpoint string = openAIAccount.properties.endpoint
output key string = openAIAccount.listKeys().key1
output accountName string = accountName
output region string = location
output embeddingDeployment string = 'text-embedding-3-large'
output chatDeployment string = 'gpt-4o-mini'
