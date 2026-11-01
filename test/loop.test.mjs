// ABOUTME: Tests L3's loop over the fake board with a stand-in maker run through L1: at most N cards in
// flight, a claim taken before any await, a claim held only until its slot is released, every
// read failure, refused claim move and dispatch outcome passed on, and a run that refills each
// freed slot and leaves each card in the column its outcome settles, by the config's column names;
// the events L3 records, the drain trigger's among them; and L3's single pull, which claims up to
// a limit capped at N and takes a redo without a move.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { readdirSync } from 'node:fs';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { boundaryReport, sourceTree } from './layer-boundaries.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { until } from './process-fixtures.mjs';
import {
  COLUMNS, DRIVEN_ROUNDS, KINDS, boardOf, cardIn, columnsOf, drive, handleOn, waitFor, readyCard, world,
} from './loop-world.mjs';
import { readingLater, settledOf } from './loop-world.mjs';
import { positive, settling, turnWait } from './loop-world.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { itemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { EVENT_REFUSED } from '../src/substrate/process.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { heldCard } from './stop-failure.mjs';
import { markerComment } from './fake-repository.mjs';
import { PASSING } from './loop-world.mjs';
import { START as CLOCK_START, manualClock, reportWorld } from './clock-report-world.mjs';
import { report as deriveReport } from '../src/observation/report.mjs';
import { streamPath } from '../src/observation/sink.mjs';
import { run as runVerb } from '../src/cli/run.mjs';
import { once as onceVerb } from '../src/cli/once.mjs';
import { clockVerb } from './clock-report-verb-world.mjs';
import { reportText } from '../src/cli/report.mjs';
import { failuresIn, keptUp, keptUpVerb, reportsIn, settledIn } from './kept-up-run.mjs';
import { keptUpRunVerb } from './kept-up-verb-world.mjs';
import { REFUSED as REFUSED_CARD, card as verbCard } from './verb-consumer.mjs';
import { readEvents as readEventsAt } from '../src/observation/sink.mjs';

const synchronousCalls = [];
let synchronousDeadline = Infinity;
function startSynchronousTrace() {
  synchronousCalls.length = 0;
  const sampledSites = new Set();
  const record = (call) => {
    const key = `${call.call}:${call.path ?? call.file}`;
    if (!sampledSites.has(key) || (call.start <= synchronousDeadline && call.end >= synchronousDeadline)) {
      call.site = new Error().stack?.split('\n')[3]?.trim();
      sampledSites.add(key);
    }
    synchronousCalls.push(call);
  };
  const originalSpawn = childProcess.spawnSync;
  childProcess.spawnSync = (file, args, options) => {
    const start = performance.now();
    try { return originalSpawn(file, args, options); }
    finally {
      if (process.env.RIGGER_596_PHASE_ACTIVE) record({ call: 'spawnSync', file, warm: options?.env?.RIGGER_FIXTURE_WARMING ? 'fixture' : options?.env?.NODE_OPTIONS ? 'agent' : undefined, start, end: performance.now() });
    }
  };
  const originals = new Map();
  for (const name of ['mkdtempSync', 'mkdirSync', 'writeFileSync', 'renameSync', 'chmodSync', 'readFileSync', 'readdirSync']) {
    const original = fs[name];
    originals.set(name, original);
    fs[name] = (...args) => {
      const start = performance.now();
      try { return original(...args); }
      finally {
        if (process.env.RIGGER_596_PHASE_ACTIVE) record({ call: name, path: String(args[0]), start, end: performance.now() });
      }
    };
  }
  syncBuiltinESMExports();
  return () => {
    childProcess.spawnSync = originalSpawn;
    for (const [name, original] of originals) fs[name] = original;
    syncBuiltinESMExports();
    synchronousDeadline = Infinity;
  };
}

import { admissionOf, closerText, moduleOver, picture, seed, stateOf, TIME } from './admission-world.mjs';

/** Keep the first and last observed call at each site and every call crossing the shared deadline. */
function synchronousSummary(bodyStart, deadline, worlds = [], bodyEnd = Infinity) {
  const groups = new Map();
  const crossing = [];
  const boundaries = worlds.flatMap(({ limit, begun, built }) => [
    { world: limit ?? 'N', phase: 'construction.start', at: begun },
    ...(built?.phaseTrace.map(({ phase, at }) => ({ world: limit ?? 'N', phase, at })) ?? []),
  ]).filter(({ at }) => at <= bodyEnd).sort((left, right) => left.at - right.at);
  for (const call of synchronousCalls.filter(({ start }) => start >= bodyStart && start <= bodyEnd)) {
    const key = `${call.call}:${call.path ?? call.file}`;
    const group = groups.get(key) ?? { count: 0, first: call, last: call };
    group.count += 1;
    group.last = call;
    groups.set(key, group);
    if (call.start <= deadline && call.end >= deadline) crossing.push({ ...call, firstLaterBoundary: boundaries.find(({ at }) => at > call.end) ?? 'not reached' });
  }
  return { groups: [...groups.values()], crossing };
}

/**
 * Fires two pull triggers at a time, lets every start they make happen, then releases every held
 * dispatch, until a round starts nothing. Returns what `world` built. Rounds still starting
 * dispatches after `DRIVEN_ROUNDS` of them fail the test, naming those dispatches.
 */
async function runToEnd(built) {
  for (let round = 0; round < DRIVEN_ROUNDS; round += 1) {
    const before = built.dispatches.started.length;
    const ticks = [built.loop.pull(), built.loop.pull()];
    const pulled = settledOf(Promise.all(ticks));
    await settling(built, pulled);
    built.dispatches.releaseAll();
    const answers = await Promise.all(ticks);
    if (built.dispatches.started.length === before && answers.every((each) => each.length === 0)) return built;
  }
  throw new Error(`rounds were still starting dispatches after ${DRIVEN_ROUNDS} of them, having started ${built.dispatches.started}`);
}


test('given concurrency 2 and cards A, B and C, where A\'s dispatch returns before B\'s, C\'s dispatch starts before B\'s returns', async () => {
  const built = world({ cards: [1, 2, 3], concurrency: 2 });

  const run = built.loop.run();
  // Positive: until cards 1 and 2 are held.
  await positive(() => built.dispatches.held() === 2);
  assert.deepEqual(built.dispatches.holding(), [1, 2]);
  built.dispatches.release(1);
  // Positive: until card 3 is held.
  await positive(() => built.dispatches.holding().includes(3));

  assert.deepEqual(built.dispatches.started, [1, 2, 3]);
  assert.deepEqual(built.dispatches.holding(), [2, 3], "B's dispatch has not returned");
  built.dispatches.releaseAll();
  await run;
});

test('given a board whose column read answers one turn later than the fake\'s, concurrency 2 and cards A, B and C, where A\'s dispatch returns before B\'s, C\'s dispatch starts before B\'s returns', async () => {
  const fake = boardOf([1, 2, 3]);
  const built = world({ fake, board: readingLater(fake), concurrency: 2 });

  const run = built.loop.run();
  // Positive: until cards 1 and 2 are held.
  await positive(() => built.dispatches.held() === 2);
  assert.deepEqual(built.dispatches.holding(), [1, 2]);
  built.dispatches.release(1);
  // Positive: until card 3 is held.
  await positive(() => built.dispatches.holding().includes(3));

  assert.deepEqual(built.dispatches.started, [1, 2, 3]);
  assert.deepEqual(built.dispatches.holding(), [2, 3], "B's dispatch has not returned");
  built.dispatches.releaseAll();
  await run;
});

/** Each item's moves, by its id, each as the column it was moved to, in the order the board made them. */
const movesByItem = (moves) => moves.reduce((byItem, [id, column]) => ({ ...byItem, [id]: [...(byItem[id] ?? []), column] }), {});

test('given a board whose column read answers one turn later than the fake\'s, a run driven to its end over cards 1 to 4 at concurrency 2 makes the dispatches and the board moves the same run over the fake makes, in the same order', async () => {
  const answer = (card) => (card.number === 2 ? new Error('the dispatch could not start') : { exit: 0, output: '' });
  const ran = async (later) => {
    const fake = boardOf([1, 2, 3, 4]);
    const built = world({ fake, board: later ? readingLater(fake) : handleOn(fake), concurrency: 2, answer });
    await assert.rejects(drive(built), heldCard(2));
    return { started: built.dispatches.started, writes: fake.writes() };
  };

  const later = await ran(true);
  const other = await ran(false);

  // Two makers released together exit in either order, so each card's moves keep their order,
  // and the order across cards is the makers'.
  assert.deepEqual(later.started, other.started);
  assert.deepEqual(movesByItem(later.writes.map(({ args }) => args)), movesByItem(other.writes.map(({ args }) => args)));
  assert.deepEqual(later.started, [1, 2, 2]);
});

test('in one record of board writes and dispatch starts, each card\'s move to the coding column comes before its dispatch starts', async () => {
  const built = world({ cards: [1, 2, 3], concurrency: 2 });

  await drive(built);

  const starts = built.sequence.filter((entry) => entry.start).map((entry) => entry.start);
  assert.deepEqual([...starts].sort(), ['item-1', 'item-2', 'item-3']);
  for (const id of starts) {
    const moved = built.sequence.findIndex((entry) => entry.move === id && entry.column === COLUMNS.coding);
    const started = built.sequence.findIndex((entry) => entry.start === id);
    assert.ok(moved !== -1 && moved < started, `${id} moved to ${COLUMNS.coding} before its dispatch started: ${JSON.stringify(built.sequence)}`);
  }
});

test('a card whose dispatch returns reaches Owner for its owner judge', async () => {
  const built = world({ cards: [1], concurrency: 1 });

  await drive(built);

  assert.deepEqual(built.dispatches.started, [1]);
  assert.deepEqual(built.fake.writes().map(({ operation, args: [id, column] }) => [operation, id, column]), [
    ['moveItem', 'item-1', COLUMNS.coding],
    ['moveItem', 'item-1', COLUMNS.review],
    ['moveItem', 'item-1', COLUMNS.owner],
  ]);
  assert.deepEqual(await columnsOf(built.fake), { 1: COLUMNS.owner });
});

/** The two ways a dispatch fails: it ran and exited non-zero, or it threw before it ran. */
const FAILURES = {
  'exits non-zero': () => ({ exit: 1, output: '' }),
  throws: () => new Error('the dispatch could not start'),
};

for (const [how, failed] of Object.entries(FAILURES)) {
  test(`a card whose dispatch ${how} frees its slot, and ${how === 'throws' ? 'its hold leaves the next pullable card unclaimed' : 'the next pullable card is dispatched'}`, async () => {
    const built = world({ cards: [1, 2], concurrency: 1, answer: (card) => (card.number === 1 ? failed() : { exit: 0, output: '' }) });

    const run = built.loop.run();
    const ended = settledOf(run);
    if (how === 'throws') {
      // Card 1's maker never starts, and its hold closes admission. Positive: until card 1's outcome has reached L2 and the run has ended.
      await positive(() => built.attempts.some((each) => each.layer === 'L2' && each.card === 1 && each.event === 'maker.failed') && ended());
    } else {
      // Positive: until card 1 is held, then until card 2 is.
      await positive(() => built.dispatches.held() === 1);
      assert.deepEqual(built.dispatches.holding(), [1]);
      built.dispatches.release(1);
      await positive(() => built.dispatches.holding().includes(2));
    }

    assert.deepEqual(built.dispatches.holding(), how === 'throws' ? [] : [2], how === 'throws' ? "card 1's slot is free, and card 2 is left unclaimed" : "card 1's slot is free, and card 2 holds it");
    if (how === 'throws') assert.deepEqual(cardsOf(built, 'pull'), [1], 'card 2 was claimed after card 1 held');
    built.dispatches.releaseAll();
    if (how === 'throws') await assert.rejects(run, heldCard(1));
    else await run;
  });

  test(`a card whose dispatch ${how} ends the run outside the review column`, async () => {
    const built = world({ cards: [1], concurrency: 1, answer: failed });

    if (how === 'throws') await assert.rejects(drive(built), heldCard(1));
    else await drive(built);

    assert.deepEqual(built.dispatches.started, how === 'throws' ? [1, 1] : [1]);
    assert.notEqual((await columnsOf(built.fake))[1], COLUMNS.review);
  });
}

// proves R-SCHED-1
test("given concurrency 1, a run dispatches its cards in #221's pull order: redos first, then by declared priority, then oldest first", async () => {
  // The board lists its Priority options Low, High, Normal and its cards out of every order, so
  // only the declared order High, Normal, Low, with redos ahead and oldest first, gives 35, 32, 34, 31, 33.
  const fake = createFakeBoard({
    columns: Object.values(COLUMNS),
    fields: [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }],
    items: [
      cardIn(31, COLUMNS.ready, { Priority: 'Low' }),
      cardIn(33, COLUMNS.ready),
      cardIn(34, COLUMNS.ready, { Priority: 'Normal' }),
      cardIn(32, COLUMNS.ready, { Priority: 'High' }),
      cardIn(35, COLUMNS.coding, { Priority: 'Low' }),
    ],
  });
  const built = world({ fake, concurrency: 1, priority: config.board.priority });

  await drive(built);

  assert.deepEqual(built.dispatches.started, [35, 32, 34, 31, 33]);
});

// proves R-SCHED-11
test('a ready card L2 ignores is in the ready column after the run, and the write record holds no move of it', async () => {
  const ignored = { ...readyCard(40), labels: [] };
  const built = world({ cards: [ignored, 41], concurrency: 1 });
  assert.deepEqual(nextAction(ignored, KINDS), { action: 'ignore' });

  await drive(built);

  assert.deepEqual(built.dispatches.started, [41]);
  assert.equal((await columnsOf(built.fake))[40], COLUMNS.ready);
  const moves = built.fake.writes().filter(({ operation }) => operation === 'moveItem');
  assert.ok(moves.length > 0, 'the run moved the card L2 dispatched');
  assert.deepEqual(moves.filter(({ args: [id] }) => id === 'item-1'), []);
});

test('the same run on a board whose five columns carry other display names, with a config naming them, makes the same dispatches and the same moves by column key', async () => {
  const renamed = { ready: 'To do', coding: 'In progress', review: 'In review', owner: 'Blocked', done: 'Shipped' };
  const answer = (card) => (card.number === 2 ? new Error('the dispatch could not start') : { exit: 0, output: '' });
  const ran = async (columns) => {
    const built = world({ cards: [1, 2, { ...readyCard(3, columns), labels: [] }, 4], columns, concurrency: 2, answer });
    await assert.rejects(drive(built), heldCard(2));
    const keyOf = Object.fromEntries(Object.entries(columns).map(([key, name]) => [name, key]));
    const moves = built.fake.writes().map(({ operation, args: [id, column] }) => [operation, id, keyOf[column]]);
    return { started: built.dispatches.started, moves };
  };

  const named = await ran(COLUMNS);
  const other = await ran(renamed);

  assert.deepEqual(movesByItem(named.moves.map(([, id, key]) => [id, key])), { 'item-1': ['coding', 'review'], 'item-2': ['coding'] });
  assert.deepEqual(other.started, named.started);
  assert.deepEqual(movesByItem(other.moves.map(([, id, key]) => [id, key])), movesByItem(named.moves.map(([, id, key]) => [id, key])));
});

/**
 * The most turns of the event loop a run over a refusing board may take before the test gives up
 * on it. A run that settles needs two: one for its pull's read, one for the refusals. A run that
 * re-pulls on each refusal can double its pulls on every turn, so the bound stays small.
 */
const TURNS = 5;

/**
 * One call to `run()` over a fake board that refuses every claim move, with cards 1, 2 and 3 in
 * the ready column and concurrency 2. Every pull the run fires lets the event loop turn once
 * before it reads the board, so a run that pulls without end cannot starve the test. The test
 * waits at most `TURNS` turns for the run to settle, then stops any pull still to read, which
 * bounds a run that would never settle. Answers whether it settled in time, with the board's
 * record of the requests it received.
 */
async function refusingRun() {
  const refusing = createFakeBoard({ columns: Object.values(COLUMNS), items: [1, 2, 3].map((number) => readyCard(number)), refuseMoves: true });
  const handle = handleOn(refusing);
  let stopped = false;
  // How many times the test has looked at whether the run has settled, once per turn of the event loop.
  let looks = 0;
  const board = {
    readColumns: async () => {
      const begun = looks;
      // A turn wait: it counts the test's own looks, one per turn.
      await turnWait(() => stopped || looks > begun);
      if (stopped) throw new Error('the test stopped a run that had not settled');
      return handle.readColumns();
    },
    readPriority: handle.readPriority,
  };
  const built = world({ fake: refusing, board, concurrency: 2 });
  let settled = false;
  const run = built.loop.run().catch(() => {}).finally(() => {
    settled = true;
  });
  // A turn wait: it counts its own turns against `TURNS`.
  await turnWait(() => {
    looks += 1;
    return settled || looks > TURNS;
  });
  const inTime = settled;
  stopped = true;
  await run;
  return { settled: inTime, requests: refusing.requests(), started: built.dispatches.started };
}

test('given a board that refuses every claim move, cards 1, 2 and 3 in ready and concurrency 2, one call to run() settles', async () => {
  const { settled, started } = await refusingRun();

  assert.ok(settled, `the run had not settled after ${TURNS} turns of the event loop`);
  assert.deepEqual(started, []);
});

test('given a board that refuses every claim move, cards 1, 2 and 3 in ready and concurrency 2, the board receives at most one request to move each card to coding during one run', async () => {
  const { requests } = await refusingRun();

  const claims = requests.filter(({ operation, args: [, column] }) => operation === 'moveItem' && column === COLUMNS.coding);
  assert.ok(claims.length > 0, 'the run asked the board for a claim move');
  for (const id of ['item-1', 'item-2', 'item-3']) {
    assert.ok(claims.filter(({ args: [item] }) => item === id).length <= 1, `${id}: ${JSON.stringify(claims)}`);
  }
});

test('given a board that refuses every claim move, cards 1, 2 and 3 in ready and concurrency 2, the board receives no read after the first refused claim move during one run', async () => {
  const { requests } = await refusingRun();

  const first = requests.findIndex(({ operation }) => operation === 'moveItem');
  assert.notEqual(first, -1, 'the run asked the board for a claim move');
  assert.deepEqual(requests.slice(first).filter(({ operation }) => operation.startsWith('read')), []);
});

test('given concurrency 1 and four cards L2 would dispatch, the most cards in flight at any moment is exactly 1', async () => {
  const { dispatches } = await runToEnd(world({ concurrency: 1 }));

  assert.equal(dispatches.most(), 1);
  assert.deepEqual([...dispatches.started].sort(), [1, 2, 3, 4]);
});

test('given concurrency 3 and four cards L2 would dispatch, the most cards in flight at any moment is exactly 3', async () => {
  const { dispatches } = await runToEnd(world({ concurrency: 3 }));

  assert.equal(dispatches.most(), 3);
  assert.deepEqual([...dispatches.started].sort(), [1, 2, 3, 4]);
});

test('given no concurrency and four cards L2 would dispatch, the most cards in flight at any moment is exactly 3', async () => {
  const { dispatches } = await runToEnd(world());

  assert.equal(dispatches.most(), 3);
  assert.deepEqual([...dispatches.started].sort(), [1, 2, 3, 4]);
});

test('given one pullable card and two free slots, two pull triggers whose reads the board holds unresolved hand the card to the dispatch exactly once', async () => {
  const fake = boardOf([7]);
  const releases = [];
  const answered = [];
  const board = handleOn(fake, {
    beforeRead: () => releases.push(fake.holdNextRead()),
    onRead: (items) => answered.push(items.map((item) => [item.number, item.column])),
  });
  const built = world({ fake, concurrency: 2, board });

  const ticks = [built.loop.pull(), built.loop.pull()];
  // Positive: until both reads are held.
  await positive(() => releases.length === 2);
  assert.equal(releases.length, 2, 'both reads are held at once');
  releases.forEach((release) => release());
  // Positive: until card 7 is held.
  await positive(() => answered.length === 2 && built.dispatches.holding().includes(7));
  built.dispatches.releaseAll();
  await Promise.all(ticks);

  assert.deepEqual(answered, [[[7, 'Ready']], [[7, 'Ready']]]);
  assert.deepEqual(built.dispatches.started, [7]);
});

