// ABOUTME: Tests that L0 contains a group without ever stopping it, on the call's containment, a
// start's kill of a recorded group and the exit cleanup: what it records by name and as the group's
// kill, how it settles where it cannot read the table, may not signal a process, or cannot end
// one, in a group and in a dispatch's directory alike, and what the exit cleanup hands the caller's
// step where it cannot end the command.

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
import { TAIL, alive, fixture, holding, leave, processState, read, startGroup, tailIn, until } from './process-fixtures.mjs';
import { heldOutput } from './process-fixtures.mjs';
import { ended } from './process-fixtures.mjs';
import { gone } from './process-fixtures.mjs';
import { signalStandIn } from './signal-stand-in.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { listingOf } from './listing-stand-in.mjs';
import { sightingPs } from './census-sightings.mjs';

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

/** The line of a `ps` stand-in that answers a read as `ps` does, with the process `$here/two.pid` names cut out. */
const CUT_TWO = '/bin/ps "$@" | /usr/bin/grep -v "^ *$(/bin/cat "$here/two.pid") "';

/**
 * A `ps` stand-in that cuts the process `$here/two.pid` names out of every read of the census,
 * which begin `-ww -g`, and answers every other read as `ps` does.
 */
const cuttingTwo = (directory) => fixture(directory, 'ps', [
  'case "$*" in "-ww -g "*)',
  `  ${CUT_TWO}`,
  '  exit 0 ;;',
  'esac',
  'exec /bin/ps "$@"',
].join('\n'));

/** A `ps` stand-in that fails every read as `ps` fails given what it cannot read, but a read of a start time. */
const failing = (directory) => fixture(directory, 'ps', 'case "$*" in *lstart=*) exec /bin/ps "$@" ;; esac\necho "ps: failing on purpose" >&2\nexit 2');

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
  "if (options.censusElapsed) { const realNow = Date.now; Date.now = () => { const caller = new Error().stack?.split('\\n')[2] ?? ''; if (!globalThis.censusCut && caller.includes('at sweptNow (')) { globalThis.censusCut = true; appendFileSync(join(here, 'census-clock-cut'), 'C'); return realNow() - options.censusElapsed; } return realNow(); }; }",
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
const hidingTwoUntilKilled = (directory) => fixture(directory, 'ps', [
  '[ -f "$here/hang" ] && exec /bin/ps "$@"',
  CUT_TWO,
  'exit 0',
].join('\n'));

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

/** A parent outside the group that reaps its joined child once a state read releases it. */
function reapingJoiner(directory) {
  const program = join(directory, 'reaping-joiner');
  writeFileSync(program, [
    'my ($here, $group) = @ARGV;',
    'setpgrp(0, 0) or die "leave: $!";',
    'my $child = fork() // die "fork: $!";',
    'if ($child == 0) {',
    '  setpgrp(0, $group) or die "join: $!";',
    '  open my $pid, ">", "$here/two.pid.tmp" or die; print $pid $$; close $pid;',
    '  rename "$here/two.pid.tmp", "$here/two.pid" or die;',
    '  1 until -e "$here/release-two";',
    '  exit 0;',
    '}',
    'waitpid($child, 0);',
    'open my $mark, ">", "$here/reaped-two" or die; close $mark;',
  ].join(' '));
  return program;
}

/** Starts a member whose parent can prove reaping before L0's confirming read and kill. */
function reapingCommand(directory, hold) {
  const joiner = reapingJoiner(directory);
  return fixture(directory, 'command', [
    ...(hold ? ['echo $$ > "$here/group.pid"'] : []),
    leave(TAIL, 'one'),
    '/usr/bin/perl "' + joiner + '" "$here" $$ >/dev/null 2>&1 &',
    'while [ ! -f "$here/two.pid" ]; do :; done',
    ...(hold ? [': > "$here/up"', 'while [ ! -f "$here/release" ]; do :; done'] : []),
  ].join('\n'));
}

/** Runs one controlled census sighting through the call's containment and returns its trace. */
async function censusCall(t, cell, afterKill = 'omit') {
  const directory = holding(t);
  const signals = standIn(directory);
  const command = cell === 'X' ? reapingCommand(directory, false)
    : fixture(directory, 'command', [leave(TAIL, 'one'), joining(directory)].join('\n'));
  const { events } = await called(directory, { command, ps: sightingPs(directory, { cell, afterKill }), kill: markingKill(directory, signals) });

  const two = pidIn(directory, 'two');
  const group = signals.pairs.find(([target, name]) => target < 0 && name === 'SIGKILL')?.[0] * -1;
  const trace = read(directory, 'sighted-ps.log');
  assert.ok(existsSync(join(directory, 'sighted-first-stat')), 'the first census state read did not happen');
  if (cell !== 'X') assert.ok(existsSync(join(directory, 'sighted-live')), 'the last read before the kill did not find the member alive');
  assert.ok(groupKills(signals.pairs, group) > 0, 'no group kill was sent');
  const mark = cell === 'X' ? 'reaped-two:' + existsSync(join(directory, 'reaped-two'))
    : afterKill === 'zombie' ? 'state:' + processState(two)
      : 'live-before-kill:' + existsSync(join(directory, 'sighted-live'));
  t.diagnostic(JSON.stringify({ cell: `${cell}-call-${afterKill}`, group, members: [pidIn(directory, 'one'), two], mark, trace, kills: signals.pairs, events }));
  if (afterKill === 'omit' && cell !== 'X') assertPostKillOmission(trace, group, two, 'call');
  return { directory, events, group, two, trace };
}

/** Runs the same stand-in through synchronous exit containment. */
async function censusExit(t, cell, afterKill = 'omit') {
  const directory = holding(t);
  if (cell === 'X') reapingCommand(directory, true);
  else if (afterKill === 'zombie') joinedLate(directory);
  else holdingTwo(directory);
  sightingPs(directory, { cell, afterKill });
  const { status, stderr, events, pairs } = await cleanedUp(directory, { ps: 'ps-sighted', hangAfter: 'group' });
  const group = pidIn(directory, 'group');
  const two = pidIn(directory, 'two');
  const trace = read(directory, 'sighted-ps.log');
  assert.equal(status, 0, stderr);
  assert.ok(existsSync(join(directory, 'sighted-first-stat')), 'the first census state read did not happen');
  if (cell !== 'X') assert.ok(existsSync(join(directory, 'sighted-live')), 'the last read before the kill did not find the member alive');
  assert.ok(groupKills(pairs, group) > 0, 'no group kill was sent');
  const mark = cell === 'X' ? 'reaped-two:' + existsSync(join(directory, 'reaped-two'))
    : afterKill === 'zombie' ? 'state:' + processState(two)
      : 'live-before-kill:' + existsSync(join(directory, 'sighted-live'));
  t.diagnostic(JSON.stringify({ cell: `${cell}-exit-${afterKill}`, group, members: [pidIn(directory, 'one'), two], mark, trace, kills: pairs, events }));
  if (afterKill === 'omit' && cell !== 'X') assertPostKillOmission(trace, group, two, 'exit');
  return { directory, events, group, two, trace };
}

/** The ordered arguments and response rows of the stand-in's complete read log. */
function sightingReads(trace) {
  return trace.split(/(?=READ )/).filter(Boolean).map((block) => {
    const [first, ...rows] = block.trimEnd().split('\n');
    return { args: first.slice(5), rows };
  });
}

/** Requires an answered post-kill read that omitted the target, not just a fixture label. */
function assertPostKillOmission(trace, group, two, path) {
  const args = `-g ${group} -o pid=,stat=${path === 'exit' ? ',xstat=' : ''}`;
  const after = sightingReads(trace).filter(({ args: readArgs, rows }) => readArgs === args && rows.includes('PHASE after-kill'));
  assert.ok(after.length > 0, `no post-kill response for the omitted member: ${trace}`);
  assert.ok(after.every(({ rows }) => rows.every((row) => !new RegExp(`^ROW\\s+${two}(?:\\s|$)`).test(row))), `a post-kill response listed the omitted member: ${trace}`);
}

/** Guards the first census round's distinct read positions for `cell`. */
function assertSighting(trace, two, cell) {
  const reads = sightingReads(trace);
  const states = reads.filter(({ args }) => args.startsWith('-ww -g ') && args.endsWith('pid=,stat='));
  const commands = reads.filter(({ args }) => args.startsWith('-ww -g ') && args.endsWith('pid=,command='));
  const has = ({ rows }) => rows.some((line) => new RegExp(`^ROW\\s+${two} `).test(line));
  const expected = {
    B: { states: [true, false], commands: [true, true], name: true },
    U1: { states: [true, false], commands: [true, true], name: false },
    U2: { states: [true, false], commands: [true, false], name: true },
    A: { states: [false, true, false], commands: [false, false] },
    C1: { states: [false, false], commands: [true, false] },
    C2: { states: [false, false], commands: [false, true] },
    N: { states: [false, false], commands: [false, false] },
    X: { states: [true, false, false], commands: [true, true], name: true },
  }[cell];
  assert.ok(expected, `unknown census cell ${cell}`);
  assert.deepEqual(states.slice(0, expected.states.length).map(has), expected.states, `wrong state-read positions for ${cell}: ${trace}`);
  assert.deepEqual(commands.slice(0, expected.commands.length).map(has), expected.commands, `wrong command-read positions for ${cell}: ${trace}`);
  const name = reads.find(({ args }) => args === `-p ${two} -o ucomm=`);
  if (expected.name === true) assert.ok(name?.rows.some((row) => row.startsWith('ROW ') && row !== 'ROW '), `no name read for ${cell}: ${trace}`);
  if (expected.name === false) assert.deepEqual(name?.rows, ['FAIL 1 empty'], `the name read did not omit the member: ${trace}`);
  if (expected.name === undefined) assert.equal(name, undefined, `the census named a member no before-state read showed: ${trace}`);
}

// proves R-STATE-12
test('B0 call: a member named by the first census round remains recorded after later reads omit it', SETTLES_WITHIN, async (t) => {
  const { directory, events, two, trace } = await censusCall(t, 'B');
  assert.ok(existsSync(join(directory, 'sighted-next-stat')), 'no later census state read omitted the member');
  assertSighting(trace, two, 'B');
  assert.deepEqual(recordOf(events, two).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
});

// proves R-STATE-12, R-STATE-19
test('U1 call: a census name read that omits a shown member records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  const { events, group, two, trace } = await censusCall(t, 'U1');
  assertSighting(trace, two, 'U1');
  assert.deepEqual(recordOf(events, two), [], 'an incomplete identity was recorded as named');
  assert.match(events.find(({ event, group: id }) => event === 'group.killed' && id === group)?.census ?? '', /complete name and command line were unavailable/);
});

