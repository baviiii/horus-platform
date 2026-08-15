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
  # corpus = source-of-truth documents crawled by the AI Search indexer.
  container_names = ["documents", "rendered", "corpus"]
  tags            = local.common_tags
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

# --- Australian document plane ----------------------------------------------
# A second Foundry account in australiaeast, carrying everything that touches
# customer/participant document content: Content Understanding (the AI Search
# skillset binds to it), plus chat + embeddings for extraction and briefs.
#
# Why separate from the main account: Content Understanding is available in
# only a handful of regions, and australiaeast is one of them with all data at
# rest kept in-region and no data-zone processing. The main account stays in
# `foundry_location` because realtime voice ships to few regions — and voice is
# a demo surface with no customer data. Documents stay onshore; voice does not
# need to.
module "foundry_au" {
  count  = var.deploy_au_document_plane ? 1 : 0
  source = "../../modules/foundry"

  resource_group_name = azurerm_resource_group.main.name
  resource_group_id   = azurerm_resource_group.main.id
  location            = var.au_document_location
  name_prefix         = "${local.name_prefix}-au"
  tags                = merge(local.common_tags, { data_residency = "australia" })

  chat_model_name = var.chat_model
  chat_capacity   = var.chat_capacity
  # Voice lives in the primary account only.
  deploy_realtime       = false
  deploy_bing_grounding = false

  developer_principal_ids = [data.azurerm_client_config.current.object_id]
}

# --- Indexer RBAC (keyless) --------------------------------------------------
# The search service reads blobs and bills skillset execution as its own
# managed identity, so no keys appear in data-source or skillset definitions.

resource "azurerm_role_assignment" "search_reads_blobs" {
  scope                = module.storage.storage_account_id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = module.search.principal_id
}

# Operators need data-plane write access to push the corpus into blob storage.
# Owner/Contributor at the control plane does NOT grant this — blob data
# operations are a separate RBAC surface, which is why an unassigned developer
# gets AuthorizationPermissionMismatch despite owning the subscription.
resource "azurerm_role_assignment" "developer_writes_blobs" {
  scope                = module.storage.storage_account_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Lets the skillset invoke Content Understanding on the AU account.
resource "azurerm_role_assignment" "search_uses_au_foundry" {
  count = var.deploy_au_document_plane ? 1 : 0

  scope                = module.foundry_au[0].account_id
  role_definition_name = "Cognitive Services User"
  principal_id         = module.search.principal_id
}
