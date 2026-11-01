ABOUTME: Records #1181's failed-maker classification, red evidence, compatibility checks and pending test retarget grants.

# Failed makers wait for another invocation

The acceptance read for this work is card #1181 revision `35902fa0520f`.
The architect's ruling is issue comment 6564233873 on that card.
The dispatched base is `5c7d911b46b75255be041368d3bb4d992b808549`.

L2's maker settle reads the branch and the line's open, merged and closed pull
requests after a plain nonzero exit. It answers `set-aside` only when all are
absent. L3 remembers that answer for the invocation, before releasing the slot,
and asks no judges. A read failure rejects the settle and leaves the release
pull free to read the card again. Existing escalation routing runs first.

The one architecture row is the architect's proposal for the owner to ratify at
the marker. No Self-hosting path or next-action implementation changes.

## Before implementation

The deterministic baseline measured through the coordinator's suite slot at the
base passed: 4326 tests, all passing, exit 0. The slot measured one-minute load
6.53 at start and 9.08 at end. The saved output is
`codex-1181-tmp/1181-baseline.log`, beside this clone rather than under it.

Before the resumed implementation, a guarded temporary probe added just the
ruled reads to the nonzero settle path, ran the unchanged
`test/transitions.test.mjs`, and restored the production file byte-exact.
All 31 tests passed, including the bodies at the base's lines 75 and 225.
The source SHA-256 before and after was
`48ba1e95da513210f200f48402f0ee8d2d8a235bffb4c10406e5a0a38a9f906d`.
The measured start/end loads were 10.13/10.13. The log is
`codex-1181-tmp/1181-transitions-preflight.log`.
No line in that existing test file changes.

The affected host baseline ran with
`npm test -- --host test/escalation-loop-host.test.mjs test/loop-host.test.mjs`.
It passed 28/28, exit 0, at measured loads 9.80/9.43. Its full output is
`codex-1181-tmp/1181-host-baseline.log`.

## Red and green

F1 was written before its production change. The command was
`TMPDIR=/Users/cjwilliams/GitHub/rigger-worktrees/codex-1181-tmp caffeinate -i npm test -- test/failed-maker.test.mjs`.
The genuine red, in `1181-F1-red-2.log`, was:

```text
F1: a clock-held run dispatches a plain failed maker exactly once across releases and polls
AssertionError [ERR_ASSERTION]: the release must not dispatch the failed maker again
2 !== 1
```

The named assertion counted L1 `dispatch.start` records joined to L3's maker
role, excluding judges. Loads measured at its start/end were 2.57/2.57.
The next run, `1181-F1-green.log`, passed the new F1 and all 31 unchanged
transition tests, exit 0, loads 2.20/2.20.

The earlier `1181-F1-red.log` was invalid fixture setup, not product red.
Scratch validation reached the default host and failed the deterministic
process guard (`cannot signal -83126 with 0`, also `-83127`). The fixture now
scripts both the supplied and default process host, including scratch-validation
Git commands. No test boundary is relaxed. The only native Git calls use the
existing repository fixtures.

F1a, F2 and F4b were added after the production change and require revert
proof under M7-U9. F3, F4, F5, F6, F7 and F8 guard merge-base behaviour and
require killed mutation receipts under M7-U15. The pull request is the delivery
record for those guarded runs at its committed head.

The first F4 compatibility oracle incorrectly expected an Owner move for an
open pull whose mergeability was unknown. `codingAnswer` in
`src/workflow/judges.mjs` answers ignore for that state. The fixture expectation
was corrected to Coding and will be checked against the merge base.
`1181-F2-F4-green.log` preserves that failed oracle run.

The F4 cells include an open or merged pull with its branch absent, and the
bounded compatibility observation of F4a's closed-only, branch-absent state.
F4a still behaves as at the merge base; this work makes no new policy for it.
F9 and F10 are outside this card. Under F11, no additional product case beyond
the enumerated rows was met.

## Existing assertions and the grant

The first full working-tree run measured 4345 tests, 4336 passing and nine
failing, exit 1, slot loads 5.61/11.42. Its full output is
`codex-1181-tmp/1181-full-worktree.log`.

Seven failures were existing escalation-note tests expecting `undefined` for
plain nonzero exits. One was the existing settle test expecting no pull-request
read after a nonzero exit. They conflict with the architect's ruled answer and
new reads. The remaining failure was this new fixture's direct `git worktree`
read. It now uses the existing `worktreeList` fixture helper.

