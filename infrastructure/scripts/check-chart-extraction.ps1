# ============================================================================
# CHECK CHART EXTRACTION STATUS
# Queries Azure Search to see if chart data was actually extracted
# ============================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroupName = "rg-careercraft-dev",
    
    [Parameter(Mandatory=$false)]
    [string]$SearchServiceName = "careercraft-search-dev",
    
    [Parameter(Mandatory=$false)]
    [string]$IndexName = "sa-gov-documents"
)

# Load environment variables
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
}

# Get Azure Search credentials
$searchEndpoint = $env:AZURE_SEARCH_ENDPOINT
$searchKey = $env:AZURE_SEARCH_KEY

if (-not $searchEndpoint -or -not $searchKey) {
    # Try to get from Azure CLI
    Write-Host "Azure Search credentials not in .env, trying Azure CLI..." -ForegroundColor Yellow
    
    try {
        $searchEndpoint = "https://$SearchServiceName.search.windows.net"
        $searchKey = az search admin-key show --resource-group $ResourceGroupName --service-name $SearchServiceName --query primaryKey -o tsv
        
        if (-not $searchKey) {
            Write-Error "Could not get Azure Search key. Set AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY in infrastructure/.env"
            exit 1
        }
    } catch {
        Write-Error "Could not get Azure Search credentials. Set AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY in infrastructure/.env"
        exit 1
    }
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  CHECKING CHART EXTRACTION STATUS" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Search Endpoint: $searchEndpoint" -ForegroundColor Gray
Write-Host "Index: $IndexName" -ForegroundColor Gray
Write-Host ""

$headers = @{
    "api-key" = $searchKey
    "Content-Type" = "application/json"
}

# Check 1: Count chunks with chart data
Write-Host "[1/4] Checking for chunks with chart data..." -ForegroundColor Yellow

# Query for chunks with chunkType = "chart"
$chartQuery = @{
    search = "*"
    filter = "chunkType eq 'chart'"
    top = 100
    select = "id,title,documentId,chunkType,chartData,chartType,hasChart"
} | ConvertTo-Json

try {
    $chartResponse = Invoke-RestMethod -Uri "$searchEndpoint/indexes/$IndexName/docs/search?api-version=2023-11-01" `
        -Method Post -Headers $headers -Body $chartQuery -ErrorAction Stop
    
    $chartChunks = $chartResponse.value.Count
    Write-Host "  Chunks with chunkType='chart': $chartChunks" -ForegroundColor $(if ($chartChunks -gt 0) { "Green" } else { "Yellow" })
    
    # Also check chunks with hasChart = true
    $hasChartQuery = @{
        search = "*"
        filter = "hasChart eq true"
        top = 100
        select = "id,title,documentId,chunkType,hasChart,chartData"
    } | ConvertTo-Json
    
    $hasChartResponse = Invoke-RestMethod -Uri "$searchEndpoint/indexes/$IndexName/docs/search?api-version=2023-11-01" `
        -Method Post -Headers $headers -Body $hasChartQuery -ErrorAction Stop
    
    $chunksWithHasChart = $hasChartResponse.value.Count
    Write-Host "  Chunks with hasChart=true: $chunksWithHasChart" -ForegroundColor $(if ($chunksWithHasChart -gt 0) { "Green" } else { "Yellow" })
    
    $chunksWithCharts = [Math]::Max($chartChunks, $chunksWithHasChart)
} catch {
    Write-Host "  [ERROR] Could not query: $($_.Exception.Message)" -ForegroundColor Red
    $chunksWithCharts = 0
}

# Check 2: Sample chunks with chart data
Write-Host ""
Write-Host "[2/4] Sampling chunks with chart data..." -ForegroundColor Yellow

$sampleChartQuery = @{
    search = "*"
    filter = "chunkType eq 'chart' or hasChart eq true"
    top = 5
    select = "id,title,documentId,chunkType,hasChart,chartType,chartData,chartConfidence,visualDescription"
} | ConvertTo-Json

try {
    $sampleChartResponse = Invoke-RestMethod -Uri "$searchEndpoint/indexes/$IndexName/docs/search?api-version=2023-11-01" `
        -Method Post -Headers $headers -Body $sampleChartQuery -ErrorAction Stop
    
    if ($sampleChartResponse.value.Count -gt 0) {
        Write-Host "  Found $($sampleChartResponse.value.Count) sample chunks with charts:" -ForegroundColor Green
        foreach ($chunk in $sampleChartResponse.value) {
            Write-Host "    - $($chunk.title)" -ForegroundColor Cyan
            Write-Host "      Chunk Type: $($chunk.chunkType) | Chart Type: $($chunk.chartType) | Has Chart: $($chunk.hasChart)" -ForegroundColor Gray
            if ($chunk.chartData) {
                $chartDataStr = if ($chunk.chartData -is [string]) { $chunk.chartData } else { ($chunk.chartData | ConvertTo-Json -Depth 2) }
                Write-Host "      ✅ Chart Data: $($chartDataStr.Substring(0, [Math]::Min(150, $chartDataStr.Length)))..." -ForegroundColor Green
            } else {
                Write-Host "      ⚠️  Chart detected but no chartData field" -ForegroundColor Yellow
            }
            if ($chunk.visualDescription) {
                Write-Host "      Description: $($chunk.visualDescription.Substring(0, [Math]::Min(100, $chunk.visualDescription.Length)))..." -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "  No chunks with chart data found in sample" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [ERROR] Could not sample: $($_.Exception.Message)" -ForegroundColor Red
}

# Check 3: Check chunk types distribution
Write-Host ""
Write-Host "[3/4] Checking chunk type distribution..." -ForegroundColor Yellow

$chunkTypeQuery = @{
    search = "*"
    top = 1000
    select = "id,chunkType,hasChart"
} | ConvertTo-Json

try {
    $chunkTypeResponse = Invoke-RestMethod -Uri "$searchEndpoint/indexes/$IndexName/docs/search?api-version=2023-11-01" `
        -Method Post -Headers $headers -Body $chunkTypeQuery -ErrorAction Stop
    
    $chartChunks = ($chunkTypeResponse.value | Where-Object { $_.chunkType -eq "chart" }).Count
    $tableChunks = ($chunkTypeResponse.value | Where-Object { $_.chunkType -eq "table" }).Count
    $textChunks = ($chunkTypeResponse.value | Where-Object { $_.chunkType -eq "text" -or $_.chunkType -eq $null }).Count
    $hasChartFlag = ($chunkTypeResponse.value | Where-Object { $_.hasChart -eq $true }).Count
    
    Write-Host "  Sample distribution (from 1000 chunks):" -ForegroundColor Cyan
    Write-Host "    Chart chunks: $chartChunks" -ForegroundColor $(if ($chartChunks -gt 0) { "Green" } else { "Gray" })
    Write-Host "    Table chunks: $tableChunks" -ForegroundColor $(if ($tableChunks -gt 0) { "Green" } else { "Gray" })
    Write-Host "    Text chunks: $textChunks" -ForegroundColor Gray
    Write-Host "    Chunks with hasChart=true: $hasChartFlag" -ForegroundColor $(if ($hasChartFlag -gt 0) { "Green" } else { "Gray" })
    
    $chunksWithMetadataOnly = ($chunkTypeResponse.value | Where-Object { $_.hasChart -eq $true -and $_.chunkType -ne "chart" }).Count
} catch {
    Write-Host "  [ERROR] Could not query: $($_.Exception.Message)" -ForegroundColor Red
    $chunksWithMetadataOnly = 0
    $chartChunks = 0
}

# Check 4: Total chunk count (simpler query)
Write-Host ""
Write-Host "[4/4] Getting total chunk count..." -ForegroundColor Yellow

$totalQuery = @{
    search = "*"
    top = 1
} | ConvertTo-Json

try {
    $totalResponse = Invoke-RestMethod -Uri "$searchEndpoint/indexes/$IndexName/docs/search?api-version=2023-11-01" `
        -Method Post -Headers $headers -Body $totalQuery -ErrorAction Stop
    
    # Get a sample chunk to see what fields exist
    if ($totalResponse.value.Count -gt 0) {
        $sampleChunk = $totalResponse.value[0]
        Write-Host "  ✅ Successfully connected to index" -ForegroundColor Green
        Write-Host "  Sample chunk fields: $($sampleChunk.PSObject.Properties.Name -join ', ')" -ForegroundColor Gray
        
        # Check for visual-related fields
        $hasVisualType = $sampleChunk.PSObject.Properties.Name -contains "visualType"
        $hasChunkType = $sampleChunk.PSObject.Properties.Name -contains "chunkType"
        $hasChartData = $sampleChunk.PSObject.Properties.Name -contains "chartData"
        
        Write-Host ""
        Write-Host "  Field Check:" -ForegroundColor Cyan
        Write-Host "    visualType field: $(if ($hasVisualType) { '✅ EXISTS' } else { '❌ NOT FOUND' })" -ForegroundColor $(if ($hasVisualType) { "Green" } else { "Red" })
        Write-Host "    chunkType field: $(if ($hasChunkType) { '✅ EXISTS' } else { '❌ NOT FOUND' })" -ForegroundColor $(if ($hasChunkType) { "Green" } else { "Red" })
        Write-Host "    chartData field: $(if ($hasChartData) { '✅ EXISTS' } else { '❌ NOT FOUND' })" -ForegroundColor $(if ($hasChartData) { "Green" } else { "Red" })
        
        if ($hasChunkType) {
            Write-Host "    Sample chunkType: $($sampleChunk.chunkType)" -ForegroundColor Gray
        }
        if ($hasVisualType) {
            Write-Host "    Sample visualType: $($sampleChunk.visualType)" -ForegroundColor Gray
        }
    }
    
    # Try to get count using $count parameter
    $countUrl = "$searchEndpoint/indexes/$IndexName/docs/`$count?api-version=2023-11-01"
    try {
        $countResponse = Invoke-RestMethod -Uri $countUrl -Method Get -Headers $headers -ErrorAction Stop
        $totalChunks = $countResponse
        Write-Host "  Total chunks in index: $totalChunks" -ForegroundColor Cyan
    } catch {
        Write-Host "  Could not get exact count, but index is accessible" -ForegroundColor Yellow
        $totalChunks = "Unknown"
    }
} catch {
    $errorDetails = $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        $errorDetails += " | Response: $errorBody"
    }
    Write-Host "  [ERROR] Could not query: $errorDetails" -ForegroundColor Red
    Write-Host "  This might be a credentials issue. Check your Azure Search key." -ForegroundColor Yellow
    $totalChunks = 0
}

