// ABOUTME: Tests L1's role runner: what `roleDispatch` hands L1's `dispatch` for a role's answer,
// through the provider adapter the answer names, and what L1 records of the dispatch it runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chmodSync, lstatSync, readlinkSync, statSync } from 'node:fs';
import { ADAPTERS } from '../src/substrate/providers/adapters.mjs';
import { renameSync, rmSync } from 'node:fs';
import { EVENT_REFUSED } from '../src/substrate/process.mjs';
import { gitIn, repositoryAt, worktreeAt, worktreeList } from './git-repository.mjs';
import { dirname } from 'node:path';

import { readGroups } from '../src/execution/groups.mjs';
import { roleDispatch } from '../src/execution/role.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { stepDispatch } from '../src/execution/step.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { OUTLIVED, TAIL, alive, fixture, leaveWorking, read, scratch, until } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

// A bound on the test alone, so that a dispatch which never settles fails here rather than
// holding the suite: nothing waits on it when the dispatch settles.
const { 20_000: SETTLES_WITHIN } = BOUNDS;

/** A role answer as L2 gives one, naming the stand-in provider, with `fields` over it. */
const answerOf = (fields) => ({
  role: 'engineer',
  agent: '.claude/agents/engineer.md',
  provider: 'stand-in',
  tier: 'standard',
  timeout: 60_000,
  instruction: 'Make the change card #1412 asks for.\n',
  evidence: 'Card #1412: the acceptance.\n',
  ...fields,
});

/**
 * A stand-in provider adapter, which records every request its `invocation` receives in
 * `requests`, and answers `command` with `args`, the prompt's bytes as standard input, and `unset`
 * and `env` as given.
 */
function standIn(command, { args = [], unset = [], env = {} } = {}) {
  const requests = [];
  return {
    requests,
    adapter: {
      name: 'stand-in',
      async invocation(request) {
        requests.push(request);
        return { command, args, input: Buffer.from(request.prompt, 'utf8'), unset, env };
      },
    },
  };
}

/** The scratch base of a dispatch whose directory is `directory`: `scratch/rigger-1412/` beside it. */
const scratchOf = (directory) => join(dirname(directory), 'scratch', 'rigger-1412');

/** The repository of a dispatch whose directory is `directory`: an empty git repository, `repository/`, beside it. */
const repositoryOf = (directory) => join(dirname(directory), 'repository');

/**
 * A judge's layout in the test's own temporary directory: the dispatch's directory `judge/`, its
 * working directory `judge/main/` and its reached directory `judge/head/`, the dispatch's scratch
 * base `scratch/rigger-1412/` beside `judge/` and outside it, an empty git repository
 * `repository/` beside them as the repository L1 made from, and the state directory `.rigger/`
 * beside them, with a sink open on it.
 */
function layout(t) {
  const root = scratch(t);
  const directory = join(root, 'judge');
  const cwd = join(directory, 'main');
  const head = join(directory, 'head');
  const base = scratchOf(directory);
  for (const each of [cwd, head, base]) mkdirSync(each, { recursive: true });
  const repository = repositoryAt(repositoryOf(directory));
  const state = join(root, '.rigger');
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return { root, directory, cwd, head, scratch: base, repository, state, sink };
}

/**
 * A stand-in agent in `root`, run by Node, which writes what it was started with to `seen.json`
 * beside it: its environment and the bytes of its standard input, base64-encoded. It names `root`
 * in its command line, so the scratch directory's teardown ends it.
 */
function agentIn(root) {
  const path = join(root, 'agent.mjs');
  writeFileSync(path, [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "import { dirname, join } from 'node:path';",
    'const input = readFileSync(0);',
    "writeFileSync(join(dirname(process.argv[1]), 'seen.json'), JSON.stringify({ env: process.env, input: input.toString('base64') }));",
  ].join('\n'));
  return { command: process.execPath, args: [path] };
}

/** What the stand-in agent in `root` wrote, with its standard input as text, or nothing where it never ran. */
function seenIn(root) {
  const path = join(root, 'seen.json');
  if (!existsSync(path)) return undefined;
  const seen = JSON.parse(readFileSync(path, 'utf8'));
  return { ...seen, input: Buffer.from(seen.input, 'base64').toString('utf8') };
}

/**
 * Runs a role's dispatch as L3 does (the architect's ruling 5 on #467): `roleDispatch` first, and
 * only once it has answered, L1's `dispatch`, under the id `d-role` and card #1412. Settles on the
 * dispatch's result, or rejects as either does.
 */
async function throughL1({ sink, state, ...request }) {
  const handed = await roleDispatch({ sink, id: 'd-role', card: 1412, ...request, scratch: request.scratch ?? scratchOf(request.directory), repository: request.repository ?? repositoryOf(request.directory) });
  return dispatch({ id: 'd-role', card: 1412, directory: state, sink, ...handed });
}

/** Every event the stream in `state` holds, or none where nothing was recorded. */
const eventsIn = (state) => (existsSync(state) ? readEvents(state) : []);

test('roleDispatch answers what L1\'s dispatch is handed: the command, arguments and standard input the adapter answered, the working directory, the dispatch\'s directory, the environment and the timeout', async (t) => {
  const { directory, cwd, head, sink } = layout(t);
  const { adapter } = standIn('/usr/bin/true', { args: ['--stand-in'] });

  const handed = await roleDispatch({ answer: answerOf(), cwd, directory, scratch: scratchOf(directory), repository: repositoryOf(directory), reach: [head], env: { KEEP: 'kept' }, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.deepEqual(
    { command: handed.command, args: handed.args, input: handed.input.toString('utf8'), cwd: handed.cwd, workspace: handed.workspace, env: handed.env, timeout: handed.timeout },
    { command: '/usr/bin/true', args: ['--stand-in'], input: 'Make the change card #1412 asks for.\nCard #1412: the acceptance.\n', cwd, workspace: directory, env: { KEEP: 'kept' }, timeout: 60_000 },
  );
});

test('roleDispatch asks the module the role answer\'s provider names in the adapter map for the invocation, and no other', async (t) => {
  const { directory, cwd, sink } = layout(t);
  const named = standIn('/usr/bin/true');
  const other = standIn('/usr/bin/false');

  const handed = await roleDispatch({ answer: answerOf({ provider: 'named' }), cwd, directory, scratch: scratchOf(directory), repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { other: other.adapter, named: named.adapter } });

  assert.equal(handed.command, '/usr/bin/true');
  assert.equal(named.requests.length, 1);
  assert.equal(other.requests.length, 0);
});

test('roleDispatch reads the adapter map L0 holds where its caller gives none, so a role answer naming `claude` is answered by the Claude Code adapter', async (t) => {
  const { directory, cwd, sink } = layout(t);

  const handed = await roleDispatch({ answer: answerOf({ provider: 'claude' }), cwd, directory, scratch: scratchOf(directory), repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-role', card: 1412 });

  assert.equal(handed.command, 'claude');
});

test('given a role answer naming a provider the adapter map does not hold, roleDispatch throws an error naming the provider, and no process starts', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, state, sink } = layout(t);
  const { command, args } = agentIn(root);
  const { adapter } = standIn(command, { args });

  await assert.rejects(
    throughL1({ answer: answerOf({ provider: 'unheld' }), cwd, directory, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } }),
    (failure) => /\bunheld\b/.test(failure.message),
  );
  assert.equal(seenIn(root), undefined, 'the stand-in agent ran');
  assert.deepEqual(eventsIn(state), []);
});

test('given an invocation that rejects, roleDispatch rejects with NOT_STARTED naming the adapter\'s reason, and L1 records no dispatch.start for that dispatch', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, state, sink } = layout(t);
  const adapter = { name: 'stand-in', invocation: async () => { throw new Error('the probe found no skill list'); } };

  await assert.rejects(
    throughL1({ answer: answerOf(), cwd, directory, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } }),
    (failure) => failure.code === NOT_STARTED && failure.message.includes('the probe found no skill list'),
  );
  assert.equal(seenIn(root), undefined, 'the stand-in agent ran');
  assert.deepEqual(eventsIn(state).filter((event) => event.event === 'dispatch.start'), []);
});

