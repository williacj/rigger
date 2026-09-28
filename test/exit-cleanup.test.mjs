// ABOUTME: Tests L0's exit cleanup: on every ending in which Rigger's code still runs, a Node process
// that started commands through the adapter kills every group it holds, records each kill, removes
// L1's entries and ends the sink, and still ends with the status or signal it would have.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { join } from 'node:path';

import { readEvents, streamPath } from '../src/observation/sink.mjs';
import { readGroups } from '../src/execution/groups.mjs';
import { HANDLED, LEFT_OUT } from '../src/substrate/process.mjs';
import { alive, fixture, read, running, scratch } from './process-fixtures.mjs';

// A bound on the test alone, so that a caller which never ends fails here rather than holding the
// suite: nothing waits on it once the caller has ended.
const ENDS_WITHIN = { timeout: 30_000 };

/** The URL of the module at `path`, relative to this file, as a string literal. */
const moduleAt = (path) => JSON.stringify(new URL(path, import.meta.url).href);

/**
 * The caller: a Node process of its own that starts two commands through the adapter, or through
 * L1's function, waits until each group holds the command and its child, says `ready`, and then
 * ends as the test asks. Its arguments are its scratch directory and a JSON object of these options:
 *
 * - `ending`: `exit 0`, `exit 1`, `throw`, `reject`, or `wait`, for a test that signals it.
 * - `sink`: `named`, the state directory in the scratch directory; `unnamed`, never named.
 * - `groups`: whether it starts the commands at all, so a control run ends the same way without.
 * - `dispatch`: whether the first command starts through L1's function, as dispatch `d-1`.
 * - `ps`, a fixture's name, and `readTimeout`: handed to the adapter for every command, where given.
 * - `stopped`: whether the first command exits at once, leaving its child for a census whose first
 *   read of the process table does not answer, so that group is stopped when the caller ends.
 * - `filler`: a string each command takes as its second argument, which lengthens its command line.
 * - `listens`: whether the caller has a `SIGTERM` listener of its own, which says `heard`, runs on
 *   until the test writes `go`, and then exits 3.
 */
const CALLER = [
  `import { openSink } from ${moduleAt('../src/observation/sink.mjs')};`,
  `import { dispatch } from ${moduleAt('../src/execution/run.mjs')};`,
  `import { atExit, runCommand } from ${moduleAt('../src/substrate/process.mjs')};`,
  "import { existsSync, readFileSync } from 'node:fs';",
  "import { spawnSync } from 'node:child_process';",
  "import { join } from 'node:path';",
  'const directory = process.argv[2];',
  'const options = JSON.parse(process.argv[3]);',
  "const state = join(directory, 'state');",
  "const sink = openSink({ directory: options.sink === 'named' ? state : undefined, run: 'r-test', now: () => 0 });",
  'atExit(sink.end);',
  "if (options.listens) process.on('SIGTERM', async () => {",
  // It says so a turn later, once every other listener for the signal has run.
  '  await turn();',
  "  process.stdout.write('heard\\n');",
  "  while (!existsSync(join(directory, 'go'))) await turn();",
  '  process.exit(3);',
  '});',
  // Touching process.stderr is what every verb that prints does, and it leaves the descriptor
  // non-blocking, where a single write to a full pipe comes back short.
  "process.stderr.write('');",
  'const turn = () => new Promise((resolve) => setImmediate(resolve));',
  'if (options.groups) {',
  '  for (const label of [1, 2]) {',
  "    const command = join(directory, label === 1 && options.stopped ? 'leaving' : 'command');",
  "    const args = options.filler === undefined ? [String(label)] : [String(label), options.filler];",
  "    const call = { command, args, cwd: directory, env: {}, ps: options.ps && join(directory, options.ps), readTimeout: options.readTimeout };",
  "    const started = label === 1 && options.dispatch",
  "      ? dispatch({ id: 'd-1', card: 7, directory: state, sink, ...call })",
  "      : runCommand({ ...call, emitter: sink.emitter({ layer: 'L0' }) });",
  '    started.catch(() => {});',
  '  }',
  "  while (!existsSync(join(directory, 'child.1')) || !existsSync(join(directory, 'child.2'))) await turn();",
  '  if (options.stopped) {',
  "    const child = readFileSync(join(directory, 'child.1'), 'utf8').trim();",
  "    const state = () => spawnSync('/bin/ps', ['-o', 'stat=', '-p', child], { encoding: 'utf8' }).stdout;",
  "    while (!existsSync(join(directory, 'ps-asked')) || !state().startsWith('T')) await turn();",
  '  }',
  '}',
  "process.stdout.write('ready\\n');",
  // The test reads the process table before the caller ends, and says so by writing `go`.
  "if (options.ending !== 'wait') while (!existsSync(join(directory, 'go'))) await turn();",
  "if (options.ending === 'exit 0') process.exit(0);",
  "if (options.ending === 'exit 1') process.exit(1);",
  "if (options.ending === 'throw') setImmediate(() => { throw new Error('the caller threw this'); });",
  "if (options.ending === 'reject') Promise.reject(new Error('the caller rejected this'));",
  // A caller told to wait holds itself open, so it waits for the signal whether or not it
  // started anything.
  "if (options.ending === 'wait') setInterval(() => {}, 1_000);",
].join('\n');

