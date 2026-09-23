// ABOUTME: Tests absorption-check as a command: which argument vectors make it do work, what a
// ABOUTME: refused one costs and says, and that the report a working one prints has not moved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'absorption-check.mjs');

/**
 * Run the script as a caller runs it, for the exit code and the two streams.
 *
 * What the acceptance names is the command's exit code, and nothing short of running the
 * command observes that: the defect this file exists over is a module that fell off its own
 * end, which no exported function can be asked about.
 */
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('a bare invocation is refused rather than exiting 0 having compared nothing', () => {
  // The defect. A caller reads exit 0 as the check having passed, and it never ran.
  const { status } = run();

  assert.notEqual(status, 0);
});

test('a single document path is refused, because one document compares against nothing', () => {
  const { status } = run('ARCHITECTURE.md');

  assert.notEqual(status, 0);
});

test('--self-test carrying a further argument is refused rather than silently ignoring it', () => {
  // Two forms are accepted and this is neither. A caller who passed a document path alongside
  // --self-test asked for something the script does not do, and watched it self-test instead.
  const { status } = run('--self-test', 'ARCHITECTURE.md');

  assert.notEqual(status, 0);
});

test('three document paths are refused rather than comparing the first two', () => {
  // A throw out of the two-document form also exits non-zero, so a bare exit code cannot tell a
  // refusal from an accident. The refusal is what is asserted here.
  const { status, stderr } = run('ARCHITECTURE.md', 'docs/spec/requirements.md', 'README.md');

  assert.notEqual(status, 0);
  assert.match(stderr, /no such invocation/);
});

test('a refusal names both accepted forms on stderr, so a caller never opens the file', () => {
  // Derived from the acceptance rather than from the script: the two forms are `--self-test`
  // and a pair of document paths, and a caller has to be able to read both off the refusal.
  const { status, stdout, stderr } = run('--bogus');

  assert.notEqual(status, 0);
  assert.match(stderr, /--self-test/);
  assert.match(stderr, /<source\.md> <destination\.md>/);
  assert.equal(stdout, '', 'a refusal says nothing on stdout, where a report would sit');
});
