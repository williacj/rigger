// ABOUTME: The fake `gh`: an executable a test places first on `PATH`, answering the forge
// adapter's commands from the fake board and the fake repository, and an agent's `gh pr`
// commands from the fake repository. Test-only, and never named from src/.

import { chmodSync, closeSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createFakeBoard } from './fake-board.mjs';
import { parseDocument } from '../src/substrate/forge/graphql.mjs';
import { dirname } from 'node:path';
import { branchesIn, checkedOut, commentOf, comparedIn, createFakeRepository, headIn } from './fake-repository.mjs';
import { EXIT_IF_WARMING, warmed } from './process-fixtures.mjs';

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
 * A REST read under `repos/` is written with its path's shape, as `pathShapeOf` gives it.
 */
export function commandOf(args) {
  const [subcommand, endpoint, flag, query, ...rest] = args;
  if (subcommand === 'api' && endpoint?.startsWith('repos/')) {
    const path = pathShapeOf(endpoint);
    const fields = args.slice(2).map((word) => path.endsWith('/merge') && word.startsWith('sha=') ? 'sha=_' : path.endsWith('/comments') && word.startsWith('body=') ? 'body=_' : word);
    return spelled(['api', path, ...fields]);
  }
  if (subcommand !== 'api' || endpoint !== 'graphql' || flag !== '-f' || !query?.startsWith('query=') || rest.length > 0) {
    return spelled(args);
  }
  return spelled(['api', 'graphql', '-f', `query=${shapeOf(query.slice('query='.length))}`]);
}

/** The command a `gh api graphql -f query=` request carrying a document of `shape` is. */
const graphql = (shape) => commandOf(['api', 'graphql', '-f', `query=${shape}`]);

/** A failure the fake `gh` answers as `gh` does: its message on stderr, and exit 1. */
class GhFailure extends Error {}

/**
 * A REST path under `repos/` with the repository written as `_/_`, every number in it as `_`, and
 * the two sides a comparison names as `_..._`, so one command answers every pull request, and
 * every comparison, of every repository. A base branch's name can hold a `/`, so a comparison's
 * sides are the whole of the path after `compare/`.
 */
function pathShapeOf(path) {
  const tail = path.split('/').slice(3).join('/');
  if (/^rules\/branches\/[^?]+\?per_page=100&page=\d+$/.test(tail)) return 'repos/_/_/rules/branches/_?per_page=100&page=_';
  if (/^branches\/[^/]+\/protection$/.test(tail)) return 'repos/_/_/branches/_/protection';
  if (/^commits\/[^/]+\/(check-runs|statuses)\?per_page=100&page=\d+$/.test(tail)) return `repos/_/_/commits/_/${tail.split('/')[2].replace(/page=\d+$/, 'page=_')}`;
  if (/^collaborators\/[^/]+\/permission$/.test(tail)) return 'repos/_/_/collaborators/_/permission';
  if (tail.startsWith('compare/') && tail.includes('...')) return 'repos/_/_/compare/_..._';
  return `repos/_/_/${tail.split('/').map((segment) => (/^\d+$/.test(segment) ? '_' : segment)).join('/')}`;
}

/**
 * A failure of a request answered over HTTP, which `gh` reports as it does any failure and for
 * which it also prints the response's body, `printed`, on stdout.
 */
class GhPrinted extends GhFailure {
  constructor(message, printed) {
    super(message);
    this.printed = printed;
  }
}

/** What the fake `gh` says of a command it does not model: the command, as it was run. */
const notModelled = (args) => `the fake gh does not model \`${spelled(args)}\``;

/** The failure of a command the fake `gh` does not model, which `gh` itself might have answered. */
class NotModelled extends GhFailure {
  constructor(args) {
    super(notModelled(args));
  }
}

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
  const held = state.owner ?? state.repo.split('/')[0];
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

/**
 * A field's options as GitHub answers them, each with its ID, colour and description. The fake
 * board holds an option's name alone, so every option is given the neutral grey and no
 * description, which is what the schema-write side gives an option it adds.
 */
const optionsOf = (field) => field.options.map((name, index) => ({ id: optionId(index), name, color: 'GRAY', description: '' }));

