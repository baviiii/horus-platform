locals {
  name_prefix = "${var.project}-${var.environment}"

  common_tags = {
    project     = var.project
    environment = var.environment
    owner       = var.owner
    managed_by  = "opentofu"
  }

  # Index names match the Azure ones, so AZURE_SEARCH_INDEX_NAME /
  # AZURE_SEARCH_PLAYGROUND_INDEX keep working unchanged on AWS.
  knowledge_index  = "horus-knowledge"
  playground_index = "horus-playground"

  # Passage text, title and URL exceed the 2 KB filterable-metadata budget and
  # are only ever returned, never filtered on. Must match NON_FILTERABLE_KEYS
  # in packages/core/src/knowledge/store-s3vectors.ts.
  non_filterable_keys = ["content", "title", "sourceUrl"]

  # Where Bedrock's au. inference profiles run Claude: Sydney and Melbourne.
  au_inference_regions = ["ap-southeast-2", "ap-southeast-4"]
}

data "aws_caller_identity" "current" {}

resource "random_id" "suffix" {
  byte_length = 3
}
