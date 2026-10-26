// ABOUTME: Tests L1's workspace making: the path and branch it derives from a card, the fresh
// workspace each attempt that starts a card's work from the beginning gets, the directories it
// leaves alone, the events it records, and the handle a verb builds over a root and topic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { WORKSPACE_NOT_MADE, makeWorkspace, topicFor, workspaceHandle } from '../src/execution/workspace.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { validate } from '../src/config/validate.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { EVENT_REFUSED, NOT_STARTED } from '../src/substrate/process.mjs';
import rigger from '../rigger.config.mjs';
import { cloneInto, clonedFromOrigin, gitIn, repositoryAt, worktreeAt, worktreeList } from './git-repository.mjs';
import { gitCalls, gitRecording, scratch, withFirstOnPath } from './process-fixtures.mjs';
import { chmodSync, linkSync, rmSync, statSync } from 'node:fs';
import { cardOfBranch } from '../src/execution/workspace.mjs';
import { previousCheckout } from './git-repository.mjs';
import { removeWorktreeAt } from './git-repository.mjs';
import { fixture, GIT } from './process-fixtures.mjs';
import { ADDING } from '../src/substrate/worktrees.mjs';
import { lstatSync } from 'node:fs';
import { childrenIn, gitLeavingChild, gitRacing } from './process-fixtures.mjs';
import { createHash } from 'node:crypto';
import { holding, OUTLIVED } from './process-fixtures.mjs';
import * as workspaceRemoval from '../src/execution/workspace.mjs';
import { lockWorktreeAt } from './git-repository.mjs';
import { world as schedulingWorld, COLUMNS, cardIn, columnsOf } from './loop-world.mjs';
import { renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { detachedWorktreeAt } from './git-repository.mjs';
import { unlockWorktreeAt } from './git-repository.mjs';
import { gitUnansweredWorktreeCheck } from './process-fixtures.mjs';

/**
 * A repository whose `origin` is a local bare repository, a root for workspaces and a sink, in a
 * scratch directory torn down with every process naming it. `push` commits in the repository
 * `origin` was cloned from and pushes that commit to `origin`'s `main`, handing back its id.
 */
function world(t) {
  const directory = scratch(t);
  const { source, origin, repository } = clonedFromOrigin(directory);
  gitIn(repository, 'config', 'user.email', 'fixture@example.invalid');
  gitIn(repository, 'config', 'user.name', 'fixture');
  const root = join(directory, 'worktrees');
  const state = join(directory, '.rigger');
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  const events = () => (existsSync(streamPath(state)) ? readEvents(state) : []);
  const push = (message) => {
    gitIn(source, 'commit', '-q', '--allow-empty', '-m', message);
    gitIn(source, 'push', '-q', origin, 'HEAD:refs/heads/main');
    return gitIn(source, 'rev-parse', 'HEAD').trim();
  };
  const make = (card, over = {}) => makeWorkspace({ root, topic: 'rigger-{number}', card, repository, sink, ...over });
  return { directory, source, origin, repository, root, state, sink, events, push, make };
}

/** A pull over a merged Review card, handed the real removal over this test's repository and root. */
function mergedRemoval(here, options = {}) {
  return schedulingWorld({
    scratch: here.directory,
    cards: [cardIn(42, COLUMNS.review)],
    forge: { pullRequests: [{ number: 421, head: 'rigger-42', sha: '4'.repeat(40), merged: true }] },
    removeDirectories: (card) => workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card, repository: here.repository, sink: here.sink, ...options }),
  });
}

/** The commit a checkout's `HEAD` is at, and the branch it has checked out. */
const headOf = (path) => gitIn(path, 'rev-parse', 'HEAD').trim();
const branchOf = (path) => gitIn(path, 'symbolic-ref', '--short', 'HEAD').trim();

// proves R-WORK-3
test('given an absolute root R and the topic rigger-{number}, the workspace L1 makes for card 42 lies at the real path of R/rigger-42', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  assert.equal(realpathSync(made.path), realpathSync(join(here.root, 'rigger-42')));
  assert.equal(gitIn(made.path, 'rev-parse', '--show-toplevel').trim(), realpathSync(join(here.root, 'rigger-42')));
});

// proves R-WORK-3
test('given an absolute root R and the topic rigger-{number}, the workspace L1 makes for card 42 has the branch rigger-42 checked out', async (t) => {
  const made = await world(t).make(42);
  assert.equal(branchOf(made.path), 'rigger-42');
});

// proves R-WORK-3
test('given two attempts at card 42 made one after another, both workspaces lie at one real path and check out one branch', async (t) => {
  const here = world(t);
  const first = await here.make(42);
  const firstReal = realpathSync(first.path);
  const firstBranch = branchOf(first.path);
  const second = await here.make(42);
  assert.equal(realpathSync(second.path), firstReal);
  assert.equal(branchOf(second.path), firstBranch);
});

// proves R-WORK-3
test('given card 42 and card 43 under one topic, their workspaces are two different children of the root\'s real path, checking out two different branches', async (t) => {
  const here = world(t);
  const one = await here.make(42);
  const other = await here.make(43);
  const root = realpathSync(here.root);
  assert.equal(dirname(realpathSync(one.path)), root);
  assert.equal(dirname(realpathSync(other.path)), root);
  assert.notEqual(realpathSync(one.path), realpathSync(other.path));
  assert.notEqual(branchOf(one.path), branchOf(other.path));
});

// proves R-WORK-10
test('given an earlier attempt\'s workspace for card 42 holding an uncommitted file, the workspace of an attempt that starts card 42\'s work from the beginning holds no file at that path', async (t) => {
  const here = world(t);
  const first = await here.make(42);
  writeFileSync(join(first.path, 'left-behind'), 'an earlier attempt\'s work\n');
  const second = await here.make(42);
  assert.equal(existsSync(join(second.path, 'left-behind')), false);
});

// proves R-WORK-10
test('given an earlier attempt\'s workspace for card 42 whose branch holds a commit the main line does not, the workspace of an attempt that starts card 42\'s work from the beginning has its HEAD at the main line\'s commit', async (t) => {
  const here = world(t);
  const main = gitIn(here.origin, 'rev-parse', 'refs/heads/main').trim();
  const first = await here.make(42);
  gitIn(first.path, 'commit', '-q', '--allow-empty', '-m', 'an earlier attempt\'s commit');
  assert.notEqual(headOf(first.path), main);
  const second = await here.make(42);
  assert.equal(headOf(second.path), main);
});

// proves R-WORK-10
test('given a commit pushed to origin between two attempts at card 42, the second attempt\'s workspace has its HEAD at that commit', async (t) => {
  const here = world(t);
  await here.make(42);
  const pushed = here.push('between the attempts');
  const second = await here.make(42);
  assert.equal(headOf(second.path), pushed);
});

test('given a root that does not exist, the first workspace made under it exists afterwards', async (t) => {
  const here = world(t);
  const root = join(here.directory, 'not', 'yet', 'made');
  assert.equal(existsSync(root), false);
  const made = await here.make(42, { root });
  assert.equal(existsSync(made.path), true);
  assert.equal(realpathSync(made.path), realpathSync(join(root, 'rigger-42')));
});

/**
 * Every file under `directory`, each as its path relative to it and its bytes, and every link and
 * directory, leaving out any under a directory named in `leaving`.
 */
function contents(directory, leaving = []) {
  const found = {};
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (leaving.some((left) => path === join(directory, left) || path.startsWith(join(directory, left, '/')))) continue;
    if (entry.isFile()) found[relative(directory, path)] = readFileSync(path).toString('base64');
    else if (entry.isSymbolicLink()) found[relative(directory, path)] = `-> ${readlinkSync(path)}`;
    else if (entry.isDirectory()) found[`${relative(directory, path)}/`] = '';
  }
  return found;
}

/** Where branch `branch` points in `repository`, or nothing where it does not exist. */
function branchAt(repository, branch) {
  const printed = gitIn(repository, 'for-each-ref', '--format=%(objectname)', `refs/heads/${branch}`).trim();
  return printed === '' ? undefined : printed;
}

// proves R-FAIL-8, R-WORK-13, R-WORK-14
test('an answered workspace replace-rule refusal has its own code and names the condition', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'kept'), 'unchanged\n');
  const before = contents(path);
  const branch = branchAt(here.repository, 'rigger-42');

  await assert.rejects(here.make(42), (error) => error.code === 'WORKSPACE_REFUSED'
    && error.message.includes(path) && error.message.includes('R-WORK-13')
    && error.message.includes('R-WORK-14'));
  assert.deepEqual(contents(path), before);
  assert.equal(branchAt(here.repository, 'rigger-42'), branch);
});

// proves R-FAIL-8, R-WORK-13
test('an unanswered workspace replace-rule git check reports a workspace not made and leaves the earlier worktree untouched', async (t) => {
  const here = world(t);
  const earlier = await here.make(42);
  writeFileSync(join(earlier.path, 'kept'), 'earlier work\n');
  const before = { contents: contents(earlier.path), branch: branchAt(here.repository, 'rigger-42'), worktrees: worktreeList(here.repository) };
  const stand = scratch(t);
  gitUnansweredWorktreeCheck(stand, 'rigger-42', 1);

  const failure = await withFirstOnPath(stand, () => refusedNaming(here.make(42), earlier.path));

  assert.match(failure.message, /fixture: git worktree check gave no answer/);
  assert.deepEqual({ contents: contents(earlier.path), branch: branchAt(here.repository, 'rigger-42'), worktrees: worktreeList(here.repository) }, before);
});

/**
 * Asserts that `attempt` rejects as a workspace that could not be made, naming `path`, and hands
 * back its failure.
 */
async function refusedNaming(attempt, path, code = WORKSPACE_NOT_MADE) {
  let failure;
  await attempt.then(() => assert.fail('the attempt made a workspace'), (thrown) => { failure = thrown; });
  assert.equal(failure.code, code, failure.stack);
  assert.ok(failure.message.includes(path), `the failure does not name ${path}: ${failure.message}`);
  if (code === 'WORKSPACE_REFUSED') {
    assert.match(failure.message, /R-WORK-13/);
    assert.match(failure.message, /R-WORK-1[4-7]/);
  }
  return failure;
}

// proves R-WORK-13, R-WORK-14
test('given a plain directory holding a file at card 42\'s workspace path, under a root outside every repository, the attempt fails naming that path', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'kept'), 'not Rigger\'s\n');
  await refusedNaming(here.make(42), path, 'WORKSPACE_REFUSED');
});

// proves R-WORK-13, R-WORK-14
test('given a plain directory holding a file at card 42\'s workspace path, under a root outside every repository, the file is byte-identical after the attempt, and nothing is added to or removed from the directory', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'kept'), 'not Rigger\'s\n');
  const before = contents(path);
  await here.make(42).catch(() => {});
  assert.deepEqual(contents(path), before);
  assert.equal(readFileSync(join(path, 'kept'), 'utf8'), 'not Rigger\'s\n');
});

// proves R-WORK-13, R-WORK-14
test('given a plain directory holding a file at card 42\'s workspace path, under a root inside the repository\'s working tree, the attempt fails naming that path, and the file is byte-identical afterwards', async (t) => {
  const here = world(t);
  const root = join(here.repository, 'worktrees');
  const path = join(root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'kept'), 'not Rigger\'s\n');
  await refusedNaming(here.make(42, { root }), path, 'WORKSPACE_REFUSED');
  assert.equal(readFileSync(join(path, 'kept'), 'utf8'), 'not Rigger\'s\n');
});

// proves R-WORK-13, R-WORK-14
test('given a directory that is not a workspace of the repository at card 42\'s workspace path, the branch rigger-42 afterwards points where it did before, or does not exist where it did not', async (t) => {
  for (const existing of [false, true]) {
    const here = world(t);
    const before = existing ? gitIn(here.repository, 'rev-parse', 'HEAD').trim() : undefined;
    if (existing) gitIn(here.repository, 'branch', 'rigger-42', before);
    // A commit on origin's main line that -B would move the branch to.
    here.push('the main line moves on');
    const path = join(here.root, 'rigger-42');
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'kept'), 'not Rigger\'s\n');
    await refusedNaming(here.make(42), path, 'WORKSPACE_REFUSED');
    assert.equal(branchAt(here.repository, 'rigger-42'), before, existing ? 'the branch moved' : 'a branch was made');
  }
});

// proves R-WORK-13, R-WORK-14
test('given a worktree of a different repository at card 42\'s workspace path, the attempt fails naming the path, and git worktree list --porcelain in that repository is byte-identical afterwards', async (t) => {
  const here = world(t);
  const other = repositoryAt(join(here.directory, 'other'), { README: 'other\n' });
  const path = join(here.root, 'rigger-42');
  mkdirSync(here.root, { recursive: true });
  worktreeAt(other, path, 'rigger-42');
  const before = worktreeList(other);
  await refusedNaming(here.make(42), path, 'WORKSPACE_REFUSED');
  assert.equal(worktreeList(other), before);
  assert.equal(existsSync(join(path, 'README')), true);
});

// proves R-WORK-13
test('given card 42\'s workspace path named through a symbolic link to a linked worktree of the repository on branch rigger-42, L1 recognises it as the card\'s workspace and replaces it', async (t) => {
  const here = world(t);
  const elsewhere = worktreeAt(here.repository, join(here.directory, 'elsewhere'), 'rigger-42');
  writeFileSync(join(elsewhere, 'left-behind'), 'an earlier attempt\'s work\n');
  const path = join(here.root, 'rigger-42');
  mkdirSync(here.root, { recursive: true });
  symlinkSync(elsewhere, path);
  const made = await here.make(42);
  assert.equal(branchOf(made.path), 'rigger-42');
  assert.equal(existsSync(join(made.path, 'left-behind')), false);
  assert.equal(headOf(made.path), gitIn(here.origin, 'rev-parse', 'refs/heads/main').trim());
});

/**
 * The owner's example on #431: a repository whose main working tree is `W/app-7`, with `W` a
 * directory under `TMPDIR`, which the topic `app-{number}` derives for card 7 under the root `W`.
 * An ignored file and an untracked one make `git status --porcelain --ignored` print something to
 * compare. `make` makes card 7's workspace under `root`, `W` unless the caller names another.
 */
function mainTreeWorld(t) {
  const within = scratch(t);
  const w = join(within, 'W');
  const repository = repositoryAt(join(w, 'app-7'), { README: 'app\n', '.gitignore': 'ignored\n' });
  writeFileSync(join(repository, 'ignored'), 'ignored\n');
  writeFileSync(join(repository, 'untracked'), 'untracked\n');
  const sink = openSink({ directory: join(within, '.rigger'), run: 'r-test', now: () => 0 });
  const make = (root = w) => makeWorkspace({ root, topic: 'app-{number}', card: 7, repository, sink });
  const state = () => ({
    status: gitIn(repository, 'status', '--porcelain', '--ignored'),
    worktrees: worktreeList(repository),
    // The repository's own directory is left out: `git status` may rewrite its index as it
    // refreshes, which the comparison would read as the attempt's doing.
    files: contents(repository, ['.git']),
  });
  return { within, w, repository, make, state };
}

// proves R-WORK-13, R-WORK-14, R-WORK-16
test('given a repository whose main working tree is W/app-7, with root W and topic app-{number}, an attempt at card 7 fails naming that path', async (t) => {
  const here = mainTreeWorld(t);
  await refusedNaming(here.make(), join(here.w, 'app-7'), 'WORKSPACE_REFUSED');
});

// proves R-WORK-13, R-WORK-14, R-WORK-16
test('given a repository whose main working tree is W/app-7, with root W and topic app-{number}, after the attempt at card 7 fails, every file in the main working tree is byte-identical, and git status --porcelain --ignored and git worktree list --porcelain print what they printed before', async (t) => {
  const here = mainTreeWorld(t);
  const before = here.state();
  await here.make().catch(() => {});
  assert.deepEqual(here.state(), before);
});

// proves R-WORK-13, R-WORK-14, R-WORK-16
test('given a root named through a symbolic link, so that the path derived for card 7 resolves to the repository\'s main working tree, an attempt at card 7 fails naming that path', async (t) => {
  const here = mainTreeWorld(t);
  const link = join(here.within, 'link');
  symlinkSync(here.w, link);
  const before = here.state();
  await refusedNaming(here.make(link), join(link, 'app-7'), 'WORKSPACE_REFUSED');
  assert.deepEqual(here.state(), before);
});

// proves R-WORK-9
test('for every topic validate accepts here, the names L1 derives for cards 1, 2, 10 and 11 are four different names', () => {
  // 1 and 11, and 1 and 10, collide under a rule that drops or truncates a digit.
  for (const topic of ['rigger-{number}', '{number}', 'card{number}x', '{number}-{number}', 'a{number}b{number}c', 'x.{number}']) {
    assert.deepEqual(validate({ ...rigger, worktrees: { topic } }), [], topic);
    const names = [1, 2, 10, 11].map((card) => topicFor(topic, card));
    assert.equal(new Set(names).size, 4, `${topic} derives ${names.join(', ')}`);
  }
});

