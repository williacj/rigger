ABOUTME: Spike findings for card #1430: whether cgroup v2 under WSL2 and Job Objects on Windows end an
agent's whole process tree, measured against the macOS baseline and today's route.

# Whole-tree containment on Linux under WSL2 and on Windows

## The answer

On Linux under WSL2, the answer is yes. An unprivileged supervisor obtained a cgroup it could write
to from the systemd user manager, with no root. Writing cgroup.kill ended all six fixture
members, including the two that left the session and the one that moved to `/`. The cgroup reported
no live process 1.66 ms after the write, in both runs that measured it. When the supervisor was
killed outright, all six members lived on in the orphaned cgroup. A fresh process that wrote
cgroup.kill to that cgroup ended every one of them.

On native Windows, the answer is also yes, with one condition. A Node supervisor reached Job Objects
through koffi, an FFI package with a prebuilt binary. Every member it started, M1 to M4 and M6, was
in its job. `TerminateJobObject` ended all of them. With kill-on-job-close set, killing the
supervisor with `taskkill /F` ended every member too. Without kill-on-job-close, every member
outlived the supervisor. A fresh process could not then reach the job, because its name disappeared
with the supervisor's last handle. The condition is that this supervisor ran elevated (High
Mandatory Level). A non-elevated supervisor was not measured.

Today's route (`R-STATE-17`) left M6 alive on both macOS and Linux. M6 is the member that starts a
new session and changes its working directory to `/`. The group kill and the working-directory
census found every other member. On macOS, the process-group kill alone also left M3 alive, the
member that starts a new session. Killing the supervisor outright left every member alive on macOS,
as `R-STATE-9` and `R-STATE-10` expect.

I recommend a delegated cgroup ended by cgroup.kill for Linux under WSL2, and a Job Object with
kill-on-job-close for native Windows. Both are under "Recommendations", with what would reverse
each. This report hands over evidence. It changes no code, requirement or recorded decision.

## What ran, and where

| Run | Host | Ending | Route the supervisor was started by |
|---|---|---|---|
| m1 | laptop (macOS) | E1, process-group kill | `docs/spikes/whole-tree-containment/runners/mac-run.sh`, run locally on the laptop |
| m2 | laptop | E1c, today's route | the same |
| m3 | laptop | E2, `kill -9` of the supervisor | the same |
| w1, w7 | WSL2 | E1, cgroup.kill | `ssh hostpc wsl.exe -e bash -s` ran `docs/spikes/whole-tree-containment/runners/wsl-run.sh` inside WSL. That started the supervisor inside WSL as a transient systemd user service (`systemd-run --user`) |
| w2 | WSL2 | E1c, today's route | the same |
| w5 | WSL2 | E2, `kill -9` of the supervisor, then a fresh cgroup.kill writer | the same |
| w3 | WSL2 | E2, a first attempt | the same. Its fresh-writer loop ran on after the cgroup was removed (under "What failed"). w5 replaced it |
| w6 | WSL2 | E2 with systemd's default `KillMode` (supplementary) | the same |
| x1, x2 | Windows | E1, `TerminateJobObject` | `ssh hostpc` ran `node win-run.cjs` in the SSH session. That started the supervisor detached |
| x3 | Windows | E2, `taskkill /F`, kill-on-job-close set | the same |
| x4 | Windows | E2, `taskkill /F`, kill-on-job-close not set, then a fresh process's reach | the same |

WSL was reached only through `ssh hostpc wsl.exe -e …`, because `wsl-hostpc` did not answer. In every
WSL run, the process that launched the tree, the Node supervisor, lived inside WSL. It was a child
of the user's systemd manager (pid 339), as each listing's parent pid column shows. It was never a
Windows process.

`docs/spikes/whole-tree-containment/` holds the evidence:

- `docs/spikes/whole-tree-containment/transcript.txt`, the full transcript.
- `docs/spikes/whole-tree-containment/fixture/`, the fixture source for macOS and Linux.
- `docs/spikes/whole-tree-containment/fixture-win/`, the fixture source for Windows.
- `docs/spikes/whole-tree-containment/runners/`, the scripts that drove the runs.

## Hosts and versions

Each value below is quoted from the command that printed it. Every command is in
`docs/spikes/whole-tree-containment/transcript.txt` at the time given.

| Host | Operating system | Kernel | Node |
|---|---|---|---|
| Laptop (00:41:03Z) | `sw_vers`: `ProductName: macOS`, `ProductVersion: 27.2.1`, `BuildVersion: 26B131` | `uname -a`: `Darwin Kernel Version 27.2.0 … RELEASE_ARM64_T6041 arm64` | `node --version`: `v26.13.0` |
| WSL2 machine (00:41:04Z, 00:41:39Z) | `/etc/os-release`: `PRETTY_NAME="Ubuntu 26.04.1 LTS"` | `uname -r`: `6.18.58.1-microsoft-standard-WSL2` | `node --version`: `v24.19.0`, the official linux-x64 tarball unpacked in the spike's own directory |
| Windows machine (00:41:04Z) | `ver`: `Microsoft Windows [Version 10.0.26300.9974]` | none separate from the OS build | `node --version`: `v24.19.0` |

Other tools the runs used: `lsof` 4.91 on macOS and 4.99.4 on Ubuntu, perl 5.40.1 on Ubuntu, systemd
259 (259.5-0ubuntu3.4), npm 11.17.0 on Windows, and koffi 3.3.8.

## The fixture

The fixture is one process tree started in a dispatch directory the spike made: `mac/d-<run>` in
the laptop's spike directory, `~/1430-spike-engineer/d-<run>` in WSL, and
`C:\Users\user\1430-spike-engineer\d-<run>` on Windows. Each member sleeps 300 s unless ended. On
macOS and Linux, `argv[0]` is `fx-<run>-M<n>`. On Windows, the command line carries
`fx1430-<run>-M<n>`.

### How each member was started

