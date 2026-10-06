// ABOUTME: Checks, without running any agent CLI, the live Codex judge's shell world: the flags
// that keep Codex's shell from re-reading a login profile, and a `gh` that resolves to the fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { judgeShell } from './codex-judge-shell.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const handed = { command: 'codex', args: ['exec', '--json', '-C', '/repo/main', '-c', 'developer_instructions="x"'], env: { CODEX_HOME: '/scratch/codex-home', PATH: '/fake-forge:/usr/bin:/bin' } };

test('the live judge\'s Codex command line turns the login shell and the shell snapshot off, after every flag L1 handed it', () => {
  const shelled = judgeShell(handed, '/scratch/gh-config');

  assert.deepEqual(shelled.args, [...handed.args, '-c', 'allow_login_shell=false', '--disable', 'shell_snapshot', '--disable', 'shell_snapshot_v2']);
  assert.equal(shelled.command, 'codex');
});

test('the live judge\'s environment keeps L1\'s and points gh at an empty configuration, so a real gh it reached would hold no login', () => {
  const shelled = judgeShell(handed, '/scratch/gh-config');

  assert.deepEqual(shelled.env, { ...handed.env, GH_CONFIG_DIR: '/scratch/gh-config' });
});

test('a non-login zsh under the live judge\'s environment finds gh in the fake forge\'s directory, ahead of any other gh', { skip: existsSync('/bin/zsh') ? false : 'this host has no /bin/zsh' }, () => {
  const base = realpathSync.native(temporaryDirectory('rigger-judge-shell-'));
  const forge = join(base, 'forge');
  mkdirSync(forge);
  writeFileSync(join(forge, 'gh'), '#!/bin/sh\necho fake\n', { mode: 0o755 });
  mkdirSync(join(base, 'gh-config'));
  const shelled = judgeShell({ ...handed, env: { CODEX_HOME: join(base, 'home'), PATH: `${forge}${delimiter}${process.env.PATH}` } }, join(base, 'gh-config'));

  const found = spawnSync('/bin/zsh', ['-c', 'command -v gh'], { encoding: 'utf8', env: { HOME: process.env.HOME, ...shelled.env } });

  assert.equal(found.status, 0, found.stderr);
  assert.equal(found.stdout.trim(), join(forge, 'gh'));
});
