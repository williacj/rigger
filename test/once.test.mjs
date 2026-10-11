// ABOUTME: Tests `rigger once`: the real bin run in a consumer's repository with the fake `gh` first
// on PATH, claiming one card through L3's single pull, making and provisioning its workspace,
// dispatching its maker through L1 to a stand-in, printing its outcome, and refusing its own source tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { once as onceVerb } from '../src/cli/once.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh, installGhRefusingStreamAfterMove } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { spawn } from 'node:child_process';
import { once as onceEvent } from 'node:events';
import { readdirSync } from 'node:fs';
import { parse } from 'acorn';
import { gitIn } from './git-repository.mjs';
import { until } from './process-fixtures.mjs';
import { standInAgent } from './stub-claude.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { EXIT_IF_WARMING, warmed } from './process-fixtures.mjs';
import { installStandInAgent } from './stub-claude.mjs';
import { sweep } from './process-fixtures.mjs';

// A bound on a test that waits on the real bin and its maker, so one that never settles fails here.
const { 60_000: SETTLES_WITHIN } = BOUNDS;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/** The board's columns, the config's display names among them, and its priority field. */
const COLUMNS = ['Backlog', 'Ready', 'Coding', 'Review', 'Owner', 'Done'];
const FIELDS = [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }];

/** A body whose acceptance the form check admits: one item that is not the title. */
const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** A card on the consumer's board that L2 would dispatch: an issue in its repository, selected by the `change` kind. */
const card = (number, column, extra = {}) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: ADMITTED, labels: ['type:change'], column, ...extra,
});

/** The template's kinds, each listing no provisioning step, so a claimed card's attempt runs none. */
const KINDS = Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }]));

/** The consumer's config: the template's, with its repository, its board and N 3 filled in, and kinds listing no provisioning. */
const config = () => ({ ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency: 3, kinds: KINDS });

/**
 * A consumer's repository holding that config, with a local bare `origin` beside it, in a
 * directory of its own, so the workspaces the default root names beside it are its alone.
 */
const consumerRepository = () => {
  const directory = temporaryDirectory('rigger-once-');
  return withOrigin(repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(config())};\n` }), join(directory, 'origin.git'));
};

/**
 * A stand-in for the agent CLI every role in the template's config dispatches through, placed in
 * `dir`, which records each run beside itself. A dispatch in M2 and M4 runs the provider's CLI,
 * so a run of it is what a started dispatch would show.
 * It is run once before this returns (`warmed`), exiting before its body, so its first exec is not
 * held inside a run.
 */
function installAgentCli(dir) {
  const record = join(dir, 'agent-runs');
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\n${EXIT_IF_WARMING}\nprintf '%s\\n' "$*" >> "\${0%/*}/agent-runs"\nexit 0\n`);
  chmodSync(join(dir, 'claude'), 0o755);
  warmed(join(dir, 'claude'));
  return { runs: () => (existsSync(record) ? readFileSync(record, 'utf8').split('\n').filter(Boolean) : []) };
}

/**
 * Runs the real bin's `once` in a fresh consumer repository, with a fake `gh` holding `board`
 * first on PATH, ahead of the refusing one `npm test` puts there, and the agent CLI stand-in
 * beside it. `record` says how the consumer's event stream takes appends: `accepting`, the
 * default; `refusing`, where the stream is a directory before the run, so it refuses every
 * append from the start; or `refusing-after-move`, where the `gh` first on PATH answers as the
 * fake does and makes the stream that directory once it has answered a move.
 */
function once(board, { record = 'accepting' } = {}) {
  const consumer = consumerRepository();
  const dir = temporaryDirectory('rigger-once-gh-');
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board } });
  const agent = installAgentCli(dir);
  const stream = join(consumer, '.rigger', 'events.jsonl');
  if (record === 'refusing') mkdirSync(stream, { recursive: true });
  const ahead = record === 'refusing-after-move' ? [dirname(installGhRefusingStreamAfterMove(temporaryDirectory('rigger-once-wrap-'), fake.gh, stream))] : [];
  const env = { ...process.env, PATH: [...ahead, dir, process.env.PATH].join(delimiter) };
  const ran = spawnSync(process.execPath, [bin, 'once'], { cwd: consumer, encoding: 'utf8', env });
  assert.equal(ran.error, undefined);
  return { out: ran.stdout, err: ran.stderr, code: ran.status, consumer, model: fake.model, agentRuns: agent.runs };
}

/** Each card on the fake board by number, with the display name of the column it is in now. */
const columnsOf = async (ran) => Object.fromEntries((await (await ran.model()).operations.readItems()).map((item) => [item.number, item.column]));

/** The events the run recorded in the consumer's state directory, in order. */
const eventsOf = (ran) => readEvents(join(ran.consumer, '.rigger'));

/** The moves in the fake board's write record, each as the item moved and the column it entered. */
const movesOf = async (ran) => (await ran.model()).writes().filter(({ operation }) => operation === 'moveItem').map(({ args }) => args);

test('once, given N 3 and two ready cards L2 would dispatch and none in coding or review, claims exactly one card, which ends in the coding column', async () => {
  // #10 is the older card, so it is the one pulled first, and #20 stays where it was.
  const ran = once({ items: [card(20, 'Ready'), card(10, 'Ready')] });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Ready' }, ran.err);
});