test('cardOfBranch inverts topicFor, for the default topic and for configured ones, and answers no card for a branch the topic does not name', () => {
  // Literal digits beside a placeholder, and placeholders repeated with nothing between them, are
  // topics the validator admits, so the inverse holds for them too.
  for (const topic of ['rigger-{number}', 'card{number}x', '{number}-{number}', 'a.{number}+b', '{number}{number}1', '1{number}', '{number}0{number}', 'r{number}{number}{number}']) {
    assert.deepEqual(validate({ ...rigger, worktrees: { topic } }), [], topic);
    for (const card of [1, 7, 10, 11, 702]) assert.equal(cardOfBranch(topic, topicFor(topic, card)), card, `${topic} ${card}`);
  }
  assert.equal(cardOfBranch('{number}{number}1', '771'), 7);
  assert.equal(cardOfBranch('{number}{number}1', '772'), null);
  // Written out rather than derived, so the inverse is checked against names, not against topicFor.
  assert.equal(cardOfBranch('rigger-{number}', 'rigger-702'), 702);
  assert.equal(cardOfBranch('{number}-{number}', '12-12'), 12);
  for (const [topic, branch] of [
    ['rigger-{number}', 'main'],
    ['rigger-{number}', 'rigger-'],
    ['rigger-{number}', 'rigger-07'],
    ['rigger-{number}', 'rigger-0'],
    ['rigger-{number}', 'rigger-7x'],
    ['rigger-{number}', 'xrigger-7'],
    ['rigger-{number}', 'm5/702-gate-workflow'],
    ['{number}-{number}', '12-13'],
    ['a.{number}+b', 'aX7+b'],
    ['a.{number}+b', 'a.7bb'],
  ]) assert.equal(cardOfBranch(topic, branch), null, `${topic} ${branch}`);
});

/** What git prints first on standard error refusing `name` as a branch name. */
function gitRefuses(name) {
  const refused = spawnSync('git', ['check-ref-format', '--branch', name], { encoding: 'utf8', env: gitEnvironment() });
  assert.notEqual(refused.status, 0, `git accepts ${name}`);
  return refused.stderr.split('\n').find((line) => line.trim() !== '');
}

test('given a topic that git refuses as a branch name, the attempt fails naming the card and the topic, and no directory is made at the derived path', async (t) => {
  const here = world(t);
  const topic = 'rigger-{number}.lock';
  const failure = await refusedNaming(here.make(42, { topic }), join(here.root, 'rigger-42.lock'), 'BRANCH_REFUSED');
  assert.ok(failure.message.includes('#42'), failure.message);
  assert.ok(failure.message.includes(`\`${topic}\``), failure.message);
  assert.equal(existsSync(join(here.root, 'rigger-42.lock')), false);
});

test('building L1\'s workspace handle over a topic git refuses as a branch name for card 1 rejects, naming the topic and git\'s first line of standard error, and makes no directory', async (t) => {
  const here = world(t);
  const topic = 'rigger-{number}.lock';
  const said = gitRefuses('rigger-1.lock');
  await assert.rejects(
    workspaceHandle({ root: here.root, topic, repository: here.repository, sink: here.sink }),
    (failure) => failure.message.includes(`\`${topic}\``) && failure.message.includes(said),
  );
  assert.equal(existsSync(here.root), false);
});

test('L1\'s workspace handle, built over a topic git accepts, makes a card\'s workspace under the root it was built over', async (t) => {
  const here = world(t);
  const handle = await workspaceHandle({ root: here.root, topic: 'rigger-{number}', repository: here.repository, sink: here.sink });
  assert.equal(typeof handle, 'function');
  const made = await handle(42);
  assert.equal(realpathSync(made.path), realpathSync(join(here.root, 'rigger-42')));
  assert.equal(branchOf(made.path), 'rigger-42');
});

/** Publishes the card's line of work to the fixture forge and hands back its head. */
function publishCard(here, content = 'the maker\'s work\n', force = false) {
  if (branchOf(here.source) !== 'rigger-42') gitIn(here.source, 'switch', '-q', '-c', 'rigger-42');
  writeFileSync(join(here.source, 'work'), content);
  gitIn(here.source, 'add', 'work');
  gitIn(here.source, 'commit', '-qm', 'the maker\'s work');
  gitIn(here.source, 'push', '-q', ...(force ? ['--force'] : []), here.origin, 'HEAD:refs/heads/rigger-42');
  return headOf(here.source);
}

