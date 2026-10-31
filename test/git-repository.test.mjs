// ABOUTME: Tests of the git fixture's repositories: that none of them, cloned ones included, has a
// git call in it start git's automatic maintenance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { clonedFromOrigin, repositoryAt, detachedWorktreeAt, gitIn, worktreeList, removeWorktreeAt, lockWorktreeAt, unlockWorktreeAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/**
 * The environment a traced git call runs under: git traces every git process it starts, the
 * receiving side of a push to a local path included, and reads a global configuration of the
 * test's own at `global`, with an identity of its own for a commit.
 */
const tracing = (global) => ({
  ...gitEnvironment(), GIT_TRACE: '1', GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
});

/** Runs git with `args` in the repository at `root` under `env`, and hands back how it ended. */
const gitUnder = (env, root, ...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env });

/** What a call `gitUnder` made traced, once it is shown to have exited 0 and traced at all. */
function traceOf(call) {
  assert.equal(call.status, 0, call.stderr);
  assert.match(call.stderr, /trace: built-in: git /, `git traced nothing, so this proves nothing: ${call.stderr}`);
  return call.stderr;
}

// A fetch, a commit and a push each check for git's automatic maintenance where it is on, and by
// default it detaches into a session of its own, naming no scratch directory in its command line,
// so no teardown that finds a test's processes by their group or their command line ends it. The
// test's own global configuration turns detaching off, so that where the fixture leaves
// maintenance on, the maintenance this would trace runs to its end inside the call.
test('no git call in a repository the fixture makes or clones starts git maintenance', (t) => {
  const directory = realpathSync(temporaryDirectory('rigger-unmaintained-', { context: t }));
  const global = join(directory, 'global.gitconfig');
  writeFileSync(global, '[maintenance]\n\tautoDetach = false\n[gc]\n\tautoDetach = false\n');
  const { source, origin, repository } = clonedFromOrigin(directory);
  const env = tracing(global);

  const calls = [
    gitUnder(env, source, 'commit', '-q', '--allow-empty', '-m', 'two'),
    // The receiving side of this push runs in `origin`, the fixture's bare clone.
    gitUnder(env, source, 'push', '-q', origin, 'HEAD:refs/heads/main'),
    gitUnder(env, repository, 'fetch', 'origin'),
    gitUnder(env, repository, 'commit', '-q', '--allow-empty', '-m', 'three'),
  ].map(traceOf);

  assert.match(calls[1], /trace: built-in: git receive-pack|git-receive-pack/, `the push traced no receiving side: ${calls[1]}`);
  for (const trace of calls) assert.doesNotMatch(trace, /maintenance run|\bgc --auto/, trace);
});