test('once names the card it claimed, its workspace and its maker\'s outcome', () => {
  const ran = once({ items: [card(10, 'Ready')] });

  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.err);
  assert.ok(line.includes(join(dirname(realpathSync(ran.consumer)), 'widgets-worktrees', 'rigger-10')), line);
  assert.match(line, /; its maker exited 0 and opened no pull request from rigger-10, in its workspace, /, line);
});

test('once exits non-zero when the card\'s maker opened no pull request', async () => {
  const ran = once({ items: [card(10, 'Ready')] });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding' }, ran.err);
  assert.notEqual(ran.code, 0, ran.out);
});

test('once over a board with no pullable card claims nothing, and prints that no card was pullable', async () => {
  // #18 sits in Backlog and #19 in Done, so neither is offered to L2.
  const ran = once({ items: [card(18, 'Backlog'), card(19, 'Done')] });

  assert.match(ran.out, /no card was pullable/, ran.err);
  assert.deepEqual(await columnsOf(ran), { 18: 'Backlog', 19: 'Done' });
  assert.deepEqual((await ran.model()).writes(), []);
});

test('once over a board with no pullable card exits 0', () => {
  const ran = once({ items: [card(18, 'Backlog'), card(19, 'Done')] });

  assert.equal(ran.code, 0, ran.err);
});

/** A ready card L2 refuses: its body holds no acceptance, so the form check refuses it. */
const REFUSED = card(11, 'Ready', { body: 'Why this matters, and nothing more.' });

test('once, given a ready card L2 refuses, leaves it in the ready column', async () => {
  const ran = once({ items: [REFUSED, card(12, 'Ready')] });

  assert.deepEqual(await columnsOf(ran), { 11: 'Ready', 12: 'Coding' }, ran.err);
});

// proves R-CARD-7
test('once, given a ready card L2 refuses, names the card and the reason', () => {
  const ran = once({ items: [REFUSED, card(12, 'Ready')] });

  const line = ran.err.split('\n').find((held) => /#11\b/.test(held));
  assert.ok(line, ran.err);
  assert.match(line, /missing acceptance/, ran.err);
});

test('once, given a ready card L2 ignores, leaves it in the ready column', async () => {
  // No kind selects a card carrying no label, so L2 ignores it and it is neither pulled nor refused.
  const ran = once({ items: [card(13, 'Ready', { labels: [] })] });

  assert.deepEqual(await columnsOf(ran), { 13: 'Ready' }, ran.err);
  assert.match(ran.out, /no card was pullable/, ran.err);
  assert.doesNotMatch(ran.out, /#13\b/, ran.out);
});

test('once dispatches the card\'s selected steps and its maker: the agent CLI runs once, as the maker, and every L1 dispatch event is a step\'s or the maker\'s', async () => {
  const ran = once({ items: [card(10, 'Ready'), card(20, 'Ready')] });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Ready' }, ran.err);
  assert.equal(ran.agentRuns().length, 1, JSON.stringify(ran.agentRuns()));
  assert.match(ran.agentRuns()[0], /--append-system-prompt-file \S*\/rigger-10\/\.claude\/agents\/engineer\.md$/);
  const events = eventsOf(ran);
  assert.ok(events.length > 0, 'the run recorded events');
  assert.deepEqual(events.filter((event) => event.layer === 'L1' && event.dispatch !== undefined && !events.some((named) => named.layer === 'L3' && named.event === 'dispatch' && named.dispatch === event.dispatch && (typeof named.step === 'string' || (named.role === 'engineer' && named.tier === 'standard')))), []);
});

test('after once claims a card from the ready column, the state directory\'s event stream holds an L3 event and an L2 transition event', async () => {
  const ran = once({ items: [card(10, 'Ready')] });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding' }, ran.err);
  const events = eventsOf(ran);
  assert.ok(events.some((event) => event.layer === 'L3'), JSON.stringify(events));
  assert.ok(events.some((event) => event.layer === 'L2' && event.event === 'transition'), JSON.stringify(events));
});

/** One unclaimed card in review that L2 would dispatch, and one in ready, under N 3. */
const REDO_AND_READY = { items: [card(30, 'Ready'), card(40, 'Review')] };

test('once, given N 3, an unclaimed review card L2 would dispatch and a ready card L2 would dispatch, claims the review card', () => {
  const ran = once(REDO_AND_READY);

  assert.match(ran.err, /claimed #40\b/, ran.err);
  assert.doesNotMatch(ran.err, /#30\b/, ran.err);
  assert.notEqual(ran.code, 0);
});

test('once, given N 3, an unclaimed review card L2 would dispatch and a ready card L2 would dispatch, the forge holding nothing for either, moves the review card to coding and leaves the ready card unmoved in the fake board\'s write record', async () => {
  const ran = once(REDO_AND_READY);

  assert.match(ran.err, /claimed #40\b/, ran.err);
  assert.deepEqual(await movesOf(ran), [['item-2', 'Coding']]);
  assert.deepEqual(await columnsOf(ran), { 30: 'Ready', 40: 'Coding' });
});

test('once, given N 3, an unclaimed review card L2 would dispatch and a ready card L2 would dispatch, the forge holding nothing for either, records one L2 transition event in the state directory\'s stream, for the review card, from review to coding', () => {
  const ran = once(REDO_AND_READY);

  assert.match(ran.err, /claimed #40\b/, ran.err);
  const events = eventsOf(ran);
  assert.ok(events.some((event) => event.layer === 'L3' && event.event === 'pull' && event.card === 40), JSON.stringify(events));
  assert.deepEqual(events.filter((event) => event.layer === 'L2' && event.event === 'transition').map(({ event, card, from, to }) => ({ event, card, from, to })), [{ event: 'transition', card: 40, from: 'review', to: 'coding' }]);
  assert.deepEqual(events.filter((event) => event.layer === 'L2' && event.event !== 'transition').map(({ event, card }) => ({ event, card })), [{ event: 'review.withheld', card: 40 }]);
});

// proves R-SAFE-5
test('once run against the source tree it is running from exits non-zero, names R-SAFE-5, and claims nothing', async () => {
  // The consumer's repository stands as the package too, so the two are one tree. Git alone may be
  // asked, because naming the tree is the refusal's own work. Every forge call goes through
  // `send`, which records rather than answers, so a board read or a move shows as a call.
  const consumer = consumerRepository();
  const asked = (command, args) => {
    if (command === 'git') return spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
    throw new Error(`once ran \`${command}\` before refusing`);
  };
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args].join(' '));
    return { status: 1, stdout: '', stderr: 'no board here' };
  };

  const ran = await onceVerb({ target: consumer, packageRoot: consumer, ask: asked, send });

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /R-SAFE-5/);
  assert.deepEqual(sent, []);
  assert.ok(!existsSync(join(consumer, '.rigger')), 'no state directory was opened');
});

// The halt: with the record refusing, `once` starts nothing and says loudly what went unrecorded
// (`ARCHITECTURE.md`, "Failure model").

test('given an event stream that refuses every append from the start, once exits non-zero', () => {
  const ran = once({ items: [card(10, 'Ready'), card(20, 'Ready')] }, { record: 'refusing' });

  assert.notEqual(ran.code, 0, ran.out);
});

// proves R-RECORD-9
test('given an event stream that refuses every append from the start, once leaves every card in the ready column', async () => {
  const ran = once({ items: [card(10, 'Ready'), card(20, 'Ready')] }, { record: 'refusing' });

  assert.deepEqual(await columnsOf(ran), { 10: 'Ready', 20: 'Ready' }, ran.err);
  assert.deepEqual(await movesOf(ran), []);
});

test('given an event stream that refuses every append from the start, once says in a line of its own which card it did not start, and the sink\'s error', () => {
  const ran = once({ items: [card(10, 'Ready'), card(20, 'Ready')] }, { record: 'refusing' });

  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.err);
  assert.match(line, /^rigger once: /);
  assert.match(line, /not started/);
  assert.match(line, /EISDIR/, 'the sink\'s own error is named');
});

test('given the board takes a claim move and the sink then refuses its transition event, once exits non-zero', async () => {
  const ran = once({ items: [card(10, 'Ready')] }, { record: 'refusing-after-move' });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding' }, 'the board took the move');
  assert.notEqual(ran.code, 0, ran.out);
});

// proves R-RECORD-9
test('given the board takes a claim move and the sink then refuses its transition event, once names the card, the column left, the column entered, and says the move went unrecorded', async () => {
  const ran = once({ items: [card(10, 'Ready')] }, { record: 'refusing-after-move' });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding' }, 'the board took the move');
  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.err);
  assert.match(line, /^rigger once: /);
  assert.match(line, /from ready to coding/);
  assert.match(line, /refused to record/, 'the move went unrecorded');
  assert.match(line, /EISDIR/, 'the sink\'s own error is named');
});

