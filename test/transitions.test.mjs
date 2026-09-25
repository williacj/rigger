// ABOUTME: Tests L2's column changes: the claim's move to coding, a returned dispatch's move to
// review, no move for a failed one, the event each move writes, and a move the board refuses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';

/**
 * A fake board holding the columns `columns` names, in its key order, with one issue per number
 * in `cards`, each in the column `columns.ready` names. Its sink records into a fresh state
 * directory, and `l2` is L2's column changes over both.
 */
function world({ columns = config.board.columns, cards = [12] } = {}) {
  const fake = createFakeBoard({
    columns: Object.values(columns),
    items: cards.map((number) => ({ type: 'issue', repository: config.repo, number, title: `Card ${number}`, column: columns.ready })),
  });
  const directory = mkdtempSync(join(tmpdir(), 'rigger-transitions-'));
  const sink = openSink({ directory, run: 'r-test', now: () => 0 });
  const l2 = columnChanges({ config: { ...config, board: { ...config.board, columns } }, sink, items: fake.operations });
  return { fake, l2, events: () => readEvents(directory) };
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
 * dispatch, which L3 builds without looking inside it.
 */
const RETURNED = { status: 'fulfilled', value: { exit: 0, output: '' } };
const FAILED = { status: 'rejected', reason: new Error('the dispatch could not start') };

test("a returned dispatch's card moves from the coding column to the review column", async () => {
  const { fake, l2 } = world();
  const [card] = await itemsOf(fake);
  await l2.claimed(card);

  await l2.settled(card, RETURNED);

  const [moved] = await itemsOf(fake);
  assert.equal(moved.column, 'Review');
  assert.deepEqual(fake.writes().at(-1), { operation: 'moveItem', args: [card.id, 'Review'] });
});

test("a failed dispatch's card is not moved, and stays in the coding column", async () => {
  const { fake, l2 } = world();
  const [card] = await itemsOf(fake);
  await l2.claimed(card);

  await l2.settled(card, FAILED);

  const [held] = await itemsOf(fake);
  assert.equal(held.column, 'Coding');
  assert.deepEqual(fake.writes(), [{ operation: 'moveItem', args: [card.id, 'Coding'] }]);
});

test('an outcome that is neither returned nor failed is refused, naming the card, and moves nothing', async () => {
  // An outcome L3 built some other way is a fault in L3, and reading it as a failure would hide it.
  const { fake, l2 } = world();
  const [card] = await itemsOf(fake);
  await l2.claimed(card);

  await assert.rejects(l2.settled(card, { exit: 0 }), /card #12/);

  assert.equal(fake.writes().length, 1);
});
