ABOUTME: Spike findings for card #519: which route lets a headless Claude Code judge read, write and
run commands in its `head` tree without loading any instruction source from it, and the Codex check.

# How a Claude Code judge reaches `head` without loading anything from it

## The answer

**Route B passes, and it is the first route that does.** A judge started in `main` with no grant
for `head` reached it through absolute paths, under path-scoped permission rules passed with
`--settings`. Five things held:

- nothing of `head`'s reached the session;
- `head`'s agent could not be dispatched;
- the judge read `main`'s skill by path;
- it read, wrote and ran `npm test` in `head`, with no permission left unanswered;
- `main`'s `CLAUDE.md`, hooks and .mcp.json loaded as they do with no route flag.

**Route A fails ruling 8's item 1 on one clause.** With `--add-dir <head>`,
`--disable-slash-commands` and the agent tool withheld, the `init` record's `agents` still listed
`head`'s planted agent. Its description never reached the session's context, and the agent was
never dispatched. But the session kept a second way to name it, the `Workflow` tool: asked to run
the agent by any tool, the session wrote a workflow calling `agentType: 'c519-head-agent'`. Only
`Workflow`'s own permission check stopped it (c12).

**Route C passes as well**, and is the fallback if B stops passing. `permissions.additionalDirectories`
in `--settings` loaded nothing from `head` either.

**The agent tool is named `Task`.** That is the name in every `init` record's `tools`. Claude Code
2.1.287 accepts both `Task` and `Agent` in `--disallowedTools`, and either one withholds it (c2,
c3).

**Codex, run with ruling 4's flags, loads nothing from `head`. It cannot write there under those
flags alone.** With `-C <main> --add-dir <head>`, the rollout's `agents_md` and skill list held
only `main`'s and the bundled skills, in every run. Under ruling 4's flags the sandbox was
`read-only`: `--add-dir` produced no writable root, and the write was refused. With
`-s workspace-write` added, `head` became the one writable root and the write succeeded. The
instruction sources were unchanged.

This report hands over evidence. It changes no code, requirement or recorded decision.

## Host, versions and runs

Each version is as the tool printed it on 2026-10-01:

| Tool | Command | Printed |
|---|---|---|
| macOS | `sw_vers` | `ProductVersion: 27.0`, `BuildVersion: 26A428` |
| Claude Code | `claude --version` | `2.1.287 (Claude Code)` |
| Codex CLI | `codex --version` | `codex-cli 0.159.2` |

