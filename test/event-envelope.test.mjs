// ABOUTME: Checks read-side envelope admission and its report and clock-firing refusal boundaries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readEvents, streamPath } from '../src/observation/sink.mjs';
import { report } from '../src/cli/report.mjs';
import { manualClock, START } from './clock-report-world.mjs';
import { firingWorld, at } from './clock-firing-world.mjs';
import { failuresIn, reportsIn } from './kept-up-run.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const VALID = { ts: '2026-10-29T12:00:00.000Z', run: 'r-envelope', layer: 'L3', event: 'run.start', concurrency: 1 };
const text = (events) => events.map((event) => JSON.stringify(event)).join('\n') + '\n';
const without = (field) => Object.fromEntries(Object.entries(VALID).filter(([key]) => key !== field));

/** Verbs' recording clock and the scheduler use the same explicitly controlled instant. */
function clockIn(t) {
  const clock = manualClock();
  t.mock.method(Date, 'now', clock.now);
  return clock;
}

/** Each case supplies the field and its independently expected diagnostic spelling. */
function refuses(cases) {
  const directory = temporaryDirectory('rigger-envelope-');
  const path = streamPath(directory);
  for (const [event, field, value, checkCause] of cases) {
    const middle = Buffer.isBuffer(event) ? event.toString('utf8') : JSON.stringify(event);
    const bytes = `${text([VALID])}${middle}\n${text([VALID])}`;
    writeFileSync(path, bytes);
    assert.throws(() => readEvents(directory), (failure) => {
      assert.equal(failure.message, `${path} line 2 is not a recorded event`);
      assert.ok(failure.cause instanceof Error, 'the refusal carries its own cause');
      assert.ok(failure.cause.message.includes(field), `cause names ${field}: ${failure.cause.message}`);
      assert.ok(failure.cause.message.includes(value), `cause names ${value}: ${failure.cause.message}`);
      checkCause?.(failure.cause.message);
      return true;
    }, `${field} ${value} must refuse the second line`);
    assert.equal(readFileSync(path, 'utf8'), bytes, 'a refusal preserves the entire stream');
  }
}

// A non-round-tripping timestamp must never escape to reportText or become a successful clock job.
// proves R-RECORD-6
test('E1: invalid timestamps are refused by the reader, report verb and kept-up report firing', async (t) => {
  clockIn(t);
  await t.test('E1 reader: absent, non-string and non-round-tripping timestamps name their field and value', () => {
    refuses([
      [without('ts'), 'ts', 'missing'],
      ...[null, 0, true, {}, [], 'not a time', '2026-10-29', '2026-10-29T12:00:00Z',
        '2026-10-29T13:00:00.000+01:00', '2026-02-30T12:00:00.000Z', '+002026-10-29T12:00:00.000Z']
        .map((ts) => [{ ...VALID, ts }, 'ts', JSON.stringify(ts)]),
    ]);
  });
  await t.test('E1 report: a timestamp refusal prints the stream line and exits 1 without throwing', async () => {
    const consumer = repositoryIn('rigger-envelope-report-');
    const directory = join(consumer, '.rigger');
    mkdirSync(directory);
    const path = streamPath(directory);
    const bytes = text([VALID, { ...VALID, ts: 'not a time' }]);
    writeFileSync(path, bytes);
    let answer;
    await assert.doesNotReject(async () => {
      answer = await report({ target: consumer, ask: (command, args) => {
        assert.equal(command, 'git');
        assert.deepEqual(args, ['-C', consumer, 'rev-parse', '--show-toplevel']);
        // gitIn's observed status/stdout contract keeps Git as the root authority.
        return { status: 0, stdout: gitIn(consumer, 'rev-parse', '--show-toplevel') };
      } });
    }, 'report must handle the reader refusal rather than throw a RangeError');
    assert.equal(answer.code, 1, answer.text);
    assert.equal(answer.text, `rigger report: ${path} line 2 is not a recorded event, so no signal is derived`);
    assert.equal(readFileSync(path, 'utf8'), bytes, 'the refused report preserves the stream');
  });
  await t.test('E10: a kept-up report firing records failed and hands over the reader refusal', async (t) => {
    const clock = manualClock();
    const world = firingWorld({ clock, context: t, triggers: { hourly: {
      interval: 1000, anchor: '2026-10-29T12:00:00.000Z', catchUp: 'skip', job: 'report',
    } } });
    const run = await world.start();
    try {
      const path = streamPath(world.directory);
      const before = readFileSync(path, 'utf8');
      const line = before.split('\n').length;
      appendFileSync(path, text([{ ...VALID, ts: 'not a time' }]));
      await clock.advance(START + 1000);
      // Observe the outcome bytes directly: the reader must refuse this deliberately damaged stream.
      const records = readFileSync(path, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
      assert.deepEqual(records.filter(({ event }) => event === 'trigger.outcome').map(({ name, occurrence, outcome }) => ({ name, occurrence, outcome })),
        [{ name: 'hourly', occurrence: at(START + 1000), outcome: 'failed' }]);
      const failures = failuresIn(run.handed);
      assert.equal(failures.length, 1, 'the run hands over one report failure');
      assert.ok(failures[0].message.includes(`${path} line ${line} is not a recorded event`), failures[0].message);
      assert.deepEqual(reportsIn(run.handed), [], 'no report is handed over from the refused stream');
      assert.ok(readFileSync(path, 'utf8').startsWith(before), 'the firing preserves every prior byte');
    } finally { await run.stop(); }
  });
});

// A parsed primitive or array is not an event, even though its JSON is well formed.
// proves R-RECORD-6
test('E6: parsed values other than plain objects refuse the stream by line and value', async (t) => {
  clockIn(t);
  await t.test('envelope: ordinary and parsed numeric refusals', () => {
    refuses([null, true, false, 0, 1, 'text', [], [VALID]].map((value) => [value, 'envelope', JSON.stringify(value)]));
    for (const [numeral, expected] of [['1e400', Infinity], ['-1e400', -Infinity], ['-0', -0]]) {
      assert.ok(Object.is(JSON.parse(numeral), expected), 'the root numeric fixture must retain its parsed value');
      const shown = Object.is(expected, -0) ? '-0' : String(expected);
      refuses([[Buffer.from(numeral), 'envelope', shown]]);
    }
  });
  await boundedRefusals(t, 'envelope');
});

// Truthiness or coercion would admit an empty name or a value that is not a string.
// proves R-RECORD-6
test('E2: run and event must each be a present non-empty string', (t) => {
  clockIn(t);
  for (const field of ['run', 'event']) {
    refuses([[without(field), field, 'missing'], ...[null, 0, true, {}, [], '']
      .map((value) => [{ ...VALID, [field]: value }, field, JSON.stringify(value)])]);
  }
});

// A layer must be the exact name of a recorded layer, including its type and bounds.
// proves R-RECORD-6
test('E3: only layer names L0 through L6 enter the record', (t) => {
  clockIn(t);
  refuses([[without('layer'), 'layer', 'missing'], ...[null, 3, true, {}, [], '', 'L7', 'L-1', 'L06', 'L3\n']
    .map((layer) => [{ ...VALID, layer }, 'layer', JSON.stringify(layer)])]);
});

// Present card ids are issue numbers, never null, coerced strings or unsafe/fractional numbers.
// proves R-RECORD-6
test('E4: a present card must be a safe integer above zero', async (t) => {
  clockIn(t);
  await t.test('card: ordinary and parsed numeric refusals', () => {
    refuses([null, 0, -1, 1.5, 9007199254740992, '7', true, {}, [], '7\ncard #999']
      .map((card) => [{ ...VALID, card }, 'card', JSON.stringify(card)]));
    for (const [numeral, expected] of [['1e400', Infinity], ['-1e400', -Infinity], ['-0', -0]]) {
      const prefix = '{"ts":"2026-10-29T12:00:00.000Z","run":"r-envelope","layer":"L3","event":"pull","card":';
      const direct = Buffer.from(`${prefix}${numeral}}`);
      const nested = Buffer.from(`${prefix}{"nested":${numeral}}}`);
      assert.ok(Object.is(JSON.parse(direct.toString('utf8')).card, expected), 'the fixture must preserve the parsed numeric value');
      assert.ok(Object.is(JSON.parse(nested.toString('utf8')).card.nested, expected), 'the nested fixture must preserve the parsed numeric value');
      const shown = Object.is(expected, -0) ? '-0' : String(expected);
      refuses([[direct, 'card', shown], [nested, 'card', shown]]);
    }
  });
  await boundedRefusals(t, 'card');
});

// Null is admitted explicitly; every other present dispatch must remain a non-empty string.
// proves R-RECORD-6
test('E5: dispatch refuses empty strings and non-string non-null values', (t) => {
  clockIn(t);
  refuses(['', 0, 7, true, {}, []].map((dispatch) => [{ ...VALID, dispatch }, 'dispatch', JSON.stringify(dispatch)]));
});

// Overvalidation, changing parsed values, or treating an unterminated tail as an event loses data.
// proves R-RECORD-6
test('E7 E9: valid envelopes round-trip unchanged and every unterminated tail is ignored', (t) => {
  clockIn(t);
  const directory = temporaryDirectory('rigger-envelope-valid-');
  const path = streamPath(directory);
  const expected = [
    ...['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((layer) => ({ ...VALID, layer })),
    { ts: '+010000-01-01T00:00:00.000Z', run: 'r-\n"\\☃', layer: 'L6', event: 'proposal',
      card: 9007199254740991, dispatch: 'd-\n"\\☃', extra: { untouched: [null, 7, 'text'] } },
    { ts: '2026-10-29T12:00:00.000Z', run: ' ', layer: 'L0', event: ' ', card: 1, dispatch: null },
    { ts: '2026-10-29T12:00:00.000Z', run: 'r-a', layer: 'L3', event: 'unfamiliar', dispatch: ' ', occurrence: 'not an instant' },
  ];
  const whole = Buffer.from(text(expected));
  for (const prefix of [whole, Buffer.alloc(0)]) for (const tail of [
    Buffer.alloc(0), Buffer.from('{}'), Buffer.from(text([{ ...VALID, ts: 'not a time' }]).trimEnd()),
    Buffer.from('{"ts":'), Buffer.from([0xf0, 0x9f]),
  ]) {
    const bytes = Buffer.concat([prefix, tail]);
    writeFileSync(path, bytes);
    let actual;
    assert.doesNotThrow(() => { actual = readEvents(directory); }, 'an unterminated tail cannot refuse a valid prefix');
    assert.deepEqual(actual, prefix.length === 0 ? [] : expected, 'every complete event retains its literal parsed values');
    assert.deepEqual(readFileSync(path), bytes, 'reading preserves every stream byte');
  }
});

/** Parser-admitted values need a bounded preview, even where their complete form cannot be serialized. */
async function boundedRefusals(t, field) {
  const arrays = '['.repeat(10000) + '7' + ']'.repeat(10000);
  const objects = '{"nested":'.repeat(10000) + '7' + '}'.repeat(10000);
  const long = JSON.stringify('long-' + 'x'.repeat(100000) + '\nend');
  const wide = '[' + Array(50000).fill('7').join(',') + ']';
  const cases = [
    ['deep arrays', arrays, '[[[[…]]]]', '[[[[…]]]]', (value) => {
      for (let depth = 0; depth < 10000; depth += 1) { assert.ok(Array.isArray(value)); value = value[0]; }
      assert.equal(value, 7);
    }],
    ['deep objects', objects, '{"nested":{"nested":{"nested":{"nested":…}}}}', '[{"nested":{"nested":{"nested":…}}}]', (value) => {
      for (let depth = 0; depth < 10000; depth += 1) { assert.equal(typeof value, 'object'); value = value.nested; }
      assert.equal(value, 7);
    }],
    ['long string', long, '"long-', '"long-', (value) => { assert.equal(value.length, 100009); }],
    ['wide array', wide, '[7,7,7,7,', '[7,7,7,7,', (value) => { assert.equal(value.length, 50000); }],
    ['wide object', '{' + Array.from({ length: 20000 }, (_,index) => `"key${index}":7`).join(',') + '}',
      '{"key0":7,"key1":7,', '[{"key0":7,"key1":7,', (value) => { assert.equal(Object.keys(value).length, 20000); }],
    ['long key', '{' + JSON.stringify('long-' + 'x'.repeat(100000)) + ':7}', '{"long-', '[{"long-',
      (value) => { assert.equal(Object.keys(value)[0].length, 100005); }],
    ['mixed values', `[-0,1e400,${objects},${long},${wide}]`, '[-0,Infinity,{"nested":', '[-0,Infinity,{"nested":', (value) => {
      assert.ok(Object.is(value[0], -0));
      assert.equal(value[1], Infinity);
      assert.equal(value.length, 5);
      assert.equal(value[4].length, 50000);
    }],
  ];
  for (const [name, json, cardPreview, rootPreview, establish] of cases) {
    await t.test(`${field}: bounded diagnostic for ${name}`, () => {
      const parsed = JSON.parse(json);
      establish(parsed);
      const raw = field === 'card' ? `${JSON.stringify(VALID).slice(0, -1)},"card":${json}}`
        : json.startsWith('{') ? `[${json}]` : json;
      refuses([[Buffer.from(raw), field, field === 'card' ? cardPreview : rootPreview, (cause) => {
        assert.ok(cause.length <= 320, `${name}: cause including the value preview must stay within 320 characters`);
        assert.ok(cause.includes('…'), `${name}: the value preview names its elision`);
      }]]);
    });
  }
}
