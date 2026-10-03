// ABOUTME: L0's provider adapter for Codex: every fact Rigger holds about the `codex` CLI, the skill
// probe it runs, and the command line, standard input and environment that run one role's agent
// file in one directory under a Codex home of the dispatch's own.

import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { gitEnvironment } from '../git-environment.mjs';
import { runCommand } from '../process.mjs';

/*
 * Every flag and setting here is grounded in #473's report, `docs/spikes/what-headless-sessions-
 * load.md`, measured with codex-cli 0.159.2 and cited below by its run labels, in #519's report,
 * `docs/spikes/how-a-judge-reaches-head.md`, and in the architect's rulings 4, 5 and 18 on #467.
 * The flags this module passes, read beside `codex exec --help` at codex-cli 0.159.2 (engineer 17):
 * `exec`, `--json`, `-C`, `--add-dir`, `-m`, `-c` and `--disable`. None of them is one of the
 * flags that widen what the directory's own declaration says of the sandbox, approval or network:
 * `-s`, `--approve-for-me`, `--dangerously-bypass-approvals-and-sandbox`,
 * `--dangerously-bypass-hook-trust`, `--enable` and `--ignore-rules`. The `-c` keys it sets are
 * the model's effort, the agent file and the skill toggles, none of them a sandbox, approval or
 * network key. `--add-dir` names a writable root, which only a `workspace-write` sandbox the
 * declaration chose honours (#519's x3 to x5).
 *
 * Where `codex`'s answer can differ from what this module expects (`D16` rule 3), measured with
 * codex-cli 0.159.2 by #473's report and #519's report. The gated live run,
 * `test/provider-codex-live.test.mjs`, measures the two facts below marked not yet measured.
 *
 * - **The home.** `CODEX_HOME` names the directory Codex reads its `config.toml`, its
 *   credentials and its bundled skills from, and writes its rollouts under (r1-x16). A version
 *   that ignores it reads the owner's own home, plugins and computer-use server included.
 * - **The declaration.** A directory's `.codex/config.toml` is read only where the directory is
 *   trusted, and the trust entry lives in the user's configuration (r1-x5, r1-x13). The home's
 *   `config.toml` is read with no trust (r1-x16), so the declaration is copied there. A version
 *   that stops loading MCP servers or instructions from it breaks the route (ruling 18).
 * - **The credentials.** The home's `auth.json` is a symbolic link to the owner's. Codex's own
 *   credential write went through such a link (r1-login-through-link). Whether a token refresh
 *   does too is not yet measured; the gated live run observes it. A version whose refresh
 *   replaces the link with a file leaves a copy of the credentials in the scratch directory
 *   (`R-SAFE-1`).
 * - **Plugins, apps and the host's browser and desktop.** `--disable plugins` withheld every
 *   plugin, the owner's computer-use server among them (r1-x44); `--disable apps` withheld
 *   `request_plugin_install` (x41). `HOST_FEATURES` is the list of features #473 found reaching the
 *   owner's browser or desktop; disabling them removed nothing measurable (r1-x45, r1-x42), and they
 *   are disabled under `D16` rule 3 so that a version in which one acts alone is held off too.
 * - **The agent file.** `-c developer_instructions=<the file>` carried a 4,057-word file whole,
 *   frontmatter included, as one developer message (r1-x30). The frontmatter never needed
 *   stripping for the end marker to arrive (x28 to x30), so it is not stripped (O16).
 * - **The prompt.** With no prompt argument, `codex exec` reads the prompt from standard input
 *   (x34), and exits 1 on an empty one (r1-x35).
 * - **The tiers.** `-m gpt-6.1-sol` with `model_reasoning_effort` `medium` resolved to that model
 *   and effort in the rollout, and `high` to `high` (r1-x37, r1-x38).
 * - **The bundled `.system` skills.** They are written into every fresh home (ruling 4) and
 *   reported by the probe from outside the directory, so they are withheld with every other such
 *   skill. Withholding them is optional (O18).
 * - **A `skills.config` the declaration holds.** The `-c skills.config` override replaces the
 *   declaration's own list rather than adding to it, so a consumer's own skill toggles do not
 *   reach the session. Not measured; a judgment from how `-c` replaces a key.
 */

