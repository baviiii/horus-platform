# ============================================================================
# GRAPH POPULATION SCRIPT
# Extracts entities from Azure Search chunks and populates Cosmos DB (Gremlin) graph
# Supports both Cosmos DB and Neo4j backends
# Comprehensive audit logging for complete traceability
# ============================================================================

param(
    [int]$BatchSize = 10,
    [int]$StartOffset = 0,
    [int]$MaxBatches = 0,  # 0 = unlimited
    [int]$DelayBetweenBatches = 2,  # seconds
    [switch]$DryRun,
    [switch]$RunPostProcessing,  # Run deduplication and refinement after population
    [switch]$PostProcessingOnly,  # Only run dedupe/canonical/validation; skip all chunk processing
    [string]$DocumentId = ""  # If set, only process chunks from this document (e.g. for impact tuning)
)

$ErrorActionPreference = "Continue"

# ============================================================
# AUDIT LOG SAVE FUNCTION - Can be called on script termination
# ============================================================

function Save-AuditLog {
    param(
        [object]$AuditLog,
        [object]$Stats,
        [string]$LogDir
    )
    
    if (-not $AuditLog -or -not $Stats) {
        return
    }
    
    try {
        # Add final stats to audit log
        $AuditLog.finalStats = $Stats
        $AuditLog.terminatedEarly = $true
        $AuditLog.terminatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        
        # Create logs directory if it doesn't exist
        if (-not (Test-Path $LogDir)) {
            New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
        }
        
        $auditLogPath = Join-Path $LogDir "audit-graph-$(Get-Date -Format 'yyyy-MM-dd-HHmmss')-INTERRUPTED.json"
        $AuditLog | ConvertTo-Json -Depth 10 | Out-File -FilePath $auditLogPath -Encoding UTF8
        
        Write-Host ""
        Write-Host "  [AUDIT LOG SAVED ON INTERRUPT]" -ForegroundColor Yellow
        Write-Host "    Path: $auditLogPath" -ForegroundColor White
        return $auditLogPath
    } catch {
        Write-Host "  [ERROR] Could not save audit log on interrupt: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# ============================================================
# SIGNAL HANDLER - Save audit log on Ctrl+C or termination
# ============================================================

$script:auditLogPath = $null
$script:auditLogDir = Join-Path $PSScriptRoot "logs"

# Register handler for script termination
Register-EngineEvent PowerShell.Exiting -Action {
    if ($script:auditLog -and $script:stats) {
        Save-AuditLog -AuditLog $script:auditLog -Stats $script:stats -LogDir $script:auditLogDir | Out-Null
    }
} | Out-Null

# Handle Ctrl+C gracefully
try {
    [Console]::TreatControlCAsInput = $false
} catch {
    # May fail in some PowerShell hosts (e.g., VS Code terminal), ignore
}
try {
    $null = [Console]::CancelKeyPress += {
        param($sender, $e)
        Write-Host ""
        Write-Host "  [INTERRUPT] Script interrupted by user (Ctrl+C)" -ForegroundColor Yellow
        if ($script:auditLog -and $script:stats) {
            $savedPath = Save-AuditLog -AuditLog $script:auditLog -Stats $script:stats -LogDir $script:auditLogDir
            if ($savedPath) {
                Write-Host "  [SAVED] Partial audit log: $savedPath" -ForegroundColor Green
            }
        }
        Write-Host "  [INFO] Exiting gracefully..." -ForegroundColor Gray
    }
} catch {
    # CancelKeyPress may not be available in all PowerShell hosts (e.g., VS Code terminal)
    # This is non-critical, script will still work
}

# ============================================================
# AUDIT LOG HELPER FUNCTIONS
# ============================================================

function Add-AuditEvent {
    param(
        [string]$Type,       # INFO, WARNING, ERROR, SUCCESS
        [string]$Category,   # batch, chunk, entity, relationship, impact, indexing
        [string]$Message,
        [string]$ChunkId = $null,
        [string]$DocumentId = $null,
        [hashtable]$Details = @{}
    )
    
    $event = @{
        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        type = $Type
        category = $Category
        message = $Message
        chunkId = $ChunkId
        documentId = $DocumentId
        details = $Details
    }
    
    $script:auditLog.events += $event
    
    # Also add to specific lists for easy filtering
    switch ($Type) {
        "WARNING" { $script:auditLog.warnings += $event }
        "ERROR" { $script:auditLog.errors += $event }
    }
}

# ============================================================
# HTTP STATUS CODE EXTRACTION AND ERROR CLASSIFICATION
# ============================================================

function Get-HttpStatusCode {
    param(
        [System.Exception]$Exception
    )
    
    $statusCode = $null
    $errorMessage = $Exception.Message
    
    # Try to extract status code from exception response
    try {
        if ($Exception.Response) {
            $statusCode = [int]$Exception.Response.StatusCode.value__
        }
    } catch {
        # Response exists but StatusCode access might fail
    }
    
    # Fallback: Parse status code from error message
    if (-not $statusCode) {
        if ($errorMessage -match "(\d{3})") {
            $potentialCode = [int]$matches[1]
            if ($potentialCode -ge 400 -and $potentialCode -lt 600) {
                $statusCode = $potentialCode
            }
        }
    }
    
    return $statusCode
}

function Test-IsRetryableError {
    param(
        [int]$StatusCode,
        [string]$ErrorMessage
    )
    
    # Retryable errors: 429 (Rate Limit), 502 (Bad Gateway), 503 (Service Unavailable), timeouts
    if ($StatusCode -eq 429 -or $StatusCode -eq 502 -or $StatusCode -eq 503) {
        return $true
    }
    
    # Check for timeout in error message
    if ($ErrorMessage -match "timeout|timed out|The operation timed out") {
        return $true
    }
    
    # Non-retryable errors: 400, 401, 403, 404, etc.
    if ($StatusCode -in @(400, 401, 403, 404, 413, 422)) {
        return $false
    }
    
    # If status code is unknown, assume retryable for transient network issues
    if ($StatusCode -ge 500) {
        return $true
    }
    
    # Default: not retryable for client errors
    return $false
}

# ============================================================
# RESPONSE VALIDATION
# ============================================================

function Test-EntityExtractionResponse {
    param(
        [object]$Response
    )
    
    if (-not $Response) {
        return @{ valid = $false; error = "Response is null" }
    }
    
    # Check required fields
    $requiredFields = @("processed", "succeeded", "failed", "results", "hasMore", "nextOffset")
    $missingFields = @()
    
    foreach ($field in $requiredFields) {
        if (-not $Response.PSObject.Properties.Name -contains $field) {
            $missingFields += $field
        }
    }
    
    if ($missingFields.Count -gt 0) {
        return @{ 
            valid = $false
            error = "Missing required fields: $($missingFields -join ', ')"
        }
    }
    
    # Validate results is an array
    if (-not ($Response.results -is [array])) {
        return @{
            valid = $false
            error = "Results field is not an array"
        }
    }
    
    return @{ valid = $true }
}

# ============================================================
# RETRY LOGIC WITH EXPONENTIAL BACKOFF
# ============================================================

function Invoke-EntityExtractionWithRetry {
    param(
        [string]$Uri,
        [hashtable]$Headers,
        [string]$Body,
        [int]$MaxRetries = 5,
        [int]$InitialBackoff = 2
    )
    
    $retryCount = 0
    $lastError = $null
    $lastStatusCode = $null
    
    while ($retryCount -le $MaxRetries) {
        try {
            $script:stats.TotalApiCalls++
            $response = Invoke-RestMethod -Uri $Uri -Method POST -Headers $Headers -Body $Body -TimeoutSec 300
            
            # If we had retries, log success
            if ($retryCount -gt 0) {
                Write-Host "      [SUCCESS] Request succeeded after $retryCount retry attempts" -ForegroundColor Green
                $script:stats.TotalRetryAttempts += $retryCount
            }
            
            return $response
            
        } catch {
            $lastError = $_.Exception
            $errorMessage = $lastError.Message
            $lastStatusCode = Get-HttpStatusCode -Exception $lastError
            $isRetryable = Test-IsRetryableError -StatusCode $lastStatusCode -ErrorMessage $errorMessage
            
            # If not retryable, throw immediately
            if (-not $isRetryable) {
                Write-Host "      [ERROR] Non-retryable error (HTTP $lastStatusCode): $errorMessage" -ForegroundColor Red
                throw $lastError
            }
            
            # If we've exhausted retries, throw
            if ($retryCount -ge $MaxRetries) {
                Write-Host "      [ERROR] Max retries ($MaxRetries) exceeded. Last error (HTTP $lastStatusCode): $errorMessage" -ForegroundColor Red
                throw $lastError
            }
            
            # Calculate backoff time
            $backoffTime = $InitialBackoff * [Math]::Pow(2, $retryCount)
            
            # Special handling for rate limits (429) - longer backoff
            if ($lastStatusCode -eq 429) {
                $script:stats.RateLimitHits++
                $backoffTime = [Math]::Max($backoffTime, 60)  # At least 60 seconds for rate limits
                Write-Host "      [RATE LIMIT] HTTP 429 detected. Waiting ${backoffTime}s before retry ($($retryCount + 1)/$MaxRetries)..." -ForegroundColor Yellow
                Add-AuditEvent -Type "WARNING" -Category "batch" -Message "Rate limit hit (HTTP 429), waiting ${backoffTime}s" -Details @{
                    statusCode = 429
                    retryAttempt = $retryCount + 1
                    backoffTime = $backoffTime
                }
            } else {
                Write-Host "      [RETRY] HTTP $lastStatusCode detected. Waiting ${backoffTime}s before retry ($($retryCount + 1)/$MaxRetries)..." -ForegroundColor Yellow
                Add-AuditEvent -Type "WARNING" -Category "batch" -Message "Transient error (HTTP $lastStatusCode), retrying" -Details @{
                    statusCode = $lastStatusCode
                    retryAttempt = $retryCount + 1
                    backoffTime = $backoffTime
                }
            }
            
            $script:stats.RetryAttempts++
            $script:stats.TotalRetryAttempts++
            Start-Sleep -Seconds $backoffTime
            $retryCount++
        }
    }
    
    # Should never reach here, but just in case
    throw $lastError
}

# Load environment variables
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
}

# Configuration
$EntityExtractionUrl = $env:VITE_AZURE_ENTITY_EXTRACTION_URL
$FunctionKey = $env:VITE_AZURE_FUNCTION_KEY

if (-not $EntityExtractionUrl) {
    # Fallback to constructing URL from functions URL
    $FunctionsUrl = $env:VITE_AZURE_FUNCTIONS_URL
    if ($FunctionsUrl) {
        $EntityExtractionUrl = "$FunctionsUrl/api/entity-extraction"
    } else {
        Write-Error "Entity extraction URL not configured. Set VITE_AZURE_ENTITY_EXTRACTION_URL in .env"
        exit 1
    }
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  GRAPH POPULATION SCRIPT" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Configuration:"
Write-Host "  - Entity Extraction URL: $EntityExtractionUrl"
Write-Host "  - Batch Size: $BatchSize"
Write-Host "  - Starting Offset: $StartOffset"
Write-Host "  - Max Batches: $(if ($MaxBatches -eq 0) { 'Unlimited' } else { $MaxBatches })"
Write-Host "  - Delay Between Batches: ${DelayBetweenBatches}s"
Write-Host "  - Dry Run: $DryRun"
Write-Host "  - Post-Processing: $RunPostProcessing"
Write-Host "  - Post-Processing Only: $PostProcessingOnly"
if ($DocumentId) {
    Write-Host "  - Document filter: $DocumentId (only this document's chunks)" -ForegroundColor Cyan
}
Write-Host ""

if ($PostProcessingOnly) {
    Write-Host "  POST-PROCESSING ONLY - Skipping all chunk processing (dedupe + canonical + validation only)." -ForegroundColor Cyan
    Write-Host ""
}

if ($DryRun) {
    Write-Host "DRY RUN MODE - No actual API calls will be made" -ForegroundColor Yellow
    Write-Host ""
}

# ============================================================
# AUDIT LOG - Complete Processing History
# ============================================================
# Store in script scope for signal handler access
$script:auditLog = @{
    startTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    endTime = $null
    terminatedEarly = $false
    terminatedAt = $null
    configuration = @{
        batchSize = $BatchSize
        startOffset = $StartOffset
        maxBatches = $MaxBatches
        delayBetweenBatches = $DelayBetweenBatches
        dryRun = $DryRun.IsPresent
        runPostProcessing = $RunPostProcessing.IsPresent
        postProcessingOnly = $PostProcessingOnly.IsPresent
        documentIdFilter = if ($DocumentId) { $DocumentId.Trim() } else { $null }
        entityExtractionUrl = $EntityExtractionUrl
    }
    
    # Detailed event logs
    events = @()
    
    # Per-batch tracking
    batches = @()
    
    # Per-chunk tracking
    chunks = @()
    
    # Warnings and errors
    warnings = @()
    errors = @()
    failedChunks = @()
    
    # Progress checkpointing
    lastSuccessfulOffset = $StartOffset
    lastSuccessfulBatch = 0
    resumeCommand = $null
    
    # Statistics (populated at end)
    statistics = @{}
}

# ============================================================
# ENHANCED STATISTICS TRACKING
# ============================================================
# Store in script scope for signal handler access
$script:stats = @{
    TotalProcessed = 0
    TotalSucceeded = 0
    TotalFailed = 0
    TotalEntities = 0
    TotalRelationships = 0
    TotalImpacts = 0
    TotalEntitiesIndexed = 0
    TotalEntitiesIndexSkipped = 0
    TotalBatches = 0
    DuplicateEntitiesSkipped = 0
    CanonicalEntitiesCreated = 0
    IndexingFailures = 0
    TotalApiCalls = 0
    RateLimitHits = 0
    RetryAttempts = 0
    TotalRetryAttempts = 0
    ConsecutiveFailures = 0
    AverageBatchTime = 0
    BatchTimes = @()  # Track batch times for average calculation
    StartTime = Get-Date
    # Relationship resolution stats
    RelationshipsCreated = 0
    RelationshipsResolvedViaGraph = 0
    RelationshipsResolvedViaSemantic = 0
    RelationshipsSkipped = 0
    # Embedding retry stats
    TotalEmbeddingRetries = 0
    # Impact edge resolution stats
    ImpactEdgesCreated = 0
    ImpactEdgesSkipped = 0
    ImpactEdgesResolvedViaGraph = 0
    ImpactEdgesResolvedViaSemantic = 0
}

# Alias for backward compatibility
$stats = $script:stats

# Headers
$headers = @{
    "Content-Type" = "application/json"
}
if ($FunctionKey) {
    $headers["x-functions-key"] = $FunctionKey
}

# Adaptive delay tracking
$currentDelay = $DelayBetweenBatches
$consecutiveRateLimitHits = 0
$maxConsecutiveFailures = 5

$currentOffset = $StartOffset
$batchCount = 0
$hasMore = $true

if (-not $PostProcessingOnly) {
while ($hasMore) {
    $batchCount++
    $script:stats.TotalBatches = $batchCount
    $batchStartTime = Get-Date
    
    if ($MaxBatches -gt 0 -and $batchCount -gt $MaxBatches) {
        Write-Host ""
        Write-Host "Reached max batch limit ($MaxBatches). Stopping." -ForegroundColor Yellow
        Add-AuditEvent -Type "INFO" -Category "batch" -Message "Reached max batch limit ($MaxBatches)"
        break
    }
    
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "[Batch $batchCount] Processing chunks offset $currentOffset to $($currentOffset + $BatchSize - 1)..." -ForegroundColor White
    
    # AUDIT: Log batch start
    $batchRecord = @{
        batchNumber = $batchCount
        offset = $currentOffset
        startTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        processed = 0
        succeeded = 0
        failed = 0
        executionTime = 0
        entitiesExtracted = 0
        relationshipsExtracted = 0
        impactsExtracted = 0
        entitiesIndexed = 0
        chunks = @()
    }
    
    if ($DryRun) {
        Write-Host "  [DRY RUN] Would process chunks $currentOffset to $($currentOffset + $BatchSize - 1)" -ForegroundColor Yellow
        Add-AuditEvent -Type "INFO" -Category "batch" -Message "Dry run batch $batchCount" -Details @{ offset = $currentOffset }
        $currentOffset += $BatchSize
        $hasMore = $batchCount -lt 3  # Simulate 3 batches for dry run
        Start-Sleep -Seconds 1
        continue
    }
    
    try {
        $bodyHash = @{
            mode = "batch"
            batchSize = $BatchSize
            offset = $currentOffset
        }
        if ($DocumentId -and $DocumentId.Trim()) {
            $bodyHash["documentIdFilter"] = $DocumentId.Trim()
        }
        $body = $bodyHash | ConvertTo-Json
        
        # Use retry wrapper function
        $response = Invoke-EntityExtractionWithRetry -Uri $EntityExtractionUrl -Headers $headers -Body $body
        
        # Validate response structure
        $validation = Test-EntityExtractionResponse -Response $response
        if (-not $validation.valid) {
            throw "Invalid response structure: $($validation.error)"
        }
        
        $batchEndTime = Get-Date
        $batchExecutionTime = ($batchEndTime - $batchStartTime).TotalMilliseconds
        
        # Track batch time for average calculation
        $script:stats.BatchTimes += $batchExecutionTime
        if ($script:stats.BatchTimes.Count -gt 0) {
            $script:stats.AverageBatchTime = ($script:stats.BatchTimes | Measure-Object -Average).Average
        }
        
        # Reset consecutive failures on success
        $script:stats.ConsecutiveFailures = 0
        $consecutiveRateLimitHits = 0
        
        # Reset delay if no rate limits in recent batches
        if ($script:stats.RateLimitHits -eq 0 -or ($batchCount % 5 -eq 0)) {
            $currentDelay = $DelayBetweenBatches
        }
        
        # Update statistics
        $script:stats.TotalProcessed += $response.processed
        $script:stats.TotalSucceeded += $response.succeeded
        $script:stats.TotalFailed += $response.failed
        
        # Update batch record
        $batchRecord.processed = $response.processed
        $batchRecord.succeeded = $response.succeeded
        $batchRecord.failed = $response.failed
        $batchRecord.executionTime = $batchExecutionTime
        $batchRecord.endTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        
        # Process each chunk result
        foreach ($result in $response.results) {
            # AUDIT: Track per-chunk details
            $chunkRecord = @{
                chunkId = $result.chunkId
                documentId = $result.documentId
                success = $result.success
                timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            }
            
            if ($result.success) {
                $chunkRecord.entitiesExtracted = $result.entitiesExtracted
                $chunkRecord.relationshipsExtracted = $result.relationshipsExtracted
                $chunkRecord.impactsExtracted = if ($result.impactsExtracted) { $result.impactsExtracted } else { 0 }
                $chunkRecord.entitiesIndexed = if ($result.entitiesIndexed) { $result.entitiesIndexed } else { 0 }
                # Relationship resolution details
                $chunkRecord.relationshipsCreated = if ($result.relationshipsCreated) { $result.relationshipsCreated } else { 0 }
                $chunkRecord.relationshipsResolved = if ($result.relationshipsResolved) { $result.relationshipsResolved } else { 0 }
                $chunkRecord.relationshipsSkipped = if ($result.relationshipsSkipped) { $result.relationshipsSkipped } else { 0 }
                $chunkRecord.relationshipsSkippedDetails = $result.relationshipsSkippedDetails
                # Entity indexing details
                $chunkRecord.entitiesIndexSkipped = if ($result.entitiesIndexSkipped) { $result.entitiesIndexSkipped } else { 0 }
                $chunkRecord.entitiesIndexSkippedDetails = $result.entitiesIndexSkippedDetails
                $chunkRecord.entitiesIndexEmbeddingRetries = if ($result.entitiesIndexEmbeddingRetries) { $result.entitiesIndexEmbeddingRetries } else { 0 }
                # Impact edge resolution details
                $chunkRecord.impactEdgesCreated = if ($result.impactEdgesCreated) { $result.impactEdgesCreated } else { 0 }
                $chunkRecord.impactEdgesSkipped = if ($result.impactEdgesSkipped) { $result.impactEdgesSkipped } else { 0 }
                $chunkRecord.impactEdgesSkippedDetails = $result.impactEdgesSkippedDetails
                
                # Update statistics
                $script:stats.TotalEntities += $result.entitiesExtracted
                $script:stats.TotalRelationships += $result.relationshipsExtracted
                $script:stats.TotalImpacts += $chunkRecord.impactsExtracted
                $script:stats.TotalEntitiesIndexed += $chunkRecord.entitiesIndexed
                $script:stats.TotalEntitiesIndexSkipped += $chunkRecord.entitiesIndexSkipped
                $script:stats.RelationshipsCreated += $chunkRecord.relationshipsCreated
                $rResolvedGraph = if ($result.relationshipsResolvedViaGraph) { $result.relationshipsResolvedViaGraph } else { 0 }
                $rResolvedSemantic = if ($result.relationshipsResolvedViaSemantic) { $result.relationshipsResolvedViaSemantic } else { 0 }
                $script:stats.RelationshipsResolvedViaGraph += $rResolvedGraph
                $script:stats.RelationshipsResolvedViaSemantic += $rResolvedSemantic
                $script:stats.RelationshipsSkipped += $chunkRecord.relationshipsSkipped
                $script:stats.TotalEmbeddingRetries += $chunkRecord.entitiesIndexEmbeddingRetries
                $script:stats.ImpactEdgesCreated += $chunkRecord.impactEdgesCreated
                $script:stats.ImpactEdgesSkipped += $chunkRecord.impactEdgesSkipped
                $iResolvedGraph = if ($result.impactEdgesResolvedViaGraph) { $result.impactEdgesResolvedViaGraph } else { 0 }
                $iResolvedSemantic = if ($result.impactEdgesResolvedViaSemantic) { $result.impactEdgesResolvedViaSemantic } else { 0 }
                $script:stats.ImpactEdgesResolvedViaGraph += $iResolvedGraph
                $script:stats.ImpactEdgesResolvedViaSemantic += $iResolvedSemantic
                
                # Update batch totals
                $batchRecord.entitiesExtracted += $result.entitiesExtracted
                $batchRecord.relationshipsExtracted += $result.relationshipsExtracted
                $batchRecord.impactsExtracted += $chunkRecord.impactsExtracted
                $batchRecord.entitiesIndexed += $chunkRecord.entitiesIndexed
                
                # Console output with resolution details
                $relDetail = "$($chunkRecord.relationshipsCreated) created"
                if ($chunkRecord.relationshipsResolved -gt 0) { $relDetail += ", $($chunkRecord.relationshipsResolved) resolved" }
                if ($chunkRecord.relationshipsSkipped -gt 0) { $relDetail += ", $($chunkRecord.relationshipsSkipped) skipped" }
                $impDetail = "$($chunkRecord.impactsExtracted) impacts"
                if ($chunkRecord.impactEdgesCreated -gt 0) { $impDetail += " ($($chunkRecord.impactEdgesCreated) edges" }
                if ($chunkRecord.impactEdgesSkipped -gt 0) { $impDetail += ", $($chunkRecord.impactEdgesSkipped) edge-skipped" }
                if ($chunkRecord.impactEdgesCreated -gt 0 -or $chunkRecord.impactEdgesSkipped -gt 0) { $impDetail += ")" }
                $idxDetail = "$($chunkRecord.entitiesIndexed) indexed"
                if ($chunkRecord.entitiesIndexSkipped -gt 0) { $idxDetail += ", $($chunkRecord.entitiesIndexSkipped) skipped" }
                Write-Host "  [OK] Chunk $($result.chunkId): $($result.entitiesExtracted) entities, $($result.relationshipsExtracted) rels ($relDetail), $impDetail, $idxDetail" -ForegroundColor Green
                
                # Warn about skipped relationships
                if ($chunkRecord.relationshipsSkipped -gt 0 -and $result.relationshipsSkippedDetails) {
                    foreach ($skip in $result.relationshipsSkippedDetails) {
                        Write-Host "    [SKIP REL] $($skip.source) -[$($skip.type)]-> $($skip.target) (missing: $($skip.missingSide))" -ForegroundColor DarkYellow
                    }
                }
                
                # Warn about skipped impact edges
                if ($chunkRecord.impactEdgesSkipped -gt 0 -and $result.impactEdgesSkippedDetails) {
                    foreach ($skip in $result.impactEdgesSkippedDetails) {
                        Write-Host "    [SKIP IMPACT] $($skip.edgeType): $($skip.missingEntity) (side: $($skip.side))" -ForegroundColor DarkYellow
                    }
                }
                
                # Warn about skipped entity indexing
                if ($chunkRecord.entitiesIndexSkipped -gt 0 -and $result.entitiesIndexSkippedDetails) {
                    foreach ($skip in $result.entitiesIndexSkippedDetails) {
                        Write-Host "    [SKIP IDX] $($skip.name): $($skip.reason)" -ForegroundColor DarkYellow
                    }
                }
                
                Add-AuditEvent -Type "SUCCESS" -Category "chunk" -Message "Chunk processed successfully" -ChunkId $result.chunkId -DocumentId $result.documentId -Details $chunkRecord
            } else {
                $chunkRecord.error = $result.error
                
                # AUDIT: Track failed chunk
                $script:auditLog.failedChunks += @{
                    chunkId = $result.chunkId
                    documentId = $result.documentId
                    error = $result.error
                    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                }
                
                Write-Host "  [FAIL] Chunk $($result.chunkId): Failed - $($result.error)" -ForegroundColor Red
                
                Add-AuditEvent -Type "ERROR" -Category "chunk" -Message "Chunk processing failed: $($result.error)" -ChunkId $result.chunkId -DocumentId $result.documentId -Details $chunkRecord
            }
            
            # Add to batch and audit log
            $batchRecord.chunks += $chunkRecord
            $script:auditLog.chunks += $chunkRecord
        }
        
        # Add batch record to audit log
        $script:auditLog.batches += $batchRecord
        
        # Update checkpoint
        if ($response.succeeded -gt 0) {
            $script:auditLog.lastSuccessfulOffset = $currentOffset
            $script:auditLog.lastSuccessfulBatch = $batchCount
        }
        
        # Incremental audit save: write audit log to disk every 10 batches
        # so data is never lost even if Ctrl+C handler fails
        if ($batchCount % 10 -eq 0) {
            try {
                if (-not (Test-Path $script:auditLogDir)) {
                    New-Item -ItemType Directory -Path $script:auditLogDir -Force | Out-Null
                }
                $incrementalPath = Join-Path $script:auditLogDir "audit-graph-INPROGRESS.json"
                $script:auditLog.finalStats = $script:stats
                $script:auditLog.lastSavedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                $script:auditLog | ConvertTo-Json -Depth 10 | Out-File -FilePath $incrementalPath -Encoding UTF8
            } catch {
                # Non-fatal: just continue
            }
        }
        
        # Append skipped relationships to a separate file immediately (never lost)
        if ($batchRecord.chunks) {
            foreach ($cr in $batchRecord.chunks) {
                if ($cr.relationshipsSkippedDetails -and $cr.relationshipsSkippedDetails.Count -gt 0) {
                    try {
                        if (-not (Test-Path $script:auditLogDir)) {
                            New-Item -ItemType Directory -Path $script:auditLogDir -Force | Out-Null
                        }
                        $skippedFile = Join-Path $script:auditLogDir "skipped-relationships-INPROGRESS.jsonl"
                        foreach ($skip in $cr.relationshipsSkippedDetails) {
                            $entry = @{
                                source = $skip.source
                                target = $skip.target
                                type = $skip.type
                                missingSide = $skip.missingSide
                                documentId = $cr.documentId
                                chunkId = $cr.chunkId
                            } | ConvertTo-Json -Compress
                            $entry | Out-File -FilePath $skippedFile -Encoding UTF8 -Append
                        }
                    } catch {
                        # Non-fatal
                    }
                }
                if ($cr.impactEdgesSkippedDetails -and $cr.impactEdgesSkippedDetails.Count -gt 0) {
                    try {
                        $skippedImpactFile = Join-Path $script:auditLogDir "skipped-impact-edges-INPROGRESS.jsonl"
                        foreach ($skip in $cr.impactEdgesSkippedDetails) {
                            $entry = @{
                                impactId = $skip.impactId
                                edgeType = $skip.edgeType
                                missingEntity = $skip.missingEntity
                                side = $skip.side
                            } | ConvertTo-Json -Compress
                            $entry | Out-File -FilePath $skippedImpactFile -Encoding UTF8 -Append
                        }
                    } catch {
                        # Non-fatal
                    }
                }
            }
        }
        
        # Calculate progress and ETA
        $avgBatchTimeSeconds = $script:stats.AverageBatchTime / 1000
        $progressInfo = ""
        if ($hasMore -and $avgBatchTimeSeconds -gt 0) {
            $estimatedRemainingBatches = if ($MaxBatches -gt 0) { 
                [Math]::Max(0, $MaxBatches - $batchCount) 
            } else { 
                "unknown" 
            }
            if ($estimatedRemainingBatches -ne "unknown" -and $estimatedRemainingBatches -gt 0) {
                $estimatedSeconds = $estimatedRemainingBatches * ($avgBatchTimeSeconds + $currentDelay)
                $eta = [TimeSpan]::FromSeconds($estimatedSeconds)
                $progressInfo = " | ETA: $($eta.ToString('hh\:mm\:ss'))"
            }
        }
        
        # Log batch results
        Write-Host "  [BATCH SUMMARY] Processed: $($response.processed) | Succeeded: $($response.succeeded) | Failed: $($response.failed)" -ForegroundColor $(if ($response.failed -gt 0) { "Yellow" } else { "Green" })
        Write-Host "                  Entities: $($batchRecord.entitiesExtracted) | Relationships: $($batchRecord.relationshipsExtracted) | Impacts: $($batchRecord.impactsExtracted)" -ForegroundColor Cyan
        Write-Host "                  Execution Time: $([math]::Round($batchExecutionTime, 0))ms (Avg: $([math]::Round($script:stats.AverageBatchTime, 0))ms)$progressInfo" -ForegroundColor DarkGray
        
        # Check if there are more chunks
        $hasMore = $response.hasMore
        $currentOffset = $response.nextOffset
        
        if (-not $hasMore) {
            Write-Host ""
            Write-Host "No more chunks to process." -ForegroundColor Cyan
            Add-AuditEvent -Type "INFO" -Category "batch" -Message "No more chunks to process"
        }
        
    } catch {
        $errorMsg = $_.Exception.Message
        $statusCode = Get-HttpStatusCode -Exception $_.Exception
        $isRetryable = Test-IsRetryableError -StatusCode $statusCode -ErrorMessage $errorMsg
        
        # Track consecutive failures
        $script:stats.ConsecutiveFailures++
        $script:stats.TotalFailed += $BatchSize
        
        # Enhanced error message with status code
        $errorDisplay = if ($statusCode) {
            "HTTP ${statusCode}: $errorMsg"
        } else {
            $errorMsg
        }
        
        $errorType = if ($isRetryable) { "Transient" } else { "Permanent" }
        Write-Host "  [ERROR] Batch $batchCount failed ($errorType): $errorDisplay" -ForegroundColor Red
        
        # AUDIT: Track batch error with status code
        $batchRecord.failed = $BatchSize
        $batchRecord.error = $errorDisplay
        $batchRecord.statusCode = $statusCode
        $batchRecord.isRetryable = $isRetryable
        $batchRecord.endTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        $script:auditLog.batches += $batchRecord
        
        Add-AuditEvent -Type "ERROR" -Category "batch" -Message "Batch $batchCount failed ($errorType): $errorDisplay" -Details @{
            offset = $currentOffset
            batchSize = $BatchSize
            error = $errorDisplay
            statusCode = $statusCode
            isRetryable = $isRetryable
            consecutiveFailures = $script:stats.ConsecutiveFailures
        }
        
        # Increase delay after failures (especially rate limits)
        if ($statusCode -eq 429) {
            $consecutiveRateLimitHits++
            $currentDelay = [Math]::Min($currentDelay * 2, 120)  # Cap at 120 seconds
            Write-Host "  [INFO] Increased delay to ${currentDelay}s due to rate limit" -ForegroundColor Yellow
        } elseif ($script:stats.ConsecutiveFailures -gt 2) {
            $currentDelay = [Math]::Min($currentDelay * 1.5, 60)  # Cap at 60 seconds
        }
        
        # Continue to next batch
        $currentOffset += $BatchSize
        
        # Stop if too many consecutive failures
        if ($script:stats.ConsecutiveFailures -ge $maxConsecutiveFailures) {
            Write-Host "  [FATAL] Too many consecutive failures ($($script:stats.ConsecutiveFailures)). Stopping." -ForegroundColor Red
            Write-Host "          Check your configuration and try again." -ForegroundColor Yellow
            Write-Host "          Last error: $errorDisplay" -ForegroundColor Gray
            Add-AuditEvent -Type "ERROR" -Category "batch" -Message "Too many consecutive failures ($($script:stats.ConsecutiveFailures)), stopping"
            break
        }
        
        # Also stop if initial batches all fail (original logic)
        if ($batchCount -gt 3 -and $script:stats.TotalSucceeded -eq 0) {
            Write-Host "  [FATAL] No successful batches after $batchCount attempts. Stopping." -ForegroundColor Red
            Write-Host "          Check your configuration and try again." -ForegroundColor Yellow
            Add-AuditEvent -Type "ERROR" -Category "batch" -Message "No successful batches after $batchCount attempts, stopping"
            break
        }
    }
    
    # Adaptive delay between batches to avoid rate limiting
    if ($hasMore) {
        $delayMessage = "Waiting ${currentDelay}s before next batch"
        if ($currentDelay -gt $DelayBetweenBatches) {
            $delayMessage += " (increased due to rate limits/failures)"
        }
        Write-Host "  $delayMessage..." -ForegroundColor DarkGray
        Start-Sleep -Seconds $currentDelay
    }
}

# ============================================================
# FINALIZE AUDIT LOG
# ============================================================

$script:auditLog.endTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$script:auditLog.terminatedEarly = $false

# Generate resume command
$resumeDocParam = if ($DocumentId -and $DocumentId.Trim()) { " -DocumentId '$($DocumentId.Trim())'" } else { "" }
if ($script:auditLog.lastSuccessfulOffset -gt $StartOffset) {
    $offset = $script:auditLog.lastSuccessfulOffset
    $script:auditLog.resumeCommand = ".\populate-graph.ps1 -StartOffset $offset$resumeDocParam"
} else {
    $offset = if ($null -ne $currentOffset) { $currentOffset } else { $StartOffset }
    $script:auditLog.resumeCommand = ".\populate-graph.ps1 -StartOffset $offset$resumeDocParam"
}

# Calculate final statistics
$duration = (Get-Date) - $script:stats.StartTime
$script:auditLog.statistics = @{
    totalProcessed = $script:stats.TotalProcessed
    totalSucceeded = $script:stats.TotalSucceeded
    totalFailed = $script:stats.TotalFailed
    totalEntities = $script:stats.TotalEntities
    totalRelationships = $script:stats.TotalRelationships
    totalImpacts = $script:stats.TotalImpacts
    totalEntitiesIndexed = $script:stats.TotalEntitiesIndexed
    totalEntitiesIndexSkipped = $script:stats.TotalEntitiesIndexSkipped
    totalBatches = $script:stats.TotalBatches
    duplicateEntitiesSkipped = $script:stats.DuplicateEntitiesSkipped
    canonicalEntitiesCreated = $script:stats.CanonicalEntitiesCreated
    indexingFailures = $script:stats.IndexingFailures
    totalApiCalls = $script:stats.TotalApiCalls
    rateLimitHits = $script:stats.RateLimitHits
    retryAttempts = $script:stats.RetryAttempts
    totalRetryAttempts = $script:stats.TotalRetryAttempts
    consecutiveFailures = $script:stats.ConsecutiveFailures
    averageBatchTime = [math]::Round($script:stats.AverageBatchTime, 2)
    executionTime = $duration.TotalSeconds
    successRate = if ($script:stats.TotalProcessed -gt 0) { 
        [math]::Round(($script:stats.TotalSucceeded / $script:stats.TotalProcessed) * 100, 2) 
    } else { 0 }
    # Relationship resolution
    relationshipsCreated = $script:stats.RelationshipsCreated
    relationshipsResolvedViaGraph = $script:stats.RelationshipsResolvedViaGraph
    relationshipsResolvedViaSemantic = $script:stats.RelationshipsResolvedViaSemantic
    relationshipsSkipped = $script:stats.RelationshipsSkipped
    # Embedding retries
    totalEmbeddingRetries = $script:stats.TotalEmbeddingRetries
    # Impact edge resolution
    impactEdgesCreated = $script:stats.ImpactEdgesCreated
    impactEdgesSkipped = $script:stats.ImpactEdgesSkipped
    impactEdgesResolvedViaGraph = $script:stats.ImpactEdgesResolvedViaGraph
    impactEdgesResolvedViaSemantic = $script:stats.ImpactEdgesResolvedViaSemantic
}

# ============================================================
# FINAL SUMMARY
# ============================================================

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  GRAPH POPULATION COMPLETE" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Statistics:" -ForegroundColor White
Write-Host "  - Total Chunks Processed: $($script:stats.TotalProcessed)"
Write-Host "  - Succeeded: $($script:stats.TotalSucceeded)" -ForegroundColor Green
Write-Host "  - Failed: $($script:stats.TotalFailed)" -ForegroundColor $(if ($script:stats.TotalFailed -gt 0) { "Yellow" } else { "Green" })
Write-Host "  - Success Rate: $($script:auditLog.statistics.successRate)%" -ForegroundColor $(if ($script:auditLog.statistics.successRate -ge 95) { "Green" } elseif ($script:auditLog.statistics.successRate -ge 80) { "Yellow" } else { "Red" })
Write-Host "  - Entities Extracted: $($script:stats.TotalEntities)" -ForegroundColor Cyan
Write-Host "  - Relationships Extracted: $($script:stats.TotalRelationships)" -ForegroundColor Cyan
Write-Host "    - Created: $($script:stats.RelationshipsCreated)" -ForegroundColor White
$totalResolved = $script:stats.RelationshipsResolvedViaGraph + $script:stats.RelationshipsResolvedViaSemantic
if ($totalResolved -gt 0) {
    Write-Host "    - Resolved (cross-chunk): $totalResolved (graph: $($script:stats.RelationshipsResolvedViaGraph), semantic: $($script:stats.RelationshipsResolvedViaSemantic))" -ForegroundColor Green
}
if ($script:stats.RelationshipsSkipped -gt 0) {
    Write-Host "    - Skipped (initial pass): $($script:stats.RelationshipsSkipped)" -ForegroundColor Yellow
    if ($script:stats.BackfillRelationshipsRecovered -and $script:stats.BackfillRelationshipsRecovered -gt 0) {
        Write-Host "    - Recovered (backfill): $($script:stats.BackfillRelationshipsRecovered)" -ForegroundColor Green
    }
    if ($script:stats.BackfillStillUnresolvable -and $script:stats.BackfillStillUnresolvable -gt 0) {
        Write-Host "    - Truly Unresolvable: $($script:stats.BackfillStillUnresolvable)" -ForegroundColor DarkYellow
    }
}
Write-Host "  - Impacts Extracted: $($script:stats.TotalImpacts)" -ForegroundColor Cyan
if ($script:stats.TotalImpacts -gt 0) {
    Write-Host "    - Edges Created: $($script:stats.ImpactEdgesCreated)" -ForegroundColor White
    $totalImpactResolved = $script:stats.ImpactEdgesResolvedViaGraph + $script:stats.ImpactEdgesResolvedViaSemantic
    if ($totalImpactResolved -gt 0) {
        Write-Host "    - Resolved (cross-chunk): $totalImpactResolved (graph: $($script:stats.ImpactEdgesResolvedViaGraph), semantic: $($script:stats.ImpactEdgesResolvedViaSemantic))" -ForegroundColor Green
    }
    if ($script:stats.ImpactEdgesSkipped -gt 0) {
        Write-Host "    - Edges Skipped (unresolvable): $($script:stats.ImpactEdgesSkipped)" -ForegroundColor Yellow
    }
}
Write-Host "  - Entities Indexed (Semantic): $($script:stats.TotalEntitiesIndexed)" -ForegroundColor Cyan
if ($script:stats.TotalEntitiesIndexSkipped -gt 0) {
    Write-Host "    - Index Skipped: $($script:stats.TotalEntitiesIndexSkipped)" -ForegroundColor Yellow
}
if ($script:stats.TotalEmbeddingRetries -gt 0) {
    Write-Host "    - Embedding Retries: $($script:stats.TotalEmbeddingRetries)" -ForegroundColor Yellow
}
Write-Host "  - Total Batches: $($script:stats.TotalBatches)" -ForegroundColor White
Write-Host "  - Average Batch Time: $([math]::Round($script:stats.AverageBatchTime, 0))ms" -ForegroundColor White
Write-Host "  - Total API Calls: $($script:stats.TotalApiCalls)" -ForegroundColor White
if ($script:stats.RateLimitHits -gt 0) {
    Write-Host "  - Rate Limit Hits: $($script:stats.RateLimitHits)" -ForegroundColor Yellow
}
if ($script:stats.TotalRetryAttempts -gt 0) {
    Write-Host "  - Total Retry Attempts: $($script:stats.TotalRetryAttempts)" -ForegroundColor $(if ($script:stats.TotalRetryAttempts -lt 10) { "White" } else { "Yellow" })
}
Write-Host "  - Duration: $($duration.ToString('hh\:mm\:ss'))" -ForegroundColor White
Write-Host ""

if ($script:stats.TotalFailed -gt 0) {
    Write-Host "Some chunks failed. You can resume from offset $($script:auditLog.lastSuccessfulOffset)" -ForegroundColor Yellow
    Write-Host "Command: $($script:auditLog.resumeCommand)" -ForegroundColor Yellow
    Write-Host ""
}

# ============================================================
# AUDIT REPORT
# ============================================================

Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  AUDIT REPORT" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""

Write-Host "  [COVERAGE]" -ForegroundColor Cyan
$successRate = if ($script:auditLog.statistics.successRate) { "$($script:auditLog.statistics.successRate)%" } else { "N/A" }
Write-Host "    Chunks: $($script:stats.TotalSucceeded)/$($script:stats.TotalProcessed) succeeded ($successRate)" -ForegroundColor White
Write-Host "    Batches: $($script:stats.TotalBatches) processed" -ForegroundColor White
Write-Host ""

Write-Host "  [EXTRACTION]" -ForegroundColor Cyan
Write-Host "    Entities: $($script:stats.TotalEntities) extracted" -ForegroundColor White
Write-Host "    Relationships: $($script:stats.TotalRelationships) extracted" -ForegroundColor White
Write-Host "    Impacts: $($script:stats.TotalImpacts) extracted" -ForegroundColor White
Write-Host ""

Write-Host "  [RELATIONSHIP RESOLUTION]" -ForegroundColor Cyan
Write-Host "    Created: $($script:stats.RelationshipsCreated)" -ForegroundColor White
$totalResolved2 = $script:stats.RelationshipsResolvedViaGraph + $script:stats.RelationshipsResolvedViaSemantic
Write-Host "    Resolved (cross-chunk): $totalResolved2" -ForegroundColor $(if ($totalResolved2 -gt 0) { "Green" } else { "White" })
if ($script:stats.RelationshipsResolvedViaGraph -gt 0) {
    Write-Host "      Via graph lookup: $($script:stats.RelationshipsResolvedViaGraph)" -ForegroundColor Gray
}
if ($script:stats.RelationshipsResolvedViaSemantic -gt 0) {
    Write-Host "      Via semantic search: $($script:stats.RelationshipsResolvedViaSemantic)" -ForegroundColor Gray
}
Write-Host "    Skipped (initial pass): $($script:stats.RelationshipsSkipped)" -ForegroundColor $(if ($script:stats.RelationshipsSkipped -gt 0) { "Yellow" } else { "Green" })
if ($script:stats.BackfillRelationshipsRecovered -and $script:stats.BackfillRelationshipsRecovered -gt 0) {
    Write-Host "    Recovered (backfill): $($script:stats.BackfillRelationshipsRecovered)" -ForegroundColor Green
}
if ($script:stats.BackfillStillUnresolvable -and $script:stats.BackfillStillUnresolvable -gt 0) {
    Write-Host "    Truly Unresolvable: $($script:stats.BackfillStillUnresolvable)" -ForegroundColor DarkYellow
}
Write-Host ""

Write-Host "  [IMPACT EDGE RESOLUTION]" -ForegroundColor Cyan
Write-Host "    Edges Created: $($script:stats.ImpactEdgesCreated)" -ForegroundColor White
$totalImpactResolved2 = $script:stats.ImpactEdgesResolvedViaGraph + $script:stats.ImpactEdgesResolvedViaSemantic
Write-Host "    Resolved (cross-chunk): $totalImpactResolved2" -ForegroundColor $(if ($totalImpactResolved2 -gt 0) { "Green" } else { "White" })
if ($script:stats.ImpactEdgesResolvedViaGraph -gt 0) {
    Write-Host "      Via graph lookup: $($script:stats.ImpactEdgesResolvedViaGraph)" -ForegroundColor Gray
}
if ($script:stats.ImpactEdgesResolvedViaSemantic -gt 0) {
    Write-Host "      Via semantic search: $($script:stats.ImpactEdgesResolvedViaSemantic)" -ForegroundColor Gray
}
Write-Host "    Skipped (unresolvable): $($script:stats.ImpactEdgesSkipped)" -ForegroundColor $(if ($script:stats.ImpactEdgesSkipped -gt 0) { "Yellow" } else { "Green" })
Write-Host ""

Write-Host "  [INDEXING]" -ForegroundColor Cyan
Write-Host "    Entities Indexed (Semantic Search): $($script:stats.TotalEntitiesIndexed)" -ForegroundColor White
Write-Host "    Entities Index Skipped: $($script:stats.TotalEntitiesIndexSkipped)" -ForegroundColor $(if ($script:stats.TotalEntitiesIndexSkipped -gt 0) { "Yellow" } else { "White" })
if ($script:stats.TotalEmbeddingRetries -gt 0) {
    Write-Host "    Embedding Retries: $($script:stats.TotalEmbeddingRetries)" -ForegroundColor Yellow
}
if ($script:stats.IndexingFailures -gt 0) {
    Write-Host "    Indexing Failures: $($script:stats.IndexingFailures)" -ForegroundColor Yellow
}
Write-Host ""

# Flags for review
$hasFlags = $script:auditLog.errors.Count -gt 0 -or 
            $script:auditLog.warnings.Count -gt 0 -or 
            $script:auditLog.failedChunks.Count -gt 0 -or
            $script:auditLog.statistics.successRate -lt 95

if ($hasFlags) {
    Write-Host "  [FLAGS/WARNINGS]" -ForegroundColor Yellow
    
    if ($script:auditLog.failedChunks.Count -gt 0) {
        Write-Host "    Failed Chunks: $($script:auditLog.failedChunks.Count)" -ForegroundColor Yellow
        # Show first 5 examples
        $examples = $script:auditLog.failedChunks | Select-Object -First 5
        foreach ($example in $examples) {
            Write-Host "      - $($example.chunkId) ($($example.documentId)): $($example.error)" -ForegroundColor Gray
        }
        if ($script:auditLog.failedChunks.Count -gt 5) {
            Write-Host "      ... and $($script:auditLog.failedChunks.Count - 5) more (see audit log)" -ForegroundColor Gray
        }
        Write-Host ""
    }
    
    if ($script:auditLog.errors.Count -gt 0) {
        Write-Host "    Errors: $($script:auditLog.errors.Count)" -ForegroundColor Red
        $examples = $script:auditLog.errors | Select-Object -First 3
        foreach ($err in $examples) {
            Write-Host "      - $($err.message)" -ForegroundColor Gray
        }
        Write-Host ""
    }
    
    if ($script:auditLog.warnings.Count -gt 0) {
        Write-Host "    Warnings: $($script:auditLog.warnings.Count)" -ForegroundColor Yellow
        Write-Host ""
    }
    
    if ($script:auditLog.statistics.successRate -lt 95) {
        Write-Host "    Low Success Rate: $($script:auditLog.statistics.successRate)% (Target: 95%+)" -ForegroundColor Yellow
        Write-Host ""
    }
} else {
    Write-Host "  [NO FLAGS]" -ForegroundColor Green
    Write-Host "    All batches processed successfully with no warnings!" -ForegroundColor Green
    Write-Host ""
}

# ============================================================
# SAVE AUDIT LOG TO FILE
# ============================================================

$script:auditLog.finalStats = $script:stats

# Create logs directory if it doesn't exist
if (-not (Test-Path $script:auditLogDir)) {
    New-Item -ItemType Directory -Path $script:auditLogDir -Force | Out-Null
}

$auditLogPath = Join-Path $script:auditLogDir "audit-graph-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').json"

try {
    $script:auditLog | ConvertTo-Json -Depth 10 | Out-File -FilePath $auditLogPath -Encoding UTF8
    
    # Clean up INPROGRESS files now that we have a final audit log
    $inProgressAudit = Join-Path $script:auditLogDir "audit-graph-INPROGRESS.json"
    $inProgressSkippedRels = Join-Path $script:auditLogDir "skipped-relationships-INPROGRESS.jsonl"
    $inProgressSkippedImpacts = Join-Path $script:auditLogDir "skipped-impact-edges-INPROGRESS.jsonl"
    if (Test-Path $inProgressAudit) { Remove-Item $inProgressAudit -Force -ErrorAction SilentlyContinue }
    if (Test-Path $inProgressSkippedRels) { Remove-Item $inProgressSkippedRels -Force -ErrorAction SilentlyContinue }
    if (Test-Path $inProgressSkippedImpacts) { Remove-Item $inProgressSkippedImpacts -Force -ErrorAction SilentlyContinue }

    Write-Host "  [AUDIT LOG SAVED]" -ForegroundColor Green
    Write-Host "    Path: $auditLogPath" -ForegroundColor White
    Write-Host ""
    Write-Host "  Quick Review Commands:" -ForegroundColor Cyan
    Write-Host "    # Coverage summary" -ForegroundColor Gray
    Write-Host "    `$audit = Get-Content '$auditLogPath' | ConvertFrom-Json" -ForegroundColor White
    Write-Host "    `$audit.statistics" -ForegroundColor White
    Write-Host ""
    Write-Host "    # Per-batch breakdown" -ForegroundColor Gray
    Write-Host "    `$audit.batches | Format-Table batchNumber, offset, succeeded, failed, entitiesExtracted" -ForegroundColor White
    Write-Host ""
    Write-Host "    # View failed chunks" -ForegroundColor Gray
    Write-Host "    `$audit.failedChunks | Format-Table chunkId, documentId, error" -ForegroundColor White
    Write-Host ""
    Write-Host "    # View all errors" -ForegroundColor Gray
    Write-Host "    `$audit.errors" -ForegroundColor White
    Write-Host ""
    Write-Host "    # Export to CSV for Excel analysis" -ForegroundColor Gray
    Write-Host "    `$audit.chunks | Export-Csv 'audit-chunks.csv' -NoTypeInformation" -ForegroundColor White
    Write-Host ""
} catch {
    Write-Host "  [WARN] Could not save audit log: $($_.Exception.Message)" -ForegroundColor Yellow
}

# ============================================================
# RELATIONSHIP BACKFILL PASS
# Retries all skipped relationships now that all entities exist
# ============================================================

if (-not $DryRun -and $script:stats.RelationshipsSkipped -gt 0) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  RELATIONSHIP BACKFILL PASS" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  $($script:stats.RelationshipsSkipped) relationships were skipped during population" -ForegroundColor Yellow
    Write-Host "  Retrying now that all entities are in the graph..." -ForegroundColor Yellow
    Write-Host ""

    # Collect all skipped relationships from chunk records
    $skippedRels = @()
    $skippedImpactEdges = @()

    foreach ($chunk in $script:auditLog.chunks) {
        if ($chunk.relationshipsSkippedDetails) {
            foreach ($skip in $chunk.relationshipsSkippedDetails) {
                $skippedRels += @{
                    source = $skip.source
                    target = $skip.target
                    type = $skip.type
                    strength = if ($skip.strength) { $skip.strength } else { 0.8 }
                    evidence = if ($skip.evidence) { $skip.evidence } else { "" }
                    documentId = $chunk.documentId
                    chunkId = $chunk.chunkId
                }
            }
        }
        if ($chunk.impactEdgesSkippedDetails) {
            foreach ($skip in $chunk.impactEdgesSkippedDetails) {
                $skippedImpactEdges += @{
                    impactId = $skip.impactId
                    edgeType = $skip.edgeType
                    missingEntity = $skip.missingEntity
                    side = $skip.side
                }
            }
        }
    }

    Write-Host "  Collected $($skippedRels.Count) skipped relationships" -ForegroundColor White
    if ($skippedImpactEdges.Count -gt 0) {
        Write-Host "  Collected $($skippedImpactEdges.Count) skipped impact edges" -ForegroundColor White
    }
    Write-Host ""

    if ($skippedRels.Count -gt 0 -or $skippedImpactEdges.Count -gt 0) {
        try {
            # Send backfill request (batch in groups of 50 to avoid timeouts)
            $backfillBatchSize = 50
            $totalBackfilled = 0
            $totalStillUnresolvable = 0
            $totalDuplicatesSkipped = 0
            $totalBackfillErrors = 0
            $totalImpactBackfilled = 0
            $totalImpactStillUnresolvable = 0
            $allStillUnresolvableDetails = @()

            for ($i = 0; $i -lt [Math]::Max($skippedRels.Count, $skippedImpactEdges.Count); $i += $backfillBatchSize) {
                $relBatch = @($skippedRels | Select-Object -Skip $i -First $backfillBatchSize)
                $impactBatch = @($skippedImpactEdges | Select-Object -Skip $i -First $backfillBatchSize)

                $backfillBody = @{
                    mode = "backfill_relationships"
                    relationships = $relBatch
                    impactEdges = $impactBatch
                } | ConvertTo-Json -Depth 5

                $batchNum = [Math]::Floor($i / $backfillBatchSize) + 1
                $totalBatches = [Math]::Ceiling([Math]::Max($skippedRels.Count, $skippedImpactEdges.Count) / $backfillBatchSize)
                Write-Host "  [Backfill batch $batchNum/$totalBatches] Processing $($relBatch.Count) relationships, $($impactBatch.Count) impact edges..." -ForegroundColor Gray

                $backfillResponse = Invoke-RestMethod -Uri $EntityExtractionUrl -Method POST -Headers $headers -Body $backfillBody -TimeoutSec 300

                if ($backfillResponse.success) {
                    $totalBackfilled += $backfillResponse.stats.backfilled
                    $totalStillUnresolvable += $backfillResponse.stats.stillUnresolvable
                    $totalDuplicatesSkipped += $backfillResponse.stats.duplicatesSkipped
                    $totalBackfillErrors += $backfillResponse.stats.errors
                    if ($backfillResponse.stats.stillUnresolvableDetails) {
                        $allStillUnresolvableDetails += $backfillResponse.stats.stillUnresolvableDetails
                    }
                    if ($backfillResponse.impactStats) {
                        $totalImpactBackfilled += $backfillResponse.impactStats.backfilled
                        $totalImpactStillUnresolvable += $backfillResponse.impactStats.stillUnresolvable
                    }
                } else {
                    Write-Host "    [ERROR] Backfill batch failed" -ForegroundColor Red
                    $totalBackfillErrors += $relBatch.Count
                }

                if ($batchNum -lt $totalBatches) {
                    Start-Sleep -Seconds 1
                }
            }

            # Display results
            Write-Host ""
            Write-Host "  [BACKFILL RESULTS]" -ForegroundColor Cyan
            Write-Host "    Relationships Recovered: $totalBackfilled" -ForegroundColor $(if ($totalBackfilled -gt 0) { "Green" } else { "White" })
            Write-Host "    Still Unresolvable: $totalStillUnresolvable" -ForegroundColor $(if ($totalStillUnresolvable -gt 0) { "Yellow" } else { "Green" })
            Write-Host "    Duplicates Skipped: $totalDuplicatesSkipped" -ForegroundColor White
            Write-Host "    Errors: $totalBackfillErrors" -ForegroundColor $(if ($totalBackfillErrors -gt 0) { "Red" } else { "Green" })
            if ($totalImpactBackfilled -gt 0 -or $totalImpactStillUnresolvable -gt 0) {
                Write-Host "    Impact Edges Recovered: $totalImpactBackfilled" -ForegroundColor $(if ($totalImpactBackfilled -gt 0) { "Green" } else { "White" })
                Write-Host "    Impact Edges Still Unresolvable: $totalImpactStillUnresolvable" -ForegroundColor $(if ($totalImpactStillUnresolvable -gt 0) { "Yellow" } else { "Green" })
            }
            Write-Host ""

            # Show some examples of still-unresolvable relationships
            if ($allStillUnresolvableDetails.Count -gt 0) {
                Write-Host "  [STILL UNRESOLVABLE] These entities were never created (URLs, licences, etc.):" -ForegroundColor DarkYellow
                $examples = $allStillUnresolvableDetails | Select-Object -First 10
                foreach ($u in $examples) {
                    Write-Host "    $($u.source) -[$($u.type)]-> $($u.target) (missing: $($u.missingSide))" -ForegroundColor Gray
                }
                if ($allStillUnresolvableDetails.Count -gt 10) {
                    Write-Host "    ... and $($allStillUnresolvableDetails.Count - 10) more" -ForegroundColor Gray
                }
                Write-Host ""
            }

            # Update stats and audit log
            $script:stats.BackfillRelationshipsRecovered = $totalBackfilled
            $script:stats.BackfillStillUnresolvable = $totalStillUnresolvable
            $script:stats.BackfillDuplicatesSkipped = $totalDuplicatesSkipped
            $script:stats.BackfillErrors = $totalBackfillErrors
            $script:stats.BackfillImpactEdgesRecovered = $totalImpactBackfilled

            $script:auditLog.backfill = @{
                executed = $true
                skippedRelationshipsInput = $skippedRels.Count
                skippedImpactEdgesInput = $skippedImpactEdges.Count
                relationshipsRecovered = $totalBackfilled
                stillUnresolvable = $totalStillUnresolvable
                stillUnresolvableDetails = $allStillUnresolvableDetails
                duplicatesSkipped = $totalDuplicatesSkipped
                errors = $totalBackfillErrors
                impactEdgesRecovered = $totalImpactBackfilled
                impactEdgesStillUnresolvable = $totalImpactStillUnresolvable
            }

            Add-AuditEvent -Type "INFO" -Category "backfill" -Message "Backfill pass complete: $totalBackfilled recovered, $totalStillUnresolvable still unresolvable, $totalBackfillErrors errors"

            # Update the audit log file with backfill results
            try {
                $script:auditLog.finalStats = $script:stats
                $script:auditLog | ConvertTo-Json -Depth 10 | Out-File -FilePath $auditLogPath -Encoding UTF8
                Write-Host "  [AUDIT LOG UPDATED] Backfill results added to: $auditLogPath" -ForegroundColor Green
                Write-Host ""
            } catch {
                Write-Host "  [WARN] Could not update audit log with backfill results: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "  [ERROR] Backfill pass failed: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host ""

            $script:auditLog.backfill = @{
                executed = $true
                success = $false
                error = $_.Exception.Message
            }

            Add-AuditEvent -Type "ERROR" -Category "backfill" -Message "Backfill pass failed: $($_.Exception.Message)"
        }
    }
} elseif (-not $DryRun) {
    Write-Host ""
    Write-Host "  [BACKFILL] No skipped relationships to backfill" -ForegroundColor Green
    Write-Host ""
    $script:auditLog.backfill = @{ executed = $false; reason = "no_skipped_relationships" }
}
}

# ============================================================
# POST-PROCESSING DEDUPLICATION (Optional)
# ============================================================

if (($RunPostProcessing -or $PostProcessingOnly) -and -not $DryRun) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  POST-PROCESSING DEDUPLICATION" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Running enterprise-grade post-processing..." -ForegroundColor Yellow
    Write-Host "  - Deduplication pass" -ForegroundColor Gray
    Write-Host "  - Canonical name refinement" -ForegroundColor Gray
    Write-Host "  - Cross-document validation" -ForegroundColor Gray
    Write-Host ""
    
    try {
        $postProcessingBody = @{
            mode = "deduplicate"
        } | ConvertTo-Json
        
        $postProcessingStartTime = Get-Date
        $postProcessingResponse = Invoke-RestMethod -Uri $EntityExtractionUrl -Method POST -Headers $headers -Body $postProcessingBody -TimeoutSec 3600
        
        $postProcessingDuration = (Get-Date) - $postProcessingStartTime
        
        if ($postProcessingResponse.success) {
            Write-Host "  [SUCCESS] Post-processing completed" -ForegroundColor Green
            Write-Host ""
            Write-Host "  Results:" -ForegroundColor Cyan
            Write-Host "    - Duplicates Merged: $($postProcessingResponse.summary.duplicatesMerged)" -ForegroundColor White
            Write-Host "    - Canonical Names Updated: $($postProcessingResponse.summary.canonicalNamesUpdated)" -ForegroundColor White
            Write-Host "    - Entities Verified: $($postProcessingResponse.summary.entitiesVerified)" -ForegroundColor White
            Write-Host "    - Potential Duplicates Found: $($postProcessingResponse.summary.potentialDuplicatesFound)" -ForegroundColor $(if ($postProcessingResponse.summary.potentialDuplicatesFound -gt 0) { "Yellow" } else { "Green" })
            Write-Host "    - Total Errors: $($postProcessingResponse.summary.totalErrors)" -ForegroundColor $(if ($postProcessingResponse.summary.totalErrors -gt 0) { "Yellow" } else { "Green" })
            Write-Host "    - Execution Time: $($postProcessingDuration.TotalMinutes.ToString('F2')) minutes" -ForegroundColor White
            Write-Host ""
            
            # Show potential duplicates if any
            if ($postProcessingResponse.potentialDuplicates -and $postProcessingResponse.potentialDuplicates.Count -gt 0) {
                Write-Host "  [REVIEW NEEDED] Potential Duplicates (Similarity 75-88%)" -ForegroundColor Yellow
                Write-Host "    These entities may be duplicates but need manual review:" -ForegroundColor Gray
                Write-Host ""
                
                $topPotential = $postProcessingResponse.potentialDuplicates | Select-Object -First 10
                foreach ($dup in $topPotential) {
                    $similarityColor = if ($dup.similarityPercent -ge 85) { "Yellow" } else { "Gray" }
                    Write-Host "    - $($dup.entity1.name) <-> $($dup.entity2.name)" -ForegroundColor $similarityColor
                    Write-Host "      Similarity: $($dup.similarityPercent)% | Recommendation: $($dup.recommendation)" -ForegroundColor Gray
                    Write-Host "      Entity 1: $($dup.entity1.id) ($($dup.entity1.mentionCount) mentions)" -ForegroundColor Gray
                    Write-Host "      Entity 2: $($dup.entity2.id) ($($dup.entity2.mentionCount) mentions)" -ForegroundColor Gray
                    Write-Host ""
                }
                
                if ($postProcessingResponse.potentialDuplicates.Count -gt 10) {
                    Write-Host "    ... and $($postProcessingResponse.potentialDuplicates.Count - 10) more (see response JSON)" -ForegroundColor Gray
                    Write-Host ""
                }
                
                Write-Host "    To review all potential duplicates:" -ForegroundColor Cyan
                Write-Host "      `$response = Invoke-RestMethod -Uri '$EntityExtractionUrl' -Method POST -Headers `$headers -Body '{`"mode`":`"deduplicate`"}'" -ForegroundColor White
                Write-Host "      `$response.potentialDuplicates | Export-Csv 'potential-duplicates.csv' -NoTypeInformation" -ForegroundColor White
                Write-Host ""
            }
            
            # Add post-processing stats to audit log
            $script:auditLog.postProcessing = @{
                executed = $true
                startTime = $postProcessingStartTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                endTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                duration = $postProcessingDuration.TotalSeconds
                results = $postProcessingResponse
            }
            
            # Update stats
            $script:stats.PostProcessingDuplicatesMerged = $postProcessingResponse.summary.duplicatesMerged
            $script:stats.PostProcessingCanonicalNamesUpdated = $postProcessingResponse.summary.canonicalNamesUpdated
            $script:stats.PostProcessingEntitiesVerified = $postProcessingResponse.summary.entitiesVerified
            $script:stats.PostProcessingPotentialDuplicates = $postProcessingResponse.summary.potentialDuplicatesFound
            $script:stats.PostProcessingErrors = $postProcessingResponse.summary.totalErrors
            $script:stats.PostProcessingDuration = $postProcessingDuration.TotalSeconds
        } else {
            Write-Host "  [WARNING] Post-processing completed with errors" -ForegroundColor Yellow
            Write-Host "    Error: $($postProcessingResponse.error)" -ForegroundColor Gray
            Write-Host ""
            
            $script:auditLog.postProcessing = @{
                executed = $true
                success = $false
                error = $postProcessingResponse.error
                partialResults = $postProcessingResponse.partialResults
            }
        }
    } catch {
        Write-Host "  [ERROR] Post-processing failed" -ForegroundColor Red
        Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Gray
        Write-Host ""
        
        $script:auditLog.postProcessing = @{
            executed = $true
            success = $false
            error = $_.Exception.Message
        }
        
        Add-AuditEvent -Type "ERROR" -Category "post-processing" -Message "Post-processing failed: $($_.Exception.Message)"
    }
} elseif ($RunPostProcessing -and $DryRun) {
    Write-Host ""
    Write-Host "  [SKIP] Post-processing skipped (dry run mode)" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""

# Return stats for programmatic use
return $script:stats
