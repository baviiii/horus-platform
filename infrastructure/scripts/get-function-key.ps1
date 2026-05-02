# Get Azure Function App Master Key
# This script retrieves the master key for the Function App

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroupName = "rg-careercraft-dev",
    
    [Parameter(Mandatory=$false)]
    [string]$FunctionAppName = "careercraft-functions-dev"
)

Write-Host "Retrieving Function App master key..." -ForegroundColor Cyan
Write-Host "Resource Group: $ResourceGroupName" -ForegroundColor Yellow
Write-Host "Function App: $FunctionAppName" -ForegroundColor Yellow
Write-Host ""

# Check if Azure CLI is installed
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "Azure CLI is not installed. Please install it first." -ForegroundColor Red
    exit 1
}

# Check if logged in
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "Not logged in to Azure. Logging in..." -ForegroundColor Yellow
    az login
    $account = az account show 2>$null | ConvertFrom-Json
    if (-not $account) {
        Write-Host "Failed to login to Azure" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Logged in as: $($account.user.name)" -ForegroundColor Green
Write-Host ""

# Get keys: try ARM listKeys first (bypasses broken host runtime when Portal shows "Error while loading host keys")
# Then fallback to az functionapp keys list (which can hit the same InternalServerError as Portal)
$key = $null
$subscriptionId = (az account show --query id -o tsv 2>$null)
$armUriBase = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.Web/sites/$FunctionAppName/host/default/listKeys"

Write-Host "Fetching Function App keys (ARM API)..." -ForegroundColor Cyan
try {
    $keysJson = $null
    foreach ($apiVersion in @("2023-12-01", "2018-11-01")) {
        $armUri = "${armUriBase}?api-version=$apiVersion"
        $keysJson = az rest --method post --uri $armUri 2>$null
        if ($keysJson -and $keysJson.Trim().Length -gt 10) { break }
    }
    if (-not $keysJson) {
        Write-Host "  ARM API failed, trying functionapp keys list..." -ForegroundColor Gray
        $keysJson = az functionapp keys list `
            --resource-group $ResourceGroupName `
            --name $FunctionAppName 2>$null
    }
    if ($keysJson) {
        $keys = $keysJson | ConvertFrom-Json
        if ($keys.masterKey -and $keys.masterKey.ToString().Trim().Length -gt 0) {
            $key = $keys.masterKey.ToString().Trim()
        }
        if (-not $key -and $keys.functionKeys) {
            if ($keys.functionKeys.PSObject.Properties['default']) {
                $key = $keys.functionKeys.default
            } else {
                $keys.functionKeys.PSObject.Properties | ForEach-Object { $key = $_.Value; break }
            }
        }
        if (-not $key -and $keys.systemKeys) {
            $keys.systemKeys.PSObject.Properties | ForEach-Object { $key = $_.Value; break }
        }
    }
    
    if ($key -and $key.Length -gt 10 -and $key -notmatch "ERROR") {
        Write-Host "Master Key retrieved successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host ("=" * 80) -ForegroundColor Cyan
        Write-Host "FUNCTION KEY" -ForegroundColor Yellow
        Write-Host ("=" * 80) -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Add this to your .env file (project root):" -ForegroundColor Cyan
        Write-Host "VITE_AZURE_FUNCTION_KEY=$key" -ForegroundColor White
        Write-Host "(Also used as VITE_AZURE_FUNCTIONS_KEY if your app references it)" -ForegroundColor Gray
        Write-Host ""
        
        # Try to update .env file automatically (project root: careercraft-pages/.env)
        $envPath = Join-Path (Split-Path $PSScriptRoot -Parent) ".env"
        if (-not (Test-Path $envPath)) {
            $envPath = Join-Path (Split-Path $PSScriptRoot -Parent -Parent) ".env"
        }
        if (Test-Path $envPath) {
            $envContent = Get-Content $envPath -Raw
            # Set the key the graph/agentic app uses (VITE_AZURE_FUNCTION_KEY)
            if ($envContent -match "VITE_AZURE_FUNCTION_KEY=") {
                $envContent = $envContent -replace "VITE_AZURE_FUNCTION_KEY=.*", "VITE_AZURE_FUNCTION_KEY=$key"
            } else {
                $envContent = $envContent.TrimEnd() + "`nVITE_AZURE_FUNCTION_KEY=$key`n"
            }
            if ($envContent -match "VITE_AZURE_FUNCTIONS_KEY=") {
                $envContent = $envContent -replace "VITE_AZURE_FUNCTIONS_KEY=.*", "VITE_AZURE_FUNCTIONS_KEY=$key"
            } else {
                $envContent = $envContent.TrimEnd() + "`nVITE_AZURE_FUNCTIONS_KEY=$key`n"
            }
            Set-Content -Path $envPath -Value $envContent.TrimEnd() -NoNewline
            Write-Host ".env file updated with VITE_AZURE_FUNCTION_KEY!" -ForegroundColor Green
        } else {
            Write-Host "Creating .env file..." -ForegroundColor Cyan
            $envContent = @"
# Azure Functions - required for graph, agentic RAG, scenario modeler
VITE_AZURE_FUNCTIONS_URL=https://$FunctionAppName.azurewebsites.net
VITE_AZURE_FUNCTION_KEY=$key
VITE_AZURE_FUNCTIONS_KEY=$key
"@
            Set-Content -Path $envPath -Value $envContent
            Write-Host ".env file created!" -ForegroundColor Green
        }
        Write-Host ""
        Write-Host "SECURITY REMINDER:" -ForegroundColor Red
        Write-Host "  - Never commit .env file to Git!" -ForegroundColor Yellow
        Write-Host "  - Keep the function key secure" -ForegroundColor Yellow
        Write-Host ""
    } else {
        Write-Host "Could not retrieve key from Azure CLI." -ForegroundColor Yellow
        if ($keysJson) {
            Write-Host "  (API returned data but no usable key; check RBAC or try Portal)" -ForegroundColor Gray
        } else {
            Write-Host "  (No data returned; ensure 'az functionapp keys list' is allowed for your user)" -ForegroundColor Gray
        }
        Write-Host ""
        Write-Host "Get the key manually:" -ForegroundColor Cyan
        Write-Host "  1. Azure Portal > Function App > $FunctionAppName > App keys (under Settings)" -ForegroundColor Gray
        Write-Host "  2. Copy the 'Host keys' > default (or _master) value" -ForegroundColor Gray
        Write-Host "  3. Add to project root .env:  VITE_AZURE_FUNCTION_KEY=<paste-key>" -ForegroundColor Gray
        Write-Host ""
    }
} catch {
    Write-Host "Error retrieving key: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Get it from Azure Portal:" -ForegroundColor Cyan
    Write-Host "  Function App > $FunctionAppName > App keys > Host keys > default" -ForegroundColor Gray
    Write-Host "  Then add to .env:  VITE_AZURE_FUNCTION_KEY=<key>" -ForegroundColor Gray
    Write-Host ""
}

