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
