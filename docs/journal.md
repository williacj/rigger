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
