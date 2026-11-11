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
/** The indicators that open a form other than a plain or quoted scalar, by the form each opens. */
const FORMS = { '{': 'flow mapping', '[': 'flow sequence', '&': 'anchor', '*': 'alias', '!': 'tag',
  '|': 'block scalar', '>': 'block scalar', '%': 'directive', '@': 'reserved indicator', '`': 'reserved indicator' };
/** YAML's white space is the space and the tab, and nothing else (YAML 1.2, section 5.5). */
const space = (character) => character === ' ' || character === '\t';
const blank = (text) => /^[ \t]*(#.*)?$/.test(text);
const trimEnd = (text) => text.replace(/[ \t]+$/, '');

/** The value of the quoted scalar opening `text`, and the text after it; null if it does not close on this line. */
function quoted(text) {
  let value = '', at = 1;
  while (at < text.length) {
    if (text[0] === "'") {
      if (text[at] === "'" && text[at + 1] === "'") { value += "'"; at += 2; continue; }
      if (text[at] === "'") return { value, rest: text.slice(at + 1) };
      value += text[at++];
      continue;
    }
    if (text[at] === '"') return { value, rest: text.slice(at + 1) };
    if (text[at] !== '\\') { value += text[at++]; continue; }
    const code = text[at + 1];
    if (code === undefined) return null;
    if (code === '\n') { at += 2; continue; }
    if (code in ESCAPES) { value += ESCAPES[code]; at += 2; continue; }
    const digits = text.slice(at + 2, at + 2 + (HEX[code] ?? 0));
    if (!HEX[code] || !/^[0-9a-fA-F]+$/.test(digits) || digits.length !== HEX[code]) throw unsupported('invalid escape');
    value += String.fromCodePoint(parseInt(digits, 16));
    at += 2 + HEX[code];
  }
  return null;
}

/** The key of a `key: value` line and the text after its colon, or null where the line holds no such key. */
function keyOf(text) {
  if (text[0] === "'" || text[0] === '"') {
    const key = quoted(text);
    const colon = key?.rest.match(/^[ \t]*:([ \t]|$)/);
    return colon ? { key: key.value, after: key.rest.slice(colon[0].length) } : null;
  }
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '#' && at > 0 && space(text[at - 1])) return null;
    if (text[at] === ':' && (at + 1 === text.length || space(text[at + 1]))) {
      return { key: trimEnd(text.slice(0, at)), after: text.slice(at + 1) };
    }
  }
  return null;
}

