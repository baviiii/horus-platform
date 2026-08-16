# Azure AI Foundry — the management plane for everything AI.
#
# One AIServices account with project management enabled (the current
# Foundry model — Cognitive Services based, NOT the legacy hub/workspace
# kind), one project, model deployments, and Grounding-with-Bing-Search
# connected so the Agent Service can search the live web.
#
# azurerm still lacks first-class resources for Foundry projects and
# connections, so those go through azapi against the ARM API directly.

resource "random_id" "suffix" {
  byte_length = 3
}

locals {
  # Account + custom subdomain must be globally unique and alphanumeric.
  account_name = lower(replace("${var.name_prefix}ai${random_id.suffix.hex}", "-", ""))
  project_name = "${var.name_prefix}-project"
}

resource "azurerm_cognitive_account" "main" {
  name                  = local.account_name
  location              = var.location
  resource_group_name   = var.resource_group_name
  kind                  = "AIServices"
  sku_name              = "S0"
  custom_subdomain_name = local.account_name

  # Must be declared explicitly. azurerm gained this argument in 4.x and it
  # defaults to false, so leaving it unset reads as drift against an account
  # that already has project management on — and the provider "fixes" that by
  # REPLACING the account, taking every model deployment with it.
  project_management_enabled = true

  public_network_access_enabled = true

  identity {
    type = "SystemAssigned"
  }

  tags = var.tags
}

# Flip the account into a Foundry-project-capable account. azurerm has no
# argument for this yet; harmless PATCH, ignored on destroy.
resource "azapi_update_resource" "allow_projects" {
  type        = "Microsoft.CognitiveServices/accounts@2025-04-01-preview"
  resource_id = azurerm_cognitive_account.main.id

  body = {
    properties = {
      allowProjectManagement = true
    }
  }
}

resource "azapi_resource" "project" {
  type      = "Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview"
  name      = local.project_name
  parent_id = azurerm_cognitive_account.main.id
  location  = var.location

  identity {
    type = "SystemAssigned"
  }

  body = {
    properties = {
      displayName = var.project_display_name
      description = var.project_description
    }
  }

  schema_validation_enabled = false

  depends_on = [azapi_update_resource.allow_projects]
}

# --- Model deployments -----------------------------------------------------
# Chained depends_on: the account allows only one deployment mutation at a
# time; parallel creates fail with Conflict.

resource "azurerm_cognitive_deployment" "chat" {
  name                 = var.chat_model_name
  cognitive_account_id = azurerm_cognitive_account.main.id

  model {
    format  = "OpenAI"
    name    = var.chat_model_name
    version = var.chat_model_version
  }

  sku {
    name     = var.chat_sku_name
    capacity = var.chat_capacity
  }

  depends_on = [azapi_resource.project]
}

resource "azurerm_cognitive_deployment" "embedding" {
  name                 = var.embedding_deployment_name
  cognitive_account_id = azurerm_cognitive_account.main.id

  model {
    format  = "OpenAI"
    name    = "text-embedding-3-large"
    version = "1"
  }

  sku {
    name     = var.embedding_sku_name
    capacity = var.embedding_capacity
  }

  depends_on = [azurerm_cognitive_deployment.chat]
}

# azapi, not azurerm: the provider's pinned deployments API predates the
# newest realtime models and rejects them with DeploymentModelNotSupported.
resource "azapi_resource" "realtime" {
  count = var.deploy_realtime ? 1 : 0

  type      = "Microsoft.CognitiveServices/accounts/deployments@2025-06-01"
  name      = var.realtime_model_name
  parent_id = azurerm_cognitive_account.main.id

  body = {
    sku = {
      name     = var.realtime_sku_name
      capacity = var.realtime_capacity
    }
    properties = {
      model = {
        format  = "OpenAI"
        name    = var.realtime_model_name
        version = var.realtime_model_version
      }
      versionUpgradeOption = "OnceNewDefaultVersionAvailable"
    }
  }

  schema_validation_enabled = false

  depends_on = [azurerm_cognitive_deployment.embedding]
}

# --- Grounding with Bing Search ---------------------------------------------
# The Bing resource lives at resource-group scope (location "global"); a
# project connection carrying its key makes it available as an agent tool.

resource "azapi_resource" "bing" {
  count = var.deploy_bing_grounding ? 1 : 0

  type      = "Microsoft.Bing/accounts@2020-06-10"
  name      = "${var.name_prefix}-bing-${random_id.suffix.hex}"
  parent_id = var.resource_group_id
  location  = "global"

  body = {
    kind = "Bing.Grounding"
    sku = {
      name = "G1"
    }
  }

  schema_validation_enabled = false
  tags                      = var.tags
}

resource "azapi_resource_action" "bing_keys" {
  count = var.deploy_bing_grounding ? 1 : 0

  type        = "Microsoft.Bing/accounts@2020-06-10"
  resource_id = azapi_resource.bing[0].id
  action      = "listKeys"
  method      = "POST"

  response_export_values = ["*"]
}

resource "azapi_resource" "bing_connection" {
  count = var.deploy_bing_grounding ? 1 : 0

  type      = "Microsoft.CognitiveServices/accounts/projects/connections@2025-04-01-preview"
  name      = "bing-grounding"
  parent_id = azapi_resource.project.id

  body = {
    properties = {
      category      = "GroundingWithBingSearch"
      target        = "https://api.bing.microsoft.com/"
      authType      = "ApiKey"
      isSharedToAll = true
      credentials = {
        key = azapi_resource_action.bing_keys[0].output.key1
      }
      metadata = {
        ApiType    = "Azure"
        ResourceId = azapi_resource.bing[0].id
        location   = "global"
      }
    }
  }

  schema_validation_enabled = false
}

# --- Data-plane access -------------------------------------------------------
# The Agent Service accepts Entra tokens only (never api-keys), and Owner
# carries no dataActions — so every developer principal needs Foundry User
# (53ca6127-db72-4b80-b1b0-d745d6d5456d; formerly named "Azure AI User").

resource "azurerm_role_assignment" "developer_ai_user" {
  count = length(var.developer_principal_ids)

  scope                = azurerm_cognitive_account.main.id
  role_definition_name = "Foundry User"
  principal_id         = var.developer_principal_ids[count.index]
}
