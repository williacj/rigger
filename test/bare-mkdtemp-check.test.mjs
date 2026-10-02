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
 * The whole-value strings the check passes, each by its file, relative to `test/`, and its line.
 * - `dispatch.test.mjs:357`: `WRITES`, the `node:fs` calls that create, change, move or remove a
 *   path, which that test wraps to record every path a dispatch writes. It names `mkdtempSync` to
 *   watch it, and makes no directory.
 */
const EXCEPTIONS = new Set(['dispatch.test.mjs:357']);

/** The name the check looks for, built in two parts so that this file holds no token it names. */
const NAME = 'mkdtemp' + 'Sync';

/**
 * Every `file:line` under `directory`, outside the helper, that names `mkdtempSync` (#540): a token
 * that is the name, wherever it stands, or a string or template whose whole value is the name,
 * unless its file and line are among `EXCEPTIONS`. Each file is read as tokens rather than lines,
 * so a call split across lines is found, and a mention in a comment or inside a longer string is
 * not. A file the tokenizer cannot read fails the check, naming the file.
 *
 * What this cannot catch: a name built when the code runs, such as a variable holding it
 * (`fs[name]`) or a concatenation (`fs['mkdtemp' + 'Sync']`). Only running the code knows those.
 */
function bareMkdtemps(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
    .map((entry) => relative(directory, join(entry.parentPath ?? entry.path, entry.name)))
    .filter((path) => path !== HELPER)
    .sort()
    .flatMap((path) => namings(join(directory, path))
      .filter(({ line, literal }) => !(literal && EXCEPTIONS.has(`${path}:${line}`)))
      .map(({ line }) => `test/${path}:${line}`));
}

/**
 * Every token in the file at `path` that names `mkdtempSync`, with its line and whether it is a
 * string or template rather than the name.
 */
function namings(path) {
  const source = readFileSync(path, 'utf8');
  const options = { ecmaVersion: 'latest', sourceType: /\.cjs$/.test(path) ? 'script' : 'module', locations: true, allowHashBang: true };
  let tokens;
  try {
    tokens = [...tokenizer(source, options)];
  } catch (error) {
    throw new Error(`the mkdtempSync check could not read ${path}: ${error.message}`);
  }
  return tokens
    .filter((token) => token.value === NAME && ['name', 'string', 'template'].includes(token.type.label))
    .map((token) => ({ line: token.loc.start.line, literal: token.type.label !== 'name' }));
}

test('no file under test/ names mkdtempSync in its code but the shared temporary-directory helper', () => {
  const found = bareMkdtemps(HERE);
  assert.deepEqual(found, [], `these lines name mkdtempSync, whose directory nothing removes; make it with temporaryDirectory from test/${HELPER} instead:\n${found.join('\n')}`);
});

test('the check names the file and the line of every mkdtempSync named in code, aliased, destructured, through its namespace or called on the next line, and passes the helper, a comment and a longer string', () => {
  const root = temporaryDirectory('rigger-bare-mkdtemp-');
  mkdirSync(join(root, 'nested'));
  // The call is written in parts, so that neither the git grep item 3 on #540 quotes nor this check
  // finds a fixture here.
  const call = 'mkdtemp' + 'Sync(';
  writeFileSync(join(root, HELPER), `import { mkdtempSync } from 'node:fs';\nconst made = ${call}join(tmpdir(), 'x-'));\n`);
  writeFileSync(join(root, 'mentions.test.mjs'), [
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

test('the check names the line of every string or template whose whole value is mkdtempSync, a computed key, a parenthesised key, an array\'s entry or an object\'s key, and passes a longer string and a name built when the code runs', () => {
  const root = temporaryDirectory('rigger-bare-mkdtemp-');
  writeFileSync(join(root, 'strings.mjs'), [
    "import * as fs from 'node:fs';",
    "const quoted = fs['mkdtempSync']('/tmp/rigger-leak-');",
    'const template = fs[`mkdtempSync`];',
    'const split = fs',
    '  ["mkdtempSync"];',
    "const parenthesised = fs[('mkdtempSync')]('/tmp/rigger-leak-');",
    "const listed = ['mkdtempSync', 'rmSync'];",
    "const keyed = { 'mkdtempSync': 1 };",
    "const longer = fs['mkdtempSyncLater'];",
    "const built = fs['mkdtemp' + 'Sync'];",
  ].join('\n'));

  assert.deepEqual(bareMkdtemps(root), [2, 3, 5, 6, 7, 8].map((line) => `test/strings.mjs:${line}`));
});

test('the check passes a whole-value string on the file and line its exception list names, and nowhere else, and never the name itself there', () => {
  const root = temporaryDirectory('rigger-bare-mkdtemp-');
  // test/dispatch.test.mjs:357, the one exception, then the line after it.
  const lines = Array.from({ length: 356 }, () => '');
  lines.push("const WRITES = ['appendFileSync', 'mkdtempSync', 'writeFileSync']; const named = mkdtempSync;");
  lines.push("const other = ['mkdtempSync'];");
  writeFileSync(join(root, 'dispatch.test.mjs'), lines.join('\n'));
  writeFileSync(join(root, 'elsewhere.mjs'), "const WRITES = ['appendFileSync', 'mkdtempSync', 'writeFileSync'];\n");

  assert.deepEqual(bareMkdtemps(root), ['test/dispatch.test.mjs:357', 'test/dispatch.test.mjs:358', 'test/elsewhere.mjs:1']);
});

test('a file under the directory the tokenizer cannot read fails the check, naming the file', () => {
  const root = temporaryDirectory('rigger-bare-mkdtemp-');
  writeFileSync(join(root, 'unreadable.mjs'), 'const open = `never closed;\n');

  assert.throws(() => bareMkdtemps(root), (error) => error.message.includes(join(root, 'unreadable.mjs')));
});
