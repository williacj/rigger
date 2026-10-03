// ABOUTME: Tests that L0 contains a group without ever stopping it, on the call's containment, a
// start's kill of a recorded group and the exit cleanup: what it records by name and as the group's
// kill, and how it settles where it cannot read the table, may not signal a process, or cannot end
// one, in a group and in a dispatch's directory alike.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { KILL_BOUND, identityOf, killRecordedGroup, runCommand } from '../src/substrate/process.mjs';
import { TAIL, alive, fixture, holding, leave, processState, read, startGroup, tailIn, warmed } from './process-fixtures.mjs';
import { signalStandIn } from './signal-stand-in.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

// Bounds on the tests alone, so that a call which never settles fails here rather than holding
// the suite: nothing waits on them when the call settles. The longer is for a call that waits out
// `KILL_BOUND`.
const { 20_000: SETTLES_WITHIN, 60_000: OUTLASTS_KILL_BOUND } = BOUNDS;

/** A timeout no command here reaches. */
const UNREACHED = 15_000;

/** The exit cleanup's own bound in these tests: the read timeout its caller gives the call. */
const CLEANUP_BOUND = 1_000;

/** The pid a fixture in `directory` wrote to `<name>.pid`, or nothing before it has. */
const pidIn = (directory, name) => (existsSync(join(directory, `${name}.pid`)) ? Number(read(directory, `${name}.pid`)) : undefined);

/** A command that leaves two `tail`s in its group, `one` and `two`, and exits 0. */
const leavingTwo = (directory) => fixture(directory, 'command', [leave(TAIL, 'one'), leave(TAIL, 'two')].join('\n'));

/**
 * A command that writes its pid, its group's id, to `$here/group.pid`, leaves two `tail`s in its
 * group, `one` and `two`, marks `$here/up`, and runs until the test writes `release`, or until killed.
 */
const holdingTwo = (directory) => fixture(directory, 'command', [
  'echo $$ > "$here/group.pid"',
  leave(TAIL, 'one'),
  leave(TAIL, 'two'),
  ': > "$here/up"',
  'while [ ! -f "$here/release" ]; do :; done',
].join('\n'));

/** A command that marks `$here/up` and runs until the test writes `release`, or until killed. */
const holdingNone = (directory) => fixture(directory, 'command', ': > "$here/up"\nwhile [ ! -f "$here/release" ]; do :; done');

/**
 * A `ps` stand-in that cuts the process `$here/two.pid` names out of every read of the census,
 * which begin `-ww -g`, and answers every other read as `ps` does.
 */
const cuttingTwo = (directory) => warmed(fixture(directory, 'ps', [
  'case "$*" in "-ww -g "*)',
  '  /bin/ps "$@" | /usr/bin/grep -v "^ *$(/bin/cat "$here/two.pid") "',
  '  exit 0 ;;',
  'esac',
  'exec /bin/ps "$@"',
].join('\n')));

/** A `ps` stand-in that fails every read as `ps` fails given what it cannot read, but a read of a start time. */
const failing = (directory) => warmed(fixture(directory, 'ps', 'case "$*" in *lstart=*) exec /bin/ps "$@" ;; esac\necho "ps: failing on purpose" >&2\nexit 2'));

/**
 * A signal call for a test in `directory`: `signalStandIn`'s, with the pid `$here/<refused>.pid`
 * names refused and the one `$here/<unkept>.pid` names unkept, each once it is there, and the time
 * of its first kill of a group in `first.at`.
 */
function standIn(directory, { refused, unkept, pairs = [] } = {}) {
  const first = {};
  const kill = signalStandIn({ pairs, refused: () => refused && pidIn(directory, refused), unkept: () => unkept && pidIn(directory, unkept) });
  return {
    pairs,
    first,
    kill: (target, name) => {
      if (target < 0 && name === 'SIGKILL') first.at ??= Date.now();
      return kill(target, name);
    },
  };
}

