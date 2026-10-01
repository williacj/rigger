// ABOUTME: Tests `rigger once`: the real bin run in a consumer's repository with the fake `gh` first
// on PATH, claiming one card through L3's single pull, making and provisioning its workspace,
// dispatching no maker, saying so, and refusing its own source tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { once as onceVerb } from '../src/cli/once.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh, installGhRefusingStreamAfterMove } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';

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
  const directory = mkdtempSync(join(tmpdir(), 'rigger-once-'));
  return withOrigin(repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(config())};\n` }), join(directory, 'origin.git'));
};

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
  const dir = mkdtempSync(join(tmpdir(), 'rigger-once-gh-'));
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board } });
  const agent = installAgentCli(dir);
  const stream = join(consumer, '.rigger', 'events.jsonl');
  if (record === 'refusing') mkdirSync(stream, { recursive: true });
  const ahead = record === 'refusing-after-move' ? [dirname(installGhRefusingStreamAfterMove(mkdtempSync(join(tmpdir(), 'rigger-once-wrap-')), fake.gh, stream))] : [];
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

test('once names the card it claimed and its workspace, and says no maker runs before M4', () => {
  const ran = once({ items: [card(10, 'Ready')] });

  const line = ran.err.split('\n').find((held) => /#10\b/.test(held));
  assert.ok(line, ran.err);
  assert.ok(line.includes(join(dirname(realpathSync(ran.consumer)), 'widgets-worktrees', 'rigger-10')), line);
  assert.match(line, /no maker runs before M4/, line);
});

test('once exits non-zero after claiming a card it did not work', async () => {
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

test('once dispatches the card\'s selected steps and no maker: the agent CLI is never run, and every L1 dispatch event names a step', async () => {
  const ran = once({ items: [card(10, 'Ready'), card(20, 'Ready')] });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Ready' }, ran.err);
  assert.deepEqual(ran.agentRuns(), []);
  const events = eventsOf(ran);
  assert.ok(events.length > 0, 'the run recorded events');
  assert.deepEqual(events.filter((event) => event.layer === 'L1' && event.dispatch !== undefined && !events.some((named) => named.layer === 'L3' && named.event === 'dispatch' && named.dispatch === event.dispatch && typeof named.step === 'string')), []);
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

test('once, given N 3, an unclaimed review card L2 would dispatch and a ready card L2 would dispatch, leaves no move of either in the fake board\'s write record', async () => {
  const ran = once(REDO_AND_READY);

  assert.match(ran.err, /claimed #40\b/, ran.err);
  assert.deepEqual(await movesOf(ran), []);
  assert.deepEqual(await columnsOf(ran), { 30: 'Ready', 40: 'Review' });
});

test('once, given N 3, an unclaimed review card L2 would dispatch and a ready card L2 would dispatch, leaves no L2 transition event in the state directory\'s stream', () => {
  const ran = once(REDO_AND_READY);

  assert.match(ran.err, /claimed #40\b/, ran.err);
  const events = eventsOf(ran);
  assert.ok(events.some((event) => event.layer === 'L3' && event.event === 'pull' && event.card === 40), JSON.stringify(events));
  assert.deepEqual(events.filter((event) => event.layer === 'L2'), []);
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

test('--help\'s line for once says it dispatches no maker before M4', () => {
  const shown = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });

  assert.equal(shown.status, 0, shown.stderr);
  const line = shown.stdout.split('\n').find((held) => /^\s*once\b/.test(held));
  assert.ok(line, shown.stdout);
  assert.match(line, /dispatches no maker before M4/, line);
});
