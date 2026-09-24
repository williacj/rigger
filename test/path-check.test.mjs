// ABOUTME: Tests the path check: which backticked spans it reads as repository paths, what a
// missing one costs, how long the docs/derived/ exemption lasts, and which exemptions the
// check reports as spent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { backtickedPaths, check, spentExemptions } from '../scripts/path-check.mjs';
import { documentChecking } from '../scripts/doc-reference-check.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';

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
  // these as one would demand a file for every id they cite.
  const document = 'Cite `R-SAFE-5` and `D15`, run `npm test`, and fill `checked by` with `nothing yet`.\n';
  assert.deepEqual(backtickedPaths(document), []);
});

test('a dotted JavaScript member is not a repository path', () => {
  const document = 'The `String.raw` title and `process.exit` call are code, while `README.md` is a file.';
  assert.deepEqual(backtickedPaths(document), [{ line: 1, path: 'README.md' }]);
});

test('a missing root file keeps its path status across short extensions', () => {
  const document = 'Read `missing.js`, `missing.cjs`, and `missing.sh` before dispatch.';
  assert.deepEqual(backtickedPaths(document), [
    { line: 1, path: 'missing.js' },
    { line: 1, path: 'missing.cjs' },
    { line: 1, path: 'missing.sh' },
  ]);
});

/** A repository whose checked document holds the given line, plus whatever files are named. */
function repositoryOf(line, { exempt = {}, files = [], directories = [] } = {}) {
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
  const root = repositoryOf('The roster is in `docs/derived/roster.md`.');
  const read = check(root);

  assert.equal(read.failing, true);
  assert.deepEqual(read.findings, [
    { path: 'AGENTS.md', line: 1, missing: 'docs/derived/roster.md' },
  ]);
});

test('a backticked path that exists is no finding', () => {
  const root = repositoryOf('The rows are in `docs/spec/requirements.md`.', {
    files: ['docs/spec/requirements.md'],
  });
  assert.deepEqual(check(root).findings, []);
});

test('docs/derived/ is exempt while the directory does not exist', () => {
  // D8 rule 4: the directory is created by the first generated document, so until that document
  // lands there is nothing under it to find.
  const root = repositoryOf('The matrix is `docs/derived/test-matrix.md`.', {
    exempt: { 'docs/derived/': 'D8 rule 4.' },
  });
  assert.deepEqual(check(root).findings, []);
});

test('the exemption ends when the directory exists, so a missing file under it is found', () => {
  const root = repositoryOf('The matrix is `docs/derived/test-matrix.md`.', {
    exempt: { 'docs/derived/': 'D8 rule 4.' },
    directories: ['docs/derived'],
  });
  assert.deepEqual(check(root).findings.map((f) => f.missing), ['docs/derived/test-matrix.md']);
});

test('an exemption whose prefix exists is spent, so the absence its reason states is reported', () => {
  // The reason is prose nothing parses, but every reason ever written here asserted the one
  // proposition the mechanism acts on: the prefix is absent. Once it is there, that assertion is
  // false whatever the sentence around it says, and the entry excuses nothing while claiming to.
  const root = repositoryOf('The matrix is `docs/derived/test-matrix.md`.', {
    exempt: { 'docs/derived/': 'D8 rule 4: nothing under it exists until the test matrix lands.' },
    directories: ['docs/derived'],
  });
  assert.deepEqual(spentExemptions(root, documentChecking(root).exempt.paths), ['docs/derived/']);
});

test('an exemption whose prefix is still absent is no finding, and still excuses its paths', () => {
  // The other half, and the one that decides whether this check is worth having: a correct
  // exemption stays quiet. A check that flagged it would pay the next author to delete a
  // legitimate entry to quieten the build, which is worse than the reason nobody reads.
  const root = repositoryOf('The matrix is `docs/derived/test-matrix.md`.', {
    exempt: { 'docs/derived/': 'D8 rule 4: nothing under it exists until the test matrix lands.' },
  });
  assert.deepEqual(spentExemptions(root, documentChecking(root).exempt.paths), []);
  assert.deepEqual(check(root).findings, []);
});

test('the document config checks every tracked agent prompt and skill, including template twins', () => {
  const tracked = execFileSync('git', ['-C', repository, 'ls-files', '-z', '--', '.claude', 'templates/claude'], {
    encoding: 'utf8',
    env: gitEnvironment(),
  }).split('\0').filter((path) => path.endsWith('.md')).sort();
  const documents = documentChecking(repository).documents;
  const configured = Object.keys(documents)
    .filter((path) => path.startsWith('.claude/') || path.startsWith('templates/claude/'))
    .sort();
  assert.deepEqual(configured, tracked);
  for (const path of tracked) assert.equal(documents[path], 'strict', `${path} must fail on a pointer`);
});

test('every tracked spike report is a checked document that no path exemption covers', () => {
  // A spike report is merged prose a later card cites, so its references resolve like any other
  // document's. The break this catches: a new report lands under docs/spikes/ and nobody adds it
  // to the config, so nothing ever reads its references — card #157's fault, one report on.
  const tracked = execFileSync('git', ['-C', repository, 'ls-files', '-z', '--', 'docs/spikes'], {
    encoding: 'utf8',
    env: gitEnvironment(),
  }).split('\0').filter((path) => path.endsWith('.md')).sort();
  const { documents, exempt } = documentChecking(repository);

  assert.ok(tracked.length > 0, 'a tracked report is what this test has to read');
  for (const path of tracked) assert.equal(documents[path], 'strict', `${path} must fail on a pointer`);
  assert.deepEqual(Object.keys(exempt.paths).filter((prefix) => prefix.startsWith('docs/spikes')), [],
    'the directory is tracked, so no exemption under it can claim it is absent');
});

test('no exemption in the config claims an absence this repository contradicts', () => {
  // The config holds no exemption today, so this reads an empty set and says so. That is the
  // measurement rather than a gap: what it buys is the next entry, because the two exemptions
  // this file has ever carried both went false exactly this way and neither was caught by a
  // check. The demonstration that it discriminates is a deliberately false entry, recorded in
  // docs/journal/ under card #169's slug.
  const { exempt } = documentChecking(repository);
  assert.deepEqual(spentExemptions(repository, exempt.paths), []);
});

test('every backticked path in the checked documents exists or is exempt', () => {
  assert.deepEqual(check(repository).findings, []);
});
