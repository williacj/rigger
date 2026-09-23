// ABOUTME: Tests the doc-reference resolver: what it reads a pointer as, which documents it
// ABOUTME: reads, and which of them a finding fails the build for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  check,
  documentChecking,
  pathLineLiterals,
} from '../scripts/doc-reference-check.mjs';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a hand-typed path:line literal is a pointer, and the finding names it', () => {
  const document = ['The layer table is here:', '', 'See ARCHITECTURE.md:121 for the row.', ''].join('\n');
  assert.deepEqual(pathLineLiterals(document), [{ line: 3, literal: 'ARCHITECTURE.md:121' }]);
});

test('a pointer is found wherever it sits, backticked or bare', () => {
  assert.deepEqual(
    pathLineLiterals('Read `src/execution/run.mjs:42` first.\n'),
    [{ line: 1, literal: 'src/execution/run.mjs:42' }],
  );
});

test('a colon and a number with no file before them is not a pointer', () => {
  // `node:fs` is a module specifier, `10:30` is a time, and `D8:` opens a clause. A resolver
  // that read any of them as a pointer would fail documents for prose they are allowed.
  const document = 'Import node:fs by 10:30, under D8: rule 4, at concurrency 3.\n';
  assert.deepEqual(pathLineLiterals(document), []);
});

test('a repository path carrying no line number is not a pointer', () => {
  // The path check is what reads those. The resolver reads only the pointers it can never verify.
  assert.deepEqual(pathLineLiterals('`docs/spec/requirements.md` holds the rows.\n'), []);
});

test('the register is strict and the root instruction file is soft', () => {
  const declared = documentChecking(repository).documents;
  assert.equal(declared['docs/spec/requirements.md'], 'strict');
  assert.equal(declared['docs/spec/decisions.md'], 'strict');
  assert.equal(declared['AGENTS.md'], 'soft');
});

/** A repository holding just the documents the checking config names, with the content given. */
function repositoryOf(content) {
  const root = mkdtempSync(join(tmpdir(), 'rigger-refs-'));
  mkdirSync(join(root, 'docs', 'spec'), { recursive: true });
  writeFileSync(join(root, 'doc-references.json'), JSON.stringify({
    documents: { 'AGENTS.md': 'soft', 'docs/spec/decisions.md': 'strict' },
    exempt: { paths: {} },
  }));
  writeFileSync(join(root, 'AGENTS.md'), content['AGENTS.md'] ?? 'Rules.\n');
  writeFileSync(join(root, 'docs', 'spec', 'decisions.md'), content.decisions ?? 'Decisions.\n');
  return root;
}

test('a pointer in a strict document fails the build, naming the file and the literal', () => {
  const root = repositoryOf({ decisions: 'D8 is at ARCHITECTURE.md:233.\n' });
  const read = check(root);

  assert.equal(read.failing, true);
  assert.deepEqual(read.findings, [
    { path: 'docs/spec/decisions.md', level: 'strict', line: 1, literal: 'ARCHITECTURE.md:233' },
  ]);
});

test('a pointer in a soft document is reported and does not fail the build', () => {
  const root = repositoryOf({ 'AGENTS.md': 'The rule is at ARCHITECTURE.md:233.\n' });
  const read = check(root);

  assert.equal(read.failing, false);
  assert.deepEqual(read.findings.map((f) => [f.path, f.level]), [['AGENTS.md', 'soft']]);
});

test('the checked documents hold no path:line pointer at any fail level', () => {
  assert.deepEqual(check(repository).findings, []);
});
