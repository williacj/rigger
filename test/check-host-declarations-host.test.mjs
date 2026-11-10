// ABOUTME: Runs the added-timer mode, its lister and its base worktree, and preflight's
// conversion-list step, over real Git fixture repositories and real node:test runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { addedTimers, gitFacts, listTitles, parseRecord } from '../.github/scripts/check-host-declarations.mjs';
import { CASES, HELPERS } from './added-timer-oracle-cases.mjs';
import { gitIn, repositoryAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const subject = await import('../scripts/preflight.mjs');
const SOURCE = fileURLToPath(new URL('../', import.meta.url));
const CHECK = join(SOURCE, '.github/scripts/check-host-declarations.mjs');
const CONVERTING = 'test/converting.test.mjs';
const header = "import { test } from 'node:test';\n";
const older = "test('older', () => {});\n";
const arming = "test('arms a real timer', () => { clearTimeout(setTimeout(() => {}, 5)); });\n";
// A bound for runs that should end at once: far above a one-file run's start-up, which the
// lister's own runs here take well under a second for.
const BOUND = 60_000;

function tally(titles) {
  const result = new Map();
  for (const title of titles) result.set(title, (result.get(title) ?? 0) + 1);
  return result;
}

/**
 * The linked worktrees git registers for a repository, by the names of their administrative
 * directories under `.git/worktrees`, which `git worktree prune` removes with the registration.
 */
function worktrees(root) {
  const registered = join(root, '.git', 'worktrees');
  return existsSync(registered) ? readdirSync(registered).sort() : [];
}

function suiteFixture(t) {
  const directory = temporaryDirectory('rigger-1138-host-', { context: t });
  const suite = readFileSync(join(SOURCE, 'test/suite.sh'), 'utf8')
    .replace(/host_tests='[\s\S]*?'/, "host_tests='\ntest/host-stub.test.mjs\n'")
    .replace(/awaiting_tests='[\s\S]*?'/, "awaiting_tests='\ntest/host-stub.test.mjs\n'")
    .replace(/converting_tests='[\s\S]*?'/, `converting_tests='\n${CONVERTING}\ntest/other-converting.test.mjs\n'`);
  const root = repositoryAt(join(directory, 'repository'), {
    'docs/spec/requirements-retired.md': '| id | requirement |\n|---|---|\n',
    'docs/spec/decisions-retired.md': '',
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'sh test/suite.sh' } }),
    'test/suite.sh': suite,
    'test/host-stub.test.mjs': '// ABOUTME: Satisfies the host list in a fixture.\n',
    [CONVERTING]: header + older,
    'test/other-converting.test.mjs': header + older,
  });
  for (const name of ['suite-guard.cjs', 'suite-path.cjs', 'suite-reaper']) {
    symlinkSync(join(SOURCE, 'test', name), join(root, 'test', name));
  }
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-qm', 'link the real suite');
  const base = gitIn(root, 'rev-parse', 'HEAD').trim();
  gitIn(root, 'update-ref', 'refs/remotes/origin/main', base);
  const bodyFile = join(directory, 'card.md');
  writeFileSync(bodyFile, '- **Lands in:**\n  - `test/`\n');
  return { directory, root, base, bodyFile };
}

function commit(root, files, message = 'fixture change') {
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-qm', message);
  return gitIn(root, 'rev-parse', 'HEAD').trim();
}

/**
 * What a preflight run must leave as it found it: the fixture's head, its status, the bytes of
 * every file in its working tree, its tests among them, and the worktrees git registers.
 */
function repositoryState(root) {
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !join(entry.parentPath, entry.name).startsWith(join(root, '.git')))
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path) => [path.slice(root.length + 1), createHash('sha256').update(readFileSync(path)).digest('hex')])
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    head: gitIn(root, 'rev-parse', 'HEAD').trim(), status: gitIn(root, 'status', '--porcelain'), files,
    worktrees: worktrees(root),
  };
}

