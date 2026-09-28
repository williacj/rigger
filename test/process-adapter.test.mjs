// ABOUTME: Tests L0's process adapter: a command's exit code, output, working directory and
// environment, the process group it runs in, the survivors it kills and records, output held open
// past the group, a sink that refuses the record, the timeout, and a command that never started.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { EVENT_REFUSED, NOT_STARTED, PS, runCommand } from '../src/substrate/process.mjs';
import { alive, fixture, read, running, scratch } from './process-fixtures.mjs';

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

/** `length` bytes that step through every byte value, so they hold bytes no UTF-8 text allows. */
const bytes = (length, step) => Buffer.from(Array.from({ length }, (_, i) => (i * step) % 256));

/** A Node script, run by this Node, that writes `length` of `bytes(length, step)` to `stream`. */
function writing(directory, stream, length, step) {
  return adapt(directory, {
    command: process.execPath,
    args: ['-e', `process.${stream}.write(Buffer.from(Array.from({ length: ${length} }, (_, i) => (i * ${step}) % 256)))`, directory],
  });
}

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

/**
 * The lines of a fixture that start `program` in the background, holding the command's standard
 * output and standard error, and write its pid to `$here/<name>.pid`. `program` runs until it is
 * killed, and names the scratch directory in its command line.
 *
 * The lines then wait until the background process runs the executable `image`, as `ps` reads
 * it, or has ended. Until then it can still be the shell that forked it, and a census taken then
 * names the shell.
 */
const leave = (program, name, image = 'tail') => [
  `${program} &`,
  `echo $! > "$here/${name}.pid"`,
  `while kill -0 $! 2>/dev/null && ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -qx '${image} *'; do :; done`,
].join('\n');

/** A survivor that runs until killed: `tail` following a file nothing writes to. */
const TAIL = '/usr/bin/tail -f "$here/hold"';

/** A scratch directory holding the file `TAIL` follows. */
function holding(t) {
  const directory = scratch(t);
  writeFileSync(join(directory, 'hold'), '');
  return directory;
}

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

// A bound on the test alone, so that a call which never settles fails here rather than holding
// the suite: nothing waits on it when the call settles.
const SETTLES_WITHIN = { timeout: 20_000 };

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
 * the survivor runs `tail` or is stopped, then reads the command lines and joins the two row by
 * row. Any other read goes to `ps` as it is. `before` is shell run first, on the stand-in's first
 * call alone.
 */
function reExecuting(directory, before = '') {
  fixture(directory, 'first', `: > "$here/running"\nwhile [ ! -f "$here/go" ]; do :; done\nexec ${TAIL}`);
  const ps = fixture(directory, 'ps', [
    `if /bin/mkdir "$here/called" 2>/dev/null; then ${before || ':'}; fi`,
    'case "$5" in *,command=) ;; *) exec /bin/ps "$@" ;; esac',
    '/bin/ps "$1" "$2" "$3" -o "${5%,command=}" > "$here/names"',
    ': > "$here/go"',
    'survivor=$(/bin/cat "$here/survivor.pid")',
    'until /bin/ps -o ucomm= -p "$survivor" | /usr/bin/grep -q "^tail" || /bin/ps -o stat= -p "$survivor" | /usr/bin/grep -q "^T"; do :; done',
    '/bin/ps "$1" "$2" "$3" -o command= > "$here/arguments"',
    '/usr/bin/paste -d " " "$here/names" "$here/arguments"',
  ].join('\n'));
  // `/bin/bash` by name, because macOS's `/bin/sh` runs another executable.
  const command = fixture(directory, 'command', `/bin/bash "$here/first" &\necho $! > "$here/survivor.pid"\nwhile [ ! -f "$here/running" ]; do :; done`);
  return { command, ps };
}

test('a survivor told to re-execute inside a read of the process table is recorded by the name and command line of one image', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);

  const { events } = await recorded(directory, reExecuting(directory));

  assert.deepEqual(events.map(({ event, name, cmd }) => ({ event, name, cmd })), [
    { event: 'survivor.killed', name: 'bash', cmd: `/bin/bash ${directory}/first` },
  ]);
});

