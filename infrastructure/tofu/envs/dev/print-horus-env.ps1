# Print Horus env vars for apps/web/.env.local (run from envs/dev after tofu apply).
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$outputs = tofu output -json | ConvertFrom-Json

function Get-TofuOutput([string]$name) {
  $prop = $outputs.PSObject.Properties[$name]
  if ($null -eq $prop -or $null -eq $prop.Value.value) { return '' }
  return [string]$prop.Value.value
}

$aoaiEndpoint = Get-TofuOutput 'openai_endpoint'
$aoaiKey      = Get-TofuOutput 'openai_primary_access_key'
$chat         = Get-TofuOutput 'openai_chat_deployment'
$embed        = Get-TofuOutput 'openai_embedding_deployment'
$embedSmall   = Get-TofuOutput 'openai_embedding_small_deployment'
$realtime     = Get-TofuOutput 'openai_realtime_deployment'
$projectEp    = Get-TofuOutput 'ai_project_endpoint'
$safetyEp     = Get-TofuOutput 'content_safety_endpoint'
$bingConn     = Get-TofuOutput 'bing_connection_id'
$searchEp     = Get-TofuOutput 'search_endpoint'
$searchKey    = Get-TofuOutput 'search_primary_key'

Write-Host ""
Write-Host "# Paste into apps/web/.env.local (from tofu apply)"
Write-Host "AZURE_OPENAI_ENDPOINT=$aoaiEndpoint"
Write-Host "AZURE_OPENAI_API_KEY=$aoaiKey"
Write-Host "AZURE_OPENAI_API_VERSION=2024-10-21"
Write-Host "AZURE_OPENAI_FAST_MODEL=$chat"
Write-Host "AZURE_OPENAI_DEEP_MODEL=$chat"
Write-Host "AZURE_OPENAI_COMPLETION_MODEL=$chat"
Write-Host "AZURE_OPENAI_EMBEDDING_MODEL=$embed"
Write-Host "AZURE_OPENAI_EMBEDDING_SMALL_MODEL=$embedSmall"
Write-Host "AZURE_OPENAI_REALTIME_DEPLOYMENT=$realtime"
Write-Host "AZURE_AI_PROJECT_ENDPOINT=$projectEp"
Write-Host "AZURE_CONTENT_SAFETY_ENDPOINT=$safetyEp"
if ($bingConn) { Write-Host "AZURE_BING_CONNECTION_ID=$bingConn" }
Write-Host "AZURE_SEARCH_ENDPOINT=$searchEp"
Write-Host "AZURE_SEARCH_API_KEY=$searchKey"
Write-Host "AZURE_SEARCH_PLAYGROUND_INDEX=horus-playground"
Write-Host ""
