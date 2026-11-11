// ABOUTME: Checks the record's append, held-event and complete-line guarantees with an injected clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { manualClock } from './clock-report-world.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { readdirSync } from 'node:fs';

// A complete JSON object without its newline must be excluded just like a partial JSON or UTF-8 tail.
// proves R-RECORD-6
test('R14: a reader returns complete events and ignores every unterminated tail', () => {
  const directory = temporaryDirectory('rigger-record-integrity-');
  const clock = manualClock(0);
  const expected = {
    ts: '1970-01-01T00:00:00.000Z', run: 'r-integrity', layer: 'L3',
    event: 'complete', card: 1298, dispatch: 'd-integrity', value: 'line\n"quote"\\☃',
  };
  const sink = openSink({ directory, run: 'r-integrity', now: clock.now });
  sink.emitter({ layer: 'L3', card: 1298, dispatch: 'd-integrity' })
    .emit('complete', { value: 'line\n"quote"\\☃' });
  const whole = readFileSync(streamPath(directory));
  const tails = [Buffer.alloc(0), Buffer.from('{"event":'), Buffer.from(JSON.stringify(expected)), Buffer.from([0xf0, 0x9f])];

  for (const prefix of [whole, Buffer.alloc(0)]) for (const tail of tails) {
    const bytes = Buffer.concat([prefix, tail]);
    writeFileSync(streamPath(directory), bytes);
    let events;
    assert.doesNotThrow(() => { events = readEvents(directory); }, 'an unterminated tail must not refuse complete events');
    assert.deepEqual(events, prefix.length === 0 ? [] : [expected], 'only newline-terminated events belong to the record');
    assert.deepEqual(readFileSync(streamPath(directory)), bytes, 'reading must leave the record unchanged');
  }
});

// An overwrite on the second emit must lose both the byte-prefix and event assertions.
// proves R-RECORD-5
test('R3: a second emit preserves every earlier byte', async () => {
  const directory = temporaryDirectory('rigger-record-integrity-');
  const clock = manualClock(0);
  const sink = openSink({ directory, run: 'r-append', now: clock.now });
  const emitter = sink.emitter({ layer: 'L3', card: 1298, dispatch: 'd-append' });
  emitter.emit('first', { value: '☃\n"first"\\' });
  const before = readFileSync(streamPath(directory));
  await clock.advance(1);

  emitter.emit('second', { value: 'second' });

  const after = readFileSync(streamPath(directory));
  assert.ok(after.length > before.length, 'the second emit must grow the record');
  assert.deepEqual(after.subarray(0, before.length), before, 'every earlier byte must remain unchanged');
  assert.deepEqual(readEvents(directory), [
    { ts: '1970-01-01T00:00:00.000Z', run: 'r-append', layer: 'L3', event: 'first', card: 1298, dispatch: 'd-append', value: '☃\n"first"\\' },
    { ts: '1970-01-01T00:00:00.001Z', run: 'r-append', layer: 'L3', event: 'second', card: 1298, dispatch: 'd-append', value: 'second' },
  ]);
  assert.deepEqual(readdirSync(directory), ['events.jsonl']);
});

// Reversing the held queue must change the independently specified order and timestamps.
// proves R-RECORD-6
test('R8: naming the state directory records held events in emit order before later events', async () => {
  const directory = temporaryDirectory('rigger-record-integrity-');
  const clock = manualClock(0);
  const sink = openSink({ run: 'r-held', now: clock.now });
  const emitter = sink.emitter({ layer: 'L3', card: 1298, dispatch: 'd-held' });
  emitter.emit('first', { index: 0 });
  await clock.advance(1);
  emitter.emit('second', { index: 1 });
  assert.deepEqual(readdirSync(directory), [], 'unnamed events must still be held');
  await clock.advance(2);

  sink.name(directory);
  emitter.emit('third', { index: 2 });

  assert.deepEqual(readEvents(directory), [
    { ts: '1970-01-01T00:00:00.000Z', run: 'r-held', layer: 'L3', event: 'first', card: 1298, dispatch: 'd-held', index: 0 },
    { ts: '1970-01-01T00:00:00.001Z', run: 'r-held', layer: 'L3', event: 'second', card: 1298, dispatch: 'd-held', index: 1 },
    { ts: '1970-01-01T00:00:00.002Z', run: 'r-held', layer: 'L3', event: 'third', card: 1298, dispatch: 'd-held', index: 2 },
  ]);
  assert.deepEqual(readdirSync(directory), ['events.jsonl']);
});

// Ignoring a terminated malformed line would hide damage at the beginning, middle or end.
// proves R-RECORD-6
test('R15: a reader refuses malformed terminated lines at their actual line number', () => {
  const directory = temporaryDirectory('rigger-record-integrity-');
  const clock = manualClock(0);
  openSink({ directory, run: 'r-damage', now: clock.now })
    .emitter({ layer: 'L3', card: 1298 }).emit('whole', { value: '☃\n"whole"' });
  const whole = readFileSync(streamPath(directory));
  for (const bad of ['{"event":\n', '\n', 'not JSON\n']) {
    for (const [prefix, suffix, line] of [
      [Buffer.alloc(0), whole, 1], [whole, whole, 2], [Buffer.concat([whole, whole]), Buffer.alloc(0), 3],
    ]) {
      const bytes = Buffer.concat([prefix, Buffer.from(bad), suffix]);
      writeFileSync(streamPath(directory), bytes);
      assert.throws(() => readEvents(directory), new RegExp(`events\\.jsonl line ${line} is not a recorded event`));
      assert.deepEqual(readFileSync(streamPath(directory)), bytes, 'a refusal must leave the record unchanged');
    }
  }
});