| Member | macOS and Linux (`docs/spikes/whole-tree-containment/fixture/fixture.sh`, run by `bash` as the supervised command) | Windows (`docs/spikes/whole-tree-containment/fixture-win/fixture-win.cjs`, run by `node` as the supervised command) |
|---|---|---|
| M1 | `bash -c "(exec -a fx-R-M2 sleep 300) & exec -a fx-R-M1 sleep 300" &`: a direct child of the supervised command | `spawn(node, [member-win.cjs, …-M1, 'M1'])`: a direct child |
| M2 | the subshell M1 forks before it execs, a grandchild whose parent is M1 | M1 runs `spawn(node, [member-win.cjs, …-M2, 'leaf'])`, a grandchild whose parent is M1 |
| M3 | `perl -MPOSIX -e 'POSIX::setsid(); exec {"sleep"} "fx-R-M3", "300"' &`: a new session | `spawn(node, […-M3], { detached: true })`. libuv's src/win/process.c (read at `v1.51.0`) makes this `DETACHED_PROCESS \| CREATE_NEW_PROCESS_GROUP`, a new process group |
| M4 | `bash -c "(exec -a fx-R-M4 sleep 300) & exit 0" &`: its parent exits at once, so it is reparented | `cmd.exe /d /c start "" /b node member-win.cjs …-M4 leaf`. Its parent cmd.exe exits at once |
| M5 | `bash -c "trap '' TERM; exec -a fx-R-M5 sleep 300" &`: `SIGTERM` is ignored, and `SIG_IGN` survives `exec` | not applicable: `TerminateProcess` cannot be ignored |
| M6 | `perl -MPOSIX -e 'POSIX::setsid(); chdir "/"; exec {"sleep"} "fx-R-M6", "300"' &`: a new session working in `/` | `spawn(node, […-M6, 'M6'], { detached: true })`. The member runs `process.chdir()` to the drive root, `C:\` |

The supervised command waits on stdin for one line before it starts any member. The supervisor moves
it into the cgroup or job first, and then writes the line. That closes the race between spawning
and assigning. Every supervisor spawned the supervised command with `detached: true`, as
`runCommand` in `src/substrate/process.mjs` does, so that command leads a process group of its own.

### The supervisors

- **macOS and Linux:** `fixture/supervisor.cjs <e1|e1c|e2> <run> <dispatch> <fixture-dir>`.
  - On Linux, it reads its own cgroup from `/proc/self/cgroup` and creates a child cgroup `tree`
    under it. It writes the supervised command's pid into tree/cgroup.procs.
  - E1 on Linux writes `1` to tree/cgroup.kill. It then polls tree/cgroup.events every 1 ms
    until it reads `populated 0`.
  - E1 on macOS sends `SIGKILL` to the process group.
  - E1c, on both, sends `SIGKILL` to the process group. It then runs
    `lsof -w -n -P -a -d cwd -u <uid> -F pun`, the argument list `listing` in
    `src/substrate/process.mjs` builds, and sends `SIGKILL` to every pid whose working directory
    lies under the dispatch directory's real path.
  - It lists 3 s after the start and 12 s after the ending.
- **Windows:** `fixture-win/supervisor-win.cjs <e1|e2k|e2n> fx1430-<run>-sup <dispatch>`.
  - It creates a job named `Local\fx1430-<run>` with `CreateJobObjectW`. For e1 and e2k, it sets
    `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` with `SetInformationJobObject(JobObjectExtendedLimitInformation)`.
    For e2n it leaves the limit unset.
  - It assigns the supervised command with `AssignProcessToJobObject`.
  - E1 calls `TerminateJobObject`. It then polls `JobObjectBasicAccountingInformation.ActiveProcesses`
    until the count is 0.
  - It lists 5 s after the start and 12 s after the ending.
- **The listings:**
  - `docs/spikes/whole-tree-containment/fixture/list.sh` uses `ps` for pid, parent pid, group and state, and os.getsid for the
    session. It takes the working directory from `/proc/<pid>/cwd` on Linux and from `lsof -d cwd`
    on macOS, and the cgroup from `/proc/<pid>/cgroup` on Linux.
  - `docs/spikes/whole-tree-containment/fixture-win/win32.cjs` uses `Win32_Process` for pid, parent pid and session. It calls
    `IsProcessInJob` against the spike's job and against any job. It reads the working directory
    from the process's PEB (`RTL_USER_PROCESS_PARAMETERS.CurrentDirectory`).

## Linux under WSL2

### The user, cgroup v2, systemd and cgroup.kill

**The user (w7, transcript entry 01:01:51Z).** The unit's `ExecStart` ran `id`, and then `exec`ed into the Node
supervisor in the same process. It printed:

```
uid=1000(user) gid=1000(user) groups=1000(user),4(adm),24(cdrom),27(sudo),30(dip),46(plugdev),100(users)
```

Runs w1 to w6 started the supervisor the same way, without the `id` prefix. Their runner printed the
same `id` line. The supervisor ran as the unprivileged user `user`, not root. The user is in `sudo`,
but nothing used it.

**cgroup v2 is mounted, and the unified hierarchy is in use (00:41:17Z).** `mount | grep cgroup`
printed one line, a `cgroup2` mount at `/sys/fs/cgroup` and no v1 hierarchy:

```
cgroup2 on /sys/fs/cgroup type cgroup2 (rw,nosuid,nodev,noexec,relatime,nsdelegate)
```

`cat /sys/fs/cgroup/cgroup.controllers` printed `cpuset cpu io memory hugetlb pids rdma`. At
00:41:04Z, `stat -fc %T /sys/fs/cgroup` printed `cgroup2fs`.

**systemd runs as pid 1 (00:41:04Z).** `ps -p 1 -o pid,comm` printed:

```
    PID COMMAND
      1 systemd
