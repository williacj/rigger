ABOUTME: Card #152's finding: two branches collided on a rule rather than on a file, and the
reader written to catch it is only honest once it is told nothing about where a header may sit.

# 2026-09-24 — A clean answer about a file it never read

PR #149 was cut before PR #150 landed the ratified header form, so its journal entry was written
under the old convention and merged clean. The two branches shared no files. A textual conflict
check therefore said they could not collide, and it was right about files and wrong about the
repository: they collided on a rule. Card #120 was the same shape earlier the same day, a test
file from one branch meeting a check from another. What a merge tool compares is text, and a rule
is not in the text of either side.

The part worth keeping is what happened when the check went to be written. The rule allows a
header in four places — the first line, below a shebang, below a frontmatter opener, and below a
whole frontmatter block — and the obvious reader carries that list. PR #150's maker's first reader
did, skipped the frontmatter block whole, and answered zero repeated headers for the four agent
prompts whose headers sit inside the block below its opener. It never read them. A reader given a
list of allowed placements does not report that a header sat somewhere odd; it reports nothing,
which is indistinguishable from a file that is fine.

That cost is measurable rather than theoretical. Adding `&& index < 2` to the prefixed-line test
in `scripts/aboutme-header-check.mjs`, so the reader looks only near the top, makes it miss the
twelve `SKILL.md` files whose headers sit on line 6 — measured by `check(repository)` from that
mutated source against this branch's tree at `f4c2ba1`. It reports each of the twelve as carrying
no header at all. Every one of those answers is about a file the reader stopped at line 2 of.

So the check has no placement logic. It takes the file's first run of consecutive prefixed lines,
wherever that run begins, and asks only how long it is. Nothing tells it where a header may sit,
which is why it cannot skip one for sitting somewhere it was not told about. The four placements
are held by constructed inputs rather than by the tree, because the tree exercises all four today
and would stop the day a file moved.

The exempt set is read out of `AGENTS.md` for the same reason the placements are not typed in: a
list typed here is a second copy free to disagree with the sentence that grants each exemption. A
reword it cannot parse throws and names what it could not find, because returning an empty set
would red every exempt file and send the next reader to the files rather than to the parse. Nine
files are exempt: counted by reading each tracked file's bytes at `f4c2ba1` and keeping the ones
carrying no prefixed line, and confirmed by `npm run check:headers` reporting no finding across
the 128 tracked files it reads.
