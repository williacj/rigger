#!/bin/sh
# ABOUTME: Runs one Codex launcher and re-runs it every CODEX_RETRY_WAIT seconds, up to 6 times, while
# the last lines of its log show "Selected model is at capacity". A maker whose session already
# started is resumed.
# Usage: codex-retry.sh <log> <launcher> [args...]
# Runs from this tools directory in the main checkout, never from a card's clone or a directory under
# the engine's worktree root, so a sweep of a clone's directory cannot reach it.
# Writes the pid of each attempt's child to <log>.pid, so the coordinator kills only that pid.
# CODEX_RETRY_WAIT (default 300) is the wait between attempts, in seconds.
# CODEX_LOG_DIR (default $RIGGER_WORKTREE_ROOT/coordinator-logs) holds a resumed maker's continue
# message; RIGGER_WORKTREE_ROOT defaults to $HOME/GitHub/rigger-worktrees.
set -u
log="$1"; shift
tools="$(cd "$(dirname "$0")" && pwd)"
cd "$tools"
tries=0
while :; do
  "$@" &
  child=$!
  echo "$child" > "$log.pid"
  wait "$child"
  code=$?
  if ! tail -n 5 "$log" 2>/dev/null | grep -q 'Selected model is at capacity'; then
    echo "codex-retry: exit $code, log $log"
    exit "$code"
  fi
  tries=$((tries + 1))
  if [ "$tries" -gt 6 ]; then
    echo "codex-retry: still at capacity after 6 retries, log $log"
    exit 75
  fi
  echo "codex-retry: at capacity, retry $tries of 6 in 300 s" >&2
  sleep "${CODEX_RETRY_WAIT:-300}"
  # A maker whose session started resumes that session instead of starting over.
  case "$1" in
    *codex-maker.sh)
      thread=$(grep -o '"thread_id":"[^"]*"' "$log" | tail -n 1 | cut -d'"' -f4)
      if [ -n "$thread" ]; then
        card="$2"
        msg="${CODEX_LOG_DIR:-${RIGGER_WORKTREE_ROOT:-$HOME/GitHub/rigger-worktrees}/coordinator-logs}/codex-$card-continue.md"
        printf '%s\n' "Your last turn failed because the model was at capacity. Continue the card from where you stopped, under the same instructions." > "$msg"
        set -- "$tools/codex-resume.sh" "$card" "$thread" "$msg"
      fi
      ;;
  esac
done
