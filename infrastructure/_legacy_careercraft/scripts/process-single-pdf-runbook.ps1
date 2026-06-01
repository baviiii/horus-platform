<#
.SYNOPSIS
    Azure Automation Runbook to process a single PDF
    Triggered by Event Grid when PDF is uploaded to blob storage
    
.DESCRIPTION
    - Downloads PDF from blob storage
    - Analyzes with Document Intelligence
    - Chunks intelligently
    - Generates embeddings
    - Indexes to Azure Search
    
.PARAMETER WebhookData
    Event Grid webhook data (automatic from trigger)
    
.PARAMETER BlobName
    Manual override - process specific blob by name
#>

param(
    [Parameter(Mandatory=$false)]
    [object]$WebhookData,
    
    [Parameter(Mandatory=$false)]
    [string]$BlobName
)

# Timeout settings
$MaxRuntimeMinutes = 30
$StartTime = Get-Date

# Status reporting URL
$StatusApiUrl = $env:STATUS_API_URL
if (-not $StatusApiUrl) {
    $StatusApiUrl = "https://careercraft-functions-dev.azurewebsites.net/api/pdf-upload"
}

# Check for Python availability (same as main script)
$pythonAvailable = $false
$pythonHelperScript = $null
try {
    $pythonTest = python --version 2>&1
    if ($LASTEXITCODE -eq 0 -or $pythonTest -match "Python") {
        $pythonAvailable = $true
        Write-Output "Python detected: $pythonTest"
        
        # Try to find Python helper script (if runbook has access to it)
        # In Azure Automation, you may need to upload this script as a module
        $possiblePaths = @(
            "$PSScriptRoot\prepare-search-doc.py",
            ".\prepare-search-doc.py",
            "$env:AZURE_AUTOMATION_MODULE_PATH\prepare-search-doc.py"
        )
        
        foreach ($path in $possiblePaths) {
            if (Test-Path $path) {
                $pythonHelperScript = $path
                Write-Output "Found Python helper script: $path"
                break
            }
        }
        
        if (-not $pythonHelperScript) {
            Write-Warning "Python available but helper script not found - will use PowerShell fallback"
        }
    }
} catch {
    Write-Warning "Python not available - will use PowerShell fallback for JSON normalization"
}

