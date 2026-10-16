// ABOUTME: Exercises the record of trees a green suite passed: the commit and merge hooks write it,
// and the push hook skips the suite when every pushed tip's tree is in it. Real hooks, real local
// pushes to a bare remote, and a stub `npm` first on PATH in place of the suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { bareCloneInto, cloneInto, gitIn, repositoryAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const source = join(dirname(fileURLToPath(import.meta.url)), '..', '.githooks');

/** The record's name under the directory `git rev-parse --git-dir` names. */
const RECORD = 'rigger-suite-green-trees';

/** The refusal `refuse-if-suite-red` gives, read off it by hand. */
const RED = 'refused: the suite is not green.';

/**
 * A clone of a bare remote whose default branch is `main`, running this repository's four hooks,
 * with a stub `npm` that counts each run, runs the script `during` names if there is one, and
 * exits with the status `status` holds.
 */
function fixture() {
  const directory = temporaryDirectory('rigger-suite-record-');
  const origin = repositoryAt(join(directory, 'source'), { README: 'first\n', '.gitignore': 'ignored/\n' });
  gitIn(origin, 'branch', '-M', 'main');
  const remote = bareCloneInto(origin, join(directory, 'remote.git'));
  const clone = cloneInto(remote, join(directory, 'clone'));
  gitIn(clone, 'config', 'user.email', 'fixture@example.invalid');
  gitIn(clone, 'config', 'user.name', 'fixture');

  const hooks = join(directory, 'hooks');
  mkdirSync(hooks);
  for (const name of ['pre-commit', 'pre-merge-commit', 'pre-push', 'refuse-if-suite-red']) {
    copyFileSync(join(source, name), join(hooks, name));
    chmodSync(join(hooks, name), 0o755);
  }
  gitIn(clone, 'config', 'core.hooksPath', hooks);

  const stub = join(directory, 'stub');
  mkdirSync(join(stub, 'bin'), { recursive: true });
  writeFileSync(join(stub, 'bin', 'npm'), [
    '#!/bin/sh',
    '# ABOUTME: Stands in for the suite in this fixture: counts the run, runs any script queued for it, exits as told.',
    'printf "run\\n" >> "$SUITE_STUB/calls"',
    'if [ -f "$SUITE_STUB/during" ]; then sh "$SUITE_STUB/during"; fi',
    'exit "$(cat "$SUITE_STUB/status" 2>/dev/null || echo 0)"',
    '',
  ].join('\n'));
  chmodSync(join(stub, 'bin', 'npm'), 0o755);

  const { GIT_REFLOG_ACTION, ...inherited } = gitEnvironment();
  const env = { ...inherited, SUITE_STUB: stub, PATH: `${join(stub, 'bin')}:${process.env.PATH}` };
  const command = (program, args) => spawnSync(program, args, { cwd: clone, encoding: 'utf8', env });
  const git = (...args) => command('git', ['-C', clone, ...args]);
  const record = join(clone, '.git', RECORD);
  return {
    clone,
    remote,
    git,
    record,
    /** Every line the record holds, or none where there is no record. */
    recorded: () => (existsSync(record) ? readFileSync(record, 'utf8').split('\n').filter(Boolean) : []),
    /** How many times the suite has run since the last `reset`. */
    runs: () => (existsSync(join(stub, 'calls')) ? readFileSync(join(stub, 'calls'), 'utf8').split('\n').filter(Boolean).length : 0),
    reset: () => rmSync(join(stub, 'calls'), { force: true }),
    red: () => writeFileSync(join(stub, 'status'), '1\n'),
    during: (script) => writeFileSync(join(stub, 'during'), script),
    calm: () => rmSync(join(stub, 'during'), { force: true }),
    tree: (rev = 'HEAD') => gitIn(clone, 'rev-parse', `${rev}^{tree}`).trim(),
    refs: () => gitIn(remote, 'for-each-ref', '--format=%(refname) %(objectname)'),
    write: (path, content) => {
      mkdirSync(dirname(join(clone, path)), { recursive: true });
      writeFileSync(join(clone, path), content);
    },
  };
}

/** Runs `git` in the fixture and refuses a non-zero status, giving git's own words. */
function ok(f, ...args) {
  const result = f.git(...args);
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result;
}

/** A commit of `path` holding `content` on the current branch, through the hooks. */
function commit(f, path, content, ...options) {
  f.write(path, content);
  ok(f, 'add', path);
  return ok(f, 'commit', '-qm', `${path} ${content.trim()}`, ...options);
}

/** No record file shows in `git status`, whatever the test did to the repository. */
function untracked(f) {
  assert.doesNotMatch(f.git('status', '--porcelain', '--untracked-files=all', '--ignored').stdout, new RegExp(RECORD));
}

