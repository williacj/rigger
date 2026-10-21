// ABOUTME: Checks that the default test suite gives every CLI-folder sweep a disposable home.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listCliFolder } from '../src/execution/workspace.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

// proves R-WORK-31
test('the suite refuses a Claude folder outside its own temporary home', () => {
  assert.ok(process.env.RIGGER_TEST_TEMP_ROOT);
  assert.ok(process.env.CLAUDE_CONFIG_DIR?.startsWith(`${process.env.RIGGER_TEST_TEMP_ROOT}/`));
  assert.ok(existsSync(process.env.CLAUDE_CONFIG_DIR));
  const record = join(temporaryDirectory('rigger-claude-home-audit-'), 'unsafe');
  const suiteRecord = process.env.RIGGER_TEST_CLAUDE_HOME_RECORD;
  assert.ok(suiteRecord);
  process.env.RIGGER_TEST_CLAUDE_HOME_RECORD = record;
  try {
    const outside = listCliFolder({ home: join(process.env.HOME, '.claude'), name: 'not-a-real-session-629' });
    assert.match(outside.reason, /outside the test suite's temporary directory/);
    assert.match(readFileSync(record, 'utf8'), /\.claude/);
  } finally {
    process.env.RIGGER_TEST_CLAUDE_HOME_RECORD = suiteRecord;
  }
});
