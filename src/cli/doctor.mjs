// ABOUTME: The `doctor` verb: what it asks the tool that owns each fact, what it reports one line
// at a time, and the source tree it refuses to run against.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { gitEnvironment } from '../substrate/git-environment.mjs';
import { validate } from '../config/validate.mjs';
import { CONFIG } from './init.mjs';

/**
 * Runs a command and hands back what it answered, which is every authority this verb asks.
 *
 * The environment is the one `gitEnvironment` hands a git child. A `doctor` run from inside a git
 * hook, a `git rebase --exec` or a `git bisect run` inherits variables naming the repository that
 * started it, and git honours those over the directory this verb was pointed at. Every authority
 * here is asked about a named directory, so none may be redirected by the environment.
 */
const asked = (command, args) => spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });

/**
 * The package this code is part of, which is the source tree `R-SAFE-5` is about.
 *
 * Taken from this module's own location rather than from `process.argv[1]` or the working
 * directory, because neither answers where the running code lives: an installed bin is reached
 * through a symlink in `node_modules/.bin`, and Node resolves that symlink before it sets
 * `import.meta.url` — which is what makes an `npm link`ed engine resolve back to the checkout it
 * was linked from, as `AGENTS.md`'s "Self-hosting" section says it must.
 */
export const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The same directory, spelled the way the filesystem spells it.
 *
 * Every comparison below is between real paths, because a path is a name and two names for one
 * directory are what a string comparison reads as two directories. Measured rather than reasoned,
 * each on the host it occurs on:
 *
 * - `git rev-parse --show-toplevel` answers `C:/Users/...` on Windows where `process.cwd()`
 *   answers `C:\Users\...`, so the two never compare equal unless both are resolved. Measured
 *   with git 2.55.0 on Windows 11;
 * - `realpathSync.native` answers the canonical casing on Windows, so a `c:\users\...` spelling
 *   of the checkout resolves to the `C:\Users\...` the same directory is listed under. Measured
 *   on the same host, where the lowercased path answered with the canonical one;
 * - on macOS `os.tmpdir()` answers `/var/folders/...` while the same directory resolves to
 *   `/private/var/folders/...`, `/var` being a symlink. Measured by CI on macOS, which redded on
 *   one path resolved and the other not where this host's filesystem had let the pair through.
 *
 * A path that is not there is resolved as far as it can be and the rest carried across. Resolving
 * only what exists whole is the asymmetry that makes two spellings of one tree compare unequal,
 * and on macOS that is the everyday case rather than an edge: `/var/folders/x` and
 * `/private/var/folders/x` are one directory, so a path this could not resolve is a path still
 * spelled the other way. CI found it, on a comparison this host's filesystem let through.
 */
export const real = (dir) => {
  const full = resolve(dir);
  try {
    return realpathSync.native(full);
  } catch {
    const above = dirname(full);
    // A root resolves to itself, which is what stops this where no segment can be read at all.
    return above === full ? full : join(real(above), basename(full));
  }
};

/**
 * Whether one directory is another or sits beneath it.
 *
 * `relative` rather than a prefix comparison, because a prefix reads a sibling whose name starts
 * with the same characters as a child: this repository's worktrees live in `rigger-worktrees/`
 * beside the `rigger/` checkout, and `'rigger-worktrees/card-34'.startsWith('rigger')` is true.
 * A worktree is where a dispatched maker works, so a check that refused one would refuse every
 * card this engine is built by.
 */
function within(outer, inner) {
  const step = relative(outer, inner);
  return step === '' || (!step.startsWith('..') && !isAbsolute(step));
}

/**
 * Whether the tree being checked and the package doing the checking are one tree.
 *
 * Containment either way, because the two arrangements `R-SAFE-5` forbids sit either way about.
 * A run from inside the checkout — its root, or `docs/` beneath it — has the target within the
 * package. An engine installed into the target's own `node_modules` has the package within the
 * target, which is the arrangement where an agent clearing that directory deletes the runtime
 * mid-run. Equal paths are the plain case, and `within` reads them as either.
 */
export function sameTree(target, packageRoot = PACKAGE) {
  const [here, there] = [real(target), real(packageRoot)];
  return within(there, here) || within(here, there);
}

