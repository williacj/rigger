# ABOUTME: What `docs/demo.tape` sources before it records, from the checkout root: builds the
# demo world (`test/demo-world.mjs`) and leaves this shell in its consumer repository, with the
# world's bin directory as the whole PATH. Sourced rather than run, because a PATH and a working
# directory reach only the shell that sets them.

world=$(mktemp -d "${TMPDIR:-/tmp}/rigger-demo.XXXXXX") || return 1
node --input-type=module -e '
  const { demoWorld } = await import("./test/demo-world.mjs");
  demoWorld(process.cwd(), process.argv[1]);
' -- "$world" || return 1
PATH="$world/bin"
cd "$world/target" || return 1
