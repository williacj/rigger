ABOUTME: Records round 1 of card 661: incomplete replace-rule checks must hold Done back,
and removal's refusal and event tests must discriminate on the real paths.

# A check that did not finish has made no refusal

The PM added the failed-check row to acceptance revision `3c0ba9995350`. A completed replace
rule can refuse a path without blocking Done. A git or filesystem failure gives no such verdict,
so the card must remain available to a later pull. L1 marks explicit rule refusals and treats
other failures as failed removals, including reads before any removal began.

L0's recognition previously answered no for every nonzero git exit. Removal now asks it to reject
failed checks. A missing .git entry still establishes that a path is not a linked worktree;
an unreadable entry or a failing git question does not. The make callers retain their existing
recognition contract. Removal also accepts the same timeout input as the workspace make so a
test can exercise a check that does not answer without waiting for the production deadline.

# Making and removal share the scratch rule

The scratch check sequence is one function called by both making and removal. The removal tests
keep a checkout above, another repository's checkout inside, and registered worktrees at, above
or inside the scratch path. Their contents and branches remain, and L1 names each refused role
path. The test whose .git entry remained visible no longer claims R-WORK-29; the tests that move
that entry aside discriminate on registration.

# The record must name what remains

A topic directory can be gone before the sink refuses its workspace.removed event. L1 propagates
EVENT_REFUSED at that point and emits no workspace.left for the gone directory. A real removal
pass with one failed judge directory continues through later judge and scratch directories,
names every remaining path, and holds the board move until a later successful pass.

The lane and pull tests compare the complete list of the card's L3 events. Guarded additions of
a second merge.start or pull fail these R-WORK-30 tests. A guarded early abort fails the real
removal test. These proofs close gaps that the earlier stub-only and L1-only assertions missed.
