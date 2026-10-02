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
 * How a judge reaches its `head` (`reach`): route B of #519's report, `docs/spikes/how-a-judge-
 * reaches-head.md`, measured with Claude Code 2.1.287. No `--add-dir`, which lists the reached
 * directory's agents even with slash commands disabled and the agent tool withheld (route A, c2,
 * c12), and no `permissions.additionalDirectories`; only path-scoped `Read` and `Edit` rules in
 * `--settings`, so nothing of `head`'s loads (c6 to c8, c13 to c19). The fallback is route C,
 * `permissions.additionalDirectories: [<head>]` in the same `--settings` JSON, which the report
 * found passing too, loading nothing from `head` and running `npm test` there with no reset of the
 * shell's directory (c9 to c11). It is used only where a live run shows route B failing. Route B
 * stops passing in a version that loads `head`'s `CLAUDE.md` or `.claude/` once a session reads
 * there or enters it with `cd`, or in one where the `//` rules stop admitting the read, the write or
 * the `cd` (report, "What would reverse the recommendation"); the gated live run
 * `test/provider-claude-reach-live.test.mjs` reads both.
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
 * `Workflow`, whose definition reads "Execute a workflow script that orchestrates multiple
 * subagents", is withheld for the agent tool's reason: no flag limits what a workflow's agents may
 * do, so a session offered it would have subagents after all (O52).
 *
 * Every other tool in that record acts within the session or on its host as the session's own
 * user. `Monitor`, `TaskStop`, `CronCreate`, `CronDelete`, `CronList` and `ScheduleWakeup` act
 * within the session; `Bash`, `Read`, `Edit`, `Write` and `NotebookEdit` on the host;
 * `ToolSearch` loads a deferred tool's definition; `ReportFindings` renders findings in the host's
 * own interface; `WebFetch` and `WebSearch` reach the public web.
 * Claude in Chrome, which drives the owner's browser, is kept out by `--no-chrome`. A version adding
 * a tool that acts through the account offers it until this list names it.
 *
 * A repository declares one by naming it in its own `permissions.allow`.
 */
const OWNERS = ['Task', 'Workflow', 'ListAgents', 'SendMessage', 'PushNotification', 'RemoteTrigger', 'DesignSync'];

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

/**
 * What makes a Bash rule name a compound command line rather than one command: any shell list or
 * pipeline operator, `;`, `&`, `&&`, `|`, `||` or a line break. It is read as characters, so a rule
 * holding one only inside quotes, such as `Bash(grep -E 'a|b' x)`, is refused too.
 */
const COMPOUND = /[;&|\n\r]/;

/**
 * The characters a reached directory's real path may hold, so that no rule reads part of the path
 * as a separator, a glob or `:*`: a glob character would let `Read(/<head>/**)` and
 * `Edit(/<head>/**)` match directories beside it. A space is admitted (ruling 12 on #520), since the
 * default worktree root sits beside the consumer's checkout, under a home that may hold one; #531's
 * live run read, wrote and ran a command in a `head` whose path held one, with no denial. Should
 * Claude Code stop matching `Read(//<path with a space>/**)`, refusing the space is the fallback,
 * and that carries a README line, which is the owner's.
 */
const PLAIN = /^[A-Za-z0-9/._+ -]+$/;

/**
 * `rules` with the grant on each directory `reach` names, by route B of #519's report
 * ("Recommendation"): a `Read` and an `Edit` rule on the directory's real path, which begins with
 * `/`, so each rule begins `//`, Claude Code's form for an absolute path. Without them a session can
 * neither read, write nor `cd` there (c14, c18).
 *
 * No `cd` rule is written (ruling 12 on #520). #531 measured on Claude Code 2.1.287 that with the
 * two path rules and no `Bash(cd <head>)`, `cd <head> && npm test` ran with no permission denied. A
 * version that denies a `cd` into `head` with no rule brings the rule back, written only for a path
 * whose characters a Bash rule takes plainly.
 *
 * The commands a role runs in `head` are those the directory's own settings allow, each already a
 * rule of its own. Claude Code matches a Bash rule against each part of a compound command, so
 * `cd <head> && npm test` runs under `Bash(npm test)`, and a rule naming a compound line admits
 * nothing, not even that line (c16, c17, c19). Such a declared rule is refused, naming it, rather
 * than handed on as a grant it is not. A reached directory whose real path cannot be read is
 * refused, since a rule on a path it does not resolve to was not measured to match; so is one whose
 * real path holds a character outside `PLAIN`.
 *
 * Each deny rule the directory's settings declare for a path relative to it is written again for
 * each reached directory by `anchoredAt`, so the consumer's deny rules apply there too (O61 on #520;
 * ruling 12). `real` is the working directory's real path, at which a `/path` rule is anchored too.
 */
