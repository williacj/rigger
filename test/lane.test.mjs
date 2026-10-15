// ABOUTME: Tests L3's repo lane over the fake board and the fake forge's merge: the claim a merge takes
// with no slot, its pull event, `merge.start` and `merge.end`, L2's re-run before the merge call,
// merges made one at a time in pull order, and what each answer the merge call can give does to the card.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COLUMNS, KINDS, PASSING, boardOf, cardIn, columnsOf, handleOn, positive, readyCard, world,
} from './loop-world.mjs';
import { markerComment } from './fake-repository.mjs';
import { createFakeBoard } from './fake-board.mjs';
import config from '../rigger.config.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';

/** The kind every card here is, judged by the reviewer alone, so a sound reviewer marker at Review answers `merge`. */
const REVIEWED = { change: { ...KINDS.change, judges: ['reviewer'] } };

/** The head SHA of card `card`'s pull request. */
const shaOf = (card) => String(card).padStart(40, 'a');

/** The number of card `card`'s pull request. */
const pullOf = (card) => card * 10 + 1;

/**
 * Card `card`'s open pull request from its line of work, mergeable at its head, holding a sound
 * reviewer marker at that head and the card's acceptance, with each of `facts` as the fake holds it.
 */
const mergeablePull = (card, facts = {}) => ({
  number: pullOf(card), head: `rigger-${card}`, sha: shaOf(card), mergeable: 'mergeable',
  comments: [markerComment({ card, pull: pullOf(card), head: shaOf(card), body: PASSING })], ...facts,
});

/**
 * A world whose board holds `cards`, each a Review card with a mergeable pull request L2 answers
 * `merge`, beside `others`, the forge holding `facts` of each card's pull request and `rules`.
 */
const merging = (cards, { others = [], facts = {}, rules, ...options } = {}) => world({
  cards: [...cards.map((card) => cardIn(card, COLUMNS.review)), ...others], kinds: REVIEWED,
  forge: { pullRequests: cards.map((card) => mergeablePull(card, facts[card])), rules }, ...options,
});

/** The L3 events under `card`, by name, in the order recorded. */
const eventsOf = (built, card) => built.l3Events().filter((event) => event.card === card).map(({ event }) => event);

/** The cards of the L3 events named `name`, in the order recorded. */
const cardsOf = (built, name) => built.l3Events().filter(({ event }) => event === name).map(({ card }) => card);

/** Every failure `failure` holds, an AggregateError opened to the failures inside it, however deep. */
const leavesOf = (failure) => (failure instanceof AggregateError ? failure.errors.flatMap(leavesOf) : [failure]);

/** The triggers L3 recorded, by kind, in order. */
const triggersOf = (built) => built.l3Events().filter(({ event }) => event === 'trigger').map(({ trigger }) => trigger);

/** The `merge.end` events recorded, in order. */
const endsOf = (built) => built.l3Events().filter(({ event }) => event === 'merge.end');

/** A clock whose five-second pauses advance only when a test's fake forge is ready for them. */
function timed(onPause = () => {}) {
  let elapsed = 0;
  return {
    clock: { now: () => elapsed, pause: async (milliseconds) => {
      assert.equal(milliseconds, 5000);
      elapsed += milliseconds;
      await onPause(elapsed);
    } },
    elapsed: () => elapsed,
  };
}

// proves R-SCHED-26
test('an unknown mergeability read is served again after five injected seconds and then merges', async () => {
  const time = timed();
  const built = merging([110], { clock: time.clock });
  const read = built.repository.operations.readMergeable;
  let reads = 0;
  built.repository.operations.readMergeable = async (pull) => {
    reads += 1;
    return reads === 2 ? 'unknown' : read(pull);
  };

  await built.loop.pull();

  assert.deepEqual(built.repository.merges(), [{ number: 1101, head: shaOf(110) }]);
  assert.equal(endsOf(built)[0].outcome, 'merged');
  assert.equal(time.elapsed(), 5000);
  assert.equal(reads, 3);
});

// proves R-SCHED-26
test('an unknown merge-call refusal counts as a read and the lane merges after the next forge read', async () => {
  const time = timed();
  const built = merging([111], { clock: time.clock });
  built.repository.answerMerge(() => ({ outcome: 'refused', reason: 'unknown' }));

  await built.loop.pull();

  assert.deepEqual(built.repository.merges(), [
    { number: 1111, head: shaOf(111) },
    { number: 1111, head: shaOf(111) },
  ]);
  assert.equal(endsOf(built)[0].outcome, 'merged');
  assert.equal(time.elapsed(), 5000);
});

// proves R-SCHED-26, R-RECORD-10, R-RECORD-12
test('unknown on every lane read stops at 60 seconds and records the exact reason and wait measure', async () => {
  const time = timed();
  const built = merging([112], { clock: time.clock });
  const read = built.repository.operations.readMergeable;
  const times = [];
  built.repository.operations.readMergeable = async (pull) => {
    times.push(time.elapsed());
    return times.length === 1 ? read(pull) : 'unknown';
  };

  await built.loop.pull();

  assert.deepEqual(times.slice(1), Array.from({ length: 13 }, (_, index) => index * 5000));
  assert.deepEqual(built.repository.merges(), []);
  assert.equal((await columnsOf(built.fake))[112], COLUMNS.review);
  const [end] = endsOf(built);
  assert.equal(end.outcome, 'not merged');
  assert.equal(end.reason, "the forge reads pull request #1121's mergeability as unknown");
  assert.equal(end.reads, 13);
  assert.equal(end.elapsedMs, 60_000);
});

/** A lane whose first post-claim mergeability read is unknown, then follows `change` after 5 seconds. */
function unknownThen(card, change, answer) {
  let built;
  const time = timed(() => change?.(built));
  built = merging([card], { clock: time.clock });
  const read = built.repository.operations.readMergeable;
  let reads = 0;
  built.repository.operations.readMergeable = async (pull) => {
    reads += 1;
    if (reads === 2) return 'unknown';
    if (reads === 3 && answer !== undefined) return answer(pull);
    return read(pull);
  };
  return { built, elapsed: time.elapsed, reads: () => reads };
}

// proves R-SCHED-26
test('the lane reads a mergeable pull request once after its claim and makes its merge call', async () => {
  const built = merging([120]);
  const read = built.repository.operations.readMergeable;
  let reads = 0;
  built.repository.operations.readMergeable = async (pull) => { reads += 1; return read(pull); };

  await built.loop.pull();

  assert.equal(reads, 2, 'the pull and the lane each read mergeability once');
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [1201]);
});

