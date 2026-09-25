// ABOUTME: Tests the fake `gh`, the fake board's face as the forge's command: the commands it
// answers, what the real adapter reads and writes through it, and its refusal of anything else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installFakeGh } from './fake-gh.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';

/** Where the fake `gh` says its board lives: this repository's board, as its config names it. */
const WHERE = { repo: 'williacj/rigger', project: 6 };

/** A fake `gh` holding `board`, installed in a directory of its own. */
const installed = (board = {}) => installFakeGh(mkdtempSync(join(tmpdir(), 'rigger-fake-gh-')), { ...WHERE, board });

test('given a gh command it does not model, the fake gh exits non-zero and prints the command', () => {
  const fake = installed({ columns: ['Ready'] });
  const unmodelled = [
    ['issue', 'close', '214'],
    ['auth', 'status'],
    ['api', 'graphql', '-f', 'query=query { viewer { login } }'],
    ['api', 'repos/williacj/rigger/labels', '-X', 'GET'],
  ];

  for (const args of unmodelled) {
    // Spawned as the forge runners spawn `gh`, in the environment a git child is given.
    const said = spawnSync(fake.gh, args, { encoding: 'utf8', env: gitEnvironment() });

    assert.notEqual(said.status, 0, `the fake gh answered ${args.join(' ')}`);
    assert.ok(said.stderr.includes(`gh ${args.join(' ')}`), `the fake gh did not print the command: ${said.stderr}`);
    assert.equal(said.stdout, '');
  }
});
