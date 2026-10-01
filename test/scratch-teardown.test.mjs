// ABOUTME: Tests that a scratch directory's teardown removes it once no process names it, after the
// test's own teardown, whether the test passed or failed, or its own teardown threw, and whatever
// write permission its entries lost; and that it leaves the directory, naming the process, where one
// it cannot end still runs, and touches nothing outside it, even where the directory became a link.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renameSync } from 'node:fs';

import { scratch } from './process-fixtures.mjs';

/**
 * Runs, under `node --test`, a test file in `directory` of one test that takes a scratch directory,
 * records its path, registers a teardown of its own that records whether the directory is still
 * there and, where `hookThrows`, then throws, and then passes or, where `fails`, throws. The run's
 * TMPDIR is a directory of its own inside `directory`. Returns the run, the scratch directory's
 * path, what the test's own teardown saw, and that TMPDIR.
 */
function takingScratch(directory, { fails = false, hookThrows = false } = {}) {
  const record = join(directory, 'scratch-path');
  const seen = join(directory, 'seen');
  const tmp = join(directory, 'tmp');
  mkdirSync(tmp);
  const file = join(directory, 'takes-scratch.test.mjs');
  writeFileSync(file, [
    "import { test } from 'node:test';",
    "import { existsSync, writeFileSync } from 'node:fs';",
    `import { scratch } from ${JSON.stringify(new URL('./process-fixtures.mjs', import.meta.url).href)};`,
    "test('takes a scratch directory', (t) => {",
    '  const directory = scratch(t);',
    `  writeFileSync(${JSON.stringify(record)}, directory);`,
    '  t.after(() => {',
    `    writeFileSync(${JSON.stringify(seen)}, String(existsSync(directory)));`,
    hookThrows ? "    throw new Error('the own teardown of this test fails as its caller asked');" : '',
    '  });',
    fails ? "  throw new Error('this test fails as its caller asked');" : '',
    '});',
  ].join('\n'));

  // Without the runner's own mark, which would have the file report to this runner, not print.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', env: { ...env, TMPDIR: tmp } });
  return { ran, taken: readFileSync(record, 'utf8'), seen: readFileSync(seen, 'utf8'), tmp };
}

/**
 * A scratch directory made, with `find` for its sweep, under a TMPDIR inside the test `t`'s own
 * scratch directory, for a stand-in context that holds its teardown until the caller runs
 * `teardown`, which runs its hooks and then aborts its signal, as `node:test` ends a test. Whatever
 * that teardown leaves, `t`'s own removes.
 */
function held(t, find) {
  const tmp = join(scratch(t), 'tmp');
  mkdirSync(tmp);
  const hooks = [];
  const ended = new AbortController();
  const context = { after: (hook) => hooks.push(hook), signal: ended.signal };
  const tmpdir = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  try {
    const directory = scratch(context, find);
    // As in `node:test`, a hook added during teardown runs after every other.
    const teardown = () => {
      try {
        for (let i = 0; i < hooks.length; i += 1) hooks[i]();
      } finally {
        ended.abort();
      }
    };
    return { directory, teardown, context, ended };
  } finally {
    process.env.TMPDIR = tmpdir;
  }
}

test('given a test that takes a scratch directory and passes, the directory is gone once its teardown has run', (t) => {
  const { ran, taken, seen, tmp } = takingScratch(scratch(t));

  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.ok(taken.startsWith(tmp), `the scratch directory ${taken} is not under the run's TMPDIR ${tmp}`);
  assert.equal(seen, 'true', 'the directory was gone before the test\'s own teardown, registered after it, had run');
  assert.equal(existsSync(taken), false, `the teardown left ${taken}`);
  assert.deepEqual(readdirSync(tmp), []);
});

test('given a test that takes a scratch directory and fails, the directory is gone once its teardown has run', (t) => {
  const { ran, taken, seen, tmp } = takingScratch(scratch(t), { fails: true });

  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /^not ok 1 - takes a scratch directory/m);
  assert.ok(taken.startsWith(tmp), `the scratch directory ${taken} is not under the run's TMPDIR ${tmp}`);
  assert.equal(seen, 'true', 'the directory was gone before the test\'s own teardown, registered after it, had run');
  assert.equal(existsSync(taken), false, `the teardown left ${taken}`);
  assert.deepEqual(readdirSync(tmp), []);
});

test('given a test that takes a scratch directory and fails, and whose own teardown throws, the directory is gone once its teardown has run', (t) => {
  const { ran, taken, seen, tmp } = takingScratch(scratch(t), { fails: true, hookThrows: true });

  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /^not ok 1 - takes a scratch directory/m);
  assert.equal(seen, 'true', 'the directory was gone before the test\'s own teardown, registered after it, had run');
  assert.equal(existsSync(taken), false, `the teardown left ${taken}`);
  assert.deepEqual(readdirSync(tmp), []);
});

