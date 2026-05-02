# Deploy Azure Functions for RAG Metadata
# This script deploys BOTH Function App infrastructure AND function code
# Safe to run - won't break existing resources

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$Environment = "dev",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "australiaeast"
)

Write-Host "Deploying Azure Functions (Infrastructure + Code)..." -ForegroundColor Cyan
Write-Host "Resource Group: $ResourceGroupName" -ForegroundColor Yellow
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host ""
Write-Host "SAFE: This won't break existing resources or data!" -ForegroundColor Green
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

# Register required resource providers
Write-Host "Registering required resource providers..." -ForegroundColor Cyan
az provider register --namespace Microsoft.OperationalInsights --wait 2>$null | Out-Null
az provider register --namespace Microsoft.Insights --wait 2>$null | Out-Null
az provider register --namespace Microsoft.Web --wait 2>$null | Out-Null
Write-Host "Resource providers registered." -ForegroundColor Green
Write-Host ""

# Step 1: Deploy Function App Infrastructure (if it doesn't exist)
$functionAppName = "careercraft-functions-$Environment"
$functionApp = az functionapp list --resource-group $ResourceGroupName --query "[?name=='$functionAppName']" --output json | ConvertFrom-Json

if (-not $functionApp) {
    Write-Host "Function App '$functionAppName' not found. Creating infrastructure..." -ForegroundColor Yellow
    Write-Host ""
    
    # Get existing resource information
    $searchService = az search service show --resource-group $ResourceGroupName --name "careercraft-search-$Environment" --output json 2>$null | ConvertFrom-Json
    $openAIService = az cognitiveservices account show --resource-group $ResourceGroupName --name "careercraft-openai-$Environment" --output json 2>$null | ConvertFrom-Json
    $docIntelService = az cognitiveservices account show --resource-group $ResourceGroupName --name "careercraft-docintel-$Environment" --output json 2>$null | ConvertFrom-Json
    $storageAccount = az storage account show --resource-group $ResourceGroupName --name (az storage account list --resource-group $ResourceGroupName --query "[0].name" -o tsv) --output json 2>$null | ConvertFrom-Json

    if (-not $searchService -or -not $storageAccount) {
        Write-Host "ERROR: Required resources not found!" -ForegroundColor Red
        Write-Host "Please deploy infrastructure first using: .\deploy.ps1" -ForegroundColor Yellow
        exit 1
    }

    # Get keys
    $searchKey = az search admin-key show --resource-group $ResourceGroupName --service-name $searchService.name --query "primaryKey" -o tsv
    $storageKey = az storage account keys list --resource-group $ResourceGroupName --account-name $storageAccount.name --query "[0].value" -o tsv
    $searchEndpoint = $searchService.properties.endpoint
    $openAIEndpoint = if ($openAIService) { $openAIService.properties.endpoint } else { "" }
    $openAIKey = if ($openAIService) { (az cognitiveservices account keys list --resource-group $ResourceGroupName --name $openAIService.name --query "key1" -o tsv) } else { "" }
    # Document Intelligence for chart/figure extraction (S1 tier)
    $docIntelEndpoint = if ($docIntelService) { $docIntelService.properties.endpoint } else { "" }
    $docIntelKey = if ($docIntelService) { (az cognitiveservices account keys list --resource-group $ResourceGroupName --name $docIntelService.name --query "key1" -o tsv) } else { "" }

    # Create temporary Bicep file for Functions infrastructure
    # Use relative path - temp file is in infrastructure directory, module is in modules subdirectory
    $functionsBicep = @"
targetScope = 'resourceGroup'

@description('Location for resources')
param location string = '$Location'

@description('Environment name')
param environment string = '$Environment'

@description('Project name')
param projectName string = 'careercraft'

module azureFunctions 'modules/azure-functions.bicep' = {
  name: 'azureFunctionsDeployment'
  params: {
    functionAppName: 'careercraft-functions-`${environment}'
    location: location
    environment: environment
    projectName: projectName
    searchEndpoint: '$searchEndpoint'
    searchKey: '$searchKey'
    searchIndex: 'sa-gov-documents'
    openAIEndpoint: '$openAIEndpoint'
    openAIKey: '$openAIKey'
    docIntelEndpoint: '$docIntelEndpoint'
    docIntelKey: '$docIntelKey'
    storageAccountName: '$($storageAccount.name)'
    storageAccountKey: '$storageKey'
  }
}

output functionsAppName string = azureFunctions.outputs.functionAppName
output functionsAppUrl string = azureFunctions.outputs.functionAppUrl
"@

    $tempBicepFile = Join-Path $PSScriptRoot "functions-infra-temp.bicep"
    $functionsBicep | Out-File -FilePath $tempBicepFile -Encoding UTF8

    Write-Host "Deploying Function App infrastructure..." -ForegroundColor Cyan
    # Change to infrastructure directory so relative paths work
    Push-Location $PSScriptRoot
    try {
        $deployment = az deployment group create `
            --resource-group $ResourceGroupName `
            --template-file "functions-infra-temp.bicep" `
            --parameters "environment=$Environment" `
            --query "properties.outputs" `
            --output json
    } finally {
        Pop-Location
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Infrastructure deployment failed!" -ForegroundColor Red
        Remove-Item $tempBicepFile -ErrorAction SilentlyContinue
        exit 1
    }

    $outputs = $deployment | ConvertFrom-Json
    Write-Host "Function App infrastructure created successfully!" -ForegroundColor Green
    Write-Host ""
    
    Remove-Item $tempBicepFile -ErrorAction SilentlyContinue
    
    # Refresh function app reference
    Start-Sleep -Seconds 5
    $functionApp = az functionapp list --resource-group $ResourceGroupName --query "[?name=='$functionAppName']" --output json | ConvertFrom-Json
}

Write-Host "Found Function App: $functionAppName" -ForegroundColor Green
Write-Host ""

# Get function app URL
$functionAppUrl = $functionApp.defaultHostName
Write-Host "Function App URL: https://$functionAppUrl" -ForegroundColor Cyan
Write-Host ""

# Deploy function code via ZIP (Azure CLI method)
Write-Host "Deploying function code..." -ForegroundColor Cyan

$functionCodePath = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "packages\horus-services"
if (-not (Test-Path $functionCodePath)) {
    Write-Host "ERROR: Function code directory not found: $functionCodePath" -ForegroundColor Red
    exit 1
}
$functionCodePath = Resolve-Path $functionCodePath

# Create ZIP deployment package
$zipPath = Join-Path $env:TEMP "functions-deploy.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Write-Host "Creating deployment package..." -ForegroundColor Cyan
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($functionCodePath, $zipPath)
    
    if (-not (Test-Path $zipPath)) {
        throw "ZIP file was not created"
    }
} catch {
    Write-Host "ERROR: Failed to create ZIP package: $_" -ForegroundColor Red
    exit 1
}

# Deploy to Azure Functions
Write-Host "Deploying to Azure Functions..." -ForegroundColor Cyan
az functionapp deployment source config-zip `
    --resource-group $ResourceGroupName `
    --name $functionAppName `
    --src $zipPath | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Deployment failed. Check Azure CLI output above." -ForegroundColor Red
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "Function code deployed successfully!" -ForegroundColor Green
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

# Ensure Node.js runtime is configured (critical for function execution)
Write-Host "Verifying Node.js runtime configuration..." -ForegroundColor Cyan
az functionapp config appsettings set `
    --name $functionAppName `
    --resource-group $ResourceGroupName `
    --settings "FUNCTIONS_EXTENSION_VERSION=~4" "FUNCTIONS_WORKER_RUNTIME=node" "WEBSITE_NODE_DEFAULT_VERSION=~20" | Out-Null
Write-Host "Runtime configuration verified." -ForegroundColor Green

# Add Document Intelligence settings for chart extraction (if available)
Write-Host "Configuring chart extraction dependencies..." -ForegroundColor Cyan
$docIntelService = az cognitiveservices account show --resource-group $ResourceGroupName --name "careercraft-docintel-$Environment" --output json 2>$null | ConvertFrom-Json
if ($docIntelService) {
    $docIntelEndpoint = $docIntelService.properties.endpoint
    $docIntelKey = az cognitiveservices account keys list --resource-group $ResourceGroupName --name $docIntelService.name --query "key1" -o tsv 2>$null
    
    if ($docIntelEndpoint -and $docIntelKey) {
        az functionapp config appsettings set `
            --name $functionAppName `
            --resource-group $ResourceGroupName `
            --settings "AZURE_DOC_INTEL_ENDPOINT=$docIntelEndpoint" "AZURE_DOC_INTEL_KEY=$docIntelKey" | Out-Null
        Write-Host "  [OK] Document Intelligence configured for chart extraction" -ForegroundColor Green
    }
} else {
    Write-Host "  [INFO] Document Intelligence not found - chart extraction will work with images only" -ForegroundColor Yellow
}

