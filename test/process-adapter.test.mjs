// ABOUTME: Tests L0's process adapter: a command's exit code, output, working directory and
// environment, the process group it runs in, and the survivors it kills and records.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { PS, runCommand } from '../src/substrate/process.mjs';

/**
 * A scratch directory for one test, torn down with every process that names it.
 *
 * Every fixture process in this file carries the directory's path in its command line, so the
 * teardown finds each one by it, whether the test passed or failed, and whatever the adapter did.
 */
function scratch(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'rigger-process-')));
  t.after(() => spawnSync('/usr/bin/pkill', ['-KILL', '-f', literally(directory)]));
  return directory;
}

/** `text` as a pattern `pgrep` and `pkill` match only as written. */
const literally = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pid of every process whose command line holds `text`. */
const running = (text) => spawnSync('/usr/bin/pgrep', ['-f', literally(text)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

/** An `L0` emitter over a sink in `directory`, and the state directory it writes to. */
function l0(directory) {
  const state = join(directory, 'state');
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  return { state, emitter: sink.emitter({ layer: 'L0' }) };
}

/**
 * A shell script named `name` in `directory`, executable, whose body reads that directory as
 * `$here`. Its path, and so the directory, is in the command line of the shell running it.
 */
function fixture(directory, name, body) {
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\nhere=\${0%/*}\n${body}\n`, { mode: 0o755 });
  return path;
}

/**
 * Runs `script` under `/bin/sh` through the adapter, with an `L0` emitter over `directory`. The
 * script reads the directory as `$0`, which also puts it in the command line the teardown finds.
 */
function shell(directory, script, options = {}) {
  return adapt(directory, { command: '/bin/sh', args: ['-c', script, directory], ...options });
}

/** Runs a command through the adapter in `directory`, under an empty env and an `L0` emitter over it. */
function adapt(directory, options) {
  return runCommand({ args: [], cwd: directory, env: {}, emitter: l0(directory).emitter, ...options });
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

/** What a fixture wrote to `name` in `directory`, trimmed. */
const read = (directory, name) => readFileSync(join(directory, name), 'utf8').trim();

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

/** Whether a process `pid` names is alive: signal 0 reaches it. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

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
    `await runCommand({ command: ${JSON.stringify(command)}, args: [], cwd: ${JSON.stringify(directory)}, env: {}, emitter: sink.emitter({ layer: 'L0' }) });`,
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

test('a survivor that re-executes while the census runs is recorded by the name and command line of one image', SETTLES_WITHIN, async (t) => {
  const directory = holding(t);
  // The survivor runs `first` until the process table has been read once, then becomes `second`,
  // which becomes `tail`.
  fixture(directory, 'second', `: > "$here/re-executed"\nexec ${TAIL}`);
  fixture(directory, 'first', `: > "$here/running"\nwhile [ ! -f "$here/read" ]; do :; done\nexec /bin/sh "$here/second"`);
  // The real `ps`, with a hook between reads: the first read returns only once the survivor has
  // re-executed, and any later read starts only after that, so two reads see two images.
  const ps = fixture(directory, 'ps', [
    'if /bin/mkdir "$here/first-read" 2>/dev/null; then',
    '  /bin/ps "$@"',
    '  : > "$here/read"',
    '  while [ ! -f "$here/re-executed" ]; do :; done',
    'else',
    '  while [ ! -f "$here/re-executed" ]; do :; done',
    '  exec /bin/ps "$@"',
    'fi',
  ].join('\n'));
  // `first` runs under `/bin/bash` by name, because macOS's `/bin/sh` runs another executable.
  const command = fixture(directory, 'command', `/bin/bash "$here/first" &\nwhile [ ! -f "$here/running" ]; do :; done`);

  const { events } = await recorded(directory, { command, ps });

  assert.deepEqual(events.map(({ event, name, cmd }) => ({ event, name, cmd })), [
    { event: 'survivor.killed', name: 'bash', cmd: `/bin/bash ${directory}/first` },
  ]);
});
