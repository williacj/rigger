// ABOUTME: Checks the maker's grant sequence and the session rule for ending processes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('the maker completes and tests local work before one request for uncovered test lines', () => {
  const prompt = read('.claude/agents/engineer.md');
  assert.match(prompt, /whole change locally[\s\S]*?npm test[\s\S]*?ask once/i);
  assert.match(prompt, /text at base and head/i);
  assert.match(prompt, /delet(?:e|ing|ion) a test/i);
  assert.match(prompt, /grant class[\s\S]*?pull request/i);
  assert.match(prompt, /do not push[\s\S]*?grant/i);
});

test('grant classes are bounded by visible test lines and cannot weaken a test', () => {
  const skill = read('.claude/skills/acceptance/SKILL.md');
  assert.match(skill, /bounded grant classes[\s\S]*?git diff/i);
  assert.match(skill, /assertion lines[\s\S]*?fixture lines/i);
  assert.match(skill, /delet(?:e|ion) of a test[\s\S]*?weaken/i);
});

test('a session ends only its own recorded process, by command', () => {
  const rules = read('AGENTS.md');
  assert.match(rules, /command it runs[\s\S]*?recorded its pid at start/i);
  assert.match(rules, /process it did not start[\s\S]*?owner/i);
  assert.match(rules, /commands[\s\S]*?not code it writes/i);
});
