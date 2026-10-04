// ABOUTME: Tests that L0 contains a group without ever stopping it, on the call's containment, a
// start's kill of a recorded group and the exit cleanup: what it records by name and as the group's
// kill, and how it settles where it cannot read the table, may not signal a process, or cannot end
// one, in a group and in a dispatch's directory alike.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

import { KILL_BOUND, UNREAPED_BOUND, identityOf, killRecordedGroup, runCommand } from '../src/substrate/process.mjs';
import { TAIL, alive, fixture, holding, leave, processState, read, startGroup, tailIn, until, warmed } from './process-fixtures.mjs';
import { signalStandIn } from './signal-stand-in.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { listingOf } from './listing-stand-in.mjs';

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
 * names refused, the one `$here/<unkept>.pid` names unkept, and the one `$here/<flickers>.pid` names
 * flickering, each once it is there, the time of
 * its first kill of a group in `first.at`, and `killedAt(target)`, when it first sent `target` the
 * kill, or nothing where it never did.
 */
function standIn(directory, { refused, unkept, flickers, outlasts, pairs = [] } = {}) {
  const first = {};
  const kills = new Map();
  const kill = signalStandIn({ pairs, refused: () => refused && pidIn(directory, refused), unkept: () => unkept && pidIn(directory, unkept), flickers: () => flickers && pidIn(directory, flickers), outlasts: () => outlasts && pidIn(directory, outlasts) });
  return {
    pairs,
    first,
    killedAt: (target) => kills.get(target),
    kill: (target, name) => {
      if (name === 'SIGKILL' && !kills.has(target)) kills.set(target, Date.now());
      if (target < 0 && name === 'SIGKILL') first.at ??= Date.now();
      return kill(target, name);
    },
  };
}

/** When `pairs`, the signals a caller sent, as `[target, signal, time]`, first sent the kill to `target`. */
const killedIn = (pairs, target) => pairs.find(([to, name]) => to === target && name === 'SIGKILL')?.[2];

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
 * one, the `lsof` stand-in `lsof` names where it names one, read timeout `readTimeout`, dispatch
 * directory `directory` where given, and `signalStandIn`'s
 * signal call refusing `refused` and leaving `unkept`, as `standIn` does. It appends each `L0`
 * event, and each signal sent, to `events` and `pairs` as lines of JSON. Where `hangAfter` names a
 * pid file, or `group` for `group.pid`'s group, it marks `hang` as it first sends that target the
 * kill, so that `hanging`'s reads hang from then on. `flickers` names a pid file whose pid
 * flickers, as `signalStandIn` has it. The step it hands the adapter for the exit writes how the
 * command ended to `ending` as JSON. It waits until the command
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
  'const signalled = signalStandIn({ refused: () => pidIn(options.refused), unkept: () => pidIn(options.unkept), flickers: () => pidIn(options.flickers), outlasts: () => pidIn(options.outlasts) });',
  "const hangs = () => (options.hangAfter === 'group' ? -pidIn('group') : pidIn(options.hangAfter));",
  "const kill = (target, name) => { appendFileSync(join(here, 'pairs'), `${JSON.stringify([target, name, Date.now()])}\\n`); if (name === 'SIGKILL' && options.hangAfter && target === hangs()) appendFileSync(join(here, 'hang'), ''); return signalled(target, name); };",
  "const emitter = { emit: (event, fields) => appendFileSync(join(here, 'events'), `${JSON.stringify({ event, ...fields })}\\n`) };",
  "const onExit = (group, ending) => appendFileSync(join(here, 'ending'), JSON.stringify(ending));",
  "runCommand({ command: join(here, 'command'), args: [], cwd: here, env: {}, timeout: 600_000, emitter, kill, onExit, readTimeout: options.readTimeout, directory: options.directory, ps: options.ps && join(here, options.ps), lsof: options.lsof && join(here, options.lsof) });",
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

/** Each of `events` by its name and pid, and by its name and command line where it carries them, ordered by pid. */
const byPid = (events) => events.map(({ event, pid, name, cmd }) => ({ event, pid, name, cmd })).sort((one, other) => (one.pid ?? 0) - (other.pid ?? 0));

// proves R-STATE-12, R-STATE-7
test('on the call\'s containment, a survivor the census named, and one only the read just before the kill found, are each recorded by name and command line', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const { events } = await called(directory, { command: leavingTwo(directory), ps: cuttingTwo(directory) });

  assert.deepEqual(byPid(events), byPid(['one', 'two'].map((name) => ({ event: 'survivor.killed', pid: pidIn(directory, name), ...tailOf(directory) }))));
  assert.deepEqual(['one', 'two'].map((name) => alive(pidIn(directory, name))), [false, false]);
});