test('a green commit on a working tree equal to its tree records that tree', () => {
  const f = fixture();
  commit(f, 'one', 'one\n');
  assert.deepEqual(f.recorded(), [f.tree()]);
  assert.equal(f.runs(), 1);
  untracked(f);
});

test('a green commit whose working tree differs from its tree only by an ignored file records that tree', () => {
  const f = fixture();
  f.write('ignored/build.log', 'built\n');
  commit(f, 'one', 'one\n');
  assert.deepEqual(f.recorded(), [f.tree()]);
  untracked(f);
});

test('a green merge commit on a working tree equal to its tree records the merge tree', () => {
  const f = fixture();
  ok(f, 'switch', '-qc', 'topic');
  commit(f, 'topic', 'topic\n');
  ok(f, 'switch', '-q', 'main');
  commit(f, 'main', 'main\n');
  f.reset();
  ok(f, 'merge', '-q', '--no-ff', '-m', 'merge topic', 'topic');
  assert.equal(f.runs(), 1, 'the merge did not run pre-merge-commit');
  assert.ok(f.recorded().includes(f.tree()), `the record lacks the merge tree: ${f.recorded()}`);
  untracked(f);
});

test('a green commit beside an unstaged change to a tracked file lands and records nothing', () => {
  const f = fixture();
  f.write('README', 'changed, not staged\n');
  const before = f.tree();
  commit(f, 'one', 'one\n');
  assert.notEqual(f.tree(), before, 'the commit did not land');
  assert.deepEqual(f.recorded(), []);
  untracked(f);
});

test('a green commit beside an untracked file .gitignore does not exclude lands and records nothing', () => {
  const f = fixture();
  f.write('stray', 'not ignored\n');
  const before = f.tree();
  commit(f, 'one', 'one\n');
  assert.notEqual(f.tree(), before, 'the commit did not land');
  assert.deepEqual(f.recorded(), []);
  untracked(f);
});

test('a green commit whose tracked file changes during the suite, left unstaged, lands and records nothing', () => {
  const f = fixture();
  f.during('printf "changed during the suite\\n" > README\n');
  const before = f.tree();
  commit(f, 'one', 'one\n');
  assert.notEqual(f.tree(), before, 'the commit did not land');
  assert.equal(f.runs(), 1);
  assert.deepEqual(f.recorded(), []);
  untracked(f);
});

test('a green commit whose tracked file changes during the suite and is staged lands and records nothing', () => {
  const f = fixture();
  f.during('printf "staged during the suite\\n" > README && git add README\n');
  commit(f, 'one', 'one\n');
  assert.equal(gitIn(f.clone, 'show', 'HEAD:README'), 'staged during the suite\n',
    'the commit did not take the change staged during the suite, so this test proves nothing');
  assert.equal(f.runs(), 1);
  assert.ok(!f.recorded().includes(f.tree()), `the record holds a tree the suite never ran on: ${f.recorded()}`);
  untracked(f);
});

test('a green commit beside a tracked change git is told to assume unchanged lands and records nothing', () => {
  const f = fixture();
  f.write('README', 'changed, hidden from git diff\n');
  ok(f, 'update-index', '--assume-unchanged', 'README');
  assert.equal(f.git('diff', '--quiet').status, 0, 'git diff saw the change, so this test proves nothing');
  const before = f.tree();
  commit(f, 'one', 'one\n');
  assert.notEqual(f.tree(), before, 'the commit did not land');
  assert.ok(!f.recorded().includes(f.tree()), `the record holds a tree the working tree differs from: ${f.recorded()}`);
  untracked(f);
});

test('a green commit whose tracked file git assumes unchanged changes during the suite lands and records nothing', () => {
  const f = fixture();
  ok(f, 'update-index', '--assume-unchanged', 'README');
  f.during('printf "changed during the suite, hidden from git diff\\n" > README\n');
  const before = f.tree();
  commit(f, 'one', 'one\n');
  assert.notEqual(f.tree(), before, 'the commit did not land');
  assert.equal(f.runs(), 1);
  assert.equal(readFileSync(join(f.clone, 'README'), 'utf8'), 'changed during the suite, hidden from git diff\n');
  assert.ok(!f.recorded().includes(f.tree()), `the record holds a tree the working tree differs from: ${f.recorded()}`);
  untracked(f);
});

test('a red suite refuses a commit with the existing text and records nothing', () => {
  const f = fixture();
  f.red();
  const head = gitIn(f.clone, 'rev-parse', 'HEAD');
  f.write('one', 'one\n');
  ok(f, 'add', 'one');
  const result = f.git('commit', '-qm', 'one');
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(RED), result.stderr);
  assert.equal(gitIn(f.clone, 'rev-parse', 'HEAD'), head, 'the commit landed despite the red suite');
  assert.ok(!f.recorded().includes(gitIn(f.clone, 'write-tree').trim()));
  untracked(f);
});

