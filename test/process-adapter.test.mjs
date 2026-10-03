// ABOUTME: Tests L0's process adapter: a command's exit code, output, working directory and
// environment, the process group it runs in, the survivors it kills and records, output held open
// past the group, a sink that refuses the record, the timeout, and a command that never started.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { EVENT_REFUSED, NOT_STARTED, PS, TIMER_MAX, runCommand, whenElapsed } from '../src/substrate/process.mjs';
import { OUTLIVED, TAIL, alive, bytes, fixture, holding, leave, outliving, read, ready, running, scratch, startOf, warmed } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

// A bound on the test alone, so that a call which never settles fails here rather than holding
// the suite: nothing waits on it when the call settles.
const { 20_000: SETTLES_WITHIN } = BOUNDS;

/** An `L0` emitter over a sink in `directory`, and the state directory it writes to. */
function l0(directory) {
  const state = join(directory, 'state');
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return { state, emitter: sink.emitter({ layer: 'L0' }) };
}

/**
 * Runs `script` under `/bin/sh` through the adapter, with an `L0` emitter over `directory`. The
 * script reads the directory as `$0`, which also puts it in the command line the teardown finds.
 */
function shell(directory, script, options = {}) {
  return adapt(directory, { command: '/bin/sh', args: ['-c', script, directory], ...options });
}

/**
 * A timeout no command in this file reaches unless its test means it to, so a command that hangs
 * fails its test here rather than holding the suite. It is under `SETTLES_WITHIN`.
 */
const UNREACHED = 15_000;

/**
 * Runs a command through the adapter in `directory`, under an empty env, an `L0` emitter over it,
 * and a timeout it does not reach.
 */
function adapt(directory, options) {
  return runCommand({ args: [], cwd: directory, env: {}, emitter: l0(directory).emitter, timeout: UNREACHED, ...options });
}

test('a command that exits 0 has exit code 0 in the result', async (t) => {
  const directory = scratch(t);
  const result = await shell(directory, 'exit 0');
  assert.equal(result.exit, 0);
});

test('a command that exits 3 has exit code 3 in the result', async (t) => {
  const directory = scratch(t);
  const result = await shell(directory, 'exit 3');
  assert.equal(result.exit, 3);
});

// Node's documented default `maxBuffer` for the buffering calls of `node:child_process`, which a
// capture built on one of them would stop at.
const MAX_BUFFER = 1024 * 1024;


/** A Node script, run by this Node, that writes `length` of `bytes(length, step)` to `stream`. */
function writing(directory, stream, length, step) {
  return adapt(directory, {
    command: process.execPath,
    args: ['-e', `process.${stream}.write(Buffer.from(Array.from({ length: ${length} }, (_, i) => (i * ${step}) % 256)))`, directory],
  });
}

// proves R-STATE-14
test('the result carries, as bytes, every byte a command wrote to standard output, past maxBuffer and not UTF-8', async (t) => {
  const directory = scratch(t);
  const written = bytes(MAX_BUFFER + 4099, 7);
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(written), 'the payload is not valid UTF-8');

  const result = await writing(directory, 'stdout', written.length, 7);

  assert.ok(Buffer.isBuffer(result.stdout), 'standard output is carried as bytes');
  assert.equal(result.stdout.length, written.length);
  assert.ok(result.stdout.equals(written), 'standard output holds every byte written, unchanged');
  assert.equal(result.stderr.length, 0, 'nothing written to standard output reaches standard error');
});

// proves R-STATE-14
test('the result carries, as bytes and apart from standard output, every byte a command wrote to standard error', async (t) => {
  const directory = scratch(t);
  const written = bytes(MAX_BUFFER + 5003, 13);

  const result = await writing(directory, 'stderr', written.length, 13);

  assert.ok(Buffer.isBuffer(result.stderr), 'standard error is carried as bytes');
  assert.ok(result.stderr.equals(written), 'standard error holds every byte written, unchanged');
  assert.equal(result.stdout.length, 0, 'nothing written to standard error reaches standard output');
});

test('a command that prints its working directory prints the cwd the adapter was given', async (t) => {
  const directory = scratch(t);
  const given = join(directory, 'elsewhere');
  mkdirSync(given);

  const result = await shell(directory, '/bin/pwd', { cwd: given });

  assert.equal(result.stdout.toString(), `${given}\n`);
});

test('a variable in the caller\'s own environment and absent from the env given is absent from the command\'s', async (t) => {
  const directory = scratch(t);
  process.env.RIGGER_CALLER_ONLY = 'the caller holds this';
  t.after(() => delete process.env.RIGGER_CALLER_ONLY);

  const result = await shell(directory, '/usr/bin/env', { env: { RIGGER_GIVEN: 'given' } });

  const names = result.stdout.toString().split('\n').map((line) => line.split('=')[0]);
  assert.ok(names.includes('RIGGER_GIVEN'), 'the command ran under the env given');
  assert.ok(!names.includes('RIGGER_CALLER_ONLY'), 'the caller\'s own variable reached the command');
});

test('a variable the env given sets has exactly the value given in the command\'s environment', async (t) => {
  const directory = scratch(t);
  const value = ' two  spaces, a = sign,\na newline and ü ';

  const result = await shell(directory, 'printf %s "$RIGGER_GIVEN"', { env: { RIGGER_GIVEN: value } });

  assert.equal(result.stdout.toString(), value);
});

/** The process group id `ps` reads for `pid`. */
const groupOf = (pid) => spawnSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();

/**
 * A line of a fixture that writes, as `ps` reads it, the process group of the shell running it to
 * `$here/<file>`, renamed into place so a reader never sees half of it.
 */
const reportGroup = (file) => `/bin/ps -o pgid= -p $$ > "$here/${file}.tmp" && /bin/mv "$here/${file}.tmp" "$here/${file}"`;

test('every process a command starts that stays in its group reports one process group id, not the caller\'s', async (t) => {
  const directory = scratch(t);
  fixture(directory, 'grandchild', reportGroup('grandchild'));
  fixture(directory, 'child', `${reportGroup('child')}\n"$here/grandchild"`);
  const command = fixture(directory, 'command', `${reportGroup('command')}\n"$here/child"`);

  const result = await adapt(directory, { command });

  assert.equal(result.stderr.toString(), '');
  assert.match(read(directory, 'command'), /^\d+$/);
  assert.equal(read(directory, 'child'), read(directory, 'command'), 'the command\'s child reports the command\'s group');
  assert.equal(read(directory, 'grandchild'), read(directory, 'command'), 'the command\'s grandchild reports the command\'s group');
  assert.notEqual(read(directory, 'command'), groupOf(process.pid), 'the command runs in the caller\'s own group');
});

test('two commands running at once through the adapter report different process group ids', async (t) => {
  const directory = scratch(t);
  // Each writes its own group, then waits until the other has written, so both are alive at once.
  const meet = fixture(directory, 'meet', `${reportGroup('$1')}\nwhile [ ! -f "$here/$2" ]; do :; done`);

  await Promise.all([adapt(directory, { command: meet, args: ['one', 'two'] }), adapt(directory, { command: meet, args: ['two', 'one'] })]);

  assert.match(read(directory, 'one'), /^\d+$/);
  assert.match(read(directory, 'two'), /^\d+$/);
  assert.notEqual(read(directory, 'one'), read(directory, 'two'));
});



// proves R-STATE-14, R-STATE-15
test('a command that exits 0 leaving a child alive that holds its standard output has exit code 0, and all its payload', async (t) => {
  const directory = holding(t);
  const payload = bytes(300_001, 11);
  writeFileSync(join(directory, 'payload'), payload);
  const command = fixture(directory, 'command', `/bin/cat "$here/payload"\n${leave(TAIL, 'survivor')}\nexit 0`);

  const result = await adapt(directory, { command });

  assert.equal(result.exit, 0);
  assert.ok(result.stdout.equals(payload), 'standard output holds every byte of the command\'s payload');
});

test('a child that writes to standard output and standard error before the command exits, and stays alive, has every byte in the result', async (t) => {
  const directory = holding(t);
  const second = bytes(200_003, 17);
  const third = bytes(150_007, 19);
  writeFileSync(join(directory, 'second'), second);
  writeFileSync(join(directory, 'third'), third);
  fixture(directory, 'child', `/bin/cat "$here/second"\n/bin/cat "$here/third" >&2\n: > "$here/written"\nexec ${TAIL}`);
  const command = fixture(directory, 'command', `${leave('"$here/child"', 'survivor')}\nwhile [ ! -f "$here/written" ]; do :; done\nexit 0`);

  const result = await adapt(directory, { command });

  assert.ok(result.stdout.equals(second), 'standard output holds every byte of the child\'s second payload');
  assert.ok(result.stderr.equals(third), 'standard error holds every byte of the child\'s third payload');
});

// proves R-STATE-17, R-STATE-7
test('a child a command leaves alive is not alive when the adapter\'s call settles', async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));

  await adapt(directory, { command });

  assert.equal(alive(Number(read(directory, 'survivor.pid'))), false);
});

test('a child a command leaves alive that ignores SIGTERM is not alive when the adapter\'s call settles', async (t) => {
  const directory = holding(t);
  // The command waits until the child ignores SIGTERM, or it could exit, and be killed, first.
  fixture(directory, 'stubborn', `trap '' TERM\n: > "$here/ignoring"\nexec ${TAIL}`);
  const command = fixture(directory, 'command', `${leave('"$here/stubborn"', 'survivor')}\nwhile [ ! -f "$here/ignoring" ]; do :; done`);

  await adapt(directory, { command });

  assert.equal(alive(Number(read(directory, 'survivor.pid'))), false);
});

/** Every event in the state directory `state`, or none where nothing has been recorded there. */
const eventsIn = (state) => (existsSync(streamPath(state)) ? readEvents(state) : []);

/** Runs a command through the adapter in `directory`, and hands back its result and its events. */
async function recorded(directory, options) {
  const { state, emitter } = l0(directory);
  const result = await adapt(directory, { emitter, ...options });
  return { result, events: eventsIn(state) };
}

// proves R-STATE-12
test('a child left alive when its command exits is recorded under L0 as killed, by its process name and command line', async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));

  const { events } = await recorded(directory, { command });

  // The name is the executable's, the program the fixture ran, and the command line is its
  // arguments as the fixture wrote them, each read off the fixture rather than asked of `ps`.
  assert.deepEqual(events.map(({ layer, event, pid, name, cmd }) => ({ layer, event, pid, name, cmd })), [{
    layer: 'L0',
    event: 'survivor.killed',
    pid: Number(read(directory, 'survivor.pid')),
    name: 'tail',
    cmd: `/usr/bin/tail -f ${directory}/hold`,
  }]);
});

test('two children left alive when their command exits are recorded as one kill each, each naming its own process', async (t) => {
  const directory = holding(t);
  // `cat` opening a FIFO nothing writes to waits in the open, so it runs until it is killed.
  const command = fixture(directory, 'command', [
    '/usr/bin/mkfifo "$here/fifo"',
    leave(TAIL, 'tail'),
    leave('/bin/cat "$here/fifo"', 'cat', 'cat'),
  ].join('\n'));

  const { events } = await recorded(directory, { command });

  const killed = events.filter(({ event }) => event === 'survivor.killed').map(({ pid, name, cmd }) => ({ pid, name, cmd }));
  assert.deepEqual(killed.sort((a, b) => a.pid - b.pid), [
    { pid: Number(read(directory, 'tail.pid')), name: 'tail', cmd: `/usr/bin/tail -f ${directory}/hold` },
    { pid: Number(read(directory, 'cat.pid')), name: 'cat', cmd: `/bin/cat ${directory}/fifo` },
  ].sort((a, b) => a.pid - b.pid));
});

test('a command whose group holds no survivor when it exits is recorded with no kill', async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', '/usr/bin/true\nexit 0');

  const { result, events } = await recorded(directory, { command });

  assert.equal(result.exit, 0);
  assert.deepEqual(events, []);
});

test('a survivor whose command line holds text outside ASCII is recorded with that text unchanged', async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', leave(`${TAIL} "ü ✓ 日本" 2>/dev/null`, 'survivor'));

  const { events } = await recorded(directory, { command });

  assert.deepEqual(events.map(({ cmd }) => cmd), [`/usr/bin/tail -f ${directory}/hold ü ✓ 日本`]);
});

test('a call with no L0 emitter starts no process, and fails naming the missing emitter', async (t) => {
  // Absent, null, and a value with no `emit` to call: none of them can record a kill.
  for (const [what, emitter] of [['undefined', undefined], ['null', null], ['an object with no emit', {}], ['emit that is not a function', { emit: 'L0' }]]) {
    const directory = scratch(t);
    const command = fixture(directory, 'command', ': > "$here/started"');

    await assert.rejects(adapt(directory, { command, emitter }), /emitter/, what);

    assert.equal(existsSync(join(directory, 'started')), false, `the command ran, given ${what}`);
  }
});

