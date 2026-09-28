// ABOUTME: Tests L1's dispatching function: its result, the dispatch's start, timeout and one end it
// records, the refusals it reports, and the process group it records while the dispatch runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs, { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { EVENT_REFUSED, NOT_STARTED, runCommand } from '../src/substrate/process.mjs';
import { OUTLIVED, TAIL, alive, bytes, fixture, holding, leave, outliving, read, ready, running, scratch } from './process-fixtures.mjs';

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

/**
 * A timeout no command in this file reaches, under `SETTLES_WITHIN`, so a command that hangs is
 * ended by L0 and fails its test rather than holding the suite.
 */
const UNREACHED = 15_000;

/**
 * A sink over the state directory `state` that refuses each event `refuses` picks by its layer and
 * name, throwing as a sink whose append the disk refuses does, and appends every other.
 */
function refusingSome(state, refuses) {
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return {
    emitter(envelope) {
      const emitter = sink.emitter(envelope);
      return {
        emit(event, fields) {
          if (refuses(envelope.layer, event)) throw new Error(`the test's sink refuses ${envelope.layer} ${event}`);
          emitter.emit(event, fields);
        },
      };
    },
  };
}

/** Starts a dispatch of `command` through L1's function, with the state directory in `directory`. */
function dispatchIn(directory, options) {
  const state = stateOf(directory);
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return dispatch({ directory: state, sink, args: [], cwd: directory, env: {}, timeout: UNREACHED, ...options });
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
  // The command leaves a `tail` alive in its group, so L0 kills it and records the kill, which the
  // sink refuses. The record stays in the state directory, which takes writes.
  const command = fixture(directory, 'command', [
    'echo $$ > "$here/group"',
    '/usr/bin/tail -f "$here/hold" &',
    'while ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -q "^tail"; do :; done',
  ].join('\n'));
  const sink = refusingSome(stateOf(directory), (layer) => layer === 'L0');

  await assert.rejects(dispatchIn(directory, { id: 'd-1', card: 1412, command, sink }), (failure) => failure.code === EVENT_REFUSED);

  const group = Number(read(directory, 'group'));
  assert.equal(alive(-group), false, 'a process of the dispatch\'s group is alive');
  assert.deepEqual(readInAnotherProcess(stateOf(directory)).filter((entry) => entry.group === group), []);
});

test('given a sink that refuses the kill event and a record that refuses the removal, the caller still receives the refusal, with the result and the removal\'s failure on it', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const state = stateOf(directory);
  writeFileSync(join(directory, 'hold'), '');
  // Once running, and so once its entry is written, the command makes the stream and the state
  // directory refuse writes, then leaves a `tail` alive in its group for L0 to kill.
  const command = fixture(directory, 'command', [
    ': > "$here/.rigger/events.jsonl"',
    '/bin/chmod 444 "$here/.rigger/events.jsonl"',
    '/bin/chmod 555 "$here/.rigger"',
    'echo $$ > "$here/group"',
    '/usr/bin/tail -f "$here/hold" &',
    'while ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -q "^tail"; do :; done',
    'exit 4',
  ].join('\n'));
  t.after(() => chmodSync(state, 0o755));

  const failure = await dispatchIn(directory, { id: 'd-1', card: 1412, command }).then(() => assert.fail('the dispatch settled without rejecting'), (error) => error);

  assert.equal(failure.code, EVENT_REFUSED, failure.stack);
  // The stream refuses L1's end as well, so it is among the unrecorded events.
  assert.deepEqual(failure.unrecorded.map(({ event, name }) => ({ event, name })), [{ event: 'survivor.killed', name: 'tail' }, { event: 'dispatch.end', name: undefined }]);
  assert.equal(failure.result?.exit, 4);
  assert.equal(failure.recordFailure?.code, 'EACCES', 'the removal\'s failure is not carried on the refusal');
  assert.ok(failure.message.includes(state), `the refusal does not say the record in ${state} kept its entry: ${failure.message}`);
});

