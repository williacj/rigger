// ABOUTME: Proves fixture stdin, installed plan, and matrix entry wiring through real child boundaries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { installFromTarball } from './installed-rigger.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { FORGE_MANIFEST, assertForgeState, assertOriginState, judgeInput, originFixture, parsedFindings, withFacts } from './in-process-fixtures.mjs';
import { stubGh } from './stub-gh.mjs';
import { installStandInAgent, standInCodex, stubClaude, stubCodex } from './stub-claude.mjs';
import { CONSUMER, COLUMNS, FIELDS, card, matrixRepository } from './in-process-entry.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { parseMarker } from '../src/workflow/marker.mjs';
import { admissionOf, closerText, seed } from './admission-world.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { setTimeout as observed } from 'node:timers/promises';
import { alive, until } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-fixtures.test.mjs :: an in-process forge reads comment body sources from supplied request context.
test('supplied input overrides fd0 EOF for fake gh comments', async (t) => {
  const directory = temporaryDirectory('rigger-forge-input-host-', { context: t });
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify({
    repo: 'example/widgets', owner: 'example', project: 23, model: {}, writes: [], sent: [],
    repository: { pullRequests: [{ number: 301, head: 'topic', sha: 'a'.repeat(40), comments: [] }] },
  }));
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).sent, [], 'the owned state starts before any request');
  const helper = new URL('./fake-gh.mjs', import.meta.url).href;
  const payload = `import { readFileSync } from 'node:fs';
import { answerFakeGh } from ${JSON.stringify(helper)};
const emptyInput = readFileSync(0, 'utf8');
const answer = await answerFakeGh(process.argv[1], ['pr', 'comment', '301', '--body-file', '-'],
  { now: () => '2000-04-05T06:07:08Z', input: () => 'Host supplied input.\\n' });
process.stdout.write(JSON.stringify({ pid: process.pid, emptyInput, answer }) + '\\n');
`;
  const argv = ['--input-type=module', '-e', payload, statePath];
  const environment = { HOME: directory, LANG: 'C.UTF-8', PATH: process.env.PATH };
  const child = spawn(process.execPath, argv, {
    cwd: directory, env: environment, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const started = { pid: child.pid ?? null, command: process.execPath, argv, cwd: directory, environment };
  writeFileSync(join(directory, 'child-start.json'), JSON.stringify(started));
  t.diagnostic(`child-start ${JSON.stringify(started)}`);
  let stdout = '';
  let stderr = '';
  let startFailure;
  let inputFailure;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', (error) => { startFailure = error; });
  child.stdin.once('error', (error) => { inputFailure = error; });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  child.stdin.end();
  const ended = await closed;
  const completed = { pid: child.pid ?? null, ...ended, stdinFinished: child.stdin.writableFinished, stdout, stderr };
  writeFileSync(join(directory, 'child-end.json'), JSON.stringify(completed));
  t.diagnostic(`child-end ${JSON.stringify(completed)}`);
  assert.ifError(startFailure);
  assert.ifError(inputFailure);
  assert.ok(Number.isSafeInteger(started.pid) && started.pid > 0, 'the actual child PID was recorded at start');
  assert.deepEqual(ended, { code: 0, signal: null }, stderr);
  assert.equal(child.stdin.writableFinished, true, 'the parent explicitly ended the empty child input');
  assert.equal(stderr, '', 'the plain child has no setup or import stderr');
  assert.deepEqual(JSON.parse(stdout), {
    pid: started.pid, emptyInput: '',
    answer: { status: 0, stdout: 'https://github.com/example/widgets/pull/301#issuecomment-1\n', stderr: '' },
  }, 'the child loaded, observed actual finite empty fd0, and completed the modeled comment');
  const held = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(held.sent, [['pr', 'comment', '301', '--body-file', '-']], 'the actual request is recorded exactly once');
  assert.deepEqual(held.writes, [], 'the comment invents no board write');
  assert.equal(held.repository.pullRequests.length, 1);
  assert.equal(held.repository.pullRequests[0].number, 301);
  assert.equal(held.repository.pullRequests[0].comments.length, 1);
  assert.equal(held.repository.pullRequests[0].comments[0].createdAt, '2000-04-05T06:07:08Z');
  assert.equal(held.repository.pullRequests[0].comments[0].body, 'Host supplied input.\n',
    'supplied callback bytes override actual empty fd0');
});

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** The scripts the manifest's `files` ships (card #1342, Table P rows P4 to P6); no other script is package code. */
const SHIPPED_SCRIPTS = ['scripts/doc-reference-check.mjs', 'scripts/gate-check.mjs', 'scripts/record-commit.mjs', 'scripts/lib/pack-result.mjs'];