# Add OpenAI Vision settings
$openAIService = az cognitiveservices account show --resource-group $ResourceGroupName --name "careercraft-openai-$Environment" --output json 2>$null | ConvertFrom-Json
if ($openAIService) {
    $openAIEndpoint = $openAIService.properties.endpoint
    $openAIKey = az cognitiveservices account keys list --resource-group $ResourceGroupName --name $openAIService.name --query "key1" -o tsv 2>$null
    
    if ($openAIEndpoint -and $openAIKey) {
        # Use gpt-4o-mini for vision - it's deployed and supports vision capabilities
        az functionapp config appsettings set `
            --name $functionAppName `
            --resource-group $ResourceGroupName `
            --settings "AZURE_OPENAI_ENDPOINT=$openAIEndpoint" "AZURE_OPENAI_KEY=$openAIKey" "AZURE_OPENAI_VISION_DEPLOYMENT=gpt-4o-mini" | Out-Null
        Write-Host "  [OK] OpenAI Vision configured (gpt-4o-mini)" -ForegroundColor Green
    }
} else {
    Write-Host "  [WARN] OpenAI not found - chart extraction will NOT work!" -ForegroundColor Red
}

# PDF Rendering Configuration (Azure Container Instance)
Write-Host ""
Write-Host "PDF Rendering Configuration..." -ForegroundColor Cyan
Write-Host "  Chart extraction uses Azure Container Instance (ACI) for PDF rendering" -ForegroundColor Gray
Write-Host "  This uses your Azure credits - no external APIs needed!" -ForegroundColor Green
Write-Host ""
Write-Host "  To deploy the PDF renderer, run:" -ForegroundColor Yellow
Write-Host "    .\deploy-pdf-renderer.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
Write-Host ""
Write-Host "  This will:" -ForegroundColor Gray
Write-Host "    - Create Azure Container Registry (ACR)" -ForegroundColor Gray
Write-Host "    - Build and deploy PDF renderer container" -ForegroundColor Gray
Write-Host "    - Configure PDF_RENDERER_ENDPOINT automatically" -ForegroundColor Gray
Write-Host ""
Write-Host "  Cost: ~`$0.10-0.30/hour while running (billed per second)" -ForegroundColor Yellow
Write-Host ""

# Get function key for frontend (using REST API)
Write-Host ""
Write-Host "Retrieving function keys..." -ForegroundColor Cyan
$masterKey = ""

try {
    # Get access token
    $token = az account get-access-token --query "accessToken" -o tsv 2>$null
    if ($token) {
        $subscriptionId = az account show --query "id" -o tsv
        $apiUrl = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.Web/sites/$functionAppName/host/default/listKeys?api-version=2021-03-01"
        
        $headers = @{
            "Authorization" = "Bearer $token"
            "Content-Type" = "application/json"
        }
        
        $response = Invoke-RestMethod -Uri $apiUrl -Method POST -Headers $headers -ErrorAction SilentlyContinue
        if ($response.masterKey) {
            $masterKey = $response.masterKey
        }
    }
} catch {
    Write-Host "WARNING: Could not retrieve function keys automatically." -ForegroundColor Yellow
}

Write-Host ""
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host ""
Write-Host "Function App URL: https://$functionAppUrl" -ForegroundColor Yellow
Write-Host ""

# Output all function endpoints
Write-Host "Function Endpoints:" -ForegroundColor Cyan
Write-Host "  RAG Metadata:       https://$functionAppUrl/api/rag-metadata" -ForegroundColor White
Write-Host "  Agentic Planner:    https://$functionAppUrl/api/agentic-planner" -ForegroundColor White
Write-Host "  Graph Query:        https://$functionAppUrl/api/graph-query" -ForegroundColor White
Write-Host "  Chart Extraction:   https://$functionAppUrl/api/chart-extraction" -ForegroundColor Magenta
Write-Host ""

Write-Host "For Chart/Image Extraction (PDF Processing):" -ForegroundColor Magenta
Write-Host "  Set this before running process-pdfs.ps1:" -ForegroundColor Yellow
Write-Host "  `$env:CHART_EXTRACTION_ENDPOINT = 'https://$functionAppUrl/api/chart-extraction'" -ForegroundColor White
Write-Host ""

Write-Host "Add these to your frontend .env file:" -ForegroundColor Cyan
Write-Host "VITE_AZURE_FUNCTIONS_URL=https://$functionAppUrl" -ForegroundColor White
if ($masterKey) {
    Write-Host "VITE_AZURE_FUNCTIONS_KEY=$masterKey" -ForegroundColor White
} else {
    Write-Host "VITE_AZURE_FUNCTIONS_KEY=<get-from-azure-portal>" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "To get the function key manually:" -ForegroundColor Cyan
Write-Host "  az functionapp keys list --resource-group $ResourceGroupName --name $functionAppName --query 'masterKey' -o tsv" -ForegroundColor Gray
Write-Host ""
Write-Host "Note: Function keys are sensitive. Keep them secure!" -ForegroundColor Yellow
Write-Host ""

