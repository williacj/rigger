// ABOUTME: Tests `rigger run`: the real bin run in a consumer's repository with the fake `gh` first
// on PATH, draining through L3's freed-slot pulls, making and provisioning each
// claimed card's workspace, dispatching its maker, printing its outcome, and refusing its own source tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { refuseAfterBoardRead } from './call-event-fixtures.mjs';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run as runVerb } from '../src/cli/run.mjs';
import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { installFakeGh, installGhRefusingStreamAfterMove, seedRepository } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { gitIn } from './git-repository.mjs';
import { standInAgent } from './stub-claude.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { EXIT_IF_WARMING, warmed } from './process-fixtures.mjs';
import { admissionOf, closerText, seed, TIME } from './admission-world.mjs';
import { COLUMNS, FIELDS, KINDS, PROJECT, REFUSED, REPO, card, consumerConfig } from './verb-consumer.mjs';
import { assertPushEnd, held as heldStream } from './push-fixtures.mjs';
import { markerComment } from './fake-repository.mjs';
import { fixture, shellQuote } from './process-fixtures.mjs';

// A bound on a test that waits on the real bin and its maker, so one that never settles fails here.
const { 60_000: SETTLES_WITHIN } = BOUNDS;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The consumer's config: the template's, with its repository, its board and N filled in, and kinds listing no provisioning. */
const config = (concurrency) => consumerConfig(concurrency);

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
  const env = { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), PATH: [...ahead, dir, process.env.PATH].join(delimiter) };
  // The board wrapper arms refusal; all reads finish before the pull start attempts its append.
  if (record === 'refusing-after-board-read') env.NODE_OPTIONS = refuseAfterBoardRead(temporaryDirectory('rigger-run-board-refusal-'), fake.gh, stream);
  const shared = { consumer, model: fake.model, agentRuns: agent.runs, fake };
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
 * The most slots L3 held at once: each release pairs with its card's latest pull, and a pull
 * with no matching release contributes no held interval, as for a merge claim.
 */
function mostHeld(events) {
  const pulls = new Map();
  const deltas = new Map();
  for (const [at, event] of events.entries()) {
    if (event.layer !== 'L3') continue;
    if (event.event === 'pull') pulls.set(event.card, at);
    if (event.event === 'slot.release' && pulls.has(event.card)) {
      deltas.set(pulls.get(event.card), 1);
      deltas.set(at, -1);
      pulls.delete(event.card);
    }
  }
  let held = 0;
  let most = 0;
  for (const [at] of events.entries()) {
    held += deltas.get(at) ?? 0;
    most = Math.max(most, held);
  }
  return most;
}

/** Four ready cards L2 would dispatch, oldest first #10, #20, #30, #40. */
const FOUR_READY = { items: [card(30, 'Ready'), card(10, 'Ready'), card(40, 'Ready'), card(20, 'Ready')] };

test('run, given N 1 and four pullable cards, drains all four into the coding column', async () => {
  const ran = run(FOUR_READY, { concurrency: 1 });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Coding', 30: 'Coding', 40: 'Coding' }, ran.err);
});

