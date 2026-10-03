// ABOUTME: Tests L1's making of a judge's directory: where it lies, the detached `main` and `head`
// worktrees it holds, the directories it replaces and the ones it leaves alone, and its events.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { WORKSPACE_NOT_MADE, makeJudgeDirectory, makeWorkspace } from '../src/execution/workspace.mjs';
import { clonedFromOrigin, detachedWorktreeAt, gitIn, worktreeAt, worktreeList } from './git-repository.mjs';
import { scratch } from './process-fixtures.mjs';
import { EVENT_REFUSED } from '../src/substrate/process.mjs';
import { ADDING } from '../src/substrate/worktrees.mjs';
import { spawnSync } from 'node:child_process';
import { roleDispatch } from '../src/execution/role.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';

/**
 * A repository whose `origin` is a local bare repository, with card 42's pull request head pushed
 * to `origin` on `rigger-42` and never fetched, a root for directories and a sink, in a scratch
 * directory torn down with every process naming it. `make` makes a judge's directory for card 42
 * at that head unless the caller names otherwise.
 */
function world(t) {
  const directory = scratch(t);
  const { source, origin, repository } = clonedFromOrigin(directory);
  gitIn(source, 'switch', '-q', '-c', 'rigger-42');
  gitIn(source, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-q', '--allow-empty', '-m', 'the maker\'s work');
  gitIn(source, 'push', '-q', origin, 'rigger-42');
  const head = gitIn(source, 'rev-parse', 'HEAD').trim();
  gitIn(source, 'switch', '-q', 'main');
  const root = join(directory, 'worktrees');
  const state = join(directory, '.rigger');
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  const events = () => (existsSync(streamPath(state)) ? readEvents(state) : []);
  const main = () => gitIn(origin, 'rev-parse', 'refs/heads/main').trim();
  const path = join(root, 'judges', 'rigger-42', 'reviewer');
  const make = (over = {}) => makeJudgeDirectory({ root, topic: 'rigger-{number}', card: 42, role: 'reviewer', head, repository, sink, ...over });
  /** Commits on `branch` in `source` and pushes it to `origin`, handing back the commit. */
  const push = (branch, message) => {
    gitIn(source, 'switch', '-q', branch);
    gitIn(source, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-q', '--allow-empty', '-m', message);
    gitIn(source, 'push', '-q', origin, branch);
    const pushed = gitIn(source, 'rev-parse', 'HEAD').trim();
    gitIn(source, 'switch', '-q', 'main');
    return pushed;
  };
  return { directory, source, origin, repository, root, state, sink, events, head, main, path, make, push };
}

test('given card 42, topic rigger-{number} and judge role reviewer, L1 makes the judge\'s directory at the real path of <root>/judges/rigger-42/reviewer', async (t) => {
  const here = world(t);
  const made = await here.make();
  assert.equal(realpathSync.native(made.path), realpathSync.native(join(here.root, 'judges', 'rigger-42', 'reviewer')));
});

/** The commit a checkout's `HEAD` is at, and whether its `HEAD` is detached. */
const headOf = (path) => gitIn(path, 'rev-parse', 'HEAD').trim();
const detached = (path) => gitIn(path, 'rev-parse', '--symbolic-full-name', 'HEAD').trim() === 'HEAD';

// proves R-LOOP-14
test('the judge\'s directory holds a worktree main with HEAD detached at the commit origin\'s main line held when L1 made it, not the repository\'s older copy', async (t) => {
  const here = world(t);
  const stale = gitIn(here.repository, 'rev-parse', 'refs/remotes/origin/main').trim();
  here.push('main', 'the main line moves on');
  assert.notEqual(here.main(), stale);
  const made = await here.make();
  assert.equal(realpathSync.native(made.main), realpathSync.native(join(made.path, 'main')));
  assert.equal(headOf(made.main), here.main());
  assert.equal(detached(made.main), true);
});

test('the judge\'s directory holds a worktree head with HEAD detached at the head commit L1 was handed', async (t) => {
  const here = world(t);
  const made = await here.make();
  assert.equal(realpathSync.native(made.head), realpathSync.native(join(made.path, 'head')));
  assert.equal(headOf(made.head), here.head);
  assert.equal(detached(made.head), true);
});

test('making a judge\'s directory creates no branch: git for-each-ref refs/heads prints the same before and after', async (t) => {
  const here = world(t);
  const before = gitIn(here.repository, 'for-each-ref', 'refs/heads');
  await here.make();
  assert.equal(gitIn(here.repository, 'for-each-ref', 'refs/heads'), before);
});

// proves R-WORK-12
test('given two judges of card 42, reviewer and engineer, their directories are siblings, and neither lies inside the other or inside card 42\'s workspace', async (t) => {
  const here = world(t);
  const reviewer = await here.make();
  const engineer = await here.make({ role: 'engineer' });
  const workspace = await makeWorkspace({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });
  const [one, other, card] = [reviewer.path, engineer.path, workspace.path].map((path) => realpathSync.native(path));
  assert.equal(dirname(one), dirname(other));
  assert.notEqual(one, other);
  for (const [inner, outer] of [[one, other], [other, one], [one, card], [other, card]]) {
    const from = relative(outer, inner);
    assert.ok(from.startsWith('..') || isAbsolute(from), `${inner} lies inside ${outer}`);
  }
});

/**
 * Asserts that `attempt` rejects as a judge's directory L1 could not make, naming `path` and each
 * of `naming`, and hands back its failure.
 */
async function refusedNaming(attempt, path, ...naming) {
  let failure;
  await attempt.then(() => assert.fail('L1 made the judge\'s directory'), (thrown) => { failure = thrown; });
  assert.equal(failure.code, WORKSPACE_NOT_MADE, failure.stack);
  for (const name of [path, ...naming]) assert.ok(failure.message.includes(name), `the failure does not name ${name}: ${failure.message}`);
  return failure;
}

test('given a head commit the repository does not hold after fetching, L1 makes no directory, and fails naming the path and the commit', async (t) => {
  const here = world(t);
  const missing = gitIn(here.source, 'commit-tree', '-m', 'never pushed', `${here.head}^{tree}`).trim();
  await refusedNaming(here.make({ head: missing }), here.path, missing);
  assert.equal(existsSync(here.root), false);
});

// proves R-WORK-20, R-WORK-21
test('given a directory at the path holding main and head as worktrees of the repository, each at a detached commit, L1 replaces it, and the new main and head are at the commits this attempt names', async (t) => {
  const here = world(t);
  const earlier = await here.make();
  writeFileSync(join(earlier.head, 'left-behind'), 'an earlier judge\'s build\n');
  const main = here.push('main', 'the main line moves on');
  const head = here.push('rigger-42', 'the maker pushes again');
  const made = await here.make({ head });
  assert.equal(realpathSync.native(made.path), realpathSync.native(earlier.path));
  assert.equal(headOf(made.main), main);
  assert.equal(headOf(made.head), head);
  assert.equal(detached(made.main) && detached(made.head), true);
  assert.equal(existsSync(join(made.head, 'left-behind')), false);
});

/**
 * Every file under `directory`, each as its path relative to it and its bytes, and every link and
 * directory.
 */
function contents(directory) {
  const found = {};
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile()) found[relative(directory, path)] = readFileSync(path).toString('base64');
    else if (entry.isSymbolicLink()) found[relative(directory, path)] = `-> ${readlinkSync(path)}`;
    else if (entry.isDirectory()) found[`${relative(directory, path)}/`] = '';
  }
  return found;
}

