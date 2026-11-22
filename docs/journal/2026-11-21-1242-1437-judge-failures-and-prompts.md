ABOUTME: Records card #1437's persisted judge failures, bounded evidence and live Codex refusal evidence.

# Judge failures and prompt limits

Done means all thirty acceptance items on #1437 at revision 24348d418b17. The PM's ruling
https://github.com/williacj/rigger/issues/1437#issuecomment-7066897271 separates failure events
from rounds: a readable marker still spends its distinct head and acceptance pair's round.

L3 hands L2 the original judge dispatch's settled result, a fresh read of that pull's comments,
and the card's recorded events. L2 records a started judge's failure before reading its marker
and counts matching role, head and acceptance failures after the latest recorded escalation or
readable verdict. A failed record read preserves the failure event and names the stream in the
verb's output. The once wrapper forwards both the settle and prompt preparation requests.

L2 measures the complete prompt after its dispatch id is minted. A provider's declared byte
limit selects complete diff evidence, paths evidence, or an ambiguous escalation. Paths come
from git diff metadata, including both rename paths, deletions, binary changes and C-quoted
names. Rebuilding evidence also rebuilds its digest. Claude declares no limit.

The Codex value's provenance is dispatch d-796876a3's stderr, recorded by #1433: Codex reports
characters, while Rigger measures UTF-8 bytes. The live check proves refusal above the declared
limit only. It does not establish that Codex accepts every input at or below that value.

Measured on 2026-11-21T19:03:26.942Z with codex-cli 0.166.0, the gated live test passed using
the actual adapter invocation and 1048577 ASCII bytes: child exit 1, timedOut=false,
input_too_large=true. The command was RIGGER_LIVE_CODEX=1 npm run test:host --
--test-name-pattern '^1437:' test/provider-codex-live.test.mjs with the dispatched TMPDIR.
The load guard measured start load 23.12 and uptime end load 21.75; ps counted 514 starting user processes.
Its full output is 1437-live-head.log in the card scratch directory, copied to
/Users/cjwilliams/Library/Logs/rigger/1437-evidence and reopened after fixture teardown.
The authentication check reported only a symbolic link; no credential value was printed.

Before the full suite, the ripple search covered every source and test consumer of judgeAnswer,
judgeIdentity, dispatched, judgeSettled, judgeDispatch, factsCall, promptLimit and readRecord.
The plan verb remains under the card's scope edge. The new tests exercise the actual once
composition for B1, C1, C2, C4, C5, C7, C8 and interrupted judge lifecycles.

The retained partial-state suite and earlier baselines are documented on #1437, including the
round ambiguity and its resolution. The first affected-files run in this launch had one
structural assertion failure; prompt preparation now destructures its judge array before role
selection. A targeted run then exposed a duplicate new test import, which was removed.
The corrected targeted acceptance run measured tests=48, pass=48, fail=0; the affected
judge/provider/network run measured tests=255, pass=255, fail=0. These are focused checks,
not the full-suite completion evidence, which the PR reports at its reviewed head.

Only six existing test lines change, all network inventory rows under grant G5. All other test
changes are additions. The regenerated matrix claims all seven new requirements. Full command
originals, including failed attempts, remain in the scratch directory and the private retention
directory through handoff. The coordinator dispatches independent judges; this journal claims
no review verdict or merge authority.

The first completed full run measured tests=6018, pass=6012, fail=4, cancelled=2, exit 1.
It exposed two source regressions: an absent adapter was intercepted before L1 could report
NOT_STARTED, and the combined panel escalation omitted refused directories. Each existing
test reproduced its regression at low load, then passed after its source fix. L2 now leaves
missing-provider classification to L1; L3 hands L2 both directory outcomes and settled decisions.
The L7 real-wait failure and verb-facts timeout passed unchanged on that low-load rerun.

Two execution deviations remain recorded. The first full-run evidence posting exceeded
GitHub's size limit and the command started its named rerun without checking the post's result.
The corrected report is #1437 comment 7067626810. A later named acceptance run started at load
32.79, above the standing bound; it is retained as an out-of-bound attempt. Further named runs
wait at the bound before spawning the runner. Neither deviation is claimed compliant.

The receipt guard rejected two proposed B3 counterexamples: the first reached an undefined
dispatch lookup; the second correctly escalated early, but the forge double refused the write
and the test rejected before its later assertions. Neither earns assertion proof. The new
negative B3/B4/B5/B10/B12 cases now explicitly assert successful resolution, so an unexpected
escalation is an assertion failure at the observable loop boundary. Earlier receipts remain
retained at their earlier head and must be rerun at the reviewed head.

