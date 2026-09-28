// ABOUTME: Tests L1's dispatching function in its minimal form: it writes each dispatch's process
// group to the record in the state directory while the dispatch runs, and removes it after.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, relative } from 'node:path';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { EVENT_REFUSED, runCommand } from '../src/substrate/process.mjs';
import { alive, fixture, read, running, scratch } from './process-fixtures.mjs';

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
 * Starts the holding command in `directory` through `start`, a dispatch by default, waits until it
 * runs, hands `whileRunning` the group it reported, then releases it and answers what the call
 * settled on.
 */
async function whileHeld(directory, options, whileRunning, start = dispatchIn) {
  const settled = start(directory, { command: holdingCommand(directory), ...options });
  await until(() => existsSync(join(directory, 'group')));
  await whileRunning(Number(read(directory, 'group')));
  writeFileSync(join(directory, 'release'), '');
  return settled;
}

test('while a dispatch runs, a second process reading the state directory finds its process group in the record', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  await whileHeld(directory, { id: 'd-1', card: 1412 }, (group) => {
    assert.deepEqual(readInAnotherProcess(stateOf(directory)).map((entry) => entry.group), [group]);
  });
});

test('while a dispatch runs, its record entry carries the dispatch id it was handed', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  await whileHeld(directory, { id: 'd-7f3a', card: 1412 }, (group) => {
    assert.deepEqual(readInAnotherProcess(stateOf(directory)).filter((entry) => entry.group === group).map((entry) => entry.dispatch), ['d-7f3a']);
  });
});

test('while a dispatch with a card runs, its record entry carries that card', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  await whileHeld(directory, { id: 'd-1', card: 1412 }, (group) => {
    assert.deepEqual(readInAnotherProcess(stateOf(directory)).filter((entry) => entry.group === group).map((entry) => entry.card), [1412]);
  });
});

test('while a dispatch with no card runs, its record entry carries its dispatch id and no card', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  await whileHeld(directory, { id: 'd-report' }, (group) => {
    assert.deepEqual(readInAnotherProcess(stateOf(directory)), [{ group, dispatch: 'd-report' }]);
  });
});

test('once a dispatch has settled and its group holds no live process, the record no longer holds that group', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  let recorded;
  await whileHeld(directory, { id: 'd-1', card: 1412 }, (group) => {
    recorded = group;
    assert.deepEqual(readInAnotherProcess(stateOf(directory)).map((entry) => entry.group), [group], 'the group was recorded while it ran');
  });

  assert.equal(alive(-recorded), false, 'a process of the dispatch\'s group is alive');
  assert.deepEqual(readInAnotherProcess(stateOf(directory)).filter((entry) => entry.group === recorded), []);
});

test('once a dispatch whose kill event the sink refused has settled, its group holds no live process, the record no longer holds that group, and the caller hears the refusal', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  writeFileSync(join(directory, 'hold'), '');
  // The command leaves a `tail` alive in its group, so L0 kills it and records the kill, which a
  // sink under a regular file refuses. The record stays in the state directory, which takes writes.
  const command = fixture(directory, 'command', [
    'echo $$ > "$here/group"',
    '/usr/bin/tail -f "$here/hold" &',
    'while ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -q "^tail"; do :; done',
  ].join('\n'));
  writeFileSync(join(directory, 'blocked'), '');
  const sink = openSink({ directory: join(directory, 'blocked', 'state'), run: 'r-test', now: () => 0 });

  await assert.rejects(dispatchIn(directory, { id: 'd-1', card: 1412, command, sink }), (failure) => failure.code === EVENT_REFUSED);

  const group = Number(read(directory, 'group'));
  assert.equal(alive(-group), false, 'a process of the dispatch\'s group is alive');
  assert.deepEqual(readInAnotherProcess(stateOf(directory)).filter((entry) => entry.group === group), []);
});

/** A command whose first action writes `$here/started`. */
const startingCommand = (directory) => fixture(directory, 'command', ': > "$here/started"');

/**
 * Asserts that the command `startingCommand` wrote into `directory` never ran. Node's `spawn`
 * returns only once the child runs the command, so a command started before this is either still
 * running, with the directory in its command line, or has written `$here/started`. The two are
 * read in that order, so a command that ends between them is caught by the second.
 */
function assertNeverRan(directory) {
  assert.deepEqual(running(directory), [], 'the command is running');
  assert.equal(existsSync(join(directory, 'started')), false, 'the command ran');
}

/**
 * The state directory in `directory`, holding an event stream that takes appends, made to refuse
 * new entries until the test ends.
 */