/**
 * What a refusal must leave unchanged in `here`'s repository: the worktrees git lists, every ref
 * and where it points, `refs/remotes/` included, and every object the repository holds.
 */
const held = (here) => ({
  worktrees: worktreeList(here.repository),
  refs: gitIn(here.repository, 'for-each-ref'),
  objects: gitIn(here.repository, 'cat-file', '--batch-all-objects', '--batch-check'),
});

/** `held`, and every file, link and directory under `under`. */
const unchanged = (here, under) => ({ ...held(here), files: contents(under) });

/**
 * Moves `origin`'s main line beyond the repository's `refs/remotes/origin/main`, so a fetch made
 * by an attempt that refuses would show in `held`.
 */
const advanced = (here) => {
  const before = gitIn(here.repository, 'rev-parse', 'refs/remotes/origin/main').trim();
  here.push('main', 'the main line moves on before a refusal');
  assert.notEqual(here.main(), before);
};

// proves R-WORK-20, R-WORK-21
test('given a file at the path that is not a worktree, L1 fails naming the path, and the file is byte-identical afterwards', async (t) => {
  const here = world(t);
  mkdirSync(dirname(here.path), { recursive: true });
  writeFileSync(here.path, 'not Rigger\'s\n');
  advanced(here);
  const before = unchanged(here, dirname(here.path));
  await refusedNaming(here.make(), here.path);
  assert.deepEqual(unchanged(here, dirname(here.path)), before);
  assert.equal(readFileSync(here.path, 'utf8'), 'not Rigger\'s\n');
});

