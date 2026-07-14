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