The retargets preserve every no-board-write assertion. The existing-line
changes are only escalation-note assertions at base lines 66 and 99, and the
settle test's title and read expectation at base lines 215 and 222. No existing
test is deleted. M7-K30 (issue #1009 comment 6564436151) grants exactly
these replacements. The author records grant class 1 and the paths in revision
`35902fa0520f`; no other existing test line changes.

With those local retargets, the command
`npm test -- test/failed-maker.test.mjs test/transitions.test.mjs test/escalation-note.test.mjs test/settle.test.mjs test/git-environment.test.mjs`
passed 113/113, exit 0, loads 13.57/16.80. The output is
`codex-1181-tmp/1181-retarget-local.log`.

At this uncommitted working state, `npm run matrix:check` exits 0.
`node scripts/package-budget.mjs` measures L3 as 1323 production lines:
267 admission, 50 clock, 104 lane, 880 loop and 22 pull-order.
This is a measurement of the working change, not a published head.

This entry owns the implementation rationale, the initial red and the
compatibility/retarget evidence. The pull request holds final-head verification,
guarded receipts, fresh-clone evidence, CI and preflight. The clone and its
temporary directory remain for the coordinator to remove.

## Round 2 — retained nonzero results and the pinned case

The round-1 architect's B1 found an additional F11 instance: L1's rejected
`EVENT_REFUSED` can carry the completed maker's `result`. Acceptance revision
eb16be39d8a6 names it F1c. At reviewed head bdc2012f73f83789763bef0fb3217384615d0539,
before changing production, the new F1c test failed with
`a refused end must not redispatch a maker that ran and left the forge empty`,
`2 !== 1`. The command was
`TMPDIR=/Users/cjwilliams/GitHub/rigger-worktrees/codex-1181-tmp caffeinate -i npm test -- --test-name-pattern='^F1c:' test/failed-maker.test.mjs`.
Full output is `1181-F1c-red.log` in that TMPDIR; one-minute loads were
11.49 at start and end, with 470 user processes at start. This red came before
its fix; the same test then passed (`1181-F1c-green.log`, loads 10.97/10.97).

L2 now reads a rejected outcome's retained nonzero integer exit through the same
note-first classification as a fulfilled result. A rejection without a result,
or with a zero exit, retains the prior handling. L3 still reports the original
rejected outcome, including its refusal code and result; no L1 or Self-hosting
path changes. Producer coverage added after the fix exercises L1's refused end,
refused timeout, L0's refused timeout kill, record-removal refusal, and a combined
record/end refusal. The boundary cells protect escalation precedence, retained
branch/open/merged/closed work, failed reads and no-result/zero compatibility.
These extensions owe the guarded reversion receipt with their before/after-code
status stated separately in the PR.

The full outcome-producer inventory is retained as `1181-result-inventory.log`:
L0's completed `runCommand` refusal carries `result`; L1 preserves it after the
catch, adds its own refused timeout/end, preserves an L0 refusal when combining
events, constructs `RECORD_REFUSED` after a failed removal, or wraps that record
failure as an L1 refusal's cause while retaining `result`. Refused start,
pre-result group-record failure, scratch/adapter preparation, and exit-cleanup
callbacks carry no completed maker result. Their existing handling remains.
F1c is the additional F11 instance met in this revision.

For B2, the architect authored a lead row and four continuation rows with the
same meaning as the earlier case. ARCHITECTURE.md copies the revised card's
fenced text byte for byte. This binding-document proposal remains the owner's
to ratify at the marker. The four K30 retargets remain the only existing test
lines changed against main. Main remained at 5c7d911b after fetching before this
revision; no merge was needed. The earlier pre-code transitions L75/L225 proof
still applies, and all unchanged transitions tests pass in the round-2 named
run (111 total/pass, zero fail; loads 12.93/12.93).

Round-2 working-tree verification passed before commit: full deterministic
4363/4363, zero fail/cancel/skip/todo, through the slot at one-minute loads
7.71/9.22 (`1181-round2-full.log`). The 13 affected host files passed 206/206,
zero fail/cancel/skip/todo, with loads 7.46/24.09 and 456 user processes at start
(`1181-round2-host-head.log`). Every run retained complete output before any
summary. Matrix and package checks exited 0; L3 remains 1323, package 9075/12000.
The committed-head receipts, fresh clone and CI are delivered in the PR body.
