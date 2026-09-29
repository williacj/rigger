ABOUTME: Journal for #374 (M2-06b): L0's exit cleanup records only what it killed, records every
process its kill ended, and waits out a process table that never answers once, not once a group.

# #374 — The exit cleanup records only what it killed

## What was built

- The call's kill (`killedOf`) and its last read before the group's kill (`outlived`) now yield
  their reads and pauses, as the census already did. So the exit cleanup runs the same census, kill
  and last read as the call, synchronously and without pauses.
- So the exit cleanup no longer records a survivor that exited on its own as killed. It records
  the group's kill where a census or a kill left out a live member, or where their reads failed.
- A read of the process table that the exit cleanup gives up on marks that `ps` as unanswered for
  the rest of that cleanup, and every later read of it fails at once, saying so. Three groups and
  a `ps` that never answers now cost one read timeout, where they had cost two a group.

## What we learned

- A `/bin/sh` that `SIGSTOP` holds did not keep its exited child as a zombie in one run by hand on
  macOS 27.0 on 2026-09-28: the child was gone at once. The fixture for a survivor that exits on
  its own is perl, as the adapter's own tests already used.
- The `ps-join` fixture held the first read of the group that was not the census's. That read is
  now the kill's, so the fixture holds the confirmation's read by its columns, as it meant to.

## What failed

- A cleanup-wide deadline was tried first. It bounded the delay, but a group read after the
  deadline was recorded with a reason of running out of time, not that the table never answered.
  The existing tests for a hung table require the second reason, so each group now says why.
- Driving `outlived` through the shared reader first gave up its reads at its own deadline. On a
  fresh clone at `5646285`, under a load average near 109, a read begun just before the deadline
  timed out, and `test/process-adapter.test.mjs`'s test of reads that list nothing got the wrong
  reason. Its reads now run up to a read timeout past that deadline, so each again has a whole
  read timeout of its own, as it had before.
- The base suite, run once on a fresh clone at `f9d57f7`, cancelled one exit-cleanup test at its
  30 s bound under a load average near 24. It passed in three reruns of that file.

## Round 2

- Both judges found a process that joined the group after `outlived`'s read was killed by the
  confirmation and recorded nowhere. The confirmation now reads the group once before its first
  kill, and a live member any of its reads finds is recorded as the kill of the group.
- Recording only what a read after the kill found was not enough. The confirmation's first kill
  ended the joiner, and its parent outside the group reaped it before the read, so the read found
  only zombies. So the read comes first.
- `ps-join` now lets its joiner in during a confirmation read after the first kill, so the test
  again fails where the confirmation kills only once. It also asserts the joiner is recorded.
