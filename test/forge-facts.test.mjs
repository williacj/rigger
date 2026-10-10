// ABOUTME: Tests L2's facts call: what it reads of each pullable card's line of work before a
// claim, how it fails, and what L2's next action answers from those facts: a refusal naming what
// the forge holds, a Review card ignored, or a Review card done again from the beginning.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from '../rigger.config.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { createFakeRepository } from './fake-repository.mjs';

const { columns } = config.board;

/** A body whose acceptance passes the form check under the title `Add a verb`. */
const PASSING = '## Acceptance\n\n- The verb prints its help.\n';

/** Card `number` in the column displayed as `column`, which one kind selects and the form check admits. */
const cardIn = (number, column) => ({ id: `item-${number}`, number, title: 'Add a verb', body: PASSING, labels: ['type:change'], column });

/** One kind, selected by `type:change`. */
const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };

/**
 * The repository reads over a fake repository seeded with `seed`, recording each read made as
 * `[operation, what]`, and failing the reads `fail(operation, what)` answers true for.
 */
function readsOver(seed = {}, fail = () => false) {
  const repository = createFakeRepository(seed);
  const made = [];
  const reads = Object.fromEntries(Object.entries(repository.operations).map(([operation, read]) => [operation, async (what) => {
    made.push([operation, what]);
    if (fail(operation, what)) throw new Error(`readPullRequests on board 6 failed: reading the pull requests from branch ${what} in williacj/rigger, gh: HTTP 502`);
    return read(what);
  }]));
  return { reads, made, held: () => repository.held() };
}

/** L2's next action for each card, decided by the facts call over `reads` for `cards`, as L3 would ask it at the pull. */
async function decided(cards, reads, { fresh } = {}) {
  const decide = (card) => nextAction(card, KINDS, undefined, { columns, fresh });
  const atPull = await factsCall({ config, reads, decide })(cards);
  return cards.map((card) => atPull(card));
}

test('L2\'s facts call reads, for every Ready, Coding and Review card it is handed, the pull requests from its line of work, and the branches once for them all', async () => {
  const { reads, made } = readsOver();
  const cards = [cardIn(1, columns.ready), cardIn(2, columns.coding), cardIn(3, columns.review), cardIn(4, columns.owner), cardIn(5, columns.done), cardIn(6, null)];

  await factsCall({ config, reads, decide: () => ({ action: 'ignore' }) })(cards);

  assert.deepEqual(made.filter(([operation]) => operation === 'readPullRequests').map(([, branch]) => branch), ['rigger-1', 'rigger-2', 'rigger-3']);
  assert.deepEqual(made.filter(([operation]) => operation === 'readBranches'), [['readBranches', ['rigger-1', 'rigger-2', 'rigger-3']]]);
  assert.equal(made.length, 4, JSON.stringify(made));
});

test('given its read of one card\'s pull requests failing, L2\'s facts call rejects naming the card and the read', async () => {
  const { reads } = readsOver({}, (operation, what) => operation === 'readPullRequests' && what === 'rigger-2');

  await assert.rejects(
    factsCall({ config, reads, decide: () => ({ action: 'ignore' }) })([cardIn(1, columns.ready), cardIn(2, columns.coding)]),
    (error) => /card #2\b/.test(error.message) && /pull requests from branch rigger-2/.test(error.message),
  );
});

test('given its read of the branches failing, L2\'s facts call rejects naming every card it read for and the read', async () => {
  const { reads } = readsOver({}, (operation) => operation === 'readBranches');

  await assert.rejects(
    factsCall({ config, reads, decide: () => ({ action: 'ignore' }) })([cardIn(1, columns.ready), cardIn(2, columns.coding)]),
    (error) => /#1\b/.test(error.message) && /#2\b/.test(error.message) && /HTTP 502/.test(error.message),
  );
});

/** A diff the forge serves, and the merge base it computes it from, each written by hand. */
const DIFF = 'diff --git a/src/verb.mjs b/src/verb.mjs\n+export const verb = 1;\n';
const BASE = 'c'.repeat(40);

/** A pull request from card `number`'s line of work, numbered `pull`, merged where `merged` says. */
const pullFrom = (number, pull, merged = false) => ({ number: pull, head: `rigger-${number}`, sha: `${pull}`.padStart(40, 'a'), merged });

// proves R-WORK-19
test('given a Ready card whose line of work the forge holds, L2 refuses the card, naming it and its line of work', async () => {
  const [next] = await decided([cardIn(1, columns.ready)], readsOver({ branches: ['rigger-1'] }).reads);

  assert.equal(next.action, 'refuse', JSON.stringify(next));
  assert.equal(next.card, 1);
  assert.match(next.reason, /\brigger-1\b/);
});

