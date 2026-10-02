// ABOUTME: L0's provider adapter for Claude Code: every fact Rigger holds about the `claude` CLI,
// and the command line and standard input that run one role's agent file in one directory.

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/*
 * Every flag and setting here is grounded in #473's report, `docs/spikes/what-headless-sessions-
 * load.md`, measured with Claude Code 2.1.286, and cited below by its run labels. Where `claude`'s
 * answer can differ from what this module expects (`D16` rule 3), measured on this host with
 * Claude Code 2.1.287 by #480's gated live runs (`test/provider-claude-live.test.mjs`):
 *
 * - `--append-system-prompt-file` is absent from `claude --help`'s list of options, which names
 *   it only inside the text for `--bare`. The live runs carried the agent file's last sentence
 *   through it, as #473's c30 did. What a version that drops it does with it is not measured.
 * - `--strict-mcp-config` drops the directory's own `.mcp.json` with every other MCP source, so
 *   the file is named again with `--mcp-config` (c2, c6). A version in which the strict flag
 *   stops dropping the claude.ai connectors would let them back in; the live run reads that from
 *   the session's own `init` record.
 * - `claudeMdExcludes` is matched against absolute paths as globs. The live run measured that an
 *   absolute path, with no glob character in it, withheld a parent's `CLAUDE.md`, which reaches a
 *   session without it (c10).
 * - An MCP tool the directory's own settings allow is called; one they do not is refused with
 *   "Claude requested permissions to use mcp__…, but you haven't granted it yet", and the session
 *   still exits 0. A version that honours an untrusted directory's own `permissions.allow` makes
 *   `rulesOf` redundant, never wrong.
 * - The tools a session is offered, and which act through the owner's account, are `OWNERS`'s
 *   measurement on 2.1.287, and the built-in plugins `BUILTINS`'s. Each moves on a patch release.
 *
 * One source the reports found is not withheld here: the owner's account email, which #473's
 * report found in every session's context (c47), and for which it found no withholder.
 */

/** The provider name a role's `provider` key names this adapter by. */
export const name = 'claude';

/**
 * How Claude Code is asked whether it is signed in. `D16` rule 1: Claude Code owns that fact, and
 * `claude auth status --json` states it as `loggedIn`, which `doctor`'s `agentAuth` reads and
 * records what was measured of.
 */
export const auth = ['claude', 'auth', 'status', '--json'];

/** The directory, under a consumer's repository, Claude Code reads its assets from. */
export const assets = '.claude';

/**
 * The model each tier Rigger fixes selects (`O4`), as #473's report recommends (item 7): `sonnet`
 * resolved to `claude-sonnet-5-5` and `opus` to `claude-opus-5-5` (c32).
 */
export const tiers = { standard: 'sonnet', high: 'opus' };

/**
 * The variables `claude` must not inherit from the engine's environment (ruling 3 AQ5 on #467).
 * Empty, as measured: #473's report removed the eleven `CLAUDE*` variables a calling Claude Code
 * session carries and found no difference in the `init` record, the transcript, the debug log or
 * the request sent (c1, c2, c23 to c26). None of them carries the owner's authentication, since
 * every run without them signed in ("Inherited environment variables").
 */
const UNSET = [];

/**
 * The variable that keeps background-task output under the session's directory, and the fixed,
 * dot-named directory under it that the invocation sets it to (ruling 9 on #467). #473's report
 * found that output written under `/tmp/claude-<uid>/<encoded working directory>/<session>/tasks/`,
 * outside the directory, whatever `TMPDIR` said (c33, c34), and moved under the directory by
 * `CLAUDE_CODE_TMPDIR` (c35). #480's live run measured it on Claude Code 2.1.287: a background
 * task's output landed under `<directory>/.claude-tmp/`. For a maker those files lie in its
 * worktree, untracked, under the one name.
 */
const TMPDIR_KEY = 'CLAUDE_CODE_TMPDIR';
const TMPDIR_NAME = '.claude-tmp';

/**
 * The worktree tools, which #473's report found offered under both flags and withheld by
 * `--disallowedTools` (c36). They are withheld from every session.
 */
const WORKTREE = ['EnterWorktree', 'ExitWorktree'];

