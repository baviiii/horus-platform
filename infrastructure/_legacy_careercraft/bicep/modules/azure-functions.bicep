@description('Azure Functions App name')
param functionAppName string

@description('Location for resources')
param location string = 'australiaeast'

@description('Environment name')
param environment string

@description('Project name')
param projectName string

@description('Azure Search endpoint')
param searchEndpoint string

@description('Azure Search key')
@secure()
param searchKey string

@description('Azure Search index name')
param searchIndex string = 'sa-gov-documents'

@description('Azure OpenAI endpoint (optional)')
param openAIEndpoint string = ''

@description('Azure OpenAI key (optional)')
@secure()
param openAIKey string = ''

@description('Azure Document Intelligence endpoint (optional)')
param docIntelEndpoint string = ''

@description('Azure Document Intelligence key (optional)')
@secure()
param docIntelKey string = ''

@description('Storage account name for Function App')
param storageAccountName string

@description('Storage account key for Function App')
@secure()
param storageAccountKey string

@description('Application Insights instrumentation key')
param appInsightsKey string = ''

// Application Insights (optional, for monitoring)
// Only create if not provided and if provider is registered
resource appInsights 'Microsoft.Insights/components@2020-02-02' = if (appInsightsKey == '') {
  name: '${functionAppName}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    Request_Source: 'rest'
  }
  tags: {
    Environment: environment
    Project: projectName
    ManagedBy: 'Bicep'
  }
}

// Fallback: Use empty string if App Insights not available
var appInsightsInstrumentationKey = appInsightsKey != '' ? appInsightsKey : (appInsights != null ? appInsights.properties.InstrumentationKey : '')

// Function App with Consumption plan
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  properties: {
    serverFarmId: functionAppPlan.id
    siteConfig: {
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${storageAccountKey};EndpointSuffix=core.windows.net'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${storageAccountKey};EndpointSuffix=core.windows.net'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(functionAppName)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'AZURE_SEARCH_ENDPOINT'
          value: searchEndpoint
        }
        {
          name: 'AZURE_SEARCH_KEY'
          value: searchKey
        }
        {
          name: 'AZURE_SEARCH_INDEX'
          value: searchIndex
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsightsInstrumentationKey
        }
      ]
      cors: {
        // SECURITY: Change to specific domains in production
        // Example: allowedOrigins: ['https://your-site.vercel.app', 'https://your-domain.com']
        allowedOrigins: ['*'] // TODO: Configure for production with specific domains
        supportCredentials: false
      }
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'FtpsOnly'
    }
    httpsOnly: true
    clientAffinityEnabled: false
  }
  tags: {
    Environment: environment
    Project: projectName
    ManagedBy: 'Bicep'
    CostCenter: 'RAG-Infrastructure'
  }
}

// Consumption plan (pay-per-use)
resource functionAppPlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${functionAppName}-plan'
  location: location
  kind: 'functionapp'
  sku: {
    name: 'Y1' // Consumption plan
    tier: 'Dynamic'
  }
  properties: {
    reserved: false
  }
  tags: {
    Environment: environment
    Project: projectName
    ManagedBy: 'Bicep'
  }
}

// Add OpenAI and Document Intelligence settings if provided
resource functionAppConfig 'Microsoft.Web/sites/config@2023-01-01' = if (openAIEndpoint != '') {
  parent: functionApp
  name: 'appsettings'
  properties: {
    AZURE_OPENAI_ENDPOINT: openAIEndpoint
    AZURE_OPENAI_KEY: openAIKey
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT: 'text-embedding-3-large'
    AZURE_OPENAI_CHAT_DEPLOYMENT: 'gpt-4o-mini'
    AZURE_OPENAI_VISION_DEPLOYMENT: 'gpt-4o'
    // Document Intelligence for PDF rendering (S1 tier for figures)
    AZURE_DOC_INTEL_ENDPOINT: docIntelEndpoint
    AZURE_DOC_INTEL_KEY: docIntelKey
  }
  dependsOn: [functionApp]
}

output functionAppName string = functionApp.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output appInsightsKey string = appInsightsInstrumentationKey
output storageAccountName string = storageAccountName

