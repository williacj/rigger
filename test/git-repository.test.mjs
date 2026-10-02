// ABOUTME: Tests of the git fixture's repositories: that none of them, cloned ones included, has a
// git call in it start git's automatic maintenance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { clonedFromOrigin } from './git-repository.mjs';

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
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'rigger-unmaintained-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
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
