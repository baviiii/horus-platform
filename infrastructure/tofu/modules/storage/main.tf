resource "random_id" "suffix" {
  byte_length = 3
}

resource "azurerm_storage_account" "main" {
  name                          = lower(replace("${var.name_prefix}${random_id.suffix.hex}", "-", ""))
  resource_group_name           = var.resource_group_name
  location                      = var.location
  account_tier                  = "Standard"
  account_replication_type      = "LRS"
  account_kind                  = "StorageV2"
  min_tls_version               = "TLS1_2"
  public_network_access_enabled = true
  https_traffic_only_enabled    = true

  blob_properties {
    versioning_enabled = false

    delete_retention_policy {
      days = 7
    }
  }

  tags = var.tags
}

resource "azurerm_storage_container" "this" {
  for_each = toset(var.container_names)

  name                  = each.value
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}