// proves R-STATE-12, R-STATE-10
test('on a start\'s kill of a recorded group, a member the census named, and one only the read just before the kill found, are each recorded by name and command line', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'two.pid'), String(started.member));

  const { events } = await startKilled(started, { ps: cuttingTwo(directory) });

  assert.deepEqual(byPid(events).map(({ event, pid, name }) => ({ event, pid, named: name !== undefined })), byPid([
    { event: 'recorded.killed', pid: started.leader },
    { event: 'recorded.killed', pid: started.member },
  ]).map(({ event, pid }) => ({ event, pid, named: true })));
  assert.deepEqual(events.find(({ pid }) => pid === started.member).cmd, `/usr/bin/tail -f ${directory}/hold`);
  assert.deepEqual([started.leader, started.member].map(alive), [false, false]);
});

// proves R-STATE-12, R-STATE-9
test('on the exit cleanup, a survivor the census named, and one only the read just before the kill found, are each recorded by name and command line', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  cuttingTwo(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps' });

  assert.equal(status, 0);
  const pids = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.deepEqual(byPid(events.filter(({ pid }) => pids.includes(pid))), byPid(pids.map((pid) => ({ event: 'survivor.killed', pid, ...tailOf(directory) }))));
  assert.deepEqual(events.filter(({ event }) => event === 'group.killed'), []);
  assert.deepEqual(pids.map(alive), [false, false]);
});

/**
 * A `ps` stand-in that cuts the process `$here/two.pid` names out of every read until `$here/hang`
 * marks that L0 has sent its group the kill, and answers every read as `ps` does from then on.
 */
const hidingTwoUntilKilled = (directory) => warmed(fixture(directory, 'ps', [
  '[ -f "$here/hang" ] && exec /bin/ps "$@"',
  '/bin/ps "$@" | /usr/bin/grep -v "^ *$(/bin/cat "$here/two.pid") "',
  'exit 0',
].join('\n')));

/**
 * The signal call `standIn` hands back, which also marks `$here/hang` as it first sends the group
 * the kill, and passes `outlasts`'s process over for the first two kills.
 */
function markingKill(directory, signals) {
  return (target, name) => {
    if (target < 0 && name === 'SIGKILL') writeFileSync(join(directory, 'hang'), '');
    return signals.kill(target, name);
  };
}

// proves R-STATE-12, R-STATE-7
test('on the call\'s containment, a member no read before the kill found, which a read after it finds alive, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { outlasts: 'two' });

  const { events } = await called(directory, { command: leavingTwo(directory), ps: hidingTwoUntilKilled(directory), kill: markingKill(directory, signals) });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [{ event: 'survivor.killed', pid: one }, { event: 'group.killed', pid: undefined }]);
  assert.match(events[1].census, /a read after the kill found/);
  assert.deepEqual([one, two].map(alive), [false, false]);
});

// proves R-STATE-12, R-STATE-10
test('on a start\'s kill of a recorded group, a member no read before the kill found, which a read after it finds alive, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'two.pid'), String(started.member));
  const signals = standIn(directory, { outlasts: 'two' });

  const { events } = await startKilled(started, { ps: hidingTwoUntilKilled(directory), kill: markingKill(directory, signals) });

  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [{ event: 'recorded.killed', pid: started.leader }, { event: 'group.killed', pid: undefined }]);
  assert.match(events[1].census, /a read after the kill found/);
  assert.deepEqual([started.leader, started.member].map(alive), [false, false]);
});

// proves R-STATE-12, R-STATE-9
test('on the exit cleanup, a member no read before the kill found, which a read after it finds alive, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  hidingTwoUntilKilled(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group', outlasts: 'two' });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(status, 0);
  assert.deepEqual(events.filter(({ pid }) => pid === one || pid === two).map(({ event, pid }) => ({ event, pid })), [{ event: 'survivor.killed', pid: one }]);
  assert.deepEqual(events.filter(({ event }) => event === 'group.killed').length, 1);
  assert.deepEqual([one, two].map(alive), [false, false]);
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

  const { status, events, pairs, exiting, ended } = await cleanedUp(directory, { unkept: 'one' });

  const one = pidIn(directory, 'one');
  assert.equal(status, 0);
  assert.equal(alive(one), true, 'the member the kill does not end was ended, so the test proves nothing');
  assert.deepEqual(events.filter(({ pid }) => pid === one).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason })), [
    { event: 'survivor.unended', ...tailOf(directory), reason: `still alive when the exit cleanup's read bound of ${CLEANUP_BOUND} ms ran out` },
  ]);
  // The cleanup's confirmation reads until its own bound has passed since it began, which is after
  // the caller began to exit, and records the member only then.
  assert.ok(ended - exiting >= CLEANUP_BOUND, `the caller ended ${ended - exiting} ms after it began to exit, before the cleanup's own bound of ${CLEANUP_BOUND} ms`);
  const first = killedIn(pairs, -pidIn(directory, 'group'));
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
  const killed = signals.killedAt(outside);
  assert.ok(killed !== undefined, 'the census never sent the outside process its kill, so the test proves nothing');
  assert.ok(settled - killed >= KILL_BOUND, `the call settled ${settled - killed} ms after the census's kill of the outside process`);
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

  const { events, settled } = await startKilled(started, { directory: work, identity: identityOf(work), kill: signals.kill });

  assertUnended(directory, events, 'recorded.unended', `still alive ${KILL_BOUND} ms after L0's kill`);
  const killed = signals.killedAt(pidIn(directory, 'outside'));
  assert.ok(killed !== undefined, 'the sweep never sent the outside process its kill, so the test proves nothing');
  assert.ok(settled - killed >= KILL_BOUND, `the start settled ${settled - killed} ms after the sweep's kill of the outside process`);
});

