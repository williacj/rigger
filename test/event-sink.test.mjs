// ABOUTME: Tests L5's event envelope and sink: what a recorded event carries, that the sink
// stamps it, that the stream only ever grows, and that a reader gets every event back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, readFileSync, readSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { productionFiles } from '../scripts/package-budget.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { UNDRAINED_BOUND } from '../src/substrate/standard-error.mjs';
import { scratch, turn, undrained } from './process-fixtures.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sinkModule = pathToFileURL(join(root, 'src', 'observation', 'sink.mjs')).href;

/** A fresh state directory for one test, under the OS temp directory. */
const stateDir = () => mkdtempSync(join(tmpdir(), 'rigger-events-'));

/**
 * A clock the test drives. It hands out the instants given to it, in order, so an assertion
 * about a timestamp is an assertion about the instant the sink read rather than about the
 * machine's own clock.
 */
function clockOver(instants) {
  const remaining = [...instants];
  return () => {
    assert.ok(remaining.length > 0, 'the sink read the clock more often than the test wound it');
    return remaining.shift();
  };
}

// The two instants and their ISO forms are ARCHITECTURE.md's own abbreviated example, read off
// that document and converted once by hand, so the expected text here is not produced by the
// conversion the sink performs.
const AT_14_14 = 1789308885882;
const AT_14_19 = 1789309143005;

test('an event carries when it happened, its run, its layer, and the card and dispatch it arose under', () => {
  const directory = stateDir();
  const sink = openSink({ directory, run: 'r-8f21', now: clockOver([AT_14_14]) });

  sink.emitter({ layer: 'L1', card: 1412, dispatch: 'd-01' })
    .emit('dispatch.end', { role: 'engineer', exit: 0, ms: 734120 });

  assert.deepEqual(readEvents(directory), [{
    ts: '2026-09-13T14:14:45.882Z',
    run: 'r-8f21',
    layer: 'L1',
    event: 'dispatch.end',
    card: 1412,
    dispatch: 'd-01',
    role: 'engineer',
    exit: 0,
    ms: 734120,
  }]);
});

test('the state directory holds one stream, one event to a line, in the order they were emitted', () => {
  const directory = stateDir();
  const sink = openSink({ directory, run: 'r-8f21', now: clockOver([AT_14_14, AT_14_19]) });
  const execution = sink.emitter({ layer: 'L1', card: 1412, dispatch: 'd-01' });
  const substrate = sink.emitter({ layer: 'L0', card: 1412 });

  execution.emit('dispatch.end', { exit: 0 });
  substrate.emit('survivor.killed', { name: 'rust-analyzer-proc-macro-srv' });

  assert.deepEqual(readdirSync(directory), ['events.jsonl']);
  const lines = readFileSync(join(directory, 'events.jsonl'), 'utf8').split('\n');
  assert.deepEqual(lines.slice(-1), [''], 'the stream does not end with a newline');
  assert.deepEqual(lines.slice(0, -1).map((line) => JSON.parse(line)), [
    { ts: '2026-09-13T14:14:45.882Z', run: 'r-8f21', layer: 'L1', event: 'dispatch.end', card: 1412, dispatch: 'd-01', exit: 0 },
    { ts: '2026-09-13T14:19:03.005Z', run: 'r-8f21', layer: 'L0', event: 'survivor.killed', card: 1412, name: 'rust-analyzer-proc-macro-srv' },
  ]);
});

test('the envelope is written in the order ARCHITECTURE.md shows, ahead of the layer own fields', () => {
  const directory = stateDir();
  openSink({ directory, run: 'r-8f21', now: clockOver([AT_14_14]) })
    .emitter({ layer: 'L1', card: 1412, dispatch: 'd-01' })
    .emit('dispatch.end', { role: 'engineer', exit: 0 });

  const [event] = readEvents(directory);
  assert.deepEqual(Object.keys(event), ['ts', 'run', 'layer', 'event', 'card', 'dispatch', 'role', 'exit']);
});

