// ABOUTME: Tests L1's role runner: what `roleDispatch` hands L1's `dispatch` for a role's answer,
// through the provider adapter the answer names, and what L1 records of the dispatch it runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * A judge's layout in a scratch directory: the dispatch's directory `judge/`, its working
 * directory `judge/main/` and its reached directory `judge/head/`, and the state directory
 * `.rigger/` beside them, with a sink open on it.
 */
function layout(t) {
  const root = scratch(t);
  const directory = join(root, 'judge');
  const cwd = join(directory, 'main');
  const head = join(directory, 'head');
  for (const each of [cwd, head]) mkdirSync(each, { recursive: true });
  const state = join(root, '.rigger');
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return { root, directory, cwd, head, state, sink };
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
  const handed = await roleDispatch({ sink, id: 'd-role', card: 1412, ...request });
  return dispatch({ id: 'd-role', card: 1412, directory: state, sink, ...handed });
}

/** Every event the stream in `state` holds, or none where nothing was recorded. */
const eventsIn = (state) => (existsSync(state) ? readEvents(state) : []);

test('roleDispatch answers what L1\'s dispatch is handed: the command, arguments and standard input the adapter answered, the working directory, the dispatch\'s directory, the environment and the timeout', async (t) => {
  const { directory, cwd, head, sink } = layout(t);
  const { adapter } = standIn('/usr/bin/true', { args: ['--stand-in'] });

  const handed = await roleDispatch({ answer: answerOf(), cwd, directory, reach: [head], env: { KEEP: 'kept' }, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.deepEqual(
    { command: handed.command, args: handed.args, input: handed.input.toString('utf8'), cwd: handed.cwd, workspace: handed.workspace, env: handed.env, timeout: handed.timeout },
    { command: '/usr/bin/true', args: ['--stand-in'], input: 'Make the change card #1412 asks for.\nCard #1412: the acceptance.\n', cwd, workspace: directory, env: { KEEP: 'kept' }, timeout: 60_000 },
  );
});

test('roleDispatch asks the module the role answer\'s provider names in the adapter map for the invocation, and no other', async (t) => {
  const { directory, cwd, sink } = layout(t);
  const named = standIn('/usr/bin/true');
  const other = standIn('/usr/bin/false');

  const handed = await roleDispatch({ answer: answerOf({ provider: 'named' }), cwd, directory, reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { other: other.adapter, named: named.adapter } });

  assert.equal(handed.command, '/usr/bin/true');
  assert.equal(named.requests.length, 1);
  assert.equal(other.requests.length, 0);
});

test('roleDispatch reads the adapter map L0 holds where its caller gives none, so a role answer naming `claude` is answered by the Claude Code adapter', async (t) => {
  const { directory, cwd, sink } = layout(t);

  const handed = await roleDispatch({ answer: answerOf({ provider: 'claude' }), cwd, directory, reach: [], env: {}, sink, id: 'd-role', card: 1412 });

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

  await roleDispatch({ answer: answerOf(), cwd, directory, reach, env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.equal(requests[0].reach, reach);
  assert.deepEqual(requests[0].reach, [head]);
});

test('the agent path roleDispatch hands the adapter is the role\'s agent file joined under the working directory, as an absolute path', async (t) => {
  const { directory, cwd, sink } = layout(t);
  const { adapter, requests } = standIn('/usr/bin/true');

  await roleDispatch({ answer: answerOf({ agent: '.claude/agents/reviewer.md' }), cwd, directory, reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

  assert.equal(requests[0].agent, `${cwd}/.claude/agents/reviewer.md`);
});

test('the timeout roleDispatch answers is the role answer\'s timeout', async (t) => {
  const { directory, cwd, sink } = layout(t);
  const { adapter } = standIn('/usr/bin/true');

  const handed = await roleDispatch({ answer: answerOf({ timeout: 14_400_000 }), cwd, directory, reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

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

  const handed = await roleDispatch({ answer: answerOf(), cwd, directory, reach: [], env: {}, sink, id: 'd-probe', card: 1412, adapters: { 'stand-in': adapter } });

  assert.equal(handed.command, '/usr/bin/true');
  assert.deepEqual(readEvents(state).map(({ layer, event, dispatch: id, card }) => ({ layer, event, id, card })), [{ layer: 'L0', event: 'probe.ran', id: 'd-probe', card: 1412 }]);
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

  const handed = await roleDispatch({ answer: answerOf(), cwd, directory, reach: [], env: { STAND_IN_TMPDIR: '/handed/value', UNINHERITED: 'dropped', GIT_DIR: '/elsewhere/.git', KEEP: 'kept' }, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

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

  const handed = await roleDispatch({ answer: answerOf(), cwd, directory, reach: [], env: {}, sink, id: 'd-role', card: 1412, adapters: { 'stand-in': adapter } });

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