/** Throws if `rest`, after a scalar or a flow collection closes, holds more than space and a comment. */
function lineEnd(rest) {
  if (!/^([ \t]*|[ \t]+#.*)$/.test(rest)) throw unsupported('content after a closed value');
}

/**
 * The line after the end of a value that may run past its line: a quoted scalar or a flow
 * collection. It scans quotes, escapes, brackets and comments only far enough to find that end.
 */
function valueEnd(lines, index, text) {
  if (text[0] === "'" || text[0] === '"') {
    let open = text, line = index;
    for (;;) {
      const closed = quoted(open);
      if (closed) { lineEnd(closed.rest); return line; }
      if (++line >= lines.length) throw unsupported('unclosed quoted scalar');
      open = `${open}\n${lines[line]}`;
    }
  }
  let depth = 0, line = index, at = 0, current = text;
  for (;;) {
    if (at >= current.length) {
      if (++line >= lines.length) throw unsupported('unclosed flow collection');
      current = lines[line]; at = 0;
      continue;
    }
    const character = current[at];
    if (character === '#' && (at === 0 || space(current[at - 1]))) { at = current.length; continue; }
    if ((character === "'" || character === '"') && (at === 0 || /[ \t[{,:]/.test(current[at - 1]))) {
      let open = current.slice(at);
      while (!quoted(open)) {
        if (++line >= lines.length) throw unsupported('unclosed quoted scalar');
        open = `${open}\n${lines[line]}`;
      }
      const rest = quoted(open).rest;
      current = rest.slice(rest.lastIndexOf('\n') + 1); at = 0;
      continue;
    }
    if (character === '{' || character === '[') depth++;
    if (character === '}' || character === ']') depth--;
    at++;
    if (depth === 0) { lineEnd(current.slice(at)); return line; }
  }
}

/** The pin a `SELF_HOSTING_COMMIT: <value>` entry holds, from the text after its colon; null where none follows on the line. */
function pinValue(after) {
  const text = after.replace(/^[ \t]+/, '');
  if (blank(text)) return null;
  if (FORMS[text[0]]) throw unsupported(FORMS[text[0]]);
  let value;
  if (text[0] === "'" || text[0] === '"') {
    const closed = quoted(text);
    if (!closed) throw unsupported('multi-line scalar');
    lineEnd(closed.rest);
    value = closed.value;
  } else {
    const comment = text.search(/[ \t]#/);
    value = trimEnd(comment === -1 ? text : text.slice(0, comment));
  }
  if (!/^[0-9a-f]{40}$/.test(value)) throw unsupported('value not a commit');
  return value;
}

/**
 * The values `SELF_HOSTING_COMMIT` takes in a workflow's top-level `env` block mapping.
 *
 * It reads the key and the value plain, single- or double-quoted, at any indentation, around blank
 * lines and comments, with a byte-order mark at the very start and CRLF line ends. It skips every
 * other key's value, a block scalar, a quoted scalar or a flow collection running past its line
 * included, so a value never reads as a key. Any other form for the `env` map, its keys or the
 * pin throws `unsupported YAML form for SELF_HOSTING_COMMIT: <form>`, and so does a pin that is not
 * 40 lowercase hex characters, so it never returns a value the workflow does not hold.
 */
function pinsIn(workflow) {
  const source = workflow.startsWith('\uFEFF') ? workflow.slice(1) : workflow;
  if (/\r(?!\n)/.test(source)) throw unsupported('lone CR line ending');
  const lines = source.split(/\r?\n/);
  const pins = [];
  let started = false, ended = false, env = 'none', indent = null;
  // Lines deeper than `skip` belong to the value before them; lines deeper than `pin.column` are refused.
  let skip = null, pin = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (blank(line)) continue;
    const depth = line.match(/^ */)[0].length;
    if (pin) {
      if (depth > pin.column) throw unsupported(pin.value === null ? 'value on next line' : 'multi-line scalar');
      if (pin.value === null) throw unsupported('value not a commit');
      pin = null;
    }
    if (skip !== null && depth > skip) continue;
    skip = null;
    if (line[depth] === '\t') throw unsupported('tab indentation');
    if (depth === 0 && /^(---|\.\.\.)([ \t]|$)/.test(line)) {
      if (!blank(line.slice(3))) throw unsupported('content on a document marker');
      if (ended || (line.startsWith('---') && started)) throw unsupported('second document');
      if (line.startsWith('...')) ended = true;
      continue;
    }
    if (ended) throw unsupported('second document');
    started = true;
    if (depth === 0 && env === 'open') env = 'closed';
    if (env === 'open') {
      indent ??= depth;
      if (depth < indent) throw unsupported('irregular indentation');
    }
    // Where the line is a key of the document or of the env map, a form there is a form of that map.
    const mapped = depth === 0 || (env === 'open' && depth === indent);
    let column = depth;
    while (line[column] === '-' && (column + 1 === line.length || space(line[column + 1]))) {
      if (mapped) throw unsupported('sequence');
      column++;
      while (space(line[column] ?? '')) column++;
    }
    let text = line.slice(column);
    if (blank(text)) continue;
    if (mapped) {
      if (/^<<[ \t]*:/.test(text)) throw unsupported('merge key');
      if (/^\?([ \t]|$)/.test(text)) throw unsupported('explicit key');
      if (FORMS[text[0]]) throw unsupported(FORMS[text[0]]);
    } else {
      while (/^[&!][^ \t]*[ \t]+/.test(text)) text = text.replace(/^[&!][^ \t]*[ \t]+/, '');
    }
    if (!mapped && (text[0] === '{' || text[0] === '[')) {
      index = valueEnd(lines, index, text);
      skip = depth;
      continue;
    }
    const entry = keyOf(text);
    if (!entry) {
      if (mapped) throw unsupported('line that is not a key');
      // A scalar or a flow collection in a sequence item: skip what it spans.
      if (text[0] === "'" || text[0] === '"') index = valueEnd(lines, index, text);
      skip = depth;
      continue;
    }
    if (depth === 0 && entry.key === 'env') {
      const after = entry.after.replace(/^[ \t]+/, '');
      if (!blank(after)) throw unsupported(FORMS[after[0]] ?? 'scalar env');
      if (env !== 'none') throw unsupported('duplicate env key');
      env = 'open';
      continue;
    }
    if (env === 'open' && depth === indent && entry.key === 'SELF_HOSTING_COMMIT') {
      const value = pinValue(entry.after);
      if (value !== null) pins.push(value);
      pin = { column, value };
      continue;
    }
    let value = entry.after.replace(/^[ \t]+/, '');
    while (/^[&!][^ \t]*([ \t]+|$)/.test(value)) value = value.replace(/^[&!][^ \t]*([ \t]+|$)/, '');
    if (blank(value)) continue;
    if ('\'"{['.includes(value[0])) index = valueEnd(lines, index, value);
    skip = column;
  }
  if (pin?.value === null) throw unsupported('value not a commit');
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
  const other = '0'.repeat(40);
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
    'spaces before the colon': block(`  SELF_HOSTING_COMMIT  : ${sha}`),
    'a tab after the colon': block(`  SELF_HOSTING_COMMIT:\t'${sha}'`),
    'a flow sequence in another entry running over lines': block(`  LIST: [a,\n  SELF_HOSTING_COMMIT: ${other}]\n  SELF_HOSTING_COMMIT: ${sha}`),
  };
  for (const [name, env] of Object.entries(equivalent)) assert.equal(onePin(workflow(env)), sha, name);
  const plain = workflow(block(`  SELF_HOSTING_COMMIT: '${sha}'`));
  assert.equal(onePin(`\uFEFF${plain}`), sha, 'a byte-order mark at the start');
  assert.equal(onePin(plain.replace(/\n/g, '\r\n')), sha, 'CRLF line ends');
  assert.equal(onePin(workflow(block(`  SELF_HOSTING_COMMIT: '${sha}'`), { head: 'description: >-\n  folded\n  text\n' })), sha,
    'a block scalar on another top-level key');
  assert.equal(onePin(workflow(block(`  SELF_HOSTING_COMMIT: '${sha}'`), { head: `title: "a\nenv:\n  SELF_HOSTING_COMMIT: ${other}\nz"\n` })), sha,
    'a quoted value running over lines that read as an env map');
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
    'a plain value continued on a deeper line': ['multi-line scalar', workflow(block(`  SELF_HOSTING_COMMIT: ${sha}\n    extra`))],
    'a quoted value running past its line': ['multi-line scalar', workflow(block(`  SELF_HOSTING_COMMIT: "${sha}\n    "`))],
    'a value on the next line': ['value on next line', workflow(block(`  SELF_HOSTING_COMMIT:\n    ${sha}`))],
    'an empty value': ['value not a commit', workflow(block('  SELF_HOSTING_COMMIT:'))],
    'a no-break space before the comment': ['value not a commit', workflow(block(`  SELF_HOSTING_COMMIT: ${sha}\u00a0# the pin`))],
    'a null value': ['value not a commit', workflow(block('  SELF_HOSTING_COMMIT: ~'))],
    'a value holding a colon': ['value not a commit', workflow(block(`  SELF_HOSTING_COMMIT: ${sha}: x`))],
    'an upper-case commit': ['value not a commit', workflow(block(`  SELF_HOSTING_COMMIT: ${sha.toUpperCase()}`))],
    'a short commit': ['value not a commit', workflow(block(`  SELF_HOSTING_COMMIT: '${sha.slice(0, 12)}'`))],
    'a tag on the pin': ['tag', workflow(block(`  SELF_HOSTING_COMMIT: !!str ${sha}`))],
    'content after a quoted pin': ['content after a closed value', workflow(block(`  SELF_HOSTING_COMMIT: '${sha}' x`))],
    'lone CR line ends': ['lone CR line ending', workflow(block(`  SELF_HOSTING_COMMIT: '${sha}'`)).replace(/\n/g, '\r')],
  };
  for (const [name, [form, text]] of Object.entries(unsupported)) {
    assert.throws(() => onePin(text), { message: `unsupported YAML form for SELF_HOSTING_COMMIT: ${form}` }, name);
  }

  assert.throws(() => onePin(workflow(block(`  # SELF_HOSTING_COMMIT: '${sha}'`))), /found 0/);
  // A no-break space is no YAML white space, so these name another key, and the workflow holds no pin.
  assert.throws(() => onePin(workflow(block(`  SELF_HOSTING_COMMIT\u00a0: ${sha}`))), /found 0/);
  assert.throws(() => onePin(workflow(`\uFEFF${block(`  SELF_HOSTING_COMMIT: '${sha}'`)}`)), /found 0/);
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