/** The content of an item as the item read's selection answers it, by the item's type. */
function contentOf(item, operation) {
  if (item.type === 'redacted') return null;
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

/** The fields of an item the report of other repositories selects. */
const OWNED_ITEM = 'id type content { ... on Issue { repository { nameWithOwner } } ... on PullRequest { repository { nameWithOwner } } }';

/** The `ProjectV2ItemType` GitHub answers for an item of each type the fake board holds. */
const ITEM_TYPES = { issue: 'ISSUE', pullRequest: 'PULL_REQUEST', draftIssue: 'DRAFT_ISSUE', redacted: 'REDACTED' };

/**
 * An item as the report of other repositories selects it. An issue or pull request answers its
 * repository, a draft answers its content as an empty object, matching neither fragment.
 *
 * A redacted item's answer is constructed from the schema, not captured: `ProjectV2ItemType`
 * holds `REDACTED`, and no redacted item has been seen on a real board (the architect's ruling on
 * #285, comment 5835129833). Its content is answered as null, which the schema allows.
 */
function ownedItemNode(item) {
  const content = { issue: { repository: { nameWithOwner: item.repository } }, draftIssue: {}, redacted: null };
  content.pullRequest = content.issue;
  return { id: item.id, type: ITEM_TYPES[item.type], content: content[item.type] };
}

/** Answers a page of the board's items as the report of other repositories selects them. */
async function ownedItems(board, state, operation) {
  onTheBoard(state, operation);
  const nodes = (await board.operations.readItems()).map(ownedItemNode);
  return { repositoryOwner: { projectV2: { items: page(nodes, fieldIn(operation.selections, 'items')) } } };
}

/** The type GitHub names a single-select field by. */
const SINGLE_SELECT = 'SINGLE_SELECT';

/** What the typed field query selects of a page of fields: every field's name and type. */
const TYPED_FIELD = 'pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2FieldCommon { name dataType } ... on ProjectV2SingleSelectField { options { name } } }';

/**
 * Answers a page of the typed field query: every field with its name and type, and a
 * single-select field with its options too, as GitHub answers it.
 */
async function typedFields(board, state, operation) {
  onTheBoard(state, operation);
  const selects = await fieldsOf(board);
  const nodes = (await board.operations.readFieldTypes()).map(({ name, type }) => {
    if (type !== SINGLE_SELECT) return { name, dataType: type };
    return { name, dataType: type, options: selects.find((field) => field.name === name).options.map((option) => ({ name: option })) };
  });
  return { repositoryOwner: { projectV2: { fields: page(nodes, fieldIn(operation.selections, 'fields')) } } };
}

/** Answers a page of the repository's labels. */
async function labels(board, state, operation) {
  inTheRepository(state, operation);
  const nodes = (await board.operations.readLabels()).map((name) => ({ name }));
  return { repository: { labels: page(nodes, fieldIn(operation.selections, 'labels')) } };
}

/**
 * The repository the fake `gh` answers from: the one the test seeded, as every agent command
 * since has left it. By default it holds no branch, no pull request and no edit.
 */
const repositoryOf = (state) => createFakeRepository(state.repository ?? {});

/** The address GitHub gives pull request `number` of the fake's repository. */
const pullUrl = (state, number) => `https://github.com/${state.repo}/pull/${number}`;

/** What the pull request read selects of a page of pull requests. */
const PULLS = 'pageInfo { hasNextPage endCursor } nodes { number state headRefOid baseRefName headRepository { nameWithOwner } }';

/** Answers a page of the pull requests from the branch the read names, open and merged. */
async function pullRequests(board, state, operation) {
  inTheRepository(state, operation);
  const field = fieldIn(operation.selections, 'pullRequests');
  const nodes = repositoryOf(state).held().pullRequests
    .filter((pull) => pull.head === valueOf(field, 'headRefName'))
    .map((pull) => ({ number: pull.number, state: pull.merged ? 'MERGED' : 'OPEN', headRefOid: pull.sha, baseRefName: pull.base, headRepository: { nameWithOwner: pull.from ?? state.repo } }));
  return { repository: { pullRequests: page(nodes, field) } };
}

/** What the branch read selects of a page of branches. */
const NAMES = 'pageInfo { hasNextPage endCursor } nodes { name }';

/**
 * Answers a page of the repository's branches: those the test seeded, those an opened pull
 * request is from, and, where the fake was given the test's `origin`, every branch it holds.
 */
async function branches(board, state, operation) {
  inTheRepository(state, operation);
  const names = [...new Set([...repositoryOf(state).held().branches, ...(state.origin ? branchesIn(state.origin) : [])])];
  return { repository: { refs: page(names.map((name) => ({ name })), fieldIn(operation.selections, 'refs')) } };
}

/** The pull request the read names, or the failure `gh` gives for a number the repository lacks. */
function pullNamed(state, operation) {
  const number = Number(valueOf(fieldIn(operation.selections, 'pullRequest'), 'number'));
  const pull = repositoryOf(state).pull(number);
  if (!pull) throw new GhFailure(`gh: Could not resolve to a PullRequest with the number of ${number}.`);
  return pull;
}

/** What the comment read selects of a page of comments. */
const COMMENTS = 'pageInfo { hasNextPage endCursor } nodes { body createdAt id author { login } lastEditedAt includesCreatedEdit }';

/** Answers a page of a pull request's comments, oldest first. */
async function comments(board, state, operation) {
  inTheRepository(state, operation);
  const pull = pullNamed(state, operation);
  return { repository: { pullRequest: { comments: page(pull.comments.map((comment, index) => commentOf(comment, pull.number, index)), fieldIn(operation.selections, 'comments')) } } };
}

/** What GitHub answers over REST for a path it holds nothing at, as `gh` reports it. */
const notFound = (documentation) => new GhPrinted('gh: Not Found (HTTP 404)', JSON.stringify({ message: 'Not Found', documentation_url: documentation, status: '404' }));

/** The path a REST read asks for, below the repository, or a 404 where the repository is not the fake's. */
function pathIn(state, args) {
  const [, owner, name, ...rest] = args[1].split('/');
  if (`${owner}/${name}`.toLowerCase() !== state.repo.toLowerCase()) throw notFound('https://docs.github.com/rest');
  return rest.join('/');
}

/**
 * The commands the fake `gh` answers, each keyed by how `commandOf` writes it, with what answers
 * it. A GraphQL request's answer is the data `gh` prints, given the board, the fake's state and the
 * document's one operation; a REST read's is the text `gh` prints, given the board, the fake's
 * state and the command's arguments. Nothing else is answered: an unmodelled command fails,
 * printing itself.
 */
const COMMANDS = {
  [graphql(boardShape(`items(first: _) { pageInfo { hasNextPage endCursor } nodes { ${ITEM} } }`))]: items,
  [graphql(boardShape(`items(first: _, after: _) { pageInfo { hasNextPage endCursor } nodes { ${ITEM} } }`))]: items,
  [graphql(boardShape(`items(first: _) { pageInfo { hasNextPage endCursor } nodes { ${OWNED_ITEM} } }`))]: ownedItems,
  [graphql(boardShape(`items(first: _, after: _) { pageInfo { hasNextPage endCursor } nodes { ${OWNED_ITEM} } }`))]: ownedItems,
  // A field of any other type answers the single-select fragment as an empty object, as GitHub does.
  [graphql(boardShape('fields(first: _) { pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2SingleSelectField { name options { name } } } }'))]: async (board, state, operation) => {
    onTheBoard(state, operation);
    const selects = await fieldsOf(board);
    const nodes = (await board.operations.readFieldTypes()).map(({ name, type }) => {
      if (type !== SINGLE_SELECT) return {};
      return { name, options: selects.find((field) => field.name === name).options.map((option) => ({ name: option })) };
    });
    return { repositoryOwner: { projectV2: { fields: page(nodes, fieldIn(operation.selections, 'fields')) } } };
  },
  [graphql(boardShape(`fields(first: _) { ${TYPED_FIELD} }`))]: typedFields,
  [graphql(boardShape(`fields(first: _, after: _) { ${TYPED_FIELD} }`))]: typedFields,
  [graphql(repositoryShape('labels(first: _) { pageInfo { hasNextPage endCursor } nodes { name } }'))]: labels,
  [graphql(repositoryShape('labels(first: _, after: _) { pageInfo { hasNextPage endCursor } nodes { name } }'))]: labels,
  [graphql(repositoryShape('id'))]: async (board, state, operation) => {
    inTheRepository(state, operation);
    return { repository: { id: REPOSITORY_ID } };
  },
  [graphql(boardShape('id field(name: _) { ... on ProjectV2SingleSelectField { id options { id name color description } } }'))]: async (board, state, operation) => {
    onTheBoard(state, operation);
    const named = valueOf(fieldIn(operation.selections, 'field'), 'name');
    const field = (await fieldsOf(board)).find(({ name }) => name === named);
    return { repositoryOwner: { projectV2: { id: PROJECT_ID, field: field ? { id: fieldId(field.name), options: optionsOf(field) } : null } } };
  },
  // The schema-write runner's own read: the name and options of the field an options write names.
  [graphql('query { field: node(id: _) { ... on ProjectV2SingleSelectField { name options { id name color description } } } }')]: async (board, state, operation) => {
    const [node] = operation.selections;
    const field = (await fieldsOf(board)).find(({ name }) => fieldId(name) === valueOf(node, 'id'));
    if (!field) throw new GhFailure(`gh: Could not resolve to a node with the global id of '${valueOf(node, 'id')}'`);
    return { field: { name: field.name, options: optionsOf(field) } };
  },
  // Way B, the one options write the fake models: every held option sent with its id, name, colour
  // and description as the fake answers them, and at least one new option without an id, which it
  // adds as a column in the order sent. Anything else it does not model.
  [graphql('mutation { updateProjectV2Field(input: {fieldId: _, singleSelectOptions: []}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }')]: async (board, state, operation) => {
    const input = argument(operation.selections[0], 'input');
    const id = valueOf(input, 'fieldId');
    if (id !== fieldId(COLUMNS)) throw new GhFailure(`gh: Could not resolve to a node with the global id of '${id}'`);
    const sent = argument(input, 'singleSelectOptions').values;
    const held = optionsOf((await fieldsOf(board))[0]);
    const echoed = (option) => sent.some((entry) => ['id', 'name', 'color', 'description'].every((name) => valueOf(entry, name) === option[name]));
    const added = sent.filter((option) => valueOf(option, 'id') === undefined);
    if (!held.every(echoed) || added.length === 0) {
      throw new GhFailure('the fake gh does not model an updateProjectV2Field that leaves out or changes a held option, or adds none');
    }
    for (const entry of added) await board.operations.createColumn(valueOf(entry, 'name'));
    return { updateProjectV2Field: { projectV2Field: { id } } };
  },
  // The item-write runner's own read: which field of the board holds the columns, and what the
  // field a write names is called. Its two nodes are answered under the aliases it gives them.
  [graphql('query { project: node(id: _) { ... on ProjectV2 { field(name: _) { ... on ProjectV2SingleSelectField { id } } } } target: node(id: _) { ... on ProjectV2FieldCommon { name } } }')]: async (board, state, operation) => {
    const [project, target] = operation.selections;
    const fields = await fieldsOf(board);
    const field = fields.find(({ name }) => fieldId(name) === valueOf(target, 'id'));
    const named = valueOf(fieldIn(project.selections, 'field'), 'name');
    const held = fields.some(({ name }) => name === named);
    return {
      project: valueOf(project, 'id') === PROJECT_ID ? { field: held ? { id: fieldId(named) } : null } : null,
      target: field ? { name: field.name } : null,
    };
  },
  [graphql('mutation { updateProjectV2ItemFieldValue(input: {projectId: _, itemId: _, fieldId: _, value: {singleSelectOptionId: _}}) { projectV2Item { id } } }')]: async (board, state, operation) => {
    const input = argument(operation.selections[0], 'input');
    const [projectId, itemId, field] = ['projectId', 'itemId', 'fieldId'].map((name) => valueOf(input, name));
    const option = valueOf(argument(input, 'value'), 'singleSelectOptionId');
    const columns = await board.operations.readColumns();
    const column = columns.find((_, index) => optionId(index) === option);
    const item = (await board.operations.readItems()).find(({ id }) => id === itemId);
    for (const [id, found] of [[projectId, projectId === PROJECT_ID], [itemId, item], [field, field === fieldId(COLUMNS)], [option, column]]) {
      if (!found) throw new GhFailure(`gh: Could not resolve to a node with the global id of '${id}'`);
    }
    await board.operations.moveItem(itemId, column);
    return { updateProjectV2ItemFieldValue: { projectV2Item: { id: itemId } } };
  },
  [graphql('mutation { createProjectV2Field(input: {projectId: _, dataType: SINGLE_SELECT, name: _, singleSelectOptions: []}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }')]: async (board, state, operation) => {
    const input = argument(operation.selections[0], 'input');
    if (valueOf(input, 'projectId') !== PROJECT_ID) throw new GhFailure(`gh: Could not resolve to a node with the global id of '${valueOf(input, 'projectId')}'`);
    const name = valueOf(input, 'name');
    await board.operations.createField(name, argument(input, 'singleSelectOptions').values.map((option) => valueOf(option, 'name')));
    return { createProjectV2Field: { projectV2Field: { id: fieldId(name) } } };
  },
  [graphql('mutation { createLabel(input: {repositoryId: _, name: _, color: _}) { label { id } } }')]: async (board, state, operation) => {
    const input = argument(operation.selections[0], 'input');
    if (valueOf(input, 'repositoryId') !== REPOSITORY_ID) throw new GhFailure(`gh: Could not resolve to a node with the global id of '${valueOf(input, 'repositoryId')}'`);
    await board.operations.createLabel(valueOf(input, 'name'));
    return { createLabel: { label: { id: `LA_${valueOf(input, 'name')}` } } };
  },
  // The repository reads: a card's line of work and its pull requests.
  [graphql(repositoryShape(`pullRequests(headRefName: _, states: [], first: _) { ${PULLS} }`))]: pullRequests,
  [graphql(repositoryShape(`pullRequests(headRefName: _, states: [], first: _, after: _) { ${PULLS} }`))]: pullRequests,
  [graphql(repositoryShape(`refs(refPrefix: _, first: _) { ${NAMES} }`))]: branches,
  [graphql(repositoryShape(`refs(refPrefix: _, first: _, after: _) { ${NAMES} }`))]: branches,
  [graphql(repositoryShape(`pullRequest(number: _) { comments(first: _) { ${COMMENTS} } }`))]: comments,
  [graphql(repositoryShape(`pullRequest(number: _) { comments(first: _, after: _) { ${COMMENTS} } }`))]: comments,
  [graphql(repositoryShape('pullRequest(number: _) { baseRefName headRefOid }'))]: async (board, state, operation) => {
    inTheRepository(state, operation);
    const { base, sha } = pullNamed(state, operation);
    return { repository: { pullRequest: { baseRefName: base, headRefOid: sha } } };
  },
  [graphql(repositoryShape('pullRequest(number: _) { mergeable }'))]: async (board, state, operation) => {
    inTheRepository(state, operation);
    const pull = pullNamed(state, operation);
    return { repository: { pullRequest: { mergeable: state.repository?.mergeable?.[pull.number] ?? 'UNKNOWN' } } };
  },
  // A pull request's diff, or the forge's refusal to serve it, which GitHub gives as HTTP 406.
  [commandOf(['api', 'repos/_/_/pulls/_', '-X', 'GET', '-H', 'Accept: application/vnd.github.diff'])]: async (board, state, args) => {
    const pull = repositoryOf(state).pull(Number(pathIn(state, args).split('/')[1]));
    if (!pull) throw notFound('https://docs.github.com/rest/pulls/pulls#get-a-pull-request');
    if (pull.declined) throw new GhPrinted(`gh: ${pull.declined} (HTTP 406)`, JSON.stringify({ message: pull.declined, errors: [{ resource: 'PullRequest', field: 'diff', code: 'too_large' }], status: '406' }));
    return pull.diff;
  },
  // The comparison of a pull request's base and head, answered with the merge base the fake holds
  // for that pull request, or, where the fake was given the test's `origin`, the one git finds there.
  [commandOf(['api', 'repos/_/_/compare/_..._', '-X', 'GET'])]: async (board, state, args) => {
    const [base, head] = pathIn(state, args).slice('compare/'.length).split('...');
    const held = repositoryOf(state).held().pullRequests.find((pull) => pull.base === base && pull.sha === head && pull.mergeBase !== null);
    const mergeBase = held?.mergeBase ?? (state.origin ? comparedIn(state.origin, base, head).mergeBase : null);
    if (!mergeBase) throw notFound('https://docs.github.com/rest/commits/commits#compare-two-commits');
    return JSON.stringify({ merge_base_commit: { sha: mergeBase } });
  },
  [commandOf(['api', 'repos/_/_/collaborators/_/permission', '-X', 'GET'])]: async (board, state, args) => {
    const path = pathIn(state, args);
    const login = decodeURIComponent(path.split('/')[1]);
    const refused = state.repository?.permissionFailures?.[login];
    if (refused) throw new GhPrinted(`gh: ${refused.message} (HTTP ${refused.status})`, JSON.stringify(refused));
    const role = state.repository?.permissions?.[login] ?? (state.repository?.permissions ? null : 'write');
    if (role === null) throw notFound('https://docs.github.com/rest/collaborators/collaborators#get-repository-permissions-for-a-user');
    return JSON.stringify({ permission: { maintain: 'write', triage: 'read' }[role] ?? role, role_name: role });
  },
  [commandOf(['api', 'repos/_/_/commits/_/check-runs?per_page=100&page=_', '-X', 'GET'])]: async (board, state, args) => {
    const path = pathIn(state, args);
    const [, sha, endpoint] = path.split('/');
    const refused = state.repository?.checkFailures?.[sha];
    if (refused) throw new GhPrinted(`gh: ${refused.message} (HTTP ${refused.status})`, JSON.stringify(refused));
    const pageNumber = Number(new URLSearchParams(endpoint.split('?')[1]).get('page'));
    const all = state.repository?.checks?.[sha] ?? [];
    return JSON.stringify({ total_count: all.length, check_runs: all.slice((pageNumber - 1) * 100, pageNumber * 100) });
  },
  [commandOf(['api', 'repos/_/_/commits/_/statuses?per_page=100&page=_', '-X', 'GET'])]: async (board, state, args) => {
    const path = pathIn(state, args);
    const [, sha, endpoint] = path.split('/');
    const pageNumber = Number(new URLSearchParams(endpoint.split('?')[1]).get('page'));
    return JSON.stringify((state.repository?.statuses?.[sha] ?? []).slice((pageNumber - 1) * 100, pageNumber * 100));
  },
  [commandOf(['api', 'repos/_/_/rules/branches/_?per_page=100&page=_', '-X', 'GET'])]: async (board, state, args) => {
    const path = pathIn(state, args);
    const branch = decodeURIComponent(path.split('/')[2].split('?')[0]);
    const refused = state.repository?.ruleFailures?.[branch];
    if (refused) throw new GhPrinted(`gh: ${refused.message} (HTTP ${refused.status})`, JSON.stringify(refused));
    const pageNumber = Number(new URLSearchParams(path.split('?')[1]).get('page'));
    const active = (state.repository?.rules?.[branch] ?? []).filter((rule) => rule.enforcement === undefined || rule.enforcement === 'active');
    return JSON.stringify(active.slice((pageNumber - 1) * 100, pageNumber * 100).map(({ enforcement, ...rule }) => rule));
  },
  [commandOf(['api', 'repos/_/_/branches/_/protection', '-X', 'GET'])]: async (board, state, args) => {
    const branch = decodeURIComponent(pathIn(state, args).split('/')[1]);
    const protection = state.repository?.protections?.[branch];
    if (protection === undefined) throw new GhPrinted('gh: Branch not protected (HTTP 404)', JSON.stringify({ message: 'Branch not protected', status: '404' }));
    return JSON.stringify(protection);
  },
  [commandOf(['api', 'repos/_/_/pulls/_', '-X', 'GET'])]: async (board, state, args) => {
    const number = Number(pathIn(state, args).split('/')[1]);
    const pull = repositoryOf(state).pull(number);
    if (!pull) throw notFound('https://docs.github.com/rest/pulls/pulls#get-a-pull-request');
    return JSON.stringify({ state: state.repository?.pullStates?.[number] ?? (pull.merged ? 'closed' : 'open'), merged: pull.merged, mergeable: state.repository?.mergeable && Object.hasOwn(state.repository.mergeable, number) ? state.repository.mergeable[number] : true, head: { sha: pull.sha }, merge_commit_sha: state.repository?.mainSha ?? null });
  },
  [commandOf(['api', 'repos/_/_/pulls/_/merge', '-X', 'PUT', '-f', 'sha=_', '-f', 'merge_method=merge'])]: async (board, state, args) => {
    const number = Number(pathIn(state, args).split('/')[1]);
    const pull = state.repository?.pullRequests?.find((candidate) => candidate.number === number);
    if (!pull) throw notFound('https://docs.github.com/rest/pulls/pulls#merge-a-pull-request');
    const expected = args[5].slice('sha='.length);
    if (pull.sha !== expected) throw new GhPrinted('gh: Conflict (HTTP 409)', JSON.stringify({ status: '409', message: 'Head branch was modified. Review and try the merge again.' }));
    if (pull.merged) return JSON.stringify({ sha: state.repository.mainSha, merged: true, message: 'Pull Request successfully merged' });
    const reply = state.repository?.mergeReplies?.[number];
    if (reply) throw new GhPrinted(`gh: Method Not Allowed (HTTP ${reply.status})`, JSON.stringify(reply));
    pull.merged = true;
    state.repository.mainSha = 'm'.repeat(40);
    return JSON.stringify({ sha: state.repository.mainSha, merged: true, message: 'Pull Request successfully merged' });
  },
  [commandOf(['api', 'repos/_/_/issues/_/comments', '-X', 'POST', '-f', 'body=_'])]: async (board, state, args) => {
    const number = Number(pathIn(state, args).split('/')[1]);
    const pull = state.repository?.pullRequests?.find((candidate) => candidate.number === number);
    if (!pull) throw notFound('https://docs.github.com/rest/issues/comments#create-an-issue-comment');
    const refused = state.repository?.commentReplies?.[number];
    if (refused) throw new GhPrinted(`gh: ${refused.message} (HTTP ${refused.status})`, JSON.stringify(refused));
    const body = args[5].slice('body='.length);
    pull.comments ??= [];
    pull.comments.push({ body, createdAt: now() });
    return JSON.stringify({ id: pull.comments.length, body });
  },
};

/** Every command the fake `gh` answers, as `commandOf` writes it. */
export const ANSWERED = Object.keys(COMMANDS);

/**
 * The flags each agent command is modelled with, by every spelling `gh` gives it, each with the
 * name it is read under. A flag outside these is not modelled.
 */
const FLAGS = {
  create: { '--head': 'head', '-H': 'head', '--base': 'base', '-B': 'base', '--title': 'title', '-t': 'title', '--body': 'body', '-b': 'body', '--body-file': 'bodyFile', '-F': 'bodyFile', '--repo': 'repo', '-R': 'repo', '--fill': 'fill', '-f': 'fill', '--draft': 'draft', '-d': 'draft' },
  comment: { '--body': 'body', '-b': 'body', '--body-file': 'bodyFile', '-F': 'bodyFile', '--repo': 'repo', '-R': 'repo' },
  view: { '--json': 'json', '--repo': 'repo', '-R': 'repo' },
  diff: { '--color': 'color', '--repo': 'repo', '-R': 'repo' },
};

/** The flags among `FLAGS` that take no value, read as `true` where they are given. */
const SWITCHES = new Set(['fill', 'draft']);

/**
 * The flags and the words that are not flags of the agent command `args`, read as `FLAGS` models
 * its subcommand; a flag it does not model, a flag missing its value, or one naming a repository
 * other than the fake's, fails as not modelled.
 */
function agentArgs(state, args) {
  const known = FLAGS[args[1]];
  const flags = {};
  const words = [];
  for (let i = 2; i < args.length; i += 1) {
    if (!args[i].startsWith('-') || args[i] === '-') {
      words.push(args[i]);
      continue;
    }
    const [flag, inline] = args[i].startsWith('--') && args[i].includes('=') ? [args[i].slice(0, args[i].indexOf('=')), args[i].slice(args[i].indexOf('=') + 1)] : [args[i], undefined];
    const name = known[flag];
    if (name === undefined) throw new NotModelled(args);
    if (SWITCHES.has(name)) {
      flags[name] = true;
      continue;
    }
    flags[name] = inline ?? args[(i += 1)];
    if (flags[name] === undefined) throw new NotModelled(args);
  }
  if (flags.repo !== undefined && flags.repo.toLowerCase() !== state.repo.toLowerCase()) throw new NotModelled(args);
  return { flags, words };
}

/** The body a `--body` or `--body-file` gives, reading standard input for a file named `-`. */
const bodyOf = (flags) => flags.body ?? (flags.bodyFile === undefined ? undefined : readFileSync(flags.bodyFile === '-' ? 0 : flags.bodyFile, 'utf8'));

/** The time `gh` is answered at, to the second, as GitHub writes one. */
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The pull request `selector` names, as `gh pr` reads one: a number, its address, or a branch,
 * whose open pull request it names before a merged one. With none, the branch checked out where
 * the command runs is the selector.
 */
function selected(state, repository, selector) {
  const named = selector ?? checkedOut(process.cwd());
  if (named === null) throw new GhFailure('could not determine current branch: not on any branch');
  const number = /^\d+$/.test(named) ? Number(named) : Number(new RegExp(`^${pullUrl(state, '(\\d+)').replace(/[./]/g, '\\$&')}$`, 'i').exec(named)?.[1]);
  if (Number.isInteger(number)) {
    const pull = repository.pull(number);
    if (!pull) throw new GhFailure(`GraphQL: Could not resolve to a PullRequest with the number of ${number}. (repository.pullRequest)`);
    return pull;
  }
  const from = repository.held().pullRequests.filter((pull) => pull.head === named && pull.from === null);
  const pull = from.find((candidate) => !candidate.merged) ?? from.at(-1);
  if (!pull) throw new GhFailure(`no pull requests found for branch "${named}"`);
  return pull;
}

/** How `gh pr view` names a pull request's state. */
const stateOf = (pull) => (pull.merged ? 'MERGED' : 'OPEN');

/** The fields `gh pr view --json` answers from the fake's model, each as `gh` prints it. */
const VIEW_FIELDS = {
  number: (state, pull) => pull.number,
  title: (state, pull) => pull.title,
  body: (state, pull) => pull.body,
  state: (state, pull) => stateOf(pull),
  url: (state, pull) => pullUrl(state, pull.number),
  headRefName: (state, pull) => pull.head,
  headRefOid: (state, pull) => pull.sha,
  baseRefName: (state, pull) => pull.base,
  comments: (state, pull) => pull.comments,
};

/** The lines a diff adds and removes, which `gh pr view` prints as its additions and deletions. */
function changedLines(diff) {
  const lines = diff.split('\n');
  return {
    additions: lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
    deletions: lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length,
  };
}

/**
 * The commands an agent runs on the forge and the forge adapter never does, each keyed by its
 * `gh pr` subcommand, with what answers it: what `gh` prints, given the board, the fake's state and
 * the command's arguments. They are outside `ANSWERED`, which holds the adapter's commands alone.
 * What each prints was measured with gh 2.99.0 on this repository on 2026-10-01, for `view` and
 * `diff`; `create` and `comment` print the address of what they made, as `gh` documents.
 */
const AGENT_COMMANDS = {
  // A pull request from a branch the test's `origin` holds, at that branch's head, with the diff
  // and merge base git computes there, as the forge computes them.
  create: async (board, state, args) => {
    const { flags } = agentArgs(state, args);
    if (!state.origin) throw new NotModelled(args);
    const head = flags.head ?? checkedOut(process.cwd());
    const base = flags.base ?? 'main';
    const body = bodyOf(flags);
    if (flags.title === undefined && !flags.fill) throw new GhFailure('must provide `--title` and `--body` (or `--fill` or `fill-first` or `--fillverbose`) when not running interactively');
    const sha = head && headIn(state.origin, head);
    if (!sha) throw new GhFailure('aborted: you must first push the current branch to a remote, or use the --head flag');
    if (!headIn(state.origin, base)) throw new GhFailure('pull request create failed: GraphQL: Base ref must be a branch (createPullRequest)');
    const repository = repositoryOf(state);
    const open = repository.held().pullRequests.find((pull) => pull.head === head && pull.base === base && !pull.merged && pull.from === null);
    if (open) throw new GhFailure(`a pull request for branch "${head}" into branch "${base}" already exists:\n${pullUrl(state, open.number)}`);
    const numbers = [...(await board.operations.readItems()).map((item) => item.number ?? 0), ...repository.held().pullRequests.map((pull) => pull.number)];
    const number = Math.max(0, ...numbers) + 1;
    repository.open({ number, head, sha, base, title: flags.title ?? '', body: body ?? '', ...comparedIn(state.origin, base, sha) });
    state.repository = repository.held();
    return `${pullUrl(state, number)}\n`;
  },
  // A comment on the pull request named, made now, and held with it.
  comment: async (board, state, args) => {
    const { flags, words } = agentArgs(state, args);
    const body = bodyOf(flags);
    if (body === undefined) throw new NotModelled(args);
    const repository = repositoryOf(state);
    const { number } = selected(state, repository, words[0]);
    repository.comment(number, body, now());
    state.repository = repository.held();
    return `${pullUrl(state, number)}#issuecomment-${repository.pull(number).comments.length}\n`;
  },
  // The pull request named, as `gh` prints it to a reader that is not a terminal, or the fields
  // `--json` names, in the order `gh` prints them.
  view: async (board, state, args) => {
    const { flags, words } = agentArgs(state, args);
    const fields = flags.json?.split(',').sort();
    if (fields?.some((field) => !Object.hasOwn(VIEW_FIELDS, field))) throw new NotModelled(args);
    const pull = selected(state, repositoryOf(state), words[0]);
    if (fields) {
      return `${JSON.stringify(Object.fromEntries(fields.map((field) => [field, VIEW_FIELDS[field](state, pull)])))}\n`;
    }
    const { additions, deletions } = changedLines(pull.diff);
    const lines = [['title', pull.title], ['state', stateOf(pull)], ['author', 'rigger-fake'], ['labels', ''], ['assignees', ''], ['reviewers', ''], ['projects', ''], ['milestone', ''], ['number', pull.number], ['url', pullUrl(state, pull.number)], ['additions', additions], ['deletions', deletions], ['auto-merge', 'disabled']];
    return `${lines.map(([name, value]) => `${name}:\t${value}`).join('\n')}\n--\n${pull.body}\n`;
  },
  // The pull request's diff as the forge serves it, which `gh pr diff` prints byte for byte.
  diff: async (board, state, args) => {
    const { words } = agentArgs(state, args);
    const pull = selected(state, repositoryOf(state), words[0]);
    if (pull.declined) throw new GhFailure(`could not find pull request diff: HTTP 406: ${pull.declined} (https://api.github.com/repos/${state.repo}/pulls/${pull.number})`);
    return pull.diff;
  },
};

/** Every agent command the fake `gh` answers, by its `gh pr` subcommand. */
export const AGENT_ANSWERED = Object.keys(AGENT_COMMANDS);

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
 *
 * L3 moves the cards it claims at once, so several fake `gh`s can run together over one board.
 * Each holds the board's lock from its first read of the board to its last write, so no write is
 * lost to another's. It waits for the lock by trying again until it is free, and never by a sleep.
 */
export async function main(statePath) {
  const lock = `${statePath}.lock`;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  try {
    await answering(statePath);
  } finally {
    rmSync(lock);
  }
}

/** `main`'s answer, given while it holds the board's lock. */
async function answering(statePath) {
  const args = process.argv.slice(2);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.sent.push(args);
  writeFileSync(statePath, JSON.stringify(state));
  const answer = COMMANDS[commandOf(args)] ?? (args[0] === 'pr' && Object.hasOwn(AGENT_COMMANDS, args[1]) ? AGENT_COMMANDS[args[1]] : undefined);
  if (!answer) {
    process.stderr.write(`the fake gh does not model \`${spelled(args)}\`\n`);
    process.exitCode = 1;
    return;
  }
  const board = await boardOf(state);
  let data;
  try {
    // A REST read and an agent command are answered with what `gh` prints for each, and a GraphQL
    // request with its data, which `gh` prints as one line.
    if (args[1] !== 'graphql') {
      const printed = await answer(board, state, args);
      writeFileSync(statePath, JSON.stringify({ ...state, writes: board.writes() }));
      process.stdout.write(printed);
      return;
    }
    data = await answer(board, state, parseDocument(args[3].slice('query='.length)).operations[0]);
  } catch (error) {
    if (!(error instanceof GhFailure)) throw error;
    process.stdout.write(error.printed ?? '');
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(statePath, JSON.stringify({ ...state, writes: board.writes() }));
  process.stdout.write(`${JSON.stringify({ data })}\n`);
}

/** The one argument the warming run of the fake `gh` is given, which no `gh` command is. */
export const WARMING = '--rigger-fixture-warm';

/**
 * Installs a fake `gh` in `dir`, answering as `gh` would for the board numbered `project` among
 * the boards of `owner`, or of `repo`'s owner where no `owner` is given, which holds `board`: the
 * fake board's own arguments.
 *
 * It returns the executable's path, `gh`; `model()`, the fake board as the fake `gh` now holds
 * it, whose write record holds every write the fake `gh` was sent; and `sent()`, the arguments of
 * every command the fake `gh` was run with, oldest first, whether or not it answered it.
 *
 * `origin`, where given, is the path of the test's local bare repository, which the fake `gh`
 * reads the branches of, and opens a pull request from with `gh pr create`.
 *
 * The executable is run once before this returns (`warmed`), so the system's hold on its first
 * exec is paid here. The fake `gh` reads no environment variable, so that run is given `WARMING` as
 * its one argument, and the entry exits before it loads this module or records a command when that
 * is the only argument it has. Any other command, one with no argument among them, is recorded.
 */
export function installFakeGh(dir, { repo, owner, project, board = {}, origin }) {
  const statePath = join(dir, 'board.json');
  writeFileSync(statePath, JSON.stringify({ repo, owner, project, model: board, origin, writes: [], sent: [] }));
  const gh = join(dir, 'gh');
  // CommonJS, because nothing beside it says otherwise, and so it loads this module dynamically.
  const entry = `(process.argv.length !== 3 || process.argv[2] !== ${JSON.stringify(WARMING)}) && import(${JSON.stringify(import.meta.url)}).then(({ main }) => main(${JSON.stringify(statePath)}));\n`;
  writeFileSync(gh, `#!${process.execPath}\n${entry}`);
  chmodSync(gh, 0o755);
  warmed(gh, [WARMING]);
  const state = () => JSON.parse(readFileSync(statePath, 'utf8'));
  return { gh, model: () => boardOf(state()), sent: () => state().sent };
}

/**
 * Seeds the repository the fake `gh` installed as `fake` answers from, as `createFakeRepository`
 * takes it: for a card, its branch, and an open or merged pull request from it with its head SHA,
 * a diff and comments. Made before the fake `gh` is first run, it replaces what the repository held.
 */
export function seedRepository(fake, seed) {
  const statePath = join(dirname(fake.gh), 'board.json');
  createFakeRepository(seed);
  writeFileSync(statePath, JSON.stringify({ ...JSON.parse(readFileSync(statePath, 'utf8')), repository: seed }));
}

/** The mutation the item-write side sends for a column move (`src/substrate/forge/item-write.mjs`). */
const MOVE = 'updateProjectV2ItemFieldValue';

/**
 * A `gh` at `dir/gh` that answers as the fake `gh` at `fake` does and, once it has answered a
 * move, replaces the event stream at `stream` with a directory of that name, which no append
 * can open: the board has taken the claim move, and the record then refuses its event. Placed
 * on PATH ahead of the fake, whose own directory must follow it there.
 * It is run once before this returns (`warmed`), exiting before it runs the fake.
 */
export function installGhRefusingStreamAfterMove(dir, fake, stream) {
  const gh = join(dir, 'gh');
  for (const path of [fake, stream]) {
    if (path.includes("'")) throw new Error(`${path} holds a quote the wrapper cannot carry`);
  }
  writeFileSync(gh, [
    '#!/bin/sh',
    EXIT_IF_WARMING,
    `'${fake}' "$@"`,
    'status=$?',
    `case "$*" in *${MOVE}*) rm -f '${stream}'; mkdir -p '${stream}' ;; esac`,
    'exit $status',
    '',
  ].join('\n'));
  chmodSync(gh, 0o755);
  warmed(gh);
  return gh;
}
