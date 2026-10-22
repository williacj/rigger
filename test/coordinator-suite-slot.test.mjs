// ABOUTME: Runs tools/coordinator/suite-slot.test.sh, the host-wide test slot's own tests, with stub
// `codex` and `gh` first on PATH, and checks it passed and left the tooling directory unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TOOLS, assertToolingClean, run, world } from './coordinator-fixtures.mjs';

// The slot is read from `CODEX_TOOLS_DIR` where it is set, as the launchers' tests read theirs.
const SLOT_DIR = process.env.CODEX_TOOLS_DIR || TOOLS;

test('suite-slot.test.sh passes every check it holds', () => {
  const w = world('coord-suite-slot-');
  const result = run(w, '/bin/bash', [join(SLOT_DIR, 'suite-slot.test.sh')], { timeout: 900_000 });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /^# pass [0-9]+ fail 0$/m);
  assert.doesNotMatch(result.stdout, /^FAIL /m);
  assertToolingClean();
});

test('with SUITE_SLOT_DIR unset, suite-slot.sh keeps its lock and log in suite-slot under RIGGER_WORKTREE_ROOT, and nothing under HOME', () => {
  const w = world('coord-suite-slot-root-');
  const root = join(w.base, 'root');
  const held = join(w.base, 'held');
  // The command copies the lock while it holds the slot, so the test reads where the lock was.
  const result = run(w, join(SLOT_DIR, 'suite-slot.sh'), ['wroot', '--', '/bin/sh', '-c', 'cat "$0/lock" > "$1"', join(root, 'suite-slot'), held], {
    env: { RIGGER_WORKTREE_ROOT: root, SUITE_SLOT_LOAD_CMD: 'echo 1' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(held, 'utf8'), /^label=wroot$/m, 'the lock was suite-slot/lock under RIGGER_WORKTREE_ROOT');
  assert.match(readFileSync(join(root, 'suite-slot', 'suite-slot.log'), 'utf8'), /event=end label=wroot/);
  assert.equal(existsSync(join(root, 'suite-slot', 'lock')), false, 'the lock is released');
  assert.deepEqual(readdirSync(w.home), []);
  assertToolingClean();
});
