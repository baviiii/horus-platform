$ErrorActionPreference = 'Stop'

Write-Host "Testing if process-pdfs.ps1 can be loaded..." -ForegroundColor Cyan

try {
    # Try to get the command
    $cmd = Get-Command ".\process-pdfs.ps1" -ErrorAction Stop
    Write-Host "[SUCCESS] Script parsed successfully!" -ForegroundColor Green
    Write-Host "Command Type: $($cmd.CommandType)" -ForegroundColor White
    Write-Host "Script Path: $($cmd.Path)" -ForegroundColor White
    exit 0
} catch {
    Write-Host "[FAIL] Script has parse errors:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    exit 1
}