/**
 * Preflight with the real added-timer step and stand-ins answering for the other script checks.
 * Every run, passing or refusing, must leave the fixture repository exactly as it found it.
 */
function preflight(f, { execute } = {}) {
  const lines = [];
  const scriptChecks = subject.SCRIPT_CHECKS.map((check) => check.name === 'added-timer' ? check
    : { name: check.name, command: ['git', 'rev-parse', 'HEAD'] });
  const before = repositoryState(f.root);
  assert.ok(before.files.some(([path]) => path === CONVERTING), 'the fixture must hold the conversion-list file');
  const status = subject.preflight(['1138', '--body-file', f.bodyFile], {
    root: f.root, scriptChecks, write: (line) => lines.push(line), execute,
  });
  assert.deepEqual(repositoryState(f.root), before, 'preflight must leave the fixture repository unchanged');
  return { status, output: lines.join('\n') };
}

const native = (command, args, options) => spawnSync(command, args, { ...options, env: options.env });

test('preflight refuses an added conversion-list test that arms the global setTimeout with delay 5, naming file and title', (t) => {
  const f = suiteFixture(t);
  commit(f.root, { [CONVERTING]: header + older + arming });
  const result = preflight(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /^added-timer: failed$/m);
  assert.ok(result.output.includes(`${CONVERTING}: added test "arms a real timer" armed setTimeout with delay 5`), result.output);
});

// Each place below hides an added test from a scanner that reads only plain statements; the
// refusal must name the file and the title whatever statement or call form holds the test.
const hiddenArms = [
  ['a for-await block', `for await (const value of [0]) {\n  ${arming.trim()}\n}\n`],
  ['a labelled block', `registration: {\n  ${arming.trim()}\n}\n`],
  ['a block after a declaration with no semicolon', `const value = 1\n{\n  ${arming.trim()}\n}\n`],
  ['a quoted computed member', arming.replace("test(", "test['only'](")],
];
for (const [where, added] of hiddenArms) {
  test(`preflight refuses an added conversion-list test that arms a timer in ${where}, naming file and title`, (t) => {
    const f = suiteFixture(t);
    commit(f.root, { [CONVERTING]: header + older + added });
    const result = preflight(f);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /^added-timer: failed$/m);
    assert.ok(result.output.includes(`${CONVERTING}: added test "arms a real timer" armed setTimeout with delay 5`), result.output);
  });
}

test('preflight passes an added conversion-list test that arms no timer'
, (t) => {
  const f = suiteFixture(t);
  commit(f.root, { [CONVERTING]: header + older + "test('arms nothing', () => {});\n" });
  const result = preflight(f);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /^added-timer: passed$/m);
});

test('preflight names a failed npm test run of the added files and runs no added-timer mode after it', (t) => {
  const f = suiteFixture(t);
  commit(f.root, { [CONVERTING]: `${header}import assert from 'node:assert/strict';\n${older}${arming}test('fails', () => { assert.fail('fixture failure'); });\n` });
  const runs = [];
  const result = preflight(f, { execute: (command, args, options) => {
    const answer = native(command, args, options);
    if (command === 'npm') runs.push({ args, status: answer.status });
    return answer;
  } });
  assert.deepEqual(runs.map(({ args, status }) => [args, status]), [[['test', '--', CONVERTING], 1]]);
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(`added-timer: failed (npm test -- ${CONVERTING} exited 1)`), result.output);
  assert.match(result.output, /fixture failure/);
  // The run armed a timer under an added title, so a mode run after it would have named the arm.
  assert.doesNotMatch(result.output, /armed setTimeout/);
});

