// ABOUTME: Tests L2 composing a hold's dispatch ids from the outcomes L3 tags with each dispatch's id:
// a step's and a maker's failure carry the id L3 tagged, and a workspace's, which dispatched nothing, none.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WORKSPACE_NOT_MADE } from '../src/execution/workspace.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { KINDS, readyCard } from './loop-world.mjs';

const sink = { emitter: () => ({ emit: () => {} }) };

/** Two dispatch ids, as L3 allocates them. */
const FIRST_ID = 'd-11111111-1111-4111-8111-111111111111';
const SECOND_ID = 'd-22222222-2222-4222-8222-222222222222';

/** A step's outcome that never started, tagged by L3 with dispatch id `dispatch`. */
const neverStarted = (dispatch) => ({ status: 'rejected', reason: Object.assign(new Error('command never started'), { code: NOT_STARTED }), dispatch });

// proves R-SCHED-20
test('a hold for a step that never started twice carries each attempt\'s dispatch id, from the outcome L3 tagged', () => {
  const kinds = { change: { ...KINDS.change, provisioning: ['install'] } };
  const provisioning = { install: { run: 'npm ci', required: true } };
  const first = nextAction(readyCard(7), kinds, undefined, { provisioning, sink, attempt: 1, outcomes: [neverStarted(FIRST_ID)] });

  const held = nextAction(readyCard(7), kinds, undefined, { provisioning, sink, attempt: 2, firstFailure: first.failure, outcomes: [neverStarted(SECOND_ID)] });

  assert.equal(held.action, 'hold');
  assert.deepEqual([held.firstFailure.dispatch, held.failure.dispatch], [FIRST_ID, SECOND_ID]);
});

// proves R-SCHED-20
test('a hold for a maker that never started twice carries each attempt\'s dispatch id', () => {
  const first = nextAction(readyCard(7), KINDS, undefined, { provisioning: {}, sink, attempt: 1, maker: neverStarted(FIRST_ID) });

  const held = nextAction(readyCard(7), KINDS, undefined, { provisioning: {}, sink, attempt: 2, firstFailure: first.failure, maker: neverStarted(SECOND_ID) });

  assert.equal(held.action, 'hold');
  assert.deepEqual([held.firstFailure.dispatch, held.failure.dispatch], [FIRST_ID, SECOND_ID]);
});

// proves R-SCHED-20
test('a hold for two workspaces not made carries no dispatch id, since neither attempt dispatched', () => {
  const workspace = { status: 'rejected', reason: Object.assign(new Error('git gave no answer'), { code: WORKSPACE_NOT_MADE, path: '/work/rigger-7' }) };
  const first = nextAction(readyCard(7), KINDS, undefined, { provisioning: {}, sink, attempt: 1, workspace });

  const held = nextAction(readyCard(7), KINDS, undefined, { provisioning: {}, sink, attempt: 2, firstFailure: first.failure, workspace });

  assert.equal(held.action, 'hold');
  assert.ok(!Object.hasOwn(held.firstFailure, 'dispatch') && !Object.hasOwn(held.failure, 'dispatch'), JSON.stringify(held));
});
