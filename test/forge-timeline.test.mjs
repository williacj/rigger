// ABOUTME: Tests the read side's read of an issue's timeline: its comments, label changes, closes
// and reopens, oldest first across every page, against the recaptured timeline and fakes built from it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { statusNotice } from '../src/workflow/status-issue.mjs';
import { recordingSink } from './admission-world.mjs';
import { forge as notices } from './notice-forge.mjs';

/** The board every read here is made for, as a config names it. */
const BOARD = { repo: 'williacj/rigger', project: 6, columns: { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' } };

/**
 * The command the fixture is the unedited answer of, run with gh 2.103.2 on 2026-10-28 as
 * `gh api graphql -f query=<QUERY>`: the timeline read of #794 in williacj/rigger.
 */
const QUERY = 'query { repository(owner: "williacj", name: "rigger") { issue(number: 794) { timelineItems(itemTypes: [ISSUE_COMMENT, LABELED_EVENT, UNLABELED_EVENT, CLOSED_EVENT, REOPENED_EVENT], first: 100) { pageInfo { hasNextPage endCursor } nodes { __typename ... on IssueComment { body createdAt id author { login } lastEditedAt includesCreatedEdit } ... on LabeledEvent { createdAt actor { login } label { name } } ... on UnlabeledEvent { createdAt actor { login } label { name } } ... on ClosedEvent { createdAt actor { login } } ... on ReopenedEvent { createdAt actor { login } } } } } } }';

/** What gh printed for `QUERY`, as the text it is. */
const PRINTED = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rigger-issue-timeline-2026-10-28.json'), 'utf8');

/** The timeline's nodes as gh printed them. */
const NODES = JSON.parse(PRINTED).data.repository.issue.timelineItems.nodes;

/** What gh prints for `data` on a GraphQL read that succeeded. */
const ok = (data) => ({ status: 0, stdout: JSON.stringify({ data }), stderr: '' });

/** The document a `gh api graphql -f query=` request carries. */
const documentOf = (args) => args[3].slice('query='.length);

/** The cursor a page request carries, or null for the first page. */
const cursorOf = (document) => document.match(/after: "([^"]*)"/)?.[1] ?? null;

/** One page of the timeline read's answer: `nodes`, pointing on to the page `next` where there is one. */
const page = (nodes, next = null) => ok({ repository: { issue: { timelineItems: { pageInfo: { hasNextPage: next !== null, endCursor: next ?? 'END' }, nodes } } } });

/**
 * A forge answering the timeline read from `pages`, keyed by the cursor each is asked for, and each
 * permission read from `permissions`, by login, where a login it does not name answers Not Found as
 * the collaborator endpoint does for an account without access. Every request is recorded.
 */
function forge(pages, permissions = { williacj: 'admin' }) {
  const sent = [];
  const send = (command, args) => {
    sent.push(args);
    if (args[1] !== 'graphql') {
      const login = decodeURIComponent(args[1].split('/')[4]);
      if (permissions[login] === undefined) return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)\n' };
      return { status: 0, stdout: JSON.stringify({ role_name: permissions[login] }), stderr: '' };
    }
    const cursor = String(cursorOf(documentOf(args)));
    assert.ok(Object.hasOwn(pages, cursor), `the page after ${cursor} is not one this forge holds`);
    return pages[cursor];
  };
  return Object.assign(send, { sent });
}

/** A comment node shaped as the fixture's are, by `login`, or by a deleted account where it is null. */
const commentNode = ({ body, createdAt, login = 'williacj', edited = false }) => ({ __typename: 'IssueComment', body, createdAt, id: `IC_${createdAt}`, author: login === null ? null : { login }, lastEditedAt: edited ? createdAt : null, includesCreatedEdit: false });

/** An event node shaped as the fixture's are, by `login`, or by a deleted account where it is null. */
const eventNode = (type, createdAt, login = 'williacj', label) => ({ __typename: type, createdAt, actor: login === null ? null : { login }, ...(label && { label: { name: label } }) });

