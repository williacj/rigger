// ABOUTME: Tests the fake board every M1 scheduling behaviour is proven against: what it holds
// and reads back, how it moves a card, what it records of each write, and its sample calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBoard } from './fake-board.mjs';

test('a card reads back with its number, title, body, labels, column and priority value unchanged', async () => {
  const card = {
    type: 'issue',
    repository: 'williacj/rigger',
    number: 214,
    title: 'A fake board every M1 behaviour can be proven against',
    body: '## Acceptance\n\n- A test builds a fake board.',
    labels: ['type:change', 'size:s'],
    column: 'Ready',
    fieldValues: { Priority: 'P1' },
  };
  const fake = createFakeBoard({
    columns: ['Ready', 'Coding'],
    fields: [{ name: 'Priority', options: ['P0', 'P1'] }],
    items: [card],
  });

  const [read] = await fake.operations.readItems();

  assert.equal(read.number, 214);
  assert.equal(read.title, 'A fake board every M1 behaviour can be proven against');
  assert.equal(read.body, '## Acceptance\n\n- A test builds a fake board.');
  assert.deepEqual(read.labels, ['type:change', 'size:s']);
  assert.equal(read.column, 'Ready');
  assert.deepEqual(read.fieldValues, { Priority: 'P1' });
});

// Five display names none of which is the one this repository's config gives its column, so a
// fake that answered with the config's names instead of its own could not pass.
const OWN_COLUMNS = ['Up Next', 'Building', 'In Review', 'Needs A Human', 'Shipped'];

test("a board's five columns read back under the names it was given, not the config's", async () => {
  const { default: config } = await import('../rigger.config.mjs');
  const configNames = Object.values(config.board.columns);
  assert.equal(configNames.length, 5, 'the config no longer declares five columns');
  for (const name of OWN_COLUMNS) assert.ok(!configNames.includes(name), `${name} is a config name`);

  const fake = createFakeBoard({ columns: OWN_COLUMNS });

  assert.deepEqual(await fake.operations.readColumns(), OWN_COLUMNS);
});

test('columns the config does not declare read back alongside the declared ones', async () => {
  // Board 6 carries columns Rigger never names, so a fake holding only five could not model it.
  const columns = ['Backlog', 'Ready', 'Coding', 'Blocked', 'Review', 'Owner', 'Done', 'Archive'];
  const fake = createFakeBoard({ columns });

  assert.deepEqual(await fake.operations.readColumns(), columns);
});

test("the priority field's options read back in the order the board gave them", async () => {
  // Neither alphabetical nor reverse-alphabetical, so a fake that sorted them either way fails.
  const options = ['Urgent', 'Low', 'High', 'Medium'];
  const fake = createFakeBoard({ fields: [{ name: 'Priority', options }] });

  assert.deepEqual(await fake.operations.readFields(), [{ name: 'Priority', options }]);
});

test("a draft issue, a pull-request item and another repository's issue read back with their type and repository", async () => {
  // Board 6 holds every one of these beside the repository's own issues, and the adapter that
  // reads it must tell them apart, so the fake has to be able to hold them.
  const items = [
    { type: 'issue', repository: 'williacj/rigger', number: 214, title: 'Ours', column: 'Ready' },
    { type: 'draftIssue', title: 'A thought, not yet an issue', column: 'Ready' },
    { type: 'pullRequest', repository: 'williacj/rigger', number: 242, title: 'A PR', column: 'Review' },
    { type: 'issue', repository: 'williacj/elsewhere', number: 7, title: 'Theirs', column: 'Ready' },
    { type: 'issue', repository: 'williacj/rigger', number: 215, title: 'Ours too', column: 'Coding' },
  ];
  const fake = createFakeBoard({ columns: ['Ready', 'Coding', 'Review'], items });

  const read = await fake.operations.readItems();

  assert.deepEqual(
    read.map(({ type, repository }) => ({ type, repository })),
    [
      { type: 'issue', repository: 'williacj/rigger' },
      { type: 'draftIssue', repository: undefined },
      { type: 'pullRequest', repository: 'williacj/rigger' },
      { type: 'issue', repository: 'williacj/elsewhere' },
      { type: 'issue', repository: 'williacj/rigger' },
    ],
  );
});

/** Three cards of this repository, one per column, in the columns a move can reach. */
function threeCards() {
  return createFakeBoard({
    columns: ['Ready', 'Coding', 'Review'],
    items: [
      { type: 'issue', repository: 'williacj/rigger', number: 1, title: 'one', column: 'Ready' },
      { type: 'issue', repository: 'williacj/rigger', number: 2, title: 'two', column: 'Coding' },
      { type: 'issue', repository: 'williacj/rigger', number: 3, title: 'three', column: 'Review' },
    ],
  });
}

const columnsByNumber = async (fake) =>
  Object.fromEntries((await fake.operations.readItems()).map((item) => [item.number, item.column]));

test("moving one card changes that card's column and no other card's", async () => {
  const fake = threeCards();
  const [, two] = await fake.operations.readItems();

  await fake.operations.moveItem(two.id, 'Review');

  assert.deepEqual(await columnsByNumber(fake), { 1: 'Ready', 2: 'Review', 3: 'Review' });
});