/**
 * Has `node:child_process`'s `spawn` hand back, until the test ends, a child that has a pid and
 * then reports `error`, as Node's `ChildProcess` does when something fails after the spawn.
 * `syncBuiltinESMExports` carries the change to L0's adapter, which imports `spawn` by name.
 */
function failingAfterSpawn(t, pid, error) {
  const { spawn } = childProcess;
  childProcess.spawn = () => {
    const child = new EventEmitter();
    Object.assign(child, { pid, stdout: new PassThrough(), stderr: new PassThrough() });
    setImmediate(() => child.emit('error', error));
    return child;
  };
  syncBuiltinESMExports();
  t.after(() => {
    childProcess.spawn = spawn;
    syncBuiltinESMExports();
  });
}

test('given a dispatch L0 rejects for any reason but a refused event, the record keeps its entry for a later start to settle', async (t) => {
  const directory = scratch(t);
  // A pid no process holds: the entry is only read, and nothing is signalled.
  const pid = 999_999_999;
  const error = new Error('the child failed after its spawn');
  failingAfterSpawn(t, pid, error);

  await assert.rejects(dispatchIn(directory, { id: 'd-1', card: 1412, command: '/usr/bin/true' }), (thrown) => thrown === error);

  assert.deepEqual(readInAnotherProcess(stateOf(directory)), [{ group: pid, dispatch: 'd-1', card: 1412 }]);
});

/** A command whose first action writes `$here/started`. */
const startingCommand = (directory) => fixture(directory, 'command', ': > "$here/started"');

/**
 * Asserts that the command `startingCommand` wrote into `directory` has not run its first action
 * and is not running: `pgrep` finds nothing with the directory in its command line, and there is
 * no `$here/started`. The two are read in that order, so a command that ends between them is
 * caught by the second. A command killed before its first action passes both, so a test that must
 * show no process was started at all also reads what L0 recorded.
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
  assert.deepEqual(readEvents(state).filter((event) => event.layer === 'L0'), [], 'L0 killed a process of the dispatch');
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
  const adapter = (_, options) => runCommand({ args: [], cwd: directory, env: {}, timeout: UNREACHED, emitter: sink.emitter({ layer: 'L0' }), ...options });

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

/** Every event in the state directory `state`, or none where nothing has been recorded there. */
const eventsIn = (state) => (existsSync(streamPath(state)) ? readEvents(state) : []);

test('the stream holds an L1 dispatch-start event carrying the id L1 was handed, ahead of every L0 event carrying that id', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));

  await dispatchIn(directory, { id: 'd-start', card: 1412, command });

  const events = eventsIn(stateOf(directory));
  const start = events.findIndex((each) => each.layer === 'L1' && each.event === 'dispatch.start' && each.dispatch === 'd-start');
  const l0 = events.flatMap((each, index) => (each.layer === 'L0' && each.dispatch === 'd-start' ? [index] : []));
  assert.ok(start >= 0, `no L1 dispatch-start event carries d-start: ${JSON.stringify(events)}`);
  assert.ok(l0.length > 0, 'the survivor\'s kill was not recorded under L0, so the order proves nothing');
  assert.ok(l0.every((index) => index > start), `an L0 event comes before the start: ${JSON.stringify(events)}`);
});

/** A sink whose every append is refused, because its state directory would sit under a regular file. */
function refusingEvery(directory) {
  writeFileSync(join(directory, 'blocked'), '');
  return openSink({ directory: join(directory, 'blocked', 'state'), run: 'r-test', now: () => 0 });
}

// proves R-RECORD-9
test('given a sink that refuses every append, L1\'s function starts no process, and rejects naming the unrecorded start event', async (t) => {
  const directory = scratch(t);

  await assert.rejects(dispatchIn(directory, { id: 'd-1', card: 1412, command: startingCommand(directory), sink: refusingEvery(directory) }), (failure) => {
    assert.ok(failure.message.includes('dispatch.start'), `the failure does not name the start event: ${failure.message}`);
    return true;
  });

  assertNeverRan(directory);
});