/** The provider name a role's `provider` key names this adapter by. */
export const name = 'codex';

/**
 * How Codex is asked whether it is signed in (`D16` rule 1): `codex login status`, whose words
 * `signedIn` reads.
 */
export const auth = ['codex', 'login', 'status'];

/** The directory, under a consumer's repository, Codex reads its project configuration from (#473's report, r1-x10). */
export const assets = '.codex';

/**
 * The model each tier Rigger fixes selects (`O4`), with the effort `EFFORT` gives it, as #473's
 * report recommends (r1-x37, r1-x38).
 */
export const tiers = { standard: 'gpt-6.1-sol', high: 'gpt-6.1-sol' };

/** The `model_reasoning_effort` each tier selects beside its model. */
const EFFORT = { standard: 'medium', high: 'high' };

/**
 * Codex's words for a signed-in and a signed-out account, as `codex login status` writes them to
 * standard error: a copy of that CLI's answer (`D16` rule 2), tied to it by the gated live test
 * `test/provider-codex-live.test.mjs`. Measured with codex-cli 0.159.2 on 2026-10-03: signed in
 * with ChatGPT it wrote `Logged in using ChatGPT` and exited 0, and with an empty `CODEX_HOME`
 * `Not logged in` and exited 1, with nothing on standard output either time. The same binary holds
 * `Logged in using ` before each other way of signing in, an API key among them, whose line carries
 * part of the key, so the line is read and never repeated.
 */
const SIGNED_IN = /^Logged in using /m;
const SIGNED_OUT = /^Not logged in$/m;

/**
 * Whether `said`, what `codex login status` answered, says Codex is signed in: true, false, or
 * undefined where it says neither in words this reads.
 */
export function signedIn(said) {
  const text = `${said.stderr ?? ''}${said.stdout ?? ''}`;
  if (SIGNED_IN.test(text)) return true;
  if (SIGNED_OUT.test(text)) return false;
  return undefined;
}

/**
 * The features `codex features list` showed reaching the owner's browser or desktop, all stable and
 * on at codex-cli 0.159.2 (#473's report, "Apps, .system skills, plugin caches and the browser and
 * computer-use features"), each disabled under `D16` rule 3.
 */
