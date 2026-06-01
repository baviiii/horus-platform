variable "resource_group_name" {
  description = "Resource group to deploy the storage account into."
  type        = string
}

variable "location" {
  description = "Azure region for the storage account."
  type        = string
}

variable "name_prefix" {
  description = "Prefix used to build the storage account name (e.g. horus-dev). Hyphens are stripped automatically."
  type        = string
}

variable "container_names" {
  description = "Blob containers to create inside the storage account."
  type        = list(string)
  default     = ["documents", "rendered"]
}

variable "tags" {
  description = "Tags applied to the storage account."
  type        = map(string)
  default     = {}
}
