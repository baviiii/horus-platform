# ============================================================
# Verify Azure AI Search Index is Empty
# ============================================================
# Checks if index exists and is empty (ready for clean re-processing)
#
# Usage:
#   .\verify-index-empty.ps1 -ResourceGroupName "rg-careercraft-dev"
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$IndexName = "sa-gov-documents"
)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  VERIFYING INDEX STATUS" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Get search service
$searchService = az search service list --resource-group $ResourceGroupName --query "[0]" --output json 2>$null | ConvertFrom-Json
if (-not $searchService) {
    Write-Host "[ERROR] No Azure AI Search service found" -ForegroundColor Red
    exit 1
}

$SearchServiceName = $searchService.name
$searchEndpoint = "https://$SearchServiceName.search.windows.net"
$searchKey = az search admin-key show --resource-group $ResourceGroupName --service-name $SearchServiceName --query "primaryKey" --output tsv 2>$null

if (-not $searchKey) {
    Write-Host "[ERROR] Could not retrieve search service key" -ForegroundColor Red
    exit 1
}

Write-Host "Search Service: $SearchServiceName" -ForegroundColor White
Write-Host "Index Name: $IndexName" -ForegroundColor White
Write-Host ""

$headers = @{
    "api-key" = $searchKey
    "Content-Type" = "application/json"
}

# Check if index exists
Write-Host "[1/3] Checking if index exists..." -ForegroundColor Yellow
$getIndexUrl = "$searchEndpoint/indexes/$IndexName`?api-version=2023-11-01"

try {
    $indexResponse = Invoke-RestMethod -Uri $getIndexUrl -Method Get -Headers $headers -ErrorAction Stop
    Write-Host "  [OK] Index exists" -ForegroundColor Green
    Write-Host "      Fields: $($indexResponse.fields.Count)" -ForegroundColor Gray
}
catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 404) {
        Write-Host "  [INFO] Index does not exist - will be created during processing" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Index Status: CLEAN (does not exist)" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "  [ERROR] Failed to check index: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# Check document count
Write-Host "[2/3] Checking document count..." -ForegroundColor Yellow

$totalCount = 0
# Try stats API first (most accurate)
try {
    $statsUrl = "$searchEndpoint/indexes/$IndexName/stats?api-version=2023-11-01"
    $statsResponse = Invoke-RestMethod -Uri $statsUrl -Method Get -Headers $headers -ErrorAction Stop
    $totalCount = $statsResponse.documentCount
}
catch {
    # Fallback to search query
    try {
        $searchUrl = "$searchEndpoint/indexes/$IndexName/docs/search?api-version=2023-11-01"
        $searchBody = @{
            search = "*"
            top = 0
        } | ConvertTo-Json
        $searchResponse = Invoke-RestMethod -Uri $searchUrl -Method Post -Headers $headers -Body $searchBody -ErrorAction Stop
        $totalCount = if ($searchResponse.'@odata.count') { $searchResponse.'@odata.count' } else { 0 }
    }
    catch {
        Write-Host "  [ERROR] Failed to query index: $($_.Exception.Message)" -ForegroundColor Red
        $totalCount = 0
    }
}

Write-Host "  Total Documents: $totalCount" -ForegroundColor $(if ($totalCount -eq 0) { "Green" } else { "Yellow" })

if ($totalCount -eq 0) {
    Write-Host "  [OK] Index is empty - ready for clean processing!" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Index contains $totalCount documents" -ForegroundColor Yellow
}

Write-Host ""

# Sample documents if any exist
if ($totalCount -gt 0) {
    Write-Host "[3/3] Sampling documents..." -ForegroundColor Yellow
    $sampleBody = @{
        search = "*"
        top = 5
        select = "id,documentId,chunkType,documentType"
    } | ConvertTo-Json
    
    try {
        $sampleResponse = Invoke-RestMethod -Uri $searchUrl -Method Post -Headers $headers -Body $sampleBody -ErrorAction Stop
        Write-Host "  Sample documents:" -ForegroundColor Gray
        foreach ($doc in $sampleResponse.value) {
            Write-Host "    - $($doc.id) ($($doc.documentType), chunkType: $($doc.chunkType))" -ForegroundColor Gray
        }
    }
    catch {
        Write-Host "  [WARN] Could not sample documents" -ForegroundColor Yellow
    }
} else {
    Write-Host "[3/3] No documents to sample" -ForegroundColor Gray
}

Write-Host ""

# Final Status
Write-Host "============================================================" -ForegroundColor Cyan
if ($totalCount -eq 0) {
    Write-Host "  INDEX STATUS: CLEAN" -ForegroundColor Green
    Write-Host "  Ready for fresh processing!" -ForegroundColor Green
} else {
    Write-Host "  INDEX STATUS: HAS DATA - $totalCount documents" -ForegroundColor Yellow
    Write-Host "  To clean, delete index first:" -ForegroundColor Yellow
    Write-Host "    .\reset-index-and-reprocess.ps1 -ResourceGroupName `"$ResourceGroupName`" -SkipPDFProcessing" -ForegroundColor White
}
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

