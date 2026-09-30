output "resource_group_name" {
  description = "Name of the resource group containing all dev resources."
  value       = azurerm_resource_group.main.name
}

output "location" {
  description = "Azure region the stack is deployed to."
  value       = azurerm_resource_group.main.location
}

output "storage_account_name" {
  description = "Name of the blob storage account."
  value       = module.storage.storage_account_name
}

output "storage_primary_blob_endpoint" {
  description = "Public endpoint for the blob service."
  value       = module.storage.primary_blob_endpoint
}

output "storage_account_resource_id" {
  description = "ARM id of the storage account — AZURE_STORAGE_ACCOUNT_RESOURCE_ID, used by the AI Search data source for keyless (ResourceId=) blob access."
  value       = module.storage.storage_account_id
}

output "storage_container_names" {
  description = "Containers created inside the storage account."
  value       = module.storage.container_names
}

output "foundry_account_name" {
  description = "Foundry (AIServices) account name."
  value       = module.foundry.account_name
}

output "openai_endpoint" {
  description = "Azure OpenAI endpoint — AZURE_OPENAI_ENDPOINT."
  value       = module.foundry.openai_endpoint
}

output "openai_primary_access_key" {
  description = "Foundry account key — AZURE_OPENAI_API_KEY (inference + Content Safety; agents use Entra)."
  value       = module.foundry.primary_access_key
  sensitive   = true
}

output "openai_chat_deployment" {
  description = "Chat deployment name — AZURE_OPENAI_FAST_MODEL / DEEP_MODEL."
  value       = module.foundry.chat_deployment_name
}

output "openai_embedding_deployment" {
  description = "Embedding deployment name — AZURE_OPENAI_EMBEDDING_MODEL."
  value       = module.foundry.embedding_deployment_name
}

output "openai_embedding_small_deployment" {
  description = "Small embedding deployment behind /api/embed — AZURE_OPENAI_EMBEDDING_SMALL_MODEL."
  value       = module.foundry.embedding_small_deployment_name
}

output "openai_realtime_deployment" {
  description = "Realtime voice deployment name — AZURE_OPENAI_REALTIME_DEPLOYMENT."
  value       = module.foundry.realtime_deployment_name
}

output "ai_project_endpoint" {
  description = "Foundry project endpoint — AZURE_AI_PROJECT_ENDPOINT (Agent Service, Entra auth)."
  value       = module.foundry.project_endpoint
}

output "content_safety_endpoint" {
  description = "Content Safety endpoint — AZURE_CONTENT_SAFETY_ENDPOINT (same key as OpenAI)."
  value       = module.foundry.account_endpoint
}

output "bing_connection_id" {
  description = "Grounding-with-Bing project connection id — AZURE_BING_CONNECTION_ID."
  value       = module.foundry.bing_connection_id
}

output "search_endpoint" {
  description = "Azure AI Search endpoint — AZURE_SEARCH_ENDPOINT."
  value       = module.search.endpoint
}

output "search_service_name" {
  description = "Azure AI Search service name."
  value       = module.search.service_name
}

output "search_primary_key" {
  description = "Azure AI Search admin key — AZURE_SEARCH_API_KEY."
  value       = module.search.primary_key
  sensitive   = true
}

output "search_sku" {
  description = "Search SKU (free tier ⇒ no semantic reranker)."
  value       = module.search.sku
}

output "search_principal_id" {
  description = "Search service managed identity — holds blob read + Foundry access for keyless indexer runs."
  value       = module.search.principal_id
}

# --- Australian document plane ----------------------------------------------

output "au_document_location" {
  description = "Region carrying document content (Content Understanding + document embeddings)."
  value       = var.deploy_au_document_plane ? var.au_document_location : null
}

output "au_foundry_account_name" {
  description = "Foundry account backing Content Understanding — AZURE_AU_FOUNDRY_ACCOUNT."
  value       = var.deploy_au_document_plane ? module.foundry_au[0].account_name : null
}

output "au_foundry_account_id" {
  description = "ARM id of the AU Foundry account — the skillset's billing resource."
  value       = var.deploy_au_document_plane ? module.foundry_au[0].account_id : null
}

output "au_openai_endpoint" {
  description = "AU Azure OpenAI endpoint — AZURE_AU_OPENAI_ENDPOINT (document embeddings)."
  value       = var.deploy_au_document_plane ? module.foundry_au[0].openai_endpoint : null
}

output "au_cognitive_endpoint" {
  description = "AU AI Services endpoint (*.cognitiveservices.azure.com) — AZURE_AU_COGNITIVE_ENDPOINT. The skillset's subdomainUrl must be this, not the OpenAI hostname; the API validates it as an AI Services resource."
  value       = var.deploy_au_document_plane ? module.foundry_au[0].account_endpoint : null
}

output "au_openai_primary_access_key" {
  description = "AU Foundry account key — AZURE_AU_OPENAI_API_KEY."
  value       = var.deploy_au_document_plane ? module.foundry_au[0].primary_access_key : null
  sensitive   = true
}

output "au_embedding_deployment" {
  description = "AU embedding deployment used by the indexer's vectorizer."
  value       = var.deploy_au_document_plane ? module.foundry_au[0].embedding_deployment_name : null
}

output "corpus_container_name" {
  description = "Blob container the AI Search corpus indexer crawls."
  value       = "corpus"
}