# Helper function to normalize JSON for Azure Search (prevents serialization issues)
# Uses Python when available (same as main script), falls back to PowerShell
function Get-CleanSearchJson {
    param(
        [Parameter(Mandatory=$true)]
        [object]$Documents,
        [int]$Depth = 15
    )
    
    # Convert to JSON first
    $jsonBody = $Documents | ConvertTo-Json -Depth $Depth -Compress
    
    # If Python helper is available, use it (same as main script)
    if ($pythonAvailable -and $pythonHelperScript) {
        try {
            # Pipe JSON through Python - capture stdout only, stderr separate
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = "python"
            $psi.Arguments = "`"$pythonHelperScript`""
            $psi.UseShellExecute = $false
            $psi.RedirectStandardInput = $true
            $psi.RedirectStandardOutput = $true
            $psi.RedirectStandardError = $true
            $psi.CreateNoWindow = $true
            
            $process = [System.Diagnostics.Process]::Start($psi)
            
            # Write JSON to stdin
            $process.StandardInput.Write($jsonBody)
            $process.StandardInput.Close()
            
            # Read output
            $pythonResult = $process.StandardOutput.ReadToEnd()
            $pythonError = $process.StandardError.ReadToEnd()
            $process.WaitForExit()
            $exitCode = $process.ExitCode
            $process.Dispose()
            
            # Check if Python succeeded and output is valid JSON
            if ($exitCode -eq 0 -and $pythonResult) {
                $cleanResult = $pythonResult.Trim()
                # Validate it's valid JSON
                try {
                    $null = $cleanResult | ConvertFrom-Json -ErrorAction Stop
                    if ($cleanResult.StartsWith("{") -or $cleanResult.StartsWith("[")) {
                        Write-Output "  [OK] Python JSON normalization applied"
                        return $cleanResult
                    }
                } catch {
                    Write-Warning "Python output is not valid JSON, using PowerShell fallback"
                }
            } else {
                Write-Warning "Python normalization failed: $pythonError"
            }
        } catch {
            Write-Warning "Python normalization error: $_ - using PowerShell fallback"
        }
    }
    
    # PowerShell fallback (if Python not available or failed)
    function Normalize-Document {
        param([hashtable]$Doc)
        
        # Array fields that must always be arrays
        $arrayFields = @('tags', 'sectors', 'topics')
        foreach ($field in $arrayFields) {
            if ($Doc.ContainsKey($field)) {
                $val = $Doc[$field]
                if ($null -eq $val) {
                    $Doc[$field] = @()
                } elseif ($val -isnot [array]) {
                    $Doc[$field] = @($val)
                }
            } else {
                # Ensure field exists as empty array
                $Doc[$field] = @()
            }
        }
        
        # Primitive string fields that must be scalars (not arrays)
        $primitiveFields = @('id', 'content', 'documentId', 'documentType', 'source', 'url', 'title', 'category', 'sector', 'occupation', 'metadata', 'chunkType', '@search.action')
        foreach ($field in $primitiveFields) {
            if ($Doc.ContainsKey($field)) {
                $val = $Doc[$field]
                if ($val -is [array] -and $val.Count -gt 0) {
                    # Unwrap array - take first element
                    $Doc[$field] = $val[0]
                } elseif ($null -eq $val) {
                    $Doc[$field] = ""
                }
            }
        }
        
        return $Doc
    }
    
    # Normalize documents (PowerShell fallback)
    if ($Documents.value -is [array]) {
        # Azure Search batch format: { value: [...] }
        $normalizedDocs = $Documents.value | ForEach-Object {
            if ($_ -is [hashtable]) {
                Normalize-Document $_
            } else {
                $_
            }
        }
        $Documents.value = $normalizedDocs
    } elseif ($Documents -is [array]) {
        # Array of documents
        $Documents = $Documents | ForEach-Object {
            if ($_ -is [hashtable]) {
                Normalize-Document $_
            } else {
                $_
            }
        }
    } elseif ($Documents -is [hashtable]) {
        # Single document
        $Documents = Normalize-Document $Documents
    }
    
    # Convert to JSON
    return $Documents | ConvertTo-Json -Depth $Depth -Compress
}

# Helper function to report status
function Update-ProcessingStatus {
    param(
        [string]$BlobName,
        [string]$Status,
        [int]$Progress,
        [string]$Step,
        [string]$ErrorMessage,
        [object]$Result
    )
    
    try {
        $body = @{
            blobName = $BlobName
            status = $Status
            progress = $Progress
            step = $Step
        }
        if ($ErrorMessage) { $body.error = $ErrorMessage }
        if ($Result) { $body.result = $Result }
        
        $jsonBody = $body | ConvertTo-Json -Depth 5
        Invoke-RestMethod -Uri "$StatusApiUrl`?action=update_status" -Method Post -Body $jsonBody -ContentType "application/json" -ErrorAction SilentlyContinue
    } catch {
        Write-Output "Failed to update status: $_"
    }
}

Write-Output "========================================"
Write-Output "PDF Processing Runbook Started"
Write-Output "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Output "========================================"

# Get configuration from Automation Variables
try {
    $StorageConnectionString = Get-AutomationVariable -Name "StorageConnectionString"
    $ContainerName = Get-AutomationVariable -Name "ContainerName"
    $DocIntelEndpoint = Get-AutomationVariable -Name "DocIntelEndpoint"
    $DocIntelKey = Get-AutomationVariable -Name "DocIntelKey"
    $SearchEndpoint = Get-AutomationVariable -Name "SearchEndpoint"
    $SearchKey = Get-AutomationVariable -Name "SearchKey"
    $SearchIndexName = Get-AutomationVariable -Name "SearchIndexName"
    $OpenAIEndpoint = Get-AutomationVariable -Name "OpenAIEndpoint"
    $OpenAIKey = Get-AutomationVariable -Name "OpenAIKey"
} catch {
    Write-Error "Failed to get Automation Variables: $_"
    throw
}

# Parse blob name from webhook or parameter
if ($WebhookData) {
    Write-Output "Triggered by Event Grid webhook"
    $webhookBody = $WebhookData.RequestBody | ConvertFrom-Json
    
    # Event Grid sends array of events
    $eventData = $webhookBody[0]
    if (-not $eventData) { $eventData = $webhookBody }
    
    $blobUrl = $eventData.data.url
    if ($blobUrl) {
        # Extract blob name from URL
        $BlobName = ($blobUrl -split "/rag-documents/")[1]
        Write-Output "Blob URL: $blobUrl"
    } else {
        $BlobName = $eventData.subject -replace "^.*/blobs/", ""
    }
}

if (-not $BlobName) {
    Write-Error "No blob name provided. Either trigger via Event Grid or pass -BlobName parameter."
    throw "Missing BlobName"
}

Write-Output "Processing: $BlobName"

# Report initial status
Update-ProcessingStatus -BlobName $BlobName -Status "starting" -Progress 5 -Step "Initializing"

# Skip non-PDF files
if ($BlobName -notlike "*.pdf") {
    Write-Output "Skipping non-PDF file: $BlobName"
    return
}

# Connect to Azure Storage
$storageContext = New-AzStorageContext -ConnectionString $StorageConnectionString

# Check if blob exists
$blob = Get-AzStorageBlob -Container $ContainerName -Blob $BlobName -Context $storageContext -ErrorAction SilentlyContinue
if (-not $blob) {
    Write-Error "Blob not found: $BlobName"
    throw "Blob not found"
}

Write-Output "Blob size: $([math]::Round($blob.Length / 1MB, 2)) MB"

# Check file size and warn if large
$estimatedPages = [math]::Round($blob.Length / 500KB)  # ~500KB per page estimate

if ($estimatedPages -gt 500) {
    # Very large PDF - warn but still try (might timeout, that's OK)
    Write-Output "WARNING: Very large PDF (~$estimatedPages pages) - may timeout"
    Write-Output "Processing will attempt anyway. If it fails, run manually."
    Update-ProcessingStatus -BlobName $BlobName -Status "analyzing" -Progress 10 -Step "Large PDF detected (~$estimatedPages pages) - processing..."
} elseif ($estimatedPages -gt 200) {
    Write-Output "NOTE: Large PDF (~$estimatedPages pages) - may take 15-25 minutes"
} else {
    Write-Output "Estimated pages: $estimatedPages (should complete in 5-10 minutes)"
}

Update-ProcessingStatus -BlobName $BlobName -Status "analyzing" -Progress 15 -Step "Starting Document Intelligence"

# Generate SAS URL for Document Intelligence
$sasToken = New-AzStorageBlobSASToken -Container $ContainerName -Blob $BlobName -Context $storageContext -Permission r -ExpiryTime (Get-Date).AddHours(1)
$blobUri = $blob.ICloudBlob.Uri.AbsoluteUri
$sasUrl = "$blobUri$sasToken"

Write-Output "Generated SAS URL"

# ============================================
# STEP 1: Document Intelligence Analysis
# ============================================
Write-Output "`n[STEP 1/4] Analyzing with Document Intelligence..."

$analysisUrl = "$DocIntelEndpoint/formrecognizer/documentModels/prebuilt-layout:analyze?api-version=2024-11-30"
$headers = @{
    "Ocp-Apim-Subscription-Key" = $DocIntelKey
    "Content-Type" = "application/json"
}
$body = @{ urlSource = $sasUrl } | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri $analysisUrl -Method Post -Headers $headers -Body $body
    $operationUrl = $response.Headers["Operation-Location"]
    Write-Output "Analysis started..."
    
    # Poll for completion
    $maxPolls = 120  # 10 minutes max
    $pollCount = 0
    do {
        Start-Sleep -Seconds 5
        $pollCount++
        $statusResponse = Invoke-RestMethod -Uri $operationUrl -Headers @{ "Ocp-Apim-Subscription-Key" = $DocIntelKey }
        $status = $statusResponse.status
        Write-Output "  Status: $status (poll $pollCount)"
        
        # Check timeout
        $elapsed = (Get-Date) - $StartTime
        if ($elapsed.TotalMinutes -gt $MaxRuntimeMinutes) {
            Write-Error "Timeout exceeded ($MaxRuntimeMinutes minutes)"
            throw "Timeout"
        }
    } while ($status -eq "running" -and $pollCount -lt $maxPolls)
    
    if ($status -ne "succeeded") {
        Write-Error "Document Intelligence failed: $status"
        throw "Analysis failed"
    }
    
    $analysisResult = $statusResponse.analyzeResult
    Write-Output "Analysis complete: $($analysisResult.pages.Count) pages"
    
    # Extract tables count
$tablesFound = $analysisResult.tables.Count
Update-ProcessingStatus -BlobName $BlobName -Status "chunking" -Progress 40 -Step "Document analyzed: $($analysisResult.pages.Count) pages, $tablesFound tables found"
    
} catch {
    Write-Error "Document Intelligence error: $_"
    Update-ProcessingStatus -BlobName $BlobName -Status "failed" -Progress 0 -Step "Failed" -ErrorMessage "Document Intelligence error: $_"
    throw
}

