// ABOUTME: Tests the three forge write sides' mark, in process with a stand-in `send`: a refused event
// on an operation's write call marked made with its parsed answer, and every other refusal left unmarked.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { itemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { repositoryWriteSide } from '../src/substrate/forge/repository-write.mjs';
import { schemaWriteSide } from '../src/substrate/forge/schema-write.mjs';
import { refusedCall, unrecordedKill } from './write-made-fixtures.mjs';

const BOARD = { repo: 'williacj/rigger', project: 6 };
const HEAD = 'a'.repeat(40);
const MERGED = 'b'.repeat(40);
const OWNER = { id: 'opt_owner', name: 'Owner', color: 'GRAY', description: '' };
const COMMENT = { id: 901, html_url: 'https://github.com/williacj/rigger/pull/12#issuecomment-901' };

/** Whether `args` is a write: a GraphQL mutation, or a REST request whose method is not GET. */
const isWrite = (args) => (args[1] === 'graphql' ? args.at(-1).startsWith('query=mutation') : args[3] !== 'GET');

/**
 * What GitHub answers each call an operation here makes, in the shape the read and write sides
 * parse: the board, its repository, the runners' own reads of the field holding the columns, an
 * issue's node id, a pull request, and each write's answer.
 */
function answerTo(args) {
  const [, path, , method] = args;
  if (path === 'graphql') {
    const query = args.at(-1);
    if (query.includes('repositoryOwner')) return { data: { repositoryOwner: { projectV2: { id: 'PVT_board', field: { id: 'PVTSSF_status', options: [OWNER] } } } } };
    if (query.includes('repository(owner')) return { data: { repository: { id: 'R_repo' } } };
    if (query.includes('project: node')) return { data: { project: { field: { id: 'PVTSSF_status' } }, target: { name: 'Status' } } };
    if (query.includes('field: node')) return { data: { field: { name: 'Status', options: [OWNER] } } };
    const root = /^query=mutation \{ (\w+)/.exec(query)[1];
    const answers = {
      updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_item' } },
      addProjectV2ItemById: { item: { id: 'PVTI_added' } },
      createProjectV2Field: { projectV2Field: { id: 'PVTSSF_priority' } },
      updateProjectV2Field: { projectV2Field: { id: 'PVTSSF_status' } },
      createLabel: { label: { id: 'LA_label' } },
    };
    return { data: { [root]: answers[root] } };
  }
  if (method === 'GET' && /\/pulls\/\d+$/.test(path)) return { number: 12, state: 'open', merged: false, mergeable: true, head: { sha: HEAD } };
  if (method === 'GET') return { node_id: 'I_issue214' };
  if (method === 'PUT') return { sha: MERGED, merged: true, message: 'Pull Request successfully merged' };
  if (path.endsWith('/comments')) return COMMENT;
  if (path.endsWith('/labels')) return [{ name: 'rigger:escalated' }];
  if (path.endsWith('/issues')) return { number: 214, labels: [{ name: 'rigger:status' }] };
  if (method === 'PATCH') return { number: 214, state: 'closed' };
  return [];
}

/**
 * A `send` answering every call as `answerTo` does, except the call `refuses(args, at)` picks, at
 * call index `at`, which rejects as `runCommand` does where the sink refused that call's kill
 * event: with its answer, or `refusal`'s, and `refusal`'s exit and timeout. Every call is kept in
 * `sent`.
 */
function forge(refuses = () => false, refusal = {}) {
  const sent = [];
  const send = (command, args) => {
    const at = sent.push(args) - 1;
    if (refuses(args, at)) throw refusedCall('answer' in refusal ? refusal.answer : answerTo(args), refusal);
    return { status: 0, timedOut: false, stdout: JSON.stringify(answerTo(args)), stderr: '' };
  };
  return { send, sent };
}

/**
 * Each write operation of the three sides: how it is called, its root field where it is a GraphQL
 * write, and the answer its mark carries, which is what the operation resolves with.
 */
const OPERATIONS = [
  { name: 'moveItem', root: 'updateProjectV2ItemFieldValue', run: (send) => itemWriteSide(BOARD, { send }).moveItem('PVTI_item', 'Owner'), answer: undefined },
  { name: 'addIssue', root: 'addProjectV2ItemById', run: (send) => itemWriteSide(BOARD, { send }).addIssue(214), answer: 'PVTI_added' },
  { name: 'createField', root: 'createProjectV2Field', run: (send) => schemaWriteSide(BOARD, { send }).createField('Priority', ['High', 'Low']), answer: undefined },
  { name: 'createColumn', root: 'updateProjectV2Field', run: (send) => schemaWriteSide(BOARD, { send }).createColumn('Done'), answer: undefined },
  { name: 'createLabel', root: 'createLabel', run: (send) => schemaWriteSide(BOARD, { send }).createLabel('rigger:status'), answer: undefined },
  { name: 'mergePullRequest', run: (send) => repositoryWriteSide(BOARD, { send }).mergePullRequest(12, HEAD), answer: { outcome: 'merged', sha: MERGED } },
  { name: 'postComment', run: (send) => repositoryWriteSide(BOARD, { send }).postComment(12, 'Verdict'), answer: COMMENT },
  { name: 'postIssueComment', run: (send) => repositoryWriteSide(BOARD, { send }).postIssueComment(30, 'Routed'), answer: COMMENT },
  { name: 'addIssueLabel', run: (send) => repositoryWriteSide(BOARD, { send }).addIssueLabel(30, 'rigger:escalated'), answer: [{ name: 'rigger:escalated' }] },
  { name: 'openIssue', run: (send) => repositoryWriteSide(BOARD, { send }).openIssue('Status', 'Hold', 'rigger:status'), answer: 214 },
  { name: 'closeIssue', run: (send) => repositoryWriteSide(BOARD, { send }).closeIssue(214), answer: { number: 214, state: 'closed' } },
  { name: 'removeIssueLabel', run: (send) => repositoryWriteSide(BOARD, { send }).removeIssueLabel(214, 'rigger:status'), answer: [] },
];

/** The failure `operation` rejects with over `send`; the test fails where it resolves. */
async function rejection(operation, send) {
  let resolved;
  try {
    resolved = await operation.run(send);
  } catch (failure) {
    return failure;
  }
  assert.fail(`${operation.name} resolved with ${JSON.stringify(resolved)}`);
}

/** The refusals on `operation`'s write call whose result fails its success check, each with why. */
const failingChecks = (operation) => [
  ['a non-zero exit', { exit: 1 }],
  ['a timeout', { timedOut: true }],
  ['an answer that does not parse', { answer: 'gh: not json' }],
  ...(operation.root === undefined ? [] : [
    ['an answer whose data lacks the mutation\'s root field', { answer: { data: {} } }],
    ['an answer whose data holds the mutation\'s root field null', { answer: { data: { [operation.root]: null } } }],
  ]),
  ...(operation.name === 'mergePullRequest' ? [['an answer whose merged is not true', { answer: { sha: MERGED, merged: false } }]] : []),
  ...(operation.name === 'openIssue' ? [['an answer whose issue lacks its label', { answer: { number: 214, labels: [] } }]] : []),
];

for (const operation of OPERATIONS) {
  test(`${operation.name} marks a refused kill event on its write call made, with its parsed answer, only where the result passes its success check (${failingChecks(operation).map(([why]) => `not on ${why}`).join(', ')}), and never one on a read before its write, the side's or its runner's own`, async () => {
    const { send, sent } = forge(isWrite);
    const made = await rejection(operation, send);
    assert.equal(made.code, 'EVENT_REFUSED', made.message);
    assert.deepEqual(made.made, { answer: operation.answer }, made.message);
    assert.deepEqual(made.unrecorded.map(({ event }) => event), unrecordedKill().map(({ event }) => event));
    assert.equal(made.result.exit, 0);
    assert.equal(sent.filter(isWrite).length, 1);

    for (const [why, refusal] of failingChecks(operation)) {
      const failure = await rejection(operation, forge(isWrite, refusal).send);
      assert.equal(failure.code, 'EVENT_REFUSED', `${why}: ${failure.message}`);
      assert.equal('made' in failure, false, `${operation.name} was marked made on ${why}`);
    }

    const { send: probe, sent: calls } = forge();
    await operation.run(probe);
    const reads = calls.findIndex(isWrite);
    assert.ok(reads >= 0, `${operation.name} sent no write`);
    for (let at = 0; at < reads; at += 1) {
      const refused = forge((args, index) => index === at);
      const failure = await rejection(operation, refused.send);
      assert.equal(failure.code, 'EVENT_REFUSED', failure.message);
      assert.equal('made' in failure, false, `${operation.name}'s read ${at} was marked made`);
      assert.deepEqual(refused.sent.filter(isWrite), [], `${operation.name} wrote after its read ${at} was refused`);
    }
  });
}
