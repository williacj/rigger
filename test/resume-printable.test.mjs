// ABOUTME: Tests the placement #1001 holds `rigger resume`'s unreadable-admission words to: L3 imports
// nothing from the CLI, and `src/cli/resume.mjs` defines no escaping, leaving it to `doctor.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scheduling = join(root, 'src', 'scheduling');
const cli = join(root, 'src', 'cli');

/** Every file under `directory`, at any depth, by its absolute path. */
const filesUnder = (directory) => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name));

/**
 * Each module specifier `source` names: after `from` in a static import or re-export, after a bare
 * `import`, and inside a dynamic `import(...)` whose argument is one quoted string.
 */
const specifiersIn = (source) => [
  ...source.matchAll(/\bfrom\s*(['"])([^'"]+)\1/g),
  ...source.matchAll(/\bimport\s*(['"])([^'"]+)\1/g),
  ...source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g),
].map((match) => match[2]);

/** Whether `path` lies inside `directory`. */
const inside = (directory, path) => {
  const from = relative(directory, path);
  return from !== '' && !from.startsWith('..') && !from.startsWith(sep);
};

test('no file under src/scheduling/ names a module under src/cli/', () => {
  // The defect this catches is L3 reaching up into the CLI for its words, which "Boundary rules"
  // rule 2 places in the CLI and #1001's placement leaves there.
  const files = filesUnder(scheduling);
  assert.ok(files.some((file) => file.endsWith('admission.mjs')), files.join(', '));
  const reaching = files.flatMap((file) => specifiersIn(readFileSync(file, 'utf8'))
    .filter((specifier) => specifier.startsWith('.') && inside(cli, resolve(dirname(file), specifier)))
    .map((specifier) => `${relative(root, file)} names ${specifier}`));
  assert.deepEqual(reaching, []);
});

test('src/cli/resume.mjs holds none of the instances of escaping #1001 names', () => {
  // The defect this catches is resume escaping an entry in words of its own, beside doctor.mjs's.
  const source = readFileSync(join(cli, 'resume.mjs'), 'utf8');
  const held = ['printable', 'charCodeAt', 'codePointAt', '\\u00', '\\x'].filter((instance) => source.includes(instance));
  assert.deepEqual(held, []);
});
