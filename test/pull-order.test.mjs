// ABOUTME: Tests L3's pull order over the fake board: redos ahead of Ready cards, each group by the
// declared priority and then by issue number, with L2's refusals reported and its ignores dropped.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBoard } from './fake-board.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { pullOrder } from '../src/scheduling/pull-order.mjs';

/** One kind, selected by one label, in the shape a config's `kinds` takes. */
const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };

/** The columns a config declares under `board.columns`, by key, as L0's column read hands them on. */
const COLUMNS = { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' };

/** Every `Status` option the fake board holds: the declared columns and four the config never names. */
const STATUS = ['Backlog', 'Ready', 'Coding', 'Review', 'Engine Review', 'Needs Owner', 'Blocked', 'Owner', 'Done'];

/** A priority declaration as a config's `board.priority` holds it, highest rank first. */
const PRIORITY = { field: 'Priority', options: ['High', 'Normal', 'Low'] };

/** A body whose acceptance passes L2's form check under the title `Add a verb`. */
const PASSING = '## Acceptance\n\n- The verb prints its help.\n';

/**
 * A board item numbered `number` in `column`, holding `priority` in the Priority field where it is
 * given. By default L2 would dispatch it: one kind selects it and its acceptance passes.
 */
const item = (number, column, priority, { labels = ['type:change'], body = PASSING } = {}) => ({
  type: 'issue',
  repository: 'williacj/rigger',
  number,
  title: 'Add a verb',
  body,
  labels,
  column,
  fieldValues: priority === undefined ? {} : { Priority: priority },
});

/** A fake board holding `items`, whose Priority field lists its options in an order unlike the declared one. */
const boardOf = (items) => createFakeBoard({
  columns: STATUS,
  fields: [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }],
  items,
});

/**
 * Stands in for #224's hand-off from L0: each item with its priority value and whether the
 * declaration names that value, and the declared order. With no declaration there is no order and
 * no value.
 */
const handOff = (items, priority) => ({
  items: items.map((held) => {
    const value = priority ? (held.fieldValues[priority.field] ?? null) : null;
    return { ...held, priority: { value, declared: value !== null && priority.options.includes(value) } };
  }),
  declared: priority ? [...priority.options] : null,
});

/**
 * L3's pull order over `fake`'s board as it reads now. L2's next action is the real one, with
 * freshness injected: a card `fresh` answers true for is one L2 has nothing to do for.
 */
async function planOf(fake, { priority = PRIORITY, fresh = () => false } = {}) {
  const { items, declared } = handOff(await fake.operations.readItems(), priority);
  const l2 = (card) => (fresh(card) ? { action: 'ignore' } : nextAction(card, KINDS));
  return pullOrder({ items, columns: COLUMNS, declared }, l2);
}

/** The card numbers in a plan's pull order, first pulled first. */
const pulled = (plan) => plan.pulls.map((pull) => pull.card);

// proves R-SCHED-1
test('the higher-priority ready card is pulled first, though the board lists the lower one first', async () => {
  const fake = boardOf([item(3, 'Ready', 'Low'), item(4, 'Ready', 'Normal')]);

  assert.deepEqual(pulled(await planOf(fake)), [4, 3]);
});

// proves R-SCHED-1
test('changing the lower-priority card\'s value to outrank the other puts it first', async () => {
  assert.deepEqual(pulled(await planOf(boardOf([item(3, 'Ready', 'Low'), item(4, 'Ready', 'Normal')]))), [4, 3]);

  assert.deepEqual(pulled(await planOf(boardOf([item(3, 'Ready', 'High'), item(4, 'Ready', 'Normal')]))), [3, 4]);
});

test('the declared order ranks cards, so under Low, Normal, High a card valued Low is pulled before one valued High', async () => {
  const fake = boardOf([item(5, 'Ready', 'High'), item(6, 'Ready', 'Low')]);
  const priority = { field: 'Priority', options: ['Low', 'Normal', 'High'] };

  assert.deepEqual(pulled(await planOf(fake, { priority })), [6, 5]);
});

test('of two ready cards with equal priority the lower issue number is pulled first, whichever the board lists first', async () => {
  assert.deepEqual(pulled(await planOf(boardOf([item(8, 'Ready', 'Normal'), item(7, 'Ready', 'Normal')]))), [7, 8]);
  assert.deepEqual(pulled(await planOf(boardOf([item(7, 'Ready', 'Normal'), item(8, 'Ready', 'Normal')]))), [7, 8]);
});

test('a card valued with the last declared option is pulled before a card with no value', async () => {
  assert.deepEqual(pulled(await planOf(boardOf([item(9, 'Ready'), item(12, 'Ready', 'Low')]))), [12, 9]);
});

