// ABOUTME: Covers what the header check counts as a header, which placements it accepts, how it
// derives the exempt set from the rule, what it reads, and that this repository passes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { check, headerFindings, exemptions } from '../scripts/aboutme-header-check.mjs';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a header repeating the prefix is a finding naming the file and the lines carrying it', () => {
  // The defect this check exists for: the entry card #152 fixes carried the prefix on its
  // second line, and the wording is what a reader has to go and change.
  const text = [
    'ABOUTME: a mutation anchor written in one round stopped matching in the next',
    'ABOUTME: because a neighbouring edit rewrapped the line it spanned.',
    '',
    '# a heading',
  ].join('\n');
  assert.deepEqual(headerFindings('docs/journal/an-entry.md', text), [
    { path: 'docs/journal/an-entry.md', kind: 'repeated', lines: [1, 2] },
  ]);
});

/**
 * The four placements the rule allows, each written out rather than borrowed from the tree.
 *
 * The tree exercises all four today, so a check with placement logic would pass against it and
 * fail on the first file that moved. Each input here is the shape the rule describes, so the
 * acceptance survives a sweep that changes which files use which.
 */
const PLACEMENTS = {
  'the first line': [
    'ABOUTME: what this file is, on one line.',
    '',
    '# a heading',
  ],
  'below a shebang': [
    '#!/bin/sh',
    '# ABOUTME: what this hook is.',
    '',
    'exec true',
  ],
  'below a frontmatter opener': [
    '---',
    '# ABOUTME: what this prompt is, wrapped onto',
    '# a second line carrying the marker and no prefix.',
    'name: engineer',
    '---',
    '',
    '# Engineer',
  ],
  'below a whole frontmatter block': [
    '---',
    'name: tdd',
    'description: what this skill is for.',
    '---',
    '',
    'ABOUTME: what this skill is, wrapped onto',
    'a second line carrying no prefix.',
    '',
    '# Test-driven development',
  ],
};

for (const [placement, lines] of Object.entries(PLACEMENTS)) {
  test(`a header on ${placement} carries the prefix once and is accepted`, () => {
    assert.deepEqual(headerFindings('a/file.md', lines.join('\n')), []);
  });

  test(`a header on ${placement} is refused once its continuation line takes the prefix back`, () => {
    // The acceptance above is a zero-claim on its own: it reads the same whether the placement
    // is accepted or the reader never found the header. Prefixing the continuation line of the
    // same input is the positive half, and a reader that skipped this placement reports nothing.
    const at = lines.findIndex((one) => one.includes('ABOUTME:'));
    const repeated = [...lines.slice(0, at + 1), lines[at], ...lines.slice(at + 1)];
    assert.deepEqual(
      headerFindings('a/file.md', repeated.join('\n')).map((one) => one.kind), ['repeated'],
    );
  });
}

test('a pair of prefixed lines below the header is no part of it', () => {
  // A test writing header fixtures holds two adjacent prefixed lines legitimately, and this
  // repository has one that does. A check reading every run rather than the first would refuse it.
  const text = [
    'ABOUTME: what this test file covers.',
    '',
    'writeFileSync(one, \'ABOUTME: a first fixture\n\');',
    'writeFileSync(two, \'ABOUTME: a second fixture\n\');',
  ].join('\n');
  assert.deepEqual(headerFindings('test/a.test.mjs', text), []);
});

/**
 * The rule as `AGENTS.md` writes it, wrapped at a width of its own.
 *
 * A fixture rather than the live document, so that a test can state what the derivation should
 * produce without asking the derivation. The live document is read by its own test below, which
 * is what ties the two.
 */