test('the caller\'s onGroup is handed the command\'s process group before the call first yields', async (t) => {
  const directory = scratch(t);
  const command = fixture(directory, 'command', reportGroup('group'));
  let handed;

  const settled = adapt(directory, { command, onGroup: (group) => { handed = group; } });
  const beforeYielding = handed;
  await settled;

  assert.equal(beforeYielding, Number(read(directory, 'group')));
});

test('the caller\'s onGroup is handed, with the group, its leader\'s start time as ps reads it', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', `exec ${TAIL}`);
  let handed;

  const settled = adapt(directory, { command, onGroup: (group, started) => { handed = { group, started, read: startOf(group) }; process.kill(group, 'SIGKILL'); } });
  await settled;

  assert.equal(handed.started, handed.read);
});

test('given an onGroup and a start-time read that fails, the call rejects naming that read, onGroup is not called, and no process of the command is alive', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', `exec ${TAIL}`);
  const ps = warmed(fixture(directory, 'ps', 'exit 2'));
  let called = false;

  await assert.rejects(adapt(directory, { command, ps, onGroup: () => { called = true; } }), /could not read when the leader of group \d+ started, so it ended the group: .* ended with 2$/);

  assert.equal(called, false, 'onGroup was called');
  assert.deepEqual(running(join(directory, 'hold')), [], 'a process of the command is alive');
});

test('given an onGroup and a start-time read that prints the start time and a failure on standard error, and exits 0, the call rejects naming that failure, and onGroup is not called', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', `exec ${TAIL}`);
  // The stand-in answers the read of the leader's start time as `ps` does, and then writes a
  // failure to standard error as `ps` writes every failure it reports (`run`). It is `warmed`,
  // because the read of the leader's start time is its first exec, which must reach its body
  // within `readTimeout`.
  const ps = warmed(fixture(directory, 'ps', 'case "$*" in *lstart=*) /bin/ps "$@"; echo "ps: failing on purpose" >&2; exit 0 ;; esac\nexec /bin/ps "$@"'));
  let called = false;

  await assert.rejects(adapt(directory, { command, ps, onGroup: () => { called = true; } }), /could not read when the leader of group \d+ started, so it ended the group: .*ps: failing on purpose/);

  assert.equal(called, false, 'onGroup was called');
  assert.deepEqual(running(join(directory, 'hold')), [], 'a process of the command is alive');
});

test('given an onGroup that throws, the call rejects with what it threw, and no process of the command\'s group is alive', async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', `exec ${TAIL}`);
  const refusal = new Error('the group could not be recorded');
  let handed;

  await assert.rejects(adapt(directory, { command, onGroup: (group) => { handed = group; throw refusal; } }), (thrown) => thrown === refusal);

  assert.equal(alive(-handed), false, 'a process of the command\'s group is alive');
});

test('given an onGroup that throws and a sink that refuses every append, the call rejects naming the unrecorded kill, caused by what onGroup threw', async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', `exec ${TAIL}`);
  const refusal = new Error('the group could not be recorded');
  let handed;

  const error = await rejection(directory, { command, emitter: refusing(directory), onGroup: (group) => { handed = group; throw refusal; } });

  assert.equal(alive(-handed), false, 'a process of the command\'s group is alive');
  assert.equal(error.code, EVENT_REFUSED);
  assert.equal(error.cause, refusal);
  // The kill can land before or after the shell execs `tail`, so the process is named by its pid.
  assert.deepEqual(error.unrecorded.map(({ event, pid }) => ({ event, pid })), [{ event: 'survivor.killed', pid: handed }]);
});

test('the process-table tool the adapter reads by default is named by absolute path, and is ps', () => {
  assert.ok(isAbsolute(PS), `${PS} is not an absolute path`);
  assert.equal(basename(PS), 'ps');
  accessSync(PS, constants.X_OK);
});

test('a caller whose PATH holds no ps still has a surviving child killed and recorded by name', async (t) => {
  const directory = holding(t);
  const path = dirname(process.execPath);
  assert.equal(existsSync(join(path, 'ps')), false, `the narrow PATH ${path} holds a ps`);
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));
  // A caller in a process of its own, so that its PATH is the narrow one and the suite's is not.
  const caller = join(directory, 'caller.mjs');
  writeFileSync(caller, [
    `import { openSink } from ${JSON.stringify(new URL('../src/observation/sink.mjs', import.meta.url).href)};`,
    `import { runCommand } from ${JSON.stringify(new URL('../src/substrate/process.mjs', import.meta.url).href)};`,
    `const sink = openSink({ directory: ${JSON.stringify(join(directory, 'state'))}, run: 'r-test', now: () => 0 });`,
    `await runCommand({ command: ${JSON.stringify(command)}, args: [], cwd: ${JSON.stringify(directory)}, env: {}, timeout: ${UNREACHED}, emitter: sink.emitter({ layer: 'L0' }) });`,
  ].join('\n'));

  const run = spawn(process.execPath, [caller], { env: { PATH: path }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  run.stderr.on('data', (chunk) => { stderr += chunk; });
  const [status] = await once(run, 'close');

  assert.equal(status, 0, stderr);
  assert.equal(alive(Number(read(directory, 'survivor.pid'))), false);
  assert.deepEqual(eventsIn(join(directory, 'state')).map(({ event, name }) => ({ event, name })), [{ event: 'survivor.killed', name: 'tail' }]);
});

test('given a process-table read that never answers, the call settles with no process of the group alive, and records the group\'s kill and the timeout', async (t) => {
  const directory = holding(t);
  // The stand-in `exec`s its wait, so the process the adapter times out and kills is the wait. It
  // may be killed before it runs a line, so it is looked for by its command line, not a pid file.
  writeFileSync(join(directory, 'ps-hold'), '');
  const ps = fixture(directory, 'ps', 'exec /usr/bin/tail -f "$here/ps-hold"');
  const command = fixture(directory, 'command', `echo $$ > "$here/group"\n${leave(TAIL, 'survivor')}`);

  const { events } = await recorded(directory, { command, ps, readTimeout: 200 });

  const group = Number(read(directory, 'group'));
  assert.equal(alive(-group), false, 'a process of the command\'s group is alive');
  assert.equal(alive(Number(read(directory, 'survivor.pid'))), false);
  assert.deepEqual(running(`${directory}/ps`), [], 'the stand-in for ps is alive');
  assert.deepEqual(events.map(({ layer, event, group: killed }) => ({ layer, event, group: killed })), [{ layer: 'L0', event: 'group.killed', group }]);
  assert.match(events[0].census, /process-table read timed out/);
});

test('survivors that keep forking while the group is killed are all dead when the call settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // Each forker starts a `tail`, ends the one before it, and goes round again until it is killed,
  // so a fork is in flight whenever the kill arrives while no forker holds more than two `tail`s.
  fixture(directory, 'forker', [
    'previous=',
    ': > "$here/forking.$1"',
    'while :; do',
    `  ${TAIL} &`,
    '  [ -n "$previous" ] && kill -KILL "$previous"',
    '  previous=$!',
    'done',
  ].join('\n'));
  const forkers = ['1', '2', '3', '4'];
  const command = fixture(directory, 'command', [
    'echo $$ > "$here/group"',
    ...forkers.map((n) => `"$here/forker" ${n} &`),
    ...forkers.map((n) => `while [ ! -f "$here/forking.${n}" ]; do :; done`),
    'exit 0',
  ].join('\n'));

  await adapt(directory, { command });

  assert.equal(alive(-Number(read(directory, 'group'))), false, 'a process of the command\'s group is alive');
});

test('a process that joins the group after the group is killed is dead when the call settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The outsider leaves the command's group and starts a child in it. Once the kill has made that
  // child a zombie, which keeps the group in being because the outsider has not reaped it, the
  // outsider joins the group itself, then reaps the child. So the group has a live member that no
  // kill sent before it joined could reach, every time.
  // Perl, not a `fixture`: perl hands a file whose `#!` line names another interpreter to it.
  writeFileSync(join(directory, 'outsider'), [
    'my ($here, $group) = @ARGV;',
    'setpgrp(0, 0) or die "leave: $!";',
    'my $child = fork();',
    'if ($child == 0) {',
    '  setpgrp(0, $group) or die "join: $!";',
    '  open(my $f, ">", "$here/joined"); close $f;',
    '  exec "/usr/bin/tail", "-f", "$here/hold";',
    '}',
    'while (`/bin/ps -o stat= -p $child` !~ /^Z/) {}',
    'setpgrp(0, $group) or die "rejoin: $!";',
    'waitpid($child, 0);',
    'exec "/usr/bin/tail", "-f", "$here/hold";',
  ].join('\n'));
  // Perl's own errors go to a file of their own, so a fixture that fails says why.
  t.after(() => {
    const failed = existsSync(join(directory, 'outsider.err')) ? readFileSync(join(directory, 'outsider.err'), 'utf8') : '';
    if (failed !== '') t.diagnostic(`the outsider failed: ${failed}`);
  });
  // Its output goes to /dev/null and a file, so it holds neither of the command's pipes.
  const command = fixture(directory, 'command', [
    'echo $$ > "$here/group"',
    '/usr/bin/perl "$here/outsider" "$here" $$ >/dev/null 2>"$here/outsider.err" &',
    'while [ ! -f "$here/joined" ]; do :; done',
    'exit 0',
  ].join('\n'));

  await adapt(directory, { command });

  assert.equal(alive(-Number(read(directory, 'group'))), false, 'a process of the command\'s group is alive');
});

/**
 * A command leaving a survivor that runs `first` under `/bin/bash` until it is told to go, then
 * becomes `tail`, and a `ps` stand-in that splits one read around that exec.
 *
 * One run of `ps` reads a process's name from the process table, and its arguments a moment later
 * (the engineer judge on #354). On a read that carries the command line, the stand-in makes that
 * moment as wide as it can be: it reads every other column, tells the survivor to go, waits until
 * the survivor runs `tail`, then reads the command lines and joins the two row by row. Any other
 * read goes to `ps` as it is. The stand-in is `warmed`, because the census's first read is its
 * first exec, which must reach its body within `readTimeout`.
 */
function reExecuting(directory) {
  fixture(directory, 'first', `: > "$here/running"\nwhile [ ! -f "$here/go" ]; do :; done\nexec ${TAIL}`);
  const ps = warmed(fixture(directory, 'ps', [
    'case "$5" in *,command=) ;; *) exec /bin/ps "$@" ;; esac',
    '/bin/ps "$1" "$2" "$3" -o "${5%,command=}" > "$here/names"',
    ': > "$here/go"',
    'survivor=$(/bin/cat "$here/survivor.pid")',
    'until /bin/ps -o ucomm= -p "$survivor" | /usr/bin/grep -q "^tail"; do :; done',
    '/bin/ps "$1" "$2" "$3" -o command= > "$here/arguments"',
    '/usr/bin/paste -d " " "$here/names" "$here/arguments"',
  ].join('\n')));
  // `/bin/bash` by name, because macOS's `/bin/sh` runs another executable.
  const command = fixture(directory, 'command', `/bin/bash "$here/first" &\necho $! > "$here/survivor.pid"\nwhile [ ! -f "$here/running" ]; do :; done`);
  return { command, ps };
}

// proves R-STATE-12
test('a survivor told to re-execute inside a read of the process table is recorded by the name and command line the last read found', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const { events } = await recorded(directory, reExecuting(directory));

  // The survivor becomes `tail` inside the census's first read of command lines, and the census
  // reads names after that read, so it records `tail` by name and command line alike.
  assert.deepEqual(events.map(({ event, name, cmd }) => ({ event, name, cmd })), [
    { event: 'survivor.killed', name: 'tail', cmd: `/usr/bin/tail -f ${directory}/hold` },
  ]);
});

/**
 * A program at `$here/<name>` that waits until it is killed, compiled for the test. A copy of a
 * system binary under a new name is killed by the kernel on launch, and a link runs under its
 * target's name, so a name of the test's choosing needs a binary of its own (the engineer judge
 * on #354).
 */
function waiter(directory, name) {
  writeFileSync(join(directory, 'waiter.c'), '#include <unistd.h>\nint main(void) { for (;;) pause(); }\n');
  const built = spawnSync('/usr/bin/cc', ['-o', join(directory, name), join(directory, 'waiter.c')], { encoding: 'utf8' });
  assert.equal(built.status, 0, `cc failed: ${built.stderr}`);
}

test('a survivor is recorded by its own name and command line whatever its executable\'s name and argv[0]', SETTLES_WITHIN, async (t) => {
  // A name of wide characters is padded by `ps` to fewer characters than a narrow one, and an
  // argv[0] can start with a capital, a space, or anything else.
  const name = '日本語日本';
  for (const argv0 of ['Tx', 'Ts y', '  lead', 'tx']) {
    const directory = scratch(t);
    waiter(directory, name);
    const command = fixture(directory, 'command', [
      `/bin/bash -c 'exec -a "$1" "$0/${name}" "$0"' "$here" '${argv0}' &`,
      'echo $! > "$here/survivor.pid"',
      // Until the waiter runs, as neither the shell that forked it nor the one that execs it.
      'while /bin/ps -o ucomm= -p $! | /usr/bin/grep -qE "^(sh|bash) *$"; do :; done',
    ].join('\n'));

    const { events } = await recorded(directory, { command });

    assert.deepEqual(events.map(({ event, pid, name: recordedName, cmd }) => ({ event, pid, name: recordedName, cmd })), [
      { event: 'survivor.killed', pid: Number(read(directory, 'survivor.pid')), name, cmd: `${argv0} ${directory}` },
    ], `argv[0] ${JSON.stringify(argv0)}`);
  }
});