test('roleDispatch hands the adapter\'s invocation the reach it was handed unchanged, which a stand-in adapter in the adapter map records', async (t) => {
  const { directory, cwd, head, sink } = layout(t);
  const { adapter, requests } = standIn('/usr/bin/true');
  const reach = [head];

  await roleDispatch({ answer: answerOf(), cwd, directory, scratch: scratchOf(directory), repository: repositoryOf(directory), reach, env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.equal(requests[0].reach, reach);
  assert.deepEqual(requests[0].reach, [head]);
});

test('the agent path roleDispatch hands the adapter is the role\'s agent file joined under the working directory, as an absolute path', async (t) => {
  const { directory, cwd, sink } = layout(t);
  const { adapter, requests } = standIn('/usr/bin/true');

  await roleDispatch({ answer: answerOf({ agent: '.claude/agents/reviewer.md' }), cwd, directory, scratch: scratchOf(directory), repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.equal(requests[0].agent, `${cwd}/.claude/agents/reviewer.md`);
});

test('the timeout roleDispatch answers is the role answer\'s timeout', async (t) => {
  const { directory, cwd, sink } = layout(t);
  const { adapter } = standIn('/usr/bin/true');

  const handed = await roleDispatch({ answer: answerOf({ timeout: 14_400_000 }), cwd, directory, scratch: scratchOf(directory), repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.equal(handed.timeout, 14_400_000);
});

test('roleDispatch hands the adapter\'s invocation an L0 emitter under the dispatch\'s id and card, and awaits its answer', async (t) => {
  const { directory, cwd, state, sink } = layout(t);
  const adapter = {
    name: 'stand-in',
    async invocation({ emitter }) {
      // A turn of the event loop before the answer, so a caller that did not await it would read none.
      await new Promise((resolve) => setImmediate(resolve));
      emitter.emit('probe.ran', { probe: 'stand-in' });
      return { command: '/usr/bin/true', args: [], input: Buffer.alloc(0), unset: [], env: {} };
    },
  };

  const handed = await roleDispatch({ answer: answerOf(), cwd, directory, scratch: scratchOf(directory), repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-probe', card: 1412, adapters: { 'stand-in': adapter } });

  assert.equal(handed.command, '/usr/bin/true');
  assert.deepEqual(readEvents(state).map(({ layer, event, dispatch: id, card, role, path }) => ({ layer, event, id, card, role, path })), [{ layer: 'L1', event: 'workspace.made', id: undefined, card: 1412, role: 'engineer', path: join(scratchOf(directory), 'engineer') }, { layer: 'L0', event: 'probe.ran', id: 'd-probe', card: 1412, role: undefined, path: undefined }]);
});

test('given a role dispatch through L1, the stand-in agent reads on its standard input exactly the role answer\'s instruction followed by its evidence', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, state, sink } = layout(t);
  const { command, args } = agentIn(root);
  const { adapter } = standIn(command, { args });

  const result = await throughL1({ answer: answerOf({ instruction: 'Judge pull request #9.\n', evidence: 'Its diff:\n+ one line\n' }), cwd, directory, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(seenIn(root).input, 'Judge pull request #9.\nIts diff:\n+ one line\n');
});

/** The variables that redirect git, each in the case `git_dir` would be read in on a host that folds it. */
const REDIRECTING = { GIT_DIR: '/elsewhere/.git', git_work_tree: '/elsewhere', GIT_INDEX_FILE: '/elsewhere/index', GIT_COMMON_DIR: '/elsewhere/.git', Git_Object_Directory: '/elsewhere/objects' };

test('given a role dispatch through L1, the stand-in agent\'s environment holds no variable that redirects git, whatever the environment handed held', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, state, sink } = layout(t);
  const { command, args } = agentIn(root);
  const { adapter } = standIn(command, { args });

  const result = await throughL1({ answer: answerOf(), cwd, directory, reach: [], env: { ...REDIRECTING, KEEP: 'kept' }, sink, state, adapters: { 'stand-in': adapter } });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  const names = Object.keys(seenIn(root).env).map((name) => name.toUpperCase());
  assert.deepEqual(names.filter((name) => ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'].includes(name)), []);
  assert.equal(seenIn(root).env.KEEP, 'kept');
});

test('given a role dispatch through L1 and an environment holding a variable the adapter names as one its CLI must not inherit, the stand-in agent\'s environment lacks it and holds every other variable it was handed but git\'s', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, state, sink } = layout(t);
  const { command, args } = agentIn(root);
  const { adapter } = standIn(command, { args, unset: ['UNINHERITED'] });
  const handed = { UNINHERITED: 'dropped', KEEP: 'kept', ALSO: 'also kept', GIT_DIR: '/elsewhere/.git' };

  const result = await throughL1({ answer: answerOf(), cwd, directory, reach: [], env: handed, sink, state, adapters: { 'stand-in': adapter } });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  const { env } = seenIn(root);
  assert.equal(Object.hasOwn(env, 'UNINHERITED'), false, 'the variable the adapter names reached the agent');
  assert.equal(Object.hasOwn(env, 'GIT_DIR'), false, 'git\'s redirecting variable reached the agent');
  assert.deepEqual({ KEEP: env.KEEP, ALSO: env.ALSO }, { KEEP: 'kept', ALSO: 'also kept' });
});

test('given a step\'s dispatch through L1 and an environment holding a variable a provider adapter names as one its CLI must not inherit, the step\'s command still holds that variable', SETTLES_WITHIN, async (t) => {
  const { root, directory, state, sink } = layout(t);
  const out = join(root, 'step-env');

  const result = await dispatch({ id: 'd-step', card: 1412, directory: state, sink, ...stepDispatch({ run: `/usr/bin/env > '${out}'` }, directory, { UNINHERITED: 'held' }) });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.ok(readFileSync(out, 'utf8').split('\n').includes('UNINHERITED=held'), 'the step\'s command lacks the variable');
});

test('roleDispatch builds a role\'s environment as the environment handed, less git\'s redirecting variables, less the adapter\'s unset, and then the adapter\'s env set over what is left', async (t) => {
  const { directory, cwd, sink } = layout(t);
  const set = join(directory, '.stand-in-tmp');
  const { adapter } = standIn('/usr/bin/true', { unset: ['UNINHERITED'], env: { STAND_IN_TMPDIR: set } });

  const handed = await roleDispatch({ answer: answerOf(), cwd, directory, scratch: scratchOf(directory), repository: repositoryOf(directory), reach: [], env: { STAND_IN_TMPDIR: '/handed/value', UNINHERITED: 'dropped', GIT_DIR: '/elsewhere/.git', KEEP: 'kept' }, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.deepEqual(handed.env, { STAND_IN_TMPDIR: set, KEEP: 'kept' });
});

test('given a role dispatch through L1 whose adapter\'s env sets a variable to a path under the dispatch\'s directory, the stand-in agent reads that variable and finds that path', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, state, sink } = layout(t);
  const { command, args } = agentIn(root);
  const set = join(directory, '.stand-in-tmp');
  const { adapter } = standIn(command, { args, env: { STAND_IN_TMPDIR: set } });

  const result = await throughL1({ answer: answerOf(), cwd, directory, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(seenIn(root).env.STAND_IN_TMPDIR, set);
});

/**
 * Asserts that a role dispatch through L1, whose stand-in adapter answers `env` and `unset` as
 * `invoked` gives them, rejects with NOT_STARTED naming `key`, that the stand-in agent never ran,
 * and that L1 recorded no dispatch.start.
 */
async function assertRefused({ root, directory, cwd, state, sink }, invoked, key) {
  const { command, args } = agentIn(root);
  const { adapter } = standIn(command, { args, ...invoked });

  await assert.rejects(
    throughL1({ answer: answerOf(), cwd, directory, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } }),
    (failure) => failure.code === NOT_STARTED && failure.message.includes(key),
  );
  assert.equal(seenIn(root), undefined, 'the stand-in agent ran');
  assert.deepEqual(eventsIn(state).filter((event) => event.event === 'dispatch.start'), []);
}

test('given an adapter whose env names a key gitEnvironment removes, roleDispatch rejects with NOT_STARTED naming the key, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);

  await assertRefused(placed, { env: { GIT_DIR: join(placed.directory, '.git') } }, 'GIT_DIR');
});

test('given an adapter whose env names, in another case, a key gitEnvironment removes, roleDispatch rejects with NOT_STARTED naming the key, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);

  await assertRefused(placed, { env: { git_index_file: join(placed.directory, 'index') } }, 'git_index_file');
});

test('given an adapter whose env names a key its own unset names, roleDispatch rejects with NOT_STARTED naming the key, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);

  await assertRefused(placed, { unset: ['STAND_IN_TMPDIR'], env: { STAND_IN_TMPDIR: join(placed.directory, '.stand-in-tmp') } }, 'STAND_IN_TMPDIR');
});

test('given an adapter whose env value is a path whose real path lies outside the dispatch\'s directory, roleDispatch rejects with NOT_STARTED naming the key, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  const outside = join(placed.root, 'outside');
  mkdirSync(outside);

  await assertRefused(placed, { env: { STAND_IN_TMPDIR: outside } }, 'STAND_IN_TMPDIR');
});

test('given an adapter whose env value is a path under the dispatch\'s directory that reaches outside it through a symbolic link, roleDispatch rejects with NOT_STARTED naming the key, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  const outside = join(placed.root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(placed.directory, 'link'));

  await assertRefused(placed, { env: { STAND_IN_TMPDIR: join(placed.directory, 'link', 'tmp') } }, 'STAND_IN_TMPDIR');
});

test('given an adapter whose env value is a path beside the dispatch\'s directory whose name begins with the directory\'s, roleDispatch rejects with NOT_STARTED naming the key, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);

  await assertRefused(placed, { env: { STAND_IN_TMPDIR: `${placed.directory}-beside` } }, 'STAND_IN_TMPDIR');
});

test('given an adapter whose env value is a relative path, roleDispatch rejects with NOT_STARTED naming the key, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);

  await assertRefused(placed, { env: { STAND_IN_TMPDIR: 'judge/.stand-in-tmp' } }, 'STAND_IN_TMPDIR');
});