# ============================================
# STEP 2: Extract and Chunk Content
# ============================================
Write-Output "`n[STEP 2/4] Creating intelligent chunks..."

$chunks = @()
$chunkIndex = 0
$targetChunkSize = 800
$minChunkSize = 200

# Extract paragraphs
$currentChunk = ""
$currentHeading = ""

foreach ($para in $analysisResult.paragraphs) {
    $paraText = $para.content
    $paraRole = $para.role
    
    # Track headings
    if ($paraRole -like "*heading*" -or $paraRole -eq "title") {
        if ($currentChunk.Length -ge $minChunkSize) {
            $chunks += @{
                index = $chunkIndex++
                text = $currentChunk.Trim()
                heading = $currentHeading
                pageNumber = $para.boundingRegions[0].pageNumber
            }
            $currentChunk = ""
        }
        $currentHeading = $paraText
    }
    
    # Check chunk size
    if (($currentChunk.Length + $paraText.Length) -gt ($targetChunkSize * 2) -and $currentChunk.Length -ge $minChunkSize) {
        $chunks += @{
            index = $chunkIndex++
            text = $currentChunk.Trim()
            heading = $currentHeading
            pageNumber = $para.boundingRegions[0].pageNumber
        }
        # Overlap
        $words = $currentChunk -split '\s+' | Select-Object -Last 30
        $currentChunk = ($words -join ' ') + " " + $paraText + "`n`n"
    } else {
        $currentChunk += $paraText + "`n`n"
    }
}

