// ABOUTME: Exercises maker preflight on committed and dirty temporary repositories using body files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { countWords } from '../scripts/instruction-budget.mjs';

import { gitIn, repositoryAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const subject = await import('../scripts/preflight.mjs');
const CHECKS = ['clean', 'lands-in', 'retired ids', 'matrix', 'spec-style', 'paths'];

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

function run(f, options = {}) {
  const { argv = ['978', '--body-file', f.bodyFile], ...settings } = options;
  const lines = [];
  // These stand-ins implement child-process exit/stdout/stderr, not any check's algorithm.
  const scriptChecks = ['matrix', 'spec-style', 'paths'].map((name) => ({
    name, command: ['git', 'rev-parse', 'HEAD'],
  }));
  const files = () => readdirSync(f.directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const stat = statSync(path, { bigint: true });
      return [path, readFileSync(path).toString('hex'), String(stat.mtimeNs), String(stat.ctimeNs)];
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
    const scriptChecks = ['matrix', 'spec-style', 'paths'].map((name) => ({
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

test('npm and the mirrored maker prompts wire preflight within the forty-word allowance', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts.preflight, 'node scripts/preflight.mjs');
  assert.deepEqual(subject.SCRIPT_CHECKS, [
    { name: 'matrix', command: ['npm', 'run', 'matrix:check'] },
    { name: 'spec-style', command: ['npm', 'run', 'lint:spec-style'] },
    { name: 'paths', command: ['npm', 'run', 'check:paths'] },
  ]);
  const prompt = readFileSync(join(root, '.claude/agents/engineer.md'), 'utf8');
  assert.match(prompt, /Before handing back, run `npm run preflight -- <card>` and fix what it reports\./);
  assert.equal(readFileSync(join(root, 'templates/claude/agents/engineer.md'), 'utf8'), prompt);
  const base = gitIn(root, 'merge-base', 'HEAD', 'origin/main').trim();
  const before = gitIn(root, 'show', `${base}:.claude/agents/engineer.md`);
  const added = countWords(prompt) - countWords(before);
  assert.ok(added > 0 && added <= 40, `instruction words added: ${added}`);
  assert.ok(readFileSync(join(root, 'scripts/preflight.mjs'), 'utf8').startsWith('// ABOUTME:'));
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