// proves R-STATE-19, R-STATE-9
test('given a dispatch\'s directory holding a process L0 may not signal, the exit cleanup\'s census records it as a process it could not end because of EPERM, and the caller ends before KILL_BOUND', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);

  warmed(fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub')))));
  const { status, events, exiting, ended } = await cleanedUp(directory, { directory: work, lsof: 'lsof', refused: 'outside' });

  assert.equal(status, 0);
  assertUnended(directory, events, 'survivor.unended', 'EPERM');
  assert.ok(ended - exiting < KILL_BOUND, `the caller ended ${ended - exiting} ms after it began to exit`);
});

// proves R-STATE-19, R-STATE-9
test('given a dispatch\'s directory holding a process the kill does not end, the exit cleanup\'s census records it as a process it could not end, alive at the cleanup\'s own bound, and leaves it running', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);

  const { status, events, pairs, exiting, ended } = await cleanedUp(directory, { directory: work, unkept: 'outside' });

  assert.equal(status, 0);
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  const killed = killedIn(pairs, pidIn(directory, 'outside'));
  assert.ok(killed !== undefined, 'the census never sent the outside process its kill, so the test proves nothing');
  // The census waits on what it killed within the cleanup's own bound from its kill, which is after
  // the caller began to exit, and records the process only once that bound has passed.
  assert.ok(ended - exiting >= CLEANUP_BOUND, `the caller ended ${ended - exiting} ms after it began to exit, before the cleanup's own bound of ${CLEANUP_BOUND} ms`);
  assert.ok(ended - killed < KILL_BOUND, `the caller ended ${ended - killed} ms after the census's kill of the outside process`);
});

/**
 * A `ps` stand-in that, until `$here/hang` exists, holds the census's read of the outside process's
 * name, `-p <pid> -o ucomm=`, marking `$here/held`, until the census's own bound gives it up, and
 * answers every other read as `ps` does. So the census's bound runs out after it has stopped the
 * process and listed it again, and before it has read its name (#579).
 */
const holdingName = (directory) => warmed(fixture(directory, 'ps', [
  'if [ ! -f "$here/hang" ] && [ "$*" = "-p $(/bin/cat "$here/outside.pid") -o ucomm=" ]; then : > "$here/held"; exec /usr/bin/tail -f "$here/hold"; fi',
  'exec /bin/ps "$@"',
].join('\n')));

// proves R-STATE-19, R-STATE-9
test('given a census of a dispatch\'s directory whose bound runs out after it has stopped and listed again a process the kill does not end, and before it has read that process\'s name, the exit cleanup still records it by name and command line as alive at the cleanup\'s own bound of its kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  holdingName(directory);
  warmed(fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub')))));

  const { status, events, pairs } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside' });

  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'held')), 'the census never read the outside process\'s name before its kill, so the test proves nothing');
  assert.ok(events.some(({ event }) => event === 'directory.unread'), 'the census\'s reads before its kill answered within its bound, so the test proves nothing');
  assert.ok(killedIn(pairs, pidIn(directory, 'outside')) !== undefined, 'the census never sent the outside process its kill, so the test proves nothing');
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
});

// proves R-STATE-18, R-STATE-19
test('given a dispatch\'s directory holding a process the kill does not end, and a process table that cannot be read once the census has sent that kill, the census resumes the process and records it as a process it could not end, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const signals = standIn(directory, { unkept: 'outside' });
  const outside = pidIn(directory, 'outside');
  // The signal call marks `killed` once the census has sent the outside process its kill, and the
  // stand-in for `ps` fails every read from then on.
  const kill = (target, name) => {
    if (target === outside && name === 'SIGKILL') writeFileSync(join(directory, 'killed'), '');
    return signals.kill(target, name);
  };
  const ps = warmed(fixture(directory, 'ps', '[ -f "$here/killed" ] && { echo "ps: failing on purpose" >&2; exit 2; }\nexec /bin/ps "$@"'));

  const { events } = await called(directory, { command: '/usr/bin/true', directory: work, kill, ps });

  assert.ok(signals.killedAt(outside) !== undefined, 'the census never sent the outside process its kill, so the test proves nothing');
  const recorded = events.filter(({ pid }) => pid === outside);
  assert.deepEqual(recorded.map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.unended', ...tailOf(directory) }]);
  assert.match(recorded[0].reason, /could not be read/);
  assert.equal(alive(outside), true, 'the census ended the outside process, so the test proves nothing');
  assert.ok(!processState(outside).startsWith('T'), `the census left the outside process stopped: ${processState(outside)}`);
});

/** A `ps` stand-in that answers every read as `ps` does until `$here/hang` exists, and from then on never answers. */
const hanging = (directory) => warmed(fixture(directory, 'ps', '[ -f "$here/hang" ] && exec /usr/bin/tail -f "$here/hold"\nexec /bin/ps "$@"'));

