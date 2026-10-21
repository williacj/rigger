// ABOUTME: Checks that the suite makes the Claude home used by non-gated dispatches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { temporaryDirectory } from './temporary-directory.mjs';

test('the suite gives non-gated dispatches its own Claude home with the live flag on', () => {
  const home = join(process.env.TMPDIR, 'claude-home');
  assert.equal(process.env.CLAUDE_CONFIG_DIR, home);
  assert.ok(existsSync(home));
});

test('the suite audit records a CLI sweep aimed outside its temporary home', () => {
  const privateRoot = temporaryDirectory('rigger-claude-audit-');
  const preload = join(privateRoot, 'runner.cjs');
  copyFileSync(join(process.env.TMPDIR, 'runner.cjs'), preload);
  const outside = temporaryDirectory('rigger-claude-outside-');
  mkdirSync(join(outside, 'projects'));
  const workspace = new URL('../src/execution/workspace.mjs', import.meta.url).href;
  const code = `import assert from 'node:assert/strict'; import { listCliFolder, sweepCliFolder } from ${JSON.stringify(workspace)}; const listing = listCliFolder({ home: process.argv[1], name: 'synthetic-629' }); assert.match(listing.reason, /test suite refused/); sweepCliFolder(listing);`;
  const child = spawnSync(process.execPath, ['--require', preload, '--input-type=module', '--eval', code, outside], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(readFileSync(join(dirname(preload), 'unsafe-claude-homes'), 'utf8'), `${outside}\n`);
});

test('the suite audit lets a gated Claude live test use the owner home', () => {
  const privateRoot = temporaryDirectory('rigger-claude-live-audit-');
  const preload = join(privateRoot, 'runner.cjs');
  copyFileSync(join(process.env.TMPDIR, 'runner.cjs'), preload);
  const outside = temporaryDirectory('rigger-claude-live-outside-');
  mkdirSync(join(outside, 'projects'));
  const workspace = new URL('../src/execution/workspace.mjs', import.meta.url).href;
  const liveDirectory = join(privateRoot, 'test');
  mkdirSync(liveDirectory);
  const liveFile = join(liveDirectory, 'provider-claude-live.test.mjs');
  writeFileSync(liveFile, `import assert from 'node:assert/strict'; import { listCliFolder } from ${JSON.stringify(workspace)}; const listing = listCliFolder({ home: process.argv[2], name: 'synthetic-629' }); assert.equal(listing.reason, undefined);`);
  const child = spawnSync(process.execPath, ['--require', preload, liveFile, outside], {
    encoding: 'utf8', env: { ...process.env, RIGGER_LIVE_CLAUDE: '1', NODE_OPTIONS: '' },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(existsSync(join(privateRoot, 'unsafe-claude-homes')), false);
});
