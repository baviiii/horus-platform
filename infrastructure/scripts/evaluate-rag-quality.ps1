# ============================================================
# RAG Quality Evaluation & Retrieval Inspection
# ============================================================
# Tests retrieval quality with evaluation queries and inspects results
#
# Usage:
#   .\evaluate-rag-quality.ps1 -ResourceGroupName "rg-careercraft-dev"
#   .\evaluate-rag-quality.ps1 -ResourceGroupName "rg-careercraft-dev" -Detailed
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [switch]$Detailed = $false
)

# ============================================================
# CONFIGURATION
# ============================================================

$SearchServiceName = az resource list --resource-group $ResourceGroupName --query "[?type=='Microsoft.Search/searchServices'].name" --output tsv 2>$null | Select-Object -First 1
$SearchIndexName = "careercraft-index"

if (-not $SearchServiceName) {
    Write-Host "[ERROR] Search service not found in resource group: $ResourceGroupName" -ForegroundColor Red
    exit 1
}

$searchKey = az search admin-key show --resource-group $ResourceGroupName --service-name $SearchServiceName --query "primaryKey" --output tsv 2>$null
$searchEndpoint = "https://$SearchServiceName.search.windows.net"

if (-not $searchKey) {
    Write-Host "[ERROR] Could not retrieve search service key" -ForegroundColor Red
    exit 1
}

# ============================================================
# EVALUATION QUERIES (Known good questions)
# ============================================================

$evaluationQueries = @(
    @{
        query = "What are the top growth sectors in South Australia?"
        category = "sector-analysis"
        expectedSectors = @("health", "technology", "construction", "education")
        expectedDocTypes = @("pdf")
    },
    @{
        query = "What skills are in demand for healthcare jobs?"
        category = "skills-demand"
        expectedSectors = @("health")
        expectedDocTypes = @("pdf", "web")
    },
    @{
        query = "What funding programs are available for career development?"
        category = "funding"
        expectedTags = @("funding", "programs", "career-development")
        expectedDocTypes = @("pdf")
    },
    @{
        query = "What are the employment growth trends since 2020?"
        category = "trend-analysis"
        expectedChunkTypes = @("table_row")
        timeRange = @{startYear = 2020; endYear = (Get-Date).Year}
    },
    @{
        query = "What migration pathways exist for skilled workers?"
        category = "migration"
        expectedTags = @("migration", "skilled-workers", "visa")
        expectedDocTypes = @("pdf")
    },
    @{
        query = "What are the requirements for public sector jobs?"
        category = "job-requirements"
        expectedSectors = @("public-sector")
        expectedDocTypes = @("pdf", "web")
    },
    @{
        query = "What training programs are available for technology careers?"
        category = "training"
        expectedSectors = @("technology", "education")
        expectedTags = @("training", "programs")
    },
    @{
        query = "What is the budget allocation for skills development?"
        category = "budget-analysis"
        expectedTags = @("budget", "funding")
        expectedChunkTypes = @("table_row")
    }
)

# ============================================================
# HELPER FUNCTIONS
# ============================================================