# Final chunk
if ($currentChunk.Trim().Length -ge $minChunkSize) {
    $chunks += @{
        index = $chunkIndex++
        text = $currentChunk.Trim()
        heading = $currentHeading
        pageNumber = $analysisResult.pages.Count
    }
}

Write-Output "Created $($chunks.Count) text chunks"

# Extract tables
$tableChunks = @()
$tableIndex = 0
foreach ($table in $analysisResult.tables) {
    $tableIndex++
    $headers = @()
    $rows = @{}
    
    foreach ($cell in $table.cells) {
        $rowIdx = $cell.rowIndex
        $colIdx = $cell.columnIndex
        
        if (-not $rows[$rowIdx]) { $rows[$rowIdx] = @{} }
        $rows[$rowIdx][$colIdx] = $cell.content
        
        if ($rowIdx -eq 0) { $headers += $cell.content }
    }
    
    foreach ($rowIdx in ($rows.Keys | Sort-Object)) {
        if ($rowIdx -eq 0) { continue }
        
        $rowValues = ($rows[$rowIdx].Keys | Sort-Object | ForEach-Object { $rows[$rowIdx][$_] })
        $rowText = $rowValues -join " | "
        
        $tableChunks += @{
            type = "table_row"
            tableIndex = $tableIndex
            rowIndex = $rowIdx
            headers = $headers
            text = $rowText
            pageNumber = $table.boundingRegions[0].pageNumber
        }
    }
}

