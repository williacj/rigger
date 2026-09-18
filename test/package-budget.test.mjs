// ABOUTME: Tests the package budget check: what counts as a production line, where the number
// ABOUTME: comes from, and which files the walk includes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  check,
  countProductionLines,
  packageBudget,
  productionFiles,
} from '../scripts/package-budget.mjs';

test('a line of code counts', () => {
  assert.equal(countProductionLines('const a = 1;\nconst b = 2;\n'), 2);
});

test('a blank line does not count', () => {
  assert.equal(countProductionLines('const a = 1;\n\n   \n\nconst b = 2;\n'), 2);
});

test('a line comment does not count', () => {
  assert.equal(countProductionLines('// why\nconst a = 1;\n  // indented why\n'), 1);
});

test('a block comment does not count, on any of its lines', () => {
  const source = ['/**', ' * Why.', ' */', 'const a = 1;'].join('\n');
  assert.equal(countProductionLines(source), 1);
});

test('code sharing a line with a comment counts once', () => {
  assert.equal(countProductionLines('const a = 1; // why\n'), 1);
});

test('code after a block comment closes on the same line counts', () => {
  assert.equal(countProductionLines('/* why */ const a = 1;\n'), 1);
});

test('a comment opener inside a string opens no comment', () => {
  const source = ['const s = "/*";', 'const a = 1;', 'const b = 2;'].join('\n');
  assert.equal(countProductionLines(source), 3);
});

test('a comment opener inside a template literal opens no comment', () => {
  const source = ['const s = `/*`;', 'const a = 1;'].join('\n');
  assert.equal(countProductionLines(source), 2);
});

test('an apostrophe in a comment opens no string', () => {
  const source = ["// don't count me", 'const a = 1;', 'const b = 2;'].join('\n');
  assert.equal(countProductionLines(source), 2);
});

test('an unbalanced backtick does not carry a quoted run past its line', () => {
  // A regular expression literal can hold an odd number of backticks, and
  // `scripts/absorption-check.mjs` holds exactly this one. Carrying a quoted run across the
  // line end would make every comment line below it count as code.
  const source = [
    'const words = (s) => s.replace(/`[^`]*`/g, " ");',
    '// inline code names a mechanism',
    'const a = 1;',
  ].join('\n');
  assert.equal(countProductionLines(source), 2);
});

test('a template literal spanning lines carries code on each of them', () => {
  const source = ['const s = `', 'text', '`;', 'const a = 1;'].join('\n');
  assert.equal(countProductionLines(source), 4);
});

test('a block comment left open fails rather than swallowing the rest of the file', () => {
  // Source that parses cannot leave one open, so reaching the end inside a block comment means
  // the scan was fooled — by the regex literal its own doc comment names, or by something else.
  // The budget is a gate, and a gate that undercounts in silence is worse than one that stops.
  assert.throws(() => countProductionLines('/* open\nconst a = 1;\n'), /never closes/);
});

test('the budget is read from the architecture, not typed here', () => {
  const architecture = [
    '| Budget | Production lines |',
    '|---|---|',
    '| L0 | 3,000 |',
    '| **Package** | **12,000** |',
    '',
  ].join('\n');
  assert.equal(packageBudget(architecture), 12000);
});

test('an architecture with no package row fails rather than guessing', () => {
  assert.throws(() => packageBudget('| L0 | 3,000 |\n'), /package budget/i);
});

test('the walk takes production sources and leaves tests out', () => {
  const root = mkdtempSync(join(tmpdir(), 'rigger-budget-'));
  mkdirSync(join(root, 'src', 'substrate'), { recursive: true });
  writeFileSync(join(root, 'src', 'substrate', 'git.mjs'), 'const a = 1;\n');
  writeFileSync(join(root, 'src', 'substrate', 'git.test.mjs'), 'const b = 2;\n');
  writeFileSync(join(root, 'src', 'notes.md'), 'not source\n');

  assert.deepEqual(productionFiles(root), [join(root, 'src', 'substrate', 'git.mjs')]);
});

test('a repository with no production sources yet walks to nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'rigger-budget-'));
  assert.deepEqual(productionFiles(root), []);
});

test('the file the scan could not read through is named in the failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'rigger-budget-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'ARCHITECTURE.md'), '| **Package** | **12,000** |\n');
  writeFileSync(join(root, 'src', 'open.mjs'), '/* open\nconst a = 1;\n');

  assert.throws(() => check(root), /open\.mjs.*never closes/);
});
