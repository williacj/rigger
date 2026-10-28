ABOUTME: Records card #1066's test-first escalation and rounds derivations and one fixture's L2 figures.

# #1066 — escalation rates and rounds by kind

The acceptance is card #1066 revision `b8e7ad4e63b4`, based on `f84bb85bb432`.
ARCHITECTURE.md's “What `report` derives”, L2, owns the two signals. The architect's
[rounds ruling](https://github.com/williacj/rigger/issues/1066#issuecomment-6459662693)
places their shared rounds derivation here for #1067 to read. `roundsPerCard` is that one
function; its rows are available as `report(directory).l2.stream.rounds`.

The pre-code deterministic baseline passed through the host-wide slot on 2026-10-28:
`baseline.log` records verdicts=3703, pass=3703, fail=0, starting one-minute load 7.52,
ending load 5.41 and starting user process count 620. The affected report baseline also passed.
The slot wait was recorded on the card; no source or test changed during it.

## Test-first record

Each row is a separate red before the source for that slice, followed by its green run.
These are measurements from `1066-evidence/red-1.log` through `red-5.log`, dated
2026-10-28 04:59–05:01 UTC, in the uncommitted worktree on `rigger-1066` based on the
commit above. Each red reached one named verdict, pass=0, fail=1; none was an import,
fixture, timeout or file verdict. There is no red commit.

Every command used `TMPDIR=/Users/cjwilliams/Github/rigger-worktrees/codex-1066-tmp`
and `npm test -- --test-reporter=tap --test-timeout=10000`, followed by the options
below and `test/report-escalation-rounds.test.mjs`. Full output was teed before inspection.

| Slice | Selection after the common options | Named assertion that failed | Code added afterwards |
|---|---|---|---|
| Independent populations | no name pattern | The exact headings/rates array lacked every escalation-rate line | Distinct escalated and pulled cards per span; rate rendering |
| Entries and reasons | `--test-name-pattern='lists each escalation'` | The run's exact lines lacked every escalation entry and continuation | Entries in line order, optional destination, reason continuations, stream annotation |
| Rounds | `--test-name-pattern='derives rounds'` | `report exposes its shared rounds derivation` | Sets of head/digest pairs per card |
| Kind | `--test-name-pattern='latest kind-carrying'` | The expected card/kind pairs instead held undefined kinds | Latest non-null kind on an L3 pull in line order |
| Grouped output | `--test-name-pattern='prints rounds only'` | `one rounds heading across the stream`: 1 was not 2 | Across-stream kind groups and per-card counts |

`green-1.log` through `green-5.log` record the subsequent whole-file passes, respectively
verdicts=1, 2, 3, 4 and 5. Each new test was present in its own red before its source existed.
No declaration claims R-RECORD-3; M7-K4 leaves that requirement's complete proof to M9.

## One stream, each L2 figure

These are measurements from the fixture written by “report prints rounds only across the
stream grouped by kind”, printed in `green-5.log`. The arithmetic below is independently
worked from its literal events.

| Span | Host faults / work claims | Escalated cards / pulled cards |
|---|---|---|
| r-a | 1 / 4 = 0.25 | 1 / 3 = 0.3333 |
| r-b | 0 / 2 = 0 | 1 / 2 = 0.5 |
| Stream | 1 / 6 = 0.1667 | 2 / 5 = 0.4 |

In r-a, L3 pulls #7 twice, #9 once and #10 once. None is a merge claim, giving four work
claims. L2's `maker.failed` under #7 is the one host fault. L2 escalates #7, so the
escalation numerator is {7}, over the distinct pulled cards {7,9,10}. Its entry names
category ambiguous, raiser loop and reason “workspace refused”; it records no destination.

In r-b, L3 pulls #11 and #12 and L2 records no host fault. L2 escalates #8 despite there
being no pull under #8. The numerator is therefore {8}, over {11,12}. Its entry has the
same category, raiser and reason as r-a's, and likewise no destination.

Across the stream the host faults and work claims sum to 1 and 6. The escalation
populations are unions: {7,8} and {7,9,10,11,12}. The stream lists neither escalation again.

| Kind printed | Card | Rounds | Events counted |
|---|---|---|---|
| `"change"` | #7 | 2 | L2 reads (head-a,digest-a) and (head-b,digest-a); the latest kind-carrying L3 pull says change after spike |
| `"change"` | #12 | 1 | One L2 read of (head-a,digest-a), with change on its pull |
| `"spike"` | #9 | 1 | One owner's L2 read of (head-a,digest-a), with spike on its pull |
| no kind | #8 | 1 | One L2 read of (head-a,digest-a), without a pull carrying kind |
| `"change\n  card #999"` | #11 | 1 | One owner's L2 read of (head-a,digest-a); the pull's kind holds a newline |

Card #10 has a pull but no marker read and is absent from rounds. A quoted kind escapes its
newline, so it stays on one line. Round headings, kind headings and card rows start with at
least four spaces; reason continuations start two spaces further than their escalation entry.

## Cases under the catch-all row

- Escalation populations remain independent even when their rate exceeds one. Repeated pulls
  do not increase the denominator; merge claims remain in it. A card repeated across runs is
  counted once across the stream, rather than summing run counts.
- Events without a card, null and absent alike, enter neither card population. A matching
  event name from another layer and an unread event or field change no L2 figure.
- A zero denominator prints no rate even where an escalation exists. That escalation is still
  listed under its run. A stream with no pulls likewise prints no rate.
- Pair identity includes both head and digest and excludes role, evidence and verdict. Owner
  reads count. Null and absent pair components have the same identity. Delimiters within
  components do not collapse different pairs.
- Kind selection follows line order even where timestamps go backwards. Missing or null kinds
  on later pulls do not displace the latest recorded kind. A kind on another event or layer is
  ignored. A card with only kindless pulls joins the no-kind group if it was judged.
- Reasons retain blank and trailing continuation lines. An actual newline becomes a
  continuation; a literal backslash-n stays literal. A continuation resembling a marker line
  remains indented beneath its escalation.

The PR holds the final-head source-revert and guarded-mutation receipts, protected-output
comparisons, fresh-clone measurements, CI and the acceptance ledger. Only the two bounded
grant classes change existing test lines: the host-fault assertion through `rateIn`, and
`review.waiting` replacing `review.escalate` in the noise list.

## Full-suite fixture correction

The first changed-tree full run, `failed-full-1.log`, reached verdicts=3708, pass=3707,
fail=1. The failure was “every repository a test builds is built in the one fixture, and no
other route reaches git blind”, in `test/git-environment.test.mjs`. It reported the new
file's `gitIn(fixture.consumer, ...args)` as subcommand null, forwards false, rather than
an auditable Git read. Its starting load was 3.81 and its ending load was 5.10, as the
suite-slot record measured on 2026-10-28 05:11:46–05:18:26 UTC.

The adapter now checks repoRoot's documented command arguments and calls
`gitIn(fixture.consumer, 'rev-parse', '--show-toplevel')` explicitly, following the existing
in-process resume test's real-Git pattern. No existing audit line changes. This fixes the
new fixture's call shape; it changes no report behavior. The focused audit passed in
`git-audit-fixed.log`, and all five feature tests passed in `fixture-fixed.log`.
