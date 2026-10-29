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

/** The two observer collections, by file and complete token context; neither makes a directory. */
const EXCEPTIONS = new Map([
  ['dispatch.test.mjs', "const WRITES = ['appendFileSync', 'copyFileSync', 'cpSync', 'linkSync', 'mkdirSync', 'mkdtempSync', 'openSync', 'renameSync', 'rmSync', 'rmdirSync', 'symlinkSync', 'truncateSync', 'unlinkSync', 'writeFileSync'];"],
  ['loop.test.mjs', "for (const name of ['mkdtempSync', 'mkdirSync', 'writeFileSync', 'renameSync', 'chmodSync', 'readFileSync', 'readdirSync'])"],
]);

/** The name the check looks for, built in two parts so that this file holds no token it names. */
const NAME = 'mkdtemp' + 'Sync';

/**
 * Every `file:line` under `directory`, outside the helper, that names `mkdtempSync` (#540): a token
 * that is the name, wherever it stands, or a string or template whose whole value is the name,
 * unless the literal belongs to its file's unique approved observer collection in `EXCEPTIONS`.
 * Each file is read as tokens rather than lines,
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
    .flatMap((path) => namings(join(directory, path), EXCEPTIONS.get(path))
      .map(({ line }) => `test/${path}:${line}`));
}

/**
 * Every token in the file at `path` that names `mkdtempSync`, with its line and whether it is a
 * string or template rather than the name.
 */
function namings(path, approvedContext) {
  const source = readFileSync(path, 'utf8');
  const options = { ecmaVersion: 'latest', sourceType: /\.cjs$/.test(path) ? 'script' : 'module', locations: true, allowHashBang: true };
  let tokens;
  try {
    tokens = [...tokenizer(source, options)];
  } catch (error) {
    throw new Error(`the mkdtempSync check could not read ${path}: ${error.message}`);
  }
  const permitted = new Set();
  if (approvedContext) {
    const context = [...tokenizer(approvedContext, options)].filter((token) => token.type.label !== 'eof');
    const starts = tokens.flatMap((token, index) => context.every((expected, offset) => {
      const actual = tokens[index + offset];
      return actual?.type.label === expected.type.label && actual.value === expected.value;
    }) ? [index] : []);
    if (starts.length === 1) {
      for (let index = starts[0]; index < starts[0] + context.length; index++) {
        if (tokens[index].type.label === 'string') permitted.add(index);
      }
    }
  }
  return tokens
    .filter((token, index) => token.value === NAME && ['name', 'string', 'template'].includes(token.type.label) && !permitted.has(index))
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

test('the check passes the approved dispatch observer literal and nowhere else, and never an identifier beside it', () => {
  const root = temporaryDirectory('rigger-bare-mkdtemp-');
  // Keep the identifier beside the approved literal and a forbidden literal on the next line.
  const lines = Array.from({ length: 356 }, () => '');
  lines.push("const WRITES = ['appendFileSync', 'copyFileSync', 'cpSync', 'linkSync', 'mkdirSync', 'mkdtempSync', 'openSync', 'renameSync', 'rmSync', 'rmdirSync', 'symlinkSync', 'truncateSync', 'unlinkSync', 'writeFileSync']; const named = mkdtempSync;");
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

// A harmless prefix moves both real observer collections without changing their operations.
test('the observer exceptions survive unrelated source line shifts', () => {
  const root = temporaryDirectory('rigger-observer-line-shift-');
  const prefix = "import 'node:assert';\n// Unrelated observer preface.\n\n";
  for (const file of ['dispatch.test.mjs', 'loop.test.mjs']) {
    writeFileSync(join(root, file), prefix + readFileSync(join(HERE, file), 'utf8'));
  }

  assert.deepEqual(bareMkdtemps(root), [], 'the same observer operation names remain permitted after unrelated lines');
});

test('both observer exceptions refuse identifiers, other literals, other files, changed context and duplicate collections at their actual lines', () => {
  const observers = [
    ['dispatch.test.mjs', "const WRITES = ['appendFileSync', 'copyFileSync', 'cpSync', 'linkSync', 'mkdirSync', 'mkdtempSync', 'openSync', 'renameSync', 'rmSync', 'rmdirSync', 'symlinkSync', 'truncateSync', 'unlinkSync', 'writeFileSync'];", 'WRITES', 'OPERATIONS'],
    ['loop.test.mjs', "for (const name of ['mkdtempSync', 'mkdirSync', 'writeFileSync', 'renameSync', 'chmodSync', 'readFileSync', 'readdirSync']) {}", 'name', 'operation'],
  ];
  for (const [file, context, binding, changed] of observers) {
    const root = temporaryDirectory('rigger-observer-context-');
    const path = join(root, file);
    writeFileSync(path, `${context}\nconst named = ${NAME};\nconst quoted = '${NAME}';\nconst templated = \`${NAME}\`;`);
    assert.deepEqual(bareMkdtemps(root), [2, 3, 4].map((line) => `test/${file}:${line}`), `${file}: identifiers and other literals stay forbidden`);

    writeFileSync(path, context.replace("'" + NAME + "'", NAME));
    assert.deepEqual(bareMkdtemps(root), [`test/${file}:1`], `${file}: an identifier in the observer stays forbidden`);

    writeFileSync(path, context.replace(binding, changed));
    assert.deepEqual(bareMkdtemps(root), [`test/${file}:1`], `${file}: changed context is not approved`);

    writeFileSync(path, '\n'.repeat(file === 'dispatch.test.mjs' ? 356 : 58) + context.replace(binding, changed));
    assert.deepEqual(bareMkdtemps(root), [`test/${file}:${file === 'dispatch.test.mjs' ? 357 : 59}`], `${file}: its former line never exempts changed context`);

    writeFileSync(path, `${context}\n{ ${context} }`);
    assert.deepEqual(bareMkdtemps(root), [1, 2].map((line) => `test/${file}:${line}`), `${file}: duplicated observer collections are not silently approved`);

    writeFileSync(path, '');
    writeFileSync(join(root, 'other.mjs'), context);
    assert.deepEqual(bareMkdtemps(root), ['test/other.mjs:1'], `${file}: its observer context does not approve another file`);
  }
});
