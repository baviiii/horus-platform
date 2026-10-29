# Print Horus env vars for apps/web/.env.local and Vercel (run from envs/aws-dev after tofu apply).
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$outputs = tofu output -json | ConvertFrom-Json

function Get-TofuOutput([string]$name) {
  $prop = $outputs.PSObject.Properties[$name]
  if ($null -eq $prop -or $null -eq $prop.Value.value) { return '' }
  return [string]$prop.Value.value
}

$region       = Get-TofuOutput 'region'
$documents    = Get-TofuOutput 'documents_bucket'
$vectors      = Get-TofuOutput 'vector_bucket'
$knowledge    = Get-TofuOutput 'knowledge_index'
$playground   = Get-TofuOutput 'playground_index'
$dimensions   = Get-TofuOutput 'vector_dimensions'
$guardrail    = Get-TofuOutput 'guardrail_id'
$guardrailVer = Get-TofuOutput 'guardrail_version'
$embedding    = Get-TofuOutput 'embedding_model_id'
$keyId        = Get-TofuOutput 'app_access_key_id'
$secret       = Get-TofuOutput 'app_secret_access_key'

Write-Host ""
Write-Host "# Paste into apps/web/.env.local and Vercel (from tofu apply in envs/aws-dev)"
Write-Host "# Not AWS_*: Vercel reserves those names for its own Lambda role."
Write-Host "HORUS_AI_PROVIDER=aws"
Write-Host "HORUS_AWS_REGION=$region"
Write-Host "HORUS_AWS_ACCESS_KEY_ID=$keyId"
Write-Host "HORUS_AWS_SECRET_ACCESS_KEY=$secret"
Write-Host "HORUS_S3_DOCUMENTS_BUCKET=$documents"
Write-Host "HORUS_S3VECTORS_BUCKET=$vectors"
Write-Host "HORUS_VECTOR_DIMENSIONS=$dimensions"
Write-Host "HORUS_BEDROCK_EMBEDDING_MODEL=$embedding"
Write-Host "HORUS_BEDROCK_GUARDRAIL_ID=$guardrail"
Write-Host "HORUS_BEDROCK_GUARDRAIL_VERSION=$guardrailVer"
Write-Host "# Models (any Bedrock model ID; in Sydney use au. inference profiles). Cheaper fast tier: au.anthropic.claude-haiku-4-5-20251001-v1:0"
Write-Host "HORUS_MODEL_FAST=au.anthropic.claude-sonnet-4-6"
Write-Host "HORUS_MODEL_DEEP=au.anthropic.claude-sonnet-4-6"
Write-Host "HORUS_MODEL_VISION=au.anthropic.claude-sonnet-4-6"
Write-Host "# Index names are shared with the Azure deployment; existing values keep working."
Write-Host "AZURE_SEARCH_INDEX_NAME=$knowledge"
Write-Host "AZURE_SEARCH_PLAYGROUND_INDEX=$playground"
Write-Host ""
