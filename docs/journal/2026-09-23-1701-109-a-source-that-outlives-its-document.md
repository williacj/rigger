ABOUTME: A journal entry from card #109: A source that outlives its document

## 2026-09-23 — A source that outlives its document

`scripts/absorption-check.mjs` read a section of `ARCHITECTURE.md` that `755c809` deleted, and
`755c809` is the commit that added the script. It had never once run its two-document form. The
card said to repoint it at a live section, and the acceptance said to choose that section by
tracing each dissolved clause to where it lives today.

**The trace disproved the acceptance that demanded it.** All eight clauses survive, none survived
nowhere, and every one became a row in `docs/spec/requirements.md`. But the register is a table
read by `rows()`, and a source is read by `bullets()`, which needs a heading and `- ` bullets. The
thing carrying the clauses was the script's own destination, and no section anywhere carried them
in a form the script could be pointed at. `755c809` dissolved that section rather than moving it.

So the first round escalated instead of shipping. That was only possible because the item said
*established by tracing each clause* rather than *repoint it at a live section*. Under the looser
wording a maker picks the closest-looking section and ships; here the closest-looking section was
`README.md`'s Security, which exits zero, compares thirteen real clauses, and carries five of the
eight — a result that would have read as a pass and been wrong about what it proved. The item that
made the acceptance unsatisfiable is the same item that made the unsatisfiability provable. An
acceptance that says how a choice must be established, and not merely what to choose, fails loudly
where a looser one fails silently.

The measurement is what turned an argument into a fact: running the script's own `bullets()` over
every heading in `ARCHITECTURE.md`, exactly one section yields more than one clause. That is a
sentence nobody can disagree with, and it cost one command.

**The owner's answer was to stop looking for a live section.** The source became a git ref —
`755c809^:ARCHITECTURE.md` — so the check compares the eight invariants against the register they
became. A ref cannot dissolve the way a section can, which is the property every live candidate
lacked. The script now works for the first time since it was written, and its top match for each
clause independently reproduced the hand trace: `R-STATE-1` at 1.00, `R-ESCALATE-5` at 0.89,
`R-WORK-4` at 0.67.

**A source read at a ref gives the suite a dependency no other test had.** Every other test in
this repository reads the working tree. This one reads history, and `actions/checkout` clones to a
depth of 1, where `755c809` is absent. A depth-1 clone of the branch fails that one test; the same
clone passes all seventeen after `git fetch --unshallow` takes it from 1 commit to 282. The cost
of a durable source is that the durability has to be fetched, and the place that bites is CI
rather than any developer's machine, because a developer's clone is deep by accident. Worth
remembering the next time something reads a ref: the working tree is what a checkout gives you for
free, and history is not.

**The floor was forced by the measurement rather than chosen.** `bullets()` returns the prose
between a heading and the first bullet as a clause, so a bullet-free section yields exactly one: a
blob carrying a whole section's vocabulary, which overlaps most of a register and reports as
absorbed. Pointed at `## The gate`, the old script matched 81 of 99 rows and exited 0 having
compared nothing — card #57's false green, one layer over, on the section rather than the argument
vector. Across the 225 `## ` sections in the 61 tracked markdown files, every bullet-free section
yielded exactly one clause, 162 of them without exception, and every section with a bullet yielded
at least two. So the floor is 2: the only value that refuses every bullet-free section while
admitting every real list. A floor of 3 refuses `.claude/agents/reviewer.md`'s "What you rule on",
which the test says by name when the number is moved. A threshold with that shape needs no
defending, because the measurement picks it and the test re-picks it whenever the documents move.

**Adding the floor broke a sibling fixture, and the fix was to grow the fixture, not the
assertion.** Card #57's orphan test used a source of one bullet, which the floor now refuses
before the comparison it exists to test can run. Weakening the assertion would have been the
cheap move and would have quietly retired #57's guarantee. Giving the fixture a second orphan
keeps every clause rendering exactly as it did on `65a7de7` and moves only the count line. When a
new guard makes an old test's fixture illegal, the fixture is what is out of date.