// proves R-SCHED-26
test('unknown then mergeable on the next lane read merges at the pulled head', async () => {
  const { built, elapsed, reads } = unknownThen(121);

  await built.loop.pull();

  assert.equal(elapsed(), 5000);
  assert.equal(reads(), 3);
  assert.deepEqual(built.repository.merges(), [{ number: 1211, head: shaOf(121) }]);
});

/** Reads unknown through 55 seconds, then `last` at 60 seconds, and checks L3's response. */
async function lastKnown(card, last, outcome) {
  const time = timed();
  const built = merging([card], { clock: time.clock });
  const read = built.repository.operations.readMergeable;
  let calls = 0;
  const times = [];
  built.repository.operations.readMergeable = async (pull) => {
    calls += 1;
    if (calls === 1) return read(pull);
    times.push(time.elapsed());
    return time.elapsed() < 60000 ? 'unknown' : last;
  };

  await built.loop.pull();

  assert.deepEqual(times, Array.from({ length: 13 }, (_, index) => index * 5000));
  assert.equal(endsOf(built)[0].outcome, outcome);
  assert.equal(built.repository.merges().length, last === 'mergeable' ? 1 : 0);
}

// proves R-SCHED-26
test('unknown until the read at 60 seconds, then mergeable, merges at that last read', async () => {
  await lastKnown(131, 'mergeable', 'merged');
});

// proves R-SCHED-26
test('unknown until the read at 60 seconds, then conflicting, ends unmerged at that last read', async () => {
  await lastKnown(132, 'conflicting', 'not merged');
});

// proves R-SCHED-26, R-RECORD-10
test('unknown then conflicting ends without a merge and the next pull continues its maker', async () => {
  const { built } = unknownThen(122, (world) => world.repository.update(1221, { mergeable: 'conflicting' }));

  await built.loop.pull();

  assert.deepEqual(built.repository.merges(), []);
  assert.equal((await columnsOf(built.fake))[122], COLUMNS.review);
  assert.equal(endsOf(built)[0].outcome, 'not merged');
  assert.match(endsOf(built)[0].reason, /L2 answered continue/);
  const next = built.loop.pull();
  await positive(() => built.dispatches.holding().includes(122));
  built.dispatches.releaseAll();
  const [reached] = await next;
  assert.equal(reached.action, 'continue');
});

