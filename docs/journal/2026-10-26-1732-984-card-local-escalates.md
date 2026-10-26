ABOUTME: Card 984's refusal reports, owner escalation behavior and retained verification evidence.

# Card-local refusals escalate

The work follows acceptance revision `5be3521b0c9b`. The PM resolved the earlier escalation by
placing the dispatch-time `R-WORK-32` refusal outside this card. The closed-card removal
conversion remains in scope. No escalation-role dispatch is built here.

L1 preserves answered judge-directory and scratch-directory refusals as `WORKSPACE_REFUSED`
and `SCRATCH_REFUSED`. Unanswered conditions retain their host-failure reports. L2 converts
card-local attempt failures and qualifying forge refusals to loop-raised ambiguous escalations,
while ordinary form, kind, tier and provider refusals retain their precedence. L2 also combines
judge refusals, naming each role and the original report.

L3 completes every named judge before carrying out one escalation through L2. It keeps each
outcome, including a peer verdict, withholding or failure to hand back. Refused escalation writes
exclude the card from later pulls in that invocation. L2 records an attempt-time escalation's
move from Coding, and a judge-time move from the Review stage its facts hold.

## Evidence

Every test command ran with the dispatch's scratch directory as `TMPDIR`. Full outputs, loads,
commands and base refs are retained under
`/Users/cjwilliams/Github/rigger-worktrees/codex-984-tmp/984-evidence/`.

The measured base is `ba5eae7c91e4ca1c6fbba2a7c6a317f522bd5fed`. `npm ci` passed. The
slot-run deterministic baseline recorded tests=3070, pass=3070, fail=0. The slot recorded
load=3.93 at its actual start; `uptime` recorded load=3.20 at its end. The affected host baseline
ran `npm test -- --host test/worktrees.test.mjs test/forge-spawn.test.mjs`, recording tests=60,
pass=60, fail=0, with start load=2.85 and end load=3.33. These figures describe the base.

| Behavior written before its source change | Red log | Green log |
|---|---|---|
| workspace, continuing-workspace, elsewhere-branch and maker-scratch refusal answers | `984-red-attempt.log` | `984-green-attempt.log` |
| mixed host/refusal attempt pair | `984-red-pair.log` | `984-green-pair.log` |
| qualifying forge refusal answers | `984-red-forge.log` | `984-green-forge.log` |
| judge-directory and scratch-refusal answers | `984-red-judge-answer.log` | `984-green-judge-answer-fixed.log` |
| attempt execution and its Coding move | `984-red-loop-attempt.log` | `984-green-loop-attempt.log` |
| panel completion before escalation | `984-red-panel-ready.log` | `984-green-panel.log` |
| actual scratch refusal report | `984-red-scratch-report.log` | `984-green-scratch-report-fixed.log` |
| actual judge-directory refusal report | `984-red-directory-report.log` | `984-green-directory-report.log` |
| real verb and plan pull ordering | `984-verb-cells.log` | `984-green-verb-cells.log` |

The expanded table run, `984-expanded-tables-load-ready.log`, passed its panel and negative
cases. `984-run-external-writes.log` passed both loop and verb checks for each refused owner
write. `984-affected.log` ran the affected files, recording tests=850, pass=849, fail=1: an old
Owner-card assertion still expected `refuse`. After retargeting that expectation,
`984-retargeted-files.log` passed, recording tests=150, pass=150, fail=0.

Other failed attempts remain retained: `984-green-judge-answer.log` exposed a shadowed binding;
`984-red-panel.log` had an incomplete empty-comment fixture; `984-green-scratch-report.log`
read a report from a callback its Review entry point did not use; `984-write-exclusions.log`
refused the fixture's initial Coding move instead of its escalation move. These are not counted
as behavior reds. `984-expanded-tables.log` started no test because load=28.40 exceeded the bar.

The slot-run full local suite, `984-local-full.log`, recorded tests=3147, pass=3146,
fail=1, with actual start load=5.20 and end load=3.77. Its sole failure was
`test/loop.test.mjs:2955`: the existing closed-cleanup test expected the later Coding read to
be inert, while this card converts its forge hold to escalation. The retarget retains the real
worktree bytes and no-second-cleanup proof, and checks the owner label and no new maker.
`984-loop-retargeted.log` then passed the whole file, recording tests=126, pass=126, fail=0,
with start load=12.11 and end load=19.80.

The existing-line audit records every changed base line with its replacement and reason in
`984-grant-request.md`: 93 lines, of which 23 are marked G1 and 70 requested explicitly. The
one-round batch preceded any commit or push. The coordinator granted every requested row as
K95 in #984 comment 6429483106, referring to the exact replacements in comment 6429460516.

The source and binding inventories are retained as `984-refusal-inventory-current.txt` and
`984-lands-in-bindings-current.txt`. Matrix generation, its freshness check, the package budget
and `git diff --check` passed on the local change. A green full suite at the proposed head,
committed-head mutations, fresh-clone verification, CI and PR handoff are recorded in the PR evidence at its head.

After K95, `984-granted-full.log` recorded tests=3147, pass=3147, fail=0 through the host
slot, with actual start load=3.95 and end load=3.47. The test diff remained byte-identical to
the granted inventory. Committed-head mutation, host, fresh-clone and CI evidence belongs in
the PR body so it can name the final head without another evidence-only commit.
