// ABOUTME: The forge adapter's read side: the board's cards, columns and single-select fields and
// the repository's labels, and the IDs a write names, each read through the read runner.

import { literal } from './graphql.mjs';
import { COLUMNS, firstLine, graphqlRequest, readRunner } from './runners.mjs';

/** The most nodes GitHub answers in one page of a connection. */
const PAGE = 100;

/**
 * The user or organisation that holds the board: the `owner` the config declares under `board`,
 * and where it declares none, the repository's owner, named before the slash in `board.repo`.
 * This is the only place the repository's owner stands in for the key (`ARCHITECTURE.md`, below
 * the extension-point table).
 */
const ownerOf = (board) => board.owner ?? board.repo.split('/')[0];

/**
 * What a failure says of a request that found the board by its owner and number, so a board gh
 * says is not there is named as the one asked for, and a wrong owner shows.
 */
const asking = (board) => `asking for ${ownerOf(board)}'s board ${board.project}, `;

/**
 * The data `gh` answered to a request made for `operation` on `board`. Where `gh` did not answer
 * 0, it throws an error naming the operation, the board number, what the request `addressed` if
 * it found the board, and the first line `gh` said.
 */
export function answerOf(operation, board, said, addressed = '') {
  if (said.status !== 0) throw new Error(`${operation} on board ${board.project} failed: ${addressed}${firstLine(said)}`);
  return JSON.parse(said.stdout).data;
}

/** What `gh` answered to the read `query`, made for `operation` on `board`. */
const asked = (operation, board, query, send, addressed) =>
  answerOf(operation, board, readRunner(graphqlRequest(query), { send }), addressed);

/** Throws the error a read gives when the board answered something it cannot use. */
function fail(operation, board, why) {
  throw new Error(`${operation} on board ${board.project} failed: ${why}`);
}

/**
 * A query selecting `selection` on the board numbered `board.project` among the boards of its
 * owner.
 */
function boardQuery(operation, board, selection) {
  if (!Number.isInteger(board.project)) {
    throw new Error(`${operation} failed: the board number is ${board.project}, which is not a board number`);
  }
  return `query { repositoryOwner(login: ${literal(ownerOf(board))}) { ... on ProjectV2Owner { projectV2(number: ${board.project}) { ${selection} } } } }`;
}

/** A query selecting `selection` on the repository `board.repo` names as `owner/name`. */
function repositoryQuery(board, selection) {
  const [owner, name] = board.repo.split('/');
  return `query { repository(owner: ${literal(owner)}, name: ${literal(name)}) { ${selection} } }`;
}

/**
 * Every node of a connection, read a page at a time. `query` builds a page's document from its
 * `after` argument, and `connectionOf` finds the connection in what `gh` answered. A page that
 * fails fails the whole read, so no part of it is returned. `addressed` is what a failure says of
 * a read that finds the board, and is empty for one that does not.
 */
function everyPage(operation, board, send, query, connectionOf, addressed = '') {
  const nodes = [];
  let after = '';
  for (;;) {
    const connection = connectionOf(asked(operation, board, query(`first: ${PAGE}${after}`), send, addressed));
    if (!connection) fail(operation, board, `${addressed}gh answered no such board`);
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return nodes;
    after = `, after: ${literal(connection.pageInfo.endCursor)}`;
  }
}

/**
 * The board numbered `board.project` among the boards of its owner: its ID, and the ID and
 * options of its field holding the columns, each option as `{ id, name }` in board order.
 */
export function boardOf(operation, board, send) {
  const query = boardQuery(operation, board, `id field(name: ${literal(COLUMNS)}) { ... on ProjectV2SingleSelectField { id options { id name } } }`);
  const project = asked(operation, board, query, send, asking(board))?.repositoryOwner?.projectV2;
  if (!project) fail(operation, board, `${asking(board)}gh answered no such board`);
  if (!project.field?.options) fail(operation, board, `the board has no single-select field named ${COLUMNS}`);
  return { id: project.id, columns: project.field };
}

/** The ID of the repository `board.repo` names as `owner/name`. */
export function repositoryOf(operation, board, send) {
  return asked(operation, board, repositoryQuery(board, 'id'), send).repository.id;
}

/** The fields of an item the read asks for: its field values, and an issue's facts. */
const ITEM = `id fieldValues(first: ${PAGE}) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: ${PAGE}) { pageInfo { hasNextPage } nodes { name } } } }`;

/**
 * Whether the item read answered `node` as a card: an issue in the board's repository. A draft
 * issue, a pull request and another repository's issue are items and not cards. GitHub reads an
 * owner and repository name alike whatever their case, so the names are compared that way too.
 */
const isCard = (board, { content }) =>
  content?.__typename === 'Issue' && content.repository.nameWithOwner.toLowerCase() === board.repo.toLowerCase();

/** The option an item read's `node` holds in the single-select field named `field`, or null. */
const valueIn = (node, field) => node.fieldValues.nodes.find((value) => value.field?.name === field)?.name ?? null;

/**
 * The card an item read answered as `node`: its board item ID, which a move names, the issue's
 * number, title, body and labels, and the column, which is the option it holds in the field
 * holding the columns, or null where it holds none.
 */
