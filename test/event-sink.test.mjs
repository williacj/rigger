// ABOUTME: Tests L5's event envelope and sink: what a recorded event carries, that the sink
// ABOUTME: stamps it, that the stream only ever grows, and that a reader gets every event back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSink, readEvents } from '../src/observation/sink.mjs';

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