/** Asserts the member has no invented identity and the group has one reasoned kill record. */
function assertUnnamedSighting(events, group, two) {
  assert.deepEqual(recordOf(events, two), [], 'an incomplete identity was recorded as named');
  const found = events.filter(({ event, group: id }) => event === 'group.killed' && id === group);
  assert.equal(found.length, 1, `the group kill was not recorded once: ${JSON.stringify(events)}`);
  assert.match(found[0].census, /complete name and command line were unavailable/);
}

/** Runs and verifies a member whose census sighting supplied no complete identity. */
async function unnamedCensusCell(t, path, cell, afterKill = 'omit') {
  const { events, group, two, trace } = await (path === 'call' ? censusCall(t, cell, afterKill) : censusExit(t, cell, afterKill));
  assertSighting(trace, two, cell);
  if (afterKill === 'omit') assertPostKillOmission(trace, group, two, path);
  if (afterKill === 'zombie') {
    assert.ok(processState(two).startsWith('Z'), `the member was not left a zombie: ${processState(two)}`);
    assert.match(trace, new RegExp(`ROW\\s+${two} Z`), 'no post-kill read listed the zombie');
  }
  assertUnnamedSighting(events, group, two);
}

// proves R-STATE-12, R-STATE-19
test('U2 call: a missing second command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  const { events, group, two, trace } = await censusCall(t, 'U2');
  assertSighting(trace, two, 'U2');
  assertUnnamedSighting(events, group, two);
});

// proves R-STATE-12, R-STATE-19
test('U1 exit: a census name read that omits a shown member records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'U1');
});

// proves R-STATE-12, R-STATE-19
test('U2 exit: a missing second command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'U2');
});

// proves R-STATE-12, R-STATE-19
test('A0 call omitted: a member shown only in the after state read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'A');
});

// proves R-STATE-12, R-STATE-19
test('A0 exit omitted: a member shown only in the after state read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'A');
});

// proves R-STATE-12, R-STATE-19
test('C1 call omitted: a member shown only in the first command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'C1');
});

// proves R-STATE-12, R-STATE-19
test('C1 exit omitted: a member shown only in the first command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'C1');
});

// proves R-STATE-12, R-STATE-19
test('C2 call omitted: a member shown only in the second command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'C2');
});

// proves R-STATE-12, R-STATE-19
test('C2 exit omitted: a member shown only in the second command read records the unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'C2');
});

// proves R-STATE-12
test('B1 call: a member named by an early census read and left a zombie is recorded by name', SETTLES_WITHIN, async (t) => {
  const { directory, events, two, trace } = await censusCall(t, 'B', 'zombie');
  assertSighting(trace, two, 'B');
  assert.ok(processState(two).startsWith('Z'), `the member was not a zombie: ${processState(two)}`);
  assert.match(trace, new RegExp(`ROW\\s+${two} Z`), 'no post-kill read listed the zombie');
  assert.deepEqual(recordOf(events, two).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
});

// proves R-STATE-12
test('B1 exit: a member named by an early census read and left a zombie is recorded by name', SETTLES_WITHIN, async (t) => {
  const { directory, events, two, trace } = await censusExit(t, 'B', 'zombie');
  assertSighting(trace, two, 'B');
  assert.ok(processState(two).startsWith('Z'), `the member was not a zombie: ${processState(two)}`);
  assert.match(trace, new RegExp(`ROW\\s+${two} Z`), 'no post-kill read listed the zombie');
  assert.deepEqual(recordOf(events, two).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
});

// proves R-STATE-12, R-STATE-19
test('A0 call zombie: an after-state-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'A', 'zombie');
});

// proves R-STATE-12, R-STATE-19
test('A0 exit zombie: an after-state-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'A', 'zombie');
});

// proves R-STATE-12, R-STATE-19
test('C1 call zombie: a first-command-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'C1', 'zombie');
});

// proves R-STATE-12, R-STATE-19
test('C1 exit zombie: a first-command-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'C1', 'zombie');
});

// proves R-STATE-12, R-STATE-19
test('C2 call zombie: a second-command-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'call', 'C2', 'zombie');
});

// proves R-STATE-12, R-STATE-19
test('C2 exit zombie: a second-command-only sighting records an unnamed group kill', SETTLES_WITHIN, async (t) => {
  await unnamedCensusCell(t, 'exit', 'C2', 'zombie');
});

// proves R-STATE-12
test('N0 call: a member every read omits has no pid event or group fallback', SETTLES_WITHIN, async (t) => {
  const { events, group, two, trace } = await censusCall(t, 'N');
  assertSighting(trace, two, 'N');
  assert.deepEqual(recordOf(events, two), []);
  assert.deepEqual(events.filter(({ event, group: id }) => event === 'group.killed' && id === group), []);
});

// proves R-STATE-12
test('N0 exit: a member every read including the first confirmation omits has no pid event or group fallback', SETTLES_WITHIN, async (t) => {
  const { events, group, two, trace } = await censusExit(t, 'N');
  assertSighting(trace, two, 'N');
  const confirmation = sightingReads(trace).filter(({ args }) => args === '-g ' + group + ' -o pid=,stat=,xstat=');
  assert.ok(confirmation.length > 0, 'the exit confirmation made no read');
  assert.equal(confirmation.some(({ rows }) => rows.some((row) => new RegExp('^ROW\\s+' + two + ' ').test(row))), false, 'a confirmation read listed the member');
  assert.deepEqual(recordOf(events, two), []);
  assert.deepEqual(events.filter(({ event, group: id }) => event === 'group.killed' && id === group), []);
});

/** The shown member exited on its own, and the parent reaped it before confirmation and kill. */
async function reapedCensusCell(t, path) {
  const { directory, events, group, two, trace } = await (path === 'call' ? censusCall(t, 'X') : censusExit(t, 'X'));
  assertSighting(trace, two, 'X');
  assert.ok(existsSync(join(directory, 'reaped-two')), 'the parent did not mark its successful waitpid');
  const reads = sightingReads(trace);
  const censusStates = reads.map(({ args }, index) => args === '-ww -g ' + group + ' -o pid=,stat=' ? index : -1).filter((index) => index >= 0);
  const after = censusStates[1];
  const confirming = reads.findIndex(({ args }) => args === '-g ' + group + ' -o pid=,stat=');
  assert.ok(after >= 0 && confirming > after, 'the confirming read did not follow the reaping state read');
  assert.deepEqual(recordOf(events, two), [], 'the member reaped before the kill was recorded as ended by it');
  assert.deepEqual(events.filter(({ event, group: id }) => event === 'group.killed' && id === group), []);
}

// proves R-STATE-12
test('X0 call: a once-shown member reaped on its own before confirmation has no kill event', SETTLES_WITHIN, async (t) => {
  await reapedCensusCell(t, 'call');
});

// proves R-STATE-12
test('X0 exit: a once-shown member reaped on its own before confirmation has no kill event', SETTLES_WITHIN, async (t) => {
  await reapedCensusCell(t, 'exit');
});

// proves R-STATE-12
test('B0 exit: a member named by the first census round remains recorded after later reads omit it', SETTLES_WITHIN, async (t) => {
  const { directory, events, two, trace } = await censusExit(t, 'B');
  assertSighting(trace, two, 'B');
  assert.deepEqual(recordOf(events, two).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
});

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

// proves R-STATE-19, R-STATE-12
test('a cut name read for an unshown member after the group kill cannot name it from partial output', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const cut = heldOutput(t, directory, 'printf "cut"');
  const ps = fixture(directory, 'ps', [
    `[ -f "$here/hang" ] || { ${CUT_TWO}; exit 0; }`,
    'case "$*" in *"-o ucomm=")',
    cut.body,
    '  ;;',
    '  *) exec /bin/ps "$@" ;;',
    'esac',
  ].join('\n'));
  const signals = standIn(directory, { refused: 'two' });

  const settled = called(directory, { command: leavingTwo(directory), ps, readTimeout: 1_000, kill: markingKill(directory, signals) });
  await cut.started();
  const { events } = await settled;

  const two = pidIn(directory, 'two');
  assert.equal(alive(two), true, 'the group kill ended the refused member');
  assert.deepEqual(recordOf(events, two), [{ event: 'survivor.unended', name: undefined, cmd: undefined, reason: 'EPERM' }]);
});

// proves R-STATE-12, R-STATE-19
test('a cut state read after the group kill records that the read timed out', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const cut = heldOutput(t, directory, 'printf "123"');
  const ps = fixture(directory, 'ps', [
    '[ -f "$here/hang" ] || exec /bin/ps "$@"',
    'case "$*" in "-g "*" -o pid=,stat=")',
    '  if /bin/mkdir "$here/first" 2>/dev/null; then',
    cut.body,
    '  fi ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n'));
  const signals = standIn(directory, { refused: 'one' });

  const settled = called(directory, { command: leavingTwo(directory), ps, readTimeout: 300, kill: markingKill(directory, signals) });
  await cut.started();
  const { events } = await settled;

  const unread = events.find(({ event }) => event === 'group.killed');
  assert.ok(unread, `the group kill was not recorded: ${JSON.stringify(events)}`);
  assert.match(unread.census, /reads of the group after its kill failed[^]*process-table read timed out after 300 ms/);
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

/** A post-kill state read that fails on standard error, then answers with a zombie row. */
function failingReaped(directory, outside, ready, earlierAnswer = false) {
  return fixture(directory, 'ps', [
    `[ -f "$here/${ready}" ] || exec /bin/ps "$@"`,
    `case "$*" in "-p ${outside} -o pid=,stat=")`,
    ...(earlierAnswer ? [`  if /bin/mkdir "$here/answered" 2>/dev/null; then printf "%s S\\n" "${outside}"; exit 0; fi`] : []),
    '  if /bin/mkdir "$here/failed" 2>/dev/null; then echo "ps: reaped failure" >&2; exit 2; fi',
    `  printf "%s Z\\n" "${outside}"; exit 0 ;;`,
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n'));
}

/** Advances only the async read driver's clock after a completed state read marks `clock-cut`. */
async function cutAsyncReading(directory, action) {
  const now = Date.now;
  let jumps = 0;
  Date.now = () => {
    const caller = new Error().stack?.split('\n')[2] ?? '';
    if (existsSync(join(directory, 'clock-cut')) && caller.includes('at reading (')) {
      jumps += 1;
      return now() + KILL_BOUND + 10_000;
    }
    return now();
  };
  try {
    return { result: await action(), jumps };
  } finally {
    Date.now = now;
  }
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
test('a cut name read while describing a refused directory process does not supply its name', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const cut = heldOutput(t, directory, 'printf "cut"');
  const ps = fixture(directory, 'ps', [
    `case "$*" in "-p ${outside} -o ucomm=")`,
    cut.body,
    '  ;;',
    '  *) exec /bin/ps "$@" ;;',
    'esac',
  ].join('\n'));
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  const signals = standIn(directory, { refused: 'outside' });

  const settled = called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, readTimeout: 300, kill: signals.kill });
  await cut.started();
  const { events } = await settled;

  assert.deepEqual(recordOf(events, outside), [{ event: 'survivor.unended', name: undefined, cmd: undefined, reason: 'EPERM' }]);
  assert.equal(alive(outside), true, 'the refused directory process was ended');
  assert.ok(!processState(outside).startsWith('T'), 'the refused directory process was left stopped');
});

// proves R-STATE-19
test('a cut name read while describing a killed unnamed directory process does not supply its name', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const cut = heldOutput(t, directory, 'printf "cut"');
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  const ps = fixture(directory, 'ps', [
    `case "$*" in "-p ${outside} -o ucomm=")`,
    '  if /bin/mkdir "$here/first" 2>/dev/null; then echo "ps: unread" >&2; exit 2; fi',
    cut.body,
    '  ;;',
    '  *) exec /bin/ps "$@" ;;',
    'esac',
  ].join('\n'));
  const signals = standIn(directory, { unkept: 'outside' });

  const settled = called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, readTimeout: 300, kill: signals.kill });
  await cut.started();
  const { events } = await settled;

  assert.deepEqual(recordOf(events, outside), [{ event: 'survivor.unended', name: undefined, cmd: undefined, reason: 'not shown to have ended: the process table could not be read' }]);
  assert.equal(alive(outside), true, 'the unnamed process was ended');
  assert.ok(!processState(outside).startsWith('T'), 'the unnamed process was left stopped');
});