/**
 * The root of the repository a directory sits in, as git names it, or null where git names none.
 *
 * Git owns what a repository is, so it is asked (`D16` rule 1). Null rather than the directory
 * handed in, because a fallback is this code answering the same question a weaker way: the whole
 * point of asking is that a run from `<repo>/src` is compared as `<repo>`, and a git that
 * declines must not narrow that back to `<repo>/src`. What to do about a tree git cannot name is
 * the caller's to decide, and `doctor` refuses rather than compares.
 *
 * Where git's answer can differ from the directory handed in, measured by asking rather than
 * reasoned about, with git 2.55.0: it walks up, so a run from `docs/` inside a checkout answers
 * the checkout; a directory that is no repository answers 128 with nothing on stdout; and a host
 * with no git at all answers a null status, which is why the status is read before the output.
 */
export function repoRoot(dir, ask = asked) {
  const said = ask('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
  return said.status === 0 ? real(said.stdout.trim()) : null;
}

/**
 * The one form of `engines.node` this reads: a single `>=` comparator over a dotted version.
 *
 * npm owns the range language, and this reads one comparator of it rather than restating the
 * whole. Where npm's answer can differ from this one (`D16` rule 3), measured by writing the
 * range and reading what comes back rather than reasoned about:
 *
 * - every other form npm accepts — `^20`, `20.x`, `>=20 <23`, `^20 || ^22` — is unread here, and
 *   a check that cannot read its floor says so rather than answering for a comparison it never
 *   made. `test/doctor.test.mjs` measures the four above;
 * - npm reads a prerelease as below the release of the same numbers, where the comparison below
 *   drops the tag, so a Node built as `25.0.0-pre` satisfies a `>=25` floor here and would not
 *   under npm. Unmeasured against npm: no command it ships answers this question on its own, and
 *   a guess about how it would answer is what `D16` rule 3 exists to refuse.
 */
const FLOOR = /^>=\s*(\d+(?:\.\d+)*)$/;

/** Whether a dotted version reaches a floor, each segment the floor names compared in turn. */
function reaches(running, floor) {
  const has = running.split('-')[0].split('.').map(Number);
  const wants = floor.split('.').map(Number);
  for (const [index, want] of wants.entries()) {
    const got = has[index] ?? 0;
    if (got !== want) return got > want;
  }
  return true;
}

/**
 * Whether the running Node reaches the floor this package declares.
 *
 * `package.json` owns the floor: it is what npm refuses an install against, so a number typed
 * here would be a second answer to a question already answered (`D16` rule 1). Nothing is copied
 * — the file is read at the moment the check runs — and the line names both numbers compared, so
 * a consumer reads the floor rather than being told a verdict about it.
 */
export function nodeVersion({ packageRoot = PACKAGE, running = process.versions.node } = {}) {
  const name = 'Node version';
  let declared;
  try {
    declared = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).engines?.node;
  } catch (threw) {
    // A check that throws takes the whole report with it: the three checks below never run, and
    // a consumer setting Rigger up sees a stack trace where a line per check belongs. Every other
    // check here can say it could not look, and this one is no different.
    return { name, ok: null, detail: `the floor could not be read from \`package.json\`: ${wentWrong(threw)}` };
  }
  const floor = typeof declared === 'string' ? declared.trim().match(FLOOR) : null;
  if (!floor) {
    return {
      name,
      ok: null,
      detail: `\`engines.node\` says \`${declared}\`, which is no \`>=\` floor this reads, so `
        + `Node ${running} was compared against nothing`,
    };
  }
  return {
    name,
    ok: reaches(running, floor[1]),
    detail: `Node ${running} against the \`${declared}\` this package declares`,
  };
}

/**
 * The first thing a piece of text says, and nothing after it.
 *
 * Every detail in the report is one line, because the report is a line per check and a detail
 * that brought its own lines would break that shape wherever it landed — gh's account block and
 * a thrown error's stack are both several lines long.
 */
const oneLine = (text) => text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';

/** What a command said, whichever stream it said it on, reduced to its first line. */
const firstLine = (said) => oneLine(`${said.stdout ?? ''}\n${said.stderr ?? ''}`);

/**
 * One line saying what a thrown value was, whatever kind of value it is.
 *
 * `throw` takes any value, and the consumer's config is the one input here that is arbitrary code
 * (`configValidity` below). Reading `.message` off it works only for the half of that input which
 * happens to be an `Error`: it is `undefined` for a thrown string or plain object and unreadable
 * on a thrown `null`, so reading it is a second throw — and that one escapes the check, `doctor`,
 * the surface and the bin, and costs a consumer every line of the report. A check that says it
 * could not look is the whole point of this file, and it cannot say that by throwing.
 *
 * Quoting the value is itself the consumer's code running: `String` calls a `toString` they
 * supplied and `JSON.stringify` a `toJSON`, either of which can throw in its turn. What is left
 * to say then is that it threw, which is still a line.
 */
