// ABOUTME: Tests spec-style-lint: where its ceiling and its ruled-out terms come from, what it
// ABOUTME: reads, what it declines to say, and that the current corpus passes it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ruledOutTerms, sentenceCeiling } from '../scripts/spec-style-lint.mjs';

// A skill shaped like the real one, written out here so each expectation below is derived from
// the form the lint reads rather than from whatever the corpus happens to say today.
const SKILL = [
  '### 1. One term per concept',
  '',
  'A card is **escalated** — never bubbled, parked or forwarded.',
  'A judge returns a **verdict**, never an approval or a sign-off.',
  'The converse binds as hard: where two words name two things, never collapse them.',
  '',
  '### 2. Sentences of about 25 words, and never past 40',
  '',
  'Split a compound, and never nest an aside.',
].join('\n');

test('the sentence ceiling is read from the skill, not typed into the lint', () => {
  const skill = '### 2. Sentences of about 25 words, and never past 40\n';
  assert.equal(sentenceCeiling(skill), 40);
});

test('the ruled-out terms are read from the skill, not typed into the lint', () => {
  assert.deepEqual(
    [...ruledOutTerms(SKILL)].sort(),
    ['approval', 'bubbled', 'forwarded', 'parked', 'sign-off'],
  );
});

test('only the one-term rule supplies terms, so a `never` elsewhere in the skill supplies none', () => {
  // Rule 2 forbids nesting an aside, which is not a word the corpus may not use.
  assert.ok(!ruledOutTerms(SKILL).has('nest'));
});

test('a prohibition that is a phrase rather than a term supplies nothing', () => {
  // "never collapse them" rules out an act, not a spelling, and a lint that read it as a term
  // would fail every document using the word `collapse`.
  assert.ok(!ruledOutTerms(SKILL).has('collapse'));
});