test('a survivor whose state reads as ? is read again, not left unnamed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // `ps` prints the state `?` for a process caught mid-exec (the engineer judge on #354), whose
  // name can then be either image's. This stand-in's first answer shows every process that way, in
  // place of its state, and its first read of a name answers `mid-exec`. A census that kept that
  // round would record the survivor by that name. It is `warmed`, because the census's first read
  // is its first exec, which must reach its body within `readTimeout`.
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in *ucomm=*) /bin/mkdir "$here/named" 2>/dev/null && { echo mid-exec; exit 0; } ;; esac',
    'if /bin/mkdir "$here/called" 2>/dev/null; then',
    `  /bin/ps "$@" | /usr/bin/sed -E 's/^( *[0-9]+) .*$/\\1 ?/'`,
    'else',
    '  exec /bin/ps "$@"',
    'fi',
  ].join('\n')));
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));

  const { events } = await recorded(directory, { command, ps });

  assert.equal(existsSync(join(directory, 'called')), true, 'the census never read the table');
  assert.deepEqual(events.map(({ event, name, cmd }) => ({ event, name, cmd })), [
    { event: 'survivor.killed', name: 'tail', cmd: `/usr/bin/tail -f ${directory}/hold` },
  ]);
});

test('a zombie in the group is left out of the census, and only the living are recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The parent's child exits at once, and the parent never reaps it, so the group holds a zombie.
  // Perl, not a `fixture`: perl hands a file whose `#!` line names another interpreter to it.
  writeFileSync(join(directory, 'parent'), [
    'my $here = $ARGV[0];',
    'my $child = fork();',
    'exit 0 if $child == 0;',
    'open(my $f, ">", "$here/zombie.pid"); print $f $child; close $f;',
    'select(undef, undef, undef, undef);',
  ].join('\n'));
  const command = fixture(directory, 'command', [
    '/usr/bin/perl "$here/parent" "$here" &',
    'echo $! > "$here/parent.pid"',
    'until [ -s "$here/zombie.pid" ] && /bin/ps -o stat= -p "$(/bin/cat "$here/zombie.pid")" | /usr/bin/grep -q "^Z"; do :; done',
  ].join('\n'));

  const { events } = await recorded(directory, { command });

  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [
    { event: 'survivor.killed', pid: Number(read(directory, 'parent.pid')) },
  ]);
});

test('a survivor missing from one of the census\'s reads is read again, not left unnamed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The stand-in's first read of names finds nothing, as `ps` does when no process matches. It is
  // `warmed`, because the census's first read is its first exec, which must reach its body within
  // `readTimeout`.
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in *ucomm=*) /bin/mkdir "$here/names-read" 2>/dev/null && exit 1 ;; esac',
    'exec /bin/ps "$@"',
  ].join('\n')));
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));

  const { events } = await recorded(directory, { command, ps });

  assert.equal(existsSync(join(directory, 'names-read')), true, 'the census never read the names');
  assert.deepEqual(events.map(({ event, name, cmd }) => ({ event, name, cmd })), [
    { event: 'survivor.killed', name: 'tail', cmd: `/usr/bin/tail -f ${directory}/hold` },
  ]);
});

/**
 * The lines of a fixture that copy the compiled waiter to `$here/<name>`, where `name` is shell
 * that may hold a newline, start it, write its pid to `$here/<pidName>.pid`, and wait until it
 * runs as `ps` reads it, its name starting with `first`.
 */
const leaveNamed = (name, pidName, first) => [
  `n=${name}`,
  '/bin/cp "$here/waiter" "$here/$n"',
  '"$here/$n" "$here" &',
  `echo $! > "$here/${pidName}.pid"`,
  `while ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -q "^${first}"; do :; done`,
].join('\n');

test('a survivor whose executable\'s name holds a newline and another\'s pid cannot rename that other survivor', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  waiter(directory, 'waiter');
  // `ps` prints `ucomm` with control characters raw (the engineer judge on #354), so this name
  // prints as a second line that reads as a row for the `tail`'s pid, naming it `evil`.
  const command = fixture(directory, 'command', [
    leave(TAIL, 'tail'),
    leaveNamed(`"x"$'\\n'"$(/bin/cat "$here/tail.pid") evil"`, 'forger', 'x'),
  ].join('\n'));

  const { events } = await recorded(directory, { command });

  const tail = Number(read(directory, 'tail.pid'));
  const forger = Number(read(directory, 'forger.pid'));
  const byPid = new Map(events.map(({ pid, name, cmd }) => [pid, { name, cmd }]));
  assert.deepEqual(byPid.get(tail), { name: 'tail', cmd: `/usr/bin/tail -f ${directory}/hold` });
  assert.equal(byPid.get(forger)?.name, `x\n${tail} evil`);
  assert.equal(events.length, 2);
});

test('a survivor whose executable\'s name holds a newline is named, and costs no other survivor its name', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  waiter(directory, 'waiter');
  const command = fixture(directory, 'command', [
    leave(TAIL, 'tail'),
    leaveNamed(`"a"$'\\n'"b"`, 'broken', 'a'),
  ].join('\n'));

  const { events } = await recorded(directory, { command });

  const byPid = new Map(events.map(({ event, pid, name }) => [pid, { event, name }]));
  assert.deepEqual(byPid.get(Number(read(directory, 'tail.pid'))), { event: 'survivor.killed', name: 'tail' });
  assert.deepEqual(byPid.get(Number(read(directory, 'broken.pid'))), { event: 'survivor.killed', name: 'a\nb' });
  assert.equal(events.length, 2);
});

/**
 * The lines of a fixture that start a holder which leaves the command's process group, then holds
 * the command's standard output open until it is killed, writing its pid to `$here/holder.pid`.
 * They wait until it has left, or the group kill at the command's exit would end it first and the
 * test would prove nothing (engineer, round 2, 10). On macOS no `setsid` binary exists, and perl's
 * `setpgrp(0, 0)` leaves the group. Its standard error goes to a file, so it holds only the one
 * pipe, and says there why it failed where it did.
 */
const DETACH = [
  `/usr/bin/perl -e 'my $here = $ARGV[0]; setpgrp(0, 0) or die "leave: $!"; open(my $f, ">", "$here/left") or die "left: $!"; close $f; exec "/usr/bin/tail", "-f", "$here/hold"' "$here" 2>"$here/holder.err" &`,
  'echo $! > "$here/holder.pid"',
  'while [ ! -f "$here/left" ]; do :; done',
].join('\n');

// proves R-STATE-14
test('a command leaving a process outside its group that holds its standard output settles once the bound has passed, without waiting for that process', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', `echo $$ > "$here/group"\n${DETACH}\nexit 0`);
  const outputBound = 300;

  const started = performance.now();
  const { result } = await recorded(directory, { command, outputBound });
  const elapsed = performance.now() - started;

  assert.equal(result.exit, 0);
  assert.equal(alive(-Number(read(directory, 'group'))), false, 'a process of the command\'s group is alive');
  assert.equal(alive(Number(read(directory, 'holder.pid'))), true, 'the holder was not alive at the settle, so it proves nothing');
  assert.ok(elapsed >= outputBound, `the call settled after ${elapsed} ms, before the bound of ${outputBound} ms passed`);
});

test('a command whose output a process outside its group holds open is recorded under L0 as held past its group', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', `echo $$ > "$here/group"\n${DETACH}\nexit 0`);

  const { events } = await recorded(directory, { command, outputBound: 100 });

  assert.deepEqual(events.map(({ layer, event, group }) => ({ layer, event, group })), [
    { layer: 'L0', event: 'output.held', group: Number(read(directory, 'group')) },
  ]);
});

test('a caller whose call settled past a process holding its output can exit while that process is alive', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', DETACH);
  // A caller in a process of its own, which does nothing once the call has settled, so the one
  // thing that could keep it from exiting is what the adapter holds.
  const caller = join(directory, 'caller.mjs');
  writeFileSync(caller, [
    `import { openSink } from ${JSON.stringify(new URL('../src/observation/sink.mjs', import.meta.url).href)};`,
    `import { runCommand } from ${JSON.stringify(new URL('../src/substrate/process.mjs', import.meta.url).href)};`,
    `const sink = openSink({ directory: ${JSON.stringify(join(directory, 'state'))}, run: 'r-test', now: () => 0 });`,
    `await runCommand({ command: ${JSON.stringify(command)}, args: [], cwd: ${JSON.stringify(directory)}, env: {}, timeout: ${UNREACHED}, emitter: sink.emitter({ layer: 'L0' }), outputBound: 100 });`,
  ].join('\n'));

  const run = spawn(process.execPath, [caller], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  run.stderr.on('data', (chunk) => { stderr += chunk; });
  const [status] = await once(run, 'exit');

  assert.equal(status, 0, stderr);
  assert.equal(alive(Number(read(directory, 'holder.pid'))), true, 'the holder was not alive when the caller exited, so it proves nothing');
});

/**
 * An `L0` emitter over a real sink that refuses every append, because its state directory would
 * sit under a regular file, so the sink can never make it.
 */
function refusing(directory) {
  writeFileSync(join(directory, 'blocked'), '');
  return openSink({ directory: join(directory, 'blocked', 'state'), run: 'r-test', now: () => 0 }).emitter({ layer: 'L0' });
}

/**
 * A command that writes to both its outputs, leaves two children alive, a `tail` and a `cat`, and
 * exits 5.
 */
const leavingTwo = (directory) => fixture(directory, 'command', [
  '/usr/bin/mkfifo "$here/fifo"',
  leave(TAIL, 'tail'),
  leave('/bin/cat "$here/fifo"', 'cat', 'cat'),
  'printf "to standard output"',
  'printf "to standard error" >&2',
  'exit 5',
].join('\n'));

test('given a sink that refuses every append, both children a command leaves alive are dead when the call settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = leavingTwo(directory);

  await assert.rejects(adapt(directory, { command, emitter: refusing(directory) }));

  assert.equal(alive(Number(read(directory, 'tail.pid'))), false, 'the tail is alive');
  assert.equal(alive(Number(read(directory, 'cat.pid'))), false, 'the cat is alive');
});

/** What the adapter's call rejects with, given `options`; it fails the test if the call resolves. */
async function rejection(directory, options) {
  try {
    await adapt(directory, options);
  } catch (error) {
    return error;
  }
  assert.fail('the call settled without rejecting');
}

test('given a sink that refuses every append, the call rejects naming each unrecorded kill by process name and command line', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = leavingTwo(directory);

  const error = await rejection(directory, { command, emitter: refusing(directory) });

  // Each name and command line is read off the fixture, not asked of `ps`.
  const killed = [
    { event: 'survivor.killed', pid: Number(read(directory, 'tail.pid')), name: 'tail', cmd: `/usr/bin/tail -f ${directory}/hold` },
    { event: 'survivor.killed', pid: Number(read(directory, 'cat.pid')), name: 'cat', cmd: `/bin/cat ${directory}/fifo` },
  ];
  const byPid = (a, b) => a.pid - b.pid;
  assert.deepEqual((error.unrecorded ?? []).map(({ event, pid, name, cmd }) => ({ event, pid, name, cmd })).sort(byPid), killed.sort(byPid));
  for (const { cmd } of killed) assert.ok(error.message.includes(cmd), `the failure's message does not give ${cmd}: ${error.message}`);
});

test('given a sink that refuses every append, the failure carries the command\'s exit code and output', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = leavingTwo(directory);

  const error = await rejection(directory, { command, emitter: refusing(directory) });

  assert.equal(error.result?.exit, 5);
  assert.equal(error.result?.stdout.toString(), 'to standard output');
  assert.equal(error.result?.stderr.toString(), 'to standard error');
});

test('given a sink that refuses every append, the failure\'s code tells it from a command that never started', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = leavingTwo(directory);

  const error = await rejection(directory, { command, emitter: refusing(directory) });
  const unstarted = await rejection(directory, { command: join(directory, 'absent'), emitter: l0(directory).emitter });

  assert.equal(error.code, EVENT_REFUSED);
  assert.notEqual(unstarted.code, EVENT_REFUSED, 'a command that never started reads as a refused event');
});

test('a survivor whose executable\'s name ends in a newline is recorded by that name, the newline included', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  waiter(directory, 'waiter');
  const command = fixture(directory, 'command', leaveNamed(`"e"$'\\n'`, 'survivor', 'e'));

  const { events } = await recorded(directory, { command });

  assert.deepEqual(events.map(({ event, pid, name }) => ({ event, pid, name })), [
    { event: 'survivor.killed', pid: Number(read(directory, 'survivor.pid')), name: 'e\n' },
  ]);
});

