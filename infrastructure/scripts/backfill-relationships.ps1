# ============================================================================
# BACKFILL RELATIONSHIPS SCRIPT
# Reads a previous audit log and retries all skipped relationships
# now that all entities are in the graph.
# ============================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$AuditLogPath,
    [Parameter(Mandatory=$false)]
    [string]$SkippedRelationshipsFile,
    [Parameter(Mandatory=$false)]
    [string]$SkippedImpactEdgesFile,
    [switch]$DryRun,
    [int]$BackfillBatchSize = 50
)

$ErrorActionPreference = "Continue"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  RELATIONSHIP BACKFILL" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# LOAD ENVIRONMENT VARIABLES
# ============================================================

$infraDir = Split-Path $PSScriptRoot -Parent
$projectRoot = Split-Path $infraDir -Parent
foreach ($envFile in @(
    (Join-Path $infraDir ".env"),
    (Join-Path $projectRoot ".env")
)) {
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match "^([^#][^=]*)=(.*)$") {
                $k = $matches[1].Trim(); $v = $matches[2].Trim()
                if ($k) { [Environment]::SetEnvironmentVariable($k, $v, "Process") }
            }
        }
    }
}

# ============================================================
# VALIDATE INPUTS
# ============================================================

$logsDir = Join-Path $PSScriptRoot "logs"

# Auto-detect files if nothing provided
if (-not $AuditLogPath -and -not $SkippedRelationshipsFile) {
    # Check for INPROGRESS files first (from interrupted runs)
    $autoSkippedRels = Join-Path $logsDir "skipped-relationships-INPROGRESS.jsonl"
    $autoSkippedImpacts = Join-Path $logsDir "skipped-impact-edges-INPROGRESS.jsonl"
    $autoAuditInProgress = Join-Path $logsDir "audit-graph-INPROGRESS.json"

    if (Test-Path $autoSkippedRels) {
        Write-Host "  [AUTO-DETECT] Found skipped-relationships-INPROGRESS.jsonl" -ForegroundColor Green
        $SkippedRelationshipsFile = $autoSkippedRels
        if (Test-Path $autoSkippedImpacts) {
            $SkippedImpactEdgesFile = $autoSkippedImpacts
        }
    } elseif (Test-Path $autoAuditInProgress) {
        Write-Host "  [AUTO-DETECT] Found audit-graph-INPROGRESS.json" -ForegroundColor Green
        $AuditLogPath = $autoAuditInProgress
    } else {
        Write-Host "  [ERROR] No input provided and no INPROGRESS files found." -ForegroundColor Red
        Write-Host ""
        Write-Host "  Usage:" -ForegroundColor Yellow
        Write-Host "    .\backfill-relationships.ps1 -AuditLogPath <path-to-audit-json>" -ForegroundColor White
        Write-Host "    .\backfill-relationships.ps1 -SkippedRelationshipsFile <path-to-jsonl>" -ForegroundColor White
        Write-Host "    .\backfill-relationships.ps1   (auto-detects INPROGRESS files)" -ForegroundColor White
        Write-Host ""
        Write-Host "  Find files in:" -ForegroundColor Gray
        Write-Host "    $logsDir" -ForegroundColor White
        exit 1
    }
}

if ($AuditLogPath -and -not (Test-Path $AuditLogPath)) {
    Write-Host "  [ERROR] Audit log not found: $AuditLogPath" -ForegroundColor Red
    exit 1
}
if ($SkippedRelationshipsFile -and -not (Test-Path $SkippedRelationshipsFile)) {
    Write-Host "  [ERROR] Skipped relationships file not found: $SkippedRelationshipsFile" -ForegroundColor Red
    exit 1
}

$EntityExtractionUrl = $env:VITE_AZURE_ENTITY_EXTRACTION_URL
$FunctionsUrl = $env:VITE_AZURE_FUNCTIONS_URL
if (-not $EntityExtractionUrl) {
    if ($FunctionsUrl) {
        $EntityExtractionUrl = "$FunctionsUrl/api/entity-extraction"
    } else {
        Write-Host "  [ERROR] VITE_AZURE_ENTITY_EXTRACTION_URL or VITE_AZURE_FUNCTIONS_URL not configured" -ForegroundColor Red
        exit 1
    }
}

$FunctionKey = $env:VITE_AZURE_FUNCTION_KEY
$headers = @{
    "Content-Type" = "application/json"
}
if ($FunctionKey) {
    $headers["x-functions-key"] = $FunctionKey
}

