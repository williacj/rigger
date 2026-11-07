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

/** Real git exits naturally; the documented ps contract answers that its group is then absent. */
function processTable(t) {
  const replacement = {
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
async function scheduledMaker(t, { missingGit = false, routed = false, continuing = false } = {}) {
  const here = layout(t);
  const { request, root } = here;
  codexProbe(t);
  if (missingGit) rmSync(join(request.cwd, '.git'));
  const config = consumerConfig(1);
  config.board = { ...config.board, priority: undefined };
  config.kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['owner'] } };
  config.roles = { ...config.roles, engineer: { agent: 'agent.md', provider: 'codex', tier: 'standard', timeout: 1000 } };
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
  const decide = (given, outcomes, options = {}) => nextAction(given, config.kinds, undefined, { roles: config.roles, provisioning: {}, sink: request.sink, outcomes, ...options });
  const invocations = [];
  const host = { ...realHost,
    spawn(command, args, options) {
      assert.equal(command, 'codex');
      assert.equal(args[0], 'exec');
      invocations.push(args);
      if (continuing) repository.update(77, { comments: [] });
      if (routed && options.cwd === request.cwd) {
        const start = here.events.findLast((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role === 'engineer');
        repository.postIssueComment(42, postedNote(start.dispatch).body.replace('item: 2', 'item: 1'));
      }
      return completedChild();
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
      return { path, main, scratch: request.scratch, repository: request.repository };
    },
    state: join(root, 'state'), environment: process.env, run: 'r-maker-git', host });
  const [outcome] = await Promise.allSettled([built.pull()]);
  return { ...here, invocations, outcome, workspaceHeads, head };
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

// Invariant guard M11: top-level declaration keys cannot be commented out, duplicated or weakened.
test('both shipped Codex declarations select workspace-write exactly once', () => {
  for (const path of ['../templates/codex/config.toml', '../.codex/config.toml']) {
    const lines = readFileSync(new URL(path, import.meta.url), 'utf8').split('\n');
    const table = lines.findIndex((line) => /^\s*\[/.test(line));
    const root = lines.slice(0, table === -1 ? undefined : table);
    const values = root.filter((line) => /^\s*sandbox_mode\s*=/.test(line)).map((line) => JSON.parse(line.slice(line.indexOf('=') + 1).split('#')[0].trim()));
    assert.deepEqual(values, ['workspace-write'], `${path} must declare one workspace-write sandbox`);
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

/**
 * What L1 handed for dispatch, whole, with each host-specific path as `<root>` so that it compares
 * with a literal. The `CLAUDE.md` exclusions above `root` depend only on where the fixture lies, so
 * they are checked against `above` and then dropped.
 */
function wholeInvocation(handed, root) {
  const args = handed.args.map((arg, index) => {
    if (handed.args[index - 1] !== '--settings') return arg;
    const settings = JSON.parse(arg);
    const outside = settings.claudeMdExcludes.filter((path) => !path.startsWith(`${root}/`));
    assert.deepEqual(outside, above(root).map((path) => join(path, 'CLAUDE.md')));
    return JSON.stringify({ ...settings, claudeMdExcludes: settings.claudeMdExcludes.filter((path) => path.startsWith(`${root}/`)) });
  });
  const folder = handed.folder === undefined ? {} : { folder: { ...handed.folder, name: '<cwd>' } };
  if (handed.folder !== undefined) assert.ok(handed.folder.name.startsWith(handed.cwd.replace(/[^A-Za-z0-9]/g, '-').slice(0, 200)), handed.folder.name);
  return JSON.parse(JSON.stringify({ ...handed, ...folder, args, input: handed.input.toString('utf8') }).split(root).join('<root>'));
}

/** A role's dispatch in each shape L3 gives one, with a prompt of two parts so neither can be lost. */
async function dispatched(t, shape, provider) {
  const { request, root } = layout(t);
  if (provider === 'codex') codexProbe(t);
  const place = { judge: join(root, 'judges', 'rigger-42', 'reviewer'), routed: join(root, 'escalations', 'rigger-42', 'pm') }[shape];
  const main = place === undefined ? request.cwd : join(place, 'main');
  mkdirSync(main, { recursive: true });
  writeFileSync(join(main, 'agent.md'), '# Fixture agent\n');
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
  env: { HOME: '<root>', CODEX_HOME: `<root>/scratch/rigger-42/${role}/codex-home`, TMPDIR: `<root>/scratch/rigger-42/${role}/tmp`, TMPPREFIX: `<root>/scratch/rigger-42/${role}/tmp/zsh` },
});

/** The merge base's whole Claude Code dispatch, whose `--settings` text is given whole. */
const claudeDispatch = (cwd, workspace, role, settings) => ({
  provider: 'claude', command: 'claude', input: FIXTURE_PROMPT, cwd, workspace, scratch: `<root>/scratch/rigger-42/${role}`, timeout: 1000,
  args: ['-p', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--model', 'sonnet', '--strict-mcp-config',
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
async function scheduledJudge(t) {
  const { request, root, events } = layout(t);
  codexProbe(t);
  const config = consumerConfig(1);
  config.board = { ...config.board, priority: undefined };
  config.kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };
  config.roles = { ...config.roles, engineer: { agent: 'agent.md', provider: 'codex', tier: 'standard', timeout: 1000 }, reviewer: { agent: 'agent.md', provider: 'codex', tier: 'standard', timeout: 1000 } };
  const head = gitIn(request.repository, 'rev-parse', 'HEAD').trim();
  const issue = card(42, config.board.columns.review);
  const board = createFakeBoard({ columns: Object.values(config.board.columns), items: [issue] });
  const repository = createFakeRepository({ repo: config.repo, issues: [{ number: 42, title: issue.title, body: issue.body, labels: issue.labels }],
    pullRequests: [{ number: 77, head: 'rigger-42', sha: head, mergeBase: head, diff: 'diff --git a/delivery b/delivery\n', comments: [] }] });
  const l2 = columnChanges({ config, sink: request.sink, items: board.operations, reads: repository.operations, repositoryWrites: repository, roleReads: () => repository.operations });
  l2.notice = async function* () { return {}; };
  const decide = (given, outcomes, options = {}) => nextAction(given, config.kinds, undefined, { roles: config.roles, provisioning: {}, sink: request.sink, outcomes, ...options });
  const invocations = [];
  const host = { ...realHost, spawn(command, args) {
    assert.equal(command, 'codex');
    invocations.push(args);
    return completedChild();
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
    state: join(root, 'state'), environment: process.env, run: 'r-maker-git', host });
  const [outcome] = await Promise.allSettled([built.pull()]);
  return { root, events, invocations, outcome };
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
