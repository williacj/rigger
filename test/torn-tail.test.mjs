// ABOUTME: Checks ARCHITECTURE.md's "A torn tail": the reader's four rules over a stream a failed
// write left torn, and the sink's hold across a naming, an emit or an end whose append tears or fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { manualClock } from './clock-report-world.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const stateDir = () => temporaryDirectory('rigger-torn-tail-');

/**
 * One line in the sink's form, written out by hand: the envelope's `ts` first, as `openSink`
 * stamps it (`ARCHITECTURE.md`, "The reader separates the fragment"), so a reader's answer is
 * checked against literals rather than against the sink.
 */
const event = (name, fields = {}) => ({ ts: '1970-01-01T00:00:00.000Z', run: 'r-torn', layer: 'L5', event: 'torn.probe', name, ...fields });
const line = (name, fields) => `${JSON.stringify(event(name, fields))}\n`;
/** A line cut short after `length` bytes, as an append that tore leaves it: no newline. */
const cut = (name, length, fields) => line(name, fields).slice(0, length);

/** Writes `bytes` as a state directory's whole stream, and answers the directory. */
function streamOf(bytes) {
  const directory = stateDir();
  writeFileSync(streamPath(directory), bytes);
  return directory;
}

const names = (events) => events.map(({ name }) => name);

/**
 * Runs `reading` and asserts it left every byte of `directory`'s stream as it was, whether it
 * returned or threw: no reader path rewrites what was recorded (`R-RECORD-5`; `ARCHITECTURE.md`,
 * "A torn tail", "No writer makes the call").
 */
function leavesStream(directory, reading) {
  const before = readFileSync(streamPath(directory));
  try {
    reading();
  } finally {
    assert.deepEqual(readFileSync(streamPath(directory)), before, 'the reader must leave every byte of the stream as it was');
  }
}

/** Every event `readEvents` returns for `directory`, where a refusal or a changed byte is this test's failure. */
function read(directory) {
  let events;
  leavesStream(directory, () => {
    assert.doesNotThrow(() => { events = readEvents(directory); }, 'the reader must not refuse the stream');
  });
  return events;
}

/**
 * Asserts `readEvents` refuses the stream at `number`, as #1391 words the refusal, and leaves
 * every byte of it as it was.
 */
function refusesLine(directory, number, cause) {
  leavesStream(directory, () => {
    assert.throws(() => readEvents(directory), (failure) => {
      assert.equal(failure.message, `${streamPath(directory)} line ${number} is not a recorded event`);
      assert.ok(failure.cause instanceof cause, `the cause is a ${cause.name}: ${failure.cause}`);
      return true;
    });
  });
}

// A reader that refused or returned the unterminated fragment fails here.
// proves R-RECORD-5, R-RECORD-6
test('R1: whole events, then a fragment with no newline after it, read as the whole events alone', () => {
  const directory = streamOf(`${line('one')}${line('two')}${cut('three', 40)}`);

  assert.deepEqual(read(directory), [event('one'), event('two')]);
});

// Rows R2 and R9 over one stream. A reader that refuses every line that is not one event (E1's
// second rule) fails here, and so does one that truncated, terminated or rewrote the fragment.
// proves R-RECORD-5, R-RECORD-6
test('R2 R9: a fragment, then a whole sink line on the same line, reads as that line\'s event and every event before it, and leaves the stream\'s bytes as they were, the fragment included', () => {
  const bytes = Buffer.from(`${line('one')}${line('two')}${cut('torn', 40)}${line('three')}`);
  const directory = streamOf(bytes);

  assert.deepEqual(read(directory), [event('one'), event('two'), event('three')]);
  assert.deepEqual(readFileSync(streamPath(directory)), bytes);
});

