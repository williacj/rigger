// ABOUTME: Tests report's item-four cause, merge-freshness and admission-hold signals from independent event streams.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { report } from '../src/observation/report.mjs';
import { streamPath } from '../src/observation/sink.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { manualClock } from './clock-report-world.mjs';
import { report as reportVerb } from '../src/cli/report.mjs';
import { repositoryAt, gitIn } from './git-repository.mjs';

/** Records follow ARCHITECTURE.md's envelope; expected signals never come from production helpers. */
function stream(t, events, directory = temporaryDirectory('rigger-item-four-', { context: t })) {
  const clock = manualClock();
  mkdirSync(directory, { recursive: true });
  writeFileSync(streamPath(directory), events.map((event) => JSON.stringify({
    ts: new Date(clock.now()).toISOString(), run: 'r-a', card: null, dispatch: null, ...event,
  })).join('\n') + '\n');
  return directory;
}

const escalation = (card, cause, fields = {}) => ({ layer: 'L2', event: 'review.escalate', card, class: cause,
  category: 'ambiguous', raiser: 'loop', reason: 'a decision, unrelated to the class', ...fields });

// Counting cards instead of events, consulting reasons, or treating every class as infrastructure is wrong.
test('causes count events per run and stream, ignore reason and preserve the distinct-card escalation count', (t) => {
  const events = [
    escalation(7, 'environment'), escalation(7, 'environment'), escalation(8, 'card-local'),
    escalation(9, undefined), escalation(10, 'out'),
    escalation(7, 'environment', { run: 'r-b' }), escalation(11, 'card-local', { run: 'r-b' }),
    escalation(12, 'policy', { run: 'r-b' }),
    escalation(null, 'environment'), escalation(undefined, 'card-local'),
    escalation(99, 'environment', { layer: 'L3' }), escalation(98, 'environment', { event: 'review.waiting' }),
  ];
  const derived = report(stream(t, events));
  assert.ok(derived.l2.escalationCauses, 'report must expose escalation causes');
  assert.deepEqual(derived.l2.escalationCauses, {
    runs: [
      { run: 'r-a', classes: [{ class: 'environment', count: 2 }, { class: 'card-local', count: 1 },
        { class: null, count: 1 }, { class: 'out', count: 1 }], infrastructure: 3 },
      { run: 'r-b', classes: [{ class: 'environment', count: 1 }, { class: 'card-local', count: 1 },
        { class: 'policy', count: 1 }], infrastructure: 2 },
    ],
    stream: { classes: [{ class: 'environment', count: 3 }, { class: 'card-local', count: 2 },
      { class: null, count: 1 }, { class: 'out', count: 1 }, { class: 'policy', count: 1 }], infrastructure: 5 },
  });
  const changedReasons = events.map((event, at) => event.event === 'review.escalate'
    ? { ...event, reason: `environment card-local \"reason\"\n${at} \\ literal` }
    : event);
  assert.equal(changedReasons.length, events.length);
  for (const [at, before] of events.entries()) {
    const after = changedReasons[at];
    if (before.event !== 'review.escalate') {
      assert.deepEqual(after, before, `event ${at + 1} (${before.event}) must be identical`);
    } else {
      const { reason: beforeReason, ...beforeOther } = before;
      const { reason: afterReason, ...afterOther } = after;
      assert.notEqual(afterReason, beforeReason, `event ${at + 1} must change reason`);
      assert.deepEqual(afterOther, beforeOther, `event ${at + 1} changes only reason`);
    }
  }
  assert.deepEqual(report(stream(t, changedReasons)).l2.escalationCauses, derived.l2.escalationCauses);
  assert.deepEqual(report(stream(t, [...events, { layer: 'L2', event: 'unread', run: 'unread-run', card: 7 }])).l2.escalationCauses,
    derived.l2.escalationCauses, 'an unrelated event cannot add a cause run');
  const withoutClass = events.map(({ class: ignored, ...event }) => event);
  const stripped = report(stream(t, withoutClass));
  assert.equal(derived.l2.stream.escalations.escalated, 6, 'the old count is distinct cards');
  assert.deepEqual(stripped.l2.stream.escalations, derived.l2.stream.escalations);
  assert.deepEqual(stripped.l2.runs.map(({ escalations }) => escalations), derived.l2.runs.map(({ escalations }) => escalations));
});

// The consumer must see the three derived signals rather than needing to inspect raw JSONL.
test('the report verb prints causes, fresh-verdict merges and hold ids and reasons from the same stream', async (t) => {
  const consumer = realpathSync.native(repositoryAt(join(temporaryDirectory('rigger-item-four-cli-', { context: t }), 'consumer')));
  const directory = stream(t, [escalation(11, 'card-local'), escalation(12, undefined),
    transition('merged', 21), decision({ card: 21 }), end({ card: 21 }), transition('merged', 22), close(), opened(),
  ], join(consumer, '.rigger'));
  const before = readFileSync(streamPath(directory));
  const answer = await reportVerb({ target: consumer, ask: (command, args) => {
    assert.equal(command, 'git');
    assert.deepEqual(args, ['-C', consumer, 'rev-parse', '--show-toplevel']);
    return { status: 0, stdout: gitIn(consumer, 'rev-parse', '--show-toplevel') };
  } });
  assert.equal(answer.code, 0, answer.text);
  assert.deepEqual(readFileSync(streamPath(directory)), before, 'report must preserve stream bytes');
  const l2 = answer.text.split('\nL2\n')[1].split('\nL3\n')[0];
  const l3 = answer.text.split('\nL3\n')[1].split('\nL4\n')[0];
  assert.ok(l2.includes('escalations by cause across the stream: "card-local" 1, unclassified 1'), l2);
  assert.ok(l2.includes('infrastructure-caused escalations across the stream: 1'), l2);
  assert.ok(l2.includes('escalations by cause in run "r-a": "card-local" 1, unclassified 1'), l2);
  assert.ok(l2.includes('merges with fresh verdicts: 0.5 (proved cards 1, over merged cards 2)'), l2);
  assert.ok(l2.includes('flagged merged card #22: no qualifying merge decision and later merged end'), l2);
  assert.ok(l3.includes('admission holds across the stream: 1'), l3);
  assert.ok(l3.includes('admission holds in run "r-a": 1'), l3);
  assert.ok(l3.includes(`hold ${JSON.stringify(ID)}: ${JSON.stringify(REASON)}; admission.open ${JSON.stringify(ID)}`), l3);
});

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const transition = (cause = 'merged', card = 12) => ({ layer: 'L2', event: 'transition', card, cause });
const decision = (fields = {}) => ({ layer: 'L2', event: 'merge.decided', card: 12, pull: 70, head: HEAD,
  digest: 'c'.repeat(64), judges: [{ role: 'reviewer', verdict: 'sound' }, { role: 'architect', verdict: 'sound' }], ...fields });
const end = (fields = {}) => ({ layer: 'L3', event: 'merge.end', card: 12, head: HEAD, outcome: 'merged', ...fields });

// A merge requires proof for the same card/head in line order; timestamps and other fields cannot repair it.
test('F1-F6: fresh merge proof joins every sound verdict to a later successful end and flags every unproved card', (t) => {
  const flagged = { fresh: 0, of: 1, flagged: [12] };
  const fresh = { fresh: 1, of: 1, flagged: [] };
  for (const [name, events, expected] of [
    ['F1', [transition(), decision(), end()], fresh],
    ['F2', [transition(), end()], flagged],
    ['F3', [transition(), decision({ judges: [{ role: 'reviewer', verdict: 'sound' },
      { role: 'architect', verdict: 'needs revision' }] }), end()], flagged],
    ['F4', [transition(), decision(), end({ head: OTHER_HEAD })], flagged],
    ['F5', [decision(), end(), transition('mergedFromOwner')], fresh],
    ['F6', [transition(), decision(), end({ outcome: 'already merged' })], flagged],
    ['no merged transition', [decision(), end()], { fresh: 0, of: 0, flagged: [] }],
    ['end precedes decision', [end(), decision(), transition()], flagged],
    ['earlier sound head still qualifies', [decision(), decision({ head: OTHER_HEAD }), end(), transition()], fresh],
    ['later unsound decision cannot erase proof', [decision(), decision({ judges: [{ role: 'reviewer', verdict: 'critical' }] }), end(), transition()], fresh],
    ['distinct cards, not transition or end events', [transition(), transition(), decision(), end(), end()], fresh],
    ['two cards cannot join on a shared head', [transition(), transition('merged', 13), decision(), end({ card: 13 })],
      { fresh: 0, of: 2, flagged: [12, 13] }],
    ['wrong layer does not supply a decision', [transition(), decision({ layer: 'L3' }), end()], flagged],
    ['wrong layer does not supply a merge end', [transition(), decision(), end({ layer: 'L2' })], flagged],
  ]) {
    const derived = report(stream(t, events)).l2.stream.freshMerges;
    assert.ok(derived, 'report must expose fresh-verdict merge proof');
    assert.deepEqual(derived, expected, name);
    const unread = events.map((event) => ({ ...event, run: 'other-run', ts: '2025-01-01T00:00:00.000Z',
      pull: 999, digest: 'd'.repeat(64), reason: 'sound: this text is not proof', extra: 'ignored' }));
    unread.push({ layer: 'L2', event: 'unread', card: 12, run: 'unrelated-run', judges: [{ verdict: 'sound' }] });
    assert.deepEqual(report(stream(t, unread)).l2.stream.freshMerges, expected, `${name}: unnamed fields/events`);
  }
});

const ID = 'hold-"literal"\\path\nnext';
const REASON = 'first reason\nsecond "quoted" reason; $value \\n';
const close = (fields = {}) => ({ layer: 'L3', event: 'admission.close', kind: 'hold', id: ID, reason: REASON, ...fields });
const opened = (fields = {}) => ({ layer: 'L3', event: 'admission.open', id: ID, ...fields });
const entry = (isOpen = false) => ({ id: ID, reason: REASON, opened: isOpen });

// Owner pauses are not holds; an open joins across runs solely by id and never changes the count.
test('H1-H4: holds count close events per run and stream and show matching opens without parsing reason text', (t) => {
  for (const [name, events, runs, entries] of [
    ['H1', [close()], [{ run: 'r-a', count: 1, entries: [entry()] }], [entry()]],
    ['H2', [close({ kind: 'owner' })], [{ run: 'r-a', count: 0, entries: [] }], []],
    ['H3', [close(), opened({ run: 'r-open' })], [{ run: 'r-a', count: 1, entries: [entry(true)] }], [entry(true)]],
    ['H4', [close(), close({ run: 'r-b' })], [{ run: 'r-a', count: 1, entries: [entry()] },
      { run: 'r-b', count: 1, entries: [entry()] }], [entry(), entry()]],
    ['wrong-layer close', [close({ layer: 'L2' })], [], []],
    ['wrong-id and wrong-layer opens', [close(), opened({ id: 'another-id' }), opened({ layer: 'L2' })],
      [{ run: 'r-a', count: 1, entries: [entry()] }], [entry()]],
  ]) {
    const derived = report(stream(t, events)).holds;
    assert.ok(derived, 'report must expose admission holds');
    const expected = { runs, stream: { count: entries.length, entries } };
    assert.deepEqual(derived, expected, name);
    const unread = events.map((event) => ({ ...event, card: 99, dispatch: 'ignored', extra: 'ignored',
      ts: '2025-01-01T00:00:00.000Z', ...(event.event === 'admission.open' ? { run: 'ignored-open-run', kind: 'owner', reason: 'ignored' } : {}) }));
    unread.push({ layer: 'L3', event: 'unread', run: 'unrelated-run', id: ID, kind: 'hold' });
    assert.deepEqual(report(stream(t, unread)).holds, expected, `${name}: unnamed fields/events`);
  }
});