Write-Output "Extracted $($tableChunks.Count) table rows"

# Calculate progress based on chunks
$totalChunks = $chunks.Count + $tableChunks.Count
Update-ProcessingStatus -BlobName $BlobName -Status "embedding" -Progress 55 -Step "Chunking complete: $($chunks.Count) text chunks, $($tableChunks.Count) table rows ($totalChunks total)"

# ============================================
# STEP 3: Generate Embeddings
# ============================================
Write-Output "`n[STEP 3/4] Generating embeddings..."

$embeddingDeployment = "text-embedding-3-large"
$embeddingUrl = "$OpenAIEndpoint/openai/deployments/$embeddingDeployment/embeddings?api-version=2024-02-01"

foreach ($chunk in $chunks) {
    try {
        $embeddingBody = @{
            input = $chunk.text.Substring(0, [Math]::Min(8000, $chunk.text.Length))
        } | ConvertTo-Json
        
        $embeddingResponse = Invoke-RestMethod -Uri $embeddingUrl -Method Post -Headers @{
            "api-key" = $OpenAIKey
            "Content-Type" = "application/json"
        } -Body $embeddingBody
        
        $chunk.embedding = $embeddingResponse.data[0].embedding
        
        # Rate limiting
        Start-Sleep -Milliseconds 100
        
    } catch {
        Write-Warning "Embedding failed for chunk $($chunk.index): $_"
        $chunk.embedding = $null
    }
    
    # Progress updates
    if ($chunk.index % 10 -eq 0) {
        $embedProgress = [Math]::Round((($chunk.index + 1) / $chunks.Count) * 15) + 55  # 55-70% range
        Write-Output "  Embedded $($chunk.index + 1)/$($chunks.Count) chunks"
        Update-ProcessingStatus -BlobName $BlobName -Status "embedding" -Progress $embedProgress -Step "Generating embeddings: $($chunk.index + 1)/$($chunks.Count) chunks"
    }
}

Write-Output "Embeddings complete: $embeddingsGenerated/$($chunks.Count) generated"

Update-ProcessingStatus -BlobName $BlobName -Status "indexing" -Progress 75 -Step "Embeddings complete ($embeddingsGenerated/$($chunks.Count)) - indexing to Azure Search"

# ============================================
# STEP 4: Index to Azure Search
# ============================================
Write-Output "`n[STEP 4/4] Indexing to Azure Search..."

$pdfName = [System.IO.Path]::GetFileNameWithoutExtension($BlobName)
$title = $pdfName -replace "[-_]", " " -replace "^\d+-", ""
$sourceUrl = $blobUri

$documents = @()

# Add text chunks
foreach ($chunk in $chunks) {
    $docId = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("$BlobName-text-$($chunk.index)")) -replace '[^a-zA-Z0-9]', ''
    $docId = $docId.Substring(0, [Math]::Min(128, $docId.Length))
    
    # CRITICAL: Ensure array fields are always arrays (Azure Search requirement)
    $doc = @{
        "@search.action" = "mergeOrUpload"
        id = $docId
        content = $chunk.text
        documentId = $BlobName
        documentType = "pdf"
        source = "automation-upload"
        url = $sourceUrl
        title = $title
        pageNumber = $chunk.pageNumber
        chunkIndex = $chunk.index
        chunkType = "text"
        sectionHeading = $chunk.heading
        indexedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        category = "government-document"
        sector = "general"
        tags = @()  # CRITICAL: Always array
        sectors = @("general")  # CRITICAL: Always array
        topics = @()  # CRITICAL: Always array
    }
    
    if ($chunk.embedding) {
        $doc.contentVector = $chunk.embedding
    }
    
    $documents += $doc
}