test('--help\'s line for once says it claims one card, provisions its workspace and dispatches its maker', () => {
  const shown = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });

  assert.equal(shown.status, 0, shown.stderr);
  const line = shown.stdout.split('\n').find((held) => /^\s*once\b/.test(held));
  assert.ok(line, shown.stdout);
  assert.match(line, /claim one card, provision its workspace and dispatch its maker, then exit/, line);
  assert.doesNotMatch(line, /before M4/, line);
});

// The maker, dispatched through L1 to the stand-in agent (#486).

/**
 * A consumer's repository holding `settings`, its main line on `main`, with a local bare `origin`
 * beside it, in a directory of its own; `files` are committed with the config.
 */
function consumerHolding(settings, files = {}) {
  const directory = temporaryDirectory('rigger-once-maker-');
  const repository = repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n`, ...files });
  gitIn(repository, 'branch', '-M', 'main');
  const origin = join(directory, 'origin.git');
  return { consumer: withOrigin(repository, origin), origin };
}

/**
 * Starts the real bin's `once` in a consumer's repository holding `settings` and `files`, with the
 * stand-in agent `agent` first on PATH, then a fake `gh` holding `board` over the consumer's
 * `origin`, ahead of the refusing ones `npm test` puts there. `env` is added to the bin's
 * environment. Answers the consumer, its origin, the fake, and `ran`, which settles on the bin's
 * status and what it printed; the bin is ended at the test's teardown if it is still running.
 */
function onceWithAgent(t, agent, board, { settings = config(), files = {}, env = {} } = {}) {
  const { consumer, origin } = consumerHolding(settings, files);
  const dir = temporaryDirectory('rigger-once-maker-gh-');
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board }, origin });
  const child = spawn(process.execPath, [bin, 'once'], { cwd: consumer, env: { ...process.env, ...env, PATH: [agent.dir, dir, process.env.PATH].join(delimiter) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  const ran = onceEvent(child, 'close').then(([code]) => ({ code, out, err }));
  return { consumer, origin, fake, ran };
}

/** The line `once` prints for card `number` claimed from the consumer's board, with `outcome` and the workspace at its end. */
const makerLine = (consumer, number, outcome) => `rigger once: claimed #${number} from board ${PROJECT}; ${outcome}, in its workspace, ${join(dirname(realpathSync(consumer)), 'widgets-worktrees', `rigger-${number}`)}`;

test('given once over a fake board with one ready card and a stand-in maker exiting 0 with no pull request, once prints one line for the card in the verbs\' form, and exits non-zero', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent();
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  assert.deepEqual(err.split('\n').filter((line) => /#10\b/.test(line)), [makerLine(consumer, 10, 'its maker exited 0 and opened no pull request from rigger-10')]);
});

// proves R-WORK-6
test('given once where the stand-in maker exits 0 and opens a pull request on the fake forge, the card ends in Review, once prints that it is in review naming the pull request, and exits 0', SETTLES_WITHIN, async (t) => {
  // The kind's only judge is the owner, so no later card's judges reach this card.
  const settings = { ...config(), kinds: { change: { ...KINDS.change, judges: ['owner'] } } };
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings });

  const { code, out, err } = await ran;

  assert.equal(code, 0, err);
  const columns = Object.fromEntries((await (await fake.model()).operations.readItems()).map((item) => [item.number, item.column]));
  assert.deepEqual(columns, { 10: 'Review' });
  assert.deepEqual(out.split('\n').filter((line) => /#10\b/.test(line)), [makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review')]);
});

test('given a stand-in that opens a pull request, the world\'s local origin holds the pull request\'s head SHA afterwards', SETTLES_WITHIN, async (t) => {
  const settings = { ...config(), kinds: { change: { ...KINDS.change, judges: ['owner'] } } };
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { origin, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings });

  await ran;

  const view = spawnSync(fake.gh, ['pr', 'view', '11', '--json', 'headRefOid'], { encoding: 'utf8', env: gitEnvironment() });
  assert.equal(view.status, 0, view.stderr);
  const { headRefOid } = JSON.parse(view.stdout);
  assert.match(headRefOid, /^[0-9a-f]{40}$/);
  assert.doesNotThrow(() => gitIn(origin, 'cat-file', '-e', headRefOid));
});

test('given once where the maker exits non-zero, once exits non-zero, and prints the card and the exit code', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { engineer: { exit: 4 } } });
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  assert.deepEqual(err.split('\n').filter((line) => /#10\b/.test(line)), [makerLine(consumer, 10, 'its maker exited 4')]);
});

