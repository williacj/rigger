// ABOUTME: The fake `gh`: an executable a test places first on `PATH`, answering the forge
// adapter's commands from the fake board. Test-only, and never named from src/.

import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createFakeBoard } from './fake-board.mjs';
import { parseDocument } from '../src/substrate/forge/graphql.mjs';

/** How the fake `gh` names a command it was run with: as the command line itself. */
const spelled = (args) => ['gh', ...args].join(' ');

/**
 * A GraphQL document with every value it carries written as `_` and every list as `[]`, and its
 * whitespace collapsed: what is left is what the request asks for, and not of what.
 */
function shapeOf(document) {
  let shape = document.replace(/"(?:[^"\\\n]|\\.)*"|-?\b\d+(?:\.\d+)?\b/g, '_');
  for (let emptied = shape.replace(/\[[^[\]]*\]/g, '[]'); emptied !== shape; emptied = shape.replace(/\[[^[\]]*\]/g, '[]')) {
    shape = emptied;
  }
  return shape.replace(/\s+/g, ' ').trim();
}

/**
 * The command `args` run as `gh`, written so that two requests differing only in the values they
 * carry are one command: a `gh api graphql -f query=` request is written with its document's
 * shape, and anything else as it was run.
 */
export function commandOf(args) {
  const [subcommand, endpoint, flag, query, ...rest] = args;
  if (subcommand !== 'api' || endpoint !== 'graphql' || flag !== '-f' || !query?.startsWith('query=') || rest.length > 0) {
    return spelled(args);
  }
  return spelled(['api', 'graphql', '-f', `query=${shapeOf(query.slice('query='.length))}`]);
}

/** The command a `gh api graphql -f query=` request carrying a document of `shape` is. */
const graphql = (shape) => commandOf(['api', 'graphql', '-f', `query=${shape}`]);

/** A failure the fake `gh` answers as `gh` does: its message on stderr, and exit 1. */
class GhFailure extends Error {}

/** The first field named `name` among `selections`, looked for depth first. */
function fieldIn(selections, name) {
  for (const selection of selections) {
    if (selection.kind === 'field' && selection.name === name) return selection;
    const found = fieldIn(selection.selections ?? [], name);
    if (found) return found;
  }
  return null;
}

/** The value `field` is given for its argument or input field `name`, as the parser reads it. */
const argument = (field, name) => (field.arguments ?? field.fields).find((held) => held.name === name)?.value;

/** The string or scalar `field` is given for `name`, or undefined where it is given none. */
const valueOf = (field, name) => argument(field, name)?.value;

/** The IDs the fake `gh` gives the board, its fields, their options and the repository. */
const PROJECT_ID = 'PVT_fake';
const REPOSITORY_ID = 'R_fake';
const fieldId = (name) => `PVTSSF_${name}`;
const optionId = (index) => `option-${index}`;

/** The field holding the columns, whose options are the column display names (`ARCHITECTURE.md`). */
const COLUMNS = 'Status';

/**
 * The page of `nodes` a connection selected as `field` answers: `first` of them, after the cursor
 * `after` names. The cursor is the count of nodes before it, which the fake `gh` alone reads.
 */
function page(nodes, field) {
  const start = Number(valueOf(field, 'after') ?? 0);
  const end = start + Number(valueOf(field, 'first'));
  return { pageInfo: { hasNextPage: end < nodes.length, endCursor: String(end) }, nodes: nodes.slice(start, end) };
}

/** A connection nested in an item, selected one page deep with no cursor, as the item read asks. */
const nested = (nodes, field) => ({ pageInfo: { hasNextPage: nodes.length > Number(valueOf(field, 'first')) }, nodes: nodes.slice(0, Number(valueOf(field, 'first'))) });

/** Throws the failure `gh` gives where the board queried is not the one the fake holds. */
function onTheBoard(state, operation) {
  const owner = fieldIn(operation.selections, 'repositoryOwner');
  const project = fieldIn(operation.selections, 'projectV2');
  const [held] = state.repo.split('/');
  if (valueOf(owner, 'login').toLowerCase() !== held.toLowerCase() || Number(valueOf(project, 'number')) !== state.project) {
    throw new GhFailure(`gh: Could not resolve to a ProjectV2 with the number ${valueOf(project, 'number')}.`);
  }
}

/** Throws the failure `gh` gives where the repository queried is not the one the fake holds. */
function inTheRepository(state, operation) {
  const repository = fieldIn(operation.selections, 'repository');
  const asked = `${valueOf(repository, 'owner')}/${valueOf(repository, 'name')}`;
  if (asked.toLowerCase() !== state.repo.toLowerCase()) {
    throw new GhFailure(`gh: Could not resolve to a Repository with the name '${asked}'.`);
  }
}

/** The board's single-select fields as GitHub holds them: the one holding the columns, and the rest. */
async function fieldsOf(board) {
  const columns = await board.operations.readColumns();
  return [{ name: COLUMNS, options: columns }, ...(await board.operations.readFields())];
}