test('a survivor whose executable\'s name ends in a tab is recorded by that name, the tab included', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  waiter(directory, 'waiter');
  const command = fixture(directory, 'command', leaveNamed(`"t"$'\\t'`, 'survivor', 't'));

  const { events } = await recorded(directory, { command });

  assert.deepEqual(events.map(({ event, pid, name }) => ({ event, pid, name })), [
    { event: 'survivor.killed', pid: Number(read(directory, 'survivor.pid')), name: 't\t' },
  ]);
});

test('two survivors, one whose executable\'s name ends in a newline and one with no trailing whitespace, are each recorded by their own name, byte for byte', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  waiter(directory, 'waiter');
  const command = fixture(directory, 'command', [
    leave(TAIL, 'tail'),
    leaveNamed(`"e"$'\\n'`, 'newline', 'e'),
  ].join('\n'));

  const { events } = await recorded(directory, { command });

  const byPid = (a, b) => a.pid - b.pid;
  assert.deepEqual(events.map(({ event, pid, name }) => ({ event, pid, name: Buffer.from(name).toString('hex') })).sort(byPid), [
    { event: 'survivor.killed', pid: Number(read(directory, 'tail.pid')), name: Buffer.from('tail').toString('hex') },
    { event: 'survivor.killed', pid: Number(read(directory, 'newline.pid')), name: Buffer.from('e\n').toString('hex') },
  ].sort(byPid));
});

/**
 * A command whose group holds, when it exits, a `tail` it left alive and a zombie whose parent is
 * outside the group and never reaps it. The parent leaves the group, forks a child that joins the
 * group and exits, then becomes a `tail` of its own, which never reaps it. The zombie's pid is in
 * `$here/zombie.pid`, the group's in `$here/group`, and the `tail`'s in `$here/tail.pid`. The
 * command runs `more`, shell, last. Given `left` as `''`, it leaves no `tail`, and the group holds
 * the zombie beside its command alone.
 */
function unreaped(directory, more = '', left = leave(TAIL, 'tail')) {
  // Perl, not a `fixture`: perl hands a file whose `#!` line names another interpreter to it.
  writeFileSync(join(directory, 'parent'), [
    'my ($here, $group) = @ARGV;',
    'setpgrp(0, 0) or die "leave: $!";',
    'my $child = fork();',
    'if ($child == 0) { setpgrp(0, $group) or die "join: $!"; exit 0; }',
    'open(my $f, ">", "$here/zombie.pid.tmp"); print $f $child; close $f;',
    'rename("$here/zombie.pid.tmp", "$here/zombie.pid");',
    'exec "/usr/bin/tail", "-f", "$here/hold";',
  ].join('\n'));
  // Its output goes to /dev/null and a file, so it holds neither of the command's pipes.
  return fixture(directory, 'command', [
    'echo $$ > "$here/group"',
    left,
    '/usr/bin/perl "$here/parent" "$here" $$ >/dev/null 2>"$here/parent.err" &',
    'until [ -f "$here/zombie.pid" ] && /bin/ps -o stat=,pgid= -p "$(/bin/cat "$here/zombie.pid")" | /usr/bin/grep -q "^Z.* $$\\$"; do :; done',
    more,
  ].join('\n'));
}

/** The first character of the state `ps` reads for each process in `group`. */
const statesIn = (group) => spawnSync('/bin/ps', ['-g', String(group), '-o', 'stat='], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).map((state) => state[0]);

test('a group holding a zombie that its parent outside the group never reaps settles, with no live process of the group left and no kill of the zombie recorded', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = unreaped(directory);

  const { events } = await recorded(directory, { command });

  const zombie = Number(read(directory, 'zombie.pid'));
  assert.equal(spawnSync('/bin/ps', ['-o', 'stat=', '-p', String(zombie)], { encoding: 'utf8' }).stdout[0], 'Z', 'the zombie was reaped, so the test proves nothing');
  assert.deepEqual(statesIn(Number(read(directory, 'group'))), ['Z'], 'a process of the command\'s group other than the zombie is left');
  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [
    { event: 'survivor.killed', pid: Number(read(directory, 'tail.pid')) },
  ]);
});

/** When the file `name` in `directory` was last written, in milliseconds on `Date.now()`'s clock. */
const writtenAt = (directory, name) => statSync(join(directory, name)).mtimeMs;

/**
 * The line of a fixture that starts a watcher outside the command's group, so no kill of the group
 * reaches it, which waits until the process whose pid is in `$here/<name>.pid` has ended and then
 * writes `$here/<name>.ended`. That file is written no earlier than the process ended. The watcher
 * polls, but in a process of its own, so its processor time is not the caller's. The lines wait
 * until it has left the group.
 */
const watchEnd = (name) => [
  `/usr/bin/perl -e 'my ($here, $pid) = @ARGV; setpgrp(0, 0) or die "leave: $!"; open(my $w, ">", "$here/watching") or die "watching: $!"; close $w; 1 while kill 0, $pid; open(my $f, ">", "$here/${name}.ended") or die "ended: $!"; close $f' "$here" "$(/bin/cat "$here/${name}.pid")" >/dev/null 2>"$here/watcher.err" &`,
  // Until it has left the group, or the kill would end it too.
  'while [ ! -f "$here/watching" ]; do :; done',
].join('\n');

test('while the call waits for a killed group to empty, it uses less than a tenth of that wait\'s time of the processor', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The group never empties, because of the zombie, so the call waits until it gives up on it.
  const command = unreaped(directory, watchEnd('tail'));
  const used = process.cpuUsage();

  await recorded(directory, { command });

  const settled = Date.now();
  const { user, system } = process.cpuUsage(used);
  // The wait began at the kill, and the `tail` ended at it, so it lasted at least this long.
  const waited = settled - writtenAt(directory, 'tail.ended');
  // The processor time over the whole call is no less than over the wait alone.
  const cpu = (user + system) / 1000;
  t.diagnostic(`${cpu} ms of the processor over a wait of at least ${waited} ms`);
  assert.ok(waited > 0, `the wait lasted ${waited} ms`);
  assert.ok(cpu < waited / 10, `the call used ${cpu} ms of the processor over a wait of at least ${waited} ms`);
});

test('while the call re-reads a census, it uses less than a tenth of those re-reads\' time of the processor', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The stand-in shows every process caught mid-exec, state `?`, in each of the census's reads of
  // states, which begin `-ww`, so the census's reads never agree and it reads again until its
  // bound, then keeps its last round. Its second call marks the re-reads' start, and each call
  // leaves a file in `reads`. It is compiled, and runs `ps`, so that a read costs what a read of
  // `ps` costs, near enough: a shell stand-in costs a shell's start on every read.
  // It is `warmed`, because the census's first read is its first exec, which must reach its body
  // within `readTimeout`. Run with `RIGGER_FIXTURE_WARMING` set, it exits before marking a call,
  // so its first call is still the census's.
  writeFileSync(join(directory, 'ps.c'), [
    '#include <fcntl.h>',
    '#include <stdio.h>',
    '#include <stdlib.h>',
    '#include <string.h>',
    '#include <sys/stat.h>',
    '#include <sys/wait.h>',
    '#include <unistd.h>',
    'int main(int argc, char **argv) {',
    '  char here[4096], path[4608];',
    '  snprintf(here, sizeof here, "%s", argv[0]);',
    '  *strrchr(here, \'/\') = 0;',
    '  if (getenv("RIGGER_FIXTURE_WARMING")) return 0;',
    '  snprintf(path, sizeof path, "%s/called", here);',
    '  if (mkdir(path, 0700) != 0) { snprintf(path, sizeof path, "%s/second", here); close(open(path, O_CREAT | O_EXCL | O_WRONLY, 0600)); }',
    '  snprintf(path, sizeof path, "%s/reads/%d", here, getpid());',
    '  close(open(path, O_CREAT | O_WRONLY, 0600));',
    '  int states = 0;',
    '  for (int i = 1; i < argc; i++) if (strstr(argv[i], "stat=")) states = 1;',
    '  if (!states || strcmp(argv[1], "-ww") != 0) { execv("/bin/ps", argv); return 127; }',
    '  int out[2];',
    '  if (pipe(out) != 0) return 127;',
    '  pid_t pid = fork();',
    '  if (pid < 0) return 127;',
    '  if (pid == 0) { dup2(out[1], 1); close(out[0]); close(out[1]); execv("/bin/ps", argv); _exit(127); }',
    '  close(out[1]);',
    '  FILE *in = fdopen(out[0], "r");',
    '  char line[4096];',
    '  while (fgets(line, sizeof line, in)) { int row; if (sscanf(line, "%d", &row) == 1) printf("%d ?\\n", row); }',
    '  int status;',
    '  if (waitpid(pid, &status, 0) != pid) return 127;',
    '  return WIFEXITED(status) ? WEXITSTATUS(status) : 127;',
    '}',
  ].join('\n'));
  const ps = join(directory, 'ps');
  const built = spawnSync('/usr/bin/cc', ['-o', ps, join(directory, 'ps.c')], { encoding: 'utf8' });
  assert.equal(built.status, 0, `cc failed: ${built.stderr}`);
  warmed(ps);
  mkdirSync(join(directory, 'reads'));
  const command = fixture(directory, 'command', `${leave(TAIL, 'survivor')}\n: > "$here/exited"`);
  const readTimeout = 1_500;
  const used = process.cpuUsage();

  const { events } = await recorded(directory, { command, ps, readTimeout });

  const { user, system } = process.cpuUsage(used);
  assert.deepEqual(events.map(({ event }) => event), ['survivor.killed'], 'the census did not keep its last round once its reads never agreed');
  assert.ok(writtenAt(directory, 'called') >= writtenAt(directory, 'exited'), 'the stand-in\'s first call came before the census, so its second call marks no re-read');
  // The census began once the command had exited, and re-read until `readTimeout` had passed
  // from its start, so the re-reads lasted at least this long.
  const rereading = writtenAt(directory, 'exited') + readTimeout - writtenAt(directory, 'second');
  // The processor time over the whole call is no less than over the re-reads alone.
  const cpu = (user + system) / 1000;
  t.diagnostic(`${cpu} ms of the processor over re-reads of at least ${rereading} ms, in ${readdirSync(join(directory, 'reads')).length} reads`);
  assert.ok(cpu < rereading / 10, `the call used ${cpu} ms of the processor over re-reads of at least ${rereading} ms`);
});

test('a survivor the census named that exits on its own before the kill is not recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The quitter exits once told to go. The stand-in tells it to go inside the census's last read of
  // states, which it answers as the table stood before, so the census names the quitter and is gone
  // before the read just before the kill. The stand-in is `warmed`, because the census's first read
  // is its first exec, which must reach its body within `readTimeout`.
  fixture(directory, 'quitter', 'while [ ! -f "$here/go" ]; do :; done\nexit 0');
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in *ucomm=*) : > "$here/named" ;; esac',
    'case "$*" in *stat=*)',
    '  if [ -f "$here/named" ] && /bin/mkdir "$here/told" 2>/dev/null; then',
    '    table=$(/bin/ps "$@")',
    '    quitter=$(/bin/cat "$here/quitter.pid")',
    '    : > "$here/go"',
    '    while kill -0 "$quitter" 2>/dev/null; do :; done',
    '    printf "%s\\n" "$table"',
    '    exit 0',
    '  fi ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n')));
  const command = fixture(directory, 'command', [leave(TAIL, 'tail'), leave('"$here/quitter"', 'quitter', 'bash')].join('\n'));

  const { events } = await recorded(directory, { command, ps });

  assert.equal(existsSync(join(directory, 'told')), true, 'the quitter was never told to go, so the test proves nothing');
  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [
    { event: 'survivor.killed', pid: Number(read(directory, 'tail.pid')) },
  ]);
});

// A `ps` stand-in that never answers: it `exec`s a wait the adapter times out and kills, and names
// the scratch directory, so the teardown finds any the adapter left.
const HUNG_PS = 'exec /usr/bin/tail -f "$here/hold"';

// A `ps` stand-in that fails as `ps` fails given what it cannot read.
const FAILING_PS = 'echo "ps: failing on purpose" >&2\nexit 2';

for (const [what, body] of [['never answers', HUNG_PS], ['fails', FAILING_PS]]) {
  test(`a group holding a zombie that its parent outside the group never reaps settles where the process-table read ${what}, with no live process of the group left`, SETTLES_WITHIN, async (t) => {
    const directory = holding(t);
    const command = unreaped(directory);
    const ps = fixture(directory, 'ps', body);

    const { events } = await recorded(directory, { command, ps, readTimeout: 200 });

    const zombie = Number(read(directory, 'zombie.pid'));
    assert.equal(spawnSync('/bin/ps', ['-o', 'stat=', '-p', String(zombie)], { encoding: 'utf8' }).stdout[0], 'Z', 'the zombie was reaped, so the test proves nothing');
    assert.deepEqual(statesIn(Number(read(directory, 'group'))), ['Z'], 'a process of the command\'s group other than the zombie is left');
    assert.deepEqual(events.map(({ event }) => event), ['group.killed']);
  });
}

