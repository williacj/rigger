ABOUTME: Spike findings for card #473: what a headless Claude Code or Codex session loads on macOS,
which flag, setting or variable keeps each source out, and the invocation each adapter should use.

# What a headless Claude Code or Codex session loads, and what keeps each source out

## The answer

**Claude Code can be held to its directory, with five measures beyond the two flags.**
`--strict-mcp-config` and `--setting-sources project` together withheld every claude.ai
connector, every user plugin, user skill, user hook and the user `CLAUDE.md`. They also withheld
the directory's own .mcp.json, which `--mcp-config` has to name again. Five sources still reached
a session under both flags:

- a `CLAUDE.md` in a parent directory;
- auto-memory, which lives under `~/.claude/projects/` and which both worktrees of one repository
  share;
- the 18 bundled skills;
- two built-in plugins;
- the worktree tool.

Each has a withholder, listed in the withholding table below. The project's own permission
allow-list is ignored in a directory Claude Code has not been trusted in, so the adapter has to
pass the role's allowed tools itself.

**Codex cannot be held to its directory by `--ignore-user-config`, the flag ruling 1 Q1 names.**
Codex reads a repository's .codex/config.toml only when the repository is trusted, and the trust
entry lives in the user configuration that the flag drops. Under it, the project's MCP server never
started and its instructions never arrived. Two routes did carry the declaration: `-c` overrides,
and a per-dispatch Codex home outside every worktree that holds the declaration as its own
config.toml beside a link to the owner's auth.json. The per-dispatch home also kept out the
owner's plugins, the computer-use and browser server, the user's command rules and the owner's
model choice. No token refresh happened during the runs, so whether one writes back through that
link is not observed; "A token refresh through the link" says what was measured in its place.

**Codex prints no record of what a session loaded.** Its `--json` stream names no tool, server or
skill. The session's rollout file holds the skill list, `AGENTS.md`, the command rules, the sandbox
and the approval policy, and every revision-1 run kept an extract of it. `codex debug prompt-input` answers the skill and instruction items without a session. Only
the tool list needed one.

**Two recorded starting points do not hold.** Disabling any of Codex's five browser and
computer-use features, one at a time or all together, did not remove the owner's computer-use
server; `--disable plugins` did. And
`codex debug prompt-input` under the owner's configuration does not always report the skills an
`--ignore-user-config` session loads.

This report hands over evidence. It changes no code, requirement or recorded decision. The
throwaway harness and every run's raw output stayed in the coordinator's scratchpad under the
`c473-` prefix, outside every checkout, and none of it is in this pull request.

## Host, versions and runs

Each version is as the tool printed it on 2026-10-01:

| Tool | Command | Printed |
|---|---|---|
| macOS | `sw_vers` | `ProductVersion: 27.0`, `BuildVersion: 26A428` |
| Claude Code | `claude --version` | `2.1.286 (Claude Code)` |
| Codex CLI | `codex --version` | `codex-cli 0.159.2` |