test('the sink stamps the card, so two emitters make the same call and record different cards', () => {
  const directory = stateDir();
  const sink = openSink({ directory, run: 'r-8f21', now: clockOver([AT_14_14, AT_14_19]) });
  // Detached from the emitter that made them, so what each call records can only have come
  // from the sink: the emitting code holds a function and nothing else.
  const { emit: emitFor1412 } = sink.emitter({ layer: 'L0', card: 1412, dispatch: 'd-01' });
  const { emit: emitFor1500 } = sink.emitter({ layer: 'L0', card: 1500, dispatch: 'd-02' });

  emitFor1412('survivor.killed', { name: 'rust-analyzer-proc-macro-srv' });
  emitFor1500('survivor.killed', { name: 'rust-analyzer-proc-macro-srv' });

  assert.deepEqual(
    readEvents(directory).map(({ card, dispatch, run, name }) => ({ card, dispatch, run, name })),
    [
      { card: 1412, dispatch: 'd-01', run: 'r-8f21', name: 'rust-analyzer-proc-macro-srv' },
      { card: 1500, dispatch: 'd-02', run: 'r-8f21', name: 'rust-analyzer-proc-macro-srv' },
    ],
  );
});

test('an emitting layer that supplies an envelope field is refused, and told which one', () => {
  const directory = stateDir();
  const emitter = openSink({ directory, run: 'r-8f21', now: clockOver([AT_14_14]) })
    .emitter({ layer: 'L0', card: 1412 });

  assert.throws(
    () => emitter.emit('survivor.killed', { card: 9999, name: 'rust-analyzer-proc-macro-srv' }),
    /card/,
  );
});

test('an append leaves what is already on disk byte for byte, whoever opened the stream', () => {
  const directory = stateDir();
  const first = openSink({ directory, run: 'r-8f21', now: clockOver([AT_14_14, AT_14_19]) });
  first.emitter({ layer: 'L3', card: 1412 }).emit('pull', { queueDepth: 7 });
  first.emitter({ layer: 'L3', card: 1412 }).emit('pull', { queueDepth: 6 });
  const before = readFileSync(join(directory, 'events.jsonl'));

  // A second run of the engine over a state directory that already holds a stream. Opening it
  // for writing rather than for appending is the defect this watches for, and it would cost
  // every event of the run before.
  const second = openSink({ directory, run: 'r-9a03', now: clockOver([AT_14_19]) });
  second.emitter({ layer: 'L3', card: 1500 }).emit('pull', { queueDepth: 1 });

  const after = readFileSync(join(directory, 'events.jsonl'));
  assert.ok(after.length > before.length, 'the stream did not grow');
  assert.deepEqual(after.subarray(0, before.length), before, 'the bytes already recorded changed');
  assert.deepEqual(readEvents(directory).map((event) => [event.run, event.queueDepth]), [
    ['r-8f21', 7],
    ['r-8f21', 6],
    ['r-9a03', 1],
  ]);
});

test('an event recorded before the writing process is killed is still there afterwards', () => {
  const directory = stateDir();
  // The sink writes synchronously and never flushes a buffer of its own, and this is where
  // that is measured rather than argued: a child records two events and is then killed
  // outright, so nothing it held in memory can reach the stream after the call returned.
  const child = [
    `import { openSink } from ${JSON.stringify(sinkModule)};`,
    `const sink = openSink({ directory: ${JSON.stringify(directory)}, run: 'r-8f21', now: () => ${AT_14_14} });`,
    "const { emit } = sink.emitter({ layer: 'L3', card: 1412 });",
    "emit('pull', { queueDepth: 7 });",
    "emit('pull', { queueDepth: 6 });",
    "process.kill(process.pid, 'SIGKILL');",
  ].join('\n');

  const killed = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' });

  assert.equal(killed.stderr, '', 'the child failed before it was killed');
  assert.notEqual(killed.status, 0, 'the child exited normally, so nothing was killed');
  assert.deepEqual(readEvents(directory).map((event) => event.queueDepth), [7, 6]);
});

test('a reader recovers every event that was emitted, in the order they were emitted', () => {
  const directory = stateDir();
  const emitted = Array.from({ length: 1000 }, (unused, index) => index);
  const sink = openSink({ directory, run: 'r-8f21', now: clockOver(emitted.map(() => AT_14_14)) });
  const { emit } = sink.emitter({ layer: 'L3', card: 1412 });

  for (const queueDepth of emitted) emit('pull', { queueDepth });

  assert.deepEqual(readEvents(directory).map((event) => event.queueDepth), emitted);
});

