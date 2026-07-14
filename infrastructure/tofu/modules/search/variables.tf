variable "resource_group_name" {
  description = "Resource group to deploy the search service into."
  type        = string
}

variable "location" {
  description = "Azure region for the search service."
  type        = string
}

variable "name_prefix" {
  description = "Prefix used to build the service name (e.g. horus-dev)."
  type        = string
}

variable "sku" {
  description = "Search service SKU. free = $0 demo tier (50MB, no SLA); basic+ = production."
  type        = string
  default     = "free"

  validation {
    condition     = contains(["free", "basic", "standard", "standard2", "standard3"], var.sku)
    error_message = "sku must be one of: free, basic, standard, standard2, standard3."
  }
}

variable "tags" {
  description = "Tags applied to the search service."
  type        = map(string)
  default     = {}
}
