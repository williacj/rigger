// ABOUTME: Tests `rigger once` and `rigger run` making and provisioning each claimed card's
// workspace through L3's single pull, over a fixture repository with a local `origin` and a fake
// board, and stopping short of a maker, which no verb runs before M4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { once } from '../src/cli/once.mjs';
import { run } from '../src/cli/run.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { fixture, GIT, scratch, withFirstOnPath } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The verbs under test, run in this process. */
const VERBS = { once, run };

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/**
 * How long a verb may run before the test kills it and fails, so that a verb which never settles,
 * as one that fired a pull again on each freed slot over a card that keeps failing would not,
 * fails its test rather than holding the suite. A judgment, whose premise is a measurement: the
 * slowest test in this file took 1.9 s with Node 26.5.0 on macOS 27.0 on 2026-09-30, under a
 * one-minute load near 20 on 12 CPUs.
 */
const { 60_000: { timeout: SETTLES_WITHIN } } = BOUNDS;

/** A body whose acceptance the form check admits: one item that is not the title. */
const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** A card the `change` kind selects, in the template's column displayed as `column`, carrying `labels` besides. */
const card = (number, { column = template.board.columns.ready, labels = [] } = {}) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: ADMITTED, labels: ['type:change', ...labels], column,
});

/** One step whose `run` is `true`, which the `change` kind lists and every other kind does not. */
const ONE_STEP = { steps: { ready: { run: 'true', required: true } }, listed: ['ready'] };

/**
 * A consumer's world for the test `t`, in a scratch directory its teardown sweeps: `target`, a
 * repository with a local bare `origin` beside it, holding the template's config for the board,
 * under N `concurrency`, whose `change` kind lists `listed` of the provisioning `steps` and whose
 * other kinds list none, with `worktrees` in place of the template's where it is given; and a fake
 * `gh` holding `items`. The scratch directory is `directory` where the caller made it. `verb(name, cwd)` runs the real bin's verb from `cwd`, the target unless
 * given, with the fake `gh` first on PATH.
 */
