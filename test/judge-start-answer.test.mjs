// ABOUTME: Tests L2's classification and one-claim pairing of judges whose dispatches never start.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { answer, report } from './judge-start-fixture.mjs';
import { HOST_REPORTS } from './judge-start-fixture.mjs';
import { failedAttempt } from '../src/workflow/next-action.mjs';

// The counterexample treats a missing provider CLI as a completed judge or a withheld directory.
// proves R-FAIL-8
test('L2 retries a judge whose provider CLI was not found and classes its first report R2', () => {
  const { next } = answer({ reviewer: report({ kind: 'command-missing', provider: 'claude' }) });
  assert.equal(next.action, 'again');
  assert.equal(next.role, 'reviewer');
  assert.equal(next.failure.class, 'environment');
  assert.equal(next.failure.row, 'R2');
});

// The counterexample retries forever or pairs by message text instead of the provider.
// proves R-FAIL-8
test('L2 holds the same judge after two missing CLI reports for the same provider and records both rows', () => {
  const first = report({ kind: 'command-missing', provider: 'claude' });
  const second = report({ kind: 'command-missing', provider: 'claude' });
  second.reason.message = 'another spelling of the same host failure';
  const { next, events } = answer({ reviewer: second }, { firstFailures: { reviewer: first } });
  assert.equal(next.action, 'hold');
  assert.equal(next.role, 'reviewer');
  const decision = events.find(({ event }) => event === 'attempt.decided');
  assert.equal(decision.decision, 'hold');
  assert.deepEqual(decision.failures.map(({ judge, row, reason }) => [judge, row, reason]), [
    ['reviewer', 'R2', first.reason.message], ['reviewer', 'R2', second.reason.message],
  ]);
});

// The counterexample lets a stopped peer override the card's hold, or decides the precedence in L3.
// proves R-FAIL-8
test('L2 answers a panel hold ahead of a stop in either order without recording either pair twice', () => {
  const first = report({ kind: 'command-missing', provider: 'claude' });
  const hold = answer({ reviewer: first }, { firstFailures: { reviewer: first } }).next;
  const stop = answer({ reviewer: report({ kind: 'command-missing', provider: 'codex' }) }, { firstFailures: { reviewer: first } }).next;
  for (const decisions of [[hold, stop], [stop, hold]]) {
    const result = answer({}, { decisions });
    assert.equal(result.next.action, 'hold');
    assert.equal(result.next, hold);
    assert.deepEqual(result.events, []);
  }
});

// A missing mapping, an identity comparison by message, or an unbounded retry breaks its own row.
// proves R-FAIL-8
test('each host row R2 through R37 retries once and holds the same judge failing the same way', async (t) => {
  assert.equal(HOST_REPORTS.length, 36);
  for (const [row, kind, identity] of HOST_REPORTS) await t.test(row, () => {
    const first = report({ kind, ...identity });
    const second = report({ kind, ...identity });
    second.reason.message = 'a different rendering of the same cause';
    const initial = answer({ reviewer: first }).next;
    assert.equal(initial.action, 'again');
    assert.equal(initial.failure.row, row);
    const held = answer({ reviewer: second }, { firstFailures: { reviewer: first } });
    assert.equal(held.next.action, 'hold');
    assert.equal(held.next.failure.row, row);
    assert.deepEqual(held.events.at(-1).failures.map(({ judge, row: named }) => [judge, named]), [['reviewer', row], ['reviewer', row]]);
  });
});

// A comparator that forgets any counted identity wrongly holds that row for another thing.
// proves R-FAIL-8
test('each of the ten identity-counted rows stops for another provider file path or variable', async (t) => {
  const counted = HOST_REPORTS.filter(([, , identity]) => identity !== undefined);
  assert.equal(counted.length, 10);
  for (const [row, kind, identity] of counted) await t.test(row, () => {
    const [key, value] = Object.entries(identity)[0];
    const first = report({ kind, ...identity });
    const next = report({ kind, [key]: `${value}-another` });
    const result = answer({ reviewer: next }, { firstFailures: { reviewer: first } });
    assert.equal(result.next.action, 'stop');
    assert.equal(result.next.failure.row, row);
    assert.equal(result.events.at(-1).decision, 'stop');
  });
});

// A card-wide counter would pair the first failure of two different judges.
// proves R-FAIL-8
test('another judge with the same cause does not complete the first judge pair', () => {
  const first = { class: 'environment', judge: 'architect', row: 'R29', reason: 'directory unavailable' };
  const second = { ...first, judge: 'reviewer' };
  const events = [];
  const sink = { emitter: () => ({ emit: (event, fields) => events.push({ event, ...fields }) }) };
  const result = failedAttempt({ number: 7 }, 2, first, second, sink);
  assert.equal(result.action, 'stop');
  assert.equal(events.at(-1).decision, 'stop');
});