/** Runs `command` through L0's adapter in `directory`, and hands back its events and when it settled. */
async function called(directory, { command, ...options }) {
  const events = [];
  await runCommand({ command, args: [], cwd: directory, env: {}, timeout: UNREACHED, emitter: { emit: (event, fields) => events.push({ event, ...fields }) }, ...options });
  return { events, settled: Date.now() };
}

/**
 * Has L0 kill `started`, a group as a dead engine leaves it, through a start's kill of a recorded
 * group, and hands back its events and when it settled.
 */
async function startKilled(started, options) {
  const events = [];
  await killRecordedGroup({ group: started.group, started: started.started, emitter: { emit: (event, fields) => events.push({ event, ...fields }) }, ...options });
  return { events, settled: Date.now() };
}

/**
 * A Node process of its own, whose arguments are a scratch directory and a JSON object of options:
 * it starts `$here/command` through L0's adapter with the `ps` stand-in `ps` names where it names
 * one, read timeout `readTimeout`, dispatch directory `directory` where given, and `signalStandIn`'s
 * signal call refusing `refused` and leaving `unkept`, as `standIn` does. It appends each `L0`
 * event, and each signal sent, to `events` and `pairs` as lines of JSON. It waits until the command
 * marks `up`, then exits 0 while the call is still running, so its exit cleanup ends the group.
 */
const CALLER = [
  `import { runCommand } from ${JSON.stringify(new URL('../src/substrate/process.mjs', import.meta.url).href)};`,
  `import { signalStandIn } from ${JSON.stringify(new URL('./signal-stand-in.mjs', import.meta.url).href)};`,
  "import { appendFileSync, existsSync, readFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  'const here = process.argv[2];',
  'const options = JSON.parse(process.argv[3]);',
  "const pidIn = (name) => (name && existsSync(join(here, `${name}.pid`)) ? Number(readFileSync(join(here, `${name}.pid`), 'utf8')) : undefined);",
  'const signalled = signalStandIn({ refused: () => pidIn(options.refused), unkept: () => pidIn(options.unkept) });',
  "const kill = (target, name) => { appendFileSync(join(here, 'pairs'), `${JSON.stringify([target, name, Date.now()])}\\n`); return signalled(target, name); };",
  "const emitter = { emit: (event, fields) => appendFileSync(join(here, 'events'), `${JSON.stringify({ event, ...fields })}\\n`) };",
  "runCommand({ command: join(here, 'command'), args: [], cwd: here, env: {}, timeout: 600_000, emitter, kill, readTimeout: options.readTimeout, directory: options.directory, ps: options.ps && join(here, options.ps) });",
  "while (!existsSync(join(here, 'up'))) await new Promise((resolve) => setImmediate(resolve));",
  "appendFileSync(join(here, 'exiting'), String(Date.now()));",
  'process.exit(0);',
].join('\n');