// proves R-FAIL-8, R-WORK-13, R-WORK-14, R-WORK-15, R-WORK-16, R-WORK-17
test('each workspace replace-rule condition refuses from the beginning and while continuing without changing the path or branches', async (t) => {
  for (const condition of ['R-WORK-14', 'R-WORK-15', 'R-WORK-16', 'R-WORK-17']) {
    for (const continuing of [false, true]) {
      await t.test(`${condition} ${continuing ? 'continuing' : 'beginning'}`, async (caseTest) => {
        const here = world(caseTest);
        const head = continuing ? publishCard(here) : undefined;
        const path = join(here.root, 'rigger-42');
        let repository = here.repository;
        if (condition === 'R-WORK-14') {
          mkdirSync(path, { recursive: true });
          writeFileSync(join(path, 'kept'), 'plain directory\n');
        } else if (condition === 'R-WORK-15') {
          worktreeAt(here.repository, path, 'owner-42');
        } else {
          worktreeAt(here.repository, path, 'rigger-42');
          if (condition === 'R-WORK-16') repository = path;
          else worktreeAt(here.repository, join(path, 'nested'), 'nested-42');
        }
        const before = { contents: contents(path), branches: gitIn(here.repository, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'), worktrees: worktreeList(here.repository) };

        const failure = await refusedNaming(here.make(42, { repository, ...(head === undefined ? {} : { head }) }), path, 'WORKSPACE_REFUSED');

        assert.ok(failure.message.includes(condition), failure.message);
        assert.deepEqual({ contents: contents(path), branches: gitIn(here.repository, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'), worktrees: worktreeList(here.repository) }, before);
      });
    }
  }
});

// proves R-WORK-25
test('L1\'s workspace handle makes a continuing attempt at the card line of work head it is handed', async (t) => {
  const here = world(t);
  const head = publishCard(here);
  const handle = await workspaceHandle({ root: here.root, topic: 'rigger-{number}', repository: here.repository, sink: here.sink });

  const made = await handle(42, head);

  assert.equal(headOf(made.path), head);
  assert.equal(branchOf(made.path), 'rigger-42');
  assert.equal(readFileSync(join(made.path, 'work'), 'utf8'), 'the maker\'s work\n');
});

// proves R-WORK-10
test('L1\'s workspace handle makes an attempt from the beginning at the forge main line when handed the card alone', async (t) => {
  const here = world(t);
  const main = here.push('main advances');
  const handle = await workspaceHandle({ root: here.root, topic: 'rigger-{number}', repository: here.repository, sink: here.sink });

  const made = await handle(42);

  assert.equal(headOf(made.path), main);
  assert.equal(branchOf(made.path), 'rigger-42');
});

// proves R-WORK-25
test('a continuing attempt replaces a clean earlier worktree with the forge line of work', async (t) => {
  const here = world(t);
  const first = await here.make(42);
  const main = headOf(first.path);
  const head = publishCard(here);

  const made = await here.make(42, { head });

  assert.notEqual(main, head);
  assert.equal(headOf(made.path), head);
  assert.equal(branchOf(made.path), 'rigger-42');
});

// proves R-WORK-25
test('a continuing attempt removes uncommitted changes left in the earlier worktree', async (t) => {
  const here = world(t);
  const first = await here.make(42);
  writeFileSync(join(first.path, 'README'), 'uncommitted change\n');
  const head = publishCard(here);

  const made = await here.make(42, { head });

  assert.equal(headOf(made.path), head);
  assert.equal(readFileSync(join(made.path, 'README'), 'utf8'), 'one\n');
});

// proves R-WORK-25
test('a continuing attempt removes untracked and ignored files left in the earlier worktree', async (t) => {
  const here = world(t);
  const first = await here.make(42);
  writeFileSync(join(first.path, '.gitignore'), 'ignored\n');
  writeFileSync(join(first.path, 'untracked'), 'untracked\n');
  writeFileSync(join(first.path, 'ignored'), 'ignored\n');
  assert.match(gitIn(first.path, 'status', '--porcelain', '--ignored'), /!! ignored/);
  const head = publishCard(here);

  const made = await here.make(42, { head });

  assert.equal(headOf(made.path), head);
  for (const name of ['.gitignore', 'untracked', 'ignored']) assert.equal(existsSync(join(made.path, name)), false, name);
});

// proves R-WORK-25
test('a continuing attempt drops local commits left in the earlier worktree that the forge lacks', async (t) => {
  const here = world(t);
  const first = await here.make(42);
  writeFileSync(join(first.path, 'local'), 'local only\n');
  gitIn(first.path, 'add', 'local');
  gitIn(first.path, 'commit', '-qm', 'local only');
  const local = headOf(first.path);
  const head = publishCard(here);

  const made = await here.make(42, { head });

  assert.notEqual(local, head);
  assert.equal(headOf(made.path), head);
  assert.equal(existsSync(join(made.path, 'local')), false);
});

// proves R-WORK-25
test('a continuing attempt resets a local card branch with commits absent from the forge when no workspace exists', async (t) => {
  const here = world(t);
  const temporary = join(here.directory, 'temporary');
  worktreeAt(here.repository, temporary, 'rigger-42');
  gitIn(temporary, 'commit', '-q', '--allow-empty', '-m', 'local only');
  const local = headOf(temporary);
  removeWorktreeAt(here.repository, temporary);
  const head = publishCard(here);

  const made = await here.make(42, { head });

  assert.notEqual(local, head);
  assert.equal(headOf(made.path), head);
  assert.equal(branchAt(here.repository, 'rigger-42'), head);
});

// proves R-WORK-25
test('a continuing attempt follows a force-moved forge line rather than its earlier ancestry', async (t) => {
  const here = world(t);
  const earlier = publishCard(here, 'old work\n');
  await here.make(42, { head: earlier });
  gitIn(here.source, 'reset', '--hard', 'HEAD~1');
  const head = publishCard(here, 'force-moved work\n', true);

  const made = await here.make(42, { head });

  assert.notEqual(earlier, head);
  assert.equal(headOf(made.path), head);
  assert.equal(readFileSync(join(made.path, 'work'), 'utf8'), 'force-moved work\n');
});

// proves R-WORK-25
test('a continuing attempt refuses a forge line moved since L2 read it, naming both heads and preserving the workspace', async (t) => {
  const here = world(t);
  const readHead = publishCard(here, 'first work\n');
  const first = await here.make(42, { head: readHead });
  writeFileSync(join(first.path, 'uncommitted'), 'kept\n');
  const before = contents(first.path);
  const movedHead = publishCard(here, 'later work\n');

  const failure = await refusedNaming(here.make(42, { head: readHead }), first.path, 'LINE_MOVED');

  assert.ok(failure.message.includes(readHead) && failure.message.includes(movedHead), failure.message);
  assert.deepEqual(contents(first.path), before);
  assert.equal(headOf(first.path), readHead);
});

// proves R-WORK-25
test('a continuing attempt refuses when the forge moves during its fetch', async (t) => {
  const here = world(t);
  const readHead = publishCard(here, 'first work\n');
  const first = await here.make(42, { head: readHead });
  writeFileSync(join(first.path, 'uncommitted'), 'kept\n');
  const before = contents(first.path);
  gitIn(here.source, 'commit', '-q', '--allow-empty', '-m', 'later work');
  const movedHead = headOf(here.source);
  const stand = scratch(t);
  fixture(stand, 'git', [
    'if [ "$1" = fetch ]; then',
    `  '${GIT}' -C '${here.source}' push -q '${here.origin}' HEAD:refs/heads/rigger-42 || exit $?`,
    'fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));

  const failure = await withFirstOnPath(stand, () => refusedNaming(here.make(42, { head: readHead }), first.path, 'LINE_MOVED'));

  assert.ok(failure.message.includes(readHead) && failure.message.includes(movedHead), failure.message);
  assert.equal(branchAt(here.origin, 'rigger-42'), movedHead);
  assert.deepEqual(contents(first.path), before);
  assert.equal(headOf(first.path), readHead);
});

// proves R-WORK-25, R-WORK-13
test('a continuing attempt refuses a different branch or detached HEAD at its path without changing the directory', async (t) => {
  for (const kind of ['other branch', 'detached HEAD']) {
    const here = world(t);
    const head = publishCard(here);
    const path = join(here.root, 'rigger-42');
    mkdirSync(here.root, { recursive: true });
    worktreeAt(here.repository, path, kind === 'other branch' ? 'owner-work' : 'rigger-42');
    if (kind === 'detached HEAD') gitIn(path, 'checkout', '-q', '--detach');
    writeFileSync(join(path, 'kept'), `${kind}\n`);
    const before = contents(path);

    const failure = await refusedNaming(here.make(42, { head }), path, 'WORKSPACE_REFUSED');

    assert.ok(failure.message.includes(kind === 'other branch' ? 'owner-work' : 'detached HEAD'), failure.message);
    assert.deepEqual(contents(path), before);
  }
});

// proves R-WORK-25, R-WORK-13
test('a continuing attempt refuses a plain directory at its path and preserves its contents', async (t) => {
  const here = world(t);
  const head = publishCard(here);
  const path = join(here.root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'kept'), 'not a worktree\n');
  const before = contents(path);

  await refusedNaming(here.make(42, { head }), path, 'WORKSPACE_REFUSED');

  assert.deepEqual(contents(path), before);
});

// proves R-WORK-25
test('a continuing attempt refuses when the card branch is checked out in a worktree elsewhere', async (t) => {
  const here = world(t);
  const head = publishCard(here);
  const elsewhere = worktreeAt(here.repository, join(here.directory, 'elsewhere'), 'rigger-42');
  writeFileSync(join(elsewhere, 'kept'), 'elsewhere\n');
  const before = contents(elsewhere);
  const path = join(here.root, 'rigger-42');

  const failure = await refusedNaming(here.make(42, { head }), path, 'BRANCH_ELSEWHERE');

  assert.ok(failure.message.includes(elsewhere), failure.message);
  assert.deepEqual(contents(elsewhere), before);
  assert.equal(existsSync(path), false);
});

// proves R-WORK-25
test('a continuing attempt refuses a line deleted after L2 read it and preserves the workspace', async (t) => {
  const here = world(t);
  const head = publishCard(here);
  const first = await here.make(42, { head });
  writeFileSync(join(first.path, 'kept'), 'earlier work\n');
  const before = contents(first.path);
  gitIn(here.source, 'push', '-q', here.origin, ':refs/heads/rigger-42');

  const failure = await refusedNaming(here.make(42, { head }), first.path, 'LINE_DELETED');

  assert.ok(failure.message.includes('rigger-42') && failure.message.includes('deleted'), failure.message);
  assert.deepEqual(contents(first.path), before);
  assert.equal(headOf(first.path), head);
});

// proves R-WORK-25
test('a continuing attempt refuses a failed fetch naming its path and preserving the workspace', async (t) => {
  const here = world(t);
  const head = publishCard(here);
  const first = await here.make(42, { head });
  writeFileSync(join(first.path, 'kept'), 'earlier work\n');
  const before = contents(first.path);
  const stand = scratch(t);
  fixture(stand, 'git', [
    'if [ "$1" = fetch ]; then echo "fatal: fetch refused by fixture" >&2; exit 128; fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));

  const failure = await withFirstOnPath(stand, () => refusedNaming(here.make(42, { head }), first.path, 'FETCH_FAILED'));

  assert.ok(failure.message.includes('fetch refused by fixture'), failure.message);
  assert.deepEqual(contents(first.path), before);
  assert.equal(headOf(first.path), head);
});

// proves R-FAIL-8
test('L1 maps the forge failure code even when git prints words resembling a moved line', async (t) => {
  const here = world(t);
  const head = publishCard(here);
  const first = await here.make(42, { head });
  const stand = fixture(scratch(t), 'git', [
    'if [ "$1" = ls-remote ]; then echo "origin moved from old to new" >&2; exit 128; fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));

  const failure = await withFirstOnPath(dirname(stand), () => refusedNaming(here.make(42, { head }), first.path, 'FETCH_FAILED'));

  assert.match(failure.message, /origin moved from old to new/);
  assert.equal(branchOf(first.path), 'rigger-42');
});

// proves R-WORK-25
test('a continuing attempt refuses a timed-out fetch naming its path and preserving the workspace', async (t) => {
  const here = world(t);
  const head = publishCard(here);
  const first = await here.make(42, { head });
  writeFileSync(join(first.path, 'kept'), 'earlier work\n');
  const before = contents(first.path);
  const stand = holding(t);
  fixture(stand, 'git', [
    'if [ "$1" = fetch ]; then /usr/bin/tail -f "$here/hold" > /dev/null & wait; fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));

  const failure = await withFirstOnPath(stand, () => refusedNaming(here.make(42, { head, timeout: OUTLIVED }), first.path, 'FETCH_FAILED'));

  assert.ok(failure.message.includes('fetch') && failure.message.includes(`${OUTLIVED} ms`), failure.message);
  assert.deepEqual(contents(first.path), before);
  assert.equal(headOf(first.path), head);
});

test('L1\'s workspace function, handed a root that is not absolute, makes no workspace and fails naming the root, and it reads no repo', async (t) => {
  const here = world(t);
  /** The function's arguments, with a `repo` that fails the test wherever it is read. */
  const handed = (root) => Object.defineProperty({ root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink }, 'repo', {
    get() { throw new Error('L1 read repo'); },
  });
  const failure = await refusedNaming(makeWorkspace(handed('worktrees')), 'worktrees', 'ROOT_NOT_ABSOLUTE');
  assert.ok(failure.message.includes('not an absolute path'), failure.message);
  assert.equal(existsSync(join('worktrees', 'rigger-42')), false);
  const made = await makeWorkspace(handed(here.root));
  assert.equal(branchOf(made.path), 'rigger-42');
});

test('a workspace that could not be made is reported with a code telling it from a command that never started and from a refused event, naming the path', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  const failure = await refusedNaming(here.make(42), path, 'WORKSPACE_REFUSED');
  assert.notEqual(failure.code, NOT_STARTED);
  assert.notEqual(failure.code, EVENT_REFUSED);
  assert.equal(failure.path, path);
});

/** L1's events under `card` named `event` in the stream. */
const l1 = (events, card, event) => events.filter((each) => each.layer === 'L1' && each.card === card && each.event === event);

test('given a workspace made for an attempt, the event stream holds an L1 event under that card naming the workspace\'s path and its branch', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  const recorded = l1(here.events(), 42, 'workspace.made');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].path, made.path);
  assert.equal(recorded[0].branch, 'rigger-42');
});

test('given an earlier attempt\'s workspace removed to make a fresh one, the event stream holds an L1 event under that card naming the removed path', async (t) => {
  const here = world(t);
  const first = await here.make(42);
  await here.make(42);
  const recorded = l1(here.events(), 42, 'workspace.removed');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].path, realpathSync(first.path));
});

test('given a workspace that could not be made, the event stream holds an L1 event under that card naming the path and why', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  const failure = await refusedNaming(here.make(42), path, 'WORKSPACE_REFUSED');
  const recorded = l1(here.events(), 42, 'workspace.failed');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].path, path);
  assert.ok(failure.message.includes(recorded[0].reason), recorded[0].reason);
  assert.match(recorded[0].reason, /not a workspace of the repository/);
});

test('L1\'s dispatch runs its command in the directory its caller hands it, and derives no workspace path itself', async (t) => {
  const here = world(t);
  const handed = join(here.directory, 'handed');
  mkdirSync(handed);
  const before = readdirSync(here.directory).sort();
  const result = await dispatch({ id: 'd-431', card: 42, directory: here.state, sink: here.sink, command: '/bin/pwd', args: ['-P'], cwd: handed, workspace: handed, env: process.env, timeout: 10_000 });
  assert.equal(result.exit, 0);
  assert.equal(result.stdout.toString('utf8').trim(), realpathSync(handed));
  // Nothing derived from card 42 appears beside the directory handed, and no root is made.
  assert.deepEqual(readdirSync(here.directory).filter((name) => name !== '.rigger').sort(), before.filter((name) => name !== '.rigger'));
  assert.equal(existsSync(here.root), false);
});

// A directory L1 must leave alone is found so by asking, never by trying: git's own refusals of a
// removal are not what keeps it, so no git call that could write is sent at all.
// proves R-WORK-13, R-WORK-14, R-WORK-16
test('given a plain directory, a worktree of another repository, or the main working tree at the workspace path, L1 sends git only questions: no fetch, no worktree call, no branch call', async (t) => {
  const here = world(t);
  const plain = join(here.root, 'rigger-42');
  mkdirSync(plain, { recursive: true });
  const other = repositoryAt(join(here.directory, 'other'), { README: 'other\n' });
  worktreeAt(other, join(here.root, 'rigger-43'), 'rigger-43');
  const main = mainTreeWorld(t);
  const stand = scratch(t);
  gitRecording(stand);
  await withFirstOnPath(stand, async () => {
    await refusedNaming(here.make(42), plain, 'WORKSPACE_REFUSED');
    await refusedNaming(here.make(43), join(here.root, 'rigger-43'), 'WORKSPACE_REFUSED');
    await refusedNaming(main.make(), join(main.w, 'app-7'), 'WORKSPACE_REFUSED');
  });
  const calls = gitCalls(stand);
  assert.ok(calls.length > 0, 'the stand-in recorded no call');
  const questions = /^(check-ref-format --branch |rev-parse |-C \S+ rev-parse )/;
  assert.deepEqual(calls.filter((call) => !questions.test(call)), []);
});

/** The topic that git's previous-checkout syntax turns into `@{-1}` for card 1, `@{-2}` for card 2. */
const EXPANDING = '@{-{number}}';

test('given the topic @{-{number}} and a repository whose previous checkout is owner-feature holding a commit not on the main line, building L1\'s workspace handle rejects, naming the topic', async (t) => {
  const here = world(t);
  previousCheckout(here.repository, 'owner-feature');
  await assert.rejects(
    workspaceHandle({ root: here.root, topic: EXPANDING, repository: here.repository, sink: here.sink }),
    (failure) => failure.message.includes(`\`${EXPANDING}\``),
  );
});

test('given the topic @{-{number}} and a repository whose previous checkout is owner-feature holding a commit not on the main line, owner-feature points afterwards at the commit it held before, whatever card is attempted', async (t) => {
  const here = world(t);
  const held = previousCheckout(here.repository, 'owner-feature');
  for (const card of [1, 2, 3]) {
    await here.make(card, { topic: EXPANDING }).catch(() => {});
    assert.equal(branchAt(here.repository, 'owner-feature'), held, `card ${card}`);
  }
});

/**
 * A `git` stand-in in a scratch directory that refuses `check-ref-format --branch rigger-3` with the
 * words git refuses a name with, records every call it is sent in `git-calls`, and hands every
 * other call on to the real git.
 */
function gitRefusingCard3(t) {
  const directory = scratch(t);
  fixture(directory, 'git', [
    'printf \'%s\\n\' "$*" >> "$here/git-calls"',
    'if [ "$*" = "check-ref-format --branch rigger-3" ]; then echo "fatal: \'rigger-3\' is not a valid branch name" >&2; exit 128; fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));
  return directory;
}

test('given a git stand-in that accepts card 1\'s derived name and refuses card 3\'s, an attempt at card 3 fails naming card 3\'s name', async (t) => {
  const here = world(t);
  const stand = gitRefusingCard3(t);
  await withFirstOnPath(stand, async () => {
    const handle = await workspaceHandle({ root: here.root, topic: 'rigger-{number}', repository: here.repository, sink: here.sink });
    const failure = await refusedNaming(handle(3), join(here.root, 'rigger-3'), 'BRANCH_REFUSED');
    assert.ok(failure.message.includes('rigger-3'), failure.message);
  });
});

test('given a git stand-in that accepts card 1\'s derived name and refuses card 3\'s, the attempt at card 3 sends git no call that changes a ref or a directory', async (t) => {
  const here = world(t);
  const stand = gitRefusingCard3(t);
  await withFirstOnPath(stand, async () => {
    const handle = await workspaceHandle({ root: here.root, topic: 'rigger-{number}', repository: here.repository, sink: here.sink });
    await handle(3).catch(() => {});
  });
  const calls = gitCalls(stand);
  assert.ok(calls.includes('check-ref-format --branch rigger-3'), calls.join('\n'));
  const questions = /^(check-ref-format --branch |rev-parse |-C \S+ rev-parse |worktree list )/;
  assert.deepEqual(calls.filter((call) => !questions.test(call)), []);
  assert.equal(existsSync(here.root), false);
});

// proves R-WORK-13
test('given a linked worktree of the repository on branch rigger-42 at card 42\'s workspace path, holding an uncommitted file, an attempt at card 42 makes a fresh workspace there on rigger-42, holding no such file', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(here.root, { recursive: true });
  worktreeAt(here.repository, path, 'rigger-42');
  writeFileSync(join(path, 'uncommitted'), 'work\n');
  const made = await here.make(42);
  assert.equal(realpathSync(made.path), realpathSync(path));
  assert.equal(branchOf(made.path), 'rigger-42');
  assert.equal(existsSync(join(made.path, 'uncommitted')), false);
});

/**
 * A world whose card 42 workspace path, `root/rigger-42`, holds a linked worktree of the
 * repository on `branch`, holding an uncommitted file, which L1 is handed as the repository, or
 * whose directory `below` it is handed where one is named.
 */
function handedWorld(t, branch, below) {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(here.root, { recursive: true });
  worktreeAt(here.repository, path, branch);
  writeFileSync(join(path, 'uncommitted'), 'the engine\'s own work\n');
  const handed = below === undefined ? path : join(path, below);
  mkdirSync(handed, { recursive: true });
  const state = () => ({ files: contents(path), worktrees: worktreeList(here.repository) });
  return { ...here, path, handed, state, attempt: () => here.make(42, { repository: handed }) };
}

// proves R-WORK-13, R-WORK-15, R-WORK-16
test('given L1 handed as the repository a linked worktree at root/rigger-42 on branch owner-work, holding an uncommitted file, an attempt at card 42 fails naming the path', async (t) => {
  const here = handedWorld(t, 'owner-work');
  await refusedNaming(here.attempt(), here.path, 'WORKSPACE_REFUSED');
});

// proves R-WORK-13, R-WORK-15, R-WORK-16
test('given L1 handed as the repository a linked worktree at root/rigger-42 on branch owner-work, after the attempt at card 42 fails, the uncommitted file is byte-identical, and git worktree list --porcelain prints the same as before', async (t) => {
  const here = handedWorld(t, 'owner-work');
  const before = here.state();
  await here.attempt().catch(() => {});
  assert.deepEqual(here.state(), before);
  assert.equal(readFileSync(join(here.path, 'uncommitted'), 'utf8'), 'the engine\'s own work\n');
});

// proves R-WORK-13, R-WORK-16
test('given L1 handed as the repository a linked worktree at root/rigger-42 that is on branch rigger-42, an attempt at card 42 fails naming the path, and the worktree\'s files are byte-identical afterwards', async (t) => {
  const here = handedWorld(t, 'rigger-42');
  const before = here.state();
  await refusedNaming(here.attempt(), here.path, 'WORKSPACE_REFUSED');
  assert.deepEqual(here.state(), before);
});

// proves R-WORK-13, R-WORK-16
test('given L1 handed as the repository a subdirectory of a linked worktree at root/rigger-42 on branch rigger-42, holding an uncommitted file, an attempt at card 42 fails naming the path', async (t) => {
  const here = handedWorld(t, 'rigger-42', 'below');
  await refusedNaming(here.attempt(), here.path, 'WORKSPACE_REFUSED');
});

// proves R-WORK-13, R-WORK-16
test('given L1 handed as the repository a subdirectory of a linked worktree at root/rigger-42 on branch rigger-42, after the attempt at card 42 fails, the uncommitted file is byte-identical, and git worktree list --porcelain prints the same as before', async (t) => {
  const here = handedWorld(t, 'rigger-42', 'below');
  const before = here.state();
  await here.attempt().catch(() => {});
  assert.deepEqual(here.state(), before);
  assert.equal(readFileSync(join(here.path, 'uncommitted'), 'utf8'), 'the engine\'s own work\n');
});

/**
 * A world with the main working tree as the repository, and an owner's linked worktree on branch
 * `owner-7` at card 7's workspace path, `root/rigger-7`, holding an uncommitted file and a
 * read-only one.
 */
function ownerWorld(t) {
  const here = world(t);
  const path = join(here.root, 'rigger-7');
  mkdirSync(here.root, { recursive: true });
  worktreeAt(here.repository, path, 'owner-7');
  writeFileSync(join(path, 'uncommitted'), 'the owner\'s work\n');
  writeFileSync(join(path, 'read-only'), 'the owner\'s\n');
  chmodSync(join(path, 'read-only'), 0o444);
  const state = () => ({ files: contents(path), owner: branchAt(here.repository, 'owner-7'), worktrees: worktreeList(here.repository), mode: statSync(join(path, 'read-only')).mode });
  return { ...here, path, state };
}

// proves R-WORK-13, R-WORK-15
test('given the main working tree as the repository, and an owner\'s linked worktree on branch owner-7 at root/rigger-7 holding an uncommitted file, an attempt at card 7 fails naming the path', async (t) => {
  const here = ownerWorld(t);
  await refusedNaming(here.make(7), here.path, 'WORKSPACE_REFUSED');
});

// proves R-WORK-13, R-WORK-15
test('given an owner\'s linked worktree on branch owner-7 at root/rigger-7 holding an uncommitted file, after the attempt at card 7 fails, the file is byte-identical, owner-7 points at the commit it held before, and git worktree list --porcelain prints the same as before', async (t) => {
  const here = ownerWorld(t);
  const before = here.state();
  await here.make(7).catch(() => {});
  assert.deepEqual(here.state(), before);
  assert.equal(readFileSync(join(here.path, 'uncommitted'), 'utf8'), 'the owner\'s work\n');
});

// proves R-WORK-13, R-WORK-15
test('given an owner\'s linked worktree on owner-7 at card 7\'s workspace path holding a read-only file, after the attempt at card 7 fails, the file\'s mode bits are unchanged', async (t) => {
  const here = ownerWorld(t);
  const mode = statSync(join(here.path, 'read-only')).mode;
  await here.make(7).catch(() => {});
  assert.equal(statSync(join(here.path, 'read-only')).mode, mode);
});

/** A linked worktree of the repository at card 42's workspace path whose `HEAD` is detached. */
function detachedWorld(t) {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(here.root, { recursive: true });
  worktreeAt(here.repository, path, 'rigger-42');
  gitIn(path, 'checkout', '-q', '--detach');
  writeFileSync(join(path, 'uncommitted'), 'detached work\n');
  return { ...here, path, state: () => ({ head: gitIn(path, 'rev-parse', 'HEAD'), symbolic: gitIn(path, 'rev-parse', '--symbolic-full-name', 'HEAD'), files: contents(path) }) };
}

// proves R-WORK-13, R-WORK-15
test('given a linked worktree of the repository with a detached HEAD at card 42\'s workspace path, an attempt at card 42 fails naming the path', async (t) => {
  const here = detachedWorld(t);
  await refusedNaming(here.make(42), here.path, 'WORKSPACE_REFUSED');
});

// proves R-WORK-13, R-WORK-15
test('given a linked worktree of the repository with a detached HEAD at card 42\'s workspace path, after the attempt fails, its HEAD and its files are unchanged', async (t) => {
  const here = detachedWorld(t);
  const before = here.state();
  await here.make(42).catch(() => {});
  assert.deepEqual(here.state(), before);
});

/** A symbolic link at card 42's workspace path to card 43's workspace, on `rigger-43`, holding an uncommitted file. */
async function linkedToCard43(t) {
  const here = world(t);
  const other = await here.make(43);
  writeFileSync(join(other.path, 'uncommitted'), 'card 43\'s work\n');
  const path = join(here.root, 'rigger-42');
  symlinkSync(other.path, path);
  return { ...here, path, other: other.path };
}

// proves R-WORK-13, R-WORK-15
test('given a symbolic link at card 42\'s workspace path pointing at card 43\'s workspace on rigger-43, which holds an uncommitted file, an attempt at card 42 fails naming the path', async (t) => {
  const here = await linkedToCard43(t);
  await refusedNaming(here.make(42), here.path, 'WORKSPACE_REFUSED');
});

// proves R-WORK-13, R-WORK-15
test('given a symbolic link at card 42\'s workspace path pointing at card 43\'s workspace, after the attempt at card 42 fails, card 43\'s workspace still exists on rigger-43, and its uncommitted file is byte-identical', async (t) => {
  const here = await linkedToCard43(t);
  await here.make(42).catch(() => {});
  assert.equal(branchOf(here.other), 'rigger-43');
  assert.equal(readFileSync(join(here.other, 'uncommitted'), 'utf8'), 'card 43\'s work\n');
});

/**
 * A repository whose main worktree is `W/app-7` on branch `app-7`, holding an uncommitted file and
 * a read-only one, and a linked worktree of it elsewhere, which L1 is handed as the repository,
 * with root `W` and topic `app-{number}`.
 */
function mainNotHandedWorld(t) {
  const within = scratch(t);
  const w = join(within, 'W');
  const main = repositoryAt(join(w, 'app-7'), { README: 'app\n' });
  gitIn(main, 'branch', '-M', 'app-7');
  const elsewhere = worktreeAt(main, join(within, 'elsewhere'), 'elsewhere');
  writeFileSync(join(main, 'uncommitted'), 'the owner\'s work\n');
  writeFileSync(join(main, 'read-only'), 'the owner\'s\n');
  chmodSync(join(main, 'read-only'), 0o444);
  const sink = openSink({ directory: join(within, '.rigger'), run: 'r-test', now: () => 0 });
  const attempt = () => makeWorkspace({ root: w, topic: 'app-{number}', card: 7, repository: elsewhere, sink });
  const state = () => ({ uncommitted: readFileSync(join(main, 'uncommitted'), 'utf8'), readOnly: readFileSync(join(main, 'read-only'), 'utf8'), mode: statSync(join(main, 'read-only')).mode });
  return { main, attempt, state };
}

// proves R-WORK-13, R-WORK-14
test('given L1 handed as the repository a linked worktree elsewhere, and the repository\'s main worktree at W/app-7 on branch app-7, with root W and topic app-{number}, an attempt at card 7 fails naming the path', async (t) => {
  const here = mainNotHandedWorld(t);
  await refusedNaming(here.attempt(), here.main, 'WORKSPACE_REFUSED');
});

// proves R-WORK-13, R-WORK-14
test('given L1 handed a linked worktree elsewhere, and the main worktree at W/app-7 holding a read-only file and an uncommitted file, after the attempt at card 7 fails, both files are byte-identical, and the read-only file\'s mode bits are unchanged', async (t) => {
  const here = mainNotHandedWorld(t);
  const before = here.state();
  await here.attempt().catch(() => {});
  assert.deepEqual(here.state(), before);
});

/** A separate clone of the repository at card 7's workspace path on branch `rigger-7`, holding an uncommitted file and a read-only one. */
function cloneWorld(t) {
  const here = world(t);
  const path = cloneInto(here.origin, join(here.root, 'rigger-7'));
  gitIn(path, 'switch', '-q', '-c', 'rigger-7');
  writeFileSync(join(path, 'uncommitted'), 'the clone\'s work\n');
  writeFileSync(join(path, 'read-only'), 'the clone\'s\n');
  chmodSync(join(path, 'read-only'), 0o444);
  const state = () => ({ uncommitted: readFileSync(join(path, 'uncommitted'), 'utf8'), readOnly: readFileSync(join(path, 'read-only'), 'utf8'), mode: statSync(join(path, 'read-only')).mode, status: gitIn(path, 'status', '--porcelain') });
  return { ...here, path, state };
}

// proves R-WORK-13, R-WORK-14
test('given a separate clone of the repository at card 7\'s workspace path, on branch rigger-7, an attempt at card 7 fails naming the path', async (t) => {
  const here = cloneWorld(t);
  await refusedNaming(here.make(7), here.path, 'WORKSPACE_REFUSED');
});

// proves R-WORK-13, R-WORK-14
test('given a separate clone at card 7\'s workspace path holding a read-only file and an uncommitted file, after the attempt at card 7 fails, both files are byte-identical, the read-only file\'s mode bits are unchanged, and the clone\'s git status --porcelain prints the same as before', async (t) => {
  const here = cloneWorld(t);
  const before = here.state();
  await here.make(7).catch(() => {});
  assert.deepEqual(here.state(), before);
});

/**
 * A registration at card 44's workspace path on `branch` whose directory is gone, locked with
 * `reason`, as an engine killed while `git worktree add` made it leaves one where the reason is
 * the one that command writes.
 */
function staleLockWorld(t, branch, reason) {
  const here = world(t);
  const path = join(here.root, 'rigger-44');
  mkdirSync(here.root, { recursive: true });
  worktreeAt(here.repository, path, branch, '--lock', '--reason', reason);
  rmSync(path, { recursive: true, force: true });
  return { ...here, path };
}

/** The record `git worktree list --porcelain` prints for the worktree at `path`, or nothing. */
const listedAt = (repository, path) => worktreeList(repository).split('\n\n').find((record) => record.startsWith(`worktree ${realpathSync(dirname(path))}/`) && record.split('\n')[0].endsWith(`/${path.split('/').pop()}`));

test('given a registration at card 44\'s workspace path on branch rigger-44, whose directory is gone and which is locked with the reason git worktree add writes, an attempt at card 44 makes the workspace', async (t) => {
  const here = staleLockWorld(t, 'rigger-44', ADDING);
  const made = await here.make(44);
  assert.equal(branchOf(made.path), 'rigger-44');
  assert.equal(realpathSync(made.path), realpathSync(here.path));
});

test('given a registration at card 44\'s workspace path on branch rigger-44, whose directory is gone and which is locked with any other reason, an attempt at card 44 fails naming the path and the reason', async (t) => {
  const here = staleLockWorld(t, 'rigger-44', 'kept by a person');
  const failure = await refusedNaming(here.make(44), here.path);
  assert.ok(failure.message.includes('kept by a person'), failure.message);
});

test('given a registration at card 44\'s workspace path on branch rigger-44, whose directory is gone and which is locked with another reason, after the attempt fails, the registration and its lock are still listed by git worktree list --porcelain', async (t) => {
  const here = staleLockWorld(t, 'rigger-44', 'kept by a person');
  const before = listedAt(here.repository, here.path);
  assert.ok(before?.includes('\nlocked kept by a person'), before);
  await here.make(44).catch(() => {});
  assert.equal(listedAt(here.repository, here.path), before);
});

test('given a registration at card 44\'s workspace path on a branch other than rigger-44, whose directory is gone and which is locked with the reason git worktree add writes, an attempt at card 44 fails naming the path, and the registration is still listed afterwards', async (t) => {
  const here = staleLockWorld(t, 'owner-44', ADDING);
  const before = listedAt(here.repository, here.path);
  assert.ok(before?.includes(`\nlocked ${ADDING}`), before);
  await refusedNaming(here.make(44), here.path);
  assert.equal(listedAt(here.repository, here.path), before);
});

test('given a live worktree at card 44\'s workspace path on rigger-44, locked with the reason git worktree add writes, an attempt at card 44 leaves the lock in place', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-44');
  mkdirSync(here.root, { recursive: true });
  worktreeAt(here.repository, path, 'rigger-44', '--lock', '--reason', ADDING);
  await here.make(44).catch(() => {});
  assert.ok(listedAt(here.repository, path)?.includes(`\nlocked ${ADDING}`), worktreeList(here.repository));
});

/**
 * Card 42's own earlier workspace on rigger-42, made by L1, holding a directory `ro` whose mode is
 * `mode`, read-only and searchable unless the caller names another, with a read-only file in it.
 */
async function readOnlyWorld(t, mode = 0o555) {
  const here = world(t);
  const first = await here.make(42);
  mkdirSync(join(first.path, 'ro'));
  writeFileSync(join(first.path, 'ro', 'file'), 'read-only\n');
  chmodSync(join(first.path, 'ro', 'file'), 0o444);
  chmodSync(join(first.path, 'ro'), mode);
  return { ...here, path: first.path };
}

// proves R-WORK-13
test('given card 42\'s own earlier workspace on rigger-42 holding a read-only directory with a read-only file in it, an attempt at card 42 makes a fresh workspace there holding no such file', async (t) => {
  const here = await readOnlyWorld(t);
  const made = await here.make(42);
  assert.equal(branchOf(made.path), 'rigger-42');
  assert.equal(existsSync(join(made.path, 'ro')), false);
});

// proves R-WORK-13
test('given card 42\'s own earlier workspace on rigger-42 holding a directory of mode 0444 with a read-only file in it, an attempt at card 42 makes a fresh workspace there holding no such directory', async (t) => {
  const here = await readOnlyWorld(t, 0o444);
  const made = await here.make(42);
  assert.equal(branchOf(made.path), 'rigger-42');
  assert.equal(existsSync(join(made.path, 'ro')), false);
});

// proves R-WORK-13
test('given card 42\'s own earlier workspace on rigger-42 holding a directory of mode 0000, an attempt at card 42 makes a fresh workspace there holding no such directory', async (t) => {
  const here = await readOnlyWorld(t, 0o000);
  const made = await here.make(42);
  assert.equal(branchOf(made.path), 'rigger-42');
  assert.equal(existsSync(join(made.path, 'ro')), false);
});

test('given card 42\'s own earlier workspace holding a hard link to a read-only file outside it, after an attempt at card 42 replaces the workspace, the file outside keeps its mode bits', async (t) => {
  const here = world(t);
  const first = await here.make(42);
  const outside = join(here.directory, 'outside');
  writeFileSync(outside, 'not the workspace\'s\n');
  chmodSync(outside, 0o444);
  linkSync(outside, join(first.path, 'linked'));
  const mode = statSync(outside).mode;
  const made = await here.make(42);
  assert.equal(existsSync(join(made.path, 'linked')), false);
  assert.equal(statSync(outside).mode, mode);
});

test('given a removal that still fails after L1 made the card\'s workspace writable, forced by the test, the attempt fails naming the path and git\'s error, and the directory remains', async (t) => {
  const here = await readOnlyWorld(t);
  const stand = scratch(t);
  const refusal = 'fatal: the stand-in refuses to remove this worktree';
  // The stand-in records whether the read-only directory was writable and searchable when L1 asked
  // for the removal, which is what removing the file in it needs.
  fixture(stand, 'git', [
    'if [ "$1 $2" = "worktree remove" ]; then',
    '  for last; do :; done',
    '  if [ -w "$last/ro" ] && [ -x "$last/ro" ]; then echo writable > "$here/seen"; else echo read-only > "$here/seen"; fi',
    `  echo '${refusal}' >&2`,
    '  exit 128',
    'fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));
  const failure = await withFirstOnPath(stand, () => refusedNaming(here.make(42), here.path));
  assert.ok(failure.message.includes(refusal), failure.message);
  assert.equal(readFileSync(join(stand, 'seen'), 'utf8'), 'writable\n');
  assert.equal(readFileSync(join(here.path, 'ro', 'file'), 'utf8'), 'read-only\n');
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

test('given a sink that refuses workspace.made, makeWorkspace rejects with a code other than WORKSPACE_NOT_MADE, and the failure names workspace.made as unrecorded', async (t) => {
  const here = world(t);
  let failure;
  await here.make(42, { sink: refusing(here.sink, 'workspace.made') }).then(() => assert.fail('the attempt settled'), (thrown) => { failure = thrown; });
  assert.notEqual(failure.code, WORKSPACE_NOT_MADE, failure.stack);
  assert.equal(typeof failure.code, 'string', failure.stack);
  assert.match(failure.message, /workspace\.made/);
  assert.match(failure.message, /unrecorded/);
});

test('given a sink that refuses workspace.removed, makeWorkspace rejects with a code other than WORKSPACE_NOT_MADE, and the failure names workspace.removed as unrecorded', async (t) => {
  const here = world(t);
  await here.make(42);
  let failure;
  await here.make(42, { sink: refusing(here.sink, 'workspace.removed') }).then(() => assert.fail('the attempt settled'), (thrown) => { failure = thrown; });
  assert.notEqual(failure.code, WORKSPACE_NOT_MADE, failure.stack);
  assert.equal(typeof failure.code, 'string', failure.stack);
  assert.match(failure.message, /workspace\.removed/);
  assert.match(failure.message, /unrecorded/);
});

/**
 * A world whose card 42 workspace path, `root/rigger-42`, holds card 42's own linked worktree on
 * `rigger-42`, with a linked worktree of the repository on `owner-work` registered inside it at
 * `rigger-42/engine`, holding an uncommitted file, which L1 is handed as the repository.
 */
function nestedHandedWorld(t) {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(here.root, { recursive: true });
  worktreeAt(here.repository, path, 'rigger-42');
  const handed = worktreeAt(here.repository, join(path, 'engine'), 'owner-work');
  writeFileSync(join(handed, 'uncommitted'), 'the engine\'s own work\n');
  const state = () => ({ files: contents(handed), worktrees: worktreeList(here.repository) });
  return { ...here, path, handed, state, attempt: () => here.make(42, { repository: handed }) };
}

/** The real path of what git answers for `args` of `rev-parse --path-format=absolute`, asked in `path`. */
const revParsed = (path, ...args) => realpathSync(gitIn(path, 'rev-parse', '--path-format=absolute', ...args).trim());

// proves R-WORK-13, R-WORK-17
test('given card 42\'s own linked worktree on rigger-42 at its workspace path, with L1 handed as the repository a linked worktree registered at rigger-42/engine holding an uncommitted file, an attempt at card 42 fails naming the path, though the directory there meets every other condition', async (t) => {
  const here = nestedHandedWorld(t);
  const common = revParsed(here.repository, '--git-common-dir');
  // R-WORK-14 holds: the directory is a worktree of the repository, and not its main worktree.
  assert.equal(revParsed(here.path, '--show-toplevel'), realpathSync(here.path));
  assert.equal(revParsed(here.path, '--git-common-dir'), common);
  assert.notEqual(revParsed(here.path, '--git-dir'), common);
  // R-WORK-15 holds: it holds exactly card 42's line of work.
  assert.equal(branchOf(here.path), 'rigger-42');
  // R-WORK-16 holds: the handed worktree's own top level is the engine, not the card's directory.
  assert.equal(revParsed(here.handed, '--show-toplevel'), realpathSync(here.handed));
  assert.notEqual(revParsed(here.handed, '--show-toplevel'), realpathSync(here.path));
  // R-WORK-17 fails: another worktree of the repository, the handed one, lies inside it.
  assert.ok(worktreeList(here.repository).includes(`worktree ${realpathSync(here.handed)}\n`), worktreeList(here.repository));
  await refusedNaming(here.attempt(), here.path, 'WORKSPACE_REFUSED');
  // The failure is L1's refusal, not what is left once the engine went with the card's directory.
  assert.equal(existsSync(join(here.handed, 'uncommitted')), true);
});

// proves R-WORK-13, R-WORK-17
test('given L1 handed a linked worktree registered at rigger-42/engine inside card 42\'s own workspace, after the attempt at card 42 fails, its uncommitted file is byte-identical, and git worktree list --porcelain prints the same as before', async (t) => {
  const here = nestedHandedWorld(t);
  const before = here.state();
  await here.attempt().catch(() => {});
  assert.deepEqual(here.state(), before);
  assert.equal(readFileSync(join(here.handed, 'uncommitted'), 'utf8'), 'the engine\'s own work\n');
});

/** The mode bits of every file, directory and link under `directory`, by its path relative to it. */
function modes(directory) {
  const found = {};
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    found[relative(directory, path)] = lstatSync(path).mode;
  }
  return found;
}

/**
 * A world with the main working tree as the repository, card 42's own linked worktree on
 * `rigger-42` at its workspace path, and an owner's linked worktree on `owner` registered inside
 * it at `rigger-42/<at>`, holding an uncommitted file, a read-only one, and a read-only directory.
 */
function nestedOwnerWorld(t, at = 'owner') {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(here.root, { recursive: true });
  worktreeAt(here.repository, path, 'rigger-42');
  mkdirSync(dirname(join(path, at)), { recursive: true });
  const owner = worktreeAt(here.repository, join(path, at), 'owner');
  writeFileSync(join(owner, 'uncommitted'), 'the owner\'s work\n');
  writeFileSync(join(owner, 'read-only'), 'the owner\'s\n');
  chmodSync(join(owner, 'read-only'), 0o444);
  mkdirSync(join(owner, 'read-only-directory'));
  chmodSync(join(owner, 'read-only-directory'), 0o555);
  const state = () => ({ files: contents(owner), worktrees: worktreeList(here.repository) });
  return { ...here, path, owner, state };
}

// proves R-WORK-13, R-WORK-17
test('given the main worktree as the repository, and an owner\'s linked worktree registered at rigger-42/owner inside card 42\'s own workspace on rigger-42, holding an uncommitted file, an attempt at card 42 fails naming the path', async (t) => {
  const here = nestedOwnerWorld(t);
  await refusedNaming(here.make(42), here.path, 'WORKSPACE_REFUSED');
});

// proves R-WORK-13, R-WORK-17
test('given an owner\'s linked worktree registered at rigger-42/owner inside card 42\'s own workspace, after the attempt at card 42 fails, its uncommitted file is byte-identical, and git worktree list --porcelain prints the same as before', async (t) => {
  const here = nestedOwnerWorld(t);
  const before = here.state();
  await here.make(42).catch(() => {});
  assert.deepEqual(here.state(), before);
  assert.equal(readFileSync(join(here.owner, 'uncommitted'), 'utf8'), 'the owner\'s work\n');
});

// proves R-WORK-13, R-WORK-17
test('given an owner\'s linked worktree registered at rigger-42/owner inside card 42\'s own workspace, holding a read-only file, after the attempt at card 42 fails, that file\'s mode bits are unchanged, and so are those of every file in card 42\'s workspace', async (t) => {
  const here = nestedOwnerWorld(t);
  const mode = statSync(join(here.owner, 'read-only')).mode;
  const before = modes(here.path);
  await here.make(42).catch(() => {});
  assert.equal(statSync(join(here.owner, 'read-only')).mode, mode);
  assert.deepEqual(modes(here.path), before);
});

// proves R-WORK-13, R-WORK-17
test('given a worktree of the repository registered two directories deep inside card 42\'s own workspace, at rigger-42/a/b, an attempt at card 42 fails naming the path', async (t) => {
  const here = nestedOwnerWorld(t, join('a', 'b'));
  await refusedNaming(here.make(42), here.path, 'WORKSPACE_REFUSED');
  assert.equal(existsSync(join(here.owner, 'uncommitted')), true);
});

// proves R-WORK-13
test('given card 42\'s own workspace on rigger-42 holding a plain directory that is no worktree, node_modules, and no nested worktree, an attempt at card 42 replaces the workspace', async (t) => {
  const here = world(t);
  const first = await here.make(42);
  mkdirSync(join(first.path, 'node_modules', 'left'), { recursive: true });
  writeFileSync(join(first.path, 'node_modules', 'left', 'index.js'), 'an earlier attempt\'s install\n');
  const made = await here.make(42);
  assert.equal(branchOf(made.path), 'rigger-42');
  assert.equal(existsSync(join(made.path, 'node_modules')), false);
});

/**
 * Card 42's own workspace on rigger-42, holding a symbolic link `owner` that points at an owner's
 * linked worktree elsewhere, on `owner`, holding an uncommitted file.
 */
async function linkedOwnerWorld(t) {
  const here = world(t);
  const first = await here.make(42);
  const owner = worktreeAt(here.repository, join(here.directory, 'elsewhere'), 'owner');
  writeFileSync(join(owner, 'uncommitted'), 'the owner\'s work\n');
  symlinkSync(owner, join(first.path, 'owner'));
  return { ...here, path: first.path, owner };
}

// proves R-WORK-13
test('given card 42\'s own workspace on rigger-42 holding a symbolic link that points at an owner\'s linked worktree elsewhere, holding an uncommitted file, an attempt at card 42 replaces card 42\'s workspace', async (t) => {
  const here = await linkedOwnerWorld(t);
  const made = await here.make(42);
  assert.equal(branchOf(made.path), 'rigger-42');
  assert.equal(existsSync(join(made.path, 'owner')), false);
});

test('given card 42\'s own workspace holding a symbolic link to an owner\'s linked worktree elsewhere, after the attempt at card 42, the owner\'s worktree still exists, its uncommitted file is byte-identical, and git worktree list --porcelain still lists it', async (t) => {
  const here = await linkedOwnerWorld(t);
  await here.make(42);
  assert.equal(branchOf(here.owner), 'owner');
  assert.equal(readFileSync(join(here.owner, 'uncommitted'), 'utf8'), 'the owner\'s work\n');
  assert.ok(worktreeList(here.repository).includes(`worktree ${realpathSync(here.owner)}\n`), worktreeList(here.repository));
});

// proves R-WORK-13
test('given a registration inside card 42\'s own workspace whose directory is gone, which git worktree list --porcelain marks prunable, an attempt at card 42 replaces the workspace', async (t) => {
  const here = world(t);
  const first = await here.make(42);
  const gone = worktreeAt(here.repository, join(first.path, 'gone'), 'gone');
  rmSync(gone, { recursive: true, force: true });
  const listed = worktreeList(here.repository).split('\n\n').find((record) => record.startsWith(`worktree ${realpathSync(first.path)}/gone\n`));
  assert.match(listed ?? '', /\nprunable /, worktreeList(here.repository));
  const made = await here.make(42);
  assert.equal(branchOf(made.path), 'rigger-42');
  assert.equal(realpathSync(made.path), realpathSync(first.path));
});

/** Asserts that `attempt` rejects with `EVENT_REFUSED`, and hands back its failure. */
async function refusedEvent(attempt) {
  let failure;
  await attempt.then(() => assert.fail('the attempt settled'), (thrown) => { failure = thrown; });
  assert.equal(failure.code, EVENT_REFUSED, failure.stack);
  assert.match(failure.message, /unrecorded/);
  return failure;
}

test('given a sink that refuses workspace.failed, making card 42\'s workspace rejects with the code a refused workspace event gives, and the failure names workspace.failed as unrecorded and the workspace failure\'s own reason', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  const failure = await refusedEvent(here.make(42, { sink: refusing(here.sink, 'workspace.failed') }));
  assert.match(failure.message, /workspace\.failed/);
  assert.ok(failure.message.includes(`${path} holds something that is not a workspace of the repository`), failure.message);
});

test('given a git stand-in that leaves a child during each git call, and a sink that refuses the L0 kill event for that child, making card 42\'s workspace rejects with the code a refused workspace event gives, and the failure names the kill event as unrecorded', async (t) => {
  const here = world(t);
  const stand = scratch(t);
  writeFileSync(join(stand, 'hold'), '');
  gitLeavingChild(stand);
  const failure = await withFirstOnPath(stand, () => refusedEvent(here.make(42, { sink: refusing(here.sink, 'survivor.killed') })));
  assert.match(failure.message, /survivor\.killed/);
  assert.ok(failure.unrecorded.some(({ event, pid }) => event === 'survivor.killed' && childrenIn(stand).includes(pid)), failure.message);
});

test('given a sink that refuses fetch.retried, making card 42\'s workspace rejects with the code a refused workspace event gives, and the failure names fetch.retried as unrecorded', async (t) => {
  const here = world(t);
  const stand = scratch(t);
  gitRacing(stand, 1);
  const failure = await withFirstOnPath(stand, () => refusedEvent(here.make(42, { sink: refusing(here.sink, 'fetch.retried') })));
  assert.equal(existsSync(join(stand, 'raced')), true);
  assert.match(failure.message, /fetch\.retried/);
  assert.deepEqual(failure.unrecorded.map(({ event }) => event), ['fetch.retried']);
});

// proves R-WORK-13, R-WORK-17
test('given a worktree of the repository registered at rigger-42/a/b inside card 42\'s own workspace, with a of mode 0000, an attempt at card 42 fails naming the path, and afterwards a\'s mode, the worktree\'s uncommitted file and git worktree list --porcelain are unchanged', async (t) => {
  const here = nestedOwnerWorld(t, join('a', 'b'));
  const between = join(here.path, 'a');
  chmodSync(between, 0o000);
  const before = { mode: statSync(between).mode, worktrees: worktreeList(here.repository) };
  const failure = await here.make(42).then(() => undefined, (thrown) => thrown);
  const after = existsSync(between) ? { mode: statSync(between).mode, worktrees: worktreeList(here.repository) } : 'gone';
  // Search permission back, so the test can read what the worktree holds.
  if (existsSync(between)) chmodSync(between, 0o755);
  assert.ok(failure !== undefined, 'the attempt made a workspace');
  assert.equal(failure.code, WORKSPACE_NOT_MADE, failure.stack);
  assert.ok(failure.message.includes(here.path), failure.message);
  assert.deepEqual(after, before);
  assert.equal(readFileSync(join(here.owner, 'uncommitted'), 'utf8'), 'the owner\'s work\n');
});

// proves R-WORK-13, R-WORK-17
test('given an owner\'s worktree registered inside card 42\'s own workspace through a spelling of its path in another case, on a volume that folds case, an attempt at card 42 fails naming the path, and afterwards the worktree\'s uncommitted file and git worktree list --porcelain are unchanged', async (t) => {
  const here = world(t);
  const first = await here.make(42);
  const variant = join(here.directory, 'Worktrees');
  if (!existsSync(variant)) {
    t.skip('this volume does not fold case, so no spelling in another case names card 42\'s workspace');
    return;
  }
  const owner = worktreeAt(here.repository, join(variant, 'rigger-42', 'owner'), 'owner');
  writeFileSync(join(owner, 'uncommitted'), 'the owner\'s work\n');
  // Git lists the worktree under the spelling it was added through, not the card's.
  assert.ok(worktreeList(here.repository).includes(`worktree ${join(realpathSync(here.directory), 'Worktrees', 'rigger-42', 'owner')}\n`), worktreeList(here.repository));
  const before = { files: contents(owner), worktrees: worktreeList(here.repository) };
  await refusedNaming(here.make(42), first.path, 'WORKSPACE_REFUSED');
  assert.deepEqual({ files: contents(owner), worktrees: worktreeList(here.repository) }, before);
  assert.equal(readFileSync(join(owner, 'uncommitted'), 'utf8'), 'the owner\'s work\n');
});

/**
 * Makes the root's directory on disk as `Worktrees`, so `here.root`, `…/worktrees`, names it in
 * another case, and hands back its path on disk where the volume folds case: where that other
 * spelling reaches the directory, and the directory lists it only as `Worktrees`. Where the volume
 * does not fold case, it skips the test, saying so, and hands back nothing.
 */
function foldedRoot(t, here) {
  const disk = join(here.directory, 'Worktrees');
  mkdirSync(disk);
  const names = readdirSync(here.directory);
  if (existsSync(here.root) && names.includes('Worktrees') && !names.includes('worktrees')) return disk;
  t.skip('this volume does not fold case, so no spelling in another case names the root');
  return undefined;
}

// proves R-WORK-3, R-WORK-10
test('given a root spelled in another case than its directory on disk, on a volume that folds case, a second make of card 42 under that same spelling removes the first workspace and makes card 42\'s workspace again, on rigger-42, at the main line\'s commit', async (t) => {
  const here = world(t);
  const disk = foldedRoot(t, here);
  if (disk === undefined) return;
  const first = await here.make(42);
  writeFileSync(join(first.path, 'left-behind'), 'the first attempt\'s work\n');
  const pushed = here.push('between the attempts');
  const second = await here.make(42);
  assert.equal(realpathSync.native(second.path), join(realpathSync.native(disk), 'rigger-42'));
  assert.equal(existsSync(join(second.path, 'left-behind')), false);
  assert.equal(branchOf(second.path), 'rigger-42');
  assert.equal(headOf(second.path), pushed);
  assert.equal(l1(here.events(), 42, 'workspace.removed').length, 1);
});

// proves R-WORK-3, R-WORK-10
test('given a root whose directory on disk is spelled Worktrees, on a volume that folds case, a first make of card 42 under the spelling worktrees and a second under WORKTREES replace the workspace, on rigger-42, at the main line\'s commit', async (t) => {
  const here = world(t);
  const disk = foldedRoot(t, here);
  if (disk === undefined) return;
  const first = await here.make(42);
  writeFileSync(join(first.path, 'left-behind'), 'the first attempt\'s work\n');
  const pushed = here.push('between the attempts');
  const second = await here.make(42, { root: join(here.directory, 'WORKTREES') });
  assert.equal(realpathSync.native(second.path), join(realpathSync.native(disk), 'rigger-42'));
  assert.equal(existsSync(join(second.path, 'left-behind')), false);
  assert.equal(branchOf(second.path), 'rigger-42');
  assert.equal(headOf(second.path), pushed);
  assert.equal(l1(here.events(), 42, 'workspace.removed').length, 1);
});

/**
 * What a refusal must leave unchanged in `here`'s repository and under `disk`, the root on disk:
 * every ref git holds, `refs/remotes` included, every object, git worktree list --porcelain, and,
 * as `held` reads them, everything under the repository's working tree, its `.git` included, and
 * under the root.
 */
function untouched(here, disk) {
  return {
    refs: gitIn(here.repository, 'for-each-ref'),
    objects: gitIn(here.repository, 'cat-file', '--batch-all-objects', '--batch-check'),
    worktrees: worktreeList(here.repository),
    repository: held(here.repository),
    root: held(disk),
  };
}

/**
 * `directory` itself and everything under it, each as its path relative to `directory`, its mode
 * bits and type as `lstat` reads them, and, for a file, the SHA-256 digest of its bytes, or, for a
 * symbolic link, where it points. A digest rather than the bytes keeps a failing comparison short.
 */
function held(directory) {
  const entry = (path) => {
    const stat = lstatSync(path);
    const what = stat.isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : stat.isSymbolicLink() ? `-> ${readlinkSync(path)}` : '';
    return `${stat.mode.toString(8)} ${what}`;
  };
  const found = { '.': entry(directory) };
  for (const name of readdirSync(directory, { recursive: true })) found[name] = entry(join(directory, name));
  return found;
}

// proves R-WORK-13, R-WORK-14
test('given a root spelled in another case than its directory on disk, on a volume that folds case, and a plain directory holding a file at card 42\'s workspace path, an attempt at card 42 fails naming the path, and afterwards every ref, every object, git worktree list --porcelain and the files of the repository and the root are unchanged', async (t) => {
  const here = world(t);
  const disk = foldedRoot(t, here);
  if (disk === undefined) return;
  mkdirSync(join(disk, 'rigger-42'));
  writeFileSync(join(disk, 'rigger-42', 'kept'), 'not Rigger\'s\n');
  here.push('the main line moves on');
  const before = untouched(here, disk);
  await refusedNaming(here.make(42), join(here.root, 'rigger-42'), 'WORKSPACE_REFUSED');
  assert.deepEqual(untouched(here, disk), before);
  assert.equal(readFileSync(join(disk, 'rigger-42', 'kept'), 'utf8'), 'not Rigger\'s\n');
});

// proves R-WORK-13, R-WORK-15
test('given a root spelled in another case than its directory on disk, on a volume that folds case, and an owner\'s linked worktree on branch owner-42 at card 42\'s workspace path holding an uncommitted file, an attempt at card 42 fails naming the path and the branch, and afterwards every ref, every object, git worktree list --porcelain and the files of the repository and the root are unchanged', async (t) => {
  const here = world(t);
  const disk = foldedRoot(t, here);
  if (disk === undefined) return;
  const owner = worktreeAt(here.repository, join(disk, 'rigger-42'), 'owner-42');
  writeFileSync(join(owner, 'uncommitted'), 'the owner\'s work\n');
  here.push('the main line moves on');
  const before = untouched(here, disk);
  const failure = await refusedNaming(here.make(42), join(here.root, 'rigger-42'), 'WORKSPACE_REFUSED');
  assert.match(failure.message, /holding the branch owner-42/);
  assert.deepEqual(untouched(here, disk), before);
  assert.equal(readFileSync(join(owner, 'uncommitted'), 'utf8'), 'the owner\'s work\n');
});

// proves R-WORK-13, R-WORK-16
test('given a root spelled in another case than its directory on disk, on a volume that folds case, and L1 handed as the repository a linked worktree on rigger-42 at card 42\'s workspace path holding an uncommitted file, an attempt at card 42 fails naming the path, and afterwards every ref, every object, git worktree list --porcelain and the files of the repository and the root are unchanged', async (t) => {
  const here = world(t);
  const disk = foldedRoot(t, here);
  if (disk === undefined) return;
  const handed = worktreeAt(here.repository, join(disk, 'rigger-42'), 'rigger-42');
  writeFileSync(join(handed, 'uncommitted'), 'the engine\'s own work\n');
  here.push('the main line moves on');
  const before = untouched(here, disk);
  const failure = await refusedNaming(here.make(42, { repository: handed }), join(here.root, 'rigger-42'), 'WORKSPACE_REFUSED');
  assert.match(failure.message, /is the worktree L1 was handed/);
  assert.deepEqual(untouched(here, disk), before);
  assert.equal(readFileSync(join(handed, 'uncommitted'), 'utf8'), 'the engine\'s own work\n');
});

/**
 * A registration made through the root's spelling on disk at card 44's workspace path, on
 * rigger-44 and locked with `reason`, whose directory is gone, with the main line moved on since.
 */
function foldedStaleLock(t, reason) {
  const here = world(t);
  const disk = foldedRoot(t, here);
  if (disk === undefined) return undefined;
  worktreeAt(here.repository, join(disk, 'rigger-44'), 'rigger-44', '--lock', '--reason', reason);
  rmSync(join(disk, 'rigger-44'), { recursive: true, force: true });
  return { ...here, disk, pushed: here.push('the main line moves on') };
}

test('given a root spelled in another case than its directory on disk, on a volume that folds case, and a registration made through the disk\'s spelling at card 44\'s workspace path on rigger-44, whose directory is gone and which is locked with the reason git worktree add writes, an attempt at card 44 makes the workspace on rigger-44 at the main line\'s commit', async (t) => {
  const here = foldedStaleLock(t, ADDING);
  if (here === undefined) return;
  const made = await here.make(44);
  assert.equal(realpathSync.native(made.path), join(realpathSync.native(here.disk), 'rigger-44'));
  assert.equal(branchOf(made.path), 'rigger-44');
  assert.equal(headOf(made.path), here.pushed);
  assert.doesNotMatch(worktreeList(here.repository), /locked/);
});

test('given a root spelled in another case than its directory on disk, on a volume that folds case, and a registration made through the disk\'s spelling at card 44\'s workspace path on rigger-44, whose directory is gone and which is locked by a person, an attempt at card 44 fails naming the path and the reason, and afterwards every ref, every object, git worktree list --porcelain and the files of the repository and the root are unchanged', async (t) => {
  const here = foldedStaleLock(t, 'kept by a person');
  if (here === undefined) return;
  const before = untouched(here, here.disk);
  const failure = await refusedNaming(here.make(44), join(here.root, 'rigger-44'));
  assert.match(failure.message, /kept by a person/);
  assert.deepEqual(untouched(here, here.disk), before);
});

test('L1\'s workspace make for card 42 answers scratch, the absolute path <root>/scratch/rigger-42, beside path, and makes nothing there', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  assert.equal(made.scratch, join(here.root, 'scratch', 'rigger-42'));
  assert.equal(made.path, join(here.root, 'rigger-42'));
  assert.equal(existsSync(join(here.root, 'scratch')), false, 'the make created the scratch base');
});

test('L1\'s workspace make answers repository, the path of the repository it made from, beside scratch', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  assert.equal(made.repository, here.repository);
});

// proves R-WORK-35
test('removing a merged card clears its workspace, judge and scratch directories while leaving another root entry', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  const head = here.push('head for a judge');
  const judge = await workspaceRemoval.makeJudgeDirectory({ root: here.root, topic: 'rigger-{number}', card: 42, role: 'reviewer', head, repository: here.repository, sink: here.sink });
  const scratch = await workspaceRemoval.makeScratch({ base: made.scratch, role: 'reviewer', card: 42, repository: here.repository, sink: here.sink });
  const other = join(here.root, 'unrelated');
  mkdirSync(other);
  const before = here.events().length;

  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });

  for (const path of [made.path, judge.path, scratch, join(here.root, 'judges', 'rigger-42'), made.scratch]) assert.equal(existsSync(path), false, path);
  assert.deepEqual(readdirSync(here.root), ['judges', 'scratch', 'unrelated']);
  assert.equal(worktreeList(here.repository).includes(made.path), false);
  assert.equal(worktreeList(here.repository).includes(judge.main), false);
  assert.equal(worktreeList(here.repository).includes(judge.head), false);
  assert.equal(gitIn(here.repository, 'show-ref', '--verify', 'refs/heads/rigger-42').trim().length > 0, true);
  const events = here.events().slice(before).filter(({ layer }) => layer === 'L1');
  assert.deepEqual(events.map(({ event, path, role }) => ({ event, path, role })), [
    { event: 'workspace.removed', path: made.path, role: undefined },
    { event: 'workspace.removed', path: judge.path, role: 'reviewer' },
    { event: 'workspace.removed', path: join(here.root, 'judges', 'rigger-42'), role: undefined },
    { event: 'workspace.removed', path: scratch, role: 'reviewer' },
    { event: 'workspace.removed', path: made.scratch, role: undefined },
  ]);
});

