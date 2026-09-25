ABOUTME: Records card #208, which moved R-SCHED-2's citation from M1's concurrency exit test to
M4's, and why M4 rather than M2 is the first milestone that can prove it.

# 2026-09-24 — A claim is not a running card

`R-SCHED-2` caps how many cards *run* at once. M1 can only count claims, and a claim stops
counting the moment the run that holds it dies. The reviewer's R3-B3 showed two ways more cards
run than claims admit: a killed engine's makers still working after a restart, and a grandchild
still working after its parent exits. Neither is visible to a count of claims.

The milestone that can prove the cap needs two things at once: processes to contain, and cards
being run as processes. M2 builds the containment, but its `run` executes commands and no card is
dispatched. M3 runs provisioning steps, and still no maker. The plan's M4 says it is the first
milestone in which `once` or `run` dispatches a card. So M4 is the first milestone where both
exist, and M2 alone would have cited a requirement nothing there can make true.

The new exit test defines running by processes rather than by claims, because a definition by
claims is exactly the gap R3-B3 found. It counts distinct cards, and that nearly made the restart
half toothless. A restarted engine usually redoes the very cards the killed run left behind, so
a survivor and its redo are one card, and the count stays at the setting. Restarting under a
lower setting is what makes the survivors show: without kill-recorded-on-start, two surviving
cards run under a setting of one. Without kill-all, the lingering grandchild's card is a third
running card under a setting of two.

M1's concurrency test keeps its claim count and loses only the citation. It still catches a
scheduler that over-claims, which is all M1 has the processes to show.
