// ABOUTME: Tests the independently expected answers of in-process fixture commands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedCommand } from './in-process-fixtures.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerFakeGh } from './fake-gh.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { clonedFromOrigin, gitIn, repositoryIn } from './git-repository.mjs';
import { standInAct, standInRecord, standInReply } from './stub-claude.mjs';

test('an in-process fixed command preserves its configured result', async () => {
  const command = fixedCommand({ status: 7, stdout: 'configured stdout\n', stderr: 'configured stderr\n' });
  const result = await command?.run?.(['supplied-command-argument']);
  assert.deepEqual(result, { status: 7, stdout: 'configured stdout\n', stderr: 'configured stderr\n' },
    'the fixed command returns the independently supplied output and status');
});


test('an in-process fixed command records argv elements without joining them', async () => {
  const command = fixedCommand({ status: 7, stdout: 'configured stdout\n', stderr: 'configured stderr\n' });
  const argv = ['two words', '', 'tail'];
  await command.run(argv);
  argv[0] = 'later replacement';
  argv.push('later addition');
  const observed = typeof command.calls === 'function' ? command.calls() : undefined;
  assert.deepEqual(observed, [['two words', '', 'tail']],
    'in-process calls preserve the supplied argument elements, spaces and empty argument');
});


test('an in-process fixed command keeps defaults and normalizes a noninteger status', async () => {
  const defaults = fixedCommand();
  assert.deepEqual(await defaults.run([]), { status: 0, stdout: '', stderr: '' },
    'the default fixed answer is success with empty output');
  const configured = fixedCommand({ status: 7.5, stdout: 'fractional stdout\n', stderr: 'fractional stderr\n' });
  assert.deepEqual(await configured.run(['fractional']),
    { status: 1, stdout: 'fractional stdout\n', stderr: 'fractional stderr\n' },
    'a noninteger status keeps the executable stub normalization to one');
});


test('in-process fixed command instances keep answers and requests separate', async () => {
  const first = fixedCommand({ status: 7, stdout: 'first stdout\n', stderr: 'first stderr\n' });
  const second = fixedCommand({ status: 3, stdout: 'second stdout\n', stderr: 'second stderr\n' });
  const firstCall = first.run(['first argument', '']);
  const secondCall = second.run(['second', 'two words']);
  const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
  assert.deepEqual(firstResult, { status: 7, stdout: 'first stdout\n', stderr: 'first stderr\n' },
    'the first instance returns only its independently supplied answer');
  assert.deepEqual(secondResult, { status: 3, stdout: 'second stdout\n', stderr: 'second stderr\n' },
    'the second instance returns only its independently supplied answer');
  assert.deepEqual(await first.run(['first tail']),
    { status: 7, stdout: 'first stdout\n', stderr: 'first stderr\n' });
  assert.deepEqual(first.calls(), [['first argument', ''], ['first tail']],
    'the first instance records only its own requests in order');
  assert.deepEqual(second.calls(), [['second', 'two words']],
    'the second instance records no request from the first');
});


test('an in-process forge answers a repository ID read through its shared dispatcher', async (t) => {
  const directory = temporaryDirectory('rigger-in-process-forge-', { context: t });
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify({
    repo: 'example/widgets', owner: 'example', project: 23, model: {}, writes: [], sent: [],
  }));
  const result = await answerFakeGh(statePath, [
    'api', 'graphql', '-f',
    'query=query { repository(owner: "example", name: "widgets") { id } }',
  ]);
  assert.deepEqual(result, { status: 0, stdout: '{"data":{"repository":{"id":"R_fake"}}}\n', stderr: '' },
    'the shared forge returns the independently expected repository ID response');
});


test('an in-process forge uses supplied time for an agent PR comment', async (t) => {
  const directory = temporaryDirectory('rigger-in-process-comment-', { context: t });
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify({
    repo: 'example/widgets', owner: 'example', project: 23, model: {}, writes: [], sent: [],
    repository: { pullRequests: [{ number: 301, head: 'topic', sha: 'a'.repeat(40), comments: [] }] },
  }));
  const result = await answerFakeGh(statePath,
    ['pr', 'comment', '301', '--body', 'A note at supplied time.'],
    { now: () => '2000-01-02T03:04:05Z' });
  assert.deepEqual(result,
    { status: 0, stdout: 'https://github.com/example/widgets/pull/301#issuecomment-1\n', stderr: '' },
    'the shared agent dispatcher returns the independently expected comment URL and status');
  const held = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(held.repository.pullRequests[0].comments,
    [{ body: 'A note at supplied time.', createdAt: '2000-01-02T03:04:05Z' }],
    'the persisted comment uses the supplied time rather than ambient wall time');
  assert.deepEqual(held.sent, [['pr', 'comment', '301', '--body', 'A note at supplied time.']],
    'the request is recorded exactly once with its supplied argument elements');
});


test('an in-process forge uses supplied time for a REST issue comment', async (t) => {
  const directory = temporaryDirectory('rigger-in-process-rest-comment-', { context: t });
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify({
    repo: 'example/widgets', owner: 'example', project: 23, model: {}, writes: [], sent: [],
    repository: { issues: [{ number: 12, comments: [
      { body: 'Earlier REST comment', createdAt: '1999-12-31T23:59:59Z' },
    ] }] },
  }));
  const result = await answerFakeGh(statePath,
    ['api', 'repos/example/widgets/issues/12/comments', '-X', 'POST', '-f', 'body=A REST note at supplied time.'],
    { now: () => '2000-02-03T04:05:06Z' });
  assert.deepEqual(result,
    { status: 0, stdout: '{"id":2,"body":"A REST note at supplied time."}', stderr: '' },
    'the REST comment returns the independently expected modeled response and status');
  const held = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(held.repository.issues[0].comments, [
    { body: 'Earlier REST comment', createdAt: '1999-12-31T23:59:59Z' },
    { body: 'A REST note at supplied time.', createdAt: '2000-02-03T04:05:06Z' },
  ], 'the REST comment uses supplied time and preserves the earlier comment');
  assert.deepEqual(held.sent,
    [['api', 'repos/example/widgets/issues/12/comments', '-X', 'POST', '-f', 'body=A REST note at supplied time.']],
    'the REST comment records the supplied request exactly once');
});


test('an in-process forge preserves a modeled HTTP refusal and the issue state', async (t) => {
  const directory = temporaryDirectory('rigger-in-process-refusal-', { context: t });
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify({
    repo: 'example/widgets', owner: 'example', project: 23, model: {}, writes: [], sent: [],
    repository: {
      issues: [{ number: 12, body: 'Existing card body', comments: [
        { body: 'Earlier comment', createdAt: '1999-12-31T23:59:59Z' },
      ] }],
      commentReplies: { 12: { status: '422', message: 'Body cannot be blank' } },
    },
  }));
  const result = await answerFakeGh(statePath,
    ['api', 'repos/example/widgets/issues/12/comments', '-X', 'POST', '-f', 'body='],
    { now: () => '2000-02-03T04:05:06Z' });
  assert.deepEqual(result, {
    status: 1,
    stdout: '{"status":"422","message":"Body cannot be blank"}',
    stderr: 'gh: Body cannot be blank (HTTP 422)\n',
  }, 'a modeled refusal preserves nonzero status, printed response and stderr');
  const held = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(held.repository.issues, [
    { number: 12, body: 'Existing card body', comments: [
      { body: 'Earlier comment', createdAt: '1999-12-31T23:59:59Z' },
    ] },
  ], 'a refused comment preserves the independently seeded issue');
  assert.deepEqual(held.sent,
    [['api', 'repos/example/widgets/issues/12/comments', '-X', 'POST', '-f', 'body=']],
    'the refused request is recorded exactly once without inventing a successful comment');
  assert.deepEqual(held.writes, [], 'the refusal invents no board write');
});


test('an in-process forge propagates an unexpected collaborator error', async (t) => {
  const directory = temporaryDirectory('rigger-in-process-unexpected-', { context: t });
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify({
    repo: 'example/widgets', owner: 'example', project: 23, model: {}, writes: [], sent: [],
    repository: { issues: [{ number: 12, body: 'Existing card body', comments: [
      { body: 'Earlier comment', createdAt: '1999-12-31T23:59:59Z' },
    ] }] },
  }));
  await assert.rejects(() => answerFakeGh(statePath,
    ['api', 'repos/example/widgets/issues/12/comments', '-X', 'POST', '-f', 'body=A comment interrupted by the clock.'],
    { now: () => { throw new Error('configured clock failure'); } }),
  /configured clock failure/, 'unexpected collaborator errors stay rejections rather than modeled answers');
  const held = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(held.repository.issues, [
    { number: 12, body: 'Existing card body', comments: [
      { body: 'Earlier comment', createdAt: '1999-12-31T23:59:59Z' },
    ] },
  ], 'the unexpected failure does not invent a successful comment');
  assert.deepEqual(held.sent,
    [['api', 'repos/example/widgets/issues/12/comments', '-X', 'POST', '-f', 'body=A comment interrupted by the clock.']],
    'the failed attempt retains its exact request record');
  assert.deepEqual(held.writes, [], 'the unexpected failure invents no board write');
});


test('an in-process forge selects a pull request from its supplied working directory', async () => {
  const consumer = repositoryIn('rigger-in-process-cwd-', { 'owned.txt': 'ready\n' });
  gitIn(consumer, 'branch', '-M', 'request-topic');
  assert.equal(gitIn(consumer, 'branch', '--show-current').trim(), 'request-topic',
    'the supplied repository is ready on the independently named request branch');
  const statePath = join(consumer, 'board.json');
  writeFileSync(statePath, JSON.stringify({
    repo: 'example/widgets', owner: 'example', project: 23, model: {}, writes: [], sent: [],
    repository: { pullRequests: [{ number: 301, head: 'request-topic',
      sha: gitIn(consumer, 'rev-parse', 'HEAD').trim(), comments: [] }] },
  }));
  const result = await answerFakeGh(statePath, ['pr', 'view', '--json', 'number'], { cwd: consumer });
  assert.deepEqual(result, { status: 0, stdout: '{"number":301}\n', stderr: '' },
    'the default selector uses the supplied directory rather than the caller directory');
  const held = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(held.sent, [['pr', 'view', '--json', 'number']], 'the view records its exact supplied request');
  assert.deepEqual(held.repository.pullRequests[0].comments, [], 'the view adds no comment');
});


test('an in-process forge creates from the branch in its supplied working directory', async (t) => {
  const directory = temporaryDirectory('rigger-in-process-create-', { context: t });
  const { origin, repository } = clonedFromOrigin(directory);
  gitIn(repository, 'switch', '--quiet', '-c', 'request-topic');
  writeFileSync(join(repository, 'README'), 'request content\n');
  gitIn(repository, 'commit', '--quiet', '-am', 'Request content');
  gitIn(repository, 'push', '--quiet', 'origin', 'request-topic');
  const head = gitIn(repository, 'rev-parse', 'HEAD').trim();
  assert.equal(gitIn(repository, 'branch', '--show-current').trim(), 'request-topic');
  assert.equal(gitIn(origin, 'rev-parse', 'refs/heads/request-topic').trim(), head,
    'the independently selected request branch is ready in the owned origin');
  assert.notEqual(gitIn(origin, 'rev-parse', 'refs/heads/main').trim(), head);
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify({
    repo: 'example/widgets', owner: 'example', project: 23, model: {}, writes: [], sent: [], origin,
  }));
  const args = ['pr', 'create', '--title', 'Request title', '--body', 'Request body.'];
  const result = await answerFakeGh(statePath, args, { cwd: repository });
  assert.deepEqual(result, { status: 0, stdout: 'https://github.com/example/widgets/pull/1\n', stderr: '' },
    'create takes its default head from the supplied repository');
  const held = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(held.repository.pullRequests.map(({ number, head, sha, base, title, body }) =>
    ({ number, head, sha, base, title, body })),
  [{ number: 1, head: 'request-topic', sha: head, base: 'main', title: 'Request title', body: 'Request body.' }]);
  assert.deepEqual(held.sent, [args]);
});


test('an in-process forge reads comment body sources from supplied request context', async (t) => {
  const directory = temporaryDirectory('rigger-in-process-body-', { context: t });
  const statePath = join(directory, 'board.json');
  const fileBody = '## Supplied file\n\nLiteral file bytes.\n';
  writeFileSync(join(directory, 'request-body.txt'), fileBody);
  assert.equal(readFileSync(join(directory, 'request-body.txt'), 'utf8'), fileBody,
    'the requested relative body file exists with independent bytes before the call');
  writeFileSync(statePath, JSON.stringify({
    repo: 'example/widgets', owner: 'example', project: 23, model: {}, writes: [], sent: [],
    repository: { pullRequests: [{ number: 301, head: 'topic', sha: 'a'.repeat(40), comments: [] }] },
  }));
  const absoluteArgs = ['pr', 'comment', '301', '--body-file', join(directory, 'request-body.txt')];
  const absoluteResult = await answerFakeGh(statePath, absoluteArgs,
    { now: () => '2000-03-04T05:06:06Z' });
  assert.deepEqual(absoluteResult,
    { status: 0, stdout: 'https://github.com/example/widgets/pull/301#issuecomment-1\n', stderr: '' },
    'an independently absolute body file does not need a working directory');
  const fileArgs = ['pr', 'comment', '301', '--body-file', 'request-body.txt'];
  let fileResult;
  await assert.doesNotReject(async () => {
    fileResult = await answerFakeGh(statePath, fileArgs,
      { cwd: directory, now: () => '2000-03-04T05:06:07Z' });
  }, 'a ready relative body file is read from the supplied request directory');
  assert.deepEqual(fileResult,
    { status: 0, stdout: 'https://github.com/example/widgets/pull/301#issuecomment-2\n', stderr: '' });
  const held = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(held.repository.pullRequests[0].comments,
    [
      { body: '## Supplied file\n\nLiteral file bytes.\n', createdAt: '2000-03-04T05:06:06Z' },
      { body: '## Supplied file\n\nLiteral file bytes.\n', createdAt: '2000-03-04T05:06:07Z' },
    ]);
  assert.deepEqual(held.sent, [absoluteArgs, fileArgs]);

  const inputArgs = ['pr', 'comment', '301', '--body-file', '-'];
  const inputResult = await answerFakeGh(statePath, inputArgs,
    { now: () => '2000-03-04T05:06:08Z', input: () => '## Supplied stdin\n\nLiteral input bytes.\n' });
  assert.deepEqual(inputResult,
    { status: 0, stdout: 'https://github.com/example/widgets/pull/301#issuecomment-3\n', stderr: '' });
  const afterInput = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(afterInput.repository.pullRequests[0].comments, [
    { body: '## Supplied file\n\nLiteral file bytes.\n', createdAt: '2000-03-04T05:06:06Z' },
    { body: '## Supplied file\n\nLiteral file bytes.\n', createdAt: '2000-03-04T05:06:07Z' },
    { body: '## Supplied stdin\n\nLiteral input bytes.\n', createdAt: '2000-03-04T05:06:08Z' },
  ], 'supplied stdin preserves independent nonempty bytes after both file comments');
  assert.deepEqual(afterInput.sent, [absoluteArgs, fileArgs, inputArgs]);
});


test('the shared stand-in reply preserves no-act, literal print and configured exit', () => {
  const cases = [
    { plan: {}, expected: [['exit', 0]] },
    { plan: { 31: { engineer: { print: 'Literal agent output.\n' } } }, expected: [['output', 'Literal agent output.\n'], ['exit', 0]] },
    { plan: { 31: { engineer: { print: 'Literal before seven.\n', exit: 7 } } }, expected: [['output', 'Literal before seven.\n'], ['exit', 7]] },
  ];
  for (const given of cases) {
    const run = standInRecord({
      executable: '/fixture/claude', args: ['--append-system-prompt-file', '/fixture/.claude/agents/engineer.md', 'two words', ''],
      input: 'Rigger sends CaRd #31, then card #999.\n', cwd: '/fixture/consumer',
      env: { RIGGER_STAND_IN_VALUE: 'literal', UNRELATED: 'not recorded' }, pid: 7001,
    });
    assert.deepEqual(run, {
      name: 'claude', args: ['--append-system-prompt-file', '/fixture/.claude/agents/engineer.md', 'two words', ''],
      cwd: '/fixture/consumer', card: 31, role: 'engineer', input: 'Rigger sends CaRd #31, then card #999.\n',
      env: { RIGGER_STAND_IN_VALUE: 'literal' }, pid: 7001,
    }, 'the shared record uses only the independent explicit request values');
    const seen = [];
    const reply = standInReply(standInAct(given.plan, run), {
      output: (text) => seen.push(['output', text]), exit: (code) => seen.push(['exit', code]),
    });
    reply.print();
    reply.finish();
    assert.deepEqual(seen, given.expected, 'existing configured print/exit outcomes reach their explicit ports exactly');
  }
});


test('the shared stand-in forever branch selects keep-alive without natural exit', () => {
  const seen = [];
  const reply = standInReply({ forever: true, exit: 7 }, {
    output: (value) => seen.push(['output', value]),
    exit: (code) => seen.push(['exit', code]),
    keepAlive: () => { seen.push(['keep-alive']); return 'opaque port result'; },
  });
  reply.finish();
  assert.deepEqual(seen, [['keep-alive']], 'forever selects its existing keep-alive branch rather than natural exit');
});


test('the shared stand-in forever resource remains pending until its registered cleanup', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const models = ['first', 'second'].map((label) => {
      let ownership = 'absent';
      let registrations = 0;
      let releases = 0;
      let cleanup;
      const exits = [];
      const output = [];
      const dispose = () => { ownership = 'released'; releases += 1; };
      const reply = standInReply({ forever: true, exit: 7 }, {
        output: (value) => output.push(value),
        exit: (code) => exits.push(code),
        keepAlive: () => { ownership = 'owned'; return dispose; },
        registerCleanup: (value) => { registrations += 1; cleanup = value; },
      });
      return {
        label, start: () => reply.finish(), cleanup: () => cleanup(),
        snapshot: () => ({ ownership, registrations, releases, exits: [...exits], output: [...output] }),
        registered: () => cleanup, dispose,
      };
    });
    const pending = { ownership: 'owned', registrations: 1, releases: 0, exits: [], output: [] };
    const cleaned = { ownership: 'released', registrations: 1, releases: 1, exits: [], output: [] };
    models[0].start();
    assert.equal(models[0].snapshot().ownership, 'owned', 'the resource was acquired before checking cleanup registration');
    assert.equal(models[0].snapshot().registrations, 1, 'the acquired forever resource registers its cleanup exactly once');
    assert.strictEqual(models[0].registered(), models[0].dispose, 'the registration carries this instance disposal capability');
    assert.deepEqual(models[0].snapshot(), pending, 'returning from finish is not natural logical exit');
    models[1].start();
    assert.deepEqual(models[0].snapshot(), pending, 'starting another instance does not end the first resource');
    assert.deepEqual(models[1].snapshot(), pending, 'the second resource is independently pending');
    assert.strictEqual(models[1].registered(), models[1].dispose);
    models[order[0]].cleanup();
    assert.deepEqual(models[order[0]].snapshot(), cleaned, 'registered cleanup releases its own resource without natural exit');
    assert.deepEqual(models[order[1]].snapshot(), pending, 'cleanup does not release the other instance resource');
    models[order[1]].cleanup();
    assert.deepEqual(models[order[1]].snapshot(), cleaned, 'the remaining registered cleanup releases its resource');
    assert.deepEqual(models[order[0]].snapshot(), cleaned, 'the earlier cleanup stays released without another release or exit');
  }
});
