// ABOUTME: Tests that a temporary directory the shared helper makes under TMPDIR is gone once the test
// that made it has ended, passed or failed, made in the test or in a function it awaited, after the
// test's own teardown; and that one made at a file's top level lasts until the file's tests have ended.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scratch } from './process-fixtures.mjs';

const HELPER = JSON.stringify(new URL('./temporary-directory.mjs', import.meta.url).href);

/**
 * Runs, under `node --test`, a test file in `directory` whose `body` lines follow its imports, with
 * the run's TMPDIR a directory of its own inside `directory`. The body records what it needs under
 * `record(name)`, a file in `directory`, and reads it back with `recorded`. Returns the run, the
 * TMPDIR and a reader of what the body recorded.
 */
function running(directory, body) {
  const tmp = join(directory, 'tmp');
  mkdirSync(tmp);
  const file = join(directory, 'takes-temporary-directory.test.mjs');
  writeFileSync(file, [
    "import { test } from 'node:test';",
    "import { existsSync, writeFileSync } from 'node:fs';",
    "import { setImmediate as turn } from 'node:timers/promises';",
    `import { temporaryDirectory } from ${HELPER};`,
    `const record = (name, value) => writeFileSync(${JSON.stringify(directory)} + '/' + name, String(value));`,
    ...body,
  ].join('\n'));

  // Without the runner's own mark, which would have the file report to this runner, not print.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', env: { ...env, TMPDIR: tmp } });
  return { ran, tmp, recorded: (name) => readFileSync(join(directory, name), 'utf8') };
}

/** A test titled `title` that makes a directory, records its path and, at its own teardown, whether it was there. */
const making = (title, { fails = false } = {}) => [
  `test(${JSON.stringify(title)}, (t) => {`,
  "  const directory = temporaryDirectory('rigger-helper-');",
  "  record('made', directory);",
  "  t.after(() => record('seen', existsSync(directory)));",
  fails ? "  throw new Error('this test fails as its caller asked');" : '',
  '});',
];

test('given a test that makes a temporary directory and passes, the directory is gone once the test has ended, and was there for its own teardown', (t) => {
  const { ran, tmp, recorded } = running(scratch(t), making('makes a directory'));

  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.ok(recorded('made').startsWith(tmp), `the directory ${recorded('made')} is not under the run's TMPDIR ${tmp}`);
  assert.equal(recorded('seen'), 'true', 'the directory was gone before the test\'s own teardown, registered after it, had run');
  assert.equal(existsSync(recorded('made')), false, `the run left ${recorded('made')}`);
  assert.deepEqual(readdirSync(tmp), []);
});

test('given a test that makes a temporary directory and fails, the directory is gone once the test has ended', (t) => {
  const { ran, tmp, recorded } = running(scratch(t), making('makes a directory and fails', { fails: true }));

  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /^not ok 1 - makes a directory and fails/m);
  assert.equal(recorded('seen'), 'true', 'the directory was gone before the test\'s own teardown, registered after it, had run');
  assert.equal(existsSync(recorded('made')), false, `the run left ${recorded('made')}`);
  assert.deepEqual(readdirSync(tmp), []);
});

test('given a test that leaves its temporary directory holding a read-only subdirectory with files, and the directory itself read-only, the directory is gone once the test has ended (O68)', (t) => {
  const { ran, tmp, recorded } = running(scratch(t), [
    "import { chmodSync, mkdirSync } from 'node:fs';",
    "test('leaves part of its directory read-only', () => {",
    "  const directory = temporaryDirectory('rigger-helper-');",
    "  record('made', directory);",
    "  mkdirSync(directory + '/state');",
    "  writeFileSync(directory + '/state/groups.json', '{}');",
    "  writeFileSync(directory + '/state/events.jsonl', '');",
    "  chmodSync(directory + '/state/groups.json', 0o444);",
    "  chmodSync(directory + '/state', 0o555);",
    "  chmodSync(directory, 0o555);",
    '});',
  ]);

  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.ok(recorded('made').startsWith(tmp), `the directory ${recorded('made')} is not under the run's TMPDIR ${tmp}`);
  assert.equal(existsSync(recorded('made')), false, `the run left ${recorded('made')}`);
  assert.deepEqual(readdirSync(tmp), []);
});

test('given a function the test awaits that makes a temporary directory after an await, the directory is gone before the next test starts', (t) => {
  const { ran, tmp, recorded } = running(scratch(t), [
    'async function fixture() {',
    '  await turn();',
    "  return temporaryDirectory('rigger-helper-');",
    '}',
    'let made;',
    "test('makes a directory through a fixture', async () => {",
    '  made = await fixture();',
    "  record('made', made);",
    '});',
    "test('runs next', () => {",
    "  record('seen-by-next', existsSync(made));",
    '});',
  ]);

  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.ok(recorded('made').startsWith(tmp), `the directory ${recorded('made')} is not under the run's TMPDIR ${tmp}`);
  assert.equal(recorded('seen-by-next'), 'false', 'the directory was still there when the next test ran');
  assert.deepEqual(readdirSync(tmp), []);
});

test('given a temporary directory made at the top level of a test file, it lasts through the file\'s tests, passing or failing, and is gone once they have ended, before the process exits', (t) => {
  const { ran, tmp, recorded } = running(scratch(t), [
    // Registered before the directory is made, so that it runs before any exit handler the helper adds.
    "let shared;",
    "process.once('exit', () => record('seen-at-exit', existsSync(shared)));",
    "shared = temporaryDirectory('rigger-helper-');",
    "record('made', shared);",
    "test('fails while the directory is there', () => {",
    "  record('seen-by-first', existsSync(shared));",
    "  throw new Error('this test fails as its caller asked');",
    '});',
    "test('reads it next', () => {",
    "  record('seen-by-next', existsSync(shared));",
    '});',
  ]);

  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.equal(recorded('seen-by-first'), 'true', 'the directory made for the file was gone before its first test ran');
  assert.equal(recorded('seen-by-next'), 'true', 'the directory made for the file was gone before its next test ran');
  assert.equal(recorded('seen-at-exit'), 'false', 'the directory made for the file was still there when its process exited, so no teardown of node:test removed it');
  assert.ok(recorded('made').startsWith(tmp), `the directory ${recorded('made')} is not under the run's TMPDIR ${tmp}`);
  assert.deepEqual(readdirSync(tmp), []);
});
