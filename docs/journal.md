ABOUTME: Rigger's journal: what we learned building it, and what failed. Newest entry first.

# Journal

An entry records something learned or something that failed, dated, in as few lines as that
takes. It binds nothing — a rule that came out of an entry is written where rules live, and the
entry says what taught us. `AGENTS.md` holds when an entry is committed.

## 2026-09-22 — A version boundary is a range, and a major number is not one

Card #73 made the package budget agree with `node --test` about which filenames are tests. Three
rounds, and each round a claim about node turned out to be narrower than it was written.

What the runner does changed twice, not once. Glob matching arrived in **21**, not 22 — Node 20
has no glob-shaped pattern at all, only `doesPathMatchFilter`. And the respelling that makes
`test.mjs` a wholly literal alternative arrived in **22.10**, not 22: v22.9.0 still spells the
extension as the extglob `?(c|m)js`, so across 21.0.0–22.9.x the runner folds `TEST.mjs` too.
Keying on the major number alone put the check on the wrong side of a boundary that sits inside
the major, and it red a green base on a runtime `engines` declares.

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

