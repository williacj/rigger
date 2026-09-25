// ABOUTME: Tests L2's acceptance form check: a card with no acceptance is refused, a card whose
// acceptance only restates its title is refused, and every other card is admitted.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkAcceptanceForm } from '../src/workflow/form-check.mjs';

/** The two reasons, as the owner's rulings and the card's acceptance name them. */
const MISSING = 'missing acceptance';
const RESTATED = 'restated title';

/** Every result the form check returned in this file, so the last test can read every refusal. */
const results = [];

/** The form check over one card, its result kept for the test that reads every refusal. */
function check(card) {
  const result = checkAcceptanceForm(card);
  results.push(result);
  return result;
}

/** A card body built from lines, so a fixture reads as the Markdown it is. */
const body = (...lines) => lines.join('\n');

// proves R-CARD-7
test('a card with no heading named exactly Acceptance is refused', () => {
  const result = check({ number: 7, title: 'Add a verb', body: body('Some context.', '', '- a bullet with no heading') });
  assert.equal(result.admitted, false);
});

// proves R-CARD-7
test('the refusal of a card with no acceptance names the card and missing acceptance', () => {
  const result = check({ number: 412, title: 'Add a verb', body: 'Context, and nothing else.' });
  assert.deepEqual(result, { admitted: false, card: 412, reason: MISSING });
});

test('an Acceptance heading with no plain bullet before the next heading is missing acceptance', () => {
  const card = {
    number: 9,
    title: 'Add a verb',
    body: body('## Acceptance', '', 'Prose that states what done means.', '', '## Notes', '', '- a bullet under another heading'),
  };
  assert.deepEqual(check(card), { admitted: false, card: 9, reason: MISSING });
});

test('an Acceptance heading holding only task-list items is missing acceptance', () => {
  const card = {
    number: 10,
    title: 'Add a verb',
    body: body('## Acceptance', '', '- [ ] The verb prints its help.', '- [x] The verb exits 0.', '- [X] The verb is documented.'),
  };
  assert.deepEqual(check(card), { admitted: false, card: 10, reason: MISSING });
});

test('bullets under Acceptance criteria, with no heading named exactly Acceptance, are missing acceptance', () => {
  const card = {
    number: 11,
    title: 'Add a verb',
    body: body('## Acceptance criteria', '', '- The verb prints its help.', '', '## Acceptance notes', '', '- The verb exits 0.'),
  };
  assert.deepEqual(check(card), { admitted: false, card: 11, reason: MISSING });
});

test('an Acceptance heading at level #, ## or ### holding one item that does not restate the title is admitted', () => {
  for (const marks of ['#', '##', '###']) {
    const card = { number: 12, title: 'Add a verb', body: body('Context.', '', `${marks} Acceptance`, '', '- The verb prints its help.') };
    assert.equal(check(card).admitted, true, `level ${marks}`);
  }
});

// proves R-CARD-8
test('a card whose every item matches its title after normalising is refused', () => {
  const card = {
    number: 13,
    title: 'Add the `plan` verb!',
    body: body('## Acceptance', '', '-   add the PLAN verb', '* Add the plan  verb.', '+ ADD THE "PLAN" VERB'),
  };
  assert.equal(check(card).admitted, false);
});
