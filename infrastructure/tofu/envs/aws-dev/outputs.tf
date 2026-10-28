output "region" {
  value = var.region
}

output "account_id" {
  value = data.aws_caller_identity.current.account_id
}

output "documents_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "vector_bucket" {
  value = aws_s3vectors_vector_bucket.main.vector_bucket_name
}

output "knowledge_index" {
  value = aws_s3vectors_index.knowledge.index_name
}

output "playground_index" {
  value = aws_s3vectors_index.playground.index_name
}

output "vector_dimensions" {
  value = var.vector_dimensions
}

output "guardrail_id" {
  value = aws_bedrock_guardrail.main.guardrail_id
}

output "guardrail_version" {
  value = aws_bedrock_guardrail_version.main.version
}

output "embedding_model_id" {
  value = var.embedding_model_id
}

output "app_access_key_id" {
  value = var.create_app_access_key ? aws_iam_access_key.app[0].id : null
}

output "app_secret_access_key" {
  value     = var.create_app_access_key ? aws_iam_access_key.app[0].secret : null
  sensitive = true
}

output "mcp_ecr_repository_url" {
  description = "Where CI pushes the MCP image."
  value       = aws_ecr_repository.mcp.repository_url
}

output "mcp_function_name" {
  value = local.mcp_name
}

output "mcp_url" {
  description = "Public URL of the MCP server. Goes into Faircopy's VITE_INTERVIEW_MCP_URL. Null until mcp_image_tag is set."
  value       = local.mcp_deploy ? aws_lambda_function_url.mcp[0].function_url : null
}

output "mcp_deploy_role_arn" {
  description = "Role the MCP repo's GitHub Actions assume to push and roll images (AWS_DEPLOY_ROLE_ARN in that workflow)."
  value       = aws_iam_role.mcp_deploy.arn
}
