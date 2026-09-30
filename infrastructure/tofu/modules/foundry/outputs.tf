output "account_name" {
  description = "Foundry (AIServices) account name."
  value       = azurerm_cognitive_account.main.name
}

output "account_id" {
  description = "ARM id of the Foundry account."
  value       = azurerm_cognitive_account.main.id
}

output "account_endpoint" {
  description = "Cognitive Services endpoint — Content Safety and every non-OpenAI data plane."
  value       = azurerm_cognitive_account.main.endpoint
}

output "openai_endpoint" {
  description = "Azure OpenAI-compatible endpoint — AZURE_OPENAI_ENDPOINT."
  value       = "https://${azurerm_cognitive_account.main.name}.openai.azure.com/"
}

output "primary_access_key" {
  description = "Account key — AZURE_OPENAI_API_KEY (also valid for Content Safety). Agents ignore keys; they require Entra."
  value       = azurerm_cognitive_account.main.primary_access_key
  sensitive   = true
}

output "project_name" {
  description = "Foundry project name."
  value       = azapi_resource.project.name
}

output "project_id" {
  description = "ARM id of the Foundry project."
  value       = azapi_resource.project.id
}

output "project_endpoint" {
  description = "Agent Service data-plane endpoint — AZURE_AI_PROJECT_ENDPOINT."
  value       = "https://${azurerm_cognitive_account.main.name}.services.ai.azure.com/api/projects/${azapi_resource.project.name}"
}

output "chat_deployment_name" {
  description = "Chat deployment — AZURE_OPENAI_FAST_MODEL / DEEP_MODEL."
  value       = azurerm_cognitive_deployment.chat.name
}

output "embedding_deployment_name" {
  description = "Embedding deployment — AZURE_OPENAI_EMBEDDING_MODEL."
  value       = azurerm_cognitive_deployment.embedding.name
}

output "embedding_small_deployment_name" {
  description = "Small embedding deployment behind /api/embed — AZURE_OPENAI_EMBEDDING_SMALL_MODEL (null when deploy_embedding_small is false)."
  value       = var.deploy_embedding_small ? azurerm_cognitive_deployment.embedding_small[0].name : null
}

output "realtime_deployment_name" {
  description = "Realtime voice deployment — AZURE_OPENAI_REALTIME_DEPLOYMENT (null when deploy_realtime is false)."
  value       = var.deploy_realtime ? azapi_resource.realtime[0].name : null
}

output "principal_id" {
  description = "System-assigned identity of the Foundry account (for RBAC grants)."
  value       = azurerm_cognitive_account.main.identity[0].principal_id
}

output "bing_connection_id" {
  description = "Project connection id for Grounding-with-Bing — AZURE_BING_CONNECTION_ID (null when disabled)."
  value       = var.deploy_bing_grounding ? azapi_resource.bing_connection[0].id : null
}

output "bing_connection_name" {
  description = "Project connection name for Grounding-with-Bing (null when disabled)."
  value       = var.deploy_bing_grounding ? azapi_resource.bing_connection[0].name : null
}
