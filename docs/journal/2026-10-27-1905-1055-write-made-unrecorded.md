ABOUTME: Records how card #1055 stopped reporting a forge write the board took, whose event the sink
refused, as refused or failed, and the red runs its tests gave at the merge base before the fix.

# A forge write the board took, whose record the sink refused

At `6ba7318f`, every caller of a forge write wrapped each rejection of it as a refusal. That
included an `EVENT_REFUSED` from the write call itself, where the forge had made the write and
only an event of it went unrecorded. So `rigger once` said a move was refused when the board held
it, and the lane recorded a made merge's `merge.end` as `failed`. That broke the "Telemetry"
preamble: "Any layer that acted outside Rigger and then had that action's event refused reports
the refusal to its caller. The report names the action and the card." It broke `R-RECORD-9`
("When Rigger cannot record an event, it says what went unrecorded and starts no further work
until it can."), and the false `merge.end` broke `R-RECORD-6` ("The record loses no event. What
Rigger emitted is what a later reader finds.").

The placement is [the attack](https://github.com/williacj/rigger/issues/1055#issuecomment-6456170632),
findings 1 and 2, with [the concurrence](https://github.com/williacj/rigger/issues/1055#issuecomment-6456196491)'s
two points. A caller cannot tell a refused event on the write from one on a read before it. Only
the side knows which call was the write, so each write side marks the failure `made`, with its
parsed answer, and each caller writes its own report from the mark.

## What the maker met building it

- **The shared mark had no home the card allowed.** A side cannot import another side's module
  (`test/layer-boundaries.mjs`, rules 5 and 6), and `runners.mjs`, `read.mjs` and `process.mjs`
  are frozen. Three copies would break the Rule of Three. The architect's
  [rulings](https://github.com/williacj/rigger/issues/1055#issuecomment-6456469635) placed it in
  `src/substrate/forge/write-made.mjs` (ruling 1).
- **A runner's own read shares the write's call.** `itemWriteRunner` reads `columnsField`, and
  `schemaWriteRunner` reads `heldOptions`, through the same `send`, before the mutation. So for a
  GraphQL write the mark also needs the mutation's root field in `data`, non-null (ruling 2).
- **`verdict` and `setup-board` take no side.** Their rows, and one `once` move, run through the
  real bin with a `gh` stand-in that leaves a child alive and turns the stream into a directory,
  in `test/verb-forge-kill.test.mjs` (ruling 3).
- **An existing test needs "went unrecorded".** `namesUnrecordedKill` in that file reads the
  phrase, so a made write's report names the unrecorded events as `N L0 event(s) went
  unrecorded: …`.

## Cases outside Table W, each as at the merge base

- A merge marked made whose `merge.end` the sink also refuses: the lane still returns both
  failures in one, and its sentence says the merge was made, not that it failed.
- Every other path to `change` (`moved`, `mergeEnded`, `roleSettled`, `escalated`'s move) reports
  a marked move as `change` does, because the report lives in `change`.
- A write that resolves: each side's success path is unchanged. The root-field check runs only
  for the mark.
- `status-issue.mjs`: out, since the merge base holds no merge of PR #1037. Follow-up #1056.

## Red runs at the merge base (U80)

Each new test ran against `6ba7318f`'s source in a detached worktree of that commit, before the
code that makes it pass.

- `test/write-made.test.mjs` tests a module the merge base does not hold, so a run at the merge
  base only fails to load (`ERR_MODULE_NOT_FOUND`). That is no red, so its reds are runs against
  a skeleton `write-made.mjs` that neither marks nor carries
  (`export async function written(call) { return await call; }`, `export const carried =
  (failure) => failure;`).
  - Round 1: before the module's code, the file held four tests, and two failed against the
    skeleton. The other two were controls, a resolving call and the unmarked rejections, which
    the skeleton passes.
  - Round 2, at PR #1057's judges' finding: the two controls are folded into the marking test,
    so each retained test can fail on behaviour. The module's code already existed, so the
    skeleton was written over it for the run, and the code was then restored byte for byte
    (`cmp` clean). `tests 2, pass 0, fail 2`: the marking test on `actual: undefined, expected:
    { answer: { id: 7, html_url: … } }`, and the carry test on `actual: undefined, expected:
    'EVENT_REFUSED'`.
- `node --test test/write-sides-made.test.mjs test/write-made-callers.test.mjs`, in the same run
  as the helper file's load failure: every one of these 19 tests failed.
  - Each of the 12 side tests fails on `made`: `+ undefined - { answer: 'PVTI_added' }` for
    `addIssue`, and the same for each other operation.
  - Each of the 7 caller tests fails on the report, as in `Input: "card #30's move from ready to
    coding (Coding) was refused: …"`. The lane's fails on `merge.end`, which was `outcome:
    'failed'`.
- `sh test/suite.sh --host test/verb-forge-kill.test.mjs`: `tests 17, pass 14, fail 3`, the
  three new tests:
  - `rigger once: card #10's move from ready to coding (Coding) was refused: the sink refused 1
    L0 event(s), so they went unrecorded: survivor.killed {…"cmd":"/usr/bin/tail -f …/hold"}:
    EISDIR …`. The move was made, and the kill refused.
  - `rigger setup-board: 0 writes to board 3 before one failed`.
  - `rigger verdict: the post failed, and it is not tried again: postComment on pull request #12
    failed: the sink refused 1 L0 event(s) …`.
