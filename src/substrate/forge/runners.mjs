// ABOUTME: The forge adapter's four runners, read, schema-write, item-write and repository-write. Each admits one
// operation of its own side and refuses everything else by name before anything is sent.

import { gitEnvironment } from '../git-environment.mjs';
import { runCommand } from '../process.mjs';
import { literal, parseDocument } from './graphql.mjs';

/**
 * How long L0 lets one forge call run before it kills the call's group, where the caller passes no
 * other value (the architect's ruling 2, (g), on #332). A judgment, not a measurement. Its premise
 * is GitHub's own limit: "If GitHub takes more than 10 seconds to process an API request, GitHub
 * will terminate the request" (GitHub's GraphQL documentation, "Rate limits and query limits",
 * "Timeouts", read on 2026-09-28). One call is one request, so a minute is six times that, room
 * for a slow network and for `gh`'s own start, while a call that hangs holds its verb back by no
 * more than a minute.
 */
export const FORGE_TIMEOUT = 60_000;

/**
 * The one spawn every runner makes, through L0's process adapter: `gh` runs in a process group of
 * its own, the group is ended at `timeout`, and every process it leaves behind is killed and
 * recorded through `emitter`. It hands back `gh`'s exit code as `status`, its output as text, and
 * whether the timeout ended it. A command that never started, and a kill the sink refused, reject
 * as the adapter rejects, each failure's `code` naming which.
 *
 * The environment is the one a git child is given, as `doctor` gave `gh auth status` before this
 * runner existed: `gh` reads the repository it runs in, and an inherited `GIT_DIR` would point it
 * at a repository nobody named.
 */
