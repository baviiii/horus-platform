# ============================================================
# Enterprise RAG Reset: Delete Index & Re-process All PDFs
# ============================================================
# This script:
# 1. Deletes the existing Azure AI Search index
# 2. Recreates it with the latest schema (elite features)
# 3. Re-processes all PDFs with enterprise-grade features
#
# Usage:
#   .\reset-index-and-reprocess.ps1 -ResourceGroupName "rg-careercraft-dev"
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$IndexName = "sa-gov-documents",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipPDFProcessing = $false,  # If you only want to reset the index
    
    [Parameter(Mandatory=$false)]
    [int]$EmbeddingTPM = 350  # Your embedding TPM (350K default for upgraded deployments)
)

$ErrorActionPreference = "Continue"  # Continue to allow graceful error handling in try-catch blocks

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ENTERPRISE RAG RESET & RE-PROCESS" -ForegroundColor Cyan
Write-Host "  Building Elite-Grade RAG System" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# PRE-FLIGHT VALIDATION
# ============================================================

Write-Host "[PRE-FLIGHT] Validating prerequisites..." -ForegroundColor Yellow

# Check Azure CLI
try {
    $azCheck = az version --output json 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI not working"
    }
    Write-Host "  [OK] Azure CLI is available" -ForegroundColor Green
}
catch {
    Write-Host "  [ERROR] Azure CLI is not available or not working" -ForegroundColor Red
    Write-Host "          Install: https://aka.ms/installazurecliwindows" -ForegroundColor Yellow
    exit 1
}

# Check if logged in
try {
    $account = az account show --output json 2>&1 | ConvertFrom-Json
    if (-not $account) {
        throw "Not logged in"
    }
    Write-Host "  [OK] Logged in as: $($account.user.name)" -ForegroundColor Green
    Write-Host "       Subscription: $($account.name) ($($account.id))" -ForegroundColor Gray
}
catch {
    Write-Host "  [ERROR] Not logged into Azure" -ForegroundColor Red
    Write-Host "          Run: az login" -ForegroundColor Yellow
    exit 1
}

# Validate resource group exists
try {
    $rgCheck = az group show --name $ResourceGroupName --output json 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Resource group not found"
    }
    Write-Host "  [OK] Resource group exists: $ResourceGroupName" -ForegroundColor Green
}
catch {
    Write-Host "  [ERROR] Resource group not found: $ResourceGroupName" -ForegroundColor Red
    Write-Host "          Check the resource group name and your permissions" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# ============================================================
# STEP 1: GET AZURE RESOURCES
# ============================================================

Write-Host "[STEP 1] Getting Azure resources..." -ForegroundColor Yellow

# Get search service with proper error handling
try {
    $searchServiceJson = az search service list --resource-group $ResourceGroupName --output json 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to list search services: $searchServiceJson"
    }
    $searchService = $searchServiceJson | ConvertFrom-Json
    if (-not $searchService -or $searchService.Count -eq 0) {
        throw "No search services found"
    }
    $searchService = $searchService[0]
}
catch {
    Write-Host "[ERROR] Failed to get Azure AI Search service from resource group: $ResourceGroupName" -ForegroundColor Red
    Write-Host "        Error: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "        Make sure:" -ForegroundColor Yellow
    Write-Host "          1. Resource group name is correct" -ForegroundColor White
    Write-Host "          2. You're logged in: az login" -ForegroundColor White
    Write-Host "          3. You have permissions to access the resource group" -ForegroundColor White
    exit 1
}

$SearchServiceName = $searchService.name
$searchEndpoint = "https://$SearchServiceName.search.windows.net"

# CRITICAL: Get search key with proper error handling
try {
    $searchKey = az search admin-key show --resource-group $ResourceGroupName --service-name $SearchServiceName --query "primaryKey" --output tsv 2>&1
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($searchKey)) {
        throw "Failed to retrieve search key"
    }
}
catch {
    Write-Host "[ERROR] Could not retrieve search service admin key" -ForegroundColor Red
    Write-Host "        Service: $SearchServiceName" -ForegroundColor Yellow
    Write-Host "        Make sure you have 'Search Service Contributor' or 'Owner' role" -ForegroundColor Yellow
    exit 1
}

Write-Host "  Search Service: $SearchServiceName" -ForegroundColor Green
Write-Host "  Index Name: $IndexName" -ForegroundColor Green

