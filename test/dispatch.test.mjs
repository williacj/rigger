// ABOUTME: Tests L1's dispatching function in its minimal form: it writes each dispatch's process
// group to the record in the state directory while the dispatch runs, and removes it after.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openSink } from '../src/observation/sink.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { alive, fixture, read, scratch } from './process-fixtures.mjs';

// A bound on the test alone, so that a dispatch which never settles fails here rather than
// holding the suite: nothing waits on it when the dispatch settles.
const SETTLES_WITHIN = { timeout: 20_000 };

/** Settles once `condition` holds, checked once per turn of the event loop. */
async function until(condition) {
  while (!condition()) await new Promise((resolve) => setImmediate(resolve));
}

/** The state directory a test's dispatches name: `.rigger/` in the scratch directory. */
const stateOf = (directory) => join(directory, '.rigger');

/**
 * A command that writes its process group, which is its own pid as the group's leader, to
 * `$here/group`, then runs until the test writes `$here/release`.
 */
const holdingCommand = (directory) => fixture(directory, 'command', [
  'echo $$ > "$here/group.tmp" && /bin/mv "$here/group.tmp" "$here/group"',
  'while [ ! -f "$here/release" ]; do :; done',
].join('\n'));

/** Starts a dispatch of `command` through L1's function, with the state directory in `directory`. */
function dispatchIn(directory, options) {
  const state = stateOf(directory);
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return dispatch({ directory: state, sink, args: [], cwd: directory, env: {}, ...options });
}

/**
 * The record as a second process reads it from `state`: a Node process of its own, which imports
 * nothing of this one's.
 */
function readInAnotherProcess(state) {
  const groups = new URL('../src/execution/groups.mjs', import.meta.url).href;
  const code = `const { readGroups } = await import(${JSON.stringify(groups)}); process.stdout.write(JSON.stringify(readGroups(${JSON.stringify(state)})));`;
  const read = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(read.status, 0, read.stderr);
  return JSON.parse(read.stdout);
}

/**
 * Starts a dispatch of the holding command, waits until it runs, hands `whileRunning` the group it
 * reported, then releases it and answers what the dispatch settled on.
 */
async function whileHeld(t, options, whileRunning) {
  const directory = scratch(t);
  const command = holdingCommand(directory);
  const settled = dispatchIn(directory, { command, ...options });
  await until(() => existsSync(join(directory, 'group')));
  await whileRunning({ directory, state: stateOf(directory), group: Number(read(directory, 'group')) });
  writeFileSync(join(directory, 'release'), '');
  return { directory, result: await settled };
}

test('while a dispatch runs, a second process reading the state directory finds its process group in the record', SETTLES_WITHIN, async (t) => {
  await whileHeld(t, { id: 'd-1', card: 1412 }, ({ state, group }) => {
    assert.deepEqual(readInAnotherProcess(state).map((entry) => entry.group), [group]);
  });
});

test('while a dispatch runs, its record entry carries the dispatch id it was handed', SETTLES_WITHIN, async (t) => {
  await whileHeld(t, { id: 'd-7f3a', card: 1412 }, ({ state, group }) => {
    assert.deepEqual(readInAnotherProcess(state).filter((entry) => entry.group === group).map((entry) => entry.dispatch), ['d-7f3a']);
  });
});

test('while a dispatch with a card runs, its record entry carries that card', SETTLES_WITHIN, async (t) => {
  await whileHeld(t, { id: 'd-1', card: 1412 }, ({ state, group }) => {
    assert.deepEqual(readInAnotherProcess(state).filter((entry) => entry.group === group).map((entry) => entry.card), [1412]);
  });
});

test('while a dispatch with no card runs, its record entry carries its dispatch id and no card', SETTLES_WITHIN, async (t) => {
  await whileHeld(t, { id: 'd-report' }, ({ state, group }) => {
    assert.deepEqual(readInAnotherProcess(state), [{ group, dispatch: 'd-report' }]);
  });
});

test('once a dispatch has settled and its group holds no live process, the record no longer holds that group', SETTLES_WITHIN, async (t) => {
  let recorded;
  const { directory } = await whileHeld(t, { id: 'd-1', card: 1412 }, ({ state, group }) => {
    recorded = group;
    assert.deepEqual(readInAnotherProcess(state).map((entry) => entry.group), [group], 'the group was recorded while it ran');
  });

  assert.equal(alive(-recorded), false, 'a process of the dispatch\'s group is alive');
  assert.deepEqual(readInAnotherProcess(stateOf(directory)).filter((entry) => entry.group === recorded), []);
});

test('a call to L1\'s function with no dispatch id starts no process, and fails naming the missing id', async (t) => {
  const directory = scratch(t);
  const command = fixture(directory, 'command', ': > "$here/started"');

  await assert.rejects(dispatchIn(directory, { command, card: 1412 }), /dispatch id/);

  assert.equal(existsSync(join(directory, 'started')), false, 'the command ran');
});
