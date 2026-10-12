// ABOUTME: Tests the forge adapter's read side against recorded `gh` answers: the cards a board
// holds, its columns, its single-select fields and the repository's labels, each read in full, and
// a card's branch, pull requests, diff, merge base, comments and issue edit time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from '../src/config/validate.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { itemWriteRunner, readRunner, schemaWriteRunner } from '../src/substrate/forge/runners.mjs';
import rigger from '../rigger.config.mjs';
import { repositoryReads } from '../src/substrate/forge/read.mjs';

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
    await readRunner(args, { send: (command, admitted) => received.push([command, ...admitted]) });
    assert.deepEqual(received, [['gh', ...args]], `the read runner did not send ${args.join(' ')}`);
    await assert.rejects(itemWriteRunner(args, { send: () => assert.fail('an item write was sent') }));
    await assert.rejects(schemaWriteRunner(args, { send: () => assert.fail('a schema write was sent') }));
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

/**
 * The key paths gh printed on 2026-10-01, with gh 2.99.0, for each of the repository reads'
 * requests on this repository: the pull requests from a branch, its branches, a pull request's
 * base and head, its comments, and the comparison its merge base is read from. A constructed answer holding any other path carries a field the request does not select.
 */
const PRINTED_REPOSITORY = Object.fromEntries(
  [
    ['pull requests', 'rigger-pull-requests-2026-10-01.json'],
    ['branches', 'rigger-branches-2026-10-01.json'],
    ['head', 'rigger-pull-request-head-2026-10-01.json'],
    ['mergeable', 'rigger-pull-request-mergeable-2026-10-09.json'],
    ['comments', 'rigger-pull-request-comments-2026-10-09.json'],
    ['compare', 'rigger-compare-2026-10-01.json'],
    // Captured with gh 2.99.0 on 2026-10-11, for the four reads of #725.
    ['default branch', 'rigger-default-branch-2026-10-11.json'],
    ['pull request', 'rigger-pull-request-2026-10-11.json'],
    ['issue', 'rigger-issue-2026-10-11.json'],
    ['file', 'rigger-file-at-commit-2026-10-11.json'],
  ].map(([kind, file]) => [kind, pathsOf(JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')))]),
);

/** The diff a pull request is served as, here two files' worth, ending without a newline. */
const DIFF = 'diff --git a/README.md b/README.md\nindex 1111111..2222222 100644\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/a.txt b/a.txt\nnew file mode 100644\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+é and \\ "quoted"\n\\ No newline at end of file';

/** What gh says of a request that failed: its message on stderr, and exit 1. */
const failed = (message) => ({ status: 1, stdout: '', stderr: `${message}\n` });

/**
 * A forge answering the repository reads, recording every command it is handed and the function
 * that handed it to the spawn. `answers` maps a kind of request to its answer: the data gh
 * answered, keyed by the cursor each page is asked for where the request pages, or what gh said
 * where it did not answer 0. A REST read is answered with the text gh printed. Every constructed
 * answer is shaped as gh printed it for the same request.
 */
function repositoryForge(answers = {}) {
  const sent = [];
  const callers = [];
  const answer = (kind, document) => {
    const held = answers[kind];
    assert.ok(held !== undefined, `the test forge holds no ${kind} answer`);
    const page = said(held) || !Object.hasOwn(held, 'paged') ? held : held.paged[String(cursorOf(document))];
    assert.ok(page !== undefined, `the ${kind} page after ${cursorOf(document)} is not one gh answered`);
    if (said(page)) return page;
    const printed = ok(page);
    assert.deepEqual([...pathsOf(JSON.parse(printed.stdout))].filter((path) => !PRINTED_REPOSITORY[kind].has(path)), [], `the ${kind} answer is not shaped as gh prints it`);
    return printed;
  };
  const send = (command, args) => {
    sent.push([command, ...args]);
    callers.push(new Error().stack.split('\n')[2].trim().split(' ')[1]);
    if (args[1] !== 'graphql') {
      const held = answers[args[1]];
      assert.ok(held !== undefined, `the test forge does not answer ${args.join(' ')}`);
      if (said(held)) return held;
      if (typeof held === 'string') return { status: 0, stdout: held, stderr: '' };
      if (args[1].includes('/commits/')) return { status: 0, stdout: JSON.stringify(held), stderr: '' };
      if (args[1].includes('/rules/') || args[1].includes('/protection')) return { status: 0, stdout: JSON.stringify(held), stderr: '' };
      if (args[1].includes('/collaborators/')) return { status: 0, stdout: JSON.stringify(held), stderr: '' };
      assert.deepEqual([...pathsOf(held)].filter((path) => !PRINTED_REPOSITORY.compare.has(path)), [], 'the compare answer is not shaped as gh prints it');
      return { status: 0, stdout: JSON.stringify(held), stderr: '' };
    }
    const document = documentOf(args);
    for (const kind of ['pullRequests(', 'refs(', 'comments(']) {
      if (document.includes(kind)) return answer({ 'pullRequests(': 'pull requests', 'refs(': 'branches', 'comments(': 'comments' }[kind], document);
    }
    if (document.includes('defaultBranchRef')) return answer('default branch', document);
    if (document.includes('headRepository')) return answer('pull request', document);
    if (document.includes('issue(')) return answer('issue', document);
    if (document.includes('object(oid:')) return answer('file', document);
    if (document.includes('mergeable')) return answer('mergeable', document);
    if (document.includes('pullRequest(')) return answer('head', document);
    throw new Error(`the test forge does not answer ${document}`);
  };
  send.sent = sent;
  send.callers = callers;
  return send;
}

/** A pull request as the pull request read answers it. */
const pullNode = ({ number, state = 'OPEN', head = `${number}`.padStart(40, 'a'), base = 'main', from = 'williacj/rigger' }) =>
  ({ number, state, headRefOid: head, baseRefName: base, headRepository: from === null ? null : { nameWithOwner: from } });

/** The pull request read's answer: `nodes`, pointing on to the page `next` when there is one. */
const pullPage = (nodes, next = null) => ({ repository: { pullRequests: { pageInfo: { hasNextPage: next !== null, endCursor: next ?? 'Y3Vy' }, nodes } } });

/** The branch read's answer: `names`, pointing on to the page `next` when there is one. */
const branchPage = (names, next = null) => ({ repository: { refs: { pageInfo: { hasNextPage: next !== null, endCursor: next ?? 'MjU' }, nodes: names.map((name) => ({ name })) } } });

/** The comment read's answer: `comments`, pointing on to the page `next` when there is one. */
const commentPage = (comments, next = null) => ({ repository: { pullRequest: { comments: { pageInfo: { hasNextPage: next !== null, endCursor: next ?? 'Y3Vy' }, nodes: comments } } } });

/** The comment fields selected by the read, with every body and creation time kept from `comments`. */
const commentNodes = (comments) => comments.map((comment, index) => ({ ...comment, id: `IC_${index}`, author: { login: 'williacj' }, lastEditedAt: null, includesCreatedEdit: false }));

/**
 * An issue as the issue read answers it: `labels` its page of label names, pointing on to the
 * page `next` when there is one, and `repo` the repository the forge answers it in.
 */
const issueNode = ({ number, body = '', labels = [], next = null, repo = 'williacj/rigger' }) =>
  ({ number, body, repository: { nameWithOwner: repo }, labels: { pageInfo: { hasNextPage: next !== null, endCursor: next ?? 'MQ' }, nodes: labels.map((name) => ({ name })) } });

/** The pull requests a read answers, one page of them. */
const pulls = (...nodes) => ({ paged: { null: pullPage(nodes.map(pullNode)) } });

test('given a branch, the repository read answers the open pull request from it in the configured repository, with its number, head SHA and base', async () => {
  // A pull request from a fork's branch of the same name is not this repository's line of work.
  const send = repositoryForge({
    'pull requests': pulls({ number: 12, head: 'c'.repeat(40), base: 'main' }, { number: 13, from: 'someone/rigger' }, { number: 14, from: null }),
  });

  const read = await repositoryReads(BOARD, { send }).readPullRequests('rigger-214');

  assert.deepEqual(read, { open: [{ number: 12, head: 'c'.repeat(40), base: 'main' }], merged: [] });
  assert.match(documentOf(send.sent[0].slice(1)), /pullRequests\(headRefName: "rigger-214", states: \[OPEN, MERGED\], first: 100\)/);
});

test('given a branch with no open pull request, the repository read answers none', async () => {
  const send = repositoryForge({ 'pull requests': pulls() });

  assert.deepEqual(await repositoryReads(BOARD, { send }).readPullRequests('rigger-214'), { open: [], merged: [] });
});

test('given a branch with two open pull requests, the repository read answers both', async () => {
  const send = repositoryForge({ 'pull requests': pulls({ number: 12 }, { number: 15, base: 'release' }) });

  const { open } = await repositoryReads(BOARD, { send }).readPullRequests('rigger-214');

  assert.deepEqual(open.map(({ number, base }) => [number, base]), [[12, 'main'], [15, 'release']]);
});

test('given a branch, the repository read answers every merged pull request whose head was that branch, across pages', async () => {
  const send = repositoryForge({
    'pull requests': {
      paged: {
        null: pullPage([pullNode({ number: 9, state: 'MERGED' })], 'Y3Vyc29yOnYyOpHPAA'),
        Y3Vyc29yOnYyOpHPAA: pullPage([pullNode({ number: 11, state: 'MERGED', head: 'd'.repeat(40) }), pullNode({ number: 12 })]),
      },
    },
  });

  const read = await repositoryReads(BOARD, { send }).readPullRequests('rigger-214');

  assert.deepEqual(read.merged, [{ number: 9, head: pullNode({ number: 9 }).headRefOid, base: 'main' }, { number: 11, head: 'd'.repeat(40), base: 'main' }]);
  assert.deepEqual(read.open.map(({ number }) => number), [12]);
  assert.equal(send.sent.length, 2);
});

test("the repository read answers the pull requests gh answered for this repository's branch on 2026-10-01", async () => {
  // Captured with gh 2.99.0: #503, merged from m4/477-structure-deltas into main.
  const recorded = readFileSync(join(FIXTURES, 'rigger-pull-requests-2026-10-01.json'), 'utf8');
  const send = () => ({ status: 0, stdout: recorded, stderr: '' });

  const read = await repositoryReads(BOARD, { send }).readPullRequests('m4/477-structure-deltas');

  assert.deepEqual(read, { open: [], merged: [{ number: 503, head: '2241b82e646247db82dae465dd0d2fbcb7e098e0', base: 'main' }] });
});

test('given a branch name, the repository read answers whether the forge holds that branch', async () => {
  const send = repositoryForge({ branches: { paged: { null: branchPage(['main', 'rigger-214']) } } });
  const reads = repositoryReads(BOARD, { send });

  assert.deepEqual(await reads.readBranches(['rigger-214']), { 'rigger-214': true });
  assert.deepEqual(await reads.readBranches(['rigger-21']), { 'rigger-21': false });
});

test('given several branch names, the repository read answers for each whether the forge holds it, in one call', async () => {
  const send = repositoryForge({ branches: { paged: { null: branchPage(['main', 'rigger-214', 'rigger-216']) } } });

  const read = await repositoryReads(BOARD, { send }).readBranches(['rigger-214', 'rigger-215', 'rigger-216']);

  assert.deepEqual(read, { 'rigger-214': true, 'rigger-215': false, 'rigger-216': true });
  assert.equal(send.sent.length, 1);
});

test('the branch read finds a branch on the second page gh answers', async () => {
  const names = Array.from({ length: 100 }, (_, i) => `topic-${i}`);
  const send = repositoryForge({ branches: { paged: { null: branchPage(names, 'MTAw'), MTAw: branchPage(['rigger-214']) } } });

  assert.deepEqual(await repositoryReads(BOARD, { send }).readBranches(['rigger-214', 'topic-0']), { 'rigger-214': true, 'topic-0': true });
  assert.equal(send.sent.length, 2);
});

test("the repository read answers the branches gh answered for this repository on 2026-10-01", async () => {
  const recorded = readFileSync(join(FIXTURES, 'rigger-branches-2026-10-01.json'), 'utf8');
  const send = () => ({ status: 0, stdout: recorded, stderr: '' });

  const read = await repositoryReads(BOARD, { send }).readBranches(['main', 'm4/357-safe-declared-tools', 'm4/477-structure-deltas']);

  assert.deepEqual(read, { main: true, 'm4/357-safe-declared-tools': true, 'm4/477-structure-deltas': false });
});

test('given a pull request number, the repository read answers its diff as the forge serves it, byte for byte', async () => {
  const send = repositoryForge({ 'repos/williacj/rigger/pulls/12': DIFF });

  const diff = await repositoryReads(BOARD, { send }).readDiff(12);

  assert.equal(Buffer.compare(Buffer.from(diff), Buffer.from(DIFF)), 0);
  assert.deepEqual(send.sent, [['gh', 'api', 'repos/williacj/rigger/pulls/12', '-X', 'GET', '-H', 'Accept: application/vnd.github.diff']]);
});

test('given a pull request whose diff the forge declines to serve, the repository read rejects naming the pull request and the reason', async () => {
  // Constructed: GitHub declines a diff past its limits with HTTP 406, and gh prints the message
  // on stderr as it printed "gh: Not Found (HTTP 404)" for a missing pull request on 2026-10-01.
  const reason = 'gh: Sorry, the diff exceeded the maximum number of files (300). Consider using \'List pull requests files\' API or locally cloning the repository instead. (HTTP 406)';
  const send = repositoryForge({ 'repos/williacj/rigger/pulls/12': failed(reason) });

  await assert.rejects(repositoryReads(BOARD, { send }).readDiff(12), (error) => {
    assert.ok(error.message.includes('pull request #12'), error.message);
    assert.ok(error.message.includes(reason), error.message);
    return true;
  });
});

test('given a pull request number, the repository read answers the merge base the forge computed its diff from, with the base and head it compared', async () => {
  const head = '559db5bf83f4b7c30c1098ba4944875343af72cc';
  const send = repositoryForge({
    head: { repository: { pullRequest: { baseRefName: 'main', headRefOid: head } } },
    [`repos/williacj/rigger/compare/main...${head}`]: { merge_base_commit: { sha: 'ef60b49362c2fb1720412b2fbf30c0eb586a93d4' } },
  });

  const read = await repositoryReads(BOARD, { send }).readMergeBase(497);

  assert.deepEqual(read, { base: 'main', head, mergeBase: 'ef60b49362c2fb1720412b2fbf30c0eb586a93d4' });
  assert.deepEqual(send.sent[1], ['gh', 'api', `repos/williacj/rigger/compare/main...${head}`, '-X', 'GET']);
});

test("the repository read answers #497's merge base from the comparison gh answered on 2026-10-01", async () => {
  // `git merge-base` of main and #497's head gave the same commit on that day.
  const recorded = {
    head: readFileSync(join(FIXTURES, 'rigger-pull-request-head-2026-10-01.json'), 'utf8'),
    compare: readFileSync(join(FIXTURES, 'rigger-compare-2026-10-01.json'), 'utf8'),
  };
  const send = (command, args) => ({ status: 0, stdout: args[1] === 'graphql' ? recorded.head : recorded.compare, stderr: '' });

  const read = await repositoryReads(BOARD, { send }).readMergeBase(497);

  assert.deepEqual(read, { base: 'main', head: '559db5bf83f4b7c30c1098ba4944875343af72cc', mergeBase: 'ef60b49362c2fb1720412b2fbf30c0eb586a93d4' });
});

test('given a pull request number, the repository read answers every comment on it with its body and time, across more than one page', async () => {
  const comments = Array.from({ length: 101 }, (_, i) => ({ body: `Comment ${i + 1}`, createdAt: `2026-10-01T10:${String(i % 60).padStart(2, '0')}:00Z` }));
  const send = repositoryForge({ comments: { paged: { null: commentPage(commentNodes(comments.slice(0, 100)), 'Y3Vyc29yOnYyOpHPAAA'), Y3Vyc29yOnYyOpHPAAA: commentPage(commentNodes(comments.slice(100))) } }, 'repos/williacj/rigger/collaborators/williacj/permission': { permission: 'admin', role_name: 'admin' } });

  const read = await repositoryReads(BOARD, { send }).readComments(12);

  assert.deepEqual(read.map(({ body, createdAt }) => ({ body, createdAt })), comments);
  assert.equal(send.sent.length, 3);
});

test("the repository read answers #503's comments as gh answered them on 2026-10-01", async () => {
  const recorded = readFileSync(join(FIXTURES, 'rigger-pull-request-comments-2026-10-01.json'), 'utf8');
  const current = readFileSync(join(FIXTURES, 'rigger-pull-request-comments-2026-10-09.json'), 'utf8');
  const permission = readFileSync(join(FIXTURES, 'rigger-owner-permission-2026-10-09.json'), 'utf8');
  const send = (command, args) => ({ status: 0, stdout: args[1] === 'graphql' ? current : permission, stderr: '' });

  const read = await repositoryReads(BOARD, { send }).readComments(503);

  assert.equal(read.length, 2);
  assert.ok(read[0].body.startsWith('## Engineer judge verdict, PR #503'), read[0].body.slice(0, 60));
  assert.deepEqual(read.map(({ body, createdAt }) => ({ body, createdAt })), JSON.parse(recorded).data.repository.pullRequest.comments.nodes);
});

/** Each repository read, called on what it reads, with what a failure must name of it. */
const REPOSITORY_READS = {
  readPullRequests: { call: (reads) => reads.readPullRequests('rigger-214'), names: 'branch rigger-214' },
  readBranches: { call: (reads) => reads.readBranches(['rigger-214', 'rigger-215']), names: 'branches rigger-214, rigger-215' },
  readDiff: { call: (reads) => reads.readDiff(12), names: 'pull request #12' },
  readMergeBase: { call: (reads) => reads.readMergeBase(12), names: 'pull request #12' },
  readMergeable: { call: (reads) => reads.readMergeable(12), names: 'pull request #12' },
  readCheckStates: { call: (reads) => reads.readCheckStates('a'.repeat(40), []), names: 'checks' },
  readEffectiveRules: { call: (reads) => reads.readEffectiveRules('main'), names: 'effective rules' },
  readComments: { call: (reads) => reads.readComments(12), names: 'pull request #12' },
  readDefaultBranch: { call: (reads) => reads.readDefaultBranch(), names: 'the default branch' },
  readPullRequestByNumber: { call: (reads) => reads.readPullRequestByNumber(12), names: 'pull request #12' },
  readIssue: { call: (reads) => reads.readIssue(214), names: 'issue #214' },
  readFileAt: { call: (reads) => reads.readFileAt('a'.repeat(40), 'rigger.config.mjs'), names: `rigger.config.mjs at ${'a'.repeat(40)}` },
};

test('the table of repository reads names every read the repository side offers', () => {
  assert.deepEqual(Object.keys(repositoryReads(BOARD)).sort(), Object.keys(REPOSITORY_READS).sort());
});

test('a repository read that fails rejects naming what it read and what gh said, and never answers none in its place', async () => {
  for (const [name, { call, names }] of Object.entries(REPOSITORY_READS)) {
    const send = () => failed('gh: Could not resolve to a Repository with the name \'williacj/rigger\'.');
    await assert.rejects(call(repositoryReads(BOARD, { send })), (error) => {
      assert.ok(error.message.includes(name), error.message);
      assert.ok(error.message.includes(names), error.message);
      assert.ok(error.message.includes('Could not resolve to a Repository'), error.message);
      return true;
    }, name);
  }
});

test('a repository read that gh answers without the repository, issue or pull request rejects naming what it read', async () => {
  // gh exits 1 where GitHub resolves nothing, so this is the answer read defensively: data that
  // does not hold what was asked is never read as an empty answer.
  for (const [name, { call, names }] of Object.entries(REPOSITORY_READS)) {
    if (name === 'readDiff') continue;
    const send = (command, args) => ({ status: 0, stdout: JSON.stringify(args[1] === 'graphql' ? { data: { repository: null } } : {}), stderr: '' });
    await assert.rejects(call(repositoryReads(BOARD, { send })), (error) => error.message.includes(names) || assert.fail(error.message), name);
  }
});

test('a repository read refuses a number that is not an issue or pull request number, and sends nothing', async () => {
  const sent = [];
  const reads = repositoryReads(BOARD, { send: (command, args) => sent.push(args) });
  for (const call of [() => reads.readDiff('12/../../labels'), () => reads.readMergeBase(1.5), () => reads.readComments(null)]) {
    await assert.rejects(call(), /not an issue or pull request number/);
  }
  assert.deepEqual(sent, []);
});

test('every request a full repository read issues reaches the spawn through the read runner, which admits it', async () => {
  const head = 'e'.repeat(40);
  const answers = {
    'pull requests': pulls({ number: 12 }),
    branches: { paged: { null: branchPage(['main']) } },
    head: { repository: { pullRequest: { baseRefName: 'main', headRefOid: head } } },
    mergeable: { repository: { pullRequest: { mergeable: 'MERGEABLE' } } },
    comments: { paged: { null: commentPage([]) } },
    'repos/williacj/rigger/pulls/12': DIFF,
    'repos/williacj/rigger/pulls/214': DIFF,
    [`repos/williacj/rigger/compare/main...${head}`]: { merge_base_commit: { sha: head } },
    [`repos/williacj/rigger/commits/${'a'.repeat(40)}/check-runs?per_page=100&page=1`]: { total_count: 0, check_runs: [] },
    [`repos/williacj/rigger/commits/${'a'.repeat(40)}/statuses?per_page=100&page=1`]: [],
    'repos/williacj/rigger/rules/branches/main?per_page=100&page=1': [],
    'repos/williacj/rigger/branches/main/protection': { required_status_checks: { checks: [], contexts: [] } },
    'default branch': { repository: { defaultBranchRef: { name: 'main', target: { oid: head } } } },
    'pull request': { repository: { pullRequest: pullNode({ number: 12 }) } },
    issue: { paged: { null: { repository: { issue: issueNode({ number: 214 }) } } } },
    file: { repository: { object: { oid: 'a'.repeat(40), file: { mode: 0o100644, type: 'blob', object: { text: 'x', isBinary: false, isTruncated: false, byteSize: 1 } } } } },
  };
  const sent = [];
  const callers = [];
  for (const { call } of Object.values(REPOSITORY_READS)) {
    const send = repositoryForge(answers);
    await call(repositoryReads(BOARD, { send }));
    sent.push(...send.sent);
    callers.push(...send.callers);
  }

  assert.ok(sent.length >= 7, `only ${sent.length} requests were recorded`);
  assert.deepEqual([...new Set(callers)], ['readRunner'], `requests reached the spawn from ${callers}`);
  for (const [command, ...args] of sent) {
    assert.equal(command, 'gh');
    const received = [];
    await readRunner(args, { send: (handed, admitted) => received.push([handed, ...admitted]) });
    assert.deepEqual(received, [['gh', ...args]]);
    await assert.rejects(itemWriteRunner(args, { send: () => assert.fail('an item write was sent') }));
    await assert.rejects(schemaWriteRunner(args, { send: () => assert.fail('a schema write was sent') }));
  }
});

test('a repository read whose request never reached gh rejects naming what it read and why, keeps the failure\'s code, and sends nothing more', async () => {
  // L0's process adapter rejects, rather than answering, where `gh` never started.
  for (const [name, { call, names }] of Object.entries(REPOSITORY_READS)) {
    const sent = [];
    const send = (command, args) => {
      sent.push(args);
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    };
    await assert.rejects(call(repositoryReads(BOARD, { send })), (error) => {
      assert.ok(error.message.startsWith(`${name} on board 6 failed: `), error.message);
      assert.ok(error.message.includes(names), error.message);
      assert.ok(error.message.includes('williacj/rigger'), error.message);
      assert.ok(error.message.includes('spawn gh ENOENT'), error.message);
      assert.equal(error.code, 'ENOENT', name);
      return true;
    }, name);
    assert.equal(sent.length, 1, `${name} went on after its first request failed`);
  }
});

test('a repository read whose answer gh printed is not JSON rejects naming what it read and that the answer could not be read', async () => {
  // The diff is text and is never parsed, so its read is not among these.
  for (const [name, { call, names }] of Object.entries(REPOSITORY_READS)) {
    if (name === 'readDiff') continue;
    const send = () => ({ status: 0, stdout: '{"data": {"repository"', stderr: '' });
    await assert.rejects(call(repositoryReads(BOARD, { send })), (error) => {
      assert.ok(error.message.startsWith(`${name} on board 6 failed: `), error.message);
      assert.ok(error.message.includes(names), error.message);
      assert.match(error.message, /JSON/, error.message);
      return true;
    }, name);
  }
  // The merge base's comparison is the second request, and is parsed too.
  const head = 'e'.repeat(40);
  const send = (command, args) => (args[1] === 'graphql'
    ? ok({ repository: { pullRequest: { baseRefName: 'main', headRefOid: head } } })
    : { status: 0, stdout: '<html>', stderr: '' });
  await assert.rejects(repositoryReads(BOARD, { send }).readMergeBase(12), (error) => {
    assert.ok(error.message.startsWith('readMergeBase on board 6 failed: '), error.message);
    assert.ok(error.message.includes('pull request #12'), error.message);
    assert.match(error.message, /JSON/, error.message);
    return true;
  });
});

/** What gh printed for a capture under `test/fixtures/`, read as the text it is. */
const captured = (file) => readFileSync(join(FIXTURES, file), 'utf8');

test("readDefaultBranch answers the default branch's name and its head's full SHA, as gh answered them for this repository on 2026-10-11", async () => {
  // Captured with gh 2.99.0 on 2026-10-11: `defaultBranchRef { name target { oid } }`.
  const send = () => ({ status: 0, stdout: captured('rigger-default-branch-2026-10-11.json'), stderr: '' });

  const read = await repositoryReads(BOARD, { send }).readDefaultBranch();

  assert.deepEqual(read, { name: 'main', head: 'f190e5df169ee682a4de7da9093f36e0c63cf231' });
});

test('given the forge answers no default branch, as for an empty repository, readDefaultBranch rejects naming the repository as holding none', async () => {
  // Constructed: `Repository.defaultBranchRef` is nullable, and is null where the repository has
  // no branch (https://docs.github.com/en/graphql/reference/objects#repository). Not captured:
  // no empty repository was at hand to read.
  const send = repositoryForge({ 'default branch': { repository: { defaultBranchRef: null } } });

  await assert.rejects(repositoryReads(BOARD, { send }).readDefaultBranch(), (error) => {
    assert.match(error.message, /^readDefaultBranch on board 6 failed: reading the default branch in williacj\/rigger, williacj\/rigger holds no default branch$/);
    return true;
  });
  await assertOnlyReads(send.sent.map(([, ...args]) => args));
});

test('readPullRequestByNumber answers a merged pull request and a closed one as gh answered them for this repository on 2026-10-11', async () => {
  // Captured with gh 2.99.0 on 2026-10-11: #685, merged, and #678, closed without a merge.
  const recorded = { 685: captured('rigger-pull-request-2026-10-11.json'), 678: captured('rigger-pull-request-closed-2026-10-11.json') };
  const send = (command, args) => ({ status: 0, stdout: recorded[documentOf(args).match(/pullRequest\(number: (\d+)\)/)[1]], stderr: '' });
  const reads = repositoryReads(BOARD, { send });

  assert.deepEqual(await reads.readPullRequestByNumber(685), { number: 685, head: '6c84fae979c86d9b44840193063e742b9c00c3a4', base: 'main', state: 'merged', headRepository: 'williacj/rigger', fromRepository: true });
  assert.deepEqual(await reads.readPullRequestByNumber(678), { number: 678, head: '65b3e0130ec1d815388bcec67744c69628c13956', base: 'main', state: 'closed', headRepository: 'williacj/rigger', fromRepository: true });
});

/** The pull request read by number's answer: `node`, as `pullNode` gives one. */
const pullAnswer = (node) => ({ repository: { pullRequest: { ...pullNode(node) } } });

test("readPullRequestByNumber answers a fork's pull request with the fork as its head repository and fromRepository false, and does not leave it out", async () => {
  const send = repositoryForge({ 'pull request': pullAnswer({ number: 13, head: 'f'.repeat(40), from: 'someone/rigger' }) });

  const read = await repositoryReads(BOARD, { send }).readPullRequestByNumber(13);

  assert.deepEqual(read, { number: 13, head: 'f'.repeat(40), base: 'main', state: 'open', headRepository: 'someone/rigger', fromRepository: false });
  assert.match(documentOf(send.sent[0].slice(1)), /pullRequest\(number: 13\)/);
});

test('readPullRequestByNumber answers a pull request whose head repository was deleted with headRepository null and fromRepository false', async () => {
  // Constructed: `PullRequest.headRepository` is nullable, and null where the head repository
  // was deleted (https://docs.github.com/en/graphql/reference/objects#pullrequest). Not captured:
  // this repository holds no such pull request.
  const send = repositoryForge({ 'pull request': pullAnswer({ number: 14, state: 'CLOSED', from: null }) });

  const read = await repositoryReads(BOARD, { send }).readPullRequestByNumber(14);

  assert.deepEqual(read, { number: 14, head: pullNode({ number: 14 }).headRefOid, base: 'main', state: 'closed', headRepository: null, fromRepository: false });
});

test("readPullRequestByNumber answers fromRepository true where the head repository is this repository's name in another letter case", async () => {
  const send = repositoryForge({ 'pull request': pullAnswer({ number: 12, from: 'WilliaCJ/RIGGER' }) });

  const read = await repositoryReads(BOARD, { send }).readPullRequestByNumber(12);

  assert.equal(read.headRepository, 'WilliaCJ/RIGGER');
  assert.equal(read.fromRepository, true);
});

test('given the number names no pull request, readPullRequestByNumber rejects naming the number, as gh answered for this repository on 2026-10-11', async () => {
  // Captured with gh 2.99.0 on 2026-10-11 for #999999: gh exits 1, printing the response on
  // stdout and its message on stderr.
  const send = recording(() => ({ status: 1, stdout: captured('rigger-pull-request-not-found-2026-10-11.json'), stderr: 'gh: Could not resolve to a PullRequest with the number of 999999.\n' }));

  await assert.rejects(repositoryReads(BOARD, { send }).readPullRequestByNumber(999999), (error) => {
    assert.ok(error.message.includes('pull request #999999'), error.message);
    assert.ok(error.message.includes('Could not resolve to a PullRequest with the number of 999999.'), error.message);
    return true;
  });
  await assertOnlyReads(send.sent);
});

test('readPullRequestByNumber rejects a state gh answers that is none of open, closed and merged', async () => {
  const send = repositoryForge({ 'pull request': pullAnswer({ number: 12, state: 'DRAFT' }) });

  await assert.rejects(repositoryReads(BOARD, { send }).readPullRequestByNumber(12), /pull request #12.*gh answered state DRAFT/);
});

test('readIssue answers a closed issue as an open one, with its number, body and labels in the order gh answered them for this repository on 2026-10-11', async () => {
  // Captured with gh 2.99.0 on 2026-10-11: #492, closed, labelled type:change and area:demo. The
  // read selects no state, so a closed issue is answered as an open one is.
  const recorded = captured('rigger-issue-2026-10-11.json');
  const send = () => ({ status: 0, stdout: recorded, stderr: '' });

  const read = await repositoryReads(BOARD, { send }).readIssue(492);

  assert.deepEqual(read, { number: 492, body: JSON.parse(recorded).data.repository.issue.body, labels: ['type:change', 'area:demo'] });
  assert.ok(read.body.length > 0);
});

/** The issue read's answer, a page at a time: each of `pages` is `issueNode`'s, keyed by the cursor it is asked for. */
const issuePages = (pages) => ({ paged: Object.fromEntries(Object.entries(pages).map(([cursor, node]) => [cursor, { repository: { issue: issueNode(node) } }])) });

test("readIssue answers every label of an issue holding more than gh's first page of them, in gh's order", async () => {
  const labels = Array.from({ length: 102 }, (_, i) => `label-${String(101 - i).padStart(3, '0')}`);
  const send = repositoryForge({
    issue: issuePages({
      null: { number: 214, body: 'Why.', labels: labels.slice(0, 100), next: 'MTAw' },
      MTAw: { number: 214, body: 'Why.', labels: labels.slice(100) },
    }),
  });

  const read = await repositoryReads(BOARD, { send }).readIssue(214);

  assert.deepEqual(read, { number: 214, body: 'Why.', labels });
  assert.equal(send.sent.length, 2);
  assert.match(documentOf(send.sent[1].slice(1)), /labels\(first: 100, after: "MTAw"\)/);
});

test('readIssue answers an issue with an empty body with its body as the empty string', async () => {
  const send = repositoryForge({ issue: issuePages({ null: { number: 214, body: '', labels: ['type:change'] } }) });

  const read = await repositoryReads(BOARD, { send }).readIssue(214);

  assert.deepEqual(read, { number: 214, body: '', labels: ['type:change'] });
  assert.equal(typeof read.body, 'string');
});

test('readIssue answers null for a pull request\'s number and for a number naming nothing, from the not-found answer gh gave for this repository on 2026-10-11', async () => {
  // Captured with gh 2.99.0 on 2026-10-11: #685 is a pull request and #999999 is nothing. For each
  // gh exits 1, printing the response on stdout, with the issue null and a NOT_FOUND error at
  // `repository.issue`, and its message on stderr.
  const recorded = {
    685: { status: 1, stdout: captured('rigger-issue-of-a-pull-request-2026-10-11.json'), stderr: 'gh: Could not resolve to an Issue with the number of 685.\n' },
    999999: { status: 1, stdout: captured('rigger-issue-not-found-2026-10-11.json'), stderr: 'gh: Could not resolve to an Issue with the number of 999999.\n' },
  };
  for (const [number, said] of Object.entries(recorded)) {
    const sent = [];
    const reads = repositoryReads(BOARD, { send: (command, args) => sent.push(args) && said });

    assert.equal(await reads.readIssue(Number(number)), null, number);
    assert.equal(sent.length, 1, number);
  }
});

test('readIssue answers null for an issue the forge answers in a repository other than this one', async () => {
  // Constructed: GitHub redirects a transferred issue to the repository it was moved to
  // (https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/transferring-an-issue-to-another-repository).
  // Not captured: this repository holds no transferred issue.
  const send = repositoryForge({ issue: issuePages({ null: { number: 214, body: 'Theirs.', labels: ['type:change'], repo: 'someone/elsewhere' } }) });

  assert.equal(await repositoryReads(BOARD, { send }).readIssue(214), null);
});

test("given gh fails in any way but its not-found answer for that issue, readIssue rejects naming the issue and gh's first line", async () => {
  const notFound = JSON.parse(captured('rigger-issue-not-found-2026-10-11.json'));
  const failures = {
    // A rate limit and a server error each reach the read as gh exiting non-zero.
    'gh: API rate limit exceeded for user ID 1. (HTTP 403)': '',
    'gh: HTTP 502: Bad Gateway (https://api.github.com/graphql)': '',
    // A not-found answer for another path is not the issue's.
    "gh: Could not resolve to a Repository with the name 'williacj/rigger'.": JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], message: "Could not resolve to a Repository with the name 'williacj/rigger'." }] }),
    // A not-found answer beside another error is not gh's not-found answer alone.
    'gh: Something went wrong while executing your query.': JSON.stringify({ ...notFound, errors: [...notFound.errors, { message: 'Something went wrong while executing your query.' }] }),
  };
  for (const [line, stdout] of Object.entries(failures)) {
    const send = () => ({ status: 1, stdout, stderr: `${line}\n` });
    await assert.rejects(repositoryReads(BOARD, { send }).readIssue(214), (error) => {
      assert.ok(error.message.startsWith('readIssue on board 6 failed: reading issue #214 in williacj/rigger, '), error.message);
      assert.ok(error.message.includes(line), error.message);
      return true;
    }, line);
  }
});

