// ABOUTME: Builds committed proof fixtures with the real suite and checks their files and worktrees after each command.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../src/substrate/process.mjs';
import { gitIn, repositoryAt } from './git-repository.mjs';
import { worktreeList } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const imports = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../subject.mjs';\n";
export const source = (value) => `export const value = ${value};\n`;

// test/suite.sh owns this refusal and its inner TMPDIR relationship.
export const forgeBody = "import { spawnSync } from 'node:child_process';\ntest('forge refused', () => { assert.ok(process.env.RIGGER_REFUSING_GH_DIR.startsWith(process.env.TMPDIR + '/')); const ran = spawnSync('gh', ['--version'], { encoding: 'utf8' }); assert.notEqual(ran.status, 0); assert.match(ran.stderr, /gh: refused under npm test/); console.log(ran.stderr); });\n";

/** The suite itself decides its placements; placeholders satisfy its real list validation. */
export function proofRepository(t, { base = source(1), head = base, body = "test('value stays one', () => assert.equal(value, 1, 'value must stay one'));\n", host = false, headFiles = {} } = {}) {
  const directory = temporaryDirectory('976-proof-', { context: t });
  const root = join(directory, 'repository');
  const tmp = join(directory, 'tmp');
  mkdirSync(tmp);
  const file = host ? 'test/package.test.mjs' : 'test/cell.test.mjs';
  const files = { 'subject.mjs': base, 'package.json': '{"type":"module","devDependencies":{"acorn":"8.18.0"}}\n' };
  for (const mode of ['host', 'awaiting', 'converting']) {
    for (const path of execFileSync('sh', ['test/suite.sh', '--list', mode], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n')) {
      files[path] = '// ABOUTME: Satisfies the real suite list validation in a proof fixture.\n';
    }
  }
  for (const path of ['test/suite.sh', 'test/suite-reaper', 'test/suite-guard.cjs', 'test/suite-path.cjs', 'test/temporary-directory.mjs', 'test/process-fixtures.mjs', 'test/on-path.mjs']) {
    files[path] = readFileSync(join(ROOT, path));
  }
  repositoryAt(root, files);
  cpSync(join(ROOT, 'src'), join(root, 'src'), { recursive: true });
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-qm', 'suite substrate');
  const baseSha = gitIn(root, 'rev-parse', 'HEAD').trim();
  gitIn(root, 'update-ref', 'refs/remotes/origin/main', baseSha);
  for (const [path, content] of Object.entries({ 'subject.mjs': head, [file]: imports + body, ...headFiles })) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-qm', 'behaviour and its tests');
  const headSha = gitIn(root, 'rev-parse', 'HEAD').trim();
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
  // The scripts must use the commit, preserving even conflicting local source and test edits.
  writeFileSync(join(root, 'subject.mjs'), source(999));
  writeFileSync(join(root, 'test', 'checkout-only.mjs'), 'checkout-only bytes\n');
  return { t, directory, root, tmp, file, baseSha, headSha };
}

/** Files, link targets and directory names outside Git metadata, including untracked files. */
function checkoutBytes(root) {
  const walk = (at, prefix = '') => readdirSync(at, { withFileTypes: true }).filter((e) => e.name !== '.git').flatMap((e) => {
    const path = join(at, e.name);
    const name = join(prefix, e.name);
    if (e.isSymbolicLink()) return [[name, 'link', readlinkSync(path)]];
    if (e.isDirectory()) return [[name, 'directory'], ...walk(path, name)];
    return [[name, readFileSync(path).toString('base64')]];
  });
  return walk(root).sort((a, b) => a[0].localeCompare(b[0]));
}

/** Every invocation, including a refusal, must leave the checkout and worktree inventory intact. */
export async function invoke(fixture, script, args, env = {}, { cleanupRefusal } = {}) {
  const { t, root, tmp, directory } = fixture;
  const before = checkoutBytes(root);
  const worktrees = worktreeList(root);
  const scratch = readdirSync(tmp);
  const ran = await runCommand({
    command: process.execPath, args: [join(ROOT, 'scripts', script), ...args], cwd: root,
    env: { ...process.env, TMPDIR: tmp, ...env }, timeout: 15_000,
    directory, emitter: { emit() {} },
  });
  if (cleanupRefusal) await cleanupRefusal(Object.freeze({ exit: ran.exit, timedOut: ran.timedOut,
    stdout: Buffer.from(ran.stdout), stderr: Buffer.from(ran.stderr) }));
  t.diagnostic(`${script} ${JSON.stringify(args)}\n${ran.stdout}${ran.stderr}`);
  assert.deepEqual(checkoutBytes(root), before, 'the checkout files changed');
  assert.equal(worktreeList(root), worktrees, 'a temporary worktree remains');
  assert.deepEqual(readdirSync(tmp), scratch, 'temporary proof files remain');
  let report;
  try { report = JSON.parse(ran.stdout); } catch { /* A missing report is asserted by the caller. */ }
  return { ...ran, report };
}

export const mutationArgs = (fixture, extra = []) => ['--source', 'subject.mjs', '--anchor', 'value = 1', '--count', '1', '--replacement', 'value = 2', '--test', fixture.file, ...extra];
