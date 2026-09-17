// ABOUTME: Tests the instruction-file word budget check: what counts as a word, where the number
// ABOUTME: comes from, and which files are weighed together.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  countWords,
  instructionBudget,
  instructionFiles,
} from '../scripts/instruction-budget.mjs';

test('words are what whitespace separates', () => {
  assert.equal(countWords('Rules for every session in this repository.'), 7);
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

test('moving text from the root file into a nested one changes nothing', () => {
  const together = (a, b) => countWords(a) + countWords(b);
  assert.equal(together('one two three', ''), together('one two', 'three'));
});
