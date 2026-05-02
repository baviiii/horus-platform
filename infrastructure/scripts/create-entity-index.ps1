# ============================================================================
# CREATE ENTITY SEMANTIC INDEX
# Creates Azure AI Search index for entity discovery (sidecar to graph)
# Enables semantic similarity search for entities without automatic graph edges
# ============================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroupName = "rg-careercraft-dev",
    
    [Parameter(Mandatory=$false)]
    [string]$SearchServiceName = "careercraft-search-dev",
    
    [Parameter(Mandatory=$false)]
    [string]$IndexName = "entities"
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
    Write-Error "Azure Search credentials not found. Set AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_KEY in .env"
    exit 1
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  CREATE ENTITY SEMANTIC INDEX" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Configuration:"
Write-Host "  - Search Endpoint: $searchEndpoint"
Write-Host "  - Index Name: $IndexName"
Write-Host ""

# Entity index schema
# Supports semantic search over entities without creating graph edges
$indexSchema = @{
    name = $IndexName
    fields = @(
        @{
            name = "id"
            type = "Edm.String"
            key = $true
            searchable = $false
            filterable = $true
            sortable = $false
            facetable = $false
        },
        @{
            name = "entityType"
            type = "Edm.String"
            searchable = $true
            filterable = $true
            sortable = $true
            facetable = $true
        },
        @{
            name = "name"
            type = "Edm.String"
            searchable = $true
            filterable = $false
            sortable = $true
            facetable = $false
            analyzer = "en.microsoft"
        },
        @{
            name = "canonicalName"
            type = "Edm.String"
            searchable = $true
            filterable = $true
            sortable = $true
            facetable = $false
        },
        @{
            name = "description"
            type = "Edm.String"
            searchable = $true
            filterable = $false
            sortable = $false
            facetable = $false
            analyzer = "en.microsoft"
        },
        @{
            name = "aliases"
            type = "Collection(Edm.String)"
            searchable = $true
            filterable = $true
            sortable = $false
            facetable = $false
        },
        @{
            name = "sector"
            type = "Edm.String"
            searchable = $true
            filterable = $true
            sortable = $false
            facetable = $true
        },
        @{
            name = "sourceDocuments"
            type = "Collection(Edm.String)"
            searchable = $false
            filterable = $true
            sortable = $false
            facetable = $false
        },
        @{
            name = "mentionCount"
            type = "Edm.Int32"
            searchable = $false
            filterable = $true
            sortable = $true
            facetable = $false
        },
        @{
            name = "confidence"
            type = "Edm.Double"
            searchable = $false
            filterable = $true
            sortable = $true
            facetable = $false
        },
        @{
            name = "createdAt"
            type = "Edm.DateTimeOffset"
            searchable = $false
            filterable = $true
            sortable = $true
            facetable = $false
        },
        @{
            name = "updatedAt"
            type = "Edm.DateTimeOffset"
            searchable = $false
            filterable = $true
            sortable = $true
            facetable = $false
        },
        # Vector field for semantic similarity search
        @{
            name = "entityVector"
            type = "Collection(Edm.Single)"
            searchable = $true
            filterable = $false
            sortable = $false
            facetable = $false
            dimensions = 3072  # text-embedding-3-large dimensions
            vectorSearchProfile = "entity-vector-profile"
        },
        # Metadata for graph integration
        @{
            name = "graphVertexId"
            type = "Edm.String"
            searchable = $false
            filterable = $true
            sortable = $false
            facetable = $false
        },
        @{
            name = "relatedEntityIds"
            type = "Collection(Edm.String)"
            searchable = $false
            filterable = $true
            sortable = $false
            facetable = $false
        }
    )
    vectorSearch = @{
        algorithms = @(
            @{
                name = "entity-hnsw"
                kind = "hnsw"
                hnswParameters = @{
                    m = 4
                    efConstruction = 400
                    efSearch = 500
                    metric = "cosine"
                }
            }
        )
        profiles = @(
            @{
                name = "entity-vector-profile"
                algorithm = "entity-hnsw"
            }
        )
    }
    semantic = @{
        configurations = @(
            @{
                name = "entity-semantic"
                prioritizedFields = @{
                    prioritizedContentFields = @(
                        @{
                            fieldName = "description"
                        }
                    )
                    titleField = @{
                        fieldName = "name"
                    }
                }
            }
        )
    }
} | ConvertTo-Json -Depth 10

# Check if index exists
Write-Host "Checking if index exists..." -ForegroundColor Gray
$checkUrl = "$searchEndpoint/indexes/$IndexName`?api-version=2023-11-01"
try {
    $checkResponse = Invoke-RestMethod -Uri $checkUrl -Method Get -Headers @{
        "Content-Type" = "application/json"
        "api-key" = $searchKey
    } -ErrorAction SilentlyContinue
    
    Write-Host "  Index exists. Deleting..." -ForegroundColor Yellow
    $deleteUrl = "$searchEndpoint/indexes/$IndexName`?api-version=2023-11-01"
    Invoke-RestMethod -Uri $deleteUrl -Method Delete -Headers @{
        "api-key" = $searchKey
    }
    Write-Host "  [OK] Index deleted" -ForegroundColor Green
    Start-Sleep -Seconds 2
} catch {
    Write-Host "  Index does not exist. Creating new..." -ForegroundColor Gray
}

# Create index
Write-Host ""
Write-Host "Creating entity index..." -ForegroundColor Yellow
$createUrl = "$searchEndpoint/indexes?api-version=2023-11-01"
try {
    $response = Invoke-RestMethod -Uri $createUrl -Method Post -Headers @{
        "Content-Type" = "application/json"
        "api-key" = $searchKey
    } -Body $indexSchema
    
    Write-Host "  [OK] Entity index created successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Index Details:" -ForegroundColor Cyan
    Write-Host "  - Name: $IndexName"
    Write-Host "  - Fields: $($response.fields.Count)"
    Write-Host "  - Vector Search: Enabled (3072 dimensions)"
    Write-Host "  - Semantic Search: Enabled"
} catch {
    Write-Host "  [ERROR] Failed to create index" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  ENTITY INDEX READY" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Run entity extraction: .\populate-graph.ps1"
Write-Host "  2. Entities will be indexed to both Cosmos DB and Azure Search"
Write-Host "  3. Use entity-search API for semantic similarity queries"
Write-Host ""