const wentWrong = (threw) => {
  let said;
  try {
    const held = threw instanceof Error ? threw.message : threw;
    said = oneLine(String((typeof held === 'string' ? held : JSON.stringify(held)) || threw));
  } catch {
    said = '';
  }
  return said || 'a value it could say nothing about';
};

/**
 * Why a command answered no status.
 *
 * Measured rather than reasoned: `spawnSync` answers a command it could not start at all with a
 * null status and an `error` carrying the code, where a command that ran and refused answers a
 * number. `test/doctor.test.mjs` runs a name that is not there and asserts that shape before it
 * relies on it. A status read without that distinction calls a tool nobody has as a tool that
 * answered, which is the green no one measured.
 */
const reason = (said) => said.error?.code ?? said.error?.message ?? 'it answered no status at all';

/**
 * Whether `gh` is authenticated, which is `gh auth status`'s answer and not this code's.
 *
 * `D16` rule 1: gh owns the fact. Its exit status is the whole of what is read — measured with
 * gh 2.96.0 as 0 authenticated and 1 not — and the line carries gh's own first line so a
 * consumer reads what to do about it. `--show-token` is never passed: it is the one argument
 * that would put a credential into a report (`AGENTS.md`, never log a secret).
 */
export function ghAuth({ ask = asked } = {}) {
  const name = 'gh authentication';
  const said = ask('gh', ['auth', 'status']);
  if (said.status === null) {
    return { name, ok: null, detail: `\`gh auth status\` could not be run here: ${reason(said)}` };
  }
  return { name, ok: said.status === 0, detail: `\`gh auth status\` exited ${said.status}: ${firstLine(said)}` };
}

/**
 * How each provider's CLI is asked whether it is authenticated, one argv per provider.
 *
 * Keyed by provider, as `init.mjs`'s `PROVIDER_ASSETS` is, and `test/doctor.test.mjs` holds the
 * two key sets to each other: a provider Rigger forks assets for and has no way to ask is a
 * provider this check would pass over in silence.
 */
export const AGENT_CLI = { claude: ['claude', 'auth', 'status', '--json'] };

/** What `loggedIn` a JSON answer states, or undefined where it states none this can read. */
function states(output) {
  try {
    return JSON.parse(output).loggedIn;
  } catch {
    return undefined;
  }
}

/** The verdict a set of them folds to: unknown if any is, failed if any is, passed otherwise. */
const folded = (verdicts) => {
  if (verdicts.length === 0 || verdicts.includes(null)) return null;
  return !verdicts.includes(false);
};

/**
 * Whether each agent CLI is authenticated, which is that CLI's answer and not this code's.
 *
 * `D16` rule 1: Claude Code owns whether Claude Code is signed in, and `claude auth status
 * --json` is the question it answers. The `loggedIn` it states is read rather than its exit
 * status, because the statement is the fact and the status is a second telling of it that could
 * drift from the first. Where its answer can differ (`D16` rule 3), measured with Claude Code
 * 2.1.281 on this host:
 *
 * - signed in it states `loggedIn: true` and exits 0; pointed at an empty `CLAUDE_CONFIG_DIR` it
 *   states `loggedIn: false` and exits 1. The two agreed in both runs, which is why either could
 *   have been read and why the drift between them is worth guarding against;
 * - `--json` is the default the command documents, and it is passed anyway, because a default is
 *   the one part of a tool's answer that changes without notice;
 * - an answer carrying no `loggedIn` this can read is reported unread. That is not a measured
 *   version of this CLI but the shape a later one could take, and reading a missing key as
 *   `false` would report a consumer signed out on a day the CLI merely reworded itself.
 */
export function agentAuth({ ask = asked, clis = AGENT_CLI } = {}) {
  const name = 'agent CLI authentication';
  const verdicts = [];
  const lines = [];
  for (const [command, ...args] of Object.values(clis)) {
    const said = ask(command, args);
    const spelled = `\`${[command, ...args].join(' ')}\``;
    if (said.status === null) {
      verdicts.push(null);
      lines.push(`${spelled} could not be run here: ${reason(said)}`);
    } else if (typeof states(said.stdout) !== 'boolean') {
      verdicts.push(null);
      lines.push(`${spelled} exited ${said.status} and stated no \`loggedIn\`, so nothing was read from it`);
    } else {
      verdicts.push(states(said.stdout));
      lines.push(`${spelled} states \`loggedIn: ${states(said.stdout)}\``);
    }
  }
  return { name, ok: folded(verdicts), detail: lines.join('; ') };
}

