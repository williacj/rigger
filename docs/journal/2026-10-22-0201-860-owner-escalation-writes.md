<!-- ABOUTME: Card 860's owner escalation evidence, ordered writes, partial-state behavior and verification. -->
# Carry the loop's selected escalation to the owner

Card #860 consumes #854's `postIssueComment` and `addIssueLabel`, and #858's
`FIXED_LABELS.escalated` and waiting guard. Its dispatch base is
`01d8a42574657af7eb816ad718789184826c9afb`, the ordinary merge of main
`0a52e845`, #854 `b624d0a3` and #858 `c43ca861`. The normal baseline hook
measured 4,210 tests, 4,151 passing, no failures or cancellations and 59 skips
in 587,850.554331 ms on Ubuntu/WSL with Linux Node v26.12.0. That committed
baseline preserves the landed workspace changes as well as #851's repair.

The existing agent-critical, owner-critical and spent-rounds producers now
carry their governing evidence and current pull/head. They retain their
selection order, provider/head/digest rules and round calculation. The spent
reason names the actual count and bound and the revising markers' evidence;
a sound marker's unmet acceptance item carries its ordinal and text, without
inventing a `toSound`.

L2 records that selected reason before writing, comments on the card's issue,
moves the actual source column to configured Owner through its existing
transition path, then adds the fixed label. The comment formatter lives in
the same file. Each available pull, head or line is carried; unavailable
identifiers are omitted. Both default repository writes bind their L0 emitter
to the actual run/card and null dispatch, as does the item move. A marker's
historical dispatch is not the dispatch of this claimed action.

A refused comment leaves no move or label. A refused move retains the comment
and old column. A refused label retains the comment and actual Owner state.
Retry tests start from each retained state and permit the repeated identical
comment. An early intent-record refusal sends no write. A refused transition
record retains the comment and actual move, sends no label and names the
missing record; the loop starts no later eligible work while recording stays
unavailable.

The loop and CLI fixtures reuse #854's issue operations. Their board and
repository views share issue facts, preserve explicit negative issue seeds,
and join labels by repository and issue identity. Test controls stay outside
the adapter operations. Existing test-line changes use only #860's G1–G4
grants; no deadline or proof declaration was removed or retargeted.

## Verification

The recorded `npm test -- --test-name-pattern=...` reds in this work each
reached a named assertion: missing agent/owner evidence, missing spent-round
count/evidence, absent ordered owner writes, unnamed issue-comment refusal,
unbound default L0 context, a missing fresh board label, and missing shared
issue facts in each fixture. Their corresponding slices passed after the
minimal change. The first agent fixture used a multiline `toSound`, which the
real marker schema does not admit; it was corrected to a readable single-line
marker. Multiline reason data is tested directly on the owner operation.

The full affected-file command was `npm test -- test/judge-answer.test.mjs
test/transitions.test.mjs test/facts-pull.test.mjs test/loop.test.mjs
test/once.test.mjs test/fake-gh.test.mjs`. It measured 407 tests, all passing,
with no failures, cancellations or skips in 82,014.926562 ms. The added
preservation tests separately hold each asynchronous write, observe the claim
before releasing it, and use a new CLI invocation for the fresh labelled read.
No dispatch, directory operation, label removal or repeat escalation occurs.

The first normal full hook was interrupted without a suite verdict after an
unchanged init worker stopped making progress. A bounded init-only diagnostic
then measured 127 tests, 51 passing and 76 failing with `ENOSPC`.
`df -i /tmp` measured 1,048,416 of 1,048,576 inodes used, while bytes were only
42% full. The session coordinator preserved and removed only its own inactive
evidence roots, restoring capacity. With the supported `TMPDIR` and
`C615_EVIDENCE_ROOT` on a private ext4 directory outside the checkout, the
unchanged init file passed all 127 tests in 42,734.065513 ms under a diagnostic
120-second CLI bound. Neither diagnostic is the ordinary full-suite result;
no test source or existing deadline was changed. The normal full retry used
those supported private ext4 locations without a diagnostic timeout.

That full retry measured 4,224 tests, 4,164 passing, one failure, no
cancellations and 59 skips in 593,064.258422 ms. Its sole failure was the
existing bare-directory lint's physical-line exception: adding three tests
above the existing timestamp wrapper moved its permitted string from line 59
to line 157. Moving only this work's unchanged 98-line test block to the end
restored that existing line. A byte comparison against the dispatch base
confirmed that every pre-existing byte remained intact except the admitted
G3 transition-count expression. The scanner and its exceptions stayed intact.
The complete loop file and bare-directory check then passed all 103 tests,
with no failures, cancellations or skips in 42,600.817914 ms.

The following ordinary full hook measured 4,224 tests, 4,163 passing, two
failures, no cancellations and 59 skips in 590,470.868159 ms. Both failures
were existing directory-replacement controls under the private ext4 scratch
root: the dispatch replacement assertion observed equal old/new inode
417965, and the later-start census did not preserve the process in the
replacement directory. No source correction was made for those failures.
The next ordinary hook restores `/tmp` for scratch files and moves only
retained C615 evidence to a separate ext4 directory with mode 0700, preserving
all test assertions and deadlines.

`npm run matrix` regenerated the behavior claims. The normal commit hook runs
the complete ordinary suite under the shared verification lock. Full-hook and
push results belong to the proposed head's PR evidence.

This work supplies the loop's owner operation only. Maker notes, destination
or role routing, directory creation/removal, and additional refusal selection
remain unclaimed. No owner marker or merge is part of this maker's work.

## Independent review: Owner destination proof

The ordinary full hook at `1a1295d925d0804fa6c6433b19dc9c4bb443381d`
measured 4,224 tests, 4,165 passing, no failures or cancellations and 59 skips
in 603,510.620074 ms, and its normal push passed. The independent reviewer's
F1 then demonstrated that the new claim-span test did not assert the Owner
destination required by its `R-ESCALATE-8` and `R-ESCALATE-15` declarations.

In a disposable local clone of that head, a guarded single replacement of
`escalated: { to: 'owner' }` with `escalated: { to: 'review' }` was read back
and recorded as a diff. A probe in the named loop test measured card 96 in
Review and transition `owner` to `review`, while the original test passed.
The test now additionally asserts the actual configured Owner column and
the recorded transition's `to: 'owner'`, keeping every prior assertion,
deadline and proof declaration. Author production files are unchanged.

The command was `npm test --
--test-name-pattern=one.escalation.claim.spans.every.awaited.owner.write
test/loop.test.mjs`. With the verified destination fault, its one named test
failed on the new Owner assertion: actual Review, expected Owner. After
byte-exact production restoration and clean source status, that same target
passed its one test in 235.905441 ms, with no failures, cancellations or skips.
The first scratch setup's restore guard stopped because its baseline file
was staged as added rather than committed; the complete proof was repeated
in the clean clone, and that earlier guard failure is preserved separately.
