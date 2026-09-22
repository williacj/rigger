// ABOUTME: Tests the two budget checks as CI runs them — as commands, for the exit code they
// ABOUTME: return and what their output names, over budget, under it, and with the figure gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Run one check as CI runs it, against a fixture repository rather than this one.
 *
 * The real script, the real Node, a real directory on disk: what the acceptance names is the
 * command's exit code, and nothing short of running the command observes that.
 */
const run = (check, fixture) =>
  spawnSync(process.execPath, [join(root, 'scripts', check), fixture], { encoding: 'utf8' });

/** A fixture repository: an architecture that states a budget, and files to weigh against it. */
function fixture(architecture, files) {
  const dir = mkdtempSync(join(tmpdir(), 'rigger-check-'));
  writeFileSync(join(dir, 'ARCHITECTURE.md'), architecture);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const packageBudgetOf = (lines) => `| Budget | Production lines |\n|---|---|\n| **Package** | **${lines}** |\n`;
const wordBudgetOf = (words) => `Instruction files carry one budget of their own. The budget is ${words} words.\n`;

test('the package check refuses a package over its budget, naming the count and the budget', () => {
  // Three lines of code against a budget of two. Both numbers are the fixture's, so the
  // assertion knows them without asking the check what it counted.
  const dir = fixture(packageBudgetOf(2), { 'src/substrate/git.mjs': 'const a = 1;\nconst b = 2;\nconst c = 3;\n' });

  const { status, stdout, stderr } = run('package-budget.mjs', dir);

  assert.notEqual(status, 0);
  assert.match(stdout + stderr, /\b3\b/);
  assert.match(stdout + stderr, /budget of 2\b/);
});

test('the package check admits a package within its budget', () => {
  const dir = fixture(packageBudgetOf(12000), { 'src/substrate/git.mjs': 'const a = 1;\n' });

  const { status, stdout } = run('package-budget.mjs', dir);

  assert.equal(status, 0);
  assert.match(stdout, /1\s+production lines, against a budget of 12000/);
});

test('the instruction check refuses instruction files over their budget', () => {
  // Three words across two files against a budget of two, which is also the item this proves:
  // the root file and the nested one are weighed together, not one at a time.
  const dir = fixture(wordBudgetOf(2), { 'AGENTS.md': 'one two\n', 'src/execution/AGENTS.md': 'three\n' });

  const { status, stdout, stderr } = run('instruction-budget.mjs', dir);

  assert.notEqual(status, 0);
  assert.match(stdout + stderr, /\b3\b/);
  assert.match(stdout + stderr, /budget of 2\b/);
});

test('the instruction check admits instruction files within their budget', () => {
  const dir = fixture(wordBudgetOf(2000), { 'AGENTS.md': 'one two three\n' });

  const { status, stdout } = run('instruction-budget.mjs', dir);

  assert.equal(status, 0);
  assert.match(stdout, /3\s+words, against a budget of 2000/);
});

test('each check refuses to run at all once the architecture stops stating its figure', () => {
  const silent = 'A Budgets section that states no number at all.\n';

  for (const check of ['package-budget.mjs', 'instruction-budget.mjs']) {
    const dir = fixture(silent, { 'AGENTS.md': 'one\n', 'src/a.mjs': 'const a = 1;\n' });

    const { status, stdout, stderr } = run(check, dir);

    assert.notEqual(status, 0, `${check} carried on without a budget`);
    assert.match(stdout + stderr, /budget/i);
  }
});

test('neither check states a budget of its own', () => {
  // The falsifier the acceptance names: a number typed into either script. Both budgets are
  // ARCHITECTURE.md's to state, and a copy in the script is a second place for them to differ.
  for (const check of ['package-budget.mjs', 'instruction-budget.mjs']) {
    const source = readFileSync(join(root, 'scripts', check), 'utf8');
    for (const typed of ['12000', '12,000', '2000', '2,000']) {
      assert.ok(!source.includes(typed), `${check} states ${typed} rather than reading it`);
    }
  }
});