test('a torn line is refused rather than passed over, and the reader says which line', () => {
  // What a machine that lost power mid-append would leave. The sink does not repair it, and
  // the point of this test is that a reader does not quietly return the events either side of
  // the damage as though the record were whole.
  const directory = stateDir();
  openSink({ directory, run: 'r-8f21', now: clockOver([AT_14_14]) })
    .emitter({ layer: 'L3', card: 1412 })
    .emit('pull', { queueDepth: 7 });
  const whole = readFileSync(join(directory, 'events.jsonl'));
  writeFileSync(join(directory, 'events.jsonl'), whole.subarray(0, whole.length - 8));

  assert.throws(() => readEvents(directory), /events\.jsonl line 1 is not a recorded event/);
});

test('no layer reaches for the sink: a verb under src/cli/ opens it, and every layer takes it as it is handed', () => {
  // A layer that opened the sink itself would name the state directory and the run, which are
  // the process's to know, and it could write another layer's events. So the verb that owns the
  // process opens it and hands it down, and a layer holds only the emitter it was given.
  // `productionFiles` is the package budget's own walk, so what this reads is what CI charges
  // the budget for rather than a second idea of where production code lives.
  const files = productionFiles(root);
  assert.ok(
    files.some((file) => file.endsWith(join('src', 'observation', 'sink.mjs'))),
    'the walk found no sink, so it would find no caller either',
  );
  const callers = files
    .filter((file) => !file.includes(join('src', 'observation')) && !file.includes(join('src', 'cli')))
    .filter((file) => readFileSync(file, 'utf8').includes('observation/sink'));
  assert.deepEqual(callers, []);
});

test('the sink refuses to open, or to emit, without an envelope field it cannot invent', () => {
  // Every one of these leaves the field out of the JSON altogether, so the cost of letting it
  // through is a record whose events cannot be put beside each other, discovered by whoever
  // reads it back later.
  const directory = stateDir();
  const now = clockOver([]);
  // The directory is not among them: a sink opened without one holds its events until the verb
  // names it (delta H5).
  assert.throws(() => openSink({ directory, now }), /run/);
  assert.throws(() => openSink({ directory, run: 'r-8f21' }), /now/);

  const sink = openSink({ directory, run: 'r-8f21', now });
  assert.throws(() => sink.emitter({ card: 1412 }), /layer/);
  assert.throws(() => sink.emitter({ layer: 'L3', card: 1412 }).emit(undefined, { queueDepth: 7 }), /event/);
});

/**
 * Run `body` in a child Node process that has imported `openSink`, and report what it left.
 *
 * Standard error is only observable from outside the process that writes it, and a write at exit
 * is only proved whole once the process has gone. The child's working directory and its temp
 * directory are one fresh directory, so a file the sink wrote where no directory was named lands
 * where the test can see it.
 */
function inChild(body) {
  const home = stateDir();
  const script = [
    `import { openSink } from ${JSON.stringify(sinkModule)};`,
    // Touching process.stderr is what every verb that prints does, and it leaves the descriptor
    // non-blocking, where a single write to a full pipe comes back short.
    "process.stderr.write('');",
    body,
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: home,
    env: { ...process.env, TMPDIR: home },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ...child, home, left: readdirSync(home, { recursive: true }) };
}

/** Each line of a child's standard error, read back as the event it records. */
const eventsIn = (stderr) => stderr.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));

test('a sink opened with no state directory accepts events and writes no file anywhere', () => {
  const { status, stderr, left } = inChild([
    `const sink = openSink({ run: 'r-8f21', now: () => ${AT_14_14} });`,
    "sink.emitter({ layer: 'L0', card: 1412 }).emit('survivor.killed', { name: 'git' });",
  ].join('\n'));

  assert.equal(stderr, '', 'the child failed, or wrote before it was ended');
  assert.equal(status, 0);
  assert.deepEqual(left, []);
});

test('emitting to a sink with no state directory yet is never refused, even where nothing could be written', () => {
  // The child's working directory and temp directory refuse every write, so an emit that tried
  // to write anything anywhere it could reach by default would throw.
  const { status, stderr } = inChild([
    "import { chmodSync } from 'node:fs';",
    "chmodSync('.', 0o555);",
    `const sink = openSink({ run: 'r-8f21', now: () => ${AT_14_14} });`,
    "const { emit } = sink.emitter({ layer: 'L0', card: 1412 });",
    "for (let index = 0; index < 1000; index += 1) emit('survivor.killed', { index });",
  ].join('\n'));

  assert.equal(stderr, '');
  assert.equal(status, 0);
});

