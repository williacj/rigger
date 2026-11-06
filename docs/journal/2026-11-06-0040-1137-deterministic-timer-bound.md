ABOUTME: Records the timer guard's placement, test-first checks and host-test classification for card 1137.

# Deterministic timer bound

Card [#1137](https://github.com/williacj/rigger/issues/1137), acceptance revision
`e889a34b32e1`, implements [D29 rule 3.5 and D30 rule 6](../spec/decisions.md) in
the existing suite guard. Its placement follows the
[architect's ruling](https://github.com/williacj/rigger/issues/740#issuecomment-6497153704)
and its fourth and fifth amendments. It answers the
[owner's direction](https://github.com/williacj/rigger/issues/740#issuecomment-6497180994)
to stop bad tests before they become debt.

The callback and promise APIs share one observer in `test/suite-guard.cjs`.
The promise interval remains lazy: creating its iterator arms nothing. Only an
immediate caller in Node's test runner is excluded, so a test's timer cannot
borrow an exclusion from a deeper harness frame. Calls answered by Node's timer
mock replace the observed function and arm no native timer.

Async-resource ownership survives a test's return. The record walks that owner
to its top-level test or suite. Refusal state belongs to the actual test context,
so a concurrent clean subtest cannot consume another subtest's caught error.
The ran and arm lines have separate writes. The worker captures its record
destination before removing the environment variable from nested runs.

`test/suite-tiers.test.mjs` is host-listed by [the suite](../../test/suite.sh).
This card's new tests are therefore added host tests under D29 rule 11. They
exercise Node worker/preload wiring and native timer APIs, and depend on no
Rigger product decision. They have no declaration form until
[#1238](https://github.com/williacj/rigger/issues/1238), which treats them as base.
The author admits these harness diagnostics without `// proves`: the product
requirements do not specify Rigger's own suite tiers. The PR retains the guarded
diagnostic mutations required by this card.

The test-first runs exposed missing refusals for each API, swallowed errors,
missing ran and arm records, lost promise ownership and an inherited record
variable. Two further checks exposed an eager interval wrapper and a refusal
shared between concurrent subtests. Promise gates establish the asynchronous
ordering without elapsed-time assumptions. T1's immediately cleared timeout
also supplies T10's proof; R5 supplies T15's conversion-list proof.

Measured with `npm test` at cut commit
`f980746f11f2eac3b07216e646d2f84e42d284f1` on this Mac mini, Node 26.13.0,
on 2026-11-05–06: the first full run used a temporary positive-timer bound and
passed all 5,084 tests, with zero failures or cancellations. `uptime` reported
one-minute loads of 7.01 at start and 7.13 at end; the starting user process
count from `ps` was 627. The exact #1136 preload, SHA256
`e170a08705f2c9998ea534da5d80bdd9aacc5cae8932445175b74c3fb1aa2b22`, completed
all 45 cancellation-test bodies with an empty arm record.

Measured with `npm run test:host -- test/suite-tiers.test.mjs` at that same cut
commit on 2026-11-06: all 123 existing tests passed. `uptime` reported loads of
15.70 at start and 28.95 at end. Head verification, retained failure evidence,
fresh-clone counts, mutation receipts and CI evidence belong to the PR.
