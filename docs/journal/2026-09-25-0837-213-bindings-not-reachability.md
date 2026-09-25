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

**What it cannot see, stated for the next reader.** Rule 3 reads `board.priority` as a member
access or a destructuring off something named `board`. An alias such as
`const b = config.board; b.priority` passes it. Two other cases pass the syntax as well: a
`'g' + 'h'` built at run time, and a `createRequire` import. Each is a review finding rather than
a test failure, like the generic passthrough R214-B2 already names.

**`git-environment.test.mjs` reads imports by regex.** Its check that every file importing
`node:child_process` also spawns matched the test's own fixture strings. The fixtures now write
that specifier in double quotes, which its regex does not match.

**Process.** The test file came first, whole, against a stub that reported nothing. `node --test`
on that file gave 21 of 25 red. The helper was then written to turn them green. That is a batch,
not the one-test-at-a-time loop the TDD skill asks for. Three later tests went in after the code
they cover: destructuring in `runners.mjs`, source without semicolons, and aliases. For those, a
guarded mutation of the helper shows each one red when its branch is removed, and that stands in
for the red they never had.
