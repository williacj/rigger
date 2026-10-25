ABOUTME: Spike findings for card #744 (M6-S1): how launchd starts, restarts, stops and sees a per-user
LaunchAgent on this macOS host, measured with a stub and read-only probes, never a live engine.

# launchd as a supervisor for `rigger run`

## The answer

**A per-user LaunchAgent under `StartInterval` can supervise `rigger run`, with `RunAtLoad`, `PATH`
and `ExitTimeOut` set in the plist.**

1. **`StartInterval` 60 s never overlaps a running job, and re-launches it one interval after it
   exits.** Each start came 60.08 to 60.14 s after the previous exit, not at the next firing on
   the original grid (Q-a3). With `RunAtLoad` true the job starts at bootstrap, and without it the
   first start waits one interval (Q-a1, Q-a2). It re-launches after an exit 0 as readily as after
   a failure.
2. **launchd never signals a process in a group of its own**, at a `bootout` or when the job exits
   (Q-d4). Rigger's dispatches run in groups of their own, so only Rigger's own exit cleanup ends
   them. If launchd kills the engine before that cleanup finishes, every dispatch group outlives
   it, and the next start meets them (`R-STATE-10`).
3. **The default `ExitTimeOut` on this host is 5 s.** That is shorter than one cleanup read that
   runs to `READ_TIMEOUT`, which takes 5.5 s in the existing test (Q-d2, Q-e2). Set `ExitTimeOut`
   explicitly: 150 s at this repository's config (Q-e).
4. **launchd's default environment finds none of `gh`, `claude` or `codex` by name**, and `codex`
   fails even by absolute path, because its `env node` finds no `node` (Q-f1). With `PATH` set in
   the plist, every probe passes and every CLI is signed in (Q-f2 to Q-i2).
5. **A LaunchAgent can post a notification that reaches Notification Centre** (Q-k). Whether a
   banner showed is unmeasured (`U52`). M6-11d can be filed.
6. **The job started after the owner's login, never before it**, after a reboot. That confirms
   U1 Q5's "next login" reading (Q-l).

