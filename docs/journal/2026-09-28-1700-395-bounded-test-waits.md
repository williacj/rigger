ABOUTME: Journal for #395 (M2-07e): every condition wait in a test file's own process stops when
its test ends, and the scratch teardown's pkill rounds are bounded, so a red test cannot hang the suite.

# #395 — A failing condition wait ends with its test

## What was built

`until` looped on `setImmediate` with no bound. A test that failed or timed out while its wait was
unmet left the loop spinning, and the loop held the test file's process open. So a red run of
`test/verb-forge-kill.test.mjs` became a hang.

`until(condition, t)` now takes its test. Every turn goes through `turn(t)`, which throws once `t`'s
signal has aborted. `node:test` aborts it when the test passes, fails or times out. The condition
stays the first argument, so the new test in `test/process-fixtures.test.mjs` runs unedited against
`until` as it was at the base, and fails there.

The tests' own loops that polled the same way take `turn(t)` too. `drive` in
`test/loop-world.mjs` and `runToEnd` in `test/loop.test.mjs` are bounded by rounds instead.
`drive` also runs in a child in `test/restart.test.mjs`, where no test exists to end, and its rounds
wait on nothing but steps already queued.

The scratch teardown's `pkill` loop is `sweep`, which makes at most ten rounds and then throws,
naming every pid still listed.

## What we learned

- **`t.signal` is the test's end.** A scratch probe with Node 26.5.0, 24 and 20.20.2 on macOS 27.0
  on 2026-09-28 saw it abort on a failed test and on a timed-out one, before the runner reported
  either.
- **A nested `node --test` needs `NODE_TEST_CONTEXT` removed.** With it inherited, the nested run
  reported to the outer runner, printed nothing, and exited 0 in about 60 ms.
- **A hung `node --test` does not end by the signal `spawnSync` sends.** When the bound killed it,
  the runner exited with status 7 and `signal` was null, so the test reads `spawnSync`'s
  `ETIMEDOUT` rather than the signal.
- **The teardown rarely loops.** Over three `npm test` runs on 2026-09-28, the 795 teardowns took
  at most two rounds. Each `pkill` round costs about 16 ms, so a guard of 1,000 rounds took 15.9 s.
