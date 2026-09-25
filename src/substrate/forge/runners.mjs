// ABOUTME: The forge adapter's three runners, read, schema-write and item-write. Each admits one
// operation of its own side and refuses everything else by name before anything is sent.

import { spawnSync } from 'node:child_process';

import { gitEnvironment } from '../git-environment.mjs';
import { literal, parseDocument } from './graphql.mjs';

/**
 * The one spawn every runner makes, and the only place the forge's command is named.
 *
 * One plain call that hands back an exit code and captured output. It carries no timeout, no
 * process group, no kill and no survivor handling: those are M2's, when this moves onto L0's
 * process adapter (the architect's ruling on #214, §5).
 *
 * The environment is the one a git child is given, as `doctor` gave `gh auth status` before this
 * runner existed: `gh` reads the repository it runs in, and an inherited `GIT_DIR` would point it
 * at a repository nobody named.
 */
const plainly = (command, args) => spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });

/** Every command a runner sends is this one (`R-SAFE-2`). */
const FORGE = 'gh';

/** Throws the refusal every runner gives: which runner, what it refused, and that nothing went. */
function refuse(runner, what) {
  throw new Error(`the ${runner} runner refuses ${what}, and sent nothing`);
}

/** How a request is named in a refusal: as the command it would have run. */
const spelled = (args) => `\`${[FORGE, ...args].join(' ')}\``;

/**
 * The `gh` subcommands the read runner admits other than `gh api`, each as its whole argument
 * list. A whole list rather than a subcommand name, so that `gh auth status --show-token`, which
 * would put a credential into whatever captured the output, is refused with everything else.
 */
const READ_SUBCOMMANDS = [['auth', 'status']];

/** Whether `args` is exactly one of `lists`. */
const oneOf = (args, lists) => lists.some((list) => list.length === args.length && list.every((word, i) => word === args[i]));

/**
 * The whole of what may follow `gh api <path>` for the read runner to send it: an explicit GET.
 *
 * `gh` chooses the method itself when none is named, and where it can disagree with a reading of
 * the request (`D16` rule 3), measured with gh 2.99.0 on macOS on 2026-09-25 through a local
 * proxy: with no flag it sends GET; with `-f`, `-F` or `--input` it sends POST; with `-X GET` or
 * `--method GET` it sends GET, and `-X GET -f` puts the field in the query string. So only a
 * named GET is admitted, and with no field at all. `test/forge-runners.test.mjs` asks `gh` the
 * same question each run.
 */
const EXPLICIT_GET = [['-X', 'GET'], ['--method', 'GET']];

/** How an operation is named in a refusal: its type, its name if it has one, and its root fields. */
function named(operation) {
  const fields = operation.selections.map((selection) => selection.name ?? '...').join(', ');
  return `${operation.type}${operation.name ? ` ${operation.name}` : ''} (${fields})`;
}

/** A `gh api graphql` request carrying `document`: the one form a write runner admits. */
export const graphqlRequest = (document) => ['api', 'graphql', '-f', `query=${document}`];

/**
 * The operations of the GraphQL document `query` carries, read for `runner`, which refuses a
 * document it cannot read or one carrying more than one operation.
 */
function operationsOf(runner, query) {
  let document;
  try {
    document = parseDocument(query);
  } catch (error) {
    refuse(runner, `a GraphQL document it cannot read, ${error.message}: ${query}`);
  }
  const { operations } = document;
  if (operations.length > 1) {
    refuse(runner, `a request carrying more than one operation: ${operations.map(named).join('; ')}`);
  }
  return operations[0];
}

/**
 * The GraphQL document a `gh api graphql` request sends, given what follows `graphql`: exactly
 * one `-f query=`, and otherwise only `-f` or `-F` fields, which `gh` sends as its variables.
 * `-F query=` is refused because `-F` reads a value beginning with `@` from a file, which is a
 * document this runner would never see.
 */
function queryOf(runner, args, rest) {
  const queries = [];
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, field] = [rest[i], rest[i + 1] ?? ''];
    if (flag !== '-f' && flag !== '-F') refuse(runner, `${spelled(args)}, which carries \`${flag}\``);
    if (field.startsWith('query=')) queries.push([flag, field]);
  }
  if (queries.length !== 1 || queries[0][0] !== '-f') {
    refuse(runner, `${spelled(args)}, which does not carry its document as exactly one \`-f query=\``);
  }
  return queries[0][1].slice('query='.length);
}

