// ABOUTME: Exercises maker preflight on committed and dirty temporary repositories using body files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { chmodSync, closeSync, openSync, readSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { countWords } from '../scripts/instruction-budget.mjs';
import { generate } from '../scripts/build-test-matrix.mjs';

import { gitIn, repositoryAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const subject = await import('../scripts/preflight.mjs');
const CHECKS = ['clean', 'lands-in', 'retired ids', 'matrix', 'spec-style', 'paths', 'added-timer'];

function fixture() {
  const directory = temporaryDirectory('978-preflight-');
  const root = repositoryAt(join(directory, 'repository'), {
    'docs/spec/requirements-retired.md': '| id | requirement |\n|---|---|\n| R-EXAMPLE-7 | Withdrawn. |\n',
    'docs/spec/decisions-retired.md': '## D713 — Superseded\n',
    'allowed/existing.mjs': 'unchanged\n',
  });
  const base = gitIn(root, 'rev-parse', 'HEAD').trim();
  gitIn(root, 'update-ref', 'refs/remotes/origin/main', base);
  // An identical-byte rewrite must move this fixed mtime, without a sleep or clock-resolution bet.
  utimesSync(join(root, 'allowed/existing.mjs'), 0, 0);
  assert.equal(statSync(join(root, 'allowed/existing.mjs'), { bigint: true }).mtimeNs, 0n);
  const bodyFile = join(directory, 'card.md');
  writeFileSync(bodyFile, '- **Lands in:**\n  - `allowed/`\n');
  return { root, directory, base, bodyFile };
}

function commit(f, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(f.root, path)), { recursive: true });
    writeFileSync(join(f.root, path), text);
  }
  gitIn(f.root, 'add', '-A');
  gitIn(f.root, 'commit', '-qm', 'fixture change');
}

function nativeExecute(command, args, options) {
  return spawnSync(command, args, { ...options, env: options.env });
}

function evidenceFixture() {
  const f = fixture();
  const path = 'docs/spikes/existing-suite-audit.json';
  // Bytes 5,583,279..5,583,346 of the approved public audit at f1fc6d230c692607980dc1a7c69ca18f95e1f0bf.
  // The decision homonym quotes a historical test title; Python hashlib independently measured this digest.
  const decision = 'D' + 4;
  const historical = `ine":1565,"sourceTitle":"the C1-${decision}-R0a origin shell still reports th`;
  const policy = {
    path, gitMode: '100644', sha256: 'efef95f29439cc52f7b6b5447371d43f04d2c9ee7ce0e16d0c85e4ea493776f7',
    reason: 'Historical source quotation fixture.',
  };
  writeFileSync(f.bodyFile, '- **Lands in:** `doc-references.json`, `docs/`, `allowed/`\n');
  commit(f, {
    [path]: historical,
    'docs/spec/decisions-retired.md': `## ${decision} — Historical\n`,
    'doc-references.json': JSON.stringify({ preflight: { retiredIdEvidence: policy } }),
  });
  return { ...f, path, historical, policy, decision };
}

function assertQualificationRefused(f, options) {
  const result = run(f, options);
  assert.equal(result.status, 1, `unqualified evidence must return nonzero:\n${result.output}`);
  assert.match(result.output, /retired evidence: failed/);
  assert.ok(result.output.includes(`"${f.path}" qualification failed:`), result.output);
  return result;
}

function run(f, options = {}) {
  const { argv = ['978', '--body-file', f.bodyFile], ...settings } = options;
  const lines = [];
  // These stand-ins implement child-process exit/stdout/stderr, not any check's algorithm.
  const scriptChecks = ['matrix', 'spec-style', 'paths', 'added-timer'].map((name) => ({
    name, command: ['git', 'rev-parse', 'HEAD'],
  }));
  const files = () => readdirSync(f.directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const stat = statSync(path, { bigint: true });
      const hash = createHash('sha256');
      const buffer = Buffer.alloc(65_536);
      const descriptor = openSync(path, 'r');
      try {
        let length;
        while ((length = readSync(descriptor, buffer, 0, buffer.length, null)) !== 0) {
          hash.update(buffer.subarray(0, length));
        }
      } finally {
        closeSync(descriptor);
      }
      return [path, hash.digest('hex'), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)];
    })
    .sort(([a], [b]) => a.localeCompare(b));
  const before = files();
  let status;
  try {
    status = subject.preflight(argv, {
      root: f.root, scriptChecks, write: (line) => lines.push(line), ...settings,
    });
  } finally {
    assert.deepEqual(files(), before, 'preflight must leave fixture file bytes and write metadata unchanged');
  }
  return { status, output: lines.join('\n') };
}

test('bounded fixture snapshot detects an equal-size byte change', () => {
  const f = fixture();
  const target = join(f.root, 'allowed/existing.mjs');
  const size = statSync(target).size;
  let tampered = false;
  assert.throws(() => run(f, { execute: (command, args, options) => {
    if (!tampered) {
      tampered = true;
      writeFileSync(target, 'different\n');
      assert.equal(statSync(target).size, size, 'the tamper must preserve byte length');
    }
    return nativeExecute(command, args, options);
  } }), (error) => {
    assert.equal(error.code, 'ERR_ASSERTION');
    const before = error.expected.find(([path]) => path === target);
    const after = error.actual.find(([path]) => path === target);
    assert.ok(before && after, 'both snapshots must include the changed file');
    assert.notEqual(after[1], before[1], 'the byte observation must detect equal-size tampering');
    return true;
  });
  assert.ok(tampered, 'the control must reach the fixture write');
});

