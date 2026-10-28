// ABOUTME: Tests L2's status-issue module: the title, body and comment a hold's notice writes, and the
// hold's id parsed back from them, and none from text that names no hold's id.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TITLE, holdBody, holdComment, holdOf } from '../src/workflow/status-issue.mjs';

/** L2's hold answer for card #9, as `next-action` answers it after two attempts whose step never started. */
const HOLD = {
  action: 'hold',
  card: 9,
  firstFailure: { class: 'environment', step: 'install', reason: 'spawn npm ENOENT', dispatch: 'd-11111111-1111-4111-8111-111111111111' },
  failure: { class: 'environment', step: 'install', reason: 'spawn npm ENOENT', dispatch: 'd-22222222-2222-4222-8222-222222222222' },
};

/** The closer's reason, as L3 writes it for that hold. */
const REASON = 'card #9 was held after two failures the same way';

// proves R-SCHED-20
test('the status issue\'s title is exactly Rigger closed admission', () => {
  assert.equal(TITLE, 'Rigger closed admission');
});

// proves R-SCHED-20
test('a hold-time body names the reason, links the failing card, names each attempt\'s class and step, both dispatch ids, the run, the admission path and the hold\'s id', () => {
  const body = holdBody({ id: 'a1', reason: REASON, run: 'r-1', hold: HOLD, admission: '/work/.rigger/admission' });

  for (const named of [REASON, '#9', 'Attempt 1: environment, step `install`', 'Attempt 2: environment, step `install`', 'd-11111111-1111-4111-8111-111111111111', 'd-22222222-2222-4222-8222-222222222222', 'r-1', '/work/.rigger/admission', '`a1`']) {
    assert.ok(body.includes(named), `the body does not name ${named}:\n${body}`);
  }
  assert.equal(holdOf(body), 'a1');
});

// proves R-SCHED-20
test('a hold from two workspace-make failures, which recorded no dispatch, names no dispatch id', () => {
  const unmade = { class: 'environment', workspace: '/nowhere/rigger-9', reason: 'git did not answer' };
  const body = holdBody({ id: 'a1', reason: REASON, run: 'r-1', hold: { action: 'hold', card: 9, firstFailure: unmade, failure: unmade }, admission: '/work/.rigger/admission' });

  assert.ok(body.includes('Attempt 1: environment, workspace'), body);
  assert.ok(!/dispatch/i.test(body), `the body names a dispatch:\n${body}`);
  assert.ok(!/d-[0-9a-f]{8}-/.test(body), body);
});

// proves R-SCHED-20
test('a later-trigger body, from the closer alone, names the closer\'s reason, its run and the hold\'s id', () => {
  const body = holdBody({ id: 'b7', reason: REASON, run: 'r-earlier' });

  for (const named of [REASON, 'Run: r-earlier', 'Hold: `b7`']) assert.ok(body.includes(named), `the body does not name ${named}:\n${body}`);
  assert.equal(holdOf(body), 'b7');
});

// proves R-SCHED-25
test('the comment names the reason, the failing card and the hold\'s id, and its hold\'s id parses back', () => {
  const comment = holdComment({ id: 'c3', reason: REASON, card: 9 });

  for (const named of [REASON, '#9', 'Hold: `c3`']) assert.ok(comment.includes(named), `the comment does not name ${named}:\n${comment}`);
  assert.equal(holdOf(comment), 'c3');
});

// proves R-SCHED-20
test('the module answers none for a body or comment that names no hold\'s id', () => {
  for (const text of ['', 'Rigger closed admission: card #9 was held', 'Hold: a1', 'Hold: `A-1`', 'see Hold: `a1` above', null]) {
    assert.equal(holdOf(text), null, JSON.stringify(text));
  }
});
