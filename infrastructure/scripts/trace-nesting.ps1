# Trace nesting depth through the file to find where it goes wrong
$content = Get-Content "C:\Users\asees\Downloads\free-lance work\careercraft-pages\infrastructure\scripts\process-pdfs.ps1"
$lineNum = 0
$depth = 0
$maxDepth = 0
$depthChanges = @()

foreach ($line in $content) {
    $lineNum++

    $opens = ([regex]::Matches($line, '\{')).Count
    $closes = ([regex]::Matches($line, '\}')).Count
    $netChange = $opens - $closes

    if ($netChange -ne 0) {
        $depthChanges += @{
            Line = $lineNum
            Before = $depth
            Opens = $opens
            Closes = $closes
            After = $depth + $netChange
            Content = $line.Trim()
        }
    }

    $depth += $netChange
    if ($depth -gt $maxDepth) { $maxDepth = $depth }

    # Flag suspicious lines around the reported errors
    if ($lineNum -in @(1613, 1665, 2787, 3106, 3140) -or $depth -lt 0) {
        Write-Host "Line $lineNum (depth=$depth, +$opens -$closes): $($line.Trim())" -ForegroundColor $(if ($depth -lt 0) { "Red" } else { "Yellow" })
    }
}

Write-Host ""
Write-Host "Final depth: $depth (should be 0)" -ForegroundColor $(if ($depth -eq 0) { "Green" } else { "Red" })
Write-Host "Max depth reached: $maxDepth"

if ($depth -ne 0) {
    Write-Host ""
    Write-Host "Last 20 depth changes:" -ForegroundColor Yellow
    foreach ($change in $depthChanges[-20..-1]) {
        if ($change) {
            $color = if ($change.After -lt $change.Before) { "Red" } else { "Cyan" }
            Write-Host "  Line $($change.Line): $($change.Before) -> $($change.After) (+$($change.Opens) -$($change.Closes))" -ForegroundColor $color
            Write-Host "    $($change.Content)" -ForegroundColor Gray
        }
    }
}
