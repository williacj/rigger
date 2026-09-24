// ABOUTME: Holds this repository to its own statement of what a mutation claim must show: the
// bar the tdd skill states, and the judge's lens that sends a reader to it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** One skill as this repository holds it. `templates/` is the same bytes — `init` refuses a divergence. */
function skill(name) {
  return readFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), 'utf8');
}

/** The text under one `## ` heading, the heading line excluded and the next heading not included. */
function section(text, heading) {
  const after = text.split(new RegExp(`^## ${heading}\\s*$`, 'm'))[1];
  assert.ok(after !== undefined, `no \`## ${heading}\` section`);
  return after.split(/^## /m)[0];
}

/** The bolded opener of each numbered item in a section: `1. **Name.** body` yields `Name.`. */
function numberedItems(text) {
  return [...text.matchAll(/^\d+\. \*\*(.+?)\*\*/gm)].map((found) => found[1]);
}

// What the bar has to require, named rather than quoted. Each name is a term the skill defines,
// so its body can be reworded freely and dropping a requirement is what reds. The two the card
// this test came from recorded are the first and the third: a replacement that silently did not
// apply, and one that applied and broke the file.
const REQUIRED = [
  'The anchor was there.',
  'The replacement landed.',
  'The mutant still runs.',
  'The mutation did what it meant.',
  'The report names the tests and the assertions.',
  'The original is back.',
  'A failed guard exits non-zero.',
];

test('the tdd skill states that a mutation is evidence only once it is shown to have applied', () => {
  // The break this catches: a later edit trims the section, or drops one of the requirements,
  // and mutation claims go back to being the unguarded measurement that reports either answer.
  const bar = section(skill('tdd'), 'A mutation claim');

  assert.match(bar, /shown to have applied/);
  assert.deepEqual(numberedItems(bar).sort(), [...REQUIRED].sort());
});

test('the judge\'s test-first lens sends a mutation claim to that bar', () => {
  // The other half. A maker loads the tdd skill before its first test body and a judge does not,
  // so the lens is what reaches a judge ruling on an item a mutation claim stands behind. The
  // break: the pointer goes, and the statement stops reaching the role that reads the claim.
  const lens = section(skill('code-review'), 'The lenses');
  const bullets = lens.split(/\n(?=- \*\*)/).filter((bullet) => /mutation/.test(bullet));

  assert.notEqual(bullets.length, 0, 'the lenses name no mutation claim');
  for (const bullet of bullets) assert.match(bullet, /`tdd` skill/, bullet);
});