# ============================================================
# COLLECT SKIPPED RELATIONSHIPS
# ============================================================

$skippedRels = @()
$skippedImpactEdges = @()

if ($SkippedRelationshipsFile) {
    # Read from .jsonl file (one JSON object per line, saved incrementally)
    Write-Host "  [INFO] Reading skipped relationships from: $SkippedRelationshipsFile" -ForegroundColor Yellow
    Get-Content $SkippedRelationshipsFile | ForEach-Object {
        $line = $_.Trim()
        if ($line) {
            try {
                $obj = $line | ConvertFrom-Json
                $skippedRels += @{
                    source = $obj.source
                    target = $obj.target
                    type = $obj.type
                    strength = 0.8
                    evidence = ""
                    documentId = $obj.documentId
                    chunkId = $obj.chunkId
                }
            } catch { }
        }
    }
    if ($SkippedImpactEdgesFile -and (Test-Path $SkippedImpactEdgesFile)) {
        Write-Host "  [INFO] Reading skipped impact edges from: $SkippedImpactEdgesFile" -ForegroundColor Yellow
        Get-Content $SkippedImpactEdgesFile | ForEach-Object {
            $line = $_.Trim()
            if ($line) {
                try {
                    $obj = $line | ConvertFrom-Json
                    $skippedImpactEdges += @{
                        impactId = $obj.impactId
                        edgeType = $obj.edgeType
                        missingEntity = $obj.missingEntity
                        side = $obj.side
                    }
                } catch { }
            }
        }
    }
} elseif ($AuditLogPath) {
    # Read from audit log JSON
    Write-Host "  [INFO] Reading audit log: $AuditLogPath" -ForegroundColor Yellow
    Write-Host ""

    try {
        $audit = Get-Content $AuditLogPath -Raw | ConvertFrom-Json
    } catch {
        Write-Host "  [ERROR] Failed to parse audit log: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }

    foreach ($chunk in $audit.chunks) {
        if ($chunk.relationshipsSkippedDetails) {
            foreach ($skip in $chunk.relationshipsSkippedDetails) {
                $str = if ($skip.strength) { $skip.strength } else { 0.8 }
                $ev = if ($skip.evidence) { $skip.evidence } else { "" }
                $skippedRels += @{
                    source = $skip.source
                    target = $skip.target
                    type = $skip.type
                    strength = $str
                    evidence = $ev
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
}

Write-Host ""

Write-Host "  Skipped Relationships Found: $($skippedRels.Count)" -ForegroundColor White
Write-Host "  Skipped Impact Edges Found: $($skippedImpactEdges.Count)" -ForegroundColor White
Write-Host ""

if ($skippedRels.Count -eq 0 -and $skippedImpactEdges.Count -eq 0) {
    Write-Host "  [INFO] No skipped relationships or impact edges to backfill!" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# Show what we'll backfill
Write-Host "  Examples:" -ForegroundColor Gray
$examples = $skippedRels | Select-Object -First 5
foreach ($ex in $examples) {
    Write-Host "    $($ex.source) -[$($ex.type)]-> $($ex.target)" -ForegroundColor DarkGray
}
if ($skippedRels.Count -gt 5) {
    Write-Host "    ... and $($skippedRels.Count - 5) more" -ForegroundColor DarkGray
}
Write-Host ""

if ($DryRun) {
    Write-Host "  [DRY RUN] Would attempt to backfill $($skippedRels.Count) relationships and $($skippedImpactEdges.Count) impact edges" -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

# ============================================================
# SEND BACKFILL REQUESTS
# ============================================================

Write-Host "  [INFO] Sending backfill requests to: $EntityExtractionUrl" -ForegroundColor Yellow
Write-Host ""

$totalBackfilled = 0
$totalStillUnresolvable = 0
$totalDuplicatesSkipped = 0
$totalErrors = 0
$totalImpactBackfilled = 0
$totalImpactStillUnresolvable = 0
$allStillUnresolvableDetails = @()
$startTime = Get-Date

$totalItems = [Math]::Max($skippedRels.Count, $skippedImpactEdges.Count)
$totalBatches = [Math]::Ceiling($totalItems / $BackfillBatchSize)

for ($i = 0; $i -lt $totalItems; $i += $BackfillBatchSize) {
    $relBatch = @($skippedRels | Select-Object -Skip $i -First $BackfillBatchSize)
    $impactBatch = @($skippedImpactEdges | Select-Object -Skip $i -First $BackfillBatchSize)

    $batchNum = [Math]::Floor($i / $BackfillBatchSize) + 1

    $backfillBody = @{
        mode = "backfill_relationships"
        relationships = $relBatch
        impactEdges = $impactBatch
    } | ConvertTo-Json -Depth 5

    Write-Host "  [Batch $batchNum/$totalBatches] Processing $($relBatch.Count) relationships, $($impactBatch.Count) impact edges..." -ForegroundColor Gray

    try {
        $response = Invoke-RestMethod -Uri $EntityExtractionUrl -Method POST -Headers $headers -Body $backfillBody -TimeoutSec 300

        if ($response.success) {
            $totalBackfilled += $response.stats.backfilled
            $totalStillUnresolvable += $response.stats.stillUnresolvable
            $totalDuplicatesSkipped += $response.stats.duplicatesSkipped
            $totalErrors += $response.stats.errors
            if ($response.stats.stillUnresolvableDetails) {
                $allStillUnresolvableDetails += $response.stats.stillUnresolvableDetails
            }
            if ($response.impactStats) {
                $totalImpactBackfilled += $response.impactStats.backfilled
                $totalImpactStillUnresolvable += $response.impactStats.stillUnresolvable
            }

            $batchRecovered = $response.stats.backfilled
            $batchColor = if ($batchRecovered -gt 0) { "Green" } else { "Gray" }
            Write-Host "    Recovered: $batchRecovered | Unresolvable: $($response.stats.stillUnresolvable) | Duplicates: $($response.stats.duplicatesSkipped)" -ForegroundColor $batchColor
        } else {
            Write-Host "    [ERROR] Batch failed" -ForegroundColor Red
            $totalErrors += $relBatch.Count
        }
    } catch {
        Write-Host "    [ERROR] Request failed: $($_.Exception.Message)" -ForegroundColor Red
        $totalErrors += $relBatch.Count
    }

    if ($batchNum -lt $totalBatches) {
        Start-Sleep -Seconds 1
    }
}

$duration = (Get-Date) - $startTime

# ============================================================
# RESULTS
# ============================================================

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  BACKFILL COMPLETE" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Relationships:" -ForegroundColor White
Write-Host "    Input (skipped): $($skippedRels.Count)" -ForegroundColor White
Write-Host "    Recovered: $totalBackfilled" -ForegroundColor $(if ($totalBackfilled -gt 0) { "Green" } else { "White" })
Write-Host "    Still Unresolvable: $totalStillUnresolvable" -ForegroundColor $(if ($totalStillUnresolvable -gt 0) { "Yellow" } else { "Green" })
Write-Host "    Duplicates Skipped: $totalDuplicatesSkipped" -ForegroundColor White
Write-Host "    Errors: $totalErrors" -ForegroundColor $(if ($totalErrors -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($skippedImpactEdges.Count -gt 0) {
    Write-Host "  Impact Edges:" -ForegroundColor White
    Write-Host "    Input (skipped): $($skippedImpactEdges.Count)" -ForegroundColor White
    Write-Host "    Recovered: $totalImpactBackfilled" -ForegroundColor $(if ($totalImpactBackfilled -gt 0) { "Green" } else { "White" })
    Write-Host "    Still Unresolvable: $totalImpactStillUnresolvable" -ForegroundColor $(if ($totalImpactStillUnresolvable -gt 0) { "Yellow" } else { "Green" })
    Write-Host ""
}

$recoveryRate = if ($skippedRels.Count -gt 0) {
    [math]::Round(($totalBackfilled / $skippedRels.Count) * 100, 1)
} else { 0 }
Write-Host "  Recovery Rate: $recoveryRate%" -ForegroundColor $(if ($recoveryRate -ge 50) { "Green" } elseif ($recoveryRate -ge 20) { "Yellow" } else { "White" })
Write-Host "  Duration: $($duration.ToString('hh\:mm\:ss'))" -ForegroundColor White
Write-Host ""

if ($allStillUnresolvableDetails.Count -gt 0) {
    Write-Host "  [STILL UNRESOLVABLE] These entities were never created:" -ForegroundColor DarkYellow
    $examples = $allStillUnresolvableDetails | Select-Object -First 10
    foreach ($u in $examples) {
        Write-Host "    $($u.source) -[$($u.type)]-> $($u.target) (missing: $($u.missingSide))" -ForegroundColor Gray
    }
    if ($allStillUnresolvableDetails.Count -gt 10) {
        Write-Host "    ... and $($allStillUnresolvableDetails.Count - 10) more" -ForegroundColor Gray
    }
    Write-Host ""
}

Write-Host "============================================" -ForegroundColor Cyan