test('survivors whose executables\' names are longer than 16 bytes are each recorded by their first 16 bytes', SETTLES_WITHIN, async (t) => {
  // `ucomm` holds the kernel's cut of the name at 16 bytes (`D16` rule 3). The first name's cut
  // ends in a letter, the second's holds a newline, and the third's ends in a space, which `ps`'s
  // padding makes indistinguishable from the name's own, so it is not recorded.
  const names = [['abcdefghijklmnopqrs', 'abcdefghijklmnop'], ['x\nbcdefghijklmnop', 'x\nbcdefghijklmno'], ['abcdefghijklmno xyz', 'abcdefghijklmno']];
  const directory = holding(t);
  waiter(directory, 'waiter');
  const command = fixture(directory, 'command', names.map(([name], n) => leaveNamed(`$'${[...Buffer.from(name)].map((byte) => `\\x${byte.toString(16).padStart(2, '0')}`).join('')}'`, `long${n}`, name[0])).join('\n'));

  const { events } = await recorded(directory, { command });

  const byPid = new Map(events.map(({ pid, name }) => [pid, Buffer.from(name).toString('hex')]));
  assert.deepEqual(names.map((_, n) => byPid.get(Number(read(directory, `long${n}.pid`)))), names.map(([, recorded]) => Buffer.from(recorded).toString('hex')));
});

test('a survivor whose argv[0] differs from its executable\'s name is recorded by the executable\'s name as ucomm holds it', SETTLES_WITHIN, async (t) => {
  // Each is an executable's name, the argv[0] it is run under, and the name recorded.
  const runs = [['abcdefghijklmnopq', '/elsewhere/abcdefghijklmnopXYZ', 'abcdefghijklmnop'], ['w', 'w  ', 'w']];
  const directory = holding(t);
  waiter(directory, 'waiter');
  const command = fixture(directory, 'command', runs.map(([name, argv0], n) => [
    `/bin/cp "$here/waiter" "$here/${name}"`,
    `/bin/bash -c 'exec -a "$1" "$0" "$2"' "$here/${name}" '${argv0}' "$here" &`,
    `echo $! > "$here/run${n}.pid"`,
    'while /bin/ps -o ucomm= -p $! | /usr/bin/grep -qE "^(sh|bash) *$"; do :; done',
  ].join('\n')).join('\n'));

  const { events } = await recorded(directory, { command });

  const byPid = new Map(events.map(({ pid, name }) => [pid, name]));
  assert.deepEqual(runs.map((_, n) => byPid.get(Number(read(directory, `run${n}.pid`)))), runs.map(([, , recorded]) => recorded));
});

/**
 * A command that leaves a keeper, and a `ps` stand-in that has the keeper's child, the quitter,
 * exit on its own inside one read of states once the census has read the names. The keeper forks
 * the quitter, which exits once told to go, and never reaps it, so the quitter stays a zombie until
 * the kill. The stand-in reads the table, then tells the quitter to go, and answers with the table
 * it read once the quitter is a zombie.
 *
 * `at` is `census` for the census's last read of states, or `kill` for the read the adapter takes
 * after the census, just before its kill, which begins `-g` where the census's begin `-ww`. Every
 * read of states after that one runs `later`, shell, in place of `ps`, where one is given. The
 * stand-in is `warmed`, because the census's first read is its first exec, which must reach its
 * body within `readTimeout`.
 */
function quittingUnreaped(directory, { at = 'census', later = 'exec /bin/ps "$@"' } = {}) {
  // Perl, not a `fixture`: perl hands a file whose `#!` line names another interpreter to it.
  writeFileSync(join(directory, 'keeper'), [
    'my $here = $ARGV[0];',
    'my $quitter = fork();',
    'if ($quitter == 0) { 1 until -e "$here/go"; exit 0; }',
    'open(my $f, ">", "$here/quitter.pid.tmp"); print $f $quitter; close $f;',
    'rename("$here/quitter.pid.tmp", "$here/quitter.pid");',
    'select(undef, undef, undef, undef);',
  ].join('\n'));
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in *ucomm=*) : > "$here/named" ;; esac',
    `case "$*" in *stat=*) ${at === 'kill' ? '[ "$1" = "-g" ]' : 'true'} ;; *) false ;; esac && [ -f "$here/named" ] && /bin/mkdir "$here/told" 2>/dev/null && {`,
    '  table=$(/bin/ps "$@")',
    '  quitter=$(/bin/cat "$here/quitter.pid")',
    '  : > "$here/go"',
    '  until /bin/ps -o stat= -p "$quitter" | /usr/bin/grep -q "^Z"; do :; done',
    '  printf "%s\\n" "$table"',
    '  exit 0',
    '}',
    `case "$*" in *stat=*) [ -d "$here/told" ] && { ${later}; } ;; esac`,
    'exec /bin/ps "$@"',
  ].join('\n')));
  const command = fixture(directory, 'command', [
    '/usr/bin/perl "$here/keeper" "$here" &',
    'echo $! > "$here/keeper.pid"',
    'while [ ! -f "$here/quitter.pid" ]; do :; done',
  ].join('\n'));
  return { command, ps };
}

test('a survivor the census named that exits on its own before the kill, and is left unreaped, is not recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const { events } = await recorded(directory, quittingUnreaped(directory));

  assert.equal(existsSync(join(directory, 'told')), true, 'the quitter was never told to go, so the test proves nothing');
  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [
    { event: 'survivor.killed', pid: Number(read(directory, 'keeper.pid')) },
  ]);
});

test('a survivor the census named that exits on its own before the kill, left unreaped, is not recorded as killed where the read of states before the kill fails', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const { events } = await recorded(directory, quittingUnreaped(directory, { later: 'echo "ps: failing on purpose" >&2; exit 2' }));

  assert.equal(existsSync(join(directory, 'told')), true, 'the quitter was never told to go, so the test proves nothing');
  const quitter = Number(read(directory, 'quitter.pid'));
  assert.deepEqual(events.filter(({ pid }) => pid === quitter), [], 'the quitter is recorded as killed');
  assert.deepEqual(events.map(({ event }) => event), ['group.killed']);
});

test('a survivor the census named that exits on its own inside the read of states just before the kill, and is left unreaped, is counted as killed, the limit the code records', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const { events } = await recorded(directory, quittingUnreaped(directory, { at: 'kill' }));

  assert.equal(existsSync(join(directory, 'told')), true, 'the quitter was never told to go, so the test proves nothing');
  // That read answers as the table stood before the quitter exited, and nothing after the kill
  // tells its own exit from the kill (`contain`).
  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })).sort((one, other) => one.pid - other.pid), [
    { event: 'survivor.killed', pid: Number(read(directory, 'keeper.pid')) },
    { event: 'survivor.killed', pid: Number(read(directory, 'quitter.pid')) },
  ].sort((one, other) => one.pid - other.pid));
});

test('a survivor the census named that exits on its own before the kill, and whose parent outside the group reaps it at once, is not recorded as killed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The parent leaves the command's group and forks the quitter, which joins it, exits once told
  // to go, and is reaped by the parent at once. The stand-in reads the table the census's last read
  // of states asks for, then tells the quitter to go, and answers with that table once the quitter
  // is gone, so the census names a pid that is reaped before the read just before the kill.
  // Perl, not a `fixture`: perl hands a file whose `#!` line names another interpreter to it.
  writeFileSync(join(directory, 'parent'), [
    'my ($here, $group) = @ARGV;',
    'setpgrp(0, 0) or die "leave: $!";',
    'my $quitter = fork();',
    'if ($quitter == 0) { setpgrp(0, $group) or die "join: $!"; 1 until -e "$here/go"; exit 0; }',
    'open(my $f, ">", "$here/quitter.pid.tmp"); print $f $quitter; close $f;',
    'rename("$here/quitter.pid.tmp", "$here/quitter.pid");',
    'waitpid($quitter, 0);',
    'exec "/usr/bin/tail", "-f", "$here/hold";',
  ].join('\n'));
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in *ucomm=*) : > "$here/named" ;; esac',
    'case "$*" in "-ww -g "*" -o pid=,stat=") [ -f "$here/named" ] && /bin/mkdir "$here/told" 2>/dev/null && {',
    '  table=$(/bin/ps "$@")',
    '  quitter=$(/bin/cat "$here/quitter.pid")',
    '  : > "$here/go"',
    '  while kill -0 "$quitter" 2>/dev/null; do :; done',
    '  printf "%s\\n" "$table"',
    '  exit 0',
    '} ;; esac',
    'exec /bin/ps "$@"',
  ].join('\n')));
  // The quitter is the group's one member once the command exits.
  const command = fixture(directory, 'command', [
    '/usr/bin/perl "$here/parent" "$here" $$ >/dev/null 2>"$here/parent.err" &',
    'until [ -f "$here/quitter.pid" ] && /bin/ps -o pgid= -p "$(/bin/cat "$here/quitter.pid")" | /usr/bin/grep -q "^ *$$\\$"; do :; done',
  ].join('\n'));

  const { events } = await recorded(directory, { command, ps });

  assert.equal(existsSync(join(directory, 'told')), true, 'the quitter was never told to go, so the test proves nothing');
  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), []);
});

/**
 * A command that leaves a chain of processes `depth` deep in its group, each the parent of the
 * next, so the kill takes a round for each. Each process of the chain writes its pid to
 * `$here/chain.pids` before it forks, so every one is there once the last marks `$here/ready`.
 */
function chain(directory, depth) {
  // Perl, not a `fixture`: perl hands a file whose `#!` line names another interpreter to it.
  writeFileSync(join(directory, 'chain'), [
    'my ($here, $n) = @ARGV;',
    'sub mine { open(my $f, ">>", "$here/chain.pids"); print $f "$$\\n"; close $f; }',
    'for my $i (1 .. $n) { mine(); my $c = fork(); if ($c) { select(undef, undef, undef, undef); } }',
    'mine();',
    'open(my $r, ">", "$here/ready"); close $r;',
    'select(undef, undef, undef, undef);',
  ].join('\n'));
  return fixture(directory, 'command', `/usr/bin/perl "$here/chain" "$here" ${depth} &\nwhile [ ! -f "$here/ready" ]; do :; done`);
}

test('a kill whose reads of the group after the kill never answer still records the survivor the reads before it named, records the kill of the group in place of what those reads could not list, and settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The stand-in answers every read of the census, which begin `-ww`, and the first of the group's
  // states alone, the read just before the kill, and none after it, which mark `after`. It is
  // `warmed`, because the census's first read is its first exec, which must reach its body within
  // `readTimeout`.
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in "-g "*" -o pid=,stat=")',
    '  /bin/mkdir "$here/before" 2>/dev/null || { : > "$here/after"; exec /usr/bin/tail -f "$here/hold"; } ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n')));
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));

  // Long enough for the census to finish on a loaded host, where the whole suite runs at once.
  const { events } = await recorded(directory, { command, ps, readTimeout: 2_000 });

  assert.equal(existsSync(join(directory, 'before')), true, 'the kill was never read before, so the test proves nothing');
  assert.equal(alive(Number(read(directory, 'survivor.pid'))), false);
  // A read after the kill is made only where the group is still occupied at its first look, and
  // that one never answers, so the kill of the group is recorded in place of what it could not list.
  const after = existsSync(join(directory, 'after'));
  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [{ event: 'survivor.killed', pid: Number(read(directory, 'survivor.pid')) }, ...(after ? [{ event: 'group.killed', pid: undefined }] : [])]);
  if (after) assert.match(events[1].census, /after its kill failed/);
});

/**
 * A `ps` stand-in that answers every read as `ps` does, except the read of the group's states just
 * before the kill, the first read of the group's states alone, where it runs the shell lines
 * `failing` instead and marks `$here/failed`. By then the census has named every process of the
 * chain, and none is yet killed. It is `warmed`, because the census's first read is its first exec,
 * which must reach its body within `readTimeout`.
 */
const failingOnce = (directory, failing) => warmed(fixture(directory, 'ps', [
  'case "$*" in "-g "*" -o pid=,stat=")',
  '  if /bin/mkdir "$here/failed" 2>/dev/null; then',
  failing,
  '  fi ;;',
  'esac',
  'exec /bin/ps "$@"',
].join('\n')));

/**
 * Runs a chain 3 deep through the adapter, the read of the table just before the kill failing as
 * `failing` does, and asserts every process of the chain is recorded, each by name, or all by the
 * kill of their group. Hands back the events.
 */
async function recordsEveryProcess(t, failing, options = {}) {
  const directory = holding(t);
  const command = chain(directory, 3);
  const ps = failingOnce(directory, failing);

  const { events } = await recorded(directory, { command, ps, ...options });

  assert.equal(existsSync(join(directory, 'failed')), true, 'no read before the kill failed, so the test proves nothing');
  const chained = read(directory, 'chain.pids').split('\n').map(Number).sort((a, b) => a - b);
  assert.equal(chained.length, 4);
  if (!events.some(({ event }) => event === 'group.killed')) {
    const named = events.filter(({ event }) => event === 'survivor.killed').map(({ pid }) => pid).sort((a, b) => a - b);
    assert.deepEqual(named, chained, `not every process of the chain was recorded: ${JSON.stringify(events)}`);
  }
  return events;
}

