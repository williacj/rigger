# ABOUTME: Card #1460 Windows check for writes outside the spike's directory: lists files changed since the spike began
# (2026-11-22T02:57Z) in npm's default cache, config and log locations, and the user's .npmrc.
$since = [DateTime]::Parse('2026-11-22T23:32:00Z').ToUniversalTime()
$paths = @("$env:LOCALAPPDATA\npm-cache", "$env:APPDATA\npm", "$env:APPDATA\npm-cache", "$env:USERPROFILE\.npmrc", "$env:USERPROFILE\.node_repl_history", "$env:LOCALAPPDATA\Temp")
foreach ($p in $paths) {
  if (-not (Test-Path $p)) { "{0}: does not exist" -f $p; continue }
  $hits = @(Get-ChildItem -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTimeUtc -ge $since })
  "{0}: {1} entries written since {2:o}" -f $p, $hits.Count, $since
  $hits | Select-Object -First 40 | ForEach-Object { "  {0:o} {1}" -f $_.LastWriteTimeUtc, $_.FullName }
}
