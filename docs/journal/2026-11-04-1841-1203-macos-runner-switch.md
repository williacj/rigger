ABOUTME: Card 1203's runner selection, test-first evidence and owner-run macOS proof.

# macOS runner selection

Card 1203, revision `bb02ec39dd3d`, pins the structure and the D31 proposal. The selector lives
in `CI_POLICY`'s plan action. Only the three named macOS jobs consume its runner output.
The collector compares webhook repository IDs before the plan can use the variable for a pull
request. A fork or unavailable identity selects hosted before validation. A same-repository run
validates the exact variable text only when broad proof or demo needs a macOS job.

The hook exports its event-file decision and its ancestor stop. Its CLI refusal lives separately
in `refuseJob`. By default it exits nonzero. After the exit-only measurement printed its later-step marker,
the owner enabled `RIGGER_JOB_GUARD_STOP_WORKER=1` in the runner's environment under
M7-U29, as recorded below. The stop follows only the hook's own parent chain, checks the exact executable basename
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

## Owner acts and runner proof, recorded 2026-11-05

Re-read card 1203 and all comments on 2026-11-05; its acceptance revision remains
`bb02ec39dd3d`. This journal-only continuation changes no guard, workflow, test or binding
proposal. All owner proof runs below tested commit ecebafbbdec70aaea4d19a5515d92bfd4010f003;
the next head differs only in this journal. The installed guard remains that commit's copy.
The maker changed no variable, setting, label, runner, installed hook or power policy.

