# Get All Azure Secrets for Supabase Edge Functions and Azure Functions
# This script fetches all Azure API keys and automatically pushes them to:
# 1. Supabase Edge Functions (secrets)
# 2. Azure Function App (environment variables)

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroupName = "rg-careercraft-dev",
    
    [Parameter(Mandatory=$false)]
    [string]$SupabaseProjectRef = "hfchxjytxhsiuwqaugmv",
    
    [Parameter(Mandatory=$false)]
    [string]$FunctionAppName = "careercraft-functions-dev"
)

Write-Host "Fetching Azure Secrets for Configuration" -ForegroundColor Cyan
Write-Host "Resource Group: $ResourceGroupName" -ForegroundColor Yellow
Write-Host "Supabase Project: $SupabaseProjectRef" -ForegroundColor Yellow
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

# Get service names
$searchServiceName = "careercraft-search-dev"
$openAIName = "careercraft-openai-dev"
$docIntelName = "careercraft-docintel-dev"

$secrets = @{}
$errors = @()

Write-Host "Fetching Azure AI Search key..." -ForegroundColor Cyan
try {
    $searchKey = az search admin-key show `
        --resource-group $ResourceGroupName `
        --service-name $searchServiceName `
        --query primaryKey -o tsv 2>$null
    
    if ($searchKey) {
        $secrets['AZURE_SEARCH_KEY'] = $searchKey
        $secrets['AZURE_SEARCH_ENDPOINT'] = "https://$searchServiceName.search.windows.net"
        $secrets['AZURE_SEARCH_INDEX'] = "sa-gov-documents"
        Write-Host "AI Search key retrieved" -ForegroundColor Green
    } else {
        $errors += "AI Search key not found"
    }
} catch {
    $errors += "Failed to get AI Search key: $_"
}

Write-Host "Fetching Azure OpenAI key..." -ForegroundColor Cyan
try {
    $openAIKey = az cognitiveservices account keys list `
        --name $openAIName `
        --resource-group $ResourceGroupName `
        --query key1 -o tsv 2>$null
    
    if ($openAIKey) {
        $secrets['AZURE_OPENAI_KEY'] = $openAIKey
        $secrets['AZURE_OPENAI_ENDPOINT'] = "https://$openAIName.openai.azure.com/"
        $secrets['AZURE_OPENAI_EMBEDDING_DEPLOYMENT'] = "text-embedding-3-large"
        $secrets['AZURE_OPENAI_CHAT_DEPLOYMENT'] = "gpt-4o-mini"
        Write-Host "OpenAI key retrieved" -ForegroundColor Green
    } else {
        $errors += "OpenAI key not found (service may not exist if OpenAI was disabled)"
    }
} catch {
    $errors += "Failed to get OpenAI key: $_"
}

