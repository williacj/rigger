// ABOUTME: Tests the forge adapter's read side against recorded `gh` answers: the cards a board
// holds, its columns, its single-select fields and the repository's labels, each read in full.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from '../src/config/validate.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { itemWriteRunner, readRunner, schemaWriteRunner } from '../src/substrate/forge/runners.mjs';
import rigger from '../rigger.config.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** The item query gh was sent when board 6's item page was captured, on 2026-09-25. */
const BOARD_6_ITEM_QUERY = 'query { repositoryOwner(login: "williacj") { ... on ProjectV2Owner { projectV2(number: 6) { items(first: 100) { pageInfo { hasNextPage endCursor } nodes { id fieldValues(first: 100) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: 100) { pageInfo { hasNextPage } nodes { name } } } } } } } } } }';

/** The columns this repository's config declares, by key. */
const COLUMNS = { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' };

/** The board every test here reads, named as a config names it. */
const BOARD = { repo: 'williacj/rigger', project: 6, columns: COLUMNS };

const ok = (data) => ({ status: 0, stdout: JSON.stringify({ data }), stderr: '' });

/** The document a `gh api graphql -f query=` request carries. */
const documentOf = (args) => args[3].slice('query='.length);

/** The cursor a page request carries, or null for the first page. */
const cursorOf = (document) => document.match(/after: "([^"]*)"/)?.[1] ?? null;

/**
 * One board item as GitHub answers it in the item read: its content, and its field values, of
 * which only a single-select value carries a name and its field.
 */
function itemNode({ id, content, values = {} }) {
  return {
    id,
    fieldValues: {
      pageInfo: { hasNextPage: false },
      nodes: [{}, ...Object.entries(values).map(([field, name]) => ({ name, field: { name: field } }))],
    },
    content,
  };
}

/** An issue as an item's content, in the repository `repo`. */
function issue({ number, title = `Card ${number}`, body = '', labels = [], repo = 'williacj/rigger' }) {
  return {
    __typename: 'Issue',
    number,
    title,
    body,
    repository: { nameWithOwner: repo },
    labels: { pageInfo: { hasNextPage: false }, nodes: labels.map((name) => ({ name })) },
  };
}

/** A page of the item read, `nodes`, pointing on to the page `next` when there is one. */
function itemPage(nodes, next = null) {
  return {
    repositoryOwner: {
      projectV2: { items: { pageInfo: { hasNextPage: next !== null, endCursor: next ?? 'MTAw' }, nodes } },
    },
  };
}

/**
 * The field read's answer: the board's fields as GitHub answers them, where only a single-select
 * field carries its name and options. `fields` are `{ name, options }`, and `others` counts the
 * fields of other types, which answer as empty objects.
 */
function fieldPage(fields, others = 2) {
  const nodes = [...Array.from({ length: others }, () => ({})), ...fields.map(({ name, options }) => ({ name, options: options.map((option) => ({ name: option })) }))];
  return { repositoryOwner: { projectV2: { fields: { pageInfo: { hasNextPage: false, endCursor: 'MTA' }, nodes } } } };
}

/**
 * The priority read's field answer: every field of the board with its name and type, and a
 * single-select field with its options too. `fields` are `{ name, dataType, options }`, and a
 * field given no `dataType` is a single-select one.
 */
function typedFieldPage(fields) {
  const nodes = fields.map(({ name, dataType = 'SINGLE_SELECT', options }) => ({ name, dataType, ...(options ? { options: options.map((option) => ({ name: option })) } : {}) }));
  return { repositoryOwner: { projectV2: { fields: { pageInfo: { hasNextPage: false, endCursor: 'MTc' }, nodes } } } };
}

/** A page of the label read, holding `names`, pointing on to the page `next` when there is one. */
function labelPage(names, next = null) {
  const nodes = names.map((name) => ({ name }));
  return { repository: { labels: { pageInfo: { hasNextPage: next !== null, endCursor: next ?? 'MTAw' }, nodes } } };
}

/** Every key path `value` holds, each written as `.key` or `[]` steps from its root. */
function pathsOf(value, at = '', into = new Set()) {
  if (Array.isArray(value)) {
    for (const held of value) pathsOf(held, `${at}[]`, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, held] of Object.entries(value)) {
      into.add(`${at}.${key}`);
      pathsOf(held, `${at}.${key}`, into);
    }
  }
  return into;
}

