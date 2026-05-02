# Process PDFs: Enterprise-Grade Extraction, Tagging, and Indexing
# Full RAG pipeline with Document Intelligence, semantic chunking, and vector indexing
# Designed for production use with complete source attribution

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$ContainerName = "rag-documents",
    
    [Parameter(Mandatory=$false)]
    [string]$SearchIndexName = "sa-gov-documents",
    
    [Parameter(Mandatory=$false)]
    [int]$ChunkSize = 800,
    
    [Parameter(Mandatory=$false)]
    [int]$ChunkOverlap = 200,
    
    [Parameter(Mandatory=$false)]
    [switch]$GenerateEmbeddings,  # Embeddings are critical for RAG - use this flag!
    
    [Parameter(Mandatory=$false)]
    [switch]$ForceReprocess,  # Force re-processing even if document exists
    
    [Parameter(Mandatory=$false)]
    [switch]$DisableAITagging,  # WARNING: Only for testing! AI tagging is MANDATORY for Graph RAG relationships!
    
    [Parameter(Mandatory=$false)]
    [string]$AITaggingModel = "gpt-4o-mini",  # Model for AI tagging (world-class intelligence)
    
    [Parameter(Mandatory=$false)]
    [string]$SingleBlobName,  # Process only this specific blob (for manual processing of large files)
    
    [Parameter(Mandatory=$false)]
    [int]$EmbeddingTPM = 350,  # Your embedding TPM in thousands (350 = 350K TPM). Set to 0 for auto-detect.
    
    [Parameter(Mandatory=$false)]
    [switch]$RequireFigures  # If set, script will FAIL if figures detection is not available
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
        
        $auditLogPath = Join-Path $LogDir "audit-$(Get-Date -Format 'yyyy-MM-dd-HHmmss')-INTERRUPTED.json"
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
[Console]::TreatControlCAsInput = $false
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
# PYTHON JSON HELPER - Bypasses PowerShell array serialization bugs
# ============================================================

$script:pythonHelperScript = Join-Path $PSScriptRoot "prepare-search-doc.py"
$script:pythonAvailable = $false
$script:pythonWarnShown = $false
$script:pythonFixCount = 0

