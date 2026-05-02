# Upload scraped content to Azure AI Search
# Reads JSON output from Playwright scraper and uploads to Azure AI Search with embeddings

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$InputFile = "",
    
    [Parameter(Mandatory=$false)]
    [string]$SearchIndexName = "sa-gov-documents"
)

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Upload to Azure AI Search" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Find latest output file if not specified
if ([string]::IsNullOrEmpty($InputFile)) {
    $outputDir = Join-Path $PSScriptRoot "output"
    $latestFile = Get-ChildItem -Path $outputDir -Filter "scraped-content-*.json" | 
        Sort-Object LastWriteTime -Descending | 
        Select-Object -First 1
    
    if ($latestFile) {
        $InputFile = $latestFile.FullName
        Write-Host "Using latest output file: $($latestFile.Name)" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] No output file found. Run scraper.js first." -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Path $InputFile)) {
    Write-Host "[ERROR] Input file not found: $InputFile" -ForegroundColor Red
    exit 1
}

# Get Azure resources
Write-Host "[1/4] Getting Azure resources..." -ForegroundColor Yellow

$searchService = az search service list --resource-group $ResourceGroupName --query "[0]" | ConvertFrom-Json
if (-not $searchService) {
    Write-Host "[ERROR] No Azure AI Search service found" -ForegroundColor Red
    exit 1
}

$searchEndpoint = "https://$($searchService.name).search.windows.net"
$searchKey = az search admin-key show --resource-group $ResourceGroupName --service-name $searchService.name --query "primaryKey" -o tsv

# Note: Foundry accounts use "AIServices" kind, not "OpenAI"
$allCogServices = az cognitiveservices account list --resource-group $ResourceGroupName --output json | ConvertFrom-Json
$openAI = $allCogServices | Where-Object { $_.kind -eq "OpenAI" -or $_.kind -eq "AIServices" } | Select-Object -First 1
if (-not $openAI) {
    Write-Host "[ERROR] Azure OpenAI not found - embeddings require OpenAI!" -ForegroundColor Red
    Write-Host "        Deploy OpenAI first: .\deploy-openai-model.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor Yellow
    exit 1
}

$openAIEndpoint = $openAI.properties.endpoint
$openAIKey = az cognitiveservices account keys list --name $openAI.name --resource-group $ResourceGroupName --query "key1" -o tsv
$embeddingDeployment = "text-embedding-3-large"

Write-Host "  Search Service: $($searchService.name)" -ForegroundColor Green
Write-Host "  OpenAI: $($openAI.name)" -ForegroundColor Green
Write-Host ""

# Load scraped content
Write-Host "[2/4] Loading scraped content..." -ForegroundColor Yellow
$documents = Get-Content $InputFile | ConvertFrom-Json
Write-Host "  Loaded $($documents.Count) documents" -ForegroundColor Green
Write-Host ""

# Generate embeddings
Write-Host "[3/4] Generating embeddings..." -ForegroundColor Yellow

# Text sanitization function (matching PDF processing - uses .NET libraries for perfection)
function Sanitize-TextForIndexing {
    param([string]$Text)
    
    if ([string]::IsNullOrEmpty($Text)) {
        return $Text
    }
    
    # Use .NET's built-in Unicode normalization and proper encoding handling
    # This is more robust than manual character replacement and handles edge cases automatically
    
    try {
        # Step 1: Normalize Unicode to standard form (FormC = Canonical Composition)
        # This handles combining characters, decomposed forms, etc.
        $Text = $Text.Normalize([System.Text.NormalizationForm]::FormC)
        
        # Step 2: Build clean string using StringBuilder for performance
        $sb = New-Object System.Text.StringBuilder($Text.Length)
        
        foreach ($char in $Text.ToCharArray()) {
            $charCode = [int]$char
            
            # Keep all printable ASCII characters (32-126) and whitespace (9, 10, 13)
            if (($charCode -ge 32 -and $charCode -le 126) -or 
                $charCode -eq 9 -or $charCode -eq 10 -or $charCode -eq 13) {
                $sb.Append($char) | Out-Null
            }
            # Convert common Unicode punctuation to ASCII equivalents
            elseif ($charCode -eq 0x2013 -or $charCode -eq 0x2014) { 
                $sb.Append('-') | Out-Null  # En/Em dash → hyphen
            }
            elseif ($charCode -eq 0x2018 -or $charCode -eq 0x2019) { 
                $sb.Append("'") | Out-Null  # Smart single quotes → apostrophe
            }
            elseif ($charCode -eq 0x201C -or $charCode -eq 0x201D) { 
                $sb.Append('"') | Out-Null  # Smart double quotes → standard quote
            }
            elseif ($charCode -eq 0x2026) { 
                $sb.Append('...') | Out-Null  # Ellipsis → three dots
            }
            elseif ($charCode -eq 0x00B7) { 
                $sb.Append('.') | Out-Null  # Middle dot → period
            }
            elseif ($charCode -eq 0x2022) { 
                $sb.Append('*') | Out-Null  # Bullet → asterisk
            }
            elseif ($charCode -eq 0x00BB -or $charCode -eq 0x00AB) { 
                $sb.Append(' ') | Out-Null  # Angle quotes → space
            }
            elseif ($charCode -eq 0x00A0) { 
                $sb.Append(' ') | Out-Null  # Non-breaking space → space
            }
            # Skip all other non-ASCII characters (zero-width, BOM, control chars, etc.)
            # This automatically handles any new problematic characters we haven't seen yet
        }
        
        $Text = $sb.ToString()
        
        # Step 3: Final UTF-8 validation - ensure the string can be safely encoded
        # Convert to bytes and back to validate UTF-8 encoding
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $Text = [System.Text.Encoding]::UTF8.GetString($bytes)
        
        # Step 4: Remove any remaining control characters (safety check)
        $Text = [regex]::Replace($Text, '[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]', '')
        
    } catch {
        # Fallback: If normalization fails, use ASCII-only encoding
        # This ensures we never return invalid text that would cause silent failures
        try {
            $Text = [System.Text.Encoding]::ASCII.GetString(
                [System.Text.Encoding]::Default.GetBytes($Text)
            )
            # Remove any remaining non-ASCII
            $Text = [regex]::Replace($Text, '[^\x20-\x7E\n\r\t]', '')
        } catch {
            # Last resort: return empty string if everything fails
            # Better to skip a chunk than to cause silent failures downstream
            Write-Warning "Text sanitization failed completely, returning empty string"
            return ""
        }
    }
    
    return $Text
}