Item 4's literal CLI boundary now has two independent rigger.mjs once processes in the B1 CLI
case in once.test.mjs. The replacement passed before the redundant, newly added exported-once
B1 case was removed. It preserves both failure events, distinct dispatch ids, the reason's
role and ids, ambiguous/loop attribution, the Owner move and escalation label; it also asserts
different run ids. No test held at origin/main was removed. The full suite must pass again
at the resulting head before handoff.

The role-comparison mutation survived B10 at the next head: its first invocation dispatched
the architect successfully after the reviewer failed, and that architect verdict reset the
window the mutation needed. B10 now seeds the architect verdict before the reviewer failure
and asserts that only the reviewer dispatches initially. In the local guarded check, the
unchanged source passed, removing the failure-role comparison produced one named assertion
failure, and byte-exact restoration passed again. The rejected/surviving earlier attempts
remain retained; the final receipt must reproduce this assertion at the committed head.

Preflight at d811845e36c7 exited 1 because nine new B cases armed L0's native timers.
The logical loop clock alone did not replace the OS host clock. The new fresh-invocation
fixture now lends that same injected clock to L0 for the awaited invocation and restores it
in finally. The timeout helper uses that fixture rather than a second host-clock override.
The selected rerun measured 17 tests, 17 passes, exit 0 at start load 4.20 and end load 4.58;
the retained timer record reports no positive native timer arms for these new cases.

The first preflight also launched its title-listing subprocesses with bare node --test.
Their listing output is consumed by the check; their full original runner output was not
retained. That attempt remains missing evidence and is not claimed compliant with the maker
brief. A private capture adapter will run the same unfiltered listing jobs through npm test,
retain both listing and full spec reporters, and return the unchanged listing to preflight.
It changes no repository check or acceptance. This outside-scope tooling finding goes to the
coordinator. The full preflight must pass again at the final head.

The clock-fixture commit hook stopped on self-hosting-check.test.mjs:388 with an unsettled
top-level await; its suite measured tests=6018, pass=6017, fail=1, exit 1. Coordinator comment
7069258595 classifies this as the outside-diff load flake in #1317's family and authorizes
continuation. The required isolated rerun on 2026-11-21 passed: tests=1, pass=1, fail=0,
exit 0; start/end load 8.32, user processes 556. Full output is
1437-self-hosting-resumed.log; the PR quotes both attempts. No root-cause card was mutated.

CI run 44954185336 failed the new C2-once, C1-once and C7 cases at the previous head:
each received an R8 hold because the default-line judge checkout lacked reviewer.md.
The fast job measured tests=6018, pass=6006, fail=3, skipped=9; macOS smoke passed.
The summary log command returned an early prefix only; the complete 6711637-byte fast-job
original was recovered through the job logs API with escape sequences allowed and retained.
This is an introduced fixture defect, not a flake; no retry of that job was requested.

The prompt fixture pushed its instructions to a literal main branch, while L0 reads the
remote HEAD. A controlled non-main default reproduced the missing-file assertion before the
fix: tests=1, pass=0, fail=1, exit 1, load 3.15 to 3.77. The fixture now declares that default,
publishes the role commit through HEAD and asserts both files at the remote HEAD before the
CLI runs. The selected C1/C2/C4/C5/C7/C8 run then measured tests=7, pass=7, fail=0, exit 0,
load 3.61 to 3.93. The fixture ripple search found its callers only in once.test.mjs.
No production source, acceptance, original-main test line or grant scope changed.

The evidence closeout reran the gated live Codex refusal test on the final code tree,
35cdbde5eba473edf2b4c1226336a0fbe0b3d13d, on 2026-11-22T00:16:27.068Z. The installed
CLI reported codex-cli 0.166.0. With TMPDIR=/Users/cjwilliams/GitHub/rigger-worktrees/codex-1437-tmp,
the command was RIGGER_LIVE_CODEX=1 npm run test:host -- --test-name-pattern '^1437:'
test/provider-codex-live.test.mjs. Its test-runner exit was 0: tests=1, pass=1, fail=0,
cancelled=0, skipped=0. The actual adapter invocation supplied 1048577 ASCII bytes; Codex
exited 1, timedOut=false, with input_too_large=true. Start and end one-minute load were
22.97; the guard counted 493 user processes before launch. The authentication file remained
a symbolic link; no credential value was printed.

The full unfiltered output is retained as
/Users/cjwilliams/Library/Logs/rigger/1437-evidence/1437-live-journal-head.log and was reopened
after fixture teardown. This final commit updates only this journal; source and test bytes
remain those of the measured code tree. Historical failed-run command, UTC launch, base ref
and exit provenance were recovered into 1437-failed-run-ledger.json in the same retention
root. Uncommitted historical runs are identified as working trees based on af343e12 at their
launch times; no exact tree hash was captured for them. The PR maps each acceptance item to
a dated verification run and preserves failed-attempt excerpts separately.