test('given once where the maker does not start, once exits non-zero, and prints the card and why', SETTLES_WITHIN, async (t) => {
  // A settings file the Claude Code adapter cannot read, committed so the workspace holds it.
  const agent = standInAgent();
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { files: { '.claude/settings.json': 'not json' } });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const lines = err.split('\n').filter((line) => /#10\b/.test(line));
  assert.equal(lines.length, 1, err);
  assert.match(lines[0], /^rigger once: claimed #10 from board 3; its maker did not start: .*settings\.json is no JSON/);
  assert.deepEqual(agent.runs(), []);
  const attempts = err.split('\n').filter((line) => /^attempt [12]: /.test(line));
  assert.deepEqual(attempts.map((line) => /^attempt (\d+): /.exec(line)?.[1]), ['1', '2']);
  assert.ok(attempts.every((line) => /settings\.json is no JSON/.test(line)), err);
});

/**
 * The stand-in agent acting as `plan` says, installed in a directory of its own that also holds a
 * `git` answering as the git first on this process's PATH does and, once it has answered a command
 * naming a judge's directory under the consumer's worktree root, replacing the consumer's event
 * stream with a directory of that name, which no append can open: L1 has made the judge's
 * directory, and the record then refuses its event. The consumer is `consumer` beside the root,
 * as `consumerHolding` and the default root place them.
 * The `git` is run once before this returns (`warmed`), exiting before its body, so its first exec
 * is not held inside a run.
 */
function standInRefusingStreamAfterJudgeMake(plan) {
  const dir = temporaryDirectory('rigger-once-judge-git-', { beforeRemoval: () => sweep(dir) });
  const git = spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  assert.match(git, /^\//, 'no git was found on PATH');
  writeFileSync(join(dir, 'git'), [
    '#!/bin/sh',
    EXIT_IF_WARMING,
    `'${git}' "$@"`,
    'status=$?',
    'for arg in "$@"; do',
    '  case "$arg" in */widgets-worktrees/judges/*) stream="${arg%%/widgets-worktrees/judges/*}/consumer/.rigger/events.jsonl"; rm -f "$stream"; mkdir -p "$stream" ;; esac',
    'done',
    'exit $status',
    '',
  ].join('\n'));
  chmodSync(join(dir, 'git'), 0o755);
  warmed(join(dir, 'git'));
  return installStandInAgent(dir, plan);
}

test('given once where the stand-in maker exits 0 and opens a pull request, and the judge then dispatched under the same claim fails, once prints the claimed line with the maker\'s outcome and the judge\'s failure naming the card and the judge, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // The template's `change` kind names `reviewer` as its one judge.
  const agent = standInRefusingStreamAfterJudgeMake({ 10: { engineer: { pr: true } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const columns = Object.fromEntries((await (await fake.model()).operations.readItems()).map((item) => [item.number, item.column]));
  assert.deepEqual(columns, { 10: 'Review' }, err);
  const lines = err.split('\n');
  assert.ok(lines.includes(makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review')), err);
  assert.ok(lines.some((line) => /^rigger once: card #10's judge `reviewer` handed back no outcome: /.test(line)), err);
});

// proves R-WORK-2
test('while a card\'s maker runs, the fake board\'s write record shows no move of that card by anything but L2, and the stand-in\'s run writes nothing to the board', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { engineer: { hold: true } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  await until(() => agent.held(10), t);
  const writesHeld = (await fake.model()).writes();
  const sentHeld = fake.sent().length;
  const transitions = eventsOf({ consumer }).filter((event) => event.layer === 'L2' && event.event === 'transition');
  agent.release(10);
  await ran;

  assert.deepEqual(writesHeld.map(({ operation, args: [, column] }) => ({ operation, column })), [{ operation: 'moveItem', column: 'Coding' }]);
  assert.deepEqual(transitions.map(({ card: number, from, to }) => ({ card: number, from, to })), [{ card: 10, from: 'ready', to: 'coding' }]);
  const run = agent.runs()[0];
  const during = fake.sent().slice(sentHeld);
  assert.deepEqual(during.filter((args) => args.join(' ').includes('mutation')), [], `the stand-in's run (pid ${run.pid}) sent a write`);
  assert.deepEqual((await fake.model()).writes(), writesHeld, 'a move was written after the maker ran');
});

test('once hands loop the process\'s own environment, which reaches the maker, as a variable set only in the bin\'s environment shows', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent();
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { env: { RIGGER_STAND_IN_MARK: 'from-the-bin' } });

  await ran;

  assert.deepEqual(agent.runs().map((run) => run.env), [{ RIGGER_STAND_IN_MARK: 'from-the-bin' }]);
});

/** Every module under src/cli/, by its path from the repository's root. */
const cliModules = () => readdirSync(join(root, 'src', 'cli')).filter((name) => name.endsWith('.mjs')).map((name) => join('src', 'cli', name));

test('no verb hands loop a maker: every loop built under src/cli/ takes no dispatch option', () => {
  const built = [];
  const visit = (node, file) => {
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'loop') {
      const [options] = node.arguments;
      assert.equal(options?.type, 'ObjectExpression', `${file}: loop is handed something other than an object literal`);
      built.push({ file, keys: options.properties.map((property) => property.key?.name ?? property.type) });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((each) => visit(each, file));
      else if (value && typeof value.type === 'string') visit(value, file);
    }
  };
  for (const file of cliModules()) visit(parse(readFileSync(join(root, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }), file);

  assert.ok(built.length > 0, 'no loop is built under src/cli/');
  assert.deepEqual(built.filter(({ keys }) => keys.includes('dispatch') || keys.includes('SpreadElement')), []);
});

test('no source file under src/ prints that no maker runs before M4', () => {
  const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]));
  const saying = files(join(root, 'src')).filter((file) => readFileSync(file, 'utf8').includes('no maker runs before M4'));

  assert.deepEqual(saying, []);
});

// The judges, dispatched through L1 to the stand-in agent under the card's one claim (#490).

/** The line `once` prints for card `number`'s judge `role`, saying `outcome`. */
const judgeLine = (number, role, outcome) => `rigger once: card #${number}'s judge \`${role}\` ${outcome}`;

/** The comments on the fake forge's pull request `number`, and the SHA of its head. */
function pullComments(fake, number) {
  const view = spawnSync(fake.gh, ['pr', 'view', String(number), '--json', 'comments,headRefOid'], { encoding: 'utf8', env: gitEnvironment() });
  assert.equal(view.status, 0, view.stderr);
  const { comments, headRefOid } = JSON.parse(view.stdout);
  return { head: headRefOid, bodies: comments.map((comment) => comment.body) };
}

test('given once where the maker opens a pull request and the card\'s kind names one agent judge, once prints the judge\'s role and outcome after the card\'s line, and the judge stand-in posts its findings comment on the fake forge', SETTLES_WITHIN, async (t) => {
  // The template's `change` kind names `reviewer` as its one judge.
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { findings: true } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, out, err } = await ran;

  assert.deepEqual([...out.split('\n'), ...err.split('\n')].filter((line) => /#10\b/.test(line)), [
    makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review'),
    judgeLine(10, 'reviewer', 'exited 0'),
  ], `${code}\n${err}`);
  const { head, bodies } = pullComments(fake, 11);
  assert.deepEqual(bodies.map((body) => body.split('\n').filter((line) => /^(head|role): /.test(line))), [[`head: ${head}`, 'role: reviewer']]);
});

test('given once where every agent judge exits 0, once exits 0', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { findings: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, err } = await ran;

  assert.equal(code, 0, err);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer', 'reviewer']);
});

test('given once where a judge exits non-zero, once prints that judge\'s role and exit code, and exits non-zero', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { exit: 3 } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  assert.ok(err.split('\n').includes(judgeLine(10, 'reviewer', 'exited 3')), err);
});