/**
 * Every tool Claude Code offers a session that acts through the owner's own sessions or login,
 * which `R-SAFE-9` withholds unless the repository declares it. Measured on Claude Code 2.1.287,
 * by the definitions a session's request carried and the tools its `init` record listed:
 *
 * - `ListAgents` lists "other local Claude sessions on this machine" and the account's cloud
 *   sessions; #519's report found it listing four of the owner's interactive sessions;
 * - `SendMessage` sends a message to any session `ListAgents` names;
 * - `PushNotification` "sends a desktop notification in the user's terminal", and to their phone;
 * - `RemoteTrigger` creates and manages "routines: cloud agents on a schedule" on the account;
 * - `DesignSync` reads and updates claude.ai designs "through their claude.ai login".
 *
 * The agent tool, `Task` (sent as `Agent`), also acts through the account in one form: its
 * `isolation: "remote"` "launches the agent in a remote cloud environment". The CLI runs it so only
 * where the owner is signed in to claude.ai, the directory has a git remote, `~/.claude.json` holds
 * `hasUsedRemoteSession` and `hasRemoteEnvironment`, and the flag `tengu_neapolitan` is on (its
 * gate, read from the 2.1.287 binary). No flag, setting or path the invocation may pass withholds
 * that form alone, so the whole tool is withheld, and a dispatched agent gets no subagents (O45).
 * A rule may name it `Task` or `Agent` (#519's report, c2, c3), so either declares it.
 *
 * Every other tool in that record acts within the session or on its host as the session's own
 * user. `Workflow`, `Monitor`, `TaskStop`, `CronCreate`, `CronDelete`, `CronList` and
 * `ScheduleWakeup` act within the session; `Bash`, `Read`, `Edit`, `Write` and
 * `NotebookEdit` on the host; `ToolSearch` loads a deferred tool's definition; `ReportFindings`
 * renders findings in the host's own interface; `WebFetch` and `WebSearch` reach the public web.
 * Claude in Chrome, which drives the owner's browser, is kept out by `--no-chrome`. A version adding
 * a tool that acts through the account offers it until this list names it.
 *
 * A repository declares one by naming it in its own `permissions.allow`.
 */
const OWNERS = ['Task', 'ListAgents', 'SendMessage', 'PushNotification', 'RemoteTrigger', 'DesignSync'];

/** The other names a rule may give a tool in `OWNERS`, each of which declares it. */
const ALIASES = { Task: ['Agent'] };

/**
 * The built-in plugins Claude Code loads under `--setting-sources project`, each withheld by
 * `enabledPlugins` unless the directory's own settings enable it. The first two are #473's (c36);
 * the third is the one #519's report found under 2.1.287.
 */
const BUILTINS = ['cc-plugin-agents-md@builtin', 'cc-plugin-telemetry@builtin', 'cc-plugin-plugin-authoring@builtin'];

/** The permission lists carried across from the directory's own settings, and nothing else. */
const RULES = ['allow', 'deny', 'ask'];

/** The card that carries `reach` once #519 has measured a route that loads nothing from it. */
const REACH_CARD = '#520';

/** What a `claudeMdExcludes` glob reads as other than itself. */
const GLOB = /[*?[\]{}\\]|[!@+]\(/;

/**
 * The real path of `path`, a file that need not exist: the real path of its nearest ancestor that
 * does, with the rest of `path` after it. A link that exists and cannot be resolved throws, so it
 * is refused rather than taken for absent.
 */
function realOf(path) {
  try {
    lstatSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(realOf(parent), basename(path));
  }
  return realpathSync.native(path);
}

/** Whether the real path `path` lies under the real path `directory`. */
function under(path, directory) {
  const between = relative(directory, path);
  return between !== '' && !isAbsolute(between) && between.split(sep)[0] !== '..';
}

/**
 * What `directory`'s own `.claude/settings.json` declares, as a JSON object, or an empty one where
 * there is no such file. A file that is no JSON object is refused, because the CLI would ignore it
 * in silence and its hooks with it.
 */
function declaredIn(directory) {
  const file = join(directory, '.claude', 'settings.json');
  if (!existsSync(file)) return {};
  let declared;
  try {
    declared = JSON.parse(readFileSync(file, 'utf8'));
  } catch (failure) {
    throw new Error(`${file} is no JSON the Claude Code adapter can read, so it started nothing: ${failure.message}`);
  }
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) {
    throw new Error(`${file} holds no JSON object, so the Claude Code adapter started nothing`);
  }
  return declared;
}

