// ABOUTME: Tests the forge write sides' shared mark, called in process: a write call's refused event
// marked made where its result passes the side's check, and the mark's carry through a rewrap.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { carried, written } from '../src/substrate/forge/write-made.mjs';
import { refusedCall } from './write-made-fixtures.mjs';

/** A check that answers the parsed comment, as a REST side's would, and records what it was handed. */
function checking(seen) {
  return (said) => {
    seen.push(said);
    if (said.status !== 0 || said.timedOut) throw new Error('not made');
    return JSON.parse(said.stdout);
  };
}

test('a write call that resolves answers what it resolved with, and its check is never run', async () => {
  const seen = [];
  const said = { status: 0, timedOut: false, stdout: '{"id":1}', stderr: '' };

  assert.equal(await written(Promise.resolve(said), checking(seen)), said);
  assert.deepEqual(seen, []);
});

test('a write call rejecting with EVENT_REFUSED whose result passes the side\'s check is marked made, carrying the check\'s answer, and the check reads the result as text', async () => {
  const seen = [];
  const refusal = refusedCall({ id: 7, html_url: 'https://github.com/o/r/pull/3#issuecomment-7' });

  const thrown = await written(Promise.reject(refusal), checking(seen)).catch((error) => error);

  assert.equal(thrown, refusal);
  assert.deepEqual(thrown.made, { answer: { id: 7, html_url: 'https://github.com/o/r/pull/3#issuecomment-7' } });
  assert.deepEqual(seen, [{ status: 0, timedOut: false, stdout: '{"id":7,"html_url":"https://github.com/o/r/pull/3#issuecomment-7"}', stderr: '' }]);
});

test('a write call rejecting with EVENT_REFUSED whose result fails the side\'s check, or with no result, or with another failure, is left unmarked', async () => {
  for (const refusal of [
    refusedCall({ id: 7 }, { exit: 1 }),
    refusedCall({ id: 7 }, { timedOut: true }),
    refusedCall('not json'),
    Object.assign(refusedCall({ id: 7 }), { result: undefined }),
    Object.assign(new Error('gh: not found'), { code: 'NOT_STARTED' }),
  ]) {
    const thrown = await written(Promise.reject(refusal), checking([])).catch((error) => error);
    assert.equal(thrown, refusal);
    assert.equal('made' in thrown, false, thrown.message);
  }
});

test('a rewrap carries the original failure\'s code, result, unrecorded events and mark, and leaves what the original lacks unset', () => {
  const original = Object.assign(refusedCall({ id: 7 }), { made: { answer: { id: 7 } } });
  const rewrapped = carried(new Error('postComment on pull request #3 failed', { cause: original }), original);

  assert.equal(rewrapped.code, original.code);
  assert.equal(rewrapped.result, original.result);
  assert.equal(rewrapped.unrecorded, original.unrecorded);
  assert.equal(rewrapped.made, original.made);

  const plain = carried(new Error('wrapped'), new Error('gh exited 1'));
  assert.deepEqual(['code', 'result', 'unrecorded', 'made'].filter((key) => key in plain), []);
});