Write-Host "Fetching Azure Document Intelligence key..." -ForegroundColor Cyan
try {
    $docIntelKey = az cognitiveservices account keys list `
        --name $docIntelName `
        --resource-group $ResourceGroupName `
        --query key1 -o tsv 2>$null
    
    if ($docIntelKey) {
        $secrets['AZURE_DOCUMENT_INTELLIGENCE_KEY'] = $docIntelKey
        $secrets['AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT'] = "https://$docIntelName.cognitiveservices.azure.com/"
        Write-Host "Document Intelligence key retrieved" -ForegroundColor Green
    } else {
        $errors += "Document Intelligence key not found"
    }
} catch {
    $errors += "Failed to get Document Intelligence key: $_"
}

Write-Host ""
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host "SECRETS RETRIEVED" -ForegroundColor Yellow
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host ""

# Display all secrets (without values for security)
foreach ($key in $secrets.Keys | Sort-Object) {
    Write-Host "$key=[REDACTED]" -ForegroundColor White
}

Write-Host ""
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host ""

if ($errors.Count -gt 0) {
    Write-Host "Warnings:" -ForegroundColor Yellow
    foreach ($error in $errors) {
        Write-Host "  - $error" -ForegroundColor Yellow
    }
    Write-Host ""
}

# Push secrets to Azure Function App
Write-Host "Setting environment variables on Azure Function App..." -ForegroundColor Cyan
Write-Host "Function App: $FunctionAppName" -ForegroundColor Yellow
Write-Host ""

$functionAppSecrets = @{}
$functionAppSuccessCount = 0
$functionAppFailCount = 0

# Map secrets to Function App environment variables
# Only set the ones needed for Azure Functions
if ($secrets.ContainsKey('AZURE_SEARCH_ENDPOINT')) {
    $functionAppSecrets['AZURE_SEARCH_ENDPOINT'] = $secrets['AZURE_SEARCH_ENDPOINT']
}
if ($secrets.ContainsKey('AZURE_SEARCH_KEY')) {
    $functionAppSecrets['AZURE_SEARCH_KEY'] = $secrets['AZURE_SEARCH_KEY']
}
if ($secrets.ContainsKey('AZURE_SEARCH_INDEX')) {
    $functionAppSecrets['AZURE_SEARCH_INDEX'] = $secrets['AZURE_SEARCH_INDEX']
}
# Optional: OpenAI if available
if ($secrets.ContainsKey('AZURE_OPENAI_ENDPOINT')) {
    $functionAppSecrets['AZURE_OPENAI_ENDPOINT'] = $secrets['AZURE_OPENAI_ENDPOINT']
}
if ($secrets.ContainsKey('AZURE_OPENAI_KEY')) {
    $functionAppSecrets['AZURE_OPENAI_KEY'] = $secrets['AZURE_OPENAI_KEY']
}

if ($functionAppSecrets.Count -gt 0) {
    # Check if Function App exists
    $functionApp = az functionapp show --name $FunctionAppName --resource-group $ResourceGroupName 2>$null | ConvertFrom-Json
    
    if ($functionApp) {
        # Build settings array for az functionapp config appsettings set
        $settingsArray = @()
        foreach ($key in $functionAppSecrets.Keys) {
            $value = $functionAppSecrets[$key]
            $settingsArray += "$key=$value"
        }
        
        Write-Host "Updating Function App environment variables..." -ForegroundColor Cyan
        foreach ($setting in $settingsArray) {
            Write-Host "  Setting $($setting.Split('=')[0])..." -ForegroundColor Gray
        }
        
        $functionAppResult = az functionapp config appsettings set `
            --name $FunctionAppName `
            --resource-group $ResourceGroupName `
            --settings $settingsArray 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Function App environment variables updated successfully!" -ForegroundColor Green
            $functionAppSuccessCount = $functionAppSecrets.Count
        } else {
            Write-Host "Failed to update Function App environment variables" -ForegroundColor Red
            Write-Host "Error: $functionAppResult" -ForegroundColor Red
            $functionAppFailCount = $functionAppSecrets.Count
        }
    } else {
        Write-Host "Function App '$FunctionAppName' not found. Skipping Function App configuration." -ForegroundColor Yellow
        Write-Host "Deploy Function App first using: .\deploy-azure-functions.ps1" -ForegroundColor Yellow
    }
} else {
    Write-Host "No secrets available for Function App configuration." -ForegroundColor Yellow
}

Write-Host ""

# Push secrets to Supabase using npx
Write-Host "Pushing secrets to Supabase..." -ForegroundColor Cyan
Write-Host "Project: $SupabaseProjectRef" -ForegroundColor Yellow
Write-Host ""

$supabaseSuccessCount = 0
$supabaseFailCount = 0

foreach ($key in $secrets.Keys | Sort-Object) {
    Write-Host "Setting $key..." -ForegroundColor Gray
    $value = $secrets[$key]
    
    # Use npx supabase secrets set
    $result = npx --yes supabase secrets set "$key=$value" --project-ref $SupabaseProjectRef 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  $key set successfully" -ForegroundColor Green
        $supabaseSuccessCount++
    } else {
        Write-Host "  Failed to set $key" -ForegroundColor Red
        Write-Host "  Error: $result" -ForegroundColor Red
        $supabaseFailCount++
    }
}

# Write to local .env file
Write-Host ""
Write-Host "Writing to local .env file..." -ForegroundColor Cyan
$envPath = Join-Path (Split-Path $PSScriptRoot -Parent) ".env"
$envUpdated = $false
$envCreated = $false

