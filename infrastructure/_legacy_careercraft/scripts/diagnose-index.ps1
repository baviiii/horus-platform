#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Diagnose Azure Search index for malformed documents and generate fix report
    
.DESCRIPTION
    Checks all indexed documents for:
    - occupation field as object (should be string)
    - tags/sectors/topics as null (should be arrays)
    - Other serialization issues
    
    Generates a report and optionally fixes issues.
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$SearchIndexName = "sa-gov-documents",
    
    [Parameter(Mandatory=$false)]
    [switch]$FixIssues = $false,
    
    [Parameter(Mandatory=$false)]
    [int]$SampleSize = 0  # 0 = check all, otherwise sample N documents
)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  AZURE SEARCH INDEX DIAGNOSTIC" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Get Azure Search service
Write-Host "[STEP 1] Discovering Azure Search..." -ForegroundColor Yellow
$searchService = az search service list --resource-group $ResourceGroupName --query "[0]" --output json 2>$null | ConvertFrom-Json
if (-not $searchService) {
    Write-Host "[ERROR] No AI Search service found" -ForegroundColor Red
    exit 1
}
$searchEndpoint = "https://$($searchService.name).search.windows.net"
$searchKey = (az search admin-key show --resource-group $ResourceGroupName --service-name $searchService.name --query "primaryKey" --output tsv 2>$null)

$searchHeaders = @{
    "Content-Type" = "application/json"
    "api-key" = $searchKey
}

Write-Host "  [OK] Search service: $($searchService.name)" -ForegroundColor Green
Write-Host "  [OK] Index: $SearchIndexName" -ForegroundColor Green
Write-Host ""

# Get total document count
Write-Host "[STEP 2] Getting index statistics..." -ForegroundColor Yellow
$statsUrl = "$searchEndpoint/indexes/$SearchIndexName/stats?api-version=2023-11-01"
try {
    $stats = Invoke-RestMethod -Uri $statsUrl -Method Get -Headers $searchHeaders
    $totalDocs = $stats.documentCount
    Write-Host "  [INFO] Total documents in index: $totalDocs" -ForegroundColor Cyan
} catch {
    Write-Host "  [WARN] Could not get stats: $($_.Exception.Message)" -ForegroundColor Yellow
    $totalDocs = 0
}
Write-Host ""

# Query documents
Write-Host "[STEP 3] Querying documents..." -ForegroundColor Yellow

$issues = @{
    occupationAsObject = @()
    nullArrays = @()
    scalarArrays = @()
    arrayPrimitives = @()
    totalChecked = 0
    totalIssues = 0
}

$searchUrl = "$searchEndpoint/indexes/$SearchIndexName/docs/search?api-version=2023-11-01"
$top = if ($SampleSize -gt 0) { $SampleSize } else { 1000 }  # Azure Search max per request
$skip = 0
$checked = 0

do {
    $queryBody = @{
        search = "*"
        top = $top
        skip = $skip
        select = "id,documentId,occupation,tags,sectors,topics,category,content,title"
        orderby = "id"
    } | ConvertTo-Json -Compress
    
    try {
        $response = Invoke-RestMethod -Uri $searchUrl -Method Post -Headers $searchHeaders -Body $queryBody -ContentType "application/json"
        $docs = $response.value
        
        if ($docs.Count -eq 0) {
            break
        }
        
        Write-Host "  Checking batch: $($skip + 1) to $($skip + $docs.Count)..." -ForegroundColor Gray
        
        foreach ($doc in $docs) {
            $checked++
            $hasIssue = $false
            $docIssues = @()
            
            # Check occupation field
            if ($doc.occupation -and $doc.occupation.GetType().Name -eq "PSCustomObject") {
                $issues.occupationAsObject += @{
                    id = $doc.id
                    documentId = $doc.documentId
                    occupation = $doc.occupation
                }
                $hasIssue = $true
                $docIssues += "occupation is object"
            }
            
            # Check array fields for null
            foreach ($field in @("tags", "sectors", "topics")) {
                if ($null -eq $doc.$field) {
                    $issues.nullArrays += @{
                        id = $doc.id
                        documentId = $doc.documentId
                        field = $field
                    }
                    $hasIssue = $true
                    $docIssues += "$field is null"
                }
                # Check if array field is scalar
                elseif ($doc.$field -isnot [array] -and $doc.$field -ne $null) {
                    $issues.scalarArrays += @{
                        id = $doc.id
                        documentId = $doc.documentId
                        field = $field
                        value = $doc.$field
                    }
                    $hasIssue = $true
                    $docIssues += "$field is scalar (not array)"
                }
            }
            
            # Check primitive fields for arrays
            foreach ($field in @("category", "title", "content")) {
                if ($doc.$field -is [array]) {
                    $issues.arrayPrimitives += @{
                        id = $doc.id
                        documentId = $doc.documentId
                        field = $field
                        value = $doc.$field
                    }
                    $hasIssue = $true
                    $docIssues += "$field is array (should be string)"
                }
            }
            
            if ($hasIssue) {
                $issues.totalIssues++
            }
        }
        
        $issues.totalChecked = $checked
        $skip += $docs.Count
        
        # If sampling, stop after sample size
        if ($SampleSize -gt 0 -and $checked -ge $SampleSize) {
            break
        }
        
        # If no more results
        if ($docs.Count -lt $top) {
            break
        }
        
    } catch {
        Write-Host "  [ERROR] Failed to query: $($_.Exception.Message)" -ForegroundColor Red
        break
    }
} while ($true)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "  DIAGNOSTIC REPORT" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host ""

