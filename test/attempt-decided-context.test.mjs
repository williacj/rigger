// ABOUTME: Tests the recorded dispatch context of every attempt decision in card #1074's Table A.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { SCRATCH_REFUSED, WORKSPACE_NOT_MADE, WORKSPACE_REFUSED } from '../src/execution/workspace.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { answer as judgeAnswer, report } from './judge-start-fixture.mjs';
import { KINDS, readyCard } from './loop-world.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const FIRST = 'd-11111111-1111-4111-8111-111111111111';
const SECOND = 'd-22222222-2222-4222-8222-222222222222';

/** L1's never-started contract, as the shared judge fixture records it, tagged by L3. */
const neverStarted = (dispatch) => ({ ...report({ kind: 'command-missing', provider: 'claude' }), dispatch });

/** L1's workspace rejection contract, which allocates no dispatch. */
const workspace = (code = WORKSPACE_NOT_MADE) => ({
  workspace: { status: 'rejected', reason: Object.assign(new Error('workspace unavailable'), { code, path: '/work/rigger-7' }) },
});

/** The real JSONL sink preserves context separately from the event's own fields. */
function recording() {
  const directory = temporaryDirectory('rigger-attempt-context-');
  return { directory, sink: openSink({ directory, run: 'r-attempt-context', now: () => 0 }) };
}

const decide = (here, options, kinds = KINDS) => nextAction(readyCard(7), kinds, undefined, { provisioning: {}, sink: here.sink, ...options });

/** Check the latest adjacent pair, so an earlier decision cannot mask the decision under test. */
function recordedPair(here, decision, dispatch, attempt = 1) {
  const events = readEvents(here.directory);
  assert.equal(events.length, attempt * 2, 'one failure and decision per attempt');
  const [failed, decided] = events.slice(-2);
  assert.deepEqual([failed.event, decided.event], ['attempt.failed', 'attempt.decided']);
  assert.equal(decided.decision, decision);
  for (const event of [failed, decided]) {
    assert.equal(event.card, 7);
    assert.equal(event.layer, 'L2');
    assert.equal(event.attempt, attempt);
    if (dispatch === undefined) assert.equal(Object.hasOwn(event, 'dispatch'), false, `${event.event} has no dispatch key`);
    else assert.equal(event.dispatch, dispatch, `${event.event} dispatch`);
  }
  assert.equal(decided.dispatch, failed.dispatch, 'decision and preceding failure have the same dispatch');
  assert.equal(Object.hasOwn(decided, 'dispatch'), Object.hasOwn(failed, 'dispatch'), 'decision and failure have the same dispatch presence');
}

// Dropping context, reusing the first dispatch on a hold, or inventing a workspace dispatch breaks its row.
// proves R-RECORD-7
test('attempt.decided records its preceding failure dispatch or absence for every Table A decision', async (t) => {
  const stepKinds = { change: { ...KINDS.change, provisioning: ['install'] } };
  const provisioning = { install: { run: 'npm ci', required: true, timeout: 50 } };
  const rows = [
    ['maker never started', (dispatch) => ({ maker: neverStarted(dispatch) }), KINDS, true],
    ['step never started', (dispatch) => ({ provisioning, outcomes: [neverStarted(dispatch)] }), stepKinds, true],
    ['step exited nonzero', (dispatch) => ({ provisioning, outcomes: [{ status: 'fulfilled', value: { exit: 3, timedOut: false }, dispatch }] }), stepKinds, true],
    ['step timed out', (dispatch) => ({ provisioning, outcomes: [{ status: 'fulfilled', value: { exit: 143, timedOut: true }, dispatch }] }), stepKinds, true],
    ['workspace not made', () => workspace(), KINDS, false],
  ];
  for (const [name, options, kinds, dispatched] of rows) for (const decision of ['again', 'hold', 'stop']) {
    await t.test(`${name}: ${decision}`, () => {
      const here = recording();
      if (decision === 'again') {
        assert.equal(decide(here, options(FIRST), kinds).action, 'again');
        recordedPair(here, decision, dispatched ? FIRST : undefined);
        return;
      }
      // A different failure kind forces stop; the same kind forces hold. The ids stay distinct.
      const earlier = decision === 'hold' ? options(FIRST) : dispatched ? workspace() : { maker: neverStarted(FIRST) };
      const first = decide(here, earlier, kinds);
      assert.equal(first.action, 'again');
      const next = decide(here, { ...options(SECOND), attempt: 2, firstFailure: first.failure }, kinds);
      assert.equal(next.action, decision);
      recordedPair(here, decision, dispatched ? SECOND : undefined, 2);
    });
  }
  await t.test('maker scratch refused: escalate', () => {
    const here = recording();
    const maker = neverStarted(FIRST);
    maker.reason.code = SCRATCH_REFUSED;
    assert.equal(decide(here, { maker }).action, 'escalate');
    recordedPair(here, 'escalate', FIRST);
  });
  await t.test('workspace refused: escalate', () => {
    const here = recording();
    assert.equal(decide(here, workspace(WORKSPACE_REFUSED)).action, 'escalate');
    recordedPair(here, 'escalate', undefined);
  });
  for (const decision of ['again', 'hold', 'stop']) await t.test(`judge never started: ${decision}`, () => {
    const here = recording();
    // These reports enter judgeAnswer's classification and its real failedAttempt call.
    const first = { ...report({ kind: 'command-missing', provider: decision === 'stop' ? 'codex' : 'claude' }), dispatch: FIRST };
    const initial = judgeAnswer({ reviewer: first }, { sink: here.sink }).next;
    assert.equal(initial.action, 'again');
    if (decision === 'again') {
      recordedPair(here, decision, FIRST);
      return;
    }
    const second = neverStarted(SECOND);
    const next = judgeAnswer({ reviewer: second }, { firstFailures: { reviewer: first }, sink: here.sink }).next;
    assert.equal(next.action, decision);
    recordedPair(here, decision, SECOND, 2);
  });
});