// proves R-WORK-20, R-WORK-21
test('given a directory at the path holding a worktree of the repository on a branch, L1 fails naming the path, and that worktree\'s files and branch are unchanged afterwards', async (t) => {
  const here = world(t);
  const owner = worktreeAt(here.repository, join(here.path, 'head'), 'owner');
  writeFileSync(join(owner, 'uncommitted'), 'the owner\'s work\n');
  const branch = gitIn(here.repository, 'rev-parse', 'refs/heads/owner').trim();
  advanced(here);
  const before = unchanged(here, here.path);
  await refusedNaming(here.make(), here.path);
  assert.deepEqual(unchanged(here, here.path), before);
  assert.equal(gitIn(owner, 'symbolic-ref', '--short', 'HEAD').trim(), 'owner');
  assert.equal(gitIn(here.repository, 'rev-parse', 'refs/heads/owner').trim(), branch);
  assert.equal(readFileSync(join(owner, 'uncommitted'), 'utf8'), 'the owner\'s work\n');
});

// proves R-WORK-20, R-WORK-21
test('given a directory at the path holding, besides main and head, a plain file, L1 fails naming the path, and the file is byte-identical afterwards', async (t) => {
  const here = world(t);
  await here.make();
  writeFileSync(join(here.path, 'notes'), 'a person\'s notes\n');
  advanced(here);
  const before = unchanged(here, here.path);
  await refusedNaming(here.make(), here.path);
  assert.deepEqual(unchanged(here, here.path), before);
  assert.equal(readFileSync(join(here.path, 'notes'), 'utf8'), 'a person\'s notes\n');
});

// proves R-WORK-20, R-WORK-21
test('given a judge directory whose main was deleted without git and replaced by a plain directory holding a file, while git still lists main detached there, L1 fails naming the path, and the file is byte-identical afterwards', async (t) => {
  const here = world(t);
  const made = await here.make();
  rmSync(made.main, { recursive: true, force: true });
  mkdirSync(made.main);
  writeFileSync(join(made.main, 'kept'), 'not Rigger\'s\n');
  assert.match(worktreeList(here.repository), /\ndetached\n[\s\S]*\ndetached\n/);
  advanced(here);
  const before = unchanged(here, here.path);
  await refusedNaming(here.make(), here.path);
  assert.deepEqual(unchanged(here, here.path), before);
  assert.equal(readFileSync(join(made.main, 'kept'), 'utf8'), 'not Rigger\'s\n');
});

