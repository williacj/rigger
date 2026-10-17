ABOUTME: Records what card #697 found about the exit-sighting guard failures, and how the exit tests
now separate an answered confirmation from a real-deadline cutoff.

# Exit sightings and the real deadline

The exit cells U1, U2, C1, C2, B0, B1 and A0 (both endings) failed under host load at
`censusExit`'s live guard, and X0 failed at its order guard. Each exit runs with a 1,000 ms read
timeout. Its census needs 13 stand-in reads for a two-round cell, or 6 for C1 and C2, and every
one of them must finish inside that much wall time.

How much of the bound a census normally uses was measured, not judged. On 2026-10-14 the maker ran
`npm test -- test/never-stop.test.mjs` at `d92f7cf`, with one-minute load 14.99 at start and 15.75
at end, on 12 logical CPUs. The retained exit traces of that run's 16 exit attempts were read with
the card's `census-margin.mjs`. Each census took 73–166 ms. The run's originals are private under
O243; the PR's attempt ledger lists them as `n01`.

When the host stretches the reads further, `spawnSync` kills the read in flight at the deadline
with `ETIMEDOUT`, and `runOnce` marks that `ps` unanswered. Then one of two things happens:

- **A census round had completed.** `census` returns its last completed round, and `beforeKill`'s
  confirming read is refused before it starts.
- **No round had completed.** `census` throws.

In both cases the stand-in's only writer of `sighted-live` never runs. L0 still kills the group
and records `group.killed` with the timeout as its reason.

Controlled hangs and slowed reads reproduced this exact signature for every named cell, including
X0. A deadline passing between two reads did not reproduce it. The architect's D18 rule 2 ruling
found no L0 fault: an unreturned read is not evidence that a member was live, and no finite real
deadline guarantees an answer.

The repair is test-only, as owner rulings O268, O270 and O271 allow. A caller-side observer records
each clock check, read and signal of an exit to `exit-trace.jsonl`. The shared exit helper
classifies each exit from L0's own received reads, and the result takes one of three branches:

- **Answered.** Every old assertion still runs. One exception is O270's ordinary-A0 C3 window,
  where `:617` skips the cache check and claims no cache proof.
- **Traced cutoff.** The helper proves the real deadline, a successful group kill, and the complete
  reason on the one `group.killed`. The caller's scenario assertions then return.
- **Anything else.** The run is diagnostic and fails as it did before.

Forced variants cover the reachable cells that can be forced without a clock. These include A2p,
and an A2t variant that holds the real `/bin/ps -p` probe behind a full FIFO. A no-start `LATE`,
a spent decision deadline, and `B4` after any of F1, F2, F4 or F5L have no route without moving a
clock. Under O271, each of these gets full proof when it occurs naturally and is otherwise a named
residual risk.

Forward-only `Date.now` jumps were tried and withdrawn, because they count as a logical clock.

What remains unproved is listed in the pull request: the residual risks, and the C615-O9 `exiting`
ENOENT. The six answered controls still depend on the host answering within the bound, so a
stalled attempt is a failure in the ledger and never answered proof.

A nested answered run that its test abandons at the test's bound used to stay alive. Its pipes
then held the file's own process from exiting, so `node --test` waited on the file indefinitely.
This was proved red at `07aeabf` and green with the fix: an abandoned run's group is killed. An
exit caller abandoned at its bound did not hold the file, because the scratch teardown's sweep
ends it. Whether this leak is what held PR CI run 38947643018 is not shown.

The cutoff check compared only named kills, so the round-4 judge could inject an unended record
for a pid no read had returned and the check still passed. The check now compares every event's
kind and fields against the multiset the exit's reads support. That set holds the group's one
kill, the named kills, and an unended record for each member the reads after the kill left alive.
Each of three injected records is a named failure. The `X0 exit A3 failure` run, abandoned at its
bound or after its forced read, does not hold the file's process.