function world(t, { items, concurrency = 3, steps = ONE_STEP.steps, listed = ONE_STEP.listed, worktrees = template.worktrees }, directory = scratch(t)) {
  const kinds = Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: name === 'change' ? listed : [] }]));
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency, worktrees, kinds, provisioning: steps };
  const target = withOrigin(repositoryAt(join(directory, 'target'), { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` }), join(directory, 'origin.git'));
  mkdirSync(join(directory, 'fake'));
  const fake = installFakeGh(join(directory, 'fake'), {
    repo: REPO, project: PROJECT, board: { columns: Object.values(template.board.columns), fields: [{ name: template.board.priority.field, options: template.board.priority.options }], items },
  });
  const env = { ...process.env, PATH: [join(directory, 'fake'), process.env.PATH].join(delimiter) };
  const verb = (name, cwd = target) => {
    const ran = spawnSync(process.execPath, [bin, name], { cwd, encoding: 'utf8', env, timeout: SETTLES_WITHIN, killSignal: 'SIGKILL' });
    assert.equal(ran.error, undefined);
    return { out: ran.stdout, err: ran.stderr, code: ran.status, said: `exited ${ran.status}: ${ran.stdout}${ran.stderr}` };
  };
  const events = () => readEvents(join(target, '.rigger'));
  return { directory, target, fake, verb, events, worktrees: join(directory, 'widgets-worktrees') };
}

/** The directories under `path`, sorted, or none where nothing is there. */
const under = (path) => (existsSync(path) ? readdirSync(path).sort() : []);

/** Three pullable cards of kind `change`, oldest first #10, #20, #30. */
const THREE = [card(30), card(10), card(20)];

test('given three pullable cards and a change kind listing one step whose run is true, rigger once claims exactly one card and leaves exactly one workspace', async (t) => {
  const here = world(t, { items: THREE });

  const ran = here.verb('once');

  const columns = Object.fromEntries((await (await here.fake.model()).operations.readItems()).map((item) => [item.number, item.column]));
  assert.deepEqual(Object.values(columns).filter((column) => column === 'Coding').length, 1, ran.said);
  assert.deepEqual(under(here.worktrees).length, 1, ran.said);
});

/** Each card on the fake board by number, with the display name of the column it is in now. */
const columnsOf = async (here) => Object.fromEntries((await (await here.fake.model()).operations.readItems()).map((item) => [item.number, item.column]));

/** The workspace the default root and topic derive for card `number` in `here`: `<top level>/../widgets-worktrees/rigger-<number>`. */
const derived = (here, number) => join(dirname(realpathSync(here.target)), 'widgets-worktrees', `rigger-${number}`);

test('given that world, the workspace lies at the path the configured topic derives for the card rigger once claimed', (t) => {
  const here = world(t, { items: THREE });

  const ran = here.verb('once');

  assert.match(ran.err, /claimed #10\b/, ran.said);
  assert.deepEqual(under(here.worktrees), ['rigger-10'], ran.said);
  assert.equal(realpathSync(join(here.worktrees, 'rigger-10')), derived(here, 10));
});

test('given that world, the event stream shows the step dispatched, exiting 0, with its dispatch.start naming that workspace', (t) => {
  const here = world(t, { items: THREE });

  const ran = here.verb('once');

  const events = here.events();
  const dispatched = events.filter((event) => event.layer === 'L3' && event.event === 'dispatch');
  assert.deepEqual(dispatched.map(({ card: number, step }) => ({ card: number, step })), [{ card: 10, step: 'ready' }], ran.said);
  const [{ dispatch: id }] = dispatched;
  const start = events.find((event) => event.event === 'dispatch.start' && event.dispatch === id);
  const end = events.find((event) => event.event === 'dispatch.end' && event.dispatch === id);
  assert.equal(start?.workspace, derived(here, 10), JSON.stringify(start));
  assert.equal(end?.exit, 0, JSON.stringify(end));
});

test('given that world, rigger once prints a line naming the card, its workspace\'s path, and that no maker runs before M4', (t) => {
  const here = world(t, { items: THREE });

  const ran = here.verb('once');

  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.said);
  assert.ok(line.includes(derived(here, 10)), line);
  assert.match(line, /no maker runs before M4/, line);
});

test('given that world, rigger once exits non-zero', (t) => {
  const ran = world(t, { items: THREE }).verb('once');

  assert.notEqual(ran.code, 0, ran.said);
});

test('given that world, the line rigger once prints for its card begins rigger once: claimed #<n> from board <p>', (t) => {
  const ran = world(t, { items: THREE }).verb('once');

  assert.match(ran.err, /^rigger once: claimed #10 from board 3\b/m, ran.said);
});

test('given that world, the card rigger once claimed is in the coding column afterwards', async (t) => {
  const here = world(t, { items: THREE });

  const ran = here.verb('once');

  assert.deepEqual(await columnsOf(here), { 10: 'Coding', 20: 'Ready', 30: 'Ready' }, ran.said);
});

/** A required step that exits 3, which the `change` kind lists after `ready`, selected only for a card carrying `area:fails`. */
const FAILING = {
  steps: { ...ONE_STEP.steps, fails: { run: 'exit 3', required: true, select: { labels: ['area:fails'] } } },
  listed: ['ready', 'fails'],
};

test('given a required step that exits non-zero on both attempts, rigger once prints both attempts\' failures, each naming the step and its exit code, and exits non-zero', (t) => {
  const here = world(t, { items: [card(10, { labels: ['area:fails'] })], ...FAILING });

  const ran = here.verb('once');

  assert.notEqual(ran.code, 0, ran.said);
  for (const attempt of [1, 2]) {
    const line = ran.err.split('\n').find((held) => held.startsWith(`attempt ${attempt}: `));
    assert.ok(line, ran.said);
    assert.match(line, /"step":"fails"/, line);
    assert.match(line, /"exit":3\b/, line);
  }
});

/** Makes a plain directory at the workspace path card `number` derives in `here`, which L1 refuses to replace. */
function blocked(here, number) {
  mkdirSync(derived(here, number), { recursive: true });
  return derived(here, number);
}

test('given a workspace that cannot be made on either attempt, rigger once prints both attempts\' failures, each naming the workspace path, and exits non-zero', (t) => {
  const here = world(t, { items: [card(10)] });
  const path = blocked(here, 10);

  const ran = here.verb('once');

  assert.notEqual(ran.code, 0, ran.said);
  for (const attempt of [1, 2]) {
    const line = ran.err.split('\n').find((held) => held.startsWith(`attempt ${attempt}: `));
    assert.ok(line, ran.said);
    assert.ok(line.includes(`"workspace":${JSON.stringify(path)}`), line);
  }
});

/**
 * A world whose `change` kind lists an optional step, `breaks`, then a required one, `after`.
 * `breaks` moves the event stream aside into `saved/` and puts a directory in its place, so the
 * sink refuses L1's `dispatch.end` of that step and every append after it, and the stream as it
 * stood until then is kept. `after` would leave a file, `after-ran`, in the scratch directory.
 */
function refusingEnd(t) {
  const directory = scratch(t);
  const stream = join(directory, 'target', '.rigger', 'events.jsonl');
  mkdirSync(join(directory, 'saved'));
  const marker = join(directory, 'after-ran');
  const steps = {
    breaks: { run: `mv '${stream}' '${join(directory, 'saved', 'events.jsonl')}' && mkdir '${stream}'` },
    after: { run: `touch '${marker}'`, required: true },
  };
  const here = world(t, { items: [card(10)], steps, listed: ['breaks', 'after'] }, directory);
  return { ...here, marker, saved: () => readEvents(join(directory, 'saved')) };
}

// proves R-RECORD-9
test('given an optional step whose L1 dispatch.end the sink refuses, rigger once exits non-zero naming the unrecorded event', (t) => {
  const here = refusingEnd(t);

  const ran = here.verb('once');

  assert.notEqual(ran.code, 0, ran.said);
  assert.match(ran.err, /went unrecorded:\ndispatch\.end of dispatch d-\S+, card #10\b/, ran.said);
});

// proves R-RECORD-9
test('given an optional step followed by a second selected step, where the sink refuses the optional step\'s L1 dispatch.end, rigger once starts neither the second step nor a second attempt, and reaches no maker, as the event stream shows', (t) => {
  const here = refusingEnd(t);

  const ran = here.verb('once');

  const events = here.saved();
  const starts = events.filter((event) => event.layer === 'L3' && event.event === 'dispatch');
  assert.deepEqual(starts.map(({ step, attempt }) => ({ step, attempt })), [{ step: 'breaks', attempt: 1 }], ran.said);
  assert.equal(events.filter((event) => event.event === 'workspace.made').length, 1, ran.said);
  assert.equal(events.at(-1).event, 'dispatch.start', `the stream went on past the step that broke it: ${JSON.stringify(events.at(-1))}`);
  assert.equal(existsSync(here.marker), false, 'the second step ran');
  assert.doesNotMatch(ran.err, /no maker runs before M4/, ran.said);
  assert.doesNotMatch(ran.err, /`after`/, ran.said);
});

test('given a card in the coding column with no pull request, as a redo, rigger once gives it a fresh workspace, which holds no file an earlier attempt left there', async (t) => {
  const here = world(t, { items: [card(10)] });
  const first = here.verb('once');
  assert.deepEqual(await columnsOf(here), { 10: 'Coding' }, first.said);
  writeFileSync(join(derived(here, 10), 'left-behind.txt'), 'an earlier attempt\'s file\n');

  const ran = here.verb('once');

  assert.match(ran.err, /^rigger once: claimed #10 from board 3\b/m, ran.said);
  assert.equal(existsSync(join(derived(here, 10), 'rigger.config.mjs')), true, ran.said);
  assert.equal(existsSync(join(derived(here, 10), 'left-behind.txt')), false, ran.said);
});

/** The topics whose name for card 1 git refuses as a branch name. */
const REFUSED_TOPICS = ['rigger-{number}.lock', 'rigger..{number}'];

/**
 * Runs `verb` over each topic in `REFUSED_TOPICS`, in a world of its own, and asserts it exits
 * non-zero naming the topic, and sends the board stand-in nothing, so it neither read nor moved.
 */
function refusesTopic(t, verb) {
  for (const topic of REFUSED_TOPICS) {
    const here = world(t, { items: [card(10)], worktrees: { topic } });

    const ran = here.verb(verb);

    assert.notEqual(ran.code, 0, ran.said);
    assert.ok(ran.err.includes(`\`${topic}\``), ran.said);
    assert.deepEqual(here.fake.sent(), [], ran.said);
  }
}

