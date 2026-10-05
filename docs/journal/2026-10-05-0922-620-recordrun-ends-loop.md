ABOUTME: Why the report test's loop recorder drains the run before surfacing a failed wait.

# End the recorded run before reporting a failed wait

`recordRun` starts L3's real loop, then waits for stand-in makers so report tests can read its stream. A failed positive wait or held-maker check used to reject while that loop still held claims. The test's teardown could then remove the directories the loop still used, letting repeated attempts continue beyond the failed test (#620).

The recorder now makes every later L2 decision `ignore` when a wait or check fails. It releases each stand-in that becomes held, waits for the run to settle, sets aside the run's own rejection, and rethrows the original failure. The successful path still follows the same waits, releases, run and final check.

The new tests force the first wait under `run` and `pull`, the held check under both, and the later wait under `run`. They compare each L3 pull with its slot release and check every recorded maker pid after `recordRun` rejects. The waits are forced by changing the test's expected card count after the board and stand-ins are built, or by naming a card that is not held; neither needs host load or a sleep.
