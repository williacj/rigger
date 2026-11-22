<!-- ABOUTME: Records #1464's proposal of R-STATE-29, that Rigger ends a dispatch's descendants after they leave its process group, with the evidence, rulings and carve-out behind it. -->
# R-STATE-29: a dispatch's descendants

## Why

Spike #1430 measured today's kill route leaving fixture member M6 alive on macOS and Linux. M6 starts a new session, then works in `/`. On macOS the group kill alone also left M3 alive (`docs/spikes/whole-tree-containment.md`, "The answer" and "Round 2", merged in #1432). `R-STATE-17` excludes such a process: one in no group Rigger created and working in no dispatch's directory "is outside this rule". The owner ruled the gap a v0 defect to fix in M8 (M8-U95, [1293#7072961912](https://github.com/williacj/rigger/issues/1293#issuecomment-7072961912)).

## How the row was shaped

- **The root cause, then its limit.** The owner first asked for the root cause: track a dispatch's descendants while its command runs (M8-U96, [1293#7073098191](https://github.com/williacj/rigger/issues/1293#issuecomment-7073098191)). The architect then measured, on macOS 27.2.1 on 2026-11-22, that back-to-back `ps` reads attributed an immediate double fork's grandchild 0 times in 20. `ps` gave neither an environment nor a session id. The architect's rulings are at [1293#7073488047](https://github.com/williacj/rigger/issues/1293#issuecomment-7073488047).
- **The owner's choice.** The owner chose polling once a second with identity by pid and start time, and named the immediate double fork as a known escape owned by the Temporal containment epic (M8-U98, [1293#7073483810](https://github.com/williacj/rigger/issues/1293#issuecomment-7073483810)).
- **No Linux proof.** Linux stays unproved under `D13` (M8-U97).
- **The reviewer's attack reshaped the table.** It made the cells exclusive by splitting what the reads showed from how Rigger ends the dispatch. It placed a descendant's read under `R-STATE-26`, gave a recorded descendant `R-STATE-11`'s confirmation guard, and added a cell for a failed read.
- **The claim exception.** The row lands with no claiming test under M8-U99 ([1293#7073723186](https://github.com/williacj/rigger/issues/1293#issuecomment-7073723186)), as #1433's rows did under M8-U83. #1466 (M8-39) and #1467 (M8-42) claim it before M8 closes.

## What follows

#1465 carries the `ARCHITECTURE.md` delta, then #1466 builds the tracker for a running Rigger, then #1467 builds the record and the restart.
