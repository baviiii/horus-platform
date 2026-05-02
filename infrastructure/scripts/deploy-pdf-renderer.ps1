# Deploy PDF Renderer to Azure Container Instance
# Uses your Azure credits - very affordable!

param(
    [string]$ResourceGroupName = "rg-careercraft-dev"
)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PDF RENDERER - Azure Container Instance Deployment" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will deploy a PDF rendering service using Azure credits" -ForegroundColor Yellow
Write-Host "Cost: ~`$0.10-0.30/hour while running (billed per second)" -ForegroundColor Yellow
Write-Host ""

# Get resource group location
$rg = az group show --name $ResourceGroupName --output json | ConvertFrom-Json
$location = $rg.location
Write-Host "Resource Group: $ResourceGroupName" -ForegroundColor Gray
Write-Host "Location: $location" -ForegroundColor Gray
Write-Host ""

# Create Azure Container Registry (ACR) if not exists
$acrName = "careercraft$($ResourceGroupName -replace '[^a-z0-9]', '')acr".Substring(0, [Math]::Min(50, ("careercraft$($ResourceGroupName -replace '[^a-z0-9]', '')acr").Length))
$acrName = "careercraftacr$([datetime]::Now.ToString('MMdd'))"

Write-Host "[STEP 1] Checking/Creating Azure Container Registry..." -ForegroundColor Cyan
$existingAcr = az acr show --name $acrName --resource-group $ResourceGroupName --output json 2>$null | ConvertFrom-Json
if (-not $existingAcr) {
    Write-Host "  Creating ACR: $acrName..." -ForegroundColor Yellow
    az acr create --resource-group $ResourceGroupName --name $acrName --sku Basic --admin-enabled true --output none
    Write-Host "  [OK] ACR created" -ForegroundColor Green
} else {
    Write-Host "  [OK] ACR already exists: $acrName" -ForegroundColor Green
}

# Get ACR credentials
Write-Host ""
Write-Host "[STEP 2] Getting ACR credentials..." -ForegroundColor Cyan
$acrCreds = az acr credential show --name $acrName --resource-group $ResourceGroupName --output json | ConvertFrom-Json
$acrLoginServer = az acr show --name $acrName --resource-group $ResourceGroupName --query "loginServer" -o tsv
$acrUsername = $acrCreds.username
$acrPassword = $acrCreds.passwords[0].value
Write-Host "  Login Server: $acrLoginServer" -ForegroundColor Gray

# Build and push Docker image
Write-Host ""
Write-Host "[STEP 3] Building and pushing Docker image..." -ForegroundColor Cyan
$pdfRendererPath = Join-Path $PSScriptRoot "..\..\packages\horus-services\pdf-renderer"

if (-not (Test-Path $pdfRendererPath)) {
    Write-Host "  [ERROR] PDF renderer source not found at: $pdfRendererPath" -ForegroundColor Red
    exit 1
}

# Login to ACR
az acr login --name $acrName --output none

# Build and push using ACR Tasks (no local Docker needed!)
Write-Host "  Building image using ACR Tasks (cloud build)..." -ForegroundColor Yellow
az acr build --registry $acrName --image pdf-renderer:latest --file "$pdfRendererPath\Dockerfile" $pdfRendererPath --output none
Write-Host "  [OK] Image built and pushed to ACR" -ForegroundColor Green

# Deploy Azure Container Instance
Write-Host ""
Write-Host "[STEP 4] Deploying Azure Container Instance..." -ForegroundColor Cyan
$aciName = "careercraft-pdf-renderer"
$imageName = "$acrLoginServer/pdf-renderer:latest"

# Delete existing ACI if exists
$existingAci = az container show --name $aciName --resource-group $ResourceGroupName --output json 2>$null | ConvertFrom-Json
if ($existingAci) {
    Write-Host "  Removing existing container..." -ForegroundColor Yellow
    az container delete --name $aciName --resource-group $ResourceGroupName --yes --output none
}

# Create new ACI
Write-Host "  Creating container instance..." -ForegroundColor Yellow
az container create `
    --resource-group $ResourceGroupName `
    --name $aciName `
    --image $imageName `
    --cpu 1 `
    --memory 1.5 `
    --os-type Linux `
    --registry-login-server $acrLoginServer `
    --registry-username $acrUsername `
    --registry-password $acrPassword `
    --ports 3000 `
    --dns-name-label "careercraft-pdf-renderer-$([datetime]::Now.ToString('MMddHHmm'))" `
    --restart-policy OnFailure `
    --output none

Write-Host "  [OK] Container instance created" -ForegroundColor Green

# Get the public IP/FQDN
Write-Host ""
Write-Host "[STEP 5] Getting endpoint information..." -ForegroundColor Cyan
$aciInfo = az container show --name $aciName --resource-group $ResourceGroupName --output json | ConvertFrom-Json
$fqdn = $aciInfo.ipAddress.fqdn
$ip = $aciInfo.ipAddress.ip
$pdfRendererEndpoint = "http://${fqdn}:3000"

Write-Host "  FQDN: $fqdn" -ForegroundColor Green
Write-Host "  IP: $ip" -ForegroundColor Green
Write-Host "  Endpoint: $pdfRendererEndpoint" -ForegroundColor Green

# Test the endpoint
Write-Host ""
Write-Host "[STEP 6] Testing endpoint..." -ForegroundColor Cyan
Start-Sleep -Seconds 10  # Wait for container to start

try {
    $healthResponse = Invoke-RestMethod -Uri "$pdfRendererEndpoint/health" -Method Get -TimeoutSec 30
    Write-Host "  [OK] Service is healthy: $($healthResponse.status)" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] Service may still be starting. Check manually in a minute." -ForegroundColor Yellow
}

# Configure Azure Function to use this endpoint
Write-Host ""
Write-Host "[STEP 7] Configuring Azure Function..." -ForegroundColor Cyan
$functionAppName = "careercraft-functions-dev"
try {
    az functionapp config appsettings set `
        --name $functionAppName `
        --resource-group $ResourceGroupName `
        --settings "PDF_RENDERER_ENDPOINT=$pdfRendererEndpoint" | Out-Null
    Write-Host "  [OK] Azure Function configured to use PDF renderer" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] Could not configure function app. Set PDF_RENDERER_ENDPOINT manually." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "PDF Renderer Endpoint: $pdfRendererEndpoint" -ForegroundColor Green
Write-Host ""
Write-Host "Usage:" -ForegroundColor Cyan
Write-Host "  POST $pdfRendererEndpoint/render" -ForegroundColor White
Write-Host "  Body: { `"pdfUrl`": `"https://...`", `"pageNumber`": 1 }" -ForegroundColor Gray
Write-Host "  Response: { `"success`": true, `"image`": `"base64...`" }" -ForegroundColor Gray
Write-Host ""
Write-Host "Cost: ~`$0.10-0.30/hour while running" -ForegroundColor Yellow
Write-Host "  Uses your Azure credits!" -ForegroundColor Green
Write-Host ""
Write-Host "To stop (save costs):" -ForegroundColor Cyan
Write-Host "  az container stop --name $aciName --resource-group $ResourceGroupName" -ForegroundColor Gray
Write-Host ""
Write-Host "To start again:" -ForegroundColor Cyan
Write-Host "  az container start --name $aciName --resource-group $ResourceGroupName" -ForegroundColor Gray