test('a card valued with the last declared option is pulled before a card whose value is undeclared', async () => {
  assert.deepEqual(pulled(await planOf(boardOf([item(9, 'Ready', 'Urgent'), item(12, 'Ready', 'Low')]))), [12, 9]);
});

test('a card whose value is undeclared and a card with no value share a rank, and are pulled oldest first', async () => {
  assert.deepEqual(pulled(await planOf(boardOf([item(14, 'Ready', 'Urgent'), item(13, 'Ready')]))), [13, 14]);
  assert.deepEqual(pulled(await planOf(boardOf([item(14, 'Ready'), item(13, 'Ready', 'Urgent')]))), [13, 14]);
});

test('with no board.priority in the config every card ties, and cards are pulled oldest first even where they carry values', async () => {
  const fake = boardOf([item(22, 'Ready', 'High'), item(21, 'Ready'), item(20, 'Ready', 'Low')]);
  const onTheBoard = (await fake.operations.readItems()).map((held) => held.fieldValues.Priority);
  assert.deepEqual(onTheBoard, ['High', undefined, 'Low']);

  assert.deepEqual(pulled(await planOf(fake, { priority: null })), [20, 21, 22]);
});

test('a ready card L2 ignores appears neither in the pull order nor among the refusals', async () => {
  const plan = await planOf(boardOf([item(30, 'Ready', 'High', { labels: ['area:demo'] }), item(31, 'Ready', 'Low')]));

  assert.deepEqual(pulled(plan), [31]);
  assert.deepEqual(plan.refusals, []);
});

test('a ready card L2 refuses appears among the refusals with L2\'s reason, and not in the pull order', async () => {
  const plan = await planOf(boardOf([item(32, 'Ready', 'High', { body: 'Context, and no acceptance.' }), item(33, 'Ready', 'Low')]));

  assert.deepEqual(pulled(plan), [33]);
  assert.deepEqual(plan.refusals, [{ card: 32, reason: 'missing acceptance' }]);
});

test('only Ready cards and unclaimed not-fresh Coding and Review cards enter the pull order, whatever other column a dispatchable card is in', async () => {
  const elsewhere = ['Owner', 'Done', 'Backlog', 'Blocked', 'Engine Review', 'Needs Owner'];
  const fake = boardOf([
    ...elsewhere.map((column, index) => item(40 + index, column, 'High')),
    item(50, 'Ready', 'Low'),
    item(51, 'Coding', 'Low'),
    item(52, 'Review', 'Low'),
  ]);

  const plan = await planOf(fake);

  assert.deepEqual(pulled(plan).sort((a, b) => a - b), [50, 51, 52]);
  assert.deepEqual(plan.refusals, []);
});

test('every redo precedes every Ready card, whatever their priorities', async () => {
  const fake = boardOf([
    item(60, 'Ready', 'High'),
    item(61, 'Coding', 'Low'),
    item(62, 'Ready', 'High'),
    item(63, 'Review'),
  ]);

  const plan = await planOf(fake);

  assert.deepEqual(pulled(plan), [61, 63, 60, 62]);
  assert.deepEqual(plan.pulls.map((pull) => pull.redo), [true, true, false, false]);
});

test('among redos the pull order is by priority and then by issue number', async () => {
  const fake = boardOf([
    item(74, 'Review', 'Low'),
    item(73, 'Coding', 'Low'),
    item(72, 'Review', 'High'),
    item(71, 'Coding'),
    item(70, 'Coding', 'Normal'),
  ]);

  assert.deepEqual(pulled(await planOf(fake)), [72, 70, 73, 74, 71]);
});

test('Coding and Review cards with freshness injected as fresh do not appear in the pull order', async () => {
  const fake = boardOf([item(80, 'Coding', 'High'), item(81, 'Review', 'High'), item(82, 'Ready', 'Low')]);
  const fresh = (card) => card.column === 'Coding' || card.column === 'Review';

  const plan = await planOf(fake, { fresh });

  assert.deepEqual(pulled(plan), [82]);
  assert.deepEqual(plan.refusals, []);
});

test('computing the pull order leaves the fake board\'s write record empty', async () => {
  const fake = boardOf([
    item(90, 'Ready', 'High'),
    item(91, 'Ready', 'Low', { body: 'Context, and no acceptance.' }),
    item(92, 'Coding', 'Normal'),
    item(93, 'Backlog', 'High'),
  ]);

  const plan = await planOf(fake);

  assert.deepEqual(pulled(plan), [92, 90]);
  assert.deepEqual(fake.writes(), []);
});
