// ABOUTME: Exercises the pre-push default-branch refusal with real local pushes to a bare remote.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { bareCloneInto, cloneInto, gitIn, repositoryAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const prePush = process.env.RIGGER_PRE_PUSH_HOOK
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.githooks', 'pre-push');

function fixture(defaultBranch) {
  const directory = temporaryDirectory('rigger-push-hook-');
  const source = repositoryAt(join(directory, 'source'), { README: 'first\n' });
  gitIn(source, 'branch', '-M', defaultBranch);
  const remote = bareCloneInto(source, join(directory, 'remote.git'));
  const clone = cloneInto(remote, join(directory, 'clone'));
  gitIn(clone, 'config', 'user.email', 'fixture@example.invalid');
  gitIn(clone, 'config', 'user.name', 'fixture');

  const hooks = join(directory, 'hooks');
  mkdirSync(hooks);
  copyFileSync(prePush, join(hooks, 'pre-push'));
  chmodSync(join(hooks, 'pre-push'), 0o755);
  writeFileSync(join(hooks, 'refuse-if-suite-red'), [
    '#!/bin/sh',
    '# ABOUTME: Marks that a push reached the suite check in this local Git fixture.',
    'printf "suite\\n" > "${0}.called"',
    '',
  ].join('\n'));
  chmodSync(join(hooks, 'refuse-if-suite-red'), 0o755);
  gitIn(clone, 'config', 'core.hooksPath', hooks);
  gitIn(clone, 'commit', '--allow-empty', '-qm', 'second');

  const { GIT_REFLOG_ACTION, ...env } = gitEnvironment();
  const command = (program, args, options = {}) => spawnSync(program, args, { cwd: clone, encoding: 'utf8', env, ...options });
  const git = (...args) => command('git', ['-C', clone, ...args]);
  const push = (...args) => git('push', ...args);
  const held = (branch) => gitIn(remote, 'rev-parse', `refs/heads/${branch}`).trim();
  const refs = () => gitIn(remote, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags');
  return { clone, remote, hooks, command, git, push, held, refs };
}

function refused(fixture, args, branch, execute = fixture.push) {
  const before = fixture.refs();
  const result = execute(...args);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /refused:/, 'the hook did not give the refusal reason');
  assert.match(result.stderr, new RegExp(branch));
  assert.equal(fixture.refs(), before, 'the bare remote changed despite the refusal');
  assert.equal(existsSync(join(fixture.hooks, 'refuse-if-suite-red.called')), false);
}

function permitted(fixture, args, ref) {
  const before = fixture.refs();
  const result = fixture.push(...args);
  assert.equal(result.status, 0, result.stderr);
  const after = fixture.refs();
  assert.notEqual(after, before, `the remote ref ${ref} did not move`);
  assert.ok(after.includes(ref), `the remote does not hold ${ref}`);
  assert.equal(existsSync(join(fixture.hooks, 'refuse-if-suite-red.called')), true);
}

function refusedWithoutDefault(fixture, args, remoteName) {
  const before = fixture.refs();
  const result = fixture.push(...args);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /refused:/, 'the hook did not give the refusal reason');
  assert.ok(result.stderr.includes(remoteName), `the refusal did not name ${remoteName}: ${result.stderr}`);
  assert.ok(result.stderr.includes('git remote set-head <remote> -a'), result.stderr);
  assert.equal(fixture.refs(), before, 'the bare remote changed despite the refusal');
  assert.equal(existsSync(join(fixture.hooks, 'refuse-if-suite-red.called')), false);
}

