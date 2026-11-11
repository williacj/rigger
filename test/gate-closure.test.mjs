// ABOUTME: Checks the gate import closure for its supported import forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { measure, main } from '../.github/scripts/gate-closure.mjs';
import { gitIn } from './git-repository.mjs';
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

test('the repository closure has only the named config import', () => {
  const result = measure(ROOT);
  assert.deepEqual(result.computed, [{ file: 'src/cli/doctor.mjs', call: 'import(pathToFileURL(path))' }]);
  assert.deepEqual(result.bare, []);
  assert.deepEqual(result.commonjs, []);
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

/**
 * The values `SELF_HOSTING_COMMIT` takes in a workflow's top-level `env` map, however YAML spells the
 * scalar: single, double or no quotes, any indentation of the map, and a trailing comment.
 */
function pinsIn(workflow) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => /^env:\s*(#.*)?$/.test(line));
  if (start === -1) return [];
  const pins = [];
  let indent;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const depth = line.match(/^ */)[0].length;
    if (depth === 0) break;
    indent ??= depth;
    if (depth !== indent) continue;
    const entry = line.slice(depth).match(/^SELF_HOSTING_COMMIT\s*:\s*('([^']*)'|"([^"]*)"|([^\s#'"][^#]*?))\s*(#.*)?$/);
    if (entry) pins.push(entry[2] ?? entry[3] ?? entry[4]);
  }
  return pins;
}

/** The one commit a workflow pins for the check's code; zero pins or several are refused. */
function onePin(workflow) {
  const pins = pinsIn(workflow);
  assert.equal(pins.length, 1, `one SELF_HOSTING_COMMIT pin, found ${pins.length}`);
  return pins[0];
}

/** The commit `.github/workflows/self-hosting.yml` pins for the check's code. */
const checkPin = () => onePin(readFileSync(join(ROOT, '.github/workflows/self-hosting.yml'), 'utf8'));

// A reader tied to one quoting or indentation fails both pin tests on an equivalent workflow.
test('the pin reader reads the same commit from each YAML spelling and refuses zero or two pins', () => {
  const sha = 'c1e4833fd3bfdafef68590c48ad88571a3d3c885';
  const workflow = (entry) => `name: self-hosting\non:\n  push:\nenv:\n${entry}\n  TREE: tree\njobs:\n  check:\n    env:\n      SELF_HOSTING_COMMIT: 'other'\n`;
  for (const entry of [
    `  SELF_HOSTING_COMMIT: '${sha}'`,
    `  SELF_HOSTING_COMMIT: "${sha}"`,
    `  SELF_HOSTING_COMMIT: ${sha}`,
    `  SELF_HOSTING_COMMIT: '${sha}' # the check's code`,
    `  SELF_HOSTING_COMMIT: ${sha}  # the check's code`,
    `  # The commit that supplies the scripts.\n  SELF_HOSTING_COMMIT:   "${sha}"`,
  ]) assert.equal(onePin(workflow(entry)), sha, entry);
  const indented = `env:\n    NODE_MAJOR: '24'\n    SELF_HOSTING_COMMIT: "${sha}"\njobs:\n  check:\n`;
  assert.equal(onePin(indented), sha);
  assert.throws(() => onePin(workflow(`  # SELF_HOSTING_COMMIT: '${sha}'`)), /found 0/);
  assert.throws(() => onePin(workflow(`  SELF_HOSTING_COMMIT: '${sha}'\n  SELF_HOSTING_COMMIT: "${sha}"`)), /found 2/);
});

// A pin the default branch does not reach, such as a squash-merged pull request's own head
// commit, still fetches through codeload (D35 rule 6's reversal names such a move).
test('the self-hosting check pins a commit HEAD reaches', () => {
  const pin = checkPin();
  assert.equal(gitIn(ROOT, 'merge-base', pin, 'HEAD').trim(), pin, `${pin} is no ancestor of HEAD`);
});

// The check runs the pinned tree with no install, so a package or CommonJS call there fails live.
test('the closure the self-hosting check runs at its pin has only the named config import', () => {
  const pin = checkPin();
  const scratch = temporaryDirectory('rigger-gate-closure-pin-');
  const archive = join(scratch, 'pin.tar');
  const tree = join(scratch, 'tree');
  mkdirSync(tree);
  gitIn(ROOT, 'archive', '--output', archive, pin);
  execFileSync('tar', ['-xf', archive, '-C', tree]);
  const result = measure(tree, ['.github/scripts/self-hosting-check.mjs']);
  assert.deepEqual(result.bare, []);
  assert.deepEqual(result.commonjs, []);
  assert.deepEqual(result.computed, [{ file: 'src/cli/doctor.mjs', call: 'import(pathToFileURL(path))' }]);
});
