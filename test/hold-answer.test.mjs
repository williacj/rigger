// ABOUTME: Tests L2's two-attempt answer for the host failures in R-FAIL-5.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WORKSPACE_NOT_MADE } from '../src/execution/workspace.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { KINDS, readyCard } from './loop-world.mjs';

const events = [];
const sink = { emitter: () => ({ emit: (event, fields) => events.push({ event, ...fields }) }) };

// proves R-FAIL-5
test('L2 holds a card whose two workspaces cannot be made', () => {
  events.length = 0;
  const firstFailure = { class: 'environment', workspace: '/work/rigger-7', reason: 'git gave no answer' };
  const workspace = { status: 'rejected', reason: Object.assign(new Error('git gave no answer'), { code: WORKSPACE_NOT_MADE, path: '/work/rigger-7' }) };

  const answer = nextAction(readyCard(7), KINDS, undefined, { provisioning: {}, sink, workspace, attempt: 2, firstFailure });

  assert.deepEqual(answer, { action: 'hold', card: 7, firstFailure, failure: firstFailure });
  assert.deepEqual(events.at(-1), { event: 'attempt.decided', attempt: 2, decision: 'hold', failures: [firstFailure, firstFailure] });
});

const FIRST = {
  W: { class: 'environment', workspace: '/work/rigger-7', reason: 'git gave no answer' },
  F: { class: 'environment', workspace: '/work/rigger-7', reason: 'fetch timed out' },
  'N(s)': { class: 'environment', step: 's', reason: 'command never started' },
  'X(s)': { class: 'environment', step: 's', exit: 3 },
  M: { class: 'environment', maker: 'engineer', status: 'rejected', code: NOT_STARTED, reason: 'dispatch never started' },
};

function second(kind) {
  if (kind === 'W' || kind === 'F') {
    const message = kind === 'F' ? 'fetch timed out' : 'git gave no answer';
    return { options: { workspace: { status: 'rejected', reason: Object.assign(new Error(message), { code: WORKSPACE_NOT_MADE, path: '/work/rigger-7' }) } }, failure: { class: 'environment', workspace: '/work/rigger-7', reason: message } };
  }
  if (kind === 'M') return { options: { maker: { status: 'rejected', reason: Object.assign(new Error('dispatch never started'), { code: NOT_STARTED }) } }, failure: FIRST.M };
  const step = kind.endsWith('(t)') ? 't' : 's';
  const never = kind.startsWith('N');
  const outcome = never
    ? { status: 'rejected', reason: Object.assign(new Error('command never started'), { code: NOT_STARTED }) }
    : { status: 'fulfilled', value: { exit: 3, timedOut: false } };
  return {
    kinds: { change: { ...KINDS.change, provisioning: [step] } },
    options: { provisioning: { [step]: { run: 'exit 3', required: true } }, outcomes: [outcome] },
    failure: never ? { class: 'environment', step, reason: 'command never started' } : { class: 'environment', step, exit: 3 },
  };
}

// proves R-FAIL-5
test('L2 answers each in-scope Table A pair by host kind and step', async (t) => {
  const rows = ['W', 'F', 'N(s)', 'X(s)', 'M'];
  const columns = ['W', 'F', 'N(s)', 'N(t)', 'X(s)', 'X(t)', 'M'];
  for (const first of rows) for (const last of columns) {
    if ((first === 'W' && last === 'F') || (first === 'F' && last === 'W')) continue;
    await t.test(`${first} then ${last}`, () => {
      events.length = 0;
      const { kinds = KINDS, options, failure } = second(last);
      const answer = nextAction(readyCard(7), kinds, undefined, { provisioning: {}, sink, attempt: 2, firstFailure: FIRST[first], ...options });
      const same = first === last;
      assert.deepEqual(answer, same
        ? { action: 'hold', card: 7, firstFailure: FIRST[first], failure }
        : { action: 'stop', card: 7, failure });
    });
  }
});

// proves R-FAIL-2
test('L2 refuses a second failed attempt when L3 has not handed it the first failure', () => {
  events.length = 0;
  const { options } = second('M');
  assert.throws(() => nextAction(readyCard(7), KINDS, undefined, { provisioning: {}, sink, attempt: 2, ...options }),
    (failure) => /card #7/.test(failure.message) && /first attempt/.test(failure.message) && /no action/.test(failure.message));
  assert.deepEqual(events, []);
});

// proves R-FAIL-2
test('L2 answers again on attempt one for each host kind with or without an earlier failure', async (t) => {
  for (const kind of ['W', 'F', 'N(s)', 'X(s)', 'M']) for (const earlier of [undefined, FIRST[kind]]) {
    await t.test(`${kind} with ${earlier === undefined ? 'no earlier failure' : 'an earlier failure'}`, () => {
      events.length = 0;
      const { kinds = KINDS, options, failure } = second(kind);
      const answer = nextAction(readyCard(7), kinds, undefined, { provisioning: {}, sink, attempt: 1, firstFailure: earlier, ...options });
      assert.deepEqual(answer, { action: 'again', card: 7, attempt: 2, failure });
      assert.equal(events.at(-1).decision, 'again');
    });
  }
});

// proves R-FAIL-5
test('L2 holds a required step that exits non-zero then runs past its time', () => {
  events.length = 0;
  const firstFailure = FIRST['X(s)'];
  const kinds = { change: { ...KINDS.change, provisioning: ['s'] } };
  const provisioning = { s: { run: 'true', required: true, timeout: 50 } };
  const outcomes = [{ status: 'fulfilled', value: { exit: 143, timedOut: true } }];

  const answer = nextAction(readyCard(7), kinds, undefined, { provisioning, outcomes, sink, attempt: 2, firstFailure });

  assert.deepEqual(answer, { action: 'hold', card: 7, firstFailure, failure: { class: 'environment', step: 's', timeout: 50 } });
});

// proves R-FAIL-5
test('L2 records a hold decision with the attempt and both environment failures and their step', () => {
  events.length = 0;
  const { kinds, options } = second('N(s)');

  nextAction(readyCard(7), kinds, undefined, { provisioning: {}, sink, attempt: 2, firstFailure: FIRST['N(s)'], ...options });

  assert.deepEqual(events.at(-1), { event: 'attempt.decided', attempt: 2, decision: 'hold', failures: [FIRST['N(s)'], FIRST['N(s)']] });
});

// proves R-RECORD-9
test('L2 answers no action with the card and attempt when the sink refuses the hold decision', () => {
  const refusing = { emitter: () => ({ emit: (event) => { if (event === 'attempt.decided') throw new Error('disk full'); } }) };
  const { options } = second('M');

  assert.throws(() => nextAction(readyCard(7), KINDS, undefined, { provisioning: {}, sink: refusing, attempt: 2, firstFailure: FIRST.M, ...options }),
    (failure) => /card #7/.test(failure.message) && /attempt 2/.test(failure.message) && /disk full/.test(failure.message) && /no action/.test(failure.message));
});

// proves R-FAIL-2
test('L2 does not hold a card whose maker starts on the second attempt', () => {
  const answer = nextAction(readyCard(7), KINDS, undefined, { provisioning: {}, sink, attempt: 2, firstFailure: FIRST.W, maker: { status: 'fulfilled', value: { exit: 0 } } });
  assert.deepEqual(answer, { action: 'settled' });
});
