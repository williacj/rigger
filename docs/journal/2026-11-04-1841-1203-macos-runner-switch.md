ABOUTME: Card 1203's runner selection, test-first evidence and owner proof still required before merge.

# macOS runner selection

Card 1203, revision `bb02ec39dd3d`, pins the structure and the D31 proposal. The selector lives
in `CI_POLICY`'s plan action. Only the three named macOS jobs consume its runner output.
The collector compares webhook repository IDs before the plan can use the variable for a pull
request. A fork or unavailable identity selects hosted before validation. A same-repository run
validates the exact variable text only when broad proof or demo needs a macOS job.

The hook exports its event-file decision and its ancestor stop. Its CLI refusal lives separately
in `refuseJob`. By default it exits nonzero. The owner may set `RIGGER_JOB_GUARD_STOP_WORKER=1`
in the runner's environment if the controlled measurement prints its later-step marker, under
M7-U29. The stop follows only the hook's own parent chain, checks the exact executable basename
`Runner.Worker`, reads that identity again and signals that positive PID with SIGKILL. It refuses
missing, malformed, cyclic or changed ancestry without a signal. It never searches unrelated
processes or signals Runner.Listener. A failed stop logs its error and retains the nonzero exit.

The local host control uses a recorded shell surrogate named Runner.Worker and an intervening
Node process, as the runner may use its macOS Node invoker. With stopping disabled, a refused
hook exits 1 and continuation prints. With stopping enabled, an allowed hook exits 0 and
continuation prints. With stopping enabled and refusal, the surrogate ends by SIGKILL and
continuation does not print. This proves the local wiring, not the GitHub runner measurement. The intermediary independently
confirms its controlled parent is named Runner.Worker before invoking an enabled guard. The
ordinary decision-only CLI controls force the stop flag to 0 even if their caller inherits 1.
D31 and the new AGENTS.md bullet remain proposals for the owner's marker.

## Before implementation

Measured on macOS at base `1a34b28299a3d7926dfaa4820f0f34f5c601260b`, `npm ci` exited zero.
The host-slot `npm test` baseline passed with tests/pass/fail = 4792/4792/0; uptime's one-minute
load was 2.34 before and 6.53 after, and ps counted 571 user processes before it. The affected
host baseline, `npm test -- --host test/workflow-files.test.mjs`, passed with tests/pass/fail =
65/65/0; load was 5.46 before and 5.00 after, with 569 user processes before it.
All suite runs use `/Users/cjwilliams/Github/rigger-worktrees/codex-1203-tmp` as caller TMPDIR.
Complete outputs remain there under the `1203-` filenames named below and in the PR evidence.

Before writing code, I searched test sources for each Lands in path. The workflow bindings
include workflow-files, ci-policy-fixtures, ci-proof-source, ci-run-cancellation, demo, package,
build-test-matrix, test-list-growth and test-list-growth-host. AGENTS.md binds the self-hosting
list reader, closure checker, instruction budgets, maker instructions and header exemptions.
The decisions register binds document/reference, ID and spec-style checks. No dependency
required another edit path. The only existing test lines changed are workflow-files L29 and
L33, both covered by grant class 1, M7-K47. L32 and L34 stay as authored.

## Test order and observed red output

Each command below ran through `npm test`, with complete output teed before inspection.
The named logs are in the caller TMPDIR. The PR quotes the load and named assertion evidence.

| Log | Command after `npm test --` | Named failure before the corresponding implementation |
|---|---|---|
| 1203-red-selection.log | test/macos-runner.test.mjs | R1-R3: same-repository full runs emit the selected allowlisted runner as JSON: actual undefined, expected `"macos-latest"` |
| 1203-red-fork.log | test/macos-runner.test.mjs | R5: every fork variable state plans hosted jobs without changing their eligibility: actual Mini JSON, expected hosted JSON |
| 1203-red-invalid.log | test/macos-runner.test.mjs | R6: needed macOS jobs refuse every nonallowlisted value and name its exact text: Missing expected rejection: macos-latest |
| 1203-red-unused.log | test/macos-runner.test.mjs | R6a: runs needing no macOS job ignore malformed values and still admit fast: MACOS_RUNNER is outside the allowlist: "macos-latest" |
| 1203-red-wiring.log | test/macos-runner.test.mjs | runner wiring supplies exactly the three macOS jobs from the one plan output: actual undefined, expected steps.policy.outputs.runner expression |
| 1203-red-hook-allowed.log | test/macos-runner.test.mjs | R9: hook allows only the named trusted events and a same-repository pull request: schedule, actual undefined, expected true |
| 1203-red-hook-refused.log | test/macos-runner.test.mjs | R9: hook refuses unknown events forks deleted heads and unavailable event files: Cannot read properties of null (reading 'id') |
| 1203-red-hook-cli.log | --host --test-name-pattern='self-hosted job guard exits' test/workflow-files.test.mjs | self-hosted job guard exits zero only for allowed events in source and installed JS form: fork job status 0 !== 1 |
| 1203-red-runtime.log | --host --test-name-pattern='actual plan runtime reads' test/workflow-files.test.mjs | actual plan runtime reads the runner variable and publishes only allowlisted JSON or no output on refusal: actual macos-latest, expected Mini labels |
| 1203-red-worker-stop.log | test/macos-runner.test.mjs | worker stop signals only the exact Runner.Worker in its own parent chain: undefined !== 703 |
| 1203-red-worker-identity.log | test/macos-runner.test.mjs | worker stop refuses missing malformed cyclic and changed ancestor identities without a signal: Missing expected exception |
| 1203-red-worker-host-symlink.log | --host --test-name-pattern='opted-in refused hook' test/workflow-files.test.mjs | opted-in refused hook ends only its controlled Worker ancestor before continuation: null !== SIGKILL, with AFTER_GUARD printed |

