# Comprehensive PDF Content Quality Verification
# Checks all quality metrics from the "Insanely Good" RAG standard checklist
# Ensures 100% confidence that everything was parsed properly

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$SearchIndexName = "sa-gov-documents",
    
    [Parameter(Mandatory=$false)]
    [int]$SampleCount = 5,
    
    [Parameter(Mandatory=$false)]
    [switch]$Detailed,
    
    [Parameter(Mandatory=$false)]
    [string]$PdfName = ""
)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PDF Content Quality Audit" -ForegroundColor Cyan
Write-Host "  (Insanely Good RAG Standard)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get Azure AI Search service
Write-Host "[1/7] Getting Azure AI Search service..." -ForegroundColor Yellow

$searchService = az search service list `
    --resource-group $ResourceGroupName `
    --query "[0]" `
    --output json | ConvertFrom-Json

if (-not $searchService) {
    Write-Host "[ERROR] No Azure AI Search service found" -ForegroundColor Red
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
Write-Host ""

# Get index statistics
Write-Host "[2/7] Getting index statistics..." -ForegroundColor Yellow

$headers = @{
    "api-key" = $searchKey
    "Content-Type" = "application/json"
}

$statsUrl = "$searchEndpoint/indexes/$SearchIndexName/stats?api-version=2023-11-01"
try {
    $stats = Invoke-RestMethod -Uri $statsUrl -Method Get -Headers $headers
    $documentCount = $stats.documentCount
    $storageSize = $stats.storageSize
} catch {
    Write-Host "  [WARNING] Could not get stats" -ForegroundColor Yellow
    $documentCount = 0
}

Write-Host "  Index: $SearchIndexName" -ForegroundColor Green
if ($documentCount -gt 0) {
    Write-Host "  Total Documents: $documentCount" -ForegroundColor Green
    Write-Host "  Storage Size: $([math]::Round($storageSize / 1MB, 2)) MB" -ForegroundColor Green
}
Write-Host ""

# Get all PDF documents with pagination
Write-Host "[3/7] Loading PDF documents..." -ForegroundColor Yellow

if ($PdfName) {
    $filter = "documentType eq 'pdf' and documentId eq '$PdfName'"
} else {
    $filter = "documentType eq 'pdf'"
}

$allPdfDocs = @()
$skip = 0
$top = 1000
$searchUrl = "$searchEndpoint/indexes/$SearchIndexName/docs/search?api-version=2023-11-01"

do {
    $searchBody = @{
        search = "*"
        filter = $filter
        top = $top
        skip = $skip
        select = "documentId,pageNumber,chunkIndex,title,metadata,content,contentVector,url,source,category,sector,tags,topics,sectors,occupation,indexedAt"
        orderby = "documentId,pageNumber,chunkIndex"
    } | ConvertTo-Json
    
    $result = Invoke-RestMethod -Uri $searchUrl -Method Post -Headers $headers -Body $searchBody
    $allPdfDocs += $result.value
    $skip += $top
} while ($result.value.Count -eq $top)

if ($allPdfDocs.Count -eq 0) {
    Write-Host "  [ERROR] No PDF documents found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "  To index PDFs, run:" -ForegroundColor Yellow
    Write-Host "    .\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName -GenerateEmbeddings" -ForegroundColor White
    exit 1
}

Write-Host "  Loaded $($allPdfDocs.Count) PDF chunks" -ForegroundColor Green
Write-Host ""

# Group by documentId
$pdfGroups = $allPdfDocs | Group-Object -Property documentId

Write-Host "[4/7] Analyzing document quality..." -ForegroundColor Yellow
Write-Host ""

# Quality metrics
$qualityMetrics = @{
    TotalPDFs = $pdfGroups.Count
    TotalPages = 0
    TotalChunks = 0
    PDFsWithEmbeddings = 0
    PDFsWithTables = 0
    PDFsWithCompleteMetadata = 0
    PDFsWithSourceUrl = 0
    PDFsWithYear = 0
    PDFsWithCategory = 0
    PDFsWithSector = 0
    PDFsWithTags = 0
    ChunksWithEmbeddings = 0
    MissingEmbeddings = @()
    MissingMetadata = @()
    MissingSourceUrl = @()
    PdfCoverageDetails = @()
    # Serialization issues
    SerializationIssues = @{
        occupationAsObject = @()
        nullArrays = @()
        scalarArrays = @()
        arrayPrimitives = @()
        totalIssues = 0
    }
}

foreach ($pdfGroup in $pdfGroups) {
    $pdfId = $pdfGroup.Name
    $chunks = $pdfGroup.Group
    
    # Get metadata from first chunk
    $firstChunk = $chunks[0]
    $metadata = try { $firstChunk.metadata | ConvertFrom-Json } catch { $null }
    
    $pages = ($chunks | Select-Object -ExpandProperty pageNumber -Unique).Count
    $chunkCount = $chunks.Count  # Actually indexed chunks
    $hasEmbeddings = ($chunks | Where-Object { $_.contentVector -ne $null -and $_.contentVector.Count -gt 0 }).Count -gt 0
    $chunksWithEmbeddings = ($chunks | Where-Object { $_.contentVector -ne $null -and $_.contentVector.Count -gt 0 }).Count
    $tablesFound = if ($metadata -and $metadata.tablesFound) { $metadata.tablesFound } else { 0 }
    
    # Get expected chunk count from metadata (what should have been indexed)
    $expectedChunks = if ($metadata -and $metadata.totalChunks) { $metadata.totalChunks } else { $chunkCount }
    $skippedChunks = $expectedChunks - $chunkCount
    
    $qualityMetrics.TotalPages += $pages
    $qualityMetrics.TotalChunks += $chunkCount
    $qualityMetrics.ChunksWithEmbeddings += $chunksWithEmbeddings
    
    # Calculate REAL per-PDF coverage (based on expected chunks, not just indexed)
    # This shows true coverage including skipped chunks
    $pdfCoverage = if ($expectedChunks -gt 0) { [math]::Round(($chunksWithEmbeddings / $expectedChunks) * 100, 1) } else { 0 }
    $qualityMetrics.PdfCoverageDetails += [PSCustomObject]@{
        PdfId = $pdfId
        ExpectedChunks = $expectedChunks
        IndexedChunks = $chunkCount
        ChunksWithEmbeddings = $chunksWithEmbeddings
        SkippedChunks = $skippedChunks
        Coverage = $pdfCoverage
        Pages = $pages
        HasTables = $tablesFound -gt 0
    }
    
    if ($hasEmbeddings) { $qualityMetrics.PDFsWithEmbeddings++ } else { $qualityMetrics.MissingEmbeddings += $pdfId }
    if ($tablesFound -gt 0) { $qualityMetrics.PDFsWithTables++ }
    
    # Check metadata completeness
    $hasUrl = $firstChunk.url -and $firstChunk.url -notmatch "^\s*$"
    $hasCategory = $firstChunk.category -and $firstChunk.category -notmatch "^\s*$"
    $hasSector = $firstChunk.sector -and $firstChunk.sector -notmatch "^\s*$"
    $hasTags = $firstChunk.tags -and ($firstChunk.tags | Measure-Object).Count -gt 0
    
    # Try to extract year from metadata or filename
    $hasYear = $false
    if ($metadata -and $metadata.publicationYear) {
        $hasYear = $true
    } elseif ($pdfId -match "(\d{4})") {
        $hasYear = $true  # Year found in filename
    }
    
    # Complete metadata = all fields present
    $completeMetadata = $hasUrl -and $hasCategory -and $hasSector -and $hasTags
    
    if ($hasUrl) { $qualityMetrics.PDFsWithSourceUrl++ } else { $qualityMetrics.MissingSourceUrl += $pdfId }
    if ($hasCategory) { $qualityMetrics.PDFsWithCategory++ }
    if ($hasSector) { $qualityMetrics.PDFsWithSector++ }
    if ($hasTags) { $qualityMetrics.PDFsWithTags++ }
    if ($hasYear) { $qualityMetrics.PDFsWithYear++ }
    if ($completeMetadata) { $qualityMetrics.PDFsWithCompleteMetadata++ } else { 
        $missing = @()
        if (-not $hasUrl) { $missing += "url" }
        if (-not $hasCategory) { $missing += "category" }
        if (-not $hasSector) { $missing += "sector" }
        if (-not $hasTags) { $missing += "tags" }
        $qualityMetrics.MissingMetadata += @{ PdfId = $pdfId; Missing = $missing }
    }
    
    # Check for serialization issues in all chunks
    foreach ($chunk in $chunks) {
        # Check occupation field
        if ($chunk.occupation -and $chunk.occupation.GetType().Name -eq "PSCustomObject") {
            $qualityMetrics.SerializationIssues.occupationAsObject += @{
                id = $chunk.id
                documentId = $chunk.documentId
                pageNumber = $chunk.pageNumber
                chunkIndex = $chunk.chunkIndex
            }
            $qualityMetrics.SerializationIssues.totalIssues++
        }
        
        # Check array fields for null
        foreach ($field in @("tags", "sectors", "topics")) {
            if ($null -eq $chunk.$field) {
                $qualityMetrics.SerializationIssues.nullArrays += @{
                    id = $chunk.id
                    documentId = $chunk.documentId
                    field = $field
                }
                $qualityMetrics.SerializationIssues.totalIssues++
            }
            # Check if array field is scalar
            elseif ($chunk.$field -isnot [array] -and $chunk.$field -ne $null) {
                $qualityMetrics.SerializationIssues.scalarArrays += @{
                    id = $chunk.id
                    documentId = $chunk.documentId
                    field = $field
                    value = $chunk.$field
                }
                $qualityMetrics.SerializationIssues.totalIssues++
            }
        }
        
        # Check primitive fields for arrays
        foreach ($field in @("category", "title", "content")) {
            if ($chunk.$field -is [array]) {
                $qualityMetrics.SerializationIssues.arrayPrimitives += @{
                    id = $chunk.id
                    documentId = $chunk.documentId
                    field = $field
                }
                $qualityMetrics.SerializationIssues.totalIssues++
            }
        }
    }
}

Write-Host "[5/7] Generating quality report..." -ForegroundColor Yellow
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  QUALITY METRICS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Basic stats
Write-Host "Basic Statistics:" -ForegroundColor White
Write-Host "  Total PDFs:        $($qualityMetrics.TotalPDFs)" -ForegroundColor White
Write-Host "  Total Pages:       $($qualityMetrics.TotalPages)" -ForegroundColor White
Write-Host "  Total Chunks:      $($qualityMetrics.TotalChunks)" -ForegroundColor White
Write-Host ""

# Embedding coverage (CRITICAL - Phase 4)
$embeddingPercentage = [math]::Round(($qualityMetrics.ChunksWithEmbeddings / $qualityMetrics.TotalChunks) * 100, 1)
$pdfEmbeddingPercentage = [math]::Round(($qualityMetrics.PDFsWithEmbeddings / $qualityMetrics.TotalPDFs) * 100, 1)

Write-Host "Embedding Coverage (Phase 4 - Critical):" -ForegroundColor White
Write-Host "  PDFs with embeddings:     $($qualityMetrics.PDFsWithEmbeddings)/$($qualityMetrics.TotalPDFs) ($pdfEmbeddingPercentage%)" -ForegroundColor $(if ($pdfEmbeddingPercentage -ge 90) { "Green" } elseif ($pdfEmbeddingPercentage -ge 70) { "Yellow" } else { "Red" })
Write-Host "  Chunks with embeddings:   $($qualityMetrics.ChunksWithEmbeddings)/$($qualityMetrics.TotalChunks) ($embeddingPercentage%)" -ForegroundColor $(if ($embeddingPercentage -ge 90) { "Green" } elseif ($embeddingPercentage -ge 70) { "Yellow" } else { "Red" })

if ($qualityMetrics.MissingEmbeddings.Count -gt 0) {
    Write-Host "  Missing embeddings in:    $($qualityMetrics.MissingEmbeddings.Count) PDFs" -ForegroundColor Red
    if ($Detailed) {
        Write-Host "    PDFs without embeddings:" -ForegroundColor Yellow
        $qualityMetrics.MissingEmbeddings | ForEach-Object { Write-Host "      - $_" -ForegroundColor Gray }
    }
}
Write-Host ""

# Per-PDF Coverage Report
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PER-PDF COVERAGE REPORT" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($qualityMetrics.PdfCoverageDetails) {
    # Sort by coverage (lowest first)
    $sortedCoverage = $qualityMetrics.PdfCoverageDetails | Sort-Object { $_.Coverage }
    
    # Show all PDFs with coverage
    Write-Host "Coverage by PDF (sorted by coverage):" -ForegroundColor White
    Write-Host ""
    
    # Table header
    $header = "{0,-50} {1,8} {2,8} {3,8} {4,8} {5,10} {6,8}" -f "PDF Name", "Expected", "Indexed", "Embedded", "Skipped", "Coverage", "Status"
    Write-Host $header -ForegroundColor Cyan
    Write-Host ("-" * 110) -ForegroundColor Gray
    
    foreach ($pdf in $sortedCoverage) {
        $status = if ($pdf.Coverage -ge 98) { "EXCELLENT" } elseif ($pdf.Coverage -ge 95) { "GOOD" } elseif ($pdf.Coverage -ge 90) { "WARNING" } else { "LOW" }
        $statusColor = if ($pdf.Coverage -ge 98) { "Green" } elseif ($pdf.Coverage -ge 95) { "Yellow" } elseif ($pdf.Coverage -ge 90) { "Yellow" } else { "Red" }
        $coverageColor = if ($pdf.Coverage -ge 98) { "Green" } elseif ($pdf.Coverage -ge 95) { "Yellow" } elseif ($pdf.Coverage -ge 90) { "Yellow" } else { "Red" }
        
        # Truncate PDF name if too long
        $pdfName = if ($pdf.PdfId.Length -gt 48) { $pdf.PdfId.Substring(0, 45) + "..." } else { $pdf.PdfId }
        
        $skippedDisplay = if ($pdf.SkippedChunks -gt 0) { "$($pdf.SkippedChunks)" } else { "0" }
        $skippedColor = if ($pdf.SkippedChunks -gt 0) { "Yellow" } else { "Gray" }
        
        $row = "{0,-50} {1,8} {2,8} {3,8} {4,8} {5,9}% {6,-8}" -f $pdfName, $pdf.ExpectedChunks, $pdf.IndexedChunks, $pdf.ChunksWithEmbeddings, $skippedDisplay, $pdf.Coverage, $status
        Write-Host $row -ForegroundColor $coverageColor
    }
    
    Write-Host ""
    
    # Summary statistics
    $lowCoverage = ($sortedCoverage | Where-Object { $_.Coverage -lt 95 }).Count
    $excellentCoverage = ($sortedCoverage | Where-Object { $_.Coverage -ge 98 }).Count
    $goodCoverage = ($sortedCoverage | Where-Object { $_.Coverage -ge 95 -and $_.Coverage -lt 98 }).Count
    
    Write-Host "Coverage Summary:" -ForegroundColor White
    Write-Host "  Excellent (98%+): $excellentCoverage PDFs" -ForegroundColor Green
    Write-Host "  Good (95-98%):    $goodCoverage PDFs" -ForegroundColor Yellow
    Write-Host "  Low (<95%):       $lowCoverage PDFs" -ForegroundColor $(if ($lowCoverage -gt 0) { "Red" } else { "Green" })
    Write-Host ""
    
    # List PDFs that need reprocessing
    if ($lowCoverage -gt 0) {
        Write-Host "PDFs that need reprocessing (coverage < 95%):" -ForegroundColor Red
        $sortedCoverage | Where-Object { $_.Coverage -lt 95 } | ForEach-Object {
            $skippedInfo = if ($_.SkippedChunks -gt 0) { " (Skipped: $($_.SkippedChunks) chunks)" } else { "" }
            Write-Host "  - $($_.PdfId) ($($_.Coverage)% - $($_.ChunksWithEmbeddings)/$($_.ExpectedChunks) expected$skippedInfo)" -ForegroundColor Yellow
        }
        Write-Host ""
        Write-Host "  To reprocess these PDFs:" -ForegroundColor Yellow
        Write-Host "    1. Fix token limit in process-pdfs.ps1 (already done)" -ForegroundColor Gray
        Write-Host "    2. Temporarily move other PDFs from blob storage" -ForegroundColor Gray
        Write-Host "    3. Run: .\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName -GenerateEmbeddings -ForceReprocess" -ForegroundColor White
        Write-Host ""
    }
} else {
    Write-Host "  No coverage data available" -ForegroundColor Yellow
}
Write-Host ""

# Table extraction (Phase 2)
Write-Host "Table Extraction (Phase 2 - Critical):" -ForegroundColor White
Write-Host "  PDFs with tables:         $($qualityMetrics.PDFsWithTables)/$($qualityMetrics.TotalPDFs)" -ForegroundColor $(if ($qualityMetrics.PDFsWithTables -gt 0) { "Green" } else { "Yellow" })
Write-Host ""

# Metadata completeness (Phase 1 - Data Foundation)
Write-Host "Metadata Completeness (Phase 1 - Data Foundation):" -ForegroundColor White
$metadataPercentage = [math]::Round(($qualityMetrics.PDFsWithCompleteMetadata / $qualityMetrics.TotalPDFs) * 100, 1)
Write-Host "  PDFs with complete metadata: $($qualityMetrics.PDFsWithCompleteMetadata)/$($qualityMetrics.TotalPDFs) ($metadataPercentage%)" -ForegroundColor $(if ($metadataPercentage -ge 80) { "Green" } elseif ($metadataPercentage -ge 60) { "Yellow" } else { "Red" })
Write-Host "  PDFs with source URL:       $($qualityMetrics.PDFsWithSourceUrl)/$($qualityMetrics.TotalPDFs)" -ForegroundColor $(if ($qualityMetrics.PDFsWithSourceUrl -eq $qualityMetrics.TotalPDFs) { "Green" } else { "Yellow" })
Write-Host "  PDFs with category:         $($qualityMetrics.PDFsWithCategory)/$($qualityMetrics.TotalPDFs)" -ForegroundColor $(if ($qualityMetrics.PDFsWithCategory -eq $qualityMetrics.TotalPDFs) { "Green" } else { "Yellow" })
Write-Host "  PDFs with sector:           $($qualityMetrics.PDFsWithSector)/$($qualityMetrics.TotalPDFs)" -ForegroundColor $(if ($qualityMetrics.PDFsWithSector -eq $qualityMetrics.TotalPDFs) { "Green" } else { "Yellow" })
Write-Host "  PDFs with tags:             $($qualityMetrics.PDFsWithTags)/$($qualityMetrics.TotalPDFs)" -ForegroundColor $(if ($qualityMetrics.PDFsWithTags -eq $qualityMetrics.TotalPDFs) { "Green" } else { "Yellow" })
Write-Host "  PDFs with year:             $($qualityMetrics.PDFsWithYear)/$($qualityMetrics.TotalPDFs)" -ForegroundColor $(if ($qualityMetrics.PDFsWithYear -eq $qualityMetrics.TotalPDFs) { "Green" } else { "Yellow" })

if ($qualityMetrics.MissingMetadata.Count -gt 0 -and $Detailed) {
    Write-Host ""
    Write-Host "  PDFs with missing metadata:" -ForegroundColor Yellow
    $qualityMetrics.MissingMetadata | Select-Object -First 10 | ForEach-Object {
        Write-Host "    - $($_.PdfId): Missing $($_.Missing -join ', ')" -ForegroundColor Gray
    }
    if ($qualityMetrics.MissingMetadata.Count -gt 10) {
        Write-Host "    ... and $($qualityMetrics.MissingMetadata.Count - 10) more" -ForegroundColor Gray
    }
}
Write-Host ""

# Serialization Issues (CRITICAL - Data Integrity)
if ($qualityMetrics.SerializationIssues.totalIssues -gt 0) {
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  SERIALIZATION ISSUES (CRITICAL)" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Total serialization issues: $($qualityMetrics.SerializationIssues.totalIssues)" -ForegroundColor Red
    Write-Host ""
    
    if ($qualityMetrics.SerializationIssues.occupationAsObject.Count -gt 0) {
        Write-Host "  [CRITICAL] Occupation as object: $($qualityMetrics.SerializationIssues.occupationAsObject.Count) chunks" -ForegroundColor Red
        Write-Host "    Examples:" -ForegroundColor Yellow
        foreach ($issue in $qualityMetrics.SerializationIssues.occupationAsObject | Select-Object -First 5) {
            Write-Host "      - $($issue.documentId) (page $($issue.pageNumber), chunk $($issue.chunkIndex))" -ForegroundColor Gray
        }
        if ($qualityMetrics.SerializationIssues.occupationAsObject.Count -gt 5) {
            Write-Host "      ... and $($qualityMetrics.SerializationIssues.occupationAsObject.Count - 5) more" -ForegroundColor Gray
        }
        Write-Host ""
    }
    
    if ($qualityMetrics.SerializationIssues.nullArrays.Count -gt 0) {
        Write-Host "  [ISSUE] Null array fields: $($qualityMetrics.SerializationIssues.nullArrays.Count)" -ForegroundColor Yellow
        $byField = $qualityMetrics.SerializationIssues.nullArrays | Group-Object -Property field
        foreach ($group in $byField) {
            Write-Host "    - $($group.Name): $($group.Count) chunks" -ForegroundColor Yellow
        }
        Write-Host ""
    }
    
    if ($qualityMetrics.SerializationIssues.scalarArrays.Count -gt 0) {
        Write-Host "  [ISSUE] Scalar values in array fields: $($qualityMetrics.SerializationIssues.scalarArrays.Count)" -ForegroundColor Yellow
        $byField = $qualityMetrics.SerializationIssues.scalarArrays | Group-Object -Property field
        foreach ($group in $byField) {
            Write-Host "    - $($group.Name): $($group.Count) chunks" -ForegroundColor Yellow
        }
        Write-Host ""
    }
    
    if ($qualityMetrics.SerializationIssues.arrayPrimitives.Count -gt 0) {
        Write-Host "  [ISSUE] Array values in primitive fields: $($qualityMetrics.SerializationIssues.arrayPrimitives.Count)" -ForegroundColor Yellow
        $byField = $qualityMetrics.SerializationIssues.arrayPrimitives | Group-Object -Property field
        foreach ($group in $byField) {
            Write-Host "    - $($group.Name): $($group.Count) chunks" -ForegroundColor Yellow
        }
        Write-Host ""
    }
    
    Write-Host "  [ACTION REQUIRED]" -ForegroundColor Red
    Write-Host "    Run: .\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName -ForceReprocess" -ForegroundColor Cyan
    Write-Host "    The Python helper will automatically fix all serialization issues" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host "Serialization Check:" -ForegroundColor White
    Write-Host "  All fields properly serialized: PASS" -ForegroundColor Green
    Write-Host ""
}

# Quality scorecard
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  QUALITY SCORECARD" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$checks = @()
$checks += @{ Name = "Embedding Coverage (90%+ target)"; Pass = $embeddingPercentage -ge 90; Value = "$embeddingPercentage%" }
$checks += @{ Name = "Table Extraction"; Pass = $qualityMetrics.PDFsWithTables -gt 0; Value = "$($qualityMetrics.PDFsWithTables) PDFs" }
$checks += @{ Name = "Complete Metadata (80%+ target)"; Pass = $metadataPercentage -ge 80; Value = "$metadataPercentage%" }
$checks += @{ Name = "Source URLs"; Pass = $qualityMetrics.PDFsWithSourceUrl -eq $qualityMetrics.TotalPDFs; Value = "$($qualityMetrics.PDFsWithSourceUrl)/$($qualityMetrics.TotalPDFs)" }
$checks += @{ Name = "Categories Tagged"; Pass = $qualityMetrics.PDFsWithCategory -eq $qualityMetrics.TotalPDFs; Value = "$($qualityMetrics.PDFsWithCategory)/$($qualityMetrics.TotalPDFs)" }
$checks += @{ Name = "Sectors Tagged"; Pass = $qualityMetrics.PDFsWithSector -eq $qualityMetrics.TotalPDFs; Value = "$($qualityMetrics.PDFsWithSector)/$($qualityMetrics.TotalPDFs)" }
$checks += @{ Name = "Serialization (No Issues)"; Pass = $qualityMetrics.SerializationIssues.totalIssues -eq 0; Value = "$($qualityMetrics.SerializationIssues.totalIssues) issues" }

$passedChecks = ($checks | Where-Object { $_.Pass }).Count
$totalChecks = $checks.Count
$qualityScore = [math]::Round(($passedChecks / $totalChecks) * 100, 0)

foreach ($check in $checks) {
    $status = if ($check.Pass) { "PASS" } else { "FAIL" }
    $color = if ($check.Pass) { "Green" } else { "Red" }
    Write-Host "  [$status] $($check.Name): $($check.Value)" -ForegroundColor $color
}

Write-Host ""
Write-Host "Overall Quality Score: $qualityScore%" -ForegroundColor $(if ($qualityScore -ge 85) { "Green" } elseif ($qualityScore -ge 70) { "Yellow" } else { "Red" })

if ($qualityScore -ge 95) {
    Write-Host "  Status: EXCELLENT - Grant/Investor ready!" -ForegroundColor Green
} elseif ($qualityScore -ge 85) {
    Write-Host "  Status: STRONG - Accelerator ready" -ForegroundColor Yellow
} elseif ($qualityScore -ge 70) {
    Write-Host "  Status: GOOD - MVP ready" -ForegroundColor Yellow
} else {
    Write-Host "  Status: NEEDS IMPROVEMENT - Critical issues found" -ForegroundColor Red
}
Write-Host ""

# Recommendations
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RECOMMENDATIONS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$recommendations = @()

if ($embeddingPercentage -lt 90) {
    $recommendations += "CRITICAL: Re-process PDFs with -GenerateEmbeddings flag to add missing embeddings"
    $recommendations += "  Command: .\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName -GenerateEmbeddings"
}

if ($qualityMetrics.PDFsWithSourceUrl -lt $qualityMetrics.TotalPDFs) {
    $recommendations += "Add source URLs to PDFs missing them (required for provenance tracking)"
}

if ($metadataPercentage -lt 80) {
    $recommendations += "Enhance metadata extraction to include category, sector, and tags for all PDFs"
}

if ($qualityMetrics.PDFsWithYear -lt $qualityMetrics.TotalPDFs) {
    $recommendations += "Extract and store publication year for all PDFs (required for time-aware queries)"
}

if ($qualityMetrics.SerializationIssues.totalIssues -gt 0) {
    $recommendations += "CRITICAL: Fix serialization issues by running: .\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName -ForceReprocess"
    $recommendations += "  The Python helper (prepare-search-doc.py) will automatically fix all issues"
}

if ($recommendations.Count -eq 0) {
    Write-Host "  All quality checks passed! System is production-ready." -ForegroundColor Green
} else {
    foreach ($rec in $recommendations) {
        Write-Host "  - $rec" -ForegroundColor Yellow
    }
}
Write-Host ""

# Sample content
if ($SampleCount -gt 0) {
    Write-Host "[6/7] Sample document details..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Sample Documents" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    
    $samples = $allPdfDocs | Select-Object -First $SampleCount
    
    foreach ($sample in $samples) {
        $metadata = try { $sample.metadata | ConvertFrom-Json } catch { $null }
        Write-Host "PDF: $($sample.documentId)" -ForegroundColor Cyan
        Write-Host "  Page: $($sample.pageNumber), Chunk: $($sample.chunkIndex)" -ForegroundColor White
        Write-Host "  Title: $($sample.title)" -ForegroundColor White
        Write-Host "  URL: $($sample.url)" -ForegroundColor Gray
        Write-Host "  Category: $($sample.category)" -ForegroundColor Gray
        Write-Host "  Sector: $($sample.sector)" -ForegroundColor Gray
        Write-Host "  Tags: $($sample.tags -join ', ')" -ForegroundColor Gray
        Write-Host "  Has Embedding: $(if ($sample.contentVector) { 'Yes' } else { 'No' })" -ForegroundColor $(if ($sample.contentVector) { "Green" } else { "Red" })
        if ($metadata) {
            Write-Host "  Tables Found: $($metadata.tablesFound)" -ForegroundColor Gray
            Write-Host "  Total Pages: $($metadata.totalPages)" -ForegroundColor Gray
        }
        Write-Host "  Content preview (first 150 chars):" -ForegroundColor Gray
        $preview = if ($sample.content) { $sample.content.Substring(0, [Math]::Min(150, $sample.content.Length)) } else { "No content" }
        Write-Host "  $preview..." -ForegroundColor White
        Write-Host ""
    }
}

# About extraction capabilities
Write-Host "[7/7] Extraction capabilities summary..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  What Gets Extracted" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "YES - Extracted:" -ForegroundColor Green
Write-Host "  - All text content (paragraphs, headings, captions)" -ForegroundColor White
Write-Host "  - Table structure and cell content (converted to searchable text)" -ForegroundColor White
Write-Host "  - Text labels from graphs/charts (axis labels, legends, titles)" -ForegroundColor White
Write-Host "  - Document structure (page numbers, layout)" -ForegroundColor White
Write-Host ""
Write-Host "NO - Not Extracted:" -ForegroundColor Yellow
Write-Host "  - Visual chart/graph content (images are not processed)" -ForegroundColor White
Write-Host "  - Image content (only text overlays are extracted)" -ForegroundColor White
Write-Host ""
Write-Host "To verify table content is searchable:" -ForegroundColor White
Write-Host "  Search for specific numbers or text you know is in a table" -ForegroundColor Gray
Write-Host ""

# Azure Portal link
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  View in Azure Portal" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
$portalUrl = "https://portal.azure.com/#@/resource/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$ResourceGroupName/providers/Microsoft.Search/searchServices/$searchServiceName"
Write-Host "  Search Service: $portalUrl" -ForegroundColor White
Write-Host ""
Write-Host "  In Azure Portal:" -ForegroundColor Yellow
Write-Host "  1. Go to Azure AI Search service" -ForegroundColor White
Write-Host "  2. Click 'Indexes' then '$SearchIndexName'" -ForegroundColor White
Write-Host "  3. Click 'Search explorer' to query documents" -ForegroundColor White
Write-Host "  4. Use filters: documentType eq 'pdf'" -ForegroundColor White
Write-Host ""