test('readIssue and readPullRequestByNumber refuse a number that is not a positive integer, and send nothing', async () => {
  const sent = [];
  const reads = repositoryReads(BOARD, { send: (command, args) => sent.push(args) });
  for (const number of [0, -3, 1.5, '12', null, undefined, Number.NaN]) {
    await assert.rejects(reads.readIssue(number), /readIssue on board 6 failed: .*not an issue or pull request number/, String(number));
    await assert.rejects(reads.readPullRequestByNumber(number), /readPullRequestByNumber on board 6 failed: .*not an issue or pull request number/, String(number));
  }
  assert.deepEqual(sent, []);
});

/** The commit the file captures of 2026-10-11 were read at: `origin/main` on that day. */
const CAPTURED_AT = 'f190e5df169ee682a4de7da9093f36e0c63cf231';

test("readFileAt answers a file's text whole, as gh answered rigger.config.mjs at a commit of this repository on 2026-10-11", async () => {
  // Captured with gh 2.99.0 on 2026-10-11. The text gh answered is byte for byte the file git
  // holds at that commit, 4,283 bytes, which is the byte size gh answered beside it.
  const recorded = captured('rigger-file-at-commit-2026-10-11.json');
  const sent = [];
  const send = (command, args) => sent.push(args) && { status: 0, stdout: recorded, stderr: '' };

  const text = await repositoryReads(BOARD, { send }).readFileAt(CAPTURED_AT, 'rigger.config.mjs');

  assert.equal(text, JSON.parse(recorded).data.repository.object.file.object.text);
  assert.equal(Buffer.byteLength(text), 4283);
  assert.ok(text.startsWith("// ABOUTME: This repository's Rigger config"), text.slice(0, 60));
  assert.match(documentOf(sent[0]), /object\(oid: "f190e5df169ee682a4de7da9093f36e0c63cf231"\) \{ \.\.\. on Commit \{ oid file\(path: "rigger\.config\.mjs"\)/);
});

/** The file read's answer for an entry at `CAPTURED_AT`: `file` as GitHub answers a tree entry. */
const fileAnswer = (file, oid = CAPTURED_AT) => ({ repository: { object: { oid, file } } });

/** A blob entry as the file read selects it, a regular file's mode unless another is given. */
const blobEntry = (blob, mode = 0o100644) => ({ mode, type: 'blob', object: { isBinary: false, isTruncated: false, ...blob } });

test('readFileAt answers null where the forge shows the commit holding no entry at the path, as gh answered for this repository on 2026-10-11', async () => {
  // Captured with gh 2.99.0 on 2026-10-11: gh exits 1, printing the response on stdout, which
  // shows the commit with its file null and a NOT_FOUND error at `repository.object.file`.
  const send = () => ({ status: 1, stdout: captured('rigger-file-absent-2026-10-11.json'), stderr: "gh: Could not resolve file for path 'no/such/file.txt'.\n" });

  assert.equal(await repositoryReads(BOARD, { send }).readFileAt(CAPTURED_AT, 'no/such/file.txt'), null);
});

test('readFileAt answers the empty string for an empty file, not null', async () => {
  // Constructed: an empty blob's text is the empty string and its byte size 0.
  const send = repositoryForge({ file: fileAnswer(blobEntry({ text: '', byteSize: 0 })) });

  assert.equal(await repositoryReads(BOARD, { send }).readFileAt(CAPTURED_AT, 'empty.txt'), '');
});

test("readFileAt rejects naming the commit where the forge's answer does not show it, and never answers null", async () => {
  // Captured with gh 2.99.0 on 2026-10-11: a commit the repository does not hold answers its
  // object as null, with gh exiting 0.
  const absent = { status: 1, stdout: captured('rigger-file-absent-2026-10-11.json'), stderr: "gh: Could not resolve file for path 'no/such/file.txt'.\n" };
  const missing = '0123456789abcdef0123456789abcdef01234567';
  const answers = {
    'no such commit': { status: 0, stdout: captured('rigger-file-no-commit-2026-10-11.json'), stderr: '' },
    // An object that is not a commit, such as a tree, matches no fragment, as gh answered on that day.
    'an object that is not a commit': ok({ repository: { object: {} } }),
    'an answer missing the file field': ok({ repository: { object: { oid: missing } } }),
    'an answer missing the oid field': ok({ repository: { object: { file: null } } }),
    'an answer naming another commit': ok(fileAnswer(null, 'b'.repeat(40))),
    // The capture above, which shows `CAPTURED_AT` and not the commit asked for.
    'a not-found answer showing another commit': absent,
  };
  for (const [what, said] of Object.entries(answers)) {
    const send = recording(() => said);
    await assert.rejects(repositoryReads(BOARD, { send }).readFileAt(missing, 'rigger.config.mjs'), (error) => {
      assert.ok(error.message.startsWith(`readFileAt on board 6 failed: reading rigger.config.mjs at ${missing} in williacj/rigger, `), error.message);
      assert.ok(error.message.endsWith(`gh answered no commit ${missing}`), error.message);
      return true;
    }, what);
    await assertOnlyReads(send.sent);
  }
});

test('readFileAt rejects a directory and a binary file at the path, naming the path and why, as gh answered them for this repository on 2026-10-11', async () => {
  // Captured with gh 2.99.0 on 2026-10-11: `src`, a tree of mode 040000, and `docs/demo.gif`, a
  // blob gh answered as binary with no text.
  const answers = { src: 'rigger-file-directory-2026-10-11.json', 'docs/demo.gif': 'rigger-file-binary-2026-10-11.json' };
  const why = { src: 'src is a directory, not a file', 'docs/demo.gif': 'docs/demo.gif is a binary file' };
  for (const [path, file] of Object.entries(answers)) {
    const send = recording(() => ({ status: 0, stdout: captured(file), stderr: '' }));
    await assert.rejects(repositoryReads(BOARD, { send }).readFileAt(CAPTURED_AT, path), (error) => {
      assert.ok(error.message.endsWith(why[path]), error.message);
      return true;
    }, path);
    await assertOnlyReads(send.sent);
  }
});

test("readFileAt rejects a symbolic link and a submodule at the path, naming the path and what it is, and never answers the link's target, as gh answered them in git/git on 2026-10-11", async () => {
  // Captured with gh 2.99.0 on 2026-10-11 at git/git's default branch head: `RelNotes`, a link
  // of mode 120000 that gh answers as a blob holding its target's path, and
  // `sha1collisiondetection`, a submodule of mode 160000.
  const head = '6de20f6092dcf9bdb1c8efe03db4b70c82b423dd';
  const answers = { RelNotes: ['git-file-symbolic-link-2026-10-11.json', 'a symbolic link'], sha1collisiondetection: ['git-file-submodule-2026-10-11.json', 'a submodule'] };
  for (const [path, [file, what]] of Object.entries(answers)) {
    const send = recording(() => ({ status: 0, stdout: captured(file), stderr: '' }));
    await assert.rejects(repositoryReads({ ...BOARD, repo: 'git/git' }, { send }).readFileAt(head, path), (error) => {
      assert.ok(error.message.endsWith(`${path} is ${what}, not a file`), error.message);
      assert.ok(!error.message.includes('Documentation/RelNotes'), error.message);
      return true;
    }, path);
    await assertOnlyReads(send.sent);
  }
});

test('readFileAt rejects a file the forge does not send whole, naming the path and answering no part of its text', async () => {
  // Constructed on what gh answered on 2026-10-11, with gh 2.99.0, for git/git's po/bg.po at
  // 6de20f6: a text blob of 1,088,754 bytes, flagged truncated, its text cut to 385,073
  // characters. GitHub's contents API sends a file over 1 MB with no content at all
  // (https://docs.github.com/en/rest/repos/contents#get-repository-content), which a blob answered
  // with no text, or with less than its byte size, stands in for here.
  const part = 'msgid "partial text"';
  const answers = {
    'flagged truncated': blobEntry({ text: part, isTruncated: true, byteSize: 1088754 }),
    // The forge's flag is believed even where the text it sent is as long as the byte size it gave.
    'flagged truncated at its byte size': blobEntry({ text: part, isTruncated: true, byteSize: Buffer.byteLength(part) }),
    'sent with no text': blobEntry({ text: null, byteSize: 1088754 }),
    'sent with less than its byte size': blobEntry({ text: part, byteSize: 1088754 }),
    'sent with an empty text': blobEntry({ text: '', byteSize: 1088754 }),
  };
  for (const [what, file] of Object.entries(answers)) {
    const send = repositoryForge({ file: fileAnswer(file) });
    await assert.rejects(repositoryReads(BOARD, { send }).readFileAt(CAPTURED_AT, 'po/bg.po'), (error) => {
      assert.ok(error.message.includes('gh did not send po/bg.po whole'), error.message);
      assert.ok(!error.message.includes('partial'), error.message);
      return true;
    }, what);
    await assertOnlyReads(send.sent.map(([, ...args]) => args));
  }
});

test('readFileAt refuses a commit that is not a full SHA and a path that is empty, from the root, or holds an empty, . or .. segment, and sends nothing', async () => {
  const sent = [];
  const reads = repositoryReads(BOARD, { send: (command, args) => sent.push(args) });
  for (const commit of ['main', CAPTURED_AT.slice(0, 7), `${CAPTURED_AT}0`, 'g'.repeat(40), 'HEAD', undefined]) {
    await assert.rejects(reads.readFileAt(commit, 'rigger.config.mjs'), /readFileAt on board 6 failed: .*is not a commit's full SHA/, String(commit));
  }
  for (const path of ['', '/rigger.config.mjs', 'src//cli', 'src/', './rigger.config.mjs', 'src/../rigger.config.mjs', '..', '.', undefined]) {
    await assert.rejects(reads.readFileAt(CAPTURED_AT, path), /readFileAt on board 6 failed: .*is not a path within a commit/, String(path));
  }
  assert.deepEqual(sent, []);
});

/**
 * A send answering every request with what `answer` gives for its arguments, recording each
 * request's arguments in `sent`.
 */
function recording(answer) {
  const send = (command, args) => {
    send.sent.push(args);
    return answer(args);
  };
  send.sent = [];
  return send;
}

/**
 * Asserts that every request in `sent` is one the read runner admits, a query or an explicit GET,
 * and so none of them could change anything on the forge.
 */
async function assertOnlyReads(sent) {
  assert.ok(sent.length > 0, 'the read sent nothing');
  for (const args of sent) {
    const admitted = [];
    await readRunner(args, { send: (command, handed) => admitted.push(handed) });
    assert.deepEqual(admitted, [args]);
  }
}

test("given gh fails with an answer that parses but is no object, readIssue and readFileAt reject keeping gh's first line", async () => {
  const line = 'gh: HTTP 502: Bad Gateway (https://api.github.com/graphql)';
  for (const stdout of ['null', '1', '"text"', '[]']) {
    const said = { status: 1, stdout, stderr: `${line}\nsecond line\n` };
    const reads = repositoryReads(BOARD, { send: () => said });
    await assert.rejects(reads.readIssue(214), (error) => {
      assert.ok(error.message.startsWith('readIssue on board 6 failed: reading issue #214 in williacj/rigger, '), error.message);
      assert.ok(error.message.includes(line), error.message);
      return true;
    }, stdout);
    await assert.rejects(reads.readFileAt(CAPTURED_AT, 'rigger.config.mjs'), (error) => {
      assert.ok(error.message.startsWith(`readFileAt on board 6 failed: reading rigger.config.mjs at ${CAPTURED_AT} in williacj/rigger, `), error.message);
      assert.ok(error.message.includes(line), error.message);
      return true;
    }, stdout);
  }
});

test("given an issue's first label page answers and its next fails, readIssue rejects naming the issue and gh's first line, answers no part of it, and sends only reads", async () => {
  const line = 'gh: HTTP 502: Bad Gateway (https://api.github.com/graphql)';
  const labels = Array.from({ length: 101 }, (_, i) => `label-${i}`);
  const first = ok({ repository: { issue: issueNode({ number: 214, body: 'Why.', labels: labels.slice(0, 100), next: 'MTAw' }) } });
  const send = recording((args) => (cursorOf(documentOf(args)) === null ? first : failed(line)));

  await assert.rejects(repositoryReads(BOARD, { send }).readIssue(214), (error) => {
    assert.ok(error.message.startsWith('readIssue on board 6 failed: reading issue #214 in williacj/rigger, '), error.message);
    assert.ok(error.message.includes(line), error.message);
    assert.ok(!error.message.includes('label-'), error.message);
    return true;
  });
  assert.equal(send.sent.length, 2);
  await assertOnlyReads(send.sent);
});
