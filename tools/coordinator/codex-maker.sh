#!/bin/sh
# ABOUTME: Runs the Codex CLI as the maker for one Rigger card, in its own fresh clone outside the
# checkout, with network on so it can push and open a pull request; writes its JSON stream to a log.
# Usage: codex-maker.sh <card> <branch>
# Run it from the main checkout, never from a card's clone or a directory under the engine's
# worktree root.
# MAKER_NOTE appends a coordinator note to the prompt.
# RIGGER_WORKTREE_ROOT (default $HOME/GitHub/rigger-worktrees) holds the clone, codex-<card>, and
# its temporary directory, codex-<card>-tmp.
# RIGGER_REPO_URL (default https://github.com/williacj/rigger.git) is the repository it clones.
# CODEX_LOG_DIR (default $RIGGER_WORKTREE_ROOT/coordinator-logs) holds its log and prompt copy.
set -eu
card="$1"; branch="$2"
root="${RIGGER_WORKTREE_ROOT:-$HOME/GitHub/rigger-worktrees}"
work="$root/codex-$card"
tmp="$root/codex-$card-tmp"
S="${CODEX_LOG_DIR:-$root/coordinator-logs}"; mkdir -p "$S"
log="$S/codex-$card.jsonl"
[ -e "$work" ] || git clone -q "${RIGGER_REPO_URL:-https://github.com/williacj/rigger.git}" "$work"
mkdir -p "$tmp"
git -C "$work" config core.hooksPath .githooks
git -C "$work" fetch -q origin
git -C "$work" rev-parse --verify -q "$branch" >/dev/null || git -C "$work" checkout -q -b "$branch" origin/main
sed -e "s|@CARD@|$card|g" -e "s|@BRANCH@|$branch|g" -e "s|@TMP@|$tmp|g" -e "s|@SLOT@|$(cd "$(dirname "$0")" && pwd)/suite-slot.sh|g" "$(dirname "$0")/codex-maker-prompt.md" > "$S/codex-$card-prompt.md"
if [ -n "${MAKER_NOTE:-}" ]; then
  printf '\n%s\n' "$MAKER_NOTE" >> "$S/codex-$card-prompt.md"
fi
cd "$work"
TMPDIR="$tmp" exec codex exec --json -C "$work" --add-dir "$tmp" \
  --sandbox danger-full-access \
  -c model_reasoning_effort='"high"' - < "$S/codex-$card-prompt.md" > "$log" 2>&1
echo "codex exit $? log $log"