test('given a topic whose name for card 1 git refuses as a branch name, rigger once exits non-zero naming the topic, and the board stand-in records no read and no move', (t) => refusesTopic(t, 'once'));

test('given a topic whose name for card 1 git refuses as a branch name, rigger run exits non-zero naming the topic, and the board stand-in records no read and no move', (t) => refusesTopic(t, 'run'));

test('given a config declaring no worktree root, the root rigger once hands L1 is <top level>/../<name>-worktrees, <name> being repo after the slash, resolved to an absolute path', (t) => {
  const here = world(t, { items: [card(10)], worktrees: { topic: 'rigger-{number}' } });

  const ran = here.verb('once');

  // The workspace lies directly under the root L1 was handed, named by the topic.
  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.said);
  assert.ok(line.endsWith(`, ${join(dirname(realpathSync(here.target)), 'widgets-worktrees', 'rigger-10')}`), line);
});

test('given a relative worktrees.root, it resolves against the repository\'s top level, whatever directory rigger once is run from', (t) => {
  const here = world(t, { items: [card(10)], worktrees: { root: '../elsewhere', topic: 'rigger-{number}' } });
  const below = join(here.target, 'deep', 'below');
  mkdirSync(below, { recursive: true });

  const ran = here.verb('once', below);

  const expected = join(dirname(realpathSync(here.target)), 'elsewhere', 'rigger-10');
  assert.ok(ran.err.split('\n').some((held) => held.endsWith(`, ${expected}`)), ran.said);
  assert.equal(existsSync(join(expected, 'rigger.config.mjs')), true, ran.said);
});

