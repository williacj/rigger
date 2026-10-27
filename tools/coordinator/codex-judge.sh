#!/bin/sh
# ABOUTME: Runs the Codex CLI as one judge on one Rigger pull request at its current head, in a fresh
# clone detached at that head whose push URL is disabled; writes its JSON stream to a log.
# Usage: codex-judge.sh <pr> <card> <round>
# The judge brief is a comment on a record issue: JUDGE_BRIEF names its id, defaulting to the M5
# judge brief on #642.
# JUDGE_ROLE names the role prompt the judge reads (default reviewer); it is part of the scratch name.
# JUDGE_NOTE appends a coordinator note to the prompt.
# NO_SUITE=1 tells the judge not to run the full suite (C16).
# NO_POST=1 makes a dry run: the judge writes its verdict file and posts nothing.
# Run it from the main checkout, never from a card's clone or a directory under the engine's
# worktree root.
# RIGGER_WORKTREE_ROOT (default $HOME/GitHub/rigger-worktrees) holds the round's directory,
# judge-<pr>-codex-r<round> or judge-<pr>-codex-<role>-r<round>, with the clone in its repo.
# RIGGER_REPO_URL (default https://github.com/williacj/rigger.git) is the repository it clones.
# CODEX_LOG_DIR (default $RIGGER_WORKTREE_ROOT/coordinator-logs) holds its log and prompt copy.
set -eu
pr="$1"; card="$2"; round="$3"
brief="${JUDGE_BRIEF:-6007255976}"; role="${JUDGE_ROLE:-reviewer}"
root="${RIGGER_WORKTREE_ROOT:-$HOME/GitHub/rigger-worktrees}"
base="$root/judge-$pr-codex-$role-r$round"; [ "$role" = reviewer ] && base="$root/judge-$pr-codex-r$round"
work="$base/repo"; tmp="$base/tmp"
tools="$(cd "$(dirname "$0")" && pwd)"
S="${CODEX_LOG_DIR:-$root/coordinator-logs}"; mkdir -p "$S" "$tmp"
tag="judge-$pr-codex-r$round"; [ "$role" = reviewer ] || tag="judge-$pr-codex-$role-r$round"; log="$S/$tag.jsonl"
if [ ! -e "$work" ]; then
  n=0
  until git clone -q "${RIGGER_REPO_URL:-https://github.com/williacj/rigger.git}" "$work"; do
    n=$((n + 1)); [ "$n" -ge 3 ] && exit 1; rm -rf "$work"; sleep 10
  done
fi
sha=$(gh pr view "$pr" -R williacj/rigger --json headRefOid -q .headRefOid)
git -C "$work" fetch -q origin "pull/$pr/head"
git -C "$work" checkout -q --detach "$sha"
git -C "$work" remote set-url --push origin "judge-never-pushes"
git -C "$work" config core.hooksPath .githooks
accrev=$(gh issue view "$card" -R williacj/rigger --json body -q .body | shasum -a 256 | cut -c1-12)
sed -e "s|@PR@|$pr|g" -e "s|@CARD@|$card|g" -e "s|@ROUND@|$round|g" -e "s|@SHA@|$sha|g" \
    -e "s|@ACCREV@|$accrev|g" -e "s|@BASE@|$base|g" -e "s|@TMP@|$tmp|g" \
    -e "s|@BRIEF@|$brief|g" -e "s|@ROLE@|$role|g" -e "s|@SLOT@|$tools/suite-slot.sh|g" \
    "$tools/codex-judge-prompt.md" > "$S/$tag-prompt.md"
if [ -n "${JUDGE_NOTE:-}" ]; then
  printf '\n%s\n' "$JUDGE_NOTE" >> "$S/$tag-prompt.md"
fi
if [ -n "${NO_SUITE:-}" ]; then
  printf '\n%s\n' "**No full suite this run (coordinator's call C16).** Another judge runs the fresh-clone suite. Run only named test files (\`npm test -- <file>\`) and guarded mutations of named files, directly and not through \`suite-slot.sh\` (C50), and take the full-suite evidence from CI and the PR body." >> "$S/$tag-prompt.md"
fi
if [ -n "${NO_POST:-}" ]; then
  printf '\n%s\n' "**Dry run.** This run checks the judge's output format only. Do not post anything to GitHub: write the verdict file, then skip the post step and finish with your report." >> "$S/$tag-prompt.md"
fi
cd "$work"
TMPDIR="$tmp" exec codex exec --json -C "$work" --add-dir "$base" \
  --sandbox danger-full-access \
  -c model_reasoning_effort='"high"' - < "$S/$tag-prompt.md" > "$log" 2>&1
