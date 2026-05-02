$content = Get-Content "C:\Users\asees\Downloads\free-lance work\careercraft-pages\infrastructure\scripts\process-pdfs.ps1" -Raw
$opens = ([regex]::Matches($content, '\{')).Count
$closes = ([regex]::Matches($content, '\}')).Count
Write-Host "Total opening braces: $opens"
Write-Host "Total closing braces: $closes"
Write-Host "Difference (should be 0): $($opens - $closes)"

if ($opens -ne $closes) {
    Write-Host ""
    Write-Host "PROBLEM: File has $($opens - $closes) more opening brace(s) than closing brace(s)" -ForegroundColor Red
}