Every run was made on 2026-10-01, under the owner's signed-in accounts: round 1 between 13:37 and
14:17 UTC, and revision 1 between 14:39 and 14:50 UTC. I named the directories the runs would create
on the card before each round ([round 1](https://github.com/williacj/rigger/issues/473#issuecomment-5932601526),
[revision 1](https://github.com/williacj/rigger/issues/473#issuecomment-5933715305)). The Claude Code
probe directories sat under the coordinator's scratchpad in `/private/tmp`. The Codex ones sat
under `$TMPDIR` in `/private/var/folders`, because the owner's Codex configuration trusts
`/private/tmp`. `git rev-parse` failed in both parents. No run wrote to GitHub or to any board, and
no run called a connector.

Runs are named below by their log labels: `cN` for Claude Code, `xN` for Codex, `pi-…` for
`codex debug prompt-input`, and an `r1-` prefix for a revision-1 run. Unless a row says otherwise:

- a Claude Code run is `claude -p "<prompt>" --output-format stream-json --verbose
  --include-hook-events --model haiku`, with the eleven `CLAUDE*` variables of the calling session
  removed (see "Inherited environment variables");
- a Codex run is `codex exec --json -C <dir> "<prompt>" < /dev/null`.

The cheap model kept the cost of each run small, and the load record does not depend on the model.

**What counts as a record.** Each later section reads what loaded from the strongest source
available, in this order:

1. the CLI's own printed record. Claude Code's `init` event has one; Codex has none;
2. a side effect the source leaves:
   - a hook writing a file;
   - the throwaway MCP server appending its name to a log when it starts;
   - the session's request body, captured by a local stand-in for the Messages API;
3. Codex's rollout file, whose `world_state` and `turn_context` entries record skills,
   `AGENTS.md`, rules, sandbox and approval;
4. `codex debug prompt-input`, which starts no session;
5. the session's own answer to a marker question, used only where none of the above exists.

**What the logs keep.** Every log named here is in the scratchpad's c473-logs/. A revision-1 run
keeps, beside its stream and standard error, its command line and environment overrides (.cmd),
its exit code (.exit), the MCP start-log lines it caused (.mcp), and for Codex an extract of
its rollout (.rollout.json): `turn_context`, `world_state`, tool calls, and which markers the base
instructions and developer messages held. A captured request keeps an extract of the markers it
carried, with no header. Round 1 kept streams and answers but not these, and its rollouts and
request bodies were deleted, so every claim that rested on them was re-run in revision 1 and is
cited to that run. Rollouts were deleted only after their extract was saved, and every extract was
checked for the owner's email and for tokens.

**One harness defect, found and corrected.** My Claude Code runner first removed every variable
starting `CLAUDE` from a run's environment, including the ones a run set on purpose. That voided
runs c9 (`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`) and c21 (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`)
and the first form of c35. I narrowed it to the eleven inherited names and repeated them as c9b,
c21b and c35. Only the repeats are cited.

## Claude Code

### The record a session prints

`--output-format stream-json` prints a `system`/`init` event before the first turn. It lists the
session's `tools`, `mcp_servers` with each one's status and source, `plugins`, `agents`, `skills`,
`slash_commands`, `model`, `permissionMode` and `memory_paths`. `--include-hook-events` adds a
`hook_started` and a `hook_response` event for each hook from a settings file. Built-in plugins'
own hooks do not appear there; `--debug-file` shows them. An abridged `init` event, from c2:

```
{"type":"system","subtype":"init","cwd":".../scratchpad/c473-a","tools":["Task","Bash",…,"Write"],
 "mcp_servers":[],"model":"claude-haiku-4-5-20251001","permissionMode":"default",
 "apiKeySource":"none","claude_code_version":"2.1.286",
 "agents":["claude","Explore","general-purpose","Plan","statusline-setup"],
 "skills":["deep-research","design",…,"run-skill-generator"],
 "plugins":[{"name":"cc-plugin-agents-md","path":"builtin",…},{"name":"cc-plugin-telemetry",…}],
 "memory_paths":{"auto":"/Users/cjwilliams/.claude/projects/-private-tmp-…-c473-a/memory/"}, …}
```

### One MCP server declared, with and without the two flags

The probe directory held only a .mcp.json declaring one stdio server, `c473proj`. Runs c2 (both
flags), c3 (neither), c4 (`--setting-sources project` alone), c5 (`--strict-mcp-config` alone) and
c6 (both flags plus `--mcp-config <dir>/.mcp.json`), read from each `init` event:

| Source | c2: both flags | c3: neither | c4: project only | c5: strict only | c6: both + `--mcp-config` |
|---|---|---|---|---|---|
| The directory's `c473proj` server | absent | connected, source `project` | connected | absent | connected, source `dynamic` |
| claude.ai connectors | none | six, below | six | none | none |
| Plugin MCP servers (`productivity`: slack, notion, asana, linear, atlassian, monday, clickup, google calendar, gmail) | none | nine, `needs-auth` or `failed` | none | none | none |
| Plugins | `cc-plugin-agents-md@builtin`, `cc-plugin-telemetry@builtin` | those two, `rust-analyzer-lsp@claude-plugins-official`, `ai-adopters-marketing@aiac`, `productivity@synced` | the two built-ins | all five | the two built-ins |
| Skills | 18 bundled | 53: the 18, the user's `geo-audit`, 12 `ai-adopters-marketing:*`, 2 `productivity:*` and 20 `anthropic-skills:*` | 18 bundled | 53 | 18 bundled |
| Agents | `claude`, `Explore`, `general-purpose`, `Plan`, `statusline-setup` | the same five | the same | the same | the same |
| Hooks from settings files | none ran | none ran | none ran | none ran | none ran |
| Tools | 29 built-in | 117: 33 built-in (adds `LSP` and three MCP resource tools) and 84 MCP | 116: 32 built-in and 84 MCP | 30 (adds `LSP`) | 30 (29 and the server's one) |

The 18 bundled skills are `deep-research`, `design`, `design-sync`, `dataviz`, `update-config`,
`verify`, `debug`, `code-review`, `simplify`, `batch`, `fewer-permission-prompts`, `doctor`,
`loop`, `schedule`, `claude-api`, `workflow-authoring`, `run` and `run-skill-generator`.

The 29 built-in tools are `Task`, `Bash`, `CronCreate`, `CronDelete`, `CronList`, `DesignSync`,
`Edit`, `EnterWorktree`, `ExitWorktree`, `ListAgents`, `Monitor`, `NotebookEdit`,
`PushNotification`, `Read`, `RemoteTrigger`, `ReportFindings`, `ScheduleWakeup`, `SendMessage`,
`Skill`, `TaskCreate`, `TaskGet`, `TaskList`, `TaskStop`, `TaskUpdate`, `ToolSearch`, `WebFetch`,
`WebSearch`, `Workflow` and `Write`.

`--strict-mcp-config` withholds the directory's own .mcp.json along with the connectors. A
project server returns only when `--mcp-config` names its file (c6). In a directory nobody had
trusted, a `-p` session started a .mcp.json server without asking (c3, c4) and ran the
directory's hooks (c7, below).

### The owner's claude.ai connectors

The owner's account holds six claude.ai connectors (c3's `init` event, source `claudeai`):

| Connector | c2: both flags | c3: no flags |
|---|---|---|
| claude.ai Claude Docs | absent | connected |
| claude.ai Aleph Beta | absent | connected |
| claude.ai Shopify | absent | connected |
| claude.ai Gmail | absent | connected |
| claude.ai Google Calendar | absent | present, `needs-auth` |
| claude.ai Google Drive | absent | present, `needs-auth` |

`--setting-sources project` alone did not withhold them (c4). `--strict-mcp-config` did (c5).

### A second directory given with `--add-dir`

The second directory held a `CLAUDE.md` with marker `HERON-adddir-5521`, a skill
`c473-adddir-skill`, an agent `c473-adddir-agent`, a settings file with a `SessionStart` and a
`UserPromptSubmit` hook, each touching a file in that directory, and a .mcp.json declaring
`c473adddir`. The session ran in a first directory built the same way with `main` markers.

| The second directory's | c7: both flags | c8: no flags | Shown by |
|---|---|---|---|
| `CLAUDE.md` | not loaded | not loaded | the answer quoted only `HERON-main-5521` |
| skill | loaded | loaded | `init` `skills` lists `c473-adddir-skill` |
| agent | loaded | loaded | `init` `agents` lists `c473-adddir-agent` |
| settings hooks | not run | not run | no hook file appeared in the second directory; the first directory's hooks ran |
| .mcp.json | not loaded | not loaded | c8's `mcp_servers` lists `c473main` and no `c473adddir` |

`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` made the second directory's `CLAUDE.md` load
under both flags (c9b: the answer quoted `HERON-adddir-5521` from that file).

### A `CLAUDE.md` in a parent directory

The session ran in an empty directory whose parent held a `CLAUDE.md` with marker
`HERON-parent-8812`. Under both flags the marker reached the session, which named the parent's file
as its source (c10). It reached it with no flags as well (c11).

### The user's `CLAUDE.md` and the user's hooks

I did not edit the owner's `~/.claude/`, because every other Claude Code session on the host reads
it. A stand-in home took its place through `HOME=`. It held a `CLAUDE.md` with marker
`HERON-user-3390`, and a settings file whose `SessionStart` and `UserPromptSubmit` hooks touch a
file in that home. A session run that way is not signed in. So these runs pointed
`ANTHROPIC_BASE_URL` at a local stand-in that records each request body and answers 400, with a
dummy `ANTHROPIC_API_KEY`. No owner credential was involved.

| Source | No flags (r1-c15; c13) | Both flags (r1-c16; c14) |
|---|---|---|
| User `CLAUDE.md` | in the request body: r1-c15.request-extract.json shows `HERON-user-3390` present in a 129,015-byte request, with the stand-in home's `CLAUDE.md` named beside it | absent: r1-c16.request-extract.json shows it absent from a 128,502-byte request |
| User hooks | both ran: r1-c15 holds both hook events, and r1-c15.hookfiles lists both files | neither ran: r1-c16 holds no hook event, and r1-c16.hookfiles is empty |

The stand-in's files are kept as r1-standin-user-CLAUDE.md and r1-standin-user-settings.json.
Round 1's c13 and c14 showed the same hook result.

### Auto-memory

A throwaway repository had two worktrees, `main` and `wt2`. Under both flags:

- **Both worktrees share one memory directory.** `init`'s memory_paths.auto was
  `~/.claude/projects/<main's encoded path>/memory/` in each (c17 in `main`, c18 in `wt2`).
- **A headless session writes it without asking.** In `wt2`, asked to remember a codeword, the
  session called `Write` on project_codeword.md and MEMORY.md in that directory, outside its
  working directory. No permission prompt or denial occurred (c19).
- **A session in the other worktree reads it.** In `main`, the session quoted
  `HERON-memwrite-6604` and named MEMORY.md as its source (c20).

`--settings '{"autoMemoryEnabled":false}'` withheld it: `memory_paths` was absent and the answer
was `NONE` (c22). So did `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` (c21b).

### Inherited environment variables

The shell that ran the spike was itself a Claude Code session's tool shell. It carried eleven
variables whose names start `CLAUDE`:

- `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXECPATH`, `CLAUDECODE`, `CLAUDE_PID` and `CLAUDE_EFFORT`;
- `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN`, the second a secret not
  printed here;
- `CLAUDE_CODE_BRIDGE_SESSION_ID`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION` and
  `CLAUDE_CODE_SESSION_ATTENDED`.

None of them changed a session in any way I could see.

- **The printed records matched.** c1 inherited the variables and c2 had them removed. Their `init`
  events differed only in `session_id`, `uuid` and `messaging_socket_path`. Each session opened a
  socket named for its own process, not the caller's. The event sequence and every `result` field
  but timings and cost were the same.
- **The transcripts matched.** The two sessions' transcripts under `~/.claude/projects/` differed
  only in cost and timing.
- **The debug logs matched.** c23 and c24 differ only in pids, timings and cost.
- **The requests matched.** c25 and c26 sent identical `system`, `messages`, `tools`, `model`,
  `thinking` and `output_config` (`effort: medium` in both). Their headers differed only in
  per-session ids.

**No variable carries the owner's authentication.** Every run with all eleven removed signed in
(`apiKeySource: none`, an OAuth session) and answered.

### What withheld each source that loaded

| Source that loaded under both flags | Withheld by | Run |
|---|---|---|
| Parent `CLAUDE.md` | `--settings '{"claudeMdExcludes":["**/c473-p/CLAUDE.md"]}'` | c36 |
| `--add-dir` skills | `--disable-slash-commands`, which withholds every skill, the directory's own included | c36 |
| `--add-dir` agents | none found; still listed in c36 | c36 |
| Auto-memory | `autoMemoryEnabled: false` in `--settings`, or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | c22, c21b |
| Bundled skills | `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` withholds 16 of the 18; `design` and `doctor` stay. `--disable-slash-commands` withholds all | c37, c36 |
| Built-in plugins `cc-plugin-agents-md`, `cc-plugin-telemetry` | `--settings '{"enabledPlugins":{"cc-plugin-agents-md@builtin":false,"cc-plugin-telemetry@builtin":false}}'` | c36 |
| `EnterWorktree`, `ExitWorktree` | `--disallowedTools EnterWorktree ExitWorktree` | c36 |
| The owner's account email | not tried. A session under both flags said its context held an email address in a `userEmail` section | c47 |

c36 applied five withholders at once. Each acts on a different field of the `init` event or on the
answer, so each result is readable on its own.

The sources the two flags withheld were withheld by these:

- `--strict-mcp-config` withheld connectors, plugin servers and the directory's .mcp.json;
- `--setting-sources project` withheld user plugins, user skills, user hooks and the user
  `CLAUDE.md`.

`CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` is a name I found among the binary's strings and then
measured. It appears in no `--help` text.

### Carrying a 4,000-word agent file

The agent file was the five role prompts in this repository's agent directory with their
frontmatter removed, padded to 4,057 words (24,207 bytes). It had frontmatter naming it `c473big`,
an opening marker `HERON-agentstart-1717`, and a last sentence carrying `HERON-agentend-4242`.

| Flag | Carried it whole | Run |
|---|---|---|
| `--agent c473big`, the file under the directory's own agent folder | yes: both markers quoted, end marker placed at the end | c27 |
| `--agents <file>` holding the agent as JSON, with `--agent c473big` | yes: both markers quoted | c28 |
| `--agents <file>` alone | no: the agent was defined (listed in `agents`) but not the session's; the answer was `NONE` | c29 |
| `--append-system-prompt-file <file>` | yes: both markers quoted, and the frontmatter line `name: c473big` was in the instructions | c30 |

### A prompt on standard input

A 218,877-byte prompt went on standard input with no prompt argument. It held 2,700 numbered
filler lines and a last line naming `HERON-stdin-9090`. The session answered
`HERON-stdin-9090 002699`, the marker and the last line's number (c31).

### Models

| `--model` | Resolved to (`init` `model` and `modelUsage`) | Run |
|---|---|---|
| `sonnet` | `claude-sonnet-5-5` | c32 |
| `opus` | `claude-opus-5-5` | c32 |
| `fable` | `claude-fable-5-1` | c32 |
| `haiku` | `claude-haiku-4-5-20251001` | c2 |

### Background-task output

A session given `--allowedTools 'Bash(echo *)'` ran an `echo` with `run_in_background`. The tool
reported "Output is being written to:
/private/tmp/claude-501/-private-tmp-…-c473-bg/<session>/tasks/<id>.output". That is under
`/tmp/claude-<uid>/`, outside the working directory (c33). `TMPDIR=<cwd>/tmpa` left it there
(c34). `CLAUDE_CODE_TMPDIR=<cwd>/tmpb` moved it under the working directory, to
`<cwd>/tmpb/claude-501/<encoded cwd>/<session>/tasks/<id>.output` (c35).

### The worktree tool

`EnterWorktree` and `ExitWorktree` were offered in every run, under both flags included. The `-w`
flag in `--help` is the CLI's own worktree option. `--disallowedTools EnterWorktree ExitWorktree`
withheld both tools (c36: 26 tools, neither listed).

### A command the directory's settings do not allow

The directory's `.claude/settings.json` allowed only `Bash(git status)`, and its `package.json`
test script touched a file. The session ran under both flags with no permission override. Asked to
run `npm test`, it **stopped** (c38). The command never ran: no file appeared. The tool result was
"This command requires approval". The session ended "The command `npm test .` requires approval
before it can run. Please confirm that you'd like me to proceed", with `permission_denials`
listing the call, `subtype: success` and exit code 0. Standard error said:

```
Ignoring 1 permissions.allow entry from .claude/settings.json: this workspace has not been trusted.
Run Claude Code interactively here once and accept the trust dialog, or set
projects["<dir>"].hasTrustDialogAccepted: true in /Users/cjwilliams/.claude.json.
```

So the directory's own allow-list did not apply. `git status` ran anyway (c39), because Claude
Code treats it as read-only. The same allow rule passed with `--settings` did apply:
`--settings '{"permissions":{"allow":["Bash(npm test *)","Bash(npm test)"]}}'` let `npm test .`
run and touch its file (c42).

### Exit codes

| Case | Exit code | Standard output | Standard error |
|---|---|---|---|
| A prompt on standard input, normal end (r1-c45) | 0 | `OK` | empty |
| Standard input closed empty, no prompt argument (r1-c43, text; r1-c44, stream-json) | 1 | empty | `Error: Input must be provided either through stdin or as a prompt argument when using --print` |

Each run's .exit file holds its code and its .cmd file its command line, with the eleven
inherited variables removed.

### Bundled skills

The 18 bundled skills reached every session, both flags included. `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`
withheld 16 of them and kept the directory's own skill (c37). `--disable-slash-commands` withheld
them all, and the directory's skills with them (c36).

## Codex

### The record a session prints, and the records it keeps

`codex exec --json` prints thread, turn and item events, and no account of what loaded. All four
lines of x1:

```
{"type":"thread.started","thread_id":"01a0f7bb-0db5-7410-815a-295f4cb61159"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}
{"type":"turn.completed","usage":{"input_tokens":15310,"cached_input_tokens":12672,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}
```

The rollout Codex writes under its home's sessions/ holds what `--json` omits:

- a `world_state` entry with `agents_md` (directory and text), `host_skills` (skill roots and the
  skill list), `apps_instructions`, `plugins_instructions` and `permissions`, whose
  `approved_command_prefixes` are the loaded command rules;
- a `turn_context` entry with `model`, `effort`, `approval_policy`, `sandbox_policy` and
  `permission_profile`;
- the `base_instructions` and every developer message.

Neither the stream nor the rollout lists tools or MCP servers. For those I used the MCP server's
start log and the session's answer. MCP tools are deferred: a session whose server the log shows
starting still did not name that server's tool (r1-x10, r1-x16), so the start log, not the answer,
is the record of a server loading.

### What `codex debug prompt-input` answered, and what needed a session

`codex -C <dir> debug prompt-input` printed the model-visible input as JSON, without starting a
session:

- the skill roots and the skill list;
- `AGENTS.md`;
- the sandbox and network sentence.

It answered the skill-discovery, .system, plugin-cache, `.claude/skills` and symlink items
(pi-a to pi-h). It shows no tools and no MCP servers: the owner's computer-use server never
appeared in it. It has no `--ignore-user-config`, and in an untrusted directory it shows no project
configuration. Needing a session were:

- every tool and MCP server list;
- the project configuration's trust behaviour;
- the sandbox, approval and network defaults;
- the second directory;
- the agent file;
- standard input, models, permissions and exit codes;
- apps and the browser and computer-use features.

### `--ignore-user-config` in a directory holding Codex's project configuration

The probe repository, `c473-cx1`, was untrusted. It held:

- a .codex/config.toml with `developer_instructions` naming `HERON-codexproj-1357`,
  `model_reasoning_effort = "low"` and one MCP server, `c473cx`;
- an `AGENTS.md` naming `HERON-codexagents-2222`;
- one skill under each of .codex/skills/, .agents/skills/ and `.claude/skills/`.

| Loaded, r1-x5 (`--ignore-user-config`) | Shown by |
|---|---|
| MCP servers: none of the project's. `c473cx` never started | r1-x5.mcp empty |
| Project configuration: not read. Neither its marker nor its effort reached the session | marker absent from the answer; `turn_context` `effort` unset |
| Skills: `imagegen`, `openai-docs`, `skill-creator`, `skill-installer` (from the owner's `~/.codex/skills/.system`), `c473-codexdir-skill`, `c473-agentsdir-skill`, and from the remote plugin cache `pages:maintain-space`, `pages:manage-schedules`, `pages:organize-space`, `pages:write-page`, `plugin-management:plugin-management`, `work-pets:create-pet`, `work-pets:pets`, `work-pets:update-pet` | r1-x5.rollout.json `host_skills` |
| `AGENTS.md`: loaded | r1-x5.rollout.json `agents_md` |
| Tools: `functions`: `exec`, `wait`, `request_user_input`, `request_user_input_async`. `clock`: `sleep`. `collaboration`: `spawn_agent`, `followup_task`, `send_message`, `interrupt_agent`, `list_agents`, `wait_agent`. Inside `exec`: `apply_patch`, `create_goal`, `exec_command`, `get_goal`, `list_mcp_resource_templates`, `list_mcp_resources`, `read_mcp_resource`, `request_plugin_install`, `update_goal`, `view_image`, `write_stdin`, `clock__curr_time`, `image_gen__imagegen`, `web__run` | the r1-x5 answer |
| Command rules: the owner's `["git","worktree","add"]` and one `node` prefix, from `~/.codex/rules` | r1-x5.rollout.json `approved_command_prefixes` |
| Model `gpt-6.1-sol`, sandbox `read-only`, approval `never`, network `restricted` | r1-x5.rollout.json `turn_context` |

**Project configuration path.** Codex read none under `--ignore-user-config`. Where trust was
given (r1-x10, r1-x12, r1-x14 below), it read the repository root's .codex/config.toml. Run from
the subdirectory `sub` (r1-x12), the server started with `sub` as its working directory (r1-x12.mcp),
and the marker and `effort: low` arrived.

**Remote plugin skills, inconsistently.** The `openai-curated-remote` caches loaded in 6 of the 11
revision-1 `--ignore-user-config` sessions in the owner's home: r1-x5, r1-x5-ignore-2,
r1-x5-ignore-4, r1-x15, r1-x37 and r1-x39, but not r1-x5-ignore-3, r1-x7, r1-x29, r1-x30 or r1-x38.
They loaded in neither run with `--disable plugins` added (r1-x17-1, r1-x17-2), and in none of the
11 runs made with a per-dispatch home. They also loaded once under the owner's full configuration
(r1-x45-disable-computer_use) and not in its seven other runs.

### The same run without `--ignore-user-config`

| Loaded, r1-x8 (the owner's configuration) | Shown by |
|---|---|
| MCP servers: `cua_repl`, with `js` and `js_reset`, offering `cua.getState`, `getTab`, `createBrowserTab`, `getBrowser`, `getApp`, `rewriteDocumentation`. The project's `c473cx` did not start | the r1-x8 answer; r1-x8.mcp empty |
| Project configuration: not read, since the directory is untrusted | marker absent from the answer |
| Skills: the four .system skills, the two project skills, and the owner's plugin skills `documents:documents`, `pdf:pdf`, `presentations:Presentations`, `spreadsheets:Spreadsheets`, `spreadsheets:excel-live-control`, `template-creator:template-creator`, `visualize:visualize` | r1-x8.rollout.json `host_skills` |
| Tools: as r1-x5, plus `mcp__cua_repl` | the r1-x8 answer |
| Command rules: the owner's two | r1-x8.rollout.json |
| Model `gpt-6-sol`, effort `high`, approval `on-request`, sandbox `read-only`, network `restricted` | r1-x8.rollout.json `turn_context` |

### Trust, worktrees, overrides and a per-dispatch home

| Case | Project configuration reached the session? | Shown by | Run |
|---|---|---|---|
| A fresh worktree of `c473-cx1`, the owner's home, no trust entry for it or its repository | no | marker absent; .mcp empty; `read-only` | r1-x13 |
| The repository's own path trusted by `-c 'projects."<dir>".trust_level="trusted"'`, with `--ignore-user-config` | no | marker absent; .mcp empty; `read-only` | r1-x7 |
| The same `-c` trust, with `debug prompt-input` | no | marker absent | x4 |
| A per-dispatch home whose config.toml trusts the main repository's path | yes | `HERON-codexproj-1357` quoted; .mcp: `c473cx` started; `effort: low`; `workspace-write` | r1-x10 |
| That home, in the fresh worktree, whose own path has no entry | yes: a worktree inherits its main repository's trust | `HERON-codexproj-1357` quoted; .mcp: `c473cx` started in the worktree; `workspace-write` | r1-x14 |
| That home with `--ignore-user-config` | no | marker absent; .mcp empty; `read-only` | r1-x11 |
| The fresh worktree, `--ignore-user-config`, with the declaration as `-c` overrides: `developer_instructions`, `model_reasoning_effort`, `mcp_servers.c473cx.command` and .args | yes | `HERON-codexoverride-8080` quoted; .mcp: `c473cxflag` started; `effort: low` | r1-x15 |
| The fresh worktree, a per-dispatch home holding the project file as its config.toml and a link to the owner's auth.json, no trust entry | yes | `HERON-codexhome-4646` quoted; .mcp: `c473cx` started; skills: the home's own .system and the project's two; no owner plugin skills | r1-x16 |

Every revision-1 run's .mcp file holds the start-log lines that run caused. In round 1 I emptied
the shared start log before each run, which erased earlier runs' lines; revision 1 only appends.

### A token refresh through the link

**No refresh was observed.** None happened in any run: after the revision-1 runs, the owner's
auth.json kept its mtime of 2026-09-25T21:11:32-0500 and its `last_refresh` of
2026-09-26T02:11:32Z (r1-auth-link-check.txt). I did not force one, because that would mean
editing the owner's credentials. The observed-refresh check is #489's, as the amended item says.

**What was measured in its place:**

- **The link survived every run.** After all eleven per-dispatch-home runs, each home's auth.json
  was still a symbolic link to the owner's file, and no regular auth.json existed in any home
  (r1-auth-link-check.txt).
- **Codex's own credential write goes through a link.** In a third home, auth.json was a link to
  a scratch file holding `{}`. `codex login --with-api-key`, given a dummy key on standard input,
  printed "Successfully logged in" and exited 0. Afterwards the link was intact, no regular
  auth.json was in the home, and the target held `OPENAI_API_KEY` and `auth_mode: apikey`
  (r1-login-through-link). No owner credential was involved.

**The owner's access token expires at 2026-10-06T02:11:32Z**, by its `exp` claim
(r1-auth-link-check.txt). I read only `last_refresh` and that claim from the file.

### Sandbox, approval and network

| Case | Sandbox | Approval | Network | Run |
|---|---|---|---|---|
| `codex exec`, `--ignore-user-config`, untrusted directory | `read-only` | `never` | `restricted` | r1-x5 |
| `codex exec`, the owner's configuration, untrusted directory | `read-only` | `on-request` | `restricted` | r1-x8 |
| Trusted directory, nothing set | `workspace-write`, `exclude_tmpdir_env_var: false`, `exclude_slash_tmp: false` | `never` | `restricted` | r1-x10 |
| Project configuration sets `sandbox_mode = "read-only"` and `approval_policy = "on-request"` | `read-only` | `never` | `restricted` | r1-x20 |
| Project configuration sets `workspace-write` and `[sandbox_workspace_write] network_access = true` | `workspace-write`, `network_access: true` | `never` | `enabled` | r1-x21 |
| Project configuration sets `sandbox_mode = "danger-full-access"` | `danger-full-access` | `never` | none recorded | r1-x22 |
| The same project configuration, with `-s workspace-write` on the command line | `workspace-write` | `never` | `restricted` | r1-x22s |
| `-c approval_policy="on-request"` | `workspace-write` | `never` | `restricted` | r1-x23 |

Each value is read from the run's .rollout.json `turn_context`, and each project configuration
used is kept as `<run>.project-config.toml`. So a trusted directory's project configuration can set
the sandbox, including to `danger-full-access`, and can turn the network on, and `-s` on the
command line overrides it. Neither it nor `-c` changed `exec`'s approval
policy from `never`. Under the owner's configuration it was `on-request`. The owner's file sets
`approvals_reviewer = "auto_review"` and no approval policy, so I take that key to be the cause.
That is a judgment I did not isolate.

### A second directory outside `-C`

The session ran with `-C c473-cx1`, trusted through the per-dispatch home, so `workspace-write`. It
ran `cat <second>/in.txt` and a write to `<second>/out.txt`.

| Case | Read | Write | Run |
|---|---|---|---|
| Defaults | succeeded | **succeeded**, because the second directory sat under `$TMPDIR`, which `workspace-write` leaves writable by default | x24 |
| `-c sandbox_workspace_write.exclude_tmpdir_env_var=true -c sandbox_workspace_write.exclude_slash_tmp=true` | succeeded | refused: `sh: <second>/out.txt: Operation not permitted`, exit 1, no file | x26 |
| The same, with `--add-dir <second>` | succeeded | succeeded; `turn_context` `writable_roots` lists the second directory | x27 |

Reading outside the working root was allowed in every case: the permission profile grants read on
the root of the file system. Writing outside it took `--add-dir`, or a path under `$TMPDIR` or
`/tmp` while those stay writable.

### What Codex reads as a repository's instruction assets

| Asset | Path | When | Shown by |
|---|---|---|---|
| `AGENTS.md` | the repository root, found from a subdirectory as well | always | .rollout.json `agents_md` (r1-x5, r1-x12) |
| Project configuration, including `developer_instructions` and `mcp_servers` | the root's .codex/config.toml | trusted only | r1-x10, r1-x12 |
| Command rules, the `prefix_rule` lines | the root's .codex/rules/default.rules | trusted only: `approved_command_prefixes` was `[["git","status"]]` with a per-dispatch home (r1-x10, r1-x12, r1-x14) and held only the owner's two rules in the untrusted directory (r1-x5, r1-x8, r1-x13) | the runs' .rollout.json |
| Skills | the root's `.codex/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md` | trusted or not | pi-a, r1-x5 |

The strings AGENTS.override.md, `project_doc_fallback_filenames` and `project_doc_max_bytes =
32768` are in the Codex binary, and a project hooks file is named in the owner's configuration. I
measured none of them.

### An agent file with its frontmatter

The same 4,057-word agent file, frontmatter included, went to Codex in three ways. All ran with
`--ignore-user-config --skip-git-repo-check` in an empty directory.

| How | Whole, end marker reached | Frontmatter | Run |
|---|---|---|---|
| On standard input, with the question after it | yes: both markers quoted, the end one placed at the end | present: `name: c473big` reported in context | x28 |
| `-c model_instructions_file="<file>"` | yes: x29's answer quoted both markers. r1-x29's answer declined to quote "hidden instructions", and its .rollout.json shows the `base_instructions` holding both markers and the frontmatter line, in place of Codex's own: 24,751 characters against 22,093 in r1-x37 | x29, r1-x29 |
| `-c developer_instructions="<file contents>"` | yes by the rollout: r1-x30's .rollout.json shows one developer message of 29,400 characters holding both markers and the frontmatter line. The session declined to quote "private instructions" | present | r1-x30 |

The agent file used in revision 1 is kept as r1-c473big.md.

The frontmatter never had to be stripped for the end marker to arrive.

### How Codex finds skills, and a skill under `.claude/skills/`

Codex listed skills from these roots and no others:

- the repository's .codex/skills/ and .agents/skills/;
- its home's skills/.system/, which it fills itself: a fresh per-dispatch home gained one;
- the caches of enabled plugins under its home's plugins/cache/;
- now and then, the remote plugin cache.

A skill under `.claude/skills/` was never listed: not by `prompt-input` (pi-a), and not in any revision-1 session's .rollout.json. The agent file naming it did not bring
it: asked, the session answered "No" (x31). A skills.config
entry naming the skill by its file, its directory or `.claude/skills` added nothing (pi-g).

**A symbolic link worked.** A link at .agents/skills/c473-claudedir-skill, pointing at
`../../.claude/skills/c473-claudedir-skill`, was listed by `prompt-input` (pi-h). I measured that
link with `prompt-input` only, not in a session.

### Where a project declares its allowed tools and MCP servers

The file is the repository root's .codex/config.toml, read only when trusted. A per-dispatch
home's own config.toml serves the same purpose and needs no trust. A session given a home whose
config.toml was the project file loaded exactly what that file declared, and nothing else of
the owner's (r1-x16):

- the `c473cx` server, which started (r1-x16.mcp);
- the file's instructions and effort: `HERON-codexhome-4646` in a developer message and
  `effort: low` (r1-x16.rollout.json);
- no owner plugin skills and no owner command rules: the skill roots are the home's .system and the
  worktree's two, and `approved_command_prefixes` is empty (r1-x16.rollout.json);
- no `cua_repl` and no browser or computer-use API: the answer lists `functions`, `collaboration`
  and `clock` and says "No interactive browser-control, computer-use, or desktop-app API is
  explicitly exposed" (r1-x16).

### Standard input, models, permissions and exit codes

**Standard input.** The same 218,877-byte prompt went on standard input with no prompt argument.
Codex printed "Reading prompt from stdin..." and answered `HERON-stdin-9090 002699` (x34).

**Models.** Codex takes model slugs, not aliases. `codex debug models` lists `gpt-6.1-sol` first,
with default effort `low`. Resolved in `turn_context`:

| `-m` | Model and effort | Run |
|---|---|---|
| `gpt-6.1-sol -c model_reasoning_effort=medium` | `gpt-6.1-sol`, `medium` | r1-x37 |
| `gpt-6.1-sol -c model_reasoning_effort=high` | `gpt-6.1-sol`, `high` | r1-x38 |
| `gpt-6-sol` | `gpt-6-sol`, effort not recorded | r1-x39 |
| none, `--ignore-user-config` | `gpt-6.1-sol` | r1-x5 |
| none, the owner's configuration | `gpt-6-sol`, `high` | r1-x8 |

**Permissions.** The directory's own .codex/rules/default.rules allowed only `git status`.
Neither run overrode a permission.

- **Untrusted, the owner's home (x32).** The rules were not loaded. `npm test .` ran in the
  `read-only` sandbox and failed. The session **continued** and reported "`npm test .` exited with
  code 1 … `touch: C473NPMTEST-RAN: Operation not permitted`", exiting 0.
- **Trusted through the per-dispatch home (x33).** The rules were loaded. `npm test .` ran in
  `workspace-write` and touched its file, since an allow rule only pre-approves and an approval
  policy of `never` asks nothing. The session **continued**: "`npm test .` succeeded with exit
  code 0".

**Exit codes.**

| Case | Exit code | Standard output | Standard error |
|---|---|---|---|
| A prompt on standard input, normal end (r1-x36) | 0 | `OK` | the transcript, ending `tokens used` `1,950` |
| Standard input closed empty, no prompt argument (r1-x35) | 1 | empty | `Reading prompt from stdin...` then `No prompt provided via stdin.` |

### Apps, .system skills, plugin caches and the browser and computer-use features

**Connected apps.** No app tool appeared in any session, under the owner's configuration or
otherwise (r1-x8, x40). The owner's `recommended_plugins` lists Gmail, Google Calendar, Google Drive,
Slack and others as "available but not installed". `--disable apps` removed `request_plugin_install`
from the tools (x41). The base instructions' sentence "An app is equivalent to a set of MCP tools
within the `codex_apps` MCP" remained. This account had no installed app to withhold, so these runs
cannot show `--disable apps` withholding one.

**.system skills** loaded in every run. `-c skills.bundled.enabled=false` withheld them (pi-c).
**Plugin skill caches** loaded under the owner's configuration, and `--disable plugins` withheld
them (pi-b, r1-x44). The remote cache also loaded intermittently, as above.

**Browser and desktop features.** `codex features list` shows these that reach the owner's browser
or desktop, all `stable` and `true`:

- `browser_use`, `browser_use_external`, `browser_use_full_cdp_access`;
- `computer_use`;
- `in_app_browser`.

`in_app_chat`, `in_app_dictation`, `in_app_local_automation` and `realtime_conversation` name
desktop-app surfaces too. That is a judgment from their names, and I did not measure them.

**Disabling a feature removed nothing.** Each run below used the owner's configuration in the
untrusted probe directory, and asked the session for its tool namespaces and every browser,
computer-use or desktop-app API. Each .cmd holds the flags and each .exit holds 0.

| Disabled | `mcp__cua_repl` and its `cua` API still offered? | Run |
|---|---|---|
| nothing | yes: `getState`, `getTab`, `createBrowserTab`, `getBrowser`, `getApp`, `rewriteDocumentation` | r1-x8 |
| `--disable browser_use` | yes | r1-x45-disable-browser_use |
| `--disable browser_use_external` | yes | r1-x45-disable-browser_use_external |
| `--disable browser_use_full_cdp_access` | yes | r1-x45-disable-browser_use_full_cdp_access |
| `--disable computer_use` | yes | r1-x45-disable-computer_use |
| `--disable in_app_browser` | yes | r1-x45-disable-in_app_browser |
| all five together | yes | r1-x42-disable-all5 |
| `enabled=false`, by `-c`, for the owner's `browser`, `chrome`, `computer-use` and `unified-computer-use` plugins | yes | r1-x46-disable-cua-plugins |
| `-c mcp_servers.node_repl.enabled=false` | yes | x43 (round 1) |
| `--disable plugins` | **no**: "No computer-use or desktop-app control API is visible" | r1-x44-disable-plugins |

**What does remove it** is `--disable plugins`, which withholds every plugin. Leaving out the
owner's configuration does too: no `--ignore-user-config` run and no per-dispatch-home run offered
`cua_repl` (r1-x5, r1-x16), with all five features at their default `true`. I found no narrower
withholder: disabling the four plugins by name did not remove it, so which plugin provides the
server is not settled.

### `prompt-input` against an `--ignore-user-config` session (engineer r3-4; ruling 5)

`codex -C <dir> --disable plugins --disable apps -c 'skills.config=[]' debug prompt-input` was
compared with what an `exec --ignore-user-config` session in that directory loaded, by its
rollout:

| User configuration | `prompt-input` skills | Session skills | Same? |
|---|---|---|---|
| The owner's, which adds no skill and disables none (pi-d) | four .system and two project skills | the same in r1-x5-ignore-3, r1-x7 and r1-x17-1/2. r1-x5, r1-x5-ignore-2 and r1-x5-ignore-4 added the remote plugin skills | yes, except when the remote cache loads in the session |
| A stand-in home's, disabling `c473-codexdir-skill` (pi-f, r1-x19) | the skill absent | the skill present: r1-x19.rollout.json lists `c473-codexdir-skill` | **no**: `-c skills.config=[]` did not clear the file's disabling entry |

The session side is read from each run's .rollout.json `host_skills`.

## Recommendation

### Claude Code's adapter

Pass these, beside `-p`, `--output-format stream-json --verbose` and the prompt on standard input:

1. **`--strict-mcp-config --setting-sources project`, as ruling 1 Q1 has it.** These withheld every
   connector and every user source (c2, c3, r1-c15, r1-c16).
2. **`--mcp-config <worktree>/.mcp.json` when the file exists.** Otherwise the directory's own
   servers do not load (c2, c6).
3. **One `--settings` JSON** with three entries:
   - `"autoMemoryEnabled": false`, because memory lives outside the worktree, is shared by every
     worktree of the repository, and is written without asking (c17 to c22);
   - `"permissions"`, the role's allowed tools, because the directory's own allow-list is ignored
     in an untrusted directory (c38, c42);
   - `"claudeMdExcludes"`, naming each `CLAUDE.md` above the worktree, because a parent's file
     otherwise reaches the session (c10, c36).
4. **`--disallowedTools EnterWorktree ExitWorktree`** (c36).
5. **`CLAUDE_CODE_TMPDIR=<a directory under the worktree>`**, so that background-task output lands
   under the worktree (c33 to c35).
6. **`--agent <role>`**, which carried the 4,000-word file whole from the worktree's agent
   directory (c27).
7. **The tiers.** `--model sonnet` (`claude-sonnet-5-5`) for `standard` and `--model opus`
   (`claude-opus-5-5`) for `high` (c32). Which model is higher is the owner's call under `O4`; the
   resolution is measured.

**Built-in plugins and bundled skills: a decision for the owner.** Withholding them takes
`enabledPlugins` set to `false` for the two built-ins, and `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`,
which leaves `design` and `doctor` (c36, c37). I lean to withholding both, so that a session holds
only what the directory declares. That is a judgment. Neither is the owner's data, and
`cc-plugin-agents-md` exists to load `AGENTS.md`, which this repository's `CLAUDE.md` already
imports.

Removing the calling session's `CLAUDE*` variables measured no difference (c1, c2, c23 to c26), so
the adapter needs no step for them.

### Codex's adapter

1. **A per-dispatch Codex home outside every worktree.** Its config.toml is the repository's
   Codex declaration (`O16`'s templates/codex/ copy), and its auth.json is a link to the owner's
   file. Set `CODEX_HOME` to it, and do not pass `--ignore-user-config`, which would drop that very
   file. This loaded exactly the declaration (r1-x16). It also kept the owner's plugins, computer-use
   server, command rules and model choice out of the session, and kept its rollouts and databases
   out of the owner's home.
2. **`--disable plugins --disable apps -c skills.bundled.enabled=false`** as well, if .system
   skills are to be withheld. Remote plugin skills loaded in 6 of 11 `--ignore-user-config` runs
   in the owner's home, in none of the 11 per-dispatch-home runs, and in neither run with
   `--disable plugins` (r1-x17).
3. **`-c sandbox_workspace_write.exclude_tmpdir_env_var=true -c
   sandbox_workspace_write.exclude_slash_tmp=true`, and `--add-dir <head>` for a judge's reach.**
   Otherwise every path under `$TMPDIR` and `/tmp` is writable (x24, x26, x27).
4. **The sandbox and the approval policy.** A trusted repository's .codex/config.toml can set
   `danger-full-access` (r1-x22). So the adapter should state the sandbox on the command line:
   `-s workspace-write` overrode that project setting (r1-x22s). The approval policy was `never` in
   every `exec` run made with a per-dispatch home.
5. **The agent file, frontmatter included, by `-c developer_instructions=<file>`.** The rollout
   showed it whole (r1-x30). `model_instructions_file` also carries it whole but replaces Codex's
   own base instructions (r1-x29). Standard input carries it as part of the user's message (x28).
6. **The prompt on standard input** (x34).
7. **The tiers.** `-m gpt-6.1-sol` with `-c model_reasoning_effort=medium` for `standard` and
   `=high` for `high` (r1-x37, r1-x38). Choosing the model and the effort for each tier is the owner's
   call under `O4`; the resolution is measured.
8. **Skills, for `O16`.** Codex does not read `.claude/skills/`. A symbolic link under
   .agents/skills/ was discovered (pi-h). That would let M4-14 reuse the shared skills without
   copying them, but it was measured with `prompt-input` only.

**What the next card must not assume:**

- That `--ignore-user-config` keeps a repository's project configuration (r1-x5, r1-x11).
- That `codex exec --json` reports every command a session ran. x32's stream holds no command item
  although its answer reports running `npm test`, and x26's holds the `cat` but no item for the
  refused write.
- That `prompt-input` under the owner's configuration predicts an `--ignore-user-config` session
  (pi-f, r1-x19).
- That a worktree of an untrusted repository is untrusted when the main checkout is trusted. It
  inherits the trust (r1-x14).

## What would reverse each recommendation

- **The two Claude Code flags.** A connector, user plugin, user skill, user hook or user
  `CLAUDE.md` in a session started with both flags. Shown by `init` or by a captured request.
- **`--mcp-config`.** A strict session listing the directory's .mcp.json server without it.
- **`autoMemoryEnabled: false`.** A version in which memory is kept per worktree under the worktree.
  Shown by `init` `memory_paths`.
- **Passing permissions in `--settings`.** A `-p` session honouring an untrusted directory's own
  permissions.allow, so that `npm test` runs under a project-only allow.
- **`claudeMdExcludes`.** A parent `CLAUDE.md` reaching a session despite the exclude, or a version
  in which `--setting-sources project` stops reading ancestors.
- **`CLAUDE_CODE_TMPDIR`.** Background output written outside it while it is set.
- **`--agent`.** A 4,000-word agent whose end marker does not reach the session.
- **The per-dispatch Codex home.** Any of these:
  - a token refresh that replaces the link with a regular file, or leaves a credential copy in the
    home;
  - a Codex version that ignores `CODEX_HOME`;
  - a home config.toml that stops loading MCP servers or instructions.
- **Excluding `$TMPDIR` and `/tmp`.** A Codex version whose `workspace-write` no longer makes them
  writable, or a build or test step that needs them and has no other temporary directory.
- **`developer_instructions` for the agent file.** A rollout whose developer message lacks the end
  marker, or a size above which `-c` fails.

## What this report could not settle

- **An observed token refresh through the linked auth.json.** None happened; the amended item
  moves that check to #489. A per-dispatch-home session run after 2026-10-06T02:11:32Z would see
  one. After it, `readlink` on the home's auth.json should still name the owner's file, and
  `find <home> -name auth.json -type f` should find nothing.
- **Which plugin provides the computer-use server.** `--disable plugins` withholds it; disabling
  the four browser and computer-use plugins by name did not (r1-x46).
- **Whether `--disable apps` withholds a connected app.** This account has none installed.

## Outside this card's acceptance

These are for the coordinator. I have filed no card.

- **The owner's account email reaches every headless Claude Code session**, under both flags, in a
  `userEmail` section (c47). It bears on `R-SAFE-7`, and I found no withholder.
- **An untrusted directory's hooks and .mcp.json servers run in `-p`, while its permission
  allow-list is ignored** (c3, c7, c38). A judge's directory would run whatever hooks its tree
  carries.
- **Codex's `--json` stream does not report every command a session ran** (x26, x32). A log built
  from it would miss some.
- **A trusted repository's .codex/config.toml can set `danger-full-access`** (r1-x22).
- **A Codex worktree inherits its main checkout's trust** (r1-x14). If the owner trusts this checkout,
  every Rigger worktree of it is trusted under the owner's home.

## Cleanup

These were removed after each round's runs:

- every probe directory, the per-dispatch homes, and each auth.json link with them;
- the `~/.claude/projects/` entries the probes created, and the background-task directories under
  `/private/tmp/claude-501/`;
- the Codex rollouts the probes wrote under `~/.codex/sessions/`: 27 in round 1, and in revision 1
  the 24 in the owner's home, each only after its extract was saved. The 11 revision-1
  per-dispatch-home rollouts went with their homes, also after extraction.

Round 1 also deleted its rollouts and request bodies before extracting them; revision 1 re-ran
every claim that rested on them. Rows that Codex's databases in `~/.codex` hold for these sessions
remain; I did not edit the owner's databases.

The harness and every log, extract and kept input stay in the coordinator's scratchpad as
c473-bin/ and c473-logs/, outside every checkout. I searched the logs for the owner's email, a
token field and a JWT, and found none; the only matches for a JWT's prefix were inside the base64
thinking signatures of four round-1 Claude Code streams.
