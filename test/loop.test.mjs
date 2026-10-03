// ABOUTME: Tests L3's loop over the fake board with an injected dispatch: at most N cards in
// flight, a claim taken before any await, a claim held only until its slot is released, every
// read failure, refused claim move and dispatch outcome passed on, and a run that refills each
// freed slot and leaves each card in the column its outcome settles, by the config's column names;
// the events L3 records, the drain trigger's among them; and L3's single pull, which claims up to
// a limit capped at N and takes a redo without a move.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { boundaryReport, sourceTree } from './layer-boundaries.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { until } from './process-fixtures.mjs';
import {
  COLUMNS, DRIVEN_ROUNDS, KINDS, boardOf, cardIn, columnsOf, drive, handleOn, waitFor, readyCard, world,
} from './loop-world.mjs';
import { WAIT_TURNS, readingLater, settledOf } from './loop-world.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { itemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

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
    await waitFor(() => pulled() || built.dispatches.held() > 0);
    built.dispatches.releaseAll();
    await Promise.all(ticks);
    if (built.dispatches.started.length === before) return built;
  }
  throw new Error(`rounds were still starting dispatches after ${DRIVEN_ROUNDS} of them, having started ${built.dispatches.started}`);
}


test('given concurrency 2 and cards A, B and C, where A\'s dispatch returns before B\'s, C\'s dispatch starts before B\'s returns', async () => {
  const built = world({ cards: [1, 2, 3], concurrency: 2 });

  const run = built.loop.run();
  await waitFor(() => built.dispatches.held() === 2);
  assert.deepEqual(built.dispatches.holding(), [1, 2]);
  built.dispatches.release(1);
  await waitFor(() => built.dispatches.started.length === 3);

  assert.deepEqual(built.dispatches.started, [1, 2, 3]);
  assert.deepEqual(built.dispatches.holding(), [2, 3], "B's dispatch has not returned");
  built.dispatches.releaseAll();
  await run;
});

test('given a board whose column read answers one turn later than the fake\'s, concurrency 2 and cards A, B and C, where A\'s dispatch returns before B\'s, C\'s dispatch starts before B\'s returns', async () => {
  const fake = boardOf([1, 2, 3]);
  const built = world({ fake, board: readingLater(fake), concurrency: 2 });

  const run = built.loop.run();
  await waitFor(() => built.dispatches.held() === 2);
  assert.deepEqual(built.dispatches.holding(), [1, 2]);
  built.dispatches.release(1);
  await waitFor(() => built.dispatches.started.length === 3);

  assert.deepEqual(built.dispatches.started, [1, 2, 3]);
  assert.deepEqual(built.dispatches.holding(), [2, 3], "B's dispatch has not returned");
  built.dispatches.releaseAll();
  await run;
});

