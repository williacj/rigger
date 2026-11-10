// ABOUTME: Tests the judge-start oracle's distinction between fixture data and editorial labels.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { noEditorialIds, report } from './judge-start-fixture.mjs';

// The existing Claude R6 source case supplies this report shape and literal-path prose.
// These are oracle diagnostics: they exercise the shared assertion without another OS contract.
test('the shared oracle accepts literal R445 fixture paths without changing the report', () => {
  const cause = { kind: 'agent-outside', file: '../outside.md' };
  const { reason } = report(cause);
  const root = '/fixture/normal-integration-R445';
  reason.message = "the agent file /fixture/normal-integration-R445/judge/outside.md lies at /fixture/normal-integration-R445/judge/outside.md, outside the consumer's repository /fixture/normal-integration-R445/judge/main, so the Claude Code adapter refused it (R-SAFE-6)";
  const original = JSON.stringify({ ...reason, message: reason.message });
  noEditorialIds(reason, cause, [root]);
  assert.equal(JSON.stringify({ ...reason, message: reason.message }), original, 'the oracle preserves the exact report data');
});

// File/path are counted identities in the fixture's checked HOST_REPORTS contracts, not row labels.
test('the shared oracle preserves independently expected R2 and R-FAIL-8 filenames and paths', () => {
  for (const token of ['R2', 'R-FAIL-8']) {
    for (const cause of [
      { kind: 'agent-outside', file: token + '.md' },
      { kind: 'directory-illegible', path: '/fixture/' + token },
    ]) {
      const { reason } = report({ ...cause });
      const literal = cause.path ?? '/fixture/' + cause.file;
      reason.message = 'the judge could not start using ' + literal;
      const original = JSON.stringify({ ...reason, message: reason.message });
      noEditorialIds(reason, cause, [literal]);
      assert.equal(JSON.stringify({ ...reason, message: reason.message }), original, 'literal data remains byte-for-byte intact');
    }
  }
});

// Unexpected metadata stays subject to the oracle even when its value looks like permitted data.
test('the shared oracle rejects editorial identifiers in unexpected report metadata', () => {
  for (const token of ['R445', 'R2', 'R-FAIL-8']) {
    const literal = '/fixture/' + token;
    const cause = { kind: 'directory-illegible', path: literal };
    for (const extra of [
      { row: token },
      { path: literal },
      { [token]: 'editorial key' },
      { startCause: { ...cause, editorialPath: literal } },
      { startCause: { kind: 'directory-illegible', path: literal, file: token + '.md' } },
    ]) {
      const { reason } = report({ ...cause });
      Object.assign(reason, extra);
      assert.throws(() => noEditorialIds(reason, cause, [literal]),
        { code: 'ERR_ASSERTION', operator: 'doesNotMatch' }, 'unexpected metadata must not acquire the literal-data exemption');
    }
  }
});

// Keeping prose is essential: an allowed path and a real row leak may appear in the same message.
test('the shared oracle rejects editorial identifiers in prose beside known literal data', () => {
  for (const token of ['R445', 'R2', 'R-FAIL-8']) {
    const literal = '/fixture/' + token;
    const cause = { kind: 'directory-illegible', path: literal };
    for (const prose of ['; editorial row ' + token, '; unexpected /other/' + token + '/agent.md']) {
      const { reason } = report({ ...cause });
      reason.message = 'the judge could not start using ' + literal + prose;
      assert.throws(() => noEditorialIds(reason, cause, [literal]),
        { code: 'ERR_ASSERTION', operator: 'doesNotMatch' }, 'editorial prose outside known literal data must be rejected');
    }
  }
});