test('run, given N 1 and four pullable cards, exits non-zero naming all four claimed cards', () => {
  const ran = run(FOUR_READY, { concurrency: 1 });

  assert.notEqual(ran.code, 0, ran.out);
  assert.match(ran.err, /claimed #10\b/, ran.err);
  for (const other of [20, 30, 40]) assert.match(ran.err, new RegExp(`claimed #${other}\\b`), ran.err);
});

test('run, given N 3 and four pullable cards, drains all four into the coding column', async () => {
  const ran = run(FOUR_READY, { concurrency: 3 });

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Coding', 30: 'Coding', 40: 'Coding' }, ran.err);
});

test('run, given N 3 and four pullable cards, exits non-zero naming all four claimed cards', () => {
  const ran = run(FOUR_READY, { concurrency: 3 });

  assert.notEqual(ran.code, 0, ran.out);
  for (const claimed of [10, 20, 30]) assert.match(ran.err, new RegExp(`claimed #${claimed}\\b`), ran.err);
  assert.match(ran.err, /claimed #40\b/, ran.err);
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

// proves R-SCHED-3, R-SCHED-16
test('run under a hold closer names its reason and time, keeps L2 refusals and exits 0 without another claim', async () => {
  const first = run({ items: [REFUSED, card(12, 'Ready')] }, { concurrency: 1 });
  const writes = (await first.model()).writes();
  const agents = first.agentRuns().length;
  seed(join(first.consumer, '.rigger'), 'hold-c3-issue-7.json', closerText({ reason: 'environment hold' }));
  seedRepository(first.fake, { issues: [{ number: 7, title: 'Rigger closed admission', body: 'Why.\n\nHold: `c3`\n', labels: ['rigger:status'] }] });
  const ran = first.again();

  assert.equal(ran.code, 0, ran.err);
  assert.match(ran.out, new RegExp(`admission is closed by hold: environment hold; time ${TIME}`), ran.out);
  assert.match(ran.out, /#11.*missing acceptance/, ran.out);
  assert.doesNotMatch(ran.out, /no card was pullable/, ran.out);
  assert.deepEqual((await ran.model()).writes(), [...writes, { operation: 'addIssue', args: [7, REPO] }, { operation: 'moveItem', args: ['item-3', 'Owner'] }]);
  assert.equal(ran.agentRuns().length, agents);
  assert.deepEqual(await columnsOf(ran), { 7: 'Owner', 11: 'Ready', 12: 'Coding' });
});

// proves R-SCHED-3, R-SCHED-16
test('run under unreadable admission names every path and cause, keeps L2 refusals and exits non-zero', async () => {
  const first = run({ items: [REFUSED, card(12, 'Ready')] }, { concurrency: 1 });
  const writes = (await first.model()).writes();
  const agents = first.agentRuns().length;
  const state = join(first.consumer, '.rigger');
  seed(state, 'not-a-closer');
  seed(state, 'owner-b2.json', '{}');
  const ran = first.again();
  const directory = admissionOf(state);

  assert.notEqual(ran.code, 0, ran.out);
  assert.ok(ran.err.includes(`${directory}/not-a-closer (no closer form)`), ran.err);
  assert.ok(ran.err.includes(`${directory}/owner-b2.json (no reason, time or run)`), ran.err);
  assert.match(ran.err, /#11.*missing acceptance/, ran.err);
  assert.doesNotMatch(ran.err, /no card was pullable/, ran.err);
  assert.deepEqual((await ran.model()).writes(), writes);
  assert.equal(ran.agentRuns().length, agents);
  assert.deepEqual(await columnsOf(ran), { 11: 'Ready', 12: 'Coding' });
});

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

  assert.deepEqual(await columnsOf(ran), { 10: 'Coding', 20: 'Coding', 30: 'Coding', 40: 'Coding' }, ran.err);
  assert.deepEqual(ran.agentRuns().map((args) => /\/rigger-(\d+)\/\.claude\/agents\/engineer\.md$/.exec(args)?.[1]).sort(), ['10', '20', '30', '40']);
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
    { card: 40, from: 'ready', to: 'coding' },
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
  assert.match(ran.err, /call\.end/);
  assert.match(ran.err, /EISDIR/);
});

test('given an event stream that refuses every append after the board read, run says in a line of its own each card it did not start, and the sink\'s error', () => {
  const ran = run(TWO_READY, { concurrency: 3, record: 'refusing-after-board-read' });

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

test('--help\'s line for run says it claims cards and dispatches their makers until the board drains, or, while a clock trigger is declared, until stopped', () => {
  const shown = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });

  assert.equal(shown.status, 0, shown.stderr);
  const line = shown.stdout.split('\n').find((held) => /^\s*run\b/.test(held));
  assert.ok(line, shown.stdout);
  assert.match(line, /claim cards and dispatch their makers until the board drains, or, while a clock trigger is declared, until stopped/, line);
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
  const ran = spawnRun(consumer, { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), PATH: [agent.dir, dir, process.env.PATH].join(delimiter) });
  return { ...ran, consumer, fake };
}

/** The line `run` prints for card `number` claimed from the consumer's board, with `outcome` and the workspace at its end. */
const makerLine = (consumer, number, outcome) => `rigger run: claimed #${number} from board ${PROJECT}; ${outcome}, in its workspace, ${join(dirname(realpathSync(consumer)), 'widgets-worktrees', `rigger-${number}`)}`;

test('given run over a fake board with one ready card and a stand-in maker exiting 0 with no pull request, run prints one line for the card in the verbs\' form, and exits non-zero', SETTLES_WITHIN, () => {
  const ran = runWithAgent(standInAgent(), { items: [card(10, 'Ready')] });

  assert.notEqual(ran.code, 0, ran.out);
  assert.deepEqual(ran.err.split('\n').filter((line) => /#10\b/.test(line)), [makerLine(ran.consumer, 10, 'its maker exited 0 and opened no pull request from rigger-10')]);
});

test('given run where the stand-in maker opens a pull request with only an owner judge, run prints Review then Owner and exits 0', SETTLES_WITHIN, async () => {
  // The kind's only judge is the owner, so no later card's judges reach this card.
  const settings = { ...config(3), kinds: { change: { ...KINDS.change, judges: ['owner'] } } };
  const ran = runWithAgent(standInAgent({ 10: { engineer: { pr: true } } }), { items: [card(10, 'Ready')] }, { settings });

  assert.equal(ran.code, 0, ran.err);
  const columns = Object.fromEntries((await (await ran.fake.model()).operations.readItems()).map((item) => [item.number, item.column]));
  assert.deepEqual(columns, { 10: 'Owner' });
  assert.deepEqual(ran.out.split('\n').filter((line) => /#10\b/.test(line)), [makerLine(ran.consumer, 10, 'its maker exited 0 and pull request #11 is open from rigger-10, so the card is in review'), 'rigger run: card #10 moved to owner']);
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
  const lines = ran.err.split('\n').filter((line) => /#10\b/.test(line) && !line.startsWith('rigger run: admission is closed by hold: '));
  assert.equal(lines.length, 1, ran.err);
  assert.equal(ran.err.split('\n').filter((line) => line.startsWith('rigger run: admission is closed by hold: card #10 ')).length, 1, ran.err);
  assert.match(lines[0], /^rigger run: claimed #10 from board 3; its maker did not start: .*settings\.json is no JSON/);
  assert.deepEqual(agent.runs(), []);
  const attempts = ran.err.split('\n').filter((line) => /^attempt [12]: /.test(line));
  assert.deepEqual(attempts.map((line) => /^attempt (\d+): /.exec(line)?.[1]), ['1', '2']);
  assert.ok(attempts.every((line) => /settings\.json is no JSON/.test(line)), ran.err);
});

// The judges, dispatched through L1 to the stand-in agent under each card's one claim (#490).

/** The line `run` prints for card `number`'s judge `role`, saying `outcome`. */
const judgeLine = (number, role, outcome) => `rigger run: card #${number}'s judge \`${role}\` ${outcome}`;

/** The line `run` prints for card `number` whose maker opened a pull request, which put it in review, whatever that pull request's number. */
const reviewLine = (consumer, number) => new RegExp(`^rigger run: claimed #${number} from board ${PROJECT}; its maker exited 0 and pull request #\\d+ is open from rigger-${number}, so the card is in review, in its workspace, ${join(dirname(realpathSync(consumer)), 'widgets-worktrees', `rigger-${number}`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** A stand-in plan under which each of `cards`' makers opens a pull request and its reviewer writes its findings. */
const reviewed = (cards) => Object.fromEntries(cards.map((number) => [number, { engineer: { pr: true }, reviewer: { findings: true } }]));

test('given run over three cards where one card\'s required step fails twice, run prints each other card\'s maker and judge lines beside the failing card\'s lines', SETTLES_WITHIN, () => {
  // Only #20 carries the label selecting the step, which always fails, so its two attempts fail
  // before its maker, while #10 and #30 reach their makers and their judges.
  const settings = {
    ...config(3),
    kinds: { ...KINDS, change: { ...KINDS.change, provisioning: ['broken'] } },
    provisioning: { broken: { run: 'exit 1', required: true, select: { labels: ['area:broken'] } } },
  };
  const board = { items: [card(10, 'Ready'), card(20, 'Ready', { labels: ['type:change', 'area:broken'] }), card(30, 'Ready')] };
  const ran = runWithAgent(standInAgent(reviewed([10, 30])), board, { settings });

  assert.notEqual(ran.code, 0, ran.out);
  const lines = ran.err.split('\n');
  for (const number of [10, 30]) {
    assert.ok(lines.some((line) => reviewLine(ran.consumer, number).test(line)), ran.err);
    assert.ok(lines.includes(judgeLine(number, 'reviewer', 'exited 0')), ran.err);
  }
  assert.ok(lines.some((line) => line.startsWith('rigger run: card #20 was held after 2 attempts, each failing before the maker:')), ran.err);
});

test('run drains three cards, dispatching roles for no more cards at once than N, derived from the events it wrote', SETTLES_WITHIN, () => {
  const board = { items: [card(10, 'Ready'), card(20, 'Ready'), card(30, 'Ready')] };
  const ran = runWithAgent(standInAgent(reviewed([10, 20, 30])), board, { settings: config(2) });

  assert.equal(ran.code, 0, ran.err);
  const events = eventsOf(ran);
  assert.equal(events.filter((event) => event.layer === 'L3' && event.event === 'pull').length, 3, JSON.stringify(events));
  assert.equal(mostHeld(events), 2);
  assert.deepEqual(events.filter((event) => event.layer === 'L3' && event.event === 'dispatch').map((event) => event.role).sort(), ['engineer', 'engineer', 'engineer', 'reviewer', 'reviewer', 'reviewer'], 'no judge was dispatched, so the test proves nothing of the judges');
  // Each L1 dispatch.start opens a dispatch for its card and each dispatch.end closes it, in the
  // order recorded; the cards with a dispatch open at once never number more than N.
  const open = new Map();
  let most = 0;
  for (const event of events.filter((each) => each.layer === 'L1' && ['dispatch.start', 'dispatch.end'].includes(each.event))) {
    open.set(event.card, (open.get(event.card) ?? 0) + (event.event === 'dispatch.start' ? 1 : -1));
    most = Math.max(most, [...open.values()].filter((count) => count > 0).length);
  }
  assert.ok(most >= 1 && most <= 2, `${most} cards had a role dispatched at once`);
});

// Cards whose judges are mixed, one handing back beside one whose start event is refused (#612).

/**
 * A module the bin's Node process loads first, through `NODE_OPTIONS`, under which the consumer's
 * event stream refuses the appends alone of L3's `dispatch` events naming judge `role`. It changes
 * `node:fs` itself, and `syncBuiltinESMExports` carries the change to the sink, which imports
 * `appendFileSync` by name, so the sink refuses those appends without knowing it is under test.
 */
function refusingJudgeStart(role) {
  const path = join(temporaryDirectory('rigger-run-refuse-append-'), 'refuse-append.mjs');
  writeFileSync(path, [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const { appendFileSync } = fs;',
    'fs.appendFileSync = (path, data, ...rest) => {',
    "  const event = String(path).endsWith('/.rigger/events.jsonl') ? JSON.parse(String(data)) : {};",
    `  if (event.layer === 'L3' && event.event === 'dispatch' && event.role === ${JSON.stringify(role)}) {`,
    `    throw Object.assign(new Error(\`EACCES: the test refuses L3's dispatch of ${role} on \${path}\`), { code: 'EACCES' });`,
    '  }',
    '  return appendFileSync(path, data, ...rest);',
    '};',
    'syncBuiltinESMExports();',
    '',
  ].join('\n'));
  return path;
}

/**
 * Runs the real bin's `run` as `runWithAgent` does, its `change` kind naming `reviewer` then
 * `architect` as judges at N of `concurrency`, with every L3 start of the architect refused.
 */
function runRefusingArchitect(agent, board, concurrency) {
  const settings = { ...config(concurrency), kinds: { ...KINDS, change: { ...KINDS.change, judges: ['reviewer', 'architect'] } } };
  const directory = temporaryDirectory('rigger-run-mixed-');
  const consumer = repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(settings)};\n` });
  gitIn(consumer, 'branch', '-M', 'main');
  const origin = join(directory, 'origin.git');
  withOrigin(consumer, origin);
  const dir = temporaryDirectory('rigger-run-mixed-gh-');
  installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board }, origin });
  const ran = spawnRun(consumer, { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), NODE_OPTIONS: `--import ${refusingJudgeStart('architect')}`, PATH: [agent.dir, dir, process.env.PATH].join(delimiter) });
  return { ...ran, consumer };
}

test('given run at N of 2 over two cards whose reviewer exits 0 and whose architect\'s start event is refused, run prints each card\'s judge lines under that card, and exits non-zero', SETTLES_WITHIN, () => {
  const agent = standInAgent({ 10: { engineer: { pr: true } }, 20: { engineer: { pr: true } } });
  const ran = runRefusingArchitect(agent, { items: [card(10, 'Ready'), card(20, 'Ready')] }, 2);

  assert.notEqual(ran.code, 0, ran.out);
  const lines = ran.err.split('\n');
  const refused = (number) => judgeLine(number, 'architect', `handed back no outcome: card #${number}'s role \`architect\` was not started, because the event sink refused to record its start: EACCES: the test refuses L3's dispatch of architect on ${join(realpathSync(ran.consumer), '.rigger', 'events.jsonl')}`);
  for (const number of [10, 20]) {
    const claimed = lines.findIndex((line) => reviewLine(ran.consumer, number).test(line));
    assert.ok(claimed >= 0, ran.err);
    assert.deepEqual(lines.slice(claimed + 1, claimed + 3), [judgeLine(number, 'reviewer', 'exited 0'), refused(number)], ran.err);
    assert.equal(lines.filter((line) => line.includes(`card #${number}'s judge`)).length, 2, ran.err);
  }
});

test('the agent CLI stand-in, once installed, has recorded no run, and its directory holds only itself', () => {
  const dir = temporaryDirectory('rigger-warming-agent-');

  const agent = installAgentCli(dir);

  assert.deepEqual(agent.runs(), []);
  assert.deepEqual(readdirSync(dir).sort(), ['claude']);
});

/**
 * Runs the real bin's `run` with N 1 over `board`, in a consumer repository whose config sets
 * `telemetry.push` true, with a local bare `origin` beside it, through `src/cli/verbs.mjs` and so
 * with L5's push as it ships (#1122).
 */
function runPushing(board) {
  const directory = temporaryDirectory('rigger-run-push-');
  const origin = join(directory, 'origin.git');
  const text = `export default ${JSON.stringify({ ...config(1), telemetry: { push: true } })};\n`;
  const consumer = withOrigin(repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': text }), origin);
  const dir = temporaryDirectory('rigger-run-gh-');
  installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...board } });
  installAgentCli(dir);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), PATH: [dir, process.env.PATH].join(delimiter) };
  return { ...spawnRun(consumer, env), consumer, origin };
}

// proves R-RECORD-13
test('C9: run with telemetry.push true, whose board drains so run ends, pushes exactly once, at its return, and not at the drain', () => {
  const ran = runPushing({ items: [card(10, 'Ready')] });
  const said = `exited ${ran.code}: ${ran.out}${ran.err}`;
  const events = eventsOf(ran);
  assert.ok(events.some(({ event }) => event === 'pull'), `${said}: run pulled nothing, so its board never drained`);
  const ends = events.filter(({ event }) => event === 'push.end');
  assert.equal(ends.length, 1, said);
  assert.equal(events.at(-1).event, 'push.end', said);
  assert.doesNotMatch(ran.err, /rigger: the push/, said);
  const tip = gitIn(ran.origin, 'rev-parse', 'refs/rigger/events').trim();
  const pushed = Buffer.from(gitIn(ran.origin, 'cat-file', 'blob', `${tip}:events.jsonl`));
  const before = Buffer.from(events.slice(0, -1).map((event) => `${JSON.stringify(event)}\n`).join(''));
  assert.deepEqual(pushed, heldStream(before), said);
  assertPushEnd(ends[0], { outcome: 'pushed', bytes: pushed.length, commit: tip });
});

// A second Ready card must not be stranded by the CLI's initial slotful pull.
// proves R-SCHED-6
test('a no-clock real-bin run at N one claims the second Ready card after the first releases its slot', SETTLES_WITHIN, () => {
  const agent = standInAgent({ 10: { engineer: { exit: 7 } }, 20: { engineer: { exit: 7 } } });
  const ran = runWithAgent(agent, TWO_READY, { settings: config(1) });
  const events = eventsOf(ran);
  const pulls = events.filter(({ layer, event }) => layer === 'L3' && event === 'pull');

  assert.deepEqual(pulls.map(({ card }) => card), [10, 20], ran.err);
  const released = events.findIndex(({ event, card }) => event === 'slot.release' && card === 10);
  assert.ok(released >= 0 && released < events.indexOf(pulls[1]), 'the second claim follows the first slot release');
  assert.deepEqual(agent.runs().map(({ card }) => card), [10, 20]);
  assert.equal(mostHeld(events), 1);
  assert.equal(ran.code, 1, 'both nonzero maker outcomes remain failures');
  assert.deepEqual([...ran.err.matchAll(/^rigger run: claimed #(\d+) /gm)].map((held) => Number(held[1])), [10, 20], 'outcomes retain claim order across freed-slot pulls');
});

/** Changes the documented stand-in plan after a role runs, keeping a duplicate-dispatch fault finite. */
function afterAgentRun(agent, updates) {
  const program = join(agent.dir, 'claude');
  writeFileSync(program, [
    `#!${process.execPath}`,
    '// ABOUTME: Runs the documented stand-in and changes its next plan to bound a duplicate-dispatch fault.',
    'if (!process.env.RIGGER_FIXTURE_WARMING) {',
    `  const { standInMain } = await import(${JSON.stringify(new URL('./stub-claude.mjs', import.meta.url).href)});`,
    '  await standInMain();',
    "  const { readFileSync, writeFileSync } = await import('node:fs');",
    `  const directory = ${JSON.stringify(agent.dir)};`,
    "  const lines = readFileSync(directory + '/runs.jsonl', 'utf8').trim().split('\\n');",
    '  const last = JSON.parse(lines.at(-1));',
    `  const updates = ${JSON.stringify(updates)};`,
    '  if (Object.hasOwn(updates, last.role)) {',
    "    const plan = JSON.parse(readFileSync(directory + '/plan.json', 'utf8'));",
    '    plan[last.card][last.role] = updates[last.role];',
    "    writeFileSync(directory + '/plan.json', JSON.stringify(plan));",
    '  }',
    '}',
    '',
  ].join('\n'));
  warmed(program);
  return agent;
}

// A judge without a verdict must not occupy each freed slot ahead of a Ready card.
// proves R-SCHED-6
test('a no-clock real-bin run dispatches an unmarked judge once and reaches another Ready card', SETTLES_WITHIN, () => {
  const agent = afterAgentRun(standInAgent({ 10: { engineer: { pr: true }, reviewer: {} }, 20: { engineer: { exit: 7 } } }), { reviewer: { findings: true } });
  const settings = { ...config(1), kinds: { change: { ...KINDS.change, judges: ['reviewer'] } } };
  const ran = runWithAgent(agent, TWO_READY, { settings });

  assert.equal(agent.runs().filter(({ role }) => role === 'reviewer').length, 1, ran.out + ran.err);
  assert.deepEqual(agent.runs().filter(({ role }) => role === 'engineer').map(({ card }) => card), [10, 20]);
  assert.deepEqual(eventsOf(ran).filter(({ event }) => event === 'pull').map(({ card, queueDepth }) => [card, queueDepth]), [[10, 1], [20, 0]], 'the under-claim judge runs once and its repeated answer takes no claim or queue position');
  assert.equal(ran.code, 1, 'the second maker failure is still presented');
});

// A zero-exit maker leaving no PR must not repeat ahead of the next Ready card.
// proves R-SCHED-6
test('a no-clock real-bin run dispatches an unchanged top-level maker once', SETTLES_WITHIN, () => {
  const agent = afterAgentRun(standInAgent({ 10: { engineer: {}, reviewer: { findings: true } }, 20: { engineer: { exit: 7 } } }), { engineer: { pr: true } });
  const settings = { ...config(1), kinds: { change: { ...KINDS.change, judges: ['reviewer'] } } };
  const ran = runWithAgent(agent, TWO_READY, { settings });

  assert.deepEqual(agent.runs().filter(({ role }) => role === 'engineer').map(({ card }) => card), [10, 20], ran.out + ran.err);
  assert.deepEqual(eventsOf(ran).filter(({ event }) => event === 'pull').map(({ card, queueDepth }) => [card, queueDepth]), [[10, 1], [20, 0]], 'the repeated maker answer takes no claim or queue position');
  assert.equal(ran.code, 1, 'the second maker failure is still presented');
});

// L3's merge-pull contract has no matching release; it must not inflate a real drain's slots.
// proves R-SCHED-2, R-SCHED-6
test('a no-clock real-bin run at N three drains four Ready cards and the slot counter pairs only released pulls', SETTLES_WITHIN, () => {
  const numbers = [10, 20, 30, 40];
  const agent = standInAgent(Object.fromEntries(numbers.map((number) => [number, { engineer: { exit: 7 } }])));
  const ran = runWithAgent(agent, FOUR_READY, { settings: config(3) });
  const events = eventsOf(ran);

  assert.deepEqual(agent.runs().filter(({ role }) => role === 'engineer').map(({ card }) => card).sort((a, b) => a - b), numbers, ran.out + ran.err);
  assert.equal(mostHeld(events), 3, 'only pulls paired with a slot release count as held slots');
  // Independent literals from Architecture's L3 pull/slot.release contract: each of these is
  // a merge claim after the maker's release, so none holds a slot despite sharing its card.
  const mergePulls = numbers.map((card) => ({ layer: 'L3', event: 'pull', card, queueDepth: 0, inFlight: 0 }));
  assert.equal(mostHeld([...events, ...mergePulls]), 3, 'slot-free merge pulls add no held interval');
  assert.equal(ran.code, 1, 'the four nonzero maker outcomes remain failures');
});

// A CLI run must use the same single start boundary L3's held-kill controls establish.
// proves R-SCHED-2, R-SCHED-6
test('a no-clock real-bin run at N two records one run.start before its first pull', SETTLES_WITHIN, () => {
  const agent = standInAgent({ 10: { engineer: { exit: 7 } }, 20: { engineer: { exit: 7 } } });
  const ran = runWithAgent(agent, TWO_READY, { settings: config(2) });
  const events = eventsOf(ran).filter(({ layer }) => layer === 'L3');
  assert.deepEqual(events.filter(({ event }) => event === 'run.start').map(({ concurrency }) => concurrency), [2]);
  assert.equal(events[0].event, 'run.start', 'the start precedes every pull trigger and claim');
  assert.deepEqual(events.filter(({ event }) => event === 'pull').map(({ card }) => card), [10, 20]);
  assert.equal(mostHeld(events), 2);
  assert.equal(ran.code, 1);
});

// A nested pull's unrecorded release must retain its outcome beside earlier completed claims.
// proves R-SCHED-6, R-RECORD-9
test('a no-clock real-bin run retains nested failed and successful pull outcomes in claim order and fails despite delivered cards', SETTLES_WITHIN, () => {
  const preload = join(temporaryDirectory('rigger-run-nested-release-'), 'refuse-release.mjs');
  writeFileSync(preload, [
    "// ABOUTME: Refuses one nested card's release record while keeping every other append live.",
    "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';",
    'const append = fs.appendFileSync; let refused = false;',
    "fs.appendFileSync = (path, bytes, ...rest) => { const row = String(path).endsWith('/.rigger/events.jsonl') ? JSON.parse(String(bytes)) : {};",
    "if (!refused && row.layer === 'L3' && row.event === 'slot.release' && row.card === 20) { refused = true; throw new Error('nested release record refused'); }",
    'return append(path, bytes, ...rest); }; syncBuiltinESMExports();',
  ].join('\n'));
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = [previous, `--import=${preload}`].filter(Boolean).join(' ');
  let ran;
  try {
    ran = runWithAgent(standInAgent({ 10: { engineer: { pr: true } }, 20: { engineer: { pr: true } } }), TWO_READY, {
      settings: { ...config(1), kinds: { change: { ...KINDS.change, judges: ['owner'] } } },
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
  assert.equal(ran.code, 1, ran.out + ran.err);
  const lines = ran.err.split('\n');
  const outcomes = lines.filter((line) => /^rigger run: (claimed|card) #/.test(line) && !line.includes('slot was released'));
  assert.equal(outcomes.length, 4, ran.err);
  assert.ok(reviewLine(ran.consumer, 10).test(outcomes[0]), ran.err);
  assert.equal(outcomes[1], 'rigger run: card #10 moved to owner', ran.err);
  assert.ok(reviewLine(ran.consumer, 20).test(outcomes[2]), ran.err);
  assert.equal(outcomes[3], 'rigger run: card #20 moved to owner', ran.err);
  assert.equal(lines.filter((line) => line.includes('nested release record refused')).length, 1, ran.err);
});

// A board emptied over several claims is one idle period, whichever claim ended last.
test('a no-clock real-bin run at N one records one drain trigger once the board drains after two claims', SETTLES_WITHIN, () => {
  const settings = { ...config(1), kinds: { change: { ...KINDS.change, judges: ['owner'] } } };
  const ran = runWithAgent(standInAgent({ 10: { engineer: { pr: true } }, 20: { engineer: { pr: true } } }), TWO_READY, { settings });
  const events = eventsOf(ran).filter(({ layer }) => layer === 'L3');

  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual([...new Set(events.filter(({ event }) => event === 'pull').map(({ card }) => card))], [10, 20], 'the run claimed both cards before its board drained');
  assert.equal(events.filter(({ event, trigger }) => event === 'trigger' && trigger === 'drain').length, 1, JSON.stringify(events));
});

/** The engine's own forge reads, answered by `fake`'s `gh` as a `run` over its repository is answered. */
const readsThrough = (fake) => repositoryReads({ repo: REPO, project: PROJECT }, { send: (_, args) => spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() }) });

// A failed maker that left nothing must not take a second dispatch from the slot it freed.
// proves R-LOOP-19
test('a no-clock real-bin run dispatches a maker that exited non-zero and left nothing on the forge once', SETTLES_WITHIN, async () => {
  const ran = runWithAgent(standInAgent({ 10: { engineer: { exit: 7 } } }), { items: [card(10, 'Ready')] });
  const reads = readsThrough(ran.fake);
  const { open, merged } = await reads.readPullRequests('rigger-10');
  const events = eventsOf(ran);
  const makers = events.filter((event) => event.layer === 'L3' && event.event === 'dispatch' && event.card === 10 && event.role === 'engineer' && event.attempt !== undefined);

  assert.equal(ran.code, 1, ran.err);
  assert.deepEqual(await reads.readBranches(['rigger-10']), { 'rigger-10': false }, 'the forge holds no branch of the card');
  assert.deepEqual({ open, merged }, { open: [], merged: [] }, 'the forge holds no open or merged pull request from it');
  assert.equal(makers.length, 1, JSON.stringify(events));
  assert.equal(events.filter((event) => event.layer === 'L1' && event.event === 'dispatch.start' && event.dispatch === makers[0].dispatch).length, 1, JSON.stringify(events));
});

// Once keeps its literal single-card boundary even when run would drain the four-card board.
// proves R-SCHED-2, R-SCHED-6
test('real-bin once at N three with four Ready cards fires one pull claims one card and records no run.start', SETTLES_WITHIN, async () => {
  const consumer = consumerRepository(3);
  const dir = temporaryDirectory('rigger-once-four-gh-');
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, ...FOUR_READY } });
  const agent = installAgentCli(dir);
  const ran = spawnSync(process.execPath, [bin, 'once'], { cwd: consumer, encoding: 'utf8', timeout: SETTLES_WITHIN.timeout,
    env: { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), PATH: [dir, process.env.PATH].join(delimiter) },
  });
  assert.equal(ran.error, undefined);
  const events = readEvents(join(consumer, '.rigger')).filter(({ layer }) => layer === 'L3');
  assert.deepEqual(events.filter(({ event }) => event === 'trigger').map(({ trigger }) => trigger), ['pull']);
  assert.deepEqual(events.filter(({ event }) => event === 'pull').map(({ card }) => card), [10]);
  assert.equal(events.filter(({ event }) => event === 'run.start').length, 0);
  assert.equal(agent.runs().length, 1);
  assert.deepEqual((await (await fake.model()).operations.readItems()).map(({ number, column }) => [number, column]).sort((a, b) => a[0] - b[0]), [[10, 'Coding'], [20, 'Ready'], [30, 'Ready'], [40, 'Ready']]);
});

// The private-Free refusal of the effective rules, through the real bin and the fake `gh`. Each
// test below is a wiring test, and its controlled counterpart is named above it.

/** The first line `gh` prints for the refusal, as #1090 recorded it and the private fixture answered it on 2026-11-05. */
const FEATURE_REFUSED = 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)';

/** A kind that ends with the owner, `change`, and one that names no owner, `merged`, each under two agent judges. */
const privateFreeSettings = () => ({ ...config(1), kinds: {
  change: { ...KINDS.change, judges: ['reviewer', 'architect', 'owner'] },
  merged: { ...KINDS.change, select: { labels: ['type:merged'] }, judges: ['reviewer', 'architect'] },
} });

/** A stand-in plan under which card `number`'s maker opens a pull request and both agent judges write sound markers. */
const panelled = (number) => ({ [number]: { engineer: { pr: true }, reviewer: { findings: true }, architect: { findings: true } } });

/** Has `agent`'s run as `role` end by running `source`, a function body given `consumer` and `node`'s spawn, before it exits. */
function afterRole(agent, role, source) {
  const program = join(agent.dir, 'claude');
  writeFileSync(program, [
    `#!${process.execPath}`,
    '// ABOUTME: Runs the documented stand-in, then acts as the owner while that role is still running.',
    'if (!process.env.RIGGER_FIXTURE_WARMING) {',
    `  const { standInMain } = await import(${JSON.stringify(new URL('./stub-claude.mjs', import.meta.url).href)});`,
    '  await standInMain();',
    "  const { readFileSync } = await import('node:fs');",
    `  const lines = readFileSync(${JSON.stringify(join(agent.dir, 'runs.jsonl'))}, 'utf8').trim().split('\\n');`,
    `  if (JSON.parse(lines.at(-1)).role === ${JSON.stringify(role)}) {`,
    `    ${source}`,
    '  }',
    '}',
    '',
  ].join('\n'));
  warmed(program);
  return agent;
}

/**
 * A consumer of `privateFreeSettings` over a fake `gh` holding `items` and `agent`. A `gh` ahead of
 * the fake refuses the rules read with the first line `rules`, and serves it where that is undefined,
 * as a seed alone would not outlast the fake's next write. `verb(...)` runs the real bin in the
 * consumer, each a process of its own, with its pid, and `answerRulesWith` changes the first line.
 */
function privateFree(items, agent, { seeded = {}, ...answers } = {}) {
  const rules = Object.hasOwn(answers, 'rules') ? answers.rules : FEATURE_REFUSED;
  const directory = temporaryDirectory('rigger-run-private-free-');
  const consumer = repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(privateFreeSettings())};\n` });
  gitIn(consumer, 'branch', '-M', 'main');
  const origin = join(directory, 'origin.git');
  withOrigin(consumer, origin);
  const dir = temporaryDirectory('rigger-run-private-free-gh-');
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items }, origin });
  seedRepository(fake, seeded);
  const refusing = temporaryDirectory('rigger-run-private-free-rules-');
  const answerRulesWith = (line) => writeFileSync(join(refusing, 'rules-line'), line === undefined ? '' : `${line}\n`);
  answerRulesWith(rules);
  fixture(refusing, 'gh', [
    'case "$*" in *rules/branches/*) if [ -s "$here/rules-line" ]; then cat "$here/rules-line" >&2; exit 1; fi ;; esac',
    `exec ${shellQuote(fake.gh)} "$@"`,
  ].join('\n'));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), PATH: [agent.dir, refusing, dir, process.env.PATH].join(delimiter) };
  const verb = (...args) => {
    const ran = spawnSync(process.execPath, [bin, ...args], { cwd: consumer, encoding: 'utf8', env });
    assert.equal(ran.error, undefined);
    return { out: ran.stdout, err: ran.stderr, code: ran.status, pid: ran.pid };
  };
  return { consumer, fake, verb, answerRulesWith, state: join(consumer, '.rigger') };
}

/** What the fake board holds and every merge sent: the facts each row's claim and write oracle reads. */
const forgeOf = async ({ fake }) => {
  const model = await fake.model();
  return { columns: Object.fromEntries((await model.operations.readItems()).map(({ number, column }) => [number, column])), writes: model.writes(),
    merges: fake.sent().filter((args) => args[1]?.endsWith('/merge')) };
};

/** The events a consumer's stream holds, as `eventsOf` reads them, for `run` alone where one is named. */
const streamOf = ({ consumer }, run) => eventsOf({ consumer }).filter((event) => run === undefined || event.run === run);

/** The run ids in order of their `run.start`. */
const runsIn = (world) => streamOf(world).filter(({ event }) => event === 'run.start').map(({ run }) => run);

/** The roles the stand-in ran for card `number`, in order. */
const rolesRan = (agent, number) => agent.runs().filter(({ card }) => card === number).map(({ role }) => role);

/** A Review card an earlier run left, stopped on a failed rules read, #1090's state: every role finished, no move to Owner. */
async function leftInReview() {
  const agent = standInAgent(panelled(10));
  const world = privateFree([card(10, 'Ready')], agent, { rules: 'gh: Bad Gateway (HTTP 502)' });
  const stopped = world.verb('run');
  assert.notEqual(stopped.code, 0, stopped.out);
  assert.match(stopped.err, /effective rules/, stopped.err);
  assert.equal((await forgeOf(world)).columns[10], 'Review', stopped.err);
  assert.deepEqual(rolesRan(agent, 10).sort(), ['architect', 'engineer', 'reviewer'], stopped.err);
  world.answerRulesWith(FEATURE_REFUSED);
  return { ...world, agent, stopped };
}

// Host reason: wiring. Controlled counterpart: 'L2 moves a Review card to Owner over the refusal,
// where its kind ends with the owner or names the owner alone' in test/private-free-policy.test.mjs.
test('P1: over the refusal a run paused during its maker finishes the claimed card\'s work, leaves it in Review, exits 0 naming the closer, claims nothing more and merges nothing', SETTLES_WITHIN, async () => {
  const agent = standInAgent({ ...panelled(10), ...panelled(20) });
  const world = privateFree([card(10, 'Ready'), card(20, 'Ready')], agent);
  afterRole(agent, 'engineer', `(await import('node:child_process')).execFileSync(process.execPath, [${JSON.stringify(bin)}, 'pause'], { cwd: ${JSON.stringify(world.consumer)}, env: process.env });`);

  const ran = world.verb('run');

  assert.equal(ran.code, 0, ran.out + ran.err);
  assert.match(ran.out, /admission is closed by owner/, ran.out);
  const lines = ran.out.split('\n').filter((line) => /#10\b/.test(line));
  assert.deepEqual(lines.slice(1), ['rigger run: card #10\'s judge `reviewer` exited 0', 'rigger run: card #10\'s judge `architect` exited 0', 'rigger run: card #10\'s judge `owner` judges last, once every agent judge is satisfied, and Rigger never dispatches it'], ran.out);
  assert.equal(readdirSync(admissionOf(world.state)).filter((name) => /^owner-.*\.json$/.test(name)).length, 1, 'the closer is still present');
  const forge = await forgeOf(world);
  // The move to Owner is a pull's, and a closed admission claims nothing.
  assert.deepEqual(forge.columns, { 10: 'Review', 20: 'Ready' });
  assert.deepEqual(forge.merges, []);
  assert.deepEqual(rolesRan(agent, 10).sort(), ['architect', 'engineer', 'reviewer'], 'each role ran once');
  assert.deepEqual(rolesRan(agent, 20), []);
  const events = streamOf(world);
  const at = (matches) => events.findIndex(matches);
  const order = [
    at(({ layer, event, card: held }) => layer === 'L3' && event === 'pull' && held === 10),
    at(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'engineer'),
    at(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'reviewer'),
    at(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'architect'),
    at(({ layer, event, card: held }) => layer === 'L3' && event === 'slot.release' && held === 10),
  ];
  assert.ok(order.every((place) => place >= 0), JSON.stringify(order));
  const [pulled, maker, reviewer, architect, released] = order;
  assert.ok(pulled < maker && maker < Math.min(reviewer, architect) && Math.max(reviewer, architect) < released, JSON.stringify(order));
  assert.equal(events.filter(({ layer, event, role }) => layer === 'L1' && event === 'dispatch.end' && role === undefined).length, 3, 'each of the three roles\' dispatches ended');
  assert.deepEqual(events.filter(({ layer, event, to }) => layer === 'L2' && event === 'transition' && to === 'owner'), []);
  assert.deepEqual(events.filter(({ layer, event }) => layer === 'L3' && event === 'pull').map(({ card: held }) => held), [10], 'no claim after the pause');
});

// Host reason: wiring. Controlled counterpart: 'L2 moves a Review card to Owner over the refusal,
// where its kind ends with the owner or names the owner alone' in test/private-free-policy.test.mjs.
test('P2: over the refusal a new run under a persisted closer exits 0 naming it and claims no Review card a stopped run left', SETTLES_WITHIN, async () => {
  const world = await leftInReview();
  assert.equal(world.verb('pause').code, 0);
  const before = await forgeOf(world);
  const roles = world.agent.runs().length;

  const ran = world.verb('run');

  assert.equal(ran.code, 0, ran.out + ran.err);
  assert.match(ran.out, /admission is closed by owner/, ran.out);
  assert.deepEqual(await forgeOf(world), before);
  assert.equal(world.agent.runs().length, roles);
  const [first, second, ...others] = runsIn(world);
  assert.deepEqual(others, []);
  assert.notEqual(first, second, 'a second run identity holds the restart');
  assert.notEqual(ran.pid, world.stopped.pid, 'a second process holds the restart');
  assert.deepEqual(streamOf(world, second).filter(({ layer, event }) => layer === 'L3' && ['pull', 'dispatch'].includes(event)), []);
  assert.ok(streamOf(world, first).some(({ event, role }) => event === 'dispatch' && role === 'architect'), 'the first run\'s stream is whole');
});

// Host reason: wiring. Controlled counterpart: 'L2 moves a Review card to Owner over the refusal,
// where its kind ends with the owner or names the owner alone' in test/private-free-policy.test.mjs.
test('P3: over the refusal, after the owner resumes, a stopped run\'s Review card moves to Owner without a remake or a rejudging, and no merge follows', SETTLES_WITHIN, async () => {
  const world = await leftInReview();
  assert.equal(world.verb('pause').code, 0);
  assert.equal(world.verb('run').code, 0);
  assert.equal(world.verb('resume').code, 0);
  const before = await forgeOf(world);
  const roles = world.agent.runs().length;

  const ran = world.verb('run');

  assert.equal(ran.code, 0, ran.out + ran.err);
  assert.ok(ran.out.split('\n').includes('rigger run: card #10 moved to owner'), ran.out);
  const after = await forgeOf(world);
  assert.deepEqual(after.columns, { 10: 'Owner' });
  assert.deepEqual(after.writes.slice(0, before.writes.length), before.writes, 'no completed write was retried or rolled back');
  assert.deepEqual(after.writes.slice(before.writes.length).map(({ operation, args }) => [operation, args[1]]), [['moveItem', 'Owner']]);
  assert.deepEqual(after.merges, []);
  assert.equal(world.agent.runs().length, roles, 'no maker or judge ran again');
});

// Host reason: wiring. Controlled counterpart: 'the pull over the refusal and an unreadable
// admission rejects naming admission, no rules failure in its place, and claims nothing' in
// test/private-free-policy.test.mjs.
test('P7a: over the refusal and an admission that turns unreadable in flight, the claimed card finishes and the failure comes at the freed-slot pull', SETTLES_WITHIN, async () => {
  const agent = standInAgent({ ...panelled(10), ...panelled(20) });
  const world = privateFree([card(10, 'Ready'), card(20, 'Ready')], agent);
  afterRole(agent, 'engineer', `const fs = await import('node:fs'); fs.mkdirSync(${JSON.stringify(admissionOf(world.state))}, { recursive: true }); fs.writeFileSync(${JSON.stringify(join(admissionOf(world.state), 'not-a-closer'))}, 'x');`);

  const ran = world.verb('run');

  assert.notEqual(ran.code, 0, ran.out);
  assert.ok(ran.err.includes(`${join(admissionOf(world.state), 'not-a-closer')} (no closer form)`), ran.err);
  assert.doesNotMatch(ran.err, /effective rules/, ran.err);
  const forge = await forgeOf(world);
  // Every role finished. The move to Owner needs a claim, and this pull claims nothing.
  assert.deepEqual(forge.columns, { 10: 'Review', 20: 'Ready' }, ran.err);
  assert.deepEqual(forge.merges, []);
  assert.deepEqual(rolesRan(agent, 10).sort(), ['architect', 'engineer', 'reviewer']);
  assert.deepEqual(rolesRan(agent, 20), []);
  assert.deepEqual(streamOf(world).filter(({ layer, event }) => layer === 'L3' && event === 'pull').map(({ card: held }) => held), [10]);
  const trigger = streamOf(world).map(({ event, trigger: fired }) => (event === 'trigger' ? fired : event));
  assert.ok(trigger.lastIndexOf('pull') > trigger.indexOf('slot.release'), 'a pull fired on the freed slot');
});

/** The pull request a seeded card holds: #70 from rigger-10 at this head, its markers `comments`. */
const SEEDED_HEAD = 'c'.repeat(40);
const seededPull = (comments) => ({ branches: ['rigger-10'], mergeable: { 70: 'MERGEABLE' }, pullRequests: [{ number: 70, head: 'rigger-10', sha: SEEDED_HEAD, mergeBase: 'd'.repeat(40), comments }] });
const soundMarkers = (...roles) => roles.map((role) => markerComment({ card: 10, pull: 70, head: SEEDED_HEAD, body: card(10, 'Review').body, role }));

/** Each preexisting card a run can meet, by name: its column, labels and markers. */
const PREEXISTING = {
  'a Review card of a kind ending with the owner': { column: 'Review', labels: ['type:change'], roles: ['reviewer', 'architect'] },
  'a Review card of a kind naming no owner': { column: 'Review', labels: ['type:merged'], roles: ['reviewer', 'architect'] },
  'an Owner card with no owner verdict': { column: 'Owner', labels: ['type:change'], roles: ['reviewer', 'architect'] },
  'an Owner card with a sound owner verdict': { column: 'Owner', labels: ['type:change'], roles: ['reviewer', 'architect', 'owner'] },
};

/** A consumer holding the preexisting card named `name`, under the rules answer `rules`, with `admission` open, closed or unreadable. */
function preexisting(name, rules, admission) {
  const { column, labels, roles } = PREEXISTING[name];
  const world = privateFree([card(10, column, { labels })], standInAgent(), { rules, seeded: seededPull(soundMarkers(...roles)) });
  if (admission === 'closed') seed(world.state, 'owner-c3.json', closerText({ reason: 'paused by the owner' }));
  if (admission === 'unreadable') seed(world.state, 'not-a-closer');
  return world;
}

/** What a run must do, each a claim, a write, an exit and an output oracle written by hand. */
const ANSWERS = {
  moved: { code: 0, column: 'Owner', moves: 1, out: 'rigger run: card #10 moved to owner' },
  stays: { code: 0, moves: 0, out: 'no card was pullable' },
  closed: { code: 0, moves: 0, out: `admission is closed by owner: paused by the owner; time ${TIME}` },
  unreadable: { code: 1, moves: 0, err: '/not-a-closer (no closer form)' },
  rulesFailed: { code: 1, moves: 0, err: 'read of the base branch\'s effective rules failed' },
};

/** The line `run` and `plan` print for a merge the refusal holds back, written out by hand. */
const REFUSED_MERGE_LINE = `  refuse  #10  pull request #70 is not merged, because the forge offers this repository no effective rules for its base branch, so the checks they require are unavailable evidence: readEffectiveRules on board ${PROJECT} failed: reading effective rules for branch main in ${REPO}, ${FEATURE_REFUSED}`;

/** `answer`, with the line a person reads for the refused merge beside its own output. */
const refusing = (answer) => ({ ...answer, refusal: REFUSED_MERGE_LINE });

/** Asserts run's output, exit, claims and writes over the preexisting card `name` meet `answer`. */
async function runsAs(name, rules, admission, answer) {
  const world = preexisting(name, rules, admission);
  const at = `${name}, admission ${admission}`;
  const before = await forgeOf(world);
  const ran = world.verb('run');
  const after = await forgeOf(world);
  assert.equal(ran.code, answer.code, `${at}: ${ran.out}${ran.err}`);
  if (answer.out !== undefined) assert.ok(ran.out.includes(answer.out), `${at}: ${ran.out}`);
  if (answer.err !== undefined) assert.ok(ran.err.includes(answer.err), `${at}: ${ran.err}`);
  if (answer.refusal !== undefined) assert.ok(`${ran.out}\n${ran.err}`.split('\n').includes(answer.refusal), `${at}: ${ran.out}${ran.err}`);
  assert.deepEqual(after.columns, { 10: answer.column ?? PREEXISTING[name].column }, at);
  assert.equal(after.writes.length - before.writes.length, answer.moves, at);
  assert.deepEqual(after.merges, [], at);
  assert.equal(streamOf(world).filter(({ layer, event }) => layer === 'L3' && event === 'dispatch').length, 0, at);
  assert.equal(streamOf(world).filter(({ layer, event }) => layer === 'L3' && event === 'pull').length, answer.moves, at);
}

// Host reason: wiring. Controlled counterpart: 'L2 refuses a merge over the refusal, naming the
// unavailable rules, for a Review card and an Owner card a served read would merge' in
// test/private-free-policy.test.mjs. In-flight work is the P1 and P7a tests' above.
test('P4, P7, P8: over the verified refusal, run answers each preexisting card under open, closed and unreadable admission', { timeout: 120_000 }, async () => {
  const [owned, merged, waiting, verdict] = Object.keys(PREEXISTING);
  for (const name of [owned, waiting]) {
    await runsAs(name, FEATURE_REFUSED, 'open', name === owned ? ANSWERS.moved : ANSWERS.stays);
    await runsAs(name, FEATURE_REFUSED, 'closed', ANSWERS.closed);
    await runsAs(name, FEATURE_REFUSED, 'unreadable', ANSWERS.unreadable);
  }
  for (const name of [merged, verdict]) {
    await runsAs(name, FEATURE_REFUSED, 'open', refusing(ANSWERS.stays));
    await runsAs(name, FEATURE_REFUSED, 'closed', refusing(ANSWERS.closed));
    await runsAs(name, FEATURE_REFUSED, 'unreadable', refusing(ANSWERS.unreadable));
  }
});

// Host reason: wiring. Controlled counterpart: 'L2 answers no action, naming the rules read, for
// an unverified 403 wherever the action needs the read' in test/private-free-policy.test.mjs.
test('P5: over an unverified 403, run fails naming the rules read under every admission where the action needs it, and an Owner card with no verdict needs none', { timeout: 120_000 }, async () => {
  const denied = 'gh: Resource not accessible by integration (HTTP 403)';
  const [owned, merged, waiting, verdict] = Object.keys(PREEXISTING);
  for (const name of [owned, merged, verdict]) {
    for (const admission of ['open', 'closed', 'unreadable']) await runsAs(name, denied, admission, ANSWERS.rulesFailed);
  }
  await runsAs(waiting, denied, 'open', ANSWERS.stays);
  await runsAs(waiting, denied, 'closed', ANSWERS.closed);
  await runsAs(waiting, denied, 'unreadable', ANSWERS.unreadable);
});

// Host reason: wiring. Controlled counterpart: 'L2 moves a Review card to Owner over the refusal,
// where its kind ends with the owner or names the owner alone' in test/private-free-policy.test.mjs.
test('P9a: plan over the refusal shows the non-merge answer and no merge, where served rules would show the merge', SETTLES_WITHIN, () => {
  const [owned, merged, , verdict] = Object.keys(PREEXISTING);
  const moving = preexisting(owned, FEATURE_REFUSED, 'open').verb('plan');
  assert.equal(moving.code, 0, moving.out + moving.err);
  assert.match(moving.out, /pull {4}#10 {2}move to owner/, moving.out);
  for (const name of [merged, verdict]) {
    const planned = preexisting(name, FEATURE_REFUSED, 'open').verb('plan');
    assert.equal(planned.code, 0, planned.out + planned.err);
    assert.match(planned.out, /nothing would be pulled, and refuses 1 card/, planned.out);
    assert.ok(planned.out.split('\n').includes(REFUSED_MERGE_LINE), planned.out);
    assert.doesNotMatch(planned.out, /merge pull request #/, planned.out);
    assert.match(preexisting(name, undefined, 'open').verb('plan').out, /merge pull request #70/, 'with the rules served plan shows the merge, so the refusal alone holds it');
  }
});
