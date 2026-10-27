#!/bin/sh
# ABOUTME: Resumes a Codex maker session for one Rigger card with a follow-up message from the
# coordinator, under the same sandbox and network as codex-maker.sh; appends to the card's log.
# Usage: codex-resume.sh <card> <session-id> <message-file>
# Run it from the main checkout, never from a card's clone or a directory under the engine's
# worktree root.
# RIGGER_WORKTREE_ROOT (default $HOME/GitHub/rigger-worktrees) holds the card's clone,
# codex-<card>, and its temporary directory, codex-<card>-tmp, which codex-maker.sh made.
# CODEX_LOG_DIR (default $RIGGER_WORKTREE_ROOT/coordinator-logs) holds the log it appends to.
set -eu
card="$1"; session="$2"; msg="$(cd "$(dirname "$3")" && pwd)/$(basename "$3")"
root="${RIGGER_WORKTREE_ROOT:-$HOME/GitHub/rigger-worktrees}"
work="$root/codex-$card"; tmp="$root/codex-$card-tmp"
S="${CODEX_LOG_DIR:-$root/coordinator-logs}"; mkdir -p "$S"
cd "$work"
TMPDIR="$tmp" exec codex exec resume --json \
  -c sandbox_mode='"danger-full-access"' \
  -c model_reasoning_effort='"high"' "$session" - < "$msg" >> "$S/codex-$card.jsonl" 2>&1
echo "codex exit $? log $S/codex-$card.jsonl"
