// ABOUTME: Proves the command-gate refspec tests pass when a linked worktree's commit hook runs them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { gitIn, repositoryAt, worktreeAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const checkout = join(dirname(fileURLToPath(import.meta.url)), '..');
const quoted = (value) => `'${value.replaceAll("'", "'\\''")}'`;

test('a linked worktree commits when pre-commit runs the literal-refspec tests', () => {
  const directory = temporaryDirectory('rigger-command-gate-hook-');
  const repository = repositoryAt(join(directory, 'repository'), { README: 'first\n' });
  const worktree = worktreeAt(repository, join(directory, 'worktree'), 'topic');
  const hook = join(directory, 'pre-commit');
  const output = join(directory, 'suite-output');

  writeFileSync(hook, [
    '#!/bin/sh',
    '# ABOUTME: Runs only the command-gate refspec tests from the checkout under test.',
    `cd ${quoted(checkout)} || exit 1`,
    `npm test -- --test-name-pattern='a literal refspec to' test/command-gate.test.mjs > ${quoted(output)} 2>&1`,
    '',
  ].join('\n'));
  chmodSync(hook, 0o755);
  gitIn(worktree, 'config', 'core.hooksPath', directory);

  const { NODE_TEST_CONTEXT, ...env } = gitEnvironment();
  const committed = spawnSync('git', ['commit', '--allow-empty', '-m', 'hooked'], {
    cwd: worktree, encoding: 'utf8', env,
  });
  const suite = readFileSync(output, 'utf8');
  assert.equal(committed.status, 0, `${committed.stderr}\n${suite}`);
  assert.match(suite, /a literal refspec to main is denied before Bash runs/);
  assert.match(suite, /a literal refspec to trunk is denied before Bash runs/);
  assert.match(suite, /\bpass 2\b/);
  assert.match(suite, /\bfail 0\b/);
  assert.doesNotMatch(suite, /a linked worktree commits when pre-commit/);
});