// proves R-WORK-35
test('a person-locked card worktree is left with its lock and blocks the Done move', async (t) => {
  const here = world(t);
  mkdirSync(here.root);
  const path = worktreeAt(here.repository, join(here.root, 'rigger-42'), 'rigger-42', '--lock', '--reason', 'kept by a person');
  const before = worktreeList(here.repository);

  await assert.rejects(workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink }), /could not remove all directories/);

  assert.equal(worktreeList(here.repository), before);
  assert.equal(existsSync(path), true);
  assert.deepEqual(here.events().filter(({ layer, event }) => layer === 'L1' && event === 'workspace.left').map(({ path: left, reason }) => ({ left, reason: reason.includes('kept by a person') })), [{ left: path, reason: true }]);
});

// proves R-WORK-35
test('a card workspace already gone has its stale unlocked registration pruned', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  rmSync(made.path, { recursive: true });
  assert.equal(worktreeList(here.repository).includes(made.path), true);

  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });

  assert.equal(worktreeList(here.repository).includes(made.path), false);
  assert.deepEqual(here.events().filter(({ layer, event }) => layer === 'L1' && event === 'workspace.removed'), []);
});

// proves R-WORK-35
test('a person-locked judge worktree is left with its lock and blocks the Done move', async (t) => {
  const here = world(t);
  const head = here.push('head for a judge');
  const judge = await workspaceRemoval.makeJudgeDirectory({ root: here.root, topic: 'rigger-{number}', card: 42, role: 'reviewer', head, repository: here.repository, sink: here.sink });
  lockWorktreeAt(here.repository, judge.main, 'kept by a person');
  const before = worktreeList(here.repository);

  await assert.rejects(workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink }), /could not remove all directories/);

  assert.equal(worktreeList(here.repository), before);
  assert.equal(existsSync(judge.path), true);
  assert.ok(here.events().some(({ layer, event, path, role }) => layer === 'L1' && event === 'workspace.left' && path === judge.path && role === 'reviewer'));
});