// proves R-SCHED-23
test('the timeline read sends the command the recaptured fixture names, and answers every entry of gh\'s unedited answer in order', async () => {
  const send = forge({ null: { status: 0, stdout: PRINTED, stderr: '' } });

  const timeline = await repositoryReads(BOARD, { send }).readIssueTimeline(794);

  assert.equal(documentOf(send.sent[0]), QUERY);
  // Derived by hand from the fixture: a comment and two labels at the opening, a comment, a close by
  // a merged pull request's keyword, a comment, a reopen, six comments, a close, and U91's two
  // writes, the removal of maker:codex and its return.
  assert.deepEqual(timeline.map(({ kind, label }) => (label ? `${kind} ${label}` : kind)), [
    'comment', 'labeled type:change', 'labeled maker:codex', 'comment', 'closed', 'comment', 'reopened',
    'comment', 'comment', 'comment', 'comment', 'comment', 'comment', 'closed', 'unlabeled maker:codex', 'labeled maker:codex',
  ]);
  assert.deepEqual(timeline[14], { kind: 'unlabeled', createdAt: '2026-10-28T14:39:38Z', actor: 'williacj', label: 'maker:codex' });
  assert.deepEqual(timeline[1], { kind: 'labeled', createdAt: '2026-10-17T15:16:31Z', actor: 'williacj', label: 'type:change' });
  assert.deepEqual(timeline[4], { kind: 'closed', createdAt: '2026-10-18T14:32:22Z', actor: 'williacj' });
  assert.deepEqual(timeline[6], { kind: 'reopened', createdAt: '2026-10-18T14:32:40Z', actor: 'williacj' });
  const [first] = NODES;
  assert.deepEqual(timeline[0], { kind: 'comment', body: first.body, createdAt: first.createdAt, id: first.id, author: 'williacj', permission: 'admin', edited: false });
  // One permission read for the one author, however many comments it wrote.
  assert.equal(send.sent.filter((args) => args[1] !== 'graphql').length, 1);
});

// proves R-SCHED-23
test('the timeline read reads every page, passing each cursor on, and answers each entry of every page', async () => {
  // A fake built from the fixture: its nodes split over three pages.
  const send = forge({ null: page(NODES.slice(0, 5), 'P2'), P2: page(NODES.slice(5, 10), 'P3'), P3: page(NODES.slice(10)) });

  const timeline = await repositoryReads(BOARD, { send }).readIssueTimeline(794);

  assert.equal(timeline.length, NODES.length);
  assert.deepEqual(timeline.map(({ createdAt }) => createdAt), NODES.map(({ createdAt }) => createdAt));
  assert.deepEqual(send.sent.filter((args) => args[1] === 'graphql').map((args) => cursorOf(documentOf(args))), [null, 'P2', 'P3']);
});

