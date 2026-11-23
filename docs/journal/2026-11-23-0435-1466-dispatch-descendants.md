<!-- ABOUTME: Records card 1466's running-dispatch descendant tracker and its bounded exit cleanup. -->

# Card 1466 — dispatch descendants

Acceptance revision K7 9d0c9539e0c1 defines this work. The implementation follows
R-STATE-29 and ARCHITECTURE.md's tracker in “Failure model” and eight read deadlines
in “Supervising `run`”. L1 enables tracking for dispatches; ordinary L0 commands keep
their group containment. Record persistence and restart belong to card 1467.

The tracker reads one whole process table for the running dispatches sharing a host,
closes their descendant sets, and retains each pid's first start time. A final read
precedes the tracked-set sweep, group kill and directory sweep. The existing sweep
confirms tracked identities while stopped. Exit cleanup shares one directory sweep
across the dispatch's workspace and scratch directory to preserve EXIT_BOUND.

The test-first evidence retained in the external codex-1466-tmp directory includes
1466-t1-red.log, 1466-t11-red.log, 1466-exit-red.log and 1466-t15-red.log.
The initial deterministic baseline passed at 3e325ab8 (baseline-full.log).
The complete local deterministic run passed on 2026-11-23 before the G5 schedule
mark adjustment (1466-full-local.log). After that adjustment the affected budget,
output and network files passed (1466-granted-mark-final.log). These are development
measurements; final head verification and mutation receipts accompany the PR.

G1 and G7 keep the directory sweep's subjects outside the dispatch's descendant
tree. G2 retargets the network inventory and statement pins. G3 names the added
fixtures; G4 adds whole-table answers; G5 accounts for tracker reads and the shared
exit sweep; G6 separates the call timeout from the tracker's marked schedule.
No existing assertion is removed. The derived matrix is regenerated.

The PR will retain failed attempts as well as successful verification. Item 27's
full_host evidence remains pending the owner's ci:full sequence under M8-U39/U94.
Local process evidence is macOS only; Linux remains unproved under D13.