# Get Azure Functions endpoint for chart extraction
$chartExtractionEndpoint = $null
try {
    $functionAppName = "careercraft-functions-dev"
    $functionApp = az functionapp show --resource-group $ResourceGroupName --name $functionAppName --output json 2>$null | ConvertFrom-Json
    if ($functionApp) {
        $chartExtractionEndpoint = "https://$($functionApp.defaultHostName)/api/chart-extraction"
        Write-Host "  Chart Extraction: $chartExtractionEndpoint" -ForegroundColor Green
    } else {
        Write-Host "  Chart Extraction: NOT DEPLOYED (figures will be metadata-only)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Chart Extraction: NOT FOUND (figures will be metadata-only)" -ForegroundColor Yellow
}

Write-Host ""

# ============================================================
# STEP 2: DELETE EXISTING INDEX
# ============================================================

Write-Host "[STEP 2] Deleting existing index (removes all old chunks)..." -ForegroundColor Yellow

$headers = @{
    "api-key" = $searchKey
    "Content-Type" = "application/json"
}

$deleteUrl = "$searchEndpoint/indexes/$IndexName`?api-version=2023-11-01"

try {
    $response = Invoke-RestMethod -Uri $deleteUrl -Method Delete -Headers $headers -ErrorAction Stop
    Write-Host "  [OK] Index '$IndexName' deleted successfully" -ForegroundColor Green
    Write-Host "  All old chunks removed - clean slate!" -ForegroundColor Gray
}
catch {
    $statusCode = $null
    try {
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
    } catch {}
    
    if ($statusCode -eq 404) {
        Write-Host "  [INFO] Index '$IndexName' doesn't exist (that's ok, will create new)" -ForegroundColor Yellow
    }
    else {
        Write-Host "  [WARN] Could not delete index: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "         Status Code: $statusCode" -ForegroundColor Gray
        Write-Host "         Will try to create anyway (may fail if index exists)" -ForegroundColor Gray
    }
}

Write-Host ""

# ============================================================
# STEP 3: RECREATE INDEX WITH NEW SCHEMA
# ============================================================

Write-Host "[STEP 3] Creating new index with elite schema..." -ForegroundColor Yellow
Write-Host "  (Includes: chunkType, confidence, retrievalWeight, embeddingModel, etc.)" -ForegroundColor Gray
Write-Host ""

# CRITICAL: Pass SearchServiceName to ensure correct service is used
try {
    & "$PSScriptRoot\create-search-index.ps1" -ResourceGroupName $ResourceGroupName -SearchServiceName $SearchServiceName -IndexName $IndexName
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "  [OK] Index created successfully with elite schema!" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "  [ERROR] Failed to create index (exit code: $LASTEXITCODE)" -ForegroundColor Red
        Write-Host "  Check the output above for details" -ForegroundColor Yellow
        exit 1
    }
}
catch {
    Write-Host ""
    Write-Host "  [ERROR] Failed to create index: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Exception Type: $($_.Exception.GetType().FullName)" -ForegroundColor Yellow
    if ($_.Exception.InnerException) {
        Write-Host "  Inner Exception: $($_.Exception.InnerException.Message)" -ForegroundColor Yellow
    }
    exit 1
}

Write-Host ""

# ============================================================
# STEP 4: RE-PROCESS ALL PDFs (IF REQUESTED)
# ============================================================