test('each preflight run records its npm test run in a new directory holding only that run', (t) => {
  const f = suiteFixture(t);
  commit(f.root, { [CONVERTING]: header + older + arming });
  const records = [];
  const execute = (command, args, options) => {
    const directory = options.env?.RIGGER_SUITE_TIMER_RECORD;
    if (command !== 'npm') return native(command, args, options);
    assert.ok(directory, 'the npm test run must name a record directory');
    const existedBefore = existsSync(directory) ? readdirSync(directory) : null;
    const answer = native(command, args, options);
    const lines = readdirSync(directory).flatMap((name) => readFileSync(join(directory, name), 'utf8').trim().split('\n').map((line) => JSON.parse(line)));
    records.push({ directory, existedBefore, lines });
    return answer;
  };
  for (let run = 0; run < 2; run += 1) assert.equal(preflight(f, { execute }).status, 1);
  assert.equal(records.length, 2);
  assert.notEqual(records[0].directory, records[1].directory);
  for (const { existedBefore, lines } of records) {
    assert.ok(existedBefore === null || existedBefore.length === 0, `the directory held ${existedBefore} before its run`);
    assert.deepEqual(lines, [
      { file: CONVERTING, test: null, api: null, delay: null },
      { file: CONVERTING, test: 'arms a real timer', api: 'setTimeout', delay: 5 },
    ]);
  }
  for (const { directory } of records) assert.equal(existsSync(directory), false, 'preflight removes its record directory');
});

