ABOUTME: Spike findings for card #1429: what a killed worker, a lost host and a mid-flight workflow
code change do to a card dispatched as a Temporal activity, measured on macOS, WSL2 Linux and Windows.

# A card's dispatch as a Temporal activity, under failure

## The answer

A heartbeating Temporal activity notices a dead worker and starts the dispatch again. It took
4.85 s to 6.18 s on the three operating systems. When the pinned host stays dead, the
schedule-to-start timeout moves the dispatch to another host of the same operating system,
36.7 s after the kill.

What Temporal cannot do is end the agent the dead worker left behind. On macOS and Linux the
dispatch's process tree outlived `kill -9` of its worker and ran to its own end, 293 s to 311 s
later. During that time Temporal started a second tree for the same card: on the same host after
a restart, and on the other host after a re-route. The event history does not show that the
first attempt ever started. Only its last heartbeat's details, which the spike filled with the
tree's root pid, record it. On Windows the tree died with the worker, which is
consistent with Node putting spawned children in a job object. That cause was not verified, and
containment is #1430's question.

An unguarded change to the workflow's code left the in-flight card `Running`, retrying a failing
workflow task (`[TMPRL1100] Nondeterminism error`) and making no progress. The same change behind
`patched()` let the in-flight card finish on its old path, while a card started afterwards took
the new path.

I recommend that a heartbeating activity **can** carry a card's dispatch across hosts, but only
once Rigger adds the orphan handling in "What Rigger would have to add". Without it, every lost
worker on macOS or Linux runs two agents for one card at once. "What would reverse this" is at
the end.

This report hands over evidence. It changes no code, requirement, recorded decision or
`ARCHITECTURE.md` section. The throwaway harness lived in the gitignored
spikes/1429-spike-engineer/ directory of the maker's worktree and in scratch directories on the PC, and
none of it is in this pull request.

## What ran

| Thing | What it was |
|---|---|
| Server | `temporal server start-dev --ip 0.0.0.0 --port 7233 --ui-port 8233 --db-filename ~/1429-spike-engineer/temporal.db --log-level warn`, in WSL2 on the PC |
| Card workflow | Workflow type `card`. The workflow id is the card id. It runs `pickHost` on the OS queue `rigger-<os>`, then `dispatch` on that host's queue `host-<host>` |
| Re-route | If `dispatch` fails with a `SCHEDULE_TO_START` timeout, the workflow excludes that host and picks again, for up to 3 rounds |
| Dispatch activity | Spawns `node tree.js 1 <seconds>` (`stdio: 'ignore'`, no `detached`), which spawns `tree.js 2`, a grandchild. Each level logs its start and end to the card's tree.log in the host's worktree directory and lives `<seconds>` (300 for the kill runs). The activity heartbeats `{attempt, root}` every 2 s until the root exits. Attempts after the first live `retrySeconds` (10 or 20) so that the workflow ends |
| Workers | One process per host identity. It polls the identity's OS queue (workflows, `pickHost`, `prepare`) and its own host queue (`dispatch`, `claudeRun`). The identity is `<host>/<hostname>/<pid>` |
| Code versions | `wf-v1` is as above. `wf-v2` adds an unguarded `prepare` activity call ahead of the dispatch. `wf-v3` puts that call behind `patched('prepare-before-dispatch')` |

### The dispatch activity's configuration

These values are the same on every operating system:

| Option | Value |
|---|---|
| `heartbeatTimeout` | 10 s |
| `scheduleToStartTimeout` (the host-pinned dispatch) | 30 s |
| `startToCloseTimeout` | 20 min |
| `retry.initialInterval` | 1 s |
| `retry.backoffCoefficient` | 2 |
| `retry.maximumInterval` | 10 s |
| `retry.maximumAttempts` | 5 |
| Heartbeat call | every 2 s, from the activity |

`pickHost` used `startToCloseTimeout` 30 s and a retry of 1 s, coefficient 1, at most 30 attempts.

### Waiting bounds, derived from that configuration

- **The next attempt after a kill.** The server schedules it at most `heartbeatTimeout` (10 s)
  after the last heartbeat it recorded, plus the retry interval (1 s for attempt 2). The last
  recorded heartbeat is no later than the kill, so attempt 2 is scheduled within 11 s of the kill.
  It starts once a worker polls the host's queue. If none polls within `scheduleToStartTimeout`,
  the attempt times out. **Bound: 41 s after the kill.** Each kill run was watched for at least
  90 s.
- **A re-route after a host is lost.** The 41 s above, plus one `pickHost` round. **Bound: 120 s**,
  against a watch of up to 150 one-second polls.

### How the figures were measured

Every time and duration in this report is one of three kinds, and each says which:

- **Measured, from a host clock at an action.** Kill, stop and restart times are the timestamp the driver printed on the host itself immediately before the `kill`, `Stop-Process` or launch call ran, so the action completed at or just after it. Worker start and polling times are the worker's own log lines.
- **Measured, from the server.** Attempt starts, timeouts and re-picks are the `eventTime` of the event in the exported history. That is the time the server recorded the event: for `ActivityTaskStarted`, when it handed the task to a polling worker in its poll response, not when a request began.
- **Measured, from the process itself.** Tree start and end times are lines each tree process wrote to its own log as it started and as its timer fired, just before it exited.

A listing's time is the `date` printed immediately before `ps` or `Get-CimInstance` ran. So a process present in a listing was alive at or after that time, and a process absent was gone by the time the listing finished, which the transcript's `--- exit … at` line bounds to the second. Where a bound comes from that completion line, the report says so.

A figure that is **derived** by arithmetic from measured ones, or that is a **judgment**, is labelled where it appears.

## Hosts and versions

Each value below is quoted from the command that printed it. The output is in
[`docs/spikes/temporal-dispatch-under-failure/versions.txt`](temporal-dispatch-under-failure/versions.txt), and the commands are in the
transcript.

| Host | OS and version | Node | Temporal CLI | `@temporalio/*` |
|---|---|---|---|---|
| Laptop (macOS) | `ProductVersion: 27.2.1`, `BuildVersion: 26B131`, `arm64` | `v26.13.0` | `temporal version 1.10.1 (Server 1.32.2, UI 2.56.4)` | activity, client, common, core-bridge, nexus, proto, worker and workflow, all `@1.26.0` |
| WSL2 on the PC (Linux) | `PRETTY_NAME="Ubuntu 26.04.1 LTS"`, kernel `6.18.58.1-microsoft-standard-WSL2` | `v24.22.3` | `temporal version 1.10.1 (Server 1.32.2, UI 2.56.4)` | the same eight, all `@1.26.0` |
| Windows on the PC | `Microsoft Windows [Version 10.0.26300.9974]` | `v24.19.0` | `temporal version 1.10.1 (Server 1.32.2, UI 2.56.4)` | the same eight, all `@1.26.0` |

**The server ran in WSL2 on the PC** (`Host-PC10`), as pid 745 there.

### How each host reached the server

- **The WSL2 worker** reached it on `127.0.0.1:7233`, on its own host.
- **The Windows worker** reached it on `127.0.0.1:7233` through WSL2's localhost forwarding. No
  firewall rule or port proxy was added.
- **The laptop** reached it through an SSH local forward through Windows OpenSSH on the PC. The
  forward went to the PC's `127.0.0.1:7233`, and from there through WSL2's localhost forwarding.
  The first forward (`-L 7233:127.0.0.1:7233`, laptop pid 24640, which also held the server's WSL
  session) stopped carrying traffic between 00:50:33Z and 00:51:00Z. TCP still connected locally,
  but gRPC never became ready. A fresh forward, `-L 17233:127.0.0.1:7233` (laptop pid 83430),
  worked, and every laptop worker and CLI call from 00:52:57Z on used it. The cause was not
  chased. It is a property of the spike's tunnel, not of Temporal or Rigger.

The laptop and the PC sit on one LAN, so the server could have been exposed directly. The spike
did not do so, because that needs a Windows firewall rule or port proxy, which is a
host-configuration change.

### The listening address is a wildcard

Quoted from `ss -ltnp` in WSL2:

```text
LISTEN 0      4096                *:7233             *:*    users:(("temporal",pid=745,fd=11))
LISTEN 0      4096                *:8233             *:*    users:(("temporal",pid=745,fd=14))
```

### Clocks

Kill times on WSL2 and Windows come from the PC's clocks. WSL2's clock is the server's. The
Windows and WSL2 clocks agreed within about 50 ms. The laptop's clock and WSL2's agreed within
the 0.3 s SSH round trip. These figures are measurements, taken at 00:47Z and logged in the
transcript.

## Native Windows

**A TypeScript SDK worker started on native Windows and completed activities.** From
[`docs/spikes/temporal-dispatch-under-failure/logs/windows/worker-win-1.txt`](temporal-dispatch-under-failure/logs/windows/worker-win-1.txt):

```text
2026-11-20T00:46:27.127Z worker starting identity=win-1/Host-PC10/19380 pid=19380 os=windows wf=wf-v1.js node=v24.19.0
2026-11-20T00:46:28.587Z worker polling rigger-windows and host-win-1
2026-11-20T00:46:52.916Z [win-1] dispatch start card=smoke-windows attempt=1 seconds=5 treeRoot=20488 workerPid=19380
2026-11-20T00:46:57.964Z [win-1] dispatch end card=smoke-windows attempt=1 treeRoot=20488 exit=0
```

The workflow's result was `{"attempt":1,"exit":0,"host":"win-1","root":20488}`
([`docs/spikes/temporal-dispatch-under-failure/histories/smoke-windows.json`](temporal-dispatch-under-failure/histories/smoke-windows.json)).
The worker printed one Node deprecation warning (`DEP0176 fs.F_OK`), the same one it printed on
Linux.

## The worker killed outright, mid-dispatch

Each operating system ran one card, `card-kill-<os>`. In each run the dispatch's 300 s tree was
running, a listing was taken, and the worker was killed. Then a listing was taken, the worker was
restarted on the same host with the same identity, and listings were taken again at stated times.
The driver was killtest.sh, and every step is logged in the transcript with its UTC time.

