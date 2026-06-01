<#
.SYNOPSIS
    Sets up Azure Automation for automatic PDF processing
    
.DESCRIPTION
    Creates:
    - Azure Automation Account
    - Runbook for PDF processing
    - Event Grid subscription to trigger on blob upload
    - Required modules and credentials
    
.PARAMETER ResourceGroupName
    The Azure resource group name
    
.EXAMPLE
    .\setup-azure-automation.ps1 -ResourceGroupName "rg-careercraft-dev"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "australiaeast",
    
    [Parameter(Mandatory=$false)]
    [string]$AutomationAccountName = "careercraft-automation",
    
    [Parameter(Mandatory=$false)]
    [string]$RunbookName = "Process-SinglePDF"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Azure Automation Setup for PDF Processing" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check Azure CLI login
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "Please login to Azure first: az login" -ForegroundColor Red
    exit 1
}
Write-Host "Logged in as: $($account.user.name)" -ForegroundColor Green

# Step 1: Create Automation Account (with timeout and better error handling)
Write-Host "`n[1/5] Creating Automation Account..." -ForegroundColor Yellow

# Register Automation provider first (required for creation)
Write-Host "  Registering Microsoft.Automation provider..." -ForegroundColor Gray
$providerState = az provider show --namespace Microsoft.Automation --query "registrationState" -o tsv 2>$null
if ($providerState -ne "Registered") {
    Write-Host "  Provider not registered. Registering now (this may take 2-5 minutes)..." -ForegroundColor Yellow
    Write-Host "  (This step may appear to hang - it's waiting for Azure to register the provider)" -ForegroundColor Gray
    az provider register --namespace Microsoft.Automation --wait 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: Failed to register Microsoft.Automation provider" -ForegroundColor Red
        Write-Host "  Try manually: az provider register --namespace Microsoft.Automation --wait" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "   Provider registered successfully" -ForegroundColor Green
} else {
    Write-Host "   Provider already registered" -ForegroundColor Green
}

Write-Host "  Checking if Automation Account exists..." -ForegroundColor Gray

