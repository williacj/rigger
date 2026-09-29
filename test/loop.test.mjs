// ABOUTME: Tests L3's loop over the fake board with an injected dispatch: at most N cards in
// flight, a claim taken before any await, a claim held only until its slot is released, every
// read failure, refused claim move and dispatch outcome passed on, and a run that refills each
// freed slot and leaves each card in the column its outcome settles, by the config's column names;
// the events L3 records, the drain trigger's among them; and L3's claim-only call, handed no
// dispatch, which claims up to a limit capped at N, redos without a move, and fires no drain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { boundaryReport, sourceTree } from './layer-boundaries.mjs';
import { installFakeGh } from './fake-gh.mjs';
import {
  COLUMNS, DRIVEN_ROUNDS, KINDS, boardOf, cardIn, columnsOf, drive, handleOn, quiesce, readyCard, world,
} from './loop-world.mjs';
import { claimOnly, loop } from '../src/scheduling/loop.mjs';
import { itemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';

/**
 * Fires two pull triggers at a time, lets every start they make happen, then releases every held
 * dispatch, until a round starts nothing. Returns what `world` built. Rounds still starting
 * dispatches after `DRIVEN_ROUNDS` of them fail the test, naming those dispatches.
 */
async function runToEnd(built) {
  for (let round = 0; round < DRIVEN_ROUNDS; round += 1) {
    const before = built.dispatches.started.length;
    const ticks = [built.loop.pull(), built.loop.pull()];
    await quiesce();
    built.dispatches.releaseAll();
    await Promise.all(ticks);
    if (built.dispatches.started.length === before) return built;
  }
  throw new Error(`rounds were still starting dispatches after ${DRIVEN_ROUNDS} of them, having started ${built.dispatches.started}`);
}


test('given concurrency 2 and cards A, B and C, where A\'s dispatch returns before B\'s, C\'s dispatch starts before B\'s returns', async () => {
  const built = world({ cards: [1, 2, 3], concurrency: 2 });

  const run = built.loop.run();
  await quiesce();
  assert.deepEqual(built.dispatches.holding(), [1, 2]);
  built.dispatches.release(1);
  await quiesce();

  assert.deepEqual(built.dispatches.started, [1, 2, 3]);
  assert.deepEqual(built.dispatches.holding(), [2, 3], "B's dispatch has not returned");
  built.dispatches.releaseAll();
  await run;
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
    await quiesce();
    assert.deepEqual(built.dispatches.holding(), [1]);
    built.dispatches.release(1);
    await quiesce();

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
  const board = {
    readColumns: async () => {
      await quiesce();
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
  for (let turn = 0; turn < TURNS && !settled; turn += 1) await quiesce();
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
  await quiesce();
  assert.equal(releases.length, 2, 'both reads are held at once');
  releases.forEach((release) => release());
  await quiesce();
  built.dispatches.releaseAll();
  await Promise.all(ticks);

  assert.deepEqual(answered, [[[7, 'Ready']], [[7, 'Ready']]]);
  assert.deepEqual(built.dispatches.started, [7]);
});

test('after a card\'s slot is released with freshness "not fresh", the next tick pulls that card again', async () => {
  const built = world({ cards: [5], concurrency: 1, fresh: false });

  const first = built.loop.pull();
  await quiesce();
  built.dispatches.releaseAll();
  await first;
  assert.deepEqual(built.dispatches.started, [5]);

  const second = built.loop.pull();
  await quiesce();
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
  await quiesce();
  assert.deepEqual(built.dispatches.started, []);
  assert.deepEqual(fake.writes(), []);
  built.dispatches.releaseAll();
  await first;

  // Concurrency is 1, so the card is pulled and dispatched on the next tick only if its slot was freed.
  const next = built.loop.pull();
  await quiesce();
  assert.deepEqual(built.dispatches.started, [8]);
  built.dispatches.releaseAll();
  await next;
});

test('when the board read fails, L3 hands no card to the dispatch and passes the read\'s error on unchanged', async () => {
  // #215's missing-column error: the read side's column read, through the fake gh, of a board whose
  // Status field lacks the declared `Owner`.
  const gh = installFakeGh(mkdtempSync(join(tmpdir(), 'rigger-loop-gh-')), {
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
  await quiesce();
  built.dispatches.releaseAll();
  await tick;

  assert.deepEqual(received.sort(), [[10, 'fulfilled'], [11, 'rejected']]);
});

test("the forge adapter's read side, passed whole, is L3's board handle: the declared priority orders the pulls, and the claim move reaches the board", async () => {
  // Card 21 holds Low and card 22 holds High, and the board lists its options Low, High, Normal,
  // so at concurrency 1 the first card dispatched shows which order L3 was handed.
  const gh = installFakeGh(mkdtempSync(join(tmpdir(), 'rigger-loop-gh-')), {
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
  await quiesce();
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
  await quiesce();
  built.dispatches.release(1);
  await quiesce();
  built.dispatches.releaseAll();
  await quiesce();
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
  await quiesce();
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
  await quiesce();
  built.dispatches.release(1);
  await quiesce();
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
  await quiesce();
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

// L3's claim-only call: claims up to a limit capped at N, and hands no card to any dispatch.

/** The numbers of `cards`, the board items a claim-only call answered, in the order answered. */
const numbersOf = (cards) => cards.map((card) => card.number);

test('the claim-only call, handed no dispatch, answers the cards it claimed', async () => {
  const built = world({ concurrency: 3 });

  const claimed = await built.claims.claim();

  assert.deepEqual(numbersOf(claimed), [1, 2, 3]);
  assert.deepEqual(claimed.map((card) => card.id), ['item-1', 'item-2', 'item-3']);
  assert.deepEqual(built.dispatches.started, []);
});

/**
 * One claim-only call over `cards` under `concurrency`, with claim limit `limit` where it is not
 * undefined. Answers the numbers of the cards it claimed, and each card's column after it.
 */
async function claimOnce({ cards = [1, 2, 3, 4], concurrency, limit } = {}) {
  const built = world({ cards, concurrency });
  const claimed = numbersOf(await built.claims.claim(limit));
  return { claimed, columns: await columnsOf(built.fake), built };
}

test('given concurrency 3, four pullable cards and a claim limit of 1, the claim-only call claims exactly one card', async () => {
  const { claimed, columns } = await claimOnce({ concurrency: 3, limit: 1 });

  assert.deepEqual(claimed, [1]);
  assert.deepEqual(columns, { 1: 'Coding', 2: 'Ready', 3: 'Ready', 4: 'Ready' });
});

test('given concurrency 1, four pullable cards and a claim limit of 3, the claim-only call claims exactly one card', async () => {
  const { claimed, columns } = await claimOnce({ concurrency: 1, limit: 3 });

  assert.deepEqual(claimed, [1]);
  assert.deepEqual(columns, { 1: 'Coding', 2: 'Ready', 3: 'Ready', 4: 'Ready' });
});

test('given concurrency 3, four pullable cards and no claim limit, the claim-only call claims exactly three cards', async () => {
  const { claimed, columns } = await claimOnce({ concurrency: 3 });

  assert.deepEqual(claimed, [1, 2, 3]);
  assert.deepEqual(columns, { 1: 'Coding', 2: 'Coding', 3: 'Coding', 4: 'Ready' });
});

test('given concurrency 1, four pullable cards and no claim limit, the claim-only call claims exactly one card', async () => {
  const { claimed, columns } = await claimOnce({ concurrency: 1 });

  assert.deepEqual(claimed, [1]);
  assert.deepEqual(columns, { 1: 'Coding', 2: 'Ready', 3: 'Ready', 4: 'Ready' });
});

test('given concurrency 3, two pullable cards and no claim limit, the claim-only call claims both', async () => {
  const { claimed, columns } = await claimOnce({ cards: [1, 2], concurrency: 3 });

  assert.deepEqual(claimed, [1, 2]);
  assert.deepEqual(columns, { 1: 'Coding', 2: 'Coding' });
});

test('given no pullable card, the claim-only call claims nothing and answers an empty list', async () => {
  const { claimed, built } = await claimOnce({ cards: [{ ...readyCard(1), labels: [] }], concurrency: 3 });

  assert.deepEqual(claimed, []);
  assert.deepEqual(built.fake.writes(), []);
});

test('a claim limit that is not a positive whole number is refused naming the claim limit, and nothing is claimed', async () => {
  for (const limit of [0, -1, 1.5, '1', Number.NaN, null]) {
    const built = world({ concurrency: 3 });

    await assert.rejects(built.claims.claim(limit), (refusal) => {
      assert.match(refusal.message, /claim limit/);
      assert.ok(refusal.message.includes(typeof limit === 'string' ? `'${limit}'` : String(limit)), refusal.message);
      return true;
    }, String(limit));
    assert.deepEqual(built.fake.writes(), [], String(limit));
    assert.deepEqual(built.fake.requests(), [], String(limit));
  }
});

/**
 * Two claim-only calls on one handle, each with claim limit `limit`, over one pullable card, while
 * the fake board holds both calls' reads unresolved. Answers what each read returned, what the
 * two calls claimed together, and the board's writes.
 */
async function twoClaims(limit) {
  const fake = boardOf([7]);
  const releases = [];
  const answered = [];
  const board = handleOn(fake, {
    beforeRead: () => releases.push(fake.holdNextRead()),
    onRead: (items) => answered.push(items.map((item) => [item.number, item.column])),
  });
  const built = world({ fake, concurrency: 2, board });

  const calls = [built.claims.claim(limit), built.claims.claim(limit)];
  await quiesce();
  assert.equal(releases.length, 2, 'both reads are held at once');
  releases.forEach((release) => release());
  const claimed = (await Promise.all(calls)).flatMap(numbersOf);
  return { answered, claimed, writes: fake.writes() };
}

test('given one pullable card, two concurrent claim-only calls with no claim limit claim it exactly once, though both reads returned it as Ready', async () => {
  const { answered, claimed, writes } = await twoClaims(undefined);

  assert.deepEqual(answered, [[[7, 'Ready']], [[7, 'Ready']]]);
  assert.deepEqual(claimed, [7]);
  assert.deepEqual(writes.map(({ operation, args: [, column] }) => [operation, column]), [['moveItem', COLUMNS.coding]]);
});

test('given one pullable card, two concurrent claim-only calls each with a claim limit of 1 claim it exactly once, though both reads returned it as Ready', async () => {
  const { answered, claimed, writes } = await twoClaims(1);

  assert.deepEqual(answered, [[[7, 'Ready']], [[7, 'Ready']]]);
  assert.deepEqual(claimed, [7]);
  assert.deepEqual(writes.map(({ operation, args: [, column] }) => [operation, column]), [['moveItem', COLUMNS.coding]]);
});

/** Each claim limit the event items are shown under: 1, and none. */
const LIMITS = [1, undefined];

test('each card the claim-only call claims from the ready column, with a claim limit of 1 and with none, has one L2 transition event from ready into coding', async () => {
  for (const limit of LIMITS) {
    const { claimed, built } = await claimOnce({ concurrency: 3, limit });
    const transitions = built.events().filter((event) => event.layer === 'L2' && event.event === 'transition');

    assert.deepEqual(transitions.map(({ card, from, to }) => [card, from, to]), claimed.map((number) => [number, 'ready', 'coding']), String(limit));
    assert.equal(claimed.length, limit ?? 3, String(limit));
  }
});

/** A board holding a redo in the coding column, card 5, ahead of three ready cards. */
const REDO_AND_READY = [cardIn(5, COLUMNS.coding), 1, 2, 3];

test('each card the claim-only call claims, from the ready column or as a redo, with a claim limit of 1 and with none, has one L3 pull event', async () => {
  const claims = [];
  for (const limit of LIMITS) {
    const { claimed, built } = await claimOnce({ cards: REDO_AND_READY, concurrency: 3, limit });

    assert.deepEqual(cardsOf(built, 'pull'), claimed, String(limit));
    claims.push(claimed);
  }
  assert.deepEqual(claims, [[5], [5, 1, 2]]);
});

/** No card in the ready column, and one unclaimed card L2 would dispatch in each of coding and review. */
const REDOS_ONLY = [cardIn(5, COLUMNS.coding), cardIn(6, COLUMNS.review)];

test('given concurrency 3, no ready card, and one dispatchable card each in coding and in review, the claim-only call with no claim limit returns both as claimed', async () => {
  const { claimed } = await claimOnce({ cards: REDOS_ONLY, concurrency: 3 });

  assert.deepEqual([...claimed].sort(), [5, 6]);
});

test('given concurrency 3, no ready card, and one dispatchable card each in coding and in review, the board records no move of either after the claim-only call', async () => {
  const { claimed, columns, built } = await claimOnce({ cards: REDOS_ONLY, concurrency: 3 });

  assert.equal(claimed.length, 2);
  assert.deepEqual(built.fake.writes(), []);
  assert.deepEqual(columns, { 5: COLUMNS.coding, 6: COLUMNS.review });
});

test('given concurrency 3, no ready card, and one dispatchable card each in coding and in review, the event stream holds no L2 transition event for either after the claim-only call', async () => {
  const { claimed, built } = await claimOnce({ cards: REDOS_ONLY, concurrency: 3 });

  assert.equal(claimed.length, 2);
  assert.deepEqual(built.events().filter((event) => event.layer === 'L2'), []);
});

test('after the claim-only call returns, the state directory holds nothing but the event stream', async () => {
  for (const limit of LIMITS) {
    const { claimed, built } = await claimOnce({ concurrency: 3, limit });

    assert.ok(claimed.length > 0, String(limit));
    assert.deepEqual(readdirSync(built.directory, { recursive: true }), ['events.jsonl'], String(limit));
  }
});

test('given four pullable cards, the claim-only call returns without awaiting any dispatch, and no drain event exists when it returns', async () => {
  const built = world({ concurrency: 3 });

  const claimed = await built.claims.claim();

  assert.deepEqual(numbersOf(claimed), [1, 2, 3]);
  assert.deepEqual(built.dispatches.started, []);
  assert.deepEqual(drainsOf(built), []);
});

test('given a board with nothing to pull, the claim-only call writes no drain event', async () => {
  const built = world({ cards: [{ ...readyCard(1), labels: [] }], concurrency: 3 });

  assert.deepEqual(await built.claims.claim(), []);

  assert.deepEqual(triggersOf(built), ['pull']);
  assert.deepEqual(drainsOf(built), []);
});

test('the claim-only calls on a board whose five columns carry other display names, with a config naming them, claim the same cards and make the same moves by column key', async () => {
  const renamed = { ready: 'To do', coding: 'In progress', review: 'In review', owner: 'Blocked', done: 'Shipped' };
  const claimedOn = async (columns) => {
    const outcomes = [];
    for (const limit of LIMITS) {
      const built = world({ cards: [1, { ...readyCard(2, columns), labels: [] }, 3, 4], columns, concurrency: 2 });
      const claimed = numbersOf(await built.claims.claim(limit));
      const keyOf = Object.fromEntries(Object.entries(columns).map(([key, name]) => [name, key]));
      outcomes.push({ claimed, moves: built.fake.writes().map(({ operation, args: [id, column] }) => [operation, id, keyOf[column]]) });
    }
    return outcomes;
  };

  const named = await claimedOn(COLUMNS);
  const other = await claimedOn(renamed);

  assert.deepEqual(named, [
    { claimed: [1], moves: [['moveItem', 'item-1', 'coding']] },
    { claimed: [1, 3], moves: [['moveItem', 'item-1', 'coding'], ['moveItem', 'item-3', 'coding']] },
  ]);
  assert.deepEqual(other, named);
});

test("each card's pull event from the claim-only call is recorded before L2 asks the board to move that card to the coding column", async () => {
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

  await built.claims.claim();

  assert.deepEqual(pulledAtMove, [['item-1', [1]], ['item-2', [1, 2]]]);
  assert.deepEqual(triggersOf(built), ['pull']);
});

test('when the board refuses a card\'s claim move, the claim-only call reports it, answers no card, and frees its slot for the next call', async () => {
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

  await assert.rejects(built.claims.claim(), (failure) => {
    assert.match(failure.errors[0].message, /card #8's move from ready to coding .* was refused: the board refused the move/);
    return true;
  });
  assert.deepEqual(cardsOf(built, 'slot.release'), [8]);

  // Concurrency is 1, so the next call claims the card only if the refused claim freed its slot.
  assert.deepEqual(numbersOf(await built.claims.claim()), [8]);
  assert.deepEqual(await columnsOf(fake), { 8: 'Coding' });
});

test('calls on one claim-only handle never together hold more claims than N, and never claim a card twice', async () => {
  const built = world({ concurrency: 3 });

  const first = numbersOf(await built.claims.claim(2));
  const second = numbersOf(await built.claims.claim());
  const third = numbersOf(await built.claims.claim());

  assert.deepEqual([first, second, third], [[1, 2], [3], []]);
});

test('rule 8 lets a module under src/cli/ import and call the claim-only call from the loop\'s own module', () => {
  const tree = sourceTree();
  tree.set('src/cli/claim-verb.mjs', "import { claimOnly } from '../scheduling/loop.mjs';\nexport const once = (deps) => claimOnly(deps).claim(1);");

  assert.deepEqual(boundaryReport(tree).violations.map((violation) => violation.message), []);

  tree.set('src/cli/claim-verb.mjs', "import { loop } from '../scheduling/loop.mjs';\nexport const once = (deps) => loop(deps).pull();");
  assert.ok(boundaryReport(tree).violations.some((violation) => violation.message.includes('rule 8')), 'importing the dispatching entry point still breaks rule 8');
});

// The halt: L3 records each start before it acts outside Rigger on it, and starts nothing whose
// event the sink refuses (`ARCHITECTURE.md`, "Failure model").

test('in one sequence of the sink\'s appends and the fake board\'s writes, each card the claim-only call claims has its L3 pull event before L2\'s move of it into the coding column', async () => {
  const built = world({ cards: [1, 2], concurrency: 2 });

  const claimed = numbersOf(await built.claims.claim());

  assert.deepEqual(claimed, [1, 2]);
  for (const number of claimed) {
    const pulled = built.sequence.findIndex((entry) => entry.append === 'pull' && entry.layer === 'L3' && entry.card === number);
    const moved = built.sequence.findIndex((entry) => entry.move === `item-${number}` && entry.column === COLUMNS.coding);
    assert.ok(pulled !== -1 && moved !== -1, `card ${number} was pulled and moved: ${JSON.stringify(built.sequence)}`);
    assert.ok(pulled < moved, `card ${number}'s pull event came before its move: ${JSON.stringify(built.sequence)}`);
  }
});

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

test('given a sink that refuses every append and one pullable card, the claim-only call fails naming the card it did not start and the sink\'s error', async () => {
  const built = world({ cards: [8], concurrency: 2 });
  built.refuseAppends(DISK_FULL);

  await assert.rejects(built.claims.claim(), (failure) => {
    const reported = leavesOf(failure).filter((held) => /#8\b/.test(held.message));
    assert.equal(reported.length, 1, `one failure names card 8: ${JSON.stringify(leavesOf(failure).map((held) => held.message))}`);
    assert.match(reported[0].message, /not started/);
    assert.match(reported[0].message, /ENOSPC: no space left on device/);
    assert.equal(reported[0].cause?.message, DISK_FULL, 'the sink\'s own error is the cause');
    return true;
  });
});

/**
 * One claim-only call over ready cards 1 and 2 under concurrency 2, with the sink refusing every
 * append from before the call. Answers the call's failure and what `world` built.
 */
async function refusedClaim() {
  const built = world({ cards: [1, 2], concurrency: 2 });
  built.refuseAppends(DISK_FULL);
  let failure = null;
  await built.claims.claim().catch((thrown) => {
    failure = thrown;
  });
  return { built, failure };
}

// proves R-RECORD-9
test('given a sink that refuses every append and two pullable cards, the claim-only call claims no card', async () => {
  const { built, failure } = await refusedClaim();

  assert.ok(failure, 'the call failed');
  assert.deepEqual(await columnsOf(built.fake), { 1: 'Ready', 2: 'Ready' });
  // A claim held in memory would keep its card from the next call: both slots are free, so the
  // next call over an accepting sink claims both cards.
  built.acceptAppends();
  assert.deepEqual(numbersOf(await built.claims.claim()), [1, 2]);
});

test('given a sink that refuses every append and two pullable cards, the claim-only call leaves the fake board\'s write record empty', async () => {
  const { built, failure } = await refusedClaim();

  assert.ok(failure, 'the call failed');
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
    await quiesce();
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
  await quiesce();
  assert.deepEqual(built.dispatches.holding(), [1], "card 1's dispatch is running");
  built.refuseAppends(DISK_FULL);

  built.dispatches.releaseAll();
  await run.catch(() => {});

  assert.deepEqual(received, [[1, 'fulfilled', { exit: 0, output: '' }]]);
});

// proves R-RECORD-9
test('given a sink that refused the previous claim-only call and now accepts appends, the next claim-only call claims a card, with nothing between the two calls but the sink accepting again', async () => {
  const built = world({ cards: [1], concurrency: 1 });
  built.refuseAppends(DISK_FULL);
  await assert.rejects(built.claims.claim(), notStarted(1));
  assert.deepEqual(await columnsOf(built.fake), { 1: 'Ready' });

  built.acceptAppends();
  const claimed = numbersOf(await built.claims.claim());

  assert.deepEqual(claimed, [1]);
  assert.deepEqual(await columnsOf(built.fake), { 1: 'Coding' });
});

test('across a claim-only call the sink refused and a later one it accepted, the event stream holds no event recording a change of admission', async () => {
  const built = world({ cards: [1], concurrency: 1 });
  built.refuseAppends(DISK_FULL);
  await assert.rejects(built.claims.claim(), notStarted(1));
  built.acceptAppends();
  assert.deepEqual(numbersOf(await built.claims.claim()), [1]);

  // The accepted call's own events, and no other: R-SCHED-4 has only the owner and a repeated
  // infrastructure failure change admission, and the halt is neither.
  assert.deepEqual(built.events().map(({ layer, event }) => `${layer} ${event}`), ['L3 trigger', 'L3 pull', 'L2 transition']);
});

test('after a claim-only call the sink refused, followed by one it accepted, the state directory holds nothing but the event stream', async () => {
  const built = world({ cards: [1], concurrency: 1 });
  built.refuseAppends(DISK_FULL);
  await assert.rejects(built.claims.claim(), notStarted(1));
  built.acceptAppends();
  assert.deepEqual(numbersOf(await built.claims.claim()), [1]);

  assert.deepEqual(readdirSync(built.directory, { recursive: true }), ['events.jsonl']);
});

test('a start whose pull event the sink refused writes no release event once the sink accepts again, so no release event lacks its pull', async () => {
  // The trigger event and the pull event are the first two appends of a claim-only call, and the
  // sink refuses exactly those two: whatever L3 appends after them, it accepts.
  const built = world({ cards: [1], concurrency: 1 });
  built.refuseAppends(DISK_FULL, 2);

  await assert.rejects(built.claims.claim(), notStarted(1));

  assert.deepEqual(built.sequence.filter((entry) => entry.append), []);
  assert.deepEqual(readdirSync(built.directory), [], 'nothing was appended, so the sink never wrote the stream');
});

// proves R-RECORD-9
test('when L2 reports a refused transition event, the claim-only call\'s caller receives the failure L2 reported, with the card, the columns and the sink\'s error unchanged', async () => {
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

  await assert.rejects(built.claims.claim(), (failure) => {
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

test('given a sink that refuses every append, the claim-only call reports the pull trigger\'s refused event beside the start it did not make', async () => {
  const built = world({ cards: [1], concurrency: 1 });
  built.refuseAppends(DISK_FULL);

  await assert.rejects(built.claims.claim(), (failure) => {
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

/** What `loop` and `claimOnly` are handed but the kill, over `built`'s board, L2 and a sink. */
function withoutKill() {
  const built = world({ cards: [1] });
  const settings = { ...config, concurrency: 1 };
  return { config: settings, board: handleOn(built.fake), decide: (card) => nextAction(card, KINDS), l2: built.l2, sink: { emitter: () => ({ emit: () => {} }) } };
}

test('a loop handle built without the injected kill throws when it is built, naming the kill', () => {
  assert.throws(() => loop({ ...withoutKill(), dispatch: async () => ({ exit: 0 }) }), /\bkill\b/);
});

test('a claim-only handle built without the injected kill throws when it is built, naming the kill', () => {
  assert.throws(() => claimOnly(withoutKill()), /\bkill\b/);
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
  await quiesce();
  assert.equal(held.calls, 1, 'the kill was called');
  assert.deepEqual(built.l3Events(), []);
  held.release();
  await quiesce();
  assert.equal(built.l3Events()[0]?.event, 'run.start', JSON.stringify(built.l3Events()));
  built.dispatches.releaseAll();
  await quiesce();
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
  await quiesce();
  assert.equal(counted.reads, 0);
  held.release();
  await quiesce();
  assert.ok(counted.reads > 0, 'the run read the board once the kill settled');
  built.dispatches.releaseAll();
  await quiesce();
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
  await assert.rejects(built.claims.claim(1), (failure) => failure === refusal);

  assert.equal(counted.reads, 0);
  assert.deepEqual(built.l3Events(), []);
});