// proves R-SCHED-26, R-RECORD-10
test('unknown then a failed forge read ends unmerged with the read failure', async () => {
  const { built } = unknownThen(123, undefined, () => { throw new Error('mergeability read failed'); });

  await assert.rejects(built.loop.pull(), (failure) => leavesOf(failure).some(({ message }) => /card #123.*mergeability read failed/.test(message)));

  assert.deepEqual(built.repository.merges(), []);
  assert.equal((await columnsOf(built.fake))[123], COLUMNS.review);
  assert.equal(endsOf(built)[0].outcome, 'not merged');
  assert.match(endsOf(built)[0].reason, /mergeability read failed/);
});

// proves R-SCHED-26, R-RECORD-10
test('unknown then an L2 answer with no reason records the answer that stopped the merge', async () => {
  const { built } = unknownThen(124, (world) => world.repository.update(1241, { comments: [], mergeBase: 'b'.repeat(40), diff: 'diff --git a/help b/help\n' }));

  await built.loop.pull();

  assert.deepEqual(built.repository.merges(), []);
  assert.equal(endsOf(built)[0].outcome, 'not merged');
  assert.match(endsOf(built)[0].reason, /L2 answered judge/);
});

// proves R-SCHED-26, R-RECORD-10
test('unknown then another merge head records both the answer and the head originally pulled', async () => {
  const newer = 'f'.repeat(40);
  const { built } = unknownThen(125, (world) => world.repository.update(1251, {
    sha: newer, comments: [markerComment({ card: 125, pull: 1251, head: newer, body: PASSING })],
  }));

  await built.loop.pull();

  assert.deepEqual(built.repository.merges(), []);
  assert.equal(endsOf(built)[0].outcome, 'not merged');
  assert.match(endsOf(built)[0].reason, /#1251/);
  assert.match(endsOf(built)[0].reason, new RegExp(newer));
  assert.match(endsOf(built)[0].reason, new RegExp(shaOf(125)));
});

// proves R-SCHED-26
test('unknown then a person merges: the lane sends no merge and a later pull moves the card to Done', async () => {
  const { built } = unknownThen(126, (world) => world.repository.update(1261, { merged: true }));

  await built.loop.pull();

  assert.deepEqual(built.repository.merges(), []);
  assert.equal(endsOf(built)[0].outcome, 'not merged');
  await built.loop.pull();
  assert.equal((await columnsOf(built.fake))[126], COLUMNS.done);
});

// proves R-SCHED-26
test('unknown at the pull starts no merge and leaves the next invocation to read it', async () => {
  const built = merging([127], { facts: { 127: { mergeable: 'unknown' } } });

  await built.loop.pull();

  assert.deepEqual(built.repository.merges(), []);
  assert.deepEqual(endsOf(built), []);
  built.repository.update(1271, { mergeable: 'mergeable' });
  await built.loop.pull();
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [1271]);
});

// proves R-SCHED-26, R-RECORD-10
test('the final unknown read can be a merge-call refusal, which ends refused at 60 seconds', async () => {
  const time = timed();
  const built = merging([128], { clock: time.clock });
  for (let call = 0; call < 13; call += 1) built.repository.answerMerge(() => ({ outcome: 'refused', reason: 'unknown' }));

  await built.loop.pull();

  const [end] = endsOf(built);
  assert.equal(time.elapsed(), 60000);
  assert.equal(end.outcome, 'refused');
  assert.equal(end.reason, 'unknown');
  assert.equal(end.elapsedMs, 60000);
  assert.equal(built.repository.merges().length, 13);
  assert.equal((await columnsOf(built.fake))[128], COLUMNS.review);
});

// proves R-SCHED-26
test('two merge claims in one invocation both merge after the second waits for its known read', async () => {
  const time = timed();
  const built = merging([129, 130], { clock: time.clock });
  const read = built.repository.operations.readMergeable;
  let firstMergedAt;
  const secondReads = [];
  built.repository.answerMerge(async ({ merge }) => {
    const answer = await merge();
    firstMergedAt = time.elapsed();
    return answer;
  });
  built.repository.operations.readMergeable = async (pull) => {
    if (pull === 1301 && firstMergedAt !== undefined) {
      secondReads.push(time.elapsed());
      if (time.elapsed() - firstMergedAt < 2000) return 'unknown';
    }
    return read(pull);
  };

  await built.loop.pull();

  assert.equal(time.elapsed(), 5000);
  assert.equal(firstMergedAt, 0);
  assert.deepEqual(secondReads, [0, 5000]);
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [1291, 1301]);
  assert.deepEqual(endsOf(built).map(({ outcome }) => outcome), ['merged', 'merged']);
});

test('a merge claim records its pull after the claim and before merge.start, holding no slot, and the forge\'s merge moves the card to Done', async () => {
  const built = merging([83]);

  const reached = await built.loop.pull();

  assert.deepEqual(eventsOf(built, 83), ['pull', 'merge.start', 'merge.end']);
  const [pull] = built.l3Events().filter(({ event }) => event === 'pull');
  assert.equal(pull.inFlight, 0);
  assert.equal(pull.queueDepth, 0);
  assert.deepEqual(built.repository.merges(), [{ number: 831, head: shaOf(83) }]);
  assert.deepEqual(await columnsOf(built.fake), { 83: COLUMNS.done });
  assert.deepEqual(endsOf(built).map(({ outcome, pull: number, head }) => ({ outcome, number, head })), [{ outcome: 'merged', number: 831, head: shaOf(83) }]);
  assert.deepEqual(reached.map(({ card, action }) => ({ card, action })), [{ card: 83, action: 'merge' }]);
});

// proves R-WORK-30
test('a lane merge records removal after merge.end and before the transition to Done', async () => {
  let built;
  built = merging([83], { removeDirectories: async (card) => {
    built.sink.emitter({ layer: 'L1', card }).emit('workspace.removed', { path: '/card-83' });
  } });

  await built.loop.pull();

  const events = built.events();
  const end = events.findIndex(({ layer, event, card }) => layer === 'L3' && event === 'merge.end' && card === 83);
  assert.deepEqual(events.filter(({ layer, card }) => layer === 'L3' && card === 83).map(({ event }) => event), ['pull', 'merge.start', 'merge.end']);
  const removal = events.findIndex(({ layer, event, card }) => layer === 'L1' && event === 'workspace.removed' && card === 83);
  const done = events.findIndex(({ layer, event, card, to }) => layer === 'L2' && event === 'transition' && card === 83 && to === 'done');
  assert.ok(end >= 0 && end < removal && removal < done, JSON.stringify(events));
});

// proves R-WORK-30
test('an already-merged answer removes directories before Done without another merge call', async () => {
  const removed = [];
  const built = merging([84], { removeDirectories: async (card) => { removed.push(card); } });
  built.repository.answerMerge(({ repository }) => {
    built.repository.update(841, { merged: true });
    return { outcome: 'already merged' };
  });

  await built.loop.pull();

  assert.deepEqual(removed, [84]);
  assert.deepEqual(await columnsOf(built.fake), { 84: COLUMNS.done });
  assert.equal(built.repository.merges().length, 1);
});

// proves R-WORK-30
test('a refused lane merge leaves directories until a later pull reads the merge', async () => {
  const removed = [];
  const built = merging([85], { removeDirectories: async (card) => { removed.push(card); } });
  built.repository.answerMerge(() => ({ outcome: 'refused', reason: 'closed' }));

  await built.loop.pull();
  assert.deepEqual(removed, []);
  assert.deepEqual(await columnsOf(built.fake), { 85: COLUMNS.review });
  built.repository.update(851, { merged: true });
  await built.loop.pull();
  assert.deepEqual(removed, [85]);
  assert.deepEqual(await columnsOf(built.fake), { 85: COLUMNS.done });
});

// proves R-WORK-30
test('a failed lane merge removes nothing until a later pull reads it as merged', async () => {
  const removed = [];
  const built = merging([86], { removeDirectories: async (card) => { removed.push(card); } });
  built.repository.answerMerge(() => { throw new Error('merge failed'); });

  await assert.rejects(built.loop.pull(), (failure) => leavesOf(failure).some(({ message }) => /merge failed/.test(message)));
  assert.deepEqual(removed, []);
  assert.deepEqual(await columnsOf(built.fake), { 86: COLUMNS.review });
  built.repository.update(861, { merged: true });
  await built.loop.pull();
  assert.deepEqual(removed, [86]);
  assert.deepEqual(await columnsOf(built.fake), { 86: COLUMNS.done });
});

// proves R-WORK-30
test('an unrecorded merge end removes nothing until a later pull reads the merge', async () => {
  const removed = [];
  const built = merging([87], { removeDirectories: async (card) => { removed.push(card); } });
  built.repository.answerMerge(() => {
    built.refuseAppends('the record is full', 1);
    return { outcome: 'merged' };
  });

  await assert.rejects(built.loop.pull(), (failure) => leavesOf(failure).some(({ message }) => /refused to record its end/.test(message)));
  assert.deepEqual(removed, []);
  assert.deepEqual(await columnsOf(built.fake), { 87: COLUMNS.review });
  await built.loop.pull();
  assert.deepEqual(removed, [87]);
  assert.deepEqual(await columnsOf(built.fake), { 87: COLUMNS.done });
});

// proves R-WORK-30
test('a removal failure after one directory was removed leaves Review until a later pull removes the rest', async () => {
  let built;
  let calls = 0;
  built = merging([88], { removeDirectories: async (card) => {
    calls += 1;
    built.sink.emitter({ layer: 'L1', card }).emit('workspace.removed', { path: calls === 1 ? '/first' : '/remaining' });
    if (calls === 1) throw new Error('the second directory could not be removed');
  } });

  await assert.rejects(built.loop.pull(), (failure) => leavesOf(failure).some(({ message }) => /second directory/.test(message)));
  assert.deepEqual(await columnsOf(built.fake), { 88: COLUMNS.review });
  await built.loop.pull();

  assert.equal(calls, 2);
  assert.deepEqual(await columnsOf(built.fake), { 88: COLUMNS.done });
  const events = built.events();
  assert.deepEqual(events.filter(({ layer, event }) => layer === 'L1' && event === 'workspace.removed').map(({ path }) => path), ['/first', '/remaining']);
  const done = events.findIndex(({ layer, event, to }) => layer === 'L2' && event === 'transition' && to === 'done');
  assert.ok(events.findIndex(({ event, path }) => event === 'workspace.removed' && path === '/remaining') < done);
});

// proves R-WORK-30
test('a later pull removes directories after the first run ended between merge and removal', async () => {
  let calls = 0;
  const built = merging([89], { removeDirectories: async () => {
    calls += 1;
    if (calls === 1) throw new Error('the run ended before removal');
  } });

  await assert.rejects(built.loop.pull(), (failure) => leavesOf(failure).some(({ message }) => /run ended/.test(message)));
  assert.deepEqual(await columnsOf(built.fake), { 89: COLUMNS.review });
  await built.loop.pull();

  assert.equal(calls, 2);
  assert.deepEqual(await columnsOf(built.fake), { 89: COLUMNS.done });
});

// proves R-WORK-30
test('a lane merge not made after its card cannot be reread removes nothing until a later pull reads a merge', async () => {
  const fake = boardOf([cardIn(90, COLUMNS.review)]);
  const board = { ...handleOn(fake), readItems: async () => [] };
  const removed = [];
  const built = merging([90], { fake, board, removeDirectories: async (card) => { removed.push(card); } });

  await assert.rejects(built.loop.pull());
  assert.deepEqual(removed, []);
  assert.deepEqual(await columnsOf(fake), { 90: COLUMNS.review });
  built.repository.update(901, { merged: true });
  await built.loop.pull();

  assert.deepEqual(removed, [90]);
  assert.deepEqual(await columnsOf(fake), { 90: COLUMNS.done });
});

/** A merge script that holds the call until the function it hands `held` is called, then merges as the forge does. */
const holding = (held) => ({ merge }) => new Promise((resolve) => { held.push(() => resolve(merge())); });

/** Each merge's `merge.start` to `merge.end` interval in the stream, by card, as the event indexes. */
const intervalsOf = (built) => {
  const events = built.l3Events();
  return [...new Set(events.filter(({ event }) => event === 'merge.start').map(({ card }) => card))].map((card) => ({
    card,
    start: events.findIndex((event) => event.event === 'merge.start' && event.card === card),
    end: events.findIndex((event) => event.event === 'merge.end' && event.card === card),
  }));
};

// proves R-SCHED-15
test('given two cards answered merge at once, the stream\'s merge.start-to-merge.end intervals do not overlap, and the second merge call waits for the first to end', async () => {
  const built = merging([84, 85]);
  const held = [];
  built.repository.answerMerge(holding(held));

  const pulled = built.loop.pull();
  await positive(() => held.length === 1);
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [841]);
  assert.deepEqual(built.l3Events().filter(({ event }) => event === 'merge.start').map(({ card }) => card), [84]);
  held[0]();
  await pulled;

  assert.deepEqual(built.repository.merges().map(({ number }) => number), [841, 851]);
  const [first, second] = intervalsOf(built);
  assert.ok(first.end !== -1 && first.end < second.start, JSON.stringify(intervalsOf(built)));
  assert.deepEqual(await columnsOf(built.fake), { 84: COLUMNS.done, 85: COLUMNS.done });
});

