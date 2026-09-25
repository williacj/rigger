ABOUTME: Records card #208, which moved R-SCHED-2's citation from M1's concurrency exit test to
M4's, and why M4 rather than M2 is the first milestone that can prove it.

# 2026-09-24 — A claim is not a running card

`R-SCHED-2` caps how many cards *run* at once. M1 can count only claims, and a claim stops
counting the moment the run that holds it dies. The reviewer's R3-B3 showed that a killed
engine's makers keep working after a restart, so more cards can run than any run's claims admit.

The milestone that can prove the cap needs two things at once: processes to contain, and cards
being run as processes. M2 builds the containment, but its `run` executes commands and no card is
dispatched. M3 runs provisioning steps, and still no maker. The plan's M4 says it is the first
milestone in which `once` or `run` dispatches a card. So M4 is the first milestone where both
exist, and M2 alone would have cited a requirement nothing there can make true.

The new exit test defines running by processes rather than by claims, because a definition by
claims is exactly the gap R3-B3 found. Two choices give the restart its teeth.

The first choice is the lower setting. A restarted engine usually redoes the very cards the
killed run left behind, so a survivor and its redo are one card. At an unchanged setting the
count stays within it, even with no kill at all. Restarting under a lower setting is what makes
the survivors show: two surviving cards run under a setting of one.

The second choice is makers that never exit on their own. The first draft only said the makers
ran at the kill. Stub makers that exited before the restart then passed whether or not the
engine killed recorded groups on start, and the reviewer ruled that item 4 was unmet. The test
now checks the bound while the survivors would still be running unless something killed them.

A round-2 clause also had a maker leave a lingering grandchild before the kill, to exercise
kill-all at dispatch end. The owner had it deleted. M2's exit test already requires that
grandchild to be dead before its dispatch returns, and the card asked only about a restart. The
engineer and the architect both found the clause contradicted itself.

M1's concurrency test keeps its claim count and loses only the citation. It still catches a
scheduler that over-claims, which is all M1 has the processes to show.
