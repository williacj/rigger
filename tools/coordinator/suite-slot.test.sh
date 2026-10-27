#!/bin/bash
# ABOUTME: Tests for suite-slot.sh, the host-wide test slot; run with `bash suite-slot.test.sh`.
# Each test gets its own SUITE_SLOT_DIR under $TMPDIR and a fake load read from a file.

SLOT="$(cd "$(dirname "$0")" && pwd)/suite-slot.sh"
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/suite-slot-test.XXXXXX")
PASS=0; FAIL=0; BGPIDS=""

now() { perl -MTime::HiRes=time -e 'printf "%.6f\n", time'; }
ok() { PASS=$((PASS+1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL - $1"; }
check() { local name=$1; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
# wait_for <seconds> <cmd...>: poll the condition every 50ms until it holds or time runs out.
wait_for() {
  local limit=$1; shift
  local end=$(( $(date +%s) + limit ))
  until "$@"; do
    [ "$(date +%s)" -ge "$end" ] && return 1
    sleep 0.05
  done
}
alive() { kill -0 "$1" 2>/dev/null; }
dead() { ! kill -0 "$1" 2>/dev/null; }
has() { grep -q -- "$2" "$1" 2>/dev/null; }
bg_track() { BGPIDS="$BGPIDS $1"; }
# reap <pid>: wait for a background job with a bound; a job still running after 20s fails and is killed.
reap() {
  wait_for 20 dead "$1" || { bad "pid $1 still running after 20s"; kill -KILL "$1" 2>/dev/null; }
  wait "$1"
}
cleanup() {
  for p in $BGPIDS; do kill -KILL "$p" 2>/dev/null; done
  for f in "$ROOT"/*/child.pid; do [ -f "$f" ] && kill -KILL "$(cat "$f")" 2>/dev/null; done
  rm -rf "$ROOT"
}
trap cleanup EXIT

# A `ps` shim: fails for the pids in $SHIM_FAIL ("all" fails every call). The first call about
# $SHIM_SWAP_PID first moves a copy of $SHIM_SWAP_FILE over the lock, to race a reclaimer.
SHIM="$ROOT/shim"; mkdir -p "$SHIM"
cat > "$SHIM/ps" <<'EOF'
#!/bin/bash
for a; do last=$a; done
case " $SHIM_FAIL " in *" all "*|*" $last "*) exit 1 ;; esac
if [ -n "$SHIM_SWAP_PID" ] && [ "$last" = "$SHIM_SWAP_PID" ] && [ ! -e "$SHIM_SWAP_FILE.done" ]; then
  touch "$SHIM_SWAP_FILE.done"; cp "$SHIM_SWAP_FILE" "$SUITE_SLOT_DIR/.swap"; mv -f "$SUITE_SLOT_DIR/.swap" "$SUITE_SLOT_DIR/lock"
fi
exec /bin/ps "$@"
EOF
chmod +x "$SHIM/ps"
# holder <label> <pid> <lstart> [token]: print a holder record written by hand.
holder() { printf 'token=%s\npid=%s\nlstart=%s\nlabel=%s\nsince=2026-01-01T00:00:00Z\n' "${4:-hand}" "$2" "$3" "$1"; }
real_lstart() { echo $(/bin/ps -o lstart= -p "$1"); }
dead_pid() { true & local p=$!; wait $p; echo $p; }
# sleeper: start a process to stand in for a live holder; sets SP and records it for cleanup.
sleeper() { sleep 300 & SP=$!; disown $SP; bg_track $SP; }
# start_waiter [VAR=value...]: a waiter whose command touches $T/ran; sets PW.
start_waiter() { env "$@" "$SLOT" waiter -- sh -c 'touch "$0/ran"' "$T" 2>"$T/w.err" & PW=$!; bg_track $PW; }

# setup <name>: fresh slot dir and fake load (5) for one test; sets T.
setup() {
  T="$ROOT/$1"; mkdir -p "$T"
  echo 5 > "$T/load"
  export SUITE_SLOT_DIR="$T/slot" SUITE_SLOT_LOAD_CMD="cat $T/load" SUITE_SLOT_POLL=0.1
  unset SUITE_SLOT_HELD SUITE_SLOT_MAX_LOAD
  LOG="$SUITE_SLOT_DIR/suite-slot.log"
}

# 7. Usage errors exit 2, print usage and take no lock.
setup usage
for args in "" "lbl" "lbl echo hi" "lbl --" "-- echo hi"; do
  # shellcheck disable=SC2086
  "$SLOT" $args >"$T/out" 2>"$T/err"; st=$?
  check "usage '$args' exits 2" [ "$st" = 2 ]
  check "usage '$args' prints usage" has "$T/err" "usage:"
done
check "usage errors take no lock" [ ! -e "$SUITE_SLOT_DIR/lock" ]

# 5. Exit status, including 128+N, and pass-through of stdout, stderr and stdin.
setup status
"$SLOT" st -- true; check "exit 0 propagates" [ $? = 0 ]
"$SLOT" st -- sh -c 'exit 7'; check "exit 7 propagates" [ $? = 7 ]
"$SLOT" st -- sh -c 'kill -TERM $$'; check "death by SIGTERM exits 143" [ $? = 143 ]
"$SLOT" st -- sh -c 'kill -KILL $$' 2>"$T/err"; check "death by SIGKILL exits 137" [ $? = 137 ]
check "the wrapper adds nothing to stderr when the command is killed" [ ! -s "$T/err" ]
"$SLOT" st -- sh -c 'echo out; echo err >&2' >"$T/out" 2>"$T/err"
check "stdout passes through" [ "$(cat "$T/out")" = out ]
check "stderr passes through" [ "$(cat "$T/err")" = err ]
check "stdin is inherited" [ "$(printf 'in\n' | "$SLOT" st -- cat)" = in ]
check "args with spaces survive" [ "$("$SLOT" st -- printf '%s|' 'a b' c)" = "a b|c|" ]

# 4. Release after a non-zero exit.
setup nonzero
"$SLOT" nz -- false
check "lock released after non-zero exit" [ ! -e "$SUITE_SLOT_DIR/lock" ]
"$SLOT" nz2 -- true; check "next caller gets the slot after non-zero exit" [ $? = 0 ]
check "end line logs status 1" has "$LOG" "event=end label=nz .*status=1"

# 1. Two concurrent holders never overlap, from different working directories.
setup overlap
mkdir -p "$T/a" "$T/b"
HOLD='printf "%s start %s\n" "$1" "$(perl -MTime::HiRes=time -e "printf q(%.6f), time")" >> "$0/events"
  while [ ! -e "$0/$1.go" ]; do sleep 0.05; done
  printf "%s end %s\n" "$1" "$(perl -MTime::HiRes=time -e "printf q(%.6f), time")" >> "$0/events"'
(cd "$T/a" && exec "$SLOT" holder-a -- sh -c "$HOLD" "$T" A 2>"$T/a.err") & PA=$!; bg_track $PA
wait_for 10 has "$T/events" "A start"
(cd "$T/b" && exec "$SLOT" holder-b -- sh -c "$HOLD" "$T" B 2>"$T/b.err") & PB=$!; bg_track $PB
check "waiter names the holder on stderr" wait_for 10 has "$T/b.err" "holder-a"
check "waiter has not started while A holds" [ "$(grep -c 'B start' "$T/events")" = 0 ]
touch "$T/A.go"
wait_for 10 has "$T/events" "B start"; touch "$T/B.go"
reap "$PA"; reap "$PB"
a_end=$(awk '$1=="A" && $2=="end" {print $3}' "$T/events")
b_start=$(awk '$1=="B" && $2=="start" {print $3}' "$T/events")
check "B starts only after A ends" awk -v e="$a_end" -v s="$b_start" 'BEGIN { exit !(e != "" && s != "" && s >= e) }'
check "log records the start with cwd" has "$LOG" "event=start label=holder-b .*cwd=$T/b"

# 4. Release after SIGINT, SIGTERM or SIGHUP to the wrapper, with the command's group gone.
for sig in INT TERM HUP; do
  setup "sig-$sig"
  # A background job of a script starts with SIGINT ignored; restore it, as a foreground caller has it.
  perl -e '$SIG{INT} = "DEFAULT"; exec @ARGV' "$SLOT" "sig-$sig" -- sh -c 'echo $$ > "$0/child.pid"; sh -c "echo \$\$ > \"$0/grandchild.pid\"; exec sleep 300"' "$T" & PW=$!; bg_track $PW
  wait_for 10 test -s "$T/grandchild.pid"
  kill -"$sig" "$PW"; reap "$PW"; st=$?
  check "SIG$sig: wrapper exits non-zero" [ "$st" -ne 0 ]
  check "SIG$sig: command is gone" wait_for 10 dead "$(cat "$T/child.pid")"
  check "SIG$sig: command's group is gone" wait_for 10 dead "$(cat "$T/grandchild.pid")"
  check "SIG$sig: lock released" [ ! -e "$SUITE_SLOT_DIR/lock" ]
  check "SIG$sig: end line logged" has "$LOG" "event=end label=sig-$sig"
done

# 4. SIGTERM while waiting for the slot gives up without touching the holder's lock.
setup sig-waiting
"$SLOT" holder -- sh -c 'while [ ! -e "$0/go" ]; do sleep 0.05; done' "$T" & PA=$!; bg_track $PA
wait_for 10 test -e "$SUITE_SLOT_DIR/lock"
"$SLOT" waiter -- true 2>"$T/w.err" & PW=$!; bg_track $PW
wait_for 10 has "$T/w.err" "holder"
kill -TERM "$PW"; reap "$PW"; st=$?
check "waiter killed while waiting exits non-zero" [ "$st" -ne 0 ]
check "holder's lock survives a killed waiter" has "$SUITE_SLOT_DIR/lock" "holder"
check "a waiter killed while waiting leaves no ticket" [ -z "$(ls "$SUITE_SLOT_DIR/queue" 2>/dev/null)" ]
touch "$T/go"; reap "$PA"

# 4. Stale-lock reclaim after SIGKILL of the holder, and the pid-reuse guard.
setup stale
"$SLOT" doomed -- sh -c 'echo $$ > "$0/child.pid"; exec sleep 300' "$T" & PW=$!; bg_track $PW
wait_for 10 test -s "$T/child.pid"
kill -KILL "$PW"; reap "$PW" 2>/dev/null
kill -KILL "$(cat "$T/child.pid")"
"$SLOT" reclaimer -- true 2>"$T/r.err"; st=$?
check "SIGKILLed holder's lock is reclaimed" [ "$st" = 0 ]
check "reclaim is logged" has "$LOG" "event=reclaim label=reclaimer .*stale_pid=$PW"
setup reuse
mkdir -p "$SUITE_SLOT_DIR"
printf 'token=x\npid=%s\nlstart=Thu Jan  1 00:00:00 1970\nlabel=ghost\nsince=1970-01-01T00:00:00Z\n' $$ > "$SUITE_SLOT_DIR/lock"
"$SLOT" reuser -- true 2>/dev/null & PW=$!; bg_track $PW
check "live pid with a different start time counts as stale" wait_for 10 dead $PW
reap "$PW"; check "reused-pid lock reclaim succeeds" [ $? = 0 ]
check "reused-pid reclaim is logged" has "$LOG" "event=reclaim label=reuser .*stale_pid=$$"

# 1/4 (B1). Reclaim only on positive evidence of death; a failed lookup means still live.
setup ps-fails-waiter
sleeper; mkdir -p "$SUITE_SLOT_DIR"; holder ghost "$SP" "$(real_lstart "$SP")" > "$SUITE_SLOT_DIR/lock"
start_waiter PATH="$SHIM:$PATH" SHIM_FAIL="$SP"
check "B1: waiter whose ps fails treats the holder as live" wait_for 10 has "$T/w.err" "held by ghost"
check "B1: waiter whose ps fails does not run" [ ! -e "$T/ran" ]
kill -KILL "$SP"
check "B1: holder's pid confirmed gone lets the waiter reclaim" wait_for 10 test -e "$T/ran"
reap "$PW"

setup empty-lstart-live
sleeper; mkdir -p "$SUITE_SLOT_DIR"; holder blank "$SP" "" > "$SUITE_SLOT_DIR/lock"
start_waiter
check "B1: an empty recorded start time counts as live" wait_for 10 has "$T/w.err" "held by blank"
check "B1: waiter does not run past an empty start time" [ ! -e "$T/ran" ]
kill -KILL "$SP"
check "B1: empty start time with the pid gone is reclaimed" wait_for 10 test -e "$T/ran"
reap "$PW"

setup ps-fails-dead
DP=$(dead_pid); mkdir -p "$SUITE_SLOT_DIR"; holder gone "$DP" "" > "$SUITE_SLOT_DIR/lock"
start_waiter PATH="$SHIM:$PATH" SHIM_FAIL="$DP"
check "B1: a dead holder is reclaimed even when ps fails for it" wait_for 10 test -e "$T/ran"
reap "$PW"; check "B1: that reclaim exits 0" [ $? = 0 ]

setup eperm
mkdir -p "$SUITE_SLOT_DIR"; holder rooty 1 "$(real_lstart 1)" > "$SUITE_SLOT_DIR/lock"
start_waiter PATH="$SHIM:$PATH" SHIM_FAIL=1
check "B1: a pid we may not signal, with ps failing, counts as live" wait_for 10 has "$T/w.err" "held by rooty"
check "B1: waiter does not run past an unsignalable holder" [ ! -e "$T/ran" ]
kill -TERM "$PW"; reap "$PW" >/dev/null

setup ps-fails-holder
PATH="$SHIM:$PATH" SHIM_FAIL=all "$SLOT" blind -- sh -c 'touch "$0/ran"' "$T" 2>"$T/h.err"; st=$?
check "B1: a wrapper that cannot record its start time exits 71" [ "$st" = 71 ]
check "B1: it says why" has "$T/h.err" "start time"
check "B1: it does not run the command" [ ! -e "$T/ran" ]
check "B1: it leaves no lock" [ ! -e "$SUITE_SLOT_DIR/lock" ]

# 1/4 (B2). A SIGKILL to the caller's whole group orphans the command; the slot stays held until it exits.
setup group-kill
perl -e 'setpgrp(0, 0); exec @ARGV' "$SLOT" orphaner -- sh -c 'echo $$ > "$0/child.pid"
  while [ ! -e "$0/go" ]; do sleep 0.05; done; echo "H end" >> "$0/events"' "$T" & PG=$!; bg_track $PG
wait_for 10 test -s "$T/child.pid"
kill -KILL -- -"$PG"; reap "$PG" 2>/dev/null
check "B2: the command outlives its wrapper" alive "$(cat "$T/child.pid")"
"$SLOT" waiter -- sh -c 'echo "W start" >> "$0/events"' "$T" 2>"$T/w.err" & PW=$!; bg_track $PW
check "B2: waiter waits on the orphaned command's group" wait_for 10 has "$T/w.err" "held by orphaner"
check "B2: waiter does not start while the orphan runs" [ ! -e "$T/events" ]
touch "$T/go"
check "B2: waiter starts once the orphan exits" wait_for 10 has "$T/events" "W start"
check "B2: orphan ended before the waiter started" [ "$(head -1 "$T/events")" = "H end" ]
reap "$PW"

# 1 (N3). A reclaimer removes only the stale record it judged, never a fresh lock that replaced it.
setup reclaim-race
sleeper; OLD=$SP; sleeper; FRESH=$SP; mkdir -p "$SUITE_SLOT_DIR"
holder stale "$OLD" "Thu Jan  1 00:00:00 1970" > "$SUITE_SLOT_DIR/lock"
holder fresh "$FRESH" "$(real_lstart "$FRESH")" > "$T/fresh"
start_waiter PATH="$SHIM:$PATH" SHIM_SWAP_PID="$OLD" SHIM_SWAP_FILE="$T/fresh"
check "N3: the swap happened mid-reclaim" wait_for 10 test -e "$T/fresh.done"
check "N3: reclaimer leaves the fresh lock alone" wait_for 10 has "$T/w.err" "held by fresh"
check "N3: reclaimer does not run past the fresh holder" [ ! -e "$T/ran" ]
kill -KILL "$FRESH"
check "N3: reclaimer runs once the fresh holder is gone" wait_for 10 test -e "$T/ran"
reap "$PW"

# 1 (N1). A lock path that exists but cannot be read gives up with a message, never a busy spin.
setup unreadable
mkdir -p "$SUITE_SLOT_DIR"; ln -s "$T/nowhere" "$SUITE_SLOT_DIR/lock"
"$SLOT" spinner -- sh -c 'touch "$0/ran"' "$T" 2>"$T/s.err" & PW=$!; bg_track $PW
check "N1: unreadable lock ends the wait" wait_for 15 dead $PW
reap "$PW"; check "N1: it exits 71" [ $? = 71 ]
check "N1: it says why" has "$T/s.err" "cannot"
check "N1: it does not run the command" [ ! -e "$T/ran" ]

# 2. Load gate inside the lock, with its log lines and threshold override.
setup load
echo 30.5 > "$T/load"
"$SLOT" loady -- sh -c 'touch "$0/ran"' "$T" 2>"$T/l.err" & PW=$!; bg_track $PW
check "load wait reported on stderr" wait_for 10 has "$T/l.err" "load 30.5"
check "load wait holds the lock" test -e "$SUITE_SLOT_DIR/lock"
check "command does not run while load is high" [ ! -e "$T/ran" ]
echo 24 > "$T/load"
check "command runs once load drops to 24" wait_for 10 test -e "$T/ran"
reap "$PW"; check "load-gated run exits 0" [ $? = 0 ]
check "wait line logged with load" has "$LOG" "event=wait label=loady pid=$PW load=30.5"
check "start line logged with load" has "$LOG" "event=start label=loady pid=$PW load=24 "
check "end line has status and duration" has "$LOG" "event=end label=loady pid=$PW load=24 .*status=0 duration=[0-9]*s"
check "log lines carry ISO-8601 UTC timestamps" has "$LOG" "^20[0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]Z event=start"
check "log lines carry the command" has "$LOG" "event=start label=loady .*cmd=sh -c"
SUITE_SLOT_MAX_LOAD=40 "$SLOT" maxed -- true; check "SUITE_SLOT_MAX_LOAD overrides the threshold" [ $? = 0 ]
echo "{ 7.10 8.12 11.33 }" > "$T/load"
"$SLOT" braces -- true; check "sysctl-format load is parsed" has "$LOG" "event=start label=braces pid=[0-9]* load=7.10 "

# 2 (N6). A transient load read failure is retried; a lasting one exits 75 without running.
setup load-flaky
printf '%s\n' 'n=$(( $(cat "$1/n" 2>/dev/null || echo 0) + 1 )); echo $n > "$1/n"; [ $n -gt 2 ] && echo 5' > "$T/flaky"
SUITE_SLOT_LOAD_CMD="sh $T/flaky $T" "$SLOT" flaky -- sh -c 'touch "$0/ran"' "$T" 2>"$T/f.err"; st=$?
check "N6: transient load failure is retried" test "$st" = 0 -a -e "$T/ran"
setup load-broken
SUITE_SLOT_LOAD_CMD=false "$SLOT" broken -- sh -c 'touch "$0/ran"' "$T" 2>"$T/b.err"; st=$?
check "N6: lasting load failure exits 75" [ "$st" = 75 ]
check "N6: it says why" has "$T/b.err" "load average"
check "N6: it does not run the command" [ ! -e "$T/ran" ]
check "N6: it releases the lock" [ ! -e "$SUITE_SLOT_DIR/lock" ]
check "N6: it logs the error" has "$LOG" "event=end label=broken .*status=75 error=no-load"

# 6. Re-entrancy: a nested call with the live holder's token runs directly.
setup reentry
"$SLOT" outer -- sh -c '"$0" inner -- sh -c "echo inner:\$SUITE_SLOT_HELD" > "$1/inner.out"; echo $? > "$1/inner.st"' "$SLOT" "$T" & PW=$!; bg_track $PW
check "nested call does not deadlock" wait_for 15 dead $PW
check "nested command ran" has "$T/inner.out" "inner:."
check "nested call exits 0" [ "$(cat "$T/inner.st" 2>/dev/null)" = 0 ]
check "nested run is logged" has "$LOG" "event=nested label=inner"
check "lock released after nested run" [ ! -e "$SUITE_SLOT_DIR/lock" ]
SUITE_SLOT_HELD=bogus "$SLOT" bogus -- true
check "a stale token with no holder takes the slot normally" has "$LOG" "event=start label=bogus"
setup reentry-dead
holder deadhold "$(dead_pid)" "Thu Jan  1 00:00:00 1970" tok > "$T/lock" && mkdir -p "$SUITE_SLOT_DIR" && mv "$T/lock" "$SUITE_SLOT_DIR/lock"
SUITE_SLOT_HELD=tok "$SLOT" late -- true 2>/dev/null
check "N3: a matching token with a dead holder does not run nested" [ "$(grep -c 'event=nested' "$LOG")" = 0 ]
check "N3: it reclaims and takes the slot instead" has "$LOG" "event=reclaim label=late"

# 8. FIFO. Each test's holder runs $T/hold until $T/go exists; $T/mark appends a name to $T/events.
fifo_setup() {
  setup "$1"
  printf '%s\n' 'while [ ! -e "$1/go" ]; do sleep 0.05; done' > "$T/hold"
  printf '%s\n' 'echo "$2" >> "$1/events"' > "$T/mark"
}
queued() { has "$LOG" "event=queue label=$1 "; }
queue_empty() { [ -z "$(ls "$SUITE_SLOT_DIR/queue" 2>/dev/null)" ]; }
events() { tr '\n' ' ' < "$T/events" 2>/dev/null; }

# 8. A holder that releases and asks again at once queues behind an earlier waiter.
fifo_setup starve
sh -c '"$0" hog -- sh "$1/hold" "$1"; "$0" hog -- sh "$1/mark" "$1" again' "$SLOT" "$T" 2>/dev/null & PH=$!; bg_track $PH
wait_for 10 has "$LOG" "event=start label=hog "
# A slow poll for the waiter leaves the re-asking holder every chance to jump ahead of it.
SUITE_SLOT_POLL=1 "$SLOT" early -- sh "$T/mark" "$T" early 2>"$T/w.err" & PW=$!; bg_track $PW
check "starve: the waiter waits on the holder" wait_for 10 has "$T/w.err" "held by hog"
touch "$T/go"; reap "$PH"; reap "$PW"; st=$?
check "starve: the earlier waiter runs before the holder's second request" [ "$(events)" = "early again " ]
check "starve: the waiter exits 0" [ "$st" = 0 ]
check "starve: the queue is empty afterwards" queue_empty

# 8. Three waiters run in the order they asked, and the log gives each its place.
fifo_setup fifo
"$SLOT" holder -- sh "$T/hold" "$T" 2>/dev/null & PA=$!; bg_track $PA
wait_for 10 has "$LOG" "event=start label=holder "
WPIDS=
for w in w1 w2 w3; do
  "$SLOT" "$w" -- sh "$T/mark" "$T" "$w" 2>/dev/null & WPIDS="$WPIDS $!"; bg_track $!
  check "fifo: $w is queued" wait_for 10 queued "$w"
done
touch "$T/go"; reap "$PA"; for p in $WPIDS; do reap "$p"; done
check "fifo: waiters run in arrival order" [ "$(events)" = "w1 w2 w3 " ]
check "fifo: the queue event gives the place" has "$LOG" "event=queue label=w3 .*ticket=[0-9]* ahead=2"
check "fifo: the queue is empty afterwards" queue_empty

# 8. SIGKILLed waiters, at the head and mid-queue, are skipped and leave nothing behind.
fifo_setup dead-waiter
"$SLOT" holder -- sh "$T/hold" "$T" 2>/dev/null & PA=$!; bg_track $PA
wait_for 10 has "$LOG" "event=start label=holder "
for w in d1 w2 d3 w4; do
  "$SLOT" "$w" -- sh "$T/mark" "$T" "$w" 2>/dev/null & eval "P_$w=\$!"; bg_track $!
  check "dead-waiter: $w is queued" wait_for 10 queued "$w"
done
kill -KILL "$P_d1" "$P_d3"; reap "$P_d1" 2>/dev/null; reap "$P_d3" 2>/dev/null
touch "$T/go"; reap "$PA"; reap "$P_w2"; reap "$P_w4"
check "dead-waiter: the live waiters run in order" [ "$(events)" = "w2 w4 " ]
check "dead-waiter: the dead head is skipped and logged" has "$LOG" "event=skip .*stale_pid=$P_d1 stale_label=d1"
check "dead-waiter: the dead mid-queue waiter is skipped and logged" has "$LOG" "event=skip .*stale_pid=$P_d3 stale_label=d3"
check "dead-waiter: the queue is empty afterwards" queue_empty

# 8. A queued ticket is skipped only on positive evidence of death: a reused pid is, a live one is not.
setup queued-live
sleeper; mkdir -p "$SUITE_SLOT_DIR/queue"
holder reused $$ "Thu Jan  1 00:00:00 1970" > "$SUITE_SLOT_DIR/queue/1"
holder live "$SP" "$(real_lstart "$SP")" > "$SUITE_SLOT_DIR/queue/2"
start_waiter
check "queued-live: a reused-pid ticket is skipped" wait_for 10 has "$LOG" "event=skip .*stale_label=reused"
check "queued-live: a live ticket ahead is named on stderr" wait_for 10 has "$T/w.err" "queued behind live"
check "queued-live: the waiter does not run past a live ticket" [ ! -e "$T/ran" ]
kill -KILL "$SP"
check "queued-live: the waiter runs once that ticket's pid is gone" wait_for 10 test -e "$T/ran"
reap "$PW"

# 8. A SIGKILLed wrapper leaves .cand.<pid> linked as a ticket or as the lock. A later wrapper with
# that pid must write its record to a fresh file, never into the orphan's inode.
for where in queue/1 lock; do
  setup "orphan-${where%%/*}"
  mkdir -p "$SUITE_SLOT_DIR/queue"
  # plant <link> <command...>: under this pid, plant a dead wrapper's .cand linked at <link>, then exec.
  printf '%s\n' 'd=$SUITE_SLOT_DIR; where=$1; shift
    printf "token=old\npid=%s\nlstart=Thu Jan  1 00:00:00 1970\nlabel=orphan\nsince=1970-01-01T00:00:00Z\n" $$ > "$d/.cand.$$"
    ln "$d/.cand.$$" "$d/$where" && exec "$@"' > "$T/plant"
  sh "$T/plant" "$where" "$SLOT" reborn -- sh -c 'touch "$0/ran"' "$T" 2>"$T/w.err" & PW=$!; bg_track $PW
  check "orphan $where: a wrapper reusing the orphan's pid runs" wait_for 10 test -e "$T/ran"
  reap "$PW"; check "orphan $where: it exits 0" [ $? = 0 ]
  check "orphan $where: the orphan's record is judged stale" has "$LOG" "stale_label=orphan"
  check "orphan $where: the queue is empty afterwards" queue_empty
done

# 9. Start times survive a timezone change; a reused pid is still caught.
# epoch_of <pid>: the process's start in seconds since the epoch. local_at <epoch> <zone>: that
# instant in ps's lstart form, as a writer whose timezone was <zone> recorded it.
epoch_of() { LC_ALL=C TZ=UTC date -j -f '%a %b %d %T %Y' "$(echo $(LC_ALL=C TZ=UTC /bin/ps -o lstart= -p "$1"))" +%s 2>/dev/null; }
local_at() { echo $(LC_ALL=C TZ=$2 date -r "$1" '+%a %b %e %T %Y'); }

setup tz-lock
sleeper; mkdir -p "$SUITE_SLOT_DIR"
holder kathmandu "$SP" "$(local_at "$(epoch_of "$SP")" Asia/Kathmandu)" > "$SUITE_SLOT_DIR/lock"
start_waiter TZ=America/Chicago
check "tz: a live holder recorded in another zone is still live" wait_for 10 has "$T/w.err" "held by kathmandu"
check "tz: the waiter does not run past it" [ ! -e "$T/ran" ]
check "tz: the holder is not reclaimed" [ "$(grep -c 'event=reclaim' "$LOG")" = 0 ]
kill -KILL "$SP"
check "tz: the waiter runs once that holder's pid is gone" wait_for 10 test -e "$T/ran"
reap "$PW"

setup tz-ticket
sleeper; mkdir -p "$SUITE_SLOT_DIR/queue"
holder edt "$SP" "$(local_at "$(epoch_of "$SP")" America/New_York)" > "$SUITE_SLOT_DIR/queue/1"
start_waiter TZ=America/Chicago
check "tz: a live ticket written in EDT and read in CDT is still live" wait_for 10 has "$T/w.err" "queued behind edt"
check "tz: the waiter does not run past it" [ ! -e "$T/ran" ]
check "tz: the ticket is not skipped" [ "$(grep -c 'event=skip' "$LOG")" = 0 ]
kill -KILL "$SP"
check "tz: the waiter runs once that ticket's pid is gone" wait_for 10 test -e "$T/ran"
reap "$PW"

# Writer and checker in different zones, as when the host's zone changes mid-wait.
fifo_setup tz-midwait
TZ=America/New_York "$SLOT" holder -- sh "$T/hold" "$T" 2>/dev/null & PA=$!; bg_track $PA
wait_for 10 has "$LOG" "event=start label=holder "
TZ=Asia/Tokyo "$SLOT" w1 -- sh "$T/mark" "$T" w1 2>"$T/w1.err" & P1=$!; bg_track $P1
check "tz-midwait: w1 is queued" wait_for 10 queued w1
TZ=America/Chicago "$SLOT" w2 -- sh "$T/mark" "$T" w2 2>"$T/w2.err" & P2=$!; bg_track $P2
check "tz-midwait: w1 waits on a holder from another zone" wait_for 10 has "$T/w1.err" "held by holder"
check "tz-midwait: w2 waits behind w1 from another zone" wait_for 10 has "$T/w2.err" "queued behind w1"
touch "$T/go"; reap "$PA"; reap "$P1"; reap "$P2"
check "tz-midwait: waiters run in order" [ "$(events)" = "w1 w2 " ]
check "tz-midwait: nobody is skipped or reclaimed" [ "$(grep -c -e 'event=skip' -e 'event=reclaim' "$LOG")" = 0 ]

# A reused pid: a recorded start that is not the process's start by a whole zone offset is dead.
setup tz-reuse-legacy
mkdir -p "$SUITE_SLOT_DIR"
holder offby37 $$ "$(local_at $(( $(epoch_of $$) + 37 )) Asia/Tokyo)" > "$SUITE_SLOT_DIR/lock"
start_waiter
check "tz-reuse: a record 37s off in another zone is reclaimed" wait_for 10 test -e "$T/ran"
check "tz-reuse: that reclaim is logged" has "$LOG" "event=reclaim .*stale_pid=$$ stale_label=offby37"
reap "$PW"
setup tz-reuse-epoch
mkdir -p "$SUITE_SLOT_DIR"
printf 'token=x\npid=%s\nlstart=%s\nstart=%s\nlabel=houroff\nsince=2026-01-01T00:00:00Z\n' $$ \
  "$(real_lstart $$)" $(( $(epoch_of $$) - 3600 )) > "$SUITE_SLOT_DIR/lock"
start_waiter
check "tz-reuse: a recorded epoch start is compared exactly, an hour off is dead" wait_for 10 test -e "$T/ran"
check "tz-reuse: that reclaim is logged" has "$LOG" "event=reclaim .*stale_pid=$$ stale_label=houroff"
reap "$PW"

# 1. The default lock lives under $HOME/GitHub/rigger-worktrees/suite-slot (HOME redirected to scratch).
setup default
unset SUITE_SLOT_DIR
HOME="$T/home" "$SLOT" dflt -- true
check "default slot dir is \$HOME/GitHub/rigger-worktrees/suite-slot" has "$T/home/GitHub/rigger-worktrees/suite-slot/suite-slot.log" "event=end label=dflt"

echo "# pass $PASS fail $FAIL"
[ "$FAIL" = 0 ]
