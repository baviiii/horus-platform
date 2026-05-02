# Master Deployment Script - Runs All Steps in Correct Order
# Simple CLI-based deployment using Azure CLI (az login)
# Supports multi-tenancy for SaaS scalability

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory=$false)]
    [string]$Location = "australiaeast",

    [Parameter(Mandatory=$false)]
    [string]$Environment = "dev",

    [Parameter(Mandatory=$false)]
    [switch]$EnableOpenAI = $false,

    [Parameter(Mandatory=$false)]
    [switch]$SkipWebScraping = $false,

    [Parameter(Mandatory=$false)]
    [string]$TenantId = "default",

    [Parameter(Mandatory=$false)]
    [switch]$EnableMultiTenancy = $false,

    [Parameter(Mandatory=$false)]
    [switch]$DeployCosmosGraph = $true,

    [Parameter(Mandatory=$false)]
    [switch]$DeployAzureFunctions = $true
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host "[Master Deployment - Complete RAG Infrastructure]" -ForegroundColor Cyan
if ($EnableMultiTenancy) {
    Write-Host "[Multi-Tenancy ENABLED - Tenant: $TenantId]" -ForegroundColor Magenta
}
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host ""

# Check Azure CLI is installed
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Azure CLI is not installed. Please install it first." -ForegroundColor Red
    Write-Host "   Install from: https://aka.ms/installazurecliwindows" -ForegroundColor Yellow
    exit 1
}

# Check Azure login
Write-Host "[AUTH] Checking Azure authentication..." -ForegroundColor Yellow
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "[ERROR] Not logged in to Azure CLI." -ForegroundColor Red
    Write-Host "   Run 'az login' first, then try again." -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Logged in as: $($account.user.name)" -ForegroundColor Green
Write-Host "   Subscription: $($account.name)" -ForegroundColor Gray
Write-Host ""

# Calculate tenant-specific resource names if multi-tenancy is enabled
$searchIndexName = if ($EnableMultiTenancy) { "$TenantId-documents" } else { "sa-gov-documents" }
$storageContainerName = if ($EnableMultiTenancy) { "$TenantId-documents" } else { "rag-documents" }
$cosmosGraphName = if ($EnableMultiTenancy) { "$TenantId-graph" } else { "career-graph" }
$cosmosDatabaseName = if ($EnableMultiTenancy) { "$TenantId-graphdb" } else { "graphdb" }

# Step 1: Deploy Core Infrastructure
Write-Host "[STEP 1/7] Deploying Core Infrastructure..." -ForegroundColor Yellow
Write-Host "   This creates: Storage, Document Intelligence, AI Search, Azure Functions, OpenAI (if enabled)" -ForegroundColor Gray
if ($EnableMultiTenancy) {
    Write-Host "   Tenant ID: $TenantId" -ForegroundColor Cyan
    Write-Host "   Search Index: $searchIndexName" -ForegroundColor Cyan
    Write-Host "   Storage Container: $storageContainerName" -ForegroundColor Cyan
}
Write-Host ""
& "$PSScriptRoot\deploy.ps1" -ResourceGroupName $ResourceGroupName -Location $Location -Environment $Environment -EnableOpenAI:$EnableOpenAI

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Infrastructure deployment failed!" -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "[OK] Step 1 Complete!" -ForegroundColor Green
Write-Host ""

# Step 2: Deploy OpenAI Model (if enabled)
if ($EnableOpenAI) {
    Write-Host "[STEP 2/7] Deploying OpenAI Embedding Model..." -ForegroundColor Yellow
    Write-Host "   Deploying text-embedding-3-large model" -ForegroundColor Gray
    Write-Host ""
    & "$PSScriptRoot\deploy-openai-model.ps1" -ResourceGroupName $ResourceGroupName

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] OpenAI model deployment had issues (may already be deployed or not available)" -ForegroundColor Yellow
    } else {
        Write-Host "[OK] Step 2 Complete!" -ForegroundColor Green
    }
    Write-Host ""
} else {
    Write-Host "[SKIP] Step 2/7: Skipping OpenAI model (not enabled)" -ForegroundColor Gray
    Write-Host ""
}