test('given once where a judge runs past its time, once prints that judge\'s role and that its time ran out, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // The reviewer's time is one second, and its stand-in never exits, so the time ends it.
  const settings = { ...config(), roles: { ...template.roles, reviewer: { ...template.roles.reviewer, timeout: 1000 } } };
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { forever: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  assert.ok(err.split('\n').includes(judgeLine(10, 'reviewer', 'ran past its time, 1000 ms, and was ended')), err);
});

test('given once where a judge is not dispatched because a required step failed in its head, once prints the judge\'s role, the step and the failure, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // The step fails only where the newest commit is the stand-in maker's: in the judge's `head`,
  // and never in the maker's workspace, which is made before the maker commits.
  const settings = {
    ...config(),
    kinds: { ...KINDS, change: { ...KINDS.change, provisioning: ['check'] } },
    provisioning: { check: { run: '! git log -1 --format=%s | grep -q "stand-in"', required: true } },
  };
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  assert.ok(err.split('\n').includes(judgeLine(10, 'reviewer', 'was not dispatched, because its required step `check` failed in its head: it exited 1')), err);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer']);
});

/**
 * A module the bin's Node process loads first, through `NODE_OPTIONS`, under which the consumer's
 * event stream refuses the appends alone of each event `condition`, JavaScript over `event`, holds
 * for, saying it refuses `what`. It changes `node:fs` itself, and `syncBuiltinESMExports` carries
 * the change to the sink, which imports `appendFileSync` by name, so the sink refuses those appends
 * without knowing it is under test.
 */
