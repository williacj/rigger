// ABOUTME: Runs tools/coordinator/suite-slot.test.sh, the host-wide test slot's own tests, with stub
// `codex` and `gh` first on PATH, and checks it passed and left the tooling directory unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { TOOLS, assertToolingClean, run, world } from './coordinator-fixtures.mjs';

test('suite-slot.test.sh passes every check it holds', () => {
  const w = world('coord-suite-slot-');
  const result = run(w, '/bin/bash', [join(TOOLS, 'suite-slot.test.sh')], { timeout: 900_000 });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /^# pass [0-9]+ fail 0$/m);
  assert.doesNotMatch(result.stdout, /^FAIL /m);
  assertToolingClean();
});