/**
 * The key paths gh printed on 2026-09-25, with gh 2.99.0, for each of the read side's queries: its
 * item page, its field query and the priority read's typed field query on board 6, and its label
 * page on this repository. A constructed answer holding any other path carries a field the query
 * does not select, or nests one where gh does not.
 */
const PRINTED = Object.fromEntries(
  [
    ['item', 'board-6-items-2026-09-25.json'],
    ['field', 'board-6-fields-2026-09-25.json'],
    ['typed field', 'board-6-field-types-2026-09-25.json'],
    ['label', 'rigger-labels-2026-09-25.json'],
  ]
    .map(([kind, file]) => [kind, pathsOf(JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')))]),
);

/** The paths of `answer` that gh did not print for the query of kind `kind`. */
const unprinted = (kind, answer) => [...pathsOf(answer)].filter((path) => !PRINTED[kind].has(path));

/** Whether `page` is what `gh` said rather than the data it answered. */
const said = (page) => Object.hasOwn(page, 'status');

/**
 * A forge answering the item read with `pages`, keyed by the cursor each is asked for (`null`
 * for the first), and recording every command it is handed. A page is the data `gh` answered, or
 * what `gh` said where it did not answer 0.
 */
function forge({
  pages = { null: itemPage([]) },
  fields = fieldPage([{ name: 'Status', options: Object.values(COLUMNS) }]),
  labels = { null: labelPage([]) },
  typedFields = typedFieldPage([{ name: 'Status', options: Object.values(COLUMNS) }]),
} = {}) {
  const sent = [];
  const callers = [];
  const asked = new Set();
  // Each page once, and only a page the test holds: a read that stopped passing its cursor on
  // would otherwise ask for the first page for ever, and the test would hang, not fail.
  const answer = (connection, held, document) => {
    const cursor = cursorOf(document);
    assert.ok(!asked.has(`${connection} ${cursor}`), `the ${connection} page after ${cursor} was asked for twice`);
    assert.ok(Object.hasOwn(held, String(cursor)), `the ${connection} page after ${cursor} is not one gh answered`);
    asked.add(`${connection} ${cursor}`);
    return said(held[cursor]) ? held[cursor] : printed(connection, held[cursor]);
  };
  // Every answer this forge gives is shaped as gh printed it for the same query.
  const printed = (kind, data) => {
    const answer = ok(data);
    assert.deepEqual(unprinted(kind, JSON.parse(answer.stdout)), [], `the ${kind} answer is not shaped as gh prints it`);
    return answer;
  };
  const send = (command, args) => {
    sent.push([command, ...args]);
    // The function that handed this request to the spawn: the stack's frame below this one.
    callers.push(new Error().stack.split('\n')[2].trim().split(' ')[1]);
    const document = documentOf(args);
    if (document.includes('items(')) return answer('item', pages, document);
    if (document.includes('dataType')) return printed('typed field', typedFields);
    if (document.includes('fields(')) return printed('field', fields);
    if (document.includes('repository(')) return answer('label', labels, document);
    throw new Error(`the test forge does not answer ${document}`);
  };
  send.sent = sent;
  send.callers = callers;
  return send;
}

test("the answers this file constructs are refused where they hold a field the query does not select, or nest one where gh does not", () => {
  // The check every constructed answer above passes through. `url` is a field of an issue the
  // item query never selects, and a label's name directly under `labels` is the nesting gh uses
  // for `nodes` only; a draft answering with only its type is what gh prints for one.
  const node = itemNode({ id: 'PVTI_one', content: issue({ number: 214, labels: ['type:change'] }), values: { Status: 'Ready' } });
  assert.deepEqual(unprinted('item', { data: itemPage([node]) }), []);
  assert.deepEqual(unprinted('item', { data: itemPage([itemNode({ id: 'PVTI_draft', content: { __typename: 'DraftIssue' } })]) }), []);

  const selectsMore = structuredClone(node);
  selectsMore.content.url = 'https://github.com/williacj/rigger/issues/214';
  assert.deepEqual(unprinted('item', { data: itemPage([selectsMore]) }), ['.data.repositoryOwner.projectV2.items.nodes[].content.url']);

  const nestsOtherwise = structuredClone(node);
  nestsOtherwise.content.labels = [{ name: 'type:change' }];
  assert.deepEqual(unprinted('item', { data: itemPage([nestsOtherwise]) }), ['.data.repositoryOwner.projectV2.items.nodes[].content.labels[].name']);
});

test("the cards read back with their number, title, body, labels and column as gh's answer holds them", async () => {
  const send = forge({
    pages: {
      null: itemPage([
        itemNode({
          id: 'PVTI_one',
          content: issue({ number: 214, title: 'A fake board', body: '## Acceptance\n\n- A test.', labels: ['type:change', 'size:s'] }),
          values: { Status: 'Ready' },
        }),
        itemNode({ id: 'PVTI_two', content: issue({ number: 215, title: 'Reads', body: 'Why.' }), values: { Status: 'Coding' } }),
      ]),
    },
  });

  const cards = await readSide(BOARD, { send }).readItems();

  assert.deepEqual(cards, [
    { id: 'PVTI_one', number: 214, title: 'A fake board', body: '## Acceptance\n\n- A test.', labels: ['type:change', 'size:s'], column: 'Ready' },
    { id: 'PVTI_two', number: 215, title: 'Reads', body: 'Why.', labels: [], column: 'Coding' },
  ]);
});

test("board 6's cards read back from the item page gh returned for it on 2026-09-25", async () => {
  // Captured on 2026-09-25 at 13:35 UTC with gh 2.99.0: the one item page gh answered to this read
  // side's item query on board 6, kept byte for byte. The query is the one it answered, so a read
  // asking anything else is no longer reading what this capture recorded.
  const recorded = readFileSync(join(FIXTURES, 'board-6-items-2026-09-25.json'), 'utf8');
  const send = (command, args) => {
    assert.equal(documentOf(args), BOARD_6_ITEM_QUERY);
    return { status: 0, stdout: recorded, stderr: '' };
  };

  const cards = await readSide(BOARD, { send }).readItems();

  // Every field of every card, against the values the capture holds for it. Board 6 held only
  // this repository's issues, so every item is a card.
  const expected = JSON.parse(recorded).data.repositoryOwner.projectV2.items.nodes.map(({ id, content, fieldValues }) => ({
    id,
    number: content.number,
    title: content.title,
    body: content.body,
    labels: content.labels.nodes.map((label) => label.name),
    column: fieldValues.nodes.filter((value) => value.field?.name === 'Status').map((value) => value.name)[0] ?? null,
  }));
  assert.deepEqual(cards, expected);
  // And, read off the capture by hand, so the lookup above is not the only witness.
  assert.equal(cards.length, 67);
  const card = cards.find((held) => held.number === 215);
  assert.equal(card.id, 'PVTI_lAHOBzomGc4BfS2xzg8rn2U');
  assert.equal(card.title, 'M1-02 — Rigger reads a real Projects v2 board');
  assert.deepEqual(card.labels, ['type:change']);
  assert.equal(card.column, 'Backlog');
  assert.equal(card.body.length, 3483);
  assert.ok(card.body.startsWith('Part of **M1**, `docs/v0-build-plan.md` §4 M1.'), card.body.slice(0, 80));
  // #20 holds a value in each of board 6's five single-select fields, Status among them.
  const twenty = cards.find((held) => held.number === 20);
  assert.equal(twenty.column, 'Done');
  assert.deepEqual(twenty.labels, []);
  const count = (column) => cards.filter((held) => held.column === column).length;
  assert.deepEqual([count('Backlog'), count('Done')], [52, 15]);
});

test('a board holding more cards than one page reads every card once, across the pages gh answers', async () => {
  // Two pages, as GitHub pages a board of more than a hundred items: the first points on to the
  // second by its end cursor. A read that stopped at the first page, or asked for the first page
  // again, would come back short or with cards twice.
  const numbers = Array.from({ length: 101 }, (_, i) => i + 1);
  const node = (number) => itemNode({ id: `PVTI_${number}`, content: issue({ number }), values: { Status: 'Ready' } });
  const send = forge({
    pages: {
      null: itemPage(numbers.slice(0, 100).map(node), 'Y3Vyc29yOnYyOpMA'),
      Y3Vyc29yOnYyOpMA: itemPage(numbers.slice(100).map(node)),
    },
  });

  const cards = await readSide(BOARD, { send }).readItems();

  assert.deepEqual(cards.map((card) => card.number), numbers);
  assert.equal(send.sent.length, 2);
});

test('a card gh answers on two adjacent pages reads back once, where it first appeared', async () => {
  // Items are paged by cursor while the board can change between the requests, so a card moved
  // after the first page is read can be answered again on the second. Here item 100 closes the
  // first page and opens the second.
  const numbers = Array.from({ length: 101 }, (_, i) => i + 1);
  const node = (number) => itemNode({ id: `PVTI_${number}`, content: issue({ number }), values: { Status: 'Ready' } });
  const send = forge({
    pages: {
      null: itemPage(numbers.slice(0, 100).map(node), 'Y3Vyc29yOnYyOpMA'),
      Y3Vyc29yOnYyOpMA: itemPage(numbers.slice(99).map(node)),
    },
  });

  const cards = await readSide(BOARD, { send }).readItems();

  assert.deepEqual(cards.map((card) => card.number), numbers);
});

test("only the configured repository's issues read back as cards, beside a draft, a pull request and another repository's issue", async () => {
  const send = forge({
    pages: {
      null: itemPage([
        itemNode({ id: 'PVTI_ours', content: issue({ number: 214 }), values: { Status: 'Ready' } }),
        itemNode({ id: 'PVTI_draft', content: { __typename: 'DraftIssue' }, values: { Status: 'Ready' } }),
        itemNode({ id: 'PVTI_pr', content: { __typename: 'PullRequest' }, values: { Status: 'Review' } }),
        itemNode({ id: 'PVTI_theirs', content: issue({ number: 7, repo: 'williacj/elsewhere' }), values: { Status: 'Ready' } }),
        itemNode({ id: 'PVTI_ours_too', content: issue({ number: 215 }), values: { Status: 'Coding' } }),
      ]),
    },
  });

  const cards = await readSide(BOARD, { send }).readItems();

  assert.deepEqual(cards.map((card) => card.id), ['PVTI_ours', 'PVTI_ours_too']);
});

test('a card holding more labels or field values than one page fails the read, naming the issue, rather than reading short', async () => {
  // Each nested connection is read one page deep, so a card with more on the forge would come
  // back missing labels, or missing its column, and look like a whole card.
  const node = itemNode({ id: 'PVTI_one', content: issue({ number: 214, labels: ['type:change'] }), values: { Status: 'Ready' } });
  for (const truncated of ['labels', 'fieldValues']) {
    const held = structuredClone(node);
    (truncated === 'labels' ? held.content.labels : held.fieldValues).pageInfo.hasNextPage = true;
    const send = forge({ pages: { null: itemPage([held]) } });

    await assert.rejects(readSide(BOARD, { send }).readItems(), /readItems on board 6 failed: issue #214/, truncated);
  }
});

test("a card's column is the option it holds in the field named Status, beside a second single-select field with the same option names", async () => {
  // `Stage` holds the same five option names as `Status`, and comes first among the item's field
  // values, so a read taking the first single-select value, or any field's, reads Done here.
  const send = forge({
    pages: {
      null: itemPage([itemNode({ id: 'PVTI_one', content: issue({ number: 214 }), values: { Stage: 'Done', Status: 'Ready' } })]),
    },
  });

  const [card] = await readSide(BOARD, { send }).readItems();

  assert.equal(card.column, 'Ready');
});

test("a read gh fails on its second page fails naming the board number and gh's first line, and returns no cards", async () => {
  // What gh 2.99.0 printed on 2026-09-25 to a read naming a board number that is not there. The
  // first page answers, so a read that kept what it had and stopped would return a partial board.
  const refused = { status: 1, stdout: '', stderr: 'gh: Could not resolve to a ProjectV2 with the number 6.\n' };
  const send = forge({
    pages: {
      null: itemPage([itemNode({ id: 'PVTI_one', content: issue({ number: 214 }) })], 'Y3Vyc29yOnYyOpMA'),
      Y3Vyc29yOnYyOpMA: refused,
    },
  });

  await assert.rejects(readSide(BOARD, { send }).readItems(), (error) => {
    assert.ok(error.message.includes('board 6'), error.message);
    assert.ok(error.message.includes('gh: Could not resolve to a ProjectV2 with the number 6.'), error.message);
    return true;
  });
  assert.equal(send.sent.length, 2, 'the second page was never asked for');
});

test("the configured repository's issues read back as cards whatever case the config writes its name in", async () => {
  // GitHub answers `nameWithOwner` in the repository's own case, and reads a name given in any
  // case as the same repository, so a config naming it otherwise still names these cards.
  const send = forge({ pages: { null: itemPage([itemNode({ id: 'PVTI_ours', content: issue({ number: 214 }) })]) } });

  const cards = await readSide({ ...BOARD, repo: 'WilliaCJ/Rigger' }, { send }).readItems();

  assert.deepEqual(cards.map((card) => card.id), ['PVTI_ours']);
});

test("the columns read back under the config's five keys, each the Status option the config names, beside columns it does not declare", async () => {
  const send = forge({
    fields: fieldPage([{ name: 'Status', options: ['Backlog', 'Ready', 'Coding', 'Blocked', 'Review', 'Owner', 'Done'] }]),
  });

  const columns = await readSide(BOARD, { send }).readColumns();

  assert.deepEqual(columns, { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' });
});

test("a column the config declares that is not a Status option fails the read, naming each missing column's key and display name", async () => {
  // `Stage` holds both missing names, so a read that looked for them in any single-select field
  // but `Status` would find them there and pass.
  const board = { ...BOARD, columns: { ...COLUMNS, owner: 'Needs Owner', done: 'Shipped' } };
  const send = forge({
    fields: fieldPage([
      { name: 'Stage', options: ['Ready', 'Coding', 'Review', 'Needs Owner', 'Shipped'] },
      { name: 'Status', options: ['Ready', 'Coding', 'Review', 'Owner', 'Done'] },
    ]),
  });

  await assert.rejects(readSide(board, { send }).readColumns(), (error) => {
    for (const named of ['board 6', 'owner', 'Needs Owner', 'done', 'Shipped']) {
      assert.ok(error.message.includes(named), `${named} is not in: ${error.message}`);
    }
    assert.ok(!/\bready\b|\bcoding\b|\breview\b/.test(error.message), `a column the board holds is named: ${error.message}`);
    return true;
  });
});

test('a board with no single-select field named Status fails the column read, naming the field', async () => {
  const send = forge({ fields: fieldPage([{ name: 'Stage', options: Object.values(COLUMNS) }]) });

  await assert.rejects(readSide(BOARD, { send }).readColumns(), /board 6.*Status/);
});

test("two configs naming different display names for the same five keys each read their own board's columns into those keys", async () => {
  // Five names none of which is the other config's, so a read that answered with one config's
  // names, or with fixed ones, could not pass both.
  const renamed = { ready: 'Up Next', coding: 'Building', review: 'In Review', owner: 'Needs A Human', done: 'Shipped' };
  const reads = [];
  for (const columns of [COLUMNS, renamed]) {
    const send = forge({ fields: fieldPage([{ name: 'Status', options: Object.values(columns) }]) });
    reads.push(await readSide({ ...BOARD, columns }, { send }).readColumns());
  }

  assert.deepEqual(reads, [
    { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' },
    { ready: 'Up Next', coding: 'Building', review: 'In Review', owner: 'Needs A Human', done: 'Shipped' },
  ]);
});

test('the single-select fields but Status read back with their options in board order, and no field of another type', async () => {
  // As the fake board holds them: the columns apart, and every other single-select field with its
  // options in the order the board gives them, which is neither alphabetical nor reversed.
  const send = forge({
    fields: fieldPage([
      { name: 'Status', options: Object.values(COLUMNS) },
      { name: 'Priority', options: ['Urgent', 'Low', 'High', 'Medium'] },
      { name: 'Model Tier', options: ['standard', 'high'] },
    ]),
  });

  const fields = await readSide(BOARD, { send }).readFields();

  assert.deepEqual(fields, [
    { name: 'Priority', options: ['Urgent', 'Low', 'High', 'Medium'] },
    { name: 'Model Tier', options: ['standard', 'high'] },
  ]);
});

test('every field reads back with its name and its type as GitHub names it, whatever the type', async () => {
  // Fields of four types: a read that kept only the single-select fields, or read a type from
  // anywhere but GitHub's answer, fails.
  const send = forge({
    typedFields: typedFieldPage([
      { name: 'Title', dataType: 'TITLE' },
      { name: 'Status', options: Object.values(COLUMNS) },
      { name: 'Priority', dataType: 'TEXT' },
      { name: 'Estimate', dataType: 'NUMBER' },
    ]),
  });

  assert.deepEqual(await readSide(BOARD, { send }).readFieldTypes(), [
    { name: 'Title', type: 'TITLE' },
    { name: 'Status', type: 'SINGLE_SELECT' },
    { name: 'Priority', type: 'TEXT' },
    { name: 'Estimate', type: 'NUMBER' },
  ]);
});

/** The board the priority read is tested on: `BOARD`, declaring its priority as this repository's config does. */
const RANKED = { ...BOARD, priority: { field: 'Priority', options: ['High', 'Normal', 'Low'] } };

test("the priority read returns each card's value in the declared field, and that field's options in the board's order", async () => {
  // The board lists Priority's options in an order unlike the declared one, and a second field
  // holds options of the same names, so a value read from the wrong field shows.
  const send = forge({
    typedFields: typedFieldPage([
      { name: 'Title', dataType: 'TITLE' },
      { name: 'Status', options: Object.values(COLUMNS) },
      { name: 'Priority', options: ['Low', 'High', 'Normal'] },
      { name: 'Model Tier', options: ['High', 'Low'] },
    ]),
    pages: {
      null: itemPage([
        itemNode({ id: 'PVTI_one', content: issue({ number: 214 }), values: { Status: 'Ready', Priority: 'High' } }),
        itemNode({ id: 'PVTI_two', content: issue({ number: 215 }), values: { Status: 'Coding', 'Model Tier': 'High' } }),
        itemNode({ id: 'PVTI_three', content: issue({ number: 216 }), values: { Priority: 'Low', 'Model Tier': 'High' } }),
      ]),
    },
  });

  const read = await readSide(RANKED, { send }).readPriority();

  assert.deepEqual(read.options, ['Low', 'High', 'Normal']);
  assert.deepEqual(read.items.map((card) => [card.number, card.priority.value]), [[214, 'High'], [215, null], [216, 'Low']]);
});

test("on a board whose options are ordered Low, High, Normal, the order the priority read hands on is the config's declared order", async () => {
  const send = forge({ typedFields: typedFieldPage([{ name: 'Status', options: Object.values(COLUMNS) }, { name: 'Priority', options: ['Low', 'High', 'Normal'] }]) });

  const read = await readSide(RANKED, { send }).readPriority();

  assert.deepEqual(read.declared, ['High', 'Normal', 'Low']);
  assert.deepEqual(read.options, ['Low', 'High', 'Normal']);
});

test("the priority read hands on, with each card, whether the declaration names the card's value", async () => {
  // `Urgent` is an option of the board's field that the config does not declare.
  const send = forge({
    typedFields: typedFieldPage([{ name: 'Priority', options: ['Urgent', 'High', 'Normal', 'Low'] }]),
    pages: {
      null: itemPage([
        itemNode({ id: 'PVTI_one', content: issue({ number: 214 }), values: { Priority: 'Normal' } }),
        itemNode({ id: 'PVTI_two', content: issue({ number: 215 }), values: { Priority: 'Urgent' } }),
        itemNode({ id: 'PVTI_three', content: issue({ number: 216 }), values: { Status: 'Ready' } }),
      ]),
    },
  });

  const read = await readSide(RANKED, { send }).readPriority();

  assert.deepEqual(read.items.map((card) => [card.number, card.priority]), [
    [214, { value: 'Normal', declared: true }],
    [215, { value: 'Urgent', declared: false }],
    [216, { value: null, declared: false }],
  ]);
});

/** The query gh was sent when board 6's fields were captured with their types, on 2026-09-25. */
const BOARD_6_FIELD_TYPES_QUERY = 'query { repositoryOwner(login: "williacj") { ... on ProjectV2Owner { projectV2(number: 6) { fields(first: 100) { pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2FieldCommon { name dataType } ... on ProjectV2SingleSelectField { options { name } } } } } } } }';

/**
 * A forge answering as board 6 did on 2026-09-25: the priority read's field query from the capture
 * made at 17:27 UTC with gh 2.99.0 by running the read side's own command for this repository's
 * config (the command #224's maker named on the card before running it), and the item query from
 * the capture made at 13:35 UTC. Each is answered only to the query it answered then.
 */
function board6() {
  const sent = [];
  const send = (command, args) => {
    const document = documentOf(args);
    sent.push(document);
    const [query, file] = document.includes('items(')
      ? [BOARD_6_ITEM_QUERY, 'board-6-items-2026-09-25.json']
      : [BOARD_6_FIELD_TYPES_QUERY, 'board-6-field-types-2026-09-25.json'];
    assert.equal(document, query, 'the read asked board 6 something its capture did not answer');
    return { status: 0, stdout: readFileSync(join(FIXTURES, file), 'utf8'), stderr: '' };
  };
  send.sent = sent;
  return send;
}

test("board 6's priority read from its captures gives issue #20 the value Normal, which the declaration names", async () => {
  const send = board6();

  const read = await readSide(boardFor(rigger), { send }).readPriority();

  assert.deepEqual(send.sent, [BOARD_6_FIELD_TYPES_QUERY, BOARD_6_ITEM_QUERY]);
  assert.deepEqual(read.items.find((card) => card.number === 20).priority, { value: 'Normal', declared: true });
  // Read off the captures by hand: board 6's Priority options, and #20 the one card holding a value.
  assert.deepEqual(read.options, ['High', 'Normal', 'Low']);
  assert.deepEqual(read.items.filter((card) => card.priority.value !== null).map((card) => card.number), [20]);
});

test('a declared priority field the board does not hold fails the priority read, naming the field', async () => {
  // Board 6 holds no field named Urgency.
  const config = { ...rigger, board: { ...rigger.board, priority: { field: 'Urgency', options: ['High', 'Low'] } } };

  await assert.rejects(readSide(boardFor(config), { send: board6() }).readPriority(), (error) => {
    assert.equal(error.message, 'readPriority on board 6 failed: the board has no field named Urgency');
    return true;
  });
});

test('a declared priority field that is not a single-select field fails the priority read, naming the field and its type', async () => {
  // Board 6's Milestone field is of the type gh answered as MILESTONE.
  const config = { ...rigger, board: { ...rigger.board, priority: { field: 'Milestone', options: ['High', 'Low'] } } };

  await assert.rejects(readSide(boardFor(config), { send: board6() }).readPriority(), (error) => {
    assert.equal(error.message, "readPriority on board 6 failed: the board's field Milestone is a MILESTONE field, not a single-select field");
    return true;
  });
});

test('with no priority declared, the priority read hands no declared order and no value, and queries no field', async () => {
  // The cards hold Priority values on the board, so a read that took them anyway shows.
  const send = forge({
    typedFields: typedFieldPage([{ name: 'Status', options: Object.values(COLUMNS) }, { name: 'Priority', options: ['High', 'Low'] }]),
    pages: {
      null: itemPage([
        itemNode({ id: 'PVTI_one', content: issue({ number: 214 }), values: { Status: 'Ready', Priority: 'High' } }),
        itemNode({ id: 'PVTI_two', content: issue({ number: 215 }), values: { Status: 'Ready', Priority: 'Low' } }),
      ]),
    },
  });

  const read = await readSide(BOARD, { send }).readPriority();

  assert.equal(read.declared, null);
  assert.equal(read.options, null);
  assert.deepEqual(read.items.map((card) => [card.number, card.priority]), [[214, null], [215, null]]);
  // One request, and it is the item read: no field of the board was asked for.
  assert.deepEqual(send.sent.map(([, ...args]) => documentOf(args).includes('items(')), [true]);
});

test("the repository's labels read back by name, across every page gh answers", async () => {
  const send = forge({
    labels: {
      null: labelPage(['type:change', 'type:spec'], 'Y3Vyc29yOnYyOpHOABc'),
      Y3Vyc29yOnYyOpHOABc: labelPage(['area:demo']),
    },
  });

  assert.deepEqual(await readSide(BOARD, { send }).readLabels(), ['type:change', 'type:spec', 'area:demo']);
});

/**
 * A full read: every read the read side offers, in turn, on a board declaring its priority whose
 * items span two pages. Each read is answered by a forge of its own, since two of them read the
 * items, and the requests all of them sent are returned together.
 */
async function fullRead() {
  const sent = [];
  const callers = [];
  for (const name of Object.keys(readSide(RANKED))) {
    const send = forge({
      pages: {
        null: itemPage([itemNode({ id: 'PVTI_one', content: issue({ number: 214 }), values: { Status: 'Ready' } })], 'Y3Vyc29yOnYyOpMA'),
        Y3Vyc29yOnYyOpMA: itemPage([itemNode({ id: 'PVTI_two', content: issue({ number: 215 }), values: { Status: 'Coding' } })]),
      },
      typedFields: typedFieldPage([{ name: 'Status', options: Object.values(COLUMNS) }, { name: 'Priority', options: ['High', 'Normal', 'Low'] }]),
    });
    await readSide(RANKED, { send })[name]();
    sent.push(...send.sent);
    callers.push(...send.callers);
  }
  return { sent, callers };
}

test('every command a full read runs is gh', async () => {
  // The read side's share of `R-SAFE-2`. It declares no proof of the requirement, whose other
  // network paths, git and the agent CLIs, this never reaches.
  const { sent } = await fullRead();

  assert.ok(sent.length >= 5, `only ${sent.length} commands were recorded`);
  assert.deepEqual([...new Set(sent.map(([command]) => command))], ['gh']);
});

test('every request a full read issues is one the read runner receives and admits', async () => {
  // Each request reaches the spawn from the read runner, and no other caller: a read side that
  // handed a request to the spawn itself, or through a write runner, is named here. And the read
  // runner admits each one again when asked, so none is a request it would have refused.
  const { sent, callers } = await fullRead();

  assert.deepEqual([...new Set(callers)], ['readRunner'], `requests reached the spawn from ${callers}`);
  for (const [, ...args] of sent) {
    const received = [];
    readRunner(args, { send: (command, admitted) => received.push([command, ...admitted]) });
    assert.deepEqual(received, [['gh', ...args]], `the read runner did not send ${args.join(' ')}`);
    assert.throws(() => itemWriteRunner(args, { send: () => assert.fail('an item write was sent') }));
    assert.throws(() => schemaWriteRunner(args, { send: () => assert.fail('a schema write was sent') }));
  }
});

/**
 * The board the forge adapter is handed for `config`: the board a config declares, with the
 * repository it names beside it. Only a config Rigger accepts is worked.
 */
function boardFor(config) {
  assert.deepEqual(validate(config), [], 'the config handed to the adapter is one Rigger refuses');
  return { repo: config.repo, ...config.board };
}

/** This repository's config declaring `octo-org`, which is not the repository's owner, as its board's owner. */
const OCTO = { ...rigger, board: { ...rigger.board, owner: 'octo-org' } };

test("for this repository's config the item query is byte for byte the one board 6's capture answered", async () => {
  const sent = [];
  const send = (command, args) => {
    sent.push(documentOf(args));
    return { status: 0, stdout: readFileSync(join(FIXTURES, 'board-6-items-2026-09-25.json'), 'utf8'), stderr: '' };
  };

  await readSide(boardFor(rigger), { send }).readItems();

  assert.deepEqual(sent, [BOARD_6_ITEM_QUERY]);
});

test("with a board owner declared, the item read returns only the issues of the repository repo names", async () => {
  // The declared owner's board holds its own repository's issue beside this repository's, a
  // draft and a pull request: only this repository's issue is a card.
  const send = forge({
    pages: {
      null: itemPage([
        itemNode({ id: 'PVTI_theirs', content: issue({ number: 7, repo: 'octo-org/rigger' }), values: { Status: 'Ready' } }),
        itemNode({ id: 'PVTI_ours', content: issue({ number: 214 }), values: { Status: 'Ready' } }),
        itemNode({ id: 'PVTI_draft', content: { __typename: 'DraftIssue' } }),
        itemNode({ id: 'PVTI_pr', content: { __typename: 'PullRequest' } }),
      ]),
    },
  });

  const cards = await readSide(boardFor(OCTO), { send }).readItems();

  assert.deepEqual(cards.map((card) => [card.id, card.number]), [['PVTI_ours', 214]]);
});

test("where the repository's owner and the declared board owner each hold a board numbered 6, the item read returns the declared owner's board's cards and none of the other's", async () => {
  // Constructed, each shaped as gh printed the item page for this query on 2026-09-25. Both
  // boards hold this repository's issues, so only which board was read tells them apart.
  const boards = {
    williacj: itemPage([
      itemNode({ id: 'PVTI_williacj_1', content: issue({ number: 101 }), values: { Status: 'Ready' } }),
      itemNode({ id: 'PVTI_williacj_2', content: issue({ number: 102 }), values: { Status: 'Done' } }),
    ]),
    'octo-org': itemPage([
      itemNode({ id: 'PVTI_octo_1', content: issue({ number: 201 }), values: { Status: 'Coding' } }),
    ]),
  };
  for (const [owner, data] of Object.entries(boards)) {
    assert.deepEqual(unprinted('item', { data }), [], `${owner}'s board is not shaped as gh prints it`);
  }
  const send = (command, args) => {
    const login = documentOf(args).match(/repositoryOwner\(login: "([^"]*)"\)/)[1];
    assert.ok(Object.hasOwn(boards, login), `the read asked ${login}, who holds no board here`);
    return ok(boards[login]);
  };

  const cards = await readSide(boardFor(OCTO), { send }).readItems();

  assert.deepEqual(cards.map((card) => card.id), ['PVTI_octo_1']);
});