test('a sink given its state directory late writes what it held there first, in order, ahead of what follows', () => {
  const directory = join(stateDir(), '.rigger');
  const sink = openSink({ run: 'r-8f21', now: clockOver([AT_14_14, AT_14_14, AT_14_19]) });
  const { emit } = sink.emitter({ layer: 'L0' });

  emit('survivor.killed', { name: 'first' });
  emit('survivor.killed', { name: 'second' });
  sink.name(directory);
  emit('survivor.killed', { name: 'third' });

  assert.deepEqual(readEvents(directory).map((event) => event.name), ['first', 'second', 'third']);
});

test('a held event carries the time it was emitted, not the time it was written', () => {
  const directory = stateDir();
  // The clock is wound for the one emit and no more, so a sink that read it again when it wrote
  // the held event fails on the clock before it reaches the assertion.
  const sink = openSink({ run: 'r-8f21', now: clockOver([AT_14_14]) });
  sink.emitter({ layer: 'L0' }).emit('survivor.killed', { name: 'git' });

  sink.name(directory);

  assert.deepEqual(readEvents(directory).map((event) => event.ts), ['2026-09-13T14:14:45.882Z']);
});

test('naming a state directory that refuses writes fails, naming every held event that went unrecorded', () => {
  const directory = stateDir();
  chmodSync(directory, 0o555);
  const sink = openSink({ run: 'r-8f21', now: clockOver([AT_14_14, AT_14_19]) });
  const { emit } = sink.emitter({ layer: 'L0', card: 1412 });
  emit('survivor.killed', { name: 'rust-analyzer-proc-macro-srv' });
  emit('survivor.killed', { name: 'git' });

  assert.throws(() => sink.name(directory), (error) => {
    assert.match(error.message, /"ts":"2026-09-13T14:14:45\.882Z".*"name":"rust-analyzer-proc-macro-srv"/);
    assert.match(error.message, /"ts":"2026-09-13T14:19:03\.005Z".*"name":"git"/);
    assert.match(error.message, /EACCES/);
    return true;
  });
});

test('a sink named a state directory that never records an event creates neither the directory nor a file', () => {
  const parent = stateDir();
  const atOpen = join(parent, 'named-at-open');
  const later = join(parent, 'named-later');

  openSink({ directory: atOpen, run: 'r-8f21', now: clockOver([]) });
  openSink({ run: 'r-8f21', now: clockOver([]) }).name(later);

  assert.deepEqual(readdirSync(parent), []);
});

/** A child's sink, never named, holding two kills. The body goes on from there. */
const holdingTwo = [
  `const sink = openSink({ run: 'r-8f21', now: () => ${AT_14_14} });`,
  "const { emit } = sink.emitter({ layer: 'L0', card: 1412 });",
  "emit('survivor.killed', { name: 'first' });",
  "emit('survivor.killed', { name: 'second' });",
].join('\n');

const HELD_TWO = [
  { ts: '2026-09-13T14:14:45.882Z', run: 'r-8f21', layer: 'L0', event: 'survivor.killed', card: 1412, name: 'first' },
  { ts: '2026-09-13T14:14:45.882Z', run: 'r-8f21', layer: 'L0', event: 'survivor.killed', card: 1412, name: 'second' },
];

test('a sink ended without a state directory writes each held event to standard error, and no file', () => {
  const { status, stderr, left } = inChild(`${holdingTwo}\nsink.end();`);

  assert.equal(status, 0, stderr);
  assert.deepEqual(eventsIn(stderr), HELD_TWO);
  assert.deepEqual(left, []);
});

test('a sink ended twice without a state directory writes nothing more at its second end', () => {
  // The verb and L0's exit cleanup can each end it (ruling 3, §3), so the second is the usual case.
  const { status, stderr } = inChild(`${holdingTwo}\nsink.end();\nsink.end();`);

  assert.equal(status, 0, stderr);
  assert.deepEqual(eventsIn(stderr), HELD_TWO);
});

test('a sink that was given a state directory writes nothing when it is ended', () => {
  const { status, stderr, home } = inChild(`${holdingTwo}\nsink.name('.rigger');\nemit('survivor.killed', { name: 'third' });\nsink.end();`);

  assert.equal(stderr, '');
  assert.equal(status, 0);
  assert.deepEqual(readEvents(join(home, '.rigger')).map((event) => event.name), ['first', 'second', 'third']);
});