test('retired evidence qualifies committed bytes before requesting its patch', () => {
  const f = evidenceFixture();
  const { path, historical } = f;
  const head = gitIn(f.root, 'rev-parse', 'HEAD').trim();
  assert.match(gitIn(f.root, 'ls-tree', head, '--', path), /^100644 blob /);
  const calls = [];
  const blobReads = [];
  const result = run(f, { execute: (command, args, options) => {
    calls.push(args);
    const answer = nativeExecute(command, args, options);
    if (args.includes('cat-file')) {
      assert.equal(answer.status, 0, answer.stderr);
      const buffer = Buffer.alloc(69);
      const length = readSync(options.stdio[1], buffer, 0, buffer.length, 0);
      assert.equal(length, 68, 'the real Git blob read must produce the complete historical fixture');
      assert.equal(buffer.subarray(0, length).toString(), historical);
      blobReads.push(length);
    }
    return answer;
  } });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /retired evidence: passed/);
  assert.deepEqual(blobReads, [68], 'qualification must read the committed blob successfully');
  assert.ok(calls.some((args) => args.includes('ls-tree') && args.includes(head)), 'qualification must use the frozen committed head');
  assert.ok(!calls.some((args) => args.includes('diff') && args.includes('--unified=0') && args.at(-1) === path),
    'qualified evidence must never request its full patch');
});

test('retired evidence refuses an equal-size changed committed blob after a complete read', () => {
  const f = evidenceFixture();
  const changed = f.historical.replace('C1', 'C2');
  assert.equal(Buffer.byteLength(changed), 68, 'the changed fixture must preserve byte length');
  commit(f, { [f.path]: changed });
  let completeRead = false;
  const result = assertQualificationRefused(f, { execute: (command, args, options) => {
    const answer = nativeExecute(command, args, options);
    if (args.includes('cat-file')) {
      assert.equal(answer.status, 0, answer.stderr);
      const buffer = Buffer.alloc(69);
      const length = readSync(options.stdio[1], buffer, 0, buffer.length, 0);
      assert.equal(length, 68, 'the changed committed blob must be completely readable');
      assert.equal(buffer.subarray(0, length).toString(), changed);
      completeRead = true;
    }
    return answer;
  } });
  assert.ok(completeRead, 'the wrong digest control must reach a complete successful blob read');
  assert.match(result.output, /SHA-256 does not match qualification/);
});

test('retired evidence refuses appended retired text', () => {
  const f = evidenceFixture();
  commit(f, { [f.path]: `${f.historical}\n${f.decision}\n` });
  const result = assertQualificationRefused(f);
  assert.match(result.output, /SHA-256 does not match qualification/);
});

test('retired evidence does not exempt another path', () => {
  const f = evidenceFixture();
  commit(f, { 'allowed/copied.json': `${f.historical}\n${f.decision} and R-EXAMPLE-7\n` });
  const result = run(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /retired evidence: passed/);
  assert.match(result.output, /lands-in: passed/);
  assert.match(result.output, /retired ids: failed/);
  for (const location of [`"allowed/copied.json":1 ${f.decision}`, `"allowed/copied.json":2 ${f.decision}`, '"allowed/copied.json":2 R-EXAMPLE-7']) {
    assert.ok(result.output.includes(location), result.output);
  }
});

test('retired evidence refuses a deleted committed path', () => {
  const f = evidenceFixture();
  gitIn(f.root, 'update-ref', 'refs/remotes/origin/main', gitIn(f.root, 'rev-parse', 'HEAD').trim());
  gitIn(f.root, 'rm', '--', f.path);
  gitIn(f.root, 'commit', '-qm', 'fixture deletion');
  const result = assertQualificationRefused(f);
  assert.match(result.output, /committed evidence is missing or is not mode 100644/);
});

test('retired evidence refuses nonregular committed modes', () => {
  for (const mode of ['symlink', 'executable']) {
    const f = evidenceFixture();
    if (mode === 'symlink') {
      unlinkSync(join(f.root, f.path));
      symlinkSync('historical-target', join(f.root, f.path));
    } else chmodSync(join(f.root, f.path), 0o755);
    gitIn(f.root, 'add', '--', f.path);
    gitIn(f.root, 'commit', '-qm', 'fixture mode');
    const observed = gitIn(f.root, 'ls-tree', 'HEAD', '--', f.path);
    assert.ok(observed.startsWith(mode === 'symlink' ? '120000 ' : '100755 '), observed);
    const result = assertQualificationRefused(f);
    assert.match(result.output, /committed evidence is missing or is not mode 100644/);
  }
});

test('retired evidence refuses malformed and unknown qualification fields', () => {
  const f = evidenceFixture();
  const policies = [
    null, [], {}, { ...f.policy, extra: true },
    ...Object.keys(f.policy).map((field) => Object.fromEntries(Object.entries(f.policy).filter(([name]) => name !== field))),
    { ...f.policy, path: 'allowed/other.json' }, { ...f.policy, gitMode: '100755' },
    { ...f.policy, sha256: 'a'.repeat(63) }, { ...f.policy, sha256: 'A'.repeat(64) },
    { ...f.policy, sha256: 7 }, { ...f.policy, reason: '' }, { ...f.policy, reason: 7 },
  ];
  const configurations = [null, [], 'invalid', { preflight: null }, { preflight: [] },
    ...policies.map((policy) => ({ preflight: { retiredIdEvidence: policy } }))];
  for (const config of configurations) {
    commit(f, { 'doc-references.json': JSON.stringify(config) });
    assertQualificationRefused(f);
  }
  commit(f, { 'doc-references.json': '{' });
  assertQualificationRefused(f);
});

test('retired evidence refuses Git blob read and close failures', () => {
  for (const fault of ['tree', 'child', 'child-empty', 'read', 'close', 'config', 'spool']) {
    const f = evidenceFixture();
    const nativeClose = fs.closeSync;
    const nativeReadFile = fs.readFileSync;
    const temporary = process.env.TMPDIR;
    let exercised = false;
    try {
      if (fault === 'spool') process.env.TMPDIR = f.root;
      const result = assertQualificationRefused(f, { execute: (command, args, options) => {
        if (fault === 'tree' && args.includes('ls-tree')) {
          exercised = true;
          return { status: 7, stdout: '', stderr: 'fixture tree failure' };
        }
        if ((fault === 'child' || fault === 'child-empty') && args.includes('cat-file')) {
          exercised = true;
          return { status: 7, stdout: null, stderr: fault === 'child-empty' ? '' : 'fixture blob failure' };
        }
        const answer = nativeExecute(command, args, options);
        if (fault === 'config' && args.includes('--name-only')) {
          fs.readFileSync = (path, ...settings) => {
            if (path === join(f.root, 'doc-references.json')) {
              exercised = true;
              const error = new Error('fixture config read failure');
              error.code = 'EACCES';
              throw error;
            }
            return nativeReadFile(path, ...settings);
          };
          syncBuiltinESMExports();
        }
        if (args.includes('cat-file') && (fault === 'read' || fault === 'close')) {
          assert.equal(answer.status, 0, answer.stderr);
          const buffer = Buffer.alloc(69);
          const length = readSync(options.stdio[1], buffer, 0, buffer.length, 0);
          assert.equal(length, 68, 'the native blob must exist before the injected file fault');
          assert.equal(buffer.subarray(0, length).toString(), f.historical);
          if (fault === 'read') {
            nativeClose(options.stdio[1]);
            exercised = true;
          } else {
            const descriptor = options.stdio[1];
            fs.closeSync = (closed) => {
              if (closed !== descriptor) return nativeClose(closed);
              fs.closeSync = nativeClose;
              syncBuiltinESMExports();
              nativeClose(closed);
              exercised = true;
              throw new Error('fixture close failure');
            };
            syncBuiltinESMExports();
          }
        }
        return answer;
      } });
      if (fault === 'spool') {
        assert.match(result.output, /spool must be outside the repository and checker source/);
        exercised = true;
      }
      assert.ok(exercised, `the ${fault} failure premise must be exercised`);
      if (fault === 'child-empty') {
        assert.match(result.output, /qualification failed: blob read exited 7/,
          'a failed blob child with empty stderr must name its exit status');
      }
      for (const name of ['matrix', 'spec-style', 'paths']) assert.ok(result.output.includes(`${name}: passed`), result.output);
    } finally {
      fs.closeSync = nativeClose;
      fs.readFileSync = nativeReadFile;
      syncBuiltinESMExports();
      if (temporary === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = temporary;
    }
  }
});

test('retired evidence preserves dirty-state refusal', () => {
  const f = evidenceFixture();
  writeFileSync(join(f.root, f.path), 'dirty worktree bytes\n');
  const result = run(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /clean: failed/);
  assert.match(result.output, /retired evidence: passed/);
  assert.ok(result.output.includes(JSON.stringify(f.path)), result.output);
  assert.match(result.output, /retired ids: passed/);
});

test('retired evidence preserves outside-Lands-in refusal', () => {
  const f = evidenceFixture();
  writeFileSync(f.bodyFile, '- **Lands in:** `doc-references.json`, `docs/spec/`, `allowed/`\n');
  const result = run(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /clean: passed/);
  assert.match(result.output, /lands-in: failed/);
  assert.ok(result.output.includes(JSON.stringify(f.path)), result.output);
  assert.match(result.output, /retired evidence: passed/);
  assert.match(result.output, /retired ids: passed/);
});

test('retired evidence preserves other-path retired requirement and decision locations', () => {
  const f = evidenceFixture();
  commit(f, { 'allowed/current.mjs': `first\n${f.decision} and R-EXAMPLE-7\n` });
  const result = run(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /retired evidence: passed/);
  assert.match(result.output, /lands-in: passed/);
  assert.match(result.output, /retired ids: failed/);
  for (const token of [f.decision, 'R-EXAMPLE-7']) {
    assert.ok(result.output.includes(`"allowed/current.mjs":2 ${token}`), result.output);
  }
});

test('retired evidence binds committed comparisons to captured identities during ref drift', () => {
  const f = evidenceFixture();
  const A = f.base;
  const H = gitIn(f.root, 'rev-parse', 'HEAD').trim();
  const originalBlob = gitIn(f.root, 'rev-parse', `${H}:${f.path}`).trim();
  const originalBytes = gitIn(f.root, 'cat-file', 'blob', originalBlob);
  assert.equal(Buffer.byteLength(originalBytes), 68);
  assert.equal(originalBytes, f.historical);
  assert.equal(createHash('sha256').update(originalBytes).digest('hex'), f.policy.sha256);
  const advancedBytes = f.historical.replace('C1', 'C2');
  const sentinel = 'outside/advanced-only.mjs';
  commit(f, { [f.path]: advancedBytes, [sentinel]: 'advanced-only\n' });
  const J = gitIn(f.root, 'rev-parse', 'HEAD').trim();
  const advancedBlob = gitIn(f.root, 'rev-parse', `${J}:${f.path}`).trim();
  assert.notEqual(advancedBlob, originalBlob);
  assert.equal(gitIn(f.root, 'cat-file', 'blob', advancedBlob), advancedBytes);
  assert.equal(gitIn(f.root, 'merge-base', H, A).trim(), A);
  assert.equal(gitIn(f.root, 'merge-base', J, J).trim(), J);
  const expectedPaths = ['doc-references.json', 'docs/spec/decisions-retired.md', f.path].sort();
  const pathsAt = (range) => gitIn(f.root, 'diff', '--no-renames', '--name-only', '-z', range).split('\0').filter(Boolean).sort();
  assert.deepEqual(pathsAt(`${A}..${H}`), expectedPaths);
  assert.ok(pathsAt(`${A}..${J}`).includes(sentinel));
  gitIn(f.root, 'checkout', '--detach', H);
  gitIn(f.root, 'update-ref', 'refs/remotes/origin/main', A);
  assert.equal(gitIn(f.root, 'status', '--porcelain=v1'), '');
  assert.equal(gitIn(f.root, 'rev-parse', 'HEAD').trim(), H);
  assert.equal(gitIn(f.root, 'rev-parse', 'origin/main').trim(), A);
  console.log('committed identity fixture premises:', JSON.stringify({ A, H, J, originalBlob, advancedBlob, expectedPaths }));
  const lines = [], comparisons = [], blobReads = [];
  let capturedHead, capturedMain, transitioned = false;
  // This direct invocation isolates the deliberate fixture transition; run() retains its no-change assertion.
  const status = subject.preflight(['978', '--body-file', f.bodyFile], {
    root: f.root,
    scriptChecks: ['matrix', 'spec-style', 'paths', 'added-timer'].map((name) => ({ name, command: ['git', 'rev-parse', 'HEAD'] })),
    write: (line) => lines.push(line),
    execute: (command, args, options) => {
      const answer = nativeExecute(command, args, options);
      assert.equal(answer.status, 0, answer.stderr);
      if (args.includes('rev-parse') && args.at(-1) === 'HEAD' && capturedHead === undefined) {
        capturedHead = answer.stdout.trim();
        assert.equal(capturedHead, H);
      }
      if (args.includes('--verify') && args.at(-1) === 'origin/main^{commit}') {
        capturedMain = answer.stdout.trim();
        assert.equal(capturedHead, H);
        assert.equal(capturedMain, A);
        assert.equal(transitioned, false);
        gitIn(f.root, 'checkout', '--detach', J);
        gitIn(f.root, 'update-ref', 'refs/remotes/origin/main', J);
        transitioned = true;
        assert.equal(gitIn(f.root, 'rev-parse', 'HEAD').trim(), J);
        assert.equal(gitIn(f.root, 'rev-parse', 'origin/main').trim(), J);
        assert.equal(gitIn(f.root, 'status', '--porcelain=v1'), '');
      }
      if (args.includes('merge-base') || args.includes('diff') || args.includes('ls-tree')) {
        comparisons.push({ args, stdout: answer.stdout });
      }
      if (args.includes('cat-file')) {
        const buffer = Buffer.alloc(69);
        const length = readSync(options.stdio[1], buffer, 0, buffer.length, 0);
        assert.equal(length, 68, 'the invocation must read the complete captured-head blob');
        assert.equal(buffer.subarray(0, length).toString(), originalBytes);
        blobReads.push(args.at(-1));
      }
      return answer;
    },
  });
  assert.ok(transitioned, 'both original ref answers must precede the owned transition');
  assert.equal(capturedHead, H);
  assert.equal(capturedMain, A);
  assert.equal(gitIn(f.root, 'rev-parse', 'HEAD').trim(), J);
  assert.equal(gitIn(f.root, 'rev-parse', 'origin/main').trim(), J);
  assert.equal(gitIn(f.root, 'status', '--porcelain=v1'), '');
  assert.equal(readFileSync(join(f.root, f.path), 'utf8'), advancedBytes);
  assert.equal(readFileSync(join(f.root, sentinel), 'utf8'), 'advanced-only\n');
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'doc-references.json'), 'utf8')).preflight.retiredIdEvidence, f.policy);
  console.log('committed identity fixture post-state:', JSON.stringify({ HEAD: J, originMain: J, capturedHead, capturedMain, blobReads }));
  console.log('committed identity invocation comparisons:', JSON.stringify(comparisons));
  console.log('committed identity invocation output:', JSON.stringify(lines));
  assert.equal(lines[0], `preflight head ${H} merge-base ${A}`, 'the invocation must name its captured head and captured-base comparison');
  const listed = comparisons.find(({ args }) => args.includes('--name-only'));
  assert.ok(listed, 'the captured committed comparison must list changed paths');
  assert.deepEqual(listed.stdout.split('\0').filter(Boolean).sort(), expectedPaths,
    'changed paths must derive from the captured base and head');
  for (const { args } of comparisons.filter(({ args }) => args.includes('diff'))) {
    assert.ok(args.includes(`${A}..${H}`), 'every committed diff must use the captured full identities');
  }
  assert.deepEqual(comparisons.find(({ args }) => args.includes('merge-base')).args.slice(-2), [H, A]);
  assert.ok(comparisons.some(({ args }) => args.includes('ls-tree') && args.includes(H)));
  assert.deepEqual(blobReads, [originalBlob], 'qualification must read only the captured-head audit blob');
  assert.equal(status, 0, lines.join('\n'));
  assert.ok(lines.includes('retired evidence: passed'), lines.join('\n'));
  assert.ok(lines.includes('lands-in: passed'), lines.join('\n'));
});

