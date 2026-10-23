// ABOUTME: Validates the structured two-attempt hold inside a pull or run rejection.

import assert from 'node:assert/strict';

/** The individual failures inside L3's pull or run failure. */
const leaves = (failure) => (failure instanceof AggregateError ? failure.errors.flatMap(leaves) : [failure]);

/** An assert.rejects validator for card `number`'s two-attempt hold. */
export const heldCard = (number) => (failure) => {
  const holds = leaves(failure).filter((each) => each?.decision === 'hold' && Array.isArray(each.attemptFailures));
  assert.equal(holds.length, 1, `expected one held card, got ${holds.length}: ${failure?.stack}`);
  const [hold] = holds;
  assert.equal(hold.card, number);
  assert.equal(hold.attemptFailures.length, 2);
  assert.ok(hold.message.startsWith(`card #${number} was held after 2 attempts, each failing before the maker:`), hold.message);
  for (const [at, attempt] of hold.attemptFailures.entries()) {
    assert.ok(hold.message.includes(`attempt ${at + 1}: ${JSON.stringify(attempt)}`), hold.message);
  }
  return true;
};
