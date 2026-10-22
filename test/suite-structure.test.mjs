// ABOUTME: Tests process-free suite source and report contracts in the deterministic tier.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('both suite modes reach the one reaper launch', () => {
  const source = readFileSync('test/suite.sh', 'utf8');
  assert.equal(source.split("node test/suite-reaper ").length - 1, 1);
  assert.ok(source.indexOf('node test/suite-reaper ') > source.indexOf('suite_mode=deterministic'));
});