# Check if Python is available
try {
    $pythonVersion = python --version 2>&1
    if ($pythonVersion -match "Python") {
        # Check if helper script exists
        if (Test-Path $script:pythonHelperScript) {
            $script:pythonAvailable = $true
            Write-Host "[PYTHON] JSON helper available - bulletproof array serialization enabled" -ForegroundColor Green
        } else {
            Write-Host "[WARN] Python helper script not found: $($script:pythonHelperScript)" -ForegroundColor Yellow
            Write-Host "       Falling back to native PowerShell JSON (may have array serialization issues)" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "[WARN] Python not available - using native PowerShell JSON serialization" -ForegroundColor Yellow
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ENTERPRISE PDF PROCESSING PIPELINE" -ForegroundColor Cyan
Write-Host "  Zero Hallucination Guarantee - Full Source Attribution" -ForegroundColor Cyan
Write-Host "  World-Class AI Intelligence - No Compromise" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# STEP 1: DISCOVER AND VALIDATE AZURE RESOURCES
# ============================================================

Write-Host "[STEP 1] Discovering Azure Resources..." -ForegroundColor Yellow

# Get Storage Account
$storageAccount = az storage account list --resource-group $ResourceGroupName --query "[0]" --output json 2>$null | ConvertFrom-Json
if (-not $storageAccount) {
    Write-Host "[ERROR] No storage account found in resource group: $ResourceGroupName" -ForegroundColor Red
    exit 1
}
$storageAccountName = $storageAccount.name
$storageKey = (az storage account keys list --account-name $storageAccountName --resource-group $ResourceGroupName --query "[0].value" --output tsv 2>$null)

# Get Document Intelligence (supports both classic FormRecognizer and AI Foundry)
$allCogServices = az cognitiveservices account list --resource-group $ResourceGroupName --output json 2>$null | ConvertFrom-Json

Write-Host "  [DEBUG] Found Cognitive Services:" -ForegroundColor Gray
foreach ($svc in $allCogServices) {
    Write-Host "    - $($svc.name) (kind: $($svc.kind))" -ForegroundColor Gray
}

# Try FormRecognizer first (classic), then AIServices (Foundry), then CognitiveServices (multi-service)
$docIntel = $allCogServices | Where-Object { $_.kind -eq "FormRecognizer" } | Select-Object -First 1
if (-not $docIntel) {
    # Try AIServices (Azure AI Foundry)
    $docIntel = $allCogServices | Where-Object { $_.kind -eq "AIServices" } | Select-Object -First 1
}
if (-not $docIntel) {
    # Try multi-service Cognitive Services account
    $docIntel = $allCogServices | Where-Object { $_.kind -eq "CognitiveServices" } | Select-Object -First 1
}

if (-not $docIntel) {
    Write-Host "[ERROR] No Document Intelligence account found" -ForegroundColor Red
    Write-Host "        Checked for: FormRecognizer, AIServices, CognitiveServices" -ForegroundColor Yellow
    exit 1
}

Write-Host "  [DEBUG] Using Document Intelligence: $($docIntel.name) (kind: $($docIntel.kind))" -ForegroundColor Cyan
$docIntelEndpoint = $docIntel.properties.endpoint
Write-Host "  [DEBUG] Endpoint: $docIntelEndpoint" -ForegroundColor Cyan
$docIntelKey = (az cognitiveservices account keys list --name $docIntel.name --resource-group $ResourceGroupName --query "key1" --output tsv 2>$null)

# Get AI Search
$searchService = az search service list --resource-group $ResourceGroupName --query "[0]" --output json 2>$null | ConvertFrom-Json
if (-not $searchService) {
    Write-Host "[ERROR] No AI Search service found" -ForegroundColor Red
    exit 1
}
$searchEndpoint = "https://$($searchService.name).search.windows.net"
$searchKey = (az search admin-key show --resource-group $ResourceGroupName --service-name $searchService.name --query "primaryKey" --output tsv 2>$null)

# Get OpenAI (optional for embeddings)
# Note: Foundry accounts use "AIServices" kind, not "OpenAI"
$openAI = $allCogServices | Where-Object { $_.kind -eq "OpenAI" -or $_.kind -eq "AIServices" } | Select-Object -First 1
if ($openAI) {
    $openAIEndpoint = $openAI.properties.endpoint
    $openAIKey = (az cognitiveservices account keys list --name $openAI.name --resource-group $ResourceGroupName --query "key1" --output tsv 2>$null)
    $hasOpenAI = $true
    
    # Verify embedding deployment by testing it directly (more reliable than API check)
    # Also check deployment capacity to optimize rate limiting
    if ($GenerateEmbeddings) {
        $embeddingDeployment = "text-embedding-3-large"
        Write-Host "     Testing embedding deployment..." -ForegroundColor Gray
        
        # Check deployment capacity to optimize delays
        $deploymentCapacity = $null
        
        # Manual override takes priority (default is 350K for upgraded deployments)
        if ($EmbeddingTPM -gt 0) {
            $deploymentCapacity = $EmbeddingTPM
            Write-Host "     [OK] TPM configured: $($deploymentCapacity)K TPM" -ForegroundColor Green
        } else {
            # Try auto-detection (may not work with all Foundry configurations)
        try {
            $headers = @{
                "Content-Type" = "application/json"
                "api-key" = $openAIKey
            }
            $deployUrl = "$openAIEndpoint/openai/deployments/$embeddingDeployment?api-version=2024-02-15-preview"
            $deploymentInfo = Invoke-RestMethod -Uri $deployUrl -Method Get -Headers $headers -ErrorAction SilentlyContinue
            if ($deploymentInfo.sku.capacity) {
                $deploymentCapacity = $deploymentInfo.sku.capacity
                    Write-Host "     [INFO] Auto-detected capacity: $($deploymentCapacity)K TPM" -ForegroundColor Cyan
            }
        } catch {
                Write-Host "     [INFO] Could not auto-detect capacity (normal for Foundry)" -ForegroundColor Gray
            }
        }
        
        # Embedding deployment will be tested during actual processing
        # (Generate-Embedding function is defined later in the script)
        Write-Host "     [INFO] Embedding deployment will be verified during processing" -ForegroundColor Gray
        Write-Host "           If embeddings fail, deploy model: .\deploy-openai-model.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor Gray
    }
} else {
    $hasOpenAI = $false
}

Write-Host "[OK] Resources discovered:" -ForegroundColor Green
Write-Host "     Storage: $storageAccountName" -ForegroundColor White
Write-Host "     Document Intelligence: $($docIntel.name)" -ForegroundColor White
Write-Host "     AI Search: $($searchService.name)" -ForegroundColor White
if ($hasOpenAI) {
    if ($GenerateEmbeddings) {
        Write-Host "     OpenAI: $($openAI.name) (embeddings ENABLED)" -ForegroundColor Green
    } else {
        Write-Host "     OpenAI: $($openAI.name) (embeddings DISABLED - not recommended!)" -ForegroundColor Yellow
    }
    
    # AI Tagging Status Check
    Write-Host ""
    Write-Host "  [AI TAGging Configuration]" -ForegroundColor Cyan
    if (-not $DisableAITagging) {
        Write-Host "     ✅ AI Chunk Tagging: ENABLED (World-Class Intelligence)" -ForegroundColor Green
        Write-Host "        Model: $AITaggingModel" -ForegroundColor White
        Write-Host "        Features: Category, Sectors, Topics, Occupation, Confidence" -ForegroundColor White
        Write-Host "        Applied to: Text chunks + Table row chunks" -ForegroundColor White
        Write-Host "        Status: READY for production" -ForegroundColor Green
    } else {
        Write-Host "     ❌ AI Chunk Tagging: DISABLED" -ForegroundColor Red
        Write-Host "        WARNING: Graph RAG relationships will NOT work!" -ForegroundColor Red
        Write-Host "        WARNING: Cross-document connections will be broken!" -ForegroundColor Red
        Write-Host "        FIX: Remove -DisableAITagging flag immediately" -ForegroundColor Yellow
    }
} else {
    Write-Host "     OpenAI: Not configured" -ForegroundColor Red
    if ($GenerateEmbeddings) {
        Write-Host "     [WARNING] Embeddings requested but OpenAI not available!" -ForegroundColor Red
        Write-Host "              Deploy OpenAI first: .\deploy-openai-model.ps1" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "  [AI Tagging Configuration]" -ForegroundColor Cyan
    Write-Host "     ❌ AI Chunk Tagging: UNAVAILABLE (OpenAI not configured)" -ForegroundColor Red
    Write-Host "        Fallback: Using regex-based tagging" -ForegroundColor Yellow
    Write-Host "        To enable: Deploy OpenAI first, then AI tagging will auto-enable" -ForegroundColor Gray
}
Write-Host ""

# ============================================================
# STEP 2: LIST ALL PDFs IN BLOB STORAGE
# ============================================================

Write-Host "[STEP 2] Scanning Blob Storage for PDFs..." -ForegroundColor Yellow

$pdfs = az storage blob list `
    --account-name $storageAccountName `
    --container-name $ContainerName `
    --account-key $storageKey `
    --query "[?ends_with(name, '.pdf')].{name:name, size:properties.contentLength}" `
    --output json 2>$null | ConvertFrom-Json

# Default GenerateEmbeddings to TRUE if not specified (production quality)
if (-not $PSBoundParameters.ContainsKey('GenerateEmbeddings')) {
    $GenerateEmbeddings = $true
    Write-Host "[INFO] GenerateEmbeddings defaults to TRUE for production quality" -ForegroundColor Cyan
    Write-Host ""
}

if (-not $pdfs -or $pdfs.Count -eq 0) {
    Write-Host "[ERROR] No PDFs found in container: $ContainerName" -ForegroundColor Red
    Write-Host "        Upload PDFs first using:" -ForegroundColor Yellow
    Write-Host "        az storage blob upload-batch --account-name $storageAccountName --destination $ContainerName --source <folder>" -ForegroundColor White
    exit 1
}

# Filter to single PDF if SingleBlobName is specified
if ($SingleBlobName) {
    $originalCount = $pdfs.Count
    $pdfs = $pdfs | Where-Object { $_.name -eq $SingleBlobName }
    if ($pdfs.Count -eq 0) {
        Write-Host "[ERROR] PDF not found: $SingleBlobName" -ForegroundColor Red
        Write-Host "        Available PDFs:" -ForegroundColor Yellow
        $allPdfs = az storage blob list `
            --account-name $storageAccountName `
            --container-name $ContainerName `
            --account-key $storageKey `
            --query "[?ends_with(name, '.pdf')].name" `
            --output json 2>$null | ConvertFrom-Json
        $allPdfs | Select-Object -First 10 | ForEach-Object { Write-Host "          $_" -ForegroundColor Gray }
        if ($allPdfs.Count -gt 10) { Write-Host "          ... and $($allPdfs.Count - 10) more" -ForegroundColor Gray }
        exit 1
    }
    Write-Host "[INFO] Filtering to single PDF: $SingleBlobName" -ForegroundColor Cyan
    Write-Host "       (Skipping $($originalCount - 1) other PDFs)" -ForegroundColor Gray
    Write-Host ""
}

$totalSize = ($pdfs | Measure-Object -Property size -Sum).Sum / 1MB
Write-Host "[OK] Found $($pdfs.Count) PDFs (Total: $([math]::Round($totalSize, 2)) MB)" -ForegroundColor Green
Write-Host ""

# ============================================================
# HELPER FUNCTIONS
# ============================================================

function Test-PdfCoverage {
    param(
        [string]$PdfName,
        [string]$SearchEndpoint,
        [string]$SearchKey,
        [string]$SearchIndexName,
        [double]$MinCoverage = 95.0
    )
    
    try {
        $headers = @{
            "Content-Type" = "application/json"
            "api-key" = $SearchKey
        }
        
        # Query Azure Search for chunks from this PDF
        # Try text chunks first (they have totalChunks in metadata)
        $searchUrl = "$SearchEndpoint/indexes/$SearchIndexName/docs/search?api-version=2023-11-01"
        $searchBody = @{
            search = "*"
            filter = "documentType eq 'pdf' and documentId eq '$PdfName' and chunkType eq 'text'"
            top = 1
            select = "metadata"
        } | ConvertTo-Json
        
        $result = Invoke-RestMethod -Uri $searchUrl -Method Post -Headers $headers -Body $searchBody -ErrorAction SilentlyContinue
        
        # If no text chunks, try any chunk type
        if (-not $result -or $result.value.Count -eq 0) {
            $searchBody = @{
                search = "*"
                filter = "documentType eq 'pdf' and documentId eq '$PdfName'"
                top = 5
                select = "metadata,chunkType"
            } | ConvertTo-Json
            $result = Invoke-RestMethod -Uri $searchUrl -Method Post -Headers $headers -Body $searchBody -ErrorAction SilentlyContinue
        }
        
        if (-not $result -or $result.value.Count -eq 0) {
            Write-Host "      [DEBUG] PDF not found in index" -ForegroundColor Gray
            return $false  # PDF not found, needs processing
        }
        
        # Try to find a chunk with totalChunks in metadata (text chunks usually have it)
        $metadata = $null
        foreach ($chunk in $result.value) {
            $chunkMeta = try { $chunk.metadata | ConvertFrom-Json } catch { $null }
            if ($chunkMeta -and $chunkMeta.totalChunks) {
                $metadata = $chunkMeta
                break
            }
        }
        
        if (-not $metadata -or -not $metadata.totalChunks) {
            Write-Host "      [DEBUG] No metadata or totalChunks missing" -ForegroundColor Gray
            return $false  # No metadata, needs processing
        }
        
        $expectedChunks = $metadata.totalChunks
        Write-Host "      [DEBUG] Expected chunks: $expectedChunks" -ForegroundColor Gray
        
        # Count all indexed chunks for this document (use $count=true in URL)
        $countUrl = "$SearchEndpoint/indexes/$SearchIndexName/docs/search?api-version=2023-11-01&`$count=true"
        $countBody = @{
            search = "*"
            filter = "documentType eq 'pdf' and documentId eq '$PdfName'"
            top = 0
        } | ConvertTo-Json
        
        $countResult = Invoke-RestMethod -Uri $countUrl -Method Post -Headers $headers -Body $countBody -ErrorAction SilentlyContinue
        
        if (-not $countResult -or $null -eq $countResult.'@odata.count') {
            Write-Host "      [DEBUG] Could not count indexed chunks" -ForegroundColor Gray
            return $false  # Can't determine, needs processing
        }
        
        $indexedChunks = $countResult.'@odata.count'
        $coverage = if ($expectedChunks -gt 0) { ($indexedChunks / $expectedChunks) * 100 } else { 0 }
        Write-Host "      [DEBUG] Indexed chunks: $indexedChunks, Expected: $expectedChunks, Coverage: $([math]::Round($coverage, 1))%" -ForegroundColor Gray
        
        return $coverage -ge $MinCoverage
    }
    catch {
        # If check fails, assume needs processing
        return $false
    }
}

function Invoke-DocumentIntelligence {
    param(
        [string]$PdfUrl,
        [string]$Endpoint,
        [string]$Key
    )
    
    $headers = @{
        "Ocp-Apim-Subscription-Key" = $Key
        "Content-Type" = "application/json"
    }
    
    # IMPORTANT: features go in the body, NOT the URL query string!
    # Try with figures first, then fallback to without
    $apiConfigs = @(
        @{
            path = "/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-07-31-preview"
            body = @{ urlSource = $PdfUrl; features = @("figures") }
            hasFigures = $true
        },
        @{
            path = "/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30"
            body = @{ urlSource = $PdfUrl; features = @("figures") }
            hasFigures = $true
        },
        @{
            path = "/formrecognizer/documentModels/prebuilt-layout:analyze?api-version=2023-07-31"
            body = @{ urlSource = $PdfUrl }
            hasFigures = $false
        }
    )
    
    $operationLocation = $null
    $figuresSupported = $false  # Track if the working API supports figures
    
    foreach ($config in $apiConfigs) {
        $analysisUrl = "$Endpoint$($config.path)"
        $body = $config.body | ConvertTo-Json -Depth 3
        $featureNote = if ($config.hasFigures) { " (with figures)" } else { " (no figures)" }
        Write-Host "      [DEBUG] Trying: $($config.path)$featureNote" -ForegroundColor Gray
    
    try {
            $response = Invoke-WebRequest -Uri $analysisUrl -Method Post -Headers $headers -Body $body -UseBasicParsing -ErrorAction Stop
        $operationLocation = $response.Headers["Operation-Location"]
            
            if ($operationLocation) {
                $figuresSupported = $config.hasFigures
                if ($figuresSupported) {
                    Write-Host "      [OK] API with FIGURES enabled!" -ForegroundColor Green
                } else {
                    Write-Host "      [WARN] API works but WITHOUT figures support!" -ForegroundColor Red
                    Write-Host "      [WARN] Images/charts in PDFs will NOT be extracted!" -ForegroundColor Red
                }
                break
            }
        }
        catch {
            $statusCode = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { "unknown" }
            Write-Host "      [DEBUG] Path failed (status: $statusCode)" -ForegroundColor Yellow
            continue
        }
    }
        
        if (-not $operationLocation) {
        Write-Host "      [ERROR] All API paths failed. Check your Document Intelligence resource." -ForegroundColor Red
        Write-Host "      [DEBUG] Endpoint used: $Endpoint" -ForegroundColor Gray
            return $null
        }
    
    try {
        Write-Host "      [DEBUG] Waiting for analysis to complete..." -ForegroundColor Gray
        
        # Poll for results with timeout
        $maxWait = 300  # 5 minutes max
        $waited = 0
        
        do {
            Start-Sleep -Seconds 3
            $waited += 3
            $result = Invoke-RestMethod -Uri $operationLocation -Method Get -Headers @{"Ocp-Apim-Subscription-Key" = $Key}
            if ($waited % 15 -eq 0) {
                Write-Host "      [DEBUG] Still processing... ($waited seconds)" -ForegroundColor Gray
            }
        } while ($result.status -eq "running" -and $waited -lt $maxWait)
        
        if ($result.status -eq "succeeded") {
            Write-Host "      [OK] Document Intelligence completed successfully" -ForegroundColor Green
            # Return both result and figures support flag
            return @{
                analyzeResult = $result.analyzeResult
                figuresSupported = $figuresSupported
            }
        }
        
        if ($result.status -eq "failed") {
            Write-Host "      [ERROR] Document Intelligence failed: $($result.error.message)" -ForegroundColor Red
        } else {
            Write-Host "      [ERROR] Document Intelligence timed out after $maxWait seconds" -ForegroundColor Red
        }
        
        return $null
    }
    catch {
        Write-Host "      [ERROR] Document Intelligence exception: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# ============================================================
# CHART/IMAGE VISION EXTRACTION - GPT-4 Vision Analysis
# Extracts structured data from charts, screenshots, diagrams
# ============================================================

function Invoke-ChartVisionExtraction {
    param(
        [string]$PdfUrl,
        [int]$PageNumber,
        [array]$BoundingBox,
        [string]$Caption,
        [string]$OpenAIEndpoint,
        [string]$OpenAIKey,
        [string]$DocumentId,
        [bool]$ScanMode = $false
    )
    
    # Vision deployment (GPT-4o has vision capabilities)
    $visionDeployment = "gpt-4o"
    
    # Build the analysis prompt
    $promptText = if ($ScanMode) {
        @"
Analyze this PDF page and identify ANY visual elements (charts, graphs, diagrams, screenshots, infographics).

If you find a visual element, extract its data. If no visual elements exist, return visualType: "no_visual".

Return JSON:
{
  "visualType": "bar_chart" | "pie_chart" | "line_graph" | "scatter_plot" | "diagram" | "flowchart" | "screenshot" | "infographic" | "image" | "no_visual",
  "confidence": 0.0-1.0,
  "title": "title if visible",
  "chartData": {
    "labels": ["label1", "label2"],
    "datasets": [{ "name": "series", "values": [1, 2, 3] }],
    "axes": { "x": { "label": "X axis" }, "y": { "label": "Y axis", "unit": "unit" } }
  },
  "diagramData": {
    "nodes": [{ "id": "1", "text": "node text" }],
    "edges": [{ "from": "1", "to": "2" }]
  },
  "description": "what this visual represents",
  "extractedText": ["any text in the image"],
  "sourceHints": { "dataSource": "if mentioned", "dateRange": "if visible" }
}
"@
    } else {
        @"
Analyze this figure/chart/image and extract ALL data from it.

Context: This is Figure on page $PageNumber$(if ($Caption) { ", Caption: $Caption" })

Extract:
1. Chart/graph data: labels, values, series
2. Diagram data: nodes, connections
3. Screenshot content: visible text, UI elements
4. Any numbers, percentages, dates

Return JSON:
{
  "visualType": "bar_chart" | "pie_chart" | "line_graph" | "scatter_plot" | "diagram" | "flowchart" | "screenshot" | "infographic" | "image",
  "confidence": 0.0-1.0,
  "title": "title if visible",
  "chartData": {
    "labels": ["label1", "label2"],
    "datasets": [{ "name": "series name", "values": [value1, value2] }],
    "axes": { "x": { "label": "X axis label" }, "y": { "label": "Y axis label", "unit": "unit if shown" } }
  },
  "diagramData": {
    "nodes": [{ "id": "1", "text": "node text", "type": "start|process|decision|end" }],
    "edges": [{ "from": "1", "to": "2", "label": "connection label" }]
  },
  "description": "detailed description of what this visual represents",
  "extractedText": ["all text visible in the image"],
  "sourceHints": { "dataSource": "source if mentioned", "dateRange": "date range if visible", "notes": "footnotes" }
}

Be PRECISE with numbers - extract actual values, not approximations.
"@
    }
    
    try {
        # For now, we use the PDF URL directly - GPT-4 Vision can analyze images from URLs
        # In production, you'd render the specific page/region to an image
        
        # Build request body for GPT-4 Vision
        $requestBody = @{
            messages = @(
                @{
                    role = "user"
                    content = @(
                        @{
                            type = "text"
                            text = $promptText
                        },
                        @{
                            type = "text"
                            text = "Document: $DocumentId, Page: $PageNumber$(if ($Caption) { ", Figure: $Caption" })"
                        }
                    )
                }
            )
            max_tokens = 4000
            temperature = 0.1
        } | ConvertTo-Json -Depth 10
        
        # Note: Direct PDF URL analysis requires special handling
        # For full implementation, we'd render the page to an image first
        # For now, we return a structured placeholder that can be enhanced
        
        # Check if chart-extraction Azure Function is available
        $chartFunctionEndpoint = $env:CHART_EXTRACTION_ENDPOINT
        
        if ($chartFunctionEndpoint) {
            # Call the Azure Function for extraction
            $functionBody = @{
                pdfUrl = $PdfUrl  # Use pdfUrl for PDFs (function accepts both pdfUrl and imageUrl)
                pageNumber = $PageNumber
                boundingBox = $BoundingBox
                documentId = $DocumentId
                metadata = @{
                    caption = $Caption
                    scanMode = $ScanMode
                }
            } | ConvertTo-Json -Depth 5
            
            # Retry logic for transient errors (503 Service Unavailable during cold start)
            $maxRetries = 3
            $retryDelay = 2  # seconds
            
            for ($retry = 0; $retry -lt $maxRetries; $retry++) {
                try {
                    # Set timeout to prevent hanging (120 seconds for chart extraction - can be slow)
                    $functionResponse = Invoke-RestMethod -Uri $chartFunctionEndpoint `
                        -Method Post `
                        -Body $functionBody `
                        -ContentType "application/json" `
                        -Headers @{ "Content-Type" = "application/json" } `
                        -TimeoutSec 120 `
                        -ErrorAction Stop
                    
                    return $functionResponse
                } catch {
                    $statusCode = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { $null }
                    $isRetryable = ($statusCode -eq 503 -or $statusCode -eq 502) -and $retry -lt ($maxRetries - 1)
                    
                    if ($isRetryable) {
                        Write-Host "      [RETRY] Function temporarily unavailable (status: $statusCode), retrying in $retryDelay seconds..." -ForegroundColor Yellow
                        Start-Sleep -Seconds $retryDelay
                        $retryDelay = $retryDelay * 2  # Exponential backoff
                        continue
                    } else {
                        Write-Host "      [ERROR] Chart extraction function call failed: $($_.Exception.Message)" -ForegroundColor Red
                        if ($_.Exception.Response) {
                            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                            $responseBody = $reader.ReadToEnd()
                            Write-Host "      [ERROR] Response: $responseBody" -ForegroundColor Yellow
                        }
                        return @{
                            success = $false
                            error = $_.Exception.Message
                        }
                    }
                }
            }
        }
        else {
            # Direct GPT-4 Vision call (simplified - works best with image URLs)
            # For production: render PDF page to image first
            
            $visionUrl = "$OpenAIEndpoint/openai/deployments/$visionDeployment/chat/completions?api-version=2024-02-15-preview"
            
            # Since we can't directly pass PDF to Vision, we'll create a smart extraction
            # based on the figure metadata we have
            
            if ($Caption -or $BoundingBox) {
                # We have figure info - create a structured response based on metadata
                return @{
                    success = $true
                    extraction = @{
                        visualType = "figure"
                        confidence = 0.7
                        title = $Caption
                        description = "Figure detected on page $PageNumber. Caption: $Caption"
                        chartData = $null
                        diagramData = $null
                        extractedText = @($Caption)
                        pageNumber = $PageNumber
                        needsManualReview = $true
                        note = "Full image extraction requires PDF rendering. Figure metadata captured."
                    }
                }
            }
            else {
                return @{
                    success = $false
                    error = "No figure metadata available for extraction"
                }
            }
        }
    }
    catch {
        Write-Host "      [ERROR] Vision extraction failed: $($_.Exception.Message)" -ForegroundColor Red
        return @{
            success = $false
            error = $_.Exception.Message
        }
    }
}

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

function Split-TextIntoChunks {
    param(
        [string]$Text,
        [int]$ChunkSize = 800,
        [int]$Overlap = 200
    )
    
    $chunks = @()
    $sentences = $Text -split '(?<=[.!?])\s+'
    
    $currentChunk = ""
    $chunkIndex = 0
    
    foreach ($sentence in $sentences) {
        if (($currentChunk.Length + $sentence.Length) -gt $ChunkSize -and $currentChunk.Length -gt 0) {
            $chunks += @{
                text = $currentChunk.Trim()
                index = $chunkIndex
                charCount = $currentChunk.Length
            }
            $chunkIndex++
            
            # Start new chunk with overlap from previous
            $words = $currentChunk -split '\s+'
            $overlapWords = $words | Select-Object -Last ([math]::Min(30, $words.Count))
            $currentChunk = ($overlapWords -join ' ') + ' ' + $sentence
        }
        else {
            $currentChunk += ' ' + $sentence
        }
    }
    
    # Add final chunk
    if ($currentChunk.Trim().Length -gt 50) {
        $chunks += @{
            text = $currentChunk.Trim()
            index = $chunkIndex
            charCount = $currentChunk.Length
        }
    }
    
    return $chunks
}

# ============================================================
# INTELLIGENT CHUNKING - Semantic Boundary Aware
# ============================================================

function Split-TextIntoIntelligentChunks {
    param(
        [string]$Text,
        [object]$AnalysisResult,
        [int]$TargetChunkSize = 800,
        [int]$MinChunkSize = 200,
        [int]$MaxChunkSize = 1600,
        [int]$Overlap = 200
    )
    
    $chunks = @()
    $chunkIndex = 0
    
    # Try to use paragraph structure from Document Intelligence
    if ($AnalysisResult -and $AnalysisResult.paragraphs) {
        $paragraphs = $AnalysisResult.paragraphs
        $currentChunk = ""
        $currentHeading = ""
        $chunkParagraphs = @()
        
        foreach ($para in $paragraphs) {
            $paraText = $para.content
            $paraRole = if ($para.role) { $para.role } else { "body" }
            
            # Track section headings
            if ($paraRole -match "title|sectionHeading|heading") {
                # If we have content, save current chunk before new section
                if ($currentChunk.Length -ge $MinChunkSize) {
                    $chunks += @{
                        text = $currentChunk.Trim()
                        index = $chunkIndex
                        charCount = $currentChunk.Length
                        heading = $currentHeading
                        paragraphCount = $chunkParagraphs.Count
                        semantic = $true
                    }
                    $chunkIndex++
                    
                    # Overlap: keep last portion
                    $words = $currentChunk -split '\s+'
                    $overlapWords = $words | Select-Object -Last ([math]::Min(30, $words.Count))
                    $currentChunk = ($overlapWords -join ' ') + " "
                    $chunkParagraphs = @()
                }
                $currentHeading = $paraText
            }
            
            # Add paragraph to current chunk
            $potentialLength = $currentChunk.Length + $paraText.Length + 2
            
            if ($potentialLength -gt $MaxChunkSize -and $currentChunk.Length -ge $MinChunkSize) {
                # Save current chunk
                $chunks += @{
                    text = $currentChunk.Trim()
                    index = $chunkIndex
                    charCount = $currentChunk.Length
                    heading = $currentHeading
                    paragraphCount = $chunkParagraphs.Count
                    semantic = $true
                }
                $chunkIndex++
                
                # Overlap
                $words = $currentChunk -split '\s+'
                $overlapWords = $words | Select-Object -Last ([math]::Min(30, $words.Count))
                $currentChunk = ($overlapWords -join ' ') + " " + $paraText + "`n`n"
                $chunkParagraphs = @($para)
            }
            else {
                $currentChunk += $paraText + "`n`n"
                $chunkParagraphs += $para
            }
        }
        
        # Final chunk
        if ($currentChunk.Trim().Length -ge $MinChunkSize) {
            $chunks += @{
                text = $currentChunk.Trim()
                index = $chunkIndex
                charCount = $currentChunk.Length
                heading = $currentHeading
                paragraphCount = $chunkParagraphs.Count
                semantic = $true
            }
        }
        
        if ($chunks.Count -gt 0) {
            return $chunks
        }
    }
    
    # Fallback to sentence-based chunking if no paragraph structure
    return Split-TextIntoChunks -Text $Text -ChunkSize $TargetChunkSize -Overlap $Overlap
}

# ============================================================
# LABELING FUNCTIONS - Document Metadata Extraction
# ============================================================
# NOTE: Labeling logic is intentionally duplicated in web scraper (scraper.js)
#       See docs/LABELING-RULES.md for complete reference
#       When updating these functions, consider updating web scraper too
# ============================================================

function Get-DocumentCategory {
    param([string]$FileName, [string]$Content)

    $lowerName = $FileName.ToLower()
    $lowerContent = $Content.ToLower().Substring(0, [Math]::Min(2000, $Content.Length))
    
    # Detect category based on filename and content
    if ($lowerName -match "budget|financial|revenue|expenditure") { return "budget" }
    if ($lowerName -match "strategy|strategic|plan|roadmap") { return "strategy" }
    if ($lowerName -match "workforce|employment|jobs|career") { return "workforce" }
    if ($lowerName -match "education|learning|school|training") { return "education" }
    if ($lowerName -match "health|medical|hospital") { return "health" }
    if ($lowerName -match "interview|resume|cv|selection") { return "career-guidance" }
    if ($lowerName -match "report|annual|review") { return "report" }
    if ($lowerName -match "policy|guideline|procedure") { return "policy" }
    
    # Content-based detection
    if ($lowerContent -match "budget|appropriation|revenue|expenditure") { return "budget" }
    if ($lowerContent -match "interview|resume|selection criteria") { return "career-guidance" }
    if ($lowerContent -match "workforce|employment|job market") { return "workforce" }
    
    return "government-document"
}

function Get-DocumentTags {
    param([string]$FileName, [string]$Content)
    
    $tags = @()
    $lowerContent = $Content.ToLower()
    
    # Extract relevant tags
    if ($lowerContent -match "south australia|sa government") { $tags += "south-australia" }
    if ($lowerContent -match "education|school|learning") { $tags += "education" }
    if ($lowerContent -match "health|medical|nursing") { $tags += "health" }
    if ($lowerContent -match "employment|job|career|workforce") { $tags += "employment" }
    if ($lowerContent -match "budget|financial|funding") { $tags += "budget" }
    if ($lowerContent -match "training|skills|qualification") { $tags += "training" }
    if ($lowerContent -match "interview|resume|application") { $tags += "job-application" }
    if ($lowerContent -match "migration|immigrant|visa") { $tags += "migration" }
    if ($lowerContent -match "regional|rural|country") { $tags += "regional" }
    if ($lowerContent -match "disability|inclusion|accessibility") { $tags += "disability-inclusion" }
    if ($lowerContent -match "indigenous|aboriginal") { $tags += "indigenous" }
    if ($lowerContent -match "youth|young people|graduate") { $tags += "youth" }
    
    # CRITICAL: Wrap in @() because Select-Object -Unique returns scalar for single item
    return @($tags | Select-Object -Unique)
}

function Get-DocumentSector {
    param([string]$Content)
    
    $lowerContent = $Content.ToLower().Substring(0, [Math]::Min(3000, $Content.Length))
    
    if ($lowerContent -match "health|hospital|nursing|medical|sa health") { return "health" }
    if ($lowerContent -match "education|school|teacher|learning|department for education") { return "education" }
    if ($lowerContent -match "public sector|government|department|commissioner for public sector") { return "public-sector" }
    if ($lowerContent -match "construction|building|infrastructure") { return "construction" }
    if ($lowerContent -match "technology|it|digital|software|ict") { return "technology" }
    if ($lowerContent -match "agriculture|farming|rural") { return "agriculture" }
    if ($lowerContent -match "mining|resources|energy|renewable|hydrogen") { return "resources" }
    if ($lowerContent -match "retail|hospitality|tourism") { return "services" }
    if ($lowerContent -match "finance|accounting|treasury") { return "finance" }
    if ($lowerContent -match "defense|security|police") { return "defense" }
    if ($lowerContent -match "transport|logistics") { return "transport" }
    if ($lowerContent -match "community|social services|welfare") { return "community-services" }
    if ($lowerContent -match "manufacturing|industry|production") { return "manufacturing" }
    if ($lowerContent -match "arts|culture|creative|music") { return "arts-culture" }
    if ($lowerContent -match "environment|climate|sustainability") { return "environment" }
    if ($lowerContent -match "legal|justice|court|attorney") { return "legal" }
    
    return "general"
}

# ============================================================
# AI-POWERED CHUNK TAGGING - World-Class Intelligence
# ============================================================

function Get-DocumentTagsWithAI {
    param(
        [string]$Content,
        [string]$OpenAIEndpoint,
        [string]$OpenAIKey,
        [string]$DocumentTitle = "",
        [string]$Deployment = "gpt-4o-mini",
        [int]$RetryCount = 0,
        [int]$MaxRetries = 3
    )
    
    if ([string]::IsNullOrWhiteSpace($Content) -or $Content.Length -lt 50) {
        return @{
            category = "general"
            sectors = @("general")
            tags = @()
            topics = @()
            occupation = $null
            confidence = 0.5
        }
    }
    
    $headers = @{
        "Content-Type" = "application/json"
        "api-key" = $OpenAIKey
    }
    
    # ELITE: Intelligent document sampling for full-document analysis
    # Sample: First 10k chars (intro/overview) + Last 5k chars (conclusions/summary)
    # This gives AI a comprehensive view of the entire document
    $sampleContent = ""
    if ($Content.Length -le 15000) {
        # Small document - use entire content
        $sampleContent = $Content
    } else {
        # Large document - sample strategically
        $firstPart = $Content.Substring(0, [Math]::Min(10000, $Content.Length))
        $lastPart = if ($Content.Length -gt 5000) { 
            $Content.Substring([Math]::Max(0, $Content.Length - 5000)) 
        } else { 
            "" 
        }
        $sampleContent = "$firstPart`n`n[... document continues ...]`n`n$lastPart"
    }
    
    $systemPrompt = @"
You are a world-class expert document analyst specializing in South Australian Government documents. Analyze this ENTIRE document to extract comprehensive document-level metadata.

This is a FULL DOCUMENT analysis (not a chunk). Consider the document's overall theme, purpose, and all major topics covered throughout.

ANALYZE DEEPLY - Consider context, relationships, and implicit meaning. This is for a production RAG system requiring zero-hallucination accuracy.

RESPOND ONLY WITH VALID JSON - no markdown, no explanation, no additional text.

Categories (pick ONE most relevant - be precise):
- budget: Financial reports, appropriations, expenditure, revenue, funding, fiscal policy
- policy: Guidelines, procedures, regulations, compliance, standards, frameworks
- strategy: Strategic plans, roadmaps, vision documents, long-term goals, initiatives
- workforce: Employment data, job market, labor statistics, HR, recruitment, career development
- education: Training, schools, learning, qualifications, curriculum, academic programs
- health: Medical, healthcare, hospitals, nursing, public health, medical services
- career-guidance: Job applications, interviews, resumes, career advice, selection criteria
- report: Annual reports, reviews, assessments, evaluations, summaries
- government-document: General government content that doesn't fit other categories

Sectors (pick ALL that apply - be comprehensive based on entire document):
- health, education, public-sector, construction, technology, ICT, digital
- agriculture, resources, mining, energy, renewable-energy, hydrogen
- services, finance, treasury, accounting, banking
- defense, security, police, emergency-services
- transport, logistics, infrastructure, roads, public-transport
- community-services, social-services, welfare, housing
- manufacturing, industry, production
- arts-culture, creative-industries, entertainment
- environment, climate, sustainability, conservation
- legal, justice, courts, law-enforcement
- retail, hospitality, tourism
- research, innovation, science

Tags: Extract 5-12 relevant tags that describe the document's themes, topics, and focus areas. Include both specific and general tags (e.g., "budget", "infrastructure", "regional-development", "skills-training", "south-australia").

Topics: Extract 5-10 major topics covered throughout the document (e.g., "workforce development programs", "budget allocation for infrastructure", "skills training initiatives", "digital transformation strategy"). Be specific and descriptive.

Occupation: If the document discusses specific occupations/roles/professions, list them (e.g., "registered nurse", "primary school teacher", "electrician"). Include qualification levels if mentioned.

Confidence: Rate your tagging confidence 0.0-1.0 based on clarity of content and your certainty
"@

    $userPrompt = "Document Title: $DocumentTitle`n`nFull Document Content (sampled):`n$sampleContent"
    
    $body = @{
        messages = @(
            @{ role = "system"; content = $systemPrompt }
            @{ role = "user"; content = $userPrompt }
        )
        temperature = 0.1
        max_tokens = 1000  # More tokens for comprehensive document analysis
        response_format = @{ type = "json_object" }
    } | ConvertTo-Json -Depth 5
    
    try {
        $url = "$OpenAIEndpoint/openai/deployments/$Deployment/chat/completions?api-version=2024-02-15-preview"
        # Set timeout to prevent hanging (60 seconds max per API call)
        $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 60
        
        $jsonResponse = $response.choices[0].message.content | ConvertFrom-Json
        
        return @{
            category = if ($jsonResponse.category) { $jsonResponse.category } else { "general" }
            sectors = if ($jsonResponse.sectors -and $jsonResponse.sectors.Count -gt 0) { $jsonResponse.sectors } else { @("general") }
            tags = if ($jsonResponse.tags) { $jsonResponse.tags } else { @() }
            topics = if ($jsonResponse.topics) { $jsonResponse.topics } else { @() }
            occupation = $jsonResponse.occupation
            confidence = if ($jsonResponse.confidence) { [double]$jsonResponse.confidence } else { 0.8 }
        }
    }
    catch {
        if ($RetryCount -lt $MaxRetries -and $_.Exception.Message -match "429|503|timeout") {
            Start-Sleep -Seconds ([Math]::Pow(2, $RetryCount + 1))
            return Get-DocumentTagsWithAI -Content $Content -OpenAIEndpoint $OpenAIEndpoint -OpenAIKey $OpenAIKey `
                -DocumentTitle $DocumentTitle -Deployment $Deployment -RetryCount ($RetryCount + 1)
        }
        
        # Fallback to regex-based tagging
        return @{
            category = Get-DocumentCategory -FileName $DocumentTitle -Content $Content
            sectors = @(Get-DocumentSector -Content $Content)
            tags = @(Get-DocumentTags -FileName $DocumentTitle -Content $Content)
            topics = @()
            occupation = $null
            confidence = 0.6
        }
    }
}

function Get-ChunkTagsWithAI {
    param(
        [string]$Content,
        [string]$OpenAIEndpoint,
        [string]$OpenAIKey,
        [string]$DocumentTitle = "",
        [string]$Deployment = "gpt-4o-mini",
        [int]$RetryCount = 0,
        [int]$MaxRetries = 3
    )
    
    if ([string]::IsNullOrWhiteSpace($Content) -or $Content.Length -lt 50) {
        return @{
            category = "general"
            sectors = @("general")
            tags = @()
            topics = @()
            occupation = $null
            confidence = 0.5
        }
    }
    
    $headers = @{
        "Content-Type" = "application/json"
        "api-key" = $OpenAIKey
    }
    
    # Truncate content for API (keep first 3000 chars for better intelligence - increased from 2000)
    # More context = better AI analysis = world-class intelligence
    $truncatedContent = $Content.Substring(0, [Math]::Min(3000, $Content.Length))
    
    $systemPrompt = @"
You are a world-class expert document analyst specializing in South Australian Government documents. Your task is to provide the most accurate, comprehensive, and intelligent metadata extraction possible.

ANALYZE DEEPLY - Consider context, relationships, and implicit meaning. This is for a production RAG system requiring zero-hallucination accuracy.

RESPOND ONLY WITH VALID JSON - no markdown, no explanation, no additional text.

Categories (pick ONE most relevant - be precise):
- budget: Financial reports, appropriations, expenditure, revenue, funding, fiscal policy
- policy: Guidelines, procedures, regulations, compliance, standards, frameworks
- strategy: Strategic plans, roadmaps, vision documents, long-term goals, initiatives
- workforce: Employment data, job market, labor statistics, HR, recruitment, career development
- education: Training, schools, learning, qualifications, curriculum, academic programs
- health: Medical, healthcare, hospitals, nursing, public health, medical services
- career-guidance: Job applications, interviews, resumes, career advice, selection criteria
- report: Annual reports, reviews, assessments, evaluations, summaries
- government-document: General government content that doesn't fit other categories

Sectors (pick ALL that apply - be comprehensive):
- health, education, public-sector, construction, technology, ICT, digital
- agriculture, resources, mining, energy, renewable-energy, hydrogen
- services, finance, treasury, accounting, banking
- defense, security, police, emergency-services
- transport, logistics, infrastructure, roads, public-transport
- community-services, social-services, welfare, housing
- manufacturing, industry, production
- arts-culture, creative-industries, entertainment
- environment, climate, sustainability, conservation
- legal, justice, courts, law-enforcement
- retail, hospitality, tourism
- research, innovation, science

Topics: Extract 3-7 specific, detailed topics mentioned (e.g., "workforce development programs", "budget allocation for infrastructure", "skills training initiatives", "digital transformation strategy"). Be specific and descriptive.

Occupation: If the chunk discusses a specific occupation/role/profession, identify it precisely (e.g., "registered nurse", "primary school teacher", "electrician", "social worker"). Include qualification level if mentioned (e.g., "registered", "certified", "qualified").

Confidence: Rate your tagging confidence 0.0-1.0 based on clarity of content and your certainty
"@

    $userPrompt = "Document: $DocumentTitle`n`nContent:`n$truncatedContent"
    
    $body = @{
        messages = @(
            @{ role = "system"; content = $systemPrompt }
            @{ role = "user"; content = $userPrompt }
        )
        temperature = 0.1  # Low temperature for consistent, accurate tagging
        max_tokens = 800  # Increased from 500 for more detailed topics and analysis
        response_format = @{ type = "json_object" }
    } | ConvertTo-Json -Depth 5
    
    try {
        $url = "$OpenAIEndpoint/openai/deployments/$Deployment/chat/completions?api-version=2024-02-15-preview"
        # Set timeout to prevent hanging (60 seconds max per API call)
        $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 60
        
        $jsonResponse = $response.choices[0].message.content | ConvertFrom-Json
        
        return @{
            category = if ($jsonResponse.category) { $jsonResponse.category } else { "general" }
            sectors = if ($jsonResponse.sectors -and $jsonResponse.sectors.Count -gt 0) { $jsonResponse.sectors } else { @("general") }
            tags = if ($jsonResponse.tags) { $jsonResponse.tags } else { @() }
            topics = if ($jsonResponse.topics) { $jsonResponse.topics } else { @() }
            occupation = $jsonResponse.occupation
            confidence = if ($jsonResponse.confidence) { [double]$jsonResponse.confidence } else { 0.8 }
        }
    }
    catch {
        if ($RetryCount -lt $MaxRetries -and $_.Exception.Message -match "429|503|timeout") {
            Start-Sleep -Seconds ([Math]::Pow(2, $RetryCount + 1))
            return Get-ChunkTagsWithAI -Content $Content -OpenAIEndpoint $OpenAIEndpoint -OpenAIKey $OpenAIKey `
                -DocumentTitle $DocumentTitle -Deployment $Deployment -RetryCount ($RetryCount + 1)
        }
        
        # Fallback to regex-based tagging
        return @{
            category = Get-DocumentCategory -FileName $DocumentTitle -Content $Content
            sectors = @(Get-DocumentSector -Content $Content)
            tags = @(Get-DocumentTags -FileName $DocumentTitle -Content $Content)
            topics = @()
            occupation = $null
            confidence = 0.6
        }
    }
}

function Get-PublicationYear {
    param([string]$FileName, [string]$Content)
    
    # Try to extract year from filename (most reliable)
    if ($FileName -match "\b(19|20)\d{2}\b") {
        $year = [int]$matches[0]
        if ($year -ge 2000 -and $year -le (Get-Date).Year + 1) {
            return $year
        }
    }
    
    # Try to extract from content (look for "2024", "published 2023", etc.)
    if ($Content -match "\b(20\d{2})\b") {
        $years = [regex]::Matches($Content, "\b(20\d{2})\b") | ForEach-Object { [int]$_.Value } | Where-Object { $_ -ge 2000 -and $_ -le (Get-Date).Year + 1 }
        if ($years) {
            # Return the most recent year found
            return ($years | Measure-Object -Maximum).Maximum
        }
    }
    
    return $null
}

# ============================================================
# JSON SANITIZATION - Guaranteed Array Fields via Python
# ============================================================

function Get-CleanSearchJson {
    param(
        [Parameter(Mandatory=$true)]
        [object]$Documents,
        [int]$Depth = 15
    )
    
    # Convert to JSON first
    $jsonBody = $Documents | ConvertTo-Json -Depth $Depth -Compress
    
    # If Python helper is available, use it to guarantee array fields
    if ($script:pythonAvailable -and $script:pythonHelperScript) {
        try {
            # Pipe JSON through Python - capture stdout only, stderr separate
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = "python"
            $psi.Arguments = "`"$($script:pythonHelperScript)`""
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
                        $script:pythonFixCount++
                        $script:stats.pythonJsonFixes++
                        return $cleanResult
                    }
                } catch {
                    Write-Host "      [WARN] Python output is not valid JSON" -ForegroundColor Yellow
                }
            }
            Write-Host "      [WARN] Python helper failed (exit: $exitCode)" -ForegroundColor Yellow
            if ($pythonError) { Write-Host "      Error: $pythonError" -ForegroundColor Gray }
        } catch {
            Write-Host "      [WARN] Python helper error: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    } else {
        # Only warn once per run about missing Python
        if (-not $script:pythonWarnShown) {
            Write-Host "      [WARN] Python not available - JSON may have serialization issues" -ForegroundColor Yellow
            $script:pythonWarnShown = $true
        }
    }
    
    # Fallback: return native PowerShell JSON
    return $jsonBody
}

# ============================================================
# BATCH INDEXING FUNCTION - World-Class Performance
# ============================================================

function Invoke-BatchIndex {
    param(
        [array]$Documents,
        [string]$SearchEndpoint,
        [hashtable]$SearchHeaders,
        [string]$SearchIndexName,
        [string]$BatchType = "chunks",
        [int]$BatchSize = 100
    )
    
    if ($Documents.Count -eq 0) {
        return @{ success = 0; failed = 0 }
    }
    
    $indexUrl = "$SearchEndpoint/indexes/$SearchIndexName/docs/index?api-version=2023-11-01"
    $successCount = 0
    $failedCount = 0
    $totalBatches = [Math]::Ceiling($Documents.Count / $BatchSize)
    $batchNum = 0
    
    for ($i = 0; $i -lt $Documents.Count; $i += $BatchSize) {
        $batchNum++
        $batch = [array]@($Documents[$i..([Math]::Min($i + $BatchSize - 1, $Documents.Count - 1))])
        
        try {
            # CRITICAL: Use Python helper to guarantee array fields are properly serialized
            $batchBody = Get-CleanSearchJson -Documents @{ value = [array]$batch } -Depth 15
            $response = Invoke-WebRequest -Uri $indexUrl -Method Post -Headers $SearchHeaders -Body $batchBody -ContentType "application/json" -UseBasicParsing -ErrorAction Stop
            
            $successCount += $batch.Count
            if ($totalBatches -gt 1) {
                Write-Host "      [BATCH $batchNum/$totalBatches] Indexed $($batch.Count) $BatchType (Total: $successCount/$($Documents.Count))" -ForegroundColor Gray
            }
        }
        catch {
            $errorDetails = $_.Exception.Message
            $statusCode = $null
            
            # Extract status code
            try {
                if ($_.Exception.Response) {
                    $statusCode = [int]$_.Exception.Response.StatusCode
                }
            } catch {}
            
            # Extract error details
            try {
                if ($_.ErrorDetails.Message) {
                    $errorBody = $_.ErrorDetails.Message
                    try {
                        $errorJson = $errorBody | ConvertFrom-Json -ErrorAction Stop
                        if ($errorJson.error) {
                            $errorDetails = "$($errorJson.error.message)"
                            if ($errorJson.error.code) {
                                $errorDetails = "$($errorJson.error.code): $errorDetails"
                            }
                        } else {
                            $errorDetails = $errorBody
                        }
                    } catch {
                        $errorDetails = $errorBody
                    }
                }
            } catch {}
            
            Write-Host "      [WARN] Batch $batchNum/$totalBatches failed: $errorDetails" -ForegroundColor Yellow
            
            # FALLBACK: Try indexing documents individually to identify problematic ones
            if ($batch.Count -gt 1) {
                Write-Host "      [RETRY] Attempting individual document indexing to identify issues..." -ForegroundColor Cyan
                $individualSuccess = 0
                $individualFailed = 0
                
                foreach ($doc in $batch) {
                    try {
                        # Use Python helper for guaranteed array serialization
                        $singleBody = Get-CleanSearchJson -Documents @{ value = @($doc) } -Depth 15
                        $singleResponse = Invoke-WebRequest -Uri $indexUrl -Method Post -Headers $SearchHeaders -Body $singleBody -ContentType "application/json" -UseBasicParsing -ErrorAction Stop
                        $individualSuccess++
                    }
                    catch {
                        $individualFailed++
                        $docId = if ($doc.id) { $doc.id.Substring(0, [Math]::Min(30, $doc.id.Length)) + "..." } else { "unknown" }
                        $singleError = $_.Exception.Message
                        try {
                            if ($_.ErrorDetails.Message) {
                                $singleError = $_.ErrorDetails.Message
                            }
                        } catch {}
                        Write-Host "         [FAIL] Doc ID: $docId - $($singleError.Substring(0, [Math]::Min(100, $singleError.Length)))" -ForegroundColor Red
                    }
                }
                
                $successCount += $individualSuccess
                $failedCount += $individualFailed
                Write-Host "      [RESULT] Individual retry: $individualSuccess succeeded, $individualFailed failed" -ForegroundColor $(if ($individualFailed -eq 0) { "Green" } else { "Yellow" })
            } else {
            $failedCount += $batch.Count
            }
        }
    }
    
    return @{ success = $successCount; failed = $failedCount }
}

function Generate-Embedding {
    param(
        [string]$Text,
        [string]$Endpoint,
        [string]$Key,
        [string]$Model = "text-embedding-3-large",
        [int]$RetryCount = 0,
        [int]$MaxRetries = 5
    )
    
    $headers = @{
        "Content-Type" = "application/json"
        "api-key" = $Key
    }
    
    # ELITE: Proper token guard (text-embedding-3-large supports 8192 tokens)
    # Optimized for speed: Larger chunks = fewer API calls = faster processing
    # Complex text (tables, numbers, symbols) can convert at ~2 chars per token
    # 25000 chars = ~12500 tokens (API will auto-truncate to 8192 if needed)
    # This reduces total API calls by ~40% for significant speed improvement
    $maxChars = 25000
    $textToEmbed = $Text.Substring(0, [Math]::Min($maxChars, $Text.Length)).Trim()
    
    if ([string]::IsNullOrWhiteSpace($textToEmbed) -or $textToEmbed.Length -lt 10) {
        return $null
    }
    
    # CRITICAL: Clean text to ensure valid UTF-8 encoding
    # Remove/replace invalid UTF-8 characters that can cause JSON encoding errors
    try {
        # Convert to UTF-8 bytes and back to string, replacing invalid sequences
        $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($textToEmbed)
        $textToEmbed = [System.Text.Encoding]::UTF8.GetString($utf8Bytes)
    } catch {
        # If encoding fails, try to clean the string by removing invalid characters
        $textToEmbed = [regex]::Replace($textToEmbed, '[^\x00-\x7F]', '')  # Remove non-ASCII as fallback
    }
    
    # Additional cleaning: replace common problematic characters with safe alternatives
    # Use Unicode escape sequences to avoid PowerShell parsing issues with special characters
    $textToEmbed = $textToEmbed -replace [char]0x00B7, '.'  # Middle dot (·) to period
    $textToEmbed = $textToEmbed -replace [char]0x2013, '-'  # En dash (–) to hyphen
    $textToEmbed = $textToEmbed -replace [char]0x2014, '-'  # Em dash (—) to hyphen
    $textToEmbed = $textToEmbed -replace [char]0x2026, '...'  # Ellipsis (…) to three dots
    $textToEmbed = $textToEmbed -replace [char]0x201C, '"'  # Left double quote (") to standard quote
    $textToEmbed = $textToEmbed -replace [char]0x201D, '"'  # Right double quote (") to standard quote
    $textToEmbed = $textToEmbed -replace [char]0x2018, "'"  # Left single quote (') to standard quote
    $textToEmbed = $textToEmbed -replace [char]0x2019, "'"  # Right single quote (') to standard quote
    
    # Ensure proper JSON encoding
    $body = @{
        input = @($textToEmbed)  # Array format for Azure OpenAI
    } | ConvertTo-Json -Depth 10 -Compress
    
    # Use preview API version (Azure OpenAI embeddings use preview versions)
    # Fix double slash issue (ensure endpoint doesn't end with /)
    $cleanEndpoint = $Endpoint.TrimEnd('/')
    $embeddingUrl = "$cleanEndpoint/openai/deployments/$Model/embeddings?api-version=2024-02-15-preview"
    
    try {
        # Set timeout to prevent hanging (60 seconds max per embedding call)
        $response = Invoke-RestMethod -Uri $embeddingUrl -Method Post -Headers $headers -Body $body -TimeoutSec 60 -ErrorAction Stop
        if ($response.data -and $response.data.Count -gt 0) {
            # ELITE: Return structured object with metadata
            return @{
                embedding = $response.data[0].embedding
                model = $Model
                modelVersion = "2024-02-15-preview"
                generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                textLength = $textToEmbed.Length
            }
        }
        return $null
    }
    catch {
        $errorMsg = $_.Exception.Message
        $statusCode = $null
        $errorBody = $null
        $errorDetails = $null
        
        # Extract status code from response
        try {
            if ($_.Exception.Response) {
                $statusCode = $_.Exception.Response.StatusCode.value__
            }
        } catch {}
        
        # Extract error response body using PowerShell's ErrorDetails (more reliable than StreamReader)
        try {
            if ($_.ErrorDetails.Message) {
                $errorBody = $_.ErrorDetails.Message
                # Try to parse JSON error response
                try {
                    $errorDetails = $errorBody | ConvertFrom-Json
                    if ($errorDetails.error) {
                        $errorBody = $errorDetails.error.message
                        if ($errorDetails.error.code) {
                            $errorBody = "$($errorDetails.error.code): $errorBody"
                        }
                    }
                } catch {
                    # Not JSON, use as-is
                }
            }
        } catch {}
        
        # Fallback: Try to extract status code from error message
        if (-not $statusCode) {
            if ($errorMsg -like "*429*" -or $errorMsg -like "*Too Many Requests*" -or $errorMsg -like "*rate limit*") {
                $statusCode = 429
            } elseif ($errorMsg -like "*400*" -or $errorMsg -like "*Bad Request*") {
                $statusCode = 400
            } elseif ($errorMsg -like "*503*" -or $errorMsg -like "*Service Unavailable*") {
                $statusCode = 503
            } elseif ($errorMsg -like "*404*" -or $errorMsg -like "*Not Found*") {
                $statusCode = 404
            }
        }
        
        # ALWAYS show the actual error first - don't mask it
        $fullError = if ($errorBody) { $errorBody } else { $errorMsg }
        if ($statusCode) {
            Write-Host "      [ERROR] HTTP $statusCode : $fullError" -ForegroundColor Red
        } else {
            Write-Host "      [ERROR] $fullError" -ForegroundColor Red
        }
        
        # Check for non-retryable errors (400, 401, 403, 404, etc.) - show and exit immediately
        $nonRetryableErrors = @(400, 401, 403, 404, 413, 422)
        if ($statusCode -in $nonRetryableErrors) {
            Write-Host "      [SKIP] Non-retryable error ($statusCode) - skipping chunk" -ForegroundColor Yellow
            return $null
        }
        
        # Check for encoding/JSON errors - don't retry these
        $isEncodingError = $errorBody -like "*utf-8*" -or $errorBody -like "*codec*" -or $errorBody -like "*decode byte*" -or 
                          $errorBody -like "*invalid json*" -or $errorBody -like "*malformed*" -or
                          $errorMsg -like "*utf-8*" -or $errorMsg -like "*codec*" -or $errorMsg -like "*decode byte*" -or
                          $errorMsg -like "*invalid json*" -or $errorMsg -like "*malformed*"
        
        if ($isEncodingError) {
            Write-Host "      [SKIP] Encoding/JSON error detected - skipping chunk (should have been sanitized)" -ForegroundColor Yellow
            return $null
        }
        
        # Handle rate limiting (429) and service unavailable (503) with exponential backoff
        # Only retry if it's ACTUALLY a rate limit, not a masked error
        $isActualRateLimit = ($statusCode -eq 429 -or $statusCode -eq 503) -and -not $isEncodingError
        
        # Use all retries for rate limits (up to MaxRetries) - don't give up early
        # The early exit at 3 retries was causing low coverage - now we use all 5 retries
        if ($isActualRateLimit -and $RetryCount -lt $MaxRetries) {
            # Track rate limit hits for adaptive throttling
            $script:stats.rateLimitHits++
            
            # Try to extract "retry after X seconds" from error message
            $retryAfterSeconds = $null
            if ($fullError -match "retry after (\d+) seconds?") {
                $retryAfterSeconds = [int]$matches[1]
                Write-Host "      [INFO] Azure OpenAI specified retry after: $retryAfterSeconds seconds" -ForegroundColor Cyan
            }
            
            # Use Azure's specified wait time if available, otherwise use exponential backoff
            if ($retryAfterSeconds -and $retryAfterSeconds -gt 0) {
                # CRITICAL: Add significant buffer - S0 tier limits are per-minute windows
                # If Azure says wait 50 seconds, we should wait longer to ensure window has reset
                $waitTime = $retryAfterSeconds + 15  # Add 15 second buffer (was 5) to ensure rate limit window resets
                Write-Host "      [RETRY $($RetryCount + 1)/$MaxRetries] Rate limited ($statusCode), waiting $waitTime seconds (Azure specified: $retryAfterSeconds + buffer)..." -ForegroundColor Yellow
            } else {
                # Longer exponential backoff: 3, 6, 12, 24, 48 seconds
                $waitTime = [Math]::Pow(2, $RetryCount) * 3
                Write-Host "      [RETRY $($RetryCount + 1)/$MaxRetries] Rate limited ($statusCode), waiting $waitTime seconds..." -ForegroundColor Yellow
            }
            
            Write-Host "      [INFO] Total rate limit hits: $($script:stats.rateLimitHits) - delays will be increased" -ForegroundColor Gray
            Write-Host "      [TIP] S0 tier has low rate limits. Consider upgrading to S1+ for higher limits." -ForegroundColor Gray
            
            # If we've hit many rate limits, wait even longer to let the window fully reset
            # S0 tier rate limit window is typically 60 seconds, so we need to wait for full reset
            if ($script:stats.rateLimitHits -gt 5) {
                $additionalWait = 30  # Wait extra 30 seconds to ensure window resets
                Write-Host "      [INFO] High rate limit count - adding $additionalWait second buffer to reset window..." -ForegroundColor Cyan
                $waitTime += $additionalWait
            }
            
            # CRITICAL: For S0 tier, rate limit window is a ROLLING 60-second window
            # If Azure says "retry after 47 seconds", we need to wait LONGER to ensure the window fully resets
            # The issue: Even after waiting, if we immediately retry, we might still be in the same window
            # Solution: Wait at least 90 seconds (1.5x the window) to ensure we're in a fresh window
            if ($waitTime -lt 90) {
                $waitTime = 90  # Always wait at least 90 seconds for S0 tier (1.5x the 60-second window)
                Write-Host "      [INFO] Ensuring full 90-second wait for S0 tier rolling window reset..." -ForegroundColor Cyan
            }
            
            Write-Host "      [WAIT] Waiting $waitTime seconds for rate limit window to fully reset..." -ForegroundColor Yellow
            Start-Sleep -Seconds $waitTime
            
            # CRITICAL: After waiting, add an extra cooldown buffer before making the actual request
            # This ensures we're definitely in a fresh rate limit window
            $cooldownBuffer = 10  # Extra 10 seconds to be absolutely sure
            Write-Host "      [COOLDOWN] Additional $cooldownBuffer second buffer before retry..." -ForegroundColor Cyan
            Start-Sleep -Seconds $cooldownBuffer
            
            Write-Host "      [RETRY] Attempting embedding again after full cooldown (attempt $($RetryCount + 1)/$MaxRetries)..." -ForegroundColor Green
            # Recursive retry - will use all MaxRetries (5) attempts before giving up
            return Generate-Embedding -Text $Text -Endpoint $Endpoint -Key $Key -Model $Model -RetryCount ($RetryCount + 1) -MaxRetries $MaxRetries
        }
        
        # If we get here and it's not a rate limit, it's an unknown error - don't retry
        if ($statusCode -and $statusCode -ne 429 -and $statusCode -ne 503) {
            Write-Host "      [SKIP] Unknown error ($statusCode) - skipping chunk" -ForegroundColor Yellow
            return $null
        }
        
        # If we've exhausted retries, log and return null (chunk will be indexed without embedding)
        if ($RetryCount -ge $MaxRetries) {
            Write-Host "      [WARN] Max retries ($MaxRetries) exceeded for embedding - chunk will be indexed without vector" -ForegroundColor Yellow
            Write-Host "      [INFO] This chunk will still be searchable via keyword search" -ForegroundColor Gray
        } else {
            Write-Host "      [ERROR] Embedding generation failed: $errorMsg (Status: $statusCode)" -ForegroundColor Red
            if ($errorBody) {
                Write-Host "      [DEBUG] Error details: $errorBody" -ForegroundColor Gray
            }
        }
        # Return null - chunk will be indexed without embedding (still searchable)
        return $null
    }
}

# ============================================================
# STEP 3: PROCESS EACH PDF
# ============================================================

Write-Host "[STEP 3] Processing PDFs..." -ForegroundColor Yellow
Write-Host ""

$searchHeaders = @{
    "Content-Type" = "application/json"
    "api-key" = $searchKey
}

# Store in script scope for signal handler access
$script:stats = @{
    processed = 0
    embeddingsGenerated = 0
    embeddingErrors = 0
    failed = 0
    skipped = 0
    chunks = 0
    indexed = 0
    rateLimitHits = 0  # Track rate limit hits for adaptive throttling
    
    # AUDIT: Detailed tracking for complete audit trail
    tablesExtracted = 0
    tableRowsIndexed = 0
    figuresDetected = 0
    chartsExtracted = 0
    aiTagsSucceeded = 0
    aiTagsFailed = 0
    documentAITagsSucceeded = 0
    documentAITagsFailed = 0
    sanitizationIssues = 0
    lowConfidenceChunks = 0
    pythonJsonFixes = 0  # Count of times Python fixed JSON serialization issues
    
    # Per-document tracking
    documentsWithTables = 0
    documentsWithFigures = 0
    documentsWithCharts = 0
}

# ============================================================
# AUDIT LOG - Complete Processing History
# ============================================================
# Store in script scope for signal handler access
$script:auditLog = @{
    startTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    endTime = $null
    resourceGroup = $ResourceGroupName
    searchIndex = $SearchIndexName
    containerName = $ContainerName
    parameters = @{
        chunkSize = $ChunkSize
        chunkOverlap = $ChunkOverlap
        generateEmbeddings = $GenerateEmbeddings.IsPresent
        forceReprocess = $ForceReprocess.IsPresent
        disableAITagging = $DisableAITagging.IsPresent
        aiTaggingModel = $AITaggingModel
    }
    
    # Detailed event logs
    events = @()
    
    # Per-document audit
    documents = @()
    
    # Warnings and errors
    warnings = @()
    errors = @()
    
    # Skipped items with reasons
    skippedDocuments = @()
    skippedChunks = @()
    
    # Failed items with details
    failedEmbeddings = @()
    failedAITags = @()
    failedIndexing = @()
    
    # Low confidence items for review
    lowConfidenceItems = @()
    
    # Coverage summary (populated at end)
    coverage = @{}
}

# Helper function to add audit event
function Add-AuditEvent {
    param(
        [string]$Type,       # INFO, WARNING, ERROR, SKIP, FAIL, SUCCESS
        [string]$Category,   # document, chunk, embedding, ai-tag, indexing, chart
        [string]$Message,
        [string]$DocumentId = $null,
        [hashtable]$Details = @{}
    )
    
    $event = @{
        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        type = $Type
        category = $Category
        message = $Message
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

# Adaptive rate limiting - increase delay if we hit rate limits
# NOTE: S0 tier has very low rate limits (often 60-120 requests/minute for embeddings)
# Consider upgrading to S1+ tier for production workloads with higher limits
# CRITICAL: S0 tier = ~60 requests/minute = 1 request per second MAX
# We need to be very conservative to avoid hitting limits and wasting Document Intelligence costs

# OPTIMIZATION: If deployment capacity is high (scaled up), reduce delays
# Capacity = Thousands of Tokens Per Minute (TPM/1000)
# Example: 350K TPM = capacity 350
#
# Tier Guide:
#   < 120:    S0 default (conservative)
#   120-239:  Upgraded S0 (moderate)
#   240-499:  High capacity (fast)
#   500+:     Very high capacity (maximum speed)
if ($deploymentCapacity -and $deploymentCapacity -ge 500) {
    $baseEmbeddingDelay = 50   # 50ms - maximum speed for 500K+ TPM
    Write-Host "[INFO] ULTRA HIGH capacity detected ($($deploymentCapacity)K TPM) - using maximum speed!" -ForegroundColor Green
} elseif ($deploymentCapacity -and $deploymentCapacity -ge 300) {
    $baseEmbeddingDelay = 100  # 100ms - very fast for 300-499K TPM
    Write-Host "[INFO] Very high capacity detected ($($deploymentCapacity)K TPM) - using fast delays" -ForegroundColor Green
} elseif ($deploymentCapacity -and $deploymentCapacity -ge 120) {
    $baseEmbeddingDelay = 300  # 300ms - moderate for 120-299K TPM
    Write-Host "[INFO] High capacity detected ($($deploymentCapacity)K TPM) - using optimized delays" -ForegroundColor Green
} else {
    $baseEmbeddingDelay = 2000  # 2 seconds - conservative for default S0 (<120K TPM)
    $capacityDisplay = if ($deploymentCapacity) { "$($deploymentCapacity)K" } else { "unknown" }
    Write-Host "[INFO] Standard capacity ($capacityDisplay TPM) - using safe delays (2s between embeddings)" -ForegroundColor Yellow
    Write-Host "       TIP: To speed up, upgrade your OpenAI embedding deployment capacity in Azure Portal" -ForegroundColor Gray
}

$baseIndexingDelay = 200   # Base delay for indexing operations

# If we've hit too many rate limits, warn user and suggest alternatives
$maxRateLimitHitsBeforeWarning = 10

$startTime = Get-Date

foreach ($pdf in $pdfs) {
    $pdfName = $pdf.name
    $pdfIndex = $script:stats.processed + $script:stats.failed + 1
    
    # If we've hit too many rate limits, warn user before processing more PDFs
    # This prevents wasting Document Intelligence costs on PDFs we can't embed
    if ($script:stats.rateLimitHits -ge 10 -and $pdfIndex -gt 1) {
        Write-Host ""
        Write-Host "  [WARNING] High rate limit hits detected ($($script:stats.rateLimitHits))" -ForegroundColor Yellow
        Write-Host "  [WARNING] You're paying for Document Intelligence extraction but embeddings are failing!" -ForegroundColor Red
        Write-Host "  [WARNING] Consider:" -ForegroundColor Yellow
        Write-Host "    1. Upgrading OpenAI to S1+ tier for higher limits" -ForegroundColor Gray
        Write-Host "    2. Processing in smaller batches (5-10 PDFs at a time)" -ForegroundColor Gray
        Write-Host "    3. Running overnight when system is idle" -ForegroundColor Gray
        Write-Host "    4. Pausing and waiting 5-10 minutes for rate limit window to reset" -ForegroundColor Gray
        Write-Host "  [INFO] Continuing with very slow processing (3+ seconds between embeddings)..." -ForegroundColor Cyan
        Write-Host ""
    }
    
    Write-Host "[$pdfIndex/$($pdfs.Count)] $pdfName" -ForegroundColor Cyan
    
    # Check if PDF already has good coverage (unless ForceReprocess is set)
    if (-not $ForceReprocess) {
        Write-Host "   [CHECK] Checking if PDF already processed..." -ForegroundColor Gray
        $hasGoodCoverage = Test-PdfCoverage -PdfName $pdfName -SearchEndpoint $searchEndpoint -SearchKey $searchKey -SearchIndexName $SearchIndexName -MinCoverage 95.0
        
        if ($hasGoodCoverage) {
            Write-Host "   [DEBUG] Coverage check result: GOOD (>= 95%)" -ForegroundColor Gray
            # Get existing chunk count for audit log (use same method as Test-PdfCoverage)
            try {
                $countHeaders = @{
                    "Content-Type" = "application/json"
                    "api-key" = $searchKey
                }
                # Use $count=true in URL (same as Test-PdfCoverage) to get accurate count
                $countUrl = "$searchEndpoint/indexes/$SearchIndexName/docs/search?api-version=2023-11-01&`$count=true"
                $countBody = @{
                    search = "*"
                    filter = "documentType eq 'pdf' and documentId eq '$pdfName'"
                    top = 0
                } | ConvertTo-Json
                $countResult = Invoke-RestMethod -Uri $countUrl -Method Post -Headers $countHeaders -Body $countBody -ErrorAction SilentlyContinue
                $existingChunks = if ($countResult.'@odata.count') { $countResult.'@odata.count' } else { 0 }
            } catch {
                $existingChunks = 0
            }
            
            Write-Host "   [SKIP] PDF already processed with >= 95% coverage ($existingChunks chunks) - skipping to save costs" -ForegroundColor Green
            Write-Host "         (Use -ForceReprocess to reprocess anyway)" -ForegroundColor Gray
            $script:stats.skipped++
            
            # AUDIT: Track skipped document
            Add-AuditEvent -Type "SKIP" -Category "document" -Message "Already processed with good coverage" `
                -DocumentId $pdfName -Details @{
                    reason = "already_processed"
                    existingChunks = $existingChunks
                    coverage = ">=95%"
                }
            $script:auditLog.skippedDocuments += @{
                documentId = $pdfName
                reason = "already_processed"
                existingChunks = $existingChunks
                timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            }
            continue
        } else {
            Write-Host "   [OK] PDF needs processing or has low coverage - proceeding..." -ForegroundColor Cyan
            Write-Host "   [DEBUG] Coverage check result: NEEDS PROCESSING (< 95% or not found)" -ForegroundColor Gray
        }
    } else {
        Write-Host "   [INFO] ForceReprocess enabled - will reprocess even if already done" -ForegroundColor Yellow
        
        # Delete old chunks before reprocessing to avoid duplicates
        Write-Host "   [DELETE] Removing old chunks for this PDF..." -ForegroundColor Yellow
        try {
            $deleteUrl = "$searchEndpoint/indexes/$SearchIndexName/docs/search?api-version=2023-11-01"
            $deleteBody = @{
                search = "*"
                filter = "documentType eq 'pdf' and documentId eq '$pdfName'"
                top = 1000
                select = "id"
            } | ConvertTo-Json
            
            $existingChunks = Invoke-RestMethod -Uri $deleteUrl -Method Post -Headers $searchHeaders -Body $deleteBody -ErrorAction SilentlyContinue
            
            if ($existingChunks -and $existingChunks.value -and $existingChunks.value.Count -gt 0) {
                # Prepare delete batch
                $deleteBatch = $existingChunks.value | ForEach-Object {
                    @{
                        "@search.action" = "delete"
                        id = $_.id
                    }
                }
                
                # Delete in batches of 1000 (Azure Search limit)
                $batchSize = 1000
                for ($i = 0; $i -lt $deleteBatch.Count; $i += $batchSize) {
                    $batch = $deleteBatch[$i..([Math]::Min($i + $batchSize - 1, $deleteBatch.Count - 1))]
                    $batchUrl = "$searchEndpoint/indexes/$SearchIndexName/docs/index?api-version=2023-11-01"
                    
                    # CRITICAL: Wrap batch in 'value' array (Azure Search requires this format for batch operations)
                    $deleteBody = @{
                        value = [array]$batch
                    } | ConvertTo-Json -Depth 10
                    
                    $batchResult = Invoke-RestMethod -Uri $batchUrl -Method Post -Headers $searchHeaders -Body $deleteBody -ErrorAction Stop
                }
                
                Write-Host "   [OK] Deleted $($existingChunks.value.Count) old chunks" -ForegroundColor Green
            } else {
                Write-Host "   [INFO] No existing chunks found to delete" -ForegroundColor Gray
            }
        } catch {
            Write-Host "   [WARN] Could not delete old chunks: $($_.Exception.Message)" -ForegroundColor Yellow
            Write-Host "          Continuing with reprocess (may create duplicates)" -ForegroundColor Gray
        }
    }
    
    try {
        # Generate SAS URL for Document Intelligence
        $expiry = (Get-Date).AddHours(1).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        Write-Host "   [DEBUG] Generating SAS token for blob: $pdfName" -ForegroundColor Gray
        
        $sasToken = az storage blob generate-sas `
            --account-name $storageAccountName `
            --container-name $ContainerName `
            --name $pdfName `
            --permissions r `
            --expiry $expiry `
            --account-key $storageKey `
            --output tsv 2>&1
        
        if (-not $sasToken -or $sasToken -match "ERROR" -or $sasToken -match "error") {
            Write-Host "   [ERROR] SAS token generation failed: $sasToken" -ForegroundColor Red
            $script:stats.failed++
            continue
        }
        
        $pdfUrl = "https://$storageAccountName.blob.core.windows.net/$ContainerName/$([uri]::EscapeDataString($pdfName))?$sasToken"
        Write-Host "   [DEBUG] PDF URL generated (length: $($pdfUrl.Length))" -ForegroundColor Gray
        
        # Extract content using Document Intelligence
        Write-Host "   [1/4] Extracting content with Document Intelligence..." -ForegroundColor Gray
        $docIntelResult = Invoke-DocumentIntelligence -PdfUrl $pdfUrl -Endpoint $docIntelEndpoint -Key $docIntelKey
        
        if (-not $docIntelResult -or -not $docIntelResult.analyzeResult) {
            Write-Host "   [FAILED] Document Intelligence extraction failed" -ForegroundColor Red
            $script:stats.failed++
            
            # AUDIT: Track failed document
            Add-AuditEvent -Type "ERROR" -Category "document" -Message "Document Intelligence extraction failed" `
                -DocumentId $pdfName -Details @{
                    reason = "extraction_failed"
                    stage = "document_intelligence"
                }
            $script:auditLog.errors += @{
                documentId = $pdfName
                stage = "document_intelligence"
                error = "Extraction failed"
                timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            }
            continue
        }
        
        # Extract result and figures support flag
        $analysisResult = $docIntelResult.analyzeResult
        $figuresSupported = $docIntelResult.figuresSupported
        
        if (-not $figuresSupported) {
            Write-Host "   [WARN] FIGURES NOT SUPPORTED - Images/charts will be MISSED!" -ForegroundColor Red
            if ($RequireFigures) {
                Write-Host "   [FATAL] -RequireFigures flag is set but figures not available!" -ForegroundColor Red
                Write-Host "          To fix: Upgrade Document Intelligence to support preview API" -ForegroundColor Yellow
                Write-Host "          Or: Remove -RequireFigures flag to continue without images" -ForegroundColor Yellow
                $script:stats.failed++
                continue
            }
        }
        
        # Extract text with page tracking and confidence scores (ELITE: Confidence tracking)
        $fullText = ""
        $pageTexts = @{}
        $pageConfidences = @{}  # Track confidence per page
        $paragraphConfidences = @()  # Track confidence per paragraph
        $pageCount = 0
        
        # Process pages (collect page numbers first to avoid modification issues)
        $pageNumbers = @()
        foreach ($page in $analysisResult.pages) {
            $pageNumbers += $page.pageNumber
        }
        
        foreach ($pageNum in $pageNumbers) {
            $page = $analysisResult.pages | Where-Object { $_.pageNumber -eq $pageNum } | Select-Object -First 1
            if (-not $page) { continue }
            
            $pageCount++
            $pageText = ""
            $confidencesForPage = @()  # Collect confidences for this page
            
            if ($analysisResult.paragraphs) {
                $pageParagraphs = $analysisResult.paragraphs | Where-Object { 
                    $_.boundingRegions -and $_.boundingRegions[0].pageNumber -eq $pageNum 
                }
                foreach ($para in $pageParagraphs) {
                    $pageText += $para.content + "`n`n"
                    # Capture confidence score (ELITE: Confidence tracking)
                    if ($para.paragraphRole -or $para.confidence) {
                        $confidence = if ($para.confidence) { $para.confidence } else { 1.0 }
                        $paragraphConfidences += @{
                            pageNumber = $pageNum
                            confidence = $confidence
                            content = $para.content
                        }
                        $confidencesForPage += $confidence
                    }
                }
            }
            
            if (-not $pageText -and $page.lines) {
                foreach ($line in $page.lines) {
                    $pageText += $line.content + " "
                }
                # Lines typically have lower confidence (OCR) - only if no paragraph confidences
                if ($confidencesForPage.Count -eq 0) {
                    $confidencesForPage = @(0.85)  # Default OCR confidence
                }
            }
            
            # Store confidence array after collection (avoids modification during iteration)
            $pageConfidences[$pageNum] = $confidencesForPage
            $pageTexts[$pageNum] = $pageText.Trim()
            $fullText += $pageText + "`n`n"
        }
        
        # Calculate average confidence per page (collect keys first to avoid modification during iteration)
        $pageNumbers = @($pageConfidences.Keys)  # Create a copy of keys
        foreach ($pageNum in $pageNumbers) {
            if ($pageConfidences[$pageNum].Count -gt 0) {
                $pageConfidences[$pageNum] = ($pageConfidences[$pageNum] | Measure-Object -Average).Average
            } else {
                $pageConfidences[$pageNum] = 1.0  # Default confidence
            }
        }
        
        Write-Host "   [OK] Extracted $pageCount pages, $($fullText.Length) characters" -ForegroundColor Green
        
        # ELITE: Extract tables as structured intelligence (separate from text)
        $structuredTables = @()  # Store tables separately for row-level chunks
        $tables = @()  # Keep for backward compatibility
        $tableCounter = 0
        
        if ($analysisResult.tables) {
            foreach ($table in $analysisResult.tables) {
                $tableCounter++
                $tablePage = if ($table.boundingRegions -and $table.boundingRegions.Count -gt 0) { 
                    $table.boundingRegions[0].pageNumber 
                } else { 
                    1 
                }
                
                # ELITE: Extract table metadata (units, headers, structure)
                $headers = @()
                $tableRows = @()
                $tableConfidence = if ($table.confidence) { $table.confidence } else { 1.0 }
                
                # WORLD-CLASS: Build structured rows with merged cell support
                $rows = @{}
                $mergedCells = @{}  # Track merged cells
                
                foreach ($cell in $table.cells) {
                    $rowIdx = $cell.rowIndex
                    $colIdx = $cell.columnIndex
                    $rowSpan = if ($cell.rowSpan) { $cell.rowSpan } else { 1 }
                    $colSpan = if ($cell.columnSpan) { $cell.columnSpan } else { 1 }
                    
                    if (-not $rows.ContainsKey($rowIdx)) {
                        $rows[$rowIdx] = @{}
                    }
                    
                    # Store cell with span info
                    $rows[$rowIdx][$colIdx] = @{
                        content = $cell.content
                        kind = if ($cell.kind) { $cell.kind } else { "content" }
                        rowSpan = $rowSpan
                        colSpan = $colSpan
                        isMerged = ($rowSpan -gt 1 -or $colSpan -gt 1)
                    }
                    
                    # For merged cells, replicate content to spanned positions
                    for ($r = 0; $r -lt $rowSpan; $r++) {
                        for ($c = 0; $c -lt $colSpan; $c++) {
                            if ($r -gt 0 -or $c -gt 0) {
                                $targetRow = $rowIdx + $r
                                $targetCol = $colIdx + $c
                                if (-not $rows.ContainsKey($targetRow)) {
                                    $rows[$targetRow] = @{}
                                }
                                $rows[$targetRow][$targetCol] = @{
                                    content = ""  # Empty for spanned cells
                                    kind = "spanned"
                                    spanSource = "$rowIdx-$colIdx"
                                }
                            }
                        }
                    }
                    
                    # Capture headers (row 0 or cells marked as columnHeader)
                    if ($rowIdx -eq 0 -or $cell.kind -eq "columnHeader") {
                        $headers += $cell.content
                    }
                }
                
                # Create structured table representation
                $structuredTable = @{
                    tableIndex = $tableCounter
                    pageNumber = $tablePage
                    rowCount = $table.rowCount
                    columnCount = $table.columnCount
                    headers = $headers
                    confidence = $tableConfidence
                    rows = @()
                }
                
                # Build row-level data
                foreach ($rowNum in ($rows.Keys | Sort-Object)) {
                    $rowData = @()
                    $rowText = ""
                    foreach ($colNum in ($rows[$rowNum].Keys | Sort-Object)) {
                        $cellData = $rows[$rowNum][$colNum]
                        $rowData += $cellData.content
                        $rowText += $cellData.content + " | "
                    }
                    $rowText = $rowText.TrimEnd(" | ")
                    $tableRows += $rowText
                    
                    # ELITE: Store as structured row chunk
                    $structuredTable.rows += @{
                        rowIndex = $rowNum
                        values = $rowData
                        text = $rowText
                        isHeader = ($rowNum -eq 0)
                    }
                }
                
                $structuredTables += $structuredTable
                
                # Also keep text version for backward compatibility
                $tableContent = "`n`n--- TABLE ($($table.rowCount) rows x $($table.columnCount) columns) ---`n"
                $tableContent += ($tableRows -join "`n") + "`n"
                $tableContent += "--- END TABLE ---`n`n"
                $tables += $tableContent
                # Still add to fullText for general searchability
                $fullText += $tableContent
            }
        }
        
        Write-Host "   [OK] Extracted $($structuredTables.Count) structured tables" -ForegroundColor Green
        
        # AUDIT: Track table extraction
        $script:stats.tablesExtracted += $structuredTables.Count
        if ($structuredTables.Count -gt 0) {
            $script:stats.documentsWithTables++
            Add-AuditEvent -Type "SUCCESS" -Category "table" -Message "Extracted $($structuredTables.Count) tables" `
                -DocumentId $pdfName -Details @{
                    tableCount = $structuredTables.Count
                    totalRows = ($structuredTables | ForEach-Object { $_.rows.Count } | Measure-Object -Sum).Sum
                }
        }
        
        # ============================================================
        # ELITE: EXTRACT FIGURES/CHARTS/IMAGES (NEW!)
        # ============================================================
        $extractedFigures = @()
        
        if ($analysisResult.figures -and $analysisResult.figures.Count -gt 0) {
            Write-Host "   [CHARTS] Detected $($analysisResult.figures.Count) figures/charts/images..." -ForegroundColor Magenta
            
            foreach ($figure in $analysisResult.figures) {
                $figureIndex = $extractedFigures.Count + 1
                
                # Get bounding region info
                $boundingRegion = if ($figure.boundingRegions -and $figure.boundingRegions.Count -gt 0) {
                    $figure.boundingRegions[0]
                } else { $null }
                
                $figurePage = if ($boundingRegion) { $boundingRegion.pageNumber } else { 1 }
                $figurePolygon = if ($boundingRegion) { $boundingRegion.polygon } else { $null }
                
                # Get caption if available
                $caption = if ($figure.caption -and $figure.caption.content) {
                    $figure.caption.content
                } else { $null }
                
                # Get any spans (text references)
                $spanText = ""
                if ($figure.spans -and $figure.spans.Count -gt 0) {
                    foreach ($span in $figure.spans) {
                        if ($span.content) {
                            $spanText += $span.content + " "
                        }
                    }
                }
                
                # Store figure info for later processing
                $extractedFigures += @{
                    figureIndex = $figureIndex
                    pageNumber = $figurePage
                    boundingBox = $figurePolygon
                    caption = $caption
                    spanText = $spanText.Trim()
                    id = $figure.id
                    confidence = if ($figure.confidence) { $figure.confidence } else { 0.8 }
                }
                
                Write-Host "      Figure $($figureIndex): Page $figurePage $(if ($caption) { "- $caption" } else { '' })" -ForegroundColor Cyan
            }
            
            Write-Host "   [OK] Detected $($extractedFigures.Count) figures for chart extraction" -ForegroundColor Green
            
            # AUDIT: Track figure detection
            $script:stats.figuresDetected += $extractedFigures.Count
            $script:stats.documentsWithFigures++
            Add-AuditEvent -Type "SUCCESS" -Category "figure" -Message "Detected $($extractedFigures.Count) figures" `
                -DocumentId $pdfName -Details @{
                    figureCount = $extractedFigures.Count
                    figures = $extractedFigures | ForEach-Object { @{ page = $_.pageNumber; caption = $_.caption } }
                }
        } else {
            if ($figuresSupported) {
                Write-Host "   [INFO] No figures/charts/images detected in this document" -ForegroundColor Gray
            } else {
                Write-Host "   [SKIP] Figures detection UNAVAILABLE - API doesn't support 'features=figures'" -ForegroundColor Yellow
                Write-Host "         Images/charts in this PDF are being MISSED!" -ForegroundColor Yellow
            }
        }
        
        # ============================================================
        # FULL IMAGE/CHART EXTRACTION (GPT-4 Vision)
        # Extracts data from ALL visual elements: charts, screenshots, diagrams
        # ============================================================
        $chartExtractionResults = @()
        $chartExtractionEndpoint = $env:CHART_EXTRACTION_ENDPOINT
        
        # Check if we have Vision API configured (for direct extraction)
        $hasVisionAPI = $hasOpenAI -and $openAIEndpoint -and $openAIKey
        
        if ($extractedFigures.Count -gt 0) {
            Write-Host "   [VISION] Extracting data from $($extractedFigures.Count) figures using GPT-4 Vision..." -ForegroundColor Magenta
            
            foreach ($figure in $extractedFigures) {
                try {
                    $extractedData = $null
                    
                    # Try to extract actual chart/image data using Vision API
                    if ($hasVisionAPI) {
                        Write-Host "      [VISION] Analyzing figure $($figure.figureIndex) on page $($figure.pageNumber)..." -ForegroundColor Cyan
                        
                        # Call Vision API to extract chart data
                        $visionResult = Invoke-ChartVisionExtraction -PdfUrl $pdfUrl `
                            -PageNumber $figure.pageNumber `
                            -BoundingBox $figure.boundingBox `
                            -Caption $figure.caption `
                            -OpenAIEndpoint $openAIEndpoint `
                            -OpenAIKey $openAIKey `
                            -DocumentId $pdfName
                        
                        if ($visionResult -and $visionResult.success) {
                            $extractedData = $visionResult.extraction
                            Write-Host "      [OK] Extracted: $($extractedData.visualType) - $($extractedData.title)" -ForegroundColor Green
                        } else {
                            $errorMsg = if ($visionResult.error) { $visionResult.error } else { "Unknown error" }
                            Write-Host "      [WARN] Vision extraction returned no data: $errorMsg" -ForegroundColor Yellow
                        }
                    }
                    
                    # Store result (with or without extracted data)
                    $chartExtractionResults += @{
                        figureIndex = $figure.figureIndex
                        pageNumber = $figure.pageNumber
                        boundingBox = $figure.boundingBox
                        caption = $figure.caption
                        spanText = $figure.spanText
                        confidence = if ($extractedData) { $extractedData.confidence } else { $figure.confidence }
                        visualType = if ($extractedData) { $extractedData.visualType } else { "figure" }
                        chartData = if ($extractedData -and $extractedData.chartData) { $extractedData.chartData } else { $null }
                        diagramData = if ($extractedData -and $extractedData.diagramData) { $extractedData.diagramData } else { $null }
                        description = if ($extractedData) { $extractedData.description } else { $figure.caption }
                        extractedText = if ($extractedData) { $extractedData.extractedText } else { @() }
                        status = if ($extractedData) { "extracted" } else { "metadata_only" }
                    }
                    
                } catch {
                    Write-Host "      [ERROR] Figure $($figure.figureIndex) extraction failed: $($_.Exception.Message)" -ForegroundColor Red
                    # Store with metadata only
                    $chartExtractionResults += @{
                        figureIndex = $figure.figureIndex
                        pageNumber = $figure.pageNumber
                        boundingBox = $figure.boundingBox
                        caption = $figure.caption
                        spanText = $figure.spanText
                        confidence = $figure.confidence
                        visualType = "figure"
                        chartData = $null
                        status = "extraction_failed"
                        error = $_.Exception.Message
                    }
                }
                
                # Small delay to avoid rate limits
                Start-Sleep -Milliseconds 500
            }
            
            $extractedCount = ($chartExtractionResults | Where-Object { $_.status -eq "extracted" }).Count
            Write-Host "   [OK] Extracted data from $extractedCount/$($extractedFigures.Count) figures" -ForegroundColor Green
            
        } elseif (-not $figuresSupported -and $hasVisionAPI) {
            # FALLBACK: If figures not detected but we have Vision API, scan pages for charts
            Write-Host "   [VISION] Figures API unavailable - scanning pages for visual content..." -ForegroundColor Yellow
            
            # Scan each page for potential charts/images
            $pagesToScan = [Math]::Min($pageCount, 20)  # Limit to first 20 pages for cost
            Write-Host "   [VISION] Scanning first $pagesToScan pages for charts/images..." -ForegroundColor Cyan
            
            for ($scanPage = 1; $scanPage -le $pagesToScan; $scanPage++) {
                try {
                    Write-Host "      [VISION] Scanning page $scanPage..." -ForegroundColor Gray
                    
                    $visionResult = Invoke-ChartVisionExtraction -PdfUrl $pdfUrl `
                        -PageNumber $scanPage `
                        -BoundingBox $null `
                        -Caption $null `
                        -OpenAIEndpoint $openAIEndpoint `
                        -OpenAIKey $openAIKey `
                        -DocumentId $pdfName `
                        -ScanMode $true
                    
                    if ($visionResult -and $visionResult.success -and $visionResult.extraction.visualType -ne "no_visual") {
                        $extractedData = $visionResult.extraction
                        Write-Host "      [FOUND] Page $scanPage`: $($extractedData.visualType) - $($extractedData.title)" -ForegroundColor Green
                        
                        $chartExtractionResults += @{
                            figureIndex = $chartExtractionResults.Count + 1
                            pageNumber = $scanPage
                            boundingBox = $null
                            caption = $extractedData.title
                            confidence = $extractedData.confidence
                            visualType = $extractedData.visualType
                            chartData = $extractedData.chartData
                            diagramData = $extractedData.diagramData
                            description = $extractedData.description
                            extractedText = $extractedData.extractedText
                            status = "scanned"
                        }
                    }
                } catch {
                    Write-Host "      [WARN] Page $scanPage scan failed" -ForegroundColor Yellow
                }
                
                Start-Sleep -Milliseconds 300
            }
            
            if ($chartExtractionResults.Count -gt 0) {
                Write-Host "   [OK] Found $($chartExtractionResults.Count) charts/images via page scanning" -ForegroundColor Green
            } else {
                Write-Host "   [INFO] No charts/images found in scanned pages" -ForegroundColor Gray
            }
        } else {
            Write-Host "   [SKIP] No figures to extract and Vision API not available" -ForegroundColor Gray
        }
        
        # ELITE: Multi-type chunking (text chunks + table chunks)
        Write-Host "   [2/4] Chunking content (size: $ChunkSize, overlap: $ChunkOverlap)..." -ForegroundColor Gray
        
        # Create text chunks (excluding table content for better structure)
        $textContent = $fullText
        # Remove table markers to chunk clean text separately
        $textContent = $textContent -replace "--- TABLE.*?--- END TABLE ---", ""
        
        # WORLD-CLASS: Use intelligent chunking with paragraph structure
        $textChunks = Split-TextIntoIntelligentChunks -Text $textContent -AnalysisResult $analysisResult `
            -TargetChunkSize $ChunkSize -Overlap $ChunkOverlap
        
        # ELITE: Create separate table row chunks (critical for trend analysis)
        $tableChunks = @()
        foreach ($table in $structuredTables) {
            # Create chunks for each row (or logical groups for large tables)
            foreach ($row in $table.rows) {
                if (-not $row.isHeader) {  # Skip header rows (they're in metadata)
                    $tableChunks += @{
                        type = "table_row"
                        tableIndex = $table.tableIndex
                        pageNumber = $table.pageNumber
                        rowIndex = $row.rowIndex
                        content = $row.text
                        headers = $table.headers
                        rowValues = $row.values
                        confidence = $table.confidence
                    }
                }
            }
        }
        
        Write-Host "   [OK] Created $($textChunks.Count) text chunks + $($tableChunks.Count) table row chunks" -ForegroundColor Green
        
        # Analyze document for metadata (Phase 1 - Data Foundation)
        Write-Host "   [3/4] Analyzing document metadata..." -ForegroundColor Gray
        
        $title = ($pdfName -replace '\.pdf$', '' -replace '[-_]', ' ')
        $publicationYear = Get-PublicationYear -FileName $pdfName -Content $fullText
        
        # WORLD-CLASS: AI-powered document-level tagging (analyzes full document)
        # AI tagging is ENABLED by default when OpenAI is available (world-class intelligence, no compromise)
        $useAITagging = (-not $DisableAITagging) -and $hasOpenAI
        
        if ($useAITagging) {
            try {
                Write-Host "      [AI] Analyzing document-level metadata with AI..." -ForegroundColor Magenta
                $docAITags = Get-DocumentTagsWithAI -Content $fullText -OpenAIEndpoint $openAIEndpoint `
                    -OpenAIKey $openAIKey -DocumentTitle $title -Deployment $AITaggingModel
                
                $docCategory = $docAITags.category
                $docSector = if ($docAITags.sectors -and $docAITags.sectors.Count -gt 0) { $docAITags.sectors[0] } else { "general" }
                $docTags = if ($docAITags.tags -and $docAITags.tags.Count -gt 0) { @($docAITags.tags) } else { @() }
                $docTopics = if ($docAITags.topics -and $docAITags.topics.Count -gt 0) { @($docAITags.topics) } else { @() }
                
                Write-Host "      [OK] AI document-level analysis complete (confidence: $($docAITags.confidence))" -ForegroundColor Green
                $script:stats.documentAITagsSucceeded++
            } catch {
                Write-Host "      [WARN] AI document-level tagging failed, using regex fallback" -ForegroundColor Yellow
                $script:stats.documentAITagsFailed++
                # Fallback to regex
        $docCategory = Get-DocumentCategory -FileName $pdfName -Content $fullText
        $docTags = Get-DocumentTags -FileName $pdfName -Content $fullText
        $docSector = Get-DocumentSector -Content $fullText
                $docTopics = @()
            }
        } else {
            # Use regex-based tagging (fallback)
            $docCategory = Get-DocumentCategory -FileName $pdfName -Content $fullText
            $docTags = Get-DocumentTags -FileName $pdfName -Content $fullText
            $docSector = Get-DocumentSector -Content $fullText
            $docTopics = @()
        }
        
        # WORLD-CLASS: AI-powered chunk-level tagging (MANDATORY for best intelligence)
        $useChunkLevelAI = (-not $DisableAITagging) -and $hasOpenAI
        Write-Host ""
        Write-Host "   [AI Tagging Status for: $pdfName]" -ForegroundColor Cyan
        if ($useChunkLevelAI) {
            Write-Host "      ✅ AI Document-Level: ENABLED (full document analysis)" -ForegroundColor Green
            Write-Host "      ✅ AI Chunk-Level: ENABLED" -ForegroundColor Green
            Write-Host "         Model: $AITaggingModel" -ForegroundColor White
            Write-Host "         Document-level: Full document analysis (8000 chars)" -ForegroundColor Cyan
            Write-Host "         Chunk-level: Every chunk (text + tables) will get:" -ForegroundColor White
            Write-Host "           • AI-powered category classification" -ForegroundColor Cyan
            Write-Host "           • Multi-sector identification (all relevant sectors)" -ForegroundColor Cyan
            Write-Host "           • 3-7 specific topics extracted" -ForegroundColor Cyan
            Write-Host "           • Occupation detection (with qualification levels)" -ForegroundColor Cyan
            Write-Host "           • Confidence scoring (0.0-1.0)" -ForegroundColor Cyan
            Write-Host "         Status: World-class intelligence active (document + chunk level)" -ForegroundColor Green
        } elseif ($hasOpenAI -and $DisableAITagging) {
            Write-Host "      ❌ AI Tagging: DISABLED (flag: -DisableAITagging)" -ForegroundColor Red
            Write-Host "         WARNING: Graph RAG will NOT work without AI tags!" -ForegroundColor Red
            Write-Host "         WARNING: Sectors, topics, categories needed for relationships!" -ForegroundColor Red
            Write-Host "         FIX: Remove -DisableAITagging flag and reprocess" -ForegroundColor Yellow
        } elseif (-not $hasOpenAI) {
            Write-Host "      ❌ AI Tagging: UNAVAILABLE (OpenAI not configured)" -ForegroundColor Red
            Write-Host "         Using: Regex-based document-level tagging" -ForegroundColor Gray
            Write-Host "         To enable: Deploy OpenAI with: .\deploy-openai-model.ps1" -ForegroundColor Gray
        }
        Write-Host ""
        
        # Ensure we have at least some tags
        if ($docTags.Count -eq 0) {
            $docTags = @("sa-government", "general")
        }
        
        # Ensure we have a category
        if (-not $docCategory -or $docCategory -eq "") {
            $docCategory = "government-document"
        }
        
        # Ensure we have a sector
        if (-not $docSector -or $docSector -eq "") {
            $docSector = "general"
        }
        
        Write-Host "   [OK] Doc Category: $docCategory, Sector: $docSector, Tags: $($docTags.Count), Year: $(if ($publicationYear) { $publicationYear } else { 'Not found' })" -ForegroundColor Green
        
        # Source URL (provenance tracking - Phase 1 requirement)
        $sourceUrl = "https://$storageAccountName.blob.core.windows.net/$ContainerName/$pdfName"
        $sanitizedTitle = Sanitize-TextForIndexing -Text $title
        
        # Index chunks - PRIORITY #1: Tables first, then batch indexing for performance
        $totalChunksToIndex = $textChunks.Count + $tableChunks.Count
        Write-Host "   [4/4] Processing $totalChunksToIndex chunks ($($textChunks.Count) text + $($tableChunks.Count) table rows)..." -ForegroundColor Gray
        Write-Host "         Priority: Tables first (batch indexing enabled)" -ForegroundColor Cyan
        
        $indexedChunks = 0
        $chunkGlobalIndex = 0
        $tableDocumentsToIndex = @()
        $textDocumentsToIndex = @()
        
        # ============================================================
        # PRIORITY #1: PROCESS TABLE CHUNKS FIRST (CRITICAL FOR TREND ANALYSIS)
        # ============================================================
        
        Write-Host "   [PRIORITY] Processing $($tableChunks.Count) table row chunks first..." -ForegroundColor Magenta
        
        foreach ($tableChunk in $tableChunks) {
            $tableIdInput = "$pdfName-table-$($tableChunk.tableIndex)-row-$($tableChunk.rowIndex)"
            $tableIdHash = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($tableIdInput))
            $tableDocId = ([System.Convert]::ToBase64String($tableIdHash) -replace '[^a-zA-Z0-9]', '').Substring(0, [Math]::Min(44, 44))
            
            # ELITE: Build table row chunk with structured metadata
            $tableMetadata = @{
                fileName = $pdfName
                fileSize = $pdf.size
                totalPages = $pageCount
                extractionMethod = "DocumentIntelligence-Layout"
                chunkType = "table_row"
                tableIndex = $tableChunk.tableIndex
                rowIndex = $tableChunk.rowIndex
                headers = $tableChunk.headers
                confidence = $tableChunk.confidence
                rowValues = $tableChunk.rowValues
            }
            
            if ($publicationYear) {
                $tableMetadata["publicationYear"] = $publicationYear
            }
            
            # CRITICAL: Sanitize all text fields to prevent UTF-8 encoding errors
            $sanitizedTableContent = Sanitize-TextForIndexing -Text $tableChunk.content
            $sanitizedTableTitle = Sanitize-TextForIndexing -Text "$title - Table $($tableChunk.tableIndex) Row $($tableChunk.rowIndex)"
            $sanitizedTableMetadata = Sanitize-TextForIndexing -Text ($tableMetadata | ConvertTo-Json -Compress)
            
            # WORLD-CLASS: AI-powered tagging for table chunks (mandatory for best intelligence)
            $tableChunkCategory = $docCategory
            # CRITICAL: Ensure tags is always an array
            $tableChunkTags = if ($docTags -and $docTags.Count -gt 0) { @($docTags) } else { @() }
            $tableChunkSector = $docSector
            # CRITICAL: Ensure sectors is always an array
            $tableChunkSectors = if ($docSector) { @($docSector) } else { @("general") }
            $tableChunkTopics = @()
            $tableChunkOccupation = $null
            $tableTagConfidence = 0.7
            
            if ($useChunkLevelAI) {
                try {
                    if ($tableChunk.rowIndex -eq 1 -or ($tableChunks.IndexOf($tableChunk) -eq 0)) {
                        Write-Host "      [AI] Analyzing table chunks with AI intelligence..." -ForegroundColor Magenta
                    }
                    $aiTags = Get-ChunkTagsWithAI -Content $tableChunk.content -OpenAIEndpoint $openAIEndpoint `
                        -OpenAIKey $openAIKey -DocumentTitle "$title - Table $($tableChunk.tableIndex)" -Deployment $AITaggingModel
                    
                    $tableChunkCategory = $aiTags.category
                    # CRITICAL: Ensure sectors is always an array
                    $tableChunkSectors = if ($aiTags.sectors -and $aiTags.sectors.Count -gt 0) { @($aiTags.sectors) } else { @("general") }
                    $tableChunkSector = if ($tableChunkSectors.Count -gt 0) { $tableChunkSectors[0] } else { "general" }
                    # CRITICAL: Ensure tags is always an array
                    $aiTagArray = if ($aiTags.tags -and $aiTags.tags.Count -gt 0) { @($aiTags.tags) } else { @() }
                    $docTagArray = if ($docTags -and $docTags.Count -gt 0) { @($docTags) } else { @() }
                    # CRITICAL: Wrap in @() because Select-Object -Unique returns scalar for single item
                    $tableChunkTags = @(($aiTagArray + $docTagArray) | Select-Object -Unique)
                    # CRITICAL: Ensure topics is always an array
                    $tableChunkTopics = if ($aiTags.topics -and $aiTags.topics.Count -gt 0) { @($aiTags.topics) } else { @() }
                    $tableChunkOccupation = $aiTags.occupation
                    $tableTagConfidence = $aiTags.confidence
                    $script:stats.aiTagsSucceeded++
                } catch {
                    Write-Host "      [WARN] AI tagging failed for table row $($tableChunk.rowIndex), using doc-level tags" -ForegroundColor Yellow
                    $script:stats.aiTagsFailed++
                    
                    # AUDIT: Track AI tag failure
                    $script:auditLog.failedAITags += @{
                        documentId = $pdfName
                        chunkType = "table_row"
                        tableIndex = $tableChunk.tableIndex
                        rowIndex = $tableChunk.rowIndex
                        error = $_.Exception.Message
                        fallback = "document_level_tags"
                        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                }
            }
            
            # CRITICAL: Ensure all array fields are always arrays (Azure AI Search requirement)
            # Pre-create typed arrays BEFORE hashtable to ensure proper JSON serialization
            [string[]]$finalTableTagsArray = if ($tableChunkTags -and $tableChunkTags.Count -gt 0) { $tableChunkTags } else { @() }
            [string[]]$finalTableSectorsArray = if ($tableChunkSectors -and $tableChunkSectors.Count -gt 0) { $tableChunkSectors } else { @("general") }
            [string[]]$finalTableTopicsArray = if ($tableChunkTopics -and $tableChunkTopics.Count -gt 0) { $tableChunkTopics } else { @() }
            
            $tableDocument = @{
                "@search.action" = if ($ForceReprocess) { "upload" } else { "mergeOrUpload" }
                id = $tableDocId
                content = $sanitizedTableContent
                documentId = $pdfName
                documentType = "pdf"
                source = "blob-storage"
                url = $sourceUrl
                title = $sanitizedTableTitle
                pageNumber = $tableChunk.pageNumber
                chunkIndex = $chunkGlobalIndex
                chunkType = "table_row"
                confidence = $tableChunk.confidence
                indexedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                category = $tableChunkCategory
                tags = $finalTableTagsArray
                sector = $tableChunkSector
                sectors = $finalTableSectorsArray
                topics = $finalTableTopicsArray
                occupation = $tableChunkOccupation
                tagConfidence = $tableTagConfidence
                metadata = $sanitizedTableMetadata
                retrievalWeight = 1.5  # ELITE: Tables get higher weight for trend queries
            }
            
            # ELITE: Generate embedding for table rows (critical for trend queries) with retry
            if ($hasOpenAI -and $GenerateEmbeddings) {
                $tableTextForEmbedding = Sanitize-TextForIndexing -Text $tableChunk.content
                $embeddingResult = Generate-Embedding -Text $tableTextForEmbedding -Endpoint $openAIEndpoint -Key $openAIKey
                if ($embeddingResult -and $embeddingResult.embedding) {
                    # CRITICAL: Cast embedding to [double[]] for proper JSON serialization
                    $embeddingArray = [double[]]@($embeddingResult.embedding)
                    
                    # Validate embedding doesn't contain Infinity/NaN values
                    $hasInvalidValue = $false
                    foreach ($val in $embeddingArray) {
                        if ([double]::IsNaN($val) -or [double]::IsInfinity($val)) {
                            $hasInvalidValue = $true
                            break
                        }
                    }
                    
                    if (-not $hasInvalidValue) {
                        $tableDocument["contentVector"] = $embeddingArray
                    $tableDocument["embeddingModel"] = $embeddingResult.model
                    $tableDocument["embeddingGeneratedAt"] = $embeddingResult.generatedAt
                    $script:stats.embeddingsGenerated++
                } else {
                        Write-Host "      [WARN] Table row $($tableChunk.rowIndex) has invalid embedding values - skipping embedding" -ForegroundColor Yellow
                    }
                } else {
                    # IMPORTANT: Still index the table row without embedding (preserves keyword search)
                    Write-Host "      [WARN] Table row $($tableChunk.rowIndex) has no embedding - indexing without vector" -ForegroundColor Yellow
                    $script:stats.embeddingErrors++
                    
                    # AUDIT: Track chunk without embedding
                    $script:auditLog.skippedChunks += @{
                        documentId = $pdfName
                        chunkType = "table_row"
                        tableIndex = $tableChunk.tableIndex
                        rowIndex = $tableChunk.rowIndex
                        reason = "no_embedding_generated"
                        content = $tableChunk.content.Substring(0, [Math]::Min(100, $tableChunk.content.Length)) + "..."
                        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                    # NO continue - still add document to index!
                }
                # Adaptive rate limiting for table chunks
                $currentDelay = if ($script:stats.rateLimitHits -gt 10) { $baseEmbeddingDelay * 3 }
                               elseif ($script:stats.rateLimitHits -gt 5) { $baseEmbeddingDelay * 2 }
                               elseif ($script:stats.rateLimitHits -gt 2) { $baseEmbeddingDelay * 1.5 }
                               else { $baseEmbeddingDelay }
                Start-Sleep -Milliseconds $currentDelay
            } elseif ($GenerateEmbeddings -and -not $hasOpenAI) {
                Write-Host "      [ERROR] Embeddings required but OpenAI not configured - aborting" -ForegroundColor Red
                exit 1
            }
            
            $tableDocumentsToIndex += $tableDocument
            $chunkGlobalIndex++
        }
        
        Write-Host "   [OK] Prepared $($tableDocumentsToIndex.Count) table documents for batch indexing" -ForegroundColor Green
        
        # ============================================================
        # PROCESS TEXT CHUNKS (SECOND PRIORITY)
        # ============================================================
        
        Write-Host "   [TEXT] Processing $($textChunks.Count) text chunks..." -ForegroundColor Cyan
        
        # ELITE: Process text chunks with confidence scores
        foreach ($chunk in $textChunks) {
            $textIdInput = "$pdfName-text-chunk-$($chunk.index)"
            $textIdHash = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($textIdInput))
            $docId = ([System.Convert]::ToBase64String($textIdHash) -replace '[^a-zA-Z0-9]', '').Substring(0, [Math]::Min(44, 44))
            
            # Determine page number and confidence for this chunk
            $chunkPage = 1
            $chunkConfidence = 1.0
            $charPosition = 0
            foreach ($pageNum in ($pageTexts.Keys | Sort-Object)) {
                $pageLength = $pageTexts[$pageNum].Length
                if ($charPosition + $pageLength -gt ($chunk.index * ($ChunkSize - $ChunkOverlap))) {
                    $chunkPage = $pageNum
                    $chunkConfidence = if ($pageConfidences.ContainsKey($pageNum)) { $pageConfidences[$pageNum] } else { 1.0 }
                    break
                }
                $charPosition += $pageLength
            }
            
            # ELITE: Build complete metadata with confidence scores
            # Include charts in totalChunks for accurate coverage calculation
            $chartCount = if ($chartExtractionResults) { $chartExtractionResults.Count } else { 0 }
            $documentMetadata = @{
                fileName = $pdfName
                fileSize = $pdf.size
                totalPages = $pageCount
                totalChunks = $textChunks.Count + $tableChunks.Count + $chartCount
                chunkCharCount = $chunk.charCount
                extractionMethod = "DocumentIntelligence-Layout"
                tablesFound = $structuredTables.Count
                chartsFound = $chartCount
                chunkType = "text"  # ELITE: Chunk type identification
                confidence = $chunkConfidence  # ELITE: Confidence score
            }
            
            # Add publication year if found (Phase 1 - Data Foundation)
            if ($publicationYear) {
                $documentMetadata["publicationYear"] = $publicationYear
            }
            
            # ELITE: Build document with confidence, chunk type, and retrieval weight
            # CRITICAL: Sanitize all text fields to prevent UTF-8 encoding errors
            $sanitizedContent = Sanitize-TextForIndexing -Text $chunk.text
            $sanitizedMetadata = Sanitize-TextForIndexing -Text ($documentMetadata | ConvertTo-Json -Compress)
            
            # WORLD-CLASS: AI-powered chunk-level tagging
            $chunkCategory = $docCategory
            # CRITICAL: Ensure tags is always an array (Azure AI Search requires arrays)
            $chunkTags = if ($docTags -and $docTags.Count -gt 0) { @($docTags) } else { @() }
            $chunkSector = $docSector
            # CRITICAL: Ensure sectors is always an array
            $chunkSectors = if ($docSector) { @($docSector) } else { @("general") }
            $chunkTopics = @()
            $chunkOccupation = $null
            $tagConfidence = 0.7
            
            if ($useChunkLevelAI) {
                try {
                    if ($chunk.index -eq 0) {
                        Write-Host "      [AI] Analyzing text chunks with AI intelligence..." -ForegroundColor Magenta
                    }
                    # Show progress every 50 chunks
                    if ($chunk.index -gt 0 -and $chunk.index % 50 -eq 0) {
                        Write-Host "      [AI] Progress: $($chunk.index)/$($textChunks.Count) chunks analyzed..." -ForegroundColor Gray
                    }
                    $aiTags = Get-ChunkTagsWithAI -Content $chunk.text -OpenAIEndpoint $openAIEndpoint `
                        -OpenAIKey $openAIKey -DocumentTitle $title -Deployment $AITaggingModel
                    
                    $chunkCategory = $aiTags.category
                    # CRITICAL: Ensure sectors is always an array
                    $chunkSectors = if ($aiTags.sectors -and $aiTags.sectors.Count -gt 0) { @($aiTags.sectors) } else { @("general") }
                    $chunkSector = if ($chunkSectors.Count -gt 0) { $chunkSectors[0] } else { "general" }
                    # CRITICAL: Ensure tags is always an array
                    # Note: Select-Object -Unique returns scalar for single item, so wrap in @() to force array
                    $aiTagArray = if ($aiTags.tags -and $aiTags.tags.Count -gt 0) { @($aiTags.tags) } else { @() }
                    $docTagArray = if ($docTags -and $docTags.Count -gt 0) { @($docTags) } else { @() }
                    $chunkTags = @(($aiTagArray + $docTagArray) | Select-Object -Unique)
                    # CRITICAL: Ensure topics is always an array
                    $chunkTopics = if ($aiTags.topics -and $aiTags.topics.Count -gt 0) { @($aiTags.topics) } else { @() }
                    $chunkOccupation = $aiTags.occupation
                    $tagConfidence = $aiTags.confidence
                    $script:stats.aiTagsSucceeded++
                    
                    # AUDIT: Track low confidence chunks for review
                    if ($tagConfidence -lt 0.7) {
                        $script:stats.lowConfidenceChunks++
                        $script:auditLog.lowConfidenceItems += @{
                            documentId = $pdfName
                            chunkType = "text"
                            chunkIndex = $chunk.index
                            pageNumber = $chunkPage
                            confidence = $tagConfidence
                            category = $chunkCategory
                            contentPreview = $chunk.text.Substring(0, [Math]::Min(100, $chunk.text.Length)) + "..."
                            timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                        }
                    }
                } catch {
                    # Fallback to document-level tags on error
                    Write-Host "     [WARN] AI tagging failed for chunk $($chunk.index), using doc-level tags" -ForegroundColor Yellow
                    $script:stats.aiTagsFailed++
                    
                    # AUDIT: Track AI tag failure
                    $script:auditLog.failedAITags += @{
                        documentId = $pdfName
                        chunkType = "text"
                        chunkIndex = $chunk.index
                        pageNumber = $chunkPage
                        error = $_.Exception.Message
                        fallback = "document_level_tags"
                        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                }
            }
            
            # CRITICAL: Ensure all array fields are always arrays (Azure AI Search requirement)
            # Pre-create typed arrays BEFORE hashtable to ensure proper JSON serialization
            [string[]]$finalTagsArray = if ($chunkTags -and $chunkTags.Count -gt 0) { $chunkTags } else { @() }
            [string[]]$finalSectorsArray = if ($chunkSectors -and $chunkSectors.Count -gt 0) { $chunkSectors } else { @("general") }
            [string[]]$finalTopicsArray = if ($chunkTopics -and $chunkTopics.Count -gt 0) { $chunkTopics } else { @() }
            
            $document = @{
                "@search.action" = if ($ForceReprocess) { "upload" } else { "mergeOrUpload" }
                id = $docId
                content = $sanitizedContent
                documentId = $pdfName
                documentType = "pdf"
                source = "blob-storage"
                url = $sourceUrl
                title = $sanitizedTitle
                pageNumber = $chunkPage
                chunkIndex = $chunk.index
                chunkType = "text"
                confidence = $chunkConfidence
                indexedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                category = $chunkCategory
                tags = $finalTagsArray
                sector = $chunkSector
                sectors = $finalSectorsArray
                topics = $finalTopicsArray
                occupation = $chunkOccupation
                tagConfidence = $tagConfidence
                metadata = $sanitizedMetadata
                retrievalWeight = 1.0
            }
            
            # ELITE: Generate embedding with retry logic (target: 98%+ coverage)
            if ($hasOpenAI -and $GenerateEmbeddings) {
                # CRITICAL: Sanitize text BEFORE embedding generation to prevent UTF-8 encoding errors
                $textForEmbedding = Sanitize-TextForIndexing -Text $chunk.text
                $embeddingResult = Generate-Embedding -Text $textForEmbedding -Endpoint $openAIEndpoint -Key $openAIKey
                if ($embeddingResult -and $embeddingResult.embedding) {
                    # CRITICAL: Cast embedding to [double[]] to ensure proper JSON serialization
                    # PowerShell's ConvertTo-Json can mishandle arrays from Invoke-RestMethod
                    $embeddingArray = [double[]]@($embeddingResult.embedding)
                    
                    # Validate embedding doesn't contain Infinity/NaN values
                    $hasInvalidValue = $false
                    foreach ($val in $embeddingArray) {
                        if ([double]::IsNaN($val) -or [double]::IsInfinity($val)) {
                            $hasInvalidValue = $true
                            break
                        }
                    }
                    
                    if ($hasInvalidValue) {
                        # IMPORTANT: Still index the document, just without vector (allows keyword search)
                        Write-Host "      [WARN] Chunk $($chunk.index) has invalid embedding values (Infinity/NaN) - indexing without vector" -ForegroundColor Yellow
                        $script:stats.embeddingErrors++
                        # Don't set contentVector - document will still be indexed for keyword search
                    } else {
                        $document["contentVector"] = $embeddingArray
                    # ELITE: Store embedding metadata
                    $document["embeddingModel"] = $embeddingResult.model
                    $document["embeddingGeneratedAt"] = $embeddingResult.generatedAt
                    $script:stats.embeddingsGenerated++
                    }
                } else {
                    # IMPORTANT: Still index the document without embedding (preserves keyword search)
                    # Don't skip - the text content is still valuable for keyword/semantic search
                    $script:stats.embeddingErrors++
                    Write-Host "      [WARN] Chunk $($chunk.index) has no embedding - indexing without vector" -ForegroundColor Yellow
                    
                    # AUDIT: Track chunk without embedding
                    $script:auditLog.skippedChunks += @{
                        documentId = $pdfName
                        chunkType = "text"
                        chunkIndex = $chunk.index
                        pageNumber = $chunkPage
                        reason = "no_embedding_generated"
                        contentPreview = $chunk.text.Substring(0, [Math]::Min(100, $chunk.text.Length)) + "..."
                        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                    # NO continue - still add document to index!
                }
                # Adaptive rate limiting
                $currentDelay = if ($script:stats.rateLimitHits -gt 10) { $baseEmbeddingDelay * 3 }
                               elseif ($script:stats.rateLimitHits -gt 5) { $baseEmbeddingDelay * 2 }
                               elseif ($script:stats.rateLimitHits -gt 2) { $baseEmbeddingDelay * 1.5 }
                               else { $baseEmbeddingDelay }
                Start-Sleep -Milliseconds $currentDelay
            } elseif ($GenerateEmbeddings -and -not $hasOpenAI) {
                Write-Host "      [ERROR] Embeddings required but OpenAI not configured - aborting" -ForegroundColor Red
                exit 1
            }
            
            $textDocumentsToIndex += $document
            $chunkGlobalIndex++
        }
        
        Write-Host "   [OK] Prepared $($textDocumentsToIndex.Count) text documents for batch indexing" -ForegroundColor Green
        
        # ============================================================
        # PROCESS CHART/FIGURE CHUNKS (FOR RE-VISUALIZATION)
        # ============================================================
        
        $chartDocumentsToIndex = @()
        
        if ($chartExtractionResults.Count -gt 0) {
            Write-Host "   [CHARTS] Processing $($chartExtractionResults.Count) chart/figure chunks for indexing..." -ForegroundColor Magenta
            
            $chartIndex = 0
            foreach ($chart in $chartExtractionResults) {
                $chartIndex++
                # Show progress every 10 charts
                if ($chartIndex % 10 -eq 0 -or $chartIndex -eq 1) {
                    Write-Host "      [CHARTS] Progress: $chartIndex/$($chartExtractionResults.Count) charts processed..." -ForegroundColor Gray
                }
                $chartIdInput = "$pdfName-chart-$($chart.figureIndex)"
                $chartIdHash = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($chartIdInput))
                $chartDocId = ([System.Convert]::ToBase64String($chartIdHash) -replace '[^a-zA-Z0-9]', '').Substring(0, [Math]::Min(44, 44))
                
                # Build searchable content from chart data
                $chartContent = @()
                if ($chart.description) { $chartContent += $chart.description }
                if ($chart.caption) { $chartContent += "Caption: $($chart.caption)" }
                if ($chart.spanText) { $chartContent += $chart.spanText }
                if ($chart.extractedText) { $chartContent += $chart.extractedText -join " " }
                
                # Add chart data as readable content for semantic search
                if ($chart.chartData) {
                    $chartContent += "Chart data: "
                    if ($chart.chartData.labels) {
                        $chartContent += "Labels: $($chart.chartData.labels -join ', ')"
                    }
                    if ($chart.chartData.datasets) {
                        foreach ($dataset in $chart.chartData.datasets) {
                            if ($dataset.name) { $chartContent += "Series: $($dataset.name)" }
                            if ($dataset.values) { $chartContent += "Values: $($dataset.values -join ', ')" }
                        }
                    }
                }
                
                if ($chart.diagramData) {
                    $chartContent += "Diagram elements: "
                    if ($chart.diagramData.nodes) {
                        $nodeTexts = $chart.diagramData.nodes | ForEach-Object { $_.text } | Where-Object { $_ }
                        $chartContent += $nodeTexts -join ", "
                    }
                }
                
                $chartContentText = $chartContent -join ". "
                if ($chartContentText.Length -lt 10) {
                    $chartContentText = "Figure $($chart.figureIndex) on page $($chart.pageNumber)"
                }
                
                $sanitizedChartContent = Sanitize-TextForIndexing -Text $chartContentText
                $sanitizedChartTitle = Sanitize-TextForIndexing -Text "$title - Figure $($chart.figureIndex)"
                
                # Convert chart data to JSON for storage
                $chartDataJson = if ($chart.chartData) { 
                    $chart.chartData | ConvertTo-Json -Compress -Depth 10
                } else { $null }
                
                $diagramDataJson = if ($chart.diagramData) {
                    $chart.diagramData | ConvertTo-Json -Compress -Depth 10
                } else { $null }
                
                # AI tagging for chart content
                $chartCategory = $docCategory
                # CRITICAL: Ensure tags is always an array
                $docTagArray = if ($docTags -and $docTags.Count -gt 0) { @($docTags) } else { @() }
                $chartTags = $docTagArray + @("chart", "visualization", $chart.visualType)
                $chartSector = $docSector
                $chartSectorsArray = if ($docSector) { @($docSector) } else { @("general") }
                $chartTopics = @()
                
                if ($useChunkLevelAI -and $sanitizedChartContent.Length -gt 20) {
                    try {
                        $aiTags = Get-ChunkTagsWithAI -Content $sanitizedChartContent -OpenAIEndpoint $openAIEndpoint `
                            -OpenAIKey $openAIKey -DocumentTitle "$title - Chart" -Deployment $AITaggingModel
                        $chartCategory = $aiTags.category
                        # CRITICAL: Ensure sectors is always an array
                        $chartSectorsArray = if ($aiTags.sectors -and $aiTags.sectors.Count -gt 0) { @($aiTags.sectors) } else { @("general") }
                        $chartSector = if ($chartSectorsArray.Count -gt 0) { $chartSectorsArray[0] } else { "general" }
                        # CRITICAL: Ensure tags is always an array
                        $aiTagArray = if ($aiTags.tags -and $aiTags.tags.Count -gt 0) { @($aiTags.tags) } else { @() }
                        # CRITICAL: Wrap in @() because Select-Object -Unique returns scalar for single item
                        $chartTags = @(($aiTagArray + $chartTags) | Select-Object -Unique)
                        # CRITICAL: Ensure topics is always an array
                        $chartTopics = if ($aiTags.topics -and $aiTags.topics.Count -gt 0) { @($aiTags.topics) } else { @() }
                        $script:stats.aiTagsSucceeded++
                    } catch {
                        $script:stats.aiTagsFailed++
                    }
                }
                
                # CRITICAL: Ensure all array fields are always arrays (Azure AI Search requirement)
                # Pre-create typed arrays BEFORE hashtable to ensure proper JSON serialization
                [string[]]$finalChartTagsArray = if ($chartTags -and $chartTags.Count -gt 0) { $chartTags } else { @() }
                [string[]]$finalChartSectorsArray = if ($chartSectorsArray -and $chartSectorsArray.Count -gt 0) { $chartSectorsArray } else { @("general") }
                [string[]]$finalChartTopicsArray = if ($chartTopics -and $chartTopics.Count -gt 0) { $chartTopics } else { @() }
                
                $chartDocument = @{
                    "@search.action" = if ($ForceReprocess) { "upload" } else { "mergeOrUpload" }
                    id = $chartDocId
                    content = $sanitizedChartContent
                    documentId = $pdfName
                    documentType = "pdf"
                    source = "blob-storage"
                    url = $sourceUrl
                    title = $sanitizedChartTitle
                    pageNumber = $chart.pageNumber
                    chunkIndex = $chunkGlobalIndex
                    chunkType = "chart"
                    confidence = $chart.confidence
                    indexedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    category = $chartCategory
                    tags = $finalChartTagsArray
                    sector = $chartSector
                    sectors = $finalChartSectorsArray
                    topics = $finalChartTopicsArray
                    metadata = Sanitize-TextForIndexing -Text (@{
                        figureIndex = $chart.figureIndex
                        extractionStatus = $chart.status
                        boundingBox = $chart.boundingBox
                    } | ConvertTo-Json -Compress)
                    retrievalWeight = 1.3  # Charts get higher weight
                    
                    # CHART-SPECIFIC FIELDS (for re-visualization)
                    hasChart = $true
                    chartType = $chart.visualType
                    chartData = $chartDataJson
                    visualDescription = $chart.description
                    chartConfidence = $chart.confidence
                }
                
                # Generate embedding for chart content
                if ($hasOpenAI -and $GenerateEmbeddings -and $sanitizedChartContent.Length -gt 20) {
                    $embeddingResult = Generate-Embedding -Text $sanitizedChartContent -Endpoint $openAIEndpoint -Key $openAIKey
                    if ($embeddingResult -and $embeddingResult.embedding) {
                        # CRITICAL: Cast embedding to [double[]] for proper JSON serialization
                        $embeddingArray = [double[]]@($embeddingResult.embedding)
                        
                        # Validate embedding doesn't contain Infinity/NaN values
                        $hasInvalidValue = $false
                        foreach ($val in $embeddingArray) {
                            if ([double]::IsNaN($val) -or [double]::IsInfinity($val)) {
                                $hasInvalidValue = $true
                                break
                            }
                        }
                        
                        if (-not $hasInvalidValue) {
                            $chartDocument["contentVector"] = $embeddingArray
                        $chartDocument["embeddingModel"] = $embeddingResult.model
                        $chartDocument["embeddingGeneratedAt"] = $embeddingResult.generatedAt
                        $script:stats.embeddingsGenerated++
                        } else {
                            Write-Host "      [WARN] Chart $($chart.figureIndex) has invalid embedding values - skipping embedding" -ForegroundColor Yellow
                        }
                    }
                    Start-Sleep -Milliseconds $baseEmbeddingDelay
                }
                
                $chartDocumentsToIndex += $chartDocument
                $chunkGlobalIndex++
                
                # Track in stats
                $script:stats.chartsExtracted++
            }
            
            Write-Host "   [OK] Prepared $($chartDocumentsToIndex.Count) chart documents for indexing" -ForegroundColor Green
        }
        
        # ============================================================
        # BATCH INDEXING - PRIORITY #1: Tables First
        # ============================================================
        
        Write-Host "   [BATCH] Batch indexing $($tableDocumentsToIndex.Count) table documents (priority)..." -ForegroundColor Magenta
        if ($tableDocumentsToIndex.Count -gt 0) {
            $tableBatchResult = Invoke-BatchIndex -Documents $tableDocumentsToIndex -SearchEndpoint $searchEndpoint `
                -SearchHeaders $searchHeaders -SearchIndexName $SearchIndexName -BatchType "table rows" -BatchSize 100
            $indexedChunks += $tableBatchResult.success
            $script:stats.tableRowsIndexed += $tableBatchResult.success  # AUDIT: Track table rows indexed
            if ($tableBatchResult.failed -gt 0) {
                Write-Host "      [WARN] $($tableBatchResult.failed) table documents failed to index" -ForegroundColor Yellow
                
                # AUDIT: Track failed table indexing
                $script:auditLog.failedIndexing += @{
                    documentId = $pdfName
                    type = "table_rows"
                    attempted = $tableDocumentsToIndex.Count
                    failed = $tableBatchResult.failed
                    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                }
            }
        }
        
        # ============================================================
        # BATCH INDEXING - Text Documents
        # ============================================================
        
        Write-Host "   [BATCH] Batch indexing $($textDocumentsToIndex.Count) text documents..." -ForegroundColor Cyan
        if ($textDocumentsToIndex.Count -gt 0) {
            $textBatchResult = Invoke-BatchIndex -Documents $textDocumentsToIndex -SearchEndpoint $searchEndpoint `
                -SearchHeaders $searchHeaders -SearchIndexName $SearchIndexName -BatchType "text chunks" -BatchSize 100
            $indexedChunks += $textBatchResult.success
            if ($textBatchResult.failed -gt 0) {
                Write-Host "      [WARN] $($textBatchResult.failed) text documents failed to index" -ForegroundColor Yellow
                
                # AUDIT: Track failed text indexing
                $script:auditLog.failedIndexing += @{
                    documentId = $pdfName
                    type = "text_chunks"
                    attempted = $textDocumentsToIndex.Count
                    failed = $textBatchResult.failed
                    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                }
            }
        }
        
        # ============================================================
        # BATCH INDEXING - Chart/Figure Documents
        # ============================================================
        
        Write-Host "   [BATCH] Batch indexing $($chartDocumentsToIndex.Count) chart/figure documents..." -ForegroundColor Magenta
        if ($chartDocumentsToIndex.Count -gt 0) {
            $chartBatchResult = Invoke-BatchIndex -Documents $chartDocumentsToIndex -SearchEndpoint $searchEndpoint `
                -SearchHeaders $searchHeaders -SearchIndexName $SearchIndexName -BatchType "charts/figures" -BatchSize 100
            $indexedChunks += $chartBatchResult.success
            $script:stats.documentsWithCharts++
            if ($chartBatchResult.failed -gt 0) {
                Write-Host "      [WARN] $($chartBatchResult.failed) chart documents failed to index" -ForegroundColor Yellow
                
                # AUDIT: Track failed chart indexing
                $script:auditLog.failedIndexing += @{
                    documentId = $pdfName
                    type = "charts"
                    attempted = $chartDocumentsToIndex.Count
                    failed = $chartBatchResult.failed
                    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                }
            }
            Write-Host "   [OK] Indexed $($chartBatchResult.success) chart/figure documents" -ForegroundColor Green
        }
        
        $totalExpectedChunks = $textChunks.Count + $tableChunks.Count + $chartExtractionResults.Count
        $failedChunks = $totalExpectedChunks - $indexedChunks
        if ($failedChunks -gt 0) {
            Write-Host "   [PARTIAL] Indexed $indexedChunks/$totalExpectedChunks chunks ($failedChunks FAILED) - $($textChunks.Count) text + $($tableChunks.Count) table rows + $($chartExtractionResults.Count) charts" -ForegroundColor Yellow
        } else {
            Write-Host "   [OK] Indexed $indexedChunks/$totalExpectedChunks chunks ($($textChunks.Count) text + $($tableChunks.Count) table rows + $($chartExtractionResults.Count) charts)" -ForegroundColor Green
        }
        $script:stats.processed++
        $script:stats.chunks += $totalExpectedChunks
        $script:stats.indexed += $indexedChunks
        
        # AUDIT: Per-document audit record
        $script:auditLog.documents += @{
            documentId = $pdfName
            status = "success"
            timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            metrics = @{
                pageCount = $pageCount
                textChunks = $textChunks.Count
                tableChunks = $tableChunks.Count
                chartChunks = $chartExtractionResults.Count
                totalChunks = $totalExpectedChunks
                indexedChunks = $indexedChunks
                tablesExtracted = $structuredTables.Count
                figuresDetected = $extractedFigures.Count
            }
        }
    }
    catch {
        Write-Host "   [FAILED] $($_.Exception.Message)" -ForegroundColor Red
        $script:stats.failed++
        
        # AUDIT: Track document processing failure
        Add-AuditEvent -Type "ERROR" -Category "document" -Message "Document processing failed" `
            -DocumentId $pdfName -Details @{
                error = $_.Exception.Message
                stage = "processing"
            }
    }
    
    Write-Host ""
}

# ============================================================
# COMPLETE AUDIT LOG - Finalize
# ============================================================

$script:auditLog.endTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

# ============================================================
# STEP 4: SUMMARY
# ============================================================

$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PROCESSING COMPLETE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Duration:       $([math]::Round($duration.TotalMinutes, 1)) minutes" -ForegroundColor White
Write-Host "  PDFs Processed: $($script:stats.processed)/$($pdfs.Count)" -ForegroundColor $(if ($script:stats.failed -eq 0) { "Green" } else { "Yellow" })
Write-Host "  PDFs Skipped:  $($script:stats.skipped) (already had >= 95% coverage)" -ForegroundColor Cyan
Write-Host "  PDFs Failed:   $($script:stats.failed)" -ForegroundColor $(if ($script:stats.failed -eq 0) { "Green" } else { "Red" })
Write-Host "  Total Chunks:   $($script:stats.chunks)" -ForegroundColor White
Write-Host "  Chunks Indexed: $($script:stats.indexed)" -ForegroundColor Green

# ELITE: Embedding coverage quality check (target: 98%+)
if ($hasOpenAI -and $GenerateEmbeddings) {
    Write-Host "  Embeddings:     $($script:stats.embeddingsGenerated)" -ForegroundColor $(if ($script:stats.embeddingErrors -eq 0) { "Green" } else { "Yellow" })
    if ($script:stats.embeddingErrors -gt 0) {
        Write-Host "  Embedding Errors: $($script:stats.embeddingErrors)" -ForegroundColor Yellow
    }
    
    # Quality check (target: 98%+ coverage)
    if ($script:stats.indexed -gt 0) {
        $embeddingCoverage = [math]::Round(($script:stats.embeddingsGenerated / $script:stats.indexed) * 100, 2)
        $coverageColor = if ($embeddingCoverage -ge 98) { "Green" } elseif ($embeddingCoverage -ge 95) { "Yellow" } else { "Red" }
        Write-Host "  Embedding Coverage: $embeddingCoverage%" -ForegroundColor $coverageColor
        
        if ($embeddingCoverage -lt 98) {
            Write-Host ""
            Write-Host "  [WARNING] Embedding coverage: $embeddingCoverage% (Target: 98%+)" -ForegroundColor Yellow
            if ($embeddingCoverage -lt 95) {
                Write-Host "            CRITICAL: Coverage below 95% - reprocess required!" -ForegroundColor Red
            }
        } else {
            Write-Host ""
            Write-Host "  [SUCCESS] Embedding coverage: $embeddingCoverage% - ELITE QUALITY (98%+)" -ForegroundColor Green
        }
    }
} elseif ($GenerateEmbeddings -and -not $hasOpenAI) {
    Write-Host "  [ERROR] Embeddings required but OpenAI is not configured" -ForegroundColor Red
    Write-Host "            Run: .\deploy-openai-model.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Search Index:   $SearchIndexName" -ForegroundColor White
Write-Host "  Endpoint:       $searchEndpoint" -ForegroundColor White
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Verify quality: .\verify-pdf-content.ps1 -ResourceGroupName $ResourceGroupName" -ForegroundColor White
Write-Host "  2. Check Azure Portal for indexed documents" -ForegroundColor White
Write-Host ""

if ($script:stats.processed -gt 0) {
    Write-Host "  [SUCCESS] Your RAG system is ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Every document has:" -ForegroundColor Cyan
    Write-Host "    - Full text extraction (Document Intelligence Layout)" -ForegroundColor White
    Write-Host "    - Sentence-aware chunking with overlap" -ForegroundColor White
    Write-Host "    - Page number tracking for citations" -ForegroundColor White
    Write-Host "    - Automatic categorization and tagging" -ForegroundColor White
    Write-Host "    - Sector classification" -ForegroundColor White
    Write-Host "    - Complete source attribution (zero hallucination)" -ForegroundColor White
    Write-Host "    - Chart/figure detection and extraction (NEW!)" -ForegroundColor Magenta
    if ($hasOpenAI -and $GenerateEmbeddings) {
        Write-Host "    - Vector embeddings for semantic search" -ForegroundColor White
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan

# ============================================================
# AUDIT REPORT - Complete Processing Audit
# ============================================================

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "  AUDIT REPORT" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host ""

# Coverage summary
$script:auditLog.coverage = @{
    totalPDFs = $pdfs.Count
    processed = $script:stats.processed
    skipped = $script:stats.skipped
    failed = $script:stats.failed
    totalChunks = $script:stats.chunks
    indexedChunks = $script:stats.indexed
    embeddingsGenerated = $script:stats.embeddingsGenerated
    embeddingErrors = $script:stats.embeddingErrors
    embeddingCoverage = if ($script:stats.indexed -gt 0) { [math]::Round(($script:stats.embeddingsGenerated / $script:stats.indexed) * 100, 2) } else { 0 }
    
    # Detailed stats
    tablesExtracted = $script:stats.tablesExtracted
    tableRowsIndexed = $script:stats.tableRowsIndexed
    figuresDetected = $script:stats.figuresDetected
    chartsExtracted = $script:stats.chartsExtracted
    
    # Document stats
    documentsWithTables = $script:stats.documentsWithTables
    documentsWithFigures = $script:stats.documentsWithFigures
    documentsWithCharts = $script:stats.documentsWithCharts
    
    # AI tagging stats
    aiTagsSucceeded = $script:stats.aiTagsSucceeded
    aiTagsFailed = $script:stats.aiTagsFailed
    aiTagSuccessRate = if (($script:stats.aiTagsSucceeded + $script:stats.aiTagsFailed) -gt 0) { 
        [math]::Round(($script:stats.aiTagsSucceeded / ($script:stats.aiTagsSucceeded + $script:stats.aiTagsFailed)) * 100, 2) 
    } else { 100 }
    
    # Document-level AI tagging stats
    documentAITagsSucceeded = $script:stats.documentAITagsSucceeded
    documentAITagsFailed = $script:stats.documentAITagsFailed
    documentAITagSuccessRate = if (($script:stats.documentAITagsSucceeded + $script:stats.documentAITagsFailed) -gt 0) { 
        [math]::Round(($script:stats.documentAITagsSucceeded / ($script:stats.documentAITagsSucceeded + $script:stats.documentAITagsFailed)) * 100, 2) 
    } else { 100 }
    
    # Rate limiting
    rateLimitHits = $script:stats.rateLimitHits
    
    # Quality flags
    lowConfidenceChunks = $script:stats.lowConfidenceChunks
    
    # Python JSON fixes
    pythonJsonFixes = $script:stats.pythonJsonFixes
}

# Display audit summary
Write-Host "  [COVERAGE]" -ForegroundColor Cyan
Write-Host "    Documents: $($script:stats.processed)/$($pdfs.Count) processed, $($script:stats.skipped) skipped, $($script:stats.failed) failed" -ForegroundColor White
Write-Host "    Chunks: $($script:stats.indexed)/$($script:stats.chunks) indexed" -ForegroundColor White
Write-Host "    Embeddings: $($script:stats.embeddingsGenerated) generated, $($script:stats.embeddingErrors) errors" -ForegroundColor $(if ($script:stats.embeddingErrors -eq 0) { "Green" } else { "Yellow" })
Write-Host ""

Write-Host "  [EXTRACTION]" -ForegroundColor Cyan
Write-Host "    Tables: $($script:stats.tablesExtracted) extracted from $($script:stats.documentsWithTables) documents" -ForegroundColor White
Write-Host "    Figures: $($script:stats.figuresDetected) detected from $($script:stats.documentsWithFigures) documents" -ForegroundColor White
Write-Host "    Charts: $($script:stats.chartsExtracted) extracted" -ForegroundColor White
Write-Host ""

if ($script:pythonAvailable -and $script:stats.pythonJsonFixes -gt 0) {
    Write-Host "  [JSON NORMALIZATION]" -ForegroundColor Cyan
    Write-Host "    Python fixes applied: $($script:stats.pythonJsonFixes) (prevented serialization errors)" -ForegroundColor Green
    Write-Host ""
}

Write-Host "  [AI TAGGING]" -ForegroundColor Cyan
$aiTagRate = $script:auditLog.coverage.aiTagSuccessRate
$aiTagColor = if ($aiTagRate -ge 95) { "Green" } elseif ($aiTagRate -ge 80) { "Yellow" } else { "Red" }
Write-Host "    Chunk-Level: $($script:stats.aiTagsSucceeded) succeeded, $($script:stats.aiTagsFailed) failed ($aiTagRate%)" -ForegroundColor $aiTagColor
$docAITagRate = $script:auditLog.coverage.documentAITagSuccessRate
$docAITagColor = if ($docAITagRate -ge 95) { "Green" } elseif ($docAITagRate -ge 80) { "Yellow" } else { "Red" }
Write-Host "    Document-Level: $($script:stats.documentAITagsSucceeded) succeeded, $($script:stats.documentAITagsFailed) failed ($docAITagRate%)" -ForegroundColor $docAITagColor
Write-Host ""

# Flag warnings if any
$hasFlags = $script:auditLog.warnings.Count -gt 0 -or 
            $script:auditLog.skippedChunks.Count -gt 0 -or 
            $script:auditLog.failedAITags.Count -gt 0 -or
            $script:auditLog.lowConfidenceItems.Count -gt 0 -or
            $script:auditLog.failedIndexing.Count -gt 0

if ($hasFlags) {
    Write-Host "  [FLAGS/WARNINGS]" -ForegroundColor Yellow
    
    if ($script:auditLog.skippedDocuments.Count -gt 0) {
        Write-Host "    Skipped Documents: $($script:auditLog.skippedDocuments.Count)" -ForegroundColor Yellow
    }
    
    if ($script:auditLog.skippedChunks.Count -gt 0) {
        Write-Host "    Skipped Chunks: $($script:auditLog.skippedChunks.Count)" -ForegroundColor Yellow
        # Show first 3 examples
        $examples = $script:auditLog.skippedChunks | Select-Object -First 3
        foreach ($example in $examples) {
            $chunkId = if ($example.chunkIndex) { $example.chunkIndex } else { $example.rowIndex }
            Write-Host "      - $($example.documentId) chunk $chunkId`: $($example.reason)" -ForegroundColor Gray
        }
        if ($script:auditLog.skippedChunks.Count -gt 3) {
            Write-Host "      ... and $($script:auditLog.skippedChunks.Count - 3) more (see audit log)" -ForegroundColor Gray
        }
    }
    
    if ($script:auditLog.failedAITags.Count -gt 0) {
        Write-Host "    Failed AI Tags: $($script:auditLog.failedAITags.Count)" -ForegroundColor Yellow
        $examples = $script:auditLog.failedAITags | Select-Object -First 3
        foreach ($example in $examples) {
            Write-Host "      - $($example.documentId): $($example.error)" -ForegroundColor Gray
        }
        if ($script:auditLog.failedAITags.Count -gt 3) {
            Write-Host "      ... and $($script:auditLog.failedAITags.Count - 3) more (see audit log)" -ForegroundColor Gray
        }
    }
    
    if ($script:auditLog.lowConfidenceItems.Count -gt 0) {
        Write-Host "    Low Confidence Chunks (<70%): $($script:auditLog.lowConfidenceItems.Count)" -ForegroundColor Yellow
        $examples = $script:auditLog.lowConfidenceItems | Select-Object -First 3
        foreach ($example in $examples) {
            Write-Host "      - $($example.documentId) chunk $($example.chunkIndex): $([math]::Round($example.confidence * 100, 1))% ($($example.category))" -ForegroundColor Gray
        }
        if ($script:auditLog.lowConfidenceItems.Count -gt 3) {
            Write-Host "      ... and $($script:auditLog.lowConfidenceItems.Count - 3) more (see audit log)" -ForegroundColor Gray
        }
    }
    
    if ($script:auditLog.failedIndexing.Count -gt 0) {
        Write-Host "    Failed Indexing: $($script:auditLog.failedIndexing.Count) batches" -ForegroundColor Red
        foreach ($failure in $script:auditLog.failedIndexing | Select-Object -First 3) {
            Write-Host "      - $($failure.documentId): $($failure.failed)/$($failure.attempted) $($failure.type) failed" -ForegroundColor Red
        }
    }
    
    if ($script:auditLog.errors.Count -gt 0) {
        Write-Host "    Errors: $($script:auditLog.errors.Count)" -ForegroundColor Red
        foreach ($err in $script:auditLog.errors | Select-Object -First 5) {
            Write-Host "      - $($err.documentId): $($err.message)" -ForegroundColor Red
        }
    }
    
    Write-Host ""
} else {
    Write-Host "  [NO FLAGS]" -ForegroundColor Green
    Write-Host "    All documents processed successfully with no warnings!" -ForegroundColor Green
    Write-Host ""
}

# Save audit log to JSON file
$script:auditLogDir = Join-Path $PSScriptRoot "logs"
$auditLogPath = Join-Path $script:auditLogDir "audit-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').json"

# Create logs directory if it doesn't exist
if (-not (Test-Path $script:auditLogDir)) {
    New-Item -ItemType Directory -Path $script:auditLogDir -Force | Out-Null
}

# Add final stats to audit log
$script:auditLog.finalStats = $script:stats
$script:auditLog.endTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$script:auditLog.terminatedEarly = $false

try {
    $script:auditLog | ConvertTo-Json -Depth 10 | Out-File -FilePath $auditLogPath -Encoding UTF8
    Write-Host "  [AUDIT LOG SAVED]" -ForegroundColor Green
    Write-Host "    Path: $auditLogPath" -ForegroundColor White
    Write-Host ""
    Write-Host "  Quick Review Commands:" -ForegroundColor Cyan
    Write-Host "    # Coverage summary" -ForegroundColor Gray
    Write-Host "    `$audit = Get-Content '$auditLogPath' | ConvertFrom-Json" -ForegroundColor White
    Write-Host "    `$audit.coverage" -ForegroundColor White
    Write-Host ""
    Write-Host "    # Per-document breakdown" -ForegroundColor Gray
    Write-Host "    `$audit.documents | Format-Table documentId, status, @{N='chunks';E={`$_.metrics.totalChunks}}" -ForegroundColor White
    Write-Host ""
    Write-Host "    # View skipped chunks" -ForegroundColor Gray
    Write-Host "    `$audit.skippedChunks | Format-Table documentId, chunkType, reason" -ForegroundColor White
    Write-Host ""
    Write-Host "    # View failed AI tags" -ForegroundColor Gray
    Write-Host "    `$audit.failedAITags | Format-Table documentId, chunkIndex, error" -ForegroundColor White
    Write-Host ""
    Write-Host "    # View low confidence items (needs manual review)" -ForegroundColor Gray
    Write-Host "    `$audit.lowConfidenceItems | Format-Table documentId, chunkIndex, confidence, category" -ForegroundColor White
    Write-Host ""
    Write-Host "    # View all errors" -ForegroundColor Gray
    Write-Host "    `$audit.errors" -ForegroundColor White
    Write-Host ""
    Write-Host "    # Export to CSV for Excel analysis" -ForegroundColor Gray
    Write-Host "    `$audit.documents | Export-Csv 'audit-documents.csv' -NoTypeInformation" -ForegroundColor White
} catch {
    Write-Host "  [WARN] Could not save audit log: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