# Step 3: Create Search Index
Write-Host "[STEP 3/7] Creating Search Index..." -ForegroundColor Yellow
Write-Host "   Creating $searchIndexName index with vector fields" -ForegroundColor Gray
Write-Host ""
& "$PSScriptRoot\create-search-index.ps1" -ResourceGroupName $ResourceGroupName -IndexName $searchIndexName

if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARN] Search index creation had issues (may already exist)" -ForegroundColor Yellow
} else {
    Write-Host "[OK] Step 3 Complete!" -ForegroundColor Green
}
Write-Host ""

# Step 4: Deploy Cosmos DB Graph (for GraphRAG)
if ($DeployCosmosGraph) {
    Write-Host "[STEP 4/7] Deploying Cosmos DB Graph..." -ForegroundColor Yellow
    Write-Host "   Creating Gremlin API graph for GraphRAG knowledge extraction" -ForegroundColor Gray
    if ($EnableMultiTenancy) {
        Write-Host "   Tenant Database: $cosmosDatabaseName" -ForegroundColor Cyan
        Write-Host "   Tenant Graph: $cosmosGraphName" -ForegroundColor Cyan
    }
    Write-Host ""

    # Build path to deploy-graph.ps1 in scripts folder
    $deployGraphPath = Join-Path $PSScriptRoot "deploy-graph.ps1"

    if ($EnableMultiTenancy) {
        & $deployGraphPath -ResourceGroup $ResourceGroupName -Location $Location -AccountName "careercraft-graph-$Environment" -TenantId $TenantId -EnableMultiTenancy
    } else {
        & $deployGraphPath -ResourceGroup $ResourceGroupName -Location $Location -AccountName "careercraft-graph-$Environment"
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] Cosmos Graph deployment had issues (may already exist)" -ForegroundColor Yellow
    } else {
        Write-Host "[OK] Step 4 Complete!" -ForegroundColor Green
    }
    Write-Host ""
} else {
    Write-Host "[SKIP] Step 4/7: Skipping Cosmos DB Graph (DeployCosmosGraph = false)" -ForegroundColor Gray
    Write-Host ""
}

# Step 5: Deploy Azure Functions
if ($DeployAzureFunctions) {
    Write-Host "[STEP 5/7] Deploying Azure Functions..." -ForegroundColor Yellow
    Write-Host "   Deploying serverless functions for RAG metadata and graph queries" -ForegroundColor Gray
    Write-Host ""

    # Build path to deploy-azure-functions.ps1 in scripts folder
    $deployFunctionsPath = Join-Path $PSScriptRoot "deploy-azure-functions.ps1"

    & $deployFunctionsPath -ResourceGroupName $ResourceGroupName -Environment $Environment -Location $Location

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] Azure Functions deployment had issues" -ForegroundColor Yellow
    } else {
        Write-Host "[OK] Step 5 Complete!" -ForegroundColor Green
    }
    Write-Host ""
} else {
    Write-Host "[SKIP] Step 5/7: Skipping Azure Functions (DeployAzureFunctions = false)" -ForegroundColor Gray
    Write-Host ""
}

# Step 6: Create tenant-specific storage container (if multi-tenancy enabled)
if ($EnableMultiTenancy) {
    Write-Host "[STEP 6/7] Creating Tenant Storage Container..." -ForegroundColor Yellow
    Write-Host "   Container: $storageContainerName" -ForegroundColor Gray
    Write-Host ""

    # Get storage account name
    $storageAccountName = az storage account list --resource-group $ResourceGroupName --query "[0].name" -o tsv

    # Create tenant-specific container
    az storage container create --name $storageContainerName --account-name $storageAccountName --auth-mode login 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] Container creation had issues (may already exist)" -ForegroundColor Yellow
    } else {
        Write-Host "[OK] Step 6 Complete - Container created!" -ForegroundColor Green
    }
    Write-Host ""
} else {
    Write-Host "[SKIP] Step 6/7: No tenant container needed (multi-tenancy disabled)" -ForegroundColor Gray
    Write-Host ""
}