/** Lines of JSON a caller in `directory` appended to `name`, each parsed, or none. */
const linesOf = (directory, name) => (existsSync(join(directory, name)) ? readFileSync(join(directory, name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

/**
 * Runs `CALLER` in `directory` under `options`, and settles once it has ended, on its exit status,
 * its events, the signals it sent, and when it began to exit and when it had ended.
 */
async function cleanedUp(directory, options) {
  const caller = join(directory, 'caller.mjs');
  writeFileSync(caller, CALLER);
  const run = spawn(process.execPath, [caller, directory, JSON.stringify({ readTimeout: CLEANUP_BOUND, ...options })], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  run.stderr.on('data', (chunk) => { stderr += chunk; });
  const [status] = await once(run, 'exit');
  const ended = Date.now();
  return { status, stderr, events: linesOf(directory, 'events'), pairs: linesOf(directory, 'pairs'), exiting: Number(read(directory, 'exiting')), ended };
}

/** The `[target, signal]` of each pair in `pairs` that sends `SIGSTOP` to a process group. */
const groupStops = (pairs) => pairs.filter(([target, name]) => target < 0 && name === 'SIGSTOP');

/** How many of `pairs` send `SIGKILL` to the group `group`. */
const groupKills = (pairs, group) => pairs.filter(([target, name]) => target === -group && name === 'SIGKILL').length;

/** Each event's name, pid, name and command line, and reason where it has one. */
const shown = (events) => events.map(({ event, pid, name, cmd, reason }) => ({ event, pid, name, cmd, ...(reason === undefined ? {} : { reason }) }));

/** What a `tail` following `$here/hold` in `directory` is recorded as: its name and command line. */
const tailOf = (directory) => ({ name: 'tail', cmd: `/usr/bin/tail -f ${directory}/hold` });

// proves R-STATE-18
test('L0 sends SIGSTOP to no process group on the call\'s containment, a start\'s kill of a recorded group, or the exit cleanup', SETTLES_WITHIN, async (t) => {
  const call = holding(t);
  const calling = standIn(call);
  let group;
  await called(call, { command: leavingTwo(call), kill: calling.kill, onGroup: (id) => { group = id; } });

  const start = holding(t);
  const started = await startGroup(t, start, 'group');
  const starting = standIn(start);
  await startKilled(started, { kill: starting.kill });

  const exit = holding(t);
  holdingTwo(exit);
  const { pairs } = await cleanedUp(exit, {});

  for (const [where, sent, killed] of [['the call', calling.pairs, group], ['a start', starting.pairs, started.group], ['the exit cleanup', pairs, pidIn(exit, 'group')]]) {
    assert.ok(groupKills(sent, killed) > 0, `${where} sent no kill to its group, so the test proves nothing`);
    assert.deepEqual(groupStops(sent), [], `${where} stopped a process group`);
  }
});

// proves R-STATE-12, R-STATE-7
test('on the call\'s containment, a survivor the census named is recorded by name and command line, and one no read before the kill named is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const { events } = await called(directory, { command: leavingTwo(directory), ps: cuttingTwo(directory) });

  assert.deepEqual(events.map(({ event, pid, name, cmd }) => ({ event, pid, name, cmd })), [
    { event: 'survivor.killed', pid: pidIn(directory, 'one'), ...tailOf(directory) },
    { event: 'group.killed', pid: undefined, name: undefined, cmd: undefined },
  ]);
  assert.match(events[1].census, /live process the census and the kill had not named/);
  assert.deepEqual(['one', 'two'].map((name) => alive(pidIn(directory, name))), [false, false]);
});

// proves R-STATE-12, R-STATE-10
test('on a start\'s kill of a recorded group, a member the census named is recorded by name and command line, and one no read before the kill named is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'two.pid'), String(started.member));

  const { events } = await startKilled(started, { ps: cuttingTwo(directory) });

  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [
    { event: 'recorded.killed', pid: started.leader },
    { event: 'group.killed', pid: undefined },
  ]);
  assert.match(events[1].census, /live process the census and the kill had not named/);
  assert.deepEqual([started.leader, started.member].map(alive), [false, false]);
});

// proves R-STATE-12, R-STATE-9
test('on the exit cleanup, a survivor the census named is recorded by name and command line, and one no read before the kill named is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  cuttingTwo(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps' });

  assert.equal(status, 0);
  const one = pidIn(directory, 'one');
  assert.deepEqual(events.filter(({ pid }) => pid === one).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
  assert.deepEqual(events.filter(({ event }) => event === 'group.killed').map(({ census }) => /live process/.test(census)), [true]);
  assert.deepEqual(['one', 'two'].map((name) => alive(pidIn(directory, name))), [false, false]);
});