```

At 00:41:17Z, `systemctl is-system-running` printed `running`, and `systemctl --user is-system-running`
also printed `running`. `loginctl show-user user` showed `Service=user@1000.service` and `State=active`.

**cgroup.kill exists (00:41:17Z).** `ls /sys/fs/cgroup` listed cgroup.kill at the root.
`ls -l /sys/fs/cgroup/non-systemd` showed `--w------- 1 root root 0 Nov 19 18:41 cgroup.kill`. The
delegated cgroup in the next item holds a cgroup.kill owned by `user`.

**An unprivileged user can obtain a writable cgroup subtree, through the systemd user manager
(00:42:55Z).** Two routes worked, and the runs used the second:

```
$ systemd-run --user --scope -p Delegate=yes cat /proc/self/cgroup
Running as unit: run-p511-i2417.scope; invocation ID: f03feebebecb4105b3116a22f05c16e8
0::/user.slice/user-1000.slice/user@1000.service/app.slice/run-p511-i2417.scope
$ systemd-run --user --wait --pipe -q -p Delegate=yes bash -c "cat /proc/self/cgroup; c=$(cut -d: -f3 /proc/self/cgroup); ls -l /sys/fs/cgroup$c | grep -E \"procs|kill|subtree\"; id"
0::/user.slice/user-1000.slice/user@1000.service/app.slice/run-p512-i2418.service
--w------- 1 user user 0 Nov 19 18:42 cgroup.kill
-rw-r--r-- 1 user user 0 Nov 19 18:42 cgroup.procs
-rw-r--r-- 1 user user 0 Nov 19 18:42 cgroup.subtree_control
uid=1000(user) gid=1000(user) groups=1000(user),4(adm),24(cdrom),27(sudo),30(dip),46(plugdev),100(users)
```

The shell that `wsl.exe -e` starts is not in systemd's tree. Its `/proc/self/cgroup` read
`0::/non-systemd` at 00:41:04Z, a root-owned cgroup it cannot write to. The scope route moved even
that process into a unit of the user manager. The service route starts the process inside the
unit. Neither needed root, so the root route was not measured.

### Before any ending

```
listing run=w1 at 2026-11-20T00:48:40Z on Linux
PID     PPID    PGID    SID     STAT  CWD | CGROUP | ARGS
1834    339     1834    1834    Ssl   /home/user/1430-spike-engineer | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w1.service | /home/user/1430-spike-engineer/node-v24.19.0-linux-x64/bin/node /home/user/1430-spike-engineer/fixture/supervisor.cjs e1 w1 /home/user/1430-spike-engineer/d-w1 /home/user/1430-spike-engineer/fixture
1844    1834    1844    1844    Ss    /home/user/1430-spike-engineer/d-w1 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w1.service/tree | bash /home/user/1430-spike-engineer/fixture/fixture.sh w1
1845    1844    1844    1844    S     /home/user/1430-spike-engineer/d-w1 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w1.service/tree | fx-w1-M1 300
1846    1844    1846    1846    Ss    /home/user/1430-spike-engineer/d-w1 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w1.service/tree | fx-w1-M3 300
1848    1844    1844    1844    S     /home/user/1430-spike-engineer/d-w1 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w1.service/tree | fx-w1-M5 300
1849    1844    1849    1849    Ss    / | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w1.service/tree | fx-w1-M6 300
1850    1845    1844    1844    S     /home/user/1430-spike-engineer/d-w1 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w1.service/tree | fx-w1-M2 300
1851    339     1844    1844    S     /home/user/1430-spike-engineer/d-w1 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w1.service/tree | fx-w1-M4 300
count=8
```

The fixture root, 1844, is the supervised command. M3 (1846) and M6 (1849) lead sessions of their
own. M4 (1851) was reparented to the user manager, 339. Every member is in the `tree` cgroup.

### E1, cgroup.kill (w1)

The supervisor wrote `1` to tree/cgroup.kill at 00:48:40.761Z. It logged `E1 cgroup.kill written;
cgroup.events populated 0 after 1.66 ms`, and w7 logged the same figure, 1.66 ms. That is a
measurement: two samples, each taken by the supervisor's 1 ms poll of cgroup.events. Twelve
seconds after the write:

```
listing run=w1 at 2026-11-20T00:48:52Z on Linux
PID     PPID    PGID    SID     STAT  CWD | CGROUP | ARGS
1834    339     1834    1834    Ssl   /home/user/1430-spike-engineer | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w1.service | /home/user/1430-spike-engineer/node-v24.19.0-linux-x64/bin/node /home/user/1430-spike-engineer/fixture/supervisor.cjs e1 w1 /home/user/1430-spike-engineer/d-w1 /home/user/1430-spike-engineer/fixture
count=1
```

No member was alive: M1 to M6 had all ended. Only the supervisor remained, and tree/cgroup.procs
read `""`. w7 repeated this with the same result. Its listings are in the transcript entry at 01:01:51Z.

### E1c, today's route (w2)

```
listing run=w2 at 2026-11-20T00:49:01Z on Linux
PID     PPID    PGID    SID     STAT  CWD | CGROUP | ARGS
2009    339     2009    2009    Ssl   /home/user/1430-spike-engineer | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w2.service | /home/user/1430-spike-engineer/node-v24.19.0-linux-x64/bin/node /home/user/1430-spike-engineer/fixture/supervisor.cjs e1c w2 /home/user/1430-spike-engineer/d-w2 /home/user/1430-spike-engineer/fixture
2019    2009    2019    2019    Ss    /home/user/1430-spike-engineer/d-w2 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w2.service | bash /home/user/1430-spike-engineer/fixture/fixture.sh w2
2020    2019    2019    2019    S     /home/user/1430-spike-engineer/d-w2 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w2.service | fx-w2-M1 300
2021    2019    2021    2021    Ss    /home/user/1430-spike-engineer/d-w2 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w2.service | fx-w2-M3 300
2023    2019    2019    2019    S     /home/user/1430-spike-engineer/d-w2 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w2.service | fx-w2-M5 300
2024    2019    2024    2024    Ss    / | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w2.service | fx-w2-M6 300
2025    2020    2019    2019    S     /home/user/1430-spike-engineer/d-w2 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w2.service | fx-w2-M2 300
2026    339     2019    2019    S     /home/user/1430-spike-engineer/d-w2 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w2.service | fx-w2-M4 300
count=8
```

The supervisor logged:

```
2026-11-20T00:49:01.927Z E1c SIGKILL sent to process group 2019
2026-11-20T00:49:01.984Z E1c census under /home/user/1430-spike-engineer/d-w2 found and SIGKILLed 2021
```

Twelve seconds after the ending:

```
listing run=w2 at 2026-11-20T00:49:13Z on Linux
PID     PPID    PGID    SID     STAT  CWD | CGROUP | ARGS
2009    339     2009    2009    Ssl   /home/user/1430-spike-engineer | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w2.service | /home/user/1430-spike-engineer/node-v24.19.0-linux-x64/bin/node /home/user/1430-spike-engineer/fixture/supervisor.cjs e1c w2 /home/user/1430-spike-engineer/d-w2 /home/user/1430-spike-engineer/fixture
2024    339     2024    2024    Ss    / | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w2.service | fx-w2-M6 300
count=2
```

M1, M2, M4 and M5 ended with the group, and M3 (2021) ended by the census. M6 (2024) was alive. It
was neither in the group nor working under the dispatch directory.

### E2, the supervisor killed outright (w5)

The supervisor ran with `KillMode=process`, so systemd sends no signal to the rest of the unit's
cgroup when the main process dies, and nothing else acted. Before:

```
listing run=w5 at 2026-11-20T00:52:13Z on Linux
PID     PPID    PGID    SID     STAT  CWD | CGROUP | ARGS
103719  339     103719  103719  Ssl   /home/user/1430-spike-engineer | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service | /home/user/1430-spike-engineer/node-v24.19.0-linux-x64/bin/node /home/user/1430-spike-engineer/fixture/supervisor.cjs e2 w5 /home/user/1430-spike-engineer/d-w5 /home/user/1430-spike-engineer/fixture
103729  103719  103729  103729  Ss    /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | bash /home/user/1430-spike-engineer/fixture/fixture.sh w5
103730  103729  103729  103729  S     /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M1 300
103731  103729  103731  103731  Ss    /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M3 300
103733  103729  103729  103729  S     /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M5 300
103734  103729  103734  103734  Ss    / | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M6 300
103735  103730  103729  103729  S     /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M2 300
103736  339     103729  103729  S     /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M4 300
count=8
```

At 00:52:13.959Z, the runner sent `kill -9 103719`. Twelve seconds after:

```
listing run=w5 at 2026-11-20T00:52:25Z on Linux
PID     PPID    PGID    SID     STAT  CWD | CGROUP | ARGS
103729  339     103729  103729  Ss    /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | bash /home/user/1430-spike-engineer/fixture/fixture.sh w5
103730  103729  103729  103729  S     /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M1 300
103731  103729  103731  103731  Ss    /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M3 300
103733  103729  103729  103729  S     /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M5 300
103734  103729  103734  103734  Ss    / | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M6 300
103735  103730  103729  103729  S     /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M2 300
103736  339     103729  103729  S     /home/user/1430-spike-engineer/d-w5 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w5.service/tree | fx-w5-M4 300
count=7
```

M1 to M6 were all alive, still in the orphaned `tree` cgroup. systemd reported the unit as
`ActiveState=failed` with `Result=signal`.

**The fresh writer.** A new `bash`, pid 103890, which was no part of the supervisor, wrote `1` to
`…/fx1430-w5.service/tree/cgroup.kill`. It found the path from the unit's `ControlGroup` property.
It reported `tree cgroup empty or removed (exists: no) after 6019 us`. Once the cgroup emptied,
systemd removed the failed unit's cgroup, and that is why the cgroup no longer existed. Ten seconds
later:

```
listing run=w5 at 2026-11-20T00:52:36Z on Linux
PID     PPID    PGID    SID     STAT  CWD | CGROUP | ARGS
count=0
```

Every remaining member had ended. The first attempt, w3, gave the same before and after readings.
Its listing at 00:51:55Z read `count=0`.

### A supplementary reading: E2 under systemd's default `KillMode` (w6)

This run is outside the card's endings, because systemd acts in it. Under the default
`KillMode=control-group`, systemd sent `SIGTERM` to the unit's cgroup when the supervisor died.
Twelve seconds after `kill -9 103945`:

```
listing run=w6 at 2026-11-20T00:52:58Z on Linux
PID     PPID    PGID    SID     STAT  CWD | CGROUP | ARGS
103959  339     103955  103955  S     /home/user/1430-spike-engineer/d-w6 | /user.slice/user-1000.slice/user@1000.service/app.slice/fx1430-w6.service/tree | fx-w6-M5 300
count=1
```

Only M5, which ignores `SIGTERM`, was alive, and the unit was still in `stop-sigterm`. The fresh
cgroup.kill writer then ended it, and the listing 10 s later read `count=0`. A unit used as a
dispatch's container therefore needs `KillSignal=SIGKILL`, or an explicit cgroup.kill, to close M5.

## Native Windows

### The user and elevation (00:56:09Z)

`whoami` printed `host-pc10\user` at 00:41:04Z. `whoami /groups`, run in an SSH session as the user
that ran every supervisor, printed the following. The three lines below are quoted with their whitespace condensed. The full output is in the
transcript, with one account line redacted:

```
BUILTIN\Administrators                                        Alias            S-1-5-32-544   Mandatory group, Enabled by default, Enabled group, Group owner
NT AUTHORITY\Local account and member of Administrators group Well-known group S-1-5-114      Mandatory group, Enabled by default, Enabled group
Mandatory Label\High Mandatory Level                          Label            S-1-16-12288
```

The supervisor ran elevated. Windows OpenSSH gave this administrator's session a full token at
High integrity. An attempt to run a reduced token with `runas /trustlevel:0x20000` failed at
00:58:20Z with `The system cannot find the path specified.`, so no non-elevated run was made.

### Routes from Node to a Job Object

| Route | What it installs or builds | Weighed |
|---|---|---|
| **koffi** (FFI), used | `npm install koffi` added 2 packages in the spike's directory: `koffi@3.3.8` and the prebuilt @koromix/koffi-win32-x64. Nothing was compiled. npm 11.17.0 did not run koffi's install script, which was not yet covered by `allowScripts`, and the prebuilt binary loaded without it | Calls `kernel32` and `ntdll` directly from the supervisor's own process, so the job handle lives and dies with the supervisor. That is the property E2 measures. Adds a native dependency per platform |
| A node-gyp native addon | Visual Studio Build Tools with the C++ workload, and Python, on every host that builds it. It builds a .node binary | The same in-process handle as koffi, at the cost of a compiler toolchain on the host. Not built |
| A PowerShell or C# helper process (`Add-Type` P/Invoke) spawned by Node | Nothing: PowerShell ships with Windows | The job handle lives in the helper, not the supervisor, so killing the supervisor tests the helper's lifetime instead. Every call also pays a PowerShell start. Not built |

### Was Node already in a job (00:56:46Z)

Before it created a job, the supervisor called `IsProcessInJob(GetCurrentProcess(), NULL, &r)`:

```
2026-11-20T00:56:46.318Z IsProcessInJob(GetCurrentProcess(), NULL) before creating a job: returned 1, Result=TRUE (already in a job)
```

The SSH session's processes already sat in a job. After x4, with the session closed, the members x4
left had ended. That is evidence that the session's job ends its members on disconnect. Every
reading below was taken inside one SSH session, before it closed.

### Before any ending, with job membership

```
listing run=x2 at 2026-11-20T00:56:51.733Z on Windows (Win32_Process + IsProcessInJob + PEB CurrentDirectory)
PID     PPID    SESS  IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE
2652    32616   0     no           yes        C:\Users\USER\1430-spike-engineer\ | sup
30952   2652    0     yes          yes        C:\Users\USER\1430-spike-engineer\d-x2\ | root
21128   30952   0     yes          yes        C:\Users\USER\1430-spike-engineer\d-x2\ | M1
1480    30952   0     yes          yes        C:\Users\USER\1430-spike-engineer\d-x2\ | M3
36504   30952   0     yes          yes        C:\ | M6
32708   37664   0     yes          yes        C:\Users\USER\1430-spike-engineer\d-x2\ | M4
36552   21128   0     yes          yes        C:\Users\USER\1430-spike-engineer\d-x2\ | M2
count=7
```

`IN_SPIKE_JOB` is `IsProcessInJob(member, spike job)`. M1 to M4 and M6 each read `yes`, and the
supervisor reads `no`. The job's own process list also showed them, with two conhost.exe the
members started:

```
job process id list (JobObjectBasicProcessIdList): ["1304:conhost.exe(ppid 21128)","1480:node.exe(ppid 30952)","8140:conhost.exe(ppid 37664)","36504:node.exe(ppid 30952)","32708:node.exe(ppid 37664)","30952:node.exe(ppid 2652)","21128:node.exe(ppid 30952)","36552:node.exe(ppid 21128)"] accounting: {"total":9,"active":8,"terminated":0}
```

M4's parent, 37664, is the cmd.exe that had already exited. x1, x3 and x4 show the same
membership. Their listings are in the transcript at 00:56:14Z, 00:57:10Z and 00:57:33Z.

### The job's limits in each run

| Run | Logged limit line |
|---|---|
| x1, E1 | `LimitFlags=0x2000 KILL_ON_JOB_CLOSE=set` |
| x2, E1 | `LimitFlags=0x2000 KILL_ON_JOB_CLOSE=set` |
| x3, E2 with kill-on-job-close | `LimitFlags=0x2000 KILL_ON_JOB_CLOSE=set` |
| x4, E2 without kill-on-job-close | `LimitFlags=0x0000 KILL_ON_JOB_CLOSE=not set` |

Each row is read back with `QueryInformationJobObject(JobObjectExtendedLimitInformation)`. No
breakaway limit was set in any run.

### E1, `TerminateJobObject` (x2)

The supervisor logged `TerminateJobObject: ok` and then `job ActiveProcesses reached 0 after 0.24 ms`.
In x1 the same reading was 0.31 ms. Twelve seconds after:

```
listing run=x2 at 2026-11-20T00:57:04.549Z on Windows (Win32_Process + IsProcessInJob + PEB CurrentDirectory)
PID     PPID    SESS  IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE
2652    32616   0     no           yes        C:\Users\USER\1430-spike-engineer\ | sup
count=1
```

M1, M2, M3, M4 and M6 had all ended, and the job's `ActiveProcesses` read 0.

### E2 with kill-on-job-close set (x3)

The runner killed the supervisor with `taskkill /F /PID 32600` at 00:57:16.324Z, and `taskkill`
printed `SUCCESS`. Twelve seconds later, a fresh process listed:

```
listing run=x3 at 2026-11-20T00:57:28.808Z on Windows (Win32_Process + IsProcessInJob + PEB CurrentDirectory)
PID     PPID    SESS  IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE
count=0
```

M1, M2, M3, M4 and M6 had all ended. The supervisor's handle was the job's last, so closing it ended
the job. That same process's `OpenJobObjectW` returned `NULL` with `GetLastError=2`.

### E2 without kill-on-job-close (x4)

`taskkill /F /PID 2092` ran at 00:57:39.980Z. Twelve seconds later:

```
listing run=x4 at 2026-11-20T00:57:52.409Z on Windows (Win32_Process + IsProcessInJob + PEB CurrentDirectory)
PID     PPID    SESS  IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE
12972   2092    0     n/a          yes        C:\Users\USER\1430-spike-engineer\d-x4\ | root
36704   12972   0     n/a          yes        C:\Users\USER\1430-spike-engineer\d-x4\ | M1
5208    12972   0     n/a          yes        C:\Users\USER\1430-spike-engineer\d-x4\ | M3
21380   12972   0     n/a          yes        C:\ | M6
34948   12108   0     n/a          yes        C:\Users\USER\1430-spike-engineer\d-x4\ | M4
33440   36704   0     n/a          yes        C:\Users\USER\1430-spike-engineer\d-x4\ | M2
count=6
```

M1, M2, M3, M4 and M6 were all alive. `IN_ANY_JOB` still reads `yes`.

**Could a fresh process reach the orphaned job?** No. The fresh process, pid 9496, called
`OpenJobObjectW(JOB_OBJECT_ALL_ACCESS, FALSE, "Local\fx1430-x4")`:

```
2026-11-20T00:57:52.049Z fresh process pid 9496: OpenJobObjectW(JOB_OBJECT_ALL_ACCESS, FALSE, "Local\fx1430-x4") -> NULL, GetLastError=2
```

Error 2 is `ERROR_FILE_NOT_FOUND`. The job still held five live members, but its name went with the
supervisor's handle, the last one open. The runner's call to `TerminateJobObject` was gated on the
open succeeding, so it never ran. Ten seconds later, the members were unchanged:

```
listing run=x4 at 2026-11-20T00:58:02.845Z on Windows (Win32_Process + IsProcessInJob + PEB CurrentDirectory)
PID     PPID    SESS  IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE
12972   2092    0     n/a          yes        C:\Users\USER\1430-spike-engineer\d-x4\ | root
36704   12972   0     n/a          yes        C:\Users\USER\1430-spike-engineer\d-x4\ | M1
5208    12972   0     n/a          yes        C:\Users\USER\1430-spike-engineer\d-x4\ | M3
21380   12972   0     n/a          yes        C:\ | M6
34948   12108   0     n/a          yes        C:\Users\USER\1430-spike-engineer\d-x4\ | M4
33440   36704   0     n/a          yes        C:\Users\USER\1430-spike-engineer\d-x4\ | M2
count=6
```

Holding a handle in a second process, which would keep the name open, was not tried. The members
ended only when the SSH session closed, through the session's own job (00:58:08Z, `count=0`).

## macOS, the baseline

### Before any ending (m1)

```
listing run=m1 at 2026-11-20T00:43:44.3NZ on Darwin
PID     PPID    PGID    SID     STAT  ARGS                         CWD                                      CGROUP
22305   22303   22294   22294   S     node /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/fixture/supervisor.cjs e1 m1 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m1 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/fixture /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer -
22311   22305   22311   22311   Ss    bash /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/fixture/fixture.sh m1 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m1 -
22312   22311   22311   22311   S     fx-m1-M1 300                 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m1 -
22313   22311   22313   22313   Ss    fx-m1-M3 300                 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m1 -
22315   22311   22311   22311   S     fx-m1-M5 300                 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m1 -
22316   22311   22316   22316   Ss    fx-m1-M6 300                 /                                        -
22317   22312   22311   22311   S     fx-m1-M2 300                 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m1 -
22318   1       22311   22311   S     fx-m1-M4 300                 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m1 -
count=8
```

### E1, the process-group kill (m1)

`E1 SIGKILL sent to process group 22311`. Twelve seconds after:

```
listing run=m1 at 2026-11-20T00:43:56.3NZ on Darwin
PID     PPID    PGID    SID     STAT  ARGS                         CWD                                      CGROUP
22305   22303   22294   22294   S     node /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/fixture/supervisor.cjs e1 m1 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m1 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/fixture /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer -
22313   1       22313   22313   Ss    fx-m1-M3 300                 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m1 -
22316   1       22316   22316   Ss    fx-m1-M6 300                 /                                        -
count=3
```

M1, M2, M4 and M5 ended. M3 and M6 were alive. Each leads a session, and so a process group, of its
own.

### E1c, today's route (m2)

`E1c SIGKILL sent to process group 23291`, then `E1c census under …/mac/d-m2 found and SIGKILLed 23293`.
Twelve seconds after:

```
listing run=m2 at 2026-11-20T00:44:24Z on Darwin
PID     PPID    PGID    SID     STAT  CWD | CGROUP | ARGS
23286   23284   23280   23280   S     /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer | - | node /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/fixture/supervisor.cjs e1c m2 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m2 /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/fixture
23296   1       23296   23296   Ss    / | - | fx-m2-M6 300
count=2
```

M1 to M5 ended, and M3 ended by the census. M6 was alive.

### E2, the supervisor killed outright (m3)

`kill -9 23758` ran at 00:44:33Z. Twelve seconds after:

```
listing run=m3 at 2026-11-20T00:44:45Z on Darwin
PID     PPID    PGID    SID     STAT  CWD | CGROUP | ARGS
23765   1       23765   23765   Ss    /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m3 | - | bash /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/fixture/fixture.sh m3
23766   23765   23765   23765   S     /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m3 | - | fx-m3-M1 300
23767   23765   23767   23767   Ss    /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m3 | - | fx-m3-M3 300
23769   23765   23765   23765   S     /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m3 | - | fx-m3-M5 300
23770   23765   23770   23770   Ss    / | - | fx-m3-M6 300
23771   23766   23765   23765   S     /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m3 | - | fx-m3-M2 300
23772   1       23765   23765   S     /Users/cjwilliams/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer/mac/d-m3 | - | fx-m3-M4 300
count=7
```

M1 to M6 were all alive, along with the supervised command.

## The table

Each cell gives the state at least 10 s after the ending, and the run whose listing shows it.
Windows has two E2 rows, because the card runs E2 there twice.

| Member | Ending | macOS (laptop) | Linux (WSL2) | Windows |
|---|---|---|---|---|
| M1 | E1 | ended (m1) | ended (w1, w7) | ended (x2, x1) |
| M2 | E1 | ended (m1) | ended (w1, w7) | ended (x2, x1) |
| M3 | E1 | **alive** (m1) | ended (w1, w7) | ended (x2, x1) |
| M4 | E1 | ended (m1) | ended (w1, w7) | ended (x2, x1) |
| M5 | E1 | ended (m1) | ended (w1, w7) | not applicable (`TerminateProcess` cannot be ignored) |
| M6 | E1 | **alive** (m1) | ended (w1, w7) | ended (x2, x1) |
| M1 | E1c | ended (m2) | ended (w2) | not run (the card runs E1c on macOS and Linux) |
| M2 | E1c | ended (m2) | ended (w2) | not run (the same) |
| M3 | E1c | ended (m2, by the census) | ended (w2, by the census) | not run (the same) |
| M4 | E1c | ended (m2) | ended (w2) | not run (the same) |
| M5 | E1c | ended (m2) | ended (w2) | not applicable |
| M6 | E1c | **alive** (m2) | **alive** (w2) | not run (the same) |
| M1 | E2 (Windows: kill-on-job-close set) | **alive** (m3) | **alive** (w5) | ended (x3) |
| M2 | E2 (the same) | **alive** (m3) | **alive** (w5) | ended (x3) |
| M3 | E2 (the same) | **alive** (m3) | **alive** (w5) | ended (x3) |
| M4 | E2 (the same) | **alive** (m3) | **alive** (w5) | ended (x3) |
| M5 | E2 (the same) | **alive** (m3) | **alive** (w5) | not applicable |
| M6 | E2 (the same) | **alive** (m3) | **alive** (w5) | ended (x3) |
| M1 | E2, kill-on-job-close not set | not applicable (a Windows job limit) | not applicable (the same) | **alive** (x4) |
| M2 | E2, the same | not applicable | not applicable | **alive** (x4) |
| M3 | E2, the same | not applicable | not applicable | **alive** (x4) |
| M4 | E2, the same | not applicable | not applicable | **alive** (x4) |
| M5 | E2, the same | not applicable | not applicable | not applicable |
| M6 | E2, the same | not applicable | not applicable | **alive** (x4) |

After E2 on Linux, a fresh cgroup.kill writer ended every member (w5). After E2 without
kill-on-job-close on Windows, a fresh process could not reach the job (x4).

## Recommendations

### Linux under WSL2: a delegated cgroup per dispatch, ended by cgroup.kill

The next card should do these things:

- Obtain a delegated cgroup from the systemd user manager, with `systemd-run --user -p Delegate=yes`
  or an equivalent D-Bus call.
- Give each dispatch a child cgroup in it, and place the dispatch's command there before the command
  starts anything.
- End the dispatch by writing cgroup.kill, and treat the cgroup as ended when cgroup.events
  reads `populated 0` or the cgroup is gone.
- Record the cgroup's path durably, so that the next start can write cgroup.kill to the orphan.
  That is the cgroup analogue of `R-STATE-10`, which w5's fresh writer showed works.

This closed every escape the fixture tried, including M6, which today's route left alive (w2). It
ended M5 without a `SIGTERM` stage, and it took 1.66 ms. It needed no root.

The next card must not assume the following:

- That the systemd user manager exists. Here systemd was pid 1, and `user@1000.service` was running
  while a login session was open. Neither was tested without a session, nor with WSL's systemd
  turned off.
- That systemd's default `KillMode` is harmless. It sends `SIGTERM`, which M5 survived (w6).
- That a cgroup holds what an agent hands to another manager. A process the agent starts through
  `systemd-run --user`, or through D-Bus activation, lands in another unit. That was not measured.
  Moving a member out deliberately is outside this card.
- That WSL keeps a cgroup across WSL stopping. The brief says WSL stops when idle, and a cgroup does
  not survive that.

**What would reverse it:**

- A target host without the systemd user manager, or with it but without a delegated subtree.
- A kernel without cgroup.kill.
- An agent workload shown to escape the dispatch's cgroup through a route Rigger cannot close.

In the first two cases, the fallback is today's route plus the gap at M6, or a route that needs
root.

### Native Windows: a Job Object per dispatch, with kill-on-job-close

The next card should do these things:

- Create one job per dispatch from the supervisor's own process, through koffi or an equivalent
  in-process FFI.
- Set `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and set no breakaway limit.
- Assign the dispatch's root before it starts children. Node's `spawn` offers no suspended start,
  so this needs a gate like the fixture's, or `CreateProcessW` with `CREATE_SUSPENDED` through the
  FFI.
