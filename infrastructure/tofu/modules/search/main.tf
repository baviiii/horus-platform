resource "random_id" "suffix" {
  byte_length = 3
}

locals {
  # Search service names: lowercase letters/digits/dashes, globally unique.
  service_name = lower("${var.name_prefix}-srch-${random_id.suffix.hex}")
}

resource "azurerm_search_service" "main" {
  name                = local.service_name
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = var.sku

  # Semantic reranker is unavailable on the free tier; enable the free
  # semantic plan (1k queries/mo) automatically on basic and above.
  semantic_search_sku = var.sku == "free" ? null : "free"

  public_network_access_enabled = true

  # Indexers authenticate to blob storage and to the Foundry resource that
  # bills skillset execution as this identity — keyless, so no connection
  # strings end up inside data-source or skillset definitions.
  identity {
    type = "SystemAssigned"
  }

  tags = var.tags
}
