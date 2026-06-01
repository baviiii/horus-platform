# Temporarily Scale Up Azure OpenAI for One-Time PDF Processing
# This increases deployment capacity to get higher rate limits
# After processing, scale back down to save costs

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [int]$HighCapacity = 480,  # High capacity for fast processing (480 = ~4x rate limit)
    
    [Parameter(Mandatory=$false)]
    [int]$LowCapacity = 120,   # Low capacity for normal operation (cost-effective)
    
    [Parameter(Mandatory=$false)]
    [int]$CustomCapacity = 0,  # Set custom capacity (e.g., 1000 for 1M tokens/min)
    
    [Parameter(Mandatory=$false)]
    [switch]$ScaleDown,  # Use this flag to scale back down after processing
    
    [Parameter(Mandatory=$false)]
    [switch]$RunProcessing  # Automatically run PDF processing after scaling up
)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  AZURE OPENAI CAPACITY SCALING" -ForegroundColor Cyan
Write-Host "  Temporary Upgrade for One-Time Processing" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Get OpenAI account
# Note: Foundry accounts use "AIServices" kind, not "OpenAI"
$openAIAccount = az cognitiveservices account list `
    --resource-group $ResourceGroupName `
    --query "[?kind=='OpenAI' || kind=='AIServices'].{name:name, location:location}" `
    --output json | ConvertFrom-Json

if (-not $openAIAccount -or $openAIAccount.Count -eq 0) {
    Write-Host " No OpenAI account found in resource group $ResourceGroupName" -ForegroundColor Red
    exit 1
}

$accountName = $openAIAccount[0].name
$location = $openAIAccount[0].location

Write-Host "OpenAI Account: $accountName" -ForegroundColor Green
Write-Host "Location: $location" -ForegroundColor Green
Write-Host ""

# Get endpoint and key
$endpoint = (az cognitiveservices account show `
    --resource-group $ResourceGroupName `
    --name $accountName `
    --query "properties.endpoint" `
    --output tsv)

$key = (az cognitiveservices account keys list `
    --resource-group $ResourceGroupName `
    --name $accountName `
    --query "key1" `
    --output tsv)

$deploymentName = "text-embedding-3-large"

# Check current deployment
Write-Host "Checking current deployment capacity..." -ForegroundColor Cyan
$headers = @{
    "Content-Type" = "application/json"
    "api-key" = $key
}

$getUrl = "$endpoint/openai/deployments/$deploymentName?api-version=2024-02-15-preview"

try {
    $currentDeployment = Invoke-RestMethod -Uri $getUrl -Method Get -Headers $headers -ErrorAction Stop
    $currentCapacity = $currentDeployment.sku.capacity
    Write-Host "Current capacity: $currentCapacity" -ForegroundColor Yellow
} catch {
    $errorDetails = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
    $statusCode = $null
    try {
        if ($_.Exception.Response) {
            $statusCode = $_.Exception.Response.StatusCode.value__
        }
    } catch {}
    
    if ($statusCode -eq 404) {
        Write-Host "❌ Deployment '$deploymentName' not found!" -ForegroundColor Red
        Write-Host ""
        Write-Host "The embedding model needs to be deployed first." -ForegroundColor Yellow
        Write-Host "Run this command to deploy it:" -ForegroundColor Yellow
        Write-Host "  .\deploy-openai-model.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
        Write-Host ""
        Write-Host "After deployment completes (takes 1-2 minutes), run this scaling script again." -ForegroundColor Gray
    } elseif ($errorDetails -and $errorDetails.error) {
        Write-Host "❌ Error getting deployment: $($errorDetails.error.message)" -ForegroundColor Red
        Write-Host ""
        Write-Host "Try deploying the model first:" -ForegroundColor Yellow
        Write-Host "  .\deploy-openai-model.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
    } else {
        Write-Host "❌ Could not get current deployment: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
        Write-Host "Possible issues:" -ForegroundColor Yellow
        Write-Host "  1. Deployment doesn't exist - run: .\deploy-openai-model.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor Gray
        Write-Host "  2. API key might be invalid" -ForegroundColor Gray
        Write-Host "  3. Check Azure Portal > OpenAI > Deployments" -ForegroundColor Gray
    }
    exit 1
}

# Determine target capacity
if ($ScaleDown) {
    $targetCapacity = $LowCapacity
    Write-Host "" 
    Write-Host " SCALING DOWN to save costs..." -ForegroundColor Yellow
    Write-Host "Target capacity: $targetCapacity (from $currentCapacity)" -ForegroundColor Yellow
} elseif ($CustomCapacity -gt 0) {
    $targetCapacity = $CustomCapacity
    Write-Host ""
    Write-Host " USING CUSTOM CAPACITY..." -ForegroundColor Cyan
    Write-Host "Target capacity: $targetCapacity (from $currentCapacity)" -ForegroundColor Cyan
    Write-Host "Token limit: $($targetCapacity * 1000)K tokens/minute" -ForegroundColor Green
} else {
    $targetCapacity = $HighCapacity
    Write-Host ""
    Write-Host " SCALING UP for faster processing..." -ForegroundColor Green
    Write-Host "Target capacity: $targetCapacity (from $currentCapacity)" -ForegroundColor Green
    Write-Host ""
    Write-Host " Cost Impact:" -ForegroundColor Cyan
    Write-Host "  - Current: ~$$([math]::Round($currentCapacity * 0.0008, 2))/hour" -ForegroundColor Gray
    Write-Host "  - Upgraded: ~$$([math]::Round($targetCapacity * 0.0008, 2))/hour" -ForegroundColor Gray
    Write-Host "  - For 56 PDFs (~2000 chunks): ~30-60 minutes processing" -ForegroundColor Gray
    Write-Host "  - Estimated extra cost: ~$$([math]::Round(($targetCapacity - $currentCapacity) * 0.0008 * 1, 2))" -ForegroundColor Gray
    Write-Host ""
    Write-Host " After processing, run this script again with -ScaleDown flag" -ForegroundColor Yellow
}

if ($currentCapacity -eq $targetCapacity) {
    Write-Host ""
    Write-Host " Already at target capacity ($targetCapacity)" -ForegroundColor Green
    if (-not $ScaleDown -and $RunProcessing) {
        Write-Host ""
        Write-Host "Running PDF processing..." -ForegroundColor Cyan
        & "$PSScriptRoot\process-pdfs.ps1" -ResourceGroupName $ResourceGroupName -GenerateEmbeddings
    }
    exit 0
}

# Scale deployment
Write-Host ""
Write-Host "Scaling deployment..." -ForegroundColor Cyan

$scaleBody = @{
    sku = @{
        name = "Standard"
        capacity = $targetCapacity
    }
} | ConvertTo-Json

$scaleUrl = "$endpoint/openai/deployments/$deploymentName?api-version=2024-02-15-preview"

try {
    Write-Host "Updating capacity (this may take 1-2 minutes)..." -ForegroundColor Yellow
    $response = Invoke-RestMethod -Uri $scaleUrl -Method PATCH -Headers $headers -Body $scaleBody
    
    Write-Host ""
    Write-Host " Capacity updated successfully!" -ForegroundColor Green
    Write-Host "New capacity: $targetCapacity" -ForegroundColor Green
    Write-Host ""
    
    if (-not $ScaleDown) {
        Write-Host " Rate Limit Improvement:" -ForegroundColor Cyan
        $rateLimitIncrease = [math]::Round($targetCapacity / $currentCapacity, 1)
        Write-Host "  - Rate limits increased by ~${rateLimitIncrease}x" -ForegroundColor Green
        Write-Host "  - You can now process PDFs much faster!" -ForegroundColor Green
        Write-Host ""
        
        if ($RunProcessing) {
            Write-Host "Running PDF processing with higher rate limits..." -ForegroundColor Cyan
            Write-Host ""
            & "$PSScriptRoot\process-pdfs.ps1" -ResourceGroupName $ResourceGroupName -GenerateEmbeddings
        } else {
            Write-Host " Ready to process PDFs!" -ForegroundColor Green
            Write-Host "Run: .\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName -GenerateEmbeddings" -ForegroundColor White
            Write-Host ""
            Write-Host "After processing, scale back down:" -ForegroundColor Yellow
            Write-Host "  .\scale-openai-for-processing.ps1 -ResourceGroupName $ResourceGroupName -ScaleDown" -ForegroundColor White
        }
    } else {
        Write-Host " Scaled down to save costs!" -ForegroundColor Green
        Write-Host "You're now back to normal operation mode." -ForegroundColor Green
    }
}
catch {
    $errorDetails = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
    Write-Host " Scaling failed!" -ForegroundColor Red
    
    if ($errorDetails.error) {
        Write-Host "Error: $($errorDetails.error.message)" -ForegroundColor Red
    } else {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "Common issues:" -ForegroundColor Yellow
    Write-Host "1. Capacity may be limited by your subscription quota" -ForegroundColor Yellow
    Write-Host "2. Try a lower capacity (e.g., 240 instead of 480)" -ForegroundColor Yellow
    Write-Host "3. Check Azure Portal > OpenAI > Quotas" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

