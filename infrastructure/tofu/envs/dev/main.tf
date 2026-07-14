data "azurerm_client_config" "current" {}

resource "azurerm_resource_group" "main" {
  name     = local.resource_group_name
  location = var.location
  tags     = local.common_tags
}

module "storage" {
  source = "../../modules/storage"

  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  name_prefix         = local.name_prefix
  container_names     = ["documents", "rendered"]
  tags                = local.common_tags
}

# Azure AI Foundry account + project: model deployments (chat, embedding,
# realtime voice), Agent Service, Bing grounding, Content Safety — one
# management plane. May live in a different region from the RG because
# realtime models ship to a handful of regions first.
module "foundry" {
  source = "../../modules/foundry"

  resource_group_name = azurerm_resource_group.main.name
  resource_group_id   = azurerm_resource_group.main.id
  location            = var.foundry_location
  name_prefix         = local.name_prefix
  tags                = local.common_tags

  chat_model_name       = var.chat_model
  chat_capacity         = var.chat_capacity
  realtime_model_name   = var.realtime_model
  deploy_bing_grounding = var.deploy_bing_grounding

  developer_principal_ids = [data.azurerm_client_config.current.object_id]
}

module "search" {
  source = "../../modules/search"

  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  name_prefix         = local.name_prefix
  sku                 = var.search_sku
  tags                = local.common_tags
}