function refusingNewEntries(t, directory) {
  const state = stateOf(directory);
  mkdirSync(state);
  writeFileSync(streamPath(state), '');
  chmodSync(state, 0o555);
  t.after(() => chmodSync(state, 0o755));
  return state;
}

test('given a state directory whose event stream exists and which refuses new entries, the dispatch\'s command never runs', async (t) => {
  const directory = scratch(t);
  const state = refusingNewEntries(t, directory);

  await assert.rejects(dispatchIn(directory, { id: 'd-1', card: 1412, command: startingCommand(directory) }));

  assertNeverRan(directory);
  // A command spawned and then killed before its first action leaves neither trace above, so the
  // stream is read too: L0 records every process it kills, and the stream still takes appends.
  assert.deepEqual(readEvents(state), [], 'L0 killed a process of the dispatch');
});

test('given a state directory whose event stream exists and which refuses new entries, the caller\'s failure names the state directory', async (t) => {
  const directory = scratch(t);
  const state = refusingNewEntries(t, directory);

  await assert.rejects(dispatchIn(directory, { id: 'd-1', card: 1412, command: startingCommand(directory) }), (failure) => {
    // The directory itself, and not only a file in it, as the file system's own error would.
    const named = failure.message.split(state).slice(1).some((after) => !after.startsWith('/'));
    assert.ok(named, failure.message);
    return true;
  });
});

test('a command run through L0\'s adapter and not through L1\'s function leaves no entry in the record', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const state = stateOf(directory);
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  const adapter = (_, options) => runCommand({ args: [], cwd: directory, env: {}, emitter: sink.emitter({ layer: 'L0' }), ...options });

  await whileHeld(directory, {}, () => {
    assert.deepEqual(readInAnotherProcess(state), [], 'the record held an entry while the command ran');
  }, adapter);

  assert.deepEqual(readInAnotherProcess(state), []);
});

/** The path of every file under `directory`, relative to it, however deep. */
const filesUnder = (directory, root = directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? filesUnder(path, root) : [relative(root, path)];
});

test('every path the record writes is under the state directory of the repository the call names', SETTLES_WITHIN, async (t) => {
  // The repository sits inside the scratch directory, so a write beside it, or into it outside
  // its state directory, lands where this test reads.
  const directory = scratch(t);
  const repository = join(directory, 'repository');
  mkdirSync(repository);
  writeFileSync(join(repository, 'README.md'), 'A target repository.\n');
  const state = join(repository, '.rigger');
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  const fixtures = ['command', 'group', 'release'];
  const before = filesUnder(directory);
  const written = () => filesUnder(directory).filter((file) => !before.includes(file) && !fixtures.includes(file));
  // Every path handed to a call of `node:fs` that writes, while the dispatch runs in this
  // process, so that a file written and then renamed or removed is seen too.
  const touched = [];
  const { release } = watchingWrites(t, (path) => touched.push(path));

  await whileHeld(directory, { id: 'd-1', card: 1412, directory: state, sink, cwd: repository }, () => {});
  release();

  const outside = (paths) => paths.filter((path) => !path.startsWith(`${state}/`) && path !== state);
  // The test's own fixture writes its command and its release, and neither is the record's.
  const ours = touched.filter((path) => !fixtures.map((file) => join(directory, file)).includes(path));
  assert.ok(ours.includes(join(state, 'groups.json')), `the record's file was not written: ${ours}`);
  assert.deepEqual(outside(ours), [], 'a write of the dispatch');
  assert.deepEqual(outside(written().map((file) => join(directory, file))), [], 'a file left after the dispatch settled');
});

/** The calls of `node:fs` that create, change, move or remove a path, each naming its path first. */
const WRITES = ['appendFileSync', 'copyFileSync', 'cpSync', 'linkSync', 'mkdirSync', 'mkdtempSync', 'openSync', 'renameSync', 'rmSync', 'rmdirSync', 'symlinkSync', 'truncateSync', 'unlinkSync', 'writeFileSync'];

/** Those of them whose second argument is a path too. */
const TWO_PATHS = ['copyFileSync', 'cpSync', 'linkSync', 'renameSync', 'symlinkSync'];

/**
 * Has every call in `WRITES` hand its path arguments to `seen` before it runs, until `release` or
 * the test's end. `syncBuiltinESMExports` carries the change to every module importing a name from
 * `node:fs`, so the code under test is watched without knowing it.
 */
function watchingWrites(t, seen) {
  const originals = Object.fromEntries(WRITES.map((name) => [name, fs[name]]));
  for (const name of WRITES) {
    fs[name] = (...args) => {
      for (const arg of args.slice(0, TWO_PATHS.includes(name) ? 2 : 1)) seen(String(arg));
      return originals[name](...args);
    };
  }
  syncBuiltinESMExports();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    Object.assign(fs, originals);
    syncBuiltinESMExports();
  };
  t.after(release);
  return { release };
}

