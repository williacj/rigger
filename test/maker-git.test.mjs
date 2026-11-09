// ABOUTME: Tests the maker-only git-directory handoff through L1 and the provider adapters,
// using real git fixtures and controlled process-table answers without an agent session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { roleDispatch } from '../src/execution/role.mjs';
import { realHost } from '../src/substrate/host.mjs';
import { workspaces } from '../src/substrate/worktrees.mjs';
import { existsSync, rmSync } from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { consumerConfig, card } from './verb-consumer.mjs';
import { handleOn } from './loop-world.mjs';
import { mkdirSync, symlinkSync, lstatSync, readlinkSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { admission } from '../src/scheduling/admission.mjs';
import { heldCard } from './stop-failure.mjs';
import { postedNote } from './escalation-world.mjs';
import { markerComment } from './fake-repository.mjs';
import { gitIn, repositoryAt, worktreeAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { stepDispatch } from '../src/execution/step.mjs';
import { dirname } from 'node:path';
import { readdirSync } from 'node:fs';
import { manualClock } from './clock-report-world.mjs';

/** Real git exits naturally; the documented ps contract answers that its group is then absent. */
function processTable(t) {
  const replacement = {
    clock: { ...manualClock(), pause: async () => {} },
    signal() { throw Object.assign(new Error('no process'), { code: 'ESRCH' }); },
    execFile(_command, _args, _options, done) {
      queueMicrotask(() => done(Object.assign(new Error('no process'), { code: 1 }), '', ''));
      return { stdout: { destroy() {} }, stderr: { destroy() {} } };
    },
  };
  const saved = new Map(Object.keys(replacement).map((key) => [key, Object.getOwnPropertyDescriptor(realHost, key)]));
  for (const key of saved.keys()) Object.defineProperty(realHost, key, { configurable: true, value: replacement[key] });
  t.after(() => { for (const [key, descriptor] of saved) Object.defineProperty(realHost, key, descriptor); });
}

/** A linked maker worktree and an in-memory sink with L1's public dispatch inputs. */
function layout(t) {
  const clock = realHost.clock;
  const root = realpathSync.native(temporaryDirectory('rigger-maker-git-', { context: t }));
  const repository = repositoryAt(join(root, 'repository'), { 'agent.md': '# Fixture agent\n' });
  const directory = worktreeAt(repository, join(root, 'rigger-42'), 'rigger-42');
  const inheritedHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = join(root, 'owner-codex');
  t.after(() => {
    if (inheritedHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = inheritedHome;
  });
  const events = [];
  const sink = { emitter: (context) => ({ emit: (event, fields) => events.push({ ...context, event, ...fields }) }) };
  processTable(t);
  t.after(() => { assert.strictEqual(realHost.clock, clock, 'the fixture restores the original host clock after each test'); });
  return {
    root, events,
    request: { answer: { role: 'engineer', provider: 'capture', tier: 'standard', agent: 'agent.md', instruction: 'Make the change.\n', evidence: '', timeout: 1000 },
      cwd: directory, directory, scratch: join(root, 'scratch', 'rigger-42'), repository, reach: [], env: {}, sink, id: 'd-maker', card: 42 },
  };
}

let serial = 900000000;

/** A naturally exiting process under Node's documented ChildProcess pipe/events contract. */
function completedChild(output = '') {
  const child = Object.assign(new EventEmitter(), { pid: ++serial, exitCode: null, signalCode: null,
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  queueMicrotask(() => {
    child.stdout.end(output);
    child.stderr.end();
    child.exitCode = 0;
    child.emit('exit', 0, null);
  });
  return child;
}

/** The one provisioning step a fixture's kind may list. */
const PROVISIONING = { prepare: { run: 'true', required: true, timeout: 500 } };

/** A completed process that keeps all L0 handed it: command, arguments, spawn options and standard input. */
function recordedChild(sessions, command, args, options) {
  const child = completedChild();
  const { env, cwd, detached, stdio } = options;
  const session = { command, args, env, cwd, detached, stdio, input: '' };
  child.stdin.on('data', (chunk) => { session.input += chunk; });
  sessions.push(session);
  return child;
}

/** The recorded codex-cli 0.159.2 probe answer over Node's documented ChildProcess pipe/events. */
function codexProbe(t) {
  const saved = Object.getOwnPropertyDescriptor(realHost, 'spawn');
  const spawn = realHost.spawn;
  const answer = readFileSync(new URL('./fixtures/codex-prompt-input-0.159.2.json', import.meta.url));
  const calls = [];
  Object.defineProperty(realHost, 'spawn', { configurable: true, value(command, args, options) {
    if (command !== 'codex') return spawn(command, args, options);
    calls.push(args);
    assert.deepEqual(args.slice(-2), ['debug', 'prompt-input'], 'the controlled codex must never start an agent session');
    return completedChild(answer);
  } });
  t.after(() => Object.defineProperty(realHost, 'spawn', saved));
  return calls;
}

// Removing the maker handoff loses the reader; eagerly resolving it makes an unnecessary git read.
test('L1 hands a maker a lazy git-directory reader without reading it for an adapter that does not use it', async (t) => {
  const { request, events } = layout(t);
  let received;
  const capture = { invocation: async (given) => {
    received = given;
    return { command: 'capture', args: [], input: Buffer.from(given.prompt), unset: [], env: {} };
  } };

  await roleDispatch({ ...request, maker: true, adapters: { capture } });

  assert.equal(typeof received.gitDirectories, 'function', 'the maker adapter received no lazy git-directory reader');
  assert.deepEqual(events.filter((event) => event.operation === 'rev-parse'), [], 'an unused git-directory reader ran');
});

// Granting the common git directory would expose hooks and config; omitting a leaf prevents delivery.
test('the workspace reader answers the linked git directory and common objects, refs and logs, recording the git read', async (t) => {
  const { request, events } = layout(t);
  const adapter = workspaces({ repository: request.repository, emitter: request.sink.emitter({ layer: 'L0', card: 42, dispatch: 'd-maker' }) });
  let directories;

  await assert.doesNotReject(async () => { directories = await adapter.gitDirectories(request.cwd); }, 'the maker git-directory read must resolve');

  const common = join(request.repository, '.git');
  assert.deepEqual(directories, [join(common, 'worktrees', 'rigger-42'), join(common, 'objects'), join(common, 'refs'), join(common, 'logs')]);
  assert.deepEqual(events.filter((event) => event.event === 'call.end').map(({ layer, card, dispatch, operation, outcome }) => ({ layer, card, dispatch, operation, outcome })),
    [{ layer: 'L0', card: 42, dispatch: 'd-maker', operation: 'rev-parse', outcome: 'ok' }]);
});

// A freshly initialized common directory may have no logs yet; reading the roots must not create it.
test('a missing common logs directory is named under its real parent and is left absent', async (t) => {
  const { request } = layout(t);
  const logs = join(request.repository, '.git', 'logs');
  rmSync(logs, { recursive: true });
  const adapter = workspaces({ repository: request.repository, emitter: request.sink.emitter({ layer: 'L0' }) });
  let directories;

  await assert.doesNotReject(async () => { directories = await adapter.gitDirectories(request.cwd); }, 'an absent common logs directory must remain a writable root');

  assert.equal(directories[3], logs);
  assert.equal(existsSync(logs), false, 'reading git directories created the common logs directory');
});

// Naming a plain clone's own git directory would grant the entire common directory.
test('a main working tree is refused instead of granting the common git directory', async (t) => {
  const { request } = layout(t);
  const adapter = workspaces({ repository: request.repository, emitter: request.sink.emitter({ layer: 'L0' }) });

  await assert.rejects(async () => adapter.gitDirectories(request.repository), /linked worktree/);
});

// Ignoring L1's thunk leaves git metadata read-only; granting its parent would expose hooks/config.
test('a Codex maker through L1 adds exactly the four git roots beside its temporary directory', async (t) => {
  const { request, events } = layout(t);
  codexProbe(t);

  const invoked = await roleDispatch({ ...request, answer: { ...request.answer, provider: 'codex' }, maker: true });

  const common = join(request.repository, '.git');
  const added = invoked.args.flatMap((arg, index) => invoked.args[index - 1] === '--add-dir' ? [arg] : []);
  assert.deepEqual(added, [join(common, 'worktrees', 'rigger-42'), join(common, 'objects'), join(common, 'refs'), join(common, 'logs'), join(request.scratch, 'engineer', 'tmp')]);
  assert.equal(events.filter((event) => event.event === 'call.end' && event.operation === 'rev-parse').length, 1, 'the git-directory read must happen once');
});

// An asynchronous git refusal must retain the preparation kind, not become an unclassified failure.
test('an unreadable maker git directory records the failed git call and refuses the dispatch before the Codex probe', async (t) => {
  const { request, events } = layout(t);
  const probes = codexProbe(t);
  rmSync(join(request.cwd, '.git'));

  await assert.rejects(roleDispatch({ ...request, answer: { ...request.answer, provider: 'codex' }, maker: true }), (failure) => {
    assert.equal(failure.code, NOT_STARTED);
    assert.equal(failure.startCause?.kind, 'codex-git-directories-unreadable');
    return true;
  });

  assert.deepEqual(probes, [], 'a git-directory failure started the Codex probe');
  assert.ok(events.some((event) => event.event === 'call.end' && event.operation === 'rev-parse' && event.outcome === 'failed'));
  assert.ok(events.some((event) => event.event === 'workspace.made' && event.role === 'engineer'), 'the scratch directory was made before preparation failed');
});

/** The ordinary in-memory forge contracts wired to L3/L2/L1 and a controlled, successful maker. */
async function scheduledMaker(t, { missingGit = false, routed = false, continuing = false, pinned = false, provider = 'codex', step = false, routedHead = false } = {}) {
  const here = layout(t);
  const { request, root } = here;
  codexProbe(t);
  if (missingGit) rmSync(join(request.cwd, '.git'));
  const config = consumerConfig(1);
  config.board = { ...config.board, priority: undefined };
  config.kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['owner'], provisioning: step ? ['prepare'] : [] } };
  config.roles = { ...config.roles, engineer: { agent: 'agent.md', provider, tier: 'standard', timeout: 1000 } };
  if (routed) {
    config.escalate = { ambiguous: 'pm' };
    config.roles.pm = { agent: 'agent.md', provider: 'codex', tier: 'standard', timeout: 1000 };
  }
  const head = gitIn(request.repository, 'rev-parse', 'HEAD').trim();
  const issue = card(42, continuing ? config.board.columns.owner : config.board.columns.ready);
  const board = createFakeBoard({ columns: Object.values(config.board.columns), items: [issue] });
  const repository = createFakeRepository({ repo: config.repo, issues: [{ number: 42, title: issue.title, body: issue.body, labels: issue.labels }],
    pullRequests: continuing ? [{ number: 77, head: 'rigger-42', sha: head, mergeBase: head, diff: 'diff --git a/delivery b/delivery\n',
      comments: [markerComment({ card: 42, pull: 77, head, body: issue.body, role: 'owner', verdict: 'needs revision', items: ['unmet'], toSound: 'Deliver the fixture.' })] }] : [],
  });
  const l2 = columnChanges({ config, sink: request.sink, items: board.operations, reads: repository.operations, repositoryWrites: repository, roleReads: () => repository.operations });
  l2.notice = async function* () { return {}; };
  const decide = (given, outcomes, options = {}) => nextAction(given, config.kinds, undefined, { roles: config.roles, provisioning: PROVISIONING, sink: request.sink, outcomes, ...options });
  const invocations = [];
  const sessions = [];
  const host = { ...realHost,
    spawn(command, args, options) {
      if (command === '/bin/sh') return recordedChild(sessions, command, args, options);
      assert.equal(command, provider);
      if (provider === 'codex') assert.equal(args[0], 'exec');
      invocations.push(args);
      if (continuing) repository.update(77, { comments: [] });
      if (routed && options.cwd === request.cwd) {
        const start = here.events.findLast((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role === 'engineer');
        repository.postIssueComment(42, postedNote(start.dispatch).body.replace('item: 2', 'item: 1'));
      }
      return recordedChild(sessions, command, args, options);
    },
    spawnSync: () => ({ status: 0, stdout: 'Thu Nov  5 12:00:00 2026\n', stderr: '' }),
  };
  const workspaceHeads = [];
  const built = loop({ config, board: handleOn(board, { columns: config.board.columns }), decide,
    facts: factsCall({ config, reads: repository.operations, decide }), l2, sink: request.sink,
    kill: async () => {}, workspace: async (_number, continuedHead) => {
      workspaceHeads.push(continuedHead);
      return { path: request.cwd, branch: 'rigger-42', scratch: request.scratch, repository: request.repository };
    }, workspaceTip: async () => head,
    judgeDirectory: async () => { throw new Error('only an owner judge is configured'); }, removeDirectories: async () => {},
    escalationDirectory: async () => {
      const path = join(root, 'escalations', 'rigger-42', 'pm');
      const main = join(path, 'main');
      mkdirSync(main, { recursive: true });
      writeFileSync(join(main, 'agent.md'), '# Fixture routed role\n');
      if (routedHead) mkdirSync(join(path, 'head'));
      return { path, main, ...(routedHead ? { head: join(path, 'head') } : {}), scratch: request.scratch, repository: request.repository };
    },
    state: join(root, 'state'), environment: pinned ? { HOME: root } : process.env, run: 'r-maker-git', host });
  const [outcome] = await Promise.allSettled([built.pull()]);
  return { ...here, invocations, sessions, outcome, workspaceHeads, head };
}

// Losing the maker mark between L3 and L1 leaves a scheduled maker with only its temporary root.
test('a maker selected by L3 receives the four git roots through L1', async (t) => {
  const { request, invocations, outcome } = await scheduledMaker(t);
  assert.equal(outcome.status, 'fulfilled', outcome.reason?.stack);
  assert.equal(invocations.length, 1, 'one ordinary maker dispatch reached the controlled agent');
  const common = join(request.repository, '.git');
  assert.ok(invocations[0].includes(join(common, 'worktrees', 'rigger-42')), 'L3 did not give its maker the git-directory roots');
});

// This closes the preparation failure through the existing two-attempt environment hold.
test('two unreadable maker git-directory reads close admission without starting a maker', async (t) => {
  const { request, root, invocations, outcome, events } = await scheduledMaker(t, { missingGit: true });
  assert.equal(outcome.status, 'rejected');
  assert.equal(heldCard(42)(outcome.reason), true);
  assert.equal(admission({ directory: join(root, 'state'), sink: request.sink }).read().state, 'closed');
  assert.deepEqual(invocations, []);
  assert.equal(events.filter((event) => event.event === 'call.end' && event.operation === 'rev-parse' && event.outcome === 'failed').length, 2);
});

// A lexical worktree path must not become a grant to the symbolic link or to its parent.
test('a maker reached through a symbolic link receives absolute real git roots', async (t) => {
  const { request, root } = layout(t);
  codexProbe(t);
  const alias = join(root, 'linked worktree');
  symlinkSync(request.cwd, alias);

  const invoked = await roleDispatch({ ...request, cwd: alias, directory: alias, answer: { ...request.answer, provider: 'codex' }, maker: true });

  const added = invoked.args.flatMap((arg, index) => invoked.args[index - 1] === '--add-dir' ? [arg] : []);
  const common = join(request.repository, '.git');
  assert.deepEqual(added.slice(0, 4), [join(common, 'worktrees', 'rigger-42'), join(common, 'objects'), join(common, 'refs'), join(common, 'logs')]);
  assert.ok(added.every((path) => isAbsolute(path) && realpathSync.native(path) === path));
});

// An unresolved link is an existing path that failed resolution, not an absent logs directory.
test('a dangling common logs link is refused and left untouched', async (t) => {
  const { request, root } = layout(t);
  const logs = join(request.repository, '.git', 'logs');
  rmSync(logs, { recursive: true });
  const target = join(root, 'missing-logs');
  symlinkSync(target, logs);
  const adapter = workspaces({ repository: request.repository, emitter: request.sink.emitter({ layer: 'L0' }) });

  await assert.rejects(async () => adapter.gitDirectories(request.cwd), { code: 'ENOENT' });

  assert.equal(lstatSync(logs).isSymbolicLink(), true);
  assert.equal(readlinkSync(logs), target);
});

// Invariant guard M2: a judge retains only its reached head and temporary root.
test('judges and provisioning steps receive no maker git-directory grants', async (t) => {
  const { request, root, events } = layout(t);
  codexProbe(t);
  const head = join(root, 'head');
  mkdirSync(head);

  const invoked = await roleDispatch({ ...request, answer: { ...request.answer, role: 'reviewer', provider: 'codex' }, reach: [head] });

  const added = invoked.args.flatMap((arg, index) => invoked.args[index - 1] === '--add-dir' ? [arg] : []);
  assert.deepEqual(added, [head, join(request.scratch, 'reviewer', 'tmp')]);
  assert.deepEqual(events.filter((event) => event.operation === 'rev-parse'), []);
  assert.deepEqual(stepDispatch({ run: 'git status', timeout: 1000 }, request.cwd, {}), {
    command: '/bin/sh', args: ['-c', 'git status'], cwd: request.cwd, workspace: request.cwd, env: {}, timeout: 1000,
  });
});

// Invariant guard M4: the Claude adapter ignores the thunk and keeps every invocation byte.
test('a Claude maker invocation is byte-identical to an unmarked dispatch and never reads git directories', async (t) => {
  const { request, root, events } = layout(t);
  const given = { ...request, answer: { ...request.answer, provider: 'claude' }, env: { HOME: root } };

  const unmarked = await roleDispatch(given);
  const maker = await roleDispatch({ ...given, maker: true });

  assert.deepEqual(maker, unmarked);
  assert.deepEqual(events.filter((event) => event.operation === 'rev-parse'), []);
});

// Invariant guard M3: the routed-role site must not inherit the maker site's metadata grant.
test('a role routed by L3 receives only its temporary root and no git-directory read', async (t) => {
  const { request, invocations, outcome, events } = await scheduledMaker(t, { routed: true });
  assert.equal(outcome.status, 'fulfilled', outcome.reason?.stack);
  assert.equal(invocations.length, 2, 'the maker and its routed role both reached the controlled agent');
  const added = invocations[1].flatMap((arg, index) => invocations[1][index - 1] === '--add-dir' ? [arg] : []);
  assert.deepEqual(added, [join(request.scratch, 'pm', 'tmp')]);
  const routed = events.find((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role === 'pm');
  assert.ok(routed, 'L3 recorded the routed dispatch');
  assert.equal(events.filter((event) => event.event === 'call.end' && event.operation === 'rev-parse' && event.dispatch === routed.dispatch).length, 0, 'the routed role read git directories');
});

// Invariant guard M11: each declaration has exactly one active top-level mode of its own.
test('the template and repository Codex declarations each select their own sandbox mode exactly once', () => {
  for (const [path, expected] of [['../templates/codex/config.toml', 'workspace-write'], ['../.codex/config.toml', 'danger-full-access']]) {
    const lines = readFileSync(new URL(path, import.meta.url), 'utf8').split('\n');
    const table = lines.findIndex((line) => /^\s*\[/.test(line));
    const root = lines.slice(0, table === -1 ? undefined : table);
    const values = root.filter((line) => /^\s*sandbox_mode\s*=/.test(line)).map((line) => JSON.parse(line.slice(line.indexOf('=') + 1).split('#')[0].trim()));
    assert.deepEqual(values, [expected], `${path} must declare one ${expected} sandbox`);
  }
});

// Continuing delivery uses the same maker mark after L2 selects the existing line from its verdict.
test('a continuing Codex maker selected by L3 receives the same four git roots', async (t) => {
  const { request, invocations, outcome, workspaceHeads, head } = await scheduledMaker(t, { continuing: true });
  assert.equal(outcome.status, 'fulfilled', outcome.reason?.stack);
  assert.deepEqual(workspaceHeads, [head], 'L2 selected the existing forge head for the continuing workspace');
  assert.equal(invocations.length, 1);
  const common = join(request.repository, '.git');
  const added = invocations[0].flatMap((arg, index) => invocations[0][index - 1] === '--add-dir' ? [arg] : []);
  assert.deepEqual(added, [join(common, 'worktrees', 'rigger-42'), join(common, 'objects'), join(common, 'refs'), join(common, 'logs'), join(request.scratch, 'engineer', 'tmp')]);
});

/** Every directory above `path`, nearest first, as Claude Code's own `CLAUDE.md` search reaches them. */
function above(path) {
  const parents = [];
  for (let at = dirname(path); ; at = dirname(at)) {
    parents.push(at);
    if (at === dirname(at)) return parents;
  }
}

/** `args` with the `CLAUDE.md` exclusions above `root`, which depend only on where the fixture lies, checked and dropped. */
function stableArgs(args, root) {
  return args.map((arg, index) => {
    if (args[index - 1] !== '--settings') return arg;
    const settings = JSON.parse(arg);
    const outside = settings.claudeMdExcludes.filter((path) => !path.startsWith(`${root}/`));
    assert.deepEqual(outside, above(root).map((path) => join(path, 'CLAUDE.md')));
    return JSON.stringify({ ...settings, claudeMdExcludes: settings.claudeMdExcludes.filter((path) => path.startsWith(`${root}/`)) });
  });
}

/** What Codex reads from the home the adapter made: its file names, its declaration and its authentication link. */
function codexHome(home) {
  if (home === undefined) return {};
  return { home: { files: readdirSync(home).sort(), config: readFileSync(join(home, 'config.toml'), 'utf8'), auth: readlinkSync(join(home, 'auth.json')) } };
}

/**
 * What L1 handed for dispatch, whole, and the home Codex reads, with the host's path as `<root>` so
 * that it compares with a literal. The session folder's name encodes that path, so it is checked
 * exactly against the working directory and then named.
 */
function wholeInvocation(handed, root) {
  const plain = handed.cwd.replace(/[^A-Za-z0-9]/g, '-');
  if (handed.folder !== undefined && plain.length <= 200) assert.equal(handed.folder.name, plain);
  if (handed.folder !== undefined && plain.length > 200) assert.match(handed.folder.name, new RegExp(`^${plain.slice(0, 200)}-[0-9a-z]+$`));
  const folder = handed.folder === undefined ? {} : { folder: { ...handed.folder, name: '<cwd>' } };
  return JSON.parse(JSON.stringify({ ...handed, ...folder, ...codexHome(handed.env.CODEX_HOME), args: stableArgs(handed.args, root), input: handed.input.toString('utf8') }).split(root).join('<root>'));
}

/** A role's dispatch in each shape L3 gives one, with a prompt of two parts so neither can be lost. */
async function dispatched(t, shape, provider, { declared = false } = {}) {
  const { request, root } = layout(t);
  if (provider === 'codex') codexProbe(t);
  const place = { judge: join(root, 'judges', 'rigger-42', 'reviewer'), routed: join(root, 'escalations', 'rigger-42', 'pm') }[shape];
  const main = place === undefined ? request.cwd : join(place, 'main');
  mkdirSync(main, { recursive: true });
  writeFileSync(join(main, 'agent.md'), '# Fixture agent\n');
  mkdirSync(join(main, '.codex'));
  writeFileSync(join(main, '.codex', 'config.toml'), '# Fixture declaration\n');
  if (declared) {
    mkdirSync(join(main, '.claude'));
    writeFileSync(join(main, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(git push:*)'], deny: ['Bash(git push --force:*)'], ask: ['Bash(npm run:*)'], defaultMode: 'bypassPermissions' } }));
    writeFileSync(join(main, '.mcp.json'), '{"mcpServers":{}}\n');
  }
  if (shape === 'judge') mkdirSync(join(place, 'head'));
  const role = { judge: 'reviewer', routed: 'pm' }[shape] ?? 'engineer';
  const handed = await roleDispatch({ ...request, env: { HOME: root },
    answer: { ...request.answer, role, provider, instruction: 'Do the work.\n', evidence: 'Card #42: the evidence.\n' },
    cwd: main, directory: place ?? request.directory, reach: shape === 'judge' ? [join(place, 'head')] : [], maker: shape === 'maker' });
  return wholeInvocation(handed, root);
}

// The merge base's whole invocations, literal, so that no code under test can agree with itself. Read
// by running merge-base production over these fixtures; `proof:diff` shows them passing there too.
const FIXTURE_PROMPT = 'Do the work.\nCard #42: the evidence.\n';
const SKILLS_OFF = 'skills.config=[{path = "/private/tmp/claude-501/-Users-cjwilliams-GitHub-rigger/14e5e87e-e900-48c7-97f1-e0486606347c/scratchpad/c489-probe/home/skills/.system/imagegen/SKILL.md", enabled = false}, {path = "/private/tmp/claude-501/-Users-cjwilliams-GitHub-rigger/14e5e87e-e900-48c7-97f1-e0486606347c/scratchpad/c489-probe/home/skills/.system/openai-docs/SKILL.md", enabled = false}, {path = "/private/tmp/claude-501/-Users-cjwilliams-GitHub-rigger/14e5e87e-e900-48c7-97f1-e0486606347c/scratchpad/c489-probe/home/skills/.system/skill-creator/SKILL.md", enabled = false}, {path = "/private/tmp/claude-501/-Users-cjwilliams-GitHub-rigger/14e5e87e-e900-48c7-97f1-e0486606347c/scratchpad/c489-probe/home/skills/.system/skill-installer/SKILL.md", enabled = false}, {path = "/private/tmp/claude-501/-Users-cjwilliams-GitHub-rigger/14e5e87e-e900-48c7-97f1-e0486606347c/scratchpad/c489-probe/repo/.agents/skills/c489-agentsdir-skill/SKILL.md", enabled = false}, {path = "/private/tmp/claude-501/-Users-cjwilliams-GitHub-rigger/14e5e87e-e900-48c7-97f1-e0486606347c/scratchpad/c489-probe/repo/.codex/skills/c489-codexdir-skill/SKILL.md", enabled = false}]';

/** The merge base's `codex exec` argument list for a role in `cwd`, reaching `reached` and running under `role`. */
const codexArgs = (cwd, role, reached, instructions = '# Fixture agent\\n') => [
  'exec', '--json', '-C', cwd, ...reached.flatMap((each) => ['--add-dir', each]),
  '--add-dir', `<root>/scratch/rigger-42/${role}/tmp`,
  '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="medium"',
  '--disable', 'plugins', '--disable', 'apps', '--disable', 'browser_use', '--disable', 'browser_use_external',
  '--disable', 'browser_use_full_cdp_access', '--disable', 'computer_use', '--disable', 'in_app_browser',
  '-c', SKILLS_OFF, '-c', `developer_instructions="${instructions}"`,
];

/** The merge base's whole Codex dispatch. */
const codexDispatch = (cwd, workspace, role, reached = []) => ({
  provider: 'codex', command: 'codex', args: codexArgs(cwd, role, reached), input: FIXTURE_PROMPT, cwd, workspace,
  scratch: `<root>/scratch/rigger-42/${role}`, timeout: 1000,
  home: { files: ['auth.json', 'config.toml'], config: '# Fixture declaration\n', auth: '<root>/owner-codex/auth.json' },
  env: { HOME: '<root>', CODEX_HOME: `<root>/scratch/rigger-42/${role}/codex-home`, TMPDIR: `<root>/scratch/rigger-42/${role}/tmp`, TMPPREFIX: `<root>/scratch/rigger-42/${role}/tmp/zsh` },
});

/** The merge base's whole Claude Code dispatch, whose `--settings` text is given whole. */
const claudeDispatch = (cwd, workspace, role, settings, servers = []) => ({
  provider: 'claude', command: 'claude', input: FIXTURE_PROMPT, cwd, workspace, scratch: `<root>/scratch/rigger-42/${role}`, timeout: 1000,
  args: ['-p', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--model', 'sonnet', '--strict-mcp-config', ...servers,
    '--setting-sources', 'project', '--settings', settings,
    '--disallowedTools', 'EnterWorktree,ExitWorktree,Task,Workflow,ListAgents,SendMessage,PushNotification,RemoteTrigger,DesignSync',
    '--no-session-persistence', '--disable-slash-commands', '--no-chrome', '--append-system-prompt-file', `${cwd}/agent.md`],
  env: { HOME: '<root>', CLAUDE_CODE_TMPDIR: `${cwd}/.claude-tmp` },
  folder: { home: '<root>/.claude', name: '<cwd>' },
});

const PLUGINS_OFF = '"enabledPlugins":{"cc-plugin-agents-md@builtin":false,"cc-plugin-telemetry@builtin":false,"cc-plugin-plugin-authoring@builtin":false}';

const WORKTREE = '<root>/rigger-42';
const JUDGE = '<root>/judges/rigger-42/reviewer';
const ROUTED = '<root>/escalations/rigger-42/pm';
const WORKTREE_SETTINGS = `{"autoMemoryEnabled":false,"claudeMdExcludes":["<root>/CLAUDE.md"],${PLUGINS_OFF}}`;
const JUDGE_SETTINGS = `{"autoMemoryEnabled":false,"claudeMdExcludes":["${JUDGE}/CLAUDE.md","<root>/judges/rigger-42/CLAUDE.md","<root>/judges/CLAUDE.md","<root>/CLAUDE.md"],${PLUGINS_OFF},"permissions":{"allow":["Read(/${JUDGE}/head/**)","Edit(/${JUDGE}/head/**)"]}}`;
const ROUTED_SETTINGS = `{"autoMemoryEnabled":false,"claudeMdExcludes":["${ROUTED}/CLAUDE.md","<root>/escalations/rigger-42/CLAUDE.md","<root>/escalations/CLAUDE.md","<root>/CLAUDE.md"],${PLUGINS_OFF}}`;

// Invariant guard M2: only the git-root list may differ from the merge base, and a judge has none.
test('a Codex judge dispatch equals the merge base whole, prompt included', async (t) => {
  assert.deepEqual(await dispatched(t, 'judge', 'codex'), codexDispatch(`${JUDGE}/main`, JUDGE, 'reviewer', [`${JUDGE}/head`]));
});

// Invariant guard M3: a routed role's invocation changes nowhere.
test('a Codex routed role dispatch equals the merge base whole, prompt included', async (t) => {
  assert.deepEqual(await dispatched(t, 'routed', 'codex'), codexDispatch(`${ROUTED}/main`, ROUTED, 'pm'));
});

// Invariant guard: an unmarked dispatch reads no git directories, so it has no root to differ by.
test('an unmarked Codex dispatch equals the merge base whole, prompt included', async (t) => {
  assert.deepEqual(await dispatched(t, 'unmarked', 'codex'), codexDispatch(WORKTREE, WORKTREE, 'engineer'));
});

// Invariant guard M4: the mark reaches a Claude maker's dispatch and changes nothing the merge base held.
test('a Claude maker dispatch equals the merge base whole, prompt included', async (t) => {
  assert.deepEqual(await dispatched(t, 'maker', 'claude'), claudeDispatch(WORKTREE, WORKTREE, 'engineer', WORKTREE_SETTINGS));
});

// Invariant guard: as M4, without the mark.
test('an unmarked Claude dispatch equals the merge base whole, prompt included', async (t) => {
  assert.deepEqual(await dispatched(t, 'unmarked', 'claude'), claudeDispatch(WORKTREE, WORKTREE, 'engineer', WORKTREE_SETTINGS));
});

// Invariant guard: a Claude judge keeps its reached head as rules, and nothing else moves.
test('a Claude judge dispatch equals the merge base whole, prompt included', async (t) => {
  assert.deepEqual(await dispatched(t, 'judge', 'claude'), claudeDispatch(`${JUDGE}/main`, JUDGE, 'reviewer', JUDGE_SETTINGS));
});

// Invariant guard: a Claude routed role changes nowhere.
test('a Claude routed role dispatch equals the merge base whole, prompt included', async (t) => {
  assert.deepEqual(await dispatched(t, 'routed', 'claude'), claudeDispatch(`${ROUTED}/main`, ROUTED, 'pm', ROUTED_SETTINGS));
});

// Invariant guard M3 at L3's own site, where a false maker mark would be set.
test('a role L3 routes reaches the agent with the merge base argument list whole', async (t) => {
  const { root, invocations, outcome } = await scheduledMaker(t, { routed: true });
  assert.equal(outcome.status, 'fulfilled', outcome.reason?.stack);
  assert.equal(invocations.length, 2, 'the maker and its routed role both reached the controlled agent');
  assert.deepEqual(JSON.parse(JSON.stringify(invocations[1]).split(root).join('<root>')), codexArgs(`${ROUTED}/main`, 'pm', [], '# Fixture routed role\\n'));
});

/** One Codex judge L3 starts on a pull request awaiting its verdict, whose argument list the agent receives. */
async function scheduledJudge(t, { step = false } = {}) {
  const { request, root, events } = layout(t);
  codexProbe(t);
  const config = consumerConfig(1);
  config.board = { ...config.board, priority: undefined };
  config.kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'], provisioning: step ? ['prepare'] : [] } };
  config.roles = { ...config.roles, engineer: { agent: 'agent.md', provider: 'codex', tier: 'standard', timeout: 1000 }, reviewer: { agent: 'agent.md', provider: 'codex', tier: 'standard', timeout: 1000 } };
  // Literal, and different, so that the prompt shows which is which and its digest is one value.
  const [head, base] = ['a'.repeat(40), 'b'.repeat(40)];
  const issue = card(42, config.board.columns.review);
  const board = createFakeBoard({ columns: Object.values(config.board.columns), items: [issue] });
  const repository = createFakeRepository({ repo: config.repo, issues: [{ number: 42, title: issue.title, body: issue.body, labels: issue.labels }],
    pullRequests: [{ number: 77, head: 'rigger-42', sha: head, mergeBase: base, diff: 'diff --git a/delivery b/delivery\n', comments: [] }] });
  const l2 = columnChanges({ config, sink: request.sink, items: board.operations, reads: repository.operations, repositoryWrites: repository, roleReads: () => repository.operations });
  l2.notice = async function* () { return {}; };
  const decide = (given, outcomes, options = {}) => nextAction(given, config.kinds, undefined, { roles: config.roles, provisioning: PROVISIONING, sink: request.sink, outcomes, ...options });
  const invocations = [];
  const sessions = [];
  const host = { ...realHost, spawn(command, args, options) {
    if (command === '/bin/sh') return recordedChild(sessions, command, args, options);
    assert.equal(command, 'codex');
    invocations.push(args);
    return recordedChild(sessions, command, args, options);
  }, spawnSync: () => ({ status: 0, stdout: 'Thu Nov  5 12:00:00 2026\n', stderr: '' }) };
  const built = loop({ config, board: handleOn(board, { columns: config.board.columns }), decide,
    facts: factsCall({ config, reads: repository.operations, decide }), l2, sink: request.sink, kill: async () => {},
    workspace: async () => { throw new Error('a judge makes no worktree'); }, workspaceTip: async () => head,
    judgeDirectory: async () => {
      const path = join(root, 'judges', 'rigger-42', 'reviewer');
      mkdirSync(join(path, 'main'), { recursive: true });
      mkdirSync(join(path, 'head'));
      writeFileSync(join(path, 'main', 'agent.md'), '# Fixture agent\n');
      return { path, main: join(path, 'main'), head: join(path, 'head'), scratch: request.scratch, repository: request.repository };
    }, removeDirectories: async () => {}, escalationDirectory: async () => { throw new Error('no role is routed'); },
    state: join(root, 'state'), environment: { HOME: root }, run: 'r-maker-git', host });
  const [outcome] = await Promise.allSettled([built.pull()]);
  return { root, events, invocations, sessions, outcome };
}

// Invariant guard M2 at L3's own site, where a false maker mark would be set.
test('a judge L3 starts reaches the agent with the merge base argument list whole', async (t) => {
  const { root, invocations, outcome } = await scheduledJudge(t);
  assert.equal(invocations.length, 1, `one judge reached the controlled agent: ${outcome.reason?.stack}`);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations[0]).split(root).join('<root>')), codexArgs(`${JUDGE}/main`, 'reviewer', [`${JUDGE}/head`]));
});

// A marked Codex maker differs from the merge base by its four git roots and by nothing else.
test('a Codex maker dispatch equals the merge base whole but for its four git roots', async (t) => {
  const common = '<root>/repository/.git';
  assert.deepEqual(await dispatched(t, 'maker', 'codex'), codexDispatch(WORKTREE, WORKTREE, 'engineer', [`${common}/worktrees/rigger-42`, `${common}/objects`, `${common}/refs`, `${common}/logs`]));
});

/**
 * The `at`th process L0 started, whole, with the L1 record of its start. The host's path is `<root>`,
 * and that dispatch's own id alone is `d-<uuid>`: a prompt holding any other id does not compare.
 */
function startedAs(sessions, at, root, events) {
  assert.ok(at < sessions.length, `process ${at} never started: only ${sessions.length} did`);
  const start = events.filter((event) => event.event === 'dispatch.start' && event.layer === 'L1')[at];
  const { args, ...session } = sessions[at];
  return JSON.parse(JSON.stringify({ ...session, args: stableArgs(args, root), start }).split(root).join('<root>').split(start.dispatch).join('d-<uuid>'));
}

// The merge base's dispatches as L0 handed them to the process, read by running merge-base production
// through L3 over these fixtures, with arguments held by the builders above. A step has them here.
const ROUTED_START = {
  "command": "codex",
  "env": {
    "HOME": "<root>",
    "CODEX_HOME": "<root>/scratch/rigger-42/pm/codex-home",
    "TMPDIR": "<root>/scratch/rigger-42/pm/tmp",
    "TMPPREFIX": "<root>/scratch/rigger-42/pm/tmp/zsh"
  },
  "cwd": "<root>/escalations/rigger-42/pm/main",
  "detached": true,
  "stdio": [
    "pipe",
    "pipe",
    "pipe"
  ],
  "input": "Rigger dispatched this session to handle an escalation for card #42.\nOnly the card's author changes an acceptance.\nWhere you cannot meet an acceptance item, write one comment on card #42's issue with this block, filling each field:\n```rigger-escalation\ncategory: <recorded-decision, critical, or ambiguous>\nitem: <the item ordinal>\nreason: <one line naming why>\ndispatch: d-<uuid>\n```\nCount the item ordinal from 1 over the acceptance items in the evidence below, in order.\nWrite the note once, never edit it, and end your session after posting it.\n\nCard #42: Card 42\nAcceptance:\n- The widget turns blue when pressed.\n\nMaker's ambiguous note, acceptance item 1:\nChoose `blue` or \"green\"; preserve $HOME and \\.\n",
  "start": {
    "layer": "L1",
    "card": 42,
    "dispatch": "d-<uuid>",
    "event": "dispatch.start",
    "command": "codex",
    "timeout": 1000,
    "workspace": "<root>/escalations/rigger-42/pm",
    "facts": {
      "card": 42,
      "title": "Card 42",
      "acceptance": [
        "The widget turns blue when pressed."
      ],
      "category": "ambiguous",
      "item": 1,
      "reason": "Choose `blue` or \"green\"; preserve $HOME and \\."
    },
    "digest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
};
const JUDGE_START = {
  "command": "codex",
  "env": {
    "HOME": "<root>",
    "CODEX_HOME": "<root>/scratch/rigger-42/reviewer/codex-home",
    "TMPDIR": "<root>/scratch/rigger-42/reviewer/tmp",
    "TMPPREFIX": "<root>/scratch/rigger-42/reviewer/tmp/zsh"
  },
  "cwd": "<root>/judges/rigger-42/reviewer/main",
  "detached": true,
  "stdio": [
    "pipe",
    "pipe",
    "pipe"
  ],
  "input": "Rigger dispatched this session, unattended, as the judge `reviewer` of pull request #77, at head `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.\nWhat follows is a floor, never a limit: you may read beyond what you were given.\nThe pull request's head, with the card's provisioning steps run in it, is in the `head` directory beside your working directory. Build and test in the `head` directory, and never edit it.\nBefore ruling, run `git diff bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` in your working directory as its own tool call, even when the evidence below includes the diff.\nRun any command in `head` as one line: `cd ../head && <command>`.\nNever run git in `head`; run git commands in your working directory.\nYour working directory is not provisioned; never build or test there. Read a command's exit status from the tool's result.\nUse a separate tool call for each command, with no extra shell operations, pipes, groups, variables, or status probes such as `$?`, `${...}` or `$(...)`. Keep the `cd ../head && <command>` line by itself.\nRule on every acceptance item below, by its number, as met or unmet, then write your verdict as one comment on pull request #77.\nIts first line is yours, for the person reading the pull request. Its second line opens this block, which you fill in and write exactly once, under no other fence, leaving out the two optional lines where they do not apply:\n\n```rigger-marker\ncard: 42\npull: 77\nhead: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\ndigest: 127e331847a30d7a2ef7d5b39015176fd4a901696101c70fe3d4f946278b410e\nrole: reviewer\nprovider: codex\nverdict: <sound, needs revision or critical>\nitem 1: <met or unmet>\ncoverage: <covered or insufficient: whether the acceptance covered what the card asked>\ncoverageReason: <one line: why the acceptance does not cover what the card asked, written only where coverage is insufficient>\ntoSound: <one line: what would make the work sound, written only where the verdict is not sound>\ndispatch: d-<uuid>\nevidence: 55b8d927df6a6860ccf74ad449fffd7623c49bbace1a359ba1de5a23b675781f\n```\n\nThe acceptance items, by number:\n1. The widget turns blue when pressed.\n\nCard #42: Card 42\n\nAcceptance, whose digest your marker carries, 127e331847a30d7a2ef7d5b39015176fd4a901696101c70fe3d4f946278b410e:\n- The widget turns blue when pressed.\n\nPull request #77, from base bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb to head aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.\n\nDiff:\ndiff --git a/delivery b/delivery\n",
  "start": {
    "layer": "L1",
    "card": 42,
    "dispatch": "d-<uuid>",
    "event": "dispatch.start",
    "command": "codex",
    "timeout": 1000,
    "workspace": "<root>/judges/rigger-42/reviewer",
    "facts": {
      "card": 42,
      "revision": "127e331847a30d7a2ef7d5b39015176fd4a901696101c70fe3d4f946278b410e",
      "pull": 77,
      "base": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "head": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "digest": "55b8d927df6a6860ccf74ad449fffd7623c49bbace1a359ba1de5a23b675781f"
  }
};
const CLAUDE_MAKER_START = {
  "command": "claude",
  "env": {
    "HOME": "<root>",
    "CLAUDE_CODE_TMPDIR": "<root>/rigger-42/.claude-tmp"
  },
  "cwd": "<root>/rigger-42",
  "detached": true,
  "stdio": [
    "pipe",
    "pipe",
    "pipe"
  ],
  "input": "Rigger dispatched this session, unattended, as the maker for card #42.\nThis workspace is on the card's line of work, the branch `rigger-42`.\nOnce your work meets every acceptance item below, open a pull request from `rigger-42`.\nNever switch this workspace off `rigger-42`, never detach `HEAD`, and never add a worktree inside this workspace.\nWhere you cannot meet an acceptance item, write one comment on card #42's issue with this block, filling each field:\n```rigger-escalation\ncategory: <recorded-decision, critical, or ambiguous>\nitem: <the item ordinal>\nreason: <one line naming why>\ndispatch: d-<uuid>\n```\nCount the item ordinal from 1 over the acceptance items in the evidence below, in order.\nWrite the note once, never edit it, and end your session after posting it.\n\nCard #42: Card 42\n\nAcceptance:\n- The widget turns blue when pressed.\n",
  "start": {
    "layer": "L1",
    "card": 42,
    "dispatch": "d-<uuid>",
    "event": "dispatch.start",
    "command": "claude",
    "timeout": 1000,
    "workspace": "<root>/rigger-42",
    "digest": "8f71dc1b6c1a0b02d1615d9bcc3a68c7f3a0d0b27f9b4c721df62dde3d73aaff"
  }
};
const CODEX_MAKER_START = {
  "command": "codex",
  "env": {
    "HOME": "<root>",
    "CODEX_HOME": "<root>/scratch/rigger-42/engineer/codex-home",
    "TMPDIR": "<root>/scratch/rigger-42/engineer/tmp",
    "TMPPREFIX": "<root>/scratch/rigger-42/engineer/tmp/zsh"
  },
  "cwd": "<root>/rigger-42",
  "detached": true,
  "stdio": [
    "pipe",
    "pipe",
    "pipe"
  ],
  "input": "Rigger dispatched this session, unattended, as the maker for card #42.\nThis workspace is on the card's line of work, the branch `rigger-42`.\nOnce your work meets every acceptance item below, open a pull request from `rigger-42`.\nNever switch this workspace off `rigger-42`, never detach `HEAD`, and never add a worktree inside this workspace.\nWhere you cannot meet an acceptance item, write one comment on card #42's issue with this block, filling each field:\n```rigger-escalation\ncategory: <recorded-decision, critical, or ambiguous>\nitem: <the item ordinal>\nreason: <one line naming why>\ndispatch: d-<uuid>\n```\nCount the item ordinal from 1 over the acceptance items in the evidence below, in order.\nWrite the note once, never edit it, and end your session after posting it.\n\nCard #42: Card 42\n\nAcceptance:\n- The widget turns blue when pressed.\n",
  "start": {
    "layer": "L1",
    "card": 42,
    "dispatch": "d-<uuid>",
    "event": "dispatch.start",
    "command": "codex",
    "timeout": 1000,
    "workspace": "<root>/rigger-42",
    "digest": "8f71dc1b6c1a0b02d1615d9bcc3a68c7f3a0d0b27f9b4c721df62dde3d73aaff"
  }
};
const MAKER_STEP_START = {
  "command": "/bin/sh",
  "env": {
    "HOME": "<root>"
  },
  "cwd": "<root>/rigger-42",
  "detached": true,
  "stdio": [
    "ignore",
    "pipe",
    "pipe"
  ],
  "input": "",
  "args": [
    "-c",
    "true"
  ],
  "start": {
    "layer": "L1",
    "card": 42,
    "dispatch": "d-<uuid>",
    "event": "dispatch.start",
    "command": "/bin/sh",
    "timeout": 500,
    "workspace": "<root>/rigger-42"
  }
};
const JUDGE_STEP_START = {
  "command": "/bin/sh",
  "env": {
    "HOME": "<root>"
  },
  "cwd": "<root>/judges/rigger-42/reviewer/head",
  "detached": true,
  "stdio": [
    "ignore",
    "pipe",
    "pipe"
  ],
  "input": "",
  "args": [
    "-c",
    "true"
  ],
  "start": {
    "layer": "L1",
    "card": 42,
    "dispatch": "d-<uuid>",
    "event": "dispatch.start",
    "command": "/bin/sh",
    "timeout": 500,
    "workspace": "<root>/judges/rigger-42/reviewer/head"
  }
};
const DECLARED_SETTINGS = "{\"autoMemoryEnabled\":false,\"claudeMdExcludes\":[\"<root>/CLAUDE.md\"],\"enabledPlugins\":{\"cc-plugin-agents-md@builtin\":false,\"cc-plugin-telemetry@builtin\":false,\"cc-plugin-plugin-authoring@builtin\":false},\"permissions\":{\"allow\":[\"Bash(git push:*)\"],\"deny\":[\"Bash(git push --force:*)\"],\"ask\":[\"Bash(npm run:*)\"]}}";

// Invariant guard M3 at L3's own site: what L3 adds to a routed role reaches no argument.
test('a role L3 routes reaches the agent with the merge base prompt, environment and timeout', async (t) => {
  const { root, events, sessions, outcome } = await scheduledMaker(t, { routed: true, pinned: true });
  assert.equal(outcome.status, 'fulfilled', outcome.reason?.stack);
  assert.equal(sessions.length, 2, 'the maker and its routed role both reached the controlled agent');
  const start = events.filter((event) => event.event === 'dispatch.start' && event.layer === 'L1')[1];
  assert.ok(sessions[1].input.includes(`dispatch: ${start.dispatch}`), 'the prompt does not name the dispatch L1 started');
  assert.deepEqual(startedAs(sessions, 1, root, events), { ...ROUTED_START, args: codexArgs(`${ROUTED}/main`, 'pm', [], '# Fixture routed role\\n') });
});

// Invariant guard M3 at L3's own site: an escalation that carries a head keeps it within the role's reach.
test('a role L3 routes with a head reaches the agent as at the merge base', async (t) => {
  const { root, events, sessions, outcome } = await scheduledMaker(t, { routed: true, pinned: true, routedHead: true });
  assert.equal(outcome.status, 'fulfilled', outcome.reason?.stack);
  assert.deepEqual(startedAs(sessions, 1, root, events), { ...ROUTED_START, args: codexArgs(`${ROUTED}/main`, 'pm', [`${ROUTED}/head`], '# Fixture routed role\\n') });
});

// Invariant guard M2 at L3's own site: what L3 adds to a judge reaches no argument.
test('a judge L3 starts reaches the agent with the merge base prompt, environment and timeout', async (t) => {
  const { root, events, sessions, outcome } = await scheduledJudge(t);
  assert.equal(sessions.length, 1, `one judge reached the controlled agent: ${outcome.reason?.stack}`);
  assert.deepEqual(startedAs(sessions, 0, root, events), { ...JUDGE_START, args: codexArgs(`${JUDGE}/main`, 'reviewer', [`${JUDGE}/head`]) });
});

// Invariant guard M4 at L3's own site: L3's maker mark changes nothing else a Claude maker receives.
test('a Claude maker L3 selects reaches the agent with the merge base prompt, environment and timeout', async (t) => {
  const { root, events, sessions, outcome } = await scheduledMaker(t, { provider: 'claude', pinned: true });
  assert.equal(outcome.status, 'fulfilled', outcome.reason?.stack);
  assert.equal(sessions.length, 1, 'one maker reached the controlled agent');
  assert.deepEqual(startedAs(sessions, 0, root, events), { ...CLAUDE_MAKER_START, args: claudeDispatch(WORKTREE, WORKTREE, 'engineer', WORKTREE_SETTINGS).args });
});

// A marked Codex maker through L3 differs from the merge base by its four git roots and nothing else.
test('a Codex maker L3 selects reaches the agent with the merge base prompt, environment and timeout but for its four git roots', async (t) => {
  const { root, events, sessions, outcome } = await scheduledMaker(t, { pinned: true });
  assert.equal(outcome.status, 'fulfilled', outcome.reason?.stack);
  const common = '<root>/repository/.git';
  assert.deepEqual(startedAs(sessions, 0, root, events), { ...CODEX_MAKER_START, args: codexArgs(WORKTREE, 'engineer', [`${common}/worktrees/rigger-42`, `${common}/objects`, `${common}/refs`, `${common}/logs`]) });
});

// Invariant guard M2 at L3's own site: a step before a maker is started as at the merge base.
test('a step L3 runs before a maker starts as at the merge base', async (t) => {
  const { root, events, sessions } = await scheduledMaker(t, { pinned: true, step: true });
  assert.deepEqual(startedAs(sessions, 0, root, events), MAKER_STEP_START);
});

// Invariant guard M2 at L3's own site: a step in a judge's head is started as at the merge base.
test('a step L3 runs in a judge head starts as at the merge base', async (t) => {
  const { root, events, sessions } = await scheduledJudge(t, { step: true });
  assert.deepEqual(startedAs(sessions, 0, root, events), JUDGE_STEP_START);
});

// Invariant guard M4 for a shipped-shaped consumer: declared rules and servers are as the merge base carried them.
test('a Claude maker with declared rules and servers equals the merge base whole, prompt included', async (t) => {
  assert.deepEqual(await dispatched(t, 'maker', 'claude', { declared: true }), claudeDispatch(WORKTREE, WORKTREE, 'engineer', DECLARED_SETTINGS, ['--mcp-config', `${WORKTREE}/.mcp.json`]));
});