function Generate-Embedding {
    param(
        [string]$Text,
        [string]$Endpoint,
        [string]$Key,
        [string]$Deployment,
        [int]$RetryCount = 0
    )
    
    # Skip empty or very short content
    if ([string]::IsNullOrWhiteSpace($Text) -or $Text.Length -lt 10) {
        return $null
    }
    
    $headers = @{
        "Content-Type" = "application/json"
        "api-key" = $Key
    }
    
    # Limit text length (matching PDF processing - 15000 chars = ~7500 tokens, safe under 8192 limit)
    $maxChars = 15000
    $textToEmbed = $Text.Substring(0, [Math]::Min($maxChars, $Text.Length)).Trim()
    
    if ([string]::IsNullOrWhiteSpace($textToEmbed)) {
        return $null
    }
    
    # CRITICAL: Sanitize text using .NET libraries (matching PDF processing)
    # This ensures perfect UTF-8 encoding and handles all edge cases automatically
    $textToEmbed = Sanitize-TextForIndexing -Text $textToEmbed
    
    if ([string]::IsNullOrWhiteSpace($textToEmbed) -or $textToEmbed.Length -lt 10) {
        return $null
    }
    
    # Use correct API structure for Azure OpenAI
    $body = @{
        input = @($textToEmbed)
    } | ConvertTo-Json -Depth 10 -Compress
    
    # Fix double slash issue (ensure endpoint doesn't end with /)
    $cleanEndpoint = $Endpoint.TrimEnd('/')
    $embeddingUrl = "$cleanEndpoint/openai/deployments/$Deployment/embeddings?api-version=2024-02-15-preview"
    
    try {
        $response = Invoke-RestMethod -Uri $embeddingUrl -Method Post -Headers $headers -Body $body -ErrorAction Stop
        if ($response.data -and $response.data.Count -gt 0) {
            return $response.data[0].embedding
        }
        return $null
    }
    catch {
        $errorMsg = $_.Exception.Message
        $statusCode = $null
        
        # Try to get status code
        try {
            $statusCode = $_.Exception.Response.StatusCode.value__
        } catch {
            # Status code not available, check error message
            if ($errorMsg -like "*429*" -or $errorMsg -like "*Too Many Requests*") {
                $statusCode = 429
            } elseif ($errorMsg -like "*400*" -or $errorMsg -like "*Bad Request*") {
                $statusCode = 400
            }
        }
        
        # Handle rate limiting with exponential backoff
        if ($statusCode -eq 429 -and $RetryCount -lt 3) {
            $waitTime = [Math]::Pow(2, $RetryCount) * 2  # 2, 4, 8 seconds
            Write-Host "    [RETRY] Rate limited, waiting $waitTime seconds..." -ForegroundColor Yellow
            Start-Sleep -Seconds $waitTime
            return Generate-Embedding -Text $Text -Endpoint $Endpoint -Key $Key -Deployment $Deployment -RetryCount ($RetryCount + 1)
        }
        
        Write-Host "    [ERROR] Embedding failed: $errorMsg" -ForegroundColor Red
        return $null
    }
}