async function throughL0(command, args, { emitter, timeout }) {
  const { exit, timedOut, stdout, stderr } = await runCommand({ command, args, cwd: process.cwd(), env: gitEnvironment(), timeout, emitter });
  return { status: exit, timedOut, timeout, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
}

/** Every command a runner sends is this one (`R-SAFE-2`). */
const FORGE = 'gh';

/** Throws the refusal every runner gives: which runner, what it refused, and that nothing went. */
function refuse(runner, what) {
  throw new Error(`the ${runner} runner refuses ${what}, and did not send it`);
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
 * The header asking GitHub to serve a pull request as its diff: the one header a read sends, and
 * the one the read runner admits.
 */
export const DIFF_HEADER = 'Accept: application/vnd.github.diff';

/**
 * The whole of what may follow `gh api <path>` for the read runner to send it: an explicit GET,
 * and, after `-X GET` only, the header asking for a diff.
 *
 * `gh` chooses the method itself when none is named, and where it can disagree with a reading of
 * the request (`D16` rule 3), measured with gh 2.99.0 on macOS on 2026-09-25 through a local
 * proxy: with no flag it sends GET; with `-f`, `-F` or `--input` it sends POST; with `-X GET` or
 * `--method GET` it sends GET, and `-X GET -f` puts the field in the query string. So only a
 * named GET is admitted, and with no field at all, after a path that is not itself a flag. A
 * header can override the method, so no header is admitted but the diff's.
 * `test/forge-runners.test.mjs` asks `gh` the same question each run, of the diff's form too.
 */
const EXPLICIT_GET = [['-X', 'GET'], ['--method', 'GET'], ['-X', 'GET', '-H', DIFF_HEADER]];

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
 * `emitter` is the `L0` emitter the call's kills are recorded through, and `timeout` how long the
 * call may run, `FORGE_TIMEOUT` where it is not given. `send` stands in for the spawn in tests, and
 * is handed what the runner admitted, with the emitter and the timeout. Every runner takes these
 * three, and hands them on to any read it makes itself.
 */
export async function readRunner(args, { send = throughL0, emitter, timeout = FORGE_TIMEOUT } = {}) {
  const [subcommand, endpoint, ...rest] = args;
  if (subcommand === 'api' && endpoint === 'graphql') {
    const operation = operationsOf('read', queryOf('read', args, rest));
    if (operation.type !== 'query') refuse('read', `${named(operation)}, which is not a query`);
  } else if (subcommand === 'api' && endpoint !== undefined) {
    // A path slot holding a flag makes that flag take the next word, so the `-X GET` after it
    // would name no method: `gh api --input -X GET` sends `POST /GET` with a file as its body.
    if (endpoint.startsWith('-') || !oneOf(rest, EXPLICIT_GET)) {
      refuse('read', `${spelled(args)}, which is not \`gh api <path>\` with an explicit GET and nothing else but the diff's header`);
    }
  } else if (!oneOf(args, READ_SUBCOMMANDS)) {
    refuse('read', `${spelled(args)}, which its read allowlist does not name`);
  }
  return send(FORGE, args, { emitter, timeout });
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

/**
 * The write that adds an option to the field holding the columns, which the schema-write runner
 * admits only in the shape #212's spike found keeps every item's column
 * (`docs/spikes/status-option-through-gh.md`, "Conclusion").
 */
const OPTIONS_WRITE = 'updateProjectV2Field';

/** The operations the schema-write runner admits: creating a field and a label, and the options write. */
const SCHEMA_WRITES = new Set(['createProjectV2Field', 'createLabel', OPTIONS_WRITE]);

/**
 * What an option of a single-select field is, and what way B sends back of every held option.
 * GitHub requires a `color` and a `description` on every option sent (`ProjectV2SingleSelect-
 * FieldOptionInput`, introspected with gh 2.99.0 on 2026-09-25), so a held option sent without
 * its own is changed.
 */
const OPTION_FIELDS = ['id', 'name', 'color', 'description'];

/**
 * How way B writes each field of an option, as the parser reads it: the colour as an unquoted
 * scalar, the rest as strings. A held option carries all four; a new one carries all but its `id`.
 * An unquoted scalar is any bare name, number or `null`, so which colour it names is checked
 * against `OPTION_COLOURS` separately.
 */
const OPTION_KINDS = { id: 'string', name: 'string', color: 'scalar', description: 'string' };

/**
 * The values of GitHub's `ProjectV2SingleSelectFieldOptionColor`, the type GitHub gives `color`
 * on `ProjectV2SingleSelectFieldOptionInput`. GitHub owns them (`D16`); this copy is what gh
 * 2.99.0 answered to `__type(name: "ProjectV2SingleSelectFieldOptionColor") { enumValues { name } }`
 * on 2026-09-25.
 */
const OPTION_COLOURS = new Set(['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE']);

/**
 * Refuses the schema write `field` unless its options are written one way: its arguments each
 * given once, an `input` object giving each of its fields once, and, where that input gives
 * `singleSelectOptions`, a list of objects each giving each of its fields once and a `color`
 * written as an unquoted value of `OPTION_COLOURS`. So a quoted colour, `null`, a number, a
 * boolean, another name, no colour, a lone option given where the list belongs, and any field or
 * argument given twice are each refused, naming the write. A write carrying no options, as
 * creating a label does, has nothing here to refuse.
 */
function checkColours(field) {
  const args = fieldsOf('schema-write', field, field.arguments);
  const input = args.input?.kind === 'object' ? fieldsOf('schema-write', field, args.input.fields) : {};
  const options = input.singleSelectOptions;
  if (options === undefined) return;
  if (options.kind !== 'list') refuse('schema-write', `${field.name}, whose singleSelectOptions is not a list`);
  for (const option of options.values) {
    if (option.kind !== 'object') refuse('schema-write', `${field.name}, which sends an option that is not an object`);
    const { name, color } = fieldsOf('schema-write', field, option.fields);
    if (color?.kind !== 'scalar' || !OPTION_COLOURS.has(color.value)) {
      refuse('schema-write', `${field.name}, which sends the option ${name?.value ?? 'with no name'} with a color that is no value of ProjectV2SingleSelectFieldOptionColor`);
    }
  }
}

/**
 * The options a field holds, each `{ id, name, color, description }`, and the field's name, read
 * through the read runner, sent as `via` says. A read that fails throws, naming what `gh` said, so
 * no write follows.
 */
async function heldOptions(fieldId, via) {
  const query = `query { field: node(id: ${literal(fieldId)}) { ... on ProjectV2SingleSelectField { name options { id name color description } } } }`;
  const said = await readRunner(graphqlRequest(query), via);
  if (said.status !== 0) {
    throw new Error(`the schema-write runner could not read the options of ${fieldId}, and sent no write: ${firstLine(said)}`);
  }
  const { data } = JSON.parse(said.stdout);
  return { name: data?.field?.name, options: data?.field?.options ?? [] };
}

/** The fields of an input object `field` carries, by name, or `runner`'s refusal naming one given twice. */
function fieldsOf(runner, field, fields) {
  const read = {};
  for (const { name, value } of fields) {
    if (Object.hasOwn(read, name)) refuse(runner, `${field.name}, whose input gives ${name} twice`);
    read[name] = value;
  }
  return read;
}

/**
 * The field ID and the options an options write sends, each option as its fields' values by
 * name, or a refusal naming what is not way B's: one `input` of a `fieldId` string and a
 * `singleSelectOptions` list, each option a name, colour and description written as
 * `OPTION_KINDS` says and an `id` or none, no `id` twice, and at least one option with no `id`,
 * which is the option the write adds.
 */
function optionsInput(field) {
  const [input, ...others] = field.arguments;
  const read = input?.name === 'input' && input.value.kind === 'object' && others.length === 0 ? fieldsOf('schema-write', field, input.value.fields) : null;
  const extra = read ? Object.keys(read).filter((name) => name !== 'fieldId' && name !== 'singleSelectOptions') : [];
  if (!read || extra.length > 0 || read.fieldId?.kind !== 'string' || read.singleSelectOptions?.kind !== 'list') {
    refuse('schema-write', `${field.name}, whose input is not a fieldId and singleSelectOptions alone${extra.length > 0 ? `: it carries ${extra.join(', ')}` : ''}`);
  }
  const sent = read.singleSelectOptions.values.map((option) => {
    if (option.kind !== 'object') refuse('schema-write', `${field.name}, which sends an option that is not an object`);
    const entry = fieldsOf('schema-write', field, option.fields);
    const foreign = Object.keys(entry).filter((name) => !Object.hasOwn(OPTION_KINDS, name));
    if (foreign.length > 0) refuse('schema-write', `${field.name}, which sends an option carrying ${foreign.join(', ')}`);
    const wrong = Object.keys(OPTION_KINDS).filter((name) => (name !== 'id' || entry.id) && entry[name]?.kind !== OPTION_KINDS[name]);
    if (wrong.length > 0) {
      refuse('schema-write', `${field.name}, which sends an option whose ${wrong.join(', ')} is not given as way B gives it`);
    }
    return Object.fromEntries(Object.entries(entry).map(([name, value]) => [name, value.value]));
  });
  const twice = sent.filter((entry, i) => entry.id !== undefined && sent.findIndex((other) => other.id === entry.id) !== i);
  if (twice.length > 0) refuse('schema-write', `${field.name}, which sends ${twice.map((entry) => `${entry.name} (${entry.id})`).join(', ')} twice`);
  if (!sent.some((entry) => entry.id === undefined)) refuse('schema-write', `${field.name}, which adds no option`);
  return { fieldId: read.fieldId.value, sent };
}

/**
 * Refuses the options write `field` unless it is #212's way B on the field holding the columns:
 * its input is the field's ID and its options, and every option the field holds, as read now,
 * is sent with its `id`, name, colour and description. Way C, the same options with no `id`, gave
 * every option a new ID and cleared every item's column, so a held option sent without its `id`
 * is refused like one left out. The options are read as `via` says.
 */
async function checkOptionsWrite(field, via) {
  const { fieldId, sent } = optionsInput(field);
  checkColours(field);
  const held = await heldOptions(fieldId, via);
  if (held.name !== COLUMNS) {
    refuse('schema-write', `${field.name} on ${held.name ?? 'a field'} (${fieldId}), which is not the field holding the columns`);
  }
  const request = `${field.name} on ${COLUMNS} (${fieldId})`;
  const dropped = held.options.filter((option) => !sent.some((entry) => entry.id === option.id));
  if (dropped.length > 0) {
    const named = dropped.map((option) => `${option.name} (${option.id})`).join(', ');
    refuse('schema-write', `${request}, which does not send the held option${dropped.length > 1 ? 's' : ''} ${named} with its id`);
  }
  for (const option of held.options) {
    const entry = sent.find((candidate) => candidate.id === option.id);
    const differs = OPTION_FIELDS.filter((name) => entry[name] !== option[name]);
    if (differs.length > 0) {
      refuse('schema-write', `${request}, which sends the held option ${option.name} (${option.id}) without its own ${differs.join(', ')}`);
    }
  }
  const unheld = sent.filter((entry) => entry.id !== undefined && !held.options.some((option) => option.id === entry.id));
  if (unheld.length > 0) {
    const named = unheld.map((entry) => `${entry.name} (${entry.id})`).join(', ');
    refuse('schema-write', `${request}, which sends ${named} with an id the field does not hold`);
  }
  return fieldId;
}

/**
 * Sends one write to the board's fields or the repository's labels, and refuses any other
 * request, including one on its allowlist whose arguments name a board item.
 */
export async function schemaWriteRunner(args, { send = throughL0, emitter, timeout = FORGE_TIMEOUT } = {}) {
  const field = mutationOf('schema-write', args);
  const items = argumentNames(field.arguments).filter((name) => ITEM_ARGUMENTS.has(name));
  if (items.length > 0) refuse('schema-write', `${field.name}, whose ${items.join(', ')} names a board item`);
  if (!SCHEMA_WRITES.has(field.name)) refuse('schema-write', `${field.name}, which its allowlist does not hold`);
  if (field.name === OPTIONS_WRITE) await checkOptionsWrite(field, { send, emitter, timeout });
  else checkColours(field);
  return send(FORGE, args, { emitter, timeout });
}

/** The operations the item-write runner admits in M1: the field-value write that moves a card. */
const ITEM_WRITES = new Set(['updateProjectV2ItemFieldValue']);

/** The field holding the columns, whose options are the column display names (`ARCHITECTURE.md`). */
export const COLUMNS = 'Status';

/**
 * The first line of what `gh` said, from its error stream first: a failed `gh api graphql` prints
 * the whole response as one line on stdout and its message on stderr. A call the timeout ended is
 * said to be that, whatever `gh` had printed by then.
 */
export function firstLine(said) {
  if (said.timedOut) return `${FORGE} ran past its timeout of ${said.timeout} ms, and L0 ended it`;
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
  const read = fieldsOf('item-write', field, fields ?? []);
  const option = read.value?.kind === 'object' && read.value.fields.length === 1 ? read.value.fields[0] : null;
  const strings = ['projectId', 'itemId', 'fieldId'].every((name) => read[name]?.kind === 'string');
  if (!fields || Object.keys(read).length !== 4 || !strings || option?.name !== 'singleSelectOptionId' || option.value.kind !== 'string') {
    refuse('item-write', `${field.name}, whose input is not a projectId, itemId, fieldId and a value setting one singleSelectOptionId`);
  }
  return { projectId: read.projectId.value, fieldId: read.fieldId.value };
}

/**
 * Which field of `projectId` holds the columns, and what the field `fieldId` is called, read
 * through the read runner, sent as `via` says. A read that fails throws, naming what `gh` said, so
 * no write follows.
 */
async function columnsField(projectId, fieldId, via) {
  const query = `query { project: node(id: ${literal(projectId)}) { ... on ProjectV2 { field(name: ${literal(COLUMNS)}) { ... on ProjectV2SingleSelectField { id } } } } target: node(id: ${literal(fieldId)}) { ... on ProjectV2FieldCommon { name } } }`;
  const said = await readRunner(graphqlRequest(query), via);
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
export async function itemWriteRunner(args, { send = throughL0, emitter, timeout = FORGE_TIMEOUT } = {}) {
  const field = mutationOf('item-write', args);
  if (!ITEM_WRITES.has(field.name)) refuse('item-write', `${field.name}, which its allowlist does not hold`);
  const { projectId, fieldId } = moveInput(field);
  const columns = await columnsField(projectId, fieldId, { send, emitter, timeout });
  if (columns.id !== fieldId) {
    refuse('item-write', `a field-value write on ${columns.target ?? 'a field'} (${fieldId}), which is not the field holding the columns`);
  }
  return send(FORGE, args, { emitter, timeout });
}

/** Sends only a head-guarded merge or a pull-request comment. */
export async function repositoryWriteRunner(args, { send = throughL0, emitter, timeout = FORGE_TIMEOUT } = {}) {
  const [api, path, method, verb, field, value, option, mergeMethod, ...extra] = args;
  const merge = api === 'api' && /^repos\/[^/]+\/[^/]+\/pulls\/[1-9]\d*\/merge$/.test(path ?? '')
    && method === '-X' && verb === 'PUT' && field === '-f' && /^sha=[0-9a-f]{40}$/.test(value ?? '')
    && option === '-f' && mergeMethod === 'merge_method=merge' && extra.length === 0;
  const comment = api === 'api' && /^repos\/[^/]+\/[^/]+\/issues\/[1-9]\d*\/comments$/.test(path ?? '')
    && method === '-X' && verb === 'POST' && field === '-f' && value?.startsWith('body=')
    && option === undefined && extra.length === 0;
  if (!merge && !comment) refuse('repository-write', spelled(args));
  return send(FORGE, args, { emitter, timeout });
}