/** The dispatch-end events in the stream in `directory`'s state directory carrying dispatch `id`. */
const endsOf = (directory, id) => eventsIn(stateOf(directory)).filter((each) => each.event === 'dispatch.end' && each.dispatch === id);

/** A clock that reads each of `readings` in turn, in milliseconds, and the last one after that. */
const clockReading = (...readings) => () => (readings.length > 1 ? readings.shift() : readings[0]);

test('given a dispatch whose command returned on its own, the stream holds one L1 dispatch-end event under its id, carrying its exit code and its duration', async (t) => {
  const directory = scratch(t);
  const command = fixture(directory, 'command', 'exit 3');

  await dispatchIn(directory, { id: 'd-returned', card: 1412, command, clock: clockReading(1_000, 1_734) });

  assert.deepEqual(endsOf(directory, 'd-returned').map(({ layer, card, exit, ms }) => ({ layer, card, exit, ms })), [{ layer: 'L1', card: 1412, exit: 3, ms: 734 }]);
});

test('given a dispatch whose command cannot start, the stream holds one dispatch-end event under its id, which carries no exit code and names the missing command', async (t) => {
  const directory = scratch(t);
  const missing = join(directory, 'no-such-command');

  await assert.rejects(dispatchIn(directory, { id: 'd-missing', card: 1412, command: missing }));

  const ends = endsOf(directory, 'd-missing');
  assert.equal(ends.length, 1, JSON.stringify(ends));
  assert.equal('exit' in ends[0], false, `the end carries an exit code: ${JSON.stringify(ends[0])}`);
  assert.ok(JSON.stringify(ends[0]).includes(JSON.stringify(missing).slice(1, -1)), `the end does not name ${missing}: ${JSON.stringify(ends[0])}`);
});

test('given a dispatch whose command cannot start, the caller can tell the rejection is a failure to start without reading its message', async (t) => {
  const directory = scratch(t);

  await assert.rejects(dispatchIn(directory, { id: 'd-missing', card: 1412, command: join(directory, 'no-such-command') }), (failure) => failure.code === NOT_STARTED);
});

test('given a dispatch that outlives its timeout, the stream holds an L1 event recording the timeout under its id', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  await dispatchIn(directory, { id: 'd-late', card: 1412, ...outliving(directory, leave(TAIL, 'child')) });

  ready(directory);
  const timeouts = eventsIn(stateOf(directory)).filter((each) => each.layer === 'L1' && each.dispatch === 'd-late' && /timeout/.test(each.event));
  assert.deepEqual(timeouts.map(({ card, timeout }) => ({ card, timeout })), [{ card: 1412, timeout: OUTLIVED }]);
});

test('given a dispatch that outlives its timeout, the stream holds one dispatch-end event under its id, carrying a non-zero integer exit code', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The command exits 0 on the SIGTERM a timeout could send, so only the timeout makes it non-zero.
  await dispatchIn(directory, { id: 'd-late', card: 1412, ...outliving(directory, `trap 'exit 0' TERM\n${leave(TAIL, 'child')}`) });

  ready(directory);
  const ends = endsOf(directory, 'd-late');
  assert.equal(ends.length, 1, JSON.stringify(ends));
  assert.ok(Number.isInteger(ends[0].exit) && ends[0].exit !== 0, `the end's exit code is ${ends[0].exit}`);
});

test('given a state directory whose event stream exists and which refuses new entries, the dispatch\'s one dispatch-end event names that state directory and carries no exit code', async (t) => {
  const directory = scratch(t);
  const state = refusingNewEntries(t, directory);

  await assert.rejects(dispatchIn(directory, { id: 'd-1', card: 1412, command: startingCommand(directory) }));

  const ends = endsOf(directory, 'd-1');
  assert.equal(ends.length, 1, JSON.stringify(ends));
  assert.equal('exit' in ends[0], false, `the end carries an exit code: ${JSON.stringify(ends[0])}`);
  // The directory itself, and not only a file in it, as the file system's own error would.
  const text = JSON.stringify(ends[0]);
  const quoted = JSON.stringify(state).slice(1, -1);
  assert.ok(text.split(quoted).slice(1).some((after) => !after.startsWith('/')), `the end does not name ${state}: ${text}`);
});