/**
 * Sends a request that changes nothing on the forge, and refuses any other.
 *
 * `send` stands in for the spawn in tests, and is handed what the runner admitted.
 */
export function readRunner(args, { send = plainly } = {}) {
  const [subcommand, endpoint, ...rest] = args;
  if (subcommand === 'api' && endpoint === 'graphql') {
    const operation = operationsOf('read', queryOf('read', args, rest));
    if (operation.type !== 'query') refuse('read', `${named(operation)}, which is not a query`);
  } else if (subcommand === 'api' && endpoint !== undefined) {
    if (!oneOf(rest, EXPLICIT_GET)) {
      refuse('read', `${spelled(args)}, which is not \`gh api <path>\` with an explicit GET and nothing else`);
    }
  } else if (!oneOf(args, READ_SUBCOMMANDS)) {
    refuse('read', `${spelled(args)}, which its read allowlist does not name`);
  }
  return send(FORGE, args);
}

/**
 * The argument names that name a board item. GitHub owns which they are (`D16`), and its IDs are
 * opaque, so an item is recognised by the name of the argument carrying it and never by what its
 * value looks like. Measured by introspecting the input of every `ProjectV2` mutation with gh
 * 2.99.0 on 2026-09-25: `itemId` names the item in six of them, and `afterId` names a second one
 * in `updateProjectV2ItemPosition`'s. `draftIssueId` and `contentId` name what an item holds, not
 * the item.
 */
const ITEM_ARGUMENTS = new Set(['itemId', 'afterId']);

/** Every argument and input-object field name in `args`, at any depth. */
function argumentNames(args) {
  const names = [];
  const visit = ({ name, value }) => {
    names.push(name);
    if (value.kind === 'object') value.fields.forEach(visit);
    if (value.kind === 'list') value.values.forEach((held) => visit({ name: null, value: held }));
  };
  args.forEach(visit);
  return names.filter(Boolean);
}

/** Every variable `args` reads, at any depth. */
function variablesIn(args) {
  const found = [];
  const visit = (value) => {
    if (value.kind === 'variable') found.push(`$${value.name}`);
    if (value.kind === 'object') value.fields.forEach((field) => visit(field.value));
    if (value.kind === 'list') value.values.forEach(visit);
  };
  args.forEach((arg) => visit(arg.value));
  return found;
}

/**
 * The one mutation a write request sends, read for `runner`: its root field, which is the
 * operation a write runner names and admits.
 *
 * A write is admitted only as `gh api graphql -f query=<document>` and nothing else, with every
 * argument written in the document. A variable, a fragment at the root, a directive or a second
 * root field each put what the request does somewhere the runner cannot name, so each is refused.
 */
function mutationOf(runner, args) {
  const [subcommand, endpoint, flag, query, ...rest] = args;
  if (subcommand !== 'api' || endpoint !== 'graphql' || flag !== '-f' || !query?.startsWith('query=') || rest.length > 0) {
    refuse(runner, `${spelled(args)}, which is not a GraphQL document sent as \`gh api graphql -f query=\` and nothing else`);
  }
  const operation = operationsOf(runner, query.slice('query='.length));
  if (operation.type !== 'mutation') refuse(runner, `${named(operation)}, which is not a mutation`);
  if (operation.selections.some((selection) => selection.kind === 'fragment')) {
    refuse(runner, `${named(operation)}, which puts a fragment at its root`);
  }
  if (operation.selections.length > 1) {
    refuse(runner, `a request carrying more than one operation: ${operation.selections.map((field) => field.name).join(', ')}`);
  }
  const [field] = operation.selections;
  const directives = [...operation.directives, ...field.directives].map((directive) => `@${directive.name}`);
  if (directives.length > 0) refuse(runner, `${field.name}, which carries ${directives.join(', ')}`);
  const variables = variablesIn(field.arguments);
  if (variables.length > 0 || operation.variables) {
    refuse(runner, `${field.name}, whose arguments carry ${variables.join(', ') || 'declared variables'}, which the document does not show`);
  }
  return field;
}

/** The operations the schema-write runner admits before #217: creating a field and a label. */
const SCHEMA_WRITES = new Set(['createProjectV2Field', 'createLabel']);

