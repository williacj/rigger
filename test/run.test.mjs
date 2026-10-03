// ABOUTME: Tests `rigger run`: the real bin run in a consumer's repository with the fake `gh` first
// on PATH, claiming through L3's single pull until the slots are full, making and provisioning each
// claimed card's workspace, dispatching its maker, printing its outcome, and refusing its own source tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { run as runVerb } from '../src/cli/run.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh, installGhRefusingStreamAfterMove } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { gitIn } from './git-repository.mjs';
import { standInAgent } from './stub-claude.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { EXIT_IF_WARMING, warmed } from './process-fixtures.mjs';

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

/** The consumer's config: the template's, with its repository, its board and N filled in, and kinds listing no provisioning. */
const config = (concurrency) => ({ ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency, kinds: KINDS });

/**
 * A consumer's repository holding that config, with a local bare `origin` beside it, in a
 * directory of its own, so the workspaces the default root names beside it are its alone.
 */
const consumerRepository = (concurrency) => {
  const directory = temporaryDirectory('rigger-run-');
  return withOrigin(repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(config(concurrency))};\n` }), join(directory, 'origin.git'));
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

/** The real bin's `run`, spawned in `consumer` under `env`, with what it printed and exited. */
function spawnRun(consumer, env) {
  const ran = spawnSync(process.execPath, [bin, 'run'], { cwd: consumer, encoding: 'utf8', env });
  assert.equal(ran.error, undefined);
  return { out: ran.stdout, err: ran.stderr, code: ran.status };
}

/**
 * Runs the real bin's `run` in a fresh consumer repository whose config declares `concurrency`,
 * with a fake `gh` holding `board` first on PATH, ahead of the refusing one `npm test` puts
 * there, and the agent CLI stand-in beside it. `again()` runs it a second time over the same
 * repository and the same fake board, as the board stands after the first. `record` says how
 * the consumer's event stream takes appends: `accepting`, the default; `refusing`, where the
 * stream is a directory before the run, so it refuses every append from the start; or
 * `refusing-after-move`, where the `gh` first on PATH answers as the fake does and makes the
 * stream that directory once it has answered a move.
 */
function run(board, { concurrency, record = 'accepting' }) {
  const consumer = consumerRepository(concurrency);
  const dir = temporaryDirectory('rigger-run-gh-');
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board } });
  const agent = installAgentCli(dir);
  const stream = join(consumer, '.rigger', 'events.jsonl');
  if (record === 'refusing') mkdirSync(stream, { recursive: true });
  const ahead = record === 'refusing-after-move' ? [dirname(installGhRefusingStreamAfterMove(temporaryDirectory('rigger-run-wrap-'), fake.gh, stream))] : [];
  const env = { ...process.env, PATH: [...ahead, dir, process.env.PATH].join(delimiter) };
  const shared = { consumer, model: fake.model, agentRuns: agent.runs };
  return { ...spawnRun(consumer, env), ...shared, again: () => ({ ...spawnRun(consumer, env), ...shared }) };
}

/** Each card on the fake board by number, with the display name of the column it is in now. */
const columnsOf = async (ran) => Object.fromEntries((await (await ran.model()).operations.readItems()).map((item) => [item.number, item.column]));

/** The events the run recorded in the consumer's state directory, in order. */
const eventsOf = (ran) => readEvents(join(ran.consumer, '.rigger'));

/** The moves in the fake board's write record, each as the item moved and the column it entered. */
const movesOf = async (ran) => (await ran.model()).writes().filter(({ operation }) => operation === 'moveItem').map(({ args }) => args);

/** The L2 transition events in `events`, each as the card and the column keys it left and entered. */
const transitionsIn = (events) => events
  .filter((event) => event.layer === 'L2' && event.event === 'transition')
  .map(({ card, from, to }) => ({ card, from, to }));

/**
 * The most claims L3 held at once, derived from the events: each `pull` takes a slot and each
 * `slot.release` frees one, in the order recorded.
 */
function mostHeld(events) {
  let held = 0;
  let most = 0;
  for (const event of events.filter((event) => event.layer === 'L3')) {
    if (event.event === 'pull') held += 1;
    if (event.event === 'slot.release') held -= 1;
    most = Math.max(most, held);
  }
  return most;
}

/** Four ready cards L2 would dispatch, oldest first #10, #20, #30, #40. */
const FOUR_READY = { items: [card(30, 'Ready'), card(10, 'Ready'), card(40, 'Ready'), card(20, 'Ready')] };

test('run, given N 1 and four pullable cards, claims exactly one card, which ends in the coding column', async () => {
  const ran = run(FOUR_READY, { concurrency: 1 });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Ready', 30: 'Ready', 40: 'Ready' }, ran.err);
});

test('run, given N 1 and four pullable cards, exits non-zero naming the one card it claimed', () => {
  const ran = run(FOUR_READY, { concurrency: 1 });

  assert.notEqual(ran.code, 0, ran.out);
  assert.match(ran.err, /claimed #10\b/, ran.err);
  for (const other of [20, 30, 40]) assert.doesNotMatch(ran.err, new RegExp(`#${other}\\b`), ran.err);
});

