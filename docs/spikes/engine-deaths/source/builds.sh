#!/bin/bash
# ABOUTME: Throwaway for #1462: at each Rigger commit named, prints the source lines that emit the events
# the count reads, so the conditions can be compared across the builds whose records it reads.
set -euo pipefail
for commit in "$@"; do
  printf '== %s %s\n' "$commit" "$(git log -1 --format=%cI "$commit")"
  git show "$commit:src/execution/run.mjs" | grep -E "events\.emit\('dispatch\.start'|events\.emit\('dispatch\.end'|record\('dispatch\.(timeout|end)'|fields\.kept = |const fields = \{ \.\.\.ending" | sed 's/^ *//'
  git show "$commit:src/scheduling/loop.mjs" | grep -E "record\('(pull|slot\.release|run\.start|trigger)'|emit\('dispatch'" | sed 's/^ *//'
  git show "$commit:src/scheduling/lane.mjs" | grep -E "record\('merge\.(start|end)'" | sed 's/^ *//'
  git show "$commit:src/substrate/process.mjs" | grep -cE "'recorded\.killed'" | sed 's/^/recorded.killed sites: /'
  git show "$commit:src/substrate/process.mjs" | grep -E "return \{ exit: (child|signalled|ending)" | sed 's/^ *//'
done