test('every preflight check passes on a clean committed head and names its merge base', () => {
  const f = fixture();
  commit(f, { 'allowed/change.mjs': 'ready\n' });
  const result = run(f);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output.split('\n')[0], `preflight head ${gitIn(f.root, 'rev-parse', 'HEAD').trim()} merge-base ${f.base}`);
  for (const name of CHECKS) assert.ok(result.output.includes(`${name}: passed`), result.output);
  assert.equal(result.output.split(gitIn(f.root, 'rev-parse', 'HEAD').trim()).length - 1, 4, result.output);
});

test('lands-in refuses each outside path and ignores paths elsewhere in the card body', () => {
  const f = fixture();
  writeFileSync(f.bodyFile, '- **Lands in:**\n  - `allowed/`\n- **Elsewhere:** `outside.mjs`\n');
  commit(f, { 'allowed/change.mjs': 'ready\n', 'outside.mjs': 'outside\n' });
  const result = run(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /lands-in: failed/);
  assert.match(result.output, /outside\.mjs/);
  assert.match(result.output, /paths: passed/);
});

test('lands-in accepts exact paths, directory subtrees and single-segment placeholders literally', () => {
  const f = fixture();
  writeFileSync(f.bodyFile, '- **Lands in:** `one.mjs`\n  - `allowed/`\n  - `docs/<date>-<slug>.md`\n  - `literal[1].mjs`\n');
  commit(f, { 'one.mjs': 'one\n', 'allowed/nested/a.mjs': 'nested\n', 'docs/2026-note.md': 'note\n', 'literal[1].mjs': 'literal\n' });
  const result = run(f);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /lands-in: passed/);
});