The owner performed the measurement on the throwaway same-repository branch
rigger-1203-measure, as [the owner's measurement record](https://github.com/williacj/rigger/issues/1203#issuecomment-6642585821)
states. Both runs concluded failure. In [41916358005](https://github.com/williacj/rigger/actions/runs/41916358005),
2026-11-04 21:28:09–21:28:14 UTC, a refuse-all exit-only hook allowed the later
`if: always()` step to run. The retained log shows exit 1 followed by MARKER-42 and a
write to $HOME/.rigger-runner-hooks/marker-exit-only. In
[41916412376](https://github.com/williacj/rigger/actions/runs/41916412376),
21:28:30–21:28:31 UTC, the guard from ecebafbb with RIGGER_JOB_GUARD_STOP_WORKER=1
prevented that step. **The second run used a wrapper to give the guard a refused event.**
The owner read the file the step writes on the Mini to decide whether it ran; absence of log
output alone is not the oracle because killing Runner.Worker can lose logs. The second job's
logs API returns HTTP 404; its jobs API confirms failure, and the file observation is the owner's
reported measurement, not a maker observation. The measurement commits are throwaway workflow
commits, not the PR head; the repeated run used the PR head's guard bytes.

By the end of that measurement the owner had removed CJs-MacBook-Pro, installed the reviewed
guard as ~/.rigger-runner-hooks/self-hosted-job-guard.js, and installed vhs 0.12.1. The owner
record does not give individual setup-command timestamps: setup preceded the first selected
Mini proof job at 2026-11-04 22:50:28 UTC; final guard/stop configuration was in use by
21:28:30 UTC. RIGGER_JOB_GUARD_STOP_WORKER=1 stays in the runner's .env. The owner set
MACOS_RUNNER to ["self-hosted","macOS","ARM64"] at 2026-11-04T22:49:04Z and deleted it
about 01:38Z on 2026-11-05. Those times are the owner's dispatch report. No change required a
commit. The maker read today's API policy as {"approval_policy":"all_external_contributors"}.

The following are measurements from the jobs API read by the maker on 2026-11-05, with
filter=all, retaining each attempt. All three runs concluded success at ecebafbb.

| Run / variable | Job | runner_name | UTC start → end | Elapsed |
|---|---|---|---|---|
| [41916588204](https://github.com/williacj/rigger/actions/runs/41916588204), attempt 2, unset | full_ordinary | GitHub Actions 1000044990 | 2026-11-04T22:04:22Z → 2026-11-04T22:20:49Z | 16m27s |
| [41916588204](https://github.com/williacj/rigger/actions/runs/41916588204), attempt 2, unset | full_host | GitHub Actions 1000044987 | 2026-11-04T21:34:59Z → 2026-11-04T22:03:32Z | 28m33s |
| [41916588204](https://github.com/williacj/rigger/actions/runs/41916588204), attempt 2, unset | demo | GitHub Actions 1000044985 | 2026-11-04T21:36:35Z → 2026-11-04T21:38:40Z | 2m05s |
| [41945694368](https://github.com/williacj/rigger/actions/runs/41945694368), attempt 1, Mini | full_ordinary | CJs-Mac-mini | 2026-11-05T01:02:30Z → 2026-11-05T01:06:39Z | 4m09s |
| [41945694368](https://github.com/williacj/rigger/actions/runs/41945694368), attempt 1, Mini | full_host | CJs-Mac-mini | 2026-11-05T01:07:06Z → 2026-11-05T01:30:35Z | 23m29s |
| [41945694368](https://github.com/williacj/rigger/actions/runs/41945694368), attempt 1, Mini | demo | CJs-Mac-mini | 2026-11-05T01:06:40Z → 2026-11-05T01:07:04Z | 0m24s |
| [41950001732](https://github.com/williacj/rigger/actions/runs/41950001732), attempt 1, deleted | full_ordinary | GitHub Actions 1000045115 | 2026-11-05T01:39:53Z → 2026-11-05T01:47:27Z | 7m34s |
| [41950001732](https://github.com/williacj/rigger/actions/runs/41950001732), attempt 1, deleted | full_host | GitHub Actions 1000045114 | 2026-11-05T01:39:54Z → 2026-11-05T02:07:57Z | 28m03s |
| [41950001732](https://github.com/williacj/rigger/actions/runs/41950001732), attempt 1, deleted | demo | GitHub Actions 1000045113 | 2026-11-05T01:39:53Z → 2026-11-05T01:40:50Z | 0m57s |

The first hosted run's attempt 1 full_ordinary was cancelled for capacity, as reported by the
owner; attempt 2 used --failed with the variable still unset. Its other successful macOS jobs
were carried forward. This exercises a failed-job rerun with an unchanged value, not R10's
changed-variable case. The failed Mini run below also retried only full_ordinary with the value
unchanged. R10 across a value change and R11's already-queued switch were not exercised.

Compared with the card's “Serial jobs” judgment of about 30 minutes on the Mini versus about
22 hosted, the successful Mini proof jobs ran serially for 4m09s + 24s + 23m29s, with gaps
of 1s and 2s: first start 01:02:30, last finish 01:30:35, wall time 28m05s. The entire run
including hosted controller jobs lasted 28m40s. Its full_ordinary log reports tests/pass/fail =
4804/4804/0. Its full_host log reports tests/pass/fail/skipped = 2263/2238/0/25.

Today's runner API lists exactly one runner, id 23, CJs-Mac-mini, online, labels self-hosted,
macOS, ARM64. Every successful Mini job's log contains “A job started hook has been configured
by the self-hosted runner administrator”, followed by the installed guard path. The demo log
at 01:06:47.875209Z starts `if ! command -v vhs >/dev/null; then brew install vhs; fi`, ends
that step at 01:06:47.917250Z without installation output, runs `vhs docs/demo.tape` at
01:06:47.944504Z, and reports “Creating docs/demo.gif...” at 01:06:58.287162Z. Because the
owner had installed vhs and the existing command only installs when lookup fails, successful
lookup and the skipped brew branch are inferred from that completed branch and successful VHS
execution; the lookup suppresses its path in the log. The brew line stays unchanged.

The Mini's Homebrew default Node moved from v26.12.1 to v26.13.0 on 2026-11-05 as a side
effect of M6's brew install node@24, according to the owner. The maker independently observed
node --version = v26.13.0 today. These CI jobs instead use actions/setup-node's runner tool
cache: each successful Mini job logs “Found in cache @
/Users/cjwilliams/Github/rigger-action-runner/_work/_tool/node/26.13.0/arm64”. The hook is
invoked with the runner's separate externals/node24 binary. No maker inspected or modified the
runner installation.

Bootstrap has both a hosted proof, 41916588204 (attempt 2), and a Mini proof, 41945694368,
plus the hosted return 41950001732. The owner states the marker will rest on a **hosted run
at the final head**. These ecebafbb proofs do not themselves prove a later head; the final
hosted proof and sound marker remain for the owner/coordinator. D31 and the AGENTS.md bullet
remain proposals until that marker. A real fork-account run remains unproved; controlled R5
selection and R9 event/file/CLI controls stand for those bounded parts.

## Failed Mini attempts and power-state cause

[41928699953](https://github.com/williacj/rigger/actions/runs/41928699953), both attempts at
ecebafbb, failed full_ordinary. The maker retrieved each original job's log directly with
`gh api --allow-escape-sequences repos/williacj/rigger/actions/jobs/<job-id>/logs`, rather
than reading only the latest attempt. Job 126919905482 (attempt 1) reports tests/pass/fail/
cancelled = 4804/4800/2/2: “settlement recording refusals retain original causes and omit the
selected action across maker judge removal and merge paths” timed out after 60000ms; its
merge.transition and merge.cleanup children were cancelled; “real-bin once at N three with four
Ready cards fires one pull claims one card and records no run.start” found spawnSync ETIMEDOUT.
Job 126945074360 (attempt 2) reports 4804/4799/4/1: the renamed-five-columns test expected
one held card but got 0 after 5000ms; L2 and L14 loop tests and the restarted-run drain test
also exceeded 5000ms conditions; “recordRun pull ends its loop and makers when the first
positive wait fails” timed out after 10000ms and was cancelled. Complete original logs and
failure sections are retained as owner-job-126919905482.log, owner-job-126945074360.log and
owner-failure-<job-id>.txt in the assigned scratch directory. No maker reran these jobs.

The owner's spike measured a sleeping Mini: a caffeinate hold died at 2026-11-04T22:46:00Z
while AC sleep was 1. All five unprotected npm test runs failed; with gh on PATH under
caffeinate -dims or -s the spike passed 4804/4804. These spike figures and attribution come
from the owner's dispatch, not a maker-run experiment. The owner subsequently ran
`sudo pmset -c sleep 0` and fully woke the Mini; the exact command time was not supplied.
The maker's read-only pmset log confirms the last sleep at 2026-11-05T00:55:56Z, followed
by full Wake at 00:56:03Z, and no sleep during successful run 41945694368. Today's pmset
-g custom reads AC sleep 0. The maker changed no power setting and started no caffeinate hold.

## Home-file inventory

At 2026-11-05T02:12:53Z the maker used Python os.walk/lstat read-only over ~/.npm,
~/.cache, ~/.config, ~/Library/Caches, ~/Library/Application Support, ~/Library/Logs and
~/Downloads, selecting mtimes in the successful Mini jobs' 01:02:30–01:30:35 UTC window.
The retained owner-home-inventory.json records every path, size, mtime, scope and no read errors.
The scan excluded the runner installation and other home paths. This is a post-run inventory,
not a before/after diff: files subsequently removed cannot be reconstructed, and coincidence
of mtime alone does not attribute a write to a job.

Observed job-related writes are the following eleven npm logs (15649 bytes in total). The
maker read only their title/argv/cwd/Node metadata to tie them to the runner checkout,
containment proof or suite scratch. npm's normal log rotation means earlier ordinary/demo
logs may already be gone. Under ~/.npm/_logs/:

- 2026-11-05T01_28_40_822Z-debug-0.log
- 2026-11-05T01_30_27_187Z-debug-0.log
- 2026-11-05T01_26_42_681Z-debug-0.log
- 2026-11-05T01_26_42_511Z-debug-0.log
- 2026-11-05T01_30_26_344Z-debug-0.log
- 2026-11-05T01_30_25_560Z-debug-0.log
- 2026-11-05T01_28_45_157Z-debug-0.log
- 2026-11-05T01_30_27_736Z-debug-0.log
- 2026-11-05T01_30_17_962Z-debug-0.log
- 2026-11-05T01_30_18_776Z-debug-0.log
- 2026-11-05T01_28_44_603Z-debug-0.log

The same window contains eighteen npm cache entries (37322 bytes) below ~/.npm/_cacache/.
They are measured retained cache writes in the host-test interval; no pre-run inventory proves
which were newly created rather than rewritten. Their complete relative paths are:

- content-v2/sha512/67/46/5cf4a2741b25636c0acac96ebd11a65943f5c944cd54cd2e6d7986414f9bc82da8a1b9692355b8aef4058d1931e510abfb029cac8de0b4fb830416cd1e50
- content-v2/sha512/9d/fd/f455d729547836052e407c6bb039c1b69d27426fe2e810b731f847ef47d9a5087b9aeccbc768557043336ad4e38a32810be95639bc9af47caaf62023554f
- content-v2/sha512/b5/09/395416924ace5856a270c2e3b24b1011a33095fd1cec302e3cc75b230c4408b1e82da5cac7a290f6567583503bd5cd4f27e42ebf5b56769e7910c95fb0bd
- content-v2/sha512/5c/92/23b00dd2088eda9c1da785644936ec94418ec84cdd0597300f98d3c3abc3409c6f3fd5df96b368b2191f5a98cca8e60196e575883168f8b27e279bcedaf9
- content-v2/sha512/54/94/d7b7dddfff5cd5d3083e54e4fa7aee2a1747c43edb8837c3381c2d600d5c9b908884a13727da51b0498b3666eb7047de7af54366f584a642e1b26e8d9e0a
- content-v2/sha512/53/c7/0feb01266ec27a2ceb5beceef2a2313a51c3b322cff62a3227486912bc3d11ec02c6e5ba588ab8a78e4a84ede6a88ae948f0e2bee73888671ac7e0d1f015
- content-v2/sha512/53/97/37d21dc1f25c203a62ead5f8daaf3ee093e3675ae629b275da37ee88ba58cf0bf00c0480daf32cd4c51678c05d27dc25a5a2af73fc84d64d093eeacad1d8
- index-v5/bd/b5/3cabc61cc740a1f572b169149d0b9ef5cd3c8bca62125a234a3315feea66
- index-v5/ab/68/dc022db69ac5a1c97eca26eb9584f9d42af637e79a304def76f6687bd7e9
- index-v5/c9/47/0537fa2a3442fad91f7f5fbec0ce64ba338ee5c38d4d4edefd5ecb5eede1
- index-v5/89/cd/42d4af8d29550a75d18398e49e5e3b3d0b445d46544bd9926921d645d935
- index-v5/43/70/d6190e415f563041a45eb979993eb6e3884bb7ed76acfa116bf42fd1880d
- index-v5/bf/d1/42d27878193082eb60d8c4f34d57f8a876330e75b00cd3370729ff41a033
- index-v5/cc/09/61ea5f00760e5cf7b105820705f3058110146ee124c2fa08b85aeaa7e09b
- index-v5/f0/75/1a9f20ab06be959cdbdf14e824dba0b0371b7d9b5a90b83849fef5b415bd
- index-v5/e0/3a/47de1afd513efaa39dbc98f10aeb4ec7f4a4b05c4f2fbb68c44743f335cd
- index-v5/15/3e/254c1e687eecb7caec3cc4ed552a24dd3daac4925362ea212a63cec4facf
- index-v5/8b/b2/b3f969ef71b5219418d48ca03d8a9e7b125238eb9d79c849fddc530e072a

Sixteen Node DiagnosticReports (284569 bytes) also have mtimes in the host-test window. Their
metadata names parent node PID 67540 and redacts the executable path, so this inventory does
not prove they came from these jobs. They are retained as coincident writes, not asserted CI
outputs. Under ~/Library/Logs/DiagnosticReports/:

- node-2026-11-04-190933.ips
- node-2026-11-04-190934.ips
- node-2026-11-04-191001.000.ips
- node-2026-11-04-191003.000.ips
- node-2026-11-04-190934.000.ips
- node-2026-11-04-190933.0002.ips
- node-2026-11-04-191001.0005.ips
- node-2026-11-04-190934.0003.ips
- node-2026-11-04-190934.0002.ips
- node-2026-11-04-191001.0004.ips
- node-2026-11-04-191001.0003.ips
- node-2026-11-04-191003.ips
- node-2026-11-04-190934.0004.ips
- node-2026-11-04-191001.0002.ips
- node-2026-11-04-191001.ips
- node-2026-11-04-190933.000.ips

The remaining 47 matching files are OS/Edge activity and are not attributed to CI. No
VHS/Charm/Rod-named cache or configuration path was found in those inspected roots. This does
not claim no home writes outside the scope. The demo log locates docs/demo.gif and demo.txt
in the runner checkout, with uploaded artifact 13377964899. Actions checkout, downloads,
tool-cache and containment artifacts also live below the runner's work/temp paths as the logs
show; those paths were not read on disk. The owner-installed guard, environment and vhs
predate these jobs and are setup, not job-created files. Full job logs, runner listing and fork
policy responses remain in assigned scratch; the maker performed read-only observation only.

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

## Round 2: D29 host declarations

The reviewer’s [B1 finding](https://github.com/williacj/rigger/pull/1204#issuecomment-6648391689)
ruled all 25 acceptance items met at 45422a3e and required D29 rule 11 declarations for
four host-tier identities. The architect [ruled sound](https://github.com/williacj/rigger/pull/1204#issuecomment-6648340133)
at that head. This revision resolves B1 with comment additions only, under the coordinator’s
explicit grant. No existing test line, title, assertion or executable body changes. It adds no
host-declaration checker; the reviewer’s carry note puts that pre-existing gap outside this card.

I read D29 rule 11 and its rule 3.5 timer definition in full, the four test bodies, their
helpers and the named deterministic counterparts before adding the declarations. The real
process controls use spawnSync timeouts, not a setTimeout/setInterval/timers/AbortSignal timer
as D29 rule 3.5 defines one, so their declarations do not claim a real deadline.

| Identity (round-1 line) | Declared reason and deterministic decision evidence |
|---|---|
| CI assigns portable candidate, selected macOS and protected-main regression lanes with Node 26 (29) | Wiring. Explicitly process-free and retained under D30 rule 3’s awaiting-split allowance; asserts declared topology, with no runtime Rigger decision. The runner-output wiring and R8 unrelated-runner tests are deterministic configuration counterparts. |
| self-hosted job guard exits zero only for allowed events in source and installed JS form (1306) | Wiring. R9 allowed/refused exported-function tests independently prove the event decisions; this host control connects them to CJS/installed-JS process exits. |
| actual plan runtime reads the runner variable and publishes only allowlisted JSON or no output on refusal (1336) | Wiring. R1–R3, R5, R6 and R6a prove selection, fork handling, refusal and unused-value decisions; the host control connects environment input and output-file bytes to those decisions. |
| opted-in refused hook ends only its controlled Worker ancestor before continuation (1393) | OS behaviour. The injected exact-Worker signal test proves the ancestor/signal decision; R9 allowed/refused tests prove the event decision. This host control observes actual SIGKILL and continuation on a recorded surrogate. |

All named counterparts live in test/macos-runner.test.mjs. The host and conversion lists in
test/suite.sh name no such file, so D29 rule 1 places it in the deterministic tier, outside
D30’s conversion list. The first declaration does not invent a real-process need for its
process-free check; it records the existing awaiting-split exception and no runtime decision.
No new tests, product-requirement declarations, behaviour or mutation claims are introduced.

Compared with proof head ecebafbb, the head differs only in these four declaration blocks and
this journal. Guard and ci.yml remain byte-identical to the installed/proved implementation.
The owner’s measurement and hosted/Mini/hosted runs remain historical ecebafbb evidence, with
that exact difference stated in the PR. The owner’s hosted proof and marker must bind the final
head. The retained full suite, affected named files, fresh clone, preflight and PR-body-check
outputs for this revision are recorded in the PR handoff; no verification result is inferred
from these comments alone.
