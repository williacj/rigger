// ABOUTME: Tests where the code that renames a hold's closer lives: every call of admission.mjs's rename
// is under src/scheduling/, and no module under src/workflow/ renames a file or reaches admission.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every module under `directory`, as a path relative to the repository's root, with its text. */
const modulesUnder = (directory) => readdirSync(join(root, directory), { recursive: true })
  .filter((name) => name.endsWith('.mjs'))
  .map((name) => ({ path: relative(root, join(root, directory, name)), text: readFileSync(join(root, directory, name), 'utf8') }));

// proves R-SCHED-20
test('every call of admission.mjs\'s rename sits under src/scheduling/, and no module under src/workflow/ renames a file or imports admission.mjs', () => {
  const renaming = modulesUnder('src').filter(({ text }) => /\.rename\(/.test(text)).map(({ path }) => path);
  const workflow = modulesUnder('src/workflow');

  assert.deepEqual(renaming, ['src/scheduling/loop.mjs']);
  assert.deepEqual(workflow.filter(({ text }) => /rename(Sync)?\(|from '[^']*admission\.mjs'|from 'node:fs'/.test(text)).map(({ path }) => path), []);
});
