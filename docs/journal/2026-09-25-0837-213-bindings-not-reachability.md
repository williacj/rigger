ABOUTME: Records card #213, the boundary test that holds each directory under src/ to the forge
sides it may import, and why its reader went from tokens to a parser over three review rounds.

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
function names of its own. Any other binding in `runners.mjs` from which a write runner can be
reached inside the file joins that runner's side as well. That covers a wrapper, an alias or a
property assigned beside the runners, which would otherwise carry a write out under a name nobody
classed.

**A hand-on is a value, whatever expression carries it.** A module in a permitted directory can
hand a side on without re-exporting it by name: a default export, an alias, a later assignment, an
object holding it, or a function called where it is written that returns it. So a binding carries
every name its initialiser can evaluate to, and so does an assignment into it or a call it is
handed to. A function that is only defined is a value of its own and hands nothing on, because
calling a side through L2 is the ruled path. A function that only forwards its arguments to a side
stays the review finding R214-B2 names.

**Round 1 and round 2: a token reader keeps guessing.** The first reader reused `tokensIn` from
`scripts/build-test-matrix.mjs` and found statements by where tokens broke lines. Round 1 found
hand-ons it missed when no `;` followed them. The fix split statements at new lines, and round 2
found lines it then joined wrongly: a line ending in `Array.from`, `fs.default` or `x++` swallowed
the export after it. Round 2 also found a write side returned by an immediately invoked arrow read
as a local definition. Each round closed one more shape of the same class. A reader that guesses
where statements end, from tokens, will keep guessing wrong somewhere.

**Round 3: a parser, on the owner's ruling.** On 2026-09-25 the owner ruled that the boundary
reader may use one dev-only dependency, `acorn`, a real JavaScript parser. It is a
`devDependency`. Nothing under `src/`, `scripts/` or `templates/` imports it, so the published
package still installs with none. Statements, declarators and patterns now come from the syntax
tree, so destructuring and a second declarator are read rather than refused. A module that does
not parse fails the test, naming the line.

**The last commit: the author draws where holding ends.** Round 3 found two more routes. A side
bound by a dynamic `import()` and handed on passed, and so did `(0, (() => side))()`. Each round
had been judging against a class with no stated edge. With the owner's leave for one commit past
the round limit, the PM revised #213 (comment 5835018240). Rules 1, 5 and 6 and the re-export item
now share a "Hand-ons: what holds a side" item. Its eight steps are the whole definition, and
every route outside them is a review finding. The reader follows each step:
- a resolvable `import()` carries its module whole, awaited or not;
- a called function is found through any comma, `.call`, `.apply` or template tag wrapped round it;
- its parameters take what the call passes, or their defaults;
- its own aliases take what they are given.

The proof tests run a hand-on through every step, for both write sides.

**Holding is read scope by scope.** Round 4 found a side aliased in a block, or in a called
function's parameters or locals, and then assigned into a module binding, such as
`{ const a = side; out = a; }`. The reader looked names up only at module level, so it dropped
the block's `a`. With the owner's leave for one more commit, the reader now keeps a scope for
the module, for each block and for each function:
- `let`, `const`, `class` and `function` bind in their block, and `var` binds in its function or
  in the module;
- an assignment writes into the nearest scope that declares the name;
- a module binding takes what the value holds in the scope where the assignment is written;
- a function called where it is written is read with its parameters bound to what the call
  passes, and what it returns is gathered from its return statements in their own scopes.

The module is read again until nothing it holds grows, so a chain of aliases settles.

**Where a value enters a binding.** Round 5 found two more gaps, both in how a value reaches a name.
A spread in a call's arguments, `((a, x) => x)(...[0, side])`, gave the whole spread to the first
parameter. A default inside a pattern, `const { held = side } = {}`, was dropped, because the
reader bound every name in a pattern to the pattern's source and never read the defaults. With the
owner's leave for a third extra commit:
- a pattern now gives each name what it destructures plus the default written beside it, in a
  declaration, an assignment and a parameter alike;
- a call's arguments are laid out by position, and from the first spread on, every position may
  hold anything the spread or a later argument holds;
- a function's own `arguments` holds everything the call passed.

The pass cap of 50 is gone. What a binding holds only grows, and only from the module's own
names, so the passes end on their own. A 60-link chain that the cap misreported as unreadable
now settles.

**Rule 3, and who drew its line.** Round 1 found `const b = config.board; b.priority` passing, and
round 2's fix barred the `board` key in `src/scheduling/` outright. That caught the board handle
#227 gives L3. The reviewer returned the item to its author under `R-LOOP-6`, and the PM revised
it (#213, comment 5834557424). It now bars the spelled config path `board.priority`, by `.`, `?.` or
a fixed-string subscript, or by destructuring `priority` from a `board` key. It bars no other use of
`board`, so `pull({ board, dispatch })`, `deps.board.items()` and `({ board, run })` pass. A read
through an alias or a computed key is a review finding.

**It fails closed wherever it cannot read.** A dynamic `import()` whose specifier is not a fixed
string naming a module under `src/` fails the test. So does a static import it cannot resolve, a
name a module does not export, and a `createRequire` or `getBuiltinModule`. The one exemption is
keyed to the file and to the argument's source text, `pathToFileURL(path)`, not to the file alone.
The same load anywhere else fails.

**Rule 7 reads fixed strings, not only literals.** `doctor.mjs` names `` `gh auth status` `` in its
report text and in comments, so only a string whose whole value is `gh` counts. The parser folds a
`+` of fixed strings and a template of fixed parts, so `'g' + 'h'` and `` `g${'h'}` `` fail too. A
`gh` assembled from a value known only at run time still passes, and stays a review finding. So
does a board the CLI hands L3 under another name, such as `pull(config.board)`.

**`git-environment.test.mjs` reads imports by regex.** Its check that every file importing
`node:child_process` also spawns matched the test's own fixture strings. The fixtures now write
that specifier in double quotes, which its regex does not match.

**Process.** In the first round the test file came first, whole, against a stub that reported
nothing: `node --test` on that file gave 21 of 25 red. That is a batch, not the one-test-at-a-time
loop the TDD skill asks for, and three later tests went in after their code. Guarded mutations of
the reader stood in for their red. Rounds 1 to 3 wrote their tests first and ran them red against
the reader then in place: 5 of 33 in round 1, 6 of 37 in round 3.
