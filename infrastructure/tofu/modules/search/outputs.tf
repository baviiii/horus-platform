output "service_name" {
  description = "Name of the Azure AI Search service."
  value       = azurerm_search_service.main.name
}

output "endpoint" {
  description = "Search endpoint URL — set as AZURE_SEARCH_ENDPOINT in Horus."
  value       = "https://${azurerm_search_service.main.name}.search.windows.net"
}

output "primary_key" {
  description = "Admin API key — set as AZURE_SEARCH_API_KEY in Horus. Treat as secret."
  value       = azurerm_search_service.main.primary_key
  sensitive   = true
}

output "sku" {
  description = "Provisioned SKU (free tier has no semantic reranker — code should not request it)."
  value       = azurerm_search_service.main.sku
}

output "principal_id" {
  description = "System-assigned identity of the search service — grant it blob read + Foundry access for keyless indexer runs."
  value       = azurerm_search_service.main.identity[0].principal_id
}
