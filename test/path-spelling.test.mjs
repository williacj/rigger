// ABOUTME: Proves the suite and temporary-directory helper use one real path identity across
// stored-case and mixed-case APFS aliases for checkout and caller TMPDIR.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
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
  if (!lstatSync(alias, { throwIfNoEntry: false })) return false;
  const b = statSync(alias);
  assert.equal(a.dev, b.dev, `path-spelling ${label}: device differs`);
  assert.equal(a.ino, b.ino, `path-spelling ${label}: inode differs`);
  console.log(`path-spelling identity ${label}: stored=${stored} alias=${alias} device=${a.dev} inode=${a.ino}`);
  return true;
}

function linkedTeardown(cwd, callerTmp, { removeOutside = false } = {}) {
  const outside = temporaryDirectory('rigger-path-spelling-outside-');
  const payload = join(outside, 'retained.txt');
  writeFileSync(payload, 'outside target stays');
  const root = realpathSync.native(callerTmp);
  const proofFile = join(root, 'link-teardown.test.mjs');
  const record = join(root, 'link-teardown-path');
  const helper = new URL('./temporary-directory.mjs', import.meta.url).href;
  const beforeRemoval = removeOutside
    ? `() => rmSync(${JSON.stringify(outside)}, { recursive: true, force: true })`
    : '() => {}';
  writeFileSync(proofFile, [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { lstatSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `import { temporaryDirectory } from ${JSON.stringify(helper)};`,
    "test('linked target is outside the temporary directory', (t) => {",
    `  const inside = temporaryDirectory('rigger-path-spelling-inside-', { context: t, beforeRemoval: ${beforeRemoval} });`,
    `  const link = join(inside, 'outside');`,
    `  symlinkSync(${JSON.stringify(outside)}, link, 'dir');`,
    "  assert.equal(lstatSync(link).isSymbolicLink(), true);",
    `  assert.equal(realpathSync.native(link), realpathSync.native(${JSON.stringify(outside)}));`,
    `  writeFileSync(${JSON.stringify(record)}, inside);`,
    "});",
  ].join('\n'));
  const ran = spawnSync('sh', ['test/suite.sh', proofFile], {
    cwd, encoding: 'utf8', env: { ...process.env, TMPDIR: callerTmp },
  });
  assert.equal(ran.status, 0, `path-spelling linked teardown child: ${ran.stdout}\n${ran.stderr}`);
  for (const answer of ['ℹ tests 1', 'ℹ pass 1', 'ℹ fail 0', 'ℹ cancelled 0', 'ℹ skipped 0']) {
    assert.ok(ran.stdout.includes(answer), `path-spelling linked teardown child lacked ${answer}: ${ran.stdout}`);
  }
  const inside = readFileSync(record, 'utf8');
  return { insideGone: !existsSync(inside), outsideIntact: existsSync(payload) && readFileSync(payload, 'utf8') === 'outside target stays' };
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
  test('path-spelling: an absent case alias is an unavailable premise', (t) => {
    // The host tier requires each test to exercise a real process boundary.
    const child = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const stored = realpathSync.native(temporaryDirectory('rigger-path-spelling-absent-'));
    const alias = changedCase(stored);
    if (lstatSync(alias, { throwIfNoEntry: false })) {
      t.skip('this filesystem resolves the mixed-case alias');
      return;
    }
    assert.equal(sameDirectory(stored, alias, 'controlled absent alias'), false,
      'path-spelling: an absent alias should report an unavailable premise');
  });

  test('path-spelling: an existing changed-case path to another directory fails identity', (t) => {
    // The host tier requires each test to exercise a real process boundary.
    const child = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const root = temporaryDirectory('rigger-path-spelling-identity-');
    const stored = join(root, 'stored');
    const alias = changedCase(stored);
    mkdirSync(stored);
    if (lstatSync(alias, { throwIfNoEntry: false })) {
      t.skip('this filesystem resolves the mixed-case alias');
      return;
    }
    mkdirSync(alias);
    assert.throws(() => sameDirectory(stored, alias, 'existing wrong alias'),
      /path-spelling existing wrong alias: inode differs/);
  });

  test('path-spelling: helper teardown removes a linked directory without following its target', () => {
    const callerTmp = realpathSync.native(temporaryDirectory('rigger-path-spelling-link-caller-'));
    const retained = linkedTeardown(realpathSync.native(process.cwd()), callerTmp);
    assert.equal(retained.insideGone, true, 'path-spelling: helper left its inside directory after teardown');
    assert.equal(retained.outsideIntact, true, 'path-spelling: helper followed the inside link to its outside target');

    const wrong = linkedTeardown(realpathSync.native(process.cwd()), callerTmp, { removeOutside: true });
    assert.equal(wrong.insideGone, true, 'path-spelling: wrong-behavior fixture did not reach teardown');
    assert.equal(wrong.outsideIntact, false, 'path-spelling: outside-target assertion cannot detect wrong teardown');
  });

  test('path-spelling: stored and mixed checkout/TMPDIR aliases have one suite identity', {
    skip: process.platform !== 'darwin' && 'case-insensitive APFS required',
  }, (t) => {
    const checkout = realpathSync.native(process.cwd());
    const checkoutAlias = changedCase(checkout);
    const callerTmp = realpathSync.native(temporaryDirectory('rigger-path-spelling-caller-'));
    const callerAlias = changedCase(callerTmp);
    if (!sameDirectory(checkout, checkoutAlias, 'checkout')) {
      t.skip('case-insensitive checkout alias is absent');
      return;
    }
    if (!sameDirectory(callerTmp, callerAlias, 'caller TMPDIR')) {
      t.skip('case-insensitive caller TMPDIR alias is absent');
      return;
    }

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

    const linked = linkedTeardown(checkout, callerAlias);
    assert.equal(linked.insideGone, true, 'path-spelling mixed TMPDIR: helper left its inside directory after teardown');
    assert.equal(linked.outsideIntact, true, 'path-spelling mixed TMPDIR: helper followed the inside link to its outside target');
    console.log('path-spelling mixed TMPDIR link containment: inside removed, outside retained');

    for (const file of ['test/claude-sweep-home.test.mjs', 'test/temporary-directory.test.mjs']) {
      const ran = spawnSync('sh', ['test/suite.sh', file], {
        cwd: checkout, encoding: 'utf8', env: { ...process.env, TMPDIR: callerAlias },
      });
      assert.equal(ran.status, 0, `path-spelling mixed TMPDIR boundary ${file}: ${ran.stdout}\n${ran.stderr}`);
    }
  });
}
