// ABOUTME: Table W9 guards every other repository-write operation's existing success and failure marks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repositoryWriteSide } from '../src/substrate/forge/repository-write.mjs';
import { refusedCall } from './write-made-fixtures.mjs';
import { openingTransport, ok } from './opening-transport.mjs';

const HEAD = 'a'.repeat(40);
const MERGED = 'b'.repeat(40);
const COMMENT = { id: 901, html_url: 'https://github.com/o/r/issues/12#issuecomment-901' };
// REST response shapes are the observed contracts in forge-status-issue-writes and write-sides-made.
const OPERATIONS = [
  ['mergePullRequest', (side) => side.mergePullRequest(12, HEAD), { merged: true, sha: MERGED }, { outcome: 'merged', sha: MERGED }],
  ['postComment', (side) => side.postComment(12, 'Body'), COMMENT, COMMENT],
  ['postIssueComment', (side) => side.postIssueComment(12, 'Body'), COMMENT, COMMENT],
  ['addIssueLabel', (side) => side.addIssueLabel(12, 'one'), [{ name: 'one' }], [{ name: 'one' }]],
  ['closeIssue', (side) => side.closeIssue(12), { number: 12, state: 'closed' }, { number: 12, state: 'closed' }],
  ['removeIssueLabel', (side) => side.removeIssueLabel(12, 'one'), [], []],
];

// Widening made for missing labels must not turn another operation's undone write or read into made.
test('W9: every other repository write marks only a made write with refused events, never another failure or a preceding read', async () => {
  for (const [name, act, answer, expected] of OPERATIONS) {
    for (const outcome of ['ok', 'refused', 'timeout', 'malformed', 'not-started']) {
      for (const refuseEnd of [false, true]) {
        const transport = openingTransport((args) => {
          if (args[3] === 'GET') return ok({ number: 12, state: 'open', merged: false, mergeable: true, head: { sha: HEAD } });
          if (outcome === 'not-started') throw Object.assign(new Error('spawn gh ENOENT'), { code: 'NOT_STARTED' });
          return { ...ok(answer), ...(outcome === 'refused' ? { status: 1, stderr: 'gh: forbidden (HTTP 403)' }
            : outcome === 'timeout' ? { timedOut: true, timeout: 42 } : outcome === 'malformed' ? { stdout: '{not json' } : {}) };
        }, { refuseEnd });
        const call = act(repositoryWriteSide({ repo: 'o/r' }, transport));
        if (outcome === 'ok' && !refuseEnd) assert.deepEqual(await call, expected, name);
        else await assert.rejects(call, (failure) => {
          assert.equal(Object.hasOwn(failure, 'made'), outcome === 'ok' && refuseEnd, `${name}: ${outcome}`);
          if (failure.made !== undefined) {
            assert.equal(failure.code, 'EVENT_REFUSED');
            assert.deepEqual(failure.made, { answer: expected }, `${name} retains its write answer`);
            assert.deepEqual(failure.unrecorded.map(({ event }) => event), ['call.end']);
          }
          return true;
        });
        assert.equal(transport.sent.filter((args) => args[3] !== 'GET').length, 1, `${name} sends one write`);
      }
    }
    if (['mergePullRequest', 'postComment'].includes(name)) {
      const transport = openingTransport(() => { throw refusedCall({ head: { sha: HEAD } }); });
      await assert.rejects(act(repositoryWriteSide({ repo: 'o/r' }, transport)), (failure) => {
        assert.equal(Object.hasOwn(failure, 'made'), false, `${name} never marks a refused read made`);
        return true;
      });
      assert.equal(transport.sent.filter((args) => args[3] !== 'GET').length, 0, 'a refused read sends no write');
    }
  }
});
