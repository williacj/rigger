// ABOUTME: Checks the maker's grant-free test-edit rule (D33 rule 3) and the session rule for ending processes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('the maker changes only the tests D33 rule 3 reaches, under its conditions, with no grant', () => {
  const prompt = read('.claude/agents/engineer.md');
  assert.match(prompt, /\*\*Change only the tests `D33` rule 3 reaches\*\*, and under its conditions\.\s+They need no grant\./);
  assert.doesNotMatch(prompt, /whole change locally|ask once|grant class/i);
});

test('test edits need no grant, and a card words its test-line item by D33 rule 3', () => {
  const skill = read('.claude/skills/acceptance/SKILL.md');
  assert.match(skill, /\*\*Test edits need no grant\.\*\* The maker may change the tests `D33` rule 3 reaches, under its\s+conditions\./);
  assert.match(skill, /`git diff` against the base changes\s+no existing line under `test\/` outside a test `D33` rule 3 reaches\./);
  assert.doesNotMatch(skill, /grant class/i);
});

test('a session ends only its own recorded process, by command', () => {
  const rules = read('AGENTS.md');
  assert.match(rules, /command it runs[\s\S]*?recorded its pid at start/i);
  assert.match(rules, /process it did not start[\s\S]*?owner/i);
  assert.match(rules, /commands[\s\S]*?not code it writes/i);
});

test('a change to an existing test D33 rule 3 does not reach is outside the card, with no grant to ask for', () => {
  const prompt = read('.claude/agents/engineer.md');
  assert.match(prompt, /They need no grant\.\s+A change to any other existing test is outside the card\./);
  assert.doesNotMatch(prompt, /until granted/i);
});

test('the acceptance reviewer checks that cited sources are posted and linked', () => {
  const skill = read('.claude/skills/acceptance/SKILL.md');
  assert.match(skill, /That agent checks[\s\S]*?It also checks that every cited proposal, ruling or grant is posted[\s\S]*?linked from the card/i);
});
