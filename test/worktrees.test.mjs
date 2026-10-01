// ABOUTME: Covers L0's workspace adapter: making a workspace from the main line, removing one,
// whether a path is a worktree of the repository, the branch-name question, how its git calls fail,
// that they run one at a time per repository, and the one retry it makes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { FETCH_TRIES, workspaces } from '../src/substrate/worktrees.mjs';
import { boundaryReport, sourceTree } from './layer-boundaries.mjs';
import { bareCloneInto, cloneInto, gitIn, repositoryAt, worktreeAt, worktreeList } from './git-repository.mjs';
import { fixture, GIT, gitCalls, gitHanging, gitRecording, holding, OUTLIVED, read, scratch, withFirstOnPath } from './process-fixtures.mjs';
import { previousCheckout } from './git-repository.mjs';
import { ADDING } from '../src/substrate/worktrees.mjs';

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
  const { directory, origin, source, repository, push } = world(t);
  push('on main');
  const pushed = push('on trunk', 'trunk');
  // main moves on from before trunk's commit, so no fetch of main brings that commit.
  gitIn(source, 'reset', '-q', '--hard', 'HEAD~1');
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

test('a plain directory holding a file, where a worktree of the repository was deleted without git, is not a worktree of the repository, although git still lists it', async (t) => {
  const { directory, repository } = world(t);
  const path = worktreeAt(repository, join(directory, 'rigger-1'), 'rigger-1');
  rmSync(path, { recursive: true, force: true });
  plainDirectory(path);

  assert.ok(listed(repository).includes(realpathSync(path)), 'git worktree list does not list the stale registration, so this test proves nothing');
  assert.equal(await workspaces({ repository, emitter: recorder() }).isWorktree(path), false);
});

test('a plain directory holding a file, where a locked worktree of the repository was deleted without git, is not a worktree of the repository', async (t) => {
  const { directory, repository } = world(t);
  const path = worktreeAt(repository, join(directory, 'rigger-1'), 'rigger-1', '--lock');
  rmSync(path, { recursive: true, force: true });
  plainDirectory(path);

  assert.ok(listed(repository).includes(realpathSync(path)), 'git worktree list does not list the locked registration, so this test proves nothing');
  assert.equal(await workspaces({ repository, emitter: recorder() }).isWorktree(path), false);
});

test('a worktree of a different repository, made where a worktree of the repository was deleted without git, is not a worktree of the repository', async (t) => {
  const { directory, repository } = world(t);
  const path = worktreeAt(repository, join(directory, 'rigger-1'), 'rigger-1');
  rmSync(path, { recursive: true, force: true });
  const other = repositoryAt(join(directory, 'other'), { README: 'other\n' });
  worktreeAt(other, path, 'other-1');

  assert.ok(listed(repository).includes(realpathSync(path)), 'git worktree list does not list the stale registration, so this test proves nothing');
  assert.equal(await workspaces({ repository, emitter: recorder() }).isWorktree(path), false);
});

test('an adapter handed the repository through a symbolic link answers no for its main working tree and yes for its worktree', async (t) => {
  const { directory, repository } = world(t);
  const path = worktreeAt(repository, join(directory, 'rigger-1'), 'rigger-1');
  const link = join(directory, 'repository-link');
  symlinkSync(repository, link);
  const adapter = workspaces({ repository: link, emitter: recorder() });

  assert.equal(await adapter.isWorktree(repository), false);
  assert.equal(await adapter.isWorktree(path), true);
});

test('the repository\'s main working tree named through a symbolic link is not a worktree of the repository, compared by real path', async (t) => {
  const { directory, repository } = world(t);
  const link = join(directory, 'link');
  symlinkSync(repository, link);

  assert.equal(await workspaces({ repository, emitter: recorder() }).isWorktree(link), false);
});