// proves R-WORK-20, R-WORK-22
test('given the worktree L1 was handed as the repository inside the judge directory, as its head at a detached commit beside a detached main, L1 fails naming the path, and that worktree\'s files are unchanged afterwards', async (t) => {
  const here = world(t);
  detachedWorktreeAt(here.repository, join(here.path, 'main'), here.main());
  const handed = detachedWorktreeAt(here.repository, join(here.path, 'head'), here.main());
  writeFileSync(join(handed, 'uncommitted'), 'the handed worktree\'s work\n');
  advanced(here);
  const before = unchanged(here, here.path);
  await refusedNaming(here.make({ repository: handed }), here.path);
  assert.deepEqual(unchanged(here, here.path), before);
  assert.equal(readFileSync(join(handed, 'uncommitted'), 'utf8'), 'the handed worktree\'s work\n');
});

// proves R-WORK-20, R-WORK-22
test('given the worktree L1 was handed as the repository at the judge directory\'s path, at a detached commit, L1 fails naming the path, and that worktree\'s files are unchanged afterwards', async (t) => {
  const here = world(t);
  const handed = detachedWorktreeAt(here.repository, here.path, here.main());
  writeFileSync(join(handed, 'uncommitted'), 'the handed worktree\'s work\n');
  advanced(here);
  const before = unchanged(here, here.path);
  await refusedNaming(here.make({ repository: handed }), here.path);
  assert.deepEqual(unchanged(here, here.path), before);
  assert.equal(readFileSync(join(handed, 'uncommitted'), 'utf8'), 'the handed worktree\'s work\n');
});

// proves R-WORK-20, R-WORK-23
test('given another worktree of the repository registered inside head, at a detached commit, L1 fails naming the path, and that worktree\'s files are unchanged afterwards', async (t) => {
  const here = world(t);
  const made = await here.make();
  const nested = detachedWorktreeAt(here.repository, join(made.head, 'nested'), here.main());
  writeFileSync(join(nested, 'uncommitted'), 'the nested worktree\'s work\n');
  advanced(here);
  const before = unchanged(here, here.path);
  await refusedNaming(here.make(), here.path);
  assert.deepEqual(unchanged(here, here.path), before);
  assert.equal(readFileSync(join(nested, 'uncommitted'), 'utf8'), 'the nested worktree\'s work\n');
});

// proves R-WORK-20, R-WORK-21
test('given a root spelled in another case than the directory on disk, on a volume that folds case, a second make through that root replaces the judge\'s directory at this attempt\'s commits', async (t) => {
  const here = world(t);
  mkdirSync(join(here.directory, 'Worktrees'));
  if (!existsSync(here.root)) {
    t.skip('this volume does not fold case, so no spelling in another case names the root');
    return;
  }
  await here.make();
  const head = here.push('rigger-42', 'the maker pushes again');
  const made = await here.make({ head });
  assert.equal(headOf(made.head), head);
  assert.equal(headOf(made.main), here.main());
});

// proves R-WORK-20, R-WORK-21
test('given a worktree in the judge directory that git lists under another path, after it was moved without git, L1 fails naming the path and saying git lists no worktree there, and nothing changes', async (t) => {
  const here = world(t);
  const made = await here.make();
  renameSync(made.head, join(here.path, 'moved'));
  advanced(here);
  const before = unchanged(here, here.path);
  const failure = await refusedNaming(here.make(), here.path);
  assert.match(failure.message, /git lists no worktree/);
  assert.doesNotMatch(failure.message, /undefined/);
  assert.deepEqual(unchanged(here, here.path), before);
});

// proves R-WORK-20, R-WORK-21
test('given a judge directory whose head is a detached worktree locked with Rigger\'s own reason initializing, as a make killed while adding it leaves it, L1 replaces it at this attempt\'s commits', async (t) => {
  const here = world(t);
  detachedWorktreeAt(here.repository, join(here.path, 'main'), here.main());
  detachedWorktreeAt(here.repository, join(here.path, 'head'), here.main(), '--lock', '--reason', ADDING);
  const head = here.push('rigger-42', 'the maker pushes again');
  const made = await here.make({ head });
  assert.equal(headOf(made.head), head);
  assert.equal(headOf(made.main), here.main());
  assert.doesNotMatch(worktreeList(here.repository), /locked/);
});