test('the CI step compares a pull request with its merge head\'s first parent, so main\'s newer tests are not added, read from a real record', (t) => {
  const f = suiteFixture(t);
  // The pull request branches at the base and adds its own timer-arming test to one conversion
  // file; main then gains a timer-arming test in the other. The merge head's first parent is
  // main's tip, as for the merge ref CI checks out, while the event's base still names the base.
  const other = 'test/other-converting.test.mjs';
  gitIn(f.root, 'switch', '-qc', 'topic');
  const topic = commit(f.root, { [other]: header + older + arming.replace('arms a real timer', 'pull request arms') });
  gitIn(f.root, 'switch', '-q', '-');
  commit(f.root, { [CONVERTING]: header + older + arming + "test('main clean', () => {});\n" });
  gitIn(f.root, 'merge', '-q', '--no-edit', topic);
  const head = gitIn(f.root, 'rev-parse', 'HEAD').trim();
  const record = join(f.directory, 'record');
  const env = { ...process.env, RIGGER_SUITE_TIMER_RECORD: record };
  delete env.NODE_TEST_CONTEXT;
  const ran = spawnSync('npm', ['test', '--', CONVERTING, other], { cwd: f.root, encoding: 'utf8', env });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const event = join(f.directory, 'event.json');
  writeFileSync(event, JSON.stringify({ repository: { default_branch: 'main' }, pull_request: { base: { sha: f.base } } }));
  const before = repositoryState(f.root);
  const checked = spawnSync(process.execPath, [CHECK, '--added-timer'], {
    cwd: f.root, encoding: 'utf8',
    env: { ...env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/7/merge', GITHUB_SHA: head, GITHUB_EVENT_PATH: event },
  });
  assert.deepEqual(repositoryState(f.root), before, 'the check must leave the fixture repository unchanged');
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.equal(checked.stderr, `${other}: added test "pull request arms" armed setTimeout with delay 5\n`);
});


/** A repository at `root` holding `files`, committed, with each later commit made by `commit`. */
function plainFixture(t, files) {
  const directory = temporaryDirectory('rigger-1138-base-', { context: t });
  const root = repositoryAt(join(directory, 'repository'), files);
  return { directory, root, base: gitIn(root, 'rev-parse', 'HEAD').trim() };
}

/** A suite script that answers `--list converting` with `files` and every other list with none. */
const listing = (...files) => `# ABOUTME: Lists a fixture's conversion list.\nif [ "$2" = converting ]; then printf '%s\\n' ${files.join(' ')}; fi\n`;

const recordOf = (lines) => parseRecord(lines.map((line) => JSON.stringify(line)).join('\n'));

test('the lister lists every top-level test each module of the scanner attacks registers, however it registers it', (t) => {
  const directory = temporaryDirectory('rigger-1138-oracle-', { context: t });
  mkdirSync(join(directory, 'test'));
  for (const [name, source] of Object.entries(HELPERS)) writeFileSync(join(directory, 'test', name), source);
  for (const [name, source] of CASES) writeFileSync(join(directory, 'test', name), source);
  const wrong = CASES.flatMap(([name, , titles]) => {
    const listed = listTitles(directory, `test/${name}`, BOUND);
    return listed.error || JSON.stringify([...listed.counts]) !== JSON.stringify([...tally(titles)])
      ? [`${name}: listed ${JSON.stringify(listed.error ?? [...listed.counts])}, registers ${JSON.stringify(titles)}`] : [];
  });
  assert.deepEqual(wrong, []);
});

test('the lister gives no titles for a file that fails to load, one that registers no test, and a run past its bound', (t) => {
  const directory = temporaryDirectory('rigger-1138-lister-', { context: t });
  mkdirSync(join(directory, 'test'));
  writeFileSync(join(directory, 'test/throws.test.mjs'), `${header}test('registered first', () => {});\nthrow new Error('load fails');\n`);
  writeFileSync(join(directory, 'test/none.test.mjs'), 'export const nothing = 1;\n');
  writeFileSync(join(directory, 'test/hangs.test.mjs'), `${header}test('never ends', () => { setInterval(() => {}, 1000); return new Promise(() => {}); });\n`);
  assert.deepEqual(listTitles(directory, 'test/throws.test.mjs', BOUND), { error: 'fails to load the file or registers no test' });
  assert.deepEqual(listTitles(directory, 'test/none.test.mjs', BOUND), { error: 'fails to load the file or registers no test' });
  assert.deepEqual(listTitles(directory, 'test/hangs.test.mjs', 2_000), { error: 'ran past its bound of 2000 ms' });
});

test('the base worktree is a detached checkout of the base under a temporary directory, using the head\'s node_modules, removed and pruned after', (t) => {
  const f = plainFixture(t, { 'file.txt': 'base\n', 'node_modules/kept/index.js': 'export default 1;\n', '.gitignore': 'node_modules\n' });
  writeFileSync(join(f.root, 'file.txt'), 'head\n');
  gitIn(f.root, 'commit', '-qam', 'head');
  const facts = gitFacts(f.root);
  let seen;
  const answer = facts.atBase(f.base, (directory) => {
    seen = directory;
    assert.ok(realpathSync(directory).startsWith(realpathSync(tmpdir()) + '/'), `${directory} is not under the temporary directory`);
    assert.equal(gitIn(directory, 'rev-parse', 'HEAD').trim(), f.base);
    assert.throws(() => gitIn(directory, 'symbolic-ref', '-q', 'HEAD'), /symbolic-ref -q HEAD/, 'the worktree is not detached');
    assert.equal(readFileSync(join(directory, 'file.txt'), 'utf8'), 'base\n');
    assert.ok(lstatSync(join(directory, 'node_modules')).isSymbolicLink());
    assert.equal(readlinkSync(join(directory, 'node_modules')), join(f.root, 'node_modules'));
    assert.equal(worktrees(f.root).length, 1);
    return 'answered';
  });
  assert.equal(answer, 'answered');
  assert.equal(existsSync(seen), false, 'the worktree is removed');
  assert.equal(existsSync(dirname(seen)), false, 'its temporary directory is removed');
  assert.deepEqual(worktrees(f.root), []);
  assert.equal(readFileSync(join(f.root, 'node_modules/kept/index.js'), 'utf8'), 'export default 1;\n', 'the head\'s node_modules is kept');
});

test('the base worktree is removed and pruned when the run inside it throws', (t) => {
  const f = plainFixture(t, { 'file.txt': 'base\n' });
  let seen;
  assert.throws(() => gitFacts(f.root).atBase(f.base, (directory) => { seen = directory; throw new Error('the run failed'); }), /the run failed/);
  assert.equal(existsSync(dirname(seen)), false);
  assert.deepEqual(worktrees(f.root), []);
});

test('a conversion-list test registered through a helper in another file counts under the conversion-list file at the head and at the base', (t) => {
  const helper = "import { test } from 'node:test';\nexport function register(title) { test(title, () => {}); }\n";
  const f = plainFixture(t, {
    'test/suite.sh': listing(CONVERTING),
    'test/register.mjs': helper,
    [CONVERTING]: "import { register } from './register.mjs';\nregister('via helper');\n",
  });
  writeFileSync(join(f.root, CONVERTING), "import { register } from './register.mjs';\nregister('via helper');\nregister('added via helper');\n");
  gitIn(f.root, 'commit', '-qam', 'add a test through the helper');
  const head = gitIn(f.root, 'rev-parse', 'HEAD').trim();
  const record = recordOf([
    { file: CONVERTING, test: null, api: null, delay: null },
    { file: CONVERTING, test: 'via helper', api: 'setTimeout', delay: 5 },
    { file: CONVERTING, test: 'added via helper', api: 'setTimeout', delay: 5 },
  ]);
  assert.deepEqual(addedTimers({ base: f.base, head, facts: gitFacts(f.root, { bound: BOUND }), record }),
    { ok: false, errors: [`${CONVERTING}: added test "added via helper" armed setTimeout with delay 5`] });
  assert.deepEqual(worktrees(f.root), []);
});

test('the base run loads the head\'s node_modules, and a base run that fails to load a package the head no longer installs is refused naming the file', (t) => {
  const f = plainFixture(t, {
    '.gitignore': 'node_modules\n',
    'node_modules/installed/package.json': JSON.stringify({ name: 'installed', type: 'module', main: 'index.js' }),
    'node_modules/installed/index.js': 'export const title = \'from the installed package\';\n',
    'test/suite.sh': listing(CONVERTING, 'test/other-converting.test.mjs'),
    [CONVERTING]: `${header}import { title } from 'installed';\ntest(title, () => {});\n`,
    'test/other-converting.test.mjs': `${header}import { title } from 'removed';\ntest(title, () => {});\n`,
  });
  writeFileSync(join(f.root, CONVERTING), `${header}import { title } from 'installed';\ntest(title, () => {});\ntest('added', () => {});\n`);
  writeFileSync(join(f.root, 'test/other-converting.test.mjs'), `${header}test('rewritten', () => {});\n`);
  gitIn(f.root, 'commit', '-qam', 'drop the removed package');
  const head = gitIn(f.root, 'rev-parse', 'HEAD').trim();
  const record = recordOf([
    { file: CONVERTING, test: null, api: null, delay: null },
    { file: 'test/other-converting.test.mjs', test: null, api: null, delay: null },
    { file: CONVERTING, test: 'from the installed package', api: 'setTimeout', delay: 5 },
  ]);
  assert.deepEqual(addedTimers({ base: f.base, head, facts: gitFacts(f.root, { bound: BOUND }), record }), {
    ok: false, errors: ['test/other-converting.test.mjs: the base run fails to load the file or registers no test'],
  });
  assert.deepEqual(worktrees(f.root), []);
});

test('a base run past the mode\'s bound is refused naming the file and the bound, and its worktree is removed', (t) => {
  const f = plainFixture(t, {
    'test/suite.sh': listing(CONVERTING),
    [CONVERTING]: `${header}test('never ends', () => { setInterval(() => {}, 1000); return new Promise(() => {}); });\n`,
  });
  writeFileSync(join(f.root, CONVERTING), `${header}test('ends', () => {});\n`);
  gitIn(f.root, 'commit', '-qam', 'end the test');
  const head = gitIn(f.root, 'rev-parse', 'HEAD').trim();
  const record = recordOf([{ file: CONVERTING, test: null, api: null, delay: null }]);
  assert.deepEqual(addedTimers({ base: f.base, head, facts: gitFacts(f.root, { bound: 2_000 }), record }),
    { ok: false, errors: [`${CONVERTING}: the base run ran past its bound of 2000 ms`] });
  assert.deepEqual(worktrees(f.root), []);
});