// proves R-STATE-19, R-STATE-9
test('given a process table that stops answering once the exit cleanup has sent its first kill of a group, the caller ends within the cleanup\'s own bound of that kill, and the group\'s members are not alive', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  hanging(directory);

  const { status, pairs, ended } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group' });

  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'hang')), 'the cleanup never sent the group its kill, so the test proves nothing');
  assert.deepEqual(['one', 'two'].map((name) => alive(pidIn(directory, name))), [false, false]);
  // The cleanup's reads after that kill are given up at its own bound, read by read, so only the
  // time it takes to end the process lies past it.
  const first = killedIn(pairs, -pidIn(directory, 'group'));
  assert.ok(ended - first < CLEANUP_BOUND + UNREAPED_BOUND / 2, `the caller ended ${ended - first} ms after its first kill, against the cleanup's own bound of ${CLEANUP_BOUND} ms`);
});

// proves R-STATE-19, R-STATE-9
test('given a process table that stops answering once the exit cleanup\'s census has sent its kill to a process in the dispatch\'s directory that outlives it, the caller ends within the cleanup\'s own bound of that kill, and the process is recorded as one it could not end and not left stopped', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  hanging(directory);

  warmed(fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub')))));
  const { status, events, pairs, ended } = await cleanedUp(directory, { ps: 'ps', directory: work, lsof: 'lsof', hangAfter: 'outside', unkept: 'outside' });

  const outside = pidIn(directory, 'outside');
  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'hang')), 'the census never sent the outside process its kill, so the test proves nothing');
  assert.deepEqual(events.filter(({ pid }) => pid === outside).map(({ event }) => event), ['survivor.unended']);
  assert.equal(alive(outside), true, 'the census ended the outside process, so the test proves nothing');
  assert.ok(!processState(outside).startsWith('T'), `the census left the outside process stopped: ${processState(outside)}`);
  const killed = killedIn(pairs, outside);
  assert.ok(ended - killed < CLEANUP_BOUND + UNREAPED_BOUND / 2, `the caller ended ${ended - killed} ms after the census's kill, against the cleanup's own bound of ${CLEANUP_BOUND} ms`);
});

/**
 * Stand-ins for `lsof` and `ps` that answer the census's reads of the outside process in `directory`
 * at once, so that no read it makes waits on the host. Each answer is what the real tool printed for
 * that process before the cleanup began: its listing as working in the dispatch's directory, its
 * name and its command line. Its state is read as stopped, `T`: the census reads states only of
 * processes it has stopped, and this one stays stopped until the census resumes it after its wait,
 * since its kill is not sent. `lsof` answers so until `$here/hang` exists, and from then on never
 * answers. `ps` answers the exit cleanup's reads of the command's group as well, which come before
 * the census, so that no real read of the group can run out its bound and leave the census's reads
 * refused. The group holds one process, the command, whose pid is the group's: read live, `S`, until
 * the caller has sent the group its kill, and from then on a zombie, `Z`, with `SIGKILL`'s wait
 * status, `9`, since the caller, exiting, does not reap it. Any other read fails, naming itself.
 */
function answeringAtOnce(directory) {
  const pid = read(directory, 'outside.pid');
  const tool = (path, args) => spawnSync(path, args, { env: {}, encoding: 'utf8' }).stdout;
  writeFileSync(join(directory, 'listed'), tool('/usr/sbin/lsof', ['-w', '-n', '-P', '-a', '-d', 'cwd', '-u', String(process.getuid()), '-p', pid, '-F', 'pun']));
  writeFileSync(join(directory, 'ucomm'), tool('/bin/ps', ['-p', pid, '-o', 'ucomm=']));
  writeFileSync(join(directory, 'cmdline'), tool('/bin/ps', ['-ww', '-p', pid, '-o', 'pid=,command=']));
  warmed(fixture(directory, 'lsof', '[ -f "$here/hang" ] && exec /usr/bin/tail -f "$here/hold"\nexec /bin/cat "$here/listed"'));
  warmed(fixture(directory, 'ps', [
    'pid=$(/bin/cat "$here/outside.pid")',
    'case "$*" in',
    '  "-p $pid -o pid=,stat=") echo "$pid T"; exit 0 ;;',
    '  "-p $pid -o ucomm=") exec /bin/cat "$here/ucomm" ;;',
    '  "-ww -p $pid -o pid=,command=") exec /bin/cat "$here/cmdline" ;;',
    'esac',
    'for each; do case $last in -g|-p) group=$each ;; esac; last=$each; done',
    'state=S; status=0',
    '/usr/bin/grep -q "^\\[-$group,\\"SIGKILL\\"" "$here/pairs" 2>/dev/null && state=Z && status=9',
    'case $last in',
    '  pid=,stat=) echo "$group $state" ;;',
    '  pid=,stat=,xstat=) echo "$group $state $status" ;;',
    '  pid=,command=) echo "$group /bin/sh $here/command" ;;',
    '  ucomm=) echo sh ;;',
    '  *) echo "the ps stand-in has no answer for $*" >&2; exit 2 ;;',
    'esac',
  ].join('\n')));
}

