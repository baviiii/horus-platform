# The identity Horus runs as on Vercel. Least privilege: Claude and Titan on
# Bedrock, the one guardrail, PII detection, its own buckets — nothing else.
#
# Vercel reserves the AWS_* variable names for its own Lambda role, so these
# keys go in as HORUS_AWS_ACCESS_KEY_ID / HORUS_AWS_SECRET_ACCESS_KEY.
resource "aws_iam_user" "app" {
  name = "${local.name_prefix}-app"
}

data "aws_iam_policy_document" "app" {
  # Claude through the Messages-API endpoint (bedrock-mantle). Model ARNs on
  # that endpoint aren't published per model, so this is scoped by action.
  statement {
    sid       = "ClaudeOnBedrock"
    actions   = ["bedrock-mantle:CreateInference"]
    resources = ["*"]
  }

  statement {
    sid     = "EmbeddingModel"
    actions = ["bedrock:InvokeModel"]
    resources = [
      "arn:aws:bedrock:${var.region}::foundation-model/${var.embedding_model_id}",
    ]
  }

  statement {
    sid       = "Moderation"
    actions   = ["bedrock:ApplyGuardrail"]
    resources = [aws_bedrock_guardrail.main.guardrail_arn]
  }

  # Incident de-identification. Comprehend has no resource-level scoping.
  statement {
    sid       = "PiiDetection"
    actions   = ["comprehend:DetectPiiEntities"]
    resources = ["*"]
  }

  statement {
    sid       = "TenantFiles"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
  }

  statement {
    sid       = "TenantFilesList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.documents.arn]
  }

  # CreateIndex lets the app create a missing index on first use, the same
  # self-healing the Azure store did; Tofu normally creates them first.
  statement {
    sid = "KnowledgeStore"
    actions = [
      "s3vectors:GetIndex",
      "s3vectors:CreateIndex",
      "s3vectors:QueryVectors",
      "s3vectors:GetVectors",
      "s3vectors:PutVectors",
      "s3vectors:ListVectors",
      "s3vectors:DeleteVectors",
    ]
    resources = [
      aws_s3vectors_vector_bucket.main.vector_bucket_arn,
      "${aws_s3vectors_vector_bucket.main.vector_bucket_arn}/index/*",
    ]
  }
}

resource "aws_iam_user_policy" "app" {
  name   = "horus-app"
  user   = aws_iam_user.app.name
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_access_key" "app" {
  count = var.create_app_access_key ? 1 : 0
  user  = aws_iam_user.app.name
}
