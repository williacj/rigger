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

## Boundaries

Existing test edits are confined to #858's G1 setup-board label fixtures/counts/descriptions and
G2 declared-label expectations/descriptions. Other test changes are additions. The matrix is
generator output. No existing assertion, deadline or proof declaration was deleted.

Status labels, owner-escalation writes and role routing remain unclaimed. This work neither
changes supported engine hosts nor installs an engine. Independent review and exact-head CI
remain required before merge.