test('a survivor not yet stopped when the process table is read is read again once it is', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The first read finds the survivor running, because the stand-in resumes the group before it.
  // A census that went on from that read would reach the command line with the survivor free to
  // re-execute. One that stops the group again first reaches it with the survivor stopped.
  const { command, ps } = reExecuting(directory, 'kill -s CONT -- "-$3"');

  const { events } = await recorded(directory, { command, ps });

  assert.deepEqual(events.map(({ event, name, cmd }) => ({ event, name, cmd })), [
    { event: 'survivor.killed', name: 'bash', cmd: `/bin/bash ${directory}/first` },
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

test('a survivor whose state reads as ? is stopped and read again, not left unnamed', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // `ps` prints the state `?` for a process caught mid-exec (the engineer judge on #354). This
  // stand-in's first answer shows the survivor that way, in place of its stopped state.
  const ps = fixture(directory, 'ps', [
    'if /bin/mkdir "$here/called" 2>/dev/null; then',
    `  /bin/ps "$@" | /usr/bin/sed -E 's/(^ *[0-9]+ .*) T( |$)/\\1 ?\\2/'`,
    'else',
    '  exec /bin/ps "$@"',
    'fi',
  ].join('\n'));
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
  // The stand-in's first read of names finds nothing, as `ps` does when no process matches.
  const ps = fixture(directory, 'ps', [
    'case "$*" in *ucomm=*) /bin/mkdir "$here/names-read" 2>/dev/null && exit 1 ;; esac',
    'exec /bin/ps "$@"',
  ].join('\n'));
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

test('a call with no timeout starts no process, and fails naming the missing timeout', async (t) => {
  for (const [what, timeout] of [['undefined', undefined], ['null', null]]) {
    const directory = scratch(t);
    const command = fixture(directory, 'command', ': > "$here/started"');

    await assert.rejects(adapt(directory, { command, timeout }), /timeout/, what);

    assert.equal(existsSync(join(directory, 'started')), false, `the command ran, given ${what}`);
  }
});

test('a command ended by a signal it does not handle has a non-zero integer exit code in the result', async (t) => {
  const directory = scratch(t);
  // The shell sends itself `SIGTERM`, which a non-interactive shell with no trap does not handle.
  const result = await shell(directory, 'kill -TERM $$');

  assert.ok(Number.isInteger(result.exit) && result.exit !== 0, `the exit code is ${result.exit}`);
});

/**
 * The timeout each test of a command outliving it passes. A judgment: it is the time the fixture
 * has to be ready before the timeout ends it, and `ready` fails the test where it was not. Its
 * premise is a measurement: over 40 calls of this adapter each, with Node 26.5.0 on macOS 27.0 on
 * 2026-09-27 and nothing else running, the fixture writing 300,001 bytes was ready 6.7 to 10.5 ms
 * after the call, and the one whose child writes to both streams 10.8 to 13.8 ms after it. The
 * second fixture took 51 to 1,481 ms while it exec'd its child's freshly written script, so it
 * runs that script under `/bin/sh` by name.
 */
const OUTLIVED = 1_000;

/**
 * A command that runs `body`, which starts at least one child, then writes its pid to
 * `$here/command.pid`, marks `$here/ready`, and waits on its children, which run until killed. It
 * is run by `/bin/bash` by name, so the process the adapter starts is `bash` from its first line.
 */
function outliving(directory, body) {
  const script = fixture(directory, 'command', [body, 'echo $$ > "$here/command.pid"', ': > "$here/ready"', 'wait'].join('\n'));
  return { command: '/bin/bash', args: [script], timeout: OUTLIVED };
}

/** Fails the test where the timeout ended an `outliving` command before it was ready. */
const ready = (directory) => assert.ok(existsSync(join(directory, 'ready')), `the timeout of ${OUTLIVED} ms ended the command before it was ready`);

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

test('given a command that exits 0 on its own after its timeout is due but before L0 has seen either, the result reports no timeout and exit code 0', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const command = fixture(directory, 'command', 'echo $$ > "$here/command.tmp" && /bin/mv "$here/command.tmp" "$here/command.pid"\nexit 0');

  // The timer is armed before the call first yields. Holding this thread until the command is a
  // zombie, which Node has not reaped because its loop cannot run, leaves the timer and the exit
  // both due when the loop resumes, and Node runs due timers before it reaps.
  const call = adapt(directory, { command, timeout: 1 });
  const zombie = () => existsSync(join(directory, 'command.pid'))
    && spawnSync('/bin/ps', ['-o', 'stat=', '-p', read(directory, 'command.pid')], { encoding: 'utf8' }).stdout.startsWith('Z');
  // The wait holds the thread, so no test timeout can end it: it carries its own deadline, and a
  // command that never runs fails the test rather than holding the suite. The deadline is a
  // judgment: the command, which only writes its pid and exits, has nothing to wait for.
  const deadline = Date.now() + 5_000;
  while (!zombie() && Date.now() < deadline);
  if (!zombie()) {
    const outcome = await call.then((result) => JSON.stringify(result), (error) => error.message);
    assert.fail(`the command was not a zombie within 5,000 ms, so the race was not set up; the call settled with: ${outcome}`);
  }
  const result = await call;

  assert.equal(result.timedOut, false);
  assert.equal(result.exit, 0);
});

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
