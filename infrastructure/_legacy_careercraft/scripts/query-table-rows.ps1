# Query Table Rows from Azure Search
# Shows table rows with parsed headers and rowValues

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroupName = "rg-careercraft-dev",
    
    [Parameter(Mandatory=$false)]
    [string]$SearchServiceName = "careercraft-search-dev",
    
    [Parameter(Mandatory=$false)]
    [string]$IndexName = "sa-gov-documents",
    
    [Parameter(Mandatory=$false)]
    [int]$Top = 10,
    
    [Parameter(Mandatory=$false)]
    [string]$Filter = ""
)

$searchEndpoint = "https://$SearchServiceName.search.windows.net"
$adminKey = (az search admin-key show --resource-group $ResourceGroupName --service-name $SearchServiceName --query "primaryKey" -o tsv)

if (-not $adminKey) {
    Write-Host "Failed to get admin key" -ForegroundColor Red
    exit 1
}

$headers = @{
    "api-key" = $adminKey
    "Content-Type" = "application/json"
}

# Build filter - always include table_row filter
$filterExpr = "chunkType eq 'table_row'"
if ($Filter) {
    $filterExpr = "$filterExpr and $Filter"
}

$body = @{
    search = "*"
    filter = $filterExpr
    top = $Top
    select = "id,content,chunkType,metadata,documentId,title,pageNumber,category,sector"
    facets = @("chunkType,count:10", "category,count:10", "sector,count:10")
} | ConvertTo-Json -Depth 10

$url = "$searchEndpoint/indexes/$IndexName/docs/search?api-version=2023-11-01&`$count=true"

try {
    $response = Invoke-RestMethod -Uri $url -Method POST -Headers $headers -Body $body
    
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "TABLE ROWS IN AZURE SEARCH" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Total table rows: $($response.'@odata.count')" -ForegroundColor Green
    Write-Host "Showing: $Top rows`n" -ForegroundColor Yellow
    
    # Show facets
    if ($response.'@search.facets') {
        Write-Host "Breakdown by Category:" -ForegroundColor Cyan
        if ($response.'@search.facets'.category) {
            $response.'@search.facets'.category | ForEach-Object {
                Write-Host "  $($_.value): $($_.count)" -ForegroundColor White
            }
        }
        Write-Host "`nBreakdown by Sector:" -ForegroundColor Cyan
        if ($response.'@search.facets'.sector) {
            $response.'@search.facets'.sector | ForEach-Object {
                Write-Host "  $($_.value): $($_.count)" -ForegroundColor White
            }
        }
    }
    
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "SAMPLE TABLE ROWS" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
    
    $count = 0
    foreach ($row in $response.value) {
        $count++
        Write-Host "[$count] Table Row" -ForegroundColor Yellow
        Write-Host "  Document: $($row.documentId)" -ForegroundColor White
        Write-Host "  Page: $($row.pageNumber)" -ForegroundColor White
        Write-Host "  Category: $($row.category)" -ForegroundColor White
        Write-Host "  Sector: $($row.sector)" -ForegroundColor White
        Write-Host "  Content: $($row.content.Substring(0, [Math]::Min(100, $row.content.Length)))..." -ForegroundColor Gray
        
        # Parse metadata to show headers and rowValues
        try {
            $metadata = $row.metadata | ConvertFrom-Json
            if ($metadata.headers) {
                Write-Host "  Headers: $($metadata.headers -join ' | ')" -ForegroundColor Cyan
            }
            if ($metadata.rowValues) {
                Write-Host "  Row Values: $($metadata.rowValues -join ' | ')" -ForegroundColor Green
            }
            if ($metadata.tableIndex) {
                Write-Host "  Table Index: $($metadata.tableIndex), Row Index: $($metadata.rowIndex)" -ForegroundColor Magenta
            }
        } catch {
            Write-Host "  Metadata: (could not parse)" -ForegroundColor Red
        }
        
        Write-Host ""
    }
    
    Write-Host "`nTo query table rows in code, use:" -ForegroundColor Yellow
    Write-Host "  filter: `"chunkType eq 'table_row'`"" -ForegroundColor White
    Write-Host "  Then parse the 'metadata' field (JSON string) to get 'headers' and 'rowValues'" -ForegroundColor White
    
} catch {
    Write-Host "Error querying table rows: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
}