test('given a board whose column read answers one turn later than the fake\'s, a run driven to its end over cards 1 to 4 at concurrency 2 makes the dispatches and the board moves the same run over the fake makes, in the same order', async () => {
  const answer = (card) => (card.number === 2 ? new Error('the dispatch could not start') : { exit: 0, output: '' });
  const ran = async (later) => {
    const fake = boardOf([1, 2, 3, 4]);
    const built = world({ fake, board: later ? readingLater(fake) : handleOn(fake), concurrency: 2, answer });
    await drive(built);
    return { started: built.dispatches.started, writes: fake.writes() };
  };

  const later = await ran(true);

  assert.deepEqual(later, await ran(false));
  assert.deepEqual(later.started, [1, 2, 3, 4]);
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

test('a card whose dispatch returns ends the run in the review column', async () => {
  const built = world({ cards: [1], concurrency: 1 });

  await drive(built);

  assert.deepEqual(built.dispatches.started, [1]);
  assert.deepEqual(await columnsOf(built.fake), { 1: COLUMNS.review });
});

/** The two ways a dispatch fails: it ran and exited non-zero, or it threw before it ran. */
const FAILURES = {
  'exits non-zero': () => ({ exit: 1, output: '' }),
  throws: () => new Error('the dispatch could not start'),
};

for (const [how, failed] of Object.entries(FAILURES)) {
  test(`a card whose dispatch ${how} frees its slot, and the next pullable card is dispatched`, async () => {
    const built = world({ cards: [1, 2], concurrency: 1, answer: (card) => (card.number === 1 ? failed() : { exit: 0, output: '' }) });

    const run = built.loop.run();
    await waitFor(() => built.dispatches.held() === 1);
    assert.deepEqual(built.dispatches.holding(), [1]);
    built.dispatches.release(1);
    await waitFor(() => built.dispatches.started.length === 2);

    assert.deepEqual(built.dispatches.holding(), [2], "card 1's slot is free, and card 2 holds it");
    built.dispatches.releaseAll();
    await run;
  });

  test(`a card whose dispatch ${how} ends the run outside the review column`, async () => {
    const built = world({ cards: [1], concurrency: 1, answer: failed });

    await drive(built);

    assert.deepEqual(built.dispatches.started, [1]);
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
    await drive(built);
    const keyOf = Object.fromEntries(Object.entries(columns).map(([key, name]) => [name, key]));
    const moves = built.fake.writes().map(({ operation, args: [id, column] }) => [operation, id, keyOf[column]]);
    return { started: built.dispatches.started, moves };
  };

  const named = await ran(COLUMNS);
  const other = await ran(renamed);

  assert.deepEqual(named.moves, [
    ['moveItem', 'item-1', 'coding'], ['moveItem', 'item-2', 'coding'], ['moveItem', 'item-1', 'review'],
    ['moveItem', 'item-4', 'coding'], ['moveItem', 'item-4', 'review'],
  ]);
  assert.deepEqual(other, named);
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
      await waitFor(() => stopped || looks > begun);
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
  await waitFor(() => {
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
  await waitFor(() => releases.length === 2);
  assert.equal(releases.length, 2, 'both reads are held at once');
  releases.forEach((release) => release());
  await waitFor(() => answered.length === 2 && built.dispatches.held() > 0);
  built.dispatches.releaseAll();
  await Promise.all(ticks);

  assert.deepEqual(answered, [[[7, 'Ready']], [[7, 'Ready']]]);
  assert.deepEqual(built.dispatches.started, [7]);
});

test('after a card\'s slot is released with freshness "not fresh", the next tick pulls that card again', async () => {
  const built = world({ cards: [5], concurrency: 1, fresh: false });

  const first = built.loop.pull();
  await waitFor(() => built.dispatches.held() > 0);
  built.dispatches.releaseAll();
  await first;
  assert.deepEqual(built.dispatches.started, [5]);

  const second = built.loop.pull();
  await waitFor(() => built.dispatches.held() > 0);
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
  await waitFor(() => refusedPull() || built.dispatches.held() > 0);
  assert.deepEqual(built.dispatches.started, []);
  assert.deepEqual(fake.writes(), []);
  built.dispatches.releaseAll();
  await first;

  // Concurrency is 1, so the card is pulled and dispatched on the next tick only if its slot was freed.
  const next = built.loop.pull();
  await waitFor(() => built.dispatches.held() > 0);
  assert.deepEqual(built.dispatches.started, [8]);
  built.dispatches.releaseAll();
  await next;
});

test('when the board read fails, L3 hands no card to the dispatch and passes the read\'s error on unchanged', async () => {
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
    assert.equal(error, thrown);
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
  await waitFor(() => built.dispatches.held() === 2);
  built.dispatches.releaseAll();
  await tick;

  assert.deepEqual(received.sort(), [[10, 'fulfilled'], [11, 'rejected']]);
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
  await waitFor(() => built.dispatches.started.length > 0);
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
  await waitFor(() => built.dispatches.held() === 2);
  built.dispatches.release(1);
  await waitFor(() => built.dispatches.started.length === 3);
  built.dispatches.releaseAll();
  await waitFor(() => ran() || built.dispatches.held() > 0);
  built.dispatches.releaseAll();
  await run;

  // The first read finds 1, 2 and 3 pullable and two slots free: pulling 1 leaves 2 and 3
  // waiting with 1 in flight, and pulling 2 leaves 3 waiting with 1 and 2 in flight. Card 1's
  // release fires a read that finds only 3, which leaves nothing waiting, with 2 and 3 in flight.
  const pulls = built.l3Events().filter((event) => event.event === 'pull')
    .map(({ card, kind, queueDepth, inFlight }) => ({ card, kind, queueDepth, inFlight }));
  assert.deepEqual(pulls, [
    { card: 1, kind: 'change', queueDepth: 2, inFlight: 1 },
    { card: 2, kind: 'change', queueDepth: 1, inFlight: 2 },
    { card: 3, kind: 'change', queueDepth: 0, inFlight: 2 },
  ]);
});

test('given a board whose column read answers one turn later than the fake\'s, every pull writes one event naming the card, its kind, the queue depth and the number in flight', async () => {
  const fake = boardOf([1, 2, 3]);
  const built = world({ fake, board: readingLater(fake), concurrency: 2 });

  const run = built.loop.run();
  const ran = settledOf(run);
  await waitFor(() => built.dispatches.held() === 2);
  built.dispatches.release(1);
  await waitFor(() => built.dispatches.started.length === 3);
  built.dispatches.releaseAll();
  await waitFor(() => ran() || built.dispatches.held() > 0);
  built.dispatches.releaseAll();
  await run;

  const pulls = built.l3Events().filter((event) => event.event === 'pull').map(({ card, queueDepth, inFlight }) => ({ card, queueDepth, inFlight }));
  assert.deepEqual(pulls, [{ card: 1, queueDepth: 2, inFlight: 1 }, { card: 2, queueDepth: 1, inFlight: 2 }, { card: 3, queueDepth: 0, inFlight: 2 }]);
});

/** The cards named by `built`'s L3 events named `name`, in the order recorded. */
const cardsOf = (built, name) => built.l3Events().filter((event) => event.event === name).map(({ card }) => card);

test('every slot release writes one event naming the card, whether its dispatch returned or threw', async () => {
  const built = world({ cards: [1, 2, 3], concurrency: 2, answer: (card) => (card.number === 2 ? new Error('the dispatch could not start') : { exit: 0, output: '' }) });

  await drive(built);

  assert.deepEqual([...cardsOf(built, 'slot.release')].sort(), [1, 2, 3]);
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
  // Each firing reads the board once. At concurrency 1 over two cards, a run fires at its start,
  // on card 1's release and on card 2's release: three firings, and a single pull() is one more.
  const fake = boardOf([1, 2]);
  let reads = 0;
  const board = handleOn(fake, { beforeRead: () => { reads += 1; } });
  const built = world({ fake, board, concurrency: 1 });

  await drive(built);
  const tick = built.loop.pull();
  const pulled = settledOf(tick);
  await waitFor(() => pulled() || built.dispatches.held() > 0);
  built.dispatches.releaseAll();
  await tick;

  assert.equal(reads, 4);
  assert.equal(triggersOf(built).filter((trigger) => trigger === 'pull').length, 4);
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
  await waitFor(() => built.dispatches.held() === 2);
  built.dispatches.release(1);
  await waitFor(() => built.fake.requests().filter(({ operation }) => operation === 'readPriority').length === 2);
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
  await waitFor(() => pulled() || built.dispatches.held() > 0);
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

test('every event L3 writes carries layer L3, and none carries another layer', async () => {
  const built = world({ cards: [1, 2, { ...readyCard(3), labels: [] }], concurrency: 1, answer: (card) => (card.number === 2 ? new Error('the dispatch could not start') : { exit: 0, output: '' }) });

  await drive(built);

  assert.ok(built.layers.length > 0, 'L3 wrote events');
  assert.deepEqual([...new Set(built.layers)], ['L3']);
  assert.ok(built.events().some((event) => event.layer === 'L2'), "L2's transitions share the stream");
});

test('from the recorded events of a concurrency 3 run over four cards, the most pull-to-release intervals overlapping at any moment is exactly 3', async () => {
  const built = world({ concurrency: 3 });

  await drive(built);

  // Each card's interval runs from its pull event's time to its release event's time, and the
  // sink's clock ticks once per event, so no two events share a time.
  const at = (name) => Object.fromEntries(built.l3Events().filter((event) => event.event === name).map(({ card, ts }) => [card, Date.parse(ts)]));
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
 * rejects once the test has ended. A judgment, whose premise is that every wait here is on
 * promises alone, with no timer and no I/O, so a condition that has not held in this long never will.
 */
const { 10_000: SETTLES_WITHIN } = BOUNDS;

/** Settles once `built`'s maker stand-in holds at least `cards` cards, as `until` waits. */
const makersHold = (built, cards, t) => until(() => built.dispatches.held() >= cards, t);

test('a wait on a condition that never holds fails after the number of turns the harness names, and its failure names the condition', SETTLES_WITHIN, async () => {
  let looked = 0;
  const neverHolds = () => {
    looked += 1;
    return 'the board' === 'empty';
  };

  await assert.rejects(waitFor(neverHolds), (failure) => {
    assert.match(failure.message, /'the board' === 'empty'/);
    assert.match(failure.message, new RegExp(`\\b${WAIT_TURNS} turns\\b`));
    return true;
  });
  assert.equal(looked, WAIT_TURNS + 1);
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
  const built = world({ cards, concurrency });
  let settled = false;
  const pulled = built.loop.pull(limit).finally(() => {
    settled = true;
  });
  await until(() => settled || (built.dispatches.held() > 0 && built.dispatches.held() === cardsOf(built, 'pull').length), t);
  const claimed = numbersOf(built.handed.map(({ card }) => card));
  const columns = await columnsOf(built.fake);
  const release = async () => {
    built.dispatches.releaseAll();
    await pulled;
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

test('given concurrency 3, no ready card, and one dispatchable card each in coding and in review, the board records no move of either after `loop`\'s single pull', SETTLES_WITHIN, async (t) => {
  const { claimed, columns, built, release } = await claimOnce({ cards: REDOS_ONLY, concurrency: 3 }, t);

  assert.equal(claimed.length, 2);
  assert.deepEqual(built.fake.writes(), []);
  assert.deepEqual(columns, { 5: COLUMNS.coding, 6: COLUMNS.review });
  await release();
});

test('given concurrency 3, no ready card, and one dispatchable card each in coding and in review, the event stream holds no L2 transition event for either after `loop`\'s single pull', SETTLES_WITHIN, async (t) => {
  const { claimed, built, release } = await claimOnce({ cards: REDOS_ONLY, concurrency: 3 }, t);

  assert.equal(claimed.length, 2);
  assert.deepEqual(built.events().filter((event) => event.layer === 'L2'), []);
  await release();
});

test('after `loop`\'s single pull returns, the state directory holds nothing but the event stream', SETTLES_WITHIN, async (t) => {
  for (const limit of LIMITS) {
    const { claimed, built, release } = await claimOnce({ concurrency: 3, limit }, t);
    await release();

    assert.ok(claimed.length > 0, String(limit));
    assert.deepEqual(readdirSync(built.directory, { recursive: true }), ['events.jsonl'], String(limit));
  }
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
test('given a sink that refuses every append, the loop with an injected dispatch never calls that dispatch, from a run or from a pull', async () => {
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
    await waitFor(() => halted() || built.dispatches.held() > 0);
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
    received.push([card.number, outcome.status, outcome.value]);
    return settled(card, outcome);
  };
  const run = built.loop.run();
  await waitFor(() => built.dispatches.held() === 1);
  assert.deepEqual(built.dispatches.holding(), [1], "card 1's dispatch is running");
  built.refuseAppends(DISK_FULL);

  built.dispatches.releaseAll();
  await run.catch(() => {});

  assert.deepEqual(received, [[1, 'fulfilled', { exit: 0, output: '' }]]);
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
  const pulled = new Set(['L3 trigger', 'L3 pull', 'L2 transition', 'L3 slot.release']);
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

  assert.deepEqual(readdirSync(built.directory, { recursive: true }), ['events.jsonl']);
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
  assert.throws(() => loop({ ...withoutKill(), dispatch: async () => ({ exit: 0 }), workspace: async () => ({ path: '/nowhere' }) }), /\bkill\b/);
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
  await waitFor(() => held.calls === 1);
  assert.equal(held.calls, 1, 'the kill was called');
  assert.deepEqual(built.l3Events(), []);
  held.release();
  await waitFor(() => built.l3Events().length > 0);
  assert.equal(built.l3Events()[0]?.event, 'run.start', JSON.stringify(built.l3Events()));
  built.dispatches.releaseAll();
  await waitFor(() => ran() || built.dispatches.held() > 0);
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
  await waitFor(() => held.calls === 1);
  assert.equal(counted.reads, 0);
  held.release();
  await waitFor(() => counted.reads > 0);
  assert.ok(counted.reads > 0, 'the run read the board once the kill settled');
  built.dispatches.releaseAll();
  await waitFor(() => ran() || built.dispatches.held() > 0);
  built.dispatches.releaseAll();
  await running;
});

test('given a loop handle whose injected kill rejects, a pull reads nothing, records no L3 event, and rejects with the kill\'s failure', async () => {
  // An empty board, so a pull that went on past the kill settles rather than holding a dispatch.
  const fake = boardOf([]);
  const counted = countingHandle(fake);
  const refusal = new Error('the sink refused 1 kill(s) of recorded groups');
  const built = world({ fake, board: counted.handle, kill: async () => { throw refusal; } });

  await assert.rejects(built.loop.pull(), (failure) => failure === refusal);

  assert.equal(counted.reads, 0);
  assert.deepEqual(built.l3Events(), []);
});
