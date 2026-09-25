// ABOUTME: Tests `rigger setup-board` run as the command, with the fake `gh` first on PATH: what it
// adds to a fake board, what it leaves alone, what it prints, and where it refuses to write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installFakeGh } from './fake-gh.mjs';
import { repositoryIn } from './git-repository.mjs';
import { parseDocument } from '../src/substrate/forge/graphql.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { validate } from '../src/config/validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'src', 'cli', 'rigger.mjs');

/** The repository and board number every config here names, which the fake `gh` answers for. */
const WHERE = { repo: 'octo/widgets', project: 3 };

/** The column display names the config declares, by key, in declaration order. */
const COLUMNS = { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' };

/** The priority field the config declares: its options in an order neither alphabetical nor reversed. */
const PRIORITY = { field: 'Priority', options: ['High', 'Normal', 'Low'] };

/**
 * A config Rigger accepts. Two kinds share `type:change`, a step selects `area:demo`, a step
 * selects nothing, and it declares an epic label, which no kind or step selects.
 */
const CONFIG = {
  repo: WHERE.repo,
  board: { project: WHERE.project, columns: COLUMNS, priority: PRIORITY },
  roles: {
    engineer: { agent: '.claude/agents/engineer.md', provider: 'claude', tier: 'standard' },
    reviewer: { agent: '.claude/agents/reviewer.md', provider: 'claude', tier: 'high' },
  },
  kinds: {
    change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] },
    spec: { select: { labels: ['type:spec', 'type:change'] }, maker: 'engineer', judges: ['reviewer'] },
  },
  epicLabel: 'type:epic',
  provisioning: {
    'npm-ci': { run: 'npm ci', required: true },
    vhs: { run: 'brew install vhs', select: { labels: ['area:demo'] } },
  },
};

/** The labels CONFIG's kinds and steps select, written out by hand from it. */
const SELECTED = ['type:change', 'type:spec', 'area:demo'];

/** The labels CONFIG declares: those its kinds and steps select, and its epic label. */
const DECLARED_LABELS = [...SELECTED, 'type:epic'];

/** CONFIG with no `epicLabel` key at all. */
const { epicLabel: _epic, ...NO_EPIC } = CONFIG;

/**
 * The values of GitHub's `ProjectV2SingleSelectFieldOptionColor`, as gh 2.99.0 answered
 * `__type(name: "ProjectV2SingleSelectFieldOptionColor") { enumValues { name } }` on 2026-09-25.
 */
const ENUM_COLOURS = ['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'];

/** A board already holding everything CONFIG declares. */
const COMPLETE = { columns: Object.values(COLUMNS), fields: [{ name: 'Priority', options: PRIORITY.options }], labels: [...DECLARED_LABELS] };

/**
 * Runs `rigger setup-board` as the command, in a repository of its own holding `config`, with a
 * fake `gh` holding `board` first on PATH. It returns what the command printed and exited with,
 * the fake board afterwards, and every command the fake `gh` was run with.
 */
