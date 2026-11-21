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
