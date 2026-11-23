<!-- ABOUTME: Records #1465's ARCHITECTURE.md delta placing R-STATE-29's tracker in L0's process adapter, and why the exit bound's deadlines were repartitioned to keep EXIT_BOUND at 55 s. -->
# #1465: where a dispatch's descendants are tracked

## What landed

"Failure model" now has L0's process adapter read the whole process table once a second while a dispatch runs, track each process outside the group whose parent is in it or tracked, and end that set before the group kill at every ending. L1 records the set in the dispatch's entry. The design is the architect's ruling at [1293#7073488047](https://github.com/williacj/rigger/issues/1293#issuecomment-7073488047), under M8-U96 to M8-U98.

## The exit bound had no room

`src/substrate/process.mjs` at `7e898b2a` gives the one in-progress dispatch's careful cleanup exactly 40 s of read deadlines: 5 for the census, 5 and 5 spare before the kill, 5 for the confirmation, and 5 and 5 for each of two directories. That is `EXIT_BOUND` (55 s) less `EXIT_CARE_BOUND` (15 s), with nothing spare. The tracked set's final read and confirmation, through the sweep's loop, need two more read timeouts. Keeping `EXIT_BOUND` at 55 s therefore needed 10 s back from somewhere.

The delta takes it from the directory sweep: at exit, L0 sweeps a dispatch's directories in one pass of the loop. `ARCHITECTURE.md` already defines the sweep as one selector, processes working in either directory, so one pass changes no rule, only how many listings the exit path makes. The rejected alternatives were lowering `EXIT_CARE_BOUND` below Q-e2's 5.5 s premise, and shortening `READ_TIMEOUT` on the exit path alone.

What would reverse it: a host test showing one listing of both directories outlasting one `READ_TIMEOUT` where two listings each fit theirs.
