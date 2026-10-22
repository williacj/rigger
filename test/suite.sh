#!/bin/sh
# ABOUTME: Runs the deterministic and host test tiers through `node --test` with a refusing,
# recording `gh` first on PATH, so no test that inherits the suite's PATH reaches the real forge,
# and a run in which any test called it fails. It does the same for `claude` and `codex`, so no
# test reaches a real agent session either.
#
# Placement and shape are the architect's ruling on #276
# (https://github.com/williacj/rigger/issues/276#issuecomment-5835306379). After its mode
# switches, arguments go to `node --test`, which alone decides what counts as a test (`D16` rule 1).
#
# The refusing `gh` records beside itself, in the directory its own path names, and not to a path
# passed in the environment. So a child whose environment was rebuilt around an inherited PATH
# still records. No path is written into its source, so no character a temporary directory's
# name can hold breaks its quoting. A test whose caller is handed a refusal can still pass, so the
# record is what fails the run.

set -u
unset NODE_TEST_CONTEXT

# These three lists implement the file placements in #816, Part 2. The last two shrink as
# their cards convert and split tests. An entry must name the file that still exists.
host_tests='
test/codex-judge-shell.test.mjs
test/command-gate-hook.test.mjs
test/demo.test.mjs
test/directory-census.test.mjs
test/dispatch.test.mjs
test/doctor-claude-live.test.mjs
test/event-sink.test.mjs
test/exit-cleanup.test.mjs
test/forge-runners.test.mjs
test/forge-spawn.test.mjs
test/guard-probe-kill.test.mjs
test/init.test.mjs
test/judge-head-live.test.mjs
test/kill-recorded.test.mjs
test/listing-stand-in.test.mjs
test/maker-dispatch.test.mjs
test/never-stop.test.mjs
test/package.test.mjs
test/process-adapter.test.mjs
test/process-fixtures.test.mjs
test/process-table.test.mjs
test/provider-claude-installed-live.test.mjs
test/provider-claude-live.test.mjs
test/provider-claude-reach-live.test.mjs
test/provider-codex-live.test.mjs
test/push-hook.test.mjs
test/read-deadline.test.mjs
test/record-commit.test.mjs
test/restart-concurrency.test.mjs
test/restart-kill.test.mjs
test/stand-in-agent.test.mjs
test/step-restart-kill.test.mjs
test/suite-reaper.test.mjs
test/suite-record.test.mjs
test/suite-tiers.test.mjs
test/verb-forge-kill.test.mjs
test/workflow-files.test.mjs
test/worktrees.test.mjs
'
awaiting_tests='
test/codex-judge-shell.test.mjs
test/command-gate-hook.test.mjs
test/demo.test.mjs
test/directory-census.test.mjs
test/dispatch.test.mjs
test/doctor-claude-live.test.mjs
test/event-sink.test.mjs
test/exit-cleanup.test.mjs
test/forge-runners.test.mjs
test/forge-spawn.test.mjs
test/guard-probe-kill.test.mjs
test/init.test.mjs
test/judge-head-live.test.mjs
test/kill-recorded.test.mjs
test/listing-stand-in.test.mjs
test/maker-dispatch.test.mjs
test/never-stop.test.mjs
test/package.test.mjs
test/process-adapter.test.mjs
test/process-fixtures.test.mjs
test/provider-claude-installed-live.test.mjs
test/provider-claude-live.test.mjs
test/provider-claude-reach-live.test.mjs
test/provider-codex-live.test.mjs
test/push-hook.test.mjs
test/read-deadline.test.mjs
test/record-commit.test.mjs
test/restart-concurrency.test.mjs
test/restart-kill.test.mjs
test/stand-in-agent.test.mjs
test/step-restart-kill.test.mjs
test/suite-reaper.test.mjs
test/suite-record.test.mjs
test/verb-forge-kill.test.mjs
test/workflow-files.test.mjs
test/worktrees.test.mjs
'
converting_tests='
test/absorption-check.test.mjs
test/attempt.test.mjs
test/budget-checks.test.mjs
test/build-test-matrix.test.mjs
test/cli.test.mjs
test/command-gate.test.mjs
test/doctor.test.mjs
test/environment-retry.test.mjs
test/facts-pull.test.mjs
test/fake-gh.test.mjs
test/foreground-suite-settle.test.mjs
test/forge-board-sharing.test.mjs
test/forge-contract.test.mjs
test/forge-priority.test.mjs
test/forge-read.test.mjs
test/gate-check.test.mjs
test/git-environment.test.mjs
test/judge-directory.test.mjs
test/judge-dispatch.test.mjs
test/judge-head-cleanup.test.mjs
test/lane.test.mjs
test/loop-world.test.mjs
test/loop.test.mjs
test/mixed-judges.test.mjs
test/once.test.mjs
test/package-budget.test.mjs
test/plan.test.mjs
test/provider-codex.test.mjs
test/provider-contract.test.mjs
test/pull-outcomes.test.mjs
test/redo-settle.test.mjs
test/report.test.mjs
test/restart.test.mjs
test/retry.test.mjs
test/role-dispatch.test.mjs
test/run.test.mjs
test/scratch-teardown.test.mjs
test/self-hosting-check.test.mjs
test/settle.test.mjs
test/setup-board.test.mjs
test/spec-style-lint.test.mjs
test/stand-in-warming.test.mjs
test/step-run.test.mjs
test/temporary-directory.test.mjs
test/transitions.test.mjs
test/verb-facts.test.mjs
test/verbs-judges.test.mjs
test/verbs-provision.test.mjs
test/verdict-forge.test.mjs
test/verdict-input.test.mjs
test/verdict-surface.test.mjs
test/verdict-terminal.test.mjs
test/verdict.test.mjs
test/workspace.test.mjs
test/worktree-root-inside.test.mjs
'

