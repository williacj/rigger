ABOUTME: Records card #222, which published the priority declaration in the config shape, the
validator and both config files in one commit, and removed the paragraph that restated its line.

# 2026-09-24 — The ranking is the list

The declaration is optional, and its option list is refused only where it cannot rank. A board
with no declared priority ranks every card alike, oldest first. That is the Engine settings row's
shared bottom rank with nothing above it, so absence is a state Rigger already defines rather
than a fault.

A list can fail to rank in three ways, and each earns its own refusal. An empty list ranks
nothing. An entry that is no display name names no option on the board. An option listed twice
holds two ranks, so a card holding it has no one place to go. The refusal for a repeat names the
option, because the key alone would leave the reader scanning the list for it.

The four files had to move in one commit. `test/config.test.mjs` holds the validator to the
published shape in both directions, and `test/init.test.mjs` holds this repository's config to
the template. So a shape line without its validator reds the first test, and either config alone
reds one of them.

A restore during the work reverted more than the mutation it meant to undo. `git checkout --` on
an uncommitted file returns it to the last commit, which took the shape rules with the mutant.
The rules were written again, and the work was committed before going on.