// proves R-STATE-19, R-STATE-9
test('given a census of a dispatch\'s directory whose listing after its kill takes the rest of its read bound, the exit cleanup still reads the process the kill does not end, and records it by name and command line as alive at the cleanup\'s own bound of that kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  answeringAtOnce(directory);
  assert.match(read(directory, 'listed'), new RegExp(`^n${realpathSync.native(work)}/sub$`, 'm'), 'lsof did not list the outside process as working in the dispatch\'s directory, so the test proves nothing');

  const { status, events, pairs, ended } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside' });

  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'hang')), 'the census never sent the outside process its kill, so the test proves nothing');
  assert.ok(events.some(({ event }) => event === 'directory.unread'), 'the census\'s listing after its kill answered within its read bound, so the test proves nothing');
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  // The census waits on what it killed until the cleanup's own bound has passed since that kill,
  // whatever its reads before took, and no longer.
  const killed = killedIn(pairs, pidIn(directory, 'outside'));
  assert.ok(ended - killed >= CLEANUP_BOUND, `the caller ended ${ended - killed} ms after the census's kill, before the cleanup's own bound of ${CLEANUP_BOUND} ms`);
  assert.ok(ended - killed < CLEANUP_BOUND + UNREAPED_BOUND / 2, `the caller ended ${ended - killed} ms after the census's kill, against the cleanup's own bound of ${CLEANUP_BOUND} ms`);
});

// proves R-STATE-12, R-STATE-19
test('given a member that answers signal 0 with EPERM once, as it is being killed, the call records it as killed, not as a process it could not end', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { flickers: 'one' });

  const { events } = await called(directory, { command: leavingTwo(directory), kill: signals.kill });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.ok(signals.pairs.filter(([target, name]) => target === one && name === 0).length > 0, 'the call never asked signal 0 of the flickering member, so the test proves nothing');
  assert.deepEqual([one, two].map(alive), [false, false]);
  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })).sort((a, b) => a.pid - b.pid), [
    { event: 'survivor.killed', pid: one },
    { event: 'survivor.killed', pid: two },
  ].sort((a, b) => a.pid - b.pid));
});

// proves R-STATE-9, R-STATE-15, R-STATE-19
test('given a command whose leader answers signal 0 with EPERM once, as the exit cleanup kills it, the cleanup hands its step the killed command\'s exit code and records no process it could not end', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);

  const { status, events, pairs } = await cleanedUp(directory, { flickers: 'group' });

  const group = pidIn(directory, 'group');
  assert.equal(status, 0);
  assert.ok(pairs.filter(([target, name]) => target === group && name === 0).length > 0, 'the cleanup never asked signal 0 of the leader, so the test proves nothing');
  assert.deepEqual(JSON.parse(read(directory, 'ending')), { exit: 128 + constants.signals.SIGKILL });
  assert.deepEqual(events.filter(({ event }) => event.endsWith('.unended')), []);
  assert.deepEqual(['one', 'two'].map((name) => alive(pidIn(directory, name))), [false, false]);
});

/**
 * A perl program in `directory`, `joiner`, run with the scratch directory and a group's id: it
 * leaves its own group and forks a child that joins the group named and runs `tail`, writes that
 * child's pid to `$here/two.pid` once it has joined, and then blocks for good without ever reaping
 * it. So once the child is killed it stays a zombie in that group while the program lives. The
 * program names the scratch directory in its command line, so its test's teardown ends it.
 */
function zombieJoiner(directory) {
  // Perl, not a `fixture`: perl hands a file whose `#!` line names another interpreter to it.
  writeFileSync(join(directory, 'joiner'), [
    'my ($here, $group) = @ARGV;',
    'setpgrp(0, 0) or die "leave: $!";',
    'my $child = fork() // die "fork: $!";',
    'if ($child == 0) { setpgrp(0, $group) or die "join: $!"; exec "/usr/bin/tail", "-f", "$here/hold"; }',
    '1 until `/bin/ps -o pgid=,ucomm= -p $child` =~ /^\\s*$group\\s+tail/;',
    'open(my $f, ">", "$here/two.tmp") or die; print $f $child; close $f;',
    'rename("$here/two.tmp", "$here/two.pid") or die;',
    'select(undef, undef, undef, undef);',
  ].join('\n'));
  return join(directory, 'joiner');
}

/** Lines of a command that start `zombieJoiner`'s program for the command's own group, and wait until its child has joined. */
const joining = (directory) => [
  `/usr/bin/perl "${zombieJoiner(directory)}" "$here" $$ >/dev/null 2>&1 &`,
  'while [ ! -f "$here/two.pid" ]; do :; done',
].join('\n');

/** Asserts `events` record the kill of the group for the joiner, saying a read after the kill found it exited. */
function assertJoinerRecorded(events) {
  const kills = events.filter(({ event }) => event === 'group.killed');
  assert.equal(kills.length, 1, `the group's kill was not recorded once: ${JSON.stringify(events)}`);
  assert.match(kills[0].census, /a read after the kill found/);
}

