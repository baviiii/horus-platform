# Knowledge store: S3 Vectors replaces Azure AI Search. No minimum charge —
# storage plus per-query pricing — which is the point: AI Search Basic billed
# ~A$135/month idle and is what drained the Azure credits.
#
# Buckets created after 2026-09-30 get ENHANCED indexes: metadata filters run
# before the vector search, so tenant-scoped queries return a full top K.
resource "aws_s3vectors_vector_bucket" "main" {
  vector_bucket_name = "${local.name_prefix}-vectors-${random_id.suffix.hex}"
}

# Corpus + workspace knowledge (tenant/session partitions in metadata).
resource "aws_s3vectors_index" "knowledge" {
  vector_bucket_name = aws_s3vectors_vector_bucket.main.vector_bucket_name
  index_name         = local.knowledge_index
  data_type          = "float32"
  dimension          = var.vector_dimensions
  distance_metric    = "cosine"

  metadata_configuration {
    non_filterable_metadata_keys = local.non_filterable_keys
  }
}

# Public playground sessions live in their own index so TTL sweeps and quota
# counts scan only playground vectors.
resource "aws_s3vectors_index" "playground" {
  vector_bucket_name = aws_s3vectors_vector_bucket.main.vector_bucket_name
  index_name         = local.playground_index
  data_type          = "float32"
  dimension          = var.vector_dimensions
  distance_metric    = "cosine"

  metadata_configuration {
    non_filterable_metadata_keys = local.non_filterable_keys
  }
}
