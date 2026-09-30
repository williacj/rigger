// ABOUTME: Covers L0's workspace adapter: making a workspace from the main line, removing one,
// whether a path is a worktree of the repository, the branch-name question, how its git calls fail,
// that they run one at a time per repository, and the one retry it makes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { workspaces } from '../src/substrate/worktrees.mjs';
import { bareCloneInto, cloneInto, gitIn, repositoryAt, worktreeAt, worktreeList } from './git-repository.mjs';
import { scratch } from './process-fixtures.mjs';

/** Every event an emitter was handed, in order, each as its name and its fields. */
function recorder() {
  const events = [];
  return { events, emit: (event, fields) => events.push({ event, ...fields }) };
}

/**
 * A repository whose `origin` is a local bare repository, in a scratch directory torn down with
 * every process naming it. `push` commits in a third repository, the one `origin` was cloned
 * from, and pushes that commit to `origin`'s `main`, handing back its id.
 */
function world(t) {
  const directory = scratch(t);
  const source = repositoryAt(join(directory, 'source'), { README: 'one\n' });
  gitIn(source, 'branch', '-M', 'main');
  const origin = bareCloneInto(source, join(directory, 'origin.git'));
  const repository = cloneInto(origin, join(directory, 'repository'));
  const push = (message, branch = 'main') => {
    gitIn(source, 'commit', '-q', '--allow-empty', '-m', message);
    gitIn(source, 'push', '-q', origin, `HEAD:refs/heads/${branch}`);
    return gitIn(source, 'rev-parse', 'HEAD').trim();
  };
  return { directory, source, origin, repository, push };
}

/** The commit a checkout's `HEAD` is at, and the branch it has checked out. */
const headOf = (path) => gitIn(path, 'rev-parse', 'HEAD').trim();
const branchOf = (path) => gitIn(path, 'symbolic-ref', '--short', 'HEAD').trim();

test('a workspace made on a new branch is at the commit origin\'s default branch held as the call began, one pushed after the clone included, on the branch named', async (t) => {
  const { directory, repository, push } = world(t);
  const pushed = push('after the clone');
  const path = join(directory, 'rigger-1');

  await workspaces({ repository, emitter: recorder() }).make(path, 'rigger-1');

  assert.equal(headOf(path), pushed);
  assert.equal(branchOf(path), 'rigger-1');
});

test('given no refs/remotes/origin/HEAD, a workspace made on a new branch is at the commit origin\'s default branch held as the call began, on the branch named', async (t) => {
  const { directory, repository, push } = world(t);
  gitIn(repository, 'remote', 'set-head', 'origin', '--delete');
  const pushed = push('after the clone');
  const path = join(directory, 'rigger-1');

  await workspaces({ repository, emitter: recorder() }).make(path, 'rigger-1');

  assert.equal(headOf(path), pushed);
  assert.equal(branchOf(path), 'rigger-1');
});

test('given origin\'s default branch changed after the clone, a workspace made on a new branch is at that branch\'s tip as the call began, on the branch named', async (t) => {
  const { directory, origin, repository, push } = world(t);
  push('on main');
  const pushed = push('on trunk', 'trunk');
  push('main moves on');
  gitIn(origin, 'symbolic-ref', 'HEAD', 'refs/heads/trunk');
  const path = join(directory, 'rigger-1');

  await workspaces({ repository, emitter: recorder() }).make(path, 'rigger-1');

  assert.equal(headOf(path), pushed);
  assert.equal(branchOf(path), 'rigger-1');
});

test('given the branch exists locally at another commit, checked out nowhere, the workspace made on it is at the main line\'s commit', async (t) => {
  const { directory, repository, push } = world(t);
  const earlier = headOf(repository);
  gitIn(repository, 'branch', 'rigger-1', earlier);
  const pushed = push('after the clone');
  const path = join(directory, 'rigger-1');

  await workspaces({ repository, emitter: recorder() }).make(path, 'rigger-1');

  assert.notEqual(earlier, pushed);
  assert.equal(headOf(path), pushed);
  assert.equal(branchOf(path), 'rigger-1');
});