validate_list() {
  list_name=$1
  shift
  for entry do
    if [ ! -f "$entry" ]; then
      printf '%s\n' "npm test: $list_name list names missing $entry" >&2
      exit 1
    fi
  done
}
validate_list host $host_tests
validate_list awaiting $awaiting_tests
validate_list converting $converting_tests
if [ "${1-}" = --list ]; then
  case ${2-} in
    host) set -- $host_tests ;;
    awaiting) set -- $awaiting_tests ;;
    converting) set -- $converting_tests ;;
    *) printf '%s\n' 'usage: sh test/suite.sh --list host|awaiting|converting' >&2; exit 2 ;;
  esac
  printf '%s\n' "$@"
  exit 0
fi

suite_mode=deterministic
node_flags=
if [ "${1-}" = --host ]; then
  suite_mode=host
  node_flags=--test-concurrency=1
  shift
fi
if [ "$suite_mode" = host ]; then
  major=$(node -p 'process.versions.node.split(".")[0]') || exit 1
  if [ "${GITHUB_ACTIONS-}" = true ]; then
    RIGGER_SUITE_HOST_KEY="${ImageOS}-${ImageVersion}-${RUNNER_ARCH}-node$major"
  else
    RIGGER_SUITE_HOST_KEY="macos-$(sw_vers -productVersion)-$(uname -m)-node$major"
  fi
  export RIGGER_SUITE_HOST_KEY
fi
RIGGER_SUITE_MODE=$suite_mode
RIGGER_SUITE_HOST_FILES=$host_tests
RIGGER_SUITE_AWAITING_FILES=$awaiting_tests
RIGGER_SUITE_CONVERTING_FILES=$converting_tests
export RIGGER_SUITE_MODE RIGGER_SUITE_HOST_FILES RIGGER_SUITE_AWAITING_FILES RIGGER_SUITE_CONVERTING_FILES


# Keep Mac control originals beside, not inside, the suite's disposable TMPDIR.
suite_caller_tmpdir=$(cd "${TMPDIR:-/tmp}" && pwd -P) || exit 1
suite_auto_evidence_root=
cleanup_auto_evidence_root() {
  if [ -n "$suite_auto_evidence_root" ]; then
    rmdir "$suite_auto_evidence_root" 2>/dev/null || :
  fi
}
trap cleanup_auto_evidence_root EXIT
if [ "${C615_EVIDENCE_ROOT+x}" != x ]; then
  C615_EVIDENCE_ROOT=$(mktemp -d "$suite_caller_tmpdir/c615-suite-evidence.XXXXXX") || exit 1
  suite_auto_evidence_root=$C615_EVIDENCE_ROOT
  chmod 700 "$suite_auto_evidence_root" || exit 1
  export C615_EVIDENCE_ROOT
fi

