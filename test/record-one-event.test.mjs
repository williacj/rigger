// ABOUTME: Tests that one event in L5's stream reads on its own, without the events recorded
// before it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';

import { openSink, streamPath } from '../src/observation/sink.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/**
 * The last event in a stream, read backwards from its end one byte at a time until the newline
 * that closes the event before it. Returns the event and the lowest offset read.
 */
function readLastEvent(path) {
  const fd = openSync(path, 'r');
  try {
    const byte = Buffer.alloc(1);
    // The stream ends in the last event's own newline, so the event's text ends just before it.
    const end = fstatSync(fd).size - 1;
    let start = end;
    while (start > 0) {
      readSync(fd, byte, 0, 1, start - 1);
      if (byte[0] === 0x0a) break;
      start -= 1;
    }
    const text = Buffer.alloc(end - start);
    readSync(fd, text, 0, text.length, start);
    return { event: JSON.parse(text.toString('utf8')), lowest: start - 1 };
  } finally {
    closeSync(fd);
  }
}

// proves R-RECORD-10
test('given a stream of three events whose first two are unreadable, the third reads on its own, whole', () => {
  const directory = temporaryDirectory('rigger-one-event-');
  const instants = [1789308885882, 1789309000000, 1789309143005];
  const sink = openSink({ directory, run: 'r-8f21', now: () => instants.shift() });
  const execution = sink.emitter({ layer: 'L1', card: 1412, dispatch: 'd-01' });
  execution.emit('dispatch.start', { role: 'engineer' });
  execution.emit('dispatch.end', { role: 'engineer', exit: 0 });
  sink.emitter({ layer: 'L0', card: 1412 }).emit('survivor.killed', { name: 'rust-analyzer' });

  // Every byte of the two earlier events is overwritten, keeping only the newlines, so a reader
  // that parsed either of them would fail rather than pass.
  const path = streamPath(directory);
  const lines = readFileSync(path, 'utf8').split('\n');
  const firstTwo = lines.slice(0, 2).join('\n').length;
  writeFileSync(path, [...lines.slice(0, 2).map((line) => '#'.repeat(line.length)), ...lines.slice(2)].join('\n'));

  const { event, lowest } = readLastEvent(path);

  assert.equal(lowest, firstTwo, 'the reader read no byte before the newline closing the second event');
  assert.deepEqual(event, {
    ts: '2026-09-13T14:19:03.005Z',
    run: 'r-8f21',
    layer: 'L0',
    event: 'survivor.killed',
    card: 1412,
    name: 'rust-analyzer',
  });
});
