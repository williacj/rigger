// ABOUTME: Tests `rigger run`: the real bin run in a consumer's repository with the fake `gh` first
// on PATH, claiming through L3's claim-only call until the slots are full, dispatching nothing,
// saying so, and refusing its own source tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { run as runVerb } from '../src/cli/run.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryIn } from './git-repository.mjs';

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

/** The consumer's config: the template's, with its repository, its board and N filled in. */
const config = (concurrency) => ({ ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency });

/** A consumer's repository holding that config. */
const consumerRepository = (concurrency) => repositoryIn('rigger-run-', { 'rigger.config.mjs': `export default ${JSON.stringify(config(concurrency))};\n` });

/**
 * A stand-in for the agent CLI every role in the template's config dispatches through, placed in
 * `dir`, which records each run beside itself. A dispatch in M2 and M4 runs the provider's CLI,
 * so a run of it is what a started dispatch would show.
 */
function installAgentCli(dir) {
  const record = join(dir, 'agent-runs');
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "\${0%/*}/agent-runs"\nexit 0\n`);
  chmodSync(join(dir, 'claude'), 0o755);
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
 * repository and the same fake board, as the board stands after the first.
 */
function run(board, { concurrency }) {
  const consumer = consumerRepository(concurrency);
  const dir = mkdtempSync(join(tmpdir(), 'rigger-run-gh-'));
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board } });
  const agent = installAgentCli(dir);
  const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` };
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

test('run says each claimed card was not worked because dispatch arrives with M2 and M4', () => {
  const ran = run(TWO_READY, { concurrency: 3 });

  for (const claimed of [10, 20]) {
    const line = ran.err.split('\n').find((held) => new RegExp(`#${claimed}\\b`).test(held));
    assert.ok(line, ran.err);
    assert.match(line, /not worked/, ran.err);
    assert.match(line, /dispatch arrives with M2 and M4/, ran.err);
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

test('run starts no dispatch: the agent CLI is never run, and no event arises under a dispatch or from L1', async () => {
  const ran = run(FOUR_READY, { concurrency: 3 });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Coding', 30: 'Coding', 40: 'Ready' }, ran.err);
  assert.deepEqual(ran.agentRuns(), []);
  const events = eventsOf(ran);
  assert.ok(events.length > 0, 'the run recorded events');
  assert.deepEqual(events.filter((event) => event.layer === 'L1' || event.dispatch !== undefined), []);
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

  assert.deepEqual(transitionsIn(eventsOf(ran)), [
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

test('run, given N 3, no ready card, and an unclaimed coding card and an unclaimed review card L2 would dispatch, leaves no move of either in the fake board\'s write record', async () => {
  const ran = run(REDOS_ONLY, { concurrency: 3 });

  assert.match(ran.err, /claimed #50\b/, ran.err);
  assert.deepEqual(await movesOf(ran), []);
  assert.deepEqual(await columnsOf(ran), { 50: 'Coding', 60: 'Review' });
});

test('run, given N 3, no ready card, and an unclaimed coding card and an unclaimed review card L2 would dispatch, leaves no L2 transition event in the state directory\'s stream', () => {
  const ran = run(REDOS_ONLY, { concurrency: 3 });

  assert.match(ran.err, /claimed #50\b/, ran.err);
  const events = eventsOf(ran);
  for (const redo of [50, 60]) assert.ok(events.some((event) => event.layer === 'L3' && event.event === 'pull' && event.card === redo), JSON.stringify(events));
  assert.deepEqual(events.filter((event) => event.layer === 'L2'), []);
});

test('after run exits, the state directory holds nothing but the event stream', () => {
  const ran = run(FOUR_READY, { concurrency: 3 });

  assert.match(ran.err, /claimed #10\b/, ran.err);
  assert.deepEqual(readdirSync(join(ran.consumer, '.rigger')), ['events.jsonl']);
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
  assert.deepEqual(await movesOf(second), [['item-2', 'Coding'], ['item-1', 'Coding']]);
});

// proves R-SAFE-5
test('run run against the source tree it is running from exits non-zero, names R-SAFE-5, and claims nothing', async () => {
  // The consumer's repository stands as the package too, so the two are one tree. Git alone may be
  // asked, because naming the tree is the refusal's own work. Every forge call goes through
  // `send`, which records rather than answers, so a board read or a move shows as a call.
  const consumer = consumerRepository(3);
  const asked = (command, args) => {
    if (command === 'git') return spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
    throw new Error(`run ran \`${command}\` before refusing`);
  };
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args].join(' '));
    return { status: 1, stdout: '', stderr: 'no board here' };
  };

  const ran = await runVerb({ target: consumer, packageRoot: consumer, ask: asked, send });

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /R-SAFE-5/);
  assert.deepEqual(sent, []);
  assert.ok(!existsSync(join(consumer, '.rigger')), 'no state directory was opened');
});

test('--help\'s line for run says it dispatches no work before M4', () => {
  const shown = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });

  assert.equal(shown.status, 0, shown.stderr);
  const line = shown.stdout.split('\n').find((held) => /^\s*run\b/.test(held));
  assert.ok(line, shown.stdout);
  assert.match(line, /dispatches no work before M4/, line);
});
