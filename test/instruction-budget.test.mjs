// ABOUTME: Tests the instruction-file word budget check: what counts as a word, where the number
// ABOUTME: comes from, and which files are weighed together.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  check,
  countWords,
  instructionBudget,
  instructionFiles,
} from '../scripts/instruction-budget.mjs';

test('words are what whitespace separates', () => {
  assert.equal(countWords('Rules for every session in this repository.'), 7);
});

test('a standalone em dash is a word, where GNU wc -w would not count one', () => {
  // The count and `wc -w` disagree by exactly the punctuation tokens these files are written
  // with, and the budget is enforced against this one. Pinned so the disagreement stays a
  // stated choice rather than something a later reader mistakes for a bug and "fixes".
  assert.equal(countWords('Honest disagreement — beats fake consensus'), 6);
});

test('blank lines and runs of whitespace add nothing', () => {
  assert.equal(countWords('\n\n  one   two  \n\n three \n'), 3);
});

test('an empty file spends nothing', () => {
  assert.equal(countWords('\n   \n'), 0);
});

test('the budget is read from the architecture, not typed here', () => {
  const architecture = 'Instruction files carry one budget of their own. The budget is 2,000 words.';
  assert.equal(instructionBudget(architecture), 2000);
});

test('an architecture stating no word budget fails rather than guessing', () => {
  assert.throws(() => instructionBudget('Instruction files carry one budget.'), /instruction/i);
});

test('the root instruction file and every nested one are weighed together', () => {
  const root = mkdtempSync(join(tmpdir(), 'rigger-words-'));
  mkdirSync(join(root, 'src', 'execution'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), 'root\n');
  writeFileSync(join(root, 'src', 'execution', 'AGENTS.md'), 'nested\n');
  writeFileSync(join(root, 'src', 'execution', 'run.mjs'), 'not an instruction file\n');

  assert.deepEqual(instructionFiles(root), [
    join(root, 'AGENTS.md'),
    join(root, 'src', 'execution', 'AGENTS.md'),
  ]);
});

test('moving text from the root file into a nested one spends nothing', () => {
  // Both totals are hand-counted rather than compared to each other: two sides that both ask
  // the production code for the answer agree whatever it says, and a check that dropped every
  // nested file would still pass. Three words are three words, wherever they are written.
  const total = (rootFile, nestedFile) => {
    const root = mkdtempSync(join(tmpdir(), 'rigger-words-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'ARCHITECTURE.md'), 'The budget is 2,000 words. Live instruction pool budget is 13,000 words.\n');
    writeFileSync(join(root, 'AGENTS.md'), rootFile);
    writeFileSync(join(root, 'src', 'AGENTS.md'), nestedFile);
    return check(root).total;
  };

  assert.equal(total('one two three', ''), 3);
  assert.equal(total('one two', 'three'), 3);
});
