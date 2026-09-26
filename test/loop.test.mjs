// ABOUTME: Tests L3's loop over the fake board with an injected dispatch: at most N cards in
// flight, a claim taken before any await, a claim held only until its slot is released, every
// read failure, refused claim move and dispatch outcome passed on, and a run that refills each
// freed slot and leaves each card in the column its outcome settles, by the config's column names;
// and the events L3 records, the drain trigger's among them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { itemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { loop } from '../src/scheduling/loop.mjs';

/** One kind, selected by one label, in the shape a config's `kinds` takes. */
const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };

/** The columns this repository's config declares, by key, as the read side's column read answers them. */
const COLUMNS = config.board.columns;

/** A body whose acceptance passes L2's form check under the title `Add a verb`. */
const PASSING = '## Acceptance\n\n- The verb prints its help.\n';

/**
 * An issue numbered `number` that L2 would dispatch, one kind selecting it and its acceptance
 * passing, in the column displayed as `column`, holding `fieldValues`.
 */
const cardIn = (number, column, fieldValues) => ({
  type: 'issue', repository: config.repo, number, title: 'Add a verb', body: PASSING, labels: ['type:change'], column, ...(fieldValues && { fieldValues }),
});

/** A ready issue numbered `number` that L2 would dispatch, on a board whose columns are `columns` by key. */
const readyCard = (number, columns = COLUMNS) => cardIn(number, columns.ready);

/**
 * Lets every step already queued run to its end. The fake board, L2 and the injected dispatch
 * answer through promises alone, with no timer and no I/O, so once this returns every start the
 * loop could make without a held dispatch returning has been made. It waits on no clock.
 */
const quiesce = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A dispatch that holds every card it is handed until the test releases it, recording each start
 * and the most dispatches held open at once. `answer(card)` is what a released dispatch settles
 * with: a result `{ exit, output }` to return, or an Error to throw.
 */
function heldDispatch(answer = () => ({ exit: 0, output: '' })) {
  const started = [];
  const open = [];
  let most = 0;
  const dispatch = ({ card }) => new Promise((resolve, reject) => {
    started.push(card.number);
    open.push({
      number: card.number,
      release: () => {
        const given = answer(card);
        if (given instanceof Error) reject(given);
        else resolve(given);
      },
    });
    most = Math.max(most, open.length);
  });
  return {
    dispatch,
    started,
    held: () => open.length,
    /** The numbers of the cards whose dispatches are held now, in the order they started. */
    holding: () => open.map(({ number }) => number),
    most: () => most,
    /** Releases every dispatch held now, each settling as `answer` says. */
    releaseAll: () => open.splice(0).forEach(({ release }) => release()),
    /** Releases the held dispatch of card `number` alone, settling as `answer` says. */
    release: (number) => open.splice(open.findIndex((held) => held.number === number), 1)[0].release(),
  };
}

/**
 * The fake board whose columns are `columns` by key, holding `cards`: each a number, for a ready
 * card L2 would dispatch, or a board item as `cardIn` makes one.
 */
const boardOf = (cards, columns = COLUMNS) => createFakeBoard({
  columns: Object.values(columns),
  items: cards.map((card) => (typeof card === 'number' ? readyCard(card, columns) : card)),
});

/**
 * L0's handle on `fake`, as L3 reads it: the column read reads the board's columns and answers
 * `columns` by key, as the read side's does for a config declaring them on a board holding them
 * all, and the priority read answers as the read side's
 * `readPriority` does for a config declaring `priority`, where none declared leaves every card's
 * `priority`, `declared` and `options` null. `beforeRead` runs as each priority read begins, and
 * `onRead` sees the items each one answers.
 */
function handleOn(fake, { columns = COLUMNS, priority, beforeRead = () => {}, onRead = () => {} } = {}) {
  return {
    readColumns: async () => {
      await fake.operations.readColumns();
      return { ...columns };
    },
    readPriority: async () => {
      beforeRead();
      const answer = await fake.operations.readPriority(priority);
      onRead(answer.items);
      return answer;
    },
  };
}

/**
 * L2's column changes over `fake`, and L3's loop over both under `concurrency` (none declared
 * where it is undefined), for a config whose board declares `columns` by key and whose L0 handle
 * reads priority under `priority`. L2's next action is the real one with freshness injected: once
 * a card's dispatch has returned, `fresh` says whether L2 has nothing more to do for it. `board`
 * is L0's handle, and `items` stands in for the board's writes.
 *
 * `sequence` records, in the one order they happened, each board move once the board has made
 * it, as `{ move, column }` with the item's id and the column's display name, and each dispatch
 * start, as `{ start }` with the item's id.
 *
 * L2 and L3 share one sink, whose clock ticks once per event, so no two events share a time.
 * `layers` records the layer of every emitter L3 asks the sink for.
 */
function world({
  cards = [1, 2, 3, 4], columns = COLUMNS, priority, fake = boardOf(cards, columns), concurrency, fresh = true, answer,
  items = fake.operations, board = handleOn(fake, { columns, priority }),
} = {}) {
  const settings = { ...config, board: { ...config.board, columns } };
  delete settings.concurrency;
  if (concurrency !== undefined) settings.concurrency = concurrency;
  const sequence = [];
  const recorded = {
    ...items,
    moveItem: async (id, column) => {
      await items.moveItem(id, column);
      sequence.push({ move: id, column });
    },
  };
  const directory = mkdtempSync(join(tmpdir(), 'rigger-loop-'));
  let tick = 0;
  const sink = openSink({ directory, run: 'r-test', now: () => (tick += 1) });
  const layers = [];
  const l3Sink = {
    emitter: (context) => {
      layers.push(context.layer);
      return sink.emitter(context);
    },
  };
  const l2 = columnChanges({ config: settings, sink, items: recorded });
  const returned = new Set();
  const decide = (card) => (fresh && returned.has(card.number) ? { action: 'ignore' } : nextAction(card, KINDS));
  const dispatches = heldDispatch(answer);
  const dispatch = async (start) => {
    sequence.push({ start: start.card.id });
    try {
      return await dispatches.dispatch(start);
    } finally {
      returned.add(start.card.number);
    }
  };
  return {
    fake, l2, dispatches, sequence, layers,
    /** Every event the run has recorded so far, in the order recorded. */
    events: () => readEvents(directory),
    /** The events L3 recorded so far, in order. */
    l3Events: () => readEvents(directory).filter((event) => event.layer === 'L3'),
    loop: loop({ config: settings, board, decide, l2, dispatch, sink: l3Sink }),
  };
}

/** Each card on `fake` by number, with the display name of the column it is in now. */
const columnsOf = async (fake) => Object.fromEntries((await fake.operations.readItems()).map((item) => [item.number, item.column]));

/**
 * Fires two pull triggers at a time, lets every start they make happen, then releases every held
 * dispatch, until a round starts nothing. Returns what `world` built.
 */
async function runToEnd(built) {
  for (;;) {
    const before = built.dispatches.started.length;
    const ticks = [built.loop.pull(), built.loop.pull()];
    await quiesce();
    built.dispatches.releaseAll();
    await Promise.all(ticks);
    if (built.dispatches.started.length === before) return built;
  }
}

/**
 * Starts one run of `built`'s loop, and releases every held dispatch each time the loop has made
 * every start it can, until the run ends. Answers the run's own settling, so a run that fails
 * rejects here with its failure unchanged.
 */
async function drive(built) {
  let ended = false;
  const run = built.loop.run().finally(() => {
    ended = true;
  });
  run.catch(() => {});
  while (!ended) {
    await quiesce();
    built.dispatches.releaseAll();
  }
  return run;
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
