// ABOUTME: Tests L5's event envelope and sink: what a recorded event carries, that the sink
// ABOUTME: stamps it, that the stream only ever grows, and that a reader gets every event back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openSink, readEvents } from '../src/observation/sink.mjs';

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