// proves R-WORK-19
test('given a Coding card whose line of work the forge holds, L2 refuses the card, naming it and its line of work', async () => {
  const [next] = await decided([cardIn(2, columns.coding)], readsOver({ branches: ['rigger-2'] }).reads);

  assert.equal(next.action, 'refuse', JSON.stringify(next));
  assert.equal(next.card, 2);
  assert.match(next.reason, /\brigger-2\b/);
});

// proves R-WORK-19
test('given a Ready, Coding or Review card with a merged pull request from its line of work, L2 refuses the card, naming it and the pull request', async () => {
  for (const column of [columns.ready, columns.coding, columns.review]) {
    const [next] = await decided([cardIn(3, column)], readsOver({ pullRequests: [pullFrom(3, 31, true)] }).reads);

    assert.equal(next.action, 'refuse', `${column}: ${JSON.stringify(next)}`);
    assert.equal(next.card, 3);
    assert.match(next.reason, /#31\b/, column);
  }
});

// proves R-WORK-19
test('given a Ready card with a merged pull request from its line of work and the branch deleted, L2 refuses the card, naming the pull request', async () => {
  const repository = readsOver({ pullRequests: [pullFrom(4, 41, true)] });
  assert.deepEqual(await repository.reads.readBranches(['rigger-4']), { 'rigger-4': false }, 'the branch is not on the forge');

  const [next] = await decided([cardIn(4, columns.ready)], repository.reads);

  assert.equal(next.action, 'refuse', JSON.stringify(next));
  assert.match(next.reason, /#41\b/);
});

// proves R-WORK-19
test('given a Review card with two open pull requests from its line of work, L2 refuses the card, naming it and each pull request', async () => {
  const [next] = await decided([cardIn(5, columns.review)], readsOver({ pullRequests: [pullFrom(5, 51), pullFrom(5, 52)] }).reads);

  assert.equal(next.action, 'refuse', JSON.stringify(next));
  assert.equal(next.card, 5);
  assert.match(next.reason, /#51\b/);
  assert.match(next.reason, /#52\b/);
});

// proves R-WORK-19
test('given a Review card with no open or merged pull request and its line of work on the forge, L2 refuses the card, naming it and its line of work', async () => {
  const [next] = await decided([cardIn(6, columns.review)], readsOver({ branches: ['rigger-6'] }).reads);

  assert.equal(next.action, 'refuse', JSON.stringify(next));
  assert.equal(next.card, 6);
  assert.match(next.reason, /\brigger-6\b/);
});

test('given a Review card with one open pull request from its line of work, L2 answers its agent judges', async () => {
  const [next] = await decided([cardIn(7, columns.review)], readsOver({ pullRequests: [{ ...pullFrom(7, 71), diff: DIFF, mergeBase: BASE }] }).reads);

  assert.equal(next.action, 'judge', JSON.stringify(next));
  assert.deepEqual(next.judges.map(({ role, facts }) => ({ role, facts })), [{ role: 'reviewer', facts: { card: 7, revision: null, pull: 71, base: BASE, head: pullFrom(7, 71).sha } }]);
});

// proves R-WORK-24
test('given a Review card with no pull request and no line of work on the forge, L2 answers a redo from the beginning', async () => {
  const [next] = await decided([cardIn(8, columns.review)], readsOver().reads);

  assert.deepEqual(next, { action: 'dispatch', kind: 'change' });
});

test('given a Ready or Coding card the forge holds nothing for, L2 dispatches it as at the base', async () => {
  const nexts = await decided([cardIn(9, columns.ready), cardIn(10, columns.coding)], readsOver().reads);

  assert.deepEqual(nexts, [{ action: 'dispatch', kind: 'change' }, { action: 'dispatch', kind: 'change' }]);
});

test('given a Coding or Review card that injected freshness answers fresh, L2 answers ignore whatever the forge holds', async () => {
  const seed = { branches: ['rigger-11', 'rigger-12'], pullRequests: [pullFrom(11, 111, true), pullFrom(12, 121), pullFrom(12, 122)] };
  const nexts = await decided([cardIn(11, columns.coding), cardIn(12, columns.review)], readsOver(seed).reads, { fresh: () => true });

  assert.deepEqual(nexts, [{ action: 'ignore' }, { action: 'ignore' }]);
});

test('given a card no kind selects, L2 ignores it whatever the forge holds, and never refuses it', async () => {
  const unselected = { ...cardIn(13, columns.ready), labels: ['type:other'] };
  const [next] = await decided([unselected], readsOver({ branches: ['rigger-13'] }).reads);

  assert.deepEqual(next, { action: 'ignore' });
});

// proves R-LOOP-13, R-WORK-19
test('given a Ready card whose line of work the forge holds and whose labels select two tiers for its maker role, L2\'s one refusal names the role, both labels and its line of work', async () => {
  const roles = { ...config.roles, engineer: { ...config.roles.engineer, labels: { 'tier:high': 'high', 'tier:low': 'standard' } } };
  const conflicted = { ...cardIn(14, columns.ready), labels: ['type:change', 'tier:high', 'tier:low'] };
  const decide = (card) => nextAction(card, KINDS, undefined, { columns, roles });

  const next = (await factsCall({ config, reads: readsOver({ branches: ['rigger-14'] }).reads, decide })([conflicted]))(conflicted);

  assert.equal(next.action, 'refuse', JSON.stringify(next));
  assert.equal(next.card, 14);
  for (const named of [/\bengineer\b/, /tier:high/, /tier:low/, /\brigger-14\b/]) assert.match(next.reason, named);
});

// proves R-LOOP-13, R-WORK-19
test('given a Ready card whose line of work the forge holds, whose acceptance the form check refuses, and whose labels select two tiers for its maker role, L2\'s one refusal names the role, both labels, its line of work and the form check\'s reason', async () => {
  const roles = { ...config.roles, engineer: { ...config.roles.engineer, labels: { 'tier:high': 'high', 'tier:low': 'standard' } } };
  const everything = { ...cardIn(15, columns.ready), body: '## Notes\n\nNo acceptance here.\n', labels: ['type:change', 'tier:high', 'tier:low'] };
  const decide = (card) => nextAction(card, KINDS, undefined, { columns, roles });

  const next = (await factsCall({ config, reads: readsOver({ branches: ['rigger-15'] }).reads, decide })([everything]))(everything);

  assert.equal(next.action, 'refuse', JSON.stringify(next));
  assert.equal(next.card, 15);
  for (const named of [/\bengineer\b/, /tier:high/, /tier:low/, /\brigger-15\b/, /missing acceptance/]) assert.match(next.reason, named);
});

test('given a Review card with one open pull request from its line of work and agent judges, L2 answers ignore where injected freshness answers fresh, whatever the forge holds', async () => {
  const [next] = await decided([cardIn(16, columns.review)], readsOver({ pullRequests: [{ ...pullFrom(16, 161), diff: DIFF, mergeBase: BASE }] }).reads, { fresh: () => true });

  assert.deepEqual(next, { action: 'ignore' });
});

test('L2\'s facts call reads, for each Review card holding exactly one open pull request from its line of work, that pull request, its diff, its comments and the acceptance\'s revision, and reads none of them for any other card', async () => {
  const seed = {
    pullRequests: [
      { ...pullFrom(17, 171), diff: DIFF, mergeBase: BASE },
      pullFrom(18, 181),
      pullFrom(19, 191), pullFrom(19, 192),
      pullFrom(20, 201),
    ],
  };
  const { reads, made } = readsOver(seed);
  const cards = [cardIn(17, columns.review), cardIn(18, columns.ready), cardIn(19, columns.review), cardIn(20, columns.coding), cardIn(21, columns.review)];

  await factsCall({ config, reads, decide: () => ({ action: 'ignore' }) })(cards);

  const reviewReads = made.filter(([operation]) => !['readPullRequests', 'readBranches'].includes(operation));
  assert.deepEqual(reviewReads.sort(), [['readComments', 171], ['readDiff', 171], ['readEditedAt', 17], ['readMergeBase', 171]]);
});

test('L2\'s facts call answers a Review card\'s one open pull request as its number, the merge base its diff is taken from and its head, beside its diff, comments and revision, each as the read settled', async () => {
  const comments = [{ body: 'Findings at x by reviewer', createdAt: '2026-10-03T09:00:00Z' }];
  const seed = { pullRequests: [{ ...pullFrom(22, 221), diff: DIFF, mergeBase: BASE, comments }], edited: { 22: '2026-10-02T08:00:00Z' } };
  let forge;
  const decide = (card) => {
    forge = card.forge;
    return { action: 'ignore' };
  };

  (await factsCall({ config, reads: readsOver(seed).reads, decide })([cardIn(22, columns.review)]))(cardIn(22, columns.review));

  const { pull, diff, comments: read, editedAt } = forge;
  assert.deepEqual({ pull, diff, comments: read, editedAt }, {
    pull: { status: 'fulfilled', value: { number: 221, base: BASE, head: pullFrom(22, 221).sha } },
    diff: { status: 'fulfilled', value: DIFF },
    comments: { status: 'fulfilled', value: [{ ...comments[0], id: 'IC_221_1', author: 'rigger-fake', permission: 'write', edited: false }] },
    editedAt: { status: 'fulfilled', value: '2026-10-02T08:00:00Z' },
  });
});
