// ABOUTME: Tests L2's column changes and L3's lane, in process with stub forge sides, given a forge
// write's rejection marked made, and the same rejection unmarked, which each reports as it did.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from '../rigger.config.mjs';
import { lane } from '../src/scheduling/lane.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { madeFailure, unmarkedFailure } from './write-made-fixtures.mjs';

/** What every report of a made write here must name of the refused kill: the event, its fields and the sink's error. */
const KILL = /survivor\.killed \{"pid":4243,"name":"tail","cmd":"\/usr\/bin\/tail -f \/tmp\/hold"\}: EISDIR: illegal operation on a directory, open/;

/** A comment GitHub answers a create with, which a marked post carries as its answer. */
const COMMENT = { id: 901, html_url: 'https://github.com/williacj/rigger/issues/30#issuecomment-901' };

/**
 * A sink whose emitters keep every event they are handed, refusing the events `refuses` names with
 * the error a stream that is a directory raises.
 */
function sinkRefusing(refuses = () => false) {
  const events = [];
  return {
    events,
    emitter: (context) => ({
      emit: (event, fields) => {
        if (refuses(event)) throw new Error(`EISDIR: illegal operation on a directory, open (${event})`);
        events.push({ ...context, event, ...fields });
      },
    }),
  };
}

/** L2's column changes over the repository's own config, with the stub sides and sink given. */
const l2With = ({ items = {}, repositoryWrites = {}, sink = sinkRefusing() } = {}) => columnChanges({ config, sink, items, repositoryWrites, reads: {} });

/** Card #30 in the column `column` names. */
const cardIn = (column) => ({ number: 30, id: 'PVTI_30', column: config.board.columns[column], labels: ['type:change'] });

/** What `promise` rejected with; the test fails where it resolves. */
async function rejectionOf(promise) {
  try {
    await promise;
  } catch (failure) {
    return failure;
  }
  return assert.fail('it resolved');
}

/** Asserts the report `message` of a made write says neither that it was refused nor that it failed. */
function saysMade(message) {
  assert.doesNotMatch(message, /was refused|failed/, message);
  assert.match(message, KILL);
}

