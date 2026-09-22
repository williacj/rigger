// ABOUTME: Tests the duplicate-id check: where an allocated id is written, which files count
// ABOUTME: together, and what a second row carrying one costs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { check, idRows } from '../scripts/duplicate-id-check.mjs';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');

test('an id is what sits in the first column of a table the register headed `id`', () => {
  const document = [
    '| id | decision | status |',
    '|---|---|---|',
    '| D1 | Redo over resume | Ratified |',
    '| D2 | Every card carries its acceptance | Ratified |',
    '',
  ].join('\n');
  assert.deepEqual(idRows(document), ['D1', 'D2']);
});

test('a table the register headed something else allocates no id', () => {
  // The deferral tables name a deferred thing and the evidence that returns it. A check reading
  // their first column as ids would allocate a new id for every sentence in one.
  const document = [
    '| Deferred | Returns when |',
    '|---|---|',
    '| An architect role | Decompositions escalate as `ambiguous`. |',
    '',
  ].join('\n');
  assert.deepEqual(idRows(document), []);
});

test('an id named in a section heading is not a second allocation of it', () => {
  // A decision is written twice over: once as a row in the register table, and once as the body
  // below it. The row is the allocation, so only the row counts.
  const document = [
    '| id | decision | status |',
    '|---|---|---|',
    '| D8 | A fact the code owns is generated, never typed | Ratified |',
    '',
    '## D8 — A fact the code owns is generated, never typed',
    '',
  ].join('\n');
  assert.deepEqual(idRows(document), ['D8']);
});

/** A repository whose register holds the given files, each keyed by its name under docs/spec. */
function register(files) {
  const root = mkdtempSync(join(tmpdir(), 'rigger-ids-'));
  mkdirSync(join(root, 'docs', 'spec'), { recursive: true });
  for (const [name, rows] of Object.entries(files)) {
    const header = name.startsWith('decisions') ? '| id | decision | status |' : '| id | requirement |';
    writeFileSync(join(root, 'docs', 'spec', name), [header, '|---|---|', ...rows, ''].join('\n'));
  }
  return root;
}

test('a duplicate decision id fails the build, naming the id and every file it sits in', () => {
  const root = register({
    'decisions.md': ['| D1 | Redo over resume | Ratified |', '| D1 | Redo again | Ratified |'],
  });
  const read = check(root);

  assert.equal(read.failing, true);
  assert.deepEqual(read.findings, [{ id: 'D1', rows: ['docs/spec/decisions.md', 'docs/spec/decisions.md'] }]);
});

test('a requirement id counts across the live register and the retired one together', () => {
  // A retired id stays allocated, so reallocating one is a duplicate even though the two rows
  // never sit in the same file.
  const root = register({
    'requirements.md': ['| R-CARD-1 | A card states its acceptance. |'],
    'requirements-retired.md': ['| R-CARD-1 | A card stated its acceptance. |'],
  });

  assert.deepEqual(check(root).findings, [
    { id: 'R-CARD-1', rows: ['docs/spec/requirements-retired.md', 'docs/spec/requirements.md'] },
  ]);
});

test('an id allocated once in each register is no duplicate', () => {
  const root = register({
    'decisions.md': ['| D1 | Redo over resume | Ratified |'],
    'requirements.md': ['| R-CARD-1 | A card states its acceptance. |'],
    'requirements-retired.md': ['| R-CARD-2 | A card stated something else. |'],
  });
  assert.deepEqual(check(root).findings, []);
});

test('every id the current register allocates is allocated once', () => {
  assert.deepEqual(check(repository).findings, []);
});
