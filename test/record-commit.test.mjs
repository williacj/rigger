// ABOUTME: Tests the prepack script that records the commit a package was packed from: it writes
// HEAD's SHA only where nothing the pack carries differs from HEAD, removes a stale record
// otherwise, and the tarball npm makes carries the record it wrote.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { gitIn, repositoryAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = 'scripts/record-commit.mjs';
const RECORD = 'src/package-commit.json';

/** This repository's manifest and ignore file, so the temporary package packs as Rigger's does. */
const manifest = readFileSync(join(ROOT, 'package.json'), 'utf8');
const ignored = readFileSync(join(ROOT, '.gitignore'), 'utf8');

/**
 * A package at a new temporary directory shaped as Rigger's: its manifest, its ignore file, the
 * script under test and the module it imports, one module under src/, templates/ and scripts/
 * each, committed where `git` says so.
 */
function packageAt({ git = true } = {}) {
  const root = temporaryDirectory('rigger-record-commit-');
  const files = {
    'package.json': manifest,
    '.gitignore': ignored,
    'src/module.mjs': 'export const one = 1;\n',
    'templates/template.txt': 'a template\n',
    'scripts/other.mjs': 'export const two = 2;\n',
  };
  if (!git) {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  } else {
    repositoryAt(root, files);
  }
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(join(ROOT, SCRIPT), join(root, SCRIPT));
  // The one module the script imports, from where the package holds it.
  mkdirSync(join(root, 'src/substrate'), { recursive: true });
  copyFileSync(join(ROOT, 'src/substrate/git-environment.mjs'), join(root, 'src/substrate/git-environment.mjs'));
  if (git) {
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-qm', 'the script');
  }
  return root;
}

/** Runs the script in `root` as npm's prepack would, and answers what it printed on stdout. */
function record(root) {
  const ran = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8', env: gitEnvironment() });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout;
}

/** The commit the record at `root` holds, or null where there is none. */
const recorded = (root) => (existsSync(join(root, RECORD)) ? JSON.parse(readFileSync(join(root, RECORD), 'utf8')).commit : null);

test('the script writes HEAD\'s SHA to src/package-commit.json where nothing the pack carries differs from HEAD, and prints nothing on stdout', () => {
  const root = packageAt();

  assert.equal(record(root), '');

  assert.equal(recorded(root), gitIn(root, 'rev-parse', 'HEAD').trim());
  assert.match(recorded(root), /^[0-9a-f]{40}$/);
  // The record is ignored, so writing it leaves the tree as it was.
  assert.equal(gitIn(root, 'status', '--porcelain'), '');
});

test('the script writes no commit, and removes a record already there, where a path the pack carries differs from HEAD: changed, staged, deleted, or untracked', () => {
  const changes = {
    changed: (root) => writeFileSync(join(root, 'src/module.mjs'), 'export const one = 2;\n'),
    staged: (root) => {
      writeFileSync(join(root, 'templates/template.txt'), 'changed\n');
      gitIn(root, 'add', 'templates/template.txt');
    },
    deleted: (root) => rmSync(join(root, 'scripts/other.mjs')),
    untracked: (root) => writeFileSync(join(root, 'src/new.mjs'), 'export const three = 3;\n'),
    manifest: (root) => writeFileSync(join(root, 'package.json'), manifest.replace('"version": "0.0.0"', '"version": "0.0.1"')),
  };
  for (const [name, change] of Object.entries(changes)) {
    const root = packageAt();
    record(root);
    assert.notEqual(recorded(root), null, name);
    change(root);

    record(root);

    assert.equal(recorded(root), null, name);
  }
});

test('a file the pack carries from under a directory git ignores, absent from HEAD, removes the record', () => {
  const root = packageAt();
  record(root);
  assert.notEqual(recorded(root), null);
  writeFileSync(join(root, '.git/info/exclude'), 'src/ignored/\n');
  mkdirSync(join(root, 'src/ignored'));
  writeFileSync(join(root, 'src/ignored/extra.mjs'), 'export const extra = 1;\n');
  // npm packs it, though git reports only its directory, and only as ignored.
  const listed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'], { cwd: root, encoding: 'utf8', env: gitEnvironment() }));
  assert.ok(listed[0].files.some((file) => file.path === 'src/ignored/extra.mjs'), JSON.stringify(listed[0].files.map((file) => file.path)));

  record(root);

  assert.equal(recorded(root), null);
});

test('a change to a path the pack does not carry leaves the record written', () => {
  const root = packageAt();
  writeFileSync(join(root, 'notes.txt'), 'not packed\n');
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test/a.test.mjs'), 'not packed\n');

  record(root);

  assert.equal(recorded(root), gitIn(root, 'rev-parse', 'HEAD').trim());
});

test('the script writes no commit, and removes a record already there, where the package is outside a git repository', () => {
  const root = packageAt({ git: false });
  writeFileSync(join(root, RECORD), JSON.stringify({ commit: 'a'.repeat(40) }));

  record(root);

  assert.equal(recorded(root), null);
});

test('where the script recorded a commit, the tarball npm pack makes holds src/package-commit.json with that commit', () => {
  const root = packageAt();
  const into = temporaryDirectory('rigger-record-commit-pack-');

  const packed = execFileSync('npm', ['pack', '--json', '--loglevel=error', '--pack-destination', into], { cwd: root, encoding: 'utf8', env: gitEnvironment() });
  const [{ filename }] = JSON.parse(packed);
  const held = execFileSync('tar', ['-xzOf', join(into, filename), `package/${RECORD}`], { encoding: 'utf8' });

  assert.equal(JSON.parse(held).commit, gitIn(root, 'rev-parse', 'HEAD').trim());
});
