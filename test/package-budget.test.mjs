// ABOUTME: Tests the package budget check: what counts as a production line, where the number
// ABOUTME: comes from, and which files the walk includes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Every spelling `node --test` executes as a test, and three near misses that it does not.
// `npm test` is `node --test`, so this list is what this repository means by "a test", and the
// budget charges for none of it. The near misses are here because an exclusion wide enough to
// catch `testing.mjs` would stop charging for production code.
const RUN_AS_TESTS = [
  'src/scheduling/test.mjs',
  'src/scheduling/test-tick.mjs',
  'src/scheduling/tick.test.mjs',
  'src/scheduling/tick-test.mjs',
  'src/scheduling/tick_test.mjs',
  'src/scheduling/test/helper.mjs',
];
const NOT_TESTS = ['src/scheduling/latest.mjs', 'src/scheduling/testing.mjs', 'src/workflow/real.mjs'];

/** A repository holding every shape above, each file a test the runner can really run. */
function everyShape() {
  const root = mkdtempSync(join(tmpdir(), 'rigger-shapes-'));
  for (const path of [...RUN_AS_TESTS, ...NOT_TESTS]) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), `import { test } from 'node:test';\ntest('${path}', () => {});\n`);
  }
  return root;
}

test('no spelling the test runner executes is charged to the budget', () => {
  const root = everyShape();

  assert.deepEqual(productionFiles(root), NOT_TESTS.map((path) => join(root, path)));
});

test('what the check calls a test is what the test runner runs', () => {
  // The two definitions have to move together, and only the runner can say what it runs. This
  // asks it, on whichever Node is running the suite, rather than trusting the patterns copied
  // into the list above.
  const root = everyShape();
  const counted = productionFiles(root);

  // `NODE_TEST_CONTEXT` marks a process as already inside a test run, and a child that inherits
  // it refuses to look for files at all. This run has to be the outer one.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  const executed = [...ran.stdout.matchAll(/^# Subtest: (\S+)$/gm)].map(([, path]) => path);

  assert.ok(executed.length > 0, `the runner ran nothing:\n${ran.stdout}${ran.stderr}`);
  for (const path of executed) {
    assert.ok(
      !counted.includes(join(root, path)),
      `${path} runs as a test and is charged to the production budget`,
    );
  }
});

test('a template, and a check Rigger ships for a consumer, are not counted', () => {
  // The Budgets section puts `templates/` outside the budget, and a check Rigger ships for a
  // consumer's own CI is one of the things that ships from there: ARCHITECTURE.md's Document
  // checking row says the resolver ships as a template and that no layer reads it. Neither runs
  // a card, so neither is counted, wherever the directory sits.
  const root = mkdtempSync(join(tmpdir(), 'rigger-budget-'));
  mkdirSync(join(root, 'templates'), { recursive: true });
  mkdirSync(join(root, 'src', 'templates'), { recursive: true });
  mkdirSync(join(root, 'src', 'workflow'), { recursive: true });
  writeFileSync(join(root, 'templates', 'resolver.mjs'), 'const shipped = 1;\n');
  writeFileSync(join(root, 'src', 'templates', 'gate.mjs'), 'const alsoShipped = 2;\n');
  writeFileSync(join(root, 'src', 'workflow', 'next-action.mjs'), 'const counted = 3;\n');

  assert.deepEqual(productionFiles(root), [join(root, 'src', 'workflow', 'next-action.mjs')]);
});

test('the templates this repository really ships are charged nothing', () => {
  // The test above proves the rule against a fixture. This asks it of the tree that exists:
  // `templates/` now holds a starter config and a provider's whole asset tree, and none of it
  // runs a card, so the Budgets section puts every line of it outside the count. The defect this
  // catches is the walk widened past `src/`, after which the figure a card reports would move
  // with an edit to a role prompt.
  const here = join(dirname(fileURLToPath(import.meta.url)), '..');
  const templates = join(here, 'templates');
  assert.ok(existsSync(templates), 'this repository ships no templates, so there is nothing to leave out');

  const charged = productionFiles(here);

  assert.ok(charged.length > 0, 'nothing at all is charged, so this proves nothing about templates');
  for (const path of charged) {
    assert.ok(!path.startsWith(templates), `${path} is a template and the budget charges for it`);
  }
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