/**
 * Sends one write to the board's fields or the repository's labels, and refuses any other
 * request, including one on its allowlist whose arguments name a board item.
 */
export function schemaWriteRunner(args, { send = plainly } = {}) {
  const field = mutationOf('schema-write', args);
  const items = argumentNames(field.arguments).filter((name) => ITEM_ARGUMENTS.has(name));
  if (items.length > 0) refuse('schema-write', `${field.name}, whose ${items.join(', ')} names a board item`);
  if (!SCHEMA_WRITES.has(field.name)) refuse('schema-write', `${field.name}, which its allowlist does not hold`);
  return send(FORGE, args);
}

/** The operations the item-write runner admits in M1: the field-value write that moves a card. */
const ITEM_WRITES = new Set(['updateProjectV2ItemFieldValue']);

/** The field holding the columns, whose options are the column display names (`ARCHITECTURE.md`). */
export const COLUMNS = 'Status';

/**
 * The first line of what `gh` said, from its error stream first: a failed `gh api graphql` prints
 * the whole response as one line on stdout and its message on stderr.
 */
export function firstLine(said) {
  if (said.status === null) return `${FORGE} could not be run: ${said.error?.code ?? said.error?.message}`;
  const lines = `${said.stderr ?? ''}\n${said.stdout ?? ''}`.split('\n').map((line) => line.trim());
  return lines.find(Boolean) ?? `${FORGE} exited ${said.status} and said nothing`;
}

/**
 * The fields of the one `input` a column move carries, each written as a string in the document,
 * or a refusal naming what is not: a column move names its board, its item, its field and the
 * option it sets, and nothing else.
 */
function moveInput(field) {
  const [input, ...others] = field.arguments;
  const fields = input?.name === 'input' && input.value.kind === 'object' && others.length === 0 ? input.value.fields : null;
  const read = {};
  for (const { name, value } of fields ?? []) {
    if (Object.hasOwn(read, name)) refuse('item-write', `${field.name}, whose input gives ${name} twice`);
    read[name] = value;
  }
  const option = read.value?.kind === 'object' && read.value.fields.length === 1 ? read.value.fields[0] : null;
  const strings = ['projectId', 'itemId', 'fieldId'].every((name) => read[name]?.kind === 'string');
  if (!fields || Object.keys(read).length !== 4 || !strings || option?.name !== 'singleSelectOptionId' || option.value.kind !== 'string') {
    refuse('item-write', `${field.name}, whose input is not a projectId, itemId, fieldId and a value setting one singleSelectOptionId`);
  }
  return { projectId: read.projectId.value, fieldId: read.fieldId.value };
}

/**
 * Which field of `projectId` holds the columns, and what the field `fieldId` is called, read
 * through the read runner. A read that fails throws, naming what `gh` said, so no write follows.
 */
function columnsField(projectId, fieldId, send) {
  const query = `query { project: node(id: ${literal(projectId)}) { ... on ProjectV2 { field(name: ${literal(COLUMNS)}) { ... on ProjectV2SingleSelectField { id } } } } target: node(id: ${literal(fieldId)}) { ... on ProjectV2FieldCommon { name } } }`;
  const said = readRunner(graphqlRequest(query), { send });
  if (said.status !== 0) {
    throw new Error(`the item-write runner could not read which field holds the columns, and sent no write: ${firstLine(said)}`);
  }
  const { data } = JSON.parse(said.stdout);
  return { id: data?.project?.field?.id, target: data?.target?.name };
}

/**
 * Sends one write to a board item, and refuses any other request. In M1 that write is the column
 * move: a field-value write setting an option of the field holding the columns, which the runner
 * reads off the board rather than taking from whoever sent the request.
 */
export function itemWriteRunner(args, { send = plainly } = {}) {
  const field = mutationOf('item-write', args);
  if (!ITEM_WRITES.has(field.name)) refuse('item-write', `${field.name}, which its allowlist does not hold`);
  const { projectId, fieldId } = moveInput(field);
  const columns = columnsField(projectId, fieldId, send);
  if (columns.id !== fieldId) {
    refuse('item-write', `a field-value write on ${columns.target ?? 'a field'} (${fieldId}), which is not the field holding the columns`);
  }
  return send(FORGE, args);
}