test('given two cards answered merge in one pull, the lane merges them in the order L3 pulled them, not the board\'s', async () => {
  const fake = createFakeBoard({
    columns: Object.values(COLUMNS), fields: [{ name: 'Priority', options: ['P1', 'P2'] }],
    items: [cardIn(87, COLUMNS.review, { Priority: 'P2' }), cardIn(86, COLUMNS.review, { Priority: 'P1' }), cardIn(88, COLUMNS.review, { Priority: 'P1' })],
  });
  const built = merging([87, 86, 88], { fake, priority: { field: 'Priority', options: ['P1', 'P2'] } });

  await built.loop.pull();

  assert.deepEqual(built.l3Events().filter(({ event }) => event === 'pull').map(({ card }) => card), [86, 88, 87]);
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [861, 881, 871]);
  assert.deepEqual(intervalsOf(built).map(({ card }) => card), [86, 88, 87]);
});

/** L0's handle on `fake`, whose first priority read answers card `only` alone, and every later one the whole board. */
const firstSeesOnly = (fake, only) => {
  let reads = 0;
  const underlying = handleOn(fake);
  return {
    readColumns: underlying.readColumns,
    readPriority: async () => {
      reads += 1;
      const answer = await underlying.readPriority();
      return reads === 1 ? { ...answer, items: answer.items.filter(({ number }) => number === only) } : answer;
    },
  };
};

test('given a second card answered merge by a later pull while a merge runs, it is claimed and its merge call waits for the first merge to end', async () => {
  const fake = boardOf([cardIn(89, COLUMNS.review), cardIn(90, COLUMNS.review)]);
  const built = merging([89, 90], { fake, board: firstSeesOnly(fake, 89) });
  const held = [];
  built.repository.answerMerge(holding(held));

  const first = built.loop.pull();
  await positive(() => held.length === 1);
  const second = built.loop.pull();
  await positive(() => built.l3Events().some(({ event, card }) => event === 'pull' && card === 90));
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [891]);
  assert.deepEqual(built.l3Events().filter(({ event }) => event === 'merge.start').map(({ card }) => card), [89]);
  held[0]();
  await Promise.all([first, second]);

  assert.deepEqual(built.repository.merges().map(({ number }) => number), [891, 901]);
  const [one, two] = intervalsOf(built);
  assert.ok(one.end < two.start, JSON.stringify(intervalsOf(built)));
  assert.deepEqual(await columnsOf(built.fake), { 89: COLUMNS.done, 90: COLUMNS.done });
});

test('given one card answered merge on two pulls while its first merge waits, the forge receives one merge call', async () => {
  const built = merging([91]);
  const held = [];
  built.repository.answerMerge(holding(held));

  const first = built.loop.pull();
  await positive(() => held.length === 1);
  assert.deepEqual(await built.loop.pull(), []);
  held[0]();
  await first;

  assert.deepEqual(built.repository.merges().map(({ number }) => number), [911]);
  assert.equal(built.l3Events().filter(({ event }) => event === 'pull').length, 1);
  assert.deepEqual(await columnsOf(built.fake), { 91: COLUMNS.done });
});

