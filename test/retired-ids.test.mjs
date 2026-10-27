// ABOUTME: Checks the shared retired-id reader against the registers it reads and their formats.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as allocations from '../scripts/duplicate-id-check.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

test('the retired-id reader returns both registers allocations without typing their ids', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const requirements = readFileSync(new URL('../docs/spec/requirements-retired.md', import.meta.url), 'utf8');
  const decisions = readFileSync(new URL('../docs/spec/decisions-retired.md', import.meta.url), 'utf8');
  const rows = requirements.split('\n').filter((line) => line.startsWith('| R-'))
    .map((line) => line.split('|')[1].trim());
  const headings = decisions.split('\n').filter((line) => line.startsWith('## D'))
    .map((line) => line.split(' ')[1]);
  assert.ok(rows.length > 0 && headings.length > 0, 'both registers must supply the premise');
  assert.equal(typeof allocations.retiredIds, 'function', 'the shared retired-id reader is exported');
  assert.deepEqual(allocations.retiredIds(root), new Set([...rows, ...headings]));
});

test('retired ids reads allocating requirement tables and decision headings rather than citations', () => {
  const root = temporaryDirectory('978-retired-');
  const register = join(root, 'docs/spec');
  mkdirSync(register, { recursive: true });
  writeFileSync(join(register, 'requirements-retired.md'), [
    'A citation R-EXAMPLE-8.', '| id | requirement |', '|---|---|', '| R-EXAMPLE-7 | withdrawn |',
    '', '| other | text |', '|---|---|', '| R-EXAMPLE-9 | only a mention |', '',
  ].join('\n'));
  writeFileSync(join(register, 'decisions-retired.md'), [
    'A citation D715.', '### D716 — subsection', '## D713 —', '## D714 — heading',
    '| id | decision |', '|---|---|', '| D717 | not a heading |', '',
  ].join('\n'));
  assert.deepEqual(allocations.retiredIds(root), new Set(['R-EXAMPLE-7', 'D713', 'D714']));
});
