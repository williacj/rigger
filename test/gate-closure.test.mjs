// ABOUTME: Checks the gate import closure and the self-hosting pin in the tree being committed.
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
import { commitParents, repositoryAt, worktreeAt } from './git-repository.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

/** `SELF_HOSTING_COMMIT` as a whole identifier, never part of a longer one. */
const KEY = /(?<![A-Za-z0-9_])SELF_HOSTING_COMMIT(?![A-Za-z0-9_])/g;
/** Whether `line` holds the key anywhere but as the shell reference `${SELF_HOSTING_COMMIT}`, read in place. */
const bareKey = (line) => [...line.matchAll(KEY)]
  .some(({ index }) => !(line.slice(index - 2, index) === '${' && line[index + 'SELF_HOSTING_COMMIT'.length] === '}'));

/**
 * The commit a workflow pins for the check's code, from its one canonical line. Any other line
 * naming `SELF_HOSTING_COMMIT` as a whole identifier, except as the shell reference
 * `${SELF_HOSTING_COMMIT}`, is refused by its line number, and so is a workflow with no canonical
 * line or with two.
 */
function canonicalPin(workflow) {
  const lines = workflow.split('\n');
  const canonical = [];
  lines.forEach((line, index) => {
    if (CANONICAL.test(line)) canonical.push(index + 1);
    else if (bareKey(line)) {
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
  // The key counts only as a whole identifier outside `${...}`: a shell reference is never joined to
  // the text around it, and a longer identifier holding the key's letters is another name.
  const allowed = {
    'a comment splitting the key around a shell reference': '  # SELF_${SELF_HOSTING_COMMIT}HOSTING_COMMIT',
    'letters before the key': "  XSELF_HOSTING_COMMIT: 'other'",
    'letters after the key': "  SELF_HOSTING_COMMITX: 'other'",
  };
  for (const [name, line] of Object.entries(allowed)) {
    assert.equal(canonicalPin(workflow(`  SELF_HOSTING_COMMIT: '${sha}'\n${line}`)), sha, name);
  }
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
    'an expression reference': '  NOTE: ${{ env.SELF_HOSTING_COMMIT }}',
  };
  for (const [name, line] of Object.entries(refused)) {
    const text = workflow(line);
    const at = text.split('\n').findIndex((each) => each.includes('SELF_HOSTING_COMMIT') && !each.includes('${SELF_HOSTING_COMMIT}')) + 1;
    assert.throws(() => canonicalPin(text), { message: atLine(at) }, name);
  }
  const mixed = workflow(`  SELF_HOSTING_COMMIT: '${sha}'\n  # \${SELF_HOSTING_COMMIT} SELF_HOSTING_COMMIT`);
  assert.throws(() => canonicalPin(mixed), { message: atLine(7) }, 'a bare key beside a shell reference on one line');
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

/** Refuses a pin that the commit being made cannot reach through its parents. */
function assertPinReached(root, pin) {
  const parents = commitParents(root);
  const reached = parents.some((parent) => {
    try { return gitIn(root, 'merge-base', pin, parent).trim() === pin; }
    catch { return false; }
  });
  assert.ok(reached, `${pin} is no ancestor of the commit being made (parents: ${parents.join(', ')})`);
}

// A squash-merged pull request's own head is still unreachable through the commit's parents
// (D35 rule 6); a real merge also reaches the commits recorded in its worktree's MERGE_HEAD.
test('the self-hosting check pins a commit the commit being made reaches', () => {
  assertPinReached(ROOT, checkPin());
});

/** Commits one fixture file with real git, returning the commit it made. */
function commitFile(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
  gitIn(root, 'add', path);
  gitIn(root, 'commit', '-qm', path);
  return gitIn(root, 'rev-parse', 'HEAD').trim();
}

const workflowPin = (pin) => `env:\n  SELF_HOSTING_COMMIT: '${pin}'\n`;
const pinIn = (root) => canonicalPin(readFileSync(join(root, WORKFLOW), 'utf8'));

/** Diverged branches: incoming moves the workflow's pin to its own ancestor. */
function pinMergeFixture() {
  const directory = temporaryDirectory('rigger-pin-parents-');
  const root = repositoryAt(join(directory, 'repository'), { conflict: 'base\n' });
  gitIn(root, 'branch', '-M', 'main');
  const base = gitIn(root, 'rev-parse', 'HEAD').trim();
  const fork = commitFile(root, WORKFLOW, workflowPin(base));
  gitIn(root, 'switch', '-qc', 'incoming');
  const pin = commitFile(root, 'incoming', 'incoming\n');
  const incoming = commitFile(root, WORKFLOW, workflowPin(pin));
  gitIn(root, 'switch', '-q', 'main');
  const head = commitFile(root, 'local', 'local\n');
  return { directory, root, base, fork, pin, incoming, head };
}

/** Git's own per-worktree record path, independently observed by the fixtures. */
const recordPath = (root, name) => resolve(root, gitIn(root, 'rev-parse', '--git-path', name).trim());
const mergeRecord = (root) => readFileSync(recordPath(root, 'MERGE_HEAD'), 'utf8').trim().split('\n');

/** The common check reads the workflow without changing the commit, index, worktree or merge. */
function assertPinOutcome(root, accepted) {
  const pin = pinIn(root);
  const snapshot = () => ({
    head: gitIn(root, 'rev-parse', 'HEAD'),
    status: gitIn(root, 'status', '--porcelain'),
    workflow: readFileSync(join(root, WORKFLOW), 'utf8'),
    merge: existsSync(recordPath(root, 'MERGE_HEAD')) ? mergeRecord(root) : null,
  });
  const before = snapshot();
  if (accepted) assert.doesNotThrow(() => assertPinReached(root, pin));
  else assert.throws(() => assertPinReached(root, pin), (error) => {
    assert.equal(error.code, 'ERR_ASSERTION');
    assert.ok(error.message.includes(pin), error.message);
    return true;
  });
  assert.deepEqual(snapshot(), before, 'checking the pin must leave the repository unchanged');
}

// Omitting HEAD outside a merge would refuse an ordinary staged commit with an ancestor pin.
test('P1: an ordinary commit reaches an ancestor pin through HEAD', () => {
  const { root, base, head } = pinMergeFixture();
  assert.notEqual(base, head);
  assert.equal(pinIn(root), base);
  assert.equal(gitIn(root, 'merge-base', base, 'HEAD').trim(), base);
  assert.equal(existsSync(recordPath(root, 'MERGE_HEAD')), false);
  assertPinOutcome(root, true);
});

// Considering all refs instead of parents would accept this unmerged branch/remote pin.
test('P2: branch and remote-tracking reachability cannot admit an ordinary commit', () => {
  const { root, pin, incoming } = pinMergeFixture();
  gitIn(root, 'update-ref', 'refs/remotes/origin/incoming', incoming);
  assert.equal(gitIn(root, 'merge-base', pin, 'incoming').trim(), pin);
  assert.equal(gitIn(root, 'merge-base', pin, 'refs/remotes/origin/incoming').trim(), pin);
  assert.notEqual(gitIn(root, 'merge-base', pin, 'HEAD').trim(), pin);
  writeFileSync(join(root, WORKFLOW), workflowPin(pin));
  gitIn(root, 'add', WORKFLOW);
  assert.equal(existsSync(recordPath(root, 'MERGE_HEAD')), false);
  assertPinOutcome(root, false);
});

// Treating a failed git lookup as acceptance would hide a pin that names no object.
test('P3: a missing pin object is refused by its name', () => {
  const { root } = pinMergeFixture();
  const pin = 'f'.repeat(40);
  assert.throws(() => gitIn(root, 'cat-file', '-e', pin));
  writeFileSync(join(root, WORKFLOW), workflowPin(pin));
  gitIn(root, 'add', WORKFLOW);
  assertPinOutcome(root, false);
});

// HEAD alone wrongly refuses the workflow merged from incoming before the merge commit exists.
test('M1: a merge across a pin move reaches the pin through the merged commit', () => {
  const { root, pin, incoming, head } = pinMergeFixture();
  assert.notEqual(gitIn(root, 'merge-base', pin, 'HEAD').trim(), pin);
  gitIn(root, 'merge', '--no-commit', '--no-ff', incoming);
  assert.equal(gitIn(root, 'rev-parse', 'HEAD').trim(), head);
  assert.equal(gitIn(root, 'rev-parse', 'MERGE_HEAD').trim(), incoming);
  assert.equal(pinIn(root), pin);
  assertPinOutcome(root, true);
});

// Considering only MERGE_HEAD would refuse a merge that keeps HEAD's existing ancestor pin.
test('M2: a merge that keeps the pin reaches it through HEAD', () => {
  const { root, base, head } = pinMergeFixture();
  gitIn(root, 'switch', '-q', 'incoming');
  const incoming = commitFile(root, WORKFLOW, workflowPin(base));
  gitIn(root, 'switch', '-q', 'main');
  commitFile(root, WORKFLOW, workflowPin(head));
  gitIn(root, 'merge', '--no-commit', '--no-ff', incoming);
  assert.deepEqual(mergeRecord(root), [incoming]);
  assert.equal(pinIn(root), head);
  assert.equal(gitIn(root, 'merge-base', head, 'HEAD').trim(), head);
  assert.notEqual(gitIn(root, 'merge-base', head, incoming).trim(), head);
  assertPinOutcome(root, true);
});

// A merge record is no blanket permission for an unrelated pin staged into its tree.
test('M3: a merge refuses a pin neither parent reaches', () => {
  const { root, fork, incoming } = pinMergeFixture();
  gitIn(root, 'switch', '-qc', 'unreachable', fork);
  const pin = commitFile(root, 'unreachable', 'unreachable\n');
  gitIn(root, 'switch', '-q', 'main');
  gitIn(root, 'merge', '--no-commit', '--no-ff', incoming);
  assert.deepEqual(mergeRecord(root), [incoming]);
  for (const parent of ['HEAD', incoming]) assert.notEqual(gitIn(root, 'merge-base', pin, parent).trim(), pin);
  writeFileSync(join(root, WORKFLOW), workflowPin(pin));
  gitIn(root, 'add', WORKFLOW);
  assertPinOutcome(root, false);
});

// Looking in the common .git directory misses a linked worktree's own merge record.
test('M4: a linked worktree merge reaches the pin through its own merged commit', () => {
  const { directory, root, incoming, pin } = pinMergeFixture();
  const linked = worktreeAt(root, join(directory, 'linked'), 'linked');
  assert.notEqual(gitIn(linked, 'merge-base', pin, 'HEAD').trim(), pin);
  gitIn(linked, 'merge', '--no-commit', '--no-ff', incoming);
  assert.deepEqual(mergeRecord(linked), [incoming]);
  assert.equal(existsSync(recordPath(root, 'MERGE_HEAD')), false);
  assert.equal(pinIn(linked), pin);
  assertPinOutcome(linked, true);
});

// Reading only the first MERGE_HEAD line would miss an octopus merge's second incoming parent.
test('M5: an octopus merge reaches the pin only through its second merged commit', () => {
  const { root, fork, incoming, pin } = pinMergeFixture();
  gitIn(root, 'switch', '-qc', 'first', fork);
  const first = commitFile(root, 'first', 'first\n');
  gitIn(root, 'switch', '-q', 'main');
  for (const parent of ['HEAD', first]) assert.notEqual(gitIn(root, 'merge-base', pin, parent).trim(), pin);
  gitIn(root, 'merge', '--no-commit', '--no-ff', first, incoming);
  assert.deepEqual(mergeRecord(root), [first, incoming]);
  for (const path of ['local', 'first', 'incoming']) {
    assert.equal(readFileSync(join(root, path), 'utf8'), `${path}\n`);
    assert.equal(gitIn(root, 'show', `:${path}`), `${path}\n`);
  }
  assert.equal(pinIn(root), pin);
  assertPinOutcome(root, true);
});

/** Diverged edits force git to stop a merge, cherry-pick or rebase at a real conflict. */
function conflictingPinFixture() {
  const fixture = pinMergeFixture();
  const { root } = fixture;
  gitIn(root, 'switch', '-q', 'incoming');
  const tip = commitFile(root, 'conflict', 'incoming\n');
  gitIn(root, 'switch', '-q', 'main');
  commitFile(root, 'conflict', 'local\n');
  return { ...fixture, tip };
}

// A resolved index does not end the merge: its additional parent must still be considered.
test('M6: a resolved and staged conflicted merge reaches the incoming pin', () => {
  const { root, tip, pin } = conflictingPinFixture();
  assert.throws(() => gitIn(root, 'merge', '--no-commit', '--no-ff', tip));
  assert.equal(gitIn(root, 'diff', '--name-only', '--diff-filter=U'), 'conflict\n');
  writeFileSync(join(root, 'conflict'), 'resolved\n');
  gitIn(root, 'add', 'conflict');
  assert.equal(gitIn(root, 'diff', '--name-only', '--diff-filter=U'), '');
  assert.deepEqual(mergeRecord(root), [tip]);
  assert.notEqual(gitIn(root, 'merge-base', pin, 'HEAD').trim(), pin);
  assert.equal(pinIn(root), pin);
  assertPinOutcome(root, true);
});

// A staged squash has no merged parent even though its source branch reaches the pin.
test('S1: a squash cannot admit the pin reached only by the squashed branch', () => {
  const { root, incoming, pin } = pinMergeFixture();
  gitIn(root, 'merge', '--squash', incoming);
  assert.equal(existsSync(recordPath(root, 'MERGE_HEAD')), false);
  assert.equal(existsSync(recordPath(root, 'SQUASH_MSG')), true);
  assert.notEqual(gitIn(root, 'merge-base', pin, 'HEAD').trim(), pin);
  assert.equal(pinIn(root), pin);
  assertPinOutcome(root, false);
});

// CHERRY_PICK_HEAD names a source, never a parent of the commit the hook is checking.
test('C1: a cherry-pick in progress cannot admit a pin reached only by its source', () => {
  const { root, tip } = conflictingPinFixture();
  assert.throws(() => gitIn(root, 'cherry-pick', tip));
  assert.equal(gitIn(root, 'rev-parse', 'CHERRY_PICK_HEAD').trim(), tip);
  assert.equal(existsSync(recordPath(root, 'MERGE_HEAD')), false);
  assert.notEqual(gitIn(root, 'merge-base', tip, 'HEAD').trim(), tip);
  writeFileSync(join(root, WORKFLOW), workflowPin(tip));
  gitIn(root, 'add', WORKFLOW);
  assertPinOutcome(root, false);
});

// ORIG_HEAD, REBASE_HEAD and the pre-rebase branch tip are not parents of the current step.
test('R1: a stopped rebase cannot admit a pin reached only by the pre-rebase tip', () => {
  const { root, tip } = conflictingPinFixture();
  assert.throws(() => gitIn(root, 'rebase', 'main', 'incoming'));
  assert.equal(gitIn(root, 'rev-parse', 'incoming').trim(), tip);
  assert.equal(gitIn(root, 'rev-parse', 'REBASE_HEAD').trim(), tip);
  assert.equal(existsSync(recordPath(root, 'MERGE_HEAD')), false);
  assert.notEqual(gitIn(root, 'merge-base', tip, 'HEAD').trim(), tip);
  writeFileSync(join(root, WORKFLOW), workflowPin(tip));
  gitIn(root, 'add', WORKFLOW);
  assertPinOutcome(root, false);
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
