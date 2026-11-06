ABOUTME: Card #1241's clock-held exit-read classification, test-first evidence and case inventory.

# A failed exit read defers a clock-held maker

Card #1241, acceptance revision `fa576015f5d2`, defines completion. The architecture rows are
the card's pinned proposal, for the owner to ratify at the pull request's marker.

L2 uses its existing failed-maker classifier for fresh clock-held exits as well as no-clock
exits. Both work reads run even when one fails. A successful source establishes presence;
otherwise a failed source leaves work unreadable. Early comments and escalation reads retain
their failures while still classifying work. Continuing and zero-exit boundaries remain intact.

L3 uses its existing direct set-aside memory for a clock-held absent or unreadable answer.
No-clock runs retain their maker bar. Successful clock-held presence still answers `undefined`,
so L3 cannot mistake classification metadata for review facts.

## Before code

The base was `811b29b6`. The test binding search ran before edits:

```sh
rg -n 'transitions\.mjs|scheduling/loop\.mjs|failed-maker|ARCHITECTURE\.md|test-matrix\.md|docs/journal' test/ --glob '*.mjs'
rg -n 'readFileSync.*(ARCHITECTURE|transitions|loop\.mjs|test-matrix|journal)|readFile.*(ARCHITECTURE|transitions|loop\.mjs|test-matrix|journal)' test/
```

The source consumers include failed-maker, transitions, settle, escalation-note, loop,
facts-pull and pull-outcomes tests. The cross-file bindings include the published config in
config and clock-config tests, the concurrency import in launchd tests, instruction budgets,
the generated matrix checks and the layer-boundary checks. None required another edited path.

Measured with `npm ci` and `npm test` through the host-wide slot on the Mini, the unchanged
base passed: tests 5030, pass 5030, fail 0. `uptime` measured one-minute loads of 7.73 at start
and 8.59 at end; `ps -U "$(id -u)" | wc -l` measured 642 user processes at start.

## Red before the relevant production change

The E1/E2 retarget ran against unchanged production code:

```sh
npm test -- --test-name-pattern='F4b:' test/failed-maker.test.mjs
```

```text
F4b: a failed branch or pull-request read rejects the settle and sets the card aside
readBranches: AssertionError [ERR_ASSERTION]: the release pull must defer the unreadable maker
2 !== 1
readPullRequests: AssertionError [ERR_ASSERTION]: the release pull must defer the unreadable maker
2 !== 1
```

The named run exited 1 at measured start/end loads of 13.93/13.93, with 661 user processes at
start. Reusing classification and deferring the clock-held card made the same target pass.

The E5 test preceded the comments-catch change:

```sh
npm test -- --test-name-pattern='E5:' test/failed-maker.test.mjs
```

```text
E5: failed exit comments with absent work report the failure and set the card aside
AssertionError [ERR_ASSERTION]: unread comments must not bypass the failed-maker exclusion
2 !== 1
```

That run exited 1 at measured start/end loads of 18.08/19.28, with 655 user processes at start.
Classifying work after the comments read failed made the same target pass.

The E6 escalation cases preceded the escalation-catch change. Its comments variants were
added after their production change; the whole test is classified as late-red under M7-U9.

```sh
npm test -- --test-name-pattern='E6:' test/failed-maker.test.mjs
```

```text
E6: failed comments and escalation reads preserve present or unreadable work handling
escalation/present: AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ undefined
- 'present'
escalation/unreadable: AssertionError [ERR_ASSERTION]: an early failed read must not redispatch an unclassified maker
2 !== 1
```

That run exited 1 at measured start/end loads of 23.54/24.77, with 660 user processes at start.
Classifying after the failed escalation read made the same target pass.

## Other tests and failed attempts

E3, E7, E8 and E9 were added after the shared classification change and are classified as
late-red under M7-U9. E4, E10/E12 and E11 are invariant guards under M7-U15 because the merge
base already has their behavior. All these tests use the existing world with its injected manual clock.

The first affected run was:

```sh
npm test -- test/failed-maker.test.mjs test/transitions.test.mjs test/settle.test.mjs test/escalation-note.test.mjs
```

It exited 1, with tests 133, pass 129 and fail 4, at measured start/end loads of 15.59/14.90.
The start process count was 646. Its two failing subtests were:

```text
F4 continuing: failed fresh and continuing makers take distinct forge-read paths / fresh
AssertionError [ERR_ASSERTION]: R-WORK-34: only a fresh failed maker reads forge work
+ [ 'readPullRequests', 'readBranches' ]
- [ 'readBranches', 'readPullRequests' ]

E4: a branch or open or merged pull preserves the ordinary release after the other read fails / open
AssertionError [ERR_ASSERTION]: the release must read and act on this card instead of skipping it
1 !== 2
```

The first failure exposed the reused classifier starting its pull read before its deferred
branch read. Deferring both starts preserves the established order, while still attempting
both reads. The narrow F4 continuing target then passed.

The second failure was an incorrect new oracle. An open pull makes the ordinary release read
the work and wait, without another claim. E4 now observes that release read and preserves the
ordinary claim count. Its narrow target then passed.

The repeated affected command passed with tests 137, pass 137 and fail 0, at measured
start/end loads of 8.36/8.17, with 639 user processes at start. Matrix generation,
`npm run matrix:check` and `npm run lint:spec-style` passed. The package-budget tool measured
1523 production lines under `src/scheduling/` in this local state.

The broader scheduling and binding run passed with tests 900, pass 900 and fail 0. `uptime`
measured start/end loads of 5.51/18.94, with 654 user processes at start:

```sh
npm test -- test/loop.test.mjs test/set-aside-memory.test.mjs test/clock-arming.test.mjs test/facts-pull.test.mjs test/pull-outcomes.test.mjs test/layer-boundaries.test.mjs test/launchd.test.mjs test/config.test.mjs test/clock-config.test.mjs
```

After tightening E7's assertion to precede readiness waiting and letting E9 observe either
a new maker or a settled empty run, the affected command passed again: tests 137, pass 137,
fail 0. Measured start/end loads were 21.56/22.32, with 670 user processes at start.

## E13 cases encountered

The existing failed-maker tests exercise these cases outside E1 through E12's failed-read
branches: a plain nonzero exit with absent work; a plain nonzero exit with a branch or pull;
a recording refusal retaining a completed nonzero result; a rejection without a completed
result; failures before the command starts; a valid maker escalation handled by a role; and
the single-pull entry used by `once`. Their existing assertions are retained.

## Test-line grants

Before publication, main advanced to `4e8c34ec`. The merge conflicted only in the generated
test matrix, which `npm run matrix` regenerated. The card's diff against main still contains
only its six Lands-in paths; the pinned architecture row is its only architecture delta.

F4b changes existing merge-base lines 461, 463, 475, 476, 477, 478, 479 and 480. M7-K59 grants
the retargets and M7-U43 Q88 grants the two dropped lines. The single grant round identified
line 479, whose recovery assertion changes its maker count from two to one. M7-K62
(#1009, comment 6676605853) explicitly extends M7-K59 to that line; the coordinator relayed
the grant before this work was committed.

## Round 1 revision

Both judges found no production defect at the first reviewed head. Their B1 finding concerns
spec-style rule 4: the failed-read case has several independent conditions. The PM repinned
that case as a lead row and four continuation rows in card revision `fa576015f5d2`, announced
in comment 6679425294. This revision applies those exact rows. The proposal still awaits
the owner's marker.

The reviewer's B2 finding concerns requirement declarations. E4's presence cases and E10/E12's
early-read guards do not exercise `R-LOOP-19`. The revised card authorizes them as harness
diagnostics under the TDD skill. Their two declaration lines are removed; their bodies and
independent oracles stay intact, and the generated matrix drops those claims.

E4 checks the classification boundary where established presence preserves the release answer.
The card explains why `R-LOOP-19`, `R-SCHED-43` and `R-WORK-18` describe none of its assertions.
Its existing presence and presence-answer receipts discriminate lost presence and metadata
escaping as forge facts. E10/E12 check exclusion of continuing and zero exits from early failed
read classification. They dispatch no maker and assert no move, so the card excludes
`R-LOOP-19`, `R-WORK-18` and `R-WORK-34`. Their existing continuing and zero receipts
discriminate each boundary. These diagnostic receipts retain their original measured head;
no production byte or test-body byte changes in this revision.

The affected command ran the failed-maker, transitions, settle, escalation-note, config,
instruction-budget, document-checks and build-test-matrix files. It passed: tests 350, pass 350,
fail 0, with measured start/end loads 16.94/16.79 and 648 user processes at start. Matrix,
spec-style, references, headers and package-budget checks passed. The scheduling total remains
1523 production lines. A byte comparison confirms all five architecture rows match the new
card pin and both production files match the prior reviewed head.
