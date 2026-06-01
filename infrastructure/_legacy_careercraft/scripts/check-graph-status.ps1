# ============================================================================
# CHECK GRAPH STATUS SCRIPT
# Checks if Cosmos DB graph is empty and optionally clears it
# ============================================================================

param(
    [switch]$ClearGraph,
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  GRAPH STATUS CHECK" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Load environment variables (infrastructure/.env first, then project root .env to override)
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

# Check required environment variables
$cosmosEndpoint = $env:COSMOS_GREMLIN_ENDPOINT
$cosmosDatabase = $env:COSMOS_DATABASE
$cosmosGraph = $env:COSMOS_GRAPH
$cosmosKey = $env:COSMOS_PRIMARY_KEY

if (-not $cosmosEndpoint -or -not $cosmosDatabase -or -not $cosmosGraph -or -not $cosmosKey) {
    Write-Host "  [ERROR] Cosmos DB environment variables not configured!" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Required variables:" -ForegroundColor Yellow
    Write-Host "    - COSMOS_GREMLIN_ENDPOINT" -ForegroundColor White
    Write-Host "    - COSMOS_DATABASE" -ForegroundColor White
    Write-Host "    - COSMOS_GRAPH" -ForegroundColor White
    Write-Host "    - COSMOS_PRIMARY_KEY" -ForegroundColor White
    Write-Host ""
    Write-Host "  Add these to infrastructure/.env file" -ForegroundColor Yellow
    exit 1
}

Write-Host "  [INFO] Cosmos DB Configuration:" -ForegroundColor Green
Write-Host "    Endpoint: $cosmosEndpoint" -ForegroundColor Gray
Write-Host "    Database: $cosmosDatabase" -ForegroundColor Gray
Write-Host "    Graph: $cosmosGraph" -ForegroundColor Gray
Write-Host ""

# Use graph-query function to check status
$graphQueryUrl = $env:VITE_AZURE_FUNCTIONS_URL
if (-not $graphQueryUrl) {
    Write-Host "  [ERROR] VITE_AZURE_FUNCTIONS_URL not configured!" -ForegroundColor Red
    Write-Host "  Add to infrastructure/.env file" -ForegroundColor Yellow
    exit 1
}

$graphQueryUrl = "$graphQueryUrl/api/graph-query"
$functionKey = $env:VITE_AZURE_FUNCTION_KEY

$headers = @{
    "Content-Type" = "application/json"
}
if ($functionKey) {
    $headers["x-functions-key"] = $functionKey
}

Write-Host "  [INFO] Checking graph status..." -ForegroundColor Yellow

try {
    # Query for entity count
    $body = @{
        action = "count_entities"
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri $graphQueryUrl -Method POST -Headers $headers -Body $body -ErrorAction Stop
    
    # Handle response format from graph-query function
    $data = if ($response.data) { $response.data } else { $response }
    
    $entityCount = if ($data.entities) { $data.entities } elseif ($data.count) { $data.count } else { 0 }
    $relationshipCount = if ($data.relationships) { $data.relationships } else { 0 }
    $impactCount = if ($data.impacts) { $data.impacts } else { 0 }
    
    Write-Host ""
    Write-Host "  [STATUS] Graph Contents:" -ForegroundColor Cyan
    Write-Host "    Entities: $entityCount" -ForegroundColor $(if ($entityCount -eq 0) { "Green" } else { "Yellow" })
    Write-Host "    Relationships: $relationshipCount" -ForegroundColor $(if ($relationshipCount -eq 0) { "Green" } else { "Yellow" })
    Write-Host "    Impacts: $impactCount" -ForegroundColor $(if ($impactCount -eq 0) { "Green" } else { "Yellow" })
    Write-Host ""
    
    if ($entityCount -eq 0 -and $relationshipCount -eq 0 -and $impactCount -eq 0) {
        Write-Host "  [RESULT] Graph is EMPTY" -ForegroundColor Green
        Write-Host "    Safe to populate without clearing" -ForegroundColor Gray
    } else {
        Write-Host "  [RESULT] Graph contains data!" -ForegroundColor Yellow
        Write-Host "    Entities: $entityCount" -ForegroundColor White
        Write-Host "    Relationships: $relationshipCount" -ForegroundColor White
        Write-Host "    Impacts: $impactCount" -ForegroundColor White
        Write-Host ""
        
        if ($ClearGraph) {
            if ($DryRun) {
                Write-Host "  [DRY RUN] Would clear graph (removing all entities, relationships, and impacts)" -ForegroundColor Yellow
            } else {
                Write-Host "  [WARNING] Clearing graph will delete ALL data!" -ForegroundColor Red
                Write-Host "    This action cannot be undone." -ForegroundColor Red
                Write-Host ""

                $confirm = Read-Host "  Type 'YES' to confirm graph deletion"
                if ($confirm -eq "YES") {
                    Write-Host "  [INFO] Clearing graph..." -ForegroundColor Yellow

                    $clearBody = @{
                        action = "clear_graph"
                    } | ConvertTo-Json

                    $clearResponse = Invoke-RestMethod -Uri $graphQueryUrl -Method POST -Headers $headers -Body $clearBody -ErrorAction Stop
                    $clearData = if ($clearResponse.data) { $clearResponse.data } else { $clearResponse }
                    if ($clearData.success -or $clearResponse.success) {
                        Write-Host "  [SUCCESS] Graph cleared successfully!" -ForegroundColor Green
                    } else {
                        $errorMsg = if ($clearData.error) { $clearData.error } elseif ($clearResponse.error) { $clearResponse.error } else { "Unknown error" }
                        Write-Host "  [ERROR] Failed to clear graph: $errorMsg" -ForegroundColor Red
                    }
                } else {
                    Write-Host "  [CANCELLED] Graph not cleared" -ForegroundColor Yellow
                }
            }
        } else {
            Write-Host "  [INFO] Graph contains data. Use -ClearGraph to remove it before populating." -ForegroundColor Yellow
            Write-Host "    Example: .\check-graph-status.ps1 -ClearGraph" -ForegroundColor Gray
        }
    }
    
} catch {
    Write-Host ""
    Write-Host "  [ERROR] Failed to check graph status: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Possible issues:" -ForegroundColor Yellow
    Write-Host "    1. Graph-query function not deployed or not accessible" -ForegroundColor White
    Write-Host "    2. Function key required but not set" -ForegroundColor White
    Write-Host "    3. Cosmos DB not configured correctly" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