# Check if it already exists
$automationExistsJson = az automation account show `
    --name $AutomationAccountName `
    --resource-group $ResourceGroupName `
    --output json 2>&1
$automationExists = $null
if ($LASTEXITCODE -eq 0 -and $automationExistsJson -match '^{') {
    $automationExists = $automationExistsJson | ConvertFrom-Json -ErrorAction SilentlyContinue
}

$needsCreation = $false
$needsPolling = $false

if ($automationExists -and $automationExists.properties.provisioningState -eq "Succeeded") {
    Write-Host "   Already exists: $AutomationAccountName" -ForegroundColor Green   
    $needsPolling = $false
} elseif ($automationExists) {
    $existingState = $automationExists.properties.provisioningState
    Write-Host "  Found existing account with state: $existingState" -ForegroundColor Yellow
    
    if ($existingState -eq "Failed") {
        Write-Host "  Account creation previously failed. Attempting to delete and recreate..." -ForegroundColor Yellow
        az automation account delete --name $AutomationAccountName --resource-group $ResourceGroupName --yes 2>$null | Out-Null
        Start-Sleep -Seconds 10
        $needsCreation = $true
        $needsPolling = $true
    } elseif ($existingState -eq "Creating") {
        Write-Host "  Account is still being created. Will monitor progress..." -ForegroundColor Yellow
        $needsPolling = $true
        $needsCreation = $false
    } else {
        $needsCreation = $true
        $needsPolling = $true
    }
} else {
    $needsCreation = $true
    $needsPolling = $true
}

if ($needsCreation) {
    Write-Host "  Creating Automation Account (this may take 5-15 minutes)..." -ForegroundColor Gray
    Write-Host "  Location: $Location" -ForegroundColor Gray
    Write-Host "  Resource Group: $ResourceGroupName" -ForegroundColor Gray
    
    # Install automation extension if needed (non-interactive)
    Write-Host "  Checking for automation extension..." -ForegroundColor Gray
    $extList = az extension list --output json 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
    $hasAutomationExt = $extList | Where-Object { $_.name -eq 'automation' }
    if (-not $hasAutomationExt) {
        Write-Host "  Installing automation extension (required)..." -ForegroundColor Gray
        az extension add --name automation --yes 2>$null | Out-Null
        Start-Sleep -Seconds 2
    }
    
    # Create Automation Account (this will wait for completion)
    Write-Host "  Creating Automation Account in Azure..." -ForegroundColor Gray
    Write-Host "  (This may take 5-15 minutes - please wait)" -ForegroundColor Gray
    $createResult = az automation account create `
        --name $AutomationAccountName `
        --resource-group $ResourceGroupName `
        --location $Location `
        --sku Basic 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        $errorMsg = $createResult | Out-String
        Write-Host "   ERROR: Failed to create Automation Account" -ForegroundColor Red
        Write-Host "  Error details: $errorMsg" -ForegroundColor Red
        Write-Host ""
        Write-Host "  Common fixes:" -ForegroundColor Yellow
        Write-Host "    1. Check resource group exists: az group show --name $ResourceGroupName" -ForegroundColor Gray
        Write-Host "    2. Check permissions: You need Contributor role on resource group" -ForegroundColor Gray
        Write-Host "    3. Check if name already exists: az automation account list --query `"[?name=='$AutomationAccountName']`"" -ForegroundColor Gray
        Write-Host "    4. Try a different name: -AutomationAccountName `"careercraft-automation-$(Get-Random -Maximum 1000)`"" -ForegroundColor Gray
        exit 1
    }
    Write-Host "   Automation Account created successfully!" -ForegroundColor Green
    $needsPolling = $false
}

if ($needsPolling) {
    Write-Host ""
    Write-Host "   Waiting for Automation Account to be created..." -ForegroundColor Cyan
    Write-Host "  (This typically takes 5-15 minutes)" -ForegroundColor Gray
    Write-Host "  Progress updates every 30 seconds..." -ForegroundColor Gray
    Write-Host ""
    
    # Poll for completion (max 20 minutes)
    $maxWait = 1200  # 20 minutes
    $waited = 0
    $interval = 30  # Check every 30 seconds
    $lastStatus = ""
    
    do {
        Start-Sleep -Seconds $interval
        $waited += $interval
        
        Write-Host "  [Checking status...]" -ForegroundColor DarkGray
        $accountInfo = az automation account show `
            --name $AutomationAccountName `
            --resource-group $ResourceGroupName `
            --output json 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
        
        if ($accountInfo) {
            $accountStatus = $accountInfo.properties.provisioningState
        } else {
            $accountStatus = $null
        }
        
        if ($accountStatus -eq "Succeeded") {
            Write-Host ""
            Write-Host "   Automation Account created successfully!" -ForegroundColor Green
            Write-Host "  Name: $AutomationAccountName" -ForegroundColor Green
            break
        } elseif ($accountStatus -eq "Failed") {
            Write-Host ""
            Write-Host "  Creation failed! Check Azure Portal for details." -ForegroundColor Red
            Write-Host "  Check status: az automation account show --name $AutomationAccountName --resource-group $ResourceGroupName" -ForegroundColor Gray
            exit 1
        } elseif ($accountStatus) {
            if ($accountStatus -ne $lastStatus) {
                $minutes = [math]::Floor($waited / 60)
                $seconds = $waited % 60
                $timeStr = $minutes.ToString() + 'm ' + $seconds.ToString() + 's'
                $msg = '  Status: ' + $accountStatus + ' (' + $timeStr + ' elapsed)'
                Write-Host $msg -ForegroundColor Yellow
                $lastStatus = $accountStatus
            } else {
                $minutes = [math]::Floor($waited / 60)
                $seconds = $waited % 60
                $timeStr = $minutes.ToString() + 'm ' + $seconds.ToString() + 's'
                $msg = '  Still ' + $accountStatus + '... (' + $timeStr + ')'
                Write-Host $msg -ForegroundColor DarkGray
            }
        } else {
            # Account might not be visible yet, keep waiting
            $minutes = [math]::Floor($waited / 60)
            $seconds = $waited % 60
            $timeStr = $minutes.ToString() + 'm ' + $seconds.ToString() + 's'
            $msg = '  Account not visible yet... (' + $timeStr + ')'
            Write-Host $msg -ForegroundColor DarkGray
        }
    } while ($waited -lt $maxWait)
    
    if ($waited -ge $maxWait) {
        Write-Host ""
        Write-Host "  WARNING: Timeout reached after 20 minutes." -ForegroundColor Yellow
        Write-Host "  Account may still be creating. Check status:" -ForegroundColor Yellow
        Write-Host "    az automation account show --name $AutomationAccountName --resource-group $ResourceGroupName" -ForegroundColor Gray
        Write-Host "  Or check Azure Portal: https://portal.azure.com" -ForegroundColor Gray
        Write-Host ""
        $continue = Read-Host "Continue anyway? (y/n)"
        if ($continue -ne "y" -and $continue -ne "Y") {
            exit 1
        }
    }
}