test('given rigger once run from a subdirectory of the target, the repository L1 is handed is the target\'s top level, not the directory it was run from', (t) => {
  const here = world(t, { items: [card(10)] });
  const below = join(here.target, 'deep', 'below');
  mkdirSync(below, { recursive: true });
  // A `git` first on PATH that records the directory each call runs in, then runs the real git.
  // L0's workspace adapter runs every call in the repository it was handed.
  mkdirSync(join(here.directory, 'recording'));
  fixture(join(here.directory, 'recording'), 'git', ['printf \'%s | %s\\n\' "$(pwd -P)" "$*" >> "$here/git-calls"', `exec '${GIT}' "$@"`].join('\n'));
  const path = [join(here.directory, 'recording'), join(here.directory, 'fake'), process.env.PATH].join(delimiter);

  const ran = spawnSync(process.execPath, [bin, 'once'], { cwd: below, encoding: 'utf8', env: { ...process.env, PATH: path }, timeout: SETTLES_WITHIN, killSignal: 'SIGKILL' });

  const said = `exited ${ran.status}: ${ran.stdout}${ran.stderr}`;
  const calls = readFileSync(join(here.directory, 'recording', 'git-calls'), 'utf8').split('\n').filter(Boolean);
  const adds = calls.filter((call) => call.includes(' | worktree add '));
  assert.equal(adds.length, 1, `${said}\n${calls.join('\n')}`);
  assert.ok(adds[0].startsWith(`${realpathSync(here.target)} | `), adds[0]);
  assert.match(ran.stderr, /^rigger once: claimed #10 from board 3\b/m, said);
});

/**
 * `verb` run in this process over a world whose config declares a worktree root inside `package`,
 * a directory standing as the source tree this Rigger is running from. The fake `gh`, holding a
 * card the verb would claim, is first on this process's PATH for the call, so a verb that went on
 * would read the board, claim the card and make its workspace under the package. Asserts it exits
 * non-zero naming `R-SAFE-5` before it claims any card: the fake `gh` receives no call.
 */
async function refusesRootInSourceTree(t, verb) {
  const directory = scratch(t);
  const packageRoot = join(directory, 'package');
  mkdirSync(join(packageRoot, 'src'), { recursive: true });
  const here = world(t, { items: [card(10)], worktrees: { root: join(packageRoot, 'src', 'worktrees'), topic: 'rigger-{number}' } }, directory);
  const before = readdirSync(packageRoot, { recursive: true }).sort();

  const ran = await withFirstOnPath(join(directory, 'fake'), () => VERBS[verb]({ target: here.target, packageRoot }));

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /R-SAFE-5/, ran.text);
  assert.deepEqual(here.fake.sent(), [], ran.text);
  return { ran, packageRoot, before };
}

// proves R-SAFE-5
test('given a worktree root inside the running package\'s source tree, rigger once exits non-zero naming R-SAFE-5 before it claims any card', (t) => refusesRootInSourceTree(t, 'once'));

// proves R-SAFE-5
test('given a worktree root inside the running package\'s source tree, rigger once creates nothing under the running package\'s source tree', async (t) => {
  const { ran, packageRoot, before } = await refusesRootInSourceTree(t, 'once');

  assert.deepEqual(readdirSync(packageRoot, { recursive: true }).sort(), before, ran.text);
});