// proves R-WORK-35
test('a second removal pass changes nothing and records no removal event', async (t) => {
  const here = world(t);
  await here.make(42);
  const remove = () => workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });
  await remove();
  const afterFirst = { entries: readdirSync(here.root), list: worktreeList(here.repository), events: here.events() };

  await remove();

  assert.deepEqual({ entries: readdirSync(here.root), list: worktreeList(here.repository), events: here.events() }, afterFirst);
});

// proves R-WORK-35
test('a card with no directories can be removed without an event or a failure', async (t) => {
  const here = world(t);

  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });

  assert.equal(existsSync(here.root), false);
  assert.deepEqual(here.events(), []);
});

// proves R-WORK-35
test('replace-rule refusals leave workspace, judge and scratch paths named without failing removal', async (t) => {
  const here = world(t);
  const workspace = join(here.root, 'rigger-42');
  const judge = join(here.root, 'judges', 'rigger-42', 'reviewer');
  const scratch = join(here.root, 'scratch', 'rigger-42', 'reviewer');
  const outside = join(here.directory, 'outside');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(dirname(judge), { recursive: true });
  mkdirSync(dirname(scratch), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'kept'), 'outside\n');
  symlinkSync(outside, judge);
  symlinkSync(outside, scratch);

  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });

  assert.equal(existsSync(workspace), true);
  assert.equal(readlinkSync(judge), outside);
  assert.equal(readlinkSync(scratch), outside);
  assert.equal(readFileSync(join(outside, 'kept'), 'utf8'), 'outside\n');
  const left = here.events().filter(({ layer, event }) => layer === 'L1' && event === 'workspace.left');
  assert.deepEqual(left.map(({ path, role }) => ({ path, role })), [
    { path: workspace, role: undefined },
    { path: judge, role: 'reviewer' },
    { path: dirname(judge), role: undefined },
    { path: scratch, role: 'reviewer' },
    { path: dirname(scratch), role: undefined },
  ]);
  assert.ok(left.every(({ reason }) => typeof reason === 'string' && reason.length > 0));
  assert.equal(here.events().some(({ layer, event }) => layer === 'L1' && event === 'workspace.removed'), false);
});

