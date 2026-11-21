#!/bin/bash
# ABOUTME: Card #1430 listing (macOS and Linux): every live process of one run with pid, ppid, pgid, sid, cwd and (Linux) cgroup.
R="$1"
echo "listing run=$R at $(date -u +%Y-%m-%dT%H:%M:%SZ) on $(uname -s)"
pids=$(ps -axo pid=,args= | grep -E "fx-$R-M|fixture.sh $R\$|supervisor.cjs [a-z0-9]+ $R " | grep -v grep | awk '{print $1}')
printf '%-7s %-7s %-7s %-7s %-5s %s | %s | %s\n' PID PPID PGID SID STAT CWD CGROUP ARGS
for p in $pids; do
  line=$(ps -o pid=,ppid=,pgid=,stat= -p "$p") || continue
  set -- $line
  sid=$(python3 -c "import os,sys;print(os.getsid(int(sys.argv[1])))" "$p" 2>/dev/null)
  args=$(ps -o args= -p "$p")
  if [ -e /proc/$p/cwd ]; then cwd=$(readlink /proc/$p/cwd); cg=$(cut -d: -f3 /proc/$p/cgroup);
  else cwd=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'); cg=-; fi
  printf '%-7s %-7s %-7s %-7s %-5s %s | %s | %s\n' "$1" "$2" "$3" "$sid" "$4" "$cwd" "$cg" "$args"
done
echo "count=$(echo $pids | wc -w | tr -d ' ')"
