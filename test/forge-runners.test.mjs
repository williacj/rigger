// ABOUTME: Tests the forge adapter's three runners: what each admits from its own side, what it
// refuses by name, and that a refused request sends nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRunner } from '../src/substrate/forge/runners.mjs';

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
 * The method and body `gh` really sends for `gh api` given `args`, caught by a proxy on this
 * machine so that nothing leaves it.
 *
 * `github.localhost` is the one host `gh` speaks plain HTTP to, which is what lets a local proxy
 * read the request line; the token is a dummy the proxy never checks. Asked with `execFile`
 * rather than a synchronous spawn, because this process is also the proxy answering it.
 */
async function methodGhSends(args) {
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
      execFile('gh', args, { env }, (error) => (error ? failed(error) : done()));
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
  const body = join(mkdtempSync(join(tmpdir(), 'rigger-gh-input-')), 'body.json');
  writeFileSync(body, '{"a":1}');
  const forms = [
    ['api', 'rate_limit', '-X', 'GET'],
    ['api', 'rate_limit', '--method', 'GET'],
    ...REFUSED_PATH_FORMS.map((form) => form.map((word) => (word === 'body.json' ? body : word))),
  ];
  for (const args of forms) {
    const sent = await methodGhSends(args);
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
  // `-X GET -f` sends a GET, and is refused anyway, because the card admits no field at all.
  for (const args of REFUSED_PATH_FORMS) {
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