// proves R-STATE-19
test('after an answered directory kill wait, a cut state read at its deadline keeps the earlier live answer', SETTLES_WITHIN, async (t) => {
  await failedAsyncWait(t);
  await lateAsyncWait(t);
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const cut = heldOutput(t, directory, `printf '${outside}'`);
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  const ps = fixture(directory, 'ps', [
    '[ -f "$here/outside-killed" ] || exec /bin/ps "$@"',
    `case "$*" in "-p ${outside} -o pid=,stat=")`,
    '  if /bin/mkdir "$here/answered" 2>/dev/null; then exec /bin/ps "$@"; fi',
    cut.body,
    '  ;;',
    '  *) exec /bin/ps "$@" ;;',
    'esac',
  ].join('\n'));
  const signals = standIn(directory, { unkept: 'outside' });
  const kill = (target, name) => {
    if (target === outside && name === 'SIGKILL') writeFileSync(join(directory, 'outside-killed'), '');
    return signals.kill(target, name);
  };

  const settled = called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, readTimeout: 300, kill });
  await cut.started();
  const { events } = await settled;

  assert.ok(existsSync(join(directory, 'answered')), 'no earlier read showed the process alive');
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
});

// proves R-STATE-19
test('without an answered directory kill wait, a timed-out state read records that the process could not be shown ended', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  const ps = fixture(directory, 'ps', [
    '[ -f "$here/outside-killed" ] || exec /bin/ps "$@"',
    `case "$*" in "-p ${outside} -o pid=,stat=")`,
    '  : > "$here/timed-out"',
    '  exec /usr/bin/tail -f "$here/hold" ;;',
    '  *) exec /bin/ps "$@" ;;',
    'esac',
  ].join('\n'));
  const signals = standIn(directory, { unkept: 'outside' });
  const kill = (target, name) => {
    if (target === outside && name === 'SIGKILL') writeFileSync(join(directory, 'outside-killed'), '');
    return signals.kill(target, name);
  };

  const { events } = await called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, readTimeout: 300, kill });

  assert.ok(existsSync(join(directory, 'timed-out')), 'no read of the killed process reached its timeout');
  assertUnended(directory, events, 'survivor.unended', 'not shown to have ended: the process table could not be read');
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

  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
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

// proves R-STATE-19, R-STATE-9
test('after an answered read, a timed-out read of a killed directory process records what the earlier read found alive', SETTLES_WITHIN, async (t) => {
  await failedSynchronousWait(t, true);
  await lateSynchronousWait(t, true);
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  fixture(directory, 'ps', [
    '[ -f "$here/hang" ] || exec /bin/ps "$@"',
    'case "$*" in *"-o pid=,stat="*)',
    '  if /bin/mkdir "$here/answered" 2>/dev/null; then exec /bin/ps "$@"; fi',
    '  : > "$here/timed-out"',
    '  exec /usr/bin/tail -f "$here/hold" ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n'));

  const { status, events } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', readTimeout: 2_000 });

  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'answered')), 'no read after the kill answered');
  assert.ok(existsSync(join(directory, 'timed-out')), 'no later read reached its timeout');
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
});

// proves R-STATE-19, R-STATE-9
test('an exit-cleanup read whose child exits 0 with its output open is reported by runNow as timed out', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingNone(directory);
  const cut = heldOutput(t, directory, 'printf "123"');
  fixture(directory, 'ps', [
    'case "$*" in "-ww -g "*)',
    cut.body,
    '  ;;',
    '  *) exec /bin/ps "$@" ;;',
    'esac',
  ].join('\n'));

  const settled = cleanedUp(directory, { ps: 'ps', readTimeout: CLEANUP_BOUND });
  await cut.started();
  const { status, events } = await settled;

  assert.equal(status, 0);
  const unread = events.find(({ event }) => event === 'group.killed');
  assert.ok(unread, `the cleanup took the cut table as a complete read: ${JSON.stringify(events)}`);
  assert.match(unread.census, /process-table read timed out after 1000 ms/);
});

// proves R-STATE-19, R-STATE-9
test('without an answered read, a timed-out read of a killed directory process records that it could not be shown ended', SETTLES_WITHIN, async (t) => {
  await failedSynchronousWait(t, false);
  await lateSynchronousWait(t, false);
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  fixture(directory, 'ps', [
    '[ -f "$here/hang" ] || exec /bin/ps "$@"',
    'case "$*" in *"-o pid=,stat="*)',
    '  : > "$here/timed-out"',
    '  exec /usr/bin/tail -f "$here/hold" ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n'));

  const { status, events } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', readTimeout: 2_000 });

  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'timed-out')), 'the wait made no timed-out read');
  assertUnended(directory, events, 'survivor.unended', 'not shown to have ended: the process table could not be read');
});

/** Shows that an async failed read after a live answer is retried and the next answer is used. */
async function failedAsyncWait(t) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const signals = standIn(directory, { unkept: 'outside' });
  const kill = (target, name) => {
    if (target === outside && name === 'SIGKILL') writeFileSync(join(directory, 'outside-killed'), '');
    return signals.kill(target, name);
  };
  const ps = failingReaped(directory, outside, 'outside-killed', true);
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));

  const { events } = await called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, kill, readTimeout: 2_000 });

  assert.ok(existsSync(join(directory, 'answered')), 'no earlier read showed the process alive');
  assert.ok(existsSync(join(directory, 'failed')), 'the read after the live answer did not fail on standard error');
  assert.deepEqual(events.filter(({ pid }) => pid === outside).map(({ event }) => event), ['survivor.killed']);
  assert.equal(alive(outside), true, 'the signal stand-in ended the process before its state reads');
}

/** Shows that an async read begun past the deadline uses the prior live answer. */
async function lateAsyncWait(t) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  const signals = standIn(directory, { unkept: 'outside' });
  const kill = (target, name) => {
    if (target === outside && name === 'SIGKILL') writeFileSync(join(directory, 'outside-killed'), '');
    return signals.kill(target, name);
  };
  const ps = fixture(directory, 'ps', [
    '[ -f "$here/outside-killed" ] || exec /bin/ps "$@"',
    `case "$*" in "-p ${outside} -o pid=,stat=")`,
    '  if /bin/mkdir "$here/answered" 2>/dev/null; then',
    `    printf '%s S\\n' '${outside}'; : > "$here/clock-cut"; exit 0`,
    '  fi',
    '  : > "$here/unexpected-read"; exit 2 ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n'));
  const lsof = fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));

  const { result: { events }, jumps } = await cutAsyncReading(directory, () => called(directory, { command: '/usr/bin/true', directory: work, ps, lsof, kill, readTimeout: 300 }));

  assert.ok(existsSync(join(directory, 'answered')), 'no earlier read showed the process alive');
  assert.ok(jumps > 0, 'the next read did not see the cut deadline');
  assert.equal(existsSync(join(directory, 'unexpected-read')), false, 'a read ran after LATE');
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
}

/** Runs an exit-cleanup directory wait with a failing state read, with or without a prior answer. */
async function failedSynchronousWait(t, earlierAnswer) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  failingReaped(directory, outside, 'hang', earlierAnswer);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', readTimeout: 2_000 });

  assert.equal(status, 0);
  assert.equal(existsSync(join(directory, 'answered')), earlierAnswer, 'the prior-answer branch was not forced');
  assert.ok(existsSync(join(directory, 'failed')), 'the state read did not fail on standard error');
  assert.deepEqual(events.filter(({ pid }) => pid === outside).map(({ event }) => event), ['survivor.killed']);
  assert.equal(alive(outside), true, 'the signal stand-in ended the process before its state reads');
}

/**
 * A `ps` stand-in that, until `$here/hang` exists, holds the census's read of the outside process's
 * name, `-p <pid> -o ucomm=`, marking `$here/held`, until the census's own bound gives it up, and
 * answers every other read as `ps` does. So the census's bound runs out after it has stopped the
 * process and listed it again, and before it has read its name (#579).
 */
const holdingName = (directory) => fixture(directory, 'ps', [
  'if [ ! -f "$here/hang" ] && [ "$*" = "-p $(/bin/cat "$here/outside.pid") -o ucomm=" ]; then : > "$here/held"; exec /usr/bin/tail -f "$here/hold"; fi',
  'exec /bin/ps "$@"',
].join('\n'));

// proves R-STATE-19, R-STATE-9
test('given a census of a dispatch\'s directory whose bound runs out after it has stopped and listed again a process the kill does not end, and before it has read that process\'s name, the exit cleanup still records it by name and command line as alive at the cleanup\'s own bound of its kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  holdingName(directory);
  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));

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
  const ps = fixture(directory, 'ps', '[ -f "$here/killed" ] && { echo "ps: failing on purpose" >&2; exit 2; }\nexec /bin/ps "$@"');

  const { events } = await called(directory, { command: '/usr/bin/true', directory: work, kill, ps });

  assert.ok(signals.killedAt(outside) !== undefined, 'the census never sent the outside process its kill, so the test proves nothing');
  const recorded = events.filter(({ pid }) => pid === outside);
  assert.deepEqual(recorded.map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.unended', ...tailOf(directory) }]);
  assert.match(recorded[0].reason, /could not be read/);
  assert.equal(alive(outside), true, 'the census ended the outside process, so the test proves nothing');
  assert.ok(!processState(outside).startsWith('T'), `the census left the outside process stopped: ${processState(outside)}`);
});