for (const defaultBranch of ['main', 'trunk']) {
  test(`a push to ${defaultBranch} is refused before the suite and leaves its remote ref unchanged`, () => {
    refused(fixture(defaultBranch), ['origin', defaultBranch], defaultBranch);
  });

  const refspecs = [
    ['HEAD:default', (branch) => ['origin', `HEAD:${branch}`]],
    ['@:default', (branch) => ['origin', `@:${branch}`]],
    ['topic:default', (branch) => ['origin', `topic:${branch}`], (f) => gitIn(f.clone, 'branch', 'topic')],
    ['HEAD:refs/heads/default', (branch) => ['origin', `HEAD:refs/heads/${branch}`]],
    ['matching refspec', () => ['origin', ':']],
    ['glob refspec', () => ['origin', 'refs/heads/*:refs/heads/*']],
    ['--all', () => ['origin', '--all']],
    ['--mirror', () => ['origin', '--mirror']],
    ['--repo option', () => ['--repo=origin'], (f, branch) => gitIn(f.clone, 'config', 'remote.origin.push', `HEAD:refs/heads/${branch}`)],
    ['set-upstream option', (branch) => ['-u', 'origin', branch]],
    ['follow-tags option', (branch) => ['--follow-tags', 'origin', branch], (f) => gitIn(f.clone, 'tag', '-a', 'v1', '-m', 'v1')],
    ['force refspec', (branch) => ['origin', `+HEAD:${branch}`]],
    ['delete refspec', (branch) => ['origin', `:${branch}`]],
    ['dry run', (branch) => ['--dry-run', 'origin', branch]],
  ];

  for (const [title, args, prepare] of refspecs) {
    test(`${title} targeting ${defaultBranch} is refused without changing the bare remote`, () => {
      const f = fixture(defaultBranch);
      prepare?.(f, defaultBranch);
      refused(f, args(defaultBranch), defaultBranch);
    });
  }

  for (const mode of ['current', 'upstream', 'simple', 'matching']) {
    test(`no-refspec push.default=${mode} on ${defaultBranch} is refused`, () => {
      const f = fixture(defaultBranch);
      gitIn(f.clone, 'config', 'push.default', mode);
      refused(f, ['origin'], defaultBranch);
    });
  }

  test(`bare HEAD with push.default=nothing on ${defaultBranch} is refused`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'config', 'push.default', 'nothing');
    refused(f, ['origin', 'HEAD'], defaultBranch);
  });

  test(`bare @ on ${defaultBranch} is refused`, () => {
    refused(fixture(defaultBranch), ['origin', '@'], defaultBranch);
  });

  test(`an upstream push from topic to ${defaultBranch} is refused`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'switch', '-q', '-c', 'topic');
    gitIn(f.clone, 'branch', '--set-upstream-to', `origin/${defaultBranch}`, 'topic');
    gitIn(f.clone, 'config', 'push.default', 'upstream');
    refused(f, ['origin'], defaultBranch);
  });

  test(`a configured remote.push to ${defaultBranch} is refused`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'config', 'remote.origin.push', `HEAD:refs/heads/${defaultBranch}`);
    refused(f, ['origin'], defaultBranch);
  });

  test(`an inline remote.push to ${defaultBranch} is refused`, () => {
    const f = fixture(defaultBranch);
    refused(f, ['origin'], defaultBranch, (...args) => f.git('-c', `remote.origin.push=HEAD:refs/heads/${defaultBranch}`, 'push', ...args));
  });

  test(`a named non-default branch push beside ${defaultBranch} moves its ref`, () => {
    const f = fixture(defaultBranch);
    const branch = defaultBranch === 'trunk' ? 'main' : 'topic';
    gitIn(f.clone, 'switch', '-q', '-c', branch);
    permitted(f, ['origin', branch], `refs/heads/${branch}`);
  });

  test(`a tag push beside ${defaultBranch} moves its ref`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'tag', 'v1');
    permitted(f, ['origin', 'v1'], 'refs/tags/v1');
  });

  test(`a named branch push with origin HEAD missing is refused beside ${defaultBranch}`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'switch', '-q', '-c', 'topic');
    gitIn(f.clone, 'remote', 'set-head', 'origin', '-d');
    refusedWithoutDefault(f, ['origin', 'topic'], 'origin');
  });

  test(`a no-refspec push with origin HEAD missing is refused beside ${defaultBranch}`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'switch', '-q', '-c', 'topic');
    gitIn(f.clone, 'config', 'push.default', 'current');
    gitIn(f.clone, 'remote', 'set-head', 'origin', '-d');
    refusedWithoutDefault(f, ['origin'], 'origin');
  });

  test(`setting origin HEAD repairs a named branch push beside ${defaultBranch}`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'switch', '-q', '-c', 'topic');
    gitIn(f.clone, 'remote', 'set-head', 'origin', '-d');
    refusedWithoutDefault(f, ['origin', 'topic'], 'origin');
    gitIn(f.clone, 'remote', 'set-head', 'origin', '-a');
    assert.equal(gitIn(f.clone, 'symbolic-ref', 'refs/remotes/origin/HEAD').trim(), `refs/remotes/origin/${defaultBranch}`);
    permitted(f, ['origin', 'topic'], 'refs/heads/topic');
  });

  test(`a URL push is refused where origin's default is ${defaultBranch}`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'switch', '-q', '-c', 'topic');
    refusedWithoutDefault(f, [f.remote, 'topic'], f.remote);
  });

  test(`a plain push from the clone to ${defaultBranch} is refused`, () => {
    const f = fixture(defaultBranch);
    refused(f, ['origin', defaultBranch], defaultBranch, (...args) => f.command('git', ['push', ...args]));
  });

  test(`a push to ${defaultBranch} after cd in the same command is refused`, () => {
    const f = fixture(defaultBranch);
    refused(f, [], defaultBranch, () => f.command('sh', [
      '-c', 'cd "$1" && git push origin "$2"', 'push-fixture', f.clone, defaultBranch,
    ], { cwd: dirname(f.clone) }));
  });

  test(`a push to ${defaultBranch} after git switch in the same command is refused`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'branch', 'topic');
    refused(f, [], defaultBranch, () => f.command('sh', [
      '-c', 'git switch -q topic && git push origin "HEAD:$1"', 'push-fixture', defaultBranch,
    ]));
  });

  test(`a push to ${defaultBranch} behind env is refused`, () => {
    const f = fixture(defaultBranch);
    refused(f, ['origin', defaultBranch], defaultBranch, (...args) => f.command('env', ['git', 'push', ...args]));
  });

  test(`a push to ${defaultBranch} with redirected output is refused`, () => {
    const f = fixture(defaultBranch);
    const output = join(dirname(f.clone), 'push-output');
    refused(f, [], defaultBranch, () => f.command('sh', [
      '-c', 'git push origin "$1" > "$2"', 'push-fixture', defaultBranch, output,
    ]));
  });
}
