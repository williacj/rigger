// ABOUTME: Tests L2's column changes: the claim's move to coding, a returned dispatch's move to
// review, no move for a failed one, the event each move writes, a move the board refuses, and a
// move the sink will not record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { existsSync } from 'node:fs';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { streamPath } from '../src/observation/sink.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { readsWith } from './loop-world.mjs';

/**
 * A fake board holding the columns `columns` names, in its key order, or the display names in
 * `held` instead, with one issue per number in `cards`, each in the column `columns.ready` names.
 * Its sink records into a fresh state `directory`, and `l2` is L2's column changes over both.
 * Beside the board, a fake repository holds, for each card, one open pull request from its line of
 * work, and `pullRequests`, its pull-request read, is the read L2 settles a maker's outcome by.
 */
function world({ columns = config.board.columns, cards = [12], held = Object.values(columns) } = {}) {
  const fake = createFakeBoard({
    columns: held,
    items: cards.map((number) => ({ type: 'issue', repository: config.repo, number, title: `Card ${number}`, column: columns.ready })),
  });
  const { readPullRequests: pullRequests } = createFakeRepository({ pullRequests: cards.map((number) => ({ number: 100 + number, head: `rigger-${number}`, sha: String(number).padStart(40, '0') })) }).operations;
  const directory = temporaryDirectory('rigger-transitions-');
  const sink = openSink({ directory, run: 'r-test', now: () => 0 });
  const l2 = columnChanges({ config: { ...config, board: { ...config.board, columns } }, sink, items: fake.operations, reads: readsWith(pullRequests) });
  return { fake, l2, sink, directory, pullRequests, events: () => readEvents(directory) };
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

// The sink below refuses because its state directory refuses writes after it opened, so the real
// sink's append throws EACCES. Removing the directory would not make it refuse, because the sink
// makes its directory at its first write.
const refuseWrites = (directory) => chmodSync(directory, 0o555);

test('a move the board takes and the sink will not record is reported, naming the card, both columns and the sink\'s error', async () => {
  const { fake, l2, directory } = world();
  const [card] = await itemsOf(fake);
  refuseWrites(directory);

  await assert.rejects(l2.claimed(card), (error) => {
    assert.match(error.message, /card #12/);
    assert.match(error.message, /from ready to coding/);
    assert.match(error.message, /EACCES/);
    return true;
  });

  assert.deepEqual(fake.writes(), [{ operation: 'moveItem', args: [card.id, 'Coding'] }], 'the board did not take the move');
});

// Starting no further work is L3's halt, placed on starts alone (ruling on #277; #281). A dispatch
// already running still settles, so its card still moves, and the move's own refused event is
// reported loudly as the one before it was.
for (const [name, settler] of [
  ['the same L2 instance', ({ l2 }) => l2],
  ['a second L2 instance over the same board and sink', ({ fake, sink, pullRequests }) => columnChanges({ config, sink, items: fake.operations, reads: readsWith(pullRequests) })],
]) {
  test(`while the sink still refuses, a card whose claim went unrecorded moves to review on a zero exit, settled by ${name}`, async () => {
    const w = world();
    const [card] = await itemsOf(w.fake);
    refuseWrites(w.directory);
    await assert.rejects(w.l2.claimed(card), /EACCES/);

    await assert.rejects(settler(w).settled(card, RETURNED), /card #12 moved from coding to review.*EACCES/);

    const [moved] = await itemsOf(w.fake);
    assert.equal(moved.column, 'Review');
    assert.deepEqual(w.fake.writes().map(({ args: [, column] }) => column), ['Coding', 'Review']);
  });
}

test('once the sink accepts again, no transition event for the refused move is ever appended', async () => {
  // A late event carries the time it was written, not the time of the move (R-RECORD-7).
  const { fake, l2, directory, events } = world();
  const [card] = await itemsOf(fake);
  refuseWrites(directory);
  await assert.rejects(l2.claimed(card), /EACCES/);
  chmodSync(directory, 0o755);

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
  const directory = temporaryDirectory('rigger-transitions-');
  const l2 = columnChanges({ config, sink: openSink({ directory, run: 'r-test', now: () => 0 }), send });

  await l2.claimed({ id: 'PVTI_lADOBzomGc4Bkn7fzgd', number: 12 });

  const [write] = sent.filter(([, , , , query]) => !query.startsWith('query=query'));
  assert.ok(write, `nothing was written: ${JSON.stringify(sent)}`);
  assert.match(write[4], /updateProjectV2ItemFieldValue/);
  assert.match(write[4], /PVTI_lADOBzomGc4Bkn7fzgd/);
  assert.match(write[4], /47fc9ee4/);
  assert.equal(readEvents(directory).length, 1);
});

/**
 * L2's column changes over a fake board holding card 30 in the column displayed as `column`, with
 * a sink of its own, and the board's items and the events recorded.
 */
async function boardWith(column) {
  const fake = createFakeBoard({ columns: Object.values(config.board.columns), items: [{ type: 'issue', repository: config.repo, number: 30, title: 'Card 30', column }] });
  const directory = temporaryDirectory('rigger-transitions-loop-');
  const l2 = columnChanges({ config, sink: openSink({ directory, run: 'r-test', now: () => 0 }), items: fake.operations, reads: readsWith(createFakeRepository().operations.readPullRequests) });
  const [card] = await itemsOf(fake);
  return { fake, l2, card, events: () => (existsSync(streamPath(directory)) ? readEvents(directory) : []).filter((event) => event.event === 'transition').map(({ from, to, cause }) => ({ from, to, cause })) };
}

/** L2's continuing-attempt answer on pull request #300 at a head. */
const CONTINUE = { action: 'continue', pull: 300, head: '3'.repeat(40), markers: [] };

test('L2 makes each review-loop move on the fake board: Review to Owner, Owner to Review, Review to Done and Owner to Done by its move answer, and Review to Coding and Owner to Coding by a continuing attempt\'s claim', async () => {
  const { columns } = config.board;
  const rows = [
    { from: columns.review, make: (l2, card) => l2.moved(card, { action: 'move', to: 'owner' }), to: columns.owner, transition: { from: 'review', to: 'owner', cause: 'sound' } },
    { from: columns.owner, make: (l2, card) => l2.moved(card, { action: 'move', to: 'review' }), to: columns.review, transition: { from: 'owner', to: 'review', cause: 'rejudged' } },
    { from: columns.review, make: (l2, card) => l2.moved(card, { action: 'move', to: 'done' }), to: columns.done, transition: { from: 'review', to: 'done', cause: 'merged' } },
    { from: columns.owner, make: (l2, card) => l2.moved(card, { action: 'move', to: 'done' }), to: columns.done, transition: { from: 'owner', to: 'done', cause: 'mergedFromOwner' } },
    { from: columns.review, make: (l2, card) => l2.claimed(card, CONTINUE), to: columns.coding, transition: { from: 'review', to: 'coding', cause: 'continued' } },
    { from: columns.owner, make: (l2, card) => l2.claimed(card, CONTINUE), to: columns.coding, transition: { from: 'owner', to: 'coding', cause: 'continuedFromOwner' } },
  ];
  for (const { from, make, to, transition } of rows) {
    const { fake, l2, card, events } = await boardWith(from);

    await make(l2, card);

    const [moved] = await itemsOf(fake);
    assert.equal(moved.column, to, JSON.stringify(transition));
    assert.deepEqual(events(), [transition]);
  }
});

test('claimed moves a Review card L2 answered as a continuing attempt by the continuing change, never by redone, and leaves a Coding card where it is', async () => {
  const review = await boardWith(config.board.columns.review);
  await review.l2.claimed(review.card, CONTINUE);
  const coding = await boardWith(config.board.columns.coding);
  await coding.l2.claimed(coding.card, CONTINUE);

  assert.deepEqual(review.events().map((event) => event.cause), ['continued']);
  assert.deepEqual(coding.events(), []);
  assert.deepEqual(coding.fake.writes(), []);
});

test('a move answer L2 has no change for, such as to Done from Coding, is refused naming the card and both columns, and nothing moves', async () => {
  const { fake, l2, card } = await boardWith(config.board.columns.coding);

  await assert.rejects(l2.moved(card, { action: 'move', to: 'done' }), (error) => /card #30\b/.test(error.message) && /coding/.test(error.message) && /done/.test(error.message));
  assert.deepEqual(fake.writes(), []);
});

// proves R-LOOP-6
test('L2 posts a return answer byte for byte on its pull request and leaves the board alone', async () => {
  const { fake, card } = await boardWith(config.board.columns.review);
  const repository = createFakeRepository({ pullRequests: [{ number: 300, head: 'rigger-30', sha: '3'.repeat(40) }] });
  const directory = temporaryDirectory('rigger-return-');
  const sink = openSink({ directory, run: 'r-test', now: () => 0 });
  const l2 = columnChanges({ config, sink, items: fake.operations, repositoryWrites: { postComment: repository.postComment } });
  const comment = 'First line\n\nSecond line\n';

  await l2.returned(card, { action: 'return', pull: 300, comment });

  assert.equal(repository.pull(300).comments[0].body, comment);
  assert.deepEqual(fake.writes(), []);
});

// proves R-ESCALATE-6
test('L2 records review.escalate under its layer with the card and category', async () => {
  const { fake, card } = await boardWith(config.board.columns.review);
  const directory = temporaryDirectory('rigger-escalation-');
  const l2 = columnChanges({ config, sink: openSink({ directory, run: 'r-test', now: () => 0 }), items: fake.operations });

  l2.escalated(card, { action: 'escalate', category: 'critical' });

  assert.deepEqual(readEvents(directory).filter((event) => event.event === 'review.escalate').map(({ layer, card: number, category }) => ({ layer, number, category })), [
    { layer: 'L2', number: 30, category: 'critical' },
  ]);
  assert.deepEqual(fake.writes(), []);
});

test('a board refusal of a move answer names the card and both columns and records no transition', async () => {
  const { fake, card } = await boardWith(config.board.columns.review);
  const directory = temporaryDirectory('rigger-move-refusal-');
  const sink = openSink({ directory, run: 'r-test', now: () => 0 });
  const items = { ...fake.operations, moveItem: async () => { throw new Error('board unavailable'); } };
  const l2 = columnChanges({ config, sink, items });

  await assert.rejects(l2.moved(card, { action: 'move', to: 'done' }), /card #30's move from review to done .* board unavailable/);

  assert.deepEqual(fake.writes(), []);
  assert.ok(!existsSync(streamPath(directory)), 'a refused move recorded a transition');
});

test('a sink refusal after a move answer names the card and both columns', async () => {
  const { fake, card } = await boardWith(config.board.columns.review);
  const sink = { emitter: () => ({ emit: (event) => { if (event === 'transition') throw new Error('sink unavailable'); } }) };
  const l2 = columnChanges({ config, sink, items: fake.operations });

  await assert.rejects(l2.moved(card, { action: 'move', to: 'done' }), /card #30 moved from review to done.*sink unavailable/);

  assert.deepEqual(fake.writes(), [{ operation: 'moveItem', args: [card.id, config.board.columns.done] }]);
});

test('a refused return comment names the card and pull request and moves nothing', async () => {
  const { fake, card } = await boardWith(config.board.columns.review);
  const sink = { emitter: () => ({ emit: () => {} }) };
  const l2 = columnChanges({ config, sink, items: fake.operations, repositoryWrites: { postComment: async () => { throw new Error('forge unavailable'); } } });

  await assert.rejects(l2.returned(card, { action: 'return', pull: 300, comment: 'return' }), /card #30's return comment on pull request #300 was refused: forge unavailable/);

  assert.deepEqual(fake.writes(), []);
});

test('a refused review.escalate event names the card and category and moves nothing', async () => {
  const { fake, card } = await boardWith(config.board.columns.review);
  const sink = { emitter: () => ({ emit: () => { throw new Error('sink unavailable'); } }) };
  const l2 = columnChanges({ config, sink, items: fake.operations });

  assert.throws(() => l2.escalated(card, { action: 'escalate', category: 'critical' }), /card #30's escalation in category critical was refused: sink unavailable/);

  assert.deepEqual(fake.writes(), []);
});