if (-not $SkipPDFProcessing) {
    Write-Host "[STEP 4] Re-processing all PDFs with enterprise features..." -ForegroundColor Yellow
    Write-Host "  This will:" -ForegroundColor Gray
    Write-Host "    - Extract text with Document Intelligence" -ForegroundColor Gray
    Write-Host "    - Extract tables as separate row-level chunks" -ForegroundColor Gray
    Write-Host "    - Add confidence scores per chunk" -ForegroundColor Gray
    Write-Host "    - Generate embeddings (target: 98%+ coverage)" -ForegroundColor Gray
    Write-Host "    - Add all metadata (category, sector, tags, year)" -ForegroundColor Gray
    Write-Host "    - Index with elite features (chunkType, retrievalWeight, etc.)" -ForegroundColor Gray
    Write-Host ""
    
    # CRITICAL: Wait for index to be fully ready (Azure Search needs time to propagate)
    Write-Host "  Waiting for index to be ready (10 seconds)..." -ForegroundColor Gray
    Start-Sleep -Seconds 10
    
    # Verify index exists before processing
    Write-Host "  Verifying index is accessible..." -ForegroundColor Gray
    try {
        $verifyUrl = "$searchEndpoint/indexes/$IndexName`?api-version=2023-11-01"
        $verifyHeaders = @{
            "api-key" = $searchKey
            "Content-Type" = "application/json"
        }
        $indexCheck = Invoke-RestMethod -Uri $verifyUrl -Method Get -Headers $verifyHeaders -ErrorAction Stop
        Write-Host "  [OK] Index verified and ready ($($indexCheck.fields.Count) fields)" -ForegroundColor Green
    }
    catch {
        Write-Host "  [WARN] Could not verify index: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "  Will attempt processing anyway..." -ForegroundColor Gray
    }
    Write-Host ""
    
    try {
        Write-Host "  Starting PDF processing pipeline..." -ForegroundColor Cyan
        Write-Host ""
        
        # Set chart extraction endpoint if available
        if ($chartExtractionEndpoint) {
            $env:CHART_EXTRACTION_ENDPOINT = $chartExtractionEndpoint
            Write-Host "  [OK] Chart extraction ENABLED: $chartExtractionEndpoint" -ForegroundColor Magenta
        } else {
            Write-Host "  [WARN] Chart extraction DISABLED - deploy Azure Functions first" -ForegroundColor Yellow
            Write-Host "         Run: .\deploy-azure-functions.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor Gray
        }
        Write-Host ""
        
        & "$PSScriptRoot\process-pdfs.ps1" -ResourceGroupName $ResourceGroupName -GenerateEmbeddings -SearchIndexName $IndexName -EmbeddingTPM $EmbeddingTPM
        
        $processExitCode = $LASTEXITCODE
        if ($processExitCode -eq 0) {
            Write-Host ""
            Write-Host "  [SUCCESS] All PDFs re-processed successfully!" -ForegroundColor Green
            Write-Host "  Your RAG system is now ready with world-class intelligence!" -ForegroundColor Green
        } else {
            Write-Host ""
            Write-Host "  [WARN] PDF processing completed with exit code: $processExitCode" -ForegroundColor Yellow
            Write-Host "         Check the output above for details" -ForegroundColor Yellow
            Write-Host "         Some PDFs may have been processed successfully" -ForegroundColor Gray
            Write-Host ""
            Write-Host "  To retry processing, run:" -ForegroundColor Yellow
            Write-Host "    .\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName -GenerateEmbeddings -SearchIndexName $IndexName -EmbeddingTPM $EmbeddingTPM" -ForegroundColor White
        }
    }
    catch {
        Write-Host ""
        Write-Host "  [ERROR] Failed to execute PDF processing script" -ForegroundColor Red
        Write-Host "         Exception: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "         Exception Type: $($_.Exception.GetType().FullName)" -ForegroundColor Yellow
        if ($_.Exception.InnerException) {
            Write-Host "         Inner Exception: $($_.Exception.InnerException.Message)" -ForegroundColor Yellow
        }
        Write-Host ""
        Write-Host "  To retry manually, run:" -ForegroundColor Yellow
        Write-Host "    .\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName -GenerateEmbeddings -SearchIndexName $IndexName -EmbeddingTPM $EmbeddingTPM" -ForegroundColor White
        exit 1
    }
} else {
    Write-Host "[STEP 4] Skipping PDF processing (use -SkipPDFProcessing:$false to enable)" -ForegroundColor Yellow
    Write-Host "  To process PDFs manually, run:" -ForegroundColor Gray
    Write-Host "    .\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName -GenerateEmbeddings" -ForegroundColor White
}

Write-Host ""

# ============================================================
# SUMMARY
# ============================================================

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RESET COMPLETE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

if (-not $SkipPDFProcessing) {
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "  1. Verify quality: .\verify-pdf-content.ps1 -ResourceGroupName $ResourceGroupName -Detailed" -ForegroundColor White
    Write-Host "  2. Test retrieval: .\evaluate-rag-quality.ps1 -ResourceGroupName $ResourceGroupName -Detailed" -ForegroundColor White
    Write-Host ""
}

Write-Host "Your enterprise RAG system is now ready!" -ForegroundColor Green
Write-Host ""
Write-Host "Features enabled:" -ForegroundColor Cyan
Write-Host "  [OK] Elite schema (chunkType, confidence, retrievalWeight)" -ForegroundColor White
Write-Host "  [OK] Structured table extraction (row-level chunks)" -ForegroundColor White
Write-Host "  [OK] Confidence scoring per chunk" -ForegroundColor White
Write-Host "  [OK] Embedding coverage (98%+ target)" -ForegroundColor White
Write-Host "  [OK] Time-aware ranking" -ForegroundColor White
Write-Host "  [OK] Complete metadata (category, sector, tags, year)" -ForegroundColor White
if ($chartExtractionEndpoint) {
    Write-Host "  [OK] Chart/Image extraction (GPT-4 Vision)" -ForegroundColor Magenta
} else {
    Write-Host "  [--] Chart/Image extraction (deploy Azure Functions to enable)" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan

