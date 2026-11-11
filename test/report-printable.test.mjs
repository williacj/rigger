// ABOUTME: Tests that `rigger report` prints every value it copies from a recorded event as text
// that cannot start a line of its own (ARCHITECTURE.md, boundary rule 4), over streams written here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

import { report as derive } from '../src/observation/report.mjs';
import { reportText } from '../src/cli/report.mjs';
import { streamPath } from '../src/observation/sink.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { readFileSync } from 'node:fs';

/** G3: a forged card is refused at its recorded line before any report text can be derived. */
function refused(records, line) {
  const directory = temporaryDirectory('rigger-report-card-refusal-');
  const path = streamPath(directory);
  const bytes = records.map((record) => `${JSON.stringify(record)}\n`).join('');
  writeFileSync(path, bytes);
  assert.throws(() => derive(directory), (failure) => {
    assert.equal(failure.message, `${path} line ${line} is not a recorded event`);
    assert.match(failure.cause.message, /`card`/);
    return true;
  }, 'report must refuse a forged card rather than derive its text');
  assert.equal(readFileSync(path, 'utf8'), bytes, 'refusal preserves all stream bytes');
}

/** Minute `minute` of 2026-01-01, as an event's `ts` records it. */
const at = (minute) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();

/** One recorded event, by the envelope ARCHITECTURE.md gives: layer, event, run and ts, then its fields. */
const event = (run, minute, layer, name, fields = {}) => ({ ts: at(minute), run, layer, event: name, ...fields });

/** What `reportText` prints over a state directory holding exactly `records`, its path written `<path>`. */
function printed(records) {
  const directory = temporaryDirectory('rigger-report-printable-');
  writeFileSync(streamPath(directory), records.map((record) => `${JSON.stringify(record)}\n`).join(''));
  const derived = derive(directory);
  return reportText(derived).replace(derived.path, '<path>');
}

/** Every character that ends a line for some reader: the terminal, a JavaScript source, an editor. */
const BREAKS = /[\r\n\u2028\u2029]/;

/** The escape each break prints as, written out here rather than taken from the code under test. */
const ESCAPED = { '\n': '\\n', '\r': '\\r', '\u2028': '\\u2028', '\u2029': '\\u2029' };

/** A value whose break, `br`, is followed by text reading as another card's line. */
const forged = (head, br) => `${head}${br}    card #9, forged`;

/** `forged(head, br)` as a raw site prints it. */
const raw = (head, br) => `${head}${ESCAPED[br]}    card #9, forged`;

/** `forged(head, br)` as a JSON-quoted site prints it. */
const quoted = (head, br) => `"${head}${ESCAPED[br]}    card #9, forged"`;

/** Asserts `text` holds `line` as one whole line, and no break in it starts a forged card line. */
function holdsLine(text, line, row) {
  assert.ok(text.split('\n').includes(line), `${row}: no line ${JSON.stringify(line)} in:\n${text}`);
  const forgedLine = text.split(BREAKS).find((each) => /^\s*card #9, forged/.test(each));
  assert.equal(forgedLine, undefined, `${row}: a value printed a line of its own in:\n${text}`);
}

/** `value` with every string in it, at any depth, passed through `change`. */
const deep = (value, change) => {
  if (typeof value === 'string') return change(value);
  if (Array.isArray(value)) return value.map((each) => deep(each, change));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, deep(each, change)]));
  return value;
};

/**
 * A stream reaching every line `report` prints a recorded value on, each such value made by
 * `value(head)`, and the escalation's `reason` by `reason(head)`. Every field that selects or times
 * an event stays valid: `ts`, `layer`, `event`, `system`, `outcome`, `cause` and admission's `kind`.
 *
 * Its `acceptance.history` fills each of L2's five acceptance lists. A revision's `editedAt` times
 * it against the pull and the dispatch windows, so it stays valid on the two revisions a window
 * holds, and is made by `value` on the deleted revision and on the change no window holds, which
 * print it but are timed by nothing. `digest`, `deleted` and `attempt` select and stay valid.
 */
function everyValue(value, reason = value) {
  const [first, second] = [value('r1'), value('r2')];
  const card = 7;
  return [
    event(first, 0, 'L3', 'run.start', { concurrency: value('2') }),
    event(first, 0, 'L3', 'pull', { card, queueDepth: value('3'), kind: value('change') }),
    event(first, 0, 'L3', 'pull', { card: 8, queueDepth: value('1') }),
    event(first, 0, 'L3', 'dispatch', { card, dispatch: value('d3'), role: value('engineer'), attempt: 1 }),
    event(first, 0, 'L1', 'dispatch.start', { dispatch: value('d3') }),
    event(first, 0, 'L3', 'dispatch', { card: 23, dispatch: value('d4'), role: value('architect') }),
    event(first, 0, 'L1', 'dispatch.start', { dispatch: value('d4') }),
    event(first, 1, 'L3', 'dispatch', { card }),
    event(first, 2, 'L1', 'dispatch.end', { dispatch: value('d1'), card, ms: value('5') }),
    event(first, 2, 'L1', 'dispatch.end', { dispatch: value('d3'), card, ms: value('6') }),
    event(first, 3, 'L2', 'review.escalate', { card, category: value('ambiguous'), raiser: value('loop'),
      reason: reason('refused'), destination: value('owner'), class: value('environment') }),
    event(first, 4, 'L2', 'marker.read', { card, role: value('reviewer'), head: value('h1'), digest: 'g1',
      dispatch: value('d2'), reason: value('unmatched') }),
    event(first, 5, 'L2', 'transition', { card: 14, cause: 'merged' }),
    event(first, 6, 'L3', 'admission.open', { id: value('hold-1') }),
    event(first, 7, 'L3', 'admission.close', { kind: 'hold', id: value('hold-1'), reason: value('paused') }),
    event(first, 8, 'L2', 'acceptance.history', { card, opened: { at: at(-10) }, author: value('pm'), revisions: [
      { editedAt: at(0), editor: value('pm'), digest: 'a', items: value('3') },
      { editedAt: at(1), editor: value('engineer'), digest: 'b', items: value('5') },
      { editedAt: value('2026-01-01T00:02:00.000Z'), editor: value('owner'), deleted: true },
      { editedAt: value('2026-01-01T00:03:00.000Z'), editor: value('architect'), digest: 'c' },
    ] }),
    event(first, 8, 'L2', 'acceptance.history', { card: 21, opened: { at: at(1) } }),
    event(first, 8, 'L2', 'acceptance.history', { card: 22, opened: { at: at(-100) } }),
    event(first, 60, 'L0', 'call.end', { system: 'git', outcome: 'ok' }),
    event(second, 61, 'L3', 'pull', { card, queueDepth: value('0') }),
    event(second, 62, 'L3', 'dispatch', { card }),
  ];
}

test('report prints no recorded value on a line of its own, whatever breaks it holds', () => {
  const both = (head) => `${head}\n    card #9, forged\u2028    card #9, forged`;
  const text = printed(everyValue(both, (head) => `${head}\u2028    card #9, forged`));
  const clean = printed(deep(everyValue(both, (head) => `${head}\u2028    card #9, forged`), (each) => each.replace(/[\r\n\u2028\u2029]/g, '')));
  assert.equal(text.split(BREAKS).length, clean.split(BREAKS).length, `the forged stream printed lines of its own:\n${text}`);
  assert.ok(text.includes('queue carried at the pull of card #8: 1\\n'), `the queue value printed no escape:\n${text}`);
  assert.ok(text.includes('flagged merged card #14:'), `the valid merged card was not flagged:\n${text}`);
  for (const [index, card] of [[1, both('7')], [2, [both('8')]], [5, both('23')], [12, [both('14')]], [16, both('21')], [17, both('22')]]) {
    const records = everyValue(both, (head) => `${head}\u2028    card #9, forged`);
    records[index] = { ...records[index], card };
    refused(records, index + 1);
  }
});

/** Rows V1 to V5, V9, V11 and V14: each value the row names, printed raw, holding `br`. */
const RAW_ROWS = [
  ['V1', (br) => [event('r1', 0, 'L3', 'pull', { card: 7, queueDepth: forged('3', br) })],
    (br) => [`    queue carried at the pull of card #7: ${raw('3', br)}`]],
  ['V2', (br) => [event(forged('r1', br), 0, 'L3', 'pull', { card: 7, queueDepth: 0 })],
    (br) => [`  run ${raw('r1', br)}`, `  run ${raw('r1', br)}: from ${at(0)} to ${at(0)}, a span of 0 h`]],
  ['V3', (br) => [event('r1', 0, 'L1', 'dispatch.end', { dispatch: forged('d1', br), card: 7, ms: forged('5', br) })],
    (br) => [`    dispatch ${raw('d1', br)}, card #7: ${raw('5', br)} ms`]],
  ['V4', (br) => [event('r1', 0, 'L3', 'pull', { card: 7 }), event('r1', 1, 'L3', 'dispatch', { card: 7 }),
    event(forged('r2', br), 2, 'L3', 'pull', { card: 7 }), event(forged('r2', br), 3, 'L3', 'dispatch', { card: 7 })],
  (br) => [`    redo after an interruption: card #7, run ${raw('r2', br)}`]],
  ['V5', (br) => [event('r1', 0, 'L2', 'review.escalate', { card: 7, category: forged('ambiguous', br),
    raiser: forged('loop', br), reason: 'refused' })],
  (br) => [`    card #7, category ${raw('ambiguous', br)}, raiser ${raw('loop', br)}: refused`]],
  ['V9', (br) => [event('r1', 0, 'L2', 'marker.read', { card: 7, head: 'h', digest: 'g', role: 'owner' })],
    () => ['        card #7: 1 round']],
  ['V11', (br) => [event('r1', 0, 'L3', 'run.start', { concurrency: forged('2', br) }), event('r1', 60, 'L0', 'call.end', { system: 'git', outcome: 'ok' })],
    (br) => [`    L3 utilization: NaN (0 h from pull to release, over N ${raw('2', br)} x 1 h)`]],
  ['V14', (br) => [event('r1', 0, 'L2', 'transition', { card: 14, cause: 'merged' })],
    () => ['    flagged merged card #14: no qualifying merge decision and later merged end']],
];

test('report prints each raw value from the stream on its row\'s one line, its breaks escaped', async (t) => {
  for (const [row, records, lines] of RAW_ROWS) {
    for (const br of ['\n', '\u2028']) {
      await t.test(`${row} with ${ESCAPED[br]}`, () => {
        const text = printed(records(br));
        for (const line of lines(br)) holdsLine(text, line, `${row} with ${ESCAPED[br]}`);
        if (['V1', 'V3', 'V4', 'V5', 'V9', 'V14'].includes(row)) {
          for (const [index, record] of records(br).entries()) {
            const forgedRecords = records(br);
            forgedRecords[index] = { ...record, card: forged(row === 'V14' ? '14' : '7', br) };
            refused(forgedRecords, index + 1);
          }
        }
      });
    }
  }
});

/** Rows V6, V8, V12, V13, V15 and V16: each value the row names, JSON-quoted, holding `br`. */
const QUOTED_ROWS = [
  ['V6', (br) => [event('r1', 0, 'L2', 'review.escalate', { card: 7, category: 'ambiguous', raiser: 'loop', reason: 'refused',
    destination: forged('owner', br) })],
  (br) => [`    card #7, category ambiguous, raiser loop, destination ${quoted('owner', br)}: refused`]],
  ['V8', (br) => [event('r1', 0, 'L3', 'pull', { card: 7, kind: forged('change', br) }),
    event('r1', 1, 'L2', 'marker.read', { card: 7, head: 'h', digest: 'g', role: 'owner' })],
  (br) => [`      kind ${quoted('change', br)}`]],
  ['V12', (br) => [event('r1', 0, 'L2', 'review.escalate', { card: 7, category: 'ambiguous', raiser: 'loop', reason: 'refused',
    class: forged('environment', br) })],
  (br) => [`    escalations by cause in run "r1": ${quoted('environment', br)} 1`,
    `    escalations by cause across the stream: ${quoted('environment', br)} 1`]],
  ['V13', (br) => [event(forged('r1', br), 0, 'L2', 'review.escalate', { card: 7, category: 'ambiguous', raiser: 'loop', reason: 'refused' })],
    (br) => [`    escalations by cause in run ${quoted('r1', br)}: unclassified 1`]],
  ['V15', (br) => [event(forged('r1', br), 0, 'L3', 'admission.close', { kind: 'hold', id: 'h', reason: 'paused' })],
    (br) => [`  admission holds in run ${quoted('r1', br)}: 1`]],
  ['V16', (br) => [event('r1', 0, 'L3', 'admission.open', { id: forged('hold-1', br) }),
    event('r1', 1, 'L3', 'admission.close', { kind: 'hold', id: forged('hold-1', br), reason: forged('paused', br) })],
  (br) => [`    hold ${quoted('hold-1', br)}: ${quoted('paused', br)}; admission.open ${quoted('hold-1', br)}`]],
];

test('report prints each JSON-quoted value from the stream on its row\'s one line, its separators escaped', async (t) => {
  for (const [row, records, lines] of QUOTED_ROWS) {
    for (const br of ['\u2028', '\u2029']) {
      await t.test(`${row} with ${ESCAPED[br]}`, () => {
        const text = printed(records(br));
        for (const line of lines(br)) holdsLine(text, line, `${row} with ${ESCAPED[br]}`);
      });
    }
  }
});

test('report keeps an escalation reason\'s continuation lines and escapes any other break within one', () => {
  for (const br of ['\u2028', '\r']) {
    const text = printed([event('r1', 0, 'L2', 'review.escalate', { card: 7, category: 'ambiguous', raiser: 'loop',
      reason: `first${br}    card #9, forged\nsecond${br}    card #9, forged` })]);
    const lines = text.split('\n');
    const index = lines.indexOf(`    card #7, category ambiguous, raiser loop: first${ESCAPED[br]}    card #9, forged`);
    assert.notEqual(index, -1, `V7 with ${ESCAPED[br]}: no escalation line in:\n${text}`);
    assert.equal(lines[index + 1], `      second${ESCAPED[br]}    card #9, forged`, `V7 with ${ESCAPED[br]}`);
    holdsLine(text, lines[index], `V7 with ${ESCAPED[br]}`);
  }
});

test('report prints each unmatched marker on one line, whatever breaks its values hold', () => {
  for (const br of ['\n', '\u2028']) {
    const records = [event('r1', 0, 'L2', 'marker.read', { card: 7, role: forged('reviewer', br),
      head: forged('h1', br), digest: 'g', dispatch: forged('d1', br), reason: forged('unmatched', br) })];
    const text = printed(records);
    holdsLine(text, `  card #7, ${raw('reviewer', br)}, head ${raw('h1', br)}, dispatch ${raw('d1', br)}: ${raw('unmatched', br)}`,
      `V10 with ${ESCAPED[br]}`);
    refused([{ ...records[0], card: forged('7', br) }], 1);
  }
});

/** The clean report over `everyValue` with plain values and valid numeric card ids. */
const BASE = [
  'rigger report: the events recorded at <path>',
  'L0',
  '  run r1 "q" \\ $x',
  '    no forge fault rate: no forge call in this run',
  '    git fault rate: 0 (git calls that failed or timed out 0, over git calls 1)',
  '  run r2 "q" \\ $x',
  '    no forge fault rate: no forge call in this run',
  '    no git fault rate: no git call in this run',
  '  across the stream',
  '    no forge fault rate: no forge call in the stream',
  '    git fault rate: 0 (git calls that failed or timed out 0, over git calls 1)',
  'L1',
  '  run r1 "q" \\ $x',
  '    dispatch d1 "q" \\ $x, card #7: 5 "q" \\ $x ms',
  '    dispatch d3 "q" \\ $x, card #7: 6 "q" \\ $x ms',
  '    survivor rate: 0 (dispatches with a survivor or group killed 0, over dispatches that ended with a result 2)',
  '  run r2 "q" \\ $x',
  '    no survivor rate: no dispatch in this run ended with a result',
  '  across the stream',
  '    dispatch.end events: 2, each listed under its run',
  '    survivor rate: 0 (dispatches with a survivor or group killed 0, over dispatches that ended with a result 2)',
  '    redos after an interruption: 1, first attempts: 1',
  '    redo after an interruption: card #7, run r2 "q" \\ $x',
  'L2',
  '  run r1 "q" \\ $x',
  '    host-fault rate: 0 (host faults 0, over work claims 2)',
  '    escalation rate: 0.5 (cards escalated 1, over cards pulled 2)',
  '    card #7, category ambiguous "q" \\ $x, raiser loop "q" \\ $x, destination "owner \\"q\\" \\\\ $x": refused "q" \\ $x',
  '  run r2 "q" \\ $x',
  '    host-fault rate: 0 (host faults 0, over work claims 1)',
  '    escalation rate: 0 (cards escalated 0, over cards pulled 1)',
  '  across the stream',
  '    host-fault rate: 0 (host faults 0, over work claims 3)',
  '    escalation rate: 0.5 (cards escalated 1, over cards pulled 2)',
  '    each escalation is listed under its run',
  '    escalations by cause in run "r1 \\"q\\" \\\\ $x": "environment \\"q\\" \\\\ $x" 1',
  '    infrastructure-caused escalations in run "r1 \\"q\\" \\\\ $x": 0',
  '    escalations by cause across the stream: "environment \\"q\\" \\\\ $x" 1',
  '    infrastructure-caused escalations across the stream: 0',
  '    merges with fresh verdicts: 0 (proved cards 0, over merged cards 1)',
  '    flagged merged card #14: no qualifying merge decision and later merged end',
  '    acceptance changes, each with who made it',
  '      card #7 at "2026-01-01T00:01:00.000Z": editor "engineer \\"q\\" \\\\ $x", dispatch "d3 \\"q\\" \\\\ $x" (role "engineer \\"q\\" \\\\ $x"), dispatch "d4 \\"q\\" \\\\ $x" (role "architect \\"q\\" \\\\ $x")',
  '      card #7 at "2026-01-01T00:03:00.000Z \\"q\\" \\\\ $x": editor "architect \\"q\\" \\\\ $x"',
  '    content deleted from a card\'s history',
  '      card #7 at "2026-01-01T00:02:00.000Z \\"q\\" \\\\ $x": editor "owner \\"q\\" \\\\ $x"',
  '    acceptances that grew after admission',
  '      card #7 at "2026-01-01T00:01:00.000Z": "5 \\"q\\" \\\\ $x" items, over "3 \\"q\\" \\\\ $x" at its first pull',
  '    acceptance changes made during the card\'s maker dispatch',
  '      card #7 at "2026-01-01T00:01:00.000Z"',
  '    each card\'s author',
  '      card #7: "pm \\"q\\" \\\\ $x", as its acceptance.history records',
  '      card #21: roles "engineer \\"q\\" \\\\ $x", "architect \\"q\\" \\\\ $x", whose dispatch windows hold its opening',
  '      card #22: the owner, since no role dispatch window holds its opening',
  '    rounds per card, by kind of work',
  '      kind "change \\"q\\" \\\\ $x"',
  '        card #7: 1 round',
  'L3',
  '  admission holds across the stream: 1',
  '  admission holds in run "r1 \\"q\\" \\\\ $x": 1',
  '    hold "hold-1 \\"q\\" \\\\ $x": "paused \\"q\\" \\\\ $x"; admission.open "hold-1 \\"q\\" \\\\ $x"',
  '  run r1 "q" \\ $x: from 2026-01-01T00:00:00.000Z to 2026-01-01T01:00:00.000Z, a span of 1 h',
  '    L3 throughput: 0 slot releases per hour (0 slot releases over 1 h)',
  '    L3 utilization: NaN (0 h from pull to release, over N 2 "q" \\ $x x 1 h)',
  '    queue carried at the pull of card #7: 3 "q" \\ $x',
  '    queue carried at the pull of card #8: 1 "q" \\ $x',
  '  run r2 "q" \\ $x: from 2026-01-01T01:01:00.000Z to 2026-01-01T01:02:00.000Z, a span of 0.0167 h',
  '    L3 throughput: 0 slot releases per hour (0 slot releases over 0.0167 h)',
  '    the run recorded no N, so L3 has no utilization for it',
  '    queue carried at the pull of card #7: 0 "q" \\ $x',
  'L4',
  '  run r1 "q" \\ $x',
  '    rework: 0',
  '  run r2 "q" \\ $x',
  '    rework: 0',
  '  across the stream',
  '    rework: 0',
  '    no first-pass rate: no card in the stream was judged and merged',
  '    no tier accuracy: no card and role in the stream was dispatched at a tier',
  'markers no dispatch wrote',
  '  card #7, reviewer "q" \\ $x, head h1 "q" \\ $x, dispatch d2 "q" \\ $x: unmatched "q" \\ $x',
  '  only markers L2 recorded in this state directory are named',
  '  markers of role owner are never checked',
].join('\n');

test('report prints a stream with no break, control character or -0 as it did before values were escaped', () => {
  const plain = (head) => `${head} "q" \\ $x`;
  assert.equal(printed(everyValue(plain)), BASE);
});