$processed = 0
$failed = 0
$docIndex = 0

foreach ($doc in $documents) {
    $docIndex++
    
    # Validate document has content
    if (-not $doc.content -or $doc.content.Length -lt 10) {
        Write-Host "    [SKIP] Document $docIndex has no content" -ForegroundColor Yellow
        $failed++
        continue
    }
    
    $embedding = Generate-Embedding -Text $doc.content -Endpoint $openAIEndpoint -Key $openAIKey -Deployment $embeddingDeployment
    
    if ($embedding) {
        $doc | Add-Member -NotePropertyName "contentVector" -NotePropertyValue $embedding -Force
        $processed++
    } else {
        $failed++
    }
    
    # Progress update
    if ($docIndex % 5 -eq 0) {
        Write-Host "  Progress: $processed/$docIndex embeddings generated..." -ForegroundColor Gray
    }
    
    # Rate limiting - wait longer to avoid 429 errors
    Start-Sleep -Milliseconds 200  # Increased from 50ms to 200ms
}

Write-Host "  [OK] Generated $processed/$($documents.Count) embeddings ($failed failed)" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Yellow" })
Write-Host ""

# Upload to Azure AI Search
Write-Host "[4/4] Uploading to Azure AI Search..." -ForegroundColor Yellow

$searchHeaders = @{
    "Content-Type" = "application/json"
    "api-key" = $searchKey
}

$batchSize = 50  # Reduced batch size for more reliable uploads
$totalUploaded = 0
$totalFailed = 0

