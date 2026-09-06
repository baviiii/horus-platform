variable "project" {
  description = "Project slug — used as a prefix for every resource name."
  type        = string
  default     = "horus"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{2,11}$", var.project))
    error_message = "project must be 3-12 chars, lowercase letters/digits, starting with a letter."
  }
}

variable "environment" {
  description = "Environment slug (dev | staging | prod)."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "location" {
  description = "Azure region for regional resources (RG, storage, search)."
  type        = string
  default     = "australiaeast"
}

variable "foundry_location" {
  description = "Region for the Foundry account. Realtime voice models ship to few regions; eastus2 has every model + the Agent Service."
  type        = string
  default     = "eastus2"
}

variable "owner" {
  description = "Owner tag value — name or team owning the stack."
  type        = string
  default     = "platform"
}

variable "chat_model" {
  description = "Chat model deployed to the Foundry project (agent brain)."
  type        = string
  default     = "gpt-4o"
}

variable "chat_capacity" {
  description = "Chat deployment capacity in thousands of TPM."
  type        = number
  default     = 50
}

variable "chat_model_version" {
  description = <<-EOT
    Chat model version. Leaving this null lets Azure pick a default and then
    write it back, which shows up as permanent `version -> null` drift on every
    plan. Pin it so the config matches what is actually deployed.
  EOT
  type        = string
  default     = "2024-11-20"
}

variable "chat_sku_name" {
  description = <<-EOT
    Chat deployment SKU. GlobalStandard is a pooled global capacity model;
    Standard is regional. New and credit-based subscriptions frequently carry
    ZERO GlobalStandard quota while having plenty of Standard — verify with
    `az cognitiveservices usage list -l <region>` before changing this.
    Standard also keeps inference in-region, which suits AU data residency.
  EOT
  type        = string
  default     = "Standard"
}

variable "embedding_sku_name" {
  description = "Embedding deployment SKU. Same quota caveat as chat_sku_name."
  type        = string
  default     = "Standard"
}

variable "realtime_model" {
  description = <<-EOT
    Realtime speech-to-speech model for full-duplex voice (mini tier: open-access
    playground cost profile). Realtime quota is granted per exact model name and
    measured in Requests Per Minute — `gpt-realtime-2.1-mini` carries 0 on this
    subscription while `gpt-realtime-mini` carries 40. Check with
    `az cognitiveservices usage list -l <region>` before changing.
  EOT
  type        = string
  default     = "gpt-realtime-mini"
}

variable "realtime_model_version" {
  description = "Realtime model version — must match the model name; the deployments API rejects null for newer models."
  type        = string
  default     = "2025-12-15"
}

variable "deploy_bing_grounding" {
  description = "Provision Grounding-with-Bing-Search for live web search in agents. Off by default: the G1 SKU is SkuNotEligible on sponsored/credit subscriptions — flip on after moving to pay-as-you-go."
  type        = bool
  default     = false
}

variable "search_sku" {
  description = "Azure AI Search SKU. free = 50 MB total and a cap of 3 indexers/skillsets/data sources — too small for the document pipeline; basic is the floor for the corpus indexer."
  type        = string
  default     = "basic"
}

variable "deploy_au_document_plane" {
  description = "Provision the Australian document plane (Foundry account in australiaeast carrying Content Understanding + document embeddings). Required for the AI Search corpus indexer."
  type        = bool
  default     = true
}

variable "au_document_location" {
  description = "Region for the Australian document plane. Must be a Content Understanding region — australiaeast keeps all data at rest onshore and does not use data-zone processing."
  type        = string
  default     = "australiaeast"

  validation {
    # Content Understanding GA regions, verified 2026-08-01.
    condition = contains([
      "australiaeast", "eastus", "eastus2", "japaneast", "northeurope",
      "southcentralus", "southeastasia", "swedencentral", "uksouth",
      "westeurope", "westus", "westus3",
    ], var.au_document_location)
    error_message = "au_document_location must be a region where Azure Content Understanding is available."
  }
}