test('a dirty fixture worktree requires explicit forced removal', (t) => {
  const directory = realpathSync(temporaryDirectory('1141-force-removal-', { context: t }));
  const original = '1141 committed source bytes\n';
  const changed = '1141 independently observed dirty bytes\n';
  const repository = repositoryAt(join(directory, 'repository'), { 'tracked.txt': original });
  const head = gitIn(repository, 'rev-parse', 'HEAD').trim();
  const before = { bytes: readFileSync(join(repository, 'tracked.txt')).toString('base64'),
    status: gitIn(repository, 'status', '--porcelain'), inventory: worktreeList(repository) };
  assert.equal(before.bytes, Buffer.from(original).toString('base64'));
  assert.equal(before.status, '');
  assert.ok(before.inventory.includes(`worktree ${repository}\n`));
  const observations = [];
  for (const mode of ['omitted', 'false']) {
    const clean = realpathSync(detachedWorktreeAt(repository, join(directory, `clean-${mode}`), head));
    assert.equal(readFileSync(join(clean, 'tracked.txt'), 'utf8'), original);
    assert.equal(gitIn(clean, 'status', '--porcelain'), '');
    const returned = mode === 'omitted' ? removeWorktreeAt(repository, clean) : removeWorktreeAt(repository, clean, false);
    assert.equal(returned, undefined, `${mode}: ordinary successful removal retains its return contract`);
    assert.equal(existsSync(clean), false);
    assert.equal(worktreeList(repository), before.inventory);
    observations.push({ mode, kind: 'clean-success', path: clean, returnedType: typeof returned });
  }
  const tree = realpathSync(detachedWorktreeAt(repository, join(directory, 'dirty-worktree'), head));
  const source = join(tree, 'tracked.txt');
  writeFileSync(source, changed);
  const ready = { directory, repository, tree, source,
    bytes: readFileSync(source).toString('base64'), status: gitIn(tree, 'status', '--porcelain', '--', 'tracked.txt'),
    inventory: worktreeList(repository) };
  assert.equal(ready.bytes, Buffer.from(changed).toString('base64'));
  assert.equal(ready.status, ' M tracked.txt\n');
  assert.ok(ready.inventory.includes(`worktree ${tree}\n`));
  t.diagnostic(`independent dirty force-removal premise: ${JSON.stringify({ ready, before, observations })}`);
  for (const mode of ['omitted', 'false']) {
    let failure;
    try {
      if (mode === 'omitted') removeWorktreeAt(repository, tree); else removeWorktreeAt(repository, tree, false);
    } catch (error) { failure = error; }
    const state = { present: existsSync(tree), inventory: worktreeList(repository) };
    if (state.present) {
      state.bytes = readFileSync(source).toString('base64');
      state.status = gitIn(tree, 'status', '--porcelain', '--', 'tracked.txt');
    }
    observations.push({ mode, kind: 'dirty-attempt', refusal: failure ? { name: failure.name, message: failure.message } : null, state });
    t.diagnostic(`independent default-removal result: ${JSON.stringify({ directory, repository, tree, observations })}`);
    assert.ok(failure instanceof Error, `${mode}: a dirty owned worktree must remain refused without explicit force`);
    assert.ok(failure.message.includes('worktree remove') && failure.message.includes(tree));
    assert.equal(existsSync(tree), true);
    assert.equal(readFileSync(source, 'utf8'), changed);
    assert.equal(gitIn(tree, 'status', '--porcelain', '--', 'tracked.txt'), ' M tracked.txt\n');
    assert.equal(worktreeList(repository), ready.inventory);
    assert.equal(readFileSync(join(repository, 'tracked.txt'), 'utf8'), original);
    assert.equal(gitIn(repository, 'status', '--porcelain'), before.status);
  }
  t.diagnostic(`independent forced-removal premise and default controls: ${JSON.stringify({ ready, before, observations })}`);
  let returned;
  let failure;
  try { returned = removeWorktreeAt(repository, tree, true); } catch (error) { failure = error; }
  const forced = { present: existsSync(tree), inventory: worktreeList(repository),
    refusal: failure ? { name: failure.name, message: failure.message } : null };
  if (forced.present) {
    forced.bytes = readFileSync(source).toString('base64');
    forced.status = gitIn(tree, 'status', '--porcelain', '--', 'tracked.txt');
  }
  t.diagnostic(`independent explicit-force result before assertion: ${JSON.stringify({ directory, repository, tree, forced })}`);
  assert.equal(failure, undefined, 'explicit force must remove the independently observed dirty owned worktree');
  assert.equal(returned, undefined, 'explicit removal retains the helper success return contract');
  assert.equal(existsSync(tree), false, 'Git must remove the actual owned directory');
  const after = { bytes: readFileSync(join(repository, 'tracked.txt')).toString('base64'),
    status: gitIn(repository, 'status', '--porcelain'), inventory: worktreeList(repository) };
  assert.deepEqual(after, before, 'removal discards only the selected dirty worktree, preserving caller bytes/status/inventory');
  t.diagnostic(`independent forced-removal result: ${JSON.stringify({ directory, repository, tree, returnedType: typeof returned, after })}`);
});