test('clean refuses staged, unstaged and untracked paths without changing any file', () => {
  const f = fixture();
  writeFileSync(join(f.root, 'allowed/existing.mjs'), 'staged\n');
  gitIn(f.root, 'add', 'allowed/existing.mjs');
  writeFileSync(join(f.root, 'docs/spec/decisions-retired.md'), '## D713 — Changed\n');
  writeFileSync(join(f.root, 'untracked.mjs'), 'untracked\n');
  const result = run(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /clean: failed/);
  for (const path of ['allowed/existing.mjs', 'docs/spec/decisions-retired.md', 'untracked.mjs']) {
    assert.ok(result.output.includes(JSON.stringify(path)), result.output);
  }
  assert.match(result.output, /lands-in: passed/);
  assert.match(result.output, /retired ids: passed/);
  assert.match(result.output, /paths: passed/);
});

test('retired ids refuses added requirement and decision citations by path and new line number', () => {
  const f = fixture();
  commit(f, { 'allowed/retired.mjs': 'first\nR-EXAMPLE-7 and D713\nR-EXAMPLE-70 and D7130\n' });
  const result = run(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /retired ids: failed/);
  assert.ok(result.output.includes('"allowed/retired.mjs":2 R-EXAMPLE-7'), result.output);
  assert.ok(result.output.includes('"allowed/retired.mjs":2 D713'), result.output);
  assert.doesNotMatch(result.output, /:3 /);
});

test('retired ids exempts spec and journal citations and leaves unchanged lines alone', () => {
  const f = fixture();
  commit(f, { 'allowed/existing.mjs': 'D713 and R-EXAMPLE-7\n' });
  gitIn(f.root, 'update-ref', 'refs/remotes/origin/main', gitIn(f.root, 'rev-parse', 'HEAD').trim());
  writeFileSync(f.bodyFile, '- **Lands in:** `allowed/`, `docs/spec/`, `docs/journal/`\n');
  commit(f, {
    'allowed/existing.mjs': 'D713 and R-EXAMPLE-7\nsafe addition\n',
    'docs/spec/decisions.md': 'The successor cites D713.\n',
    'docs/journal/note.md': 'R-EXAMPLE-7 and D713\n',
  });
  const result = run(f);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /retired ids: passed/);
});

test('missing origin main and unrelated histories name their causes before any check runs', () => {
  for (const cause of ['missing', 'unrelated']) {
    const f = fixture();
    if (cause === 'missing') gitIn(f.root, 'update-ref', '-d', 'refs/remotes/origin/main');
    else {
      gitIn(f.root, 'checkout', '--orphan', 'unrelated');
      gitIn(f.root, 'commit', '-qm', 'unrelated history');
    }
    const result = run(f);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, cause === 'missing' ? /origin\/main.*missing/ : /no merge base/);
    for (const check of CHECKS) assert.ok(!result.output.includes(`${check}:`), result.output);
  }
});