// proves R-WORK-20, R-WORK-21
test('given a judge directory holding main, where git still lists head locked with Rigger\'s own reason initializing though its directory is gone, L1 replaces it at this attempt\'s commits', async (t) => {
  const here = world(t);
  detachedWorktreeAt(here.repository, join(here.path, 'main'), here.main());
  detachedWorktreeAt(here.repository, join(here.path, 'head'), here.main(), '--lock', '--reason', ADDING);
  rmSync(join(here.path, 'head'), { recursive: true, force: true });
  const made = await here.make();
  assert.equal(headOf(made.head), here.head);
  assert.equal(headOf(made.main), here.main());
  assert.doesNotMatch(worktreeList(here.repository), /locked/);
});

// proves R-WORK-20, R-WORK-21
test('given a judge directory whose head is a detached worktree locked with a reason other than initializing, L1 fails naming the path, and the lock and that worktree\'s files are unchanged afterwards', async (t) => {
  const here = world(t);
  detachedWorktreeAt(here.repository, join(here.path, 'main'), here.main());
  const locked = detachedWorktreeAt(here.repository, join(here.path, 'head'), here.main(), '--lock', '--reason', 'a person is reading it');
  writeFileSync(join(locked, 'uncommitted'), 'a person\'s work\n');
  advanced(here);
  const before = unchanged(here, here.path);
  await refusedNaming(here.make(), here.path);
  assert.deepEqual(unchanged(here, here.path), before);
  assert.match(worktreeList(here.repository), /\nlocked a person is reading it\n/);
  assert.equal(readFileSync(join(locked, 'uncommitted'), 'utf8'), 'a person\'s work\n');
});

// proves R-WORK-20, R-WORK-21
test('given a judge directory holding, besides main and head, a symbolic link to a detached worktree of the repository outside it, L1 fails naming the path, and that worktree, its registration and its files are unchanged afterwards', async (t) => {
  const here = world(t);
  await here.make();
  const outside = detachedWorktreeAt(here.repository, join(here.directory, 'outside'), here.main());
  writeFileSync(join(outside, 'uncommitted'), 'outside work\n');
  symlinkSync(outside, join(here.path, 'extra'));
  advanced(here);
  const before = { ...unchanged(here, here.path), outside: contents(outside) };
  await refusedNaming(here.make(), here.path);
  assert.deepEqual({ ...unchanged(here, here.path), outside: contents(outside) }, before);
});

test('given a judge directory already made and a head commit the repository does not hold after fetching, L1 fails naming the path and the commit, and the earlier judge directory is unchanged', async (t) => {
  const here = world(t);
  const earlier = await here.make();
  writeFileSync(join(earlier.head, 'left-behind'), 'an earlier judge\'s build\n');
  const missing = gitIn(here.source, 'commit-tree', '-m', 'never pushed', `${here.head}^{tree}`).trim();
  const before = { worktrees: worktreeList(here.repository), files: contents(here.path) };
  await refusedNaming(here.make({ head: missing }), here.path, missing);
  assert.deepEqual({ worktrees: worktreeList(here.repository), files: contents(here.path) }, before);
});

// proves R-WORK-20
test('given a judge directory at a path whose real path cannot be resolved, its parent of mode 0000, L1 fails naming the path and changes nothing', async (t) => {
  const here = world(t);
  await here.make();
  const parent = dirname(here.path);
  chmodSync(parent, 0o000);
  t.after(() => chmodSync(parent, 0o755));
  const state = () => ({ mode: statSync(parent).mode, ...held(here) });
  advanced(here);
  const before = state();
  await refusedNaming(here.make(), here.path);
  assert.deepEqual(state(), before);
  chmodSync(parent, 0o755);
  assert.equal(headOf(join(here.path, 'head')), here.head);
  assert.equal(headOf(join(here.path, 'main')), gitIn(here.repository, 'rev-parse', 'refs/remotes/origin/main').trim());
});

