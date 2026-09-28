ABOUTME: Spike findings for card #335: what a headless Claude CLI session and a cold cargo workspace
build leave outside their process group on macOS, and which census could find what they leave.

# What leaves the process group, and whether Rigger could find it

## The answer

The cold `cargo build --workspace` of Tauri's workspace left nothing outside its group. `ps`
observed 1,571 of its processes, and every one stayed in the group.

The headless Claude CLI session did leave processes outside its group. Claude Code runs every Bash
tool call in a process group of its own, so none of an agent's shell commands is in the group
Rigger created.

On a normal exit, the CLI ended its own `run_in_background` task. It did not end a process that a
foreground command started with `&`. That process lived about 114 s past the group, until it
finished by itself.

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
throwaway harness lives in the gitignored spikes directory of the maker's worktree, under c335 and is
not in this pull request. [The appendix](what-leaves-the-process-group-processes.md) lists every
process each run observed.

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
under the workload's directory. One call took 124–242 ms (lsof, runs 3 and 4).

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
  neither rule reaches it. This is how Claude runs 2 and 3 missed their `&` survivor.
- **A process seen only after it exits.** `ps` shows a zombie's name in parentheses and no command
  line. The appendix marks each of these.
- **Non-atomic samples.** One `ps` call does not capture a single instant, so a fork or exec during
  the call can appear in either state.

### Readings that show a process was missed

- **Claude runs 2 and 3.** The `&` survivor's group id was 77683 in run 2 and 58081 in run 3. That
  is the pid of the zsh that step 2 ran in. Neither zsh appears in any sample, and `ps` tracking
  never saw either survivor.
  - In run 2 I found the survivor by hand, after the harness had finished.
  - In run 3 only the working-directory census saw it.
  - Step 3's zsh (`ls`) is also absent from run 3's samples.
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
too brief to sample, which is exactly Claude runs 2 and 3.

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
| Step 2's zsh | **left**, inferred | never sampled; the survivor's pgid names it |
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
| 2 | step 2's `nohup` loop, pid 77685 | **yes** | last alive at 00:16:44.553Z, polled every 100 ms by `ps -p`. That is 114.2 s after the direct child's exit at 00:14:50.358Z. It ended by itself after its 120 iterations |
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

**Where they went.** Every one of the 1,571 had the workload's pgid in every sample that saw it. No
process left. The working-directory census found only `cargo` itself, at 60 s. At the census, and
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
| Claude 2 | the `nohup` survivor `/bin/sh`, pid 77685, by hand | left | no |
| Cargo | `cargo` | in | yes |
| Control 2 | `/bin/sh`, `/bin/sleep 3` | in | no |
| Control 2 | `/bin/sleep 30` | left | no |
| Control with node | `/opt/homebrew/bin/node` | left | **yes**, before and after the group was empty |

Here is one reading of each kind, from the harness's record:

```
# control with node, after the group was empty: left the group, marker visible
ps -E:  /opt/homebrew/bin/node -e setTimeout(() => {}, 30000) NoDefaultCurrentDirectoryInExePath=1 C335_MARKER=control-node-d2ded633 …
sysctl: 35819 bytes 2340 strings 48 env-like 45 marker True

# Claude run 2, by hand, 25 s after the session exited: left the group, marker invisible
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
  - The survivors had put their output elsewhere. `lsof -p 77685` showed fds 0, 1 and 2 on
    `/dev/null`.
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
census found each one. That includes the two that `ps` tracking never saw. In run 2, the survivor's
own `lsof -p 77685` showed `cwd /private/tmp/c335/claude-scratch`. From run 3, at the census:

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
  read by hand instead.
- **A run outside a Claude Code session.** The harness ran from my session's shell. So the
  workloads inherited `AI_AGENT`, and any Seatbelt profile that session applies. None is configured
  in `~/.claude/settings.json` or the repository's `.claude/settings.json`.

## Recommendation

**Change L0's census.** After the group kill, L0 lists every process of the user whose working
directory lies under the dispatch's worktree. It kills each one, confirms it dead, and records it
by name and command line, in the order that ruling 2, §5 sets for every kill path. It rests on
three pieces of evidence:

- Claude runs 2–4 left survivors outside the group, for 86–119 s, under both the normal exit and
  a kill of the live group.
- Every one of them had the dispatch's directory as its working directory, and the census found
  each, including two that `ps` tracking missed.
- One census cost 124–242 ms, measured with `lsof` in runs 3 and 4.

**Do not add the environment marker as that mechanism.** On this host the marker could not be read
from any survivor the Claude CLI actually left, since all of them were Apple binaries (the marker
table). It could serve as a second check before a kill, for a process that is not an Apple binary.
That is a judgment, and I would leave it out until a survivor needs it.

**Do not rely on the held-open socket event to detect detachment.** No Claude survivor held the
socket (the `lsof` section). The event is still right for what it covers.

**The cargo build needs no second mechanism.** Nothing left the group in 1,571 observed processes.
That rests on the workload section and is limited by the sampling limit above.

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
