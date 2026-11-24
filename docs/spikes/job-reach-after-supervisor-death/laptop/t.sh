#!/bin/bash
# ABOUTME: Card #1460 transcript wrapper: t.sh <host> '<command>'; runs the command string with bash -c on the laptop and
# appends its exact text, host, UTC start and end, full output and exit status to transcript.txt.
D="$(cd "$(dirname "$0")" && pwd)"
T="$D/transcript.txt"
host="$1"; cmd="$2"
now() { node -e 'process.stdout.write(new Date().toISOString())'; }
n=$(( $(grep -c '^=== entry ' "$T" 2>/dev/null || echo 0) + 1 ))
start=$(now)
{
  printf '=== entry %d start=%s host=%s\n' "$n" "$start" "$host"
  printf '$ %s\n' "$cmd"
  printf -- '--- output\n'
} >> "$T"
out=$(mktemp "$D/out.XXXXXX")
bash -c "$cmd" > "$out" 2>&1
rc=$?
cat "$out" >> "$T"
end=$(now)
printf -- '--- exit=%d end=%s\n\n' "$rc" "$end" >> "$T"
printf '[entry %d start=%s end=%s exit=%d]\n' "$n" "$start" "$end" "$rc"
cat "$out"
rm -f "$out"
exit $rc