function refusingAppend(condition, what) {
  const path = join(temporaryDirectory('rigger-once-refuse-append-'), 'refuse-append.mjs');
  writeFileSync(path, [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const { appendFileSync } = fs;',
    'fs.appendFileSync = (path, data, ...rest) => {',
    "  const event = String(path).endsWith('/.rigger/events.jsonl') ? JSON.parse(String(data)) : {};",
    `  if (${condition}) {`,
    `    throw Object.assign(new Error(\`EACCES: the test refuses \${${JSON.stringify(what)}} on \${path}\`), { code: 'EACCES' });`,
    '  }',
    '  return appendFileSync(path, data, ...rest);',
    '};',
    'syncBuiltinESMExports();',
    '',
  ].join('\n'));
  return path;
}

/** `refusingAppend` for L3's `dispatch` event, its start, of the judge `role` alone. */
const refusingJudgeStart = (role) => refusingAppend(`event.layer === 'L3' && event.event === 'dispatch' && event.role === ${JSON.stringify(role)}`, `L3's dispatch of ${role}`);

test('given once where a judge\'s start event is refused, once prints the judge\'s role and the refused event, and exits non-zero', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { env: { NODE_OPTIONS: `--import ${refusingJudgeStart('reviewer')}` } });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const lines = err.split('\n');
  assert.ok(lines.includes(makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review')), err);
  assert.ok(lines.includes(judgeLine(10, 'reviewer', 'handed back no outcome: card #10\'s role `reviewer` was not started, because the event sink refused to record its start: EACCES: the test refuses L3\'s dispatch of reviewer on '
    + `${join(realpathSync(consumer), '.rigger', 'events.jsonl')}`)), err);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer']);
});

test('given once over a Review card whose every agent judge has findings at the head, once dispatches nothing for it, and prints nothing for it but that no card was pullable', SETTLES_WITHIN, async (t) => {
  // The first `once` leaves #10 in Review with the reviewer's findings at its head; the second
  // runs over the same repository and the same fake forge, as the first left them.
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { findings: true } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });
  const first = await ran;
  assert.equal(first.code, 0, first.err);
  const { head, bodies } = pullComments(fake, 11);
  assert.deepEqual(bodies.map((body) => body.split('\n').filter((line) => /^(head|role): /.test(line))), [[`head: ${head}`, 'role: reviewer']], 'the first once left no marker at the head, so the test proves nothing');
  const before = eventsOf({ consumer }).length;

  const again = spawnSync(process.execPath, [bin, 'once'], { cwd: consumer, encoding: 'utf8', env: { ...process.env, PATH: [agent.dir, dirname(fake.gh), process.env.PATH].join(delimiter) } });

  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual([...again.stdout.split('\n'), ...again.stderr.split('\n')].filter(Boolean), [`rigger once: from board ${PROJECT}, no card was pullable`]);
  const later = eventsOf({ consumer }).slice(before);
  assert.ok(later.some((event) => event.layer === 'L3' && event.event === 'trigger'), 'the second once recorded nothing, so the test proves nothing');
  assert.deepEqual(later.filter((event) => (event.layer === 'L3' && event.event === 'dispatch') || (event.layer === 'L1' && event.event === 'dispatch.start')), []);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer', 'reviewer']);
});

