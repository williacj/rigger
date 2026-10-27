// ABOUTME: The test file whose recorded event streams exercise the receipt's parse; the
// RIGGER_RECEIPT_EVENTS shape it is run under decides what the stream shows, and unset it passes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const shape = process.env.RIGGER_RECEIPT_EVENTS;
if (shape === 'load') throw new Error('the subject failed to load');
const value = shape === 'mutant' ? 2 : 1;

test('value stays one', () => assert.equal(value, 1, 'value must stay one'));
test('subject.mjs', () => assert.equal(value, 1, 'a test titled after its file'));
test('outer', async (t) => {
  await t.test('inner', () => assert.equal(value, 1, 'the subtest sees one'));
});
test('constant holds', { skip: shape === 'skip' }, () => assert.equal(6 * 7, 42));
if (shape === 'after') setImmediate(() => { throw new Error('thrown after the tests'); });