test('given an adapter whose env value is a relative path naming the dispatch\'s directory from the root, roleDispatch rejects with NOT_STARTED naming the key, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);

  await assertRefused(placed, { env: { STAND_IN_TMPDIR: join(placed.directory, '.stand-in-tmp').slice(1) } }, 'STAND_IN_TMPDIR');
});

test('given an adapter whose env value is refused, the refusal names the key and not the value, which may be a credential', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, state, sink } = layout(t);
  const value = join(root, 'outside-c483-secret-value');
  const { adapter } = standIn('/usr/bin/true', { env: { STAND_IN_TOKEN: value } });

  await assert.rejects(
    throughL1({ answer: answerOf(), cwd, directory, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } }),
    (failure) => failure.code === NOT_STARTED && failure.message.includes('STAND_IN_TOKEN') && !failure.message.includes('c483-secret-value'),
  );
});

/**
 * A judge's layout whose dispatch's directory holds `link`, a symbolic link to `outside/`, a
 * directory beside it, as `outside`.
 */
function linkedOut(t) {
  const placed = layout(t);
  const outside = join(placed.root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(placed.directory, 'link'));
  return { ...placed, outside };
}

/** Asserts that `outside` is as empty as `linkedOut` made it: nothing was made there. */
const assertEmpty = (outside) => assert.deepEqual(readdirSync(outside), [], 'something was made outside the dispatch\'s directory');

test('given an adapter whose env value reaches a symbolic link out of the dispatch\'s directory after an absent directory and `..`, as `missing/../link/x`, roleDispatch rejects with NOT_STARTED naming the key, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = linkedOut(t);

  await assertRefused(placed, { env: { STAND_IN_TMPDIR: `${placed.directory}/missing/../link/x` } }, 'STAND_IN_TMPDIR');
  assertEmpty(placed.outside);
});

test('given an adapter whose env value reaches a symbolic link out of the dispatch\'s directory after two absent directories and two `..`, as `a/b/../../link/x`, roleDispatch rejects with NOT_STARTED naming the key, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = linkedOut(t);

  await assertRefused(placed, { env: { STAND_IN_TMPDIR: `${placed.directory}/a/b/../../link/x` } }, 'STAND_IN_TMPDIR');
  assertEmpty(placed.outside);
});

test('given an adapter whose env value goes through a symbolic link out of the dispatch\'s directory and then `..`, as `link/../y`, roleDispatch rejects with NOT_STARTED naming the key, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = linkedOut(t);

  await assertRefused(placed, { env: { STAND_IN_TMPDIR: `${placed.directory}/link/../y` } }, 'STAND_IN_TMPDIR');
  assertEmpty(placed.outside);
});