/** A `ps` stand-in that answers every read as `ps` does until `$here/hang` exists, and from then on never answers. */
const hanging = (directory) => fixture(directory, 'ps', '[ -f "$here/hang" ] && exec /usr/bin/tail -f "$here/hold"\nexec /bin/ps "$@"');

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

  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
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
 * Has the exit cleanup end a group under `table`, a stand-in for `ps` that changes how it answers
 * once the cleanup has sent its first kill of the group, with `options` added to `CALLER`'s, and
 * asserts it records the leader not as killed but as a process it could not end, for `reason`, and
 * hands its step no exit code but an `unread` that matches `why`. It hands back the leader's pid and
 * the scratch directory.
 */
async function assertLeaderNotKilled(t, { table = hanging, options = {}, reason, why }) {
  const directory = holding(t);
  holdingTwo(directory);
  table(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group', ...options });

  const group = pidIn(directory, 'group');
  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'hang')), 'the cleanup never sent the group its kill, so the test proves nothing');
  const recorded = events.filter(({ pid }) => pid === group);
  assert.deepEqual(recorded.map(({ event }) => event), ['survivor.unended']);
  assert.match(recorded[0].reason, reason);
  const ending = JSON.parse(read(directory, 'ending'));
  assert.equal('exit' in ending, false, JSON.stringify(ending));
  assert.match(ending.unread ?? '', why, JSON.stringify(ending));
  return { group, directory };
}

// proves R-STATE-19, R-STATE-9
test('given a leader L0 may not signal, and a process table that stops answering once the exit cleanup has sent its first kill of the group, the cleanup records the leader as a process it could not end because of EPERM, not as killed, and hands its step no exit code', SETTLES_WITHIN, async (t) => {
  const { group } = await assertLeaderNotKilled(t, { options: { refused: 'group' }, reason: /^EPERM$/, why: /could not end the command: EPERM/ });
  assert.equal(alive(group), true, 'the kill ended the leader, so the test proves nothing');
});

// proves R-STATE-19, R-STATE-9
test('given a leader the kill does not end, and a process table that stops answering once the exit cleanup has sent its first kill of the group, the cleanup records the leader as not shown to have ended, not as killed, and hands its step no exit code', SETTLES_WITHIN, async (t) => {
  const { group } = await assertLeaderNotKilled(t, { options: { unkept: 'group' }, reason: /^not shown to have ended: the process table could not be read/, why: /the command was not shown to have ended: the process table could not be read/ });
  assert.equal(alive(group), true, 'the kill ended the leader, so the test proves nothing');
});

/**
 * A `ps` stand-in that answers every read as `ps` does until `$here/hang` exists, and from then on
 * answers each as `ps` does where no process matches: it exits 1 and prints nothing.
 */
const emptyAfterKill = (directory) => fixture(directory, 'ps', '[ -f "$here/hang" ] && exit 1\nexec /bin/ps "$@"');

/** The leader must end within `gone`'s bound; report its last state if it does not. */
async function assertLeaderGone(group, within) {
  assert.ok(await gone(group, within), `the leader outlived the kill, so the test proves nothing: ${processState(group)}`);
}

// proves R-STATE-19, R-STATE-9
test('given a read after the exit cleanup\'s kill that exits 1 and prints nothing while the leader\'s zombie is still in the group, the cleanup records the leader as not shown to have ended, not as killed, and hands its step no exit code', SETTLES_WITHIN, async (t) => {
  const { group } = await assertLeaderNotKilled(t, { table: emptyAfterKill, reason: /^not shown to have ended: .*did not list its leader/, why: /the command was not shown to have ended: .*did not list its leader/ });
  await assertLeaderGone(group);
});

test('the guard waits for a leader to end after its first read', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const leader = spawn('/usr/bin/tail', ['-f', join(directory, 'hold')], { detached: true, stdio: 'ignore' });
  t.after(() => ended(leader));
  assert.equal(alive(leader.pid), true);
  setImmediate(() => leader.kill('SIGKILL'));
  await assertLeaderGone(leader.pid);
});

test('the guard fails for a live leader outside every group L0 killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const leader = spawn('/usr/bin/tail', ['-f', join(directory, 'hold')], { detached: true, stdio: 'ignore' });
  t.after(() => ended(leader));
  assert.equal(alive(leader.pid), true);
  await assert.rejects(assertLeaderGone(leader.pid, 100), /the leader outlived the kill, so the test proves nothing:/);
  assert.equal(alive(leader.pid), true);
});

/** Where `CALLER` defines its signal call: the line the settling variant below extends. */
const KILL_ANCHOR = 'const kill = (target, name) => { ';

/**
 * `CALLER`, but with a leader that answers signal 0 with `EPERM` on every look but one that follows a
 * kill sent to it or to its group since the look before: a process still exiting, as the kernel
 * answers for one for a moment (`unended` in `src/substrate/process.mjs`), until L0's next kill
 * reaches it. Every signal still reaches the leader as `CALLER`'s own signal call sends it. It
 * appends each look at the leader to `$here/looks`: `E` where it answered `EPERM`, `A` otherwise.
 */
const SETTLING = (() => {
  assert.equal(CALLER.split(KILL_ANCHOR).length, 2, 'CALLER no longer defines its signal call where the settling variant extends it');
  return CALLER.replace(KILL_ANCHOR, [
    'let killedSinceLook = false;',
    "const settling = (target, name) => { const leader = pidIn('group'); if (name === 'SIGKILL' && (target === leader || target === -leader)) killedSinceLook = true; if (name !== 0 || target !== leader) return; const killed = killedSinceLook; killedSinceLook = false; appendFileSync(join(here, 'looks'), killed ? 'A' : 'E'); if (!killed) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM', errno: -1, syscall: 'kill' }); };",
    `${KILL_ANCHOR}settling(target, name); `,
  ].join('\n'));
})();