test('an event given to an unnamed sink after its end is written to standard error at once', () => {
  // The child is killed outright straight after the emit, so an event the sink kept for a later
  // write never reaches the pipe.
  const { stderr, signal } = inChild([
    holdingTwo,
    'sink.end();',
    "emit('survivor.killed', { name: 'late' });",
    "process.kill(process.pid, 'SIGKILL');",
  ].join('\n'));

  assert.equal(signal, 'SIGKILL', stderr);
  assert.deepEqual(eventsIn(stderr).map((event) => event.name), ['first', 'second', 'late']);
});

test('what an unnamed sink held reaches standard error whole at exit, past a full pipe of 65,536 bytes', () => {
  // A pipe on macOS holds 65,536 bytes. Past that, a write to a non-blocking descriptor comes back
  // short, and the process then exits with the rest unwritten. So the end runs where L0's exit
  // cleanup runs it, in an `exit` listener, and the child leaves through `process.exit`.
  const count = 2000;
  const { status, stderr } = inChild([
    `const sink = openSink({ run: 'r-8f21', now: () => ${AT_14_14} });`,
    "const { emit } = sink.emitter({ layer: 'L0', card: 1412 });",
    `for (let index = 0; index < ${count}; index += 1) emit('survivor.killed', { index, command: 'x'.repeat(100) });`,
    "process.on('exit', () => sink.end());",
    'process.exit(1);',
  ].join('\n'));

  assert.equal(status, 1);
  assert.ok(Buffer.byteLength(stderr) > 65_536, `only ${Buffer.byteLength(stderr)} bytes were written`);
  assert.deepEqual(
    eventsIn(stderr).map((event) => event.index),
    Array.from({ length: count }, (unused, index) => index),
  );
});

/**
 * Runs `body` in a child whose standard error is a FIFO, and answers how it ended, what it wrote
 * to standard output, and what it wrote to standard error. Where `touched` is set, the child first
 * writes nothing to `process.stderr`, as every verb that prints does; otherwise it leaves the
 * descriptor as it inherited it. Nothing reads the FIFO until the child has written `drain` to
 * standard output, if it ever does. The script lives in a scratch directory, so the child is ended
 * at the test's teardown, whether it passed or failed.
 */
async function stuckChild(t, body, { touched = true } = {}) {
  const directory = scratch(t);
  const script = join(directory, 'child.mjs');
  writeFileSync(script, [
    `import { openSink } from ${JSON.stringify(sinkModule)};`,
    "import { existsSync } from 'node:fs';",
    touched ? "process.stderr.write('');" : '',
    body,
  ].join('\n'));
  const { reader, writer } = undrained(t, directory);
  const child = spawn(process.execPath, [script], { cwd: directory, stdio: ['ignore', 'pipe', writer] });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  let closed = false;
  const ended = once(child, 'close').finally(() => { closed = true; });
  const read = [];
  const chunk = Buffer.alloc(65_536);
  const take = () => {
    for (;;) {
      try {
        const count = readSync(reader, chunk);
        if (count === 0) return;
        read.push(Buffer.from(chunk.subarray(0, count)));
      } catch (error) {
        if (error.code === 'EAGAIN') return;
        throw error;
      }
    }
  };
  // Once the child says `drain`, the test reads the FIFO on every turn until the child has ended,
  // and once more after, for what was left in the pipe. It says `draining` only once its first
  // read has emptied the pipe, so the child's next write finds room.
  while (!closed) {
    if (stdout.includes('drain\n')) {
      take();
      writeFileSync(join(directory, 'draining'), '');
    }
    await turn(t);
  }
  if (stdout.includes('drain\n')) take();
  const [status] = await ended;
  return { status, stdout, stderr: Buffer.concat(read).toString() };
}

/** Lines that open an unnamed sink and give it 2,000 events, some 200,000 bytes, past a full pipe. */
const holdingMany = [
  `const sink = openSink({ run: 'r-8f21', now: () => ${AT_14_14} });`,
  "const { emit } = sink.emitter({ layer: 'L0', card: 1412 });",
  "for (let index = 0; index < 2000; index += 1) emit('survivor.killed', { index, command: 'x'.repeat(100) });",
].join('\n');

/** What the child writes to standard output once it has done `step`: how many milliseconds it took. */
const timed = (step) => ['const began = performance.now();', step, "process.stdout.write(`${performance.now() - began}\\n`);"].join('\n');

/** How far a `heldAtOpen` child's clock jumps: three tenths of the bound. */
const HELD = UNDRAINED_BOUND * 0.3;

