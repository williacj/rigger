// ABOUTME: Tests L1's making of a judge's directory: where it lies, the detached `main` and `head`
// worktrees it holds, the directories it replaces and the ones it leaves alone, and its events.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { WORKSPACE_NOT_MADE, makeJudgeDirectory, makeWorkspace } from '../src/execution/workspace.mjs';
import { clonedFromOrigin, gitIn } from './git-repository.mjs';
import { scratch } from './process-fixtures.mjs';

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
  const make = (over = {}) => makeJudgeDirectory({ root, topic: 'rigger-{number}', card: 42, role: 'reviewer', head, repository, sink, ...over });
  return { directory, source, origin, repository, root, state, sink, events, head, main, make };
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
  gitIn(here.source, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-q', '--allow-empty', '-m', 'the main line moves on');
  gitIn(here.source, 'push', '-q', here.origin, 'main');
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
  const path = join(here.root, 'judges', 'rigger-42', 'reviewer');
  await refusedNaming(here.make({ head: missing }), path, missing);
  assert.equal(existsSync(here.root), false);
});