const RULE = [
  "- **Every file opens with an `ABOUTME:` header** saying what it is, on as few lines as that",
  '  takes. The prefix appears once, on the first line; a continuation line carries whatever',
  '  comment marker its format needs and no prefix. Where the format reserves the first line — a',
  '  shebang, YAML frontmatter — the header goes on the line below it, or below the block that',
  '  line opens. A format with no comment syntax to carry one is exempt, which in this repository',
  '  means JSON. `README.md`, `CLAUDE.md`, `.gitignore` and `LICENSE` are exempt as well: the first',
  '  two are the front door and an import, and the others are not ours to caption.',
  '- **Name what a thing does, never its history.** No `New`, `Legacy`, `V2`, `enhanced`.',
].join('\n');

test('the exempt set is the one the rule names, read out of the rule', () => {
  // Typed afresh, this list is a second copy that can disagree with the rule. Read out of it,
  // a reader tracing an exemption lands on the sentence that grants it.
  const { names, formats } = exemptions(RULE);
  assert.deepEqual([...names], ['README.md', 'CLAUDE.md', '.gitignore', 'LICENSE']);
  assert.deepEqual([...formats], ['.json']);
});

test('a file carrying no header and no exemption is a finding naming it', () => {
  // The rule says every file opens with a header, so a file with none breaks it as surely as one
  // repeating the prefix. This check reaches both, which the pull request states.
  assert.deepEqual(headerFindings('src/a.mjs', 'const a = 1;\n', exemptions(RULE)), [
    { path: 'src/a.mjs', kind: 'missing' },
  ]);
});

test('a file the rule exempts by name is accepted with no header', () => {
  for (const name of ['README.md', 'CLAUDE.md', '.gitignore', 'LICENSE']) {
    assert.deepEqual(headerFindings(name, 'no header here\n', exemptions(RULE)), [], name);
  }
});

test('a file whose format the rule exempts is accepted with no header', () => {
  // JSON carries no comment, so there is nowhere for a header to go. The rule names the format
  // rather than the files, and this repository tracks five of them.
  assert.deepEqual(headerFindings('package.json', '{}\n', exemptions(RULE)), []);
  assert.deepEqual(headerFindings('.claude/settings.json', '{}\n', exemptions(RULE)), []);
});