// A reader that looks past only one fragment, or takes the rightmost offset, fails here.
// proves R-RECORD-5, R-RECORD-6
test('R3: two fragments, then a whole sink line, on one line, read as the whole line\'s event', () => {
  const directory = streamOf(`${line('one')}${cut('torn', 30)}${cut('torn again', 60)}${line('three')}`);

  assert.deepEqual(read(directory), [event('one'), event('three')]);
});

// #1374's round-1 case: a fragment cut just after a space inside a string leaves a second offset a
// JSON parser accepts. A reader that wants exactly one offset from which the rest parses fails here.
// proves R-RECORD-5, R-RECORD-6
test('R4: a fragment cut just after a space inside a string, then a whole sink line, reads as the whole line\'s event', () => {
  const torn = line('torn', { reason: 'a b' });
  const fragment = torn.slice(0, torn.indexOf('a b') + 'a '.length);
  assert.ok(fragment.endsWith('"reason":"a '), `the fragment ends just after the space: ${fragment}`);
  const whole = line('three');
  assert.deepEqual(JSON.parse(` ${whole}`), JSON.parse(whole), 'the premise: a parser also starts at the space');
  const directory = streamOf(`${line('one')}${fragment}${whole}`);

  assert.deepEqual(read(directory), [event('one'), event('three')]);
});

// A reader that takes any JSON object at a `{"ts":"` offset, without #1391's envelope check, fails here.
// proves R-RECORD-5, R-RECORD-6
test('R5: a fragment, then an object at a {"ts":" offset that breaks the envelope, is refused naming its line', () => {
  const breaking = `${JSON.stringify({ ...event('three'), layer: 'L9' })}\n`;
  assert.ok(breaking.startsWith('{"ts":"'), 'the premise: the object starts where a sink line does');
  const directory = streamOf(`${line('one')}${cut('torn', 40)}${breaking}${line('four')}`);

  refusesLine(directory, 2, SyntaxError);
});

// A reader that recovers a whole line after bytes not beginning with `{` fails here.
// proves R-RECORD-5, R-RECORD-6
test('R6a: NUL bytes, then a whole sink line, on one line, are refused naming the line', () => {
  const directory = streamOf(Buffer.concat([Buffer.from(line('one')), Buffer.alloc(16), Buffer.from(line('three'))]));

  refusesLine(directory, 2, SyntaxError);
});

// A reader that recovers a whole line after bytes not beginning with `{` fails here.
// proves R-RECORD-5, R-RECORD-6
test('R6b: text not beginning with {, then a whole sink line, on one line, is refused naming the line', () => {
  const directory = streamOf(`${line('one')}not a sink line ${line('three')}`);

  refusesLine(directory, 2, SyntaxError);
});

// A reader that passes over a line beginning with `{` without finding a whole event in it fails here.
// proves R-RECORD-5, R-RECORD-6
test('R7: a line beginning with { with no {"ts":" offset from which the rest is one event is refused naming the line', () => {
  for (const damaged of [
    `${cut('torn', 40)}{"run":"r-torn","layer":"L5","event":"torn.probe"}\n`,
    `${cut('torn', 40)}${cut('torn again', 50)}\n`,
  ]) {
    refusesLine(streamOf(`${line('one')}${damaged}${line('four')}`), 2, SyntaxError);
  }
});

// A reader whose answer for the pushed copy differs from its answer for the local stream fails here.
// proves R-RECORD-5, R-RECORD-6
test('R8: the pushed copy of a torn stream reads as the local stream does', () => {
  const local = Buffer.from(`${line('one')}${line('two')}${cut('torn', 40)}${line('three')}${cut('later', 25)}`);
  // "The commit" (`src/substrate/data-ref.mjs`, `pushStream`): up to and including the last newline.
  const copy = local.subarray(0, local.lastIndexOf(0x0a) + 1);
  assert.ok(copy.length < local.length, 'the premise: the local stream ends in a fragment the copy leaves out');

  const fromLocal = read(streamOf(local));

  assert.deepEqual(read(streamOf(copy)), fromLocal);
  assert.deepEqual(names(fromLocal), ['one', 'two', 'three']);
});

/**
 * Has `node:fs`'s `appendFileSync` follow `steps` for the appends after this call, one step each,
 * and append as usual once they run out, until the test ends. `syncBuiltinESMExports` carries the
 * change to the sink, which imports `appendFileSync` by name. A `tear` appends the first half of
 * the line through the real append and then throws ENOSPC, as a disk that fills partway does; a
 * `refuse` throws EIO and appends no byte.
 */
function appendsFollow(t, steps) {
  const real = fs.appendFileSync;
  const remaining = [...steps];
  fs.appendFileSync = (path, data, ...rest) => {
    const step = remaining.shift() ?? 'write';
    if (step === 'tear') {
      real(path, String(data).slice(0, Math.floor(String(data).length / 2)), ...rest);
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    }
    if (step === 'refuse') throw Object.assign(new Error('EIO: i/o error, write'), { code: 'EIO' });
    return real(path, data, ...rest);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.appendFileSync = real;
    syncBuiltinESMExports();
  });
}

/**
 * Collects what is written to standard error through `node:fs`'s `writeSync`, which
 * `writeWhole` (`src/substrate/standard-error.mjs`) writes it with, until the test ends, and
 * answers each line written as the event it records.
 */
function standardError(t) {
  const real = fs.writeSync;
  let written = '';
  fs.writeSync = (descriptor, data, ...rest) => {
    if (descriptor !== 2) return real(descriptor, data, ...rest);
    written += Buffer.from(data).toString('utf8');
    return Buffer.byteLength(data);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.writeSync = real;
    syncBuiltinESMExports();
  });
  return () => written.split('\n').filter((text) => text !== '').map((text) => JSON.parse(text));
}

/** An unnamed sink holding `a`, `b` and `c`, and its emit. */
function holdingThree() {
  const sink = openSink({ run: 'r-torn', now: manualClock(0).now });
  const { emit } = sink.emitter({ layer: 'L5' });
  for (const name of ['a', 'b', 'c']) emit('torn.probe', { name });
  return { sink, emit };
}

/** Row H2a: three held events, and the naming's second append tears. Answers the naming's failure. */
function namingTorn(t, after = []) {
  const directory = stateDir();
  appendsFollow(t, ['write', 'tear', ...after]);
  const { sink, emit } = holdingThree();
  let failure;
  assert.throws(() => sink.name(directory), (thrown) => {
    failure = thrown;
    return true;
  });
  return { directory, sink, emit, failure };
}

