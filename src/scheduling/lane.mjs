// ABOUTME: L3's repo lane merges one card at a time in pull order, records each merge, and asks
// L1 to remove merged cards' directories before L2 moves them to Done.

import { whenElapsed } from '../substrate/process.mjs';

/** What `merge.end` names of L2's merge answer `answer`: its outcome, reason and context. */
const named = ({ outcome, reason, context }) => ({ outcome, ...(outcome === 'merged' ? {} : { reason: reason ?? (outcome === 'already merged' ? 'the forge held the pull request as merged already' : `the forge ${outcome} the merge call`) }), ...(context === undefined ? {} : { context }) });

/** `second` where `first` is null, or the two in one AggregateError saying `sentence`, since neither may hide the other. */
const beside = (first, second, sentence) => (first === null ? second : new AggregateError([first, second], sentence));

/**
 * The lane over the board L0's `board` reads, with L2's facts call `facts` and its column changes
 * `l2`, recording L3's events through `record(event, fields, card)` and naming a refused append as
 * `refused(sentence, refusal)` does. Answers `merge(claim)`, which queues a merge claim behind every
 * merge queued before it and settles once its own merge has ended, so no two merges overlap
 * (`R-SCHED-15`), as `merged` says.
 */
export function lane({ board, facts, l2, record, refused, removeDirectories, clock = {} }) {
  let tail = Promise.resolve();
  const now = clock.now ?? Date.now;
  const pause = clock.pause ?? ((delay) => new Promise((resolve) => { whenElapsed(delay, resolve, { hold: true }); }));

  /**
   * The merge of `claim`'s card, L2's `merge` answer `next` at the pull. L3 records `merge.start`
   * under the card, naming the pull request and head, before L2 reads the card again or anything
   * acts on the forge: a merge is a start under the halt, so a start the sink refuses is not made,
   * and rejects naming the card. Then L3 reads the card from the board again and hands it to L2's
   * facts call, and L2 runs its rule again (the architect's r2 ruling 3). Where L2 answers `merge`
   * at the pull request and head pulled, L2 makes the merge call. L3 then records `merge.end`,
   * naming one outcome:
   *
   * - `merged` or `already merged`, as the call answered;
   * - `refused`, with the adapter's `reason`, and its `context` where it names one;
   * - `failed`, where the merge call threw, with its message as `reason`;
   * - `not merged`, where L2 answered other than that, with the `action` it answered, or where the
   *   card could not be read again, with why as `reason`.
   *
   * After a recorded `merge.end` of `merged` or `already merged`, L1 removes the card's directories
   * before L2 settles it through `mergeEnded`. A `merge.end` the sink refuses is the halt: nothing
   * more is done for the card, and the failure names it. Answers `{ reached, failure }`: `reached`, the card's number, `action`
   * `merge`, the pull request and head, and `merge`, what `merge.end` named; and `failure`, the
   * failure to report, or null where there was none.
   */
  const merged = async ({ card, next }) => {
    const fields = { pull: next.pull, head: next.head };
    try {
      record('merge.start', fields, card.number);
    } catch (refusal) {
      throw refused(`card #${card.number}'s merge of pull request #${next.pull} was not started, because the event sink refused to record its start`, refusal);
    }
    const began = now();
    let answer;
    let ended;
    let failure;
    let item;
    let again;
    let reads = 0;
    let lastRead = began;
    for (;;) {
      const reading = await rerun(card, next);
      reads += 1;
      lastRead = now();
      ({ item, again, ended, failure } = reading);
      if (again?.unknownMergeability && now() - began < 60_000) {
        // D16 rule 3: the forge can still show the old mergeability after the write. #664's
        // journal/P58 saw old facts at about 2, 2.4, 6 and 7 seconds; #664's stream saw new
        // facts on later invocations by 103.5 and 91.7 seconds (#758). Neither measured lag.
        await pause(5_000);
        continue;
      }
      if (ended !== undefined) break;
      try {
        const called = await l2.merge(item, again);
        if (called.unknownMergeability) {
          reads += 1;
          lastRead = now();
        }
        if (called.unknownMergeability && now() - began < 60_000) {
          await pause(5_000);
          continue;
        }
        answer = called;
        ended = named(answer);
      } catch (thrown) {
        failure = new Error(`card #${card.number}'s merge of pull request #${next.pull} failed: ${thrown.message}`, { cause: thrown });
        ended = { outcome: 'failed', reason: thrown.message };
      }
      break;
    }
    if (reads > 1) ended = { ...ended, reads, elapsedMs: lastRead - began };
    const reached = { card: card.number, action: 'merge', ...fields, merge: ended };
    try {
      record('merge.end', { ...fields, ...ended }, card.number);
    } catch (refusal) {
      const unrecorded = refused(`card #${card.number}'s merge of pull request #${next.pull} ended ${ended.outcome}, and the event sink refused to record its end, so nothing more is done for it`, refusal);
      return { reached, failure: beside(failure, unrecorded, `card #${card.number}'s merge failed, and its end went unrecorded`) };
    }
    if (answer !== undefined) {
      try {
        if (answer.outcome === 'merged' || answer.outcome === 'already merged') await removeDirectories(card.number);
        await l2.mergeEnded(item, again, answer);
      } catch (thrown) {
        return { reached, failure: beside(failure, thrown, `card #${card.number}'s merge failed, and so did L2's settle of it`) };
      }
    }
    return { reached, failure };
  };

  /**
   * Reads `card` from the board again and has L2 run its rule again over it through its facts call,
   * answering the item read and L2's answer `again`. Where L2 answers other than `merge` at `next`'s
   * pull request and head, it answers too what `merge.end` names, `ended`; and where the card could
   * not be read again, or L2 answered no action, `ended` names why and `failure` names the card.
   */
  const rerun = async (card, next) => {
    try {
      const item = (await board.readItems()).find((each) => each.number === card.number);
      if (item === undefined) throw new Error(`card #${card.number} is no longer on the board`);
      const again = (await facts([item]))(item);
      const unchanged = again.action === 'merge' && again.pull === next.pull && again.head === next.head;
      const details = [];
      if (again.pull !== undefined) details.push(`pull request #${again.pull}`);
      if (again.head !== undefined) details.push(`head ${again.head}`);
      if (again.to !== undefined) details.push(`to ${again.to}`);
      if (again.category !== undefined) details.push(`category ${again.category}`);
      if (again.judges !== undefined) details.push(`judges ${again.judges.map(({ role, facts }) => `${role} at ${facts.head}`).join(', ')}`);
      const reason = again.reason ?? (again.action === 'merge'
        ? `L2 answered ${details.join(' at ')}, after the lane pulled pull request #${next.pull} at head ${next.head}`
        : `L2 answered ${again.action}${details.length === 0 ? '' : `: ${details.join(', ')}`}`);
      return { item, again, ...(unchanged ? {} : { ended: { outcome: 'not merged', action: again.action, reason } }), failure: null };
    } catch (thrown) {
      const failure = new Error(`card #${card.number} was not merged, because L2 could not run its rule again: ${thrown.message}`, { cause: thrown });
      return { ended: { outcome: 'not merged', reason: thrown.message }, failure };
    }
  };

  return {
    /** Queues `claim`'s merge behind every merge queued before it, and settles as `merged` does once it has run. */
    merge: (claim) => {
      const turn = tail.then(() => merged(claim));
      tail = turn.catch(() => {});
      return turn;
    },
  };
}