test('a card in the lane holds its claim and no slot: with N 1, a Ready maker is dispatched while a merge waits, and the waiting card is not pulled again', async () => {
  // The maker exits non-zero and opens nothing, so its card asks for no judge once it ends.
  const built = merging([92], { others: [readyCard(96)], concurrency: 1, fresh: false, answer: () => ({ exit: 1, output: '' }) });
  const held = [];
  built.repository.answerMerge(holding(held));

  const first = built.loop.pull();
  await positive(() => held.length === 1 && built.dispatches.holding().includes(96));
  assert.deepEqual(built.dispatches.started, [96]);
  const again = await built.loop.pull();
  assert.deepEqual(again, []);
  assert.deepEqual(built.l3Events().filter(({ event }) => event === 'pull').map(({ card, inFlight }) => ({ card, inFlight })), [{ card: 92, inFlight: 0 }, { card: 96, inFlight: 1 }]);
  held[0]();
  built.dispatches.releaseAll();
  await first;

  assert.deepEqual(built.repository.merges().map(({ number }) => number), [921]);
  assert.deepEqual(cardsOf(built, 'slot.release'), [96]);
});


/** The check every pull request in `changedWhileWaiting` requires, and its state there at the pull. */
const CI = [{ context: 'ci', integration_id: null }];
const PASSED = { ci: { state: 'passed', creator: null } };

/**
 * A world holding Review cards 93 and 94, each answered `merge` at the pull, whose pull requests'
 * base branch requires the check `ci`, passed at each head. Card 93's merge is held while `change`
 * changes what the forge holds of card 94, which waits behind it in the lane; then it is released,
 * and the pull settles. `board`, handed the fake board, is L0's handle, for a change only the
 * board's own read shows.
 */
async function changedWhileWaiting(change, { board } = {}) {
  const fake = boardOf([cardIn(93, COLUMNS.review), cardIn(94, COLUMNS.review)]);
  const facts = { checks: PASSED, mergeBase: '7'.repeat(40) };
  const built = merging([93, 94], { fake, rules: CI, facts: { 93: facts, 94: facts }, clock: { now: () => 0, pause: async () => { throw new Error('the lane did not read unknown'); } }, ...(board === undefined ? {} : { board: board(fake) }) });
  const held = [];
  built.repository.answerMerge(holding(held));
  const pulled = built.loop.pull();
  await positive(() => held.length === 1);
  change(built.repository);
  held[0]();
  await pulled;
  return built;
}

/** A Review card 94's marker at its pull request's head and the card's acceptance, ruled as `ruling` says. */
const markerFor94 = (ruling) => markerComment({ card: 94, pull: 941, head: shaOf(94), body: PASSING, ...ruling });

/** The cards whose acceptance the board's item read shows revised, for `revisedOnRead`. */
const revised = new Set();

/**
 * L0's handle on `fake`, as `handleOn` makes it, beside a board item read that shows each card in
 * `revised` with one more acceptance item, so its acceptance digest is not the one pulled.
 */
const revisedOnRead = (fake) => ({
  ...handleOn(fake),
  readItems: async () => (await fake.operations.readItems()).map((item) => (revised.has(item.number) ? { ...item, body: `${item.body}- The verb prints its version.\n` } : item)),
});

for (const { row, change, action, board } of [
  { row: 'a needs-revision marker appears', change: (repository) => repository.update(941, { comments: [markerFor94({ verdict: 'needs revision', items: ['unmet'], toSound: 'Print the help.' })] }), action: 'continue' },
  { row: 'a required check fails', change: (repository) => repository.update(941, { checks: { ci: { state: 'failed', creator: null } } }), action: 'ignore' },
  { row: 'a person merges the pull request', change: (repository) => repository.update(941, { merged: true }), action: 'move' },
  { row: 'mergeability turns conflicting', change: (repository) => repository.update(941, { mergeable: 'conflicting' }), action: 'continue' },
  { row: 'the head moves', change: (repository) => repository.update(941, { sha: 'f'.repeat(40) }), action: 'judge' },
  { row: 'the card\'s acceptance, and so its digest, changes', change: () => { revised.add(94); }, board: revisedOnRead, action: 'judge' },
]) {
  test(`when the lane reaches a card after ${row} while it waited, L2's re-run answers ${action}, the fake forge receives no merge call for it, the lane moves nothing, and merge.end names not merged`, async () => {
    revised.clear();
    const built = await changedWhileWaiting(change, { board });

    assert.deepEqual(built.repository.merges().map(({ number }) => number), [931]);
    assert.deepEqual(await columnsOf(built.fake), { 93: COLUMNS.done, 94: COLUMNS.review });
    const end = endsOf(built).find(({ card }) => card === 94);
    assert.deepEqual({ outcome: end.outcome, action: end.action }, { outcome: 'not merged', action });
    assert.ok(end.reason.length > 0);
    if (row === 'a required check fails') assert.match(end.reason, /failed|failing/);
    assert.deepEqual(eventsOf(built, 94), ['pull', 'merge.start', 'merge.end']);
  });
}

// proves R-SCHED-26, R-RECORD-10
test('the first lane read finds conflict and records the answer that stops the merge', async () => {
  const built = await changedWhileWaiting((repository) => repository.update(941, { mergeable: 'conflicting' }));
  const end = endsOf(built).find(({ card }) => card === 94);
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [931]);
  assert.equal(end.outcome, 'not merged');
  assert.match(end.reason, /L2 answered continue/);
});

// proves R-SCHED-26, R-RECORD-10
test('a person merging while the lane waits ends without a Rigger merge call', async () => {
  const built = await changedWhileWaiting((repository) => repository.update(941, { merged: true }));
  const end = endsOf(built).find(({ card }) => card === 94);
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [931]);
  assert.equal(end.outcome, 'not merged');
  assert.match(end.reason, /L2 answered move/);
  assert.match(end.reason, /to done/);
});

// proves R-RECORD-10
test('an L2 ignore answer carrying a failed-check reason records that reason with the answer', async () => {
  const built = await changedWhileWaiting((repository) => repository.update(941, { checks: { ci: { state: 'failed', creator: null } } }));
  const end = endsOf(built).find(({ card }) => card === 94);
  assert.equal(end.action, 'ignore');
  assert.match(end.reason, /failed|failing/);
});

/**
 * Pulls Review card 101, answered `merge`, whose merge call answers as `script` does, handed the
 * fake repository too so a script can change what the forge reads. Answers the world and how the
 * pull settled, as `Promise.allSettled` records it.
 */
async function mergedAs(script) {
  let elapsed = 0;
  let built;
  built = merging([101], { clock: {
    now: () => elapsed,
    pause: async (milliseconds) => {
      elapsed += milliseconds;
      built.repository.update(1011, { mergeable: 'mergeable' });
      built.repository.answerMerge(() => ({ outcome: 'refused', reason: 'unknown' }));
    },
  } });
  built.repository.answerMerge((call) => script({ ...call, repository: built.repository }));
  const [pulled] = await Promise.allSettled([built.loop.pull()]);
  return { built, pulled };
}

