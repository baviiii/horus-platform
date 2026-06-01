# ============================================
# DEPLOY COSMOS DB GRAPH - PowerShell Script
# ============================================
# This script deploys Azure Cosmos DB with Gremlin API for GraphRAG
# Supports multi-tenancy with tenant-specific databases and graphs
# Prerequisites: Azure CLI installed and logged in
# Usage: .\deploy-graph.ps1 [-TenantId <tenant-id>] [-EnableMultiTenancy]

param(
    [string]$ResourceGroup = "rg-careercraft-dev",
    [string]$Location = "australiaeast",
    [string]$AccountName = "careercraft-graph",
    [string]$TenantId = "",
    [switch]$EnableMultiTenancy = $false
)

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Deploying Azure Cosmos DB (Gremlin API)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check if Azure CLI is installed
try {
    $azVersion = az version 2>$null | ConvertFrom-Json
    Write-Host " Azure CLI version: $($azVersion.'azure-cli')" -ForegroundColor Green
} catch {
    Write-Host " Azure CLI not found. Please install: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Red
    exit 1
}

# Check if logged in
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host " Not logged in to Azure. Running 'az login'..." -ForegroundColor Yellow
    az login
}

Write-Host "Logged in as: $($account.user.name)" -ForegroundColor Green
Write-Host " Subscription: $($account.name)" -ForegroundColor Green
Write-Host ""

if ($EnableMultiTenancy) {
    Write-Host " Multi-Tenancy: ENABLED" -ForegroundColor Magenta
    Write-Host " Tenant ID: $TenantId" -ForegroundColor Magenta
    Write-Host ""
}

# Deploy Bicep template
Write-Host " Deploying Cosmos DB..." -ForegroundColor Yellow
$bicepPath = Join-Path (Split-Path $PSScriptRoot -Parent) "bicep\cosmos-graph.bicep"

if (-not (Test-Path $bicepPath)) {
    Write-Host " Bicep file not found: $bicepPath" -ForegroundColor Red
    exit 1
}

# Build parameters
$params = @(
    "accountName=$AccountName",
    "location=$Location"
)

if ($EnableMultiTenancy -and ![string]::IsNullOrEmpty($TenantId)) {
    $params += "enableMultiTenancy=true"
    $params += "tenantId=$TenantId"
}

$deployment = az deployment group create `
    --resource-group $ResourceGroup `
    --template-file $bicepPath `
    --parameters $params `
    --output json | ConvertFrom-Json

if ($LASTEXITCODE -ne 0) {
    Write-Host " Deployment failed!" -ForegroundColor Red
    exit 1
}

Write-Host " Cosmos DB deployed successfully!" -ForegroundColor Green
Write-Host ""

# Get connection details
Write-Host " Getting connection details..." -ForegroundColor Yellow

$gremlinEndpoint = $deployment.properties.outputs.gremlinEndpoint.value
$databaseName = $deployment.properties.outputs.databaseName.value
$graphName = $deployment.properties.outputs.graphName.value

# Get primary key
$primaryKey = az cosmosdb keys list `
    --name $AccountName `
    --resource-group $ResourceGroup `
    --query primaryMasterKey `
    --output tsv

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  DEPLOYMENT COMPLETE!" -ForegroundColor Green
if ($EnableMultiTenancy) {
    Write-Host "  Tenant: $TenantId" -ForegroundColor Magenta
}
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Add these to your Azure Functions Application Settings:" -ForegroundColor Cyan
Write-Host ""
Write-Host "COSMOS_GREMLIN_ENDPOINT=$gremlinEndpoint" -ForegroundColor White
Write-Host "COSMOS_PRIMARY_KEY=$primaryKey" -ForegroundColor White
Write-Host "COSMOS_DATABASE=$databaseName" -ForegroundColor White
Write-Host "COSMOS_GRAPH=$graphName" -ForegroundColor White
if ($EnableMultiTenancy) {
    Write-Host "TENANT_ID=$TenantId" -ForegroundColor White
}
Write-Host ""
Write-Host "Add this to your frontend .env:" -ForegroundColor Cyan
Write-Host ""
Write-Host "VITE_AZURE_GRAPH_QUERY_URL=https://careercraft-functions-dev.azurewebsites.net/api/graph-query" -ForegroundColor White
if ($EnableMultiTenancy) {
    Write-Host "VITE_TENANT_ID=$TenantId" -ForegroundColor White
}
Write-Host ""

# Save to file for reference
$envContent = @"
# Cosmos DB Connection (generated $(Get-Date -Format "yyyy-MM-dd HH:mm"))
COSMOS_GREMLIN_ENDPOINT=$gremlinEndpoint
COSMOS_PRIMARY_KEY=$primaryKey
COSMOS_DATABASE=$databaseName
COSMOS_GRAPH=$graphName
"@

if ($EnableMultiTenancy) {
    $envContent += "`nTENANT_ID=$TenantId"
}

$envPath = Join-Path (Split-Path $PSScriptRoot -Parent) "config\.cosmos-env"
$envContent | Out-File -FilePath $envPath -Encoding utf8
Write-Host " Connection details saved to: $envPath" -ForegroundColor Gray
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Add environment variables to Azure Functions" -ForegroundColor White
Write-Host "2. Redeploy Azure Functions with: func azure functionapp publish careercraft-functions-dev" -ForegroundColor White
Write-Host "3. Run graph population: .\populate-graph.ps1" -ForegroundColor White
Write-Host ""
