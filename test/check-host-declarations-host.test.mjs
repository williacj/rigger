// ABOUTME: Runs the added-timer mode and preflight's conversion-list step over real Git fixture
// repositories whose tests run under the real suite, so the timer record is the guard's own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testsIn } from '../scripts/build-test-matrix.mjs';
import { gitIn, repositoryAt } from './git-repository.mjs';
import { cases } from './runner-call-forms.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const subject = await import('../scripts/preflight.mjs');
const SOURCE = fileURLToPath(new URL('../', import.meta.url));
const CHECK = join(SOURCE, '.github/scripts/check-host-declarations.mjs');
const CONVERTING = 'test/converting.test.mjs';
const header = "import { test } from 'node:test';\n";
const older = "test('older', () => {});\n";
const arming = "test('arms a real timer', () => { clearTimeout(setTimeout(() => {}, 5)); });\n";

/**
 * A repository whose suite is the real `test/suite.sh` with its lists narrowed to one host stub
 * and two conversion-list files, and whose guard, path helper and reaper are the real ones,
 * linked. Its `npm test` therefore runs the conversion-list file under the real guard.
 */
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
 * What a preflight run must leave as it found it: the fixture's head, its status, and the bytes of
 * every file in its working tree, its tests among them.
 */
function repositoryState(root) {
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !join(entry.parentPath, entry.name).startsWith(join(root, '.git')))
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path) => [path.slice(root.length + 1), createHash('sha256').update(readFileSync(path)).digest('hex')])
    .sort(([a], [b]) => a.localeCompare(b));
  return { head: gitIn(root, 'rev-parse', 'HEAD').trim(), status: gitIn(root, 'status', '--porcelain'), files };
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

test('the CI step refuses tests main added above a lagging pull request base, read from a real record', (t) => {
  const f = suiteFixture(t);
  // The pull request branches at the base and changes nothing in the conversion list; main then
  // gains a test arming a timer and one arming none; the merge head holds both above the event base.
  gitIn(f.root, 'switch', '-qc', 'topic');
  const topic = commit(f.root, { 'test/host-stub.test.mjs': '// ABOUTME: Satisfies the host list in a fixture, changed.\n' });
  gitIn(f.root, 'switch', '-q', '-');
  commit(f.root, { [CONVERTING]: header + older + arming + "test('main clean', () => {});\n" });
  gitIn(f.root, 'merge', '-q', '--no-edit', topic);
  const head = gitIn(f.root, 'rev-parse', 'HEAD').trim();
  const record = join(f.directory, 'record');
  const env = { ...process.env, RIGGER_SUITE_TIMER_RECORD: record };
  delete env.NODE_TEST_CONTEXT;
  const ran = spawnSync('npm', ['test', '--', CONVERTING], { cwd: f.root, encoding: 'utf8', env });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const event = join(f.directory, 'event.json');
  writeFileSync(event, JSON.stringify({ repository: { default_branch: 'main' }, pull_request: { base: { sha: f.base } } }));
  const checked = spawnSync(process.execPath, [CHECK, '--added-timer'], {
    cwd: f.root, encoding: 'utf8',
    env: { ...env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/7/merge', GITHUB_SHA: head, GITHUB_EVENT_PATH: event },
  });
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.equal(checked.stderr, `${CONVERTING}: added test "arms a real timer" armed setTimeout with delay 5\n`);
});

// node:test is the authority on which top-level tests a module registers: each matrix case runs
// under `node --test`, and a reporter names every top-level test or suite with its file.
test('every case of the runner-call matrix registers under node:test exactly the tests the scanner reads', (t) => {
  // The runner names each file by its real path, so the cases are written under one.
  const directory = realpathSync.native(temporaryDirectory('rigger-1138-forms-', { context: t }));
  const all = cases();
  const files = all.map((entry, index) => {
    const file = join(directory, `case-${index}.test.mjs`);
    writeFileSync(file, entry.source);
    return file;
  });
  const reporter = join(directory, 'names.mjs');
  writeFileSync(reporter, [
    '// ABOUTME: Names each top-level test or suite a run registers, with its file.',
    'export default async function* names(source) {',
    '  for await (const event of source) {',
    "    if ((event.type === 'test:pass' || event.type === 'test:fail') && event.data.nesting === 0) yield JSON.stringify([event.data.file, event.data.name]) + '\\n';",
    '  }',
    '}',
    '',
  ].join('\n'));
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  const ran = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, ...files], {
    encoding: 'utf8', env: environment, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const registered = new Map(files.map((file) => [file, []]));
  for (const line of ran.stdout.split('\n').filter(Boolean)) {
    const [file, name] = JSON.parse(line);
    // A file that registers no test is reported as one test named by its own path.
    if (name !== file) registered.get(file)?.push(name);
  }
  const wrong = all.flatMap((entry, index) => {
    const runtime = registered.get(files[index]);
    const found = testsIn(entry.source, `test/case-${index}.test.mjs`);
    const read = [...found.tests.map(({ title }) => title), ...found.unidentified.map(() => '<unidentified>')];
    return JSON.stringify(runtime) === JSON.stringify(entry.registers) && JSON.stringify(read) === JSON.stringify(runtime)
      ? [] : [`${entry.name}: runner ${JSON.stringify(runtime)}, matrix ${JSON.stringify(entry.registers)}, scanner ${JSON.stringify(read)}`];
  });
  assert.deepEqual(wrong, []);
});