// proves R-WORK-35
test('an unrecordable removal event rejects as EVENT_REFUSED and a later pass succeeds', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  const refusing = { emitter: (context) => {
    const emitter = here.sink.emitter(context);
    return { emit: (event, fields) => {
      if (context.layer === 'L1' && event === 'workspace.removed') throw new Error('the record is full');
      emitter.emit(event, fields);
    } };
  } };

  await assert.rejects(workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: refusing }), (failure) => {
    assert.equal(failure.code, EVENT_REFUSED);
    assert.deepEqual(failure.unrecorded.map(({ event, path }) => ({ event, path })), [{ event: 'workspace.removed', path: made.path }]);
    return true;
  });
  assert.equal(existsSync(made.path), false);

  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });
  assert.equal(worktreeList(here.repository).includes(made.path), false);
});

// proves R-WORK-35
test('a git removal that fails partway leaves the path named and a later pass removes it', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  writeFileSync(join(made.path, 'untracked'), 'work in progress\n');
  const stand = scratch(t);
  fixture(stand, 'git', [
    'if [ "$1" = worktree ] && [ "$2" = remove ]; then',
    '  for last do :; done',
    '  /bin/rm -f "$last/untracked"',
    '  echo "git removal stopped after one file" >&2',
    '  exit 1',
    'fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));

  await assert.rejects(withFirstOnPath(stand, () => workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink })), /could not remove all directories/);
  assert.equal(existsSync(join(made.path, 'untracked')), false);
  assert.equal(existsSync(made.path), true);
  assert.ok(here.events().some(({ layer, event, path }) => layer === 'L1' && event === 'workspace.left' && path === made.path));

  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });
  assert.equal(existsSync(made.path), false);
  assert.equal(worktreeList(here.repository).includes(made.path), false);
});

// proves R-WORK-35
test('a merged card workspace is removed with uncommitted files and local commits', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  gitIn(made.path, 'commit', '--quiet', '--allow-empty', '-m', 'local work');
  const local = gitIn(made.path, 'rev-parse', 'HEAD').trim();
  writeFileSync(join(made.path, 'uncommitted'), 'not on the forge\n');

  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });

  assert.equal(existsSync(made.path), false);
  assert.equal(gitIn(here.repository, 'rev-parse', 'refs/heads/rigger-42').trim(), local);
});

// proves R-WORK-35
test('a workspace path linked to its card worktree removes both the worktree and the link', async (t) => {
  const here = world(t);
  mkdirSync(here.root);
  const path = join(here.root, 'rigger-42');
  const tree = worktreeAt(here.repository, join(here.directory, 'linked-worktree'), 'rigger-42');
  symlinkSync(tree, path);

  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });

  assert.equal(existsSync(path), false);
  assert.equal(existsSync(tree), false);
  assert.equal(worktreeList(here.repository).includes(tree), false);
  assert.deepEqual(here.events().filter(({ layer, event }) => layer === 'L1' && event === 'workspace.removed').map(({ path: removed }) => removed), [tree]);
});

// proves R-WORK-35
test('a gone card worktree with a person lock keeps its registration and blocks Done', async (t) => {
  const here = staleLockWorld(t, 'rigger-44', 'kept by a person');
  const before = worktreeList(here.repository);

  await assert.rejects(workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 44, repository: here.repository, sink: here.sink }), /could not remove all directories/);

  assert.equal(existsSync(here.path), false);
  assert.equal(worktreeList(here.repository), before);
  assert.ok(here.events().some(({ layer, event, path }) => layer === 'L1' && event === 'workspace.left' && path === here.path));
});

// proves R-WORK-35
test('gone judge worktrees are pruned and their empty topic directory is removed', async (t) => {
  const here = world(t);
  const head = here.push('head for a judge');
  const judge = await workspaceRemoval.makeJudgeDirectory({ root: here.root, topic: 'rigger-{number}', card: 42, role: 'reviewer', head, repository: here.repository, sink: here.sink });
  rmSync(judge.path, { recursive: true });
  assert.equal(worktreeList(here.repository).includes(judge.main), true);

  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });

  assert.equal(existsSync(dirname(judge.path)), false);
  assert.equal(worktreeList(here.repository).includes(judge.main), false);
  assert.equal(worktreeList(here.repository).includes(judge.head), false);
});

// proves R-WORK-35
test('a gone judge worktree with a person lock stays registered and blocks Done', async (t) => {
  const here = world(t);
  const head = here.push('head for a judge');
  const judge = await workspaceRemoval.makeJudgeDirectory({ root: here.root, topic: 'rigger-{number}', card: 42, role: 'reviewer', head, repository: here.repository, sink: here.sink });
  lockWorktreeAt(here.repository, judge.main, 'kept by a person');
  rmSync(judge.path, { recursive: true });

  await assert.rejects(workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink }), /could not remove all directories/);

  assert.match(worktreeList(here.repository), /locked kept by a person/);
  assert.ok(here.events().some(({ layer, event, path, role }) => layer === 'L1' && event === 'workspace.left' && path === judge.main && role === 'reviewer'));
});

// proves R-WORK-35
test('a gone judge worktree locked by an interrupted add is unlocked and pruned', async (t) => {
  const here = world(t);
  const head = here.push('head for a judge');
  const judge = await workspaceRemoval.makeJudgeDirectory({ root: here.root, topic: 'rigger-{number}', card: 42, role: 'reviewer', head, repository: here.repository, sink: here.sink });
  lockWorktreeAt(here.repository, judge.main, ADDING);
  rmSync(judge.path, { recursive: true });

  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });

  assert.equal(worktreeList(here.repository).includes(judge.main), false);
  assert.equal(worktreeList(here.repository).includes(judge.head), false);
});

// proves R-WORK-35
test('a topic directory or its parent reached through a symbolic link is left and named', async (t) => {
  const here = world(t);
  mkdirSync(here.root);
  const outsideJudges = join(here.directory, 'outside-judges');
  const outsideScratch = join(here.directory, 'outside-scratch');
  mkdirSync(join(outsideJudges, 'rigger-42'), { recursive: true });
  mkdirSync(outsideScratch);
  symlinkSync(outsideJudges, join(here.root, 'judges'));
  mkdirSync(join(here.root, 'scratch'));
  symlinkSync(outsideScratch, join(here.root, 'scratch', 'rigger-42'));

  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });

  assert.equal(existsSync(join(outsideJudges, 'rigger-42')), true);
  assert.equal(existsSync(outsideScratch), true);
  assert.deepEqual(here.events().filter(({ layer, event }) => layer === 'L1' && event === 'workspace.left').map(({ path }) => path), [
    join(here.root, 'judges', 'rigger-42'), join(here.root, 'scratch', 'rigger-42'),
  ]);
});

// proves R-WORK-35
test('a refused workspace.left record stops removal with the refused path unchanged', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'kept'), 'keep\n');
  const refusing = { emitter: (context) => {
    const emitter = here.sink.emitter(context);
    return { emit: (event, fields) => {
      if (context.layer === 'L1' && event === 'workspace.left') throw new Error('the record is full');
      emitter.emit(event, fields);
    } };
  } };

  await assert.rejects(workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: refusing }), (failure) => {
    assert.equal(failure.code, EVENT_REFUSED);
    assert.equal(failure.unrecorded[0].path, path);
    return true;
  });

  assert.equal(readFileSync(join(path, 'kept'), 'utf8'), 'keep\n');
});

// proves R-WORK-35
test('a failed git replace-rule check leaves the workspace named and Review until a later pull removes it', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  const built = mergedRemoval(here);
  const before = contents(made.path);
  const stand = scratch(t);
  fixture(stand, 'git', [
    'if [ "$1" = worktree ] && [ "$2" = list ] && [ ! -e "$here/failed" ]; then',
    '  : > "$here/failed"',
    '  echo "registration read failed" >&2',
    '  exit 1',
    'fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));

  await assert.rejects(withFirstOnPath(stand, () => built.loop.pull()));

  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
  assert.deepEqual(contents(made.path), before);
  assert.ok(here.events().some(({ event, path, reason }) => event === 'workspace.left' && path === made.path && reason.includes('registration read failed')));
  await built.loop.pull();
  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
  assert.equal(existsSync(made.path), false);
});

// proves R-WORK-35
test('a git replace-rule check that times out leaves Review and is retried by a later pull', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  const options = { timeout: OUTLIVED };
  const built = mergedRemoval(here, options);
  const stand = holding(t);
  fixture(stand, 'git', [
    'if [ "$1" = worktree ] && [ "$2" = list ] && [ ! -e "$here/failed" ]; then',
    '  : > "$here/failed"',
    '  exec /usr/bin/tail -f "$here/hold"',
    'fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));

  await assert.rejects(withFirstOnPath(stand, () => built.loop.pull()));

  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
  assert.equal(existsSync(made.path), true);
  assert.ok(here.events().some(({ event, path, reason }) => event === 'workspace.left' && path === made.path && /past its timeout/.test(reason)));
  options.timeout = undefined;
  await built.loop.pull();
  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
  assert.equal(existsSync(made.path), false);
});

// proves R-WORK-35
test('a filesystem replace-rule check that cannot read a topic leaves Review until a later pull retries', async (t) => {
  const here = world(t);
  const base = join(here.root, 'scratch', 'rigger-42');
  mkdirSync(join(base, 'reviewer'), { recursive: true });
  writeFileSync(join(base, 'reviewer', 'kept'), 'keep\n');
  const before = contents(base);
  const built = mergedRemoval(here);
  chmodSync(base, 0o000);
  try {
    await assert.rejects(built.loop.pull());
    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
    assert.ok(here.events().some(({ event, path, reason }) => event === 'workspace.left' && path === base && /permission denied/i.test(reason)));
  } finally {
    chmodSync(base, 0o755);
  }
  assert.deepEqual(contents(base), before);
  await built.loop.pull();
  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
  assert.equal(existsSync(base), false);
});

// proves R-WORK-35
test('a refused topic workspace.removed rejects as EVENT_REFUSED and records no false workspace.left', async (t) => {
  for (const kind of ['judges', 'scratch']) {
    const here = world(t);
    const base = join(here.root, kind, 'rigger-42');
    mkdirSync(base, { recursive: true });
    const sink = { emitter: (context) => {
      const emitter = here.sink.emitter(context);
      return { emit: (event, fields) => {
        if (context.layer === 'L1' && event === 'workspace.removed' && fields.path === base) throw new Error('topic record refused');
        emitter.emit(event, fields);
      } };
    } };

    const failure = await refusedEvent(workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink }));

    assert.equal(existsSync(base), false);
    assert.deepEqual(failure.unrecorded.map(({ event, path }) => ({ event, path })), [{ event: 'workspace.removed', path: base }]);
    assert.equal(here.events().some(({ event, path }) => event === 'workspace.left' && path === base), false);
    await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });
  }
});

// proves R-WORK-35
test('a failed git worktree recognition check keeps the merged card in Review rather than treating it as refused', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  const built = mergedRemoval(here);
  const before = contents(made.path);
  const stand = scratch(t);
  fixture(stand, 'git', [
    'if [ "$1" = -C ] && [ ! -e "$here/failed" ]; then',
    '  : > "$here/failed"',
    '  echo "worktree recognition failed" >&2',
    '  exit 1',
    'fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));

  await assert.rejects(withFirstOnPath(stand, () => built.loop.pull()));

  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
  assert.deepEqual(contents(made.path), before);
  assert.ok(here.events().some(({ event, path, reason }) => event === 'workspace.left' && path === made.path && reason.includes('worktree recognition failed')));
  await built.loop.pull();
  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
});

/** A scratch refusal keeps its complete contents and registrations and names the role path. */
async function scratchLeft(here, path) {
  const before = { files: contents(path), trees: worktreeList(here.repository) };
  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });
  assert.equal(existsSync(path), true, 'the refused scratch path was removed');
  assert.deepEqual({ files: contents(path), trees: worktreeList(here.repository) }, before);
  assert.ok(here.events().some(({ event, path: left, role, reason }) => event === 'workspace.left' && left === path && role === 'reviewer' && reason.length > 0));
  assert.equal(here.events().some(({ event, path: removed }) => event === 'workspace.removed' && removed === path), false);
}