/**
 * Makes the fixtures a caller in `directory` runs: `command`, which records its group, starts a
 * `tail` and runs until killed; `leaving`, which starts its `tail` and exits; and a stand-in for
 * `ps` whose first read never answers and whose later reads are `ps`'s.
 */
function fixtures(directory) {
  writeFileSync(join(directory, 'hold'), '');
  writeFileSync(join(directory, 'ps-hold'), '');
  // The child's pid is written only once it is `tail`, so a census never finds it mid-exec. It
  // ignores SIGTERM, which it inherits across the exec, so only a kill no process can ignore ends
  // it: on this host SIGTERM ends a stopped process as it ends a running one.
  const child = [
    "(trap '' TERM; exec /usr/bin/tail -f \"$here/hold\") &",
    'echo $! > "$here/child.$1.tmp"',
    "while kill -0 $! 2>/dev/null && ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -qx 'tail *'; do :; done",
    '/bin/mv "$here/child.$1.tmp" "$here/child.$1"',
  ].join('\n');
  fixture(directory, 'command', `echo $$ > "$here/group.$1"\n${child}\nwait`);
  fixture(directory, 'leaving', `echo $$ > "$here/group.$1"\n${child}\nexit 0`);
  fixture(directory, 'ps-once', [
    'if [ ! -f "$here/ps-asked" ]; then : > "$here/ps-asked"; exec /usr/bin/tail -f "$here/ps-hold"; fi',
    'exec /bin/ps "$@"',
  ].join('\n'));
  fixture(directory, 'ps-never', 'exec /usr/bin/tail -f "$here/ps-hold"');
}

/**
 * Runs the caller in a scratch directory under `options`, sends it `signal` once it is ready,
 * where one is given, and answers how it ended and what it left. `inspect`, where given, is handed
 * the directory once the caller is ready and before it ends, and what it answers is `seen`. So is
 * `whileHeard`, once a caller that listens has heard the signal, and what it answers is `heard`.
 */
async function endCaller(t, options, { signal, refusing = false, inspect, whileHeard } = {}) {
  const directory = scratch(t);
  fixtures(directory);
  if (refusing) {
    // The state directory exists and takes no file, so the sink refuses every append.
    mkdirSync(join(directory, 'state'));
    chmodSync(join(directory, 'state'), 0o555);
  }
  const caller = join(directory, 'caller.mjs');
  writeFileSync(caller, CALLER);
  const run = spawn(process.execPath, [caller, directory, JSON.stringify(options)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  run.stderr.on('data', (chunk) => { stderr += chunk; });
  const ready = new Promise((resolve) => {
    run.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('ready\n')) resolve();
    });
  });
  const ended = once(run, 'close');
  await Promise.race([ready, ended]);
  // What the process table says of each process, read while the caller still holds them.
  const processes = options.groups ? described(directory) : [];
  const seen = inspect?.(directory);
  let heard;
  if (signal !== undefined) process.kill(run.pid, signal);
  if (whileHeard !== undefined) {
    while (!stdout.includes('heard\n')) await new Promise((resolve) => setImmediate(resolve));
    heard = whileHeard(directory);
  }
  if (signal === undefined || whileHeard !== undefined) writeFileSync(join(directory, 'go'), '');
  const [status, killedBy] = await ended;
  return { directory, processes, seen, heard, status, signal: killedBy, stderr };
}