/**
 * The permission rules `declared` holds, as `{ allow, deny, ask }` holding each it declares, or
 * undefined where it declares none.
 *
 * A `-p` session ignores an untrusted directory's own `permissions.allow` and honours the same
 * rule passed in `--settings` (#473's report, "A command the directory's settings do not allow";
 * c38, c42). So the consumer's own rules decide, as ruling 1 Q1 has them decide, only once they are
 * carried across. A mode or a directory in the same block is not, since either would skip or
 * widen the checks.
 */
function rulesOf(declared) {
  const rules = Object.fromEntries(RULES.filter((list) => Array.isArray(declared.permissions?.[list])).map((list) => [list, declared.permissions[list]]));
  return Object.keys(rules).length === 0 ? undefined : rules;
}

/** Every `CLAUDE.md` above `directory`, up to the root, as absolute paths. */
function above(directory) {
  const files = [];
  for (let at = dirname(directory); ; at = dirname(at)) {
    files.push(join(at, 'CLAUDE.md'));
    if (dirname(at) === at) return files;
  }
}

/**
 * The command line that runs the agent file `agent`, at `tier`, on `prompt`, in `directory`: the
 * CLI by its command name, its arguments, the prompt's bytes for its standard input, the variables
 * it must not inherit, and the variables it sets, each a path under `directory` (ruling 9 on
 * #467). It runs nothing, so it leaves `emitter` unused (ruling 5 on #467).
 *
 * Refused, each naming what it refused: any `reach`, until `REACH_CARD` carries it (ruling 8 on
 * #467); a tier Rigger does not fix; an agent file whose real path is not under `directory`
 * (`R-SAFE-6`), though the file is not read and need not exist; a directory under a path holding a
 * glob character, which its `CLAUDE.md` exclusions would read as a pattern; and a settings file in
 * `directory` that is no JSON object.
 */
export async function invocation({ agent, tier, prompt, directory, reach = [], emitter }) {
  if (reach.length > 0) {
    throw new Error(
      `the Claude Code adapter refuses \`reach\` (${reach.join(', ')}) until ${REACH_CARD}, because ` +
      '`--add-dir` loads a reached directory\'s skills and agents (ruling 8 on #467), so it answered no command',
    );
  }
  if (!Object.hasOwn(tiers, tier)) {
    throw new Error(`the Claude Code adapter maps no model to the tier \`${tier}\`, only to \`standard\` and \`high\``);
  }
  const real = realpathSync.native(directory);
  const file = resolve(directory, agent);
  const fileReal = realOf(file);
  if (!under(fileReal, real)) {
    throw new Error(`the agent file ${agent} lies at ${fileReal}, outside the consumer's repository ${real}, so the Claude Code adapter refused it (R-SAFE-6)`);
  }
  const excludes = [...new Set([...above(resolve(directory)), ...above(real)])];
  const globbed = excludes.find((each) => GLOB.test(each));
  if (globbed !== undefined) {
    throw new Error(`the directory ${directory} lies under a path holding a glob character, as ${globbed} does, so its \`claudeMdExcludes\` entries would match other files`);
  }
  const mcp = join(directory, '.mcp.json');
  const declared = declaredIn(directory);
  const allowed = rulesOf(declared)?.allow ?? [];
  const declares = (tool) => [tool, ...(ALIASES[tool] ?? [])].some((each) => allowed.includes(each));
  const withheld = [...WORKTREE, ...OWNERS.filter((tool) => !declares(tool))];
  const enabledPlugins = Object.fromEntries(BUILTINS.filter((id) => declared.enabledPlugins?.[id] !== true).map((id) => [id, false]));
  const settings = { autoMemoryEnabled: false, claudeMdExcludes: excludes, enabledPlugins, permissions: rulesOf(declared) };
  return {
    command: 'claude',
    args: [
      '-p', '--output-format', 'stream-json', '--verbose', '--include-hook-events',
      '--model', tiers[tier],
      '--strict-mcp-config', ...(existsSync(mcp) ? ['--mcp-config', mcp] : []),
      '--setting-sources', 'project',
      '--settings', JSON.stringify(settings),
      '--disallowedTools', withheld.join(','),
      '--no-session-persistence',
      '--disable-slash-commands',
      '--no-chrome',
      '--append-system-prompt-file', file,
    ],
    input: Buffer.from(prompt, 'utf8'),
    unset: [...UNSET],
    env: { [TMPDIR_KEY]: join(real, TMPDIR_NAME) },
  };
}
