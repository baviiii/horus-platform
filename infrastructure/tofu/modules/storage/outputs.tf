output "storage_account_id" {
  description = "Resource ID of the storage account."
  value       = azurerm_storage_account.main.id
}

output "storage_account_name" {
  description = "Name of the storage account."
  value       = azurerm_storage_account.main.name
}

output "primary_blob_endpoint" {
  description = "Primary endpoint of the blob service (https://...)."
  value       = azurerm_storage_account.main.primary_blob_endpoint
}

output "primary_access_key" {
  description = "Primary access key — treat as secret. Prefer SAS or managed identity for runtime access."
  value       = azurerm_storage_account.main.primary_access_key
  sensitive   = true
}

output "container_names" {
  description = "Names of the containers created in the storage account."
  value       = [for c in azurerm_storage_container.this : c.name]
}
