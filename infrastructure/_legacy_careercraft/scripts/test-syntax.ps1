$errors = @()
$tokens = @()
$filePath = "C:\Users\asees\Downloads\free-lance work\careercraft-pages\infrastructure\scripts\process-pdfs.ps1"

$ast = [System.Management.Automation.Language.Parser]::ParseFile($filePath, [ref]$tokens, [ref]$errors)

if ($errors.Count -gt 0) {
    Write-Host "Errors found: $($errors.Count)" -ForegroundColor Red
    foreach ($err in $errors) {
        Write-Host "Line $($err.Extent.StartLineNumber): $($err.Message)" -ForegroundColor Yellow
    }
    exit 1
} else {
    Write-Host "No syntax errors found!" -ForegroundColor Green
    exit 0
}
