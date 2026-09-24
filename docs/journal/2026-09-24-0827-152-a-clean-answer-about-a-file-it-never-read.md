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

That cost is measurable rather than theoretical. Adding `&& index < 2` to the prefixed-line test in
`headerRun`, so the reader looks only near the top, makes it miss the twelve `SKILL.md` files whose
headers sit on line 6 — measured by calling `check()` from that mutated
`scripts/aboutme-header-check.mjs` against this branch's own tree, the mutation being the one
recorded as M2 in PR #154. It reports each of the twelve as carrying no header at all. Every one of
those answers is about a file the reader stopped at line 2 of.

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
carrying no prefixed line, and confirmed by `npm run check:headers` on this branch reporting no
finding across the 131 tracked files it reads — 131 because the branch adds three files to the 128
`f4c2ba1` tracked, and the command does not exist at `f4c2ba1` to have read 128 of anything.

## What the first round got wrong, which is the same sentence again

PR #154's judge found the title of this entry sitting in the half of the check nobody had guarded.
The read was wrapped in `catch { return []; }`, so a file git tracked and the disk did not hold
became no finding at all. A root-only sparse checkout is enough to reach it: `git ls-files` lists
three files, two are on disk, and the check reported `0 header findings, across 3 tracked files`
and exited 0 — with the absent file being the one carrying a repeated prefix. The same swallow came
back with the path replaced by a directory, `EISDIR` instead of `ENOENT`.

The design took "a clean answer about a file it never read" out of the parse and the read handed
one straight back. The lesson is that a reader has two places to be honest and they are not the
same place: deciding nothing about where a header may sit buys nothing if the layer below quietly
decides that an unopenable file is fine. So an unreadable tracked file is now its own finding, and
the count line says `read of listed` rather than asserting a figure it did not measure.

Worth naming the inheritance: the identical `catch { return []; }` is in
`scripts/ruled-out-word-check.mjs`, which this check was modelled on and whose `trackedFiles` it
imports. The idiom was copied, not invented. What made it a decided behaviour rather than an
inherited accident was writing a test that asserted the skip cost no finding — a test can ratify a
defect as readily as it can catch one, and this one did.
