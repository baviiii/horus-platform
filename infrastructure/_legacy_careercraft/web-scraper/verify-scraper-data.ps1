# Verify Web Scraper Data in Azure AI Search
# Checks if scraping worked and shows what data is in the index

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$SearchIndexName = "sa-gov-documents"
)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Verifying Scraper Data" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get Azure AI Search service
Write-Host "[1/5] Getting Azure AI Search service..." -ForegroundColor Yellow

$searchService = az search service list `
    --resource-group $ResourceGroupName `
    --query "[0]" `
    --output json | ConvertFrom-Json

if (-not $searchService) {
    Write-Host "[ERROR] No Azure AI Search service found in resource group: $ResourceGroupName" -ForegroundColor Red
    exit 1
}

$searchServiceName = $searchService.name
$searchEndpoint = "https://$searchServiceName.search.windows.net"
$searchKey = az search admin-key show `
    --resource-group $ResourceGroupName `
    --service-name $searchServiceName `
    --query "primaryKey" `
    --output tsv

Write-Host "  Service: $searchServiceName" -ForegroundColor Green
Write-Host "  Endpoint: $searchEndpoint" -ForegroundColor Green
Write-Host ""

# Check if index exists (using REST API since CLI doesn't work reliably)
Write-Host "[2/5] Checking if index exists..." -ForegroundColor Yellow

$headers = @{
    "api-key" = $searchKey
    "Content-Type" = "application/json"
}

# Try to get index list via REST API
try {
    $listUrl = "$searchEndpoint/indexes?api-version=2023-11-01"
    $indexesResponse = Invoke-RestMethod -Uri $listUrl -Method Get -Headers $headers
    $indexes = $indexesResponse.value
    
    $targetIndex = $indexes | Where-Object { $_.name -eq $SearchIndexName }
    
    if (-not $targetIndex) {
        Write-Host "[ERROR] Index '$SearchIndexName' does not exist!" -ForegroundColor Red
        Write-Host "  Available indexes:" -ForegroundColor Yellow
        foreach ($idx in $indexes) {
            Write-Host "    - $($idx.name)" -ForegroundColor Gray
        }
        Write-Host ""
        Write-Host "  Create the index first:" -ForegroundColor Yellow
        Write-Host "    .\create-search-index.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
        exit 1
    }
    
    Write-Host "  Index found: $SearchIndexName" -ForegroundColor Green
    Write-Host ""
} catch {
    # If list fails, try to access the index directly
    try {
        $indexUrl = "$searchEndpoint/indexes/$SearchIndexName?api-version=2023-11-01"
        $indexResponse = Invoke-RestMethod -Uri $indexUrl -Method Get -Headers $headers
        Write-Host "  Index found: $SearchIndexName" -ForegroundColor Green
        Write-Host ""
    } catch {
        Write-Host "[ERROR] Index '$SearchIndexName' does not exist or cannot be accessed!" -ForegroundColor Red
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Create the index first:" -ForegroundColor Yellow
        Write-Host "    .\create-search-index.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
        exit 1
    }
}

# Get index statistics (document count) using REST API
Write-Host "[3/5] Getting index statistics..." -ForegroundColor Yellow

try {
    $statsUrl = "$searchEndpoint/indexes/$SearchIndexName/stats?api-version=2023-11-01"
    $stats = Invoke-RestMethod -Uri $statsUrl -Method Get -Headers $headers
    
    $documentCount = $stats.documentCount
    $storageSize = $stats.storageSize
    
    Write-Host "  Documents in index: $documentCount" -ForegroundColor $(if ($documentCount -gt 0) { "Green" } else { "Red" })
    Write-Host "  Storage size: $storageSize bytes" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "  [WARNING] Could not get statistics: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  Trying alternative method..." -ForegroundColor Gray
    # Try to get count via search
    try {
        $countBody = @{
            search = "*"
            top = 0
            count = $true
        } | ConvertTo-Json
        $countUrl = "$searchEndpoint/indexes/$SearchIndexName/docs/search?api-version=2023-11-01"
        $countResponse = Invoke-RestMethod -Uri $countUrl -Method Post -Headers $headers -Body $countBody
        $documentCount = $countResponse.'@odata.count'
        Write-Host "  Documents in index: $documentCount" -ForegroundColor $(if ($documentCount -gt 0) { "Green" } else { "Red" })
        Write-Host ""
    } catch {
        Write-Host "  [ERROR] Could not determine document count" -ForegroundColor Red
        $documentCount = 0
        Write-Host ""
    }
}

if ($documentCount -eq 0) {
    Write-Host "[WARNING] Index is empty! No data found." -ForegroundColor Red
    Write-Host ""
    Write-Host "  To populate the index, run:" -ForegroundColor Yellow
    Write-Host "    cd web-scraper\enterprise-scraper" -ForegroundColor White
    Write-Host "    .\run-enterprise-scraper.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
    exit 1
}

# Sample documents from index
Write-Host "[4/5] Fetching sample documents..." -ForegroundColor Yellow

$headers = @{
    "api-key" = $searchKey
    "Content-Type" = "application/json"
}

# Search for sample documents (get first 5)
$searchBody = @{
    search = "*"
    select = "id,title,documentType,category,sector,url,content"
    top = 5
    orderby = "indexedAt desc"
} | ConvertTo-Json

try {
    $searchUrl = "$searchEndpoint/indexes/$SearchIndexName/docs/search?api-version=2023-11-01"
    $searchResponse = Invoke-RestMethod -Uri $searchUrl -Method Post -Headers $headers -Body $searchBody
    
    Write-Host "  Found $($searchResponse.value.Count) sample documents:" -ForegroundColor Green
    Write-Host ""
    
    foreach ($doc in $searchResponse.value) {
        Write-Host "  Document ID: $($doc.id)" -ForegroundColor Cyan
        Write-Host "    Title: $($doc.title)" -ForegroundColor White
        Write-Host "    Type: $($doc.documentType)" -ForegroundColor Gray
        Write-Host "    Category: $($doc.category)" -ForegroundColor Gray
        Write-Host "    Sector: $($doc.sector)" -ForegroundColor Gray
        if ($doc.url) {
            Write-Host "    URL: $($doc.url)" -ForegroundColor Gray
        }
        $contentPreview = if ($doc.content) { $doc.content.Substring(0, [Math]::Min(100, $doc.content.Length)) + "..." } else { "No content" }
        Write-Host "    Content: $contentPreview" -ForegroundColor DarkGray
        Write-Host ""
    }
} catch {
    Write-Host "  [WARNING] Could not fetch sample documents: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host ""
}

# Check document types breakdown
Write-Host "[5/5] Analyzing document types..." -ForegroundColor Yellow

$facetBody = @{
    search = "*"
    facets = @("documentType", "category", "sector")
    top = 0
} | ConvertTo-Json

try {
    $facetUrl = "$searchEndpoint/indexes/$SearchIndexName/docs/search?api-version=2023-11-01"
    $facetResponse = Invoke-RestMethod -Uri $facetUrl -Method Post -Headers $headers -Body $facetBody
    
    Write-Host ""
    Write-Host "  Document Type Breakdown:" -ForegroundColor Green
    if ($facetResponse.'@search.facets'.documentType) {
        foreach ($facet in $facetResponse.'@search.facets'.documentType) {
            Write-Host "    $($facet.value): $($facet.count) documents" -ForegroundColor White
        }
    } else {
        Write-Host "    (No documentType facets found)" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "  Category Breakdown:" -ForegroundColor Green
    if ($facetResponse.'@search.facets'.category) {
        foreach ($facet in $facetResponse.'@search.facets'.category | Select-Object -First 10) {
            Write-Host "    $($facet.value): $($facet.count) documents" -ForegroundColor White
        }
    } else {
        Write-Host "    (No category facets found)" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "  Sector Breakdown:" -ForegroundColor Green
    if ($facetResponse.'@search.facets'.sector) {
        foreach ($facet in $facetResponse.'@search.facets'.sector) {
            Write-Host "    $($facet.value): $($facet.count) documents" -ForegroundColor White
        }
    } else {
        Write-Host "    (No sector facets found)" -ForegroundColor Gray
    }
    
} catch {
    Write-Host "  [WARNING] Could not analyze document types: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Check if embeddings exist
Write-Host ""
Write-Host "[BONUS] Checking for embeddings..." -ForegroundColor Yellow

$embeddingCheckBody = @{
    search = "*"
    select = "id,contentVector"
    top = 1
} | ConvertTo-Json

try {
    $embeddingUrl = "$searchEndpoint/indexes/$SearchIndexName/docs/search?api-version=2023-11-01"
    $embeddingResponse = Invoke-RestMethod -Uri $embeddingUrl -Method Post -Headers $headers -Body $embeddingCheckBody
    
    if ($embeddingResponse.value.Count -gt 0 -and $embeddingResponse.value[0].contentVector) {
        $vectorSize = $embeddingResponse.value[0].contentVector.Count
        Write-Host "  Embeddings found! Vector size: $vectorSize dimensions" -ForegroundColor Green
    } else {
        Write-Host "  [WARNING] No embeddings found in documents" -ForegroundColor Yellow
        Write-Host "    Documents exist but no vectors. RAG queries will use semantic/keyword search only." -ForegroundColor Gray
        Write-Host "    To add embeddings, run the enterprise scraper:" -ForegroundColor Yellow
        Write-Host "      cd web-scraper\enterprise-scraper" -ForegroundColor White
        Write-Host "      .\run-enterprise-scraper.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
        Write-Host "    OR process PDFs with embeddings:" -ForegroundColor Yellow
        Write-Host "      .\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
    }
} catch {
    Write-Host "  [WARNING] Could not check embeddings: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Final summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Verification Complete" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

if ($documentCount -gt 0) {
    Write-Host "Status: DATA FOUND" -ForegroundColor Green
    Write-Host "  Total documents: $documentCount" -ForegroundColor White
    Write-Host "  Index: $SearchIndexName" -ForegroundColor White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Test a RAG query via Supabase Edge Function" -ForegroundColor Yellow
    Write-Host "  2. Check Azure Portal for more details:" -ForegroundColor Yellow
    Write-Host "     https://portal.azure.com -> Search services -> $searchServiceName -> Indexes" -ForegroundColor White
} else {
    Write-Host "Status: NO DATA FOUND" -ForegroundColor Red
    Write-Host ""
    Write-Host "The index exists but is empty. Run the enterprise scraper to populate it:" -ForegroundColor Yellow
    Write-Host "  cd web-scraper\enterprise-scraper" -ForegroundColor White
    Write-Host "  .\run-enterprise-scraper.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
}

Write-Host ""

