// ABOUTME: Tests the process fixtures' own bounds: a condition wait whose test has ended, failed or
// timed out, no longer holds the test file's process open, and the teardown that kills a scratch
// directory's processes ends, naming any it could not kill.
// It also controls raw process-table outcomes and a warm runner under a path containing a space.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { scratch, sweep } from './process-fixtures.mjs';
import { running } from './process-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { fixture } from './process-fixtures.mjs';

test('process fixtures execute the Bash file substitutions used by census controls', (t) => {
  const directory = scratch(t);
  writeFileSync(join(directory, 'answer'), 'tail');
  const path = fixture(directory, 'read-answer', 'answer=$(< "$here/answer"); printf "%s" "$answer"');
  const result = spawnSync(path, [], { env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'tail');
});

const childProcess = createRequire(import.meta.url)('node:child_process');

test('a process search excludes the caller whose command line contains the search text', () => {
  const code = `import { running } from ${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)}; console.log(JSON.stringify({ pid: process.pid, found: running(process.argv[1]) }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, 'rigger-process-search-observer'], { encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr);
  const { pid, found } = JSON.parse(result.stdout);
  assert.equal(found.includes(String(pid)), false, 'the process observer counted itself as a fixture');
});

function withProcessTableResults(results, check) {
  const original = childProcess.spawnSync;
  const calls = [];
  childProcess.spawnSync = (command, args, options) => {
    if (command !== '/usr/bin/pgrep' && command !== '/usr/bin/pkill') return original(command, args, options);
    calls.push({ command, args, options });
    const answer = results.shift();
    assert.ok(answer, `unexpected ${command} after ${calls.length} commands`);
    return answer;
  };
  syncBuiltinESMExports();
  try {
    check(calls);
    assert.equal(results.length, 0, 'a process-table answer was not read');
  } finally {
    childProcess.spawnSync = original;
    syncBuiltinESMExports();
  }
}

const processTableResult = (status, stdout, extra = {}) => ({ status, stdout, stderr: '', signal: null, error: undefined, ...extra });

test('warm runner resolves its module path when the checkout path contains a space', async (t) => {
  const directory = temporaryDirectory('rigger fixture space ', { context: t });
  for (const name of ['process-fixtures.mjs', 'temporary-directory.mjs']) {
    copyFileSync(new URL(`./${name}`, import.meta.url), join(directory, name));
  }
  const fixtures = await import(pathToFileURL(join(directory, 'process-fixtures.mjs')).href);
  fixtures.beginFixtureWarmBatch(directory);
  fixtures.fixture(directory, 'warm-control', 'exit 0');
  assert.doesNotThrow(() => fixtures.finishFixtureWarmBatch(directory));
});

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

  // `spawnSync` sets `ETIMEDOUT` where the bound ended the file, which Node's runner may meet by
  // exiting with a code of its own rather than by the signal.
  assert.equal(ran.error?.code, undefined, `the test file had not exited after ${EXITS_WITHIN} ms: ${ran.stdout}`);
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

test('control: a process-table read keeps raw status separate from its parsed list', () => {
  for (const status of [0, 1, 2, 3, 255, null]) {
    for (const stdout of ['', '4242\n', 'not-a-pid\n']) {
      const result = processTableResult(status, stdout, status === null ? { signal: 'SIGTERM' } : {});
      withProcessTableResults([result], (calls) => {
        assert.deepEqual(running('rigger-779-absent'), stdout.split('\n').filter(Boolean));
        assert.deepEqual(calls.map(({ command }) => command), ['/usr/bin/pgrep']);
        assert.equal(result.status, status);
        assert.equal(result.stdout, stdout);
      });
    }
  }
  withProcessTableResults([processTableResult(null, undefined, { error: new Error('failed launch') })], (calls) => {
    assert.throws(() => running('rigger-779-absent'), TypeError);
    assert.equal(calls.length, 1);
  });
});

test('control: sweep returns on a parsed empty read, including raw statuses that cannot prove no match', () => {
  for (const status of [0, 1, 2, 3, 255, null]) {
    withProcessTableResults([processTableResult(status, '', status === null ? { signal: 'SIGTERM' } : {})], (calls) => {
      sweep('rigger-779-absent');
      assert.deepEqual(calls.map(({ command }) => command), ['/usr/bin/pgrep']);
    });
  }
  withProcessTableResults([processTableResult(null, undefined, { error: new Error('failed launch') })], (calls) => {
    assert.throws(() => sweep('rigger-779-absent'), TypeError);
    assert.deepEqual(calls.map(({ command }) => command), ['/usr/bin/pgrep']);
  });
});

test('control: sweep checks first, later and final reads after occupied lists despite failed pkill returns', () => {
  for (const status of [0, 1, 2, 3, 255, null]) {
    for (const stdout of ['4242\n', 'not-a-pid\n']) {
      withProcessTableResults([
        processTableResult(status, stdout, status === null ? { signal: 'SIGTERM' } : {}),
        processTableResult(0, ''),
        processTableResult(1, ''),
      ], (calls) => {
        sweep('rigger-779-absent');
        assert.deepEqual(calls.map(({ command }) => command), ['/usr/bin/pgrep', '/usr/bin/pkill', '/usr/bin/pgrep']);
      });
    }
  }
  for (const occupied of [1, 2, 10]) {
    const answers = Array.from({ length: occupied }, () => [processTableResult(0, '4242\n'), processTableResult(2, '')]).flat();
    answers.push(processTableResult(1, ''));
    withProcessTableResults(answers, (calls) => {
      sweep('rigger-779-absent');
      assert.equal(calls.filter(({ command }) => command === '/usr/bin/pgrep').length, occupied + 1);
      assert.equal(calls.filter(({ command }) => command === '/usr/bin/pkill').length, occupied);
    });
  }
  const answers = Array.from({ length: 10 }, () => [processTableResult(1, 'not-a-pid\n'), processTableResult(2, '')]).flat();
  answers.push(processTableResult(3, 'not-a-pid\n'));
  withProcessTableResults(answers, (calls) => {
    assert.throws(() => sweep('rigger-779-absent'), /not-a-pid/);
    assert.equal(calls.filter(({ command }) => command === '/usr/bin/pgrep').length, 11);
  });
  withProcessTableResults([
    processTableResult(0, '4242\n'),
    processTableResult(null, undefined, { error: new Error('pkill failed to launch') }),
    processTableResult(1, ''),
  ], (calls) => {
    sweep('rigger-779-absent');
    assert.deepEqual(calls.map(({ command }) => command), ['/usr/bin/pgrep', '/usr/bin/pkill', '/usr/bin/pgrep']);
  });
});
