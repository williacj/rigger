# ABOUTME: Card #1459 helpers sourced by every root script in WSL: UTC timestamps, the process record (pid, starttime, boot id),
# login-state reads, and a scan that records every new process in user.slice, /non-systemd or an fx1459 unit.
# Names masked under the owner's ruling (1459#7090274068). The original is kept off-repo; its sha256 is withheld for privacy (1459#7104456293).
export TZ=UTC LC_ALL=C
D=/home/[name withheld]/1459-spike-engineer
RECF=$D/record.txt
BOOT=$(</proc/sys/kernel/random/boot_id)
while read -r k v; do [[ $k == btime ]] && BT=$v; done < /proc/stat
now(){ local t=$EPOCHREALTIME; printf '%(%Y-%m-%dT%H:%M:%S)T.%sZ' "${t%.*}" "${t#*.}"; }
say(){ echo "$(now) $*"; }
declare -A SEEN
# cmdl <pid>: the process's argv joined by spaces, cut to 80 characters, in REPLY (bash builtins only).
cmdl(){ local -a a; { mapfile -d '' -t a < /proc/$1/cmdline; } 2>/dev/null; REPLY="${a[*]}"; REPLY=${REPLY:0:80}; }
# rp <label> <pid>: record one process by pid and its starttime (field 22 of /proc/<pid>/stat, clock ticks since boot).
rp(){
  local raw; { raw=$(</proc/$2/stat); } 2>/dev/null || { say "REC-MISS label=$1 pid=$2 (gone before it could be read)"; return 0; }
  local rest=${raw##*) }; local -a f=($rest); local st=${f[19]}
  local key="$2:$st"; [[ -n ${SEEN[$key]} ]] && return 0; SEEN[$key]=1
  local cs=$(( BT*100 + st )); local line
  printf -v line 'REC host=wsl boot=%s pid=%s starttime=%s created=%(%Y-%m-%dT%H:%M:%S)T.%02dZ recorded=%s label=%s' "$BOOT" "$2" "$st" "$((cs/100))" "$((cs%100))" "$(now)" "$1"
  echo "$line"; [[ -d $D ]] && echo "$line" >> "$RECF"
}
# recnew <label>: record every live process whose cgroup is in user.slice, /non-systemd or an fx1459 unit, not yet recorded.
recnew(){
  local p cg
  for p in /proc/[0-9]*; do
    p=${p#/proc/}; [[ $p == "$BASHPID" ]] && continue
    { cg=$(</proc/$p/cgroup); } 2>/dev/null || continue
    case $cg in *user.slice*|*non-systemd*|*fx1459*) cmdl $p; rp "$1:$REPLY" "$p";; esac
  done
}
# recall <label>: record every live process (used when this script's own connection booted the distro).
recall(){ local p; for p in /proc/[0-9]*; do p=${p#/proc/}; [[ $p == "$BASHPID" ]] && continue; cmdl $p; rp "$1:$REPLY" "$p"; done; }
# start_record: record this script, its /init parents, and either the whole boot (if this connection booted WSL) or the new processes.
start_record(){
  local raw; raw=$(</proc/$$/stat); local rest=${raw##*) }; local -a f=($rest); MYST=${f[19]}
  say "script pid $$ ppid $PPID starttime $MYST boot_id $BOOT btime $BT uptime $(cut -d' ' -f1 /proc/uptime)"
  rp "script:$TAG" $$; rp "init-parent" $PPID; local r2; r2=$(</proc/$PPID/stat); local -a g=(${r2##*) }); rp "init-grandparent" "${g[1]}"
  if (( MYST < 1500 )); then say "this connection booted the distro (script started ${MYST} ticks after boot): recording every process"; recall "boot"; else recnew "new"; fi
}
# winrec <label>: record, through interop, this connection's Windows process chain and any WSL VM process started since it began.
winrec(){ say "winrec $1"; /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -NonInteractive -EncodedCommand "$(sed "s/__TAG__/$TAG/;s/__LABEL__/$1/" $D/winrec.ps1 | iconv -t UTF-16LE | base64 -w0)" | tr -d '\r' | tee -a "$RECF"; }
login_state(){
  say "LOGIN STATE ($1)"; echo '$ loginctl list-sessions --no-pager'; loginctl list-sessions --no-pager
  echo '$ loginctl show-user [name withheld] --no-pager -p State -p Sessions -p Linger -p Service'; loginctl show-user [name withheld] --no-pager -p State -p Sessions -p Linger -p Service 2>&1
  echo '$ systemctl is-active [name withheld]'; systemctl is-active [name withheld]
}
wsl_alive(){ say "WSL instance: boot_id $(</proc/sys/kernel/random/boot_id) uptime $(cut -d' ' -f1 /proc/uptime) s ($1)"; }
# user_sessions: ids of [name withheld]'s sessions other than the user manager's own (class manager).
user_sessions(){ loginctl list-sessions --no-legend --no-pager | awk '$3=="[name withheld]" && $6!="manager" {print $1}'; }
# foreign_[name withheld]: [name withheld] processes outside the user manager's own init.scope and outside this spike's fx1459 units. Prints them; returns 0 if any.
foreign_[name withheld](){
  local p u cg any=1
  for p in /proc/[0-9]*; do p=${p#/proc/}; u=$(stat -c %u /proc/$p 2>/dev/null) || continue; [[ $u == 1000 ]] || continue
    { cg=$(</proc/$p/cgroup); } 2>/dev/null || continue
    case $cg in *[name withheld]/init.scope*|*fx1459*) continue;; esac
    echo "[name withheld] process outside the manager and the spike's units: pid $p $(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | cut -c1-100) | $cg"; any=0
  done; return $any
}
