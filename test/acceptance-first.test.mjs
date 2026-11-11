// ABOUTME: Proves that plan names each acceptance-form refusal without a pull line for that card.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planInProcess, pulled, refusalOf } from './in-process-entry.mjs';
import { acceptanceBoard, refusalReason } from './acceptance-world.mjs';

/** A literal refusal oracle and valid sibling catch bypassing the form check or refusing everything. */
async function refuses(row) {
  const ran = await planInProcess({ items: acceptanceBoard(row) });
  assert.equal(ran.code, 0, ran.text);
  assert.deepEqual({ pulls: pulled(ran.text), refusal: refusalOf(ran.text, 11) },
    { pulls: [12], refusal: `  refuse  #11  ${refusalReason(row)}` }, ran.text);
}

// proves R-CARD-1
test('acceptance-first: plan C1 refuses a heading inside a fence without a pull line', () => refuses('C1'));

// proves R-CARD-1
test('acceptance-first: plan C2 refuses only task-list items without a pull line', () => refuses('C2'));

// proves R-CARD-1
test('acceptance-first: plan C3 refuses only fenced bullets without a pull line', () => refuses('C3'));

// proves R-CARD-1
test('acceptance-first: plan C4 refuses every item comparing to the title without a pull line', () => refuses('C4'));