test('L0\'s recognition answers, for a linked worktree of the repository, the branch it has checked out, named directly or through a symbolic link, and no lock', async (t) => {
  const { directory, repository } = world(t);
  const path = worktreeAt(repository, join(directory, 'rigger-1'), 'rigger-1');
  const link = join(directory, 'link');
  symlinkSync(path, link);
  const adapter = workspaces({ repository, emitter: recorder() });

  assert.deepEqual(await adapter.registration(path), { branch: 'rigger-1', detached: false, locked: undefined });
  assert.deepEqual(await adapter.registration(link), { branch: 'rigger-1', detached: false, locked: undefined });
});

test('L0\'s recognition answers, for a linked worktree of the repository whose HEAD is detached, that it is detached, on no branch', async (t) => {
  const { directory, repository } = world(t);
  const path = worktreeAt(repository, join(directory, 'rigger-1'), 'rigger-1');
  gitIn(path, 'checkout', '-q', '--detach');

  assert.deepEqual(await workspaces({ repository, emitter: recorder() }).registration(path), { branch: undefined, detached: true, locked: undefined });
});

test('L0\'s recognition answers, for a registration whose directory is gone, its branch and the reason it is locked, and nothing for a path git does not list', async (t) => {
  const { directory, repository } = world(t);
  const path = worktreeAt(repository, join(directory, 'rigger-1'), 'rigger-1', '--lock', '--reason', 'a person\'s lock');
  rmSync(path, { recursive: true, force: true });
  const adapter = workspaces({ repository, emitter: recorder() });

  assert.deepEqual(await adapter.registration(path), { branch: 'rigger-1', detached: false, locked: 'a person\'s lock' });
  assert.equal(await adapter.registration(join(directory, 'rigger-2')), undefined);
});

test('L0 answers the top level git reports for the path it was handed, a subdirectory of a linked worktree included', async (t) => {
  const { directory, repository } = world(t);
  const path = worktreeAt(repository, join(directory, 'rigger-1'), 'rigger-1');
  const below = plainDirectory(join(path, 'below'));

  assert.equal(await workspaces({ repository: below, emitter: recorder() }).topLevel(), realpathSync(path));
  assert.equal(await workspaces({ repository, emitter: recorder() }).topLevel(), realpathSync(repository));
});

test('unlocking a locked registration whose directory is gone leaves it listed with no lock', async (t) => {
  const { directory, repository } = world(t);
  const path = worktreeAt(repository, join(directory, 'rigger-1'), 'rigger-1', '--lock');
  rmSync(path, { recursive: true, force: true });
  const adapter = workspaces({ repository, emitter: recorder() });

  await adapter.unlock(path);

  assert.deepEqual(await adapter.registration(path), { branch: 'rigger-1', detached: false, locked: undefined });
});