for ($i = 0; $i -lt $documents.Count; $i += $batchSize) {
    $batch = $documents[$i..([Math]::Min($i + $batchSize - 1, $documents.Count - 1))]
    
    $uploadDocs = @()
    foreach ($doc in $batch) {
        # Validate required fields
        if (-not $doc.id) {
            Write-Host "    [SKIP] Document missing ID" -ForegroundColor Yellow
            continue
        }
        
        if (-not $doc.content -or $doc.content.Length -lt 10) {
            Write-Host "    [SKIP] Document $($doc.id) has no content" -ForegroundColor Yellow
            continue
        }
        
        # CRITICAL: Sanitize ALL text fields before JSON conversion (matching PDF processing)
        $sanitizedContent = Sanitize-TextForIndexing -Text ($doc.content.Substring(0, [Math]::Min(50000, $doc.content.Length)))
        $sanitizedTitle = if ($doc.title) { Sanitize-TextForIndexing -Text ($doc.title.Substring(0, [Math]::Min(1000, $doc.title.Length))) } else { "Untitled" }
        $sanitizedUrl = if ($doc.url) { $doc.url } else { "" }
        $sanitizedDocumentId = if ($doc.documentId) { $doc.documentId } else { $doc.url }
        $sanitizedSource = if ($doc.url) { $doc.url } else { "" }
        
        # Build metadata object (matching PDF processing - publicationYear goes in metadata, not as separate field)
        # CRITICAL: ConvertFrom-Json returns PSObject, not hashtable - must convert to hashtable for indexing
        $metadataObj = @{}
        if ($doc.metadata) {
            if ($doc.metadata -is [string]) {
                try {
                    $parsedMetadata = $doc.metadata | ConvertFrom-Json
                    # Convert PSObject to hashtable
                    $metadataObj = @{}
                    $parsedMetadata.PSObject.Properties | ForEach-Object {
                        $metadataObj[$_.Name] = $_.Value
                    }
                } catch {
                    # If parsing fails, create new metadata object
                    $metadataObj = @{}
                }
            } elseif ($doc.metadata -is [hashtable]) {
                $metadataObj = $doc.metadata
            } else {
                # Convert PSObject to hashtable
                $metadataObj = @{}
                $doc.metadata.PSObject.Properties | ForEach-Object {
                    $metadataObj[$_.Name] = $_.Value
                }
            }
        }
        
        # Add publicationYear to metadata (not as separate field - index doesn't have it)
        if ($doc.publicationYear) {
            $metadataObj["publicationYear"] = $doc.publicationYear
        }
        
        # CRITICAL: Web content is LIVE - ensure freshness tracking is updated
        # Update lastScraped timestamp to current time (content may have changed)
        $metadataObj["lastScraped"] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        $metadataObj["isLiveData"] = $true  # Mark as live/changeable content
        if (-not $metadataObj.ContainsKey("dataSource")) {
            $metadataObj["dataSource"] = "web-scraper"
        }
        
        # Sanitize metadata JSON string
        $sanitizedMetadata = $null
        if ($metadataObj.Count -gt 0) {
            try {
                $metadataJson = $metadataObj | ConvertTo-Json -Compress
                $sanitizedMetadata = Sanitize-TextForIndexing -Text $metadataJson
            } catch {
                $sanitizedMetadata = $null
            }
        }
        
        $uploadDoc = @{
            "@search.action" = "mergeOrUpload"  # Use mergeOrUpload to avoid duplicates
            "id" = $doc.id
            "content" = $sanitizedContent
            "title" = $sanitizedTitle
            "url" = $sanitizedUrl
            "documentId" = $sanitizedDocumentId
            "documentType" = "web"
            "source" = $sanitizedSource
            "chunkIndex" = if ($doc.chunkIndex -ne $null) { $doc.chunkIndex } else { 0 }
            "pageNumber" = if ($doc.pageNumber -ne $null) { $doc.pageNumber } else { 1 }
            "category" = if ($doc.category) { $doc.category } else { "government-document" }
            "sector" = if ($doc.sector) { $doc.sector } else { "general" }
            "tags" = if ($doc.tags) { $doc.tags } else { @() }
            "metadata" = $sanitizedMetadata
            # CRITICAL: Web content is LIVE - always update indexedAt to current time
            # This ensures we know when content was last refreshed (vs static PDFs)
            "indexedAt" = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
        
        # Only add contentVector if it exists and is valid
        if ($doc.contentVector -and $doc.contentVector.Count -gt 0) {
            $uploadDoc["contentVector"] = $doc.contentVector
        }
        
        $uploadDocs += $uploadDoc
    }
    
    if ($uploadDocs.Count -eq 0) {
        Write-Host "  [SKIP] Batch $($i / $batchSize + 1) has no valid documents" -ForegroundColor Yellow
        continue
    }
    
    try {
        # CRITICAL: Ensure proper UTF-8 encoding for JSON conversion
        # Convert to JSON with proper encoding handling
        $body = @{
            value = $uploadDocs
        } | ConvertTo-Json -Depth 10 -Compress
        
        # Validate JSON can be encoded as UTF-8
        try {
            $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
            $body = [System.Text.Encoding]::UTF8.GetString($utf8Bytes)
        } catch {
            Write-Host "  [WARN] JSON encoding validation failed, attempting to continue..." -ForegroundColor Yellow
        }
        
        $indexUrl = "$searchEndpoint/indexes/$SearchIndexName/docs/index?api-version=2023-11-01"
        $response = Invoke-RestMethod -Uri $indexUrl -Method Post -Headers $searchHeaders -Body $body -ErrorAction Stop
        
        $batchUploaded = $uploadDocs.Count
        $totalUploaded += $batchUploaded
        Write-Host "  [OK] Uploaded batch: $totalUploaded/$($documents.Count) documents" -ForegroundColor Green
    }
    catch {
        $errorMsg = $_.Exception.Message
        $totalFailed += $uploadDocs.Count
        
        # Try to get more detailed error
        try {
            $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
            $errorDetails = $errorResponse.error.message
        } catch {
            $errorDetails = $errorMsg
        }
        
        Write-Host "  [FAIL] Batch upload failed: $errorDetails" -ForegroundColor Red
        
        # If it's a validation error, try uploading documents one by one
        if ($errorMsg -like "*validation*" -or $errorMsg -like "*400*") {
            Write-Host "    Trying individual uploads for this batch..." -ForegroundColor Yellow
            foreach ($singleDoc in $uploadDocs) {
                try {
                    $singleBody = @{ value = @($singleDoc) } | ConvertTo-Json -Depth 10
                    $singleResponse = Invoke-RestMethod -Uri $indexUrl -Method Post -Headers $searchHeaders -Body $singleBody -ErrorAction Stop
                    $totalUploaded++
                    $totalFailed--
                } catch {
                    Write-Host "      Failed to upload document: $($singleDoc.id)" -ForegroundColor Red
                }
            }
        }
        
        # Small delay between batches
        Start-Sleep -Milliseconds 500
    }
}

# Summary
Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Upload Complete" -ForegroundColor Green
Write-Host "════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Documents uploaded: $totalUploaded/$($documents.Count)" -ForegroundColor $(if ($totalUploaded -eq $documents.Count) { "Green" } else { "Yellow" })
if ($totalFailed -gt 0) {
    Write-Host "  Documents failed: $totalFailed" -ForegroundColor Red
}
Write-Host "  Index: $SearchIndexName" -ForegroundColor White
Write-Host "  Embeddings: $processed/$($documents.Count) documents have embeddings" -ForegroundColor $(if ($processed -eq $documents.Count) { "Green" } else { "Yellow" })
Write-Host ""
if ($totalUploaded -gt 0) {
    Write-Host "  Content uploaded to Azure AI Search successfully!" -ForegroundColor Cyan
}
Write-Host ""

