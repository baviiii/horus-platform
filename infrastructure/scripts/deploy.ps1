# Deploy CareerCraft RAG Infrastructure to Azure
# Cost-optimized configuration for Australia East region

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "australiaeast",
    
    [Parameter(Mandatory=$false)]
    [string]$Environment = "dev",
    
    [Parameter(Mandatory=$false)]
    [switch]$EnableOpenAI = $false
)

Write-Host "Deploying CareerCraft RAG Infrastructure..." -ForegroundColor Cyan
Write-Host "Resource Group: $ResourceGroupName" -ForegroundColor Yellow
Write-Host "Location: $Location" -ForegroundColor Yellow
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host ""

# Check if Azure CLI is installed
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "Azure CLI is not installed. Please install it first." -ForegroundColor Red
    exit 1
}

# Login check
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "Not logged in to Azure. Logging in..." -ForegroundColor Yellow
    az login
}

# Create resource group if it doesn't exist
Write-Host "Creating resource group..." -ForegroundColor Cyan
az group create --name $ResourceGroupName --location $Location 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Resource group may already exist, continuing..." -ForegroundColor Yellow
}

# Change to infrastructure/bicep directory for Bicep files
$scriptDir = Split-Path -Parent $PSScriptRoot
$bicepDir = Join-Path $scriptDir "bicep"
Push-Location $bicepDir

try {
    # Build parameters - paths are relative to bicep directory
$paramFile = "parameters/$Environment.bicepparam"
    $templateFile = "main.bicep"
    
    # Verify files exist
    if (-not (Test-Path $paramFile)) {
        Write-Host "ERROR: Parameter file not found: $paramFile" -ForegroundColor Red
        Write-Host "Expected location: $bicepDir\$paramFile" -ForegroundColor Yellow
        Pop-Location
        exit 1
    }
    
    if (-not (Test-Path $templateFile)) {
        Write-Host "ERROR: Bicep template not found: $templateFile" -ForegroundColor Red
        Write-Host "Expected location: $bicepDir\$templateFile" -ForegroundColor Yellow
        Pop-Location
        exit 1
    }
    
$params = @(
    "--parameters", $paramFile
)

if ($EnableOpenAI) {
    $params += "--parameters", "enableOpenAI=true"
    Write-Host "Azure OpenAI will be enabled (adds ~`$20-50/month)" -ForegroundColor Green
}

# Deploy Bicep template
Write-Host ""
Write-Host "Deploying infrastructure..." -ForegroundColor Cyan
Write-Host "(This may take 5-10 minutes...)" -ForegroundColor Gray

$ErrorActionPreference = "SilentlyContinue"

# Run deployment and capture only JSON output (suppress warnings)
$deploymentJson = az deployment group create `
    --resource-group $ResourceGroupName `
        --template-file $templateFile `
    --parameters $paramFile `
    --query "properties.outputs" `
    --output json `
    --only-show-errors
} finally {
    Pop-Location
}

$exitCode = $LASTEXITCODE
$ErrorActionPreference = "Continue"

if ($exitCode -ne 0 -or [string]::IsNullOrEmpty($deploymentJson)) {
    Write-Host "Deployment failed! Check Azure Portal for details." -ForegroundColor Red
    Write-Host "Resource Group: $ResourceGroupName" -ForegroundColor Yellow
    exit 1
}

try {
    $deployment = $deploymentJson | ConvertFrom-Json
}
catch {
    Write-Host "Deployment completed but output parsing failed." -ForegroundColor Yellow
    Write-Host "Check Azure Portal for deployed resources." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Deployment successful!" -ForegroundColor Green
Write-Host ""
Write-Host "Output Values (save these for environment variables):" -ForegroundColor Cyan
Write-Host ("=" * 80)

Write-Host "`nStorage Account:" -ForegroundColor Yellow
Write-Host "  VITE_AZURE_STORAGE_ACCOUNT=$($deployment.storageAccountName.value)"
Write-Host "  VITE_AZURE_STORAGE_KEY=$($deployment.storageAccountKey.value)"
Write-Host "  VITE_AZURE_STORAGE_CONTAINER=$($deployment.containerName.value)"

Write-Host "`nDocument Intelligence:" -ForegroundColor Yellow
Write-Host "  VITE_AZURE_DOC_INTEL_ENDPOINT=$($deployment.docIntelEndpoint.value)"
Write-Host "  VITE_AZURE_DOC_INTEL_KEY=$($deployment.docIntelKey.value)"

Write-Host "`nAI Search:" -ForegroundColor Yellow
Write-Host "  VITE_AZURE_SEARCH_ENDPOINT=$($deployment.aiSearchEndpoint.value)"
Write-Host "  VITE_AZURE_SEARCH_KEY=$($deployment.aiSearchKey.value)"

if ($EnableOpenAI -and $deployment.openAIEndpoint.value) {
    Write-Host "`nAzure OpenAI:" -ForegroundColor Yellow
    Write-Host "  VITE_AZURE_OPENAI_ENDPOINT=$($deployment.openAIEndpoint.value)"
    Write-Host "  VITE_AZURE_OPENAI_KEY=$($deployment.openAIKey.value)"
}

Write-Host ""
Write-Host "SECURITY WARNINGS:" -ForegroundColor Red
Write-Host "  1. NEVER commit these keys to Git!" -ForegroundColor Yellow
Write-Host "  2. Store keys in Supabase Environment Variables" -ForegroundColor Yellow
Write-Host "  3. Use .env.local (gitignored) for local development" -ForegroundColor Yellow
Write-Host ""
Write-Host $deployment.estimatedMonthlyCost.value -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Deploy OpenAI embedding model:" -ForegroundColor Yellow
Write-Host "   .\deploy-openai-model.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
Write-Host "2. Create search index:" -ForegroundColor Yellow
Write-Host "   .\create-search-index.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
Write-Host "3. Upload your 53 PDFs to Blob Storage container: $($deployment.containerName.value)" -ForegroundColor Yellow
Write-Host "4. Configure indexer to process PDFs from Blob Storage" -ForegroundColor Yellow
Write-Host "5. (Optional) Configure web scraping:" -ForegroundColor Yellow
Write-Host "   cd web-scraper; .\configure-web-scraping.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
Write-Host "6. Start indexing your documents!" -ForegroundColor Yellow
Write-Host ""
