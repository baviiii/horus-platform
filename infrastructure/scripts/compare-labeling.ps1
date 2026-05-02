# Compare Labeling Logic Between PDF Parser and Web Scraper
# Quick visual check to ensure core labeling rules are in sync

param(
    [Parameter(Mandatory=$false)]
    [switch]$Detailed = $false
)

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Labeling Consistency Check" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Comparing labeling logic between:" -ForegroundColor Yellow
Write-Host "  1. PDF Parser:  scripts/process-pdfs.ps1" -ForegroundColor White
Write-Host "  2. Web Scraper: web-scraper/enterprise-scraper/scraper.js" -ForegroundColor White
Write-Host ""

$scriptDir = Split-Path -Parent $PSScriptRoot
$pdfParser = Join-Path $PSScriptRoot "process-pdfs.ps1"
$webScraper = Join-Path $scriptDir "web-scraper\enterprise-scraper\scraper.js"

if (-not (Test-Path $pdfParser)) {
    Write-Host "[ERROR] PDF parser not found: $pdfParser" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $webScraper)) {
    Write-Host "[ERROR] Web scraper not found: $webScraper" -ForegroundColor Red
    exit 1
}

# Read files
$pdfContent = Get-Content $pdfParser -Raw
$webContent = Get-Content $webScraper -Raw

# Extract category keywords
function Extract-Keywords {
    param([string]$Content, [string]$Pattern)

    $matches = [regex]::Matches($Content, $Pattern)
    $keywords = @()
    foreach ($match in $matches) {
        if ($match.Groups.Count -gt 1) {
            $keywords += $match.Groups[1].Value
        }
    }
    return $keywords | Select-Object -Unique | Sort-Object
}

Write-Host "[1/4] Checking Categories..." -ForegroundColor Yellow

# PDF categories
$pdfCategories = @()
if ($pdfContent -match 'return "budget"') { $pdfCategories += "budget" }
if ($pdfContent -match 'return "strategy"') { $pdfCategories += "strategy" }
if ($pdfContent -match 'return "workforce"') { $pdfCategories += "workforce" }
if ($pdfContent -match 'return "education"') { $pdfCategories += "education" }
if ($pdfContent -match 'return "health"') { $pdfCategories += "health" }
if ($pdfContent -match 'return "career-guidance"') { $pdfCategories += "career-guidance" }
if ($pdfContent -match 'return "report"') { $pdfCategories += "report" }
if ($pdfContent -match 'return "policy"') { $pdfCategories += "policy" }
if ($pdfContent -match 'return "government-document"') { $pdfCategories += "government-document" }

# Web categories
$webCategories = @()
if ($webContent -match "return 'budget'") { $webCategories += "budget" }
if ($webContent -match "return 'strategy'") { $webCategories += "strategy" }
if ($webContent -match "return 'workforce'") { $webCategories += "workforce" }
if ($webContent -match "return 'education'") { $webCategories += "education" }
if ($webContent -match "return 'health'") { $webCategories += "health" }
if ($webContent -match "return 'career-guidance'") { $webCategories += "career-guidance" }
if ($webContent -match "return 'report'") { $webCategories += "report" }
if ($webContent -match "return 'policy'") { $webCategories += "policy" }
if ($webContent -match "return 'government-document'") { $webCategories += "government-document" }

$categoriesMatch = (Compare-Object $pdfCategories $webCategories).Count -eq 0

if ($categoriesMatch) {
    Write-Host "  ✓ Categories match ($($pdfCategories.Count) categories)" -ForegroundColor Green
} else {
    Write-Host "  ⚠ Categories differ!" -ForegroundColor Yellow
    Write-Host "    PDF only: $($pdfCategories | Where-Object { $_ -notin $webCategories })" -ForegroundColor Gray
    Write-Host "    Web only: $($webCategories | Where-Object { $_ -notin $pdfCategories })" -ForegroundColor Gray
}

if ($Detailed) {
    Write-Host "    All categories: $($pdfCategories -join ', ')" -ForegroundColor Gray
}
Write-Host ""

Write-Host "[2/4] Checking Sectors..." -ForegroundColor Yellow

# PDF sectors
$pdfSectors = @()
if ($pdfContent -match 'return "health".*sector') { $pdfSectors += "health" }
if ($pdfContent -match 'return "education".*sector') { $pdfSectors += "education" }
if ($pdfContent -match 'return "public-sector"') { $pdfSectors += "public-sector" }
if ($pdfContent -match 'return "construction"') { $pdfSectors += "construction" }
if ($pdfContent -match 'return "technology"') { $pdfSectors += "technology" }
if ($pdfContent -match 'return "agriculture"') { $pdfSectors += "agriculture" }
if ($pdfContent -match 'return "resources"') { $pdfSectors += "resources" }
if ($pdfContent -match 'return "services"') { $pdfSectors += "services" }
if ($pdfContent -match 'return "finance"') { $pdfSectors += "finance" }
if ($pdfContent -match 'return "defense"') { $pdfSectors += "defense" }
if ($pdfContent -match 'return "transport"') { $pdfSectors += "transport" }
if ($pdfContent -match 'return "community-services"') { $pdfSectors += "community-services" }
if ($pdfContent -match 'return "general".*sector') { $pdfSectors += "general" }

