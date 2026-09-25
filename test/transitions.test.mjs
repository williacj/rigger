// ABOUTME: Tests L2's column changes: the claim's move to coding, a returned dispatch's move to
// review, no move for a failed one, the event each move writes, a move the board refuses, and a
// move the sink will not record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';

/**
 * A fake board holding the columns `columns` names, in its key order, or the display names in
 * `held` instead, with one issue per number in `cards`, each in the column `columns.ready` names.
 * Its sink records into a fresh state `directory`, and `l2` is L2's column changes over both.
 */
function world({ columns = config.board.columns, cards = [12], held = Object.values(columns) } = {}) {
  const fake = createFakeBoard({
    columns: held,
    items: cards.map((number) => ({ type: 'issue', repository: config.repo, number, title: `Card ${number}`, column: columns.ready })),
  });
  const directory = mkdtempSync(join(tmpdir(), 'rigger-transitions-'));
  const sink = openSink({ directory, run: 'r-test', now: () => 0 });
  const l2 = columnChanges({ config: { ...config, board: { ...config.board, columns } }, sink, items: fake.operations });
  return { fake, l2, sink, directory, events: () => readEvents(directory) };
}

/** The board items the fake holds, as its reads answer them. */
const itemsOf = (fake) => fake.operations.readItems();

test('a claimed card moves from the ready column to the coding column', async () => {
  const { fake, l2 } = world();
  const [card] = await itemsOf(fake);

  await l2.claimed(card);

  const [moved] = await itemsOf(fake);
  assert.equal(moved.column, 'Coding');
  assert.deepEqual(fake.writes(), [{ operation: 'moveItem', args: [card.id, 'Coding'] }]);
});

/**
 * A dispatch's outcome as L3 hands it over unread: the record `Promise.allSettled` makes of the
 * dispatch, which L3 builds without looking inside it. A dispatch that ran is fulfilled with L1's
 * result, its exit code and captured output (`ARCHITECTURE.md`, the L1 row); one that threw
 * before it ran is rejected. Each output here says the opposite of its exit code, so a reading
 * of the output rather than the exit code sends the card the wrong way.
 */
const RETURNED = { status: 'fulfilled', value: { exit: 0, output: 'FAIL: 3 of 12 tests failed' } };
const EXITED = { status: 'fulfilled', value: { exit: 1, output: 'All 12 tests passed.' } };
const THREW = { status: 'rejected', reason: new Error('the dispatch could not start') };

test("a dispatch that exited zero moves its card from the coding column to the review column, whatever its output says", async () => {
  const { fake, l2 } = world();
  const [card] = await itemsOf(fake);
  await l2.claimed(card);

  await l2.settled(card, RETURNED);

  const [moved] = await itemsOf(fake);
  assert.equal(moved.column, 'Review');
  assert.deepEqual(fake.writes().at(-1), { operation: 'moveItem', args: [card.id, 'Review'] });
});

test('a dispatch that ran and exited non-zero, in the wrapper of an outcome that did not throw, leaves its card in the coding column', async () => {
  const { fake, l2 } = world();
  const [card] = await itemsOf(fake);
  await l2.claimed(card);

  await l2.settled(card, EXITED);

  const [held] = await itemsOf(fake);
  assert.equal(held.column, 'Coding');
  assert.deepEqual(fake.writes(), [{ operation: 'moveItem', args: [card.id, 'Coding'] }]);
});

test('a dispatch that threw before it ran leaves its card in the coding column', async () => {
  const { fake, l2 } = world();
  const [card] = await itemsOf(fake);
  await l2.claimed(card);

  await l2.settled(card, THREW);

  const [held] = await itemsOf(fake);
  assert.equal(held.column, 'Coding');
  assert.deepEqual(fake.writes(), [{ operation: 'moveItem', args: [card.id, 'Coding'] }]);
});

