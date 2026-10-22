#!/bin/bash
# ABOUTME: Runs a command in the one host-wide test slot, once one-minute load is <= 24 (O46).
# Usage: suite-slot.sh <label> -- <command> [args...]. Lock, log and the first-come-first-served
# queue of waiters live in $SUITE_SLOT_DIR, by default suite-slot under $RIGGER_WORKTREE_ROOT, whose
# own default is $HOME/GitHub/rigger-worktrees.
# Exits with the command's status (128+N for signal N); 2 usage; 71 cannot record or take the
# lock; 75 load average unreadable after retries; 128+N if the wrapper itself gets signal N.

usage() { echo "usage: suite-slot.sh <label> -- <command> [args...]" >&2; exit 2; }
[ $# -ge 3 ] && [ "$2" = "--" ] && [ -n "$1" ] || usage
LABEL=$1; shift 2

DIR=${SUITE_SLOT_DIR:-${RIGGER_WORKTREE_ROOT:-$HOME/GitHub/rigger-worktrees}/suite-slot}
LOCK=$DIR/lock; LOG=$DIR/suite-slot.log; CAND=$DIR/.cand.$$; RECLAIM=$DIR/reclaim.d
QUEUE=$DIR/queue
MAX=${SUITE_SLOT_MAX_LOAD:-24}; POLL=${SUITE_SLOT_POLL:-5}; TRIES=3
mkdir -p "$DIR" || exit 71

iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
lstart() { local s; s=$(ps -o lstart= -p "$1" 2>/dev/null) || return 1; echo $s; }
# epoch <lstart text>: that wall-clock time read as UTC, in seconds; fails if it does not parse.
epoch() { LC_ALL=C TZ=UTC date -j -f '%a %b %d %T %Y' "$*" +%s 2>/dev/null; }
# pstart <pid>: the process's start in seconds since the epoch, whatever the host's timezone.
pstart() { local s; s=$(LC_ALL=C TZ=UTC ps -o lstart= -p "$1" 2>/dev/null) && [ -n "$s" ] && epoch $s; }
field() { printf '%s\n' "$2" | sed -n "s/^$1=//p"; }
# gone <pid or -pgid>: true only on ESRCH, so "not permitted" or any other failure means present.
gone() { perl -e 'exit(kill(0, $ARGV[0]) ? 1 : $!{ESRCH} ? 0 : 1)' -- "$1"; }
load() {
  { if [ -n "$SUITE_SLOT_LOAD_CMD" ]; then sh -c "$SUITE_SLOT_LOAD_CMD"; else sysctl -n vm.loadavg; fi; } 2>/dev/null |
    tr -c '0-9.\n' ' ' | awk '{ print $1; exit }'
}
log() { # log <event> [extra]
  printf '%s event=%s label=%s pid=%s load=%s cwd=%s cmd=%s%s\n' \
    "$(iso)" "$1" "$LABEL" "$$" "$(load)" "$PWD" "$CMD" "${2:+ $2}" >> "$LOG"
}
# dead <holder record>: positive evidence the holder is gone. The command's group is gone (or was
# never recorded) and the wrapper's pid is gone, or ps shows that pid with another start time.
# A timezone change alone is never evidence: start= is compared exactly in epoch seconds, and a
# record without it holds lstart in its writer's local zone, so it is the same process when it
# differs from the true start by a whole zone offset (15-minute steps from -12h to +14h).
dead() {
  local p pg rec st cur w; p=$(field pid "$1"); pg=$(field pgid "$1"); rec=$(field lstart "$1")
  st=$(field start "$1")
  [ -n "$pg" ] && ! gone "-$pg" && return 1
  [ -z "$p" ] || gone "$p" && return 0
  cur=$(pstart "$p") || return 1
  [ -n "$st" ] && { [ "$st" != "$cur" ]; return; }
  [ -n "$rec" ] || return 1
  w=$(epoch $rec) || { cur=$(lstart "$p") && [ -n "$cur" ] && [ "$cur" != "$rec" ]; return; }
  [ $(( (w - cur) % 900 )) != 0 ] || [ $(( w - cur )) -lt -43200 ] || [ $(( w - cur )) -gt 50400 ]
}
nap() { sleep "$POLL" & SLEEPER=$!; wait $SLEEPER; SLEEPER=; }
tickets() { ls "$QUEUE" 2>/dev/null | sort -n; }
# enqueue: link our record into the queue as one more than the highest ticket, so a caller that
# arrives while anyone waits, including one that has just released, lines up behind them all.
enqueue() {
  local n misses=0
  mkdir -p "$QUEUE" || exit 71
  until n=$(tickets | awk '{ n = $1 } END { print n + 1 }'); ln "$CAND" "$QUEUE/$n" 2>/dev/null; do
    [ -e "$QUEUE/$n" ] && continue  # another caller took that number first
    misses=$((misses + 1))
    [ "$misses" -ge 20 ] && { echo "suite-slot: cannot create $QUEUE/$n" >&2; log abort "error=no-ticket"; exit 71; }
    nap
  done
  TICKET=$QUEUE/$n
  log queue "ticket=$n ahead=$(tickets | awk -v n="$n" '$1 < n { k++ } END { print k + 0 }')"
}

CMD="$*"; HELD=$(cat "$LOCK" 2>/dev/null)
if [ -n "$SUITE_SLOT_HELD" ] && [ "$(field token "$HELD")" = "$SUITE_SLOT_HELD" ] && ! dead "$HELD"; then
  log nested "holder=$(field label "$HELD")"
  exec "$@"
fi

TOKEN="$$.$(date +%s).$RANDOM"; CHILD=; SLEEPER=; START=; RECLAIMING=; PRE=; TICKET=
release() {
  [ -n "$SLEEPER" ] && kill "$SLEEPER" 2>/dev/null
  [ "$(field token "$(cat "$LOCK" 2>/dev/null)")" = "$TOKEN" ] && rm -f "$LOCK"
  [ -n "$RECLAIMING" ] && rmdir "$RECLAIM" 2>/dev/null
  rm -f "$CAND" "$DIR/.pg.$$" ${TICKET:+"$TICKET"}
}
on_signal() { # on_signal <name> <number>
  trap '' INT TERM HUP
  [ -z "$CHILD" ] && [ -n "$START" ] && [ "$!" != "$PRE" ] && CHILD=$!
  if [ -n "$CHILD" ]; then
    # No group yet means the launcher has not reached setpgrp, so it has not run the command.
    if gone "-$CHILD"; then kill -KILL "$CHILD"; else kill -"$1" -- -"$CHILD"; fi 2>/dev/null
    wait "$CHILD" 2>/dev/null
  fi
  if [ -n "$START" ]; then log end "status=$((128 + $2)) signal=$1 duration=$(( $(date +%s) - START ))s"
  else log abort "signal=$1"; fi
  release; exit $((128 + $2))
}
trap release EXIT
trap 'on_signal INT 2' INT; trap 'on_signal TERM 15' TERM; trap 'on_signal HUP 1' HUP

log wait
# Without our own start time no waiter could ever tell a dead holder from pid reuse; refuse.
for _ in $(seq $TRIES); do
  MYSTART=$(lstart $$) && [ -n "$MYSTART" ] && MYEPOCH=$(pstart $$) && break; MYSTART=; nap
done
[ -n "$MYSTART" ] || { echo "suite-slot: cannot read this wrapper's start time (ps -o lstart)" >&2
  log abort "error=no-lstart"; exit 71; }
# lstart stays in local time for wrappers that predate start=, which compare it as text.
REC=$(printf 'token=%s\npid=%s\nlstart=%s\nstart=%s\nlabel=%s\nsince=%s' "$TOKEN" "$$" "$MYSTART" "$MYEPOCH" "$LABEL" "$(iso)")
# A SIGKILLed wrapper with our pid can leave .cand linked as a ticket or the lock. Unlink the name
# first so our record goes into a fresh inode and never rewrites that orphan's.
rm -f "$CAND"; printf '%s\n' "$REC" > "$CAND" || exit 71
enqueue; SHOWN=; MISSES=0
# Only the head ticket may take the lock. A waiter ahead is skipped only on positive evidence
# of its death, by the same test as a holder, so a SIGKILLed waiter never blocks the queue.
until [ "$(tickets | head -1)" = "${TICKET##*/}" ] && ln "$CAND" "$LOCK" 2>/dev/null; do
  [ -e "$TICKET" ] || { enqueue; continue; }
  HEAD=$(tickets | head -1)
  if [ "$HEAD" != "${TICKET##*/}" ]; then
    if AHEAD=$(cat "$QUEUE/$HEAD" 2>/dev/null) && dead "$AHEAD"; then
      [ "$(cat "$QUEUE/$HEAD" 2>/dev/null)" = "$AHEAD" ] && rm -f "$QUEUE/$HEAD" &&
        log skip "stale_pid=$(field pid "$AHEAD") stale_label=$(field label "$AHEAD") ticket=$HEAD"
      continue
    fi
    if [ -n "$AHEAD" ] && [ "$SHOWN" != "$AHEAD" ]; then
      SHOWN=$AHEAD
      echo "suite-slot: $LABEL waiting; queued behind $(field label "$AHEAD") (pid $(field pid "$AHEAD")) since $(field since "$AHEAD")" >&2
    fi
    nap; continue
  fi
  if ! HELD=$(cat "$LOCK" 2>/dev/null); then
    # ln failed with no readable lock: released just now, or something is broken. Don't spin.
    MISSES=$((MISSES + 1))
    [ "$MISSES" -ge 20 ] && { echo "suite-slot: cannot create or read $LOCK" >&2; log abort "error=no-lock"; exit 71; }
    nap; continue
  fi
  MISSES=0
  if dead "$HELD"; then
    if mkdir "$RECLAIM" 2>/dev/null; then
      RECLAIMING=1
      [ "$(cat "$LOCK" 2>/dev/null)" = "$HELD" ] && rm -f "$LOCK" &&
        log reclaim "stale_pid=$(field pid "$HELD") stale_label=$(field label "$HELD")"
      rmdir "$RECLAIM"; RECLAIMING=
      continue
    fi
    # A reclaimer killed mid-reclaim leaves its directory behind; clear it after a minute.
    [ $(( $(date +%s) - $(stat -f %m "$RECLAIM" 2>/dev/null || date +%s) )) -gt 60 ] && rmdir "$RECLAIM" 2>/dev/null
  elif [ "$SHOWN" != "$HELD" ]; then
    SHOWN=$HELD
    echo "suite-slot: $LABEL waiting; slot held by $(field label "$HELD") (pid $(field pid "$HELD")) since $(field since "$HELD")" >&2
  fi
  nap
done
rm -f "$CAND" "$TICKET"; TICKET=

FAILS=0
while L=$(load); ! awk -v l="$L" -v m="$MAX" 'BEGIN { exit !(l != "" && l + 0 <= m + 0) }'; do
  if [ -z "$L" ]; then
    FAILS=$((FAILS + 1))
    [ "$FAILS" -ge "$TRIES" ] && { echo "suite-slot: cannot read the load average" >&2; log end "status=75 error=no-load"; exit 75; }
  else
    FAILS=0; echo "suite-slot: $LABEL holds the slot; waiting for load $L to fall to $MAX" >&2
  fi
  nap
done

export SUITE_SLOT_HELD=$TOKEN
START=$(date +%s); log start; PRE=$!
# The launcher takes its own process group, restores default SIGINT/SIGQUIT, and execs the
# command only once the lock records that group, so a command never runs unrecorded. If the
# wrapper dies first, the launcher exits without running it.
perl -e '$SIG{INT} = $SIG{QUIT} = "DEFAULT"; setpgrp(0, 0);
  my ($lock, $parent) = splice @ARGV, 0, 2;
  sub recorded { open(my $f, "<", $lock) or return 0; return scalar grep { $_ eq "pgid=$$\n" } <$f> }
  until (recorded()) { exit 125 if getppid() != $parent; select(undef, undef, undef, 0.01) }
  exec { $ARGV[0] } @ARGV or do { print STDERR "suite-slot: $ARGV[0]: $!\n"; exit 127 }' \
  "$LOCK" "$$" "$@" <&0 &
CHILD=$!
until ! gone "-$CHILD" || gone "$CHILD"; do sleep 0.01; done
printf '%s\npgid=%s\n' "$REC" "$CHILD" > "$DIR/.pg.$$" && mv -f "$DIR/.pg.$$" "$LOCK"
wait "$CHILD" 2>/dev/null; ST=$?  # bash would print "Killed: 9" to our stderr
log end "status=$ST duration=$(( $(date +%s) - START ))s"
exit "$ST"
