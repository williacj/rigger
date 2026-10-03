// ABOUTME: The `doctor` verb: what it asks the tool that owns each fact, what it reports one line
// at a time, and the source tree it refuses to run against.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { gitEnvironment } from '../substrate/git-environment.mjs';
import { boardOf, readSide } from '../substrate/forge/read.mjs';
import { COLUMNS, FORGE_TIMEOUT, readRunner } from '../substrate/forge/runners.mjs';
import { EVENT_REFUSED, NOT_STARTED, runCommand } from '../substrate/process.mjs';
import { ADAPTERS } from '../substrate/providers/adapters.mjs';
import { validate } from '../config/validate.mjs';
import { CONFIG } from './init.mjs';
import { recording } from './recording.mjs';

/**
 * Runs a command through L0's process adapter and hands back what it answered: its exit code as
 * `status`, its output as text, and whether the timeout ended it. This is every authority the
 * guard, `doctor` and `init` ask but the forge, which `ghAuth` asks through the forge adapter's
 * read runner. The command runs in a group of its own, ended at `timeout`, and every process it
 * leaves is killed and recorded through `emitter`. A command that never started, and a kill the sink
 * refused, reject as the adapter rejects, each failure's `code` naming which.
 *
 * The environment is the one `gitEnvironment` hands a git child. A `doctor` run from inside a git
 * hook, a `git rebase --exec` or a `git bisect run` inherits variables naming the repository that
 * started it, and git honours those over the directory this verb was pointed at. Every authority
 * here is asked about a named directory, so none may be redirected by the environment.
 */