/** A command that leaves a `tail` alive in its group, writing its pid to `$here/survivor.pid`, and exits 0. */
const leavingTail = (directory) => fixture(directory, 'command', `echo $$ > "$here/group"\n${leave(TAIL, 'survivor')}\nexit 0`);

test('given a sink that accepts L1\'s events and refuses the L0 kill event of a dispatch leaving a child alive, the stream holds exactly one dispatch-end event for it', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const sink = refusingSome(stateOf(directory), (layer) => layer === 'L0');

  await assert.rejects(dispatchIn(directory, { id: 'd-kill', card: 1412, command: leavingTail(directory), sink }));

  assert.equal(endsOf(directory, 'd-kill').length, 1, JSON.stringify(endsOf(directory, 'd-kill')));
});

// proves R-RECORD-9
test('given a sink that accepts L1\'s events and refuses the L0 kill event of a dispatch leaving a child alive, the call rejects as a refused event, naming the unrecorded kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const sink = refusingSome(stateOf(directory), (layer) => layer === 'L0');

  await assert.rejects(dispatchIn(directory, { id: 'd-kill', card: 1412, command: leavingTail(directory), sink }), (failure) => {
    assert.equal(failure.code, EVENT_REFUSED, failure.stack);
    assert.ok(failure.message.includes('survivor.killed'), `the failure does not name the kill: ${failure.message}`);
    assert.ok(failure.message.includes(`"pid":${read(directory, 'survivor.pid')}`), `the failure does not name the killed child: ${failure.message}`);
    return true;
  });
});

/** Whether any process of the dispatch whose command wrote its group to `$here/group` is alive. */
const groupAlive = (directory) => alive(-Number(read(directory, 'group')));

// proves R-RECORD-9
test('given a sink that refuses only L1\'s timeout event of a dispatch outliving its timeout with a child, no process of its group is alive when the call settles, and it rejects as a refused event naming the timeout event', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const sink = refusingSome(stateOf(directory), (layer, event) => layer === 'L1' && /timeout/.test(event));

  const failure = await dispatchIn(directory, { id: 'd-late', card: 1412, sink, ...outliving(directory, leave(TAIL, 'child')) }).then(() => assert.fail('the dispatch settled without rejecting'), (error) => error);

  ready(directory);
  assert.equal(alive(-Number(read(directory, 'command.pid'))), false, 'a process of the dispatch\'s group is alive');
  assert.equal(failure.code, EVENT_REFUSED, failure.stack);
  const named = (failure.unrecorded ?? []).map(({ event }) => event);
  assert.equal(named.length, 1, `the unrecorded events are ${named}`);
  assert.match(named[0], /timeout/);
  assert.ok(failure.message.includes(named[0]), `the failure's message does not name ${named[0]}: ${failure.message}`);
});

// proves R-RECORD-9
test('given a sink that accepts the start event and refuses the end event, the caller receives a refused event naming the dispatch, its card and the end, and no process of the group is alive', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const sink = refusingSome(stateOf(directory), (layer, event) => layer === 'L1' && event === 'dispatch.end');

  const failure = await dispatchIn(directory, { id: 'd-unended', card: 1412, command: leavingTail(directory), sink }).then(() => assert.fail('the dispatch settled without rejecting'), (error) => error);

  assert.equal(groupAlive(directory), false, 'a process of the dispatch\'s group is alive');
  assert.equal(failure.code, EVENT_REFUSED, failure.stack);
  for (const name of ['d-unended', '1412', 'dispatch.end']) assert.ok(failure.message.includes(name), `the failure does not name ${name}: ${failure.message}`);
});

