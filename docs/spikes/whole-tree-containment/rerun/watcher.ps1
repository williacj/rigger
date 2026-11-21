# ABOUTME: Card #1430 rerun Windows watcher (fx1430r2): logs every process start and stop on the host, from WMI's temporary
# Win32_ProcessStartTrace and Win32_ProcessStopTrace subscriptions, until C:\Users\user\1430-r2\stop exists.
$dir = 'C:\Users\user\1430-r2'
New-Item -ItemType Directory -Force $dir | Out-Null
$log = "$dir\watch.log"
function W($s) { Add-Content -Path $log -Value $s -Encoding utf8 }
function Now { (Get-Date).ToUniversalTime().ToString('o') }
$p = $PID
for ($i = 0; $i -lt 6 -and $p; $i++) {
  $a = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
  if (-not $a) { break }
  W "chain $(Now) pid=$($a.ProcessId) ppid=$($a.ParentProcessId) name=$($a.Name) created=$($a.CreationDate.ToUniversalTime().ToString('o')) cmd=$($a.CommandLine)"
  $p = $a.ParentProcessId
}
Register-CimIndicationEvent -ClassName Win32_ProcessStartTrace -SourceIdentifier s | Out-Null
Register-CimIndicationEvent -ClassName Win32_ProcessStopTrace -SourceIdentifier e | Out-Null
W "ready $(Now) watcher pid=$PID"
"watcher ready pid=$PID"
while (-not (Test-Path "$dir\stop")) {
  $ev = Wait-Event -Timeout 2
  if ($ev) {
    $n = $ev.SourceEventArgs.NewEvent
    $t = [DateTime]::FromFileTimeUtc([long]$n.TIME_CREATED).ToString('o')
    if ($ev.SourceIdentifier -eq 's') {
      $c = (Get-CimInstance Win32_Process -Filter "ProcessId=$($n.ProcessID)" -ErrorAction SilentlyContinue).CommandLine
      W "start $t pid=$($n.ProcessID) ppid=$($n.ParentProcessID) name=$($n.ProcessName) cmd=$c"
    } else { W "stop $t pid=$($n.ProcessID) ppid=$($n.ParentProcessID) name=$($n.ProcessName)" }
    Remove-Event -EventIdentifier $ev.EventIdentifier
  }
}
Unregister-Event -SourceIdentifier s; Unregister-Event -SourceIdentifier e
W "stopped $(Now)"
"watcher stopped"