Write-Host "  Documents checked: $($issues.totalChecked)" -ForegroundColor Cyan
Write-Host "  Documents with issues: $($issues.totalIssues)" -ForegroundColor $(if ($issues.totalIssues -eq 0) { "Green" } else { "Yellow" })
Write-Host ""

if ($issues.occupationAsObject.Count -gt 0) {
    Write-Host "  [ISSUE] Occupation as object: $($issues.occupationAsObject.Count)" -ForegroundColor Red
    Write-Host "    Examples:" -ForegroundColor Gray
    foreach ($issue in $issues.occupationAsObject | Select-Object -First 5) {
        Write-Host "      - $($issue.id) (doc: $($issue.documentId))" -ForegroundColor Gray
    }
    if ($issues.occupationAsObject.Count -gt 5) {
        Write-Host "      ... and $($issues.occupationAsObject.Count - 5) more" -ForegroundColor Gray
    }
    Write-Host ""
}

if ($issues.nullArrays.Count -gt 0) {
    Write-Host "  [ISSUE] Null array fields: $($issues.nullArrays.Count)" -ForegroundColor Red
    $byField = $issues.nullArrays | Group-Object -Property field
    foreach ($group in $byField) {
        Write-Host "    - $($group.Name): $($group.Count) documents" -ForegroundColor Yellow
    }
    Write-Host ""
}

if ($issues.scalarArrays.Count -gt 0) {
    Write-Host "  [ISSUE] Scalar values in array fields: $($issues.scalarArrays.Count)" -ForegroundColor Red
    $byField = $issues.scalarArrays | Group-Object -Property field
    foreach ($group in $byField) {
        Write-Host "    - $($group.Name): $($group.Count) documents" -ForegroundColor Yellow
    }
    Write-Host ""
}

if ($issues.arrayPrimitives.Count -gt 0) {
    Write-Host "  [ISSUE] Array values in primitive fields: $($issues.arrayPrimitives.Count)" -ForegroundColor Red
    $byField = $issues.arrayPrimitives | Group-Object -Property field
    foreach ($group in $byField) {
        Write-Host "    - $($group.Name): $($group.Count) documents" -ForegroundColor Yellow
    }
    Write-Host ""
}

# Save report
$reportPath = Join-Path $PSScriptRoot "logs" "index-diagnostic-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').json"
$reportDir = Split-Path $reportPath -Parent
if (-not (Test-Path $reportDir)) {
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
}

$report = @{
    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    indexName = $SearchIndexName
    totalDocuments = $totalDocs
    documentsChecked = $issues.totalChecked
    documentsWithIssues = $issues.totalIssues
    issues = @{
        occupationAsObject = $issues.occupationAsObject
        nullArrays = $issues.nullArrays
        scalarArrays = $issues.scalarArrays
        arrayPrimitives = $issues.arrayPrimitives
    }
    summary = @{
        occupationAsObjectCount = $issues.occupationAsObject.Count
        nullArraysCount = $issues.nullArrays.Count
        scalarArraysCount = $issues.scalarArrays.Count
        arrayPrimitivesCount = $issues.arrayPrimitives.Count
    }
}

$report | ConvertTo-Json -Depth 10 | Out-File -FilePath $reportPath -Encoding UTF8
Write-Host "  [REPORT SAVED]" -ForegroundColor Green
Write-Host "    Path: $reportPath" -ForegroundColor White
Write-Host ""

# Fix issues if requested
if ($FixIssues -and $issues.totalIssues -gt 0) {
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  FIXING ISSUES" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
    
    Write-Host "  [INFO] This will re-index documents with fixes..." -ForegroundColor Yellow
    Write-Host "  [INFO] Use the Python helper to ensure proper serialization" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  [NOTE] Run process-pdfs.ps1 with -ForceReprocess to fix all issues" -ForegroundColor Cyan
    Write-Host "        The Python helper will prevent these issues going forward" -ForegroundColor Cyan
    Write-Host ""
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RECOMMENDATIONS" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

if ($issues.totalIssues -eq 0) {
    Write-Host "  [SUCCESS] No issues found! Your index is clean." -ForegroundColor Green
} else {
    Write-Host "  [ACTION REQUIRED]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  To fix all issues:" -ForegroundColor White
    Write-Host "    1. Run: .\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName -ForceReprocess" -ForegroundColor Cyan
    Write-Host "    2. The Python helper will automatically fix all serialization issues" -ForegroundColor Cyan
    Write-Host "    3. Documents will be updated (not duplicated) due to mergeOrUpload" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  The Python helper (prepare-search-doc.py) is now active and will" -ForegroundColor White
    Write-Host "  prevent these issues from happening again." -ForegroundColor White
}

Write-Host ""