test('a kill whose read just before it exits 1 and prints nothing records every process of the group it ended', SETTLES_WITHIN, async (t) => {
  await recordsEveryProcess(t, '    exit 1');
});

for (const [what, failing, options] of [
  ['exits non-zero after printing only part of the table', '    /bin/ps "$@" | /usr/bin/head -n 1\n    exit 1'],
  ['does not answer within its timeout', '    exec /usr/bin/tail -f "$here/hold"', { readTimeout: 2_000 }],
  // `ps` from adv_cmds-237 exits 0 so, where its read of the kernel's table fails (`run`).
  ['exits 0 printing nothing but a failure to standard error', '    echo "Failure calling sysctl: Cannot allocate memory" >&2\n    exit 0'],
  ['exits 0 after printing only part of the table', '    /bin/ps "$@" | /usr/bin/head -n 1\n    exit 0'],
]) {
  test(`a kill whose read just before it ${what} records every process of the group it ended`, SETTLES_WITHIN, async (t) => {
    await recordsEveryProcess(t, failing, options);
  });
}

// proves R-STATE-12
test('a census whose every read of the group exits 1 and prints nothing while the group holds a survivor records the group\'s kill, saying why', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The census reads the group with `-ww`, and the kill and the wait read it without, so the
  // stand-in fails every read of the census and none other. It is `warmed`, because the census's
  // first read is its first exec, which must reach its body within `readTimeout`.
  const ps = warmed(fixture(directory, 'ps', 'case "$*" in "-ww -g "*) : > "$here/failed"; exit 1 ;; esac\nexec /bin/ps "$@"'));
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));

  const { events } = await recorded(directory, { command, ps, readTimeout: 1_000 });

  assert.equal(existsSync(join(directory, 'failed')), true, 'no read of the census failed, so the test proves nothing');
  assert.equal(alive(Number(read(directory, 'survivor.pid'))), false);
  assert.deepEqual(events.map(({ event }) => event), ['group.killed']);
  assert.match(events[0].census, /named no process/);
});

test('a census whose every read of the group lists only one of two survivors still has both recorded, by name or by the group\'s kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The census reads the group with `-ww`, and the kill and the wait read it without, so the
  // stand-in cuts every read of the census down to the first survivor's row, and none other. It
  // is `warmed`, because the census's first read is its first exec, which must reach its body
  // within `readTimeout`.
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in "-ww -g "*)',
    '  : > "$here/cut"',
    '  /bin/ps "$@" | /usr/bin/grep "^ *$(/bin/cat "$here/one.pid") "',
    '  exit 0 ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n')));
  const command = fixture(directory, 'command', [leave(TAIL, 'one'), leave(TAIL, 'two')].join('\n'));

  const { events } = await recorded(directory, { command, ps, readTimeout: 1_000 });

  const survivors = ['one', 'two'].map((name) => Number(read(directory, `${name}.pid`)));
  assert.equal(existsSync(join(directory, 'cut')), true, 'no read of the census was cut, so the test proves nothing');
  assert.deepEqual(survivors.map(alive), [false, false]);
  if (!events.some(({ event }) => event === 'group.killed')) {
    assert.deepEqual(events.map(({ pid }) => pid).sort((a, b) => a - b), survivors.sort((a, b) => a - b), `not every survivor was recorded: ${JSON.stringify(events)}`);
  }
});

test('a census whose every read of the group lists only its zombie, while a survivor lives, still has the survivor recorded, by name or by the group\'s kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The census reads the group with `-ww`, and the kill and the wait read it without, so the
  // stand-in cuts every read of the census down to the zombie's row, and none other. It is
  // `warmed`, because the census's first read is its first exec, which must reach its body within
  // `readTimeout`.
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in "-ww -g "*)',
    '  : > "$here/cut"',
    '  /bin/ps "$@" | /usr/bin/grep "^ *$(/bin/cat "$here/zombie.pid") "',
    '  exit 0 ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n')));
  const command = unreaped(directory);

  const { events } = await recorded(directory, { command, ps, readTimeout: 1_000 });

  const survivor = Number(read(directory, 'tail.pid'));
  assert.equal(existsSync(join(directory, 'cut')), true, 'no read of the census was cut, so the test proves nothing');
  assert.equal(alive(survivor), false);
  if (!events.some(({ event }) => event === 'group.killed')) {
    assert.deepEqual(events.map(({ pid }) => pid), [survivor], `the survivor was not recorded: ${JSON.stringify(events)}`);
  }
});

/**
 * What a reached check that found no read of the kill to check says: `nothing` where the stand-in
 * marked, in `kill.read` in `directory`, that the kill read the group, and otherwise why the
 * stream says the group went unnamed. The census reaches the kill whenever it returns, and the kill
 * always reads the group at least once, so a kill that made no read is one whose census gave up. A
 * census whose read fails, as one does where the host refuses its fork at the user's process limit,
 * gives up and has the group killed unnamed, as designed (O48, O50).
 */
function unread(directory, events, nothing) {
  if (existsSync(join(directory, 'kill.read'))) return nothing;
  const why = [...new Set(events.filter(({ event }) => event === 'group.killed').map(({ census }) => census))];
  return `the kill made no read, because the census gave up, as designed (O48, O50), and the stream records why the group went unnamed: ${why.length > 0 ? why.join('; ') : `nothing, among ${JSON.stringify(events)}`}`;
}

test('a census, and the kill\'s every read after the read just before it, that leave out one of two survivors still have both recorded, by name or by the group\'s kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The census reads the group with `-ww`, and the reads around the kill read the group's states
  // alone. The stand-in answers the first of those, the read just before the kill, as `ps` does,
  // and marks it made in `kill.read`, so a kill that made no read, because its census gave up, is
  // told apart from one that did. It drops the second survivor's row from every other read of the
  // group, and marks which were cut, the census's in `census.cut` and the kill's in `kill.cut`. It
  // answers every other read as `ps` does. It is `warmed`, because the census's first read is its
  // first exec, which must reach its body within `readTimeout`.
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in "-g "*" -o pid=,stat=") /bin/mkdir "$here/kill.read" 2>/dev/null && exec /bin/ps "$@" ;; esac',
    'case "$*" in "-ww -g "*|"-g "*" -o pid=,stat=")',
    '  case "$*" in "-ww -g "*) : > "$here/census.cut" ;; *) : > "$here/kill.cut" ;; esac',
    '  /bin/ps "$@" | /usr/bin/grep -v "^ *$(/bin/cat "$here/two.pid") "',
    '  exit 0 ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n')));
  const command = fixture(directory, 'command', [leave(TAIL, 'one'), leave(TAIL, 'two')].join('\n'));

  const { events } = await recorded(directory, { command, ps, readTimeout: 1_000 });

  const survivors = ['one', 'two'].map((name) => Number(read(directory, `${name}.pid`)));
  assert.equal(existsSync(join(directory, 'census.cut')), true, 'no read of the census was cut, so the test proves nothing');
  assert.equal(existsSync(join(directory, 'kill.read')), true, unread(directory, events, 'the kill was never read before, so the test proves nothing'));
  assert.deepEqual(survivors.map(alive), [false, false]);
  if (!events.some(({ event }) => event === 'group.killed')) {
    assert.deepEqual(events.map(({ pid }) => pid).sort((a, b) => a - b), survivors.sort((a, b) => a - b), `not every survivor was recorded: ${JSON.stringify(events)}`);
  }
});

test('a kill whose every read of the group lists only its zombie, while its leader lives, still has the leader recorded, by name or by the group\'s kill, and leaves no process of the group alive', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The census reads the group with `-ww`, and is answered as `ps` answers it: a census whose reads
  // leave out a leader that answers signal 0 reads again until it gives up, and the kill is then
  // never reached. Every other read of the group, the kill's and the reads after it, is cut down
  // to the zombie's row and exits 0. A read of one pid is answered as `ps` answers it. A read of
  // the group's states alone, around the kill, marks that it listed the zombie only while the
  // leader, whose pid is the group's, answers signal 0, so no read made after the leader is gone
  // stands in for it. Each such read also marks that it was made, in `kill.read`, so a kill that
  // made no read, because its census gave up, is told apart from one whose reads did not list the
  // zombie while the leader lived. It is `warmed`, because the census's first read is its first exec,
  // which must reach its body within `readTimeout`.
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in "-g "*" -o pid=,stat=") : > "$here/kill.read" ;; esac',
    'case "$*" in "-ww -g "*) exec /bin/ps "$@" ;; esac',
    'case "$*" in *"-g "*)',
    '  rows=$(/bin/ps "$@" | /usr/bin/grep "^ *$(/bin/cat "$here/zombie.pid") ")',
    '  [ -z "$rows" ] && exit 0',
    '  case "$*" in "-g "*" -o pid=,stat=") /bin/kill -0 "$(/bin/cat "$here/group")" 2>/dev/null && : > "$here/kill.cut" ;; esac',
    '  echo "$rows"',
    '  exit 0 ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n')));
  // The group holds its leader, which becomes a `tail` once the zombie is there, and the zombie,
  // so the leader is alive when the timeout kills the group. It is `warmed`, because it must be
  // ready within `OUTLIVED` of its spawn.
  const command = warmed(unreaped(directory, ': > "$here/ready"\nexec /usr/bin/tail -f "$here/hold"', ''));

  const { events } = await recorded(directory, { command, ps, timeout: OUTLIVED, readTimeout: 1_000 });

  ready(directory);
  const group = Number(read(directory, 'group'));
  assert.equal(existsSync(join(directory, 'kill.cut')), true, unread(directory, events, 'no read of the group by the kill listed the zombie while the leader answered signal 0, so the test proves nothing'));
  assert.equal(alive(group), false);
  assert.deepEqual(statesIn(group).filter((state) => state !== 'Z'), [], 'a live process of the group is left');
  const leader = events.some(({ event }) => event === 'group.killed') || events.some(({ event, pid }) => event === 'timeout.killed' && pid === group);
  assert.equal(leader, true, `the leader's kill was not recorded: ${JSON.stringify(events)}`);
});

test('a census whose every read of the group lists only its zombie, while its leader lives, still has the leader recorded by the group\'s kill, and leaves no process of the group alive', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // Every read of the group, by the census, the kill and the reads after it, is cut down to the
  // zombie's row and exits 0, so no read lists the leader. A read of one pid is answered as `ps`
  // answers it. A read of the census, with `-ww`, marks that it listed the zombie only while the
  // leader, whose pid is the group's, answers signal 0, so no read made after the leader is gone
  // stands in for it. It is `warmed`, because the census's first read is its first exec, which
  // must reach its body within `readTimeout`.
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in *"-g "*)',
    '  rows=$(/bin/ps "$@" | /usr/bin/grep "^ *$(/bin/cat "$here/zombie.pid") ")',
    '  [ -z "$rows" ] && exit 0',
    '  case "$*" in "-ww -g "*) /bin/kill -0 "$(/bin/cat "$here/group")" 2>/dev/null && : > "$here/census.cut" ;; esac',
    '  echo "$rows"',
    '  exit 0 ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n')));
  // The group holds its leader, which becomes a `tail` once the zombie is there, and the zombie,
  // so the leader is alive when the timeout kills the group. It is `warmed`, because it must be
  // ready within `OUTLIVED` of its spawn.
  const command = warmed(unreaped(directory, ': > "$here/ready"\nexec /usr/bin/tail -f "$here/hold"', ''));

  const { events } = await recorded(directory, { command, ps, timeout: OUTLIVED, readTimeout: 1_000 });

  ready(directory);
  const group = Number(read(directory, 'group'));
  assert.equal(existsSync(join(directory, 'census.cut')), true, 'no read of the group by the census listed the zombie while the leader answered signal 0, so the test proves nothing');
  assert.equal(alive(group), false);
  assert.deepEqual(statesIn(group).filter((state) => state !== 'Z'), [], 'a live process of the group is left');
  assert.equal(events.some(({ event }) => event === 'group.killed'), true, `the leader's kill was not recorded: ${JSON.stringify(events)}`);
});

test('a group whose leader is dead and which holds only a zombie its parent outside the group never reaps is recorded with no kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = unreaped(directory, '', '');

  const { events } = await recorded(directory, { command, readTimeout: 1_000 });

  const zombie = Number(read(directory, 'zombie.pid'));
  assert.equal(spawnSync('/bin/ps', ['-o', 'stat=', '-p', String(zombie)], { encoding: 'utf8' }).stdout[0], 'Z', 'the zombie was reaped, so the test proves nothing');
  assert.deepEqual(statesIn(Number(read(directory, 'group'))), ['Z'], 'a process of the command\'s group other than the zombie is left');
  assert.deepEqual(events, []);
});