# Step 2: Import required modules
Write-Host "`n[2/5] Importing PowerShell modules..." -ForegroundColor Yellow
$modules = @("Az.Storage", "Az.Search")
foreach ($module in $modules) {
    Write-Host "  Importing $module..." -ForegroundColor Gray
    az automation module create `
        --automation-account-name $AutomationAccountName `
        --resource-group $ResourceGroupName `
        --name $module `
        --content-link "https://www.powershellgallery.com/api/v2/package/$module" 2>$null
}
Write-Host "  Modules imported (may take a few minutes to be available)" -ForegroundColor Green

# Step 3: Get resource connection details
Write-Host "`n[3/5] Gathering resource details..." -ForegroundColor Yellow

# Get storage account
$storageAccounts = az storage account list --resource-group $ResourceGroupName | ConvertFrom-Json
$storageAccount = $storageAccounts | Where-Object { $_.name -like "*careercraft*" -or $_.name -like "*career*" } | Select-Object -First 1
if (-not $storageAccount) {
    $storageAccount = $storageAccounts | Select-Object -First 1
}
$storageName = $storageAccount.name
$storageKey = (az storage account keys list --account-name $storageName --resource-group $ResourceGroupName | ConvertFrom-Json)[0].value
Write-Host "  Storage: $storageName" -ForegroundColor Green

# Get Cognitive Services (Document Intelligence)
$cogServices = az cognitiveservices account list --resource-group $ResourceGroupName | ConvertFrom-Json
$docIntel = $cogServices | Where-Object { $_.kind -eq "FormRecognizer" } | Select-Object -First 1
if ($docIntel) {
    $docIntelEndpoint = $docIntel.properties.endpoint
    $docIntelKey = (az cognitiveservices account keys list --name $docIntel.name --resource-group $ResourceGroupName | ConvertFrom-Json).key1
    Write-Host "  Document Intelligence: $($docIntel.name)" -ForegroundColor Green
}

# Get Search Service
$searchServices = az search service list --resource-group $ResourceGroupName | ConvertFrom-Json
$searchService = $searchServices | Select-Object -First 1
if ($searchService) {
    $searchEndpoint = "https://$($searchService.name).search.windows.net"
    $searchKey = (az search admin-key show --service-name $searchService.name --resource-group $ResourceGroupName | ConvertFrom-Json).primaryKey
    Write-Host "  Search Service: $($searchService.name)" -ForegroundColor Green
}

# Get OpenAI
$openAI = $cogServices | Where-Object { $_.kind -eq "OpenAI" } | Select-Object -First 1
if ($openAI) {
    $openAIEndpoint = $openAI.properties.endpoint
    $openAIKey = (az cognitiveservices account keys list --name $openAI.name --resource-group $ResourceGroupName | ConvertFrom-Json).key1
    Write-Host "  OpenAI: $($openAI.name)" -ForegroundColor Green
}

# Step 4: Create Variables in Automation Account
Write-Host "`n[4/5] Creating Automation Variables..." -ForegroundColor Yellow