test('given an adapter whose env value is a path under the dispatch\'s directory that does not exist yet, roleDispatch admits it, resolving it through its nearest existing parent', async (t) => {
  const { directory, cwd, sink } = layout(t);
  const set = join(directory, 'not', 'yet', 'made');
  const { adapter } = standIn('/usr/bin/true', { env: { STAND_IN_TMPDIR: set } });

  const handed = await roleDispatch({ answer: answerOf(), cwd, directory, scratch: scratchOf(directory), repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.equal(handed.env.STAND_IN_TMPDIR, set);
  assert.equal(existsSync(join(directory, 'not')), false, 'roleDispatch made the path');
});

/** The one dispatch.start the stream in `state` holds. */
function startIn(state) {
  const starts = readEvents(state).filter((event) => event.event === 'dispatch.start');
  assert.equal(starts.length, 1, `the stream holds ${starts.length} dispatch.start events`);
  return starts[0];
}

/** A stand-in agent, run by `/bin/sh`, that runs `body` with `$here` naming `root`. */
function shellAgent(root, body) {
  return { command: '/bin/sh', args: [fixture(root, 'agent', body)] };
}

test('given a role dispatch through L1 whose working directory differs from its dispatch\'s directory, dispatch.start names the dispatch\'s directory, and the record entry while it runs carries the dispatch\'s directory', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, state, sink } = layout(t);
  const { command, args } = shellAgent(root, [': > "$here/ready"', 'while [ ! -f "$here/release" ]; do :; done'].join('\n'));
  const { adapter } = standIn(command, { args });

  const running = throughL1({ answer: answerOf(), cwd, directory, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } });
  await until(() => existsSync(join(root, 'ready')), t);
  const entries = readGroups(state);
  writeFileSync(join(root, 'release'), '');
  const result = await running;

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(startIn(state).workspace, directory);
  assert.deepEqual(entries.map((entry) => ({ dispatch: entry.dispatch, workspace: entry.workspace })), [{ dispatch: 'd-role', workspace: realpathSync.native(directory) }]);
});

test('given a role dispatch through L1 whose working directory differs from its dispatch\'s directory, a process the stand-in leaves working in a second directory under the dispatch\'s directory is not alive when the dispatch settles', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, state, sink } = layout(t);
  writeFileSync(join(root, 'hold'), '');
  const { command, args } = shellAgent(root, `${leaveWorking('judge/head', 'left')}\nexit 0`);
  const { adapter } = standIn(command, { args });

  const result = await throughL1({ answer: answerOf(), cwd, directory, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(alive(Number(read(root, 'left.pid'))), false, 'the process working in the second directory under the dispatch\'s directory is alive');
});

/** The SHA-256 digest of `text`'s UTF-8 bytes, in hexadecimal, as Node's own crypto computes it. */
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Runs a role dispatch through L1 of `answer`, whose stand-in agent exits 0, and hands back its dispatch.start. */
async function startOf(t, answer) {
  const { directory, cwd, state, sink } = layout(t);
  const { adapter } = standIn('/usr/bin/true');
  const result = await throughL1({ answer, cwd, directory, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } });
  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  return { start: startIn(state), state };
}

test('given a role dispatch through L1 whose role answer carries facts, dispatch.start carries those facts as L2 attached them', SETTLES_WITHIN, async (t) => {
  const facts = { card: 1412, revision: '2026-10-01T14:56:47Z', pullRequest: 503, base: 'ef60b49', head: '2241b82' };

  const { start } = await startOf(t, answerOf({ facts }));

  assert.deepEqual(start.facts, facts);
});

test('given a role answer whose facts name a card, an acceptance revision, a pull request number, and base and head SHAs, dispatch.start carries each of the five as the answer gave it', SETTLES_WITHIN, async (t) => {
  const facts = { card: 483, revision: '2026-10-02T21:00:00Z', pullRequest: 551, base: '4c8a740f00000000000000000000000000000000', head: '0123456789abcdef0123456789abcdef01234567' };

  const { start } = await startOf(t, answerOf({ facts }));

  assert.equal(start.facts.card, 483);
  assert.equal(start.facts.revision, '2026-10-02T21:00:00Z');
  assert.equal(start.facts.pullRequest, 551);
  assert.equal(start.facts.base, '4c8a740f00000000000000000000000000000000');
  assert.equal(start.facts.head, '0123456789abcdef0123456789abcdef01234567');
});

// proves R-EVIDENCE-5
test('dispatch.start carries a digest of the role answer\'s evidence alone, and not of its instruction', SETTLES_WITHIN, async (t) => {
  const { start } = await startOf(t, answerOf({ instruction: 'Judge it.\n', evidence: 'The diff.\n' }));

  assert.equal(start.digest, sha256('The diff.\n'));
  assert.notEqual(start.digest, sha256('Judge it.\nThe diff.\n'));
});

// proves R-EVIDENCE-5
test('given two role dispatches handed the same evidence and different instructions, their two dispatch.start events carry the same digest', SETTLES_WITHIN, async (t) => {
  const { start: one } = await startOf(t, answerOf({ role: 'reviewer', instruction: 'Review it.\n', evidence: 'The same evidence.\n' }));
  const { start: other } = await startOf(t, answerOf({ role: 'engineer', instruction: 'Judge it as an engineer.\n', evidence: 'The same evidence.\n' }));

  assert.equal(typeof one.digest, 'string');
  assert.equal(one.digest, other.digest);
});

// proves R-EVIDENCE-5
test('given two role dispatches handed evidence that differs in one byte, their two dispatch.start events carry different digests', SETTLES_WITHIN, async (t) => {
  const { start: one } = await startOf(t, answerOf({ evidence: 'The diff at head 2241b82.\n' }));
  const { start: other } = await startOf(t, answerOf({ evidence: 'The diff at head 2241b83.\n' }));

  assert.equal(typeof one.digest, 'string');
  assert.notEqual(one.digest, other.digest);
});

// proves R-EVIDENCE-5
test('no event in the stream holds the evidence itself, which a marker string in the evidence, absent from the whole stream, shows', SETTLES_WITHIN, async (t) => {
  const marker = 'c483-evidence-marker-7f3a9b';

  const { state } = await startOf(t, answerOf({ evidence: `The diff, holding ${marker}.\n` }));

  assert.ok(readEvents(state).some((event) => event.event === 'dispatch.end'), 'the stream holds no dispatch.end, so the dispatch was not recorded whole');
  assert.equal(readFileSync(streamPath(state), 'utf8').includes(marker), false, 'the stream holds the evidence');
});

// proves R-LOOP-15
test('given a role dispatch through L1 whose stand-in agent outlives its timeout, the dispatch\'s result never reads as success, and the stream holds a dispatch.timeout event under its id', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, state, sink } = layout(t);
  writeFileSync(join(root, 'hold'), '');
  const { command, args } = shellAgent(root, `exec ${TAIL}`);
  const { adapter } = standIn(command, { args });

  const running = throughL1({ answer: answerOf({ timeout: OUTLIVED }), cwd, directory, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } });
  // Where the assertion below fails, the test ends before this settles, and its teardown ends the
  // stand-in. The rejection that may follow is no longer this test's to report.
  running.catch(() => {});
  // The time L1 runs the role for is read off its start, before the dispatch settles, so a dispatch
  // given longer than the answer allows fails here on that assertion, not on the test's own bound.
  await until(() => eventsIn(state).some((event) => event.event === 'dispatch.start'), t);
  assert.equal(startIn(state).timeout, OUTLIVED, 'L1 runs the role for a time other than the one its answer allows');
  const result = await running;

  assert.equal(result.timedOut, true);
  assert.notEqual(result.exit, 0);
  assert.deepEqual(readEvents(state).filter((event) => event.event === 'dispatch.timeout').map(({ dispatch: id, timeout }) => ({ id, timeout })), [{ id: 'd-role', timeout: OUTLIVED }]);
});

