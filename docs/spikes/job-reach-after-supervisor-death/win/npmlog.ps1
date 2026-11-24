# ABOUTME: Card #1460 Windows check of the npm debug log the install wrote outside the spike directory: shows its first
# lines, then removes it and lists what remains in npm's default _logs directory.
$f = 'C:\Users\USER\AppData\Local\npm-cache\_logs\2026-11-22T03_01_26_210Z-debug-0.log'
Get-Content -TotalCount 14 -LiteralPath $f
"_logs entries before removal: {0}" -f @(Get-ChildItem 'C:\Users\USER\AppData\Local\npm-cache\_logs').Count
Remove-Item -LiteralPath $f
"removed; exists now: {0}" -f (Test-Path -LiteralPath $f)
"_logs entries after removal: {0}" -f @(Get-ChildItem 'C:\Users\USER\AppData\Local\npm-cache\_logs').Count
