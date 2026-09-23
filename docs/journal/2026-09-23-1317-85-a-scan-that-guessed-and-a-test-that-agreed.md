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

**What is left, and it is not closable by reading.** A top-level call the module never finishes
reaching is claimed all the same — a `throw`, a `process.exit`, a rejected top-level `await`, a
hang. Whether a module reaches its own top-level calls is a question about running it, and refusing
every file whose top level might not finish would refuse every test file there is. There is a test
that asserts it, so the limit is stated rather than waiting to be found.

## Round 2 — the bar was not the technique, and three more shapes fell to it

**A judge rejected both of my readings of the acceptance and ruled a third.** I had offered the
literal reading and "the scan must not misread syntax". The second restates the technique as the
bar, which the card had expressly refused, and it was not the bar the code implemented either: the
docstring says "the bar is that `node --test` would execute the test named", and the load-bearing
test asserts `runner.names.includes(title)`. The bar is therefore that a declaration speaks for a
test the runner runs *by the title recorded*, wherever the source is what decides it. Writing the
bar down in the code and then arguing a looser one in prose is a thing to notice: the code had
already committed me, and the judge read it back.

**Under that bar, three shapes the source decides were still claimed.** A call to a name the file
binds itself — `const test = () => {}`, or its own `function test` — reaches no runner, because
`node --test` installs no global and only a name imported from `node:test` is the runner. A title
the call builds by concatenation was recorded truncated: `'a test nobody' + ' runs'` produced a row
naming `a test nobody`. And the title decoding was one substitution that dropped a backslash and
kept the letter, so `'a title with a\ttab'` was recorded as `a title with attab` where the runner
registers a real tab.

**The sharpest of the judge's points was that I already refused the identical case.** A title a
template literal builds from a substitution was refused on the stated ground that it is "no plain
quoted title", while a title built with `+` was accepted — and the information that tells them
apart was already in the token stream, one token past the title. Two spellings of one fault, one
refused and one claimed, is what an enumeration written shape by shape produces even when the
enumeration is honest about being one.

**And a completeness claim I did not have.** The docstring said "nothing read off a source can move
it" of the run-time boundary, and both copies of the tdd skill said the same. Three shapes the
source decides falsified it. The card itself draws this distinction — an incomplete enumeration
under a true governing statement is one fault, a document asserting a property the code lacks is
the one PR #74 spent three rounds on — and I had written the second kind while fixing the first.
The restated claim is about the kind of thing left open rather than about the length of the list: a
shape the source decides and the scan reads wrongly is a defect rather than a limit.

**A behaviour loss against the base, on the record rather than fixed here.** Asking for the top
level refuses a declaration inside a `describe` block, where the old line-oriented scan read it and
the runner does run that call. No test in this repository uses `describe` today, and no acceptance
item ruled on the trade, so it stays as it is and the owner decides. It is a loss, not a wash, and
this is where it is written down.

## Round 3 — two shapes, and a document nobody would have noticed was broken

**The import reader took the wrong string.** It scanned forward to the first string token in the
statement and called that the module. ES2022 allows a string where an *import name* goes, and that
string sits inside the clause, before the specifier — so a decoy module exporting
`{ nothing as 'node:test' }` had its default export accepted as the runner. The runner loaded both
files cleanly and registered nothing; the scan wrote the row. The same bug refused a genuine
`import { 'test' as t } from 'node:test'`, which the runner does run. Wrong in both directions from
one cause, and only one direction was safe. Reading the specifier as the token after `from` closed
both at once, which is the shape a root-cause fix takes: the instance count goes down by two.

**A title can malform the document without failing any check.** `docs/derived/test-matrix.md` is a
pipe table — a row is one line, its cells divided by `|` — and a title carrying either character
breaks the row. `matrix:check` compares bytes, so it agrees with a malformed document exactly as
readily as with a sound one, and the ids test matched the first fragment of the split row and passed
too. Two checks over a generated binding document (`D8`), both green, both blind to it. The lesson
is not about titles: **a check that compares a generated document to what the generator produces
says nothing about whether either is well formed.** So there is now a test that reads the committed
matrix and asserts every row is one line holding the two cells the format gives it — and its own
guard is a mutation of the *document*: write a split row, watch it red, restore.

**Four spellings, one fault, and one of them was mine from round 2.** A template broken across
lines, the same in a CRLF file, a `|` in a title — and a `\n` escape in a quoted title, which only
became reachable when round 2 taught the reader to decode escapes properly. Closing a defect can
open a shape that was unreachable before it; the fix and its new edges want measuring together, not
just the fix.

**The CRLF half is the one a Windows checkout meets.** The language folds a template literal's
`<CR><LF>` to a `<LF>`; a reader of raw bytes does not. Measured off `run()` events: the runner
registers `a real\ntest` from both endings, and the reader held `a real\r\ntest` from the CRLF
file. Refusing the whole class covers it without a normalization rule nothing would then observe —
had the reader normalized *and* refused, the normalization would have been code no test could reach.

**And the harness lesson came back improved.** Round 2's entry says a reporter escapes what you
compare. The judge hit exactly that with its own first escape probe — comparing TAP `# Subtest:`
text, where a real tab returns as a backslash and a `t`, so a genuine agreement read as a
disagreement and its earlier probe had been a false negative. It re-ran off `node:test`'s `run()`
events and established the CRLF disagreement cleanly. Every title probe this round used `run()`, and
the collector carries its own guard, because a stream nobody consumes emits nothing and never ends
— which reads exactly like a runner that registered no tests. That was the first thing my own
collector did, and the guard is what caught it rather than the silence being believed.

**A harness lesson worth more than its size: the reporter escapes what you compare.** The relation
test reads titles out of `# Subtest:` lines. A title carrying a real tab comes back out of one as a
backslash and a `t`, so a tab-titled fixture reds on the reporter rather than on the scan — a
manufactured red again, in a third disguise. Measured before the shape was added, not after it
failed. The escapes that belong in a relation test are the ones whose characters the reporter
passes through; a tab belongs in a unit test that reads the decoded string directly.