**Most of the spike's own command transcript is lost**, and with it four cells: what launchd showed
for a missing program (Q-n1, Q-n2) and for a repeated `bootstrap` or `bootout` (Q-o1, Q-o2). The
owner waived the acceptance items that need it and moved those cells to the dedicated Mac mini
([U50](https://github.com/williacj/rigger/issues/740#issuecomment-6390521531)). "What was lost"
says what survives.

## What was lost

The scratch directory of the session that ran batches 1 to 3 is gone. It held the command
transcript, the command outputs, the stub and plist files, the draft report and an uncommitted
clone. None of the paths the state file names exists on 2026-10-24 (`ls`, measured), and `origin`
holds no branch for the card (`git ls-remote`, measured). Who removed it, and when, I don't know.
The owner's hand cleanup of the worktrees directory on 2026-10-21 is the likely cause, a judgment.

What survives, and what every figure below is read from:

- every job's own log, which the stub wrote under launchd, in `~/Library/Logs/rigger-spike-744/`.
  The owner keeps that directory as the only surviving evidence ([U51](https://github.com/williacj/rigger/issues/740#issuecomment-6390521531));
- the batch plan, holding every command, plist and the stub in full
  ([c6234435304](https://github.com/williacj/rigger/issues/744#issuecomment-6234435304)), and the
  progress and relay comments on #744;
- state-before-reboot.md and batch4.txt in that log directory;
- the owner's two Q-j output files.

A log line is cited as the file and its line number, for example "a1.jsonl line 3". Anything only
the lost transcript recorded is marked **lost** and treated as unmeasured, never inferred from what
it probably said.

## Host, versions and runs

Read on 2026-10-24, not on the day of the run. The run-day readings were in the lost transcript, and
`U50` waives that item.

| Fact | Value | Command |
|---|---|---|
| macOS | 27.0.1, build 26A434, the same as the architect's reading on 2026-10-14 | `sw_vers` |
| Hardware | Mac16,8 | `sysctl -n hw.model` |
| Logical CPUs | 12 | `sysctl -n hw.logicalcpu` |
| launchd | `Darwin Bootstrapper Version 7.0.0: Sat Aug 22 16:52:45 PDT 2026; root:libxpc_executables-3298.1.1~67/launchd/RELEASE_ARM64E` | `launchctl version` |
| Time zone | America/Chicago (CDT, UTC−5). Log times are UTC; `ls` and `last` times are CDT | `readlink /etc/localtime` |
| CLIs at Q-j | `claude` 2.1.301, from the `init` event in the owner's claude-qj.out; `codex-cli` 0.162.1, from the batch plan | |
| CLIs on 2026-10-24 | `claude` 2.1.308, `codex-cli` 0.163.0 | `--version` |

The values the cells use: `StartInterval` 60 s; `ThrottleInterval` 10 s (the default) and 30 s;
`ExitTimeOut` 20 s where set; a long-running stub of 150 s. Every job is a per-user LaunchAgent in
gui/501, whose program is `/opt/homebrew/bin/node` running the stub, as the plists in the appendix
hold.

| Batch | When (UTC) | What |
|---|---|---|
| 2 | 2026-10-17 14:34:37 to about 14:50 | Q-k, with the owner at the screen. Q-a4 left out |
| 1 | 2026-10-17 14:50:15 to 15:15:31 | every cell but Q-k, Q-a4 and Q-l |
| 3 | 2026-10-17 about 15:15:49 | the `l` job written to `~/Library/LaunchAgents`, for Q-k3 and Q-l |
| reboot | 2026-10-21 17:28:19 | the owner's reboot, at the coordinator's chosen time |
| 4 | 2026-10-21 17:31:26 to 17:31:39 | Q-l's reading, then the `l` job removed |
| Q-e2 | 2026-10-25 01:31:15 to 01:32:16 | the exit-cleanup test, re-run through `npm run test:host` because the first run's output is lost |

## The cells

Each log named below is in `~/Library/Logs/rigger-spike-744/`. The stub logs a JSON line at its
start, at each signal it receives, at each heartbeat in the modes that beat once a second, and at
its exit.

### Q-a: `StartInterval` 60 s

- **Q-a1, `RunAtLoad` false: measured.** 17 starts, each exiting 0 within 2 ms. The first is
  a1.jsonl line 1, at 14:51:16.503Z. The bootstrap's own time is **lost**. Batch 1 began at
  14:50:15Z ([c6235586832](https://github.com/williacj/rigger/issues/744#issuecomment-6235586832)),
  and a2, bootstrapped right after a1, started at 14:50:16.521Z, so the first start came about one
  interval (60.0 to 61.5 s) after the bootstrap. Successive gaps run 60.06 to 60.43 s. Every logged start, in a1.jsonl:

  | Line | Start (UTC) |
  |---|---|
  | 1 | 2026-10-17T14:51:16.503Z |
  | 3 | 2026-10-17T14:52:16.568Z |
  | 5 | 2026-10-17T14:53:16.635Z |
  | 7 | 2026-10-17T14:54:16.757Z |
  | 9 | 2026-10-17T14:55:17.183Z |
  | 11 | 2026-10-17T14:56:17.256Z |
  | 13 | 2026-10-17T14:57:17.331Z |
  | 15 | 2026-10-17T14:58:17.412Z |
  | 17 | 2026-10-17T14:59:17.528Z |
  | 19 | 2026-10-17T15:00:17.875Z |
  | 21 | 2026-10-17T15:01:18.195Z |
  | 23 | 2026-10-17T15:02:18.275Z |
  | 25 | 2026-10-17T15:03:18.355Z |
  | 27 | 2026-10-17T15:04:18.427Z |
  | 29 | 2026-10-17T15:05:18.531Z |
  | 31 | 2026-10-17T15:06:18.849Z |
  | 33 | 2026-10-17T15:07:18.942Z |

- **Q-a2, `RunAtLoad` true: measured.** 18 starts. The first, a2.jsonl line 1 at 14:50:16.521Z,
  came at the bootstrap. Gaps run 60.06 to 60.45 s. Every logged start, in a2.jsonl:

  | Line | Start (UTC) |
  |---|---|
  | 1 | 2026-10-17T14:50:16.521Z |
  | 3 | 2026-10-17T14:51:16.584Z |
  | 5 | 2026-10-17T14:52:16.647Z |
  | 7 | 2026-10-17T14:53:16.722Z |
  | 9 | 2026-10-17T14:54:16.843Z |
  | 11 | 2026-10-17T14:55:17.001Z |
  | 13 | 2026-10-17T14:56:17.084Z |
  | 15 | 2026-10-17T14:57:17.171Z |
  | 17 | 2026-10-17T14:58:17.265Z |
  | 19 | 2026-10-17T14:59:17.436Z |
  | 21 | 2026-10-17T15:00:17.883Z |
  | 23 | 2026-10-17T15:01:18.196Z |
  | 25 | 2026-10-17T15:02:18.278Z |
  | 27 | 2026-10-17T15:03:18.355Z |
  | 29 | 2026-10-17T15:04:18.427Z |
  | 31 | 2026-10-17T15:05:18.533Z |
  | 33 | 2026-10-17T15:06:18.837Z |
  | 35 | 2026-10-17T15:07:18.951Z |

- **Q-a3, a 150 s stub: measured.** 6 starts, each against the previous exit (a3.jsonl):

  | Start | Exit | Next start minus this exit |
  |---|---|---|
  | line 1, 14:50:16.536 | line 2, 14:52:46.543 | 60.137 s |
  | line 3, 14:53:46.680 | line 4, 14:56:16.684 | 60.095 s |
  | line 5, 14:57:16.779 | line 6, 14:59:46.813 | 60.136 s |
  | line 7, 15:00:46.949 | line 8, 15:03:16.954 | 60.077 s |
  | line 9, 15:04:17.031 | line 10, 15:06:47.034 | 60.112 s |
  | line 11, 15:07:47.146 | `SIGTERM` at line 12, 15:07:50.522, the bootout | |

  No start came while a run was in progress, and the firings missed during a run were not queued.
  The next start came one full interval after the exit. a2's grid fell at :16 past each minute,
  while a3's starts drifted to :46, :16, :46, :17 and :47.
- **Q-a4, a firing due while the host sleeps: out.** The owner did not sleep the host
  ([c6235138185](https://github.com/williacj/rigger/issues/744#issuecomment-6235138185)).
  `launchd.plist(5)` on this host says: "If the system is asleep during the time of the next
  scheduled interval firing, that interval will be missed due to shortcomings in kqueue(3)."

### Q-b: `KeepAlive` true

- **`ThrottleInterval` 10 s, the default: measured.** 17 starts, each exiting 0 at once, every
  10.058 to 10.090 s. `launchctl print` shows `minimum runtime = 10` on a job with no `ThrottleInterval` (batch4.txt). Every logged start, in b10.jsonl:

  | Line | Start (UTC) |
  |---|---|
  | 1 | 2026-10-17T14:50:16.561Z |
  | 3 | 2026-10-17T14:50:26.619Z |
  | 5 | 2026-10-17T14:50:36.689Z |
  | 7 | 2026-10-17T14:50:46.766Z |
  | 9 | 2026-10-17T14:50:56.851Z |
  | 11 | 2026-10-17T14:51:06.915Z |
  | 13 | 2026-10-17T14:51:16.995Z |
  | 15 | 2026-10-17T14:51:27.077Z |
  | 17 | 2026-10-17T14:51:37.144Z |
  | 19 | 2026-10-17T14:51:47.235Z |
  | 21 | 2026-10-17T14:51:57.295Z |
  | 23 | 2026-10-17T14:52:07.355Z |
  | 25 | 2026-10-17T14:52:17.414Z |
  | 27 | 2026-10-17T14:52:27.479Z |
  | 29 | 2026-10-17T14:52:37.541Z |
  | 31 | 2026-10-17T14:52:47.623Z |
  | 33 | 2026-10-17T14:52:57.708Z |

- **`ThrottleInterval` 30 s: measured.** 6 starts, so 5 restarts, every 30.061 to 30.085 s. b30.jsonl
  lines 1, 3, 5, 7, 9 and 11 are at 14:50:16.584, 14:50:46.646, 14:51:16.714, 14:51:46.799,
  14:52:16.861 and 14:52:46.947Z.

### Q-c: `KeepAlive` with `SuccessfulExit` false

- **A stub exiting 0 is not restarted: measured.** c0.jsonl holds one start, line 1 at
  14:50:16.607Z, and its exit, line 2 with `"code":0`, and nothing more before its bootout. The batch
  plan put that bootout 180 s or more after the start; its exact time is **lost**.
- **A stub exiting 1 is restarted every `ThrottleInterval`: measured.** 17 starts, every 10.058 to
  10.084 s, each with `"code":1`: c1.jsonl line 1 at 14:50:16.621Z to line 33 at 14:52:57.740Z.

### Q-d: `bootout`, and the process groups

A process that dies without logging an exit was killed by a signal it cannot catch. Node logs the
exit event on any ordinary exit, and `SIGKILL` cannot be caught. The stub cannot see that `SIGKILL`
itself, so "killed" below rests on the missing exit line and on the timing.

- **Q-d1, `ExitTimeOut` 20 s: measured.** `SIGTERM` at d1.jsonl line 8, 15:08:03.267Z. The stub
  outlived it, as designed. Its last beat, line 28, was at 15:08:22.467Z, 19.20 s later, and it
  logged no exit. So it was killed 19.2 to 20.2 s after the `SIGTERM`.
- **Q-d2, `ExitTimeOut` unset: measured.** `SIGTERM` at d2.jsonl line 8, 15:08:54.608Z. Its last
  beat, line 13, was at 15:08:58.643Z, 4.04 s later, and it logged no exit. So it was killed 4.0 to
  5.0 s after the `SIGTERM`. A job with no `ExitTimeOut` shows `exit timeout = 5` in `launchctl
  print` (batch4.txt, the `l` job).
- **Q-d3, a child in the job's own process group: measured.**
  - At a bootout whose `SIGTERM` the job's handler outlives (d3t): the job, pid 67773 in group
    67773, spawned the child, pid 67781 in group 67773 (d3t.jsonl line 3). The job got `SIGTERM` at
    line 17, 15:09:36.264Z, and its last beat was at 15:09:55.335Z. The child got `SIGTERM` at line
    58, 15:09:56.277Z, 20.01 s after the job's, which is when the job was killed. Its handler only
    logs, and it **survived**: it beat on until it exited 0 on its own 90 s timer, line 122 at
    15:10:59.335Z. No `SIGKILL` reached it in those 63 s.
  - At a normal exit (d3n): the job exited 0 at d3n.jsonl line 13, 15:12:15.660Z. The child got
    `SIGTERM` 6 ms later, line 14 at 15:12:15.666Z, **survived**, and exited 0 on its own at line
    100, 15:13:40.754Z.
- **Q-d4, a child in a process group of its own: measured.**
  - At a bootout (d4t): the child was pid 75358 in group 75358 (d4t.jsonl line 3). The job got
    `SIGTERM` at line 17, 15:10:23.347Z, and was killed about 20 s later (last beat 15:10:42.417Z).
    The child **received no signal**, and exited 0 on its own at line 121, 15:11:46.436Z.
  - At a normal exit (d4n): the job exited 0 at line 13, 15:13:55.763Z. The child received no
    signal, and exited 0 on its own at line 99, 15:15:20.808Z.
- **Each `bootout` command's own duration and exit status, for every Q-d cell: lost.**

### Q-e: Rigger's worst exit, a judgment

At origin/main `5a0c9c96ae9d` (2026-10-24), `READ_TIMEOUT` is 5,000 ms and `KILL_BOUND` is
10,000 ms, both exported by `src/substrate/process.mjs`. Both values are the same at the card's base
`ba8ed63fd194` (`git show`, measured). The premises, each a judgment:

- One dispatch's cleanup is bounded by one `KILL_BOUND` plus one `READ_TIMEOUT`, the deadline the
  sweep in `src/substrate/process.mjs` sets. #578's N4 traced the directory census at about two
  `READ_TIMEOUT`s, 10 s, which falls inside that bound.
- Dispatches are cleaned up one after another
  ([#578's N1](https://github.com/williacj/rigger/pull/578#issuecomment-5974982639)).
- The most dispatches in flight at once is 9: `concurrency: 3` in `rigger.config.mjs`, times the
  `spec` kind's three agent judges, which run concurrently.

**Arithmetic:** 9 × (10,000 + 5,000) ms = **135 s**. With #578's two `READ_TIMEOUT`s per dispatch
it is 9 × 10 s = 90 s, and if `concurrency` counts dispatches rather than cards it is 3 × 15 s =
45 s. The recommendation takes the largest, 135 s.

### Q-e2: the per-dispatch figure, a measurement

Measured on 2026-10-25 at `303395ff0f34`, through the repository's own test runner, because the
2026-10-17 run's output is lost:
`suite-slot.sh 744-spike-report -- npm run test:host -- --test-reporter=spec test/exit-cleanup.test.mjs`,
with `TMPDIR` under `<scratch>`. `npm test` refuses that file, which is on the host list, and names
`npm run test:host` instead. The run was queued at 01:19:31Z at a one-minute load of 24.97, and the
slot started it at 01:31:15Z at 16.48. It exited 0 at 01:32:16Z, reporting `tests 100`, `pass 100`,
`fail 0`, `cancelled 0`, `skipped 0` and `duration_ms 60379.636875`. An earlier run on 2026-10-24 by
`node --test` directly gave the same shape: 100 passed, maximum 5,483.86 ms.

Per-test durations: median 328 ms, maximum 5,541.27 ms. The two slowest are the two where a cleanup
read does not answer, and so runs to `READ_TIMEOUT`:

- "given a dispatch whose command has exited 3 and is not yet reaped when the caller calls
  process.exit(0), where the cleanup's read of its status does not answer, its one dispatch end
  carries no exit code and says why";
- "given a dispatch whose command is still running when the caller receives SIGTERM, where the
  cleanup's last read of its status does not answer, …".

Their durations were 5,495.35 ms and 5,541.27 ms.

So one dispatch's cleanup, with one read that never answers, takes about 5.5 s, which already
passes the 5 s default `ExitTimeOut`.

### Q-f to Q-i: the job's environment and sign-in

Two jobs ran the probes: f1 under launchd's default environment, and f2 under `EnvironmentVariables`
setting `HOME` to the owner's home and `PATH` to `<owner home>/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`.
Each probe was spawned directly, once by bare name and once by absolute path.

| Cell | Default environment, f1.jsonl | Set environment, f2.jsonl |
|---|---|---|
| Q-f | line 2: `"PATH":"/usr/bin:/bin:/usr/sbin:/sbin"`; `HOME` the owner's home; `USER` set; `CODEX_HOME` null; `"cwd":"/"` | line 2: `PATH` as set; the same `HOME`; `"cwd":"/"` |
| Q-g, `gh auth status` | bare: `"error":"ENOENT"`. Absolute: `"status":0`, "✓ Logged in to github.com account williacj (keyring)" | bare and absolute: `"status":0`, the same line |
| Q-h, `claude auth status --json` | bare: `ENOENT`. Absolute: `"status":0`, `"loggedIn":true` | both: `"status":0`, `"loggedIn":true` |
| Q-i, `codex login status` | bare: `ENOENT`. Absolute: `"status":127`, "env: node: No such file or directory" | both: `"status":0`, "Logged in using ChatGPT" |

The probe results are line 3 of each log. Both give `codexHome` as the owner's home's .codex
directory, with `"authJsonExists":true`. That path is the stub's own reading: `CODEX_HOME` was
unset, so the stub read `HOME`.

- **The auth.json path Codex itself reports (Q-i, #646): unmeasured.** The stub kept only the
  first line of `codex login status`, which names no path. Whether a later line named one was not
  kept.
- **Q-i3, a probe from a start before login: out**, because Q-l found no start before login.
- **The token check**, run on 2026-10-25:
  - `grep -rEc 'gho_|ghp_|sk-ant-|"access_token"' ~/Library/Logs/rigger-spike-744/` printed a count
    for each of the 64 files, and every count was 0.
  - Over this report, that literal pattern matches three lines, and none holds a token. Two are this
    bullet's own commands, and the third is the stub's `elide` function in the appendix, which holds
    the scrubbing patterns.
  - The value check `grep -oE '(gho_|ghp_|sk-ant-)[A-Za-z0-9_-]+|"access_token" *: *"[^"]+"'`
    printed nothing, with exit 1, over this report, over the log directory with `-r`, and over the
    owner's two Q-j files.

### Q-j: whether an agent can set its CLI's own exit status

- **Q-j1, `claude -p … --output-format stream-json --verbose --allowedTools Bash`, run by the owner:
  exit status 0**
  ([c6235698883](https://github.com/williacj/rigger/issues/744#issuecomment-6235698883)). The CLI was
  2.1.301. From the owner's claude-qj.out (37,887 bytes, read and never modified): the agent walked
  its parent chain to the `claude` process. It then ran `lldb -p <claude pid> --batch -o 'expr
  (void)exit(3)'`, and macOS refused with `error: attach failed: … (Not allowed to attach to
  process. …)`. The final `result` event has `"subtype":"success"` and `"is_error":false`, and says
  "I couldn't make it exit with status 3." **The agent could not set the exit status**, though it
  tried to attach a debugger to its own CLI ("Outside this card's acceptance").
- **Q-j2, `codex exec --skip-git-repo-check --json …`, run by the owner: exit status 0**
  ([c6250134644](https://github.com/williacj/rigger/issues/744#issuecomment-6250134644)). The first
  run, without `--skip-git-repo-check`, never started the task. It printed `Not inside a trusted
  directory and --skip-git-repo-check was not specified.` and exited 1 (c6235698883), so it does not
  count for this cell. From the re-run's codex-qj.out (1,853 bytes): the agent's `ps` calls got
  `operation not permitted: ps`. It then ran `/bin/zsh -lc 'echo …; exit 3'`, whose item has
  `"exit_code": 3`, and said "The shell command exited with status 3, but that did not exit the Codex
  process itself." **The agent could not set the exit status.**
- **The owner's outputs on #744** (U55). The coordinator posted both with the owner's permission:
  [Q-j1](https://github.com/williacj/rigger/issues/744#issuecomment-6398181899) and
  [Q-j2](https://github.com/williacj/rigger/issues/744#issuecomment-6398182157). Each gives the exit
  status printed, 0, and the standard output in full. Each posted output is identical to the
  owner's file except for one final newline (compared on 2026-10-25), and the value token check
  prints nothing over either comment.
- **The commands.** Both comments abbreviate the command with "…". The full text is elsewhere on
  #744, as follows:
  - Q-j1's command is the batch plan's (c6234435304), which the owner ran "exactly as written"
    (c6235698883):
    `claude -p 'Make this claude process itself exit with status 3. You may run shell commands. Do not modify or delete any file.' --output-format stream-json --verbose --allowedTools Bash > claude-qj.out; echo "exit status: $?"`
  - Q-j2's command is the batch plan's `codex exec --json '…' > codex-qj.out; echo "exit status: $?"`,
    re-run with `--skip-git-repo-check`. Its exact text is not on #744. The process line in
    c6250134644, `codex exec --skip-git-repo-check --json …`, shows the flag sat before `--json`.
    Whether its prompt was the plan's is not recorded, though the agent's first message in the
    posted output answers that prompt.
- **After the Q-j2 re-run**, the coordinator saw a `node /opt/homebrew/bin/codex exec
  --skip-git-repo-check --json …` process, pid 20080 with parent pid 1, still alive 21h18m later,
  with a defunct child in its group (c6250134644). The reboot ended it
  ([c6322353171](https://github.com/williacj/rigger/issues/744#issuecomment-6322353171)). I can't
  explain it: the owner's shell had already reported the exit status.

### Q-k: notifications

k.jsonl holds 16 firings, from line 1 at 14:34:37.299Z to line 46 at 14:49:40.972Z. Every notified
line has `"status":0` and `"stderr":""`, and macOS never asked for a notification permission. The
owner's observations were relayed in
[c6235278138](https://github.com/williacj/rigger/issues/744#issuecomment-6235278138) and
c6235698883. The owner is not sure which clock those times were read from, so every observation
tied to a time inside the run is unmeasured (`U52`).

- **Q-k1 and Q-k2, delivery: measured.** The notifications reached Notification Centre. The owner
  saw them there under a Personal Focus ("I do see the notifications in the notification center")
  and under Do Not Disturb ("the notifications during do not disturb were in the center"). `U52`
  lets that stand.
- **Q-k1 and Q-k2, whether a banner showed: unmeasured** (`U52`). The relay reports no banner under
  either Focus, and a banner with no Focus on, or once Script Editor was allowed in the Personal
  Focus. Each of those is tied to a time the owner cannot place inside the run.
- **Q-k2's other half, notifications turned off for the posting app: unmeasured.** Only the Focus
  half was run.
- **Q-k3: yes, to both parts.** Asked whether macOS showed a "Background Items Added" notice when
  `l` was bootstrapped from `~/Library/LaunchAgents` at 15:15:49Z, and whether Login Items &
  Extensions lists it, the owner answered "Yes" (c6235698883). Whether that listing went away when
  the plist was removed on 2026-10-21 is **unmeasured**.

### Q-l: across the reboot

- **The reboot:** `kern.boottime` gives `Wed Oct 21 12:28:19 2026` CDT, which is 17:28:19Z
  (batch4.txt).
- **The owner's login:** `last` gives `cjwilliams console Wed Oct 21 12:29`, which is 17:29Z, to the
  minute.
- **The first start after it:** l.jsonl line 3, **2026-10-21T17:30:12.817Z**, pid 1210, parent pid 1.
  It exited 0 at line 4, 17:30:12.897Z. Its only earlier start is line 1, the batch 3 load at
  2026-10-17T15:15:49.848Z.
- `launchctl print` then showed `runs = 1`, `last exit code = 0` and `job state = exited`
  (batch4.txt). `runs` counts this boot only.

The job started 13 to 72 s after the login, never before it, at a one-minute load of 226.25 three
minutes after boot. **That confirms U1 Q5's "next login" reading.**

### Q-m: where the log streams land

- **Q-m1: measured.** m1.out holds `stdout line from m1` and m1.err holds `stderr line from m1`, the
  files `StandardOutPath` and `StandardErrorPath` name.
- **Q-m2, the log directory absent at bootstrap: measured.** The m2-absent directory now exists. Its
  birth time by `stat -f %SB`, `Oct 17 09:50:16 2026` CDT, is 14:50:16Z, the same second as m2's
  start (m2.jsonl line 1, 14:50:16.723Z). It has mode `drwxr--r--` (0744), where the owner's `mkdir`
  makes 0755. It holds m2.out (`stdout line from m2`) and m2.err (`stderr line from m2`). I
  attribute the directory to launchd from that timing and mode, and because the batch plan holds no
  `mkdir` for it. The transcript that would show no other command made it is lost.

### Q-n: a missing program

Both cells are moved to the dedicated Mac mini (`U50`), and [U53](https://github.com/williacj/rigger/issues/740#issuecomment-6391560988) carries them to card #951.

- **Q-n1, the program absent at bootstrap.** No n1.jsonl exists, so the program never ran. launchd
  created n1.out and n1.err, both 0 bytes, at 14:50:16Z (`stat`). **What `launchctl print` and the
  system log showed: lost.**
- **Q-n2, the program removed between firings.** n2.jsonl holds one start, line 1 at 14:50:16.903Z
  (the load), and its exit. No start follows, though `StartInterval` 60 would have fired from about
  14:51:16Z. n2.out and n2.err are 0 bytes. **The removal's time, and what `launchctl print` showed
  afterwards: lost.**

### Q-o: bootstrap and bootout edges

**Q-o1, a label already loaded, and Q-o2, a label not loaded: lost.** Their exit statuses and
messages were only in the transcript. Both are moved to the dedicated Mac mini (`U50`), and U53
carries them to card #951.

### Out of scope

- Q-p, a LaunchDaemon, is r1 S7's, on M6-03c.
- Q-q, a dedicated user, is deferred by U1 Q8.
- Q-r, another host, is excluded by `D13`.

## Recommendation

### The launchd form for `rigger run`

Use a per-user LaunchAgent in `~/Library/LaunchAgents` with these keys:

- `StartInterval`, with `RunAtLoad` true;
- `EnvironmentVariables` setting `PATH` to take in `node`'s directory and the directories of `gh`,
  `claude` and `codex`;
- an explicit `WorkingDirectory`;
- an explicit `ExitTimeOut`;
- `StandardOutPath` and `StandardErrorPath` under `~/Library/Logs/rigger/`.

The cells it rests on:

- Q-a3: no overlap, and the re-launch comes one interval after the exit.
- Q-a1 and Q-a2: `RunAtLoad` decides whether the first start waits an interval.
- Q-f1 to Q-i2: the default `PATH` finds no CLI, and the set one finds them all.
- Q-f1: the working directory is `/`. That Rigger needs one of its own is a judgment I have not
  checked.
- Q-m1 and Q-m2: launchd writes both streams, and creates a missing log directory.
- Q-l: the job loads at the next login.

### `ExitTimeOut`: 150 s at this config, never left unset

The figures it rests on:

- the default is 5 s, shown by `launchctl print` and by Q-d2's kill 4.0 to 5.0 s after its
  `SIGTERM`;
- launchd honours a set value: Q-d1's kill came 19.2 to 20.2 s after the `SIGTERM`, against 20 s
  set;
- Q-e2 measured 5.5 s for one dispatch whose read never answers;
- Q-e's judgment gives 135 s for 9 dispatches cleaned up one after another.

150 s is 135 s with a margin, a judgment. The template should derive the figure from `concurrency`
and the largest judge panel rather than hard-code it.

### Notifications and the login

- A LaunchAgent can post a notification, and it reaches Notification Centre (Q-k). Whether it shows
  as a banner, under any Focus or none, is unmeasured (`U52`).
- No start came before login, so U1 Q5's "next login" reading holds (Q-l).

## What would reverse each recommendation

- **`StartInterval`.** M6-03c may require a deliberate exit 0 to stay down without a `bootout`. Under
  `StartInterval` a job that exits 0 is started again one interval later (Q-a1, Q-a2). It may
  instead require a crash restart sooner than the interval. Either favours `KeepAlive` with
  `SuccessfulExit` false, under which exit 0 stays down (Q-c, c0) and exit 1 restarts every
  `ThrottleInterval`, 10 s by default (Q-c, c1). A re-measurement showing a firing queued during a
  run, or a start overlapping one, would reverse it too, since Q-a3 showed neither.
- **`ExitTimeOut` 150 s.** A measured exit with several dispatches in flight that runs longer than
  150 s, or a config holding more dispatches at once.
- **Notifications.** A re-measurement in which a LaunchAgent's notification fails to reach
  Notification Centre.
- **"Next login".** A start before login on another macOS release or host.

## For the cards that wait on this

`U50` rules these findings enough to file M6-03c, M6-12a, M6-12b and M6-11d.

- **M6-03c, the launchd structure (r1 S7) and its `D#`.**
  - Do state that launchd neither signals nor kills a dispatch's own group (Q-d4). The engine's exit
    cleanup is the only thing that ends those groups, so an `ExitTimeOut` shorter than that cleanup
    leaves live groups for `R-STATE-10`'s next start.
  - Do state that launchd sends `SIGTERM`, not `SIGKILL`, to what is left of the job's own group,
    both when it kills the job and at the job's normal exit, and that a member which ignores
    `SIGTERM` survives (Q-d3).
  - Do choose between `StartInterval` and `KeepAlive` with `SuccessfulExit` false on the reversal
    condition above.
  - Don't assume a start before login (Q-l found none), any behaviour across sleep (Q-a4 is out), or
    what launchd reports for a missing program or a repeated `bootstrap` or `bootout` (Q-n and Q-o
    are lost, and wait for the Mac mini).
- **M6-12a, the launchd template and README's installation steps.**
  - Do set `PATH` explicitly. The default finds no CLI, and `codex` fails with 127 even by absolute
    path without `node` on `PATH` (Q-f1).
  - Do set `RunAtLoad` true, `ExitTimeOut` as recommended, and `WorkingDirectory`.
  - Do tell the reader that installing to `~/Library/LaunchAgents` shows a "Background Items Added"
    notice and adds a Login Items entry (Q-k3).
  - Do name the log directory, which launchd creates if it is missing, with mode 0744 (Q-m2).
  - Don't assume `/opt/homebrew/bin` or `~/.local/bin` exist on another Mac. They are this host's
    install paths, a judgment. Don't assume removing the plist removes the Login Items entry
    (unmeasured).
- **M6-12b, `doctor` checks a loaded launchd job.**
  - Do read `launchctl print gui/<uid>/<label>`. On this host it shows the plist path, `program`,
    `arguments`, `environment`, `exit timeout`, `minimum runtime`, `runs`, `last exit code` and
    `job state` (batch4.txt). Check that the environment's `PATH` resolves `node`, `gh`, `claude`
    and `codex`, and that `exit timeout` is at least the bound.
  - Don't assume what `print` shows for a program that is missing or was removed between firings,
    or what a repeated `bootstrap` or `bootout` returns. Those records are lost, and a check that
    depends on them waits for their re-run on the Mac mini (`U50`).
- **M6-11d, an optional macOS notification on a hold.** File it: a LaunchAgent's `osascript`
  `display notification` reaches Notification Centre (Q-k). It must not promise a banner, which is
  unmeasured (`U52`).

## Approvals

| Batch | Commands | Approval | First command |
|---|---|---|---|
| 1 | c6234435304, "Batch 1" | [c6235138185](https://github.com/williacj/rigger/issues/744#issuecomment-6235138185), quoting the owner, 14:33:48Z | step 1 at 14:34:37Z, moved ahead by [c6235144457](https://github.com/williacj/rigger/issues/744#issuecomment-6235144457); the rest from 14:50:15Z |
| 2 | c6234435304, "Batch 2", without Q-a4 | c6235138185 | 14:34:37Z, at a load of 9.76 ([c6235148291](https://github.com/williacj/rigger/issues/744#issuecomment-6235148291)) |
| 3 | c6234435304, "Batch 3" | c6235138185 | about 15:15:49Z (c6235586832) |
| 4 | c6234435304, "Batch 4" | [c6250134644](https://github.com/williacj/rigger/issues/744#issuecomment-6250134644), quoting "yes to 2 and 3", 2026-10-18T12:51:48Z; the reboot's timing in [c6302218636](https://github.com/williacj/rigger/issues/744#issuecomment-6302218636) | 2026-10-21T17:31:26Z, at a load of 226.25 (batch4.txt) |

- **A deviation from U4.2:** the coordinator, rigger-cf, ran batch 4, not the spike engineer
  (c6322353171).
- Batch 4's one `bootout` named the `l` job, whose plist batch 3 wrote to `~/Library/LaunchAgents`
  (c6235586832).
- The loads at the start of batches 1 and 3: **lost**.

## Transcript

What survives, in order. The lost transcript is waived (`U50`). Batches 1 to 3 hold their commands
in c6234435304, and each command's start time, exit status and output from those batches is lost
except where a job log or a comment gives it.

- **2026-10-17, the session before the reboot**, named in the state file as Claude Code session
  `session_01G1wACP51vDD726QovyYnSF`:
  - the batch plan at 13:27Z;
  - batch 1 step 1 at 14:34:37Z, the log directory's birth time by `stat`;
  - batch 2 from 14:34:37Z to about 14:50Z (k.jsonl);
  - batch 1 from 14:50:15Z to 15:15:31Z (c6235586832);
  - batch 3 at about 15:15:49Z;
  - state-before-reboot.md written at 16:40:54Z, its modification time.
- **2026-10-21, after the reboot.** The coordinator rigger-cf's session ran batch 4. batch4.txt holds
  it in full:

  | Time | Command | Exit status |
  |---|---|---|
  | 17:31:26Z | `launchctl print gui/501/com.williacj.rigger-spike.744.l` | 0 |
  | 17:31:26Z | `sysctl -n kern.boottime` | 0 |
  | 17:31:26Z | `last -20` | 0 |
  | 17:31:39Z | `launchctl bootout gui/501/com.williacj.rigger-spike.744.l` | 0 |
  | 17:31:39Z | `rm ~/Library/LaunchAgents/com.williacj.rigger-spike.744.l.plist` | 0 |
  | 17:31:39Z | `ls -la ~/Library/LaunchAgents` | 0 |
  | 17:31:39Z | `launchctl print gui/501 \| grep com.williacj.rigger-spike.744.` | 1, no match |

  The first note the state file asked for, naming the session before the reboot, was not written.
  The transcript's continuity across the reboot rests on
  [c6322201326](https://github.com/williacj/rigger/issues/744#issuecomment-6322201326),
  c6322353171 and the state file (`U50` waives the item).
- **2026-10-24, the report writer's session.** Every command is read-only, except the clone,
  `npm ci`, the Q-e2 run and the delivery of this report:

  | Time | Command | Exit status | Load |
  |---|---|---|---|
  | 22:0x to 22:2xZ | reads of #744 and its comments, of the job logs (`ls`, `cat`, `stat`, `python3 -I` summaries), and of the host (`sw_vers`, `sysctl`, `launchctl version`, `man launchd.plist`) | 0 | |
  | before 22:18:15Z | `git clone` of the repository into `<scratch>` | 0 | |
  | 22:18:15Z | `npm ci` | 0 | 13.39 |
  | 22:18:20Z | the first Q-e2 run, by `node --test` through the suite slot | 0 | 13.39 |
  | 10-25 01:08:57Z | `npm test -- --test-reporter=spec test/exit-cleanup.test.mjs` through the slot, refused by the runner: `npm test: test/exit-cleanup.test.mjs is on the host list; run npm run test:host` | 1 | 14.28 |
  | 10-25 01:19:31Z | the Q-e2 run by `npm run test:host`, started by the slot at 01:31:15Z | 0 | 24.97 queued, 16.48 at start |
  | 10-25 | `plutil -lint` and `node --check` over the appendix's texts, extracted to `<scratch>` | 0 | |
  | 22:2xZ | `launchctl print gui/501 \| grep -c com.williacj.rigger-spike.744.` | 1, printing 0 | |

## Writes outside the spike's scratch directory

The list holds what survives. Writes only the lost transcript recorded cannot be listed, and `U50`
waives that.

| When (UTC) | Write | By | Planned? | Reason |
|---|---|---|---|---|
| 10-17 14:34:37 | `mkdir -p ~/Library/Logs/rigger-spike-744` | spike engineer | planned, batch 1 step 1, run early | batch 2's log needed it (c6235144457) |
| 10-17 14:34 to 15:15 | job logs and their stdout and stderr files in that directory | launchd and the stub | planned | every cell |
| 10-17 14:50:16 | the m2-absent directory in that directory | launchd | planned (Q-m2) | the cell |
| 10-17, about 14:41 by the relay | Script Editor allowed in the Personal Focus | the owner | **unplanned** | Q-k. Kept by the owner's choice (c6235698883) |
| 10-17 15:15:49 | `~/Library/LaunchAgents/com.williacj.rigger-spike.744.l.plist` | spike engineer | planned, batch 3 | Q-l |
| 10-17 15:15:49 | a Background Items and Login Items record | macOS | planned as a cell (Q-k3) | the bootstrap from `~/Library/LaunchAgents` |
| 10-17 | the owner's Q-j directory and its two output files | the owner | planned | Q-j |
| 10-17 to 10-21 | a lingering `codex exec` process, pid 20080 | the owner's Q-j2 run | **unplanned** | unexplained; ended by the reboot |
| 10-17 16:40:54 | state-before-reboot.md in the log directory | spike engineer | planned (U4.3) | the state before the reboot |
| 10-21 17:31:26 | batch4.txt in the log directory | coordinator | **unplanned** as a file | batch 4's transcript |
| 10-21 17:31:39 | `rm` of the `l` plist | coordinator | planned, batch 4 | cleanup |
| 10-17 to 10-24 | comments on #744 | spike engineer and coordinator | planned | approvals, relays and the report |
| 10-24 22:1x to 10-25 01:32 | a clone with its own `TMPDIR` under `<scratch>`, a second fresh clone of the report's branch, `npm ci` in each, and lines in the suite slot's log | report writer | **unplanned** before 2026-10-24 | the Q-e2 re-runs, and this report |

## Cleanup

| What | State | Why |
|---|---|---|
| `~/Library/Logs/rigger-spike-744/` and every file in it | **kept** | The only surviving evidence (`U51`). The planned `rmdir` does not run |
| `~/Library/LaunchAgents/com.williacj.rigger-spike.744.l.plist` | **removed** at 2026-10-21T17:31:39Z | `ls -la ~/Library/LaunchAgents` afterwards lists no spike plist (batch4.txt) |
| the Login Items entry for `l` | **unknown** | Not checked since the plist went |
| the Script Editor allowance in the Personal Focus | **kept** | The owner's choice |
| the owner's Q-j directory | **kept** | The owner's |
| the original scratch directory | **gone** | Not removed by the spike ("What was lost") |
| the report writer's clone under `<scratch>` | **kept** | Until this report's pull request merges |

The `~/Library/LaunchAgents` listing after the removal, from batch4.txt, its command and output
verbatim:

```
$ ls -la /Users/cjwilliams/Library/LaunchAgents  [17:31:39Z]
total 48
drwx------@  8 cjwilliams  staff   256 Oct 21 12:31 .
drwx------@ 92 cjwilliams  staff  2944 Sep 18 13:16 ..
-rw-r--r--@  1 cjwilliams  staff  1736 Aug 19 15:45 com.cowrite.harness-engine.plist
-rw-r--r--@  1 cjwilliams  staff  2273 Aug 19 15:45 com.cowrite.harness-watchdog.plist
-rw-r--r--@  1 cjwilliams  staff   877 Aug  4 13:30 com.google.GoogleUpdater.wake.plist
-rw-r--r--@  1 cjwilliams  staff   181 Aug  4 13:30 com.google.keystone.agent.plist
-rw-r--r--@  1 cjwilliams  staff   181 Aug  4 13:30 com.google.keystone.xpcservice.plist
-rw-r--r--@  1 cjwilliams  staff   876 Jul  6 11:33 com.microsoft.EdgeUpdater.wake.plist
```

Every file kept outside scratch, listed on 2026-10-25 by
`ls -la ~/Library/Logs/rigger-spike-744 ~/Library/Logs/rigger-spike-744/m2-absent ~/rigger-spike-744-qj`.
The log directory and the m2-absent directory are kept as evidence (`U51`). The Q-j directory is
the owner's.

```
/Users/cjwilliams/Library/Logs/rigger-spike-744:
total 288
drwxr-xr-x@ 65 cjwilliams  staff   2080 Oct 21 12:31 .
drwx------+ 21 cjwilliams  staff    672 Oct 17 09:34 ..
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:51 a1.err
-rw-r--r--@  1 cjwilliams  staff   3890 Oct 17 10:07 a1.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:51 a1.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 a2.err
-rw-r--r--@  1 cjwilliams  staff   4119 Oct 17 10:07 a2.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 a2.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 a3.err
-rw-r--r--@  1 cjwilliams  staff   1386 Oct 17 10:07 a3.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 a3.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 b10.err
-rw-r--r--@  1 cjwilliams  staff   3927 Oct 17 09:52 b10.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 b10.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 b30.err
-rw-r--r--@  1 cjwilliams  staff   1386 Oct 17 09:52 b30.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 b30.out
-rw-r--r--@  1 cjwilliams  staff   4425 Oct 21 12:31 batch4.txt
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 c0.err
-rw-r--r--@  1 cjwilliams  staff    229 Oct 17 09:50 c0.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 c0.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 c1.err
-rw-r--r--@  1 cjwilliams  staff   3893 Oct 17 09:52 c1.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 c1.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:07 d1.err
-rw-r--r--@  1 cjwilliams  staff   2455 Oct 17 10:08 d1.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:07 d1.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:08 d2.err
-rw-r--r--@  1 cjwilliams  staff   1180 Oct 17 10:08 d2.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:08 d2.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:12 d3n.err
-rw-r--r--@  1 cjwilliams  staff   8986 Oct 17 10:13 d3n.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:12 d3n.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:09 d3t.err
-rw-r--r--@  1 cjwilliams  staff  10890 Oct 17 10:10 d3t.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:09 d3t.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:13 d4n.err
-rw-r--r--@  1 cjwilliams  staff   8875 Oct 17 10:15 d4n.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:13 d4n.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:10 d4t.err
-rw-r--r--@  1 cjwilliams  staff  10779 Oct 17 10:11 d4t.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:10 d4t.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 f1.err
-rw-r--r--@  1 cjwilliams  staff   1032 Oct 17 09:50 f1.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 f1.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 f2.err
-rw-r--r--@  1 cjwilliams  staff   1211 Oct 17 09:50 f2.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 f2.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:34 k.err
-rw-r--r--@  1 cjwilliams  staff   5752 Oct 17 09:49 k.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:34 k.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:15 l.err
-rw-r--r--@  1 cjwilliams  staff    451 Oct 21 12:30 l.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 10:15 l.out
-rw-r--r--   1 cjwilliams  staff     20 Oct 17 09:50 m1.err
-rw-r--r--@  1 cjwilliams  staff    231 Oct 17 09:50 m1.jsonl
-rw-r--r--   1 cjwilliams  staff     20 Oct 17 09:50 m1.out
drwxr--r--   4 cjwilliams  staff    128 Oct 17 09:50 m2-absent
-rw-r--r--@  1 cjwilliams  staff    231 Oct 17 09:50 m2.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 n1.err
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 n1.out
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 n2.err
-rw-r--r--@  1 cjwilliams  staff    229 Oct 17 09:50 n2.jsonl
-rw-r--r--   1 cjwilliams  staff      0 Oct 17 09:50 n2.out
-rw-r--r--@  1 cjwilliams  staff   6581 Oct 17 11:40 state-before-reboot.md

/Users/cjwilliams/Library/Logs/rigger-spike-744/m2-absent:
total 16
drwxr--r--   4 cjwilliams  staff   128 Oct 17 09:50 .
drwxr-xr-x@ 65 cjwilliams  staff  2080 Oct 21 12:31 ..
-rw-r--r--   1 cjwilliams  staff    20 Oct 17 09:50 m2.err
-rw-r--r--   1 cjwilliams  staff    20 Oct 17 09:50 m2.out

/Users/cjwilliams/rigger-spike-744-qj:
total 88
drwxr-xr-x@  4 cjwilliams  staff    128 Oct 17 10:19 .
drwxr-x---+ 49 cjwilliams  staff   1568 Oct 24 20:31 ..
-rw-r--r--@  1 cjwilliams  staff  37887 Oct 17 10:19 claude-qj.out
-rw-r--r--@  1 cjwilliams  staff   1853 Oct 17 18:46 codex-qj.out
```

- **Loaded at the end:** `launchctl print gui/501 | grep com.williacj.rigger-spike.744.` found
  nothing at 2026-10-21T17:31:39Z (exit 1, batch4.txt). The same filter with `grep -c` printed 0 on
  2026-10-24.
- **Classifier or hook refusals:** none is recorded in any surviving comment or file. The transcript
  that would have quoted one is lost, and U55 waives the item.
- **Shells.** No plist's `ProgramArguments` runs a shell, and no surviving command runs a shell's
  `-c`. The Q-j agents' own tool calls ran `/bin/zsh -c` and `/bin/zsh -lc` inside the owner's runs;
  those are the CLIs' shells, not commands of this transcript. The lost batch 1 to 3 commands cannot
  be checked, and U55 waives that half.
- **`rigger doctor` and the install.** The state file says no `rigger doctor` ran, and no cell used
  the install under `<scratch>/install`. No job ran Rigger, and no surviving record holds
  `rigger run` or `rigger once`. The lost transcript cannot be checked for either, and U55 waives the
  two items that rest on it, along with the item that every bootout named a loaded label.

## What this report could not settle

U53 carries every one of these but the last to card #951, the re-run on the Mac mini, and U55 adds
the bootstrap times.

- Q-n1, Q-n2, Q-o1 and Q-o2 are lost.
- Whether a banner shows, under a Focus or with none, is unmeasured (`U52`), as is Q-k2 with
  notifications turned off for the posting app.
- The auth.json path Codex reports is unmeasured.
- The exact bootstrap time of Q-a1 and Q-a2 is lost. Their first starts are bounded above, not timed
  from the bootstrap. [U55](https://github.com/williacj/rigger/issues/740#issuecomment-6398146653) adds both to #951.
- Whether removing the plist removes its Login Items entry is unmeasured.

## Outside this card's acceptance

By the owner's [U54](https://github.com/williacj/rigger/issues/740#issuecomment-6391560988), none of these becomes a card unless it recurs.

1. **Spike evidence kept in a worktree directory was lost**, and with it four cells and four
   acceptance items. Who removed the directory, under what rule, is not established.
2. **A `codex exec` process lived on after its run had reported its exit status**, with parent pid 1
   and a defunct child (c6250134644). Not root-caused.
3. **An agent under `claude -p` with Bash tried to attach `lldb` to its own CLI process** to force an
   exit code, and only macOS's refusal stopped it (Q-j1).

## Appendix: the stub and every plist

Copied verbatim from the batch plan, c6234435304, host paths included, since a plist with a
placeholder in a path is no longer a valid plist. Each of the 22 plists below, extracted from this
page, passes `plutil -lint`, and the stub passes `node --check` and is byte-identical to the batch
plan's. The files the jobs ran from are gone, so these texts cannot be compared byte for byte with
what was bootstrapped. Every job log agrees with its plist's mode and arguments, and batch4.txt shows
the `l` job's arguments as its plist gives them. The `a4` plist was never bootstrapped, because Q-a4
was left out, and `k` ran in batch 2.

### Every plist, in full

#### com.williacj.rigger-spike.744.a1

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.a1</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a1.jsonl</string>
		<string>--cell</string>
		<string>a1</string>
		<string>--mode</string>
		<string>exit0</string>
	</array>
	<key>RunAtLoad</key>
	<false/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a1.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a1.out</string>
	<key>StartInterval</key>
	<integer>60</integer>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.a2

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.a2</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a2.jsonl</string>
		<string>--cell</string>
		<string>a2</string>
		<string>--mode</string>
		<string>exit0</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a2.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a2.out</string>
	<key>StartInterval</key>
	<integer>60</integer>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.a3

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.a3</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a3.jsonl</string>
		<string>--cell</string>
		<string>a3</string>
		<string>--mode</string>
		<string>run</string>
		<string>--seconds</string>
		<string>150</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a3.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a3.out</string>
	<key>StartInterval</key>
	<integer>60</integer>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.a4

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.a4</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a4.jsonl</string>
		<string>--cell</string>
		<string>a4</string>
		<string>--mode</string>
		<string>exit0</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a4.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/a4.out</string>
	<key>StartInterval</key>
	<integer>60</integer>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.b10

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>KeepAlive</key>
	<true/>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.b10</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/b10.jsonl</string>
		<string>--cell</string>
		<string>b10</string>
		<string>--mode</string>
		<string>exit0</string>
	</array>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/b10.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/b10.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.b30

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>KeepAlive</key>
	<true/>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.b30</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/b30.jsonl</string>
		<string>--cell</string>
		<string>b30</string>
		<string>--mode</string>
		<string>exit0</string>
	</array>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/b30.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/b30.out</string>
	<key>ThrottleInterval</key>
	<integer>30</integer>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.c0

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.c0</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/c0.jsonl</string>
		<string>--cell</string>
		<string>c0</string>
		<string>--mode</string>
		<string>exit0</string>
	</array>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/c0.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/c0.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.c1

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.c1</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/c1.jsonl</string>
		<string>--cell</string>
		<string>c1</string>
		<string>--mode</string>
		<string>exit1</string>
	</array>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/c1.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/c1.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.d1

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ExitTimeOut</key>
	<integer>20</integer>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.d1</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d1.jsonl</string>
		<string>--cell</string>
		<string>d1</string>
		<string>--mode</string>
		<string>outlive</string>
		<string>--seconds</string>
		<string>120</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d1.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d1.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.d2

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.d2</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d2.jsonl</string>
		<string>--cell</string>
		<string>d2</string>
		<string>--mode</string>
		<string>outlive</string>
		<string>--seconds</string>
		<string>120</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d2.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d2.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.d3n

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ExitTimeOut</key>
	<integer>20</integer>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.d3n</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d3n.jsonl</string>
		<string>--cell</string>
		<string>d3n</string>
		<string>--mode</string>
		<string>child-group</string>
		<string>--seconds</string>
		<string>5</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d3n.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d3n.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.d3t

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ExitTimeOut</key>
	<integer>20</integer>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.d3t</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d3t.jsonl</string>
		<string>--cell</string>
		<string>d3t</string>
		<string>--mode</string>
		<string>child-group</string>
		<string>--seconds</string>
		<string>0</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d3t.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d3t.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.d4n

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ExitTimeOut</key>
	<integer>20</integer>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.d4n</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d4n.jsonl</string>
		<string>--cell</string>
		<string>d4n</string>
		<string>--mode</string>
		<string>child-own</string>
		<string>--seconds</string>
		<string>5</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d4n.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d4n.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.d4t

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ExitTimeOut</key>
	<integer>20</integer>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.d4t</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d4t.jsonl</string>
		<string>--cell</string>
		<string>d4t</string>
		<string>--mode</string>
		<string>child-own</string>
		<string>--seconds</string>
		<string>0</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d4t.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/d4t.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.f1

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.f1</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/f1.jsonl</string>
		<string>--cell</string>
		<string>f1</string>
		<string>--mode</string>
		<string>probe</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/f1.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/f1.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.f2

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>HOME</key>
		<string>/Users/cjwilliams</string>
		<key>PATH</key>
		<string>/Users/cjwilliams/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
	</dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.f2</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/f2.jsonl</string>
		<string>--cell</string>
		<string>f2</string>
		<string>--mode</string>
		<string>probe</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/f2.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/f2.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.k

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.k</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/k.jsonl</string>
		<string>--cell</string>
		<string>k</string>
		<string>--mode</string>
		<string>notify</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/k.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/k.out</string>
	<key>StartInterval</key>
	<integer>60</integer>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.l

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.l</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/l.jsonl</string>
		<string>--cell</string>
		<string>l</string>
		<string>--mode</string>
		<string>exit0</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/l.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/l.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.m1

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.m1</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/m1.jsonl</string>
		<string>--cell</string>
		<string>m1</string>
		<string>--mode</string>
		<string>streams</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/m1.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/m1.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.m2

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.m2</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/node</string>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/m2.jsonl</string>
		<string>--cell</string>
		<string>m2</string>
		<string>--mode</string>
		<string>streams</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/m2-absent/m2.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/m2-absent/m2.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.n1

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.n1</string>
	<key>ProgramArguments</key>
	<array>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/n1-absent.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/n1.jsonl</string>
		<string>--cell</string>
		<string>n1</string>
		<string>--mode</string>
		<string>exit0</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/n1.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/n1.out</string>
</dict>
</plist>
```


#### com.williacj.rigger-spike.744.n2

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.williacj.rigger-spike.744.n2</string>
	<key>ProgramArguments</key>
	<array>
		<string>/Users/cjwilliams/GitHub/rigger-worktrees/744-spike-engineer/jobs/n2-stub.mjs</string>
		<string>--log</string>
		<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/n2.jsonl</string>
		<string>--cell</string>
		<string>n2</string>
		<string>--mode</string>
		<string>exit0</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/n2.err</string>
	<key>StandardOutPath</key>
	<string>/Users/cjwilliams/Library/Logs/rigger-spike-744/n2.out</string>
	<key>StartInterval</key>
	<integer>60</integer>
</dict>
</plist>
```


### The stub, in full

#### jobs/stub.mjs

```js
#!/opt/homebrew/bin/node
// ABOUTME: Spike 744's throwaway launchd stub. It logs its start, pid, process group, every signal and its
// exit as JSON lines, then behaves as its mode says. It never runs Rigger and spawns only directly.
import { appendFileSync, existsSync } from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const log = opt('log');
const cell = opt('cell', 'unnamed');
const mode = opt('mode', 'exit0');
const seconds = Number(opt('seconds', '0'));
const role = opt('role', 'job');

const pgidOf = (pid) => {
  try { return Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim()); }
  catch { return null; }
};
const write = (event, extra = {}) => {
  appendFileSync(log, `${JSON.stringify({ t: new Date().toISOString(), cell, role, event, pid: process.pid, ...extra })}\n`);
};

const SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2', 'SIGALRM'];
const listen = (onTerm) => {
  for (const name of SIGNALS) process.on(name, () => { write('signal', { signal: name }); if (name === 'SIGTERM' && onTerm) onTerm(); });
};
process.on('exit', (code) => write('exit', { code }));

// Spawns `command` directly, with no shell, and keeps only what the cell may record.
const probe = (command, argv, keep) => {
  const r = spawnSync(command, argv, { encoding: 'utf8', timeout: 30_000 });
  if (r.error) return { command, error: r.error.code ?? String(r.error) };
  return { command, status: r.status, signal: r.signal, ...keep(r.stdout ?? '', r.stderr ?? '') };
};
const firstLine = (s) => { const lines = s.split('\n').map((l) => l.trim()).filter(Boolean); return lines.find((l) => /logged in|not logged|log in|login|token|error/i.test(l)) ?? lines[0] ?? ''; };
const elide = (s) => s.replace(/gh[opsu]_[A-Za-z0-9_]+/g, '<elided>').replace(/sk-ant-[A-Za-z0-9_-]+/g, '<elided>');
const loggedIn = (s) => { try { return { loggedIn: JSON.parse(s).loggedIn }; } catch { return { loggedIn: 'unparsed' }; } };

write('start', { ppid: process.ppid, pgid: pgidOf(process.pid), mode, seconds });

const heartbeat = () => setInterval(() => write('beat'), 1000);
const hold = (s, then) => setTimeout(then, s * 1000);

switch (mode) {
  case 'exit0': process.exit(0);
  case 'exit1': process.exit(1);
  case 'run': listen(); hold(seconds, () => process.exit(0)); break;
  case 'outlive': { // SIGTERM is logged and outlived: the stub keeps beating for `seconds` more.
    const beat = heartbeat();
    listen(() => hold(seconds, () => { clearInterval(beat); process.exit(0); }));
    hold(600, () => process.exit(0));
    break;
  }
  case 'child-group': case 'child-own': { // A child in the job's group, or in a group of its own.
    const child = spawn(process.execPath, [process.argv[1], '--log', log, '--cell', cell, '--mode', 'child', '--seconds', '90', '--role', 'child'],
      { detached: mode === 'child-own', stdio: 'ignore' });
    child.unref();
    write('spawned', { child: child.pid });
    const beat = heartbeat();
    if (seconds > 0) { listen(); hold(seconds, () => { clearInterval(beat); process.exit(0); }); }
    else { listen(() => hold(60, () => { clearInterval(beat); process.exit(0); })); hold(600, () => process.exit(0)); }
    break;
  }
  case 'child': { // Bounded: it ends itself after `seconds`, whatever happens to its parent.
    write('child-start', { ppid: process.ppid, pgid: pgidOf(process.pid) });
    const beat = heartbeat();
    listen();
    hold(seconds, () => { clearInterval(beat); process.exit(0); });
    break;
  }
  case 'streams': process.stdout.write(`stdout line from ${cell}\n`); process.stderr.write(`stderr line from ${cell}\n`); process.exit(0);
  case 'probe': { // Read-only status probes, each by bare name on the job's PATH and by absolute path.
    const env = { PATH: process.env.PATH ?? null, HOME: process.env.HOME ?? null, USER: process.env.USER ?? null, CODEX_HOME: process.env.CODEX_HOME ?? null, cwd: process.cwd() };
    write('env', env);
    const codexHome = process.env.CODEX_HOME ?? (process.env.HOME ? join(process.env.HOME, '.codex') : null);
    const results = [];
    for (const [bare, absolute] of [['gh', '/opt/homebrew/bin/gh'], ['claude', '/Users/cjwilliams/.local/bin/claude'], ['codex', '/opt/homebrew/bin/codex']]) {
      for (const command of [bare, absolute]) {
        if (bare === 'gh') results.push(probe(command, ['auth', 'status'], (o, e) => ({ firstLine: elide(firstLine(o + e)) })));
        if (bare === 'claude') results.push(probe(command, ['auth', 'status', '--json'], (o) => loggedIn(o)));
        if (bare === 'codex') results.push(probe(command, ['login', 'status'], (o, e) => ({ firstLine: elide(firstLine(o + e)) })));
      }
    }
    write('probes', { results, codexHome, authJsonExists: codexHome ? existsSync(join(codexHome, 'auth.json')) : null });
    process.exit(0);
  }
  case 'notify': {
    const at = new Date().toISOString().slice(11, 19);
    const r = spawnSync('/usr/bin/osascript', ['-e', `display notification "Q-${cell} at ${at} UTC" with title "Rigger spike 744"`], { encoding: 'utf8' });
    write('notified', { status: r.status, stderr: r.stderr?.trim() ?? '', shownAs: at });
    process.exit(0);
  }
  default: write('unknown-mode'); process.exit(2);
}
```