function granting(rules, reach, real) {
  if (reach.length === 0) return rules;
  const compound = Object.values(rules ?? {}).flat().find((rule) => /^Bash\(/.test(rule) && COMPOUND.test(rule));
  if (compound !== undefined) {
    throw new Error(`the directory's settings declare ${compound}, a rule for a compound command line, which admits nothing (#519's report, c17), so the Claude Code adapter started nothing`);
  }
  const heads = reach.map((each) => realpathSync.native(each));
  const unplain = heads.find((head) => !PLAIN.test(head));
  if (unplain !== undefined) {
    throw new Error(`the reached directory ${unplain} holds a character outside letters, digits, a space and \`/._+-\`, which its rules would read as more than a path, so the Claude Code adapter started nothing`);
  }
  const grants = heads.flatMap((head) => [`Read(/${head}/**)`, `Edit(/${head}/**)`]);
  const denied = rules?.deny ?? [];
  const copied = (at, fromRoot) => denied.map((rule) => anchoredAt(rule, at, fromRoot)).filter((copy) => copy !== undefined);
  const copies = [...heads.flatMap((head) => copied(head, false)), ...copied(real, true)];
  return { ...rules, allow: [...(rules?.allow ?? []), ...grants], ...(copies.length > 0 ? { deny: [...denied, ...copies] } : {}) };
}

/** A Read or Edit rule naming a path, as its tool and its path. */
const PATH_RULE = /^(Read|Edit)\((.+)\)$/s;

/**
 * The deny rule `rule` anchored at the directory `at`, or undefined where it is not copied there.
 * Claude Code reads a Read or Edit path as a gitignore pattern ("Read and Edit",
 * code.claude.com/docs/en/permissions), and the copy blocks under `at` what the rule blocks under the
 * working directory, depth for depth:
 *
 * - `path` and `./path` alike: one segment, alone or before `/**` or a trailing `/`, at any depth, as
 *   `**\/path`; more than one segment, at its own place under the current directory only.
 *   Measured, each rule in a working directory's own settings: `Read(./.env)` denied `.env` and
 *   `sub/.env` (Claude Code 2.1.287, #531's engineer judge; 2.1.288, the maker's probe);
 *   `Read(secrets/**)`, `Read(secrets/)` and `Read(./secrets/**)` each denied `secrets/token` and
 *   `sub/secrets/token`, and `Read(./a/b.txt)` and `Read(a/b.txt)` denied `a/b.txt` and not
 *   `x/a/b.txt` (2.1.288, the maker's probes). These are copied to each reached directory,
 *   and not to the working directory, where they already hold. A version that reads `./` as the
 *   top only, as the docs' "relative to current directory" suggests, makes a single-segment copy
 *   stricter than the rule, never wider.
 * - `/path` is "relative to the settings source", which for the consumer's project settings is the
 *   repository's root. Passed inline in `--settings` it does not hold there: #531 measured on Claude
 *   Code 2.1.287 that `Read(/secret.txt)` passed inline let a session read the working directory's
 *   `secret.txt`, while the same rule in the project's own `.claude/settings.json` denied it. Where
 *   the inline rule does resolve was not measured. So it is copied to each reached directory and,
 *   with `fromRoot`, to the working directory too (ruling 12 on #520).
 * - `//path` and `~/path` name one place already and are not copied.
 * - A `!` pattern is read relative to the current directory and cannot carve anything out of an
 *   anchored rule, so it is not copied, and a reached directory's copies may block what the working
 *   directory spares. That errs toward the consumer's deny intent and never widens (ruling 12). A
 *   judge measured unable to do its card's work for a negation its copies could not carry reverses
 *   it, as a placement question for the architect.
 */
function anchoredAt(rule, at, fromRoot) {
  const match = PATH_RULE.exec(rule);
  if (match === null) return undefined;
  const [, tool, path] = match;
  if (path.startsWith('//') || path.startsWith('~/') || path.startsWith('!')) return undefined;
  if (path.startsWith('/')) return `${tool}(/${at}${path})`;
  if (fromRoot) return undefined;
  const bare = path.startsWith('./') ? path.slice(2) : path;
  const relative = bare.replace(/\/(\*\*)?$/, '').includes('/') ? bare : `**/${bare}`;
  return `${tool}(/${at}/${relative})`;
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
 * #467). Each directory `reach` names is granted by `granting`; the prompt is handed over as given,
 * so whoever composes it names the directory there. It runs nothing, so it leaves `emitter` unused
 * (ruling 5 on #467).
 *
 * Refused, each naming what it refused: a tier Rigger does not fix; an agent file whose real path is not under `directory`
 * (`R-SAFE-6`), though the file is not read and need not exist; a directory under a path holding a
 * glob character, which its `CLAUDE.md` exclusions would read as a pattern; a settings file in
 * `directory` that is no JSON object; and, given `reach`, a reached directory with no real path, one
 * whose real path holds a character outside `PLAIN`, or a declared Bash rule for a compound line.
 */
export async function invocation({ agent, tier, prompt, directory, reach = [], emitter }) {
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
  const settings = { autoMemoryEnabled: false, claudeMdExcludes: excludes, enabledPlugins, permissions: granting(rulesOf(declared), reach, real) };
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
