ABOUTME: Journal for #340 (M2-05b): L1's kill of recorded groups, which on a start ends each
process group a dead engine recorded, once L0 has confirmed it is the group recorded.

# #340 — L1's kill of recorded groups

## What was built

- `src/substrate/process.mjs` reads a group leader's start time with `ps -o lstart=` in the step
  that spawns it, and hands it to `onGroup` beside the group. A read that fails ends the group, as
  a hand-off that throws does. `killRecordedGroup` reads the start time of every live process in
  a recorded group and applies the check: a live leader must match the entry, and a leaderless
  group must hold no member that started before the recorded leader. It kills a confirmed group
  census first, as the survivor kill does, and records each kill as `recorded.killed`.
- `src/execution/run.mjs` gains `killRecordedGroups`, which hands each entry to L0 under the
  entry's dispatch and card. It then keeps only the entries L0 could not confirm, and rejects
  naming them and every kill the sink refused.
- `src/execution/groups.mjs` refuses, naming its file, a record that is not a list of entries.
  That includes an entry with no start time, or a group id of 1 or less, which L0 would signal as
  launchd, its own group, or every process.
- Two of #339's tests in `test/dispatch.test.mjs` changed with the entry. The entry with no card
  now carries its start time too. The test of an entry kept on another rejection handed L0 a pid
  no process held, whose start L0 now cannot read; it hands over the pid of a group the test holds.

## What we learned

- **`ps -g` lists a group whose leader has exited.** The leaderless rule needs to read those
  members, so this was measured first: a leader that started a `sleep` and exited left the `sleep`
  listed under `ps -g <leader pid>`, macOS 27.0, 2026-09-27.
- **`lstart` prints in the host's zone, with no zone in the text.** The same process read
  `Sun Sep 27 22:50:08 2026` under the host's zone and `Mon Sep 28 03:50:08 2026` under `TZ=UTC0`.
  So every `ps` run L0 makes is given UTC as well as its locale.
- **A test's group must not be the test's own child.** A leader the test spawned stays a zombie
  until Node reaps it, and a zombie answers signal 0, so it read as alive after the kill. The
  fixture now has Perl fork and exit, and the fork makes the group and runs the leader, so the
  system reaps it, as it would a dead engine's.
- **Mutations shown to discriminate** (anchor found once, diff shown, the file restored
  byte-exact, run on `test/kill-recorded.test.mjs`'s 12 tests unless named):
  - `start >= started` made `true`: only "a live member of which started before the entry's
    leader" failed, on "the member was killed".
  - `kept.push(entry)` dropped: only the never-answering read's test failed, on the record.
  - A refused event taken as an unconfirmed group: only the refusing sink's test failed.
  - `entry.group > 1` dropped: only the unreadable record's test failed, on the group 1 content.
  - The early return on an empty record dropped: only "given no record" failed.
  - `onGroup` handed `undefined` for the start (43 tests in `test/process-adapter.test.mjs`):
    the start-time test failed on its assertion, and the failing-read test at its 20 s bound.

## What failed

- **A mutant hung the adapter's file.** The failing-read test had no bound, so a mutant that
  called `onGroup` left `tail` running and the call never settled. Both new adapter tests now take
  the file's `SETTLES_WITHIN`, moved to the top of the file so they can use it.
- **The lint on spawned environments caught a fixture.** The rewritten "L0 rejects for any
  reason" test spawned its held group with no `env`, and `test/git-environment.test.mjs` refused
  it. It is now handed an empty one.
- **Round 1 let a malformed card through.** The reader checked every field but `card`, so a
  record holding `card: {"unexpected": true}` was read, acted on, and rewritten to `[]` (Codex's
  judge, item 11). The reader now requires a card, where there is one, to be a positive integer;
  two such contents, each ahead of a valid entry, join the unreadable-record test. Dropping the
  check fails that test on the object card.
- **Round 1's rewrite could hide the kills it was reporting.** Where the sink refused the kills
  and the record then refused its rewrite, the record's `EACCES` replaced the unrecorded kills,
  the defect #339's judges found as N4 (Codex's judge, non-blocking here). The rewrite's failure
  now rides on the rejection as `recordFailure`, and a test holds the state directory read-only
  under a refusing sink.
- **Round 2's stricter reader made `dispatch` able to poison the record.** `dispatch` still wrote
  whatever id and card it was given, so a card of `null`, `'1412'` or `0` wrote an entry the
  reader then refused, stopping every later dispatch and start (the engineer judge's N5). The
  reader and `dispatch` now share one check, `holdsDispatch`, and `dispatch` refuses before it
  spawns. A test gives five such calls, and then shows a good dispatch still recorded in the same
  state directory.