// proves R-STATE-19, R-STATE-12
test('given a process-table tool that fails every read, the call sends the kill on more than one look, records the kill of the group naming why, and settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // `one` outlives the kill, so the group is still there for the look after the first.
  const signals = standIn(directory, { unkept: 'one' });
  let group;

  const { events } = await called(directory, { command: leavingTwo(directory), ps: failing(directory), kill: signals.kill, onGroup: (id) => { group = id; } });

  assert.ok(groupKills(signals.pairs, group) > 1, `the call sent the kill to its group ${groupKills(signals.pairs, group)} time(s)`);
  // `one` outlives the kill and holds the command's output, so the call records that hold too.
  assert.deepEqual(events.map(({ event }) => event), ['group.killed', 'output.held']);
  assert.match(events[0].census, /ps: failing on purpose/);
});

// proves R-STATE-19, R-STATE-10
test('given a process-table tool that fails every read but the start times\', a start\'s kill sends the kill on more than one look, records the kill of the group naming why, and settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { unkept: 'member' });

  const { events } = await startKilled(started, { ps: failing(directory), kill: signals.kill });

  assert.ok(groupKills(signals.pairs, started.group) > 1, `the start sent the kill to the group ${groupKills(signals.pairs, started.group)} time(s)`);
  assert.deepEqual(events.map(({ event }) => event), ['group.killed']);
  assert.match(events[0].census, /ps: failing on purpose/);
});

// proves R-STATE-19, R-STATE-9
test('given a process-table tool that fails every read, the exit cleanup sends the kill on more than one look, records the kill of the group naming why, and the caller ends', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  failing(directory);

  const { status, events, pairs } = await cleanedUp(directory, { ps: 'ps', unkept: 'one' });

  assert.equal(status, 0);
  const group = pidIn(directory, 'group');
  assert.ok(groupKills(pairs, group) > 1, `the cleanup sent the kill to the group ${groupKills(pairs, group)} time(s)`);
  assert.deepEqual(events.map(({ event }) => event), ['group.killed']);
  assert.match(events[0].census, /ps: failing on purpose/);
});

// proves R-STATE-19
test('given a member L0 may not signal and another, the call ends the other, records the first as a process it could not end because of EPERM, and settles before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { refused: 'one' });

  const { events, settled } = await called(directory, { command: leavingTwo(directory), kill: signals.kill });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(two), false, 'the member L0 may signal is alive');
  assert.equal(alive(one), true, 'the member L0 may not signal was ended, so the test proves nothing');
  // `one` outlives the call and holds the command's output, so the call records that hold too.
  assert.deepEqual(events.filter(({ event }) => event === 'output.held').length, 1);
  assert.deepEqual(shown(events.filter(({ event }) => event !== 'output.held')).sort((a, b) => a.pid - b.pid), [
    { event: 'survivor.unended', pid: one, ...tailOf(directory), reason: 'EPERM' },
    { event: 'survivor.killed', pid: two, ...tailOf(directory) },
  ].sort((a, b) => a.pid - b.pid));
  assert.ok(settled - signals.first.at < KILL_BOUND, `the call settled ${settled - signals.first.at} ms after its first kill`);
});

// proves R-STATE-19, R-STATE-10
test('given a recorded group with a member L0 may not signal, a start ends the leader, records the member as a process it could not end because of EPERM, and settles before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { refused: 'member' });

  const { events, settled } = await startKilled(started, { kill: signals.kill });

  assert.equal(alive(started.leader), false, 'the leader is alive');
  assert.equal(alive(started.member), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assert.deepEqual(events.filter(({ pid }) => pid === started.member).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason })), [
    { event: 'recorded.unended', ...tailOf(directory), reason: 'EPERM' },
  ]);
  assert.ok(settled - signals.first.at < KILL_BOUND, `the start settled ${settled - signals.first.at} ms after its first kill`);
});

