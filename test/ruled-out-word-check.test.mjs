// ABOUTME: Covers what the ruled-out-word check reads, what it reports, and that no tracked
// ABOUTME: file in this repository carries a ruled-out word.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findings, trackedFiles, check, RULED_OUT } from '../scripts/ruled-out-word-check.mjs';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A repository whose files hold the given contents, each path relative and posix-spelled. */
function repositoryOf(files) {
  const root = mkdtempSync(join(tmpdir(), 'rigger-words-'));
  for (const [path, content] of Object.entries(files)) {
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

// A fixture word, so this file states no spelling the check itself rules out. Each pattern
// brackets one character so that it never matches the text that declares it.
const FIXTURE = [{ pattern: 'wid[g]et', instead: 'the part it names' }];

test('a finding names the line and the spelling that matched', () => {
  const text = 'the first line\nthe widget is here\n';
  assert.deepEqual(findings(text, FIXTURE), [
    { line: 2, match: 'widget', instead: 'the part it names', text: 'the widget is here' },
  ]);
});

test('a spelling at the start of a sentence is the same ruled-out word', () => {
  // The word returns capitalised as readily as not, so a check that reads case would let half
  // the spellings back in.
  assert.deepEqual(findings('Widget is the subject.', FIXTURE).map((one) => one.match), ['Widget']);
});

test('a longer word that merely contains the spelling is not a finding', () => {
  // The check refuses a word, not a substring. Without a boundary it would refuse `widgetry`
  // and every other word built on it, and an author would have nothing to fix.
  assert.deepEqual(findings('widgetry and rewidget carry it.', FIXTURE), []);
});

test('the check reads what git tracks, so an untracked file is not read', () => {
  // A spike lives in a gitignored directory and is throwaway, so what it says is nobody's
  // finding. Walking the disk would refuse it; asking git never sees it.
  const { root } = repositoryOf({ 'kept.md': 'nothing here\n' });
  writeFileSync(join(root, 'spike.md'), 'the widget again\n');
  assert.deepEqual(trackedFiles(root), ['kept.md']);
  assert.deepEqual(check(root, FIXTURE).findings, []);
});

test('a tracked file deleted from the working tree costs no finding and no crash', () => {
  // git lists what the index holds, which outlives the file on disk. The check reads files it
  // was handed, so a delete mid-work must not turn the whole suite into a read error.
  const { root } = repositoryOf({ 'kept.md': 'the widget is here\n', 'gone.md': 'nothing\n' });
  rmSync(join(root, 'gone.md'));
  assert.deepEqual(trackedFiles(root), ['gone.md', 'kept.md']);
  assert.deepEqual(check(root, FIXTURE).findings, [
    { path: 'kept.md', line: 1, match: 'widget', instead: 'the part it names', text: 'the widget is here' },
  ]);
});

test('no pattern matches the line that declares it, so the list is no finding of its own', () => {
  // A ruled-out word spelled plainly in the list would be the check's first finding, and the
  // only way out of that is an exemption, which is a place the word gets to live.
  for (const word of RULED_OUT) assert.deepEqual(findings(word.pattern, RULED_OUT), []);
});

test('the check reads a file of every kind this repository holds', () => {
  // A guard is worth what it reaches. These six are the directories the word it rules out had
  // got to, and a scope narrowed to the documents a lint reads would let five of the six back in.
  const read = trackedFiles(repository);
  for (const kind of ['.claude/', 'templates/claude/', 'docs/', 'scripts/', 'src/', 'test/']) {
    assert.ok(read.some((path) => path.startsWith(kind)), `nothing under ${kind} is read`);
  }
});

test('no tracked file in this repository carries a ruled-out word', () => {
  // The guard the removal leaves behind. A finding here is a claim about this repository, so it
  // names the file and the line rather than a count.
  const { names, findings: found } = check(repository);
  assert.deepEqual(names.map((one) => `${one.path} ${one.match}`), []);
  assert.deepEqual(found.map((one) => `${one.path}:${one.line} ${one.match}`), []);
});

test('a tracked name carrying a ruled-out word is a finding, contents or no contents', () => {
  // The word reached a file name as well as its prose, and a journal slug derives from its
  // heading. A check reading only contents would pass a file whose name still says it.
  const { root } = repositoryOf({ 'docs/the-widget.md': 'nothing here\n' });
  const { names, findings: found } = check(root, FIXTURE);
  assert.deepEqual(found, []);
  assert.deepEqual(names, [
    { path: 'docs/the-widget.md', match: 'widget', instead: 'the part it names' },
  ]);
});