test('an unreadable body file reports its cause before any check runs', () => {
  const f = fixture();
  f.bodyFile = join(f.directory, 'absent.md');
  let result;
  assert.doesNotThrow(() => { result = run(f); }, 'an unreadable body must be a reported refusal');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /body.*cannot be read.*absent\.md/);
  for (const check of CHECKS) assert.ok(!result.output.includes(`${check}:`), result.output);
});

test('a body with no Lands in refuses that check with a reason and reports the others', () => {
  const f = fixture();
  writeFileSync(f.bodyFile, '- **Elsewhere:** `allowed/`\n');
  const result = run(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /lands-in: failed/);
  assert.match(result.output, /no "Lands in"/);
  assert.match(result.output, /paths: passed/);
});

test('gh body reads use only issue view and report a failed read before checks', () => {
  const f = fixture();
  const calls = [];
  let refusal = false;
  // gh issue view --json body --jq .body returns the body as text; nonzero reads carry stderr.
  const execute = (command, args, options) => {
    if (command !== 'gh') return spawnSync(command, args, { ...options, env: options.env });
    calls.push(args);
    return refusal ? { status: 1, stdout: '', stderr: 'card read refused\n' }
      : { status: 0, stdout: readFileSync(f.bodyFile, 'utf8'), stderr: '' };
  };
  const passed = run(f, { argv: ['978'], execute });
  assert.equal(passed.status, 0, passed.output);
  assert.deepEqual(calls, [['issue', 'view', '978', '--json', 'body', '--jq', '.body']]);
  refusal = true;
  const failed = run(f, { argv: ['978'], execute });
  assert.equal(failed.status, 1, failed.output);
  assert.match(failed.output, /body.*cannot be read.*card read refused/);
  for (const check of CHECKS) assert.ok(!failed.output.includes(`${check}:`), failed.output);
});

test('a committed deletion is checked against Lands in and adds no retired citations', () => {
  const f = fixture();
  gitIn(f.root, 'rm', '-q', 'allowed/existing.mjs');
  gitIn(f.root, 'commit', '-qm', 'delete fixture file');
  assert.equal(run(f).status, 0);
  writeFileSync(f.bodyFile, '- **Lands in:** `elsewhere/`\n');
  const result = run(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /lands-in: failed/);
  assert.ok(result.output.includes('"allowed/existing.mjs"'), result.output);
  assert.match(result.output, /retired ids: passed/);
});

test('a committed rename checks both paths and treats every destination line as added', () => {
  const f = fixture();
  commit(f, { 'allowed/existing.mjs': 'first\nD713\n' });
  gitIn(f.root, 'update-ref', 'refs/remotes/origin/main', gitIn(f.root, 'rev-parse', 'HEAD').trim());
  mkdirSync(join(f.root, 'moved'));
  gitIn(f.root, 'mv', 'allowed/existing.mjs', 'moved/renamed.mjs');
  gitIn(f.root, 'commit', '-qm', 'rename fixture file');
  for (const [named, refused] of [['moved/', 'allowed/existing.mjs'], ['allowed/', 'moved/renamed.mjs']]) {
    writeFileSync(f.bodyFile, `- **Lands in:** \`${named}\`\n`);
    const result = run(f);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /lands-in: failed/);
    assert.ok(result.output.includes(JSON.stringify(refused)), result.output);
    assert.ok(result.output.includes('"moved/renamed.mjs":2 D713'), result.output);
  }
});

test('each failed script check retains its exit and output while every other check reports', () => {
  const f = fixture();
  for (const broken of ['matrix', 'spec-style', 'paths']) {
    const scriptChecks = ['matrix', 'spec-style', 'paths', 'added-timer'].map((name) => ({
      name, command: name === broken ? ['git', 'rev-parse', '--verify', 'refs/heads/preflight-absent']
        : ['git', 'rev-parse', 'HEAD'],
    }));
    const result = run(f, { scriptChecks });
    assert.equal(result.status, 1, result.output);
    assert.ok(result.output.includes(`${broken}: failed (exit 128)`), result.output);
    assert.match(result.output, /fatal: Needed a single revision/);
    for (const name of CHECKS.filter((name) => name !== broken)) {
      assert.ok(result.output.includes(`${name}: passed`), result.output);
    }
  }
});

test('paths preserve quotes unicode and newlines and placeholders never cross a slash', () => {
  const f = fixture();
  const path = 'allowed/a "é\n$(false).mjs';
  commit(f, { [path]: 'safe\n' });
  const clean = run(f);
  assert.equal(clean.status, 0, clean.output);
  commit(f, { [path]: 'safe\nD713\n' });
  const retired = run(f);
  assert.match(retired.output, /lands-in: passed/);
  assert.ok(retired.output.includes(`${JSON.stringify(path)}:2 D713`), retired.output);
  writeFileSync(f.bodyFile, '- **Lands in:** `allowed/`, `docs/<slug>.md`\n');
  commit(f, { 'docs/nested/note.md': 'not a single segment\n' });
  const nested = run(f);
  assert.match(nested.output, /lands-in: failed/);
  assert.ok(nested.output.includes('"docs/nested/note.md"'), nested.output);
});