// proves R-WORK-35
test('merged-card removal leaves a scratch directory in a checkout unchanged and names it', async (t) => {
  const here = world(t);
  const path = join(here.root, 'scratch', 'rigger-42', 'reviewer');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'kept'), 'keep\n');
  writeFileSync(join(here.root, '.git'), 'checkout marker\n');
  await scratchLeft(here, path);
  assert.equal(readFileSync(join(here.root, '.git'), 'utf8'), 'checkout marker\n');
});

// proves R-WORK-35
test('merged-card removal leaves a scratch directory holding another repository checkout unchanged and names it', async (t) => {
  const here = world(t);
  const path = join(here.root, 'scratch', 'rigger-42', 'reviewer');
  repositoryAt(join(path, 'nested'), { kept: 'keep\n' });
  await scratchLeft(here, path);
});

// proves R-WORK-35
test('merged-card removal leaves scratch at, inside or holding a registered worktree with its git entry moved aside', async (t) => {
  for (const position of ['above', 'at', 'inside']) {
    const here = world(t);
    const path = join(here.root, 'scratch', 'rigger-42', 'reviewer');
    const tree = worktreeAt(here.repository, position === 'above' ? here.root : position === 'at' ? path : join(path, 'nested'), 'held');
    lockWorktreeAt(here.repository, tree, 'kept by a person');
    renameSync(join(tree, '.git'), join(here.directory, 'git-entry'));
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'kept'), 'keep\n');
    const branch = branchAt(here.repository, 'held');
    await scratchLeft(here, path);
    assert.equal(branchAt(here.repository, 'held'), branch);
  }
});

// proves R-WORK-35
test('real merged-card removal tries later directories after one fails and names every path remaining', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  const head = here.push('judge head');
  const alpha = await workspaceRemoval.makeJudgeDirectory({ root: here.root, topic: 'rigger-{number}', card: 42, role: 'alpha', head, repository: here.repository, sink: here.sink });
  const beta = await workspaceRemoval.makeJudgeDirectory({ root: here.root, topic: 'rigger-{number}', card: 42, role: 'beta', head, repository: here.repository, sink: here.sink });
  const alphaScratch = join(made.scratch, 'alpha');
  const betaScratch = join(made.scratch, 'beta');
  mkdirSync(alphaScratch, { recursive: true });
  writeFileSync(join(alphaScratch, 'output'), 'remove\n');
  writeFileSync(betaScratch, 'keep the refused file\n');
  const before = contents(alpha.path);
  const built = mergedRemoval(here);
  const stand = scratch(t);
  fixture(stand, 'git', [
    'if [ "$1" = worktree ] && [ "$2" = remove ]; then',
    '  for last do :; done',
    `  if [ "\${last%/*}" = '${alpha.path}' ]; then echo 'judge removal failed' >&2; exit 1; fi`,
    'fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));
  const beforeEvents = here.events().length;

  await assert.rejects(withFirstOnPath(stand, () => built.loop.pull()));

  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
  assert.equal(existsSync(made.path), false);
  assert.equal(existsSync(beta.path), false, 'the later judge was not tried');
  assert.equal(existsSync(alphaScratch), false, 'the later scratch directory was not tried');
  assert.deepEqual(contents(alpha.path), before);
  assert.equal(readFileSync(betaScratch, 'utf8'), 'keep the refused file\n');
  const remaining = [alpha.path, dirname(alpha.path), betaScratch, made.scratch];
  const left = here.events().slice(beforeEvents).filter(({ event }) => event === 'workspace.left');
  assert.deepEqual(left.map(({ path }) => path), remaining);
  assert.ok(left.every(({ reason }) => typeof reason === 'string' && reason.length > 0));
  await built.loop.pull();
  assert.equal(existsSync(alpha.path), false);
  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
});

// proves R-WORK-35
test('a workspace whose git entry outlives its registration is left named and reaches Done on the first of two pulls', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  const admin = gitIn(made.path, 'rev-parse', '--absolute-git-dir').trim();
  rmSync(admin, { recursive: true });
  assert.equal(existsSync(join(made.path, '.git')), true);
  const answer = spawnSync(GIT, ['-C', made.path, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], { encoding: 'utf8', env: gitEnvironment() });
  // Git words its diagnostic for this state differently by version (2.55 and 2.56 differ) and
  // by locale, so nothing here reads it; the run records it beside the selected git and gitfile.
  const gitFile = readFileSync(join(made.path, '.git'), 'utf8');
  const named = resolve(made.path, /^gitdir: (.+)$/m.exec(gitFile)?.[1] ?? '');
  const { LANG, LC_ALL, LC_MESSAGES, LANGUAGE } = gitEnvironment();
  t.diagnostic(`git ${GIT}: ${spawnSync(GIT, ['--version'], { encoding: 'utf8', env: gitEnvironment() }).stdout.trim()}; locale ${JSON.stringify({ LANG, LC_ALL, LC_MESSAGES, LANGUAGE })}`);
  t.diagnostic(`.git ${JSON.stringify(gitFile)}; its target ${named} exists: ${existsSync(named)}`);
  t.diagnostic(`answer status ${answer.status}; stderr ${JSON.stringify(answer.stderr)}`);
  assert.equal(answer.status, 128);
  assert.equal(existsSync(named), false, `the .git entry names ${named}, which is still there`);
  const before = { files: held(made.path), trees: worktreeList(here.repository), branch: branchAt(here.repository, 'rigger-42') };
  assert.equal(before.trees.includes(made.path), false);
  const built = mergedRemoval(here);
  const beforeEvents = here.events().length;
  const outcomes = [];
  const columns = [];

  for (let pass = 0; pass < 2; pass += 1) {
    outcomes.push(await built.loop.pull().then(() => undefined, (failure) => failure.message));
    columns.push(await columnsOf(built.fake));
  }

  assert.deepEqual(outcomes, [undefined, undefined]);
  assert.deepEqual(columns, [{ 42: COLUMNS.done }, { 42: COLUMNS.done }]);
  assert.deepEqual({ files: held(made.path), trees: worktreeList(here.repository), branch: branchAt(here.repository, 'rigger-42') }, before);
  const events = here.events().slice(beforeEvents).filter(({ layer }) => layer === 'L1');
  assert.deepEqual(events.map(({ event, path }) => ({ event, path })), [{ event: 'workspace.left', path: made.path }]);
  assert.match(events[0].reason, /not a workspace of the repository/);
});

// proves R-WORK-35
test('a filesystem answer that a scratch path is not a directory leaves it unchanged and named without holding Done back', async (t) => {
  const here = world(t);
  const path = join(here.root, 'scratch', 'rigger-42', 'reviewer');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'keep the file\n', { mode: 0o444 });
  const before = { files: held(here.root), trees: worktreeList(here.repository) };
  const built = mergedRemoval(here);

  await assert.doesNotReject(built.loop.pull());

  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
  assert.deepEqual({ files: held(here.root), trees: worktreeList(here.repository) }, before);
  const events = here.events().filter(({ layer }) => layer === 'L1');
  assert.deepEqual(events.map(({ event, path, role }) => ({ event, path, role })), [
    { event: 'workspace.left', path, role: 'reviewer' },
    { event: 'workspace.left', path: dirname(path), role: undefined },
  ]);
  assert.match(events[0].reason, /not a directory/);
  assert.match(events[1].reason, /not empty/);
});

// proves R-WORK-35
test('an unreadable worktree administrative directory keeps Review until a later pull can remove it', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  const admin = gitIn(made.path, 'rev-parse', '--absolute-git-dir').trim();
  const mode = statSync(admin).mode & 0o777;
  const before = { files: held(made.path), trees: worktreeList(here.repository), branch: branchAt(here.repository, 'rigger-42') };
  const built = mergedRemoval(here);
  const beforeEvents = here.events().length;
  chmodSync(admin, 0o000);

  try {
    await assert.rejects(built.loop.pull());
    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
    assert.equal(lstatSync(admin).isDirectory(), true);
    assert.equal(lstatSync(admin).mode & 0o777, 0);
    const left = here.events().slice(beforeEvents).filter(({ event, path }) => event === 'workspace.left' && path === made.path);
    assert.equal(left.length, 1);
    assert.match(left[0].reason, /exited 128/);
  } finally {
    chmodSync(admin, mode);
  }

  assert.deepEqual({ files: held(made.path), trees: worktreeList(here.repository), branch: branchAt(here.repository, 'rigger-42') }, before);
  await built.loop.pull();
  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
  assert.equal(existsSync(made.path), false);
  assert.equal(worktreeList(here.repository).includes(made.path), false);
});

/** A role directory containing the named real detached worktrees of this fixture repository. */
function escalationRole(here, role, names, number = 42) {
  const path = join(here.root, 'escalations', `rigger-${number}`, role);
  mkdirSync(path, { recursive: true });
  const trees = names.map((name) => detachedWorktreeAt(here.repository, join(path, name), headOf(here.repository)));
  return { path, trees, role };
}

// proves R-WORK-35
test('merged-card removal clears every eligible escalation role layout and retains other cards and the local branch', async (t) => {
  const here = world(t);
  await here.make(42);
  const branch = branchAt(here.repository, 'rigger-42');
  const roles = [
    escalationRole(here, 'empty', []),
    escalationRole(here, 'single', ['main']),
    escalationRole(here, 'pair', ['main', 'head']),
    escalationRole(here, 'several', ['alpha', 'beta', 'gamma', 'delta']),
  ];
  for (const { trees } of roles) for (const tree of trees) writeFileSync(join(tree, 'uncommitted'), 'an earlier role attempt\n');
  const other = escalationRole(here, 'other', ['main'], 43);
  const otherBefore = held(other.path);
  const unrelated = join(here.root, 'unrelated');
  writeFileSync(unrelated, 'retain this existing root entry\n');
  const built = mergedRemoval(here);

  await built.loop.pull();

  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
  for (const { path, trees, role: expectedRole } of roles) {
    assert.equal(existsSync(path), false, path);
    for (const tree of trees) assert.equal(worktreeList(here.repository).includes(tree), false, tree);
    assert.ok(here.events().some(({ event, path: removed, role }) => event === 'workspace.removed' && removed === path && role === expectedRole));
  }
  const base = join(here.root, 'escalations', 'rigger-42');
  assert.equal(existsSync(base), false);
  assert.equal(lstatSync(dirname(base)).isDirectory(), true);
  assert.ok(here.events().some(({ event, path }) => event === 'workspace.removed' && path === base));
  assert.deepEqual(held(other.path), otherBefore);
  assert.equal(readFileSync(unrelated, 'utf8'), 'retain this existing root entry\n');
  assert.equal(branchAt(here.repository, 'rigger-42'), branch);
  const beforeRepeat = here.events().filter(({ layer }) => layer === 'L1');
  await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });
  assert.deepEqual(here.events().filter(({ layer }) => layer === 'L1'), beforeRepeat);
  assert.deepEqual(held(other.path), otherBefore);
});

// proves R-WORK-35
test('a gone person-locked escalation registration blocks Done while other eligible roles are removed', async (t) => {
  for (const role of ['a-person', 'z-person']) {
    const here = world(t);
    const kept = escalationRole(here, role, ['main']);
    const eligible = escalationRole(here, 'middle', ['main']);
    lockWorktreeAt(here.repository, kept.trees[0], 'kept by a person');
    rmSync(kept.path, { recursive: true });
    const built = mergedRemoval(here);

    await assert.rejects(built.loop.pull());

    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
    assert.equal(existsSync(eligible.path), false);
    assert.equal(existsSync(kept.path), false);
    assert.ok(worktreeList(here.repository).includes(kept.trees[0]));
    assert.match(worktreeList(here.repository), /locked kept by a person/);
    assert.ok(here.events().some(({ event, path, role: named, reason }) => event === 'workspace.left' && path === kept.trees[0] && named === role && reason.includes('kept by a person')));
    unlockWorktreeAt(here.repository, kept.trees[0]);
    await built.loop.pull();
    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
    assert.equal(worktreeList(here.repository).includes(kept.trees[0]), false);
  }
});

// proves R-WORK-35
test('escalation removal leaves files and symbolic links at each hierarchy level without withholding Done', async (t) => {
  for (const level of ['root', 'topic', 'role']) for (const shape of ['file', 'link', 'dangling-link']) {
    const here = world(t);
    const before = join(here.root, 'judges', 'rigger-42', 'before');
    const after = join(here.root, 'scratch', 'rigger-42', 'after');
    mkdirSync(before, { recursive: true });
    mkdirSync(after, { recursive: true });
    writeFileSync(join(after, 'output'), 'eligible scratch output\n');
    const parent = join(here.root, 'escalations');
    const base = join(parent, 'rigger-42');
    const path = level === 'root' ? parent : level === 'topic' ? base : join(base, 'reviewer');
    mkdirSync(dirname(path), { recursive: true });
    const outside = join(here.directory, 'outside');
    mkdirSync(join(outside, 'rigger-42', 'reviewer'), { recursive: true });
    writeFileSync(join(outside, 'rigger-42', 'reviewer', 'kept'), 'retain the link target\n');
    const target = shape === 'dangling-link' ? join(outside, 'absent') : outside;
    if (shape === 'file') writeFileSync(path, 'retain this file\n', { mode: 0o444 });
    else symlinkSync(target, path);
    const mode = lstatSync(path).mode;
    const outsideBefore = held(outside);
    const built = mergedRemoval(here);

    await assert.doesNotReject(built.loop.pull().catch((failure) => {
      t.diagnostic(JSON.stringify(here.events().filter(({ layer, event }) => layer === 'L1' && event === 'workspace.left')));
      throw failure;
    }), `${level} ${shape}`);

    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
    assert.equal(lstatSync(path).mode, mode);
    if (shape === 'file') assert.equal(readFileSync(path, 'utf8'), 'retain this file\n');
    else assert.equal(readlinkSync(path), target);
    assert.deepEqual(held(outside), outsideBefore);
    assert.equal(existsSync(before), false, `${level} ${shape}: earlier eligible role`);
    assert.equal(existsSync(after), false, `${level} ${shape}: later eligible role`);
    const named = level === 'role' ? path : base;
    assert.ok(here.events().some(({ event, path: left, reason }) => event === 'workspace.left' && left === named && reason.includes(path)), `${level} ${shape}: refused path was not named`);
    assert.equal(here.events().some(({ event, path: removed }) => event === 'workspace.removed' && removed === path), false);
  }
});

// proves R-WORK-35
test('escalation replacement refusals preserve each guarded role before or after an eligible role', async (t) => {
  for (const cell of ['main-checkout', 'other-repository', 'attached', 'extra-content', 'nested-worktree']) for (const role of ['a-refused', 'z-refused']) {
    const here = world(t);
    const path = join(here.root, 'escalations', 'rigger-42', role);
    mkdirSync(path, { recursive: true });
    if (cell === 'main-checkout') {
      const moved = join(path, 'main');
      renameSync(here.repository, moved);
      here.repository = moved;
    } else if (cell === 'other-repository') {
      repositoryAt(join(path, 'main'), { kept: 'another repository\n' });
    } else if (cell === 'attached') {
      worktreeAt(here.repository, join(path, 'main'), 'held');
    } else if (cell === 'extra-content') {
      writeFileSync(join(path, 'kept'), 'plain content is not a worktree\n');
    } else {
      const tree = detachedWorktreeAt(here.repository, join(path, 'main'), headOf(here.repository));
      detachedWorktreeAt(here.repository, join(tree, 'nested'), headOf(here.repository));
    }
    const eligible = escalationRole(here, 'middle', ['main']);
    const leaving = cell === 'main-checkout' ? ['main/.git/worktrees'] : [];
    const before = contents(path, leaving);
    const mode = lstatSync(path).mode;
    const branch = branchAt(here.repository, 'held');
    const built = mergedRemoval(here);

    await assert.doesNotReject(built.loop.pull(), `${cell} ${role}`);

    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
    assert.deepEqual(contents(path, leaving), before, `${cell} ${role}`);
    assert.equal(lstatSync(path).mode, mode);
    assert.equal(branchAt(here.repository, 'held'), branch);
    assert.equal(existsSync(eligible.path), false, `${cell} ${role}: eligible role was not tried`);
    assert.ok(here.events().some(({ event, path: left, role: named, reason }) => event === 'workspace.left' && left === path && named === role && reason.includes(path)), `${cell} ${role}: no named refusal`);
    assert.equal(here.events().some(({ event, path: removed }) => event === 'workspace.removed' && removed === path), false);
  }
});

// proves R-WORK-35
test('a present person-locked escalation role keeps every tree and its lock while other roles finish', async (t) => {
  for (const role of ['a-person', 'z-person']) {
    const here = world(t);
    const kept = escalationRole(here, role, ['main', 'head']);
    lockWorktreeAt(here.repository, kept.trees[0], 'kept by a person');
    const eligible = escalationRole(here, 'middle', ['main']);
    const before = held(kept.path);
    const built = mergedRemoval(here);

    await assert.rejects(built.loop.pull());

    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
    assert.deepEqual(held(kept.path), before);
    assert.match(worktreeList(here.repository), /locked kept by a person/);
    for (const tree of kept.trees) assert.ok(worktreeList(here.repository).includes(tree));
    assert.equal(existsSync(eligible.path), false);
    assert.ok(here.events().some(({ event, path, role: named, reason }) => event === 'workspace.left' && path === kept.path && named === role && reason.includes('kept by a person')));
    unlockWorktreeAt(here.repository, kept.trees[0]);
    await built.loop.pull();
    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
    assert.equal(existsSync(kept.path), false);
  }
});

