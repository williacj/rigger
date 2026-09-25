// ABOUTME: Tests the forge adapter's three runners: what each admits from its own side, what it
// refuses by name, and that a refused request sends nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { accessSync, constants, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { itemWriteRunner, readRunner, schemaWriteRunner } from '../src/substrate/forge/runners.mjs';

/**
 * A stand-in for the one spawn a runner makes, recording every command it is handed and answering
 * `answer` for each. A refusal is shown by what this never received.
 */
function recording(answer = () => ({ status: 0, stdout: '{}', stderr: '' })) {
  const sent = [];
  const send = (command, args) => {
    sent.push([command, ...args]);
    return answer(command, args);
  };
  send.sent = sent;
  return send;
}

test('the read runner sends `gh auth status`, which its read allowlist names', () => {
  const send = recording(() => ({ status: 0, stdout: 'Logged in', stderr: '' }));

  const said = readRunner(['auth', 'status'], { send });

  assert.deepEqual(send.sent, [['gh', 'auth', 'status']]);
  assert.equal(said.stdout, 'Logged in');
});

test('the read runner refuses a subcommand its read allowlist does not name, naming it, and sends nothing', () => {
  // The defect this catches is a read runner that admits any `gh` subcommand it does not
  // recognise as `api`, which sends `gh issue close` and `gh project item-archive` as reads.
  for (const args of [['issue', 'close', '12'], ['project', 'item-archive', '6'], ['auth', 'status', '--show-token']]) {
    const send = recording();
    assert.throws(() => readRunner(args, { send }), (error) => error.message.includes(args.join(' ')), args.join(' '));
    assert.deepEqual(send.sent, [], args.join(' '));
  }
});

test('the read runner sends `gh api <path>` given an explicit GET and nothing else', () => {
  for (const args of [['api', 'rate_limit', '-X', 'GET'], ['api', 'rate_limit', '--method', 'GET']]) {
    const send = recording();
    readRunner(args, { send });
    assert.deepEqual(send.sent, [['gh', ...args]]);
  }
});

/** Forms of `gh api <path>` the read runner refuses: every one but an explicit GET alone. */
const REFUSED_PATH_FORMS = [
  ['api', 'rate_limit'],
  ['api', 'rate_limit', '-f', 'a=b'],
  ['api', 'rate_limit', '-F', 'a=b'],
  ['api', 'rate_limit', '--input', 'body.json'],
  ['api', 'rate_limit', '-X', 'POST'],
  ['api', 'rate_limit', '-X', 'GET', '-f', 'a=b'],
  ['api', 'rate_limit', '-X', 'GET', '-H', 'X-HTTP-Method-Override: DELETE'],
];

/**
 * Forms whose path slot holds a flag, so the flag takes the next word as its value and the
 * `-X GET` after it is not what it looks like. With `--input`, gh reads a file named `-X` and
 * sends `POST /GET` with its content as the body.
 */
const FLAG_IN_PATH_SLOT = [
  ['api', '--input', '-X', 'GET'],
  ['api', '--method', '-X', 'GET'],
  ['api', '--hostname', '-X', 'GET'],
];

/**
 * The installed `gh`, by its absolute path: the `gh` this process's `PATH` resolves once the
 * directory `npm test` puts first on it is taken away (`test/suite.sh`). That directory holds a
 * `gh` refusing every call, which is what keeps every other test off the real forge (#276). This
 * probe is the suite's one sanctioned exception, because its request goes only to its own local
 * proxy (the architect's ruling on #276, section 4). No other test reads the variable.
 *
 * It is found as `ghOn` finds any `gh`.
 */
function installedGh() {
  const refusing = process.env.RIGGER_REFUSING_GH_DIR;
  const gh = ghOn(process.env.PATH, refusing === undefined ? null : resolve(refusing));
  return gh ?? assert.fail('no gh is installed on this PATH, so gh cannot be asked which method it sends');
}