/** The one `merge.end` recorded, less the fields the sink stamps. */
const endOf = (built) => {
  const [{ outcome, reason, context, action }] = endsOf(built);
  return Object.fromEntries(Object.entries({ outcome, reason, context, action }).filter(([, value]) => value !== undefined));
};

// proves R-CONFLICT-1
test('given a merge refused while the mergeable-state read answers conflicting, the card moves to Coding and the transition names the conflict', async () => {
  const { built, pulled } = await mergedAs(({ repository }) => {
    repository.update(1011, { mergeable: 'conflicting' });
    return { outcome: 'refused', reason: 'conflict' };
  });

  assert.equal(pulled.status, 'fulfilled', pulled.reason?.message);
  assert.deepEqual(await columnsOf(built.fake), { 101: COLUMNS.coding });
  assert.deepEqual(endOf(built), { outcome: 'refused', reason: 'conflict' });
  assert.deepEqual(built.events().filter(({ event }) => event === 'transition').map(({ from, to, cause }) => ({ from, to, cause })), [{ from: 'review', to: 'coding', cause: 'conflicted' }]);

  // The next pull dispatches its maker on the pull request at its head, a continuing attempt.
  const next = built.loop.pull();
  await positive(() => built.dispatches.holding().includes(101));
  built.dispatches.releaseAll();
  const [reached] = await next;
  assert.deepEqual({ card: reached.card, action: reached.action, pull: reached.pull, head: reached.head }, { card: 101, action: 'continue', pull: 1011, head: shaOf(101) });
  const maker = built.decisions.find(({ card, action }) => card === 101 && action.maker !== undefined)?.action.maker;
  assert.match(maker.instruction, /continuing attempt on its open pull request #1011, at head `a+101`/);
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [1011]);
});

/** A merge script answering the refusal `refusal`, as M5-04's `mergePullRequest` maps one, the forge reading the pull request's mergeability as `mergeable`. */
const refusing = (refusal, mergeable = 'mergeable') => ({ repository }) => {
  repository.update(1011, { mergeable });
  return { outcome: 'refused', ...refusal };
};

for (const { row, script, end } of [
  { row: 'no record of a check the base requires (#701), as M5-04 maps it', script: refusing({ reason: 'no record', context: 'rigger/gate' }), end: { outcome: 'refused', reason: 'no record', context: 'rigger/gate' } },
  { row: 'reason conflict while the mergeable-state read answers mergeable', script: refusing({ reason: 'conflict' }, 'mergeable'), end: { outcome: 'refused', reason: 'conflict' } },
  { row: 'reason conflict while the mergeable-state read answers unknown', script: refusing({ reason: 'conflict' }, 'unknown'), end: { outcome: 'refused', reason: 'conflict' } },
  { row: 'the forge not having computed mergeability', script: refusing({ reason: 'unknown' }, 'unknown'), end: { outcome: 'refused', reason: 'unknown' } },
  { row: 'the branch behind its base under a strict rule', script: refusing({ reason: 'behind' }), end: { outcome: 'refused', reason: 'behind' } },
  { row: 'the head moved', script: refusing({ reason: 'head moved' }), end: { outcome: 'refused', reason: 'head moved' } },
  { row: 'a required check failing', script: refusing({ reason: 'failing', context: 'ci' }), end: { outcome: 'refused', reason: 'failing', context: 'ci' } },
  { row: 'a required check pending', script: refusing({ reason: 'pending', context: 'ci' }), end: { outcome: 'refused', reason: 'pending', context: 'ci' } },
  { row: 'the merge method', script: refusing({ reason: 'method' }), end: { outcome: 'refused', reason: 'method' } },
  { row: 'the pull request closed', script: refusing({ reason: 'closed' }), end: { outcome: 'refused', reason: 'closed' } },
]) {
  test(`given the forge refuses the merge for ${row}, the card stays in its column and merge.end names the refusal`, async () => {
    const { built, pulled } = await mergedAs(script);

    assert.equal(pulled.status, 'fulfilled', pulled.reason?.message);
    assert.deepEqual(await columnsOf(built.fake), { 101: COLUMNS.review });
    assert.deepEqual(endOf(built), end);
    assert.deepEqual(built.events().filter(({ event }) => event === 'transition'), []);
    assert.equal(built.repository.merges().length, row === 'the forge not having computed mergeability' ? 13 : 1);
  });
}

// proves R-RECORD-10
test('a refused merge records the refusal and its named check context', async () => {
  const { built } = await mergedAs(refusing({ reason: 'no record', context: 'rigger/gate' }));
  assert.deepEqual(endOf(built), { outcome: 'refused', reason: 'no record', context: 'rigger/gate' });
});

