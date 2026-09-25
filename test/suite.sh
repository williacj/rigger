#!/bin/sh
# ABOUTME: What `npm test` runs: `node --test` with a refusing, recording `gh` first on PATH, so no
# test that inherits the suite's PATH reaches the real forge, and a run in which any test called it fails.
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
trap 'rm -rf "$dir"' EXIT

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

PATH="$dir:$PATH" node --test "$@"
status=$?

if [ -s "$record" ]; then
  printf '%s\n' "npm test: these tests called gh with no stand-in of their own, and the suite refused each (#276):" >&2
  while IFS= read -r call; do
    printf '  gh %s\n' "$call" >&2
  done < "$record"
  exit 1
fi
exit $status