test('given a command, a cwd, an env, a timeout and a dispatch id, L1\'s function settles with an integer exit code and the captured output as bytes', async (t) => {
  const directory = scratch(t);
  const command = fixture(directory, 'command', 'printf "to standard output"\nprintf "to standard error" >&2\nexit 5');

  const result = await dispatch({ id: 'd-1', directory: stateOf(directory), sink: openSink({ directory: stateOf(directory), run: 'r-test', now: () => 0 }), command, args: [], cwd: directory, env: {}, timeout: UNREACHED });

  assert.equal(result.exit, 5);
  assert.ok(Buffer.isBuffer(result.stdout) && result.stdout.equals(Buffer.from('to standard output')), `standard output is ${result.stdout}`);
  assert.ok(Buffer.isBuffer(result.stderr) && result.stderr.equals(Buffer.from('to standard error')), `standard error is ${result.stderr}`);
});

test('given a command writing a payload to each stream and a child writing a third to standard output before the command exits and stays alive, L1\'s result holds every byte of each in the stream it was written to', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const [first, second, third] = [bytes(200_003, 7), bytes(150_007, 13), bytes(100_019, 37)];
  writeFileSync(join(directory, 'first'), first);
  writeFileSync(join(directory, 'second'), second);
  writeFileSync(join(directory, 'third'), third);
  fixture(directory, 'child', `/bin/cat "$here/third"\n: > "$here/written"\nexec ${TAIL}`);
  const command = fixture(directory, 'command', [
    '/bin/cat "$here/first"',
    '/bin/cat "$here/second" >&2',
    leave('"$here/child"', 'survivor'),
    'while [ ! -f "$here/written" ]; do :; done',
    'exit 0',
  ].join('\n'));

  const result = await dispatchIn(directory, { id: 'd-1', card: 1412, command });

  assert.ok(result.stdout.equals(Buffer.concat([first, third])), 'standard output holds every byte of the command\'s payload, then the child\'s');
  assert.ok(result.stderr.equals(second), 'standard error holds every byte of the command\'s payload to it');
});

test('given a dispatch whose command writes a payload and then outlives its timeout, L1\'s result holds every byte of it', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const payload = bytes(300_001, 23);
  writeFileSync(join(directory, 'payload'), payload);

  const result = await dispatchIn(directory, { id: 'd-late', card: 1412, ...outliving(directory, `/bin/cat "$here/payload"\n${leave(TAIL, 'child')}`) });

  ready(directory);
  assert.ok(result.stdout.equals(payload), 'standard output holds every byte of the command\'s payload');
});

test('given a dispatch whose child writes a payload to each stream and outlives its timeout with it, L1\'s result holds every byte of each in the stream it was written to', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const out = bytes(200_003, 29);
  const err = bytes(150_007, 31);
  writeFileSync(join(directory, 'out'), out);
  writeFileSync(join(directory, 'err'), err);
  // The command blocks opening a FIFO until the child has written both and opens it, as in the
  // adapter's own test of this case, and runs the child under `/bin/sh` by name (see `OUTLIVED`).
  fixture(directory, 'child', `/bin/cat "$here/out"\n/bin/cat "$here/err" >&2\n: > "$here/written"\nexec ${TAIL}`);
  const body = ['/usr/bin/mkfifo "$here/written"', '/bin/sh "$here/child" &', 'read -r _ < "$here/written"'].join('\n');

  const result = await dispatchIn(directory, { id: 'd-late', card: 1412, ...outliving(directory, body) });

  ready(directory);
  assert.ok(result.stdout.equals(out), 'standard output holds every byte of the child\'s payload to it');
  assert.ok(result.stderr.equals(err), 'standard error holds every byte of the child\'s payload to it');
});