/**
 * A stand-in provider adapter that records, at the moment `invocation` is asked, the `scratch` it
 * was handed and whether a directory was there, and answers `command` with `args` and the
 * environment `env(scratch)` builds from that path.
 */
function scratchReading(command, { args = [], env = () => ({}) } = {}) {
  const asked = [];
  return {
    asked,
    adapter: {
      name: 'stand-in',
      async invocation(request) {
        asked.push({ scratch: request.scratch, there: existsSync(request.scratch) && lstatSync(request.scratch).isDirectory(), holds: existsSync(request.scratch) ? readdirSync(request.scratch) : [] });
        return { command, args, input: Buffer.alloc(0), unset: [], env: env(request.scratch) };
      },
    },
  };
}

/** Every L1 workspace event the stream in `state` holds, as the fields a reader names it by. */
const scratchEventsIn = (state) => eventsIn(state)
  .filter((event) => event.layer === 'L1' && event.event.startsWith('workspace.'))
  .map(({ event, card, role, path }) => ({ event, card, role, path }));

test('roleDispatch makes <scratch>/<role> before it asks the adapter for the invocation, and hands the adapter that absolute path as scratch', async (t) => {
  const { directory, cwd, scratch: base, sink } = layout(t);
  const { adapter, asked } = scratchReading('/usr/bin/true');

  await roleDispatch({ answer: answerOf(), cwd, directory, scratch: base, repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.deepEqual(asked, [{ scratch: join(base, 'engineer'), there: true, holds: [] }]);
});

test('roleDispatch makes the scratch base and <scratch>/<role> where neither exists yet', async (t) => {
  const { root, directory, cwd, sink } = layout(t);
  const base = join(root, 'worktrees', 'scratch', 'rigger-42');
  const { adapter, asked } = scratchReading('/usr/bin/true');

  await roleDispatch({ answer: answerOf({ role: 'reviewer' }), cwd, directory, scratch: base, repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-role', card: 42, adapters: { 'stand-in': adapter } });

  assert.deepEqual(asked, [{ scratch: join(base, 'reviewer'), there: true, holds: [] }]);
});

test('given a scratch that is not an absolute path, roleDispatch rejects with NOT_STARTED naming scratch, and no process starts', SETTLES_WITHIN, async (t) => {
  for (const given of ['scratch/rigger-1412', '', 42]) {
    const { root, directory, cwd, state, sink } = layout(t);
    const { command, args } = agentIn(root);
    const { adapter, asked } = scratchReading(command, { args });

    await assert.rejects(
      throughL1({ answer: answerOf(), cwd, directory, scratch: given, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } }).then(() => assert.fail(`${given}: L1 settled`)),
      (failure) => failure.code === NOT_STARTED && /\bscratch\b/.test(failure.message),
    );
    assert.deepEqual(asked, [], `${given}: the adapter was asked for an invocation`);
    assert.equal(seenIn(root), undefined, `${given}: the stand-in agent ran`);
    assert.deepEqual(eventsIn(state).filter((event) => event.event === 'dispatch.start'), []);
  }
});

test('given no scratch at all, roleDispatch rejects with NOT_STARTED naming scratch, and asks the adapter for no invocation', async (t) => {
  const { directory, cwd, sink } = layout(t);
  const { adapter, asked } = scratchReading('/usr/bin/true');

  await assert.rejects(
    roleDispatch({ answer: answerOf(), cwd, directory, repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } }),
    (failure) => failure.code === NOT_STARTED && /\bscratch\b/.test(failure.message),
  );
  assert.deepEqual(asked, []);
});

test('given a directory already at <scratch>/<role> holding a file and a symbolic link to a file outside it, roleDispatch removes it first, the adapter finds it empty, and the file outside is byte-identical afterwards', async (t) => {
  const { root, directory, cwd, scratch: base, sink } = layout(t);
  const role = join(base, 'engineer');
  mkdirSync(join(role, 'deep'), { recursive: true });
  writeFileSync(join(role, 'deep', 'left.txt'), 'the first attempt\'s\n');
  const outside = join(root, 'outside.txt');
  writeFileSync(outside, 'not Rigger\'s\n');
  symlinkSync(outside, join(role, 'link'));
  symlinkSync(root, join(role, 'deep', 'up'));
  const { adapter, asked } = scratchReading('/usr/bin/true');

  await roleDispatch({ answer: answerOf(), cwd, directory, scratch: base, repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.deepEqual(asked, [{ scratch: role, there: true, holds: [] }]);
  assert.equal(readFileSync(outside, 'utf8'), 'not Rigger\'s\n');
  assert.ok(existsSync(join(root, 'judge', 'main')), 'the removal followed a link out of the scratch directory');
});

test('L1 records under the card the scratch directory it made, and the one it replaced, each carrying the role and the path', async (t) => {
  const { directory, cwd, scratch: base, state, sink } = layout(t);
  const { adapter } = scratchReading('/usr/bin/true');
  const role = join(base, 'engineer');

  await roleDispatch({ answer: answerOf(), cwd, directory, scratch: base, repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });
  await roleDispatch({ answer: answerOf(), cwd, directory, scratch: base, repository: repositoryOf(directory), reach: [], env: {}, sink, id: 'd-role-2', card: 1412, adapters: { 'stand-in': adapter } });

  assert.deepEqual(scratchEventsIn(state), [
    { event: 'workspace.made', card: 1412, role: 'engineer', path: role },
    { event: 'workspace.removed', card: 1412, role: 'engineer', path: role },
    { event: 'workspace.made', card: 1412, role: 'engineer', path: role },
  ]);
});

/**
 * Asserts that a role dispatch through L1 of role `engineer`, handed the scratch base `base`,
 * rejects with NOT_STARTED naming `path`, that the adapter was asked for no invocation, that the
 * stand-in agent never ran, and that L1 recorded no dispatch.start. Hands back the failure.
 */
async function assertScratchRefused({ root, directory, cwd, state, sink }, base, path) {
  const { command, args } = agentIn(root);
  const { adapter, asked } = scratchReading(command, { args });
  let failure;
  await throughL1({ answer: answerOf(), cwd, directory, scratch: base, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } })
    .then(() => assert.fail('L1 settled'), (thrown) => { failure = thrown; });
  assert.equal(failure.code, NOT_STARTED, failure.stack);
  assert.ok(failure.message.includes(path), `the failure does not name ${path}: ${failure.message}`);
  assert.deepEqual(asked, [], 'the adapter was asked for an invocation');
  assert.equal(seenIn(root), undefined, 'the stand-in agent ran');
  assert.deepEqual(eventsIn(state).filter((event) => event.event === 'dispatch.start'), []);
  return failure;
}

/** Every entry under `path`, not following links, with each file's bytes and each link's target. */
function contents(path) {
  const held = lstatSync(path);
  if (held.isSymbolicLink()) return { link: readlinkSync(path) };
  if (!held.isDirectory()) return { file: readFileSync(path, 'utf8'), mode: held.mode };
  return { mode: held.mode, entries: Object.fromEntries(readdirSync(path).sort().map((name) => [name, contents(join(path, name))])) };
}

test('given a symbolic link at <root>/scratch or at <root>/scratch/<topic>, roleDispatch rejects with NOT_STARTED naming the link, starts no process, and the link and what it points at are unchanged', SETTLES_WITHIN, async (t) => {
  for (const linked of [['scratch'], ['scratch', 'rigger-1412']]) {
    const placed = layout(t);
    const top = join(placed.root, 'worktrees');
    const elsewhere = join(placed.root, 'elsewhere');
    mkdirSync(join(elsewhere, 'engineer'), { recursive: true });
    writeFileSync(join(elsewhere, 'engineer', 'kept.txt'), 'not Rigger\'s\n');
    const link = join(top, ...linked);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(elsewhere, link);
    if (linked.length === 1) mkdirSync(join(elsewhere, 'rigger-1412', 'engineer'), { recursive: true });
    const before = [contents(top), contents(elsewhere)];

    await assertScratchRefused(placed, join(top, 'scratch', 'rigger-1412'), link);

    assert.deepEqual([contents(top), contents(elsewhere)], before, `${link}: something changed`);
  }
});

test('given a worktree of the repository registered at <scratch>/<role> or inside it, roleDispatch rejects with NOT_STARTED naming the path, starts no process, and that worktree\'s files and branch are unchanged', SETTLES_WITHIN, async (t) => {
  for (const under of [[], ['deep', 'tree']]) {
    const placed = layout(t);
    const repository = repositoryAt(join(placed.root, 'repository'), { 'kept.txt': 'committed\n' });
    const path = join(placed.scratch, 'engineer');
    const tree = worktreeAt(repository, join(path, ...under), 'held');
    writeFileSync(join(tree, 'uncommitted.txt'), 'the agent\'s\n');
    const branch = gitIn(repository, 'rev-parse', 'refs/heads/held');
    const before = { files: contents(tree), list: worktreeList(repository) };

    await assertScratchRefused(placed, placed.scratch, path);

    assert.deepEqual({ files: contents(tree), list: worktreeList(repository) }, before, `${tree}: something changed`);
    assert.equal(gitIn(repository, 'rev-parse', 'refs/heads/held'), branch);
  }
});

test('given a file, a symbolic link to a directory, or a symbolic link to nothing at <scratch>/<role>, roleDispatch rejects with NOT_STARTED naming the path, starts no process, and the path is unchanged', SETTLES_WITHIN, async (t) => {
  for (const put of [
    (path) => writeFileSync(path, 'not a directory\n'),
    (path, root) => symlinkSync(join(root, 'judge'), path),
    (path, root) => symlinkSync(join(root, 'nowhere'), path),
  ]) {
    const placed = layout(t);
    const path = join(placed.scratch, 'engineer');
    put(path, placed.root);
    const before = [contents(placed.scratch), contents(placed.directory)];

    await assertScratchRefused(placed, placed.scratch, path);

    assert.deepEqual([contents(placed.scratch), contents(placed.directory)], before);
  }
});

test('given a <scratch>/<role> whose real path cannot be resolved, roleDispatch rejects with NOT_STARTED naming the path, starts no process, and changes nothing', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  const path = join(placed.scratch, 'engineer');
  mkdirSync(path);
  writeFileSync(join(path, 'left.txt'), 'the first attempt\'s\n');
  chmodSync(placed.scratch, 0o000);
  t.after(() => chmodSync(placed.scratch, 0o700));

  await assertScratchRefused(placed, placed.scratch, path);

  assert.equal(lstatSync(placed.scratch).mode & 0o7777, 0o000, 'the scratch base\'s mode changed');
  chmodSync(placed.scratch, 0o700);
  assert.deepEqual(readdirSync(path), ['left.txt']);
  assert.equal(readFileSync(join(path, 'left.txt'), 'utf8'), 'the first attempt\'s\n');
});

/**
 * Every entry under `path` with its mode, not following links, as `lstat` reads it; a directory
 * that cannot be read is recorded as such, with nothing under it read.
 */
function modes(path) {
  const held = lstatSync(path);
  if (!held.isDirectory()) return { mode: held.mode };
  let names;
  try {
    names = readdirSync(path).sort();
  } catch (error) {
    return { mode: held.mode, unreadable: error.code };
  }
  return { mode: held.mode, entries: Object.fromEntries(names.map((name) => [name, modes(join(path, name))])) };
}

test('given a worktree of another repository at <scratch>/<role> holding a directory of mode 000 that sorts before .git, or one holding such a worktree, roleDispatch rejects with NOT_STARTED naming the unreadable directory, and every mode and entry is unchanged', SETTLES_WITHIN, async (t) => {
  for (const at of ['worktree holding it', 'it holding the worktree']) {
    const placed = layout(t);
    const repository = repositoryAt(join(placed.root, 'another-repository'), { 'kept.txt': 'committed\n' });
    const path = join(placed.scratch, 'engineer');
    const locked = at === 'worktree holding it' ? join(path, '.a-locked') : join(path, 'locked');
    const tree = worktreeAt(repository, at === 'worktree holding it' ? path : join(locked, 'tree'), 'held');
    mkdirSync(locked, { recursive: true });
    writeFileSync(join(locked, 'inside.txt'), 'unread\n');
    chmodSync(locked, 0o000);
    t.after(() => chmodSync(locked, 0o700));
    const before = { modes: modes(path), list: worktreeList(repository) };

    await assertScratchRefused(placed, placed.scratch, locked);

    assert.deepEqual({ modes: modes(path), list: worktreeList(repository) }, before, `${at}: something changed`);
    chmodSync(locked, 0o700);
    assert.equal(readFileSync(join(locked, 'inside.txt'), 'utf8'), 'unread\n');
    assert.ok(existsSync(join(tree, 'kept.txt')), `${at}: the worktree lost its file`);
  }
});

test('L1 records under the card a scratch directory it could not make, carrying the role, the path and why', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  const path = join(placed.scratch, 'engineer');
  writeFileSync(path, 'not a directory\n');

  const failure = await assertScratchRefused(placed, placed.scratch, path);

  const failed = eventsIn(placed.state).filter((event) => event.event === 'workspace.failed');
  assert.deepEqual(failed.map(({ layer, card, role, path: at }) => ({ layer, card, role, path: at })), [{ layer: 'L1', card: 1412, role: 'engineer', path }]);
  assert.ok(failure.message.includes(failed[0].reason), `the failure does not carry the reason L1 recorded: ${failure.message}`);
});

/** `sink`, refusing every append of `refused` and passing every other on. */
const refusing = (sink, refused) => ({
  emitter: (context) => {
    const inner = sink.emitter(context);
    return {
      emit: (event, fields) => {
        if (event === refused) throw new Error(`the sink refuses ${event}`);
        inner.emit(event, fields);
      },
    };
  },
});

test('a refused workspace.made, workspace.removed or workspace.failed while roleDispatch makes a scratch directory rejects as a refused event naming it, and asks the adapter for no invocation', async (t) => {
  for (const event of ['workspace.made', 'workspace.removed', 'workspace.failed']) {
    const { directory, cwd, scratch: base, sink } = layout(t);
    if (event === 'workspace.removed') mkdirSync(join(base, 'engineer'));
    if (event === 'workspace.failed') writeFileSync(join(base, 'engineer'), 'not a directory\n');
    const { adapter, asked } = scratchReading('/usr/bin/true');
    let failure;
    await roleDispatch({ answer: answerOf(), cwd, directory, scratch: base, repository: repositoryOf(directory), reach: [], env: {}, sink: refusing(sink, event), id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } })
      .then(() => assert.fail(`${event}: roleDispatch settled`), (thrown) => { failure = thrown; });
    assert.equal(failure.code, EVENT_REFUSED, `${event}: ${failure.stack}`);
    assert.ok(failure.message.includes(event), `${event}: ${failure.message}`);
    assert.deepEqual(asked, [], `${event}: the adapter was asked for an invocation`);
  }
});

