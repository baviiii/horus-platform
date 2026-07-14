variable "resource_group_name" {
  description = "Resource group to deploy Foundry resources into."
  type        = string
}

variable "resource_group_id" {
  description = "Full ARM id of the resource group (parent for the Bing grounding account)."
  type        = string
}

variable "location" {
  description = "Azure region for the Foundry account. Must offer every deployed model (chat, embedding, realtime) plus the Agent Service."
  type        = string
}

variable "name_prefix" {
  description = "Prefix used to build resource names (e.g. horus-dev)."
  type        = string
}

variable "project_display_name" {
  description = "Human-facing project name shown in the Foundry portal."
  type        = string
  default     = "Horus"
}

variable "project_description" {
  description = "Project description shown in the Foundry portal."
  type        = string
  default     = "Horus knowledge-agent engine — ingestion, RAG, agents, voice."
}

variable "chat_model_name" {
  description = "Chat model to deploy (agent brain)."
  type        = string
  default     = "gpt-4o"
}

variable "chat_model_version" {
  description = "Chat model version; null lets Azure pick the current default."
  type        = string
  default     = null
}

variable "chat_sku_name" {
  description = "Chat deployment SKU. GlobalStandard = pooled global capacity, widest model availability."
  type        = string
  default     = "GlobalStandard"
}

variable "chat_capacity" {
  description = "Chat deployment capacity in thousands of TPM."
  type        = number
  default     = 50
}

variable "embedding_deployment_name" {
  description = "Embedding deployment name (RAG ingestion + retrieval)."
  type        = string
  default     = "text-embedding-3-large"
}

variable "embedding_sku_name" {
  description = "Embedding deployment SKU."
  type        = string
  default     = "GlobalStandard"
}

variable "embedding_capacity" {
  description = "Embedding deployment capacity in thousands of TPM."
  type        = number
  default     = 50
}

variable "realtime_model_name" {
  description = "Realtime speech-to-speech model for full-duplex voice."
  type        = string
  default     = "gpt-realtime-2.1-mini"
}

variable "realtime_model_version" {
  description = "Realtime model version (explicit — the deployments API rejects null for the newest models)."
  type        = string
  default     = "2026-07-07"
}

variable "realtime_sku_name" {
  description = "Realtime deployment SKU (GlobalStandard is the only broadly available option)."
  type        = string
  default     = "GlobalStandard"
}

variable "realtime_capacity" {
  description = "Realtime deployment capacity in thousands of TPM (audio tokens are hungry — take the full pool)."
  type        = number
  default     = 10
}

variable "deploy_bing_grounding" {
  description = "Provision Grounding-with-Bing-Search and connect it to the project (live web search for agents)."
  type        = bool
  default     = true
}

variable "developer_principal_ids" {
  description = "Entra object ids granted the 'Azure AI User' data-plane role on the account (Agent Service requires Entra auth; Owner alone has no dataActions)."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
