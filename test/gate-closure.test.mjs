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

const WORKFLOW = '.github/workflows/self-hosting.yml';
/** The one line that pins the check's code: two spaces, the key, and the commit single-quoted. */
const CANONICAL = /^  SELF_HOSTING_COMMIT: '([0-9a-f]{40})'$/;

/**
 * The commit a workflow pins for the check's code, from its one canonical line. Any other line
 * naming `SELF_HOSTING_COMMIT`, except as the shell reference `${SELF_HOSTING_COMMIT}`, is refused
 * by its line number, and so is a workflow with no canonical line or with two.
 */
function canonicalPin(workflow) {
  const lines = workflow.split('\n');
  const canonical = [];
  lines.forEach((line, index) => {
    if (CANONICAL.test(line)) canonical.push(index + 1);
    else if (line.replaceAll('${SELF_HOSTING_COMMIT}', '').includes('SELF_HOSTING_COMMIT')) {
      throw new Error(`${WORKFLOW} line ${index + 1} holds SELF_HOSTING_COMMIT outside its canonical line: ${JSON.stringify(line)}`);
    }
  });
  if (canonical.length === 0) throw new Error(`${WORKFLOW} holds no canonical SELF_HOSTING_COMMIT line`);
  if (canonical.length > 1) throw new Error(`${WORKFLOW} holds the canonical SELF_HOSTING_COMMIT line twice, at lines ${canonical.join(' and ')}`);
  return lines[canonical[0] - 1].match(CANONICAL)[1];
}

/** The commit `.github/workflows/self-hosting.yml` pins for the check's code. */
const checkPin = () => canonicalPin(readFileSync(join(ROOT, WORKFLOW), 'utf8'));
/** The message prefix that refuses the workflow at `line`. */
const atLine = (line) => new RegExp(`^${WORKFLOW.replace(/\./g, '\\.')} line ${line} `);

// The ancestor and closure tests read the pin from one canonical line. A pin spelled any other way,
// even as YAML that means the same, would be read wrongly or not at all, so this refuses it by line.
test('the self-hosting workflow holds its pin in one canonical line and refuses any other spelling by line', () => {
  const sha = 'c1e4833fd3bfdafef68590c48ad88571a3d3c885';
  assert.match(canonicalPin(readFileSync(join(ROOT, WORKFLOW), 'utf8')), /^[0-9a-f]{40}$/);
  const workflow = (env, rest = '') => `name: self-hosting\non:\n  push:\nenv:\n  NODE_MAJOR: '24'\n${env}\n  TREE: tree\n`
    + 'jobs:\n  check:\n    steps:\n      - run: curl "https://codeload.github.com/${GITHUB_REPOSITORY}/tar.gz/${SELF_HOSTING_COMMIT}"\n'
    + rest;
  assert.equal(canonicalPin(workflow(`  SELF_HOSTING_COMMIT: '${sha}'`)), sha, 'the canonical line beside shell references');
  // Each spelling rounds 1 to 3 and the attack found, as the line it puts in the workflow.
  const refused = {
    'value double-quoted': `  SELF_HOSTING_COMMIT: "${sha}"`,
    'value unquoted': `  SELF_HOSTING_COMMIT: ${sha}`,
    'value with escapes': `  SELF_HOSTING_COMMIT: "\\x63${sha.slice(1)}"`,
    'key single-quoted': `  'SELF_HOSTING_COMMIT': '${sha}'`,
    'key double-quoted': `  "SELF_HOSTING_COMMIT": '${sha}'`,
    'four-space indentation': `    SELF_HOSTING_COMMIT: '${sha}'`,
    'root indentation': `SELF_HOSTING_COMMIT: '${sha}'`,
    'a trailing comment': `  SELF_HOSTING_COMMIT: '${sha}' # the pin`,
    'a no-break space before a comment': `  SELF_HOSTING_COMMIT: ${sha}\u00a0# the pin`,
    'a no-break space in the key': `  SELF_HOSTING_COMMIT\u00a0: '${sha}'`,
    'spaces before the colon': `  SELF_HOSTING_COMMIT  : '${sha}'`,
    'an upper-case commit': `  SELF_HOSTING_COMMIT: '${sha.toUpperCase()}'`,
    'a short commit': `  SELF_HOSTING_COMMIT: '${sha.slice(0, 12)}'`,
    'a value on the next line': `  SELF_HOSTING_COMMIT:\n    '${sha}'`,
    'a block scalar': `  SELF_HOSTING_COMMIT: |\n    ${sha}`,
    'an anchor': `  SELF_HOSTING_COMMIT: &pin '${sha}'`,
    'a flow mapping': `  { SELF_HOSTING_COMMIT: '${sha}' }`,
    'a commented-out pin': `  # SELF_HOSTING_COMMIT: '${sha}'`,
    'a bare shell reference': `  NOTE: $SELF_HOSTING_COMMIT`,
  };
  for (const [name, line] of Object.entries(refused)) {
    const text = workflow(line);
    const at = text.split('\n').findIndex((each) => each.includes('SELF_HOSTING_COMMIT') && !each.includes('${SELF_HOSTING_COMMIT}')) + 1;
    assert.throws(() => canonicalPin(text), { message: atLine(at) }, name);
  }
  // A canonical line beside a re-spelled one is refused by the re-spelled line.
  const beside = workflow(`  SELF_HOSTING_COMMIT: '${sha}'`, `    env:\n      SELF_HOSTING_COMMIT: 'other'\n`);
  assert.throws(() => canonicalPin(beside), { message: atLine(beside.split('\n').length - 1) }, 'a job-level pin');
  // CR line ends, which YAML reads as the same file, leave no canonical line; a byte-order mark
  // before the first line leaves the canonical line as it was.
  const canonical = workflow(`  SELF_HOSTING_COMMIT: '${sha}'`);
  assert.equal(canonicalPin(`\uFEFF${canonical}`), sha, 'a byte-order mark before the first line');
  const pinLine = canonical.split('\n').findIndex((each) => each.startsWith('  SELF_HOSTING_COMMIT')) + 1;
  assert.throws(() => canonicalPin(canonical.replace(/\n/g, '\r\n')), { message: atLine(pinLine) }, 'CRLF line ends');
  assert.throws(() => canonicalPin(canonical.replace(/\n/g, '\r')), { message: atLine(1) }, 'lone CR line ends');
  assert.throws(() => canonicalPin(workflow('')), { message: `${WORKFLOW} holds no canonical SELF_HOSTING_COMMIT line` }, 'absent');
  assert.throws(() => canonicalPin(workflow(`  SELF_HOSTING_COMMIT: '${sha}'\n  SELF_HOSTING_COMMIT: '${sha}'`)),
    { message: `${WORKFLOW} holds the canonical SELF_HOSTING_COMMIT line twice, at lines 6 and 7` }, 'twice');
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
