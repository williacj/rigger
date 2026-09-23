// ABOUTME: One fixture per document check, each holding exactly one defect, proving that each
// ABOUTME: check fails for its own reason and that the other three stay quiet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { check as lint } from '../scripts/spec-style-lint.mjs';
import { check as references } from '../scripts/doc-reference-check.mjs';
import { check as paths } from '../scripts/path-check.mjs';
import { check as ids } from '../scripts/duplicate-id-check.mjs';

const CHECKS = { lint, references, paths, ids };

/**
 * A repository small enough to read and complete enough for all four checks to run on: a skill
 * stating the rules, the documents the skill and the config name, and a register allocating one
 * id of each kind. Each defect below is one line added to it, and nothing else.
 */
function repositoryOf(defect = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rigger-checks-'));
  const files = {
    '.claude/skills/spec-style/SKILL.md': [
      '---',
      'description: Four form rules for any diff touching README.md, ARCHITECTURE.md or docs/spec/.',
      '---',
      '',
      '### 1. One term per concept',
      '',
      'A judge returns a **verdict**, never an approval.',
      '',
      '### 2. Sentences of about 25 words, and never past 40',
      '',
      'Split a compound.',
    ],
    'doc-references.json': [JSON.stringify({
      documents: { 'AGENTS.md': 'soft', 'docs/spec/decisions.md': 'strict' },
      exempt: { paths: {} },
    })],
    'README.md': ['# Rigger', '', 'The engine runs the loop.'],
    'ARCHITECTURE.md': ['# Architecture', '', 'Eight layers, each with one job.'],
    'AGENTS.md': ['# Rules', '', 'Read `README.md` before you start.', defect.paths ?? ''],
    'docs/spec/requirements.md': [
      '# Requirements',
      '',
      '| id | requirement | made true by | checked by | from |',
      '|---|---|---|---|---|',
      '| R-CARD-1 | A card states its acceptance. | the author | the engine | D2 |',
    ],
    'docs/spec/requirements-retired.md': [
      '# Retired requirements',
      '',
      '| id | requirement | from | withdrawn | replaced by |',
      '|---|---|---|---|---|',
      '| R-CARD-2 | A card stated something else. | D2 | 2026-01-01 | |',
    ],
    'docs/spec/decisions-retired.md': ['# Retired decisions', '', 'Nothing here binds.'],
    'docs/spec/decisions.md': [
      '# Decision register',
      '',
      '| id | decision | status |',
      '|---|---|---|',
      '| D1 | Redo over resume | Ratified |',
      defect.ids ?? '',
      '',
      '## D1 — Redo over resume',
      '',
      'Rigger recovers by redo.',
      defect.lint ?? '',
      defect.references ?? '',
    ],
  };
  for (const [path, lines] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `${lines.join('\n')}\n`);
  }
  return root;
}

/** Which of the four checks fail on a repository, by name. */
const failures = (root) => Object.entries(CHECKS)
  .filter(([, run]) => run(root).failing)
  .map(([name]) => name)
  .sort();

test('a repository with no defect passes all four checks', () => {
  assert.deepEqual(failures(repositoryOf()), []);
});

test('a sentence past the ceiling fails the lint and no other check', () => {
  const overlong = `${Array.from({ length: 41 }, () => 'word').join(' ')}.`;
  assert.deepEqual(failures(repositoryOf({ lint: `\n${overlong}` })), ['lint']);
});

test('a path:line pointer fails the resolver and no other check', () => {
  assert.deepEqual(failures(repositoryOf({ references: '\nThe rule is at `ARCHITECTURE.md:233`.' })), ['references']);
});

test('a backticked path that does not exist fails the path check and no other check', () => {
  assert.deepEqual(failures(repositoryOf({ paths: '\nThe roster is in `docs/derived/roster.md`.' })), ['paths']);
});

test('a second row carrying an allocated id fails the id check and no other check', () => {
  assert.deepEqual(failures(repositoryOf({ ids: '| D1 | Redo once more | Ratified |' })), ['ids']);
});
