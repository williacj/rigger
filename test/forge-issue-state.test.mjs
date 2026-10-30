// ABOUTME: Tests the read side's read of one issue's state, `board.readIssueState`: open, closed,
// or that the repository holds no such issue, and never a label; and that it shares its not-found
// and other-repository check with `readIssue` through one named function.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSide, repositoryReads } from '../src/substrate/forge/read.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The board every read here is made for, as a config names it. */
const BOARD = { repo: 'williacj/rigger', project: 6, columns: { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' } };

/** What gh prints for `data` on a GraphQL read that succeeded. */
const ok = (data) => ({ status: 0, stdout: JSON.stringify({ data }), stderr: '' });

/** The document a `gh api graphql -f query=` request carries. */
const documentOf = (args) => args[3].slice('query='.length);

/** A spawn that records every request and answers each from `answer(args)`. */
function forge(answer) {
  const sent = [];
  const send = (command, args) => {
    sent.push(args);
    return answer(args);
  };
  return Object.assign(send, { sent });
}

/**
 * An issue as gh answers it, carrying labels and every field `readIssue` selects, so a read that
 * passed any of them on would show it. A state read's request selects fewer, and gh answers only
 * what is asked; the extra fields here stand in for a read that asked for them.
 */
const issueAnswer = (state, repo = 'williacj/rigger') => ok({ repository: { issue: { number: 7, title: 'Rigger closed admission', body: 'Hold: `a1`', state, author: { login: 'williacj' }, repository: { nameWithOwner: repo }, labels: { pageInfo: { hasNextPage: false, endCursor: 'MQ' }, nodes: [{ name: 'rigger:status' }] } } } });

// proves R-SCHED-23
test('board.readIssueState answers an open issue as { state: open } and a closed one as { state: closed }, with exactly that key and no labels, from one request selecting no label', async () => {
  for (const [given, state] of [['OPEN', 'open'], ['CLOSED', 'closed']]) {
    const send = forge(() => issueAnswer(given));

    const read = await readSide(BOARD, { send }).readIssueState(7);

    assert.deepEqual(read, { state }, given);
    assert.deepEqual(Object.keys(read), ['state'], given);
    assert.ok(!JSON.stringify(read).includes('rigger:status'), `the label reached the answer: ${JSON.stringify(read)}`);
    assert.equal(send.sent.length, 1, given);
    assert.match(documentOf(send.sent[0]), /repository\(owner: "williacj", name: "rigger"\) \{ issue\(number: 7\) \{ state repository \{ nameWithOwner \} \} \}/);
    assert.doesNotMatch(documentOf(send.sent[0]), /labels/);
  }
});

// proves R-SCHED-23
test('board.readIssueState answers the closed issue gh printed for this repository as { state: closed }', async () => {
  // Captured with gh 2.103.2 on 2026-10-28, by `gh api graphql -f query='query { repository(owner:
  // "williacj", name: "rigger") { issue(number: 949) { state repository { nameWithOwner } } } }'`:
  // #949, closed.
  const printed = readFileSync(join(HERE, 'fixtures', 'rigger-issue-state-2026-10-28.json'), 'utf8');
  const send = forge(() => ({ status: 0, stdout: printed, stderr: '' }));

  assert.deepEqual(await readSide(BOARD, { send }).readIssueState(949), { state: 'closed' });
  assert.equal(documentOf(send.sent[0]), 'query { repository(owner: "williacj", name: "rigger") { issue(number: 949) { state repository { nameWithOwner } } } }');
});

// proves R-SCHED-23
test('board.readIssueState answers { state: none } for a number naming no issue, from the not-found answer gh gave for this repository, and for an issue the forge answers in another repository', async () => {
  // Captured with gh 2.99.0 on 2026-10-11: #999999 names nothing in williacj/rigger.
  const notFound = { status: 1, stdout: readFileSync(join(HERE, 'fixtures', 'rigger-issue-not-found-2026-10-11.json'), 'utf8'), stderr: 'gh: Could not resolve to an Issue with the number of 999999.\n' };
  assert.deepEqual(await readSide(BOARD, { send: forge(() => notFound) }).readIssueState(999999), { state: 'none' });
  // Constructed: GitHub redirects a transferred issue to the repository it was moved to.
  assert.deepEqual(await readSide(BOARD, { send: forge(() => issueAnswer('OPEN', 'someone/elsewhere')) }).readIssueState(7), { state: 'none' });
});

// proves R-SCHED-23
test('board.readIssueState rejects a refused read, naming the issue and gh\'s first line, and never answers a state in its place', async () => {
  const send = forge(() => ({ status: 1, stdout: '', stderr: 'gh: HTTP 502: Bad Gateway (https://api.github.com/graphql)\n' }));

  await assert.rejects(readSide(BOARD, { send }).readIssueState(7), (error) => {
    assert.match(error.message, /^readIssueState on board 6 failed: reading issue #7's state in williacj\/rigger, /);
    assert.match(error.message, /HTTP 502/);
    return true;
  });
});

/** The text of `read.mjs`, whose structure the next test checks. */
const SOURCE = readFileSync(join(HERE, '..', 'src', 'substrate', 'forge', 'read.mjs'), 'utf8');

/** The source of the object member `name: {` or method `name: async (`, up to the next member at the same indent. */
const memberOf = (name, indent) => {
  const start = SOURCE.search(new RegExp(`\\n${indent}${name}: `));
  assert.ok(start >= 0, `read.mjs holds no member ${name}`);
  const rest = SOURCE.slice(start + 1);
  const end = rest.slice(1).search(new RegExp(`\\n${indent}(?:/\\*\\*|[A-Za-z]+: )`));
  return end < 0 ? rest : rest.slice(0, end + 1);
};

// proves R-SCHED-23
test('readIssue and board.readIssueState both call issueIn for the not-found and other-repository check, whose code read.mjs holds once', async () => {
  // The defect this catches is the check copied into the state read rather than shared: a fix to
  // one copy would leave the other answering a transferred issue as this repository's.
  assert.match(memberOf('readIssue', '  '), /\bissueIn\(/);
  assert.match(memberOf('readIssueState', '    '), /\bissueIn\(/);
  assert.equal(SOURCE.match(/^function issueIn\(/gm)?.length, 1);
  assert.equal(SOURCE.match(/notFoundAt\(said, \['repository', 'issue'\]\)/g)?.length, 1);
  assert.equal(SOURCE.match(/ofRepository\(board, issue\.repository\.nameWithOwner\)/g)?.length, 1);

  // And each behaves as the shared check says, so the structure above is not all that holds it.
  const transferred = forge(() => issueAnswer('OPEN', 'someone/elsewhere'));
  assert.equal(await repositoryReads(BOARD, { send: transferred }).readIssue(7), null);
});