# Add table chunks
foreach ($tChunk in $tableChunks) {
    $docId = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("$BlobName-table-$($tChunk.tableIndex)-$($tChunk.rowIndex)")) -replace '[^a-zA-Z0-9]', ''
    $docId = $docId.Substring(0, [Math]::Min(128, $docId.Length))
    
    # CRITICAL: Ensure array fields are always arrays (Azure Search requirement)
    $documents += @{
        "@search.action" = "mergeOrUpload"
        id = $docId
        content = "Table $($tChunk.tableIndex) Row: $($tChunk.text)"
        documentId = $BlobName
        documentType = "pdf"
        source = "automation-upload"
        url = $sourceUrl
        title = $title
        pageNumber = $tChunk.pageNumber
        chunkIndex = $tChunk.rowIndex
        chunkType = "table_row"
        indexedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        category = "government-document"
        sector = "general"
        tags = @()  # CRITICAL: Always array
        sectors = @("general")  # CRITICAL: Always array
        topics = @()  # CRITICAL: Always array
    }
}

# Batch upload to Search
$indexUrl = "$SearchEndpoint/indexes/$SearchIndexName/docs/index?api-version=2024-07-01"
$batchSize = 100

for ($i = 0; $i -lt $documents.Count; $i += $batchSize) {
    $batch = $documents[$i..[Math]::Min($i + $batchSize - 1, $documents.Count - 1)]
    # CRITICAL: Use normalization function to prevent serialization issues
    $batchBody = Get-CleanSearchJson -Documents @{ value = [array]$batch } -Depth 10
    
    try {
        Invoke-RestMethod -Uri $indexUrl -Method Post -Headers @{
            "api-key" = $SearchKey
            "Content-Type" = "application/json"
        } -Body $batchBody
        
        $batchNum = [Math]::Floor($i / $batchSize) + 1
        $totalBatches = [Math]::Ceiling($documents.Count / $batchSize)
        $indexProgress = 75 + [Math]::Round(($batchNum / $totalBatches) * 20)  # 75-95% range
        Write-Output "  Indexed batch $batchNum/$totalBatches"
        Update-ProcessingStatus -BlobName $BlobName -Status "indexing" -Progress $indexProgress -Step "Indexing to Azure Search: batch $batchNum/$totalBatches"
    } catch {
        Write-Error "Index batch failed: $_"
    }
}

# ============================================
# COMPLETE
# ============================================
$elapsed = (Get-Date) - $StartTime

# Calculate quality metrics
$embeddingsGenerated = ($chunks | Where-Object { $_.embedding }).Count
$embeddingCoverage = if ($chunks.Count -gt 0) { [Math]::Round(($embeddingsGenerated / $chunks.Count) * 100, 1) } else { 0 }
$tablesFound = $analysisResult.tables.Count
$chartsFound = 0  # Will be updated if chart extraction is added

# Determine quality status
$qualityStatus = if ($embeddingCoverage -ge 98) { "EXCELLENT" } elseif ($embeddingCoverage -ge 95) { "GOOD" } else { "LOW" }

# Report final completion status with comprehensive metrics
$resultData = @{
    pages = $analysisResult.pages.Count
    textChunks = $chunks.Count
    tableRows = $tableChunks.Count
    chartsFound = $chartsFound
    totalIndexed = $documents.Count
    embeddingsGenerated = $embeddingsGenerated
    embeddingCoverage = $embeddingCoverage
    tablesFound = $tablesFound
    processingTime = "$([Math]::Round($elapsed.TotalMinutes, 2)) minutes"
    quality = @{
        coverage = $embeddingCoverage
        status = $qualityStatus
        hasEmbeddings = $embeddingsGenerated -gt 0
        hasTables = $tablesFound -gt 0
        hasCharts = $chartsFound -gt 0
    }
}
Update-ProcessingStatus -BlobName $BlobName -Status "completed" -Progress 100 -Step "Processing complete" -Result $resultData

Write-Output "`n========================================"
Write-Output "Processing Complete!"
Write-Output "========================================"
Write-Output "PDF: $BlobName"
Write-Output "Pages: $($analysisResult.pages.Count)"
Write-Output "Text Chunks: $($chunks.Count)"
Write-Output "Table Rows: $($tableChunks.Count)"
Write-Output "Total Documents Indexed: $($documents.Count)"
Write-Output "Time: $([Math]::Round($elapsed.TotalMinutes, 2)) minutes"
Write-Output "========================================"