test('run, given N 3 and four pullable cards, claims exactly three cards, which end in the coding column', async () => {
  const ran = run(FOUR_READY, { concurrency: 3 });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Coding', 30: 'Coding', 40: 'Ready' }, ran.err);
});

test('run, given N 3 and four pullable cards, exits non-zero naming the three cards it claimed', () => {
  const ran = run(FOUR_READY, { concurrency: 3 });

  assert.notEqual(ran.code, 0, ran.out);
  for (const claimed of [10, 20, 30]) assert.match(ran.err, new RegExp(`claimed #${claimed}\\b`), ran.err);
  assert.doesNotMatch(ran.err, /#40\b/, ran.err);
});

/** Two ready cards L2 would dispatch, oldest first #10, #20. */
const TWO_READY = { items: [card(20, 'Ready'), card(10, 'Ready')] };

test('run, given N 3 and two pullable cards, claims both', async () => {
  const ran = run(TWO_READY, { concurrency: 3 });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Coding' }, ran.err);
});

test('run, given N 3 and two pullable cards, exits non-zero naming both', () => {
  const ran = run(TWO_READY, { concurrency: 3 });

  assert.notEqual(ran.code, 0, ran.out);
  assert.match(ran.err, /claimed #10\b/, ran.err);
  assert.match(ran.err, /claimed #20\b/, ran.err);
});

/** No pullable card: #18 sits in Backlog and #19 in Done, so neither is offered to L2. */
const NONE_PULLABLE = { items: [card(18, 'Backlog'), card(19, 'Done')] };

test('run over a board with no pullable card claims nothing, and prints that no card was pullable', async () => {
  const ran = run(NONE_PULLABLE, { concurrency: 3 });

  assert.match(ran.out, /no card was pullable/, ran.err);
  assert.deepEqual(await columnsOf(ran), { 18: 'Backlog', 19: 'Done' });
  assert.deepEqual((await ran.model()).writes(), []);
});

test('run over a board with no pullable card exits 0', () => {
  const ran = run(NONE_PULLABLE, { concurrency: 3 });

  assert.equal(ran.code, 0, ran.err);
});

test('run names each claimed card, its workspace and its maker\'s outcome', () => {
  const ran = run(TWO_READY, { concurrency: 3 });

  for (const claimed of [10, 20]) {
    const line = ran.err.split('\n').find((held) => new RegExp(`#${claimed}\\b`).test(held));
    assert.ok(line, ran.err);
    assert.ok(line.includes(join(dirname(realpathSync(ran.consumer)), 'widgets-worktrees', `rigger-${claimed}`)), line);
    assert.match(line, new RegExp(`; its maker exited 0 and opened no pull request from rigger-${claimed}, in its workspace, `), ran.err);
  }
});

/** A ready card L2 refuses: its body holds no acceptance, so the form check refuses it. */
const REFUSED = card(11, 'Ready', { body: 'Why this matters, and nothing more.' });

test('run, given a ready card L2 refuses, leaves it in the ready column', async () => {
  const ran = run({ items: [REFUSED, card(12, 'Ready')] }, { concurrency: 3 });

  assert.deepEqual(await columnsOf(ran), { 11: 'Ready', 12: 'Coding' }, ran.err);
});

// proves R-CARD-7
test('run, given a ready card L2 refuses, names the card and the reason', () => {
  const ran = run({ items: [REFUSED, card(12, 'Ready')] }, { concurrency: 3 });

  const line = ran.err.split('\n').find((held) => /#11\b/.test(held));
  assert.ok(line, ran.err);
  assert.match(line, /missing acceptance/, ran.err);
});

test('run dispatches each card\'s selected steps and its maker: the agent CLI runs once per claimed card, and every L1 dispatch event is a step\'s or the maker\'s', async () => {
  const ran = run(FOUR_READY, { concurrency: 3 });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Coding', 30: 'Coding', 40: 'Ready' }, ran.err);
  assert.deepEqual(ran.agentRuns().map((args) => /\/rigger-(\d+)\/\.claude\/agents\/engineer\.md$/.exec(args)?.[1]).sort(), ['10', '20', '30']);
  const events = eventsOf(ran);
  assert.ok(events.length > 0, 'the run recorded events');
  assert.deepEqual(events.filter((event) => event.layer === 'L1' && event.dispatch !== undefined && !events.some((named) => named.layer === 'L3' && named.event === 'dispatch' && named.dispatch === event.dispatch && (typeof named.step === 'string' || (named.role === 'engineer' && named.tier === 'standard')))), []);
});

test('run never holds more claims than N, as derived from the events it wrote', () => {
  // Four pullable cards under N 3 and under N 1: the pulls and releases L3 recorded, replayed in
  // order, never hold more slots than the N each config declares.
  const three = run(FOUR_READY, { concurrency: 3 });
  const one = run(FOUR_READY, { concurrency: 1 });

  assert.equal(mostHeld(eventsOf(three)), 3, three.err);
  assert.equal(mostHeld(eventsOf(one)), 1, one.err);
});

test('each card run claims from the ready column has one L2 transition event from ready into coding', () => {
  const ran = run(FOUR_READY, { concurrency: 3 });

  // By card: L3 moves the cards it claims at once, so each move's event is recorded as it ends.
  assert.deepEqual(transitionsIn(eventsOf(ran)).sort((one, other) => one.card - other.card), [
    { card: 10, from: 'ready', to: 'coding' },
    { card: 20, from: 'ready', to: 'coding' },
    { card: 30, from: 'ready', to: 'coding' },
  ], ran.err);
});

/** No ready card, and one unclaimed card in coding and one in review that L2 would dispatch, under N 3. */
const REDOS_ONLY = { items: [card(50, 'Coding'), card(60, 'Review')] };

test('run, given N 3, no ready card, and an unclaimed coding card and an unclaimed review card L2 would dispatch, claims both', () => {
  const ran = run(REDOS_ONLY, { concurrency: 3 });

  assert.match(ran.err, /claimed #50\b/, ran.err);
  assert.match(ran.err, /claimed #60\b/, ran.err);
  assert.notEqual(ran.code, 0);
});

test('run, given N 3, no ready card, and an unclaimed coding card and an unclaimed review card L2 would dispatch, the forge holding nothing for either, moves the review card to coding and leaves the coding card unmoved in the fake board\'s write record', async () => {
  const ran = run(REDOS_ONLY, { concurrency: 3 });

  assert.match(ran.err, /claimed #50\b/, ran.err);
  assert.deepEqual(await movesOf(ran), [['item-2', 'Coding']]);
  assert.deepEqual(await columnsOf(ran), { 50: 'Coding', 60: 'Coding' });
});

test('run, given N 3, no ready card, and an unclaimed coding card and an unclaimed review card L2 would dispatch, the forge holding nothing for either, records one L2 transition event in the state directory\'s stream, for #60, from review to coding', () => {
  const ran = run(REDOS_ONLY, { concurrency: 3 });

  assert.match(ran.err, /claimed #50\b/, ran.err);
  const events = eventsOf(ran);
  for (const redo of [50, 60]) assert.ok(events.some((event) => event.layer === 'L3' && event.event === 'pull' && event.card === redo), JSON.stringify(events));
  assert.deepEqual(events.filter((event) => event.layer === 'L2' && event.event === 'transition').map(({ card, from, to }) => ({ card, from, to })), [{ card: 60, from: 'review', to: 'coding' }]);
  assert.deepEqual(events.filter((event) => event.layer === 'L2' && event.event !== 'transition').map(({ event, card }) => ({ event, card })).sort((one, other) => one.card - other.card), [{ event: 'review.withheld', card: 50 }, { event: 'review.withheld', card: 60 }]);
});

test('after run exits, the state directory holds the event stream and L1\'s record of process groups', () => {
  const ran = run(FOUR_READY, { concurrency: 3 });

  assert.match(ran.err, /claimed #10\b/, ran.err);
  assert.deepEqual(readdirSync(join(ran.consumer, '.rigger')).sort(), ['events.jsonl', 'groups.json']);
});

test('given a board with no ready card, a second run claims the cards the first left in the coding column', async () => {
  // The first run claims #10 and #20 from Ready and leaves them in Coding, in memory only, so
  // the second reads a board with no Ready card and two unclaimed Coding cards L2 would dispatch.
  const first = run(TWO_READY, { concurrency: 3 });
  assert.deepEqual(await columnsOf(first), { 10: 'Coding', 20: 'Coding' }, first.err);

  const second = first.again();

  assert.match(second.err, /claimed #10\b/, second.err);
  assert.match(second.err, /claimed #20\b/, second.err);
  assert.notEqual(second.code, 0);
});

test('given a board with no ready card, a second run writes no L2 transition event for the cards the first left in the coding column', async () => {
  const first = run(TWO_READY, { concurrency: 3 });
  assert.deepEqual(await columnsOf(first), { 10: 'Coding', 20: 'Coding' }, first.err);
  const before = transitionsIn(eventsOf(first));
  assert.equal(before.length, 2, JSON.stringify(before));

  const second = first.again();

  assert.match(second.err, /claimed #10\b/, second.err);
  assert.deepEqual(transitionsIn(eventsOf(second)), before);
  // By item: L3 moves the cards it claims at once, so the board takes the moves in either order.
  assert.deepEqual((await movesOf(second)).sort(([one], [other]) => one.localeCompare(other)), [['item-1', 'Coding'], ['item-2', 'Coding']]);
});

// proves R-SAFE-5
test('run run against the source tree it is running from exits non-zero, names R-SAFE-5, and claims nothing', async () => {
  // The consumer's repository stands as the package too, so the two are one tree. Git alone may be
  // asked, because naming the tree is the refusal's own work. The verb runs in this process, so
  // the fake `gh`, holding a card the verb would claim, is put first on this process's PATH for
  // the call: every forge command the verb might run reaches it and is recorded there, so a
  // board read or a move shows as a call, and never reaches the real `gh`.
  const consumer = consumerRepository(3);
  const dir = temporaryDirectory('rigger-run-gh-');
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: [card(10, 'Ready')] } });
  const asked = (command, args) => {
    if (command === 'git') return spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
    throw new Error(`run ran \`${command}\` before refusing`);
  };

  const inherited = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${inherited}`;
  let ran;
  try {
    ran = await runVerb({ target: consumer, packageRoot: consumer, ask: asked });
  } finally {
    process.env.PATH = inherited;
  }

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /R-SAFE-5/);
  assert.deepEqual(fake.sent(), []);
  assert.deepEqual(await columnsOf({ model: fake.model }), { 10: 'Ready' });
  assert.ok(!existsSync(join(consumer, '.rigger')), 'no state directory was opened');
});

// The halt: with the record refusing, `run` starts nothing and says loudly what went unrecorded
// (`ARCHITECTURE.md`, "Failure model").

test('given an event stream that refuses every append from the start, run exits non-zero', () => {
  const ran = run(TWO_READY, { concurrency: 3, record: 'refusing' });

  assert.notEqual(ran.code, 0, ran.out);
});

// proves R-RECORD-9
test('given an event stream that refuses every append from the start, run leaves every card in the ready column', async () => {
  const ran = run(TWO_READY, { concurrency: 3, record: 'refusing' });

  assert.deepEqual(await columnsOf(ran), { 10: 'Ready', 20: 'Ready' }, ran.err);
  assert.deepEqual(await movesOf(ran), []);
});

test('given an event stream that refuses every append from the start, run says in a line of its own each card it did not start, and the sink\'s error', () => {
  const ran = run(TWO_READY, { concurrency: 3, record: 'refusing' });

  for (const number of [10, 20]) {
    const line = ran.err.split('\n').find((held) => new RegExp(`#${number}\\b`).test(held));
    assert.ok(line, ran.err);
    assert.match(line, /^rigger run: /);
    assert.match(line, /not started/);
    assert.match(line, /EISDIR/, 'the sink\'s own error is named');
  }
});

test('given the board takes a claim move and the sink then refuses its transition event, run exits non-zero', async () => {
  const ran = run({ items: [card(10, 'Ready')] }, { concurrency: 3, record: 'refusing-after-move' });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding' }, 'the board took the move');
  assert.notEqual(ran.code, 0, ran.out);
});

// proves R-RECORD-9
test('given the board takes a claim move and the sink then refuses its transition event, run names the card, the column left, the column entered, and says the move went unrecorded', async () => {
  const ran = run({ items: [card(10, 'Ready')] }, { concurrency: 3, record: 'refusing-after-move' });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding' }, 'the board took the move');
  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.err);
  assert.match(line, /^rigger run: /);
  assert.match(line, /from ready to coding/);
  assert.match(line, /refused to record/, 'the move went unrecorded');
  assert.match(line, /EISDIR/, 'the sink\'s own error is named');
});

test('--help\'s line for run says it claims cards, provisions their workspaces and dispatches their makers', () => {
  const shown = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });

  assert.equal(shown.status, 0, shown.stderr);
  const line = shown.stdout.split('\n').find((held) => /^\s*run\b/.test(held));
  assert.ok(line, shown.stdout);
  assert.match(line, /claim cards until the slots are full, provision their workspaces and dispatch their makers, then exit/, line);
  assert.doesNotMatch(line, /before M4/, line);
});

// The maker, dispatched through L1 to the stand-in agent, for each outcome form `run` prints (#486).

/**
 * Runs the real bin's `run` in a consumer's repository holding `settings` and `files`, its main
 * line on `main`, with a local bare `origin` beside it, the stand-in agent `agent` first on PATH,
 * then a fake `gh` holding `board` over that `origin`. Answers what `run` printed and exited, the
 * consumer, and the fake.
 */
function runWithAgent(agent, board, { settings = config(3), files = {} } = {}) {
  const directory = temporaryDirectory('rigger-run-maker-');
  const consumer = repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n`, ...files });
  gitIn(consumer, 'branch', '-M', 'main');
  const origin = join(directory, 'origin.git');
  withOrigin(consumer, origin);
  const dir = temporaryDirectory('rigger-run-maker-gh-');
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board }, origin });
  const ran = spawnRun(consumer, { ...process.env, PATH: [agent.dir, dir, process.env.PATH].join(delimiter) });
  return { ...ran, consumer, fake };
}

/** The line `run` prints for card `number` claimed from the consumer's board, with `outcome` and the workspace at its end. */
const makerLine = (consumer, number, outcome) => `rigger run: claimed #${number} from board ${PROJECT}; ${outcome}, in its workspace, ${join(dirname(realpathSync(consumer)), 'widgets-worktrees', `rigger-${number}`)}`;

test('given run over a fake board with one ready card and a stand-in maker exiting 0 with no pull request, run prints one line for the card in the verbs\' form, and exits non-zero', SETTLES_WITHIN, () => {
  const ran = runWithAgent(standInAgent(), { items: [card(10, 'Ready')] });

  assert.notEqual(ran.code, 0, ran.out);
  assert.deepEqual(ran.err.split('\n').filter((line) => /#10\b/.test(line)), [makerLine(ran.consumer, 10, 'its maker exited 0 and opened no pull request from rigger-10')]);
});

test('given run where the stand-in maker exits 0 and opens a pull request on the fake forge, the card ends in Review, run prints that it is in review naming the pull request, and exits 0', SETTLES_WITHIN, async () => {
  // The kind's only judge is the owner, so no later card's judges reach this card.
  const settings = { ...config(3), kinds: { change: { ...KINDS.change, judges: ['owner'] } } };
  const ran = runWithAgent(standInAgent({ 10: { engineer: { pr: true } } }), { items: [card(10, 'Ready')] }, { settings });

  assert.equal(ran.code, 0, ran.err);
  const columns = Object.fromEntries((await (await ran.fake.model()).operations.readItems()).map((item) => [item.number, item.column]));
  assert.deepEqual(columns, { 10: 'Review' });
  assert.deepEqual(ran.out.split('\n').filter((line) => /#10\b/.test(line)), [makerLine(ran.consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review')]);
});

test('given run where the maker exits non-zero, run exits non-zero, and prints the card and the exit code', SETTLES_WITHIN, () => {
  const ran = runWithAgent(standInAgent({ 10: { engineer: { exit: 4 } } }), { items: [card(10, 'Ready')] });

  assert.notEqual(ran.code, 0, ran.out);
  assert.deepEqual(ran.err.split('\n').filter((line) => /#10\b/.test(line)), [makerLine(ran.consumer, 10, 'its maker exited 4')]);
});

test('given run where the maker does not start, run exits non-zero, and prints the card and why', SETTLES_WITHIN, () => {
  // A settings file the Claude Code adapter cannot read, committed so the workspace holds it.
  const agent = standInAgent();
  const ran = runWithAgent(agent, { items: [card(10, 'Ready')] }, { files: { '.claude/settings.json': 'not json' } });

  assert.notEqual(ran.code, 0, ran.out);
  const lines = ran.err.split('\n').filter((line) => /#10\b/.test(line));
  assert.equal(lines.length, 1, ran.err);
  assert.match(lines[0], /^rigger run: claimed #10 from board 3; its maker did not start: .*settings\.json is no JSON/);
  assert.deepEqual(agent.runs(), []);
});

test('the agent CLI stand-in, once installed, has recorded no run, and its directory holds only itself', () => {
  const dir = temporaryDirectory('rigger-warming-agent-');

  const agent = installAgentCli(dir);

  assert.deepEqual(agent.runs(), []);
  assert.deepEqual(readdirSync(dir).sort(), ['claude']);
});
