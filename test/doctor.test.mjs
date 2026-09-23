// ABOUTME: Tests `rigger doctor`: what each check asks the tool that owns its fact, what the
// ABOUTME: report says, what it exits with, and the source tree it refuses to run against.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { doctor, sameTree } from '../src/cli/doctor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// proves R-SAFE-5
test('doctor refuses the source tree it is running from, and asks nothing before it does', async () => {
  // `R-SAFE-5`: Rigger never runs against the source tree it is running from, because an agent it
  // dispatches can delete the runtime it is running under (`AGENTS.md`, "Self-hosting"). The
  // defect this catches is the verb that runs anyway and reports four green checks about the
  // arrangement the requirement forbids.
  //
  // The refusal has to come before any check, so the runner below throws for every command but
  // the one that identifies the tree: a check that ran would fail the test rather than quietly
  // passing. Git is exempt because asking it which repository the directory sits in is how the
  // tree gets named, which is the refusal's own work rather than a check.
  const asked = (command, args) => {
    if (command === 'git') return spawnSync(command, args, { encoding: 'utf8' });
    throw new Error(`doctor ran \`${command}\` before refusing`);
  };

  const ran = await doctor({ target: root, packageRoot: root, ask: asked });

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /source tree/);
  assert.ok(ran.text.includes(root), `the refusal never names the tree it refused:\n${ran.text}`);
});

// proves R-SAFE-5
test('a worktree beside the source tree is not the source tree, however its name begins', () => {
  // The defect this catches is the refusal written as a prefix comparison, which reads a sibling
  // as a child whenever its name begins with the same characters. It is live here: this
  // repository's worktrees are created in `rigger-worktrees/` beside the `rigger/` checkout, and
  // `'…/rigger-worktrees/card-1'.startsWith('…/rigger')` is true. A worktree is where a
  // dispatched maker works, so a refusal that reached one would refuse every card Rigger builds
  // itself with — and the tests written beside a prefix comparison would not catch it, because
  // the two directories it is usually shown are unrelated names.
  //
  // The two paths are asserted to be a prefix pair before the claim, so this keeps its bite if
  // the naming convention ever changes.
  const where = mkdtempSync(join(tmpdir(), 'rigger-siblings-'));
  const packageRoot = join(where, 'rigger');
  const worktree = join(where, 'rigger-worktrees', 'card-1');
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  assert.ok(worktree.startsWith(packageRoot), 'the two paths are no prefix pair, so this proves nothing');

  assert.equal(sameTree(worktree, packageRoot), false);
  // The other half of the claim: the comparison still refuses what it is for, so this shows a
  // reading narrowed to real containment rather than one widened to nothing.
  assert.equal(sameTree(packageRoot, packageRoot), true);
  assert.equal(sameTree(join(packageRoot, 'docs'), packageRoot), true);
  assert.equal(sameTree(packageRoot, join(packageRoot, 'node_modules', '@williacj', 'rigger')), true);
});

// proves R-SAFE-5
test('a second spelling of the source tree is still the source tree', () => {
  // A path is a name, and one directory can have several. The defect this catches is the
  // comparison done on the names: a link, a mount or a drive letter in another case gives a
  // second spelling that no string comparison reads as the tree it points at, and the run that
  // `R-SAFE-5` forbids goes ahead reporting four green checks.
  //
  // A link is the spelling every host has. It is made as a junction, which is the one kind of
  // directory link Windows creates without elevation and which POSIX ignores in favour of an
  // ordinary symlink. Where the host refuses to make one at all there is nothing to measure, and
  // the test says so rather than passing quietly.
  const where = mkdtempSync(join(tmpdir(), 'rigger-spellings-'));
  const packageRoot = join(where, 'rigger');
  const second = join(where, 'by-another-name');
  mkdirSync(join(packageRoot, 'docs'), { recursive: true });
  try {
    symlinkSync(packageRoot, second, 'junction');
  } catch (refused) {
    assert.fail(`this host makes no directory link, so the second spelling cannot be measured: ${refused.message}`);
  }
  assert.notEqual(second, packageRoot, 'the two spellings are one string, so this proves nothing');

  assert.equal(sameTree(second, packageRoot), true);
  assert.equal(sameTree(join(second, 'docs'), packageRoot), true);
});

// proves R-SAFE-5
test('the tree compared is the repository, not the directory the command was run in', async () => {
  // A consumer runs `rigger doctor` from wherever they happen to be standing, and what it checks
  // is the repository. The defect this catches is the comparison made against that directory: an
  // engine installed into the repository's own `node_modules` — the arrangement where an agent
  // clearing that directory deletes the runtime mid-run — sits in neither `src/` nor above it, so
  // a run from `src/` compares two unrelated paths and goes ahead.
  //
  // Git is asked which repository the directory sits in (`D16` rule 1), so this is a real
  // repository rather than a path arrangement, and the premise is measured before the claim.
  const consumer = mkdtempSync(join(tmpdir(), 'rigger-consumer-'));
  assert.equal(spawnSync('git', ['-C', consumer, 'init', '-q'], { encoding: 'utf8' }).status, 0);
  const installed = join(consumer, 'node_modules', '@williacj', 'rigger');
  const from = join(consumer, 'src');
  mkdirSync(installed, { recursive: true });
  mkdirSync(from, { recursive: true });
  assert.equal(sameTree(from, installed), false, 'the two directories contain each other, so this proves nothing');

  const ran = await doctor({ target: from, packageRoot: installed });

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /source tree/);
});
