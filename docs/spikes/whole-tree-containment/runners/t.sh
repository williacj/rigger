#!/bin/bash
# ABOUTME: t.sh <hostlabel> <command string>: runs command via bash -c locally, logs UTC time, host, command, output to transcript
T=$HOME/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/transcript.md
h="$1"; shift; c="$*"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
out=$(bash -c "$c" 2>&1); rc=$?
{ printf '\n### %s  host=%s  (issued from laptop)\n```\n$ %s\n```\n```\n%s\n[exit %s]\n```\n' "$ts" "$h" "$c" "$out" "$rc"; } >> "$T"
printf '%s\n[exit %s]\n' "$out" "$rc"
