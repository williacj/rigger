// ABOUTME: Tests the fake `gh`, the fake board's face as the forge's command: the commands it
// answers, what the real adapter reads and writes through it, and its refusal of anything else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANSWERED, commandOf, installFakeGh } from './fake-gh.mjs';
import { itemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { schemaWriteSide } from '../src/substrate/forge/schema-write.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the fake `gh` says its board lives: this repository's board, as its config names it. */
const WHERE = { repo: 'williacj/rigger', project: 6 };

/** A fake `gh` holding `board`, installed in a directory of its own. */
const installed = (board = {}) => installFakeGh(mkdtempSync(join(tmpdir(), 'rigger-fake-gh-')), { ...WHERE, board });

/**
 * Runs `use` with the fake `gh`'s directory first on `PATH`, as ruling 1 (U9) places it, so the
 * forge runners' own spawn of `gh` reaches it, and puts `PATH` back after.
 */
async function onPath(fake, use) {
  const held = process.env.PATH;
  process.env.PATH = `${dirname(fake.gh)}${delimiter}${held}`;
  try {
    return await use();
  } finally {
    process.env.PATH = held;
  }
}

/** The columns this repository's config declares, by key. */
const COLUMNS = { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' };

/** The board the real adapter is pointed at, named as a config names it. */
const BOARD = { ...WHERE, columns: COLUMNS };

test('the real adapter reads cards, columns, fields and labels through the fake gh', async () => {
  const fake = installed({
    columns: ['Backlog', 'Ready', 'Coding', 'Review', 'Owner', 'Done'],
    fields: [{ name: 'Priority', options: ['P1', 'P0', 'P2'] }],
    labels: ['type:change', 'type:spec'],
    items: [
      { type: 'issue', repository: 'williacj/rigger', number: 214, title: 'A fake board', body: 'Why.', labels: ['type:change'], column: 'Ready', fieldValues: { Priority: 'P1' } },
      { type: 'issue', repository: 'williacj/rigger', number: 215, title: 'Reads', body: '', labels: [], column: 'Coding' },
    ],
  });

  const read = await onPath(fake, async () => {
    const side = readSide(BOARD);
    return { items: await side.readItems(), columns: await side.readColumns(), fields: await side.readFields(), labels: await side.readLabels() };
  });

  assert.deepEqual(read, {
    items: [
      { id: 'item-1', number: 214, title: 'A fake board', body: 'Why.', labels: ['type:change'], column: 'Ready' },
      { id: 'item-2', number: 215, title: 'Reads', body: '', labels: [], column: 'Coding' },
    ],
    columns: COLUMNS,
    fields: [{ name: 'Priority', options: ['P1', 'P0', 'P2'] }],
    labels: ['type:change', 'type:spec'],
  });
});

test('the fake gh answers a board past one page, and its drafts, pull requests and other repositories\' issues, as GitHub does', async () => {
  // A hundred and one issues span two of the pages the adapter asks for, and the three items that
  // are not cards reach the adapter as GitHub answers them, which is what it leaves out.
  const issues = Array.from({ length: 101 }, (_, i) => ({ type: 'issue', repository: 'williacj/rigger', number: i + 1, title: `Card ${i + 1}`, column: 'Ready' }));
  const fake = installed({
    columns: ['Ready'],
    labels: Array.from({ length: 101 }, (_, i) => `label-${i + 1}`),
    items: [
      { type: 'draftIssue', title: 'A thought', column: 'Ready' },
      { type: 'pullRequest', repository: 'williacj/rigger', number: 900, title: 'A PR', column: 'Ready' },
      { type: 'issue', repository: 'williacj/elsewhere', number: 7, title: 'Theirs', column: 'Ready' },
      ...issues,
    ],
  });

  const { cards, labels } = await onPath(fake, async () => ({ cards: await readSide(BOARD).readItems(), labels: await readSide(BOARD).readLabels() }));

  assert.deepEqual(cards.map((card) => card.number), issues.map((issue) => issue.number));
  assert.equal(cards[0].id, 'item-4');
  assert.equal(labels.length, 101);
  assert.equal(labels.at(-1), 'label-101');
});

/**
 * The card read's facts, read off the model directly: its items that are issues in `repo`, in the
 * model's order, each with the six facts the adapter's card read returns. A card holding no
 * body or labels holds them empty.
 */
async function cardsOf(model, repo) {
  return (await model.operations.readItems())
    .filter((item) => item.type === 'issue' && item.repository === repo)
    .map(({ id, number, title, body = '', labels = [], column }) => ({ id, number, title, body, labels, column }));
}

test("the adapter's card read through the fake gh returns exactly the model's issues from the configured repository, in its order, with their six facts", async () => {
  // Three of this repository's issues in three columns, with a draft, a pull request and another
  // repository's issue among them, so a fake presenting any item as this repository's issue, or
  // answering in another order, gives the adapter a card the model does not hold as one.
  const fake = installed({
    columns: ['Backlog', 'Ready', 'Coding', 'Review', 'Owner', 'Done'],
    fields: [{ name: 'Priority', options: ['P0', 'P1'] }],
    items: [
      { type: 'issue', repository: 'williacj/rigger', number: 215, title: 'Reads', body: '## Acceptance\n\n- "Quoted", and \\ escaped.', labels: ['type:change', 'size:s'], column: 'Coding', fieldValues: { Priority: 'P0' } },
      { type: 'draftIssue', title: 'A thought', column: 'Ready' },
      { type: 'issue', repository: 'williacj/rigger', number: 214, title: 'A fake board', body: 'Why.', labels: ['type:change'], column: 'Ready' },
      { type: 'pullRequest', repository: 'williacj/rigger', number: 275, title: 'A PR', column: 'Review' },
      { type: 'issue', repository: 'williacj/elsewhere', number: 7, title: 'Theirs', column: 'Ready' },
      { type: 'issue', repository: 'williacj/rigger', number: 223, title: 'A fake gh', body: '', labels: [], column: 'Done' },
    ],
  });
  const expected = await cardsOf(await fake.model(), 'williacj/rigger');
  // The projection is not empty and not the whole board, so the comparison below is not vacuous.
  assert.deepEqual(expected.map((card) => card.number), [215, 214, 223]);

  const cards = await onPath(fake, () => readSide(BOARD).readItems());

  assert.deepEqual(cards, expected);
});

test("the adapter's column read through the fake gh returns each declared key mapped to its display name, beside a column the config does not declare", async () => {
  const columns = ['Backlog', ...Object.values(COLUMNS), 'Archive'];
  const fake = installed({ columns });
  // Read off the model: every declared display name is one of its columns, and two are not declared.
  const held = await (await fake.model()).operations.readColumns();
  assert.deepEqual(held, columns);
  assert.deepEqual(held.filter((name) => !Object.values(COLUMNS).includes(name)), ['Backlog', 'Archive']);

  const read = await onPath(fake, () => readSide(BOARD).readColumns());

  assert.deepEqual(read, { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' });
});

test("the adapter's column read through the fake gh fails, naming the key and display name of the declared column the model lacks", async () => {
  // `Owner` is declared and the model does not hold it; `Needs Owner` is a column the config never names.
  const fake = installed({ columns: ['Ready', 'Coding', 'Review', 'Needs Owner', 'Done'] });
  assert.ok(!(await (await fake.model()).operations.readColumns()).includes('Owner'));

  await onPath(fake, () =>
    assert.rejects(readSide(BOARD).readColumns(), (error) => {
      assert.ok(error.message.includes('owner (Owner)'), error.message);
      assert.ok(!/\bready\b|\bcoding\b|\breview\b|\bdone\b/.test(error.message), `a column the model holds is named: ${error.message}`);
      return true;
    }),
  );
});

test("each write the real adapter issues through the fake gh appears in the fake board's write record, in order", async () => {
  const fake = installed({
    columns: ['Ready', 'Coding'],
    items: [
      { type: 'issue', repository: 'williacj/rigger', number: 214, title: 'Moved', column: 'Ready' },
      { type: 'issue', repository: 'williacj/rigger', number: 215, title: 'Left', column: 'Ready' },
    ],
  });

  await onPath(fake, async () => {
    await itemWriteSide(BOARD).moveItem('item-1', 'Coding');
    await schemaWriteSide(BOARD).createField('Priority', ['High', 'Low']);
    await schemaWriteSide(BOARD).createLabel('type:change');
  });

  const model = await fake.model();
  assert.deepEqual(model.writes(), [
    { operation: 'moveItem', args: ['item-1', 'Coding'] },
    { operation: 'createField', args: ['Priority', ['High', 'Low']] },
    { operation: 'createLabel', args: ['type:change'] },
  ]);
  assert.deepEqual((await model.operations.readItems()).map((item) => item.column), ['Coding', 'Ready']);
});

/**
 * The tests of #215 (M1-02), the board reads, of #216 (M1-03), the adapter's sides and runners, and
 * of #224 (M1-24), the priority read, whose recorded-answer tests are among the board reads'.
 */
const ADAPTER_TESTS = ['forge-read.test.mjs', 'forge-adapter.test.mjs', 'forge-runners.test.mjs', 'forge-priority.test.mjs'];

/**
 * The arguments of every `gh` request the forge adapter issues while `file` runs, recorded by
 * running it under `gh-recording.mjs`, which writes what it recorded to the path it is given.
 */
function commandsIssuedBy(file) {
  const into = join(mkdtempSync(join(tmpdir(), 'rigger-gh-recording-')), 'requests.json');
  // Run as a test run of its own: a child inheriting `NODE_TEST_CONTEXT` reports to this run's
  // runner instead, in a form only that runner reads.
  const { NODE_TEST_CONTEXT, ...env } = gitEnvironment();
  const run = spawnSync(process.execPath, ['--import', join(HERE, 'gh-recording.mjs'), '--test-reporter=tap', join(HERE, file), into], {
    encoding: 'utf8',
    env,
  });
  const passed = Number(/^# pass (\d+)$/m.exec(run.stdout)?.[1] ?? 0);
  assert.ok(run.status === 0 && passed > 0, `${file} did not run and pass while it was recorded:\n${run.stdout}${run.stderr}`);
  return JSON.parse(readFileSync(into, 'utf8'));
}

test('the gh commands the fake gh answers are the ones the adapter issues across its own tests, compared both ways', () => {
  // Recorded rather than listed: each file runs as it does in the suite, and every request the
  // adapter's read, item-write and schema-write sides hand a runner is kept, with the item-write
  // runner's own read. A runner sends every request as `gh` (`R-SAFE-2`), so a request is its
  // arguments. What a test hands a runner itself is the test's command, not the adapter's, and
  // is not recorded.
  const issued = new Set(ADAPTER_TESTS.flatMap(commandsIssuedBy).map(commandOf));
  assert.ok(issued.size >= 5, `only ${issued.size} commands were recorded, so the recording read the wrong thing`);

  assert.deepEqual([...issued].filter((command) => !ANSWERED.includes(command)), [], 'the adapter issues a command the fake gh does not answer');
  assert.deepEqual(ANSWERED.filter((command) => !issued.has(command)), [], 'the fake gh answers a command the adapter never issues');
});

test('no file under src/ names the fake gh or its recording, and the fake gh reads no environment variable', () => {
  // Nothing selects the fake but `PATH`, which the test sets (ruling 1, U9). The pattern is
  // checked against this file first, which names both, so it cannot pass having matched nothing.
  const namesFake = /fake-gh|fake `?gh|gh-recording/;
  assert.match(readFileSync(fileURLToPath(import.meta.url), 'utf8'), namesFake);

  const src = join(HERE, '..', 'src');
  const files = readdirSync(src, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name));
  assert.ok(files.length > 0, 'found no file under src/, so it could have found no mention');
  assert.deepEqual(files.filter((file) => namesFake.test(readFileSync(file, 'utf8'))), []);

  assert.doesNotMatch(readFileSync(join(HERE, 'fake-gh.mjs'), 'utf8'), /process\.env|\benv\b/);
});

test('given a gh command it does not model, the fake gh exits non-zero and prints the command', () => {
  const fake = installed({ columns: ['Ready'] });
  const unmodelled = [
    ['issue', 'close', '214'],
    ['auth', 'status'],
    ['api', 'graphql', '-f', 'query=query { viewer { login } }'],
    ['api', 'repos/williacj/rigger/labels', '-X', 'GET'],
  ];

  for (const args of unmodelled) {
    // Spawned as the forge runners spawn `gh`, in the environment a git child is given.
    const said = spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });

    assert.notEqual(said.status, 0, `the fake gh answered ${args.join(' ')}`);
    assert.ok(said.stderr.includes(`gh ${args.join(' ')}`), `the fake gh did not print the command: ${said.stderr}`);
    assert.equal(said.stdout, '');
  }
});
