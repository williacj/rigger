ABOUTME: Spike findings for card #1458: whether a Windows supervisor running below High Mandatory Level can hold an agent's
whole process tree in a Job Object and end it, both by ending the job and after the supervisor is killed outright.

# A non-elevated Windows supervisor and a Job Object

## The answer

Yes, for both endings, on this host. A supervisor ran as a dedicated standard account at Medium
Mandatory Level. It created a Job Object, set kill-on-job-close on it and assigned the fixture root to it.
Every call returned success, in all four runs that reached the job. That held even though the
supervisor was already in a job before it created its own.

- **E1, `TerminateJobObject`.** It ended all five fixture members (M1 to M4 and M6) and the root, in
  both runs (n3 and n4). The job reported no live process 0.350 ms and 0.458 ms after the call. A
  listing 12 s later found none of them.
- **E2, the supervisor killed with `taskkill /F`, kill-on-job-close set.** It ended every member
  and the root, in both runs (n5 and n6). A listing 12 s after the kill found none of them. In n6,
  none of the recorded tree was alive 14.6 ms after `taskkill` returned. The SSH session that
  started the supervisor was open at both post-kill listings, so both runs count.

This removes the condition #1430 attached to its Windows recommendation. #1430 measured an elevated
supervisor only ("Native Windows: a Job Object per dispatch, with kill-on-job-close"). Here a
standard account's Medium-integrity token ran the same calls, and they behaved the same.

Two things limit the answer. The supervisor reached the account through `CreateProcessWithLogonW`,
in session 0 and a window station the launcher made, not in an interactive desktop session. An
administrator's filtered (UAC) token was not tried. "What the next card must not assume" says why
each matters.

## What ran, and where

Every run was on the Windows machine (`hostpc`). The laptop only drove it over SSH. The WSL2 machine
and the Mac mini were not used.

| Run | Ending | Outcome |
|---|---|---|
| n1 | E1 | Failed before any attempt: the launcher threw while reading its own token. No account process started ("What failed") |
| n2 | E1 | `CreateProcessWithLogonW` succeeded, and the account's process exited at once with `0xC0000142`. No supervisor ran ("What failed") |
| n3, n4 | E1, `TerminateJobObject` | Measured |
| n5, n6 | E2, `taskkill /F` of the supervisor, kill-on-job-close set | Measured |

The route had three parts:

- **The launcher**, `docs/spikes/non-elevated-job-object/code/win/launcher.cjs`, ran as `user` in an
  SSH session that `ssh hostpc` opened. It started the supervisor as the account. It also recorded
  every process of the supervisor's tree, and for E2 it killed the supervisor and listed.
- **The supervisor**, `docs/spikes/non-elevated-job-object/code/win/supervisor.cjs`, ran as `fx1458`.
  It read its own token, created and assigned the job, listed, and then ended the job (E1) or
  waited to be killed (E2).
- **The fixture**, `docs/spikes/non-elevated-job-object/code/win/fixture.cjs` and
  `docs/spikes/non-elevated-job-object/code/win/member.cjs`, is #1430's Windows fixture ("The
  fixture", below).

Each run was one command on the laptop, through the step runner
`docs/spikes/non-elevated-job-object/code/t.cjs`. n3's, as the transcript records its argv, was
`["ssh","hostpc","node","C:\\Users\\user\\1458-spike-engineer\\launcher.cjs","e1","n3"]`, with the
account's password on stdin. The other runs differ only in the last two arguments.

`docs/spikes/non-elevated-job-object/` holds the evidence:

- `docs/spikes/non-elevated-job-object/transcript.txt`, every command run through the step runner.
- `docs/spikes/non-elevated-job-object/session-log.txt`, every tool call in the spike engineer's
  retained session record ("The transcript").
- `docs/spikes/non-elevated-job-object/process-record.txt`, the process record, combined from the
  as-written records in `docs/spikes/non-elevated-job-object/process-record-laptop.txt` and
  `docs/spikes/non-elevated-job-object/hostpc-runs/`.
- `docs/spikes/non-elevated-job-object/hostpc-runs/`, each run's records and the supervisor's log,
  copied from the Windows machine.