- End the dispatch with `TerminateJobObject`.

Kill-on-job-close then ends the whole tree when the supervisor is killed outright (x3). That is
stronger than macOS and Linux, where E2 leaves the tree for the next start.

The next card must not assume the following:

- That a non-elevated supervisor can do the same. Only an elevated one was measured.
- That a job without kill-on-job-close can be reached after the supervisor dies. Its name goes with
  the last handle (x4), so a "next start ends the remains" design, as `R-STATE-10` has, does not
  carry over without a second handle holder. That was not measured.
- That the outer job a host puts Rigger in is benign. Under SSH, the session's job ended every member
  on disconnect, which is a containment Rigger did not choose.

**What would reverse it:**

- A non-elevated supervisor that cannot create or assign the job.
- An agent tool that starts processes with `CREATE_BREAKAWAY_FROM_JOB` under a job that allows it.
- Resume across a supervisor restart (the Temporal track) turning out to need dispatches that
  outlive the supervisor, because kill-on-job-close forbids exactly that.

## What this would change, as a proposal

This section is a proposal for the PM and the architect. The report changes none of these.

| Document | What the recommendation would change |
|---|---|
| `D13` | Rule 1 makes macOS v0's only host and bars Windows-specific code before the WSL2 spike reports. A Linux or Windows host with its own containment backend is the deferred row "A native Windows host, with its own containment backend" |
| `R-STATE-17` | Containment is defined as a process group plus a census of the dispatch's directory. A cgroup or a job would be a containment unit that also holds M6, which the definition leaves outside |
| `R-STATE-9`, `R-STATE-10` and `R-STATE-11` | The killed-outright path: the next start ends each recorded process group, and must confirm that the group is still Rigger's. On Linux the recorded thing would be a cgroup path. On Windows, kill-on-job-close would end the tree at once, and nothing would be left for the next start |
| `R-STATE-19` and `R-STATE-26` | What Rigger records when it cannot read a group. A cgroup's cgroup.procs and a job's process list are different reads |
| `ARCHITECTURE.md`, "Failure model" | L0's containment paragraph: "A process that leaves its group is outside this containment" |
| `src/substrate/process.mjs` (`runCommand`) | The code the paragraph describes. This is a pointer for the architect, not a requirement |