/**
 * The `gh` a spawn finds on `path`, by its absolute path, passing over the directory `skipping`,
 * or null where there is none. An empty entry is the working directory to a spawn.
 */
function ghOn(path = '', skipping = null) {
  for (const dir of path.split(delimiter).map((entry) => resolve(entry || '.'))) {
    if (dir === skipping) continue;
    try {
      accessSync(join(dir, 'gh'), constants.X_OK);
      return join(dir, 'gh');
    } catch {
      // Not here, so the next directory is where a spawn would look.
    }
  }
  return null;
}

test('npm test puts its refusing gh first on the path every test inherits', () => {
  // #276: a test that fails to pass its stand-in through, in its own process or in a child that
  // inherits its path, reaches the `gh` this path resolves. `npm test` puts one there that refuses
  // and records, and fails the run when it was called. The defect this catches is a suite run
  // with that `gh` gone or behind another one, where such a test reaches the installed `gh`.
  const refusing = process.env.RIGGER_REFUSING_GH_DIR;
  assert.ok(refusing, 'this run put no refusing gh on the path: run the suite with `npm test`, which runs test/suite.sh');
  assert.equal(ghOn(process.env.PATH), resolve(refusing, 'gh'));
});

/**
 * The method and body `gh` really sends for `gh api` given `args`, caught by a proxy on this
 * machine so that nothing leaves it.
 *
 * `github.localhost` is the one host `gh` speaks plain HTTP to, which is what lets a local proxy
 * read the request line; the token is a dummy the proxy never checks. Asked with `execFile`
 * rather than a synchronous spawn, because this process is also the proxy answering it.
 */
async function methodGhSends(args, cwd = process.cwd()) {
  const seen = [];
  const proxy = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      seen.push({ method: request.method, body });
      response.setHeader('content-type', 'application/json');
      response.end('{}');
    });
  });
  await new Promise((listening) => proxy.listen(0, '127.0.0.1', listening));
  const config = mkdtempSync(join(tmpdir(), 'rigger-gh-method-'));
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GH_CONFIG_DIR: config,
    GH_HOST: 'github.localhost',
    GH_ENTERPRISE_TOKEN: 'not-a-token',
    GH_NO_UPDATE_NOTIFIER: '1',
    HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`,
  };
  try {
    await new Promise((done, failed) => {
      execFile(installedGh(), args, { env, cwd }, (error) => (error ? failed(error) : done()));
    });
  } finally {
    proxy.close();
  }
  assert.equal(seen.length, 1, `\`gh ${args.join(' ')}\` sent ${seen.length} requests`);
  return seen[0];
}

test('the read runner admits a `gh api <path>` form only where gh itself sends it as a GET with no body', async () => {
  // `D16` rule 2: `gh` owns which method `gh api` sends, and the runner's rule is a copy of that
  // answer. So `gh` is asked, each run, and the relation asserted: a form the runner admits is one
  // `gh` sends as a GET carrying nothing, and a form `gh` sends any other way is one it refuses.
  // The defect this catches is the day `gh` changes its default, which a pinned table would go on
  // agreeing with.
  // The directory gh runs in holds a file named `-X`, for the form whose path slot is `--input`.
  const inputs = mkdtempSync(join(tmpdir(), 'rigger-gh-input-'));
  const body = join(inputs, 'body.json');
  writeFileSync(body, '{"a":1}');
  writeFileSync(join(inputs, '-X'), '{"a":1}');
  const forms = [
    ['api', 'rate_limit', '-X', 'GET'],
    ['api', 'rate_limit', '--method', 'GET'],
    ...REFUSED_PATH_FORMS.map((form) => form.map((word) => (word === 'body.json' ? body : word))),
    FLAG_IN_PATH_SLOT[0],
  ];
  for (const args of forms) {
    const sent = await methodGhSends(args, inputs);
    let admitted = true;
    try {
      readRunner(args, { send: recording() });
    } catch {
      admitted = false;
    }
    const aRead = sent.method === 'GET' && sent.body === '';
    if (admitted) assert.ok(aRead, `the runner admits \`gh ${args.join(' ')}\`, which gh sends as ${sent.method}`);
    if (!aRead) assert.equal(admitted, false, `\`gh ${args.join(' ')}\` is sent as ${sent.method}`);
  }
});

test('the read runner refuses `gh api <path>` in any other form, naming it, and sends nothing', () => {
  // The defect this catches is a runner that reads `gh api <path>` as a read because no method
  // was named: `gh` then chooses the method itself, and with a field or an input it chooses POST.
  // `-X GET -f` sends a GET, and is refused anyway, because the card admits no field at all. A
  // flag in the path slot takes the next word as its value, so `-X GET` there sets no method.
  for (const args of [...REFUSED_PATH_FORMS, ...FLAG_IN_PATH_SLOT]) {
    const send = recording();
    assert.throws(() => readRunner(args, { send }), (error) => error.message.includes(args.join(' ')), args.join(' '));
    assert.deepEqual(send.sent, [], args.join(' '));
  }
});

/** A `gh api graphql` request carrying `document`, in the form every side builds its requests. */
const graphql = (document) => ['api', 'graphql', '-f', `query=${document}`];

/**
 * Asserts `runner` refuses `args`, with a message naming each of `names`, and never sends it.
 * `names` is what the refusal has to say for a reader to know what was refused.
 *
 * With no `answer`, nothing at all may be sent. With one, the runner may first read what it needs
 * to judge the request, and `answer` stands in for the forge answering those reads.
 */
function refuses(runner, args, names, { answer } = {}) {
  const send = recording(answer);
  assert.throws(
    () => runner(args, { send }),
    (error) => names.every((name) => error.message.includes(name)) || assert.fail(`${error.message} does not name ${names.join(', ')}`),
  );
  if (answer === undefined) assert.deepEqual(send.sent, [], 'a refused request sent something');
  assert.ok(!send.sent.some((sent) => JSON.stringify(sent) === JSON.stringify(['gh', ...args])), 'the refused request was sent');
  return send;
}

test('the read runner sends a GraphQL query, whatever its strings and comments say', () => {
  // The defect this catches is an operation type read off the text rather than the document: a
  // query whose string argument or comment says `mutation` is still a query.
  const documents = [
    'query { viewer { login } }',
    '{ viewer { login } }',
    'query Named($n: Int!) { user(login: "mutation {") { projectV2(number: $n) { id } } } # mutation { deleteProjectV2(input: {}) }',
    'query { node(id: "x") { ...F } } fragment F on ProjectV2 { title }',
  ];
  for (const document of documents) {
    const send = recording();
    readRunner(graphql(document), { send });
    assert.deepEqual(send.sent, [['gh', ...graphql(document)]], document);
  }
});

test('the read runner sends a GraphQL query with its variables as fields', () => {
  const args = [...graphql('query($n: Int!) { viewer { projectV2(number: $n) { id } } }'), '-F', 'n=6'];
  const send = recording();
  readRunner(args, { send });
  assert.deepEqual(send.sent, [['gh', ...args]]);
});

test('the read runner refuses a GraphQL mutation that changes an item\'s title, naming it, and sends nothing', () => {
  // Review C2's shape: a write that records nothing of itself. Here the read runner is what
  // refuses it, because it is not a query, whatever its caller calls it.
  refuses(readRunner, graphql('mutation { updateProjectV2DraftIssue(input: {draftIssueId: "DI_1", title: "Renamed"}) { draftIssue { id } } }'), ['mutation', 'updateProjectV2DraftIssue']);
  refuses(readRunner, graphql('mutation Retitle { updateIssue(input: {id: "I_1", title: "Renamed"}) { issue { id } } }'), ['mutation', 'Retitle']);
  refuses(readRunner, graphql('subscription { issueUpdated { id } }'), ['subscription']);
});

test('the read runner refuses a GraphQL request carrying more than one operation, naming them, and sends nothing', () => {
  refuses(
    readRunner,
    graphql('query Items { viewer { login } } mutation Archive { archiveProjectV2Item(input: {projectId: "P", itemId: "I"}) { item { id } } }'),
    ['Items', 'Archive'],
  );
});

test('the read runner refuses a GraphQL request whose document it cannot see or read, naming it, and sends nothing', () => {
  // A document read from a file, a second document, or one that does not parse is a request
  // whose operation the runner cannot name, so it cannot know it is a query.
  refuses(readRunner, ['api', 'graphql', '-F', 'query=@write.graphql'], ['query=@write.graphql']);
  refuses(readRunner, [...graphql('query { viewer { login } }'), '-f', 'query=mutation { x }'], ['query=']);
  refuses(readRunner, graphql('query { viewer { login }'), ['query { viewer { login }']);
  refuses(readRunner, ['api', 'graphql'], ['api graphql']);
  refuses(readRunner, [...graphql('query { viewer { login } }'), '--input', 'body.json'], ['--input']);
  refuses(readRunner, [...graphql('query { viewer { login } }'), '-X', 'GET'], ['-X']);
});

/** Creating a single-select field, in the shape the schema-write side sends it. */
const CREATE_FIELD = 'mutation { createProjectV2Field(input: {projectId: "PVT_1", dataType: SINGLE_SELECT, name: "Priority", singleSelectOptions: [{name: "High", color: GRAY, description: ""}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }';

/** Creating a label, in the shape the schema-write side sends it. */
const CREATE_LABEL = 'mutation { createLabel(input: {repositoryId: "R_1", name: "type:change", color: "ededed"}) { label { id } } }';

/**
 * Setting a board item's `Priority`, a field-value write naming a board item: review C1's shape,
 * a column-shaped write sent on another field.
 */
const SET_PRIORITY = 'mutation { updateProjectV2ItemFieldValue(input: {projectId: "PVT_1", itemId: "PVTI_1", fieldId: "PVTSSF_priority", value: {singleSelectOptionId: "p0"}}) { projectV2Item { id } } }';

test('the schema-write runner sends creating a field and creating a label, which its allowlist holds', () => {
  for (const document of [CREATE_FIELD, CREATE_LABEL]) {
    const send = recording();
    schemaWriteRunner(graphql(document), { send });
    assert.deepEqual(send.sent, [['gh', ...graphql(document)]]);
  }
});

test('the schema-write runner refuses an operation its allowlist does not hold, naming it, and sends nothing', () => {
  // Before #217 the allowlist is the two creations. Deleting a field, editing a field's options
  // and deleting the board are schema writes too, and none of them is admitted.
  refuses(schemaWriteRunner, graphql('mutation { deleteProjectV2Field(input: {fieldId: "PVTSSF_1"}) { clientMutationId } }'), ['deleteProjectV2Field']);
  refuses(schemaWriteRunner, graphql('mutation { updateProjectV2Field(input: {fieldId: "PVTSSF_1", singleSelectOptions: []}) { clientMutationId } }'), ['updateProjectV2Field']);
  refuses(schemaWriteRunner, graphql('mutation { deleteProjectV2(input: {projectId: "PVT_1"}) { clientMutationId } }'), ['deleteProjectV2']);
});

test('the schema-write runner refuses a field-value write that names a board item and sets Priority, and sends nothing', () => {
  // Review C1's shape. It names a board item, so it is not the schema side's however it is sent.
  refuses(schemaWriteRunner, graphql(SET_PRIORITY), ['updateProjectV2ItemFieldValue', 'itemId']);
});

test('the schema-write runner refuses an allowlisted operation whose arguments name a board item, decided by the name', () => {
  // The defect this catches is a board item recognised by its ID's prefix: GitHub's ID formats are
  // its own (`D16`), so an argument named for an item is what is read, whatever its value looks
  // like, and a value that looks like an item's ID names nothing when its argument does not.
  const naming = 'mutation { createProjectV2Field(input: {projectId: "PVT_1", itemId: "not-an-item-looking-id", dataType: SINGLE_SELECT, name: "Priority", singleSelectOptions: []}) { clientMutationId } }';
  refuses(schemaWriteRunner, graphql(naming), ['createProjectV2Field', 'itemId']);
  const looking = CREATE_LABEL.replace('"type:change"', '"PVTI_lADOBzomGc4Bkn7fzgd"');
  const send = recording();
  schemaWriteRunner(graphql(looking), { send });
  assert.equal(send.sent.length, 1);
});

/** Moving board item `PVTI_1` to the `Status` option `opt_review`: the column move. */
const MOVE = 'mutation { updateProjectV2ItemFieldValue(input: {projectId: "PVT_1", itemId: "PVTI_1", fieldId: "PVTSSF_status", value: {singleSelectOptionId: "opt_review"}}) { projectV2Item { id } } }';

/**
 * The forge answering the item-write runner's read of which field holds the columns, where that
 * is `PVTSSF_status` and the field the request names is called `target`. The shape is the one
 * GitHub answered on 2026-09-25 for the same query over IDs that resolve to nothing, with `null`s
 * filled in as the query's selections name them.
 */
const holdingColumns = (target) => (command, args) => (args.at(-1).startsWith('query=query')
  ? { status: 0, stdout: JSON.stringify({ data: { project: { field: { id: 'PVTSSF_status' } }, target: { name: target } } }), stderr: '' }
  : { status: 0, stdout: '{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_1"}}}}', stderr: '' });

test('the item-write runner sends the column move, a field-value write on the field holding the columns', () => {
  const send = recording(holdingColumns('Status'));

  itemWriteRunner(graphql(MOVE), { send });

  // First the read of which field holds the columns, through the read runner's own form, then the
  // write it admitted.
  assert.equal(send.sent.length, 2, JSON.stringify(send.sent));
  assert.match(send.sent[0].at(-1), /^query=query /);
  assert.match(send.sent[0].at(-1), /"PVT_1"/);
  assert.deepEqual(send.sent[1], ['gh', ...graphql(MOVE)]);
});

test('the item-write runner refuses a field-value write on any field but the one holding the columns, naming it', () => {
  // Review C1's other half: a field-value write is the item side's, and on this side it is the
  // column move and nothing else. Which field holds the columns is read from the board, because
  // an ID says nothing about which field it is.
  const send = refuses(itemWriteRunner, graphql(SET_PRIORITY), ['Priority', 'PVTSSF_priority'], { answer: holdingColumns('Priority') });
  assert.equal(send.sent.length, 1, 'more was sent than the read of which field holds the columns');
});

test('the item-write runner refuses a request that archives a board item, naming it, and sends nothing', () => {
  refuses(itemWriteRunner, graphql('mutation { archiveProjectV2Item(input: {projectId: "PVT_1", itemId: "PVTI_1"}) { item { id } } }'), ['archiveProjectV2Item']);
});

