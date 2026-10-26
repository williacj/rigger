ABOUTME: Spike findings for card #951 (M6-S2): the launchd cells #744 lost or never ran, re-measured on the
dedicated Mac mini over SSH and inside the owner's console session, with a stub and direct probes, never Rigger.

# launchd's lost cells, re-measured on the Mac mini

Card [#951](https://github.com/williacj/rigger/issues/951), acceptance revision `96e138feb9c4`. It cites
[#744's report](https://github.com/williacj/rigger/issues/744#issuecomment-6390300670) as "#744's report"
and keeps its cell names. Every figure below was measured on the Mac mini described under "Host" on
2026-10-25, unless it says otherwise. None of it is a correction to a figure #744 measured on the
owner's laptop.

## The answer

1. **A `bootstrap` of a job whose program names no file succeeds, silently.** It exits 0 and prints
   nothing, over SSH and in the console session alike. The job then sits loaded with
   `state = spawn scheduled`, `last exit code = 78: EX_CONFIG`, `penalty box` among its properties,
   and an event trigger waiting on that `Executable`. The system log says
   `Missing executable detected.` at the bootstrap (Q-n1). A program removed between firings gives
   the same picture at the next firing, 60 s later (Q-n2). So `doctor` must check the program's path
   itself. The job being loaded proves nothing about its program.
2. **A second `bootstrap` of a loaded label fails, and changes nothing.** In all four combinations
   (the job running or between firings, the plist on disk unchanged or edited) and on both channels
   it exits 5 with `Bootstrap failed: 5: Input/output error`. `launchctl print` is byte-for-byte the
   same before and after, so an edited plist is not picked up: `run interval` stays 60 where the
   edit set 120 (Q-o1). A re-install must `bootout` first.
3. **A `bootout` of a label not loaded exits 3**, with `Boot-out failed: 3: No such process`, on
   both channels (Q-o2).
4. **Reading over SSH and reading inside the owner's console session gave the same answers.** Each
   of the six in-session readings matches its SSH reading in exit status, message and `print`
   output, apart from coalition ids, pids and times. The SSH session's launchd manager is
   `Background` and the console's is `Aqua`, and launchd's answers did not depend on it.
5. **`codex login status` names no auth.json path.** Run by a LaunchAgent with `PATH` set, it wrote
   only `Logged in using ChatGPT` and exited 0, with `CODEX_HOME` unset and with `CODEX_HOME` set to
   a home whose auth.json links to the owner's (Q-i).
6. **On the mini, `RunAtLoad` true started the job 0.27 s after the bootstrap began, and `RunAtLoad`
   false 60.12 s after** (Q-a2, Q-a1). Neither contradicts a cell `D28` or "Triggers" cites.
7. **`display notification` from a LaunchAgent returns 0 whether or not the owner sees anything.**
   It returned 0 on every one of 223 firings. That includes the 10 posted while the posting app's
   notifications were turned off, two of which the owner recorded as not seen (Q-k2). With a Focus
   on that does not allow the posting app, the owner recorded three firings as only in Notification
   Centre (Q-k, phase B). Phases A and D and the global settings are not recorded per firing. "Q-k"
   says what was recorded and what was not.

## How it ran

- **Two machines.** Every command but the in-session readings ran from the owner's laptop over SSH
  to the Mac mini, as `ssh rigger-mini '<command>'`, by the spike engineer (a Claude Code session on
  the laptop) (U58). The laptop's own commands, `gh`, `git` and the reads in the clone, are
  recorded in the same transcript as `laptop` entries.
- **The remote shell.** Each remote command runs through the remote login shell's `-c`, `/bin/zsh`,
  as ssh does. The acceptance's `ProgramArguments` item does not count that. No plist's
  `ProgramArguments` runs a shell.
- **The wrapper.** Every command a cell rests on ran through one wrapper, `~/Library/Logs/rigger-spike-951/bin/t`, which recorded its
  number, its channel, `launchctl managername`, its start and end on the mini's clock, the
  one-minute load at its start and its exit status, and kept its stdout and stderr in `~/Library/Logs/rigger-spike-951/out/`.
- **Telling a remote status from ssh's own.** The wrapper's last line is
  `[951 #<n> channel=<c> exit=<s>]`, and its exit status is the command's. An ssh exit of 255 with
  no such line is ssh's own failure. No ssh call in this run exited 255, and every command that a
  cell rests on has its wrapper line.
- **The in-session readings.** Q-n1's bootstrap, Q-o1's four and Q-o2's one were read a second time
  inside the owner's gui/501 session (U61, K76). The owner ran
  `zsh ~/Library/Logs/rigger-spike-951/bin/seq-edges.zsh gui` at the mini's console, the same script
  the spike engineer ran over SSH as `seq-edges.zsh ssh`. Its 37 entries, 113 to 149, each record
  manager `Aqua`, against `Background` for every SSH entry.
- **The session types.** `launchctl print gui/501` over SSH reads `type = login`, `session = Aqua`,
  `creator = loginwindow[475]` (entry 019, excerpt in entry 159), and `who` shows the owner's
  `console` login at 13:10 local (entry 018). The SSH session's own domain, `launchctl print
  user/501`, reads `type = user`, `session = Background` (entry 020, excerpt in entry 160), and
  `launchctl managername` over SSH prints `Background` (entry 014).
- **Clocks.** Every pair of times subtracted or ordered below is the mini's: the wrapper's stamps,
  the stub's own stamps and the system log are all read on the mini. The system log prints local
  time, CDT (UTC−5); the rest is UTC. For the record only, the laptop-to-mini offset was measured
  with five SSH round trips of `print $EPOCHREALTIME` at 19:04Z: at the shortest round trip, 0.154 s,
  the mini was ahead by +0.005 to +0.158 s (entry 023). No figure below uses it.
- **No privilege was raised.** No `sudo`, no `asuser`. No bootstrap of a job whose program exists and
  whose label was not loaded failed, so the stop rule never fired.
- **No job ran Rigger.** Every job's program was `/opt/homebrew/bin/node` running the stub, an
  executable copy of the stub (Q-n2), or a path naming no file (Q-n1).

## Host

Read on the mini on 2026-10-25, the day of the run, over SSH:

| Fact | Value | Entry, command |
|---|---|---|
| macOS | 27.0.1, build 26A434 | 003, `sw_vers` |
| Hardware | `Mac16,10` | 004, `sysctl -n hw.model` |
| Logical CPUs | 10 | 005, `sysctl -n hw.logicalcpu` |
| launchd | `Darwin Bootstrapper Version 7.0.0: Sat Aug 22 16:52:45 PDT 2026; root:libxpc_executables-3298.1.1~67/launchd/RELEASE_ARM64E` | 006, `launchctl version` |
| Time zone | America/Chicago (CDT, UTC−5) | 007, `readlink /etc/localtime` |
| Clock sync | `timed` running (pid 444, entry 016). `sntp -d time.apple.com` measured an offset of −0.008 s ± 0.064 s, querying only (entry 012). The setting itself is unread: `systemsetup -getusingnetworktime` needs administrator access (entry 013) | 012, 013, 016 |
| `node` | v26.12.1 | 009, `/opt/homebrew/bin/node --version` |
| `codex` | codex-cli 0.164.0 | 010, `codex --version` |
| `gh` | 2.103.2 | 011 |

This is not #744's host. #744 ran on the owner's laptop, `Mac16,8` with 12 logical CPUs, on the
same macOS build.

**Other work on the mini during Q-a.** One process outside this spike matched runner, `node`,
`codex`, `claude` or `npm` in the full process lists taken at the start of batch 1 and while Q-a1
waited (entries 043 and 048, filtered in entry 161): `claude`, pid 2539, started 13:49:58 local,
which is the owner's console Claude session. No self-hosted runner and no other agent's suite was
running. The one-minute load was 2.52 at Q-a2's bootstrap and 2.39 at Q-a1's (entries 044, 047).

## The cells

Raw output is posted on #951 after the token grep, each block naming its original on the mini:
[part 1](https://github.com/williacj/rigger/issues/951#issuecomment-6403332484) (Q-a, Q-n1 over
SSH, Q-n2, Q-i), [part 2](https://github.com/williacj/rigger/issues/951#issuecomment-6403332852)
(Q-o over SSH), [part 3](https://github.com/williacj/rigger/issues/951#issuecomment-6403333159)
(in-session), [part 4](https://github.com/williacj/rigger/issues/951#issuecomment-6406173195)
(Q-k), and parts [5](https://github.com/williacj/rigger/issues/951#issuecomment-6406173461) and
[6](https://github.com/williacj/rigger/issues/951#issuecomment-6406173757) (`~/Library/Logs/rigger-spike-951/logs/k.jsonl`).
"Entry" numbers are the transcript's. The plists and the stub are in full in the batch comment,
[951#6401933790](https://github.com/williacj/rigger/issues/951#issuecomment-6401933790).

### Q-a1 and Q-a2: the first start's delay after `bootstrap`

**Serves:** checked against the cells `D28` and "Triggers" cite. **Measured.** Each job ran alone,
`StartInterval` 60, mode `exit0`.

| Cell | `bootstrap` start | `bootstrap` return | First start (stub's log) | Delay from start | Delay from return |
|---|---|---|---|---|---|
| Q-a2, `RunAtLoad` true | 19:24:58.942Z (entry 044) | 19:24:58.946Z, exit 0 | 19:24:59.210Z (`~/Library/Logs/rigger-spike-951/logs/a2.jsonl`, line 1) | 0.268 s | 0.264 s |
| Q-a1, `RunAtLoad` false | 19:24:59.569Z (entry 047) | 19:24:59.572Z, exit 0 | 19:25:59.689Z (`~/Library/Logs/rigger-spike-951/logs/a1.jsonl`, line 1) | 60.120 s | 60.117 s |

The wrapper's start and end stamps are `EPOCHREALTIME` taken just before and just after the
`launchctl` call. Q-a2's first start fell after the call returned, not inside it. These are one
reading each, on the mini. They are not a correction to #744's 60.0 to 61.5 s bound, which was read
on the laptop.

**Against `D28` and "Triggers".** "Triggers" says `RunAtLoad` true starts the job at load, and that
without it the first start waits one interval (Q-a1, Q-a2), and `D28` rule 2 rests on `RunAtLoad`
true. Both readings agree with that. Neither contradicts a cell either cites, so nothing goes to the
owner as `recorded-decision`.

### Q-n1: a program absent at `bootstrap`

**Serves:** M6-12b, what `launchctl print` and the system log show for a missing program, which
`doctor`'s program-path check reads. **Measured**, both channels. In scope: the program path names
no file. A present file that is not executable is out.

The job is `n1-ssh` over SSH and `n1-gui` in the session. Its first `ProgramArguments` entry is
`~/Library/Logs/rigger-spike-951/jobs/absent-program`, which never existed.

- **The `bootstrap`:** exit status 0, no stdout, no stderr. Over SSH that was entry 062
  (19:27:23.041Z to .045Z); in the session, entry 114 (21:04:40.225Z to .230Z).
- **`launchctl print gui/501/<label>`, 20 s later** (entries 063 and 115). The two outputs differ
  only in their coalition ids. The lines that matter:
  ```
  	state = spawn scheduled
  	program = /Users/cjwilliams/Library/Logs/rigger-spike-951/jobs/absent-program
  	runs = 1
  	last exit code = 78: EX_CONFIG
  			descriptor = {
  				"Executable" => "/Users/cjwilliams/Library/Logs/rigger-spike-951/jobs/absent-program"
  				"SkipImmediatePoll" => false
  	properties = runatload | penalty box | inferred program
  ```
  `print` exited 0, so the label was loaded, and the script booted it out (entries 065 and 117,
  each exit 0).
- **The system log.** Predicate `eventMessage CONTAINS "<label>"`, with `--info --debug`, from 5 s
  before the bootstrap to 25 s after it. Over SSH that was 14:27:18 to 14:27:48 CDT (entry 064):
  ```
  2026-10-25 14:27:23.049 E  launchd[1:160ab] [gui/501/com.williacj.rigger-spike.951.n1-ssh [4532]:] Missing executable detected. Job: 'com.williacj.rigger-spike.951.n1-ssh' Executable: '/Users/cjwilliams/Library/Logs/rigger-spike-951/jobs/absent-program'
  2026-10-25 14:27:23.050 I  xpcproxy[4532:160e8] (libxpc.dylib) Subscribed to event com.williacj.rigger-spike.951.n1-ssh using token 1131
  2026-10-25 14:27:23.050 Df launchd[1:16025] [gui/501 [100014]:] service inactive: com.williacj.rigger-spike.951.n1-ssh
  ```
  In the session, 16:04:35 to 16:05:05 CDT (entry 116), the same three lines for `n1-gui`, at
  16:04:40.222 to .223.
- **The job's log files.** launchd created `~/Library/Logs/rigger-spike-951/logs/n1-ssh.out` and `~/Library/Logs/rigger-spike-951/logs/n1-ssh.err` empty. No
  `n1-*.jsonl` exists, so nothing ran.

### Q-n2: a program removed between firings

**Serves:** M6-12b. **Measured**, over SSH. The job `n2`'s program is `~/Library/Logs/rigger-spike-951/jobs/n2-program`, an
executable copy of the stub with its `#!/opt/homebrew/bin/node` line, `StartInterval` 60, `RunAtLoad`
true.

- **The `bootstrap`:** entry 052, 19:26:00.265Z, exit 0, no output. First start 19:26:00.821Z, exit
  0 at once (`~/Library/Logs/rigger-spike-951/logs/n2.jsonl`, lines 1 and 2).
- **The removal:** `rm jobs/n2-program`, entry 054, at 19:26:01.371Z on the mini's clock, exit 0.
- **After the removal** (19:26:01.400Z, entry 055): `state = not running`, `runs = 1`,
  `last exit code = 0`, `properties = runatload | inferred program`. The log window, 14:25:55 to
  14:26:01 CDT (entry 056), has one line, `service inactive: com.williacj.rigger-spike.951.n2`, at
  14:26:00.819.
- **After the next firing would have fallen** (19:27:22.184Z, entry 057, 81 s after the first
  start): `state = spawn scheduled`, `runs = 2`, `last exit code = 78: EX_CONFIG`, an event trigger
  on `"Executable" => ".../jobs/n2-program"`, and
  `properties = runatload | penalty box | inferred program`. The log window, 14:25:55 to 14:27:22
  CDT (entry 058), adds at 14:27:00.835, 60.014 s after the first start:
  ```
  2026-10-25 14:27:00.835 E  launchd[1:15ef9] [gui/501/com.williacj.rigger-spike.951.n2 [4435]:] Missing executable detected. Job: 'com.williacj.rigger-spike.951.n2' Executable: '/Users/cjwilliams/Library/Logs/rigger-spike-951/jobs/n2-program'
  ```
  It also holds a line for the `log show` call of entry 056 itself, which matched the predicate
  because its own arguments name the label. That line is the spike's, not launchd's.
- `~/Library/Logs/rigger-spike-951/logs/n2.jsonl` holds that one start and its exit, and nothing more. `~/Library/Logs/rigger-spike-951/logs/n2.out` and `~/Library/Logs/rigger-spike-951/logs/n2.err` are
  empty. The `bootout` (entry 060) exited 0.

### Q-o1: `bootstrap` of a label already loaded

**Serves:** M6-12a, what the installation steps tell the owner. It serves M6-12b only for what
`print` shows before and after. **Measured**, four combinations on each channel. Each job is in
`D28`'s form. "Running" uses mode `run` for 150 s, so the job was alive at the second bootstrap.
"Between firings" uses `exit0`, so it had exited. "Edited" copies a version with `StartInterval` 120
over the loaded plist, at `live/<cell>.plist`, before the second bootstrap.

| Combination | SSH entries: first bootstrap, `print` before, second bootstrap, `print` after | In-session entries |
|---|---|---|
| running, unchanged | 067 (0), 068, **069 (5)**, 070 | 119 (0), 120, **121 (5)**, 122 |
| running, edited | 074 (0), 075, edit 076, **077 (5)**, 078 | 126 (0), 127, edit 128, **129 (5)**, 130 |
| between, unchanged | 082 (0), 083, **084 (5)**, 085 | 134 (0), 135, **136 (5)**, 137 |
| between, edited | 089 (0), 090, edit 091, **092 (5)**, 093 | 141 (0), 142, edit 143, **144 (5)**, 145 |

- **Every second bootstrap**, all eight, exited 5 within 3 to 6 ms, with stdout empty and this on
  stderr:
  ```
  Bootstrap failed: 5: Input/output error
  Try re-running the command as root for richer errors.
  ```
- **`print` before and after** are identical in every one of the eight pairs (`diff` empty). The
  running jobs kept their pid (for example `pid = 4624`, `state = running`, `runs = 1`), the
  between-firings jobs stayed `state = not running`, `last exit code = 0`, and every edited job
  kept `run interval = 60 seconds`. The edit was not applied.
- **The system log**, predicate `eventMessage CONTAINS "<label>"`, from 1 s before the second
  bootstrap to 3 s after it (for example entries 071 and 123), held **no lines** in all eight.
- Each job was then booted out, exit 0 (entries 072, 080, 087, 095; 124, 132, 139, 147).

### Q-o2: `bootout` of a label not loaded at the time

**Serves:** M6-12a. **Measured**, both channels. The label is `o1-between-same-<channel>`, which this
run bootstrapped and had booted out moments before.

- **Over SSH**, entry 096: exit status 3, stdout empty, stderr `Boot-out failed: 3: No such process`.
  The `print` after it (entry 097) exited 113: `Bad request.` /
  `Could not find service "com.williacj.rigger-spike.951.o1-between-same-ssh" in domain for user gui: 501`.
- **In the session**, entry 148: the same, exit 3, and its `print` (entry 149) exited 113 with the
  same words for `-gui`.

These two are the only `bootout`s of a label not loaded at the time. Every other `bootout` named a
label this run had bootstrapped and that was loaded.

### SSH against the console session

The six in-session readings, each against its SSH reading in the same state:

| State | SSH | Console session | Difference |
|---|---|---|---|
| Q-n1 bootstrap | 0, silent; `print` as above | the same | coalition ids only |
| Q-o1 running, unchanged | 5, `Input/output error` | the same | none but pid and times |
| Q-o1 running, edited | 5 | 5 | the same |
| Q-o1 between, unchanged | 5 | 5 | the same |
| Q-o1 between, edited | 5 | 5 | the same |
| Q-o2 | 3, `No such process` | 3, the same | none |

**No difference within a state.** It is a finding that the caller's session type, `Background` or
`Aqua`, did not change launchd's answers for these three commands on this host.

### Q-i: whether Codex reports an auth.json path, and which

**Serves:** #646. It serves M6-12a only if the template is to set `CODEX_HOME`. **Measured**, under
launchd only. Each job set `PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`, the shape
"The environment" has the template set, and ran `codex login status` by bare name with no shell, in
the stub's `codex-status` mode.

| State | Job | `codex login status` | Exit | auth.json the stub found |
|---|---|---|---|---|
| `CODEX_HOME` unset | `i0` | stderr `Logged in using ChatGPT`, stdout empty | 0 | `~/.codex/auth.json`, a regular file |
| `CODEX_HOME` set to `~/Library/Logs/rigger-spike-951/codex-home`, whose auth.json is a symbolic link to `~/.codex/auth.json`, as `src/substrate/providers/codex.mjs` makes a dispatch's home | `i1` | stderr `Logged in using ChatGPT`, stdout empty | 0 | the link, target `~/.codex/auth.json` |

- **Codex names no path** in either state. The full output is that one line. The stub elides any
  line naming an API key and any key- or token-shaped run; it elided nothing (`"elisions":0`).
- **The mini's Codex sign-in:** signed in, by ChatGPT, as the line says.
- **What `codex` wrote.** `~/.codex/auth.json` kept its time, `Oct 25 12:20:49`, and size, 4,500
  bytes, before and after (entries 101 and 109). `ls -la ~/.codex` was the same before and after
  (entries 102 and 110). Codex created a tmp/ directory in `~/Library/Logs/rigger-spike-951/codex-home` (entry 110).

### Q-k2 and the banner: notifications

**Serves:** M6-11d. **Q-k2: measured.** **The banner: measured for phases B and C, and unmeasured
per firing for phases A and D.**

**How it ran.** The notify job `k` (`StartInterval` 60, `RunAtLoad` true) ran in gui/501. Its
stub posts `display notification "Q-k at HH:MM:SS UTC" with title "Rigger spike 951"` through
`/usr/bin/osascript`, and logs the call's exit status and the stamp it showed (`~/Library/Logs/rigger-spike-951/logs/k.jsonl`). The
owner bootstrapped and booted out `k` from a shell in their console session (manager `Aqua`, parent
`zsh`), on the mini. Nothing was posted from the SSH session.

- **Batch 3,** `seq-k.zsh gui`: bootstrap at 21:08:42.659Z (entry 152). The phases began at:
  - A, 21:08:42Z (entry 153);
  - B, 00:41:03Z (entry 172);
  - C, 00:42:50Z (entry 173);
  - D, 00:45:21Z (entry 174).

  The bootout came at 00:47:59Z (entry 175). Phase A ran for three and a half hours, because the
  script waited on Return. Phases B and C got two firings each, short of the three the plan asked
  for.
- **Batch 3b,** `seq-k3b.zsh gui`, under the owner's go-ahead U64
  ([951#6405834991](https://github.com/williacj/rigger/issues/951#issuecomment-6405834991)), re-ran
  only B and C. Bootstrap at 01:12:26.841Z (entry 186). B began at 01:14:58Z (entry 188) and C at
  01:19:28Z (entry 193). The bootout came at 01:23:58.898Z (entry 199). After each firing the owner
  pressed one key, recorded in the transcript at the time.

**Q-k2: `display notification` with the posting app's notifications turned off.** It returned 0
with empty stderr on all 10 such firings:
- batch 3, phase C: 00:43:25Z and 00:44:25Z;
- batch 3, phase D: 00:45:26Z, 00:46:26Z and 00:47:26Z;
- batch 3b, phase C: 01:19:28Z, 01:20:28Z, 01:21:28Z, 01:22:29Z and 01:23:29Z.

It returned 0 on every one of the 223 firings in `~/Library/Logs/rigger-spike-951/logs/k.jsonl`, whatever the setting. What the
owner saw is in the next table.

**The banner, per state.** Each row's firing stamps are the ones the notification text carried.

| State | Batch 3 | Batch 3b, the owner's key at each firing |
|---|---|---|
| A: Banners; no Focus | not recorded per firing | not run |
| B: Banners; a Focus on that does not allow the app | not recorded per firing | 01:15:27 only in Notification Centre (entry 189); 01:16:27 only in Notification Centre (190); 01:17:28 only in Notification Centre (191); 01:18:28 unrecorded (192) |
| C: turned off; the same Focus on | not recorded per firing | 01:19:28 unrecorded (194); 01:20:28 unrecorded (195); 01:21:28 not seen (196); 01:22:29 unrecorded (197); 01:23:29 not seen (198) |
| D: turned off; no Focus | not recorded per firing | not run |

**Batch 3, in the owner's words.** Neither statement gives a per-firing observation, so this report
reads no firing's outcome from them. The coordinator relayed both:
- "batch 3 is done … I saw everything I was supposed to see"
  ([951#6405754753](https://github.com/williacj/rigger/issues/951#issuecomment-6405754753));
- "Everything showed as it was supposed to."
  ([951#6405838873](https://github.com/williacj/rigger/issues/951#issuecomment-6405838873)).

**Batch 3b's closing answers, as typed** (entries 202 to 208), each after its prompt:

| Prompt | Typed answer |
|---|---|
| The posting app's name, as System Settings, Notifications lists it | `x` |
| The Focus you used | (empty) |
| "Allow notifications when the display is sleeping": on or off? | (empty) |
| "Allow notifications when the screen is locked": on or off? | (empty) |
| "Allow notifications when mirroring or sharing the display": on or off? | (empty) |
| Did you watch the mini's own display throughout, never Screen Sharing (yes or no)? | `through its own displau` |
| Each setting you changed for batches 3 and 3b, and whether you kept or restored it | `Yes` |

The owner then answered the last prompt again, in their words: "turned on Do Not Disturb, then
restored everything"
([951#6406167931](https://github.com/williacj/rigger/issues/951#issuecomment-6406167931)).

**Where the owner watched.** The plan asked the owner to watch the mini's own display, never Screen
Sharing (951#6401933790; U62). The owner's record of it is entry 207's answer above, which is the
only one. Neither batch 3 statement mentions it.

**The global settings and the display.**
- **The three "Allow notifications when…" values:** unrecorded. Their prompts' answers are empty.
- **The display asleep:** measured from `pmset -g log` (entries 179 and 209, filtered in entries 181
  and 210). It logged "Display is turned off" at 21:20:50Z and "Display is turned on" at 21:34:44Z,
  inside batch 3's phase A, with the host in Deep Idle and DarkWakes between. It logged no display,
  sleep or wake event from 21:34:44Z to 01:24:28Z, the end of batch 3b. During that dark window
  `k` fired at 21:22:46, 21:24:55, 21:27:31, 21:29:52 and 21:32:33Z, irregularly, against every
  60 s outside it. Display sleep thus covers none of phases B, C or D.
- **The screen locked, and the display mirrored or shared:** unmeasured. `pmset` does not log them,
  and no prompt answer records them.
- **The posting app's name:** unrecorded. The answer is `x`. #744's judgment that the app is Script
  Editor is neither confirmed nor refuted here.

**A defect in the throwaway script,** recorded, not chased. Four "unrecorded" firings were stamped
within 0.1 to 0.5 s of their firing, not after the 55 s timeout: 01:18:28 (entry 192), 01:19:28
(194), 01:20:28 (195) and 01:22:29 (197). The five closing answers in entries 202 to 206 were
recorded within 0.16 s of entry 201's start. Those times are measured. That `read` took keys or
Returns already typed, because the script accepted any key and never flushed its input, is a judgment. The
script is throwaway and never merges, so no card follows.

**Not counted in any phase.** Batch 3b's firings at 01:12:27, 01:13:27 and 01:14:27Z fell before
phase B began, while the owner set its state.

## Recommendations

### For M6-12b: `doctor`'s check of a missing program (Q-n)

**Do:** check the program path itself. Where the loaded job's `program` does not resolve to a file,
report it as a failing check that names the path, and do not stop there.
`launchctl print` and `bootstrap` give no error to read: the bootstrap exits 0, and `print` exits 0
for a loaded job. A job's `last exit code = 78: EX_CONFIG`, with `state = spawn scheduled` and
`penalty box`, is what launchd shows for a missing program, both at load (Q-n1) and after a later
removal (Q-n2). `doctor` may report those words beside the missing path. It must not take them as
the test, since an exit code 78 can come from the program itself (a judgment).

**Do not assume** that a loaded job has a program, or that `bootstrap`'s status says anything about
the program.

**Would reverse it:** a macOS release whose `bootstrap` refuses a plist naming a missing program, or
whose `print` stops showing `program =` for it.

### For M6-12a: the installation steps (Q-o)

**Do:** tell the owner that installing, re-installing or applying an edited plist is
`launchctl bootout gui/<uid>/<label>` and then `launchctl bootstrap gui/<uid> <plist>`. A
`bootstrap` of a label already loaded exits 5, `Input/output error`, and leaves the loaded job
exactly as it was, edits ignored (Q-o1). A `bootout` of a label not loaded exits 3,
`No such process`, which the steps may say is harmless before a first install (Q-o2).

**Do not tell the owner** that exit 5 means "already loaded". It is a generic error, and this spike
measured it only for that one cause. To learn whether a label is loaded, the steps use
`launchctl print gui/<uid>/<label>`, which exits 113 for a label not loaded (Q-o2's `print`).

**For M6-12b, from Q-o1:** `print` cannot show that a re-install failed, because it is unchanged. It
reports the loaded job, not the plist on disk, so `doctor` compares the loaded values, as "Triggers"
already has it do for the exit timeout.

**Would reverse it:** a macOS release where a repeated `bootstrap` replaces the loaded job, or where a
`bootout` of a label not loaded exits 0.

### For #646 (Q-i)

**Do:** derive the auth.json a session uses from `CODEX_HOME`, or from `~/.codex` when it is unset,
as `src/substrate/providers/codex.mjs` already does. `codex login status` names no path, so no reading of it can tell which
file was used. Both states signed in, so the template has no sign-in reason to set `CODEX_HOME`.

**Would reverse it:** a codex-cli release whose `login status` names the file.

### For M6-11d (Q-k2 and the banner)

**Do:** treat `display notification`'s exit 0 as "posted", never as "seen". It returned 0 with the
posting app's notifications turned off, when the owner recorded firings as not seen (Q-k2). Where
M6-11d needs the owner to have seen a notice, it needs a second record that does not depend on a
banner, such as the run's report or a card comment. A notice under a Focus that does not allow the
posting app lands only in Notification Centre (phase B, three firings).

**Do not assume** that the posting app is Script Editor, that the owner's global notification
settings allow banners while the display sleeps or the screen is locked, or anything about phases A
and D per firing. None of these is recorded.

**Would reverse it:** an `osascript` release whose `display notification` fails when the app's
notifications are off, or a measured banner under a Focus that does not allow the posting app.

## Approvals

- The batch plan, with every label, the stub, every plist and every script in full, was posted
  before any `bootstrap` or `bootout` (951#6401933790, 19:10Z, entry 034).
- The owner's go-ahead for all three batches, in the owner's words, "I approve all three batches",
  was relayed by the coordinator at 19:24:33Z
  ([951#6402095288](https://github.com/williacj/rigger/issues/951#issuecomment-6402095288)). Batch
  1's first `bootstrap` came after it, at 19:24:58.942Z (entry 044).
- Batch 1 ran from 19:24:58Z to 19:28:46Z, batch 2 from 21:04:40Z to 21:06:02Z, batch 3 from
  21:08:42Z to 00:47:59Z, and batch 3b from 01:12:26Z to 01:24:28Z.
- Batch 3b, one more bootstrap and bootout of `k` for phases B and C, rests on the owner's U64, "I
  approve a rerun" (951#6405834991). Its script was posted in full before it ran
  ([951#6405848862](https://github.com/williacj/rigger/issues/951#issuecomment-6405848862), 00:57Z).
- **Every bootstrap and bootout, by label.** Each bootout named a label this run had bootstrapped
  earlier. Q-o2's two bootouts, entries 096 and 148, are the only ones of a label not loaded at the
  time.
  - **Over SSH (batch 1):** `a2`, `a1`, `n2`, `n1-ssh`, the four `o1-*-ssh`, `i0` and `i1`.
  - **In the console session (batch 2):** `n1-gui` and the four `o1-*-gui`.
  - **In the console session (batches 3 and 3b):** `k`, twice.

## Transcript

One transcript holds every command run for this spike, on either machine: the Mac mini's
`~/Library/Logs/rigger-spike-951/transcript.md`, with each command's output beside it in
out/<entry>.out and out/<entry>.err. Each entry has its start, its exit status and the mini's one-minute load. It is
posted on #951, as it stood at entry 227, in
[part 1](https://github.com/williacj/rigger/issues/951#issuecomment-6406204021) and
[part 2](https://github.com/williacj/rigger/issues/951#issuecomment-6406204301). Every later entry
records posting those comments and the checks made on them.

- **`ssh` and `gui` entries** are commands run on the mini through the wrapper, timed on the mini's
  clock.
- **`laptop` entries** are commands run on the laptop, and commands run over SSH outside the wrapper.
  Each is recorded with the laptop time it ran and the mini's load and time at recording.
  - Entries 002, 024, 027, 028 and 038 were written after the fact, during setup, before or beside
    the wrapper. Their laptop times are hand-typed and approximate: entry 038 says 19:12Z, and the
    mini recorded it at 19:10:41Z.
  - Later `laptop` entries take the laptop's time from `date -u` as the command ran.
- **Entry 001's lock failed.** The wrapper's lock file did not exist yet, so its numbering lock
  failed. Its record is otherwise complete, and the wrapper was fixed before entry 002.
- **The script invocations are not entries.** Each script, `zsh seq-batch1.zsh`,
  `seq-edges.zsh gui`, `seq-k.zsh gui` and `seq-k3b.zsh gui`, was started outside the wrapper.
  Every command each script ran is an entry.
  - The spike engineer started batch 1's over SSH, with its console output going to
    `batch1.console`, right after entry 039.
    Its first entry is 040, and entry 227 records the start after the fact.
  - The owner started the other three in Terminal.app. Their first entries are 113, 151 and 185.

## Token grep

The command is `zsh ~/Library/Logs/rigger-spike-951/bin/tokengrep.zsh <paths>`, whose source is in
951#6401933790:

```
/usr/bin/grep -R -p -n -E \
  -e 'gh[opsu]_[A-Za-z0-9]{20,}' \
  -e 'github_pat_[A-Za-z0-9_]{20,}' \
  -e 'sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}' \
  -e '"(access|refresh|id)_token"[[:space:]]*:[[:space:]]*"[^"]{8,}"' \
  -- "$@"
```

- **What it covers:** GitHub tokens, Anthropic keys, OpenAI keys (`sk-` and `sk-proj-`) and the JSON
  fields `access_token`, `refresh_token` and `id_token`, each shaped like a token value.
- **Symbolic links:** `-p` follows none, so it never reads the owner's auth.json through
  `~/Library/Logs/rigger-spike-951/codex-home/auth.json`.
- **A self-test** on a file of fake token-shaped strings matched (entry 028). The file was removed.
- **No token value matched** (exit 1) over the mini's log directory, which holds the transcript and
  every comment body posted (entries 029, 031, 033, 154, 164, 182, 213, 218 and 230). It also
  matched nothing over all 20 comments on #951 as fetched back from GitHub at entry 233, the
  owner's relays among them (entry 234), and over this report and the journal entry as drafted
  (entry 235).

## Writes outside the log directory

| When | Machine | Who | What | Why |
|---|---|---|---|---|
| 2026-10-25 ~19:00Z | laptop | spike engineer | `~/GitHub/rigger-worktrees/951-spike-engineer`, a clone on `rigger-951` | the brief named a clone that did not exist; it holds this report |
| ~19:00Z | laptop | spike engineer | copies of #744's plan and report in the session's scratch directory | reading only; nothing the report relies on. Removed at entry 222 |
| 19:24Z on 2026-10-25 to 01:24Z on 2026-10-26 | mini | launchd | each job's loaded state in gui/501, removed at its `bootout` | the measurements |
| 19:28Z | mini | codex | tmp/ inside `~/Library/Logs/rigger-spike-951/codex-home`, which is inside the log directory; nothing changed in `~/.codex` that `ls -la` and `stat` show | Q-i |
| batches 3 and 3b | mini | the owner | the owner's notification settings and Focus. In their words: "turned on Do Not Disturb, then restored everything" (951#6406167931). Their typed answer at the prompt was `Yes` (entry 208) | Q-k, U4.4 as U62 extends it |
| on #951 | GitHub | spike engineer, through the mini's `gh` | the batch plan and the raw-output comments | the judge's route |

## Cleanup

- **Nothing is left loaded.** At 01:27:26Z on 2026-10-26, after batch 3b, the spike engineer ran
  `launchctl print gui/501` over SSH (entry 223), and `grep -c com.williacj.rigger-spike.951.` over
  its output printed `0` (entry 224, exit 1). The owner's scripts ran the same filtered count after
  each of their batches (entries 178 and 201), with the same result.
- **`~/Library/LaunchAgents`** holds no spike plist (entry 225). No job was ever installed there.
- **What stays inside the log directory,** on the mini, as the record the report links:
  the transcript, the directories out, logs, bin, jobs, plists, live, comments and codex-home,
  and `batch1.console`, the console output of `~/Library/Logs/rigger-spike-951/bin/seq-batch1.zsh` (entry 226).
- **What stays outside it:**
  - **On the laptop,** the clone `~/GitHub/rigger-worktrees/951-spike-engineer`, which carries this
    report's branch. It goes when the branch merges. The scratch copies of #744's plan and report
    were removed (entry 222).
  - **On the mini,** the owner's settings, which the owner says they restored: "turned on Do Not
    Disturb, then restored everything" (951#6406167931).
  - **On the mini, `~/.codex`** is unchanged as far as `ls -la` and `stat` show (Q-i).
- **Whether the owner keeps the log directory** is the owner's call. The spike deletes nothing in
  it, because the report links it as the original.
