ABOUTME: Rigger's journal: what we learned building it, and what failed. Newest entry first.

# Journal

An entry records something learned or something that failed, dated, in as few lines as that
takes. It binds nothing — a rule that came out of an entry is written where rules live, and the
entry says what taught us. `AGENTS.md` holds when an entry is committed.

## 2026-09-22 — A version boundary is a range, and a major number is not one

Card #73 made the package budget agree with `node --test` about which filenames are tests. Four
rounds, and each round a claim about node turned out to be narrower than it was written.

What the runner does changed three times, not once, and each move is independent of the others.
Glob matching arrived in **21**, not 22 — Node 20 has no glob-shaped pattern at all, only
`doesPathMatchFilter`. The extension respelling that makes `test.mjs` a wholly literal
alternative arrived in **22.10**, not 22: v22.9.0 still spells it as the extglob `?(c|m)js`, so
across 21.0.0–22.9.x the runner folds `TEST.mjs` too. And the character class moved from the
range `[.-_]` to the set `[._-]` somewhere in **22.1–22.8**, which nobody has measured: v22.0.0
still has the range, v22.9.0 has the set. Keying on the major number alone put the check on the
wrong side of a boundary that sits inside the major, and it red a green base on a runtime
`engines` declares.

Counting the moves wrong was itself one of the rounds. The entry first said "changed twice",
because two boundaries had been measured and the third had not been looked for. A count of how
many times a thing changed is a claim about every version, and it is only as good as the versions
actually run.

Each wrong claim was found the same way: by running the real interpreter, not by reading a
changelog or reasoning from the major number. Installing pinned interpreters (`npm i node@22.9.0`)
and dumping `kDefaultPattern` from each is cheap, and it is the only thing that located 22.10.
Where a fact belongs to a tool, the boundary is a version range and has to be measured at both
ends — a single measurement inside the range says nothing about where it starts.

**Two readings of one source can disagree without either being wrong.** At tag v21.7.3 the file
holds both `kPatterns`, module-local and not exported, and `kDefaultPattern`, exported. Reading
the source file and dumping the loaded module gave different names for the same alternatives, and
that looked like a contradiction for a round. Say which vantage point a reading came from.

This was the third claim in M0 that read as measured and was not. The pattern worth naming: a
measurement on one host, one version, one volume, written up in words that quantify over all of
them. The fix is in the writing, not the measuring — say what was measured and on what, and name
the unmeasured cells as unmeasured.

**Commit before mutating.** Proving a test fails when the behaviour is removed means editing the
source, and reverting that edit with `git checkout --` throws away everything uncommitted in the
file, not the mutation alone. It took the fix with it. Re-applying from the transcript and
watching the suite pass again recovers behaviour, not the diff: a passing suite says the
behaviours under test are back, and says nothing about a line no test reads. Commit the work,
then mutate, then `git checkout --` returns to the commit.
## 2026-09-22 — A test that passed on the runtime's error message, not on ours

The event sink's reader refuses a torn line and names it. The test for that asserted `/line 1/`
and passed the moment it was written, which should have been the tell. What it matched was V8's
own JSON message, `Unterminated string in JSON at position 45 (line 1 column 46)`, and the line
V8 names is the line inside the fragment it was handed rather than the line in the stream.

So the assertion agreed with the runtime by coincidence. It would also have gone red on CI's
Node 20 leg, where the same failure reads `Unexpected end of JSON input` and names no line at
all. The fix was to give the reader its own message, naming the file and the line, and to assert
that text. A test whose expected value can be produced by something other than the code under
test is worth re-reading, even when it fails first for the right reason.

Five of the eleven tests here passed as soon as they were written, because the minimal code for
the first test already covered what they asked. Each was then checked by breaking the sink on
purpose — writing instead of appending, spreading the layer's fields ahead of the envelope,
appending asynchronously — and every one of them went red. That is cheap, and it is the only
thing that separates a test which holds a behaviour from one that describes it.

What the sink guarantees is smaller than "durable". Appends are synchronous, so a process killed
outright loses no event that had already returned, and that is measured by killing one. Nothing
is flushed to the disk, so power loss can still lose the tail, and two writers are not something
this code has been measured against.

## 2026-09-22 — The lint arrived after the corpus, and the corpus barely cleared it

