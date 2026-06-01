@description('Storage account name (must be globally unique)')
param storageAccountName string

@description('Location for resources')
param location string = 'australiaeast'

@description('Environment name')
param environment string

@description('Project name')
param projectName string

@description('Container name for PDFs')
param containerName string = 'rag-documents'

// Storage account - using Standard LRS for cost optimization
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    defaultToOAuthAuthentication: false
    encryption: {
      services: {
        blob: {
          enabled: true
        }
      }
      keySource: 'Microsoft.Storage'
    }
  }
  tags: {
    Environment: environment
    Project: projectName
    ManagedBy: 'Bicep'
    CostCenter: 'RAG-Infrastructure'
  }
}

// Blob service
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  name: 'default'
  parent: storageAccount
}

// Container for PDF documents
resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  name: containerName
  parent: blobService
  properties: {
    publicAccess: 'None'
    metadata: {
      description: 'RAG training documents'
      source: 'SA Government'
    }
  }
}

output storageAccountName string = storageAccount.name
output storageAccountKey string = storageAccount.listKeys().keys[0].value
output containerName string = containerName
output storageEndpoint string = 'https://${storageAccount.name}.blob.core.windows.net'
