// ABOUTME: Checks repository implementation paths in every asset init plans for a consumer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, relative, resolve } from 'node:path';
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
      .filter((span) => MEMBER.test(relative(process.cwd(), resolve(span))) && !CONDITIONED.test(passage))
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
  const forked = consumerFiles().find(({ path }) => path.startsWith('.claude/skills/'));
  assert.ok(forked, 'init must plan the skill used by this counterexample');
  const repository = basename(process.cwd());
  const matrix = [
    ['plain', ['scripts/consumer-check.mjs', 'test/consumer-check.mjs',
      'docs/journal/consumer-note.md', 'docs/v0-build-plan.md']],
    ['./ prefix', ['./scripts/consumer-check.mjs', './test/consumer-check.mjs',
      './docs/journal/consumer-note.md', './docs/v0-build-plan.md']],
    ['../ return', [`../${repository}/scripts/consumer-check.mjs`,
      `../${repository}/test/consumer-check.mjs`, `../${repository}/docs/journal/consumer-note.md`,
      `../${repository}/docs/v0-build-plan.md`]],
    ['repeated slashes', ['scripts//consumer-check.mjs', 'test//consumer-check.mjs',
      'docs//journal//consumer-note.md', 'docs//v0-build-plan.md']],
    ['subdirectory slash', ['scripts/generated/', 'test/fixtures/', 'docs/journal/notes/']],
  ];
  for (const [spelling, spans] of matrix) {
    for (const span of spans) {
      const contexts = [
        ['Where the repository defines it, read `scripts/conditioned.mjs`.', '',
          `Read \`${span}\` before handing off.`],
        ['- Where the repository defines it, read `test/conditioned.mjs`.',
          `- Read \`${span}\` before handing off.`],
        ['| Where the repository defines it, read `docs/journal/conditioned.md`. |',
          `| Read \`${span}\` before handing off. |`],
      ];
      for (const lines of contexts) {
        assert.throws(() => assertConditionedPaths([{ ...forked, content: lines.join('\n') }]),
          undefined, `${spelling}: ${span}: ${lines.at(-1)}`);
      }
    }
  }
  assert.doesNotThrow(() => assertConditionedPaths([{ ...forked, content: [
    'Where the repository defines it, read `scripts/conditioned.mjs`, `test/conditioned.mjs` and',
    '`docs/journal/conditioned.md`.',
    '',
    '```text',
    'Read `scripts/fenced.mjs`.',
    '```',
  ].join('\n') }]));
});

// Treating a convention as an implementation reference would reject valid consumer instructions.
test('the forked-path check permits the three bare directory conventions', () => {
  const forked = consumerFiles().find(({ path }) => path.startsWith('.claude/skills/'));
  assert.ok(forked, 'init must plan the skill used by this counterexample');
  assertConditionedPaths([{ ...forked,
    content: 'Use `scripts/`, `test/` and `docs/journal/` for repository conventions.\n',
  }]);
});