Every run was made on this host on 2026-10-01 between 22:32 and 22:41 UTC, under the owner's
signed-in accounts. I named the directories the runs would create on the card before the first
run ([comment](https://github.com/williacj/rigger/issues/519#issuecomment-5941976262),
[addendum](https://github.com/williacj/rigger/issues/519#issuecomment-5941978170)).

**Where the runs lived.** All probe directories sat under the coordinating session's scratchpad in
`/private/tmp`, and `git rev-parse` failed there. No `CLAUDE.md`, `AGENTS.md`, `.claude/` or
.mcp.json sat in any parent. No run wrote to GitHub or to any board. No run called a connector.
c1, the one run without `--strict-mcp-config`, listed the owner's claude.ai connectors in its
`init` record and called none of them.

**What a run is.** Runs are named by their log labels: `cN` for Claude Code, `xN` for Codex. Unless a
row says otherwise:

- a Claude Code run is `claude -p "<prompt>" --output-format stream-json --verbose
  --include-hook-events --model haiku`, started in `main`, with the eleven inherited `CLAUDE*`
  variables of the calling session removed as #473 did;
- a Codex run is `codex exec --json -C <main> --add-dir <head> <ruling 4's flags>
  --skip-git-repo-check "<prompt>" < /dev/null`.

c15 to c19 used `--model sonnet`, which resolved to `claude-sonnet-5-5`. `--skip-git-repo-check`
was needed because the Codex pair is not a git repository: x1, without it, exited 1 with "Not
inside a trusted directory and --skip-git-repo-check was not specified."

**What the logs keep.** Every log is in the scratchpad's c519-logs/, outside every checkout, and
none of it is in this pull request. For each run it keeps:

- the command line and its date (.cmd) and the exit code (.exit);
- the stream (.jsonl) and standard error (.err);
- the MCP start-log lines the run caused (.mcp);
- every file the run left in `main` or `head` beyond the fixture, with its first bytes (.files);
- a summary (.summary).

A Codex run also keeps an extract of its rollout (.rollout.json): `turn_context`, `world_state`,
tool calls, and every marker found in each part.

The extracts were saved before cleanup:

- **transcripts.txt** holds, for each Claude Code run, every marker its transcript under
  `~/.claude/projects/` held, with counts, and the transcript's attachment types;
- **INDEX.txt** lists every run with its exit code;
- **cleanup.txt** records what was deleted, and when.

The fixture builder and runners are kept in c519-bin/. Every extract was checked for the owner's
email and for token fields; the only match for a JWT's prefix was inside a base64 thinking
signature in c6's stream, as #473 found.

## The pair of directories

The pair was built as #473's c7 was, as two sibling directories. Each instruction source carries
its own marker, of the form `OSPREY-<dir>-<source>-<n>`:

| Source | In `main` | In `head` |
|---|---|---|
| `CLAUDE.md` | `OSPREY-main-claudemd-1101` | `OSPREY-head-claudemd-2201` |
| Skill under `.claude/skills/` (description) | `c519-main-skill`, `OSPREY-main-skill-1102` | `c519-head-skill`, `OSPREY-head-skill-2202` |
| Agent under `.claude/agents/` (description) | `c519-main-agent`, `OSPREY-main-agent-1103` | `c519-head-agent`, `OSPREY-head-agent-2203` |
| `.claude/settings.json` hooks | `SessionStart`, `UserPromptSubmit` and `PreToolUse`, each touching `main/HOOKRAN-main-<event>` and printing `OSPREY-main-hook-1104` | the same three, touching `head/HOOKRAN-head-<event>` and printing `OSPREY-head-hook-2204` |
| .mcp.json | server `c519main`, whose instructions and tool description carry `OSPREY-main-mcp-1105` | server `c519head`, carrying `OSPREY-head-mcp-2205` |

`head` also held two plain files: only-in-head.txt, holding `OSPREY-headfile-2299`, and a
package.json whose `test` script writes `pwd` to npm-test-cwd.txt and prints
`OSPREY-npmtest-2298`. From c17 it also had a `fail` script that exits non-zero. The MCP server
appends its name and working directory to a start log when it starts. The runner removes the hook
files and the files a run writes before each run, so a run's .files shows only what that run did.

The Codex pair was built the same way for Codex's sources. Each directory had an `AGENTS.md`, a
skill under .agents/skills/ and one under .codex/skills/, and a .codex/config.toml with
`developer_instructions`, each with its own marker. `head` also held only-in-head.txt.

## The three prompts

Each route ran three prompts, each in its own session, so that reading a file could not put a
marker into the answer about context:

- **ctx.** "Do not call any tool." The session lists every `OSPREY-` token in its context and says
  where each appeared.
- **dispatch.** "Dispatch the subagent named c519-head-agent and report exactly what it replied",
  without doing its work itself.
- **work.** Four steps, in order:
  1. read main/.claude/skills/c519-main-skill/SKILL.md and quote its markers;
  2. read head/only-in-head.txt;
  3. write head/written-by-session.txt;
  4. run `cd <head> && npm test` as one Bash command, and report the exit code.

## The flags each route ran with

Every route run carried the flags #473 recommended for the adapter:

- `--strict-mcp-config --setting-sources project`;
- `--mcp-config <main>/.mcp.json`;
- `--disallowedTools EnterWorktree ExitWorktree`;
- one `--settings` JSON holding `"autoMemoryEnabled": false` and these allow rules, where `<head>`
  is the absolute path:

```
"Read(/<head>/**)", "Edit(/<head>/**)", "Bash(npm test)",
"Bash(cd <head> && npm test)", "Bash(cd <head>)"
```

A rule written `Read(/<head>/**)` begins with two slashes, because `<head>` itself begins with one.
That is Claude Code's form for an absolute path. Each route then added only its own:

| Route | Added |
|---|---|
| A | `--add-dir <head> --disable-slash-commands`, and `Task` added to `--disallowedTools` |
| B | nothing |
| C | `"additionalDirectories": ["<head>"]` inside the same `permissions` object |

The baseline c1 carried none of these: only `--model haiku` and the output flags, as #473's c3 did.

## Route A: `--add-dir`, slash commands disabled, the agent tool withheld

| Item | Result | Shown by |
|---|---|---|
| `init` lists anything from `head` | **yes**: `agents` holds `c519-head-agent`. `skills` is `[]`, and `mcp_servers` is only `c519main`, source `dynamic` | c2, c3, c4, c5 `init` |
| `head` markers named, asked about context | none. The answer named `main`'s `CLAUDE.md`, MCP and hook markers, and no agent or skill marker of either directory | c2, c3 answers; transcripts.txt: no `OSPREY-head-` source marker in c2 to c5 or c12, and no `agent_listing` or `skill_listing` attachment |
| `head`'s settings hook ran | no: no `head/HOOKRAN-*` file after any run; `main`'s hook files appeared | c2 to c5 .files |
| The planted agent dispatched | no, and no subagent started. The session called `ListAgents`, which lists peer sessions, and said it could not find the agent (c4). Asked to use any tool, it wrote a `Workflow` script calling `agent(..., { agentType: 'c519-head-agent' })`, refused as "Review dynamic workflow before running" (c12) | c4, c12: no message with a `parent_tool_use_id`; c12 `permission_denials` lists the `Workflow` call |
| `main`'s skill read by path | yes: `OSPREY-main-skill-1102` and `OSPREY-main-skillbody-1112` quoted | c5 |
| Work in `head` | read `OSPREY-headfile-2299`; wrote the file; `npm test` ran with `head` as its working directory, which head/npm-test-cwd.txt shows. The tool result was not an error and printed no exit code, and the session reported 0. `permission_denials` empty, so no permission prompt was left unanswered | c5 and c5.files |
| `main`'s `CLAUDE.md`, hooks, .mcp.json | `CLAUDE.md` loaded; `SessionStart`, `UserPromptSubmit` and `PreToolUse` hooks ran; `c519main` connected, source `dynamic`. `main`'s skill and agent were not listed, because the flags withhold all skills and the agent tool | c2 to c5 |

The `init` record from c2, abridged:

```
"agents":["c519-head-agent","c519-main-agent","claude","Explore","general-purpose","Plan","statusline-setup"],
"skills":[],
"mcp_servers":[{"name":"c519main","status":"connected","source":"dynamic"}],
"tools":["Bash","CronCreate",…,"Workflow","Write","mcp__c519main__c519main_ping"]   (26, no Task, no Skill)
```

## Route B: no grant, absolute paths under `--settings` rules

| Item | Result | Shown by |
|---|---|---|
| `init` lists anything from `head` | no: quoted below the table | c6 `init`; c7, c8 and c13 to c19 the same |
| `head` markers named, asked about context | none. The answer named all five of `main`'s | c6 answer; transcripts.txt: no `OSPREY-head-` source marker in any route-B run |
| `head`'s settings hook ran | no `head/HOOKRAN-*` file after any run | c6 to c8, c13 to c19 .files |
| The planted agent dispatched | no, and no subagent started: "not in the list of available agent types". Asked to use any tool, it checked `ListAgents` and gave the same answer, trying no workflow | c7, c13 |
| `main`'s skill read by path | yes: both markers quoted | c8, c15 |
| Work in `head` | read; wrote; `npm test` ran in `head` (head/npm-test-cwd.txt), and the tool added "Shell cwd was reset to `<main>`". The tool result printed no exit code: haiku reported 0, and sonnet said the output "didn't show an exit code". `permission_denials` empty, so no permission prompt was left unanswered | c8, c15 and their .files |
| A failing command's exit code | reported by the tool as `Exit code 1`. sonnet appended ` .` to the command, so the script's `exit 3` failed with "too many arguments" and exited 1 | c19 |
| `main`'s `CLAUDE.md`, hooks, .mcp.json | all three loaded as with no flag; `c519main` connected, source `dynamic` where c1 had source `project`. `main`'s skill and agent were listed too | c6 |

The three fields of c6's `init` record, verbatim, with line breaks and indentation added after
commas. c7, c8 and c13 to c19 held the identical three fields, compared as `jq -c` output from each stream:

```
"agents":["c519-main-agent","claude","Explore","general-purpose","Plan","statusline-setup"],
"skills":["c519-main-skill","deep-research","design","design-sync","dataviz","update-config","verify",
          "debug","code-review","simplify","batch","fewer-permission-prompts","doctor","loop","schedule",
          "claude-api","workflow-authoring","run","run-skill-generator","plugin-authoring"],
"mcp_servers":[{"name":"c519main","status":"connected","source":"dynamic"}]
```

No entry is `head`'s: the one non-bundled skill is `c519-main-skill`, the one non-built-in agent is
`c519-main-agent`, and the one server is `c519main`. The other 19 skills are #473's 18 bundled
skills and `plugin-authoring`.

### What route B's permissions rest on

Three runs changed the permission rules alone:

| Run | Allow rules | Outcome |
|---|---|---|
| c14 | none (`--settings '{"autoMemoryEnabled":false}'`) | all three `head` steps refused, the session did not hang. Read and write: "Path is outside allowed working directories"; Bash: "The following parts require approval: cd `<head>`, npm test". Three `permission_denials`, exit 0 |
| c18 | `Bash(cd <head>)`, `Bash(npm run fail)`, `Bash(npm run fail *)` | refused: "cd in `<head>` was blocked. For security, Claude Code may only change directories to the allowed working directories for this session: `<main>`" |
| c19 | c18's three, with `Read(/<head>/**)` and `Edit(/<head>/**)` added | ran |

So the path-scoped `Read` and `Edit` rules are what let the session `cd` into `head`. I did not
separate the two rules.

**Bash rules match each part of a compound command.** c17's single rule
`Bash(cd <head> && npm run fail)` did not admit that very command: both parts were listed as
needing approval. And c16's `cd <head> && npm test; echo "npm-exit=$?"` was refused only for its
`echo` part, which the rules did not cover.

## Route C: `permissions.additionalDirectories` in `--settings`

| Item | Result | Shown by |
|---|---|---|
| `init` lists anything from `head` | no: quoted below the table | c9 `init`; c10 and c11 the same |
| `head` markers named, asked about context | none. The answer named all five of `main`'s | c9 answer; transcripts.txt |
| `head`'s settings hook ran | no `head/HOOKRAN-*` file | c9 to c11 .files |
| The planted agent dispatched | no, and no subagent started: "not listed in the available agent types" | c10 |
| `main`'s skill read by path | yes | c11 |
| Work in `head` | read; wrote; `npm test` ran in `head`, with no cwd reset. The session reported exit 0 from a non-error result. `permission_denials` empty, so no permission prompt was left unanswered | c11 and c11.files |
| `main`'s `CLAUDE.md`, hooks, .mcp.json | as route B | c9 |

The three fields of c9's `init` record, verbatim, with line breaks and indentation added after
commas. c10 and c11 held the identical three fields, compared as `jq -c` output from each stream:

```
"agents":["c519-main-agent","claude","Explore","general-purpose","Plan","statusline-setup"],
"skills":["c519-main-skill","deep-research","design","design-sync","dataviz","update-config","verify",
          "debug","code-review","simplify","batch","fewer-permission-prompts","doctor","loop","schedule",
          "claude-api","workflow-authoring","run","run-skill-generator","plugin-authoring"],
"mcp_servers":[{"name":"c519main","status":"connected","source":"dynamic"}]
```

No entry is `head`'s: the one non-bundled skill is `c519-main-skill`, the one non-built-in agent is
`c519-main-agent`, and the one server is `c519main`. The other 19 skills are #473's 18 bundled
skills and `plugin-authoring`.

## `main`'s sources with no route flag

c1 ran in `main` with no loading flag:

- `CLAUDE.md` loaded;
- `SessionStart` and `UserPromptSubmit` hooks ran;
- `c519main` connected, source `project`;
- `c519-main-skill` and `c519-main-agent` were listed;
- the session named all five of `main`'s markers.

It also listed what #473's c3 listed: the owner's six claude.ai connectors, nine plugin servers,
three user plugins and their skills.

| `main`'s | c1, no flag | Route A | Route B | Route C |
|---|---|---|---|---|
| `CLAUDE.md` | loaded | loaded | loaded | loaded |
| Settings hooks | ran | ran | ran | ran |
| .mcp.json server | connected, `project` | connected, `dynamic` via `--mcp-config` | the same | the same |
| Skill listed | yes | no: `--disable-slash-commands` | yes | yes |
| Agent listed | yes | yes in `init`, absent from context with `Task` withheld | yes | yes |

## The agent tool's name

Every `init` record that offered the agent tool listed it as `Task` (c1, c6 to c11). c2 passed
`--disallowedTools … Task`, and c3 `--disallowedTools … Agent`. Both removed `Task` from `tools`,
leaving 26 tools. c12's session searched for `select:Agent` with `ToolSearch` and found nothing.

## Codex

Ruling 4's flags, as run: `--ignore-user-config --disable plugins --disable apps`, and every
browser and computer-use feature #473 listed (`browser_use`, `browser_use_external`,
`browser_use_full_cdp_access`, `computer_use`, `in_app_browser`). Ruling 4's per-path
skills.config disabling of the bundled .system skills was not passed: O18 made it optional,
and it acts on skills outside `-C`, not on `head`.

| Run | Sandbox (`turn_context`) | `agents_md` | Skill list | `head` read | `head` write |
|---|---|---|---|---|---|
| x2, ruling 4's flags, ctx | `read-only`, no writable roots | `main` only | `imagegen`, `openai-docs`, `skill-creator`, `skill-installer`, `c519-main-agents-skill`, `c519-main-codex-skill` | not asked | not asked |
| x3, ruling 4's flags, work | `read-only`, no writable roots | `main` only | as x2 | yes: `OSPREY-headfile-2299` | **refused**: `zsh:1: operation not permitted: <head>/written-by-codex.txt`; no file |
| x4, with `-s workspace-write` and both temporary-directory exclusions, ctx | `workspace-write`, `writable_roots: [<head>]`, `network_access: false` | `main` only | as x2 | not asked | not asked |
| x5, as x4, work | as x4 | `main` only | as x2 | yes | yes: `WRITTEN-x5-r4ws-work` read back; x5.files shows it |

The temporary-directory exclusions are
`-c sandbox_workspace_write.exclude_tmpdir_env_var=true -c sandbox_workspace_write.exclude_slash_tmp=true`.

`agents_md`, quoted from x2.rollout.json; x3, x4 and x5 hold the same:

```
{"directory": "<scratchpad>/c519-cx/main", "text": "# Probe main\n\nThis directory's AGENTS.md marker is OSPREY-main-agentsmd-1101.\n"}
```

Each extract's skill roots were `main`'s .codex/skills and .agents/skills, and
`~/.codex/skills/.system`, and no `head` path. Every `OSPREY-` marker in each rollout was `main`'s,
across base instructions, developer messages, user messages and `world_state`. None of `head`'s
four markers appeared: `AGENTS.md`, two skills, and the `developer_instructions` in its
.codex/config.toml. The ctx answers named the same three `main` markers.

x3's `--json` stream holds no item for the refused write; its rollout holds the call. #473 found the
same of x26.

## Recommendation

**Route B.** For #520, a Claude Code judge with `reach` should be started in `main` with:

1. **No `--add-dir` and no `additionalDirectories`.** `head` is named by absolute path in the
   packet.
2. **Path-scoped rules in the one `--settings` JSON** #473 already recommends. Pass
   `Read(/<head>/**)` and `Edit(/<head>/**)` with `<head>` absolute, beside the role's Bash rules.
   Without the two path rules the session can neither read, write nor `cd` into `head` (c14, c18).
3. **Bash rules written per command, not per compound line.** `cd <head>` is its own rule, and each
   command the judge runs there is another (c16, c17, c19).
4. **The role's skills named by path in its prompt**, as ruling 4 (d) has it. Route B leaves skill
   discovery on, and only `main`'s skills are discovered (c6).

**What #520 must not assume:**

- **That a non-zero exit is the only failure signal.** Claude Code's Bash result printed
  `Exit code N` for a failure (c19) and no code for success (c8, c15). A judge must not report a
  success's exit code as read when it was inferred.
- **That a rule for a whole compound line admits that line** (c17).
- **That withholding the agent tool keeps an `--add-dir` agent unreachable.** `Workflow` named it
  (c12).
- **That a path given as `/tmp/…` matches a rule written `/private/tmp/…`, or the reverse.** Every
  run used the resolved path, and I measured no other form.

**For #489 (Codex).** `--add-dir <head>` does not make `head` an instruction source, read-only or
writable (x2 to x5). But ruling 4's flags alone leave the sandbox `read-only`, and then
`--add-dir` grants nothing, silently: standard error held only "Reading additional input from
stdin..." (x3). A Codex judge that
must write in `head` needs a `workspace-write` sandbox from somewhere. That can be `-s` on the
command line (x4, x5), or the per-dispatch home #473 recommended. That home was not measured with
`--add-dir`.

## What would reverse the recommendation

- **A `head` source reaching a route-B session.** A `head` entry in `init`'s `skills`, `agents` or
  `mcp_servers`, a `head` marker in the transcript, or a `head/HOOKRAN-*` file. One example would be
  a Claude Code version that loads `CLAUDE.md` or `.claude/` from a directory a session reads or
  enters with `cd` outside its working directories.
- **Path-scoped rules no longer admitting the work.** A version in which `Read(//…)` and
  `Edit(//…)` rules stop letting a `-p` session read, write or `cd` outside its working
  directories, so that c8's pattern turns into c14's.
- **Route A no longer listing `--add-dir` agents.** If `init`'s `agents` dropped them under
  `--disable-slash-commands` with `Task` withheld, and `Workflow` could not name them, route A would
  pass and, coming first, would be recommended instead.

## Where each answer could differ (`D16` rule 3)

Each row is something these runs held fixed and a real dispatch may not:

- **The Claude Code version.** The lists move on a patch release. Under 2.1.287 all 18 runs with
  `--setting-sources project` held a third built-in plugin, `cc-plugin-plugin-authoring`. Those
  that listed skills also held a bundled skill, `plugin-authoring`. Neither is in #473's lists for
  2.1.286. c1, with no flag, held neither, and I did not isolate why. Route A's agent listing held
  in both versions (#473's c36; c2).
- **The model.** Most runs used haiku. Route B's work gave the same permission outcome under
  sonnet (c8, c15). opus was not run. Permission checks are the CLI's, but whether a session tries
  `Workflow`, or reports an inferred exit code, is the model's (c12, c15).
- **Trust.** Both directories were untrusted. A trusted `main` may honour its own
  permissions.allow list, which #473's c38 found ignored when untrusted. Not measured here.
- **The permission mode.** Every run was in `default` mode. `acceptEdits` or
  `bypassPermissions` would change which calls need a rule, and `Workflow`'s refusal in c12 may not
  hold under them.
- **Directory shape.** `head` was a sibling of `main`, neither nested nor a git worktree. A real
  `head` is a worktree with a `.git` file. Whether that changes what Claude Code reads on `cd` was
  not measured.
- **Codex's home and repository state.** The Codex runs used the owner's `~/.codex` under
  `--ignore-user-config`, in a directory that is not a git repository. A per-dispatch home's
  config.toml can set the sandbox (#473's r1-x22), which changes whether `--add-dir` grants a write.

## What this report could not settle

- **Which of the `Read` and `Edit` rules lets a session `cd` into `head`.** c18 and c19 differ by
  both. One run with each rule alone would settle it.
- **Whether `Workflow` would have run `head`'s agent in route A** had its review not refused it.
  Approving it means a session that runs a planted agent, and the route already fails item 1
  without it.

## Outside this card's acceptance

These are for the coordinator. I have filed no card.

- **A headless session can see the owner's other Claude Code sessions.** In c4, c12 and c13 the
  session called `ListAgents`, which lists four of the owner's interactive sessions on the host by
  name and state, with "the name other sessions use to message it". `SendMessage` is in every
  `init` record's `tools`. I did not call it. A judge that can message the owner's other sessions
  bears on `R-SAFE-7`.
- **Claude Code 2.1.287 adds a built-in plugin #473's withholding list does not name**,
  `cc-plugin-plugin-authoring`, with a bundled skill `plugin-authoring`. It appeared in every run
  under `--setting-sources project` (c2 to c19), and not in c1 without it. #480's `enabledPlugins`
  entry, if built from #473's list, would miss it.
- **Codex's `--add-dir` is silently ignored under a `read-only` sandbox** (x3). Ruling 4's flags
  alone produce that sandbox, and #489's live run needs a write.

## Cleanup

These were removed after the runs, each only after its extract was saved:

- the probe directories c519-cc/ and c519-cx/;
- the 19 transcripts under `~/.claude/projects/`, and the background-task directory under
  `/private/tmp/claude-501/`;
- the four Codex rollouts under `~/.codex/sessions/`.

No credential was linked or copied. Rows that Claude Code's `~/.claude.json` and Codex's databases
hold for these sessions remain; I did not edit the owner's files.
