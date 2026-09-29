// ABOUTME: Tests the process fixtures' own bounds: a condition wait whose test has ended, failed or
// timed out, no longer holds the test file's process open, and the teardown that kills a scratch
// directory's processes ends, naming any it could not kill.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scratch, sweep } from './process-fixtures.mjs';

/**
 * How long a test file of two tests, each ending while its wait is unmet, is given to exit. A
 * judgment: its premise is that such a file, run alone under `node --test`, exits in well under a
 * second, and a wait that holds it open holds it for ever, so any bound past the first tells the
 * two apart.
 */
const EXITS_WITHIN = 10_000;

/**
 * A test file in `directory` of two tests, each ending while `until` waits on a condition that
 * never holds: one fails, as a verb that ends before its forge read fails, and one reaches its
 * timeout. The file's path names the directory, so the teardown ends any process running it.
 */
function waitingTests(directory) {
  const path = join(directory, 'waiting.test.mjs');
  writeFileSync(path, [
    "import { test } from 'node:test';",
    `import { until } from ${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)};`,
    "test('fails while its wait is unmet', async (t) => {",
    "  await Promise.race([until(() => false, t), Promise.reject(new Error('the command ended first'))]);",
    '});',
    "test('times out while its wait is unmet', { timeout: 100 }, async (t) => {",
    '  await until(() => false, t);',
    '});',
  ].join('\n'));
  return path;
}

test('given a test file whose tests end, one failing and one timed out, while each waits on a condition that never holds, the file\'s process exits reporting both failed', (t) => {
  const directory = scratch(t);
  const file = waitingTests(directory);

  // Without the runner's own mark, which would have the file report to this runner, not print.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', env, timeout: EXITS_WITHIN });

  assert.equal(ran.signal, null, `the test file had not exited after ${EXITS_WITHIN} ms: ${ran.stdout}`);
  assert.equal(ran.status, 1, ran.stdout);
  assert.equal(ran.stdout.match(/^not ok \d+ - /gm)?.length, 2, ran.stdout);
});

test('given a process the teardown\'s pkill cannot kill, which pgrep lists however often it is killed, the teardown ends and fails naming it', (t) => {
  // Nothing runs naming a fresh scratch directory, so the teardown's own pkill kills nothing here.
  const directory = scratch(t);
  let asked = 0;
  const unkillable = () => {
    asked += 1;
    if (asked > 1_000) throw new Error(`the teardown asked for the processes left ${asked} times, and would never have ended`);
    return ['4242'];
  };

  assert.throws(() => sweep(directory, unkillable), (error) => {
    assert.match(error.message, /\b4242\b/);
    assert.ok(error.message.includes(directory), error.message);
    return true;
  });
});