## `docs/v0-build-plan.md` §5

This spike ran none of §5's steps. It ran no `wsl --status` or `wsl -l -v`, no rustup, `gh`, Claude
CLI or Tauri libraries, no Emend suite, no `cargo` build, no `claude -p` dispatch, and no Windows
native test comparison.

It did unpack a pinned Node in WSL, which resembles part of step 2, but only as the fixture's
runtime, in the spike's own directory, and removed afterwards. It answers nothing of §5's verdict.

## What failed

- **The first WSL run lost its arguments.** `ssh hostpc wsl.exe -e bash -lc "… e1 w1"` passed
  through cmd.exe, and the runner started with no arguments. It started a supervisor (pid 630)
  that crashed, and a unit `fx1430-.service` that failed. I then ended the runner (pid 618). From
  then on, every WSL command went in as a script on stdin.
- **A direct inspection command broke in cmd.exe.** cmd.exe split it at its pipes, and it
  returned `'fx-w1' is not recognized`. It was run outside the transcript wrapper, so the
  transcript's appendix records it.
- **w3's fresh-writer loop never ended.** It polled cgroup.events until `populated 0`, but systemd
  removed the cgroup once it emptied. The loop then spun on `grep` errors (20,209 lines) until I
  ended it (pid 2377). It forked many short processes, which is why WSL's pids jumped from about
  2,400 to 103,000. Its reading stood, because w3's listing at 00:51:55Z read `count=0`. w5 reran
  E2 with a loop that also stops when the cgroup is gone.
