// ABOUTME: Tests L2's acceptance form check on a card's source text: a card with no acceptance is
// refused, a card whose acceptance only restates its title is refused, and every other card is admitted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checkAcceptanceForm } from '../src/workflow/form-check.mjs';

/** The two reasons, as the owner's rulings and the card's acceptance name them. */
const MISSING = 'missing acceptance';
const RESTATED = 'restated title';

/** The title most cases use, and an item that does not restate it. */
const TITLE = 'Add a verb';
const ITEM = 'The verb prints its help.';

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

/** A card titled `TITLE` whose body is these lines. */
const card = (number, ...lines) => ({ number, title: TITLE, body: body(...lines) });

/** Asserts the card is refused for missing acceptance, naming its number. */
function refusedAsMissing(given) {
  assert.deepEqual(check(given), { admitted: false, card: given.number, reason: MISSING });
}

/** Asserts the card is admitted. */
function admitted(given) {
  assert.deepEqual(check(given), { admitted: true });
}

// proves R-CARD-7
test('a card with no acceptance heading outside a fence is refused', () => {
  const result = check(card(1, 'Some context.', '', `- ${ITEM}`));
  assert.equal(result.admitted, false);
});

// proves R-CARD-7
test('the refusal of a card with no acceptance names the card and missing acceptance', () => {
  assert.deepEqual(check(card(412, 'Context, and nothing else.')), { admitted: false, card: 412, reason: MISSING });
});

// proves R-CARD-22
test('an acceptance section holding no plain bullet is missing acceptance', () => {
  refusedAsMissing(card(3, '## Acceptance', '', 'Prose that states what done means.', '', '## Notes', '', `- ${ITEM}`));
});

// proves R-CARD-24, R-CARD-25
test('a section whose only bullets are task-list items is missing acceptance', () => {
  refusedAsMissing(card(4, '## Acceptance', '', `- [ ] ${ITEM}`, `- [x] ${ITEM}`, `- [X] ${ITEM}`));
});

// proves R-CARD-21
test('bullets under Acceptance criteria and under no acceptance heading are missing acceptance', () => {
  refusedAsMissing(card(5, '## Acceptance criteria', '', `- ${ITEM}`));
});

// proves R-CARD-21
test('a card whose only heading is ## acceptance, in lower case, is missing acceptance', () => {
  refusedAsMissing(card(6, '## acceptance', '', `- ${ITEM}`));
});

// proves R-CARD-21
test('a card whose only heading is ## **Acceptance** is missing acceptance', () => {
  refusedAsMissing(card(7, '## **Acceptance**', '', `- ${ITEM}`));
});

// proves R-CARD-19
test('acceptance headings at levels #, ## and ### each holding one item that does not restate the title are admitted', () => {
  for (const marks of ['#', '##', '###']) admitted(card(8, 'Context.', '', `${marks} Acceptance`, '', `- ${ITEM}`));
});

// proves R-CARD-20
test('the heading ## Acceptance ## holding one item that does not restate the title is admitted', () => {
  admitted(card(9, '## Acceptance ##', '', `- ${ITEM}`));
});

test('an item that does not restate the title admits a card whose later ## heading holds bullets that do', () => {
  admitted(card(10, '## Acceptance', '', `- ${ITEM}`, '', '## Notes', '', `- ${TITLE}`, `- ${TITLE}.`));
});

// proves R-CARD-22
test('a deeper ### heading does not end the section, so its bullet that does not restate the title admits the card', () => {
  admitted(card(11, '## Acceptance', '', `- ${TITLE}`, `- ${TITLE}.`, '', '### Notes', '', `- ${ITEM}`));
});

test('a deeper acceptance heading inside a section does not shorten it', () => {
  admitted(card(34, '## Acceptance', '', '### Acceptance', '', `- ${TITLE}`, '', '### Detail', '', `- ${ITEM}`));
});