/** `cleanedUp`, run with `caller`'s source in place of `CALLER`'s. */
async function cleanedUpBy(caller, directory, options) {
  const path = join(directory, 'caller.mjs');
  writeFileSync(path, caller);
  const run = spawn(process.execPath, [path, directory, JSON.stringify({ readTimeout: CLEANUP_BOUND, ...options })], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  run.stderr.on('data', (chunk) => { stderr += chunk; });
  const [status] = await once(run, 'exit');
  return { status, stderr, events: linesOf(directory, 'events') };
}

/** A caller whose synchronous read driver sees an expired clock only after `clock-cut` is marked. */
const CLOCKED_CALLER = (() => {
  const anchor = 'const options = JSON.parse(process.argv[3]);';
  assert.equal(CALLER.split(anchor).length, 2, 'the caller options moved, so the clock forcing did not land');
  return CALLER.replace(anchor, [
    anchor,
    'const realNow = Date.now;',
    "Date.now = () => { const caller = new Error().stack?.split('\\n')[2] ?? ''; if (options.clockCut && existsSync(join(here, 'clock-cut')) && caller.includes(options.clockInEmptied ? 'at emptied (' : 'at readingNow (')) { if (options.clockAfterDeadline && !globalThis.clockDeadlineSet) { globalThis.clockDeadlineSet = true; appendFileSync(join(here, 'clock-deadline'), 'D'); return realNow(); } appendFileSync(join(here, 'clock-jumps'), 'J'); return realNow() + options.clockCut; } return realNow(); };",
  ].join('\n'));
})();

/** A caller that records each synchronous read and signal answer in the order L0 receives them. */
const TRACED_CALLER = (() => {
  const sourceImport = CALLER.split('\n')[0];
  const emitterLine = CALLER.split('\n').find((line) => line.startsWith('const emitter = '));
  const killLine = CALLER.split('\n').find((line) => line.startsWith('const kill = '));
  const clockLine = CLOCKED_CALLER.split('\n').find((line) => line.startsWith('Date.now = () =>'));
  assert.ok(sourceImport.startsWith('import { runCommand } from '), 'the caller no longer imports L0 first');
  assert.ok(emitterLine && killLine && clockLine, 'the caller no longer exposes its events, signals and clock');
  for (const anchor of [sourceImport, emitterLine, killLine, clockLine, "existsSync(join(here, 'clock-cut')) && caller.includes", "appendFileSync(join(here, 'clock-jumps'), 'J'); return realNow()"]) {
    assert.equal(CLOCKED_CALLER.split(anchor).length, 2, `the traced caller no longer has exactly one ${anchor} anchor`);
  }
  return CLOCKED_CALLER.replace(clockLine, clockLine.replace('if (options.clockCut &&', "if (options.clockAtReaped && existsSync(join(here, 'clock-cut'))) { trace('clock-stack', { caller }); if (caller.includes('reaped')) { trace('bound-evaluated', { branch: options.clockBranch, elapsed: options.clockCut }); return realNow() + options.clockCut; } } if (options.clockCut &&"))
    .replace("existsSync(join(here, 'clock-cut')) && caller.includes", "(existsSync(join(here, 'clock-cut')) || (options.clockAtListing && existsSync(join(here, 'post-kill-omitted')))) && caller.includes")
    .replace("appendFileSync(join(here, 'clock-jumps'), 'J'); return realNow()", "appendFileSync(join(here, 'clock-jumps'), 'J'); trace('read-cut', { code: 'LATE' }); return realNow()")
    .replace(sourceImport, [
    "import { syncBuiltinESMExports } from 'node:module';",
    "import childProcess from 'node:child_process';",
    "import { appendFileSync as traceAppend } from 'node:fs';",
    "import { join as traceJoin } from 'node:path';",
    'const traceHere = process.argv[2];',
    'let traceSequence = 0;',
    'const actualNow = Date.now.bind(Date);',
    "const trace = (kind, fields = {}) => traceAppend(traceJoin(traceHere, 'control.trace.jsonl'), `${JSON.stringify({ sequence: ++traceSequence, at: actualNow(), kind, ...fields })}\\n`);",
    "const markers = () => { const count = traceJoin(traceHere, 'state-count'); return { stateCount: existsSync(count) ? Number(readFileSync(count, 'utf8')) : 0, stateLive: existsSync(traceJoin(traceHere, 'state-live')), stateTimeout: existsSync(traceJoin(traceHere, 'state-timeout')), listingOmitted: existsSync(traceJoin(traceHere, 'post-kill-omitted')), listingFailed: existsSync(traceJoin(traceHere, 'post-kill-failed')), listingTimeout: existsSync(traceJoin(traceHere, 'post-kill-timeout')) }; };",
    'const originalSpawnSync = childProcess.spawnSync;',
    "childProcess.spawnSync = (tool, args, options) => { const started = Date.now(); trace('read-start', { tool, args, remaining: options?.timeout, markers: markers() }); const result = originalSpawnSync(tool, args, options); trace('read-end', { tool, args, started, status: result.status, signal: result.signal, error: result.error?.code, stdout: result.stdout, stderr: result.stderr, markers: markers() }); return result; };",
    'syncBuiltinESMExports();',
    sourceImport.replace('import { runCommand } from ', 'const { runCommand } = await import(').replace(/;$/, ');'),
  ].join('\n')).replace(killLine,
    killLine.replace('const kill = (target, name) => {', "const kill = (target, name) => { trace('signal-start', { target, name });")
      .replace('return signalled(target, name);', "try { const answer = signalled(target, name); trace('signal-answer', { target, name, answer }); if (options.clockAtKill && target === pidIn('outside') && name === 'SIGKILL') { appendFileSync(join(here, 'clock-cut'), 'K'); trace('clock-armed', { boundary: 'first-state' }); } return answer; } catch (error) { trace('signal-answer', { target, name, error: error.code }); throw error; }"))
    .replace(emitterLine, "const emitter = { emit: (event, fields) => { trace('event', { event, ...fields }); appendFileSync(join(here, 'events'), `${JSON.stringify({ event, ...fields })}\\n`); } };")
    .replace("while (!existsSync(join(here, 'up'))) await new Promise((resolve) => setImmediate(resolve));", "process.on('exit', (status) => trace('caller-end', { status }));\nwhile (!existsSync(join(here, 'up'))) await new Promise((resolve) => setImmediate(resolve));");
})();

/** Advances the group-census read driver's clock once, after its first read marked the cut. */
const GROUP_LATE_CALLER = (() => {
  const anchor = 'const options = JSON.parse(process.argv[3]);';
  assert.equal(CALLER.split(anchor).length, 2, 'the caller options moved, so the group clock forcing did not land');
  return CALLER.replace(anchor, [
    anchor,
    'const realNow = Date.now;',
    "Date.now = () => { const stack = new Error().stack ?? ''; if (existsSync(join(here, 'group-clock-cut')) && stack.split('\\n')[2]?.includes('at readingNow (') && stack.includes('at within (') && !globalThis.groupClockCut) { globalThis.groupClockCut = true; appendFileSync(join(here, 'group-clock-jump'), 'J'); return realNow() + 20_000; } return realNow(); };",
  ].join('\n'));
})();

/** Forces a synchronous wait's next read to start after its deadline, with or without an answer. */
async function lateSynchronousWait(t, earlierAnswer) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  fixture(directory, 'lsof', [
    ...(!earlierAnswer ? ['[ -f "$here/hang" ] && : > "$here/clock-cut"'] : []),
    listingOf('outside', realpathSync.native(join(work, 'sub'))),
  ].join('\n'));
  fixture(directory, 'ps', [
    '[ -f "$here/hang" ] || exec /bin/ps "$@"',
    `case "$*" in "-p ${outside} -o pid=,stat=")`,
    ...(earlierAnswer ? [
      '  if /bin/mkdir "$here/answered" 2>/dev/null; then',
      `    printf '%s S\\n' '${outside}'; : > "$here/clock-cut"; exit 0`,
      '  fi',
    ] : []),
    '  [ -f "$here/clock-cut" ] || { echo "ps: optional state read unavailable" >&2; exit 2; }',
    '  : > "$here/unexpected-read"; exit 2 ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n'));

  const { status, stderr, events } = await cleanedUpBy(CLOCKED_CALLER, directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', readTimeout: 2_000, clockCut: 20_000 });

  assert.equal(status, 0, stderr);
  assert.equal(existsSync(join(directory, 'answered')), earlierAnswer, 'the prior-answer branch was not forced');
  assert.ok(existsSync(join(directory, 'clock-cut')), 'the read deadline was not cut');
  assert.ok(existsSync(join(directory, 'clock-jumps')), 'the synchronous read driver did not see the cut clock');
  assert.equal(existsSync(join(directory, 'unexpected-read')), false, 'a state read ran after LATE');
  assertUnended(directory, events, 'survivor.unended', earlierAnswer ? 'still alive when L0\'s read bound ran out after its kill' : 'not shown to have ended: the process table could not be read');
}

/** A marked first exit-confirmation failure, with every process-table request and answer logged. */
function failingFirstConfirmation(directory, mode) {
  return fixture(directory, 'ps-first-fails', [
    'mode=' + mode,
    'args="$*"',
    'case "$args" in',
    '  "-g "*" -o pid=,stat=")',
    '    if [ "$mode" = F1 ]; then : > "$here/clock-cut"; fi ;;',
    '  "-g "*" -o pid=,stat=,xstat=")',
    '    : > "$here/first-read"',
    '    printf "READ %s\n" "$args" >> "$here/first-ps.log"',
    '    if [ "$mode" = F2 ]; then',
    '      : > "$here/clock-cut"',
    '      printf "FAIL 2 plain\n" >> "$here/first-ps.log"',
    '      echo "ps: first confirmation fails" >&2; exit 2',
    '    fi',
    '    if [ "$mode" = F3 ]; then',
    '      printf "HANG until ETIMEDOUT\n" >> "$here/first-ps.log"',
    '      exec /usr/bin/tail -f "$here/hold"',
    '    fi ;;',
    'esac',
    'answer=$(/bin/ps "$@")',
    'printf "READ %s\n" "$args" >> "$here/first-ps.log"',
    'printf "%s\n" "$answer" | /usr/bin/sed "s/^/ROW /" >> "$here/first-ps.log"',
    'printf "%s\n" "$answer"',
  ].join('\n'));
}

/** Forces an F cell, then checks the failed first read, absent later read and complete event stream. */
async function firstConfirmationCell(t, mode) {
  const directory = holding(t);
  holdingTwo(directory);
  failingFirstConfirmation(directory, mode);
  const options = {
    ps: 'ps-first-fails', readTimeout: 2_000,
    ...(mode === 'F3' ? {} : { clockCut: 20_000, clockAfterDeadline: mode === 'F1', clockInEmptied: mode === 'F2' }),
  };
  const caller = mode === 'F3' ? CALLER : CLOCKED_CALLER;
  const { status, stderr, events } = await cleanedUpBy(caller, directory, options);
  const group = pidIn(directory, 'group');
  const members = [group, pidIn(directory, 'one'), pidIn(directory, 'two')];
  const pairs = linesOf(directory, 'pairs');
  const trace = read(directory, 'first-ps.log');
  assert.equal(status, 0, stderr);
  assert.ok(existsSync(join(directory, 'clock-cut')) || mode === 'F3', 'the stand-in never armed the clock cut');
  if (mode !== 'F3') assert.ok(existsSync(join(directory, 'clock-jumps')), 'the caller clock never advanced');
  if (mode === 'F1') assert.equal(read(directory, 'clock-deadline'), 'D', 'the deadline was not established before the clock cut');
  assert.equal(existsSync(join(directory, 'first-read')), mode !== 'F1', 'the first confirmation read did not follow the forced path');
  const confirmations = trace.match(/READ -g \d+ -o pid=,stat=,xstat=/g) ?? [];
  assert.equal(confirmations.length, mode === 'F1' ? 0 : 1, 'a read followed the group kill');
  assert.ok(groupKills(pairs, group) > 0, 'the exit cleanup did not kill the group');
  t.diagnostic(JSON.stringify({ cell: mode, group, members, trace, mark: mode === 'F3' ? 'ETIMEDOUT' : read(directory, 'clock-jumps'), deadlineMark: mode === 'F1' ? read(directory, 'clock-deadline') : undefined, kills: pairs, events }));
  const groupEvents = events.filter(({ event, group: id }) => event === 'group.killed' && id === group);
  assert.equal(groupEvents.length, 1, 'the failed pre-kill read was not recorded once: ' + JSON.stringify(events));
  assert.match(groupEvents[0].census, /first read of the group before its kill failed/);
  for (const pid of members) {
    const records = events.filter((event) => event.pid === pid);
    assert.equal(records.length, 1, 'member ' + pid + ' was not recorded exactly once: ' + JSON.stringify(events));
    assert.match(records[0].event, /^survivor\.(killed|unended)$/);
    assert.ok(records[0].name && records[0].cmd, 'member ' + pid + ' was not recorded by name and command line');
  }
  assert.deepEqual(events.filter(({ pid }) => pid !== undefined && !members.includes(pid)), [], 'an unseen pid was recorded');
}

// proves R-STATE-12, R-STATE-19
test('F1: a late first confirmation read with no post-kill read records the group kill', SETTLES_WITHIN, async (t) => {
  await firstConfirmationCell(t, 'F1');
});

// proves R-STATE-12, R-STATE-19
test('F2: a plain first confirmation failure after the bound with no post-kill read records the group kill', SETTLES_WITHIN, async (t) => {
  await firstConfirmationCell(t, 'F2');
});

// proves R-STATE-12, R-STATE-19
test('F3: an unanswered first confirmation read with no post-kill read records the group kill', SETTLES_WITHIN, async (t) => {
  await firstConfirmationCell(t, 'F3');
});

// proves R-STATE-19, R-STATE-9
test('given a leader that answers signal 0 with EPERM until the next kill reaches it, and a process table that stops answering once the exit cleanup has sent its first kill of the group, the cleanup does not record the leader as one it may not signal, nor as killed, and hands its step no exit code', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  holdingTwo(directory);
  hanging(directory);

  const { status, stderr, events } = await cleanedUpBy(SETTLING, directory, { ps: 'ps', hangAfter: 'group' });

  const group = pidIn(directory, 'group');
  assert.equal(status, 0, stderr);
  assert.ok(existsSync(join(directory, 'hang')), 'the cleanup never sent the group its kill, so the test proves nothing');
  const looks = existsSync(join(directory, 'looks')) ? read(directory, 'looks') : '';
  assert.match(looks, /E/, 'the cleanup never asked signal 0 of the leader, or it never answered EPERM, so the test proves nothing');
  const recorded = events.filter(({ pid }) => pid === group);
  assert.deepEqual(recorded.map(({ event }) => event), ['survivor.unended'], JSON.stringify(recorded));
  assert.match(recorded[0].reason, /^not shown to have ended: /);
  const ending = JSON.parse(read(directory, 'ending'));
  assert.equal('exit' in ending, false, JSON.stringify(ending));
  assert.match(ending.unread ?? '', /the command was not shown to have ended/, JSON.stringify(ending));
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
 * After the outside PID's named kill, its state stand-in reports a live answer before the next
 * directory listing and times out on the following state read. Those reads are marked separately.
 */
function answeringAtOnce(directory) {
  const pid = read(directory, 'outside.pid');
  const tool = (path, args) => spawnSync(path, args, { env: {}, encoding: 'utf8' }).stdout;
  writeFileSync(join(directory, 'listed'), tool('/usr/sbin/lsof', ['-w', '-n', '-P', '-a', '-d', 'cwd', '-u', String(process.getuid()), '-p', pid, '-F', 'pun']));
  writeFileSync(join(directory, 'ucomm'), tool('/bin/ps', ['-p', pid, '-o', 'ucomm=']));
  writeFileSync(join(directory, 'cmdline'), tool('/bin/ps', ['-ww', '-p', pid, '-o', 'pid=,command=']));
  fixture(directory, 'lsof', '[ -f "$here/hang" ] && { : > "$here/post-kill-listing"; exec /usr/bin/tail -f "$here/hold"; }\nexec /bin/cat "$here/listed"');
  fixture(directory, 'ps', [
    'pid=$(/bin/cat "$here/outside.pid")',
    'if [ -f "$here/hang" ] && [ "$*" = "-p $pid -o pid=,stat=" ]; then',
    '  [ -f "$here/post-kill-listing" ] && { : > "$here/post-kill-state-too-late"; exec /usr/bin/tail -f "$here/hold"; }',
    '  : > "$here/post-kill-live"; echo "$pid T"; exit 0',
    'fi',
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
  ].join('\n'));
}

// proves R-STATE-19, R-STATE-9
test('given a census of a dispatch\'s directory whose listing after its kill takes the rest of its read bound, the exit cleanup still reads the process the kill does not end, and records it by name and command line as alive at the cleanup\'s own bound of that kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  holdingNone(directory);
  answeringAtOnce(directory);
  assert.match(read(directory, 'listed'), new RegExp(`^n${realpathSync.native(work)}/sub$`, 'm'), 'lsof did not list the outside process as working in the dispatch\'s directory, so the test proves nothing');

  const { status, events, pairs, ended } = await cleanedUp(directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', censusElapsed: 150 });

  assert.equal(status, 0);
  assert.ok(existsSync(join(directory, 'hang')), 'the census never sent the outside process its kill, so the test proves nothing');
  assert.ok(events.some(({ event }) => event === 'directory.unread'), 'the census\'s listing after its kill answered within its read bound, so the test proves nothing');
  t.diagnostic(JSON.stringify({ postKillListing: existsSync(join(directory, 'post-kill-listing')), postKillLive: existsSync(join(directory, 'post-kill-live')), postKillStateTooLate: existsSync(join(directory, 'post-kill-state-too-late')), pairs, events, killed: killedIn(pairs, pidIn(directory, 'outside')), ended }));
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  assert.ok(existsSync(join(directory, 'post-kill-listing')), 'the post-kill directory listing did not consume the read bound');
  assert.ok(existsSync(join(directory, 'post-kill-live')), 'no state read showed the named outside process alive after its kill');
  assert.ok(existsSync(join(directory, 'post-kill-state-too-late')), 'the state read after the timed-out listing did not reach its synchronous timeout');
  assert.equal(read(directory, 'census-clock-cut'), 'C', 'the census read deadline was not cut before the named kill');
  assert.match(events.find(({ event }) => event === 'directory.unread')?.census ?? '', /process-table read timed out/, 'the directory listing did not time out');
  // The census waits on what it killed until the cleanup's own bound has passed since that kill,
  // whatever its reads before took, and no longer.
  const killed = killedIn(pairs, pidIn(directory, 'outside'));
  assert.ok(ended - killed >= CLEANUP_BOUND, `the caller ended ${ended - killed} ms after the census's kill, before the cleanup's own bound of ${CLEANUP_BOUND} ms`);
  assert.ok(ended - killed < CLEANUP_BOUND + UNREAPED_BOUND / 2, `the caller ended ${ended - killed} ms after the census's kill, against the cleanup's own bound of ${CLEANUP_BOUND} ms`);
});

/** Drives one named outside PID through a chosen post-kill listing and two state-read answers. */
async function directoryReadCell(t, { listing, first, second, third, caller, clockCutAt, observe }) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  const listed = listingOf('outside', realpathSync.native(join(work, 'sub')));
  const after = {
    listed: `: > "$here/post-kill-listed"\n${listed}\nexit 0`,
    omitted: ': > "$here/post-kill-omitted"; exit 1',
    failed: ': > "$here/post-kill-failed"; echo "lsof: forced failure" >&2; exit 2',
    timeout: `${clockCutAt === 'listingTimeout' ? ': > "$here/clock-cut"; ' : ''}: > "$here/post-kill-timeout"; exec /usr/bin/tail -f "$here/hold"`,
  }[listing];
  fixture(directory, 'lsof', [
    'if [ -f "$here/hang" ]; then',
    '  : > "$here/post-kill-listing"',
    after,
    'fi',
    listed,
  ].join('\n'));
  const answer = (mode) => ({
    live: `: > "$here/state-live"; printf '%s T\\n' '${outside}'; exit 0`,
    zombie: `: > "$here/state-zombie"; printf '%s Z\\n' '${outside}'; exit 0`,
    gone: ': > "$here/state-gone"; exit 1',
    failed: ': > "$here/state-failed"; echo "ps: forced failure" >&2; exit 2',
  })[mode];
  const answerFor = (mode, cut) => {
    if (mode === 'timeout') return `${cut ? `: > "$here/clock-cut"; : > "$here/state-live"; printf '%s T\\n' '${outside}'; ` : ''}: > "$here/state-timeout"; exec /usr/bin/tail -f "$here/hold"`;
    const result = answer(mode);
    if (!cut) return result;
    assert.match(result, /exit [02]$/, `the ${mode} answer has no clock-cut boundary`);
    return result.replace(/exit ([02])$/, ': > "$here/clock-cut"; exit $1');
  };
  fixture(directory, 'ps', [
    `if [ -f "$here/hang" ] && [ "$*" = "-p ${outside} -o pid=,stat=" ]; then`,
    '  count=$(/bin/cat "$here/state-count" 2>/dev/null || echo 0)',
    '  count=$((count + 1)); echo "$count" > "$here/state-count"',
    `  if [ "$count" -eq 1 ]; then [ -f "$here/post-kill-listing" ] || : > "$here/state-before-listing"; ${answerFor(first, clockCutAt === 'first' || clockCutAt === 'firstTimeout')}; fi`,
    ...(third ? [`  if [ "$count" -eq 2 ]; then ${answerFor(second)}; fi`] : []),
    `  ${answerFor(third ?? second, clockCutAt === 'second' || clockCutAt === 'reaped' || clockCutAt === 'failed' || clockCutAt === 'thirdFailed')}`,
    'fi',
    'exec /bin/ps "$@"',
  ].join('\n'));
  const options = { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', ...(clockCutAt ? { clockCut: 20_000, clockAtListing: clockCutAt === 'listing', clockAtReaped: ['reaped', 'failed', 'thirdFailed'].includes(clockCutAt), clockBranch: clockCutAt === 'reaped' ? 'answered-live' : 'plain-failure', clockAtKill: clockCutAt === 'kill' } : {}) };
  try {
  const result = caller ? { ...await cleanedUpBy(caller, directory, options), pairs: linesOf(directory, 'pairs'), exiting: Number(read(directory, 'exiting')), ended: Date.now() } : await cleanedUp(directory, options);
  assert.equal(result.status, 0, result.stderr);
  if (observe) {
    assert.ok(killedIn(result.pairs, outside) !== undefined, 'the census did not send the named outside PID its kill');
    return observe({ directory, outside, result, trace: linesOf(directory, 'control.trace.jsonl') });
  }
  assert.ok(existsSync(join(directory, 'post-kill-listing')), 'the named kill was not followed by the chosen directory listing');
  assert.ok(existsSync(join(directory, `post-kill-${listing}`)), 'the post-kill listing did not force its chosen answer');
  assert.ok(killedIn(result.pairs, outside) !== undefined, 'the census did not send the named outside PID its kill');
  assert.ok(existsSync(join(directory, `state-${first}`)), 'the optional state read did not force its chosen answer');
  const reads = Number(read(directory, 'state-count'));
  if (first === 'zombie' || first === 'gone') {
    assert.ok(existsSync(join(directory, 'state-before-listing')), 'the ended state was not observed before the next directory listing');
    assert.equal(reads, 1, 'a process shown ended before the next listing was read again');
    assert.equal(existsSync(join(directory, `state-${second}`)), false, 'a state read followed the ended answer');
    assert.deepEqual(result.events.filter(({ pid }) => pid === outside).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
  } else if (second === 'live') {
    assert.ok(existsSync(join(directory, `state-${second}`)), 'the following state read did not force its chosen answer');
    assert.ok(reads >= 2, 'the second live answer was not reached');
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } else if (second === 'failed') {
    assert.ok(existsSync(join(directory, `state-${second}`)), 'the following state read did not force its chosen answer');
    assert.ok(reads >= 2, 'the plain failed state read was not reached');
    assertUnended(directory, result.events, 'survivor.unended', first === 'live' ? 'still alive when L0\'s read bound ran out after its kill' : 'not shown to have ended: the process table could not be read');
  } else {
    assert.ok(existsSync(join(directory, `state-${second}`)), 'the following state read did not force its chosen answer');
    assert.equal(reads, 2, 'the chosen ended-state answer was not the next read');
    assert.deepEqual(result.events.filter(({ pid }) => pid === outside).map(({ event, name, cmd }) => ({ event, name, cmd })), [{ event: 'survivor.killed', ...tailOf(directory) }]);
  }
  t.diagnostic(JSON.stringify({ cell: { listing, first, second }, pairs: result.pairs, events: result.events, stateReads: read(directory, 'state-count') }));
  return result.events;
  } finally {
    if (caller) t.diagnostic(JSON.stringify({ cell: { listing, first, second, third }, trace: linesOf(directory, 'control.trace.jsonl'), markers: { first: existsSync(join(directory, `state-${first}`)), listing: existsSync(join(directory, `post-kill-${listing}`)), reads: existsSync(join(directory, 'state-count')) ? read(directory, 'state-count') : null } }));
  }
}

/** Successful live results returned by the named state stand-in, excluding timed-out partial output. */
const liveAnswersOf = (trace, directory, pid) => trace.filter(({ kind, tool, args, error, status, stdout }) => kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${pid} -o pid=,stat=` && !error && status === 0 && stdout === `${pid} T\n`);

// proves R-STATE-19, R-STATE-9
test('after a named directory kill, an answered listing still lists its PID and records no unread directory', SETTLES_WITHIN, async (t) => {
  const events = await directoryReadCell(t, { listing: 'listed', first: 'live', second: 'zombie' });
  assert.equal(events.some(({ event }) => event === 'directory.unread'), false);
});

// proves R-STATE-19, R-STATE-9
test('after a named directory kill, an answered listing omits its PID and records no unread directory', SETTLES_WITHIN, async (t) => {
  const events = await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'zombie' });
  assert.equal(events.some(({ event }) => event === 'directory.unread'), false);
});

// proves R-STATE-19, R-STATE-9
test('after a named directory kill, a plain failed listing records the unread directory before reaping', SETTLES_WITHIN, async (t) => {
  const events = await directoryReadCell(t, { listing: 'failed', first: 'live', second: 'zombie' });
  assert.match(events.find(({ event }) => event === 'directory.unread')?.census ?? '', /lsof: forced failure/);
});

// proves R-STATE-19, R-STATE-9
test('after a named directory kill, a late listing records the unread directory before reaping', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  fixture(directory, 'lsof', [
    '[ -f "$here/hang" ] && : > "$here/post-kill-listing"',
    listingOf('outside', realpathSync.native(join(work, 'sub'))),
  ].join('\n'));
  fixture(directory, 'ps', [
    `if [ -f "$here/hang" ] && [ "$*" = "-p ${outside} -o pid=,stat=" ]; then`,
    '  : > "$here/post-kill-live"',
    '  : > "$here/clock-cut"',
    `  printf '%s T\\n' '${outside}'; exit 0`,
    'fi',
    'exec /bin/ps "$@"',
  ].join('\n'));
  const { status, stderr, events } = await cleanedUpBy(CLOCKED_CALLER, directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside', clockCut: 20_000 });
  const pairs = linesOf(directory, 'pairs');
  assert.equal(status, 0, stderr);
  assert.ok(killedIn(pairs, outside) !== undefined, 'the census did not send the named outside PID its kill');
  assert.ok(existsSync(join(directory, 'post-kill-live')), 'the state read did not show the named outside process alive after its kill');
  assert.equal(existsSync(join(directory, 'post-kill-listing')), false, 'the listing ran instead of receiving LATE before its read');
  assert.ok(existsSync(join(directory, 'clock-jumps')), 'the synchronous read driver did not reach LATE');
  assert.match(events.find(({ event }) => event === 'directory.unread')?.census ?? '', /did not finish within/);
  assertUnended(directory, events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  t.diagnostic(JSON.stringify({ cell: 'post-kill listing LATE', pairs, events }));
});

// proves R-STATE-19, R-STATE-9
test('without a prior post-kill state answer, a zombie answer ends the directory wait', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'failed', second: 'zombie' });
});

// proves R-STATE-19, R-STATE-9
test('without a prior post-kill state answer, a gone answer ends the directory wait', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'failed', second: 'gone' });
});

// proves R-STATE-19, R-STATE-9
test('without a prior post-kill state answer, a live answer persists until the directory read bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'failed', second: 'live' });
});

// proves R-STATE-19, R-STATE-9
test('after a live post-kill state answer, a zombie answer ends the directory wait', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'zombie' });
});

// proves R-STATE-19, R-STATE-9
test('after a live post-kill state answer, a gone answer ends the directory wait', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'gone' });
});

// proves R-STATE-19, R-STATE-9
test('a live post-kill answer remains live until the directory read bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER });
});

// proves R-STATE-19, R-STATE-9
test('two answered live post-kill reads remain live through a cut later read', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'second', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '2', 'the second live answer was not reached');
    assert.ok(existsSync(join(directory, 'clock-jumps')), 'the read driver did not cut the later read');
    assert.ok(trace.some(({ kind, code }) => kind === 'read-cut' && code === 'LATE'), 'the later read was not cut at LATE');
    const answered = liveAnswersOf(trace, directory, outside);
    assert.equal(answered.length, 2, JSON.stringify(trace));
    assert.ok(trace.some(({ kind, target, name, answer }) => kind === 'signal-answer' && target === outside && name === 0 && answer === true), 'the named PID did not continue answering signal 0');
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('an answered later live read evaluated at the wait bound records live at that bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'reaped', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '2');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 2);
    assert.ok(trace.some(({ kind, branch }) => kind === 'bound-evaluated' && branch === 'answered-live'));
    assertUnended(directory, result.events, 'survivor.unended', 'still alive 1000 ms after L0\'s kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a bound spent by the omitted listing starts no later state read', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'listing', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '1');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 1, 'the first live result did not reach L0');
    assert.ok(existsSync(join(directory, 'clock-jumps')));
    assert.ok(trace.some(({ kind, code }) => kind === 'read-cut' && code === 'LATE'));
    const killed = trace.find(({ kind, target, name }) => kind === 'signal-answer' && target === outside && name === 'SIGKILL')?.sequence;
    assert.ok(killed, 'the named kill did not precede the read');
    assert.equal(trace.filter(({ sequence, kind, tool, args }) => sequence > killed && kind === 'read-start' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`).length, 1);
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a later state read timed out after the first live answer records live at the read bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'timeout', caller: TRACED_CALLER, observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '2');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 1, 'the first live result did not reach L0');
    assert.ok(trace.some(({ kind, tool, args, error }) => kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=` && error === 'ETIMEDOUT'));
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a plain failed post-kill listing still permits a later live state answer', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'failed', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'second', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '2');
    assert.ok(existsSync(join(directory, 'post-kill-failed')), 'the listing did not mark its plain failure');
    const listingStart = trace.find(({ kind, tool, markers }) => kind === 'read-start' && tool === join(directory, 'lsof') && markers?.stateLive && !markers?.listingFailed)?.sequence;
    const listingEnd = trace.find(({ sequence, kind, tool, status, stderr, markers }) => sequence > listingStart && kind === 'read-end' && tool === join(directory, 'lsof') && status === 2 && stderr === 'lsof: forced failure\n' && markers?.listingFailed)?.sequence;
    assert.ok(listingStart && listingEnd, 'the listing did not start, mark, then return its plain failure');
    assert.ok(trace.some(({ sequence, kind, tool, args, status, stdout }) => sequence > listingEnd && kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=` && status === 0 && stdout === `${outside} T\n`), 'the later live state answer did not follow the failed listing');
    assert.match(result.events.find(({ event }) => event === 'directory.unread')?.census ?? '', /lsof: forced failure/);
    assert.equal(liveAnswersOf(trace, directory, outside).length, 2);
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a cut post-kill listing has no returned omission answer or later state read', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'first', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '1');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 1, 'the first live result did not reach L0');
    assert.equal(existsSync(join(directory, 'post-kill-listing')), false);
    const killed = trace.find(({ kind, target, name }) => kind === 'signal-answer' && target === outside && name === 'SIGKILL')?.sequence;
    assert.ok(killed, 'the named kill did not precede the cut');
    assert.equal(trace.some(({ sequence, kind, tool }) => sequence > killed && kind === 'read-start' && tool === join(directory, 'lsof')), false, 'a listing began before the cut');
    assert.match(result.events.find(({ event }) => event === 'directory.unread')?.census ?? '', /did not finish within/);
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a timed-out post-kill listing returns no omission answer', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'timeout', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'listingTimeout', observe: ({ directory, outside, result, trace }) => {
    assert.ok(existsSync(join(directory, 'post-kill-timeout')));
    assert.equal(liveAnswersOf(trace, directory, outside).length, 1, 'a live result reached L0 after the listing timed out');
    const listingStart = trace.find(({ kind, tool, markers }) => kind === 'read-start' && tool === join(directory, 'lsof') && markers?.stateLive && !markers?.listingTimeout)?.sequence;
    const listingEnd = trace.find(({ sequence, kind, tool, error, stdout, markers }) => sequence > listingStart && kind === 'read-end' && tool === join(directory, 'lsof') && error === 'ETIMEDOUT' && stdout === '' && markers?.listingTimeout)?.sequence;
    assert.ok(listingStart && listingEnd, 'the listing did not start, mark its timeout, then return ETIMEDOUT without an answer');
    assert.equal(existsSync(join(directory, 'post-kill-omitted')), false, 'the listing emitted an omission answer');
    assert.equal(trace.some(({ sequence, kind, tool, args }) => sequence > listingEnd && kind === 'read-start' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`), false, 'a later state read started after the listing timeout');
    assert.ok(trace.some(({ sequence, kind, code }) => sequence > listingEnd && kind === 'read-cut' && code === 'LATE'), 'the later state read was not cut at the bound');
    assert.match(result.events.find(({ event }) => event === 'directory.unread')?.census ?? '', /timed out/);
    assertUnended(directory, result.events, 'survivor.unended', 'still alive when L0\'s read bound ran out after its kill');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a timed-out first post-kill state operation supplies no live answer', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'timeout', second: 'live', caller: TRACED_CALLER, clockCutAt: 'firstTimeout', observe: ({ directory, outside, result, trace }) => {
    assert.ok(existsSync(join(directory, 'state-timeout')));
    assert.ok(existsSync(join(directory, 'state-live')), 'the first state operation did not mark its live partial output');
    const killed = trace.find(({ kind, target, name }) => kind === 'signal-answer' && target === outside && name === 'SIGKILL')?.sequence;
    assert.ok(killed, 'the named kill did not precede the first state read');
    const firstStart = trace.find(({ sequence, kind, tool, args, markers }) => sequence > killed && kind === 'read-start' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=` && !markers?.stateLive)?.sequence;
    const firstEnd = trace.find(({ sequence, kind, tool, args, error, stdout, markers }) => sequence > firstStart && kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=` && error === 'ETIMEDOUT' && stdout === `${outside} T\n` && markers?.stateLive && markers?.stateTimeout)?.sequence;
    assert.ok(firstStart && firstEnd, 'the first state read did not start, mark and print live, then return ETIMEDOUT without an answer');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 0, 'a live result reached L0 despite the timed-out first and later reads');
    assert.equal(trace.some(({ sequence, kind, tool }) => sequence > firstEnd && kind === 'read-start' && tool === join(directory, 'lsof')), false, 'a listing started after the first state timeout');
    assert.equal(trace.some(({ sequence, kind, tool, args }) => sequence > firstEnd && kind === 'read-start' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`), false, 'a later state read started after the first timeout');
    assert.ok(trace.some(({ sequence, kind, code }) => sequence > firstEnd && kind === 'read-cut' && code === 'LATE'), 'the wait did not cut a later state read');
    assert.equal(existsSync(join(directory, 'post-kill-omitted')), false, 'the listing answered despite the spent census bound');
    assert.match(result.events.find(({ event }) => event === 'directory.unread')?.census ?? '', /did not finish within/);
    assertUnended(directory, result.events, 'survivor.unended', 'not shown to have ended: the process table could not be read');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a cut before the first post-kill state operation starts supplies no live marker', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', caller: TRACED_CALLER, clockCutAt: 'kill', observe: ({ directory, outside, result, trace }) => {
    assert.ok(trace.some(({ kind, boundary }) => kind === 'clock-armed' && boundary === 'first-state'));
    assert.equal(existsSync(join(directory, 'state-count')), false);
    assert.equal(existsSync(join(directory, 'state-live')), false);
    assert.equal(liveAnswersOf(trace, directory, outside).length, 0);
    const killed = trace.find(({ kind, target, name }) => kind === 'signal-answer' && target === outside && name === 'SIGKILL')?.sequence;
    assert.ok(killed);
    assert.equal(trace.some(({ sequence, kind, tool, args }) => sequence > killed && kind === 'read-start' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`), false);
    assert.match(result.events.find(({ event }) => event === 'directory.unread')?.census ?? '', /did not finish within/);
    assertUnended(directory, result.events, 'survivor.unended', 'not shown to have ended: the process table could not be read');
  } });
});

// proves R-STATE-19, R-STATE-9
test('plain failed later reads evaluated at the wait bound record an unread process table', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'failed', caller: TRACED_CALLER, clockCutAt: 'failed', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '2');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 1, 'the first live result did not reach L0');
    assert.ok(trace.some(({ kind, branch }) => kind === 'bound-evaluated' && branch === 'plain-failure'));
    assert.ok(trace.some(({ kind, tool, args, stderr }) => kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=` && stderr?.includes('ps: forced failure')));
    assertUnended(directory, result.events, 'survivor.unended', 'not shown to have ended 1000 ms after L0\'s kill: the process table could not be read');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a second live answer followed by plain failed reads records an unread process table at the bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'live', third: 'failed', caller: TRACED_CALLER, clockCutAt: 'thirdFailed', observe: ({ directory, outside, result, trace }) => {
    assert.equal(read(directory, 'state-count'), '3');
    assert.equal(liveAnswersOf(trace, directory, outside).length, 2, 'the second live result did not reach L0');
    const killed = trace.find(({ kind, target, name }) => kind === 'signal-answer' && target === outside && name === 'SIGKILL')?.sequence;
    assert.ok(killed);
    const stateReads = trace.filter(({ sequence, kind, tool, args }) => sequence > killed && kind === 'read-end' && tool === join(directory, 'ps') && args.join(' ') === `-p ${outside} -o pid=,stat=`);
    assert.deepEqual(stateReads.map(({ status, stdout, stderr, error }) => [status, stdout, stderr, error ?? null]), [[0, `${outside} T\n`, '', null], [0, `${outside} T\n`, '', null], [2, '', 'ps: forced failure\n', null]]);
    assert.ok(trace.some(({ kind, branch }) => kind === 'bound-evaluated' && branch === 'plain-failure'));
    assertUnended(directory, result.events, 'survivor.unended', 'not shown to have ended 1000 ms after L0\'s kill: the process table could not be read');
  } });
});