# Summary
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Total Chunks: $totalChunks" -ForegroundColor White
Write-Host "Chunks with Chart Data: $chunksWithCharts" -ForegroundColor $(if ($chunksWithCharts -gt 0) { "Green" } else { "Red" })
Write-Host "Chunks with Metadata Only: $chunksWithMetadataOnly" -ForegroundColor $(if ($chunksWithMetadataOnly -gt 0) { "Yellow" } else { "Gray" })

if ($totalChunks -gt 0) {
    $chartPercentage = [Math]::Round(($chunksWithCharts / $totalChunks) * 100, 2)
    Write-Host "Chart Extraction Rate: $chartPercentage%" -ForegroundColor $(if ($chartPercentage -gt 0) { "Green" } else { "Red" })
}

Write-Host ""

# Conclusion
if ($chunksWithCharts -gt 0) {
    Write-Host "✅ Chart extraction WORKED! You have chart data in your chunks." -ForegroundColor Green
    Write-Host "   No need to reprocess - you're good to go!" -ForegroundColor Green
} elseif ($chunksWithMetadataOnly -gt 0) {
    Write-Host "⚠️  Chart extraction PARTIALLY WORKED" -ForegroundColor Yellow
    Write-Host "   You have visual metadata but no actual chart data." -ForegroundColor Yellow
    Write-Host "   Consider deploying chart-extraction function for better results." -ForegroundColor Yellow
} else {
    Write-Host "❌ No chart data found" -ForegroundColor Red
    Write-Host "   Either no charts in your PDFs, or extraction didn't run." -ForegroundColor Red
    Write-Host "   Check your audit logs for [VISION] messages." -ForegroundColor Red
}

Write-Host ""
