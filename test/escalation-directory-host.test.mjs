// ABOUTME: Tests real git worktrees and guarded replacement for an escalation role's directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { roleDispatch } from '../src/execution/role.mjs';
import { escalationWorld } from './escalation-world.mjs';
import * as workspace from '../src/execution/workspace.mjs';
import { openSink } from '../src/observation/sink.mjs';
import { clonedFromOrigin, detachedWorktreeAt, gitIn, worktreeAt, worktreeList } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** Local origin and independent literal main/head commits; no production helper derives expectations. */
function world(t) {
  const directory = temporaryDirectory('rigger-escalation-directory-', { context: t });
  const { source, origin, repository } = clonedFromOrigin(directory);
  const main = gitIn(source, 'rev-parse', 'HEAD').trim();
  gitIn(source, 'switch', '-qc', 'rigger-12');
  gitIn(source, 'commit', '-qm', 'maker work', '--allow-empty');
  gitIn(source, 'push', '-q', origin, 'rigger-12');
  const head = gitIn(source, 'rev-parse', 'HEAD').trim();
  const root = join(directory, 'worktrees');
  const path = join(root, 'escalations', 'rigger-12', 'pm');
  const sink = openSink({ directory: join(directory, 'state'), run: 'r-test', now: () => 0 });
  const make = (options = {}) => workspace.makeEscalationDirectory({ root, topic: 'rigger-{number}', card: 12, role: 'pm', repository, sink, ...options });
  return { directory, source, origin, repository, root, path, sink, main, head, make };
}

// The counterexample is a judge directory, a branch checkout, or a stale main/head.
// proves R-WORK-32
test('an escalation directory holds detached main and open head under escalations and no scratch yet', { timeout: 20000 }, async (t) => {
  const here = world(t);
  assert.equal(typeof workspace.makeEscalationDirectory, 'function', 'L1 needs the escalation directory make');
  const before = gitIn(here.repository, 'for-each-ref', 'refs/heads');
  const made = await here.make({ head: here.head });
  assert.equal(made.path, here.path);
  for (const [name, sha] of [['main', here.main], ['head', here.head]]) {
    assert.equal(gitIn(made[name], 'rev-parse', 'HEAD').trim(), sha);
    assert.equal(gitIn(made[name], 'rev-parse', '--symbolic-full-name', 'HEAD').trim(), 'HEAD');
  }
  assert.equal(made.scratch, join(here.root, 'scratch', 'rigger-12'));
  assert.equal(existsSync(made.scratch), false);
  assert.equal(made.repository, here.repository);
  assert.equal(gitIn(here.repository, 'for-each-ref', 'refs/heads'), before);
});

// A role without an open PR still needs a main worktree and must not invent a head.
// proves R-WORK-32
test('an escalation without a pull makes main alone and replaces an earlier detached directory', { timeout: 20000 }, async (t) => {
  const here = world(t);
  const old = await here.make({ head: here.head });
  writeFileSync(join(old.main, 'left-behind'), 'old role output\n');
  const made = await here.make();
  assert.equal(gitIn(made.main, 'rev-parse', 'HEAD').trim(), here.main);
  assert.equal(made.head, undefined);
  assert.equal(existsSync(join(here.path, 'head')), false);
  assert.equal(existsSync(join(made.main, 'left-behind')), false);
});

// A failed git/filesystem answer is a dispatch that never started, not an answered refusal.
// proves R-ESCALATE-26
test('an escalation directory not made reports NOT_STARTED naming the missing directory', { timeout: 20000 }, async (t) => {
  const here = world(t);
  const absent = 'f'.repeat(40);
  await assert.rejects(here.make({ head: absent }), (failure) => {
    assert.equal(failure.code, 'NOT_STARTED');
    assert.equal(failure.missing, here.path);
    assert.ok(failure.message.includes(here.path));
    return true;
  });
  assert.equal(existsSync(here.path), false);
});

/** A refusal must leave both registrations and contents intact, independently observed through git and fs. */
async function unchanged(here, attempt, kept) {
  const before = { listing: worktreeList(here.repository), refs: gitIn(here.repository, 'show-ref'), bytes: readFileSync(kept) };
  await assert.rejects(attempt(), (failure) => {
    assert.equal(failure.code, 'WORKSPACE_REFUSED');
    assert.ok(failure.message.includes(here.path));
    assert.match(failure.message, /R-WORK-32/);
    return true;
  });
  assert.deepEqual({ listing: worktreeList(here.repository), refs: gitIn(here.repository, 'show-ref'), bytes: readFileSync(kept) }, before);
}

// R-WORK-21: a branch checkout is not replaceable.
// proves R-WORK-32
test('an escalation directory holding a branch worktree is refused without changing files refs or registrations', { timeout: 20000 }, async (t) => {
  const here = world(t);
  const main = worktreeAt(here.repository, join(here.path, 'main'), 'persons-work');
  const kept = join(main, 'kept');
  writeFileSync(kept, 'uncommitted work\n');
  await unchanged(here, () => here.make({ head: here.head }), kept);
});

// R-WORK-22: the worktree handed as repository is never removed.
// proves R-WORK-32
test('an escalation directory holding the handed repository is refused unchanged', { timeout: 20000 }, async (t) => {
  const here = world(t);
  const made = await here.make({ head: here.head });
  const kept = join(made.main, 'kept');
  writeFileSync(kept, 'handed worktree\n');
  await unchanged(here, () => here.make({ repository: made.main, head: here.head }), kept);
});

