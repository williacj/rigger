// ABOUTME: The check that no file under test/ calls mkdtempSync but the shared helper, which removes
// what it makes when its test ends (O58 on #540), naming each file and line that does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { temporaryDirectory } from './temporary-directory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The one file allowed to call it, relative to the directory scanned. */
const HELPER = 'temporary-directory.mjs';

/** Every `file:line` under `directory` whose line calls `mkdtempSync`, outside the helper. */
function bareMkdtemps(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
    .map((entry) => relative(directory, join(entry.parentPath ?? entry.path, entry.name)))
    .filter((path) => path !== HELPER)
    .sort()
    .flatMap((path) => readFileSync(join(directory, path), 'utf8').split('\n')
      .map((line, index) => (/\bmkdtempSync\s*\(/.test(line) ? `test/${path}:${index + 1}` : null))
      .filter(Boolean));
}

test('no file under test/ calls mkdtempSync but the shared temporary-directory helper', () => {
  const found = bareMkdtemps(HERE);
  assert.deepEqual(found, [], `these lines call mkdtempSync, whose directory nothing removes; make it with temporaryDirectory from test/${HELPER} instead:\n${found.join('\n')}`);
});

test('the check names the file and the line of a bare mkdtempSync, in a nested directory too, and passes the helper and a mention that calls nothing', () => {
  const root = temporaryDirectory('rigger-bare-mkdtemp-');
  mkdirSync(join(root, 'nested'));
  // The call is built from two strings, so that this file holds none for the check above to find.
  const call = 'mkdtempSync' + ' (';
  writeFileSync(join(root, HELPER), `const made = ${call}join(tmpdir(), 'x-'));\n`);
  writeFileSync(join(root, 'mentions.test.mjs'), "const WRITES = ['mkdtempSync', 'rmSync'];\n");
  writeFileSync(join(root, 'nested', 'leaks.mjs'), `import { mkdtempSync } from 'node:fs';\n\nconst dir = ${call}join(tmpdir(), 'rigger-leak-'));\n`);

  assert.deepEqual(bareMkdtemps(root), ['test/nested/leaks.mjs:3']);
});