/** L1's events under `card` named `event` in the stream. */
const l1 = (events, card, event) => events.filter((each) => each.layer === 'L1' && each.card === card && each.event === event);

test('L1 records a workspace.made event under the card for a judge\'s directory, carrying the judge\'s role, the path, and the main and head commits', async (t) => {
  const here = world(t);
  const made = await here.make();
  const recorded = l1(here.events(), 42, 'workspace.made');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].role, 'reviewer');
  assert.equal(recorded[0].path, made.path);
  assert.equal(recorded[0].main, here.main());
  assert.equal(recorded[0].head, here.head);
});

test('L1 records a workspace.removed event under the card, carrying the judge\'s role and the path, for the judge directory it replaces', async (t) => {
  const here = world(t);
  await here.make();
  await here.make();
  const recorded = l1(here.events(), 42, 'workspace.removed');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].role, 'reviewer');
  assert.equal(recorded[0].path, here.path);
});

test('L1 records a workspace.failed event under the card, carrying the judge\'s role, the path and why, for a judge directory it refused and for one it could not make', async (t) => {
  const here = world(t);
  mkdirSync(dirname(here.path), { recursive: true });
  writeFileSync(here.path, 'not Rigger\'s\n');
  const refused = await refusedNaming(here.make(), here.path);
  const missing = gitIn(here.source, 'commit-tree', '-m', 'never pushed', `${here.head}^{tree}`).trim();
  const unmade = await refusedNaming(here.make({ role: 'engineer', head: missing }), join(dirname(here.path), 'engineer'));
  const recorded = l1(here.events(), 42, 'workspace.failed');
  assert.deepEqual(recorded.map(({ role, path }) => ({ role, path })), [{ role: 'reviewer', path: here.path }, { role: 'engineer', path: join(dirname(here.path), 'engineer') }]);
  assert.match(recorded[0].reason, /is not a directory/);
  assert.ok(refused.message.includes(recorded[0].reason), recorded[0].reason);
  assert.ok(recorded[1].reason.includes(missing), recorded[1].reason);
  assert.ok(unmade.message.includes(recorded[1].reason), recorded[1].reason);
});

/** `sink`, but refusing every append of the event named `refused`, with an error naming it. */
const refusing = (sink, refused) => ({
  emitter: (context) => {
    const inner = sink.emitter(context);
    return {
      emit: (event, fields) => {
        if (event === refused) throw new Error(`the sink refuses ${event}`);
        inner.emit(event, fields);
      },
    };
  },
});

test('a refused workspace.made, workspace.removed or workspace.failed while L1 makes a judge\'s directory rejects as a refused event naming it, not as a directory L1 could not make', async (t) => {
  for (const event of ['workspace.made', 'workspace.removed', 'workspace.failed']) {
    const here = world(t);
    if (event === 'workspace.removed') await here.make();
    if (event === 'workspace.failed') {
      mkdirSync(dirname(here.path), { recursive: true });
      writeFileSync(here.path, 'not Rigger\'s\n');
    }
    let failure;
    await here.make({ sink: refusing(here.sink, event) }).then(() => assert.fail(`${event}: L1 settled`), (thrown) => { failure = thrown; });
    assert.equal(failure.code, EVENT_REFUSED, `${event}: ${failure.stack}`);
    assert.notEqual(failure.code, WORKSPACE_NOT_MADE);
    assert.ok(failure.message.includes(event), `${event}: ${failure.message}`);
    assert.deepEqual(failure.unrecorded.map((each) => each.event), [event]);
  }
});

test('L1\'s judge-directory make for card 42 answers scratch, the absolute path <root>/scratch/rigger-42, beside main and head, and makes nothing there', async (t) => {
  const here = world(t);
  const made = await here.make();
  assert.equal(made.scratch, join(here.root, 'scratch', 'rigger-42'));
  assert.equal(made.main, join(here.path, 'main'));
  assert.equal(existsSync(join(here.root, 'scratch')), false, 'the make created the scratch base');
});