- **The first macOS run failed to start.** The worktree's `package.json` sets `"type": "module"`, so
  supervisor.js failed to load. It was renamed to `docs/spikes/whole-tree-containment/fixture/supervisor.cjs`.
- **`docs/spikes/whole-tree-containment/fixture/list.sh` printed a literal `3N` in its first timestamps**, because macOS `date` has no `%N`. It
  was fixed after m1. m1's listings carry .3NZ.
- **`docs/spikes/whole-tree-containment/runners/wsl-run.sh` relayed `$$` into a systemd `ExecStart` for w7.** systemd read it as a literal `$`,
  so the line `supervisor-process pid $` carries no pid. The `id` line above it is still the
  supervisor process's own, because `ExecStart` `exec`s into Node. The unit's main pid, 104328, is
  the supervisor's pid in the listing.

- **The first commit was refused.** The transcript was first staged with a Markdown extension, and
  a test requires every tracked Markdown file under `docs/spikes/` to be a checked report. It is
  evidence, not a report, so it was renamed to
  `docs/spikes/whole-tree-containment/transcript.txt`.

## Custody

### The transcript

`docs/spikes/whole-tree-containment/transcript.txt` holds every command run through `docs/spikes/whole-tree-containment/runners/t.sh`,
each with its UTC start time and host. Its appendix lists the commands run without the wrapper,
with the UTC window each fell in, and two marked edits: a redaction, and the collapsed loop output.

