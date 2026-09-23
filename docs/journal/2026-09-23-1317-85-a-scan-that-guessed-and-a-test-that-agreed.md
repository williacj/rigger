ABOUTME: A journal entry from card #85: A scan that guessed, and the tests that agreed with it

## 2026-09-23 — A scan that guessed, and the tests that agreed with it

Card #85 reported one shape that defeated the test-matrix scan: a quote inside a regular
expression, which made its end-of-quoted-run lookup return −1, so it stopped reading the line and
never saw the `/*` after it. The card said the set of such shapes is open-ended and asked for the
property instead. Measuring first, before writing anything, found three more live shapes and one
silent one, and the measurement is what settled the design.

**A backtick inside a string was enough on its own.** `const tick = "\`";` on one line and
`const fixture = \`` on the next: the first flips the scan's template-open flag, the second flips
it back, and a declaration inside the fixture below is read as live code. No regular expression, no
unbalanced quote — just two ordinary lines of a test that quotes a backtick. That shape is simpler
than the one the card reported, which is the argument against closing shapes one at a time.

**Two more cost a claim, and one cost silence.** A string continued onto the next line with a
backslash carries a declaration and a call as two more lines. A declaration above a call the file
nests — inside a function nobody calls, inside a branch never taken — was claimed, and `node --test`
runs neither. And a declaration a U+2028 divided from its call was dropped without a word, because
the scan split lines on `\n` alone where JavaScript ends a line at four characters. A dropped claim
reads exactly like a requirement no test claims, in the one document whose job is to tell those
apart.

**The bar was a property, so the test had to ask the authority.** `D16` rule 1 already says what
counts as a test is `node --test`'s answer. So sixteen sources go to the real runner and to the
scan in one run, and the assertion is the relation between the two answers rather than either one
written down. Eight are shapes the runner never runs; one assertion asks the runner whether it ran
a test by the dead name anywhere in a repository made of nothing but them. The other eight are
live, and six of them were a false refusal or a dropped claim before.

**Two assertions exist only because a mutation ran.** The refusal test asserted the file and the
line a refusal names. Under a mutation that removed the ambiguous-slash refusal, the scan threw
anyway — an unterminated regular expression, at the same line — and the test passed. A refusal
thrown for an unrelated reason satisfied an assertion about where it was thrown, which is the
lesson card #71 wrote down about a refusal by accident reading exactly like a control. The test now
asserts the reason as well. And a mutation that let a comment trailing a statement carry a
declaration reddened nothing at all, because no test said a declaration is a line comment of its
own. Both holes were found by running mutations rather than by reading the suite.

**A mutation that hangs is not a mutation, and no byte or parse guard can see it.** Disabling the
template branch with `&& false` left a backtick falling through to the word reader, which stops at
a backtick, so the index never advanced and the run never finished. Every guard held: the bytes on
disk changed, `git diff` saw them, the mutated text was there, `node --check` passed, the module
loaded and still exported what the tests import, and the restore came back to the original sha256.
None of those can see a mutant that answers nothing at all, because each asks whether the mutation
arrived and whether the file is still a program — never whether the run produced a verdict.

What caught it was the counts: `tests 1 / pass 0 / fail 1`, the whole file failing to load, which
is the shape a manufactured red takes. So a mutation run needs a third kind of guard beside the
byte guard and the parse guard: the counts have to be read, and a run whose count is the file
rather than its tests is no evidence either way. The replacement mutation makes the reader answer
*wrongly* rather than not answer, and reddens four tests.

**The suite told me where the code goes.** The reader started as `scripts/javascript-tokens.mjs`,
and `test/package.test.mjs` reds on a script no npm script runs. Every file in `scripts/` is an
entry point, and shared code lives in the entry point that first needed it — which is how
`endOfQuoted` came to be exported from `scripts/package-budget.mjs`. Reading that convention off a
failing test cost less than reading it off the directory would have.

**A forked tree makes every edit under `.claude/` a pair of edits.** Two of this card's items ask
for a passage in `.claude/skills/tdd/SKILL.md`, and card #33 landed
`templates/claude/skills/tdd/SKILL.md` beside it with a check that reds on any divergence between
the two trees, in either direction. From a base before that landed, writing one copy would have
redded whichever pull request merged second, and writing the other would have been building another
card's tree; the item waited for #33 rather than being worked around. Now that the fork exists, the
cost is permanent and small: an edit to either copy is an edit to both, byte for byte, and
`test/init.test.mjs` is what says so.

**What is left, and it is not closable by reading.** A top-level call the module throws before
reaching is claimed all the same. Whether a module reaches its own top-level calls is a question
about running it, and refusing every file whose top level might throw would refuse every test file
there is. There is a test that asserts it, so the limit is stated rather than waiting to be found.