// proves R-CARD-23
test('a section whose only bullet is indented four spaces is missing acceptance', () => {
  refusedAsMissing(card(12, '## Acceptance', '', `    - ${ITEM}`));
});

// proves R-CARD-14
test('a section whose only bullet is indented by a tab is missing acceptance', () => {
  refusedAsMissing(card(13, '## Acceptance', '', `\t- ${ITEM}`));
});

// proves R-CARD-23
test('a nested bullet indented two spaces that does not restate the title admits the card', () => {
  admitted(card(14, '## Acceptance', '', `  - ${ITEM}`));
});

// proves R-CARD-15
test('an acceptance heading and bullet inside a backtick fence are missing acceptance', () => {
  refusedAsMissing(card(15, 'Context.', '', '```md', '## Acceptance', '', `- ${ITEM}`, '```'));
});

// proves R-CARD-15
test('an acceptance heading and bullet inside a tilde fence are missing acceptance', () => {
  refusedAsMissing(card(16, 'Context.', '', '~~~', '## Acceptance', '', `- ${ITEM}`, '~~~'));
});

// proves R-CARD-17, R-CARD-18
test('a fence the section never closes hides the bullet that follows it', () => {
  refusedAsMissing(card(17, '## Acceptance', '', '```sh', 'rigger plan', '', `- ${ITEM}`));
});

// proves R-CARD-16
test('a fence closes only on a run of at least as many of the same character', () => {
  for (const [open, inner] of [['````', '```'], ['~~~', '```'], ['```', '```sh']]) {
    refusedAsMissing(card(18, 'Context.', '', open, inner, '## Acceptance', `- ${ITEM}`, open));
  }
});

test('a bullet in a blockquote under ## Acceptance is missing acceptance', () => {
  refusedAsMissing(card(19, '## Acceptance', '', `> - ${ITEM}`));
});

test('a heading in a blockquote is no acceptance heading', () => {
  refusedAsMissing(card(20, '> ## Acceptance', '>', `> - ${ITEM}`));
  refusedAsMissing(card(20, '> ## Acceptance', '', `- ${ITEM}`));
});

test('a heading in a list item is no acceptance heading', () => {
  refusedAsMissing(card(21, '- ## Acceptance', '', `  - ${ITEM}`));
});

test('a bullet inside <details> in the section is a plain bullet', () => {
  admitted(card(22, '## Acceptance', '', '<details>', '', `- ${ITEM}`, '', '</details>'));
});

// proves R-CARD-19
test('a setext Acceptance heading underlined with --- is missing acceptance', () => {
  refusedAsMissing(card(23, 'Acceptance', '---', '', `- ${ITEM}`));
});

test('a setext Notes heading underlined with === does not end the section', () => {
  admitted(card(24, '## Acceptance', '', `- ${TITLE}`, '', 'Notes', '=====', '', `- ${ITEM}`));
});

// proves R-CARD-25
test('a section whose only bullet is - followed only by spaces is missing acceptance', () => {
  refusedAsMissing(card(25, '## Acceptance', '', '-   '));
});

test('a section whose only bullet is - <!-- fill in --> is admitted', () => {
  admitted(card(26, '## Acceptance', '', '- <!-- fill in -->'));
});

test('an item linking the title is compared on its source text, URL included', () => {
  admitted(card(27, '## Acceptance', '', `- [${TITLE}](https://example.com)`));
});

test('of two acceptance headings, the second section alone may hold the item that admits the card', () => {
  admitted(card(28, '## Acceptance', '', `- ${TITLE}`, '', '## Notes', '', '## Acceptance', '', `- ${ITEM}`));
});

// proves R-CARD-8
test('a card whose every item matches its title after normalising is refused', () => {
  const given = {
    number: 29,
    title: 'Add the `plan` verb!',
    body: body('## Acceptance', '', '-   add the PLAN verb', '* Add the plan  verb.', '+ ADD THE "PLAN" VERB'),
  };
  assert.equal(check(given).admitted, false);
});

