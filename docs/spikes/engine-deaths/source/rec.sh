#!/bin/bash
# ABOUTME: Records one command for #1462: its UTC times, exact argv and exit in record.txt, and its
# full output under runs/, or under SPIKE_RUNS where that is set, numbered by the files there or
# by SPIKE_N. A value held in SPIKE_SOURCE, SPIKE_ARCHIVE or SPIKE_DIGEST is a private
# identifier, and is written to the record as a fixed placeholder as it is captured.
set -u
here=$(cd "$(dirname "$0")" && pwd)
runs=${SPIKE_RUNS:-$here/runs}
n=${SPIKE_N:-$(printf '%03d' $(( $(ls "$runs" | wc -l) + 1 )))}
shown=
for arg in "$@"; do
  case $arg in
    "${SPIKE_SOURCE:-//}") arg='<source>' ;;
    "${SPIKE_ARCHIVE:-//}") arg='<archive>' ;;
    "${SPIKE_DIGEST:-//}") arg='<digest>' ;;
  esac
  shown="$shown $(printf '%q' "$arg" | sed 's/\\</</; s/\\>/>/')"
done
start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
"$@" > "$runs/$n.txt" 2>&1
status=$?
printf '### run %s\nstart %s\ncommand%s\nexit %s\nend %s\n\n' "$n" "$start" "$shown" "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$here/record.txt"
cat "$runs/$n.txt"
exit $status
