// ABOUTME: Proves the suite and temporary-directory helper use one real path identity across
// stored-case and mixed-case APFS aliases for checkout and caller TMPDIR.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { temporaryDirectory } from './temporary-directory.mjs';

const CASE_CHILD = 'RIGGER_PATH_SPELLING_CHILD';

function changedCase(path) {
  const name = basename(path);
  const index = [...name].findIndex((letter) => /[a-z]/i.test(letter));
  assert.notEqual(index, -1, `path-spelling: no alphabetic directory name in ${path}`);
  const letter = name[index];
  const replacement = letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase();
  return join(dirname(path), name.slice(0, index) + replacement + name.slice(index + 1));
}

function sameDirectory(stored, alias, label) {
  const a = statSync(stored);
  const b = statSync(alias);
  assert.equal(a.dev, b.dev, `path-spelling ${label}: device differs`);
  assert.equal(a.ino, b.ino, `path-spelling ${label}: inode differs`);
  console.log(`path-spelling identity ${label}: stored=${stored} alias=${alias} device=${a.dev} inode=${a.ino}`);
}

if (process.env[CASE_CHILD] === '1') {
  test('path-spelling: suite and temporary fixture return stored directory identity', () => {
    // The host tier requires each test to exercise a real process boundary.
    const child = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);

    const checkout = realpathSync.native(process.cwd());
    assert.equal(process.cwd(), checkout, 'path-spelling checkout: suite retained alias spelling');
    const suiteTmp = realpathSync.native(process.env.TMPDIR);
    assert.equal(process.env.TMPDIR, suiteTmp, 'path-spelling caller TMPDIR: suite retained alias spelling');
    const fixture = temporaryDirectory('rigger-path-spelling-');
    assert.equal(fixture, realpathSync.native(fixture), 'path-spelling fixture: returned alias spelling');
  });
} else {
  test('path-spelling: stored and mixed checkout/TMPDIR aliases have one suite identity', {
    skip: process.platform !== 'darwin' && 'case-insensitive APFS required',
  }, () => {
    const checkout = realpathSync.native(process.cwd());
    const checkoutAlias = changedCase(checkout);
    const callerTmp = realpathSync.native(temporaryDirectory('rigger-path-spelling-caller-'));
    const callerAlias = changedCase(callerTmp);
    sameDirectory(checkout, checkoutAlias, 'checkout');
    sameDirectory(callerTmp, callerAlias, 'caller TMPDIR');

    const cases = [
      ['stored checkout + stored TMPDIR', checkout, callerTmp],
      ['mixed checkout + stored TMPDIR', checkoutAlias, callerTmp],
      ['stored checkout + mixed TMPDIR', checkout, callerAlias],
      ['mixed checkout + mixed TMPDIR', checkoutAlias, callerAlias],
    ];
    const failures = [];
    for (const [name, cwd, tmp] of cases) {
      const ran = spawnSync('sh', ['test/suite.sh', '--host', 'test/path-spelling.test.mjs'], {
        cwd, encoding: 'utf8', env: { ...process.env, [CASE_CHILD]: '1', TMPDIR: tmp },
      });
      const executed = ran.stdout.includes('ℹ tests 1')
        && ran.stdout.includes('ℹ pass 1')
        && ran.stdout.includes('ℹ fail 0')
        && ran.stdout.includes('ℹ cancelled 0')
        && ran.stdout.includes('ℹ skipped 0');
      console.log(`path-spelling case ${name}: ${ran.status === 0 && executed ? 'pass' : 'fail'}`);
      if (ran.status !== 0 || !executed) failures.push(`${name}: ${ran.stdout}\n${ran.stderr}`);
    }
    assert.deepEqual(failures, [], `path-spelling cases failed:\n${failures.join('\n')}`);

    for (const file of ['test/claude-sweep-home.test.mjs', 'test/temporary-directory.test.mjs']) {
      const ran = spawnSync('sh', ['test/suite.sh', file], {
        cwd: checkout, encoding: 'utf8', env: { ...process.env, TMPDIR: callerAlias },
      });
      assert.equal(ran.status, 0, `path-spelling mixed TMPDIR boundary ${file}: ${ran.stdout}\n${ran.stderr}`);
    }
  });
}
