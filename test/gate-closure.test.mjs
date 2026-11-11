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

const unsupported = (form) => new Error(`unsupported YAML form for SELF_HOSTING_COMMIT: ${form}`);

/** YAML's double-quoted escapes (YAML 1.2, section 5.7), the escaped line break excepted. */
const ESCAPES = { 0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029' };
const HEX = { x: 2, u: 4, U: 8 };

/**
 * Reads one scalar at the start of `text`, plain, single- or double-quoted, and returns its value
 * and the text after it. A plain scalar ends at `stop`; a form that is no scalar on one line throws.
 */
function scalar(text, stop) {
  if (text[0] === "'") {
    let value = '', at = 1;
    for (;;) {
      if (at >= text.length) throw unsupported('multi-line scalar');
      if (text[at] === "'" && text[at + 1] === "'") { value += "'"; at += 2; continue; }
      if (text[at] === "'") return { value, rest: text.slice(at + 1) };
      value += text[at++];
    }
  }
  if (text[0] === '"') {
    let value = '', at = 1;
    for (;;) {
      if (at >= text.length) throw unsupported('multi-line scalar');
      if (text[at] === '"') return { value, rest: text.slice(at + 1) };
      if (text[at] !== '\\') { value += text[at++]; continue; }
      const code = text[at + 1];
      if (code in ESCAPES) { value += ESCAPES[code]; at += 2; continue; }
      const digits = text.slice(at + 2, at + 2 + (HEX[code] ?? 0));
      if (!HEX[code] || !/^[0-9a-fA-F]+$/.test(digits) || digits.length !== HEX[code]) throw unsupported('invalid escape');
      value += String.fromCodePoint(parseInt(digits, 16));
      at += 2 + HEX[code];
    }
  }
  const form = { '{': 'flow mapping', '[': 'flow sequence', '&': 'anchor', '*': 'alias', '|': 'block scalar',
    '>': 'block scalar', '!': 'tag', '?': 'explicit key', '-': 'sequence', '%': 'directive', '@': 'reserved indicator', '`': 'reserved indicator' }[text[0]];
  if (form && !('-?'.includes(text[0]) && /^.\S/.test(text))) throw unsupported(form);
  const end = text.search(stop);
  return { value: (end === -1 ? text : text.slice(0, end)).trimEnd(), rest: end === -1 ? '' : text.slice(end) };
}

/** What follows a scalar on its line must be nothing but a comment. */
function lineEnd(rest) {
  if (!/^\s*(#.*)?$/.test(rest) || (/^#/.test(rest))) throw unsupported('multi-line scalar');
}

/** One `key: value` line of a block mapping, or a thrown form; `value` is null when it follows on later lines. */
function entry(line) {
  if (line.startsWith('<<') && /^<<\s*:/.test(line)) throw unsupported('merge key');
  const key = scalar(line, /\s*:(\s|$)/);
  const colon = key.rest.match(/^\s*:(\s+|$)/);
  if (!colon) throw unsupported('multi-line scalar');
  const after = key.rest.slice(colon[0].length);
  if (/^(#.*)?$/.test(after)) return { key: key.value, value: null };
  const value = scalar(after, /\s#/);
  lineEnd(value.rest);
  return { key: key.value, value: value.value };
}

/**
 * The values `SELF_HOSTING_COMMIT` takes in a workflow's top-level `env` block mapping, however
 * YAML spells it: key and value plain, single- or double-quoted, any indentation, blank lines and
 * comments. Any other form for that map or key throws, naming the form, rather than reading none.
 */
function pinsIn(workflow) {
  const lines = workflow.split(/\r?\n/);
  let content = false, ended = false, env = null, indent;
  const pins = [];
  for (const line of lines) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^(---|\.\.\.)(\s|$)/.test(line)) {
      if (ended || (line.startsWith('---') && content)) throw unsupported('second document');
      if (line.startsWith('...')) ended = true;
      continue;
    }
    if (ended) throw unsupported('second document');
    const depth = line.match(/^ */)[0].length;
    if (line[depth] === '\t' && (depth === 0 || env === 'open')) throw unsupported('tab indentation');
    if (depth === 0) {
      content = true;
      if (env) env = 'done';
      const top = entry(line);
      if (top.key !== 'env') continue;
      if (env) throw unsupported('duplicate env key');
      if (top.value !== null) throw unsupported('scalar env');
      env = 'open';
      continue;
    }
    if (env !== 'open') continue;
    indent ??= depth;
    if (depth > indent) continue;
    if (depth < indent) throw unsupported('irregular indentation');
    const { key, value } = entry(line.slice(depth));
    if (key !== 'SELF_HOSTING_COMMIT') continue;
    if (value === null) throw unsupported('block value');
    pins.push(value);
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

// A reader tied to one spelling of the env block fails both pin tests on an equivalent workflow, and
// one that reads zero pins from a form it does not parse hides the pin instead of naming the form.
test('the pin reader reads the same commit from each YAML spelling and refuses zero or two pins', () => {
  const sha = 'c1e4833fd3bfdafef68590c48ad88571a3d3c885';
  // Each body is the top-level env block; a job's own env names another value and must not count.
  const workflow = (env, { head = '', tail = '', end = '' } = {}) =>
    `${head}name: self-hosting\non:\n  push:\n${env}\n${tail}jobs:\n  check:\n    env:\n      SELF_HOSTING_COMMIT: 'other'\n${end}`;
  const block = (entry) => `env:\n  NODE_MAJOR: '24'\n${entry}\n  TREE: tree`;
  const equivalent = {
    'key and value unquoted': block(`  SELF_HOSTING_COMMIT: ${sha}`),
    'value single-quoted': block(`  SELF_HOSTING_COMMIT: '${sha}'`),
    'value double-quoted': block(`  SELF_HOSTING_COMMIT: "${sha}"`),
    'value double-quoted with escapes': block(`  SELF_HOSTING_COMMIT: "\\x63\\u0031\\U00000065${sha.slice(3)}"`),
    'key single-quoted': block(`  'SELF_HOSTING_COMMIT': '${sha}'`),
    'key double-quoted': block(`  "SELF_HOSTING_COMMIT": '${sha}'`),
    'key double-quoted with an escape': block(`  "SELF\\x5FHOSTING_COMMIT": ${sha}`),
    'key single-quoted, value double-quoted': block(`  'SELF_HOSTING_COMMIT': "${sha}"`),
    'four-space indentation': `env:\n    NODE_MAJOR: '24'\n    SELF_HOSTING_COMMIT: "${sha}"`,
    'one-space indentation': `env:\n NODE_MAJOR: '24'\n SELF_HOSTING_COMMIT: ${sha}`,
    'blank lines in the block': `env:\n\n  NODE_MAJOR: '24'\n\n  SELF_HOSTING_COMMIT: '${sha}'\n\n  TREE: tree`,
    'full-line comments': `# the environment\nenv:\n  # the pin\n  SELF_HOSTING_COMMIT: '${sha}'\n    # an indented comment\n  TREE: tree`,
    'trailing comments': `env: # the environment\n  SELF_HOSTING_COMMIT: '${sha}' # the pin\n  TREE: tree # the tree`,
    'unquoted value with a trailing comment': block(`  SELF_HOSTING_COMMIT: ${sha}  # the pin`),
    'spaces after the colon': block(`  SELF_HOSTING_COMMIT:     '${sha}'`),
    'env key double-quoted': `"env":\n  SELF_HOSTING_COMMIT: '${sha}'`,
    'env key single-quoted': `'env':\n  SELF_HOSTING_COMMIT: '${sha}'`,
    'pin after a nested value': `env:\n  OTHER:\n    nested: 1\n  SELF_HOSTING_COMMIT: '${sha}'`,
  };
  for (const [name, env] of Object.entries(equivalent)) assert.equal(onePin(workflow(env)), sha, name);
  assert.equal(onePin(workflow(block(`  SELF_HOSTING_COMMIT: '${sha}'`), { head: '---\n' })), sha, 'one explicit document');
  assert.equal(onePin(workflow(block(`  SELF_HOSTING_COMMIT: '${sha}'`), { head: '---\n', end: '...\n' })), sha, 'one document with its end marker');

  const unsupported = {
    'flow mapping for the env map': ['flow mapping', workflow(`env: { SELF_HOSTING_COMMIT: '${sha}' }`)],
    'flow mapping value': ['flow mapping', workflow(block(`  SELF_HOSTING_COMMIT: { sha: '${sha}' }`))],
    'flow mapping document': ['flow mapping', `{ env: { SELF_HOSTING_COMMIT: '${sha}' } }\n`],
    'anchor on the env map': ['anchor', workflow(`env: &environment\n  SELF_HOSTING_COMMIT: '${sha}'`)],
    'anchor on the pin': ['anchor', workflow(block(`  SELF_HOSTING_COMMIT: &pin '${sha}'`))],
    'anchor on the key': ['anchor', workflow(block(`  &key SELF_HOSTING_COMMIT: '${sha}'`))],
    'alias for the pin': ['alias', workflow(block(`  SELF_HOSTING_COMMIT: *pin`))],
    'alias for the env map': ['alias', workflow('env: *environment')],
    'literal block scalar': ['block scalar', workflow(block(`  SELF_HOSTING_COMMIT: |\n    ${sha}`))],
    'folded block scalar': ['block scalar', workflow(block(`  SELF_HOSTING_COMMIT: >-\n    ${sha}`))],
    'merge key': ['merge key', workflow(block('  <<: *base'))],
    'second document': ['second document', workflow(block(`  SELF_HOSTING_COMMIT: '${sha}'`), { tail: `---\nenv:\n  SELF_HOSTING_COMMIT: '${sha}'\n` })],
    'document after an end marker': ['second document', workflow(block(`  SELF_HOSTING_COMMIT: '${sha}'`), { end: `...\n---\nenv:\n  SELF_HOSTING_COMMIT: '${sha}'\n` })],
  };
  for (const [name, [form, text]] of Object.entries(unsupported)) {
    assert.throws(() => onePin(text), { message: `unsupported YAML form for SELF_HOSTING_COMMIT: ${form}` }, name);
  }

  assert.throws(() => onePin(workflow(block(`  # SELF_HOSTING_COMMIT: '${sha}'`))), /found 0/);
  assert.throws(() => onePin(workflow(block(`  SELF_HOSTING_COMMIT: '${sha}'\n  "SELF_HOSTING_COMMIT": "${sha}"`))), /found 2/);
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