// proves R-STATE-12, R-STATE-7
test('on the call\'s containment, a member no read before the kill listed, which the kill leaves a zombie, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', [leave(TAIL, 'one'), joining(directory)].join('\n'));
  const signals = standIn(directory);

  const { events } = await called(directory, { command, ps: hidingTwoUntilKilled(directory), kill: markingKill(directory, signals) });

  const two = pidIn(directory, 'two');
  assert.ok(processState(two).startsWith('Z'), `the joiner is not a zombie, so the test proves nothing: ${processState(two)}`);
  assert.deepEqual(events.filter(({ pid }) => pid !== undefined).map(({ event, pid }) => ({ event, pid })), [{ event: 'survivor.killed', pid: pidIn(directory, 'one') }]);
  assertJoinerRecorded(events);
});

// proves R-STATE-12, R-STATE-10
test('on a start\'s kill of a recorded group, a member no read before the kill listed, which the kill leaves a zombie, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  spawn('/usr/bin/perl', [zombieJoiner(directory), directory, String(started.group)], { stdio: 'ignore' });
  await until(() => existsSync(join(directory, 'two.pid')), t);
  const signals = standIn(directory);

  const { events } = await startKilled(started, { ps: hidingTwoUntilKilled(directory), kill: markingKill(directory, signals) });

  const two = pidIn(directory, 'two');
  assert.ok(processState(two).startsWith('Z'), `the joiner is not a zombie, so the test proves nothing: ${processState(two)}`);
  assertJoinerRecorded(events);
  assert.deepEqual([started.leader, started.member].map(alive), [false, false]);
});

// proves R-STATE-12, R-STATE-9
test('on the exit cleanup, a member no read before the kill listed, which the kill leaves a zombie, is recorded as the kill of the group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  fixture(directory, 'command', ['echo $$ > "$here/group.pid"', leave(TAIL, 'one'), joining(directory), ': > "$here/up"', 'while [ ! -f "$here/release" ]; do :; done'].join('\n'));
  hidingTwoUntilKilled(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group' });

  const two = pidIn(directory, 'two');
  assert.equal(status, 0);
  assert.ok(processState(two).startsWith('Z'), `the joiner is not a zombie, so the test proves nothing: ${processState(two)}`);
  assertJoinerRecorded(events);
});

/** A `ps` stand-in that answers every read as `ps` does until `$here/hang` exists, and from then on fails each as `ps` fails. */
const failingAfterKill = (directory) => warmed(fixture(directory, 'ps', '[ -f "$here/hang" ] && { echo "ps: failing on purpose" >&2; exit 2; }\nexec /bin/ps "$@"'));

/** Asserts `events` record the kill of the group in place of what reads after the kill could not list. */
function assertUnreadAfterKill(events) {
  const kills = events.filter(({ event }) => event === 'group.killed');
  assert.equal(kills.length, 1, `the group's kill was not recorded once: ${JSON.stringify(events)}`);
  assert.match(kills[0].census, /after its kill failed/);
  assert.match(kills[0].census, /ps: failing on purpose/);
}

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where every read after the kill fails, the kill of the group is recorded in place of what they could not list', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', [leave(TAIL, 'one'), joining(directory)].join('\n'));
  const signals = standIn(directory);

  const { events } = await called(directory, { command, ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  assert.ok(processState(pidIn(directory, 'two')).startsWith('Z'), 'the group did not stay occupied after the kill, so no read after it was made and the test proves nothing');
  assertUnreadAfterKill(events);
});

