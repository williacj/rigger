<!-- ABOUTME: Records the escalation-label provisioning, waiting guard and plan diagnostics delivered for card 858. -->

# Escalation label and waiting cards

[#858](https://github.com/williacj/rigger/issues/858) supplies the label and waiting behavior
needed by [#849](https://github.com/williacj/rigger/issues/849). Its dispatch base is
`72e488ff5fe0ca2ecee7c74b38fe17a807c27d8e`, the committed green #851 repair. The existing
architecture places fixed labels beside the escalation categories, label interpretation in L2,
and provisioning through `declaredLabels`. This work follows those boundaries.

One fixed-label catalogue supplies the escalation name to provisioning, selector validation and
L2. A labelled unmerged card waits before kind, form, tier or provider selection. A merged card
keeps its existing action. `plan` displays L2's escalation status from the same cached answers
used for pull ordering, and uses L2's status-only helper for already-read items outside active
columns. Those outside items receive no workflow-facts read.

## Test-first evidence

Measured with `npm test -- --test-name-pattern=<named test> <file>` on Linux Node 26.12.0 under
Ubuntu/WSL on 2026-10-22 UTC, against this commit's source changes. Each regression below reached
one named assertion failure before its corresponding production change, then passed:

| Regression | Observed red | Green check |
|---|---|---|
| Unmerged labelled card | Ordinary dispatch instead of waiting | Active stages, form/selection conflicts, label case and branch presence |
| Merged labelled card | Missing escalation diagnostic | Existing merged actions preserved across stages and kinds |
| Reserved selector | Validator accepted the escalation label | Kind and epic selectors refused under each tested case variant |
| Provisioning union | Fixed label absent | Fixed and consumer labels retained once; allowed role/step maps accepted |
| Active plan diagnostic | Labelled cards absent from output | Escalated display with ordinary refusals counted separately |
| Outside-column plan diagnostic | Done and other-column items absent | Escalated display without branch or PR reads |
| Merged plan diagnostic | Escalated cards also counted and printed as refused | Forge reason retained without refusal wording/count |

Logs are under `/home/williacj/rigger-858-work/.tmp/858-*-red.log` and the corresponding green
logs. Real-CLI fake-forge cases additionally verify provisioning, no dispatch/write/workspace
creation, merged cleanup ordering and preservation, and the owner's label removal before a new
invocation. A same-loop test and a fresh facts-call test cover the owner answer without restarting
the engine. Read-failure and unlabelled owner-judge controls retain their ordinary outcomes.

The owner-answer proof used a disposable copy. It applied one checked mutation making L2 report
even an unlabelled card as escalated. The probe observed that effect; all three owner-answer tests
then reached named assertion failures with zero cancellations. Byte-exact restoration and the
restored three-test control passed. Anchors, diff, effect, PID/exit records and output are under
`.tmp/owner-answer-proof/` in the Linux worktree.

Two new CLI test expectations were corrected without production edits: a successful maker that
opens no PR is reported on stderr with exit 1, while an ordinary refusal with no pulled card exits
0. Their initial failures are retained in `858-once-integration.log`,
`858-once-resume-diagnostic.log` and `858-merged-once-integration.log`. An initial cross-OS copy
command failed before copying the new test; its unchanged-file run earned no red/green credit.
The corrected manifest copy preceded the named regression runs above.

## Independent review's integration-proof gap

On 2026-10-22 UTC the configured reviewer demonstrated that the broad labelled-unmerged CLI
fixture still passed after deleting the waiting guard: its otherwise selectable cards were
already refused by their seeded branch or stage. That historical test remains unchanged.

Six additive CLI regressions now start from otherwise dispatchable Ready/Coding/Review cards
or otherwise continuing Coding/Review/Owner cards. Each checks both label spellings, zero
dispatches and writes while labelled, and the actual maker/continuation after a person clears
the label. The continuation cases reuse the existing real-git `prepareContinuation` fixture.

Measured with Node 26.12.0 on Ubuntu WSL 2, the final disposable-copy proof applied one checked
deletion of the waiting guard. Its probe observed a labelled Coding card answered dispatch;
all six regressions then failed on their named waiting assertions, with zero cancellations
(13345.511319 ms). After byte-exact restoration, all six passed (36663.381458 ms). The source
in the author worktree was never mutated. Anchors, applied diff, effect, PID/exit records and
outputs are retained under `.tmp/pullable-label-proof-4/` in the Linux worktree.

Earlier new-fixture attempts are retained under `pullable-label-proof` through
`pullable-label-proof-3`. A direct edit of the fake's initial column was overwritten by its
existing move history. Recording a later move exposed a second incorrect expectation: a
Coding card with no governing revision is ordinarily refused, and an Owner card with an owed
judge moves to Review. Neither is the proposed judge-dispatch control. The final tests use the
existing governed continuation fixtures; no production edit or old assertion change was made
to accommodate those failed new expectations.

## Open-pull coverage repair

The acceptance author clarified that an open pull with none merged was already inside this
card's waiting outcome. The [author's coverage ruling](https://github.com/williacj/rigger/issues/858#issuecomment-6334084259)
was published after [fresh independent dimension admission](https://github.com/williacj/rigger/issues/858#issuecomment-6334024516).
The 21 assertions, file scope and existing-line grants remain unchanged. This planning
admission is not a delivered-work verdict.

Two additive L2 tests cross all active stages, branch presence, zero/one/several open pulls and
both label spellings, and establish the applicable ordinary judge, merge, critical/spent-round
escalation, return, continuation and column-move answers before adding the label. Three more
real-bin controls withhold an owed Review judge, an admitted Owner merge and an Owner critical
escalation. Clearing the label in the same fixture starts the actual judge, sends the merge
API write or records the critical escalation. Labelled invocations preserve writes, columns
and directories. No production code or existing test was changed for these controls.

Measured on Ubuntu WSL 2 with Node 26.12.0 on 2026-10-22 UTC, the ordinary full-suite commit
hook for the preceding six-control repair at `a51db334f6e79a35441d16c23476465a5e87e573`
passed 4,105 of 4,158 tests, with 53 skips, zero failures and zero cancellations
(596434.1755 ms). The five additional L2/CLI controls passed their focused runs before the
bounded fault checks.

The final fault check used a separate detached worktree containing that head plus the final
additive test bytes, including the exact merge-write assertion. Each fault had one checked
anchor, an applied/read-back diff, a syntax check and an effect probe that observed a labelled
Review card incorrectly answered judge. The 11 targeted tests include all nine CLI controls
and both new L2 controls. These are measurements of that candidate, not claims about an older
published head's test coverage.

| Candidate / single fault | Tests | Pass | Fail | Cancelled | Duration (ms) |
|---|---:|---:|---:|---:|---:|
| Original guard | 11 | 11 | 0 | 0 | 27006.571673 |
| Guard deleted | 11 | 0 | 11 | 0 | 10072.212427 |
| Guard restored exactly | 11 | 11 | 0 | 0 | 35198.628268 |
| Exactly one open pull exempted | 11 | 3 | 8 | 0 | 23658.579915 |
| Guard restored exactly | 11 | 11 | 0 | 0 | 61187.050127 |

Both faults failed the named owed-judge, admitted-merge and critical-escalation waiting
assertions. The exemption actually started the judge, merged the pull and recorded critical
escalation while labelled; those were not fixture failures. The final raw outputs, applied
diffs, effect probes, recorded PIDs and exact-restoration checks remain under
`.tmp/open-pull-proof-final/` in the author worktree. The earlier proof before the explicit
merge-write assertion remains under `.tmp/open-pull-proof/`. Mutations never touched the
author's production file; its bytes and the restored proof file agree, and the proof source's
git status is clean. Fresh configured delivered reviews are still required at the final head.

## Withdrawn unsupported proof declaration

The [fresh configured reviewer](https://github.com/williacj/rigger/pull/863#issuecomment-6336166100)
ran its own guarded deletion checks at `07e589b4912fbdcaa1f3735ed8857c041fa12705`.
It ruled item 17 unmet because the original broad labelled-unmerged CLI test still declared
`R-ESCALATE-10` while passing after deletion of the waiting guard. The six dispatch/continuation
controls and the three judge/merge/escalation controls detect that deletion, but cannot make
another test's unsupported declaration true.

This correction withdraws only the declaration added above that broad test by this card.
The test, every assertion, its fixture and its deadline remain byte-identical. The matrix is
regenerated, so that test no longer appears as proof of the waiting requirement. The nine
discriminating CLI controls and their supported declarations remain. Production bytes and
the prerequisite interface are unchanged. The configured judges must review the corrected
head; the earlier verdict is not reused.

Measured on Ubuntu WSL2 with Node26.12.0 on 2026-10-22 UTC, the retained broad test
passed one test with zero failures, cancellations or skips (3181.016624ms). Before
regeneration, matrix:check correctly failed because its entry was stale; after npm run matrix,
matrix:check passed. The original dispatch-base test bytes remain unchanged outside the
admitted G1/G2 grants. The ordinary complete-suite hook is still required for this correction.

## Verification environment correction

The first complete hook for the declaration-only correction exited 1: 4,163 tests, 3,567
passed, 543 failed, zero cancelled and 53 skipped (171546.971405ms). Its custom evidence
directory was mode 0755, measured with stat; the suite requires a private mode 0700 root.
The first rejected-root fixture then left a deleted scratch path in TMPDIR, causing the
following ENOENT failures. These are preserved failures, not successful verification.

A distinct unchanged recorded-scratch fixture also failed with ext4 scratch: a non-mutating
observer measured the removed and recreated role directory as the same device/inode
(2096/451206). With ordinary tmpfs scratch the same test passed and the inode changed from
8903625 to 8903628. The runtime was not changed; this ext4 fixture assumption is outside this
card. The follow-up belongs to its own card rather than a weaker assertion here.

The retry restores ordinary TMPDIR=/tmp and moves only retained C615_EVIDENCE_ROOT originals
to a fresh ext4 directory whose actual mode is checked as 0700. Keeping those retained originals
off tmpfs solves its inode capacity problem without changing the scratch filesystem. The
failed full log, observed inode records and exact correction source remain preserved. A
completed green ordinary full hook is still required before commit or push.

## Withdrawn kind-boundary escalation declaration

The [configured reviewer at 36d8c45](https://github.com/williacj/rigger/pull/863#issuecomment-6338081344)
completed its own ordinary full suite and guarded behavior deletions. It met 20 acceptance
items and returned item 17 unmet: the merged labelled epic/unselected control still carried
an unsupported escalation-label declaration. Kind selection already keeps those items inert
when the waiting guard, merged exception or label recognition is absent. Its useful boundary
assertions therefore cannot claim that escalation-label behavior.

This correction withdraws only that card-added declaration. Every other byte of the test file,
including all fixtures, assertions and deadlines, is preserved. No production byte changes.
The matrix is regenerated. The prior 36d8c45 ordinary hook completed with 4,163 tests, 4,110
passed, zero failures/cancellations and 53 skipped (589120.104769 ms). That historical green
run is not evidence for this correction; a fresh normal complete-suite hook remains required.

Measured with npm test on this declaration-only working change over 36d8c45, the retained
epic/unselected test passed once, with zero failures, cancellations or skips (470.428909 ms;
552.576599 ms total). Matrix checking failed with exit 1 before regeneration and passed with
exit 0 after npm run matrix. These focused checks do not replace the full hook.

## Boundaries

Existing test edits are confined to #858's G1 setup-board label fixtures/counts/descriptions and
G2 declared-label expectations/descriptions. Other test changes are additions. The matrix is
generator output. No assertion, deadline or proof declaration present at the dispatch base was deleted.
The unsupported declaration added by this card is withdrawn as recorded above.

Status labels, owner-escalation writes and role routing remain unclaimed. This work neither
changes supported engine hosts nor installs an engine. Independent review and exact-head CI
remain required before merge.