test('given a dispatch whose command never started, the record holds no entry for it afterwards', async (t) => {
  const directory = scratch(t);

  await assert.rejects(dispatchIn(directory, { id: 'd-missing', card: 1412, command: join(directory, 'no-such-command') }), /ENOENT/);

  assert.deepEqual(readInAnotherProcess(stateOf(directory)).filter((entry) => entry.dispatch === 'd-missing'), []);
});

test('a call to L1\'s function with no dispatch id starts no process, and fails naming the missing id', async (t) => {
  // Left out, null and empty: none of them tells one dispatch's entry from another's.
  for (const [what, id] of [['left out', undefined], ['null', null], ['empty', '']]) {
    const directory = scratch(t);

    await assert.rejects(dispatchIn(directory, { id, command: startingCommand(directory), card: 1412 }), /dispatch id/, what);

    assertNeverRan(directory);
  }
});

/**
 * A module a Node process loads first, with `--import`, that stops that process outright part-way
 * through a write into `state`: `at` is `bytes`, to stop once half of a file's bytes are written,
 * or `rename`, to stop as a file is about to be renamed. It changes `node:fs` itself, and
 * `syncBuiltinESMExports` carries the change to every module importing a name from it, so the
 * record's writer is stopped without knowing it is under test.
 */
function stopping(directory, state, at) {
  const path = join(directory, `stop-at-${at}.mjs`);
  writeFileSync(path, [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    `const state = ${JSON.stringify(`${state}/`)};`,
    'const { writeFileSync, renameSync } = fs;',
    'const inState = (path) => String(path).startsWith(state);',
    'const stop = () => process.kill(process.pid, "SIGKILL");',
    'fs.writeFileSync = (path, data, ...rest) => {',
    `  if (${JSON.stringify(at)} === 'bytes' && inState(path)) {`,
    '    const bytes = Buffer.from(data);',
    '    writeFileSync(path, bytes.subarray(0, bytes.length >> 1));',
    '    stop();',
    '  }',
    '  return writeFileSync(path, data, ...rest);',
    '};',
    'fs.renameSync = (from, to) => {',
    `  if (${JSON.stringify(at)} === 'rename' && inState(to)) stop();`,
    '  return renameSync(from, to);',
    '};',
    'syncBuiltinESMExports();',
  ].join('\n'));
  return path;
}

test('a partial record a stopped writer left in the state directory is gone once the next dispatch has settled', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const state = stateOf(directory);
  // What a writer stopped before its rename leaves: the partial file beside an intact record.
  mkdirSync(state);
  writeFileSync(join(state, 'groups.json'), '[]');
  writeFileSync(join(state, 'groups.json.partial'), '[{"group":');

  await whileHeld(directory, { id: 'd-1', card: 1412 }, () => {});

  assert.deepEqual(readdirSync(state).filter((file) => file !== 'events.jsonl'), ['groups.json']);
});

test('a reader finds the record as it was before a write or as it is after it, never part of one, when its writer is stopped part-way through', async (t) => {
  const groups = new URL('../src/execution/groups.mjs', import.meta.url).href;
  // Entries long enough that half of the record's bytes is not a whole record.
  const entry = (group) => ({ group, dispatch: `d-${'x'.repeat(200)}-${group}`, card: 1412 });
  const earlier = [entry(101), entry(102)];
  for (const at of ['bytes', 'rename']) {
    const directory = scratch(t);
    const state = stateOf(directory);
    const write = (entries, options = {}) => spawnSync(process.execPath, [
      ...(options.stop ? ['--import', options.stop] : []),
      '--input-type=module',
      '-e',
      `const { writeGroups } = await import(${JSON.stringify(groups)}); writeGroups(${JSON.stringify(state)}, ${JSON.stringify(entries)});`,
    ], { encoding: 'utf8' });
    const first = write(earlier);
    assert.equal(first.status, 0, first.stderr);
    const later = [...earlier, entry(103)];

    const stopped = write(later, { stop: stopping(directory, state, at) });

    assert.equal(stopped.signal, 'SIGKILL', `the writer was not stopped at ${at}: ${stopped.stderr}`);
    const found = readInAnotherProcess(state);
    assert.ok([JSON.stringify(earlier), JSON.stringify(later)].includes(JSON.stringify(found)), `stopped at ${at}, the reader found ${JSON.stringify(found)}`);
  }
});
