# Deploy Neo4j Enterprise on Azure VM
# This creates a VM with Neo4j Enterprise, APOC, and Graph Data Science plugins

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$Environment = "dev",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "australiaeast",
    
    [Parameter(Mandatory=$true)]
    [SecureString]$AdminPassword
)

Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "  DEPLOYING NEO4J COMMUNITY ON AZURE VM" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host ""
Write-Host "Resource Group: $ResourceGroupName" -ForegroundColor Yellow
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host "Location: $Location" -ForegroundColor Yellow
Write-Host ""

# Check if Azure CLI is installed
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Azure CLI is not installed." -ForegroundColor Red
    exit 1
}

# Login check
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "Not logged in to Azure. Logging in..." -ForegroundColor Yellow
    az login
}

Write-Host "Deploying Neo4j VM infrastructure..." -ForegroundColor Cyan
Write-Host "This will take 10-15 minutes (VM creation + Neo4j installation)..." -ForegroundColor Yellow
Write-Host ""

$deployment = az deployment group create `
    --resource-group $ResourceGroupName `
    --template-file "$PSScriptRoot/neo4j-vm.bicep" `
    --parameters "environment=$Environment" "location=$Location" `
    --parameters adminPassword=$AdminPassword `
    --query "properties.outputs" `
    --output json

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Deployment failed!" -ForegroundColor Red
    exit 1
}

$outputs = $deployment | ConvertFrom-Json

Write-Host ""
Write-Host "=" * 80 -ForegroundColor Green
Write-Host "  NEO4J DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "=" * 80 -ForegroundColor Green
Write-Host ""
Write-Host "VM Details:" -ForegroundColor Cyan
Write-Host "  VM Name: $($outputs.vmName.value)" -ForegroundColor White
Write-Host "  Public IP: $($outputs.publicIP.value)" -ForegroundColor White
Write-Host "  FQDN: $($outputs.fqdn.value)" -ForegroundColor White
Write-Host ""
Write-Host "Neo4j Access:" -ForegroundColor Cyan
Write-Host "  Browser: $($outputs.neo4jBrowserUrl.value)" -ForegroundColor White
Write-Host "  Bolt URL: $($outputs.neo4jBoltUrl.value)" -ForegroundColor White
Write-Host "  Username: neo4j" -ForegroundColor White
Write-Host "  Password: ChangeMe123! (CHANGE THIS IMMEDIATELY!)" -ForegroundColor Yellow
Write-Host ""
Write-Host "SSH Access:" -ForegroundColor Cyan
Write-Host "  $($outputs.sshCommand.value)" -ForegroundColor White
Write-Host ""
Write-Host "Add these to your .env file:" -ForegroundColor Cyan
Write-Host "NEO4J_URI=$($outputs.neo4jBoltUrl.value)" -ForegroundColor White
Write-Host "NEO4J_USERNAME=neo4j" -ForegroundColor White
Write-Host "NEO4J_PASSWORD=ChangeMe123!" -ForegroundColor White
Write-Host ""
Write-Host "IMPORTANT NEXT STEPS:" -ForegroundColor Yellow
Write-Host "1. Wait 2-3 minutes for Neo4j to fully start" -ForegroundColor White
Write-Host "2. Open Neo4j Browser and change the default password" -ForegroundColor White
Write-Host "3. Update Azure Function environment variables with Neo4j connection" -ForegroundColor White
Write-Host "4. Test connection: cypher-shell -a $($outputs.neo4jBoltUrl.value) -u neo4j -p ChangeMe123!" -ForegroundColor White
Write-Host ""

# Save connection details
$envContent = @"
NEO4J_URI=$($outputs.neo4jBoltUrl.value)
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=ChangeMe123!
NEO4J_DATABASE=neo4j
"@

$envFile = Join-Path $PSScriptRoot ".neo4j-env"
$envContent | Out-File -FilePath $envFile -Encoding UTF8
Write-Host "Connection details saved to: $envFile" -ForegroundColor Green
Write-Host ""
