// ABOUTME: Tests the path check: which backticked spans it reads as repository paths, what a
// ABOUTME: missing one costs, and how long the docs/derived/ exemption lasts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { backtickedPaths, check } from '../scripts/path-check.mjs';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a backticked span naming a file or a directory is a repository path', () => {
  const document = ['See `ARCHITECTURE.md` and `docs/spec/`, and read `.gitignore`.', ''].join('\n');
  assert.deepEqual(backtickedPaths(document), [
    { line: 1, path: 'ARCHITECTURE.md' },
    { line: 1, path: 'docs/spec/' },
    { line: 1, path: '.gitignore' },
  ]);
});

test('a backticked span naming an id, a verb or a column is not a repository path', () => {
  // The register and the instruction files backtick far more than paths. A check reading any of
  // these as one would demand a file for every id the corpus cites.
  const document = 'Cite `R-SAFE-5` and `D15`, run `npm test`, and fill `checked by` with `nothing yet`.\n';
  assert.deepEqual(backtickedPaths(document), []);
});

/** A repository whose checked document holds the given line, plus whatever files are named. */
function corpus(line, { exempt = {}, files = [], directories = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rigger-paths-'));
  writeFileSync(join(root, 'doc-references.json'), JSON.stringify({
    documents: { 'AGENTS.md': 'soft' },
    exempt: { paths: exempt },
  }));
  writeFileSync(join(root, 'AGENTS.md'), `${line}\n`);
  for (const directory of directories) mkdirSync(join(root, directory), { recursive: true });
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), 'A document.\n');
  }
  return root;
}

test('a backticked path that does not exist fails the build, naming the path', () => {
  const root = corpus('The roster is in `docs/derived/roster.md`.');
  const read = check(root);

  assert.equal(read.failing, true);
  assert.deepEqual(read.findings, [
    { path: 'AGENTS.md', line: 1, missing: 'docs/derived/roster.md' },
  ]);
});

test('a backticked path that exists is no finding', () => {
  const root = corpus('The rows are in `docs/spec/requirements.md`.', {
    files: ['docs/spec/requirements.md'],
  });
  assert.deepEqual(check(root).findings, []);
});

test('docs/derived/ is exempt while the directory does not exist', () => {
  // D8 rule 4: the directory is created by the first generated document, so until that document
  // lands there is nothing under it to find.
  const root = corpus('The matrix is `docs/derived/test-matrix.md`.', {
    exempt: { 'docs/derived/': 'D8 rule 4.' },
  });
  assert.deepEqual(check(root).findings, []);
});

test('the exemption ends when the directory exists, so a missing file under it is found', () => {
  const root = corpus('The matrix is `docs/derived/test-matrix.md`.', {
    exempt: { 'docs/derived/': 'D8 rule 4.' },
    directories: ['docs/derived'],
  });
  assert.deepEqual(check(root).findings.map((f) => f.missing), ['docs/derived/test-matrix.md']);
});

test('every backticked path in the current corpus exists or is exempt', () => {
  assert.deepEqual(check(repository).findings, []);
});
