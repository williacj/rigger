// ABOUTME: Tests the read side's reads a hold's notice makes: an issue's state and author in its one
// query, an author's repository permission, the open issues carrying a label, and the newest number.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repositoryReads } from '../src/substrate/forge/read.mjs';

/** The board every read here is made for, as a config names it. */
const BOARD = { repo: 'williacj/rigger', project: 6, columns: { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' } };

/** What gh prints for `data` on a GraphQL read that succeeded. */
const ok = (data) => ({ status: 0, stdout: JSON.stringify({ data }), stderr: '' });

/** The document a `gh api graphql -f query=` request carries. */
const documentOf = (args) => args[3].slice('query='.length);

/**
 * A spawn that records every request and answers each from `answer(args)`, as the read runner
 * hands it `gh`'s arguments.
 */
function forge(answer) {
  const sent = [];
  const send = (command, args) => {
    sent.push(args);
    return answer(args);
  };
  return Object.assign(send, { sent });
}

// proves R-SCHED-20
test('readIssue answers an open issue\'s state and its author\'s login from its one query, and reads no permission', async () => {
  const send = forge(() => ok({ repository: { issue: { number: 7, title: 'Rigger closed admission', body: 'Why.', state: 'OPEN', author: { login: 'rigger-bot' }, repository: { nameWithOwner: 'williacj/rigger' }, labels: { pageInfo: { hasNextPage: false, endCursor: 'MQ' }, nodes: [{ name: 'rigger:status' }] } } } }));

  const read = await repositoryReads(BOARD, { send }).readIssue(7);

  assert.deepEqual(read, { number: 7, title: 'Rigger closed admission', body: 'Why.', state: 'open', author: 'rigger-bot', labels: ['rigger:status'] });
  assert.equal(send.sent.length, 1);
  assert.match(documentOf(send.sent[0]), /issue\(number: 7\) \{ number title body state author \{ login \} /);
  assert.ok(!send.sent.some((args) => args.join(' ').includes('collaborators')), 'readIssue sent a permission read');
});

// proves R-SCHED-20
test('readIssue answers a deleted author as null', async () => {
  const send = forge(() => ok({ repository: { issue: { number: 7, title: 'T', body: '', state: 'CLOSED', author: null, repository: { nameWithOwner: 'williacj/rigger' }, labels: { pageInfo: { hasNextPage: false, endCursor: 'MQ' }, nodes: [] } } } }));

  const read = await repositoryReads(BOARD, { send }).readIssue(7);

  assert.equal(read.state, 'closed');
  assert.equal(read.author, null);
});

// proves R-SCHED-20
test('readPermission asks the collaborator permission endpoint for the login by an explicit GET, and answers its role name', async () => {
  const send = forge(() => ({ status: 0, stdout: JSON.stringify({ permission: 'write', role_name: 'maintain' }), stderr: '' }));

  const role = await repositoryReads(BOARD, { send }).readPermission('rigger-bot');

  assert.equal(role, 'maintain');
  assert.deepEqual(send.sent, [['api', 'repos/williacj/rigger/collaborators/rigger-bot/permission', '-X', 'GET']]);
});

// proves R-SCHED-20
test('readNewestNumber asks the issues endpoint, which lists pull requests beside issues, for the newest one in any state, and answers its number', async () => {
  // GitHub's REST issues list holds pull requests as well, each carrying `pull_request`
  // (https://docs.github.com/rest/issues/issues#list-repository-issues).
  const send = forge(() => ({ status: 0, stdout: JSON.stringify([{ number: 141, pull_request: { url: 'https://api.github.com/repos/williacj/rigger/pulls/141' } }]), stderr: '' }));

  const newest = await repositoryReads(BOARD, { send }).readNewestNumber();

  assert.equal(newest, 141);
  assert.deepEqual(send.sent, [['api', 'repos/williacj/rigger/issues?state=all&sort=created&direction=desc&per_page=1', '-X', 'GET']]);
});

// proves R-SCHED-20
test('readNewestNumber answers 0 for a repository holding no issue or pull request', async () => {
  const send = forge(() => ({ status: 0, stdout: '[]', stderr: '' }));

  assert.equal(await repositoryReads(BOARD, { send }).readNewestNumber(), 0);
});
