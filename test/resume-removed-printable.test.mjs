// ABOUTME: Tests the words for a removed closer and resume's delegation to doctor.mjs, with
// each reason from card 1011's Table A passed through the in-process verb.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import * as doctor from '../src/cli/doctor.mjs';
import { resume } from '../src/cli/resume.mjs';
import { TIME, admissionOf, closerText, moduleOver, seed } from './admission-world.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';
import { configure, statusGh } from './notice-forge.mjs';

test('removedCloserLine preserves the removed closer wording for ordinary text', () => {
  // A standing closer's words, or a lost field, would misdescribe what resume removed.
  const closer = { kind: 'hold', path: '/state/admission/hold-b2.json', reason: 'environment hold', time: 1760000000123 };
  assert.equal(doctor.removedCloserLine?.(closer),
    'removed the hold closer /state/admission/hold-b2.json: environment hold; time 1760000000123');
});

/** Seeds readable closers by hand, then runs resume over their real repository, asking real git. */
async function resumed(entries) {
  const repository = realpathSync.native(repositoryIn('rigger-resume-removed-'));
  const state = join(repository, '.rigger');
  for (const [name, reason] of entries) seed(state, name, closerText({ reason }));
  configure(repository);
  const { closers } = moduleOver(state).read();
  assert.equal(closers.length, entries.length, 'each seeded entry must be a readable closer');
  const ask = (command, args) => {
    assert.equal(command, 'git');
    // repoRoot's documented read is the only command this verb needs before admission.
    assert.deepEqual(args, ['-C', repository, 'rev-parse', '--show-toplevel']);
    return { status: 0, timedOut: false, stdout: gitIn(repository, 'rev-parse', '--show-toplevel'), stderr: '' };
  };
  const answer = await resume({ target: repository, now: () => TIME, ask, send: statusGh() });
  assert.equal(answer.code, 0, answer.text);
  assert.deepEqual(readdirSync(admissionOf(state)), [], 'resume must actually remove the closers');
  return { ...answer, closers };
}

test('resume preserves ordinary text and hands each removed closer to removedCloserLine', async () => {
  // An inline copy could match today's text while bypassing the shared formatter tomorrow.
  const { text, closers: [closer] } = await resumed([['owner-a1.json', 'owner pause']]);
  assert.equal(text, `rigger resume: removed the owner closer ${closer.path}: owner pause; time ${TIME}`);
  assert.equal(text, `rigger resume: ${doctor.removedCloserLine(closer)}`);
  const source = readFileSync(new URL('../src/cli/resume.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{[^}]*\bremovedCloserLine\b[^}]*\} from '\.\/doctor\.mjs'/);
  assert.ok(source.includes('...removed.map((closer) => `rigger resume: ${removedCloserLine(closer)}`)'),
    'resume must pass each whole removed closer to removedCloserLine without reading its fields');
});

test('resume prints a removed reason holding a line feed as backslash n through shared printable', async () => {
  // A raw reason can forge a second output line; independent escaping would fork printable.
  const { text, closers: [closer] } = await resumed([['owner-a1.json', 'one\ntwo']]);
  assert.equal(text, `rigger resume: removed the owner closer ${closer.path}: one\\ntwo; time ${TIME}`);
  assert.equal(text.split('\n').length, 1);
  assert.equal(text, `rigger resume: ${doctor.removedCloserLine(closer)}`);
  assert.match(doctor.removedCloserLine.toString(), /\$\{printable\(reason\)\}/,
    'the removed reason must go through the existing printable function');
});

/** A control character left raw, or written as the wrong escape, must not match this literal. */
const escapedReason = (reason, printed) => async () => {
  const { text, closers: [closer] } = await resumed([['hold-b2.json', reason]]);
  assert.equal(text, `rigger resume: removed the hold closer ${closer.path}: ${printed}; time ${TIME}`);
  assert.equal(text.split('\n').length, 1);
};

test('resume prints U+0001 in a removed reason as backslash u0001 on one line', escapedReason('one\u0001two', 'one\\u0001two'));

test('resume prints U+0085 in a removed reason as backslash u0085 on one line', escapedReason('one\u0085two', 'one\\u0085two'));

test('resume prints U+2028 in a removed reason as backslash u2028 on one line', escapedReason('one\u2028two', 'one\\u2028two'));

test('resume prints exactly two removed closer lines as a set with one line feed reason and one ordinary reason', async () => {
  // A newline escaping gap, a dropped closer or a duplicate line breaks this set and count.
  const { text, closers } = await resumed([['owner-a1.json', 'one\ntwo'], ['hold-b2.json', 'environment hold']]);
  const lines = text.split('\n');
  assert.equal(lines.length, 2, text);
  const owner = closers.find(({ kind }) => kind === 'owner');
  const hold = closers.find(({ kind }) => kind === 'hold');
  assert.deepEqual(new Set(lines), new Set([
    `rigger resume: removed the owner closer ${owner.path}: one\\ntwo; time ${TIME}`,
    `rigger resume: removed the hold closer ${hold.path}: environment hold; time ${TIME}`,
  ]));
  assert.deepEqual(new Set(lines), new Set(closers.map((closer) => `rigger resume: ${doctor.removedCloserLine(closer)}`)));
});
