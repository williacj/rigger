ABOUTME: Records the timer guard's placement, test-first checks and host-test classification for card 1137.

# Deterministic timer bound

Card [#1137](https://github.com/williacj/rigger/issues/1137), acceptance revision
`98b0a2865bba`, implements [D29 rule 3.5 and D30 rule 6](../spec/decisions.md) in
the existing suite guard. Its placement follows the
[architect's ruling](https://github.com/williacj/rigger/issues/740#issuecomment-6497153704)
and its fourth and fifth amendments. It answers the
[owner's direction](https://github.com/williacj/rigger/issues/740#issuecomment-6497180994)
to stop bad tests before they become debt.

The [author's acceptance amendment](https://github.com/williacj/rigger/issues/1137#issuecomment-6680962934)
exempts the two named filesystem-premise skips only with their stated reason.
The full host log and each exemption's evidence belong to the PR.

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

The first judges found two instances of item 1's refusal class: a caught
source call after root teardown could leave a successful worker, and a refusal
assertion could miss a native timer armed before the expected exception. The
regressions enumerate module evaluation, suite declaration, hooks, test bodies,
concurrent and nested work, delayed continuations, and process termination.
They exercise ordinary completion overrides, promise rejection handlers and
Node's global exception and rejection handlers. Their phase and attempt ledger
establishes which work actually ran, independently of the refusal diagnostic.

The [round-three author amendment](https://github.com/williacj/rigger/issues/1137#issuecomment-6686375354)
places refusal persistence in `test/suite.sh`. The runner creates a file inside
its own run directory and passes its path to the preload. Each bounded arm
appends its file, owning test, API and numeric delay synchronously before
throwing. The runner prints that file and fails on it after its worker ends.
A worker returning, resetting its exit status, exiting inside its exit listener,
using `reallyExit`, or killing itself cannot erase that recorded refusal.
The worker captures the destination before deleting its environment variable.
A failed append is reported and still throws the refusal before any native arm.

The [reviewer](https://github.com/williacj/rigger/pull/1254#issuecomment-6686112520)
and [architect](https://github.com/williacj/rigger/pull/1254#issuecomment-6685958817)
showed that an exit listener can terminate before a worker-local finally or async
after hook runs. The parent record replaces those retention hooks. The existing
Node test hooks still fail the actual violating test when a source catches its
error while that test runs. Conversion recording keeps its separate destination,
ran/arm writes and R0–R8 interface.

The refusal fixtures scope a public async-resource observer to each API attempt.
They require no native Timeout creation, no native timer callback dispatch and
no user callback effect. Separate conversion-worker controls establish that the
observer sees each API's real native resource and dispatch. A cleared native
timer still fails that assertion. Guarded mutations arm the real API or execute
the callback before the expected refusal, so a useful diagnostic message cannot
hide an earlier native effect. The PR holds the complete matrix, test-first
failures and final-head receipts.

The return ledger applies to the exit-event phase as well as every other phase.
Every error-discard path must actually return normally before a cell can claim
that a successful source completion still fails its worker. Retained Node 26
exit fixtures established that premise before the assertion was strengthened.

Node's timeout promisify accessor must survive the wrapper. Copying its descriptor
keeps its lazy lookup of the guarded promise API; copying the accessor's current
value would cache a native function. Node can also have promisified its native
promise function before this preload, leaving a self-reference in that function's
custom descriptor. The wrapper redirects that self-reference to itself. The
regressions check allowed zero-delay values, positive refusal without native
effects, conversion recording, and the pre-existing promisify cache.