/**
 * Runs a group holding a survivor and a zombie its parent outside the group never reaps, so signal
 * 0 still reaches the group once the survivor is killed, through a `ps` stand-in that answers every
 * read as `ps` does except the reads of the group's states alone (`-g <group> -o pid=,stat=`), taken
 * once the kill has named the survivor, which run the shell lines `failing` instead. Hands back
 * the survivor's pid and the events. The stand-in is `warmed`, because the census's first read is
 * its first exec, which must reach its body within `readTimeout`.
 */
async function lastReadFailing(t, failing) {
  const directory = holding(t);
  const ps = warmed(fixture(directory, 'ps', [
    'case "$*" in "-g "*" -o pid=,stat=")',
    '  : > "$here/failed"',
    failing,
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n')));
  const command = unreaped(directory);

  const { events } = await recorded(directory, { command, ps, readTimeout: 1_000 });

  assert.equal(existsSync(join(directory, 'failed')), true, 'no read of the group\'s states failed, so the test proves nothing');
  return { survivor: Number(read(directory, 'tail.pid')), events };
}

test('where the read of the group before its kill fails while signal 0 reaches the group, the kill of the group is recorded beside the names, not saying it saw a live process', SETTLES_WITHIN, async (t) => {
  const { survivor, events } = await lastReadFailing(t, '  echo "ps: failing on purpose" >&2\n  exit 2');

  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [{ event: 'survivor.killed', pid: survivor }, { event: 'group.killed', pid: undefined }]);
  assert.match(events[1].census, /ps: failing on purpose/);
  assert.doesNotMatch(events[1].census, /held a live process/);
});

test('where the reads of the group before its kill list nothing while signal 0 reaches the group, the kill of the group is recorded beside the names, not saying it saw a live process', SETTLES_WITHIN, async (t) => {
  const { survivor, events } = await lastReadFailing(t, '  exit 1');

  assert.deepEqual(events.map(({ event, pid }) => ({ event, pid })), [{ event: 'survivor.killed', pid: survivor }, { event: 'group.killed', pid: undefined }]);
  assert.match(events[1].census, /listed no process/);
  assert.doesNotMatch(events[1].census, /held a live process/);
});

test('a kill whose read just before it exits 1 with a failure on standard error, and nothing else, records the group\'s kill naming that failure', SETTLES_WITHIN, async (t) => {
  const events = await recordsEveryProcess(t, '    echo "ps: failing on purpose" >&2\n    exit 1');

  // The census's processes are read by pid in that read's place, so each is still named beside it.
  const killed = events.filter(({ event }) => event === 'group.killed');
  assert.deepEqual(killed.length, 1, JSON.stringify(events));
  assert.match(killed[0].census, /ps: failing on purpose/);
});

test('a call with no timeout starts no process, and fails naming the missing timeout', async (t) => {
  for (const [what, timeout] of [['undefined', undefined], ['null', null]]) {
    const directory = scratch(t);
    const command = fixture(directory, 'command', ': > "$here/started"');

    await assert.rejects(adapt(directory, { command, timeout }), /timeout/, what);

    assert.equal(existsSync(join(directory, 'started')), false, `the command ran, given ${what}`);
  }
});

/**
 * Whether Node's own timer cuts `delay` short. Node warns with a `TimeoutOverflowWarning` when a
 * delay does not fit its timer and sets it to 1 ms, so a Node process of its own is asked.
 */
function overflows(delay) {
  const asked = spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${delay}).unref()`], { encoding: 'utf8' });
  assert.equal(asked.status, 0, asked.stderr);
  return asked.stderr.includes('TimeoutOverflowWarning');
}

test('the largest timeout the adapter keeps is the largest delay Node\'s timer keeps', () => {
  assert.equal(overflows(TIMER_MAX), false, `Node's timer cuts ${TIMER_MAX} ms short`);
  assert.equal(overflows(TIMER_MAX + 1), true, `Node's timer keeps ${TIMER_MAX + 1} ms`);
});

test('a command given the largest timeout Node keeps runs to its own exit, with no timeout reported', async (t) => {
  const directory = scratch(t);

  const result = await shell(directory, 'exit 0', { timeout: TIMER_MAX });

  assert.equal(result.timedOut, false);
  assert.equal(result.exit, 0);
});

test('a command that exits at once under a timeout past the largest delay one Node timer keeps returns its own exit code, with no timeout reported', async (t) => {
  const directory = scratch(t);

  const result = await shell(directory, 'exit 3', { timeout: 2 ** 31 });

  assert.equal(result.timedOut, false);
  assert.equal(result.exit, 3);
});

/**
 * A scheduler standing in for Node's timers, which runs nothing until the test says so: it keeps
 * each timer armed, with its delay, and cancels one by forgetting it.
 */
function heldTimers() {
  const armed = new Set();
  return {
    armed,
    schedule: (run, delay) => { const timer = { run, delay }; armed.add(timer); return timer; },
    cancel: (timer) => armed.delete(timer),
    /** Fires the one armed timer and hands back its delay. */
    fire() {
      assert.equal(armed.size, 1, `${armed.size} timers are armed`);
      const [timer] = armed;
      armed.delete(timer);
      timer.run();
      return timer.delay;
    },
  };
}

test('a delay past the largest one Node timer keeps elapses over timers each within it, adding up to the delay exactly', () => {
  const timers = heldTimers();
  const total = 2 * TIMER_MAX + 5;
  let done = false;

  whenElapsed(total, () => { done = true; }, timers);

  // One fire past the three the delay takes, at most, so a delay that never elapses fails here
  // rather than holding the test file's process in this loop.
  const delays = [];
  while (!done && delays.length <= 3) delays.push(timers.fire());
  assert.deepEqual(delays, [TIMER_MAX, TIMER_MAX, 5]);
  assert.equal(timers.armed.size, 0);
});

test('a delay cancelled partway through its timers never elapses', () => {
  const timers = heldTimers();
  let done = false;

  const cancel = whenElapsed(TIMER_MAX + 1, () => { done = true; }, timers);
  timers.fire();
  cancel();

  assert.equal(timers.armed.size, 0, 'a timer is still armed');
  assert.equal(done, false);
});

/**
 * Runs `body`, a module, in a Node process of its own, and hands back its exit status and what it
 * wrote to standard error, or fails the test where that process has not exited within `within`
 * milliseconds. The test's teardown kills the process, whether the test passes or fails.
 */
async function exitOf(t, body, within) {
  const caller = spawn(process.execPath, ['--input-type=module', '-e', body], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => caller.kill('SIGKILL'));
  let stderr = '';
  caller.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = once(caller, 'exit').then(([status]) => ({ status, stderr }));
  let stop;
  const late = new Promise((resolve) => { stop = setTimeout(resolve, within, 'late'); });
  const outcome = await Promise.race([exited, late]);
  clearTimeout(stop);
  assert.notEqual(outcome, 'late', `the process had not exited within ${within} ms`);
  return outcome;
}

/**
 * How long a Node process of its own has to exit once it has nothing left to do. A judgment: it
 * covers Node's own start and a call that settles at once, on a loaded host, and is far under any
 * timer of the adapter's the tests below leave armed.
 */
const EXITS_WITHIN = 10_000;

const PROCESS_MODULE = JSON.stringify(new URL('../src/substrate/process.mjs', import.meta.url).href);

test('a delay the adapter keeps, left armed, does not hold its process open', SETTLES_WITHIN, async (t) => {
  const { status, stderr } = await exitOf(t, [
    `import { TIMER_MAX, whenElapsed } from ${PROCESS_MODULE};`,
    'whenElapsed(2 * TIMER_MAX, () => process.exit(7));',
  ].join('\n'), EXITS_WITHIN);

  assert.equal(status, 0, stderr);
});

test('a caller whose call has settled exits at once, though the call\'s timeout and read deadline are longer than the test', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The command leaves a survivor, so the call reads the process table under its read deadline.
  const command = fixture(directory, 'command', leave(TAIL, 'survivor'));

  // The caller does nothing once the call has settled, so the one thing that could keep it from
  // exiting is what the adapter holds.
  const { status, stderr } = await exitOf(t, [
    `import { openSink } from ${JSON.stringify(new URL('../src/observation/sink.mjs', import.meta.url).href)};`,
    `import { TIMER_MAX, runCommand } from ${PROCESS_MODULE};`,
    `const sink = openSink({ directory: ${JSON.stringify(join(directory, 'state'))}, run: 'r-test', now: () => 0 });`,
    `await runCommand({ command: ${JSON.stringify(command)}, args: [], cwd: ${JSON.stringify(directory)}, env: {}, timeout: 2 * TIMER_MAX, readTimeout: TIMER_MAX, emitter: sink.emitter({ layer: 'L0' }) });`,
  ].join('\n'), EXITS_WITHIN);

  assert.equal(status, 0, stderr);
  assert.deepEqual(eventsIn(join(directory, 'state')).map(({ event }) => event), ['survivor.killed'], 'the call read no survivor, so it proves nothing of its read deadline');
});

test('a timeout that is not a positive finite number of milliseconds starts no process, and the failure names it', async (t) => {
  for (const timeout of [0, -1, NaN, Infinity, '300']) {
    const directory = scratch(t);
    const command = fixture(directory, 'command', ': > "$here/started"');

    await assert.rejects(adapt(directory, { command, timeout }), (error) => {
      assert.ok(error.message.includes(`timeout ${timeout} `), `the failure does not name the timeout ${timeout}: ${error.message}`);
      return true;
    });

    assert.equal(existsSync(join(directory, 'started')), false, `the command ran, given the timeout ${timeout}`);
  }
});

/**
 * An object with `toString` and a hook for `util.inspect`, each doing `does`. The hook is not
 * enumerable, so an `inspect` that ignores it prints only `toString`: Node 20 and Node 26 print an
 * enumerable symbol key differently, and a hidden one alike.
 */
function hooked(does) {
  return Object.defineProperty({ toString() { return does(); } }, Symbol.for('nodejs.util.inspect.custom'), { value: does });
}

/** An object whose `toString` and whose hook for `util.inspect` each throw. */
const throwing = hooked(() => { throw new Error('no conversion'); });

/** An object whose `toString` and whose hook for `util.inspect` each print nothing. */
const blank = hooked(() => '');

test('the refusal of an invalid timeout names the value and its type', async (t) => {
  for (const [timeout, named] of [
    ['5', 'the timeout 5 (of type string)'],
    [null, 'the timeout null (of type null)'],
    [NaN, 'the timeout NaN (of type number)'],
    // A template literal throws on each of these three, so the refusal must print them another way.
    [Symbol('t'), 'the timeout Symbol(t) (of type symbol)'],
    [Object.create(null), 'the timeout [Object: null prototype] {} (of type object)'],
    [{ toString() { throw new Error('no toString'); } }, 'the timeout { toString: [Function: toString] } (of type object)'],
    // Each of these prints as nothing, so the refusal must print them so they show.
    [[], 'the timeout [] (of type object)'],
    ['', 'the timeout \'\' (of type string)'],
    // Each of these prints nothing, or throws, however it is asked to print itself, so the refusal
    // must print what the object holds.
    [throwing, 'the timeout { toString: [Function: toString] } (of type object)'],
    [blank, 'the timeout { toString: [Function: toString] } (of type object)'],
  ]) {
    const directory = scratch(t);
    const command = fixture(directory, 'command', ': > "$here/started"');

    await assert.rejects(adapt(directory, { command, timeout }), (error) => {
      assert.ok(error.message.includes(named), `the failure does not say "${named}": ${error.message}`);
      return true;
    });

    assert.equal(existsSync(join(directory, 'started')), false, `the command ran, given ${named}`);
  }
});

// proves R-STATE-16
test('a command ended by a signal it does not handle has a non-zero integer exit code in the result', async (t) => {
  const directory = scratch(t);
  // The shell sends itself `SIGTERM`, which a non-interactive shell with no trap does not handle.
  const result = await shell(directory, 'kill -TERM $$');

  assert.ok(Number.isInteger(result.exit) && result.exit !== 0, `the exit code is ${result.exit}`);
});


// proves R-STATE-17, R-STATE-8
test('given a command and its child outliving its timeout, no process of the group is alive when the call settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  await adapt(directory, outliving(directory, leave(TAIL, 'child')));

  ready(directory);
  assert.equal(alive(Number(read(directory, 'command.pid'))), false, 'the command is alive');
  assert.equal(alive(Number(read(directory, 'child.pid'))), false, 'the child is alive');
  assert.equal(alive(-Number(read(directory, 'command.pid'))), false, 'a process of the command\'s group is alive');
});

test('given a command outliving its timeout, the result says the timeout ended it', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const result = await adapt(directory, outliving(directory, leave(TAIL, 'child')));

  ready(directory);
  assert.equal(result.timedOut, true);
});

test('given a command that finishes inside its timeout, the result reports no timeout and carries the command\'s own exit code', async (t) => {
  const directory = scratch(t);

  const result = await shell(directory, 'exit 3', { timeout: OUTLIVED });

  assert.equal(result.timedOut, false);
  assert.equal(result.exit, 3);
});

/** The last lines of a command `asItsTimeoutFires` holds for: they write its pid, then exit `code`. */
const pidThenExit = (code) => `echo $$ > "$here/command.tmp" && /bin/mv "$here/command.tmp" "$here/command.pid"\nexit ${code}`;