test('the lock reason L0 names as the one git worktree add writes is the one git lists for a worktree while git worktree add is making it', async (t) => {
  const { directory, repository } = world(t);
  // A smudge filter runs while git worktree add checks the new worktree's files out, before it
  // takes its lock away, and records what git worktree list --porcelain -z prints then.
  const seen = join(directory, 'seen');
  const filter = fixture(scratch(t), 'smudge', [
    `env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR '${GIT}' -C '${repository}' worktree list --porcelain -z > '${seen}'`,
    'exec cat',
  ].join('\n'));
  writeFileSync(join(repository, '.gitattributes'), 'spied filter=spy\n');
  writeFileSync(join(repository, 'spied'), 'spied\n');
  gitIn(repository, 'add', '.gitattributes', 'spied');
  gitIn(repository, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-qm', 'a file the filter sees');
  gitIn(repository, 'config', 'filter.spy.smudge', filter);
  gitIn(repository, 'config', 'filter.spy.clean', 'cat');
  const path = join(directory, 'rigger-1');

  worktreeAt(repository, path, 'rigger-1');

  const entry = readFileSync(seen, 'utf8').split('\0\0').find((record) => record.startsWith(`worktree ${realpathSync(path)}\0`));
  assert.ok(entry, `git listed no worktree at ${path} while making it: ${JSON.stringify(readFileSync(seen, 'utf8'))}`);
  assert.ok(entry.split('\0').includes(`locked ${ADDING}`), `git listed ${JSON.stringify(entry)}, and L0 names ${JSON.stringify(ADDING)}`);
  assert.equal(await workspaces({ repository, emitter: recorder() }).registration(path).then((held) => held.locked), undefined);
});

test('a git call its timeout ends rejects, naming the git command and the timeout', async (t) => {
  const { repository } = world(t);
  const hanging = gitHanging(holding(t));

  await assert.rejects(
    workspaces({ repository, emitter: recorder(), git: hanging, timeout: OUTLIVED }).isWorktree(repository),
    (error) => error.message.includes(`${hanging} rev-parse`) && error.message.includes(`${OUTLIVED} ms`),
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

/** What git prints to `git check-ref-format --branch <name>` in the repository at `repository`, and its exit code. */
function gitPrintsBranch(name, repository) {
  const { status, stdout } = spawnSync('git', ['-C', repository, 'check-ref-format', '--branch', name], { encoding: 'utf8', env: gitEnvironment() });
  return { status, stdout };
}

test('given a repository whose previous checkout is owner-feature, holding a commit not on the main line, L0 answers no to @{-1}, naming @{-1} and the name git expanded it to', async (t) => {
  const { repository } = world(t);
  previousCheckout(repository, 'owner-feature');
  const printed = gitPrintsBranch('@{-1}', repository);
  assert.equal(printed.status, 0, 'git refuses @{-1}, so this test proves nothing');
  assert.equal(printed.stdout, 'owner-feature\n');

  const { accepted, why } = await workspaces({ repository, emitter: recorder() }).acceptsBranch('@{-1}');

  assert.equal(accepted, false);
  assert.ok(why.includes('@{-1}') && why.includes('owner-feature'), why);
});

test('for each name git check-ref-format --branch accepts here, L0 answers no where git prints it back changed, naming both, and yes where git prints it back unchanged', async (t) => {
  const { repository } = world(t);
  previousCheckout(repository, 'owner-feature');
  const adapter = workspaces({ repository, emitter: recorder() });
  let changed = 0;
  for (const name of ['@{-1}', '@', 'rigger-1', 'a/b', 'owner-feature']) {
    const printed = gitPrintsBranch(name, repository);
    assert.equal(printed.status, 0, `git refuses ${name}, so it is no case of this test`);
    const answer = await adapter.acceptsBranch(name);
    if (printed.stdout === `${name}\n`) {
      assert.deepEqual(answer, { accepted: true }, name);
    } else {
      changed += 1;
      assert.equal(answer.accepted, false, name);
      assert.ok(answer.why.includes(name) && answer.why.includes(printed.stdout.trim()), answer.why);
    }
  }
  assert.ok(changed > 0, 'git printed back every name unchanged, so the test proves nothing of a changed one');
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

/**
 * A `git` stand-in in `directory` that hands each call on to the real git, and appends to
 * `git-times` the wall-clock seconds at which that git started and ended, and the call's
 * arguments. The times bracket the real git's whole run, so two calls whose times overlap ran at once.
 */
function gitTiming(directory) {
  const now = '/usr/bin/perl -MTime::HiRes=time -e \'printf "%.6f", time\'';
  return fixture(directory, 'git', [
    `started=$(${now})`,
    `'${GIT}' "$@"`,
    'status=$?',
    `ended=$(${now})`,
    'printf \'%s %s %s\\n\' "$started" "$ended" "$*" >> "$here/git-times"',
    'exit $status',
  ].join('\n'));
}

/** Each call the timing stand-in in `directory` recorded, in the order they started. */
const timings = (directory) => read(directory, 'git-times').split('\n').map((line) => {
  const [started, ended, ...args] = line.split(' ');
  return { started: Number(started), ended: Number(ended), args: args.join(' ') };
}).sort((a, b) => a.started - b.started);

test('two git calls on one repository never run at once, for every git operation the module makes, through two adapters naming it by its main working tree and by a linked worktree, as a git stand-in\'s start and end times show', async (t) => {
  const { directory, repository, push } = world(t);
  const timing = gitTiming(scratch(t));
  const made = worktreeAt(repository, join(directory, 'made'), 'made');
  const linked = worktreeAt(repository, join(directory, 'linked'), 'linked');
  push('after the clone');
  // Two adapters naming one repository by two paths, its main working tree and a linked worktree,
  // so the queue is the repository's and not the path's or the adapter's.
  const one = workspaces({ repository, emitter: recorder(), git: timing });
  const two = workspaces({ repository: linked, emitter: recorder(), git: timing });

  await Promise.all([
    one.make(join(directory, 'rigger-1'), 'rigger-1'),
    two.make(join(directory, 'rigger-2'), 'rigger-2'),
    one.remove(made),
    two.isWorktree(made),
    one.acceptsBranch('rigger-3'),
    two.fetchMainLine(),
  ]);

  const calls = timings(dirname(timing));
  for (const operation of ['ls-remote', 'fetch', 'worktree add', 'worktree remove', 'worktree prune', 'rev-parse', '-C', 'check-ref-format']) {
    assert.ok(calls.some((call) => call.args.startsWith(operation)), `no ${operation} was recorded, so the test does not cover it:\n${calls.map((call) => call.args).join('\n')}`);
  }
  for (let i = 1; i < calls.length; i += 1) {
    assert.ok(calls[i].started >= calls[i - 1].ended, `\`${calls[i].args}\` started at ${calls[i].started}, before \`${calls[i - 1].args}\` ended at ${calls[i - 1].ended}`);
  }
});

test('the recognition, the top-level question and the unlock never run at once with another git call on one repository, as a git stand-in\'s start and end times show', async (t) => {
  const { directory, repository } = world(t);
  const timing = gitTiming(scratch(t));
  const locked = worktreeAt(repository, join(directory, 'locked'), 'locked', '--lock');
  const linked = worktreeAt(repository, join(directory, 'linked'), 'linked');
  const one = workspaces({ repository, emitter: recorder(), git: timing });
  const two = workspaces({ repository: linked, emitter: recorder(), git: timing });

  await Promise.all([
    one.registration(linked),
    two.registration(locked),
    one.topLevel(),
    two.unlock(locked),
    one.make(join(directory, 'rigger-1'), 'rigger-1'),
  ]);

  const calls = timings(dirname(timing));
  for (const operation of ['worktree list', 'worktree unlock', 'rev-parse', 'worktree add']) {
    assert.ok(calls.some((call) => call.args.startsWith(operation)), `no ${operation} was recorded, so the test does not cover it:\n${calls.map((call) => call.args).join('\n')}`);
  }
  for (let i = 1; i < calls.length; i += 1) {
    assert.ok(calls[i].started >= calls[i - 1].ended, `\`${calls[i].args}\` started at ${calls[i].started}, before \`${calls[i - 1].args}\` ended at ${calls[i - 1].ended}`);
  }
});

/**
 * A `git` stand-in in `directory` that fails a fetch as git fails one another process's fetch beat
 * to `refs/remotes/origin/main`, `times` times, and hands every other call, and every later fetch,
 * on to the real git. The words are git's own: the stand-in asks the real git to move that ref from
 * a value it does not hold, which git refuses through the same lock check a fetch meets, and
 * prints that refusal as a fetch prints it.
 */
function gitRaced(directory, times) {
  return fixture(directory, 'git', [
    'tries=$(/bin/cat "$here/raced" 2>/dev/null || echo 0)',
    `if [ "$1" = fetch ] && [ "$tries" -lt ${times} ]; then`,
    '  echo $((tries + 1)) > "$here/raced"',
    `  words=$('${GIT}' update-ref refs/remotes/origin/main HEAD ${'1'.repeat(40)} 2>&1)`,
    '  printf \'%s\\n\' "$words" | /usr/bin/sed \'s/.*\\(cannot lock ref\\)/error: \\1/\' >&2',
    '  exit 1',
    'fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));
}

/** How many calls the stand-in in `directory` failed as a lost fetch race. */
const raced = (directory) => (existsSync(join(directory, 'raced')) ? Number(read(directory, 'raced')) : 0);

test('a fetch whose first try another fetch beat to the remote-tracking ref is retried, the call succeeds, and the retry is an L0 event naming the ref', async (t) => {
  const { directory, repository, push } = world(t);
  const standIn = gitRaced(scratch(t), 1);
  const pushed = push('after the clone');
  const emitter = recorder();

  await workspaces({ repository, emitter, git: standIn }).make(join(directory, 'rigger-1'), 'rigger-1');

  assert.equal(raced(dirname(standIn)), 1);
  assert.equal(headOf(join(directory, 'rigger-1')), pushed);
  assert.deepEqual(emitter.events.filter(({ event }) => event === 'fetch.retried').map(({ ref }) => ref), ['refs/remotes/origin/main']);
});

test('a fetch whose every try another fetch beat to the remote-tracking ref rejects after the count the code names, naming the ref and the count', async (t) => {
  const { directory, repository } = world(t);
  const standIn = gitRaced(scratch(t), FETCH_TRIES + 1);

  await assert.rejects(
    workspaces({ repository, emitter: recorder(), git: standIn }).make(join(directory, 'rigger-1'), 'rigger-1'),
    (error) => error.message.includes('refs/remotes/origin/main') && error.message.includes(`${FETCH_TRIES} tries`),
  );
  assert.equal(raced(dirname(standIn)), FETCH_TRIES);
});

test('a fetch failing with any other standard error is not retried', async (t) => {
  const { directory, repository } = world(t);
  const failing = fixture(scratch(t), 'git', [
    'if [ "$1" = fetch ]; then echo fetched >> "$here/fetches"; echo "fatal: could not read from remote repository" >&2; exit 128; fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));

  await assert.rejects(workspaces({ repository, emitter: recorder(), git: failing }).fetchMainLine(), /could not read from remote repository/);
  assert.equal(read(dirname(failing), 'fetches'), 'fetched');
});

test('no operation but fetch is retried, whatever its standard error says', async (t) => {
  const { directory, repository } = world(t);
  const made = worktreeAt(repository, join(directory, 'made'), 'made');
  const words = 'error: cannot lock ref \'refs/remotes/origin/main\': is at 1111111111111111111111111111111111111111 but expected 2222222222222222222222222222222222222222';
  // The call whose arguments begin with what `fail` holds fails with the words a lost fetch race
  // prints. Every call is logged, and every other call is handed on to the real git.
  const standIn = fixture(scratch(t), 'git', [
    'echo "$*" >> "$here/calls"',
    'case "$*" in "$(/bin/cat "$here/fail")"*)',
    `  echo "${words}" >&2`,
    '  exit 1',
    'esac',
    `exec '${GIT}' "$@"`,
  ].join('\n'));
  const here = dirname(standIn);
  const adapter = workspaces({ repository, emitter: recorder(), git: standIn });
  const operations = [
    ['ls-remote', () => adapter.make(join(directory, 'rigger-1'), 'rigger-1')],
    ['worktree prune', () => adapter.make(join(directory, 'rigger-1'), 'rigger-1')],
    ['worktree add', () => adapter.make(join(directory, 'rigger-1'), 'rigger-1')],
    ['worktree remove', () => adapter.remove(made)],
    ['rev-parse', () => adapter.isWorktree(made)],
  ];

  const calls = () => (existsSync(join(here, 'calls')) ? read(here, 'calls').split('\n') : []);
  /** How many calls beginning with `operation` `action` made, having failed on the first. */
  const triesOf = async (operation, action) => {
    writeFileSync(join(here, 'fail'), operation);
    const before = calls().length;
    await action();
    return calls().slice(before).filter((call) => call.startsWith(operation)).length;
  };

  for (const [operation, action] of operations) {
    assert.equal(await triesOf(operation, () => assert.rejects(action(), (error) => error.message.includes(words))), 1, operation);
  }
  assert.equal(await triesOf('check-ref-format', async () => {
    assert.deepEqual(await adapter.acceptsBranch('rigger-1'), { accepted: false, why: words });
  }), 1);
});

/** How many times the tests of workspaces made and removed at once repeat. The card names 20. */
const REPETITIONS = 20;

test('three workspaces made at once on one repository all exist on their branches, and three removed at once are none of them listed, in each of 20 repetitions', async (t) => {
  const { directory, repository } = world(t);
  const adapter = workspaces({ repository, emitter: recorder() });
  const cards = ['rigger-1', 'rigger-2', 'rigger-3'];
  const pathOf = (branch) => join(directory, branch);

  for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
    await Promise.all(cards.map((branch) => adapter.make(pathOf(branch), branch)));
    const reals = cards.map((branch) => realpathSync(pathOf(branch)));
    assert.deepEqual(cards.map((branch) => branchOf(pathOf(branch))), cards, `repetition ${repetition}`);

    await Promise.all(cards.map((branch) => adapter.remove(pathOf(branch))));
    assert.deepEqual(listed(repository).filter((each) => reals.includes(each)), [], `repetition ${repetition}`);
  }
});

/** The violations `test/layer-boundaries.mjs` reports on this head's src/ with `modules` added. */
const boundaryMessages = (modules) => boundaryReport(new Map([...sourceTree(), ...Object.entries(modules)])).violations.map(({ message }) => message);

test('only src/execution/ imports the workspace adapter: an import from any other directory breaks rule 10, and one from src/execution/ breaks nothing', () => {
  for (const directory of ['cli', 'config', 'observation', 'scheduling', 'workflow', 'substrate/forge']) {
    const file = `src/${directory}/peek.mjs`;
    const up = '../'.repeat(directory.split('/').length);
    const found = boundaryMessages({ [file]: `import { workspaces } from '${up}substrate/worktrees.mjs';\nexport const peek = workspaces;` });
    assert.ok(found.some((message) => message.startsWith(`${file} `) && message.includes('breaks rule 10:')), `${file}:\n${found.join('\n') || '(nothing)'}`);
  }
  assert.deepEqual(boundaryMessages({ 'src/execution/workspace.mjs': "import { workspaces } from '../substrate/worktrees.mjs';\nexport const make = workspaces;\nexport const WORKSPACE_NOT_MADE = 'WORKSPACE_NOT_MADE';\nexport function workspaceHandle() {}" }), []);
});

test('rule 10 follows a namespace import, an import binding no name, a dynamic import, and a re-export relayed through src/execution/', () => {
  const breaks = (modules, file) => {
    const found = boundaryMessages(modules);
    assert.ok(found.some((message) => message.startsWith(`${file} `) && message.includes('breaks rule 10:')), `${file}:\n${found.join('\n') || '(nothing)'}`);
  };
  breaks({ 'src/cli/all.mjs': "import * as adapter from '../substrate/worktrees.mjs';\nexport const all = adapter;" }, 'src/cli/all.mjs');
  breaks({ 'src/cli/bare.mjs': "import '../substrate/worktrees.mjs';" }, 'src/cli/bare.mjs');
  breaks({ 'src/workflow/late.mjs': "export const late = () => import('../substrate/worktrees.mjs');" }, 'src/workflow/late.mjs');
  breaks({
    'src/execution/relay.mjs': "export { workspaces } from '../substrate/worktrees.mjs';",
    'src/scheduling/pull.mjs': "import { workspaces } from '../execution/relay.mjs';\nexport const pull = workspaces;",
  }, 'src/scheduling/pull.mjs');
});
