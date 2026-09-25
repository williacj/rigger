// ABOUTME: Tests the forge adapter's read side against recorded `gh` answers: the cards a board
// holds, its columns, its single-select fields and the repository's labels, each read in full.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readSide } from '../src/substrate/forge/read.mjs';

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
 * A forge answering the item read with `pages`, keyed by the cursor each is asked for (`null`
 * for the first), and recording every command it is handed.
 */
function forge({ pages = { null: itemPage([]) } } = {}) {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    const document = documentOf(args);
    if (document.includes('items(')) return ok(pages[cursorOf(document)]);
    throw new Error(`the test forge does not answer ${document}`);
  };
  send.sent = sent;
  return send;
}

test('the cards read back with their number, title, body, labels and column as gh recorded them', async () => {
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
