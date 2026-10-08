#!/bin/bash
# ABOUTME: Captures original-base process-state runs only after a safe real-read VM preflight.

set -euo pipefail
base="$RUNNER_TEMP/c615-evidence"
scratch="$RUNNER_TEMP/c615-tmp"
preload="$GITHUB_WORKSPACE/.github/evidence/trace-preload.cjs"
auditor="$GITHUB_WORKSPACE/.github/evidence/audit.py"
tests=(235 644 1024 1038 1270 1950 2001)
mkdir -p "$base/raw" "$scratch"

head=$(git rev-parse HEAD)
parent=$(git rev-parse HEAD^)
if [ "$parent" != e770812ca43c395c980fd45081695d0ad1179812 ]; then
  printf 'BASE_VERIFY_BLOCKED parent_sha\n'
  exit 2
fi
if ! git diff --quiet "$parent" HEAD -- src/; then
  printf 'BASE_VERIFY_BLOCKED source_delta\n'
  exit 2
fi
expected_paths=$(printf '%s\n' .github/evidence/audit.py .github/evidence/run.sh .github/evidence/trace-preload.cjs .github/workflows/c615-evidence.yml test/never-stop.test.mjs | sort)
actual_paths=$(git diff --name-only "$parent" HEAD | sort)
if [ "$actual_paths" != "$expected_paths" ]; then
  printf 'BASE_VERIFY_BLOCKED path_inventory\n'
  exit 2
fi
numstat=$(git diff --numstat "$parent" HEAD -- test/never-stop.test.mjs)
if [ "$numstat" != "$(printf '7\t0\ttest/never-stop.test.mjs')" ]; then
  printf 'BASE_VERIFY_BLOCKED existing_test_delta\n'
  exit 2
fi
markers=$(git diff --unified=0 "$parent" HEAD -- test/never-stop.test.mjs | grep -c '^+  writeFileSync(join(directory, .c615-trace-id.)' || true)
if [ "$markers" -ne 7 ]; then
  printf 'BASE_VERIFY_BLOCKED test_markers\n'
  exit 2
fi

python3 "$auditor" --self-test
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

check_load
preflight="$base/raw/preflight"
mkdir -p "$preflight"
{
  printf 'BASE %s\nWORKFLOW_HEAD %s\n' "$parent" "$head"
  printf 'SELECTED_TEST 1038\nSTART_LOAD %s\nCPU %s\nUSER_PROCESSES %s\n' "$current" "$cpu" "$processes"
} > "$preflight/runner.log"
if TMPDIR="$scratch" C615_TRACE_DIR="$preflight" NODE_OPTIONS="--require=$preload" npm test -- --test-name-pattern="given a dispatch.s directory holding a process the kill does not end" test/never-stop.test.mjs >> "$preflight/runner.log" 2>&1; then
  status=0
else
  status=$?
fi
printf 'END_LOAD %s\nEXIT %s\n' "$(uptime)" "$status" >> "$preflight/runner.log"
python3 "$auditor" --manifest "$preflight" 1038
python3 "$auditor" --audit "$preflight" 1038
printf 'PREFLIGHT_SAFE exit=%s\n' "$status"

failures=0
for number in $(seq -w 1 20); do
  check_load
  run="$base/raw/r$number"
  mkdir -p "$run"
  {
    printf 'BASE %s\nWORKFLOW_HEAD %s\n' "$parent" "$head"
    printf 'SELECTED_FILE test/never-stop.test.mjs\n'
    printf 'START_LOAD %s\nCPU %s\nUSER_PROCESSES %s\n' "$current" "$cpu" "$processes"
  } > "$run/runner.log"
  if TMPDIR="$scratch" C615_TRACE_DIR="$run" NODE_OPTIONS="--require=$preload" npm test -- test/never-stop.test.mjs >> "$run/runner.log" 2>&1; then
    status=0
  else
    status=$?
    failures=$((failures + 1))
  fi
  printf 'END_LOAD %s\nEXIT %s\n' "$(uptime)" "$status" >> "$run/runner.log"
  python3 "$auditor" --manifest "$run" "${tests[@]}"
  python3 "$auditor" --audit "$run" "${tests[@]}"
  printf 'RUN_SAFE r%s exit=%s\n' "$number" "$status"
done

mkdir -p "$base/public"
cp -R "$preflight" "$base/public/preflight"
python3 "$auditor" --audit "$base/public/preflight" 1038
for number in $(seq -w 1 20); do
  cp -R "$base/raw/r$number" "$base/public/r$number"
  python3 "$auditor" --audit "$base/public/r$number" "${tests[@]}"
done
printf 'CAPTURE_SAFE twenty_runs=%s failed_runs=%s\n' 20 "$failures"
# A measured test failure remains evidence and does not hide the audited artifact.
exit 0
