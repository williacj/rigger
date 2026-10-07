// ABOUTME: Proves a failed Claude judge run removes its session directory even with incomplete output.

import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { temporaryDirectory } from './temporary-directory.mjs';

const liveTest = new URL('./judge-head-live.test.mjs', import.meta.url).pathname;

/** Run the gated judge with a stand-in Claude that writes only beneath a private HOME. */
function failedSession(t, { malformed = false, omitId = false } = {}) {
  const root = temporaryDirectory('rigger-judge-home-', { context: t });
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const id = malformed ? '00000000-0000-0000-0000-000000000002' : '00000000-0000-0000-0000-000000000001';
  mkdirSync(home);
  mkdirSync(bin);
  const claude = join(bin, 'claude');
  writeFileSync(claude, `#!/usr/bin/env node
// ABOUTME: Writes a fixture Claude session and one incomplete stream-json response.
const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(path.join(process.env.HOME, '.claude', 'session-env', process.env.RIGGER_FAKE_SESSION_ID), { recursive: true });
const init = { type: 'system', subtype: 'init' };
if (process.env.RIGGER_FAKE_OMIT_ID !== '1') init.session_id = process.env.RIGGER_FAKE_SESSION_ID;
if (process.env.RIGGER_FAKE_MALFORMED === '1') process.stdout.write('not-json\\n');
process.stdout.write(JSON.stringify(init) + '\\n');
`);
  chmodSync(claude, 0o755);
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  const result = spawnSync(process.execPath, ['--test', liveTest], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...environment,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      RIGGER_LIVE_CLAUDE: '1',
      RIGGER_FAKE_SESSION_ID: id,
      RIGGER_FAKE_MALFORMED: malformed ? '1' : '0',
      RIGGER_FAKE_OMIT_ID: omitId ? '1' : '0',
    },
  });
  return { result, id, directory: join(home, '.claude', 'session-env', id) };
}

test('a judge without a result record removes its session directory', (t) => {
  const { result, id, directory } = failedSession(t);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(existsSync(directory), false, `session directory survived: ${directory}`);
  assert.match(result.stdout, new RegExp(`Claude session id: ${id}`));
  assert.match(result.stdout, /Claude result: undefined/);
});

test('a malformed Claude output line cannot bypass session teardown', (t) => {
  const { result, id, directory } = failedSession(t, { malformed: true });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(existsSync(directory), false, `session directory survived: ${directory}`);
  assert.match(result.stdout, new RegExp(`Claude session id: ${id}`));
  assert.match(result.stdout, /not-json|Unexpected token/);
});

test('a judge with no session id fails explicitly instead of passing an empty teardown check', (t) => {
  const { result } = failedSession(t, { omitId: true });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Claude session id was not found in any output record/);
});
