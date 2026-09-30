// ABOUTME: Covers L0's workspace adapter: making a workspace from the main line, removing one,
// whether a path is a worktree of the repository, the branch-name question, how its git calls fail,
// that they run one at a time per repository, and the one retry it makes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { workspaces } from '../src/substrate/worktrees.mjs';
import { bareCloneInto, cloneInto, gitIn, repositoryAt, worktreeAt, worktreeList } from './git-repository.mjs';
import { fixture, GIT, gitCalls, gitHanging, gitRecording, holding, OUTLIVED, scratch, withFirstOnPath } from './process-fixtures.mjs';

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

test('a git call its timeout ends rejects, naming the git command and the timeout', async (t) => {
  const { repository } = world(t);
  const hanging = gitHanging(holding(t));

  await assert.rejects(
    workspaces({ repository, emitter: recorder(), git: hanging, timeout: OUTLIVED }).isWorktree(repository),
    (error) => error.message.includes(`${hanging} worktree list`) && error.message.includes(`${OUTLIVED} ms`),
  );
});

test('a git call that exits non-zero rejects, naming the git command, its exit code and the first line of its standard error', async (t) => {
  const { repository } = world(t);
  const failing = fixture(scratch(t), 'git', 'echo "the first line" >&2\necho "the second line" >&2\nexit 3');

  await assert.rejects(
    workspaces({ repository, emitter: recorder(), git: failing }).remove(join(repository, 'nowhere')),
    (error) => error.message.includes(`${failing} worktree remove`) && error.message.includes('exited 3')
      && error.message.includes('the first line') && !error.message.includes('the second line'),
  );
});

test('given GIT_DIR naming a second repository in the calling process, making a workspace leaves that repository\'s git worktree list byte-identical', async (t) => {
  const { directory, repository } = world(t);
  const second = repositoryAt(join(directory, 'second'), { README: 'second\n' });
  const before = worktreeList(second);
  const held = process.env.GIT_DIR;
  process.env.GIT_DIR = join(second, '.git');
  try {
    await workspaces({ repository, emitter: recorder() }).make(join(directory, 'rigger-1'), 'rigger-1');
  } finally {
    if (held === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = held;
  }

  assert.equal(worktreeList(second), before);
  assert.equal(branchOf(join(directory, 'rigger-1')), 'rigger-1');
});

test('a workspace is made with --no-track -B, leaves the repository\'s config byte-identical, and its branch has no upstream', async (t) => {
  const { directory, repository } = world(t);
  const recording = gitRecording(scratch(t));
  const config = join(repository, '.git', 'config');
  const before = readFileSync(config);
  const path = join(directory, 'rigger-1');

  await workspaces({ repository, emitter: recorder(), git: recording }).make(path, 'rigger-1');

  const adds = gitCalls(dirname(recording)).filter((call) => call.startsWith('worktree add '));
  assert.equal(adds.length, 1);
  assert.match(adds[0], / --no-track -B rigger-1 /);
  assert.deepEqual(readFileSync(config), before);
  assert.equal(gitIn(repository, 'for-each-ref', '--format=%(upstream)', 'refs/heads/rigger-1'), '\n');
});

/** What git itself answers to `git check-ref-format --branch <name>`: its exit code and standard error. */
function gitOnBranchName(name) {
  const { status, stderr } = spawnSync('git', ['check-ref-format', '--branch', name], { encoding: 'utf8', env: gitEnvironment() });
  return { status, first: stderr.split('\n')[0] };
}

test('asked whether git accepts a name as a branch, the answer is yes for rigger-1, and no for rigger-1.lock carrying git\'s first line of standard error', async (t) => {
  const { repository } = world(t);
  const adapter = workspaces({ repository, emitter: recorder() });
  const refused = gitOnBranchName('rigger-1.lock');
  assert.equal(gitOnBranchName('rigger-1').status, 0);
  assert.notEqual(refused.status, 0);

  assert.deepEqual(await adapter.acceptsBranch('rigger-1'), { accepted: true });
  assert.deepEqual(await adapter.acceptsBranch('rigger-1.lock'), { accepted: false, why: refused.first });
});

test('the branch-name question runs git check-ref-format --branch through the process adapter under gitEnvironment(), as a git stand-in first on PATH records', async (t) => {
  const { repository } = world(t);
  const directory = scratch(t);
  // The adapter starts each command as the leader of a process group of its own, so the stand-in
  // records whether its group is its own pid, and whether GIT_DIR reached it.
  fixture(directory, 'git', [
    'printf \'%s|%s|%s\\n\' "$*" "${GIT_DIR-unset}" "$(/bin/ps -o pgid= -p $$ | /usr/bin/tr -d \' \')=$$" >> "$here/git-calls"',
    `exec '${GIT}' "$@"`,
  ].join('\n'));
  const held = process.env.GIT_DIR;
  process.env.GIT_DIR = join(repository, '.git');
  try {
    await withFirstOnPath(directory, () => workspaces({ repository, emitter: recorder() }).acceptsBranch('rigger-1'));
  } finally {
    if (held === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = held;
  }

  const [call, ...rest] = gitCalls(directory);
  assert.deepEqual(rest, []);
  const [args, gitDir, group] = call.split('|');
  const [pgid, pid] = group.split('=');
  assert.equal(args, 'check-ref-format --branch rigger-1');
  assert.equal(gitDir, 'unset');
  assert.equal(pgid, pid);
});