export async function asked(command, args, { emitter, timeout }) {
  const { exit, timedOut, stdout, stderr } = await runCommand({ command, args, cwd: process.cwd(), env: gitEnvironment(), timeout, emitter });
  return { status: exit, timedOut, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
}

/**
 * How long the guard's `git`, `init`'s read of `origin`, and each agent CLI probe may run before
 * L0 kills its group. Every call that is not a dispatch passes the one L0 constant the forge
 * adapter states (the architect's ruling 2, (g), on #332), and a test passes a value of its own.
 */
export const CALL_TIMEOUT = FORGE_TIMEOUT;

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
 * card this engine is built by. Only a first step of `..` itself leaves `outer`: a child whose
 * name begins with two dots, such as `..worktrees`, is inside it.
 */
export function within(outer, inner) {
  const step = relative(outer, inner);
  return step === '' || (step !== '..' && !step.startsWith(`..${sep}`) && !isAbsolute(step));
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
 * The root of the repository a directory sits in, as git names it, as `{ root }`, or `{ root: null,
 * why }` where git names none, `why` saying in one line what git answered instead.
 *
 * Git owns what a repository is, so it is asked (`D16` rule 1). Null rather than the directory
 * handed in, because a fallback is this code answering the same question a weaker way: the whole
 * point of asking is that a run from `<repo>/src` is compared as `<repo>`, and a git that
 * declines must not narrow that back to `<repo>/src`. What to do about a tree git cannot name is
 * the caller's to decide, and `doctor` refuses rather than compares.
 *
 * Where git's answer can differ from the directory handed in, measured by asking rather than
 * reasoned about, with git 2.55.0: it walks up, so a run from `docs/` inside a checkout answers
 * the checkout; and a directory that is no repository answers 128 with nothing on stdout, which
 * is why the status is read before the output. A host with no git at all never starts it, and a
 * git its timeout ended answers nothing that can be read.
 *
 * Git is asked through L0 (`asked`), with `emitter` for L0's kills and `timeout` for the call, and
 * `ask` stands in for that in tests. A kill the sink refused rejects, as the adapter rejects.
 */
export async function repoRoot(dir, options = {}) {
  const { stdout, why } = await gitAnswer(['-C', dir, 'rev-parse', '--show-toplevel'], options);
  return why === undefined ? { root: real(stdout.trim()) } : { root: null, why };
}

/**
 * What git printed on standard output for `args`, as `{ stdout }`, where it ran and exited 0, or
 * `{ why }`, one line saying what it answered instead: that it could not be run, that its timeout
 * ended it, or the status it exited with and the first line it said.
 *
 * Git is asked through L0 (`asked`), with `emitter` for L0's kills and `timeout` for the call, and
 * `ask` stands in for that in tests. A kill the sink refused rejects, as the adapter rejects.
 */
export async function gitAnswer(args, { ask = asked, emitter, timeout = CALL_TIMEOUT } = {}) {
  const spelled = `\`${['git', ...args].join(' ')}\``;
  let said;
  try {
    said = await ask('git', args, { emitter, timeout });
  } catch (failure) {
    if (failure.code !== NOT_STARTED) throw failure;
    return { why: `${spelled} could not be run here: ${oneLine(failure.message)}` };
  }
  if (said.timedOut) return { why: `the timeout of ${timeout} ms ended ${spelled}` };
  if (said.status !== 0) return { why: `${spelled} exited ${said.status}: ${firstLine(said)}` };
  return { stdout: said.stdout };
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
 * Whether `gh` is authenticated, which is `gh auth status`'s answer and not this code's.
 *
 * `D16` rule 1: gh owns the fact. Its exit status is the whole of what is read — measured with
 * gh 2.96.0 as 0 authenticated and 1 not — and the line carries gh's own first line so a
 * consumer reads what to do about it. `--show-token` is never passed: it is the one argument
 * that would put a credential into a report (`AGENTS.md`, never log a secret), and the read
 * runner's allowlist admits the request only without it.
 *
 * It is a forge read, so it goes through the forge adapter's read runner, which names the command
 * (the architect's ruling on #214, R214-B4), with `emitter` for L0's kills. A `gh` L0 could not
 * start is reported as unasked, and every other failure of the call is the call's own to report.
 * `ask` stands in for the runner's spawn in tests.
 */
export async function ghAuth({ ask, emitter } = {}) {
  const name = 'gh authentication';
  let said;
  try {
    said = await readRunner(['auth', 'status'], { send: ask, emitter });
  } catch (failure) {
    if (failure.code !== NOT_STARTED) throw failure;
    return { name, ok: null, detail: `\`gh auth status\` could not be run here: ${oneLine(failure.message)}` };
  }
  return { name, ok: said.status === 0, detail: `\`gh auth status\` exited ${said.status}: ${firstLine(said)}` };
}

/**
 * How each provider's CLI is asked whether it is authenticated, one argv per provider, as each
 * provider's adapter names it in `auth` (ruling 1 Q1 on #467), so that every provider the
 * adapter map holds can be asked.
 */
export const AGENT_CLI = Object.fromEntries(Object.entries(ADAPTERS).map(([provider, adapter]) => [provider, adapter.auth]));

/** The verdict a set of them folds to: unknown if any is, failed if any is, passed otherwise. */
const folded = (verdicts) => {
  if (verdicts.length === 0 || verdicts.includes(null)) return null;
  return !verdicts.includes(false);
};

/**
 * The adapters whose CLIs `doctor` asks for the consumer in `target`: those of the providers the
 * roles of the config it holds name, where that config earns no refusals, and every adapter in the
 * map otherwise, as where it is handed no `target` (the architect's ruling 18 on #467). A consumer
 * that uses no Codex sees no Codex line it cannot act on (`R-OPTION-1`).
 */
async function adaptersAsked(target) {
  if (target === undefined) return ADAPTERS;
  const { config } = await consumerConfig(target);
  let refusals;
  try {
    refusals = config === undefined ? undefined : validate(config);
  } catch {
    refusals = undefined;
  }
  if (refusals === undefined || refusals.length > 0) return ADAPTERS;
  const named = new Set(Object.values(config.roles).map((role) => role.provider));
  return Object.fromEntries(Object.entries(ADAPTERS).filter(([provider]) => named.has(provider)));
}

/**
 * Whether each agent CLI is authenticated, which is that CLI's answer and not this code's.
 *
 * `D16` rule 1: each CLI owns whether it is signed in. Each adapter names the question in `auth`
 * and reads the answer with its own `signedIn`, which answers true, false, or unknown (the
 * architect's ruling 18 on #467), so this code holds no reader of any CLI's words. An answer the
 * adapter reads as neither is reported unread, never as a refusal.
 *
 * `adapters` are the adapters asked, where the caller hands them; otherwise those `adaptersAsked`
 * answers for `target`. Each CLI is asked through L0 (`asked`), with `emitter` for L0's kills and
 * `timeout` for the call. A CLI L0 could not start, or whose timeout ended it, is reported unread,
 * and a kill the sink refused rejects, as the adapter rejects. `ask` stands in for that in tests.
 */
export async function agentAuth({ ask = asked, adapters, target, emitter, timeout = CALL_TIMEOUT } = {}) {
  const name = 'agent CLI authentication';
  const verdicts = [];
  const lines = [];
  for (const adapter of Object.values(adapters ?? await adaptersAsked(target))) {
    const [command, ...args] = adapter.auth;
    const spelled = `\`${[command, ...args].join(' ')}\``;
    let said;
    try {
      said = await ask(command, args, { emitter, timeout });
    } catch (failure) {
      if (failure.code !== NOT_STARTED) throw failure;
      verdicts.push(null);
      lines.push(`${spelled} could not be run here: ${oneLine(failure.message)}`);
      continue;
    }
    const state = said.timedOut ? undefined : adapter.signedIn(said);
    if (said.timedOut) {
      verdicts.push(null);
      lines.push(`the timeout of ${timeout} ms ended ${spelled}, so nothing was read from it`);
    } else if (typeof state !== 'boolean') {
      verdicts.push(null);
      lines.push(`${spelled} exited ${said.status} and said nothing its adapter reads as signed in or out, so nothing was read from it`);
    } else {
      verdicts.push(state);
      lines.push(`${spelled} says it is signed ${state ? 'in' : 'out'}`);
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
 * The config is a module the consumer wrote, so importing and validating it can run their code
 * and throw. What the report carries is the first line of what went wrong, never the error: a
 * stack of Node's own frames tells a consumer nothing about the file they have to fix, and the
 * card asks for a line per check without one.
 */
export async function configValidity({ target = process.cwd() } = {}) {
  const name = 'config validity';
  const { config, problem } = await consumerConfig(target);
  if (problem) return { name, ok: false, detail: problem };
  let refusals;
  try {
    refusals = validate(config);
  } catch (threw) {
    return { name, ok: false, detail: `\`${CONFIG}\` could not be validated: ${wentWrong(threw)}` };
  }
  return {
    name,
    ok: refusals.length === 0,
    detail: refusals.length === 0
      ? `\`${CONFIG}\` earns no refusals`
      : `\`${CONFIG}\`: ${refusals.map(oneLine).join('; ')}`,
  };
}

/**
 * The config the consumer holds in `target`, as `{ config }`, or `{ problem }` saying in one line
 * why there is none to read: the file is not there, or importing it threw. Every verb that reads
 * the config reads it here, so the one dynamic import of the consumer's code is this one.
 */
export async function consumerConfig(target) {
  const path = join(target, CONFIG);
  if (!existsSync(path)) return { problem: `\`${CONFIG}\` is not in ${target}, and \`rigger init\` is what writes it` };
  try {
    return { config: (await import(pathToFileURL(path))).default };
  } catch (threw) {
    return { problem: `\`${CONFIG}\` could not be read: ${wentWrong(threw)}` };
  }
}

/**
 * The failed line for the check `name`, whose forge read threw `threw`, carrying the adapter's
 * message. A kill the sink refused is no failed read, and is thrown on, told apart by its kind:
 * it stops `doctor` before its next call (the architect's ruling 3, §4, on #332).
 */
function failedRead(name, threw) {
  if (threw?.code === EVENT_REFUSED) throw threw;
  return { name, ok: false, detail: wentWrong(threw) };
}

/**
 * What the forge adapter's report of other repositories says of the board numbered `project`, or
 * null where the board holds nothing from outside the repository. It names the other repositories
 * and the count of items that cannot be read, and never the repository itself. `setup-board`
 * refuses in the same words.
 */
export function sharedWith(project, { repositories, unreadable }) {
  const said = [];
  if (repositories.length > 0) {
    said.push(`board ${project} holds issues or pull requests of ${repositories.length === 1 ? 'another repository' : 'other repositories'}: ${repositories.join(', ')}`);
  }
  if (unreadable > 0) said.push(`board ${project} holds ${unreadable} ${unreadable === 1 ? 'item it cannot read' : 'items it cannot read'}`);
  return said.length > 0 ? said.join('; ') : null;
}

/**
 * The forge adapter's reads on the board `config` names, or on `board` where it is given, which
 * is that board narrowed to fewer columns, each sent as `via` says: `send`, which stands in for the
 * read runner's spawn in tests, and `emitter`, the `L0` emitter for L0's kills.
 */
const readsOf = (config, via, board = config.board) => readSide({ repo: config.repo, ...board }, via);

/**
 * Whether the board the config names holds anything from outside the repository `repo` names,
 * which is the forge adapter's report and not this code's. An issue or pull request of another
 * repository means two engines share the board, and an item the engine's `gh` cannot read is not
 * the repository's (the architect's ruling on #285, comment 5835129833). A read that fails fails
 * the line, carrying the adapter's message.
 *
 * A config Rigger refuses, cannot read, or throws during validation names no board worth
 * reading, so the check answers null, sends nothing, and `doctor` prints no line for it. `ask`
 * stands in for the read runner's spawn in tests.
 */
export async function boardSharing({ target = process.cwd(), ask, emitter } = {}) {
  const name = 'board sharing';
  const { config, problem } = await consumerConfig(target);
  if (problem) return null;
  try {
    if (validate(config).length > 0) return null;
  } catch {
    return null;
  }
  let held;
  try {
    held = await readsOf(config, { send: ask, emitter }).readOtherRepositories();
  } catch (threw) {
    return failedRead(name, threw);
  }
  const shared = sharedWith(config.board.project, held);
  return { name, ok: shared === null, detail: shared ?? `board ${config.board.project} holds nothing from outside ${config.repo}` };
}

/**
 * Whether the board the config names can be read, which is the forge adapter's read side's
 * answer: it finds the board by its owner and number, and a read it cannot make fails the line,
 * carrying the adapter's message, which names the board and the owner the request addressed.
 */
async function reachability(config, via) {
  const name = 'board reachability';
  try {
    await readsOf(config, via).readFieldTypes();
  } catch (threw) {
    return failedRead(name, threw);
  }
  return { name, ok: true, detail: `board ${config.board.project} can be read` };
}

/**
 * A line per column the config declares, each saying whether its display name is an option of
 * the board's field holding the columns. Each is the forge adapter's column read of that one
 * column, so a line that fails carries the adapter's message, which names the column by key and
 * display name.
 */
async function columns(config, via) {
  const lines = [];
  for (const [key, display] of Object.entries(config.board.columns)) {
    const name = `board column ${key}`;
    try {
      await readsOf(config, via, { ...config.board, columns: { [key]: display } }).readColumns();
      lines.push({ name, ok: true, detail: `${display} is an option of board ${config.board.project}'s columns` });
    } catch (threw) {
      lines.push(failedRead(name, threw));
    }
  }
  return lines;
}

/** The type GitHub names a single-select field by, as the read side's field types carry it. */
const SINGLE_SELECT = 'SINGLE_SELECT';

/**
 * Whether the board holds the priority field the config declares: a single-select field of that
 * name, the field holding the columns among them, whose option names are exactly the declared
 * ones. Order is not compared, because the config's order is the ranking of whatever options the
 * board holds, and the board's own order ranks nothing. A config declaring no priority passes,
 * since no field is asked for.
 *
 * Only fields are read, never cards, so a card the read side refuses cannot decide this line.
 * Every field's name and type comes from the read side's typed field listing. A single-select
 * field's options come from its single-select field read, which leaves out the field holding the
 * columns; that field's options come from the board read `setup-board` takes them from.
 */
async function priority(config, via) {
  const name = 'board priority';
  const declared = config.board.priority;
  if (!declared) return { name, ok: true, detail: 'no priority field is declared, so every card ranks alike' };
  const field = `board ${config.board.project}'s field ${declared.field}`;
  const reads = readsOf(config, via);
  let held;
  try {
    const typed = (await reads.readFieldTypes()).find((each) => each.name === declared.field);
    if (!typed) return { name, ok: false, detail: `board ${config.board.project} has no field named ${declared.field}` };
    if (typed.type !== SINGLE_SELECT) {
      return { name, ok: false, detail: `${field} is a ${typed.type} field, not a single-select field` };
    }
    held = declared.field === COLUMNS
      ? (await boardOf('doctor', { repo: config.repo, ...config.board }, via)).columns.options.map((option) => option.name)
      : (await reads.readFields()).find((select) => select.name === declared.field).options;
  } catch (threw) {
    return failedRead(name, threw);
  }
  const unasked = held.filter((option) => !declared.options.includes(option));
  const missing = declared.options.filter((option) => !held.includes(option));
  const said = [];
  if (unasked.length > 0) said.push(`on the board and not in the config: ${unasked.join(', ')}`);
  if (missing.length > 0) said.push(`in the config and not on the board: ${missing.join(', ')}`);
  if (said.length > 0) return { name, ok: false, detail: `${field} holds options ${said.join('; ')}` };
  return { name, ok: true, detail: `${field} holds exactly the declared options` };
}

/**
 * The lines about the board the config names: whether it can be read, whether it holds each
 * declared column, and whether it holds the declared priority field. A config Rigger refuses,
 * cannot read, or throws during validation names no board worth reading, so it earns one line
 * saying the board was not checked, and nothing is sent.
 */
export async function boardChecks({ target = process.cwd(), ask, emitter } = {}) {
  const { config, problem } = await consumerConfig(target);
  let why = problem ? 'the config could not be read' : null;
  if (!why) {
    try {
      if (validate(config).length > 0) why = 'the config was refused';
    } catch {
      why = 'the config could not be validated';
    }
  }
  if (why) return { name: 'board checks', ok: null, detail: `the board was not checked, because ${why}` };
  const via = { send: ask, emitter };
  return [await reachability(config, via), ...await columns(config, via), await priority(config, via)];
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
 * The checks `doctor` runs: the four its card lists, in that order, then the board checks, and
 * then the board-sharing check. Both of the last read the board the config names only once the
 * config earns no refusals.
 *
 * Each takes the same options and reads the ones it needs, so this list is the whole of what
 * decides which checks there are and what order they are reported in. A check answers one line,
 * a list of lines, or null, which has nothing to report and prints no line.
 */
export const CHECKS = [nodeVersion, ghAuth, agentAuth, configValidity, boardChecks, boardSharing];

/**
 * What a verb named `verb` prints and exits with where `here` and the source tree this Rigger is
 * running from are one tree, as `sameTree` answers it (`R-SAFE-5`).
 */
export const sourceTreeRefusal = (verb, here) => ({
  text: `rigger ${verb}: ${here} is the source tree this Rigger is running from, and Rigger `
    + 'never runs against that (`R-SAFE-5`). Install the package outside this tree and run it '
    + 'from there.',
  code: 1,
});

/**
 * The repository a verb named `verb` was pointed at, as `{ named }`, or `{ refusal }`, what the
 * verb prints and exits with where that is the source tree this Rigger is running from, or a tree
 * git cannot name (`R-SAFE-5`). Nothing but git is asked before this answers, through L0 with
 * `emitter` and `timeout` (`repoRoot`), and a kill the sink refused rejects.
 */
export async function sourceTreeGuard(verb, { target = process.cwd(), packageRoot = PACKAGE, ask, emitter, timeout } = {}) {
  const { root: named, why } = await repoRoot(target, { ask, emitter, timeout });
  // The paths are compared whatever git said, so a tree the comparison can name is named
  // precisely even where git declines — a run from inside the installed package is the case.
  const here = named ?? real(target);
  if (sameTree(here, packageRoot)) return { refusal: sourceTreeRefusal(verb, here) };
  // A tree git cannot name is refused rather than checked, because the comparison above is only
  // as good as the name it was given: asked about `<repo>/src` rather than `<repo>`, it answers
  // that an engine in `<repo>/node_modules` is a different tree, and the run goes ahead with the
  // runtime inside the directory being checked. Refusing one tree too many costs a message;
  // refusing one too few costs the runtime mid-run, which is what `R-SAFE-5` is for.
  if (named === null) {
    return {
      refusal: {
        text: `rigger ${verb}: git names no repository at ${here} (${why}), so Rigger cannot tell it from the `
          + 'source tree this Rigger is running from, and it never runs against that (`R-SAFE-5`). '
          + 'Run it in a git repository, with git on the path.',
        code: 1,
      },
    };
  }
  return { named };
}

/**
 * The repository a verb named `verb` serves, settled for the sink `recording` opened: the guard
 * asks git with an `L0` emitter on `sink`, and where it accepts the target, `name` names the state
 * directory there, which writes every event the sink held. As `{ named }`, or `{ refusal }`, what
 * the verb prints and exits with where the guard refused, or where the state directory refused
 * what the sink held, which names each event that went unrecorded (`R-RECORD-9`).
 */
export async function settled(verb, { sink, name }, options = {}) {
  const guarded = await sourceTreeGuard(verb, { ...options, emitter: sink.emitter({ layer: 'L0' }) });
  if (guarded.refusal) return guarded;
  try {
    name(guarded.named);
  } catch (refused) {
    return { refusal: { text: `rigger ${verb}: ${refused.message}`, code: 1 } };
  }
  return guarded;
}

/**
 * What the command prints for a `doctor` run, and the status it exits with. Each check is handed
 * an `L0` emitter on the sink `recording` opens, for L0's kills in the forge calls it makes.
 */
export const doctor = (options) => recording((opened) => checking(opened, options));

/** `doctor`'s work, recording through the sink `opened` holds once `settled` has named its state directory. */
async function checking(opened, {
  target = process.cwd(), packageRoot = PACKAGE, ask, checks = CHECKS,
} = {}) {
  const { named, refusal } = await settled('doctor', opened, { target, packageRoot, ask });
  if (refusal) return refusal;
  const emitter = opened.sink.emitter({ layer: 'L0' });
  const results = [];
  for (const check of checks) {
    try {
      results.push(await check({ target: named, packageRoot, ask, emitter }));
    } catch (failure) {
      // A kill the sink refused stops the verb before its next call, and is never a failed check
      // (the architect's ruling 3, §4, on #332): the failure's kind says so, not its message.
      if (failure.code !== EVENT_REFUSED) throw failure;
      return { text: `rigger doctor: ${failure.message}`, code: 1 };
    }
  }
  return report(named, results.flat().filter((result) => result !== null));
}
