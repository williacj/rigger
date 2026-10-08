#!/bin/bash
# ABOUTME: Captures twenty original-base card 689 file runs and publishes only audited raw bytes.

set -euo pipefail
base="$RUNNER_TEMP/c689-evidence"
scratch="$RUNNER_TEMP/c615-tmp"
preload="$GITHUB_WORKSPACE/.github/evidence/c689-trace-preload.cjs"
auditor="$GITHUB_WORKSPACE/.github/evidence/audit.py"
trace_check="$GITHUB_WORKSPACE/.github/evidence/c689-trace-check.py"
mkdir -p "$base/raw" "$scratch"

parent=$(git rev-parse HEAD^)
head=$(git rev-parse HEAD)
if [ "$parent" != e770812ca43c395c980fd45081695d0ad1179812 ]; then
  printf 'BASE_VERIFY_BLOCKED parent_sha\n'
  exit 2
fi
if ! git diff --quiet "$parent" HEAD -- src/; then
  printf 'BASE_VERIFY_BLOCKED source_delta\n'
  exit 2
fi
expected_paths=$(printf '%s\n' .github/evidence/audit.py .github/evidence/c689-run.sh .github/evidence/c689-trace-check.py .github/evidence/c689-trace-preload.cjs .github/workflows/c689-evidence.yml test/never-stop.test.mjs | sort)
actual_paths=$(git diff --name-only "$parent" HEAD | sort)
if [ "$actual_paths" != "$expected_paths" ]; then
  printf 'BASE_VERIFY_BLOCKED path_inventory\n'
  exit 2
fi
if [ "$(git diff --numstat "$parent" HEAD -- test/never-stop.test.mjs)" != "$(printf '1\t0\ttest/never-stop.test.mjs')" ]; then
  printf 'BASE_VERIFY_BLOCKED existing_test_delta\n'
  exit 2
fi
if [ "$(git diff --unified=0 "$parent" HEAD -- test/never-stop.test.mjs | grep -Fxc "+  if (listing === 'omitted' && first === 'failed' && second === 'live') writeFileSync(join(directory, 'c689-trace-id'), '689');" || true)" -ne 1 ]; then
  printf 'BASE_VERIFY_BLOCKED trace_marker\n'
  exit 2
fi
if [ "$(git hash-object .github/evidence/audit.py)" != 968f149b318f4e4faf035752b83dc5cef03f95e3 ]; then
  printf 'BASE_VERIFY_BLOCKED audit_policy\n'
  exit 2
fi

gate() {
  local result
  if result=$("$@" 2>&1); then
    case "$result" in
      CARD615_AUDIT_PASS\ files=3|CARD615_AUDIT_SELF_TEST_PASS|CARD689_TRACE_PASS|CARD689_TRACE_SELF_TEST_PASS\ safe\ missing_end\ unpaired\ malformed)
        printf '%s\n' "$result"
        return ;;
      *) printf 'EVIDENCE_GATE_BLOCKED unexpected_output\n'; return 1 ;;
    esac
  fi
  case "$result" in
    CARD615_AUDIT_BLOCKED\ *|CARD689_TRACE_BLOCKED\ *)
      if [[ "$result" == *$'\n'* || "$result" == */* || "$result" == *\\* || "$result" == *@* ]]; then
        printf 'EVIDENCE_GATE_BLOCKED unsafe_diagnostic\n'
      else
        printf '%s\n' "$result"
      fi ;;
    *) printf 'EVIDENCE_GATE_BLOCKED execution\n' ;;
  esac
  return 1
}

gate python3 "$auditor" --self-test
gate python3 "$trace_check" --self-test
cpu=$(sysctl -n hw.logicalcpu)
check_load() {
  while :; do
    current=$(uptime)
    load=$(printf '%s\n' "$current" | sed 's/.*load averages: //' | awk '{print $1}')
    processes=$(ps -U "$(id -u)" | wc -l | tr -d ' ')
    admitted=$(awk -v load="$load" -v cpu="$cpu" -v processes="$processes" 'BEGIN { print (load <= 24 && load <= 2 * cpu && processes < 2000) ? "yes" : "no" }')
    if [ "$admitted" = yes ]; then return; fi
    printf 'LOAD_GATE_WAIT load=%s processes=%s cpu=%s\n' "$load" "$processes" "$cpu"
    sleep 10
  done
}

failures=0
for number in $(seq -w 1 20); do
  check_load
  run="$base/raw/r$number"
  mkdir "$run"
  {
    printf 'BASE %s\nWORKFLOW_HEAD %s\nRUN_ID r%s\n' "$parent" "$head" "$number"
    printf 'COMMAND npm test -- test/never-stop.test.mjs\n'
    printf 'START_LOAD %s\nCPU %s\nUSER_PROCESSES %s\n' "$current" "$cpu" "$processes"
  } > "$run/runner.log"
  if TMPDIR="$scratch" C689_TRACE_DIR="$run" NODE_OPTIONS="--require=$preload" npm test -- test/never-stop.test.mjs >> "$run/runner.log" 2>&1; then
    status=0
  else
    status=$?
    failures=$((failures + 1))
  fi
  printf 'END_LOAD %s\nEXIT %s\n' "$(uptime)" "$status" >> "$run/runner.log"
  gate python3 "$auditor" --manifest "$run" 689
  gate python3 "$auditor" --audit "$run" 689
  gate python3 "$trace_check" "$run/689.trace.jsonl"
  printf 'RUN_SAFE r%s exit=%s\n' "$number" "$status"
done

# No directory named public exists before every original complete file has passed.
mkdir "$base/public"
for number in $(seq -w 1 20); do
  if ! cp -R "$base/raw/r$number" "$base/public/r$number" 2>/dev/null; then
    printf 'COPY_BLOCKED r%s\n' "$number"
    exit 1
  fi
  gate python3 "$auditor" --audit "$base/public/r$number" 689
  gate python3 "$trace_check" "$base/public/r$number/689.trace.jsonl"
done
printf 'CAPTURE_SAFE twenty_runs=20 failed_runs=%s\n' "$failures"
