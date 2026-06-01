# Master script to run enterprise scraper end-to-end
# Scrapes websites using Playwright, then uploads to Azure AI Search

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [switch]$JobsOnly,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkillsOnly,
    
    [Parameter(Mandatory=$false)]
    [switch]$NewsOnly
)

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Enterprise Web Scraper - Complete Run" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "[ERROR] Node.js not found!" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green
Write-Host ""

# Check if dependencies are installed
if (-not (Test-Path "node_modules")) {
    Write-Host "[WARN] Dependencies not installed. Installing..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}

# Check if Playwright browsers are installed
if (-not (Test-Path "$env:LOCALAPPDATA\ms-playwright")) {
    Write-Host "[WARN] Playwright browsers not installed. Installing..." -ForegroundColor Yellow
    npm run install-browsers
    Write-Host ""
}

# Build arguments
$scraperArgs = @("--resourceGroup=$ResourceGroupName")
if ($JobsOnly) { $scraperArgs += "--jobsOnly" }
if ($SkillsOnly) { $scraperArgs += "--skillsOnly" }
if ($NewsOnly) { $scraperArgs += "--newsOnly" }

# Step 1: Scrape
Write-Host "[STEP 1/2] Scraping websites with Playwright..." -ForegroundColor Yellow
Write-Host ""
node --max-old-space-size=6144 scraper.js $scraperArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Scraping failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[STEP 2/2] Uploading to Azure AI Search..." -ForegroundColor Yellow
Write-Host ""

# Step 2: Upload
& "$PSScriptRoot\upload-to-azure.ps1" -ResourceGroupName $ResourceGroupName

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Complete!" -ForegroundColor Green
Write-Host "════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "Your scraped content is now in Azure AI Search with embeddings!" -ForegroundColor Cyan
Write-Host ""