// proves R-STATE-19, R-STATE-9
test('given a member L0 may not signal, the exit cleanup ends the others, records it as a process it could not end because of EPERM, and the caller ends before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);

  const { status, events, exiting, ended } = await cleanedUp(directory, { refused: 'one' });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(status, 0);
  assert.equal(alive(two), false, 'the member L0 may signal is alive');
  assert.equal(alive(one), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assert.deepEqual(events.filter(({ pid }) => pid === one).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason })), [
    { event: 'survivor.unended', ...tailOf(directory), reason: 'EPERM' },
  ]);
  assert.ok(ended - exiting < KILL_BOUND, `the caller ended ${ended - exiting} ms after it began to exit`);
});

// proves R-STATE-19
test('given a member the kill does not end, the call settles once KILL_BOUND has passed since its first kill, and records it as a process it could not end, alive at the bound', OUTLASTS_KILL_BOUND, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { unkept: 'one' });

  const { events, settled } = await called(directory, { command: leavingTwo(directory), kill: signals.kill });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(one), true, 'the member the kill does not end was ended, so the test proves nothing');
  assert.equal(alive(two), false, 'the other member is alive');
  assert.deepEqual(events.filter(({ pid }) => pid === one).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason })), [
    { event: 'survivor.unended', ...tailOf(directory), reason: `still alive ${KILL_BOUND} ms after L0's first kill` },
  ]);
  assert.ok(settled - signals.first.at >= KILL_BOUND, `the call settled ${settled - signals.first.at} ms after its first kill`);
});

// proves R-STATE-19, R-STATE-10
test('given a recorded group with a member the kill does not end, a start settles once KILL_BOUND has passed since its first kill, and records it as a process it could not end, alive at the bound', OUTLASTS_KILL_BOUND, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { unkept: 'member' });

  const { events, settled } = await startKilled(started, { kill: signals.kill });

  assert.equal(alive(started.member), true, 'the member the kill does not end was ended, so the test proves nothing');
  assert.deepEqual(events.filter(({ pid }) => pid === started.member).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason })), [
    { event: 'recorded.unended', ...tailOf(directory), reason: `still alive ${KILL_BOUND} ms after L0's first kill` },
  ]);
  assert.ok(settled - signals.first.at >= KILL_BOUND, `the start settled ${settled - signals.first.at} ms after its first kill`);
});

// proves R-STATE-19, R-STATE-9
test('given a member the kill does not end, the exit cleanup records it as a process it could not end, alive at the cleanup\'s own bound, and waits on no longer bound', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);

  const { status, events, pairs, ended } = await cleanedUp(directory, { unkept: 'one' });

  const one = pidIn(directory, 'one');
  assert.equal(status, 0);
  assert.equal(alive(one), true, 'the member the kill does not end was ended, so the test proves nothing');
  assert.deepEqual(events.filter(({ pid }) => pid === one).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason })), [
    { event: 'survivor.unended', ...tailOf(directory), reason: `still alive ${CLEANUP_BOUND} ms after L0's first kill` },
  ]);
  const first = pairs.find(([target, name]) => target < 0 && name === 'SIGKILL')[2];
  assert.ok(ended - first < KILL_BOUND, `the caller ended ${ended - first} ms after its first kill`);
});

/** A dispatch's directory in `directory`, `work`, holding a `tail` outside every group, as `outside.pid`. */
async function workedIn(t, directory) {
  const work = join(directory, 'work');
  mkdirSync(work);
  writeFileSync(join(directory, 'outside.pid'), String(await tailIn(t, directory, join(work, 'sub'))));
  return work;
}

/** Asserts the census recorded the outside process in `events` as one it could not end, for `reason`, and nowhere as killed. */
function assertUnended(directory, events, event, reason) {
  const outside = pidIn(directory, 'outside');
  assert.deepEqual(events.filter(({ pid }) => pid === outside).map(({ event: name, name: command, cmd, reason: why }) => ({ event: name, name: command, cmd, reason: why })), [
    { event, ...tailOf(directory), reason },
  ]);
  assert.equal(alive(outside), true, 'the census ended the outside process, so the test proves nothing');
  assert.ok(!processState(outside).startsWith('T'), `the census left the outside process stopped: ${processState(outside)}`);
}