test('an outcome that is not a settled dispatch with an exit code is refused, naming the card, and moves nothing', async () => {
  // An outcome L3 built some other way is a fault in L3, and reading it as a failure would hide it.
  const shapes = [
    null,
    undefined,
    { exit: 0 },
    { status: 'fulfilled' },
    { status: 'fulfilled', value: null },
    { status: 'fulfilled', value: { output: 'done' } },
    { status: 'fulfilled', value: { exit: '0', output: '' } },
  ];
  for (const shape of shapes) {
    const { fake, l2 } = world();
    const [card] = await itemsOf(fake);
    await l2.claimed(card);

    await assert.rejects(l2.settled(card, shape), /card #12/, `${JSON.stringify(shape)} was not refused naming the card`);

    assert.equal(fake.writes().length, 1, `${JSON.stringify(shape)} moved the card`);
  }
});

test('each column change writes one L2 event naming the card, the column left, the column entered and the cause', async () => {
  const { fake, l2, events } = world();
  const [card] = await itemsOf(fake);

  await l2.claimed(card);
  await l2.settled(card, RETURNED);

  assert.deepEqual(events(), [
    { ts: '1970-01-01T00:00:00.000Z', run: 'r-test', layer: 'L2', event: 'transition', card: 12, from: 'ready', to: 'coding', cause: 'claimed' },
    { ts: '1970-01-01T00:00:00.000Z', run: 'r-test', layer: 'L2', event: 'transition', card: 12, from: 'coding', to: 'review', cause: 'returned' },
  ]);
});

test('a move the board refuses writes no transition event, and is reported naming the card and the column', async () => {
  // The fake refuses a move into a column it does not hold, as the adapter refuses one its
  // columns field has no option for.
  const { fake, l2, events } = world({ held: ['Ready', 'Review'] });
  const [card] = await itemsOf(fake);

  await assert.rejects(l2.claimed(card), (error) => {
    assert.match(error.message, /card #12/);
    assert.match(error.message, /coding/);
    assert.match(error.message, /the fake board has no column named Coding/);
    return true;
  });

  assert.deepEqual(fake.writes(), []);
  assert.throws(events, /ENOENT/, 'the event stream was written');
});

// The sink below refuses the way the judge's probe on PR #273 made it refuse: its state directory
// is removed after it opened, so the real sink's append throws ENOENT.

test('a move the board takes and the sink will not record is reported, naming the card, both columns and the sink\'s error', async () => {
  const { fake, l2, directory } = world();
  const [card] = await itemsOf(fake);
  rmSync(directory, { recursive: true });

  await assert.rejects(l2.claimed(card), (error) => {
    assert.match(error.message, /card #12/);
    assert.match(error.message, /from ready to coding/);
    assert.match(error.message, /ENOENT/);
    return true;
  });

  assert.deepEqual(fake.writes(), [{ operation: 'moveItem', args: [card.id, 'Coding'] }], 'the board did not take the move');
});

// Starting no further work is L3's halt, placed on starts alone (ruling on #277; #281). A dispatch
// already running still settles, so its card still moves, and the move's own refused event is
// reported loudly as the one before it was.
for (const [name, settler] of [
  ['the same L2 instance', ({ l2 }) => l2],
  ['a second L2 instance over the same board and sink', ({ fake, sink }) => columnChanges({ config, sink, items: fake.operations })],
]) {
  test(`while the sink still refuses, a card whose claim went unrecorded moves to review on a zero exit, settled by ${name}`, async () => {
    const w = world();
    const [card] = await itemsOf(w.fake);
    rmSync(w.directory, { recursive: true });
    await assert.rejects(w.l2.claimed(card), /ENOENT/);

    await assert.rejects(settler(w).settled(card, RETURNED), /card #12 moved from coding to review.*ENOENT/);

    const [moved] = await itemsOf(w.fake);
    assert.equal(moved.column, 'Review');
    assert.deepEqual(w.fake.writes().map(({ args: [, column] }) => column), ['Coding', 'Review']);
  });
}

test('once the sink accepts again, no transition event for the refused move is ever appended', async () => {
  // A late event carries the time it was written, not the time of the move (R-RECORD-7).
  const { fake, l2, directory, events } = world();
  const [card] = await itemsOf(fake);
  rmSync(directory, { recursive: true });
  await assert.rejects(l2.claimed(card), /ENOENT/);
  mkdirSync(directory);

  await l2.settled(card, RETURNED);

  const [moved] = await itemsOf(fake);
  assert.equal(moved.column, 'Review', 'the run never reached a later append');
  assert.deepEqual(
    events().map(({ card: number, from, to, cause }) => ({ number, from, to, cause })),
    [{ number: 12, from: 'coding', to: 'review', cause: 'returned' }],
  );
});

/**
 * Five cards, #1 to #5, each claimed, and then #1 and #3 exited zero, #2 threw, #4 exited
 * non-zero and #5 still out. A refused move is caught, so the run goes on past it as a caller
 * that reported it would.
 */
async function run({ held } = {}) {
  const w = world({ cards: [1, 2, 3, 4, 5], held });
  const cards = await itemsOf(w.fake);
  const refused = [];
  const attempt = (call) => call.catch((error) => refused.push(error.message));
  for (const card of cards) await attempt(w.l2.claimed(card));
  const [one, two, three, four] = cards;
  await attempt(w.l2.settled(one, RETURNED));
  await attempt(w.l2.settled(two, THREW));
  await attempt(w.l2.settled(three, RETURNED));
  await attempt(w.l2.settled(four, EXITED));
  return { ...w, cards, refused };
}

/** Column key by display name, read off this repository's config. */
const KEY_OF = { Ready: 'ready', Coding: 'coding', Review: 'review', Owner: 'owner', Done: 'done' };

/**
 * The fake board's write record as moves: each `moveItem` replayed from every card starting in
 * Ready, so each names the card's number and the column keys it left and entered.
 */
function movesIn(fake, cards) {
  const at = new Map(cards.map((card) => [card.id, card.column]));
  return fake.writes().map(({ operation, args: [id, column] }) => {
    assert.equal(operation, 'moveItem');
    const from = at.get(id);
    at.set(id, column);
    return { card: cards.find((card) => card.id === id).number, from: KEY_OF[from], to: KEY_OF[column] };
  });
}

/** The stream's L2 transition events, each as the card and the two column keys it names. */
const transitionsIn = (events) =>
  events()
    .filter((event) => event.layer === 'L2' && event.event === 'transition')
    .map(({ card, from, to }) => ({ card, from, to }));

/** How many of `list` equal `entry`. */
const count = (list, entry) => list.filter((held) => JSON.stringify(held) === JSON.stringify(entry)).length;

for (const [name, held] of [
  ['every move is made', undefined],
  ['the board refuses every move into review', ['Ready', 'Coding']],
]) {
  test(`every move in the write record has exactly one L2 transition event naming its card and columns, when ${name}`, async () => {
    const { fake, cards, events } = await run({ held });
    const moves = movesIn(fake, cards);
    const transitions = transitionsIn(events);
    assert.ok(moves.length >= 4, `only ${moves.length} moves were made`);

    for (const move of moves) assert.equal(count(transitions, move), 1, `${JSON.stringify(move)} in ${JSON.stringify(transitions)}`);
  });

  test(`no L2 transition event lacks a matching move in the write record, when ${name}`, async () => {
    const { fake, cards, events, refused } = await run({ held });
    const moves = movesIn(fake, cards);
    const transitions = transitionsIn(events);
    if (held) assert.equal(refused.length, 2, 'the board did not refuse exactly the two moves into review');

    for (const transition of transitions) assert.equal(count(moves, transition), 1, `${JSON.stringify(transition)} in ${JSON.stringify(moves)}`);
  });
}

test('no change L2 makes, for any outcome it handles, has the ready column as its destination', async () => {
  // `run` drives every outcome L2 handles: a claim, a dispatch that exited zero, one that exited
  // non-zero, and one that threw.
  const { fake, cards, events } = await run();
  const moves = movesIn(fake, cards);
  // Five claims and two dispatches that exited zero, whichever columns they went to.
  assert.equal(moves.length, 7, 'the run did not make one move per claim and per dispatch that exited zero');

  assert.deepEqual(moves.filter(({ to }) => to === 'ready'), []);
  assert.deepEqual(transitionsIn(events).filter(({ to }) => to === 'ready'), []);
});

test('renamed display names produce the same moves, by column key, as the default names', async () => {
  // Five display names none of which this repository's config gives a column, so a move that
  // named a column by the default name could not land on this board.
  const renamed = { ready: 'Up Next', coding: 'Building', review: 'In Review', owner: 'Needs A Human', done: 'Shipped' };
  const keyOf = Object.fromEntries(Object.entries(renamed).map(([key, name]) => [name, key]));
  const byKey = (fake) => fake.writes().map(({ args: [id, column] }) => [id, keyOf[column] ?? KEY_OF[column]]);

  const standard = world({ cards: [1, 2, 3] });
  const other = world({ cards: [1, 2, 3], columns: renamed });
  for (const { fake, l2 } of [standard, other]) {
    const [one, two, three] = await itemsOf(fake);
    for (const card of [one, two, three]) await l2.claimed(card);
    await l2.settled(one, RETURNED);
    await l2.settled(two, THREW);
    await l2.settled(three, RETURNED);
  }

  assert.deepEqual(other.fake.writes().map(({ args: [, column] }) => column).filter((column) => KEY_OF[column]), []);
  assert.deepEqual(byKey(other.fake), byKey(standard.fake));
  assert.equal(byKey(standard.fake).length, 5);
});

test("with no item-write side passed in, L2's move goes to the forge through the item-write side's runner", async () => {
  // Each read's answer takes the shape `test/forge-adapter.test.mjs`'s recorded forge gives it,
  // with the IDs #212's spike recorded, cut to the two options this move needs. Nothing here
  // reaches `gh`: every request is answered in the test.
  const FIELD = 'PVTSSF_lAHOBzomGc4Bkn7fzhjX4Mc';
  const answer = (data) => ({ status: 0, stdout: JSON.stringify({ data }), stderr: '' });
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    const document = args[3].slice('query='.length);
    if (!document.startsWith('query')) return answer({});
    if (document.includes('repositoryOwner')) {
      const field = { id: FIELD, options: [{ id: 'f75ad846', name: 'Ready' }, { id: '47fc9ee4', name: 'Coding' }] };
      return answer({ repositoryOwner: { projectV2: { id: 'PVT_kwHOBzomGc4Bkn7f', field } } });
    }
    return answer({ project: { field: { id: FIELD } }, target: { name: 'Status' } });
  };
  const directory = mkdtempSync(join(tmpdir(), 'rigger-transitions-'));
  const l2 = columnChanges({ config, sink: openSink({ directory, run: 'r-test', now: () => 0 }), send });

  await l2.claimed({ id: 'PVTI_lADOBzomGc4Bkn7fzgd', number: 12 });

  const [write] = sent.filter(([, , , , query]) => !query.startsWith('query=query'));
  assert.ok(write, `nothing was written: ${JSON.stringify(sent)}`);
  assert.match(write[4], /updateProjectV2ItemFieldValue/);
  assert.match(write[4], /PVTI_lADOBzomGc4Bkn7fzgd/);
  assert.match(write[4], /47fc9ee4/);
  assert.equal(readEvents(directory).length, 1);
});