async function setUp(board, config = CONFIG) {
  assert.deepEqual(validate(config), [], 'the config handed to setup-board is one Rigger refuses');
  const target = repositoryIn('rigger-setup-board-', { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` });
  return runIn(target, board);
}

/**
 * Runs `rigger setup-board` from `target` with a fake `gh` holding `board` first on PATH, as the
 * board numbered `project`, which is the config's unless a test says otherwise.
 */
async function runIn(target, board, project = WHERE.project) {
  const fake = installFakeGh(mkdtempSync(join(tmpdir(), 'rigger-setup-board-gh-')), { ...WHERE, project, board });
  const ran = spawnSync(process.execPath, [BIN, 'setup-board'], {
    cwd: target,
    encoding: 'utf8',
    env: { ...gitEnvironment(), PATH: `${dirname(fake.gh)}${delimiter}${process.env.PATH}` },
  });
  const model = await fake.model();
  return { ran, model, writes: model.writes(), sent: fake.sent() };
}

/** What the fake board holds of `model`: its columns, its fields by name, and its labels. */
async function held(model) {
  const { operations } = model;
  return { columns: await operations.readColumns(), fields: await operations.readFieldTypes(), labels: await operations.readLabels() };
}

test('against a board missing every declared column, every label and the priority field, setup-board creates exactly those', async () => {
  const { ran, writes } = await setUp({ columns: [], fields: [], labels: [] });

  assert.equal(ran.status, 0, ran.stderr);
  // Both directions at once: the record holds each expected write and nothing else, written out
  // by hand from CONFIG.
  assert.deepEqual(writes, [
    { operation: 'createColumn', args: ['Ready'] },
    { operation: 'createColumn', args: ['Coding'] },
    { operation: 'createColumn', args: ['Review'] },
    { operation: 'createColumn', args: ['Owner'] },
    { operation: 'createColumn', args: ['Done'] },
    { operation: 'createField', args: ['Priority', ['High', 'Normal', 'Low']] },
    { operation: 'createLabel', args: ['type:change'] },
    { operation: 'createLabel', args: ['type:spec'] },
    { operation: 'createLabel', args: ['area:demo'] },
    { operation: 'createLabel', args: ['type:epic'] },
  ]);
});

test('the priority field setup-board creates carries exactly the config\'s options, in its order, read back from the board', async () => {
  const { ran, model } = await setUp({ ...COMPLETE, fields: [] });

  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(await model.operations.readFields(), [{ name: 'Priority', options: ['High', 'Normal', 'Low'] }]);
});

test('against a board whose priority field holds other options, setup-board makes no write to that field', async () => {
  const { ran, model, writes } = await setUp({ ...COMPLETE, columns: ['Ready'], fields: [{ name: 'Priority', options: ['P0', 'P1'] }] });

  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(writes.filter(({ operation }) => operation === 'createField'), []);
  assert.deepEqual(await model.operations.readFields(), [{ name: 'Priority', options: ['P0', 'P1'] }]);
  // The control: the same run did write, so a run that wrote nothing at all did not pass this.
  assert.ok(writes.length > 0, 'setup-board wrote nothing at all');
});

/** The names of the labels a run's write record created, in the order created. */
const labelsCreated = (writes) => writes.filter(({ operation }) => operation === 'createLabel').map(({ args: [name] }) => name);

/** The names of the labels a fake `gh` was sent a `createLabel` for, read from its record of every command. */
const labelsSent = (sent) => sent
  .map((args) => args[3]?.match(/^query=mutation \{ createLabel\(input: \{repositoryId: "[^"]*", name: ("(?:[^"\\]|\\.)*")/)?.[1])
  .filter(Boolean)
  .map((name) => JSON.parse(name));

test('against a board whose repository holds no label, the labels setup-board creates are those the kinds and steps select, and the epic label', async () => {
  const { ran, writes } = await setUp({ ...COMPLETE, labels: [] });

  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual([...labelsCreated(writes)].sort(), [...DECLARED_LABELS].sort());
});

test('given a config declaring an epic label the repository lacks, setup-board sends a createLabel of exactly that name', async () => {
  const { ran, sent } = await setUp({ ...COMPLETE, labels: [...SELECTED] });

  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(labelsSent(sent), ['type:epic']);
});

test('given a config declaring an epic label the repository already holds, setup-board sends no write to that label', async () => {
  // The repository lacks a selected label, so the run does write, and only the epic label is held.
  const { ran, sent } = await setUp({ ...COMPLETE, labels: ['type:change', 'type:spec', 'type:epic'] });

  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(labelsSent(sent), ['area:demo']);
});

test('given a config with no epicLabel key, against a repository holding no label, the labels setup-board creates are exactly those the kinds and steps select', async () => {
  assert.ok(!Object.hasOwn(NO_EPIC, 'epicLabel'));
  const { ran, writes } = await setUp({ ...COMPLETE, labels: [] }, NO_EPIC);

  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual([...labelsCreated(writes)].sort(), [...SELECTED].sort());
});

test('against a board already holding everything declared, setup-board makes no write', async () => {
  const { ran, writes } = await setUp(COMPLETE);

  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(writes, []);
});

test('against a board holding columns, fields and labels the config does not declare, setup-board removes and renames none of them', async () => {
  const board = {
    columns: ['Backlog', 'Ready', 'Blocked'],
    fields: [{ name: 'Model Tier', options: ['standard', 'high'] }, { name: 'Estimate', type: 'NUMBER' }],
    labels: ['bug', 'type:change'],
  };
  const { ran, model, writes } = await setUp(board);

  assert.equal(ran.status, 0, ran.stderr);
  // Every write is a creation of something the config declares, so none removes or renames.
  const declared = { createColumn: Object.values(COLUMNS), createField: [PRIORITY.field], createLabel: DECLARED_LABELS };
  for (const { operation, args: [name] } of writes) {
    assert.ok(declared[operation]?.includes(name), `setup-board sent ${operation} ${name}`);
  }
  const after = await held(model);
  assert.deepEqual(after.columns.slice(0, 3), ['Backlog', 'Ready', 'Blocked']);
  for (const field of [{ name: 'Model Tier', type: 'SINGLE_SELECT' }, { name: 'Estimate', type: 'NUMBER' }]) {
    assert.ok(after.fields.some(({ name, type }) => name === field.name && type === field.type), `${field.name} is gone`);
  }
  assert.deepEqual(await model.operations.readFields().then((fields) => fields.find(({ name }) => name === 'Model Tier')), { name: 'Model Tier', options: ['standard', 'high'] });
  for (const label of ['bug', 'type:change']) assert.ok(after.labels.includes(label), `${label} is gone`);
});

test('against a board with a card in each existing column, every card\'s column afterwards is its column before', async () => {
  const columns = ['Backlog', 'Ready', 'Coding', 'Blocked'];
  const items = columns.map((column, index) => ({ type: 'issue', repository: WHERE.repo, number: index + 1, title: `Card ${index + 1}`, column }));
  const { ran, model, writes } = await setUp({ columns, fields: [], labels: [], items });

  assert.equal(ran.status, 0, ran.stderr);
  assert.ok(writes.some(({ operation }) => operation === 'createColumn'), 'setup-board added no column, so no column was put at risk');
  const after = await model.operations.readItems();
  assert.deepEqual(after.map(({ number, column }) => [number, column]), [[1, 'Backlog'], [2, 'Ready'], [3, 'Coding'], [4, 'Blocked']]);
});

test('against a board whose priority field is not single-select, setup-board makes no write and exits non-zero, naming the field and its type', async () => {
  // Everything else is missing, so a check made after the first write would leave writes behind.
  const { ran, writes } = await setUp({ columns: [], fields: [{ name: 'Priority', type: 'TEXT' }], labels: [] });

  assert.notEqual(ran.status, 0);
  assert.match(ran.stderr, /Priority/);
  assert.match(ran.stderr, /TEXT/);
  assert.deepEqual(writes, []);
});

test('given a config with no board.priority, setup-board creates no priority field', async () => {
  const { priority, ...board } = CONFIG.board;
  const { ran, model, writes } = await setUp({ columns: [], fields: [], labels: [] }, { ...CONFIG, board });

  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(writes.filter(({ operation }) => operation === 'createField'), []);
  assert.deepEqual(await model.operations.readFields(), []);
  assert.ok(writes.length > 0, 'setup-board wrote nothing at all');
});

test('setup-board prints one line for each write it made, naming what it wrote', async () => {
  const { ran, writes } = await setUp({ columns: ['Ready', 'Coding', 'Review', 'Done'], fields: [], labels: ['type:change'] });

  assert.equal(ran.status, 0, ran.stderr);
  const [heading, ...lines] = ran.stdout.trimEnd().split('\n');
  assert.match(heading, /5 writes/);
  assert.deepEqual(lines.map((line) => line.trim()), [
    'added the column Owner',
    'created the field Priority with the options High, Normal, Low',
    'created the label type:spec',
    'created the label area:demo',
    'created the label type:epic',
  ]);
  assert.equal(writes.length, 5);
});

test('a write of a name holding a line break or other control character still prints as one line, and the name written is the name declared', async () => {
  // The validator accepts any name holding something other than whitespace, so each of these is a
  // name a consumer can declare. Every way a terminal can be made to start a line is split on.
  const names = ['area:\ndemo', 'area:\rcli', 'area:\u2028docs', 'area:\u0085ops', 'area:\u001b[2Kbell'];
  const config = { ...CONFIG, provisioning: { ...CONFIG.provisioning, vhs: { run: 'brew install vhs', select: { labels: names } } } };
  const { ran, model, writes } = await setUp({ ...COMPLETE, labels: ['type:change', 'type:spec', 'type:epic'] }, config);

  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(writes.length, names.length);
  const lines = ran.stdout.replace(/\n$/, '').split(/\r\n|[\n\r\u000b\u000c\u0085\u2028\u2029]/);
  assert.equal(lines.length, 1 + names.length, JSON.stringify(ran.stdout));
  assert.ok(!/\u001b/.test(ran.stdout), 'an escape sequence reached the terminal');
  assert.deepEqual((await model.operations.readLabels()).slice(3), names);
});

test('against a board already holding everything, setup-board prints no line for a write', async () => {
  const { ran, writes } = await setUp(COMPLETE);

  assert.deepEqual(writes, []);
  assert.deepEqual(ran.stdout.trimEnd().split('\n').slice(1), []);
});

test('every option in every schema write setup-board sends carries a colour of GitHub\'s option-colour enum, as the fake gh received it', async () => {
  // A held column and a new one, and a new field with three options: every option either write
  // sends is read out of the fake gh's record of the command it was run with.
  const { ran, sent } = await setUp({ columns: ['Backlog', 'Ready'], fields: [], labels: [] });
  assert.equal(ran.status, 0, ran.stderr);

  const colours = [];
  for (const args of sent) {
    const [operation] = parseDocument(args[3].slice('query='.length)).operations;
    if (operation.type !== 'mutation') continue;
    const [field] = operation.selections;
    const input = field.arguments.find(({ name }) => name === 'input').value;
    const options = input.fields.find(({ name }) => name === 'singleSelectOptions')?.value.values ?? [];
    for (const option of options) {
      const colour = option.fields.find(({ name }) => name === 'color')?.value;
      colours.push([field.name, colour?.kind, colour?.value]);
    }
  }

  // Ready is held, so four columns are added, their writes sending three, four, five and six
  // options, and the field three: 21 in all.
  assert.equal(colours.length, 3 + 4 + 5 + 6 + 3, JSON.stringify(colours));
  for (const [write, kind, value] of colours) {
    assert.ok(kind === 'scalar' && ENUM_COLOURS.includes(value), `${write} sent an option coloured ${kind} ${value}`);
  }
});

/** An issue of the repository the config names. */
const ours = (number) => ({ type: 'issue', repository: WHERE.repo, number, title: `Card ${number}`, column: 'Ready' });

/** An issue of `repository`, which is not the one the config names. */
const theirs = (repository, number) => ({ type: 'issue', repository, number, title: `Theirs ${number}`, column: 'Ready' });

/**
 * A board holding everything declared but the column Owner, and `items`. The refusal tests and
 * their control differ only in the items, so a board holding just the repository's issues is
 * the one setup-board writes to.
 */
const lackingOwner = (items) => ({ ...COMPLETE, columns: ['Ready', 'Coding', 'Review', 'Done'], items });

test("against a board holding only the repository's issues and lacking a declared column, setup-board creates that column", async () => {
  // The control for the refusals below: their boards differ from this one only in an item.
  const { ran, writes } = await setUp(lackingOwner([ours(1), ours(2)]));

  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(writes, [{ operation: 'createColumn', args: ['Owner'] }]);
});

test("against a board holding another repository's item and lacking a declared column, setup-board leaves the write record empty", async () => {
  const { ran, writes, sent } = await setUp(lackingOwner([ours(1), theirs('other/one', 7), ours(2)]));

  assert.notEqual(ran.status, 0);
  assert.deepEqual(writes, []);
  assert.ok(!sent.some((args) => /^query=mutation/.test(args[3] ?? '')), 'setup-board sent a mutation');
});

test('against a board holding items of other repositories, setup-board exits non-zero and names each of them', async () => {
  const { ran } = await setUp(lackingOwner([ours(1), theirs('other/one', 7), { type: 'pullRequest', repository: 'else/two', number: 8, title: 'A PR', column: 'Ready' }]));

  assert.notEqual(ran.status, 0);
  for (const repository of ['other/one', 'else/two']) assert.ok(ran.stderr.includes(repository), ran.stderr);
});

test('against a board holding a redacted item and lacking a declared column, setup-board leaves the write record empty and exits non-zero', async () => {
  // The fake gh's answer for the redacted item is constructed from the schema, not captured.
  const { ran, writes } = await setUp(lackingOwner([ours(1), { type: 'redacted' }]));

  assert.notEqual(ran.status, 0);
  assert.match(ran.stderr, /cannot read/);
  assert.deepEqual(writes, []);
});

test('when the board cannot be read, setup-board leaves the write record empty and exits non-zero', async () => {
  // The fake gh holds the board numbered one past the config's, so gh answers the config's is not there.
  const target = repositoryIn('rigger-setup-board-', { 'rigger.config.mjs': `export default ${JSON.stringify(CONFIG)};\n` });
  const { ran, writes } = await runIn(target, lackingOwner([ours(1)]), WHERE.project + 1);

  assert.notEqual(ran.status, 0);
  assert.match(ran.stderr, /Could not resolve to a ProjectV2/);
  assert.deepEqual(writes, []);
});

// proves R-SAFE-5
test('setup-board run against the source tree it is running from exits non-zero, names R-SAFE-5, and writes nothing', async () => {
  // This checkout's config names this repository's own board, so the fake gh on PATH is what
  // stands between a defect here and a write, and it records every command it is run with.
  const { ran, writes, sent } = await runIn(ROOT, COMPLETE);

  assert.notEqual(ran.status, 0);
  assert.match(ran.stderr, /R-SAFE-5/);
  assert.deepEqual(writes, []);
  assert.deepEqual(sent, []);
});