test('given an env that sets a variable, the dispatch\'s command sees exactly the value given', async (t) => {
  const directory = scratch(t);
  // Spaces, a newline, a quote and a byte outside ASCII: none of them may be split, trimmed or changed.
  const value = ' two  words\nand a "quote" ü ';
  const command = fixture(directory, 'command', 'printf "%s" "$RIGGER_TEST_VALUE"');

  const result = await dispatchIn(directory, { id: 'd-1', card: 1412, command, env: { RIGGER_TEST_VALUE: value } });

  assert.equal(result.stdout.toString('utf8'), value);
});

test('every L0 event a dispatch\'s processes give rise to carries its dispatch id, and its card where it has one', SETTLES_WITHIN, async (t) => {
  for (const card of [1412, undefined]) {
    const directory = holding(t);

    await dispatchIn(directory, { id: 'd-l0', card, command: leavingTail(directory) });

    const l0 = eventsIn(stateOf(directory)).filter((each) => each.layer === 'L0');
    assert.ok(l0.length > 0, 'no L0 event was recorded, so the test proves nothing');
    assert.deepEqual(l0.map((each) => ({ dispatch: each.dispatch, card: each.card, hasCard: 'card' in each })), l0.map(() => ({ dispatch: 'd-l0', card, hasCard: card !== undefined })));
  }
});

test('given a dispatch whose command leaves a child alive and exits 0, its dispatch-end event follows every event recording that child\'s kill, and it settles only once that child is dead', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  await dispatchIn(directory, { id: 'd-after', card: 1412, command: leavingTail(directory) });

  assert.equal(alive(Number(read(directory, 'survivor.pid'))), false, 'the child is alive');
  const events = eventsIn(stateOf(directory));
  const kills = events.flatMap((each, index) => (each.layer === 'L0' && each.pid === Number(read(directory, 'survivor.pid')) ? [index] : []));
  const end = events.findIndex((each) => each.event === 'dispatch.end' && each.dispatch === 'd-after');
  assert.ok(kills.length > 0, `the child's kill was not recorded: ${JSON.stringify(events)}`);
  assert.ok(end >= 0 && kills.every((index) => index < end), `the end does not follow every kill: ${JSON.stringify(events)}`);
});

test('given a dispatch whose command leaves alive a child holding none of its pipes and exits 0, it settles only once that child is dead', SETTLES_WITHIN, async (t) => {
  // The child's output goes nowhere, so the pipes close when the command exits, and only L1
  // awaiting L0's kill holds the call until the child is dead.
  const directory = holding(t);
  const command = fixture(directory, 'command', `${leave(`${TAIL} >/dev/null 2>&1 </dev/null`, 'survivor')}\nexit 0`);

  await dispatchIn(directory, { id: 'd-pipeless', card: 1412, command });

  assert.equal(alive(Number(read(directory, 'survivor.pid'))), false, 'the child is alive');
});

test('given a dispatch whose command leaves a child alive and exits 0, the record holds no entry for it when its dispatch-end event is appended', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const state = stateOf(directory);
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  // What another process reading the record finds at the moment the sink is handed the end.
  let atEnd;
  const reading = {
    emitter(envelope) {
      const emitter = sink.emitter(envelope);
      return {
        emit(event, fields) {
          if (envelope.layer === 'L1' && event === 'dispatch.end') atEnd = readInAnotherProcess(state);
          emitter.emit(event, fields);
        },
      };
    },
  };

  await dispatchIn(directory, { id: 'd-cleared', card: 1412, command: leavingTail(directory), sink: reading });

  assert.ok(atEnd !== undefined, 'the sink was never handed the dispatch\'s end');
  assert.deepEqual(atEnd.filter((entry) => entry.dispatch === 'd-cleared'), []);
});

test('given a state directory whose event stream exists and which refuses new entries, the caller can tell the rejection is a failure to start without reading its message', async (t) => {
  const directory = scratch(t);
  refusingNewEntries(t, directory);

  await assert.rejects(dispatchIn(directory, { id: 'd-1', card: 1412, command: startingCommand(directory) }), (failure) => failure.code === NOT_STARTED);
});