# Step 7: Configure Web Scraping (optional)
if (-not $SkipWebScraping) {
    Write-Host "[STEP 7/7] Configuring Web Scraping..." -ForegroundColor Yellow
    Write-Host "   Setting up indexers to crawl websites" -ForegroundColor Gray
    Write-Host ""
    & "$PSScriptRoot\..\web-scraper\configure-web-scraping.ps1" -ResourceGroupName $ResourceGroupName -SearchIndexName $searchIndexName

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] Web scraping configuration had issues" -ForegroundColor Yellow
    } else {
        Write-Host "[OK] Step 7 Complete!" -ForegroundColor Green
    }
    Write-Host ""
} else {
    Write-Host "[SKIP] Step 7/7: Skipping Web Scraping (SkipWebScraping flag set)" -ForegroundColor Gray
    Write-Host ""
}

Write-Host ("=" * 80) -ForegroundColor Green
Write-Host "[SUCCESS] Deployment Complete!" -ForegroundColor Green
if ($EnableMultiTenancy) {
    Write-Host "[Tenant: $TenantId]" -ForegroundColor Magenta
}
Write-Host ("=" * 80) -ForegroundColor Green
Write-Host ""

Write-Host "[NEXT STEPS]" -ForegroundColor Cyan
Write-Host "1. Copy API keys from Step 1 output above" -ForegroundColor Yellow
Write-Host "2. Store keys in Supabase Environment Variables (NOT in Git!)" -ForegroundColor Yellow
if ($EnableMultiTenancy) {
    Write-Host "3. [MULTI-TENANCY] Add tenant configuration to your application:" -ForegroundColor Yellow
    Write-Host "   VITE_TENANT_ID=$TenantId" -ForegroundColor White
    Write-Host "   VITE_SEARCH_INDEX=$searchIndexName" -ForegroundColor White
    Write-Host "   VITE_STORAGE_CONTAINER=$storageContainerName" -ForegroundColor White
    Write-Host "4. Upload PDFs to tenant-specific container:" -ForegroundColor Yellow
    Write-Host "   az storage blob upload-batch --account-name <storage-account> --source <pdf-folder> --destination $storageContainerName --auth-mode login" -ForegroundColor White
} else {
    Write-Host "3. Upload PDFs to Blob Storage (when ready):" -ForegroundColor Yellow
    Write-Host "   az storage blob upload-batch --account-name <storage-account> --source <pdf-folder> --destination rag-documents --auth-mode login" -ForegroundColor White
}
Write-Host "5. Process PDFs and populate graph (when ready):" -ForegroundColor Yellow
Write-Host "   .\scripts\process-pdfs.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
if ($DeployCosmosGraph) {
    Write-Host "   .\scripts\populate-graph.ps1 -ResourceGroup $ResourceGroupName" -ForegroundColor White
}
Write-Host ""

if ($EnableMultiTenancy) {
    Write-Host "[MULTI-TENANCY INFO]" -ForegroundColor Magenta
    Write-Host "To deploy additional tenants, run:" -ForegroundColor Cyan
    Write-Host "  .\scripts\deploy-all.ps1 -ResourceGroupName $ResourceGroupName -EnableMultiTenancy -TenantId <new-tenant-id>" -ForegroundColor White
    Write-Host ""
    Write-Host "Tenant Isolation Strategy:" -ForegroundColor Cyan
    Write-Host "  - Shared: Azure resources (Storage Account, Search Service, Functions, Cosmos DB Account)" -ForegroundColor White
    Write-Host "  - Per-Tenant: Search indexes, Storage containers, Cosmos graphs" -ForegroundColor White
    Write-Host "  - Cost: ~\$10-20/month per additional tenant" -ForegroundColor Green
    Write-Host ""
}

Write-Host "[DOCUMENTATION]" -ForegroundColor Cyan
Write-Host "  - Deployment order: docs/DEPLOYMENT-ORDER.md" -ForegroundColor White
Write-Host "  - Security: docs/SECURITY-AUDIT.md" -ForegroundColor White
Write-Host "  - Storage: docs/STORAGE-ARCHITECTURE.md" -ForegroundColor White
if ($EnableMultiTenancy) {
    Write-Host "  - Multi-tenancy: docs/MULTI-TENANCY.md" -ForegroundColor White
}
Write-Host ""