The hook's function shell existed to make the first hook test runnable, with no decision body.
R4's test was added after selection code; its revert proof is required in the PR at the committed
head. R7 and R8 are invariant guards under M7-U15: reverting this PR preserves the aggregate
results and the unrelated literal runners. Their killed mutation receipts belong in the PR.
No test adds a product requirement declaration: the card claims none, and these assertions concern
this repository's CI and owner-installed hook, rather than a Rigger deployment.

## Owner acts and unproved host behaviour

The maker installed nothing on the runner, changed no repository setting or variable, touched
no actions-runner directory and ran no controlled refusal measurement. No value setter or clearing
time exists to report from this work. The owner must record who sets and clears each value and
when during the three CI proof runs. The maker added no labels and will not merge this card.

The controlled `if: always()` measurement, R9a's single-runner listing and hook messages,
the hosted/Mini/hosted proof sequence, Mini demo with preinstalled vhs, and the bootstrap runner
for the owner's marker are pending the owner. M7-U29 settles the conditional worker stop;
the owner has not yet measured whether to enable it. The card stays open. A real fork-account run is unproved; controlled R5 and R9 tests
supply the bounded selection and decision proof only.

No run exercised R10's failed-job re-run or R11's queued-job behaviour. No Mini proof-job timings
or writes under the owner's home were measured. Therefore there is no measured comparison with
the card's Serial jobs judgment, or a home-file inventory, yet. The temporary `.js` hook copy
was only a test fixture under the suite's temporary directory, never an installed runner hook.

## Table R15

Cases met beyond the normal valid identities were missing repository identity in existing
collector fixtures and malformed/missing PR-head identities in hook controls. Missing identity
cannot select the Mini; the default runner is hosted. The hook refuses a missing PR identity,
a string ID or a missing/deleted head. Unknown hook events, unreadable event paths and malformed
JSON are covered by R9 itself. Malformed variables, including reordered/spaced labels and an
embedded newline with a forged output line, are covered by R6/R6a. No encountered case selects
a runner outside the allowlist. No other R15 case was met.

## Retained failed attempts

The full proposed-tree run in 1203-proposed-suite.log reported tests/pass/fail = 4802/4801/1.
Its one-minute loads were 2.69 before and 6.37 after, with 563 user processes before it.
The named failure was `every backticked path in the checked documents exists or is exempt`,
reporting docs/spec/decisions.md's backticked ci.yml. This was the card's pinned D31 text.
The maker escalated it on card 1203. The PM's revision bb02ec39dd3d corrects that path, and
1203-path-correction.log records the existing path-check file green after applying the correction.
This is a fixed proposal defect, not a known-flake classification.

The first worker-host attempt (1203-red-worker-host.log) failed before its initial PID marker;
that attempt retained no child status or signal and earns no proof credit. Its diagnostic rerun
(1203-worker-host-fixture.log) records the copied Node executable's missing relative libnode
library and SIGABRT. The next attempt (1203-red-worker-host-valid.log) used a copied
system shell, which the host ended by SIGKILL before its initial PID marker. None is TDD red or
worker-stop evidence. The retained symlink fixture establishes its PID and reaches the actual
missing-stop assertion; its valid red and green outputs remain in 1203-red-worker-host-symlink.log
and 1203-green-worker-host.log. All of these attempts remain disclosed in the PR.

The new stop controls, like the CI selection tests, add no product requirement declaration.
Their oracle is the named ancestor and its recorded signal, independently supplied process rows,
and the observed absence of continuation in the controlled host process. The PR holds guarded
mutation receipts at the committed head. The initial stop function shell was empty before its
first meaningful red, just as the event decision's shell was.