### The credential scan

Run at the pull request's head, over every file under `docs/spikes/whole-tree-containment/`:

```
$ grep -rnIiE 'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-ant-|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-|BEGIN [A-Z ]*PRIVATE KEY|bearer [A-Za-z0-9._-]{20,}|(password|passwd|secret|token|api[_-]?key)[[:space:]]*[:=]' docs/spikes/whole-tree-containment; echo "grep exit $?"
grep exit 1
```

Exit 1 with no lines printed means no match in any of the 14 files. A second scan for email
addresses, `grep -rnIoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}'`, found only the systemd unit
name `user@1000.service`. The one account address `whoami /groups` printed was redacted before it
was committed.

### Files written outside the spike's own directories

| Host | File | Reason | Removed |
|---|---|---|---|
| WSL2 | `/run/user/1000/systemd/transient/fx1430-*.service`, one per run (`fx1430-`, w1 to w3, w5 to w7), and those for the probe units run-p511-i2417.scope and `run-p512-i2418.service` | systemd writes a runtime file for each transient unit `systemd-run --user` starts. It was not planned | Yes. Each was removed when its unit was collected, after `systemctl --user reset-failed` for the failed ones. At 00:58:39Z, `ls /run/user/1000/systemd/transient/ \| grep fx1430` printed nothing, and at 01:02:17Z its count was 0 |
| WSL2 | the units' cgroups under `/sys/fs/cgroup/user.slice/…/app.slice/`, with the `tree` children the supervisors made | a cgroup is the subject of the test. They are kernel state, not files on disk | Yes. At 01:02:17Z, `ls -d …/app.slice/fx1430*` printed `No such file or directory` |
| WSL2 | the user's systemd journal entries for the units | systemd logs unit starts and stops. It was not planned | No. Removing them means editing the user's journal, so they are left |
| Windows | none found. The npm cache was pointed at the spike's own directory. At 00:59:00Z, a check of `%LOCALAPPDATA%\npm-cache\_logs`, `%APPDATA%\npm` and `%USERPROFILE%\.npmrc` for writes in the last hour returned nothing | — | — |
| Laptop | none outside the gitignored spike directory in the worktree (spikes/1430-spike-engineer), the worktree itself, and this pull request | — | — |