// proves R-SAFE-5
test('given a worktree root inside the running package\'s source tree, rigger run exits non-zero naming R-SAFE-5 before it claims any card', (t) => refusesRootInSourceTree(t, 'run'));

// proves R-SAFE-5
test('given a worktree root inside the running package\'s source tree, rigger run creates nothing under the running package\'s source tree', async (t) => {
  const { ran, packageRoot, before } = await refusesRootInSourceTree(t, 'run');

  assert.deepEqual(readdirSync(packageRoot, { recursive: true }).sort(), before, ran.text);
});

/** Four pullable cards of kind `change`, oldest first #10, #20, #30, #40. */
const FOUR = [card(30), card(10), card(40), card(20)];

test('given four pullable cards, N 3, and a change kind listing one step whose run is true, rigger run leaves three workspaces at three different real paths, and claims no fourth card', async (t) => {
  const here = world(t, { items: FOUR });

  const ran = here.verb('run');

  const made = under(here.worktrees).map((name) => realpathSync(join(here.worktrees, name)));
  assert.equal(new Set(made).size, 3, `${ran.said}\n${made.join('\n')}`);
  assert.deepEqual(await columnsOf(here), { 10: 'Coding', 20: 'Coding', 30: 'Coding', 40: 'Ready' }, ran.said);
});

test('given that world, the event stream shows the step dispatched for each card rigger run claimed, exiting 0, with its dispatch.start naming that card\'s own workspace', (t) => {
  const here = world(t, { items: FOUR });

  const ran = here.verb('run');

  const events = here.events();
  for (const number of [10, 20, 30]) {
    const dispatched = events.filter((event) => event.layer === 'L3' && event.event === 'dispatch' && event.card === number);
    assert.deepEqual(dispatched.map(({ step }) => step), ['ready'], ran.said);
    const [{ dispatch: id }] = dispatched;
    const start = events.find((event) => event.event === 'dispatch.start' && event.dispatch === id);
    const end = events.find((event) => event.event === 'dispatch.end' && event.dispatch === id);
    assert.equal(start?.workspace, derived(here, number), JSON.stringify(start));
    assert.equal(end?.exit, 0, JSON.stringify(end));
  }
});

test('given that world, rigger run prints a line for each claimed card naming the card, its workspace\'s path, and that no maker runs before M4', (t) => {
  const here = world(t, { items: FOUR });

  const ran = here.verb('run');

  for (const number of [10, 20, 30]) {
    const line = ran.err.split('\n').find((held) => new RegExp(`^rigger run: claimed #${number} from board 3\\b`).test(held));
    assert.ok(line, ran.said);
    assert.ok(line.includes(derived(here, number)), line);
    assert.match(line, /no maker runs before M4/, line);
  }
});

test('given that world, rigger run exits non-zero', (t) => {
  const ran = world(t, { items: FOUR }).verb('run');

  assert.notEqual(ran.code, 0, ran.said);
});

/** The number of times the event stream `events` records the pull trigger firing. */
const pulls = (events) => events.filter((event) => event.layer === 'L3' && event.event === 'trigger' && event.trigger === 'pull').length;

test('given four pullable cards and N 3, where one claimed card\'s required step exits non-zero on both attempts, rigger run prints both attempts\' failures for that card, each naming the step and its exit code', (t) => {
  const here = world(t, { items: [card(30), card(10, { labels: ['area:fails'] }), card(40), card(20)], ...FAILING });

  const ran = here.verb('run');

  const stopped = ran.err.indexOf('rigger run: card #10 was stopped after 2 attempts');
  assert.ok(stopped >= 0, ran.said);
  for (const attempt of [1, 2]) {
    const line = ran.err.slice(stopped).split('\n').find((held) => held.startsWith(`attempt ${attempt}: `));
    assert.ok(line, ran.said);
    assert.match(line, /"step":"fails"/, line);
    assert.match(line, /"exit":3\b/, line);
  }
});

test('in that case, rigger run fires no second pull after that card\'s slot is released, as the event stream\'s pull trigger events show', (t) => {
  const here = world(t, { items: [card(30), card(10, { labels: ['area:fails'] }), card(40), card(20)], ...FAILING });

  const ran = here.verb('run');

  const events = here.events();
  assert.ok(events.some((event) => event.event === 'slot.release' && event.card === 10), ran.said);
  assert.equal(pulls(events), 1, ran.said);
});

