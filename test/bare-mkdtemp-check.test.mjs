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
 * call, an import, an alias's source, a destructured key, a namespace's property, or a computed
 * member whose key is the string `mkdtempSync`, quoted or as a template. A file read as tokens
 * rather than lines, so a call split across lines is found, and a mention in a comment, or the
 * string in an array or as an object's key, is not. A key held in a variable, `fs[name]`, is not
 * found: what it holds is known only when the code runs. A file the tokenizer cannot read fails the
 * check, naming the file.
 */
function bareMkdtemps(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
    .map((entry) => relative(directory, join(entry.parentPath ?? entry.path, entry.name)))
    .filter((path) => path !== HELPER)
    .sort()
    .flatMap((path) => namings(join(directory, path)).map((line) => `test/${path}:${line}`));
}

/**
 * The line of every token in the file at `path` that names `mkdtempSync`: the name itself, or the
 * string or template that is the whole key of a computed member. A `[` opens a member, not an
 * array, where what comes before it ends an expression: a name, `this`, `)`, `]` or `?.`.
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
  const label = (at) => tokens[at]?.type.label;
  const opensMember = (at) => label(at) === '[' && ['name', 'this', ')', ']', '?.'].includes(label(at - 1));
  const computedKey = (at) => (label(at) === 'string' && opensMember(at - 1) && label(at + 1) === ']')
    || (label(at) === 'template' && label(at - 1) === '`' && opensMember(at - 2) && label(at + 1) === '`' && label(at + 2) === ']');
  return tokens
    .map((token, at) => ((token.value === 'mkdtempSync' && (label(at) === 'name' || computedKey(at))) ? token.loc.start.line : null))
    .filter((line) => line !== null);
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

test('the check names the line of a computed member whose key is the string mkdtempSync, quoted or as a template, and passes the same string in an array, an object key or a longer key', () => {
  const root = temporaryDirectory('rigger-bare-mkdtemp-');
  writeFileSync(join(root, 'computed.mjs'), [
    "import * as fs from 'node:fs';",
    "const quoted = fs['mkdtempSync']('/tmp/rigger-leak-');",
    'const template = fs[`mkdtempSync`];',
    'const split = fs',
    '  ["mkdtempSync"];',
    "const listed = ['mkdtempSync', 'rmSync'];",
    "const first = ['rmSync', 'mkdtempSync'][0];",
    "function returned() { return ['mkdtempSync']; }",
    "const keyed = { 'mkdtempSync': 1 };",
    "const longer = fs['mkdtempSyncLater'];",
  ].join('\n'));

  assert.deepEqual(bareMkdtemps(root), ['test/computed.mjs:2', 'test/computed.mjs:3', 'test/computed.mjs:5']);
});

test('a file under the directory the tokenizer cannot read fails the check, naming the file', () => {
  const root = temporaryDirectory('rigger-bare-mkdtemp-');
  writeFileSync(join(root, 'unreadable.mjs'), 'const open = `never closed;\n');

  assert.throws(() => bareMkdtemps(root), (error) => error.message.includes(join(root, 'unreadable.mjs')));
});
