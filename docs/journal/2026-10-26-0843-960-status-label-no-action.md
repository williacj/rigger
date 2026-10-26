ABOUTME: Records the status-label no-action change and the proof for card #960.

# Status issues have no card action

Card #960 closes `R-SCHED-27`'s counted test gap. L2 now answers `ignore` for an item carrying `FIXED_LABELS.status` before it considers escalation, kind selection, pull requests or closed-history removal. `plan` and `once` consume that answer through their existing facts and pull paths.

The deterministic base at `533ea6b07f432e96d7a4e46805320abb9a921205` passed `npm test`: 2,938 tests, zero failures and zero skips. The first new test, “a Ready item carrying rigger:status has no card action,” failed at L2 with `{ action: 'dispatch', kind: 'change' }` instead of `{ action: 'ignore' }`. The guard made the same named file green. The expanded affected-file run passed 169 tests across `test/next-action.test.mjs`, `test/once.test.mjs` and `test/plan.test.mjs`.

The L2 tests cover each in-scope row of Table A, including the escalation label with a merged pull and the closed-pull removal path. The `once` test uses a fake forge holding those paths and preserved directory markers; it checks that no claim, dispatch, column move, merge, escalation, label removal or directory removal is sent. The `plan` test checks that a Ready status issue is absent from both pulls and refusal counts.

[U26](https://github.com/williacj/rigger/issues/740#issuecomment-6332304749) requires this card to claim `R-SCHED-27`, including its `rigger resume` clause. [The architect's Q1 ruling](https://github.com/williacj/rigger/issues/960#issuecomment-6416981315) places the clause's L2 proof at the next read after the label is absent, regardless of who removed it. Both L2 and `once` tests show that next read working the issue as an ordinary card. [The carry to M6-11c](https://github.com/williacj/rigger/issues/740#issuecomment-6416998469) requires that later card to test `resume`'s own label removal.

The test diff against `origin/main` adds lines only, so no existing test-line grant is needed. `npm run matrix` regenerated `docs/derived/test-matrix.md` with `R-SCHED-27` claimed.
