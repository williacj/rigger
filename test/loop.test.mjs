// ABOUTME: Tests L3's loop over the fake board with an injected dispatch: at most N cards in
// flight, a claim taken before any await, a claim held only until its slot is released, and every
// read failure, refused claim move and dispatch outcome passed on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { openSink } from '../src/observation/sink.mjs';
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

/** A ready issue numbered `number` that L2 would dispatch: one kind selects it and its acceptance passes. */
const readyCard = (number) => ({
  type: 'issue', repository: config.repo, number, title: 'Add a verb', body: PASSING, labels: ['type:change'], column: COLUMNS.ready,
});

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
    open.push(() => {
      const given = answer(card);
      if (given instanceof Error) reject(given);
      else resolve(given);
    });
    most = Math.max(most, open.length);
  });
  return {
    dispatch,
    started,
    held: () => open.length,
    most: () => most,
    /** Releases every dispatch held now, each settling as `answer` says. */
    releaseAll: () => open.splice(0).forEach((release) => release()),
  };
}

/** The fake board holding `cards`, each a ready card L2 would dispatch. */
const boardOf = (cards) => createFakeBoard({ columns: Object.values(COLUMNS), items: cards.map(readyCard) });

/**
 * L0's handle on `fake`, as L3 reads it: the column read answers as the read side's does, and the
 * item read answers as L0 hands the board to L3, with no priority declared. `beforeRead` runs as
 * each item read begins, and `onRead` sees the items each read answers.
 */
function handleOn(fake, { beforeRead = () => {}, onRead = () => {} } = {}) {
  return {
    readColumns: async () => ({ ...COLUMNS }),
    readItems: async () => {
      beforeRead();
      const items = await fake.operations.readItems();
      onRead(items);
      return { items: items.map((item) => ({ ...item, priority: { value: null, declared: false } })), declared: null };
    },
  };
}

/**
 * L2's column changes over `fake`, and L3's loop over both under `concurrency` (none declared
 * where it is undefined). L2's next action is the real one with freshness injected: once a card's
 * dispatch has returned, `fresh` says whether L2 has nothing more to do for it. `board` is L0's
 * handle, and `items` stands in for the board's writes.
 */
function world({ cards = [1, 2, 3, 4], fake = boardOf(cards), concurrency, fresh = true, answer, items = fake.operations, board = handleOn(fake) } = {}) {
  const settings = { ...config };
  delete settings.concurrency;
  if (concurrency !== undefined) settings.concurrency = concurrency;
  const sink = openSink({ directory: mkdtempSync(join(tmpdir(), 'rigger-loop-')), run: 'r-test', now: () => 0 });
  const l2 = columnChanges({ config: settings, sink, items });
  const returned = new Set();
  const decide = (card) => (fresh && returned.has(card.number) ? { action: 'ignore' } : nextAction(card, KINDS));
  const dispatches = heldDispatch(answer);
  const dispatch = async (start) => {
    try {
      return await dispatches.dispatch(start);
    } finally {
      returned.add(start.card.number);
    }
  };
  return { fake, l2, dispatches, loop: loop({ config: settings, board, decide, l2, dispatch }) };
}

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
    readItems: async () => assert.fail('the loop read the items after the column read failed'),
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