$variables = @{
    "StorageConnectionString" = "DefaultEndpointsProtocol=https;AccountName=$storageName;AccountKey=$storageKey;EndpointSuffix=core.windows.net"
    "StorageAccountName" = $storageName
    "StorageAccountKey" = $storageKey
    "ContainerName" = "rag-documents"
    "DocIntelEndpoint" = $docIntelEndpoint
    "DocIntelKey" = $docIntelKey
    "SearchEndpoint" = $searchEndpoint
    "SearchKey" = $searchKey
    "SearchIndexName" = "sa-gov-documents"
    "OpenAIEndpoint" = $openAIEndpoint
    "OpenAIKey" = $openAIKey
}

foreach ($var in $variables.GetEnumerator()) {
    $isEncrypted = $var.Key -like "*Key*" -or $var.Key -like "*Connection*"
    az automation variable create `
        --automation-account-name $AutomationAccountName `
        --resource-group $ResourceGroupName `
        --name $var.Key `
        --value "`"$($var.Value)`"" `
        --encrypted $isEncrypted 2>$null
    Write-Host "  Set: $($var.Key)" -ForegroundColor Gray
}
Write-Host "  Variables configured" -ForegroundColor Green

# Step 5: Create the Runbook
Write-Host "`n[5/5] Creating Runbook..." -ForegroundColor Yellow

$runbookPath = Join-Path $PSScriptRoot "process-single-pdf-runbook.ps1"
if (Test-Path $runbookPath) {
    az automation runbook create `
        --automation-account-name $AutomationAccountName `
        --resource-group $ResourceGroupName `
        --name $RunbookName `
        --type PowerShell `
        --description "Processes a single PDF when uploaded to blob storage"
    
    az automation runbook replace-content `
        --automation-account-name $AutomationAccountName `
        --resource-group $ResourceGroupName `
        --name $RunbookName `
        --content @$runbookPath
    
    az automation runbook publish `
        --automation-account-name $AutomationAccountName `
        --resource-group $ResourceGroupName `
        --name $RunbookName
    
    Write-Host "  Runbook created and published: $RunbookName" -ForegroundColor Green
} else {
    Write-Host "  Runbook script not found at: $runbookPath" -ForegroundColor Yellow
    Write-Host "  Please create it and upload manually" -ForegroundColor Yellow
}

# Step 6: Manual Setup Instructions
Write-Host "`n[6/6] Manual Setup Required" -ForegroundColor Yellow
Write-Host ""
Write-Host "To enable automatic PDF processing, create webhook and event subscription manually:" -ForegroundColor White
Write-Host ""
Write-Host "1. Create Webhook:" -ForegroundColor Cyan
Write-Host "   Portal > Automation Account ($AutomationAccountName) > Runbooks > Process-SinglePDF > Add webhook" -ForegroundColor Gray
Write-Host "   Name: pdf-upload-webhook, Enabled: Yes, Copy the Webhook URL" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Create Event Subscription:" -ForegroundColor Cyan
Write-Host "   Portal > Storage Account ($storageName) > Events > + Event Subscription" -ForegroundColor Gray
Write-Host "   Name: pdf-upload-trigger, Event: Blob Created" -ForegroundColor Gray
Write-Host "   Filters: Subject begins with /blobServices/default/containers/rag-documents/" -ForegroundColor Gray
Write-Host "   Filters: Subject ends with .pdf" -ForegroundColor Gray
Write-Host "   Endpoint: Web Hook (paste Webhook URL from step 1)" -ForegroundColor Gray
Write-Host ""
Write-Host "See infrastructure/docs/MANUAL-WEBHOOK-SETUP.md for detailed instructions." -ForegroundColor Gray

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To test the runbook manually:" -ForegroundColor Yellow
$paramValue = 'your-file.pdf'
$testCmd = '  az automation runbook start --name ' + $RunbookName + ' --automation-account-name ' + $AutomationAccountName + ' --resource-group ' + $ResourceGroupName + ' --parameters blobName=' + $paramValue
Write-Host $testCmd -ForegroundColor Gray
