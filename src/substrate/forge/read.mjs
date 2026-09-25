// ABOUTME: The forge adapter's read side: the board's cards, columns and single-select fields and
// the repository's labels, and the IDs a write names, each read through the read runner.

import { literal } from './graphql.mjs';
import { COLUMNS, firstLine, graphqlRequest, readRunner } from './runners.mjs';

/** The most nodes GitHub answers in one page of a connection. */
const PAGE = 100;

/**
 * The data `gh` answered to a request made for `operation` on `board`. Where `gh` did not answer
 * 0, it throws an error naming the operation, the board number and the first line `gh` said.
 */
export function answerOf(operation, board, said) {
  if (said.status !== 0) throw new Error(`${operation} on board ${board.project} failed: ${firstLine(said)}`);
  return JSON.parse(said.stdout).data;
}

/** What `gh` answered to the read `query`, made for `operation` on `board`. */
const asked = (operation, board, query, send) => answerOf(operation, board, readRunner(graphqlRequest(query), { send }));

/** Throws the error a read gives when the board answered something it cannot use. */
function fail(operation, board, why) {
  throw new Error(`${operation} on board ${board.project} failed: ${why}`);
}

/**
 * A query selecting `selection` on the board numbered `board.project` among the boards of
 * `board.repo`'s owner.
 *
 * The config names a repository and a board number, and no board owner, so the board is read as
 * the repository owner's.
 */
function boardQuery(operation, board, selection) {
  if (!Number.isInteger(board.project)) {
    throw new Error(`${operation} failed: the board number is ${board.project}, which is not a board number`);
  }
  const [owner] = board.repo.split('/');
  return `query { repositoryOwner(login: ${literal(owner)}) { ... on ProjectV2Owner { projectV2(number: ${board.project}) { ${selection} } } } }`;
}

/**
 * Every node of a connection, read a page at a time. `query` builds a page's document from its
 * `after` argument, and `connectionOf` finds the connection in what `gh` answered. A page that
 * fails fails the whole read, so no part of it is returned.
 */
function everyPage(operation, board, send, query, connectionOf) {
  const nodes = [];
  let after = '';
  for (;;) {
    const connection = connectionOf(asked(operation, board, query(`first: ${PAGE}${after}`), send));
    if (!connection) fail(operation, board, 'gh answered no such board');
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return nodes;
    after = `, after: ${literal(connection.pageInfo.endCursor)}`;
  }
}

/**
 * The board numbered `board.project` among the boards of `board.repo`'s owner: its ID, and the ID
 * and options of its field holding the columns, each option as `{ id, name }` in board order.
 */
export function boardOf(operation, board, send) {
  const query = boardQuery(operation, board, `id field(name: ${literal(COLUMNS)}) { ... on ProjectV2SingleSelectField { id options { id name } } }`);
  const project = asked(operation, board, query, send)?.repositoryOwner?.projectV2;
  if (!project?.field?.options) fail(operation, board, `the board has no single-select field named ${COLUMNS}`);
  return { id: project.id, columns: project.field };
}

/** The ID of the repository `board.repo` names as `owner/name`. */
export function repositoryOf(operation, board, send) {
  const [owner, name] = board.repo.split('/');
  const query = `query { repository(owner: ${literal(owner)}, name: ${literal(name)}) { id } }`;
  return asked(operation, board, query, send).repository.id;
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
    column: fieldValues.nodes.find((value) => value.field?.name === COLUMNS)?.name ?? null,
  };
}

/**
 * The reads on `board`, which names its `repo`, its `project` number and its `columns`, the
 * display names the config declares by key. `send` stands in for the runners' spawn in tests.
 */
export function readSide(board, { send } = {}) {
  return {
    /** Every card on the board, in board order. */
    readItems: async () => {
      const query = (page) => boardQuery('readItems', board, `items(${page}) { pageInfo { hasNextPage endCursor } nodes { ${ITEM} } }`);
      const nodes = everyPage('readItems', board, send, query, (data) => data?.repositoryOwner?.projectV2?.items);
      return nodes.filter((node) => isCard(board, node)).map((node) => cardOf('readItems', board, node));
    },
  };
}