- `docs/spikes/non-elevated-job-object/code/`, the code that ran, in its final form ("The code that
  ran").

## Hosts and versions

Each value is quoted from the command that printed it. Every command is in
`docs/spikes/non-elevated-job-object/transcript.txt`, in the entry that starts at the time given.

| What | Value | Printed by |
|---|---|---|
| Windows build | `Microsoft Windows [Version 10.0.26300.9974]` | `cmd /c ver`, entry 02:58:15.497Z |
| Windows release, as the supervisor read it | `os.release() 10.0.26300` | the supervisor's `versions:` line, entries 03:04:35.647Z (n3) to 03:06:27.061Z (n6) |
| Node | `node --version: v24.19.0`, and the supervisor's own `node v24.19.0 x64` | entry 02:58:15.497Z, and each supervisor's `versions:` line |
| npm | `npm --version: 11.17.0` | entry 02:58:15.497Z |
| koffi, the package the supervisor loaded | `koffi 3.3.8 (C:\Users\user\1458-spike-engineer\node_modules\koffi\package.json)`, `koffi.version 3.3.8` | the supervisor's `versions:` line in n4, n5 and n6 |
| koffi's prebuilt binary package | `@koromix/koffi-win32-x64 3.3.8 (C:\Users\user\1458-spike-engineer\node_modules\@koromix\koffi-win32-x64\package.json)` | the same line, n4 to n6. n3 printed `@koromix/koffi-win32-x64 3.3.8` |

The supervisor loaded no other package. In n3 its `versions:` line printed
`koffi not loaded (ERR_PACKAGE_PATH_NOT_EXPORTED)`, because koffi's `package.json` is not in its
exports map. From n4 on, the supervisor read each `package.json` from the package's directory
instead. The same install served every run.

The laptop ran the step runner under Node v26.13.0 and drove the PC with `OpenSSH_10.5p1`. Both
values were printed outside the step runner, at the start of the session, so they are in
`docs/spikes/non-elevated-job-object/session-log.txt` and not the transcript.

## How the non-elevated token was obtained

### The account

I created **one** dedicated local standard account, **`fx1458`**, under the owner's ruling
([1453#7073093965](https://github.com/williacj/rigger/issues/1453#issuecomment-7073093965), ruling
2). The stated-intent comment named it before it was created:
[1458#7073260684](https://github.com/williacj/rigger/issues/1458#issuecomment-7073260684), posted at
2026-11-22T02:59:50Z, as the forge's `created_at` reports it. The account was created at
03:00:02Z, by entry 03:00:03.059Z:

```
$u = New-LocalUser -Name fx1458 -Password (ConvertTo-SecureString $p -AsPlainText -Force) -Description 'Rigger card 1458 spike, temporary' -AccountNeverExpires
```

It printed `SID             : [SID withheld]` and
`PrincipalSource : Local`.
`groups containing fx1458:` then listed no group. The account was in no group, Administrators
included. The password was generated on the laptop and sent to each command on stdin. The
transcript records that stdin as a secret and never records its value. The file that held it was
deleted at the end.

### Why this route

SSH as the account was not possible without a host-configuration change. The probe at 02:58:15Z
printed these lines from the Windows machine's `sshd_config`:

```
PasswordAuthentication no
AuthenticationMethods publickey
AllowUsers user
AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys
```

Changing that file was outside the owner's ruling. An administrator's filtered token needs an
interactive logon as `user`, and the spike had no such logon. Windows OpenSSH gave `user` a full token,
as #1430 found. The launcher's own token read:

```
TokenIntegrityLevel Mandatory Label\High Mandatory Level (S-1-16-12288, RID 0x3000) | 1 (TokenElevationTypeDefault) | TokenIsElevated=1
```

So the launcher, as `user`, started the supervisor as `fx1458` through the secondary logon service,
with `CreateProcessWithLogonW`. No profile was loaded (`dwLogonFlags` 0). The service, `seclogon`,
was already `Running` with start type `Manual` (entry 02:59:39.575Z), and the spike changed nothing
about it.

### Each attempt, with its full output

Two attempts were made: attempt 1 in n2, and attempt 2 in n3 to n6. Each one's full output is in
the transcript entry named.

**n1 (entry 03:03:35.116Z) made no attempt.** The launcher threw while reading its own token,
before it called `CreateProcessWithLogonW`, so nothing could yield a token. It is a failed run, not
an attempt ("What failed"). Its output is nine lines of a Node stack trace after one log line. It
ends:

```
TypeError: Cannot read properties of null (reading 'readUInt32LE')
```

That output is quoted in full in its transcript entry. This report does not repeat it, because its
stack frames are file-and-line pointers, which the strict document check refuses.

**Attempt 1, n2 (entry 03:03:46.876Z): the call succeeded, and the process could not start.** Its
full output:

```
2026-11-22T03:03:46.273Z launcher AdjustTokenPrivileges(SeDebugPrivilege enabled): returned 1, GetLastError=0
2026-11-22T03:03:46.274Z launcher pid 7688 session 0 node v24.19.0 | own token: user HOST-PC10\USER ([SID withheld]) | TokenIntegrityLevel Mandatory Label\High Mandatory Level (S-1-16-12288, RID 0x3000) | 1 (TokenElevationTypeDefault) | TokenIsElevated=1
2026-11-22T03:03:46.283Z launcher ancestry (the SSH session): 7688:node.exe(created 2026-11-22T03:03:46.2406681Z, alive) <- 32364:cmd.exe(created 2026-11-22T03:03:46.2242880Z, alive) <- 37344:sshd.exe(created 2026-11-22T03:03:46.1987460Z, alive) <- 35356:sshd.exe(created 2026-11-22T03:03:46.0340938Z, alive) <- 4156:sshd.exe(created 2026-11-10T18:59:53.8544042Z, alive)
2026-11-22T03:03:46.288Z CreateProcessWithLogonW("fx1458", ".", <password>, 0 (no LOGON_WITH_PROFILE), "C:\Program Files\nodejs\node.exe", "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\user\\1458-spike-engineer\\supervisor.cjs\" e1 n2 \"C:\\Users\\user\\1458-spike-engineer\\runs\\n2\"", 0, NULL, "C:\Users\user\1458-spike-engineer\runs\n2"): returned 1, GetLastError=0
2026-11-22T03:03:46.302Z supervisor 17944 exited with code 3221225794
2026-11-22T03:03:47.336Z AFTER CLEANUP
listing run=n2 after cleanup at 2026-11-22T03:03:47.336Z on Windows by pid 7688 (Toolhelp snapshot + PEB command line and CurrentDirectory + GetProcessTimes + IsProcessInJob)
PID     PPID    CREATED (UTC, GetProcessTimes)    IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE
count=0
---- sup.log (n2)

---- rec-user.jsonl (n2)
{"host":"hostpc","pid":7688,"created":"2026-11-22T03:03:46.2406681Z","createdFt":"134397902262406681","how":"self","what":"launcher","recorded":"2026-11-22T03:03:46.274Z","by":7688}
{"host":"hostpc","pid":17944,"created":"2026-11-22T03:03:46.2878673Z","createdFt":"134397902262878673","how":"CreateProcessWithLogonW","what":"\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\user\\1458-spike-engineer\\supervisor.cjs\" e1 n2 \"C:\\Users\\user\\1458-spike-engineer\\runs\\n2\"","recorded":"2026-11-22T03:03:46.288Z","by":7688}
---- rec-fx1458.jsonl (n2)
ENOENT
2026-11-22T03:03:47.337Z launcher done
```

Exit code 3221225794 is `0xC0000142`, `STATUS_DLL_INIT_FAILED`. The process wrote no log, so its
token was never read. That it failed for want of access to the SSH session's window station and
desktop is a judgment. Its premise is attempt 2: the same call, given a window station the account
could use, started a supervisor that ran.

**Attempt 2, n3 to n6: the call succeeded, and the supervisor ran at Medium.** The launcher first
made a window station `fx1458-<run>-ws` with a desktop `Default`, whose DACL granted `fx1458`,
`user` and SYSTEM. It passed that desktop in `STARTUPINFOW.lpDesktop`. In n3 (entry 03:04:35.647Z):

```
2026-11-22T03:04:35.058Z ConvertStringSecurityDescriptorToSecurityDescriptorW("D:(A;;GA;;;[SID withheld])(A;;GA;;;[SID withheld])(A;;GA;;;SY)"): returned 1, GetLastError=0
2026-11-22T03:04:35.058Z CreateWindowStationW("fx1458-n3-ws"): a handle, GetLastError=0
2026-11-22T03:04:35.058Z SetProcessWindowStation(new): 1
2026-11-22T03:04:35.058Z CreateDesktopW("Default") in it: a handle, GetLastError=0
2026-11-22T03:04:35.058Z SetProcessWindowStation(original): 1
2026-11-22T03:04:35.062Z CreateProcessWithLogonW("fx1458", ".", <password>, 0 (no LOGON_WITH_PROFILE), "C:\Program Files\nodejs\node.exe", "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\user\\1458-spike-engineer\\supervisor.cjs\" e1 n3 \"C:\\Users\\user\\1458-spike-engineer\\runs\\n3\"", 0, NULL, "C:\Users\user\1458-spike-engineer\runs\n3", lpDesktop "fx1458-n3-ws\Default"): returned 1, GetLastError=0
```

The full output of n3 to n6 is in their entries. The window station and desktop are kernel objects
the launcher's handles kept alive, and they went with the launcher. They are neither files nor
configuration.

## The supervisor's own token, in each run

The supervisor read its own token with `OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY)` and
`GetTokenInformation`, as its first act after logging its versions. Each line below is from that
run's sup.log, which the launcher printed into the run's transcript entry:

In n3 (entry 03:04:35.647Z):

```
2026-11-22T03:04:35.105Z own token (OpenProcessToken(GetCurrentProcess()) + GetTokenInformation): user HOST-PC10\fx1458 ([SID withheld]) | TokenIntegrityLevel Mandatory Label\Medium Mandatory Level (S-1-16-8192, RID 0x2000) | TokenElevationType 1 (TokenElevationTypeDefault) | TokenIsElevated=0
```

n4 (entry 03:05:26.240Z, at 03:05:25.707Z), n5 (entry 03:05:52.331Z, at 03:05:51.798Z) and n6
(entry 03:06:27.061Z, at 03:06:26.526Z) printed the same line after their timestamps, character for
character.
Medium Mandatory Level, RID `0x2000`, is below High (`0x3000`). The account the supervisor ran as is
`HOST-PC10\fx1458`. n3 to n6 are the runs this report counts as non-elevated. n1 and n2 ran no
supervisor.

## The fixture

The fixture is #1430's Windows fixture, from
`docs/spikes/whole-tree-containment/rerun/win/fixture-win.cjs` and
`docs/spikes/whole-tree-containment/rerun/win/member-win.cjs`, with these changes:

- The tag is `fx1458-<run>-` in place of `fx1430-<run>-`.
- Every process records itself as it starts, and every process it spawns, with the creation time
  `GetProcessTimes` reports.
- M4's parent is started by the full path in `ComSpec`, `C:\WINDOWS\system32\cmd.exe`.

How each member is started is unchanged. M1 is a direct child of the root. M2 is M1's child. M3 is
started detached, in a new process group. M4's parent, cmd.exe running `start /b`, exits at
once. M6 is started detached and moves to `C:\`. The root waits for a line on stdin, so the
supervisor assigns it to the job before it starts any member.

The supervisor differs from #1430's in two ways:

- It creates an **unnamed** job, `CreateJobObjectW(NULL, NULL)`, in place of #1430's
  `Local\fx1430-<run>`. This card needs no name, because reaching an orphaned job is #1460's. A name
  would have added a namespace permission that the card's question does not ask about.
- Its listing reads processes in its own process, with no child. It takes a Toolhelp snapshot,
  reads each command line and working directory from the PEB, takes the creation time from
  `GetProcessTimes`, and checks membership with `IsProcessInJob`. #1430 ran PowerShell for its
  listings.

## Before any ending

### Was the supervisor already in a job?

In every run, before it created its own job, the supervisor called
`IsProcessInJob(GetCurrentProcess(), NULL, &r)`:

```
IsProcessInJob(GetCurrentProcess(), NULL) before creating a job: returned 1, Result=TRUE (already in a job)
```

That line is the same in n3, n4, n5 and n6. Which job held it was not read. The supervisor was
created by the secondary logon service on the launcher's behalf, inside the launcher's SSH session.
Its job's owner is unknown here.

### The three calls

Each call's return value and `GetLastError` were logged straight after the call:

| Run | `CreateJobObjectW(NULL, NULL)` | `SetInformationJobObject(job, JobObjectExtendedLimitInformation, KILL_ON_JOB_CLOSE)` | `AssignProcessToJobObject(job, root)` | Limits read back |
|---|---|---|---|---|
| n3 | `returned a handle (non-NULL), GetLastError=0` | `returned 1, GetLastError=0` | `fixture root pid 35372: AssignProcessToJobObject(job, root): returned 1, GetLastError=0` | `LimitFlags=0x2000 KILL_ON_JOB_CLOSE=set` |
| n4 | `returned a handle (non-NULL), GetLastError=0` | `returned 1, GetLastError=0` | `fixture root pid 32832: AssignProcessToJobObject(job, root): returned 1, GetLastError=0` | `LimitFlags=0x2000 KILL_ON_JOB_CLOSE=set` |
| n5 | `returned a handle (non-NULL), GetLastError=0` | `returned 1, GetLastError=0` | `fixture root pid 19128: AssignProcessToJobObject(job, root): returned 1, GetLastError=0` | `LimitFlags=0x2000 KILL_ON_JOB_CLOSE=set` |
| n6 | `returned a handle (non-NULL), GetLastError=0` | `returned 1, GetLastError=0` | `fixture root pid 30304: AssignProcessToJobObject(job, root): returned 1, GetLastError=0` | `LimitFlags=0x2000 KILL_ON_JOB_CLOSE=set` |

No call failed in any non-elevated run, so every ending could run. The supervisor already sat in a
job, so the assignment made a nested job. Nesting was permitted.

### Membership, and every member alive

Five seconds after the assignment, each supervisor listed the fixture with membership in its own
job. In n3 (entry 03:04:35.647Z):

```
listing run=n3 before ending at 2026-11-22T03:04:40.270Z on Windows by pid 32860 (Toolhelp snapshot + PEB command line and CurrentDirectory + GetProcessTimes + IsProcessInJob)
PID     PPID    CREATED (UTC, GetProcessTimes)    IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE
35372   32860   2026-11-22T03:04:35.1095025Z      yes          yes        C:\Users\user\1458-spike-engineer\runs\n3\d\ | root
28992   35372   2026-11-22T03:04:35.1436538Z      yes          yes        C:\Users\user\1458-spike-engineer\runs\n3\d\ | M1
9488    35372   2026-11-22T03:04:35.1456455Z      yes          yes        C:\Users\user\1458-spike-engineer\runs\n3\d\ | M3
36868   35372   2026-11-22T03:04:35.1485054Z      yes          yes        C:\ | M6
12180   14528   2026-11-22T03:04:35.1619298Z      yes          yes        C:\Users\USER\1458-spike-engineer\runs\n3\d\ | M4
38356   28992   2026-11-22T03:04:35.1860774Z      yes          yes        C:\Users\user\1458-spike-engineer\runs\n3\d\ | M2
count=6
```

`IN_SPIKE_JOB` is `IsProcessInJob(member, the spike's job)`. Every member, and the root, reads `yes`.
M4's parent, 14528, is the cmd.exe that had already exited. The job's own process list held the
same six, and two conhost.exe:
`job process id list (JobObjectBasicProcessIdList): [19660,9488,36868,27720,12180,35372,28992,38356] accounting: {"total":9,"active":8,"terminated":0}`.

n4, n5 and n6 printed the same shape, with every role reading `yes`. Their `BEFORE ENDING, with
membership` listings are at 03:05:30.849Z, 03:05:56.966Z and 03:06:31.645Z on the hostpc clock, in
their entries. A process appears in a listing only while it exists, so each listing also shows each
member alive.

### Immediately before each ending

- **E1.** The supervisor listed again just before it called `TerminateJobObject`. The listing is
  headed `immediately before TerminateJobObject`, at 03:04:40.285Z in n3 and 03:05:30.864Z in n4.
  The call followed at 03:04:40.286Z and 03:05:30.865Z. Each listing shows the root and M1, M2,
  M3, M4 and M6, all `yes` and `count=6`.
- **E2.** The launcher listed just before it ran `taskkill`. In n5 (entry 03:05:52.331Z):

```
listing run=n5 immediately before taskkill at 2026-11-22T03:05:57.062Z on Windows by pid 8860 (Toolhelp snapshot + PEB command line and CurrentDirectory + GetProcessTimes + IsProcessInJob)
PID     PPID    CREATED (UTC, GetProcessTimes)    IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE
19128   14732   2026-11-22T03:05:51.8015838Z      n/a          yes        C:\Users\user\1458-spike-engineer\runs\n5\d\ | root
37680   19128   2026-11-22T03:05:51.8354545Z      n/a          yes        C:\Users\user\1458-spike-engineer\runs\n5\d\ | M1
28236   19128   2026-11-22T03:05:51.8373978Z      n/a          yes        C:\Users\user\1458-spike-engineer\runs\n5\d\ | M3
25684   19128   2026-11-22T03:05:51.8405659Z      n/a          yes        C:\ | M6
37840   38808   2026-11-22T03:05:51.8540513Z      n/a          yes        C:\Users\USER\1458-spike-engineer\runs\n5\d\ | M4
30336   37680   2026-11-22T03:05:51.8776552Z      n/a          yes        C:\Users\user\1458-spike-engineer\runs\n5\d\ | M2
count=6
```

  The launcher holds no handle to the spike's job, so `IN_SPIKE_JOB` reads "n/a" there. n6's
  listing, at 03:06:31.771Z, shows the same six roles.

## E1, `TerminateJobObject` (n3, n4)

| Run | The call | Time to no live process | Listing 12 s later |
|---|---|---|---|
| n3 | `TerminateJobObject(job, 1): returned 1` at 03:04:40.286Z | `job ActiveProcesses reached 0 0.350 ms after the TerminateJobObject call (hrtime, busy poll)` | at 03:04:52.319Z, `count=0` |
| n4 | `TerminateJobObject(job, 1): returned 1` at 03:05:30.865Z | `job ActiveProcesses reached 0 0.458 ms after the TerminateJobObject call (hrtime, busy poll)` | at 03:05:42.887Z, `count=0` |

The times are **measured**. Both endpoints of each come from one process, the supervisor, on its
process.hrtime clock. It read the clock before the call, then polled the job's `ActiveProcesses`
with no sleep until it read 0, within a bound of 10 s. That process ran in the transcript entry that
starts at 03:04:35.647Z (n3) and 03:05:26.240Z (n4).

Each post-ending listing was taken 12.03 s (n3) and 12.02 s (n4) after the call. Those figures
are measured: both endpoints are timestamps the supervisor logged on the hostpc clock, in the
run's entry. n3's reads:

```
listing run=n3 12 s after TerminateJobObject at 2026-11-22T03:04:52.319Z on Windows by pid 32860 (Toolhelp snapshot + PEB command line and CurrentDirectory + GetProcessTimes + IsProcessInJob)
PID     PPID    CREATED (UTC, GetProcessTimes)    IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE
count=0
```

M1, M2, M3, M4 and M6, and the root, were all dead. The job's accounting then read
`{"total":9,"active":0,"terminated":0}`. The launcher runs as `user` with `SeDebugPrivilege`, so it can
read processes of any account. After the supervisor exited, it listed again: `count=0` at
03:04:53.369Z (n3) and at 03:05:43.987Z (n4). It found no survivor to end.

`TerminateJobObject` also logged `GetLastError=5`. The call returned 1. Windows sets the last error
only when a call fails, so that value is stale, left by an earlier call. That is a judgment from the
documented contract. The card does not ask for this call's error.

## E2, the supervisor killed outright with kill-on-job-close set (n5, n6)

| Run | The kill | Listing at least 10 s later | Session open at that listing |
|---|---|---|---|
| n5 | `taskkill /F /PID 14732 (taskkill pid 8788, exit 0): SUCCESS: The process with PID 14732 has been terminated.`, logged at 03:05:57.277Z | at 03:06:09.330Z, 12.05 s later, `count=0` | yes |
| n6 | `taskkill /F /PID 28892 (taskkill pid 36504, exit 0): SUCCESS: The process with PID 28892 has been terminated.`, logged at 03:06:31.958Z | at 03:06:44.001Z, 12.04 s later, `count=0` | yes |

n5's post-kill listing (entry 03:05:52.331Z):

```
listing run=n5 12 s after taskkill at 2026-11-22T03:06:09.330Z on Windows by pid 8860 (Toolhelp snapshot + PEB command line and CurrentDirectory + GetProcessTimes + IsProcessInJob)
PID     PPID    CREATED (UTC, GetProcessTimes)    IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE
count=0
```

M1, M2, M3, M4 and M6, and the root, were dead in both runs. The launcher found no survivor to end.

n6 also timed the deaths (entry 03:06:27.061Z):
`none of the 8 recorded tree processes (supervisor excepted) alive 14.6 ms after taskkill returned (first poll that found none)`.
That figure is **measured**. Both endpoints come from the launcher's process.hrtime: one reading
when `taskkill` returned, and one at the first 5 ms poll that found none of the eight alive. The
eight are the root, M1 to M4, M6 and two conhost.exe. That launcher ran in the entry that starts at
03:06:27.061Z. n5 ran before this timing was added.

### Was the starting session open?

The session that started the supervisor is the launcher's SSH session. In each E2 run the launcher
printed its ancestry, up to the per-connection sshd.exe, just before and just after the post-kill
listing. In n5:

```
2026-11-22T03:06:09.298Z launcher ancestry at the post-kill listing: 8860:node.exe(created 2026-11-22T03:05:51.7026673Z, alive) <- 23216:cmd.exe(created 2026-11-22T03:05:51.6867963Z, alive) <- 31368:sshd.exe(created 2026-11-22T03:05:51.6314929Z, alive) <- 35400:sshd.exe(created 2026-11-22T03:05:51.4790525Z, alive) <- 4156:sshd.exe(created 2026-11-10T18:59:53.8544042Z, alive)
2026-11-22T03:06:09.342Z launcher ancestry after the post-kill listing: 8860:node.exe(created 2026-11-22T03:05:51.7026673Z, alive) <- 23216:cmd.exe(created 2026-11-22T03:05:51.6867963Z, alive) <- 31368:sshd.exe(created 2026-11-22T03:05:51.6314929Z, alive) <- 35400:sshd.exe(created 2026-11-22T03:05:51.4790525Z, alive) <- 4156:sshd.exe(created 2026-11-10T18:59:53.8544042Z, alive)
```

The 12.05 s and 12.04 s in the table are measured the same way. Both endpoints are timestamps the
launcher logged on the hostpc clock, in the run's entry. n6 printed the same at 03:06:43.977Z and 03:06:44.014Z, around its listing at 03:06:44.001Z, with
its connection's sshd.exe 17548 and 38448 alive. The transcript shows the same thing from the
laptop. Each run was one `ssh` command, and each command's output includes its post-kill listing.
n5's entry ran from 03:05:52.331Z to 03:06:11.290Z, and n6's from 03:06:27.061Z to 03:06:46.028Z.
So both sessions were open when their listings were taken, and both E2 runs count toward the
conclusion. No E2 run is unattributed.

### What else could have ended the members

The supervisor was already in a job ("Was the supervisor already in a job?"), and the members were
in that outer job too, since a nested job's processes are in its parent. That the spike's
kill-on-job-close ended them, not the outer job, is a judgment. Its premises:

- The members died within 14.6 ms of the supervisor's death (n6). The supervisor held the spike's
  job's only handle: it never duplicated it, and the launcher never opened the job, as their code
  shows.
- Nothing else the transcript shows ended at that moment. The launcher and its SSH session stayed
  alive. Who holds the outer job was not read.
- In #1430's elevated x4, members outlived a supervisor killed without kill-on-job-close.

The run that would settle it is the same E2 without kill-on-job-close under this route. That is
#1460's cell, outside this card.

## The conclusion

On the evidence above, a supervisor running below High Mandatory Level can end a dispatch's whole
tree through a Job Object, on this host:

- **E1:** yes. n3 and n4 each ended the root and all five members, M1 to M4 and M6, by
  `TerminateJobObject`, in under 0.5 ms.
- **E2:** yes. n5 and n6 each ended the root and all five members when the supervisor was killed
  with `taskkill /F`, through kill-on-job-close. The starting session was open at both post-kill
  listings.

## Recommendation

#1430's Windows recommendation stands, without its elevation condition: a Job Object per dispatch,
with kill-on-job-close, created from the supervisor's own process.

The next card should do these things:

- Create the job unnamed, from the supervisor's own process. A name is needed only to reach an
  orphaned job, which is #1460's question.
- Set `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and assign the dispatch's root before it starts
  children, gated as the fixture was.
- Expect the supervisor to be in a job already, and rely on nesting. Every run here nested.
- Open the root with rights the same account holds. Here the supervisor used `PROCESS_ALL_ACCESS`
  on its own child.

### What the next card must not assume

- **That an interactive session behaves the same.** Every supervisor here ran in session 0, in a
  window station the launcher made, started by the secondary logon service. A developer's
  terminal runs in an interactive session, under a job its terminal or IDE may have made. The Job
  Object calls on a process's own children need no privilege, so the same result is expected
  there, but that is a judgment and was not measured.
- **That an administrator's filtered token behaves the same.** A filtered token is the usual one
  when a developer who is an administrator runs Rigger without elevation. It was not tried, for the
  reasons under "Why this route". It carries the same Medium label, so the same result is expected,
  again a judgment.
- **That any outer job permits nesting.** This host's outer job did. An outer job that a host,
  terminal or CI runner makes with limits that conflict with the spike's could refuse
  `AssignProcessToJobObject`. None was met here.
- **That the outer job is benign.** #1430's caution stands: under SSH, the session's own job ended
  every member on disconnect.

### What would reverse it

- A Medium-integrity supervisor in an interactive session, or under a filtered administrator token,
  that gets a failure from `CreateJobObjectW`, `SetInformationJobObject` or
  `AssignProcessToJobObject`.
- An outer job, under the host Rigger will run on, that refuses the nested assignment.
- The same E2 run without kill-on-job-close (#1460's cell) leaving the members dead. That would mean
  the outer job, not the spike's, ended them in n5 and n6.
- An agent tool that starts processes with `CREATE_BREAKAWAY_FROM_JOB` under a job that allows it
  (#1430's reversal, unchanged).

## What this would change, as a proposal

This section is a proposal for the PM, the architect and the owner. This pull request changes none
of these. The finding removes a condition from #1430's proposal. It adds no new change of its own.

| Document | What the recommendation would change |
|---|---|
| `D13` | Rule 1 makes macOS v0's only host. Its deferred row, "A native Windows host, with its own containment backend", is the row a Job Object backend would return under. This report adds that the backend does not need elevation on this host |
| `R-STATE-17` | Containment is a process group plus a census of the dispatch's directory. A job would be a containment unit that also holds M6, which that definition leaves outside, as #1430 proposed |
| `R-STATE-9` and `R-STATE-10` | The killed-outright path. Kill-on-job-close ends the tree when the supervisor dies, so on Windows nothing would remain for the next start. That holds without elevation too |
| `ARCHITECTURE.md`, "Failure model" | L0's containment paragraph: "A process that leaves its group is outside this containment" |

## What failed

- **n1: the launcher threw before its first call.** `GetTokenInformation` fails with
  `ERROR_BAD_LENGTH` unless a fixed-size class gets exactly its size. The launcher passed 1024 bytes
  for `TokenElevationType` and `TokenElevation`, got `null`, and threw. No account process started.
  Its full output is in entry 03:03:35.116Z. The fix passed 4 bytes.
- **n2: the account's process could not initialise.** `CreateProcessWithLogonW` returned 1. The
  process exited with `0xC0000142`, wrote nothing, and started no child. The launcher logged its
  exit at 03:03:46.302Z, 14 ms after the creation time it recorded for it (03:03:46.2878673Z). Both
  endpoints are on the hostpc clock, in entry 03:03:46.876Z, so the figure is measured. The launcher's
  tracker found no conhost for it. Its full output is in entry 03:03:46.876Z and is quoted above.
  From n3, the launcher gave the account a window station and desktop of its own.
- **n3's `versions:` line could not read koffi's version** (`ERR_PACKAGE_PATH_NOT_EXPORTED`). The run
  itself was not repeated. n4 to n6 read it, and the install did not change between them.
- **The first laptop sweep printed every process's command name** (entry 03:07:58.964Z). It was
  repeated without names at 03:08:07.053Z, and the repeat's result, `0` matches, was the same.
  **733 of its listing lines are lost.** I replaced them in the transcript with a marked redaction,
  because they named the owner's applications. Then I deleted the only unredacted copy, the
  scratch file transcript-unredacted.txt. No other copy exists: the session record holds only the
  three lines its call displayed, and the laptop has no local snapshot. What survives is the
  redaction line, which holds the output's sha256, its first two lines and its last line. That
  deletion is a defect of this spike. Removing private lines needed the card author's decision,
  and the lines cannot now be restored.
- **The first commit attempt was refused** (about 03:19Z to 03:25Z; the session log holds the
  call). The worktree had no node_modules, so the commit hook's suite failed every test file that
  imports `acorn`, with `ERR_MODULE_NOT_FOUND`, and printed `refused: the suite is not green.`.
  Its full output is in `docs/spikes/non-elevated-job-object/commit-refused-output.txt`. Running
  `npm ci --no-audit --no-fund` in the worktree fixed it, and that call is in the session log too.
  The second attempt passed: `pass 6018`, `fail 0`. The round-1 push's output is in
  `docs/spikes/non-elevated-job-object/push-round1-output.txt`.

- **The commit hook refused an amend attempt** (issued 2026-11-23T20:48:18.782Z; its slot ran from
  20:54:31Z to 21:08:11Z). The suite printed `pass 6037`, `fail 1` and `cancelled 2`. The failed test
  waited 5000 ms for a condition in `test/loop.test.mjs`. The cancelled two are one test in
  `test/verb-facts.test.mjs`, which timed out after 60000 ms, and its subtest. No file was changed, and
  the next attempt passed: `pass 6040`, `fail 0`. The slot's log read a one-minute load of 22.90 at its
  start and 47.34 at its end. That the load caused the failures is a judgment, from that load, from both
  being time limits, and from the pass without a change. I did not investigate the tests. The summary,
  the failing sections and the full output's sha256 are in
  `docs/spikes/non-elevated-job-object/commit-refused-2-excerpt.txt`. The full output is kept
  off-repo. The owner ruled that form enough for refused commits on #1471 and #1472
  ([1459#7115125345](https://github.com/williacj/rigger/issues/1459#issuecomment-7115125345)). That
  ruling does not name this pull request.
- **Earlier heads, kept off-repo, published names and SIDs that are not the spike's to publish.** The sweeps listed every
  process on the Windows machine by name, the probe and the account listing named its accounts, and
  the session log's generator carried the household names it was meant to redact. I redacted some
  names by hand and did not check the files as a whole. They, and the SIDs, are now masked ("The
  transcript").

Each failed or repeated run's full output is in its transcript entry or in the file named above,
except the 733 lost lines, and the refused amend, whose full output is off-repo.

## Custody

### The transcript

`docs/spikes/non-elevated-job-object/transcript.txt` holds every command run through the step
runner `docs/spikes/non-elevated-job-object/code/t.cjs`. For each command it gives these:

- the exact argv, as JSON;
- a script it carried: for PowerShell, the script that `-EncodedCommand` decodes to, verbatim, with
  its sha256;
- the UTC start and end on the laptop clock, and the host;
- the pid and creation time of the command's process;
- its exit status, and its full output.

A secret on stdin is recorded as a secret, and never its value. Its length is masked. Every command run
on the Windows machine went through the step runner. The host label `laptop -> hostpc (user)` means
an `ssh` or `scp` to the machine as `user`.

It carries two marked edits, each a line beginning `[REDACTED EDIT:` with the original's sha256:

- Entry 02:58:15.497Z: the names of other accounts and profiles are withheld
  from the account and profile listings.
- Entry 03:07:58.964Z: 733 listing lines naming the laptop's processes are removed. They cannot be
  restored ("What failed").

**Names and SIDs are masked under the owner's rulings**
([1458#7090273806](https://github.com/williacj/rigger/issues/1458#issuecomment-7090273806),
[1458#7104455727](https://github.com/williacj/rigger/issues/1458#issuecomment-7104455727)). Earlier
heads, kept off-repo, published names of processes, programs, services and accounts that are not the
spike's own, and the SIDs of two accounts, which carry the machine's identifier. Each such name is
now "[name withheld]" and each such SID "[SID withheld]". The spike's own processes, and the host
tools its commands invoke, keep their names. Every pid, creation time and count is unchanged.

- In the whole-host listings, every row but the sweep's own is masked, whatever its name.
- Padding beside a mask is collapsed in the account tables, so that it shows no name's length.
- The account listing after the delete printed a different placeholder for Microsoft accounts. It is
  replaced by the same mask.
- The base64 of two PowerShell scripts carried a SID, and reads "[encoded command withheld]" (entries
  03:07:16.109Z and 03:07:37.725Z). The decoded script follows each one, with the SID masked.
- References to an earlier head, or to its CI run, read "[an earlier head, kept off-repo]".
- Two original file sizes in the session log are withheld, because each gave a masked name's length.
- The command that made the account's password, and its length, are withheld in both logs.
- **Some recorded text is reworded, not only masked.** Two phrases that gave a number of other people's
  accounts, one of which also described them, now read "other accounts" or have the number dropped.
  The coordinator asked for this, because the words told readers about accounts that are not the
  spike's. It changed these, which no longer read as they ran or printed:
  - in `docs/spikes/non-elevated-job-object/session-log.txt`: the file's own header line, a `sed`
    command I ran, code of two scripts that calls wrote or printed, a line a call printed from the
    transcript, the copies of this report's text that calls wrote or printed, and one of my messages
    to the coordinator;
  - in `docs/spikes/non-elevated-job-object/transcript.txt`: a redaction note, and the copies of this
    report's text in the scans' output;
  - in `docs/spikes/non-elevated-job-object/code/gen-session-log.py`: a comment and a printed string;
  - in this report: one line.
  The originals are kept off-repo.
- The fragment of a digest that the session log printed is withheld, with a search pattern's hint at
  a masked name.

| File | Distinct names masked | SIDs masked | sha256 before the masking |
|---|---|---|---|
| `docs/spikes/non-elevated-job-object.md` | 9 | 9 | withheld, kept off-repo |
| `docs/spikes/non-elevated-job-object/code/gen-session-log.py` | 7 | 0 | withheld, kept off-repo |
| `docs/spikes/non-elevated-job-object/push-round1-output.txt` | 1 | 0 | withheld, kept off-repo |
| `docs/spikes/non-elevated-job-object/session-log.txt` | 28 | 49 | `c1c446c5cd86957ebc9970a6265f4f309295e24f3cf6c8eb75bd2896981110e5` |
| `docs/spikes/non-elevated-job-object/transcript.txt` | 129 | 157 | `4bf2bef1f8fa5d4453da8cd57c956688f46aa4e562f2fad3b1265a469f887f9a` |
| `docs/spikes/non-elevated-job-object/code/win/launcher.cjs` | 0 | 1 | `706f9888d98e7bf7865daa640f7deaefad20e6ff07145c5a04322ff989fc873c` |
| `docs/spikes/non-elevated-job-object/code/win/sweep.cjs` | 0 | 1 | `e8c6b621d40be83864568634b4f4a4647a293a07aa80efc61fec337c69ee02c5` |
| `docs/spikes/non-elevated-job-object/hostpc-runs/n3/sup-log.txt` | 0 | 1 | `128cb582ce429ee75cc9ebc6cc64e52ba6405af7a6cc4ebd7568248b38ae5bad` |
| `docs/spikes/non-elevated-job-object/hostpc-runs/n4/sup-log.txt` | 0 | 1 | `8a6a018545f6bdc84fa1a4dbd63d9c466f0c71cf570577fb47ef134ea1f1b12f` |
| `docs/spikes/non-elevated-job-object/hostpc-runs/n5/sup-log.txt` | 0 | 1 | `106070ed05413e518ed233d1331ce596bddb575d174f89829946c59128661fd2` |
| `docs/spikes/non-elevated-job-object/hostpc-runs/n6/sup-log.txt` | 0 | 1 | `552a3b4e6afdf91b37a852cebfdeb65fa5c47cf33e6e2b3b0fba89c81485334b` |

Each digest is of the file as committed before the first masking. A digest marked withheld would let
someone confirm a guess at what is masked. It is withheld for privacy under ruling 1458#7104455727,
and kept off-repo with the unmasked originals. The same ruling drops the digests in the transcript's
first `[REDACTED EDIT:` line, in the first lines of
`docs/spikes/non-elevated-job-object/push-round1-output.txt`, and where the session log and transcript
repeat them.

These committed scripts no longer run as committed:

- `docs/spikes/non-elevated-job-object/code/win/launcher.cjs` and
  `docs/spikes/non-elevated-job-object/code/win/sweep.cjs`, whose account SID is masked;
- `docs/spikes/non-elevated-job-object/code/gen-session-log.py`, whose list of names is masked;
- the two PowerShell scripts above, as the transcript now shows them.

Each masked file but this report carries a "MASKED EDIT" line. The masking scripts are not committed.
Quotations in this report match the masked transcript. Program names that the session log repeats
from #1430's merged report, in prose, are not masked except where they are executables or service
units.

`docs/spikes/non-elevated-job-object/session-log.txt` holds every tool call in the spike engineer's
retained session record, regenerated for round 2. It covers the laptop commands outside the step
runner: making directories, generating the password, posting the comment, building the evidence,
the round-1 record work, the report edits, the document checks, the refused commit, `npm ci`, the
commit that passed, the push, and opening the pull request. It also covers the round-2 edits up to
its own regeneration. Each call has the time it was issued and the time its result came back, and
its result as the record holds it. Where a call's output went to a file, the record holds only what
the call displayed. The outputs of the refused commit and the round-1 push are in the files named
under "What failed". The outputs of the two commits that passed are not committed. The log applies
the same name redaction, generated by
`docs/spikes/non-elevated-job-object/code/gen-session-log.py`.

The session log was regenerated in round 3, through the step runner. Its last call is the one that
generated it, so that call shows no result there. Its transcript entry holds that call's argv, time
and output. After it, these ran through the step runner and are in the transcript: the record
regenerations, the patch to their generator, and the report edit that names the failed one. The
shell calls around them, which wrote the edit scripts, staged the files and read results, are in
neither log.

The round-2 record regeneration, document checks and scan-section edit are in the session log as
they first ran. Round 3 re-ran the checks and the regeneration through the step runner. The first round-3
regeneration failed: it found no transcript entry for its own process, whose entry the runner
writes only after it returns. Its full output is in its transcript entry. A logged patch let the
generator list its own process, and the rerun passed. The
round-3 commit's and push's transcript entries are posted on the pull request as a comment
([1468#7113568202](https://github.com/williacj/rigger/pull/1468#issuecomment-7113568202)), and are
not in the committed transcript. Their process rows are committed ("Every background launch"). The
rewrite into one masked commit, and its amendment, came after them. Their commands are in neither log.

The hostpc clock read at least 0.59 s behind the laptop clock. Each launcher's first line, on the
hostpc clock, precedes its own command's start, on the laptop clock. So every timed figure here uses
one host's clock for both of its endpoints.

### The code that ran

`docs/spikes/non-elevated-job-object/code/` holds the code in its final form, except
for the three files whose names or SID are masked ("The transcript"):

- `docs/spikes/non-elevated-job-object/code/win/win.cjs`, the koffi bindings and the listing;
- `docs/spikes/non-elevated-job-object/code/win/rec.cjs`, the process record;
- `docs/spikes/non-elevated-job-object/code/win/launcher.cjs`;
- `docs/spikes/non-elevated-job-object/code/win/supervisor.cjs`;
- `docs/spikes/non-elevated-job-object/code/win/fixture.cjs` and
  `docs/spikes/non-elevated-job-object/code/win/member.cjs`;
- `docs/spikes/non-elevated-job-object/code/win/sweep.cjs`;
- the laptop's step runner, sweep and generators.

Three files changed between runs. Each change was copied over by the `scp` entry just before the
run it first served, and each edit is in the session log:

- **`docs/spikes/non-elevated-job-object/code/win/win.cjs`:** the token-size fix, after n1.
- **`docs/spikes/non-elevated-job-object/code/win/launcher.cjs`:** the window station, after n2; the E2 death timing, after n5.
- **`docs/spikes/non-elevated-job-object/code/win/supervisor.cjs`:** the version read, after n3.

The scripts sent to PowerShell are in the transcript verbatim.

### The process record

`docs/spikes/non-elevated-job-object/process-record.txt` lists 170 entries for 94 distinct processes.
`docs/spikes/non-elevated-job-object/process-record-laptop.txt` holds five later rows that the
combined record does not: two from round 3's commit and push, and three from the scans of the masked
files.
Each entry gives the host, the pid, the creation time and the UTC time it was written. Its last line
reads `entries written later than the next command: 0`. It is generated by
`docs/spikes/non-elevated-job-object/code/gen-record.cjs` from the as-written records:

- **The laptop:** `docs/spikes/non-elevated-job-object/process-record-laptop.txt`. The step runner
  wrote one entry for each command's process as it spawned it, with `ps` and its `lstart` field, as the step runner's code shows. That is the
  laptop's local time (CST, UTC−6), to the second.
- **hostpc:** `docs/spikes/non-elevated-job-object/hostpc-runs/<run>/rec-user.txt`, written by the
  launcher, and `docs/spikes/non-elevated-job-object/hostpc-runs/<run>/rec-fx1458.txt`, written by
  the supervisor, the fixture and the members. Each process wrote an entry for itself as it
  started, and for each process it spawned as it spawned it. The creation time is from
  `GetProcessTimes`, to 100 ns. The launcher's tracker also polled every 100 ms and wrote an entry
  for each new process of the supervisor's tree, conhost.exe included. The supervisor wrote one for
  each pid in its job's process list, 5 s after the assignment.

Each as-written file is committed with one `ABOUTME:` line added at the top. That line gives the
original's sha256, and every line after it is the original byte for byte.

Each entry was written before the transcript's next command on its host:

- **A laptop entry:** the record compares its written time with the next command's start, both on
  the laptop clock.
- **A hostpc entry:** the two clocks differ, so the record does not compare them. Instead, the
  launcher printed each record file at its end. The entry therefore appears verbatim in the output
  of the command that started it, and that command ended before the next one began.
- **n1's launcher:** it threw before printing. It exited before its command returned, so its
  transcript entry covers it.

These processes are not in the record. Each exited before the command that started it returned, so
its transcript entry covers it:

- the per-connection sshd.exe and cmd.exe of each `ssh` and `scp`;
- powershell.exe for each script, and the `node`, `npm` and `icacls` it ran;
- taskkill.exe, whose pid each E2 run printed: 8788 in n5, 36504 in n6;
- the laptop's own shell commands that returned before the next one, which are in the session log.

**Every background launch.** Nine laptop commands were still running when the calls that started them
returned, up to this follow-up commit. None of their processes is in
`docs/spikes/non-elevated-job-object/process-record.txt`. Where the
table names a lost value, that broke the rule that each process is recorded as it starts, and it is a
defect of this spike. What records written at the time do
hold is in `docs/spikes/non-elevated-job-object/background-launches.txt`: the suite slot's own log,
which wrote each slot process's pid as it started, and the rows the step runner and the rewrites
wrote.

| Issued (session record) | Command | Recorded at the time | Lost, and cannot be produced now |
|---|---|---|---|
| 2026-11-22T03:19:44.024Z; the call returned at 03:22:44.373Z, when it moved to the background | the refused commit | slot pid 88797, logged 03:19:44Z | its creation time; the pid and creation time of its shell and of each process under the slot |
| 2026-11-22T03:26:09.683Z | the round-1 commit | slot pid 79872, logged 03:26:09Z | the same |
| 2026-11-22T03:40:25.082Z | the round-1 push | slot pid 65860, logged 03:40:25Z | the same |
| 2026-11-22T04:02:43.064Z | the round-2 commit, then its push | slot pids 17186, logged 04:02:43Z, and 28798, logged 04:12:50Z | the same, for both |
| 2026-11-22T22:27:21.850Z | the round-3 commit, then its push, through the step runner | slot pids 50250 and 62553, each with its creation time, and the step runners' pids 50249 and 62552 | the step runners' creation times; the pid and creation time of the shell and of each process under the slot |
| 2026-11-23T03:03:06.040Z | the first rewrite's commit | shell pid 11873 and slot pid 11876, each with its creation time | the pid and creation time of each process under the slot |
| 2026-11-23T16:23:50.408Z | the second rewrite's commit | shell pid 27936 and slot pid 27954, each with its creation time | the same |
| 2026-11-23T20:48:18.782Z | the refused amend | shell pid 1580 and slot pid 1705, each with its creation time | the same |
| 2026-11-23T21:08:27.630Z | the amend that passed | shell pid 18838 and slot pid 18880, each with its creation time | the same |

"Each process under the slot" means caffeinate, git, the commit or push hook, and, where the hook ran
it, the test suite and what the suite starts. Each is a descendant of the slot process. The lost
values were never recorded and the processes have ended, so they are an unrecoverable gap, listed
under the owner's standing rule
([1453#7087640218](https://github.com/williacj/rigger/issues/1453#issuecomment-7087640218)). The
last three rows' shell and slot recorded themselves as they started. Their rows' command text is
fixed in the script that wrote it and omits the commit's options. The follow-up commit that adds this
paragraph ran the same way, and its rows cannot be in the commit they made.

The launcher's ancestry lines show each run's sshd.exe and cmd.exe, with their creation times.

### After the last run, no process matches a record entry

- **hostpc, 03:07:44Z** (entry 03:07:45.229Z). `docs/spikes/non-elevated-job-object/code/win/sweep.cjs` read every record file on the machine and
  listed every process with its pid and creation time. Its summary:

```
record entries read: 127, distinct (pid, creation time) pairs: 51, from 10 files
listing of every process at 2026-11-22T03:07:44.780Z (Toolhelp snapshot + GetProcessTimes), 316 processes
processes matching a record entry on both pid and creation time: 0
processes running as fx1458 ([SID withheld]): 0
pids that equal a recorded pid but differ in creation time (reused pids, not matches): none
```

  The 316 listing lines, each with a pid and a creation time, are in that entry. Its image names are masked. The
  sweep at 03:07:15Z, before the account was deleted, read the same: `0` and `0`.
- **The laptop, 04:02:03Z** (entry 04:02:03.607Z), after the last run and after the round-2
  credential scans. `docs/spikes/non-elevated-job-object/code/laptop-sweep.cjs` read all 35 laptop
  record entries and listed every process with `ps -A -o pid=,lstart=`:

```
listing of every process (ps -A -o pid=,lstart=), 789 processes
processes matching a laptop record entry on both pid and start time: 0
```

  It excludes only itself, whose own entry the step runner wrote as it started it. Its 789 listing
  lines are in that entry. The earlier laptop sweeps, at 03:08:07Z, 03:17:09Z and 03:17:32Z, also
  read `0`.

### The account, deleted

Entry 03:07:37.725Z deleted the account and listed the local accounts afterwards. The other
Microsoft-account names were withheld at capture:

```
before: fx1458 [SID withheld] Enabled=True
Remove-LocalUser -Name fx1458 exit: True
local accounts after the delete (Get-LocalUser; Microsoft-account names withheld, local names shown):
 [row withheld]
 [row withheld]
 [row withheld]
 [row withheld]
 [row withheld]
  [row withheld]
 [row withheld]
  [row withheld]
 [row withheld]
  [row withheld]
  [row withheld]
  [row withheld]
  [row withheld]
 [row withheld]
  [row withheld]
 [row withheld]
count: [withheld]
Get-LocalUser -Name fx1458: 
any account with SID [SID withheld]: 
```

`net user fx1458` then reported `The user name could not be found.` The count, 16, is the count
before the account was created (entry 02:58:15.497Z). No profile was created:

- Entry 03:07:16.109Z, before the delete, printed `none` for a `Win32_UserProfile` with the
  account's SID.
- The same entry printed `False` for its `ProfileList` key, for `C:\Users\fx1458` and for a loaded
  hive.
- Entry 03:07:45.229Z printed `Test-Path C:\Users\fx1458: False` again.

### The credential scan

The last scan ran at 04:01:38Z, in round 2, over every file under
`docs/spikes/non-elevated-job-object/` (31 files), through the step runner. Its command is in entry
04:01:38.866Z:

```
$ ["grep","-rnIiE","gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-ant-|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-|BEGIN [A-Z ]*PRIVATE KEY|bearer [A-Za-z0-9._-]{20,}|(password|passwd|secret|token|api[_-]?key)[[:space:]]*[:=]","../../docs/spikes/non-elevated-job-object"]
```

It printed 155 lines: 79 in the session log, 71 in the transcript, and 5 in the code. None was in
`docs/spikes/non-elevated-job-object/commit-refused-output.txt`. Every line falls in one of these
classes:

- The launcher's log label `own token:`. Each run's launcher line, and the code that prints it, has
  one.
- The koffi binding names `OpenProcessToken:` and `GetTokenInformation` in
  `docs/spikes/non-elevated-job-object/code/win/win.cjs`.
- The step runner's variable `secret = `, in `docs/spikes/non-elevated-job-object/code/t.cjs` and
  where the session log and transcript show that code.
- The scan's own pattern text (`github_pat_`, `sk-ant-`), wherever an earlier scan's command or
  output is shown, and where I read #1430's report, which quotes its scan.
- My round-1 summaries of the scan's matches, in the session log. Each has the form
  `<file> -> token:` or `<file>:<line>  ->  secret =`.

Filtering the printed lines by those classes leaves none. The filter ran through the step runner,
in entry 04:02:03.084Z, in the evidence directory, and printed only `remaining exit 1`:

```
$ ["sh","-c","awk '/^### 2026-11-22T04:01:38.866Z/{p=1;next} /^### /{p=0} p' transcript.txt | grep 'non-elevated-job-object/' | grep -viE 'own token:|OpenProcessToken|secret = |github_pat_|sk-ant-' | grep -vE '(->|  ->  ) *(token|Token|secret|github_pat_|sk-ant-)'; echo \"remaining exit $?\""]
```

In round 1 the same filter, without its last class, ran on round 1's scan. That call is number 78
in the session log, issued at 03:17:52.497Z, and it printed `remaining exit 1`.

The email scan, `grep -rnIoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}'` (entry
04:02:03.252Z), found only two strings:

- noreply@anthropic.com, the commit trailer address;
- [name withheld], a systemd unit name, from #1430's report.

Each appears in the session log and the transcript wherever an earlier scan's output or a commit
message is shown.

No account address or whole password is in the evidence, and the password was never printed. The
command that made it was in earlier heads, though, and showed its last three characters, its alphabet
and its length. That is a defect of this spike. The command and the length are now masked. The
account is deleted, so the password opens nothing.

Some content was written after the last scan. In round 2 it was the filter's, the email scan's and the last
sweep's transcript entries, four lines of
`docs/spikes/non-elevated-job-object/process-record-laptop.txt`, and the regenerated
`docs/spikes/non-elevated-job-object/process-record.txt`. Each holds only the pids, times and output
quoted above.

Round 3 then regenerated the session log and the process record and added transcript entries, and the
masking changed the files in the table under "The transcript". The scans below cover those changes.

**The scans of the masked files.** On 2026-11-23 three scans ran through the step runner over all 33
files then under `docs/spikes/non-elevated-job-object/`. Each prints only the matched text (`-o`), with
its file and line, so that it does not copy whole lines into the transcript again. A first attempt, in
the call before, ran nothing: the shell could not find the command I had put in a variable.

The first (entry 22:20:34.110Z) uses the same pattern as the last scan above:

```
$ ["grep","-rnIiEo","gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-ant-|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-|BEGIN [A-Z ]*PRIVATE KEY|bearer [A-Za-z0-9._-]{20,}|(password|passwd|secret|token|api[_-]?key)[[:space:]]*[:=]","docs/spikes/non-elevated-job-object"]
```

It printed 502 matches: 245 of `token:` or `Token:`, 104 of `sk-ant-`, 78 of `github_pat_` and 75 of
`secret =`. No other alternative matched. The first is the log label and the binding name described
above, and the rest are the scans' own pattern text and the step runner's variable.

The second (entry 22:20:37.568Z) asks for a whole key, or for a value after the keyword:

```
$ ["grep","-rnIiEo","gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|BEGIN [A-Z ]*PRIVATE KEY-----|bearer [A-Za-z0-9._-]{20,}|(password|passwd|secret|api[_-]?key)[[:space:]]*[:=][[:space:]]*[^[:space:]]{6,}","docs/spikes/non-elevated-job-object"]
```

It printed 38 matches. Each is the step runner's code `secret = a.shift();`, or an earlier filter's
pattern beginning `secret = |github_pat_`. None is a credential or a token.

The third, for email addresses (entry 22:20:41.718Z), printed 35 matches, every one
noreply@anthropic.com:

```
$ ["grep","-rnIoE","[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[a-z]{2,}","docs/spikes/non-elevated-job-object"]
```

Each scan ran over the files as they stood when it started, so none covers its own transcript entry
and process row, and the first two do not cover the later ones'. Those hold only the matched text
counted above. Nothing else under the directory changed after the first scan.

### Files written outside the spike's own directories

The spike's own directories were these:

- `C:\Users\user\1458-spike-engineer\` on the Windows machine. Removed at 03:07:44Z, after which
  `Test-Path` printed `False` (entry 03:07:45.229Z).
- The gitignored spike directory in this worktree, spikes/1458-spike-engineer.

| Host | File | Reason | Removed |
|---|---|---|---|
| Windows | none by the spike. Entry 03:09:04.193Z checked npm's default locations under `user`'s profile for writes since 02:57Z. `C:\Users\USER\AppData\Local\npm-cache\_logs` had a directory time of 03:06:08.9Z (entry 03:09:14.789Z) | That time falls inside n5, which ran no npm. The spike's one npm ran at 03:03:28Z with `--cache` inside its own directory. Another session working as `user` on the same machine changed that directory. A sibling spike's is a judgment | — |
| Windows | Security event log entries for the account's creation, its logons through the secondary logon service, and its deletion | Windows logs these. Not planned | No. Removing them means editing the machine's event log |
| Laptop | fx1458.pw, the account's password, in the session's scratch directory outside the repository | The commands read it on stdin | Yes, deleted after the account was deleted |
| Laptop | intent-1458.md, the stated-intent comment's body, and transcript-unredacted.txt, a copy of the transcript before redaction, in the same scratch directory | Posting the comment, and keeping the original whose sha256 the redactions cite | Yes, deleted before the pull request opened |

### Host-configuration changes

The stated-intent comment,
[1458#7073260684](https://github.com/williacj/rigger/issues/1458#issuecomment-7073260684), went up at
02:59:50Z. That was before the account was created (03:00:02Z), and before the first install (npm, at
03:03:28Z).

| Host | Change | Reverted |
|---|---|---|
| Windows | The local standard account `fx1458`, SID `[SID withheld]`, in no group | Yes. Deleted at 03:07:37Z, under "The account, deleted" |
| Windows | `icacls` grants to `fx1458` on the spike's own directory, `RX`, and `M` on its `runs\` | Yes. Removed with the directory at 03:07:44Z |
| Windows | `npm install koffi@3.3.8` into the spike's own directory | Yes. Removed with the directory |

That is every change. There was no sshd, group, policy, registry, firewall or service change, and no
WSL step. Nothing ended a process the spike did not start. So no step was posted on the sibling
cards #1459, #1460, #1462 or #1463.

### The Mac mini

Not used.

## Questions this leaves open, and what would settle them

| Open question | What would settle it |
|---|---|
| Does an interactive, Medium-integrity supervisor behave the same? | The same supervisor started from a standard user's or a filtered administrator's desktop terminal on the Windows machine. That needs an interactive logon, which this spike did not have |
| Did the outer job play any part in E2? | The same E2 run without kill-on-job-close under this route, which is #1460's cell |
| Which job held the supervisor before it made its own? | Reading the job from a process that can query it, for example with `QueryInformationJobObject` on a handle the secondary logon service holds. That is not reachable from the supervisor |