test('a red suite refuses a merge commit with the existing text and records nothing', () => {
  const f = fixture();
  ok(f, 'switch', '-qc', 'topic');
  commit(f, 'topic', 'topic\n');
  ok(f, 'switch', '-q', 'main');
  commit(f, 'main', 'main\n');
  f.red();
  const head = gitIn(f.clone, 'rev-parse', 'HEAD');
  const result = f.git('merge', '-q', '--no-ff', '-m', 'merge topic', 'topic');
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(RED), result.stderr);
  assert.equal(gitIn(f.clone, 'rev-parse', 'HEAD'), head, 'the merge landed despite the red suite');
  assert.ok(!f.recorded().includes(gitIn(f.clone, 'write-tree').trim()));
  untracked(f);
});

test('a commit on a tree already recorded still runs the suite', () => {
  const f = fixture();
  commit(f, 'one', 'one\n');
  assert.deepEqual(f.recorded(), [f.tree()]);
  f.reset();
  ok(f, 'commit', '-q', '--allow-empty', '-m', 'same tree');
  assert.equal(f.runs(), 1);
  assert.deepEqual(f.recorded(), [f.tree()]);
  untracked(f);
});

test('a commit made with --no-verify records nothing', () => {
  const f = fixture();
  commit(f, 'one', 'one\n', '--no-verify');
  assert.equal(f.runs(), 0);
  assert.deepEqual(f.recorded(), []);
  untracked(f);
});

/** The line `pre-push` gives when it skips the suite, read off it by hand. */
const SKIPPED = 'pre-push: the suite is skipped, because every pushed tree passed it already.';

/** A branch `name` off `main` holding one recorded commit of a file of its own, so its tree is its own. */
function recordedBranch(f, name) {
  ok(f, 'switch', '-q', 'main');
  ok(f, 'switch', '-qc', name);
  commit(f, name, `${name}\n`);
  assert.ok(f.recorded().includes(f.tree()), `the commit on ${name} was not recorded`);
  return f.tree();
}

/** A push the hook let through with the suite skipped: it landed, said so, and ran nothing. */
function skipped(f, args, refs) {
  f.reset();
  const result = f.git('push', ...args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.runs(), 0, 'the suite ran');
  assert.ok(result.stderr.includes(SKIPPED), result.stderr);
  for (const ref of refs) {
    assert.equal(gitIn(f.remote, 'rev-parse', ref), gitIn(f.clone, 'rev-parse', ref), `the remote does not hold ${ref}`);
  }
  untracked(f);
}

/** A push the hook let through only after running the suite once, green. */
function suiteRan(f, args, ref) {
  for (const tree of f.recorded()) assert.notEqual(tree, f.tree(ref), 'the pushed tip shares a recorded tree');
  f.reset();
  const before = existsSync(f.record) ? readFileSync(f.record) : null;
  const result = f.git('push', ...args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.runs(), 1, 'the suite did not run exactly once');
  assert.ok(!result.stderr.includes(SKIPPED), result.stderr);
  assert.equal(gitIn(f.remote, 'rev-parse', ref), gitIn(f.clone, 'rev-parse', ref), `the remote does not hold ${ref}`);
  assert.deepEqual(existsSync(f.record) ? readFileSync(f.record) : null, before, 'the push changed the record');
  untracked(f);
}

/** A push the hook refused with `text`, leaving the remote as it was. */
function refusedPush(f, args, text, runs) {
  f.reset();
  const before = f.refs();
  const result = f.git('push', ...args);
  assert.notEqual(result.status, 0, result.stderr);
  assert.ok(result.stderr.includes(text), result.stderr);
  assert.equal(f.refs(), before, 'the bare remote changed despite the refusal');
  assert.equal(f.runs(), runs);
  untracked(f);
}

test('a push of one branch whose tip tree is recorded skips the suite and lands', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  skipped(f, ['origin', 'topic'], ['refs/heads/topic']);
});

test('a push of several branches whose distinct tip trees are each recorded skips the suite and lands', () => {
  const f = fixture();
  const one = recordedBranch(f, 'one');
  const two = recordedBranch(f, 'two');
  assert.notEqual(one, two);
  skipped(f, ['origin', 'one', 'two'], ['refs/heads/one', 'refs/heads/two']);
});

test('a push of an annotated tag whose commit tree is recorded skips the suite and lands', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  ok(f, 'tag', '-a', 'v1', '-m', 'v1');
  skipped(f, ['origin', 'v1'], ['refs/tags/v1']);
});