run=$(mktemp -d "${TMPDIR:-/tmp}/rigger-suite.XXXXXX") || exit 1
run=$(cd "$run" && pwd -P) || exit 1
TMPDIR=$run
export TMPDIR
allowed="$run/allowed"
mkdir "$allowed" || exit 1
ln -s /usr/bin/git "$allowed/git" || exit 1
ln -s /usr/bin/tar "$allowed/tar" || exit 1
RIGGER_SUITE_ALLOWED_PATH=$allowed
export RIGGER_SUITE_ALLOWED_PATH
dir="$run/rigger-refusing-gh"
mkdir "$dir" || exit 1
trap 'rm -rf "$run"' EXIT
trap 'rm -rf "$run"; cleanup_auto_evidence_root' EXIT

# PATH holds this directory as one entry, so it is named absolutely: a relative entry finds
# nothing from a child working elsewhere. PATH splits its entries at `:`, so a name holding one
# would be no entry at all, and the run stops before any test does.
dir=$(cd "$dir" && pwd -P) || exit 1
case $dir in
  *:*)
    printf '%s\n' "npm test: the temporary directory $dir holds a ':', so PATH cannot name it and no test would meet the refusing gh (#276). Set TMPDIR to a directory without one." >&2
    exit 1
    ;;
esac
record="$dir/calls"
: > "$record"

# A refusing, recording `claude` and `codex`, as `gh` has (engineer 6 on #467), in a directory of
# their own inside this one, so the trap above removes it and the check above has named its path.
# It is not `gh`'s directory, so a test that takes it off PATH to ask the installed `claude`
# whether it is signed in is still refused by `gh`. Each records its own name before its
# arguments, in the one record beside them.
agents="$dir/agents"
mkdir "$agents" || exit 1
: > "$agents/calls"
for cli in claude codex; do
  cat > "$agents/$cli" <<'REFUSING'
#!/bin/sh
printf '%s %s\n' "${0##*/}" "$*" >> "${0%/*}/calls"
printf '%s\n' "${0##*/}: refused under npm test, which starts no real agent session: ${0##*/} $*" >&2
exit 1
REFUSING
  chmod 755 "$agents/$cli"
done

# `$0` is the path the refusing `gh` was run by, which is its path in this directory wherever
# PATH found it. `${0%/*}` names the directory without a `dirname`, which a narrow PATH may lack.
cat > "$dir/gh" <<'REFUSING'
#!/bin/sh
printf '%s\n' "$*" >> "${0%/*}/calls"
printf '%s\n' "gh: refused under npm test, which reaches no real forge (#276): gh $*" >&2
exit 1
REFUSING
chmod 755 "$dir/gh"

# The directory holding the refusing `gh`, for the `D16` probe in test/forge-runners.test.mjs
# alone: it asks the installed `gh` a question that reaches only its own local proxy.
RIGGER_REFUSING_GH_DIR=$dir
export RIGGER_REFUSING_GH_DIR

# The directory holding the refusing `claude` and `codex`, for the tests that ask the installed
# `claude` whether it is signed in, which starts no session, and for the gated live runs.
RIGGER_REFUSING_AGENT_DIR=$agents
export RIGGER_REFUSING_AGENT_DIR
PATH="$agents:$PATH"

mkfifo "$run/ended" || exit 1
cat > "$run/runner.cjs" <<'RUNNER'
require(require('node:path').resolve('test/suite-guard.cjs')).registerHostHooks(require('node:test'));
RUNNER
/usr/bin/perl -e 'setpgrp(0, 0); die "reaper group: $!" if getpgrp != $$; exec @ARGV or die "reaper exec: $!"' node test/suite-reaper "$run" "$run/ended" 3>&- &
reaper=$!
exec 3> "$run/ended"
finish() {
  result=$?
  trap - EXIT
  exec 3>&-
  wait "$reaper" || result=1
  cleanup_auto_evidence_root
  exit "$result"
}
trap finish EXIT
PATH="$dir:$PATH" node --require "$run/runner.cjs" --test $node_flags "$@" 3>&- &
runner=$!
trap 'kill -TERM "$runner" 2>/dev/null || :; exit 143' TERM
trap 'kill -INT "$runner" 2>/dev/null || :; exit 130' INT
wait "$runner"
status=$?

if [ -s "$agents/calls" ]; then
  printf '%s\n' "npm test: these tests called an agent CLI with no stand-in of their own, and the suite refused each:" >&2
  while IFS= read -r call; do
    printf '  %s\n' "$call" >&2
  done < "$agents/calls"
  status=1
fi

if [ -s "$record" ]; then
  printf '%s\n' "npm test: these tests called gh with no stand-in of their own, and the suite refused each (#276):" >&2
  while IFS= read -r call; do
    printf '  gh %s\n' "$call" >&2
  done < "$record"
  exit 1
fi
exit $status