try {
    $envContent = @"
# Azure Functions Configuration
# Auto-generated by get-azure-secrets.ps1
# DO NOT COMMIT THIS FILE TO GIT!

VITE_AZURE_FUNCTIONS_URL=https://$FunctionAppName.azurewebsites.net
VITE_AZURE_FUNCTIONS_KEY=

"@

    # Add Azure Search config (needed for reference, but Function App uses env vars)
    if ($secrets.ContainsKey('AZURE_SEARCH_ENDPOINT')) {
        $envContent += "# Azure Search (used by Azure Functions via environment variables)`n"
        $envContent += "# AZURE_SEARCH_ENDPOINT=$($secrets['AZURE_SEARCH_ENDPOINT'])`n"
        $envContent += "# AZURE_SEARCH_KEY=[REDACTED]`n"
        $envContent += "# AZURE_SEARCH_INDEX=$($secrets['AZURE_SEARCH_INDEX'])`n"
        $envContent += "`n"
    }

    if (Test-Path $envPath) {
        # Update existing .env file
        $existingContent = Get-Content $envPath -Raw
        
        # Update or add VITE_AZURE_FUNCTIONS_URL
        if ($existingContent -match "VITE_AZURE_FUNCTIONS_URL=") {
            $existingContent = $existingContent -replace "VITE_AZURE_FUNCTIONS_URL=.*", "VITE_AZURE_FUNCTIONS_URL=https://$FunctionAppName.azurewebsites.net"
        } else {
            $existingContent += "`nVITE_AZURE_FUNCTIONS_URL=https://$FunctionAppName.azurewebsites.net`n"
        }
        
        # Keep existing VITE_AZURE_FUNCTIONS_KEY if present
        if (-not ($existingContent -match "VITE_AZURE_FUNCTIONS_KEY=")) {
            $existingContent += "VITE_AZURE_FUNCTIONS_KEY=`n"
        }
        
        Set-Content -Path $envPath -Value $existingContent -NoNewline
        $envUpdated = $true
        Write-Host ".env file updated!" -ForegroundColor Green
    } else {
        # Create new .env file
        Set-Content -Path $envPath -Value $envContent -NoNewline
        $envCreated = $true
        Write-Host ".env file created!" -ForegroundColor Green
    }
} catch {
    Write-Host "Failed to write .env file: $_" -ForegroundColor Red
    Write-Host "You can manually create .env file with:" -ForegroundColor Yellow
    Write-Host "  VITE_AZURE_FUNCTIONS_URL=https://$FunctionAppName.azurewebsites.net" -ForegroundColor Gray
    Write-Host "  VITE_AZURE_FUNCTIONS_KEY=" -ForegroundColor Gray
}

Write-Host ""
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Yellow
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host "Azure Function App:" -ForegroundColor Cyan
Write-Host "  Successfully set: $functionAppSuccessCount environment variables" -ForegroundColor Green
if ($functionAppFailCount -gt 0) {
    Write-Host "  Failed to set: $functionAppFailCount environment variables" -ForegroundColor Red
}
Write-Host "Supabase:" -ForegroundColor Cyan
Write-Host "  Successfully set: $supabaseSuccessCount secrets" -ForegroundColor Green
if ($supabaseFailCount -gt 0) {
    Write-Host "  Failed to set: $supabaseFailCount secrets" -ForegroundColor Red
}
Write-Host "Local .env file:" -ForegroundColor Cyan
if ($envCreated) {
    Write-Host "  Created successfully" -ForegroundColor Green
} elseif ($envUpdated) {
    Write-Host "  Updated successfully" -ForegroundColor Green
} else {
    Write-Host "  Not updated (see errors above)" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "SECURITY REMINDER:" -ForegroundColor Red
Write-Host "  - Never commit .env file to Git!" -ForegroundColor Yellow
Write-Host "  - Keep secrets secure and rotate regularly" -ForegroundColor Yellow
Write-Host "  - Secrets are stored in:" -ForegroundColor Yellow
Write-Host "    * Supabase Edge Function secrets" -ForegroundColor Gray
Write-Host "    * Azure Function App environment variables" -ForegroundColor Gray
Write-Host "    * Local .env file (for frontend)" -ForegroundColor Gray
Write-Host ""