# Web sectors
$webSectors = @()
if ($webContent -match "return 'health'.*sector") { $webSectors += "health" }
if ($webContent -match "return 'education'.*sector") { $webSectors += "education" }
if ($webContent -match "return 'public-sector'") { $webSectors += "public-sector" }
if ($webContent -match "return 'construction'") { $webSectors += "construction" }
if ($webContent -match "return 'technology'") { $webSectors += "technology" }
if ($webContent -match "return 'agriculture'") { $webSectors += "agriculture" }
if ($webContent -match "return 'resources'") { $webSectors += "resources" }
if ($webContent -match "return 'services'") { $webSectors += "services" }
if ($webContent -match "return 'finance'") { $webSectors += "finance" }
if ($webContent -match "return 'defense'") { $webSectors += "defense" }
if ($webContent -match "return 'transport'") { $webSectors += "transport" }
if ($webContent -match "return 'community-services'") { $webSectors += "community-services" }
if ($webContent -match "return 'general'.*sector") { $webSectors += "general" }

$sectorsMatch = (Compare-Object $pdfSectors $webSectors).Count -eq 0

if ($sectorsMatch) {
    Write-Host "  ✓ Sectors match ($($pdfSectors.Count) sectors)" -ForegroundColor Green
} else {
    Write-Host "  ⚠ Sectors differ!" -ForegroundColor Yellow
    Write-Host "    PDF only: $($pdfSectors | Where-Object { $_ -notin $webSectors })" -ForegroundColor Gray
    Write-Host "    Web only: $($webSectors | Where-Object { $_ -notin $pdfSectors })" -ForegroundColor Gray
}

if ($Detailed) {
    Write-Host "    All sectors: $($pdfSectors -join ', ')" -ForegroundColor Gray
}
Write-Host ""

Write-Host "[3/4] Checking Common Tags..." -ForegroundColor Yellow

# Common tags (appearing in both)
$commonTags = @(
    "education", "health", "employment", "budget", "training",
    "job-application", "migration", "regional", "disability-inclusion",
    "indigenous", "youth"
)

$pdfHasTags = @()
$webHasTags = @()

foreach ($tag in $commonTags) {
    if ($pdfContent -match "`"$tag`"" -or $pdfContent -match "'$tag'") {
        $pdfHasTags += $tag
    }
    if ($webContent -match "`"$tag`"" -or $webContent -match "'$tag'") {
        $webHasTags += $tag
    }
}

$tagsMatch = (Compare-Object $pdfHasTags $webHasTags).Count -eq 0

if ($tagsMatch) {
    Write-Host "  ✓ Common tags present in both ($($commonTags.Count) tags)" -ForegroundColor Green
} else {
    Write-Host "  ⚠ Tag differences found!" -ForegroundColor Yellow
    $missingPdf = $commonTags | Where-Object { $_ -notin $pdfHasTags }
    $missingWeb = $commonTags | Where-Object { $_ -notin $webHasTags }

    if ($missingPdf) {
        Write-Host "    Missing in PDF: $($missingPdf -join ', ')" -ForegroundColor Gray
    }
    if ($missingWeb) {
        Write-Host "    Missing in Web: $($missingWeb -join ', ')" -ForegroundColor Gray
    }
}

if ($Detailed) {
    Write-Host "    Checked tags: $($commonTags -join ', ')" -ForegroundColor Gray
}
Write-Host ""

Write-Host "[4/4] Checking Chunking Parameters..." -ForegroundColor Yellow

$pdfChunkSize = if ($pdfContent -match 'ChunkSize\s*=\s*(\d+)') { $matches[1] } else { "not found" }
$pdfOverlap = if ($pdfContent -match 'Overlap\s*=\s*(\d+)') { $matches[1] } else { "not found" }

$webChunkSize = if ($webContent -match 'chunkSize\s*=\s*(\d+)') { $matches[1] } else { "not found" }
$webOverlap = if ($webContent -match 'overlap\s*=\s*(\d+)') { $matches[1] } else { "not found" }

if ($pdfChunkSize -eq $webChunkSize -and $pdfOverlap -eq $webOverlap) {
    Write-Host "  ✓ Chunking parameters match" -ForegroundColor Green
    Write-Host "    Chunk Size: $pdfChunkSize, Overlap: $pdfOverlap" -ForegroundColor Gray
} else {
    Write-Host "  ⚠ Chunking parameters differ!" -ForegroundColor Yellow
    Write-Host "    PDF: ChunkSize=$pdfChunkSize, Overlap=$pdfOverlap" -ForegroundColor Gray
    Write-Host "    Web: ChunkSize=$webChunkSize, Overlap=$webOverlap" -ForegroundColor Gray
}
Write-Host ""

# Summary
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$allMatch = $categoriesMatch -and $sectorsMatch -and $tagsMatch -and ($pdfChunkSize -eq $webChunkSize)

if ($allMatch) {
    Write-Host "✓ Core labeling logic is synchronized!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Both sources use consistent:" -ForegroundColor White
    Write-Host "  - Categories ($($pdfCategories.Count))" -ForegroundColor Gray
    Write-Host "  - Sectors ($($pdfSectors.Count))" -ForegroundColor Gray
    Write-Host "  - Tags ($($commonTags.Count))" -ForegroundColor Gray
    Write-Host "  - Chunking (size: $pdfChunkSize, overlap: $pdfOverlap)" -ForegroundColor Gray
} else {
    Write-Host "⚠ Some differences detected" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "This may be intentional (source-specific customizations)." -ForegroundColor White
    Write-Host "Review differences above and update if needed." -ForegroundColor White
    Write-Host ""
    Write-Host "See docs/LABELING-RULES.md for guidance." -ForegroundColor Cyan
}

Write-Host ""
Write-Host "NOTES:" -ForegroundColor Cyan
Write-Host "  - Web scraper can have additional logic (URL hints, strategy)" -ForegroundColor Gray
Write-Host "  - Source-specific customizations are OK and expected" -ForegroundColor Gray
Write-Host "  - Document intentional differences in docs/LABELING-RULES.md" -ForegroundColor Gray
Write-Host ""
Write-Host "For detailed comparison, run: .\compare-labeling.ps1 -Detailed" -ForegroundColor Yellow
Write-Host ""
