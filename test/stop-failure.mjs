// ABOUTME: Validates the structured two-attempt stop inside a pull or run rejection.

import assert from 'node:assert/strict';

/** The individual failures inside L3's pull or run failure. */
const leaves = (failure) => (failure instanceof AggregateError ? failure.errors.flatMap(leaves) : [failure]);

/** An assert.rejects validator for card `number`'s two-attempt stop. */
export const stoppedCard = (number) => (failure) => {
  const stops = leaves(failure).filter((each) => Array.isArray(each?.attemptFailures));
  assert.equal(stops.length, 1, `expected one stopped card, got ${stops.length}: ${failure?.stack}`);
  const [stop] = stops;
  assert.equal(stop.card, number);
  assert.equal(stop.attemptFailures.length, 2);
  assert.ok(stop.message.startsWith(`card #${number} was stopped after 2 attempts, each failing before the maker:`), stop.message);
  for (const [at, attempt] of stop.attemptFailures.entries()) {
    assert.ok(stop.message.includes(`attempt ${at + 1}: ${JSON.stringify(attempt)}`), stop.message);
  }
  return true;
};