// Reads only the two prompt files under `root`, never a git ref, so it holds on main and on a branch.
function assertPreflightPrompt(root) {
  const prompt = readFileSync(join(root, '.claude/agents/engineer.md'), 'utf8');
  assert.match(prompt, /Before handing back, run `npm run preflight -- <card>` and fix what it reports\./);
  const lines = prompt.split('\n').filter((line) => line.includes('npm run preflight'));
  assert.equal(lines.length, 1, `lines naming npm run preflight: ${lines.length}`);
  assert.ok(countWords(lines[0]) <= 40, `preflight line words: ${countWords(lines[0])}`);
  const template = readFileSync(join(root, 'templates/claude/agents/engineer.md'), 'utf8');
  assert.equal(template, prompt, 'template differs from the live prompt');
}

test('npm and the mirrored maker prompts wire preflight within the forty-word allowance', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts.preflight, 'node scripts/preflight.mjs');
  assert.deepEqual(subject.SCRIPT_CHECKS, [
    { name: 'matrix', command: ['npm', 'run', 'matrix:check'] },
    { name: 'spec-style', command: ['npm', 'run', 'lint:spec-style'] },
    { name: 'paths', command: ['npm', 'run', 'check:paths'] }, { name: 'added-timer', command: ['npm', 'test', '--'] },
  ]);
  const prompt = readFileSync(join(root, '.claude/agents/engineer.md'), 'utf8');
  assert.match(prompt, /Before handing back, run `npm run preflight -- <card>` and fix what it reports\./);
  assert.equal(readFileSync(join(root, 'templates/claude/agents/engineer.md'), 'utf8'), prompt);
  assertPreflightPrompt(root);
  assert.ok(readFileSync(join(root, 'scripts/preflight.mjs'), 'utf8').startsWith('// ABOUTME:'));
});

test('the preflight prompt check refuses a preflight line over forty words and a differing template', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const prompt = readFileSync(join(root, '.claude/agents/engineer.md'), 'utf8');
  const line = prompt.split('\n').find((text) => text.includes('npm run preflight'));
  const files = (live, template = live) => repositoryAt(join(temporaryDirectory('996-prompt-'), 'repository'), {
    '.claude/agents/engineer.md': live, 'templates/claude/agents/engineer.md': template,
  });
  assertPreflightPrompt(files(prompt));
  const lineWords = line.split(/\s+/).filter(Boolean).length;
  assertPreflightPrompt(files(`${prompt}\n${' elsewhere'.repeat(50)}\n`));
  assertPreflightPrompt(files(prompt.replace(line, `${line}${' word'.repeat(40 - lineWords)}`)));
  const long = prompt.replace(line, `${line}${' word'.repeat(41 - lineWords)}`);
  assert.throws(() => assertPreflightPrompt(files(long)), /preflight line words: 41/);
  assert.throws(() => assertPreflightPrompt(files(prompt, `${prompt}\n`)), /template differs from the live prompt/);
});

test('the CLI entry recognizes a symlink spelling of its script and reports the body refusal', async () => {
  const f = fixture();
  const link = join(f.directory, 'preflight-link.mjs');
  symlinkSync(fileURLToPath(new URL('../scripts/preflight.mjs', import.meta.url)), link);
  const argv = process.argv;
  const cwd = process.cwd();
  const exitCode = process.exitCode;
  const log = console.log;
  const output = [];
  let status;
  try {
    process.argv = [argv[0], link, '978', '--body-file', join(f.directory, 'absent.md')];
    process.chdir(f.root);
    process.exitCode = 0;
    console.log = (line) => output.push(line);
    // A query gives this entry evaluation its own module instance, as Node's ESM loader specifies.
    await import('../scripts/preflight.mjs?entry-proof');
    status = process.exitCode;
  } finally {
    process.argv = argv;
    process.chdir(cwd);
    process.exitCode = exitCode;
    console.log = log;
  }
  assert.equal(status, 1, 'the entry must run under an alias rather than silently exit zero');
  assert.ok(output[0].startsWith('preflight head '), output.join('\n'));
  assert.match(output.join('\n'), /body.*cannot be read.*absent\.md/);
});

test('retired ids refuses added citations when repository configuration forces colored patches', () => {
  const f = fixture();
  commit(f, { 'allowed/colored.mjs': 'first\nR-EXAMPLE-7 and D713\n' });
  for (const color of ['ui', 'diff']) {
    gitIn(f.root, 'config', `color.${color}`, 'always');
    assert.equal(gitIn(f.root, 'config', '--get', `color.${color}`).trim(), 'always');
    const patch = gitIn(f.root, 'diff', '--no-renames', '--unified=0', `${f.base}..HEAD`, '--', 'allowed/colored.mjs');
    assert.match(patch, /\x1b\[[0-9;]*m/, 'the real Git patch must establish the colored-output premise');
    console.log(`${color} colored hunk premise:`, JSON.stringify(patch.split('\n').find((line) => line.includes('@@'))));
    const result = run(f);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /retired ids: failed/);
    assert.ok(result.output.includes('"allowed/colored.mjs":2 R-EXAMPLE-7'), result.output);
    assert.ok(result.output.includes('"allowed/colored.mjs":2 D713'), result.output);
  }
});

// Table P in card #1245 covers this development diagnostic, not a deployed product requirement.
// The requirement register's Scope excludes repository working rules; these tests claim no ids.
function matrixFixture() {
  const f = fixture();
  f.testPath = 'test/claims.test.mjs';
  f.matrixPath = 'docs/derived/test-matrix.md';
  f.source = "import { test } from 'node:test';\n// proves R-EXAMPLE-1\ntest('historical D713 title', () => {});\n";
  writeFileSync(f.bodyFile, '- **Lands in:** `test/`, `docs/`\n');
  commit(f, {
    'docs/spec/requirements.md': '| id | checked by |\n|---|---|\n| R-EXAMPLE-1 | the test suite |\n',
    [f.testPath]: f.source,
  });
  generate(f.root, { write: true });
  commit(f, {});
  gitIn(f.root, 'update-ref', 'refs/remotes/origin/main', gitIn(f.root, 'rev-parse', 'HEAD').trim());
  return f;
}

