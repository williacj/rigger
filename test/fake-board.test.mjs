// ABOUTME: Tests the fake board every M1 scheduling behaviour is proven against: what it holds
// and reads back, how it moves a card, what it records of each write, and its sample calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { createFakeBoard, sampleBoard, sampleCalls } from './fake-board.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

test('a move to a column the board lacks is refused, naming the column, and no card moves', async () => {
  const fake = threeCards();
  const [, two] = await fake.operations.readItems();

  await assert.rejects(fake.operations.moveItem(two.id, 'Shipped'), /Shipped/);

  assert.deepEqual(await columnsByNumber(fake), { 1: 'Ready', 2: 'Coding', 3: 'Review' });
  assert.deepEqual(fake.writes(), [], 'a refused move wrote nothing, so it is not recorded');
});

test('the board records each write in the order it was made', async () => {
  const fake = threeCards();

  await fake.operations.moveItem('item-1', 'Coding');
  await fake.operations.createColumn('Owner');
  await fake.operations.createField('Priority', ['P0', 'P1', 'P2']);
  await fake.operations.createLabel('type:change');

  assert.deepEqual(fake.writes(), [
    { operation: 'moveItem', args: ['item-1', 'Coding'] },
    { operation: 'createColumn', args: ['Owner'] },
    { operation: 'createField', args: ['Priority', ['P0', 'P1', 'P2']] },
    { operation: 'createLabel', args: ['type:change'] },
  ]);
});

test('a board that has only been read has an empty write record', async () => {
  const fake = threeCards();

  await fake.operations.readItems();
  await fake.operations.readColumns();
  await fake.operations.readFields();
  await fake.operations.readLabels();

  assert.deepEqual(fake.writes(), []);
});

test('an item fact the fake board does not model is refused, naming it', () => {
  // The board holds forge facts only. A card's linked pull request is found by the topic rule
  // and a verdict by the gate, neither of which is the board's, so a fixture handing the fake
  // either is told so rather than having it silently held or silently dropped.
  for (const fact of ['linkedPullRequest', 'verdict']) {
    const item = { type: 'issue', repository: 'williacj/rigger', number: 9, column: 'Ready', [fact]: 1 };
    assert.throws(() => createFakeBoard({ columns: ['Ready'], items: [item] }), new RegExp(fact));
  }
});

/** A promise's outcome, readable without awaiting it, so a test can see a read still pending. */
function watched(promise) {
  const outcome = { settled: false, value: undefined };
  outcome.done = promise.then((value) => Object.assign(outcome, { settled: true, value }));
  return outcome;
}

test('a held read stays unresolved while a second read starts, and the test releases them in its own order', async () => {
  const fake = threeCards();

  const releaseFirst = fake.holdNextRead();
  const first = watched(fake.operations.readItems());
  const releaseSecond = fake.holdNextRead();
  const second = watched(fake.operations.readColumns());

  // The second read is released first. The first is still held after the second has answered,
  // and it answers with the board as it stands when released, so a move made while it was held
  // shows in what it returns.
  releaseSecond();
  await second.done;
  assert.deepEqual(second.value, ['Ready', 'Coding', 'Review']);
  assert.equal(first.settled, false, 'the first read answered before the test released it');

  await fake.operations.moveItem('item-1', 'Review');
  releaseFirst();
  await first.done;
  assert.deepEqual(
    first.value.map((item) => item.column),
    ['Review', 'Coding', 'Review'],
  );
});

test('no file under src/ imports the fake board', () => {
  // Any mention of the module's name counts, whatever the path or import form around it. The
  // pattern is checked against this file first, which does import the fake, so a pattern that
  // matched nothing could not pass the test vacuously.
  const importsFake = /fake-board/;
  assert.match(readFileSync(fileURLToPath(import.meta.url), 'utf8'), importsFake);

  const src = join(root, 'src');
  const files = readdirSync(src, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name));
  assert.ok(files.length > 0, 'found no file under src/, so it could have found no importer');

  const importers = files.filter((file) => importsFake.test(readFileSync(file, 'utf8')));
  assert.deepEqual(importers, []);
});

// The operations are whatever the fake offers, read off it rather than listed here, so an
// operation added to the fake is checked with no edit to this file.
const operationNames = () => Object.keys(sampleBoard().operations);

test('every operation the fake board offers carries a sample call', () => {
  const lacking = operationNames().filter((name) => !Object.hasOwn(sampleCalls, name));
  assert.deepEqual(lacking, [], `operations with no sample call: ${lacking.join(', ')}`);
});

function callSample(fake, name) {
  assert.ok(Object.hasOwn(sampleCalls, name), `${name} has no sample call`);
  return fake.operations[name](...structuredClone(sampleCalls[name]));
}

test("every write's sample call changes what a read of the board returns", async () => {
  // A write is an operation whose sample call adds to the write record; every other operation is
  // a read, and the board as read is what all of them return.
  const writes = [];
  const reads = [];
  for (const name of operationNames()) {
    const fake = sampleBoard();
    await callSample(fake, name);
    (fake.writes().length > 0 ? writes : reads).push(name);
  }
  assert.ok(writes.length > 0 && reads.length > 0, 'found no writes or no reads to compare');

  const readAll = (fake) => Promise.all(reads.map((name) => callSample(fake, name)));
  const unchanged = [];
  for (const name of writes) {
    const fake = sampleBoard();
    const before = await readAll(fake);
    await callSample(fake, name);
    if (isDeepStrictEqual(before, await readAll(fake))) unchanged.push(name);
  }
  assert.deepEqual(unchanged, [], `writes whose sample call left the board unchanged: ${unchanged.join(', ')}`);
});