// proves R-STATE-19, R-STATE-10
test('on a start\'s kill of a recorded group, where every read after the kill fails, the kill of the group is recorded in place of what they could not list', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  spawn('/usr/bin/perl', [zombieJoiner(directory), directory, String(started.group)], { stdio: 'ignore' });
  await until(() => existsSync(join(directory, 'two.pid')), t);
  const signals = standIn(directory);

  const { events } = await startKilled(started, { ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  assert.ok(processState(pidIn(directory, 'two')).startsWith('Z'), 'the group did not stay occupied after the kill, so no read after it was made and the test proves nothing');
  assertUnreadAfterKill(events);
});

// proves R-STATE-19, R-STATE-9
test('on the exit cleanup, where every read after the kill fails, the kill of the group is recorded in place of what they could not list', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  fixture(directory, 'command', ['echo $$ > "$here/group.pid"', leave(TAIL, 'one'), joining(directory), ': > "$here/up"', 'while [ ! -f "$here/release" ]; do :; done'].join('\n'));
  failingAfterKill(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group' });

  assert.equal(status, 0);
  assertUnreadAfterKill(events);
});

/**
 * Asserts that `events` record `stuck`, a member L0 could not end under a table that fails every
 * read after the kill, by its name and command line as a process not shown to have ended, under
 * `unended`, with a reason matching `reason`, and never as killed; and that they record `ended`,
 * a member the kill did end, which is not alive, as killed, under `unended` with `.unended`
 * swapped for `.killed`, and not as a process not shown to have ended.
 */
function assertUnendedUnread(events, { stuck, ended, unended, directory, reason }) {
  assert.deepEqual(events.filter(({ pid }) => pid === stuck).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: unended, ...tailOf(directory) }], JSON.stringify(events));
  assert.match(events.find(({ pid }) => pid === stuck).reason, reason);
  assert.equal(events.filter(({ pid }) => pid === ended).length, 1, `the member the kill ended was not recorded once: ${JSON.stringify(events)}`);
  assert.equal(events.find(({ pid }) => pid === ended).event, unended.replace('.unended', '.killed'), `the member the kill ended was not recorded as killed: ${JSON.stringify(events)}`);
  assert.equal(alive(ended), false, 'the member the kill ended is alive');
}

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where every read after the kill fails, a member the kill leaves alive is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { unkept: 'one' });

  const { events } = await called(directory, { command: leavingTwo(directory), ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(one), true, 'the member the kill does not end was ended, so the test proves nothing');
  assertUnendedUnread(events, { stuck: one, ended: two, unended: 'survivor.unended', directory, reason: /not shown to have ended[^]*ps: failing on purpose/ });
});

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where every read after the kill fails, a member that answers EPERM is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { refused: 'one' });

  const { events } = await called(directory, { command: leavingTwo(directory), ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(one), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assertUnendedUnread(events, { stuck: one, ended: two, unended: 'survivor.unended', directory, reason: /^EPERM$/ });
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where every read after the kill fails, a member the kill leaves alive is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { unkept: 'member' });

  const { events } = await startKilled(started, { ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  assert.equal(alive(started.member), true, 'the member the kill does not end was ended, so the test proves nothing');
  assertUnendedUnread(events, { stuck: started.member, ended: started.leader, unended: 'recorded.unended', directory, reason: /not shown to have ended[^]*ps: failing on purpose/ });
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where every read after the kill fails, a member that answers EPERM is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { refused: 'member' });

  const { events } = await startKilled(started, { ps: failingAfterKill(directory), kill: markingKill(directory, signals) });

  assert.equal(alive(started.member), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assertUnendedUnread(events, { stuck: started.member, ended: started.leader, unended: 'recorded.unended', directory, reason: /^EPERM$/ });
});

/**
 * A `ps` stand-in that answers every read as `ps` does but the first read of the group's states
 * once `$here/hang` exists, which it fails as `ps` fails, marking `$here/failed`.
 */
const failingOnceAfterKill = (directory) => warmed(fixture(directory, 'ps', [
  'case "$*" in *stat=*)',
  '  if [ -f "$here/hang" ] && [ ! -f "$here/failed" ]; then : > "$here/failed"; echo "ps: failing once on purpose" >&2; exit 2; fi ;;',
  'esac',
  'exec /bin/ps "$@"',
].join('\n')));

/** Asserts that `events` record `two`, a member the kill left a zombie that later reads listed, as `killed` and as nothing else. */
function assertZombieKilled(events, directory, killed) {
  const two = pidIn(directory, 'two');
  assert.ok(existsSync(join(directory, 'failed')), 'no read after the kill failed, so the test proves nothing');
  assert.ok(processState(two).startsWith('Z'), `the member is not a zombie, so the test proves nothing: ${processState(two)}`);
  assert.deepEqual(events.filter(({ pid }) => pid === two).map(({ event }) => event), [killed], JSON.stringify(events));
}

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where only the first read after the kill fails, a member the kill left a zombie, which later reads list, is recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', [leave(TAIL, 'one'), joining(directory)].join('\n'));
  const signals = standIn(directory);

  const { events } = await called(directory, { command, ps: failingOnceAfterKill(directory), kill: markingKill(directory, signals) });

  assertZombieKilled(events, directory, 'survivor.killed');
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where only the first read after the kill fails, a member the kill left a zombie, which later reads list, is recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  spawn('/usr/bin/perl', [zombieJoiner(directory), directory, String(started.group)], { stdio: 'ignore' });
  await until(() => existsSync(join(directory, 'two.pid')), t);
  const signals = standIn(directory);

  const { events } = await startKilled(started, { ps: failingOnceAfterKill(directory), kill: markingKill(directory, signals) });

  assertZombieKilled(events, directory, 'recorded.killed');
});

/**
 * A `ps` stand-in that answers every read as `ps` does until `$here/hang` exists, and then answers
 * each read of the group's states as `ps` does until one lists the process `$here/<name>.pid` names
 * as `shown` has it, `alive` or a `zombie` beside no live process, which it copies to
 * `$here/answered`. Every read after that one it fails as `ps` fails, marking `$here/failed`.
 */