// The ruling 18 case: an adapter keeps what its CLI writes, which belongs in no worktree, in the scratch directory.
test('given a role dispatch through L1 whose adapter\'s env sets a variable to a path under the scratch directory, roleDispatch admits it, and the stand-in agent reads that variable and finds that path', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, scratch: base, state, sink } = layout(t);
  const { command, args } = agentIn(root);
  const { adapter } = scratchReading(command, { args, env: (scratchDirectory) => ({ STAND_IN_HOME: join(scratchDirectory, 'home') }) });

  const result = await throughL1({ answer: answerOf(), cwd, directory, scratch: base, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(seenIn(root).env.STAND_IN_HOME, join(base, 'engineer', 'home'));
});

/**
 * Asserts that a role dispatch through L1 whose stand-in adapter sets STAND_IN_HOME to what
 * `value(scratch)` answers for the scratch directory it is handed rejects with NOT_STARTED naming
 * the key and not the value, and that nothing ran or started.
 */
async function assertScratchValueRefused(placed, value) {
  const { root, directory, cwd, scratch: base, state, sink } = placed;
  const { command, args } = agentIn(root);
  const given = [];
  const { adapter } = scratchReading(command, { args, env: (scratchDirectory) => { given.push(value(scratchDirectory)); return { STAND_IN_HOME: given.at(-1) }; } });
  let failure;
  await throughL1({ answer: answerOf(), cwd, directory, scratch: base, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } })
    .then(() => assert.fail('L1 settled'), (thrown) => { failure = thrown; });
  assert.equal(failure.code, NOT_STARTED, failure.stack);
  assert.ok(failure.message.includes('STAND_IN_HOME'), failure.message);
  assert.equal(given.length, 1, 'the adapter was not asked once');
  assert.equal(failure.message.includes(given[0]), false, `the failure names the value: ${failure.message}`);
  assert.equal(seenIn(root), undefined, 'the stand-in agent ran');
  assert.deepEqual(eventsIn(state).filter((event) => event.event === 'dispatch.start'), []);
}