test('given a test that takes a scratch directory and passes, and whose own teardown throws, the directory is gone once its teardown has run', (t) => {
  const { ran, taken, seen, tmp } = takingScratch(scratch(t), { hookThrows: true });

  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /failureType: 'hookFailed'/);
  assert.equal(seen, 'true', 'the directory was gone before the test\'s own teardown, registered after it, had run');
  assert.equal(existsSync(taken), false, `the teardown left ${taken}`);
  assert.deepEqual(readdirSync(tmp), []);
});

test('given a test whose signal its timeout aborted before its teardown, the directory stays until the test\'s own teardown has run, and is gone after', (t) => {
  const { directory, teardown, context, ended } = held(t);
  let seen;
  context.after(() => {
    seen = existsSync(directory);
  });

  // `node:test` aborts a timed-out test's signal when the timeout ends it, before its hooks run.
  ended.abort();
  assert.equal(existsSync(directory), true, 'the directory was removed when the timeout aborted the signal, before any teardown');
  teardown();

  assert.equal(seen, true, 'the directory was gone before the test\'s own teardown, registered after it, had run');
  assert.equal(existsSync(directory), false, `the teardown left ${directory}`);
});

test('given a scratch directory holding a file and a directory whose write permission was removed, its teardown removes it', (t) => {
  const { directory, teardown } = held(t);
  writeFileSync(join(directory, 'locked'), 'locked');
  chmodSync(join(directory, 'locked'), 0o400);
  mkdirSync(join(directory, 'sealed'));
  writeFileSync(join(directory, 'sealed', 'inside'), 'inside');
  chmodSync(join(directory, 'sealed', 'inside'), 0o400);
  chmodSync(join(directory, 'sealed'), 0o500);
  chmodSync(directory, 0o500);

  teardown();

  assert.equal(existsSync(directory), false, `the teardown left ${directory}`);
});

test('given a process naming a scratch directory that the sweep cannot end, its teardown fails naming the process and leaves the directory', (t) => {
  // `sweep`'s own bound on its rounds, which test/process-fixtures.test.mjs holds, ends this.
  const unkillable = () => ['4242'];
  const { directory, teardown } = held(t, unkillable);
  writeFileSync(join(directory, 'kept'), 'kept');

  assert.throws(() => teardown(), (error) => {
    assert.match(error.message, /\b4242\b/);
    assert.ok(error.message.includes(directory), error.message);
    return true;
  });
  assert.equal(readFileSync(join(directory, 'kept'), 'utf8'), 'kept');
});

test('given a scratch directory holding symbolic links to a directory and a file outside it, its teardown leaves both targets unchanged', (t) => {
  const outside = scratch(t);
  mkdirSync(join(outside, 'target'));
  writeFileSync(join(outside, 'target', 'inside'), 'inside');
  writeFileSync(join(outside, 'file'), 'file');
  chmodSync(join(outside, 'target', 'inside'), 0o400);
  chmodSync(join(outside, 'file'), 0o400);
  chmodSync(join(outside, 'target'), 0o500);
  const before = ['target', 'target/inside', 'file'].map((name) => statSync(join(outside, name)).mode);

  const { directory, teardown } = held(t);
  symlinkSync(join(outside, 'target'), join(directory, 'to-target'));
  symlinkSync(join(outside, 'file'), join(directory, 'to-file'));

  teardown();

  assert.equal(existsSync(directory), false, `the teardown left ${directory}`);
  assert.deepEqual(['target', 'target/inside', 'file'].map((name) => statSync(join(outside, name)).mode), before);
  assert.deepEqual(readdirSync(join(outside, 'target')), ['inside']);
  assert.equal(readFileSync(join(outside, 'target', 'inside'), 'utf8'), 'inside');
  assert.equal(readFileSync(join(outside, 'file'), 'utf8'), 'file');
});

test('given a scratch directory replaced, before its teardown, by a symbolic link to a directory outside it, its teardown fails naming it and leaves the target unchanged', (t) => {
  const outside = scratch(t);
  mkdirSync(join(outside, 'target'));
  writeFileSync(join(outside, 'target', 'inside'), 'inside');
  chmodSync(join(outside, 'target', 'inside'), 0o400);
  chmodSync(join(outside, 'target'), 0o500);
  const before = ['target', 'target/inside'].map((name) => statSync(join(outside, name)).mode);

  const { directory, teardown } = held(t);
  renameSync(directory, join(outside, 'moved-aside'));
  symlinkSync(join(outside, 'target'), directory);

  assert.throws(() => teardown(), (error) => {
    assert.ok(error.message.includes(directory), error.message);
    assert.match(error.message, /no longer a directory/);
    return true;
  });
  assert.deepEqual(['target', 'target/inside'].map((name) => statSync(join(outside, name)).mode), before);
  assert.deepEqual(readdirSync(join(outside, 'target')), ['inside']);
  assert.equal(readFileSync(join(outside, 'target', 'inside'), 'utf8'), 'inside');
});