function Search-AzureIndex {
    param(
        [string]$Query,
        [string]$SearchEndpoint,
        [string]$SearchKey,
        [string]$IndexName,
        [int]$Top = 10,
        [hashtable]$Filters = @{}
    )
    
    $headers = @{
        "Content-Type" = "application/json"
        "api-key" = $SearchKey
    }
    
    # Build filter string
    $filterString = ""
    if ($Filters.Count -gt 0) {
        $filterParts = @()
        foreach ($key in $Filters.Keys) {
            if ($Filters[$key] -is [array]) {
                $values = ($Filters[$key] | ForEach-Object { "'$_'" }) -join ","
                $filterParts += "$key/any(t: t in ($values))"
            } else {
                $filterParts += "$key eq '$($Filters[$key])'"
            }
        }
        $filterString = $filterParts -join " and "
    }
    
    $searchUrl = "$SearchEndpoint/indexes/$IndexName/docs/search?api-version=2023-11-01"
    
    $searchBody = @{
        search = $Query
        top = $Top
        includeTotalCount = $true
        highlight = "content"
        highlightPreTag = "<mark>"
        highlightPostTag = "</mark>"
    } | ConvertTo-Json
    
    if ($filterString) {
        $searchBodyObj = $searchBody | ConvertFrom-Json
        $searchBodyObj | Add-Member -NotePropertyName "filter" -NotePropertyValue $filterString -Force
        $searchBody = $searchBodyObj | ConvertTo-Json
    }
    
    try {
        $response = Invoke-RestMethod -Uri $searchUrl -Method Post -Headers $headers -Body $searchBody
        return $response
    }
    catch {
        Write-Host "      [ERROR] Search failed: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

function Evaluate-Retrieval {
    param(
        [hashtable]$EvaluationQuery,
        [object]$SearchResults
    )
    
    $evaluation = @{
        query = $EvaluationQuery.query
        category = $EvaluationQuery.category
        totalResults = if ($SearchResults.'@odata.count') { $SearchResults.'@odata.count' } else { 0 }
        retrievedDocs = $SearchResults.value.Count
        score = 0
        maxScore = 10
        metrics = @{}
        issues = @()
        retrievedDocuments = @()
    }
    
    if ($SearchResults.value.Count -eq 0) {
        $evaluation.issues += "No documents retrieved"
        $evaluation.metrics["retrievalSuccess"] = $false
        return $evaluation
    }
    
    $evaluation.metrics["retrievalSuccess"] = $true
    
    # Check relevance scores
    $avgScore = ($SearchResults.value | Measure-Object -Property '@search.score' -Average).Average
    $maxScore = ($SearchResults.value | Measure-Object -Property '@search.score' -Maximum).Maximum
    $minScore = ($SearchResults.value | Measure-Object -Property '@search.score' -Minimum).Minimum
    
    $evaluation.metrics["avgRelevanceScore"] = [math]::Round($avgScore, 3)
    $evaluation.metrics["maxRelevanceScore"] = [math]::Round($maxScore, 3)
    $evaluation.metrics["minRelevanceScore"] = [math]::Round($minScore, 3)
    
    # Check expected sectors
    if ($EvaluationQuery.expectedSectors) {
        $retrievedSectors = $SearchResults.value | Where-Object { $_.sector -in $EvaluationQuery.expectedSectors } | Measure-Object
        $sectorMatchRate = [math]::Round(($retrievedSectors.Count / $SearchResults.value.Count) * 100, 1)
        $evaluation.metrics["sectorMatchRate"] = "$sectorMatchRate%"
        
        if ($sectorMatchRate -lt 50) {
            $evaluation.issues += "Low sector match rate: $sectorMatchRate% (expected: 50%+)"
        }
    }
    
    # Check expected tags
    if ($EvaluationQuery.expectedTags) {
        $matchedDocs = 0
        foreach ($doc in $SearchResults.value) {
            if ($doc.tags) {
                $docTags = if ($doc.tags -is [array]) { $doc.tags } else { @($doc.tags) }
                $hasExpectedTag = $false
                foreach ($expectedTag in $EvaluationQuery.expectedTags) {
                    if ($docTags -contains $expectedTag) {
                        $hasExpectedTag = $true
                        break
                    }
                }
                if ($hasExpectedTag) { $matchedDocs++ }
            }
        }
        $tagMatchRate = [math]::Round(($matchedDocs / $SearchResults.value.Count) * 100, 1)
        $evaluation.metrics["tagMatchRate"] = "$tagMatchRate%"
        
        if ($tagMatchRate -lt 50) {
            $evaluation.issues += "Low tag match rate: $tagMatchRate% (expected: 50%+)"
        }
    }
    
    # Check chunk types
    if ($EvaluationQuery.expectedChunkTypes) {
        $matchedChunkTypes = $SearchResults.value | Where-Object { $_.chunkType -in $EvaluationQuery.expectedChunkTypes } | Measure-Object
        $chunkTypeMatchRate = [math]::Round(($matchedChunkTypes.Count / $SearchResults.value.Count) * 100, 1)
        $evaluation.metrics["chunkTypeMatchRate"] = "$chunkTypeMatchRate%"
    }
    
    # Check document types
    if ($EvaluationQuery.expectedDocTypes) {
        $matchedDocTypes = $SearchResults.value | Where-Object { $_.documentType -in $EvaluationQuery.expectedDocTypes } | Measure-Object
        $docTypeMatchRate = [math]::Round(($matchedDocTypes.Count / $SearchResults.value.Count) * 100, 1)
        $evaluation.metrics["docTypeMatchRate"] = "$docTypeMatchRate%"
    }
    
    # Check embedding coverage
    $docsWithEmbeddings = $SearchResults.value | Where-Object { $_.contentVector -ne $null } | Measure-Object
    $embeddingCoverage = [math]::Round(($docsWithEmbeddings.Count / $SearchResults.value.Count) * 100, 1)
    $evaluation.metrics["embeddingCoverage"] = "$embeddingCoverage%"
    
    if ($embeddingCoverage -lt 95) {
        $evaluation.issues += "Low embedding coverage: $embeddingCoverage% (target: 95%+)"
    }
    
    # Check confidence scores (if available)
    $docsWithConfidence = $SearchResults.value | Where-Object { $_.confidence -ne $null } | Measure-Object
    if ($docsWithConfidence.Count -gt 0) {
        $avgConfidence = ($SearchResults.value | Where-Object { $_.confidence -ne $null } | Measure-Object -Property confidence -Average).Average
        $evaluation.metrics["avgConfidence"] = [math]::Round($avgConfidence * 100, 1)
        
        $lowConfidenceDocs = $SearchResults.value | Where-Object { $_.confidence -ne $null -and $_.confidence -lt 0.7 } | Measure-Object
        if ($lowConfidenceDocs.Count -gt 0) {
            $evaluation.issues += "$($lowConfidenceDocs.Count) documents with low confidence (<70%)"
        }
    }
    
    # Collect retrieved document info
    foreach ($doc in $SearchResults.value) {
        $evaluation.retrievedDocuments += @{
            id = $doc.id
            score = $doc.'@search.score'
            title = $doc.title
            sector = $doc.sector
            category = $doc.category
            chunkType = $doc.chunkType
            confidence = $doc.confidence
            hasEmbedding = ($doc.contentVector -ne $null)
            url = $doc.url
        }
    }
    
    # Calculate overall score (0-10)
    $score = 0
    if ($evaluation.metrics.retrievalSuccess) { $score += 2 }
    if ($evaluation.metrics.avgRelevanceScore -gt 1.0) { $score += 2 }
    if ($evaluation.metrics.embeddingCoverage -ge 95) { $score += 2 }
    if ($evaluation.issues.Count -eq 0) { $score += 4 } elseif ($evaluation.issues.Count -le 1) { $score += 2 }
    
    $evaluation.score = $score
    
    return $evaluation
}

# ============================================================
# MAIN EVALUATION
# ============================================================

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RAG QUALITY EVALUATION" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Search Service: $SearchServiceName" -ForegroundColor White
Write-Host "Index:          $SearchIndexName" -ForegroundColor White
Write-Host "Evaluation Queries: $($evaluationQueries.Count)" -ForegroundColor White
Write-Host ""

$results = @()
$totalScore = 0
$maxTotalScore = 0

foreach ($evalQuery in $evaluationQueries) {
    Write-Host "[TEST] $($evalQuery.query)" -ForegroundColor Yellow
    
    $searchResults = Search-AzureIndex -Query $evalQuery.query -SearchEndpoint $searchEndpoint -SearchKey $searchKey -IndexName $SearchIndexName -Top 10
    
    if ($searchResults) {
        $evaluation = Evaluate-Retrieval -EvaluationQuery $evalQuery -SearchResults $searchResults
        
        Write-Host "  Results: $($evaluation.totalResults) total, $($evaluation.retrievedDocs) retrieved" -ForegroundColor Gray
        Write-Host "  Score: $($evaluation.score)/$($evaluation.maxScore)" -ForegroundColor $(if ($evaluation.score -ge 8) { "Green" } elseif ($evaluation.score -ge 6) { "Yellow" } else { "Red" })
        
        if ($Detailed) {
            Write-Host "  Metrics:" -ForegroundColor Cyan
            foreach ($metric in $evaluation.metrics.GetEnumerator()) {
                Write-Host "    $($metric.Key): $($metric.Value)" -ForegroundColor White
            }
            
            if ($evaluation.issues.Count -gt 0) {
                Write-Host "  Issues:" -ForegroundColor Yellow
                foreach ($issue in $evaluation.issues) {
                    Write-Host "    - $issue" -ForegroundColor Yellow
                }
            }
            
            Write-Host "  Top 3 Retrieved:" -ForegroundColor Cyan
            $topDocs = $evaluation.retrievedDocuments | Select-Object -First 3
            foreach ($doc in $topDocs) {
                Write-Host "    [$($doc.score)] $($doc.title) ($($doc.sector))" -ForegroundColor White
            }
        }
        
        $results += $evaluation
        $totalScore += $evaluation.score
        $maxTotalScore += $evaluation.maxScore
    } else {
        Write-Host "  [FAILED] Search request failed" -ForegroundColor Red
    }
    
    Write-Host ""
    Start-Sleep -Milliseconds 200  # Rate limiting
}

# ============================================================
# SUMMARY
# ============================================================

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  EVALUATION SUMMARY" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$overallScore = [math]::Round(($totalScore / $maxTotalScore) * 100, 1)
Write-Host "Overall Score: $overallScore% ($totalScore/$maxTotalScore)" -ForegroundColor $(if ($overallScore -ge 90) { "Green" } elseif ($overallScore -ge 75) { "Yellow" } else { "Red" })
Write-Host ""

# Aggregate metrics
$totalDocsRetrieved = ($results | Measure-Object -Property retrievedDocs -Sum).Sum
$avgRelevanceScore = ($results | ForEach-Object { $_.metrics.avgRelevanceScore } | Where-Object { $_ -ne $null } | Measure-Object -Average).Average
$avgEmbeddingCoverage = ($results | ForEach-Object { 
    $coverageStr = $_.metrics.embeddingCoverage
    if ($coverageStr) {
        [double]($coverageStr -replace '%', '')
    }
} | Where-Object { $_ -ne $null } | Measure-Object -Average).Average

Write-Host "Aggregate Metrics:" -ForegroundColor Cyan
Write-Host "  Total Documents Retrieved: $totalDocsRetrieved" -ForegroundColor White
Write-Host "  Avg Relevance Score: $(if ($avgRelevanceScore) { [math]::Round($avgRelevanceScore, 3) } else { 'N/A' })" -ForegroundColor White
Write-Host "  Avg Embedding Coverage: $(if ($avgEmbeddingCoverage) { "$([math]::Round($avgEmbeddingCoverage, 1))%" } else { 'N/A' })" -ForegroundColor White
Write-Host ""

# Issue summary
$allIssues = $results | ForEach-Object { $_.issues } | Where-Object { $_ -ne $null }
if ($allIssues.Count -gt 0) {
    Write-Host "Issues Found:" -ForegroundColor Yellow
    $allIssues | Group-Object | Sort-Object Count -Descending | ForEach-Object {
        Write-Host "  - $($_.Name) ($($_.Count) times)" -ForegroundColor Yellow
    }
    Write-Host ""
}

# Recommendations
Write-Host "Recommendations:" -ForegroundColor Cyan
if ($overallScore -lt 90) {
    Write-Host "  - Overall score below 90% - investigate retrieval quality" -ForegroundColor Yellow
}
if ($avgEmbeddingCoverage -lt 95) {
    Write-Host "  - Embedding coverage below 95% - reprocess documents" -ForegroundColor Yellow
}
if ($avgRelevanceScore -lt 1.5) {
    Write-Host "  - Average relevance score low - check query formulation" -ForegroundColor Yellow
}
if ($allIssues.Count -gt $results.Count / 2) {
    Write-Host "  - High number of issues - review index quality and metadata" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan

