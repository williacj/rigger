// ABOUTME: Tests the independently expected answers of in-process fixture commands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORGE_MANIFEST, assertForgeState, assertOriginState, fixedCommand, forgeStore, judgeInput, logicalAgent, logicalCodex, originFixture, parsedFindings, runStandInActions, withFacts } from './in-process-fixtures.mjs';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ANSWERED, ANSWERED, answerFakeGh, commandOf } from './fake-gh.mjs';
import { parseMarker } from '../src/workflow/marker.mjs';
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

const seeded = (t, seed = FORGE_MANIFEST.world) => {
  const directory = temporaryDirectory('rigger-forge-', { context: t });
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify(seed));
  return { directory, statePath };
};
const heldAt = (statePath) => JSON.parse(readFileSync(statePath, 'utf8'));

test('a forge transaction reaches its gate points in order and only success reaches commit', async (t) => {
  const cases = [
    { args: ['pr', 'comment', '301', '--body', 'Gate note'], points: [['recorded', 2], ['answered', 2]] },
    { args: ['api', 'graphql', '-f', 'query=query { repository(owner: "example", name: "widgets") { id } }'], points: [['recorded', 2], ['answered', 2]] },
    { args: ['pr', 'comment', '999', '--body', 'x'], points: [['recorded', 2]] },
    { args: ['auth', 'status'], points: [['recorded', 2]] },
  ];
  for (const { args, points } of cases) {
    const { statePath } = seeded(t);
    const seen = [];
    const gate = async (point) => { seen.push([point, heldAt(statePath).repository.pullRequests[0].comments.length]); };
    await answerFakeGh(statePath, args, { now: () => '2000-01-01T00:00:01Z', gate });
    assert.deepEqual(seen, points, 'each gate point fires in order, before any commit');
  }
});

const contextOf = (t, directory, given = {}) => ({
  now: () => given.now, input: () => given.input,
  cwd: given.cwd === '$EMPTY' ? temporaryDirectory('rigger-forge-cwd-', { context: t }) : directory,
});
const answerOf = ({ status, stdout, stderr }) => ({ status, stdout, stderr });

test('forge cases cover every answered command and agent subcommand', () => {
  const all = [...FORGE_MANIFEST.cases, ...FORGE_MANIFEST.originCases];
  const shapes = all.filter(({ key }) => typeof key === 'number').map(({ args }) => commandOf(args));
  assert.deepEqual([...new Set(shapes)].sort(), [...ANSWERED].sort(), 'every answered shape has a case and every case shape is answered');
  const agents = all.filter(({ key }) => typeof key === 'string').map(({ key }) => key);
  assert.deepEqual([...new Set(agents)].sort(), [...AGENT_ANSWERED].sort(), 'every agent subcommand has a case');
});

for (const given of FORGE_MANIFEST.cases) {
  test(`forge case ${given.id} answers its independent literal`, async (t) => {
    const { directory, statePath } = seeded(t);
    assert.deepEqual(await answerFakeGh(statePath, given.args, contextOf(t, directory, given.context)), answerOf(given), `${given.id} answer`);
    assertForgeState(heldAt(statePath), given, FORGE_MANIFEST.world);
  });
}

for (const raw of FORGE_MANIFEST.originCases) {
  test(`forge origin case ${raw.id} answers its independent literal`, async (t) => {
    const directory = temporaryDirectory('rigger-forge-origin-', { context: t });
    const { repository, facts } = originFixture(directory);
    const given = withFacts(raw, facts);
    const statePath = join(directory, 'board.json');
    writeFileSync(statePath, JSON.stringify(withFacts(FORGE_MANIFEST.originWorld, facts)));
    const context = { cwd: repository, input: () => given.input };
    if (given.priorCase) await answerFakeGh(statePath, FORGE_MANIFEST.originCases.find(({ id }) => id === given.priorCase).args, context);
    const before = heldAt(statePath);
    assert.deepEqual(await answerFakeGh(statePath, given.args, context), answerOf(given), `${given.id} answer`);
    assertOriginState(heldAt(statePath), before, given);
  });
}

for (const given of FORGE_MANIFEST.sequences) {
  test(`forge sequence ${given.id} ${given.title}`, async (t) => {
    const { directory, statePath } = seeded(t, given.seed ?? FORGE_MANIFEST.world);
    const store = forgeStore(statePath);
    for (const step of given.steps) {
      assert.deepEqual(await store.answer(step.args, contextOf(t, directory, step.context)), answerOf(step), `${given.id} step answer`);
    }
    const held = heldAt(statePath);
    assert.deepEqual(held.sent, given.steps.map(({ args }) => args), `${given.id} request order`);
    assert.deepEqual(held.writes, given.writes, `${given.id} write order`);
  });
}

const STORE = { repo: 'example/widgets', owner: 'example', project: 23, writes: [], sent: [],
  model: { columns: ['Todo', 'Done'], items: [
    { type: 'issue', repository: 'example/widgets', number: 12, column: 'Todo' },
    { type: 'issue', repository: 'example/widgets', number: 13, column: 'Todo' } ] },
  repository: { pullRequests: [{ number: 301, head: 'topic', sha: 'a'.repeat(40), comments: [] }] } };
const NOTE = { A: '2000-01-01T00:00:01Z', B: '2000-01-01T00:00:02Z' };
const comment = (word) => ['pr', 'comment', '301', '--body', `Comment ${word}.`];
const noted = (word) => ({ body: `Comment ${word}.`, createdAt: NOTE[word] });
const READ = ['pr', 'view', '301', '--json', 'comments'];
const url = (n) => `https://github.com/example/widgets/pull/301#issuecomment-${n}\n`;
const success = (stdout) => ({ status: 0, stdout, stderr: '' });
const read = (...comments) => success(`${JSON.stringify({ comments })}\n`);
const move = (item) => ['api', 'graphql', '-f', `query=mutation { updateProjectV2ItemFieldValue(input: {projectId: "PVT_fake", itemId: "${item}", fieldId: "PVTSSF_Status", value: {singleSelectOptionId: "option-1"}}) { projectV2Item { id } } }`];
const moved = (item) => success(`{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"${item}"}}}}\n`);
const BOARD_READ = ['api', 'graphql', '-f', 'query=query { repositoryOwner(login: "example") { ... on ProjectV2Owner { projectV2(number: 23) { items(first: 2) { pageInfo { hasNextPage endCursor } nodes { id fieldValues(first: 5) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: 5) { pageInfo { hasNextPage } nodes { name } } } } } } } } } }'];
const doneItem = (index, number) => ({ id: `item-${index}`, fieldValues: { pageInfo: { hasNextPage: false }, nodes: [{ name: 'Done', field: { name: 'Status' } }] }, content: { __typename: 'Issue', number, title: '', body: '', repository: { nameWithOwner: 'example/widgets' }, labels: { pageInfo: { hasNextPage: false }, nodes: [] } } });
const BOTH_DONE = success(`${JSON.stringify({ data: { repositoryOwner: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: '2' }, nodes: [doneItem(1, 12), doneItem(2, 13)] } } } } })}\n`);

/** An explicit transaction gate that logs each point and holds at `held` until released. */
function holding(label, log, held) {
  let arrive; let open;
  const reached = new Promise((resolve) => { arrive = resolve; });
  const opened = new Promise((resolve) => { open = resolve; });
  return {
    reached,
    release: () => { log.push(`${label}:released`); open(); },
    gate: async (point) => { log.push(`${label}:${point}`); if (point === held) { arrive(); await opened; } },
  };
}

test('a read after a mutation on one forge store sees it once, in request order', async (t) => {
  const { statePath } = seeded(t, STORE);
  const store = forgeStore(statePath);
  assert.deepEqual(await store.answer(comment('A'), { now: () => NOTE.A }), success(url(1)));
  assert.deepEqual(await store.answer(READ, {}), read(noted('A')), 'the read sees the mutation once');
  assert.deepEqual(heldAt(statePath).sent, [comment('A'), READ], 'records stay in request order');
});

test('a read before a mutation on one forge store sees the seed and a later read the mutation', async (t) => {
  const { statePath } = seeded(t, STORE);
  const store = forgeStore(statePath);
  assert.deepEqual(await store.answer(READ, {}), read(), 'the first read sees the original seed');
  assert.deepEqual(await store.answer(comment('A'), { now: () => NOTE.A }), success(url(1)));
  assert.deepEqual(await store.answer(READ, {}), read(noted('A')), 'the later read sees the mutation');
  assert.deepEqual(heldAt(statePath).sent, [READ, comment('A'), READ]);
});

test('a failed mutation on one forge store keeps its record and invents no effect', async (t) => {
  const { statePath } = seeded(t, STORE);
  const store = forgeStore(statePath);
  const held = holding('F', [], 'recorded');
  const refused = ['pr', 'comment', '999', '--body', 'lost'];
  const failing = store.answer(refused, { now: () => NOTE.A, gate: held.gate });
  await held.reached;
  const next = store.answer(READ, {});
  held.release();
  assert.deepEqual(await failing, { status: 1, stdout: '', stderr: 'GraphQL: Could not resolve to a PullRequest with the number of 999. (repository.pullRequest)\n' });
  assert.deepEqual(await next, read(), 'the later read sees no invented mutation');
  assert.deepEqual(heldAt(statePath).sent, [refused, READ]);
  assert.deepEqual(heldAt(statePath).writes, []);
});

test('two overlapping comments on one forge store both survive, in either forced order', async (t) => {
  for (const [first, second] of [['A', 'B'], ['B', 'A']]) {
    const { statePath } = seeded(t, STORE);
    const store = forgeStore(statePath);
    const log = [];
    const held = holding(first, log, 'answered');
    const firstAnswer = store.answer(comment(first), { now: () => NOTE[first], gate: held.gate });
    await held.reached;
    assert.deepEqual(heldAt(statePath).repository.pullRequests[0].comments, [], 'the first comment is entered and uncommitted');
    const secondAnswer = store.answer(comment(second), { now: () => NOTE[second], gate: async (point) => { log.push(`${second}:${point}`); } });
    log.push(`${second}:submitted`);
    held.release();
    assert.deepEqual([await firstAnswer, await secondAnswer], [success(url(1)), success(url(2))], 'responses follow the one serialized order');
    assert.deepEqual(heldAt(statePath).repository.pullRequests[0].comments, [noted(first), noted(second)], 'both effects survive exactly once');
    assert.deepEqual(log, [`${first}:recorded`, `${first}:answered`, `${second}:submitted`, `${first}:released`, `${second}:recorded`, `${second}:answered`], 'the second transaction enters only after the first ends');
    assert.deepEqual(await store.answer(READ, {}), read(noted(first), noted(second)), 'a later read sees the same serialized order');
    assert.deepEqual(heldAt(statePath).sent, [comment(first), comment(second), READ], 'every request survives in serialized order');
  }
});

test('two overlapping board moves on one forge store both survive, in either forced order', async (t) => {
  for (const [first, second] of [['item-1', 'item-2'], ['item-2', 'item-1']]) {
    const { statePath } = seeded(t, STORE);
    const store = forgeStore(statePath);
    const held = holding(first, [], 'answered');
    const firstAnswer = store.answer(move(first), { gate: held.gate });
    await held.reached;
    const secondAnswer = store.answer(move(second), {});
    held.release();
    assert.deepEqual([await firstAnswer, await secondAnswer], [moved(first), moved(second)]);
    assert.deepEqual(heldAt(statePath).writes, [first, second].map((item) => ({ operation: 'moveItem', args: [item, 'Done'] })), 'both board writes survive in serialized order');
    assert.deepEqual(await store.answer(BOARD_READ, {}), BOTH_DONE, 'a later board read sees both moves');
    assert.deepEqual(heldAt(statePath).sent, [move(first), move(second), BOARD_READ]);
  }
});

test('a read overlapping a held mutation answers the committed result', async (t) => {
  const { statePath } = seeded(t, STORE);
  const store = forgeStore(statePath);
  const log = [];
  const held = holding('M', log, 'answered');
  const mutation = store.answer(comment('A'), { now: () => NOTE.A, gate: held.gate });
  await held.reached;
  const overlap = store.answer(READ, { gate: async (point) => { log.push(`R:${point}`); } });
  log.push('R:submitted');
  held.release();
  assert.deepEqual(await mutation, success(url(1)));
  assert.deepEqual(await overlap, read(noted('A')), 'the read serializes after the mutation and sees it whole');
  assert.deepEqual(heldAt(statePath).sent, [comment('A'), READ]);
  assert.deepEqual(log, ['M:recorded', 'M:answered', 'R:submitted', 'M:released', 'R:recorded', 'R:answered']);
});

test('a held read keeps its seed answer and a later read sees the overlapping mutation', async (t) => {
  const { statePath } = seeded(t, STORE);
  const store = forgeStore(statePath);
  const log = [];
  const held = holding('R', log, 'answered');
  const overlapped = store.answer(READ, { gate: held.gate });
  await held.reached;
  const mutation = store.answer(comment('A'), { now: () => NOTE.A, gate: async (point) => { log.push(`M:${point}`); } });
  log.push('M:submitted');
  // One turn drains every microtask, so an unserialized mutation commits before the release and
  // its loss shows at the state assertion. The serialized path passes with or without it.
  await new Promise((resolve) => setImmediate(resolve));
  held.release();
  assert.deepEqual(await overlapped, read(), 'the read serializes first and sees the complete seed');
  assert.deepEqual(await mutation, success(url(1)));
  assert.deepEqual(await store.answer(READ, {}), read(noted('A')), 'a later read sees the complete committed result');
  assert.deepEqual(heldAt(statePath).sent, [READ, comment('A'), READ]);
  assert.deepEqual(log, ['R:recorded', 'R:answered', 'M:submitted', 'R:released', 'M:recorded', 'M:answered']);
});

test('an unexpected rejection releases its forge store and keeps its record', async (t) => {
  const { statePath } = seeded(t, STORE);
  const store = forgeStore(statePath);
  const rejected = store.answer(comment('A'), { now: () => { throw new Error('configured clock failure'); } });
  await assert.rejects(rejected, /configured clock failure/);
  const next = await store.answer(READ, {}).then((answer) => answer, (error) => ({ rejected: error.message }));
  assert.deepEqual(next, read(), 'the next request still answers after an unexpected rejection');
  assert.deepEqual(heldAt(statePath).sent, [comment('A'), READ]);
});

test('two forge stores keep their state and their queues separate', async (t) => {
  const first = seeded(t, STORE);
  const second = seeded(t, STORE);
  const [firstStore, secondStore] = [forgeStore(first.statePath), forgeStore(second.statePath)];
  const held = holding('A', [], 'answered');
  const firstAnswer = firstStore.answer(comment('A'), { now: () => NOTE.A, gate: held.gate });
  await held.reached;
  let settled;
  secondStore.answer(comment('B'), { now: () => NOTE.B }).then((answer) => { settled = answer; });
  // This path holds only synchronous file calls and promise turns, so one turn settles it. New
  // asynchronous work here would red this test, never green it.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(settled, success(url(1)), 'the second store answers while the first is held');
  held.release();
  await firstAnswer;
  assert.deepEqual(heldAt(first.statePath).repository.pullRequests[0].comments, [noted('A')]);
  assert.deepEqual(heldAt(second.statePath).repository.pullRequests[0].comments, [noted('B')]);
  assert.deepEqual(heldAt(first.statePath).sent, [comment('A')]);
  assert.deepEqual(heldAt(second.statePath).sent, [comment('B')]);
});

const request = (cwd, role = 'engineer', input = 'Work on card #31.\n') => ({ executable: '/fixture/claude', args: ['--append-system-prompt-file', `/fixture/.claude/agents/${role}.md`], input, cwd, env: {}, pid: 7001 });
const CREATE = ['pr', 'create', '--title', 'Card #31', '--body', "The stand-in's pull request for card #31.", '--head', 'request-topic'];

function actionWorld(t, repository) {
  const directory = temporaryDirectory('rigger-action-', { context: t });
  const world = originFixture(directory);
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify({ ...withFacts(FORGE_MANIFEST.originWorld, world.facts), ...(repository ? { repository: repository(world.facts) } : {}) }));
  return { ...world, statePath, store: forgeStore(statePath), head: () => gitIn(world.repository, 'rev-parse', 'HEAD').trim() };
}
const originHead = ({ facts }) => gitIn(facts.$ORIGIN, 'rev-parse', 'refs/heads/request-topic').trim();

test('a controlled push moves the head and keeps its one open pull request', async (t) => {
  const world = actionWorld(t, (facts) => ({ pullRequests: [{ number: 301, head: 'request-topic', sha: facts.$HEAD }] }));
  await runStandInActions({ push: true }, standInRecord(request(world.repository)), { store: world.store });
  assert.equal(gitIn(world.repository, 'rev-parse', 'HEAD~1').trim(), world.facts.$HEAD, 'the head is one later commit');
  assert.equal(originHead(world), world.head(), 'origin holds the later head');
  assert.deepEqual(heldAt(world.statePath).sent, [], 'push asks the forge for nothing');
  const view = ['pr', 'view', '301', '--json', 'number,state,headRefOid'];
  assert.deepEqual(await world.store.answer(view, {}), { status: 0, stdout: `{"headRefOid":"${world.head()}","number":301,"state":"OPEN"}\n`, stderr: '' }, 'the one pull request is open at the later head');
  assert.equal(heldAt(world.statePath).repository.pullRequests.length, 1, 'push opens no second pull request');
});

test('a controlled pr or push outside a worktree fabricates nothing', async (t) => {
  for (const act of [{ pr: true }, { push: true }]) {
    const world = actionWorld(t);
    const refs = gitIn(world.facts.$ORIGIN, 'for-each-ref');
    const plain = temporaryDirectory('rigger-action-plain-', { context: t });
    await runStandInActions(act, standInRecord(request(plain)), { store: world.store });
    assert.equal(gitIn(world.facts.$ORIGIN, 'for-each-ref'), refs, 'origin holds no new ref or head');
    assert.equal(world.head(), world.facts.$HEAD, 'the worktree gained no commit');
    assert.deepEqual(heldAt(world.statePath).sent, [], 'no pull request was asked for');
    assert.equal(heldAt(world.statePath).repository, undefined, 'no pull request was fabricated');
  }
});

test('a controlled pr commits, pushes and opens one pull request', async (t) => {
  const world = actionWorld(t);
  await runStandInActions({ pr: true }, standInRecord(request(world.repository)), { store: world.store });
  const head = world.head();
  assert.equal(gitIn(world.repository, 'rev-parse', 'HEAD~1').trim(), world.facts.$HEAD, 'pr made one new commit');
  assert.equal(gitIn(world.repository, 'log', '-1', '--format=%s').trim(), "The stand-in's work for card #31");
  assert.equal(originHead(world), head, 'origin holds that head');
  const pulls = heldAt(world.statePath).repository?.pullRequests ?? [];
  assert.deepEqual(pulls.map(({ number, head: branch, sha, base, title, body }) => ({ number, branch, sha, base, title, body })),
    [{ number: 1, branch: 'request-topic', sha: head, base: 'main', title: 'Card #31', body: "The stand-in's pull request for card #31." }], 'exactly one pull request with its literal identity');
  assert.deepEqual(heldAt(world.statePath).sent, [CREATE]);
});

const pullFor = (head) => ({ pullRequests: [{ number: 301, head: 'request-topic', sha: head, comments: [] }] });

test('controlled findings append one parsed marker comment', async (t) => {
  const world = actionWorld(t, (facts) => pullFor(facts.$HEAD));
  const run = standInRecord(request(world.repository, 'reviewer', judgeInput(world.facts.$HEAD)));
  await runStandInActions({ findings: true }, run, { store: world.store, now: () => '2000-05-06T07:08:09Z' });
  const comments = heldAt(world.statePath).repository.pullRequests[0].comments;
  assert.equal(comments.length, 1, 'exactly one comment is appended');
  assert.deepEqual(parseMarker(comments[0].body, 2), parsedFindings(world.facts.$HEAD), 'the comment parses to the supplied fields, sound, every item met');
  assert.ok(comments[0].body.startsWith('Sound, by reviewer\n```rigger-marker\n'), 'the heading names the role');
  assert.ok(comments[0].body.endsWith("\n```\n\nThe stand-in's findings."), 'the suffix follows the block');
  assert.equal(comments[0].createdAt, '2000-05-06T07:08:09Z', 'the comment uses supplied time');
});

test('controlled findings with no marker block fail and append nothing', async (t) => {
  const world = actionWorld(t, (facts) => pullFor(facts.$HEAD));
  const run = standInRecord(request(world.repository, 'reviewer', 'Judge card #31 with no block.\n'));
  const outcome = await runStandInActions({ findings: true }, run, { store: world.store }).then(() => 'resolved', (error) => error.message);
  assert.equal(outcome, 'the stand-in for card #31 in reviewer was handed no marker block to fill in');
  assert.deepEqual(heldAt(world.statePath).repository.pullRequests[0].comments, [], 'no comment was appended');
  assert.deepEqual(heldAt(world.statePath).sent, [], 'the forge was asked nothing');
});

test('a controlled pr fails when the forge refuses it', async (t) => {
  const world = actionWorld(t);
  const run = standInRecord(request(world.repository));
  await runStandInActions({ pr: true }, run, { store: world.store });
  const outcome = await runStandInActions({ pr: true }, run, { store: world.store }).then(() => 'resolved', (error) => error.message);
  assert.match(outcome, /a pull request for branch "request-topic" into branch "main" already exists/, 'the refusal ends the run as a failing gh does');
  assert.equal(heldAt(world.statePath).repository.pullRequests.length, 1, 'no second pull request exists');
});

const turn = () => new Promise((resolve) => setImmediate(resolve));
const noticed = (run) => {
  const state = { ended: false };
  run.completed.then(() => { state.ended = true; });
  return state;
};

test('a logical agent records its run and replies with print and exit', async () => {
  const agent = logicalAgent({ 31: { engineer: { print: 'Literal agent output.\n', exit: 7 } } });
  const run = agent.start({ ...request('/fixture/consumer'), input: 'Rigger sends CaRd #31.\n', env: { RIGGER_STAND_IN_VALUE: 'literal', UNRELATED: 'not recorded' } });
  await run.completed;
  assert.deepEqual(agent.runs(), [{ name: 'claude', args: ['--append-system-prompt-file', '/fixture/.claude/agents/engineer.md'], cwd: '/fixture/consumer', card: 31, role: 'engineer', input: 'Rigger sends CaRd #31.\n', env: { RIGGER_STAND_IN_VALUE: 'literal' }, pid: 7001 }]);
  assert.deepEqual(run.output(), ['Literal agent output.\n']);
  assert.deepEqual(run.exits(), [7]);
});

test('a logical hold stays pending until released after readiness', async () => {
  const agent = logicalAgent({ 31: { engineer: { hold: true, print: 'After release.\n', exit: 7 } } });
  const run = agent.start(request('/fixture'));
  const seen = noticed(run);
  await turn();
  assert.equal(seen.ended, false, 'a held run does not complete');
  const { release } = await run.held;
  assert.equal(agent.runs().length, 1, 'readiness follows the record');
  await turn();
  assert.equal(seen.ended, false, 'a ready run stays pending until released');
  assert.deepEqual(run.output(), [], 'nothing prints before release');
  release();
  await run.completed;
  assert.deepEqual(run.output(), ['After release.\n'], 'an immediate release after readiness settles the run');
  assert.deepEqual(run.exits(), [7]);
});

test('a logical await before its write stays pending until the write', async () => {
  const agent = logicalAgent({ 31: { reviewer: { await: 'engineer', print: 'Awaited.\n' }, engineer: { write: true } } });
  const awaiting = agent.start(request('/fixture', 'reviewer'));
  const seen = noticed(awaiting);
  await turn();
  assert.deepEqual(awaiting.output(), ['Awaited.\n'], 'the run has reached its await, which follows its print');
  assert.equal(seen.ended, false, 'the await waits for a write that has not happened');
  await agent.start(request('/fixture')).completed;
  await awaiting.completed;
  assert.deepEqual(awaiting.output(), ['Awaited.\n'], 'print precedes the await');
  assert.deepEqual(awaiting.exits(), [0]);
});

test('a logical write before its await settles the await', async () => {
  const agent = logicalAgent({ 31: { engineer: { write: true }, reviewer: { await: 'engineer' } } });
  await agent.start(request('/fixture')).completed;
  const awaiting = agent.start(request('/fixture', 'reviewer'));
  const seen = noticed(awaiting);
  await turn();
  assert.equal(seen.ended, true, 'an earlier write settles a later await');
  assert.equal(agent.wrote(31, 'engineer'), true);
  assert.equal(agent.wrote(31, 'reviewer'), false);
});

test('two logical agents keep their runs, holds and writes separate', async () => {
  const plan = { 31: { engineer: { hold: true, write: true, print: 'Mine.\n' } } };
  const [first, second] = [logicalAgent(plan), logicalAgent(plan)];
  const [one, two] = [first.start(request('/fixture/one')), second.start(request('/fixture/two'))];
  const [held, twoHeld] = [await one.held, await two.held];
  held.release();
  await one.completed;
  const seen = noticed(two);
  await turn();
  assert.equal(seen.ended, false, 'releasing one instance leaves the other held');
  assert.equal(first.wrote(31, 'engineer'), true);
  assert.equal(second.wrote(31, 'engineer'), false, 'a write stays in its instance');
  assert.deepEqual(first.runs().map(({ cwd }) => cwd), ['/fixture/one']);
  assert.deepEqual(second.runs().map(({ cwd }) => cwd), ['/fixture/two']);
  twoHeld.release();
  await two.completed;
  assert.equal(second.wrote(31, 'engineer'), true);
});

test('a logical run keeps hold, print, write, await and action order', async (t) => {
  const world = actionWorld(t);
  const agent = logicalAgent({ 31: { engineer: { hold: true, print: 'Printed.\n', write: true, await: 'reviewer', pr: true }, reviewer: { write: true } } }, { store: world.store });
  const run = agent.start(request(world.repository));
  const { release } = await run.held;
  assert.deepEqual(run.output(), [], 'hold precedes print');
  assert.equal(agent.wrote(31, 'engineer'), false, 'hold precedes write');
  release();
  await turn();
  assert.deepEqual(run.output(), ['Printed.\n'], 'print follows release');
  assert.equal(agent.wrote(31, 'engineer'), true, 'write follows print');
  assert.equal(world.head(), world.facts.$HEAD, 'the await precedes the action');
  await agent.start(request(world.repository, 'reviewer')).completed;
  await run.completed;
  assert.equal(gitIn(world.repository, 'rev-parse', 'HEAD~1').trim(), world.facts.$HEAD, 'the action follows the await');
  assert.deepEqual(heldAt(world.statePath).sent, [CREATE]);
  assert.deepEqual(run.exits(), [0]);
});

test('a logical run performs none of the OS acts', async (t) => {
  const cwd = temporaryDirectory('rigger-logical-os-', { context: t });
  const agent = logicalAgent({ 31: { engineer: { orphanIn: 'orphaned', leave: true, leaveIn: '.', leaveInGroup: '.' } } });
  const run = agent.start(request(cwd));
  await run.completed;
  assert.deepEqual(run.exits(), [0]);
  assert.deepEqual(readdirSync(cwd), [], 'no OS act touched the directory, and no signal, group, pipe or exec claim follows');
});

const PROBE = { args: ['-C', '/fixture/consumer', 'debug', 'prompt-input'], cwd: '/fixture/consumer', home: '/fixture/home', pid: 7002 };

test('a logical codex classifies a probe by debug and prompt-input together', async () => {
  const cases = [[['debug', 'prompt-input'], true], [['prompt-input', '-x', 'debug'], true], [['debug'], false], [['prompt-input'], false], [['exec', '-'], false]];
  for (const [args, probe] of cases) {
    const codex = logicalCodex({ answer: 'Probe.\n' });
    await codex.start({ ...PROBE, args, input: 'Session input.\n' }).completed;
    assert.equal(codex.probes().length, probe ? 1 : 0, `${args.join(' ')} probe`);
    assert.equal(codex.sessions().length, probe ? 0 : 1, `${args.join(' ')} session`);
  }
});

test('a logical codex answers its configured probe text and status', async () => {
  const codex = logicalCodex({ answer: 'Literal probe.\n', exit: 3 });
  const run = codex.start(PROBE);
  assert.equal(await run.completed, 3);
  assert.deepEqual(run.output(), ['Literal probe.\n']);
  assert.deepEqual(codex.probes(), [{ name: 'codex', probe: true, args: PROBE.args, cwd: '/fixture/consumer', home: '/fixture/home', pid: 7002 }]);
  const text = '<skills_instructions>\n## Skills\nA skill is a set of local instructions to follow that is stored in a `SKILL.md` file.\n### Skill roots\n- `r0` = `/skills`\n### Available skills\n- one: A skill the test names. (file: r0/one/SKILL.md)\n</skills_instructions>';
  const listed = logicalCodex({ skills: ['/skills/one/SKILL.md'] }).start(PROBE);
  assert.equal(await listed.completed, 0);
  assert.deepEqual(listed.output(), [`${JSON.stringify([{ type: 'message', role: 'developer', content: [{ type: 'input_text', text }] }], null, 2)}\n`]);
});

test('a logical codex session records its input and home and returns zero', async () => {
  const codex = logicalCodex();
  const args = ['exec', '-'];
  const run = codex.start({ args, cwd: '/fixture/consumer', home: '/fixture/home', pid: 7003, input: 'Session input.\n' });
  assert.equal(await run.completed, 0);
  assert.deepEqual(codex.sessions(), [{ name: 'codex', args, cwd: '/fixture/consumer', input: 'Session input.\n', home: '/fixture/home', pid: 7003 }]);
  assert.deepEqual(run.output(), []);
});

/** The two clock methods a hang uses, with a manual `advance` the test drives. */
function manualClock() {
  let at = 0;
  let next = 0;
  const pending = new Map();
  return {
    schedule: (done, delay) => { next += 1; pending.set(next, { done, due: at + delay }); return next; },
    cancel: (handle) => { pending.delete(handle); },
    advance: (by) => {
      at += by;
      for (const [handle, { done, due }] of [...pending]) if (due <= at) { pending.delete(handle); done(); }
    },
    pending: () => pending.size,
  };
}

test('a logical hanging probe stays pending across injected time until its cleanup', async () => {
  const clock = manualClock();
  const codex = logicalCodex({ hang: true }, { clock });
  const run = codex.start(PROBE);
  assert.equal(codex.probes().length, 1, 'the probe is recorded, so it is ready');
  const seen = noticed(run);
  let boundary = false;
  clock.schedule(() => { boundary = true; }, 1000);
  await turn();
  assert.deepEqual([seen.ended, run.output(), clock.pending(), boundary], [false, [], 2, false], 'pending with no output before the boundary');
  clock.advance(999);
  await turn();
  assert.deepEqual([seen.ended, boundary], [false, false], 'the boundary has not passed');
  clock.advance(1);
  await turn();
  assert.deepEqual([seen.ended, run.output(), clock.pending(), boundary], [false, [], 1, true], 'still pending with no output after the observed boundary');
  assert.equal(run.cleanups().length, 1, 'the hang registers one cleanup');
  run.cleanups()[0]();
  await turn();
  assert.deepEqual([seen.ended, clock.pending()], [true, 0], 'cleanup cancels the hang and ends it, with no real deadline claimed');
});