test('P1 regenerated matrix rows ignore retired ids in unchanged test titles', () => {
  const f = matrixFixture();
  commit(f, { [f.testPath]: `${f.source}// proves R-EXAMPLE-1\ntest('another proof', () => {});\n` });
  generate(f.root, { write: true });
  commit(f, {});
  const patch = gitIn(f.root, 'diff', '--unified=0', 'origin/main..HEAD', '--', f.matrixPath);
  assert.ok(patch.split('\n').some((line) => line.startsWith('+|') && line.includes('historical D713 title')),
    'regeneration must add a row carrying the unchanged retired title');
  assert.equal(generate(f.root).stale, false, 'the matrix must be generated, not hand edited');
  const result = run(f);
  assert.match(result.output, /retired ids: passed/, 'generated rows must not create retired citations');
  assert.equal(result.status, 0, result.output);
});

test('P2 added test citations retain the retired id file and line diagnostic', () => {
  const f = fixture();
  writeFileSync(f.bodyFile, '- **Lands in:** `test/`\n');
  commit(f, { 'test/citation.test.mjs': '// a current comment\n// D713 and R-EXAMPLE-7\n' });
  const result = run(f);
  assert.equal(result.status, 1, 'added test citations must still fail preflight');
  assert.match(result.output, /retired ids: failed/);
  assert.deepEqual(result.output.split('\n').filter((line) => line.startsWith('"test/')), [
    '"test/citation.test.mjs":2 D713',
    '"test/citation.test.mjs":2 R-EXAMPLE-7',
  ], 'test citations must name each id exactly at its added source line');
});

test('P3 an added retired test title is reported once at its source rather than its matrix row', () => {
  const f = matrixFixture();
  commit(f, { [f.testPath]: `${f.source}// proves R-EXAMPLE-1\ntest('added D713 title', () => {});\n` });
  generate(f.root, { write: true });
  commit(f, {});
  assert.ok(readFileSync(join(f.root, f.matrixPath), 'utf8').includes('added D713 title'),
    'the added title must reach the generated matrix');
  const result = run(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /retired ids: failed/);
  assert.deepEqual(result.output.split('\n').filter((line) => / D713$/.test(line)), [
    '"test/claims.test.mjs":5 D713',
  ], 'only the added source title must produce a retired diagnostic');
});

test('P4 a hand edited retired matrix id passes retired ids but fails the matrix check', () => {
  const f = matrixFixture();
  const matrix = readFileSync(join(f.root, f.matrixPath), 'utf8');
  commit(f, { [f.matrixPath]: `${matrix}hand edited D713\n` });
  const checked = [];
  const result = run(f, {
    scriptChecks: subject.SCRIPT_CHECKS.filter(({ name }) => name === 'matrix'),
    execute: (command, args, options) => {
      if (command !== 'npm') return nativeExecute(command, args, options);
      assert.deepEqual(args, ['run', 'matrix:check']);
      // build-test-matrix.mjs's CLI maps the actual report's stale/stray fields to exit 1.
      const report = generate(f.root);
      checked.push(report);
      return { status: report.stale || report.strays.length ? 1 : 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(checked.length, 1, 'preflight must run the configured matrix check');
  assert.equal(checked[0].stale, true, 'the actual generator must refuse the hand edit');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /retired ids: passed/, 'matrix text must remain outside retired citation checking');
  assert.match(result.output, /matrix: failed \(exit 1\)/);
});

test('P5 spec journal and qualified historical audit keep their retired id exemptions', () => {
  const f = evidenceFixture();
  commit(f, {
    'docs/spec/decisions.md': `${f.decision} and R-EXAMPLE-7\n`,
    'docs/journal/history.md': `${f.decision} and R-EXAMPLE-7\n`,
  });
  const result = run(f);
  assert.equal(result.status, 0, 'spec journal and qualified historical audit must stay exempt');
  assert.match(result.output, /retired evidence: passed/);
  assert.match(result.output, /retired ids: passed/);
  // The same historical path without a qualification must still be scanned.
  commit(f, { 'doc-references.json': '{}' });
  const unqualified = run(f);
  assert.equal(unqualified.status, 1, unqualified.output);
  assert.ok(unqualified.output.includes(`"${f.path}":1 ${f.decision}`),
    'the historical path alone must never grant an exemption');
});

test('P7 nearby derived path spellings still report added retired citations', () => {
  const f = fixture();
  writeFileSync(f.bodyFile, '- **Lands in:** `docs/`, `allowed/`\n');
  const paths = ['docs/derived-copy/note.md', 'docs/derived.md', 'allowed/derived/note.md'];
  commit(f, Object.fromEntries(paths.map((path) => [path, 'first\nD713\n'])));
  const result = run(f);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /retired ids: failed/);
  assert.deepEqual(result.output.split('\n').filter((line) => / D713$/.test(line)),
    paths.sort().map((path) => `${JSON.stringify(path)}:2 D713`),
    'only the docs/derived directory subtree receives the added exemption');
});