The spike's own directories were these:

- `~/1430-spike-engineer/` in WSL, removed at 00:58:51Z, recreated for w7, and removed at 01:02:17Z.
- `C:\Users\user\1430-spike-engineer\` on Windows, removed at 00:59:00Z, after which `Test-Path`
  printed `False`.
- the gitignored spike directory in the laptop's worktree, spikes/1430-spike-engineer.

### Host-configuration changes

The stated-intent comment went up before any install:
[1430#7026629400](https://github.com/williacj/rigger/issues/1430#issuecomment-7026629400). It
declared no host-configuration change, and none was made: no package install, firewall rule, WSL or
systemd setting, or registry key. The transient units above are runtime state that vanishes with
the unit, not configuration. Nothing was reverted, because nothing was changed. No WSL restart, no
.wslconfig or `/etc/wsl.conf` change, and no reboot was made, so no sibling card needed to clear
one.

### Every process the spike started

The pids below are every long-lived process the runs started, each read from a listing or a log.
The short-lived helpers ran synchronously and exited before their command returned: `ps`, `lsof`,
`python3`, `powershell`, `taskkill`, `ssh`, wsl.exe, `npm`, and the listing scripts. Each M4's
intermediate `bash`, and each cmd.exe on Windows, exited at once. On Linux and macOS that
intermediate's pid was never printed. On Windows it was: 34852, 37664, 37080 and 12108.

| Host | Run | Pids |
|---|---|---|
| Laptop | first try, failed to load | runner 22190, supervisor 22195 |
| Laptop | m1 | runner 22303, supervisor 22305, root 22311, M1 22312, M3 22313, M5 22315, M6 22316, M2 22317, M4 22318 |
| Laptop | m2 | runner 23284, supervisor 23286, root 23291, M1 23292, M3 23293, M5 23295, M6 23296, M2 23297, M4 23298 |
| Laptop | m3 | runner 23756, supervisor 23758, root 23765, M1 23766, M3 23767, M5 23769, M6 23770, M2 23771, M4 23772 |
| WSL2 | failed first run | runner 618, supervisor 630 |
| WSL2 | w1 | runner 1829, supervisor 1834, root 1844, M1 1845, M3 1846, M5 1848, M6 1849, M2 1850, M4 1851 |
| WSL2 | w2 | runner 2004, supervisor 2009, root 2019, M1 2020, M3 2021, M5 2023, M6 2024, M2 2025, M4 2026 |
| WSL2 | w3 | runner 2200, supervisor 2205, root 2215, M1 2216, M3 2217, M5 2219, M6 2220, M2 2221, M4 2222, fresh writer 2377 |
| WSL2 | w5 | runner 103714, supervisor 103719, root 103729, M1 103730, M3 103731, M5 103733, M6 103734, M2 103735, M4 103736, fresh writer 103890 |
| WSL2 | w6 | runner 103939, supervisor 103945, root 103955, M1 103956, M3 103957, M5 103959, M6 103960, M2 103961, M4 103962, fresh writer 104103 |
| WSL2 | w7 | runner 104323, supervisor 104328, root 104339, M1 104340, M3 104341, M5 104343, M6 104344, M2 104345, M4 104346 |
| Windows | x1 | runner 12284, supervisor 32860, root 31132, M1 37476, M2 11444, M3 23952, M4 12344, M6 37836, cmd 34852, conhost 12000 and 36920 |
| Windows | x2 | runner 32616, supervisor 2652, root 30952, M1 21128, M2 36552, M3 1480, M4 32708, M6 36504, cmd 37664, conhost 1304 and 8140 |
| Windows | x3 | runner 35696, supervisor 32600, root 37088, M1 37000, M2 18884, M3 21348, M4 35804, M6 36804, cmd 37080, conhost 18988 and 31656, fresh lister 12620 |
| Windows | x4 | runner 9408, supervisor 2092, root 12972, M1 36704, M2 33440, M3 5208, M4 34948, M6 21380, cmd 12108, conhost 36612 and 5972, fresh listers 9496, 17412 and 7956 |

Survivors were ended by the spike, each one a descendant of a supervisor it had started and
recorded:

- On the laptop: 22313, 22316, 23296, the group -23765, 23767 and 23770.
- In WSL: 2024.

The SSH session's job ended x4's survivors. Every other member ended under its run's own ending.

### After the last run, none of these pids is alive

- **Laptop (00:58:51Z).** `ps -o pid,lstart,args -p <the laptop pids above>` printed only its header,
  `PID STARTED ARGS`. `ps -axo args | grep -c 'fx-m[0-9]-M'` printed `0`.
- **WSL2 (01:02:17Z).** `ps -o pid,lstart,args -p <the WSL pids above>` printed only its header,
  `PID STARTED COMMAND`. Its count of fixture members printed `matching-members: 0`.
- **Windows (00:59:00Z).** `Get-Process -Id <the Windows pids above>` printed
  `live pids from the started list: 0`. A search for fixture command lines printed
  `matching fx1430 command lines: 0` (00:58:52Z).

## Questions this leaves open, and what would settle them

| Open question | What would settle it |
|---|---|
| Can a non-elevated Windows supervisor create and assign a job? | Run `docs/spikes/whole-tree-containment/fixture-win/` from a standard user's SSH session. That needs a non-admin account on the Windows machine, which is a host-configuration change for the owner to approve |
| Does the systemd user manager, and so the delegated cgroup, exist without an open login session? | Rerun w1 with every session closed and `loginctl enable-linger` unset. Enabling linger would be a configuration change |
| Does a second handle holder keep an orphaned Windows job reachable without kill-on-job-close? | One run with a holder process that opens the named job and outlives the supervisor |
| Does a real agent session stay in its cgroup or job? | That is outside this card, by its scope edges |
