// ABOUTME: Covers L0's workspace adapter: making a workspace from the main line, removing one,
// whether a path is a worktree of the repository, the branch-name question, how its git calls fail,
// that they run one at a time per repository, and the one retry it makes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, rmSync } from 'node:fs';
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
