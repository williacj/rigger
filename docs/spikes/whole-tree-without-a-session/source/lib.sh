# ABOUTME: Card #1459 helpers inlined at the top of every root script sent to WSL: UTC timestamps, the process record (pid,
# starttime, boot id), login-state reads, and a scan that records only the spike's own processes.
# Names masked under the owner's ruling (1459#7090274068). The original is kept off-repo; its sha256 is withheld for privacy (1459#7104456293).
export TZ=UTC LC_ALL=C
TU=rigger-spike
D=/home/$TU/1459-spike-engineer
RECF=$D/record.txt
NODE=$D/node-v24.19.0-linux-x64/bin/node
BOOT=$(</proc/sys/kernel/random/boot_id)
while read -r k v; do [[ $k == btime ]] && BT=$v; done < /proc/stat
now(){ local t=$EPOCHREALTIME; printf '%(%Y-%m-%dT%H:%M:%S)T.%sZ' "${t%.*}" "${t#*.}"; }
say(){ echo "$(now) $*"; }
declare -A SEEN
# cmdl <pid>: the process's argv joined by spaces, cut to 80 characters, in REPLY (bash builtins only).
cmdl(){ local -a a; { mapfile -d '' -t a < /proc/$1/cmdline; } 2>/dev/null; REPLY="${a[*]}"; REPLY=${REPLY:0:80}; }
# st <pid>: sets STF to the fields of /proc/<pid>/stat after the command name (STF[1] ppid, STF[19] starttime). Fails if gone.
st(){ local raw; { raw=$(</proc/$1/stat); } 2>/dev/null || return 1; STF=(${raw##*) }); }
# rp <label> <pid>: record one process by pid and starttime (field 22 of /proc/<pid>/stat, clock ticks since the VM's boot).
rp(){
  st "$2" || { say "REC-MISS label=$1 pid=$2 (gone before it could be read)"; return 0; }
  local s=${STF[19]} key="$2:${STF[19]}"; [[ -n ${SEEN[$key]} ]] && return 0; SEEN[$key]=1
  local cs=$(( BT*100 + s )) line
  printf -v line 'REC host=wsl boot=%s pid=%s starttime=%s created=%(%Y-%m-%dT%H:%M:%S)T.%02dZ recorded=%s label=%s' "$BOOT" "$2" "$s" "$((cs/100))" "$((cs%100))" "$(now)" "$1"
  echo "$line"; [[ -d $D ]] && echo "$line" >> "$RECF"
}
# mine <pid>: true if the process is the spike's own: a descendant of this script, owned by the user under test, in an fx1459
# unit or the user under test's slice, or in root's user slice and started no earlier than 3 s before this script.
mine(){
  local p=$1 cg u; { cg=$(</proc/$p/cgroup); } 2>/dev/null || return 1
  case $cg in *fx1459*|*user-$TUID.slice*) return 0;; esac
  u=$(stat -c %u /proc/$p 2>/dev/null); [[ -n $TUID && $u == "$TUID" ]] && return 0
  if [[ $cg == *user-0.slice* ]]; then st $p && (( STF[19] >= MYST - 300 )) && return 0; fi
  local q=$p n=0; while (( q > 1 && n < 64 )); do [[ $q == "$$" ]] && return 0; st $q || return 1; q=${STF[1]}; ((n++)); done
  return 1
}
# recnew <label>: record every live process of the spike's own (see mine) not yet recorded.
recnew(){ local p; for p in /proc/[0-9]*; do p=${p#/proc/}; [[ $p == "$BASHPID" ]] && continue; mine $p && { cmdl $p; rp "$1:$REPLY" "$p"; }; done; }
# recboot <label>: when this connection started the distro, record every process of that start except [name withheld]'s (uid 1000) and
# sshd's per-connection processes, which belong to [name withheld]'s own sessions and user manager and are not the spike's.
recboot(){ local p u; for p in /proc/[0-9]*; do p=${p#/proc/}; [[ $p == "$BASHPID" ]] && continue; u=$(stat -c %u /proc/$p 2>/dev/null) || continue; [[ $u == 1000 ]] && continue; cmdl $p; [[ $REPLY == [name withheld]* ]] && continue; rp "$1:$REPLY" "$p"; done; }
# start_record: record this script and its /init parents; and, if the distro's pid 1 started less than 10 s before this
# script, every process of that distro start (recboot); then the spike's own processes.
start_record(){
  st $$; MYST=${STF[19]}; st 1; P1ST=${STF[19]}; TUID=$(id -u $TU 2>/dev/null)
  say "script pid $$ ppid $PPID starttime $MYST; distro pid 1 starttime $P1ST; boot_id $BOOT btime $BT; user under test $TU uid ${TUID:-none}"
  rp "script:$TAG" $$; rp "init-parent" $PPID; st $PPID; rp "init-grandparent" "${STF[1]}"
  if (( MYST - P1ST < 1000 )); then say "this connection started the distro (pid 1 started $((MYST - P1ST)) ticks before this script): recording that start, except [name withheld]'s processes"; recboot "boot"; fi
  recnew "start"
}
# winrec <label>: record, through interop, this connection's Windows process chain and any WSL VM process started since it began.
winrec(){ say "winrec $1"; /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -NonInteractive -EncodedCommand "$(sed "s/__TAG__/$TAG/;s/__LABEL__/$1/" $D/winrec.ps1 | iconv -t UTF-16LE | base64 -w0)" 2>/dev/null | tr -d '\r' | grep -v -e '^#< CLIXML' -e '^<Objs' | tee -a "$RECF"; }
login_state(){
  say "LOGIN STATE ($1)"; echo '$ loginctl list-sessions --no-pager'; loginctl list-sessions --no-pager
  echo "\$ loginctl show-user $TU --no-pager -p State -p Sessions -p Linger -p Service"; loginctl show-user $TU --no-pager -p State -p Sessions -p Linger -p Service 2>&1
  echo "\$ systemctl is-active user@$TUID.service"; systemctl is-active user@$TUID.service
}
wsl_alive(){ st 1; say "WSL instance ($1): boot_id $(</proc/sys/kernel/random/boot_id); distro pid 1 starttime ${STF[19]}; uptime $(cut -d' ' -f1 /proc/uptime) s"; }
# tu_sessions: ids of the user under test's sessions other than its user manager's own (class manager).
tu_sessions(){ loginctl list-sessions --no-legend --no-pager | awk -v u=$TU '$3==u && $6!="manager" {print $1}'; }
