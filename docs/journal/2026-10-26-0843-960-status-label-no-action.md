ABOUTME: Records the status-label no-action change and the proof for card #960.

# Status issues have no card action

Card #960 closes `R-SCHED-27`'s counted test gap. L2 now answers `ignore` for an item carrying `FIXED_LABELS.status` before it considers escalation, kind selection, pull requests or closed-history removal. `plan` and `once` consume that answer through their existing facts and pull paths.

The deterministic base at `533ea6b07f432e96d7a4e46805320abb9a921205` passed `npm test`: 2,938 tests, zero failures and zero skips. The first new test, “a Ready item carrying rigger:status has no card action,” failed at L2 with `{ action: 'dispatch', kind: 'change' }` instead of `{ action: 'ignore' }`. The guard made the same named file green. The expanded affected-file run passed 169 tests across `test/next-action.test.mjs`, `test/once.test.mjs` and `test/plan.test.mjs`.

The L2 tests cover each in-scope row of Table A, including the escalation label with a merged pull and the closed-pull removal path. The `once` test uses a fake forge holding those paths and preserved directory markers; it checks that no claim, dispatch, column move, merge, escalation, label removal or directory removal is sent. The `plan` test checks that a Ready status issue is absent from both pulls and refusal counts.

[U26](https://github.com/williacj/rigger/issues/740#issuecomment-6332304749) requires this card to claim `R-SCHED-27`, including its `rigger resume` clause. [The architect's Q1 ruling](https://github.com/williacj/rigger/issues/960#issuecomment-6416981315) places the clause's L2 proof at the next read after the label is absent, regardless of who removed it. Both L2 and `once` tests show that next read working the issue as an ordinary card. [The carry to M6-11c](https://github.com/williacj/rigger/issues/740#issuecomment-6416998469) requires that later card to test `resume`'s own label removal.

The test diff against `origin/main` adds lines only, so no existing test-line grant is needed. `npm run matrix` regenerated `docs/derived/test-matrix.md` with `R-SCHED-27` claimed.

The conflict-only catch-up merged `origin/main` at `5ebc4f04cd2f9e4ea63d0cf4fd30e51452c0f034` into the card head `653d1fe3debae2e43f358bb10504a27ebea11a49` without a conflict or a manual resolution. `npm run matrix:check` passed on the staged tree. The full `npm test` run through `suite-slot.sh` passed 2,969 of 2,970 tests, with no skips: “the target guard reports a held second-world board read before its shared bound” failed because its nested test timed out after 10,000 ms. The slot log measured one-minute load 18.92 at start and 30.73 at end; complete output is in `960-catchup-suite.log` under this card's scratch directory. [The #939 maker's earlier report](https://github.com/williacj/rigger/issues/939#issuecomment-6418335570) records the same test timing out at an unmodified base.

The coordinator directed a named rerun. `npm test -- test/loop.test.mjs` through the same slot passed all 126 tests, including that guard in 8,741 ms. The slot log measured one-minute load 8.29 at start and 6.92 at end; complete output is in `960-catchup-loop.log` under this card's scratch directory.
