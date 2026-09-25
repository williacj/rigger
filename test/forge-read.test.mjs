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

/** Whether `page` is what `gh` said rather than the data it answered. */
const said = (page) => Object.hasOwn(page, 'status');

/**
 * A forge answering the item read with `pages`, keyed by the cursor each is asked for (`null`
 * for the first), and recording every command it is handed. A page is the data `gh` answered, or
 * what `gh` said where it did not answer 0.
 */
function forge({ pages = { null: itemPage([]) } } = {}) {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    const document = documentOf(args);
    if (document.includes('items(')) {
      const page = pages[cursorOf(document)];
      return said(page) ? page : ok(page);
    }
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