/** The content of an item as the item read's selection answers it, by the item's type. */
function contentOf(item, operation) {
  if (item.type === 'draftIssue') return { __typename: 'DraftIssue' };
  if (item.type === 'pullRequest') return { __typename: 'PullRequest' };
  const labels = (item.labels ?? []).map((name) => ({ name }));
  return {
    __typename: 'Issue',
    number: item.number,
    title: item.title ?? '',
    body: item.body ?? '',
    repository: { nameWithOwner: item.repository },
    labels: nested(labels, fieldIn(operation.selections, 'labels')),
  };
}

/** An item as the item read's selection answers it. */
function itemNode(item, operation) {
  const values = Object.entries({ ...(item.column ? { [COLUMNS]: item.column } : {}), ...(item.fieldValues ?? {}) })
    .map(([field, name]) => ({ name, field: { name: field } }));
  return { id: item.id, fieldValues: nested(values, fieldIn(operation.selections, 'fieldValues')), content: contentOf(item, operation) };
}

/** A board query selecting `selection` on the board, as the forge adapter's read side writes it. */
const boardShape = (selection) => `query { repositoryOwner(login: _) { ... on ProjectV2Owner { projectV2(number: _) { ${selection} } } } }`;

/** A repository query selecting `selection`, as the forge adapter's read side writes it. */
const repositoryShape = (selection) => `query { repository(owner: _, name: _) { ${selection} } }`;

/** The fields of an item the item read selects. */
const ITEM = 'id fieldValues(first: _) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: _) { pageInfo { hasNextPage } nodes { name } } } }';

/** Answers a page of the board's items. */
async function items(board, state, operation) {
  onTheBoard(state, operation);
  const nodes = (await board.operations.readItems()).map((item) => itemNode(item, operation));
  return { repositoryOwner: { projectV2: { items: page(nodes, fieldIn(operation.selections, 'items')) } } };
}

/** Answers a page of the repository's labels. */
async function labels(board, state, operation) {
  inTheRepository(state, operation);
  const nodes = (await board.operations.readLabels()).map((name) => ({ name }));
  return { repository: { labels: page(nodes, fieldIn(operation.selections, 'labels')) } };
}

/**
 * The commands the fake `gh` answers, each keyed by how `commandOf` writes it, with what answers
 * it: the data `gh` prints, given the board, the fake's state and the document's one operation.
 * Nothing else is answered: an unmodelled command fails, printing itself.
 */
const COMMANDS = {
  [graphql(boardShape(`items(first: _) { pageInfo { hasNextPage endCursor } nodes { ${ITEM} } }`))]: items,
  [graphql(boardShape(`items(first: _, after: _) { pageInfo { hasNextPage endCursor } nodes { ${ITEM} } }`))]: items,
  [graphql(boardShape('fields(first: _) { pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2SingleSelectField { name options { name } } } }'))]: async (board, state, operation) => {
    onTheBoard(state, operation);
    const nodes = (await fieldsOf(board)).map(({ name, options }) => ({ name, options: options.map((option) => ({ name: option })) }));
    return { repositoryOwner: { projectV2: { fields: page(nodes, fieldIn(operation.selections, 'fields')) } } };
  },
  [graphql(repositoryShape('labels(first: _) { pageInfo { hasNextPage endCursor } nodes { name } }'))]: labels,
  [graphql(repositoryShape('labels(first: _, after: _) { pageInfo { hasNextPage endCursor } nodes { name } }'))]: labels,
};

/** The board a fake `gh` answers from: the model it was given, with every write since replayed. */
async function boardOf(state) {
  const board = createFakeBoard(state.model);
  for (const { operation, args } of state.writes) await board.operations[operation](...args);
  return board;
}

/**
 * Answers the command this process was run with from the board held at `statePath`. What it
 * prints and its exit code are what `gh` would give; a command it does not model fails, printing
 * itself.
 */
export async function main(statePath) {
  const args = process.argv.slice(2);
  const answer = COMMANDS[commandOf(args)];
  if (!answer) {
    process.stderr.write(`the fake gh does not model \`${spelled(args)}\`\n`);
    process.exitCode = 1;
    return;
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const board = await boardOf(state);
  let data;
  try {
    data = await answer(board, state, parseDocument(args[3].slice('query='.length)).operations[0]);
  } catch (error) {
    if (!(error instanceof GhFailure)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(statePath, JSON.stringify({ ...state, writes: board.writes() }));
  process.stdout.write(`${JSON.stringify({ data })}\n`);
}

/**
 * Installs a fake `gh` in `dir`, answering as `gh` would for the board numbered `project` among
 * the boards of `repo`'s owner, which holds `board`: the fake board's own arguments.
 *
 * It returns the executable's path, `gh`, and `model()`, the fake board as the fake `gh` now holds
 * it, whose write record holds every write the fake `gh` was sent.
 */
export function installFakeGh(dir, { repo, project, board = {} }) {
  const statePath = join(dir, 'board.json');
  writeFileSync(statePath, JSON.stringify({ repo, project, model: board, writes: [] }));
  const gh = join(dir, 'gh');
  // CommonJS, because nothing beside it says otherwise, and so it loads this module dynamically.
  const entry = `import(${JSON.stringify(import.meta.url)}).then(({ main }) => main(${JSON.stringify(statePath)}));\n`;
  writeFileSync(gh, `#!${process.execPath}\n${entry}`);
  chmodSync(gh, 0o755);
  return { gh, model: () => boardOf(JSON.parse(readFileSync(statePath, 'utf8'))) };
}