| | Linux (`wsl-1`) | Windows (`win-1`) | macOS (`mac-b`) |
|---|---|---|---|
| Kill | `kill -9 1010` at 00:47:42.916Z | `Stop-Process -Id 19380 -Force` at 00:48:06.775Z | `kill -9 34568` at 00:48:38.169Z |
| Worker restarted on the killed host | Yes: pid 1499, `worker starting` 00:47:43.905Z, polling 00:47:45.098Z | Yes: pid 19544, `worker starting` 00:48:07.931Z, polling 00:48:09.188Z | Yes: pid 56714, `worker starting` 00:48:38.583Z, polling 00:48:39.417Z |
| Tree before the kill | 1426 (root, ppid 1010) and 1433 (ppid 1426), listing 00:47:42Z | 33496 (root, ppid 19380) and 19992 (ppid 33496), listing 00:48:06.085Z | 55566 (root, ppid 34568) and 55579 (ppid 55566), listing 00:48:38Z |
| Tree just after the kill | **Both alive.** 1426 reparented to 1005 (WSL's init), listing 00:47:43Z | **Neither alive**, listing 00:48:07.196Z | **Both alive.** 55566 reparented to 1, listing 00:48:38Z |
| Tree at later listings | Both alive at 00:47:53, 00:49:43, 00:51:10 and 00:52:30. Gone at 00:52:45 | None at any later listing | Both alive at 00:48:48, 00:49:44, 00:51:10, 00:52:31, 00:52:45, 00:53:25 and 00:53:45. Gone at the next listing, 00:54:24, and tree.log puts the end at 00:53:49 |
| How long each orphan lived after the kill (measured: the kill timestamp to the tree log's end line) | 1426: until 00:52:36.171Z, 293.3 s. 1433: until 00:52:36.219Z, 293.3 s. Each ended at its own 300 s timer, and nothing killed it | Both were gone when the first listing after the kill ran. That listing began at 00:48:07.196Z and finished before 00:48:08Z, so each died within 1.23 s of the kill (an upper bound from the listing's completion, measured). Neither wrote an end line to its tree log | 55566: until 00:53:49.249Z, 311.1 s. 55579: until 00:53:49.337Z, 311.2 s. Each ended at its own 300 s timer, which ran 18 s late on the laptop (derived from its start and end lines) |
| Second tree for the card while the first was alive (measured: tree log start and end lines) | **Yes.** Attempt 2's root 1576 started at 00:47:49.128Z, and the first tree lived until 00:52:36Z | **No.** The first tree was gone by 00:48:07.196Z, and attempt 2's root 21388 started at 00:48:11.699Z | **Yes.** Attempt 2's root 57776 started at 00:48:44.087Z, and the first tree lived until 00:53:49Z |
| Attempt 2 started (history, `ActivityTaskStarted`, attempt 2) | 00:47:49.096Z | 00:48:11.621Z | 00:48:43.702Z |
| **Kill to the next attempt starting** (measured: the kill timestamp to the server's `ActivityTaskStarted` eventTime) | **6.18 s** | **4.85 s** | **5.53 s** (±0.3 s for the clocks) |
| Event history, start to end | [`docs/spikes/temporal-dispatch-under-failure/histories/card-kill-linux.json`](temporal-dispatch-under-failure/histories/card-kill-linux.json) | [`docs/spikes/temporal-dispatch-under-failure/histories/card-kill-windows.json`](temporal-dispatch-under-failure/histories/card-kill-windows.json) | [`docs/spikes/temporal-dispatch-under-failure/histories/card-kill-macos.json`](temporal-dispatch-under-failure/histories/card-kill-macos.json) |

Sources:

- **Tree start and end times:** `logs/<host>/tree-<identity>-card-kill-<os>.txt`.
- **Listings:** the transcript.
- **Restart times:** the worker logs.
- **The time attempt 2 was scheduled:** `logs/laptop/poll-card-kill-<os>.txt`.

In every run the restarted worker was polling before attempt 2 was scheduled. So the next attempt
was gated by the heartbeat timeout, not by the restart.

### What the history shows, and what it does not

Each of the three histories holds 17 events, and one `ActivityTaskStarted` for the dispatch,
event 12. That event is the final attempt: `attempt: 2`, with
`lastFailure: "activity Heartbeat timeout"`. **The history has no event for attempt 1 starting.**
A reader of the history alone learns that an attempt failed by heartbeat timeout, but not where
it ran or that its tree may still be alive. The second attempt's identity, worker pid and start
time are in the history. The first attempt's are only in the worker's own log.

When a later attempt does not start, the details of the last heartbeat do reach the history. In
`docs/spikes/temporal-dispatch-under-failure/histories/pin-kill-macos-2.json`, event 12 (`ActivityTaskTimedOut`, `SCHEDULE_TO_START`, cause
`HEARTBEAT`) carries `lastHeartbeatDetails` `{"attempt":1,"root":84441}`, which is the orphan
root's pid.

### Why the next attempt came before the 10 s heartbeat timeout

The three runs scheduled attempt 2 at 3.8 s to 5.2 s after the kill, less the 1 s retry interval.
The heartbeat timeout counts from the last heartbeat the server recorded, not from the kill. The
spike called `heartbeat()` every 2 s, but the SDK throttles what it sends. The observed timing is
consistent with the last recorded heartbeat being about 5 s to 6 s before each kill. That is a
judgment: heartbeats are not in the history, so it was not measured.

## Pinning: the host-pinned dispatch when its host goes away

**The pinning runs covered macOS.** The two macOS host identities, `mac-a` and `mac-b`, were two
worker processes on the laptop, [laptop host].local. The Mac mini was not used. Each identity
had its own worktree directory, spikes/1429-spike-engineer/worktrees/<identity>/ (gitignored). The Linux
worker `wsl-1` and the Windows worker `win-1` ran on the PC, `Host-PC10`, polling their own OS and
host queues throughout. Their only gaps were the worker restarts the transcript logs.

### The pinned worker stopped before the dispatch started

Card `pin-stop-macos-2`, with history
[`docs/spikes/temporal-dispatch-under-failure/histories/pin-stop-macos-2.json`](temporal-dispatch-under-failure/histories/pin-stop-macos-2.json). The
workflow paused 20 s after each pick so that the stop could land between the pick and the
dispatch.

| UTC | Event |
|---|---|
| 00:53:14.037 | `pickHost` completed on `mac-a` (event 7) |
| 00:53:15.452 | `kill -TERM 85018` (the `mac-a` worker). Its log shows both queues `STOPPED` at 00:53:15.454 |
| 00:53:34.170 | `dispatch` scheduled on `host-mac-a` (event 16) |
| 00:54:04.173 | `ActivityTaskTimedOut`, `TIMEOUT_TYPE_SCHEDULE_TO_START` (event 17), 30.003 s after scheduling |
| 00:54:04.237 | `pickHost` scheduled again (event 21), completed on `mac-b` (event 23) |
| 00:54:24.348 | `dispatch` scheduled on `host-mac-b` (event 32), after the spike's 20 s pause |
| 00:54:24.360 | `ActivityTaskStarted` by mac-b/[laptop host].local/85022, attempt 1 (event 33) |

**The dispatch started on the other macOS host.** It came **68.91 s after the stop** (measured: the stop timestamp to event 33's eventTime), and 40.0 s
of that was the spike's two pauses, which apply after every pick. The time from the dispatch being
scheduled on the stopped host to its start elsewhere was 50.19 s (measured, from the two events' eventTimes): the 30 s schedule-to-start
timeout, plus the re-pick, plus the second pause. Without the second pause it would have been
about 30.1 s. That figure is derived from the event times, not measured.

The first attempt at this run, `pin-stop-macos`, hit a bug in the spike's workflow code:
`TimeoutType` was imported from the SDK's workflow package, which does not export it. Its re-route
failed with `Cannot read properties of undefined (reading 'SCHEDULE_TO_START')`, the spike
terminated the workflow, and the history is kept as
[`docs/spikes/temporal-dispatch-under-failure/histories/pin-stop-macos.json`](temporal-dispatch-under-failure/histories/pin-stop-macos.json). It still
shows the same schedule-to-start timeout, 30 s after scheduling.

### The pinned worker killed outright mid-dispatch, and not restarted

Card `pin-kill-macos-2`, with history
[`docs/spikes/temporal-dispatch-under-failure/histories/pin-kill-macos-2.json`](temporal-dispatch-under-failure/histories/pin-kill-macos-2.json).

| UTC | Event |
|---|---|
| 01:06:48.648 | `dispatch` scheduled on `host-mac-a` (event 11). The tree's root, 84441, started at 01:06:49.061 |
| 01:06:55.210 | `kill -9 68452` (the `mac-a` worker), never restarted |
| 01:07:31.740 | `ActivityTaskTimedOut`, `TIMEOUT_TYPE_SCHEDULE_TO_START`, cause `TIMEOUT_TYPE_HEARTBEAT`, `lastHeartbeatDetails` `{"attempt":1,"root":84441}` (event 12), 36.53 s after the kill |
| 01:07:31.844 | `pickHost` scheduled (event 16), completed on `mac-b` (event 18) |
| 01:07:31.930 | `ActivityTaskStarted` for `dispatch` on `host-mac-b`, by mac-b/[laptop host].local/44645 (event 23) |

**The dispatch started on the other macOS host, 36.72 s after the kill** (measured: the kill timestamp to event 23's eventTime). The bound was 120 s.
Attempt 2 on the dead host's queue timed out on schedule-to-start, so the timeout applies to
retry attempts and not only to the first.

The orphaned tree on `mac-a`, 84441 and its grandchild 84443, lived until 01:11:49.065Z and
01:11:49.148Z, which is 293.9 s after the kill and its own 300 s end. `mac-b`'s tree, 5133 and
5134, started at 01:07:32Z. For 257 s (derived: from the tree logs' start and end lines), **two agent trees for one card ran at once in two hosts'
worktrees.** The listing at 01:07:32Z shows both
([`docs/spikes/temporal-dispatch-under-failure/logs/laptop/pintest-kill-2.out`](temporal-dispatch-under-failure/logs/laptop/pintest-kill-2.out)),
and the tree logs give the times.

### An unplanned run: both macOS workers gone

Card `pin-kill-macos-1`, with history
[`docs/spikes/temporal-dispatch-under-failure/histories/pin-kill-macos-1.json`](temporal-dispatch-under-failure/histories/pin-kill-macos-1.json).

1. The spike stopped a background task. That stop also shut down the `mac-a` worker (pid 6723) at
   00:57:56.655Z, because the worker had been started inside that task's process group. This is
   disclosed under "Disclosures".
2. `mac-b` was then killed mid-dispatch at 00:58:08.600Z, which left no macOS worker at all.
3. The retry's schedule-to-start timeout fired at 00:58:46.079Z, 37.48 s after the kill.
4. The next workflow task timed out 10 s later, `WORKFLOW_TASK_TIMED_OUT` at 00:58:56.081Z. It had
   been offered to the dead worker's sticky queue.
5. The workflow then waited, with no bound of its own, until a `rigger-macos` worker came back.
6. `mac-a` was restarted at 01:01:38.5Z, and the dispatch started there at 01:01:40.378Z (event 25).

This run is not the clean pinning cell, which `pin-kill-macos-2` covers. It shows what happens
when no worker of the routed operating system is left: the card waits, and it never routes to
another operating system.

### No dispatch crossed operating systems

Across every pinning run, no dispatch started on a host of another operating system. Each
`ActivityTaskStarted` and `WorkflowTaskStarted` identity in the four pinning histories is
`mac-a/[laptop host].local/<pid>` or `mac-b/[laptop host].local/<pid>`. Every scheduled task
queue is `rigger-macos`, `host-mac-a` or `host-mac-b`:

```text
pin-kill-macos-1.json: mac-a/[laptop host].local/68452 mac-b/[laptop host].local/85022 | queues: host-mac-a host-mac-b rigger-macos
pin-kill-macos-2.json: mac-a/[laptop host].local/68452 mac-b/[laptop host].local/44645 | queues: host-mac-a host-mac-b rigger-macos
pin-stop-macos-2.json: mac-a/[laptop host].local/85018 mac-b/[laptop host].local/85022 | queues: host-mac-a host-mac-b rigger-macos
pin-stop-macos.json: mac-a/[laptop host].local/34563 mac-b/[laptop host].local/56714 | queues: host-mac-a rigger-macos
```

### What one machine leaves unproved about two

Both macOS identities shared the laptop, so these runs leave the following unproved:

- **A lost machine is not a killed process.** On a real lost host the network goes too. The
  orphaned tree may still be running there, and nothing elsewhere can see it or end it. Here the
  orphan was a local process that the spike could list.
- **The second host's state.** The second host had the same disk, clock, Node and checkout as the
  first. A real second machine needs the card's repository and its own worktree. Its clock can
  differ, and it can be on another network path to the server.
- **Partition.** A host cut off from the server, but alive, keeps running its tree and may keep
  heartbeating into a dead connection. The spike never partitioned a host.
- **Contention.** The orphan and the re-routed tree competed for one machine's CPU and disk. On
  two machines they would not, so the overlap would cost nothing visible and be harder to notice.

## A code change while the card is in flight

All of these runs were on Linux (`wsl-1`), with `kill -9` of the worker mid-dispatch. Then the
worker was restarted on the changed code. The dispatch activity's code did not change.

### The unguarded change (`wf-v2`)

Card `ver-unpatched`. The worker was killed at 01:02:23.534Z and restarted on wf-v2.js as pid
104548. The dispatch's attempt 2 completed at 01:02:43.203Z, which opened a workflow task that
the new code had to replay. **The worker reported** (`docs/spikes/temporal-dispatch-under-failure/logs/wsl/worker-wsl-1.txt`):

```text
2026-11-20T01:02:43.258063Z  WARN temporalio_sdk_core::worker::workflow: Failing workflow task run_id=01a1f679-cd64-7117-ae22-c6d23163722c failure=Failure { failure: Some(Failure { message: "[TMPRL1100] Nondeterminism error: Activity type of scheduled event 'dispatch' does not match activity type of activity command 'prepare'", ... }), force_cause: NonDeterministicError }
```

**The workflow was left `Running`, making no progress.** Its history
([`docs/spikes/temporal-dispatch-under-failure/histories/ver-unpatched-stuck.json`](temporal-dispatch-under-failure/histories/ver-unpatched-stuck.json))
ends at event 16, `WORKFLOW_TASK_FAILED` with cause
`WORKFLOW_TASK_FAILED_CAUSE_NON_DETERMINISTIC_ERROR`. Three describes, quoted in the transcript,
show `WORKFLOW_EXECUTION_STATUS_RUNNING` with the history length fixed at 16 and the workflow task
retrying:

| UTC | Workflow task attempt |
|---|---|
| 01:03:01 | 3 |
| 01:03:34 | 5 |
| 01:03:58 | 6 |

It neither failed nor timed out. The card would sit there until someone changed the code.

Restarting the worker on the guarded wf-v3.js at 01:04:04Z repaired it. The next replay
succeeded, and the workflow completed at 01:04:05.645Z without running `prepare`
([`docs/spikes/temporal-dispatch-under-failure/histories/ver-unpatched.json`](temporal-dispatch-under-failure/histories/ver-unpatched.json), events
17–20).

### The same change behind `patched()` (`wf-v3`)

- **The workflow in flight completed.** Card `ver-patched` started on `wf-v1`. Its worker was
  killed at 01:04:34.302Z and restarted on wf-v3.js as pid 104971. Attempt 2 completed, the
  replay passed, and the workflow completed at 01:04:53.047Z (event 17). The history has no
  marker and no `prepare` activity, so the card kept its old path
  ([`docs/spikes/temporal-dispatch-under-failure/histories/ver-patched.json`](temporal-dispatch-under-failure/histories/ver-patched.json)).
- **A workflow started after the change took the changed path.** Card `ver-patched-new` started on
  `wf-v3`. Its history records `MARKER_RECORDED` `core_patch` (event 11),
  `UPSERT_WORKFLOW_SEARCH_ATTRIBUTES` (event 12), then `prepare` scheduled, started and completed
  (events 13–15), before `dispatch` (event 19)
  ([`docs/spikes/temporal-dispatch-under-failure/histories/ver-patched-new.json`](temporal-dispatch-under-failure/histories/ver-patched-new.json)).

### Other versioning routes

The TypeScript SDK's versioning page (docs.temporal.io/develop/typescript/versioning, read
2026-11-20) documents three routes, under the headings "Versioning with Patching", "Worker
Versioning" and "Workflow cutovers". The installed 1.26.0 package declares the matching APIs:
`patched` and `deprecatePatch` in the workflow package's lib/workflow.d.ts, and
`workerDeploymentOptions` with `VersioningBehavior` `PINNED` and `AUTO_UPGRADE` in
the worker and common packages. The older Build-ID options (`buildId`,
`useVersioning`) are marked `@deprecated` in favour of Worker Deployments in
the worker package's worker-options.d.ts.

| Route | Ran? | Why |
|---|---|---|
| `patched()` | Yes | The card names it |
| `deprecatePatch()` | No | It is the later step of the same route. It applies only once no run from before the patch is still open, so it answers nothing about an in-flight card |
| Worker Versioning (Worker Deployments) | No | It needs Deployment Versions set up on the server and per-version workers. With `PINNED`, an in-flight card stays on the old worker version, which is the closest match to Rigger's needs. I did not run it within this spike's budget. It is the route the next card should measure |
| Deprecated Build-ID versioning | No | The SDK marks it deprecated |
| Workflow cutover (a new workflow type) | No | The page says it does not version running workflows. The in-flight card keeps the old type, so it gives the same answer as leaving the old code deployed |

## The real `claude -p` run

The run was made in a dispatch activity on the laptop: card `claude-macos`, worker `mac-a`, pid
68452. It had `CLAUDE_CONFIG_DIR` set to spikes/1429-spike-engineer/claude-home (gitignored), a directory
the spike made empty at 01:02Z. The environment was reduced to `PATH`, `HOME` and
`CLAUDE_CONFIG_DIR`. The command was `claude -p "Reply with the single word ok."`, run with
Claude Code 2.1.328. The result, from
[`docs/spikes/temporal-dispatch-under-failure/histories/claude-macos.json`](temporal-dispatch-under-failure/histories/claude-macos.json) and
`docs/spikes/temporal-dispatch-under-failure/logs/laptop/worker-mac-a.txt`:

```text
exit: 1
stdout: Not logged in · Please run /login
stderr: Permission allow rule (../../../../../rigger/.claude/settings.local.json): Write(//Users/cjwilliams/GitHub/rigger-worktrees/tq-tools/codex-session.sh) is not matched by file permission checks — only Edit(path) rules are. ...
```

**The run did not authenticate.** A fresh `CLAUDE_CONFIG_DIR` holds no credential. A probe before
the run, `claude auth status` under another test-made directory, printed `"loggedIn": false`,
`"authMethod": "none"`. The brief said to stop rather than point the run at `~/.claude`, so the
spike stopped there. The repository's live tests authenticate a test-made home with
`CLAUDE_CODE_OAUTH_TOKEN` set by the owner (`test/provider-claude-live.test.mjs`), and the spike
had no such token.

### The re-run under the owner's `~/.claude`, which also did not authenticate

The owner granted one re-run against their own `~/.claude`
([1429#7027885620](https://github.com/williacj/rigger/issues/1429#issuecomment-7027885620),
relayed by rigger-ae). The grant's conditions were one trivial prompt, `--no-session-persistence`,
a `~/.claude` listing before and after, and no credential material in the evidence.

**Setup.** The spike rebuilt the earlier setup:

- The Temporal dev server ran in WSL2 on the PC, as pid 406, on a fresh database.
- The laptop reached it through an SSH tunnel to port 17233, laptop pid 68938.
- One laptop worker ran, `mac-a`, pid 71061.

The activity was changed in two ways. It sets `CLAUDE_CONFIG_DIR` only when it is given one, and
here it was given none. It also passes extra arguments ahead of the prompt.

**Guarding against a second run.** The activity was given `retry.maximumAttempts` 1, and it
spawned `claude` asynchronously, heartbeating every 2 s, so that neither a retry nor a heartbeat
timeout could start the command a second time. The history,
[`docs/spikes/temporal-dispatch-under-failure/histories/claude-macos-owner.json`](temporal-dispatch-under-failure/histories/claude-macos-owner.json),
has two `ActivityTaskStarted` events: `pickHost` and `claudeRun`, each at attempt 1.

**The run.** It was made at 01:54:21.334Z, as card `claude-macos-owner`, `claude` pid 77583. The
environment was `PATH` and `HOME` only. From `docs/spikes/temporal-dispatch-under-failure/logs/laptop/worker-mac-a.txt`:

```text
2026-11-20T01:54:21.334Z [mac-a] claudeRun card=claude-macos-owner attempt=1 CLAUDE_CONFIG_DIR=(unset: owner ~/.claude) args=["-p","--no-session-persistence","Reply with the single word ok."]
2026-11-20T01:54:22.124Z [mac-a] claudeRun result {"host":"mac-a","pid":77583,"exit":1,"signal":null,"stdout":"Not logged in · Please run /login\n","stderr":"Permission allow rule (../../../../../rigger/.claude/settings.local.json): ..."}
```

**It exited 1 with `Not logged in · Please run /login`, so it did not authenticate either.** The
grant allowed exactly one run, so the spike did not run `claude` again to find out why.

The cause is not established. A likely one is that the activity's environment held only `PATH`
and `HOME`. On macOS, Claude Code keeps its login in the user's Keychain, and the lookup may
depend on variables such as `USER` that the activity dropped. That is a judgment, not a
measurement.

This run left the acceptance item unmet. The third run, below, settled it.

**The owner's `~/.claude` before and after.** The listings were taken at 01:54:10Z and 01:54:31Z,
and both are in
[`docs/spikes/temporal-dispatch-under-failure/logs/laptop/claude-home-owner-before.txt`](temporal-dispatch-under-failure/logs/laptop/claude-home-owner-before.txt)
and [`docs/spikes/temporal-dispatch-under-failure/logs/laptop/claude-home-owner-after.txt`](temporal-dispatch-under-failure/logs/laptop/claude-home-owner-after.txt).
Each lists the top-level entries with their modification times, and counts `~/.claude/projects/`.

- **`~/.claude/projects/` count:** 16 before and 16 after. No folder for the activity's working directory
  appeared, either before or after.
- **Changed entries:** `diff` of the two listings shows three top-level entries whose
  modification times moved:

  | Entry | Before | After |
  |---|---|---|
  | `plugins` | 19:41:04 | 19:54:21 |
  | `session-env` | 19:52:11 | 19:54:21 |
  | `sessions` | 19:53:13 | 19:54:22 |

  All times are local, −0600.

A read-only `find` of entries newer than 19:54:15 local, in
[`docs/spikes/temporal-dispatch-under-failure/logs/laptop/claude-home-owner-changed.txt`](temporal-dispatch-under-failure/logs/laptop/claude-home-owner-changed.txt),
names these:

- `~/.claude/[entry withheld]`, written at 19:54:21;
- a new directory `~/.claude/[entry withheld]`, written at 19:54:21;
- the `sessions` directory itself, whose time moved at 19:54:22.

Those times fall inside the run, which ran from 01:54:21.334Z to 01:54:22.124Z (19:54:21–19:54:22
local). That makes the run the likely writer. Other Claude sessions on the laptop write to the
same directories, so this is a judgment, not proof. The spike changed nothing in `~/.claude`, as
the grant required.

### The third run, with the worker's full login environment, which authenticated

The owner granted one further run in which `claude` inherits the worker's full login environment
under the owner's `~/.claude`
([1429#7028383522](https://github.com/williacj/rigger/issues/1429#issuecomment-7028383522),
relayed by rigger-ae). The grant kept the other conditions: one trivial prompt,
`--no-session-persistence`, `maximumAttempts` 1, read-only `~/.claude` listings before and after,
and no secrets in the evidence. It also said that a failure would end the runs there.

**The worker's environment.** The spike started the worker under a fresh login shell:
`env -i HOME USER LOGNAME SHELL=/bin/zsh TMPDIR`, then `/bin/zsh -l -c "… exec node worker.js"`.
The worker, `mac-a`, ran as pid 23128. Starting it this way meant its environment was the
owner's login environment, not the spike engineer's agent session, whose environment carries
Claude Code session variables that are not part of a login. The activity passed that environment
to `claude` unchanged.

**Setup.** As before:

- the Temporal dev server in WSL2, pid 407, on a fresh database;
- the laptop tunnel on port 17233, laptop pid 23077.

**The run.** It was made at 02:25:36.729Z, as card `claude-macos-login`, `claude` pid 23310. The
history,
[`docs/spikes/temporal-dispatch-under-failure/histories/claude-macos-login.json`](temporal-dispatch-under-failure/histories/claude-macos-login.json),
has two `ActivityTaskStarted` events, `pickHost` and `claudeRun`, each at attempt 1. From
`docs/spikes/temporal-dispatch-under-failure/logs/laptop/worker-mac-a.txt` (the activity logs the
environment's key names only, never values):

```text
2026-11-20T02:25:36.729Z [mac-a] claudeRun env keys (names only): HOME,HOST_ID,LANG,LOGNAME,OLDPWD,OS_NAME,PATH,PWD,SHELL,SHLVL,TEMPORAL_ADDRESS,TMPDIR,USER,WF_FILE,WORKTREES,_,__CF_USER_TEXT_ENCODING
2026-11-20T02:25:36.729Z [mac-a] claudeRun card=claude-macos-login attempt=1 CLAUDE_CONFIG_DIR=(unset: owner ~/.claude) args=["-p","--no-session-persistence","Reply with the single word ok."]
```

The workflow's result:

```text
{"exit":0,"host":"mac-a","pid":23310,"signal":null,"stdout":"ok\n","stderr":"Permission allow rule (../../../../../rigger/.claude/settings.local.json): ... (the same two permission-rule notices as the earlier runs)"}
```

**The run authenticated. It exited 0 and printed `ok`, on the laptop, in a dispatch activity.**

### How the third run authenticated

The run authenticated with the login the owner's Claude Code had already stored for their macOS
user. It did not authenticate with an environment credential. The evidence:

- **No credential in the environment.** The environment held no credential variable: neither
  `ANTHROPIC_API_KEY` nor `CLAUDE_CODE_OAUTH_TOKEN`. Its full key list is quoted above.
- **No credential file.** No `CLAUDE_CONFIG_DIR` was set, so Claude Code read the owner's
  `~/.claude`. It holds no `~/.claude/.credentials.json`: the before listing names no
  credential file.
- **So the stored login is in the Keychain.** With no variable and no file, the login Claude Code
  used is the one it keeps in the owner's macOS Keychain.

That last step is an inference from the two facts above. The spike did not read the Keychain, and
it printed no credential.

**Why the second run failed.** Against the second run, the third run added `USER`, `LOGNAME`,
`LANG`, `SHELL`, `TMPDIR` and `__CF_USER_TEXT_ENCODING`, together with a login shell's `PATH`.
That fits the judgment that the Keychain lookup needed variables the second run dropped.

The runs differ on one more axis. The login shell's `PATH` resolved `claude` to
`/opt/homebrew/bin/claude`. The worker in the first two runs inherited the spike engineer's
`PATH`, which resolves `claude` to `~/.local/bin/claude`, Claude Code 2.1.328. So which change
made the difference, the variables or the binary, is not isolated. No fourth run was made to
separate them.

**The owner's `~/.claude` before and after.** The listings were taken at 02:25:36Z and 02:25:42Z,
and both are in
[`docs/spikes/temporal-dispatch-under-failure/logs/laptop/claude-home-owner-before-3.txt`](temporal-dispatch-under-failure/logs/laptop/claude-home-owner-before-3.txt)
and [`docs/spikes/temporal-dispatch-under-failure/logs/laptop/claude-home-owner-after-3.txt`](temporal-dispatch-under-failure/logs/laptop/claude-home-owner-after-3.txt).

- **`~/.claude/projects/` count:** 16 before and 16 after. No folder for the activity's working
  directory appeared.
- **Changed entries:** three top-level modification times moved:

  | Entry | Before | After |
  |---|---|---|
  | `plugins` | 19:54:21 | 20:25:37 |
  | `session-env` | 19:54:21 | 20:25:37 |
  | `sessions` | 19:57:42 | 20:25:42 |

  All times are local, −0600.

A read-only `find`, in
[`docs/spikes/temporal-dispatch-under-failure/logs/laptop/claude-home-owner-changed-3.txt`](temporal-dispatch-under-failure/logs/laptop/claude-home-owner-changed-3.txt),
names these:

- a new entry `~/.claude/[entry withheld]`;
- a new directory `~/.claude/[entry withheld]`;
- the `sessions` directory itself.

All three were written inside the run's 6.4 s, which makes the run the likely writer. That is a
judgment, as before. The spike changed nothing in `~/.claude`.

### The environment each run had

| Run | Grant | `CLAUDE_CONFIG_DIR` | Environment passed to `claude` | `claude` resolved from | Result |
|---|---|---|---|---|---|
| 1, `claude-macos`, 01:03:08Z | None needed: a test-made home, as the card requires | spikes/1429-spike-engineer/claude-home (gitignored), empty | `PATH`, `HOME` and `CLAUDE_CONFIG_DIR` | The spike engineer's `PATH`: `~/.local/bin/claude`, 2.1.328 | Exit 1, `Not logged in` |
| 2, `claude-macos-owner`, 01:54:21Z | [1429#7027885620](https://github.com/williacj/rigger/issues/1429#issuecomment-7027885620) | Unset, so the owner's `~/.claude` | `PATH` and `HOME` only | The same | Exit 1, `Not logged in` |
| 3, `claude-macos-login`, 02:25:36Z | [1429#7028383522](https://github.com/williacj/rigger/issues/1429#issuecomment-7028383522) | Unset, so the owner's `~/.claude` | The worker's full login environment, with the keys listed above | The login shell's `PATH`: `/opt/homebrew/bin/claude` | **Exit 0, `ok`** |

**For Rigger:** an agent dispatched by a worker authenticates only when the worker's environment
carries what the owner's stored login needs. A worker started as a bare service, with `PATH` and
`HOME`, ran an agent that could not log in. Rigger's adapter adds and removes keys on top of the
inherited environment, so the worker's own environment decides whether a dispatch can
authenticate.

The stderr shows that a bare `claude -p`, started inside a git worktree, read the main checkout's
.claude/settings.local.json. Rigger's provider launches Claude with `--setting-sources project`
(`src/substrate/providers/claude.mjs`), which is meant to leave local settings out. So this is not
a Rigger defect, and the spike filed no card for it.

### The owner's `~/.claude/projects`

The listing was taken on the laptop at 01:02:37Z, before the run at 01:03:08Z, and again at 01:08:08Z, after it, with
`stat -f "%Sm %N"` over every entry. Both listings are in
[`docs/spikes/temporal-dispatch-under-failure/logs/laptop/claude-projects-before.txt`](temporal-dispatch-under-failure/logs/laptop/claude-projects-before.txt)
and [`docs/spikes/temporal-dispatch-under-failure/logs/laptop/claude-projects-after.txt`](temporal-dispatch-under-failure/logs/laptop/claude-projects-after.txt).
The before listing:

```text
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
[entry withheld]
```

**The after listing equals the before listing.** `diff` of the two files, before the evidence
headers were added, printed nothing, and the transcript records `IDENTICAL`. The run's session
folder appeared in the test-made home instead, at
claude-home/projects/-Users-cjwilliams-GitHub-rigger-worktrees-1429-spike-engineer-spikes-1429-spike-engineer-app.

## Recommendation

**A heartbeating Temporal activity can carry a card's dispatch across hosts.** The evidence:

- Each operating system detected a dead worker and started the next attempt within 4.85 s to
  6.18 s.
- The host-pinned dispatch moved to another host of the same operating system 36.7 s after its
  host was lost. When the host was stopped before the dispatch began, the schedule-to-start
  timeout fired 30 s after the dispatch was scheduled, and the dispatch started on the other host
  20.19 s after that timeout (measured from events 17 and 33 of pin-stop-macos-2; 20 s of it was
  the spike's own pause after each pick).
- No dispatch ever crossed operating systems.
- The native Windows worker worked.

**It must not be adopted as it stands.** Temporal's retry assumes a failed attempt has stopped.
On macOS and Linux it had not: in three of three runs the orphaned agent ran to its natural end
while a second agent worked the same card. Temporal records nothing that would let anyone find
that orphan, apart from heartbeat details the activity chooses to write.

**Version every workflow change**, with `patched()` or Worker Deployments. An unguarded change
strands every in-flight card in `Running`, with no failure for the board to mirror.

## What Rigger would have to add

These follow from the evidence above. Each is a separate card, and none is filed here, because
each is a design proposal for the PM and the architect.

1. **Fence each attempt on its host.** Before a dispatch attempt starts its tree, it must
   establish that no earlier attempt's tree for the same card is alive on that host, and end any
   it finds. Today's route of a group kill plus a working-directory census (`R-STATE-17`) fits.
   The dispatch would record its group and worktree in the heartbeat details, where the history
   keeps them (`lastHeartbeatDetails`, seen in `pin-kill-macos-2`).
2. **Reap on worker start.** A worker starting on a host must reap trees left by attempts that
   are no longer current. The Linux, macOS and pinning runs each restarted a worker beside a live
   orphan.
3. **Fence across hosts.** When a dispatch re-routes, the old host's orphan cannot be reached from
   the new host. Rigger needs a fence that does not depend on reaching it: a per-attempt lease
   that the card's outputs must carry, so that the forge or merge side refuses a stale attempt's
   push or pull request. It also needs the reap in item 2 when the lost host returns.
4. **Contain the tree** (#1430), so that a dead worker takes its tree with it. Windows behaved
   that way here. Whether macOS and Linux can is #1430's finding.
5. **Run replay tests over workflow changes**, using the SDK's replayer against recorded
   histories, so that an unguarded change fails in CI rather than stranding live cards.

## What would reverse this

- **Toward "no":**
  - If #1430 finds that the tree cannot be contained on macOS or Linux without privileges Rigger
    may not take, and a cross-host fence (item 3) cannot be made sound, then duplicate agents per
    lost worker are unavoidable.
  - If long agent runs show heartbeat timeouts while the worker is in fact alive, for example
    under CPU starvation or laptop sleep, each one would start a spurious second agent.
  - If a real two-machine run shows the schedule-to-start re-route not happening, or a
    partitioned host's tree escaping every fence.
- **Toward "yes, more simply":** if containment plus a forge-level lease makes a second attempt
  harmless on all three operating systems, items 1 to 3 shrink to the lease alone.

## What the recommendation would change

These are proposals for the PM and the architect. This report changes none of them.

| Document | What would change |
|---|---|
| `D1` (redo over resume) and `D10` (v0 builds no resume) | A Temporal workflow resumes a card from its history, so redo would become one policy among others |
| `R-STATE-2` (an interrupted card is done again from the beginning) | A card interrupted mid-flight would continue from its workflow history, with only the interrupted activity attempt redone. The requirement would change from "done again from the beginning" to "resumed from its last recorded step", keeping "a restart loses no card and completes no partial one" |
| `D11` (one engine per repository) | Workers on several hosts share one server, and one card's attempts can span hosts |
| `D13` (macOS is v0's only host) | Windows and Linux workers ran the dispatch here |
| `R-STATE-1` and `R-STATE-4` (the board is the truth, and Rigger persists only what it cannot rebuild) | Temporal's history would hold a card's workflow state, with the board as a mirror |
| `R-STATE-17` (group kill plus a working-directory census) | It would need to run per attempt and on worker start, keyed by the attempt recorded in heartbeat details (items 1 and 2) |
| `ARCHITECTURE.md`, "Failure model" | Recovery would be Temporal retry plus fencing, not redo |
| `ARCHITECTURE.md`, "Triggers" | Schedules and signals would take the place of the clock trigger and its supervision |
| `ARCHITECTURE.md`, "The layers" | The scheduling loop would move into workflows, with activities wrapping today's forge, git, worktree and dispatch code |

## Evidence

All of it is under [`docs/spikes/temporal-dispatch-under-failure/`](temporal-dispatch-under-failure/):

- **`docs/spikes/temporal-dispatch-under-failure/transcript.txt`:** the transcript. Every command run through the logging wrapper appears with its UTC time, host and output. An appendix gives the commands run outside the wrapper, and lists the gaps below.
- **`histories/*.json`:** each card workflow's event history, start to end, exported with
  `temporal workflow show -w <id> --output json`. `docs/spikes/temporal-dispatch-under-failure/histories/ver-unpatched-stuck.json` is the stuck state,
  before the repair.
- **`docs/spikes/temporal-dispatch-under-failure/logs/laptop/`, `docs/spikes/temporal-dispatch-under-failure/logs/wsl/` and `docs/spikes/temporal-dispatch-under-failure/logs/windows/`:** worker logs, tree logs, pending-activity
  polls, session output, the server session, and the `~/.claude/projects` listings.
- **`docs/spikes/temporal-dispatch-under-failure/versions.txt`:** the version output from each host.
- **`docs/spikes/temporal-dispatch-under-failure/suite-runs/`:** for each of the five failed `npm test` runs in the spike's worktree (the fifth is the pre-commit hook run that refused the first round-1 commit), the run's complete failing-tests section and summary, copied unchanged, with the full log's line count, size and sha256. The full logs, 6.6 MB to 9.4 MB each, stay in the spike engineer's scratch directory and are not committed. Runs 1 to 4 are described in the transcript appendix: run 1 failed for want of `npm ci` in the new worktree, run 2 on this report's backticked paths, and runs 3 and 4 on timeouts at one-minute load averages of about 110 and 69.

Each text file in the evidence directory opened with a one-line `ABOUTME:` header, added at
commit time because the repository requires it. The content below each header is unchanged. The
JSON files carry no header.

Each log was captured as `<name>.log` and committed as `<name>.txt`, because `.gitignore` excludes
`*.log`. The transcript's commands use the capture names.

The transcript's appendix quotes the commands run outside the logging wrapper, recovered from the session's conversation, with two named substitutions. It is not complete or verbatim throughout, and claims nothing through these gaps, which its own head lists as G1 to G7 (owner ruling [1429#7050911360](https://github.com/williacj/rigger/issues/1429#issuecomment-7050911360)):

- **G1:** the short processes the hooks, the suite and the slot started are recorded only as summaries and failures.
- **G2:** non-shell tool calls (Write, Edit, Read, Monitor, TaskStop, WebFetch) are listed by kind, time and target, without their full arguments.
- **G3:** the intermediate uncommitted states of the report and journal are not kept.
- **G4:** a command that would have extracted the list from the session's on-disk record was refused by Claude Code's permission classifier, so the list comes from the conversation and its ~ times are reconstructions.
- **G5:** ten entries summarise a group of commands that edited the report, journal, PR draft or transcript, or re-ran read-only checks, instead of quoting each command.
- **G6:** where an entry elides text inside a command, it names where that text is.
- **G7:** one word in a quoted `grep` is written with brackets, because the repository's ruled-out-word check refuses it in any tracked file.

Its last section, "HEREDOC AND PATCH BODIES", quotes every heredoc and in-place edit that wrote the spike's throwaway files, at its command and time, with the sha256 of each body and each file's final sha256. They are quoted under rigger-ae's ruling of 2026-11-20 that bodies quoted in a transcript are evidence, not merged spike code: nothing runs or imports them, and the runnable files stay in the gitignored spikes directory. The original bodies of the seven files edited during the runs were checked by replaying the quoted edits on them, which reproduced each file's final sha256.

### Credential scan

The command, run over every committed file under `docs/spikes/temporal-dispatch-under-failure/`
after the last file was written:

```text
grep -rnE -i 'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-ant-|xox[baprs]-|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|bearer [A-Za-z0-9._-]{10,}|oauth|api[_-]?key|token|secret|password|passwd|credential|@[a-z0-9.-]+\.(com|net|org|io)' docs/spikes/temporal-dispatch-under-failure
```

The result was thirteen lines, all in `docs/spikes/temporal-dispatch-under-failure/transcript.txt`, and none of them is a credential:

- **Line 72** is the spike's own `env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY …` command,
  which names variables and holds no values.
- **Line 330** is a laptop process listing that caught a sibling spike's command line,
  `TOKEN=1 …/1431-spike-engineer/…/hold.sh`. `TOKEN=1` there is that script's flag, not a
  credential.
- **Lines 1892, 1894 and 1895** are appendix entries for the spike's own `grep` and `env -u` commands, which name those variables and hold no values.
- **Line 2061** is the appendix entry quoting this scan's own pattern.
- **Lines 2073, 2089, 2125, 2134, 2138, 2163 and 2170** are appendix entries that contain the word "credential" or "credentials": a re-run of this scan, a `grep -c "credentials"` over the `~/.claude` listing, and the sha256 replay that names the scan.

The email pattern matched nothing.

## Disclosures

### The stated intent

The stated intent was posted at
[1429#7026651102](https://github.com/williacj/rigger/issues/1429#issuecomment-7026651102) at
00:42:38Z, before the first install at 00:42:50Z.

### Host-configuration changes

**None.** No firewall rule, port proxy, WSL or systemd setting, registry key or system-wide
package was added, so nothing needed reverting. Node and the Temporal CLI were unpacked into the
spike's own directories.

### Files written outside the spike's own directories

| Host | File | Reason | Removed? |
|---|---|---|---|
| WSL2 | `/home/user/.npm/_logs/2026-11-20T01_03_52_536Z-debug-0.log` | The version capture ran `npm ls` without `npm_config_cache` pointed at the spike's directory | Yes, at 01:14Z |
| WSL2 | `/home/user/.npm/_update-notifier-last-checked`. Existing file, created 2026-10-21, modification time set to 01:03:52 local by the same `npm ls` | As above | No. The file predates the spike. Only its modification time changed, and the earlier value is unknown |
| Windows | `C:\Users\USER\AppData\Local\npm-cache\_logs\2026-11-20T01_03_53_372Z-debug-0.log` | The version capture's `npm ls` | Yes, at 01:14Z |
| Laptop | Possibly one `~/.npm/_logs/*-debug-0.log` from the `npm ls` at 00:44:10Z. That command ran without the cache variable, which applied to `npm install` only | — | Not found at 01:13Z. npm keeps the last ten logs, and other sessions' npm runs at 01:08Z had rotated the directory, so whether one was written is unknown |
| Laptop | spikes/1429-spike-engineer/claude-home/ (gitignored) and claude-home-probe/ | These are inside the spike's own directory, and are listed here only because Claude wrote them | Left in the gitignored spikes directory |
| Laptop | In the owner's `~/.claude`: `~/.claude/[entry withheld]` rewritten, a new `~/.claude/[entry withheld]` directory, and the `sessions` directory's modification time. The re-run is the likely writer: the times fall inside it, but other sessions also write there | Claude Code wrote them during the granted re-run (1429#7027885620) | No. The grant required that nothing in `~/.claude` be changed |
| Laptop | In the owner's `~/.claude`: a new `~/.claude/[entry withheld]`, a new `~/.claude/[entry withheld]` directory, and the `sessions` directory's modification time. The third run is the likely writer | Claude Code wrote them during the third run (1429#7028383522) | No, as the grant required |

The bare `claude -p` run read the main checkout's .claude/settings.local.json. That was a read,
not a write.

The remote scratch directories, `~/1429-spike-engineer` in WSL2 and
`C:\Users\user\1429-spike-engineer` on Windows, were the spike's own. They were removed at 01:14:16Z and 01:14:17Z,
after their logs were copied here. For the re-run, `~/1429-spike-engineer` in WSL2 was made again to hold only the Temporal CLI and the server's database, and removed at 01:55Z. It was made and removed the same way for the third run, removed at 02:26:02Z.

### Unplanned events

- **A worker the spike stopped by accident.** `TaskStop` of a background task at 00:57:56Z also
  shut down the `mac-a` worker, pid 6723, which had been started in that task's process group.
  `pin-kill-macos-1` therefore ran with no second macOS worker, and `pin-kill-macos-2` repeats it
  cleanly.
- **A bug in the spike's workflow code.** It broke the first pinning run, `pin-stop-macos`, which
  was terminated. It was fixed, and the run was repeated as `pin-stop-macos-2`.
- **The first laptop tunnel stalled.** It was replaced on port 17233.
- **WSL2 was stopped and restarted once.** At 00:51Z WSL2 reported `up 6 min`, so it had stopped
  while idle between the installs and the server start, and started again at about 00:45Z. The
  spike's directory survived on disk. From then on the server's SSH session kept WSL2 up.
- **A sibling's worker ended on its own.** A sibling spike's Windows worker (pid 30548, #1431's)
  was present at 00:46:43Z and gone by 00:48:06Z, before the spike's first Windows kill at
  00:48:06.775Z. The spike did not touch it.

### Processes the spike started

Every process the spike started, with its host and pid. Every stand-in tree process ended by
itself unless the table says otherwise.

**A gap.** The spike recorded the pid of every long-lived process: the server, each worker, each SSH session and tunnel, and every stand-in tree. It did not record the pids of short foreground commands. An audit of every listing in the transcript and every pid in the logs found the recorded ones below, from 4501 to the session processes, and they are in the table. For the rest no pid exists in any record, so they cannot be recovered: the rows marked "not recorded" name each by kind. A pid-like number in the evidence that is not in this table belongs to another session: 30548 is #1431's Windows worker, and the others are processes other spikes or the host ran. Every pid-bearing identity in the exported histories is a worker in this table, and the only other identity, `temporal-cli:laptop-user@[laptop host].local`, carries no pid.

| Host | Pids | What they were | How each ended |
|---|---|---|---|
| Laptop | 24640 | SSH session holding the WSL2 server, with the first tunnel | Exited when the server stopped, 01:13Z |
| Laptop | 83430 | SSH tunnel, port 17233 | `kill -TERM`, 01:13:19Z |
| Laptop | 34550, 51971, 85007, 35824, 92769, 14457, 24451 | SSH sessions launching WSL2 workers | `kill -TERM`, 01:13:19Z |
| Laptop | 34554, 54309, 85011 | SSH sessions launching Windows workers | `kill -TERM`, 01:13:19Z |
| Laptop | 34563, 85018, 6723, 68452 | `mac-a` workers | 34563 `TERM` at 00:49:43Z. 85018 `TERM` at 00:53:15Z. 6723 by `TaskStop` at 00:57:56Z. 68452 `kill -9` at 01:06:55Z |
| Laptop | 34568, 56714, 85022, 44645 | `mac-b` workers | 34568 `kill -9` at 00:48:38Z. 56714 `TERM` at 00:52:57Z. 85022 `kill -9` at 00:58:08Z. 44645 `TERM` at 01:13Z |
| Laptop | 48538, 48546, 55566, 55579, 57776, 57798, 6507, 6513, 75813, 75963, 71540, 71677, 84441, 84443, 5133, 5134 | Stand-in trees | Each exited by itself; the times are in the tree logs |
| Laptop | not recorded | The first `claude -p` run's child of worker 68452 and the `claude auth status` probe; the background sampler and the driver scripts' shells | Each exited by itself |
| Laptop | not recorded | Every foreground command in the transcript: each `temporal` CLI call (its history identity is `temporal-cli:laptop-user@[laptop host].local`, which carries no pid), each one-shot `ssh`, `scp`, `ps`, `jq`, `curl`, `perl`, `npm` and `node --test`, and the suite runs' test processes | Each returned before the transcript's `--- exit` line for it, or before the next command in the appendix |
| WSL2 and Windows | not recorded | The remote side of each one-shot SSH command: wsl.exe, bash and PowerShell sessions and the commands they ran | Each ended when its SSH session closed |
| Laptop | 4501 | `tee -a` of the transcript wrapper t.sh, caught by the final laptop listing at 01:14:37Z (transcript line 1516) because its command line names the spike directory | Exited with that listing's wrapper; `ps -p 4501` printed only its header at 21:42:05Z |
| Windows | 32072 | `cmd.exe /c "wsl.exe -e bash -s"`, the Windows side of the server's SSH session (laptop 24640), recorded in the 00:48:55Z listing (transcript line 494). It is the only `bash -s` session without arguments in that listing, so attributing it to the spike is a judgment | Ended when that session closed; not alive at 21:42:01Z |
| Windows | 35372, 27620 | `cmd.exe /c "wsl.exe -e bash -s -- wsl-1 wf-v1.js"`, the Windows side of the WSL2 worker sessions, recorded in the same listing (lines 495 and 497) | Ended when their sessions closed; not alive at 21:42:01Z |
| Windows | 9528 | `cmd.exe /c "powershell … -EncodedCommand …"`, the Windows side of that listing's own p.sh call (line 500) | Ended with the call; not alive at 21:42:01Z |
| Windows | 7232, 19092, 32896, 37636, 15112, 36676, 14512 | The OpenSSH session processes the server started for the spike's connections, recorded only as the parent pids of 32072, 35372, 27620, 9528, 12292, 31524 and 34604 | Ended when the connections closed; not alive at 21:42:01Z |
| WSL2 | 1005, 1496, 104112, 104545, 104776, 104863, 104968 | The WSL2 session processes for the spike's worker sessions, recorded only as parent pids: of the holders 1008, 1497, 104116, 104546, 104777, 104864 and 104969, and of the orphan 1426 after its reparenting | Not alive at 21:42:04Z |
| WSL2 | 745 | Temporal dev server | `kill -TERM`, 01:13Z |
| WSL2 | 1010, 104118, 104866 | Workers | `kill -9` in the kill and versioning runs |
| WSL2 | 1499, 104548, 104779, 104971 | Workers | `kill -TERM` |
| WSL2 | 1008, 1497, 104116, 104546, 104777, 104864, 104969 | Session holders, `sleep 1800` | `kill -TERM`, 01:13:30Z |
| WSL2 | 1201, 1208, 1426, 1433, 1576, 1583, 104523, 104530, 104607, 104614, 104946, 104953, 105026, 105033, 105067, 105074 | Stand-in trees | Each exited by itself |
| Windows | 19380, 19544, 21712 | Workers | `Stop-Process -Force` at 00:48:06Z, 00:52:57Z and 01:13Z |
| Windows | 20488, 23612, 21388, 37528 | Stand-in trees | Each exited by itself |
| Windows | 33496, 19992 | Stand-in tree | Died with worker 19380 |
| Windows | 12292, 31524, 34604, and their `ping` children 36912, 19052, 23108 | Launcher shells | `Stop-Process -Force`, 01:13:48Z. They had survived the laptop SSH clients being killed |
| Laptop (re-run) | 68933 | SSH session holding the re-run's WSL2 server | Exited when the server stopped, by 01:54:55Z |
| Laptop (re-run) | 68938 | SSH tunnel, port 17233 | `kill -TERM`, 01:54:55Z |
| Laptop (re-run) | 71061 | `mac-a` worker | `kill -TERM`, 01:54:48Z |
| Laptop (re-run) | 77583 | `claude -p` | Exited by itself, code 1 |
| WSL2 (re-run) | 406 | Temporal dev server | `kill -TERM`, 01:54:48Z |
| Laptop (third run) | 23073 | SSH session holding the third run's WSL2 server | Exited when the server stopped |
| Laptop (third run) | 23077 | SSH tunnel, port 17233 | `kill -TERM`, 02:26:02Z |
| Laptop (third run) | 23128 | `mac-a` worker, started under a fresh login shell | `kill -TERM`, 02:26:01Z |
| Laptop (third run) | 23310 | `claude -p` | Exited by itself, code 0 |
| WSL2 (third run) | 407 | Temporal dev server | `kill -TERM`, 02:26:01Z |

### No recorded pid is still alive

Each host was listed after the last run. All the listings are in the transcript:

- **Laptop, 01:14:37Z.** `ps -p <every laptop pid above>` printed only its header and exited 1. A
  search for `rigger-tree`, worker.js and `1429-spike` found only the listing's own `tee`.
- **WSL2, 01:14:38Z.** `ps -p <every WSL2 pid above>` printed only its header and exited 1. The
  same search found nothing.
- **Windows, 01:17:43Z.** A search of `Win32_Process` for every Windows pid above found none
  alive, and a command-line search for `1429-spike-engineer` or `rigger-tree` found nothing.
  - An earlier listing at 01:14:38Z had counted two of those ids as alive. The one still there
    when checked was pid 21388, which by then was a conhost.exe created at 01:14:37Z: Windows
    had reused a pid, and the process was not the spike's.
- **After the re-run, at 01:55:01Z on all three hosts.** `ps -p 68933,68938,71061,77583` on the laptop and `ps -p 406` in WSL2 each printed only the header and exited 1. A Windows command-line search for `1429-spike-engineer` or `rigger-tree` found nothing.
- **After the third run, at 02:26:08Z on all three hosts.** `ps -p 23073,23077,23128,23310` on the laptop and `ps -p 407` in WSL2 each printed only the header and exited 1. A WSL2 search for `1429-spike` or `temporal server`, and a Windows command-line search for `1429-spike-engineer` or `rigger-tree`, found nothing.
- **For the pids recovered in the round-1 audit, at 21:42Z.** A Windows search for 32072, 35372, 27620, 9528, 7232, 19092, 32896, 37636, 15112, 36676 and 14512 found none alive at 21:42:01Z. `ps -p` over 1005, 1496, 104112, 104545, 104776, 104863 and 104968 in WSL2 at 21:42:04Z, and over 4501 on the laptop at 21:42:05Z, each printed only its header and exited 1.

### The Mac mini

**The spike did not use the Mac mini**, so no M8 coordinator OK was needed.
