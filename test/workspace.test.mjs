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
import { bareCloneInto, cloneInto, gitIn, repositoryAt, worktreeAt, worktreeList } from './git-repository.mjs';
import { gitCalls, gitRecording, scratch, withFirstOnPath } from './process-fixtures.mjs';

/**
 * A repository whose `origin` is a local bare repository, a root for workspaces and a sink, in a
 * scratch directory torn down with every process naming it. `push` commits in the repository
 * `origin` was cloned from and pushes that commit to `origin`'s `main`, handing back its id.
 */
function world(t) {
  const directory = scratch(t);
  const source = repositoryAt(join(directory, 'source'), { README: 'one\n' });
  gitIn(source, 'branch', '-M', 'main');
  const origin = bareCloneInto(source, join(directory, 'origin.git'));
  const repository = cloneInto(origin, join(directory, 'repository'));
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

/**
 * Asserts that `attempt` rejects as a workspace that could not be made, naming `path`, and hands
 * back its failure.
 */
async function refusedNaming(attempt, path) {
  let failure;
  await attempt.then(() => assert.fail('the attempt made a workspace'), (thrown) => { failure = thrown; });
  assert.equal(failure.code, WORKSPACE_NOT_MADE, failure.stack);
  assert.ok(failure.message.includes(path), `the failure does not name ${path}: ${failure.message}`);
  return failure;
}

test('given a plain directory holding a file at card 42\'s workspace path, under a root outside every repository, the attempt fails naming that path', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'kept'), 'not Rigger\'s\n');
  await refusedNaming(here.make(42), path);
});

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

test('given a plain directory holding a file at card 42\'s workspace path, under a root inside the repository\'s working tree, the attempt fails naming that path, and the file is byte-identical afterwards', async (t) => {
  const here = world(t);
  const root = join(here.repository, 'worktrees');
  const path = join(root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'kept'), 'not Rigger\'s\n');
  await refusedNaming(here.make(42, { root }), path);
  assert.equal(readFileSync(join(path, 'kept'), 'utf8'), 'not Rigger\'s\n');
});

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
    await refusedNaming(here.make(42), path);
    assert.equal(branchAt(here.repository, 'rigger-42'), before, existing ? 'the branch moved' : 'a branch was made');
  }
});

test('given a worktree of a different repository at card 42\'s workspace path, the attempt fails naming the path, and git worktree list --porcelain in that repository is byte-identical afterwards', async (t) => {
  const here = world(t);
  const other = repositoryAt(join(here.directory, 'other'), { README: 'other\n' });
  const path = join(here.root, 'rigger-42');
  mkdirSync(here.root, { recursive: true });
  worktreeAt(other, path, 'rigger-42');
  const before = worktreeList(other);
  await refusedNaming(here.make(42), path);
  assert.equal(worktreeList(other), before);
  assert.equal(existsSync(join(path, 'README')), true);
});

test('given card 42\'s workspace path named through a symbolic link to a worktree of the repository, L1 recognises it as the card\'s workspace and replaces it', async (t) => {
  const here = world(t);
  const elsewhere = worktreeAt(here.repository, join(here.directory, 'elsewhere'), 'elsewhere');
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

test('given a repository whose main working tree is W/app-7, with root W and topic app-{number}, an attempt at card 7 fails naming that path', async (t) => {
  const here = mainTreeWorld(t);
  await refusedNaming(here.make(), join(here.w, 'app-7'));
});

test('given a repository whose main working tree is W/app-7, with root W and topic app-{number}, after the attempt at card 7 fails, every file in the main working tree is byte-identical, and git status --porcelain --ignored and git worktree list --porcelain print what they printed before', async (t) => {
  const here = mainTreeWorld(t);
  const before = here.state();
  await here.make().catch(() => {});
  assert.deepEqual(here.state(), before);
});

test('given a root named through a symbolic link, so that the path derived for card 7 resolves to the repository\'s main working tree, an attempt at card 7 fails naming that path', async (t) => {
  const here = mainTreeWorld(t);
  const link = join(here.within, 'link');
  symlinkSync(here.w, link);
  const before = here.state();
  await refusedNaming(here.make(link), join(link, 'app-7'));
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

/** What git prints first on standard error refusing `name` as a branch name. */
function gitRefuses(name) {
  const refused = spawnSync('git', ['check-ref-format', '--branch', name], { encoding: 'utf8', env: gitEnvironment() });
  assert.notEqual(refused.status, 0, `git accepts ${name}`);
  return refused.stderr.split('\n').find((line) => line.trim() !== '');
}

test('given a topic that git refuses as a branch name, the attempt fails naming the card and the topic, and no directory is made at the derived path', async (t) => {
  const here = world(t);
  const topic = 'rigger-{number}.lock';
  const failure = await refusedNaming(here.make(42, { topic }), join(here.root, 'rigger-42.lock'));
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

test('L1\'s workspace function, handed a root that is not absolute, makes no workspace and fails naming the root, and it reads no repo', async (t) => {
  const here = world(t);
  /** The function's arguments, with a `repo` that fails the test wherever it is read. */
  const handed = (root) => Object.defineProperty({ root, topic: 'rigger-{number}', card: 42, repository: here.repository, sink: here.sink }, 'repo', {
    get() { throw new Error('L1 read repo'); },
  });
  const failure = await refusedNaming(makeWorkspace(handed('worktrees')), 'worktrees');
  assert.ok(failure.message.includes('not an absolute path'), failure.message);
  assert.equal(existsSync(join('worktrees', 'rigger-42')), false);
  const made = await makeWorkspace(handed(here.root));
  assert.equal(branchOf(made.path), 'rigger-42');
});

test('a workspace that could not be made is reported with a code telling it from a command that never started and from a refused event, naming the path', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  const failure = await refusedNaming(here.make(42), path);
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
  const failure = await refusedNaming(here.make(42), path);
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
    await refusedNaming(here.make(42), plain);
    await refusedNaming(here.make(43), join(here.root, 'rigger-43'));
    await refusedNaming(main.make(), join(main.w, 'app-7'));
  });
  const calls = gitCalls(stand);
  assert.ok(calls.length > 0, 'the stand-in recorded no call');
  const questions = /^(check-ref-format --branch |rev-parse |-C \S+ rev-parse )/;
  assert.deepEqual(calls.filter((call) => !questions.test(call)), []);
});
