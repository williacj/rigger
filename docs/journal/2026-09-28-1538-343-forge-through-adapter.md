ABOUTME: Journal for #343 (M2-07a): the forge runners and sides sending through L0's process
adapter, with a timeout and a recorded kill, and the verbs that open a sink for them.

# #343 — The forge sends through the adapter

## What was built

- The runners' one spawn is now `runCommand`, with an `L0` emitter and `FORGE_TIMEOUT` unless the
  caller passes another value. The runners, their own reads and the sides became asynchronous.
- Every verb that builds a forge side opens its sink through `src/cli/recording.mjs` before its
  first spawn, hands L0 the sink's end, and ends it in a `finally`. `STATE` moved there from
  `report.mjs`, because `doctor` now needs it and `report.mjs` imports `doctor.mjs`.
- L2 opens the move's emitter under the card, and the item-write side takes it per move.

## What we learned

- **A synchronous spawn serialised L3's claims.** L3 moves the cards it claims with
  `Promise.allSettled`. Under `spawnSync` each move finished before the next began. Under the
  adapter they overlap. So the fake `gh`, which rewrote one state file per call, lost moves: on
  2026-09-28, `test/run.test.mjs` failed "claims exactly three cards" in one of three runs. The
  fake now holds a lock file from its first read of the board to its last write. Two `run` tests
  compared transition events and moves in claim order. That order held only because the spawn
  blocked, so they now compare by card.
- **The first red was a hang.** Given a stand-in whose child held the output pipe, the base's
  read never settled. The run ended 133 s later, when an outside `pkill` ended the child.
- **Mutations shown to discriminate** (anchor found once, the diff read back, the file restored
  with `git checkout`, `git status` clean):
  - The spawn returning a refused kill's result instead of rejecting: 3 of the 8 tests in
    `test/verb-forge-kill.test.mjs` failed, each on its assertion that the output names the
    unrecorded kill.
  - `recording` never naming the state directory: all 8 failed. The kills went to standard
    error at the sink's end, and not to the stream.
  - `firstLine` without its timeout line: 1 of the 9 tests in `test/forge-spawn.test.mjs`
    failed, the one that reads the timeout's message.