/** The roles of every L3 `dispatch` event in `events` that names one, in order. */
const rolesDispatched = (events) => events.filter((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role !== undefined).map((event) => event.role);

test('given once over a board holding one ready type:spike card, the maker dispatched is spikeEngineer\'s agent file and its judge reviewer\'s, as the stand-in\'s recorded prompt and arguments show', SETTLES_WITHIN, async (t) => {
  const agent = standInAgent({ 10: { 'spike-engineer': { pr: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready', { labels: ['type:spike'] })] });

  const { code, err } = await ran;

  assert.equal(code, 0, err);
  const runs = agent.runs().map(({ args, input, cwd }) => ({ agentFile: args[args.indexOf('--append-system-prompt-file') + 1], input, cwd }));
  assert.equal(runs.length, 2, JSON.stringify(runs));
  const [maker, judge] = runs;
  assert.equal(maker.agentFile, join(maker.cwd, '.claude', 'agents', 'spike-engineer.md'));
  assert.match(maker.input, /^Rigger dispatched this session, unattended, as the maker for card #10\./);
  assert.equal(judge.agentFile, join(judge.cwd, '.claude', 'agents', 'reviewer.md'));
  assert.match(judge.input, /^Rigger dispatched this session, unattended, as the judge `reviewer` of pull request #11, /);
});

// proves R-LOOP-11
test('given once over a type:spec card whose kind names owner beside its agent judges, no L3 dispatch event and no L1 dispatch.start names the role owner, and once prints that the owner judges last', SETTLES_WITHIN, async (t) => {
  // The template's `spec` kind names `reviewer`, `engineer` and `architect`, then `owner`.
  const agent = standInAgent({ 10: { pm: { pr: true } } });
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready', { labels: ['type:spec'] })] });

  const { code, out, err } = await ran;

  assert.equal(code, 0, err);
  const events = eventsOf({ consumer });
  assert.deepEqual(rolesDispatched(events).sort(), ['architect', 'engineer', 'pm', 'reviewer']);
  const starts = events.filter((event) => event.layer === 'L1' && event.event === 'dispatch.start');
  assert.equal(starts.length, 4, JSON.stringify(starts));
  assert.deepEqual(starts.filter((event) => /\bowner\b/.test(JSON.stringify(event))), []);
  assert.ok(out.split('\n').includes(judgeLine(10, 'owner', 'judges last, once every agent judge is satisfied, and Rigger never dispatches it')), out);
});

test('given once over a Review card whose agent judge has no findings at the head, once pulls it for its judges alone, prints that and the judge\'s line, and exits 0 once the judge exits 0', SETTLES_WITHIN, async (t) => {
  // The first `once` leaves #10 in Review with a reviewer that exited 3 and wrote no findings; the
  // second runs over the same repository and the same fake forge, its reviewer writing them.
  const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: { exit: 3 } } });
  const { consumer, fake, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });
  const first = await ran;
  assert.ok(first.err.split('\n').includes(judgeLine(10, 'reviewer', 'exited 3')), first.err);
  agent.plan(10, 'reviewer', { findings: true });

  const again = spawnSync(process.execPath, [bin, 'once'], { cwd: consumer, encoding: 'utf8', env: { ...process.env, PATH: [agent.dir, dirname(fake.gh), process.env.PATH].join(delimiter) } });

  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(again.stdout.split('\n').filter((line) => /#10\b/.test(line)), [
    `rigger once: claimed #10 from board ${PROJECT} for its judges alone`,
    judgeLine(10, 'reviewer', 'exited 0'),
  ]);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer', 'reviewer', 'reviewer']);
});

test('given once where a judge does not start, once prints the judge\'s role and why, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // A Bash rule for a compound command line admits nothing, and the Claude Code adapter refuses it
  // only for a role that reaches a directory, as a judge reaches its `head` and the maker reaches none.
  const files = { '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(npm ci && npm test)'] } }) };
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { files });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const line = err.split('\n').find((held) => held.startsWith(judgeLine(10, 'reviewer', '')));
  assert.ok(line, err);
  assert.ok(line.startsWith(judgeLine(10, 'reviewer', 'did not start: the role\'s dispatch did not start: the claude adapter answered no invocation for role reviewer: ')), line);
  assert.match(line, /Bash\(npm ci && npm test\), a rule for a compound command line/, line);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer']);
});

test('given once where a judge is dispatched and its dispatch then fails, once prints the judge\'s role and the failure, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // L1's start of the judge's dispatch is refused: of the role dispatches, only a judge's carries the facts of the head it rules on.
  const preload = refusingAppend("event.layer === 'L1' && event.event === 'dispatch.start' && event.facts !== undefined", 'L1\'s start of a judge\'s dispatch');
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { env: { NODE_OPTIONS: `--import ${preload}` } });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const line = err.split('\n').find((held) => held.startsWith(judgeLine(10, 'reviewer', '')));
  assert.ok(line, err);
  assert.ok(line.startsWith(judgeLine(10, 'reviewer', 'was dispatched, and its dispatch failed: ')), line);
  // L1's failure names the refused event on the lines after its first.
  assert.match(line, /the sink refused 1 L1 event\(s\) of dispatch d-[0-9a-f-]+, card #10, so they went unrecorded:$/, line);
  assert.match(err, /EACCES: the test refuses L1's start of a judge's dispatch on /, err);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer']);
});

test('given once where a judge\'s directory cannot be made, once prints the judge\'s role and why, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // A plain file where the judges' directories go, beside the workspaces under the default root.
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] });
  const root = join(dirname(consumer), 'widgets-worktrees');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'judges'), 'not a directory');

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  const line = err.split('\n').find((held) => held.startsWith(judgeLine(10, 'reviewer', '')));
  assert.ok(line, err);
  assert.ok(line.startsWith(judgeLine(10, 'reviewer', 'was not dispatched, because its directory could not be made: ')), line);
  assert.match(line, /judges\/rigger-10\/reviewer/, line);
  assert.deepEqual(agent.runs().map(({ role }) => role), ['engineer']);
});

// A card whose judges are mixed, one handing back beside one whose start event is refused (#612).

