// ABOUTME: What the tests of L5's telemetry push share: the check that a `push.end` holds each field
// where "The outcome" says it does, and what a git trace shows of a push.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { DATA_REF } from '../src/substrate/data-ref.mjs';

/**
 * Asserts `event` is a `push.end` as "The outcome" gives it, for the push whose side answered
 * `answered`: under `layer: 'L5'`, with no card and `dispatch: null`, `ref` the data ref's name
 * `data-ref.mjs` exports, and each field present exactly where the table holds it.
 */
export function assertPushEnd(event, answered) {
  assert.equal(event.event, 'push.end');
  assert.equal(event.layer, 'L5');
  assert.equal(event.dispatch, null);
  assert.equal(Object.hasOwn(event, 'card'), false, 'push.end carries a card');
  assert.equal(event.ref, DATA_REF);
  assert.equal(event.ref, 'refs/rigger/events');
  assert.equal(event.outcome, answered.outcome);
  assert.ok(Number.isInteger(event.ms) && event.ms >= 0, `ms ${event.ms}`);
  const expected = ['ts', 'run', 'layer', 'event', 'dispatch', 'ref', 'outcome', 'ms'];
  if (Object.hasOwn(answered, 'bytes')) expected.push('bytes');
  if (Object.hasOwn(answered, 'parent')) expected.push('parent');
  if (event.outcome === 'pushed') expected.push('commit');
  else expected.push('reason');
  assert.deepEqual(Object.keys(event).sort(), expected.sort());
  for (const field of ['bytes', 'parent', 'commit', 'reason']) {
    if (Object.hasOwn(event, field)) assert.equal(event[field], answered[field], field);
  }
  if (event.outcome === 'pushed') assert.match(event.commit, /^[0-9a-f]{40}$/);
  else assert.equal(typeof event.reason, 'string');
}

/** `bytes` up to and including its last newline, as "The commit" holds the stream. */
export const held = (bytes) => bytes.subarray(0, bytes.lastIndexOf(0x0a) + 1);

/**
 * The lines of the git trace at `path`, which `GIT_TRACE` names, that name the data ref or the push's
 * own remote: what a push side that was reached leaves there. None where git traced nothing.
 */
export const pushTraced = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [])
  .filter((line) => line.includes(DATA_REF) || line.includes('rigger-data-push'));
