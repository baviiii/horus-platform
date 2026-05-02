# Migrate entities from Cosmos DB to Neo4j
# Reads from graph-query (Cosmos) and writes to Neo4j

param(
    [Parameter(Mandatory=$false)]
    [int]$BatchSize = 50,
    
    [Parameter(Mandatory=$false)]
    [switch]$DryRun
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

$GraphQueryUrl = $env:VITE_AZURE_GRAPH_QUERY_URL
if (-not $GraphQueryUrl) {
    $GraphQueryUrl = "https://careercraft-functions-dev.azurewebsites.net/api/graph-query"
}

Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "  COSMOS DB → NEO4J MIGRATION" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""
Write-Host "Graph Query URL: $GraphQueryUrl"
Write-Host "Batch Size: $BatchSize"
Write-Host "Dry Run: $DryRun"
Write-Host ""

# Step 1: Get all entities from Cosmos DB
Write-Host "Step 1: Fetching entities from Cosmos DB..." -ForegroundColor Yellow

$cosmosResponse = Invoke-RestMethod -Uri $GraphQueryUrl -Method POST -ContentType "application/json" -Body (@{
    action = "list_all"
    limit = 1000
    backend = "cosmos"
} | ConvertTo-Json)

$entities = $cosmosResponse.data
Write-Host "  Found $($entities.Count) entities in Cosmos DB" -ForegroundColor Green

if ($entities.Count -eq 0) {
    Write-Host "No entities found in Cosmos DB. Nothing to migrate." -ForegroundColor Yellow
    exit 0
}

# Step 2: Create entities in Neo4j
Write-Host ""
Write-Host "Step 2: Creating entities in Neo4j..." -ForegroundColor Yellow

$created = 0
$failed = 0

foreach ($entity in $entities) {
    $entityName = $entity.name
    $entityType = $entity.entity_type
    $canonicalName = $entity.canonical_name
    
    if (-not $entityName) { continue }
    
    if ($DryRun) {
        Write-Host "  [DRY RUN] Would create: $entityName ($entityType)" -ForegroundColor Gray
        $created++
        continue
    }
    
    try {
        # Use the graph-query function to create in Neo4j
        # We'll need to add a 'create' action or use direct Neo4j connection
        $createResponse = Invoke-RestMethod -Uri $GraphQueryUrl -Method POST -ContentType "application/json" -Body (@{
            action = "create_entity"
            entityName = $entityName
            entityType = $entityType
            canonicalName = $canonicalName
            properties = $entity
            backend = "neo4j"
        } | ConvertTo-Json -Depth 5) -ErrorAction Stop
        
        $created++
        if ($created % 10 -eq 0) {
            Write-Host "  Created $created entities..." -ForegroundColor Gray
        }
    } catch {
        $failed++
        Write-Host "  Failed to create: $entityName - $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Step 3: Get all relationships from Cosmos DB
Write-Host ""
Write-Host "Step 3: Fetching relationships from Cosmos DB..." -ForegroundColor Yellow

$edgesResponse = Invoke-RestMethod -Uri $GraphQueryUrl -Method POST -ContentType "application/json" -Body (@{
    action = "list_edges"
    limit = 1000
    backend = "cosmos"
} | ConvertTo-Json)

$edges = $edgesResponse.data
Write-Host "  Found $($edges.Count) relationships in Cosmos DB" -ForegroundColor Green

# Step 4: Create relationships in Neo4j
Write-Host ""
Write-Host "Step 4: Creating relationships in Neo4j..." -ForegroundColor Yellow

$relCreated = 0
$relFailed = 0

foreach ($edge in $edges) {
    $fromCanonical = $edge.outV
    $toCanonical = $edge.inV
    $relationType = $edge.label
    
    if (-not $fromCanonical -or -not $toCanonical) { continue }
    
    if ($DryRun) {
        Write-Host "  [DRY RUN] Would create: $fromCanonical -[$relationType]-> $toCanonical" -ForegroundColor Gray
        $relCreated++
        continue
    }
    
    try {
        $null = Invoke-RestMethod -Uri $GraphQueryUrl -Method POST -ContentType "application/json" -Body (@{
            action = "create_relationship"
            fromCanonical = $fromCanonical
            toCanonical = $toCanonical
            relationType = $relationType.ToUpper().Replace("-", "_")
            backend = "neo4j"
        } | ConvertTo-Json -Depth 5) -ErrorAction Stop
        
        $relCreated++
        if ($relCreated % 10 -eq 0) {
            Write-Host "  Created $relCreated relationships..." -ForegroundColor Gray
        }
    } catch {
        $relFailed++
        Write-Host "  Failed: $fromCanonical -> $toCanonical - $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Green
Write-Host "  MIGRATION COMPLETE" -ForegroundColor Green
Write-Host "=" * 60 -ForegroundColor Green
Write-Host ""
Write-Host "Results:"
Write-Host "  - Entities found: $($entities.Count)"
Write-Host "  - Entities created: $created"
Write-Host "  - Entities failed: $failed"
Write-Host "  - Relationships found: $($edges.Count)"
Write-Host "  - Relationships created: $relCreated"
Write-Host "  - Relationships failed: $relFailed"
Write-Host ""

if ($DryRun) {
    Write-Host "This was a DRY RUN. Run without -DryRun to actually migrate." -ForegroundColor Yellow
}