// R-WORK-23: an unlisted nested worktree prevents replacement.
// proves R-WORK-32
test('an escalation directory with another worktree nested inside main is refused unchanged', { timeout: 20000 }, async (t) => {
  const here = world(t);
  const made = await here.make({ head: here.head });
  detachedWorktreeAt(here.repository, join(made.main, 'nested'), here.main);
  const kept = join(made.main, 'kept');
  writeFileSync(kept, 'nested worktree must stay\n');
  await unchanged(here, () => here.make({ head: here.head }), kept);
});

/** Actual L1 failure, then real L2's first/second-start decisions under that exact failure. */
async function notStarted(t, configure, naming) {
  const here = world(t);
  const made = await here.make();
  const request = { answer: { role: 'pm', provider: 'stand-in', tier: 'high', agent: '.claude/agents/pm.md', instruction: '', evidence: '' },
    cwd: made.main, directory: made.path, scratch: made.scratch, repository: here.repository, reach: [], env: {}, sink: here.sink,
    id: 'd-11111111-2222-3333-4444-555555555555', card: 12,
    adapters: { 'stand-in': { invocation: async () => ({ command: '/usr/bin/true', args: [], input: Buffer.alloc(0), unset: [], env: {} }) } },
  };
  configure(request, here);
  let failed;
  await assert.rejects(roleDispatch(request), (failure) => {
    failed = failure;
    assert.equal(failure.code, 'NOT_STARTED');
    assert.match(failure.message, naming);
    assert.doesNotMatch(failure.message, /private-value/);
    return true;
  });
  const policy = await escalationWorld();
  const outcome = { status: 'rejected', reason: failed };
  assert.equal((await policy.l2.roleSettled(policy.card, policy.next, outcome)).action, 'again');
  const second = await policy.l2.roleSettled(policy.card, policy.next, outcome, { firstFailure: outcome });
  assert.deepEqual([second.action, second.category, second.raiser, second.destination], ['escalate', 'ambiguous', 'loop', 'owner']);
}

// proves R-ESCALATE-26
test('a nonabsolute scratch base is a role start failure counted by the one retry', { timeout: 20000 }, async (t) => {
  await notStarted(t, (request) => { request.scratch = 'relative'; }, /scratch.*no absolute path/);
});

// proves R-ESCALATE-26
test('a nonabsolute repository is a role start failure counted by the one retry', { timeout: 20000 }, async (t) => {
  await notStarted(t, (request) => { request.repository = 'relative'; }, /repository.*no absolute path/);
});

// proves R-ESCALATE-26
test('a forbidden adapter variable is a role start failure and its value is never logged', { timeout: 20000 }, async (t) => {
  await notStarted(t, (request) => {
    request.adapters['stand-in'].invocation = async () => ({ command: '/usr/bin/true', args: [], input: Buffer.alloc(0), unset: [], env: { DISALLOWED: 'private-value' } });
  }, /DISALLOWED.*no absolute path/);
});

// proves R-ESCALATE-26
test('a scratch make with no filesystem answer is NOT_STARTED and counts as the role retry', { timeout: 20000 }, async (t) => {
  await notStarted(t, (request, here) => {
    const parent = join(here.root, 'scratch');
    mkdirSync(parent);
    chmodSync(parent, 0);
    t.after(() => chmodSync(parent, 0o700));
  }, /scratch directory.*rigger-12/);
});

// The generic scratch catch is separate from the typed WORKSPACE_NOT_MADE report.
// proves R-ESCALATE-26
test('an untyped scratch setup failure still counts as a role start failure', { timeout: 20000 }, async (t) => {
  await notStarted(t, (request) => { request.sink = { emitter: () => { throw new Error('scratch setup unavailable'); } }; }, /scratch setup unavailable/);
});

/** A documented adapter invocation whose only variation is the environment it returns. */
function setting(request, env, unset = []) {
  request.adapters['stand-in'].invocation = async () => ({ command: '/usr/bin/true', args: [], input: Buffer.alloc(0), unset, env });
}

// proves R-ESCALATE-26
test('an adapter setting a git redirect counts as a role start failure', { timeout: 20000 }, async (t) => {
  await notStarted(t, (request) => setting(request, { GIT_DIR: request.directory }), /GIT_DIR.*redirects git/);
});

// proves R-ESCALATE-26
test('an adapter setting its own excluded variable counts as a role start failure', { timeout: 20000 }, async (t) => {
  await notStarted(t, (request) => setting(request, { DISALLOWED: request.directory }, ['DISALLOWED']), /DISALLOWED.*must not inherit/);
});

// proves R-ESCALATE-26
test('an adapter setting a path that cannot resolve counts as a role start failure', { timeout: 20000 }, async (t) => {
  await notStarted(t, (request) => {
    const link = join(request.directory, 'private-value');
    symlinkSync(link, link);
    setting(request, { DISALLOWED: link });
  }, /DISALLOWED.*cannot be resolved/);
});

// proves R-ESCALATE-26
test('an adapter setting a path outside both dispatch directories counts as a role start failure', { timeout: 20000 }, async (t) => {
  await notStarted(t, (request, here) => {
    const outside = join(here.directory, 'private-value');
    mkdirSync(outside);
    setting(request, { DISALLOWED: outside });
  }, /DISALLOWED.*outside both/);
});
