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
