// ABOUTME: Proves real Git snapshot list reads at two commits without changing the checked-out tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDirectory } from './temporary-directory.mjs';
import { fileURLToPath } from 'node:url';
import { gitFacts } from '../.github/scripts/check-test-list-growth.mjs';
import { repositoryIn, gitIn } from './git-repository.mjs';

// The checked-out suite supplies its actual validation premises; no transitional list is copied.
test('real list reads distinguish two committed suite snapshots and leave the checkout alone', () => {
  const suite = readFileSync(new URL('./suite.sh', import.meta.url), 'utf8');
  const files = { 'test/suite.sh': suite };
  for (const mode of ['host', 'converting', 'awaiting']) {
    for (const path of execFileSync('sh', ['test/suite.sh', '--list', mode], { encoding: 'utf8' }).trim().split('\n')) {
      files[path] = '// ABOUTME: Satisfies the real suite list validation in a Git fixture.\n';
    }
  }
  const root = repositoryIn('rigger-list-growth-', files);
  const before = gitIn(root, 'rev-parse', 'HEAD').trim();
  const reduced = suite.replace('test/absorption-check.test.mjs\n', '')
    .replace(/(awaiting_tests='[\s\S]*?)test\/workflow-files.test.mjs\n/, '$1');
  assert.notEqual(reduced, suite, 'fixture must shrink the real lists');
  writeFileSync(join(root, 'test/suite.sh'), reduced);
  gitIn(root, 'add', 'test/suite.sh');
  gitIn(root, 'commit', '-qm', 'shrink both transitional lists');
  const after = gitIn(root, 'rev-parse', 'HEAD').trim();
  const facts = gitFacts(root, before);
  assert.equal(facts.listsExist(before), true);
  assert.equal(gitFacts(root, after).listsExist(before), false, 'a file existing before introduction does not establish ancestry');
  assert.equal(facts.mergeBase(before, after), before);
  assert.equal(facts.firstParent(after), before);
  assert.equal(facts.firstParent(before), null);
  assert.equal(facts.present(before), true);
  assert.equal(facts.present('f'.repeat(40)), false);
  const initial = facts.readLists(before);
  const final = facts.readLists(after);
  assert.equal(initial.converting.includes('test/absorption-check.test.mjs'), true);
  assert.equal(final.converting.includes('test/absorption-check.test.mjs'), false);
  assert.equal(initial.awaiting.includes('test/workflow-files.test.mjs'), true);
  assert.equal(final.awaiting.includes('test/workflow-files.test.mjs'), false);
  assert.deepEqual(final.converting, initial.converting.filter((path) => path !== 'test/absorption-check.test.mjs'));
  assert.deepEqual(final.awaiting, initial.awaiting.filter((path) => path !== 'test/workflow-files.test.mjs'));
  assert.equal(readFileSync(join(root, 'test/suite.sh'), 'utf8'), reduced);
  assert.equal(gitIn(root, 'status', '--porcelain'), '');
});

test('the actual CLI reads the event file and returns failure for an unsupported event and ref', () => {
  const directory = temporaryDirectory('rigger-list-event-');
  const event = join(directory, 'event.json');
  writeFileSync(event, JSON.stringify({ repository: { default_branch: 'main' } }));
  const ran = spawnSync(process.execPath, [fileURLToPath(new URL('../.github/scripts/check-test-list-growth.mjs', import.meta.url))], {
    cwd: directory, encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: 'release', GITHUB_REF: 'refs/tags/v1', GITHUB_SHA: 'a'.repeat(40) },
  });
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stderr, /unsupported event release at ref refs\/tags\/v1/);
});

test('both actual CI worker commands propagate script failure before npm test', () => {
  const directory = temporaryDirectory('rigger-list-worker-');
  const event = join(directory, 'event.json');
  writeFileSync(event, JSON.stringify({ repository: { default_branch: 'main' } }));
  const source = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const name of ['fast', 'nightly']) {
    const job = source.split('\n  ' + name + ':\n')[1].split(/\n  [a-z_]+:\n/)[0];
    const command = job.split('      - run: ').find((step) => step.startsWith('node .github/scripts/check-test-list-growth.mjs\n')).trim();
    const ran = spawnSync('sh', ['-e', '-c', command + '\nprintf npm-test-reached'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
      env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: 'release', GITHUB_REF: 'refs/tags/v1', GITHUB_SHA: 'a'.repeat(40) },
    });
    assert.equal(ran.status, 1, name + ': ' + ran.stdout + ran.stderr);
    assert.match(ran.stderr, /unsupported event release at ref refs\/tags\/v1/);
    assert.doesNotMatch(ran.stdout, /npm-test-reached/);
  }
});