Writing `spec-style-lint` against documents already written showed how little headroom the
sentence ceiling has: the longest sentence the lint reads is 39 words against a ceiling of 40.
The next compound sentence anyone writes into the README or the register reds the build.

Two of the four register rules turned out to be unlintable, and the reason is worth keeping.
Rule 3 asks whether an actor is genuinely unknown and rule 4 asks whether a structure fits its
meaning. Both are judgments about intent, and a lint that guessed at either would file findings
an author has to argue with rather than fix.

The sentence splitter asks the word after a full stop whether the stop ended a sentence, and it
is wrong both ways. A lowercase word keeps two sentences joined, as `v0 buys` does, and the
count comes out high. A capital after an abbreviation splits one sentence into two, the way
`e.g. Rigger` does, and the count comes out low.

The second of those cost a review round, because this entry first claimed it could not happen.
A bias in a check is worth disclosing, and a bias described as absent is worse than one nobody
mentioned: a reader then draws a conclusion the check cannot support. A green lint says no
sentence the splitter reads is past the ceiling, which is narrower than it sounds.

## 2026-09-22 — A guarantee that was only a convention

A test declares what it proves in a `// proves R-GROUP-#` comment, and the tool that builds the
test matrix reads those out of the test sources. Its own tests hand it fixture sources, so a
scan matching anywhere on a line would read every fixture as a claim by the file quoting it.
Anchoring a declaration to a whole line answers that for a fixture written as a single-line
string, which is every fixture this repository had, and three documents went on to state it as a
property of the scanner. It was a convention the fixtures kept. A fixture written as a template
literal spanning lines, and a call commented out under a live declaration, each produced a matrix
naming a test that did not exist, and neither said a word. Closing those brought the lesson round
again from the other side: the block-comment state added with them read a marker inside a string
as a marker, and dropped every declaration after it in silence. A missing claim reads like an
honest gap, which is worse than a false one in the document meant to tell them apart. What the
scan cannot read it now refuses by name, and the little it still cannot see is written down
beside it rather than claimed away.

## 2026-09-22 — A generated document and CRLF

The test matrix is compared with what its tool writes, byte for byte. Git hands a Windows
working tree CRLF and the tool writes LF, so on Windows the check called a freshly written file
stale. `.gitattributes` pins `docs/derived/` to LF, the way it already pins the hooks. Any
generated document that lands there inherits the pin.

## 2026-09-22 — The code stated two facts it did not own

Card #29 built `scripts/package-budget.mjs`, the check CI runs against the package line budget.
Two review rounds on PR #40 found two defects in it, and the gap both sat in had no rule.

The round 1 review found the scan entering block-comment state on a `/*` inside a string. The doc
comment above it bounded the cost at "an undercount of one line". Nobody had measured that bound:
the real undercount ran to the next `*/` or to the end of the file, in the check that decides
whether an over-budget package merges.

The round 2 review found the file excluding tests by a list of spellings it had thought of itself.
Three shapes `node --test` executes were charged to the production budget — `test.mjs`,
`test-*.mjs`, and every file under a `test` directory — where `ARCHITECTURE.md` puts tests outside
it. `npm test` is `node --test`, so what counts as a test was never that script's question.

What the two share is not the fix but the mistake: code asserting a fact it did not own. Both
passed a green suite, because an assertion the code derives from itself agrees with itself. The
second fix found the authority and read from it. The first measured the disagreement it had
guessed at, and stated what it really costs.

The second half is the one an author drops. Reading from an authority couples the code to that
authority's behaviour, including where that behaviour is undefined.

Measured on this repository's own checkout — Windows, Node v24.18.0 — `node --test` runs
`a.TEST.mjs` and declines `TEST.mjs`. The cause is in the runner, not on the disk. Node's own
`internal/fs/glob` folds case on the platform, `nocase: isMacOS || isWindows`, and its
`nocaseMagicOnly: true` leaves an alternative that is wholly literal to match exactly. The
runner's default pattern expands to a literal `test.mjs`, which `TEST.mjs` misses, and to a
`*[._-]test.mjs`, which `a.TEST.mjs` matches.

The exclusion on `main` is case-sensitive, so it charges `a.TEST.mjs` to the production budget
while the runner runs it as a test. The test that asks the runner does not catch it, because its
fixture is all lower case. `D16` records both halves: ask the authority, and record where the
authority can disagree with you.
