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
  description = "Azure region for all resources."
  type        = string
  default     = "australiaeast"
}

variable "owner" {
  description = "Owner tag value — name or team owning the stack
  type        = string
  default     = "platform"
}