/**
 * Whether the config the consumer holds is one Rigger accepts, which is the validator's answer.
 *
 * `src/config/validate.mjs` decides what Rigger accepts, and every refusal it gives is carried
 * here word for word: a second reading of the config living in this file would be a second answer
 * to a question already answered, drifting from the first the day the validator gains a rule.
 *
 * The config is a module the consumer wrote, so importing it runs their code and can throw. What
 * the report carries is the first line of what went wrong, never the error: a stack of Node's
 * own frames tells a consumer nothing about the file they have to fix, and the card asks for a
 * line per check without one.
 */
export async function configValidity({ target = process.cwd() } = {}) {
  const name = 'config validity';
  const path = join(target, CONFIG);
  if (!existsSync(path)) {
    return { name, ok: false, detail: `\`${CONFIG}\` is not in ${target}, and \`rigger init\` is what writes it` };
  }
  let config;
  try {
    config = (await import(pathToFileURL(path))).default;
  } catch (threw) {
    return { name, ok: false, detail: `\`${CONFIG}\` could not be read: ${wentWrong(threw)}` };
  }
  const refusals = validate(config);
  return {
    name,
    ok: refusals.length === 0,
    detail: refusals.length === 0
      ? `\`${CONFIG}\` earns no refusals`
      : `\`${CONFIG}\`: ${refusals.map(oneLine).join('; ')}`,
  };
}

/**
 * What a check answered, in the words the report writes it with.
 *
 * Three verdicts and not two. A check that could not reach the tool it asks has not passed, and
 * saying so is the whole difference between a report a consumer can act on and one that claims
 * a green nobody measured.
 */
const SAYS = { true: 'ok', false: 'failed', null: 'not asked' };

/**
 * What a run of the checks prints, and the status it exits with.
 *
 * One line per check, the verdict first and then the check's own name, as `init` writes one line
 * per file under a heading that counts them. Zero only where every check passed: a check that
 * failed and one that could not be run are both "not passed", and either leaves a consumer with
 * a Rigger that is not ready.
 */
export function report(where, results) {
  const passed = results.filter((result) => result.ok === true).length;
  const width = Math.max(...Object.values(SAYS).map((said) => said.length));
  return {
    text: [
      `rigger doctor: ${passed} of ${results.length} checks passed in ${where}`,
      ...results.map((result) => `  ${SAYS[result.ok].padEnd(width)}  ${result.name}: ${result.detail}`),
    ].join('\n'),
    code: passed === results.length ? 0 : 1,
  };
}

/**
 * The checks `doctor` runs, in the order the card lists them.
 *
 * Each takes the same options and reads the ones it needs, so this list is the whole of what
 * decides which checks there are and what order they are reported in.
 */
export const CHECKS = [nodeVersion, ghAuth, agentAuth, configValidity];

/** What the command prints for a `doctor` run, and the status it exits with. */
export async function doctor({
  target = process.cwd(), packageRoot = PACKAGE, ask = asked, checks = CHECKS,
} = {}) {
  const named = repoRoot(target, ask);
  // The paths are compared whatever git said, so a tree the comparison can name is named
  // precisely even where git declines — a run from inside the installed package is the case.
  const here = named ?? real(target);
  if (sameTree(here, packageRoot)) {
    return {
      text: `rigger doctor: ${here} is the source tree this Rigger is running from, and Rigger `
        + 'never runs against that (`R-SAFE-5`). Install the package outside this tree and run it '
        + 'from there.',
      code: 1,
    };
  }
  // A tree git cannot name is refused rather than checked, because the comparison above is only
  // as good as the name it was given: asked about `<repo>/src` rather than `<repo>`, it answers
  // that an engine in `<repo>/node_modules` is a different tree, and the run goes ahead with the
  // runtime inside the directory being checked. Refusing one tree too many costs a message;
  // refusing one too few costs the runtime mid-run, which is what `R-SAFE-5` is for.
  if (named === null) {
    return {
      text: `rigger doctor: git names no repository at ${here}, so Rigger cannot tell it from the `
        + 'source tree this Rigger is running from, and it never runs against that (`R-SAFE-5`). '
        + 'Run it in a git repository, with git on the path.',
      code: 1,
    };
  }
  const results = [];
  for (const check of checks) results.push(await check({ target: named, packageRoot, ask }));
  return report(named, results);
}
