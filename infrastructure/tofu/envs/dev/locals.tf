locals {
  name_prefix         = "${var.project}-${var.environment}"
  resource_group_name = "rg-${local.name_prefix}"

  common_tags = {
    project     = var.project
    environment = var.environment
    owner       = var.owner
    managed_by  = "opentofu"
  }
}
