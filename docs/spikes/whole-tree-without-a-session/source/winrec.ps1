# ABOUTME: Card #1459 Windows process record, run through WSL interop: this connection's chain from its per-connection sshd down, and any WSL VM process started since that sshd.
$tag = '__TAG__'; $label = '__LABEL__'
$all = @(Get-CimInstance Win32_Process)
$now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$by = @{}; foreach ($p in $all) { $by[[int]$p.ProcessId] = $p }
$w = $all | Where-Object { $_.Name -eq 'wsl.exe' -and $_.CommandLine -like "*$tag*" } | Sort-Object CreationDate | Select-Object -First 1
if (-not $w) { "REC-WIN-NONE no wsl.exe carrying $tag"; exit }
$root = $w
while ($by.ContainsKey([int]$root.ParentProcessId)) { $par = $by[[int]$root.ParentProcessId]; if ($par.CreationDate -gt $root.CreationDate) { break }; $root = $par; if ($root.Name -eq 'sshd.exe' -and $root.CommandLine -like '* -R*') { break } }
$set = @{}; $queue = New-Object System.Collections.Queue
$queue.Enqueue($root)
foreach ($p in $all) { if ($p.Name -match '^(vmwp\.exe|vmmemWSL|wslrelay\.exe|wslhost\.exe)$' -and $p.CreationDate -ge $root.CreationDate) { $queue.Enqueue($p) } }
while ($queue.Count) { $p = $queue.Dequeue(); if ($set.ContainsKey([int]$p.ProcessId)) { continue }; $set[[int]$p.ProcessId] = $p
  foreach ($c in $all) { if ([int]$c.ParentProcessId -eq [int]$p.ProcessId -and $c.CreationDate -ge $p.CreationDate) { $queue.Enqueue($c) } } }
foreach ($p in ($set.Values | Sort-Object CreationDate)) {
  $cl = ($p.CommandLine -replace '\s+', ' '); if ($cl.Length -gt 90) { $cl = $cl.Substring(0, 90) }
  "REC host=windows pid={0} ppid={1} created={2} recorded={3} label={4}:{5}:{6}" -f $p.ProcessId, $p.ParentProcessId, $p.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'), $now, $label, $p.Name, $cl
}