test('fixture worktree inventory preserves the requested record separators', (t) => {
  const directory = realpathSync(temporaryDirectory('1141-nul-inventory-', { context: t }));
  const original = '1141 literal inventory source bytes\n';
  const reason = '1141 literal inventory lock reason';
  const repository = repositoryAt(join(directory, 'repository'), { 'tracked.txt': original });
  const head = gitIn(repository, 'rev-parse', 'HEAD').trim();
  const branch = gitIn(repository, 'symbolic-ref', 'HEAD').trim();
  const tree = realpathSync(detachedWorktreeAt(repository, join(directory, 'inventory-worktree'), head));
  lockWorktreeAt(repository, tree, reason);
  const expectedRecords = [
    [`worktree ${repository}`, `HEAD ${head}`, `branch ${branch}`],
    [`worktree ${tree}`, `HEAD ${head}`, 'detached', `locked ${reason}`],
  ];
  const before = { callerBytes: readFileSync(join(repository, 'tracked.txt')).toString('base64'),
    callerStatus: gitIn(repository, 'status', '--porcelain'), treeBytes: readFileSync(join(tree, 'tracked.txt')).toString('base64'),
    treeStatus: gitIn(tree, 'status', '--porcelain') };
  assert.equal(repository, realpathSync(repository));
  assert.equal(tree, realpathSync(tree));
  assert.equal(before.callerBytes, Buffer.from(original).toString('base64'));
  assert.equal(before.treeBytes, before.callerBytes);
  assert.equal(before.callerStatus, ''); assert.equal(before.treeStatus, '');
  const ordinary = worktreeList(repository);
  const explicitFalse = worktreeList(repository, false);
  assert.equal(typeof ordinary, 'string');
  assert.equal(ordinary.includes('\0'), false, 'omitted mode retains native ordinary porcelain');
  assert.equal(ordinary.endsWith('\n\n'), true);
  assert.deepEqual(ordinary.split('\n\n').filter(Boolean).map((record) => record.split('\n')), expectedRecords);
  assert.equal(explicitFalse, ordinary, 'false retains the exact ordinary return bytes');
  const refusals = [];
  for (const mode of ['omitted', 'false']) {
    let failure;
    try { if (mode === 'omitted') worktreeList(directory); else worktreeList(directory, false); }
    catch (error) { failure = error; }
    assert.ok(failure instanceof Error, `${mode}: listing outside a repository retains its refusal`);
    assert.ok(failure.message.includes('worktree list --porcelain') && failure.message.includes(directory));
    refusals.push({ mode, name: failure.name, message: failure.message });
  }
  t.diagnostic(`independent inventory setup and ordinary controls: ${JSON.stringify({ directory, repository, tree, reason, expectedRecords, before, ordinaryBase64: Buffer.from(ordinary).toString('base64'), falseBase64: Buffer.from(explicitFalse).toString('base64'), refusals })}`);
  const nul = worktreeList(repository, true);
  const raw = Buffer.from(nul, 'utf8');
  const evidence = process.env.RIGGER_1141_EVIDENCE_ROOT;
  if (evidence) {
    const binary = join(evidence, 'requested-nul-inventory.bin');
    const encoded = join(evidence, 'requested-nul-inventory.base64');
    writeFileSync(binary, raw);
    writeFileSync(encoded, raw.toString('base64'));
    assert.deepEqual(readFileSync(binary), raw, 'retained binary must be the exact native returned bytes');
    assert.deepEqual(Buffer.from(readFileSync(encoded, 'utf8'), 'base64'), raw);
  }
  t.diagnostic(`native requested-NUL return before assertion: ${JSON.stringify({ directory, repository, tree, rawBase64: raw.toString('base64'), byteLength: raw.length, containsNul: nul.includes('\0') })}`);
  assert.equal(nul.includes('\0'), true, 'explicit NUL mode must return actual native NUL separators');
  assert.equal(nul.includes('\n'), false, 'these literal paths/reason contain no newline field data');
  assert.equal(nul.endsWith('\0\0'), true, 'native porcelain NUL records end with the empty field');
  assert.deepEqual(nul.split('\0\0').filter(Boolean).map((record) => record.split('\0')), expectedRecords);
  assert.deepEqual({ callerBytes: readFileSync(join(repository, 'tracked.txt')).toString('base64'),
    callerStatus: gitIn(repository, 'status', '--porcelain'), treeBytes: readFileSync(join(tree, 'tracked.txt')).toString('base64'),
    treeStatus: gitIn(tree, 'status', '--porcelain') }, before, 'inventory reads preserve caller and worktree bytes/status');
  unlockWorktreeAt(repository, tree);
  removeWorktreeAt(repository, tree);
  assert.equal(existsSync(tree), false);
  assert.deepEqual(worktreeList(repository).split('\n\n').filter(Boolean).map((record) => record.split('\n')), [expectedRecords[0]]);
  t.diagnostic(`independent inventory result and cleanup: ${JSON.stringify({ directory, repository, tree, nativeRawBase64: raw.toString('base64'), expectedRecords, before })}`);
});