function answeringOnceAfterKill(directory, name, shown) {
  const lists = {
    alive: '$1 == pid && $2 !~ /^Z/ { found = 1 } END { exit !found }',
    zombie: '$1 == pid && $2 ~ /^Z/ { found = 1 } $2 !~ /^Z/ { live = 1 } END { exit !(found && !live) }',
  }[shown];
  return warmed(fixture(directory, 'ps', [
    '[ -f "$here/answered" ] && { : > "$here/failed"; echo "ps: failing on purpose" >&2; exit 2; }',
    '[ -f "$here/hang" ] || exec /bin/ps "$@"',
    'case "$*" in *stat=*) ;; *) exec /bin/ps "$@" ;; esac',
    'rows=$(/bin/ps "$@") || exit $?',
    'printf "%s\\n" "$rows"',
    `printf "%s\\n" "$rows" | /usr/bin/awk -v pid="$(/bin/cat "$here/${name}.pid")" '${lists}' && printf "%s\\n" "$rows" > "$here/answered"`,
    'exit 0',
  ].join('\n')));
}

/** Asserts that the read after the kill that answered listed `pid` alive, and that a read after it failed. */
function assertShownAliveThenUnread(directory, pid) {
  assert.ok(existsSync(join(directory, 'answered')), 'no read after the kill listed the member alive, so the test proves nothing');
  assert.ok(existsSync(join(directory, 'failed')), 'no read failed after the one that listed the member alive, so the test proves nothing');
  assert.match(read(directory, 'answered'), new RegExp(`^\\s*${pid}\\s+[^Z\\s]`, 'm'));
}

/** The reason for a member the last read that answered showed alive, before later reads failed. */
const SHOWN_ALIVE = /not shown to have ended[^]*last read[^]*answered[^]*alive[^]*later reads failed[^]*ps: failing on purpose/;

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where a read after the kill lists a member alive and every later read fails, the member is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { unkept: 'one' });

  const { events } = await called(directory, { command: leavingTwo(directory), ps: answeringOnceAfterKill(directory, 'one', 'alive'), kill: markingKill(directory, signals) });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(one), true, 'the member the kill does not end was ended, so the test proves nothing');
  assertShownAliveThenUnread(directory, one);
  assertUnendedUnread(events, { stuck: one, ended: two, unended: 'survivor.unended', directory, reason: SHOWN_ALIVE });
});

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where a read after the kill lists a member that answers EPERM alive and every later read fails, the member is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const signals = standIn(directory, { refused: 'one' });

  const { events } = await called(directory, { command: leavingTwo(directory), ps: answeringOnceAfterKill(directory, 'one', 'alive'), kill: markingKill(directory, signals) });

  const [one, two] = ['one', 'two'].map((name) => pidIn(directory, name));
  assert.equal(alive(one), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assertShownAliveThenUnread(directory, one);
  assertUnendedUnread(events, { stuck: one, ended: two, unended: 'survivor.unended', directory, reason: /^EPERM$/ });
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where a read after the kill lists a member alive and every later read fails, the member is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { unkept: 'member' });

  const { events } = await startKilled(started, { ps: answeringOnceAfterKill(directory, 'member', 'alive'), kill: markingKill(directory, signals) });

  assert.equal(alive(started.member), true, 'the member the kill does not end was ended, so the test proves nothing');
  assertShownAliveThenUnread(directory, started.member);
  assertUnendedUnread(events, { stuck: started.member, ended: started.leader, unended: 'recorded.unended', directory, reason: SHOWN_ALIVE });
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where a read after the kill lists a member that answers EPERM alive and every later read fails, the member is recorded as a process not shown to have ended, not as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  writeFileSync(join(directory, 'member.pid'), String(started.member));
  const signals = standIn(directory, { refused: 'member' });

  const { events } = await startKilled(started, { ps: answeringOnceAfterKill(directory, 'member', 'alive'), kill: markingKill(directory, signals) });

  assert.equal(alive(started.member), true, 'the member L0 may not signal was ended, so the test proves nothing');
  assertShownAliveThenUnread(directory, started.member);
  assertUnendedUnread(events, { stuck: started.member, ended: started.leader, unended: 'recorded.unended', directory, reason: /^EPERM$/ });
});

// proves R-STATE-19, R-STATE-12
test('on the call\'s containment, where a read after the kill lists a member a zombie and every later read fails, the member is recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', [leave(TAIL, 'one'), joining(directory)].join('\n'));
  const signals = standIn(directory);

  const { events } = await called(directory, { command, ps: answeringOnceAfterKill(directory, 'two', 'zombie'), kill: markingKill(directory, signals) });

  assert.ok(existsSync(join(directory, 'answered')), 'no read after the kill listed the member a zombie, so the test proves nothing');
  assertZombieKilled(events, directory, 'survivor.killed');
});

// proves R-STATE-19, R-STATE-12
test('on a start\'s kill of a recorded group, where a read after the kill lists a member a zombie and every later read fails, the member is recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const started = await startGroup(t, directory, 'group');
  spawn('/usr/bin/perl', [zombieJoiner(directory), directory, String(started.group)], { stdio: 'ignore' });
  await until(() => existsSync(join(directory, 'two.pid')), t);
  const signals = standIn(directory);

  const { events } = await startKilled(started, { ps: answeringOnceAfterKill(directory, 'two', 'zombie'), kill: markingKill(directory, signals) });

  assert.ok(existsSync(join(directory, 'answered')), 'no read after the kill listed the member a zombie, so the test proves nothing');
  assertZombieKilled(events, directory, 'recorded.killed');
});
