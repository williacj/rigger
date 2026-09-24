ABOUTME: Records why the script rather than the skill governs the matrix reader's refusal set, that
the tdd skill already held the rule its own pointer was breaking, and why two branches that were
each green merged into a red `main` that no card owned.

# Which copy of the refusal set governs

Card #156 decided to keep two copies of the call shapes the matrix reader refuses: a table in
`.claude/skills/tdd/SKILL.md` and a block comment in `scripts/build-test-matrix.mjs`.
Card #168 is the one sentence that decision left owing — which copy wins where they disagree.

## The authority was a fact to find, not a choice to make

Nothing about the two copies is symmetrical. The script is the reader: a refused shape is a thrown
`Error` naming the file and the line, and `npm run matrix:check` is the command that fails. The
skill's table cannot refuse anything. It explains the consequence to a test author in the author's
vocabulary, which is why card #156 kept it.

So the script governs, and it governs whether or not any sentence says so. Writing it down records
where the fact already lives — the "refer to it" treatment `AGENTS.md` describes under "Documents
own their facts" — rather than placing a new duty on anyone. That is what made this a sentence
instead of a proposal.

## The skill already held the rule its own pointer was breaking

`.claude/skills/tdd/SKILL.md` carries, under **Assert the relation to an authority, not the answer
it gives today**, the `D16` split: the tool decides the fact and the code carries at most a copy.
The passage is about tests, but the shape is the same one this card needed, and the skill's own
pointer later in the same file was the copy with no authority named. Worth remembering when the
next such omission turns up: the rule that settles it may already be in the file.

## A green pair of branches merged into a red `main`

Round 1 of this card could not start. `npm test` was red at `8dd7950`, the ref it was told to
branch from, and `.githooks/pre-commit` refuses a commit while it is. Measured in a fresh clone at
`8dd7950` after `npm ci`, one test failed — `every git this repository spawns is handed an
environment the call names` — reporting `test/path-check.test.mjs:115` as a git spawn handed no
environment.

Neither contributing branch could have seen it. Measured by inspecting the two trees:

| Commit | Merge | What it added | What its own tree lacked |
|---|---|---|---|
| `57e340f` | `7cc95d1`, PR #155 | the sweep over every spawn in the repository | nothing |
| `67aef7f` | `c433d57`, PR #162 | a git spawn with no `env` | the sweep test |

Neither branch held both halves, so neither could fail that test on its own, and `main` went red
at `c433d57`. The general fact: a test that
enumerates the repository's own source asserts a whole-repository invariant, so a sibling branch
can break it by adding source the sweep will read, and a gate that runs the suite on one branch
proves nothing about the merge result.

The second lesson is cheaper to act on. `AGENTS.md`'s "green before you begin" reaches whoever
hands out a ref as much as whoever takes it, because a maker handed a red ref cannot commit at all
and finds that out only after setting up. Card #169's maker found the same red on its own pre-work
run and fixed it as its own commit, `53d1fc0`, merged in PR #171.
