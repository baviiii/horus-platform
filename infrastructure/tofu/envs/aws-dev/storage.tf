# Tenant files: uploaded documents, incident evidence, and the corpus PDFs
# (under corpus/). One private bucket, one prefix per tenant (t-<tenantId>/),
# mirroring the one-container-per-tenant layout on Azure.
resource "aws_s3_bucket" "documents" {
  bucket = "${local.name_prefix}-documents-${random_id.suffix.hex}"
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Abandoned multipart uploads are billed storage nobody can see.
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Only needed when browsers PUT presigned uploads directly; SDK callers
# upload server-to-server and need no CORS.
resource "aws_s3_bucket_cors_configuration" "documents" {
  count  = length(var.app_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.documents.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.app_origins
    allowed_headers = ["Content-Type"]
    max_age_seconds = 3600
  }
}