// proves R-WORK-5
test('a continuing attempt retries L1 at the same head L2 named', async () => {
  const built = world({ cards: [cardIn(81, COLUMNS.review)], concurrency: 1 });
  const continuing = { action: 'continue', pull: 181, head: '8'.repeat(40), markers: [] };
  const heads = [];
  const asks = [];
  const l3 = loop({
    config: { ...config, concurrency: 1 }, board: handleOn(built.fake),
    facts: async () => () => continuing,
    decide: (card, outcomes, options) => {
      asks.push(options.continuing);
      return options.attempt === 1
        ? { action: 'again', attempt: 2, failure: { workspace: 'unavailable' } }
        : { action: 'stop', failure: { workspace: 'unavailable' } };
    },
    l2: built.l2, sink: built.sink, kill: async () => {},
    workspace: async (card, head) => {
      heads.push(head);
      throw Object.assign(new Error('workspace unavailable'), { code: 'WORKSPACE_NOT_MADE', path: '/nowhere' });
    },
    judgeDirectory: async () => {}, removeDirectories: async () => {}, state: built.directory, environment: {}, run: 'r-test',
  });

  await assert.rejects(l3.pull(), (failure) => {
    const messages = leavesOf(failure).map((held) => held.message);
    assert.ok(messages.some((message) => /card #81 was stopped/.test(message)), JSON.stringify(messages));
    return true;
  });

  assert.deepEqual(heads, [continuing.head, continuing.head]);
  assert.deepEqual(asks, [continuing, continuing]);
  assert.deepEqual(await columnsOf(built.fake), { 81: COLUMNS.coding });
  assert.deepEqual(built.dispatches.started, []);
});

/** A returned Review card whose maker continues from `old`, leaving `tip` in its workspace. */
function continuingForge(old, tip, pause, tipRead = async () => tip) {
  const card = 96;
  const pull = 961;
  let elapsed = 0;
  const built = world({
    cards: [cardIn(card, COLUMNS.review)],
    kinds: { change: { ...KINDS.change, judges: ['reviewer'] } },
    forge: { pullRequests: [{ number: pull, head: `rigger-${card}`, sha: old, mergeBase: 'c'.repeat(40), diff: 'diff --git a/help b/help\n', mergeable: 'mergeable', comments: [
      markerComment({ card, pull, head: old, body: PASSING, role: 'reviewer', verdict: 'needs revision', items: ['unmet'], toSound: 'Fix the help line.' }),
    ] }] },
    workspaceTip: tipRead,
    clock: { now: () => elapsed, pause: async (milliseconds) => {
      assert.equal(milliseconds, 5000);
      elapsed += milliseconds;
      pause?.(built);
    } },
  });
  return { built, card, pull, elapsed: () => elapsed };
}

/** Releases this pull's maker and any judge stand-ins, without another pull of its card. */
async function continuingPull(built) {
  const pulled = built.loop.pull();
  const done = settledOf(pulled);
  for (let round = 0; round < 5 && !done(); round += 1) {
    await positive(() => done() || built.dispatches.holding().length > 0);
    built.dispatches.releaseAll();
  }
  assert.ok(done(), 'the continuing pull did not settle after its dispatches');
  return pulled;
}

// proves R-WORK-34, R-RECORD-11, R-RECORD-12
test('a continuing maker is judged only after the forge shows the workspace tip on its second read', async () => {
  const old = 'a'.repeat(40);
  const tip = 'b'.repeat(40);
  const { built, card, pull, elapsed } = continuingForge(old, tip, (world) => world.repository.update(pull, { sha: tip }));

  await continuingPull(built);

  assert.equal(elapsed(), 5000);
  const returned = built.events().find(({ layer, event, card: number, cause }) => layer === 'L2' && event === 'transition' && number === card && cause === 'returned');
  assert.deepEqual({ forgeHead: returned.forgeHead, reads: returned.reads, elapsedMs: returned.elapsedMs }, { forgeHead: tip, reads: 2, elapsedMs: 5000 });
  const heads = built.decisions.filter(({ card: number, action }) => number === card && action.action === 'judge')
    .flatMap(({ action }) => action.judges.map(({ facts }) => facts.head));
  assert.ok(heads.includes(tip), JSON.stringify(heads));
  assert.ok(!heads.includes(old), JSON.stringify(heads));
  assert.ok(built.events().some(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'reviewer'));
});

// proves R-WORK-34, R-RECORD-11, R-RECORD-12
test('a continuing maker stays in coding after the forge shows the old head through the read at 60 seconds', async () => {
  const old = 'a'.repeat(40);
  const tip = 'b'.repeat(40);
  const { built, card, elapsed } = continuingForge(old, tip);

  await continuingPull(built);

  assert.equal(elapsed(), 60000);
  assert.equal((await columnsOf(built.fake))[card], COLUMNS.coding);
  assert.equal(built.events().some(({ layer, event, cause }) => layer === 'L2' && event === 'transition' && cause === 'returned'), false);
  const withheld = built.events().find(({ layer, event, card: number }) => layer === 'L2' && event === 'review.withheld' && number === card);
  assert.match(withheld.reason, /card #96/);
  assert.match(withheld.reason, new RegExp(tip));
  assert.match(withheld.reason, new RegExp(old));
  assert.deepEqual({ forgeHead: withheld.forgeHead, reads: withheld.reads, elapsedMs: withheld.elapsedMs }, { forgeHead: old, reads: 13, elapsedMs: 60000 });
});

// proves R-WORK-34, R-RECORD-11, R-RECORD-12
test('a continuing maker records the last forge head and wait when its pull closes after a stale read', async () => {
  const old = 'a'.repeat(40);
  const tip = 'b'.repeat(40);
  const { built, card, pull } = continuingForge(old, tip, (world) => world.repository.update(pull, { merged: true }));

  await continuingPull(built);

  assert.equal((await columnsOf(built.fake))[card], COLUMNS.coding);
  const withheld = built.events().find(({ layer, event, card: number }) => layer === 'L2' && event === 'review.withheld' && number === card);
  assert.match(withheld.reason, /no open pull request/);
  assert.deepEqual({ forgeHead: withheld.forgeHead, reads: withheld.reads, elapsedMs: withheld.elapsedMs }, { forgeHead: old, reads: 2, elapsedMs: 5000 });
});

// proves R-WORK-34, R-RECORD-11, R-RECORD-12
test('a failed second forge read keeps a continuing card in coding and records the last head and wait', async () => {
  const old = 'a'.repeat(40);
  const tip = 'b'.repeat(40);
  const { built, card, elapsed } = continuingForge(old, tip, (world) => {
    world.repository.operations.readPullRequests = async () => { throw new Error('the forge read failed: HTTP 502'); };
  });

  await continuingPull(built);

  assert.equal((await columnsOf(built.fake))[card], COLUMNS.coding);
  assert.equal(elapsed(), 5000);
  assert.equal(built.events().some(({ layer, event, cause }) => layer === 'L2' && event === 'transition' && cause === 'returned'), false);
  const withheld = built.events().find(({ layer, event, card: number }) => layer === 'L2' && event === 'review.withheld' && number === card);
  assert.match(withheld.reason, /HTTP 502/);
  assert.match(withheld.reason, /card #96/);
  assert.deepEqual({ forgeHead: withheld.forgeHead, reads: withheld.reads, elapsedMs: withheld.elapsedMs }, { forgeHead: old, reads: 2, elapsedMs: 5000 });
});

// proves R-WORK-34
test('a continuing maker stays in coding when L1 cannot read a tip from its workspace', async () => {
  const old = 'a'.repeat(40);
  const { built, card } = continuingForge(old, old, undefined, async () => { throw new Error('the branch has no commit'); });

  await continuingPull(built);

  assert.equal((await columnsOf(built.fake))[card], COLUMNS.coding);
  assert.equal(built.events().some(({ layer, event, cause }) => layer === 'L2' && event === 'transition' && cause === 'returned'), false);
  const withheld = built.events().find(({ layer, event, card: number }) => layer === 'L2' && event === 'review.withheld' && number === card);
  assert.match(withheld.reason, /card #96.*branch has no commit/);
});

test('a refused event while reading a continuing workspace tip halts rather than withholding review', async () => {
  const old = 'a'.repeat(40);
  const refusal = Object.assign(new Error('the sink refused a tip-read event'), { code: EVENT_REFUSED });
  const { built, card } = continuingForge(old, old, undefined, async () => { throw refusal; });

  await assert.rejects(continuingPull(built), (failure) => leavesOf(failure).some(({ message }) => /sink refused a tip-read event/.test(message)));

  assert.equal(built.events().some(({ event }) => event === 'review.withheld'), false);
  assert.equal((await columnsOf(built.fake))[card], COLUMNS.coding);
});

// proves R-SCHED-6
test('a merge answer takes a claim, records its pull and holds no slot, leaving the sole slot for a Ready maker under pull and run', async () => {
  const head = '8'.repeat(40);
  for (const mode of ['pull', 'run']) {
    const built = world({
      cards: [cardIn(82, COLUMNS.owner), readyCard(95)], concurrency: 1,
      forge: { pullRequests: [{
        number: 182, head: 'rigger-82', sha: head, mergeable: 'mergeable',
        comments: [markerComment({ card: 82, pull: 182, head, body: PASSING, role: 'owner' })],
      }] },
    });
    const fired = mode === 'pull' ? built.loop.pull() : built.loop.run();
    await settling(built, settledOf(fired));

    assert.deepEqual(built.decisions.find(({ card }) => card === 82)?.action, { action: 'merge', pull: 182, head });
    assert.deepEqual(built.dispatches.started, [95], `${mode} starts the Ready maker past merge`);
    assert.deepEqual(built.l3Events().filter(({ event }) => event === 'pull').map(({ card, inFlight }) => ({ card, inFlight })), [{ card: 82, inFlight: 0 }, { card: 95, inFlight: 1 }]);
    assert.deepEqual(cardsOf(built, 'slot.release').filter((card) => card === 82), []);
    built.dispatches.releaseAll();
    const reached = await fired;
    assert.ok(reached.some(({ card }) => card === 95), `${mode} returns the Ready card`);
    assert.ok(reached.some(({ card, action }) => card === 82 && action === 'merge'), `${mode} takes a merge claim`);
    assert.equal(built.l3Events().filter(({ event, card }) => event === 'pull' && card === 82).length, 1);
    assert.deepEqual(cardsOf(built, 'slot.release').filter((card) => card === 82), []);
  }
});

for (const { action, method, ruling, merged } of [
  { action: 'move', method: 'moved', merged: true },
  { action: 'return', method: 'returned', ruling: { coverage: 'insufficient', coverageReason: 'The card asks for two verbs.' } },
  { action: 'escalate', method: 'escalated', ruling: { verdict: 'critical', toSound: 'Keep the user files.' } },
]) {
  test(`overlapping triggers hold one ${action} claim until its L2 write settles`, async () => {
    const card = 97;
    const pull = 971;
    const sha = '9'.repeat(40);
    const comments = ruling === undefined ? [] : [markerComment({ card, pull, head: sha, body: PASSING, role: 'owner', ...ruling })];
    const built = world({
      cards: [cardIn(card, action === 'move' ? COLUMNS.review : COLUMNS.owner)], concurrency: 1,
      forge: { pullRequests: [{ number: pull, head: `rigger-${card}`, sha, merged: merged ?? false, mergeable: 'mergeable', comments }] },
    });
    let settle;
    const held = new Promise((resolve) => { settle = resolve; });
    let writes = 0;
    const write = built.l2[method];
    built.l2[method] = async (...args) => {
      writes += 1;
      await held;
      return write(...args);
    };

    const running = built.loop.run();
    await positive(() => writes === 1);
    assert.deepEqual(await built.loop.pull(), []);
    assert.equal(writes, 1);
    assert.deepEqual(cardsOf(built, 'slot.release'), []);
    settle();
    await running;

    assert.equal(writes, 1);
    assert.deepEqual(cardsOf(built, 'slot.release'), [card]);
    assert.equal(triggersOf(built).filter((trigger) => trigger === 'pull').length, 3);
    assert.equal(built.events().filter(({ event }) => event === 'transition').length, action === 'move' || action === 'escalate' ? 1 : 0);
    if (action === 'return') assert.equal(built.repository.pull(pull).comments.length, 2);
    if (action === 'escalate') assert.equal(built.events().filter(({ event }) => event === 'review.escalate').length, 1);
  });
}

// proves R-WORK-35
test('a pull that reads a person-merged pull request records removal before the transition to Done', async () => {
  let built;
  built = world({
    cards: [cardIn(84, COLUMNS.review)],
    forge: { pullRequests: [{ number: 841, head: 'rigger-84', sha: '8'.repeat(40), merged: true }] },
    removeDirectories: async (card) => { built.sink.emitter({ layer: 'L1', card }).emit('workspace.removed', { path: '/card-84' }); },
  });

  await built.loop.pull();

  const events = built.events();
  const removal = events.findIndex(({ layer, event, card }) => layer === 'L1' && event === 'workspace.removed' && card === 84);
  assert.deepEqual(events.filter(({ layer, card }) => layer === 'L3' && card === 84).map(({ event }) => event), ['pull', 'slot.release']);
  const done = events.findIndex(({ layer, event, card, to }) => layer === 'L2' && event === 'transition' && card === 84 && to === 'done');
  assert.ok(removal >= 0 && removal < done, JSON.stringify(events));
});

test('a refused move names both columns and leaves another card in the same pull working', async () => {
  const fake = boardOf([cardIn(91, COLUMNS.review), 92]);
  const items = {
    ...fake.operations,
    moveItem: async (id, column) => {
      if (id === 'item-1' && column === COLUMNS.done) throw new Error('the board refused Done');
      return fake.operations.moveItem(id, column);
    },
  };
  const built = world({
    fake, items, concurrency: 2,
    forge: { pullRequests: [{ number: 911, head: 'rigger-91', sha: '9'.repeat(40), merged: true }] },
  });

  const tick = built.loop.pull();
  await positive(() => built.dispatches.holding().includes(92));
  built.dispatches.releaseAll();
  await assert.rejects(tick, (failure) => {
    const messages = leavesOf(failure).map(({ message }) => message);
    assert.ok(messages.some((message) => /card #91.*review.*done.*board refused Done/.test(message)), JSON.stringify(messages));
    return true;
  });

  assert.deepEqual(built.dispatches.started, [92]);
  assert.deepEqual(built.events().filter(({ event, card }) => event === 'transition' && card === 91), []);
  assert.deepEqual(await columnsOf(fake), { 91: COLUMNS.review, 92: COLUMNS.review });
});

test('a refused continuing claim move starts no maker and fires no next pull', async () => {
  const card = 93;
  const pull = 931;
  const sha = '9'.repeat(40);
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: [cardIn(card, COLUMNS.review)], refuseMoves: true });
  const built = world({
    fake, concurrency: 1, kinds: { change: { ...KINDS.change, judges: ['reviewer'] } },
    forge: { pullRequests: [{ number: pull, head: `rigger-${card}`, sha, mergeable: 'mergeable', comments: [markerComment({ card, pull, head: sha, body: PASSING, role: 'reviewer', verdict: 'needs revision', items: ['unmet'], toSound: 'Fix the help line.' })] }] },
  });

  await assert.rejects(built.loop.run(), (failure) => {
    const messages = leavesOf(failure).map(({ message }) => message);
    assert.ok(messages.some((message) => /card #93.*review.*coding/.test(message)), JSON.stringify(messages));
    return true;
  });
  assert.deepEqual(built.dispatches.started, []);
  assert.equal(triggersOf(built).filter((trigger) => trigger === 'pull').length, 1);
  assert.deepEqual(await columnsOf(fake), { [card]: COLUMNS.review });
});

test('an ignored Owner card leaves the sole slot for a Ready maker in the same pull', async () => {
  const ignored = { ...cardIn(94, COLUMNS.owner), labels: [] };
  const built = world({ cards: [ignored, readyCard(95)], concurrency: 1 });

  const tick = built.loop.pull();
  await positive(() => built.dispatches.holding().includes(95));
  assert.deepEqual(built.dispatches.started, [95]);
  assert.deepEqual(cardsOf(built, 'pull'), [95]);
  assert.deepEqual(await columnsOf(built.fake), { 94: COLUMNS.owner, 95: COLUMNS.coding });
  built.dispatches.releaseAll();
  await tick;
});

test('after a card\'s slot is released with the forge holding nothing from its line of work, so no marker makes it fresh, the next tick pulls that card again', async () => {
  const built = world({ cards: [5], concurrency: 1, fresh: false, answer: () => ({ exit: 1, output: '' }) });

  const first = built.loop.pull();
  // Positive: until card 5's stand-in is held.
  await positive(() => built.dispatches.holding().includes(5));
  built.dispatches.releaseAll();
  await first;
  assert.deepEqual(built.dispatches.started, [5]);

  const second = built.loop.pull();
  // Positive: until card 5's stand-in is held.
  await positive(() => built.dispatches.holding().includes(5));
  built.dispatches.releaseAll();
  await second;

  assert.deepEqual(built.dispatches.started, [5, 5]);
});

test('when the board refuses a card\'s claim move, L3 does not hand that card to the dispatch, and frees its slot', async () => {
  const fake = boardOf([8]);
  let refused = 0;
  const items = {
    ...fake.operations,
    moveItem: async (...args) => {
      if (refused === 0) {
        refused += 1;
        throw new Error('the board refused the move');
      }
      return fake.operations.moveItem(...args);
    },
  };
  const built = world({ fake, concurrency: 1, items });

  const first = assert.rejects(built.loop.pull(), (failure) => {
    assert.match(failure.errors[0].message, /card #8's move from ready to coding .* was refused: the board refused the move/);
    return true;
  });
  const refusedPull = settledOf(first);
  await settling(built, refusedPull);
  assert.deepEqual(built.dispatches.started, []);
  assert.deepEqual(fake.writes(), []);
  built.dispatches.releaseAll();
  await first;

  // Concurrency is 1, so the card is pulled and dispatched on the next tick only if its slot was freed.
  const next = built.loop.pull();
  // Positive: until card 8 is held.
  await positive(() => built.dispatches.holding().includes(8));
  assert.deepEqual(built.dispatches.started, [8]);
  built.dispatches.releaseAll();
  await next;
});

test('when the board read fails, L3 hands no card to the dispatch and passes on the read\'s message, code and unreadable entries in an error it built', async () => {
  // #215's missing-column error: the read side's column read, through the fake gh, of a board whose
  // Status field lacks the declared `Owner`.
  const gh = installFakeGh(temporaryDirectory('rigger-loop-gh-'), {
    repo: config.repo,
    project: config.board.project,
    board: { columns: ['Ready', 'Coding', 'Review', 'Needs Owner', 'Done'], items: [readyCard(9)] },
  });
  const send = (command, args) => spawnSync(process.execPath, [gh.gh, ...args], { encoding: 'utf8' });
  const side = readSide({ repo: config.repo, project: config.board.project, columns: COLUMNS }, { send });
  let thrown;
  const board = {
    readColumns: () => side.readColumns().catch((error) => {
      thrown = error;
      throw error;
    }),
    readPriority: async () => assert.fail('the loop read the items after the column read failed'),
  };
  const built = world({ cards: [9], board });

  await assert.rejects(built.loop.pull(), (error) => {
    assert.ok(thrown, 'the column read failed');
    assert.equal(error.message, thrown.message);
    assert.equal(error.code, thrown.code);
    assert.deepEqual(error.unreadable, thrown.unreadable);
    assert.ok(error.message.includes('owner (Owner)'), error.message);
    return true;
  });
  assert.deepEqual(built.dispatches.started, []);
});

test('L3 hands L2 every dispatch outcome, one returned and one failed', async () => {
  const received = [];
  const built = world({
    cards: [10, 11],
    concurrency: 2,
    answer: (card) => (card.number === 10 ? { exit: 0, output: '' } : new Error('the dispatch could not start')),
  });
  const settled = built.l2.settled;
  built.l2.settled = (card, outcome) => {
    received.push([card.number, outcome.status]);
    return settled(card, outcome);
  };

  const tick = built.loop.pull();
  // Positive: until card 10 is held and card 11's outcome has reached L2, card 11's maker never starting.
  await positive(() => built.dispatches.holding().includes(10) && received.some(([number]) => number === 11));
  built.dispatches.releaseAll();
  await assert.rejects(tick, heldCard(11));

  assert.deepEqual(received.sort(), [[10, 'fulfilled'], [11, 'rejected'], [11, 'rejected']]);
});

test("the forge adapter's read side, passed whole, is L3's board handle: the declared priority orders the pulls, and the claim move reaches the board", async () => {
  // Card 21 holds Low and card 22 holds High, and the board lists its options Low, High, Normal,
  // so at concurrency 1 the first card dispatched shows which order L3 was handed.
  const gh = installFakeGh(temporaryDirectory('rigger-loop-gh-'), {
    repo: config.repo,
    project: config.board.project,
    board: {
      columns: Object.values(COLUMNS),
      fields: [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }],
      items: [{ ...readyCard(21), fieldValues: { Priority: 'Low' } }, { ...readyCard(22), fieldValues: { Priority: 'High' } }],
    },
  });
  const send = (command, args) => spawnSync(process.execPath, [gh.gh, ...args], { encoding: 'utf8' });
  const where = { repo: config.repo, ...config.board };
  const built = world({ cards: [], concurrency: 1, board: readSide(where, { send }), items: itemWriteSide(where, { send }) });

  const tick = built.loop.pull();
  // Positive: until card 22 is held.
  await positive(() => built.dispatches.holding().includes(22));
  assert.deepEqual(built.dispatches.started, [22]);
  built.dispatches.releaseAll();
  await tick;

  const columns = Object.fromEntries((await (await gh.model()).operations.readItems()).map((item) => [item.number, item.column]));
  assert.deepEqual(columns, { 21: 'Ready', 22: 'Review' });
});

test('at the start of a run, L3 writes one event recording the run\'s concurrency', async () => {
  const built = world({ cards: [1, 2], concurrency: 2 });

  await drive(built);

  const starts = built.l3Events().filter((event) => event.event === 'run.start');
  assert.equal(starts.length, 1, JSON.stringify(built.l3Events()));
  assert.equal(starts[0].concurrency, 2);
  assert.equal(built.l3Events()[0].event, 'run.start', 'the run records its start before anything else');
});

test('every pull writes one event naming the card, its kind, the queue depth and the number in flight', async () => {
  const built = world({ cards: [1, 2, 3], concurrency: 2 });

  const run = built.loop.run();
  const ran = settledOf(run);
  // Positive: until cards 1 and 2 are held; then until card 3 is; then a settling wait.
  await positive(() => built.dispatches.held() === 2);
  built.dispatches.release(1);
  await positive(() => built.dispatches.holding().includes(3));
  built.dispatches.releaseAll();
  await settling(built, ran);
  built.dispatches.releaseAll();
  await run;

  // The first read finds 1, 2 and 3 pullable and two slots free: pulling 1 leaves 2 and 3
  // waiting with 1 in flight, and pulling 2 leaves 3 waiting with 1 and 2 in flight. Card 1's
  // release fires a read that finds only 3, which leaves nothing waiting, with 2 and 3 in flight.
  const pulls = built.l3Events().filter((event) => event.event === 'pull' && event.kind === 'change')
    .map(({ card, kind, queueDepth, inFlight }) => ({ card, kind, queueDepth, inFlight }));
  assert.deepEqual(pulls, [
    { card: 1, kind: 'change', queueDepth: 2, inFlight: 1 },
    { card: 2, kind: 'change', queueDepth: 1, inFlight: 2 },
    { card: 3, kind: 'change', queueDepth: 0, inFlight: 2 },
  ]);
  const ownerPulls = built.l3Events().filter((event) => event.event === 'pull' && event.kind === undefined);
  assert.deepEqual(ownerPulls.map(({ card }) => card).sort(), [1, 2, 3]);
  for (const { queueDepth, inFlight } of ownerPulls) {
    assert.ok(Number.isInteger(queueDepth) && queueDepth >= 0);
    assert.ok(Number.isInteger(inFlight) && inFlight >= 1);
  }
});

test('given a board whose column read answers one turn later than the fake\'s, every pull writes one event naming the card, its kind, the queue depth and the number in flight', async () => {
  const fake = boardOf([1, 2, 3]);
  const built = world({ fake, board: readingLater(fake), concurrency: 2 });

  const run = built.loop.run();
  const ran = settledOf(run);
  // Positive: until cards 1 and 2 are held; then until card 3 is; then a settling wait.
  await positive(() => built.dispatches.held() === 2);
  built.dispatches.release(1);
  await positive(() => built.dispatches.holding().includes(3));
  built.dispatches.releaseAll();
  await settling(built, ran);
  built.dispatches.releaseAll();
  await run;

  const pulls = built.l3Events().filter((event) => event.event === 'pull' && event.kind === 'change').map(({ card, queueDepth, inFlight }) => ({ card, queueDepth, inFlight }));
  assert.deepEqual(pulls, [{ card: 1, queueDepth: 2, inFlight: 1 }, { card: 2, queueDepth: 1, inFlight: 2 }, { card: 3, queueDepth: 0, inFlight: 2 }]);
  const ownerPulls = built.l3Events().filter((event) => event.event === 'pull' && event.kind === undefined);
  assert.deepEqual(ownerPulls.map(({ card }) => card).sort(), [1, 2, 3]);
  for (const { queueDepth, inFlight } of ownerPulls) {
    assert.ok(Number.isInteger(queueDepth) && queueDepth >= 0);
    assert.ok(Number.isInteger(inFlight) && inFlight >= 1);
  }
});

/** The cards named by `built`'s L3 events named `name`, in the order recorded. */
const cardsOf = (built, name) => built.l3Events().filter((event) => event.event === name).map(({ card }) => card);

test('every slot release writes one event naming the card, whether its dispatch returned or threw', async () => {
  const built = world({ cards: [1, 2, 3], concurrency: 2, answer: (card) => (card.number === 2 ? new Error('the dispatch could not start') : { exit: 0, output: '' }) });

  await assert.rejects(drive(built), heldCard(2));

  assert.deepEqual([...cardsOf(built, 'slot.release')].sort(), [1, 2]);
});

test('a slot freed by a claim move the board refused writes one release event naming the card', async () => {
  const refusing = createFakeBoard({ columns: Object.values(COLUMNS), items: [1, 2].map((number) => readyCard(number)), refuseMoves: true });
  const built = world({ fake: refusing, concurrency: 2 });

  await drive(built).catch(() => {});

  assert.deepEqual([...cardsOf(built, 'slot.release')].sort(), [1, 2]);
});

/** The value of the `trigger` field on each of `built`'s L3 `trigger` events, in the order recorded. */
const triggersOf = (built) => built.l3Events().filter((event) => event.event === 'trigger').map(({ trigger }) => trigger);

test('every firing of the pull trigger writes one event naming the trigger as pull', async () => {
  // Each firing reads the board once, including the releases of moves to Owner.
  const fake = boardOf([1, 2]);
  let reads = 0;
  const board = handleOn(fake, { beforeRead: () => { reads += 1; } });
  const built = world({ fake, board, concurrency: 1 });

  await drive(built);
  const tick = built.loop.pull();
  const pulled = settledOf(tick);
  // Positive: until the pull's card is held, or the pull has settled having claimed none.
  await positive(() => pulled() || built.dispatches.held() > 0);
  built.dispatches.releaseAll();
  await tick;

  assert.equal(reads, 6);
  assert.equal(triggersOf(built).filter((trigger) => trigger === 'pull').length, reads);
});

test('in a run that pulls cards and then drains, the drain trigger writes exactly one drain event, after the last release', async () => {
  // Concurrency 3 over three cards released together: each release fires a pull that finds
  // nothing, so three pulls race to see the board empty, and the idle period they share is one.
  const built = world({ cards: [1, 2, 3], concurrency: 3 });

  await drive(built);

  assert.deepEqual(triggersOf(built).filter((trigger) => trigger === 'drain'), ['drain']);
  const names = built.l3Events().map(({ event, trigger }) => (trigger === 'drain' ? 'drain' : event));
  assert.ok(names.indexOf('drain') > names.lastIndexOf('slot.release'), JSON.stringify(names));
});

test('a run that starts with nothing to pull writes exactly one drain event and no pull event', async () => {
  const built = world({ cards: [], concurrency: 2 });

  await drive(built);

  assert.deepEqual(triggersOf(built).filter((trigger) => trigger === 'drain'), ['drain']);
  assert.deepEqual(cardsOf(built, 'pull'), []);
});

test('while a card is in flight, the drain trigger writes no event, and it writes one once the held dispatch returns', async () => {
  const built = world({ cards: [1, 2], concurrency: 2 });

  const run = built.loop.run();
  // Positive: until cards 1 and 2 are held.
  await positive(() => built.dispatches.held() === 2);
  built.dispatches.release(1);
  // Positive: until card 1's slot.release and the pull it fired are recorded.
  // The Owner move adds one release and read before card 2's maker returns.
  await positive(() => cardsOf(built, 'slot.release').filter((card) => card === 1).length === 2 && built.fake.requests().filter(({ operation }) => operation === 'readPriority').length === 3);
  assert.equal(built.fake.requests().filter(({ operation }) => operation === 'readPriority').length, 3);
  assert.deepEqual(built.dispatches.holding(), [2], "card 2's dispatch is held open");
  assert.ok(triggersOf(built).includes('pull'), "card 1's release fired a pull that found nothing");
  assert.deepEqual(triggersOf(built).filter((trigger) => trigger === 'drain'), []);

  built.dispatches.releaseAll();
  await run;

  assert.deepEqual(triggersOf(built).filter((trigger) => trigger === 'drain'), ['drain']);
});

/** The drain events `built`'s L3 has written so far. */
const drainsOf = (built) => triggersOf(built).filter((trigger) => trigger === 'drain');

/** Fires one pull on `built`'s loop, releases whatever it dispatched, and waits for it to settle. */
async function pullOnce(built) {
  const tick = built.loop.pull();
  const pulled = settledOf(tick);
  await settling(built, pulled);
  built.dispatches.releaseAll();
  await tick;
}

test('on one loop, a pull that claims a card after a drain ends that idle period, and the next empty pull writes exactly one drain event', async () => {
  // Card 1 is on the board but hidden from the reads until the test shows it, so the first pull
  // finds nothing, the second claims card 1, and the third finds nothing again.
  const fake = boardOf([1]);
  let shown = false;
  const handle = handleOn(fake);
  const board = {
    readColumns: handle.readColumns,
    readPriority: async () => {
      const answer = await handle.readPriority();
      return { ...answer, items: shown ? answer.items : [] };
    },
  };
  const built = world({ fake, board, concurrency: 1 });

  await pullOnce(built);
  assert.deepEqual(drainsOf(built), ['drain'], 'the first idle period drained');
  shown = true;
  await pullOnce(built);
  assert.deepEqual(built.dispatches.started, [1]);
  assert.deepEqual(cardsOf(built, 'slot.release'), [1]);
  await pullOnce(built);
  assert.deepEqual(await columnsOf(fake), { 1: COLUMNS.owner });
  await pullOnce(built);

  assert.deepEqual(drainsOf(built), ['drain', 'drain'], 'the second idle period drained once');
});

test('on one loop, empty pulls after a drain with no claim since write no further drain event', async () => {
  const built = world({ cards: [], concurrency: 2 });

  await pullOnce(built);
  await pullOnce(built);
  await pullOnce(built);

  assert.equal(triggersOf(built).filter((trigger) => trigger === 'pull').length, 3);
  assert.deepEqual(drainsOf(built), ['drain']);
});

test('on one loop whose pull drained with no claim since, a run that starts with nothing to pull writes exactly one drain event', async () => {
  const built = world({ cards: [], concurrency: 2 });
  await pullOnce(built);
  assert.deepEqual(drainsOf(built), ['drain']);

  await drive(built);

  const names = built.l3Events().map(({ event, trigger }) => trigger ?? event);
  const run = names.slice(names.indexOf('run.start'));
  assert.deepEqual(run.filter((name) => name === 'drain'), ['drain'], JSON.stringify(names));
});

test("each card's pull event is recorded before L2 asks the board to move that card to the coding column", async () => {
  const fake = boardOf([1, 2]);
  const pulledAtMove = [];
  let built;
  const items = {
    ...fake.operations,
    moveItem: async (id, column) => {
      if (column === COLUMNS.coding) pulledAtMove.push([id, cardsOf(built, 'pull')]);
      return fake.operations.moveItem(id, column);
    },
  };
  built = world({ fake, items, concurrency: 2 });

  await drive(built);

  assert.deepEqual(pulledAtMove.map(([id]) => id).sort(), ['item-1', 'item-2']);
  for (const [id, pulled] of pulledAtMove) {
    assert.ok(pulled.includes(Number(id.replace('item-', ''))), `${id} was moved before its pull event: ${JSON.stringify(pulled)}`);
  }
});

test('every event L3 writes carries layer L3, and L1\'s and L0\'s events carry their own layer', async () => {
  const built = world({ cards: [1, 2, { ...readyCard(3), labels: [] }], concurrency: 1, answer: (card) => (card.number === 2 ? new Error('the dispatch could not start') : { exit: 0, output: '' }) });

  await assert.rejects(drive(built), heldCard(2));

  const events = built.events();
  const ofL3 = new Set(['run.start', 'trigger', 'pull', 'slot.release', 'dispatch']);
  assert.ok(built.layers.includes('L3'), 'L3 wrote events');
  assert.deepEqual([...new Set(events.filter((event) => ofL3.has(event.event)).map((event) => event.layer))], ['L3']);
  assert.deepEqual([...new Set(events.filter((event) => event.event === 'dispatch.start' || event.event === 'dispatch.end').map((event) => event.layer))], ['L1']);
  assert.deepEqual(events.filter((event) => event.layer === 'L0' && ofL3.has(event.event)), []);
  assert.ok(events.some((event) => event.layer === 'L2'), "L2's transitions share the stream");
});

test('from the recorded events of a concurrency 3 run over four cards, the most pull-to-release intervals overlapping at any moment is exactly 3', async () => {
  const built = world({ concurrency: 3 });

  await drive(built);

  // Each card's interval runs from its pull event's time to its release event's time, and the
  // sink's clock ticks once per event, so no two events share a time.
  const at = (name) => Object.fromEntries(built.l3Events().filter((event) => event.event === name && (name !== 'pull' || event.kind === 'change')).map(({ card, ts }) => [card, Date.parse(ts)]));
  const pulled = at('pull');
  const released = at('slot.release');
  assert.deepEqual(Object.keys(pulled).sort(), ['1', '2', '3', '4']);
  assert.deepEqual(Object.keys(released).sort(), ['1', '2', '3', '4']);
  const intervals = Object.keys(pulled).map((card) => [pulled[card], released[card]]);
  const overlapping = (moment) => intervals.filter(([from, to]) => from <= moment && moment < to).length;
  assert.equal(Math.max(...intervals.map(([from]) => overlapping(from))), 3);
});

// L3's single pull: claims up to a limit capped at N.

/**
 * How long a test of the single pull may run, which bounds each of its condition waits: `until`
 * rejects once the test has ended, and each wait of the harness rejects at half of it. A judgment,
 * whose premise is a measurement of waits on stand-in maker processes run through L1: across
 * three full `npm test` runs with Node 26.5.0 on macOS 27.0 on this 12-CPU host on 2026-10-03, at
 * one-minute loads of 20.85, 19.38 and 20.00 as each began, the longest of the 221 waits a run
 * made that held took 1,139 ms. So a condition that has not held in half this long never will.
 */
const { 10_000: SETTLES_WITHIN } = BOUNDS;

/** The first condition still missing from a timed single-pull world. */
function targetBoundary(record, bodyStart, now = () => performance.now()) {
  const { built, limit, begun } = record;
  const elapsedMs = now() - bodyStart;
  if (!built) return { phase: 'W', cell: `W-b-${limit ?? 'N'}`, world: limit ?? 'N', maker: 'not reached', elapsedMs, beforeBound: elapsedMs < SETTLES_WITHIN.timeout, lastBoundary: 'construction.start', firstMissingCondition: 'world construction end' };
  const phases = built.phaseTrace;
  const has = (name) => phases.some(({ phase }) => phase === name);
  const attempts = built.attempts;
  const makerAttempts = attempts.filter(({ layer, event, fields, accepted }) => layer === 'L3' && event === 'dispatch' && fields.role !== undefined && accepted);
  const markerCards = new Set(phases.filter(({ phase }) => phase === 'held.marker.observed').map(({ card }) => card));
  const pendingMaker = makerAttempts.find(({ card }) => !markerCards.has(card)) ?? makerAttempts.at(-1);
  const maker = pendingMaker ? { card: pendingMaker.card, dispatch: pendingMaker.dispatch } : 'not reached';
  const lastBoundary = phases.at(-1)?.phase ?? 'construction.end';
  const answer = (phase, firstMissingCondition, reachedMaker = maker) => ({ phase, cell: firstMissingCondition.startsWith('none;') ? 'complete' : `${phase}-b-${limit ?? 'N'}`, world: limit ?? 'N', maker: reachedMaker, elapsedMs, beforeBound: elapsedMs < SETTLES_WITHIN.timeout, begun, lastBoundary, firstMissingCondition });
  const identity = (attempt) => ({ card: attempt.card, dispatch: attempt.dispatch });
  if (!has('warm.end') || !has('pull.call')) return answer('W', has('warm.end') ? 'pull call' : 'second real warm completion');
  if (!attempts.some(({ layer, event, accepted }) => layer === 'L3' && event === 'pull' && accepted)) {
    const read = phases.findLast(({ phase }) => phase === 'readColumns.start' || phase === 'readPriority.start');
    return answer('Q', read ? `${read.phase.replace('.start', '')} completion and first claim` : 'first claim after pull trigger and pre-claim reads');
  }
  if (makerAttempts.some(({ card }) => !markerCards.has(card)) || !has('markers.held')) return answer('D', `held marker for claimed maker ${pendingMaker?.card ?? 'not reached'}`);
  if (!has('columns.read.end')) return answer('H', 'post-marker columnsOf/readItems completion');
  if (!has('release.call')) return answer('H', 'release call after post-marker read');
  const exited = new Set(attempts.filter(({ layer, event }) => layer === 'L1' && event === 'dispatch.end').map(({ dispatch }) => dispatch));
  const pendingExit = makerAttempts.find(({ dispatch }) => !exited.has(dispatch));
  if (pendingExit) return answer('P', `stand-in exit and L1 dispatch.end for maker ${pendingExit.card}`, identity(pendingExit));
  const settledCards = new Set(phases.filter(({ phase }) => phase === 'l2.settled.end').map(({ card }) => card));
  const pendingSettlement = makerAttempts.find(({ card }) => !settledCards.has(card));
  if (pendingSettlement) return answer('S2', `L2 settlement end for maker ${pendingSettlement.card}`, identity(pendingSettlement));
  const postDecided = new Set(phases.filter(({ phase, action }) => phase === 'l3.decision' && action !== 'dispatch').map(({ card }) => card));
  const pendingDecision = makerAttempts.find(({ card }) => !postDecided.has(card));
  if (pendingDecision) return answer('S4', `post-settlement L3 decision for maker ${pendingDecision.card}`, identity(pendingDecision));
  const released = new Set(attempts.filter(({ layer, event }) => layer === 'L3' && event === 'slot.release').map(({ card }) => card));
  const pendingRelease = makerAttempts.find(({ card }) => !released.has(card));
  if (pendingRelease) return answer('S4', `slot release and freed return for maker ${pendingRelease.card}`, identity(pendingRelease));
  if (!has('pull.settled')) return answer('S4', 'trigger worked-claims completion and pull settlement');
  return answer('E', has('directory.asserted') ? 'none; exact directory assertion completed' : 'exact directory assertion');
}

/** Keeps the loop target's result to fixed phase and timing fields. */
function boundedPhaseResult(record, bodyStart, guardReport) {
  const boundary = targetBoundary(record, bodyStart);
  const readOperation = boundary.phase === 'Q'
    ? ({ 'readColumns.start': 'readColumns', 'readPriority.start': 'readPriority' }[boundary.lastBoundary] ?? null)
    : null;
  const complete = boundary.phase === 'E' && boundary.lastBoundary === 'directory.asserted';
  const guardBeforeInnerBound = complete ? 'not needed' : guardReport ? (guardReport.beforeBound ? 'before' : 'late') : 'absent';
  const incompleteEvidence = complete ? 'none'
    : !record.built ? 'world absent'
      : guardBeforeInnerBound === 'absent' ? 'guard absent'
        : guardBeforeInnerBound === 'late' ? 'guard late' : 'none';
  return {
    world: boundary.world,
    phase: boundary.phase,
    elapsedMs: Math.max(0, Math.min(20_000, Math.round(boundary.elapsedMs))),
    lastBoundary: boundary.lastBoundary,
    readOperation,
    guardBeforeInnerBound,
    incompleteEvidence,
  };
}

/** A condition-based phase guard which reports only while the named progress condition is false. */
async function diagnosticGuard({ done, snapshot, within }) {
  try {
    await waitFor(done, within);
  } catch (failure) {
    if (!failure.message?.includes(`did not hold within ${within} ms`)) throw failure;
    return snapshot();
  }
  return undefined;
}

/** Settles once `built`'s maker stand-in holds at least `cards` cards, as `until` waits. */
const makersHold = (built, cards, t) => until(() => built.dispatches.held() >= cards, t);

test('a wait on a condition that never holds, in a test bounded at 10,000 ms, rejects once half that bound has passed and before the bound, naming the condition and its bound in milliseconds', SETTLES_WITHIN, async () => {
  const neverHolds = () => 'the board' === 'empty';
  const within = SETTLES_WITHIN.timeout / 2;
  const began = performance.now();

  await assert.rejects(waitFor(neverHolds, within), (failure) => {
    assert.match(failure.message, /'the board' === 'empty'/);
    assert.match(failure.message, /\b5000 ms\b/);
    return true;
  });
  const took = performance.now() - began;
  assert.ok(took >= 5_000 && took < 10_000, `the wait rejected after ${took} ms`);
});

/** The numbers of `cards`, the board items a single pull handed the maker, in the order handed. */
const numbersOf = (cards) => cards.map((card) => card.number);

test('`loop`\'s single pull hands the maker stand-in exactly the cards it claimed', SETTLES_WITHIN, async (t) => {
  const built = world({ concurrency: 3 });

  const pulled = built.loop.pull();
  await makersHold(built, 3, t);
  const claimed = built.handed.map(({ card }) => card);

  assert.deepEqual(numbersOf(claimed), [1, 2, 3]);
  assert.deepEqual(claimed.map((card) => card.id), ['item-1', 'item-2', 'item-3']);
  assert.deepEqual(built.dispatches.holding(), [1, 2, 3]);
  assert.deepEqual(await columnsOf(built.fake), { 1: 'Coding', 2: 'Coding', 3: 'Coding', 4: 'Ready' });
  built.dispatches.releaseAll();
  await pulled;
});

/**
 * One single pull of a world's `loop` over `cards` under `concurrency`, with limit `limit` where it
 * is not undefined, every maker stand-in held, in the test `t`. Answers the numbers of the cards
 * handed to the maker stand-in, and each card's column before any is released, with what `world`
 * built and `release`, which releases every maker stand-in and settles once the pull has.
 *
 * It reads them once the pull has settled, having claimed nothing to hold, or once the maker
 * stand-in holds a card for every pull event, since the pull records each claim's pull event in
 * the step that claims it, before any card reaches the maker.
 */
async function claimOnce({ cards = [1, 2, 3, 4], concurrency, limit } = {}, t) {
  const begun = performance.now();
  const record = t.rigger596Worlds ? { limit, begun, built: null, constructionEnd: 'not reached' } : null;
  if (record) t.rigger596Worlds.push(record);
  const built = world({ cards, concurrency });
  if (record) {
    record.built = built;
    record.constructionEnd = performance.now();
  }
  if (record && limit === undefined && process.env.RIGGER_596_TARGET_HOLD === 'second') {
    t.rigger596ReleaseHold = built.fake.holdNextRead();
  }
  if (process.env.RIGGER_596_PHASE_ACTIVE) {
    const readItems = built.fake.operations.readItems;
    built.fake.operations.readItems = async (...args) => {
      built.phaseTrace.push({ phase: 'columns.readItems.start', at: performance.now() });
      try { return await readItems(...args); }
      finally { built.phaseTrace.push({ phase: 'columns.readItems.end', at: performance.now() }); }
    };
  }
  built.phaseTrace.push({ phase: 'pull.call', at: performance.now() });
  let settled = false;
  const pulled = built.loop.pull(limit).finally(() => {
    settled = true;
    built.phaseTrace.push({ phase: 'pull.settled', at: performance.now() });
  });
  await until(() => settled || (built.dispatches.held() > 0 && built.dispatches.held() === cardsOf(built, 'pull').length), t);
  if (process.env.RIGGER_596_PHASE_ACTIVE) built.sampleTrace();
  built.phaseTrace.push({ phase: 'markers.held', at: performance.now(), cards: built.dispatches.holding() });
  const claimed = numbersOf(built.handed.map(({ card }) => card));
  built.phaseTrace.push({ phase: 'columns.read.start', at: performance.now() });
  const columns = await columnsOf(built.fake);
  built.phaseTrace.push({ phase: 'columns.read.end', at: performance.now() });
  const release = async () => {
    built.phaseTrace.push({ phase: 'release.call', at: performance.now(), cards: built.dispatches.holding() });
    built.dispatches.releaseAll();
    await pulled;
    if (process.env.RIGGER_596_PHASE_ACTIVE) built.sampleTrace();
    built.phaseTrace.push({ phase: 'release.end', at: performance.now() });
  };
  return { claimed, columns, built, release };
}

test('given concurrency 3, four pullable cards and a claim limit of 1, `loop`\'s single pull claims exactly one card', SETTLES_WITHIN, async (t) => {
  const { claimed, columns, release } = await claimOnce({ concurrency: 3, limit: 1 }, t);

  assert.deepEqual(claimed, [1]);
  assert.deepEqual(columns, { 1: 'Coding', 2: 'Ready', 3: 'Ready', 4: 'Ready' });
  await release();
});

test('given concurrency 1, four pullable cards and a claim limit of 3, `loop`\'s single pull claims exactly one card', SETTLES_WITHIN, async (t) => {
  const { claimed, columns, release } = await claimOnce({ concurrency: 1, limit: 3 }, t);

  assert.deepEqual(claimed, [1]);
  assert.deepEqual(columns, { 1: 'Coding', 2: 'Ready', 3: 'Ready', 4: 'Ready' });
  await release();
});

test('given concurrency 3, four pullable cards and no claim limit, `loop`\'s single pull claims exactly three cards', SETTLES_WITHIN, async (t) => {
  const { claimed, columns, release } = await claimOnce({ concurrency: 3 }, t);

  assert.deepEqual(claimed, [1, 2, 3]);
  assert.deepEqual(columns, { 1: 'Coding', 2: 'Coding', 3: 'Coding', 4: 'Ready' });
  await release();
});

test('given concurrency 1, four pullable cards and no claim limit, `loop`\'s single pull claims exactly one card', SETTLES_WITHIN, async (t) => {
  const { claimed, columns, release } = await claimOnce({ concurrency: 1 }, t);

  assert.deepEqual(claimed, [1]);
  assert.deepEqual(columns, { 1: 'Coding', 2: 'Ready', 3: 'Ready', 4: 'Ready' });
  await release();
});

test('given concurrency 3, two pullable cards and no claim limit, `loop`\'s single pull claims both', SETTLES_WITHIN, async (t) => {
  const { claimed, columns, release } = await claimOnce({ cards: [1, 2], concurrency: 3 }, t);

  assert.deepEqual(claimed, [1, 2]);
  assert.deepEqual(columns, { 1: 'Coding', 2: 'Coding' });
  await release();
});

test('given no pullable card, `loop`\'s single pull claims nothing and answers an empty list', SETTLES_WITHIN, async (t) => {
  const { claimed, built, release } = await claimOnce({ cards: [{ ...readyCard(1), labels: [] }], concurrency: 3 }, t);

  assert.deepEqual(claimed, []);
  assert.deepEqual(built.fake.writes(), []);
  await release();
});

// proves R-SCHED-3, R-SCHED-16
test('an owner closer in the state directory stops a Ready card before its claim', async () => {
  const directory = stateOf();
  seed(directory, 'owner-a1.json', closerText({ reason: 'owner paused claims' }));
  const built = world({ cards: [7], directory });
  const pulled = built.loop.pull();
  const done = settledOf(pulled);
  try {
    await settling(built, done);
    assert.deepEqual(built.dispatches.started, []);
    assert.deepEqual(built.fake.writes(), []);
    const answer = await pulled;
    assert.deepEqual(answer.admission?.closers.map(({ kind, reason, time }) => ({ kind, reason, time })), [
      { kind: 'owner', reason: 'owner paused claims', time: TIME },
    ]);
  } finally {
    built.dispatches.releaseAll();
    await pulled.catch(() => {});
  }
});

// proves R-SCHED-3, R-SCHED-16
test('an unreadable admission names every bad path and cause and claims no Ready card', async () => {
  const directory = stateOf();
  seed(directory, 'not-a-closer');
  seed(directory, 'owner-b2.json', '{}');
  const built = world({ cards: [7], directory });
  const pulled = built.loop.pull();
  const done = settledOf(pulled);
  try {
    await settling(built, done);
    assert.deepEqual(built.dispatches.started, []);
    assert.deepEqual(built.fake.writes(), []);
    await assert.rejects(pulled, (failure) => {
      assert.ok(failure.message.includes(`${admissionOf(directory)}/not-a-closer (no closer form)`), failure.message);
      assert.ok(failure.message.includes(`${admissionOf(directory)}/owner-b2.json (no reason, time or run)`), failure.message);
      return true;
    });
  } finally {
    built.dispatches.releaseAll();
    await pulled.catch(() => {});
  }
});

test('a claim limit that is not a positive whole number is refused naming the claim limit, and nothing is claimed', async () => {
  for (const limit of [0, -1, 1.5, '1', Number.NaN, null]) {
    const built = world({ concurrency: 3 });

    await assert.rejects(built.loop.pull(limit), (refusal) => {
      assert.match(refusal.message, /claim limit/);
      assert.ok(refusal.message.includes(typeof limit === 'string' ? `'${limit}'` : String(limit)), refusal.message);
      return true;
    }, String(limit));
    assert.deepEqual(built.fake.writes(), [], String(limit));
    assert.deepEqual(built.fake.requests(), [], String(limit));
  }
});

/**
 * Two concurrent single pulls on one `loop` handle, each with limit `limit`, over one pullable
 * card, while the fake board holds both pulls' reads unresolved and every maker stand-in is held.
 * Answers what each read returned, the cards the two pulls handed the maker stand-in together, and
 * the board's writes, the last two read before any maker stand-in is released.
 */
async function twoClaims(limit, t) {
  const fake = boardOf([7]);
  const releases = [];
  const answered = [];
  const board = handleOn(fake, {
    beforeRead: () => releases.push(fake.holdNextRead()),
    onRead: (items) => answered.push(items.map((item) => [item.number, item.column])),
  });
  const built = world({ fake, concurrency: 2, board });

  const pulls = [built.loop.pull(limit), built.loop.pull(limit)];
  await until(() => releases.length === 2, t);
  assert.equal(releases.length, 2, 'both reads are held at once');
  releases.forEach((release) => release());
  await until(() => answered.length === 2 && built.dispatches.held() >= 1, t);
  const claimed = [...built.dispatches.started];
  const writes = fake.writes();
  built.dispatches.releaseAll();
  await Promise.all(pulls);
  return { answered, claimed, writes };
}

test('given one pullable card, two concurrent `loop`\'s single pulls each with a claim limit of 1 claim it exactly once, though both reads returned it as Ready', SETTLES_WITHIN, async (t) => {
  const { answered, claimed, writes } = await twoClaims(1, t);

  assert.deepEqual(answered, [[[7, 'Ready']], [[7, 'Ready']]]);
  assert.deepEqual(claimed, [7]);
  assert.deepEqual(writes.map(({ operation, args: [, column] }) => [operation, column]), [['moveItem', COLUMNS.coding]]);
});

/** Each claim limit the event items are shown under: 1, and none. */
const LIMITS = [1, undefined];

test('each card `loop`\'s single pull claims from the ready column, with a claim limit of 1 and with none, has one L2 transition event from ready into coding', SETTLES_WITHIN, async (t) => {
  for (const limit of LIMITS) {
    const { claimed, built, release } = await claimOnce({ concurrency: 3, limit }, t);
    const transitions = built.events().filter((event) => event.layer === 'L2' && event.event === 'transition');

    assert.deepEqual(transitions.map(({ card, from, to }) => [card, from, to]), claimed.map((number) => [number, 'ready', 'coding']), String(limit));
    assert.equal(claimed.length, limit ?? 3, String(limit));
    await release();
  }
});

/** A board holding a redo in the coding column, card 5, ahead of three ready cards. */
const REDO_AND_READY = [cardIn(5, COLUMNS.coding), 1, 2, 3];

test('each card `loop`\'s single pull claims, from the ready column or as a redo, with a claim limit of 1 and with none, has one L3 pull event', SETTLES_WITHIN, async (t) => {
  const claims = [];
  for (const limit of LIMITS) {
    const { claimed, built, release } = await claimOnce({ cards: REDO_AND_READY, concurrency: 3, limit }, t);

    assert.deepEqual(cardsOf(built, 'pull'), claimed, String(limit));
    claims.push(claimed);
    await release();
  }
  assert.deepEqual(claims, [[5], [5, 1, 2]]);
});

/** No card in the ready column, and one unclaimed card L2 would dispatch in each of coding and review. */
const REDOS_ONLY = [cardIn(5, COLUMNS.coding), cardIn(6, COLUMNS.review)];

test('given concurrency 3, no ready card, and one dispatchable card each in coding and in review, `loop`\'s single pull with no claim limit returns both as claimed', SETTLES_WITHIN, async (t) => {
  const { claimed, release } = await claimOnce({ cards: REDOS_ONLY, concurrency: 3 }, t);

  assert.deepEqual([...claimed].sort(), [5, 6]);
  await release();
});

// proves R-WORK-24
test('given concurrency 3, no ready card, and one dispatchable card each in coding and in review, the forge holding nothing for either, the board records one move after `loop`\'s single pull, of the review card to coding', SETTLES_WITHIN, async (t) => {
  const { claimed, columns, built, release } = await claimOnce({ cards: REDOS_ONLY, concurrency: 3 }, t);

  assert.equal(claimed.length, 2);
  assert.deepEqual(built.fake.writes(), [{ operation: 'moveItem', args: [(await built.fake.operations.readItems()).find((item) => item.number === 6).id, COLUMNS.coding] }]);
  assert.deepEqual(columns, { 5: COLUMNS.coding, 6: COLUMNS.coding });
  await release();
});

// proves R-WORK-24
test('given concurrency 3, no ready card, and one dispatchable card each in coding and in review, the forge holding nothing for either, the event stream holds exactly one L2 transition after `loop`\'s single pull, the review card\'s from review to coding', SETTLES_WITHIN, async (t) => {
  const { claimed, built, release } = await claimOnce({ cards: REDOS_ONLY, concurrency: 3 }, t);

  assert.equal(claimed.length, 2);
  assert.deepEqual(built.events().filter((event) => event.layer === 'L2').map(({ event, card, from, to }) => ({ event, card, from, to })), [{ event: 'transition', card: 6, from: 'review', to: 'coding' }]);
  await release();
});

test('after `loop`\'s single pull returns, the state directory holds nothing but the event stream', SETTLES_WITHIN, async (t) => {
  const bodyStart = performance.now();
  const deadline = bodyStart + 10_000;
  synchronousDeadline = deadline;
  const stopSynchronousTrace = startSynchronousTrace();
  process.env.RIGGER_596_PHASE_ACTIVE = '1';
  t.rigger596Worlds = [];
  let finished = false;
  let guardReport;
  let guardRecord;
  let bodyEnd;
  const guard = diagnosticGuard({
    done: () => finished,
    snapshot: () => {
      const record = t.rigger596Worlds.find(({ built }) => !built || !built.phaseTrace.some(({ phase }) => phase === 'directory.asserted')) ?? t.rigger596Worlds.at(-1) ?? { limit: 1, begun: bodyStart };
      guardRecord = record;
      return targetBoundary(record, bodyStart);
    },
    within: 8_000,
  }).then((report) => {
    if (!report) return;
    guardReport = report;
    console.error(`RIGGER596_GUARD ${JSON.stringify(report)}`);
    console.error(`RIGGER596_RESULT ${JSON.stringify(boundedPhaseResult(guardRecord, bodyStart, report))}`);
    t.rigger596ReleaseHold?.();
  });
  t.after(async () => {
    const traceEnd = bodyEnd ?? performance.now();
    t.rigger596ReleaseHold?.();
    finished = true;
    await guard;
    for (const limit of LIMITS) {
      const record = t.rigger596Worlds.find((each) => each.limit === limit);
      console.error(`RIGGER596_RESULT ${JSON.stringify(boundedPhaseResult(record ?? { limit, built: null }, bodyStart, guardReport))}`);
      if (!record) {
        console.error(`RIGGER596_TRACE ${JSON.stringify({ limit: limit ?? 'N', bodyStart, deadline, construction: 'not reached', pull: 'not reached', laterPhases: 'not reached' })}`);
        continue;
      }
      const { built, begun, constructionEnd } = record;
      if (!built) {
        console.error(`RIGGER596_TRACE ${JSON.stringify({ limit: limit ?? 'N', bodyStart, deadline, bodyEnd: bodyEnd ?? 'not reached', begun, constructionEnd, pull: 'not reached', laterPhases: 'not reached', synchronousCalls: synchronousSummary(bodyStart, deadline, t.rigger596Worlds, traceEnd) })}`);
        continue;
      }
      built.sampleTrace();
      const attempts = built.attempts.map(({ layer, card, dispatch, event, accepted, at, fields }) => ({ layer, card, dispatch, event, accepted, at: at ?? 'not reached', fields }));
      const runs = built.agent.runs().map(({ card, role, pid }) => ({ card, role, pid }));
      const boundary = targetBoundary(record, bodyStart);
      console.error(`RIGGER596_TRACE ${JSON.stringify({ limit: limit ?? 'N', bodyStart, deadline, bodyEnd: bodyEnd ?? 'not reached', begun, constructionEnd, boundary, synchronousCalls: synchronousSummary(bodyStart, deadline, t.rigger596Worlds, traceEnd), phaseTrace: built.phaseTrace, attempts, runs, board: built.fake.requests(), directory: readdirSync(built.directory, { recursive: true }) })}`);
      built.closeTrace();
    }
    delete process.env.RIGGER_596_PHASE_ACTIVE;
    stopSynchronousTrace();
  });
  for (const limit of LIMITS) {
    const { claimed, built, release } = await claimOnce({ concurrency: 3, limit }, t);
    await release();

    assert.ok(claimed.length > 0, String(limit));
    assert.deepEqual(readdirSync(built.directory, { recursive: true }), ['events.jsonl', 'groups.json'], String(limit));
    built.phaseTrace.push({ phase: 'directory.asserted', at: performance.now(), files: readdirSync(built.directory, { recursive: true }) });
  }
  bodyEnd = performance.now();
});

test('a target boundary uses its supplied clock on both sides of the single-pull deadline', () => {
  const record = { built: null, limit: undefined };
  const before = targetBoundary(record, 100, () => 10_099);
  const atBound = targetBoundary(record, 100, () => 10_100);
  const after = targetBoundary(record, 100, () => 10_101);

  assert.equal(before.elapsedMs, 9_999);
  assert.equal(before.beforeBound, true);
  assert.equal(atBound.elapsedMs, 10_000);
  assert.equal(atBound.beforeBound, false);
  assert.equal(after.elapsedMs, 10_001);
  assert.equal(after.beforeBound, false);
});

/** Reads terminal world results while preserving interim reports for the child diagnostic. */
function completedWorldResults(output) {
  const results = output.split('\n').filter((line) => line.includes('RIGGER596_RESULT '))
    .map((line) => JSON.parse(line.slice(line.indexOf('RIGGER596_RESULT ') + 'RIGGER596_RESULT '.length)))
    .filter(({ phase, lastBoundary }) => phase === 'E' && lastBoundary === 'directory.asserted');
  assert.equal(results.length, 2, 'one bounded result per completed world');
  assert.deepEqual(results.map(({ world }) => world), [1, 'N'], 'one completed result for each expected world');
  return results;
}

test('a completed single-pull target reports bounded results for both worlds', { timeout: 20_000 }, () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const targetName = "after `loop`'s single pull returns, the state directory holds nothing but the event stream";
  const target = spawnSync(process.execPath, [
    '--test',
    `--test-name-pattern=^${targetName}$`,
    decodeURIComponent(new URL(import.meta.url).pathname),
  ], { env, encoding: 'utf8', timeout: 18_000 });
  const output = `${target.stdout ?? ''}\n${target.stderr ?? ''}`;
  assert.equal(target.status, 0, `ordinary target exited ${target.status}; signal ${target.signal ?? 'none'}; error ${target.error?.code ?? 'none'}`);
  const results = completedWorldResults(output);
  assert.deepEqual(results.map(({ world, phase, lastBoundary, guardBeforeInnerBound, incompleteEvidence }) =>
    ({ world, phase, lastBoundary, guardBeforeInnerBound, incompleteEvidence })), [
    { world: 1, phase: 'E', lastBoundary: 'directory.asserted', guardBeforeInnerBound: 'not needed', incompleteEvidence: 'none' },
    { world: 'N', phase: 'E', lastBoundary: 'directory.asserted', guardBeforeInnerBound: 'not needed', incompleteEvidence: 'none' },
  ]);
  for (const result of results) {
    assert.deepEqual(Object.keys(result).sort(), ['elapsedMs', 'guardBeforeInnerBound', 'incompleteEvidence', 'lastBoundary', 'phase', 'readOperation', 'world'].sort());
    assert.equal(result.readOperation, null);
    assert.ok(Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0 && result.elapsedMs < SETTLES_WITHIN.timeout);
  }
});

test('completed-world evidence excludes an earlier interim guard result', () => {
  // The literal schedule is an interim read report followed by both asserted directories.
  const output = `# RIGGER596_RESULT {"world":"N","phase":"Q","elapsedMs":8001,"lastBoundary":"readColumns.start","readOperation":"readColumns","guardBeforeInnerBound":"before","incompleteEvidence":"none"}
# RIGGER596_RESULT {"world":1,"phase":"E","elapsedMs":8500,"lastBoundary":"directory.asserted","readOperation":null,"guardBeforeInnerBound":"not needed","incompleteEvidence":"none"}
# RIGGER596_RESULT {"world":"N","phase":"E","elapsedMs":9000,"lastBoundary":"directory.asserted","readOperation":null,"guardBeforeInnerBound":"not needed","incompleteEvidence":"none"}`;

  assert.deepEqual(completedWorldResults(output), [
    { world: 1, phase: 'E', elapsedMs: 8500, lastBoundary: 'directory.asserted', readOperation: null, guardBeforeInnerBound: 'not needed', incompleteEvidence: 'none' },
    { world: 'N', phase: 'E', elapsedMs: 9000, lastBoundary: 'directory.asserted', readOperation: null, guardBeforeInnerBound: 'not needed', incompleteEvidence: 'none' },
  ]);
});

test('completed-world evidence rejects missing, duplicate and unfinished worlds', () => {
  // Independent terminal identities are the target's literal two limit cases, 1 and N.
  const first = '# RIGGER596_RESULT {"world":1,"phase":"E","elapsedMs":8500,"lastBoundary":"directory.asserted","readOperation":null,"guardBeforeInnerBound":"not needed","incompleteEvidence":"none"}';
  const second = '# RIGGER596_RESULT {"world":"N","phase":"E","elapsedMs":9000,"lastBoundary":"directory.asserted","readOperation":null,"guardBeforeInnerBound":"not needed","incompleteEvidence":"none"}';
  const pending = '# RIGGER596_RESULT {"world":"N","phase":"Q","elapsedMs":8001,"lastBoundary":"readColumns.start","readOperation":"readColumns","guardBeforeInnerBound":"before","incompleteEvidence":"none"}';

  assert.throws(() => completedWorldResults(first), /one bounded result per completed world/, 'missing terminal');
  assert.throws(() => completedWorldResults(`${first}\n${first}`), /one completed result for each expected world/, 'duplicate first world cannot replace the second');
  assert.throws(() => completedWorldResults(`${first}\n${second}\n${second}`), /one bounded result per completed world/, 'extra duplicate terminal');
  assert.throws(() => completedWorldResults(`${first}\n${pending}`), /one bounded result per completed world/, 'a pending world is not completed');
});

test('a loop world records its stand-in warm before the pull can begin', () => {
  const built = world({ cards: [], concurrency: 1 });

  assert.deepEqual(built.phaseTrace.map(({ phase }) => phase), ['warm.start', 'warm.end']);
  assert.ok(built.phaseTrace[0].at <= built.phaseTrace[1].at);
});

test('a held pre-claim read reports the missing Q boundary before the single-pull timeout', SETTLES_WITHIN, async () => {
  const fake = boardOf([1, 2, 3, 4]);
  const releaseRead = fake.holdNextRead();
  const bodyStart = performance.now();
  process.env.RIGGER_596_PHASE_ACTIVE = '1';
  const built = world({ fake, concurrency: 3 });
  built.phaseTrace.push({ phase: 'pull.call', at: performance.now() });
  let settled = false;
  const pulled = built.loop.pull(1).finally(() => { settled = true; });
  try {
    const report = await diagnosticGuard({
      done: () => settled || built.handed.length > 0,
      snapshot: () => targetBoundary({ limit: 1, built, begun: bodyStart }, bodyStart),
      within: 250,
    });
    console.error(`RIGGER596_CONTROL ${JSON.stringify(report)}`);
    assert.equal(report.phase, 'Q');
    assert.equal(report.world, 1);
    assert.equal(report.maker, 'not reached');
    assert.equal(report.lastBoundary, 'readColumns.start');
    assert.match(report.firstMissingCondition, /readColumns/);
    assert.ok(report.elapsedMs < SETTLES_WITHIN.timeout, `guard reported after ${report.elapsedMs} ms`);
    assert.equal(built.handed.length, 0);
  } finally {
    releaseRead();
    await waitFor(() => built.dispatches.held() === 1 || settled);
    built.dispatches.releaseAll();
    await pulled;
    built.closeTrace();
    delete process.env.RIGGER_596_PHASE_ACTIVE;
  }
});

/** Classifies a nested target from its process result and bounded phase records. */
function childOutcome(child, output = '') {
  const records = [];
  for (const line of output.split('\n')) {
    const at = line.indexOf('RIGGER596_RESULT ');
    if (at < 0) continue;
    try {
      const record = JSON.parse(line.slice(at + 'RIGGER596_RESULT '.length));
      if (['W', 'Q', 'D', 'H', 'P', 'S2', 'S4', 'E'].includes(record.phase)
          && ['before', 'late', 'absent', 'not needed'].includes(record.guardBeforeInnerBound)
          && ['none', 'world absent', 'guard absent', 'guard late'].includes(record.incompleteEvidence)) records.push(record);
    } catch { /* An incomplete child record is absent evidence. */ }
  }
  const observed = records.findLast(({ phase, guardBeforeInnerBound }) => phase !== 'E' && guardBeforeInnerBound !== 'not needed')
    ?? records.at(-1);
  const errorCode = child.error?.code ?? null;
  const kind = errorCode === 'ETIMEDOUT' ? 'parent timeout'
    : errorCode ? 'launch error'
      : child.signal ? 'signal'
        : child.status !== 0 && output.includes('test timed out after 10000ms') ? 'inner target timeout'
          : child.status !== 0 ? 'nonzero exit' : 'exited zero';
  return {
    kind,
    status: child.status ?? null,
    errorCode,
    signal: child.signal ?? null,
    phase: observed?.phase ?? null,
    guardBeforeInnerBound: observed?.guardBeforeInnerBound ?? 'absent',
    incompleteEvidence: observed?.incompleteEvidence ?? 'phase and guard absent',
  };
}

/** Reads only the actual recorded stand-in identities from the target's two TRACE worlds. */
function recordedStandInPids(output) {
  const lines = output.split('\n').filter((line) => line.includes('RIGGER596_TRACE '));
  assert.equal(lines.length, 2, 'recorded stand-in provenance needs both worlds exactly once');
  let traces;
  try {
    traces = lines.map((line) => JSON.parse(line.slice(line.indexOf('RIGGER596_TRACE ') + 'RIGGER596_TRACE '.length)));
  } catch {
    assert.fail('recorded stand-in provenance contains malformed JSON');
  }
  assert.ok(traces.every((trace) => trace !== null && typeof trace === 'object' && !Array.isArray(trace)), 'recorded stand-in provenance needs trace objects');
  assert.deepEqual(traces.map(({ limit }) => limit === undefined ? 'N' : limit), [1, 'N'], 'recorded stand-in provenance needs both distinct worlds');
  const pids = [];
  for (const trace of traces) {
    assert.ok(Array.isArray(trace.runs) && trace.runs.length > 0, 'recorded stand-in provenance needs a nonempty run record per world');
    for (const run of trace.runs) {
      assert.ok(run !== null && typeof run === 'object' && Number.isSafeInteger(run.pid) && run.pid > 0, 'recorded stand-in provenance needs positive integer PIDs');
      pids.push(run.pid);
    }
  }
  assert.equal(new Set(pids).size, pids.length, 'recorded stand-in provenance contains duplicate PIDs');
  return pids;
}

/** Observes each proven run identity without treating a live or refused probe as absence. */
function recordedStandInAbsence(output, probe = (pid, signal) => process.kill(pid, signal)) {
  return recordedStandInPids(output).map((pid) => {
    try {
      probe(pid, 0);
      return { pid, state: 'present' };
    } catch (error) {
      return { pid, state: error?.code === 'ESRCH' ? 'absent' : 'unknown' };
    }
  });
}

/** Retains only this held child's separate returned bytes and private observation record. */
function heldChildCustody(prefix, child) {
  if (prefix === undefined) return () => {};
  assert.ok(typeof prefix === 'string' && prefix.startsWith('/') && !prefix.includes('\0'), 'held-child custody prefix refused');
  const privateCreate = { flag: 'wx', mode: 0o600 };
  try {
    for (const stream of ['stdout', 'stderr']) {
      if (Buffer.isBuffer(child[stream])) fs.writeFileSync(`${prefix}.${stream}.original`, child[stream], privateCreate);
    }
  } catch (error) {
    throw Object.assign(new Error('held-child custody refused'), { code: error.code });
  }
  return (observation) => {
    const retained = {
      child: { status: child.status ?? null, errorCode: child.error?.code ?? null, signal: child.signal ?? null },
      streams: {
        stdout: Buffer.isBuffer(child.stdout) ? 'buffer' : child.stdout == null ? 'missing' : 'non-buffer',
        stderr: Buffer.isBuffer(child.stderr) ? 'buffer' : child.stderr == null ? 'missing' : 'non-buffer',
      },
      observation,
    };
    try {
      fs.writeFileSync(`${prefix}.absence-observation.json`, JSON.stringify(retained), privateCreate);
    } catch (error) {
      throw Object.assign(new Error('held-child custody refused'), { code: error.code });
    }
  };
}

test('the target guard reports a held second-world board read before its shared bound', { timeout: 20_000 }, () => {
  const custodyPrefix = process.env.RIGGER1099_PRIVATE_EVIDENCE_PREFIX;
  const env = { ...process.env, RIGGER_596_TARGET_HOLD: 'second' };
  delete env.NODE_TEST_CONTEXT;
  delete env.RIGGER1099_PRIVATE_EVIDENCE_PREFIX;
  const targetName = "after `loop`'s single pull returns, the state directory holds nothing but the event stream";
  const target = spawnSync(process.execPath, [
    '--test',
    `--test-name-pattern=^${targetName}$`,
    decodeURIComponent(new URL(import.meta.url).pathname),
  ], {
    env,
    encoding: 'buffer',
    timeout: 18_000,
  });
  const finishCustody = heldChildCustody(custodyPrefix, target);
  const output = `${target.stdout ?? ''}\n${target.stderr ?? ''}`;
  const child = childOutcome(target, output);
  console.error(`RIGGER596_CHILD ${JSON.stringify(child)}`);
  const probes = [];
  let observations;
  try {
    observations = recordedStandInAbsence(output, (pid, signal) => {
      try {
        const answer = process.kill(pid, signal);
        probes.push({ pid, signal, result: 'returned', errorCode: null });
        return answer;
      } catch (error) {
        probes.push({ pid, signal, result: 'threw', errorCode: typeof error?.code === 'string' ? error.code : null });
        throw error;
      }
    });
  } finally {
    finishCustody({
      provenance: observations === undefined ? null : { worlds: 2, runs: observations.length, pids: observations.map(({ pid }) => pid) },
      observations: observations ?? null,
      probes,
    });
  }
  assert.ok(Buffer.isBuffer(target.stdout) && Buffer.isBuffer(target.stderr), 'held target capture needs both original Buffer streams');
  assert.equal(target.error === undefined, true, 'held target must return without a launch or capture error');
  assert.equal(target.signal, null, 'held target must return without a terminating signal');
  assert.ok(observations.every(({ state }) => state === 'absent'), 'each recorded stand-in must be absent after child exit');
  const guardLine = output.split('\n').find((line) => line.includes('RIGGER596_GUARD '));
  assert.ok(guardLine, JSON.stringify(child));
  const report = JSON.parse(guardLine.slice(guardLine.indexOf('RIGGER596_GUARD ') + 'RIGGER596_GUARD '.length));
  assert.equal(report.phase, 'Q');
  assert.equal(report.world, 'N');
  assert.equal(report.maker, 'not reached');
  assert.equal(report.lastBoundary, 'readColumns.start');
  assert.match(report.firstMissingCondition, /readColumns completion and first claim/);
  assert.ok(report.elapsedMs >= 8_000 && report.elapsedMs < SETTLES_WITHIN.timeout, `guard elapsed ${report.elapsedMs} ms`);
  assert.equal(report.beforeBound, true);
  const results = output.split('\n').filter((line) => line.includes('RIGGER596_RESULT '))
    .map((line) => JSON.parse(line.slice(line.indexOf('RIGGER596_RESULT ') + 'RIGGER596_RESULT '.length)));
  const heldWorld = results.find(({ world }) => world === 'N');
  assert.deepEqual(heldWorld && {
    world: heldWorld.world,
    phase: heldWorld.phase,
    lastBoundary: heldWorld.lastBoundary,
    readOperation: heldWorld.readOperation,
    guardBeforeInnerBound: heldWorld.guardBeforeInnerBound,
    incompleteEvidence: heldWorld.incompleteEvidence,
  }, {
    world: 'N',
    phase: 'Q',
    lastBoundary: 'readColumns.start',
    readOperation: 'readColumns',
    guardBeforeInnerBound: 'before',
    incompleteEvidence: 'none',
  });
  assert.equal(target.status, 0, JSON.stringify(child));
  console.error(`RIGGER596_TARGET_CONTROL ${JSON.stringify(report)}`);
});

test('recorded stand-in provenance requires two distinct nonempty worlds and unique valid PIDs', () => {
  // TRACE uses limit:1 for the first world and omits its undefined limit for the second.
  // stub-claude records process.pid in runs.jsonl; these controlled values are never probed.
  const first = '# RIGGER596_TRACE {"limit":1,"runs":[{"card":1,"role":"engineer","pid":101}]}';
  const second = '# RIGGER596_TRACE {"runs":[{"card":1,"role":"engineer","pid":202}]}';
  assert.doesNotThrow(() => {
    assert.deepEqual(recordedStandInPids(`${first}\n${second}`), [101, 202]);
  }, 'complete two-world provenance is read before any absence probe');

  const refused = [
    '', first, `${first}\n${first}`, `${first}\n${second}\n${second}`,
    `${first}\n# RIGGER596_TRACE {"runs":[]}`,
    `${first}\n# RIGGER596_TRACE {}`,
    `${first}\n# RIGGER596_TRACE {"runs":[{"pid":"202"}]}`,
    `${first}\n# RIGGER596_TRACE {"runs":[{"pid":0}]}`,
    `${first}\n# RIGGER596_TRACE {"runs":[{"pid":1.5}]}`,
    `${first}\n# RIGGER596_TRACE {"runs":[{"pid":101}]}`,
    `${first}\n# RIGGER596_TRACE {"limit":null,"runs":[{"pid":202}]}`,
    `${first}\n# RIGGER596_TRACE {"runs":[{"pid":202},{"pid":202}]}`,
    `${first}\n# RIGGER596_TRACE {`,
  ];
  for (const output of refused) assert.throws(() => recordedStandInPids(output), /recorded stand-in provenance/, 'missing, malformed or duplicate evidence earns no absence credit');
});

test('recorded stand-in absence credits only ESRCH and never probes refused provenance', () => {
  // Node26 process.kill(pid, 0) observes existence without delivering a signal:
  // https://raw.githubusercontent.com/nodejs/node/v26.0.0/doc/api/process.md#processkillpid-signal
  const output = '# RIGGER596_TRACE {"limit":1,"runs":[{"pid":101}]}\n# RIGGER596_TRACE {"runs":[{"pid":202}]}';
  const cases = [
    [() => { throw Object.assign(new Error('absent'), { code: 'ESRCH' }); }, 'absent'],
    [() => true, 'present'],
    [() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); }, 'unknown'],
    [() => { throw Object.assign(new Error('unclassified'), { code: 'EIO' }); }, 'unknown'],
    [() => { throw new Error('no code'); }, 'unknown'],
  ];
  for (const [probe, expected] of cases) {
    const calls = [];
    assert.doesNotThrow(() => {
      const observed = recordedStandInAbsence(output, (pid, signal) => { calls.push([pid, signal]); return probe(); });
      assert.deepEqual(observed, [{ pid: 101, state: expected }, { pid: 202, state: expected }]);
    }, 'a probe result retains the closed absence classification');
    assert.deepEqual(calls, [[101, 0], [202, 0]], 'only signal zero observes each recorded PID');
  }
  let probed = false;
  assert.throws(() => recordedStandInAbsence('', () => { probed = true; }), /recorded stand-in provenance/);
  assert.equal(probed, false, 'invalid provenance must stop before the first OS observation');
});

test('held-child custody preserves separate original buffers before retaining private observations', () => {
  const directory = temporaryDirectory('rigger-loop-custody-');
  const prefix = `${directory}/held`;
  const child = {
    status: 0, error: undefined, signal: null,
    stdout: Buffer.from([0, 255, 10]), stderr: Buffer.from([254, 13, 10]),
  };
  let finish;
  assert.doesNotThrow(() => { finish = heldChildCustody(prefix, child); }, 'the held-child sink accepts a prepared exclusive fixture prefix');
  assert.deepEqual([...fs.readFileSync(`${prefix}.stdout.original`)], [0, 255, 10]);
  assert.deepEqual([...fs.readFileSync(`${prefix}.stderr.original`)], [254, 13, 10]);
  assert.equal(fs.existsSync(`${prefix}.absence-observation.json`), false, 'stream originals precede observation publication');
  assert.equal(fs.statSync(`${prefix}.stdout.original`).mode & 0o777, 0o600);
  assert.equal(fs.statSync(`${prefix}.stderr.original`).mode & 0o777, 0o600);

  finish({
    provenance: { worlds: 2, pids: [101, 202] },
    observations: [{ pid: 101, state: 'absent' }, { pid: 202, state: 'unknown' }],
    probes: [{ pid: 101, signal: 0, result: 'threw', errorCode: 'ESRCH' }, { pid: 202, signal: 0, result: 'threw', errorCode: 'EPERM' }],
  });
  const retained = JSON.parse(fs.readFileSync(`${prefix}.absence-observation.json`, 'utf8'));
  assert.deepEqual(retained, {
    child: { status: 0, errorCode: null, signal: null },
    streams: { stdout: 'buffer', stderr: 'buffer' },
    observation: {
      provenance: { worlds: 2, pids: [101, 202] },
      observations: [{ pid: 101, state: 'absent' }, { pid: 202, state: 'unknown' }],
      probes: [{ pid: 101, signal: 0, result: 'threw', errorCode: 'ESRCH' }, { pid: 202, signal: 0, result: 'threw', errorCode: 'EPERM' }],
    },
  });
  assert.equal(fs.statSync(`${prefix}.absence-observation.json`).mode & 0o777, 0o600);
});

test('an unset held-child custody prefix performs no filesystem write', () => {
  const originalWrite = fs.writeFileSync;
  let writes = 0;
  fs.writeFileSync = () => { writes += 1; throw new Error('unexpected custody write'); };
  try {
    let finish;
    assert.doesNotThrow(() => {
      finish = heldChildCustody(undefined, { status: 0, error: undefined, signal: null, stdout: Buffer.from([1]), stderr: Buffer.from([2]) });
      finish({ provenance: null, observations: null, probes: [] });
    }, 'an unset optional sink preserves ordinary held-control behavior');
    assert.equal(writes, 0, 'unset custody never chooses an implicit destination');
  } finally {
    fs.writeFileSync = originalWrite;
  }
});

test('held-child custody refuses malformed or unavailable destinations and preserves existing originals', () => {
  const child = { status: 0, error: undefined, signal: null, stdout: Buffer.from([1, 255]), stderr: Buffer.from([2, 254]) };
  const originalWrite = fs.writeFileSync;
  let writes = 0;
  fs.writeFileSync = () => { writes += 1; throw new Error('unexpected malformed-prefix write'); };
  try {
    for (const prefix of ['', 'relative', '/invalid\0prefix', null, 4]) {
      assert.throws(() => heldChildCustody(prefix, child), /held-child custody prefix refused/);
    }
    assert.equal(writes, 0, 'malformed destination refuses before any filesystem write');
  } finally {
    fs.writeFileSync = originalWrite;
  }

  const directory = temporaryDirectory('rigger-loop-custody-refusal-');
  const used = `${directory}/used`;
  fs.writeFileSync(`${used}.stdout.original`, Buffer.from([9]));
  assert.throws(() => heldChildCustody(used, child), { message: 'held-child custody refused', code: 'EEXIST' });
  assert.deepEqual([...fs.readFileSync(`${used}.stdout.original`)], [9]);
  assert.equal(fs.existsSync(`${used}.stderr.original`), false);
  assert.equal(fs.existsSync(`${used}.absence-observation.json`), false);

  const unavailable = `${directory}/missing/held`;
  assert.throws(() => heldChildCustody(unavailable, child), { message: 'held-child custody refused', code: 'ENOENT' });
  assert.equal(fs.existsSync(`${directory}/missing`), false, 'custody never creates the missing parent');

  const later = `${directory}/later`;
  fs.writeFileSync(`${later}.stderr.original`, Buffer.from([8]));
  assert.throws(() => heldChildCustody(later, child), { message: 'held-child custody refused', code: 'EEXIST' });
  assert.deepEqual([...fs.readFileSync(`${later}.stdout.original`)], [1, 255], 'earlier newly created original survives later write refusal');
  assert.deepEqual([...fs.readFileSync(`${later}.stderr.original`)], [8], 'existing later original is untouched');
  assert.equal(fs.existsSync(`${later}.absence-observation.json`), false);

  const final = `${directory}/final`;
  fs.writeFileSync(`${final}.absence-observation.json`, '{"prior":true}');
  const finish = heldChildCustody(final, child);
  assert.throws(() => finish({ provenance: null, observations: null, probes: [] }), { message: 'held-child custody refused', code: 'EEXIST' });
  assert.deepEqual([...fs.readFileSync(`${final}.stdout.original`)], [1, 255]);
  assert.deepEqual([...fs.readFileSync(`${final}.stderr.original`)], [2, 254]);
  assert.equal(fs.readFileSync(`${final}.absence-observation.json`, 'utf8'), '{"prior":true}', 'a used final record is never replaced');
});

test('held-child custody marks partial or decoded capture without inventing stream originals', () => {
  const directory = temporaryDirectory('rigger-loop-custody-partial-');
  const prefix = `${directory}/partial`;
  const finish = heldChildCustody(prefix, {
    status: null, error: { code: 'ETIMEDOUT' }, signal: 'SIGTERM', stdout: Buffer.from([1, 255]), stderr: null,
  });
  finish({ provenance: null, observations: null, probes: [] });
  assert.deepEqual([...fs.readFileSync(`${prefix}.stdout.original`)], [1, 255]);
  assert.equal(fs.existsSync(`${prefix}.stderr.original`), false, 'missing stream is not relabelled as an empty original');
  assert.deepEqual(JSON.parse(fs.readFileSync(`${prefix}.absence-observation.json`, 'utf8')), {
    child: { status: null, errorCode: 'ETIMEDOUT', signal: 'SIGTERM' },
    streams: { stdout: 'buffer', stderr: 'missing' },
    observation: { provenance: null, observations: null, probes: [] },
  });

  const decoded = `${directory}/decoded`;
  const finishDecoded = heldChildCustody(decoded, { status: 0, error: undefined, signal: null, stdout: 'previously decoded', stderr: Buffer.from([2]) });
  finishDecoded({ provenance: null, observations: null, probes: [] });
  assert.equal(fs.existsSync(`${decoded}.stdout.original`), false, 'decoded text cannot become a raw-byte original');
  assert.deepEqual([...fs.readFileSync(`${decoded}.stderr.original`)], [2]);
  const retained = JSON.parse(fs.readFileSync(`${decoded}.absence-observation.json`, 'utf8'));
  assert.deepEqual(retained.streams, { stdout: 'non-buffer', stderr: 'buffer' });
  assert.deepEqual(retained.observation, { provenance: null, observations: null, probes: [] });
});

test('a nested child outcome keeps launch, exit, signal and parent timeout separate from absent phase evidence', () => {
  const cases = [
    [{ status: null, error: { code: 'ENOENT' }, signal: null }, 'launch error', null, 'ENOENT', null],
    [{ status: 3, error: undefined, signal: null }, 'nonzero exit', 3, null, null],
    [{ status: null, error: undefined, signal: 'SIGKILL' }, 'signal', null, null, 'SIGKILL'],
    [{ status: null, error: { code: 'ETIMEDOUT' }, signal: 'SIGTERM' }, 'parent timeout', null, 'ETIMEDOUT', 'SIGTERM'],
  ];
  for (const [child, kind, status, errorCode, signal] of cases) {
    assert.deepEqual(childOutcome(child, ''), {
      kind, status, errorCode, signal,
      phase: null,
      guardBeforeInnerBound: 'absent',
      incompleteEvidence: 'phase and guard absent',
    });
  }
});

test('a child outcome uses a bounded observed Q record and distinguishes an inner target timeout', () => {
  const record = '# RIGGER596_RESULT {"world":"N","phase":"Q","elapsedMs":8001,"lastBoundary":"readColumns.start","readOperation":"readColumns","guardBeforeInnerBound":"before","incompleteEvidence":"none"}';
  const observed = childOutcome({ status: 0, error: undefined, signal: null }, record);
  assert.equal(observed.kind, 'exited zero');
  assert.equal(observed.phase, 'Q');
  assert.equal(observed.guardBeforeInnerBound, 'before');
  assert.equal(observed.incompleteEvidence, 'none');

  const timedOut = childOutcome({ status: 1, error: undefined, signal: null }, `${record}\ntest timed out after 10000ms`);
  assert.equal(timedOut.kind, 'inner target timeout');
  assert.equal(timedOut.phase, 'Q');
  const unrelatedExit = childOutcome({ status: 1, error: undefined, signal: null }, record);
  assert.equal(unrelatedExit.kind, 'nonzero exit');
});

test('a child outcome ignores unrecognized phase payload fields rather than publishing them', () => {
  const output = '# RIGGER596_RESULT {"world":"N","phase":"Q","elapsedMs":8001,"lastBoundary":"readColumns.start","readOperation":"readColumns","guardBeforeInnerBound":"before","incompleteEvidence":"private-payload"}';
  const result = childOutcome({ status: null, error: { code: 'ETIMEDOUT' }, signal: 'SIGTERM' }, output);
  assert.equal(result.kind, 'parent timeout');
  assert.equal(result.phase, null);
  assert.equal(result.guardBeforeInnerBound, 'absent');
  assert.equal(result.incompleteEvidence, 'phase and guard absent');
});

test('given four pullable cards and every maker stand-in held, `loop`\'s single pull hands three cards to the maker stand-in, and no drain event exists while they are held', SETTLES_WITHIN, async (t) => {
  const built = world({ concurrency: 3 });

  const pulled = built.loop.pull();
  await makersHold(built, 3, t);

  assert.deepEqual(numbersOf(built.handed.map(({ card }) => card)), [1, 2, 3]);
  assert.deepEqual(built.dispatches.holding(), [1, 2, 3]);
  assert.deepEqual(drainsOf(built), []);
  built.dispatches.releaseAll();
  await pulled;
});

test('given a board with nothing to pull, `loop`\'s single pull hands the maker stand-in no card, leaves the write record empty, and writes exactly one drain event', async () => {
  const built = world({ cards: [{ ...readyCard(1), labels: [] }], concurrency: 3 });

  assert.deepEqual(await built.loop.pull(), []);
  assert.deepEqual(built.handed, []);
  assert.deepEqual(built.fake.writes(), []);

  assert.deepEqual(triggersOf(built), ['pull', 'drain']);
  assert.deepEqual(drainsOf(built), ['drain']);
});

test('when the board refuses a card\'s claim move, `loop`\'s single pull reports it, answers no card, and frees its slot for the next call', SETTLES_WITHIN, async (t) => {
  const fake = boardOf([8]);
  let refused = 0;
  const items = {
    ...fake.operations,
    moveItem: async (...args) => {
      if (refused === 0) {
        refused += 1;
        throw new Error('the board refused the move');
      }
      return fake.operations.moveItem(...args);
    },
  };
  const built = world({ fake, concurrency: 1, items });

  await assert.rejects(built.loop.pull(), (failure) => {
    assert.match(failure.errors[0].message, /card #8's move from ready to coding .* was refused: the board refused the move/);
    return true;
  });
  assert.deepEqual(built.handed, []);
  assert.deepEqual(cardsOf(built, 'slot.release'), [8]);

  // Concurrency is 1, so the next pull claims the card only if the refused claim freed its slot.
  const next = built.loop.pull();
  await makersHold(built, 1, t);
  assert.deepEqual(built.dispatches.holding(), [8]);
  assert.deepEqual(await columnsOf(fake), { 8: 'Coding' });
  built.dispatches.releaseAll();
  await next;
});

test('calls on one `loop` handle never together hold more claims than N, and never claim a card twice', SETTLES_WITHIN, async (t) => {
  const built = world({ concurrency: 3 });

  const pulls = [built.loop.pull(2)];
  await makersHold(built, 2, t);
  const first = built.dispatches.started.slice(0);
  pulls.push(built.loop.pull());
  await makersHold(built, 3, t);
  const second = built.dispatches.started.slice(first.length);
  // Every card is claimed, so the third pull claims nothing: it settles, as no maker holds it.
  pulls.push(built.loop.pull());
  await pulls[2];
  const third = built.dispatches.started.slice(first.length + second.length);

  assert.deepEqual([first, second, third], [[1, 2], [3], []]);
  built.dispatches.releaseAll();
  await Promise.all(pulls);
});

test('rule 8 lets a module under src/cli/ import `loop` and call its single pull', () => {
  const tree = sourceTree();
  tree.set('src/cli/claim-verb.mjs', "import { loop } from '../scheduling/loop.mjs';\nexport const once = (deps) => loop(deps).pull(1);");

  assert.deepEqual(boundaryReport(tree).violations.map((violation) => violation.message), []);

  tree.set('src/config/claim-verb.mjs', "import { loop } from '../scheduling/loop.mjs';\nexport const once = (deps) => loop(deps).pull();");
  assert.ok(boundaryReport(tree).violations.some((violation) => violation.message.includes('rule 8')), 'importing the dispatching entry point from src/config/ still breaks rule 8');
});

// The halt: L3 records each start before it acts outside Rigger on it, and starts nothing whose
// event the sink refuses (`ARCHITECTURE.md`, "Failure model").

/** Every failure `error` reports, an AggregateError opened to the failures it holds, however deep. */
const leavesOf = (error) => (error instanceof AggregateError ? error.errors.flatMap(leavesOf) : [error]);

/** What the world's refusing sink says of every append it refuses. */
const DISK_FULL = 'ENOSPC: no space left on device';

/** Passes a rejection whose failures, opened, include one saying card `number` was not started. */
const notStarted = (number) => (failure) => {
  const messages = leavesOf(failure).map((held) => held.message);
  assert.ok(messages.some((message) => message.includes(`#${number} was not started`)), JSON.stringify(messages));
  return true;
};

test('given a sink that refuses every append and one pullable card, `loop`\'s single pull fails naming the card it did not start and the sink\'s error', async () => {
  const built = world({ cards: [8], concurrency: 2 });
  built.refuseAppends(DISK_FULL);

  await assert.rejects(built.loop.pull(), (failure) => {
    const reported = leavesOf(failure).filter((held) => /#8\b/.test(held.message));
    assert.equal(reported.length, 1, `one failure names card 8: ${JSON.stringify(leavesOf(failure).map((held) => held.message))}`);
    assert.match(reported[0].message, /not started/);
    assert.match(reported[0].message, /ENOSPC: no space left on device/);
    assert.equal(reported[0].cause?.message, DISK_FULL, 'the sink\'s own error is the cause');
    return true;
  });
});

/**
 * One single pull over ready cards 1 and 2 under concurrency 2, with the sink refusing every
 * append from before the pull. Answers the pull's failure and what `world` built.
 */
async function refusedClaim() {
  const built = world({ cards: [1, 2], concurrency: 2 });
  built.refuseAppends(DISK_FULL);
  let failure = null;
  await built.loop.pull().catch((thrown) => {
    failure = thrown;
  });
  return { built, failure };
}

// proves R-RECORD-9
test('given a sink that refuses every append and two pullable cards, `loop`\'s single pull claims no card', SETTLES_WITHIN, async (t) => {
  const { built, failure } = await refusedClaim();

  assert.ok(failure, 'the pull failed');
  assert.deepEqual(await columnsOf(built.fake), { 1: 'Ready', 2: 'Ready' });
  // A claim held in memory would keep its card from the next pull: both slots are free, so the
  // next pull over an accepting sink hands the maker stand-in both cards.
  built.acceptAppends();
  const next = built.loop.pull();
  await makersHold(built, 2, t);
  assert.deepEqual(built.dispatches.holding(), [1, 2]);
  built.dispatches.releaseAll();
  await next;
});

test('given a sink that refuses every append and two pullable cards, `loop`\'s single pull leaves the fake board\'s write record empty', async () => {
  const { built, failure } = await refusedClaim();

  assert.ok(failure, 'the pull failed');
  assert.deepEqual(built.fake.writes(), []);
});

// proves R-RECORD-9
test('given a sink that refuses every append, the loop with an injected dispatch never calls that dispatch, from a run or from a pull', SETTLES_WITHIN, async () => {
  // Card 5 is a redo, so its start hands it straight to the dispatch with no claim move between:
  // only the halt stands between a refused pull event and the dispatch.
  for (const fire of [(built) => built.loop.run(), (built) => built.loop.pull()]) {
    const built = world({ cards: [cardIn(5, COLUMNS.coding), 1], concurrency: 2 });
    built.refuseAppends(DISK_FULL);

    const fired = fire(built);
    fired.catch(() => {});
    // A dispatch the halt let through would be held open here, so it is released: a loop that
    // called the dispatch then fails on its start count rather than never settling.
    const halted = settledOf(fired);
    await settling(built, halted);
    built.dispatches.releaseAll();
    await assert.rejects(fired, (failure) => {
      assert.ok(leavesOf(failure).every((held) => held.message.includes(DISK_FULL)), JSON.stringify(leavesOf(failure).map((held) => held.message)));
      return true;
    });

    assert.deepEqual(built.dispatches.started, []);
    assert.deepEqual(built.handed, []);
    assert.deepEqual(built.fake.writes(), []);
  }
});

test('given a dispatch already running when the sink starts refusing appends, the loop still hands that dispatch\'s outcome to L2', async () => {
  const built = world({ cards: [1], concurrency: 1 });
  const received = [];
  const settled = built.l2.settled;
  built.l2.settled = (card, outcome) => {
    received.push([card.number, outcome.status, outcome.status === 'fulfilled' ? outcome.value : outcome.reason]);
    return settled(card, outcome);
  };
  const run = built.loop.run();
  // Positive: until card 1 is held.
  await positive(() => built.dispatches.held() === 1);
  assert.deepEqual(built.dispatches.holding(), [1], "card 1's dispatch is running");
  built.refuseAppends(DISK_FULL);

  built.dispatches.releaseAll();
  await run.catch(() => {});

  // L1 recorded the maker's end into a refusing sink, so its outcome carries L1's result in a refusal.
  assert.deepEqual(received.map(([number, status, held]) => [number, status, held.code, held.result?.exit]), [[1, 'rejected', 'EVENT_REFUSED', 0]]);
});

// proves R-RECORD-9
test('given a sink that refused the previous `loop`\'s single pull and now accepts appends, the next `loop`\'s single pull claims a card, with nothing between the two calls but the sink accepting again', SETTLES_WITHIN, async (t) => {
  const built = world({ cards: [1], concurrency: 1 });
  built.refuseAppends(DISK_FULL);
  await assert.rejects(built.loop.pull(), notStarted(1));
  assert.deepEqual(await columnsOf(built.fake), { 1: 'Ready' });

  built.acceptAppends();
  const next = built.loop.pull();
  await makersHold(built, 1, t);
  const claimed = [...built.dispatches.started];

  assert.deepEqual(claimed, [1]);
  assert.deepEqual(await columnsOf(built.fake), { 1: 'Coding' });
  built.dispatches.releaseAll();
  await next;
});

test('across a `loop`\'s single pull the sink refused and a later one it accepted, the event stream holds no event recording a change of admission', SETTLES_WITHIN, async (t) => {
  const built = world({ cards: [1], concurrency: 1 });
  built.refuseAppends(DISK_FULL);
  await assert.rejects(built.loop.pull(), notStarted(1));
  built.acceptAppends();
  const next = built.loop.pull();
  await makersHold(built, 1, t);
  assert.deepEqual(built.dispatches.holding(), [1]);
  built.dispatches.releaseAll();
  await next;

  // The accepted pull's own events, and no other: R-SCHED-4 has only the owner and a repeated
  // infrastructure failure change admission, and the halt is neither.
  const pulled = new Set(['L3 trigger', 'L3 pull', 'L2 transition', 'L3 slot.release', 'L3 dispatch', 'L1 workspace.made', 'L1 dispatch.start', 'L1 dispatch.end']);
  pulled.add('L0 call.end');
  assert.deepEqual(built.events().map(({ layer, event }) => `${layer} ${event}`).filter((name) => !pulled.has(name)), []);
});

test('after a `loop`\'s single pull the sink refused, followed by one it accepted, the state directory holds nothing but the event stream', SETTLES_WITHIN, async (t) => {
  const built = world({ cards: [1], concurrency: 1 });
  built.refuseAppends(DISK_FULL);
  await assert.rejects(built.loop.pull(), notStarted(1));
  built.acceptAppends();
  const next = built.loop.pull();
  await makersHold(built, 1, t);
  assert.deepEqual(built.dispatches.holding(), [1]);
  built.dispatches.releaseAll();
  await next;

  assert.deepEqual(readdirSync(built.directory, { recursive: true }), ['events.jsonl', 'groups.json']);
});

test('a start whose pull event the sink refused writes no release event once the sink accepts again, so no release event lacks its pull', async () => {
  // The trigger event and the pull event are the first two appends of a single pull, and the
  // sink refuses exactly those two: whatever L3 appends after them, it accepts.
  const built = world({ cards: [1], concurrency: 1 });
  built.refuseAppends(DISK_FULL, 2);

  await assert.rejects(built.loop.pull(), notStarted(1));

  assert.deepEqual(built.sequence.filter((entry) => entry.append), []);
  assert.deepEqual(readdirSync(built.directory), [], 'nothing was appended, so the sink never wrote the stream');
});

// proves R-RECORD-9
test('when L2 reports a refused transition event, `loop`\'s single pull\'s caller receives the failure L2 reported, with the card, the columns and the sink\'s error unchanged', async () => {
  // The board takes the claim move, and the sink refuses from the move on, so L2's transition
  // event is the first append it refuses.
  const fake = boardOf([1]);
  let built;
  const items = {
    ...fake.operations,
    moveItem: async (id, column) => {
      await fake.operations.moveItem(id, column);
      built.refuseAppends(DISK_FULL);
    },
  };
  built = world({ fake, items, concurrency: 1 });

  await assert.rejects(built.loop.pull(), (failure) => {
    const reported = leavesOf(failure).filter((held) => /moved from/.test(held.message));
    assert.equal(reported.length, 1, JSON.stringify(leavesOf(failure).map((held) => held.message)));
    assert.equal(reported[0].message, `card #1 moved from ready to coding, and the event sink refused to record it: ${DISK_FULL}`);
    assert.equal(reported[0].cause?.message, DISK_FULL);
    return true;
  });
  assert.deepEqual(await columnsOf(fake), { 1: 'Coding' });
});

test('given a redo card and a sink that refuses from the first pull event on, a run ends after one board read, and starts nothing', async () => {
  // Card 5 is a redo, so its start makes no claim move: nothing but the halt stands between the
  // refused pull event and the next trigger. The sink accepts the run's start and the trigger
  // event, then refuses from the first read on. A run that pulled again at once after the refused
  // start would read the board a second time, and the second read throws so that such a run
  // still ends and reports, rather than pulling without end (the owner's ruling on #228).
  const fake = boardOf([cardIn(5, COLUMNS.coding)]);
  let reads = 0;
  let built;
  const board = handleOn(fake, {
    beforeRead: () => {
      reads += 1;
      if (reads > 1) throw new Error('the run pulled again at once after a start it did not make');
      built.refuseAppends(DISK_FULL);
    },
  });
  built = world({ fake, board, concurrency: 1 });

  await assert.rejects(built.loop.run(), (failure) => {
    const messages = leavesOf(failure).map((held) => held.message);
    assert.ok(messages.some((message) => message.includes('#5 was not started')), JSON.stringify(messages));
    assert.ok(messages.every((message) => !message.includes('pulled again')), JSON.stringify(messages));
    return true;
  });

  assert.equal(reads, 1);
  assert.deepEqual(built.dispatches.started, []);
});

test('given a sink that refuses every append, `loop`\'s single pull reports the pull trigger\'s refused event beside the start it did not make', async () => {
  const built = world({ cards: [1], concurrency: 1 });
  built.refuseAppends(DISK_FULL);

  await assert.rejects(built.loop.pull(), (failure) => {
    const messages = leavesOf(failure).map((held) => held.message);
    assert.deepEqual(messages, [
      `the event sink refused to record the pull trigger: ${DISK_FULL}`,
      `card #1 was not started, because the event sink refused to record its pull: ${DISK_FULL}`,
    ]);
    return true;
  });
});

// The start's kill (`ARCHITECTURE.md`, "Failure model"): L3 has L1 kill every recorded group
// before it records or reads anything, so a handle is built with the kill injected.

/** What `loop` is handed but the kill, over `built`'s board, L2 and a sink. */
function withoutKill() {
  const built = world({ cards: [1] });
  const settings = { ...config, concurrency: 1 };
  return { config: settings, board: handleOn(built.fake), decide: (card) => nextAction(card, KINDS), l2: built.l2, sink: { emitter: () => ({ emit: () => {} }) } };
}

test('a loop handle built without the injected kill throws when it is built, naming the kill', () => {
  assert.throws(() => loop({ ...withoutKill(), workspace: async () => ({ path: '/nowhere' }) }), /\bkill\b/);
});

/**
 * An injected kill that settles only once the test calls `release`, and counts how many times L3
 * called it.
 */
function heldKill() {
  let release;
  const settled = new Promise((resolve) => { release = resolve; });
  const held = { calls: 0, release: () => release() };
  held.kill = () => {
    held.calls += 1;
    return settled;
  };
  return held;
}

/** L0's handle on `fake`, counting every read L3 makes of it. */
function countingHandle(fake) {
  const handle = handleOn(fake);
  const counted = { reads: 0 };
  counted.handle = {
    readColumns: () => { counted.reads += 1; return handle.readColumns(); },
    readPriority: () => { counted.reads += 1; return handle.readPriority(); },
  };
  return counted;
}

test('given a loop handle whose injected kill settles only when the test releases it, run() records no L3 event, run.start included, until the kill settles', async () => {
  const held = heldKill();
  const fake = boardOf([1]);
  const built = world({ fake, concurrency: 1, kill: held.kill });

  const running = built.loop.run();
  const ran = settledOf(running);
  // Positive: until the kill was called.
  await positive(() => held.calls === 1);
  assert.equal(held.calls, 1, 'the kill was called');
  assert.deepEqual(built.l3Events(), []);
  held.release();
  // Positive: until run.start is recorded.
  await positive(() => built.attempts.some((each) => each.layer === 'L3' && each.event === 'run.start'));
  assert.equal(built.l3Events()[0]?.event, 'run.start', JSON.stringify(built.l3Events()));
  built.dispatches.releaseAll();
  await settling(built, ran);
  built.dispatches.releaseAll();
  await running;
  assert.equal(held.calls, 1, 'the kill ran once for the handle');
});

test('given a loop handle whose injected kill settles only when the test releases it, the board receives no read until the kill settles', async () => {
  const held = heldKill();
  const fake = boardOf([1]);
  const counted = countingHandle(fake);
  const built = world({ fake, board: counted.handle, concurrency: 1, kill: held.kill });

  const running = built.loop.run();
  const ran = settledOf(running);
  // Positive: until the kill was called.
  await positive(() => held.calls === 1);
  assert.equal(counted.reads, 0);
  held.release();
  // Positive: until the board was read.
  await positive(() => counted.reads > 0);
  assert.ok(counted.reads > 0, 'the run read the board once the kill settled');
  built.dispatches.releaseAll();
  await settling(built, ran);
  built.dispatches.releaseAll();
  await running;
});

test('given a loop handle whose injected kill rejects, a pull reads nothing, records no L3 event, and rejects with the kill\'s failure', async () => {
  // An empty board, so a pull that went on past the kill settles rather than holding a dispatch.
  const fake = boardOf([]);
  const counted = countingHandle(fake);
  const refusal = new Error('the sink refused 1 kill(s) of recorded groups');
  const built = world({ fake, board: counted.handle, kill: async () => { throw refusal; } });

  await assert.rejects(built.loop.pull(), (failure) => failure.message === refusal.message && failure.code === refusal.code && failure.unreadable === refusal.unreadable);

  assert.equal(counted.reads, 0);
  assert.deepEqual(built.l3Events(), []);
});

// proves R-ESCALATE-11
test('the same loop pulls an escalated card after a fresh board read shows the owner removed its label', SETTLES_WITHIN, async () => {
  const fake = boardOf([{ ...cardIn(201, COLUMNS.ready), labels: ['type:change', 'RIGGER:ESCALATED'] }]);
  let answered = false;
  const board = handleOn(fake, { onRead: (items) => {
    if (answered) items[0].labels = ['type:change'];
  } });
  const built = world({ fake, board });
  assert.deepEqual(await built.loop.pull(), []);
  assert.deepEqual(built.dispatches.started, []);
  assert.deepEqual(fake.writes(), []);

  answered = true;
  const running = built.loop.pull(1);
  const finished = settledOf(running);
  try {
    await positive(() => finished() || built.dispatches.holding().includes(201));
    assert.deepEqual(built.dispatches.started, [201]);
    assert.deepEqual(await columnsOf(fake), { 201: COLUMNS.coding });
  } finally {
    built.dispatches.releaseAll();
    await running;
  }
});

test('the loop world shares issue facts and successful issue labels by repository and issue identity', async () => {
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: [
    { ...cardIn(42, COLUMNS.review), labels: ['keep'] },
    { ...cardIn(42, COLUMNS.review), repository: 'someone/elsewhere', labels: ['foreign'] },
    { ...cardIn(43, COLUMNS.ready), labels: ['unrelated'] },
  ] });
  const built = world({ fake, cards: [] });
  assert.deepEqual(await built.repository.operations.readIssue(42), { number: 42, title: 'Add a verb', body: PASSING, state: 'open', author: 'rigger-fake', labels: ['keep'] });
  const [card] = await fake.operations.readItems();
  await built.l2.escalated(card, { action: 'escalate', category: 'ambiguous', reason: 'The owner must decide.' });
  assert.deepEqual((await fake.operations.readItems()).map(({ repository, number, labels }) => ({ repository, number, labels })), [
    { repository: config.repo, number: 42, labels: ['keep', 'rigger:escalated'] },
    { repository: 'someone/elsewhere', number: 42, labels: ['foreign'] },
    { repository: config.repo, number: 43, labels: ['unrelated'] },
  ]);
  assert.equal(Object.hasOwn(fake.operations, 'issues'), false);
  assert.equal(Object.hasOwn(fake.operations, 'setIssueLabels'), false);
  const absent = world({ cards: [cardIn(44, COLUMNS.review)], forge: { issues: [] } });
  assert.equal(await absent.repository.operations.readIssue(44), null, 'an explicitly missing issue is not manufactured');
});

// proves R-ESCALATE-8, R-ESCALATE-9, R-ESCALATE-15
test('one escalation claim spans every awaited owner write and a fresh labelled pull starts nothing', async (t) => {
  const number = 96;
  const pull = 961;
  const head = '9'.repeat(40);
  const unexpected = [];
  const built = world({ cards: [cardIn(number, COLUMNS.owner)], concurrency: 1,
    forge: { pullRequests: [{ number: pull, head: `rigger-${number}`, sha: head, comments: [markerComment({ card: number, pull, head, body: PASSING, role: 'owner', verdict: 'critical', toSound: 'Keep the user files.' })] }] },
    workspace: async (...args) => { unexpected.push(['workspace', ...args]); throw new Error('an escalation creates no workspace'); },
    judgeDirectory: async (...args) => { unexpected.push(['judgeDirectory', ...args]); throw new Error('an escalation creates no judge directory'); },
    removeDirectories: async (...args) => { unexpected.push(['removeDirectories', ...args]); },
  });
  const entered = [];
  const releases = [];
  for (const [target, operation] of [[built.repository, 'postIssueComment'], [built.fake.operations, 'moveItem'], [built.repository, 'addIssueLabel']]) {
    const original = target[operation];
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    releases.push(release);
    target[operation] = async (...args) => { entered.push(operation); await held; return original(...args); };
  }
  let settled = false;
  const running = built.loop.run().finally(() => { settled = true; });
  t.after(async () => { for (const release of releases) release(); await running.catch(() => {}); });
  for (const [at, operation] of ['postIssueComment', 'moveItem', 'addIssueLabel'].entries()) {
    await waitFor(() => entered.includes(operation) || settled);
    assert.equal(entered.at(-1), operation, `the operation reaches ${operation} before settling`);
    assert.deepEqual(entered, ['postIssueComment', 'moveItem', 'addIssueLabel'].slice(0, at + 1));
    assert.deepEqual(cardsOf(built, 'slot.release'), [], `${operation} still owns the claim`);
    assert.deepEqual(await built.loop.pull(), [], `${operation}: overlapping trigger takes no second claim`);
    assert.deepEqual(cardsOf(built, 'slot.release'), []);
    releases[at]();
  }
  await running;
  assert.deepEqual(await columnsOf(built.fake), { [number]: COLUMNS.owner }, 'the escalated card reaches its configured Owner column');
  assert.deepEqual(cardsOf(built, 'slot.release'), [number]);
  assert.equal(built.events().filter(({ event }) => event === 'review.escalate').length, 1);
  assert.equal(built.events().filter(({ event }) => event === 'transition').length, 1);
  assert.equal(built.events().find(({ event }) => event === 'transition').to, 'owner');
  assert.equal(built.repository.held().issues[0].comments.length, 1);
  assert.deepEqual((await built.fake.operations.readItems())[0].labels, ['type:change', 'rigger:escalated']);
  assert.deepEqual(await built.loop.pull(), []);
  assert.deepEqual(await built.loop.run(), []);
  assert.equal(built.repository.held().issues[0].comments.length, 1, 'fresh reads do not post another escalation');
  assert.deepEqual(entered, ['postIssueComment', 'moveItem', 'addIssueLabel']);
  assert.deepEqual(built.dispatches.started, []);
  assert.deepEqual(unexpected, []);
});

// proves R-RECORD-9, R-ESCALATE-9
test('an owner escalation whose transition record is refused starts no later work while the sink remains unavailable', async (t) => {
  const number = 98;
  const pull = 981;
  const head = '9'.repeat(40);
  const fake = boardOf([cardIn(number, COLUMNS.owner), 99]);
  let built;
  const items = { ...fake.operations, moveItem: async (...args) => { await fake.operations.moveItem(...args); built.refuseAppends('owner transition recording unavailable'); } };
  built = world({ fake, items, concurrency: 1,
    forge: { pullRequests: [{ number: pull, head: `rigger-${number}`, sha: head, comments: [markerComment({ card: number, pull, head, body: PASSING, role: 'owner', verdict: 'critical', toSound: 'Keep the user files.' })] }] },
  });
  t.after(() => built.dispatches.releaseAll());
  await assert.rejects(built.loop.pull(1), (failure) => {
    assert.ok(leavesOf(failure).some(({ message }) => /card #98 moved from owner to owner.*refused to record it: owner transition recording unavailable/.test(message)), failure.message);
    return true;
  });
  assert.equal(built.repository.held().issues.find(({ number }) => number === 98).comments.length, 1);
  assert.deepEqual(built.repository.held().issues.find(({ number }) => number === 98).labels, ['type:change']);
  assert.deepEqual(await columnsOf(fake), { 98: COLUMNS.owner, 99: COLUMNS.ready });
  let settled = false;
  const later = built.loop.pull().finally(() => { settled = true; });
  later.catch(() => {});
  await waitFor(() => settled || built.dispatches.held() > 0);
  built.dispatches.releaseAll();
  await assert.rejects(later, (failure) => leavesOf(failure).every(({ message }) => message.includes('owner transition recording unavailable')));
  assert.deepEqual(built.dispatches.started, []);
  assert.deepEqual(built.fake.writes(), [{ operation: 'moveItem', args: ['item-1', COLUMNS.owner] }]);
  assert.equal(built.repository.held().issues.find(({ number }) => number === 98).comments.length, 1);
});

/** A real L2 answer at the pull, with the forge facts that make it. */
function admissionAction(action) {
  const number = { dispatch: 71, redo: 70, judge: 72, merge: 73, move: 74, return: 75, escalate: 76, continue: 77 }[action];
  const head = 'a'.repeat(40);
  const pull = number + 100;
  if (action === 'dispatch') return { cards: [cardIn(number, COLUMNS.ready)] };
  if (action === 'redo') return { cards: [cardIn(number, COLUMNS.coding)] };
  if (action === 'continue') return {
    cards: [cardIn(number, COLUMNS.review)],
    kinds: { change: { ...KINDS.change, judges: ['reviewer'] } },
    forge: { pullRequests: [{ number: pull, head: `rigger-${number}`, sha: head, mergeBase: 'c'.repeat(40), diff: 'diff --git a/help b/help\n', mergeable: 'mergeable', comments: [
      markerComment({ card: number, pull, head, body: PASSING, role: 'reviewer', verdict: 'needs revision', items: ['unmet'], toSound: 'Fix the help line.' }),
    ] }] },
  };
  const column = action === 'move' || action === 'judge' ? COLUMNS.review : COLUMNS.owner;
  const comments = action === 'merge' ? [markerComment({ card: number, pull, head, body: PASSING, role: 'owner' })]
    : action === 'return' ? [markerComment({ card: number, pull, head, body: PASSING, role: 'owner', coverage: 'insufficient', coverageReason: 'The card asks for two verbs.' })]
      : action === 'escalate' ? [markerComment({ card: number, pull, head, body: PASSING, role: 'owner', verdict: 'critical', toSound: 'Keep the user files.' })] : [];
  return {
    cards: [cardIn(number, column)],
    ...(action === 'judge' ? { kinds: { change: { ...KINDS.change, judges: ['reviewer'] } } } : {}),
    forge: { pullRequests: [{ number: pull, head: `rigger-${number}`, sha: head, mergeBase: 'c'.repeat(40), diff: 'diff --git a/help b/help\n', mergeable: 'mergeable', merged: action === 'move', comments }] },
  };
}

/** A blocked pull still asks real L2, and changes neither the board, forge nor admission. */
async function blockedAdmission(action, name, content = closerText()) {
  const directory = stateOf();
  seed(directory, name, content);
  const built = world({ ...admissionAction(action), directory,
    workspace: async () => { throw new Error('a blocked pull made a workspace'); },
    judgeDirectory: async () => { throw new Error('a blocked pull made a judge directory'); },
  });
  const forgeBefore = structuredClone(built.repository.held());
  const admissionBefore = picture(admissionOf(directory));
  const pulled = built.loop.pull();
  const done = settledOf(pulled);
  try {
    await positive(() => done() || built.l3Events().some(({ event }) => event === 'pull'));
    assert.deepEqual(built.l3Events().filter(({ event }) => event === 'pull'), [], 'a blocked pull claimed a card');
    assert.deepEqual(built.fake.writes(), [], 'a blocked pull wrote to the board');
    if (name === 'not-a-closer') {
      await assert.rejects(pulled, (failure) => {
        assert.ok(failure.message.includes(`${admissionOf(directory)}/${name} (no closer form)`), failure.message);
        return true;
      });
    } else {
      const answer = await pulled;
      assert.deepEqual(answer.reached, []);
      assert.equal(answer.admission.state, 'closed');
    }
  } finally {
    built.dispatches.releaseAll();
    await pulled.catch(() => {});
  }
  assert.equal(built.decisions[0]?.action.action, action === 'redo' ? 'dispatch' : action, JSON.stringify(built.decisions));
  assert.deepEqual(built.fake.writes(), []);
  assert.deepEqual(built.repository.held(), forgeBefore);
  assert.deepEqual(built.dispatches.started, []);
  assert.deepEqual(built.l3Events().filter(({ event }) => event === 'pull'), []);
  assert.equal(built.l3Events().filter(({ event, trigger }) => event === 'trigger' && trigger === 'drain').length, name === 'not-a-closer' ? 0 : 1);
  assert.deepEqual(picture(admissionOf(directory)), admissionBefore);
}

// proves R-SCHED-3, R-SCHED-16
test('a blocked take attempts no admission write, even one removed before it returns', async () => {
  const directory = stateOf();
  seed(directory, 'owner-a1.json');
  const built = world({ ...admissionAction('dispatch'), directory });
  const admissionDirectory = admissionOf(directory);
  const writes = [];
  const originals = new Map();
  const descriptors = new Map();
  const underAdmission = (path) => String(path) === admissionDirectory || String(path).startsWith(`${admissionDirectory}/`);
  for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'rmSync']) {
    const original = fs[name];
    originals.set(name, original);
    fs[name] = (...args) => {
      const paths = name === 'renameSync' ? args.slice(0, 2) : args.slice(0, 1);
      if (paths.some(underAdmission)) {
        writes.push({ operation: name, paths: paths.map(String) });
      }
      return original(...args);
    };
  }
  for (const name of ['openSync', 'writeSync', 'writevSync', 'ftruncateSync', 'closeSync']) originals.set(name, fs[name]);
  fs.openSync = (path, flags, ...rest) => {
    const fd = originals.get('openSync')(path, flags, ...rest);
    if (underAdmission(path)) {
      descriptors.set(fd, String(path));
      const writable = typeof flags === 'string' ? /[wax+]/.test(flags)
        : (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0;
      if (writable) writes.push({ operation: 'openSync', paths: [String(path)] });
    }
    return fd;
  };
  for (const name of ['writeSync', 'writevSync', 'ftruncateSync']) {
    fs[name] = (fd, ...args) => {
      if (descriptors.has(fd)) writes.push({ operation: name, paths: [descriptors.get(fd)] });
      return originals.get(name)(fd, ...args);
    };
  }
  fs.closeSync = (fd) => {
    try { return originals.get('closeSync')(fd); }
    finally { descriptors.delete(fd); }
  };
  syncBuiltinESMExports();
  try {
    const pulled = built.loop.pull();
    const done = settledOf(pulled);
    try {
      await positive(() => done() || built.l3Events().some(({ event }) => event === 'pull'));
      assert.deepEqual(built.l3Events().filter(({ event }) => event === 'pull'), [], 'the closed take claimed a card');
      const answer = await pulled;
      assert.equal(answer.admission.state, 'closed');
      assert.deepEqual(writes, [], 'take attempted an admission write');
    } finally {
      await settling(built, done);
      built.dispatches.releaseAll();
      await pulled.catch(() => {});
    }
  } finally {
    for (const [name, original] of originals) fs[name] = original;
    syncBuiltinESMExports();
  }
  await moduleOver(directory).resume();
  const next = built.loop.pull();
  const done = settledOf(next);
  try {
    await positive(() => done() || built.dispatches.heldNow(71));
    assert.deepEqual(built.dispatches.started, [71], 'the closed take retained a claim');
  } finally {
    built.dispatches.releaseAll();
    await next.catch(() => {});
  }
});

// proves R-SCHED-3, R-SCHED-16
test('an owner closer stops L2 maker dispatch from Ready and Coding', async () => {
  for (const action of ['dispatch', 'redo']) await blockedAdmission(action, 'owner-a1.json');
});

// proves R-SCHED-3, R-SCHED-16
test('an owner closer stops L2 judges alone in Review', async () => blockedAdmission('judge', 'owner-a1.json'));

// proves R-SCHED-3, R-SCHED-16
test('an owner closer stops L2 merge without taking a slot', async () => blockedAdmission('merge', 'owner-a1.json'));

// proves R-SCHED-3, R-SCHED-16
test('an owner closer stops L2 move, return and escalation writes', async () => {
  for (const action of ['move', 'return', 'escalate']) await blockedAdmission(action, 'owner-a1.json');
});

// proves R-SCHED-3, R-SCHED-16
test('an owner closer stops a returned card continuing its maker work', async () => blockedAdmission('continue', 'owner-a1.json'));

// proves R-SCHED-3, R-SCHED-16
test('a hold closer stops dispatch, judges, merge, move, return, escalation and continued work', async () => {
  for (const action of ['dispatch', 'redo', 'judge', 'merge', 'move', 'return', 'escalate', 'continue']) await blockedAdmission(action, 'hold-b2-issue-7.json');
});

// proves R-SCHED-3, R-SCHED-16
test('unreadable admission stops dispatch, judges, merge, move, return, escalation and continued work', async () => {
  for (const action of ['dispatch', 'redo', 'judge', 'merge', 'move', 'return', 'escalate', 'continue']) await blockedAdmission(action, 'not-a-closer');
});

// proves R-SCHED-3, R-SCHED-16
test('a closer linked while the facts call is pending stops the pull in its synchronous claim step', async () => {
  const directory = stateOf();
  const fake = boardOf([readyCard(78)]);
  const built = world({ fake, directory });
  let entered = false;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const gated = loop({
    config: { ...config, concurrency: 1 }, board: handleOn(fake),
    facts: async () => { entered = true; await pending; return (card) => nextAction(card, KINDS); },
    decide: (card) => nextAction(card, KINDS),
    l2: built.l2, sink: built.sink, kill: async () => {},
    workspace: async () => { throw new Error('a closed pull makes no workspace'); },
    judgeDirectory: async () => {}, removeDirectories: async () => {}, state: directory, environment: {}, run: 'r-test',
  });
  const pulled = gated.pull();
  const done = settledOf(pulled);
  await positive(() => entered);
  seed(directory, 'owner-a1.json');
  release();
  await positive(() => done() || built.l3Events().some(({ event }) => event === 'pull'));
  assert.deepEqual(built.l3Events().filter(({ event }) => event === 'pull'), []);
  const answer = await pulled;

  assert.equal(answer.admission.state, 'closed');
  assert.deepEqual(answer.reached, []);
  assert.deepEqual(fake.writes(), []);
  assert.deepEqual(built.dispatches.started, []);
});

// proves R-SCHED-3, R-SCHED-16
test('a closer linked after a run claims a card lets it finish and stops its freed-slot trigger', async () => {
  const built = world({ cards: [81, 82, 83], concurrency: 2 });
  const running = built.loop.run();
  await positive(() => built.dispatches.heldNow(81) && built.dispatches.heldNow(82));
  seed(built.directory, 'owner-a1.json');
  const done = settledOf(running);
  built.dispatches.releaseAll();
  await positive(() => done() || built.dispatches.heldNow(83));
  if (built.dispatches.heldNow(83)) built.dispatches.release(83);
  const reached = await running;

  assert.deepEqual(reached.map(({ card }) => card).sort(), [81, 82]);
  assert.deepEqual(built.dispatches.started, [81, 82]);
  assert.deepEqual(await columnsOf(built.fake), { 81: COLUMNS.review, 82: COLUMNS.review, 83: COLUMNS.ready });
  assert.equal(built.l3Events().filter(({ event, trigger }) => event === 'trigger' && trigger === 'pull').length, 3);
});

// proves R-SCHED-3, R-SCHED-16
test('resume removes the closer through admission and the next pull claims as when open', async () => {
  const directory = stateOf();
  seed(directory, 'owner-a1.json');
  const built = world({ cards: [83], directory });
  const stopped = await built.loop.pull();
  assert.equal(stopped.admission.state, 'closed');
  await moduleOver(directory).resume();
  const next = built.loop.pull();
  const done = settledOf(next);
  try {
    await positive(() => done() || built.dispatches.heldNow(83));
    assert.deepEqual(built.dispatches.started, [83]);
    await positive(() => built.dispatches.heldNow(83));
    assert.deepEqual(built.dispatches.started, [83]);
    assert.deepEqual(await columnsOf(built.fake), { 83: COLUMNS.coding });
  } finally {
    built.dispatches.releaseAll();
    await next;
  }
});

test('the loop world opens a new pull after closed history and still suppresses a second genuinely open pull', SETTLES_WITHIN, async (t) => {
  for (const alreadyOpen of [false, true]) {
    const number = alreadyOpen ? 189 : 188;
    const built = world({ cards: [number], fresh: false, forge: { pullRequests: [
      { number: 733, head: `rigger-${number}`, sha: 'd6d079f3258e1b74aad7baf725895b8d74c5b315', closed: true },
    ] } });
    const running = built.loop.pull(1);
    let ended = false;
    running.finally(() => { ended = true; }).catch(() => {});
    t.after(async () => { built.dispatches.releaseAll(); await running.catch(() => {}); });
    await waitFor(() => ended || built.dispatches.holding().includes(number));
    assert.deepEqual(built.dispatches.started, [number]);
    if (alreadyOpen) built.repository.open({ number: 990, head: `rigger-${number}`, sha: 'a'.repeat(40) });
    built.dispatches.releaseAll();
    const reached = await running;
    const facts = await built.repository.operations.readPullRequests(`rigger-${number}`);
    assert.equal(facts.closed.length, 1, 'closed history stays closed');
    assert.deepEqual(facts.open.map(({ number }) => number), [alreadyOpen ? 990 : 1001], 'closed history is not an existing open pull');
    assert.equal(built.repository.held().pullRequests.length, 2, 'exactly one open pull exists');
    assert.equal(reached[0].settled.status, 'fulfilled');
  }
});


// proves R-WORK-36, R-WORK-37, R-WORK-39
test('one closed-card claim removes before redo Coding or the ordinary Owner operation in every eligible stage and branch cell', SETTLES_WITHIN, async (t) => {
  for (const column of [COLUMNS.review, COLUMNS.owner]) for (const branch of [false, true]) {
    const number = 190;
    const order = [];
    let built;
    built = world({ cards: [cardIn(number, column)], fresh: false, answer: () => ({ exit: 1 }), forge: {
      branches: branch ? [`rigger-${number}`] : [],
      pullRequests: [{ number: 733, head: `rigger-${number}`, sha: 'd6d079f3258e1b74aad7baf725895b8d74c5b315', closed: true }],
    }, removeDirectories: async (card) => {
      order.push('remove');
      assert.equal(card, number);
      assert.deepEqual(cardsOf(built, 'pull'), [number]);
      assert.deepEqual(cardsOf(built, 'slot.release'), []);
      assert.equal((await columnsOf(built.fake))[number], column, 'removal precedes the Coding move');
      assert.deepEqual(built.dispatches.started, []);
      assert.deepEqual(built.fake.writes(), []);
    } });
    const claimed = built.l2.claimed;
    built.l2.claimed = async (...args) => { order.push('claimed'); return claimed(...args); };
    for (const operation of ['postIssueComment', 'addIssueLabel']) {
      const original = built.repository[operation];
      built.repository[operation] = async (...args) => { order.push(operation); return original(...args); };
    }
    const running = built.loop.pull(1);
    const ended = settledOf(running);
    running.catch(() => {});
    t.after(async () => { built.dispatches.releaseAll(); await running.catch(() => {}); });
    await waitFor(() => ended() || built.dispatches.holding().includes(number));
    assert.equal(order[0], 'remove', `${column}/${branch}: ${JSON.stringify(order)}`);
    built.dispatches.releaseAll();
    const reached = await running;
    if (column === COLUMNS.review && !branch) {
      assert.deepEqual(order, ['remove', 'claimed']);
      assert.deepEqual(built.dispatches.started, [number]);
      assert.equal((await columnsOf(built.fake))[number], COLUMNS.coding);
      assert.equal(reached[0].outcome.value.exit, 1);
    } else {
      assert.deepEqual(order, ['remove', 'postIssueComment', 'addIssueLabel']);
      assert.deepEqual(built.dispatches.started, []);
      assert.equal(reached[0].action, 'escalate');
      assert.equal(reached[0].category, 'ambiguous');
      assert.equal(reached[0].line, `rigger-${number}`);
      assert.equal((await columnsOf(built.fake))[number], COLUMNS.owner);
      const comment = built.repository.held().issues[0].comments[0].body;
      assert.ok(comment.includes(reached[0].reason), comment);
      assert.ok(comment.includes(`Line of work: rigger-${number}`), comment);
      assert.doesNotMatch(comment, /Pull request:|Head:/, 'closed history invents no active work identifiers');
      assert.deepEqual((await built.fake.operations.readItems())[0].labels, ['type:change', 'rigger:escalated']);
    }
    assert.deepEqual(cardsOf(built, 'pull'), [number]);
    assert.deepEqual(cardsOf(built, 'slot.release'), [number]);
  }
});


// proves R-WORK-36
test('a closed removal failure retains every remaining path while the ordinary redo or owner escalation still runs under that claim', SETTLES_WITHIN, async (t) => {
  for (const column of [COLUMNS.review, COLUMNS.owner]) {
    const number = 191;
    const remaining = [new Error('/workspaces/rigger-191 remains: denied'), new Error('/judges/rigger-191/reviewer remains: partial removal')];
    const cleanup = new AggregateError(remaining, 'L1 could not remove all directories of card #191');
    const built = world({ cards: [cardIn(number, column)], fresh: false, answer: () => ({ exit: 1 }), forge: {
      pullRequests: [{ number: 733, head: `rigger-${number}`, sha: 'd6d079f3258e1b74aad7baf725895b8d74c5b315', closed: true }],
    }, removeDirectories: async () => { throw cleanup; } });
    const running = built.loop.pull(1);
    const ended = settledOf(running);
    running.catch(() => {});
    t.after(async () => { built.dispatches.releaseAll(); await running.catch(() => {}); });
    await waitFor(() => ended() || built.dispatches.holding().includes(number));
    if (column === COLUMNS.review) assert.deepEqual(built.dispatches.started, [number], 'failed cleanup does not replace the ordinary redo');
    else assert.equal(built.repository.held().issues[0].comments.length, 1, 'failed cleanup does not replace the ordinary escalation');
    built.dispatches.releaseAll();
    await assert.rejects(running, (failure) => {
      const leaves = leavesOf(failure);
      for (const path of remaining) assert.ok(leaves.some((held) => held.message === path.message && held.code === path.code && held.unreadable === path.unreadable), `lost ${path.message}`);
      assert.equal(failure.reached.length, 1, 'the ordinary reached outcome survives cleanup failure');
      if (column === COLUMNS.review) assert.equal(failure.reached[0].outcome.value.exit, 1);
      else assert.equal(failure.reached[0].action, 'escalate');
      return true;
    });
    assert.deepEqual(cardsOf(built, 'pull'), [number]);
    assert.deepEqual(cardsOf(built, 'slot.release'), [number]);
    assert.equal((await columnsOf(built.fake))[number], column === COLUMNS.review ? COLUMNS.coding : COLUMNS.owner);
    if (column === COLUMNS.owner) assert.deepEqual((await built.fake.operations.readItems())[0].labels, ['type:change', 'rigger:escalated']);
  }
});


import { factsCall } from '../src/workflow/facts.mjs';

// proves R-WORK-36
test('a closed removal followed by unchanged refusal or injected ignore runs once per invocation and retries on the next invocation', SETTLES_WITHIN, async () => {
  for (const action of ['refuse', 'ignore']) {
    const number = 192;
    const item = { ...cardIn(number, COLUMNS.review), body: action === 'refuse' ? 'No acceptance.' : PASSING };
    const built = world({ cards: [item], forge: { pullRequests: [{ number: 733, head: `rigger-${number}`, sha: 'd6d079f3258e1b74aad7baf725895b8d74c5b315', closed: true }] } });
    const settings = { ...config, concurrency: 1, board: { ...config.board, columns: COLUMNS } };
    const decide = (card) => action === 'ignore'
      ? { action: 'remove', following: { action: 'ignore' } }
      : nextAction(card, KINDS, undefined, { roles: settings.roles, provisioning: {}, sink: built.sink });
    let calls = 0;
    const handle = loop({ config: settings, board: handleOn(built.fake), decide,
      facts: factsCall({ config: settings, reads: built.repository.operations, decide }), l2: built.l2, sink: built.sink, kill: async () => {},
      workspace: async () => { assert.fail('a following refusal or ignore admits no maker'); },
      judgeDirectory: async () => { assert.fail('a following refusal or ignore admits no judge'); },
      removeDirectories: async () => {
        calls += 1;
        // A broken exclusion ends on its second forbidden call and fails the named count below.
        if (calls === 2) await built.fake.operations.moveItem('item-1', COLUMNS.done);
      }, state: built.directory, environment: {}, run: 'r-test',
    });
    for (const invocation of [1, 2]) {
      calls = 0;
      let failure;
      const reached = await handle.run().catch((held) => { failure = held; });
      assert.equal(calls, 1, `${action}: invocation ${invocation} repeats no unchanged cleanup`);
      assert.equal(failure, undefined, failure?.message);
      assert.deepEqual(reached, [action === 'refuse' ? { card: number, action, reason: 'missing acceptance' } : { card: number, action }]);
      assert.deepEqual(built.fake.writes(), []);
      assert.deepEqual(built.dispatches.started, []);
    }
    assert.deepEqual(cardsOf(built, 'pull'), [number, number]);
    assert.deepEqual(cardsOf(built, 'slot.release'), [number, number]);
  }
});


// proves R-WORK-36
test('a refused redo start after closed cleanup releases once without an immediate retry and preserves both actual failures', SETTLES_WITHIN, async () => {
  for (const cleanupFails of [false, true]) {
    const number = 193;
    const fake = boardOf([cardIn(number, COLUMNS.review)]);
    const cleanup = new Error('/workspaces/rigger-193 remains after partial removal');
    let calls = 0;
    let starts = 0;
    const items = { ...fake.operations, moveItem: async (...args) => {
      if (args[1] === COLUMNS.coding) { starts += 1; throw new Error('the board refuses the following Coding start'); }
      return fake.operations.moveItem(...args);
    } };
    const built = world({ fake, items, fresh: false, forge: { pullRequests: [{ number: 733, head: `rigger-${number}`, sha: 'd6d079f3258e1b74aad7baf725895b8d74c5b315', closed: true }] },
      removeDirectories: async () => {
        calls += 1;
        if (calls === 2) await fake.operations.moveItem('item-1', COLUMNS.done);
        if (cleanupFails) throw cleanup;
      },
    });
    for (const invocation of [1, 2]) {
      calls = 0;
      starts = 0;
      await assert.rejects(built.loop.run(), (failure) => {
        const leaves = leavesOf(failure);
        assert.ok(leaves.some(({ message }) => message.includes('the board refuses the following Coding start')));
        assert.equal(leaves.some((held) => held.message === cleanup.message && held.code === cleanup.code && held.unreadable === cleanup.unreadable), cleanupFails, 'cleanup failure is retained exactly when it happened');
        assert.deepEqual(failure.reached, []);
        return true;
      });
      assert.equal(calls, 1, `invocation ${invocation}: refused start fires no immediate cleanup retry`);
      assert.equal(starts, 1);
      assert.deepEqual(built.dispatches.started, []);
      assert.deepEqual(fake.writes(), []);
      assert.equal((await columnsOf(fake))[number], COLUMNS.review);
    }
    assert.deepEqual(cardsOf(built, 'pull'), [number, number]);
    assert.deepEqual(cardsOf(built, 'slot.release'), [number, number]);
  }
});


// proves R-WORK-36
test('closed cleanup composes each Owner write rejection with actual cleanup failure and excludes that outer claim until the next invocation', BOUNDS[60_000], async () => {
  for (const column of [COLUMNS.review, COLUMNS.owner]) for (const cleanupFails of [false, true]) for (const rejected of ['postIssueComment', 'moveItem', 'addIssueLabel']) {
    const number = 194;
    const cleanup = new Error('/escalations/rigger-194/reviewer remains: partial removal');
    const ordinary = new Error(`Owner ${rejected} refused`);
    let calls = 0;
    let built;
    let controlMove;
    built = world({ cards: [cardIn(number, column)], forge: { branches: [`rigger-${number}`], pullRequests: [{ number: 733, head: `rigger-${number}`, sha: 'd6d079f3258e1b74aad7baf725895b8d74c5b315', closed: true }] },
      removeDirectories: async () => {
        calls += 1;
        if (calls === 2) await controlMove('item-1', COLUMNS.done);
        if (cleanupFails) throw cleanup;
      },
    });
    controlMove = built.fake.operations.moveItem;
    const writes = [];
    const operations = [[built.repository, 'postIssueComment'], [built.fake.operations, 'moveItem'], [built.repository, 'addIssueLabel']];
    for (const [target, operation] of operations) {
      const original = target[operation];
      target[operation] = async (...args) => {
        writes.push(operation);
        if (operation === rejected) throw ordinary;
        return original(...args);
      };
    }
    for (const invocation of [1, 2]) {
      calls = 0;
      const before = writes.length;
      await assert.rejects(built.loop.run(), (failure) => {
        const leaves = leavesOf(failure);
        assert.equal(leaves.some((held) => held.message === cleanup.message && held.code === cleanup.code && held.unreadable === cleanup.unreadable), cleanupFails);
        assert.ok(leaves.some((held) => held.cause?.message === ordinary.message && held.cause?.code === ordinary.code && held.cause?.unreadable === ordinary.unreadable && held.message.includes(`Owner ${rejected} refused`)), `${column}/${cleanupFails}/${rejected}`);
        assert.deepEqual(failure.reached, []);
        return true;
      });
      assert.equal(calls, 1, `${column}/${cleanupFails}/${rejected}: invocation ${invocation} repeats no cleanup`);
      assert.deepEqual(writes.slice(before), ['postIssueComment', 'moveItem', 'addIssueLabel'].slice(0, ['postIssueComment', 'moveItem', 'addIssueLabel'].indexOf(rejected) + 1));
      assert.equal((built.repository.held().issues[0].comments ?? []).length, rejected === 'postIssueComment' ? 0 : invocation);
      assert.equal((await columnsOf(built.fake))[number], rejected === 'addIssueLabel' ? COLUMNS.owner : column);
      assert.deepEqual((await built.fake.operations.readItems())[0].labels, ['type:change']);
      assert.equal(built.events().filter(({ event }) => event === 'transition').length, rejected === 'addIssueLabel' ? invocation : 0);
      assert.deepEqual(built.dispatches.started, []);
    }
    assert.deepEqual(cardsOf(built, 'pull'), [number, number]);
    assert.deepEqual(cardsOf(built, 'slot.release'), [number, number]);
  }
});


// proves R-RECORD-9, R-WORK-36
test('a refused initial closed-cleanup claim record starts neither removal nor its ordinary action and a recordable retry does both', async () => {
  const number = 195;
  const removed = [];
  const built = world({ cards: [cardIn(number, COLUMNS.owner)], forge: { pullRequests: [{ number: 733, head: `rigger-${number}`, sha: 'd6d079f3258e1b74aad7baf725895b8d74c5b315', closed: true }] }, removeDirectories: async (card) => { removed.push(card); } });
  built.refuseAppends('initial pull recording unavailable');
  await assert.rejects(built.loop.pull(1), (failure) => {
    assert.ok(leavesOf(failure).some(({ message }) => /card #195 was not started.*record its pull.*initial pull recording unavailable/.test(message)));
    return true;
  });
  assert.equal(built.decisions[0].action.action, 'remove', 'the fixture is otherwise eligible');
  assert.deepEqual(removed, []);
  assert.deepEqual(built.fake.writes(), []);
  assert.deepEqual(built.dispatches.started, []);
  assert.equal((built.repository.held().issues[0].comments ?? []).length, 0);
  assert.deepEqual(cardsOf(built, 'slot.release'), []);
  built.acceptAppends();
  const reached = await built.loop.pull(1);
  assert.deepEqual(removed, [number]);
  assert.equal(reached[0].action, 'escalate');
  assert.equal(built.repository.held().issues[0].comments.length, 1);
  assert.deepEqual(cardsOf(built, 'slot.release'), [number]);
});


import { join } from 'node:path';
import { repositoryIn } from './git-repository.mjs';
import { removeCardDirectories } from '../src/execution/workspace.mjs';

// proves R-WORK-36, R-RECORD-9
test('an actual closed cleanup names its unrecorded removal while a one-shot refusal permits ordinary dispatch and persistent refusal prevents it', BOUNDS[60_000], async (t) => {
  for (const persistent of [false, true]) {
    const number = 196;
    const repository = repositoryIn('rigger-closed-record-repository-');
    const root = temporaryDirectory('rigger-closed-record-root-');
    const scratch = join(root, 'scratch', `rigger-${number}`, 'reviewer');
    fs.mkdirSync(scratch, { recursive: true });
    fs.writeFileSync(join(scratch, 'retained.txt'), 'scratch to remove');
    let built;
    let refused = false;
    let removals = 0;
    const sink = { emitter: (context) => {
      const original = built.sink.emitter(context);
      return { emit: (event, fields) => {
        if (!refused && context.layer === 'L1' && event === 'workspace.removed') {
          refused = true;
          built.refuseAppends('cleanup event recording unavailable', persistent ? Infinity : 1);
        }
        return original.emit(event, fields);
      } };
    } };
    built = world({ cards: [cardIn(number, COLUMNS.review)], fresh: false, answer: () => ({ exit: 1 }), forge: { pullRequests: [{ number: 733, head: `rigger-${number}`, sha: 'd6d079f3258e1b74aad7baf725895b8d74c5b315', closed: true }] },
      removeDirectories: async (card) => { removals += 1; return removeCardDirectories({ root, repository, topic: 'rigger-{number}', card, sink }); },
    });
    const running = built.loop.pull(1);
    const ended = settledOf(running);
    running.catch(() => {});
    t.after(async () => { built.acceptAppends(); built.dispatches.releaseAll(); await running.catch(() => {}); });
    await waitFor(() => ended() || built.dispatches.holding().includes(number));
    assert.equal(removals, 1);
    assert.equal(refused, true, 'the actual L1 removal reached its event');
    assert.equal(fs.existsSync(scratch), false, 'the removal happened before its refused record');
    assert.deepEqual(built.dispatches.started, persistent ? [] : [number]);
    built.dispatches.releaseAll();
    await assert.rejects(running, (failure) => {
      const leaves = leavesOf(failure);
      const removal = leaves.find((held) => held.code === EVENT_REFUSED && held.unrecorded?.some(({ event }) => event === 'workspace.removed'));
      assert.ok(removal, leaves.map(({ message }) => message).join('\n'));
      assert.match(removal.message, /L1's workspace.removed of card #196.*went unrecorded.*cleanup event recording unavailable/);
      assert.equal(removal.unrecorded[0].path, scratch);
      if (persistent) {
        assert.ok(leaves.some(({ message }) => /moved from review to coding.*refused to record it/.test(message)));
        assert.deepEqual(failure.reached, []);
      } else assert.equal(failure.reached[0].outcome.value.exit, 1);
      return true;
    });
  }
});


// proves R-WORK-40
test('a held Review judge whose pull closes keeps the card directories until the first eligible pull after its dispatch ends', BOUNDS[60_000], async (t) => {
  const number = 197;
  const pull = 1970;
  const removed = [];
  const built = world({ cards: [cardIn(number, COLUMNS.review)], fresh: false,
    kinds: { change: { ...KINDS.change, judges: ['reviewer'] } },
    forge: { branches: [`rigger-${number}`], pullRequests: [{ ...pullFor(number), number: pull }] },
    removeDirectories: async (card) => { removed.push(card); },
  });
  built.agent.plan(number, 'reviewer', { hold: true, exit: 1 });
  const running = built.loop.pull(1);
  const ended = settledOf(running);
  running.catch(() => {});
  t.after(async () => { if (built.agent.held(number, 'reviewer')) built.agent.release(number, 'reviewer'); await running.catch(() => {}); });
  await waitFor(() => ended() || built.agent.held(number, 'reviewer'));
  assert.equal(built.agent.held(number, 'reviewer'), true);
  built.repository.update(pull, { closed: true });
  const closed = await built.repository.operations.readPullRequests(`rigger-${number}`);
  assert.deepEqual(closed.open, []);
  assert.deepEqual(closed.merged, []);
  assert.equal(closed.closed.length, 1);
  assert.equal((await columnsOf(built.fake))[number], COLUMNS.review);
  assert.deepEqual((await built.fake.operations.readItems())[0].labels, ['type:change']);
  assert.deepEqual(await built.loop.pull(1), [], 'a fresh trigger cannot clean beneath this active judge');
  assert.deepEqual(removed, []);
  assert.deepEqual(cardsOf(built, 'slot.release'), []);
  built.agent.release(number, 'reviewer');
  const first = await running;
  assert.equal(first[0].judges[0].outcome.value.exit, 1);
  assert.deepEqual(removed, []);
  const later = await built.loop.pull(1);
  assert.deepEqual(removed, [number]);
  assert.equal(later[0].action, 'escalate');
  assert.deepEqual(cardsOf(built, 'pull'), [number, number]);
  assert.deepEqual(cardsOf(built, 'slot.release'), [number, number]);
});

import { pullFor } from './judge-world.mjs';


// proves R-WORK-40
test('another cards held maker does not exclude an eligible closed cleanup when a concurrency slot remains', BOUNDS[60_000], async (t) => {
  const target = 198;
  const other = 199;
  const removed = [];
  const built = world({ cards: [cardIn(target, COLUMNS.done), other], concurrency: 2, fresh: false, answer: () => ({ exit: 1 }),
    forge: { pullRequests: [{ number: 733, head: `rigger-${target}`, sha: 'd6d079f3258e1b74aad7baf725895b8d74c5b315', closed: true }] },
    removeDirectories: async (card) => { removed.push(card); },
  });
  const running = built.loop.pull(1);
  const ended = settledOf(running);
  running.catch(() => {});
  t.after(async () => { built.dispatches.releaseAll(); await running.catch(() => {}); });
  await waitFor(() => ended() || built.dispatches.holding().includes(other));
  assert.deepEqual(built.dispatches.started, [other]);
  await built.fake.operations.moveItem('item-1', COLUMNS.owner);
  const reached = await built.loop.pull(1);
  assert.deepEqual(removed, [target]);
  assert.equal(reached[0].action, 'escalate');
  assert.equal(built.dispatches.holding().includes(other), true, 'cleanup completes while the other dispatch still runs');
  assert.deepEqual(cardsOf(built, 'slot.release'), [target]);
  built.dispatches.releaseAll();
  await running;
  assert.deepEqual(cardsOf(built, 'pull'), [other, target]);
  assert.deepEqual(cardsOf(built, 'slot.release'), [target, other]);
});


// proves R-WORK-36
test('a closed cleanup rechecks claim availability after an independently delayed facts read', BOUNDS[60_000], async (t) => {
  const number = 200;
  const built = world({ cards: [cardIn(number, COLUMNS.owner)], forge: { pullRequests: [{ number: 733, head: `rigger-${number}`, sha: 'd6d079f3258e1b74aad7baf725895b8d74c5b315', closed: true }] } });
  const settings = { ...config, concurrency: 2, board: { ...config.board, columns: COLUMNS } };
  const decide = (card) => nextAction(card, KINDS, undefined, { roles: settings.roles, provisioning: {}, sink: built.sink });
  const readFacts = factsCall({ config: settings, reads: built.repository.operations, decide });
  let releaseFacts;
  let releaseRemoval;
  const factsWait = new Promise((resolve) => { releaseFacts = resolve; });
  const removalWait = new Promise((resolve) => { releaseRemoval = resolve; });
  let reads = 0;
  let heldFacts = false;
  let removals = 0;
  const handle = loop({ config: settings, board: handleOn(built.fake), decide, l2: built.l2, sink: built.sink, kill: async () => {},
    facts: async (cards) => {
      const answer = await readFacts(cards);
      if (++reads === 1) { heldFacts = true; await factsWait; }
      return answer;
    },
    workspace: async () => { assert.fail('this closed Owner card starts no maker'); },
    judgeDirectory: async () => { assert.fail('this closed Owner card starts no judge'); },
    removeDirectories: async () => { removals += 1; await removalWait; }, state: built.directory, environment: {}, run: 'r-test',
  });
  const first = handle.pull(1);
  const firstEnded = settledOf(first);
  first.catch(() => {});
  let second;
  t.after(async () => { releaseFacts(); releaseRemoval(); await Promise.allSettled([first, second].filter(Boolean)); });
  await waitFor(() => heldFacts);
  assert.equal(removals, 0);
  second = handle.pull(1);
  const ended = settledOf(second);
  second.catch(() => {});
  await waitFor(() => ended() || removals > 0);
  assert.equal(removals, 1);
  releaseFacts();
  await waitFor(() => firstEnded() || removals > 1);
  assert.equal(removals, 1, 'stale facts must not enter a second removal');
  assert.deepEqual(await first, [], 'the stale facts caller takes no second same-card claim');
  assert.equal(removals, 1);
  assert.deepEqual(cardsOf(built, 'slot.release'), []);
  assert.equal((built.repository.held().issues[0].comments ?? []).length, 0);
  releaseRemoval();
  const reached = await second;
  assert.equal(reached[0].action, 'escalate');
  assert.deepEqual(cardsOf(built, 'pull'), [number]);
  assert.deepEqual(cardsOf(built, 'slot.release'), [number]);
});


// proves R-WORK-36
test('one closed claim spans delayed removal and every following owner write without duplicate cleanup or early release', BOUNDS[60_000], async (t) => {
  const number = 201;
  const entered = [];
  const releases = [];
  const wait = () => new Promise((resolve) => { releases.push(resolve); });
  const removal = wait();
  const built = world({ cards: [cardIn(number, COLUMNS.review)], forge: { branches: [`rigger-${number}`], pullRequests: [{ number: 733, head: `rigger-${number}`, sha: 'd6d079f3258e1b74aad7baf725895b8d74c5b315', closed: true }] },
    removeDirectories: async () => { entered.push('remove'); await removal; },
  });
  for (const [target, operation] of [[built.repository, 'postIssueComment'], [built.fake.operations, 'moveItem'], [built.repository, 'addIssueLabel']]) {
    const original = target[operation];
    const held = wait();
    target[operation] = async (...args) => { entered.push(operation); await held; return original(...args); };
  }
  const overlaps = [];
  const running = built.loop.run();
  const ended = settledOf(running);
  running.catch(() => {});
  t.after(async () => { for (const release of releases) release(); await Promise.allSettled([running, ...overlaps]); });
  const order = ['remove', 'postIssueComment', 'moveItem', 'addIssueLabel'];
  for (const [at, operation] of order.entries()) {
    await waitFor(() => ended() || entered.includes(operation));
    assert.deepEqual(entered, order.slice(0, at + 1));
    assert.deepEqual(cardsOf(built, 'slot.release'), []);
    const beforeOverlap = entered.length;
    const overlap = built.loop.pull(1);
    overlaps.push(overlap);
    const overlapEnded = settledOf(overlap);
    overlap.catch(() => {});
    await waitFor(() => overlapEnded() || entered.length > beforeOverlap);
    assert.deepEqual(entered, order.slice(0, at + 1), 'an overlapping pull must not enter another operation');
    assert.deepEqual(await overlap, [], `${operation} still owns the only same-card claim`);
    assert.deepEqual(cardsOf(built, 'pull'), [number]);
    assert.deepEqual(cardsOf(built, 'slot.release'), []);
    if (operation === 'remove') assert.equal((await columnsOf(built.fake))[number], COLUMNS.review);
    releases[at]();
  }
  const reached = await running;
  assert.equal(reached[0].action, 'escalate');
  assert.deepEqual(entered, order);
  assert.deepEqual(cardsOf(built, 'slot.release'), [number]);
  assert.equal(built.repository.held().issues[0].comments.length, 1);
  assert.deepEqual(await built.loop.pull(1), [], 'a fresh labelled read starts no more cleanup');
  assert.deepEqual(entered, order);
});


// proves R-WORK-36, R-WORK-39
test('reopening before closed facts prevents removal while reopening after the selected snapshot restores no removed directory', BOUNDS[60_000], async () => {
  for (const when of ['before', 'after']) {
    const number = 202;
    const repository = repositoryIn('rigger-closed-reopen-repository-');
    const root = temporaryDirectory('rigger-closed-reopen-root-');
    const scratch = join(root, 'scratch', `rigger-${number}`, 'reviewer');
    fs.mkdirSync(scratch, { recursive: true });
    fs.writeFileSync(join(scratch, 'kept.txt'), 'scratch');
    let built;
    let removals = 0;
    built = world({ cards: [cardIn(number, COLUMNS.owner)], fresh: false,
      forge: { pullRequests: [{ ...pullFor(number), closed: true }] },
      removeDirectories: async (card) => {
        removals += 1;
        assert.equal(built.decisions[0].action.action, 'remove');
        built.repository.update(1000 + number, { closed: false });
        await removeCardDirectories({ root, repository, topic: 'rigger-{number}', card, sink: built.sink });
      },
    });
    if (when === 'before') built.repository.update(1000 + number, { closed: false });
    const reached = await built.loop.pull(1);
    const facts = await built.repository.operations.readPullRequests(`rigger-${number}`);
    assert.equal(facts.open.length, 1, 'the collaborator really reopened the pull');
    assert.deepEqual(facts.closed, []);
    assert.equal(removals, when === 'before' ? 0 : 1);
    assert.equal(fs.existsSync(scratch), when === 'before');
    if (when === 'before') assert.deepEqual(reached, []);
    else {
      assert.equal(reached[0].action, 'escalate', 'the selected following action is retained');
      assert.deepEqual(await built.loop.pull(1), []);
      assert.equal(fs.existsSync(scratch), false, 'a later read does not restore removed scratch');
    }
  }
});


import { clonedFromOrigin } from './git-repository.mjs';
import { makeWorkspace } from '../src/execution/workspace.mjs';

// proves R-WORK-36, R-WORK-37
test('a new attempt after closed cleanup retains the real directories it creates on later eligible-looking Coding reads after dispatch ends', BOUNDS[60_000], async (t) => {
  const number = 203;
  const { repository } = clonedFromOrigin(temporaryDirectory('rigger-closed-coding-git-'));
  const root = temporaryDirectory('rigger-closed-coding-root-');
  let built;
  let removals = 0;
  let marker;
  built = world({ cards: [cardIn(number, COLUMNS.review)], fresh: false, answer: () => ({ exit: 1 }),
    forge: { pullRequests: [{ ...pullFor(number), closed: true }] },
    removeDirectories: async (card) => { removals += 1; await removeCardDirectories({ root, repository, topic: 'rigger-{number}', card, sink: built.sink }); },
    workspace: async (card) => {
      const made = await makeWorkspace({ root, repository, topic: 'rigger-{number}', card, sink: built.sink });
      marker = join(made.path, 'coding-marker.txt');
      fs.writeFileSync(marker, 'new attempt content');
      return made;
    },
  });
  const running = built.loop.pull(1);
  const ended = settledOf(running);
  running.catch(() => {});
  t.after(async () => { built.dispatches.releaseAll(); await running.catch(() => {}); });
  await waitFor(() => ended() || built.dispatches.holding().includes(number));
  assert.deepEqual(built.dispatches.started, [number]);
  assert.equal(removals, 1);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'new attempt content');
  built.repository.open({ ...pullFor(number), number: 2031 });
  built.repository.update(2031, { closed: true });
  built.dispatches.releaseAll();
  const reached = await running;
  assert.equal(reached[0].outcome.value.exit, 1);
  assert.deepEqual(cardsOf(built, 'slot.release'), [number], 'the active claim no longer masks the Coding predicate');
  const facts = await built.repository.operations.readPullRequests(`rigger-${number}`);
  assert.equal(facts.closed.length, 2);
  assert.deepEqual(facts.open, []);
  assert.deepEqual(facts.merged, []);
  assert.equal((await columnsOf(built.fake))[number], COLUMNS.coding);
  assert.deepEqual((await built.fake.operations.readItems())[0].labels, ['type:change']);
  assert.equal((await built.loop.pull(1))[0].action, 'escalate', 'the held line escalates the Coding card');
  assert.equal(built.decisions.at(-1).action.action, 'escalate');
  assert.equal((await columnsOf(built.fake))[number], COLUMNS.owner);
  assert.deepEqual((await built.fake.operations.readItems())[0].labels, ['type:change', 'rigger:escalated']);
  assert.deepEqual(built.dispatches.started, [number], 'the later read dispatches no new maker');
  assert.equal(removals, 1, 'the later Coding read performs no closed cleanup');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'new attempt content');
});


// proves R-WORK-36, R-WORK-38
test('a failed closed cleanup followed by escalation stays withheld until the owner clears the label before a fresh eligible invocation', async () => {
  const number = 204;
  const fake = boardOf([cardIn(number, COLUMNS.owner)]);
  const remaining = new Error('/scratch/rigger-204/reviewer remains after partial removal');
  let removals = 0;
  const built = world({ fake, forge: { pullRequests: [{ ...pullFor(number), closed: true }] }, removeDirectories: async () => { removals += 1; throw remaining; } });
  await assert.rejects(built.loop.pull(1), (failure) => {
    assert.ok(leavesOf(failure).some((held) => held.message === remaining.message && held.code === remaining.code && held.unreadable === remaining.unreadable));
    assert.equal(failure.reached[0].action, 'escalate');
    return true;
  });
  assert.deepEqual((await fake.operations.readItems())[0].labels, ['type:change', 'rigger:escalated']);
  assert.deepEqual(await built.loop.pull(1), []);
  assert.deepEqual(await built.loop.run(), []);
  assert.equal(removals, 1, 'the new label withholds a retry of even failed removal');
  const held = built.repository.held();
  fake.setIssueLabels(config.repo, number, ['type:change']);
  const cleared = { ...held, issues: held.issues.map((issue) => ({ ...issue, labels: ['type:change'] })) };
  const retry = world({ fake, forge: cleared, removeDirectories: async () => { removals += 1; } });
  assert.deepEqual((await retry.repository.operations.readIssue(number)).labels, ['type:change'], 'the owner-cleared issue and fresh board agree');
  const reached = await retry.loop.pull(1);
  assert.equal(removals, 2);
  assert.equal(reached[0].action, 'escalate');
  assert.equal(retry.repository.held().issues[0].comments.length, 2, 'the fresh invocation preserves the prior issue facts');
  assert.deepEqual((await fake.operations.readItems())[0].labels, ['type:change', 'rigger:escalated']);
});

// proves R-LOOP-2, R-ESCALATE-4
test('L3 stamps the maker id and routes its issue note to Owner without dispatching a judge', { timeout: 20_000 }, async (t) => {
  const number = 939;
  const note = (id) => [
    'I cannot meet acceptance item 1.',
    '```rigger-escalation',
    'category: ambiguous',
    'item: 1',
    'reason: The needed decision is missing.',
    `dispatch: ${id}`,
    '```',
    '',
  ].join('\n');
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };
  const built = world({ cards: [number], concurrency: 1, kinds,
    judgeDirectory: () => assert.fail('a maker escalation dispatches no judge'),
  });
  const pulled = built.loop.pull(1);
  t.after(async () => {
    built.dispatches.releaseAll();
    await pulled.catch(() => {});
  });
  await waitFor(() => built.dispatches.heldNow(number));
  const id = built.events().find(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'engineer').dispatch;
  const input = built.agent.runs().find(({ card, role }) => card === number && role === 'engineer').input;
  assert.ok(input.includes(`dispatch: ${id}`), 'the maker sees the id of its L3 dispatch');

  await built.repository.postIssueComment(number, note(id));
  built.dispatches.release(number);
  await pulled;

  const [card] = await built.fake.operations.readItems();
  assert.equal(card.column, config.board.columns.owner);
  assert.deepEqual(card.labels, ['type:change', 'rigger:escalated']);
  const [event] = built.events().filter(({ event }) => event === 'review.escalate');
  assert.deepEqual({ raiser: event.raiser, dispatch: event.dispatch, category: event.category, item: event.item, reason: event.reason },
    { raiser: 'maker', dispatch: id, category: 'ambiguous', item: 1, reason: 'The needed decision is missing.' });
  const issue = built.repository.held().issues.find(({ number: held }) => held === number);
  assert.equal(issue.comments.length, 2, 'the maker note and one engine comment sit on the issue');
  assert.match(issue.comments[1].body, /owner \(ambiguous\)/);
  assert.match(issue.comments[1].body, /The needed decision is missing\./);
  assert.match(issue.comments[1].body, /Acceptance item: 1/);
  assert.equal(built.agent.runs().filter(({ role }) => role === 'reviewer').length, 0);
});

// proves R-LOOP-2, R-ESCALATE-4
test('a refused maker note escalation keeps the card out of later pulls in the invocation', { timeout: 20_000 }, async (t) => {
  const number = 940;
  const refusal = new Error('the issue comment write was refused');
  const fake = boardOf([number]);
  const built = world({ fake, concurrency: 1, fresh: false, answer: () => ({ exit: 4, output: '' }),
    kinds: { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } },
    judgeDirectory: () => assert.fail('a refused maker escalation dispatches no judge'),
  });
  const claimed = built.l2.claimed;
  let claims = 0;
  built.l2.claimed = async (...args) => {
    claims += 1;
    if (claims > 1) {
      fake.setIssueLabels(config.repo, number, ['type:change', 'rigger:escalated']);
      throw new Error('a second claim must not begin');
    }
    return claimed(...args);
  };
  const original = built.repository.postIssueComment;
  let engineWrites = 0;
  built.repository.postIssueComment = async () => { engineWrites += 1; throw refusal; };
  const running = built.loop.run();
  t.after(async () => { built.dispatches.releaseAll(); await running.catch(() => {}); });
  await waitFor(() => built.dispatches.heldNow(number));
  const id = built.events().find(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'engineer').dispatch;
  await original(number, [
    '```rigger-escalation', 'category: critical', 'item: 1',
    'reason: A required condition failed.', `dispatch: ${id}`, '```',
  ].join('\n'));
  built.dispatches.release(number);
  await assert.rejects(running, (failure) => {
    assert.ok(leavesOf(failure).some((held) => held.cause?.message === refusal.message && held.cause?.code === refusal.code && held.cause?.unreadable === refusal.unreadable && /escalation issue comment was refused/.test(held.message)));
    return true;
  });
  assert.deepEqual(cardsOf(built, 'pull'), [number]);
  assert.equal(claims, 1);
  assert.deepEqual(built.dispatches.started, [number]);
  assert.equal(engineWrites, 1);
  assert.equal(built.repository.held().issues.find((issue) => issue.number === number).comments.length, 1);
  assert.deepEqual(await columnsOf(built.fake), { [number]: COLUMNS.coding });
  assert.deepEqual(built.fake.writes().map(({ operation }) => operation), ['moveItem']);
  assert.deepEqual((await built.fake.operations.readItems())[0].labels, ['type:change']);
  assert.equal(built.agent.runs().filter(({ role }) => role === 'reviewer').length, 0);
  assert.equal(built.events().find(({ event }) => event === 'review.escalate').raiser, 'maker');
});

// proves R-SCHED-6
test('J1: run fires a due report occurrence while a claim is held', async () => {
  const clock = manualClock();
  const built = reportWorld(clock);
  const { handed, stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    await clock.advance(CLOCK_START + 1000);
    const firings = built.l3Events().filter((event) => event.trigger === 'clock' || event.event === 'trigger.outcome');
    assert.deepEqual(firings.map(({ event, trigger, name, occurrence, outcome }) => ({ event, trigger, name, occurrence, outcome })), [
      { event: 'trigger', trigger: 'clock', name: 'hourly', occurrence: new Date(CLOCK_START + 1000).toISOString(), outcome: undefined },
      { event: 'trigger.outcome', trigger: undefined, name: 'hourly', occurrence: new Date(CLOCK_START + 1000).toISOString(), outcome: 'job' },
    ]);
    built.dispatches.releaseAll();
    await stop();
    const answer = { reports: reportsIn(handed) };
    assert.equal(answer.reports.length, 1, 'L3 hands the derived report to the verb');
    assert.ok(answer.reports[0].runs?.length > 0, 'the handed report has the run L5 derived');
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('J13: a failed report settles its occurrence and the next report still fires', async () => {
  const clock = manualClock();
  const built = reportWorld(clock);
  const path = streamPath(built.directory);
  const { handed, stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    fs.appendFileSync(path, 'unreadable event line\n');
    assert.throws(() => deriveReport(built.directory), /line \d+ is not a recorded event/, 'the stream premise makes L5 throw');
    let wakeFailure;
    try { await clock.advance(CLOCK_START + 1000); }
    catch (failure) { wakeFailure = failure; }
    fs.writeFileSync(path, fs.readFileSync(path, 'utf8').split('\n').filter((line) => line !== 'unreadable event line').join('\n'));
    assert.equal(wakeFailure, undefined, 'L3 handles L5 failure without throwing from the timer');
    assert.deepEqual(built.l3Events().filter(({ event }) => event === 'trigger.outcome').map(({ outcome }) => outcome), ['failed']);
    await clock.advance(CLOCK_START + 2000);
    assert.deepEqual(built.l3Events().filter(({ event }) => event === 'trigger.outcome').map(({ outcome }) => outcome), ['failed', 'job']);
    built.dispatches.releaseAll();
    await stop();
    const failure = { errors: failuresIn(handed) };
    const messages = failure.errors.map((held) => held.message);
    assert.ok(messages.some((message) => /hourly/.test(message) && /2026-10-29T12:00:01.000Z/.test(message)
      && /line \d+ is not a recorded event/.test(message)), messages.join('\n'));
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('J11: a refused clock start runs no report and leaves the occurrence due for the next wake', async () => {
  const clock = manualClock();
  const scheduled = [];
  const schedule = clock.schedule;
  clock.schedule = (call, delay) => {
    scheduled.push(delay);
    return schedule(call, delay);
  };
  const built = reportWorld(clock);
  const { handed, stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    const armedBeforeRefusal = scheduled.length;
    built.refuseAppends('clock start refused', 1);
    const readFile = fs.readFileSync;
    let streamReads = 0;
    fs.readFileSync = (path, ...args) => {
      if (path === streamPath(built.directory)) streamReads += 1;
      return readFile(path, ...args);
    };
    syncBuiltinESMExports();
    let wakeFailure;
    try {
      try { await clock.advance(CLOCK_START + 1000); }
      catch (failure) { wakeFailure = failure; }
    } finally {
      fs.readFileSync = readFile;
      syncBuiltinESMExports();
    }
    assert.equal(wakeFailure, undefined, 'the timer hands a start refusal to run');
    assert.equal(streamReads, 0, 'a refused start never calls L5 report to read the stream');
    assert.deepEqual(scheduled.slice(armedBeforeRefusal), [1000], 'a refused start schedules only the next occurrence, without an early retry');
    assert.deepEqual(built.l3Events().filter(({ trigger, event }) => trigger === 'clock' || event === 'trigger.outcome'), []);
    built.acceptAppends();
    await clock.advance(CLOCK_START + 2000);
    assert.deepEqual(built.l3Events().filter(({ trigger }) => trigger === 'clock').map(({ occurrence }) => occurrence), [
      new Date(CLOCK_START + 2000).toISOString(),
    ]);
    built.dispatches.releaseAll();
    await stop();
    const failure = { errors: failuresIn(handed), reports: reportsIn(handed), message: JSON.stringify(handed) };
    assert.ok(failure.errors.some((held) => /clock start refused/.test(held.message)), failure.message);
    assert.equal(failure.reports.length, 1, 'only the second occurrence ran report');
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('J12: a refused report outcome is abandoned before the next occurrence fires', async () => {
  const clock = manualClock();
  const built = reportWorld(clock);
  const originalEmitter = built.sink.emitter;
  let refusedOnce = false;
  built.sink.emitter = (context) => {
    const emitter = originalEmitter(context);
    return { emit(event, fields) {
      if (event === 'trigger.outcome' && !refusedOnce) {
        refusedOnce = true;
        throw new Error('clock outcome refused');
      }
      return emitter.emit(event, fields);
    } };
  };
  const { handed, stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    let wakeFailure;
    try { await clock.advance(CLOCK_START + 1000); }
    catch (failure) { wakeFailure = failure; }
    assert.equal(wakeFailure, undefined, 'the timer hands an outcome refusal to run');
    assert.equal(refusedOnce, true, 'the sink refused the first report outcome');
    assert.deepEqual(built.l3Events().filter(({ event }) => event === 'trigger.outcome'), []);
    await clock.advance(CLOCK_START + 2000);
    assert.deepEqual(built.l3Events().filter(({ event }) => event === 'trigger.outcome')
      .map(({ occurrence, outcome }) => [occurrence, outcome]), [
      [new Date(CLOCK_START + 1000).toISOString(), 'abandoned'],
      [new Date(CLOCK_START + 2000).toISOString(), 'job'],
    ]);
    assert.deepEqual(built.l3Events().filter(({ trigger }) => trigger === 'clock').map(({ occurrence }) => occurrence), [
      new Date(CLOCK_START + 1000).toISOString(), new Date(CLOCK_START + 2000).toISOString(),
    ]);
    built.dispatches.releaseAll();
    await stop();
    const failure = { errors: failuresIn(handed), message: JSON.stringify(handed) };
    assert.ok(failure.errors.some((held) => /clock outcome refused/.test(held.message)), failure.message);
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('J12: a freed-slot pull settles a pending report before another clock wake', async () => {
  const clock = manualClock();
  const built = reportWorld(clock);
  const originalEmitter = built.sink.emitter;
  let refusedOnce = false;
  built.sink.emitter = (context) => {
    const emitter = originalEmitter(context);
    return { emit(event, fields) {
      if (event === 'trigger.outcome' && !refusedOnce) {
        refusedOnce = true;
        throw new Error('outcome pending until pull');
      }
      return emitter.emit(event, fields);
    } };
  };
  const { handed, stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    await clock.advance(CLOCK_START + 1000);
    built.dispatches.releaseAll();
    await positive(() => settledIn(handed).length === 1);
    await stop();
    assert.ok(failuresIn(handed).some(({ message }) => /outcome pending until pull/.test(message)), JSON.stringify(handed));
    const events = built.l3Events();
    const abandoned = events.findIndex(({ event, outcome }) => event === 'trigger.outcome' && outcome === 'abandoned');
    const nextPull = events.findIndex(({ event, trigger }, at) => at > abandoned && event === 'trigger' && trigger === 'pull');
    assert.ok(abandoned >= 0 && nextPull > abandoned, 'the freed-slot pull settles the pending report first');
    assert.equal(clock.pending(), 0, 'the run ended before a second clock wake');
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('J14: run hands its injected clock to L3 while a claim is held', async () => {
  const clock = manualClock();
  const { agent, consumer, stop } = await keptUpVerb(clockVerb, runVerb, clock);
  try {
    assert.equal(clock.pending(), 1, 'run armed the report timer through L3');
    await clock.advance(CLOCK_START + 1000);
    const events = (await import('../src/observation/sink.mjs')).readEvents(`${consumer}/.rigger`);
    assert.deepEqual(events.filter(({ trigger }) => trigger === 'clock').map(({ name, occurrence }) => [name, occurrence]), [
      ['hourly', new Date(CLOCK_START + 1000).toISOString()],
    ]);
  } finally {
    if (agent.held(10)) agent.release(10);
    await stop().catch(() => {});
  }
});

test('J14: run prints the report hand-over before its card lines without changing the card status', async () => {
  const clock = manualClock();
  const { agent, consumer, written, stop } = await keptUpVerb(clockVerb, runVerb, clock);
  try {
    await clock.advance(CLOCK_START + 1000);
    const path = streamPath(`${consumer}/.rigger`);
    const lines = fs.readFileSync(path, 'utf8').trimEnd().split('\n');
    assert.equal(JSON.parse(lines.at(-1)).event, 'trigger.outcome', 'the firing completed before the snapshot');
    const snapshot = temporaryDirectory('rigger-clock-report-snapshot-');
    fs.writeFileSync(streamPath(snapshot), `${lines.slice(0, -1).join('\n')}\n`);
    const expected = reportText({ ...deriveReport(snapshot), path });
    agent.release(10);
    const stopped = await stop();
    const answer = { ...stopped, text: [...written, stopped.text].join('\n') };
    const cardLine = answer.text.indexOf('rigger run: claimed #10');
    const reportLine = answer.text.indexOf(`rigger report: the events recorded at ${path}`);
    assert.ok(reportLine >= 0 && cardLine > reportLine, answer.text);
    assert.equal(answer.text.slice(reportLine, reportLine + expected.length + 1), `${expected}\n`, 'run writes exactly the report rendering of the event snapshot, whole');
    assert.equal(answer.code, 1, 'the card outcome alone decides this run status');
  } finally {
    if (agent.held(10)) agent.release(10);
    await stop().catch(() => {});
  }
});

test('J13 J14: run prints a successful report before a later failed report and exits one', async () => {
  const clock = manualClock();
  const { agent, consumer, written, stop } = await keptUpVerb(clockVerb, runVerb, clock);
  const path = streamPath(`${consumer}/.rigger`);
  try {
    await clock.advance(CLOCK_START + 1000);
    fs.appendFileSync(path, 'unreadable event line\n');
    assert.throws(() => deriveReport(`${consumer}/.rigger`), /line \d+ is not a recorded event/);
    await clock.advance(CLOCK_START + 2000);
    fs.writeFileSync(path, fs.readFileSync(path, 'utf8').split('\n').filter((line) => line !== 'unreadable event line').join('\n'));
    agent.release(10);
    const answer = { ...(await stop()), text: written.join('\n') };
    const reportAt = answer.text.indexOf(`rigger report: the events recorded at ${path}`);
    const failureAt = answer.text.indexOf(`rigger run: clock trigger hourly at ${new Date(CLOCK_START + 2000).toISOString()}`);
    assert.ok(reportAt >= 0 && failureAt > reportAt, answer.text);
    assert.match(answer.text.slice(failureAt), /line \d+ is not a recorded event/);
    assert.equal(answer.code, 1);
  } finally {
    if (agent.held(10)) agent.release(10);
    await stop().catch(() => {});
  }
});

// proves R-SCHED-34
test('J2 J3: owner and Rigger admission closers do not stop a due report while a claim is held', async () => {
  for (const kind of ['owner', 'hold']) {
    const clock = manualClock();
    const built = reportWorld(clock);
    const { stop } = keptUp(built);
    try {
      await positive(() => built.dispatches.held() === 1);
      if (kind === 'owner') seed(built.directory, 'owner-a1.json', closerText({ reason: 'owner paused claims' }));
      else await moduleOver(built.directory).close({ kind: 'hold', reason: 'Rigger held claims' });
      await clock.advance(CLOCK_START + 1000);
      assert.deepEqual(built.l3Events().filter(({ event }) => event === 'trigger.outcome')
        .map(({ name, outcome }) => [name, outcome]), [['hourly', 'job']], kind);
      built.dispatches.releaseAll();
    } finally {
      built.dispatches.releaseAll();
      await stop();
    }
  }
});

// proves R-SCHED-35
test('J4: once never arms or fires a clock report while its claim is held', async () => {
  const clock = manualClock();
  const { agent, consumer, running } = await clockVerb(onceVerb, clock);
  try {
    assert.equal(clock.pending(), 0);
    await clock.advance(CLOCK_START + 1000);
    const events = (await import('../src/observation/sink.mjs')).readEvents(`${consumer}/.rigger`);
    assert.deepEqual(events.filter(({ trigger, event }) => trigger === 'clock' || event === 'trigger.outcome'), []);
    agent.release(10);
    const answer = await running;
    assert.doesNotMatch(answer.text, /rigger report:/);
  } finally {
    if (agent.held(10)) agent.release(10);
    await running.catch(() => {});
  }
});

// proves R-SCHED-5
test('J5 J6: a due report with every slot held adds no dispatch or claim and leaves the slot held', async () => {
  const clock = manualClock();
  const built = reportWorld(clock);
  const { stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    const before = built.events().length;
    const started = [...built.dispatches.started];
    await clock.advance(CLOCK_START + 1000);
    const during = built.events().slice(before);
    assert.deepEqual(during.filter(({ layer, event }) => (layer === 'L3' && event === 'dispatch') || (layer === 'L1' && event === 'dispatch.start')), []);
    assert.deepEqual(during.filter(({ layer, event }) => layer === 'L3' && event === 'slot.release'), []);
    assert.deepEqual(during.filter(({ layer, event }) => layer === 'L3' && event === 'trigger.outcome').map(({ outcome }) => outcome), ['job']);
    assert.deepEqual(built.dispatches.started, started);
    assert.deepEqual(built.dispatches.holding(), [1], 'the claim still holds the only slot');
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('J7: a late wake fires only the newest due occurrence', async () => {
  const clock = manualClock();
  const built = reportWorld(clock);
  const { stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    await clock.advance(CLOCK_START + 3500);
    assert.deepEqual(built.l3Events().filter(({ trigger }) => trigger === 'clock').map(({ occurrence }) => occurrence), [
      new Date(CLOCK_START + 3000).toISOString(),
    ]);
    assert.deepEqual(built.l3Events().filter(({ event }) => event === 'trigger.outcome').map(({ outcome }) => outcome), ['job']);
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('J8: an occurrence at the start with no arming record never fires in that run', async () => {
  const clock = manualClock(CLOCK_START + 1000);
  const built = reportWorld(clock);
  const { stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    assert.deepEqual(built.events().filter(({ event }) => event === 'trigger.armed'), [], 'the state holds no arming');
    await clock.advance(CLOCK_START + 1500);
    assert.deepEqual(built.l3Events().filter(({ trigger }) => trigger === 'clock'), []);
    await clock.advance(CLOCK_START + 2000);
    assert.deepEqual(built.l3Events().filter(({ trigger }) => trigger === 'clock').map(({ occurrence }) => occurrence), [
      new Date(CLOCK_START + 2000).toISOString(),
    ]);
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('J9: different due occurrences fire serially with the earlier occurrence first', async () => {
  const clock = manualClock();
  const trigger = (interval) => ({ interval, anchor: new Date(CLOCK_START).toISOString(), catchUp: 'skip', job: 'report' });
  const built = reportWorld(clock, { triggers: { later: trigger(2000), earlier: trigger(1500) } });
  const { stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    await clock.advance(CLOCK_START + 2500);
    assert.deepEqual(built.l3Events().filter(({ trigger, event }) => trigger === 'clock' || event === 'trigger.outcome')
      .map(({ event, name, occurrence }) => [event, name, occurrence]), [
      ['trigger', 'earlier', new Date(CLOCK_START + 1500).toISOString()],
      ['trigger.outcome', 'earlier', new Date(CLOCK_START + 1500).toISOString()],
      ['trigger', 'later', new Date(CLOCK_START + 2000).toISOString()],
      ['trigger.outcome', 'later', new Date(CLOCK_START + 2000).toISOString()],
    ]);
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('J10: triggers due at one occurrence fire serially in code-unit name order', async () => {
  const clock = manualClock();
  const trigger = { interval: 1000, anchor: new Date(CLOCK_START).toISOString(), catchUp: 'skip', job: 'report' };
  const built = reportWorld(clock, { triggers: { zeta: trigger, Alpha: trigger } });
  const { stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    await clock.advance(CLOCK_START + 1000);
    assert.deepEqual(built.l3Events().filter(({ trigger, event }) => trigger === 'clock' || event === 'trigger.outcome')
      .map(({ event, name }) => [event, name]), [
      ['trigger', 'Alpha'], ['trigger.outcome', 'Alpha'], ['trigger', 'zeta'], ['trigger.outcome', 'zeta'],
    ]);
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('J15: absent and empty clocks retain the same run answer and event sequence', async () => {
  const clock = manualClock();
  const worlds = [
    world({ cards: [1], concurrency: 1, clock }),
    reportWorld(clock, { triggers: {} }),
  ];
  const observed = [];
  for (const built of worlds) {
    const answer = await drive(built);
    assert.equal(clock.pending(), 0, 'no report timer is held');
    assert.deepEqual(built.l3Events().filter(({ trigger }) => trigger === 'clock'), []);
    observed.push({
      events: built.events().map(({ layer, event, card, trigger }) => ({ layer, event, card, trigger })),
      answer: answer.map(({ card, settled, judges }) => ({ card, settled: settled?.status, judges: judges?.length })),
    });
  }
  assert.deepEqual(observed[1], observed[0]);
});

test('J16: the default clock fires a report while a claim holds run open', async () => {
  const built = reportWorld(undefined);
  const { stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    await positive(() => built.l3Events().some(({ event, outcome }) => event === 'trigger.outcome' && outcome === 'job'));
    assert.equal(built.l3Events().filter(({ trigger }) => trigger === 'clock').length, 1);
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

/** How many `trigger` events of kind `kind` L3 has recorded in `built`. */
const count = (built, kind) => triggersOf(built).filter((trigger) => trigger === kind).length;

/** A report trigger whose first occurrence is an hour after the clock's start, so no firing falls in a poll test. */
const HOUR_AWAY = { hourly: { interval: 3_600_000, anchor: new Date(CLOCK_START).toISOString(), catchUp: 'skip', job: 'report' } };

/** A card-shaped trigger, which this card's head arms and fires nothing for. */
const CARD_SHAPED = { daily: { interval: 1000, anchor: new Date(CLOCK_START).toISOString(), catchUp: 'skip',
  card: { title: 'Audit', labels: ['type:change'], acceptance: '- The audit writes a result.' } } };

// proves R-SCHED-28
test('L1: run stays up past the drain while a report trigger is declared, recording one drain for the idle period', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [], triggers: HOUR_AWAY });
  const { running, handed, stop } = keptUp(built);
  const ended = settledOf(running);
  try {
    await positive(() => count(built, 'drain') === 1);
    await clock.advance(CLOCK_START + 5_000);
    assert.equal(ended(), false, 'run did not end at the drain');
    assert.equal(count(built, 'drain'), 1, 'one drain for the idle period');
    assert.deepEqual(settledIn(handed), [{ status: 'fulfilled', value: [] }], 'the drain handed the verb what settled');
  } finally {
    await stop();
  }
});

// proves R-SCHED-28
test('L2a: a clock declaring only card-shaped triggers keeps run up, and fires nothing', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [], triggers: CARD_SHAPED });
  const { running, stop } = keptUp(built);
  const ended = settledOf(running);
  try {
    await positive(() => count(built, 'drain') === 1);
    await clock.advance(CLOCK_START + 3_500);
    assert.equal(ended(), false, 'run did not end at the drain');
    assert.deepEqual(built.l3Events().filter(({ trigger, event }) => trigger === 'clock' || event === 'trigger.outcome'), []);
  } finally {
    await stop();
  }
});

test('L5: an idle poll that claims nothing fires no second drain in that idle period', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [], triggers: HOUR_AWAY });
  const { stop } = keptUp(built);
  try {
    await positive(() => count(built, 'drain') === 1);
    const pullsAtDrain = count(built, 'pull');
    for (const at of [1000, 2000, 3000]) await clock.advance(CLOCK_START + at);
    assert.equal(count(built, 'pull'), pullsAtDrain + 3, 'three polls fired, one each second');
    assert.equal(count(built, 'drain'), 1);
  } finally {
    await stop();
  }
});

// proves R-SCHED-29
test('L4: an idle poll claims a card that entered Ready no later than the poll interval after it did', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [cardIn(5, COLUMNS.done)], triggers: HOUR_AWAY });
  const { stop } = keptUp(built);
  try {
    await positive(() => count(built, 'drain') === 1);
    await clock.advance(CLOCK_START + 300);
    await built.fake.operations.moveItem('item-1', COLUMNS.ready);
    const entered = clock.now();
    await clock.advance(entered + 1000);
    const claimed = built.l3Events().find(({ event, card }) => event === 'pull' && card === 5);
    assert.ok(claimed, 'a poll within the bound claimed card #5');
    assert.equal(built.l3Events().filter(({ event }) => event === 'pull').length, 1);
    await positive(() => built.dispatches.held() === 1);
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('L6: an idle poll that claims a card ends the idle period, and the next idle period records one drain', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [cardIn(5, COLUMNS.done)], triggers: HOUR_AWAY });
  const { handed, stop } = keptUp(built);
  try {
    await positive(() => count(built, 'drain') === 1);
    await built.fake.operations.moveItem('item-1', COLUMNS.ready);
    await clock.advance(CLOCK_START + 1000);
    await positive(() => built.dispatches.held() === 1);
    built.dispatches.releaseAll();
    await positive(() => count(built, 'drain') === 2);
    await positive(() => settledIn(handed).length === 2);
    assert.deepEqual([...new Set(settledIn(handed)[1].value.map(({ card }) => card))], [5], 'the second drain handed card #5\'s outcomes');
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('L13a: a stop while idle cancels the timer and ends run with nothing more handed and no failure', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [], triggers: HOUR_AWAY });
  const { stop } = keptUp(built);
  await positive(() => count(built, 'drain') === 1);
  assert.equal(clock.pending(), 1, 'the poll timer is pending while idle');
  const answer = await stop();
  assert.deepEqual(answer, []);
  assert.equal(clock.pending(), 0, 'the timer was cancelled');
  const events = built.l3Events().length;
  await clock.advance(CLOCK_START + 10_000);
  assert.equal(built.l3Events().length, events, 'no poll or firing after the stop');
});

test('L13a: a stop with a claim held polls and fires no more and ends once the claim finishes, with what settled since the drain', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { triggers: { hourly: { ...HOUR_AWAY.hourly, interval: 1000 } } });
  const { running, handed, stop } = keptUp(built);
  const ended = settledOf(running);
  await positive(() => built.dispatches.held() === 1);
  const stopped = stop();
  assert.equal(clock.pending(), 0, 'the timer was cancelled');
  await clock.advance(CLOCK_START + 5_000);
  assert.deepEqual(built.l3Events().filter(({ trigger, event }) => trigger === 'clock' || event === 'trigger.outcome'), [], 'no firing after the stop');
  await turnWait(() => true);
  assert.equal(ended(), false, 'run waits for its claim');
  const pulls = count(built, 'pull');
  built.dispatches.releaseAll();
  const answer = await stopped;
  assert.deepEqual(answer.map(({ card }) => card), [1], 'what settled since the previous drain');
  assert.equal(count(built, 'pull'), pulls, 'no poll after the stop');
  assert.deepEqual(handed, [], 'nothing was handed before the stop');
});

test('L2: with no clock key, or a clock holding a poll and no trigger, run ends at the drain with the same events and answer', async () => {
  const observed = [];
  for (const triggers of [undefined, {}]) {
    const clock = manualClock();
    const built = triggers === undefined ? world({ cards: [1], concurrency: 1, clock }) : reportWorld(clock, { triggers });
    const answer = await drive(built);
    assert.equal(clock.pending(), 0, 'no timer is held');
    observed.push({
      events: built.events().map(({ layer, event, card, trigger }) => ({ layer, event, card, trigger })),
      answer: answer.map(({ card, settled }) => ({ card, settled: settled?.status })),
    });
  }
  assert.deepEqual(observed[1], observed[0]);
  assert.equal(observed[0].events.filter(({ event, trigger }) => event === 'trigger' && trigger === 'drain').length, 1);
});

// proves R-SCHED-35
test('L3: once with a clock trigger declared fires one pull, arms nothing and polls nothing', async () => {
  const clock = manualClock();
  const { agent, consumer, running } = await clockVerb(onceVerb, clock);
  try {
    assert.equal(clock.pending(), 0, 'once armed no timer');
    agent.release(10);
    await running;
    await clock.advance(CLOCK_START + 10_000);
    const events = (await import('../src/observation/sink.mjs')).readEvents(`${consumer}/.rigger`);
    assert.deepEqual(events.filter(({ event }) => event === 'trigger').map(({ trigger }) => trigger), ['pull'], 'one pull, and no poll or firing');
  } finally {
    if (agent.held(10)) agent.release(10);
    await running.catch(() => {});
  }
});

test('L7: while a claim is held a clock-held run does not poll, and a slot release fires a pull', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [1, 2], triggers: HOUR_AWAY });
  const { stop } = keptUp(built);
  try {
    await positive(() => built.dispatches.held() === 1);
    const pulls = count(built, 'pull');
    for (const at of [1000, 2000, 3000]) await clock.advance(CLOCK_START + at);
    assert.equal(count(built, 'pull'), pulls, 'no poll while the claim is held');
    built.dispatches.release(built.dispatches.holding()[0]);
    await positive(() => count(built, 'pull') > pulls);
    assert.equal(clock.now(), CLOCK_START + 3000, 'the pull fired at the release, with no clock advance');
    await positive(() => built.dispatches.held() === 1);
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('L8: a poll whose reads outlast the poll interval delays the next, which fires the interval after it settles', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [], triggers: HOUR_AWAY });
  const { stop } = keptUp(built);
  try {
    await positive(() => count(built, 'drain') === 1);
    const release = built.fake.holdNextRead();
    const advancing = clock.advance(CLOCK_START + 1000);
    await positive(() => count(built, 'pull') === 2);
    await clock.advance(CLOCK_START + 2500);
    assert.equal(count(built, 'pull'), 2, 'no second poll while the first is reading');
    release();
    await advancing;
    await clock.advance(CLOCK_START + 3499);
    assert.equal(count(built, 'pull'), 2, 'no poll before the interval after the slow one settled');
    await clock.advance(CLOCK_START + 3500);
    assert.equal(count(built, 'pull'), 3, 'the next poll fired the interval after the slow one settled');
  } finally {
    await stop();
  }
});

test('L9: after a claim whose move the board refused, the first poll that finds nothing to pull records the drain', async () => {
  const clock = manualClock();
  const fake = boardOf([1]);
  const built = reportWorld(clock, { fake, items: { ...fake.operations, moveItem: async () => { throw new Error('the board refused the move'); } }, triggers: HOUR_AWAY });
  const { handed, stop } = keptUp(built);
  try {
    await positive(() => settledIn(handed).length === 1);
    assert.equal(count(built, 'drain'), 0, 'no drain fired since the claim ended');
    await fake.operations.moveItem('item-1', COLUMNS.done);
    await clock.advance(CLOCK_START + 1000);
    assert.equal(count(built, 'drain'), 1, 'the first poll finding nothing records the drain');
    await clock.advance(CLOCK_START + 2000);
    assert.equal(count(built, 'drain'), 1);
  } finally {
    await stop();
  }
});

test('L10: an idle poll with admission closed claims nothing and hands over each closer', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [cardIn(5, COLUMNS.done)], triggers: HOUR_AWAY });
  const { handed, stop } = keptUp(built);
  try {
    await positive(() => settledIn(handed).length === 1);
    seed(built.directory, 'owner-a1.json', closerText({ reason: 'owner paused claims' }));
    await built.fake.operations.moveItem('item-1', COLUMNS.ready);
    await clock.advance(CLOCK_START + 1000);
    assert.equal(built.l3Events().filter(({ event }) => event === 'pull').length, 0, 'the poll claimed nothing');
    const [, closed] = settledIn(handed);
    assert.equal(closed.value.admission.state, 'closed');
    assert.deepEqual(closed.value.admission.closers.map(({ reason }) => reason), ['owner paused claims']);
  } finally {
    await stop();
  }
});

// proves R-SCHED-29
test('L11: a poll whose read fails claims nothing, hands its failure over once, and the next poll on schedule claims the card', async () => {
  const clock = manualClock();
  const fake = boardOf([cardIn(5, COLUMNS.done)]);
  let failing = false;
  const handle = handleOn(fake);
  const board = { ...handle, readPriority: async (...args) => {
    if (failing) { failing = false; throw new Error('the priority read failed'); }
    return handle.readPriority(...args);
  } };
  const built = reportWorld(clock, { fake, board, triggers: HOUR_AWAY });
  const { handed, stop } = keptUp(built);
  try {
    await positive(() => settledIn(handed).length === 1);
    await fake.operations.moveItem('item-1', COLUMNS.ready);
    failing = true;
    await clock.advance(CLOCK_START + 1000);
    assert.equal(built.l3Events().filter(({ event }) => event === 'pull').length, 0, 'the failed poll claimed nothing');
    assert.equal(settledIn(handed).length, 2, 'the failure was handed over as the poll settled');
    assert.match(leavesOf(settledIn(handed)[1].reason).map(({ message }) => message).join('\n'), /the priority read failed/);
    await clock.advance(CLOCK_START + 2000);
    assert.ok(built.l3Events().some(({ event, card }) => event === 'pull' && card === 5), 'the next poll, on schedule, claimed card #5');
    await positive(() => built.dispatches.held() === 1);
    built.dispatches.releaseAll();
    await positive(() => settledIn(handed).length === 3);
    assert.equal(settledIn(handed)[2].status, 'fulfilled', 'the next drain does not hand the failure again');
  } finally {
    built.dispatches.releaseAll();
    await stop();
  }
});

test('L12: a poll whose trigger event the sink refuses claims nothing, hands the refusal over, and the next poll fires on schedule', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [], triggers: HOUR_AWAY });
  const { handed, stop } = keptUp(built);
  try {
    await positive(() => settledIn(handed).length === 1);
    built.refuseAppends('the poll trigger was refused', 1);
    await clock.advance(CLOCK_START + 1000);
    assert.equal(settledIn(handed).length, 2);
    assert.match(leavesOf(settledIn(handed)[1].reason).map(({ message }) => message).join('\n'), /refused to record the pull trigger/);
    const tried = () => built.attempts.filter(({ layer, event, fields }) => layer === 'L3' && event === 'trigger' && fields.trigger === 'pull').length;
    const before = tried();
    await clock.advance(CLOCK_START + 2000);
    assert.equal(tried(), before + 1, 'the next poll fired on schedule');
    assert.equal(settledIn(handed).length, 2, 'the accepted poll hands nothing over');
  } finally {
    await stop();
  }
});

test('L13: a hold whose closer could not be saved ends a clock-held run once its claims finish, naming the failure, and polls no more', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { triggers: HOUR_AWAY, answer: () => new Error('the dispatch could not start') });
  const admissionDirectory = join(built.directory, 'admission');
  fs.mkdirSync(admissionDirectory, { recursive: true });
  fs.chmodSync(admissionDirectory, 0o555);
  try {
    const { running, handed } = keptUp(built);
    const ended = settledOf(running);
    await positive(() => ended());
    await assert.rejects(running, (failure) => {
      assert.match(leavesOf(failure).map(({ message }) => message).join('\n'), /card #1 was held/);
      return true;
    });
    assert.deepEqual(handed, [], 'what settled since the previous drain came with the ending');
    assert.equal(clock.pending(), 0, 'the timer was cancelled');
    const pulls = count(built, 'pull');
    await clock.advance(CLOCK_START + 5000);
    assert.equal(count(built, 'pull'), pulls, 'no poll after the ending');
  } finally {
    fs.chmodSync(admissionDirectory, 0o755);
  }
});

test('each hand-over of a clock-held run is handed before the next poll fires', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [], triggers: HOUR_AWAY });
  const tried = () => built.attempts.filter(({ layer, event, fields }) => layer === 'L3' && event === 'trigger' && fields.trigger === 'pull').length;
  const order = [];
  const controller = new AbortController();
  const running = built.loop.run({ handOver: () => order.push(tried()), stop: controller.signal });
  try {
    await positive(() => order.length === 1);
    built.refuseAppends('the poll trigger was refused', 1);
    await clock.advance(CLOCK_START + 1000);
    await clock.advance(CLOCK_START + 2000);
    assert.equal(tried(), 3, 'the first pull and two polls');
    assert.deepEqual(order, [1, 2], 'each hand-over came after its own pull and before the next poll');
  } finally {
    controller.abort();
    await running;
  }
});

test('L7: through the run verb, a clock-held run fires a pull at its slot release', async () => {
  const clock = manualClock();
  const { agent, consumer, running, stop } = keptUpRunVerb({ items: [verbCard(10, 'Ready')], plan: { 10: { engineer: { hold: true } } }, clock });
  const pulls = () => (fs.existsSync(streamPath(`${consumer}/.rigger`)) ? readEventsAt(`${consumer}/.rigger`) : []).filter(({ event, trigger }) => event === 'trigger' && trigger === 'pull').length;
  try {
    await positive(() => agent.held(10));
    assert.equal(pulls(), 1);
    agent.release(10);
    await positive(() => pulls() === 2 && agent.held(10));
    assert.equal(clock.now(), CLOCK_START, 'the second pull was the slot release\'s, not a poll');
  } finally {
    const stopped = stop();
    if (agent.held(10)) agent.release(10);
    await stopped.catch(() => {});
    await running.catch(() => {});
  }
});

test('L14: at each drain the run verb writes what settled since the previous drain, and does not exit', async () => {
  const clock = manualClock();
  const { consumer, written, running, stop } = keptUpRunVerb({ clock });
  const ended = settledOf(running);
  seed(`${consumer}/.rigger`, 'owner-a1.json', closerText({ reason: 'owner paused claims' }));
  try {
    await positive(() => written.length === 1);
    assert.match(written[0], /^rigger run: admission is closed/m);
    assert.match(written[0], /owner paused claims/);
    await clock.advance(CLOCK_START + 1000);
    assert.equal(ended(), false, 'the verb did not exit at the drain');
  } finally {
    const answer = await stop();
    assert.deepEqual(answer, { text: '', code: 0 }, 'a stopped verb answers nothing it already wrote');
  }
});

test('L15: the run verb writes a report firing\'s hand-over as it settles, rendered as report renders it, and does not exit', async () => {
  const clock = manualClock();
  const triggers = { hourly: { interval: 1000, anchor: new Date(CLOCK_START).toISOString(), catchUp: 'skip', job: 'report' } };
  const { consumer, written, running, stop } = keptUpRunVerb({ clock, triggers });
  const ended = settledOf(running);
  try {
    await positive(() => written.length === 1);
    const path = streamPath(`${consumer}/.rigger`);
    await clock.advance(CLOCK_START + 1000);
    assert.equal(written.length, 2, 'the firing was written as it settled');
    // The report read the stream as it stood before the firing recorded its outcome.
    const lines = fs.readFileSync(path, 'utf8').trimEnd().split('\n');
    const outcome = lines.findIndex((line) => JSON.parse(line).event === 'trigger.outcome');
    const snapshot = temporaryDirectory('rigger-kept-up-report-snapshot-');
    fs.writeFileSync(streamPath(snapshot), `${lines.slice(0, outcome).join('\n')}\n`);
    assert.equal(written[1], reportText({ ...deriveReport(snapshot), path }));
    assert.equal(ended(), false, 'the verb did not exit at the firing');
  } finally {
    await stop();
  }
});

test('L16: one idle poll with admission open makes the forge calls the journal measures, for two board states', async (t) => {
  const states = [
    { name: 'one card in Done', a: 0, r: 0, cards: [cardIn(20, COLUMNS.done)], pullRequests: [] },
    { name: 'two cards in Owner, each holding one open pull request', a: 2, r: 2, cards: [cardIn(20, COLUMNS.owner), cardIn(21, COLUMNS.owner)],
      pullRequests: [20, 21].map((number) => ({ number: 1000 + number, head: `rigger-${number}`, sha: String(number).padStart(40, '0') })) },
  ];
  const counted = [];
  for (const { name, a, r, cards, pullRequests } of states) {
    const clock = manualClock();
    const fake = boardOf(cards);
    const calls = [];
    const handle = handleOn(fake);
    const board = Object.fromEntries(Object.entries(handle).map(([read, call]) => [read, (...args) => { calls.push(read); return call(...args); }]));
    const built = reportWorld(clock, { fake, board, triggers: HOUR_AWAY, forge: { pullRequests } });
    for (const [read, call] of Object.entries(built.repository.operations)) {
      built.repository.operations[read] = (...args) => { calls.push(read); return call(...args); };
    }
    const { stop } = keptUp(built);
    try {
      await positive(() => count(built, 'drain') === 1);
      const before = calls.length;
      const pulls = count(built, 'pull');
      const claims = built.l3Events().filter(({ event }) => event === 'pull').length;
      await clock.advance(CLOCK_START + 1000);
      assert.equal(count(built, 'pull'), pulls + 1, 'one idle poll');
      assert.equal(built.l3Events().filter(({ event }) => event === 'pull').length, claims, 'the poll claimed nothing');
      const poll = calls.slice(before);
      counted.push({ name, a, r, calls: poll.length, judged: 3 + a + 6 * r });
      t.diagnostic(`${name}: ${poll.length} forge calls (${poll.join(', ')}); judged 3 + a + 6r = ${3 + a + 6 * r}`);
    } finally {
      await stop();
    }
  }
  // Derived from "What a poll costs"'s premise list, not from the code: readColumns and readPriority
  // once each; readBranches once where any card is in Ready, Coding, Review or Owner; one pull
  // request read per such card; and six reads for each card holding one open pull request.
  assert.deepEqual(counted.map(({ calls }) => calls), [2, 2 + 1 + 2 + 2 * 6]);
});

// proves R-SCHED-28
test('L14: a drain that reads admission closed writes each card that settled beside the closers, and a stop answers their status', async () => {
  const clock = manualClock();
  const triggers = { hourly: { interval: 1000, anchor: new Date(CLOCK_START).toISOString(), catchUp: 'skip', job: 'report' } };
  const { agent, consumer, written, running, stop } = keptUpRunVerb({ items: [verbCard(10, 'Ready')], plan: { 10: { engineer: { hold: true, exit: 1 } } }, clock, triggers });
  try {
    await positive(() => agent.held(10));
    seed(`${consumer}/.rigger`, 'owner-a1.json', closerText({ reason: 'owner paused claims' }));
    agent.release(10);
    await positive(() => written.length === 1);
    assert.match(written[0], /^rigger run: claimed #10 from board \d+; its maker exited 1/m, 'the card that settled is written at the drain');
    assert.match(written[0], /^rigger run: admission is closed by owner: owner paused claims/m, 'beside the closer');
    await clock.advance(CLOCK_START + 1000);
    assert.ok(written.some((text) => text.startsWith('rigger report:')), 'a later report was written');
    const answer = await stop();
    assert.equal(answer.code, 1, 'the card that fell short of review decides the stopped status, whatever was written after it');
  } finally {
    const ending = stop();
    if (agent.held(10)) agent.release(10);
    await ending.catch(() => {});
    await running.catch(() => {});
  }
});

// proves R-SCHED-29
test('L12: a poll whose trigger event the sink refuses claims no Ready card, and the next poll claims it', async () => {
  const clock = manualClock();
  const built = reportWorld(clock, { cards: [cardIn(5, COLUMNS.done)], triggers: HOUR_AWAY });
  const { handed, stop } = keptUp(built);
  try {
    await positive(() => count(built, 'drain') === 1);
    await built.fake.operations.moveItem('item-1', COLUMNS.ready);
    built.refuseAppends('the poll trigger was refused', 1);
    await clock.advance(CLOCK_START + 1000);
    assert.deepEqual(built.l3Events().filter(({ event }) => event === 'pull').map(({ card }) => card), [], 'the refused poll claimed nothing');
    assert.equal(settledIn(handed).length, 2, 'the refusal was handed over as the poll settled');
    await clock.advance(CLOCK_START + 2000);
    assert.deepEqual(built.l3Events().filter(({ event }) => event === 'pull').map(({ card }) => card), [5], 'the next poll, on schedule, claimed it');
    await positive(() => built.dispatches.held() === 1);
  } finally {
    const ending = stop();
    if (built.l3Events().some(({ event }) => event === 'pull')) await positive(() => built.dispatches.held() === 1);
    built.dispatches.releaseAll();
    await ending.catch(() => {});
  }
});

test('L2: with no clock declared, a run that fails answers the merge base\'s failure fields', async () => {
  const clock = manualClock();
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: [readyCard(1)], refuseMoves: true });
  const built = world({ fake, concurrency: 1, clock });
  await assert.rejects(built.loop.run(), (failure) => {
    assert.equal(failure.message, '1 of the pulls this run fired failed');
    assert.deepEqual(Object.keys(failure).filter((key) => key !== 'errors').sort(), ['handoffs', 'reached', 'reports']);
    assert.deepEqual({ reports: failure.reports, handoffs: failure.handoffs }, { reports: [], handoffs: [] });
    return true;
  });
});

// proves R-SCHED-28
test('L14: at a drain the run verb writes each card that settled since the previous drain, and does not exit', BOUNDS[60_000], async () => {
  const clock = manualClock();
  const { written, running, stop } = keptUpRunVerb({ items: [verbCard(10, 'Ready')], plan: { 10: { engineer: { pr: true }, reviewer: { findings: true } } }, clock });
  const ended = settledOf(running);
  try {
    await positive(() => written.length === 1, BOUNDS[60_000].timeout / 2);
    const lines = written[0].split('\n');
    assert.match(lines[0], /^rigger run: claimed #10 from board \d+; its maker exited 0 and pull request #\d+ is open from rigger-10, so the card is in review/);
    assert.equal(lines[1], 'rigger run: card #10\'s judge `reviewer` exited 0');
    await clock.advance(CLOCK_START + 1000);
    assert.equal(ended(), false, 'the verb did not exit at the drain');
  } finally {
    const answer = await stop();
    assert.deepEqual(answer, { text: '', code: 0 }, 'every card delivered, and nothing was left to answer');
  }
});

/**
 * Each way a clock-held run's hand-over can end, as the verb writes it: one row each. `plan` is the
 * stand-in agent's, `held` the role whose dispatch is held while the owner's pause closer is
 * written (none where the row reads admission open), and `refuse` the one L3 event append the
 * event stream refuses, by a refusal of `node:fs`'s `appendFileSync`, the sink's own write, as
 * `test/run.test.mjs`'s `refusingJudgeStart` refuses one. Each row names the card line, the other
 * lines and the status the verb's whole hand-over must carry.
 */
const DELIVERED = { 10: { engineer: { pr: true }, reviewer: { findings: true } } };
const MAKER_FAILS = { 10: { engineer: { hold: true, exit: 1 } } };
const IN_REVIEW = /^rigger run: claimed #10 from board \d+; its maker exited 0 and pull request #\d+ is open from rigger-10, so the card is in review/m;
const MAKER_EXITED_1 = /^rigger run: claimed #10 from board \d+; its maker exited 1/m;
const CLOSER = /^rigger run: admission is closed by owner: owner paused claims/m;
const releaseOf10 = ({ layer, event, card }) => layer === 'L3' && event === 'slot.release' && card === 10;
const HAND_OVER_WAYS = [
  { way: 'success', plan: DELIVERED, card: IN_REVIEW, lines: [/^rigger run: card #10's judge `reviewer` exited 0$/m], code: 0 },
  { way: 'maker failure', plan: MAKER_FAILS, held: 'engineer', card: MAKER_EXITED_1, lines: [CLOSER], code: 1 },
  { way: 'judge failure', plan: { 10: { engineer: { pr: true }, reviewer: { hold: true, exit: 1 } } }, held: 'reviewer', card: IN_REVIEW,
    lines: [/^rigger run: card #10's judge `reviewer` exited 1$/m, CLOSER], code: 1 },
  { way: 'admission closed', plan: { 10: { engineer: { pr: true }, reviewer: { hold: true, findings: true } } }, held: 'reviewer', card: IN_REVIEW,
    lines: [CLOSER], code: 0 },
  { way: 'the sink refuses a release', plan: DELIVERED, refuse: releaseOf10, card: IN_REVIEW,
    lines: [/^rigger run: card #10's slot was released, and the event sink refused to record it: EIO: the test refuses this append/m], code: 1 },
  { way: 'the sink refuses a release, admission closed', plan: MAKER_FAILS, held: 'engineer', refuse: releaseOf10, card: MAKER_EXITED_1,
    lines: [/event sink refused to record it: EIO: the test refuses this append/m, CLOSER], code: 1 },
  { way: 'the sink refuses the release pull\'s trigger, admission closed', plan: MAKER_FAILS, held: 'engineer',
    refuse: (event, pulls) => event.layer === 'L3' && event.event === 'trigger' && event.trigger === 'pull' && pulls === 2, card: MAKER_EXITED_1,
    lines: [/refused to record the pull trigger: EIO: the test refuses this append/m, CLOSER], code: 1 },
  { way: 'the sink refuses a release, admission closed by a hold whose notice fails', plan: MAKER_FAILS, held: 'engineer',
    closer: ['hold-a1-issue-77.json', closerText({ reason: 'Rigger held claims' })], items: [verbCard(77, 'Owner', { labels: ['rigger:status'] })],
    failingRead: 'issue(number: 77)', refuse: releaseOf10, card: MAKER_EXITED_1, notices: 1, poll: true,
    lines: [/event sink refused to record it: EIO: the test refuses this append/m, /^rigger run: admission is closed by hold: Rigger held claims/m,
      /^rigger run: the notice for hold a1 failed to read issue #77's state: .*the test fails this forge read once/m], code: 1 },
];

const NOTICE = /^rigger run: the notice for hold /gm;
for (const { way, plan, held, refuse, card, lines, code, closer = ['owner-a1.json', closerText({ reason: 'owner paused claims' })], items = [], failingRead, notices = 0, poll = false } of HAND_OVER_WAYS) {
  test(`hand-over ways: ${way}: the verb writes each card that settled, each line beside it, and the status`, BOUNDS[60_000], async (t) => {
    const clock = manualClock();
    const append = fs.appendFileSync;
    let refused = 0;
    let pulls = 0;
    const { agent, consumer, written, running, stop } = keptUpRunVerb({ items: [verbCard(10, 'Ready'), ...items], plan, clock, failingRead });
    fs.appendFileSync = (path, data, ...rest) => {
      if (String(path) === streamPath(`${consumer}/.rigger`)) {
        const event = JSON.parse(String(data));
        if (event.layer === 'L3' && event.event === 'trigger' && event.trigger === 'pull') pulls += 1;
        if (refuse?.(event, pulls) && refused === 0) {
          refused += 1;
          throw Object.assign(new Error('EIO: the test refuses this append'), { code: 'EIO' });
        }
      }
      return append(path, data, ...rest);
    };
    syncBuiltinESMExports();
    try {
      if (held !== undefined) {
        await positive(() => agent.held(10, held), BOUNDS[60_000].timeout / 4);
        seed(`${consumer}/.rigger`, ...closer);
        agent.release(10, held);
      }
      await positive(() => written.length > 0, BOUNDS[60_000].timeout / 4);
      if (poll) {
        // An idle poll after the hand-over hands over only what it read: under a closed
        // admission, its closers (L10), and nothing the previous hand-over already carried.
        await clock.advance(CLOCK_START + 1000);
        assert.equal(written.length, 2, 'the idle poll under a closed admission named its closers');
        assert.match(written[1], /^rigger run: admission is closed by /m);
        assert.doesNotMatch(written[1], /claimed #10|no card was pullable|the notice for hold|refused/, 'the idle poll repeats nothing');
      }
      const answer = await stop();
      t.diagnostic(JSON.stringify({ written, answer }));
      assert.equal(refused, refuse === undefined ? 0 : 1, 'the refusal the row names applied, once');
      assert.equal(written.length, poll ? 2 : 1, 'one hand-over, written whole, and one more for the idle poll where the row has one');
      assert.equal([...written, answer.text].join('\n').match(NOTICE)?.length ?? 0, notices, 'each failed notice is named once');
      assert.match(written[0], card, 'the card that settled is written');
      assert.equal(written[0].match(/^rigger run: claimed #10 /gm).length, 1, 'the card is written once');
      assert.equal((written[0].match(/^rigger run: admission is closed/gm) ?? []).length, held === undefined ? 0 : 1, 'each closer is written once');
      for (const line of lines) assert.match(written[0], line);
      assert.equal(answer.code, code, 'the status counts every outcome the run handed over');
    } finally {
      fs.appendFileSync = append;
      syncBuiltinESMExports();
      const ending = stop();
      for (const role of ['engineer', 'reviewer']) if (agent.held(10, role)) agent.release(10, role);
      await ending.catch(() => {});
      await running.catch(() => {});
    }
  });
}

test('hand-over ways: a card L2 refuses is written at the drain, and an idle poll that refuses it again hands nothing more over', BOUNDS[60_000], async () => {
  const clock = manualClock();
  const { written, running, stop } = keptUpRunVerb({ items: [REFUSED_CARD], clock });
  try {
    await positive(() => written.length === 1, BOUNDS[60_000].timeout / 4);
    assert.match(written[0], /^rigger run: from board \d+, no card was pullable$/m);
    assert.equal(written[0].match(/#11\b/g)?.length, 1, 'the refusal is written once, at the drain');
    for (const at of [1000, 2000, 3000]) await clock.advance(CLOCK_START + at);
    assert.equal(written.length, 1, 'the idle polls hand nothing over');
    assert.deepEqual(await stop(), { text: '', code: 0 }, 'the stop repeats no refusal the drain already wrote');
  } finally {
    await stop();
    await running.catch(() => {});
  }
});
