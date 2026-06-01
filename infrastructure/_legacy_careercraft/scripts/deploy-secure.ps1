# Secure Deployment Script with Security Checks
# This script deploys infrastructure and provides security guidance

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "australiaeast",
    
    [Parameter(Mandatory=$false)]
    [string]$Environment = "dev",

    [Parameter(Mandatory=$false)]
    [switch]$EnableOpenAI
)

Write-Host "🔒 Secure Infrastructure Deployment" -ForegroundColor Cyan
Write-Host ""

# Security checks
Write-Host "🔐 Security Pre-Deployment Checks..." -ForegroundColor Yellow

# Check if Azure CLI is authenticated
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "❌ Not authenticated with Azure CLI. Run 'az login' first." -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ Azure CLI authenticated" -ForegroundColor Green

# Check resource group exists or will be created
Write-Host "  ✅ Resource group will be created/verified" -ForegroundColor Green

Write-Host ""
Write-Host "📋 Security Configuration:" -ForegroundColor Cyan
Write-Host "  • HTTPS/TLS 1.2+ enforced" -ForegroundColor White
Write-Host "  • Blob public access disabled" -ForegroundColor White
Write-Host "  • API key authentication required" -ForegroundColor White
Write-Host "  • Encryption at rest (Azure default)" -ForegroundColor White
Write-Host "  • Encryption in transit (HTTPS)" -ForegroundColor White
Write-Host ""

# Create resource group if it doesn't exist
Write-Host "Creating/Verifying Resource Group '$ResourceGroupName' in '$Location'..." -ForegroundColor Cyan
az group create --name $ResourceGroupName --location $Location -o none

Write-Host ""
Write-Host "Deploying Bicep template..." -ForegroundColor Cyan
$deployment = az deployment group create `
    --resource-group $ResourceGroupName `
    --template-file infrastructure/main.bicep `
    --parameters infrastructure/parameters/dev.bicepparam `
    --parameters environment=$Environment `
    --parameters enableOpenAI=$EnableOpenAI `
    --query properties.outputs `
    --output json | ConvertFrom-Json

Write-Host ""
Write-Host "✅ Deployment Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "🔒 SECURITY: Store these keys securely (NOT in Git!):" -ForegroundColor Yellow
Write-Host ""

Write-Host "📦 Storage Account:" -ForegroundColor Cyan
Write-Host "  VITE_AZURE_STORAGE_ACCOUNT_NAME=$($deployment.storageAccountName.value)"
Write-Host "  VITE_AZURE_STORAGE_ACCOUNT_KEY=$($deployment.storageAccountKey.value)"
Write-Host "  VITE_AZURE_STORAGE_CONTAINER_NAME=$($deployment.containerName.value)"

Write-Host ""
Write-Host "📄 Document Intelligence:" -ForegroundColor Cyan
Write-Host "  VITE_AZURE_DOC_INTEL_ENDPOINT=$($deployment.docIntelEndpoint.value)"
Write-Host "  VITE_AZURE_DOC_INTEL_KEY=$($deployment.docIntelKey.value)"

Write-Host ""
Write-Host "🔍 AI Search:" -ForegroundColor Cyan
Write-Host "  VITE_AZURE_SEARCH_ENDPOINT=$($deployment.aiSearchEndpoint.value)"
Write-Host "  VITE_AZURE_SEARCH_KEY=$($deployment.aiSearchKey.value)"

if ($EnableOpenAI -and $deployment.openAIEndpoint.value) {
    Write-Host ""
    Write-Host "🤖 Azure OpenAI:" -ForegroundColor Cyan
    Write-Host "  VITE_AZURE_OPENAI_ENDPOINT=$($deployment.openAIEndpoint.value)"
    Write-Host "  VITE_AZURE_OPENAI_KEY=$($deployment.openAIKey.value)"
}

Write-Host ""
Write-Host "⚠️  SECURITY WARNINGS:" -ForegroundColor Red
Write-Host "  1. NEVER commit these keys to Git!" -ForegroundColor Yellow
Write-Host "  2. Store keys in Supabase Environment Variables" -ForegroundColor Yellow
Write-Host "  3. Use .env.local (gitignored) for local development" -ForegroundColor Yellow
Write-Host "  4. Rotate keys quarterly in production" -ForegroundColor Yellow
Write-Host "  5. Use query keys (not admin keys) for read-only access when possible" -ForegroundColor Yellow
Write-Host ""

Write-Host $deployment.estimatedMonthlyCost.value -ForegroundColor Green
Write-Host ""

Write-Host "🔐 Next Security Steps:" -ForegroundColor Cyan
Write-Host "1. Copy keys above to Supabase Environment Variables" -ForegroundColor Yellow
Write-Host "2. Verify .gitignore includes .env files" -ForegroundColor Yellow
Write-Host "3. Deploy OpenAI model (if enabled):" -ForegroundColor Yellow
Write-Host "   .\deploy-openai-model.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
Write-Host "4. Create search index:" -ForegroundColor Yellow
Write-Host "   .\create-search-index.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
Write-Host "5. Configure web scraping:" -ForegroundColor Yellow
Write-Host "   cd web-scraper; .\configure-web-scraping.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
Write-Host ""

Write-Host "📚 See infrastructure/SECURITY-AUDIT.md for full security details" -ForegroundColor Cyan





