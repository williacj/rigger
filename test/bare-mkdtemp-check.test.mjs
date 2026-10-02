// ABOUTME: The check that no file under test/ names mkdtempSync in its code but the shared helper,
// which removes what it makes when its test ends (O58 on #540), naming each file and line that does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tokenizer } from 'acorn';

import { temporaryDirectory } from './temporary-directory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The one file allowed to call it, relative to the directory scanned. */
const HELPER = 'temporary-directory.mjs';

/**
 * Every `file:line` under `directory`, outside the helper, where the code names `mkdtempSync`: a
 * call, an import, an alias's source, a destructured key or a namespace's property. A file read as
 * tokens rather than lines, so a call split across lines is found and a mention in a string or a
 * comment is not. A file the tokenizer cannot read fails the check, naming the file.
 */
function bareMkdtemps(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
    .map((entry) => relative(directory, join(entry.parentPath ?? entry.path, entry.name)))
    .filter((path) => path !== HELPER)
    .sort()
    .flatMap((path) => namings(join(directory, path)).map((line) => `test/${path}:${line}`));
}

/** The line of every token in the file at `path` that is the name `mkdtempSync`. */
function namings(path) {
  const source = readFileSync(path, 'utf8');
  const options = { ecmaVersion: 'latest', sourceType: /\.cjs$/.test(path) ? 'script' : 'module', locations: true, allowHashBang: true };
  try {
    return [...tokenizer(source, options)].filter((token) => token.type.label === 'name' && token.value === 'mkdtempSync').map((token) => token.loc.start.line);
  } catch (error) {
    throw new Error(`the mkdtempSync check could not read ${path}: ${error.message}`);
  }
}

test('no file under test/ names mkdtempSync in its code but the shared temporary-directory helper', () => {
  const found = bareMkdtemps(HERE);
  assert.deepEqual(found, [], `these lines name mkdtempSync, whose directory nothing removes; make it with temporaryDirectory from test/${HELPER} instead:\n${found.join('\n')}`);
});

test('the check names the file and the line of every mkdtempSync named in code, aliased, destructured, through its namespace or called on the next line, and passes the helper and mentions in strings and comments', () => {
  const root = temporaryDirectory('rigger-bare-mkdtemp-');
  mkdirSync(join(root, 'nested'));
  // The name and its opening parenthesis are written apart, so that the git grep for the call that
  // item 3 on #540 quotes finds no fixture here.
  const call = 'mkdtempSync' + '(';
  writeFileSync(join(root, HELPER), `import { mkdtempSync } from 'node:fs';\nconst made = ${call}join(tmpdir(), 'x-'));\n`);
  writeFileSync(join(root, 'mentions.test.mjs'), [
    "const WRITES = ['mkdtempSync', 'rmSync'];",
    `// ${call}join(tmpdir(), "a comment"))`,
    `const text = \`${call}\${WRITES})\`;`,
  ].join('\n'));
  writeFileSync(join(root, 'nested', 'leaks.mjs'), [
    "import { mkdtempSync as make } from 'node:fs';",
    "import * as fs from 'node:fs';",
    'const { mkdtempSync: m } = fs;',
    'const split = make',
    "  (join(tmpdir(), 'rigger-leak-'));",
    `const viaNamespace = fs.${call}'/tmp/rigger-leak-');`,
    'const called = fs',
    "  .mkdtempSync.call(null, '/tmp/rigger-leak-');",
    'const bare = mkdtempSync',
    "  ('/tmp/rigger-leak-');",
  ].join('\n'));

  assert.deepEqual(bareMkdtemps(root), [
    'test/nested/leaks.mjs:1',
    'test/nested/leaks.mjs:3',
    'test/nested/leaks.mjs:6',
    'test/nested/leaks.mjs:8',
    'test/nested/leaks.mjs:9',
  ]);
});

test('a file under the directory the tokenizer cannot read fails the check, naming the file', () => {
  const root = temporaryDirectory('rigger-bare-mkdtemp-');
  writeFileSync(join(root, 'unreadable.mjs'), 'const open = `never closed;\n');

  assert.throws(() => bareMkdtemps(root), (error) => error.message.includes(join(root, 'unreadable.mjs')));
});