test('given a workspace that cannot be made on either attempt of a card rigger run claimed, rigger run prints both failures for that card and fires no second pull after its slot is released', async (t) => {
  const here = world(t, { items: FOUR });
  const path = blocked(here, 10);

  const ran = here.verb('run');

  const stopped = ran.err.indexOf('rigger run: card #10 was stopped after 2 attempts');
  assert.ok(stopped >= 0, ran.said);
  for (const attempt of [1, 2]) {
    const line = ran.err.slice(stopped).split('\n').find((held) => held.startsWith(`attempt ${attempt}: `));
    assert.ok(line?.includes(`"workspace":${JSON.stringify(path)}`), ran.said);
  }
  const events = here.events();
  assert.ok(events.some((event) => event.event === 'slot.release' && event.card === 10), ran.said);
  assert.equal(pulls(events), 1, ran.said);
  assert.equal((await columnsOf(here))[40], 'Ready', ran.said);
});

/** #10, #20 and #30, oldest first, where #20 alone carries `area:fails`, so under `FAILING` its required step exits non-zero on both attempts. */
const ONE_FAILING = [card(30), card(10), card(20, { labels: ['area:fails'] })];

/** The line `text` holds beginning `rigger run: claimed #<number> from board 3`, which must be there. */
function claimedLine(text, number, said) {
  const line = text.split('\n').find((held) => new RegExp(`^rigger run: claimed #${number} from board 3\\b`).test(held));
  assert.ok(line, said);
  return line;
}

test('given a pull claiming #10, #20 and #30, where #20\'s required step exits non-zero on both attempts, rigger run prints a line for #10 naming its workspace\'s path and that no maker runs before M4', (t) => {
  const here = world(t, { items: ONE_FAILING, ...FAILING });

  const ran = here.verb('run');

  const line = claimedLine(ran.err, 10, ran.said);
  assert.ok(line.includes(derived(here, 10)), line);
  assert.match(line, /no maker runs before M4/, line);
});

test('given that world, rigger run prints a line for #30 naming its workspace\'s path and that no maker runs before M4', (t) => {
  const here = world(t, { items: ONE_FAILING, ...FAILING });

  const ran = here.verb('run');

  const line = claimedLine(ran.err, 30, ran.said);
  assert.ok(line.includes(derived(here, 30)), line);
  assert.match(line, /no maker runs before M4/, line);
});

test('given that world, rigger run prints #20\'s two attempts\' failures, each naming the step and its exit code', (t) => {
  const ran = world(t, { items: ONE_FAILING, ...FAILING }).verb('run');

  const stopped = ran.err.indexOf('rigger run: card #20 was stopped after 2 attempts');
  assert.ok(stopped >= 0, ran.said);
  for (const attempt of [1, 2]) {
    const line = ran.err.slice(stopped).split('\n').find((held) => held.startsWith(`attempt ${attempt}: `));
    assert.ok(line, ran.said);
    assert.match(line, /"step":"fails"/, line);
    assert.match(line, /"exit":3\b/, line);
  }
});

test('given that world, rigger run prints each claimed card\'s line, or its failures, once and only once', (t) => {
  const ran = world(t, { items: ONE_FAILING, ...FAILING }).verb('run');

  const lines = ran.err.split('\n');
  for (const number of [10, 30]) {
    assert.equal(lines.filter((held) => held.startsWith(`rigger run: claimed #${number} `)).length, 1, ran.said);
    assert.equal(lines.filter((held) => new RegExp(`#${number}\\b`).test(held)).length, 1, ran.said);
  }
  assert.equal(lines.filter((held) => held.startsWith('rigger run: card #20 was stopped')).length, 1, ran.said);
  assert.equal(lines.filter((held) => /#20\b/.test(held)).length, 1, ran.said);
  for (const attempt of [1, 2]) assert.equal(lines.filter((held) => held.startsWith(`attempt ${attempt}: `)).length, 1, ran.said);
});

test('given that world, where #20 failed while #10 and #30 reached their workspaces, rigger run exits non-zero', (t) => {
  const ran = world(t, { items: ONE_FAILING, ...FAILING }).verb('run');

  assert.notEqual(ran.code, 0, ran.said);
});

test('given that world, #10 and #30 are in the coding column after rigger run', async (t) => {
  const here = world(t, { items: ONE_FAILING, ...FAILING });

  const ran = here.verb('run');

  const columns = await columnsOf(here);
  assert.equal(columns[10], 'Coding', ran.said);
  assert.equal(columns[30], 'Coding', ran.said);
});
