ABOUTME: Records card #216, which built the forge adapter's three runners and its two write sides,
and why each runner parses the request rather than trusting who sent it.

# 2026-09-25 — A runner that reads the request

Delta G gave the forge adapter three sides, each behind a runner that refuses what is not its own.
The work was deciding what "its own" means in terms a runner can check on a `gh` argument list.

**Every write is one GraphQL mutation, written out in full.** The write runners admit
`gh api graphql -f query=<document>` and nothing else. A variable, a fragment at the root, a
directive or a second root field each move what the request does somewhere the document does not
show, so each is refused. That made the side modules build their documents with every value
inline, through a `literal` that is `JSON.stringify`. JSON's string syntax is a subset of
GraphQL's, so no value can close its quote and write GraphQL of its own.

**The parser is ours, and small.** Nothing in `package.json` parses GraphQL, and the runners need
only the executable grammar: operation types, root fields and their argument names. Anything it
cannot read throws, and a throw is a refusal, so a gap in it fails closed.

**Which field holds the columns is read, not told.** A field-value write names its field by an
opaque ID. The item-write runner therefore reads the board's `Status` field ID itself, through the
read runner, before it admits a move. A caller that names `Priority`'s ID gets a refusal naming
`Priority`, whatever it called the request.

**`gh api` measured without touching GitHub.** `github.localhost` is the one host `gh` speaks plain
HTTP to, so an `HTTP_PROXY` on this machine reads its request line. With gh 2.99.0 that showed no
flag sends GET, `-f`, `-F` and `--input` send POST, and `-X GET -f` sends a GET with a query string.
The test asks `gh` the same question every run. The first attempt called the injected stand-in
`spawn`, and `test/git-environment.test.mjs` read that as a spawner deciding its command at run
time. Renaming it `send` was the fix, and that sweep is why the one real spawn sits in one place.

**No write checks itself by reading back.** #212's spike saw a read straight after a write miss it
twice. A move that read the board back to confirm would sometimes report a landed move as lost,
so the write's own exit status is the answer.

**Where the three writes were checked against GitHub.** Each document the sides build was sent
once with IDs that resolve to nothing. GitHub answered `NOT_FOUND` for the ID each time, which
means the document passed its schema validation. No board or label was written, and board 6 was
never read.

**What did not fit, and how it was settled.** The acceptance as first written held the adapter's
operations equal to the fake board's, and those include four reads. #215 builds the reads on this
card's read runner, so they could not come first here. The maker escalated it, and the author
narrowed the item to the writes, moving the reads' parity to #215. The test finds the fake's
writes by calling each operation and watching its write record. An operation it does not know how
to call fails it by name, so a write added to the fake cannot slip past the comparison.