/**
 * What `call` settles on, where its command ends with `pidThenExit` and its timeout is 1 ms, once
 * this thread has been held until that command is a zombie. The timer is armed before the call
 * first yields. Holding this thread until the command is a zombie, which Node has not reaped
 * because its loop cannot run, leaves the timer and the exit both due when the loop resumes, and
 * Node runs due timers before it reaps.
 */
async function asItsTimeoutFires(directory, call) {
  const zombie = () => existsSync(join(directory, 'command.pid'))
    && spawnSync('/bin/ps', ['-o', 'stat=', '-p', read(directory, 'command.pid')], { encoding: 'utf8' }).stdout.startsWith('Z');
  // The wait holds the thread, so no test timeout can end it: it carries its own deadline, and a
  // command that never runs fails the test rather than holding the suite. The deadline is a
  // judgment: the command has nothing to wait for but a survivor's start, where it leaves one.
  const deadline = Date.now() + 5_000;
  while (!zombie() && Date.now() < deadline);
  if (!zombie()) {
    const outcome = await call.then((result) => JSON.stringify(result), (error) => error.message);
    assert.fail(`the command was not a zombie within 5,000 ms, so the race was not set up; the call settled with: ${outcome}`);
  }
  return call;
}

test('given a command that exits 0 on its own after its timeout is due but before L0 has seen either, the result reports no timeout and exit code 0', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const command = fixture(directory, 'command', pidThenExit(0));

  const result = await asItsTimeoutFires(directory, adapt(directory, { command, timeout: 1 }));

  assert.equal(result.timedOut, false);
  assert.equal(result.exit, 0);
});

test('given a command that exits 3 on its own as its timeout fires, the process killed after that exit is recorded as a survivor kill, and the result carries exit 3 with no timeout', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const command = fixture(directory, 'command', `${leave(TAIL, 'survivor')}\n${pidThenExit(3)}`);
  const { state, emitter } = l0(directory);

  const result = await asItsTimeoutFires(directory, adapt(directory, { command, emitter, timeout: 1 }));

  assert.deepEqual(eventsIn(state).map(({ event, pid }) => ({ event, pid })), [{ event: 'survivor.killed', pid: Number(read(directory, 'survivor.pid')) }]);
  assert.equal(result.timedOut, false);
  assert.equal(result.exit, 3);
});

// proves R-STATE-14
test('given a command that writes a payload and then outlives its timeout, the result holds every byte of it', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const payload = bytes(300_001, 23);
  writeFileSync(join(directory, 'payload'), payload);

  const result = await adapt(directory, outliving(directory, `/bin/cat "$here/payload"\n${leave(TAIL, 'child')}`));

  ready(directory);
  assert.ok(result.stdout.equals(payload), 'standard output holds every byte of the command\'s payload');
});

test('given a child that writes to standard output and standard error and outlives the timeout with its command, the result holds every byte of each in its own stream', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  const out = bytes(200_003, 29);
  const err = bytes(150_007, 31);
  writeFileSync(join(directory, 'out'), out);
  writeFileSync(join(directory, 'err'), err);
  // The command blocks opening a FIFO until the child has written both and opens it, so it waits
  // without taking the CPU the child's writes need. The child runs under `/bin/sh` by name,
  // because exec'ing a script just written took from 50 ms to over a second (see `OUTLIVED`).
  fixture(directory, 'child', `/bin/cat "$here/out"\n/bin/cat "$here/err" >&2\n: > "$here/written"\nexec ${TAIL}`);
  const body = ['/usr/bin/mkfifo "$here/written"', '/bin/sh "$here/child" &', 'read -r _ < "$here/written"'].join('\n');

  const result = await adapt(directory, outliving(directory, body));

  ready(directory);
  assert.ok(result.stdout.equals(out), 'standard output holds every byte of the child\'s payload to it');
  assert.ok(result.stderr.equals(err), 'standard error holds every byte of the child\'s payload to it');
});

// proves R-STATE-16
test('given a command that outlives its timeout and exits 0 on SIGTERM, the result has a non-zero integer exit code', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // `wait` returns at once on a signal the shell traps, so SIGTERM would end the command with 0.
  const result = await adapt(directory, outliving(directory, `trap 'exit 0' TERM\n${leave(TAIL, 'child')}`));

  ready(directory);
  assert.ok(Number.isInteger(result.exit) && result.exit !== 0, `the exit code is ${result.exit}`);
});

/**
 * The `L0` kill events a timeout makes of an `outliving` command in `directory` that left a `TAIL`
 * as `child`, by pid. Each name and command line is read off the fixture, not asked of `ps`.
 */
const timeoutKills = (directory) => [
  { layer: 'L0', event: 'timeout.killed', pid: Number(read(directory, 'command.pid')), name: 'bash', cmd: `/bin/bash ${directory}/command` },
  { layer: 'L0', event: 'timeout.killed', pid: Number(read(directory, 'child.pid')), name: 'tail', cmd: `/usr/bin/tail -f ${directory}/hold` },
].sort((a, b) => a.pid - b.pid);

// proves R-STATE-8, R-STATE-12
test('given a command and its child outliving its timeout, the stream holds an L0 kill event for each, by process name and command line', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const { events } = await recorded(directory, outliving(directory, leave(TAIL, 'child')));

  ready(directory);
  const kills = events.map(({ layer, event, pid, name, cmd }) => ({ layer, event, pid, name, cmd })).sort((a, b) => a.pid - b.pid);
  assert.deepEqual(kills, timeoutKills(directory));
});

test('given a sink that refuses every append, a command and its child outliving its timeout are dead when the call settles', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  await assert.rejects(adapt(directory, { ...outliving(directory, leave(TAIL, 'child')), emitter: refusing(directory) }));

  ready(directory);
  assert.equal(alive(Number(read(directory, 'command.pid'))), false, 'the command is alive');
  assert.equal(alive(Number(read(directory, 'child.pid'))), false, 'the child is alive');
});

test('given a sink that refuses every append, a command outliving its timeout rejects naming each unrecorded kill, with its exit code, saying the timeout ended it', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const error = await rejection(directory, { ...outliving(directory, leave(TAIL, 'child')), emitter: refusing(directory) });

  ready(directory);
  const unrecorded = (error.unrecorded ?? []).map(({ event, pid, name, cmd }) => ({ layer: 'L0', event, pid, name, cmd })).sort((a, b) => a.pid - b.pid);
  assert.deepEqual(unrecorded, timeoutKills(directory));
  for (const { cmd } of timeoutKills(directory)) assert.ok(error.message.includes(cmd), `the failure's message does not give ${cmd}: ${error.message}`);
  assert.ok(Number.isInteger(error.result?.exit) && error.result.exit !== 0, `the exit code is ${error.result?.exit}`);
  assert.equal(error.result?.timedOut, true);
  // Not merely `timeout`, which each event's name already holds.
  assert.ok(error.message.includes(`the timeout of ${OUTLIVED} ms ended`), `the failure's message does not say the timeout ended the command: ${error.message}`);
});

/** Fails the test unless `error` is a failure to start that names `what`. */
function unstarted(error, what) {
  assert.equal(error.code, NOT_STARTED, `the failure's code is ${error.code}: ${error.message}`);
  assert.ok(error.message.includes(what), `the failure's message does not name ${what}: ${error.message}`);
}

test('a command that does not exist rejects as a failure to start, naming the command', async (t) => {
  const directory = scratch(t);
  const command = join(directory, 'absent');

  unstarted(await rejection(directory, { command }), command);
});

/** A command whose first action writes `$here/started`. */
const starting = (directory) => fixture(directory, 'command', ': > "$here/started"');

/** Fails the test where the command's first action ran. */
const neverRan = (directory) => assert.equal(existsSync(join(directory, 'started')), false, 'the command\'s first action ran');

test('a working directory that does not exist rejects as a failure to start, naming the directory, and the command never runs', async (t) => {
  const directory = scratch(t);
  const cwd = join(directory, 'absent');

  unstarted(await rejection(directory, { command: starting(directory), cwd }), cwd);
  neverRan(directory);
});

test('a working directory that is a file rejects as a failure to start, naming it, and the command never runs', async (t) => {
  const directory = scratch(t);
  const cwd = join(directory, 'a-file');
  writeFileSync(cwd, '');

  unstarted(await rejection(directory, { command: starting(directory), cwd }), cwd);
  neverRan(directory);
});

test('a working directory that is an executable file rejects as a failure to start, naming it', async (t) => {
  const directory = scratch(t);
  // Executable, so asking only whether it can be entered would let it through.
  const cwd = join(directory, 'an-executable');
  writeFileSync(cwd, '', { mode: 0o755 });

  unstarted(await rejection(directory, { command: starting(directory), cwd }), cwd);
  neverRan(directory);
});

test('a command that is not executable rejects as a failure to start, naming it, and never runs', async (t) => {
  const directory = scratch(t);
  const command = starting(directory);
  chmodSync(command, 0o644);

  unstarted(await rejection(directory, { command }), command);
  neverRan(directory);
});

test('an executable no system loader can run rejects as a failure to start, naming it', async (t) => {
  const directory = scratch(t);
  // Node throws this failure from the spawn itself, where the others arrive after it returns.
  const command = join(directory, 'garbage');
  writeFileSync(command, 'not a program', { mode: 0o755 });

  unstarted(await rejection(directory, { command }), command);
});

test('a command that never started and a refused event reject with codes that tell them apart', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const never = await rejection(directory, { command: join(directory, 'absent') });
  const refusal = await rejection(directory, { command: leavingTwo(directory), emitter: refusing(directory) });

  assert.equal(never.code, NOT_STARTED);
  assert.equal(refusal.code, EVENT_REFUSED);
});

// proves R-STATE-7, R-STATE-12
test('a chain 250 deep is killed whole, its group empty when the call settles, and each of its processes recorded by name or by the group\'s kill', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The signal call notes when each kill of the group is sent, one a round of the kill loop.
  const rounds = [];
  let group;
  const kill = (target, name) => {
    if (target < 0 && name === 'SIGKILL') rounds.push(performance.now());
    return process.kill(target, name);
  };

  const { events } = await recorded(directory, { command: chain(directory, 250), kill, onGroup: (id) => { group = id; } });

  t.diagnostic(`the kill loop took ${rounds.length} rounds over ${(rounds.at(-1) - rounds[0]).toFixed(1)} ms`);
  const chained = read(directory, 'chain.pids').split('\n').map(Number);
  assert.equal(chained.length, 251);
  assert.equal(alive(-group), false, 'a process of the chain\'s group is alive');
  assert.deepEqual(chained.filter(alive), [], 'a process of the chain is alive');
  const named = new Set(events.filter(({ event }) => event === 'survivor.killed').map(({ pid }) => pid));
  if (!events.some(({ event }) => event === 'group.killed')) assert.deepEqual(chained.filter((pid) => !named.has(pid)), [], 'a process of the chain was recorded neither by name nor by the group\'s kill');
});

test('given bytes for standard input, the command reads them and then end of file, so a copy of its input ends', async (t) => {
  // An agent CLI reads its prompt from standard input and starts only once that input ends (ruling
  // 1 Q1 on #467). The defect this catches is input written and never closed, where `cat` waits
  // for more and the call runs to its timeout.
  const directory = scratch(t);
  const result = await shell(directory, '/bin/cat; printf end', { input: Buffer.from('the prompt\n') });
  assert.equal(result.timedOut, false);
  assert.equal(result.exit, 0);
  assert.equal(result.stdout.toString('utf8'), 'the prompt\nend');
});

test('given 1,000,000 bytes for standard input, a command copying its input to its output writes back every byte, unchanged', async (t) => {
  // A prompt carrying a pull request's diff runs far past a pipe's buffer. The defect this catches
  // is input cut short at the buffer, or written as text, where a byte that is no UTF-8 changes.
  const directory = scratch(t);
  const input = bytes(1_000_000, 11);
  const result = await shell(directory, 'exec /bin/cat', { input });
  assert.equal(result.exit, 0);
  assert.equal(result.stdout.length, input.length);
  assert.ok(result.stdout.equals(input), 'standard output holds every byte of the input, unchanged');
});

test('given input larger than the pipe\'s buffer, a command that exits without reading it settles with its own exit code and no unhandled error', async (t) => {
  // The write meets a pipe whose reader has gone, which Node reports as an error on standard
  // input. The defect this catches is that error left unhandled, which ends the engine.
  const directory = scratch(t);
  const result = await shell(directory, 'exit 7', { input: bytes(4 * 1024 * 1024, 3) });
  assert.equal(result.timedOut, false);
  assert.equal(result.exit, 7);
});

test('given no standard input, a command reading its standard input reads end of file at once', async (t) => {
  // As at the base: a command given nothing to read finds nothing, rather than waiting on a pipe
  // no one writes to.
  const directory = scratch(t);
  const result = await shell(directory, '/bin/cat; printf end');
  assert.equal(result.timedOut, false);
  assert.equal(result.exit, 0);
  assert.equal(result.stdout.toString('utf8'), 'end');
});