test('given an adapter whose env sets a variable to a path under the scratch directory that reaches outside it through a symbolic link, roleDispatch rejects with NOT_STARTED naming the key and not the value, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  const outside = join(placed.root, 'outside');
  mkdirSync(outside);

  await assertScratchValueRefused(placed, (scratchDirectory) => {
    symlinkSync(outside, join(scratchDirectory, 'link'));
    return join(scratchDirectory, 'link', 'home');
  });
  assert.deepEqual(readdirSync(outside), []);
});

test('given an adapter whose env sets a variable to a path beside the scratch directory whose name begins with the scratch directory\'s, roleDispatch rejects with NOT_STARTED naming the key and not the value, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);

  await assertScratchValueRefused(placed, (scratchDirectory) => `${scratchDirectory}-beside`);
});

test('given an adapter whose env sets a variable to the scratch base, above the role\'s scratch directory, roleDispatch rejects with NOT_STARTED naming the key and not the value, and no process starts', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);

  await assertScratchValueRefused(placed, (scratchDirectory) => join(dirname(scratchDirectory), 'reviewer'));
});

/** The device and inode of the directory at `path`'s real path, as decimal strings. */
function identity(path) {
  const { dev, ino } = statSync(realpathSync.native(path), { bigint: true });
  return { device: String(dev), inode: String(ino) };
}

test('while a role dispatch through L1 runs, its record entry carries its scratch directory\'s real path, device and inode beside the dispatch\'s directory', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, scratch: base, state, sink } = layout(t);
  const { command, args } = shellAgent(root, [': > "$here/ready"', 'while [ ! -f "$here/release" ]; do :; done'].join('\n'));
  const { adapter } = standIn(command, { args });

  const running = throughL1({ answer: answerOf(), cwd, directory, scratch: base, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } });
  await until(() => existsSync(join(root, 'ready')), t);
  const entries = readGroups(state);
  const held = identity(join(base, 'engineer'));
  writeFileSync(join(root, 'release'), '');
  const result = await running;

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.deepEqual(entries.map(({ dispatch: id, workspace, scratch: recorded }) => ({ id, workspace, scratch: recorded })), [
    { id: 'd-role', workspace: realpathSync.native(directory), scratch: { path: realpathSync.native(join(base, 'engineer')), ...held } },
  ]);
});

test('while a step\'s dispatch through L1 runs, its record entry records no scratch directory', SETTLES_WITHIN, async (t) => {
  const { root, directory, state, sink } = layout(t);
  const body = fixture(root, 'step', [': > "$here/ready"', 'while [ ! -f "$here/release" ]; do :; done'].join('\n'));

  const running = dispatch({ id: 'd-step', card: 1412, directory: state, sink, ...stepDispatch({ run: `/bin/sh '${body}'` }, directory, {}) });
  await until(() => existsSync(join(root, 'ready')), t);
  const entries = readGroups(state);
  writeFileSync(join(root, 'release'), '');
  const result = await running;

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  assert.equal(entries.length, 1);
  assert.equal(Object.hasOwn(entries[0], 'scratch'), false, `the step's entry records a scratch directory: ${JSON.stringify(entries[0])}`);
  assert.equal(typeof entries[0].workspace, 'string', 'the step\'s entry records no directory, so the test proves nothing');
});

// proves R-STATE-17
test('given a role dispatch through L1 whose stand-in agent leaves a process outside its group working in the scratch directory, that process is not alive when the dispatch settles, and its kill is recorded under the dispatch\'s id and card', SETTLES_WITHIN, async (t) => {
  const { root, directory, cwd, scratch: base, state, sink } = layout(t);
  writeFileSync(join(root, 'hold'), '');
  const { command, args } = shellAgent(root, `${leaveWorking('scratch/rigger-1412/engineer/work', 'left')}\nexit 0`);
  const { adapter } = standIn(command, { args });

  const result = await throughL1({ answer: answerOf(), cwd, directory, scratch: base, reach: [], env: {}, sink, state, adapters: { 'stand-in': adapter } });

  assert.equal(result.exit, 0, result.stderr.toString('utf8'));
  const left = Number(read(root, 'left.pid'));
  assert.equal(alive(left), false, 'the process working in the scratch directory is alive');
  const kills = readEvents(state).filter((event) => event.layer === 'L0' && event.pid === left);
  assert.deepEqual(kills.map(({ event, dispatch: id, card, directory: swept }) => ({ event, id, card, swept })), [
    { event: 'survivor.killed', id: 'd-role', card: 1412, swept: realpathSync.native(join(base, 'engineer')) },
  ]);
});

