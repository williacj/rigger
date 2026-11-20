<!-- ABOUTME: Spike findings for card #1431: a Projects v2 board as a one-way mirror of Temporal card
workflows. Drift reconcile, signal-borne answers, the four edit/mirror interleavings, and forge cost. -->

# A Projects v2 board as a one-way mirror of Temporal card workflows

Card [#1431](https://github.com/williacj/rigger/issues/1431), acceptance revision `3c509245f0e7`.
That revision fills in the hosts and leaves the acceptance as it stood at `cb6b5a7391b7`. Every
figure below is a **measurement** unless it is marked as a judgment. Each measurement names the
evidence file it comes from, and those files sit in [`docs/spikes/projects-v2-mirror/`](projects-v2-mirror/)
beside this report.

## Answer

The board converged back to the workflow every time.
- **Drift:** after an API edit, the per-card reconcile restored the workflow's column. A poll
  first returned the restored column 22.9 s (I1), 35.2 s (I2) and 35.5 s (I3) after the edit was
  acknowledged, against a stated bound of 60 s. "Drift" below defines the metric and its bounds.
- **Escalation:** the answer, sent as a signal from the Temporal CLI, reached the board in about
  1.5 s: a poll first returned the next column 1,495 ms after the signal was sent.
- **Kill mid-write (I4):** killing the worker between the two field writes of one run left a
  partial board. The retried activity found it and wrote only the field still missing.
- **The workflow's own state never changed** because of a board edit.
- **Cost of one card:** from Ready to Done, with one escalation and one drift, it made **15
  production forge calls**, all GraphQL: 7 reads and 8 writes. Their GraphQL cost is 7 measured
  query points plus mutations the forge did not price per call. That is 15 points at the
  documented 1-point minimum, and at most 51 by the forge's own counters.

On affordability, the mirror is affordable at the card's load **if the reconcile reads the board
in one batched query per pass**. That costs about 120 GraphQL points an hour at a 30 s interval.
It is **not affordable on a shared user token as I ran it**, with one read per card per pass. At
30 open cards that costs about 3,600 points an hour, 72% of the user's 5,000-point hour.

## What I ran

### Host and versions

The server, the worker, every forge call during the runs and every timing ran on the Windows
machine. The laptop held the SSH sessions open and made the setup and teardown calls. Each value
below is quoted from the command that printed it, in [`docs/spikes/projects-v2-mirror/transcript.txt`](projects-v2-mirror/transcript.txt)
at 2026-11-20T00:46Z, plus 00:40Z for `--version`.

| What | Value, as printed |
|---|---|
| Host | `Host-PC10` (`ssh hostpc`, `user@10.0.0.29` port 2223, Windows OpenSSH, cmd.exe) |
| OS and version | `Microsoft Windows [Version 10.0.26300.9974]`, `AMD64` |
| Node | `v24.19.0` (npm `11.17.0`) |
| Temporal CLI | `temporal version 1.10.1 (Server 1.32.2, UI 2.56.4)` |
| `@temporalio/*` (every one, from `npm ls --all --parseable --long`) | `activity@1.26.0`, `client@1.26.0`, `worker@1.26.0`, `workflow@1.26.0`, `common@1.26.0`, `proto@1.26.0`, `core-bridge@1.26.0`, `nexus@1.26.0` |
| Laptop (setup, teardown, SSH client) | `[laptop host]`, macOS `27.2.1`, Node `v26.13.0` |

**Why Windows and not WSL2.** WSL2 is the card's other primary host. At 00:40:08Z
`ssh wsl-hostpc` answered `kex_exchange_identification: read: Connection reset by peer`, and
rigger-ae's direction was to use `hostpc` in that case. The stated-intent addendum records the
switch.

**How it ran.**
- `temporal.exe server start-dev --port 7243 --ui-port 8243 --db-filename C:\Users\USER\1431-spike-engineer\temporal.db --log-level warn`
  ran with one worker on task queue `spike-1431`.
- Windows OpenSSH ends a session's children when the session closes. The laptop therefore held
  each long-running process open in its own `ssh` session.

### Forge, token and comments

- **Forge plan, posted first:** before any forge object existed, I posted
  [1431#7014271069](https://github.com/williacj/rigger/issues/1431#issuecomment-7014271069). It
  names the scratch repository and board, the credential's scopes and how the board is deleted.
  It is also the stated-intent comment, posted before the first install, the laptop
  `npm install` at 15:53Z.
- **Addendum, before the first remote install:**
  [1431#7026615458](https://github.com/williacj/rigger/issues/1431#issuecomment-7026615458),
  posted before the Temporal CLI download on hostpc.
- **Scratch repository:** <https://github.com/williacj/rigger-1431-mirror-scratch>.
  rigger-ae has since deleted it at the owner's request; see "Teardown and custody".
  - Its visibility is **private**: `repoPrivate: true` from the create call, and
    `gh repo view … visibility` answered `PRIVATE`.
  - It holds 32 issues, "Scratch card 1..32".
- **Scratch board:** <https://github.com/users/williacj/projects/14>, number 14, node
  `PVT_kwHOBzomGc4BsXT-`.
  - Its owner is a **user**, `williacj`: the create call answered `owner { __typename }` =
    `User`.
  - Its Status field has the options Ready, Coding, Review, Owner and Done. Those are the names
    in `rigger.config.mjs` at `6be13718`, line 17. It also has an `Escalation` text field.
- **Credential:** the `gh` CLI's OAuth token for `williacj`. I stated its scopes in the comment
  before the first call: `delete_repo`, `gist`, `project`, `read:org`, `repo` and `workflow`. The
  call log holds no call that needs `delete_repo`, `gist` or `workflow`. On hostpc the token
  reached each Node process on stdin and was never written to a file there.

### The code (throwaway, not committed)

It lived in the spike's gitignored directory, spikes/1431-spike-engineer under the worktree, and was copied to
`C:\Users\USER\1431-spike-engineer\`, which I have since removed.

- **`cardWorkflow`:**
  - Its workflow id is the card, `rigger-1431-mirror-scratch#<n>`.
  - It holds `{column, escalation}`, and an `advance` signal moves it on one column.
  - On entering `Coding`, cards 1 and 4 escalate: escalation becomes
    `ambiguous: waiting on owner answer`. They then wait for an `answer` signal, which clears the
    escalation and moves the card to Review.
  - While it waits it runs `wf.condition(…, 30 s)`, and on every timeout it runs `mirrorCard`
    again. That re-run is the reconcile.
- **`mirrorCard`:**
  - It reads the item's Status and Escalation in one GraphQL query.
  - It writes each field that differs from the workflow's full state: `SetStatus`, then
    `SetEscalation` or `ClearEscalation`.
  - It waits the read-back delay, then reads the item again. That second read is instrumentation,
    not part of the mirror.
  - Running it twice with no change writes nothing the second time; see the run-twice check.
  - File gates let me hold one run after its read, after its first write, or after its writes.
  - Activity options: `startToCloseTimeout` 2 min, `heartbeatTimeout` 10 s, retry interval 1 s.
- **Call logger:** every forge call went through one logger. It recorded the time, REST or
  GraphQL, read or write, the method, the endpoint or operation, the HTTP status, the
  `x-ratelimit-*` headers and the GraphQL rateLimit.cost. That is
  [`docs/spikes/projects-v2-mirror/calllog.json`](projects-v2-mirror/calllog.json). It holds 599 logged calls, merged from both hosts. Each logged
  `ts` is the request's start and `ms` its duration, so `ts + ms` is when the response completed.
  It also holds 30 entries marked `reconstructed: true`, none of which was logged when made.
  - **What they are:** the calls I made by hand with `gh`, `git` and curl.exe, and five fetches
    of GitHub documentation.
  - **How they were rebuilt:** each comes from the transcript or from session-log.txt. Its
    `source` names the entry, and its `note` says which of its fields are not measured.
  - **Completeness:** I checked every `gh`, `git fetch`, `git push` and curl.exe command, and every
    documentation fetch, in session-log.txt through revision 2 against these entries. Each has
    one.
  - **Exceptions:** the revision-2 push, which this file cannot record because the push carries
    it. One `gh issue view 1431 --comments --json comments`, in session-log entry [2], failed on
    its own flags before sending any request; gh printed its usage text.

### Read-back delay

**Each `mirrorCard` waited 3,000 ms between its last write and its read-back from the forge**
(`READBACK_DELAY_MS`, recorded as `readbackDelayMs: 3000` in every `end` event in
[`docs/spikes/projects-v2-mirror/mirror-runs.json`](projects-v2-mirror/mirror-runs.json)). The watchers that timed the signal
and the drift polled the item every 500 ms.

### Drift detection

- **The route I ran:** every card workflow polls its own board item. On every reconcile timeout
  the workflow runs `mirrorCard`, which reads the item and writes back any field that differs.
- **Reconcile interval:** 30,000 ms (`node start.js 30000 …`). The timer starts when the previous
  run ends. A run takes about 3.5 s with the read-back, so the measured cadence per card was about
  33.5 s (card 5's reconcile ends: 00:42:45.7, 00:43:19.3, 00:43:53.2, …).
- **Bound:** 60 s, which is twice the interval. An edit is reverted by the first reconcile run
  that starts after it. That run starts at most 30 s plus one run's length after the edit, and
  its write lands within one more run's length. With a run of about 3.5 s, everything fits
  within 2 × 30 s.
- **How the board was changed:** every drift edit went **through the API**
  (`updateProjectV2ItemFieldValue`, purpose `edit-drift` in the call log), never through the web
  interface.

**Routes I considered and did not run.**

| Route | Why not |
|---|---|
| A `projects_v2_item` webhook | The GitHub docs list its availability as `organization` only. They describe it as "activity relating to an item on an organization-level project", and this board is user-owned. The card also puts internet-delivered webhooks out of scope. |
| A GitHub Actions workflow triggered by a board edit | The Actions page "Events that trigger workflows", read on 2026-11-20, lists no Projects v2 event or `project` trigger. |
| One batched board read per pass (`ScanBoard`, 100 items a page), mapping drift to card workflows | It needs a coordinating workflow, or an activity that reaches card workflows through the client. That is machinery beyond the card's "the workflow's reconcile". I **measured its cost instead**: one `ScanBoard` over the 32-item board was one call with rateLimit.cost 1 (call log, 00:46:28.487Z, purpose `batched-reconcile-pass`). I did not time drift reverts with it. |
| A blind full-state write every interval, with no read | It writes forever. That is 2 mutations per card per pass, each costing 5 secondary-limit points, where read-compare costs 1 query and no write when nothing has drifted. |

## Findings

### Card 1, Ready to Done, with its escalation and one drift

Only card 1 was moved all the way from Ready to Done. The table gives the board's column after
each `mirrorCard` run, read back from the forge 3 s after the run's writes, against the column
the run carried. Source: `end` events for card 1 in `docs/spikes/projects-v2-mirror/mirror-runs.json`.

| Run ended (UTC) | Why | Writes | Board read back | Workflow column | Match |
|---|---|---|---|---|---|
| 00:42:10.858 | transition | Status | Ready | Ready | yes |
| 00:42:27.052 | transition | Status | Coding | Coding | yes |
| 00:42:31.503 | transition (escalate) | Escalation | Coding, escalation set | Coding, escalation set | yes |
| 00:42:52.807 | transition (answer) | Status, Escalation | Review | Review | yes |
| 00:43:27.756 | reconcile (I1 drift) | Status | Review | Review | yes |
| 00:43:35.379 | transition | Status | Owner | Owner | yes |
| 00:43:39.886 | transition | Status | Done | Done | yes |

### Running `mirrorCard` twice with no change

Card 5 was held in Ready for its whole run.
- Its first run, at 00:42:06Z, made one write (`SetStatus`).
- Every later run made **0 forge writes**. That is nine reconcile runs from 00:42:42 to 00:47:21,
  each a single `ReadItem` with no write after it. Source: the call log entries for card 5;
  `end` events with `writes: []` in `docs/spikes/projects-v2-mirror/mirror-runs.json`.

### Escalation answered by a signal

The command that sent the answer was run on hostpc by sigwatch.js and printed by it; see the
transcript entry at 2026-11-20T00:42:48Z:

```
temporal.exe workflow signal --address localhost:7243 --workflow-id rigger-1431-mirror-scratch#1 --name answer --input '"proceed: owner answer"'
```

- **The workflow received it:** [`docs/spikes/projects-v2-mirror/histories/card-1.json`](projects-v2-mirror/histories/card-1.json)
  event 30 is `EVENT_TYPE_WORKFLOW_EXECUTION_SIGNALED` at `2026-11-20T00:42:48.197152700Z`, with
  `signalName` `answer`, input `"proceed: owner answer"` and identity
  `temporal-cli:HOST-PC10\USER@Host-PC10`. Event 35 schedules `mirrorCard` with
  `{column: Review, escalation: ''}`.
- **Signal to board:** the signal was sent at 00:42:48.146Z, the instant sigwatch.js printed
  just before invoking the CLI. The board first showed Review in a poll that started at
  00:42:49.442Z and **completed at 00:42:49.641Z, 1,495 ms after the signal**. The metric is
  defined under "Drift". The bounds:
  - The poll before it started at 00:42:48.213Z (67 ms) and still answered Coding, so the change
    landed later than 67 ms and no later than 1,495 ms.
  - The mirror's own `SetStatus` to Review was acknowledged at 00:42:49.047Z (901 ms). So the
    change landed after 67 ms and by 901 ms; the poll saw it at 1,495 ms.

### Drift

**The timing metric.** Each figure is measured from the call log's request times.
- **Start instant:** for drift, the moment the edit's API call was acknowledged. For the signal,
  the moment just before the CLI was invoked.
- **The figure:** the **completion** of the first watcher poll that returned the workflow's
  column (`ts + ms` of that poll in `docs/spikes/projects-v2-mirror/calllog.json`). A read's answer is known only when its
  response completes, so this is the observation. It is an upper bound on when the board changed.
- **Lower bound:** the start of the poll before it, which still returned the old column.
- **Cross-check:** the acknowledgment of the reconcile's own write. It proves the change had
  landed by then, so it tightens the upper bound.
- **Correction:** the version of this report at `8fb675a7` used the matching poll's request
  start, which is earlier than its answer. These figures replace it.

| Drift | Card and edit | Edit acknowledged | Reconcile write acknowledged | Previous poll started (old column) | Matching poll completed | **Measured time** (edit → matching poll completed) | Within 60 s |
|---|---|---|---|---|---|---|---|
| I1 | 1: Review → Done | 00:43:01.675Z | 00:43:24.413Z (22,738 ms) | 00:43:23.539Z (21,864 ms) | 00:43:24.554Z | **22,879 ms** | yes |
| I2a | 2: Ready → Review | 00:43:49.893Z | 00:44:24.588Z (34,695 ms) | 00:44:24.106Z (34,213 ms) | 00:44:25.069Z | **35,176 ms** | yes |
| I3 | 3: Coding → Owner | 00:44:41.493Z | 00:45:16.342Z (34,849 ms) | 00:45:15.791Z (34,298 ms) | 00:45:16.950Z | **35,457 ms** | yes |

Each revert therefore landed after the previous poll's start and by the reconcile write's
acknowledgment. The first poll that saw it completed 22.9 s, 35.2 s and 35.5 s after the edit.

**The workflow's own state did not change.** In each case its history shows no signal during the
drift, and the next activity carries the unchanged state.

| Card | Drift window | Signals | Next activity carries | Other evidence |
|---|---|---|---|---|
| 1 | between the `answer` signal (event 30) and the next `advance` (event 53) | none | event 46, `reconcile` with `{Review, ''}` | — |
| 2 | 00:43:49–00:44:24 | none (its only signal is event 56 at 00:44:31) | events 38 and 49, `reconcile` with `{Ready, ''}` | event 40's result reads back `Review` with `match: false`, and the next activity still carries `Ready` |
| 3 | from the edit to the revert | none | event 72, `reconcile` with `{Coding, ''}` | `temporal workflow query --name state` answered `{"column":"Coding","escalation":""}` for cards 2 and 3 at 00:46:54Z |

### The interleavings

The final state of each row was read back from the forge, by the run's read-back, a watcher or a
scan.js read.

| Row | What happened | Board's final state | Equals the workflow's? |
|---|---|---|---|
| I1 | Card 1's edit landed at 00:43:01.675Z. The previous run ended at 00:42:52.807 and the next started at 00:43:22.8, so no run was in flight. The reconcile read `Done` and wrote `Review`. | `{Review, ''}`: read back at 00:43:27.756 | **yes** |
| I2, reconcile run (I2a) | Card 2 was held in Ready. The run read `Ready`, which matched, and was held after its read while the edit to `Review` landed. Released, it wrote nothing, because its read had matched. | `{Review, ''}` at the run's read-back (00:43:53.393) | **no**. The next reconcile, at 00:44:24.590, wrote Ready; read back `{Ready, ''}`, which **equals** the workflow. |
| I2, transition run (I2b) | Card 2's `advance` started a run that read `Ready`. It was held after its read while the edit to `Done` landed. Released, it wrote `Coding`. | `{Coding, ''}`: read-back at 00:44:37.136, and a scan.js read just after | **yes** |
| I3 | Card 3's transition run wrote `Coding` and was held after its writes while the edit to `Owner` landed. | `{Owner, ''}` at the run's read-back (00:44:44.852) | **no**. The next reconcile wrote Coding at 00:45:16; read back `{Coding, ''}`, which **equals** the workflow. |
| I4 | Card 4 was escalated in Coding; the answer started a run. It wrote `Status=Review`, was held after that first write, and its worker (pid 34000) was killed with `taskkill /F`. The forge then read `{Review, 'ambiguous: waiting on owner answer'}`, a partial write. A new worker (pid 30548) took the retry. History event 91 is attempt 2, with last failure `activity Heartbeat timeout`, at 00:45:37.6Z, 13 s after the kill. Attempt 2 read the partial state and wrote **only** `ClearEscalation`. | `{Review, ''}`: read back at 00:45:42.487, and by scan.js | **yes** |

**How I placed the I2 edit between the read and the write.**
1. `node gated.js 2 after-read Review` (transcript entry 2026-11-20T00:43:48Z) created
   gates/2.after-read.
2. The next `mirrorCard` run for card 2 did its read, found the file, renamed it to .held, and
   waited, heartbeating, for gates/2.release. `docs/spikes/projects-v2-mirror/mirror-runs.json` records `read` at 00:43:48.927
   and `gate-held` at 00:43:48.928.
3. gated.js saw the .held file and sent the edit; its answer came at 00:43:49.893.
4. gated.js then created the release file, and the run went on (`gate-released`,
   00:43:49.956).

I2b used the same steps; see the transcript entry at 00:44:31Z.

**What I2a shows.** A read-compare-write mirror cannot see an edit that lands after its read in a
run that found nothing to write. The run then reports success over a drifted board, and the drift
lasts until the next reconcile. That is bounded by the 60 s bound, and it measured 35.2 s here.

### Forge calls for one card

These are card 1's calls from Ready to Done (00:42:06–00:43:39Z), with its escalation and the I1
drift. Source: entries with `card: "1"` in the call log.

| | REST | GraphQL reads | GraphQL writes | Total |
|---|---|---|---|---|
| Production (`mirror-read`, `mirror-write`) | 0 | 7 (`ReadItem`) | 8 | **15** |
| Instrumentation (`readback`, `measure`, `edit-drift`) | 0 | 49 (7 read-backs, 42 watcher polls) | 1 (the drift edit) | 50 |

The 8 production writes, by operation:
- `SetStatus` ×6: 5 during transitions and 1 for the reconcile's revert;
- `SetEscalation` ×1;
- `ClearEscalation` ×1.

By run, 7 writes came during transition runs and 1 during the reconcile. The reads split 6
transition and 1 reconcile.

The signals and the workflow's state cost no forge call. They are Temporal-only.

**GraphQL rate-limit cost of that lifecycle.** Part of this figure is measured and part is bounded.

- **Queries, measured:** the 7 production queries cost **7 points**. That is the sum of the
  forge's own rateLimit.cost answers, and every `ReadItem` answered `cost: 1`. With
  instrumentation, the 56 reads cost 56 points.
- **Mutations, not measured per call:** a mutation cannot ask for `rateLimit`, so no answer
  carries the cost of one mutation, and I have no per-call measurement of the 8. The forge's own
  counters do bound them.
  - **The window:** every spike mutation from 00:42:06Z to 00:48:11Z fell under one
    `x-ratelimit-reset`, `1795138635`. Over the 393 spike calls after the first in that window,
    the header `x-ratelimit-used` rose from 183 to 612, an increase of 429.
  - **Arithmetic:** those 393 calls are 341 query points (measured rateLimit.cost) plus 52
    mutations. So the 52 mutations, together with anything else the account spent in that window,
    cost at most 429 − 341 = **88 points**.
  - **Upper bound for card 1:** the other 44 mutations cost at least 1 point each, the documented
    minimum. That leaves card 1's 8 production mutations costing **at most 88 − 44 = 44 points**.
    If every mutation cost the same, each cost at most 88 / 52 = 1.69, and the 8 cost at most
    about 14.
  - **Lower bound:** the 8 cost at least 8 points. That is not measured; it rests on the GraphQL
    docs' statement that a call costs at least 1 point.
- **Lifecycle total:** **at least 15 and at most 51 primary points**, made of 7 measured and the
  8 mutations' 8 to 44. If every mutation costs 1, as GitHub's documented minimum suggests and the
  setup window's header steps fit, the total is **15**. That 15 is an estimate, not a measurement.
  - **The setup-window pattern:** at reset `1795106695`, 30 of the 35 steps of `used` into a
    mutation were exactly 1, 2 were 2 and 3 were 3, summing to 43. That fits a cost of 1 plus
    other spending on the same login.
  - **Header caveat:** the counter is shared with every other user of the login. During the runs
    `used` sometimes went backwards between consecutive answers, so the bound above is only as
    good as the first and last readings.
- **Secondary-limit points:** 7 × 1 + 8 × 5 = **47**. These use the documented per-request
  costs (1 for a query, 5 for a mutation), not a measurement.
- **What would measure it exactly:** a run of mutations on a scratch board, on a login nothing
  else uses, reading `rateLimit { used }` before and after. That needs a new scratch board. The
  spike's board is deleted, so this revision did not make one.

**Header noise.** During the runs, GraphQL answers came back under two reset values: 394 spike
calls under `1795138635` and 104 reads under `1795138638`. `used` went backwards between
consecutive calls. The header counters are therefore not a clean per-call meter on a shared
login. Only bounds like the one above can be read from them.

### One reconcile pass over 30 or more cards

Thirty-one card workflows were open: cards 2–32, with card 1 Done. From 00:47:20 to 00:47:50Z,
one reconcile interval, the call log holds:
- **31 `mirror-read` calls**: one `ReadItem` per card, 31 distinct cards, summed cost 31;
- **0 writes**;
- 31 read-backs, which are instrumentation.

**Per-card route:** one pass over a board of 31 cards with no drift costs **31 GraphQL reads and
0 writes, 31 points**.

**Batched route (measured cost, not run as the reconcile):** **1 GraphQL read, cost 1**, for all
32 items.

## Affordability

**Limits, and where I read them.** I read both docs pages on 2026-11-20, and saw the live
5,000-point limit in the `x-ratelimit-limit` header of every GraphQL answer in the call log.

| Limit | Source |
|---|---|
| GraphQL primary: "5,000 points per hour per user". A query costs at least 1 point. | docs.github.com, "Rate limits and query limits for the GraphQL API" |
| GraphQL secondary: "no more than 2,000 points per minute". A request with no mutation costs 1; one with a mutation costs 5. "No more than 100 concurrent requests". Content creation: "80 … per minute", "500 … per hour". | the same page |
| REST primary: "5,000 requests per hour". Secondary: 900 points per minute, and the same content-creation limits. | docs.github.com, "Rate limits for the REST API" |

**Load.** I use the load the card's "Load" section sets: `concurrency: 3` from
`rigger.config.mjs` at `6be13718` (line 18), and the thirty-card window of
`docs/v0-build-plan.md` §4, M8, test 4. Two premises, both **judgments**:
- Every card in the window is open at once, so 30 card workflows each reconcile. That is the
  worst case for polling.
- At concurrency 3, at most about 9 cards finish an hour, which assumes each card holds a slot
  for at least 20 minutes.

**Per hour.**
- **Measured per-call costs:** a query costs 1 point. For mutations the table gives two columns of
  figures: the documented 1-point minimum, and the 1.69-point mean the forge's counters bound.
- **Per-lifecycle counts:** taken from card 1's transitions, 6 transition reads and 7 transition
  writes.
- **Judgments:** the cards-per-hour and drift-per-hour rates.

| Item | Per-card route (what I ran) | Batched route |
|---|---|---|
| Reconcile reads (R = 30 s → 120 passes an hour) | 30 cards × 120 = **3,600** | 1 × 120 = **120** |
| Transitions (≈9 cards an hour × (6 reads + 7 writes)) | 9 × (6 + 7) = 117, or 9 × (6 + 7 × 1.69) ≈ 160 | the same |
| Drift reverts (1 write each; judgment: a few an hour) | ≈5 to ≈9 | the same |
| **GraphQL primary points an hour** | **≈3,722 to ≈3,769**, 74–75% of 5,000 | **≈242 to ≈289**, 4.8–5.8% of 5,000 |
| Writes an hour, against the content-creation limit of 500 an hour, if field updates count | 63 transitions + ≈5 drift + up to 30 new cards entering the board ≈ **98** | the same |
| REST calls an hour | 0 of 5,000 | 0 of 5,000 |

**Per minute and at once.** Hourly averages do not bound bursts, so these rows use a burst model.
The model is a **judgment**; the peaks the spike itself produced are **measured** from
`docs/spikes/projects-v2-mirror/calllog.json`, over every logged call including instrumentation.

- **Transition burst:** card 1 made its last four transition writes within 47.3 s: Status to
  Review, the escalation clear, Owner and Done, from 00:42:48.425Z to 00:43:35.736Z. At
  concurrency 3, three cards can finish together, so three such spans can align: **12 writes and
  12 reads in one minute**.
- **Board fill:** the window's 30 cards can be started together. Each writes Ready once. The
  spike did exactly this with 27 cards at 00:45:53Z.
- **Reconcile:** the per-card route reads 30 cards every 30 s, which is 60 reads a minute. If
  their timers align, up to 30 of those reads can be in flight at once. The batched route makes 2
  reads a minute.

| Limit (source in the table above) | Modelled peak, per-card route | Modelled peak, batched route | Measured peak in this spike |
|---|---|---|---|
| GraphQL secondary, 2,000 points a minute (query 1, mutation 5) | reads 60 + 12 + 30 = 102, writes 12 + 30 = 42 × 5 = 210: **312** | 2 + 12 + 30 = 44, plus 210: **254** | **266** in the busiest 60 s window (from 00:45:37.6Z) |
| Content creation, 80 a minute, if Projects field updates count | **42** | **42** | **39** writes in the busiest 60 s window (setup on the laptop, from 16:00:32Z: issue creation and `AddItem`), and **30** in the busiest on hostpc (the 27-card start) |
| Concurrent requests, 100 | up to 30 aligned reconcile reads + 3 writes = **33** | **≈4** | **25** requests in flight at once (00:45:53.9Z, the 27-card start) |
| REST secondary, 900 points a minute | **0** | **0** | 0 during the runs |

Every modelled peak is inside every limit the report lists. The tightest is content creation, at
42 of 80 a minute, if GitHub counts Projects field updates as content creation. The docs do not
say whether it does.

## Recommendation

**A one-way board mirror is affordable at this load, provided its reconcile reads the board in
one batched query per pass.** It then costs about 5–6% of the user's GraphQL hour. It stays within
every per-minute and concurrency limit, with content creation the closest, at about half its
limit in the modelled burst.

**Do not use the per-card polling I ran on a token shared with anything else.** At 30 open cards
it takes about three quarters of the hour's 5,000 points. Rigger's own board reads, the gh CLI,
the judges and other sessions spend that same budget, and this run itself shared the login with
two sibling spikes.

The convergence results hold for either reconcile:
- the drift reverted;
- the workflow's state was untouched by board edits;
- answers arrived by signal;
- an I4 kill healed on retry.

For the card that builds this:
- **Do** make the reconcile one paginated board read per pass, compare it to the workflows'
  state, and send the write only for items that drifted.
- **Do** keep `mirrorCard` read-compare-write over full state. Its second run wrote nothing, and
  its retry after a kill repaired a partial write.
- **Do** give the activity a heartbeat timeout. Without one, a killed worker's activity waits out
  its whole `startToCloseTimeout` before it is retried.
- **Do not assume** that a successful mirror run leaves the board equal to the workflow. I2a and
  I3 both ended `match: false`, and only the next reconcile closed the gap. Anything that reads
  the board as the truth will see up to one bound of drift.
- **Do not assume** a webhook can replace the poll for a user-owned board.
- **Do not assume** a mutation's point cost can be read per call. The forge does not return it.

**What would reverse this recommendation.**
- **Batched read cost:** `ScanBoard`'s rateLimit.cost grows well past 1 at the window's size.
  I measured cost 1 at 32 items, and the cost formula depends on the connections requested.
- **Faster convergence:** a convergence requirement much tighter than 60 s. At R = 5 s the
  batched route is about 720 points an hour, which is still affordable; the per-card route is
  about 21,600, which is impossible.
- **Shared budget:** the account's other consumers already spend most of the hour.
- **Mutation cost:** evidence that mutations cost more than 1 primary point.
- **Content-creation limits:** that Projects field updates count toward them at a lower limit
  than the documented 500 an hour.
- **Webhooks:** an organization-owned board, where the `projects_v2_item` webhook would remove
  the poll altogether.

## What it would change (proposals; nothing is changed here)

These are proposals for the PM and the architect. This report changes none of them.

- **`R-STATE-1`**, "The board is the truth for a card's workflow state". Under a mirror the
  workflow is the truth, and the board is a mirror that converges within a stated bound.
- **`R-STATE-4`**, which persists only what cannot be rebuilt from the board. Card state would
  then live in Temporal's store, not be rebuilt from the board.
- **`ARCHITECTURE.md`, "The layers"**, the forge-adapter rule that L0 "carries L2's column
  changes back to the board, and no other layer changes a card's column". The column would
  become a projection written by a mirror activity, plus a reconcile that reads the board.
- **`ARCHITECTURE.md`, "Triggers"**, "The board poll". The idle poll that finds Ready cards would
  become the mirror's reconcile read, or would sit beside it.
- **`ARCHITECTURE.md`, "Escalation"**. An owner's answer would arrive as a workflow signal rather
  than through the board and issue.

## Teardown and custody

**Scratch repository: deleted by rigger-ae at the owner's request, not left for the owner.**
- **Repository:** <https://github.com/williacj/rigger-1431-mirror-scratch>.
- **Who deleted it:** rigger-ae, with `gh repo delete`, at the owner's request in the owner's
  interactive session on 2026-11-20. It is recorded at
  [1431#7027544903](https://github.com/williacj/rigger/issues/1431#issuecomment-7027544903).
  rigger-ae's read-back answers "Could not resolve to a Repository".
- **Deviation from the card:** the card's item asks the report to name the repository as left for
  the owner to delete by hand. The owner's request overtook that item, and the card is unedited.
- **What the spike did:** it made no delete call on the repository; its call log holds none.

**The scratch board was deleted** at 00:48:11Z, by `deleteProjectV2`, which answered
`{"projectV2":{"id":"PVT_kwHOBzomGc4BsXT-","number":14}}`. Reading it back answered:

```
ReadDeletedNode 200 {"data":{"node":null,"rateLimit":{"cost":1}},"errors":[{"type":"NOT_FOUND","path":["node"],"locations":[{"line":1,"column":34}],"message":"Could not resolve to a node with the global id of 'PVT_kwHOBzomGc4BsXT-'."}]}
ReadDeletedNumber 200 {"data":{"user":{"projectV2":null},"rateLimit":{"cost":1}},"errors":[{"type":"NOT_FOUND","path":["user","projectV2"],"locations":[{"line":1,"column":63}],"message":"Could not resolve to a ProjectV2 with the number 14."}]}
```

**Forge writes outside the scratch repository and board: none from the spike's scripts.**
- The call log's 121 logged writes are:
  - `POST /user/repos`, which created the scratch repository;
  - `POST /repos/williacj/rigger-1431-mirror-scratch/issues` ×32;
  - GraphQL mutations on project `PVT_kwHOBzomGc4BsXT-` only: `CreateProject`,
    `SetStatusOptions`, `CreateEscalationField`, `AddItem` ×33 (one of them the network-error
    attempt), `SetStatus` ×47, `SetEscalation` ×2, `ClearEscalation` ×2 and `DeleteProject`.
- The call log's reconstructed entries add five hand-made writes, all on this card or its
  branch:
  - the two stated-intent comments on #1431;
  - the two pushes of `rigger-1431`, one creating the branch and one carrying revision 1;
  - pull request #1435.
- The revision-2 push is not in the log, because a file cannot record the push that carries it.
  The transcript's revision-2 section names it.
- Nothing in the log or the transcript writes to the live board (project 6), an M8 card or #1293.

**Unplanned events, disclosed.**
- **Setup network error:** at 15:55:14Z, during setup, one `AddItem` failed below HTTP
  (`EHOSTUNREACH`). Issue 6 had already been created. I made setup.js look each issue up
  before creating it, and reran it. That added 26 harmless `GET …/issues/<n>` 404s to the
  setup's part of the call log, and created no duplicate: 32 issues and 32 items. The logger did
  not record failed fetches then, so I backfilled that entry and flagged it in its `note`.
- **Laptop install scripts:** npm 11.20 blocked install scripts during the laptop's install. It
  changed nothing outside the spike directory.

**Files written outside the spike's own directories.**

| Host | File | Why | Removed? |
|---|---|---|---|
| hostpc | `%LOCALAPPDATA%\npm-cache\_logs\2026-11-20T00_41_17_728Z`, `…00_41_22_854Z`, `…00_46_33_981Z`, `…00_46_34_326Z`, `…00_46_40_225Z`, `…00_50_27_247Z`, `…00_50_53_143Z` `-debug-0.log` | npm writes a debug log for every run. Each named `cwd C:\Users\USER\1431-spike-engineer` with my command's `argv` | **yes**, deleted at about 00:51Z |
| hostpc | `%LOCALAPPDATA%\npm-cache\_cacache\` entries | npm's shared package cache, filled by `npm install` | **no**: the cache is shared with other users of npm on the host, and its entries cannot be told apart by who added them |
| laptop | `~/.npm/_cacache/` entries and one `~/.npm/_logs/` debug log from the 15:53Z `npm install` | the same npm behaviour | **no**: the cache is shared. The debug log was already rotated out by later npm runs (none dated `T15_5…` remain) |
| hostpc | `C:\Users\USER\1431-spike-engineer\` | the spike's own scratch directory on that host | **yes**, `rmdir /S /Q`, which printed `removed` |

SSH used `-o UserKnownHostsFile=<spike dir>/known_hosts`, so `~/.ssh/known_hosts` on the laptop
was not touched; its mtime is still Nov 5. The Temporal CLI wrote no config: there is no
`%APPDATA%\temporalio` and no `%USERPROFILE%\.config`.

**Host-configuration changes: none on any host.** I made no package install outside the spike
directories, no firewall rule, no PATH, registry, service or scheduled-task change, and no WSL or
systemd setting. With none made, there is nothing to revert.

**Processes I started**, from [`docs/spikes/projects-v2-mirror/host-logs.txt`](projects-v2-mirror/host-logs.txt) and the
transcript:

| Host | pid | What | Ended |
|---|---|---|---|
| hostpc | 30376 | `temporal.exe server start-dev …` | `taskkill /F`, 00:47:54Z |
| hostpc | 34000 | worker 1 (`node worker.js`) | `taskkill /F`, 00:45:24Z (the I4 kill) |
| hostpc | 30548 | worker 2 | `taskkill /F`, 00:47:54Z |
| laptop | 98483 | `ssh hostpc` holding the server | exited 00:47:54Z |
| laptop | 99034 | `ssh hostpc` holding worker 1 | exited 00:45:25Z |
| laptop | 24660 | `ssh hostpc` holding worker 2 | exited 00:47:54Z |
| hostpc | 3180 | `node start.js 30000 Coding 1 4` (started cards 1 and 4) | foreground; exited by 00:42:22Z, when the next command ran |
| hostpc | 11740 | `node start.js 30000 - 2 3 5` (started cards 2, 3 and 5) | foreground; exited by 00:42:22Z |

**How the two foreground pids are known.** I did not record them at the time. The Temporal
client's default identity is pid@hostname. The histories' `WORKFLOW_EXECUTION_STARTED` events
carry `3180@Host-PC10` (cards 1 and 4) and `11740@Host-PC10` (cards 2, 3 and 5). The worker
identities `34000@Host-PC10` and `30548@Host-PC10` in the same histories match the recorded worker
pids.

**Processes with no recorded pid.** The owner accepted this gap for all three Temporal spikes, on
condition that the report lists exactly which processes have no pid and why. The ruling is at
[1431#7050910524](https://github.com/williacj/rigger/issues/1431#issuecomment-7050910524).

**Which processes.** Every process started by a tool call in
`docs/spikes/projects-v2-mirror/session-log.txt`, and every descendant of such a process, except
the eight in the table above. The log holds every tool call I made, with its exact input, so it
fixes the set. By host and kind, these are:
- **hostpc, from the commands inside each `ssh … hostpc` and w.sh string:**
  - the `node start.js 30000 - 6 … 32` that started cards 6–32;
  - each `node` run of sigwatch.js, editwatch.js, gated.js, watch.js, scan.js and `node -e`;
  - each temporal.exe CLI run, whether typed directly or launched by sigwatch.js and gated.js
    through `execFileSync`;
  - each `npm` run (`install`, `ls`, `config get`) and the processes npm spawned;
  - each curl.exe, tar.exe, `taskkill`, `tasklist`, `netstat`, `findstr`, `powershell`, `wmic`,
    `ping`, `rmdir`, `del` and `mkdir`;
  - the cmd.exe shell and the OpenSSH session process behind every SSH connection, including the
    three held sessions whose laptop clients are in the table.
- **laptop, from every Bash tool call:**
  - the shell the session ran each call in, and everything that shell ran: `ssh`, `scp`, `gh`,
    `git`, `node`, `python3`, `npm`, `grep`, `sed`, `awk`, `date` and the like;
  - the background tasks and their waiting loops: `run_in_background` calls and the one Monitor
    loop;
  - `caffeinate`;
  - suite-slot.sh and its children;
  - the git hooks;
  - every node process of every `npm test` run, including the run stopped at 00:59Z.

**Why they have none.** Each ran in the foreground of its tool call, or as a descendant of one,
and exited when that call ended. Nothing recorded its pid when it started: not the spike's
scripts, and not the session record. The two exceptions are the Temporal clients 3180 and 11740,
recovered above from the histories. The start.js for cards 6–32 could have been recovered the
same way, but its history was never exported, and the server's database was deleted with the
scratch directory.

**None survived.** No process can outlive its tool call unless it is detached, and only the eight
held or background processes in the table were detached. The listings below, and one more taken
on the laptop at 21:25:07Z, show that none of mine remains:
- **hostpc:** no temporal.exe, and no node.exe but 31732 and 19544. Those two belong to other
  sessions, and I did not touch them.
- **laptop:** no recorded holder alive. At 21:25:07Z, `ps -axo pid,ppid,command | grep -E
  '1431-spike-engineer|1431-maker|hostpc'` printed no line.

**Process listings after the last run** (transcript, about 00:51Z).

hostpc:
```
"node.exe","31732","Console","1","150,268 K"
"node.exe","19544","Services","0","198,464 K"
none-of-34000-30548-30376
```

The laptop, running `ps -p 98483,99034,24660 -o pid=`:
```
ps exit=1 (1 = none of 98483,99034,24660 alive)
```

**Transcript and session log.** The owner accepted transcript gaps if they are listed, in the same
ruling, [1431#7050910524](https://github.com/williacj/rigger/issues/1431#issuecomment-7050910524).
This revision withdraws the earlier claim that the transcript gives every command verbatim.
What the record holds:
- **[`docs/spikes/projects-v2-mirror/session-log.txt`](projects-v2-mirror/session-log.txt)** is
  extracted from the spike engineer's own session record. It gives every tool call I made, from
  2026-11-19T15:50:48Z to its extraction, in order. For each call it gives the exact input: the
  command string, a Write's body, or an Edit's old and new text. It also gives the call's issue
  and answer times.
- **[`docs/spikes/projects-v2-mirror/transcript.txt`](projects-v2-mirror/transcript.txt)** gives
  each wrapped command with its UTC time, host and output. It then copies session-log entries
  [1]–[160] and [161]–[218], and the revision-2 entries, verbatim, in place of the reconstructions
  and prose summaries the earlier revisions had. Its "Backfilled result notes" summarize results
  only; the commands behind them are in the copied entries.
- **[`docs/spikes/projects-v2-mirror/failed-runs.txt`](projects-v2-mirror/failed-runs.txt)** holds
  the complete failing output of every failed suite run.

**Gaps that remain.**
- **Times of chained commands:** a command chained with `;` or `&&` inside one tool call has only
  its call's issue and answer times. No time of its own was recorded.
- **Background-task times:** for a background tool call, the answer time is its launch. Its end
  appears only where its own output printed a time.
- **Command output:** the session log holds inputs, not outputs. Outputs are in the transcript's
  wrapped entries, in failed-runs.txt, or nowhere. The outputs of most unwrapped laptop commands
  were shown to the session but are not committed. Two examples are the local `grep`/`cut`
  filters and the read-only `python3` analyses, whose results the report quotes.
- **Final steps of this revision:** the record cannot hold the steps that follow its own
  extraction. These are this revision's last credential scan, its path check with the spikes
  directory hidden, its commit and its push. The transcript's revision-2 section names each one
  with its exact command text, and the pull request shows their results.

**Credential scan** over every file committed under `docs/spikes/projects-v2-mirror/`:

```
grep -rnE 'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer [A-Za-z0-9._-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}' docs/spikes/projects-v2-mirror/ ; echo "exit=$?"
```

Result: no line printed and `exit=1`, which is grep's "no match". The scan first ran at about
01:00Z over the six evidence paths of that time. It ran again in revision 1 over the eight files
then committed, and in revision 2 over the nine files now committed there, with the same command
and the same result each time. It found no credential or token.

## Evidence

All of these are under [`docs/spikes/projects-v2-mirror/`](projects-v2-mirror/).
- `docs/spikes/projects-v2-mirror/transcript.txt` is the transcript of wrapped commands and their
  output, with the session-log entries copied in.
- `docs/spikes/projects-v2-mirror/session-log.txt` is every tool call, with its exact input and
  its times.
- `docs/spikes/projects-v2-mirror/calllog.json` holds every forge call:
  - the scripts' calls, logged at call time with request start, duration, method, endpoint or
    operation, status, rate-limit headers and cost;
  - the hand-made `gh`, `git` and curl.exe calls, and the GitHub documentation fetches, each
    marked `reconstructed` and rebuilt from the transcript or the session log.
- `docs/spikes/projects-v2-mirror/failed-runs.txt` is the failing output of every failed suite run.
- `docs/spikes/projects-v2-mirror/mirror-runs.json` holds every `mirrorCard` event.
- `docs/spikes/projects-v2-mirror/histories/card-1.json` … `docs/spikes/projects-v2-mirror/histories/card-5.json` are the event histories from
  `temporal workflow show --output json`.
- `docs/spikes/projects-v2-mirror/host-logs.txt` holds the server, worker and pid logs.