// proves R-STATE-19
test('given a dispatch\'s directory holding a process L0 may not signal, the call\'s census records it as a process it could not end because of EPERM, and settles before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const signals = standIn(directory, { refused: 'outside' });
  const began = Date.now();

  const { events, settled } = await called(directory, { command: '/usr/bin/true', directory: work, kill: signals.kill });

  assertUnended(directory, events, 'survivor.unended', 'EPERM');
  assert.ok(settled - began < KILL_BOUND, `the call settled ${settled - began} ms after it began`);
});

// proves R-STATE-19
test('given a dispatch\'s directory holding a process the kill does not end, the call\'s census settles once KILL_BOUND has passed since its kill, records it as a process it could not end, alive at the bound, and leaves it running', OUTLASTS_KILL_BOUND, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const signals = standIn(directory, { unkept: 'outside' });
  const outside = pidIn(directory, 'outside');

  const { events, settled } = await called(directory, { command: '/usr/bin/true', directory: work, kill: signals.kill });

  assertUnended(directory, events, 'survivor.unended', `still alive ${KILL_BOUND} ms after L0's kill`);
  const killed = signals.pairs.findIndex(([target, name]) => target === outside && name === 'SIGKILL');
  assert.ok(killed >= 0, 'the census never sent the outside process its kill, so the test proves nothing');
});

// proves R-STATE-19, R-STATE-10
test('given a recorded dispatch\'s directory holding a process L0 may not signal, a start\'s sweep records it as a process it could not end because of EPERM, and settles before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const started = await startGroup(t, directory, 'group');
  const signals = standIn(directory, { refused: 'outside' });
  const began = Date.now();

  const { events, settled } = await startKilled(started, { directory: work, identity: identityOf(work), kill: signals.kill });

  assertUnended(directory, events, 'recorded.unended', 'EPERM');
  assert.ok(settled - began < KILL_BOUND, `the start settled ${settled - began} ms after it began`);
});

// proves R-STATE-19, R-STATE-10
test('given a recorded dispatch\'s directory holding a process the kill does not end, a start\'s sweep settles once KILL_BOUND has passed, records it as a process it could not end, alive at the bound, and leaves it running', OUTLASTS_KILL_BOUND, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const started = await startGroup(t, directory, 'group');
  const signals = standIn(directory, { unkept: 'outside' });
  const began = Date.now();

  const { events, settled } = await startKilled(started, { directory: work, identity: identityOf(work), kill: signals.kill });

  assertUnended(directory, events, 'recorded.unended', `still alive ${KILL_BOUND} ms after L0's kill`);
  assert.ok(settled - began >= KILL_BOUND, `the start settled ${settled - began} ms after it began`);
});

// proves R-STATE-19, R-STATE-9
test('given a dispatch\'s directory holding a process L0 may not signal, the exit cleanup\'s census records it as a process it could not end because of EPERM, and the caller ends before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);

  const { status, events, exiting, ended } = await cleanedUp(directory, { directory: work, refused: 'outside' });

  assert.equal(status, 0);
  assertUnended(directory, events, 'survivor.unended', 'EPERM');
  assert.ok(ended - exiting < KILL_BOUND, `the caller ended ${ended - exiting} ms after it began to exit`);
});

// proves R-STATE-19, R-STATE-9
test('given a dispatch\'s directory holding a process the kill does not end, the exit cleanup\'s census records it as a process it could not end, alive at the cleanup\'s own bound, and leaves it running', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);

  const { status, events, exiting, ended } = await cleanedUp(directory, { directory: work, unkept: 'outside' });

  assert.equal(status, 0);
  assertUnended(directory, events, 'survivor.unended', `still alive ${CLEANUP_BOUND} ms after L0's kill`);
  assert.ok(ended - exiting < KILL_BOUND, `the caller ended ${ended - exiting} ms after it began to exit`);
});
