ABOUTME: Spike findings for card #335: what a headless Claude CLI session and a cold cargo workspace
build leave outside their process group on macOS, and which census could find what they leave.

# What leaves the process group, and whether Rigger could find it

## The answer

The cold `cargo build --workspace` of Tauri's workspace left nothing alive once its group was
empty. `ps` observed 1,571 of its processes, and every one stayed in the group. The
working-directory census saw one more, pid 74625, which `ps` never saw, so whether that one stayed
in the group is unknown. It was not alive at the census or after, so it did not outlive the group
("Workload 2").

The headless Claude CLI session did leave processes outside its group. Claude Code runs every Bash
tool call in a process group of its own, so none of an agent's shell commands is in the group
Rigger created.

On a normal exit, the CLI ended its own `run_in_background` task. It did not end a process that a
foreground command started with `&`. That process lived about 108 s past the group in run 2, and
114 s in run 3, until it finished by itself.

When the group was killed while the session ran, which is the path a timeout takes, both survived.
The background task lived 86 s and the `&` loop 119 s past the group, and each ran to its natural
end.

Of the censuses tried, only one found every survivor: listing every process whose working
directory lies under the workload's directory, which for a dispatch is its worktree. The
environment marker is read back through `ps` only for binaries that are not Apple's. The output
socket was already closed. And the parent walk lost the survivors the moment they were reparented.

I recommend that L0's census change: after the group kill, add a working-directory census of the
dispatch's worktree, and kill and record what it finds. The recommendation and what would reverse
it are at the end.

This report hands over evidence. It changes no code, requirement or recorded decision. The
throwaway harness lives in the gitignored spikes directory of the maker's worktree, under c335, and
is not in this pull request. The appendix at the end lists every process each method saw in each
run.

## Host and versions

Each is exactly as the tool printed it on 2026-09-27:

| Tool | Command | Printed |
|---|---|---|
| macOS | `sw_vers` | `ProductName: macOS`, `ProductVersion: 27.0`, `BuildVersion: 26A428` |
| Kernel | `uname -r` | `27.0.0` |
| Node | `node --version` | `v26.5.0` |
| Claude CLI | `claude --version` | `2.1.283 (Claude Code)` |
| cargo | `cargo --version` | `cargo 1.97.0 (c980f4866 2026-06-30)` |
| rustc | `rustc --version` | `rustc 1.97.0 (2d8144b78 2026-07-07)` |
| lsof | `lsof -v` | `revision: 4.91` |

The host is an Apple M4 Pro with 12 cores (`sysctl hw.ncpu machdep.cpu.brand_string`).

## Runs

I stated each run on #335 before making it:
[the plan](https://github.com/williacj/rigger/issues/335#issuecomment-5861026402), then addenda
[1](https://github.com/williacj/rigger/issues/335#issuecomment-5861051280),
[2](https://github.com/williacj/rigger/issues/335#issuecomment-5861144408),
[3](https://github.com/williacj/rigger/issues/335#issuecomment-5861160536),
[4](https://github.com/williacj/rigger/issues/335#issuecomment-5861188169) and
[5](https://github.com/williacj/rigger/issues/335#issuecomment-5861223182). There is one
exception. Control 2 ran before addendum 1 was posted, because a tool guard refused my first post
and I did not notice before I ran it. Addendum 1 says so.

| Run | Record | What changed | Direct child |
|---|---|---|---|
| Claude 1 | `claude-2026-09-28T00-03-26-193Z` | as planned; the Bash tool refused step 2 | exit 0 at 17.7 s |
| Claude 2 | `claude-2026-09-28T00-14-35-984Z` | step 2 rewritten as a `nohup` loop | exit 0 at 14.4 s |
| Claude 3 | `claude-2026-09-28T00-16-52-207Z` | as run 2, plus the working-directory census | exit 0 at 14.4 s |
| Claude 4 | `claude-2026-09-28T00-24-20-844Z` | as run 3, with the group killed at 9.5 s | `SIGKILL` at 9.5 s |
| Cargo | `cargo-2026-09-28T00-20-16-207Z` | as planned | exit 0 at 180.0 s |
| Control 1 | `control-2026-09-28T00-00-49-065Z` | as planned | exit 0 at 5 ms |
| Control 2 | `control-2026-09-28T00-02-04-086Z` | direct child held 3 s | exit 0 at 3.0 s |
| Control with node | `control-node-2026-09-28T00-19-39-975Z` | the leaver is `node`, not `/bin/sleep` | exit 0 at 3.0 s |

## How the processes were observed

The harness is a Node script. It starts each workload the way L0 will: with `spawn(cmd, args, {
cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })`. That gives the workload a process
group whose id is the direct child's pid.

The environment is the harness's own, with every `CLAUDE*` variable removed and
`C335_MARKER=<workload>-<nonce>` added. The harness itself ran inside a Claude Code session, so one
variable of that session, `AI_AGENT`, reached the workloads. The removal did not catch it.

**Sampling.** The harness runs `ps -A -ww -o pid=,ppid=,pgid=,lstart=,command=` in a loop. It
waits 50 ms from one sample's start to the next, or longer when the sample itself takes longer. A
process counts as the workload's if its group is the workload's, or if its parent is already
counted. The harness keys each process by pid and start time, so a reused pid is a new process.

| Run | Samples | Gap between samples, p50 / p90 / p99 / max (ms) | `ps` duration, p50 (ms) |
|---|---:|---|---:|
| Claude 1 | 393 | 52 / 52 / 54 / 59 | 32 |
| Claude 2 | 392 | 52 / 52 / 53 / 54 | 30 |
| Claude 3 | 2,990 | 51 / 52 / 55 / 100 | 32 |
| Claude 4 | 3,031 | 51 / 52 / 63 / 208 | 31 |
| Cargo | 3,095 | 52 / 74 / 137 / 228 | 44 |

**The census.** Once the direct child exits, the harness takes one more sample. It sends `SIGKILL`
to the group, samples until no process carries the group's id, and then watches every process it
had counted until each ends, or until 180 s pass. It never reached that cap.

**The working-directory census**, from Claude run 3 on. Once a second, and at each checkpoint, the
harness runs `lsof -a -d cwd -n -P -u <uid>` and keeps every process whose working directory lies
under the workload's directory. One call took 125–242 ms (lsof, runs 3 and 4).

**Readings at each checkpoint.** At about 9 s into the run (60 s for cargo), again at the census,
and again once the group is empty, the harness takes three readings:

- `ps -E -ww -o pid=,command= -p <pids>` for the marker;
- a `sysctl(KERN_PROCARGS2)` read of the same pids, to separate what `ps` shows from what the
  kernel returns;
- `lsof -U -n -P`, looking for every process holding the peer end of the harness's two sockets.

### What the method can miss

- **A process that lives for less than one interval.** Where the gap was 52 ms, that means
  anything shorter; in cargo's tail, anything up to 228 ms. Exec tracing through `dtrace` or
  `eslogger` would not miss one, but both need root (see "Readings not taken").
- **A process whose parent is missed and which leaves the group.** It is never counted, because
  neither rule reaches it. This is how Claude runs 2, 3 and 4 missed their `&` survivor.
- **A process seen only after it exits.** `ps` shows a zombie's name in parentheses and no command
  line. The appendix marks each of these.
- **Non-atomic samples.** One `ps` call does not capture a single instant, so a fork or exec during
  the call can appear in either state.

### Readings that show a process was missed

- **Claude runs 2, 3 and 4.** The `&` survivor's group id was 77683 in run 2, 58081 in run 3 and
  6364 in run 4. That is the pid of the zsh that step 2 ran in. `ps` tracking never saw any of the
  three survivors.
  - In runs 2 and 3 that zsh appears in no sample.
  - In run 4 it was sampled once, at 7,413 ms, already a zombie. It had exited and its child had
    been reparented, so the parent rule could not reach the child.
  - In run 2 I found the survivor by hand, after the harness had finished.
  - In runs 3 and 4 only the working-directory census saw it: pid 58105 and pid 6371.
  - Step 3's zsh (`ls`) is also absent from run 3's samples.
- **Claude runs 3 and 4, beyond the survivor.** The working-directory census saw more that `ps`
  tracking never did:
  - 119 and 120 `sleep 1` children of the `&` loop, named from a `ps` sample that held them but
    was not tracking them;
  - 36 and 40 entries with no name, because their pid was absent from the latest `ps` sample. In
    run 3, 35 of the 36 pids appear under a name in another census entry; in run 4, 38 of the 40
    do, one of them the survivor 6371. Those counts are measured, read from the runs' raw records
    by [#355's round-2 review](https://github.com/williacj/rigger/pull/355#issuecomment-5861640410).
- **Cargo.** The working-directory census saw pid 74625 at 89,599 ms, with its working directory
  under the Tauri tree. No `ps` sample held that pid, before or after, so its name, group and
  command line are unknown. It is the one process of cargo's that only the census saw.
- **Claude runs 1, 3 and 4.** Children of `claude` in its first 300 ms appear only as zombies:
  `(git)`, `(2.1.283)` and `<defunct>`.
- **Cargo.** `/private/tmp/c335/tauri/target/debug/build/*/output` holds 92 files, one per build-script run. `ps` saw 90
  `build-script-build` processes and one `build-script-test-build`, so at least one run was
  probably missed. It may be among the 9 zombies that had no name.
  - 522 of the 1,571 processes were seen only as zombies, so their command lines are unknown.
  - All 39 `xcrun` invocations were seen only as zombies.

### The limit this places on the recommendation

A census by sampling cannot show that nothing left the group. It can only show what it saw. So the
cargo finding, "nothing left", is limited to processes that lived past one interval, or that had a
child which did.

A process that detaches has to outlive its parent to matter, but it can do that before its first
sample. So the gap that matters is not "short-lived processes". It is a detacher whose parent was
too brief to sample, or seen only once it had exited, which is Claude runs 2, 3 and 4.

The recommendation rests on survivors that the harness did see. It does not rest on a claim that
nothing else survived.

## Workload 1: the headless Claude CLI session

The command line, run from `/private/tmp/c335/claude-scratch` in all four runs:

```
claude -p <prompt> --output-format stream-json --verbose --model sonnet --max-budget-usd 2 --allowedTools Bash --mcp-config /private/tmp/c335/claude-scratch/mcp.json
```

The prompt for runs 2–4, verbatim. Run 1's step 2 was `sleep 120 > /dev/null 2>&1 & echo started`,
and it is on the card.

```
This is a process-observation test in an empty scratch directory. Do exactly these three steps, in order, and nothing else.
1. Call the Bash tool with run_in_background set to true, running: for i in $(seq 1 90); do date +%s >> loop.log; sleep 1; done
2. Call the Bash tool normally (not in the background), running: nohup /bin/sh -c 'for i in $(seq 1 120); do date +%s >> bg.log; sleep 1; done' > /dev/null 2>&1 & echo started
3. Call the Bash tool normally, running: ls
Then reply with the single word DONE and stop. Do not wait for the background commands to finish. Use no other tool.
```

M4 has no dispatch code yet. So "as M4 will dispatch a maker" here means `claude -p` spawned
detached with piped output, in a directory of its own, with the user's configuration unrestricted.
Which model and which tools M4 will pass is M4's decision. `--model sonnet` and `--allowedTools
Bash` are my choices, made for cost and for safety.

### The MCP servers it declared

No `--strict-mcp-config` was given, so every configured server was declared. The session's
init event (type `system`, subtype `init`) listed the same 16 servers in all four runs:

| Server | Source | Transport | Status |
|---|---|---|---|
| `c335-filesystem` | `--mcp-config` | stdio, `npx -y @modelcontextprotocol/server-filesystem@2026.8.31 /private/tmp/c335/claude-scratch` | connected |
| `plugin:productivity:slack`, `notion`, `asana`, `linear`, `atlassian`, `monday`, `clickup` | plugin | HTTP | needs-auth |
| `plugin:productivity:google calendar`, `gmail` | plugin | HTTP, declared with an empty URL | failed |
| `claude.ai Claude Docs`, `Aleph Beta`, `Shopify`, `Gmail` | claude.ai | remote | connected |
| `claude.ai Google Calendar`, `Google Drive` | claude.ai | remote | needs-auth |

The session attempted every declared server. Nine did not connect: seven lack the owner's OAuth,
and two are declared with no URL. Those nine are remote, so they would start no local process
either way. That is a judgment from their transport. The stdio server is the one that gives the
census something to see, and it connected in every run.

The `rust-analyzer-lsp` plugin was enabled, and no `rust-analyzer` process appeared. The scratch
directory holds no Rust file.

### What it started, and where each process went

The appendix lists every process. Grouped by role, they are:

| Process | Group | Evidence |
|---|---|---|
| `claude -p …`, the direct child | the workload's | pgid equals its own pid in every sample |
| `npm exec @modelcontextprotocol/server-filesystem…` and its child `node …/mcp-server-filesystem` | stayed in | pgid equal to the workload's in every sample |
| `/bin/zsh -c -l SNAPSHOT_FILE=…`, `(head)` and `(cat)`: the shell snapshot, at about 4.5 s | stayed in | same |
| `(git)`, `(2.1.283)` and `<defunct>` in the first 300 ms | stayed in | same, seen only as zombies |
| `(ps)`, a child of `claude` just before it exits | stayed in | same |
| The `run_in_background` task: `/bin/zsh -c source …snapshot… eval 'for i in $(seq 1 90) …'`, with its `sleep 1` and `date` children | **left** | pgid equal to the zsh's own pid (24622, 77452, 53953, 6061) from its first sample |
| The foreground call's zsh for step 3 (`ls`), run 2 | **left** | pgid 77721, its own pid |
| Step 2's zsh | **left** | runs 2 and 3: never sampled, and the survivor's pgid names it. Run 4: pid 6364, sampled once as a zombie with pgid 6364, its own pid |
| Step 2's `nohup /bin/sh -c 'for i in $(seq 1 120) …'` and its `sleep 1` children | **left** | pgid 77683 (run 2), 58081 (run 3), 6364 (run 4); ppid 1 |

Every Bash tool call ran in a zsh whose process group was its own. So the rule is not "background
commands leave". Every shell command the agent runs is outside the group Rigger created.

### What survived the group, and for how long

The group has "every process killed" at the point where no sample shows its id. In runs 1–3 the
group was already empty when the harness's `SIGKILL` arrived (`kill ESRCH`), because `claude` had
exited and taken its in-group children with it.

| Run | Process that left | Alive once the group was empty? | For how long after, measured |
|---|---|---|---|
| 1 | background-task zsh 24622 and children | no | last seen 17,384 ms, before `claude`'s exit at 17,739 ms; the stream shows `task_updated … "status":"killed"` |
| 2 | background-task zsh 77452 and children | no | last seen 14,063 ms; exit at 14,374 ms |
| 2 | step 3's zsh 77721 | no | seen only as a zombie, at 7,942 ms |
| 2 | step 2's `nohup` loop, pid 77685 | **yes** | last alive at 00:16:44.553Z, polled every 100 ms by `ps -p` (a throwaway poller in the harness directory, whose output is recorded). The group was seen empty at 00:14:56.084Z (20,100 ms from the spawn at 00:14:35.984Z), so the survivor lived 108.5 s past the group. It ended by itself after its 120 iterations |
| 3 | background-task zsh 53953 and children | no | last seen 14,182 ms; exit at 14,449 ms |
| 3 | step 2's `nohup` loop, pid 58105 | **yes** | 113.8 s after the group was empty, by the working-directory census. It ended by itself |
| 4 | background-task zsh 6061 and children | **yes** | 86.3 s after the group was empty, by `ps`; reparented to pid 1. It ended by itself: `/private/tmp/c335/claude-scratch/loop.log` holds all 90 lines |
| 4 | step 2's `nohup` loop, pid 6371 | **yes** | 118.8 s after the group was empty, by the working-directory census. It ended by itself: `/private/tmp/c335/claude-scratch/bg.log` holds all 120 lines |

Run 4 is the case for M2's timeout kill, and for any kill of a live dispatch. The group kill took
`claude`, `npm` and the MCP server. It did not take either shell the agent had started. M8's
"leaves no descendant within ten seconds" fails there by more than a minute.

## Workload 2: the cold workspace build

**The workspace.** It is `https://github.com/tauri-apps/tauri` at tag `tauri-v2.12.0`, commit
`447fa9f3f993fe77724189e355078b38ce20baea`, shallow-cloned to `/private/tmp/c335/tauri`. The build
ran from there as `cargo build --workspace`, with no `/private/tmp/c335/tauri/target` directory present.

**Why not Emend.** Emend is not a workspace yet. `~/GitHub/emend` is at `bfc6767` ("Initial
commit"), holding `README.md` and `LICENSE` only. `git ls-remote https://github.com/williacj/emend.git`
shows that SHA as its only head. Emend describes itself as a Tauri app, so Tauri's own workspace
stands in for it.

**How it met each condition.**

- **Build scripts.** Its members carry them, for example crates/tauri/build.rs,
  crates/tauri-runtime-wry/build.rs and examples/api/src-tauri/build.rs, all under
  `/private/tmp/c335/tauri`.
- **A procedural macro.** `/private/tmp/c335/tauri/crates/tauri-macros/Cargo.toml` declares `proc-macro = true`.
- **An empty target directory.** `ls -d /private/tmp/c335/tauri/target` found nothing before the
  run.

**The run.** Cargo also fetched a git dependency, `https://github.com/tauri-apps/schemars.git`, and
the crates.io index. Both are reads. It printed ``Finished `dev` profile [unoptimized + debuginfo]
target(s) in 2m 59s``, and exited 0 at 180.0 s.

**Observed.** 1,571 processes:

| Name | Running | Zombie only |
|---|---:|---:|
| `rustc` | 816 | 135 |
| `clang` | 115 | 195 |
| `cc` | 0 | 11 |
| `ld` | 56 | 91 |
| `build-script-build` | 58 | 32 |
| `build-script-test-build` | 1 | 0 |
| `xcrun` | 0 | 39 |
| `ar` / `libtool` | 1 / 0 | 4 / 4 |
| `rustdoc` | 1 | 0 |
| `cargo` | 1 | 2 |
| unnamed `<defunct>` | 0 | 9 |

**Where they went.** Every one of the 1,571 that `ps` saw had the workload's pgid in every sample
that saw it.

The working-directory census ran once a second for the whole build. It recorded 66 entries:

- 48 that a `ps` sample held, every one of them also tracked by `ps`, and so in the group;
- 17 pids that no `ps` sample around the census held, but which `ps` tracking saw at some other
  moment;
- 1 pid that `ps` never saw at all: 74625, at 89,599 ms.

What 74625 means for the headline: it was a process of the build's, since its working directory was
in the Tauri tree. It lived too briefly for any `ps` sample, so whether it stayed in the group is
unknown. It was not alive at the census, 180,080 ms, nor at any census after the group was empty,
which found nothing. So the finding stands as "nothing of cargo's outlived the group". The stronger
reading, "nothing left the group", holds only for the 1,571 that `ps` saw.

The census at 60 s found only `cargo` itself. At the census after the direct child's exit, and
after, it found nothing. No process was alive once the group was empty.

## Could Rigger find a process that left?

### The environment marker, read back through `ps`

The answer is **only for a process whose binary is not an Apple platform binary**. Group membership
makes no difference. `ps -E` and the kernel's `KERN_PROCARGS2` agreed in every reading.

| Run | Process | In the group? | Marker read back? |
|---|---|---|---|
| Claude 3, 4 | `claude` (`~/.local/share/claude/versions/2.1.283`) | in | yes |
| Claude 3, 4 | `node …/mcp-server-filesystem` | in | yes |
| Claude 3, 4 | `npm exec …`, which is `node` | in | no |
| Claude 3, 4 | background-task `/bin/zsh`, `sleep` | left | no |
| Claude 2 | the `nohup` survivor `/bin/sh`, pid 77685, by hand (unrecorded) | left | no |
| Cargo | `cargo` | in | yes |
| Control 2 | `/bin/sh`, `/bin/sleep 3` | in | no |
| Control 2 | `/bin/sleep 30` | left | no |
| Control with node | `/opt/homebrew/bin/node` | left | **yes**, before and after the group was empty |

Here is one reading of each kind, from the harness's record:

```
# control with node, after the group was empty: left the group, marker visible
ps -E:  /opt/homebrew/bin/node -e setTimeout(() => {}, 30000) NoDefaultCurrentDirectoryInExePath=1 C335_MARKER=control-node-d2ded633 …
sysctl: 35819 bytes 2340 strings 48 env-like 45 marker True

# Claude run 2, by hand, 25 s after the session exited: left the group, marker invisible.
# Unrecorded: taken in my shell, not by the harness, so no record file holds it.
$ ps -E -ww -o pid=,command= -p 77685
77685 /bin/sh -c for i in $(seq 1 120); do date +%s >> bg.log; sleep 1; done
sysctl: 77685 bytes 91 strings 4 env-like 0 marker False

# Claude run 3, mid-run: in the group, marker visible
ps -E:  node /Users/cjwilliams/.npm/_npx/…/mcp-server-filesystem /private/tmp/c335/claude-scratch … C335_MARKER=claude-6e8248f1 …
```

`codesign -dv /bin/zsh` prints `Platform identifier=26`. `node`, which shows its environment, is
ad-hoc signed. `claude`, which shows its environment too, is signed with the hardened runtime.

So my judgment is that the kernel withholds the environment of Apple platform binaries from
another process of the same user. The premise is that pattern across the readings above. I did
not find it documented.

`npm exec` shows no environment either. My judgment is that npm sets its process title, and the
title overwrites the argument area that the environment follows. I did not test that.

Every survivor the Claude CLI left was `/bin/zsh`, `/bin/sh` or `/bin/sleep`. So the marker found
none of them.

### `lsof` on the output socket

The workload's output is a Unix socket pair (`TYPE unix` in every `lsof` reading), as E11 said.

- **Controls 1, 2 and the node control.** The leaver inherited the socket. Once the group was
  empty, `lsof -U` named it holding both ends, and the socket stayed open until it exited, 26.8 s
  later. From control 2:

  ```
  sleep     68207 cjwilliams    1u  unix 0x787e76575afba3f6      0t0      ->0x528515ee0a853a22
  sleep     68207 cjwilliams    2u  unix 0xb6e92cc2977285ef      0t0      ->0xfa05b725ae0e4e0d
  ```

- **Every Claude run and cargo.** The harness's end of both sockets closed at the same millisecond
  the direct child exited: 14,449 ms in run 3, 9,484 ms in run 4 and 180,038 ms for cargo. No
  process held the socket, so there was nothing for `lsof` to name.
  - The survivors had put their output elsewhere. `lsof -p 77685`, taken by hand and unrecorded,
    showed fds 0, 1 and 2 on `/dev/null`.
  - Claude Code wrote the background task's output to a file under
    `/private/tmp/claude-501/-private-tmp-c335-claude-scratch/…/tasks/`, as its tool result said.

So `lsof` on the socket finds only a leaver that kept the output, and none of the real ones did.
The "output held open past the group" event of ruling 2, §3 point 4 would not have fired for any
Claude survivor.

### The parent walk

Every survivor had ppid 1 by the time it was sampled, or by the census. The zsh that started it
had exited. A walk from the direct child reaches none of them. Run 4's background zsh shows the
reparenting as it happens: ppids `5627, 1`.

### The working directory

Every survivor in runs 3 and 4 had the workload's directory as its working directory, and the
census found each one. That includes the two that `ps` tracking never saw, pid 58105 in run 3 and
pid 6371 in run 4. In run 2, the survivor's own `lsof -p 77685`, taken by hand and unrecorded,
showed `cwd /private/tmp/c335/claude-scratch`. From run 3, at the census:

```
{"pid":58105,"pgid":58081,"command":"/bin/sh -c for i in $(seq 1 120); do date +%s >> bg.log; sleep 1; done","tracked":false}
```

## Readings not taken

- **Exec tracing with `dtrace` or `eslogger`.** Both need root, and I have no root on this host.
  This is the reading that would close "what the method can miss".
- **The nine MCP servers that did not connect.** Connecting them needs the owner's OAuth, or a URL
  that the plugin does not declare.
- **Emend's workspace.** It does not exist yet.
- **A marker reading on cargo's children.** The mid-run reading fell at 60 s, while cargo was still
  fetching, so only `cargo` was in flight. `rustc` is not an Apple binary, but `clang`, `ld` and
  `xcrun` under `/Library/Developer/CommandLineTools` are. None of them left the group, so this
  bears on nothing.
- **A socket reading once the group was empty, in the Claude runs and cargo.** The socket had
  already closed, so there was nothing to read. In Claude run 1 the harness took the reading
  anyway. That was a harness defect: the fd number had been reused by `lsof`'s own pipe, and its
  "holder" is `lsof` itself. I discard that reading, and runs 3 and 4 skip it.
- **When control 1's `sleep` ended.** The harness exited first. `lsof` named it 5 s after the group
  was empty.
- **Claude run 2's census by working directory.** It was added from run 3. Run 2's survivor was
  read by hand instead: `ps -E`, the `sysctl` read, `lsof -p` and `lsof -a -d cwd`. Those readings
  are unrecorded; no harness record holds them. Only its end time is recorded, by that throwaway poller.
- **A run outside a Claude Code session.** The harness ran from my session's shell. So the
  workloads inherited `AI_AGENT`, and any Seatbelt profile that session applies. None is configured
  in `~/.claude/settings.json` or the repository's `.claude/settings.json`.

## Recommendation

**Change L0's census.** After the group kill, L0 lists every process of the user whose working
directory lies under the dispatch's worktree. It kills each one, confirms it dead, and records it
by name and command line, in the order that ruling 2, §5 sets for every kill path. It rests on
three pieces of evidence:

- Claude runs 2–4 left survivors outside the group, for 86–119 s past the group, under both the
  normal exit and a kill of the live group.
- Every one of them had the dispatch's directory as its working directory, and the census found
  each, including two that `ps` tracking missed (pid 58105 in run 3, pid 6371 in run 4).
- One census cost 125–242 ms, measured with `lsof` in runs 3 and 4.

**Do not add the environment marker as that mechanism.** On this host the marker could not be read
from any survivor the Claude CLI actually left, since all of them were Apple binaries (the marker
table). It could serve as a second check before a kill, for a process that is not an Apple binary.
That is a judgment, and I would leave it out until a survivor needs it.

**Do not rely on the held-open socket event to detect detachment.** No Claude survivor held the
socket (the `lsof` section). The event is still right for what it covers.

**The cargo build needs no second mechanism.** Nothing of cargo's was alive once the group was
empty, by either census, and none of the 1,571 processes `ps` saw left the group. Pid 74625, seen
only by the working-directory census, is unknown either way. That rests on the workload section
and is limited by the sampling limit above.

**What the next card must not assume:**

- It must not assume that a Claude dispatch's shell commands are in its group. None were.
- It must not assume that a normal exit cleans up. The `&` child survived runs 2 and 3.
- It must not assume that the working-directory census is safe on a shared directory. It would
  kill anything of the user's that sits in the worktree, including a person's own shell or editor
  helper. Rigger's worktrees live outside the checkout, which is what makes that rare. The next
  card's acceptance must state it and test it.

This changes no recorded decision that I found. `ARCHITECTURE.md` owns L0's census, so the change
is a delta for the architect to propose (`D18` rule 1), on an L0 card after M2, as ruling 1, §6 on
#332 foresaw.

## What would reverse the recommendation

- **A survivor whose working directory is outside the worktree.** For example, an agent's `cd /tmp
  && nohup … &`. The working-directory census cannot see it, so it would no longer be enough on
  its own. The reading that shows this is a dispatch whose survivor `lsof -a -d cwd` does not list
  under the worktree.
- **Claude Code keeping its Bash tool's shells in the session's group.** A sample in which the
  tool's zsh carries `claude`'s pgid would show this. Then the group kill reaches them, and only
  the `&`-with-`nohup` case would remain.
- **A kill of the live group that leaves nothing alive**, repeated on the same CLI version. That
  would contradict run 4.

## Outside this card's acceptance

These are for the coordinator. I have filed no card.

- **A headless dispatch inherits the owner's claude.ai connectors.** In every run, `claude.ai
  Gmail` and `claude.ai Shopify` connected. A maker dispatched with the user's configuration has
  them unless M4 passes `--strict-mcp-config` or its equivalent. That bears on M4.
- **Claude Code refuses a `sleep N … & …` command** with "Blocked: sleep 120 followed by: echo
  started" (run 1). A prompt that a fixture relies on can be refused by the tool itself.
- **The headless session writes background-task output outside the worktree**, under
  `/private/tmp/claude-501/`. A census or cleanup scoped to the worktree does not see those files.

## Appendix: processes observed, by run

Two methods saw processes, and each run has a table for each method it used.

- **`ps` tracking.** Every process that a `ps` sample counted as the workload's: in its group,
  or a child of a process already counted.
- **The working-directory census.** From Claude run 3 on, every process `lsof -a -d cwd` listed
  under the workload's directory. Each census entry is keyed by pid and start time. The start time
  comes from the latest `ps` sample, so an entry reads "not in the latest sample" when no sample
  held that pid. "`ps` tracked this pid" says whether `ps` tracking saw a process with that pid
  at any moment of the run.

Times are milliseconds from the spawn. "pgid" and "ppid" list every value seen, in order, so
`68191, 1` means the process was reparented to `launchd`. A command line longer than 200
characters is cut, and its full length is given. A zombie's command line cannot be read, so its
name is the one `ps` shows in parentheses.

### Claude run 1

Record `claude-2026-09-28T00-03-26-193Z`. Group 24363; the direct child exited at 17739 ms with code 0; the group was seen empty at 20104 ms.

`ps` tracking saw 20 processes:

| pid | name | pgid | ppid | seen (ms) | left group | alive after group empty (ms) | command line |
|---:|---|---|---|---|---|---:|---|
| 24363 | claude | 24363 | 24362 | 3–17695 | no |  | `claude -p This is a process-observation test in an empty scratch directory. Do exactly these three steps, in order, and nothing else.\\0121. Call the Bash tool with run_in_background set to true, runni … (688 chars)` |
| 24374 | (unknown) | 24363 | 24363 | 159–159 | no |  | `none: seen only as a zombie, with no name` |
| 24379 | npm | 24363 | 24363 | 263–17384 | no |  | `npm exec @modelcontextprotocol/server-filesystem@2026.8.31 /private/tmp/c335/claude-scratch` |
| 24381 | (unknown) | 24363 | 24363 | 263–263 | no |  | `none: seen only as a zombie, with no name` |
| 24533 | node | 24363 | 24379 | 3564–17332 | no |  | `node /Users/cjwilliams/.npm/_npx/68b53d3fd47bf8db/node_modules/.bin/mcp-server-filesystem /private/tmp/c335/claude-scratch` |
| 24622 | zsh | 24622 | 24363 | 6565–17384 | yes |  | `/bin/zsh -c source /Users/cjwilliams/.claude/shell-snapshots/snapshot-zsh-1790553812712-p8kqgs.sh 2>/dev/null \|\| true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null \|\| true && { \\builtin una … (395 chars)` |
| 24626 | sleep | 24622 | 24622 | 6565–7552 | yes |  | `sleep 1` |
| 24736 | sleep | 24622 | 24622 | 7605–8534 | yes |  | `sleep 1` |
| 26488 | sleep | 24622 | 24622 | 8586–9581 | yes |  | `sleep 1` |
| 28637 | sleep | 24622 | 24622 | 9632–10556 | yes |  | `sleep 1` |
| 31013 | sleep | 24622 | 24622 | 10612–11596 | yes |  | `sleep 1` |
| 32427 | sleep | 24622 | 24622 | 11646–12574 | yes |  | `sleep 1` |
| 33169 | date | 24622 | 24622 | 12626–12626 | yes |  | `none: seen only as a zombie, after it exited` |
| 33170 | sleep | 24622 | 24622 | 12677–13603 | yes |  | `sleep 1` |
| 33824 | sleep | 24622 | 24622 | 13655–14638 | yes |  | `sleep 1` |
| 34819 | sleep | 24622 | 24622 | 14690–15620 | yes |  | `sleep 1` |
| 35559 | sleep | 24622 | 24622 | 15672–16603 | yes |  | `sleep 1` |
| 36424 | date | 24622 | 24622 | 16655–16655 | yes |  | `none: seen only as a zombie, after it exited` |
| 36425 | sleep | 24622 | 24622 | 16707–17384 | yes |  | `sleep 1` |
| 36671 | ps | 24363 | 24363 | 17384–17384 | no |  | `none: seen only as a zombie, after it exited` |

The working-directory census did not run in this run.

### Claude run 2

Record `claude-2026-09-28T00-14-35-984Z`. Group 77186; the direct child exited at 14374 ms with code 0; the group was seen empty at 20100 ms.

`ps` tracking saw 19 processes:

| pid | name | pgid | ppid | seen (ms) | left group | alive after group empty (ms) | command line |
|---:|---|---|---|---|---|---:|---|
| 77186 | claude | 77186 | 77185 | 3–14325 | no |  | `claude -p This is a process-observation test in an empty scratch directory. Do exactly these three steps, in order, and nothing else.\\0121. Call the Bash tool with run_in_background set to true, runni … (757 chars)` |
| 77195 | git | 77186 | 77186 | 107–107 | no |  | `none: seen only as a zombie, after it exited` |
| 77197 | (unknown) | 77186 | 77186 | 159–159 | no |  | `none: seen only as a zombie, with no name` |
| 77201 | node | 77186 | 77186 | 211–14063 | no |  | `node /opt/homebrew/bin/npx -y @modelcontextprotocol/server-filesystem@2026.8.31 /private/tmp/c335/claude-scratch` |
| 77202 | 2.1.283 | 77186 | 77186 | 211–211 | no |  | `none: seen only as a zombie, after it exited` |
| 77232 | node | 77186 | 77201 | 731–14063 | no |  | `node /Users/cjwilliams/.npm/_npx/68b53d3fd47bf8db/node_modules/.bin/mcp-server-filesystem /private/tmp/c335/claude-scratch` |
| 77452 | zsh | 77452 | 77186 | 4360–14063 | yes |  | `/bin/zsh -c source /Users/cjwilliams/.claude/shell-snapshots/snapshot-zsh-1790554480304-gw1ryf.sh 2>/dev/null \|\| true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null \|\| true && { \\builtin una … (395 chars)` |
| 77456 | sleep | 77452 | 77452 | 4360–5345 | yes |  | `sleep 1` |
| 77564 | sleep | 77452 | 77452 | 5397–6333 | yes |  | `sleep 1` |
| 77677 | sleep | 77452 | 77452 | 6385–7374 | yes |  | `sleep 1` |
| 77708 | sleep | 77452 | 77452 | 7425–8356 | yes |  | `sleep 1` |
| 77721 | zsh | 77721 | 77186 | 7942–7942 | yes |  | `none: seen only as a zombie, after it exited` |
| 77724 | ls | 77721 | 77721 | 7942–7942 | yes |  | `none: seen only as a zombie, after it exited` |
| 77734 | sleep | 77452 | 77452 | 8408–9391 | yes |  | `sleep 1` |
| 77758 | sleep | 77452 | 77452 | 9443–10376 | yes |  | `sleep 1` |
| 77781 | sleep | 77452 | 77452 | 10427–11416 | yes |  | `sleep 1` |
| 77805 | sleep | 77452 | 77452 | 11468–12399 | yes |  | `sleep 1` |
| 77828 | sleep | 77452 | 77452 | 12451–13439 | yes |  | `sleep 1` |
| 77854 | sleep | 77452 | 77452 | 13491–14063 | yes |  | `sleep 1` |

The working-directory census did not run in this run.

### Claude run 3

Record `claude-2026-09-28T00-16-52-207Z`. Group 51296; the direct child exited at 14449 ms with code 0; the group was seen empty at 14651 ms.

`ps` tracking saw 20 processes:

| pid | name | pgid | ppid | seen (ms) | left group | alive after group empty (ms) | command line |
|---:|---|---|---|---|---|---:|---|
| 51296 | claude | 51296 | 51295 | 2–14441 | no |  | `claude -p This is a process-observation test in an empty scratch directory. Do exactly these three steps, in order, and nothing else.\\0121. Call the Bash tool with run_in_background set to true, runni … (757 chars)` |
| 51309 | (unknown) | 51296 | 51296 | 159–159 | no |  | `none: seen only as a zombie, with no name` |
| 51313 | node | 51296 | 51296 | 211–14182 | no |  | `node /opt/homebrew/bin/npx -y @modelcontextprotocol/server-filesystem@2026.8.31 /private/tmp/c335/claude-scratch` |
| 51314 | 2.1.283 | 51296 | 51296 | 211–211 | no |  | `none: seen only as a zombie, after it exited` |
| 51343 | node | 51296 | 51313 | 677–14182 | no |  | `node /Users/cjwilliams/.npm/_npx/68b53d3fd47bf8db/node_modules/.bin/mcp-server-filesystem /private/tmp/c335/claude-scratch` |
| 53747 | zsh | 51296 | 51296 | 4551–4551 | no |  | `none: seen only as a zombie, after it exited` |
| 53759 | zsh | 51296 | 51296 | 4551–4625 | no |  | `/bin/zsh -c -l SNAPSHOT_FILE=/Users/cjwilliams/.claude/shell-snapshots/snapshot-zsh-1790554616751-7c3n3j.sh\\012      source "/Users/cjwilliams/.zshrc" < /dev/null\\012\\012      # First, create/clear th … (7368 chars)` |
| 53875 | head | 51296 | 53759 | 4625–4625 | no |  | `none: seen only as a zombie, after it exited` |
| 53953 | zsh | 53953 | 51296 | 4716–14182 | yes |  | `/bin/zsh -c source /Users/cjwilliams/.claude/shell-snapshots/snapshot-zsh-1790554616751-7c3n3j.sh 2>/dev/null \|\| true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null \|\| true && { \\builtin una … (395 chars)` |
| 53981 | sleep | 53953 | 53953 | 4716–5659 | yes |  | `sleep 1` |
| 56147 | sleep | 53953 | 53953 | 5709–6687 | yes |  | `sleep 1` |
| 58206 | sleep | 53953 | 53953 | 6739–7717 | yes |  | `sleep 1` |
| 59695 | sleep | 53953 | 53953 | 7769–8700 | yes |  | `sleep 1` |
| 60450 | sleep | 53953 | 53953 | 8751–9733 | yes |  | `sleep 1` |
| 61313 | sleep | 53953 | 53953 | 9785–10716 | yes |  | `sleep 1` |
| 62204 | sleep | 53953 | 53953 | 10820–11751 | yes |  | `sleep 1` |
| 62906 | sleep | 53953 | 53953 | 11803–12783 | yes |  | `sleep 1` |
| 63504 | sleep | 53953 | 53953 | 12836–13769 | yes |  | `sleep 1` |
| 64121 | sleep | 53953 | 53953 | 13820–14182 | yes |  | `sleep 1` |
| 64229 | ps | 51296 | 51296 | 14182–14182 | no |  | `none: seen only as a zombie, after it exited` |

The working-directory census recorded 169 entries, of which 156 are pids `ps` tracking never saw:

| pid | name | pgid | seen (ms) | alive after group empty (ms) | `ps` tracked this pid | command line |
|---:|---|---|---|---:|---|---|
| 51296 | claude | 51296 | 3–13896 |  | yes | `claude -p This is a process-observation test in an empty scratch directory. Do exactly these three steps, in order, and nothing else.\\0121. Call the Bash tool with run_in_background set to true, runni … (757 chars)` |
| 51313 | npm | 51296 | 1137–13896 |  | yes | `npm exec @modelcontextprotocol/server-filesystem@2026.8.31 /private/tmp/c335/claude-scratch` |
| 51343 | node | 51296 | 1137–13896 |  | yes | `node /Users/cjwilliams/.npm/_npx/68b53d3fd47bf8db/node_modules/.bin/mcp-server-filesystem /private/tmp/c335/claude-scratch` |
| 53759 |  |  | 4568–4568 |  | yes | `none: not in the latest ps sample` |
| 53953 | zsh | 53953 | 5825–13896 |  | yes | `/bin/zsh -c source /Users/cjwilliams/.claude/shell-snapshots/snapshot-zsh-1790554616751-7c3n3j.sh 2>/dev/null \|\| true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null \|\| true && { \\builtin una … (395 chars)` |
| 56147 | sleep | 53953 | 5825–5825 |  | yes | `sleep 1` |
| 58105 | sh | 58081 | 7038–128453 | 113802 | **no** | `/bin/sh -c for i in $(seq 1 120); do date +%s >> bg.log; sleep 1; done` |
| 58143 | sleep | 58081 | 7038–7038 |  | **no** | `sleep 1` |
| 58206 | sleep | 53953 | 7038–7038 |  | yes | `sleep 1` |
| 59685 | sleep | 58081 | 8204–8204 |  | **no** | `sleep 1` |
| 59695 | sleep | 53953 | 8204–8204 |  | yes | `sleep 1` |
| 60433 | sleep | 58081 | 9106–9344 |  | **no** | `sleep 1` |
| 60450 | sleep | 53953 | 9106–9344 |  | yes | `sleep 1` |
| 61296 | sleep | 58081 | 10483–10483 |  | **no** | `sleep 1` |
| 61313 | sleep | 53953 | 10483–10483 |  | yes | `sleep 1` |
| 62158 | sleep | 58081 | 11621–11621 |  | **no** | `sleep 1` |
| 62204 | sleep | 53953 | 11621–11621 |  | yes | `sleep 1` |
| 62906 |  |  | 12757–12757 |  | yes | `none: not in the latest ps sample` |
| 63493 | sleep | 58081 | 12757–12757 |  | **no** | `sleep 1` |
| 64082 | sleep | 58081 | 13896–14651 |  | **no** | `sleep 1` |
| 64121 | sleep | 53953 | 13896–13896 |  | yes | `sleep 1` |
| 64556 | sleep | 58081 | 14819–15490 | 839 | **no** | `sleep 1` |
| 64556 |  |  | 15710–15710 | 1059 | **no** | `none: not in the latest ps sample` |
| 65111 | sleep | 58081 | 15932–16595 | 1944 | **no** | `sleep 1` |
| 65712 | sleep | 58081 | 16815–17693 | 3042 | **no** | `sleep 1` |
| 66179 | sleep | 58081 | 17907–18557 | 3906 | **no** | `sleep 1` |
| 66179 |  |  | 18776–18776 | 4125 | **no** | `none: not in the latest ps sample` |
| 66456 | sleep | 58081 | 18994–19642 | 4991 | **no** | `sleep 1` |
| 66924 | sleep | 58081 | 19862–20738 | 6087 | **no** | `sleep 1` |
| 67006 | sleep | 58081 | 20930–21651 | 7000 | **no** | `sleep 1` |
| 67771 | sleep | 58081 | 21871–22494 | 7843 | **no** | `sleep 1` |
| 67771 |  |  | 22826–22826 | 8175 | **no** | `none: not in the latest ps sample` |
| 70167 | sleep | 58081 | 23075–23920 | 9269 | **no** | `sleep 1` |
| 72765 | sleep | 58081 | 24193–24980 | 10329 | **no** | `sleep 1` |
| 74415 | sleep | 58081 | 25237–25956 | 11305 | **no** | `sleep 1` |
| 75480 | sleep | 58081 | 26180–27079 | 12428 | **no** | `sleep 1` |
| 76189 | sleep | 58081 | 27303–27966 | 13315 | **no** | `sleep 1` |
| 77182 | sleep | 58081 | 28189–29018 | 14367 | **no** | `sleep 1` |
| 77182 |  |  | 29098–29098 | 14447 | **no** | `none: not in the latest ps sample` |
| 78051 | sleep | 58081 | 29331–30018 | 15367 | **no** | `sleep 1` |
| 78051 |  |  | 30166–30166 | 15515 | **no** | `none: not in the latest ps sample` |
| 78845 | sleep | 58081 | 30238–31124 | 16473 | **no** | `sleep 1` |
| 79506 | sleep | 58081 | 31311–32004 | 17353 | **no** | `sleep 1` |
| 80020 | sleep | 58081 | 32450–33153 | 18502 | **no** | `sleep 1` |
| 80574 | sleep | 58081 | 33374–34050 | 19399 | **no** | `sleep 1` |
| 81087 | sleep | 58081 | 34270–35162 | 20511 | **no** | `sleep 1` |
| 81636 | sleep | 58081 | 35381–35912 | 21261 | **no** | `sleep 1` |
| 81636 |  |  | 36209–36209 | 21558 | **no** | `none: not in the latest ps sample` |
| 82579 | sleep | 58081 | 36548–37010 | 22359 | **no** | `sleep 1` |
| 84317 | sleep | 58081 | 37510–38191 | 23540 | **no** | `sleep 1` |
| 82579 |  |  | 37201–37201 | 22550 | **no** | `none: not in the latest ps sample` |
| 86148 | sleep | 58081 | 38511–38921 | 24270 | **no** | `sleep 1` |
| 87951 | sleep | 58081 | 39728–40142 | 25491 | **no** | `sleep 1` |
| 87951 |  |  | 40347–40347 | 25696 | **no** | `none: not in the latest ps sample` |
| 89962 | sleep | 58081 | 40649–41326 | 26675 | **no** | `sleep 1` |
| 89962 |  |  | 41421–41421 | 26770 | **no** | `none: not in the latest ps sample` |
| 91082 | sleep | 58081 | 41663–42335 | 27684 | **no** | `sleep 1` |
| 91082 |  |  | 42488–42488 | 27837 | **no** | `none: not in the latest ps sample` |
| 91807 | sleep | 58081 | 42559–43227 | 28576 | **no** | `sleep 1` |
| 91807 |  |  | 43450–43450 | 28799 | **no** | `none: not in the latest ps sample` |
| 92523 | sleep | 58081 | 43626–44345 | 29694 | **no** | `sleep 1` |
| 93399 | sleep | 58081 | 44566–45457 | 30806 | **no** | `sleep 1` |
| 94187 | sleep | 58081 | 45679–46342 | 31691 | **no** | `sleep 1` |
| 94885 | sleep | 58081 | 46562–47456 | 32805 | **no** | `sleep 1` |
| 95374 | sleep | 58081 | 47676–48335 | 33684 | **no** | `sleep 1` |
| 95374 |  |  | 48559–48559 | 33908 | **no** | `none: not in the latest ps sample` |
| 95919 | sleep | 58081 | 48778–49438 | 34787 | **no** | `sleep 1` |
| 96425 | sleep | 58081 | 49658–50468 | 35817 | **no** | `sleep 1` |
| 96425 |  |  | 50539–50539 | 35888 | **no** | `none: not in the latest ps sample` |
| 96982 | sleep | 58081 | 50764–51423 | 36772 | **no** | `sleep 1` |
| 97588 |  |  | 51607–51607 | 36956 | **no** | `none: not in the latest ps sample` |
| 97600 | sleep | 58081 | 51642–52521 | 37870 | **no** | `sleep 1` |
| 97969 | sleep | 58081 | 52733–53385 | 38734 | **no** | `sleep 1` |
| 97969 |  |  | 53601–53601 | 38950 | **no** | `none: not in the latest ps sample` |
| 98279 | sleep | 58081 | 53817–54461 | 39810 | **no** | `sleep 1` |
| 98566 | sleep | 58081 | 54675–55521 | 40870 | **no** | `sleep 1` |
| 98651 | sleep | 58081 | 55730–56565 | 41914 | **no** | `sleep 1` |
| 98695 | sleep | 58081 | 56772–57610 | 42959 | **no** | `sleep 1` |
| 98733 | sleep | 58081 | 57817–58439 | 43788 | **no** | `sleep 1` |
| 98733 |  |  | 58647–58647 | 43996 | **no** | `none: not in the latest ps sample` |
| 98773 | sleep | 58081 | 58854–59551 | 44900 | **no** | `sleep 1` |
| 98812 | sleep | 58081 | 59711–60544 | 45893 | **no** | `sleep 1` |
| 98812 |  |  | 60681–60681 | 46030 | **no** | `none: not in the latest ps sample` |
| 98856 | sleep | 58081 | 60752–61577 | 46926 | **no** | `sleep 1` |
| 98892 | sleep | 58081 | 61784–62609 | 47958 | **no** | `sleep 1` |
| 98930 | sleep | 58081 | 62816–63645 | 48994 | **no** | `sleep 1` |
| 98981 | sleep | 58081 | 63852–64640 | 49989 | **no** | `sleep 1` |
| 99850 | sleep | 58081 | 64917–65293 | 50642 | **no** | `sleep 1` |
| 99850 |  |  | 65664–65664 | 51013 | **no** | `none: not in the latest ps sample` |
| 2433 | sleep | 58081 | 65979–66514 | 51863 | **no** | `sleep 1` |
| 2433 |  |  | 66679–66785 | 52134 | **no** | `none: not in the latest ps sample` |
| 4402 | sleep | 58081 | 67066–67635 | 52984 | **no** | `sleep 1` |
| 6674 | sleep | 58081 | 67901–68648 | 53997 | **no** | `sleep 1` |
| 7669 | sleep | 58081 | 68871–69770 | 55119 | **no** | `sleep 1` |
| 8447 | sleep | 58081 | 69992–70664 | 56013 | **no** | `sleep 1` |
| 9332 | sleep | 58081 | 70888–71779 | 57128 | **no** | `sleep 1` |
| 10122 | sleep | 58081 | 72001–72661 | 58010 | **no** | `sleep 1` |
| 11000 | sleep | 58081 | 73099–73755 | 59104 | **no** | `sleep 1` |
| 11649 | sleep | 58081 | 73975–74784 | 60133 | **no** | `sleep 1` |
| 11649 |  |  | 74853–74853 | 60202 | **no** | `none: not in the latest ps sample` |
| 12145 | sleep | 58081 | 75077–75743 | 61092 | **no** | `sleep 1` |
| 12633 | sleep | 58081 | 75926–76621 | 61970 | **no** | `sleep 1` |
| 12633 |  |  | 76844–76844 | 62193 | **no** | `none: not in the latest ps sample` |
| 13132 | sleep | 58081 | 77064–77758 | 63107 | **no** | `sleep 1` |
| 13767 | sleep | 58081 | 77976–78849 | 64198 | **no** | `sleep 1` |
| 14312 | sleep | 58081 | 79065–79713 | 65062 | **no** | `sleep 1` |
| 14312 |  |  | 79928–79928 | 65277 | **no** | `none: not in the latest ps sample` |
| 14582 | sleep | 58081 | 80144–80796 | 66145 | **no** | `sleep 1` |
| 14937 | sleep | 58081 | 81010–81877 | 67226 | **no** | `sleep 1` |
| 15200 | sleep | 58081 | 82083–82913 | 68262 | **no** | `sleep 1` |
| 15260 | sleep | 58081 | 83121–83735 | 69084 | **no** | `sleep 1` |
| 15260 |  |  | 83925–83945 | 69294 | **no** | `none: not in the latest ps sample` |
| 15298 | sleep | 58081 | 84156–84773 | 70122 | **no** | `sleep 1` |
| 15298 |  |  | 84979–84979 | 70328 | **no** | `none: not in the latest ps sample` |
| 15335 | sleep | 58081 | 85056–85814 | 71163 | **no** | `sleep 1` |
| 15373 | sleep | 58081 | 86189–86848 | 72197 | **no** | `sleep 1` |
| 15410 | sleep | 58081 | 87055–87886 | 73235 | **no** | `sleep 1` |
| 15455 | sleep | 58081 | 88090–88931 | 74280 | **no** | `sleep 1` |
| 15502 | sleep | 58081 | 89140–89977 | 75326 | **no** | `sleep 1` |
| 15542 | sleep | 58081 | 90189–90824 | 76173 | **no** | `sleep 1` |
| 15675 | sleep | 58081 | 91356–91901 | 77250 | **no** | `sleep 1` |
| 17156 | sleep | 58081 | 92165–93034 | 78383 | **no** | `sleep 1` |
| 19233 | sleep | 58081 | 93269–93839 | 79188 | **no** | `sleep 1` |
| 19233 |  |  | 94110–94110 | 79459 | **no** | `none: not in the latest ps sample` |
| 21352 | sleep | 58081 | 94218–95000 | 80349 | **no** | `sleep 1` |
| 23874 | sleep | 58081 | 95276–96055 | 81404 | **no** | `sleep 1` |
| 25485 | sleep | 58081 | 96292–96986 | 82335 | **no** | `sleep 1` |
| 26469 | sleep | 58081 | 97212–97889 | 83238 | **no** | `sleep 1` |
| 26469 |  |  | 98115–98115 | 83464 | **no** | `none: not in the latest ps sample` |
| 27360 | sleep | 58081 | 98345–99017 | 84366 | **no** | `sleep 1` |
| 28437 | sleep | 58081 | 99241–100152 | 85501 | **no** | `sleep 1` |
| 29341 | sleep | 58081 | 100381–101049 | 86398 | **no** | `sleep 1` |
| 29341 |  |  | 101192–101192 | 86541 | **no** | `none: not in the latest ps sample` |
| 30140 | sleep | 58081 | 101271–102158 | 87507 | **no** | `sleep 1` |
| 30822 | sleep | 58081 | 102333–103046 | 88395 | **no** | `sleep 1` |
| 31501 | sleep | 58081 | 103267–104156 | 89505 | **no** | `sleep 1` |
| 32020 | sleep | 58081 | 104382–105048 | 90397 | **no** | `sleep 1` |
| 32587 | sleep | 58081 | 105492–106155 | 91504 | **no** | `sleep 1` |
| 33272 | sleep | 58081 | 106373–107038 | 92387 | **no** | `sleep 1` |
| 33272 |  |  | 107255–107255 | 92604 | **no** | `none: not in the latest ps sample` |
| 33865 | sleep | 58081 | 107472–108129 | 93478 | **no** | `sleep 1` |
| 34179 | sleep | 58081 | 108353–109179 | 94528 | **no** | `sleep 1` |
| 34179 |  |  | 109257–109257 | 94606 | **no** | `none: not in the latest ps sample` |
| 34655 | sleep | 58081 | 109486–110127 | 95476 | **no** | `sleep 1` |
| 34655 |  |  | 110316–110316 | 95665 | **no** | `none: not in the latest ps sample` |
| 34850 | sleep | 58081 | 110337–111165 | 96514 | **no** | `sleep 1` |
| 34900 | sleep | 58081 | 111375–112216 | 97565 | **no** | `sleep 1` |
| 34938 | sleep | 58081 | 112428–113267 | 98616 | **no** | `sleep 1` |
| 34976 | sleep | 58081 | 113475–114101 | 99450 | **no** | `sleep 1` |
| 34976 |  |  | 114311–114311 | 99660 | **no** | `none: not in the latest ps sample` |
| 35018 | sleep | 58081 | 114521–115159 | 100508 | **no** | `sleep 1` |
| 35018 |  |  | 115369–115369 | 100718 | **no** | `none: not in the latest ps sample` |
| 35057 | sleep | 58081 | 115573–116206 | 101555 | **no** | `sleep 1` |
| 35093 | sleep | 58081 | 116415–117251 | 102600 | **no** | `sleep 1` |
| 35131 | sleep | 58081 | 117458–118288 | 103637 | **no** | `sleep 1` |
| 35169 | sleep | 58081 | 118502–119343 | 104692 | **no** | `sleep 1` |
| 35169 |  |  | 119371–119371 | 104720 | **no** | `none: not in the latest ps sample` |
| 35215 | sleep | 58081 | 119551–120179 | 105528 | **no** | `sleep 1` |
| 35215 |  |  | 120383–120383 | 105732 | **no** | `none: not in the latest ps sample` |
| 35254 | sleep | 58081 | 120504–121215 | 106564 | **no** | `sleep 1` |
| 35254 |  |  | 121420–121420 | 106769 | **no** | `none: not in the latest ps sample` |
| 35293 | sleep | 58081 | 121632–122299 | 107648 | **no** | `sleep 1` |
| 35330 | sleep | 58081 | 122507–123340 | 108689 | **no** | `sleep 1` |
| 35367 | sleep | 58081 | 123546–124379 | 109728 | **no** | `sleep 1` |
| 35406 | sleep | 58081 | 124585–125421 | 110770 | **no** | `sleep 1` |
| 35446 | sleep | 58081 | 125628–126457 | 111806 | **no** | `sleep 1` |
| 35485 | sleep | 58081 | 126662–127323 | 112672 | **no** | `sleep 1` |
| 35485 |  |  | 127494–127494 | 112843 | **no** | `none: not in the latest ps sample` |
| 35523 | sleep | 58081 | 127700–128453 | 113802 | **no** | `sleep 1` |

### Claude run 4 (group killed at 9.5 s)

Record `claude-2026-09-28T00-24-20-844Z`. Group 5627; the direct child exited at 9483 ms by SIGKILL; the group was seen empty at 9857 ms.

`ps` tracking saw 108 processes:

| pid | name | pgid | ppid | seen (ms) | left group | alive after group empty (ms) | command line |
|---:|---|---|---|---|---|---:|---|
| 5627 | claude | 5627 | 5542 | 2–9440 | no |  | `claude -p This is a process-observation test in an empty scratch directory. Do exactly these three steps, in order, and nothing else.\\0121. Call the Bash tool with run_in_background set to true, runni … (757 chars)` |
| 5691 | git | 5627 | 5627 | 156–156 | no |  | `none: seen only as a zombie, after it exited` |
| 5700 | npm | 5627 | 5627 | 260–9440 | no |  | `npm exec @modelcontextprotocol/server-filesystem@2026.8.31 /private/tmp/c335/claude-scratch` |
| 5701 | (unknown) | 5627 | 5627 | 260–260 | no |  | `none: seen only as a zombie, with no name` |
| 5848 | node | 5627 | 5700 | 727–9440 | no |  | `node /Users/cjwilliams/.npm/_npx/68b53d3fd47bf8db/node_modules/.bin/mcp-server-filesystem /private/tmp/c335/claude-scratch` |
| 6045 | zsh | 5627 | 5627 | 5183–5183 | no |  | `none: seen only as a zombie, after it exited` |
| 6056 | cat | 5627 | 6045 | 5183–5183 | no |  | `none: seen only as a zombie, after it exited` |
| 6061 | zsh | 6061 | 5627, 1 | 5235–96138 | yes | 86281 | `/bin/zsh -c source /Users/cjwilliams/.claude/shell-snapshots/snapshot-zsh-1790555066011-buhsa6.sh 2>/dev/null \|\| true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null \|\| true && { \\builtin una … (395 chars)` |
| 6065 | sleep | 6061 | 6061 | 5235–6171 | yes |  | `sleep 1` |
| 6088 | sleep | 6061 | 6061 | 6223–7208 | yes |  | `sleep 1` |
| 6158 | sleep | 6061 | 6061 | 7260–8191 | yes |  | `sleep 1` |
| 6364 | zsh | 6364 | 5627 | 7413–7413 | yes |  | `none: seen only as a zombie, after it exited` |
| 7528 | sleep | 6061 | 6061 | 8244–9180 | yes |  | `sleep 1` |
| 9380 | date | 6061 | 6061 | 9231–9231 | yes |  | `none: seen only as a zombie, after it exited` |
| 9401 | sleep | 6061 | 6061 | 9281–10213 | yes | 356 | `sleep 1` |
| 12363 | sleep | 6061 | 6061 | 10265–11214 | yes | 1357 | `sleep 1` |
| 14489 | sleep | 6061 | 6061 | 11266–12243 | yes | 2386 | `sleep 1` |
| 16297 | sleep | 6061 | 6061 | 12295–13275 | yes | 3418 | `sleep 1` |
| 17189 | sleep | 6061 | 6061 | 13325–14253 | yes | 4396 | `sleep 1` |
| 18241 | sleep | 6061 | 6061 | 14305–15284 | yes | 5427 | `sleep 1` |
| 19198 | sleep | 6061 | 6061 | 15335–16263 | yes | 6406 | `sleep 1` |
| 20080 | sleep | 6061 | 6061 | 16367–17292 | yes | 7435 | `sleep 1` |
| 20921 | sleep | 6061 | 6061 | 17334–18325 | yes | 8468 | `sleep 1` |
| 21486 | sleep | 6061 | 6061 | 18377–19333 | yes | 9476 | `sleep 1` |
| 22150 | sleep | 6061 | 6061 | 19349–20329 | yes | 10472 | `sleep 1` |
| 22685 | sleep | 6061 | 6061 | 20380–21351 | yes | 11494 | `sleep 1` |
| 23434 | sleep | 6061 | 6061 | 21368–22351 | yes | 12494 | `sleep 1` |
| 24042 | sleep | 6061 | 6061 | 22403–23330 | yes | 13473 | `sleep 1` |
| 24500 | sleep | 6061 | 6061 | 23382–24360 | yes | 14503 | `sleep 1` |
| 24903 | sleep | 6061 | 6061 | 24412–25344 | yes | 15487 | `sleep 1` |
| 25325 | date | 6061 | 6061 | 25395–25395 | yes | 15538 | `none: seen only as a zombie, after it exited` |
| 25327 | sleep | 6061 | 6061 | 25447–26380 | yes | 16523 | `sleep 1` |
| 25373 | sleep | 6061 | 6061 | 26433–27381 | yes | 17524 | `sleep 1` |
| 25416 | sleep | 6061 | 6061 | 27422–28359 | yes | 18502 | `sleep 1` |
| 25692 | sleep | 6061 | 6061 | 28426–29405 | yes | 19548 | `sleep 1` |
| 26594 | date | 6061 | 6061 | 29448–29448 | yes | 19591 | `none: seen only as a zombie, after it exited` |
| 26596 | sleep | 6061 | 6061 | 29500–30419 | yes | 20562 | `sleep 1` |
| 26638 | sleep | 6061 | 6061 | 30471–31443 | yes | 21586 | `sleep 1` |
| 26680 | sleep | 6061 | 6061 | 31493–32463 | yes | 22606 | `sleep 1` |
| 26721 | sleep | 6061 | 6061 | 32513–33482 | yes | 23625 | `sleep 1` |
| 26770 | sleep | 6061 | 6061 | 33532–34494 | yes | 24637 | `sleep 1` |
| 26819 | sleep | 6061 | 6061 | 34546–35471 | yes | 25614 | `sleep 1` |
| 27315 | sleep | 6061 | 6061 | 35522–36496 | yes | 26639 | `sleep 1` |
| 27359 | sleep | 6061 | 6061 | 36548–37518 | yes | 27661 | `sleep 1` |
| 27398 | sleep | 6061 | 6061 | 37568–38490 | yes | 28633 | `sleep 1` |
| 27437 | sleep | 6061 | 6061 | 38543–39512 | yes | 29655 | `sleep 1` |
| 27478 | sleep | 6061 | 6061 | 39564–40536 | yes | 30679 | `sleep 1` |
| 27519 | sleep | 6061 | 6061 | 40586–41521 | yes | 31664 | `sleep 1` |
| 28207 | date | 6061 | 6061 | 41573–41573 | yes | 31716 | `none: seen only as a zombie, after it exited` |
| 28217 | sleep | 6061 | 6061 | 41632–42556 | yes | 32699 | `sleep 1` |
| 28325 | sleep | 6061 | 6061 | 42606–43587 | yes | 33730 | `sleep 1` |
| 28369 | sleep | 6061 | 6061 | 43639–44603 | yes | 34746 | `sleep 1` |
| 28407 | sleep | 6061 | 6061 | 44614–45585 | yes | 35728 | `sleep 1` |
| 28447 | sleep | 6061 | 6061 | 45636–46609 | yes | 36752 | `sleep 1` |
| 28488 | sleep | 6061 | 6061 | 46658–47620 | yes | 37763 | `sleep 1` |
| 28537 | date | 6061 | 6061 | 47635–47635 | yes | 37778 | `none: seen only as a zombie, after it exited` |
| 28538 | sleep | 6061 | 6061 | 47687–48617 | yes | 38760 | `sleep 1` |
| 28577 | sleep | 6061 | 6061 | 48669–49645 | yes | 39788 | `sleep 1` |
| 28618 | sleep | 6061 | 6061 | 49696–50637 | yes | 40780 | `sleep 1` |
| 28671 | sleep | 6061 | 6061 | 50677–51660 | yes | 41803 | `sleep 1` |
| 28793 | sleep | 6061 | 6061 | 51705–52644 | yes | 42787 | `sleep 1` |
| 28831 | sleep | 6061 | 6061 | 52696–53682 | yes | 43825 | `sleep 1` |
| 28872 | sleep | 6061 | 6061 | 53733–54677 | yes | 44820 | `sleep 1` |
| 28911 | sleep | 6061 | 6061 | 54727–55659 | yes | 45802 | `sleep 1` |
| 28951 | date | 6061 | 6061 | 55711–55711 | yes | 45854 | `none: seen only as a zombie, after it exited` |
| 28952 | sleep | 6061 | 6061 | 55763–56694 | yes | 46837 | `sleep 1` |
| 28997 | sleep | 6061 | 6061 | 56746–57726 | yes | 47869 | `sleep 1` |
| 29035 | sleep | 6061 | 6061 | 57757–58708 | yes | 48851 | `sleep 1` |
| 29075 | sleep | 6061 | 6061 | 58760–59741 | yes | 49884 | `sleep 1` |
| 29116 | sleep | 6061 | 6061 | 59793–60740 | yes | 50883 | `sleep 1` |
| 29157 | sleep | 6061 | 6061 | 60781–61755 | yes | 51898 | `sleep 1` |
| 29197 | sleep | 6061 | 6061 | 61807–62786 | yes | 52929 | `sleep 1` |
| 29240 | sleep | 6061 | 6061 | 62838–63783 | yes | 53926 | `sleep 1` |
| 30104 | sleep | 6061 | 6061 | 63834–64815 | yes | 54958 | `sleep 1` |
| 31278 | sleep | 6061 | 6061 | 64825–65823 | yes | 55966 | `sleep 1` |
| 32505 | sleep | 6061 | 6061 | 65879–66810 | yes | 56953 | `sleep 1` |
| 33809 | sleep | 6061 | 6061 | 66860–67829 | yes | 57972 | `sleep 1` |
| 34344 | sleep | 6061 | 6061 | 67880–68856 | yes | 58999 | `sleep 1` |
| 34387 | sleep | 6061 | 6061 | 68908–69832 | yes | 59975 | `sleep 1` |
| 34425 | zsh | 6061 | 6061 | 69883–69882 | yes | 60025 | `none: seen only as a zombie, after it exited` |
| 34426 | sleep | 6061 | 6061 | 69933–70853 | yes | 60996 | `sleep 1` |
| 34474 | sleep | 6061 | 6061 | 70904–71874 | yes | 62017 | `sleep 1` |
| 34519 | sleep | 6061 | 6061 | 71924–72898 | yes | 63041 | `sleep 1` |
| 34567 | sleep | 6061 | 6061 | 72948–73873 | yes | 64016 | `sleep 1` |
| 34972 | sleep | 6061 | 6061 | 73923–74894 | yes | 65037 | `sleep 1` |
| 35018 | sleep | 6061 | 6061 | 74944–75921 | yes | 66064 | `sleep 1` |
| 35062 | sleep | 6061 | 6061 | 75971–76951 | yes | 67094 | `sleep 1` |
| 35101 | sleep | 6061 | 6061 | 76992–77960 | yes | 68103 | `sleep 1` |
| 35142 | sleep | 6061 | 6061 | 78010–78926 | yes | 69069 | `sleep 1` |
| 35185 | date | 6061 | 6061 | 78978–78978 | yes | 69121 | `none: seen only as a zombie, after it exited` |
| 35186 | sleep | 6061 | 6061 | 79027–79962 | yes | 70105 | `sleep 1` |
| 35600 | sleep | 6061 | 6061 | 80013–80993 | yes | 71136 | `sleep 1` |
| 35641 | sleep | 6061 | 6061 | 81045–81981 | yes | 72124 | `sleep 1` |
| 35686 | sleep | 6061 | 6061 | 82015–82987 | yes | 73130 | `sleep 1` |
| 35733 | sleep | 6061 | 6061 | 83040–84012 | yes | 74155 | `sleep 1` |
| 35772 | sleep | 6061 | 6061 | 84064–84984 | yes | 75127 | `sleep 1` |
| 35815 | sleep | 6061 | 6061 | 85034–86001 | yes | 76144 | `sleep 1` |
| 36574 | sleep | 6061 | 6061 | 86052–87017 | yes | 77160 | `sleep 1` |
| 36614 | sleep | 6061 | 6061 | 87068–88039 | yes | 78182 | `sleep 1` |
| 36654 | sleep | 6061 | 6061 | 88089–89059 | yes | 79202 | `sleep 1` |
| 36710 | sleep | 6061 | 6061 | 89110–90035 | yes | 80178 | `sleep 1` |
| 36750 | sleep | 6061 | 6061 | 90085–91065 | yes | 81208 | `sleep 1` |
| 36789 | sleep | 6061 | 6061 | 91103–92034 | yes | 82177 | `sleep 1` |
| 37205 | date | 6061 | 6061 | 92085–92085 | yes | 82228 | `none: seen only as a zombie, after it exited` |
| 37206 | sleep | 6061 | 6061 | 92135–93056 | yes | 83199 | `sleep 1` |
| 37244 | sleep | 6061 | 6061 | 93108–94088 | yes | 84231 | `sleep 1` |
| 37284 | sleep | 6061 | 6061 | 94140–95112 | yes | 85255 | `sleep 1` |
| 37329 | sleep | 6061 | 6061 | 95164–96138 | yes | 86281 | `sleep 1` |

The working-directory census recorded 287 entries, of which 161 are pids `ps` tracking never saw:

| pid | name | pgid | seen (ms) | alive after group empty (ms) | `ps` tracked this pid | command line |
|---:|---|---|---|---:|---|---|
| 5627 | claude | 5627 | 3–9182 |  | yes | `claude -p This is a process-observation test in an empty scratch directory. Do exactly these three steps, in order, and nothing else.\\0121. Call the Bash tool with run_in_background set to true, runni … (757 chars)` |
| 5700 | npm | 5627 | 1142–9182 |  | yes | `npm exec @modelcontextprotocol/server-filesystem@2026.8.31 /private/tmp/c335/claude-scratch` |
| 5848 | node | 5627 | 1142–9182 |  | yes | `node /Users/cjwilliams/.npm/_npx/68b53d3fd47bf8db/node_modules/.bin/mcp-server-filesystem /private/tmp/c335/claude-scratch` |
| 6061 | zsh | 6061 | 5666–95880 | 86023 | yes | `/bin/zsh -c source /Users/cjwilliams/.claude/shell-snapshots/snapshot-zsh-1790555066011-buhsa6.sh 2>/dev/null \|\| true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null \|\| true && { \\builtin una … (395 chars)` |
| 6065 | sleep | 6061 | 5666–5666 |  | yes | `sleep 1` |
| 6088 | sleep | 6061 | 6795–6795 |  | yes | `sleep 1` |
| 6158 | sleep | 6061 | 7925–7925 |  | yes | `sleep 1` |
| 6371 | sh | 6364 | 7925–128676 | 118819 | **no** | `/bin/sh -c for i in $(seq 1 120); do date +%s >> bg.log; sleep 1; done` |
| 6460 | sleep | 6364 | 7925–7925 |  | **no** | `sleep 1` |
| 7528 |  |  | 9105–9182 |  | yes | `none: not in the latest ps sample` |
| 8065 | sleep | 6364 | 9105–9182 |  | **no** | `sleep 1` |
| 9401 | sleep | 6061 | 9606–9927 | 70 | yes | `sleep 1` |
| 10033 | sleep | 6364 | 9606–10318 | 461 | **no** | `sleep 1` |
| 9401 |  |  | 10132–10132 | 275 | yes | `none: not in the latest ps sample` |
| 12363 | sleep | 6061 | 10318–10976 | 1119 | yes | `sleep 1` |
| 10033 |  |  | 10408–10408 | 551 | **no** | `none: not in the latest ps sample` |
| 13144 | sleep | 6364 | 10702–11236 | 1379 | **no** | `sleep 1` |
| 12363 |  |  | 11236–11236 | 1379 | yes | `none: not in the latest ps sample` |
| 13144 |  |  | 11491–11491 | 1634 | **no** | `none: not in the latest ps sample` |
| 14489 | sleep | 6061 | 11491–11995 | 2138 | yes | `sleep 1` |
| 15020 | sleep | 6364 | 11757–12456 | 2599 | **no** | `sleep 1` |
| 14489 |  |  | 12227–12227 | 2370 | yes | `none: not in the latest ps sample` |
| 16297 | sleep | 6061 | 12456–13134 | 3277 | yes | `sleep 1` |
| 16600 | sleep | 6364 | 12683–13360 | 3503 | **no** | `sleep 1` |
| 17189 | sleep | 6061 | 13360–14033 | 4176 | yes | `sleep 1` |
| 17423 | sleep | 6364 | 13582–14481 | 4624 | **no** | `sleep 1` |
| 17189 |  |  | 14258–14258 | 4401 | yes | `none: not in the latest ps sample` |
| 18241 | sleep | 6061 | 14481–15149 | 5292 | yes | `sleep 1` |
| 18502 | sleep | 6364 | 14702–15371 | 5514 | **no** | `sleep 1` |
| 19198 | sleep | 6061 | 15371–16126 | 6269 | yes | `sleep 1` |
| 19559 | sleep | 6364 | 15814–16485 | 6628 | **no** | `sleep 1` |
| 19198 |  |  | 16265–16265 | 6408 | yes | `none: not in the latest ps sample` |
| 20080 | sleep | 6061 | 16485–17146 | 7289 | yes | `sleep 1` |
| 20366 | sleep | 6364 | 16706–17367 | 7510 | **no** | `sleep 1` |
| 20080 |  |  | 17267–17267 | 7410 | yes | `none: not in the latest ps sample` |
| 20921 | sleep | 6061 | 17367–18256 | 8399 | yes | `sleep 1` |
| 20366 |  |  | 17590–17590 | 7733 | **no** | `none: not in the latest ps sample` |
| 21094 | sleep | 6364 | 17811–18480 | 8623 | **no** | `sleep 1` |
| 21486 | sleep | 6061 | 18406–19146 | 9289 | yes | `sleep 1` |
| 21802 | sleep | 6364 | 18702–19547 | 9690 | **no** | `sleep 1` |
| 22150 | sleep | 6061 | 19364–20241 | 10384 | yes | `sleep 1` |
| 21802 |  |  | 19583–19583 | 9726 | **no** | `none: not in the latest ps sample` |
| 22345 | sleep | 6364 | 19806–20465 | 10608 | **no** | `sleep 1` |
| 22685 | sleep | 6061 | 20465–21163 | 11306 | yes | `sleep 1` |
| 22956 | sleep | 6364 | 20686–21384 | 11527 | **no** | `sleep 1` |
| 23434 | sleep | 6061 | 21384–22270 | 12413 | yes | `sleep 1` |
| 22956 |  |  | 21610–21610 | 11753 | **no** | `none: not in the latest ps sample` |
| 23707 | sleep | 6364 | 21828–22488 | 12631 | **no** | `sleep 1` |
| 24042 | sleep | 6061 | 22488–23144 | 13287 | yes | `sleep 1` |
| 24264 | sleep | 6364 | 22707–23582 | 13725 | **no** | `sleep 1` |
| 24500 | sleep | 6061 | 23365–24241 | 14384 | yes | `sleep 1` |
| 24611 | sleep | 6364 | 23799–24458 | 14601 | **no** | `sleep 1` |
| 24903 | sleep | 6061 | 24458–25278 | 15421 | yes | `sleep 1` |
| 24611 |  |  | 24675–24675 | 14818 | **no** | `none: not in the latest ps sample` |
| 25109 | sleep | 6364 | 24889–25530 | 15673 | **no** | `sleep 1` |
| 24903 |  |  | 25319–25319 | 15462 | yes | `none: not in the latest ps sample` |
| 25327 | sleep | 6061 | 25530–26155 | 16298 | yes | `sleep 1` |
| 25347 | sleep | 6364 | 25738–26570 | 16713 | **no** | `sleep 1` |
| 25327 |  |  | 26361–26361 | 16504 | yes | `none: not in the latest ps sample` |
| 25373 | sleep | 6061 | 26414–27200 | 17343 | yes | `sleep 1` |
| 25386 | sleep | 6364 | 26781–27619 | 17762 | **no** | `sleep 1` |
| 25416 | sleep | 6061 | 27545–28246 | 18389 | yes | `sleep 1` |
| 25429 | sleep | 6364 | 27829–28535 | 18678 | **no** | `sleep 1` |
| 25692 | sleep | 6061 | 28535–29223 | 19366 | yes | `sleep 1` |
| 25429 |  |  | 28677–28677 | 18820 | **no** | `none: not in the latest ps sample` |
| 26075 | sleep | 6364 | 28897–29659 | 19802 | **no** | `sleep 1` |
| 26596 | sleep | 6061 | 29659–30364 | 20507 | yes | `sleep 1` |
| 26607 | sleep | 6364 | 29887–30580 | 20723 | **no** | `sleep 1` |
| 26638 | sleep | 6061 | 30580–31225 | 21368 | yes | `sleep 1` |
| 26653 | sleep | 6364 | 31006–31653 | 21796 | **no** | `sleep 1` |
| 26638 |  |  | 31438–31438 | 21581 | yes | `none: not in the latest ps sample` |
| 26680 | sleep | 6061 | 31653–32301 | 22444 | yes | `sleep 1` |
| 26694 | sleep | 6364 | 31871–32516 | 22659 | **no** | `sleep 1` |
| 26721 | sleep | 6061 | 32516–33371 | 23514 | yes | `sleep 1` |
| 26694 |  |  | 32728–32728 | 22871 | **no** | `none: not in the latest ps sample` |
| 26740 | sleep | 6364 | 32947–33588 | 23731 | **no** | `sleep 1` |
| 26770 | sleep | 6061 | 33588–34439 | 24582 | yes | `sleep 1` |
| 26785 | sleep | 6364 | 34014–34656 | 24799 | **no** | `sleep 1` |
| 26770 |  |  | 34467–34467 | 24610 | yes | `none: not in the latest ps sample` |
| 26819 | sleep | 6061 | 34656–35412 | 25555 | yes | `sleep 1` |
| 26830 | sleep | 6364 | 34867–35624 | 25767 | **no** | `sleep 1` |
| 27315 | sleep | 6061 | 35601–36258 | 26401 | yes | `sleep 1` |
| 27331 | sleep | 6364 | 35834–36732 | 26875 | **no** | `sleep 1` |
| 27315 |  |  | 36475–36475 | 26618 | yes | `none: not in the latest ps sample` |
| 27359 | sleep | 6061 | 36684–37320 | 27463 | yes | `sleep 1` |
| 27372 | sleep | 6364 | 36898–37746 | 27889 | **no** | `sleep 1` |
| 27398 | sleep | 6061 | 37532–38385 | 28528 | yes | `sleep 1` |
| 27411 | sleep | 6364 | 37864–38597 | 28740 | **no** | `sleep 1` |
| 27437 | sleep | 6061 | 38597–39453 | 29596 | yes | `sleep 1` |
| 27411 |  |  | 38807–38807 | 28950 | **no** | `none: not in the latest ps sample` |
| 27452 | sleep | 6364 | 38995–39667 | 29810 | **no** | `sleep 1` |
| 27478 | sleep | 6061 | 39667–40308 | 30451 | yes | `sleep 1` |
| 27493 | sleep | 6364 | 40092–40731 | 30874 | **no** | `sleep 1` |
| 27478 |  |  | 40519–40519 | 30662 | yes | `none: not in the latest ps sample` |
| 27519 | sleep | 6061 | 40731–41263 | 31406 | yes | `sleep 1` |
| 27531 | sleep | 6364 | 40941–41820 | 31963 | **no** | `sleep 1` |
| 28217 | sleep | 6061 | 41820–42247 | 32390 | yes | `sleep 1` |
| 28299 | sleep | 6364 | 42032–42720 | 32863 | **no** | `sleep 1` |
| 28217 |  |  | 42460–42459 | 32602 | yes | `none: not in the latest ps sample` |
| 28325 | sleep | 6061 | 42720–43363 | 33506 | yes | `sleep 1` |
| 28343 | sleep | 6364 | 42934–43793 | 33936 | **no** | `sleep 1` |
| 28325 |  |  | 43577–43577 | 33720 | yes | `none: not in the latest ps sample` |
| 28369 | sleep | 6061 | 43638–44430 | 34573 | yes | `sleep 1` |
| 28382 | sleep | 6364 | 44003–44856 | 34999 | **no** | `sleep 1` |
| 28407 | sleep | 6061 | 44643–45495 | 35638 | yes | `sleep 1` |
| 28423 | sleep | 6364 | 45071–45705 | 35848 | **no** | `sleep 1` |
| 28447 | sleep | 6061 | 45705–46373 | 36516 | yes | `sleep 1` |
| 28423 |  |  | 45908–45916 | 36059 | **no** | `none: not in the latest ps sample` |
| 28464 | sleep | 6364 | 46158–46794 | 36937 | **no** | `sleep 1` |
| 28447 |  |  | 46585–46585 | 36728 | yes | `none: not in the latest ps sample` |
| 28488 | sleep | 6061 | 46794–47435 | 37578 | yes | `sleep 1` |
| 28500 | sleep | 6364 | 47005–47863 | 38006 | **no** | `sleep 1` |
| 28538 | sleep | 6061 | 47651–48499 | 38642 | yes | `sleep 1` |
| 28551 | sleep | 6364 | 48072–48709 | 38852 | **no** | `sleep 1` |
| 28577 | sleep | 6061 | 48709–49344 | 39487 | yes | `sleep 1` |
| 28551 |  |  | 48919–48919 | 39062 | **no** | `none: not in the latest ps sample` |
| 28592 | sleep | 6364 | 49130–49809 | 39952 | **no** | `sleep 1` |
| 28577 |  |  | 49599–49599 | 39742 | yes | `none: not in the latest ps sample` |
| 28618 | sleep | 6061 | 49809–50521 | 40664 | yes | `sleep 1` |
| 28639 | sleep | 6364 | 50025–50880 | 41023 | **no** | `sleep 1` |
| 28671 | sleep | 6061 | 50669–51516 | 41659 | yes | `sleep 1` |
| 28687 | sleep | 6364 | 51093–51737 | 41880 | **no** | `sleep 1` |
| 28671 |  |  | 51653–51653 | 41796 | yes | `none: not in the latest ps sample` |
| 28793 | sleep | 6061 | 51737–52591 | 42734 | yes | `sleep 1` |
| 28687 |  |  | 51954–51954 | 42097 | **no** | `none: not in the latest ps sample` |
| 28807 | sleep | 6364 | 52166–52789 | 42932 | **no** | `sleep 1` |
| 28831 | sleep | 6061 | 52802–53429 | 43572 | yes | `sleep 1` |
| 28848 | sleep | 6364 | 53219–53930 | 44073 | **no** | `sleep 1` |
| 28831 |  |  | 53640–53640 | 43783 | yes | `none: not in the latest ps sample` |
| 28872 | sleep | 6061 | 53854–54493 | 44636 | yes | `sleep 1` |
| 28885 | sleep | 6364 | 54069–54976 | 45119 | **no** | `sleep 1` |
| 28911 | sleep | 6061 | 54762–55403 | 45546 | yes | `sleep 1` |
| 28926 | sleep | 6364 | 55064–55826 | 45969 | **no** | `sleep 1` |
| 28911 |  |  | 55614–55614 | 45757 | yes | `none: not in the latest ps sample` |
| 28952 | sleep | 6061 | 55826–56493 | 46636 | yes | `sleep 1` |
| 28970 | sleep | 6364 | 56055–56914 | 47057 | **no** | `sleep 1` |
| 28997 | sleep | 6061 | 56914–57578 | 47721 | yes | `sleep 1` |
| 29009 | sleep | 6364 | 57128–57787 | 47930 | **no** | `sleep 1` |
| 29035 | sleep | 6061 | 57787–58640 | 48783 | yes | `sleep 1` |
| 29009 |  |  | 57996–57996 | 48139 | **no** | `none: not in the latest ps sample` |
| 29049 | sleep | 6364 | 58208–58855 | 48998 | **no** | `sleep 1` |
| 29075 | sleep | 6061 | 58855–59638 | 49781 | yes | `sleep 1` |
| 29049 |  |  | 59069–59069 | 49212 | **no** | `none: not in the latest ps sample` |
| 29090 | sleep | 6364 | 59282–59918 | 50061 | **no** | `sleep 1` |
| 29075 |  |  | 59704–59704 | 49847 | yes | `none: not in the latest ps sample` |
| 29116 | sleep | 6061 | 59918–60560 | 50703 | yes | `sleep 1` |
| 29127 | sleep | 6364 | 60132–61032 | 51175 | **no** | `sleep 1` |
| 29157 | sleep | 6061 | 60771–61669 | 51812 | yes | `sleep 1` |
| 29173 | sleep | 6364 | 61245–61952 | 52095 | **no** | `sleep 1` |
| 29197 | sleep | 6061 | 61881–62737 | 52880 | yes | `sleep 1` |
| 29216 | sleep | 6364 | 62315–62947 | 53090 | **no** | `sleep 1` |
| 29240 | sleep | 6061 | 62947–63560 | 53703 | yes | `sleep 1` |
| 29216 |  |  | 63087–63087 | 53230 | **no** | `none: not in the latest ps sample` |
| 29271 | sleep | 6364 | 63164–63879 | 54022 | **no** | `sleep 1` |
| 30104 | sleep | 6061 | 63879–64554 | 54697 | yes | `sleep 1` |
| 30484 | sleep | 6364 | 64205–64864 | 55007 | **no** | `sleep 1` |
| 31278 | sleep | 6061 | 64864–65546 | 55689 | yes | `sleep 1` |
| 31674 | sleep | 6364 | 65242–65878 | 56021 | **no** | `sleep 1` |
| 32505 | sleep | 6061 | 65878–66491 | 56634 | yes | `sleep 1` |
| 32905 | sleep | 6364 | 66491–66775 | 56918 | **no** | `sleep 1` |
| 32505 |  |  | 66758–66775 | 56918 | yes | `none: not in the latest ps sample` |
| 32905 |  |  | 67128–67128 | 57271 | **no** | `none: not in the latest ps sample` |
| 33809 | sleep | 6061 | 67128–67596 | 57739 | yes | `sleep 1` |
| 34201 | sleep | 6364 | 67383–68051 | 58194 | **no** | `sleep 1` |
| 33809 |  |  | 67812–67812 | 57955 | yes | `none: not in the latest ps sample` |
| 34344 | sleep | 6061 | 68020–68648 | 58791 | yes | `sleep 1` |
| 34359 | sleep | 6364 | 68231–69069 | 59212 | **no** | `sleep 1` |
| 34344 |  |  | 68860–68860 | 59003 | yes | `none: not in the latest ps sample` |
| 34387 | sleep | 6061 | 69069–69702 | 59845 | yes | `sleep 1` |
| 34359 |  |  | 69181–69181 | 59324 | **no** | `none: not in the latest ps sample` |
| 34401 | sleep | 6364 | 69280–70129 | 60272 | **no** | `sleep 1` |
| 34426 | sleep | 6061 | 69917–70766 | 60909 | yes | `sleep 1` |
| 34447 | sleep | 6364 | 70313–70978 | 61121 | **no** | `sleep 1` |
| 34474 | sleep | 6061 | 70978–71620 | 61763 | yes | `sleep 1` |
| 34447 |  |  | 71195–71195 | 61338 | **no** | `none: not in the latest ps sample` |
| 34489 | sleep | 6364 | 71406–72041 | 62184 | **no** | `sleep 1` |
| 34474 |  |  | 71830–71830 | 61973 | yes | `none: not in the latest ps sample` |
| 34519 | sleep | 6061 | 72041–72684 | 62827 | yes | `sleep 1` |
| 34539 | sleep | 6364 | 72256–73107 | 63250 | **no** | `sleep 1` |
| 34567 | sleep | 6061 | 73107–73815 | 63958 | yes | `sleep 1` |
| 34823 | sleep | 6364 | 73393–74028 | 64171 | **no** | `sleep 1` |
| 34972 | sleep | 6061 | 74028–74844 | 64987 | yes | `sleep 1` |
| 34823 |  |  | 74241–74241 | 64384 | **no** | `none: not in the latest ps sample` |
| 34993 | sleep | 6364 | 74455–75090 | 65233 | **no** | `sleep 1` |
| 34972 |  |  | 74876–74876 | 65019 | yes | `none: not in the latest ps sample` |
| 35018 | sleep | 6061 | 75090–75721 | 65864 | yes | `sleep 1` |
| 35033 | sleep | 6364 | 75301–76141 | 66284 | **no** | `sleep 1` |
| 35062 | sleep | 6061 | 75976–76774 | 66917 | yes | `sleep 1` |
| 35076 | sleep | 6364 | 76352–77194 | 67337 | **no** | `sleep 1` |
| 35101 | sleep | 6061 | 76982–77829 | 67972 | yes | `sleep 1` |
| 35117 | sleep | 6364 | 77407–78045 | 68188 | **no** | `sleep 1` |
| 35142 | sleep | 6061 | 78045–78685 | 68828 | yes | `sleep 1` |
| 35117 |  |  | 78242–78259 | 68402 | **no** | `none: not in the latest ps sample` |
| 35159 | sleep | 6364 | 78473–79113 | 69256 | **no** | `sleep 1` |
| 35142 |  |  | 78898–78898 | 69041 | yes | `none: not in the latest ps sample` |
| 35186 | sleep | 6061 | 79113–79893 | 70036 | yes | `sleep 1` |
| 35458 | sleep | 6364 | 79377–80102 | 70245 | **no** | `sleep 1` |
| 35600 | sleep | 6061 | 80102–80738 | 70881 | yes | `sleep 1` |
| 35458 |  |  | 80312–80312 | 70455 | **no** | `none: not in the latest ps sample` |
| 35615 | sleep | 6364 | 80524–81158 | 71301 | **no** | `sleep 1` |
| 35600 |  |  | 80947–80947 | 71090 | yes | `none: not in the latest ps sample` |
| 35641 | sleep | 6061 | 81158–81795 | 71938 | yes | `sleep 1` |
| 35661 | sleep | 6364 | 81373–82222 | 72365 | **no** | `sleep 1` |
| 35686 | sleep | 6061 | 82013–82863 | 73006 | yes | `sleep 1` |
| 35701 | sleep | 6364 | 82430–83114 | 73257 | **no** | `sleep 1` |
| 35733 | sleep | 6061 | 83114–83957 | 74100 | yes | `sleep 1` |
| 35701 |  |  | 83327–83327 | 73470 | **no** | `none: not in the latest ps sample` |
| 35748 | sleep | 6364 | 83536–84171 | 74314 | **no** | `sleep 1` |
| 35772 | sleep | 6061 | 84031–84804 | 74947 | yes | `sleep 1` |
| 35788 | sleep | 6364 | 84383–85231 | 75374 | **no** | `sleep 1` |
| 35815 | sleep | 6061 | 85163–85810 | 75953 | yes | `sleep 1` |
| 36038 | sleep | 6364 | 85533–86311 | 76454 | **no** | `sleep 1` |
| 36574 | sleep | 6061 | 86029–86870 | 77013 | yes | `sleep 1` |
| 36591 | sleep | 6364 | 86449–87289 | 77432 | **no** | `sleep 1` |
| 36614 | sleep | 6061 | 87079–87922 | 78065 | yes | `sleep 1` |
| 36629 | sleep | 6364 | 87446–88342 | 78485 | **no** | `sleep 1` |
| 36654 | sleep | 6061 | 88132–88978 | 79121 | yes | `sleep 1` |
| 36670 | sleep | 6364 | 88551–89195 | 79338 | **no** | `sleep 1` |
| 36710 | sleep | 6061 | 89195–89824 | 79967 | yes | `sleep 1` |
| 36670 |  |  | 89403–89403 | 79546 | **no** | `none: not in the latest ps sample` |
| 36725 | sleep | 6364 | 89614–90245 | 80388 | **no** | `sleep 1` |
| 36710 |  |  | 90034–90034 | 80177 | yes | `none: not in the latest ps sample` |
| 36750 | sleep | 6061 | 90245–90880 | 81023 | yes | `sleep 1` |
| 36764 |  |  | 90454–90454 | 80597 | **no** | `none: not in the latest ps sample` |
| 36766 | sleep | 6364 | 90668–91306 | 81449 | **no** | `sleep 1` |
| 36789 | sleep | 6061 | 91097–91974 | 82117 | yes | `sleep 1` |
| 36804 | sleep | 6364 | 91515–92220 | 82363 | **no** | `sleep 1` |
| 36789 |  |  | 92003–92003 | 82146 | yes | `none: not in the latest ps sample` |
| 37206 | sleep | 6061 | 92220–92852 | 82995 | yes | `sleep 1` |
| 36804 |  |  | 92430–92430 | 82573 | **no** | `none: not in the latest ps sample` |
| 37221 | sleep | 6364 | 92640–93275 | 83418 | **no** | `sleep 1` |
| 37206 |  |  | 93063–93063 | 83206 | yes | `none: not in the latest ps sample` |
| 37244 | sleep | 6061 | 93109–93908 | 84051 | yes | `sleep 1` |
| 37261 | sleep | 6364 | 93485–94332 | 84475 | **no** | `sleep 1` |
| 37284 | sleep | 6061 | 94121–94991 | 85134 | yes | `sleep 1` |
| 37301 | sleep | 6364 | 94550–95376 | 85519 | **no** | `sleep 1` |
| 37329 | sleep | 6061 | 95215–95880 | 86023 | yes | `sleep 1` |
| 37301 |  |  | 95436–95436 | 85579 | **no** | `none: not in the latest ps sample` |
| 37346 | sleep | 6364 | 95660–96319 | 86462 | **no** | `sleep 1` |
| 6061 |  |  | 96098–96098 | 86241 | yes | `none: not in the latest ps sample` |
| 37329 |  |  | 96098–96098 | 86241 | yes | `none: not in the latest ps sample` |
| 37382 | sleep | 6364 | 96517–97415 | 87558 | **no** | `sleep 1` |
| 37420 | sleep | 6364 | 97634–98313 | 88456 | **no** | `sleep 1` |
| 38157 | sleep | 6364 | 98749–99412 | 89555 | **no** | `sleep 1` |
| 38193 | sleep | 6364 | 99630–100294 | 90437 | **no** | `sleep 1` |
| 38193 |  |  | 100516–100516 | 90659 | **no** | `none: not in the latest ps sample` |
| 38232 | sleep | 6364 | 100736–101395 | 91538 | **no** | `sleep 1` |
| 38273 | sleep | 6364 | 101615–102271 | 92414 | **no** | `sleep 1` |
| 38273 |  |  | 102490–102490 | 92633 | **no** | `none: not in the latest ps sample` |
| 38311 | sleep | 6364 | 102708–103393 | 93536 | **no** | `sleep 1` |
| 38348 | sleep | 6364 | 103584–104281 | 94424 | **no** | `sleep 1` |
| 38348 |  |  | 104533–104551 | 94694 | **no** | `none: not in the latest ps sample` |
| 38775 | sleep | 6364 | 104774–105425 | 95568 | **no** | `sleep 1` |
| 38810 | sleep | 6364 | 105643–106519 | 96662 | **no** | `sleep 1` |
| 38849 | sleep | 6364 | 106735–107395 | 97538 | **no** | `sleep 1` |
| 38886 | sleep | 6364 | 107611–108487 | 98630 | **no** | `sleep 1` |
| 38924 | sleep | 6364 | 108706–109363 | 99506 | **no** | `sleep 1` |
| 38924 |  |  | 109578–109578 | 99721 | **no** | `none: not in the latest ps sample` |
| 38962 | sleep | 6364 | 109798–110225 | 100368 | **no** | `sleep 1` |
| 39872 | sleep | 6364 | 110741–111601 | 101744 | **no** | `sleep 1` |
| 39872 |  |  | 111729–111729 | 101872 | **no** | `none: not in the latest ps sample` |
| 40280 | sleep | 6364 | 111948–112602 | 102745 | **no** | `sleep 1` |
| 40315 | sleep | 6364 | 112820–113476 | 103619 | **no** | `sleep 1` |
| 40315 |  |  | 113688–113688 | 103831 | **no** | `none: not in the latest ps sample` |
| 40352 | sleep | 6364 | 113880–114566 | 104709 | **no** | `sleep 1` |
| 40389 | sleep | 6364 | 114784–115659 | 105802 | **no** | `sleep 1` |
| 40427 | sleep | 6364 | 115880–116530 | 106673 | **no** | `sleep 1` |
| 40427 |  |  | 116747–116747 | 106890 | **no** | `none: not in the latest ps sample` |
| 40465 | sleep | 6364 | 117073–117559 | 107702 | **no** | `sleep 1` |
| 40465 |  |  | 117776–117776 | 107919 | **no** | `none: not in the latest ps sample` |
| 40925 | sleep | 6364 | 117991–118680 | 108823 | **no** | `sleep 1` |
| 40961 | sleep | 6364 | 118894–119601 | 109744 | **no** | `sleep 1` |
| 40961 |  |  | 119771–119771 | 109914 | **no** | `none: not in the latest ps sample` |
| 41002 | sleep | 6364 | 119988–120737 | 110880 | **no** | `sleep 1` |
| 41043 | sleep | 6364 | 120855–121717 | 111860 | **no** | `sleep 1` |
| 41079 | sleep | 6364 | 121879–122575 | 112718 | **no** | `sleep 1` |
| 41079 |  |  | 122787–122787 | 112930 | **no** | `none: not in the latest ps sample` |
| 41121 | sleep | 6364 | 123000–123643 | 113786 | **no** | `sleep 1` |
| 41178 |  |  | 123850–123850 | 113993 | **no** | `none: not in the latest ps sample` |
| 41180 | sleep | 6364 | 124059–124686 | 114829 | **no** | `sleep 1` |
| 41220 | sleep | 6364 | 124892–125728 | 115871 | **no** | `sleep 1` |
| 41259 | sleep | 6364 | 125938–126774 | 116917 | **no** | `sleep 1` |
| 41298 | sleep | 6364 | 126982–127605 | 117748 | **no** | `sleep 1` |
| 41298 |  |  | 127817–127817 | 117960 | **no** | `none: not in the latest ps sample` |
| 41337 | sleep | 6364 | 128025–128676 | 118819 | **no** | `sleep 1` |
| 6371 |  |  | 128873–128873 | 119016 | **no** | `none: not in the latest ps sample` |
| 41337 |  |  | 128873–128873 | 119016 | **no** | `none: not in the latest ps sample` |

### Cargo

Record `cargo-2026-09-28T00-20-16-207Z`. Group 51109; the direct child exited at 180037 ms with code 0; the group was seen empty at 180275 ms.

`ps` tracking saw 1571 processes:

| pid | name | pgid | ppid | seen (ms) | left group | alive after group empty (ms) | command line |
|---:|---|---|---|---|---|---:|---|
| 51109 | cargo | 51109 | 51040 | 4–180008 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo build --workspace` |
| 51134 | rustc | 51109 | 51109 | 107–159 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc -vV` |
| 51148 | rustc | 51109 | 51109 | 211–211 | no |  | `none: seen only as a zombie, after it exited` |
| 59200 | rustc | 51109 | 51109 | 64333–64383 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc -vV` |
| 60726 | rustc | 51109 | 51109 | 64788–65059 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name unicode_ident --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unicode-iden … (662 chars)` |
| 60773 | rustc | 51109 | 51109 | 64788–66865 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/proc-ma … (776 chars)` |
| 60790 | rustc | 51109 | 51109 | 64788–64970 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cfg_if --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cfg-if-1.0.1/src/li … (673 chars)` |
| 60799 | rustc | 51109 | 51109 | 64788–66865 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/quote-1 … (703 chars)` |
| 60817 | rustc | 51109 | 51109 | 64850–66865 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libc-0. … (1133 chars)` |
| 60836 | rustc | 51109 | 51109 | 64850–65353 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name autocfg --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/autocfg-1.4.0/src/ … (606 chars)` |
| 60858 | rustc | 51109 | 51109 | 64850–65413 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name memchr --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/memchr-2.8.2/src/li … (796 chars)` |
| 60893 | rustc | 51109 | 51109 | 64850–64970 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name equivalent --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/equivalent-1.0. … (655 chars)` |
| 60923 | rustc | 51109 | 51109 | 64970–65132 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name version_check --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/version_chec … (618 chars)` |
| 60925 | rustc | 51109 | 51109 | 64970–66865 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1 … (836 chars)` |
| 60935 | rustc | 51109 | 51109 | 64970–66865 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_c … (801 chars)` |
| 61000 | rustc | 51109 | 51109 | 64970–65059 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name itoa --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/itoa-1.0.14/src/lib.r … (654 chars)` |
| 61098 | rustc | 51109 | 51109 | 65059–65132 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ryu --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ryu-1.0.18/src/lib.rs  … (661 chars)` |
| 61115 | rustc | 51109 | 51109 | 65059–65059 | no |  | `none: seen only as a zombie, after it exited` |
| 61166 | rustc | 51109 | 51109 | 65132–65132 | no |  | `none: seen only as a zombie, after it exited` |
| 61176 | rustc | 51109 | 51109 | 65132–66865 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_c … (758 chars)` |
| 61186 | clang | 51109 | 60799 | 65132–66729 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/quote-9ab07963a3938e00/rustcQPIgym/symbols.o /private/tmp/c335/tauri/target/debug/build/quote-9ab07963a3938 … (3230 chars)` |
| 61187 | clang | 51109 | 60925 | 65132–66729 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/serde-965664aac2c4bea0/rustc3seovQ/symbols.o /private/tmp/c335/tauri/target/debug/build/serde-965664aac2c4b … (3230 chars)` |
| 61195 | rustc | 51109 | 51109 | 65132–66865 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/thiserr … (697 chars)` |
| 61203 | clang | 51109 | 60935 | 65132–66729 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/serde_core-bdba7db2cda94d2a/rustcAIthJe/symbols.o /private/tmp/c335/tauri/target/debug/build/serde_core-bdb … (3250 chars)` |
| 61204 | clang | 51109 | 60773 | 65132–66865 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/proc-macro2-69aeb24876bce72e/rustc9SnU5S/symbols.o /private/tmp/c335/tauri/target/debug/build/proc-macro2-6 … (3254 chars)` |
| 61225 | rustc | 51109 | 51109 | 65226–65858 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bytes --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bytes-1.11.1/src/lib … (779 chars)` |
| 61229 | rustc | 51109 | 51109 | 65226–65353 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name siphasher --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/siphasher-1.0.1/ … (765 chars)` |
| 61246 | rustc | 51109 | 51109 | 65226–65413 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name once_cell --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/once_cell-1.21.4 … (859 chars)` |
| 61285 | clang | 51109 | 60817 | 65287–66865 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/libc-09209d0d1abaf3ea/rustcnlhFZI/symbols.o /private/tmp/c335/tauri/target/debug/build/libc-09209d0d1abaf3e … (3374 chars)` |
| 61334 | clang | 51109 | 61195 | 65287–66865 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/thiserror-fbf950abeeabd46e/rustcG6ye2Q/symbols.o /private/tmp/c335/tauri/target/debug/build/thiserror-fbf95 … (3246 chars)` |
| 61336 | clang | 51109 | 61176 | 65287–66865 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/serde_core-08928419ca93437b/rustcQ1ITWA/symbols.o /private/tmp/c335/tauri/target/debug/build/serde_core-089 … (3250 chars)` |
| 61525 | rustc | 51109 | 51109 | 65413–65480 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name shlex --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/shlex-1.3.0/src/lib. … (705 chars)` |
| 61614 | rustc | 51109 | 51109 | 65480–65609 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name find_msvc_tools --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/find-msvc- … (729 chars)` |
| 61623 | rustc | 51109 | 51109 | 65480–65609 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name value_bag --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/value-bag-1.12.0 … (897 chars)` |
| 61655 | rustc | 51109 | 51109 | 65480–65858 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name allocator_api2 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/allocator-a … (852 chars)` |
| 61752 | rustc | 51109 | 51109 | 65534–66671 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name typenum --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/typenum-1.20.0/src … (743 chars)` |
| 61948 | rustc | 51109 | 51109 | 65684–67702 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cc --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cc-1.2.51/src/lib.rs -- … (925 chars)` |
| 61966 | rustc | 51109 | 51109 | 65751–65967 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name log --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/log-0.4.29/src/lib.rs  … (1270 chars)` |
| 62098 | rustc | 51109 | 51109 | 65916–66509 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hashbrown --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hashbrown-0.16.1 … (995 chars)` |
| 62130 | rustc | 51109 | 51109 | 65916–67241 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name http --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/http-1.3.1/src/lib.rs … (964 chars)` |
| 62252 | rustc | 51109 | 51109 | 66018–66070 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name fastrand --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fastrand-2.3.0/sr … (652 chars)` |
| 62421 | ld | 51109 | 61203 | 66070–66729 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3426 chars)` |
| 62422 | ld | 51109 | 61204 | 66070–66865 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3430 chars)` |
| 62423 | ld | 51109 | 61336 | 66070–66865 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3426 chars)` |
| 62424 | ld | 51109 | 61186 | 66070–66729 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3406 chars)` |
| 62425 | ld | 51109 | 61285 | 66070–66865 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3550 chars)` |
| 62426 | ld | 51109 | 61187 | 66070–66729 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3406 chars)` |
| 62427 | ld | 51109 | 61334 | 66070–66729 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3422 chars)` |
| 62509 | rustc | 51109 | 51109 | 66120–66231 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name phf_shared --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf_shared-0.13 … (835 chars)` |
| 62589 | rustc | 51109 | 51109 | 66287–66355 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name litemap --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/litemap-0.8.2/src/ … (2139 chars)` |
| 62629 | rustc | 51109 | 51109 | 66405–66459 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name writeable --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/writeable-0.6.3/ … (2113 chars)` |
| 62714 | rustc | 51109 | 51109 | 66509–66865 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libc-0. … (1104 chars)` |
| 62771 | rustc | 51109 | 51109 | 66563–66615 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name phf_generator --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf_generato … (813 chars)` |
| 62842 | clang | 51109 | 62714 | 66615–66729 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/libc-9dc284ffa9e6b613/rustcXMFAJu/symbols.o /private/tmp/c335/tauri/target/debug/build/libc-9dc284ffa9e6b61 … (3376 chars)` |
| 62852 | ld | 51109 | 62842 | 66615–66729 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3552 chars)` |
| 62863 | rustc | 51109 | 51109 | 66671–66924 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/generic … (836 chars)` |
| 62899 | xcrun | 51109 | 62863 | 66671–66671 | no |  | `none: seen only as a zombie, after it exited` |
| 62912 | clang | 51109 | 62863 | 66729–66865 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/generic-array-d46dcb235331e2f3/rustcArlnNo/symbols.o /private/tmp/c335/tauri/target/debug/build/generic-arr … (3343 chars)` |
| 62974 | rustc | 51109 | 51109 | 66729–66924 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name base64 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/base64-0.22.1/src/l … (739 chars)` |
| 62991 | ld | 51109 | 62912 | 66729–66865 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3519 chars)` |
| 63087 | build-script-build | 51109 | 51109 | 66924–66981 | no |  | `/private/tmp/c335/tauri/target/debug/build/serde-965664aac2c4bea0/build-script-build` |
| 63100 | build-script-bui | 51109 | 51109 | 66924–66924 | no |  | `none: seen only as a zombie, after it exited` |
| 63116 | build-script-build | 51109 | 51109 | 66924–66924 | no |  | `/private/tmp/c335/tauri/target/debug/build/serde_core-bdba7db2cda94d2a/build-script-build` |
| 63129 | build-script-build | 51109 | 51109 | 66924–66981 | no |  | `/private/tmp/c335/tauri/target/debug/build/libc-09209d0d1abaf3ea/build-script-build` |
| 63136 | build-script-build | 51109 | 51109 | 66924–66981 | no |  | `/private/tmp/c335/tauri/target/debug/build/thiserror-fbf950abeeabd46e/build-script-build` |
| 63153 | build-script-build | 51109 | 51109 | 66924–66981 | no |  | `/private/tmp/c335/tauri/target/debug/build/libc-9dc284ffa9e6b613/build-script-build` |
| 63160 | build-script-build | 51109 | 51109 | 66981–67048 | no |  | `/private/tmp/c335/tauri/target/debug/build/proc-macro2-69aeb24876bce72e/build-script-build` |
| 63184 | build-script-bui | 51109 | 51109 | 66981–66981 | no |  | `none: seen only as a zombie, after it exited` |
| 63203 | rustc | 51109 | 51109 | 66981–67120 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_nor … (714 chars)` |
| 63238 | build-script-build | 51109 | 51109 | 66981–67048 | no |  | `/private/tmp/c335/tauri/target/debug/build/generic-array-d46dcb235331e2f3/build-script-build` |
| 63239 | rustc | 51109 | 63136 | 66981–66981 | no |  | `none: seen only as a zombie, after it exited` |
| 63240 | rustc | 51109 | 63153 | 66981–66981 | no |  | `none: seen only as a zombie, after it exited` |
| 63242 | rustc | 51109 | 63129 | 66981–66981 | no |  | `none: seen only as a zombie, after it exited` |
| 63245 | rustc | 51109 | 51109 | 67048–70262 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_core-1.0. … (1170 chars)` |
| 63274 | rustc | 51109 | 51109 | 67048–67175 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1 … (817 chars)` |
| 63302 | clang | 51109 | 63203 | 67048–67120 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/icu_normalizer_data-cc9a0f9c8cf560e3/rustcV2MpSz/symbols.o /private/tmp/c335/tauri/target/debug/build/icu_n … (3286 chars)` |
| 63312 | rustc | 51109 | 51109 | 67048–70378 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_core-1.0. … (1084 chars)` |
| 63320 | rustc | 51109 | 51109 | 67048–68078 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name libc --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libc-0.2.189/src/lib. … (1940 chars)` |
| 63324 | rustc | 51109 | 63238 | 67048–67048 | no |  | `none: seen only as a zombie, after it exited` |
| 63325 | rustc | 51109 | 51109 | 67048–68401 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name libc --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libc-0.2.189/src/lib. … (2012 chars)` |
| 63328 | ld | 51109 | 63302 | 67048–67120 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3462 chars)` |
| 63334 | rustc | 51109 | 51109 | 67120–67175 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_pro … (714 chars)` |
| 63345 | rustc | 51109 | 51109 | 67120–67175 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name byteorder --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/byteorder-1.5.0/ … (721 chars)` |
| 63347 | rustc | 51109 | 51109 | 67120–68130 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name indexmap --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/indexmap-2.11.4/s … (1006 chars)` |
| 63386 | rustc | 51109 | 51109 | 67120–68284 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name proc_macro2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/proc-macro2-1. … (1577 chars)` |
| 63387 | clang | 51109 | 63334 | 67120–67175 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/icu_properties_data-321839e3d75afb2c/rustcxZ7RwL/symbols.o /private/tmp/c335/tauri/target/debug/build/icu_p … (3286 chars)` |
| 63435 | ld | 51109 | 63387 | 67175–67175 | no |  | `none: seen only as a zombie, after it exited` |
| 63436 | build-script-bui | 51109 | 51109 | 67175–67175 | no |  | `none: seen only as a zombie, after it exited` |
| 63448 | clang | 51109 | 63274 | 67175–67175 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/serde-fe7404969cb3b5ac/rustc1QeZFM/symbols.o /private/tmp/c335/tauri/target/debug/build/serde-fe7404969cb3b … (3230 chars)` |
| 63475 | rustc | 51109 | 51109 | 67241–67351 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/getrand … (1080 chars)` |
| 63503 | build-script-build | 51109 | 51109 | 67241–67293 | no |  | `/private/tmp/c335/tauri/target/debug/build/icu_properties_data-321839e3d75afb2c/build-script-build` |
| 63506 | rustc | 51109 | 51109 | 67241–67241 | no |  | `none: seen only as a zombie, after it exited` |
| 63515 | build-script-bui | 51109 | 51109 | 67293–67293 | no |  | `none: seen only as a zombie, after it exited` |
| 63532 | rustc | 51109 | 51109 | 67293–67351 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name smallvec --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/smallvec-1.15.2/s … (921 chars)` |
| 63581 | rustc | 51109 | 51109 | 67293–67351 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name subtle --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/subtle-2.6.1/src/li … (788 chars)` |
| 63629 | rustc | 51109 | 51109 | 67351–67420 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name icu_properties_data --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_pr … (770 chars)` |
| 63672 | clang | 51109 | 63475 | 67351–67351 | no |  | `none: seen only as a zombie, after it exited` |
| 63676 | rustc | 51109 | 51109 | 67351–67483 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/parking … (720 chars)` |
| 63690 | ld | 51109 | 63672 | 67351–67351 | no |  | `none: seen only as a zombie, after it exited` |
| 63745 | rustc | 51109 | 51109 | 67420–67483 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/lock_ap … (851 chars)` |
| 63768 | rustc | 51109 | 51109 | 67420–67483 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name utf8_iter --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/utf8_iter-1.0.4/ … (653 chars)` |
| 63777 | build-script-bui | 51109 | 51109 | 67420–67420 | no |  | `none: seen only as a zombie, after it exited` |
| 63805 | clang | 51109 | 63676 | 67420–67483 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/parking_lot_core-4ebe17290be76418/rustcRqjQyL/symbols.o /private/tmp/c335/tauri/target/debug/build/parking_ … (3274 chars)` |
| 63822 | clang | 51109 | 63745 | 67483–67483 | no |  | `none: seen only as a zombie, after it exited` |
| 63828 | ld | 51109 | 63805 | 67483–67483 | no |  | `none: seen only as a zombie, after it exited` |
| 63829 | ld | 51109 | 63822 | 67483–67483 | no |  | `none: seen only as a zombie, after it exited` |
| 63831 | rustc | 51109 | 51109 | 67483–67483 | no |  | `none: seen only as a zombie, after it exited` |
| 63837 | rustc | 51109 | 51109 | 67534–67804 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name strsim --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/strsim-0.11.1/src/l … (648 chars)` |
| 63860 | rustc | 51109 | 51109 | 67534–67650 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/thiserr … (637 chars)` |
| 63864 | build-script-bui | 51109 | 51109 | 67534–67534 | no |  | `none: seen only as a zombie, after it exited` |
| 63895 | build-script-build | 51109 | 51109 | 67534–67586 | no |  | `/private/tmp/c335/tauri/target/debug/build/lock_api-8d754a77f499ecaf/build-script-build` |
| 63897 | rustc | 51109 | 51109 | 67534–70789 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name regex_syntax --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/regex-syntax- … (1149 chars)` |
| 63936 | rustc | 51109 | 51109 | 67586–67586 | no |  | `none: seen only as a zombie, after it exited` |
| 63955 | xcrun | 51109 | 63860 | 67586–67586 | no |  | `none: seen only as a zombie, after it exited` |
| 63956 | rustc | 51109 | 63895 | 67586–67586 | no |  | `none: seen only as a zombie, after it exited` |
| 63960 | clang | 51109 | 63860 | 67650–67650 | no |  | `none: seen only as a zombie, after it exited` |
| 63997 | ld | 51109 | 63960 | 67650–67650 | no |  | `none: seen only as a zombie, after it exited` |
| 64006 | rustc | 51109 | 51109 | 67702–67702 | no |  | `none: seen only as a zombie, after it exited` |
| 64022 | rustc | 51109 | 51109 | 67702–67804 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name lock_api --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/lock_api-0.4.12/s … (906 chars)` |
| 64031 | build-script-build | 51109 | 51109 | 67702–67752 | no |  | `/private/tmp/c335/tauri/target/debug/build/thiserror-2f9e3bd113677da0/build-script-build` |
| 64152 | rustc | 51109 | 51109 | 67752–67911 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name quote --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/quote-1.0.46/src/lib … (862 chars)` |
| 64156 | rustc | 51109 | 64031 | 67752–67752 | no |  | `none: seen only as a zombie, after it exited` |
| 64233 | rustc | 51109 | 51109 | 67804–67911 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crc32fa … (707 chars)` |
| 64246 | rustc | 51109 | 51109 | 67804–67804 | no |  | `none: seen only as a zombie, after it exited` |
| 64281 | rustc | 51109 | 51109 | 67858–67858 | no |  | `none: seen only as a zombie, after it exited` |
| 64309 | rustc | 51109 | 51109 | 67858–73554 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name syn --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/syn-2.0.117/src/lib.rs … (1298 chars)` |
| 64318 | rustc | 51109 | 51109 | 67858–67911 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name adler2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/adler2-2.0.0/src/li … (712 chars)` |
| 64333 | xcrun | 51109 | 64233 | 67858–67858 | no |  | `none: seen only as a zombie, after it exited` |
| 64334 | clang | 51109 | 64233 | 67911–67911 | no |  | `none: seen only as a zombie, after it exited` |
| 64353 | ld | 51109 | 64334 | 67911–67911 | no |  | `none: seen only as a zombie, after it exited` |
| 64368 | rustc | 51109 | 51109 | 67911–68023 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/anyhow- … (705 chars)` |
| 64393 | rustc | 51109 | 51109 | 67970–67970 | no |  | `none: seen only as a zombie, after it exited` |
| 64399 | rustc | 51109 | 51109 | 67970–70633 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name miniz_oxide --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/miniz_oxide-0. … (1177 chars)` |
| 64413 | build-script-build | 51109 | 51109 | 67970–68023 | no |  | `/private/tmp/c335/tauri/target/debug/build/crc32fast-bf40ed1d67c7a18b/build-script-build` |
| 64435 | rustc | 51109 | 51109 | 68023–68023 | no |  | `none: seen only as a zombie, after it exited` |
| 64454 | clang | 51109 | 64368 | 68023–68023 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/anyhow-477afe79d7339ea7/rustcK0TUCN/symbols.o /private/tmp/c335/tauri/target/debug/build/anyhow-477afe79d73 … (3234 chars)` |
| 64455 | rustc | 51109 | 64413 | 68023–68023 | no |  | `none: seen only as a zombie, after it exited` |
| 64456 | ld | 51109 | 64454 | 68023–68023 | no |  | `none: seen only as a zombie, after it exited` |
| 64461 | rustc | 51109 | 51109 | 68078–68130 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name crc32fast --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crc32fast-1.5.0/ … (894 chars)` |
| 64464 | rustc | 51109 | 51109 | 68078–68181 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name time_core --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/time-core-0.1.9/ … (2934 chars)` |
| 64483 | rustc | 51109 | 51109 | 68130–68130 | no |  | `none: seen only as a zombie, after it exited` |
| 64500 | build-script-build | 51109 | 51109 | 68181–68233 | no |  | `/private/tmp/c335/tauri/target/debug/build/anyhow-477afe79d7339ea7/build-script-build` |
| 64517 | rustc | 51109 | 51109 | 68181–68233 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libm-0. … (693 chars)` |
| 64546 | rustc | 51109 | 51109 | 68181–69438 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name deranged --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/deranged-0.5.8/sr … (2899 chars)` |
| 64550 | rustc | 51109 | 51109 | 68181–68181 | no |  | `none: seen only as a zombie, after it exited` |
| 64573 | clang | 51109 | 64517 | 68233–68233 | no |  | `none: seen only as a zombie, after it exited` |
| 64577 | rustc | 51109 | 64500 | 68233–68233 | no |  | `none: seen only as a zombie, after it exited` |
| 64578 | rustc | 51109 | 51109 | 68233–68284 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name powerfmt --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/powerfmt-0.2.0/sr … (686 chars)` |
| 64579 | ld | 51109 | 64573 | 68233–68233 | no |  | `none: seen only as a zombie, after it exited` |
| 64580 | rustc | 51109 | 51109 | 68284–68346 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_j … (893 chars)` |
| 64586 | rustc | 51109 | 51109 | 68284–68451 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name anyhow --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/anyhow-1.0.103/src/ … (927 chars)` |
| 64591 | xcrun | 51109 | 64580 | 68284–68284 | no |  | `none: seen only as a zombie, after it exited` |
| 64592 | build-script-bui | 51109 | 51109 | 68346–68346 | no |  | `none: seen only as a zombie, after it exited` |
| 64595 | clang | 51109 | 64580 | 68346–68346 | no |  | `none: seen only as a zombie, after it exited` |
| 64596 | rustc | 51109 | 51109 | 68346–68346 | no |  | `none: seen only as a zombie, after it exited` |
| 64614 | ld | 51109 | 64595 | 68346–68346 | no |  | `none: seen only as a zombie, after it exited` |
| 64617 | rustc | 51109 | 51109 | 68401–68568 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name string_cache_codegen --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/strin … (1022 chars)` |
| 64621 | rustc | 51109 | 51109 | 68401–68978 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name libm --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libm-0.2.11/src/lib.r … (832 chars)` |
| 64622 | build-script-bui | 51109 | 51109 | 68401–68401 | no |  | `none: seen only as a zombie, after it exited` |
| 64630 | rustc | 51109 | 51109 | 68401–68451 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name same_file --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/same-file-1.0.6/ … (653 chars)` |
| 64661 | rustc | 51109 | 51109 | 68451–68517 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name getrandom --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/getrandom-0.2.15 … (1003 chars)` |
| 64676 | rustc | 51109 | 51109 | 68517–68628 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name walkdir --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/walkdir-2.5.0/src/ … (746 chars)` |
| 64689 | rustc | 51109 | 51109 | 68517–68517 | no |  | `none: seen only as a zombie, after it exited` |
| 64699 | rustc | 51109 | 51109 | 68568–68628 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rand_core --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rand_core-0.6.4/ … (864 chars)` |
| 64715 | rustc | 51109 | 51109 | 68568–68679 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tendril --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tendril-0.5.0/src/ … (862 chars)` |
| 64733 | rustc | 51109 | 51109 | 68568–68628 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name dtoa_short --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dtoa-short-0.3. … (742 chars)` |
| 64754 | rustc | 51109 | 51109 | 68628–68871 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/web_ato … (861 chars)` |
| 64787 | rustc | 51109 | 51109 | 68679–68743 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-tra … (849 chars)` |
| 64817 | rustc | 51109 | 51109 | 68679–69876 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name quick_xml --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/quick-xml-0.41.0 … (935 chars)` |
| 64821 | xcrun | 51109 | 64787 | 68679–68679 | no |  | `none: seen only as a zombie, after it exited` |
| 64842 | clang | 51109 | 64787 | 68743–68743 | no |  | `none: seen only as a zombie, after it exited` |
| 64859 | ld | 51109 | 64842 | 68743–68743 | no |  | `none: seen only as a zombie, after it exited` |
| 64860 | rustc | 51109 | 51109 | 68743–68871 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/typeid- … (630 chars)` |
| 64862 | rustc | 51109 | 51109 | 68743–68797 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_j … (981 chars)` |
| 64894 | build-script-build | 51109 | 51109 | 68797–68922 | no |  | `/private/tmp/c335/tauri/target/debug/build/num-traits-f87c72d29154df67/build-script-build` |
| 64908 | clang | 51109 | 64862 | 68797–68797 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/serde_json-ef91613a7d513078/rustcc3OIOH/symbols.o /private/tmp/c335/tauri/target/debug/build/serde_json-ef9 … (3250 chars)` |
| 64913 | xcrun | 51109 | 64754 | 68797–68797 | no |  | `none: seen only as a zombie, after it exited` |
| 64914 | clang | 51109 | 64860 | 68797–68797 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/typeid-dce078f11eb46fa6/rustcCSIERS/symbols.o /private/tmp/c335/tauri/target/debug/build/typeid-dce078f11eb … (3234 chars)` |
| 64917 | clang | 51109 | 64754 | 68871–68871 | no |  | `none: seen only as a zombie, after it exited` |
| 64919 | ld | 51109 | 64917 | 68871–68871 | no |  | `none: seen only as a zombie, after it exited` |
| 64940 | rustc | 51109 | 64894 | 68871–68871 | no |  | `none: seen only as a zombie, after it exited` |
| 64939 | build-script-bui | 51109 | 51109 | 68922–68922 | no |  | `none: seen only as a zombie, after it exited` |
| 64943 | build-script-bui | 51109 | 51109 | 68922–68922 | no |  | `none: seen only as a zombie, after it exited` |
| 64945 | rustc | 51109 | 64894 | 68922–68922 | no |  | `none: seen only as a zombie, after it exited` |
| 64946 | build-script-build | 51109 | 51109 | 68922–69382 | no |  | `/private/tmp/c335/tauri/target/debug/build/web_atoms-46c6d29246c9a4f6/build-script-build` |
| 64954 | rustc | 51109 | 51109 | 68978–69161 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/selecto … (756 chars)` |
| 64959 | rustc | 51109 | 51109 | 68978–69095 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/indexma … (891 chars)` |
| 64963 | rustc | 51109 | 51109 | 68978–69095 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/generic … (812 chars)` |
| 64977 | clang | 51109 | 64959 | 69029–69095 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/indexmap-e6c0995fd3526ccb/rustcIsJ1zI/symbols.o /private/tmp/c335/tauri/target/debug/build/indexmap-e6c0995 … (3317 chars)` |
| 64984 | rustc | 51109 | 51109 | 69029–69161 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name smallvec --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/smallvec-1.15.2/s … (852 chars)` |
| 64985 | xcrun | 51109 | 64963 | 69029–69029 | no |  | `none: seen only as a zombie, after it exited` |
| 64987 | ld | 51109 | 64977 | 69029–69029 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3493 chars)` |
| 64990 | clang | 51109 | 64963 | 69095–69095 | no |  | `none: seen only as a zombie, after it exited` |
| 64997 | ld | 51109 | 64990 | 69095–69095 | no |  | `none: seen only as a zombie, after it exited` |
| 65006 | rustc | 51109 | 51109 | 69161–69265 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/camino- … (717 chars)` |
| 65007 | clang | 51109 | 64954 | 69161–69161 | no |  | `none: seen only as a zombie, after it exited` |
| 65009 | rustc | 51109 | 51109 | 69161–69214 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bit_vec --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bit-vec-0.8.0/src/ … (771 chars)` |
| 65013 | ld | 51109 | 65007 | 69161–69161 | no |  | `none: seen only as a zombie, after it exited` |
| 65017 | rustc | 51109 | 51109 | 69214–69265 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/erased- … (707 chars)` |
| 65018 | rustc | 51109 | 51109 | 69214–69265 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name foldhash --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/foldhash-0.2.0/sr … (722 chars)` |
| 65060 | clang | 51109 | 65006 | 69265–69265 | no |  | `none: seen only as a zombie, after it exited` |
| 65084 | rustc | 51109 | 51109 | 69265–69329 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bit_set --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bit-set-0.8.0/src/ … (811 chars)` |
| 65093 | ld | 51109 | 65060 | 69265–69265 | no |  | `none: seen only as a zombie, after it exited` |
| 65108 | clang | 51109 | 65017 | 69265–69265 | no |  | `none: seen only as a zombie, after it exited` |
| 65153 | build-script-build | 51109 | 51109 | 69329–69382 | no |  | `/private/tmp/c335/tauri/target/debug/build/camino-c71850b991ada805/build-script-build` |
| 65170 | build-script-build | 51109 | 51109 | 69329–69382 | no |  | `/private/tmp/c335/tauri/target/debug/build/selectors-840712c189ba6798/build-script-build` |
| 65172 | build-script-bui | 51109 | 51109 | 69382–69382 | no |  | `none: seen only as a zombie, after it exited` |
| 65178 | build-script-bui | 51109 | 51109 | 69382–69382 | no |  | `none: seen only as a zombie, after it exited` |
| 65181 | rustc | 51109 | 65153 | 69382–69382 | no |  | `none: seen only as a zombie, after it exited` |
| 65183 | build-script-build | 51109 | 51109 | 69438–69500 | no |  | `/private/tmp/c335/tauri/target/debug/build/indexmap-e6c0995fd3526ccb/build-script-build` |
| 65185 | rustc | 51109 | 51109 | 69438–69438 | no |  | `none: seen only as a zombie, after it exited` |
| 65204 | rustc | 51109 | 51109 | 69438–70093 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name num_traits --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-traits-0.2. … (912 chars)` |
| 65220 | rustc | 51109 | 51109 | 69438–70210 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name typenum --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/typenum-1.20.0/src … (669 chars)` |
| 65250 | rustc | 51109 | 51109 | 69500–69500 | no |  | `none: seen only as a zombie, after it exited` |
| 65267 | rustc | 51109 | 51109 | 69500–69551 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name percent_encoding --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/percent-e … (758 chars)` |
| 65278 | rustc | 51109 | 51109 | 69500–69982 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hashbrown --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hashbrown-0.12.3 … (860 chars)` |
| 65317 | rustc | 51109 | 65183 | 69500–69500 | no |  | `none: seen only as a zombie, after it exited` |
| 65350 | rustc | 51109 | 51109 | 69551–69602 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name heck --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/heck-0.5.0/src/lib.rs … (643 chars)` |
| 65376 | rustc | 51109 | 51109 | 69602–69654 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/schemar … (1182 chars)` |
| 65379 | rustc | 51109 | 51109 | 69602–69602 | no |  | `none: seen only as a zombie, after it exited` |
| 65396 | clang | 51109 | 65376 | 69654–69654 | no |  | `none: seen only as a zombie, after it exited` |
| 65407 | rustc | 51109 | 51109 | 69654–69654 | no |  | `none: seen only as a zombie, after it exited` |
| 65415 | ld | 51109 | 65396 | 69654–69654 | no |  | `none: seen only as a zombie, after it exited` |
| 65417 | rustc | 51109 | 51109 | 69654–69713 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name alloc_stdlib --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/alloc-stdlib- … (776 chars)` |
| 65436 | rustc | 51109 | 51109 | 69713–69876 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name base64 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/base64-0.21.7/src/l … (739 chars)` |
| 65438 | build-script-build | 51109 | 51109 | 69713–69763 | no |  | `/private/tmp/c335/tauri/target/debug/build/schemars-c6652ad42fb20517/build-script-build` |
| 65442 | rustc | 51109 | 51109 | 69763–69928 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name glob --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/glob-0.3.4/src/lib.rs … (643 chars)` |
| 65447 | rustc | 51109 | 51109 | 69823–69823 | no |  | `none: seen only as a zombie, after it exited` |
| 65457 | rustc | 51109 | 51109 | 69876–69928 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name dyn_clone --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dyn-clone-1.0.17 … (654 chars)` |
| 65462 | rustc | 51109 | 51109 | 69928–71469 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name brotli_decompressor --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/brotli … (1080 chars)` |
| 65477 | rustc | 51109 | 51109 | 69928–69982 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rand_core --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rand_core-0.6.4/ … (779 chars)` |
| 65488 | rustc | 51109 | 51109 | 69982–70210 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name fdeflate --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fdeflate-0.3.7/sr … (803 chars)` |
| 65512 | rustc | 51109 | 51109 | 70032–70093 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/slab-0. … (787 chars)` |
| 65516 | rustc | 51109 | 51109 | 70032–70032 | no |  | `none: seen only as a zombie, after it exited` |
| 65529 | rustc | 51109 | 51109 | 70032–70032 | no |  | `none: seen only as a zombie, after it exited` |
| 65543 | rustc | 51109 | 51109 | 70093–70159 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bitflags --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bitflags-2.13.0/s … (703 chars)` |
| 65544 | clang | 51109 | 65512 | 70093–70093 | no |  | `none: seen only as a zombie, after it exited` |
| 65546 | ld | 51109 | 65544 | 70093–70093 | no |  | `none: seen only as a zombie, after it exited` |
| 65547 | rustc | 51109 | 51109 | 70093–70159 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name core_foundation_sys --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/core-f … (782 chars)` |
| 65565 | rustc | 51109 | 51109 | 70159–70159 | no |  | `none: seen only as a zombie, after it exited` |
| 65576 | build-script-build | 51109 | 51109 | 70159–70262 | no |  | `/private/tmp/c335/tauri/target/debug/build/slab-efd0a23a32b9a4c6/build-script-build` |
| 65587 | rustc | 51109 | 51109 | 70210–70262 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name parking_lot_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/parking_l … (1010 chars)` |
| 65601 | rustc | 51109 | 51109 | 70210–70210 | no |  | `none: seen only as a zombie, after it exited` |
| 65616 | rustc | 51109 | 51109 | 70210–70327 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bitflags --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bitflags-2.13.0/s … (894 chars)` |
| 65636 | rustc | 51109 | 51109 | 70262–72159 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_json --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_json-1.0. … (1535 chars)` |
| 65642 | rustc | 51109 | 65576 | 70262–70262 | no |  | `none: seen only as a zombie, after it exited` |
| 65644 | rustc | 51109 | 51109 | 70327–70940 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name generic_array --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/generic-arra … (799 chars)` |
| 65646 | rustc | 51109 | 51109 | 70327–70327 | no |  | `none: seen only as a zombie, after it exited` |
| 65655 | rustc | 51109 | 51109 | 70327–71622 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_json --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_json-1.0. … (1309 chars)` |
| 65673 | rustc | 51109 | 51109 | 70327–70481 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name semver --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/semver-1.0.28/src/l … (833 chars)` |
| 65680 | rustc | 51109 | 51109 | 70327–70378 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name slab --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/slab-0.4.9/src/lib.rs … (712 chars)` |
| 65713 | rustc | 51109 | 51109 | 70378–70430 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name const_oid --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/const-oid-0.9.6/ … (677 chars)` |
| 65743 | rustc | 51109 | 51109 | 70378–70633 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name parking_lot --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/parking_lot-0. … (1004 chars)` |
| 65781 | rustc | 51109 | 51109 | 70430–70430 | no |  | `none: seen only as a zombie, after it exited` |
| 65801 | rustc | 51109 | 51109 | 70430–70430 | no |  | `none: seen only as a zombie, after it exited` |
| 65822 | rustc | 51109 | 51109 | 70481–72417 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name winnow --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/winnow-0.7.14/src/l … (2820 chars)` |
| 65826 | rustc | 51109 | 51109 | 70481–70582 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml_datetime --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_datetim … (3080 chars)` |
| 65828 | rustc | 51109 | 51109 | 70481–70481 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_spanned --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_spanne … (3100 chars)` |
| 65865 | rustc | 51109 | 51109 | 70582–70633 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name string_cache --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/string_cache- … (1136 chars)` |
| 65869 | rustc | 51109 | 51109 | 70582–70839 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name socket2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/socket2-0.5.8/src/ … (761 chars)` |
| 65889 | rustc | 51109 | 51109 | 70683–71103 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name mio --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/mio-1.0.3/src/lib.rs - … (961 chars)` |
| 65893 | rustc | 51109 | 51109 | 70683–70683 | no |  | `none: seen only as a zombie, after it exited` |
| 65916 | rustc | 51109 | 51109 | 70683–70683 | no |  | `none: seen only as a zombie, after it exited` |
| 65939 | rustc | 51109 | 51109 | 70683–70738 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml_writer --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_writer-1. … (2977 chars)` |
| 65992 | rustc | 51109 | 51109 | 70738–70789 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name percent_encoding --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/percent-e … (691 chars)` |
| 66019 | rustc | 51109 | 51109 | 70789–70890 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rustc_version --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustc_versio … (752 chars)` |
| 66028 | rustc | 51109 | 51109 | 70789–70839 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name getrandom --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/getrandom-0.3.4/ … (1275 chars)` |
| 66047 | rustc | 51109 | 51109 | 70839–70839 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name form_urlencoded --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/form_urlen … (800 chars)` |
| 66059 | rustc | 51109 | 51109 | 70839–72210 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name aho_corasick --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/aho-corasick- … (799 chars)` |
| 66110 | rustc | 51109 | 51109 | 70890–70890 | no |  | `none: seen only as a zombie, after it exited` |
| 66114 | rustc | 51109 | 51109 | 70940–70995 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name futures_channel --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-ch … (1269 chars)` |
| 66127 | rustc | 51109 | 51109 | 70940–71361 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hashbrown --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hashbrown-0.16.1 … (786 chars)` |
| 66131 | rustc | 51109 | 51109 | 70940–71305 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name erased_serde --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/erased-serde- … (955 chars)` |
| 66137 | rustc | 51109 | 51109 | 70995–73347 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name time --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/time-0.3.51/src/lib.r … (3581 chars)` |
| 66157 | rustc | 51109 | 51109 | 71053–71053 | no |  | `none: seen only as a zombie, after it exited` |
| 66173 | rustc | 51109 | 51109 | 71053–71053 | no |  | `none: seen only as a zombie, after it exited` |
| 66206 | rustc | 51109 | 51109 | 71103–74723 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name brotli --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/brotli-9.0.0/src/li … (1358 chars)` |
| 66224 | rustc | 51109 | 51109 | 71103–71153 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cipher --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cipher-0.4.4/src/li … (870 chars)` |
| 66277 | rustc | 51109 | 51109 | 71204–71204 | no |  | `none: seen only as a zombie, after it exited` |
| 66295 | rustc | 51109 | 51109 | 71204–71361 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name aes --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/aes-0.8.4/src/lib.rs - … (943 chars)` |
| 66311 | rustc | 51109 | 51109 | 71254–71254 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name polyval --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/polyval-0.6.2/src/ … (1067 chars)` |
| 66352 | (unknown) | 51109 | 51109 | 71361–71361 | no |  | `none: seen only as a zombie, with no name` |
| 66397 | rustc | 51109 | 51109 | 71411–71411 | no |  | `none: seen only as a zombie, after it exited` |
| 66426 | rustc | 51109 | 51109 | 71411–71829 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name indexmap --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/indexmap-2.11.4/s … (1006 chars)` |
| 66467 | rustc | 51109 | 51109 | 71411–71469 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name aead --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/aead-0.5.2/src/lib.rs … (1038 chars)` |
| 66489 | rustc | 51109 | 51109 | 71469–71469 | no |  | `none: seen only as a zombie, after it exited` |
| 66510 | rustc | 51109 | 51109 | 71469–71520 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name form_urlencoded --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/form_urlen … (867 chars)` |
| 66518 | rustc | 51109 | 51109 | 71520–71520 | no |  | `none: seen only as a zombie, after it exited` |
| 66521 | rustc | 51109 | 51109 | 71520–71520 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name aes_gcm --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/aes-gcm-0.10.3/src … (1399 chars)` |
| 66522 | rustc | 51109 | 51109 | 71520–71674 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crossbe … (903 chars)` |
| 66540 | rustc | 51109 | 51109 | 71570–77781 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zlib_rs --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zlib-rs-0.5.0/src/ … (864 chars)` |
| 66544 | rustc | 51109 | 51109 | 71570–73239 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name aho_corasick --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/aho-corasick- … (866 chars)` |
| 66548 | rustc | 51109 | 51109 | 71622–71725 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name num_integer --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-integer-0. … (822 chars)` |
| 66570 | clang | 51109 | 66522 | 71622–71674 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/crossbeam-utils-1835ea1e104751c0/rustc87tI96/symbols.o /private/tmp/c335/tauri/target/debug/build/crossbeam … (3269 chars)` |
| 66585 | ld | 51109 | 66570 | 71674–71674 | no |  | `none: seen only as a zombie, after it exited` |
| 66599 | rustc | 51109 | 51109 | 71674–71829 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name flate2 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/flate2-1.1.1/src/li … (1133 chars)` |
| 66635 | build-script-bui | 51109 | 51109 | 71725–71725 | no |  | `none: seen only as a zombie, after it exited` |
| 66723 | rustc | 51109 | 51109 | 71776–72108 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name crossbeam_utils --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crossbeam- … (983 chars)` |
| 66739 | rustc | 51109 | 51109 | 71829–71931 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name parking_lot_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/parking_l … (1010 chars)` |
| 66796 | rustc | 51109 | 51109 | 71931–75301 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name regex_automata --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/regex-autom … (2076 chars)` |
| 66803 | rustc | 51109 | 51109 | 71931–71931 | no |  | `none: seen only as a zombie, after it exited` |
| 66838 | rustc | 51109 | 51109 | 71982–72159 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name parking_lot --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/parking_lot-0. … (1004 chars)` |
| 66839 | rustc | 51109 | 51109 | 71982–73887 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name winnow --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/winnow-0.7.14/src/l … (2929 chars)` |
| 66895 | rustc | 51109 | 51109 | 72159–72210 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name digest --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/digest-0.10.7/src/l … (1053 chars)` |
| 66927 | rustc | 51109 | 51109 | 72210–73087 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name png --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/png-0.17.16/src/lib.rs … (1194 chars)` |
| 66947 | rustc | 51109 | 51109 | 72210–72314 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crossbe … (924 chars)` |
| 66962 | rustc | 51109 | 51109 | 72262–72365 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name sha2 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sha2-0.10.8/src/lib.r … (1073 chars)` |
| 66979 | rustc | 51109 | 51109 | 72262–73502 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name png --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/png-0.18.1/src/lib.rs  … (1204 chars)` |
| 67017 | clang | 51109 | 66947 | 72314–72314 | no |  | `none: seen only as a zombie, after it exited` |
| 67026 | ld | 51109 | 67017 | 72314–72314 | no |  | `none: seen only as a zombie, after it exited` |
| 67054 | rustc | 51109 | 51109 | 72417–72777 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml_parser --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_parser-1. … (3064 chars)` |
| 67056 | build-script-bui | 51109 | 51109 | 72417–72417 | no |  | `none: seen only as a zombie, after it exited` |
| 67105 | rustc | 51109 | 51109 | 72468–72623 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name core_foundation --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/core-found … (1000 chars)` |
| 67112 | rustc | 51109 | 51109 | 72468–72468 | no |  | `none: seen only as a zombie, after it exited` |
| 67129 | rustc | 51109 | 51109 | 72520–77936 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name regex_automata --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/regex-autom … (2233 chars)` |
| 67187 | rustc | 51109 | 51109 | 72675–72930 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name synstructure --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/synstructure- … (966 chars)` |
| 67245 | rustc | 51109 | 51109 | 72827–75139 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name darling_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/darling_core- … (1180 chars)` |
| 67476 | rustc | 51109 | 51109 | 72986–73554 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_derive_internals --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ser … (908 chars)` |
| 67519 | rustc | 51109 | 51109 | 73137–74250 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml-1.0.6+spec-1.1.0 … (3677 chars)` |
| 67617 | rustc | 51109 | 51109 | 73293–73730 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ico --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ico-0.5.0/src/lib.rs - … (830 chars)` |
| 67671 | rustc | 51109 | 51109 | 73399–74352 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name time_macros --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/time-macros-0. … (3207 chars)` |
| 67824 | rustc | 51109 | 51109 | 73554–73730 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name objc2_encode --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2-encode- … (959 chars)` |
| 67864 | rustc | 51109 | 51109 | 73626–76336 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_derive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_derive- … (983 chars)` |
| 67875 | rustc | 51109 | 51109 | 73626–73943 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zeroize_derive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zeroize_der … (928 chars)` |
| 67943 | rustc | 51109 | 51109 | 73782–74775 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name thiserror_impl --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/thiserror-i … (929 chars)` |
| 67945 | rustc | 51109 | 51109 | 73782–74508 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zerofrom_derive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerofrom-d … (1032 chars)` |
| 67995 | clang | 51109 | 67875 | 73887–73943 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustc26OJgq/list /private/tmp/c335/tauri/target/debug/deps/rustc26OJgq/symbol … (4117 chars)` |
| 67998 | ld | 51109 | 67995 | 73943–73943 | no |  | `none: seen only as a zombie, after it exited` |
| 68027 | rustc | 51109 | 51109 | 73943–74669 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name yoke_derive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/yoke-derive-0. … (2456 chars)` |
| 68032 | rustc | 51109 | 51109 | 73994–74096 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zeroize --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zeroize-1.8.1/src/ … (937 chars)` |
| 68100 | rustc | 51109 | 51109 | 74148–74508 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name displaydoc --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/displaydoc-0.2. … (980 chars)` |
| 68163 | rustc | 51109 | 51109 | 74302–75139 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zerovec_derive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerovec-der … (2361 chars)` |
| 68182 | clang | 51109 | 67671 | 74302–74352 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcMGcYib/list /private/tmp/c335/tauri/target/debug/deps/rustcMGcYib/symbol … (4623 chars)` |
| 68199 | ld | 51109 | 68182 | 74352–74352 | no |  | `none: seen only as a zombie, after it exited` |
| 68276 | rustc | 51109 | 51109 | 74403–74775 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name generic_array --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/generic-arra … (959 chars)` |
| 68354 | clang | 51109 | 67945 | 74455–74508 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustc1PlRx8/list /private/tmp/c335/tauri/target/debug/deps/rustc1PlRx8/symbol … (5309 chars)` |
| 68377 | xcrun | 51109 | 68100 | 74455–74455 | no |  | `none: seen only as a zombie, after it exited` |
| 68391 | ld | 51109 | 68354 | 74455–74508 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (5472 chars)` |
| 68392 | clang | 51109 | 68100 | 74508–74508 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcW4aEEK/list /private/tmp/c335/tauri/target/debug/deps/rustcW4aEEK/symbol … (4199 chars)` |
| 68409 | ld | 51109 | 68392 | 74508–74508 | no |  | `none: seen only as a zombie, after it exited` |
| 68469 | rustc | 51109 | 51109 | 74566–74669 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zerofrom --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerofrom-0.1.5/sr … (811 chars)` |
| 68506 | xcrun | 51109 | 68027 | 74566–74566 | no |  | `none: seen only as a zombie, after it exited` |
| 68522 | rustc | 51109 | 51109 | 74616–75035 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name phf_macros --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf_macros-0.13 … (1167 chars)` |
| 68524 | clang | 51109 | 68027 | 74616–74616 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustc3uF3FR/list /private/tmp/c335/tauri/target/debug/deps/rustc3uF3FR/symbol … (5091 chars)` |
| 68526 | ld | 51109 | 68524 | 74616–74616 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (5254 chars)` |
| 68537 | xcrun | 51109 | 67943 | 74669–74669 | no |  | `none: seen only as a zombie, after it exited` |
| 68553 | rustc | 51109 | 51109 | 74723–74831 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name yoke --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/yoke-0.8.1/src/lib.rs … (1051 chars)` |
| 68558 | clang | 51109 | 67943 | 74723–74723 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustch6lc1t/list /private/tmp/c335/tauri/target/debug/deps/rustch6lc1t/symbol … (4834 chars)` |
| 68559 | rustc | 51109 | 51109 | 74723–75619 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name thiserror_impl --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/thiserror-i … (929 chars)` |
| 68560 | ld | 51109 | 68558 | 74723–74723 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (4997 chars)` |
| 68570 | rustc | 51109 | 51109 | 74775–74775 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name crypto_common --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crypto-commo … (1059 chars)` |
| 68572 | rustc | 51109 | 51109 | 74831–74880 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name thiserror --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/thiserror-2.0.12 … (954 chars)` |
| 68574 | rustc | 51109 | 51109 | 74831–74983 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cssparser_macros --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cssparser … (828 chars)` |
| 68584 | rustc | 51109 | 51109 | 74880–75301 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name derive_more_impl --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/derive_mo … (1368 chars)` |
| 68590 | rustc | 51109 | 51109 | 74880–75139 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zerotrie --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerotrie-0.2.3/sr … (1059 chars)` |
| 68599 | clang | 51109 | 68574 | 74932–74983 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcFMGLmM/list /private/tmp/c335/tauri/target/debug/deps/rustcFMGLmM/symbol … (3890 chars)` |
| 68603 | xcrun | 51109 | 68522 | 74932–74932 | no |  | `none: seen only as a zombie, after it exited` |
| 68605 | rustc | 51109 | 51109 | 74932–75723 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name schemars_derive --edition=2021 /Users/cjwilliams/.cargo/git/checkouts/schemars-756e8af8bf64fdcc/d949e78/schemars … (1048 chars)` |
| 68607 | ld | 51109 | 68599 | 74983–74983 | no |  | `none: seen only as a zombie, after it exited` |
| 68609 | clang | 51109 | 68522 | 74983–75035 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustclR3mlz/list /private/tmp/c335/tauri/target/debug/deps/rustclR3mlz/symbol … (4622 chars)` |
| 68612 | ld | 51109 | 68609 | 74983–75035 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (4785 chars)` |
| 68616 | rustc | 51109 | 51109 | 75035–75194 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serialize_to_javascript_impl --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b55 … (956 chars)` |
| 68633 | rustc | 51109 | 51109 | 75087–75194 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name phf --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf-0.13.1/src/lib.rs  … (1005 chars)` |
| 68634 | clang | 51109 | 68163 | 75087–75139 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcFHPj1J/list /private/tmp/c335/tauri/target/debug/deps/rustcFHPj1J/symbol … (4477 chars)` |
| 68640 | ld | 51109 | 68634 | 75087–75139 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (4640 chars)` |
| 68672 | xcrun | 51109 | 68616 | 75139–75139 | no |  | `none: seen only as a zombie, after it exited` |
| 68678 | clang | 51109 | 68616 | 75194–75194 | no |  | `none: seen only as a zombie, after it exited` |
| 68680 | rustc | 51109 | 51109 | 75194–75619 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tokio_macros --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-macros- … (924 chars)` |
| 68696 | ld | 51109 | 68678 | 75194–75194 | no |  | `none: seen only as a zombie, after it exited` |
| 68697 | rustc | 51109 | 51109 | 75194–75671 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zerovec --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerovec-0.11.5/src … (1047 chars)` |
| 68701 | rustc | 51109 | 51109 | 75194–75362 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name darling_macro --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/darling_macr … (929 chars)` |
| 68719 | clang | 51109 | 68584 | 75245–75245 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcHJVhWR/list /private/tmp/c335/tauri/target/debug/deps/rustcHJVhWR/symbol … (4013 chars)` |
| 68721 | rustc | 51109 | 51109 | 75245–75926 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name web_atoms --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/web_atoms-0.2.3/ … (844 chars)` |
| 68723 | rustc | 51109 | 51109 | 75245–76025 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cssparser --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cssparser-0.37.0 … (1323 chars)` |
| 68725 | ld | 51109 | 68719 | 75245–75245 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (4176 chars)` |
| 68734 | clang | 51109 | 68701 | 75301–75362 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcsYXq50/list /private/tmp/c335/tauri/target/debug/deps/rustcsYXq50/symbol … (4110 chars)` |
| 68746 | rustc | 51109 | 51109 | 75362–75413 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name derive_more --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/derive_more-2. … (1231 chars)` |
| 68766 | ld | 51109 | 68734 | 75362–75362 | no |  | `none: seen only as a zombie, after it exited` |
| 68767 | rustc | 51109 | 51109 | 75362–75568 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name regex --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/regex-1.11.1/src/lib … (1823 chars)` |
| 68815 | rustc | 51109 | 51109 | 75413–75467 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name darling --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/darling-0.23.0/src … (968 chars)` |
| 68847 | rustc | 51109 | 51109 | 75467–75824 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name futures_macro --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-macr … (1097 chars)` |
| 68894 | rustc | 51109 | 51109 | 75517–76181 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_with_macros --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_wi … (1718 chars)` |
| 68901 | xcrun | 51109 | 68680 | 75517–75517 | no |  | `none: seen only as a zombie, after it exited` |
| 68915 | clang | 51109 | 68680 | 75568–75568 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcnVAZak/list /private/tmp/c335/tauri/target/debug/deps/rustcnVAZak/symbol … (4104 chars)` |
| 68932 | ld | 51109 | 68915 | 75568–75568 | no |  | `none: seen only as a zombie, after it exited` |
| 68951 | xcrun | 51109 | 68559 | 75568–75568 | no |  | `none: seen only as a zombie, after it exited` |
| 68953 | clang | 51109 | 68559 | 75619–75619 | no |  | `none: seen only as a zombie, after it exited` |
| 68969 | rustc | 51109 | 51109 | 75619–75619 | no |  | `none: seen only as a zombie, after it exited` |
| 68970 | ld | 51109 | 68953 | 75619–75619 | no |  | `none: seen only as a zombie, after it exited` |
| 69016 | rustc | 51109 | 51109 | 75671–75723 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tinystr --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tinystr-0.8.2/src/ … (922 chars)` |
| 69039 | rustc | 51109 | 51109 | 75671–75723 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name potential_utf --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/potential_ut … (841 chars)` |
| 69041 | clang | 51109 | 68605 | 75671–75723 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustc09YwUT/list /private/tmp/c335/tauri/target/debug/deps/rustc09YwUT/symbol … (4944 chars)` |
| 69067 | ld | 51109 | 69041 | 75671–75671 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (5107 chars)` |
| 69082 | rustc | 51109 | 51109 | 75671–75774 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name thiserror --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/thiserror-1.0.69 … (849 chars)` |
| 69127 | rustc | 51109 | 51109 | 75723–82161 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tokio --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-1.45.1/src/lib … (2158 chars)` |
| 69146 | rustc | 51109 | 51109 | 75774–76653 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name icu_locale_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_locale … (1203 chars)` |
| 69147 | rustc | 51109 | 51109 | 75774–76126 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name icu_collections --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_collec … (1172 chars)` |
| 69162 | rustc | 51109 | 51109 | 75774–75824 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name digest --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/digest-0.10.7/src/l … (1373 chars)` |
| 69168 | clang | 51109 | 68847 | 75774–75824 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustc3mwwjy/list /private/tmp/c335/tauri/target/debug/deps/rustc3mwwjy/symbol … (4229 chars)` |
| 69188 | ld | 51109 | 69168 | 75824–75824 | no |  | `none: seen only as a zombie, after it exited` |
| 69190 | rustc | 51109 | 51109 | 75824–76807 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name selectors --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/selectors-0.38.0 … (1647 chars)` |
| 69206 | rustc | 51109 | 51109 | 75875–78824 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name futures_util --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-util- … (2547 chars)` |
| 69212 | rustc | 51109 | 51109 | 75875–75926 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name block_padding --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/block-paddin … (771 chars)` |
| 69220 | rustc | 51109 | 51109 | 75976–76076 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name markup5ever --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/markup5ever-0. … (936 chars)` |
| 69222 | rustc | 51109 | 51109 | 75976–76025 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name inout --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/inout-0.1.3/src/lib. … (907 chars)` |
| 69229 | rustc | 51109 | 51109 | 76076–76807 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name html5ever --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/html5ever-0.39.0 … (866 chars)` |
| 69233 | rustc | 51109 | 51109 | 76076–76491 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zerocopy_derive --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerocopy-d … (931 chars)` |
| 69238 | xcrun | 51109 | 68894 | 76076–76076 | no |  | `none: seen only as a zombie, after it exited` |
| 69240 | clang | 51109 | 68894 | 76126–76181 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustclLG3BY/list /private/tmp/c335/tauri/target/debug/deps/rustclLG3BY/symbol … (4826 chars)` |
| 69241 | rustc | 51109 | 51109 | 76126–76181 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cipher --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cipher-0.4.4/src/li … (965 chars)` |
| 69243 | ld | 51109 | 69240 | 76126–76181 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (4989 chars)` |
| 69249 | rustc | 51109 | 51109 | 76181–76390 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name regex --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/regex-1.11.1/src/lib … (1823 chars)` |
| 69266 | rustc | 51109 | 51109 | 76232–78251 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_with --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_with-3.21 … (1891 chars)` |
| 69269 | rustc | 51109 | 51109 | 76232–78666 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name time --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/time-0.3.51/src/lib.r … (3965 chars)` |
| 69377 | clang | 51109 | 67864 | 76336–76336 | no |  | `none: seen only as a zombie, after it exited` |
| 69423 | ld | 51109 | 69377 | 76336–76336 | no |  | `none: seen only as a zombie, after it exited` |
| 69471 | rustc | 51109 | 51109 | 76390–76859 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.228/src/li … (1485 chars)` |
| 69501 | clang | 51109 | 69233 | 76440–76491 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcV1oppD/list /private/tmp/c335/tauri/target/debug/deps/rustcV1oppD/symbol … (4370 chars)` |
| 69502 | rustc | 51109 | 51109 | 76491–76548 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name icu_provider --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_provider- … (1500 chars)` |
| 69503 | ld | 51109 | 69501 | 76491–76491 | no |  | `none: seen only as a zombie, after it exited` |
| 69525 | rustc | 51109 | 51109 | 76548–76910 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.228/src/li … (1423 chars)` |
| 69530 | rustc | 51109 | 51109 | 76653–77731 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name icu_properties --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_propert … (1414 chars)` |
| 69540 | rustc | 51109 | 51109 | 76705–77013 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name icu_normalizer --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_normali … (1398 chars)` |
| 69553 | rustc | 51109 | 51109 | 76859–77220 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name icu_normalizer --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_normali … (1398 chars)` |
| 69559 | rustc | 51109 | 51109 | 76910–78410 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name dom_query --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dom_query-0.28.0 … (1776 chars)` |
| 69575 | rustc | 51109 | 51109 | 76910–77506 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zerocopy --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerocopy-0.7.35/s … (1120 chars)` |
| 69608 | rustc | 51109 | 51109 | 76962–77283 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_test_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sw … (973 chars)` |
| 69661 | rustc | 51109 | 51109 | 77065–77170 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name uuid --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/uuid-1.11.0/src/lib.r … (1139 chars)` |
| 69700 | xcrun | 51109 | 69608 | 77220–77220 | no |  | `none: seen only as a zombie, after it exited` |
| 69702 | rustc | 51109 | 51109 | 77220–77936 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cfb --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cfb-0.14.0/src/lib.rs  … (909 chars)` |
| 69704 | clang | 51109 | 69608 | 77283–77283 | no |  | `none: seen only as a zombie, after it exited` |
| 69707 | ld | 51109 | 69704 | 77283–77283 | no |  | `none: seen only as a zombie, after it exited` |
| 69722 | rustc | 51109 | 51109 | 77283–77441 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cargo_platform --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cargo-platf … (991 chars)` |
| 69725 | build-script-test-build | 51109 | 51109 | 77334–77334 | no |  | `/private/tmp/c335/tauri/target/debug/build/swift-rs-9ad8ba9f64a6e30b/build-script-test-build` |
| 69789 | rustc | 51109 | 51109 | 77386–77579 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name camino --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/camino-1.1.9/src/li … (1162 chars)` |
| 69799 | rustc | 51109 | 51109 | 77506–77884 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name indexmap --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/indexmap-1.9.3/sr … (1041 chars)` |
| 69823 | rustc | 51109 | 51109 | 77579–77628 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name idna_adapter --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/idna_adapter- … (918 chars)` |
| 69826 | rustc | 51109 | 51109 | 77628–77992 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name jsonptr --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jsonptr-0.7.1/src/ … (1083 chars)` |
| 69831 | rustc | 51109 | 51109 | 77681–77992 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name idna --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/idna-1.1.0/src/lib.rs … (1009 chars)` |
| 69891 | rustc | 51109 | 51109 | 77781–77831 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name idna_adapter --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/idna_adapter- … (918 chars)` |
| 69946 | rustc | 51109 | 51109 | 77884–78565 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name url --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/url-2.5.8/src/lib.rs - … (1274 chars)` |
| 69969 | rustc | 51109 | 51109 | 77884–78197 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name infer --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/infer-0.22.0/src/lib … (849 chars)` |
| 70036 | rustc | 51109 | 51109 | 77936–78251 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name json_patch --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/json-patch-4.2. … (1117 chars)` |
| 70099 | rustc | 51109 | 51109 | 77992–79459 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cargo_metadata --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cargo_metad … (1312 chars)` |
| 70105 | rustc | 51109 | 51109 | 77992–78302 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name swift_rs --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/swift-rs-1.0.8/sr … (1069 chars)` |
| 70120 | rustc | 51109 | 51109 | 78044–78095 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_untagged --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-untag … (946 chars)` |
| 70136 | rustc | 51109 | 51109 | 78095–78927 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name plist --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/plist-1.10.0/src/lib … (1237 chars)` |
| 70153 | rustc | 51109 | 51109 | 78146–78251 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serialize_to_javascript --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/se … (1004 chars)` |
| 70162 | rustc | 51109 | 51109 | 78251–78666 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name idna --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/idna-1.1.0/src/lib.rs … (1076 chars)` |
| 70169 | rustc | 51109 | 51109 | 78302–79828 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name schemars --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/schemars-0.8.22/s … (1897 chars)` |
| 70182 | rustc | 51109 | 51109 | 78302–79193 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name urlpattern --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/urlpattern-0.6. … (1025 chars)` |
| 70183 | rustc | 51109 | 51109 | 78302–78358 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name libz_rs_sys --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libz-rs-sys-0. … (920 chars)` |
| 70206 | rustc | 51109 | 51109 | 78358–78410 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name embed_resource --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/embed-resou … (1029 chars)` |
| 70234 | rustc | 51109 | 51109 | 78410–78616 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name flate2 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/flate2-1.1.1/src/li … (1354 chars)` |
| 70256 | rustc | 51109 | 51109 | 78462–79137 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name url --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/url-2.5.8/src/lib.rs - … (1274 chars)` |
| 70260 | rustc | 51109 | 51109 | 78515–78616 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name crossbeam_epoch --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crossbeam- … (1093 chars)` |
| 70353 | rustc | 51109 | 51109 | 78666–79981 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name num_bigint --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-bigint-0.4. … (959 chars)` |
| 70355 | rustc | 51109 | 51109 | 78666–78666 | no |  | `none: seen only as a zombie, after it exited` |
| 70356 | rustc | 51109 | 51109 | 78721–78772 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2-e … (1077 chars)` |
| 70361 | rustc | 51109 | 51109 | 78721–78772 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name arrayvec --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/arrayvec-0.7.6/sr … (740 chars)` |
| 70362 | rustc | 51109 | 51109 | 78721–78772 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name dirs --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dirs-7.0.0/src/lib.rs … (738 chars)` |
| 70364 | rustc | 51109 | 51109 | 78772–78772 | no |  | `none: seen only as a zombie, after it exited` |
| 70370 | clang | 51109 | 70356 | 78772–78772 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/objc2-exception-helper-389f303046d20c3a/rustc0plLqr/symbols.o /private/tmp/c335/tauri/target/debug/build/ob … (3524 chars)` |
| 70388 | ld | 51109 | 70370 | 78772–78772 | no |  | `none: seen only as a zombie, after it exited` |
| 70390 | rustc | 51109 | 51109 | 78824–79030 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_winres --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-winres- … (942 chars)` |
| 70406 | rustc | 51109 | 51109 | 78824–81748 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cargo_toml --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cargo_toml-1.0. … (939 chars)` |
| 70408 | rustc | 51109 | 51109 | 78877–78978 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name semver --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/semver-1.0.28/src/l … (833 chars)` |
| 70424 | build-script-build | 51109 | 51109 | 78877–79193 | no |  | `/private/tmp/c335/tauri/target/debug/build/objc2-exception-helper-389f303046d20c3a/build-script-build` |
| 70453 | rustc | 51109 | 51109 | 78927–79030 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustver … (647 chars)` |
| 70474 | clang | 51109 | 70424 | 78978–78978 | no |  | `none: seen only as a zombie, after it exited` |
| 70476 | rustc | 51109 | 51109 | 79030–79137 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/httpars … (898 chars)` |
| 70484 | rustc | 51109 | 51109 | 79030–79193 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ucd_trie --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ucd-trie-0.1.7/sr … (687 chars)` |
| 70491 | clang | 51109 | 70453 | 79030–79030 | no |  | `none: seen only as a zombie, after it exited` |
| 70509 | ld | 51109 | 70491 | 79030–79030 | no |  | `none: seen only as a zombie, after it exited` |
| 70513 | clang | 51109 | 70424 | 79030–79030 | no |  | `none: seen only as a zombie, after it exited` |
| 70523 | ar | 51109 | 70424 | 79083–79137 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ar cq /private/tmp/c335/tauri/target/debug/build/objc2-exception-helper-89e19b072ac050e5/out/libobjc2_exception_helper_0_1.a /private/tmp/c335/tauri/target/ … (284 chars)` |
| 70524 | rustc | 51109 | 51109 | 79083–79137 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rayon-c … (654 chars)` |
| 70525 | build-script-build | 51109 | 51109 | 79083–79137 | no |  | `/private/tmp/c335/tauri/target/debug/build/rustversion-0e550b460632e4a6/build-script-build` |
| 70543 | clang | 51109 | 70524 | 79137–79137 | no |  | `none: seen only as a zombie, after it exited` |
| 70546 | clang | 51109 | 70476 | 79137–79137 | no |  | `none: seen only as a zombie, after it exited` |
| 70548 | libtool | 51109 | 70523 | 79137–79137 | no |  | `none: seen only as a zombie, after it exited` |
| 70549 | ld | 51109 | 70543 | 79137–79137 | no |  | `none: seen only as a zombie, after it exited` |
| 70550 | ld | 51109 | 70546 | 79137–79137 | no |  | `none: seen only as a zombie, after it exited` |
| 70551 | rustc | 51109 | 70525 | 79137–79137 | no |  | `none: seen only as a zombie, after it exited` |
| 70554 | rustc | 51109 | 51109 | 79193–79193 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name either --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/either-1.13.0/src/l … (701 chars)` |
| 70556 | rustc | 51109 | 51109 | 79193–79306 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2-0 … (1606 chars)` |
| 70561 | ar | 51109 | 70424 | 79193–79193 | no |  | `none: seen only as a zombie, after it exited` |
| 70562 | rustc | 51109 | 51109 | 79193–79358 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustix- … (2029 chars)` |
| 70563 | libtool | 51109 | 70561 | 79193–79193 | no |  | `none: seen only as a zombie, after it exited` |
| 70565 | build-script-bui | 51109 | 51109 | 79245–79245 | no |  | `none: seen only as a zombie, after it exited` |
| 70570 | build-script-bui | 51109 | 51109 | 79245–79245 | no |  | `none: seen only as a zombie, after it exited` |
| 70586 | rustc | 51109 | 51109 | 79245–79511 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rustversion --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustversion-1. … (734 chars)` |
| 70593 | xcrun | 51109 | 70556 | 79245–79245 | no |  | `none: seen only as a zombie, after it exited` |
| 70594 | rustc | 51109 | 51109 | 79306–80614 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pest --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pest-2.7.15/src/lib.r … (1074 chars)` |
| 70597 | clang | 51109 | 70556 | 79306–79306 | no |  | `none: seen only as a zombie, after it exited` |
| 70598 | rustc | 51109 | 51109 | 79306–79776 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml_parser --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_parser-1. … (3131 chars)` |
| 70615 | ld | 51109 | 70597 | 79306–79306 | no |  | `none: seen only as a zombie, after it exited` |
| 70616 | rustc | 51109 | 51109 | 79306–95468 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_utils --edition=2024 crates/tauri-utils/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,art … (4574 chars)` |
| 70617 | rustc | 51109 | 51109 | 79306–79408 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name httparse --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/httparse-1.9.5/sr … (971 chars)` |
| 70637 | xcrun | 51109 | 70562 | 79306–79306 | no |  | `none: seen only as a zombie, after it exited` |
| 70655 | clang | 51109 | 70562 | 79358–79358 | no |  | `none: seen only as a zombie, after it exited` |
| 70656 | build-script-bui | 51109 | 51109 | 79358–79358 | no |  | `none: seen only as a zombie, after it exited` |
| 70659 | ld | 51109 | 70655 | 79358–79358 | no |  | `none: seen only as a zombie, after it exited` |
| 70663 | build-script-build | 51109 | 51109 | 79408–79459 | no |  | `/private/tmp/c335/tauri/target/debug/build/rustix-b7657e21162f229f/build-script-build` |
| 70665 | rustc | 51109 | 51109 | 79408–80287 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tracing_attributes --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tracing … (1036 chars)` |
| 70670 | rustc | 51109 | 51109 | 79459–79564 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml_datetime --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_datetim … (3147 chars)` |
| 70673 | rustc | 51109 | 70663 | 79459–79459 | no |  | `none: seen only as a zombie, after it exited` |
| 70680 | clang | 51109 | 70586 | 79511–79511 | no |  | `none: seen only as a zombie, after it exited` |
| 70688 | rustc | 51109 | 51109 | 79511–79511 | no |  | `none: seen only as a zombie, after it exited` |
| 70698 | ld | 51109 | 70680 | 79511–79511 | no |  | `none: seen only as a zombie, after it exited` |
| 70702 | rustc | 51109 | 51109 | 79564–79564 | no |  | `none: seen only as a zombie, after it exited` |
| 70725 | rustc | 51109 | 51109 | 79564–79981 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tracing_core --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tracing-core- … (930 chars)` |
| 70734 | rustc | 51109 | 51109 | 79564–79673 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name sha1_smol --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sha1_smol-1.0.1/ … (676 chars)` |
| 70748 | rustc | 51109 | 51109 | 79621–79673 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name minimal_lexical --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/minimal-le … (740 chars)` |
| 70754 | rustc | 51109 | 51109 | 79621–79673 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml_writer --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_writer-1. … (3044 chars)` |
| 70778 | rustc | 51109 | 51109 | 79724–81542 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name nom --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/nom-7.1.3/src/lib.rs - … (942 chars)` |
| 70779 | rustc | 51109 | 51109 | 79724–79880 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name uuid --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/uuid-1.11.0/src/lib.r … (1319 chars)` |
| 70785 | rustc | 51109 | 51109 | 79776–81336 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rustix --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustix-1.0.7/src/li … (2379 chars)` |
| 70805 | rustc | 51109 | 51109 | 79828–81179 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name objc2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2-0.6.4/src/lib. … (2015 chars)` |
| 70808 | rustc | 51109 | 51109 | 79880–80339 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rayon_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rayon-core-1.13 … (889 chars)` |
| 70872 | rustc | 51109 | 51109 | 79932–79981 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ppv_lite86 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ppv-lite86-0.2. … (827 chars)` |
| 70959 | rustc | 51109 | 51109 | 80031–81179 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml-1.0.6+spec-1.1.0 … (3846 chars)` |
| 70960 | rustc | 51109 | 51109 | 80031–80717 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name plist --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/plist-1.10.0/src/lib … (1237 chars)` |
| 70961 | rustc | 51109 | 51109 | 80031–80080 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name string_cache --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/string_cache- … (1136 chars)` |
| 71027 | rustc | 51109 | 51109 | 80182–80182 | no |  | `none: seen only as a zombie, after it exited` |
| 71062 | rustc | 51109 | 51109 | 80233–80287 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bumpalo --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bumpalo-3.16.0/src … (758 chars)` |
| 71070 | xcrun | 51109 | 70665 | 80233–80233 | no |  | `none: seen only as a zombie, after it exited` |
| 71071 | clang | 51109 | 70665 | 80287–80287 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcQhZtZH/list /private/tmp/c335/tauri/target/debug/deps/rustcQhZtZH/symbol … (5051 chars)` |
| 71084 | ld | 51109 | 71071 | 80287–80287 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (5214 chars)` |
| 71094 | rustc | 51109 | 51109 | 80339–82778 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rayon --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rayon-1.12.0/src/lib … (851 chars)` |
| 71097 | rustc | 51109 | 51109 | 80391–80500 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tracing --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tracing-0.1.41/src … (1644 chars)` |
| 71100 | rustc | 51109 | 51109 | 80391–80872 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name web_atoms --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/web_atoms-0.2.3/ … (844 chars)` |
| 71130 | rustc | 51109 | 51109 | 80614–81953 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pest_meta --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pest_meta-2.7.15 … (870 chars)` |
| 71163 | rustc | 51109 | 51109 | 80665–81079 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tokio_util --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-util-0.7. … (1514 chars)` |
| 71204 | rustc | 51109 | 51109 | 80769–81129 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name num_rational --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-rational- … (1117 chars)` |
| 71218 | rustc | 51109 | 51109 | 80924–80924 | no |  | `none: seen only as a zombie, after it exited` |
| 71248 | rustc | 51109 | 51109 | 81026–81079 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bytemuck --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bytemuck-1.25.0/s … (1286 chars)` |
| 71318 | rustc | 51109 | 51109 | 81129–82368 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name objc2_core_foundation --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc … (2541 chars)` |
| 71320 | rustc | 51109 | 51109 | 81129–81230 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name block2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/block2-0.6.2/src/li … (1332 chars)` |
| 71354 | rustc | 51109 | 51109 | 81179–81230 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name polyval --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/polyval-0.6.2/src/ … (1067 chars)` |
| 71372 | rustc | 51109 | 51109 | 81230–81336 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name markup5ever --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/markup5ever-0. … (936 chars)` |
| 71378 | rustc | 51109 | 51109 | 81230–82057 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cssparser --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cssparser-0.37.0 … (1323 chars)` |
| 71393 | rustc | 51109 | 51109 | 81284–81284 | no |  | `none: seen only as a zombie, after it exited` |
| 71397 | rustc | 51109 | 51109 | 81284–82005 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cfb --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cfb-0.14.0/src/lib.rs  … (909 chars)` |
| 71417 | rustc | 51109 | 51109 | 81336–82368 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name html5ever --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/html5ever-0.39.0 … (866 chars)` |
| 71420 | rustc | 51109 | 51109 | 81387–81799 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pest_generator --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pest_genera … (1177 chars)` |
| 71422 | rustc | 51109 | 51109 | 81387–81542 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name camino --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/camino-1.1.9/src/li … (1162 chars)` |
| 71441 | rustc | 51109 | 51109 | 81594–81799 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name indexmap --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/indexmap-1.9.3/sr … (1041 chars)` |
| 71446 | rustc | 51109 | 51109 | 81644–81953 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name jsonptr --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jsonptr-0.7.1/src/ … (1083 chars)` |
| 71473 | rustc | 51109 | 51109 | 81799–81902 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cargo_platform --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cargo-platf … (991 chars)` |
| 71482 | rustc | 51109 | 51109 | 81850–81850 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ctr --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ctr-0.9.2/src/lib.rs - … (774 chars)` |
| 71512 | rustc | 51109 | 51109 | 81850–82983 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name selectors --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/selectors-0.38.0 … (1647 chars)` |
| 71547 | rustc | 51109 | 51109 | 81902–82161 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name aes --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/aes-0.8.4/src/lib.rs - … (943 chars)` |
| 71566 | rustc | 51109 | 51109 | 81953–81953 | no |  | `none: seen only as a zombie, after it exited` |
| 71600 | rustc | 51109 | 51109 | 82005–82111 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pest_derive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pest_derive-2. … (945 chars)` |
| 71603 | rustc | 51109 | 51109 | 82005–82368 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rustls_pki_types --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustls-pk … (935 chars)` |
| 71618 | rustc | 51109 | 51109 | 82057–82419 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name erased_serde --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/erased-serde- … (955 chars)` |
| 71637 | rustc | 51109 | 51109 | 82057–82264 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ring-0. … (1033 chars)` |
| 71660 | clang | 51109 | 71600 | 82111–82111 | no |  | `none: seen only as a zombie, after it exited` |
| 71675 | ld | 51109 | 71660 | 82111–82111 | no |  | `none: seen only as a zombie, after it exited` |
| 71692 | rustc | 51109 | 51109 | 82111–83749 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cargo_metadata --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cargo_metad … (1312 chars)` |
| 71738 | rustc | 51109 | 51109 | 82161–82983 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name json5 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/json5-0.4.1/src/lib. … (922 chars)` |
| 71764 | rustc | 51109 | 51109 | 82211–82211 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name aes_gcm --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/aes-gcm-0.10.3/src … (1399 chars)` |
| 71779 | clang | 51109 | 71637 | 82211–82264 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/ring-ec33e56c716178a6/rustcN1EOn3/symbols.o /private/tmp/c335/tauri/target/debug/build/ring-ec33e56c716178a … (3752 chars)` |
| 71780 | rustc | 51109 | 51109 | 82211–82624 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name infer --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/infer-0.22.0/src/lib … (849 chars)` |
| 71794 | ld | 51109 | 71779 | 82264–82264 | no |  | `none: seen only as a zombie, after it exited` |
| 71814 | rustc | 51109 | 51109 | 82316–82624 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name json_patch --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/json-patch-4.2. … (1117 chars)` |
| 71830 | build-script-build | 51109 | 51109 | 82316–83918 | no |  | `/private/tmp/c335/tauri/target/debug/build/ring-ec33e56c716178a6/build-script-build` |
| 71860 | rustc | 51109 | 51109 | 82419–89475 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name objc2_foundation --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2-fou … (6315 chars)` |
| 71868 | rustc | 51109 | 51109 | 82419–83749 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name schemars --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/schemars-0.8.22/s … (1897 chars)` |
| 71878 | rustc | 51109 | 51109 | 82419–82471 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_untagged --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-untag … (946 chars)` |
| 71901 | clang | 51109 | 71830 | 82471–82521 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I /Users/cjw … (897 chars)` |
| 71918 | clang | 51109 | 71901 | 82471–82521 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -cc1 -triple arm64-apple-macosx27.0.0 -O0 -Wundef-prefix=TARGET_OS_ -Wdeprecated-objc-isa-usage -Werror=deprecated-objc-isa-usage -Werror=implicit-fun … (3989 chars)` |
| 71919 | rustc | 51109 | 51109 | 82521–83193 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name urlpattern --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/urlpattern-0.6. … (1025 chars)` |
| 71936 | rustc | 51109 | 51109 | 82573–83809 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name png --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/png-0.18.1/src/lib.rs  … (1204 chars)` |
| 71957 | clang | 51109 | 71830 | 82573–82573 | no |  | `none: seen only as a zombie, after it exited` |
| 71982 | cc | 51109 | 71830 | 82624–82624 | no |  | `none: seen only as a zombie, after it exited` |
| 71986 | rustc | 51109 | 51109 | 82675–82983 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name swift_rs --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/swift-rs-1.0.8/sr … (1069 chars)` |
| 72003 | rustc | 51109 | 51109 | 82675–82726 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serialize_to_javascript --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/se … (1004 chars)` |
| 72004 | clang | 51109 | 71830 | 82675–82675 | no |  | `none: seen only as a zombie, after it exited` |
| 72026 | clang | 51109 | 71830 | 82726–82726 | no |  | `none: seen only as a zombie, after it exited` |
| 72033 | clang | 51109 | 72026 | 82726–82726 | no |  | `none: seen only as a zombie, after it exited` |
| 72050 | rustc | 51109 | 51109 | 82778–84359 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name dom_query --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dom_query-0.28.0 … (1776 chars)` |
| 72071 | clang | 51109 | 71830 | 82778–82778 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I /Users/cjw … (896 chars)` |
| 72092 | rustc | 51109 | 51109 | 82828–84790 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_with --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_with-3.21 … (1891 chars)` |
| 72100 | cc | 51109 | 71830 | 82828–82828 | no |  | `none: seen only as a zombie, after it exited` |
| 72108 | clang | 51109 | 71830 | 82880–82880 | no |  | `none: seen only as a zombie, after it exited` |
| 72109 | clang | 51109 | 72108 | 82880–82880 | no |  | `none: seen only as a zombie, after it exited` |
| 72132 | clang | 51109 | 71830 | 82932–82932 | no |  | `none: seen only as a zombie, after it exited` |
| 72134 | clang | 51109 | 72132 | 82932–82932 | no |  | `none: seen only as a zombie, after it exited` |
| 72148 | clang | 51109 | 71830 | 83034–83034 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I /Users/cjw … (900 chars)` |
| 72149 | rustc | 51109 | 51109 | 83034–83034 | no |  | `none: seen only as a zombie, after it exited` |
| 72150 | clang | 51109 | 72148 | 83034–83034 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -cc1 -triple arm64-apple-macosx27.0.0 -O0 -Wundef-prefix=TARGET_OS_ -Wdeprecated-objc-isa-usage -Werror=deprecated-objc-isa-usage -Werror=implicit-fun … (3992 chars)` |
| 72155 | rustc | 51109 | 51109 | 83034–83086 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tower_layer --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tower-layer-0. … (657 chars)` |
| 72156 | rustc | 51109 | 51109 | 83034–83086 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name aligned_vec --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/aligned-vec-0. … (726 chars)` |
| 72158 | rustc | 51109 | 51109 | 83086–83141 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name base64ct --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/base64ct-1.6.0/sr … (687 chars)` |
| 72170 | clang | 51109 | 71830 | 83141–83141 | no |  | `none: seen only as a zombie, after it exited` |
| 72179 | rustc | 51109 | 51109 | 83141–83193 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name v_frame --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/v_frame-0.3.8/src/ … (893 chars)` |
| 72183 | rustc | 51109 | 51109 | 83141–83193 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name http_body_util --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/http-body-u … (1150 chars)` |
| 72185 | clang | 51109 | 72170 | 83141–83141 | no |  | `none: seen only as a zombie, after it exited` |
| 72259 | clang | 51109 | 71830 | 83193–83193 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I /Users/cjw … (930 chars)` |
| 72262 | rustc | 51109 | 51109 | 83193–83347 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pem_rfc7468 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pem-rfc7468-0. … (788 chars)` |
| 72272 | clang | 51109 | 72259 | 83193–83193 | no |  | `none: seen only as a zombie, after it exited` |
| 72357 | rustc | 51109 | 51109 | 83245–83296 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name sha1 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sha1-0.10.6/src/lib.r … (1058 chars)` |
| 72372 | rustc | 51109 | 51109 | 83245–83688 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name equator_macro --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/equator-macr … (926 chars)` |
| 72389 | cc | 51109 | 71830 | 83245–83245 | no |  | `none: seen only as a zombie, after it exited` |
| 72386 | rustc | 51109 | 51109 | 83296–83296 | no |  | `none: seen only as a zombie, after it exited` |
| 72402 | clang | 51109 | 71830 | 83296–83296 | no |  | `none: seen only as a zombie, after it exited` |
| 72407 | rustc | 51109 | 51109 | 83347–83451 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/av-scen … (1018 chars)` |
| 72413 | clang | 51109 | 71830 | 83347–83347 | no |  | `none: seen only as a zombie, after it exited` |
| 72454 | clang | 51109 | 71830 | 83399–83399 | no |  | `none: seen only as a zombie, after it exited` |
| 72455 | rustc | 51109 | 51109 | 83399–83524 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/paste-1 … (629 chars)` |
| 72463 | clang | 51109 | 72454 | 83399–83399 | no |  | `none: seen only as a zombie, after it exited` |
| 72464 | clang | 51109 | 72407 | 83451–83451 | no |  | `none: seen only as a zombie, after it exited` |
| 72465 | rustc | 51109 | 51109 | 83451–83524 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name unicode_width --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unicode-widt … (787 chars)` |
| 72469 | clang | 51109 | 71830 | 83451–83451 | no |  | `none: seen only as a zombie, after it exited` |
| 72471 | ld | 51109 | 72464 | 83451–83451 | no |  | `none: seen only as a zombie, after it exited` |
| 72473 | clang | 51109 | 72469 | 83451–83451 | no |  | `none: seen only as a zombie, after it exited` |
| 72486 | clang | 51109 | 72455 | 83524–83524 | no |  | `none: seen only as a zombie, after it exited` |
| 72487 | rustc | 51109 | 51109 | 83524–83524 | no |  | `none: seen only as a zombie, after it exited` |
| 72496 | ld | 51109 | 72486 | 83524–83524 | no |  | `none: seen only as a zombie, after it exited` |
| 72500 | clang | 51109 | 71830 | 83524–83524 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I /Users/cjw … (912 chars)` |
| 72511 | rustc | 51109 | 51109 | 83587–83587 | no |  | `none: seen only as a zombie, after it exited` |
| 72513 | rustc | 51109 | 51109 | 83587–83970 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name built --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/built-0.8.1/src/lib. … (668 chars)` |
| 72515 | rustc | 51109 | 51109 | 83587–83587 | no |  | `none: seen only as a zombie, after it exited` |
| 72520 | clang | 51109 | 71830 | 83587–83637 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I /Users/cjw … (908 chars)` |
| 72525 | rustc | 51109 | 51109 | 83637–83637 | no |  | `none: seen only as a zombie, after it exited` |
| 72532 | (unknown) | 51109 | 72520 | 83637–83637 | no |  | `none: seen only as a zombie, with no name` |
| 72533 | clang | 51109 | 72372 | 83637–83637 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcBW47mJ/list /private/tmp/c335/tauri/target/debug/deps/rustcBW47mJ/symbol … (3995 chars)` |
| 72534 | build-script-build | 51109 | 51109 | 83637–83688 | no |  | `/private/tmp/c335/tauri/target/debug/build/paste-5127cb17cfa53229/build-script-build` |
| 72535 | ld | 51109 | 72533 | 83637–83637 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (4158 chars)` |
| 72540 | clang | 51109 | 71830 | 83688–83688 | no |  | `none: seen only as a zombie, after it exited` |
| 72560 | clang | 51109 | 72540 | 83688–83688 | no |  | `none: seen only as a zombie, after it exited` |
| 72562 | rustc | 51109 | 51109 | 83688–88905 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name h2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/h2-0.4.17/src/lib.rs -- … (1741 chars)` |
| 72570 | rustc | 51109 | 72534 | 83688–83688 | no |  | `none: seen only as a zombie, after it exited` |
| 72579 | rustc | 51109 | 51109 | 83749–83918 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name equator --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/equator-0.4.2/src/ … (754 chars)` |
| 72600 | build-script-bui | 51109 | 51109 | 83749–83749 | no |  | `none: seen only as a zombie, after it exited` |
| 72641 | rustc | 51109 | 51109 | 83809–83809 | no |  | `none: seen only as a zombie, after it exited` |
| 72659 | rustc | 51109 | 51109 | 83809–83809 | no |  | `none: seen only as a zombie, after it exited` |
| 72667 | rustc | 51109 | 51109 | 83809–85266 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name der --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/der-0.7.9/src/lib.rs - … (1136 chars)` |
| 72706 | rustc | 51109 | 51109 | 83861–84359 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tower --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tower-0.5.2/src/lib. … (2101 chars)` |
| 72710 | clang | 51109 | 71830 | 83861–83861 | no |  | `none: seen only as a zombie, after it exited` |
| 72728 | rustc | 51109 | 51109 | 83861–84035 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name profiling_procmacros --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/profi … (960 chars)` |
| 72736 | rustc | 51109 | 51109 | 83918–84103 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name arg_enum_proc_macro --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/arg_en … (938 chars)` |
| 72759 | ar | 51109 | 71830 | 83918–83918 | no |  | `none: seen only as a zombie, after it exited` |
| 72763 | libtool | 51109 | 72759 | 83918–83918 | no |  | `none: seen only as a zombie, after it exited` |
| 72765 | rustc | 51109 | 51109 | 83970–85992 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ring --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ring-0.17.14/src/lib. … (1482 chars)` |
| 72774 | rustc | 51109 | 51109 | 83970–83970 | no |  | `none: seen only as a zombie, after it exited` |
| 72779 | clang | 51109 | 72728 | 83970–84035 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustctzGN0E/list /private/tmp/c335/tauri/target/debug/deps/rustctzGN0E/symbol … (3906 chars)` |
| 72783 | rustc | 51109 | 51109 | 84035–84103 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rav1e-0 … (1763 chars)` |
| 72784 | ld | 51109 | 72779 | 84035–84035 | no |  | `none: seen only as a zombie, after it exited` |
| 72789 | rustc | 51109 | 51109 | 84035–84103 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zune_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zune-core-0.5.1/ … (694 chars)` |
| 72796 | xcrun | 51109 | 72736 | 84035–84035 | no |  | `none: seen only as a zombie, after it exited` |
| 72802 | clang | 51109 | 72783 | 84103–84103 | no |  | `none: seen only as a zombie, after it exited` |
| 72803 | clang | 51109 | 72736 | 84103–84103 | no |  | `none: seen only as a zombie, after it exited` |
| 72806 | rustc | 51109 | 51109 | 84103–84154 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name y4m --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/y4m-0.8.0/src/lib.rs - … (641 chars)` |
| 72809 | ld | 51109 | 72802 | 84103–84103 | no |  | `none: seen only as a zombie, after it exited` |
| 72810 | ld | 51109 | 72803 | 84103–84103 | no |  | `none: seen only as a zombie, after it exited` |
| 72819 | rustc | 51109 | 51109 | 84154–84258 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-bi … (1095 chars)` |
| 72823 | rustc | 51109 | 51109 | 84154–84258 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name httpdate --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/httpdate-1.0.3/sr … (651 chars)` |
| 72828 | rustc | 51109 | 51109 | 84205–84478 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name weezl --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/weezl-0.1.12/src/lib … (757 chars)` |
| 72829 | rustc | 51109 | 51109 | 84205–84419 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pastey --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pastey-0.1.1/src/li … (640 chars)` |
| 72843 | xcrun | 51109 | 72819 | 84205–84205 | no |  | `none: seen only as a zombie, after it exited` |
| 72846 | clang | 51109 | 72819 | 84258–84258 | no |  | `none: seen only as a zombie, after it exited` |
| 72849 | ld | 51109 | 72846 | 84258–84258 | no |  | `none: seen only as a zombie, after it exited` |
| 72860 | build-script-build | 51109 | 51109 | 84309–84419 | no |  | `/private/tmp/c335/tauri/target/debug/build/rav1e-3cca06a65fb09554/build-script-build` |
| 72863 | build-script-build | 51109 | 51109 | 84309–84359 | no |  | `/private/tmp/c335/tauri/target/debug/build/wasm-bindgen-shared-67a38d696dd39d22/build-script-build` |
| 72892 | rustc | 51109 | 72860 | 84359–84359 | no |  | `none: seen only as a zombie, after it exited` |
| 72911 | rustdoc | 51109 | 72860 | 84419–84419 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustdoc -V` |
| 72912 | rustc | 51109 | 51109 | 84419–85105 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zune_jpeg --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zune-jpeg-0.5.15 … (939 chars)` |
| 72939 | clang | 51109 | 72829 | 84419–84419 | no |  | `none: seen only as a zombie, after it exited` |
| 72944 | rustc | 51109 | 51109 | 84419–84478 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name profiling --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/profiling-1.0.16 … (1111 chars)` |
| 72956 | rustc | 51109 | 51109 | 84419–84841 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bitstream_io --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bitstream-io- … (850 chars)` |
| 72958 | ld | 51109 | 72939 | 84419–84419 | no |  | `none: seen only as a zombie, after it exited` |
| 72983 | rustc | 51109 | 51109 | 84478–85105 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name av_scenechange --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/av-scenecha … (2173 chars)` |
| 73001 | rustc | 51109 | 51109 | 84534–84584 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name aligned_vec --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/aligned-vec-0. … (819 chars)` |
| 73002 | rustc | 51109 | 51109 | 84534–84739 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name paste --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/paste-1.0.15/src/lib … (734 chars)` |
| 73024 | rustc | 51109 | 51109 | 84534–85156 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name av1_grain --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/av1-grain-0.2.3/ … (1509 chars)` |
| 73146 | rustc | 51109 | 51109 | 84635–84635 | no |  | `none: seen only as a zombie, after it exited` |
| 73151 | rustc | 51109 | 51109 | 84686–84790 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rgb --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rgb-0.8.53/src/lib.rs  … (961 chars)` |
| 73176 | clang | 51109 | 73002 | 84739–84739 | no |  | `none: seen only as a zombie, after it exited` |
| 73178 | ld | 51109 | 73176 | 84739–84739 | no |  | `none: seen only as a zombie, after it exited` |
| 73184 | rustc | 51109 | 51109 | 84790–109279 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_utils --edition=2024 crates/tauri-utils/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,art … (4785 chars)` |
| 73187 | rustc | 51109 | 51109 | 84841–86323 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name itertools --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/itertools-0.14.0 … (852 chars)` |
| 73190 | rustc | 51109 | 51109 | 84841–85266 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name num_derive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-derive-0.4. … (920 chars)` |
| 73197 | rustc | 51109 | 51109 | 84900–84900 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name security_framework_sys --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sec … (1847 chars)` |
| 73248 | rustc | 51109 | 51109 | 84953–85207 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name socket2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/socket2-0.6.1/src/ … (761 chars)` |
| 73312 | rustc | 51109 | 51109 | 85156–85266 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name simd_helpers --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/simd_helpers- … (740 chars)` |
| 73315 | rustc | 51109 | 51109 | 85207–85330 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name half --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/half-2.4.1/src/lib.rs … (912 chars)` |
| 73331 | rustc | 51109 | 51109 | 85207–85266 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2-0 … (1512 chars)` |
| 73350 | xcrun | 51109 | 73190 | 85207–85207 | no |  | `none: seen only as a zombie, after it exited` |
| 73358 | clang | 51109 | 73190 | 85266–85266 | no |  | `none: seen only as a zombie, after it exited` |
| 73375 | clang | 51109 | 73312 | 85266–85266 | no |  | `none: seen only as a zombie, after it exited` |
| 73380 | ld | 51109 | 73358 | 85266–85266 | no |  | `none: seen only as a zombie, after it exited` |
| 73390 | clang | 51109 | 73331 | 85266–85266 | no |  | `none: seen only as a zombie, after it exited` |
| 73392 | ld | 51109 | 73375 | 85266–85266 | no |  | `none: seen only as a zombie, after it exited` |
| 73399 | rustc | 51109 | 51109 | 85266–85379 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name noop_proc_macro --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/noop_proc_ … (658 chars)` |
| 73402 | ld | 51109 | 73390 | 85266–85266 | no |  | `none: seen only as a zombie, after it exited` |
| 73419 | rustc | 51109 | 51109 | 85330–85379 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name imgref --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/imgref-1.12.2/src/l … (722 chars)` |
| 73435 | rustc | 51109 | 51109 | 85330–85379 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name color_quant --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/color_quant-1. … (657 chars)` |
| 73436 | rustc | 51109 | 51109 | 85330–85429 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name mime --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/mime-0.3.17/src/lib.r … (644 chars)` |
| 73441 | rustc | 51109 | 51109 | 85379–85429 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name byteorder_lite --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/byteorder-l … (723 chars)` |
| 73459 | clang | 51109 | 73399 | 85379–85379 | no |  | `none: seen only as a zombie, after it exited` |
| 73462 | ld | 51109 | 73459 | 85379–85379 | no |  | `none: seen only as a zombie, after it exited` |
| 73463 | rustc | 51109 | 51109 | 85379–85682 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ipnet --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ipnet-2.10.1/src/lib … (761 chars)` |
| 73466 | rustc | 51109 | 51109 | 85429–85837 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name gif --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gif-0.14.2/src/lib.rs  … (982 chars)` |
| 73467 | rustc | 51109 | 51109 | 85429–85429 | no |  | `none: seen only as a zombie, after it exited` |
| 73468 | rustc | 51109 | 51109 | 85479–86785 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name image_webp --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/image-webp-0.2. … (876 chars)` |
| 73470 | build-script-bui | 51109 | 51109 | 85479–85479 | no |  | `none: seen only as a zombie, after it exited` |
| 73473 | rustc | 51109 | 51109 | 85479–85530 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name spki --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/spki-0.7.3/src/lib.rs … (857 chars)` |
| 73475 | rustc | 51109 | 51109 | 85479–85682 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rand_chacha --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rand_chacha-0. … (916 chars)` |
| 73479 | rustc | 51109 | 51109 | 85530–85682 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name avif_serialize --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/avif-serial … (758 chars)` |
| 73485 | rustc | 51109 | 51109 | 85580–85682 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name dpi --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dpi-0.1.1/src/lib.rs - … (767 chars)` |
| 73496 | rustc | 51109 | 51109 | 85732–85785 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name iana_time_zone --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/iana-time-z … (816 chars)` |
| 73499 | rustc | 51109 | 51109 | 85732–85837 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zune_inflate --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zune-inflate- … (861 chars)` |
| 73500 | rustc | 51109 | 51109 | 85732–85785 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bit_field --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bit_field-0.10.2 … (654 chars)` |
| 73502 | rustc | 51109 | 51109 | 85785–85785 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name lebe --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/lebe-0.5.2/src/lib.rs … (643 chars)` |
| 73508 | rustc | 51109 | 51109 | 85837–85890 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustls- … (1061 chars)` |
| 73509 | rustc | 51109 | 51109 | 85837–85941 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name fax --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fax-0.2.7/src/lib.rs - … (668 chars)` |
| 73513 | xcrun | 51109 | 73508 | 85837–85837 | no |  | `none: seen only as a zombie, after it exited` |
| 73517 | clang | 51109 | 73508 | 85890–85890 | no |  | `none: seen only as a zombie, after it exited` |
| 73518 | rustc | 51109 | 51109 | 85890–88643 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pxfm --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pxfm-0.1.30/src/lib.r … (644 chars)` |
| 73520 | ld | 51109 | 73517 | 85890–85890 | no |  | `none: seen only as a zombie, after it exited` |
| 73521 | rustc | 51109 | 51109 | 85890–89062 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name exr --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/exr-1.74.0/src/lib.rs  … (1351 chars)` |
| 73529 | rustc | 51109 | 51109 | 85941–87044 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name chrono --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/chrono-0.4.41/src/l … (1591 chars)` |
| 73539 | build-script-bui | 51109 | 51109 | 85941–85941 | no |  | `none: seen only as a zombie, after it exited` |
| 73571 | rustc | 51109 | 51109 | 85992–87256 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tiff --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tiff-0.11.3/src/lib.r … (1363 chars)` |
| 73576 | rustc | 51109 | 51109 | 85992–86476 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rand --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rand-0.8.6/src/lib.rs … (1232 chars)` |
| 73620 | rustc | 51109 | 51109 | 86097–87099 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name objc2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2-0.6.4/src/lib. … (1658 chars)` |
| 73657 | rustc | 51109 | 51109 | 86375–90625 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rav1e --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rav1e-0.8.1/src/lib. … (3666 chars)` |
| 73671 | rustc | 51109 | 51109 | 86527–87099 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name webpki --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustls-webpki-0.103 … (1227 chars)` |
| 73777 | rustc | 51109 | 51109 | 86837–86938 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name wasm_bindgen_shared --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-b … (1217 chars)` |
| 73833 | rustc | 51109 | 51109 | 86993–87099 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name qoi --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/qoi-0.4.1/src/lib.rs - … (818 chars)` |
| 73857 | rustc | 51109 | 51109 | 87099–87206 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name futures_executor --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-e … (1210 chars)` |
| 73860 | rustc | 51109 | 51109 | 87149–87206 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cookie- … (882 chars)` |
| 73861 | rustc | 51109 | 51109 | 87149–87149 | no |  | `none: seen only as a zombie, after it exited` |
| 73863 | rustc | 51109 | 51109 | 87149–87206 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name raw_window_handle --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/raw-wind … (761 chars)` |
| 73868 | xcrun | 51109 | 73860 | 87149–87149 | no |  | `none: seen only as a zombie, after it exited` |
| 73870 | clang | 51109 | 73860 | 87206–87206 | no |  | `none: seen only as a zombie, after it exited` |
| 73873 | rustc | 51109 | 51109 | 87206–87206 | no |  | `none: seen only as a zombie, after it exited` |
| 73874 | ld | 51109 | 73870 | 87206–87206 | no |  | `none: seen only as a zombie, after it exited` |
| 73879 | rustc | 51109 | 51109 | 87256–87513 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pkg_config --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pkg-config-0.3. … (613 chars)` |
| 73880 | build-script-build | 51109 | 51109 | 87256–87312 | no |  | `/private/tmp/c335/tauri/target/debug/build/cookie-50f221361e9c5980/build-script-build` |
| 73882 | rustc | 51109 | 51109 | 87256–87256 | no |  | `none: seen only as a zombie, after it exited` |
| 73889 | rustc | 51109 | 51109 | 87312–87412 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name objc2_foundation --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2-fou … (4596 chars)` |
| 73890 | rustc | 51109 | 73880 | 87312–87312 | no |  | `none: seen only as a zombie, after it exited` |
| 73891 | rustc | 51109 | 51109 | 87312–89963 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name wasm_bindgen_macro_support --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f … (1598 chars)` |
| 73893 | rustc | 51109 | 51109 | 87362–92151 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rustls --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustls-0.23.45/src/ … (1805 chars)` |
| 73895 | rustc | 51109 | 51109 | 87362–87513 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-bi … (1410 chars)` |
| 73942 | rustc | 51109 | 51109 | 87463–87735 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name foreign_types_macros --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/forei … (965 chars)` |
| 73966 | clang | 51109 | 73895 | 87513–87513 | no |  | `none: seen only as a zombie, after it exited` |
| 73969 | ld | 51109 | 73966 | 87513–87513 | no |  | `none: seen only as a zombie, after it exited` |
| 73986 | rustc | 51109 | 51109 | 87564–87784 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name crossbeam_channel --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crossbea … (1014 chars)` |
| 74003 | rustc | 51109 | 51109 | 87564–87616 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rand_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rand_core-0.9.3/ … (817 chars)` |
| 74060 | clang | 51109 | 73942 | 87673–87673 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcw0lykJ/list /private/tmp/c335/tauri/target/debug/deps/rustcw0lykJ/symbol … (4035 chars)` |
| 74063 | rustc | 51109 | 51109 | 87673–87673 | no |  | `none: seen only as a zombie, after it exited` |
| 74065 | ld | 51109 | 74060 | 87673–87673 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (4198 chars)` |
| 74066 | rustc | 51109 | 51109 | 87735–87886 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rand_chacha --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rand_chacha-0. … (908 chars)` |
| 74087 | rustc | 51109 | 51109 | 87784–88121 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name objc2_quartz_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2-qu … (2446 chars)` |
| 74096 | rustc | 51109 | 51109 | 87886–93444 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name moxcms --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/moxcms-0.8.1/src/li … (1707 chars)` |
| 74102 | rustc | 51109 | 51109 | 87938–88005 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name foreign_types --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/foreign-type … (959 chars)` |
| 74131 | rustc | 51109 | 51109 | 88056–93663 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name objc2_app_kit --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2-app-ki … (9188 chars)` |
| 74252 | rustc | 51109 | 51109 | 88173–89526 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hyper --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hyper-1.8.1/src/lib. … (2377 chars)` |
| 74389 | build-script-bui | 51109 | 51109 | 88694–88694 | no |  | `none: seen only as a zombie, after it exited` |
| 74438 | rustc | 51109 | 51109 | 88746–88905 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wry-0.5 … (1207 chars)` |
| 74462 | clang | 51109 | 74438 | 88848–88905 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/wry-621a81d95558daa9/rustcOS88Fi/symbols.o /private/tmp/c335/tauri/target/debug/build/wry-621a81d95558daa9/ … (3586 chars)` |
| 74464 | ld | 51109 | 74462 | 88905–88905 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3762 chars)` |
| 74468 | rustc | 51109 | 51109 | 88956–89424 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cookie --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cookie-0.18.1/src/l … (882 chars)` |
| 74471 | rustc | 51109 | 51109 | 89011–90065 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name security_framework --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/securit … (2125 chars)` |
| 74500 | rustc | 51109 | 51109 | 89163–90467 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hyper_util --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hyper-util-0.1. … (2675 chars)` |
| 74579 | rustc | 51109 | 51109 | 89475–89475 | no |  | `none: seen only as a zombie, after it exited` |
| 74586 | rustc | 51109 | 51109 | 89526–89730 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name unicode_segmentation --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unico … (684 chars)` |
| 74600 | rustc | 51109 | 51109 | 89577–89628 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/muda-0. … (783 chars)` |
| 74605 | rustc | 51109 | 51109 | 89577–89679 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 crates/tauri-runtime/build.rs --error-format=json --json=diagnostic-rendered-a … (806 chars)` |
| 74617 | xcrun | 51109 | 74600 | 89577–89577 | no |  | `none: seen only as a zombie, after it exited` |
| 74619 | clang | 51109 | 74600 | 89628–89628 | no |  | `none: seen only as a zombie, after it exited` |
| 74621 | ld | 51109 | 74619 | 89628–89628 | no |  | `none: seen only as a zombie, after it exited` |
| 74627 | clang | 51109 | 74605 | 89628–89628 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/tauri-runtime-ebf532375e72839b/rustc4DQ1n8/symbols.o /private/tmp/c335/tauri/target/debug/build/tauri-runti … (5074 chars)` |
| 74630 | build-script-build | 51109 | 51109 | 89679–89679 | no |  | `/private/tmp/c335/tauri/target/debug/build/muda-5102a9cee66837bf/build-script-build` |
| 74632 | build-script-bui | 51109 | 51109 | 89730–89730 | no |  | `none: seen only as a zombie, after it exited` |
| 74633 | rustc | 51109 | 51109 | 89730–90014 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name core_graphics --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/core-graphic … (1781 chars)` |
| 74642 | build-script-build | 51109 | 51109 | 89782–89782 | no |  | `/private/tmp/c335/tauri/target/debug/build/wry-621a81d95558daa9/build-script-build` |
| 74650 | rustc | 51109 | 51109 | 89782–90065 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rand --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rand-0.9.4/src/lib.rs … (1135 chars)` |
| 74655 | rustc | 51109 | 51109 | 89913–91830 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_codegen --edition=2024 crates/tauri-codegen/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi … (2590 chars)` |
| 74659 | rustc | 51109 | 51109 | 90065–90166 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name wasm_bindgen_macro --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-bi … (1335 chars)` |
| 74674 | rustc | 51109 | 51109 | 90065–90065 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name webpki_roots --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/webpki-roots- … (763 chars)` |
| 74680 | rustc | 51109 | 51109 | 90115–90319 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name dispatch2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dispatch2-0.3.1/ … (1529 chars)` |
| 74681 | clang | 51109 | 74659 | 90115–90166 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcTatA3h/list /private/tmp/c335/tauri/target/debug/deps/rustcTatA3h/symbol … (4154 chars)` |
| 74684 | ld | 51109 | 74681 | 90115–90166 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (4317 chars)` |
| 74685 | rustc | 51109 | 51109 | 90115–95009 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ravif --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ravif-0.13.0/src/lib … (1352 chars)` |
| 74687 | rustc | 51109 | 51109 | 90166–90166 | no |  | `none: seen only as a zombie, after it exited` |
| 74689 | rustc | 51109 | 51109 | 90218–90844 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name keyboard_types --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/keyboard-ty … (951 chars)` |
| 74690 | rustc | 51109 | 51109 | 90218–91257 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name wasm_bindgen --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-bindgen- … (1829 chars)` |
| 74710 | rustc | 51109 | 51109 | 90404–90467 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_urlencoded --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_url … (1037 chars)` |
| 74713 | rustc | 51109 | 51109 | 90518–92048 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_build --edition=2024 crates/tauri-build/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,art … (2385 chars)` |
| 74714 | rustc | 51109 | 51109 | 90518–90625 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ahash-0 … (990 chars)` |
| 74733 | xcrun | 51109 | 74714 | 90569–90569 | no |  | `none: seen only as a zombie, after it exited` |
| 74735 | clang | 51109 | 74714 | 90625–90625 | no |  | `none: seen only as a zombie, after it exited` |
| 74736 | ld | 51109 | 74735 | 90625–90625 | no |  | `none: seen only as a zombie, after it exited` |
| 74740 | rustc | 51109 | 51109 | 90684–90684 | no |  | `none: seen only as a zombie, after it exited` |
| 74741 | rustc | 51109 | 51109 | 90684–91152 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name data_encoding --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/data-encodin … (987 chars)` |
| 74743 | rustc | 51109 | 51109 | 90736–90787 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/owo-col … (682 chars)` |
| 74749 | clang | 51109 | 74743 | 90787–90787 | no |  | `none: seen only as a zombie, after it exited` |
| 74764 | ld | 51109 | 74749 | 90787–90787 | no |  | `none: seen only as a zombie, after it exited` |
| 74768 | rustc | 51109 | 51109 | 90844–90944 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tray-ic … (928 chars)` |
| 74774 | rustc | 51109 | 51109 | 90894–90997 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name unicode_linebreak --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unicode- … (669 chars)` |
| 74775 | clang | 51109 | 74768 | 90894–90894 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/tray-icon-0a2f37903ac63c23/rustcB88hzY/symbols.o /private/tmp/c335/tauri/target/debug/build/tray-icon-0a2f3 … (3246 chars)` |
| 74781 | rustc | 51109 | 51109 | 90997–91100 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 crates/tauri-runtime-wry/build.rs --error-format=json --json=diagnostic-render … (1018 chars)` |
| 74789 | rustc | 51109 | 51109 | 91048–91257 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name textwrap --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/textwrap-0.16.2/s … (1340 chars)` |
| 74794 | clang | 51109 | 74781 | 91048–91100 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/tauri-runtime-wry-9ccce9a4ad86bbea/rustcQmTdZt/symbols.o /private/tmp/c335/tauri/target/debug/build/tauri-r … (5138 chars)` |
| 74798 | rustc | 51109 | 51109 | 91152–97705 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name image --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/image-0.25.10/src/li … (2710 chars)` |
| 74800 | build-script-bui | 51109 | 51109 | 91204–91204 | no |  | `none: seen only as a zombie, after it exited` |
| 74802 | build-script-bui | 51109 | 51109 | 91257–91257 | no |  | `none: seen only as a zombie, after it exited` |
| 74804 | build-script-build | 51109 | 51109 | 91308–91308 | no |  | `/private/tmp/c335/tauri/target/debug/build/owo-colors-0c3138e450ba6b37/build-script-build` |
| 74805 | build-script-build | 51109 | 51109 | 91308–91359 | no |  | `/private/tmp/c335/tauri/target/debug/build/ahash-3fdb4ce35b1fb139/build-script-build` |
| 74807 | rustc | 51109 | 51109 | 91308–91359 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name objc2_core_graphics --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2- … (2281 chars)` |
| 74809 | rustc | 51109 | 51109 | 91410–91410 | no |  | `none: seen only as a zombie, after it exited` |
| 74811 | rustc | 51109 | 51109 | 91410–91462 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name sha2 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sha2-0.10.8/src/lib.r … (1073 chars)` |
| 74812 | rustc | 51109 | 51109 | 91410–91410 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hmac --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hmac-0.12.1/src/lib.r … (749 chars)` |
| 74814 | rustc | 51109 | 51109 | 91462–91462 | no |  | `none: seen only as a zombie, after it exited` |
| 74816 | (unknown) | 51109 | 51109 | 91511–91511 | no |  | `none: seen only as a zombie, with no name` |
| 74817 | rustc | 51109 | 51109 | 91511–91615 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ahash --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ahash-0.8.11/src/lib … (1404 chars)` |
| 74819 | rustc | 51109 | 51109 | 91561–91561 | no |  | `none: seen only as a zombie, after it exited` |
| 74820 | rustc | 51109 | 51109 | 91561–91944 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name owo_colors --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/owo-colors-4.1. … (724 chars)` |
| 74822 | cargo | 51109 | 51109 | 91615–91615 | no |  | `none: seen only as a zombie, after it exited` |
| 74824 | rustc | 51109 | 51109 | 91678–91728 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tokio_rustls --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-rustls- … (1047 chars)` |
| 74825 | rustc | 51109 | 51109 | 91678–91883 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rustls_native_certs --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustls … (892 chars)` |
| 74828 | rustc | 51109 | 51109 | 91778–91996 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/lzma-sy … (846 chars)` |
| 74831 | rustc | 51109 | 51109 | 91883–92048 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bzip2-s … (831 chars)` |
| 74835 | xcrun | 51109 | 74828 | 91883–91883 | no |  | `none: seen only as a zombie, after it exited` |
| 74839 | clang | 51109 | 74828 | 91944–91944 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/lzma-sys-be9e86f363fc780f/rustczhCOcc/symbols.o /private/tmp/c335/tauri/target/debug/build/lzma-sys-be9e86f … (3546 chars)` |
| 74840 | rustc | 51109 | 51109 | 91944–92048 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pkcs8 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pkcs8-0.10.2/src/lib … (1001 chars)` |
| 74841 | ld | 51109 | 74839 | 91944–91944 | no |  | `none: seen only as a zombie, after it exited` |
| 74847 | clang | 51109 | 74831 | 91996–92048 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/bzip2-sys-65ba231bf772967c/rustcZrEHfj/symbols.o /private/tmp/c335/tauri/target/debug/build/bzip2-sys-65ba2 … (3550 chars)` |
| 74849 | rustc | 51109 | 51109 | 91996–92615 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_miette_derive --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc-miet … (934 chars)` |
| 74851 | ld | 51109 | 74847 | 91996–92048 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (3726 chars)` |
| 74853 | rustc | 51109 | 51109 | 92048–92289 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_repr --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_repr-0.1. … (921 chars)` |
| 74855 | rustc | 51109 | 51109 | 92099–92665 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pin_project_internal --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pin-p … (2259 chars)` |
| 74856 | rustc | 51109 | 51109 | 92099–92615 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name async_trait --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/async-trait-0. … (923 chars)` |
| 74857 | rustc | 51109 | 51109 | 92099–93393 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name darling_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/darling_core- … (1257 chars)` |
| 74864 | rustc | 51109 | 51109 | 92203–92341 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name signal_hook_registry --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/signa … (762 chars)` |
| 74865 | clang | 51109 | 74853 | 92203–92289 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcpvVgNO/list /private/tmp/c335/tauri/target/debug/deps/rustcpvVgNO/symbol … (3866 chars)` |
| 74867 | ld | 51109 | 74865 | 92289–92289 | no |  | `none: seen only as a zombie, after it exited` |
| 74869 | rustc | 51109 | 51109 | 92341–92974 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name objc2_web_kit --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/objc2-web-ki … (7091 chars)` |
| 74872 | rustc | 51109 | 51109 | 92444–93817 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name muda --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/muda-0.20.0/src/lib.r … (1996 chars)` |
| 74879 | clang | 51109 | 74856 | 92548–92548 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcieSE25/list /private/tmp/c335/tauri/target/debug/deps/rustcieSE25/symbol … (4548 chars)` |
| 74885 | clang | 51109 | 74849 | 92548–92615 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcP2PDjx/list /private/tmp/c335/tauri/target/debug/deps/rustcP2PDjx/symbol … (4894 chars)` |
| 74886 | ld | 51109 | 74879 | 92548–92548 | no |  | `none: seen only as a zombie, after it exited` |
| 74887 | ld | 51109 | 74885 | 92615–92615 | no |  | `none: seen only as a zombie, after it exited` |
| 74892 | clang | 51109 | 74855 | 92615–92665 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcXCfY38/list /private/tmp/c335/tauri/target/debug/deps/rustcXCfY38/symbol … (4692 chars)` |
| 74894 | ld | 51109 | 74892 | 92665–92665 | no |  | `none: seen only as a zombie, after it exited` |
| 74895 | rustc | 51109 | 51109 | 92665–94282 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tao --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tao-0.37.0/src/lib.rs  … (2322 chars)` |
| 74896 | rustc | 51109 | 51109 | 92665–92766 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name window_vibrancy --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/window-vib … (1414 chars)` |
| 74898 | rustc | 51109 | 51109 | 92715–93161 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bcder --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bcder-0.7.4/src/lib. … (829 chars)` |
| 74901 | rustc | 51109 | 51109 | 92816–94179 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name wry --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wry-0.57.0/src/lib.rs  … (2595 chars)` |
| 74906 | rustc | 51109 | 51109 | 93060–93341 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pem --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pem-3.0.4/src/lib.rs - … (801 chars)` |
| 74911 | rustc | 51109 | 51109 | 93211–93614 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tray_icon --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tray-icon-0.25.1 … (2153 chars)` |
| 74916 | rustc | 51109 | 51109 | 93393–93920 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_runtime --edition=2024 crates/tauri-runtime/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi … (2024 chars)` |
| 74943 | rustc | 51109 | 51109 | 93499–93563 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/proc-ma … (866 chars)` |
| 74947 | rustc | 51109 | 74943 | 93499–93499 | no |  | `none: seen only as a zombie, after it exited` |
| 74949 | xcrun | 51109 | 74943 | 93499–93499 | no |  | `none: seen only as a zombie, after it exited` |
| 74948 | rustc | 51109 | 51109 | 93563–94748 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name iri_string --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/iri-string-0.7. … (766 chars)` |
| 74950 | clang | 51109 | 74943 | 93563–93563 | no |  | `none: seen only as a zombie, after it exited` |
| 74951 | ld | 51109 | 74950 | 93563–93563 | no |  | `none: seen only as a zombie, after it exited` |
| 74955 | rustc | 51109 | 51109 | 93614–93663 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name http_range --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/http-range-0.1. … (655 chars)` |
| 74957 | rustc | 51109 | 51109 | 93663–93663 | no |  | `none: seen only as a zombie, after it exited` |
| 74961 | rustc | 51109 | 51109 | 93715–93765 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/radium- … (630 chars)` |
| 74963 | rustc | 51109 | 51109 | 93715–93715 | no |  | `none: seen only as a zombie, after it exited` |
| 74964 | rustc | 51109 | 51109 | 93715–93715 | no |  | `none: seen only as a zombie, after it exited` |
| 74968 | rustc | 51109 | 51109 | 93765–93817 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name fastrand --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fastrand-2.3.0/sr … (761 chars)` |
| 74974 | rustc | 51109 | 51109 | 93765–93817 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name anstyle --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/anstyle-1.0.10/src … (2856 chars)` |
| 74975 | clang | 51109 | 74961 | 93765–93765 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/radium-eff9d3db6f86dec2/rustcotIge8/symbols.o /private/tmp/c335/tauri/target/debug/build/radium-eff9d3db6f8 … (3234 chars)` |
| 74981 | rustc | 51109 | 51109 | 93868–94798 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_runtime_wry --edition=2024 crates/tauri-runtime-wry/src/lib.rs --error-format=json --json=diagnostic-rende … (2135 chars)` |
| 74982 | rustc | 51109 | 51109 | 93868–93868 | no |  | `none: seen only as a zombie, after it exited` |
| 74983 | rustc | 51109 | 51109 | 93868–93970 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hex --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hex-0.4.3/src/lib.rs - … (741 chars)` |
| 74984 | build-script-build | 51109 | 51109 | 93868–93920 | no |  | `/private/tmp/c335/tauri/target/debug/build/radium-eff9d3db6f86dec2/build-script-build` |
| 74986 | rustc | 51109 | 51109 | 93920–94022 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name anstream --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/anstream-0.6.18/s … (3521 chars)` |
| 74988 | rustc | 51109 | 51109 | 93970–94179 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tempfile --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tempfile-3.23.0/s … (1115 chars)` |
| 74990 | rustc | 51109 | 51109 | 94022–95060 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name x509_certificate --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/x509-cert … (1759 chars)` |
| 74991 | build-script-build | 51109 | 51109 | 94022–94074 | no |  | `/private/tmp/c335/tauri/target/debug/build/proc-macro2-diagnostics-eb64bbc7b63ae2d1/build-script-build` |
| 74993 | rustc | 51109 | 51109 | 94074–94233 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name darling_macro --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/darling_macr … (930 chars)` |
| 74994 | rustc | 51109 | 74991 | 94074–94074 | no |  | `none: seen only as a zombie, after it exited` |
| 74996 | rustc | 51109 | 51109 | 94127–94179 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pin_project --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pin-project-1. … (2095 chars)` |
| 75002 | clang | 51109 | 74993 | 94179–94233 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcfDp946/list /private/tmp/c335/tauri/target/debug/deps/rustcfDp946/symbol … (4181 chars)` |
| 75004 | rustc | 51109 | 51109 | 94233–94958 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name miette --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc-miette-2.7.1/sr … (2011 chars)` |
| 75005 | ld | 51109 | 75002 | 94233–94233 | no |  | `none: seen only as a zombie, after it exited` |
| 75006 | build-script-build | 51109 | 51109 | 94233–94798 | no |  | `/private/tmp/c335/tauri/target/debug/build/bzip2-sys-65ba231bf772967c/build-script-build` |
| 75008 | build-script-build | 51109 | 51109 | 94282–98186 | no |  | `/private/tmp/c335/tauri/target/debug/build/lzma-sys-be9e86f363fc780f/build-script-build` |
| 75009 | rustc | 51109 | 51109 | 94282–94390 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hyper_rustls --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hyper-rustls- … (2221 chars)` |
| 75038 | rustc | 51109 | 51109 | 94332–94332 | no |  | `none: seen only as a zombie, after it exited` |
| 75047 | cc | 51109 | 75006 | 94332–94332 | no |  | `none: seen only as a zombie, after it exited` |
| 75058 | clang | 51109 | 75006 | 94390–94390 | no |  | `none: seen only as a zombie, after it exited` |
| 75062 | rustc | 51109 | 51109 | 94390–94646 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name scroll_derive --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/scroll_deriv … (927 chars)` |
| 75063 | clang | 51109 | 75008 | 94390–94390 | no |  | `none: seen only as a zombie, after it exited` |
| 75086 | clang | 51109 | 75006 | 94442–94442 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I bzip2-1.0. … (378 chars)` |
| 75089 | clang | 51109 | 75008 | 94442–94442 | no |  | `none: seen only as a zombie, after it exited` |
| 75090 | rustc | 51109 | 51109 | 94442–94646 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tower_http --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tower-http-0.6. … (2447 chars)` |
| 75098 | clang | 51109 | 75008 | 94493–94493 | no |  | `none: seen only as a zombie, after it exited` |
| 75109 | clang | 51109 | 75008 | 94544–94544 | no |  | `none: seen only as a zombie, after it exited` |
| 75110 | clang | 51109 | 75109 | 94544–94544 | no |  | `none: seen only as a zombie, after it exited` |
| 75114 | cc | 51109 | 75006 | 94544–94544 | no |  | `none: seen only as a zombie, after it exited` |
| 75120 | clang | 51109 | 75008 | 94596–94596 | no |  | `none: seen only as a zombie, after it exited` |
| 75128 | clang | 51109 | 75006 | 94596–94596 | no |  | `none: seen only as a zombie, after it exited` |
| 75129 | clang | 51109 | 75062 | 94596–94646 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcqh0cut/list /private/tmp/c335/tauri/target/debug/deps/rustcqh0cut/symbol … (3995 chars)` |
| 75130 | clang | 51109 | 75120 | 94596–94596 | no |  | `none: seen only as a zombie, after it exited` |
| 75132 | clang | 51109 | 75128 | 94596–94596 | no |  | `none: seen only as a zombie, after it exited` |
| 75133 | ld | 51109 | 75129 | 94646–94646 | no |  | `none: seen only as a zombie, after it exited` |
| 75137 | clang | 51109 | 75008 | 94646–94646 | no |  | `none: seen only as a zombie, after it exited` |
| 75141 | clang | 51109 | 75006 | 94646–94646 | no |  | `none: seen only as a zombie, after it exited` |
| 75142 | clang | 51109 | 75137 | 94646–94646 | no |  | `none: seen only as a zombie, after it exited` |
| 75143 | clang | 51109 | 75141 | 94646–94646 | no |  | `none: seen only as a zombie, after it exited` |
| 75148 | clang | 51109 | 75008 | 94696–94696 | no |  | `none: seen only as a zombie, after it exited` |
| 75150 | rustc | 51109 | 51109 | 94696–94696 | no |  | `none: seen only as a zombie, after it exited` |
| 75151 | clang | 51109 | 75148 | 94696–94696 | no |  | `none: seen only as a zombie, after it exited` |
| 75155 | clang | 51109 | 75006 | 94696–94696 | no |  | `none: seen only as a zombie, after it exited` |
| 75156 | rustc | 51109 | 51109 | 94696–94696 | no |  | `none: seen only as a zombie, after it exited` |
| 75158 | clang | 51109 | 75155 | 94696–94696 | no |  | `none: seen only as a zombie, after it exited` |
| 75171 | clang | 51109 | 75006 | 94748–94748 | no |  | `none: seen only as a zombie, after it exited` |
| 75172 | rustc | 51109 | 51109 | 94748–94902 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name yansi --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/yansi-1.0.1/src/lib. … (804 chars)` |
| 75176 | clang | 51109 | 75008 | 94748–94748 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I xz-5.2/src … (711 chars)` |
| 75177 | rustc | 51109 | 51109 | 94748–94798 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name base16ct --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/base16ct-0.2.0/sr … (687 chars)` |
| 75178 | clang | 51109 | 75171 | 94748–94748 | no |  | `none: seen only as a zombie, after it exited` |
| 75185 | ar | 51109 | 75006 | 94798–94798 | no |  | `none: seen only as a zombie, after it exited` |
| 75186 | rustc | 51109 | 51109 | 94798–94902 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name typewit_proc_macros --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/typewi … (666 chars)` |
| 75190 | clang | 51109 | 75008 | 94798–94798 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I xz-5.2/src … (726 chars)` |
| 75192 | libtool | 51109 | 75185 | 94798–94798 | no |  | `none: seen only as a zombie, after it exited` |
| 75199 | rustc | 51109 | 51109 | 94850–94902 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_data_structures --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc_da … (2990 chars)` |
| 75200 | rustc | 51109 | 51109 | 94850–94958 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name sec1 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sec1-0.7.3/src/lib.rs … (1354 chars)` |
| 75201 | rustc | 51109 | 51109 | 94850–94850 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bzip2_sys --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bzip2-sys-0.1.11 … (853 chars)` |
| 75212 | clang | 51109 | 75186 | 94902–94902 | no |  | `none: seen only as a zombie, after it exited` |
| 75213 | ld | 51109 | 75212 | 94902–94902 | no |  | `none: seen only as a zombie, after it exited` |
| 75214 | rustc | 51109 | 51109 | 94902–95009 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name proc_macro2_diagnostics --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pr … (1100 chars)` |
| 75218 | clang | 51109 | 75008 | 94902–94902 | no |  | `none: seen only as a zombie, after it exited` |
| 75221 | rustc | 51109 | 51109 | 94958–95214 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_allocator --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc_allocato … (3301 chars)` |
| 75222 | rustc | 51109 | 51109 | 94958–94958 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name wyz --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wyz-0.5.1/src/lib.rs - … (786 chars)` |
| 75226 | clang | 51109 | 75008 | 94958–94958 | no |  | `none: seen only as a zombie, after it exited` |
| 75227 | rustc | 51109 | 51109 | 94958–95112 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name typewit --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/typewit-1.11.0/src … (1095 chars)` |
| 75228 | clang | 51109 | 75226 | 94958–94958 | no |  | `none: seen only as a zombie, after it exited` |
| 75233 | clang | 51109 | 75008 | 95009–95009 | no |  | `none: seen only as a zombie, after it exited` |
| 75234 | rustc | 51109 | 51109 | 95009–95060 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name group --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/group-0.13.0/src/lib … (1016 chars)` |
| 75235 | clang | 51109 | 75233 | 95009–95009 | no |  | `none: seen only as a zombie, after it exited` |
| 75236 | rustc | 51109 | 51109 | 95009–95163 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name scroll --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/scroll-0.12.0/src/l … (846 chars)` |
| 75238 | rustc | 51109 | 51109 | 95060–99110 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name reqwest --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/reqwest-0.12.28/sr … (4588 chars)` |
| 75242 | clang | 51109 | 75008 | 95060–95060 | no |  | `none: seen only as a zombie, after it exited` |
| 75243 | clang | 51109 | 75242 | 95060–95060 | no |  | `none: seen only as a zombie, after it exited` |
| 75244 | rustc | 51109 | 51109 | 95060–95417 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name compact_str --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/compact_str-0. … (1460 chars)` |
| 75245 | rustc | 51109 | 51109 | 95112–95163 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name darling --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/darling-0.20.10/sr … (907 chars)` |
| 75247 | rustc | 51109 | 51109 | 95112–95163 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name radium --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/radium-0.7.0/src/li … (762 chars)` |
| 75248 | rustc | 51109 | 51109 | 95112–95576 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_plugin --edition=2024 crates/tauri-plugin/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,a … (1497 chars)` |
| 75252 | clang | 51109 | 75008 | 95112–95112 | no |  | `none: seen only as a zombie, after it exited` |
| 75253 | clang | 51109 | 75252 | 95112–95112 | no |  | `none: seen only as a zombie, after it exited` |
| 75259 | clang | 51109 | 75008 | 95163–95163 | no |  | `none: seen only as a zombie, after it exited` |
| 75261 | rustc | 51109 | 51109 | 95163–95214 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml_datetime --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_datetim … (2888 chars)` |
| 75262 | clang | 51109 | 75259 | 95163–95163 | no |  | `none: seen only as a zombie, after it exited` |
| 75269 | rustc | 51109 | 51109 | 95214–95214 | no |  | `none: seen only as a zombie, after it exited` |
| 75273 | clang | 51109 | 75008 | 95214–95214 | no |  | `none: seen only as a zombie, after it exited` |
| 75274 | clang | 51109 | 75273 | 95214–95214 | no |  | `none: seen only as a zombie, after it exited` |
| 75275 | rustc | 51109 | 51109 | 95214–95468 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_ast_macros --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc_ast_mac … (3107 chars)` |
| 75277 | rustc | 51109 | 51109 | 95268–96040 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name crypto_bigint --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crypto-bigin … (1232 chars)` |
| 75281 | clang | 51109 | 75008 | 95268–95268 | no |  | `none: seen only as a zombie, after it exited` |
| 75282 | clang | 51109 | 75281 | 95268–95268 | no |  | `none: seen only as a zombie, after it exited` |
| 75283 | rustc | 51109 | 51109 | 95268–95368 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/curve25 … (916 chars)` |
| 75284 | rustc | 51109 | 51109 | 95268–95417 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name core_foundation --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/core-found … (1024 chars)` |
| 75286 | rustc | 51109 | 51109 | 95318–95318 | no |  | `none: seen only as a zombie, after it exited` |
| 75290 | clang | 51109 | 75008 | 95318–95318 | no |  | `none: seen only as a zombie, after it exited` |
| 75291 | clang | 51109 | 75290 | 95318–95318 | no |  | `none: seen only as a zombie, after it exited` |
| 75297 | clang | 51109 | 75008 | 95368–95368 | no |  | `none: seen only as a zombie, after it exited` |
| 75301 | clang | 51109 | 75283 | 95368–95368 | no |  | `none: seen only as a zombie, after it exited` |
| 75302 | clang | 51109 | 75297 | 95368–95368 | no |  | `none: seen only as a zombie, after it exited` |
| 75303 | ld | 51109 | 75301 | 95368–95368 | no |  | `none: seen only as a zombie, after it exited` |
| 75304 | rustc | 51109 | 51109 | 95417–95626 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hybrid_array --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hybrid-array- … (2037 chars)` |
| 75309 | clang | 51109 | 75008 | 95417–95417 | no |  | `none: seen only as a zombie, after it exited` |
| 75314 | clang | 51109 | 75309 | 95417–95417 | no |  | `none: seen only as a zombie, after it exited` |
| 75315 | rustc | 51109 | 51109 | 95417–95524 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/uncased … (844 chars)` |
| 75316 | clang | 51109 | 75275 | 95417–95468 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcUHaRtN/list /private/tmp/c335/tauri/target/debug/deps/rustcUHaRtN/symbol … (4227 chars)` |
| 75319 | ld | 51109 | 75316 | 95468–95468 | no |  | `none: seen only as a zombie, after it exited` |
| 75322 | clang | 51109 | 75008 | 95468–95468 | no |  | `none: seen only as a zombie, after it exited` |
| 75323 | clang | 51109 | 75322 | 95468–95468 | no |  | `none: seen only as a zombie, after it exited` |
| 75324 | rustc | 51109 | 51109 | 95468–95524 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rand_core --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rand_core-0.10.1 … (753 chars)` |
| 75325 | rustc | 51109 | 51109 | 95468–95524 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name lockfree_object_pool --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/lockf … (675 chars)` |
| 75329 | xcrun | 51109 | 75315 | 95468–95468 | no |  | `none: seen only as a zombie, after it exited` |
| 75331 | clang | 51109 | 75315 | 95524–95524 | no |  | `none: seen only as a zombie, after it exited` |
| 75335 | clang | 51109 | 75008 | 95524–95524 | no |  | `none: seen only as a zombie, after it exited` |
| 75336 | rustc | 51109 | 51109 | 95524–96279 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 crates/tauri/build.rs --error-format=json --json=diagnostic-rendered-ansi,arti … (2143 chars)` |
| 75337 | rustc | 51109 | 51109 | 95524–97204 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_macros --edition=2024 crates/tauri-macros/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,a … (1495 chars)` |
| 75338 | ld | 51109 | 75331 | 95524–95524 | no |  | `none: seen only as a zombie, after it exited` |
| 75339 | clang | 51109 | 75335 | 95524–95524 | no |  | `none: seen only as a zombie, after it exited` |
| 75345 | rustc | 51109 | 51109 | 95576–95887 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name simple_file_manifest --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/simpl … (676 chars)` |
| 75346 | rustc | 51109 | 51109 | 95576–95887 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name funty --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/funty-2.0.0/src/lib. … (661 chars)` |
| 75348 | rustc | 51109 | 51109 | 95576–95576 | no |  | `none: seen only as a zombie, after it exited` |
| 75352 | cc | 51109 | 75008 | 95576–95576 | no |  | `none: seen only as a zombie, after it exited` |
| 75354 | rustc | 51109 | 51109 | 95626–95736 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dragonb … (731 chars)` |
| 75356 | rustc | 51109 | 51109 | 95626–95678 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-big … (866 chars)` |
| 75361 | clang | 51109 | 75008 | 95626–95626 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I xz-5.2/src … (742 chars)` |
| 75369 | rustc | 51109 | 51109 | 95678–95787 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cow_utils --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cow-utils-0.1.3/ … (697 chars)` |
| 75370 | clang | 51109 | 75356 | 95678–95678 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/num-bigint-dig-f200dd1d5af58935/rustcvDwRFX/symbols.o /private/tmp/c335/tauri/target/debug/build/num-bigint … (3266 chars)` |
| 75378 | cc | 51109 | 75008 | 95678–95678 | no |  | `none: seen only as a zombie, after it exited` |
| 75380 | clang | 51109 | 75354 | 95736–95736 | no |  | `none: seen only as a zombie, after it exited` |
| 75383 | ld | 51109 | 75380 | 95736–95736 | no |  | `none: seen only as a zombie, after it exited` |
| 75387 | cc | 51109 | 75008 | 95736–95736 | no |  | `none: seen only as a zombie, after it exited` |
| 75389 | rustc | 51109 | 51109 | 95787–95837 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name clap_lex --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/clap_lex-0.7.4/sr … (2789 chars)` |
| 75391 | rustc | 51109 | 51109 | 95787–95837 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/getrand … (1650 chars)` |
| 75395 | clang | 51109 | 75008 | 95787–95787 | no |  | `none: seen only as a zombie, after it exited` |
| 75397 | clang | 51109 | 75395 | 95787–95787 | no |  | `none: seen only as a zombie, after it exited` |
| 75398 | rustc | 51109 | 51109 | 95837–95887 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/signal- … (723 chars)` |
| 75406 | clang | 51109 | 75008 | 95837–95837 | no |  | `none: seen only as a zombie, after it exited` |
| 75407 | clang | 51109 | 75391 | 95837–95837 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/getrandom-d9772c3fc90d3a16/rustc00Zg5c/symbols.o /private/tmp/c335/tauri/target/debug/build/getrandom-d9772 … (3246 chars)` |
| 75408 | clang | 51109 | 75406 | 95837–95837 | no |  | `none: seen only as a zombie, after it exited` |
| 75415 | rustc | 51109 | 51109 | 95887–96484 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name xml --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/xml-rs-0.8.25/src/lib. … (645 chars)` |
| 75416 | clang | 51109 | 75398 | 95887–95887 | no |  | `none: seen only as a zombie, after it exited` |
| 75420 | clang | 51109 | 75008 | 95887–95887 | no |  | `none: seen only as a zombie, after it exited` |
| 75421 | clang | 51109 | 75420 | 95887–95887 | no |  | `none: seen only as a zombie, after it exited` |
| 75422 | ld | 51109 | 75416 | 95887–95887 | no |  | `none: seen only as a zombie, after it exited` |
| 75424 | build-script-bui | 51109 | 51109 | 95938–95938 | no |  | `none: seen only as a zombie, after it exited` |
| 75425 | rustc | 51109 | 51109 | 95938–98337 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name clap_builder --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/clap_builder- … (3548 chars)` |
| 75429 | clang | 51109 | 75008 | 95938–95938 | no |  | `none: seen only as a zombie, after it exited` |
| 75430 | build-script-build | 51109 | 51109 | 95938–95938 | no |  | `/private/tmp/c335/tauri/target/debug/build/signal-hook-ee654392f57739f8/build-script-build` |
| 75431 | clang | 51109 | 75429 | 95938–95938 | no |  | `none: seen only as a zombie, after it exited` |
| 75432 | rustc | 51109 | 51109 | 95988–96102 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name elliptic_curve --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/elliptic-cu … (1958 chars)` |
| 75437 | clang | 51109 | 75008 | 95988–95988 | no |  | `none: seen only as a zombie, after it exited` |
| 75438 | build-script-build | 51109 | 51109 | 95988–96040 | no |  | `/private/tmp/c335/tauri/target/debug/build/dragonbox_ecma-7db87088fd687251/build-script-build` |
| 75439 | clang | 51109 | 75437 | 95988–95988 | no |  | `none: seen only as a zombie, after it exited` |
| 75441 | rustc | 51109 | 51109 | 96040–97305 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bitvec --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bitvec-1.0.1/src/li … (1074 chars)` |
| 75445 | clang | 51109 | 75008 | 96040–96040 | no |  | `none: seen only as a zombie, after it exited` |
| 75446 | clang | 51109 | 75445 | 96040–96040 | no |  | `none: seen only as a zombie, after it exited` |
| 75447 | (unknown) | 51109 | 75438 | 96040–96040 | no |  | `none: seen only as a zombie, with no name` |
| 75449 | build-script-bui | 51109 | 51109 | 96102–96102 | no |  | `none: seen only as a zombie, after it exited` |
| 75453 | clang | 51109 | 75008 | 96102–96102 | no |  | `none: seen only as a zombie, after it exited` |
| 75458 | clang | 51109 | 75453 | 96102–96102 | no |  | `none: seen only as a zombie, after it exited` |
| 75459 | clang | 51109 | 75336 | 96102–96279 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/tauri-770a5cd670a8af73/rustc4uu0oj/symbols.o /private/tmp/c335/tauri/target/debug/build/tauri-770a5cd670a8a … (22721 chars)` |
| 75460 | rustc | 51109 | 51109 | 96155–96331 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_span --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc_span-0.110.0/ … (3307 chars)` |
| 75465 | ld | 51109 | 75459 | 96155–96279 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (22897 chars)` |
| 75466 | clang | 51109 | 75008 | 96155–96155 | no |  | `none: seen only as a zombie, after it exited` |
| 75467 | build-script-build | 51109 | 51109 | 96155–96228 | no |  | `/private/tmp/c335/tauri/target/debug/build/uncased-59c755ccb80aadf0/build-script-build` |
| 75468 | rustc | 51109 | 51109 | 96155–96381 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_xml_rs --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-xml-rs- … (1015 chars)` |
| 75469 | clang | 51109 | 75466 | 96155–96155 | no |  | `none: seen only as a zombie, after it exited` |
| 75474 | clang | 51109 | 75008 | 96228–96228 | no |  | `none: seen only as a zombie, after it exited` |
| 75476 | clang | 51109 | 75474 | 96228–96228 | no |  | `none: seen only as a zombie, after it exited` |
| 75477 | rustc | 51109 | 75467 | 96228–96228 | no |  | `none: seen only as a zombie, after it exited` |
| 75481 | rustc | 51109 | 51109 | 96279–97705 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cryptographic_message_syntax --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b55 … (1660 chars)` |
| 75483 | clang | 51109 | 75008 | 96279–96279 | no |  | `none: seen only as a zombie, after it exited` |
| 75484 | clang | 51109 | 75483 | 96279–96279 | no |  | `none: seen only as a zombie, after it exited` |
| 75491 | build-script-build | 51109 | 51109 | 96331–96484 | no |  | `/private/tmp/c335/tauri/target/debug/build/tauri-770a5cd670a8af73/build-script-build` |
| 75496 | clang | 51109 | 75008 | 96381–96381 | no |  | `none: seen only as a zombie, after it exited` |
| 75497 | clang | 51109 | 75496 | 96381–96381 | no |  | `none: seen only as a zombie, after it exited` |
| 75499 | rustc | 51109 | 51109 | 96431–96934 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zopfli --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zopfli-0.8.1/src/li … (1370 chars)` |
| 75500 | build-script-build | 51109 | 51109 | 96431–96484 | no |  | `/private/tmp/c335/tauri/target/debug/build/curve25519-dalek-8ab967ccbe3721af/build-script-build` |
| 75504 | clang | 51109 | 75008 | 96431–96431 | no |  | `none: seen only as a zombie, after it exited` |
| 75505 | clang | 51109 | 75504 | 96431–96431 | no |  | `none: seen only as a zombie, after it exited` |
| 75510 | clang | 51109 | 75008 | 96484–96484 | no |  | `none: seen only as a zombie, after it exited` |
| 75512 | clang | 51109 | 75510 | 96484–96484 | no |  | `none: seen only as a zombie, after it exited` |
| 75514 | rustc | 51109 | 75500 | 96484–96484 | no |  | `none: seen only as a zombie, after it exited` |
| 75518 | clang | 51109 | 75008 | 96549–96549 | no |  | `none: seen only as a zombie, after it exited` |
| 75519 | rustc | 51109 | 51109 | 96549–97588 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name security_framework --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/securit … (2074 chars)` |
| 75520 | rustc | 51109 | 51109 | 96549–99272 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml_edit --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_edit-0.22.2 … (3446 chars)` |
| 75521 | clang | 51109 | 75518 | 96549–96549 | no |  | `none: seen only as a zombie, after it exited` |
| 75523 | rustc | 51109 | 51109 | 96605–97034 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name derive_builder_core --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/derive … (1059 chars)` |
| 75528 | clang | 51109 | 75008 | 96605–96605 | no |  | `none: seen only as a zombie, after it exited` |
| 75529 | clang | 51109 | 75528 | 96605–96605 | no |  | `none: seen only as a zombie, after it exited` |
| 75549 | clang | 51109 | 75008 | 96709–96709 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I xz-5.2/src … (722 chars)` |
| 75565 | cc | 51109 | 75008 | 96830–96830 | no |  | `none: seen only as a zombie, after it exited` |
| 75571 | clang | 51109 | 75008 | 96882–96882 | no |  | `none: seen only as a zombie, after it exited` |
| 75573 | clang | 51109 | 75571 | 96882–96882 | no |  | `none: seen only as a zombie, after it exited` |
| 75577 | clang | 51109 | 75008 | 96934–96934 | no |  | `none: seen only as a zombie, after it exited` |
| 75578 | clang | 51109 | 75577 | 96934–96934 | no |  | `none: seen only as a zombie, after it exited` |
| 75583 | clang | 51109 | 75008 | 96984–96984 | no |  | `none: seen only as a zombie, after it exited` |
| 75584 | clang | 51109 | 75583 | 96984–96984 | no |  | `none: seen only as a zombie, after it exited` |
| 75585 | rustc | 51109 | 51109 | 96984–97034 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name konst_kernel --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/konst_kernel- … (914 chars)` |
| 75590 | clang | 51109 | 75008 | 97034–97034 | no |  | `none: seen only as a zombie, after it exited` |
| 75596 | clang | 51109 | 75590 | 97034–97034 | no |  | `none: seen only as a zombie, after it exited` |
| 75597 | clang | 51109 | 75337 | 97034–97204 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcLpSQ5t/list /private/tmp/c335/tauri/target/debug/deps/rustcLpSQ5t/symbol … (26856 chars)` |
| 75599 | ld | 51109 | 75597 | 97102–97204 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (27019 chars)` |
| 75603 | clang | 51109 | 75008 | 97102–97102 | no |  | `none: seen only as a zombie, after it exited` |
| 75604 | rustc | 51109 | 51109 | 97102–97407 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pear_codegen --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pear_codegen- … (1048 chars)` |
| 75610 | clang | 51109 | 75603 | 97102–97102 | no |  | `none: seen only as a zombie, after it exited` |
| 75611 | rustc | 51109 | 51109 | 97102–97154 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bzip2 --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bzip2-0.4.4/src/lib. … (957 chars)` |
| 75616 | clang | 51109 | 75008 | 97154–97154 | no |  | `none: seen only as a zombie, after it exited` |
| 75617 | clang | 51109 | 75616 | 97154–97154 | no |  | `none: seen only as a zombie, after it exited` |
| 75622 | clang | 51109 | 75008 | 97204–97204 | no |  | `none: seen only as a zombie, after it exited` |
| 75624 | rustc | 51109 | 51109 | 97204–97305 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name twox_hash --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/twox-hash-1.6.3/ … (942 chars)` |
| 75634 | clang | 51109 | 75008 | 97254–97305 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I xz-5.2/src … (724 chars)` |
| 75636 | rustc | 51109 | 51109 | 97305–129251 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri --edition=2024 crates/tauri/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,artifacts,futur … (5397 chars)` |
| 75637 | clang | 51109 | 75634 | 97305–97305 | no |  | `none: seen only as a zombie, after it exited` |
| 75642 | clang | 51109 | 75008 | 97357–97357 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I xz-5.2/src … (722 chars)` |
| 75643 | rustc | 51109 | 51109 | 97357–97407 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rustls_pemfile --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustls-pemf … (827 chars)` |
| 75644 | clang | 51109 | 75642 | 97357–97357 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -cc1 -triple arm64-apple-macosx27.0.0 -O0 -Wundef-prefix=TARGET_OS_ -Wdeprecated-objc-isa-usage -Werror=deprecated-objc-isa-usage -Werror=implicit-fun … (3829 chars)` |
| 75649 | rustc | 51109 | 51109 | 97357–97407 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rusticata_macros --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rusticata … (752 chars)` |
| 75650 | clang | 51109 | 75604 | 97357–97407 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustckq1JNy/list /private/tmp/c335/tauri/target/debug/deps/rustckq1JNy/symbol … (4493 chars)` |
| 75652 | ld | 51109 | 75650 | 97407–97407 | no |  | `none: seen only as a zombie, after it exited` |
| 75656 | clang | 51109 | 75008 | 97407–97457 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I xz-5.2/src … (722 chars)` |
| 75658 | clang | 51109 | 75656 | 97457–97457 | no |  | `none: seen only as a zombie, after it exited` |
| 75659 | rustc | 51109 | 51109 | 97457–97705 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tokio_stream --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-stream- … (1236 chars)` |
| 75660 | rustc | 51109 | 51109 | 97457–98499 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name itertools --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/itertools-0.13.0 … (809 chars)` |
| 75661 | rustc | 51109 | 51109 | 97457–97705 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name jsonrpsee_types --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jsonrpsee- … (1194 chars)` |
| 75666 | clang | 51109 | 75008 | 97508–97508 | no |  | `none: seen only as a zombie, after it exited` |
| 75667 | clang | 51109 | 75666 | 97508–97508 | no |  | `none: seen only as a zombie, after it exited` |
| 75672 | clang | 51109 | 75008 | 97588–97588 | no |  | `none: seen only as a zombie, after it exited` |
| 75673 | clang | 51109 | 75672 | 97588–97588 | no |  | `none: seen only as a zombie, after it exited` |
| 75678 | (unknown) | 51109 | 75008 | 97652–97652 | no |  | `none: seen only as a zombie, with no name` |
| 75680 | rustc | 51109 | 51109 | 97652–97705 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name md5 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/md-5-0.10.6/src/lib.rs … (943 chars)` |
| 75685 | clang | 51109 | 75008 | 97705–97705 | no |  | `none: seen only as a zombie, after it exited` |
| 75686 | clang | 51109 | 75685 | 97705–97705 | no |  | `none: seen only as a zombie, after it exited` |
| 75689 | rustc | 51109 | 51109 | 97762–99272 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name snafu_derive --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/snafu-derive- … (1072 chars)` |
| 75695 | rustc | 51109 | 51109 | 97762–99220 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name clap_derive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/clap_derive-4. … (3236 chars)` |
| 75697 | rustc | 51109 | 51109 | 97762–98129 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name asn1_rs_derive --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/asn1-rs-der … (1030 chars)` |
| 75698 | rustc | 51109 | 51109 | 97762–97917 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name asn1_rs_impl --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/asn1-rs-impl- … (924 chars)` |
| 75702 | rustc | 51109 | 51109 | 97762–97762 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name core_maths --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/core_maths-0.1. … (742 chars)` |
| 75706 | clang | 51109 | 75008 | 97762–97762 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -O0 -ffunction-sections -fdata-sections -fPIC -g -gdwarf-2 -fno-omit-frame-pointer --target=arm64-apple-macosx -mmacosx-version-min=27.0 -I xz-5.2/src … (716 chars)` |
| 75713 | cc | 51109 | 75008 | 97814–97814 | no |  | `none: seen only as a zombie, after it exited` |
| 75715 | rustc | 51109 | 51109 | 97867–97917 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/figment … (943 chars)` |
| 75724 | clang | 51109 | 75008 | 97867–97867 | no |  | `none: seen only as a zombie, after it exited` |
| 75725 | clang | 51109 | 75698 | 97867–97867 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcSYYnLf/list /private/tmp/c335/tauri/target/debug/deps/rustcSYYnLf/symbol … (3874 chars)` |
| 75729 | xcrun | 51109 | 75715 | 97867–97867 | no |  | `none: seen only as a zombie, after it exited` |
| 75733 | clang | 51109 | 75715 | 97917–97917 | no |  | `none: seen only as a zombie, after it exited` |
| 75737 | clang | 51109 | 75008 | 97917–97917 | no |  | `none: seen only as a zombie, after it exited` |
| 75738 | ld | 51109 | 75733 | 97917–97917 | no |  | `none: seen only as a zombie, after it exited` |
| 75739 | clang | 51109 | 75737 | 97917–97917 | no |  | `none: seen only as a zombie, after it exited` |
| 75741 | rustc | 51109 | 51109 | 97971–98023 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/slotmap … (773 chars)` |
| 75742 | rustc | 51109 | 51109 | 97971–98076 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ref-cas … (635 chars)` |
| 75746 | clang | 51109 | 75008 | 97971–97971 | no |  | `none: seen only as a zombie, after it exited` |
| 75750 | xcrun | 51109 | 75741 | 97971–97971 | no |  | `none: seen only as a zombie, after it exited` |
| 75751 | clang | 51109 | 75746 | 97971–97971 | no |  | `none: seen only as a zombie, after it exited` |
| 75754 | clang | 51109 | 75741 | 98023–98023 | no |  | `none: seen only as a zombie, after it exited` |
| 75756 | ld | 51109 | 75754 | 98023–98023 | no |  | `none: seen only as a zombie, after it exited` |
| 75760 | clang | 51109 | 75008 | 98023–98023 | no |  | `none: seen only as a zombie, after it exited` |
| 75762 | clang | 51109 | 75760 | 98023–98023 | no |  | `none: seen only as a zombie, after it exited` |
| 75771 | clang | 51109 | 75697 | 98076–98129 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcNZPymc/list /private/tmp/c335/tauri/target/debug/deps/rustcNZPymc/symbol … (4200 chars)` |
| 75772 | clang | 51109 | 75742 | 98076–98076 | no |  | `none: seen only as a zombie, after it exited` |
| 75773 | rustc | 51109 | 51109 | 98076–98186 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/minicbo … (791 chars)` |
| 75777 | clang | 51109 | 75008 | 98076–98076 | no |  | `none: seen only as a zombie, after it exited` |
| 75778 | ld | 51109 | 75771 | 98076–98076 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (4363 chars)` |
| 75779 | ld | 51109 | 75772 | 98076–98076 | no |  | `none: seen only as a zombie, after it exited` |
| 75780 | clang | 51109 | 75777 | 98076–98076 | no |  | `none: seen only as a zombie, after it exited` |
| 75785 | clang | 51109 | 75008 | 98129–98129 | no |  | `none: seen only as a zombie, after it exited` |
| 75790 | clang | 51109 | 75785 | 98129–98129 | no |  | `none: seen only as a zombie, after it exited` |
| 75791 | clang | 51109 | 75773 | 98129–98129 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/minicbor-e8e88c8ca0ea786b/rustcRBjHd1/symbols.o /private/tmp/c335/tauri/target/debug/build/minicbor-e8e88c8 … (3242 chars)` |
| 75793 | rustc | 51109 | 51109 | 98186–98186 | no |  | `none: seen only as a zombie, after it exited` |
| 75794 | rustc | 51109 | 51109 | 98186–98236 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name const_panic --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/const_panic-0. … (820 chars)` |
| 75804 | ar | 51109 | 75008 | 98186–98186 | no |  | `none: seen only as a zombie, after it exited` |
| 75806 | rustc | 51109 | 51109 | 98236–98337 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name nonmax --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/nonmax-0.5.5/src/li … (716 chars)` |
| 75808 | rustc | 51109 | 51109 | 98236–98236 | no |  | `none: seen only as a zombie, after it exited` |
| 75809 | rustc | 51109 | 51109 | 98236–98236 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name unicode_id_start --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unicode-i … (667 chars)` |
| 75811 | rustc | 51109 | 51109 | 98286–98337 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name xz2 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/xz2-0.1.7/src/lib.rs - … (882 chars)` |
| 75813 | rustc | 51109 | 51109 | 98337–98446 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oid-reg … (813 chars)` |
| 75814 | rustc | 51109 | 51109 | 98337–98389 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zip-2.4 … (1139 chars)` |
| 75820 | rustc | 51109 | 51109 | 98389–98389 | no |  | `none: seen only as a zombie, after it exited` |
| 75821 | clang | 51109 | 75814 | 98389–98389 | no |  | `none: seen only as a zombie, after it exited` |
| 75823 | rustc | 51109 | 51109 | 98389–98446 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name shell_words --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/shell-words-1. … (717 chars)` |
| 75832 | ld | 51109 | 75821 | 98389–98389 | no |  | `none: seen only as a zombie, after it exited` |
| 75830 | rustc | 51109 | 51109 | 98446–98499 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name inlinable_string --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/inlinable … (696 chars)` |
| 75845 | clang | 51109 | 75813 | 98446–98446 | no |  | `none: seen only as a zombie, after it exited` |
| 75847 | rustc | 51109 | 51109 | 98446–98551 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/object- … (1274 chars)` |
| 75849 | rustc | 51109 | 51109 | 98499–98654 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name futures_timer --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-time … (706 chars)` |
| 75851 | rustc | 51109 | 51109 | 98499–98499 | no |  | `none: seen only as a zombie, after it exited` |
| 75858 | build-script-bui | 51109 | 51109 | 98551–98551 | no |  | `none: seen only as a zombie, after it exited` |
| 75861 | rustc | 51109 | 51109 | 98551–99272 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pear --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pear-0.2.9/src/lib.rs … (1041 chars)` |
| 75866 | rustc | 51109 | 51109 | 98551–100604 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rasn_derive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rasn-derive-0. … (1283 chars)` |
| 75867 | clang | 51109 | 75847 | 98551–98551 | no |  | `none: seen only as a zombie, after it exited` |
| 75868 | rustc | 51109 | 51109 | 98551–98603 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name strict_num --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/strict-num-0.1. … (863 chars)` |
| 75869 | ld | 51109 | 75867 | 98551–98551 | no |  | `none: seen only as a zombie, after it exited` |
| 75871 | build-script-build | 51109 | 51109 | 98603–98654 | no |  | `/private/tmp/c335/tauri/target/debug/build/object-26d6cdfaa98f3269/build-script-build` |
| 75872 | rustc | 51109 | 51109 | 98603–103591 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name jsonrpsee_core --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jsonrpsee-c … (3402 chars)` |
| 75874 | build-script-bui | 51109 | 51109 | 98654–98654 | no |  | `none: seen only as a zombie, after it exited` |
| 75878 | rustc | 51109 | 75871 | 98654–98654 | no |  | `none: seen only as a zombie, after it exited` |
| 75890 | rustc | 51109 | 51109 | 98704–98704 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cpio_archive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cpio-archive- … (1072 chars)` |
| 75894 | rustc | 51109 | 51109 | 98704–100419 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name apple_xar --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/apple-xar-0.20.0 … (3016 chars)` |
| 75896 | rustc | 51109 | 51109 | 98704–98925 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_index --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc_index-4.1.0/ … (1723 chars)` |
| 75903 | rustc | 51109 | 51109 | 98869–99057 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name konst --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/konst-0.3.16/src/lib … (1145 chars)` |
| 75951 | rustc | 51109 | 51109 | 98980–100293 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hashbrown --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hashbrown-0.15.5 … (955 chars)` |
| 76034 | build-script-build | 51109 | 51109 | 99110–99160 | no |  | `/private/tmp/c335/tauri/target/debug/build/minicbor-e8e88c8ca0ea786b/build-script-build` |
| 76088 | clang | 51109 | 75695 | 99160–99220 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcqNyAJn/list /private/tmp/c335/tauri/target/debug/deps/rustcqNyAJn/symbol … (4969 chars)` |
| 76089 | rustc | 51109 | 51109 | 99160–102268 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name asn1_rs --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/asn1-rs-0.6.2/src/ … (1532 chars)` |
| 76104 | ld | 51109 | 76088 | 99220–99220 | no |  | `none: seen only as a zombie, after it exited` |
| 76132 | build-script-build | 51109 | 51109 | 99220–99272 | no |  | `/private/tmp/c335/tauri/target/debug/build/ref-cast-133ead958f3a1551/build-script-build` |
| 76133 | clang | 51109 | 75689 | 99220–99272 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcEoQi33/list /private/tmp/c335/tauri/target/debug/deps/rustcEoQi33/symbol … (5687 chars)` |
| 76158 | ld | 51109 | 76133 | 99220–99220 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (5850 chars)` |
| 76197 | rustc | 51109 | 76132 | 99272–99272 | no |  | `none: seen only as a zombie, after it exited` |
| 76210 | rustc | 51109 | 51109 | 99326–99389 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name clap --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/clap-4.5.26/src/lib.r … (3447 chars)` |
| 76242 | rustc | 51109 | 51109 | 99326–99447 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name snafu --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/snafu-0.8.9/src/lib. … (1111 chars)` |
| 76244 | build-script-build | 51109 | 51109 | 99326–99389 | no |  | `/private/tmp/c335/tauri/target/debug/build/slotmap-0e3d1e3d4d67d1e3/build-script-build` |
| 76266 | build-script-build | 51109 | 51109 | 99326–99389 | no |  | `/private/tmp/c335/tauri/target/debug/build/figment-73e1a1e8fbe4c3ff/build-script-build` |
| 76282 | rustc | 51109 | 51109 | 99326–105249 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ttf_parser --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ttf-parser-0.25 … (1130 chars)` |
| 76356 | rustc | 51109 | 76266 | 99389–99389 | no |  | `none: seen only as a zombie, after it exited` |
| 76357 | rustc | 51109 | 76244 | 99389–99389 | no |  | `none: seen only as a zombie, after it exited` |
| 76379 | rustc | 51109 | 51109 | 99447–100669 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml-0.8.20/src/lib.r … (3348 chars)` |
| 76395 | rustc | 51109 | 51109 | 99447–99816 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rustls_native_certs --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustls … (999 chars)` |
| 76398 | rustc | 51109 | 51109 | 99535–99535 | no |  | `none: seen only as a zombie, after it exited` |
| 76451 | rustc | 51109 | 51109 | 99535–101081 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ruzstd --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ruzstd-0.7.3/src/li … (853 chars)` |
| 76472 | rustc | 51109 | 51109 | 99602–99754 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name derive_builder_macro --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/deriv … (929 chars)` |
| 76558 | clang | 51109 | 76472 | 99754–99754 | no |  | `none: seen only as a zombie, after it exited` |
| 76563 | ld | 51109 | 76558 | 99754–99754 | no |  | `none: seen only as a zombie, after it exited` |
| 76620 | rustc | 51109 | 51109 | 99816–100604 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name curve25519_dalek --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/curve2551 … (1181 chars)` |
| 76633 | rustc | 51109 | 51109 | 99869–99928 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name uncased --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/uncased-0.9.10/src … (782 chars)` |
| 76685 | rustc | 51109 | 51109 | 99995–102535 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name num_bigint_dig --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-bigint- … (1656 chars)` |
| 76928 | rustc | 51109 | 51109 | 100344–100604 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name primeorder --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/primeorder-0.13 … (804 chars)` |
| 76992 | rustc | 51109 | 51109 | 100472–100532 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name dragonbox_ecma --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dragonbox_e … (796 chars)` |
| 76997 | clang | 51109 | 75866 | 100532–100604 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustc4sD3VN/list /private/tmp/c335/tauri/target/debug/deps/rustc4sD3VN/symbol … (5902 chars)` |
| 77010 | ld | 51109 | 76997 | 100532–100604 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (6065 chars)` |
| 77053 | rustc | 51109 | 51109 | 100604–100979 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name signal_hook --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/signal-hook-0. … (946 chars)` |
| 77077 | rustc | 51109 | 51109 | 100669–100754 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name getrandom --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/getrandom-0.4.3/ … (1942 chars)` |
| 77093 | rustc | 51109 | 51109 | 100669–101348 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_diagnostics --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc_diagno … (3059 chars)` |
| 77100 | rustc | 51109 | 51109 | 100754–100754 | no |  | `none: seen only as a zombie, after it exited` |
| 77105 | rustc | 51109 | 51109 | 100754–102535 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name crypto_common --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crypto-commo … (1981 chars)` |
| 77176 | rustc | 51109 | 51109 | 100804–101133 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pkcs1 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pkcs1-0.7.5/src/lib. … (1055 chars)` |
| 77208 | rustc | 51109 | 51109 | 100804–102063 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hashbrown --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hashbrown-0.14.5 … (982 chars)` |
| 77549 | rustc | 51109 | 51109 | 101031–101031 | no |  | `none: seen only as a zombie, after it exited` |
| 77653 | rustc | 51109 | 51109 | 101081–117889 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name js_sys --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/js-sys-0.3.102/src/ … (1315 chars)` |
| 77769 | rustc | 51109 | 51109 | 101133–102840 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tungstenite --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tungstenite-0. … (1783 chars)` |
| 77860 | rustc | 51109 | 51109 | 101185–102636 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name soketto --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/soketto-0.8.1/src/ … (1446 chars)` |
| 78263 | rustc | 51109 | 51109 | 101451–101819 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cookie_factory --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cookie-fact … (882 chars)` |
| 78901 | rustc | 51109 | 51109 | 101876–102840 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name console --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/console-0.15.10/sr … (1091 chars)` |
| 79136 | rustc | 51109 | 51109 | 102115–102381 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name polycool --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/polycool-0.4.0/sr … (803 chars)` |
| 79479 | rustc | 51109 | 51109 | 102325–104055 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name png --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/png-0.17.16/src/lib.rs … (1194 chars)` |
| 79621 | rustc | 51109 | 51109 | 102432–102840 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name env_filter --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/env_filter-0.1. … (3048 chars)` |
| 79930 | rustc | 51109 | 51109 | 102636–102636 | no |  | `none: seen only as a zombie, after it exited` |
| 79935 | rustc | 51109 | 51109 | 102636–102636 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name des --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/des-0.8.1/src/lib.rs - … (741 chars)` |
| 80052 | rustc | 51109 | 51109 | 102686–102739 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rc2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rc2-0.8.1/src/lib.rs - … (741 chars)` |
| 80062 | rustc | 51109 | 51109 | 102686–103232 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ref_cast_impl --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ref-cast-imp … (927 chars)` |
| 80104 | rustc | 51109 | 51109 | 102739–104820 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name minicbor_derive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/minicbor-d … (987 chars)` |
| 80242 | rustc | 51109 | 51109 | 102790–102840 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name dirs_sys --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dirs-sys-0.4.1/sr … (837 chars)` |
| 80279 | rustc | 51109 | 51109 | 102892–103539 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name num_complex --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-complex-0. … (850 chars)` |
| 80308 | rustc | 51109 | 51109 | 102892–103021 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name filetime --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/filetime-0.2.25/s … (830 chars)` |
| 80316 | rustc | 51109 | 51109 | 102892–102892 | no |  | `none: seen only as a zombie, after it exited` |
| 80328 | rustc | 51109 | 51109 | 102892–103882 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name num_modular --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-modular-0. … (705 chars)` |
| 80492 | rustc | 51109 | 51109 | 103021–103021 | no |  | `none: seen only as a zombie, after it exited` |
| 80584 | rustc | 51109 | 51109 | 103073–104055 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name yasna --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/yasna-0.5.2/src/lib. … (738 chars)` |
| 80622 | rustc | 51109 | 51109 | 103073–103124 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name futures_task --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-task- … (891 chars)` |
| 80728 | rustc | 51109 | 51109 | 103177–103336 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name const_oid --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/const-oid-0.10.2 … (671 chars)` |
| 80736 | clang | 51109 | 80062 | 103177–103232 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustc8oIuId/list /private/tmp/c335/tauri/target/debug/deps/rustc8oIuId/symbol … (3878 chars)` |
| 80770 | ld | 51109 | 80736 | 103232–103232 | no |  | `none: seen only as a zombie, after it exited` |
| 80846 | rustc | 51109 | 51109 | 103285–104659 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name unsafe_libyaml --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unsafe-liby … (664 chars)` |
| 81059 | rustc | 51109 | 51109 | 103387–103488 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bytesize --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bytesize-1.3.0/sr … (693 chars)` |
| 81382 | rustc | 51109 | 51109 | 103539–103644 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name humantime --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/humantime-2.1.0/ … (653 chars)` |
| 81460 | rustc | 51109 | 51109 | 103591–103591 | no |  | `none: seen only as a zombie, after it exited` |
| 81516 | rustc | 51109 | 51109 | 103644–103644 | no |  | `none: seen only as a zombie, after it exited` |
| 81560 | rustc | 51109 | 51109 | 103742–103882 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name which --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/which-8.0.0/src/lib. … (921 chars)` |
| 81581 | rustc | 51109 | 51109 | 103742–103946 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/nix-0.2 … (1137 chars)` |
| 81592 | rustc | 51109 | 51109 | 103742–104766 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name p12 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/p12-0.6.3/src/lib.rs - … (1448 chars)` |
| 81726 | clang | 51109 | 81581 | 103946–103946 | no |  | `none: seen only as a zombie, after it exited` |
| 81732 | rustc | 51109 | 51109 | 103946–104055 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name num_order --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-order-1.2.0/ … (853 chars)` |
| 81742 | rustc | 51109 | 51109 | 103946–104447 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name env_logger --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/env_logger-0.11 … (3494 chars)` |
| 81762 | ld | 51109 | 81726 | 103946–103946 | no |  | `none: seen only as a zombie, after it exited` |
| 81978 | rustc | 51109 | 51109 | 104055–104124 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zip_structs --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zip_structs-0. … (946 chars)` |
| 82034 | rustc | 51109 | 51109 | 104124–104184 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ref_cast --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ref-cast-1.0.23/s … (832 chars)` |
| 82037 | rustc | 51109 | 51109 | 104124–104184 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name digest --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/digest-0.11.3/src/l … (2319 chars)` |
| 82054 | rustc | 51109 | 51109 | 104184–107662 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name futures_util --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-util- … (1658 chars)` |
| 82098 | rustc | 51109 | 51109 | 104184–106037 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tinyvec --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tinyvec-1.8.1/src/ … (1074 chars)` |
| 82181 | rustc | 51109 | 51109 | 104293–112414 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name goblin --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/goblin-0.9.3/src/li … (1315 chars)` |
| 82226 | rustc | 51109 | 51109 | 104293–105468 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tiny_skia_path --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tiny-skia-p … (1037 chars)` |
| 82446 | rustc | 51109 | 51109 | 104500–107194 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_yaml --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_yaml-0.9. … (1130 chars)` |
| 82861 | rustc | 51109 | 51109 | 104709–104709 | no |  | `none: seen only as a zombie, after it exited` |
| 82940 | rustc | 51109 | 51109 | 104766–105884 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name dialoguer --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dialoguer-0.11.0 … (1366 chars)` |
| 83108 | rustc | 51109 | 51109 | 104964–105369 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tokio_tungstenite --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-tu … (1427 chars)` |
| 83138 | rustc | 51109 | 51109 | 104964–107092 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name minicbor --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/minicbor-0.25.1/s … (968 chars)` |
| 83842 | rustc | 51109 | 51109 | 105310–106295 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rsa --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rsa-0.9.10/src/lib.rs  … (1970 chars)` |
| 83897 | rustc | 51109 | 51109 | 105418–107558 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name kurbo --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/kurbo-0.13.1/src/lib … (2418 chars)` |
| 83991 | rustc | 51109 | 51109 | 105569–117058 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rasn --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rasn-0.20.2/src/lib.r … (2316 chars)` |
| 84582 | rustc | 51109 | 51109 | 105986–105986 | no |  | `none: seen only as a zombie, after it exited` |
| 84652 | rustc | 51109 | 51109 | 106037–106295 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oid_registry --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oid-registry- … (923 chars)` |
| 84720 | rustc | 51109 | 51109 | 106088–106295 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name spake2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/spake2-0.4.0/src/li … (1108 chars)` |
| 84948 | rustc | 51109 | 51109 | 106359–108182 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_regular_expression --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc … (3580 chars)` |
| 84981 | rustc | 51109 | 51109 | 106359–106359 | no |  | `none: seen only as a zombie, after it exited` |
| 84999 | rustc | 51109 | 51109 | 106359–106835 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name p256 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/p256-0.13.2/src/lib.r … (1145 chars)` |
| 85115 | rustc | 51109 | 51109 | 106426–107403 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_syntax --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc_syntax-0.11 … (4047 chars)` |
| 85603 | rustc | 51109 | 51109 | 106887–116840 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name object --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/object-0.36.7/src/l … (1898 chars)` |
| 85790 | rustc | 51109 | 51109 | 107141–109113 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name figment --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/figment-0.10.19/sr … (1212 chars)` |
| 85903 | rustc | 51109 | 51109 | 107244–107296 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name derive_builder --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/derive_buil … (915 chars)` |
| 85960 | rustc | 51109 | 51109 | 107352–110324 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name apple_flat_package --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/apple-f … (1593 chars)` |
| 86011 | rustc | 51109 | 51109 | 107455–108702 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tungstenite --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tungstenite-0. … (2550 chars)` |
| 86154 | rustc | 51109 | 51109 | 107611–107868 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name slotmap --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/slotmap-1.0.7/src/ … (715 chars)` |
| 86212 | rustc | 51109 | 51109 | 107713–109010 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zip --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zip-2.4.2/src/lib.rs - … (1813 chars)` |
| 86308 | rustc | 51109 | 51109 | 107917–108647 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name apple_bundles --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/apple-bundle … (1054 chars)` |
| 86546 | rustc | 51109 | 51109 | 108285–108285 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name chacha20 --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/chacha20-0.10.2/s … (2255 chars)` |
| 86621 | rustc | 51109 | 51109 | 108387–111181 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name axum_core --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/axum-core-0.5.6/ … (3203 chars)` |
| 86884 | rustc | 51109 | 51109 | 108702–109010 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_path_to_error --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_ … (850 chars)` |
| 86892 | rustc | 51109 | 51109 | 108754–108808 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name memmap2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/memmap2-0.9.11/src … (757 chars)` |
| 86985 | rustc | 51109 | 51109 | 108859–108859 | no |  | `none: seen only as a zombie, after it exited` |
| 87025 | rustc | 51109 | 51109 | 108910–109010 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name phf_shared --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf_shared-0.14 … (759 chars)` |
| 87082 | rustc | 51109 | 51109 | 109062–109539 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bstr --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bstr-1.11.3/src/lib.r … (822 chars)` |
| 87083 | rustc | 51109 | 51109 | 109062–109062 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name unicode_ccc --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unicode-ccc-0. … (657 chars)` |
| 87086 | rustc | 51109 | 51109 | 109062–109171 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name difference --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/difference-2.0. … (706 chars)` |
| 87111 | rustc | 51109 | 51109 | 109171–109279 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name unicode_script --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unicode-scr … (726 chars)` |
| 87113 | rustc | 51109 | 51109 | 109171–109279 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name napi_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/napi-build-2.4. … (612 chars)` |
| 87132 | rustc | 51109 | 51109 | 109224–109224 | no |  | `none: seen only as a zombie, after it exited` |
| 87186 | rustc | 51109 | 51109 | 109279–109489 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unicode … (666 chars)` |
| 87208 | rustc | 51109 | 51109 | 109330–109330 | no |  | `none: seen only as a zombie, after it exited` |
| 87209 | rustc | 51109 | 51109 | 109330–109436 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name pico_args --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pico-args-0.5.0/ … (768 chars)` |
| 87214 | rustc | 51109 | 51109 | 109383–109383 | no |  | `none: seen only as a zombie, after it exited` |
| 87219 | rustc | 51109 | 51109 | 109383–109648 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name matchit --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/matchit-0.8.4/src/ … (700 chars)` |
| 87270 | rustc | 51109 | 51109 | 109436–117331 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rustybuzz --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustybuzz-0.20.1 … (1743 chars)` |
| 87276 | xcrun | 51109 | 87186 | 109436–109436 | no |  | `none: seen only as a zombie, after it exited` |
| 87283 | clang | 51109 | 87186 | 109489–109489 | no |  | `none: seen only as a zombie, after it exited` |
| 87294 | rustc | 51109 | 51109 | 109489–110604 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name globset --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/globset-0.4.20/src … (1241 chars)` |
| 87297 | ld | 51109 | 87283 | 109489–109489 | no |  | `none: seen only as a zombie, after it exited` |
| 87328 | build-script-build | 51109 | 51109 | 109539–109932 | no |  | `/private/tmp/c335/tauri/target/debug/build/unicode-general-category-d494d3df55ff4dff/build-script-build` |
| 87348 | rustc | 51109 | 51109 | 109596–110655 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name fluent_uri --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fluent-uri-0.4. … (1187 chars)` |
| 87438 | rustc | 51109 | 51109 | 109701–109754 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name phf_generator --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf_generato … (822 chars)` |
| 87463 | rustc | 51109 | 51109 | 109805–110707 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name fontdb --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fontdb-0.23.0/src/l … (1336 chars)` |
| 87614 | rustc | 51109 | 51109 | 109994–111669 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rand --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rand-0.10.2/src/lib.r … (1189 chars)` |
| 88200 | rustc | 51109 | 51109 | 110418–130439 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_ast --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc_ast-0.110.0/sr … (3739 chars)` |
| 88376 | rustc | 51109 | 51109 | 110655–131670 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name js_sys --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/js-sys-0.3.102/src/ … (1315 chars)` |
| 88450 | rustc | 51109 | 51109 | 110707–119402 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name handlebars --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/handlebars-6.3. … (1554 chars)` |
| 88467 | rustc | 51109 | 51109 | 110758–111881 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name svgtypes --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/svgtypes-0.16.1/s … (906 chars)` |
| 89096 | rustc | 51109 | 51109 | 111241–124122 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name axum --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/axum-0.8.9/src/lib.rs … (4892 chars)` |
| 89552 | rustc | 51109 | 51109 | 111719–111881 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name shared_child --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/shared_child- … (907 chars)` |
| 89934 | rustc | 51109 | 51109 | 111947–113029 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name fraction --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fraction-0.15.3/s … (1143 chars)` |
| 89989 | build-script-bui | 51109 | 51109 | 111947–111947 | no |  | `none: seen only as a zombie, after it exited` |
| 90070 | rustc | 51109 | 51109 | 112006–112955 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 examples/api/src-tauri/tauri-plugin-sample/build.rs --error-format=json --json … (750 chars)` |
| 90688 | clang | 51109 | 90070 | 112414–112757 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/tauri-plugin-sample-50806ab7d04bbcc4/rustco0MtNA/symbols.o /private/tmp/c335/tauri/target/debug/build/tauri … (15147 chars)` |
| 90725 | ld | 51109 | 90688 | 112414–112757 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (15323 chars)` |
| 90950 | rustc | 51109 | 51109 | 112598–113190 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-p … (772 chars)` |
| 91253 | clang | 51109 | 90950 | 112757–113190 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/tauri-plugin-log-22a99e1f99a12b11/rustcmSAtP7/symbols.o /private/tmp/c335/tauri/target/debug/build/tauri-pl … (14193 chars)` |
| 91283 | ld | 51109 | 91253 | 112955–113190 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (14369 chars)` |
| 91476 | rustc | 51109 | 51109 | 113084–113190 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rustls_platform_verifier --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/r … (1496 chars)` |
| 91484 | rustc | 51109 | 51109 | 113084–113311 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name xattr --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/xattr-1.6.1/src/lib. … (812 chars)` |
| 91971 | rustc | 51109 | 51109 | 113258–114635 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ureq_proto --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ureq-proto-0.5. … (1065 chars)` |
| 91979 | rustc | 51109 | 51109 | 113311–113311 | no |  | `none: seen only as a zombie, after it exited` |
| 92182 | rustc | 51109 | 51109 | 113371–116840 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name strum_macros --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/strum_macros- … (1011 chars)` |
| 92191 | rustc | 51109 | 51109 | 113371–114879 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name hashbrown --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hashbrown-0.17.1 … (2055 chars)` |
| 94388 | rustc | 51109 | 51109 | 114691–114771 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name fsevent_sys --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fsevent-sys-4. … (744 chars)` |
| 94498 | rustc | 51109 | 51109 | 114822–114879 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rtoolbox --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rtoolbox-0.0.2/sr … (745 chars)` |
| 94626 | rustc | 51109 | 51109 | 114929–115473 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name socks --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/socks-0.3.4/src/lib. … (829 chars)` |
| 94650 | rustc | 51109 | 51109 | 114929–115880 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name simplecss --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/simplecss-0.2.2/ … (2526 chars)` |
| 95542 | rustc | 51109 | 51109 | 115560–165892 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name apple_codesign --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/apple-codes … (7536 chars)` |
| 96017 | rustc | 51109 | 51109 | 115936–117528 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name roxmltree --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/roxmltree-0.21.1 … (844 chars)` |
| 96807 | (unknown) | 51109 | 92182 | 116726–116726 | no |  | `none: seen only as a zombie, with no name` |
| 96841 | clang | 51109 | 92182 | 116785–116840 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustc1Fpa8c/list /private/tmp/c335/tauri/target/debug/deps/rustc1Fpa8c/symbol … (5687 chars)` |
| 96878 | ld | 51109 | 96841 | 116785–116840 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (5850 chars)` |
| 97073 | rustc | 51109 | 51109 | 116943–121096 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name encoding_rs --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/encoding_rs-0. … (1080 chars)` |
| 97128 | rustc | 51109 | 51109 | 116943–117115 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name stfu8 --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/stfu8-0.2.7/src/lib. … (713 chars)` |
| 97303 | rustc | 51109 | 51109 | 117115–117663 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name route_recognizer --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/route-rec … (667 chars)` |
| 97413 | rustc | 51109 | 51109 | 117165–117165 | no |  | `none: seen only as a zombie, after it exited` |
| 97508 | rustc | 51109 | 51109 | 117215–117215 | no |  | `none: seen only as a zombie, after it exited` |
| 97567 | rustc | 51109 | 51109 | 117331–117331 | no |  | `none: seen only as a zombie, after it exited` |
| 97706 | rustc | 51109 | 51109 | 117391–117794 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name num_cmp --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-cmp-0.1.0/src/ … (655 chars)` |
| 97735 | rustc | 51109 | 51109 | 117391–118171 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name vsimd --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/vsimd-0.8.0/src/lib. … (746 chars)` |
| 98009 | rustc | 51109 | 51109 | 117614–117794 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name notify_types --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/notify-types- … (704 chars)` |
| 98093 | rustc | 51109 | 51109 | 117737–117737 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name shared_thread --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/shared_threa … (661 chars)` |
| 98114 | rustc | 51109 | 51109 | 117889–118008 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name xmlwriter --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/xmlwriter-0.1.0/ … (653 chars)` |
| 98117 | rustc | 51109 | 51109 | 117889–117939 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/object- … (1428 chars)` |
| 98123 | rustc | 51109 | 51109 | 117889–118171 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name data_url --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/data-url-0.3.1/sr … (742 chars)` |
| 98178 | clang | 51109 | 98117 | 117939–117939 | no |  | `none: seen only as a zombie, after it exited` |
| 98195 | ld | 51109 | 98178 | 117939–117939 | no |  | `none: seen only as a zombie, after it exited` |
| 98197 | rustc | 51109 | 51109 | 117939–118008 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cargo-m … (839 chars)` |
| 98283 | rustc | 51109 | 51109 | 118008–118008 | no |  | `none: seen only as a zombie, after it exited` |
| 98295 | clang | 51109 | 98197 | 118008–118008 | no |  | `none: seen only as a zombie, after it exited` |
| 98325 | ld | 51109 | 98295 | 118008–118008 | no |  | `none: seen only as a zombie, after it exited` |
| 98341 | rustc | 51109 | 51109 | 118120–118864 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name imagesize --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/imagesize-0.14.0 … (1313 chars)` |
| 98342 | rustc | 51109 | 51109 | 118120–121216 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name typed_path --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/typed-path-0.12 … (716 chars)` |
| 98358 | rustc | 51109 | 51109 | 118120–118743 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name micromap --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/micromap-0.3.0/sr … (700 chars)` |
| 98617 | rustc | 51109 | 51109 | 118223–119696 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name unicode_bidi --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unicode-bidi- … (859 chars)` |
| 98694 | rustc | 51109 | 51109 | 118223–118385 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name uuid_simd --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/uuid-simd-0.8.0/ … (953 chars)` |
| 99031 | build-script-bui | 51109 | 51109 | 118488–118488 | no |  | `none: seen only as a zombie, after it exited` |
| 99191 | rustc | 51109 | 51109 | 118548–119402 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name path_abs --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/path_abs-0.5.1/sr … (1212 chars)` |
| 99596 | rustc | 51109 | 51109 | 118864–121502 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name referencing --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/referencing-0. … (1981 chars)` |
| 99715 | build-script-build | 51109 | 51109 | 118932–118981 | no |  | `/private/tmp/c335/tauri/target/debug/build/object-7fa5fca071905aaf/build-script-build` |
| 99875 | rustc | 51109 | 51109 | 119035–120201 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name duct --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/duct-1.1.1/src/lib.rs … (1099 chars)` |
| 725 | rustc | 51109 | 51109 | 119502–129251 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name usvg --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/usvg-0.47.0/src/lib.r … (2950 chars)` |
| 895 | rustc | 51109 | 51109 | 119502–120148 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name jsonschema_value --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jsonschem … (1904 chars)` |
| 1200 | rustc | 51109 | 51109 | 119747–121438 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name notify --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/notify-8.2.0/src/li … (1432 chars)` |
| 1630 | rustc | 51109 | 51109 | 120201–120612 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name java_properties --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/java-prope … (956 chars)` |
| 1694 | rustc | 51109 | 51109 | 120304–123637 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name jsonrpsee_server --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jsonrpsee … (2685 chars)` |
| 2073 | rustc | 51109 | 51109 | 120662–120728 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name strum --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/strum-0.28.0/src/lib … (894 chars)` |
| 2158 | rustc | 51109 | 51109 | 120834–124474 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name zip --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zip-8.0.0/src/lib.rs - … (1761 chars)` |
| 2275 | rustc | 51109 | 51109 | 121164–129745 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name web_sys --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/web-sys-0.3.102/sr … (40062 chars)` |
| 2408 | rustc | 51109 | 51109 | 121285–126114 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ureq --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ureq-3.1.4/src/lib.rs … (2232 chars)` |
| 2501 | rustc | 51109 | 51109 | 121502–121823 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rpassword --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rpassword-7.5.4/ … (835 chars)` |
| 2547 | rustc | 51109 | 51109 | 121698–121951 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name scrypt --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/scrypt-0.11.0/src/l … (962 chars)` |
| 2791 | build-script-build | 51109 | 51109 | 121951–122007 | no |  | `/private/tmp/c335/tauri/target/debug/build/tauri-plugin-log-22a99e1f99a12b11/build-script-build` |
| 2879 | rustc | 51109 | 51109 | 122007–124649 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tar --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tar-0.4.46/src/lib.rs  … (994 chars)` |
| 3038 | build-script-build | 51109 | 51109 | 122093–122247 | no |  | `/private/tmp/c335/tauri/target/debug/build/tauri-plugin-sample-50806ab7d04bbcc4/build-script-build` |
| 3219 | rustc | 51109 | 51109 | 122300–125371 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name nix --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/nix-0.29.0/src/lib.rs  … (2133 chars)` |
| 4762 | rustc | 51109 | 51109 | 123795–125008 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name unicode_general_category --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/u … (683 chars)` |
| 5447 | rustc | 51109 | 51109 | 124258–128092 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ignore --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ignore-0.4.33/src/l … (1335 chars)` |
| 6034 | rustc | 51109 | 51109 | 124649–125504 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name phf_macros --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf_macros-0.14 … (1178 chars)` |
| 6352 | rustc | 51109 | 51109 | 124706–126456 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name sha2 --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sha2-0.11.0/src/lib.r … (1409 chars)` |
| 6836 | rustc | 51109 | 51109 | 125059–125371 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name sha1 --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sha1-0.11.0/src/lib.r … (1125 chars)` |
| 7421 | rustc | 51109 | 51109 | 125504–127747 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_ecmascript --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc_ecmascr … (3568 chars)` |
| 7493 | rustc | 51109 | 51109 | 125504–131066 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tiny_skia --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tiny-skia-0.12.0 … (1453 chars)` |
| 7495 | clang | 51109 | 6034 | 125504–125504 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcjYegez/list /private/tmp/c335/tauri/target/debug/deps/rustcjYegez/symbol … (4622 chars)` |
| 7544 | ld | 51109 | 7495 | 125504–125504 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (4785 chars)` |
| 7759 | rustc | 51109 | 51109 | 125671–126643 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_icns --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-icns-0.1. … (928 chars)` |
| 8605 | rustc | 51109 | 51109 | 126201–127093 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name jsonrpsee_client_transport --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f … (2421 chars)` |
| 8995 | rustc | 51109 | 51109 | 126593–127280 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name colored --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/colored-2.2.0/src/ … (760 chars)` |
| 9203 | rustc | 51109 | 51109 | 126703–127688 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name console --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/console-0.16.4/src … (1051 chars)` |
| 9960 | rustc | 51109 | 51109 | 127196–127432 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name email_address --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/email_addres … (861 chars)` |
| 10205 | rustc | 51109 | 51109 | 127375–128172 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name os_info --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/os_info-3.9.2/src/ … (887 chars)` |
| 10408 | rustc | 51109 | 51109 | 127508–131924 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name fancy_regex --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fancy-regex-0. … (1162 chars)` |
| 10770 | rustc | 51109 | 51109 | 127747–131865 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name strum_macros --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/strum_macros- … (1011 chars)` |
| 10866 | rustc | 51109 | 51109 | 127832–128243 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ordered_float --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ordered-floa … (895 chars)` |
| 11329 | rustc | 51109 | 51109 | 128172–128339 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name jsonschema_regex --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jsonschem … (1265 chars)` |
| 11401 | rustc | 51109 | 51109 | 128243–128644 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name include_dir_macros --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/include … (873 chars)` |
| 11566 | rustc | 51109 | 51109 | 128405–128780 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name phf_shared --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf_shared-0.14 … (822 chars)` |
| 11688 | rustc | 51109 | 51109 | 128405–128463 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/signal- … (795 chars)` |
| 11852 | cc | 51109 | 11688 | 128463–128463 | no |  | `none: seen only as a zombie, after it exited` |
| 12001 | rustc | 51109 | 51109 | 128576–128576 | no |  | `none: seen only as a zombie, after it exited` |
| 12071 | clang | 51109 | 11401 | 128644–128644 | no |  | `none: seen only as a zombie, after it exited` |
| 12130 | ld | 51109 | 12071 | 128644–128644 | no |  | `none: seen only as a zombie, after it exited` |
| 12152 | rustc | 51109 | 51109 | 128644–128780 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ct_codecs --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ct-codecs-1.1.7/ … (713 chars)` |
| 12343 | rustc | 51109 | 51109 | 128706–129178 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name english_numbers --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/english-nu … (665 chars)` |
| 12534 | rustc | 51109 | 51109 | 128890–128954 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 crates/tauri-cli/build.rs --error-format=json --json=diagnostic-rendered-ansi, … (885 chars)` |
| 12562 | rustc | 51109 | 51109 | 128890–128890 | no |  | `none: seen only as a zombie, after it exited` |
| 12753 | clang | 51109 | 12534 | 128954–128954 | no |  | `none: seen only as a zombie, after it exited` |
| 12756 | rustc | 51109 | 51109 | 128954–129475 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name seq_macro --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/seq-macro-0.3.6/ … (646 chars)` |
| 12818 | ld | 51109 | 12753 | 128954–128954 | no |  | `none: seen only as a zombie, after it exited` |
| 12969 | rustc | 51109 | 51109 | 129011–129075 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name home --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/home-0.5.9/src/lib.rs … (882 chars)` |
| 13052 | rustc | 51109 | 51109 | 129178–129322 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name deunicode --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/deunicode-1.6.0/ … (717 chars)` |
| 13236 | rustc | 51109 | 51109 | 129251–129745 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bytesize --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bytesize-2.7.0/sr … (829 chars)` |
| 13306 | rustc | 51109 | 51109 | 129322–129745 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name base64 --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/base64-0.13.1/src/l … (717 chars)` |
| 13310 | rustc | 51109 | 51109 | 129322–157437 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cargo_mobile2 --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cargo-mobile … (3387 chars)` |
| 13364 | rustc | 51109 | 51109 | 129387–135889 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name web_sys --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/web-sys-0.3.102/sr … (39387 chars)` |
| 13392 | clang | 51109 | 12756 | 129387–129475 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcZHeake/list /private/tmp/c335/tauri/target/debug/deps/rustcZHeake/symbol … (3776 chars)` |
| 13407 | ld | 51109 | 13392 | 129475–129475 | no |  | `none: seen only as a zombie, after it exited` |
| 13487 | rustc | 51109 | 51109 | 129685–139158 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name oxc_parser --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/oxc_parser-0.11 … (4381 chars)` |
| 13939 | rustc | 51109 | 51109 | 129897–130919 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name magic_string --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/magic_string- … (1145 chars)` |
| 13940 | rustc | 51109 | 51109 | 129897–132881 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name resvg --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/resvg-0.47.0/src/lib … (1740 chars)` |
| 14076 | rustc | 51109 | 51109 | 129897–130439 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name notify_debouncer_full --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/noti … (1315 chars)` |
| 14838 | rustc | 51109 | 51109 | 130531–164769 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name jsonschema --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jsonschema-0.49 … (3296 chars)` |
| 14840 | rustc | 51109 | 51109 | 130531–130711 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name phf --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf-0.14.0/src/lib.rs  … (1016 chars)` |
| 15169 | rustc | 51109 | 51109 | 130775–131066 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name include_dir --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/include_dir-0. … (836 chars)` |
| 15469 | rustc | 51109 | 51109 | 131007–133471 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name minisign --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/minisign-0.9.1/sr … (1033 chars)` |
| 15603 | build-script-build | 51109 | 51109 | 131139–131285 | no |  | `/private/tmp/c335/tauri/target/debug/build/signal-hook-2efbacc890eb209d/build-script-build` |
| 15606 | rustc | 51109 | 51109 | 131139–132039 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_value --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-value-0. … (851 chars)` |
| 15793 | rustc | 51109 | 51109 | 131378–132816 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name dialoguer --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dialoguer-0.12.0 … (1269 chars)` |
| 16483 | rustc | 51109 | 51109 | 131728–131865 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name jsonrpsee_ws_client --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jsonrp … (1486 chars)` |
| 16484 | clang | 51109 | 10770 | 131728–131865 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcM6pQRW/list /private/tmp/c335/tauri/target/debug/deps/rustcM6pQRW/symbol … (5687 chars)` |
| 16517 | ld | 51109 | 16484 | 131728–131865 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (5850 chars)` |
| 16727 | rustc | 51109 | 51109 | 131924–131985 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ctrlc --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ctrlc-3.4.5/src/lib. … (743 chars)` |
| 16729 | rustc | 51109 | 51109 | 131985–132039 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name strum --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/strum-0.27.2/src/lib … (894 chars)` |
| 16743 | rustc | 51109 | 51109 | 131985–131985 | no |  | `none: seen only as a zombie, after it exited` |
| 16796 | rustc | 51109 | 51109 | 132039–134743 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name object --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/object-0.39.1/src/l … (1581 chars)` |
| 16801 | rustc | 51109 | 51109 | 132039–132039 | no |  | `none: seen only as a zombie, after it exited` |
| 16809 | rustc | 51109 | 51109 | 132166–132233 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/napi-3. … (1506 chars)` |
| 16815 | rustc | 51109 | 51109 | 132166–133314 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name clap_complete --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/clap_complet … (2989 chars)` |
| 16834 | rustc | 51109 | 51109 | 132166–133365 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 examples/api/src-tauri/build.rs --error-format=json --json=diagnostic-rendered … (732 chars)` |
| 16851 | xcrun | 51109 | 16809 | 132166–132166 | no |  | `none: seen only as a zombie, after it exited` |
| 16874 | clang | 51109 | 16809 | 132233–132233 | no |  | `none: seen only as a zombie, after it exited` |
| 16896 | ld | 51109 | 16874 | 132233–132233 | no |  | `none: seen only as a zombie, after it exited` |
| 16974 | rustc | 51109 | 51109 | 132291–132537 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name convert_case --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/convert_case- … (736 chars)` |
| 17297 | rustc | 51109 | 51109 | 132632–136256 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name toml_edit --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_edit-0.25.4 … (3768 chars)` |
| 17343 | (unknown) | 51109 | 16834 | 132687–132687 | no |  | `none: seen only as a zombie, with no name` |
| 17361 | clang | 51109 | 16834 | 132755–133365 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/api-1ac6281d5674d555/rustcilrW35/symbols.o /private/tmp/c335/tauri/target/debug/build/api-1ac6281d5674d555/ … (16748 chars)` |
| 17376 | ld | 51109 | 17361 | 132755–133365 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (16924 chars)` |
| 17462 | rustc | 51109 | 51109 | 132881–136256 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name itertools --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/itertools-0.15.0 … (852 chars)` |
| 17633 | rustc | 51109 | 51109 | 132969–133471 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name rustc_version --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustc_versio … (752 chars)` |
| 18166 | rustc | 51109 | 51109 | 133365–138013 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_macos_sign --edition=2024 crates/tauri-macos-sign/src/lib.rs --error-format=json --json=diagnostic-rendere … (2506 chars)` |
| 18257 | rustc | 51109 | 51109 | 133471–133635 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name local_ip_address --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/local-ip- … (851 chars)` |
| 18331 | rustc | 51109 | 51109 | 133535–134270 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name fern --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fern-0.7.1/src/lib.rs … (935 chars)` |
| 18335 | rustc | 51109 | 51109 | 133535–133635 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name libloading --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libloading-0.9. … (907 chars)` |
| 18383 | rustc | 51109 | 51109 | 133688–133928 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ar --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ar-0.9.0/src/lib.rs --e … (639 chars)` |
| 18391 | rustc | 51109 | 51109 | 133688–134630 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name elf --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/elf-0.8.0/src/lib.rs - … (765 chars)` |
| 18528 | rustc | 51109 | 51109 | 134010–134479 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name colored --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/colored-3.1.1/src/ … (1060 chars)` |
| 18999 | rustc | 51109 | 51109 | 134325–134427 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name css_color --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/css-color-0.2.8/ … (660 chars)` |
| 19259 | rustc | 51109 | 51109 | 134479–134479 | no |  | `none: seen only as a zombie, after it exited` |
| 19274 | rustc | 51109 | 51109 | 134529–134805 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name sublime_fuzzy --edition=2015 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sublime_fuzz … (701 chars)` |
| 19277 | rustc | 51109 | 51109 | 134529–135458 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_plugin_log --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plu … (1579 chars)` |
| 19295 | rustc | 51109 | 51109 | 134686–135706 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name napi_sys --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/napi-sys-3.3.0/sr … (997 chars)` |
| 19310 | rustc | 51109 | 51109 | 134805–158437 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_bundler --edition=2024 crates/tauri-bundler/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi … (4068 chars)` |
| 19323 | build-script-build | 51109 | 51109 | 134860–135706 | no |  | `/private/tmp/c335/tauri/target/debug/build/api-1ac6281d5674d555/build-script-build` |
| 19770 | rustc | 51109 | 51109 | 135523–135762 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name embed_resource --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/embed-resou … (1029 chars)` |
| 20175 | rustc | 51109 | 51109 | 135762–140091 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name worker_sys --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/worker-sys-0.8. … (1087 chars)` |
| 20195 | rustc | 51109 | 51109 | 135762–142481 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name napi_derive_backend --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/napi-d … (1219 chars)` |
| 20242 | build-script-build | 51109 | 51109 | 135837–135837 | no |  | `/private/tmp/c335/tauri/target/debug/build/napi-dac7d8c74bd1c631/build-script-build` |
| 20265 | rustc | 51109 | 51109 | 135957–137536 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name wasm_streams --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-streams- … (1175 chars)` |
| 20292 | rustc | 51109 | 51109 | 135957–136662 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name signal_hook --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/signal-hook-0. … (1018 chars)` |
| 20584 | rustc | 51109 | 51109 | 136340–137891 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_plugin_sample --edition=2024 examples/api/src-tauri/tauri-plugin-sample/src/lib.rs --error-format=json --j … (1284 chars)` |
| 20593 | rustc | 51109 | 51109 | 136340–141043 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name worker_sys --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/worker-sys-0.8. … (1087 chars)` |
| 20999 | rustc | 51109 | 51109 | 136789–137429 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name serde_wasm_bindgen --edition=2018 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-w … (954 chars)` |
| 21781 | clang | 51109 | 20265 | 137429–137536 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcGBND2a/list /private/tmp/c335/tauri/target/debug/deps/rustcGBND2a/symbol … (4760 chars)` |
| 21866 | rustc | 51109 | 51109 | 137536–137679 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 packages/cli/build.rs --error-format=json --json=diagnostic-rendered-ansi,arti … (902 chars)` |
| 21918 | rustc | 51109 | 51109 | 137622–138814 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 bench/tests/files_transfer/src-tauri/build.rs --error-format=json --json=diagn … (864 chars)` |
| 21962 | clang | 51109 | 21866 | 137622–137679 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/tauri-cli-node-3df2535c90dd7377/rustcxLDBx0/symbols.o /private/tmp/c335/tauri/target/debug/build/tauri-cli- … (3952 chars)` |
| 21996 | ld | 51109 | 21962 | 137679–137679 | no |  | `none: seen only as a zombie, after it exited` |
| 22067 | rustc | 51109 | 51109 | 137757–138962 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 bench/tests/cpu_intensive/src-tauri/build.rs --error-format=json --json=diagno … (862 chars)` |
| 22154 | rustc | 51109 | 51109 | 137960–139305 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 crates/tauri-schema-generator/build.rs --error-format=json --json=diagnostic-r … (1223 chars)` |
| 22219 | xcrun | 51109 | 21918 | 138013–138013 | no |  | `none: seen only as a zombie, after it exited` |
| 22227 | clang | 51109 | 21918 | 138093–138814 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/bench_files_transfer-08199ffa758f8136/rustcHq19Ak/symbols.o /private/tmp/c335/tauri/target/debug/build/benc … (16743 chars)` |
| 22250 | ld | 51109 | 22227 | 138093–138814 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (16919 chars)` |
| 22251 | clang | 51109 | 22067 | 138093–138962 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/bench_cpu_intensive-3e15bf2247b31ed2/rustcUGuYLW/symbols.o /private/tmp/c335/tauri/target/debug/build/bench … (16735 chars)` |
| 22261 | rustc | 51109 | 51109 | 138208–139158 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 examples/resources/src-tauri/build.rs --error-format=json --json=diagnostic-re … (724 chars)` |
| 22262 | ld | 51109 | 22251 | 138208–138962 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (16911 chars)` |
| 22507 | xcrun | 51109 | 22261 | 138452–138452 | no |  | `none: seen only as a zombie, after it exited` |
| 22562 | clang | 51109 | 22261 | 138583–139158 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/resources-2a35ddaecb2f58cb/rustcBoSHs3/symbols.o /private/tmp/c335/tauri/target/debug/build/resources-2a35d … (16655 chars)` |
| 22619 | ld | 51109 | 22562 | 138583–139158 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (16831 chars)` |
| 23171 | clang | 51109 | 22154 | 138962–139305 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/tauri-schema-generator-37dbe2b27e4f6d18/rustcIUSr4N/symbols.o /private/tmp/c335/tauri/target/debug/build/ta … (19257 chars)` |
| 23201 | rustc | 51109 | 51109 | 138962–140156 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 examples/file-associations/src-tauri/build.rs --error-format=json --json=diagn … (751 chars)` |
| 23215 | ld | 51109 | 23171 | 138962–139305 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (19433 chars)` |
| 23273 | rustc | 51109 | 51109 | 139053–139864 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 bench/tests/helloworld/src-tauri/build.rs --error-format=json --json=diagnosti … (856 chars)` |
| 23601 | rustc | 51109 | 51109 | 139231–139391 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name matchit --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/matchit-0.7.3/src/ … (700 chars)` |
| 23646 | (unknown) | 51109 | 51109 | 139305–139305 | no |  | `none: seen only as a zombie, with no name` |
| 23674 | clang | 51109 | 23273 | 139305–139864 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/bench_helloworld-e85b4dbc2e02b05a/rustcrDzhkl/symbols.o /private/tmp/c335/tauri/target/debug/build/bench_he … (16711 chars)` |
| 23750 | ld | 51109 | 23674 | 139305–139864 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (16887 chars)` |
| 23806 | rustc | 51109 | 51109 | 139391–139482 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 crates/tests/restart/build.rs --error-format=json --json=diagnostic-rendered-a … (662 chars)` |
| 23879 | clang | 51109 | 23201 | 139391–140156 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/tauri-file-associations-demo-3ff2861118827bc3/rustcO0MTTL/symbols.o /private/tmp/c335/tauri/target/debug/bu … (16807 chars)` |
| 23881 | build-script-build | 51109 | 51109 | 139391–139482 | no |  | `/private/tmp/c335/tauri/target/debug/build/tauri-schema-generator-37dbe2b27e4f6d18/build-script-build` |
| 23918 | ld | 51109 | 23879 | 139482–140156 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (16983 chars)` |
| 23947 | clang | 51109 | 23806 | 139482–139482 | no |  | `none: seen only as a zombie, after it exited` |
| 23948 | rustc | 51109 | 51109 | 139482–157100 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name napi --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/napi-3.12.2/src/lib.r … (2118 chars)` |
| 23968 | ld | 51109 | 23947 | 139482–139482 | no |  | `none: seen only as a zombie, after it exited` |
| 24031 | build-script-bui | 51109 | 51109 | 139564–139564 | no |  | `none: seen only as a zombie, after it exited` |
| 24081 | build-script-build | 51109 | 51109 | 139641–139973 | no |  | `/private/tmp/c335/tauri/target/debug/build/resources-2a35ddaecb2f58cb/build-script-build` |
| 24132 | build-script-build | 51109 | 51109 | 139641–139973 | no |  | `/private/tmp/c335/tauri/target/debug/build/bench_cpu_intensive-3e15bf2247b31ed2/build-script-build` |
| 24422 | build-script-build | 51109 | 51109 | 139973–140343 | no |  | `/private/tmp/c335/tauri/target/debug/build/bench_helloworld-e85b4dbc2e02b05a/build-script-build` |
| 24551 | build-script-build | 51109 | 51109 | 140033–140405 | no |  | `/private/tmp/c335/tauri/target/debug/build/bench_files_transfer-08199ffa758f8136/build-script-build` |
| 24581 | rustc | 51109 | 51109 | 140033–175038 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name api_lib --edition=2024 examples/api/src-tauri/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,art … (1427 chars)` |
| 24709 | rustc | 51109 | 51109 | 140156–141331 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name worker_macros --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/worker-macro … (1503 chars)` |
| 24827 | build-script-build | 51109 | 51109 | 140273–140562 | no |  | `/private/tmp/c335/tauri/target/debug/build/tauri-file-associations-demo-3ff2861118827bc3/build-script-build` |
| 25088 | build-script-bui | 51109 | 51109 | 140405–140405 | no |  | `none: seen only as a zombie, after it exited` |
| 25167 | rustc | 51109 | 51109 | 140562–140562 | no |  | `none: seen only as a zombie, after it exited` |
| 25232 | rustc | 51109 | 51109 | 140562–141331 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_winres --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-winres- … (942 chars)` |
| 25322 | rustc | 51109 | 51109 | 140711–142075 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name ico --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ico-0.5.0/src/lib.rs - … (830 chars)` |
| 25392 | rustc | 51109 | 51109 | 140711–140711 | no |  | `none: seen only as a zombie, after it exited` |
| 25548 | rustc | 51109 | 51109 | 140845–151434 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cargo_toml --edition=2024 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cargo_toml-1.0. … (939 chars)` |
| 25942 | rustc | 51109 | 51109 | 141106–154389 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name syn --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/syn-2.0.117/src/lib.rs … (1243 chars)` |
| 25996 | clang | 51109 | 24709 | 141106–141331 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcxTozux/list /private/tmp/c335/tauri/target/debug/deps/rustcxTozux/symbol … (4441 chars)` |
| 26022 | ld | 51109 | 25996 | 141197–141331 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (4604 chars)` |
| 26350 | rustc | 51109 | 51109 | 141442–171933 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_file_associations_demo --edition=2024 examples/file-associations/src-tauri/src/main.rs --error-format=json … (1209 chars)` |
| 26374 | rustc | 51109 | 51109 | 141561–150799 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name worker --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/worker-0.8.5/src/li … (3095 chars)` |
| 27170 | rustc | 51109 | 51109 | 142170–142230 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_driver --edition=2024 crates/tauri-driver/src/main.rs --error-format=json --json=diagnostic-rendered-ansi, … (1994 chars)` |
| 27315 | clang | 51109 | 27170 | 142230–142230 | no |  | `none: seen only as a zombie, after it exited` |
| 27513 | rustc | 51109 | 51109 | 142328–172592 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bench_files_transfer --edition=2024 bench/tests/files_transfer/src-tauri/src/main.rs --error-format=json --json= … (1238 chars)` |
| 27720 | rustc | 51109 | 51109 | 142629–144683 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name napi_derive --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/napi-derive-3. … (1400 chars)` |
| 30286 | clang | 51109 | 27720 | 144455–144455 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcsuPm3m/list /private/tmp/c335/tauri/target/debug/deps/rustcsuPm3m/symbol … (5304 chars)` |
| 30312 | ld | 51109 | 30286 | 144455–144455 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (5467 chars)` |
| 30564 | rustc | 51109 | 51109 | 144854–173208 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bench_helloworld --edition=2024 bench/tests/helloworld/src-tauri/src/main.rs --error-format=json --json=diagnost … (1230 chars)` |
| 39025 | rustc | 51109 | 51109 | 150885–178006 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_cli --edition=2024 crates/tauri-cli/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,artifac … (8083 chars)` |
| 39728 | rustc | 51109 | 51109 | 151520–152816 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_schema_worker --edition=2024 crates/tauri-schema-worker/src/lib.rs --error-format=json --json=diagnostic-r … (1462 chars)` |
| 41265 | clang | 51109 | 39728 | 152533–152816 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustc302wN8/list /private/tmp/c335/tauri/target/debug/deps/rustc302wN8/symbol … (12617 chars)` |
| 41306 | ld | 51109 | 41265 | 152679–152816 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (12780 chars)` |
| 41648 | rustc | 51109 | 51109 | 152908–158355 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_codegen --edition=2024 crates/tauri-codegen/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi … (2465 chars)` |
| 43527 | rustc | 51109 | 51109 | 154549–159901 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_build --edition=2024 crates/tauri-build/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,art … (2132 chars)` |
| 46964 | rustc | 51109 | 51109 | 157163–174476 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bench_cpu_intensive --edition=2024 bench/tests/cpu_intensive/src-tauri/src/main.rs --error-format=json --json=di … (1236 chars)` |
| 47498 | rustc | 51109 | 51109 | 157527–174839 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name resources --edition=2024 examples/resources/src-tauri/src/main.rs --error-format=json --json=diagnostic-rendered … (1098 chars)` |
| 48779 | rustc | 51109 | 51109 | 158437–160456 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name restart --edition=2024 crates/tests/restart/src/main.rs --error-format=json --json=diagnostic-rendered-ansi,arti … (856 chars)` |
| 48851 | rustc | 51109 | 51109 | 158582–158692 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_schema_generator --edition=2024 crates/tauri-schema-generator/src/main.rs --error-format=json --json=diagn … (768 chars)` |
| 48986 | clang | 51109 | 48851 | 158692–158692 | no |  | `none: seen only as a zombie, after it exited` |
| 49004 | ld | 51109 | 48986 | 158692–158692 | no |  | `none: seen only as a zombie, after it exited` |
| 49024 | rustc | 51109 | 51109 | 158743–161213 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_benchmark_jsons --edition=2024 bench/src/build_benchmark_jsons.rs --error-format=json --json=diagnostic-re … (1216 chars)` |
| 49648 | (unknown) | 51109 | 48779 | 159370–159370 | no |  | `none: seen only as a zombie, with no name` |
| 49683 | clang | 51109 | 48779 | 159428–160456 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustcjpUahg/symbols.o /private/tmp/c335/tauri/target/debug/deps/restart-2d7523df0bd44696.1hxt2us025oezgrjzu0 … (24251 chars)` |
| 49700 | ld | 51109 | 49683 | 159428–160456 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (24426 chars)` |
| 50171 | rustc | 51109 | 51109 | 159963–162629 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name run_benchmark --edition=2024 bench/src/run_benchmark.rs --error-format=json --json=diagnostic-rendered-ansi,arti … (1200 chars)` |
| 50605 | cargo | 51109 | 51109 | 160530–160530 | no |  | `none: seen only as a zombie, after it exited` |
| 51062 | clang | 51109 | 49024 | 161135–161135 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustcbAypjR/symbols.o /private/tmp/c335/tauri/target/debug/deps/build_benchmark_jsons-8560fa2e65d2dbc5.01ng2 … (15688 chars)` |
| 52279 | xcrun | 51109 | 50171 | 162503–162503 | no |  | `none: seen only as a zombie, after it exited` |
| 52290 | clang | 51109 | 50171 | 162559–162629 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustcBlnIiS/symbols.o /private/tmp/c335/tauri/target/debug/deps/run_benchmark-e341f1f1f6a25974.00s7jc4kploed … (21279 chars)` |
| 52298 | ld | 51109 | 52290 | 162559–162629 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (21455 chars)` |
| 59345 | xcrun | 51109 | 26350 | 171543–171543 | no |  | `none: seen only as a zombie, after it exited` |
| 59348 | clang | 51109 | 26350 | 171593–171933 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustcVFS910/symbols.o /private/tmp/c335/tauri/target/debug/deps/tauri_file_associations_demo-0ce50824d506915 … (55805 chars)` |
| 59351 | ld | 51109 | 59348 | 171593–171933 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (55980 chars)` |
| 59400 | xcrun | 51109 | 27513 | 172142–172142 | no |  | `none: seen only as a zombie, after it exited` |
| 59403 | clang | 51109 | 27513 | 172201–172592 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustc5beOrI/symbols.o /private/tmp/c335/tauri/target/debug/deps/bench_files_transfer-d247950ec9ccbef1.00cktl … (53741 chars)` |
| 59406 | ld | 51109 | 59403 | 172201–172592 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (53916 chars)` |
| 59431 | clang | 51109 | 30564 | 172474–173208 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustc3zSxdb/symbols.o /private/tmp/c335/tauri/target/debug/deps/bench_helloworld-ed7177049b395f01.00u5193prn … (52709 chars)` |
| 59435 | ld | 51109 | 59431 | 172592–173208 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (52884 chars)` |
| 60677 | xcrun | 51109 | 46964 | 174126–174126 | no |  | `none: seen only as a zombie, after it exited` |
| 60695 | clang | 51109 | 46964 | 174177–174476 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustcTzdzH5/symbols.o /private/tmp/c335/tauri/target/debug/deps/bench_cpu_intensive-a6b42051ae9f007b.01c17te … (53483 chars)` |
| 60736 | ld | 51109 | 60695 | 174177–174476 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (53658 chars)` |
| 60847 | clang | 51109 | 47498 | 174476–174839 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustcoiy3bI/symbols.o /private/tmp/c335/tauri/target/debug/deps/resources-25f6056f55e5ace7.03rhrn3806xg11ks5 … (50903 chars)` |
| 60862 | ld | 51109 | 60847 | 174476–174839 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (51078 chars)` |
| 60883 | clang | 51109 | 24581 | 174733–174977 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcR6czLG/list /private/tmp/c335/tauri/target/debug/deps/rustcR6czLG/symbol … (46355 chars)` |
| 60887 | ld | 51109 | 60883 | 174839–174977 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (46517 chars)` |
| 60923 | rustc | 51109 | 51109 | 175089–175614 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name api --edition=2024 examples/api/src-tauri/src/main.rs --error-format=json --json=diagnostic-rendered-ansi,artifa … (1491 chars)` |
| 61020 | clang | 51109 | 60923 | 175300–175614 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustcgmiq9b/symbols.o /private/tmp/c335/tauri/target/debug/deps/api-ba2d5da30fb89acf.2zu396ubh0zfj62mz7y767l … (23552 chars)` |
| 61024 | ld | 51109 | 61020 | 175300–175614 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (23727 chars)` |
| 62519 | rustc | 51109 | 51109 | 178057–179808 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_cli_node --edition=2024 packages/cli/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,artifa … (1462 chars)` |
| 62521 | rustc | 51109 | 51109 | 178057–179891 | no |  | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cargo_tauri --edition=2024 crates/tauri-cli/src/main.rs --error-format=json --json=diagnostic-rendered-ansi,arti … (8100 chars)` |
| 63017 | clang | 51109 | 62521 | 178944–179891 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustc0ik5om/symbols.o /private/tmp/c335/tauri/target/debug/deps/cargo_tauri-a5ccba202383f517.00zyn1fz7xss854 … (52728 chars)` |
| 63050 | ld | 51109 | 63017 | 179000–179891 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (52901 chars)` |
| 63233 | clang | 51109 | 62519 | 179050–179808 | no |  | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcxSQry0/list /private/tmp/c335/tauri/target/debug/deps/rustcxSQry0/symbol … (55332 chars)` |
| 63291 | ld | 51109 | 63233 | 179123–179808 | no |  | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (55514 chars)` |

The working-directory census recorded 66 entries, of which 1 is a pid `ps` tracking never saw:

| pid | name | pgid | seen (ms) | alive after group empty (ms) | `ps` tracked this pid | command line |
|---:|---|---|---|---:|---|---|
| 51109 | cargo | 51109 | 5–179176 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo build --workspace` |
| 66979 | rustc | 51109 | 72222–72222 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name png --edition=2021 /Users/cjwilliams/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/png-0.18.1/src/lib.rs  … (1204 chars)` |
| 70616 | rustc | 51109 | 79852–94426 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_utils --edition=2024 crates/tauri-utils/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,art … (4574 chars)` |
| 73184 | rustc | 51109 | 84880–107791 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_utils --edition=2024 crates/tauri-utils/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,art … (4785 chars)` |
| 74605 | rustc | 51109 | 89599–89599 |  | yes | `none: seen only as a zombie, after it exited` |
| 74625 |  |  | 89599–89599 |  | **no** | `none: not in the latest ps sample` |
| 74655 | rustc | 51109 | 90780–90780 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_codegen --edition=2024 crates/tauri-codegen/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi … (2590 chars)` |
| 74713 | rustc | 51109 | 90780–90780 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_build --edition=2024 crates/tauri-build/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,art … (2385 chars)` |
| 74713 |  |  | 91973–91973 |  | yes | `none: not in the latest ps sample` |
| 74981 | rustc | 51109 | 94426–94426 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_runtime_wry --edition=2024 crates/tauri-runtime-wry/src/lib.rs --error-format=json --json=diagnostic-rende … (2135 chars)` |
| 75336 | rustc | 51109 | 95609–95609 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 crates/tauri/build.rs --error-format=json --json=diagnostic-rendered-ansi,arti … (2143 chars)` |
| 75337 | rustc | 51109 | 95609–96802 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_macros --edition=2024 crates/tauri-macros/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,a … (1495 chars)` |
| 75636 | rustc | 51109 | 97980–127275 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri --edition=2024 crates/tauri/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,artifacts,futur … (5397 chars)` |
| 73184 |  |  | 109047–109047 |  | yes | `none: not in the latest ps sample` |
| 12534 |  |  | 128925–128925 |  | yes | `none: not in the latest ps sample` |
| 12753 |  |  | 128925–128925 |  | yes | `none: not in the latest ps sample` |
| 75636 |  |  | 128925–128925 |  | yes | `none: not in the latest ps sample` |
| 18166 | rustc | 51109 | 133434–136368 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_macos_sign --edition=2024 crates/tauri-macos-sign/src/lib.rs --error-format=json --json=diagnostic-rendere … (2506 chars)` |
| 19310 | rustc | 51109 | 134823–156467 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_bundler --edition=2024 crates/tauri-bundler/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi … (4068 chars)` |
| 19323 | build-script-build | 51109 | 134823–134823 |  | yes | `/private/tmp/c335/tauri/target/debug/build/api-1ac6281d5674d555/build-script-build` |
| 20584 | rustc | 51109 | 136368–136368 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_plugin_sample --edition=2024 examples/api/src-tauri/tauri-plugin-sample/src/lib.rs --error-format=json --j … (1284 chars)` |
| 21918 | rustc | 51109 | 138209–138209 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 bench/tests/files_transfer/src-tauri/build.rs --error-format=json --json=diagn … (864 chars)` |
| 22067 | rustc | 51109 | 138209–138209 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 bench/tests/cpu_intensive/src-tauri/build.rs --error-format=json --json=diagno … (862 chars)` |
| 22154 | rustc | 51109 | 138209–138209 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 crates/tauri-schema-generator/build.rs --error-format=json --json=diagnostic-r … (1223 chars)` |
| 22227 | clang | 51109 | 138209–138209 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/bench_files_transfer-08199ffa758f8136/rustcHq19Ak/symbols.o /private/tmp/c335/tauri/target/debug/build/benc … (16743 chars)` |
| 22250 | ld | 51109 | 138209–138209 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (16919 chars)` |
| 22251 | clang | 51109 | 138209–138209 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/build/bench_cpu_intensive-3e15bf2247b31ed2/rustcUGuYLW/symbols.o /private/tmp/c335/tauri/target/debug/build/bench … (16735 chars)` |
| 22261 | rustc | 51109 | 138209–138209 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_script_build --edition=2024 examples/resources/src-tauri/build.rs --error-format=json --json=diagnostic-re … (724 chars)` |
| 22262 | ld | 51109 | 138209–138209 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (16911 chars)` |
| 23201 |  |  | 139791–139791 |  | yes | `none: not in the latest ps sample` |
| 23273 |  |  | 139791–139791 |  | yes | `none: not in the latest ps sample` |
| 23674 |  |  | 139791–139791 |  | yes | `none: not in the latest ps sample` |
| 23879 |  |  | 139791–139791 |  | yes | `none: not in the latest ps sample` |
| 23918 |  |  | 139791–139791 |  | yes | `none: not in the latest ps sample` |
| 24081 |  |  | 139791–139791 |  | yes | `none: not in the latest ps sample` |
| 24132 |  |  | 139791–139791 |  | yes | `none: not in the latest ps sample` |
| 24581 | rustc | 51109 | 141419–174335 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name api_lib --edition=2024 examples/api/src-tauri/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,art … (1427 chars)` |
| 26350 | rustc | 51109 | 141419–171675 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_file_associations_demo --edition=2024 examples/file-associations/src-tauri/src/main.rs --error-format=json … (1209 chars)` |
| 27513 | rustc | 51109 | 143001–171675 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bench_files_transfer --edition=2024 bench/tests/files_transfer/src-tauri/src/main.rs --error-format=json --json= … (1238 chars)` |
| 30564 | rustc | 51109 | 146520–171675 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bench_helloworld --edition=2024 bench/tests/helloworld/src-tauri/src/main.rs --error-format=json --json=diagnost … (1230 chars)` |
| 39025 | rustc | 51109 | 152079–176833 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_cli --edition=2024 crates/tauri-cli/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,artifac … (8083 chars)` |
| 39728 | rustc | 51109 | 152079–152079 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_schema_worker --edition=2024 crates/tauri-schema-worker/src/lib.rs --error-format=json --json=diagnostic-r … (1462 chars)` |
| 41648 | rustc | 51109 | 153608–156467 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_codegen --edition=2024 crates/tauri-codegen/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi … (2465 chars)` |
| 43527 | rustc | 51109 | 155092–158336 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_build --edition=2024 crates/tauri-build/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,art … (2132 chars)` |
| 19310 |  |  | 158336–158336 |  | yes | `none: not in the latest ps sample` |
| 46964 | rustc | 51109 | 158336–174335 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name bench_cpu_intensive --edition=2024 bench/tests/cpu_intensive/src-tauri/src/main.rs --error-format=json --json=di … (1236 chars)` |
| 47498 | rustc | 51109 | 158336–174335 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name resources --edition=2024 examples/resources/src-tauri/src/main.rs --error-format=json --json=diagnostic-rendered … (1098 chars)` |
| 43527 |  |  | 159698–159698 |  | yes | `none: not in the latest ps sample` |
| 48779 | rustc | 51109 | 159698–159698 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name restart --edition=2024 crates/tests/restart/src/main.rs --error-format=json --json=diagnostic-rendered-ansi,arti … (856 chars)` |
| 49024 | rustc | 51109 | 159698–159698 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name build_benchmark_jsons --edition=2024 bench/src/build_benchmark_jsons.rs --error-format=json --json=diagnostic-re … (1216 chars)` |
| 49683 | clang | 51109 | 159698–159698 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustcjpUahg/symbols.o /private/tmp/c335/tauri/target/debug/deps/restart-2d7523df0bd44696.1hxt2us025oezgrjzu0 … (24251 chars)` |
| 49700 | ld | 51109 | 159698–159698 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (24426 chars)` |
| 50171 | rustc | 51109 | 161358–161358 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name run_benchmark --edition=2024 bench/src/run_benchmark.rs --error-format=json --json=diagnostic-rendered-ansi,arti … (1200 chars)` |
| 59348 | clang | 51109 | 171675–171675 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustcVFS910/symbols.o /private/tmp/c335/tauri/target/debug/deps/tauri_file_associations_demo-0ce50824d506915 … (55805 chars)` |
| 59351 | ld | 51109 | 171675–171675 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (55980 chars)` |
| 30564 |  |  | 172919–172919 |  | yes | `none: not in the latest ps sample` |
| 59431 |  |  | 172919–172919 |  | yes | `none: not in the latest ps sample` |
| 59435 |  |  | 172919–172919 |  | yes | `none: not in the latest ps sample` |
| 60695 | clang | 51109 | 174335–174335 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustcTzdzH5/symbols.o /private/tmp/c335/tauri/target/debug/deps/bench_cpu_intensive-a6b42051ae9f007b.01c17te … (53483 chars)` |
| 60736 | ld | 51109 | 174335–174335 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (53658 chars)` |
| 62519 | rustc | 51109 | 179176–179176 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name tauri_cli_node --edition=2024 packages/cli/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,artifa … (1462 chars)` |
| 62521 | rustc | 51109 | 179176–179176 |  | yes | `/Users/cjwilliams/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc --crate-name cargo_tauri --edition=2024 crates/tauri-cli/src/main.rs --error-format=json --json=diagnostic-rendered-ansi,arti … (8100 chars)` |
| 63017 | clang | 51109 | 179176–179176 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/clang /private/tmp/c335/tauri/target/debug/deps/rustc0ik5om/symbols.o /private/tmp/c335/tauri/target/debug/deps/cargo_tauri-a5ccba202383f517.00zyn1fz7xss854 … (52728 chars)` |
| 63050 | ld | 51109 | 179176–179176 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -arch arm64 -platform_version macos 11.0.0 27.0 -syslibroot /Lib … (52901 chars)` |
| 63233 | clang | 51109 | 179176–179176 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/clang -Wl,-exported_symbols_list -Wl,/private/tmp/c335/tauri/target/debug/deps/rustcxSQry0/list /private/tmp/c335/tauri/target/debug/deps/rustcxSQry0/symbol … (55332 chars)` |
| 63291 | ld | 51109 | 179176–179176 |  | yes | `/Library/Developer/CommandLineTools/usr/bin/ld -demangle -lto_library /Library/Developer/CommandLineTools/usr/lib/libLTO.dylib -dynamic -dylib -arch arm64 -platform_version macos 11.0.0 27.0 -syslibro … (55514 chars)` |

### Control 1

Record `control-2026-09-28T00-00-49-065Z`. Group 73955; the direct child exited at 5 ms with code 0; the group was seen empty at 1105 ms.

`ps` tracking saw 1 processes:

| pid | name | pgid | ppid | seen (ms) | left group | alive after group empty (ms) | command line |
|---:|---|---|---|---|---|---:|---|
| 73955 |  | 73955 | 73953 | 2–2 | no |  | `    (bash)` |

The working-directory census did not run in this run.

### Control 2

Record `control-2026-09-28T00-02-04-086Z`. Group 68191; the direct child exited at 3015 ms with code 0; the group was seen empty at 3191 ms.

`ps` tracking saw 3 processes:

| pid | name | pgid | ppid | seen (ms) | left group | alive after group empty (ms) | command line |
|---:|---|---|---|---|---|---:|---|
| 68191 |  | 68191 | 68153 | 3–3008 | no |  | `    /bin/sh -c perl -e 'setpgrp(0,0); exec @ARGV' /bin/sleep 30 & /bin/sleep 3; echo control` |
| 68207 |  | 68207 | 68191, 1 | 56–29974 | yes | 26783 | `    /bin/sleep 30` |
| 68208 |  | 68191 | 68191 | 56–3008 | no |  | `    /bin/sleep 3` |

The working-directory census did not run in this run.

### Control with node

Record `control-node-2026-09-28T00-19-39-975Z`. Group 35816; the direct child exited at 3017 ms with code 0; the group was seen empty at 3259 ms.

`ps` tracking saw 3 processes:

| pid | name | pgid | ppid | seen (ms) | left group | alive after group empty (ms) | command line |
|---:|---|---|---|---|---|---:|---|
| 35816 | sh | 35816 | 35815 | 2–3013 | no |  | `/bin/sh -c perl -e 'setpgrp(0,0); exec @ARGV' /opt/homebrew/bin/node -e 'setTimeout(() => {}, 30000)' & /bin/sleep 3; echo control` |
| 35819 | node | 35819 | 35816, 1 | 54–30038 | yes | 26779 | `/opt/homebrew/bin/node -e setTimeout(() => {}, 30000)` |
| 35820 | sleep | 35816 | 35816 | 54–3013 | no |  | `/bin/sleep 3` |

The working-directory census recorded 3 entries, of which 0 are pids `ps` tracking never saw:

| pid | name | pgid | seen (ms) | alive after group empty (ms) | `ps` tracked this pid | command line |
|---:|---|---|---|---:|---|---|
| 35816 | sh | 35816 | 3–2260 |  | yes | `/bin/sh -c perl -e 'setpgrp(0,0); exec @ARGV' /opt/homebrew/bin/node -e 'setTimeout(() => {}, 30000)' & /bin/sleep 3; echo control` |
| 35819 | node | 35819 | 3–29905 | 26646 | yes | `/opt/homebrew/bin/node -e setTimeout(() => {}, 30000)` |
| 35820 | sleep | 35816 | 3–2260 |  | yes | `/bin/sleep 3` |
