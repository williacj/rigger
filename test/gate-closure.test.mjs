// ABOUTME: Checks the live gate import closure and its exact protection in the Self-hosting list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { measure, main, compare } from '../.github/scripts/gate-closure.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
function fixture(files) {
  const root = temporaryDirectory('rigger-gate-closure-');
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

// A missing transitive edge, skipped side effect, or repeated visit loses this checked set.
test('follows static and side-effect imports transitively, ignores node built-ins, and visits a cycle once', () => {
  const root = fixture({
    'entry.mjs': "import { x } from './nested/a.mjs'; import './side.mjs'; import fs from 'node:fs';",
    'nested/a.mjs': "import '../entry.mjs'; export const x = 1;",
    'side.mjs': '',
  });
  assert.deepEqual(measure(root, ['entry.mjs']).paths, ['entry.mjs', 'nested/a.mjs', 'side.mjs']);
});

test('follows named and star re-exports into the closure', () => {
  const root = fixture({
    'entry.mjs': "export { x } from './a.mjs'; export * from './b.mjs';",
    'a.mjs': 'export const x = 1;', 'b.mjs': '',
  });
  assert.deepEqual(measure(root, ['entry.mjs']).paths, ['a.mjs', 'b.mjs', 'entry.mjs']);
});

test('follows a string-literal dynamic import inside a function and ignores import text in comments and strings', () => {
  const root = fixture({
    'entry.mjs': `export function load() { return import('./a.mjs'); }
      // import './missing-comment.mjs';
      const text = "import('./missing-string.mjs')";`,
    'a.mjs': '',
  });
  assert.deepEqual(measure(root, ['entry.mjs']).paths, ['a.mjs', 'entry.mjs']);
});

test('names each computed import by its file and exact call, including the doctor config load', () => {
  const root = fixture({ 'src/cli/doctor.mjs': 'import(pathToFileURL(path)); import(other);' });
  assert.deepEqual(measure(root, ['src/cli/doctor.mjs']).computed, [
    { file: 'src/cli/doctor.mjs', call: 'import(pathToFileURL(path))' },
    { file: 'src/cli/doctor.mjs', call: 'import(other)' },
  ]);
});

test('reports bare packages in static imports, re-exports and literal dynamic imports rather than resolving them as files', () => {
  const root = fixture({ 'entry.mjs': "import 'static-package'; export * from 'export-package'; import('dynamic-package');" });
  assert.deepEqual(measure(root, ['entry.mjs']).bare, [
    { file: 'entry.mjs', specifier: 'static-package' },
    { file: 'entry.mjs', specifier: 'export-package' },
    { file: 'entry.mjs', specifier: 'dynamic-package' },
  ]);
});

test('reports require and createRequire calls by file and call, including a renamed import and a namespace call', () => {
  const root = fixture({ 'entry.mjs': `import { createRequire as make } from 'node:module';
    require('./a.cjs'); createRequire(import.meta.url); make(import.meta.url); module.createRequire(import.meta.url);` });
  assert.deepEqual(measure(root, ['entry.mjs']).commonjs, [
    { file: 'entry.mjs', call: "require('./a.cjs')" },
    { file: 'entry.mjs', call: 'createRequire(import.meta.url)' },
    { file: 'entry.mjs', call: 'make(import.meta.url)' },
    { file: 'entry.mjs', call: 'module.createRequire(import.meta.url)' },
  ]);
});

test('the command prints paths one per line and exits non-zero naming an unresolved relative import', () => {
  const root = fixture({ 'scripts/gate-check.mjs': "import './missing.mjs';", '.github/scripts/self-hosting-check.mjs': '' });
  const out = [], errors = [];
  assert.equal(main(root, (line) => out.push(line), (line) => errors.push(line)), 1);
  assert.equal(out.length, 0);
  assert.match(errors.join('\n'), /scripts\/gate-check.mjs.*\.\/missing.mjs/);
  writeFileSync(join(root, 'scripts/missing.mjs'), '');
  errors.length = 0;
  assert.equal(main(root, (line) => out.push(line), (line) => errors.push(line)), 0);
  assert.deepEqual(out, ['.github/scripts/self-hosting-check.mjs', 'scripts/gate-check.mjs', 'scripts/missing.mjs']);
  assert.deepEqual(errors, []);
});

// The same list grammar the live check consumes, without copying this repository's whole file.
const GUARDS = ['src/substrate/process-table.sh', '.github/scripts/gate-closure.mjs', 'test/gate-closure.test.mjs'];
function agents(gate, other = GUARDS) {
  const ticks = (paths) => paths.map((path) => '`' + path + '`').join(', ');
  return `## What binds
| Document | Authority |
|---|---|
| \`AGENTS.md\` | Rules |
## Self-hosting
- The gate's code: ${ticks(gate)}.
- The closure guard: ${ticks(other)}.
## After
`;
}

function compareFixture(root, markdown, paths) {
  writeFileSync(join(root, 'AGENTS.md'), markdown);
  return compare(readFileSync(join(root, 'AGENTS.md'), 'utf8'), paths);
}

test('the comparison names a closure file missing from the list, even where its directory or a comment names it', () => {
  const root = fixture({ 'entry.mjs': "import './child.mjs';", 'child.mjs': '' });
  const paths = measure(root, ['entry.mjs']).paths;
  const complete = agents(paths);
  assert.deepEqual(compareFixture(root, complete, paths), []);
  for (const markdown of [agents(['entry.mjs']), agents(['entry.mjs', './']),
    agents(['entry.mjs']) + '<!-- `child.mjs` -->\n']) {
    assert.ok(compareFixture(root, markdown, paths).includes('unlisted closure file: child.mjs'));
  }
});

test('the comparison names a gate-code mjs span absent from the closure, and ignores mjs spans in other bullets', () => {
  const root = fixture({ 'entry.mjs': '' });
  const paths = measure(root, ['entry.mjs']).paths;
  assert.deepEqual(compareFixture(root, agents(['entry.mjs'], [...GUARDS, 'other.mjs']), paths), []);
  assert.deepEqual(compareFixture(root, agents(['entry.mjs', 'extra.mjs']), paths), ['not in closure: extra.mjs']);
});

test('the Linux process-table executable is protected even though no import reaches it', () => {
  const root = fixture({ 'entry.mjs': '', 'src/substrate/process-table.sh': '#!/bin/sh\n' });
  const paths = measure(root, ['entry.mjs']).paths;
  assert.ok(!paths.includes('src/substrate/process-table.sh'));
  assert.ok(compareFixture(root, agents(paths, []), paths).includes('unlisted executable: src/substrate/process-table.sh'));
});

test('the measuring script and test must each be listed outside the gate-code bullet', () => {
  const root = fixture({ 'entry.mjs': '' });
  const paths = measure(root, ['entry.mjs']).paths;
  for (const path of ['.github/scripts/gate-closure.mjs', 'test/gate-closure.test.mjs']) {
    assert.ok(compareFixture(root, agents(paths, GUARDS.filter((guard) => guard !== path)), paths).includes(`unlisted guard: ${path}`));
    assert.ok(compareFixture(root, agents([...paths, path], GUARDS.filter((guard) => guard !== path)), paths).includes(`guard in gate-code bullet: ${path}`));
  }
});

test('the command reports computed calls on stderr and refuses bare packages or CommonJS calls', () => {
  for (const [source, status, diagnostic] of [
    ['import(path);', 0, 'scripts/gate-check.mjs: import(path)'],
    ["import 'a-package';", 1, 'scripts/gate-check.mjs: a-package'],
    ["require('./a.cjs');", 1, "scripts/gate-check.mjs: require('./a.cjs')"],
  ]) {
    const root = fixture({ 'scripts/gate-check.mjs': source, '.github/scripts/self-hosting-check.mjs': '' });
    const errors = [];
    assert.equal(main(root, () => {}, (line) => errors.push(line)), status);
    assert.ok(errors.some((line) => line.includes(diagnostic)), errors.join('\n'));
  }
});

test('the repository closure has only the named config import and exactly listed protection', () => {
  const result = measure(ROOT);
  assert.deepEqual(result.computed, [{ file: 'src/cli/doctor.mjs', call: 'import(pathToFileURL(path))' }]);
  assert.deepEqual(result.bare, []);
  assert.deepEqual(result.commonjs, []);
  assert.deepEqual(compare(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'), result.paths), []);
});

test('literal file imports use Node URL decoding and follow absolute paths and file URLs', () => {
  const root = fixture({ 'entry.mjs': '', 'special #\n.mjs': '', 'absolute.mjs': '', 'url.mjs': '' });
  writeFileSync(join(root, 'entry.mjs'), `import('./special%20%23%0A.mjs');
    import(${JSON.stringify(join(root, 'absolute.mjs'))});
    import(${JSON.stringify(pathToFileURL(join(root, 'url.mjs')).href)});`);
  const result = measure(root, ['entry.mjs']);
  assert.deepEqual(result.paths, ['absolute.mjs', 'entry.mjs', 'special #\n.mjs', 'url.mjs']);
  assert.deepEqual(result.bare, []);
});
