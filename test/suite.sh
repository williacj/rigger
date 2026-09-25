#!/bin/sh
# ABOUTME: What `npm test` runs: `node --test` with a refusing, recording `gh` first on PATH, so no
# test that inherits the suite's PATH reaches the real forge, and a run in which any test called it fails.
#
# Placement and shape are the architect's ruling on #276
# (https://github.com/williacj/rigger/issues/276#issuecomment-5835306379). Every argument is
# forwarded to `node --test`, which alone decides what counts as a test (`D16` rule 1).
#
# The refusing `gh` records to a file whose path is written into it, not passed in the
# environment, so a child whose environment was rebuilt around an inherited PATH still records.
# A test whose caller is handed a refusal can still pass, so the record is what fails the run.

set -u

dir=$(mktemp -d "${TMPDIR:-/tmp}/rigger-refusing-gh.XXXXXX") || exit 1
trap 'rm -rf "$dir"' EXIT
record="$dir/calls"
: > "$record"

{
  echo '#!/bin/sh'
  echo "printf '%s\\n' \"\$*\" >> '$record'"
  echo "echo \"gh: refused under npm test, which reaches no real forge (#276): gh \$*\" >&2"
  echo 'exit 1'
} > "$dir/gh"
chmod 755 "$dir/gh"

# The directory holding the refusing `gh`, for the `D16` probe in test/forge-runners.test.mjs
# alone: it asks the installed `gh` a question that reaches only its own local proxy.
RIGGER_REFUSING_GH_DIR=$dir
export RIGGER_REFUSING_GH_DIR

PATH="$dir:$PATH" node --test "$@"
status=$?

if [ -s "$record" ]; then
  echo "npm test: these tests called gh with no stand-in of their own, and the suite refused each (#276):" >&2
  while IFS= read -r call; do
    echo "  gh $call" >&2
  done < "$record"
  exit 1
fi
exit $status
