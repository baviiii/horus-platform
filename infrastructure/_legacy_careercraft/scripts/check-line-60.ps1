$line = (Get-Content "C:\Users\asees\Downloads\free-lance work\careercraft-pages\infrastructure\scripts\process-pdfs.ps1")[59]
Write-Host "Line 60 content: $line"
$openBraces = ([regex]::Matches($line, '\{')).Count
$closeBraces = ([regex]::Matches($line, '\}')).Count
Write-Host "Opening braces: $openBraces"
Write-Host "Closing braces: $closeBraces"
Write-Host "Net: $($openBraces - $closeBraces)"

# Check lines 58-65 for context
Write-Host ""
Write-Host "Context (lines 58-65):"
for ($i = 57; $i -le 64; $i++) {
    $contextLine = (Get-Content "C:\Users\asees\Downloads\free-lance work\careercraft-pages\infrastructure\scripts\process-pdfs.ps1")[$i]
    $lineNum = $i + 1
    $opens = ([regex]::Matches($contextLine, '\{')).Count
    $closes = ([regex]::Matches($contextLine, '\}')).Count
    Write-Host "  Line $lineNum (+ $opens - $closes): $contextLine"
}
