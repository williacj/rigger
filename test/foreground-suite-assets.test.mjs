// ABOUTME: Pins the Claude project settings that keep a maker's Bash command in the foreground.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Claude project settings give Bash a 30 minute default and maximum timeout', () => {
  const settings = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8'));
  assert.equal(settings.env?.BASH_DEFAULT_TIMEOUT_MS, '1800000');
  assert.equal(settings.env?.BASH_MAX_TIMEOUT_MS, '1800000');
});

test('the Claude settings and engineer prompt match the templates init writes', () => {
  for (const name of ['settings.json', 'agents/engineer.md']) {
    const live = readFileSync(new URL(`../.claude/${name}`, import.meta.url));
    const template = readFileSync(new URL(`../templates/claude/${name}`, import.meta.url));
    assert.deepEqual(live, template, `${name} differs from its template`);
  }
});
