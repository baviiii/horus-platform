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

variable "region" {
  description = "AWS region. Sydney keeps tenant and résumé data onshore and offers the AU Claude inference profile."
  type        = string
  default     = "ap-southeast-2"
}

variable "owner" {
  description = "Owner tag value — name or team owning the stack."
  type        = string
  default     = "platform"
}

variable "alert_email" {
  description = "Where budget alerts go. Required: a silent switch to paid usage is what ended the Azure stack."
  type        = string
}

variable "monthly_usage_budget_usd" {
  description = <<-EOT
    Alert threshold for gross monthly usage, before credits are applied — the
    rate the startup credits are being burned. Alerts at 50/80/100% actual
    and 100% forecast.
  EOT
  type        = number
  default     = 50
}

variable "out_of_pocket_budget_usd" {
  description = <<-EOT
    Alert threshold for net monthly cost after credits — money that would hit
    the card. Alerts as soon as $1 of it is actual, so running out of credits
    is an email the same day, not a surprise invoice.
  EOT
  type        = number
  default     = 5
}

variable "vector_dimensions" {
  description = "Width of every vector index. Titan Text Embeddings V2 supports 256, 512 or 1024; must match HORUS_VECTOR_DIMENSIONS in the app."
  type        = number
  default     = 1024

  validation {
    condition     = contains([256, 512, 1024], var.vector_dimensions)
    error_message = "vector_dimensions must be 256, 512 or 1024 (Titan V2 widths)."
  }
}

variable "embedding_model_id" {
  description = "Bedrock embedding model the app may invoke."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "app_origins" {
  description = "Browser origins allowed to PUT presigned uploads straight to S3. Empty = server-side uploads only."
  type        = list(string)
  default     = []
}

variable "create_app_access_key" {
  description = <<-EOT
    Mint an access key for the app user (Vercel). The secret lands in local
    state, which is gitignored; set false to create the key by hand instead.
  EOT
  type        = bool
  default     = true
}

# ── interview-coach-mcp (mcp.tf) ────────────────────────────────────────────

variable "mcp_image_tag" {
  description = <<-EOT
    Image tag (commit SHA) to create the MCP function from. Leave null for the
    first apply: there is no image in the registry yet. Once CI has pushed one,
    set it and apply again. After that, CI rolls new images itself.
  EOT
  type        = string
  default     = null
}

variable "mcp_memory_mb" {
  description = "Lambda memory for the MCP server. CPU scales with it; 1024 matches the 0.5 vCPU / 1 GiB container on Azure."
  type        = number
  default     = 1024
}

variable "mcp_timeout_seconds" {
  description = "Longest a single MCP request may run. Must outlast research plus one model call (LLM_TIMEOUT_MS)."
  type        = number
  default     = 300

  validation {
    condition     = var.mcp_timeout_seconds >= 30 && var.mcp_timeout_seconds <= 900
    error_message = "mcp_timeout_seconds must be 30-900 (Lambda's maximum is 15 minutes)."
  }
}

variable "mcp_cors_origin" {
  description = "CORS_ORIGIN for the MCP server. \"*\" is low-risk (every call needs a bearer JWT, no cookies); tighten to the Faircopy domain once it exists."
  type        = string
  default     = "*"
}

variable "mcp_settings" {
  description = <<-EOT
    Plain MCP server settings, as env vars: HORUS_MODE, HORUS_TENANT,
    HORUS_BASE_URL, HORUS_RAG_URL, HORUS_GRAPH_URL, HORUS_VOICE_URL,
    SUPABASE_URL, MARKET, RESEARCH_MODE, GROUNDING_MODE, … NODE_ENV, PORT,
    CORS_ORIGIN and the AWS_LWA_* adapter settings are set by mcp.tf.
  EOT
  type        = map(string)
  default     = {}
}

variable "mcp_secrets" {
  description = "Secret MCP settings, as env vars: SUPABASE_ANON_KEY, HORUS_API_KEY, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, … Kept in gitignored tfvars and local state."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "mcp_github_repo" {
  description = "owner/repo whose main branch may deploy the MCP image (GitHub OIDC)."
  type        = string
  default     = "baviiii/interview-coach-mcp"
}

variable "create_github_oidc_provider" {
  description = "Create the account's GitHub Actions OIDC provider. Set false if the account already has one; there can only be one per account."
  type        = bool
  default     = true
}