// proves R-WORK-35
test('escalation removal prunes stale registrations and unlocks only initializing locks across absent parents', async (t) => {
  for (const state of ['present', 'role-gone', 'topic-gone', 'parent-gone']) for (const locked of [false, true]) {
    const here = world(t);
    const made = escalationRole(here, 'reviewer', ['main', 'head']);
    if (locked) lockWorktreeAt(here.repository, made.trees[0], ADDING);
    if (state !== 'present') rmSync(state === 'role-gone' ? made.path : state === 'topic-gone' ? dirname(made.path) : dirname(dirname(made.path)), { recursive: true });
    for (const tree of made.trees) assert.ok(worktreeList(here.repository).includes(tree));
    const built = mergedRemoval(here);

    await assert.doesNotReject(built.loop.pull(), `${state} initializing=${locked}`);

    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
    assert.equal(existsSync(made.path), false);
    for (const tree of made.trees) assert.equal(worktreeList(here.repository).includes(tree), false, tree);
    if (state !== 'present') assert.equal(here.events().some(({ event, path }) => event === 'workspace.removed' && path === made.path), false);
    const beforeRepeat = here.events().filter(({ layer }) => layer === 'L1');
    await workspaceRemoval.removeCardDirectories({ root: here.root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink });
    assert.deepEqual(here.events().filter(({ layer }) => layer === 'L1'), beforeRepeat);
  }
});

// proves R-WORK-35
test('an escalation role containing initializing and person locks preserves both until the person unlocks', async (t) => {
  for (const role of ['a-person', 'z-person']) {
    const here = world(t);
    const kept = escalationRole(here, role, ['a-own', 'z-person']);
    lockWorktreeAt(here.repository, kept.trees[0], ADDING);
    lockWorktreeAt(here.repository, kept.trees[1], 'kept by a person');
    const eligible = escalationRole(here, 'middle', ['main']);
    const before = held(kept.path);
    const built = mergedRemoval(here);

    await assert.rejects(built.loop.pull());

    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
    assert.deepEqual(held(kept.path), before);
    assert.match(worktreeList(here.repository), /locked initializing/);
    assert.match(worktreeList(here.repository), /locked kept by a person/);
    assert.equal(existsSync(eligible.path), false);
    unlockWorktreeAt(here.repository, kept.trees[1]);
    await built.loop.pull();
    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
    for (const tree of kept.trees) assert.equal(worktreeList(here.repository).includes(tree), false);
  }
});

// proves R-WORK-35
test('an absent escalation hierarchy causes no removal event or failure and keeps unrelated root content', async (t) => {
  const here = world(t);
  mkdirSync(here.root);
  writeFileSync(join(here.root, 'kept'), 'unrelated existing content\n');
  const before = held(here.root);
  const built = mergedRemoval(here);

  await built.loop.pull();

  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
  assert.deepEqual(held(here.root), before);
  assert.deepEqual(here.events().filter(({ layer }) => layer === 'L1'), []);
});

// proves R-WORK-35
test('failed or timed-out escalation worktree checks keep Review and a later pull retries them', async (t) => {
  for (const cell of ['failed', 'timed-out']) {
    const here = world(t);
    const kept = escalationRole(here, 'a-failed', ['main']);
    const eligible = escalationRole(here, 'z-later', ['main']);
    const before = held(kept.path);
    const options = cell === 'timed-out' ? { timeout: OUTLIVED } : {};
    const built = mergedRemoval(here, options);
    const stand = cell === 'timed-out' ? holding(t) : scratch(t);
    fixture(stand, 'git', [
      `if [ "$1" = -C ] && [ "$2" = '${kept.trees[0]}' ] && [ ! -e "$here/failed" ]; then`,
      '  : > "$here/failed"',
      ...(cell === 'timed-out' ? ['  exec /usr/bin/tail -f "$here/hold"'] : ['  echo "escalation recognition read failed" >&2', '  exit 1']),
      'fi',
      `exec '${GIT}' "$@"`,
    ].join('\n'));

    await assert.rejects(withFirstOnPath(stand, () => built.loop.pull()));

    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
    assert.deepEqual(held(kept.path), before);
    assert.equal(existsSync(eligible.path), false);
    assert.ok(here.events().some(({ event, path, reason }) => event === 'workspace.left' && path === kept.path && (cell === 'failed' ? reason.includes('escalation recognition read failed') : reason.includes('past its timeout'))));
    options.timeout = undefined;
    await built.loop.pull();
    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
    assert.equal(existsSync(kept.path), false);
  }
});

// proves R-WORK-35
test('unreadable escalation topic or worktree administration withholds Done and retries the remaining guards', async (t) => {
  for (const cell of ['topic', 'administration']) {
    const here = world(t);
    const kept = escalationRole(here, 'reviewer', ['main']);
    const path = cell === 'topic' ? dirname(kept.path) : gitIn(kept.trees[0], 'rev-parse', '--absolute-git-dir').trim();
    const mode = lstatSync(path).mode & 0o777;
    const before = held(kept.path);
    const built = mergedRemoval(here);
    chmodSync(path, 0o000);
    try {
      await assert.rejects(built.loop.pull());
      assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
      assert.equal(lstatSync(path).mode & 0o777, 0);
      const named = cell === 'topic' ? dirname(kept.path) : kept.path;
      assert.ok(here.events().some(({ event, path: left, reason }) => event === 'workspace.left' && left === named && /permission denied|exited 128/i.test(reason)));
    } finally {
      chmodSync(path, mode);
    }
    assert.deepEqual(held(kept.path), before);
    // Git's global prune can forget an unlocked tree it cannot reach. The retry uses the
    // registration Git still holds, rather than assuming the first check preserved it.
    const registered = worktreeList(here.repository).includes(kept.trees[0]);
    const answer = spawnSync(GIT, ['-C', kept.trees[0], 'rev-parse', '--git-common-dir'], { encoding: 'utf8', env: gitEnvironment() });
    assert.equal(answer.status === 0, registered, answer.stderr);
    const beforeRetry = here.events().length;
    await built.loop.pull();
    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
    assert.equal(existsSync(kept.path), !registered);
    if (!registered) {
      assert.deepEqual(held(kept.path), before);
      assert.ok(here.events().slice(beforeRetry).some(({ event, path, reason }) => event === 'workspace.left' && path === kept.path && reason.includes('not a worktree of the repository')));
    }
  }
});

// proves R-WORK-35
test('whole and partial escalation removals name what remains and retry after later roles finish', async (t) => {
  for (const cell of ['whole', 'partial']) {
    const here = world(t);
    const kept = escalationRole(here, 'a-failed', ['main', 'head']);
    writeFileSync(join(kept.trees[0], 'uncommitted'), 'part of an earlier role attempt\n');
    const before = held(kept.path);
    const eligible = escalationRole(here, 'z-later', ['main']);
    const stopped = cell === 'whole' ? kept.trees[1] : kept.trees[0];
    const built = mergedRemoval(here);
    const stand = scratch(t);
    fixture(stand, 'git', [
      'if [ "$1" = worktree ] && [ "$2" = remove ]; then',
      '  for last do :; done',
      `  if [ "$last" = '${stopped}' ]; then`,
      ...(cell === 'partial' ? ['    /bin/rm -f "$last/uncommitted"'] : []),
      '    echo "escalation removal stopped" >&2',
      '    exit 1',
      '  fi',
      'fi',
      `exec '${GIT}' "$@"`,
    ].join('\n'));

    await assert.rejects(withFirstOnPath(stand, () => built.loop.pull()));

    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
    assert.equal(existsSync(eligible.path), false);
    assert.equal(existsSync(stopped), true);
    if (cell === 'whole') assert.deepEqual(held(kept.path), before);
    else {
      assert.equal(existsSync(kept.trees[1]), false);
      assert.equal(worktreeList(here.repository).includes(kept.trees[1]), false);
      assert.equal(existsSync(join(kept.trees[0], 'uncommitted')), false);
    }
    for (const path of [kept.path, dirname(kept.path)]) assert.ok(here.events().some(({ event, path: left, reason }) => event === 'workspace.left' && left === path && reason.length > 0));
    assert.ok(here.events().some(({ event, path, reason }) => event === 'workspace.left' && path === kept.path && reason.includes('escalation removal stopped')));
    await built.loop.pull();
    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
    assert.equal(existsSync(kept.path), false);
    for (const tree of kept.trees) assert.equal(worktreeList(here.repository).includes(tree), false);
  }
});

// proves R-WORK-35
test('refused escalation removal or left events retain the actual state and unrecorded event until retry', async (t) => {
  for (const cell of ['removed-role', 'removed-topic', 'left-role']) {
    const here = world(t);
    const made = escalationRole(here, 'reviewer', cell === 'left-role' ? [] : ['main']);
    if (cell === 'left-role') writeFileSync(join(made.path, 'kept'), 'a completed guard refusal\n');
    const path = cell === 'removed-topic' ? dirname(made.path) : made.path;
    const event = cell === 'left-role' ? 'workspace.left' : 'workspace.removed';
    let refuse = true;
    const sink = { emitter: (context) => {
      const emitter = here.sink.emitter(context);
      return { emit: (name, fields) => {
        if (refuse && context.layer === 'L1' && name === event && fields.path === path) throw new Error('escalation record full');
        emitter.emit(name, fields);
      } };
    } };
    const built = mergedRemoval(here, { sink });

    await assert.rejects(built.loop.pull(), (failure) => {
      const refusal = failure.errors[0];
      assert.equal(refusal.code, EVENT_REFUSED);
      assert.match(refusal.message, /unrecorded.*escalation record full/);
      assert.deepEqual(refusal.unrecorded.map(({ event, path }) => ({ event, path })), [{ event, path }]);
      return true;
    });

    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.review });
    assert.equal(existsSync(path), cell === 'left-role');
    if (cell === 'left-role') assert.equal(readFileSync(join(made.path, 'kept'), 'utf8'), 'a completed guard refusal\n');
    else assert.equal(here.events().some(({ event, path: left }) => event === 'workspace.left' && left === path), false);
    refuse = false;
    await built.loop.pull();
    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
    assert.equal(existsSync(made.path), cell === 'left-role');
  }
});
// proves R-WORK-35
test('escalation removal preserves an empty target behind either hierarchy symlink and names that link refusal', async (t) => {
  for (const level of ['root', 'topic']) {
    const here = world(t);
    const parent = join(here.root, 'escalations');
    const base = join(parent, 'rigger-42');
    const link = level === 'root' ? parent : base;
    const outside = join(here.directory, 'outside-escalations');
    const targetTopic = level === 'root' ? join(outside, 'rigger-42') : outside;
    mkdirSync(targetTopic, { recursive: true });
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(outside, link);
    const before = held(outside);
    const built = mergedRemoval(here);

    await assert.doesNotReject(built.loop.pull().catch((failure) => {
      t.diagnostic(JSON.stringify(here.events().filter(({ layer, event }) => layer === 'L1' && event === 'workspace.left')));
      throw failure;
    }), `${level}: a link refusal must not fail removal`);

    assert.equal(existsSync(targetTopic), true, `${level}: the empty target topic outside the root was removed through the link`);
    assert.equal(lstatSync(targetTopic).isDirectory(), true);
    assert.deepEqual(held(outside), before, `${level}: the outside target changed`);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(readlinkSync(link), outside);
    assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.done });
    const left = here.events().filter(({ layer, event }) => layer === 'L1' && event === 'workspace.left');
    assert.equal(left.length, 1, `${level}: exactly the link refusal is recorded`);
    assert.equal(left[0].path, base);
    assert.ok(left[0].reason.startsWith(`${link} is a symbolic link`), `${level}: the reason must identify the refused link, not a nonempty ancestor`);
    assert.deepEqual(here.events().filter(({ layer, event }) => layer === 'L1' && event === 'workspace.removed'), []);
  }
});


/** The existing shared-removal fixture, with its actual forge history closed and its card in Owner. */
async function closedRemoval(here, options = {}) {
  const built = mergedRemoval(here, options);
  built.repository.update(421, { merged: false, closed: true });
  await built.fake.operations.moveItem('item-1', COLUMNS.owner);
  return built;
}

// proves R-WORK-36
test('closed cleanup reaches shared real Git removal for every directory class before the ordinary owner action and keeps branches and unrelated trees', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  const branch = branchAt(here.repository, 'rigger-42');
  const head = here.push('head for the closed card judge');
  const judge = await workspaceRemoval.makeJudgeDirectory({ root: here.root, topic: 'rigger-{number}', card: 42, role: 'reviewer', head, repository: here.repository, sink: here.sink });
  const scratch = await workspaceRemoval.makeScratch({ base: made.scratch, role: 'reviewer', card: 42, repository: here.repository, sink: here.sink });
  writeFileSync(join(scratch, 'content'), 'closed scratch content');
  const escalation = escalationRole(here, 'architect', ['main', 'head']);
  const other = escalationRole(here, 'reviewer', ['main'], 43);
  const otherBefore = held(other.path);
  const unrelated = join(here.root, 'unrelated');
  writeFileSync(unrelated, 'unrelated existing content');
  const paths = [made.path, judge.path, escalation.path, scratch];
  const topics = ['judges', 'escalations', 'scratch'].map((kind) => join(here.root, kind, 'rigger-42'));
  const built = await closedRemoval(here);
  const comment = built.repository.postIssueComment;
  let ordinary = 0;
  built.repository.postIssueComment = async (...args) => {
    ordinary += 1;
    for (const path of [...paths, ...topics]) assert.equal(existsSync(path), false, `${path} remained until the ordinary action`);
    return comment(...args);
  };
  const before = here.events().length;
  const reached = await built.loop.pull(1);
  assert.equal(ordinary, 1);
  assert.equal(reached[0].action, 'escalate');
  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.owner });
  for (const path of [...paths, ...topics]) assert.equal(existsSync(path), false, path);
  for (const tree of [made.path, judge.main, judge.head, ...escalation.trees]) assert.equal(worktreeList(here.repository).includes(tree), false, tree);
  assert.equal(branchAt(here.repository, 'rigger-42'), branch);
  assert.equal(readFileSync(unrelated, 'utf8'), 'unrelated existing content');
  assert.deepEqual(held(other.path), otherBefore);
  const removed = here.events().slice(before).filter(({ layer, event }) => layer === 'L1' && event === 'workspace.removed').map(({ path }) => path);
  for (const path of paths) assert.ok(removed.includes(path), `${path} had no actual removal record`);
  const repeated = await closedRemoval(here);
  const events = here.events().length;
  assert.equal((await repeated.loop.pull(1))[0].action, 'escalate');
  assert.deepEqual(here.events().slice(events).filter(({ layer }) => layer === 'L1'), [], 'a repeated eligible cleanup of absent directories neither fails nor records a removal');
  assert.equal(branchAt(here.repository, 'rigger-42'), branch);
  assert.deepEqual(held(other.path), otherBefore);
  assert.equal(readFileSync(unrelated, 'utf8'), 'unrelated existing content');
});


// proves R-WORK-36
test('actual closed cleanup retains and names every person-locked path while removing eligible siblings and still escalating the card', async (t) => {
  const here = world(t);
  const made = await here.make(42);
  lockWorktreeAt(here.repository, made.path, 'workspace kept by a person');
  const kept = escalationRole(here, 'a-kept', ['main']);
  lockWorktreeAt(here.repository, kept.trees[0], 'escalation kept by a person');
  const eligible = escalationRole(here, 'z-eligible', ['main', 'head']);
  const scratch = await workspaceRemoval.makeScratch({ base: made.scratch, role: 'reviewer', card: 42, repository: here.repository, sink: here.sink });
  writeFileSync(join(scratch, 'content'), 'eligible sibling content');
  const before = { workspace: held(made.path), escalation: held(kept.path), branch: branchAt(here.repository, 'rigger-42') };
  const built = await closedRemoval(here);
  await assert.rejects(built.loop.pull(1), (failure) => {
    assert.ok(failure.errors[0] instanceof AggregateError);
    for (const path of [made.path, kept.path]) assert.ok(failure.errors[0].errors.some(({ message }) => message.includes(path)), `${path} was lost from the actual failure`);
    assert.equal(failure.reached[0].action, 'escalate');
    return true;
  });
  assert.deepEqual({ workspace: held(made.path), escalation: held(kept.path), branch: branchAt(here.repository, 'rigger-42') }, before);
  assert.match(worktreeList(here.repository), /locked workspace kept by a person/);
  assert.match(worktreeList(here.repository), /locked escalation kept by a person/);
  assert.equal(existsSync(eligible.path), false);
  assert.equal(existsSync(scratch), false);
  assert.deepEqual(await columnsOf(built.fake), { 42: COLUMNS.owner });
  assert.equal(built.repository.held().issues[0].comments.length, 1);
  assert.deepEqual((await built.fake.operations.readItems())[0].labels, ['type:change', 'rigger:escalated']);
  const left = here.events().filter(({ event }) => event === 'workspace.left');
  for (const path of [made.path, kept.path]) assert.ok(left.some(({ path: named }) => named === path));
  const events = here.events().length;
  assert.deepEqual(await built.loop.pull(1), []);
  assert.deepEqual(here.events().slice(events), [], 'the failed cleanup is not repeated while labelled');
});
