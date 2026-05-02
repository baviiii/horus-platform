$filePath = "C:\Users\asees\Downloads\free-lance work\careercraft-pages\infrastructure\scripts\process-pdfs.ps1"
$content = Get-Content $filePath

$stack = @()  # Stack to track opening braces with line numbers
$lineNum = 0

foreach ($line in $content) {
    $lineNum++

    # Count opening and closing braces on this line
    $openCount = ([regex]::Matches($line, '\{') | Where-Object { $_.Value -eq '{' }).Count
    $closeCount = ([regex]::Matches($line, '\}') | Where-Object { $_.Value -eq '}' }).Count

    # Push opening braces onto stack
    for ($i = 0; $i -lt $openCount; $i++) {
        $stack += @{ Line = $lineNum; Content = $line.Trim() }
    }

    # Pop closing braces from stack
    for ($i = 0; $i -lt $closeCount; $i++) {
        if ($stack.Count -gt 0) {
            if ($stack.Count -eq 1) {
                $stack = @()
            } else {
                $stack = $stack[0..($stack.Count - 2)]
            }
        } else {
            Write-Host "Line $lineNum ERROR: Closing brace without matching opening brace" -ForegroundColor Red
            Write-Host "  $line" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "Analysis complete:" -ForegroundColor Cyan
Write-Host "Unclosed opening braces: $($stack.Count)" -ForegroundColor $(if ($stack.Count -eq 0) { "Green" } else { "Red" })

if ($stack.Count -gt 0) {
    Write-Host ""
    Write-Host "All unclosed braces:" -ForegroundColor Yellow
    foreach ($item in $stack) {
        Write-Host "  Line $($item.Line): $($item.Content)" -ForegroundColor White
    }
}
