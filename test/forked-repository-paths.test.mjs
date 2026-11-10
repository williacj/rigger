// ABOUTME: Checks repository implementation paths in every asset init plans for a consumer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/cli/init.mjs';

const CONDITIONED = /\bwhere the repository defines it\b/i;
const MEMBER = /^(?:(?:scripts|test|docs\/journal)\/.+|docs\/v0-build-plan\.md)$/;
const consumerFiles = () => plan({ repo: 'acme/widgets', commit: 'a'.repeat(40) });

/**
 * The passage units of package.test.mjs: paragraphs, list items with continuations, and table
 * rows outside fenced blocks. Card #1343 admits this second copy without importing a test file.
 */
function passagesOf(text) {
  const passages = [];
  let current = null;
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; current = null; continue; }
    if (fenced || line.trim() === '') { current = null; continue; }
    if (current === null || /^\s*(?:[-*+]|\d+\.)\s|^\s*\||^#/.test(line)) {
      current = [];
      passages.push(current);
    }
    current.push(line);
  }
  return passages.map((lines) => lines.join(' ').replace(/\s+/g, ' '));
}

/** Assert the card's condition for every member, reporting all missing conditions together. */
function assertConditionedPaths(files) {
  const missing = files.flatMap(({ path, content }) => passagesOf(content).flatMap((passage) =>
    [...passage.matchAll(/`([^`]+)`/g)]
      .map(([, span]) => span.trim())
      .filter((span) => MEMBER.test(span) && !CONDITIONED.test(passage))
      .map((span) => `${path}: ${span}`)));
  assert.deepEqual(missing, [], 'forked repository implementation paths must sit in conditioned passages');
}

// Losing a condition sends a fresh consumer to an implementation file it does not hold.
test('every repository implementation path init forks sits in a conditioned passage', () => {
  const files = consumerFiles();
  assert.ok(files.some(({ path }) => path.startsWith('.claude/skills/')), 'init must plan consumer skills');
  assertConditionedPaths(files);
});

// A condition in another paragraph, list item or table row must not excuse a missing path.
test('the forked-path check rejects unconditioned members in each passage form', () => {
  const forked = consumerFiles().find(({ path }) => path === '.claude/skills/spec-style/SKILL.md');
  assert.ok(forked, 'init must plan the skill used by this counterexample');
  const content = [
    'Where the repository defines it, read `scripts/conditioned.mjs`.',
    '',
    'Read `scripts/consumer-check.mjs` before handing off.',
    '',
    '- Where the repository defines it, read `test/conditioned.mjs`.',
    '- Read `test/consumer-check.mjs` before handing off.',
    '| Where the repository defines it, read `docs/journal/conditioned.md`. |',
    '| Read `docs/journal/consumer-note.md` before handing off. |',
    '',
    'Read `docs/v0-build-plan.md` before handing off.',
    '',
    '```text',
    'Read `scripts/fenced.mjs`.',
    '```',
  ].join('\n');
  assert.throws(() => assertConditionedPaths([{ ...forked, content }]), {
    code: 'ERR_ASSERTION',
    actual: [
      '.claude/skills/spec-style/SKILL.md: scripts/consumer-check.mjs',
      '.claude/skills/spec-style/SKILL.md: test/consumer-check.mjs',
      '.claude/skills/spec-style/SKILL.md: docs/journal/consumer-note.md',
      '.claude/skills/spec-style/SKILL.md: docs/v0-build-plan.md',
    ],
    expected: [],
  });
});

// Treating a convention as an implementation reference would reject valid consumer instructions.
test('the forked-path check permits the three bare directory conventions', () => {
  const forked = consumerFiles().find(({ path }) => path === '.claude/skills/spec-style/SKILL.md');
  assert.ok(forked, 'init must plan the skill used by this counterexample');
  assertConditionedPaths([{ ...forked,
    content: 'Use `scripts/`, `test/` and `docs/journal/` for repository conventions.\n',
  }]);
});
