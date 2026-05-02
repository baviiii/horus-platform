@description('Location for all resources')
param location string = 'australiaeast'

@description('Environment name (dev, staging, prod)')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'dev'

@description('Project name prefix')
param projectName string = 'careercraft'

@description('Enable Azure OpenAI for embeddings')
param enableOpenAI bool = false

// Calculate resource names (storage max 24 chars)
var storageAccountName = 'cc${environment}${uniqueString(resourceGroup().id)}'
var docIntelName = '${toLower(projectName)}-docintel-${environment}'
var aiSearchName = '${toLower(projectName)}-search-${environment}'
var openAIName = '${toLower(projectName)}-openai-${environment}'

// Blob Storage for PDFs
module storage 'modules/storage.bicep' = {
  name: 'storageDeployment'
  params: {
    location: location
    storageAccountName: storageAccountName
    environment: environment
    projectName: projectName
  }
}

// Document Intelligence for PDF parsing
module documentIntelligence 'modules/document-intel.bicep' = {
  name: 'docIntelDeployment'
  params: {
    location: location
    accountName: docIntelName
    environment: environment
    projectName: projectName
  }
  dependsOn: [storage]
}

// AI Search as vector database
module aiSearch 'modules/ai-search.bicep' = {
  name: 'aiSearchDeployment'
  params: {
    location: location
    serviceName: aiSearchName
    environment: environment
    projectName: projectName
  }
  dependsOn: [storage, documentIntelligence]
}

// Optional: Azure OpenAI for embeddings (if enabled)
// Note: If OpenAI account already exists, this will update it (idempotent)
// Only creates if it doesn't exist
module openAI 'modules/openai.bicep' = if (enableOpenAI) {
  name: 'openAIDeployment'
  params: {
    location: location
    accountName: openAIName
    environment: environment
    projectName: projectName
  }
  dependsOn: [aiSearch]
}

// Azure Functions for dashboard intelligence
var functionsAppName = '${toLower(projectName)}-functions-${environment}'
module azureFunctions 'modules/azure-functions.bicep' = {
  name: 'azureFunctionsDeployment'
  params: {
    functionAppName: functionsAppName
    location: location
    environment: environment
    projectName: projectName
    searchEndpoint: aiSearch.outputs.endpoint
    searchKey: aiSearch.outputs.key
    searchIndex: 'sa-gov-documents'
    openAIEndpoint: enableOpenAI && openAI != null ? openAI.outputs.endpoint : ''
    openAIKey: enableOpenAI && openAI != null ? openAI.outputs.key : ''
    storageAccountName: storage.outputs.storageAccountName
    storageAccountKey: storage.outputs.storageAccountKey
  }
  dependsOn: [aiSearch, storage]
}

// Outputs for environment variables
output storageAccountName string = storage.outputs.storageAccountName
output storageAccountKey string = storage.outputs.storageAccountKey
output containerName string = storage.outputs.containerName
output docIntelEndpoint string = documentIntelligence.outputs.endpoint
output docIntelKey string = documentIntelligence.outputs.key
output docIntelAccountName string = documentIntelligence.outputs.accountName
output aiSearchEndpoint string = aiSearch.outputs.endpoint
output aiSearchKey string = aiSearch.outputs.key
output aiSearchServiceName string = aiSearch.outputs.serviceName
output openAIEndpoint string = enableOpenAI && openAI != null ? openAI.outputs.endpoint : ''
output openAIKey string = enableOpenAI && openAI != null ? openAI.outputs.key : ''
output openAIAccountName string = enableOpenAI && openAI != null ? openAI.outputs.accountName : ''
output functionsAppName string = azureFunctions.outputs.functionAppName
output functionsAppUrl string = azureFunctions.outputs.functionAppUrl
output appInsightsKey string = azureFunctions.outputs.appInsightsKey

// Cost summary
output estimatedMonthlyCost string = enableOpenAI ? '''
Estimated Monthly Costs (AUD) - WITH OpenAI:
- Azure AI Search (Basic): ~$200/month
- Document Intelligence (S0): ~$10 per 1,000 pages
- Blob Storage (Standard LRS): ~$5-10/month
- Azure OpenAI: ~$20-50/month
Total: ~$275-360/month
''' : '''
Estimated Monthly Costs (AUD) - WITHOUT OpenAI:
- Azure AI Search (Basic): ~$200/month
- Document Intelligence (S0): ~$10 per 1,000 pages
- Blob Storage (Standard LRS): ~$5-10/month
Total: ~$255-310/month
'''
