ABOUTME: Journal for #416 (M2-09a): why the restart tests sometimes saw the dead engine's processes
alive, and the fix, which has the test kill the engine only once its group is recorded.

# #416 — the restart tests kill the engine only once its group is recorded

## What was wrong

- The test was wrong, not the product. The processes the first board read found were alive, not
  zombies, and the restart never tried to kill them.
- `killedMidDispatch` in `test/restart-kill.test.mjs` sent the engine SIGKILL as soon as the
  command marked `ready`. The engine records the command's group only after L0 has read the
  command's start time. The command runs on meanwhile, so on a loaded host `ready` can come first.
- A kill then lands in the window between the spawn and the entry's write. The owner left that
  window open (round 4, and the architect's ruling 3, §6, on #332), and the note beside the write
  in `src/execution/run.mjs` records it. The record holds no entry, so the restart ends nothing.
  `R-STATE-10` asks a start to end only what it recorded, so the product met it.

## Evidence

- **Instrumented runs.** A clone of `main` at `a901fce` was instrumented. Its first-call stand-in
  printed `ps`'s state, parent and group for each pid signal 0 reached. L0 traced each start-time
  read, each kill decision and how `ended` settled, and the test traced its kill of the engine.
  - Where: macOS 27.0 (26A428), 12 cores, Node 26.5.0, the whole `npm test` three at a time.
  - Load: averages of 40 to 70, part of it from other sessions on the host.
  - Result: 2 recurrences in 60 whole suites, both on "…leaves neither alive…" (`rigger once` in one
    campaign, `rigger run` in the other). Each first call found the command in state `Ss` and its
    child in `S`, both running. In the second, traced, one, the engine had not returned from its
    start-time read when the test killed it. The restart read an empty record, and L0's kill never
    ran.
  - Over the 179 other engine kills traced, the kill came 4 to 91 ms after the start-time read
    returned. So the entry's write normally beats the kill by milliseconds.
- **The zombie reading ruled out.** Two measurements, on the same host and Node:
  - L0's `ended` waits `UNREAPED_BOUND` (1 s) before settling on a group that holds only zombies.
    A group whose only member is an unreaped zombie answered signal 0 with `EPERM` in 20 of 20
    groups, and `occupied` counts `EPERM`. That was at a load average of about 12.
  - launchd reaped 300 orphans SIGKILL ended in a median of 4.9 ms, 73 ms at most, at a load
    average of about 70.
  - So a zombie at the first call needs launchd to lag over 1 s. None of the 300 did.
  - Across 90 targeted runs of the leaderless test and the 60 whole suites, 568 kills were traced
    in a consumer's repository. Every one found the group empty at `ended`'s first look.
- **Forced reproduction.** The new test in `test/restart-kill.test.mjs` hands the engine a `ps`
  whose start-time read waits until the test releases it. The test releases it once the command
  has marked `ready` and a turn has passed.
  - Base: with the test file copied onto `a901fce` and only `killedMidDispatch` left as it was
    there, the test fails as PR #413's run did: `child N alive`, with the restart's usual output.
  - Head: it passes, with the test itself unchanged.

## What we learned

- **Two signals from two processes are not ordered.** `ready` comes from the command and the entry
  comes from the engine. A test that means "after the group is recorded" has to wait on the record.
- **Read the process's state before naming the hypothesis.** The zombie explanation fit the one
  line PR #413 had. Printing `ps`'s state at the first call settled it in a single recurrence.
- **Instrumentation can fail other tests.** The traces in `src/` failed the boundary and
  record-path tests in every instrumented suite. Only the restart tests' failures there counted.