// A sink that wrote a held event twice, or kept it held once written, fails here.
// proves R-RECORD-6
test('H1: a sink that emits while unnamed, then is named, writes each held event once in emit order and holds none', (t) => {
  const directory = stateDir();
  const { sink, emit } = holdingThree();
  const errors = standardError(t);

  sink.name(directory);
  emit('torn.probe', { name: 'd' });
  sink.end();

  assert.deepEqual(names(read(directory)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(errors(), [], 'the hold is empty at the end');
});

// A naming failure that left out the torn event or one after it, or named one already written, fails here.
// proves R-RECORD-6
test('H2a: a naming whose second append tears fails naming the second and third held events and not the first', (t) => {
  const { failure } = namingTorn(t);

  assert.match(failure.message, /ENOSPC/);
  assert.match(failure.message, /"name":"b"/);
  assert.match(failure.message, /"name":"c"/);
  assert.doesNotMatch(failure.message, /"name":"a"/);
  // The sink still holds them and writes each as its own record line later, so the failure names
  // them without a line a reader of standard error would take for a second record.
  assert.deepEqual(failure.message.split('\n').filter((text) => text.startsWith('{')), []);
});

// A naming failure that left out an unwritten held event fails here.
// proves R-RECORD-6
test('H2b: a naming whose first append is refused outright fails naming every held event', (t) => {
  const directory = stateDir();
  chmodSync(directory, 0o555);
  t.after(() => chmodSync(directory, 0o755));
  const { sink } = holdingThree();

  assert.throws(() => sink.name(directory), (failure) => {
    assert.match(failure.message, /EACCES/);
    for (const name of ['a', 'b', 'c']) assert.match(failure.message, new RegExp(`"name":"${name}"`));
    return true;
  });
  assert.equal(existsSync(streamPath(directory)), false, 'the premise: the refused append wrote no byte');
});

// A sink that let go of the events its naming did not write fails here.
// proves R-RECORD-6
test('H3: after a torn naming, the next emit writes every held event once, then its own', (t) => {
  const { directory, emit } = namingTorn(t);

  emit('torn.probe', { name: 'd' });

  assert.deepEqual(names(read(directory)), ['a', 'b', 'c', 'd']);
});

// A sink that wrote the refused emit's own event, dropped the held line it wrote, or let go of the rest, fails here.
// proves R-RECORD-6
test('H4: after a torn naming, an emit whose second held append is refused is refused, and a later emit writes the rest first', (t) => {
  const { directory, emit } = namingTorn(t, ['write', 'refuse']);

  assert.throws(() => emit('torn.probe', { name: 'd' }), /EIO/);
  emit('torn.probe', { name: 'e' });

  assert.deepEqual(names(read(directory)), ['a', 'b', 'c', 'e']);
});

// An end that left what the sink holds unwritten, or wrote it twice, fails here.
// proves R-RECORD-6
test('H5: after a torn naming, an end called twice writes each held event to the stream once', (t) => {
  const { directory, sink } = namingTorn(t);
  const errors = standardError(t);

  sink.end();
  sink.end();

  assert.deepEqual(names(read(directory)), ['a', 'b', 'c']);
  assert.deepEqual(errors(), []);
});

// Standard error is outside R-RECORD-6 (M8-U14), so this claims nothing. An end that dropped what
// the sink holds, or wrote it at each call, fails here.
test('H6: after a torn naming, an end called twice whose appends are refused writes each held event to standard error once', (t) => {
  const { sink } = namingTorn(t, ['refuse', 'refuse', 'refuse', 'refuse']);
  const errors = standardError(t);

  sink.end();
  sink.end();

  assert.deepEqual(names(errors()), ['b', 'c']);
});

// A sink that swallowed the tear, or held the torn event to write again, fails here.
// proves R-RECORD-6
test('H7: a named sink\'s emit whose append tears is refused, and a later reader never finds its event', (t) => {
  const directory = stateDir();
  const sink = openSink({ directory, run: 'r-torn', now: manualClock(0).now });
  const { emit } = sink.emitter({ layer: 'L5' });
  emit('torn.probe', { name: 'a' });
  appendsFollow(t, ['tear']);

  assert.throws(() => emit('torn.probe', { name: 'b' }), /ENOSPC/);
  emit('torn.probe', { name: 'c' });
  sink.end();

  assert.deepEqual(names(read(directory)), ['a', 'c']);
});

// #1298's row R7b. A reader that refuses the line the new writer's event lands on fails here.
// proves R-RECORD-6
test('H8: after a tail torn by a failed write, a new writer\'s event and every event returned before the tear are read', (t) => {
  const directory = stateDir();
  const first = openSink({ directory, run: 'r-torn', now: manualClock(0).now }).emitter({ layer: 'L5' });
  first.emit('torn.probe', { name: 'a' });
  first.emit('torn.probe', { name: 'b' });
  appendsFollow(t, ['tear']);
  assert.throws(() => first.emit('torn.probe', { name: 'torn' }), /ENOSPC/);
  assert.ok(!readFileSync(streamPath(directory), 'utf8').endsWith('\n'), 'the premise: the tail is torn');

  openSink({ directory, run: 'r-later', now: manualClock(0).now }).emitter({ layer: 'L5' }).emit('torn.probe', { name: 'd' });

  assert.deepEqual(names(read(directory)), ['a', 'b', 'd']);
});