/**
 * Card 42's workspace and reviewer's judge directory in `here`, made by L1's makes, and the
 * scratch directory `roleDispatch` hands a stand-in adapter for the maker, `engineer`, dispatched
 * in that workspace with its make's scratch base, and for the judge, `reviewer`, dispatched in
 * `main` with its make's. Every path is a real path.
 */
async function rolesOfCard42(here) {
  const workspace = await makeWorkspace({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });
  const judge = await here.make();
  const handed = [];
  const adapter = { name: 'stand-in', invocation: async ({ scratch: given }) => { handed.push(given); return { command: '/usr/bin/true', args: [], input: Buffer.alloc(0), unset: [], env: {} }; } };
  const answer = (role) => ({ role, agent: '.claude/agents/engineer.md', provider: 'stand-in', tier: 'standard', timeout: 60_000, instruction: '', evidence: '' });
  await roleDispatch({ answer: answer('engineer'), cwd: workspace.path, directory: workspace.path, scratch: workspace.scratch, repository: workspace.repository, reach: [], env: {}, sink: here.sink, id: 'd-maker', card: 42, adapters: { 'stand-in': adapter } });
  await roleDispatch({ answer: answer('reviewer'), cwd: judge.main, directory: judge.path, scratch: judge.scratch, repository: judge.repository, reach: [judge.head], env: {}, sink: here.sink, id: 'd-judge', card: 42, adapters: { 'stand-in': adapter } });
  const real = (path) => realpathSync.native(path);
  return { workspace: real(workspace.path), judge: real(judge.path), main: real(judge.main), head: real(judge.head), judges: real(join(here.root, 'judges')), maker: real(handed[0]), reviewer: real(handed[1]) };
}

/** Whether the real path `inner` is `outer` or lies inside it. */
const inside = (inner, outer) => {
  const from = relative(outer, inner);
  return from === '' || (!from.startsWith('..') && !isAbsolute(from));
};

// proves R-WORK-12
test('given two roles of card 42, engineer and reviewer, their scratch directories are siblings, and neither lies inside the other, inside card 42\'s workspace, or inside any judge\'s directory', async (t) => {
  const here = world(t);
  const { workspace, judges, maker, reviewer } = await rolesOfCard42(here);
  assert.equal(dirname(maker), dirname(reviewer));
  assert.notEqual(maker, reviewer);
  for (const [inner, outer] of [[maker, reviewer], [reviewer, maker], [maker, workspace], [reviewer, workspace], [maker, judges], [reviewer, judges]]) {
    assert.equal(inside(inner, outer), false, `${inner} lies inside ${outer}`);
  }
});

test('given a maker\'s dispatch and a judge\'s dispatch of one card, neither scratch directory lies inside the card\'s workspace or inside the judge\'s main or head', async (t) => {
  const here = world(t);
  const { workspace, main, head, maker, reviewer } = await rolesOfCard42(here);
  for (const scratchDirectory of [maker, reviewer]) {
    for (const tree of [workspace, main, head]) assert.equal(inside(scratchDirectory, tree), false, `${scratchDirectory} lies inside ${tree}`);
  }
  // Each is a worktree, so git there names its top level, and in neither scratch directory does git find one.
  for (const scratchDirectory of [maker, reviewer]) {
    const found = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: scratchDirectory, encoding: 'utf8', env: { ...gitEnvironment(process.env), GIT_CEILING_DIRECTORIES: dirname(here.root) } });
    assert.notEqual(found.status, 0, `${scratchDirectory} lies in the worktree ${found.stdout}`);
  }
});

test('L1\'s judge-directory make answers repository, the path of the repository it made from, beside scratch', async (t) => {
  const here = world(t);
  const made = await here.make();
  assert.equal(made.repository, here.repository);
});