// proves R-STATE-19, R-STATE-9
test('a zombie seen immediately after the named kill is not read again after the next listing', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'zombie', second: 'failed' });
});

// proves R-STATE-19, R-STATE-9
test('a PID gone immediately after the named kill is not read again after the next listing', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'gone', second: 'failed' });
});

// proves R-STATE-19, R-STATE-9
test('without a prior post-kill state answer, plain state-read failures retry until the read bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'failed', second: 'failed' });
});

// proves R-STATE-19, R-STATE-9
test('after a live post-kill state answer, plain state-read failures retry until the read bound', SETTLES_WITHIN, async (t) => {
  await directoryReadCell(t, { listing: 'omitted', first: 'live', second: 'failed' });
});

/** Shows a failed group census can still reach and name the outside directory process. */
async function groupReadCell(t, mode) {
  const directory = holding(t);
  const work = await workedIn(t, directory);
  const outside = pidIn(directory, 'outside');
  holdingNone(directory);
  fixture(directory, 'lsof', listingOf('outside', realpathSync.native(join(work, 'sub'))));
  fixture(directory, 'ps', [
    'case "$*" in "-ww -g "*" -o pid=,stat=")',
    '  if [ ! -f "$here/group-first" ]; then',
    '    : > "$here/group-first"',
    ...(mode === 'failed' ? ['    echo "ps: forced group failure" >&2; exit 2'] : ['    : > "$here/group-clock-cut"']),
    '  fi ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n'));
  const caller = mode === 'late' ? GROUP_LATE_CALLER : CALLER;
  const { status, stderr, events } = await cleanedUpBy(caller, directory, { ps: 'ps', lsof: 'lsof', directory: work, hangAfter: 'outside', unkept: 'outside' });
  const pairs = linesOf(directory, 'pairs');
  assert.equal(status, 0, stderr);
  assert.ok(existsSync(join(directory, 'group-first')), 'the group census did not reach its forced read');
  if (mode === 'late') assert.ok(existsSync(join(directory, 'group-clock-jump')), 'the group read driver did not reach LATE');
  assert.ok(killedIn(pairs, outside) !== undefined, 'the later directory sweep did not kill the named outside PID');
  assert.ok(events.some(({ pid, name, cmd }) => pid === outside && name === 'tail' && cmd === tailOf(directory).cmd), 'the later directory record did not name the outside PID');
  t.diagnostic(JSON.stringify({ cell: `group.${mode}`, pairs, events }));
  return events;
}