/** A repository holding the header rule and the given files, each path relative and posix-spelled. */
function repositoryOf(files) {
  const root = mkdtempSync(join(tmpdir(), 'rigger-headers-'));
  for (const [path, content] of Object.entries({ 'AGENTS.md': `${RULE}\n`, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return { root, git };
}

test('the check reads what git tracks, so an untracked file is not read', () => {
  // A spike lives in a gitignored directory and is throwaway, so its header is nobody's finding.
  const { root } = repositoryOf({ 'kept.md': 'ABOUTME: what this is.\n' });
  writeFileSync(join(root, 'spike.md'), 'ABOUTME: one\nABOUTME: two\n');
  assert.deepEqual(check(root).findings, []);
});

test('a tracked file repeating its header prefix is a finding naming the file and its lines', () => {
  const { root } = repositoryOf({
    'docs/journal/an-entry.md': 'ABOUTME: one\nABOUTME: two\n\n# a heading\n',
    'kept.md': 'ABOUTME: what this is.\n',
  });
  assert.deepEqual(check(root).findings, [
    { path: 'docs/journal/an-entry.md', kind: 'repeated', lines: [1, 2] },
  ]);
  assert.equal(check(root).failing, true);
});

test('a tracked file the check cannot read is reported rather than skipped, and does not crash', () => {
  // git lists what the index holds, which outlives the file on disk, so a delete mid-work must not
  // turn the whole suite into a read error. Reporting it is not the same as tolerating it: the
  // check cannot vouch for a file it never opened, so it says so rather than passing it.
  const { root } = repositoryOf({ 'kept.md': 'ABOUTME: what this is.\n', 'gone.md': 'ABOUTME: a.\n' });
  rmSync(join(root, 'gone.md'));
  const { findings } = check(root);
  assert.deepEqual(findings.map((one) => `${one.path} ${one.kind}`), ['gone.md unreadable']);
});

test('a tracked file replaced on disk by a directory is reported the same way', () => {
  // The second shape the read fails in, and one a delete does not cover: the path resolves, and
  // opening it throws EISDIR rather than ENOENT.
  const { root } = repositoryOf({ 'kept.md': 'ABOUTME: what this is.\n', 'gone.md': 'ABOUTME: a.\n' });
  rmSync(join(root, 'gone.md'));
  mkdirSync(join(root, 'gone.md'));
  assert.deepEqual(check(root).findings.map((one) => `${one.path} ${one.kind}`), ['gone.md unreadable']);
});

test('a repeated header in a file the check cannot read is never reported clean', () => {
  // The defect this reshaping closes. Under a root-only sparse checkout git lists a file the disk
  // does not hold, and the old catch returned no finding for it — a clean answer about a file the
  // check never read, which is the exact failure this card exists to close.
  const { root, git } = repositoryOf({
    'ok.md': 'ABOUTME: a file that is fine.\n',
    'docs/journal/bad.md': 'ABOUTME: one\nABOUTME: two\n\n# a heading\n',
  });
  git('sparse-checkout', 'init', '--cone');
  git('sparse-checkout', 'set');
  const { findings, failing } = check(root);
  assert.deepEqual(findings.map((one) => `${one.path} ${one.kind}`), ['docs/journal/bad.md unreadable']);
  assert.equal(failing, true, 'a repository the check could not fully read must not pass');
});

test('the count reports what it read, not what it was handed', () => {
  // The output asserted a figure it had not measured: three files listed, two read, and the line
  // claimed all three. A reader re-deriving the number would get a different one.
  const { root } = repositoryOf({ 'kept.md': 'ABOUTME: what this is.\n', 'gone.md': 'ABOUTME: a.\n' });
  rmSync(join(root, 'gone.md'));
  const { files, read } = check(root);
  assert.equal(files.length, 3, 'AGENTS.md, gone.md and kept.md are tracked');
  assert.equal(read, 2, 'only AGENTS.md and kept.md could be opened');
});

test('the exempt set the live rule names is the one the fixture states', () => {
  // The fixture above says what the derivation should produce; this asks the live document. The
  // pair is what ties the check to the rule: reword the rule and this test moves, not the fixture.
  const live = exemptions(readFileSync(join(repository, 'AGENTS.md'), 'utf8'));
  const fixture = exemptions(RULE);
  assert.deepEqual([...live.names], [...fixture.names]);
  assert.deepEqual([...live.formats], [...fixture.formats]);
});

test('a document stating no header rule is refused by name rather than exempting nothing', () => {
  // The rule is prose and card #76 rewrapped 46 files, so a reword is the likely way this parse
  // breaks. Returning an empty set would red on nine files that are exempt and name none of them.
  assert.throws(() => exemptions('# Rules\n\n- **Read `README.md` first.**\n'),
    { message: /states no header rule/ });
  assert.throws(() => exemptions('- **Every file opens with an `ABOUTME:` header** and that is all.\n'),
    { message: /names no exempt files/ });
});

test('the check reads a file of every kind this repository holds', () => {
  // A guard is worth what it reaches. The entry that reached `main` under the old convention was
  // a journal file, which no lint in this repository reads.
  const { files } = check(repository);
  for (const kind of ['.claude/', 'templates/claude/', 'docs/journal/', 'scripts/', 'src/', 'test/', '.githooks/']) {
    assert.ok(files.some((path) => path.startsWith(kind)), `nothing under ${kind} is read`);
  }
});

test('no tracked file in this repository misplaces its header', () => {
  // The guard the fix leaves behind. A finding here is a claim about this repository, so it names
  // the file rather than a count.
  const { findings } = check(repository);
  assert.deepEqual(findings.map((one) => `${one.path} ${one.kind} ${one.lines ?? ''}`.trim()), []);
});
