ABOUTME: A journal entry from card #73: A version boundary is a range, and a major number is not one

## 2026-09-22 — A version boundary is a range, and a major number is not one

Card #73 made the package budget agree with `node --test` about which filenames are tests. Six
rounds, and each round the record claimed something wider than what had been run. Five of those
were claims about node; the first was a bound on this check's own line scan.

What the runner does changed three times, not once, and each move is independent of the others.
Glob matching arrived in **21**, not 22 — Node 20 has no glob-shaped pattern at all, only
`doesPathMatchFilter`. The extension respelling that makes `test.mjs` a wholly literal
alternative arrived in **22.10**, not 22: v22.9.0 still spells it as the extglob `?(c|m)js`, so
across 21.0.0–22.9.x the runner folds `TEST.mjs` too. And the character class was the range
`[.-_]` from **21.0.0 through 22.8.0** and the set `[._-]` **from 22.9.0** — every release in
that span dumped, so the boundary is exact. Keying on the major number alone put the check on the
wrong side of a boundary that sits inside the major, and it red a green base on a runtime
`engines` declares.

Counting the moves wrong was itself one of the rounds. The entry first said "changed twice",
because two boundaries had been measured and the third had not been looked for. A count of how
many times a thing changed is a claim about every version, and it is only as good as the versions
actually run.

**A hedge attached to a located claim still makes the claim.** The round before this one, that
class boundary was written as moving "somewhere in 22.1–22.8, which nobody has measured". The
word unmeasured reads as caution, but the sentence had already placed the move inside a window —
and placing it there is an assertion about ten releases nobody had run. The honest form asserts
no location at all: the range at 22.0.0, the set at 22.9.0, nothing between them measured. Better
still, and what closed it, was to run the ten and drop the hedge. A hedge is not a substitute for
a measurement, and a window is not a way of declining to guess.

That was the fourth instance on this one card of a single mistake: a bound on the line scan's
accuracy, then the brace-list boundary, then the set of versions the class covers, then the window
its move was said to sit in. Every one was quantified over versions nobody had run, and every one
read as measured.

**Every finding was in the explanation, never in the statement.** A fifth followed: the record
said both of its disagreements with the runner came from one cause and that neither was about
case. Measured, the two have nothing in common. `*[.-_]test` spells a range from `.` at 0x2E to
`_` at 0x5F. `b-test` is never matched, folded or not, because `-` at 0x2D falls below the range.
`latest` and `notatest` are matched **only** when folded, because `a` at 0x61 falls above `_` and
enters the range only as `A` at 0x41 — so that half of it is caused by case, and exists only where
node sets `nocase`. One sentence of mechanism, and it was wrong about half the cases it covered.

What the check's own record owes a reader is which names it and the runner disagree on, in which
direction, on which versions, and what was measured on what. It owes no account of why. Five
rounds of findings all landed in prose that answered a question nobody asked, and the sixth round
deleted that prose rather than improving it. Where an explanation is worth having, it belongs
somewhere that binds nothing — here, or on the card that owns the axis.

Each wrong claim was found the same way: by running the real interpreter, not by reading a
changelog or reasoning from the major number. Installing pinned interpreters (`npm i node@22.9.0`)
and dumping `kDefaultPattern` from each is cheap, and it is the only thing that located 22.10.
Where a fact belongs to a tool, the boundary is a version range and has to be measured at both
ends — a single measurement inside the range says nothing about where it starts.

**Two readings of one source can disagree without either being wrong.** At tag v21.7.3 the file
holds both `kPatterns`, module-local and not exported, and `kDefaultPattern`, exported. Reading
the source file and dumping the loaded module gave different names for the same alternatives, and
that looked like a contradiction for a round. Say which vantage point a reading came from.

M0 has seen this more than once, and not only here. The pattern worth naming: a measurement on
one host, one version, one volume, written up in words that quantify over all of them. Part of
the fix is in the writing — say what was measured and on what, and name an unmeasured cell as
unmeasured rather than describing it. The rest is in the measuring, because a cell you can cheaply
run is not an unmeasured cell, it is one you did not run.

**Commit before mutating.** Proving a test fails when the behaviour is removed means editing the
source, and reverting that edit with `git checkout --` throws away everything uncommitted in the
file, not the mutation alone. It took the fix with it. Re-applying from the transcript and
watching the suite pass again recovers behaviour, not the diff: a passing suite says the
behaviours under test are back, and says nothing about a line no test reads. Commit the work,
then mutate, then `git checkout --` returns to the commit.