test('the Claude Code adapter answers the same invocation with a scratch directory given as without it', async (t) => {
  const { cwd, scratch: base, sink } = layout(t);
  mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true });
  const agent = join(cwd, '.claude', 'agents', 'engineer.md');
  writeFileSync(agent, '---\nname: engineer\n---\n\n# Engineer\n');
  const request = { agent, tier: 'standard', prompt: 'the prompt', directory: cwd, reach: [], emitter: sink.emitter({ layer: 'L0', card: 1412, dispatch: 'd-role' }) };

  const without = await ADAPTERS.claude.invocation(request);
  const given = await ADAPTERS.claude.invocation({ ...request, scratch: join(base, 'engineer') });

  assert.deepEqual(given, without);
});

test('given a worktree of the repository whose .git entry has been moved out of it, registered at <scratch>/<role> or inside it, roleDispatch rejects with NOT_STARTED naming the path and the worktree, starts no process, and the worktree\'s files, its registration and its branch are unchanged', SETTLES_WITHIN, async (t) => {
  for (const under of [[], ['deep', 'tree']]) {
    const placed = layout(t);
    repositoryAt(placed.repository, { 'kept.txt': 'committed\n' });
    const path = join(placed.scratch, 'engineer');
    const tree = worktreeAt(placed.repository, join(path, ...under), 'held');
    writeFileSync(join(tree, 'uncommitted.txt'), 'the agent\'s\n');
    renameSync(join(tree, '.git'), join(placed.root, 'moved-git'));
    const branch = gitIn(placed.repository, 'rev-parse', 'refs/heads/held');
    const before = { files: contents(tree), list: worktreeList(placed.repository) };

    const failure = await assertScratchRefused(placed, placed.scratch, path);

    assert.ok(failure.message.includes(tree), `the failure does not name the worktree ${tree}: ${failure.message}`);
    assert.deepEqual({ files: contents(tree), list: worktreeList(placed.repository) }, before, `${tree}: something changed`);
    assert.equal(gitIn(placed.repository, 'rev-parse', 'refs/heads/held'), branch);
  }
});

test('given a worktree of the repository registered at a path whose real path cannot be resolved for a reason other than its absence, roleDispatch rejects with NOT_STARTED naming that worktree, and the directory at <scratch>/<role> is unchanged', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  repositoryAt(placed.repository, { 'kept.txt': 'committed\n' });
  const locked = join(placed.root, 'locked');
  const tree = worktreeAt(placed.repository, join(locked, 'tree'), 'held');
  chmodSync(locked, 0o000);
  t.after(() => chmodSync(locked, 0o700));
  const path = join(placed.scratch, 'engineer');
  mkdirSync(path);
  writeFileSync(join(path, 'left.txt'), 'the first attempt\'s\n');
  const before = contents(path);

  const failure = await assertScratchRefused(placed, placed.scratch, path);

  assert.ok(failure.message.includes(tree), `the failure does not name the worktree ${tree}: ${failure.message}`);
  assert.deepEqual(contents(path), before);
});

test('given a worktree of the repository registered inside <scratch>/<role> whose directory is gone, roleDispatch takes it to lie nowhere, and replaces the scratch directory', async (t) => {
  const { directory, cwd, scratch: base, repository, sink } = layout(t);
  repositoryAt(repository, { 'kept.txt': 'committed\n' });
  const path = join(base, 'engineer');
  const tree = worktreeAt(repository, join(path, 'gone'), 'held');
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path);
  assert.ok(worktreeList(repository).includes(tree), 'git no longer lists the worktree, so the test proves nothing');
  const { adapter, asked } = scratchReading('/usr/bin/true');

  await roleDispatch({ answer: answerOf(), cwd, directory, scratch: base, repository, reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.deepEqual(asked, [{ scratch: path, there: true, holds: [] }]);
});

test('given a worktree of another repository, which the repository\'s git does not list, at <scratch>/<role>, roleDispatch rejects with NOT_STARTED naming the path, starts no process, and the worktree\'s files and branch are unchanged', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  const another = repositoryAt(join(placed.root, 'another-repository'), { 'kept.txt': 'committed\n' });
  const path = join(placed.scratch, 'engineer');
  const tree = worktreeAt(another, path, 'held');
  writeFileSync(join(tree, 'uncommitted.txt'), 'the agent\'s\n');
  const branch = gitIn(another, 'rev-parse', 'refs/heads/held');
  const before = { files: contents(tree), list: worktreeList(another) };
  assert.equal(worktreeList(placed.repository).includes(tree), false, 'the repository\'s git lists the worktree, so the test proves nothing');

  await assertScratchRefused(placed, placed.scratch, path);

  assert.deepEqual({ files: contents(tree), list: worktreeList(another) }, before);
  assert.equal(gitIn(another, 'rev-parse', 'refs/heads/held'), branch);
});

/**
 * Asserts that a role dispatch through L1 handed the scratch base `base` rejects with NOT_STARTED
 * naming `<base>/engineer` and the worktree `tree`, and that nothing under `tree` changed, as
 * `before` held it, and no `<base>/engineer` was made.
 */
async function assertInsideRefused(placed, base, tree) {
  const before = contents(tree);
  const failure = await assertScratchRefused(placed, base, join(base, 'engineer'));
  assert.ok(failure.message.includes(tree), `the failure does not name the worktree ${tree}: ${failure.message}`);
  assert.deepEqual(contents(tree), before, `${tree}: something changed`);
  assert.equal(existsSync(join(base, 'engineer')), false, 'L1 made the scratch directory inside the worktree');
}

test('given a scratch base that is a registered worktree of the repository, holding a staged file, roleDispatch rejects with NOT_STARTED naming the scratch directory and the worktree, and changes nothing', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  repositoryAt(placed.repository, { 'kept.txt': 'committed\n' });
  const tree = worktreeAt(placed.repository, join(placed.root, 'tree'), 'held');
  mkdirSync(join(tree, 'engineer'));
  writeFileSync(join(tree, 'engineer', 'staged.txt'), 'staged\n');
  gitIn(tree, 'add', 'engineer/staged.txt');

  await assertScratchRefused(placed, tree, join(tree, 'engineer')).then((failure) => assert.ok(failure.message.includes(tree), failure.message));

  assert.equal(readFileSync(join(tree, 'engineer', 'staged.txt'), 'utf8'), 'staged\n');
  assert.match(gitIn(tree, 'status', '--porcelain'), /^A {2}engineer\/staged\.txt$/m);
});

test('given a scratch base lying inside a registered worktree of the repository, not yet made, roleDispatch rejects with NOT_STARTED naming the scratch directory and the worktree, and makes nothing there', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  repositoryAt(placed.repository, { 'kept.txt': 'committed\n' });
  const tree = worktreeAt(placed.repository, join(placed.root, 'tree'), 'held');

  await assertInsideRefused(placed, join(tree, 'scratch', 'rigger-1412'), tree);
});

test('given a scratch base lying inside the repository\'s main working tree, roleDispatch rejects with NOT_STARTED naming the scratch directory and the main working tree, and makes nothing there', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  repositoryAt(placed.repository, { 'kept.txt': 'committed\n' });

  await assertInsideRefused(placed, join(placed.repository, 'scratch', 'rigger-1412'), placed.repository);
});