/** Exact package code scopes; npm remains the authority on what the archive carries. */
function packageCode(root) {
  const files = {};
  const walk = (relative) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const named = `${relative}/${entry.name}`;
      if (named === 'src/package-commit.json' || (named.startsWith('scripts/') && entry.isFile() && !SHIPPED_SCRIPTS.includes(named))) continue;
      if (entry.isDirectory()) walk(named);
      else {
        assert.equal(entry.isFile(), true, `package input ${named} is a regular file`);
        const bytes = readFileSync(join(root, named));
        files[named] = { bytes: bytes.length, sha256: digest(bytes) };
      }
    }
  };
  for (const directory of ['src', 'templates', 'scripts']) walk(directory);
  return files;
}

/** Stage and install only this test's current package; retention never selects its runtime. */
function installedPackage(t) {
  let directory;
  let retained = false;
  let qualification = { sourceRoot: SOURCE_ROOT, state: 'preparing' };
  const retain = () => {
    const destination = process.env.RIGGER_T7_BOUNDARY_EVIDENCE;
    if (retained || destination === undefined) return;
    retained = true;
    assert.equal(isAbsolute(destination), true, 'boundary evidence destination is absolute');
    assert.equal(resolve(destination).startsWith(`${realpathSync(SOURCE_ROOT)}${sep}`), false);
    assert.equal(existsSync(destination), false, 'boundary evidence never overwrites an earlier attempt');
    mkdirSync(destination);
    writeFileSync(join(destination, 'qualification.json'), JSON.stringify(qualification, null, 2) + '\n', { flag: 'wx' });
    const packs = join(directory, 'installed', 'packs');
    if (existsSync(packs)) {
      for (const name of readdirSync(packs).filter((name) => name.endsWith('.tgz'))) {
        copyFileSync(join(packs, name), join(destination, name), constants.COPYFILE_EXCL);
      }
    }
  };
  directory = temporaryDirectory('rigger-entry-package-', { context: t, beforeRemoval: retain });
  try {
    assert.equal(realpathSync(directory).startsWith(`${realpathSync(SOURCE_ROOT)}${sep}`), false);
    const stage = join(directory, 'package-source');
    mkdirSync(stage);
    const manifest = JSON.parse(readFileSync(join(SOURCE_ROOT, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.files, ['src/', 'templates/', ...SHIPPED_SCRIPTS]);
    assert.deepEqual(manifest.dependencies ?? {}, {}, 'the canonical offline install needs no runtime network dependency');
    const before = packageCode(SOURCE_ROOT);
    const record = join(SOURCE_ROOT, 'src', 'package-commit.json');
    const sourceRecord = existsSync(record) ? readFileSync(record) : null;
    const copiedInputs = {};
    for (const path of ['src', 'templates', 'scripts', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', '.npmrc']) {
      cpSync(join(SOURCE_ROOT, path), join(stage, path), { recursive: true });
      if (!['src', 'templates', 'scripts'].includes(path)) copiedInputs[path] = digest(readFileSync(join(SOURCE_ROOT, path)));
    }
    qualification = { sourceRoot: SOURCE_ROOT, stage, sourceCode: before, stageBeforePack: packageCode(stage), copiedInputs, state: 'staged' };
    assert.deepEqual(qualification.stageBeforePack, before);
    const installed = installFromTarball(stage, join(directory, 'installed'));
    const installedRoot = join(installed.consumer, 'node_modules', ...manifest.name.split('/'));
    const archives = readdirSync(join(directory, 'installed', 'packs')).filter((name) => name.endsWith('.tgz')).map((name) => {
      const path = join(directory, 'installed', 'packs', name);
      const bytes = readFileSync(path);
      return { path, bytes: bytes.length, sha256: digest(bytes) };
    });
    qualification = {
      ...qualification, state: 'measured-before-parity-assertions', stageAfterPack: packageCode(stage),
      sourceAfterPack: packageCode(SOURCE_ROOT), installedCode: packageCode(installedRoot), archives,
      installedRoot: realpathSync(installedRoot), bin: realpathSync(installed.rigger),
      node: { path: realpathSync(join(installed.path, 'node')), sha256: digest(readFileSync(join(installed.path, 'node'))) },
      git: { path: realpathSync(join(installed.path, 'git')), sha256: digest(readFileSync(join(installed.path, 'git'))) },
    };
    retain();
    assert.equal(archives.length, 1, 'the actual canonical pack produced one retained tarball');
    assert.deepEqual(qualification.stageAfterPack, before);
    assert.deepEqual(qualification.sourceAfterPack, before, 'prepack did not touch source code');
    assert.deepEqual(existsSync(record) ? readFileSync(record) : null, sourceRecord, 'prepack commit-record activity stayed outside source');
    assert.deepEqual(qualification.installedCode, before, 'installed code matches the exact admitted source package scopes');
    assert.equal(existsSync(join(installedRoot, 'src', 'package-commit.json')), false, 'the outside-Git stage made no false source commit claim');
    assert.equal(qualification.bin, realpathSync(join(installedRoot, manifest.bin.rigger)));
    assert.equal(qualification.installedRoot.startsWith(`${realpathSync(SOURCE_ROOT)}${sep}`), false);
    assert.equal(qualification.node.path, realpathSync(process.execPath));
    assert.deepEqual(readdirSync(installed.path).sort(), ['git', 'node']);
    const actualManifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
    for (const key of ['name', 'version', 'type', 'bin', 'engines', 'files']) assert.deepEqual(actualManifest[key], manifest[key]);
    t.diagnostic(`package-qualified ${JSON.stringify({ archives, installedRoot: qualification.installedRoot, bin: qualification.bin, sourceCodeSHA256: digest(Buffer.from(JSON.stringify(before))), parity: true })}`);
    return installed;
  } catch (error) {
    qualification = { ...qualification, setupError: error.message };
    retain();
    throw error;
  }
}

/** A real recorded child used by the five entry witnesses, with finite explicitly ended input. */
async function entryChild(t, command, argv, cwd, environment, input = '') {
  const child = spawn(command, argv, { cwd, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  const started = { pid: child.pid ?? null, command, argv, cwd, environment };
  t.diagnostic(`entry-child-start ${JSON.stringify(started)}`);
  let stdout = '';
  let stderr = '';
  let failure;
  let inputFailure;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', (error) => { failure = error; });
  child.stdin.once('error', (error) => { inputFailure = error; });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  child.stdin.end(input);
  const ended = await closed;
  const completed = { pid: child.pid ?? null, ...ended, stdinFinished: child.stdin.writableFinished, stdout, stderr };
  t.diagnostic(`entry-child-end ${JSON.stringify(completed)}`);
  assert.ifError(failure);
  assert.ifError(inputFailure);
  assert.ok(Number.isSafeInteger(started.pid) && started.pid > 0, 'the witness recorded its actual child PID at start');
  assert.equal(completed.pid, started.pid);
  assert.equal(completed.signal, null);
  assert.equal(completed.stdinFinished, true);
  return completed;
}

/** A distinct consumer whose only gh is the executable fake under a path holding node and git. */
function installedPlanWorld(t, board) {
  const installed = installedPackage(t);
  const consumer = repositoryIn('rigger-entry-consumer-', { 'rigger.config.mjs': `export default ${JSON.stringify(CONSUMER)};\n` });
  assert.notEqual(realpathSync(consumer), realpathSync(installed.consumer));
  assert.equal(CONSUMER.telemetry.push, false);
  const fake = installFakeGh(temporaryDirectory('rigger-entry-gh-', { context: t }), {
    repo: 'acme/widgets', project: 3, board: { columns: COLUMNS, fields: FIELDS, ...board },
  });
  const environment = { ...gitEnvironment(), PATH: `${dirname(fake.gh)}${delimiter}${installed.path}` };
  assert.deepEqual(environment.PATH.split(delimiter), [dirname(fake.gh), installed.path]);
  assert.deepEqual(readdirSync(installed.path).sort(), ['git', 'node']);
  return { consumer, installed, environment };
}

const PLAN_SUCCESS_BYTES = "rigger plan: from board 3, the next run would pull 1 card, first pulled first, and refuses 2 cards\n  pull    #12  change\n  refuse  #11  missing acceptance\n  refuse  #13  restated title\n";

const MATRIX_SUMMARY_BYTES = "1 of 2 requirements have no test.\n";

const MATRIX_STALE_BYTES = "docs/derived/test-matrix.md is not what the tests and the register say. Run `npm run matrix` and commit the result.\n";

const MATRIX_STRAY_BYTES = "docs/derived/notes.md is under docs/derived/ and no tool writes it. Everything there is generated (D8).\n";

const MATRIX_DOCUMENT_BYTES = "ABOUTME: Which tests prove which requirement, built from the declarations the tests carry.\nGenerated by `scripts/build-test-matrix.mjs`; never hand-edited (D8).\n\n# Test matrix\n\nOne row per requirement in `docs/spec/requirements.md`, naming the tests that prove it. A test\ndeclares what it proves in a `// proves R-GROUP-#` comment on the line above it, and this file\nis built from those declarations, so what it says cannot drift from what the suite asserts.\nRegenerate it with `npm run matrix`; editing it by hand fails the build (D8).\n\n**gap** marks a requirement no test claims. `nothing yet` and `nothing could` mark one whose\n`checked by` in the register already records that nothing catches a violation, so the matrix\nreports no gap of its own; the register carries the reason.\n\n| requirement | proved by |\n|---|---|\n| R-ONE-1 | `test/first.test.mjs` the first thing holds |\n| R-ONE-2 | **gap** |\n";

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-entry.test.mjs :: plan prints a card with no acceptance with missing acceptance as the reason, and does not pull it.
test('installed plan serializes admitted and refused cards to stdout', async (t) => {
  const world = installedPlanWorld(t, { items: [
    card(11, 'Ready', { body: 'Why this matters, and nothing more.' }), card(12, 'Ready'),
    card(13, 'Ready', { title: 'Paint the widget', body: '## Acceptance\n\n- Paint the widget.\n' }),
  ] });
  const result = await entryChild(t, world.installed.rigger, ['plan'], world.consumer, world.environment);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, PLAN_SUCCESS_BYTES);
  assert.equal(result.stderr, '');
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-entry.test.mjs :: plan under an unreadable admission shows no pull line, names each path and cause, and exits non-zero.
test('installed plan serializes unreadable admission to stderr', async (t) => {
  const world = installedPlanWorld(t, { items: [card(31, 'Ready')] });
  const state = join(world.consumer, '.rigger');
  seed(state, 'stray.json', closerText());
  const path = join(realpathSync(world.consumer), '.rigger', 'admission', 'stray.json');
  assert.equal(readFileSync(join(admissionOf(state), 'stray.json'), 'utf8'), closerText());
  const result = await entryChild(t, world.installed.rigger, ['plan'], world.consumer, world.environment);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `rigger plan: from board 3, nothing would be pulled\nrigger plan: admission cannot be read: ${path} (no closer form)\n`);
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-entry.test.mjs :: a written matrix regenerates byte for byte, and the check admits it.
test('matrix entry writes literal generated bytes and summary', async (t) => {
  const root = matrixRepository();
  const matrix = join(root, 'docs', 'derived', 'test-matrix.md');
  assert.equal(existsSync(matrix), false, 'the native write starts before a matrix exists');
  const result = await entryChild(t, process.execPath, [join(SOURCE_ROOT, 'scripts', 'build-test-matrix.mjs'), '--write', root], SOURCE_ROOT, gitEnvironment());
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, MATRIX_SUMMARY_BYTES);
  assert.equal(result.stderr, '');
  assert.equal(readFileSync(matrix, 'utf8'), MATRIX_DOCUMENT_BYTES);
  const checked = await entryChild(t, process.execPath, [join(SOURCE_ROOT, 'scripts', 'build-test-matrix.mjs'), root], SOURCE_ROOT, gitEnvironment());
  assert.equal(checked.code, 0, checked.stderr);
  assert.equal(checked.stdout, MATRIX_SUMMARY_BYTES);
  assert.equal(checked.stderr, '');
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-entry.test.mjs :: a matrix edited by hand fails the check, naming the file.
test('matrix entry reports a hand-edited matrix on stderr', async (t) => {
  const root = matrixRepository();
  const matrix = join(root, 'docs', 'derived', 'test-matrix.md');
  mkdirSync(dirname(matrix), { recursive: true });
  writeFileSync(matrix, MATRIX_DOCUMENT_BYTES + '| R-ONE-2 | by hand |\n');
  assert.equal(readFileSync(matrix, 'utf8'), MATRIX_DOCUMENT_BYTES + '| R-ONE-2 | by hand |\n');
  const result = await entryChild(t, process.execPath, [join(SOURCE_ROOT, 'scripts', 'build-test-matrix.mjs'), root], SOURCE_ROOT, gitEnvironment());
  assert.equal(result.code, 1);
  assert.equal(result.stdout, MATRIX_SUMMARY_BYTES);
  assert.equal(result.stderr, MATRIX_STALE_BYTES);
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-entry.test.mjs :: a file under docs/derived that no tool writes fails the check, naming it.
test('matrix entry reports an unowned derived file on stderr', async (t) => {
  const root = matrixRepository();
  const matrix = join(root, 'docs', 'derived', 'test-matrix.md');
  const stray = join(root, 'docs', 'derived', 'notes.md');
  mkdirSync(dirname(matrix), { recursive: true });
  writeFileSync(matrix, MATRIX_DOCUMENT_BYTES);
  writeFileSync(stray, 'typed by hand\n');
  assert.equal(readFileSync(matrix, 'utf8'), MATRIX_DOCUMENT_BYTES);
  assert.equal(readFileSync(stray, 'utf8'), 'typed by hand\n');
  const result = await entryChild(t, process.execPath, [join(SOURCE_ROOT, 'scripts', 'build-test-matrix.mjs'), root], SOURCE_ROOT, gitEnvironment());
  assert.equal(result.code, 1);
  assert.equal(result.stdout, MATRIX_SUMMARY_BYTES);
  assert.equal(result.stderr, MATRIX_STRAY_BYTES);
  assert.equal(readFileSync(stray, 'utf8'), 'typed by hand\n');
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-fixtures.test.mjs :: the shared stand-in reply preserves no-act, literal print and configured exit.
test('the native stand-in preserves no-act, literal print and configured exit', async (t) => {
  const cases = [
    { plan: {}, stdout: '', code: 0 },
    { plan: { 31: { engineer: { print: 'Literal agent output.\n' } } }, stdout: 'Literal agent output.\n', code: 0 },
    { plan: { 31: { engineer: { print: 'Literal before seven.\n', exit: 7 } } }, stdout: 'Literal before seven.\n', code: 7 },
  ];
  for (const given of cases) {
    const directory = temporaryDirectory('rigger-agent-oracle-', { context: t });
    const cwd = temporaryDirectory('rigger-agent-oracle-cwd-', { context: t });
    const agent = installStandInAgent(directory, given.plan);
    const args = ['--append-system-prompt-file', '/fixture/.claude/agents/engineer.md', 'two words', ''];
    const input = 'Rigger sends CaRd #31, then card #999.\n';
    const environment = { HOME: cwd, LANG: 'C.UTF-8', PATH: process.env.PATH, RIGGER_STAND_IN_VALUE: 'literal', UNRELATED: 'not recorded' };
    const result = await entryChild(t, join(agent.dir, 'claude'), args, cwd, environment, input);
    assert.equal(result.code, given.code);
    assert.equal(result.stdout, given.stdout);
    assert.equal(result.stderr, '');
    assert.deepEqual(agent.runs(), [{ name: 'claude', args, cwd, card: 31, role: 'engineer', input, env: { RIGGER_STAND_IN_VALUE: 'literal' }, pid: result.pid }]);
    assert.deepEqual(readdirSync(agent.dir).sort(), ['claude', 'plan.json', 'runs.jsonl']);
    assert.deepEqual(readdirSync(cwd), [], 'these configured replies create no marker/worktree or PR action');
  }
});

const WORLD = FORGE_MANIFEST.world;
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const answerOf = ({ status, stdout, stderr }) => ({ status, stdout, stderr });

/** The executable's answer. Git's own stderr is the transport's, so one named case sheds it. */
function executableAnswer(run, given) {
  if (!given.gitStderr) return { status: run.code, stdout: run.stdout, stderr: run.stderr };
  const owned = run.stderr.replace(/^(fatal: not a git repository|Stopping at filesystem boundary).*\n/gm, '');
  assert.notEqual(owned, run.stderr, `${given.id} passes git's own stderr through`);
  return { status: run.code, stdout: run.stdout, stderr: owned };
}

/** Held state with each wall-clock value checked and replaced by the case's supplied literal. */
function withSuppliedTime(held, given) {
  for (const path of given.wallClock ?? []) {
    const parent = path.slice(0, -1).reduce((value, step) => value[step], held);
    assert.match(parent[path.at(-1)], WALL_CLOCK, `${given.id} keeps the executable's wall clock`);
    parent[path.at(-1)] = given.context.now;
  }
  return held;
}

async function executableWorldCases(t, group) {
  const directory = temporaryDirectory('rigger-exec-forge-', { context: t });
  const fake = installFakeGh(directory, { repo: WORLD.repo, owner: WORLD.owner, project: WORLD.project, board: WORLD.model });
  const statePath = join(directory, 'board.json');
  const cases = FORGE_MANIFEST.cases.filter(({ id }) => id.startsWith(group));
  assert.ok(cases.length > 0, `${group} holds cases`);
  for (const given of cases) {
    writeFileSync(statePath, JSON.stringify(WORLD));
    const cwd = temporaryDirectory('rigger-exec-forge-cwd-', { context: t });
    const run = await entryChild(t, fake.gh, given.args, cwd, gitEnvironment(), given.context?.input ?? '');
    assert.deepEqual(executableAnswer(run, given), answerOf(given), `${given.id} answer`);
    assertForgeState(withSuppliedTime(JSON.parse(readFileSync(statePath, 'utf8')), given), given, WORLD);
  }
}

// Host reason: wiring; the fixture's executable wiring depends on no Rigger decision.
test('the executable fake answers every adapter case with its independent literal', (t) => executableWorldCases(t, 'F1-'));

// Host reason: wiring; the fixture's executable wiring depends on no Rigger decision.
test('the executable fake answers every agent case with its independent literal', (t) => executableWorldCases(t, 'F2-'));

// Host reason: wiring; the fixture's executable wiring depends on no Rigger decision.
test('the executable fake preserves every modeled refusal with its independent literal', (t) => executableWorldCases(t, 'F3-'));

// Host reason: wiring; the fixture's executable wiring depends on no Rigger decision.
test('the executable fake answers every origin case with its independent literal', async (t) => {
  for (const raw of FORGE_MANIFEST.originCases) {
    const directory = temporaryDirectory('rigger-exec-origin-', { context: t });
    const { repository, facts } = originFixture(directory);
    const given = withFacts(raw, facts);
    const home = join(directory, 'fake');
    mkdirSync(home);
    const fake = installFakeGh(home, { repo: WORLD.repo, owner: WORLD.owner, project: WORLD.project, origin: facts.$ORIGIN });
    const statePath = join(home, 'board.json');
    writeFileSync(statePath, JSON.stringify(withFacts(FORGE_MANIFEST.originWorld, facts)));
    if (given.priorCase) await entryChild(t, fake.gh, FORGE_MANIFEST.originCases.find(({ id }) => id === given.priorCase).args, repository, gitEnvironment());
    const before = JSON.parse(readFileSync(statePath, 'utf8'));
    const run = await entryChild(t, fake.gh, given.args, repository, gitEnvironment(), given.input ?? '');
    assert.deepEqual({ status: run.code, stdout: run.stdout, stderr: run.stderr }, answerOf(given), `${given.id} answer`);
    assertOriginState(JSON.parse(readFileSync(statePath, 'utf8')), before, given);
  }
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-fixtures.test.mjs :: a failed mutation on one forge store keeps its record and invents no effect.
test('the executable fake keeps a failed mutation out of its next read', async (t) => {
  const given = FORGE_MANIFEST.sequences.find(({ id }) => id === 'F4-Q10');
  const directory = temporaryDirectory('rigger-exec-sequence-', { context: t });
  const fake = installFakeGh(directory, { repo: WORLD.repo, owner: WORLD.owner, project: WORLD.project, board: WORLD.model });
  const statePath = join(directory, 'board.json');
  writeFileSync(statePath, JSON.stringify(WORLD));
  for (const step of given.steps) {
    const run = await entryChild(t, fake.gh, step.args, directory, gitEnvironment());
    assert.deepEqual({ status: run.code, stdout: run.stdout, stderr: run.stderr }, answerOf(step));
  }
  const held = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(held, { ...WORLD, sent: given.steps.map(({ args }) => args) }, 'the failed mutation left only its record');
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-fixtures.test.mjs :: an in-process fixed command keeps defaults and normalizes a noninteger status.
test('the executable stubs keep their fixed answers and joined-space calls', async (t) => {
  const answers = [
    [undefined, { code: 0, stdout: '', stderr: '' }],
    [{ status: 7, stdout: 'configured stdout\n', stderr: 'configured stderr\n' }, { code: 7, stdout: 'configured stdout\n', stderr: 'configured stderr\n' }],
    [{ status: 7.5, stdout: 'fractional stdout\n', stderr: '' }, { code: 1, stdout: 'fractional stdout\n', stderr: '' }],
  ];
  for (const [make, name] of [[stubGh, 'gh'], [stubClaude, 'claude'], [stubCodex, 'codex']]) {
    for (const [answer, expected] of answers) {
      const stub = make(answer);
      for (const argv of [['two words', '', 'tail'], ['two', 'words', '', 'tail']]) {
        const run = await entryChild(t, join(stub.dir, name), argv, stub.dir, gitEnvironment());
        assert.deepEqual({ code: run.code, stdout: run.stdout, stderr: run.stderr }, expected, `${name} answer`);
      }
      assert.deepEqual(stub.calls(), ['two words  tail', 'two words  tail'], 'the joined record cannot tell two different argument lists apart');
    }
  }
});

function nativeActionWorld(t, plan, seed) {
  const directory = temporaryDirectory('rigger-native-actions-', { context: t });
  const { repository, facts } = originFixture(directory);
  const fakeHome = join(directory, 'fake');
  const agentHome = join(directory, 'agent');
  mkdirSync(fakeHome);
  mkdirSync(agentHome);
  const fake = installFakeGh(fakeHome, { repo: 'example/widgets', owner: 'example', project: 23, origin: facts.$ORIGIN });
  if (seed) seedRepository(fake, seed(facts));
  const agent = installStandInAgent(agentHome, plan);
  const environment = { ...gitEnvironment(), PATH: `${dirname(fake.gh)}${delimiter}${process.env.PATH}` };
  return {
    repository, facts,
    state: () => JSON.parse(readFileSync(join(fakeHome, 'board.json'), 'utf8')),
    head: () => gitIn(repository, 'rev-parse', 'HEAD').trim(),
    originHead: () => gitIn(facts.$ORIGIN, 'rev-parse', 'refs/heads/request-topic').trim(),
    run: (cwd, role, input) => entryChild(t, join(agent.dir, 'claude'), ['--append-system-prompt-file', `/fixture/.claude/agents/${role}.md`], cwd, environment, input),
  };
}
const openPull = (facts) => ({ pullRequests: [{ number: 301, head: 'request-topic', sha: facts.$HEAD, comments: [] }] });

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-fixtures.test.mjs :: a controlled pr commits, pushes and opens one pull request.
test('the native stand-in commits, pushes and opens one pull request from its worktree', async (t) => {
  const world = nativeActionWorld(t, { 31: { engineer: { pr: true } } });
  const result = await world.run(world.repository, 'engineer', 'Work on card #31.\n');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(gitIn(world.repository, 'rev-parse', 'HEAD~1').trim(), world.facts.$HEAD);
  assert.equal(world.originHead(), world.head());
  const pulls = world.state().repository.pullRequests;
  assert.deepEqual(pulls.map(({ number, head, sha, base, title, body }) => ({ number, head, sha, base, title, body })),
    [{ number: 1, head: 'request-topic', sha: world.head(), base: 'main', title: 'Card #31', body: "The stand-in's pull request for card #31." }]);
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-fixtures.test.mjs :: a controlled push moves the head and keeps its one open pull request.
test('the native stand-in pushes a later head onto its existing pull request', async (t) => {
  const world = nativeActionWorld(t, { 31: { engineer: { push: true } } }, openPull);
  const result = await world.run(world.repository, 'engineer', 'Work on card #31.\n');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(gitIn(world.repository, 'rev-parse', 'HEAD~1').trim(), world.facts.$HEAD);
  assert.equal(world.originHead(), world.head());
  assert.deepEqual(world.state().sent, [], 'push asks the forge for nothing');
  assert.equal(world.state().repository.pullRequests.length, 1);
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-fixtures.test.mjs :: a controlled pr or push outside a worktree fabricates nothing.
test('the native stand-in fabricates nothing outside a worktree', async (t) => {
  const world = nativeActionWorld(t, { 31: { engineer: { pr: true, push: true } } });
  const plain = temporaryDirectory('rigger-native-plain-', { context: t });
  const result = await world.run(plain, 'engineer', 'Work on card #31.\n');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(world.originHead(), world.facts.$HEAD, 'origin is unmoved');
  assert.deepEqual(world.state().sent, [], 'no pull request was asked for');
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-fixtures.test.mjs :: controlled findings append one parsed marker comment.
test('the native stand-in appends its findings marker', async (t) => {
  const world = nativeActionWorld(t, { 31: { reviewer: { findings: true } } }, openPull);
  const result = await world.run(world.repository, 'reviewer', judgeInput(world.facts.$HEAD));
  assert.equal(result.code, 0, result.stderr);
  const comments = world.state().repository.pullRequests[0].comments;
  assert.equal(comments.length, 1);
  assert.deepEqual(parseMarker(comments[0].body, 2), parsedFindings(world.facts.$HEAD));
  assert.match(comments[0].createdAt, WALL_CLOCK, 'the executable keeps its wall clock');
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-fixtures.test.mjs :: controlled findings with no marker block fail and append nothing.
test('the native stand-in refuses findings with no marker block', async (t) => {
  const world = nativeActionWorld(t, { 31: { reviewer: { findings: true } } }, openPull);
  const result = await world.run(world.repository, 'reviewer', 'Judge card #31 with no block.\n');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /the stand-in for card #31 in reviewer was handed no marker block to fill in/);
  assert.deepEqual(world.state().repository.pullRequests[0].comments, []);
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-fixtures.test.mjs :: a controlled pr fails when the forge refuses it.
test('the native stand-in fails when the forge refuses its pull request', async (t) => {
  const world = nativeActionWorld(t, { 31: { engineer: { pr: true } } });
  assert.equal((await world.run(world.repository, 'engineer', 'Work on card #31.\n')).code, 0);
  const result = await world.run(world.repository, 'engineer', 'Work on card #31.\n');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /already exists/);
  assert.equal(world.state().repository.pullRequests.length, 1);
});

// Host reason: wiring.
// Ordinary decision counterpart: test/in-process-fixtures.test.mjs :: a logical codex answers its configured probe text and status.
test('the native codex stand-in answers its probe and records its session', async (t) => {
  const stand = standInCodex({ answer: 'Literal probe.\n', exit: 3 });
  const cwd = temporaryDirectory('rigger-native-codex-', { context: t });
  const environment = { HOME: cwd, LANG: 'C.UTF-8', PATH: process.env.PATH, CODEX_HOME: '/fixture/home' };
  const codex = join(stand.dir, 'codex');
  const probe = await entryChild(t, codex, ['debug', 'prompt-input'], cwd, environment);
  assert.deepEqual([probe.code, probe.stdout, probe.stderr], [3, 'Literal probe.\n', '']);
  assert.deepEqual(stand.probes(), [{ name: 'codex', probe: true, args: ['debug', 'prompt-input'], cwd, home: '/fixture/home', pid: probe.pid }]);
  const session = await entryChild(t, codex, ['exec', '-'], cwd, environment, 'Session input.\n');
  assert.deepEqual([session.code, session.stdout, session.stderr], [0, '', '']);
  assert.deepEqual(stand.sessions(), [{ name: 'codex', args: ['exec', '-'], cwd, input: 'Session input.\n', home: '/fixture/home', pid: session.pid }]);
});

const { 20_000: SETTLES_WITHIN } = BOUNDS;
const NONENTRY_MS = 1000;
const HOLD = ['pr', 'comment', '301', '--body-file', '-'];
const CONTEND = ['pr', 'comment', '301', '--body', 'Contender note.'];
const OBSERVE = ['pr', 'view', '301', '--json', 'comments'];

/** A child with its streams kept and its ending as a promise, ended by the test's teardown if still running. */
function ownedChild(t, world, child) {
  world.children.push(child);
  t.diagnostic(`lock-child-start ${child.pid}`);
  const held = { child, stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { held.stdout += chunk; });
  child.stderr.on('data', (chunk) => { held.stderr += chunk; });
  held.closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  return held;
}

/** A real fake gh over one seeded pull request, and the children a lock witness owns. */
function lockWorld(t) {
  const directory = temporaryDirectory('rigger-lock-', { context: t });
  const fake = installFakeGh(directory, { repo: 'example/widgets', owner: 'example', project: 23 });
  seedRepository(fake, { pullRequests: [{ number: 301, head: 'topic', sha: 'a'.repeat(40), comments: [] }] });
  const world = { directory, fake, statePath: join(directory, 'board.json'), lock: join(directory, 'board.json.lock'), children: [] };
  t.after(async () => {
    for (const child of world.children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill('SIGKILL');
      await closed;
    }
  });
  return world;
}

/** The real executable, observed holding the lock: fd0 stays open, and its request is recorded. */
async function holdingWriter(t, world) {
  const holder = ownedChild(t, world, spawn(world.fake.gh, HOLD, { cwd: world.directory, env: gitEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] }));
  await until(() => readFileSync(world.statePath, 'utf8').includes('"--body-file"'), t);
  assert.equal(existsSync(world.lock), true, 'the acknowledged holder has the lock file');
  return holder;
}

/** A plain Node child of the exported `main`, observed loaded and begun; `main` then spins with no event loop. */
async function begunContender(t, world, name, args) {
  const script = join(world.directory, `${name}.mjs`);
  writeFileSync(script, [
    "import { writeSync } from 'node:fs';",
    `import { main } from ${JSON.stringify(new URL('./fake-gh.mjs', import.meta.url).href)};`,
    "writeSync(1, 'begun\\n');",
    `await main(${JSON.stringify(world.statePath)});`,
    '',
  ].join('\n'));
  const contender = ownedChild(t, world, spawn(process.execPath, [script, ...args], { cwd: world.directory, env: gitEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] }));
  await until(() => contender.stdout.startsWith('begun\n'), t);
  return contender;
}

// Host reason: real deadline; the test arms the bound it watches two contenders across.
// Ordinary decision counterpart: no product decision; this characterizes the fixture wrapper's lock, which holds no Rigger decision.
test('a real writer holding the lock keeps other callers out until it releases', SETTLES_WITHIN, async (t) => {
  const world = lockWorld(t);
  const holder = await holdingWriter(t, world);
  const writer = await begunContender(t, world, 'writer', CONTEND);
  const reader = await begunContender(t, world, 'reader', OBSERVE);
  await observed(NONENTRY_MS);
  const during = readFileSync(world.statePath, 'utf8');
  assert.deepEqual(JSON.parse(during).sent, [HOLD], 'neither contender recorded a request across the bound');
  assert.equal(during.includes('Contender note.'), false, 'the writer committed nothing across the bound');
  assert.deepEqual([alive(writer.child.pid), alive(reader.child.pid)], [true, true], 'both contenders are still waiting');
  holder.child.stdin.end('Holder note.\n');
  const [held, wrote, read] = await Promise.all([holder.closed, writer.closed, reader.closed]);
  assert.deepEqual([held, wrote, read], [{ code: 0, signal: null }, { code: 0, signal: null }, { code: 0, signal: null }], `${holder.stderr}${writer.stderr}${reader.stderr}`);
  const state = JSON.parse(readFileSync(world.statePath, 'utf8'));
  assert.equal(state.sent.length, 3, 'all three requests survive');
  assert.deepEqual(state.sent[0], HOLD, 'the holder is first in lock order');
  assert.deepEqual([...state.sent.slice(1)].sort(), [CONTEND, OBSERVE].sort(), 'each contender entered once');
  assert.deepEqual(state.repository.pullRequests[0].comments.map(({ body }) => body), ['Holder note.\n', 'Contender note.'], 'both effects survive in lock order');
  assert.equal(holder.stdout, 'https://github.com/example/widgets/pull/301#issuecomment-1\n');
  assert.equal(writer.stdout, 'begun\nhttps://github.com/example/widgets/pull/301#issuecomment-2\n');
  const writerFirst = state.sent[1][1] === 'comment';
  const seen = JSON.parse(reader.stdout.slice('begun\n'.length)).comments.map(({ body }) => body);
  assert.deepEqual(seen, writerFirst ? ['Holder note.\n', 'Contender note.'] : ['Holder note.\n'], 'the reader sees a complete state for its place in lock order');
  assert.equal(existsSync(world.lock), false, 'the last holder released the lock');
});

// Host reason: real deadline; the test arms the bound it watches the restarted writer across.
// Ordinary decision counterpart: no product decision; this characterizes the fixture wrapper's stale lock, which holds no Rigger decision.
test('a restarted writer cannot enter while a killed writer leaves its lock', SETTLES_WITHIN, async (t) => {
  const world = lockWorld(t);
  const holder = await holdingWriter(t, world);
  holder.child.kill('SIGKILL');
  assert.deepEqual(await holder.closed, { code: null, signal: 'SIGKILL' }, 'the owned writer was killed after observed acquisition');
  assert.equal(existsSync(world.lock), true, 'the killed writer left its lock');
  const restarted = await begunContender(t, world, 'restarted', CONTEND);
  await observed(NONENTRY_MS);
  assert.equal(readFileSync(world.statePath, 'utf8').includes('Contender note.'), false, 'the restarted writer entered no transaction across the bound');
  assert.equal(alive(restarted.child.pid), true, 'the restarted writer is still waiting');
  assert.equal(existsSync(world.lock), true, 'nothing recovered or removed the lock');
  restarted.child.kill('SIGKILL');
  assert.deepEqual(await restarted.closed, { code: null, signal: 'SIGKILL' }, 'only the owned recorded writer was ended');
});
