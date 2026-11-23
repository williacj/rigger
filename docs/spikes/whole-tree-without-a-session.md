ABOUTME: Spike findings for card #1459: whether an unprivileged Linux supervisor under WSL2 obtains a delegated cgroup and
ends an agent's whole tree with cgroup.kill when its user has no login session.

# Whole-tree containment with no login session, on Linux under WSL2

## The answer

**With linger set (RL) or a system unit (RS), yes. With neither (R0), no.** The user under test was a dedicated, unprivileged
WSL user, `rigger-spike`, created for this card under the owner's ruling and deleted at the end.

- **R0, linger unset and nothing changed.** A supervisor that starts with no session open gets no cgroup it can write to.
  Its cgroup is `/non-systemd`, owned by root. It has no user manager to ask, and the system manager refuses it. N1 and N3
  are therefore "not obtained".
- **R0, when the last session closes while a tree runs (N2, the engine's own case).** The tree dies, but not by Rigger's
  hand. Ten seconds after the session closed, logind stopped the user's systemd manager. The manager sent the supervisor
  `SIGTERM`, and systemd then sent `SIGKILL` to the fixture root and all six members. The cgroup was gone before anything
  could write cgroup.kill.
- **RL, `loginctl enable-linger` for the user.** The user manager runs with no session. A user unit with `Delegate=yes`
  gives the supervisor a cgroup whose cgroup.kill the user owns. cgroup.kill ended every member in N1, N2 and N3. Each
  time, the cgroup read `populated 0` within 0.35 to 0.91 ms of the write.
- **RS, a system unit with `User=rigger-spike` and `Delegate=yes`.** The same held, with one difference. The unit's own
  cgroup.kill stays root's and is not writable. The `tree` child cgroup that the supervisor makes is the user's, and
  writing it ended every member, within 0.27 to 1.27 ms.
- **Whatever the route, WSL bounds it.** The distro instance stopped 10 to 20 s after its last wsl.exe client went away,
  even with linger set. Nothing a route sets up outlives that.

I recommend RS for an engine that runs unattended under WSL2, with RL as the fallback where a system unit cannot be installed but linger can be
set. Both are under "Recommendation", with what would reverse it. This report hands over evidence. It changes
no code, requirement or recorded decision.

## What ran, and where

Every command that reached the WSL2 machine or the Windows machine ran through the laptop's step runner,
`docs/spikes/whole-tree-without-a-session/source/orch.cjs`. So did the final laptop listing and the comparisons. The
runner wrote each step's exact argv, its stdin script, its UTC start and end, the exit code and
the full output to `docs/spikes/whole-tree-without-a-session/transcript.txt`. A step id below names its transcript entry,
which starts `### step <id>`.

WSL was reached only by `ssh hostpc` running `wsl.exe -u root -e bash -s` with a tag argument, and the script on stdin. The runner writes each argv as JSON, so the transcript shows rla's, for example, as `["ssh","hostpc","wsl.exe","-u","root","-e","bash","-s","fx1459rla","rl","n1","n3"]`. Root observed, and it
installed or reverted a route. Every supervisor and every fresh writer ran as `rigger-spike`: through the driver's `asuser`
function (`setpriv --reuid=$TUID --regid=$TUID --init-groups`), or as a systemd unit's `User=`.

| Step | What it did |
|---|---|
| p0a, w2, w3, w4, w9-1, w10-1 | `["ssh","hostpc","wsl.exe","-l","-v"]`: whether WSL was running |
| p0b, p1, p2 | Read-only probes of WSL as root: versions, sessions, linger, the user manager, cgroups, PAM |
| s1 | Made the spike's directory under the owner's WSL home, wrote its files and fetched Node |
| w1 | Checked that none of s1's Windows processes was still alive |
| s2 | Voided s1's mislabelled records, created `rigger-spike`, moved the directory into its home, and probed what a WSL interop login of that user does |
| r0a | R0, N1 and N3: failed before it reached a case (see "What failed") |
| r0b | R0, N1 and N3 |
| rla | RL, N1 and N3 |
| rsa | RS, N1 and N3 |
| r0c | R0, N2 |
| rlb, rsb | RL and RS, N2: no login session opened, so neither counts (see "What failed") |
| s3 | Printed the WSL evidence files, deleted `rigger-spike` and proved it gone |
| f2 | A final WSL listing, superseded by f2b after the N2 reruns |
| f1, f1b, f1c, f1d | Final Windows listings that hung (see "What failed") |
| w5, w6, w7, w8 | Diagnosing the hung listings |
| f1e, c1 | A final Windows listing and its comparison with the record, superseded by f1f and c2 |
| s4 | Recreated `rigger-spike` for the N2 reruns |
| rlc | RL, N2, counted |
| rsc | RS, N2, counted, in a fresh distro instance |
| s5 | Printed the WSL evidence files, deleted `rigger-spike` again and proved it gone |
| f2b | The final WSL listing |
| f1f, c2 | The final Windows listing and its comparison with the record |
| f3 | The final laptop listing |

Each case driver is the helper library, `docs/spikes/whole-tree-without-a-session/source/lib.sh`, followed by the case
body. Both are verbatim in each step's stdin in the transcript. The supervisor, the fresh writer, the listing and the
fixture are under `docs/spikes/whole-tree-without-a-session/source/`. The versions s1 wrote, which differ only in the
directory they name, are under `docs/spikes/whole-tree-without-a-session/source/s1-versions/`. Every original source file's
sha256 matches the one WSL printed after writing it (s1, s2, s4). A masked file's own hash is withheld.

## Hosts and versions

Each value is quoted from the command that printed it.

- **Distribution** (p0b). `grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release` printed `PRETTY_NAME="Ubuntu 26.04.1 LTS"`.
- **Kernel** (p0b). `uname -a` printed
  `Linux Host-PC10 6.18.58.1-microsoft-standard-WSL2 #1 SMP PREEMPT_DYNAMIC Tue Oct 27 00:24:11 UTC 2026 x86_64 GNU/Linux`.
- **systemd** (p0b). `systemctl --version | head -1` printed `systemd 259 (259.5-0ubuntu3.4)`.
- **Node** (s1). The script ran `$D/node-v24.19.0-linux-x64/bin/node --version`. It echoed that command as
  `$ /home/[name withheld]/1459-spike-engineer/node-v24.19.0-linux-x64/bin/node --version`, and the command printed `v24.19.0`.

Node is the official linux-x64 tarball. It was checked against nodejs.org's SHASUMS256.txt, which printed
`node.tar.xz: OK`, and unpacked in the spike's own directory. No Node is on the host's `PATH`: p0b printed
`node: not on PATH`.

The p0b probe also read the settings the answer turns on:

- logind's `KillUserProcesses` read `b false`.
- logind.conf sets only `InhibitDelayMaxSec=30`, so `UserStopDelaySec` is systemd's default.
- `user@.service` has `KillMode=mixed`, `TimeoutStopUSec=5s` and `Delegate=yes`.
- `/etc/wsl.conf` sets `systemd=true` and a default user.

## The user under test, and how the spike reached WSL

**Why not the owner's own WSL account.** p2 found that a tool on the owner's laptop logs into WSL over SSH, as the owner's
account, at every distro start. That holds a `Class=user` session for that account whenever WSL runs. The account also had
linger set before the spike: its file under `/var/lib/systemd/linger/` has mtime 2026-11-05 01:11:20Z. The owner ruled that
the spike may create one dedicated user instead, at
[1459#7106921307](https://github.com/williacj/rigger/issues/1459#issuecomment-7106921307). It was named before it was
created, at [1459#7106922830](https://github.com/williacj/rigger/issues/1459#issuecomment-7106922830). The owner's account,
its sessions, its linger and the tool were not touched.

**How the spike's own access affected sessions.** Each `wsl.exe -u root` connection opened sessions for root and for no
one else. p0b listed them:

```
SESSION  UID USER SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    310    manager       -     no   -
     c2    0 root -    422    user-early    pts/1 no   -
     c3    0 root -    465    manager-early -     no   -
```

- `c1` is the owner's user manager, there because of that account's linger.
- `c2` is WSL's `login -- root` for the spike's connection.
- `c3` is root's user manager.

The spike opened a `rigger-spike` session only where a case needed one: the s2 probe, and N2's interop login
(`wsl.exe -u rigger-spike -e sleep 8`). Every N1 and N3 login-state reading below shows no `rigger-spike` session. The
other user sessions that come and go in the listings, such as `c4` and `c6`, are the owner's tool's.

**A WSL login session does not close when its command ends.** In s2, the interop login opened session `c4`
(`Class=user`, on pts/3). The wsl.exe command exited at t+6 s, and `c4` was still listed at t+30 s:

```
2026-11-22T03:46:00.849380Z t+6s holder exited sessions: c4(user,leader 1330) c5(manager,leader 1361)  user@1001: active
2026-11-22T03:46:26.876777Z t+30s holder exited sessions: c4(user,leader 1330) c5(manager,leader 1361)  user@1001: active
```

So in N2, closing every session meant running `loginctl terminate-session` on the session the spike's own login had
opened.

## Did the supervisor obtain a writable cgroup

Each row quotes the supervisor's `/proc/self/cgroup` and `ls -l` of cgroup.kill, from its log in the step named.

| Route | Session open | `/proc/self/cgroup` of the supervisor | Its cgroup's cgroup.kill | The child tree/cgroup.kill | Obtained |
|---|---|---|---|---|---|
| R0 (r0b, run r0-n1) | no | `0::/non-systemd` | `--w------- 1 root root 0 Nov 21 21:48 /sys/fs/cgroup/non-systemd/cgroup.kill` | not made: `mkdir /sys/fs/cgroup/non-systemd/tree : EACCES` | **no** |
| R0 (r0c, run r0-n2) | yes | `0::/user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-r0-n2.service` | `--w------- 1 rigger-spike rigger-spike 0 Nov 21 22:20 /sys/fs/cgroup/user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-r0-n2.service/cgroup.kill` | `--w------- 1 rigger-spike rigger-spike 0 Nov 21 22:20 /sys/fs/cgroup/user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-r0-n2.service/tree/cgroup.kill` | yes, while the session lasted |
| RL (rla, run rl-n1) | no | `0::/user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n1.service` | `--w------- 1 rigger-spike rigger-spike 0 Nov 21 21:48 /sys/fs/cgroup/user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n1.service/cgroup.kill` | `--w------- 1 rigger-spike rigger-spike 0 Nov 21 21:48 /sys/fs/cgroup/user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n1.service/tree/cgroup.kill` | **yes** |
| RS (rsa, run rs-n1) | no | `0::/system.slice/system-fx1459\x2drs.slice/fx1459-rs@n1.service` | `--w------- 1 root         root         0 Nov 21 21:49 /sys/fs/cgroup/system.slice/system-fx1459\x2drs.slice/fx1459-rs@n1.service/cgroup.kill`, with `access(W_OK) on own cgroup.kill: EACCES` | `--w------- 1 rigger-spike rigger-spike 0 Nov 21 21:49 /sys/fs/cgroup/system.slice/system-fx1459\x2drs.slice/fx1459-rs@n1.service/tree/cgroup.kill` | **yes**, through the child |

The dates `ls -l` printed are WSL's local time. Every other run read the same for its route, in its own
supervisor log in the transcript.

**R0: the command, and its full output, that showed no writable cgroup.** In r0b the driver started the supervisor
directly as the user, with no session open:

```
$ asuser /home/rigger-spike/1459-spike-engineer/node-v24.19.0-linux-x64/bin/node /home/rigger-spike/1459-spike-engineer/supervisor.cjs obtain r0-n1 > /home/rigger-spike/1459-spike-engineer/runs/r0-n1/sup.log 2>&1   (started directly as rigger-spike with no session: R0 changes nothing)
exit 3
$ asuser systemd-run --user --unit=fx1459-r0-n1-unit -p Delegate=yes --working-directory=/home/rigger-spike/1459-spike-engineer /home/rigger-spike/1459-spike-engineer/node-v24.19.0-linux-x64/bin/node /home/rigger-spike/1459-spike-engineer/supervisor.cjs obtain r0-n1
Failed to connect to user scope bus via local transport: No such file or directory
exit 1
```

The supervisor's whole log followed:

```
REC host=wsl boot=93e1a4db-e2d2-416b-b58d-7145914f1de6 pid=1070 starttime=12948 recorded=2026-11-22T03:48:00.201Z label=supervisor:r0-n1
2026-11-22T03:48:00.206Z supervisor pid 1070 ppid 407 mode obtain run r0-n1 node v24.19.0
2026-11-22T03:48:00.209Z $ id   (pid 1077, exited 0 before returning)
uid=1001(rigger-spike) gid=1001(rigger-spike) groups=1001(rigger-spike)
2026-11-22T03:48:00.209Z $ cat /proc/self/cgroup
0::/non-systemd
2026-11-22T03:48:00.211Z $ ls -ld /sys/fs/cgroup/non-systemd   (pid 1078, exited 0 before returning)
drwxr-xr-x 2 root root 0 Nov 21 21:47 /sys/fs/cgroup/non-systemd
2026-11-22T03:48:00.213Z $ ls -l /sys/fs/cgroup/non-systemd/cgroup.kill /sys/fs/cgroup/non-systemd/cgroup.procs /sys/fs/cgroup/non-systemd/cgroup.subtree_control   (pid 1079, exited 0 before returning)
--w------- 1 root root 0 Nov 21 21:48 /sys/fs/cgroup/non-systemd/cgroup.kill
-rw-r--r-- 1 root root 0 Nov 21 21:47 /sys/fs/cgroup/non-systemd/cgroup.procs
-rw-r--r-- 1 root root 0 Nov 21 21:48 /sys/fs/cgroup/non-systemd/cgroup.subtree_control
2026-11-22T03:48:00.213Z access(W_OK) on own cgroup.kill: EACCES
2026-11-22T03:48:00.213Z mkdir /sys/fs/cgroup/non-systemd/tree : EACCES EACCES: permission denied, mkdir '/sys/fs/cgroup/non-systemd/tree'
2026-11-22T03:48:00.215Z $ systemd-run --user --scope -p Delegate=yes --no-ask-password cat /proc/self/cgroup   (pid 1080, exited 1 before returning)
Failed to connect to user scope bus via local transport: No such file or directory
2026-11-22T03:48:00.273Z $ systemd-run --scope -p Delegate=yes --no-ask-password cat /proc/self/cgroup   (pid 1081, exited 1 before returning)
Failed to start transient scope unit: Access denied as the requested operation requires interactive authentication. However, interactive authentication has not been enabled by the calling program.
2026-11-22T03:48:00.276Z $ ls -ld /run/user/1001   (pid 1096, exited 2 before returning)
ls: cannot access '/run/user/1001': No such file or directory
2026-11-22T03:48:00.276Z RESULT NOT OBTAINED: no cgroup this supervisor can write cgroup.kill to
```

Run r0-n3, in the same step, printed the same lines with its own pids and times. **N1 and N3 under R0 are "not
obtained".**

This R0 supervisor stands for an engine that something inside Linux starts as its user with no session, such as a scheduler or
a root-run `setpriv`. That is a judgment, from three premises: such a process inherits a cgroup root owns, it has no user
manager to ask, and polkit refuses it the system manager. A start through wsl.exe is not that case, because
`wsl.exe -u rigger-spike` opened a WSL login session for the user, as s2 showed.

**No routes beyond R0, RL and RS were weighed.** A supervisor running as root is outside the card. A cgroup root makes and
hands to the user with `chown` is not one of systemd's delegation routes; it would be a configuration of its own.

## The fixture, the listings, and when a run counts

The fixture is #1430's six members, M1 to M6, with the same behaviour
(`docs/spikes/whole-tree-without-a-session/source/fixture.sh`). Each sleeps 300 s. M3 and M6 start new sessions, and M6
also moves to `/`. M4 is reparented, and M5 ignores `SIGTERM`. The fixture root is the supervised command, so a listing
counts seven processes: the root and M1 to M6. M4's parent exits at once by design, and shows as `NO`.

Two things changed from #1430:

- Each process that starts a member writes that member's pid and `/proc` starttime into the run's members.txt, as it
  starts it, using bash builtins only.
- The supervisor and the fresh writer are new: `docs/spikes/whole-tree-without-a-session/source/supervisor.cjs` and
  `docs/spikes/whole-tree-without-a-session/source/writer.cjs`.

The listing, `docs/spikes/whole-tree-without-a-session/source/list.cjs`, reads `/proc` and starts no process. A member
shows `yes` only when its recorded pid exists with its recorded starttime and is not a zombie. Any other live process
naming the run would be listed as unrecorded, and no run had one.

**No live process** means cgroup.events reads `populated 0`, or the cgroup is gone, as #1430 read it. The writer polls
cgroup.events in a tight loop for 50 ms, then every 1 ms, for up to 20 s. That 20 s is the bound for "neither happened".

**A run counts as measuring cgroup.kill** only where all seven were alive in the listing the writing process took
immediately before its write. All six counted runs had all seven alive. R0's N2 never reached a write (see "N2 under R0").

## N1: the supervisor starts with no session, then ends the tree

### RL (rla)

The login state with the tree running, before the write:

```
2026-11-22T03:48:11.792930Z LOGIN STATE (rl-n1: tree running, before the cgroup.kill write)
$ loginctl list-sessions --no-pager
SESSION  UID USER         SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    332    manager       -     no   -
     c2    0 root         -    408    user-early    pts/1 no   -
     c3    0 root         -    439    manager-early -     no   -
     c4 1000 [name withheld] -    1842   user          -     no   -
     c5 1001 rigger-spike -    2477   manager       -     no   -

5 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Service=user@1001.service
State=lingering
Sessions=c5
Linger=yes
$ systemctl is-active user@1001.service
active
```

The listing immediately before the write, and the write:

```
listing run=rl-n1 (supervisor, immediately before the cgroup.kill write) at 2026-11-22T03:48:11.887Z by pid 2618 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       2632    13792     yes   S     2618    2632    2632    /home/rigger-spike/1459-spike-engineer/runs/rl-n1/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n1.service/tree | bash /home/rigger-spike/1459-spike-engineer/fixture.sh rl-n1
M3         2635    13794     yes   S     2632    2635    2635    /home/rigger-spike/1459-spike-engineer/runs/rl-n1/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n1.service/tree | fx-rl-n1-M3 300
M1         2634    13794     yes   S     2632    2632    2632    /home/rigger-spike/1459-spike-engineer/runs/rl-n1/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n1.service/tree | fx-rl-n1-M1 300
M2         2638    13794     yes   S     2634    2632    2632    /home/rigger-spike/1459-spike-engineer/runs/rl-n1/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n1.service/tree | fx-rl-n1-M2 300
M6         2639    13794     yes   S     2632    2639    2639    / | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n1.service/tree | fx-rl-n1-M6 300
M4-parent  2636    13794     NO    -     (no such pid)
M5         2637    13794     yes   S     2632    2632    2632    /home/rigger-spike/1459-spike-engineer/runs/rl-n1/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n1.service/tree | fx-rl-n1-M5 300
M4         2640    13794     yes   S     2477    2632    2632    /home/rigger-spike/1459-spike-engineer/runs/rl-n1/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n1.service/tree | fx-rl-n1-M4 300
members recorded=7 alive=7 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
2026-11-22T03:48:11.890Z cgroup.kill write started 2026-11-22T03:48:11.889Z ; cgroup.events read "populated 0" 0.908 ms after the write
```

At least 12 s after the write:

```
listing run=rl-n1 (driver: after DONE, at least 12 s after the write) at 2026-11-22T03:48:23.983Z by pid 3043 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       2632    13792     NO    -     (no such pid)
M3         2635    13794     NO    -     (no such pid)
M1         2634    13794     NO    -     (no such pid)
M2         2638    13794     NO    -     (no such pid)
M6         2639    13794     NO    -     (no such pid)
M4-parent  2636    13794     NO    -     (no such pid)
M5         2637    13794     NO    -     (no such pid)
M4         2640    13794     NO    -     (no such pid)
members recorded=7 alive=0 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

### RS (rsa)

```
2026-11-22T03:49:12.140561Z LOGIN STATE (rs-n1: tree running, before the cgroup.kill write)
$ loginctl list-sessions --no-pager
SESSION  UID USER SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    332    manager       -     no   -
     c2    0 root -    408    user-early    pts/1 no   -
     c3    0 root -    439    manager-early -     no   -
     c4 1000 [name withheld] -    1842   user          -     no   -

4 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Failed to get user: User ID 1001 is not logged in or lingering
$ systemctl is-active user@1001.service
inactive
```

```
listing run=rs-n1 (supervisor, immediately before the cgroup.kill write) at 2026-11-22T03:49:12.231Z by pid 3757 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       3771    19838     yes   S     3757    3771    3771    /home/rigger-spike/1459-spike-engineer/runs/rs-n1/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n1.service/tree | bash /home/rigger-spike/1459-spike-engineer/fixture.sh rs-n1
M3         3774    19839     yes   S     3771    3774    3774    /home/rigger-spike/1459-spike-engineer/runs/rs-n1/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n1.service/tree | fx-rs-n1-M3 300
M1         3773    19839     yes   S     3771    3771    3771    /home/rigger-spike/1459-spike-engineer/runs/rs-n1/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n1.service/tree | fx-rs-n1-M1 300
M2         3777    19839     yes   S     3773    3771    3771    /home/rigger-spike/1459-spike-engineer/runs/rs-n1/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n1.service/tree | fx-rs-n1-M2 300
M6         3778    19839     yes   S     3771    3778    3778    / | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n1.service/tree | fx-rs-n1-M6 300
M4-parent  3775    19839     NO    -     (no such pid)
M5         3776    19839     yes   S     3771    3771    3771    /home/rigger-spike/1459-spike-engineer/runs/rs-n1/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n1.service/tree | fx-rs-n1-M5 300
M4         3779    19839     yes   S     1       3771    3771    /home/rigger-spike/1459-spike-engineer/runs/rs-n1/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n1.service/tree | fx-rs-n1-M4 300
members recorded=7 alive=7 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
2026-11-22T03:49:12.235Z cgroup.kill write started 2026-11-22T03:49:12.234Z ; cgroup.events read "populated 0" 1.266 ms after the write
```

```
listing run=rs-n1 (driver: after DONE, at least 12 s after the write) at 2026-11-22T03:49:24.514Z by pid 4172 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       3771    19838     NO    -     (no such pid)
M3         3774    19839     NO    -     (no such pid)
M1         3773    19839     NO    -     (no such pid)
M2         3777    19839     NO    -     (no such pid)
M6         3778    19839     NO    -     (no such pid)
M4-parent  3775    19839     NO    -     (no such pid)
M5         3776    19839     NO    -     (no such pid)
M4         3779    19839     NO    -     (no such pid)
members recorded=7 alive=0 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

## N3: the supervisor killed outright with no session, then a fresh writer

The driver sent `kill -9` to the supervisor, which it had recorded by pid and starttime. Twelve seconds later it listed
the orphaned cgroup. A fresh process then wrote cgroup.kill. That process was `docs/spikes/whole-tree-without-a-session/source/writer.cjs`, started by the driver as
`rigger-spike`; it held nothing of the supervisor's, and found the cgroup by the path the supervisor had logged. Each unit
ran with `KillMode=process`, so systemd sent no signal to the rest of the unit when the supervisor died.

### RL (rla)

```
2026-11-22T03:48:28.419093Z LOGIN STATE (rl-n3: tree running, before the kill)
$ loginctl list-sessions --no-pager
SESSION  UID USER         SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    332    manager       -     no   -
     c2    0 root         -    408    user-early    pts/1 no   -
     c3    0 root         -    439    manager-early -     no   -
     c4 1000 [name withheld] -    1842   user          -     no   -
     c5 1001 rigger-spike -    2477   manager       -     no   -

5 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Service=user@1001.service
State=lingering
Sessions=c5
Linger=yes
$ systemctl is-active user@1001.service
active
```

```
2026-11-22T03:48:28.443029Z $ kill -9 3151
2026-11-22T03:48:28.443478Z kill -9 sent to recorded supervisor 3151
```

The members, alive in the orphaned cgroup before the fresh write:

```
listing run=rl-n3 (driver: 12 s after kill -9 of the supervisor, before the fresh write) at 2026-11-22T03:48:40.470Z by pid 3342 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       3165    15455     yes   S     2477    3165    3165    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | bash /home/rigger-spike/1459-spike-engineer/fixture.sh rl-n3
M3         3170    15459     yes   S     3165    3170    3170    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M3 300
M1         3168    15459     yes   S     3165    3165    3165    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M1 300
M2         3173    15460     yes   S     3168    3165    3165    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M2 300
M6         3174    15460     yes   S     3165    3174    3174    / | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M6 300
M4-parent  3171    15459     NO    -     (no such pid)
M4         3175    15460     yes   S     2477    3165    3165    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M4 300
M5         3172    15459     yes   S     3165    3165    3165    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M5 300
members recorded=7 alive=7 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

```
2026-11-22T03:48:40.474589Z LOGIN STATE (rl-n3: supervisor killed, before the fresh write)
$ loginctl list-sessions --no-pager
SESSION  UID USER         SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    332    manager       -     no   -
     c2    0 root         -    408    user-early    pts/1 no   -
     c3    0 root         -    439    manager-early -     no   -
     c4 1000 [name withheld] -    1842   user          -     no   -
     c5 1001 rigger-spike -    2477   manager       -     no   -

5 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Service=user@1001.service
State=lingering
Sessions=c5
Linger=yes
$ systemctl is-active user@1001.service
active
$ asuser /home/rigger-spike/1459-spike-engineer/node-v24.19.0-linux-x64/bin/node /home/rigger-spike/1459-spike-engineer/writer.cjs rl-n3 /sys/fs/cgroup/user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree
REC host=wsl boot=93e1a4db-e2d2-416b-b58d-7145914f1de6 pid=3353 starttime=16984 recorded=2026-11-22T03:48:40.497Z label=fresh-writer:rl-n3
```

The fresh writer's own listing immediately before its write, and the write:

```
listing run=rl-n3 (fresh writer, immediately before the cgroup.kill write) at 2026-11-22T03:48:40.500Z by pid 3353 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       3165    15455     yes   S     2477    3165    3165    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | bash /home/rigger-spike/1459-spike-engineer/fixture.sh rl-n3
M3         3170    15459     yes   S     3165    3170    3170    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M3 300
M1         3168    15459     yes   S     3165    3165    3165    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M1 300
M2         3173    15460     yes   S     3168    3165    3165    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M2 300
M6         3174    15460     yes   S     3165    3174    3174    / | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M6 300
M4-parent  3171    15459     NO    -     (no such pid)
M4         3175    15460     yes   S     2477    3165    3165    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M4 300
M5         3172    15459     yes   S     3165    3165    3165    /home/rigger-spike/1459-spike-engineer/runs/rl-n3/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n3.service/tree | fx-rl-n3-M5 300
members recorded=7 alive=7 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
2026-11-22T03:48:40.501Z cgroup.kill write started 2026-11-22T03:48:40.501Z ; cgroup.events read "populated 0" 0.351 ms after the write
```

```
listing run=rl-n3 (driver: 12 s after the fresh write) at 2026-11-22T03:48:52.528Z by pid 3361 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       3165    15455     NO    -     (no such pid)
M3         3170    15459     NO    -     (no such pid)
M1         3168    15459     NO    -     (no such pid)
M2         3173    15460     NO    -     (no such pid)
M6         3174    15460     NO    -     (no such pid)
M4-parent  3171    15459     NO    -     (no such pid)
M4         3175    15460     NO    -     (no such pid)
M5         3172    15459     NO    -     (no such pid)
members recorded=7 alive=0 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

### RS (rsa)

```
2026-11-22T03:49:28.887796Z LOGIN STATE (rs-n3: tree running, before the kill)
$ loginctl list-sessions --no-pager
SESSION  UID USER SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    332    manager       -     no   -
     c2    0 root -    408    user-early    pts/1 no   -
     c3    0 root -    439    manager-early -     no   -
     c4 1000 [name withheld] -    1842   user          -     no   -

4 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Failed to get user: User ID 1001 is not logged in or lingering
$ systemctl is-active user@1001.service
inactive
```

```
2026-11-22T03:49:28.912705Z $ kill -9 4280
2026-11-22T03:49:28.913154Z kill -9 sent to recorded supervisor 4280
```

```
listing run=rs-n3 (driver: 12 s after kill -9 of the supervisor, before the fresh write) at 2026-11-22T03:49:40.935Z by pid 4472 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       4294    21507     yes   S     1       4294    4294    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | bash /home/rigger-spike/1459-spike-engineer/fixture.sh rs-n3
M3         4297    21507     yes   S     4294    4297    4297    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M3 300
M1         4296    21507     yes   S     4294    4294    4294    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M1 300
M2         4300    21507     yes   S     4296    4294    4294    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M2 300
M6         4301    21507     yes   S     4294    4301    4301    / | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M6 300
M4-parent  4298    21507     NO    -     (no such pid)
M4         4302    21507     yes   S     1       4294    4294    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M4 300
M5         4299    21507     yes   S     4294    4294    4294    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M5 300
members recorded=7 alive=7 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

```
2026-11-22T03:49:40.939833Z LOGIN STATE (rs-n3: supervisor killed, before the fresh write)
$ loginctl list-sessions --no-pager
SESSION  UID USER SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    332    manager       -     no   -
     c2    0 root -    408    user-early    pts/1 no   -
     c3    0 root -    439    manager-early -     no   -
     c4 1000 [name withheld] -    1842   user          -     no   -

4 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Failed to get user: User ID 1001 is not logged in or lingering
$ systemctl is-active user@1001.service
inactive
$ asuser /home/rigger-spike/1459-spike-engineer/node-v24.19.0-linux-x64/bin/node /home/rigger-spike/1459-spike-engineer/writer.cjs rs-n3 /sys/fs/cgroup/system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree
REC host=wsl boot=93e1a4db-e2d2-416b-b58d-7145914f1de6 pid=4483 starttime=23031 recorded=2026-11-22T03:49:40.960Z label=fresh-writer:rs-n3
```

```
listing run=rs-n3 (fresh writer, immediately before the cgroup.kill write) at 2026-11-22T03:49:40.963Z by pid 4483 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       4294    21507     yes   S     1       4294    4294    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | bash /home/rigger-spike/1459-spike-engineer/fixture.sh rs-n3
M3         4297    21507     yes   S     4294    4297    4297    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M3 300
M1         4296    21507     yes   S     4294    4294    4294    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M1 300
M2         4300    21507     yes   S     4296    4294    4294    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M2 300
M6         4301    21507     yes   S     4294    4301    4301    / | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M6 300
M4-parent  4298    21507     NO    -     (no such pid)
M4         4302    21507     yes   S     1       4294    4294    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M4 300
M5         4299    21507     yes   S     4294    4294    4294    /home/rigger-spike/1459-spike-engineer/runs/rs-n3/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n3.service/tree | fx-rs-n3-M5 300
members recorded=7 alive=7 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
2026-11-22T03:49:40.964Z cgroup.kill write started 2026-11-22T03:49:40.964Z ; cgroup.events read "populated 0" 0.619 ms after the write
```

```
listing run=rs-n3 (driver: 12 s after the fresh write) at 2026-11-22T03:49:52.984Z by pid 4493 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       4294    21507     NO    -     (no such pid)
M3         4297    21507     NO    -     (no such pid)
M1         4296    21507     NO    -     (no such pid)
M2         4300    21507     NO    -     (no such pid)
M6         4301    21507     NO    -     (no such pid)
M4-parent  4298    21507     NO    -     (no such pid)
M4         4302    21507     NO    -     (no such pid)
M5         4299    21507     NO    -     (no such pid)
members recorded=7 alive=0 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

## N2: the supervisor starts under a session, then every session closes

Each N2 run took the same steps:

1. The driver opened a `rigger-spike` login through WSL interop.
2. It started the supervisor under that session and waited for the supervisor's ready line.
3. It waited for the login command to exit, then ran `loginctl terminate-session` on the session left open.
4. For 30 s, it recorded every second whether the members were alive.
5. It read the login state and listed the members.
6. It let the supervisor write cgroup.kill, or a fresh writer if the supervisor was gone.

### N2 under R0 (r0c): the user manager ends the tree first

The session, open before the supervisor started:

```
2026-11-22T04:20:01.712231Z LOGIN STATE (r0-n2: session open, before supervisor start)
$ loginctl list-sessions --no-pager
SESSION  UID USER         SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    336    manager       -     no   -
     c2    0 root         -    414    user-early    pts/1 no   -
     c3    0 root         -    456    manager-early -     no   -
     c4 1001 rigger-spike -    1090   user          pts/3 no   -
     c5 1001 rigger-spike -    1121   manager       -     no   -

5 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Service=user@1001.service
State=active
Sessions=c5 c4
Linger=no
$ systemctl is-active user@1001.service
active
```

Closing it:

```
2026-11-22T04:20:09.641941Z interop login command exited (0); sessions of rigger-spike: c4 
2026-11-22T04:20:11.648250Z $ loginctl terminate-session c4   (its leader is the spike's own login, recorded above)
exit 0
2026-11-22T04:20:11.659039Z every session of rigger-spike closed at 2026-11-22T04:20:11.656508Z (tu_sessions empty: yes)
```

Whether the members were alive, each second after the close. This is an excerpt; all 30 lines are in step r0c:

```
2026-11-22T04:20:20.932627Z t+9s after close: members alive=7 supervisor alive user@1001 active
2026-11-22T04:20:21.956036Z t+10s after close: members alive=7 supervisor gone user@1001 deactivating
2026-11-22T04:20:22.988328Z t+11s after close: members alive=0 supervisor gone user@1001 inactive
```

The login state and the listing 30 s after the close, before any write:

```
2026-11-22T04:20:42.638496Z LOGIN STATE (r0-n2: 30 s after every session closed, before the cgroup.kill write)
$ loginctl list-sessions --no-pager
SESSION  UID USER SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    336    manager       -     no   -
     c2    0 root -    414    user-early    pts/1 no   -
     c3    0 root -    456    manager-early -     no   -
     c6 1000 [name withheld] -    2137   user          -     no   -

4 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Failed to get user: User ID 1001 is not logged in or lingering
$ systemctl is-active user@1001.service
inactive
```

```
listing run=r0-n2 (driver: 30 s after every session closed, before the cgroup.kill write) at 2026-11-22T04:20:42.658Z by pid 2307 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       1428    408       NO    -     (no such pid)
M3         1431    412       NO    -     (no such pid)
M1         1430    412       NO    -     (no such pid)
M2         1434    412       NO    -     (no such pid)
M6         1435    413       NO    -     (no such pid)
M4-parent  1432    412       NO    -     (no such pid)
M4         1436    413       NO    -     (no such pid)
M5         1433    412       NO    -     (no such pid)
members recorded=7 alive=0 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

**What ended the members was the user manager's stop, not cgroup.kill.** The journal read in the same step shows the
sequence. These lines are an excerpt of it:

```
2026-11-22T04:20:11.654139+00:00 Host-PC10 systemd-logind[213]: Removed session c4.
2026-11-22T04:20:21.907868+00:00 Host-PC10 systemd[1]: Stopping user@1001.service - User Manager for UID 1001...
2026-11-22T04:20:21.915637+00:00 Host-PC10 systemd[1121]: fx1459-r0-n2.service: Main process exited, code=exited, status=143/n/a
2026-11-22T04:20:21.915735+00:00 Host-PC10 systemd[1121]: fx1459-r0-n2.service: Unit process 1428 (bash) remains running after unit stopped.
2026-11-22T04:20:22.007379+00:00 Host-PC10 systemd[1]: user@1001.service: Killing process 1428 (bash) with signal SIGKILL.
2026-11-22T04:20:22.007887+00:00 Host-PC10 systemd[1]: user@1001.service: Killing process 1436 (sleep) with signal SIGKILL.
2026-11-22T04:20:22.010540+00:00 Host-PC10 systemd[1]: Stopped user@1001.service - User Manager for UID 1001.
```

The supervisor logged `2026-11-22T04:20:21.912Z supervisor received SIGTERM; exiting 143`. The journal names all seven
fixture processes, 1428, 1430, 1431, 1433, 1434, 1435 and 1436, first as remaining and then as killed with `SIGKILL`.

From the session's removal (04:20:11.654139Z) to `Stopping user@1001.service` (04:20:21.907868Z) is 10.25 s. That is a
measurement: both endpoints are journal lines printed in step r0c. That it matches systemd's default `UserStopDelaySec` of
10 s is a judgment, since this host's value was not printed.

**No write was made.** By the time the driver came to write, the supervisor and the cgroup were both gone. The driver
printed
`tree cgroup /sys/fs/cgroup/user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-r0-n2.service/tree does not exist`,
and its `ls -ld` failed. So this run does not measure cgroup.kill. The cgroup went at the user manager's stop, not after
any write. The listing at least 12 s later:

```
listing run=r0-n2 (driver: at least 12 s after the ending) at 2026-11-22T04:20:54.683Z by pid 2319 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       1428    408       NO    -     (no such pid)
M3         1431    412       NO    -     (no such pid)
M1         1430    412       NO    -     (no such pid)
M2         1434    412       NO    -     (no such pid)
M6         1435    413       NO    -     (no such pid)
M4-parent  1432    412       NO    -     (no such pid)
M4         1436    413       NO    -     (no such pid)
M5         1433    412       NO    -     (no such pid)
members recorded=7 alive=0 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

### N2 under RL (rlc)

```
2026-11-22T04:36:04.330758Z LOGIN STATE (rl-n2: session open, before supervisor start)
$ loginctl list-sessions --no-pager
SESSION  UID USER         SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    341    manager       -     no   -
     c2    0 root         -    412    user-early    pts/1 no   -
     c3    0 root         -    454    manager-early -     no   -
     c4 1001 rigger-spike -    1287   manager       -     no   -
     c5 1001 rigger-spike -    1410   user          pts/3 no   -

5 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Service=user@1001.service
State=active
Sessions=c5 c4
Linger=yes
$ systemctl is-active user@1001.service
active
```

```
2026-11-22T04:36:14.146092Z $ loginctl terminate-session c5   (its leader is the spike's own login, recorded above)
2026-11-22T04:36:14.155904Z every session of rigger-spike closed at 2026-11-22T04:36:14.153580Z (tu_sessions empty: yes)
```

All seven stayed alive through the 30 s, and the user manager stayed `active`, because linger keeps it.

```
2026-11-22T04:36:45.042928Z LOGIN STATE (rl-n2: 30 s after every session closed, before the cgroup.kill write)
$ loginctl list-sessions --no-pager
SESSION  UID USER         SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    341    manager       -     no   -
     c2    0 root         -    412    user-early    pts/1 no   -
     c3    0 root         -    454    manager-early -     no   -
     c4 1001 rigger-spike -    1287   manager       -     no   -
     c6 1000 [name withheld] -    2041   user          -     no   -

5 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Service=user@1001.service
State=lingering
Sessions=c4
Linger=yes
$ systemctl is-active user@1001.service
active
```

```
listing run=rl-n2 (driver: 30 s after every session closed, before the cgroup.kill write) at 2026-11-22T04:36:45.061Z by pid 2295 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       1584    1820      yes   S     1570    1584    1584    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | bash /home/rigger-spike/1459-spike-engineer/fixture.sh rl-n2
M3         1587    1823      yes   S     1584    1587    1587    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M3 300
M1         1586    1823      yes   S     1584    1584    1584    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M1 300
M2         1590    1823      yes   S     1586    1584    1584    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M2 300
M6         1591    1823      yes   S     1584    1591    1591    / | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M6 300
M5         1589    1823      yes   S     1584    1584    1584    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M5 300
M4-parent  1588    1823      NO    -     (no such pid)
M4         1592    1823      yes   S     1287    1584    1584    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M4 300
members recorded=7 alive=7 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

```
listing run=rl-n2 (supervisor, immediately before the cgroup.kill write) at 2026-11-22T04:36:45.101Z by pid 1570 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       1584    1820      yes   S     1570    1584    1584    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | bash /home/rigger-spike/1459-spike-engineer/fixture.sh rl-n2
M3         1587    1823      yes   S     1584    1587    1587    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M3 300
M1         1586    1823      yes   S     1584    1584    1584    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M1 300
M2         1590    1823      yes   S     1586    1584    1584    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M2 300
M6         1591    1823      yes   S     1584    1591    1591    / | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M6 300
M5         1589    1823      yes   S     1584    1584    1584    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M5 300
M4-parent  1588    1823      NO    -     (no such pid)
M4         1592    1823      yes   S     1287    1584    1584    /home/rigger-spike/1459-spike-engineer/runs/rl-n2/d | /user.slice/user-1001.slice/user@1001.service/app.slice/fx1459-rl-n2.service/tree | fx-rl-n2-M4 300
members recorded=7 alive=7 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
2026-11-22T04:36:45.103Z cgroup.kill write started 2026-11-22T04:36:45.102Z ; cgroup.events read "populated 0" 0.576 ms after the write
```

```
listing run=rl-n2 (driver: at least 12 s after the ending) at 2026-11-22T04:36:57.132Z by pid 2531 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       1584    1820      NO    -     (no such pid)
M3         1587    1823      NO    -     (no such pid)
M1         1586    1823      NO    -     (no such pid)
M2         1590    1823      NO    -     (no such pid)
M6         1591    1823      NO    -     (no such pid)
M5         1589    1823      NO    -     (no such pid)
M4-parent  1588    1823      NO    -     (no such pid)
M4         1592    1823      NO    -     (no such pid)
members recorded=7 alive=0 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

### N2 under RS (rsc)

```
2026-11-22T04:37:40.718906Z LOGIN STATE (rs-n2: session open, before supervisor start)
$ loginctl list-sessions --no-pager
SESSION  UID USER         SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    326    manager       -     no   -
     c2    0 root         -    408    user-early    pts/1 no   -
     c3    0 root         -    450    manager-early -     no   -
     c4 1001 rigger-spike -    1133   user          pts/3 no   -
     c5 1001 rigger-spike -    1164   manager       -     no   -

5 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Service=user@1001.service
State=active
Sessions=c5 c4
Linger=no
$ systemctl is-active user@1001.service
active
```

```
2026-11-22T04:37:50.657285Z $ loginctl terminate-session c4   (its leader is the spike's own login, recorded above)
2026-11-22T04:37:50.666788Z every session of rigger-spike closed at 2026-11-22T04:37:50.664161Z (tu_sessions empty: yes)
```

The user manager stopped about 10 s after the close: the per-second lines read `user@1001 inactive` from t+10s. The tree,
in a system unit, was untouched, with all seven alive at every second.

```
2026-11-22T04:38:21.695410Z LOGIN STATE (rs-n2: 30 s after every session closed, before the cgroup.kill write)
$ loginctl list-sessions --no-pager
SESSION  UID USER SEAT LEADER CLASS [name withheld] IDLE SINCE
     c1 1000 [name withheld] -    326    manager       -     no   -
     c2    0 root -    408    user-early    pts/1 no   -
     c3    0 root -    450    manager-early -     no   -
     c6 1000 [name withheld] -    1501   user          -     no   -

4 sessions listed.
$ loginctl show-user rigger-spike --no-pager -p State -p Sessions -p Linger -p Service
Failed to get user: User ID 1001 is not logged in or lingering
$ systemctl is-active user@1001.service
inactive
```

```
listing run=rs-n2 (driver: 30 s after every session closed, before the cgroup.kill write) at 2026-11-22T04:38:21.716Z by pid 2210 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       1473    11467     yes   S     1459    1473    1473    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | bash /home/rigger-spike/1459-spike-engineer/fixture.sh rs-n2
M3         1476    11469     yes   S     1473    1476    1476    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M3 300
M1         1475    11469     yes   S     1473    1473    1473    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M1 300
M2         1479    11469     yes   S     1475    1473    1473    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M2 300
M6         1480    11469     yes   S     1473    1480    1480    / | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M6 300
M4-parent  1477    11469     NO    -     (no such pid)
M4         1481    11469     yes   S     1       1473    1473    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M4 300
M5         1478    11469     yes   S     1473    1473    1473    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M5 300
members recorded=7 alive=7 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

```
listing run=rs-n2 (supervisor, immediately before the cgroup.kill write) at 2026-11-22T04:38:21.759Z by pid 1459 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       1473    11467     yes   S     1459    1473    1473    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | bash /home/rigger-spike/1459-spike-engineer/fixture.sh rs-n2
M3         1476    11469     yes   S     1473    1476    1476    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M3 300
M1         1475    11469     yes   S     1473    1473    1473    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M1 300
M2         1479    11469     yes   S     1475    1473    1473    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M2 300
M6         1480    11469     yes   S     1473    1480    1480    / | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M6 300
M4-parent  1477    11469     NO    -     (no such pid)
M4         1481    11469     yes   S     1       1473    1473    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M4 300
M5         1478    11469     yes   S     1473    1473    1473    /home/rigger-spike/1459-spike-engineer/runs/rs-n2/d | /system.slice/system-fx1459\x2drs.slice/fx1459-rs@n2.service/tree | fx-rs-n2-M5 300
members recorded=7 alive=7 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
2026-11-22T04:38:21.760Z cgroup.kill write started 2026-11-22T04:38:21.760Z ; cgroup.events read "populated 0" 0.272 ms after the write
```

```
listing run=rs-n2 (driver: at least 12 s after the ending) at 2026-11-22T04:38:34.013Z by pid 2448 uid 1001
WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS
root       1473    11467     NO    -     (no such pid)
M3         1476    11469     NO    -     (no such pid)
M1         1475    11469     NO    -     (no such pid)
M2         1479    11469     NO    -     (no such pid)
M6         1480    11469     NO    -     (no such pid)
M4-parent  1477    11469     NO    -     (no such pid)
M4         1481    11469     NO    -     (no such pid)
M5         1478    11469     NO    -     (no such pid)
members recorded=7 alive=0 (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=0
```

## The table

Each cell gives the state of the fixture root and M1 to M6 at least 10 s after the ending, and the step whose listing
shows it.

| Route | N1 | N2 | N3 |
|---|---|---|---|
| R0 | not obtained (r0b) | all ended before any write, by the user manager's stop 10.25 s after the session closed; no cgroup.kill written (r0c) | not obtained (r0b) |
| RL | all ended by cgroup.kill; `populated 0` 0.908 ms after the write (rla) | all ended by cgroup.kill; 0.576 ms (rlc) | all alive in the orphan 12 s after `kill -9`; all ended by the fresh writer; 0.351 ms (rla) |
| RS | all ended by cgroup.kill; 1.266 ms (rsa) | all ended by cgroup.kill; 0.272 ms (rsc) | all alive in the orphan 12 s after `kill -9`; all ended by the fresh writer; 0.619 ms (rsa) |

Every time in the table is a measurement. Its two endpoints are the write and the first cgroup.events read of
`populated 0`. The one process that wrote, supervisor or fresh writer, took both with process.hrtime and printed them
in the step named.

## Whether WSL kept running

Each driver printed the VM's boot id and the distro's pid 1 starttime when it started, at each case's start and end, and
at its end. Within each step both stayed the same, through every interval in which `rigger-spike` had no session:

| Step | Boot id | Distro pid 1 starttime | First reading | Last reading |
|---|---|---|---|---|
| r0b | 93e1a4db-e2d2-416b-b58d-7145914f1de6 | 12689 | 03:48:00.097785Z | 03:48:01.837474Z |
| rla | 93e1a4db-e2d2-416b-b58d-7145914f1de6 | 12689 | 03:48:08.155820Z | 03:48:54.257785Z |
| rsa | 93e1a4db-e2d2-416b-b58d-7145914f1de6 | 12689 | 03:49:08.759698Z | 03:49:54.702499Z |
| r0c | 3c4522f0-1741-42f8-9d01-88ef813a8399 | 64 | 04:20:01.286844Z | 04:20:58.070473Z |
| rlc | b7aea7c3-a116-46b4-9610-75a534a80142 | 58 | 04:36:03.754767Z | 04:37:00.165060Z |
| rsc | b7aea7c3-a116-46b4-9610-75a534a80142 | 11117 | 04:37:40.180651Z | 04:38:38.131921Z |

The driver's own wsl.exe connection held the distro up throughout. Between steps it did not stay up:

- After s1 returned at 03:05:51Z, p2 at 03:06:12Z found new pids for the user manager and `sshd` in the same VM boot, so
  the distro had restarted.
- rlc ended at 04:37:00Z. At 04:37:21Z, step w9-1's listing of distros read `Stopped`, and rsc then found a new distro pid 1
  starttime, 11117 against 58.

**Finding:** inside WSL2, the distro stops roughly 10 to 20 s after its last wsl.exe client exits. That is a judgment,
from three observed gaps, each bounded by step times. Linger was set for the owner's account and the tool's SSH session was open
throughout, so neither keeps the distro up, and every route's tree ends with it. Why WSL stops while idle is outside this
card.

## What the WSL2 results leave unproved about a native Linux host

- **How long the OS runs.** On native Linux nothing stops the OS 10 to 20 s after its last client. RL and RS would keep a
  tree as long as the host runs, and that was not measured here.
- **How a session opens and closes.** WSL opens a login session per user, as `login -- rigger-spike` showed, and does not close it
  when the command ends; N2 closed it with `terminate-session`. A native SSH or console logout closes its own session,
  and that was not measured.
- **Starts with no session.** R0's supervisor was started by `setpriv` from root's `/non-systemd` shell. On native Linux, a
  start from a scheduler or another system service lands in that service's cgroup. That cgroup is also root's, but it was not
  measured.
- **Policy.** polkit refused the system manager to an unprivileged user here. A host with a different polkit policy could
  behave differently.
- **logind's settings.** `KillUserProcesses` was `false` and `UserStopDelaySec` was the default. A distribution that sets
  `KillUserProcesses=yes` would also kill session-scope processes at logout. That does not reach RL's or RS's units, but
  it was not measured.
- **Kernel and systemd.** Only kernel 6.18.58.1-microsoft-standard-WSL2 and systemd 259 were measured.

## Recommendation

**For whole-tree containment with no login session, Rigger can rely on RS or on RL. It cannot rely on R0.**

The next card should do these things:

- **Prefer RS.** Install one system unit, a template, that runs the engine's supervisor as the unprivileged user with
  `Delegate=yes` and `KillMode=process`. Give each dispatch a child cgroup of the unit's cgroup, and end the dispatch by
  writing the child's cgroup.kill. Do not rely on the unit's own cgroup.kill, which stays root's (rsa). RS needs root
  once, at install, and nothing at run time.
- **Use RL where a system unit cannot be installed but linger can be set.** Start the supervisor through the user manager,
  as rla and rlc did with `systemd-run --user` and `-p Delegate=yes`, or with a user unit. Treat linger as a precondition the
  engine checks at start, where `loginctl show-user` reads `Linger=yes`.
- **Under either route, record each dispatch's cgroup path durably,** so that the next start can write cgroup.kill to an
  orphan. N3 showed that this works under both routes with no session open. It is the cgroup analogue of `R-STATE-10`.
- **Refuse R0 for unattended work.** A supervisor with neither linger nor a system unit has no writable cgroup when no
  session is open. If it started under a session, the user manager's stop ends its whole tree, supervisor included, about
  10 s after the last session closes (r0c). The engine should detect this case and refuse, rather than run without
  containment.
- **Under WSL2, state that a dispatch lives only as long as some wsl.exe client keeps the distro up.**

The next card must not assume these things:

- That a WSL login session closes when its command ends (s2).
- That the user manager's stop is harmless to a tree started under a session without linger. It sent `SIGTERM` and then
  `SIGKILL` to everything in the unit (r0c).
- That the unit's own cgroup is writable under RS (rsa).
- That every WSL login of a user opens a session. After a `terminate-session` in one distro instance, the next two logins
  of that user in that instance opened none (rlb, rsb; see "What failed").

**What would reverse the recommendation:**

- A native Linux host on which a system unit's `Delegate=yes` child cgroup is not writable by the unit's `User=`, or on
  which linger does not keep the user manager running with no session.
- A distribution or policy that stops lingering user managers, or kills units, at the last logout.
- A target that forbids both installing a system unit and setting linger. Rigger would then have no whole-tree
  containment with no session. Its fallback would be today's process-group route, with its gap at M6.
- Evidence that WSL2 keeps a distro up with no wsl.exe client. That would make WSL fit for long unattended runs, which
  this report finds it is not.

## What this would change, as a proposal

This section is a proposal for the PM, the architect and the owner. The pull request changes none of these.

| Document | What the recommendation would change |
|---|---|
| `D13` | It makes macOS v0's only host. A Linux host's containment backend would need a system unit or linger as an install precondition |
| `R-STATE-17` | It defines containment as a process group plus a census of the dispatch's directory. A delegated child cgroup per dispatch would also hold M6 |
| `R-STATE-9`, `R-STATE-10` and `R-STATE-11` | On the killed-outright path, the next start ends each recorded group. On Linux the recorded thing would be a cgroup path, which N3 showed a fresh process can reach with no session |
| `ARCHITECTURE.md`, "Failure model" | L0's containment paragraph, and what the engine checks at start on Linux: linger or a system unit |

## What failed

| Step | What happened | Why | Full output |
|---|---|---|---|
| r0a | The driver stopped after its first records, and no case ran | The interop powershell.exe that `winrec` starts read the rest of the script from `bash -s`'s stdin. Every later driver runs its body as a function with stdin from `/dev/null` | `docs/spikes/whole-tree-without-a-session/failed-runs/r0a.txt` |
| rlb | N2 under RL: no `rigger-spike` login session appeared, so the supervisor never started under one. The run went on and wrote cgroup.kill, 0.412 ms, but it is not an N2 run and is not counted | It followed r0c in the same distro instance, where the spike had ended WSL's login session for that user with `terminate-session`. Why WSL then opened no session is not known. The drivers since abort N2 when no session appears | `docs/spikes/whole-tree-without-a-session/failed-runs/rlb.txt` |
| rsb | N2 under RS: the same as rlb; 1.720 ms, not counted | The same | `docs/spikes/whole-tree-without-a-session/failed-runs/rsb.txt` |
| f1, f1b, f1c, f1d | Four attempts at the final Windows listing hung. Each time, `ssh` gave up after 2 minutes with `Timeout, server 10.0.0.29 not responding.` Each left processes running on Windows (see "Processes the spike started but did not record at their start") | Not root-caused. Each attempt fed PowerShell the record's 153 pid-and-time pairs on stdin. Small scripts on the same route worked (w6, w7), and so did f1e, which had no pairs; the comparison moved to the laptop (c1, c2) | `docs/spikes/whole-tree-without-a-session/failed-runs/f1.txt`, `docs/spikes/whole-tree-without-a-session/failed-runs/f1b.txt`, `docs/spikes/whole-tree-without-a-session/failed-runs/f1c.txt`, `docs/spikes/whole-tree-without-a-session/failed-runs/f1d.txt` |
| w5 | A connectivity check whose `ver` cmd.exe did not parse. It exited 1, but showed that the host answered | Quoting through cmd.exe | in the transcript, step w5 |
| round 1's process record | It gave the sixteen member lines of rlb's and rsb's N2 runs the boot id of rlc's and rsc's reruns | `docs/spikes/whole-tree-without-a-session/source/gen-record.py` kept one supervisor boot per run name, not one per execution. The generator was fixed, and step c3 checks the result (see "The process record") | the record itself, regenerated |
| s1 | Its process scan recorded the owner's SSH login and user-manager processes as the spike's | The scan recorded every new process in user.slice. s2 voided the eight lines with a dated note, without deleting them, and the scan was narrowed to the spike's own tree before s2 | in the transcript, step s1 |

Three steps were repeated without failing:

- s3 deleted the user before the N2 reruns, so s4 recreated it
  ([1459#7106924301](https://github.com/williacj/rigger/issues/1459#issuecomment-7106924301)) and s5 deleted it again.
- f2 was superseded by f2b.
- f1e and c1 were superseded by f1f and c2.

All of their output is in the transcript.

**Commits and pushes.** Each commit and each push ran through the runner, wrapped in the main checkout's copy of
`tools/coordinator/suite-slot.sh` with the label 1459-maker and `caffeinate -dims`. Their step ids begin with `k`. For each
commit the transcript keeps the suite's summary, its failing lines and the sha256 of that step's full output; the output
itself is about 8 to 10 MB each. The hooks refused three:

- **k1, the first commit, was refused.** The pre-commit suite failed, with files such as
  `test/bare-mkdtemp-check.test.mjs` reporting `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'acorn'`. The worktree
  had no `node_modules`. Step k0 ran `npm ci`, and the commit was made again.

- **k14 and k15, later versions of the rewrite's commit, were refused.** In k14, of 6040 tests one failed and two were
  cancelled, all on time limits: `test/loop.test.mjs` line 5559 waited 5 s, and `test/verb-facts.test.mjs` line 220 ran past
  60 s. In k15 only the first failed again. The suite had passed at k13 on the same base, and the change since was to evidence
  and prose. The laptop's 5-minute load read 44.71 just after k15, so other work was loading it. Run alone in step t1, the test
  at line 5559 passed. That the load caused the two refusals is a judgment from those premises.

k10 to k13, and k16, made the rewrite's commit locally, and none was pushed. After k10, the masking was found to have dropped the
carriage returns some outputs hold, so the files were masked again with them kept. After k11, main had moved, so k12
made it again on the new main. After k12, this report's citation of the masking check was corrected in k13. After k13,
an independent check asked for this revision. Four fresh readers then read the whole session log, a quarter each, and what they
found was masked too. k16 made that version. A second check asked for a last set of changes, and the commit was amended.

**CI's `fast` job failed at round 2's head.** It is a CI run on an earlier head, kept off-repo, which tested that head merged
into main at fbddb4b1.

- **What failed:** 1 of 6034 tests, the one at `test/run.test.mjs` line 264. It expected the four cards' columns to read
  `Coding`. Card 40 read `Ready`.
- **Why is not known.** The test passes the CLI run's standard error as its assertion message. Node printed its generated
  message instead, so that text was empty, and the log holds nothing else from that run.
- **It is probably not this change.** That is a judgment, from two premises. The change touched only documentation,
  evidence and `doc-references.json`, and the failing test reads none of them. The same tree passed the local suite at
  k8, with 6018 tests passing.
- **The job that aggregates the required checks failed too,** because `fast` had.

`docs/spikes/whole-tree-without-a-session/ci-fast-excerpt.txt` keeps the summary, the failing lines and the full
log's sha256. Steps ci1 and ci2 fetched and read the log. The log that `gh run view --log` returned stopped early, so round 2's
judge could not see the failing lines; the run's log archive holds all of it.

## Custody

### The transcript

`docs/spikes/whole-tree-without-a-session/transcript.txt` is the step runner's transcript, with an `ABOUTME` line added
above its first entry. It holds:

- every command run on the WSL2 machine and the Windows machine;
- each laptop step run through the runner: the final listings, the comparisons, the checks, and every commit and push up to
  k9, which pushed round 2's head, and then the rewrite's own steps up to its commit.

Each entry carries its exact argv, its stdin, its UTC start and end, the host and its output, as masked and
shortened under "What is masked". Inside a WSL step, each line the script printed carries its own UTC time.

`docs/spikes/whole-tree-without-a-session/session-log.txt` holds the tool calls in the spike engineer's session record up to
k7, with their UTC times, host, input and result: the laptop commands outside the runner, the writing of this report, and
the GitHub comments. It was generated by #1430's `docs/spikes/whole-tree-containment/rerun/gen-session-log.py`, with only its
header lines changed, as `docs/spikes/whole-tree-without-a-session/source/gen-session-log.py`, and then masked.

**Scope of the record.** Neither file holds everything, so each one's limit is stated here:

- **The session log** stops where round 2's did. Two pull request comments and the rewrite's calls outside the runner came
  after that. A result the harness saved to a file holds only a preview, and a background command holds only its launch
  notice.
- **The runner's transcript** cannot hold the output of the commit that adds it, nor of the push after it.

### What is masked

The owner ruled that the branch be rewritten as one commit, with the names of processes, programs and accounts that are
not the spike's own masked in the evidence
([1459#7090274068](https://github.com/williacj/rigger/issues/1459#issuecomment-7090274068)). The ruling says masking is
accepted and is not an evidence gap.

- **What may stay** is the spike's own processes and the host tools its commands invoke. Everything else reads
  `[name withheld]`: process, program, application, service and account names, command lines, and paths that hold one. In a
  home directory's path, only the account is masked.
- **What was kept.** Every pid and every creation time is as it was. A check over every process row in every file found none
  changed (steps mask-check2 to mask-check5). The first run, mask-check, counted one: a word beside it had been masked, not
  its pid or time, and the masking was corrected.
- **Masking went by what may stay,** so some harmless words are masked too, above all in the session log.
- **Encoded text.** The base64 copies of the spike's source files in s1, s2 and s4's stdin are replaced by a note, because
  an encoded copy would have carried masked text. The masked sources are under
  `docs/spikes/whole-tree-without-a-session/source/`. They are evidence and no longer run as they stand.
- **Suite output.** k1, k2, k4, k6, k8, k10, k11, k12, k13, k14, k15 and k16 keep the suite's summary, its failing lines and the sha256 of the step's full output.
- **Masks are one fixed string,** and the column padding beside a mask is cut to one space, so neither shows a name's length.
  Masks that stood together are one mask.
- **Other values.** The addresses in p2's socket and session listings read `[address withheld]`. WSL's distro and VM ids read
  `[id withheld]`; the boot ids stay, because they are part of a process's creation identity. The sizes of listed files whose
  text is masked read `[size withheld]`, with other listed sizes beside them.
- **Hashes.** The owner ruled that a hash which would let someone confirm a guess at withheld content is dropped
  ([1459#7104456293](https://github.com/williacj/rigger/issues/1459#issuecomment-7104456293)). It reads
  `[sha256 withheld]`, for privacy, and the hash is kept off-repo. That covers every step's stdin hash, every hash in
  the session log, and the hash of every masked file but the three largest, whose withheld content no one could guess whole.
- **Earlier heads** of this branch are not named. They read `[earlier head]`, and they are kept off-repo.
- **Deleted comments.** Four comments this report links were deleted and reposted masked under the same ruling, and the
  links go to the reposts: 7106919811, 7106921307, 7106922830 and 7106924301.
- **The originals** are the files at an earlier head, kept off-repo. Each masked file's header names its original's sha256 or
  says it is withheld, and this table repeats it:

| File | Original's sha256 |
|---|---|
| `docs/journal/2026-11-22-0450-1459-whole-tree-without-a-session.md` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session.md` | e7c99c36003b611c9f7f08b3bfb7590c81d25ca32dfd433083916a59b91761e9 |
| `docs/spikes/whole-tree-without-a-session/failed-runs/r0a.txt` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session/failed-runs/rlb.txt` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session/failed-runs/rsb.txt` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session/process-record.txt` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session/session-log.txt` | 991bc027989c90c3449b5100ec4dde2f9672770ac9d8258d97c90d19498a6205 |
| `docs/spikes/whole-tree-without-a-session/source/gen-s1.py` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session/source/gen-unrecorded.py` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session/source/lib.sh` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session/source/s1-versions/lib.sh` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session/source/s1-versions/list.cjs` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session/source/s1-versions/supervisor.cjs` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session/source/s1-versions/writer.cjs` | withheld for privacy (1459#7104456293) |
| `docs/spikes/whole-tree-without-a-session/transcript.txt` | e6ab7b80e5e14039f0f3e335996888fee352b2f736dfbeaa7236a623341b423f |

### The credential scan

Steps scan1 and scan2 ran the scan script from the gitignored spike directory (spikes/1459-spike-engineer/scan.sh)
through the runner, and its stdin is verbatim in the transcript. scan2 is the scan of record. It ran after the refused
first commit, over the 27 files then under `docs/spikes/whole-tree-without-a-session/`, together with this report and the
journal entry:

```
$ grep -rnIiE 'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|BEGIN [A-Z ]*PRIVATE KEY|bearer [A-Za-z0-9._-]{20,}|(password|passwd|secret|token|api[_-]?key)[[:space:]]*[:=][[:space:]]*[^[:space:]]{8,}' $F | cut -c1-220
```

Every line it matched is the text of a credential scan, not a credential:

- lines 940 and 954 of `docs/spikes/whole-tree-without-a-session/session-log.txt`, which are #1430's own scan commands,
  read in #1430's report;
- the lines of scan1's transcript entry that print this pattern or those two matches;
- this report's quotation of the pattern, above.

scan3 ran again before the pull request's second commit, over the refreshed transcript and session log. Every line it
matched was again scan text: scan1's and scan2's entries, the session log's copies of them, and this report's quotation.
The copies made after scan3 add scan3's own entry, which matches the same way.

Round 2 ran scan4, the same script, over the files as revised. Step scan4b then ran the same pattern again, but dropped
every matched line that holds the scan command itself, `grep -rnIiE`, or the phrase "the same pattern". It printed
nothing and exited 1, so every match scan4 found is the text of a scan.

A second scan, for email addresses, found only the following:

- systemd unit names: `user@0.service`, `user@1001.service`, two units of the host's own and the
  `fx1459-rs@` instances;
- the commit trailer address noreply@anthropic.com.

The rewrite ran the same scan again over the masked files, as steps scan5 and scan6. Every line it matched is again the text of a
scan, or of the edit that quoted one. No token, key or account address is in the evidence. The line numbers above are those of the files as scanned then.

### Files written outside the spike's own directories

| Host | File | Reason | Removed |
|---|---|---|---|
| WSL2 | One `rigger-spike` line in each of `/etc/passwd`, `/etc/shadow`, `/etc/group`, `/etc/gshadow`, `/etc/subuid` and `/etc/subgid`, written twice (s2, s4) | the user under test | Yes. After s5 the line counts were back to 28, 28, 57, 57, 1 and 1, and `grep -c rigger-spike` printed 0 for each |
| WSL2 | `/home/rigger-spike/`, from `/etc/skel`, holding the spike's directory | the user's home | Yes, by `userdel -r` (s3, s5). `ls -ld /home/rigger-spike` printed `No such file or directory` |
| WSL2 | `/var/lib/systemd/linger/rigger-spike` | RL | Yes, by `loginctl disable-linger rigger-spike` at the end of rla and of rlc. s5's `ls -la /var/lib/systemd/linger` lists only the owner's file |
| WSL2 | `/etc/systemd/system/fx1459-rs@.service` | RS | Yes. rsa and rsc printed `removed '/etc/systemd/system/fx1459-rs@.service'` and `No files found for fx1459-rs@x.service.` |
| WSL2 | `/run/user/1001` and the transient unit files in it | the user manager's runtime | Yes. s5's `ls` printed `No such file or directory` |
| WSL2 | 1459-spike-engineer in the owner's WSL home, the spike's first directory | s1, before the user existed | Yes. s2 moved it into the user's home, and s5's `ls` printed `No such file or directory` |
| WSL2 | the system and user journals' entries for the units and sessions | systemd logs them | No. Removing them means editing the host's journal, so they are left, as #1430 left them |
| WSL2 | cgroups under user-1001.slice and `system-fx1459\x2drs.slice` | kernel state, not files | Yes. f2b's `ls -d` printed `No such file or directory` for both |
| Windows | none | — | — |
| Laptop | none outside the worktree, its gitignored spike directory (spikes/1459-spike-engineer) and the harness's own task-output files | — | — |

### Host-configuration changes

The stated intent went up before the first change, at
[1459#7073278550](https://github.com/williacj/rigger/issues/1459#issuecomment-7073278550). It was revised under the
owner's ruling at [1459#7106922830](https://github.com/williacj/rigger/issues/1459#issuecomment-7106922830). The user's
recreation was posted at [1459#7106924301](https://github.com/williacj/rigger/issues/1459#issuecomment-7106924301).

The sibling notice went up at [1458#7073754425](https://github.com/williacj/rigger/issues/1458#issuecomment-7073754425),
[1460#7073754779](https://github.com/williacj/rigger/issues/1460#issuecomment-7073754779),
[1462#7073755271](https://github.com/williacj/rigger/issues/1462#issuecomment-7073755271) and
[1463#7073755664](https://github.com/williacj/rigger/issues/1463#issuecomment-7073755664). rigger-ae answered for all four
before any N2 run: [1458#7074112110](https://github.com/williacj/rigger/issues/1458#issuecomment-7074112110),
[1460#7074112309](https://github.com/williacj/rigger/issues/1460#issuecomment-7074112309),
[1462#7074112520](https://github.com/williacj/rigger/issues/1462#issuecomment-7074112520) and
[1463#7074112693](https://github.com/williacj/rigger/issues/1463#issuecomment-7074112693).

| Host | Change | Reverted |
|---|---|---|
| WSL2 | `useradd -m -s /bin/bash -U rigger-spike` (s2, then again in s4) | Yes, by `userdel -r rigger-spike` (s3, s5). After s5, `getent passwd rigger-spike` and `getent group rigger-spike` each exited 2 |
| WSL2 | `loginctl enable-linger rigger-spike` (rla, rlc) | Yes, by `loginctl disable-linger rigger-spike` at the end of each |
| WSL2 | `/etc/systemd/system/fx1459-rs@.service`, then `systemctl daemon-reload` (rsa, rsc) | Yes. The file was removed, then `daemon-reload` and `reset-failed` ran |

The spike made no other change. It did not touch the owner's account or its linger: s5 printed `Linger=yes` for it, as found. It
installed no package, changed neither .wslconfig nor `/etc/wsl.conf`, ran no WSL restart or shutdown command, and
changed nothing on Windows.

**The Mac mini was not used.**

### The process record

`docs/spikes/whole-tree-without-a-session/process-record.txt` lists every process that counts, one per line. Each entry
gives:

- the host;
- the pid;
- the creation time:
  - on WSL2, the boot id plus the `/proc` starttime, which is how the kernel reports it, with the UTC time derived from it
    beside them;
  - on Windows, `Win32_Process.CreationDate` in UTC;
- the UTC time the entry was recorded;
- the step in which it was recorded.

Each entry was written as the process started, by the process that started it, or by the step's own script before the
step returned. Either way it is earlier than the next command on that host.

- **The supervisor and each fresh writer** record themselves first.
- **The fixture** records each member as it starts it.
- **Each driver** records:
  - its own bash and its `/init` parents;
  - when its connection started the distro, every process of that start except the owner's;
  - every new process of the spike's own: the script's descendants, the user's processes, its units' processes, and
    root's session for the spike's own connection;
  - through interop, its connection's Windows chain and any WSL VM process started since that connection began.

The eight s1 entries for the owner's processes stay in the record, marked void by the dated note s2 wrote.

**Round 1 of this record gave sixteen fixture-member lines the wrong boot id.** These were the members of rlb's and rsb's
N2 runs. The generator kept one boot per run name, so those members took the later boot of rlc and rsc. Now each member
takes the boot of the supervisor execution that started it, which is the latest supervisor of its run name recorded
before the member. Step c3 checks every member line against that rule. On the corrected record it printed:

```
72 member entries checked, 0 carry a boot other than their own supervisor execution's
```

The same check on round 1's record, as step c3old, printed
`72 member entries checked, 16 carry a boot other than their own supervisor execution's`.


### Processes the spike started but did not record at their start

**This is a defect in the spike, and it cannot be recovered.** The card requires every process that counts to be recorded
as it starts. The processes below count under that definition, and none was recorded at its start. A pid found
afterwards is a disclosure, not a record, so they stay out of the record's REC lines. The owner's standing rule for the
Temporal track's spikes ([1453#7087640218](https://github.com/williacj/rigger/issues/1453#issuecomment-7087640218))
accepts an unrecoverable gap when the report lists it exactly and admits the defect. This is that list.

`docs/spikes/whole-tree-without-a-session/source/gen-unrecorded.py` generated these lines from the transcript's own
listings. The same lines close `docs/spikes/whole-tree-without-a-session/process-record.txt`, under an `UNRECORDED`
heading.

**The four hung listing sessions on Windows (f1, f1b, f1c, f1d).** When `ssh` gave up on each, its Windows session went
on running. w8 found the 20 processes afterwards, with the creation times below. rigger-ae later ended all 20 on the
owner's authorization. It first matched each `sshd`'s creation time to this report, and a follow-up listing found none
alive ([1459#7085291842](https://github.com/williacj/rigger/issues/1459#issuecomment-7085291842)).

| Attempt | `sshd -R` | `sshd -z` | cmd.exe | conhost.exe | powershell.exe |
|---|---|---|---|---|---|
| f1 | 14528, 04:25:10.147Z | 16668, 04:25:10.366Z | 38256, 04:25:10.397Z | 36460, 04:25:10.400Z | 37980, 04:25:10.415Z |
| f1b | 752, 04:27:16.129Z | 9284, 04:27:16.326Z | 12384, 04:27:16.356Z | 23476, 04:27:16.359Z | 33160, 04:27:16.371Z |
| f1c | 20460, 04:29:38.018Z | 37344, 04:29:38.375Z | 3572, 04:29:38.406Z | 12604, 04:29:38.409Z | 12240, 04:29:38.422Z |
| f1d | 23332, 04:31:47.610Z | 2500, 04:31:47.856Z | 37188, 04:31:47.883Z | 27504, 04:31:47.885Z | 37096, 04:31:47.899Z |

All the times are on 2026-11-22, in UTC, from `Win32_Process.CreationDate`.

**The three read-only probes, p0b, p1 and p2, which ran before any recording existed.**

- p0b's and p1's connections each started the WSL distro, and each also started the VM.
- Their WSL processes, other than the owner's, are listed below with the creation time each probe's `ps` printed, in whole
  seconds, in UTC. That covers the distro's start, the probe's own chain, root's login session and root's user manager.
- p1's listing filtered out one kind of system worker process, so those pids are unknown.
- p1's Windows VM processes are listed with their creation times. p0b printed no Windows listing, so its VM's pids are
  unknown.
- p2's connection restarted the distro, but p2 printed only the owner's and `sshd`'s processes. Of its processes, only its
  `sshd` listener is known.
- The probes' own Windows connection chains (`sshd`, cmd.exe, conhost.exe and wsl.exe) are unknown. Every later WSL step
  recorded its own.

**The laptop.** The step runner prints its pid only when a step ends. Some steps ran from a shell the harness had put in
the background. For those, the shell, the runner and the runner's child were still running when the Bash call returned.
Their pids are known from each step's header, but their creation times are not. That covers w9-1, w10-1, f2b, f1f, c2
and the commits and pushes k1, k2 and k4 to k9. For k1, k2, k4, k6 and k8 it also covers every process the commit
hook's test suite started, and for k7 every process the pre-push hook started. The harness's Monitor loop, which watched for the sibling answers, never printed its pid. f4, a laptop listing
taken after k5, f5, taken after k7, and f6, taken before the rewrite's commit, show none of the known laptop pids alive.

The rewrite's steps ran through a second version of the runner, which records itself, its shell and its command, with
their creation times, as each starts. Those records are in each step's transcript entry. The rewrite's commit is recorded
the same way, but no commit can hold its own record; it is reported on the pull request.

The complete list:

```
UNRECORDED step=p0b host=wsl pid=1 ppid=0 user=root created="Sun Nov 22 02:57:19 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=2 ppid=1 user=root created="Sun Nov 22 02:57:19 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=/init
UNRECORDED step=p0b host=wsl pid=3 ppid=2 user=root created="Sun Nov 22 02:57:19 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=7 ppid=2 user=root created="Sun Nov 22 02:57:19 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=45 ppid=1 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=62 ppid=1 user=[name withheld] created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=84 ppid=1 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=96 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=97 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=98 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=99 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=100 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=101 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=102 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=103 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=104 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=105 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=106 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=107 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=108 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=109 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=110 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=111 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=112 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=113 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=114 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=115 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=116 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=117 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=118 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=119 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=120 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=121 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=122 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=123 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=124 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=125 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=126 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=127 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=128 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=129 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=130 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=131 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=132 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=133 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=134 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=135 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=136 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=137 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=138 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=140 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=141 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=142 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=143 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=144 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=145 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=146 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=147 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=148 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=149 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=150 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=151 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=152 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=153 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=154 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=155 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=156 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=157 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=158 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=159 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=160 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=161 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=162 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=163 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=164 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=165 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=166 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=167 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=168 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=169 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=170 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=171 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=172 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=173 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=174 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=175 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=176 ppid=84 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=206 ppid=1 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=207 ppid=1 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=208 ppid=1 user=[name withheld] created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=215 ppid=1 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=218 ppid=1 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=220 ppid=1 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=228 ppid=1 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=241 ppid=1 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=245 ppid=1 user=[name withheld] created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=267 ppid=206 user=[name withheld] created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=295 ppid=1 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=301 ppid=267 user=[name withheld] created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=341 ppid=1 user=root created="Sun Nov 22 02:57:20 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=413 ppid=1 user=root created="Sun Nov 22 02:57:21 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=p0b host=wsl pid=419 ppid=2 user=root created="Sun Nov 22 02:57:21 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=/init
UNRECORDED step=p0b host=wsl pid=420 ppid=419 user=root created="Sun Nov 22 02:57:21 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=/init
UNRECORDED step=p0b host=wsl pid=421 ppid=420 user=root created="Sun Nov 22 02:57:21 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=bash -s fx1459p0
UNRECORDED step=p0b host=wsl pid=422 ppid=2 user=root created="Sun Nov 22 02:57:21 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=login -- root
UNRECORDED step=p0b host=wsl pid=465 ppid=1 user=root created="Sun Nov 22 02:57:21 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=/usr/lib/systemd/systemd --user
UNRECORDED step=p0b host=wsl pid=467 ppid=465 user=root created="Sun Nov 22 02:57:21 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=(sd-pam)
UNRECORDED step=p0b host=wsl pid=491 ppid=422 user=root created="Sun Nov 22 02:57:21 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=-bash
UNRECORDED step=p0b host=wsl pid=577 ppid=421 user=root created="Sun Nov 22 02:57:21 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=ps -eo pid,ppid,user,lstart,cgroup:60,args --sort=pid
UNRECORDED step=p0b host=wsl pid=578 ppid=421 user=root created="Sun Nov 22 02:57:21 2026" (ps lstart, UTC, whole seconds) listed-in=p0b why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=cut -c1-260
UNRECORDED step=p1 host=wsl pid=1 ppid=0 user=root created="Sun Nov 22 02:59:22 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=2 ppid=1 user=root created="Sun Nov 22 02:59:22 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=/init
UNRECORDED step=p1 host=wsl pid=3 ppid=2 user=root created="Sun Nov 22 02:59:22 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=7 ppid=2 user=root created="Sun Nov 22 02:59:22 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=45 ppid=1 user=root created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=80 ppid=1 user=[name withheld] created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=88 ppid=1 user=root created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=206 ppid=1 user=root created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=207 ppid=1 user=root created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=208 ppid=1 user=[name withheld] created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=212 ppid=1 user=root created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=215 ppid=1 user=root created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=216 ppid=1 user=root created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=221 ppid=1 user=root created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=239 ppid=1 user=root created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=240 ppid=1 user=[name withheld] created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=260 ppid=206 user=[name withheld] created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=294 ppid=1 user=root created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=298 ppid=260 user=[name withheld] created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=340 ppid=1 user=root created="Sun Nov 22 02:59:23 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=407 ppid=1 user=root created="Sun Nov 22 02:59:24 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=[name withheld]
UNRECORDED step=p1 host=wsl pid=413 ppid=2 user=root created="Sun Nov 22 02:59:24 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=/init
UNRECORDED step=p1 host=wsl pid=414 ppid=413 user=root created="Sun Nov 22 02:59:24 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=/init
UNRECORDED step=p1 host=wsl pid=415 ppid=414 user=root created="Sun Nov 22 02:59:24 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=bash -s fx1459p1
UNRECORDED step=p1 host=wsl pid=416 ppid=2 user=root created="Sun Nov 22 02:59:24 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=login -- root
UNRECORDED step=p1 host=wsl pid=456 ppid=1 user=root created="Sun Nov 22 02:59:24 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=/usr/lib/systemd/systemd --user
UNRECORDED step=p1 host=wsl pid=460 ppid=456 user=root created="Sun Nov 22 02:59:24 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=(sd-pam)
UNRECORDED step=p1 host=wsl pid=484 ppid=416 user=root created="Sun Nov 22 02:59:24 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=-bash
UNRECORDED step=p1 host=wsl pid=515 ppid=415 user=root created="Sun Nov 22 02:59:24 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=ps -eo pid,ppid,user,lstart,cgroup:60,args --sort=pid
UNRECORDED step=p1 host=wsl pid=517 ppid=415 user=root created="Sun Nov 22 02:59:24 2026" (ps lstart, UTC, whole seconds) listed-in=p1 why=probe-before-recording-existed;its-connection-started-the-WSL-distro;[name withheld]-lines-were-filtered-out-of-this-listing args=cut -c1-240
UNRECORDED step=p1 host=windows pid=33528 ppid=37656 created=2026-11-22T02:59:21.846Z listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name=conhost.exe \??\C:\WINDOWS\system32\conhost.exe 0x4
UNRECORDED step=p1 host=windows pid=5140 ppid=7344 created=2026-11-22T02:59:21.884Z listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name=vmwp.exe "C:\WINDOWS\System32\vmwp.exe" [id withheld] 0x3a8
UNRECORDED step=p1 host=windows pid=36912 ppid=5140 created=2026-11-22T02:59:21.901Z listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name=vmmemWSL 
UNRECORDED step=p1 host=windows pid=26976 ppid=4384 created=2026-11-22T02:59:22.680Z listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name=wslrelay.exe --mode 1 --[name withheld] [id withheld] --handle 3672
UNRECORDED step=p1 host=windows pid=10084 ppid=4384 created=2026-11-22T02:59:22.999Z listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name=wslhost.exe --[name withheld] [id withheld] --handle 3716
UNRECORDED step=p1 host=windows pid=35140 ppid=10084 created=2026-11-22T02:59:23.008Z listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name=conhost.exe \??\C:\WINDOWS\system32\conhost.exe 0x4
UNRECORDED step=p1 host=windows pid=27748 ppid=4384 created=2026-11-22T02:59:23.084Z listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name=wslhost.exe --[name withheld] [id withheld] --handle 3716
UNRECORDED step=p1 host=windows pid=23216 ppid=27748 created=2026-11-22T02:59:23.093Z listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name=conhost.exe \??\C:\WINDOWS\system32\conhost.exe 0x4
UNRECORDED step=p1 host=windows pid=9648 ppid=28064 created=2026-11-22T02:59:24.424Z listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name=wslhost.exe --[name withheld] [id withheld] --[name withheld] [id withheld]
UNRECORDED step=p1 host=windows pid=32832 ppid=9648 created=2026-11-22T02:59:24.433Z listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name=conhost.exe \??\C:\WINDOWS\system32\conhost.exe 0x4
UNRECORDED step=p1 host=windows pid=22208 ppid=36552 created=2026-11-22T02:59:25.099Z listed-in=p1 why=probe-before-recording-existed;VM-or-WSL-host-process-that-could-outlive-the-command name=conhost.exe \??\C:\WINDOWS\system32\conhost.exe 0x4
UNRECORDED step=p2 host=wsl pid=385 ppid=1 user=root created="Sun Nov 22 03:06:11 2026" listed-in=p2 why=probe-before-recording-existed;its-connection-started-the-WSL-distro args=[name withheld]
UNRECORDED step=f1..f1d host=windows pid=14528 ppid=4156 created=2026-11-22T04:25:10.147Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=sshd.exe "C:\WINDOWS\System32\OpenSSH\sshd.exe" -R
UNRECORDED step=f1..f1d host=windows pid=16668 ppid=14528 created=2026-11-22T04:25:10.366Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=sshd.exe "C:\WINDOWS\System32\OpenSSH\sshd.exe" -z
UNRECORDED step=f1..f1d host=windows pid=38256 ppid=16668 created=2026-11-22T04:25:10.397Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=[name withheld]
UNRECORDED step=f1..f1d host=windows pid=36460 ppid=38256 created=2026-11-22T04:25:10.400Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=conhost.exe \??\C:\WINDOWS\system32\conhost.exe 0x4
UNRECORDED step=f1..f1d host=windows pid=37980 ppid=38256 created=2026-11-22T04:25:10.415Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=powershell.exe powershell -NoProfile -NonInteractive -Command -
UNRECORDED step=f1..f1d host=windows pid=752 ppid=4156 created=2026-11-22T04:27:16.129Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=sshd.exe "C:\WINDOWS\System32\OpenSSH\sshd.exe" -R
UNRECORDED step=f1..f1d host=windows pid=9284 ppid=752 created=2026-11-22T04:27:16.326Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=sshd.exe "C:\WINDOWS\System32\OpenSSH\sshd.exe" -z
UNRECORDED step=f1..f1d host=windows pid=12384 ppid=9284 created=2026-11-22T04:27:16.356Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=[name withheld]
UNRECORDED step=f1..f1d host=windows pid=23476 ppid=12384 created=2026-11-22T04:27:16.359Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=conhost.exe \??\C:\WINDOWS\system32\conhost.exe 0x4
UNRECORDED step=f1..f1d host=windows pid=33160 ppid=12384 created=2026-11-22T04:27:16.371Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=powershell.exe powershell -NoProfile -NonInteractive -Command -
UNRECORDED step=f1..f1d host=windows pid=20460 ppid=4156 created=2026-11-22T04:29:38.018Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=sshd.exe "C:\WINDOWS\System32\OpenSSH\sshd.exe" -R
UNRECORDED step=f1..f1d host=windows pid=37344 ppid=20460 created=2026-11-22T04:29:38.375Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=sshd.exe "C:\WINDOWS\System32\OpenSSH\sshd.exe" -z
UNRECORDED step=f1..f1d host=windows pid=3572 ppid=37344 created=2026-11-22T04:29:38.406Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=[name withheld]
UNRECORDED step=f1..f1d host=windows pid=12604 ppid=3572 created=2026-11-22T04:29:38.409Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=conhost.exe \??\C:\WINDOWS\system32\conhost.exe 0x4
UNRECORDED step=f1..f1d host=windows pid=12240 ppid=3572 created=2026-11-22T04:29:38.422Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=powershell.exe powershell -NoProfile -NonInteractive -Command -
UNRECORDED step=f1..f1d host=windows pid=23332 ppid=4156 created=2026-11-22T04:31:47.610Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=sshd.exe "C:\WINDOWS\System32\OpenSSH\sshd.exe" -R
UNRECORDED step=f1..f1d host=windows pid=2500 ppid=23332 created=2026-11-22T04:31:47.856Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=sshd.exe "C:\WINDOWS\System32\OpenSSH\sshd.exe" -z
UNRECORDED step=f1..f1d host=windows pid=37188 ppid=2500 created=2026-11-22T04:31:47.883Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=[name withheld]
UNRECORDED step=f1..f1d host=windows pid=27504 ppid=37188 created=2026-11-22T04:31:47.885Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=conhost.exe \??\C:\WINDOWS\system32\conhost.exe 0x4
UNRECORDED step=f1..f1d host=windows pid=37096 ppid=37188 created=2026-11-22T04:31:47.899Z listed-in=w8 why=hung-listing-session-left-running-after-ssh-gave-up;found-afterwards;ended-later-by-rigger-ae(1459#7085291842) name=powershell.exe powershell -NoProfile -NonInteractive -Command -
UNRECORDED step=w9-1 host=laptop pid=397 created=unknown (the step started 2026-11-22T04:37:27.987Z) why=step-runner-in-a-background-shell-still-running-when-the-Bash-call-returned;pid-printed-only-at-step-end name=node orch.cjs; its child ssh pid=498, and the background shell's [name withheld] pid=396
UNRECORDED step=w10-1 host=laptop pid=46004 created=unknown (the step started 2026-11-22T04:39:23.707Z) why=the-same name=node orch.cjs; its child ssh pid=46012, and the [name withheld] pid=46003
UNRECORDED step=f2b host=laptop pid=46020 created=unknown (the step started 2026-11-22T04:39:24.124Z) why=the-same name=node orch.cjs; its child ssh pid=46042, and the background shell pid=40806
UNRECORDED step=f1f host=laptop pid=91936 created=unknown (the step started 2026-11-22T04:41:17.618Z) why=the-same name=node orch.cjs; its child ssh pid=91970, and the background shell pid=48764
UNRECORDED step=c2 host=laptop pid=92038 created=unknown (the step started 2026-11-22T04:41:18.589Z) why=the-same name=node orch.cjs; its child python3 pid=92044, under the background shell pid=48764
UNRECORDED step=k1 host=laptop pid=87392 created=unknown (the step started 2026-11-22T04:51:03.179Z) why=the-harness-moved-the-Bash-call-to-the-background-after-180-s name=node orch.cjs; its child suite-slot.sh pid=87394, under the shell pid=87365, and every process the commit hook's test suite started
UNRECORDED step=k2 host=laptop pid=19311 created=unknown (the step started 2026-11-22T04:57:47.845Z) why=step-runner-in-a-background-shell name=node orch.cjs; its child suite-slot.sh pid=19312, under the background shell pid=19304, and every process the commit hook's test suite started
UNRECORDED step=k4 host=laptop pid=25506 created=unknown (the step started 2026-11-22T05:07:13.014Z) why=step-runner-in-a-background-shell name=node orch.cjs; its child suite-slot.sh pid=25510, under the background shell pid=25505, and every process the commit hook's test suite started
UNRECORDED step=k5 host=laptop pid=37413 created=unknown (the step started 2026-11-22T05:15:02.820Z) why=step-runner-in-a-background-shell name=node orch.cjs; its child suite-slot.sh pid=37414, under the background shell pid=25505
UNRECORDED step=k6 host=laptop pid=90749 created=unknown (the step started 2026-11-22T23:36:01.041Z) why=step-runner-in-a-background-shell name=node orch.cjs; its child suite-slot.sh pid=90753, under the background shell pid=90748, and every process the commit hook's test suite started
UNRECORDED step=k7 host=laptop pid=9742 created=unknown (the step started 2026-11-22T23:44:04.131Z) why=step-runner-in-a-background-shell name=node orch.cjs; its child suite-slot.sh pid=9743, under the background shell pid=90748, and every process the pre-push hook started
UNRECORDED step=k8 host=laptop pid=26243 created=unknown (the step started 2026-11-22T23:52:36.718Z) why=step-runner-in-a-background-shell name=node orch.cjs; its child suite-slot.sh pid=26244, under the background shell pid=26230, and every process the commit hook's test suite started
UNRECORDED step=k9 host=laptop pid=38950 created=unknown (the step started 2026-11-23T00:00:33.937Z) why=step-runner-in-a-background-shell name=node orch.cjs; its child suite-slot.sh pid=38951, under the background shell pid=26230
UNRECORDED step=- host=laptop pid=unknown created=unknown (about 2026-11-22T03:50Z to 04:19Z) why=the-harness-Monitor-loop-that-watched-for-sibling-answers;never-printed-its-pid name=bash loop running gh api and sleep
UNRECORDED step=p0b host=windows pid=unknown created=unknown (about 2026-11-22T02:57:17Z) why=p0b-started-the-WSL-VM-before-any-recording-existed-and-printed-no-Windows-listing name=vmwp.exe, vmmemWSL, wslrelay.exe, wslhost.exe and their conhost.exe
UNRECORDED step=p2 host=wsl pid=unknown created=unknown (about 2026-11-22T03:06:11Z) why=p2's-connection-started-the-distro-before-recording-existed;its-listing-printed-only-[name withheld]'s-and-sshd's-processes name=the-distro's-start-processes,root's-login-session-and-user-manager-for-p2's-connection
UNRECORDED step=p0b,p1,p2 host=windows pid=unknown created=unknown why=each-probe-connection's-sshd,cmd.exe,conhost.exe,wsl.exe-chain;recorded-for-every-later-WSL-step-but-not-for-the-probes name=sshd.exe,cmd.exe,conhost.exe,wsl.exe
```

### After the last run, no recorded process is alive

Each host's final listing is quoted whole below, with every process's pid and creation time. Each listing was then
compared with the corrected record by `docs/spikes/whole-tree-without-a-session/source/cmp-final.py`. The comparison
matches on the host's creation identity:

- on WSL2, the boot id, the pid and the `/proc` starttime;
- on Windows, the pid and `Win32_Process.CreationDate`;
- on the laptop, the pid and the `ps` start time.

**WSL2, step f2b** (2026-11-22T04:39:25Z, in a distro instance started after rsc). The listing gives the pid, the `/proc`
starttime, the `ps` `lstart` and the arguments. Its own last lines checked round 1's record:

```
date 2026-11-22T04:39:25.276840866Z boot_id b7aea7c3-a116-46b4-9610-75a534a80142 uptime 219.07
--- every process: PID STARTTIME(ticks since boot) LSTART ARGS
1 21718 Sun Nov 22 04:39:23 2026 [name withheld]
100 21780 Sun Nov 22 04:39:23 2026 [name withheld]
101 21780 Sun Nov 22 04:39:23 2026 [name withheld]
102 21780 Sun Nov 22 04:39:23 2026 [name withheld]
103 21780 Sun Nov 22 04:39:23 2026 [name withheld]
104 21780 Sun Nov 22 04:39:23 2026 [name withheld]
105 21780 Sun Nov 22 04:39:23 2026 [name withheld]
106 21780 Sun Nov 22 04:39:23 2026 [name withheld]
107 21780 Sun Nov 22 04:39:23 2026 [name withheld]
108 21780 Sun Nov 22 04:39:23 2026 [name withheld]
109 21780 Sun Nov 22 04:39:23 2026 [name withheld]
110 21780 Sun Nov 22 04:39:23 2026 [name withheld]
111 21780 Sun Nov 22 04:39:23 2026 [name withheld]
112 21780 Sun Nov 22 04:39:23 2026 [name withheld]
113 21780 Sun Nov 22 04:39:23 2026 [name withheld]
114 21780 Sun Nov 22 04:39:23 2026 [name withheld]
115 21780 Sun Nov 22 04:39:23 2026 [name withheld]
116 21780 Sun Nov 22 04:39:23 2026 [name withheld]
117 21780 Sun Nov 22 04:39:23 2026 [name withheld]
118 21780 Sun Nov 22 04:39:23 2026 [name withheld]
119 21780 Sun Nov 22 04:39:23 2026 [name withheld]
120 21780 Sun Nov 22 04:39:23 2026 [name withheld]
121 21780 Sun Nov 22 04:39:23 2026 [name withheld]
122 21780 Sun Nov 22 04:39:23 2026 [name withheld]
123 21780 Sun Nov 22 04:39:23 2026 [name withheld]
124 21780 Sun Nov 22 04:39:23 2026 [name withheld]
125 21780 Sun Nov 22 04:39:23 2026 [name withheld]
126 21780 Sun Nov 22 04:39:23 2026 [name withheld]
127 21780 Sun Nov 22 04:39:23 2026 [name withheld]
128 21780 Sun Nov 22 04:39:23 2026 [name withheld]
129 21780 Sun Nov 22 04:39:23 2026 [name withheld]
130 21780 Sun Nov 22 04:39:23 2026 [name withheld]
131 21780 Sun Nov 22 04:39:23 2026 [name withheld]
132 21780 Sun Nov 22 04:39:23 2026 [name withheld]
133 21780 Sun Nov 22 04:39:23 2026 [name withheld]
134 21780 Sun Nov 22 04:39:23 2026 [name withheld]
135 21780 Sun Nov 22 04:39:23 2026 [name withheld]
136 21781 Sun Nov 22 04:39:23 2026 [name withheld]
137 21781 Sun Nov 22 04:39:23 2026 [name withheld]
138 21781 Sun Nov 22 04:39:23 2026 [name withheld]
139 21781 Sun Nov 22 04:39:23 2026 [name withheld]
140 21781 Sun Nov 22 04:39:23 2026 [name withheld]
141 21781 Sun Nov 22 04:39:23 2026 [name withheld]
142 21781 Sun Nov 22 04:39:23 2026 [name withheld]
143 21781 Sun Nov 22 04:39:23 2026 [name withheld]
144 21781 Sun Nov 22 04:39:23 2026 [name withheld]
145 21781 Sun Nov 22 04:39:23 2026 [name withheld]
146 21781 Sun Nov 22 04:39:23 2026 [name withheld]
147 21781 Sun Nov 22 04:39:23 2026 [name withheld]
148 21781 Sun Nov 22 04:39:23 2026 [name withheld]
149 21781 Sun Nov 22 04:39:23 2026 [name withheld]
150 21781 Sun Nov 22 04:39:23 2026 [name withheld]
151 21781 Sun Nov 22 04:39:23 2026 [name withheld]
153 21781 Sun Nov 22 04:39:23 2026 [name withheld]
154 21781 Sun Nov 22 04:39:23 2026 [name withheld]
155 21781 Sun Nov 22 04:39:23 2026 [name withheld]
156 21781 Sun Nov 22 04:39:23 2026 [name withheld]
157 21781 Sun Nov 22 04:39:23 2026 [name withheld]
158 21781 Sun Nov 22 04:39:23 2026 [name withheld]
160 21781 Sun Nov 22 04:39:23 2026 [name withheld]
162 21781 Sun Nov 22 04:39:23 2026 [name withheld]
163 21781 Sun Nov 22 04:39:23 2026 [name withheld]
165 21781 Sun Nov 22 04:39:23 2026 [name withheld]
167 21781 Sun Nov 22 04:39:23 2026 [name withheld]
168 21781 Sun Nov 22 04:39:23 2026 [name withheld]
169 21781 Sun Nov 22 04:39:23 2026 [name withheld]
170 21781 Sun Nov 22 04:39:23 2026 [name withheld]
172 21781 Sun Nov 22 04:39:23 2026 [name withheld]
173 21781 Sun Nov 22 04:39:23 2026 [name withheld]
174 21781 Sun Nov 22 04:39:23 2026 [name withheld]
175 21781 Sun Nov 22 04:39:23 2026 [name withheld]
176 21781 Sun Nov 22 04:39:23 2026 [name withheld]
177 21781 Sun Nov 22 04:39:23 2026 [name withheld]
178 21781 Sun Nov 22 04:39:23 2026 [name withheld]
179 21781 Sun Nov 22 04:39:23 2026 [name withheld]
180 21781 Sun Nov 22 04:39:23 2026 [name withheld]
181 21781 Sun Nov 22 04:39:23 2026 [name withheld]
182 21781 Sun Nov 22 04:39:23 2026 [name withheld]
2 21720 Sun Nov 22 04:39:23 2026 [name withheld]
203 21786 Sun Nov 22 04:39:23 2026 [name withheld]
204 21786 Sun Nov 22 04:39:23 2026 [name withheld]
205 21786 Sun Nov 22 04:39:23 2026 [name withheld]
209 21787 Sun Nov 22 04:39:23 2026 [name withheld]
212 21787 Sun Nov 22 04:39:23 2026 [name withheld]
213 21787 Sun Nov 22 04:39:23 2026 [name withheld]
217 21788 Sun Nov 22 04:39:23 2026 [name withheld]
235 21789 Sun Nov 22 04:39:23 2026 [name withheld]
238 21789 Sun Nov 22 04:39:23 2026 [name withheld]
262 21792 Sun Nov 22 04:39:23 2026 [name withheld]
284 21794 Sun Nov 22 04:39:23 2026 [name withheld]
285 21794 Sun Nov 22 04:39:23 2026 [name withheld]
3 21720 Sun Nov 22 04:39:23 2026 [name withheld]
327 21798 Sun Nov 22 04:39:23 2026 [name withheld]
335 21803 Sun Nov 22 04:39:24 2026 [name withheld]
338 21804 Sun Nov 22 04:39:24 2026 [name withheld]
400 21836 Sun Nov 22 04:39:24 2026 [name withheld]
406 21849 Sun Nov 22 04:39:24 2026 [name withheld]
407 21854 Sun Nov 22 04:39:24 2026 [name withheld]
408 21854 Sun Nov 22 04:39:24 2026 [name withheld]
409 21854 Sun Nov 22 04:39:24 2026 [name withheld]
45 21767 Sun Nov 22 04:39:23 2026 [name withheld]
451 21888 Sun Nov 22 04:39:24 2026 [name withheld]
453 21888 Sun Nov 22 04:39:24 2026 [name withheld]
477 21897 Sun Nov 22 04:39:24 2026 [name withheld]
7 21745 Sun Nov 22 04:39:23 2026 [name withheld]
77 21770 Sun Nov 22 04:39:23 2026 [name withheld]
84 21773 Sun Nov 22 04:39:23 2026 [name withheld]
97 21780 Sun Nov 22 04:39:23 2026 [name withheld]
98 21780 Sun Nov 22 04:39:23 2026 [name withheld]
99 21780 Sun Nov 22 04:39:23 2026 [name withheld]
--- recorded entries checked: boot pid starttime
checked 1022 recorded WSL entries against boot b7aea7c3-a116-46b4-9610-75a534a80142: 0 match on boot, pid and starttime
$ ls -d /sys/fs/cgroup/system.slice/system-fx1459\x2drs.slice /sys/fs/cgroup/user.slice/user-1001.slice
ls: cannot access '/sys/fs/cgroup/system.slice/system-fx1459\x2drs.slice': No such file or directory
ls: cannot access '/sys/fs/cgroup/user.slice/user-1001.slice': No such file or directory
date end 2026-11-22T04:39:25.838428265Z
```

Step c4 compared it with the corrected record:

```
wsl: 110 processes listed, 1008 record entries, 0 match on the creation identity []
```

**Windows, step f1f** (2026-11-22T04:41:17Z). Before masking, it listed no `vmmemWSL` and no vmwp.exe, so the WSL VM had
stopped. The four hung sessions from the previous section were still alive at this point. Their names and times show in
this listing, because the spike started them:

```
date 2026-11-22T04:41:17.3030723Z  processes: 334
--- every process: PID CREATED(UTC) NAME
0 2026-11-10T18:59:47.915Z [name withheld]
4 2026-11-10T18:59:47.915Z [name withheld]
300 2026-11-14T23:53:34.647Z [name withheld]
432 2026-11-10T18:59:45.842Z [name withheld]
468 2026-11-10T18:59:45.877Z [name withheld]
752 2026-11-22T04:27:16.129Z sshd.exe
1152 2026-11-10T18:59:47.940Z [name withheld]
1276 2026-11-10T18:59:53.408Z [name withheld]
1364 2026-11-10T18:59:52.033Z [name withheld]
1460 2026-11-10T18:59:52.971Z [name withheld]
1468 2026-11-10T18:59:52.972Z [name withheld]
1560 2026-11-10T18:59:53.061Z [name withheld]
1584 2026-11-10T18:59:53.064Z [name withheld]
1616 2026-11-10T19:01:55.287Z [name withheld]
1628 2026-11-10T18:59:53.094Z [name withheld]
1636 2026-11-10T18:59:53.097Z [name withheld]
1788 2026-11-10T18:59:53.271Z [name withheld]
1804 2026-11-14T23:55:14.577Z [name withheld]
1820 2026-11-10T18:59:53.285Z [name withheld]
1828 2026-11-10T18:59:53.285Z [name withheld]
1876 2026-11-18T15:23:15.494Z [name withheld]
1920 2026-11-10T18:59:53.325Z [name withheld]
1940 2026-11-10T18:59:53.429Z [name withheld]
1968 2026-11-10T18:59:53.339Z [name withheld]
2044 2026-11-10T18:59:53.392Z [name withheld]
2060 2026-11-10T18:59:53.443Z [name withheld]
2076 2026-11-10T18:59:53.445Z [name withheld]
2156 2026-11-10T18:59:53.451Z [name withheld]
2176 2026-11-10T18:59:55.320Z [name withheld]
2240 2026-11-10T18:59:53.584Z [name withheld]
2244 2026-11-10T18:59:53.458Z [name withheld]
2280 2026-11-10T18:59:53.470Z [name withheld]
2344 2026-11-10T18:59:53.476Z [name withheld]
2404 2026-11-10T18:59:53.498Z [name withheld]
2428 2026-11-20T02:24:53.571Z [name withheld]
2480 2026-11-10T18:59:53.513Z [name withheld]
2500 2026-11-22T04:31:47.856Z sshd.exe
2516 2026-11-14T23:53:37.483Z [name withheld]
2564 2026-11-11T16:28:30.867Z [name withheld]
2600 2026-11-10T18:59:53.537Z [name withheld]
2676 2026-11-10T18:59:53.544Z [name withheld]
2684 2026-11-10T18:59:53.544Z [name withheld]
2692 2026-11-10T18:59:53.544Z [name withheld]
2700 2026-11-10T18:59:53.544Z [name withheld]
2728 2026-11-10T19:02:01.367Z [name withheld]
2864 2026-11-10T18:59:53.555Z [name withheld]
2892 2026-11-10T18:59:53.559Z [name withheld]
2968 2026-11-10T18:59:53.561Z [name withheld]
2988 2026-11-10T18:59:53.564Z [name withheld]
3040 2026-11-10T18:59:53.569Z [name withheld]
3048 2026-11-10T18:59:53.569Z [name withheld]
3144 2026-11-10T18:59:53.607Z [name withheld]
3184 2026-11-10T18:59:53.613Z [name withheld]
3216 2026-11-14T23:55:58.107Z [name withheld]
3244 2026-11-10T18:59:58.356Z [name withheld]
3252 2026-11-14T23:55:32.902Z [name withheld]
3276 2026-11-10T18:59:53.650Z [name withheld]
3332 2026-11-15T00:31:57.952Z [name withheld]
3488 2026-11-19T02:01:34.831Z [name withheld]
3496 2026-11-10T18:59:53.675Z [name withheld]
3504 2026-11-10T18:59:53.675Z [name withheld]
3512 2026-11-10T18:59:53.676Z [name withheld]
3528 2026-11-10T19:01:55.762Z [name withheld]
3572 2026-11-22T04:29:38.406Z cmd.exe
3588 2026-11-10T18:59:53.698Z [name withheld]
3652 2026-11-10T18:59:53.720Z [name withheld]
3680 2026-11-10T18:59:53.726Z [name withheld]
3724 2026-11-14T23:53:34.702Z [name withheld]
3764 2026-11-10T18:59:53.763Z [name withheld]
3820 2026-11-19T21:51:26.521Z [name withheld]
3824 2026-11-14T23:53:36.295Z [name withheld]
3860 2026-11-10T18:59:53.793Z [name withheld]
3932 2026-11-10T18:59:53.823Z [name withheld]
3988 2026-11-10T18:59:53.841Z [name withheld]
4088 2026-11-10T19:01:55.435Z [name withheld]
4104 2026-11-10T18:59:53.852Z [name withheld]
4112 2026-11-10T18:59:53.852Z [name withheld]
4120 2026-11-10T18:59:53.853Z [name withheld]
4128 2026-11-10T18:59:53.853Z [name withheld]
4136 2026-11-10T18:59:53.853Z [name withheld]
4144 2026-11-10T18:59:53.853Z [name withheld]
4156 2026-11-10T18:59:53.854Z [name withheld]
4164 2026-11-10T18:59:53.854Z [name withheld]
4172 2026-11-10T18:59:53.854Z [name withheld]
4180 2026-11-10T18:59:53.854Z [name withheld]
4192 2026-11-10T18:59:53.855Z [name withheld]
4244 2026-11-10T18:59:53.857Z [name withheld]
4252 2026-11-10T18:59:53.857Z [name withheld]
4260 2026-11-10T18:59:53.857Z [name withheld]
4332 2026-11-21T13:04:57.034Z [name withheld]
4348 2026-11-10T18:59:53.859Z [name withheld]
4352 2026-11-10T18:59:53.859Z [name withheld]
4384 2026-11-10T18:59:53.859Z [name withheld]
4456 2026-11-14T23:58:57.774Z [name withheld]
4500 2026-11-10T18:59:53.865Z [name withheld]
4540 2026-11-10T20:59:54.602Z [name withheld]
4744 2026-11-14T23:53:34.624Z [name withheld]
4848 2026-11-10T21:21:23.022Z [name withheld]
4864 2026-11-10T18:59:53.932Z [name withheld]
4872 2026-11-10T18:59:53.933Z [name withheld]
4880 2026-11-14T23:53:34.645Z [name withheld]
4924 2026-11-20T16:36:40.069Z [name withheld]
4992 2026-11-10T18:59:53.949Z [name withheld]
5200 2026-11-10T18:59:54.065Z [name withheld]
5216 2026-11-10T18:59:54.075Z [name withheld]
5336 2026-11-10T18:59:54.125Z [name withheld]
5460 2026-11-10T18:59:54.170Z [name withheld]
5468 2026-11-10T18:59:54.170Z [name withheld]
5504 2026-11-14T23:53:36.283Z [name withheld]
5672 2026-11-10T18:59:54.215Z [name withheld]
6204 2026-11-10T18:59:54.573Z [name withheld]
6224 2026-11-10T18:59:54.282Z [name withheld]
6232 2026-11-10T18:59:54.282Z [name withheld]
6240 2026-11-10T18:59:54.282Z [name withheld]
6304 2026-11-10T19:02:00.292Z [name withheld]
6440 2026-11-10T18:59:54.328Z [name withheld]
6548 2026-11-14T23:53:34.882Z [name withheld]
6756 2026-11-18T00:51:05.491Z [name withheld]
6908 2026-11-14T23:56:05.234Z [name withheld]
7236 2026-11-10T19:00:08.377Z [name withheld]
7344 2026-11-10T21:21:50.376Z [name withheld]
7368 2026-11-11T16:28:30.869Z [name withheld]
7460 2026-11-10T19:02:01.655Z [name withheld]
7648 2026-11-21T13:04:55.492Z [name withheld]
7652 2026-11-10T18:59:55.017Z [name withheld]
7704 2026-11-10T18:59:55.252Z [name withheld]
7724 2026-11-21T18:07:39.915Z [name withheld]
7764 2026-11-14T23:53:36.332Z [name withheld]
7816 2026-11-10T19:20:00.947Z [name withheld]
7844 2026-11-10T18:59:55.086Z [name withheld]
7864 2026-11-10T19:02:01.509Z [name withheld]
8000 2026-11-14T23:56:09.389Z [name withheld]
8128 2026-11-20T15:48:29.289Z [name withheld]
8252 2026-11-15T08:44:36.032Z [name withheld]
8292 2026-11-10T19:00:08.368Z [name withheld]
8340 2026-11-10T18:59:55.655Z [name withheld]
8396 2026-11-10T19:02:00.753Z [name withheld]
8408 2026-11-10T18:59:55.743Z [name withheld]
8724 2026-11-10T18:59:55.884Z [name withheld]
8836 2026-11-14T23:59:31.361Z [name withheld]
8844 2026-11-10T18:59:56.089Z [name withheld]
8924 2026-11-14T23:54:05.939Z [name withheld]
9080 2026-11-20T00:45:01.347Z [name withheld]
9128 2026-11-10T18:59:58.254Z [name withheld]
9284 2026-11-22T04:27:16.326Z sshd.exe
9424 2026-11-10T19:00:00.778Z [name withheld]
9496 2026-11-21T18:07:39.704Z [name withheld]
9544 2026-11-14T23:58:54.665Z [name withheld]
9656 2026-11-21T13:04:55.959Z [name withheld]
9676 2026-11-10T19:00:03.139Z [name withheld]
9704 2026-11-10T19:01:55.118Z [name withheld]
9708 2026-11-14T23:55:58.213Z [name withheld]
9740 2026-11-18T00:51:05.533Z [name withheld]
9748 2026-11-10T19:00:03.164Z [name withheld]
9904 2026-11-10T19:02:01.225Z [name withheld]
10000 2026-11-14T23:53:34.790Z [name withheld]
10108 2026-11-11T12:11:35.223Z [name withheld]
10472 2026-11-10T21:21:51.496Z [name withheld]
10660 2026-11-14T23:53:34.652Z [name withheld]
10772 2026-11-14T23:53:35.444Z [name withheld]
10804 2026-11-21T21:42:28.560Z [name withheld]
10848 2026-11-14T23:58:51.785Z [name withheld]
10936 2026-11-14T23:53:39.240Z [name withheld]
11028 2026-11-14T23:53:35.007Z [name withheld]
11192 2026-11-19T01:51:30.287Z [name withheld]
11296 2026-11-11T12:10:42.021Z [name withheld]
11332 2026-11-14T23:53:36.358Z [name withheld]
11424 2026-11-10T21:21:59.434Z [name withheld]
11472 2026-11-10T21:21:59.310Z [name withheld]
11496 2026-11-15T00:03:35.923Z [name withheld]
11728 2026-11-14T23:53:34.632Z [name withheld]
11756 2026-11-15T23:56:42.166Z [name withheld]
11788 2026-11-14T23:53:35.455Z [name withheld]
11808 2026-11-14T23:54:02.681Z [name withheld]
12004 2026-11-14T23:53:34.707Z [name withheld]
12116 2026-11-14T23:53:38.029Z [name withheld]
12240 2026-11-22T04:29:38.422Z powershell.exe
12384 2026-11-22T04:27:16.356Z cmd.exe
12396 2026-11-18T00:46:33.983Z [name withheld]
12604 2026-11-22T04:29:38.409Z conhost.exe
12732 2026-11-18T00:51:05.234Z [name withheld]
12744 2026-11-14T23:55:14.223Z [name withheld]
12800 2026-11-14T23:53:34.588Z [name withheld]
13104 2026-11-14T23:53:34.660Z [name withheld]
13160 2026-11-19T21:51:25.009Z [name withheld]
13264 2026-11-19T21:51:26.517Z [name withheld]
13480 2026-11-22T04:41:16.887Z [name withheld]
13564 2026-11-18T15:23:15.271Z [name withheld]
13628 2026-11-18T00:46:34.228Z [name withheld]
13712 2026-11-14T23:53:36.595Z [name withheld]
13928 2026-11-14T23:53:36.664Z [name withheld]
13936 2026-11-14T23:53:36.664Z [name withheld]
14092 2026-11-15T08:44:35.734Z [name withheld]
14188 2026-11-14T23:53:36.840Z [name withheld]
14364 2026-11-14T23:53:36.907Z [name withheld]
14528 2026-11-22T04:25:10.147Z sshd.exe
14576 2026-11-14T23:59:31.350Z [name withheld]
14584 2026-11-14T23:58:49.149Z [name withheld]
14740 2026-11-21T13:04:55.881Z [name withheld]
14776 2026-11-14T23:56:11.660Z [name withheld]
14888 2026-11-14T23:53:37.180Z [name withheld]
15236 2026-11-14T23:53:37.404Z [name withheld]
15388 2026-11-14T23:58:51.004Z [name withheld]
15688 2026-11-14T23:53:38.026Z [name withheld]
15916 2026-11-14T23:53:37.945Z [name withheld]
15936 2026-11-14T23:53:37.946Z [name withheld]
15996 2026-11-14T23:53:37.958Z [name withheld]
16192 2026-11-14T23:58:53.905Z [name withheld]
16668 2026-11-22T04:25:10.366Z sshd.exe
17228 2026-11-14T23:59:33.007Z [name withheld]
17496 2026-11-15T00:02:33.366Z [name withheld]
17524 2026-11-14T23:53:41.369Z [name withheld]
17644 2026-11-21T13:04:55.842Z [name withheld]
17736 2026-11-14T23:53:43.497Z [name withheld]
17868 2026-11-19T20:21:51.273Z [name withheld]
17884 2026-11-14T23:56:02.590Z [name withheld]
17972 2026-11-22T04:19:58.158Z [name withheld]
18028 2026-11-19T16:55:07.155Z [name withheld]
18240 2026-11-14T23:59:32.778Z [name withheld]
18288 2026-11-19T21:51:23.200Z [name withheld]
18804 2026-11-14T23:53:49.580Z [name withheld]
18904 2026-11-22T03:04:43.182Z [name withheld]
19016 2026-11-14T23:53:43.746Z [name withheld]
19036 2026-11-15T23:56:42.246Z [name withheld]
19104 2026-11-19T20:21:20.121Z [name withheld]
19116 2026-11-18T15:23:16.824Z [name withheld]
19200 2026-11-19T16:55:07.159Z [name withheld]
19352 2026-11-14T23:54:03.260Z [name withheld]
19472 2026-11-22T04:41:16.912Z [name withheld]
19604 2026-11-21T18:07:39.928Z [name withheld]
19704 2026-11-19T21:51:26.595Z [name withheld]
20460 2026-11-22T04:29:38.018Z sshd.exe
20508 2026-11-14T23:53:46.635Z [name withheld]
20936 2026-11-19T16:55:06.821Z [name withheld]
21480 2026-11-18T00:51:39.395Z [name withheld]
21732 2026-11-14T23:55:58.372Z [name withheld]
22120 2026-11-14T23:53:50.124Z [name withheld]
22212 2026-11-22T04:41:16.589Z [name withheld]
22600 2026-11-19T21:54:13.044Z [name withheld]
22912 2026-11-14T23:59:31.362Z [name withheld]
22932 2026-11-15T00:11:35.265Z [name withheld]
23016 2026-11-18T15:23:17.547Z [name withheld]
23332 2026-11-22T04:31:47.610Z sshd.exe
23476 2026-11-22T04:27:16.359Z conhost.exe
23560 2026-11-14T23:53:51.350Z [name withheld]
23892 2026-11-14T23:54:03.202Z [name withheld]
24196 2026-11-19T20:21:51.251Z [name withheld]
24412 2026-11-14T23:54:03.112Z [name withheld]
24500 2026-11-14T23:55:15.286Z [name withheld]
24552 2026-11-19T21:51:23.266Z [name withheld]
24644 2026-11-14T23:54:50.014Z [name withheld]
25072 2026-11-18T15:23:15.497Z [name withheld]
25112 2026-11-15T18:49:31.329Z [name withheld]
25120 2026-11-14T23:54:04.664Z [name withheld]
25312 2026-11-14T23:54:40.014Z [name withheld]
25380 2026-11-14T23:59:00.224Z [name withheld]
25468 2026-11-21T13:04:55.916Z [name withheld]
25724 2026-11-20T01:53:13.960Z [name withheld]
26104 2026-11-14T23:56:02.324Z [name withheld]
26396 2026-11-21T13:04:55.882Z [name withheld]
26416 2026-11-18T22:42:41.249Z [name withheld]
26444 2026-11-18T00:51:38.330Z [name withheld]
26580 2026-11-20T00:41:05.097Z [name withheld]
26656 2026-11-14T23:59:31.478Z [name withheld]
26820 2026-11-18T15:23:17.552Z [name withheld]
26924 2026-11-18T22:42:41.255Z [name withheld]
27036 2026-11-14T23:58:54.435Z [name withheld]
27220 2026-11-20T16:28:09.981Z [name withheld]
27484 2026-11-18T00:46:33.910Z [name withheld]
27504 2026-11-22T04:31:47.885Z conhost.exe
27896 2026-11-14T23:58:53.965Z [name withheld]
27964 2026-11-19T21:51:25.516Z [name withheld]
28380 2026-11-14T23:59:30.936Z [name withheld]
28424 2026-11-20T21:42:02.781Z [name withheld]
28500 2026-11-18T15:23:14.803Z [name withheld]
28896 2026-11-22T04:41:16.772Z [name withheld]
29004 2026-11-18T00:46:33.916Z [name withheld]
29024 2026-11-15T08:55:02.394Z [name withheld]
29072 2026-11-18T15:23:17.646Z [name withheld]
29352 2026-11-14T23:58:55.431Z [name withheld]
29420 2026-11-14T23:58:51.727Z [name withheld]
29432 2026-11-18T00:51:39.643Z [name withheld]
29480 2026-11-21T21:42:48.945Z [name withheld]
29532 2026-11-18T15:23:17.421Z [name withheld]
29816 2026-11-15T00:31:59.006Z [name withheld]
30088 2026-11-18T22:42:47.927Z [name withheld]
30096 2026-11-18T00:46:30.042Z [name withheld]
30200 2026-11-18T15:23:15.096Z [name withheld]
30300 2026-11-15T00:31:57.348Z [name withheld]
30968 2026-11-21T18:07:39.934Z [name withheld]
31060 2026-11-18T00:46:22.577Z [name withheld]
31116 2026-11-19T21:51:23.764Z [name withheld]
31176 2026-11-16T21:00:19.772Z [name withheld]
31180 2026-11-19T21:51:25.157Z [name withheld]
31240 2026-11-18T00:51:39.374Z [name withheld]
31676 2026-11-20T15:48:52.667Z [name withheld]
31732 2026-11-19T20:21:51.269Z [name withheld]
31736 2026-11-20T16:41:18.501Z [name withheld]
32072 2026-11-22T04:41:16.895Z [name withheld]
32096 2026-11-21T13:04:57.247Z [name withheld]
32116 2026-11-21T18:07:39.910Z [name withheld]
32200 2026-11-18T00:51:05.493Z [name withheld]
32288 2026-11-22T03:05:41.979Z [name withheld]
32324 2026-11-22T02:57:20.207Z [name withheld]
32412 2026-11-18T15:23:15.056Z [name withheld]
32564 2026-11-18T15:23:15.170Z [name withheld]
32764 2026-11-18T22:42:47.921Z [name withheld]
33160 2026-11-22T04:27:16.371Z powershell.exe
33600 2026-11-22T04:35:46.592Z [name withheld]
33648 2026-11-19T21:51:27.132Z [name withheld]
33732 2026-11-18T20:07:29.596Z [name withheld]
34200 2026-11-20T00:39:06.559Z [name withheld]
34368 2026-11-18T01:23:51.328Z [name withheld]
34480 2026-11-18T00:51:39.462Z [name withheld]
34828 2026-11-21T18:07:39.873Z [name withheld]
34964 2026-11-19T21:51:23.270Z [name withheld]
35112 2026-11-21T21:42:28.588Z [name withheld]
35692 2026-11-18T15:23:17.426Z [name withheld]
35740 2026-11-20T15:49:36.266Z [name withheld]
35908 2026-11-22T03:45:51.028Z [name withheld]
36056 2026-11-22T03:04:45.112Z [name withheld]
36260 2026-11-18T00:53:11.606Z [name withheld]
36364 2026-11-21T21:42:48.986Z [name withheld]
36460 2026-11-22T04:25:10.400Z conhost.exe
36656 2026-11-22T03:38:30.598Z [name withheld]
37096 2026-11-22T04:31:47.899Z powershell.exe
37188 2026-11-22T04:31:47.883Z cmd.exe
37228 2026-11-21T21:42:49.004Z [name withheld]
37344 2026-11-22T04:29:38.375Z sshd.exe
37908 2026-11-22T02:59:22.597Z [name withheld]
37980 2026-11-22T04:25:10.415Z powershell.exe
38068 2026-11-21T13:04:56.026Z [name withheld]
38124 2026-11-22T04:41:17.074Z [name withheld]
38256 2026-11-22T04:25:10.397Z cmd.exe
```

Step c5 compared it with the corrected record:

```
windows: 334 processes listed, 194 record entries, 0 match on the creation identity []
```

**Laptop, step f3** (2026-11-22T04:41Z):

```
    1 Wed Nov 11 07:54:35 2026 [name withheld]
  211 Sat Nov 21 21:31:58 2026 [name withheld]
  532 Wed Nov 11 07:56:13 2026 [name withheld]
  535 Wed Nov 11 07:56:13 2026 [name withheld]
  537 Wed Nov 11 07:56:13 2026 [name withheld]
  538 Wed Nov 11 07:56:13 2026 [name withheld]
  542 Wed Nov 11 07:56:13 2026 [name withheld]
  546 Wed Nov 11 07:56:13 2026 [name withheld]
  548 Wed Nov 11 07:56:13 2026 [name withheld]
  549 Wed Nov 11 07:56:13 2026 [name withheld]
  553 Wed Nov 11 07:56:13 2026 [name withheld]
  557 Wed Nov 11 07:56:13 2026 [name withheld]
  559 Wed Nov 11 07:56:13 2026 [name withheld]
  562 Wed Nov 11 07:56:13 2026 [name withheld]
  564 Wed Nov 11 07:56:13 2026 [name withheld]
  565 Wed Nov 11 07:56:13 2026 [name withheld]
  569 Wed Nov 11 07:56:13 2026 [name withheld]
  571 Wed Nov 11 07:56:13 2026 [name withheld]
  572 Wed Nov 11 07:56:13 2026 [name withheld]
  573 Wed Nov 11 07:56:13 2026 [name withheld]
  574 Wed Nov 11 07:56:13 2026 [name withheld]
  576 Wed Nov 11 07:56:13 2026 [name withheld]
  577 Wed Nov 11 07:56:13 2026 [name withheld]
  578 Wed Nov 11 07:56:13 2026 [name withheld]
  579 Wed Nov 11 07:56:13 2026 [name withheld]
  580 Wed Nov 11 07:56:13 2026 [name withheld]
  582 Wed Nov 11 07:56:13 2026 [name withheld]
  585 Wed Nov 11 07:56:13 2026 [name withheld]
  586 Wed Nov 11 07:56:13 2026 [name withheld]
  589 Wed Nov 11 07:56:13 2026 [name withheld]
  592 Wed Nov 11 07:56:13 2026 [name withheld]
  593 Wed Nov 11 07:56:13 2026 [name withheld]
  594 Wed Nov 11 07:56:13 2026 [name withheld]
  598 Wed Nov 11 07:56:13 2026 [name withheld]
  599 Wed Nov 11 07:56:13 2026 [name withheld]
  600 Wed Nov 11 07:56:13 2026 [name withheld]
  601 Wed Nov 11 07:56:13 2026 [name withheld]
  602 Wed Nov 11 07:56:13 2026 [name withheld]
  605 Wed Nov 11 07:56:13 2026 [name withheld]
  607 Wed Nov 11 07:56:13 2026 [name withheld]
  608 Wed Nov 11 07:56:13 2026 [name withheld]
  609 Wed Nov 11 07:56:13 2026 [name withheld]
  610 Wed Nov 11 07:56:13 2026 [name withheld]
  613 Wed Nov 11 07:56:13 2026 [name withheld]
  616 Wed Nov 11 07:56:13 2026 [name withheld]
  631 Wed Nov 11 07:56:13 2026 [name withheld]
  638 Wed Nov 11 07:56:13 2026 [name withheld]
  674 Wed Nov 11 07:56:14 2026 [name withheld]
  676 Wed Nov 11 07:56:14 2026 [name withheld]
  680 Wed Nov 11 07:56:14 2026 [name withheld]
  681 Wed Nov 11 07:56:14 2026 [name withheld]
  683 Wed Nov 11 07:56:14 2026 [name withheld]
  684 Wed Nov 11 07:56:14 2026 [name withheld]
  687 Wed Nov 11 07:56:14 2026 [name withheld]
  688 Wed Nov 11 07:56:14 2026 [name withheld]
  692 Wed Nov 11 07:56:14 2026 [name withheld]
  703 Wed Nov 11 07:56:14 2026 [name withheld]
  708 Wed Nov 11 07:56:14 2026 [name withheld]
  710 Wed Nov 11 07:56:14 2026 [name withheld]
  718 Wed Nov 11 07:56:14 2026 [name withheld]
  719 Wed Nov 11 07:56:14 2026 [name withheld]
  721 Wed Nov 11 07:56:14 2026 [name withheld]
  724 Wed Nov 11 07:56:14 2026 [name withheld]
  725 Wed Nov 11 07:56:14 2026 [name withheld]
  726 Wed Nov 11 07:56:14 2026 [name withheld]
  727 Wed Nov 11 07:56:14 2026 [name withheld]
  730 Wed Nov 11 07:56:14 2026 [name withheld]
  732 Wed Nov 11 07:56:14 2026 [name withheld]
  733 Wed Nov 11 07:56:14 2026 [name withheld]
  734 Wed Nov 11 07:56:14 2026 [name withheld]
  738 Wed Nov 11 07:56:14 2026 [name withheld]
  741 Wed Nov 11 07:56:14 2026 [name withheld]
  744 Wed Nov 11 07:56:14 2026 [name withheld]
  765 Wed Nov 11 07:56:15 2026 [name withheld]
  778 Wed Nov 11 07:56:15 2026 [name withheld]
  785 Wed Nov 11 07:56:15 2026 [name withheld]
  792 Wed Nov 11 07:56:15 2026 [name withheld]
  802 Wed Nov 11 07:56:18 2026 [name withheld]
  806 Wed Nov 11 07:56:18 2026 [name withheld]
  813 Wed Nov 11 07:56:18 2026 [name withheld]
  828 Wed Nov 11 07:56:28 2026 [name withheld]
  829 Wed Nov 11 07:56:30 2026 [name withheld]
  830 Wed Nov 11 07:56:30 2026 [name withheld]
  839 Wed Nov 11 07:56:30 2026 [name withheld]
  872 Wed Nov 11 07:56:30 2026 [name withheld]
  916 Wed Nov 11 07:56:30 2026 [name withheld]
  920 Wed Nov 11 07:56:31 2026 [name withheld]
  921 Wed Nov 11 07:56:31 2026 [name withheld]
  927 Wed Nov 11 07:56:31 2026 [name withheld]
  928 Wed Nov 11 07:56:31 2026 [name withheld]
  929 Wed Nov 11 07:56:31 2026 [name withheld]
  933 Wed Nov 11 07:56:31 2026 [name withheld]
  936 Wed Nov 11 07:56:31 2026 [name withheld]
  939 Wed Nov 11 07:56:31 2026 [name withheld]
  941 Wed Nov 11 07:56:31 2026 [name withheld]
  943 Wed Nov 11 07:56:32 2026 [name withheld]
  944 Wed Nov 11 07:56:32 2026 [name withheld]
  945 Wed Nov 11 07:56:32 2026 [name withheld]
  946 Wed Nov 11 07:56:32 2026 [name withheld]
  950 Wed Nov 11 07:56:32 2026 [name withheld]
  951 Wed Nov 11 07:56:32 2026 [name withheld]
  953 Wed Nov 11 07:56:32 2026 [name withheld]
  958 Wed Nov 11 07:56:32 2026 [name withheld]
  959 Wed Nov 11 07:56:32 2026 [name withheld]
  963 Wed Nov 11 07:56:32 2026 [name withheld]
  983 Wed Nov 11 07:56:33 2026 [name withheld]
  984 Wed Nov 11 07:56:34 2026 [name withheld]
  992 Wed Nov 11 07:56:34 2026 [name withheld]
  996 Wed Nov 11 07:56:34 2026 [name withheld]
  998 Wed Nov 11 07:56:35 2026 [name withheld]
  999 Wed Nov 11 07:56:35 2026 [name withheld]
 1001 Wed Nov 11 07:56:35 2026 [name withheld]
 1003 Wed Nov 11 07:56:35 2026 [name withheld]
 1012 Wed Nov 11 07:56:35 2026 [name withheld]
 1013 Wed Nov 11 07:56:35 2026 [name withheld]
 1019 Wed Nov 11 07:56:35 2026 [name withheld]
 1020 Wed Nov 11 07:56:35 2026 [name withheld]
 1026 Wed Nov 11 07:56:35 2026 [name withheld]
 1049 Wed Nov 11 07:56:37 2026 [name withheld]
 1054 Wed Nov 11 07:56:37 2026 [name withheld]
 1056 Wed Nov 11 07:56:37 2026 [name withheld]
 1065 Wed Nov 11 07:56:38 2026 [name withheld]
 1067 Wed Nov 11 07:56:38 2026 [name withheld]
 1068 Wed Nov 11 07:56:38 2026 [name withheld]
 1069 Wed Nov 11 07:56:38 2026 [name withheld]
 1074 Wed Nov 11 07:56:40 2026 [name withheld]
 1080 Wed Nov 11 07:56:41 2026 [name withheld]
 1094 Wed Nov 11 07:56:44 2026 [name withheld]
 1096 Wed Nov 11 07:56:44 2026 [name withheld]
 1097 Wed Nov 11 07:56:44 2026 [name withheld]
 1098 Wed Nov 11 07:56:44 2026 [name withheld]
 1099 Wed Nov 11 07:56:44 2026 [name withheld]
 1105 Wed Nov 11 07:56:44 2026 [name withheld]
 1109 Wed Nov 11 07:56:45 2026 [name withheld]
 1118 Wed Nov 11 07:56:45 2026 [name withheld]
 1123 Wed Nov 11 07:56:46 2026 [name withheld]
 1124 Wed Nov 11 07:56:46 2026 [name withheld]
 1137 Wed Nov 11 07:56:46 2026 [name withheld]
 1145 Wed Nov 11 07:56:46 2026 [name withheld]
 1147 Wed Nov 11 07:56:46 2026 [name withheld]
 1149 Wed Nov 11 07:56:46 2026 [name withheld]
 1156 Wed Nov 11 07:56:46 2026 [name withheld]
 1162 Wed Nov 11 07:56:47 2026 [name withheld]
 1163 Wed Nov 11 07:56:47 2026 [name withheld]
 1171 Wed Nov 11 07:56:47 2026 [name withheld]
 1173 Wed Nov 11 07:56:47 2026 [name withheld]
 1175 Wed Nov 11 07:56:47 2026 [name withheld]
 1184 Wed Nov 11 07:56:48 2026 [name withheld]
 1189 Wed Nov 11 07:56:48 2026 [name withheld]
 1191 Wed Nov 11 07:56:48 2026 [name withheld]
 1192 Wed Nov 11 07:56:48 2026 [name withheld]
 1204 Wed Nov 11 07:56:48 2026 [name withheld]
 1211 Wed Nov 18 19:45:31 2026 [name withheld]
 1216 Wed Nov 18 19:45:31 2026 [name withheld]
 1217 Wed Nov 18 19:45:32 2026 [name withheld]
 1220 Wed Nov 18 19:45:33 2026 [name withheld]
 1222 Wed Nov 18 19:45:34 2026 [name withheld]
 1223 Wed Nov 18 19:45:34 2026 [name withheld]
 1224 Wed Nov 18 19:45:34 2026 [name withheld]
 1226 Wed Nov 18 19:45:35 2026 [name withheld]
 1227 Wed Nov 18 19:45:35 2026 [name withheld]
 1229 Wed Nov 18 19:45:35 2026 [name withheld]
 1230 Wed Nov 18 19:45:36 2026 [name withheld]
 1231 Wed Nov 18 19:45:36 2026 [name withheld]
 1235 Wed Nov 11 07:56:49 2026 [name withheld]
 1236 Wed Nov 18 19:45:37 2026 [name withheld]
 1243 Wed Nov 11 07:56:50 2026 [name withheld]
 1244 Wed Nov 18 19:45:37 2026 [name withheld]
 1245 Wed Nov 11 07:56:50 2026 [name withheld]
 1246 Wed Nov 11 07:56:50 2026 [name withheld]
 1247 Wed Nov 18 19:45:38 2026 [name withheld]
 1248 Wed Nov 18 19:45:38 2026 [name withheld]
 1249 Wed Nov 18 19:45:38 2026 [name withheld]
 1250 Wed Nov 11 07:56:50 2026 [name withheld]
 1251 Wed Nov 11 07:56:50 2026 [name withheld]
 1252 Wed Nov 11 07:56:50 2026 [name withheld]
 1253 Wed Nov 11 07:56:50 2026 [name withheld]
 1254 Wed Nov 18 19:45:38 2026 [name withheld]
 1255 Wed Nov 11 07:56:50 2026 [name withheld]
 1256 Wed Nov 18 19:45:39 2026 [name withheld]
 1257 Wed Nov 18 19:45:39 2026 [name withheld]
 1258 Wed Nov 11 07:56:51 2026 [name withheld]
 1259 Wed Nov 18 19:45:40 2026 [name withheld]
 1260 Wed Nov 18 19:45:40 2026 [name withheld]
 1261 Wed Nov 11 07:56:51 2026 [name withheld]
 1262 Wed Nov 18 19:45:41 2026 [name withheld]
 1264 Wed Nov 18 19:45:41 2026 [name withheld]
 1265 Wed Nov 11 07:56:51 2026 [name withheld]
 1266 Wed Nov 11 07:56:51 2026 [name withheld]
 1267 Wed Nov 18 19:45:41 2026 [name withheld]
 1268 Wed Nov 11 07:56:51 2026 [name withheld]
 1269 Wed Nov 11 07:56:51 2026 [name withheld]
 1270 Wed Nov 11 07:56:51 2026 [name withheld]
 1277 Wed Nov 11 07:56:51 2026 [name withheld]
 1278 Wed Nov 11 07:56:51 2026 [name withheld]
 1281 Wed Nov 11 07:56:51 2026 [name withheld]
 1282 Wed Nov 11 07:56:51 2026 [name withheld]
 1285 Wed Nov 11 07:56:51 2026 [name withheld]
 1288 Wed Nov 11 07:56:51 2026 [name withheld]
 1292 Wed Nov 11 07:56:51 2026 [name withheld]
 1318 Wed Nov 11 07:56:53 2026 [name withheld]
 1319 Wed Nov 11 07:56:53 2026 [name withheld]
 1322 Wed Nov 11 07:56:54 2026 [name withheld]
 1324 Wed Nov 11 07:56:54 2026 [name withheld]
 1326 Wed Nov 11 07:56:54 2026 [name withheld]
 1377 Wed Nov 11 07:56:56 2026 [name withheld]
 1387 Wed Nov 11 07:56:57 2026 [name withheld]
 1419 Wed Nov 11 07:56:57 2026 [name withheld]
 1429 Wed Nov 11 07:56:58 2026 [name withheld]
 1445 Wed Nov 11 07:56:59 2026 [name withheld]
 1459 Wed Nov 11 07:56:59 2026 [name withheld]
 1460 Wed Nov 11 07:56:59 2026 [name withheld]
 1463 Wed Nov 11 07:56:59 2026 [name withheld]
 1464 Wed Nov 11 07:56:59 2026 [name withheld]
 1465 Wed Nov 11 07:57:00 2026 [name withheld]
 1466 Wed Nov 11 07:57:00 2026 [name withheld]
 1485 Wed Nov 11 07:57:00 2026 [name withheld]
 1489 Wed Nov 11 07:57:00 2026 [name withheld]
 1619 Wed Nov 11 07:57:01 2026 [name withheld]
 1649 Wed Nov 11 07:57:01 2026 [name withheld]
 1684 Wed Nov 11 07:57:02 2026 [name withheld]
 1732 Wed Nov 11 07:57:04 2026 [name withheld]
 2005 Wed Nov 11 07:57:09 2026 [name withheld]
 2010 Wed Nov 11 07:57:09 2026 [name withheld]
 2012 Wed Nov 11 07:57:09 2026 [name withheld]
 2017 Wed Nov 11 07:57:09 2026 [name withheld]
 2078 Fri Nov 13 19:06:16 2026 [name withheld]
 2079 Wed Nov 11 07:57:10 2026 [name withheld]
 2110 Wed Nov 11 07:57:11 2026 [name withheld]
 2143 Wed Nov 11 07:57:12 2026 [name withheld]
 2233 Wed Nov 11 07:57:20 2026 [name withheld]
 2234 Wed Nov 11 07:57:20 2026 [name withheld]
 2239 Wed Nov 11 07:57:20 2026 [name withheld]
 2242 Wed Nov 11 07:57:20 2026 [name withheld]
 2335 Wed Nov 11 07:57:36 2026 [name withheld]
 2343 Wed Nov 11 07:57:38 2026 [name withheld]
 2393 Wed Nov 11 07:57:50 2026 [name withheld]
 2394 Wed Nov 11 07:57:50 2026 [name withheld]
 2395 Wed Nov 11 07:57:50 2026 [name withheld]
 2396 Wed Nov 11 07:57:50 2026 [name withheld]
 2397 Wed Nov 11 07:57:50 2026 [name withheld]
 2398 Wed Nov 11 07:57:50 2026 [name withheld]
 2399 Wed Nov 11 07:57:50 2026 [name withheld]
 2400 Wed Nov 11 07:57:50 2026 [name withheld]
 2401 Wed Nov 11 07:57:50 2026 [name withheld]
 2415 Sat Nov 21 18:07:25 2026 [name withheld]
 2493 Wed Nov 11 07:58:00 2026 [name withheld]
 2657 Wed Nov 11 07:58:14 2026 [name withheld]
 2676 Wed Nov 11 07:58:19 2026 [name withheld]
 2738 Mon Nov 16 11:38:59 2026 [name withheld]
 2793 Wed Nov 11 07:58:22 2026 [name withheld]
 2897 Wed Nov 11 07:58:27 2026 [name withheld]
 2899 Wed Nov 11 07:58:27 2026 [name withheld]
 2911 Wed Nov 11 07:58:28 2026 [name withheld]
 2916 Wed Nov 11 07:58:30 2026 [name withheld]
 2928 Wed Nov 11 07:58:32 2026 [name withheld]
 2947 Wed Nov 11 07:58:33 2026 [name withheld]
 2949 Wed Nov 11 07:58:33 2026 [name withheld]
 2953 Wed Nov 11 07:58:35 2026 [name withheld]
 2956 Wed Nov 11 07:58:35 2026 [name withheld]
 2964 Wed Nov 11 07:58:37 2026 [name withheld]
 3153 Wed Nov 11 07:58:43 2026 [name withheld]
 3179 Wed Nov 11 07:58:43 2026 [name withheld]
 3251 Sat Nov 21 20:53:10 2026 [name withheld]
 3440 Sat Nov 21 20:53:11 2026 [name withheld]
 3701 Wed Nov 11 11:06:18 2026 [name withheld]
 4283 Sat Nov 21 18:07:26 2026 [name withheld]
 4544 Sat Nov 21 18:07:26 2026 [name withheld]
 6612 Sat Nov 21 18:16:15 2026 [name withheld]
 7013 Sat Nov 21 20:59:22 2026 [name withheld]
 7016 Sat Nov 21 20:59:22 2026 [name withheld]
 7049 Wed Nov 11 08:01:32 2026 [name withheld]
 8179 Wed Nov 11 08:02:16 2026 [name withheld]
 8296 Thu Nov 19 14:24:04 2026 [name withheld]
 8867 Fri Nov 13 21:57:10 2026 [name withheld]
 8989 Wed Nov 11 11:13:58 2026 [name withheld]
 9249 Sat Nov 21 22:09:43 2026 [name withheld]
 9281 Sat Nov 21 22:09:43 2026 [name withheld]
 9367 Sun Nov 15 20:52:13 2026 [name withheld]
 9448 Sat Nov 21 18:05:00 2026 [name withheld]
 9560 Sat Nov 21 18:24:03 2026 [name withheld]
 9974 Sat Nov 21 22:37:42 2026 [name withheld]
11300 Sat Nov 21 18:16:45 2026 [name withheld]
11351 Sat Nov 21 18:16:46 2026 [name withheld]
11353 Sat Nov 21 18:16:46 2026 [name withheld]
11357 Sat Nov 21 18:16:46 2026 [name withheld]
11361 Sat Nov 21 18:16:46 2026 [name withheld]
11634 Sat Nov 21 18:16:47 2026 [name withheld]
11787 Sat Nov 21 18:16:50 2026 [name withheld]
12060 Sat Nov 21 20:44:22 2026 [name withheld]
13733 Sat Nov 21 18:14:05 2026 [name withheld]
14149 Sat Nov 21 20:45:37 2026 [name withheld]
14179 Sat Nov 21 17:30:49 2026 [name withheld]
14385 Wed Nov 11 08:06:22 2026 [name withheld]
14386 Wed Nov 11 08:06:22 2026 [name withheld]
14426 Sat Nov 21 20:45:37 2026 [name withheld]
14482 Sat Nov 21 20:59:43 2026 [name withheld]
14958 Sat Nov 21 20:45:37 2026 [name withheld]
15042 Sat Nov 21 18:24:15 2026 [name withheld]
15089 Sat Nov 21 17:44:45 2026 [name withheld]
15196 Sat Nov 21 18:24:15 2026 [name withheld]
15386 Sat Nov 21 20:45:38 2026 [name withheld]
15639 Sat Nov 21 20:45:38 2026 [name withheld]
15719 Sat Nov 21 20:45:38 2026 [name withheld]
16101 Sat Nov 21 20:45:38 2026 [name withheld]
16822 Mon Nov 16 17:36:55 2026 [name withheld]
17035 Sun Nov 15 22:19:11 2026 [name withheld]
17036 Sat Nov 21 22:28:25 2026 [name withheld]
17091 Mon Nov 16 17:38:41 2026 [name withheld]
17127 Mon Nov 16 14:52:58 2026 [name withheld]
17648 Sat Nov 21 20:02:10 2026 [name withheld]
18395 Sat Nov 21 20:32:12 2026 [name withheld]
18664 Sat Nov 21 20:32:12 2026 [name withheld]
18808 Mon Nov 16 18:06:07 2026 [name withheld]
18873 Mon Nov 16 18:08:49 2026 [name withheld]
18976 Sat Nov 21 21:48:45 2026 [name withheld]
19143 Sat Nov 21 21:48:45 2026 [name withheld]
19411 Wed Nov 18 10:23:36 2026 [name withheld]
19416 Wed Nov 18 10:23:38 2026 [name withheld]
19494 Sat Nov 21 18:21:53 2026 [name withheld]
19902 Sat Nov 21 20:02:43 2026 [name withheld]
19962 Sat Nov 21 21:21:22 2026 [name withheld]
19963 Sat Nov 14 10:19:36 2026 [name withheld]
20416 Sat Nov 14 10:23:46 2026 [name withheld]
20892 Sat Nov 14 10:28:18 2026 [name withheld]
21459 Sat Nov 21 21:00:37 2026 [name withheld]
21574 Sat Nov 21 22:28:31 2026 [name withheld]
21575 Sat Nov 21 22:28:31 2026 [name withheld]
21585 Sat Nov 14 10:35:26 2026 [name withheld]
21976 Sat Nov 21 20:03:13 2026 [name withheld]
22969 Mon Nov 16 18:27:14 2026 [name withheld]
23008 Sat Nov 21 21:21:24 2026 [name withheld]
24056 Sat Nov 21 21:51:35 2026 [name withheld]
24068 Sat Nov 21 21:51:35 2026 [name withheld]
24519 Sat Nov 21 22:28:36 2026 [name withheld]
24529 Thu Nov 19 09:59:51 2026 [name withheld]
24547 Sat Nov 21 20:13:11 2026 [name withheld]
24552 Sat Nov 21 20:13:11 2026 [name withheld]
25397 Mon Nov 16 19:56:41 2026 [name withheld]
25825 Sat Nov 21 20:24:58 2026 [name withheld]
25886 Sat Nov 21 13:00:41 2026 [name withheld]
25900 Sat Nov 21 20:25:24 2026 [name withheld]
26052 Sat Nov 21 20:25:46 2026 [name withheld]
26058 Sat Nov 21 22:28:39 2026 [name withheld]
26093 Sat Nov 21 20:26:28 2026 [name withheld]
26604 Mon Nov 16 20:24:21 2026 [name withheld]
26795 Sat Nov 21 20:28:39 2026 [name withheld]
26833 Sat Nov 21 20:04:25 2026 [name withheld]
27518 Tue Nov 17 13:48:33 2026 [name withheld]
27710 Wed Nov 18 20:26:08 2026 [name withheld]
27998 Sat Nov 21 18:10:21 2026 [name withheld]
28034 Mon Nov 16 20:36:47 2026 [name withheld]
28156 Mon Nov 16 20:40:39 2026 [name withheld]
28758 Sat Nov 21 18:10:22 2026 [name withheld]
28868 Sat Nov 21 18:19:44 2026 [name withheld]
29115 Mon Nov 16 11:52:16 2026 [name withheld]
29141 Sat Nov 21 18:10:22 2026 [name withheld]
31328 Sat Nov 21 18:05:40 2026 [name withheld]
31330 Sat Nov 21 18:05:40 2026 [name withheld]
31485 Sat Nov 21 21:10:25 2026 [name withheld]
31507 Sat Nov 21 17:44:55 2026 [name withheld]
31603 Sat Nov 21 18:05:41 2026 [name withheld]
31608 Sat Nov 21 18:05:41 2026 [name withheld]
31636 Sat Nov 21 18:05:41 2026 [name withheld]
31638 Sat Nov 21 18:05:41 2026 [name withheld]
31651 Sat Nov 21 18:05:41 2026 [name withheld]
31969 Sat Nov 21 20:47:52 2026 [name withheld]
31971 Tue Nov 17 16:57:23 2026 [name withheld]
33148 Mon Nov 16 10:16:21 2026 [name withheld]
34396 Sat Nov 21 12:29:19 2026 [name withheld]
34789 Sat Nov 21 20:32:28 2026 [name withheld]
34915 Sat Nov 21 21:38:56 2026 [name withheld]
35160 Sat Nov 21 20:32:28 2026 [name withheld]
35333 Mon Nov 16 12:40:49 2026 [name withheld]
35416 Sat Nov 21 20:32:28 2026 [name withheld]
35466 Sat Nov 21 20:32:28 2026 [name withheld]
35476 Sat Nov 21 20:32:28 2026 [name withheld]
35966 Sat Nov 21 20:32:29 2026 [name withheld]
36069 Wed Nov 11 11:31:34 2026 [name withheld]
36323 Sat Nov 21 20:48:02 2026 [name withheld]
37342 Mon Nov 16 11:59:46 2026 [name withheld]
37725 Fri Nov 20 15:33:47 2026 [name withheld]
38071 Sat Nov 21 18:05:57 2026 [name withheld]
38196 Sat Nov 21 16:05:13 2026 [name withheld]
38321 Sat Nov 21 18:10:31 2026 [name withheld]
38700 Sat Nov 14 19:57:26 2026 [name withheld]
38793 Sat Nov 21 21:11:27 2026 [name withheld]
38966 Thu Nov 19 19:05:01 2026 [name withheld]
39290 Sat Nov 21 21:03:19 2026 [name withheld]
39291 Sat Nov 21 21:03:19 2026 [name withheld]
39799 Thu Nov 19 19:05:02 2026 [name withheld]
39831 Sat Nov 21 20:48:09 2026 [name withheld]
40177 Thu Nov 19 07:37:53 2026 [name withheld]
40829 Sat Nov 21 22:18:44 2026 [name withheld]
40915 Mon Nov 16 12:05:54 2026 [name withheld]
41016 Sat Nov 21 20:06:50 2026 [name withheld]
41031 Sat Nov 21 13:32:21 2026 [name withheld]
41037 Sat Nov 21 20:06:52 2026 [name withheld]
41045 Sat Nov 21 20:06:52 2026 [name withheld]
41047 Sat Nov 21 20:06:52 2026 [name withheld]
41050 Sat Nov 21 20:06:52 2026 [name withheld]
41051 Sat Nov 21 20:06:52 2026 [name withheld]
41274 Sat Nov 21 18:10:33 2026 [name withheld]
41363 Sat Nov 21 11:11:20 2026 [name withheld]
41730 Wed Nov 11 08:06:50 2026 [name withheld]
41905 Sat Nov 21 21:20:18 2026 [name withheld]
42198 Sat Nov 21 21:52:06 2026 [name withheld]
42201 Sat Nov 21 21:52:06 2026 [name withheld]
42330 Sat Nov 21 22:10:29 2026 [name withheld]
42414 Sat Nov 21 22:10:29 2026 [name withheld]
42588 Sat Nov 21 22:10:30 2026 [name withheld]
42591 Sat Nov 21 21:20:19 2026 [name withheld]
42614 Sat Nov 21 22:10:30 2026 [name withheld]
42623 Sat Nov 21 18:10:34 2026 [name withheld]
42889 Fri Nov 20 16:13:08 2026 [name withheld]
43062 Wed Nov 11 08:16:02 2026 [name withheld]
43065 Wed Nov 11 08:16:02 2026 [name withheld]
43219 Wed Nov 11 08:16:02 2026 [name withheld]
43759 Sat Nov 21 21:20:21 2026 [name withheld]
43824 Wed Nov 11 08:16:04 2026 [name withheld]
44085 Sat Nov 21 18:10:35 2026 [name withheld]
44290 Sat Nov 14 23:23:00 2026 [name withheld]
44512 Sat Nov 21 18:10:35 2026 [name withheld]
44639 Sat Nov 21 20:15:31 2026 [name withheld]
44641 Sat Nov 21 20:15:31 2026 [name withheld]
44642 Sat Nov 21 20:15:31 2026 [name withheld]
44676 Sat Nov 21 20:15:32 2026 [name withheld]
44792 Sat Nov 21 20:15:32 2026 [name withheld]
44798 Sat Nov 21 20:15:33 2026 [name withheld]
44885 Sat Nov 21 18:10:36 2026 [name withheld]
45368 Wed Nov 11 20:08:47 2026 [name withheld]
45433 Fri Nov 20 18:43:51 2026 [name withheld]
45558 Sat Nov 21 20:54:50 2026 [name withheld]
45714 Sat Nov 21 22:39:19 2026 [name withheld]
45833 Sat Nov 21 13:32:25 2026 [name withheld]
45962 Sat Nov 21 18:06:11 2026 [name withheld]
45989 Fri Nov 20 18:43:51 2026 [name withheld]
46144 Sat Nov 21 11:11:24 2026 [name withheld]
46203 Sat Nov 21 21:20:23 2026 [name withheld]
46330 Sat Nov 21 20:30:56 2026 [name withheld]
46335 Sat Nov 21 20:30:56 2026 [name withheld]
46363 Fri Nov 20 18:43:52 2026 [name withheld]
46372 Fri Nov 20 18:43:52 2026 [name withheld]
46456 Fri Nov 20 18:43:52 2026 [name withheld]
46496 Sat Nov 21 18:14:42 2026 [name withheld]
46555 Sat Nov 21 18:06:11 2026 [name withheld]
46735 Fri Nov 20 18:43:52 2026 [name withheld]
46799 Sat Nov 21 21:20:23 2026 [name withheld]
46829 Sat Nov 21 18:06:12 2026 [name withheld]
46854 Fri Nov 20 18:43:52 2026 [name withheld]
46862 Sat Nov 21 21:20:23 2026 [name withheld]
46888 Sat Nov 21 20:48:24 2026 [name withheld]
46889 Sat Nov 21 20:48:24 2026 [name withheld]
46902 Sat Nov 21 20:48:24 2026 [name withheld]
47025 Sat Nov 21 22:39:29 2026 [name withheld]
47195 Sat Nov 21 20:48:24 2026 [name withheld]
47196 Sat Nov 21 20:48:24 2026 [name withheld]
47199 Sat Nov 21 20:48:24 2026 [name withheld]
47326 Sat Nov 21 12:30:06 2026 [name withheld]
47952 Sat Nov 21 20:48:26 2026 [name withheld]
48167 Sat Nov 21 20:48:26 2026 [name withheld]
48172 Sat Nov 21 20:48:26 2026 [name withheld]
48291 Sat Nov 21 20:48:27 2026 [name withheld]
48425 Sat Nov 21 20:48:27 2026 [name withheld]
48438 Sat Nov 21 20:48:27 2026 [name withheld]
48440 Sat Nov 21 20:48:27 2026 [name withheld]
48441 Sat Nov 21 20:48:27 2026 [name withheld]
48446 Sat Nov 21 20:48:27 2026 [name withheld]
49184 Sat Nov 21 20:16:07 2026 [name withheld]
49220 Sat Nov 21 20:16:07 2026 [name withheld]
49221 Sat Nov 21 20:16:07 2026 [name withheld]
49756 Thu Nov 12 18:53:44 2026 [name withheld]
50144 Sat Nov 21 20:16:09 2026 [name withheld]
50978 Thu Nov 12 19:24:38 2026 [name withheld]
51007 Wed Nov 18 19:05:12 2026 [name withheld]
51018 Thu Nov 12 19:24:59 2026 [name withheld]
52239 Sat Nov 21 10:52:48 2026 [name withheld]
52245 Sat Nov 21 10:52:49 2026 [name withheld]
52246 Sat Nov 21 10:52:50 2026 [name withheld]
52247 Sat Nov 21 10:52:50 2026 [name withheld]
52256 Sat Nov 21 10:52:50 2026 [name withheld]
52260 Sat Nov 21 10:52:50 2026 [name withheld]
52280 Sat Nov 21 10:52:52 2026 [name withheld]
53303 Sat Nov 21 22:40:39 2026 [name withheld]
53973 Fri Nov 20 18:43:58 2026 [name withheld]
53980 Fri Nov 20 18:43:58 2026 [name withheld]
54169 Sat Nov 21 20:38:59 2026 [name withheld]
54211 Sat Nov 21 20:39:00 2026 [name withheld]
54224 Sat Nov 21 20:39:00 2026 [name withheld]
54280 Sat Nov 21 20:39:00 2026 [name withheld]
54321 Sat Nov 21 20:39:01 2026 [name withheld]
54354 Sat Nov 21 20:39:01 2026 [name withheld]
54359 Sat Nov 21 20:39:01 2026 [name withheld]
54381 Sat Nov 21 18:31:11 2026 [name withheld]
54500 Sat Nov 21 18:31:11 2026 [name withheld]
54890 Wed Nov 11 08:30:50 2026 [name withheld]
55156 Sat Nov 21 20:48:37 2026 [name withheld]
55222 Sat Nov 21 20:48:37 2026 [name withheld]
55254 Sat Nov 21 18:13:26 2026 [name withheld]
55405 Sat Nov 21 18:13:27 2026 [name withheld]
55666 Sat Nov 21 20:48:37 2026 [name withheld]
55667 Sat Nov 21 20:48:37 2026 [name withheld]
55731 Sat Nov 21 20:48:37 2026 [name withheld]
55732 Sat Nov 21 20:48:37 2026 [name withheld]
55757 Fri Nov 20 17:29:12 2026 [name withheld]
56606 Sat Nov 21 21:52:21 2026 [name withheld]
56615 Sat Nov 21 20:43:38 2026 [name withheld]
56723 Sat Nov 21 18:31:14 2026 [name withheld]
57037 Sat Nov 21 20:48:38 2026 [name withheld]
57094 Sat Nov 21 11:30:29 2026 [name withheld]
57140 Fri Nov 20 17:29:14 2026 [name withheld]
57339 Sat Nov 21 18:31:15 2026 [name withheld]
57433 Sat Nov 21 20:39:27 2026 [name withheld]
57773 Thu Nov 19 10:43:47 2026 [name withheld]
58076 Sat Nov 21 19:01:58 2026 [name withheld]
58263 Thu Nov 19 11:01:05 2026 [name withheld]
58265 Thu Nov 19 11:01:06 2026 [name withheld]
58266 Thu Nov 19 11:01:06 2026 [name withheld]
58267 Thu Nov 19 11:01:06 2026 [name withheld]
58281 Thu Nov 19 11:01:07 2026 [name withheld]
58285 Thu Nov 19 11:01:07 2026 [name withheld]
58287 Thu Nov 19 11:01:07 2026 [name withheld]
58288 Thu Nov 19 11:01:07 2026 [name withheld]
58292 Thu Nov 19 11:01:07 2026 [name withheld]
58297 Thu Nov 19 11:01:08 2026 [name withheld]
58311 Thu Nov 19 11:01:13 2026 [name withheld]
58312 Thu Nov 19 11:01:13 2026 [name withheld]
58323 Thu Nov 19 11:01:14 2026 [name withheld]
58341 Sun Nov 15 08:17:56 2026 [name withheld]
58344 Sun Nov 15 08:17:57 2026 [name withheld]
58439 Sat Nov 21 22:41:04 2026 [name withheld]
58551 Sat Nov 21 20:39:34 2026 [name withheld]
58638 Sat Nov 21 20:39:35 2026 [name withheld]
58660 Fri Nov 20 17:29:16 2026 [name withheld]
58715 Sat Nov 21 20:39:36 2026 [name withheld]
58717 Sat Nov 21 20:39:36 2026 [name withheld]
58974 Sat Nov 21 20:39:39 2026 [name withheld]
58987 Sat Nov 21 20:39:40 2026 [name withheld]
59070 Fri Nov 20 17:29:16 2026 [name withheld]
59093 Thu Nov 19 19:08:36 2026 [name withheld]
59400 Sat Nov 21 11:12:37 2026 [name withheld]
59613 Sat Nov 21 20:31:19 2026 [name withheld]
59631 Sat Nov 21 11:12:37 2026 [name withheld]
59750 Sun Nov 15 20:45:01 2026 [name withheld]
59809 Sat Nov 21 12:06:47 2026 [name withheld]
60117 Mon Nov 16 15:18:59 2026 [name withheld]
60130 Mon Nov 16 15:19:17 2026 [name withheld]
60142 Mon Nov 16 15:19:50 2026 [name withheld]
60170 Mon Nov 16 15:20:11 2026 [name withheld]
60171 Mon Nov 16 15:20:14 2026 [name withheld]
60204 Mon Nov 16 15:21:30 2026 [name withheld]
60213 Mon Nov 16 15:21:31 2026 [name withheld]
60638 Wed Nov 11 08:07:33 2026 [name withheld]
60639 Wed Nov 11 08:07:33 2026 [name withheld]
60803 Wed Nov 11 08:07:33 2026 [name withheld]
61720 Fri Nov 13 03:03:26 2026 [name withheld]
63198 Sat Nov 21 20:40:13 2026 [name withheld]
64052 Sat Nov 21 18:15:00 2026 [name withheld]
64251 Sat Nov 21 19:56:29 2026 [name withheld]
64738 Sat Nov 21 20:40:26 2026 [name withheld]
64931 Sat Nov 21 20:40:28 2026 [name withheld]
65016 Sat Nov 21 19:56:30 2026 [name withheld]
65060 Fri Nov 20 17:29:27 2026 [name withheld]
65442 Sat Nov 21 20:07:35 2026 [name withheld]
65452 Sat Nov 21 20:07:36 2026 [name withheld]
65644 Sat Nov 21 21:14:58 2026 [name withheld]
65646 Sat Nov 21 20:08:23 2026 [name withheld]
65857 Sat Nov 21 20:08:25 2026 [name withheld]
66074 Sun Nov 15 13:14:22 2026 [name withheld]
66234 Sun Nov 15 13:18:52 2026 [name withheld]
66387 Sat Nov 21 20:56:13 2026 [name withheld]
67827 Sat Nov 21 19:56:39 2026 [name withheld]
68228 Sat Nov 21 17:44:10 2026 [name withheld]
68249 Sat Nov 21 17:44:11 2026 [name withheld]
68431 Sat Nov 21 22:08:59 2026 [name withheld]
68486 Sat Nov 21 22:08:59 2026 [name withheld]
68611 Sun Nov 15 14:43:51 2026 [name withheld]
68652 Sat Nov 21 12:30:56 2026 [name withheld]
69552 Sat Nov 21 12:07:40 2026 [name withheld]
69609 Sat Nov 21 20:56:37 2026 [name withheld]
69704 Sat Nov 21 17:44:14 2026 [name withheld]
69920 Sat Nov 21 17:44:15 2026 [name withheld]
70128 Wed Nov 11 13:53:28 2026 [name withheld]
70428 Sat Nov 21 11:36:53 2026 [name withheld]
70505 Sat Nov 21 22:36:29 2026 [name withheld]
70540 Sat Nov 21 22:36:29 2026 [name withheld]
70655 Fri Nov 13 06:59:24 2026 [name withheld]
70732 Sun Nov 15 16:06:16 2026 [name withheld]
70885 Sat Nov 21 18:12:25 2026 [name withheld]
71017 Thu Nov 19 23:35:24 2026 [name withheld]
71064 Sun Nov 15 16:17:52 2026 [name withheld]
71177 Sat Nov 21 13:32:47 2026 [name withheld]
71267 Sat Nov 21 12:07:51 2026 [name withheld]
71978 Sat Nov 21 19:49:48 2026 [name withheld]
72579 Sun Nov 15 17:14:32 2026 [name withheld]
72580 Sun Nov 15 17:14:32 2026 [name withheld]
72601 Sun Nov 15 17:15:24 2026 [name withheld]
72686 Sun Nov 15 17:16:08 2026 [name withheld]
73116 Sat Nov 21 20:20:07 2026 [name withheld]
73190 Wed Nov 18 00:41:12 2026 [name withheld]
73191 Wed Nov 18 00:41:12 2026 [name withheld]
73686 Sat Nov 21 20:41:39 2026 [name withheld]
74105 Sat Nov 21 11:36:56 2026 [name withheld]
74188 Sat Nov 21 11:36:56 2026 [name withheld]
74203 Sat Nov 21 11:36:56 2026 [name withheld]
74450 Sat Nov 21 18:10:59 2026 [name withheld]
74528 Sat Nov 21 11:36:56 2026 [name withheld]
75111 Sat Nov 21 21:05:32 2026 [name withheld]
75175 Sat Nov 21 11:36:57 2026 [name withheld]
75197 Sat Nov 21 18:31:54 2026 [name withheld]
75277 Sat Nov 21 11:36:57 2026 [name withheld]
75287 Sat Nov 21 11:36:57 2026 [name withheld]
75288 Sat Nov 21 11:36:57 2026 [name withheld]
75328 Sat Nov 21 18:04:18 2026 [name withheld]
75362 Sat Nov 21 11:36:58 2026 [name withheld]
75384 Sat Nov 21 20:41:59 2026 [name withheld]
75385 Sat Nov 21 20:41:59 2026 [name withheld]
75395 Sat Nov 21 20:41:59 2026 [name withheld]
75509 Sat Nov 21 11:36:58 2026 [name withheld]
76304 Fri Nov 20 15:33:13 2026 [name withheld]
76848 Sun Nov 15 19:56:36 2026 [name withheld]
77559 Fri Nov 20 15:33:14 2026 [name withheld]
77706 Sun Nov 15 20:19:28 2026 [name withheld]
78052 Wed Nov 11 08:25:26 2026 [name withheld]
78172 Sun Nov 15 20:33:59 2026 [name withheld]
78364 Sun Nov 15 20:38:09 2026 [name withheld]
78796 Fri Nov 13 10:30:13 2026 [name withheld]
78829 Wed Nov 11 09:00:12 2026 [name withheld]
78937 Sat Nov 21 22:07:08 2026 [name withheld]
79105 Sun Nov 15 20:40:53 2026 [name withheld]
79110 Sun Nov 15 20:40:54 2026 [name withheld]
79148 Sun Nov 15 20:40:54 2026 [name withheld]
79426 Fri Nov 13 10:40:59 2026 [name withheld]
79430 Fri Nov 13 10:40:59 2026 [name withheld]
79434 Fri Nov 13 10:40:59 2026 [name withheld]
80167 Fri Nov 13 11:05:08 2026 [name withheld]
81314 Fri Nov 13 11:27:16 2026 [name withheld]
82301 Thu Nov 12 11:49:33 2026 [name withheld]
82692 Sat Nov 21 10:41:30 2026 [name withheld]
82712 Sat Nov 21 10:41:32 2026 [name withheld]
82714 Sat Nov 21 10:41:32 2026 [name withheld]
82727 Sat Nov 21 10:41:33 2026 [name withheld]
82728 Sat Nov 21 10:41:33 2026 [name withheld]
82730 Sat Nov 21 10:41:33 2026 [name withheld]
82752 Sat Nov 21 10:41:36 2026 [name withheld]
82759 Sat Nov 21 10:41:36 2026 [name withheld]
82762 Sat Nov 21 10:41:37 2026 [name withheld]
82764 Sat Nov 21 10:41:37 2026 [name withheld]
82774 Sat Nov 21 10:41:37 2026 [name withheld]
82785 Sat Nov 21 10:41:38 2026 [name withheld]
82801 Sat Nov 21 10:41:40 2026 [name withheld]
82802 Sat Nov 21 10:41:40 2026 [name withheld]
82845 Sat Nov 21 10:41:43 2026 [name withheld]
82849 Sat Nov 21 10:41:44 2026 [name withheld]
82851 Sat Nov 21 10:41:44 2026 [name withheld]
82879 Sat Nov 21 10:41:46 2026 [name withheld]
82888 Sat Nov 21 10:41:47 2026 [name withheld]
82890 Sat Nov 21 10:41:47 2026 [name withheld]
82892 Sat Nov 21 10:41:47 2026 [name withheld]
82919 Sat Nov 21 10:41:48 2026 [name withheld]
83142 Sat Nov 21 10:42:02 2026 [name withheld]
83143 Sat Nov 21 10:42:02 2026 [name withheld]
83353 Sat Nov 21 20:43:58 2026 [name withheld]
83752 Sat Nov 21 20:43:58 2026 [name withheld]
84897 Sat Nov 21 19:12:56 2026 [name withheld]
84926 Sat Nov 21 18:04:30 2026 [name withheld]
85352 Sat Nov 21 19:13:06 2026 [name withheld]
86221 Sat Nov 21 20:50:53 2026 [name withheld]
86265 Sat Nov 21 20:50:53 2026 [name withheld]
86971 Wed Nov 11 08:34:48 2026 [name withheld]
86982 Sat Nov 21 19:52:50 2026 [name withheld]
87009 Sat Nov 21 18:04:32 2026 [name withheld]
87090 Sat Nov 21 18:23:28 2026 [name withheld]
87342 Sat Nov 21 11:58:19 2026 [name withheld]
87349 Sat Nov 21 19:53:00 2026 [name withheld]
87379 Sat Nov 21 18:04:33 2026 [name withheld]
87437 Sat Nov 21 18:04:33 2026 [name withheld]
87612 Sat Nov 21 18:04:33 2026 [name withheld]
87627 Sat Nov 21 20:35:55 2026 [name withheld]
87852 Wed Nov 11 19:57:35 2026 [name withheld]
88005 Mon Nov 16 15:56:56 2026 [name withheld]
88021 Sat Nov 21 18:04:33 2026 [name withheld]
88154 Sat Nov 21 19:57:57 2026 [name withheld]
88247 Wed Nov 11 11:48:52 2026 [name withheld]
88723 Fri Nov 20 04:18:30 2026 [name withheld]
88962 Sat Nov 21 12:35:07 2026 [name withheld]
89049 Fri Nov 13 14:26:57 2026 [name withheld]
89053 Fri Nov 13 14:27:01 2026 [name withheld]
89096 Sat Nov 21 19:58:19 2026 [name withheld]
89525 Sat Nov 21 19:58:28 2026 [name withheld]
89549 Fri Nov 20 20:31:34 2026 [name withheld]
90209 Sat Nov 21 19:58:42 2026 [name withheld]
90374 Sat Nov 21 19:58:46 2026 [name withheld]
90618 Sat Nov 21 21:44:30 2026 [name withheld]
90719 Sat Nov 21 18:42:43 2026 [name withheld]
91080 Sat Nov 21 19:59:00 2026 [name withheld]
91165 Sat Nov 21 19:59:03 2026 [name withheld]
91558 Sat Nov 21 13:01:37 2026 [name withheld]
91564 Sat Nov 21 10:44:33 2026 [name withheld]
91695 Fri Nov 20 20:31:35 2026 [name withheld]
91773 Sat Nov 21 11:58:21 2026 [name withheld]
91972 Sat Nov 21 19:15:30 2026 [name withheld]
92076 Sat Nov 21 21:06:35 2026 [name withheld]
92251 Sat Nov 21 22:41:22 2026 [name withheld]
92426 Sat Nov 21 11:41:13 2026 [name withheld]
92633 Sat Nov 21 22:41:33 2026 [name withheld]
92634 Sat Nov 21 22:41:33 2026 [name withheld]
92643 Sat Nov 21 22:41:33 2026 [name withheld]
92645 Sat Nov 21 22:41:33 2026 [name withheld]
92646 Sat Nov 21 22:41:33 2026 [name withheld]
92651 Sat Nov 21 22:41:34 2026 [name withheld]
94095 Mon Nov 16 11:31:04 2026 [name withheld]
94096 Mon Nov 16 11:31:05 2026 [name withheld]
95238 Mon Nov 16 11:34:17 2026 [name withheld]
96142 Sat Nov 21 20:58:19 2026 [name withheld]
97420 Sat Nov 21 20:36:17 2026 [name withheld]
97720 Sat Nov 21 22:37:21 2026 [name withheld]
98871 Sat Nov 21 21:44:38 2026 [name withheld]
99021 Sat Nov 21 18:07:23 2026 [name withheld]
26411 Sat Nov 21 20:27:28 2026 [name withheld]
26490 Sat Nov 21 20:27:34 2026 [name withheld]
 1390 Wed Nov 11 07:56:57 2026 [name withheld]
 2809 Wed Nov 11 07:58:22 2026 [name withheld]
 1391 Wed Nov 11 07:56:57 2026 [name withheld]
 1392 Wed Nov 11 07:56:57 2026 [name withheld]
 3499 Wed Nov 11 07:59:01 2026 [name withheld]
29629 Sat Nov 21 11:38:16 2026 [name withheld]
29816 Sat Nov 21 11:38:16 2026 [name withheld]
 1393 Wed Nov 11 07:56:57 2026 [name withheld]
 3283 Wed Nov 11 07:58:50 2026 [name withheld]
 3309 Wed Nov 11 07:58:50 2026 [name withheld]
 1397 Wed Nov 11 07:56:57 2026 [name withheld]
 2572 Wed Nov 11 07:58:03 2026 [name withheld]
96256 Mon Nov 16 11:38:21 2026 [name withheld]
98147 Mon Nov 16 11:38:23 2026 [name withheld]
53429 Wed Nov 11 11:12:23 2026 [name withheld]
62277 Wed Nov 11 11:12:31 2026 [name withheld]
17550 Mon Nov 16 17:40:58 2026 [name withheld]
17553 Mon Nov 16 17:40:58 2026 [name withheld]
24730 Wed Nov 11 08:47:44 2026 [name withheld]
 1476 Wed Nov 11 07:57:00 2026 [name withheld]
 1477 Wed Nov 11 07:57:00 2026 [name withheld]
58254 Thu Nov 12 20:08:04 2026 [name withheld]
58261 Thu Nov 12 20:08:10 2026 [name withheld]
89952 Fri Nov 13 14:39:52 2026 [name withheld]
89955 Fri Nov 13 14:39:52 2026 [name withheld]
21588 Sat Nov 14 10:35:26 2026 [name withheld]
21786 Sat Nov 14 10:35:41 2026 [name withheld]
62489 Thu Nov 19 10:54:22 2026 [name withheld]
84788 Fri Nov 20 17:29:56 2026 [name withheld]
84792 Fri Nov 20 17:29:56 2026 [name withheld]
```

Step c6 compared it with the record:

```
laptop: 751 processes listed, 0 record entries, 0 match on the creation identity []
```

The record holds no laptop entry, so on the laptop the comparison is empty by construction. The laptop's unrecorded
processes are in the previous section. f4, f5 and f6 show none of their known pids.

The final listings' own processes are not in the record, because a listing cannot list itself as ended.

## Incidental findings

- **A tool on the owner's laptop holds a login session of the owner's account in WSL whenever WSL runs.** That is a fact
  about the owner's own tool, recorded at
  [1459#7106919811](https://github.com/williacj/rigger/issues/1459#issuecomment-7106919811), not a defect in Rigger. Any
  later spike on this host that needs a user with no session needs its own user, as this one did.
- **The hung Windows SSH sessions, f1 to f1d, were not root-caused.** They are a defect in this spike's throwaway harness,
  not in Rigger, so they get no card. Their leftovers are listed above. rigger-ae ended them on the owner's authorization.