test('a push of a rebased tip whose tree was never recorded runs the suite', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  recordedBranch(f, 'base');
  ok(f, 'switch', '-q', 'topic');
  ok(f, 'rebase', '-q', 'base');
  suiteRan(f, ['origin', 'topic'], 'refs/heads/topic');
});

test('a push of a cherry-picked tip whose tree was never recorded runs the suite', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  recordedBranch(f, 'pick');
  ok(f, 'cherry-pick', 'topic');
  suiteRan(f, ['origin', 'pick'], 'refs/heads/pick');
});

test('a push of a tip committed with --no-verify runs the suite', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  commit(f, 'unchecked', 'unchecked\n', '--no-verify');
  suiteRan(f, ['origin', 'topic'], 'refs/heads/topic');
});

test('a push of a tag pointing at a tree runs the suite', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  f.write('loose', 'loose\n');
  ok(f, 'add', 'loose');
  ok(f, 'tag', 't', gitIn(f.clone, 'write-tree').trim());
  suiteRan(f, ['origin', 't'], 'refs/tags/t');
});

test('a push of several branches with one tip tree unrecorded runs the suite once and leaves the record unchanged', () => {
  const f = fixture();
  recordedBranch(f, 'one');
  recordedBranch(f, 'two');
  commit(f, 'unchecked', 'unchecked\n', '--no-verify');
  suiteRan(f, ['origin', 'one', 'two'], 'refs/heads/two');
  assert.equal(gitIn(f.remote, 'rev-parse', 'refs/heads/one'), gitIn(f.clone, 'rev-parse', 'one'));
});

test('a push of several branches whose first tip tree is unrecorded runs the suite once and leaves the record unchanged', () => {
  const f = fixture();
  recordedBranch(f, 'a-unchecked');
  commit(f, 'unchecked', 'unchecked\n', '--no-verify');
  recordedBranch(f, 'b-checked');
  suiteRan(f, ['origin', 'a-unchecked', 'b-checked'], 'refs/heads/a-unchecked');
  assert.equal(gitIn(f.remote, 'rev-parse', 'refs/heads/b-checked'), gitIn(f.clone, 'rev-parse', 'b-checked'));
});

test('a push of deletions only skips the suite and deletes each remote ref', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  gitIn(f.remote, 'branch', 'gone', 'main');
  gitIn(f.remote, 'branch', 'went', 'main');
  skipped(f, ['origin', ':gone', ':went'], []);
  assert.doesNotMatch(f.refs(), /refs\/heads\/(gone|went)/);
});

test('a push of a deletion beside a recorded branch tip skips the suite and makes both changes', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  gitIn(f.remote, 'branch', 'gone', 'main');
  skipped(f, ['origin', ':gone', 'topic'], ['refs/heads/topic']);
  assert.doesNotMatch(f.refs(), /refs\/heads\/gone/);
});

test('a push with the record missing runs the suite', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  rmSync(f.record);
  suiteRan(f, ['origin', 'topic'], 'refs/heads/topic');
});

test('a push with the record empty runs the suite', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  writeFileSync(f.record, '');
  suiteRan(f, ['origin', 'topic'], 'refs/heads/topic');
});

test('a push with the record unreadable runs the suite', (t) => {
  const f = fixture();
  recordedBranch(f, 'topic');
  chmodSync(f.record, 0o000);
  t.after(() => chmodSync(f.record, 0o644));
  f.reset();
  const result = f.git('push', 'origin', 'topic');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.runs(), 1, 'the suite did not run');
  assert.equal(gitIn(f.remote, 'rev-parse', 'refs/heads/topic'), gitIn(f.clone, 'rev-parse', 'topic'));
  untracked(f);
});

test('a push to the default branch with every pushed tree recorded is refused before the suite', () => {
  const f = fixture();
  ok(f, 'switch', '-q', 'main');
  commit(f, 'main', 'main\n');
  assert.ok(f.recorded().includes(f.tree()));
  refusedPush(f, ['origin', 'main'], 'refused: a push to the default branch main is not allowed.', 0);
});

test('a push to a remote whose default branch is unknown, with every pushed tree recorded, is refused before the suite', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  ok(f, 'remote', 'set-head', 'origin', '-d');
  refusedPush(f, ['origin', 'topic'],
    'refused: the default branch for remote origin is unknown; run git remote set-head <remote> -a.', 0);
});

test('a push whose suite runs red is refused with the existing text', () => {
  const f = fixture();
  recordedBranch(f, 'topic');
  commit(f, 'unchecked', 'unchecked\n', '--no-verify');
  f.red();
  refusedPush(f, ['origin', 'topic'], RED, 1);
});