// proves R-STATE-19, R-STATE-9
test('a plain failed group census still reaches the named outside directory process', SETTLES_WITHIN, async (t) => {
  const events = await groupReadCell(t, 'failed');
  assert.ok(events.some(({ event, census }) => event === 'group.killed' && /ps: forced group failure/.test(census ?? '')));
});

// proves R-STATE-19, R-STATE-9
test('a late group census still reaches the named outside directory process', SETTLES_WITHIN, async (t) => {
  const events = await groupReadCell(t, 'late');
  assert.ok(events.some(({ event, census }) => event === 'group.killed' && /did not finish within/.test(census ?? '')));
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
 * Has the exit cleanup end a group whose leader is `kept`, as `CALLER` names its options, and
 * asserts the cleanup hands its step no exit code, but that it could not end the command, for
 * `why`, and records the leader as a process it could not end.
 */
async function assertLeaderUnended(t, kept, why) {
  const directory = holding(t);
  holdingTwo(directory);

  const { status, events } = await cleanedUp(directory, { [kept]: 'group' });

  const group = pidIn(directory, 'group');
  assert.equal(status, 0);
  assert.equal(alive(group), true, 'the kill ended the leader, so the test proves nothing');
  const ending = JSON.parse(read(directory, 'ending'));
  assert.equal('exit' in ending, false, JSON.stringify(ending));
  assert.match(ending.unread ?? '', /could not end the command/, JSON.stringify(ending));
  assert.match(ending.unread, why, JSON.stringify(ending));
  assert.deepEqual(events.filter(({ pid }) => pid === group).map(({ event }) => event), ['survivor.unended']);
}

// proves R-STATE-9, R-STATE-19
test('given a command whose leader the kill does not end, the exit cleanup hands its step no exit code, but that it could not end the command', SETTLES_WITHIN, async (t) => {
  await assertLeaderUnended(t, 'unkept', /still alive when the exit cleanup's read bound/);
});

// proves R-STATE-9, R-STATE-19
test('given a command whose leader L0 may not signal, the exit cleanup hands its step no exit code, but that it could not end the command because of EPERM', SETTLES_WITHIN, async (t) => {
  await assertLeaderUnended(t, 'refused', /EPERM/);
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
const failingAfterKill = (directory) => fixture(directory, 'ps', '[ -f "$here/hang" ] && { echo "ps: failing on purpose" >&2; exit 2; }\nexec /bin/ps "$@"');

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
 * A command that writes its pid, its group's id, to `$here/group.pid`, leaves a `tail` in its group,
 * `one`, starts `zombieJoiner`'s program for its group, whose child joins it as `two`, marks
 * `$here/up`, and runs until the test writes `release`, or until killed.
 */
const joinedLate = (directory) => fixture(directory, 'command', ['echo $$ > "$here/group.pid"', leave(TAIL, 'one'), joining(directory), ': > "$here/up"', 'while [ ! -f "$here/release" ]; do :; done'].join('\n'));

/** Each event in `events` for the process `pid`, by its name, name and command line, and reason. */
const recordOf = (events, pid) => events.filter((event) => event.pid === pid).map(({ event, name, cmd, reason }) => ({ event, name, cmd, reason }));

// proves R-STATE-19, R-STATE-9
test('on the exit cleanup, a member no read before the kill listed, which outlives the kill, is recorded as a process it could not end by name and command line', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  joinedLate(directory);
  hidingTwoUntilKilled(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group', unkept: 'two' });

  const two = pidIn(directory, 'two');
  assert.equal(status, 0);
  assert.equal(alive(two), true, 'the kill ended the member, so the test proves nothing');
  assert.deepEqual(recordOf(events, two), [
    { event: 'survivor.unended', ...tailOf(directory), reason: `still alive when the exit cleanup's read bound of ${CLEANUP_BOUND} ms ran out` },
  ]);
});

/**
 * A `ps` stand-in that cuts the process `$here/two.pid` names out of every read until `$here/hang`
 * marks that L0 has sent its group the kill, and from then on fails each read of a name, as `ps`
 * fails, and answers every other read as `ps` does.
 */
const hidingTwoUnnamed = (directory) => fixture(directory, 'ps', [
  `[ -f "$here/hang" ] || { ${CUT_TWO}; exit 0; }`,
  'case "$*" in *"-o ucomm="*) echo "ps: failing on purpose" >&2; exit 2 ;; esac',
  'exec /bin/ps "$@"',
].join('\n'));

// proves R-STATE-19, R-STATE-9
test('on the exit cleanup, a member no read before the kill listed, which outlives the kill, and whose name no read after it can read, is recorded as a process it could not end by pid and why', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  joinedLate(directory);
  hidingTwoUnnamed(directory);

  const { status, events } = await cleanedUp(directory, { ps: 'ps', hangAfter: 'group', unkept: 'two' });

  const two = pidIn(directory, 'two');
  assert.equal(status, 0);
  assert.equal(alive(two), true, 'the kill ended the member, so the test proves nothing');
  assert.deepEqual(recordOf(events, two), [
    { event: 'survivor.unended', name: undefined, cmd: undefined, reason: `still alive when the exit cleanup's read bound of ${CLEANUP_BOUND} ms ran out` },
  ]);
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
const failingOnceAfterKill = (directory) => fixture(directory, 'ps', [
  'case "$*" in *stat=*)',
  '  if [ -f "$here/hang" ] && [ ! -f "$here/failed" ]; then : > "$here/failed"; echo "ps: failing once on purpose" >&2; exit 2; fi ;;',
  'esac',
  'exec /bin/ps "$@"',
].join('\n'));

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
  return fixture(directory, 'ps', [
    '[ -f "$here/answered" ] && { : > "$here/failed"; echo "ps: failing on purpose" >&2; exit 2; }',
    '[ -f "$here/hang" ] || exec /bin/ps "$@"',
    'case "$*" in *stat=*) ;; *) exec /bin/ps "$@" ;; esac',
    'rows=$(/bin/ps "$@") || exit $?',
    'printf "%s\\n" "$rows"',
    `printf "%s\\n" "$rows" | /usr/bin/awk -v pid="$(/bin/cat "$here/${name}.pid")" '${lists}' && printf "%s\\n" "$rows" > "$here/answered"`,
    'exit 0',
  ].join('\n'));
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