// proves R-RECORD-10
test('given the fake forge\'s merge throws, as M5-04 answers a message no mapping names, the card stays in its column, merge.end names failed, and the pull\'s failure names the card', async () => {
  const { built, pulled } = await mergedAs(() => {
    throw new Error('mergePullRequest #1011 failed: HTTP 422 an answer nothing maps');
  });

  assert.equal(pulled.status, 'rejected');
  assert.ok(leavesOf(pulled.reason).some(({ message }) => /card #101/.test(message) && /HTTP 422/.test(message)), pulled.reason.message);
  assert.deepEqual(await columnsOf(built.fake), { 101: COLUMNS.review });
  assert.deepEqual(endOf(built).outcome, 'failed');
  assert.match(endOf(built).reason, /HTTP 422/);
});

// proves R-RECORD-10
test('given the forge answers already merged, the card moves to Done and no second merge call is made', async () => {
  const { built, pulled } = await mergedAs(({ repository }) => {
    repository.update(1011, { merged: true });
    return { outcome: 'already merged', sha: 'e'.repeat(40) };
  });

  assert.equal(pulled.status, 'fulfilled', pulled.reason?.message);
  assert.deepEqual(endOf(built), { outcome: 'already merged', reason: 'the forge held the pull request as merged already' });
  assert.deepEqual(await columnsOf(built.fake), { 101: COLUMNS.done });
  assert.deepEqual(await built.loop.pull(), []);
  assert.equal(built.repository.merges().length, 1);
});

/** Has the sink L3 writes through refuse the next append of L3's event `name`, with an error naming it, and accept every other. */
function refuseNext(built, name) {
  const emitter = built.sink.emitter;
  let refusing = true;
  built.sink.emitter = (context) => {
    const inner = emitter(context);
    return {
      emit: (event, fields) => {
        if (refusing && context.layer === 'L3' && event === name) {
          refusing = false;
          throw new Error(`the event sink refuses ${name}`);
        }
        return inner.emit(event, fields);
      },
    };
  };
}

test('given the sink refuses merge.start, the forge receives no merge call, the card stays in its column, and the failure names the card', async () => {
  const built = merging([102]);
  refuseNext(built, 'merge.start');

  const [pulled] = await Promise.allSettled([built.loop.pull()]);

  assert.equal(pulled.status, 'rejected');
  assert.ok(leavesOf(pulled.reason).some(({ message }) => /card #102/.test(message) && /refuses merge\.start/.test(message)), pulled.reason.message);
  assert.deepEqual(built.repository.merges(), []);
  assert.deepEqual(await columnsOf(built.fake), { 102: COLUMNS.review });
  assert.deepEqual(eventsOf(built, 102), ['pull']);
});

test('given the sink refuses merge.end after the forge merged, L3 halts with a failure naming the card, and the next pull moves the card to Done and sends no merge', async () => {
  const built = merging([103]);
  refuseNext(built, 'merge.end');

  const [pulled] = await Promise.allSettled([built.loop.pull()]);

  assert.equal(pulled.status, 'rejected');
  assert.ok(leavesOf(pulled.reason).some(({ message }) => /card #103/.test(message) && /refuses merge\.end/.test(message)), pulled.reason.message);
  assert.deepEqual(await columnsOf(built.fake), { 103: COLUMNS.review });
  await built.loop.pull();
  assert.deepEqual(await columnsOf(built.fake), { 103: COLUMNS.done });
  assert.equal(built.repository.merges().length, 1);
});

for (const { row, script } of [
  { row: 'fails', script: () => { throw new Error('mergePullRequest #1041 failed: the request could not be sent'); } },
  { row: 'times out', script: () => { throw new Error('mergePullRequest #1041 failed: gh ran past its time'); } },
]) {
  test(`given the merge call ${row} with the forge not having merged, the card stays and the next pull answers merge again`, async () => {
    const built = merging([104]);
    built.repository.answerMerge(script);

    await built.loop.pull().catch(() => {});
    assert.deepEqual(await columnsOf(built.fake), { 104: COLUMNS.review });
    await built.loop.pull();

    assert.deepEqual(built.decisions.filter(({ card }) => card === 104).map(({ action }) => action.action), ['merge', 'merge', 'merge', 'merge']);
    assert.deepEqual(built.repository.merges().map(({ number }) => number), [1041, 1041]);
    assert.deepEqual(await columnsOf(built.fake), { 104: COLUMNS.done });
  });
}

test('given the merge call times out after the forge merged, the next pull moves the card to Done and sends no merge', async () => {
  const built = merging([105]);
  built.repository.answerMerge(async ({ merge }) => {
    await merge();
    throw new Error('mergePullRequest #1051 failed: gh ran past its time');
  });

  await built.loop.pull().catch(() => {});
  assert.deepEqual(endOf(built).outcome, 'failed');
  assert.deepEqual(await columnsOf(built.fake), { 105: COLUMNS.review });
  await built.loop.pull();

  assert.deepEqual(await columnsOf(built.fake), { 105: COLUMNS.done });
  assert.equal(built.repository.merges().length, 1);
});

for (const { row, stop, first: firstMerges, merges } of [
  {
    // L2's merge call is entered and holds before it reaches the repository-write side.
    row: 'before the forge call',
    stop: (built, reached) => { built.l2.merge = () => { reached(); return new Promise(() => {}); }; },
    first: [], merges: [1061],
  },
  {
    // The forge merges, and the call then holds before L2 is answered.
    row: 'after the forge merged, before the Done move',
    stop: (built, reached) => built.repository.answerMerge(async ({ merge }) => { await merge(); reached(); return new Promise(() => {}); }),
    first: [1061], merges: [],
  },
]) {
  test(`given the engine killed ${row}, the next engine's pull ${merges.length > 0 ? 'merges the card once' : 'moves the card to Done and sends no merge'}`, async () => {
    const fake = boardOf([cardIn(106, COLUMNS.review)]);
    const first = merging([106], { fake });
    let stopped = false;
    stop(first, () => { stopped = true; });
    first.loop.pull();
    await positive(() => stopped);
    assert.deepEqual(first.repository.merges().map(({ number }) => number), firstMerges);
    assert.deepEqual(await columnsOf(fake), { 106: COLUMNS.review });

    // A second engine, over the board and the forge as the first left them.
    const second = world({ fake, kinds: REVIEWED, forge: first.repository.held() });
    await second.loop.pull();

    assert.deepEqual(second.repository.merges().map(({ number }) => number), merges);
    assert.deepEqual(await columnsOf(fake), { 106: COLUMNS.done });
  });
}

test('given a required check pending at the merge, a run ends with the card where it was and merged once, though a freed slot fired another pull, and the next invocation merges it again', async () => {
  // Card 97's maker never starts, so L2 stops it after its second attempt and its slot fires the run's second pull.
  const built = merging([107], { others: [readyCard(97)], concurrency: 1, answer: () => new Error('the maker cannot start') });
  built.repository.answerMerge(refusing({ reason: 'pending', context: 'ci' }));

  await built.loop.run().catch(() => {});

  assert.equal(triggersOf(built).filter((trigger) => trigger === 'pull').length, 2, 'the stopped card\'s freed slot fired a second pull');
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [1071]);
  assert.equal((await columnsOf(built.fake))[107], COLUMNS.review);
  await built.loop.run().catch(() => {});
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [1071, 1071]);
  assert.equal((await columnsOf(built.fake))[107], COLUMNS.done);
});

// proves R-RECORD-10
test('given the lane cannot read the card again, the forge receives no merge call, merge.end names not merged with why, and the failure names the card', async () => {
  const fake = boardOf([cardIn(108, COLUMNS.review)]);
  const built = merging([108], { fake, board: (() => ({ ...handleOn(fake), readItems: async () => { throw new Error('the board read timed out'); } }))() });

  const [pulled] = await Promise.allSettled([built.loop.pull()]);

  assert.equal(pulled.status, 'rejected');
  assert.ok(leavesOf(pulled.reason).some(({ message }) => /card #108/.test(message) && /board read timed out/.test(message)), pulled.reason.message);
  assert.deepEqual(built.repository.merges(), []);
  assert.deepEqual(endOf(built), { outcome: 'not merged', reason: 'the board read timed out' });
  assert.deepEqual(await columnsOf(fake), { 108: COLUMNS.review });
});

test('given the board refuses the Done move after the forge merged, merge.end names merged, the failure names the card, and the next pull moves it to Done with no second merge', async () => {
  const fake = boardOf([cardIn(109, COLUMNS.review)]);
  let refuse = true;
  const items = {
    ...fake.operations,
    moveItem: async (id, column) => {
      if (refuse) {
        refuse = false;
        throw new Error('the board refused the move');
      }
      return fake.operations.moveItem(id, column);
    },
  };
  const built = merging([109], { fake, items });

  const [pulled] = await Promise.allSettled([built.loop.pull()]);

  assert.equal(pulled.status, 'rejected');
  assert.ok(leavesOf(pulled.reason).some(({ message }) => /card #109/.test(message) && /board refused the move/.test(message)), pulled.reason.message);
  assert.ok(pulled.reason.reached.some(({ card, merge }) => card === 109 && merge.outcome === 'merged'), JSON.stringify(pulled.reason.reached));
  assert.deepEqual(endOf(built), { outcome: 'merged' });
  await built.loop.pull();
  assert.deepEqual(await columnsOf(fake), { 109: COLUMNS.done });
  assert.equal(built.repository.merges().length, 1);
});

test('a merge claim\'s pull counts in queueDepth the pullable cards the pull left unclaimed, whatever L2 answered them, and in inFlight only the slots held', async () => {
  // The Ready makers never start, so no slot is held past the pull.
  const built = merging([110], { others: [readyCard(98), readyCard(99)], concurrency: 1, answer: () => new Error('the maker cannot start') });

  await built.loop.pull().catch(() => {});

  const pulls = built.l3Events().filter(({ event }) => event === 'pull').map(({ card, queueDepth, inFlight }) => ({ card, queueDepth, inFlight }));
  assert.deepEqual(pulls, [{ card: 110, queueDepth: 2, inFlight: 0 }, { card: 98, queueDepth: 1, inFlight: 1 }]);
  assert.deepEqual(cardsOf(built, 'slot.release'), [98]);
});

test('given an Owner card\'s merge refused while the mergeable-state read answers conflicting, it moves from owner to Coding, the transition naming the conflict', async () => {
  const head = shaOf(111);
  const built = world({
    cards: [cardIn(111, COLUMNS.owner)],
    forge: { pullRequests: [{ number: 1111, head: 'rigger-111', sha: head, mergeable: 'mergeable', comments: [markerComment({ card: 111, pull: 1111, head, body: PASSING, role: 'owner' })] }] },
  });
  built.repository.answerMerge(({ number }) => {
    built.repository.update(number, { mergeable: 'conflicting' });
    return { outcome: 'refused', reason: 'conflict' };
  });

  await built.loop.pull();

  assert.deepEqual(await columnsOf(built.fake), { 111: COLUMNS.coding });
  assert.deepEqual(built.events().filter(({ event }) => event === 'transition').map(({ from, to, cause }) => ({ from, to, cause })), [{ from: 'owner', to: 'coding', cause: 'conflictedFromOwner' }]);
});

test('a pull request changing a Self-hosting path and an authored What-binds document merges where L2 answers merge: the lane checks no path itself', async () => {
  const diff = 'diff --git a/.githooks/pre-merge-commit b/.githooks/pre-merge-commit\ndiff --git a/AGENTS.md b/AGENTS.md\n';
  const built = merging([112], { facts: { 112: { diff } } });

  await built.loop.pull();

  assert.deepEqual(built.repository.merges().map(({ number }) => number), [1121]);
  assert.deepEqual(await columnsOf(built.fake), { 112: COLUMNS.done });
});

test('a pull limited to one card claims one card in all, merge or maker: a merge first in pull order is merged and no Ready maker is dispatched beside it', async () => {
  // A maker that never starts, so a pull that wrongly dispatched one still settles.
  const built = merging([113, 114], { others: [readyCard(99)], concurrency: 3, answer: () => new Error('the maker cannot start') });

  const [pulled] = await Promise.allSettled([built.loop.pull(1)]);
  const reached = pulled.status === 'fulfilled' ? pulled.value : pulled.reason.reached;

  assert.deepEqual(reached.map(({ card, action }) => ({ card, action })), [{ card: 113, action: 'merge' }]);
  assert.deepEqual(built.l3Events().filter(({ event }) => event === 'pull').map(({ card }) => card), [113]);
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [1131]);
  assert.deepEqual(await columnsOf(built.fake), { 113: COLUMNS.done, 114: COLUMNS.review, 99: COLUMNS.ready });
});

test('a pull given no limit, with N 1, takes every merge with no slot beside the one Ready maker the slot admits', async () => {
  const built = merging([115], { others: [readyCard(98), readyCard(99)], concurrency: 1, answer: () => new Error('the maker cannot start') });

  await built.loop.pull().catch(() => {});

  assert.deepEqual(built.l3Events().filter(({ event }) => event === 'pull').map(({ card }) => card), [115, 98]);
  assert.deepEqual(built.repository.merges().map(({ number }) => number), [1151]);
});

// proves R-CONFLICT-1
test('given a card returned for a conflict, the next pull has L1 make its workspace at the pull request\'s head, continuing it, never afresh', async () => {
  const { built } = await mergedAs(({ repository }) => {
    repository.update(1011, { mergeable: 'conflicting' });
    return { outcome: 'refused', reason: 'conflict' };
  });
  assert.deepEqual(await columnsOf(built.fake), { 101: COLUMNS.coding });
  // The next pull, by an engine whose workspace handle records the head L3 hands it, and which
  // L1 cannot make, so no maker runs and L2 attempts the card twice and stops it.
  const settings = { ...config, concurrency: 1 };
  const decide = (card, outcomes, options = {}) => nextAction(card, REVIEWED, undefined, { roles: settings.roles, provisioning: {}, outcomes, sink: built.sink, ...options });
  const heads = [];
  const next = loop({
    config: settings, board: handleOn(built.fake), decide, facts: factsCall({ config: settings, reads: built.repository.operations, decide }),
    l2: built.l2, sink: built.sink, kill: async () => {}, state: built.directory, environment: {}, judgeDirectory: async () => {}, removeDirectories: async () => {},
    workspace: async (card, head) => {
      heads.push(head);
      throw Object.assign(new Error('the workspace is not made here'), { code: 'WORKSPACE_NOT_MADE', path: '/nowhere' });
    },
  });

  await next.pull().catch(() => {});

  assert.deepEqual(heads, [shaOf(101), shaOf(101)]);
});
