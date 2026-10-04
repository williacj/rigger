// ABOUTME: Tests L2's settle of a maker's outcome against what the forge holds: the move to review
// only on exit 0 and one open pull request from the card's line of work, the card left in coding
// otherwise with its caller told why, and a Review card moved back to coding when it is redone.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from '../rigger.config.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { readsWith } from './loop-world.mjs';

const { columns } = config.board;

/** A pull request from card `number`'s line of work, numbered `pull`. */
const pullFrom = (number, pull) => ({ number: pull, head: `rigger-${number}`, sha: `${pull}`.padStart(40, 'b') });

/**
 * L2's column changes over a fake board holding card 12 in the column displayed as `column`, a
 * fake repository seeded with `seed` and one sink. `reads` records each pull-request read made, and
 * `fail` has every one of them fail.
 */
async function world({ column = columns.coding, seed = {}, fail = false } = {}) {
  const fake = createFakeBoard({
    columns: Object.values(columns),
    items: [{ type: 'issue', repository: config.repo, number: 12, title: 'Card 12', column }],
  });
  const repository = createFakeRepository(seed);
  const reads = [];
  const pullRequests = async (branch) => {
    reads.push(branch);
    if (fail) throw new Error(`readPullRequests on board 6 failed: reading the pull requests from branch ${branch} in williacj/rigger, gh: HTTP 502`);
    return repository.operations.readPullRequests(branch);
  };
  const directory = temporaryDirectory('rigger-settle-');
  const sink = openSink({ directory, run: 'r-test', now: () => 0 });
  const l2 = columnChanges({ config, sink, items: fake.operations, reads: readsWith(pullRequests) });
  const [card] = await fake.operations.readItems();
  const l2Events = () => readEventsOr(directory).filter((event) => event.layer === 'L2');
  return { fake, l2, card, reads, l2Events, held: () => repository.held() };
}

/** The events in `directory`'s stream, or none where nothing was ever appended. */
function readEventsOr(directory) {
  try {
    return readEvents(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** A dispatch outcome as `Promise.allSettled` records a maker that exited `exit`, printing `stdout`. */
const exited = (exit, stdout = '') => ({ status: 'fulfilled', value: { exit, stdout, stderr: '' } });

/** Each card on `fake` by number, with the column it is in now. */
const columnOf = async (fake) => (await fake.operations.readItems())[0].column;

// proves R-WORK-18
test('given a maker outcome of exit 0 and an open pull request from the card\'s line of work, L2 moves the card from coding to review', async () => {
  const w = await world({ seed: { pullRequests: [pullFrom(12, 120)] } });

  await w.l2.settled(w.card, exited(0));

  assert.equal(await columnOf(w.fake), columns.review);
  assert.deepEqual(w.l2Events().map(({ event, from, to, cause }) => ({ event, from, to, cause })), [{ event: 'transition', from: 'coding', to: 'review', cause: 'returned' }]);
});

/**
 * The review reads L2's settle answers beside the pull requests for card 12's one open pull request,
 * #120, as `world`'s reads answer them: each pull request read from a repository holding none, and
 * the card's body never edited.
 */
const UNREAD = {
  pull: { status: 'rejected', reason: new Error('the fake repository holds no pull request #120, so readMergeBase has nothing to read') },
  diff: { status: 'rejected', reason: new Error('the fake repository holds no pull request #120, so readDiff has nothing to read') },
  comments: { status: 'rejected', reason: new Error('the fake repository holds no pull request #120, so readComments has nothing to read') },
  editedAt: { status: 'fulfilled', value: null },
};

// proves R-WORK-18
test('L2\'s settle makes one read of the forge for that card and answers the facts it read', async () => {
  const w = await world({ seed: { pullRequests: [pullFrom(12, 120)] } });

  const facts = await w.l2.settled(w.card, exited(0));

  assert.deepEqual(w.reads, ['rigger-12']);
  assert.deepEqual(facts, { line: 'rigger-12', open: [{ number: 120, head: pullFrom(12, 120).sha, base: 'main' }], merged: [], ...UNREAD });
});

// proves R-WORK-18
test('given a maker outcome of exit 0 and no open pull request from the card\'s line of work, L2 leaves the card in coding, records an event under the card saying no pull request was found, and its caller is told the card and why', async () => {
  const w = await world();

  await assert.rejects(w.l2.settled(w.card, exited(0)), (error) => /card #12\b/.test(error.message) && /no open pull request/.test(error.message) && /rigger-12/.test(error.message));

  assert.equal(await columnOf(w.fake), columns.coding);
  assert.deepEqual(w.fake.writes(), []);
  const [event, ...more] = w.l2Events();
  assert.deepEqual(more, []);
  assert.equal(event.card, 12);
  assert.equal(event.event, 'review.withheld');
  assert.match(event.reason, /no open pull request/);
});

// proves R-WORK-18
test('given a maker outcome of exit 0 and two open pull requests from the card\'s line of work, L2 leaves the card in coding, naming the card and both pull requests', async () => {
  const w = await world({ seed: { pullRequests: [pullFrom(12, 121), pullFrom(12, 122)] } });

  await assert.rejects(w.l2.settled(w.card, exited(0)), (error) => /card #12\b/.test(error.message) && /#121\b/.test(error.message) && /#122\b/.test(error.message));

  assert.equal(await columnOf(w.fake), columns.coding);
  assert.deepEqual(w.fake.writes(), []);
});

// proves R-WORK-18
test('given a maker outcome of exit 0 and a read of the forge that fails, L2 leaves the card in coding, and its caller is told the card and the read that failed', async () => {
  const w = await world({ fail: true });

  await assert.rejects(w.l2.settled(w.card, exited(0)), (error) => /#12\b/.test(error.message) && /pull requests from branch rigger-12/.test(error.message));

  assert.equal(await columnOf(w.fake), columns.coding);
  assert.deepEqual(w.fake.writes(), []);
});

// proves R-WORK-18
test('given a maker outcome of non-zero exit, L2 leaves the card in coding, and the read side is not asked', async () => {
  const w = await world({ seed: { pullRequests: [pullFrom(12, 120)] } });

  await w.l2.settled(w.card, exited(1));

  assert.equal(await columnOf(w.fake), columns.coding);
  assert.deepEqual(w.fake.writes(), []);
  assert.deepEqual(w.reads, []);
});

// proves R-WORK-18
test('L2 decides the move from the exit code and the forge alone, never from the output: exit 0 saying "pull request opened" with no pull request on the forge leaves the card in coding', async () => {
  const w = await world();

  await assert.rejects(w.l2.settled(w.card, exited(0, 'pull request opened: https://github.com/williacj/rigger/pull/120')), /no open pull request/);

  assert.equal(await columnOf(w.fake), columns.coding);
  assert.deepEqual(w.fake.writes(), []);
});

test('given a maker outcome rejected with NOT_STARTED, L2 leaves the card in coding, and records under the card the failure classed as the environment\'s', async () => {
  const w = await world({ seed: { pullRequests: [pullFrom(12, 120)] } });
  const why = 'the provider adapter could not list the skills to switch off';

  await w.l2.settled(w.card, { status: 'rejected', reason: Object.assign(new Error(why), { code: NOT_STARTED }) });

  assert.equal(await columnOf(w.fake), columns.coding);
  assert.deepEqual(w.fake.writes(), []);
  assert.deepEqual(w.reads, []);
  assert.deepEqual(w.l2Events().map(({ event, card, class: classed, reason }) => ({ event, card, class: classed, reason })), [{ event: 'maker.failed', card: 12, class: 'environment', reason: why }]);
});

// proves R-WORK-24
test('a Review card L3 claims to do again from the beginning moves from review to coding, with one transition event under the card naming its cause', async () => {
  const w = await world({ column: columns.review });

  await w.l2.claimed(w.card);

  assert.equal(await columnOf(w.fake), columns.coding);
  assert.deepEqual(w.fake.writes(), [{ operation: 'moveItem', args: [w.card.id, columns.coding] }]);
  assert.deepEqual(w.l2Events().map(({ event, card, from, to, cause }) => ({ event, card, from, to, cause })), [{ event: 'transition', card: 12, from: 'review', to: 'coding', cause: 'redone' }]);
});

test('a Coding card L3 claims is not moved, and no transition is recorded for it', async () => {
  const w = await world({ column: columns.coding });

  await w.l2.claimed(w.card);

  assert.deepEqual(w.fake.writes(), []);
  assert.deepEqual(w.l2Events(), []);
});

test('L2\'s settle reads, in its one read for the card it settles, its one open pull request, that pull request\'s diff and comments and the acceptance\'s revision, and answers them', async () => {
  const fake = createFakeBoard({ columns: Object.values(columns), items: [{ type: 'issue', repository: config.repo, number: 13, title: 'Card 13', column: columns.coding }] });
  const base = 'e'.repeat(40);
  const comments = [{ body: 'A person\'s note.', createdAt: '2026-10-03T09:00:00Z' }];
  const repository = createFakeRepository({ pullRequests: [{ ...pullFrom(13, 130), diff: 'diff --git a/x b/x\n', mergeBase: base, comments }], edited: { 13: '2026-10-02T08:00:00Z' } });
  const made = [];
  const reads = Object.fromEntries(Object.entries(repository.operations).map(([operation, read]) => [operation, (what) => {
    made.push([operation, what]);
    return read(what);
  }]));
  const l2 = columnChanges({ config, sink: openSink({ directory: temporaryDirectory('rigger-settle-'), run: 'r-test', now: () => 0 }), items: fake.operations, reads });
  const [card] = await fake.operations.readItems();

  const facts = await l2.settled(card, exited(0));

  assert.deepEqual(made.sort(), [['readComments', 130], ['readDiff', 130], ['readEditedAt', 13], ['readMergeBase', 130], ['readPullRequests', 'rigger-13']]);
  assert.deepEqual(facts, {
    line: 'rigger-13',
    open: [{ number: 130, head: pullFrom(13, 130).sha, base: 'main' }],
    merged: [],
    pull: { status: 'fulfilled', value: { number: 130, base, head: pullFrom(13, 130).sha } },
    diff: { status: 'fulfilled', value: 'diff --git a/x b/x\n' },
    comments: { status: 'fulfilled', value: comments },
    editedAt: { status: 'fulfilled', value: '2026-10-02T08:00:00Z' },
  });
});