/** The real path of every worktree `git worktree list --porcelain` lists in `repository`. */
const listed = (repository) => worktreeList(repository)
  .split('\n').filter((line) => line.startsWith('worktree ')).map((line) => realpathOrSelf(line.slice('worktree '.length)));

/** `path`'s real path, or `path` itself where nothing is there to resolve. */
function realpathOrSelf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

test('given the branch checked out in a registered worktree whose directory is gone, a workspace made on it at that path exists on the branch, listed once', async (t) => {
  const { directory, repository } = world(t);
  const path = join(directory, 'rigger-1');
  worktreeAt(repository, path, 'rigger-1');
  const real = realpathSync(path);
  rmSync(path, { recursive: true, force: true });

  await workspaces({ repository, emitter: recorder() }).make(path, 'rigger-1');

  assert.equal(branchOf(path), 'rigger-1');
  assert.equal(listed(repository).filter((each) => each === real).length, 1);
});

test('removing a workspace the module made leaves no directory at its path, and no entry for its real path in git worktree list', async (t) => {
  const { directory, repository } = world(t);
  const path = join(directory, 'rigger-1');
  const adapter = workspaces({ repository, emitter: recorder() });
  await adapter.make(path, 'rigger-1');
  const real = realpathSync(path);
  writeFileSync(join(path, 'uncommitted'), 'left by an attempt\n');

  await adapter.remove(path);

  assert.equal(existsSync(path), false);
  assert.deepEqual(listed(repository).filter((each) => each === real), []);
});

/** A directory at `path` holding one file, made by the test rather than by git. */
function plainDirectory(path) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'file'), 'not a worktree\n');
  return path;
}

test('a plain directory holding a file, outside every repository, is not a worktree of the repository', async (t) => {
  const { directory, repository } = world(t);
  const path = plainDirectory(join(directory, 'plain'));

  assert.equal(await workspaces({ repository, emitter: recorder() }).isWorktree(path), false);
});

test('a plain directory holding a file, inside the repository\'s own working tree, is not a worktree of the repository', async (t) => {
  const { repository } = world(t);
  const path = plainDirectory(join(repository, 'plain'));

  assert.equal(await workspaces({ repository, emitter: recorder() }).isWorktree(path), false);
});

test('a worktree of the repository is one, and a subdirectory of it is not', async (t) => {
  const { directory, repository } = world(t);
  const path = worktreeAt(repository, join(directory, 'rigger-1'), 'rigger-1');
  const below = plainDirectory(join(path, 'below'));
  const adapter = workspaces({ repository, emitter: recorder() });

  assert.equal(await adapter.isWorktree(path), true);
  assert.equal(await adapter.isWorktree(below), false);
});

test('a worktree of a different repository is not a worktree of the repository', async (t) => {
  const { directory, repository } = world(t);
  const other = repositoryAt(join(directory, 'other'), { README: 'other\n' });
  const path = worktreeAt(other, join(directory, 'rigger-1'), 'rigger-1');

  assert.equal(await workspaces({ repository, emitter: recorder() }).isWorktree(path), false);
});

test('a worktree of the repository named through a symbolic link is a worktree of the repository', async (t) => {
  const { directory, repository } = world(t);
  const path = worktreeAt(repository, join(directory, 'rigger-1'), 'rigger-1');
  const link = join(directory, 'link');
  symlinkSync(path, link);

  assert.equal(await workspaces({ repository, emitter: recorder() }).isWorktree(link), true);
});

test('the repository\'s own main working tree is not a worktree of the repository, although git worktree list lists it', async (t) => {
  const { repository } = world(t);

  assert.ok(listed(repository).includes(realpathSync(repository)), 'git worktree list does not list the main working tree, so this test proves nothing');
  assert.equal(await workspaces({ repository, emitter: recorder() }).isWorktree(repository), false);
});

test('the repository\'s main working tree named through a symbolic link is not a worktree of the repository, compared by real path', async (t) => {
  const { directory, repository } = world(t);
  const link = join(directory, 'link');
  symlinkSync(repository, link);

  assert.equal(await workspaces({ repository, emitter: recorder() }).isWorktree(link), false);
});
