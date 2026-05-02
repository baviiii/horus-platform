$content = Get-Content "C:\Users\asees\Downloads\free-lance work\careercraft-pages\infrastructure\scripts\process-pdfs.ps1"
$lineNum = 0

Write-Host "All try/catch/finally statements:" -ForegroundColor Cyan
Write-Host ""

foreach ($line in $content) {
    $lineNum++
    if ($line -match '^\s*try\s*\{' -or $line -match '\}\s*catch\s*\{' -or $line -match '^\s*catch\s*\{' -or $line -match '\}\s*finally\s*\{' -or $line -match '^\s*finally\s*\{') {
        Write-Host "Line $lineNum : $line"
    }
}
