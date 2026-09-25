ABOUTME: Records card #213, the boundary test that holds each directory under src/ to the forge
sides it may import, and what the test reads a module's syntax for.

# 2026-09-25 — Bindings, not reachability

The architect's ruling on #214 (R214-B2) settled what the rules are about: the bindings a module
imports, followed through re-exports to where each is defined. It is not every module the import
graph can reach. L3 calling an L2 function that writes is the ruled structure, and so is the CLI
calling L3's claim-only call. So the test resolves each imported name to one definition and asks
which side defined it.

**One module holds all three runners.** #216 put `readRunner`, `schemaWriteRunner` and
`itemWriteRunner` in `runners.mjs`, beside the helpers every side imports (`graphqlRequest`,
`COLUMNS`, `firstLine`). Classing that file as a side would bar `doctor.mjs` from the read runner.
Classing none of it would let `src/cli/` import `itemWriteRunner` directly. So a runner is on its
side by name, derived from the side (`item-write` gives `itemWriteRunner`). The test lists no
function names of its own. Any other declaration in `runners.mjs` from which a write runner can be
reached inside the file joins that runner's side as well. That covers a wrapper or alias added
beside the runners, which would otherwise carry a write out under a name nobody classed.

**The syntax comes from the matrix builder's tokenizer.** `scripts/build-test-matrix.mjs` already
reads JavaScript as tokens, with comments, strings, templates and regular expressions told apart.
The boundary test imports `tokensIn` from it rather than adding a second reader. Rule 7's `gh`
check needs that, because `doctor.mjs` names `` `gh auth status` `` in its report text and in
comments. Only a string whose whole value is `gh` counts, after its escapes are decoded.

**It fails closed wherever it cannot read.** A dynamic `import()` whose specifier is not a string
naming a module under `src/` fails the test, and so does a static import it cannot resolve or a
name a module does not export. A declaration shape it cannot bind to one name fails too: an
exported destructuring, or two names in one `const`. The one exemption is keyed to the file and
to the argument's tokens (`pathToFileURL ( path )`), not to the file alone. The same load
anywhere else fails.

**A hand-on is a value, whatever expression carries it.** Round 1 found that the first reader
followed `export default x` and `const y = x` only when a `;` followed, and followed no alias
assigned later or exported by name. Matching more shapes would have left the next one open. So
every top-level statement is now its own segment. A binding carries every name its statement gives
it outside a function body: a default export, an alias, an assignment, an object holding the
import. A function body is left out because it runs when called, and calling a side through L2
is the ruled path. A function that only forwards its arguments to a side stays the review finding
R214-B2 names.

**Rule 3 bars the `board` key, not only `board.priority`.** Round 1 also found that
`const b = config.board; b.priority` passed. Once `board` is bound to another name, the tokens
cannot say which of its keys is read, and `board[key]` hides it entirely. So any read of the
`board` key in `src/scheduling/` fails: a member, a string in brackets, or a key in a braced
pattern. The Engine settings row in `ARCHITECTURE.md` gives the board's settings to L0, and L0
hands L3 each item's rank (#224), so L3 has no need of the key. A parameter that is merely named
`board` still passes unless `.priority` is read off it.

**What it cannot see, stated for the next reader.** A `gh` built at run time, such as
`'g' + 'h'` or `` `g${'h'}` ``, passes rule 7. A board the CLI hands L3 under another name, such as
`pull(config.board)`, passes rule 3. Each is a review finding rather than a test failure, like the
generic passthrough. `createRequire` and `getBuiltinModule` now fail the dynamic-import rule by
name.

**`git-environment.test.mjs` reads imports by regex.** Its check that every file importing
`node:child_process` also spawns matched the test's own fixture strings. The fixtures now write
that specifier in double quotes, which its regex does not match.

**Process.** The test file came first, whole, against a stub that reported nothing. `node --test`
on that file gave 21 of 25 red. The helper was then written to turn them green. That is a batch,
not the one-test-at-a-time loop the TDD skill asks for. Three later tests went in after the code
they cover: destructuring in `runners.mjs`, source without semicolons, and aliases. For those, a
guarded mutation of the helper shows each one red when its branch is removed, and that stands in
for the red they never had.
