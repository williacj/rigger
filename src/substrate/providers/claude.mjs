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
 * - The built-in tools offered under these flags were `Task`, `Bash`, `CronCreate`, `CronDelete`,
 *   `CronList`, `DesignSync`, `Edit`, `ListAgents`, `Monitor`, `NotebookEdit`, `PushNotification`,
 *   `Read`, `RemoteTrigger`, `ReportFindings`, `ScheduleWakeup`, `SendMessage`, `TaskStop`,
 *   `ToolSearch`, `WebFetch`, `WebSearch`, `Workflow` and `Write`. A version adding a tool that acts
 *   through the owner's account offers it until `WITHHELD` names it.
 *
 * Two sources the report found are not withheld here, and where each goes is recorded:
 *
 * - **Background-task output.** It is written under `/tmp/claude-<uid>/<encoded working
 *   directory>/<session>/tasks/`, outside the directory, whatever `TMPDIR` says (c33, c34). The
 *   report moved it under the directory with the variable `CLAUDE_CODE_TMPDIR` (c35), and
 *   `invocation` answers variables to unset but none to set (ruling 5 on #467), so it cannot pass
 *   one.
 * - **The built-in plugins**, `cc-plugin-agents-md` and `cc-plugin-telemetry`, and on 2.1.287 a
 *   third, `cc-plugin-plugin-authoring`, read off the live run's `init` record. The report leaves
 *   withholding them to the owner ("Built-in plugins and bundled skills").
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
 * The built-in tools withheld from every session, by `--disallowedTools`, which the report found
 * withholds a built-in tool (c36):
 *
 * - the worktree tools, which the report found offered under both flags ("The worktree tool");
 * - the tools that act through the owner's own account, which `R-SAFE-9` withholds unless the
 *   repository declares them. On Claude Code 2.1.287, read off #480's live run's `init` record,
 *   they are `RemoteTrigger`, which starts the owner's cloud routines, `PushNotification`, which
 *   notifies the owner's devices, and `DesignSync`, which writes to the owner's claude.ai designs.
 *   Which tool acts through the account is a judgment from what each does, not a measurement.
 *   Nothing here yet reads a repository's declaration of one, so each is withheld always.
 *
 * Claude in Chrome, which drives the owner's browser, is kept out by `--no-chrome`.
 */
const WITHHELD = ['EnterWorktree', 'ExitWorktree', 'RemoteTrigger', 'PushNotification', 'DesignSync'];

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
 * The permission rules `directory`'s own `.claude/settings.json` declares, as `{ allow, deny, ask }`
 * holding each it declares, or undefined where it declares none.
 *
 * A `-p` session ignores an untrusted directory's own `permissions.allow` and honours the same
 * rule passed in `--settings` (report, "A command the directory's settings do not allow"; c38,
 * c42). So the consumer's own rules decide, as ruling 1 Q1 has them decide, only once they are
 * carried across. A mode or a directory in the same block is not, since either would skip or
 * widen the checks. A file that is no JSON object is refused, because the CLI would ignore it in
 * silence and its hooks with it.
 */
function rulesOf(directory) {
  const file = join(directory, '.claude', 'settings.json');
  if (!existsSync(file)) return undefined;
  let declared;
  try {
    declared = JSON.parse(readFileSync(file, 'utf8'));
  } catch (failure) {
    throw new Error(`${file} is no JSON the Claude Code adapter can read, so it started nothing: ${failure.message}`);
  }
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) {
    throw new Error(`${file} holds no JSON object, so the Claude Code adapter started nothing`);
  }
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
 * CLI by its command name, its arguments, the prompt's bytes for its standard input, and the
 * variables it must not inherit. It runs nothing, so it leaves `emitter` unused (ruling 5 on #467).
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
  const settings = { autoMemoryEnabled: false, claudeMdExcludes: excludes, permissions: rulesOf(directory) };
  return {
    command: 'claude',
    args: [
      '-p', '--output-format', 'stream-json', '--verbose', '--include-hook-events',
      '--model', tiers[tier],
      '--strict-mcp-config', ...(existsSync(mcp) ? ['--mcp-config', mcp] : []),
      '--setting-sources', 'project',
      '--settings', JSON.stringify(settings),
      '--disallowedTools', WITHHELD.join(','),
      '--disable-slash-commands',
      '--no-chrome',
      '--append-system-prompt-file', file,
    ],
    input: Buffer.from(prompt, 'utf8'),
    unset: [...UNSET],
  };
}