/** The pids a caller's two commands recorded: each group's leader and its `tail`. */
function processesOf(directory) {
  return [1, 2].flatMap((label) => [
    { pid: Number(read(directory, `group.${label}`)) },
    { pid: Number(read(directory, `child.${label}`)) },
  ]);
}

/** Whether any process is left in `group`, a zombie included. */
function occupied(group) {
  try {
    process.kill(-group, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

/**
 * Whether both of a caller's groups are empty, waiting, a turn of the event loop at a time, until
 * they are or `within` milliseconds have passed. A killed leader is a zombie until whatever
 * inherits it from the caller reaps it, so the wait is on the group emptying.
 */
async function emptied(directory, within = 10_000) {
  const groups = [1, 2].map((label) => Number(read(directory, `group.${label}`)));
  const deadline = Date.now() + within;
  while (groups.some(occupied) && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
  return !groups.some(occupied);
}

/** Every process a caller's two commands recorded is dead, and both groups are empty. */
async function assertNoneAlive(directory) {
  assert.equal(await emptied(directory), true, 'a process of one of the caller\'s groups is alive');
  for (const { pid } of processesOf(directory)) assert.equal(alive(pid), false, `process ${pid} is alive`);
}

/**
 * What `ps` reads as each recorded process's name and command line, read by the test before the
 * caller ends, so the record is compared with the process table and not with the adapter's census.
 */
function described(directory) {
  return processesOf(directory).map(({ pid }) => ({
    pid,
    name: spawnSync('/bin/ps', ['-o', 'ucomm=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trimEnd(),
    cmd: spawnSync('/bin/ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { LC_ALL: 'C.UTF-8' } }).stdout.trimEnd(),
  }));
}

/** The kill events in `events`, as the pid, name and command line each names, in pid order. */
const kills = (events) => events
  .filter(({ event }) => event === 'survivor.killed')
  .map(({ pid, name, cmd }) => ({ pid, name, cmd }))
  .sort((one, other) => one.pid - other.pid);

/** `processes` in pid order. */
const byPid = (processes) => [...processes].sort((one, other) => one.pid - other.pid);

/** The events in a named sink's stream in `directory`, or none where it holds no stream. */
const streamOf = (directory) => (existsSync(streamPath(join(directory, 'state'))) ? readEvents(join(directory, 'state')) : []);

/** Every line of `stderr` that is one JSON event, read back as that event. */
const eventLines = (stderr) => stderr.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));

/** Each event the cleanup wrote to standard error as unrecorded, read back with its fields. */
const unrecordedIn = (stderr) => stderr.split('\n')
  .map((line) => /^(survivor\.killed|group\.killed) (\{.*\}): /.exec(line))
  .filter(Boolean)
  .map(([, event, fields]) => ({ event, ...JSON.parse(fields) }));

// Items 1 to 21: every ending in which the caller's code still runs.

for (const ending of ['exit 0', 'exit 1']) {
  const status = Number(ending.split(' ')[1]);
  test(`a caller holding two groups that calls process.exit(${status}) leaves no process of either alive, exits ${status}, and records each kill`, ENDS_WITHIN, async (t) => {
    const { directory, processes, status: exited, signal, stderr } = await endCaller(t, { ending, sink: 'named', groups: true });

    assert.equal(signal, null, stderr);
    assert.equal(exited, status, stderr);
    await assertNoneAlive(directory);
    assert.deepEqual(kills(streamOf(directory)), byPid(processes));
  });
}

test('a caller holding two groups whose own SIGTERM listener keeps it running leaves both groups running, and at the exit it makes, none', ENDS_WITHIN, async (t) => {
  const everyAlive = (directory) => processesOf(directory).every(({ pid }) => alive(pid));
  const { directory, processes, heard, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, listens: true }, { signal: 'SIGTERM', whileHeard: everyAlive });

  assert.equal(heard, true, 'a process of the caller\'s groups died when the caller\'s own listener kept it running');
  assert.deepEqual({ status, signal }, { status: 3, signal: null }, stderr);
  await assertNoneAlive(directory);
  assert.deepEqual(kills(streamOf(directory)), byPid(processes));
});

/**
 * The status and standard error of a caller that ends as `ending` with no group started, its
 * scratch directory's path in standard error read as `<directory>`.
 */
async function control(t, ending) {
  const { directory, status, stderr } = await endCaller(t, { ending, sink: 'named', groups: false });
  return { status, stderr: stderr.replaceAll(directory, '<directory>') };
}

for (const [ending, message] of [['throw', 'the caller threw this'], ['reject', 'the caller rejected this']]) {
  test(`a caller holding two groups that ends on an unhandled ${ending} leaves no process of either alive, ends with Node's status and report, and records each kill`, ENDS_WITHIN, async (t) => {
    const expected = await control(t, ending);
    assert.notEqual(expected.status, 0, 'Node gave the control run a zero status');
    assert.match(expected.stderr, new RegExp(message));

    const { directory, processes, status, signal, stderr } = await endCaller(t, { ending, sink: 'named', groups: true });

    assert.equal(signal, null, stderr);
    assert.equal(status, expected.status, stderr);
    assert.ok(stderr.replaceAll(directory, '<directory>').startsWith(expected.stderr), `Node's report did not reach standard error whole:\n${stderr}`);
    await assertNoneAlive(directory);
    assert.deepEqual(kills(streamOf(directory)), byPid(processes));
  });
}

for (const name of HANDLED) {
  test(`a caller holding two groups that receives ${name} leaves no process of either alive, ends reporting ${name}, and records each kill`, ENDS_WITHIN, async (t) => {
    const { directory, processes, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true }, { signal: name });

    assert.equal(signal, name, `status ${status}: ${stderr}`);
    await assertNoneAlive(directory);
    assert.deepEqual(kills(streamOf(directory)), byPid(processes));
  });
}

// Items 22 and 23: the handled signals, and the ones left out, tied to what Node and the OS answer.

/**
 * A Node process that says `ready`, answers each line on its standard input with `pong`, and,
 * where `listen` holds, has a listener for the signal it is given as its argument that says
 * `heard` and exits 0. A listener Node refuses is answered `refused` and exit 9.
 */
const probe = (listen) => [
  listen
    ? "try { process.on(process.argv[1], () => { process.stdout.write('heard\\n'); process.exit(0); }); } catch { process.stdout.write('refused\\n'); process.exit(9); }"
    : '',
  "process.stdin.on('data', () => process.stdout.write('pong\\n'));",
  "process.stdout.write('ready\\n');",
].join('\n');

/**
 * What Node and the OS make of `name` sent to a Node process: `ended` by a signal, with which;
 * `exited`, with its status and what it said; `refused`, where Node refused the listener; or
 * `survived`, where the process still answered after the signal, or was stopped by it.
 *
 * A process that answers two pings sent after the signal has taken it: the kernel acts on a
 * signal before the process next runs its own code.
 */
async function answer(name, { listen = false, flags = [] } = {}) {
  const child = spawn(process.execPath, [...flags, '-e', probe(listen), name], { stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  // A ping to a process the signal ended is refused, and how it ended is read from its close.
  child.stdin.on('error', () => {});
  let ended;
  const closed = once(child, 'close').then(([status, signal]) => { ended = { status, signal }; });
  const turn = () => new Promise((resolve) => setImmediate(resolve));
  while (!out.includes('ready\n') && ended === undefined) await turn();
  if (ended === undefined) {
    process.kill(child.pid, name);
    child.stdin.write('ping\n');
  }
  let pinged = 1;
  const state = () => spawnSync('/bin/ps', ['-o', 'stat=', '-p', String(child.pid)], { encoding: 'utf8' }).stdout;
  let outcome;
  while (outcome === undefined) {
    const pongs = out.split('pong\n').length - 1;
    if (ended !== undefined) outcome = ended;
    else if (pongs >= 2 || state().startsWith('T')) outcome = 'survived';
    else if (pongs === pinged) {
      child.stdin.write('ping\n');
      pinged += 1;
    } else await turn();
  }
  if (outcome === 'survived') child.kill('SIGKILL');
  await closed;
  if (outcome === 'survived') return { survived: true };
  if (out.includes('refused')) return { refused: true };
  if (outcome.signal !== null) return { ended: outcome.signal };
  return { exited: outcome.status, heard: out.includes('heard') };
}

/** Every signal `os.constants.signals` names. */
const NAMED = Object.keys(constants.signals);

test('every signal Node names is either handled by the exit cleanup or left out of it, and none is both', () => {
  const leftOut = Object.values(LEFT_OUT).flat();
  assert.deepEqual([...HANDLED, ...leftOut].sort(), [...NAMED].sort());
});

test('every signal the exit cleanup handles ends a Node process that has no listener by that signal, and runs a listener where one is given', ENDS_WITHIN, async () => {
  const bare = await Promise.all(HANDLED.map((name) => answer(name)));
  const listened = await Promise.all(HANDLED.map((name) => answer(name, { listen: true })));

  assert.deepEqual(bare, HANDLED.map((name) => ({ ended: name })));
  assert.deepEqual(listened, HANDLED.map(() => ({ exited: 0, heard: true })));
});

test('every signal left out as uncatchable is refused a listener by Node', ENDS_WITHIN, async () => {
  const answers = await Promise.all(LEFT_OUT.uncatchable.map((name) => answer(name, { listen: true })));
  assert.deepEqual(answers, LEFT_OUT.uncatchable.map(() => ({ refused: true })));
});

test('every signal left out as unsafe ends a Node process that has no listener, so Node\'s own word alone keeps it out', ENDS_WITHIN, async () => {
  const answers = await Promise.all(LEFT_OUT.unsafe.map((name) => answer(name)));
  assert.deepEqual(answers, LEFT_OUT.unsafe.map((name) => ({ ended: name })));
});

test('every signal left out as harmless, or for the inspector, leaves a Node process that has no listener running or stopped', ENDS_WITHIN, async () => {
  const names = [...LEFT_OUT.harmless, ...LEFT_OUT.inspector];
  const answers = await Promise.all(names.map((name) => answer(name)));
  assert.deepEqual(answers, names.map(() => ({ survived: true })));
});

test('a listener for the signal left out for the profiler changes how a profiled Node process ends', ENDS_WITHIN, async (t) => {
  const directory = scratch(t);
  const profiled = (code) => spawnSync(process.execPath, ['--cpu-prof', `--cpu-prof-dir=${directory}`, '-e', code], { encoding: 'utf8' });
  const [name] = LEFT_OUT.profiler;

  const without = profiled('');
  const listened = profiled(`process.on(${JSON.stringify(name)}, () => process.exit(3));`);

  assert.equal(without.status, 0, without.stderr);
  assert.equal(listened.signal, name, `status ${listened.status}: ${listened.stderr}`);
});

test('every signal left out as an alias is another name for a handled signal', () => {
  for (const name of LEFT_OUT.alias) {
    assert.ok(HANDLED.some((handled) => constants.signals[handled] === constants.signals[name]), `${name} is no handled signal's number`);
  }
});

// Items 24 to 31: a sink that refuses every append, and one that has no state directory yet.

/** The endings the sink items name: `SIGTERM`, and `process.exit(1)`. */
const ENDINGS = [
  { title: 'SIGTERM', options: { ending: 'wait' }, signal: 'SIGTERM', ended: { status: null, signal: 'SIGTERM' } },
  { title: 'process.exit(1)', options: { ending: 'exit 1' }, ended: { status: 1, signal: null } },
];

for (const { title, options, signal, ended } of ENDINGS) {
  test(`given a sink that refuses every append, after ${title} no process of either group is alive, each unrecorded kill is on standard error, and the caller ends as it would have`, ENDS_WITHIN, async (t) => {
    const { directory, processes, status, signal: killedBy, stderr } = await endCaller(t, { ...options, sink: 'named', groups: true }, { signal, refusing: true });

    assert.deepEqual({ status, signal: killedBy }, ended, stderr);
    await assertNoneAlive(directory);
    assert.deepEqual(kills(unrecordedIn(stderr)), byPid(processes), stderr);
  });

  test(`given a sink that has no state directory yet, after ${title} no process of either group is alive, each kill is on standard error, and the caller ends as it would have`, ENDS_WITHIN, async (t) => {
    const { directory, processes, status, signal: killedBy, stderr } = await endCaller(t, { ...options, sink: 'unnamed', groups: true }, { signal });

    assert.deepEqual({ status, signal: killedBy }, ended, stderr);
    await assertNoneAlive(directory);
    assert.deepEqual(kills(eventLines(stderr)), byPid(processes), stderr);
  });
}

// Items 32 to 35: a process-table read that never answers.

/** Where each kind of sink leaves the events the cleanup recorded or could not. */
const SINKS = [
  { sink: 'named', refusing: false, events: (directory) => streamOf(directory) },
  { sink: 'named', refusing: true, events: (directory, stderr) => unrecordedIn(stderr) },
  { sink: 'unnamed', refusing: false, events: (directory, stderr) => eventLines(stderr) },
];

for (const { title, options, signal, ended } of ENDINGS) {
  for (const { sink, refusing, events } of SINKS) {
    const which = refusing ? 'a sink that refuses every append' : `${sink === 'named' ? 'a named' : 'an unnamed'} sink`;
    test(`given a process-table read that never answers and ${which}, after ${title} no process of either group is alive, the caller ends as it would have, and each group's kill is recorded unnamed`, ENDS_WITHIN, async (t) => {
      const { directory, status, signal: killedBy, stderr } = await endCaller(t, { ...options, sink, groups: true, ps: 'ps-never', readTimeout: 300 }, { signal, refusing });

      assert.deepEqual({ status, signal: killedBy }, ended, stderr);
      await assertNoneAlive(directory);
      assert.deepEqual(running(`${directory}/ps-hold`), [], 'the stand-in for ps is alive');
      const groups = [1, 2].map((label) => Number(read(directory, `group.${label}`))).sort((one, other) => one - other);
      const recorded = events(directory, stderr).filter(({ event }) => event === 'group.killed');
      assert.deepEqual(recorded.map(({ group }) => group).sort((one, other) => one - other), groups, stderr);
      for (const { census } of recorded) assert.match(census, /process-table read timed out/);
    });
  }
}

// Item 36: the cleanup's writes to standard error past a full pipe.

test('the unrecorded kills the cleanup writes to standard error arrive whole past 65,536 bytes', ENDS_WITHIN, async (t) => {
  // Each command's command line carries 40,000 more bytes, so the two commands' kills alone pass
  // the 65,536 bytes a pipe on macOS holds.
  const filler = 'x'.repeat(40_000);
  const { directory, processes, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, filler }, { signal: 'SIGTERM', refusing: true });

  assert.equal(signal, 'SIGTERM', stderr.slice(0, 2_000));
  await assertNoneAlive(directory);
  assert.ok(Buffer.byteLength(stderr) > 65_536, `only ${Buffer.byteLength(stderr)} bytes were written`);
  assert.deepEqual(kills(unrecordedIn(stderr)), byPid(processes));
});

// Item 37: a group the census has stopped when the caller ends.

test('given a census that has one group stopped when the caller receives SIGTERM, no process of that group is alive, and the caller ends reporting SIGTERM', ENDS_WITHIN, async (t) => {
  const { directory, seen, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, stopped: true, ps: 'ps-once' }, {
    signal: 'SIGTERM',
    // The census stopped the first group's child, and its read of the process table is in flight.
    inspect: (directory) => spawnSync('/bin/ps', ['-o', 'stat=', '-p', read(directory, 'child.1')], { encoding: 'utf8' }).stdout.trim(),
  });

  assert.match(seen, /^T/, 'the census had not stopped the group when the caller was signalled, so this proves nothing');
  assert.equal(signal, 'SIGTERM', `status ${status}: ${stderr}`);
  await assertNoneAlive(directory);
  assert.deepEqual(running(`${directory}/ps-hold`), [], 'the census\'s read of the process table is alive');
});

// Items 38 and 39: L1's entry for a dispatch.

/** The record's entries, read once the caller is ready, and the group its first command reported. */
const entries = (directory) => ({ group: Number(read(directory, 'group.1')), record: readGroups(join(directory, 'state')) });

test('given a dispatch started through L1\'s function and still running, after the caller calls process.exit(0) the record no longer holds its entry', ENDS_WITHIN, async (t) => {
  const { directory, seen, status, stderr } = await endCaller(t, { ending: 'exit 0', sink: 'named', groups: true, dispatch: true }, { inspect: entries });

  assert.deepEqual(seen.record, [{ group: seen.group, dispatch: 'd-1', card: 7 }], 'the dispatch was not recorded while it ran, so its removal proves nothing');
  assert.equal(status, 0, stderr);
  await assertNoneAlive(directory);
  assert.deepEqual(readGroups(join(directory, 'state')), []);
});

test('given a dispatch started through L1\'s function and still running, after the caller receives SIGKILL the record still holds its entry', ENDS_WITHIN, async (t) => {
  const { directory, seen, signal } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: true }, { signal: 'SIGKILL', inspect: entries });

  assert.equal(signal, 'SIGKILL');
  assert.deepEqual(readGroups(join(directory, 'state')), [{ group: seen.group, dispatch: 'd-1', card: 7 }]);
});