/** The config with the `change` kind naming `judges`, in that order, each run with no provisioning step unless `provisioning` names one. */
const judgedBy = (judges, { provisioning, roles } = {}) => ({
  ...config(),
  ...(roles === undefined ? {} : { roles: { ...template.roles, ...roles } }),
  ...(provisioning === undefined ? {} : { provisioning }),
  kinds: { ...KINDS, change: { ...KINDS.change, judges, provisioning: provisioning === undefined ? [] : Object.keys(provisioning) } },
});

/** The start of the line `once` prints for card #10's judge `role` whose start event the preload refused. */
const refusedLine = (role) => judgeLine(10, role, `handed back no outcome: card #10's role \`${role}\` was not started, because the event sink refused to record its start: EACCES: the test refuses L3's dispatch of ${role} on `);

/**
 * Every line `once` printed naming card #10, each line that starts as `starts` holds being read as
 * that start, so a line naming the consumer's own path is compared without it.
 */
const linesOf10 = (out, err, starts = []) => [...out.split('\n'), ...err.split('\n')]
  .filter((line) => /#10\b/.test(line))
  .map((line) => starts.find((start) => line.startsWith(start)) ?? line);

for (const [judges, first, second] of [[['reviewer', 'architect'], 'handed back', 'refused'], [['architect', 'reviewer'], 'refused', 'handed back']]) {
  test(`given once over a card whose judges are ${judges.join(' then ')}, the reviewer exiting 0 and the architect's start event refused, once prints a line for each judge in the order L2 named them, the ${first} one first and the ${second} one second, and exits non-zero`, SETTLES_WITHIN, async (t) => {
    const agent = standInAgent({ 10: { engineer: { pr: true } } });
    const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings: judgedBy(judges), env: { NODE_OPTIONS: `--import ${refusingJudgeStart('architect')}` } });

    const { code, out, err } = await ran;

    assert.notEqual(code, 0, out);
    const judgeLines = { reviewer: judgeLine(10, 'reviewer', 'exited 0'), architect: refusedLine('architect') };
    assert.deepEqual(linesOf10(out, err, [refusedLine('architect')]), [
      makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review'),
      ...judges.map((role) => judgeLines[role]),
    ], err);
  });
}

test('given once over a card whose judges are reviewer, architect and pm, the reviewer exiting 0, the architect\'s start event refused and the pm withheld for a required step failing in its head, once prints each judge\'s line in that order, the failure and the withholding each with why, and exits non-zero', SETTLES_WITHIN, async (t) => {
  // The step fails only in the head of the judge directory named `pm`: `<root>/judges/rigger-10/pm/head`.
  const provisioning = { check: { run: 'test "$(basename "$(dirname "$PWD")")" != pm', required: true } };
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings: judgedBy(['reviewer', 'architect', 'pm'], { provisioning }), env: { NODE_OPTIONS: `--import ${refusingJudgeStart('architect')}` } });

  const { code, out, err } = await ran;

  assert.notEqual(code, 0, out);
  // The preload refuses every L3 dispatch naming the architect, so the step in its head is the start refused.
  const architect = judgeLine(10, 'architect', 'handed back no outcome: card #10\'s step `check` was not started, because the event sink refused to record its start: EACCES: the test refuses L3\'s dispatch of architect on ');
  assert.deepEqual(linesOf10(out, err, [architect]), [
    makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review'),
    judgeLine(10, 'reviewer', 'exited 0'),
    architect,
    judgeLine(10, 'pm', 'was not dispatched, because its required step `check` failed in its head: it exited 1'),
  ], err);
});

for (const [plan, roles, said] of [
  [{ exit: 3 }, undefined, 'exited 3'],
  [{ forever: true }, { reviewer: { ...template.roles.reviewer, timeout: 1000 } }, 'ran past its time, 1000 ms, and was ended'],
]) {
  test(`given once over a card whose reviewer hands back, ${said}, beside an architect whose start event is refused, once prints the reviewer's line as it says that outcome, and exits non-zero`, SETTLES_WITHIN, async (t) => {
    const agent = standInAgent({ 10: { engineer: { pr: true }, reviewer: plan } });
    const { consumer, ran } = onceWithAgent(t, agent, { items: [card(10, 'Ready')] }, { settings: judgedBy(['reviewer', 'architect'], { roles }), env: { NODE_OPTIONS: `--import ${refusingJudgeStart('architect')}` } });

    const { code, out, err } = await ran;

    assert.notEqual(code, 0, out);
    assert.deepEqual(linesOf10(out, err, [refusedLine('architect')]), [
      makerLine(consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review'),
      judgeLine(10, 'reviewer', said),
      refusedLine('architect'),
    ], err);
  });
}

test('the agent CLI stand-in, once installed, has recorded no run, and its directory holds only itself', () => {
  const dir = temporaryDirectory('rigger-warming-agent-');

  const agent = installAgentCli(dir);

  assert.deepEqual(agent.runs(), []);
  assert.deepEqual(readdirSync(dir).sort(), ['claude']);
});

test('the stand-in that refuses the stream once a judge\'s directory is made, once made, has recorded no run, and its directory holds only its git, itself and its plan', () => {
  const agent = standInRefusingStreamAfterJudgeMake({});

  assert.deepEqual(agent.runs(), []);
  assert.deepEqual(readdirSync(agent.dir).sort(), ['claude', 'git', 'plan.json']);
});
