// ABOUTME: Tests L2's two-attempt answer for the host failures in R-FAIL-6.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WORKSPACE_NOT_MADE } from '../src/execution/workspace.mjs';
import { FETCH_FAILED } from '../src/execution/workspace.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { KINDS, readyCard } from './loop-world.mjs';

const events = [];
const sink = { emitter: () => ({ emit: (event, fields) => events.push({ event, ...fields }) }) };

// proves R-FAIL-6
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
  F: { class: 'environment', workspace: '/work/rigger-7', code: FETCH_FAILED, reason: 'fetch timed out' },
  'N(s)': { class: 'environment', step: 's', reason: 'command never started' },
  'X(s)': { class: 'environment', step: 's', exit: 3 },
  M: { class: 'environment', maker: 'engineer', status: 'rejected', code: NOT_STARTED, reason: 'dispatch never started' },
};

function second(kind) {
  if (kind === 'W' || kind === 'F') {
    const message = kind === 'F' ? 'fetch timed out' : 'git gave no answer';
    const code = kind === 'F' ? FETCH_FAILED : WORKSPACE_NOT_MADE;
    return { options: { workspace: { status: 'rejected', reason: Object.assign(new Error(message), { code, path: '/work/rigger-7' }) } }, failure: { class: 'environment', workspace: '/work/rigger-7', ...(kind === 'F' ? { code } : {}), reason: message } };
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

// proves R-FAIL-6
test('L2 answers each in-scope Table A pair by host kind and step', async (t) => {
  const rows = ['W', 'F', 'N(s)', 'X(s)', 'M'];
  const columns = ['W', 'F', 'N(s)', 'N(t)', 'X(s)', 'X(t)', 'M'];
  for (const first of rows) for (const last of columns) {
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

// proves R-FAIL-6
test('L2 holds a required step that exits non-zero then runs past its time', () => {
  events.length = 0;
  const firstFailure = FIRST['X(s)'];
  const kinds = { change: { ...KINDS.change, provisioning: ['s'] } };
  const provisioning = { s: { run: 'true', required: true, timeout: 50 } };
  const outcomes = [{ status: 'fulfilled', value: { exit: 143, timedOut: true } }];

  const answer = nextAction(readyCard(7), kinds, undefined, { provisioning, outcomes, sink, attempt: 2, firstFailure });

  assert.deepEqual(answer, { action: 'hold', card: 7, firstFailure, failure: { class: 'environment', step: 's', timeout: 50 } });
});

// proves R-FAIL-6
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

// proves R-FAIL-6
test('each card-local and out report stops immediately with its own attempt.failed class', async (t) => {
  for (const [code, expected] of [
    ['WORKSPACE_REFUSED', 'card-local'], ['BRANCH_ELSEWHERE', 'card-local'],
    ['SCRATCH_REFUSED', 'card-local'], ['LINE_MOVED', 'out'],
    ['LINE_DELETED', 'out'], ['BRANCH_REFUSED', 'out'], ['ROOT_NOT_ABSOLUTE', 'out'],
  ]) {
    await t.test(code, () => {
      events.length = 0;
      const reason = Object.assign(new Error(`${code} refused`), { code, path: '/work/rigger-7' });
      const outcome = { status: 'rejected', reason };
      const given = code === 'SCRATCH_REFUSED' ? { maker: outcome } : { workspace: outcome };
      const answer = nextAction(readyCard(7), KINDS, undefined, { provisioning: {}, sink, attempt: 1, ...given });
      assert.equal(answer.action, 'stop');
      assert.equal(answer.failure.class, expected);
      assert.equal(answer.failure.code, code);
      assert.deepEqual(events.map(({ event, attempt, class: named, decision }) => [event, attempt, named, decision]), [
        ['attempt.failed', 1, expected, undefined], ['attempt.decided', 1, undefined, 'stop'],
      ]);
    });
  }
});

// proves R-FAIL-6
test('a card-local refusal or moved line stops on attempt two after itself or a host failure', async (t) => {
  for (const code of ['WORKSPACE_REFUSED', 'SCRATCH_REFUSED', 'LINE_MOVED']) {
    for (const first of [code, 'host']) {
      await t.test(`${first} then ${code}`, () => {
        events.length = 0;
        const reason = Object.assign(new Error(`${code} refused`), { code, path: '/work/rigger-7' });
        const given = code === 'SCRATCH_REFUSED' ? { maker: { status: 'rejected', reason } } : { workspace: { status: 'rejected', reason } };
        const firstFailure = first === 'host' ? FIRST.W : {
          class: code === 'LINE_MOVED' ? 'out' : 'card-local',
          ...(code === 'SCRATCH_REFUSED' ? { maker: 'engineer', status: 'rejected' } : { workspace: '/work/rigger-7' }),
          code, reason: reason.message,
        };
        const answer = nextAction(readyCard(7), KINDS, undefined, { provisioning: {}, sink, attempt: 2, firstFailure, ...given });
        assert.equal(answer.action, 'stop');
        assert.equal(events.at(-1).decision, 'stop');
      });
    }
  }
});

// proves R-FAIL-6
test('an unanswered maker scratch check and a maker dispatch that never started hold as one host way in either order', () => {
  const scratch = { class: 'environment', maker: 'engineer', status: 'rejected', code: NOT_STARTED, reason: 'scratch check gave no answer' };
  const dispatch = FIRST.M;
  for (const [firstFailure, last] of [[scratch, dispatch], [dispatch, scratch]]) {
    events.length = 0;
    const maker = { status: 'rejected', reason: Object.assign(new Error(last.reason), { code: NOT_STARTED }) };
    const answer = nextAction(readyCard(7), KINDS, undefined, { provisioning: {}, sink, attempt: 2, firstFailure, maker });
    assert.equal(answer.action, 'hold');
    assert.equal(answer.failure.class, 'environment');
    assert.equal(events.at(-1).decision, 'hold');
  }
});