// proves R-SCHED-23
test('the timeline read answers a page refused partway as a failure naming the issue\'s timeline, and no part of it', async () => {
  const send = forge({ null: page(NODES.slice(0, 5), 'P2'), P2: { status: 1, stdout: '', stderr: 'gh: HTTP 502: Bad Gateway (https://api.github.com/graphql)\n' } });

  await assert.rejects(repositoryReads(BOARD, { send }).readIssueTimeline(794), (error) => {
    assert.match(error.message, /^readIssueTimeline on board 6 failed: reading issue #794's timeline in williacj\/rigger, /);
    assert.match(error.message, /HTTP 502/);
    return true;
  });
});

// proves R-SCHED-23
test('the timeline read answers every close whoever made it, a deleted account\'s entries with a null actor, and each comment\'s author permission and edit', async () => {
  // Constructed from the fixture's shapes. A bot's login and a board workflow's are as GitHub names
  // the accounts acting for them; a deleted account's actor and author are null.
  const nodes = [
    eventNode('LabeledEvent', '2026-10-01T00:00:00Z', 'williacj', 'rigger:status'),
    commentNode({ body: 'Hold: `a1`', createdAt: '2026-10-01T00:01:00Z', login: 'stranger' }),
    commentNode({ body: 'Hold: `a1`', createdAt: '2026-10-01T00:02:00Z', edited: true }),
    commentNode({ body: 'Gone.', createdAt: '2026-10-01T00:03:00Z', login: null }),
    eventNode('LabeledEvent', '2026-10-01T00:04:00Z', 'williacj', 'type:change'),
    eventNode('ClosedEvent', '2026-10-01T00:06:00Z', 'williacj'),
    eventNode('ReopenedEvent', '2026-10-01T00:07:00Z', 'triager'),
    eventNode('ClosedEvent', '2026-10-01T00:08:00Z', 'triager'),
    eventNode('ClosedEvent', '2026-10-01T00:09:00Z', 'dependabot[bot]'),
    eventNode('ClosedEvent', '2026-10-01T00:10:00Z', null),
    eventNode('ClosedEvent', '2026-10-01T00:11:00Z', 'github-project-automation[bot]'),
  ];
  const send = forge({ null: page(nodes) }, { williacj: 'admin', triager: 'triage', stranger: 'read' });

  const timeline = await repositoryReads(BOARD, { send }).readIssueTimeline(7);

  assert.deepEqual(timeline.filter(({ kind }) => kind === 'closed').map(({ actor }) => actor), ['williacj', 'triager', 'dependabot[bot]', null, 'github-project-automation[bot]']);
  assert.deepEqual(timeline.filter(({ kind }) => kind === 'comment').map(({ author, permission, edited }) => ({ author, permission, edited })), [
    { author: 'stranger', permission: 'read', edited: false },
    { author: 'williacj', permission: 'admin', edited: true },
    { author: null, permission: 'none', edited: false },
  ]);
  assert.deepEqual(timeline.filter(({ label }) => label !== undefined).map(({ kind, label }) => `${kind} ${label}`), ['labeled rigger:status', 'labeled type:change']);
  assert.equal(timeline[0].createdAt, '2026-10-01T00:00:00Z');
});

// proves R-SCHED-23
test('the recaptured removal of another label, read from the fixture, is not a status-label change to L2: a close after it still counts for the hold', async () => {
  const timeline = await repositoryReads(BOARD, { send: forge({ null: { status: 0, stdout: PRINTED, stderr: '' } }) }).readIssueTimeline(794);
  const changes = timeline.slice(-2);
  assert.deepEqual(changes.map(({ kind, label }) => `${kind} ${label}`), ['unlabeled maker:codex', 'labeled maker:codex']);
  // The hold's notice reached the issue at its opening, which carried the status label; then the
  // two real label changes; then a close.
  const opened = { kind: 'labeled', createdAt: '2026-10-01T00:00:00Z', actor: 'rigger-bot', label: 'rigger:status' };
  const closed = { kind: 'closed', createdAt: '2026-10-28T15:00:00Z', actor: 'williacj' };
  const world = notices({ issues: [{ number: 794, title: 'Rigger closed admission', body: 'Hold: `a1`', author: 'rigger-bot', state: 'closed', labels: ['rigger:status'], comments: [], timeline: [opened, ...changes, closed] }] });
  const { sink } = recordingSink();
  const notice = statusNotice({ reads: world.reads, writes: world.writes, board: world.board, items: world.items, columns: BOARD.columns, sink });

  const ended = await notice({ closer: { name: 'hold-a1-issue-794.json', kind: 'hold', id: 'a1', issue: '794', reason: 'r', time: 1, run: 'r-1' }, others: [], state: 'closed' }).next();

  assert.deepEqual(ended, { done: true, value: { issue: 794, closed: true } });
});