test('given a move its item-write side marked made, change reports the card moved, names the unrecorded kill, records the transition and rejects; given it unmarked, it reports the move refused as it did', async () => {
  const sink = sinkRefusing();
  const marked = madeFailure('the sink refused', undefined);
  const l2 = l2With({ sink, items: { moveItem: async () => { throw marked; } } });

  const failure = await rejectionOf(l2.claimed(cardIn('ready')));

  assert.match(failure.message, /^card #30 moved from ready to coding, and the event sink refused to record it: /);
  saysMade(failure.message);
  assert.deepEqual(sink.events.filter(({ event }) => event === 'transition').map(({ card, from, to, cause }) => ({ card, from, to, cause })), [{ card: 30, from: 'ready', to: 'coding', cause: 'claimed' }]);

  const unmarked = unmarkedFailure('moveItem on board 6 failed');
  const plain = await rejectionOf(l2With({ items: { moveItem: async () => { throw unmarked; } } }).claimed(cardIn('ready')));
  assert.equal(plain.message, `card #30's move from ready to coding (Coding) was refused: ${unmarked.message}`);
});

test('given a move its item-write side marked made whose transition the sink refuses too, change names the unrecorded kill and the refused transition, and rejects', async () => {
  const sink = sinkRefusing((event) => event === 'transition');
  const l2 = l2With({ sink, items: { moveItem: async () => { throw madeFailure('the sink refused', undefined); } } });

  const failure = await rejectionOf(l2.claimed(cardIn('ready')));

  assert.match(failure.message, /^card #30 moved from ready to coding, and the event sink refused to record it: /);
  saysMade(failure.message);
  assert.match(failure.message, /transition.*EISDIR: illegal operation on a directory, open \(transition\)/);
  assert.deepEqual(sink.events.filter(({ event }) => event === 'transition'), []);
});

test('given a return comment its side marked made, returned reports it posted on the pull request, naming the card and the unrecorded kill, and rejects; unmarked, it reports it refused as it did', async () => {
  const marked = madeFailure('postComment on pull request #300 failed', COMMENT);
  const failure = await rejectionOf(l2With({ repositoryWrites: { postComment: async () => { throw marked; } } }).returned(cardIn('coding'), { action: 'return', pull: 300, comment: 'return' }));

  assert.match(failure.message, /^card #30's return comment on pull request #300 was posted, and the event sink refused to record it: /);
  saysMade(failure.message);

  const unmarked = unmarkedFailure('postComment on pull request #300 failed');
  const plain = await rejectionOf(l2With({ repositoryWrites: { postComment: async () => { throw unmarked; } } }).returned(cardIn('coding'), { action: 'return', pull: 300, comment: 'return' }));
  assert.equal(plain.message, `card #30's return comment on pull request #300 was refused: ${unmarked.message}`);
});

/** A maker's escalation L2 routes to the pm, as `settled` answers one. */
const ROUTE = { action: 'escalate', category: 'ambiguous', reason: 'Which column?', raiser: 'maker', destination: 'pm', dispatch: 'd-1' };

test('given a routing comment its side marked made, routed reports it posted, naming the card and the unrecorded kill, records no escalation.route-refused, and rejects; unmarked, it reports and records the refusal as it did', async () => {
  const sink = sinkRefusing();
  const marked = madeFailure('postIssueComment on issue #30 failed', COMMENT);
  const failure = await rejectionOf(l2With({ sink, repositoryWrites: { postIssueComment: async () => { throw marked; } } }).routed(cardIn('coding'), ROUTE));

  assert.match(failure.message, /^card #30's routing comment was posted, and the event sink refused to record it: /);
  saysMade(failure.message);
  assert.deepEqual(sink.events.filter(({ event }) => event === 'escalation.route-refused'), []);

  const plainSink = sinkRefusing();
  const unmarked = unmarkedFailure('postIssueComment on issue #30 failed');
  const plain = await rejectionOf(l2With({ sink: plainSink, repositoryWrites: { postIssueComment: async () => { throw unmarked; } } }).routed(cardIn('coding'), ROUTE));
  assert.equal(plain.message, `card #30's routing comment was refused: ${unmarked.message}`);
  assert.deepEqual(plainSink.events.filter(({ event }) => event === 'escalation.route-refused').map(({ reason }) => reason), [plain.message]);
});

/** An escalation to the owner, as L2's escalate answer gives one. */
const ESCALATION = { action: 'escalate', category: 'critical', reason: 'Keep the user files.' };

test('given an escalation issue comment its side marked made, escalated reports it posted, naming the card and the unrecorded kill, moves nothing, adds no label, and rejects; unmarked, it reports it refused as it did', async () => {
  const moves = [];
  const labels = [];
  const marked = madeFailure('postIssueComment on issue #30 failed', COMMENT);
  const l2 = l2With({
    items: { moveItem: async (...args) => { moves.push(args); } },
    repositoryWrites: { postIssueComment: async () => { throw marked; }, addIssueLabel: async (...args) => { labels.push(args); } },
  });

  const failure = await rejectionOf(l2.escalated(cardIn('coding'), ESCALATION));

  assert.match(failure.message, /^card #30's escalation issue comment was posted, and the event sink refused to record it: /);
  saysMade(failure.message);
  assert.deepEqual([moves, labels], [[], []]);

  const unmarked = unmarkedFailure('postIssueComment on issue #30 failed');
  const plain = await rejectionOf(l2With({ repositoryWrites: { postIssueComment: async () => { throw unmarked; } } }).escalated(cardIn('coding'), ESCALATION));
  assert.equal(plain.message, `card #30's escalation issue comment was refused: ${unmarked.message}`);
});

test('given an escalation label its side marked made, escalated reports the label added, naming the card and the unrecorded kill, and rejects; unmarked, it reports it refused as it did', async () => {
  const marked = madeFailure('addIssueLabel on issue #30 failed', [{ name: 'rigger:escalated' }]);
  const writes = (thrown) => ({ items: { moveItem: async () => {} }, repositoryWrites: { postIssueComment: async () => COMMENT, addIssueLabel: async () => { throw thrown; } } });

  const failure = await rejectionOf(l2With(writes(marked)).escalated(cardIn('coding'), ESCALATION));

  assert.match(failure.message, /^card #30's escalation label rigger:escalated was added, and the event sink refused to record it: /);
  saysMade(failure.message);

  const unmarked = unmarkedFailure('addIssueLabel on issue #30 failed');
  const plain = await rejectionOf(l2With(writes(unmarked)).escalated(cardIn('coding'), ESCALATION));
  assert.equal(plain.message, `card #30's escalation label rigger:escalated was refused: ${unmarked.message}`);
});

/** Card #40 at Review, the merge answer L2 gives for it, and the head its pull request is at. */
const MERGE = { action: 'merge', pull: 401, head: 'c'.repeat(40) };

/**
 * L3's lane over one Review card whose merge call rejects with `thrown`, keeping every L3 event,
 * every directory removal and every L2 settle it makes, with the loop's own wording of a refused append.
 */
function laneRejecting(thrown) {
  const item = { number: 40, id: 'PVTI_40', column: config.board.columns.review };
  const records = [];
  const removed = [];
  const settled = [];
  const merging = lane({
    board: { readItems: async () => [item] },
    facts: async () => () => MERGE,
    l2: { merge: async () => { throw thrown; }, mergeEnded: async (...args) => { settled.push(args); } },
    record: (event, fields, card) => records.push({ event, card, ...fields }),
    refused: (sentence, refusal) => new Error(`${sentence}: ${refusal.message}`, { cause: refusal }),
    removeDirectories: async (card) => { removed.push(card); },
  });
  return { run: () => merging.merge({ card: item, next: MERGE }), records, removed, settled };
}

test('given a merge its side marked made, the lane records merge.end as merged with the merge\'s sha, returns the failure naming the unrecorded kill, and neither removes the directories nor settles through L2; unmarked, it records the merge failed as it did', async () => {
  const sha = 'd'.repeat(40);
  const made = laneRejecting(madeFailure('the sink refused', { outcome: 'merged', sha }));

  const { reached, failure } = await made.run();

  assert.deepEqual(made.records.filter(({ event }) => event === 'merge.end'), [{ event: 'merge.end', card: 40, pull: 401, head: MERGE.head, outcome: 'merged', sha }]);
  assert.equal(reached.merge.outcome, 'merged');
  assert.match(failure.message, /^card #40's merge of pull request #401 was made, and the event sink refused to record it: /);
  saysMade(failure.message);
  assert.deepEqual([made.removed, made.settled], [[], []]);

  const unmarked = unmarkedFailure('reading pull request #401');
  const plain = laneRejecting(unmarked);
  const ended = await plain.run();
  assert.deepEqual(plain.records.filter(({ event }) => event === 'merge.end'), [{ event: 'merge.end', card: 40, pull: 401, head: MERGE.head, outcome: 'failed', reason: unmarked.message }]);
  assert.equal(ended.failure.message, `card #40's merge of pull request #401 failed: ${unmarked.message}`);
});