test('the item-write runner refuses every operation but the column move, naming it, and sends nothing', () => {
  // In M1 its allowlist is the column move alone. Deleting, clearing and reordering all name a
  // board item, and none is a card's need yet; a schema write is not the item side's at all.
  const refused = [
    ['deleteProjectV2Item', 'mutation { deleteProjectV2Item(input: {projectId: "PVT_1", itemId: "PVTI_1"}) { deletedItemId } }'],
    ['clearProjectV2ItemFieldValue', 'mutation { clearProjectV2ItemFieldValue(input: {projectId: "PVT_1", itemId: "PVTI_1", fieldId: "PVTSSF_status"}) { clientMutationId } }'],
    ['updateProjectV2ItemPosition', 'mutation { updateProjectV2ItemPosition(input: {projectId: "PVT_1", itemId: "PVTI_1", afterId: "PVTI_2"}) { clientMutationId } }'],
    ['createLabel', CREATE_LABEL],
    // Carrying the column move's own input, so the allowlist is the only thing that refuses it.
    ['deleteProjectV2Item', MOVE.replaceAll('updateProjectV2ItemFieldValue', 'deleteProjectV2Item')],
  ];
  for (const [operation, document] of refused) {
    refuses(itemWriteRunner, graphql(document), [operation], { answer: holdingColumns('Status') });
  }
});

test('the item-write runner refuses a write on the columns field that sets anything but an option, naming it', () => {
  for (const value of ['{text: "Review"}', '{singleSelectOptionId: "opt_review", text: "x"}']) {
    refuses(itemWriteRunner, graphql(MOVE.replace('{singleSelectOptionId: "opt_review"}', value)), ['updateProjectV2ItemFieldValue', 'value']);
  }
  refuses(itemWriteRunner, graphql(MOVE.replace('fieldId: "PVTSSF_status"', 'fieldId: "PVTSSF_status", fieldId: "PVTSSF_priority"')), ['fieldId']);
});

test('the item-write runner sends no write when it cannot read which field holds the columns', () => {
  // Recorded from gh 2.99.0 on 2026-09-25, answering a query over an ID that resolves to nothing.
  const failing = () => ({ status: 1, stdout: '{"data":{"project":null}}', stderr: "gh: Could not resolve to a node with the global id of 'PVT_1'\n" });
  const send = recording(failing);
  assert.throws(() => itemWriteRunner(graphql(MOVE), { send }), /Could not resolve to a node/);
  assert.equal(send.sent.length, 1);
});

test('a write runner refuses a request carrying more than one operation, naming them, and sends nothing', () => {
  const two = 'mutation { createLabel(input: {repositoryId: "R_1", name: "a", color: "ededed"}) { label { id } } deleteProjectV2Item(input: {projectId: "PVT_1", itemId: "PVTI_1"}) { deletedItemId } }';
  refuses(schemaWriteRunner, graphql(two), ['createLabel', 'deleteProjectV2Item']);
  refuses(itemWriteRunner, graphql(two), ['createLabel', 'deleteProjectV2Item']);
  const documents = `${CREATE_LABEL} ${CREATE_FIELD.replace('mutation {', 'mutation Second {')}`;
  refuses(schemaWriteRunner, graphql(documents), ['createLabel', 'Second']);
});

test('a write runner refuses a request whose operation it cannot name from the document alone, and sends nothing', () => {
  // A variable, a fragment at the root or a directive puts what the operation does somewhere the
  // document does not show, so the runner could not name what it would send. Any other form of
  // request is refused for the same reason.
  const refused = [
    [graphql('mutation($input: CreateLabelInput!) { createLabel(input: $input) { label { id } } }'), ['$input']],
    [graphql('mutation { ...Write } fragment Write on Mutation { deleteProjectV2(input: {projectId: "PVT_1"}) { clientMutationId } }'), ['fragment']],
    [graphql('mutation { createLabel(input: {repositoryId: "R_1", name: "a", color: "ededed"}) @skip(if: false) { label { id } } }'), ['@skip']],
    [graphql('query { viewer { login } }'), ['query']],
    [[...graphql(CREATE_LABEL), '-F', 'x=1'], ['-F x=1']],
    [['api', 'graphql', '-F', `query=${CREATE_LABEL}`], ['-F query=']],
    [['label', 'create', 'type:change'], ['label create type:change']],
  ];
  for (const [args, names] of refused) {
    refuses(schemaWriteRunner, args, names);
    refuses(itemWriteRunner, args, names);
  }
});
