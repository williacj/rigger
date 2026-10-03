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
import { previousCheckout } from './git-repository.mjs';
import { fixture, GIT } from './process-fixtures.mjs';
import { ADDING } from '../src/substrate/worktrees.mjs';
import { lstatSync } from 'node:fs';
import { childrenIn, gitLeavingChild, gitRacing } from './process-fixtures.mjs';
import { createHash } from 'node:crypto';

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

// proves R-WORK-13, R-WORK-14
test('given a plain directory holding a file at card 42\'s workspace path, under a root outside every repository, the attempt fails naming that path', async (t) => {
  const here = world(t);
  const path = join(here.root, 'rigger-42');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'kept'), 'not Rigger\'s\n');
  await refusedNaming(here.make(42), path);
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
  await refusedNaming(here.make(42, { root }), path);
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
    await refusedNaming(here.make(42), path);
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
  await refusedNaming(here.make(42), path);
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
  await refusedNaming(here.make(), join(here.w, 'app-7'));
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
    await refusedNaming(here.make(42), plain);
    await refusedNaming(here.make(43), join(here.root, 'rigger-43'));
    await refusedNaming(main.make(), join(main.w, 'app-7'));
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
    const failure = await refusedNaming(handle(3), join(here.root, 'rigger-3'));
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
  await refusedNaming(here.attempt(), here.path);
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
  await refusedNaming(here.attempt(), here.path);
  assert.deepEqual(here.state(), before);
});

// proves R-WORK-13, R-WORK-16
test('given L1 handed as the repository a subdirectory of a linked worktree at root/rigger-42 on branch rigger-42, holding an uncommitted file, an attempt at card 42 fails naming the path', async (t) => {
  const here = handedWorld(t, 'rigger-42', 'below');
  await refusedNaming(here.attempt(), here.path);
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
  await refusedNaming(here.make(7), here.path);
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
  await refusedNaming(here.make(42), here.path);
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
  await refusedNaming(here.make(42), here.path);
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
  await refusedNaming(here.attempt(), here.main);
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
  await refusedNaming(here.make(7), here.path);
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
  await refusedNaming(here.attempt(), here.path);
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
  await refusedNaming(here.make(42), here.path);
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
  await refusedNaming(here.make(42), here.path);
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
  await refusedNaming(here.make(42), first.path);
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
  await refusedNaming(here.make(42), join(here.root, 'rigger-42'));
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
  const failure = await refusedNaming(here.make(42), join(here.root, 'rigger-42'));
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
  const failure = await refusedNaming(here.make(42, { repository: handed }), join(here.root, 'rigger-42'));
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
