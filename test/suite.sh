#!/bin/sh
# ABOUTME: What `npm test` runs: `node --test` with a refusing, recording `gh`, `claude` and `codex`
# first on PATH, so no test that inherits the suite's PATH reaches the real forge or a real agent
# session, and a run in which any test called one fails.
#
# Placement and shape are the architect's ruling on #276
# (https://github.com/williacj/rigger/issues/276#issuecomment-5835306379). Every argument is
# forwarded to `node --test`, which alone decides what counts as a test (`D16` rule 1).
#
# The refusing `gh` records beside itself, in the directory its own path names, and not to a path
# passed in the environment. So a child whose environment was rebuilt around an inherited PATH
# still records. No path is written into its source, so no character a temporary directory's
# name can hold breaks its quoting. A test whose caller is handed a refusal can still pass, so the
# record is what fails the run.

set -u

dir=$(mktemp -d "${TMPDIR:-/tmp}/rigger-refusing-gh.XXXXXX") || exit 1
agents=$(mktemp -d "${TMPDIR:-/tmp}/rigger-refusing-agents.XXXXXX") || { rm -rf "$dir"; exit 1; }
trap 'rm -rf "$dir" "$agents"' EXIT

# PATH holds this directory as one entry, so it is named absolutely: a relative entry finds
# nothing from a child working elsewhere. PATH splits its entries at `:`, so a name holding one
# would be no entry at all, and the run stops before any test does.
dir=$(cd "$dir" && pwd -P) || exit 1
agents=$(cd "$agents" && pwd -P) || exit 1
case $dir$agents in
  *:*)
    printf '%s\n' "npm test: the temporary directory $dir or $agents holds a ':', so PATH cannot name it and no test would meet the refusing gh (#276) or agent CLIs. Set TMPDIR to a directory without one." >&2
    exit 1
    ;;
esac
record="$dir/calls"
: > "$record"
: > "$agents/calls"

# `$0` is the path the refusing `gh` was run by, which is its path in this directory wherever
# PATH found it. `${0%/*}` names the directory without a `dirname`, which a narrow PATH may lack.
cat > "$dir/gh" <<'REFUSING'
#!/bin/sh
printf '%s\n' "$*" >> "${0%/*}/calls"
printf '%s\n' "gh: refused under npm test, which reaches no real forge (#276): gh $*" >&2
exit 1
REFUSING
chmod 755 "$dir/gh"

# A refusing, recording `claude` and `codex` in a directory of their own, as `gh` has (engineer 6
# on #467), so that no test starts a real agent session. Their directory is not `gh`'s, so a test
# that takes it off PATH to ask the installed `claude` is still refused by `gh`. Each records its
# own name before its arguments, in the one record beside them.
for cli in claude codex; do
  cat > "$agents/$cli" <<'REFUSING'
#!/bin/sh
printf '%s %s\n' "${0##*/}" "$*" >> "${0%/*}/calls"
printf '%s\n' "${0##*/}: refused under npm test, which starts no real agent session: ${0##*/} $*" >&2
exit 1
REFUSING
  chmod 755 "$agents/$cli"
done

# The directory holding the refusing `gh`, for the `D16` probe in test/forge-runners.test.mjs
# alone: it asks the installed `gh` a question that reaches only its own local proxy.
RIGGER_REFUSING_GH_DIR=$dir
export RIGGER_REFUSING_GH_DIR

# The directory holding the refusing `claude` and `codex`, for the tests that ask the installed
# `claude` whether it is signed in, which starts no session, and for the gated live runs.
RIGGER_REFUSING_AGENT_DIR=$agents
export RIGGER_REFUSING_AGENT_DIR

PATH="$agents:$dir:$PATH" node --test "$@"
status=$?

if [ -s "$record" ]; then
  printf '%s\n' "npm test: these tests called gh with no stand-in of their own, and the suite refused each (#276):" >&2
  while IFS= read -r call; do
    printf '  gh %s\n' "$call" >&2
  done < "$record"
  status=1
fi
if [ -s "$agents/calls" ]; then
  printf '%s\n' "npm test: these tests called an agent CLI with no stand-in of their own, and the suite refused each:" >&2
  while IFS= read -r call; do
    printf '  %s\n' "$call" >&2
  done < "$agents/calls"
  status=1
fi
exit $status