function cardOf(operation, board, node) {
  const { content, fieldValues } = node;
  if (content.labels.pageInfo.hasNextPage || fieldValues.pageInfo.hasNextPage) {
    fail(operation, board, `issue #${content.number} holds more than ${PAGE} labels or field values, and a card is read whole or not at all`);
  }
  return {
    id: node.id,
    number: content.number,
    title: content.title,
    body: content.body,
    labels: content.labels.nodes.map((label) => label.name),
    column: valueIn(node, COLUMNS),
  };
}

/**
 * The board's item nodes that are cards, in board order, each once. The board can change between
 * one page and the next, so an item moved meanwhile can be answered on both: it is kept where it
 * first appeared.
 */
function cardNodes(operation, board, send) {
  const query = (page) => boardQuery(operation, board, `items(${page}) { pageInfo { hasNextPage endCursor } nodes { ${ITEM} } }`);
  const nodes = everyPage(operation, board, send, query, (data) => data?.repositoryOwner?.projectV2?.items, asking(board));
  const seen = new Set();
  return nodes.filter((node) => !seen.has(node.id) && seen.add(node.id)).filter((node) => isCard(board, node));
}

/**
 * The options of the board's single-select field named `name`, in board order. Every field is
 * read with its name and type, so a field that is not on the board and a field of another type
 * each fail the read, naming the field, and the type where it has one.
 */
function priorityField(operation, board, send, name) {
  const query = (page) => boardQuery(operation, board, `fields(${page}) { pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2FieldCommon { name dataType } ... on ProjectV2SingleSelectField { options { name } } } }`);
  const field = everyPage(operation, board, send, query, (data) => data?.repositoryOwner?.projectV2?.fields, asking(board))
    .find((held) => held.name === name);
  if (!field) fail(operation, board, `the board has no field named ${name}`);
  if (!field.options) fail(operation, board, `the board's field ${name} is a ${field.dataType} field, not a single-select field`);
  return field.options.map((option) => option.name);
}

/**
 * The board's single-select fields, each as `{ name, options }` with its option names in board
 * order. A field of any other type answers as an empty object, and is left out.
 */
function singleSelectFields(operation, board, send) {
  const query = (page) => boardQuery(operation, board, `fields(${page}) { pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2SingleSelectField { name options { name } } } }`);
  return everyPage(operation, board, send, query, (data) => data?.repositoryOwner?.projectV2?.fields, asking(board))
    .filter((field) => field.options)
    .map((field) => ({ name: field.name, options: field.options.map((option) => option.name) }));
}

/**
 * The reads on `board`, which names its `repo`, its `project` number, its `columns`, the display
 * names the config declares by key, and, where the config declares one, its `owner`. `send`
 * stands in for the runners' spawn in tests.
 */
export function readSide(board, { send } = {}) {
  return {
    /**
     * The columns the config declares, by its keys, each the option of the field holding the
     * columns that the config names. This is where a declared column the board lacks is caught:
     * the read fails naming every one, by key and display name.
     */
    readColumns: async () => {
      const status = singleSelectFields('readColumns', board, send).find((field) => field.name === COLUMNS);
      if (!status) fail('readColumns', board, `the board has no single-select field named ${COLUMNS}`);
      const missing = Object.entries(board.columns).filter(([, name]) => !status.options.includes(name));
      if (missing.length > 0) {
        const named = missing.map(([key, name]) => `${key} (${name})`).join(', ');
        fail('readColumns', board, `its ${COLUMNS} field has no option for the declared column${missing.length > 1 ? 's' : ''} ${named}`);
      }
      return { ...board.columns };
    },
    /** The board's single-select fields but the one holding the columns, as `{ name, options }`. */
    readFields: async () => singleSelectFields('readFields', board, send).filter((field) => field.name !== COLUMNS),
    /** The names of the labels the board's repository holds. */
    readLabels: async () => {
      const query = (page) => repositoryQuery(board, `labels(${page}) { pageInfo { hasNextPage endCursor } nodes { name } }`);
      return everyPage('readLabels', board, send, query, (data) => data?.repository?.labels).map((label) => label.name);
    },
    /** Every card on the board, in board order, each once. */
    readItems: async () => cardNodes('readItems', board, send).map((node) => cardOf('readItems', board, node)),
    /**
     * What L0 hands L3 to rank the board's cards by, from the config's priority declaration, a
     * field and its options highest rank first. It returns `items`, every card as `readItems`
     * reads it with its `priority` as `{ value, declared }`: the option it holds in the declared
     * field, or null, and whether the declaration names that option. Beside them, `declared` is
     * the declared order and `options` the field's own options in board order. Where the config
     * declares no priority, no field is read, and every card's `priority`, `declared` and
     * `options` are null.
     */
    readPriority: async () => {
      const declaration = board.priority;
      const options = declaration ? priorityField('readPriority', board, send, declaration.field) : null;
      const priorityOf = (node) => {
        if (!declaration) return null;
        const value = valueIn(node, declaration.field);
        return { value, declared: declaration.options.includes(value) };
      };
      const items = cardNodes('readPriority', board, send).map((node) => ({ ...cardOf('readPriority', board, node), priority: priorityOf(node) }));
      return { items, declared: declaration ? [...declaration.options] : null, options };
    },
  };
}