const HOST_FEATURES = ['browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'in_app_browser'];

/** The flags both the probe and the session pass, so each reads the same configuration (ruling 18). */
const WITHHELD = ['--disable', 'plugins', '--disable', 'apps', ...HOST_FEATURES.flatMap((feature) => ['--disable', feature])];

/** The name of the Codex home a dispatch's scratch directory holds. */
const HOME = 'codex-home';

/**
 * How long L0 lets the skill probe run before it kills the probe's group. A judgment, not a
 * measurement, recorded as `GIT_TIMEOUT` is. Its premise is a measurement: ten runs of the probe
 * as this module runs it, in a probe repository under a fresh home, took 0.45 to 1.07 s each with
 * codex-cli 0.159.2 on 2026-10-03, at a one-minute load near 16. A minute is over fifty times the
 * slowest, room for a loaded host, while a probe that hangs holds a dispatch back by a minute.
 *
 * The probe runs outside any dispatch's record: it is part of answering the invocation, before L1
 * records `dispatch.start`, so no entry names its group. An engine killed outright while it runs
 * leaves it to end by itself, as any `git` or `gh` call under `GIT_TIMEOUT` is left.
 */
export const PROBE_TIMEOUT = 60_000;

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
 * `text` as a TOML basic string, which is how `-c` reads a value: JSON's escapes are TOML's, but
 * for DEL, which TOML admits only escaped.
 */
const toml = (text) => JSON.stringify(text).replaceAll('\u007f', '\\u007f');

/**
 * The skill list in `answer`, what `codex debug prompt-input` printed, as absolute `SKILL.md`
 * paths, or a thrown error saying why it holds none this can read.
 *
 * The format, measured with codex-cli 0.159.2 on 2026-10-03 and recorded at
 * `test/fixtures/codex-prompt-input-0.159.2.json` (`D16` rule 3): a JSON array of model-visible
 * messages, one of which holds a `<skills_instructions>` block. In it, a `### Skill roots` table
 * gives each root as a line `` - `rN` = `<absolute path>` ``, and each skill under
 * `### Available skills` is one line ending `(file: rN/<name>/SKILL.md)`. Each `rN` is expanded to
 * its root's path. A file given as an absolute path is taken as it is. Any other form, a root the
 * table does not hold, or no block at all is refused, because a list read short would leave a
 * skill from outside the directory loaded: every home holds the bundled skills, so a block with
 * no skill is not an answer Codex gives.
 */
function skillsIn(answer) {
  let messages;
  try {
    messages = JSON.parse(answer);
  } catch (failure) {
    throw new Error(`it printed no JSON: ${failure.message}`);
  }
  const texts = (Array.isArray(messages) ? messages : []).flatMap((message) => (Array.isArray(message?.content) ? message.content : [])).map((part) => part?.text).filter((text) => typeof text === 'string');
  const block = texts.find((text) => text.includes('<skills_instructions>'));
  if (block === undefined) throw new Error('its answer holds no skill list');
  const roots = new Map([...block.matchAll(/^- `(r\d+)` = `(.+)`$/gm)].map(([, key, path]) => [key, path]));
  return [...block.matchAll(/^- .*\(file: (.+)\)$/gm)].map(([, file]) => {
    if (isAbsolute(file)) return file;
    const [key, ...rest] = file.split('/');
    if (!roots.has(key) || rest.length === 0) throw new Error(`it names the skill file ${file}, under no root its table holds`);
    return join(roots.get(key), ...rest);
  });
}

/**
 * The skills Codex reports from outside `directory` for a session under `home`, as absolute
 * `SKILL.md` paths: the skill probe (ruling 4 Q2; ruling 5; ruling 18).
 *
 * It asks Codex itself (`D16` rule 1): `codex -C <directory> debug prompt-input`, under the same
 * `CODEX_HOME` and the same withholding flags as the session, since `prompt-input` takes neither
 * `--ignore-user-config` nor `--add-dir` (engineer r3-4). It runs through L0's process adapter, in
 * a process group of its own, in `directory`, under the engine's own environment less git's
 * redirecting variables, for at most `timeout` milliseconds, with every kill recorded through
 * `emitter`.
 *
 * `prompt-input` is an undocumented debugging command. Its agreement with the `host_skills` a
 * session's rollout records under the same home is not yet measured; the gated live run compares
 * the two with the version it names. A Codex release that drops the command or changes its answer, or a
 * documented switch that turns off the user's and the bundled skill roots, replaces the probe.
 */
async function probed({ directory, home, emitter, timeout }) {
  const args = ['-C', directory, ...WITHHELD, 'debug', 'prompt-input'];
  const spelled = `\`codex ${args.join(' ')}\``;
  const { exit, timedOut, stdout, stderr } = await runCommand({ command: 'codex', args, cwd: directory, env: { ...gitEnvironment(), CODEX_HOME: home }, timeout, emitter });
  if (timedOut) throw new Error(`the skill probe ${spelled} outlived its bound of ${timeout} ms, and L0 killed it`);
  if (exit !== 0) throw new Error(`the skill probe ${spelled} exited ${exit}: ${stderr.toString('utf8').trim().split('\n')[0] || stdout.toString('utf8').trim().split('\n')[0] || 'it said nothing'}`);
  let skills;
  try {
    skills = skillsIn(stdout.toString('utf8'));
  } catch (failure) {
    throw new Error(`the skill probe ${spelled} answered nothing this adapter can read: ${failure.message}`);
  }
  const real = realpathSync.native(directory);
  return skills.filter((skill) => !under(realOf(skill), real));
}

/**
 * The owner's own Codex home, whose `auth.json` a dispatch's home links to: the `CODEX_HOME` the
 * engine runs under, or `~/.codex`, Codex's default.
 */
const ownerHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');

/**
 * Makes the Codex home for a dispatch in `directory` under its scratch directory `scratch`, and
 * answers its path (ruling 18): `config.toml`, a copy of the directory's own declaration at
 * `.codex/config.toml`, or empty where the directory declares nothing, and `auth.json`, a symbolic
 * link to the owner's, never a copy (`R-SAFE-1`). The link is made whether or not the owner's file
 * exists, so a signed-out owner's session fails as Codex fails it. A home already there is
 * refused, since L1 makes the scratch directory fresh.
 */
function homeFor(directory, scratch) {
  const home = join(realpathSync.native(scratch), HOME);
  mkdirSync(home);
  const declared = join(directory, assets, 'config.toml');
  if (existsSync(declared)) copyFileSync(declared, join(home, 'config.toml'));
  else writeFileSync(join(home, 'config.toml'), '');
  symlinkSync(join(ownerHome(), 'auth.json'), join(home, 'auth.json'));
  return home;
}

/**
 * The command line that runs the agent file `agent`, at `tier`, on `prompt`, in `directory`, with
 * each directory `reach` names writable beside it: the CLI by its command name, its arguments, the
 * prompt's bytes for its standard input, no variable to unset, and `CODEX_HOME`, the dispatch's own
 * home in `scratch` (ruling 18). It runs the skill probe first, through `emitter`, bounded by
 * `probeTimeout`, and disables, by a `skills.config` entry per `SKILL.md` path, every skill the
 * probe reports from outside `directory`.
 *
 * Refused, each naming what it refused: a tier Rigger does not fix, before anything is made or
 * run; an agent file whose real path is not under `directory` (`R-SAFE-6`); an agent file that
 * cannot be read; a home that cannot be made; and a probe that fails, outlives its bound, or
 * answers nothing it can read.
 */
export async function invocation({ agent, tier, prompt, directory, scratch, reach = [], emitter, probeTimeout = PROBE_TIMEOUT }) {
  if (!Object.hasOwn(tiers, tier)) {
    throw new Error(`the Codex adapter maps no model to the tier \`${tier}\`, only to \`standard\` and \`high\``);
  }
  const real = realpathSync.native(directory);
  const file = resolve(directory, agent);
  const fileReal = realOf(file);
  if (!under(fileReal, real)) {
    throw new Error(`the agent file ${agent} lies at ${fileReal}, outside the consumer's repository ${real}, so the Codex adapter refused it (R-SAFE-6)`);
  }
  const instructions = readFileSync(file, 'utf8');
  const home = homeFor(directory, scratch);
  const outside = await probed({ directory, home, emitter, timeout: probeTimeout });
  const toggles = `[${outside.map((path) => `{path = ${toml(path)}, enabled = false}`).join(', ')}]`;
  return {
    command: 'codex',
    args: [
      'exec', '--json',
      '-C', directory,
      ...reach.flatMap((each) => ['--add-dir', each]),
      '-m', tiers[tier],
      '-c', `model_reasoning_effort=${toml(EFFORT[tier])}`,
      ...WITHHELD,
      '-c', `skills.config=${toggles}`,
      '-c', `developer_instructions=${toml(instructions)}`,
    ],
    input: Buffer.from(prompt, 'utf8'),
    unset: [],
    env: { CODEX_HOME: home },
  };
}
