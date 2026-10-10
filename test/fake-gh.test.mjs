// ABOUTME: Tests the fake `gh`, the fake board's face as the forge's command: the commands it
// answers, what the real adapter reads and writes through it, and its refusal of anything else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANSWERED, commandOf, installFakeGh } from './fake-gh.mjs';
import { UNKILLED } from './process-fixtures.mjs';
import { itemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { schemaWriteRunner } from '../src/substrate/forge/runners.mjs';
import { schemaWriteSide } from '../src/substrate/forge/schema-write.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { AGENT_ANSWERED, seedRepository } from './fake-gh.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { clonedFromOrigin, gitIn } from './git-repository.mjs';
import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { repositoryWriteSide } from '../src/substrate/forge/repository-write.mjs';
import { writeFileSync } from 'node:fs';
import { temporaryDirectory } from './temporary-directory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the fake `gh` says its board lives: this repository's board, as its config names it. */
const WHERE = { repo: 'williacj/rigger', project: 6 };

/** A fake `gh` holding `board`, installed in a directory of its own. */
const installed = (board = {}) => installFakeGh(temporaryDirectory('rigger-fake-gh-'), { ...WHERE, board });

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
    const side = readSide(BOARD, { emitter: UNKILLED });
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

test('the repository read answers a pull request mergeable state through the fake gh', async () => {
  const fake = installed();
  seedRepository(fake, { pullRequests: [{ number: 12, head: 'topic', sha: 'a'.repeat(40) }], mergeable: { 12: 'MERGEABLE' } });

  const state = await onPath(fake, () => repositoryReads(BOARD, { emitter: UNKILLED }).readMergeable(12));

  assert.equal(state, 'mergeable');
});

test('the repository read answers comment identity, author permission and edit, reading one author once', async () => {
  const fake = installed();
  seedRepository(fake, {
    pullRequests: [{ number: 12, head: 'topic', sha: 'a'.repeat(40), comments: [
      { id: 'IC_1', body: 'one', createdAt: '2026-10-09T10:00:00Z', author: { login: 'alex' }, lastEditedAt: null, includesCreatedEdit: false },
      { id: 'IC_2', body: 'two', createdAt: '2026-10-09T10:01:00Z', author: { login: 'alex' }, lastEditedAt: '2026-10-09T11:00:00Z', includesCreatedEdit: true },
    ] }],
    permissions: { alex: 'maintain' },
  });

  const comments = await onPath(fake, () => repositoryReads(BOARD, { emitter: UNKILLED }).readComments(12));

  assert.deepEqual(comments, [
    { body: 'one', createdAt: '2026-10-09T10:00:00Z', id: 'IC_1', author: 'alex', permission: 'maintain', edited: false },
    { body: 'two', createdAt: '2026-10-09T10:01:00Z', id: 'IC_2', author: 'alex', permission: 'maintain', edited: true },
  ]);
  assert.equal(fake.sent().filter((args) => args[1]?.includes('/collaborators/alex/permission')).length, 1);
});

test('a completed successful check run answers passed through the fake forge', async () => {
  const fake = installed();
  const sha = 'a'.repeat(40);
  seedRepository(fake, { checks: { [sha]: [{ name: 'ci', status: 'completed', conclusion: 'success', app: { id: 15368 } }] } });

  const states = await onPath(fake, () => repositoryReads(BOARD, { emitter: UNKILLED }).readCheckStates(sha, [{ context: 'ci', integration_id: 15368 }]));

  assert.deepEqual(states, { ci: { state: 'passed', creator: null } });
});

test('active ruleset checks answer as the branch effective rules through the fake forge', async () => {
  const fake = installed();
  seedRepository(fake, { rules: { main: [{ type: 'required_status_checks', enforcement: 'active', parameters: { required_status_checks: [{ context: 'ci', integration_id: 15368 }] } }] } });

  const rules = await onPath(fake, () => repositoryReads(BOARD, { emitter: UNKILLED }).readEffectiveRules('main'));

  assert.deepEqual(rules, [{ context: 'ci', integration_id: 15368 }]);
});

test('repository-write merges a pull request at the handed head by merge commit', async () => {
  const fake = installed();
  const sha = 'a'.repeat(40);
  seedRepository(fake, { mainSha: 'b'.repeat(40), pullRequests: [{ number: 12, head: 'topic', sha }] });

  const answer = await onPath(fake, () => repositoryWriteSide(BOARD, { emitter: UNKILLED }).mergePullRequest(12, sha));

  assert.deepEqual(answer, { outcome: 'merged', sha: 'm'.repeat(40) });
  const held = JSON.parse(readFileSync(join(dirname(fake.gh), 'board.json'), 'utf8')).repository;
  assert.equal(held.mainSha, 'm'.repeat(40));
  assert.equal(held.pullRequests[0].merged, true);
  assert.deepEqual(fake.sent().find((args) => args[1]?.endsWith('/merge')), ['api', 'repos/williacj/rigger/pulls/12/merge', '-X', 'PUT', '-f', `sha=${sha}`, '-f', 'merge_method=merge']);
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

  const { cards, labels } = await onPath(fake, async () => ({ cards: await readSide(BOARD, { emitter: UNKILLED }).readItems(), labels: await readSide(BOARD, { emitter: UNKILLED }).readLabels() }));

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

  const cards = await onPath(fake, () => readSide(BOARD, { emitter: UNKILLED }).readItems());

  assert.deepEqual(cards, expected);
});

test("the adapter's column read through the fake gh returns each declared key mapped to its display name, beside a column the config does not declare", async () => {
  const columns = ['Backlog', ...Object.values(COLUMNS), 'Archive'];
  const fake = installed({ columns });
  // Read off the model: every declared display name is one of its columns, and two are not declared.
  const held = await (await fake.model()).operations.readColumns();
  assert.deepEqual(held, columns);
  assert.deepEqual(held.filter((name) => !Object.values(COLUMNS).includes(name)), ['Backlog', 'Archive']);

  const read = await onPath(fake, () => readSide(BOARD, { emitter: UNKILLED }).readColumns());

  assert.deepEqual(read, { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' });
});

test("the adapter's column read through the fake gh fails, naming the key and display name of the declared column the model lacks", async () => {
  // `Owner` is declared and the model does not hold it; `Needs Owner` is a column the config never names.
  const fake = installed({ columns: ['Ready', 'Coding', 'Review', 'Needs Owner', 'Done'] });
  assert.ok(!(await (await fake.model()).operations.readColumns()).includes('Owner'));

  await onPath(fake, () =>
    assert.rejects(readSide(BOARD, { emitter: UNKILLED }).readColumns(), (error) => {
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
    await itemWriteSide(BOARD).moveItem('item-1', 'Coding', UNKILLED);
    await schemaWriteSide(BOARD, { emitter: UNKILLED }).createField('Priority', ['High', 'Low']);
    await schemaWriteSide(BOARD, { emitter: UNKILLED }).createColumn('Owner');
    await schemaWriteSide(BOARD, { emitter: UNKILLED }).createLabel('type:change');
  });

  const model = await fake.model();
  assert.deepEqual(model.writes(), [
    { operation: 'moveItem', args: ['item-1', 'Coding'] },
    { operation: 'createField', args: ['Priority', ['High', 'Low']] },
    { operation: 'createColumn', args: ['Owner'] },
    { operation: 'createLabel', args: ['type:change'] },
  ]);
  assert.deepEqual((await model.operations.readItems()).map((item) => item.column), ['Coding', 'Ready']);
  assert.deepEqual(await model.operations.readColumns(), ['Ready', 'Coding', 'Owner']);
});

test('adding a column through the fake gh keeps every card in its column, and a card can then be moved to the new one', async () => {
  const fake = installed({
    columns: ['Ready', 'Coding', 'Review'],
    items: [
      { type: 'issue', repository: 'williacj/rigger', number: 214, title: 'One', column: 'Ready' },
      { type: 'issue', repository: 'williacj/rigger', number: 215, title: 'Two', column: 'Coding' },
      { type: 'issue', repository: 'williacj/rigger', number: 216, title: 'Three', column: 'Review' },
    ],
  });

  const { before, after } = await onPath(fake, async () => {
    const read = async () => (await readSide(BOARD, { emitter: UNKILLED }).readItems()).map(({ number, column }) => [number, column]);
    const held = await read();
    await schemaWriteSide(BOARD, { emitter: UNKILLED }).createColumn('Owner');
    await itemWriteSide(BOARD).moveItem('item-3', 'Owner', UNKILLED);
    return { before: held, after: await read() };
  });

  assert.deepEqual(before, [[214, 'Ready'], [215, 'Coding'], [216, 'Review']]);
  assert.deepEqual(after, [[214, 'Ready'], [215, 'Coding'], [216, 'Owner']]);
});

test('the fake gh does not model an options write that leaves out a held option or its id, and changes nothing', () => {
  // The schema-write runner refuses these before they are sent, so a real adapter never sends
  // one. Way C cleared every item's column on GitHub, which the fake board has no way to hold, so
  // the fake gh fails rather than answer as if the write were harmless.
  const fake = installed({ columns: ['Ready', 'Coding'] });
  const wayC = 'mutation { updateProjectV2Field(input: {fieldId: "PVTSSF_Status", singleSelectOptions: [{name: "Ready", color: GRAY, description: ""}, {name: "Coding", color: GRAY, description: ""}, {name: "Owner", color: GRAY, description: ""}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }';

  const said = spawnSync(fake.gh, ['api', 'graphql', '-f', `query=${wayC}`], { encoding: 'utf8', env: gitEnvironment() });

  assert.notEqual(said.status, 0);
  assert.match(said.stderr, /does not model/);
  assert.equal(said.stdout, '');
});

test('the fake gh does not model an options write that changes a held option\'s name, colour or description, or adds none', async () => {
  // Way B echoes every held option as the field holds it, which the fake answers as the neutral
  // grey with no description, and adds one. Anything else would change the board in a way the
  // fake board cannot hold, so the fake gh fails rather than answer it as a harmless add.
  const fake = installed({ columns: ['Ready', 'Coding'] });
  const update = (ready) => `mutation { updateProjectV2Field(input: {fieldId: "PVTSSF_Status", singleSelectOptions: [${ready}, {id: "option-1", name: "Coding", color: GRAY, description: ""}, {name: "Owner", color: GRAY, description: ""}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }`;
  const changed = [
    update('{id: "option-0", name: "Queued", color: GRAY, description: ""}'),
    update('{id: "option-0", name: "Ready", color: RED, description: ""}'),
    update('{id: "option-0", name: "Ready", color: GRAY, description: "Waiting"}'),
    update('{id: "option-0", name: "Ready", color: GRAY, description: ""}').replace(', {name: "Owner", color: GRAY, description: ""}', ''),
  ];
  // The way B request itself, which differs from each above only in what they change, is answered.
  const wayB = update('{id: "option-0", name: "Ready", color: GRAY, description: ""}');

  for (const document of changed) {
    assert.notEqual(document, wayB);
    const said = spawnSync(fake.gh, ['api', 'graphql', '-f', `query=${document}`], { encoding: 'utf8', env: gitEnvironment() });
    assert.notEqual(said.status, 0, document);
    assert.match(said.stderr, /does not model/);
    assert.equal(said.stdout, '');
  }
  assert.deepEqual(await (await fake.model()).operations.readColumns(), ['Ready', 'Coding']);

  const said = spawnSync(fake.gh, ['api', 'graphql', '-f', `query=${wayB}`], { encoding: 'utf8', env: gitEnvironment() });
  assert.equal(said.status, 0, said.stderr);
  assert.deepEqual(await (await fake.model()).operations.readColumns(), ['Ready', 'Coding', 'Owner']);
});

/**
 * The tests of #215 (M1-02), the board reads; of #216 (M1-03), the adapter's sides and runners;
 * of #284, the board each operation addresses; of #217 (M1-29), adding a column, which are among
 * the three before it; of #224 (M1-24), the priority read, whose recorded-answer tests are among
 * the board reads'; and of #289, the report of the other repositories a board holds.
 */
const ADAPTER_TESTS = ['forge-read.test.mjs', 'forge-adapter.test.mjs', 'forge-runners.test.mjs', 'forge-board-owner.test.mjs', 'forge-priority.test.mjs', 'forge-board-sharing.test.mjs'];

/**
 * The arguments of every `gh` request the forge adapter issues while `file` runs, recorded by
 * running it under `gh-recording.mjs`, which writes what it recorded to the path it is given.
 */
function commandsIssuedBy(file) {
  const into = join(temporaryDirectory('rigger-gh-recording-'), 'requests.json');
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

test('a schema write whose option colour is no value of the enum is refused at the schema-write side, and the fake gh is run with nothing', async () => {
  // The runner's own spawn, not a stand-in: the fake gh on PATH records every command it is run
  // with, so a write refused only after it went, or after a read went ahead of it, shows here.
  const fake = installed({ columns: ['Ready'] });
  const create = (colour) => `mutation { createProjectV2Field(input: {projectId: "PVT_fake", dataType: SINGLE_SELECT, name: "Priority", singleSelectOptions: [{name: "High", color: ${colour}, description: ""}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }`;
  const add = (colour) => `mutation { updateProjectV2Field(input: {fieldId: "PVTSSF_Status", singleSelectOptions: [{id: "option-0", name: "Ready", color: GRAY, description: ""}, {name: "Owner", color: ${colour}, description: ""}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }`;

  await onPath(fake, async () => {
    for (const colour of ['null', '5', 'true', 'NOT_A_COLOUR', '"GRAY"', 'gray']) {
      for (const document of [create(colour), add(colour)]) {
        await assert.rejects(schemaWriteRunner(['api', 'graphql', '-f', `query=${document}`], { emitter: UNKILLED }), /color/, document);
      }
    }
  });

  assert.deepEqual(fake.sent(), []);
  assert.deepEqual((await fake.model()).writes(), []);
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

test('given a board owner, the fake gh holds its board under that owner and answers no board under the repository\'s owner', async () => {
  const fake = installFakeGh(temporaryDirectory('rigger-fake-gh-'), { ...WHERE, owner: 'octo-org', board: { columns: Object.values(COLUMNS) } });

  const declared = await onPath(fake, () => readSide({ ...BOARD, owner: 'octo-org' }, { emitter: UNKILLED }).readColumns());
  assert.deepEqual(declared, COLUMNS);

  await onPath(fake, () =>
    assert.rejects(readSide(BOARD, { emitter: UNKILLED }).readColumns(), (error) => {
      assert.ok(error.message.includes('Could not resolve to a ProjectV2 with the number 6'), error.message);
      return true;
    }),
  );
});

/** A head commit a seeded pull request is given, distinct for each `n`. */
const sha = (n) => String(n).padStart(40, 'a');

/** The repository reads, pointed at the board the fake `gh` holds, sent through its runner's own spawn. */
const reads = () => repositoryReads(BOARD, { emitter: UNKILLED });

/** The cards a board holds for the repository tests below. */
const CARDS = [
  { type: 'issue', repository: 'williacj/rigger', number: 214, title: 'One', column: 'Review' },
  { type: 'issue', repository: 'williacj/rigger', number: 215, title: 'Two', column: 'Coding' },
];

test("a fake gh seeded with nothing answers no branch, no pull request and no edit for any card, and no pull request's comments", async () => {
  const fake = installed({ columns: ['Coding', 'Review'], items: CARDS });

  await onPath(fake, async () => {
    for (const { number } of CARDS) {
      assert.deepEqual(await reads().readPullRequests(`rigger-${number}`), { open: [], merged: [] });
      assert.equal(await reads().readEditedAt(number), null);
    }
    assert.deepEqual(await reads().readBranches(['rigger-214', 'rigger-215']), { 'rigger-214': false, 'rigger-215': false });
    await assert.rejects(reads().readComments(1), /Could not resolve to a PullRequest with the number of 1/);
  });
});

test("the repository reads through the fake gh answer a card's seeded branch, open and merged pull requests, and its issue's edit time", async () => {
  const fake = installed({ columns: ['Coding', 'Review'], items: CARDS });
  seedRepository(fake, {
    branches: ['rigger-214'],
    pullRequests: [
      { number: 301, head: 'rigger-214', sha: sha(301) },
      { number: 302, head: 'rigger-214', sha: sha(302), base: 'release' },
      { number: 299, head: 'rigger-215', sha: sha(299), merged: true },
      { number: 303, head: 'rigger-214', sha: sha(303), from: 'someone/rigger' },
    ],
    edited: { 214: '2026-10-01T09:30:00Z' },
  });

  await onPath(fake, async () => {
    assert.deepEqual(await reads().readPullRequests('rigger-214'), { open: [{ number: 301, head: sha(301), base: 'main' }, { number: 302, head: sha(302), base: 'release' }], merged: [] });
    assert.deepEqual(await reads().readPullRequests('rigger-215'), { open: [], merged: [{ number: 299, head: sha(299), base: 'main' }] });
    assert.deepEqual(await reads().readBranches(['rigger-214', 'rigger-215']), { 'rigger-214': true, 'rigger-215': false });
    assert.equal(await reads().readEditedAt(214), '2026-10-01T09:30:00Z');
    assert.equal(await reads().readEditedAt(215), null);
    await assert.rejects(reads().readEditedAt(216), /readEditedAt.*issue #216.*Could not resolve to an Issue with the number of 216/);
  });
});

test("the repository reads through the fake gh answer a seeded pull request's diff byte for byte, its merge base, and its comments across pages", async () => {
  const diff = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-é\n+"\\\n\\ No newline at end of file';
  const comments = Array.from({ length: 101 }, (_, i) => ({ body: `Finding ${i}`, createdAt: '2026-10-01T09:30:00Z' }));
  const fake = installed({ columns: ['Review'], items: CARDS });
  seedRepository(fake, { pullRequests: [{ number: 301, head: 'rigger-214', sha: sha(301), diff, mergeBase: sha(1), comments }] });

  await onPath(fake, async () => {
    assert.equal(Buffer.compare(Buffer.from(await reads().readDiff(301)), Buffer.from(diff)), 0);
    assert.deepEqual(await reads().readMergeBase(301), { base: 'main', head: sha(301), mergeBase: sha(1) });
    assert.deepEqual((await reads().readComments(301)).map(({ body, createdAt }) => ({ body, createdAt })), comments);
  });
});

test('a diff the fake gh declines to serve is rejected by the repository read, naming the pull request and the reason', async () => {
  const fake = installed({ columns: ['Review'], items: CARDS });
  seedRepository(fake, { pullRequests: [{ number: 301, head: 'rigger-214', sha: sha(301), declined: 'Sorry, the diff exceeded the maximum number of lines (20000)' }] });

  await onPath(fake, () => assert.rejects(reads().readDiff(301), /pull request #301.*Sorry, the diff exceeded the maximum number of lines \(20000\) \(HTTP 406\)/));
  await onPath(fake, () => assert.rejects(reads().readDiff(302), /pull request #302.*Not Found \(HTTP 404\)/));
});

test("the fake repository's reads are exactly the repository read side's, compared both ways", () => {
  // In-process worlds stand the fake repository in for the read side, so each must offer what the other does.
  const fake = Object.keys(createFakeRepository().operations);
  const adapter = Object.keys(repositoryReads(BOARD));

  assert.ok(fake.length > 0);
  assert.deepEqual(adapter.filter((name) => !fake.includes(name)), []);
  assert.deepEqual(fake.filter((name) => !adapter.includes(name)), []);
});

test('the fake repository answers in process what the fake gh answers for the same seed', async () => {
  const seed = {
    branches: ['rigger-214'],
    pullRequests: [{ number: 301, head: 'rigger-214', sha: sha(301), diff: 'd', mergeBase: sha(1), comments: [{ body: 'x', createdAt: '2026-10-01T09:30:00Z' }] }, { number: 299, head: 'rigger-214', sha: sha(299), merged: true }],
    edited: { 214: '2026-10-01T09:30:00Z' },
  };
  const fake = installed({ columns: ['Review'], items: CARDS });
  seedRepository(fake, seed);
  const calls = [['readPullRequests', 'rigger-214'], ['readBranches', ['rigger-214', 'rigger-216']], ['readEditedAt', 214], ['readDiff', 301], ['readMergeBase', 301], ['readComments', 301]];

  const { operations } = createFakeRepository(seed);
  for (const [name, argument] of calls) {
    assert.deepEqual(await onPath(fake, () => reads()[name](argument)), await operations[name](argument), name);
  }
});

test('the agent commands the fake gh answers are gh pr create, comment, view and diff, and none is among the adapter commands it answers', () => {
  assert.deepEqual([...AGENT_ANSWERED].sort(), ['comment', 'create', 'diff', 'view']);
  assert.deepEqual(ANSWERED.filter((command) => command.startsWith('gh pr ')), []);
});

/**
 * A fake `gh` over a local `origin` holding `main` and a branch `rigger-214` one commit past it,
 * with a clone checked out on that branch, where an agent would run `gh`.
 */
function withPushedBranch() {
  const { origin, repository } = clonedFromOrigin(temporaryDirectory('rigger-fake-gh-origin-'));
  gitIn(repository, 'switch', '--quiet', '-c', 'rigger-214');
  writeFileSync(join(repository, 'README'), 'two\n');
  gitIn(repository, 'commit', '--quiet', '-am', 'Two');
  gitIn(repository, 'push', '--quiet', 'origin', 'rigger-214');
  const fake = installFakeGh(temporaryDirectory('rigger-fake-gh-'), { ...WHERE, board: { columns: ['Review'], items: CARDS }, origin });
  const ran = (...args) => spawnSync(fake.gh, args, { encoding: 'utf8', cwd: repository, env: gitEnvironment() });
  return { origin, repository, fake, ran, head: gitIn(repository, 'rev-parse', 'HEAD').trim(), main: gitIn(repository, 'rev-parse', 'main').trim() };
}

test("gh pr create on the fake gh opens a pull request from a branch the local origin holds, at that branch's head, which the repository reads then see", async () => {
  const { fake, ran, head, main, origin } = withPushedBranch();

  const said = ran('pr', 'create', '--title', 'Two', '--body', 'Why.');

  assert.equal(said.status, 0, said.stderr);
  assert.equal(said.stdout, 'https://github.com/williacj/rigger/pull/216\n');
  const expectedDiff = gitIn(origin, 'diff', main, head);
  await onPath(fake, async () => {
    assert.deepEqual(await reads().readPullRequests('rigger-214'), { open: [{ number: 216, head, base: 'main' }], merged: [] });
    assert.deepEqual(await reads().readBranches(['rigger-214', 'main', 'rigger-215']), { 'rigger-214': true, main: true, 'rigger-215': false });
    assert.equal(await reads().readDiff(216), expectedDiff);
    assert.deepEqual(await reads().readMergeBase(216), { base: 'main', head, mergeBase: main });
  });
  assert.ok(expectedDiff.includes('+two'), expectedDiff);
});

test('gh pr create on the fake gh refuses a branch the local origin does not hold, and a second pull request from the same branch, and opens nothing', async () => {
  const { fake, ran } = withPushedBranch();

  const unpushed = ran('pr', 'create', '--head', 'rigger-215', '--title', 'T', '--body', 'B');
  assert.notEqual(unpushed.status, 0);
  assert.match(unpushed.stderr, /push/);
  assert.equal(ran('pr', 'create', '--title', 'T', '--body', 'B').status, 0);
  const twice = ran('pr', 'create', '--head', 'rigger-214', '--title', 'T', '--body', 'B');
  assert.notEqual(twice.status, 0);
  assert.match(twice.stderr, /already exists/);

  await onPath(fake, async () => {
    assert.deepEqual((await reads().readPullRequests('rigger-214')).open.map(({ number }) => number), [216]);
    assert.deepEqual(await reads().readPullRequests('rigger-215'), { open: [], merged: [] });
  });
});

test("gh pr comment on the fake gh records the comment, which the repository read then answers with its time", async () => {
  const { fake, ran } = withPushedBranch();
  ran('pr', 'create', '--title', 'T', '--body', 'B');
  const before = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const by = ran('pr', 'comment', '216', '--body', '## Findings\n\n- None.');
  const current = ran('pr', 'comment', '--body-file', '-', '--repo', 'williacj/rigger');

  assert.equal(by.status, 0, by.stderr);
  assert.equal(by.stdout, 'https://github.com/williacj/rigger/pull/216#issuecomment-1\n');
  assert.equal(current.status, 0, current.stderr);
  const comments = await onPath(fake, () => reads().readComments(216));
  assert.deepEqual(comments.map(({ body }) => body), ['## Findings\n\n- None.', '']);
  for (const { createdAt } of comments) {
    assert.match(createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.ok(createdAt >= before, `${createdAt} is before the comment was made`);
  }
});

test('gh pr view and gh pr diff on the fake gh print a pull request as gh prints it to a reader that is not a terminal', async () => {
  const { ran, head, origin, main } = withPushedBranch();
  ran('pr', 'create', '--title', 'Two', '--body', 'Why.');

  const viewed = ran('pr', 'view', '216');
  const json = ran('pr', 'view', 'rigger-214', '--json', 'state,number,headRefOid');
  const diff = ran('pr', 'diff');

  assert.equal(viewed.status, 0, viewed.stderr);
  assert.equal(viewed.stdout, 'title:\tTwo\nstate:\tOPEN\nauthor:\trigger-fake\nlabels:\t\nassignees:\t\nreviewers:\t\nprojects:\t\nmilestone:\t\nnumber:\t216\nurl:\thttps://github.com/williacj/rigger/pull/216\nadditions:\t1\ndeletions:\t1\nauto-merge:\tdisabled\n--\nWhy.\n');
  assert.equal(json.stdout, `{"headRefOid":"${head}","number":216,"state":"OPEN"}\n`);
  assert.equal(ran('pr', 'view', 'https://github.com/williacj/rigger/pull/216', '--json', 'number').stdout, '{"number":216}\n');
  assert.equal(diff.stdout, gitIn(origin, 'diff', main, head));
  const missing = ran('pr', 'view', '999');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Could not resolve to a PullRequest with the number of 999/);
});

test('an agent command the fake gh does not model fails, printing itself, and changes nothing', async () => {
  const { fake, ran } = withPushedBranch();
  for (const args of [['pr', 'merge', '216'], ['pr', 'create', '--title', 'T', '--body', 'B', '--reviewer', 'x'], ['pr', 'view', '--json', 'author'], ['pr', 'comment', '216', '--body', 'x', '--repo', 'someone/else']]) {
    const said = ran(...args);
    assert.notEqual(said.status, 0, args.join(' '));
    assert.ok(said.stderr.includes(`gh ${args.join(' ')}`), said.stderr);
  }
  await onPath(fake, async () => assert.deepEqual(await reads().readPullRequests('rigger-214'), { open: [], merged: [] }));
});