// proves R-CARD-8
test('the refusal of a card whose acceptance only restates its title names the card and restated title', () => {
  assert.deepEqual(check(card(518, '## Acceptance', '', `- ${TITLE}.`)), { admitted: false, card: 518, reason: RESTATED });
});

test('Support C restates the title Support C++, because symbols are deleted', () => {
  const given = { number: 31, title: 'Support C++', body: body('## Acceptance', '', '- Support C') };
  assert.deepEqual(check(given), { admitted: false, card: 31, reason: RESTATED });
});

test('a card with one item that restates the title and one that does not is admitted', () => {
  admitted(card(32, '## Acceptance', '', `- ${TITLE}`, `- ${ITEM}`));
});

/**
 * Every combination of the shapes a qualifying card's source can take: its line ending, the marker
 * and indentation of the one item that does not restate the title, what follows the heading's
 * text, the title, and what else sits in the section. Each card also carries a bullet that does
 * restate its title, so only the one qualifying item stands between the card and a refusal.
 */
function* qualifyingCards() {
  const endings = ['\n', '\r\n'];
  const markers = ['-', '*', '+'];
  const indents = ['', ' ', '  ', '   '];
  const headings = ['# Acceptance', '## Acceptance', '## Acceptance   ', '## Acceptance\t', '### Acceptance ###'];
  const titles = ['', TITLE];
  const others = [[], ['<!-- a note to the maker -->'], ['<!--', `- ${TITLE}`, '-->'], ['```', '## Notes', '```'], ['#### Detail']];
  for (const ending of endings)
    for (const marker of markers)
      for (const indent of indents)
        for (const heading of headings)
          for (const title of titles)
            for (const other of others) {
              const lines = [heading, '', `- ${title}`, ...other, `${indent}${marker} ${ITEM}`, '', '# Notes', '', `- ${title}`];
              yield { number: 33, title, body: lines.join(ending) };
            }
}

// proves R-CARD-8, R-CARD-12, R-CARD-13, R-CARD-19
test('any card whose section holds a plain bullet that does not restate its title is not refused', () => {
  let count = 0;
  for (const given of qualifyingCards()) {
    assert.deepEqual(check(given), { admitted: true }, JSON.stringify(given));
    count += 1;
  }
  assert.equal(count, 2 * 3 * 4 * 5 * 2 * 5);
});

// proves R-CARD-8, R-CARD-13
test('a stray CR or a U+2028 on a heading or bullet line does not hide a qualifying bullet', () => {
  const bodies = {
    'a stray CR after the heading': `## Acceptance\r\r\n\r\n- ${ITEM}\r\n`,
    'a stray CR after the bullet': `## Acceptance\r\n\r\n- ${ITEM}\r\r\n`,
    'U+2028 after the heading': `## Acceptance \n\n- ${ITEM}`,
    'U+2028 inside the bullet': `## Acceptance\n\n- The verb prints its help.`,
  };
  const verdicts = Object.fromEntries(
    Object.entries(bodies).map(([name, text]) => [name, check({ number: 35, title: TITLE, body: text }).admitted]),
  );
  assert.deepEqual(verdicts, Object.fromEntries(Object.keys(bodies).map((name) => [name, true])));
});

test('the body of issue #182, as gh issue view 182 --json number,title,body returned it on 2026-09-24, passes', () => {
  const given = JSON.parse(readFileSync(new URL('./fixtures/issue-182.json', import.meta.url), 'utf8'));
  assert.equal(given.number, 182);
  admitted(given);
});

// Stays last: it reads every result the tests above returned.
test('every refusal the form check returned in these tests carries one of exactly two reasons', () => {
  const refusals = results.filter((result) => !result.admitted);
  assert.ok(refusals.length > 0, 'no test above returned a refusal');
  for (const refusal of refusals) assert.ok([MISSING, RESTATED].includes(refusal.reason), JSON.stringify(refusal));
  assert.deepEqual(new Set(refusals.map((refusal) => refusal.reason)), new Set([MISSING, RESTATED]));
});