/**
 * Lines that move the child's clock `HELD` ms ahead at its next read of `process.stderr`, and at
 * no later one, so the time passes inside the step that opens standard error and nowhere else.
 */
const heldAtOpen = [
  'const real = performance.now.bind(performance);',
  'let ahead = 0;',
  'performance.now = () => real() + ahead;',
  "const opened = Object.getOwnPropertyDescriptor(process, 'stderr');",
  "Object.defineProperty(process, 'stderr', { ...opened, get() {",
  "  Object.defineProperty(process, 'stderr', opened);",
  `  ahead = ${HELD};`,
  '  return opened.get.call(process);',
  '} });',
].join('\n');

/** The milliseconds a `timed` step took, as the child wrote them. */
const tookIn = (stdout) => Number(stdout.split('\n')[0]);

for (const touched of [true, false]) {
  const which = touched ? 'the process has written to' : 'the process never touched';

  test(`given a standard error ${which} that is never drained, a sink ended while it holds more than the pipe holds returns within ${UNDRAINED_BOUND} ms`, { timeout: 30_000 }, async (t) => {
    const { status, stdout } = await stuckChild(t, [holdingMany, timed('sink.end();')].join('\n'), { touched });

    assert.equal(status, 0);
    const took = tookIn(stdout);
    assert.ok(took >= UNDRAINED_BOUND / 2, `the end took ${took} ms, so the pipe never held it and this proves nothing`);
    assert.ok(took <= UNDRAINED_BOUND, `the end took ${took} ms`);
  });

  test(`given a standard error ${which} that is never drained, a sink ended while it holds more than the pipe holds, then given an event, returns from both within ${UNDRAINED_BOUND} ms`, { timeout: 30_000 }, async (t) => {
    const { status, stdout } = await stuckChild(t, [
      holdingMany,
      timed("sink.end();\nemit('survivor.killed', { name: 'late' });"),
    ].join('\n'), { touched });

    assert.equal(status, 0);
    const took = tookIn(stdout);
    assert.ok(took >= UNDRAINED_BOUND / 2, `the end and the event took ${took} ms, so the pipe never held them and this proves nothing`);
    assert.ok(took <= UNDRAINED_BOUND, `the end and the event took ${took} ms`);
  });

  // The time an end spends before its first write counts against the bound. The child's clock
  // jumps `HELD` ms at the end's read of `process.stderr`, standing in for a loaded host holding
  // the process there, as one did for 181.5 ms (#418).
  test(`given a standard error ${which} that is never drained, and ${HELD} ms passing as a sink's end opens it, the end returns within ${UNDRAINED_BOUND} ms`, { timeout: 30_000 }, async (t) => {
    const { status, stdout } = await stuckChild(t, [holdingMany, heldAtOpen, timed('sink.end();')].join('\n'), { touched });

    assert.equal(status, 0);
    const took = tookIn(stdout);
    assert.ok(took >= HELD + UNDRAINED_BOUND / 2, `the end took ${took} ms, so the pipe never held it and this proves nothing`);
    assert.ok(took <= UNDRAINED_BOUND, `the end took ${took} ms`);
  });
}

test('a reader that drains again after a write gave up on it gets every byte of a later write', { timeout: 30_000 }, async (t) => {
  // The first sink's end gives up on the undrained FIFO. The test then drains it, and a second
  // sink, holding as much, is ended once the test is reading.
  const { status, stdout, stderr } = await stuckChild(t, [
    holdingMany,
    timed('sink.end();'),
    `const second = openSink({ run: 'r-8f21', now: () => ${AT_14_14} });`,
    "const late = second.emitter({ layer: 'L0', card: 1412 });",
    "for (let index = 0; index < 2000; index += 1) late.emit('survivor.killed', { second: index, command: 'x'.repeat(100) });",
    "process.stdout.write('drain\\n');",
    "while (!existsSync('draining')) await new Promise((resolve) => setImmediate(resolve));",
    'second.end();',
  ].join('\n'));

  assert.equal(status, 0);
  assert.ok(tookIn(stdout) >= UNDRAINED_BOUND / 2, 'the first end did not wait on the pipe, so it never gave up and this proves nothing');
  // The first end's output stops wherever it gave up, which can be inside a line, so the second
  // sink's events are found by their own field rather than line by line.
  const seconds = [...stderr.matchAll(/"second":(\d+),/g)].map(([, index]) => Number(index));
  assert.deepEqual(seconds, Array.from({ length: 2000 }, (unused, index) => index));
});
