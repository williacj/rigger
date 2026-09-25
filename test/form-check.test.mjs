// ABOUTME: Tests L2's acceptance form check: a card with no acceptance is refused, a card whose
// acceptance only restates its title is refused, and every other card is admitted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

// proves R-CARD-8
test('the refusal of a card whose acceptance only restates its title names the card and restated title', () => {
  const card = { number: 518, title: 'Add a verb', body: body('## Acceptance', '', '- Add a verb.') };
  assert.deepEqual(check(card), { admitted: false, card: 518, reason: RESTATED });
});

test('a card with one item that restates the title and one that does not is admitted', () => {
  const card = { number: 14, title: 'Add a verb', body: body('## Acceptance', '', '- Add a verb', '- The verb prints its help.') };
  assert.equal(check(card).admitted, true);
});

/**
 * Every combination of the shapes a qualifying card's Markdown can take: its line ending, the
 * marker and nesting of the one item that does not restate the title, what follows the heading's
 * text, the title, and an HTML comment inside the section. Each card also carries an item that
 * does restate its title, so only the one qualifying item stands between the card and a refusal.
 */
function* qualifyingCards() {
  const endings = ['\n', '\r\n'];
  const markers = ['-', '*', '+'];
  const nestings = ['', '  ', '    ', '\t'];
  const headings = ['## Acceptance', '## Acceptance   ', '## Acceptance\t', '### Acceptance ###'];
  const titles = ['', 'Add a verb'];
  const comments = [[], ['<!-- a note to the maker -->'], ['<!--', '## Notes', '- Add a verb', '-->']];
  for (const ending of endings)
    for (const marker of markers)
      for (const nesting of nestings)
        for (const heading of headings)
          for (const title of titles)
            for (const comment of comments) {
              const lines = [heading, '', `- ${title}`, ...comment, `${nesting}${marker} The verb prints its help.`, '', '## Notes'];
              yield { number: 16, title, body: lines.join(ending) };
            }
}

// proves R-CARD-8
test('any card whose Acceptance heading holds a plain bullet that does not restate its title is not refused', () => {
  let count = 0;
  for (const card of qualifyingCards()) {
    assert.equal(check(card).admitted, true, JSON.stringify(card));
    count += 1;
  }
  assert.equal(count, 2 * 3 * 4 * 4 * 2 * 3);
});

test('an item wrapped onto the lines below its bullet is compared whole', () => {
  for (const wrap of ['  that prints its help.', 'that prints its help.']) {
    const card = { number: 17, title: 'Add a verb', body: body('## Acceptance', '', '- Add a verb', wrap, '- Add a verb.') };
    assert.equal(check(card).admitted, true, JSON.stringify(wrap));
  }
});

test('a numbered or task-list item below a bullet neither counts as an item nor wraps onto it', () => {
  for (const next of ['1. The verb prints its help.', '2) The verb prints its help.', '- [ ] The verb prints its help.']) {
    const card = { number: 18, title: 'Add a verb', body: body('## Acceptance', '', '- Add a verb', next) };
    assert.deepEqual(check(card), { admitted: false, card: 18, reason: RESTATED }, next);
  }
});

test('a thematic break under Acceptance is not an item', () => {
  for (const rule of ['* * *', '- - -', '  -  -  -  ']) {
    const card = { number: 19, title: 'Add a verb', body: body('## Acceptance', '', rule, '', 'Prose.') };
    assert.deepEqual(check(card), { admitted: false, card: 19, reason: MISSING }, rule);
  }
});

test('a fenced code block holds no heading and no item', () => {
  for (const fence of ['```', '~~~', '````']) {
    const inside = { number: 20, title: 'Add a verb', body: body('## Acceptance', '', `${fence}sh`, '# run it', fence, '', '- The verb prints its help.') };
    assert.equal(check(inside).admitted, true, `a comment in a ${fence} block`);
    const only = { number: 21, title: 'Add a verb', body: body('Context.', '', fence, '## Acceptance', '- The verb prints its help.', fence) };
    assert.deepEqual(check(only), { admitted: false, card: 21, reason: MISSING }, `an Acceptance section in a ${fence} block`);
  }
  for (const [open, inner] of [['````', '```'], ['~~~', '```'], ['```', '```sh']]) {
    const card = { number: 22, title: 'Add a verb', body: body(open, inner, '## Acceptance', '- The verb prints its help.', open) };
    assert.deepEqual(check(card), { admitted: false, card: 22, reason: MISSING }, `${inner} does not close ${open}`);
  }
});

test('an Acceptance item that does not restate the title admits a card whose later heading holds bullets that do', () => {
  const card = {
    number: 15,
    title: 'Add a verb',
    body: body('## Acceptance', '', '- The verb prints its help.', '', '## Notes', '', '- Add a verb', '- Add a verb.'),
  };
  assert.equal(check(card).admitted, true);
});

test('the body of issue #182, as gh issue view 182 --json number,title,body returned it on 2026-09-24, passes', () => {
  const card = JSON.parse(readFileSync(new URL('./fixtures/issue-182.json', import.meta.url), 'utf8'));
  assert.equal(card.number, 182);
  assert.deepEqual(check(card), { admitted: true });
});

// Stays last: it reads every result the tests above returned.
test('every refusal the form check returned in these tests carries one of exactly two reasons', () => {
  const refusals = results.filter((result) => !result.admitted);
  assert.ok(refusals.length > 0, 'no test above returned a refusal');
  for (const refusal of refusals) assert.ok([MISSING, RESTATED].includes(refusal.reason), JSON.stringify(refusal));
  assert.deepEqual(new Set(refusals.map((refusal) => refusal.reason)), new Set([MISSING, RESTATED]));
});
