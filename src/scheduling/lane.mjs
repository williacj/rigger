// ABOUTME: L3's repo lane: the merges L2 decides, made one at a time in the order L3 pulled them, each
// recorded as `merge.start` and `merge.end` around L2's re-run of its rule and L2's merge call.

/** What `merge.end` names of L2's merge answer `answer`: its outcome, and its reason and context where it gives them. */
const named = ({ outcome, reason, context }) => ({ outcome, ...(reason === undefined ? {} : { reason }), ...(context === undefined ? {} : { context }) });

/** `second` where `first` is null, or the two in one AggregateError saying `sentence`, since neither may hide the other. */
const beside = (first, second, sentence) => (first === null ? second : new AggregateError([first, second], sentence));

/**
 * The lane over the board L0's `board` reads, with L2's facts call `facts` and its column changes
 * `l2`, recording L3's events through `record(event, fields, card)` and naming a refused append as
 * `refused(sentence, refusal)` does. Answers `merge(claim)`, which queues a merge claim behind every
 * merge queued before it and settles once its own merge has ended, so no two merges overlap
 * (`R-SCHED-15`), as `merged` says.
 */
export function lane({ board, facts, l2, record, refused }) {
  let tail = Promise.resolve();

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
   * Only after `merge.end` is recorded does L2 settle the card from the call's answer, as its
   * `mergeEnded` says. A `merge.end` the sink refuses is the halt: nothing more is done for the card,
   * and the failure names it. Answers `{ reached, failure }`: `reached`, the card's number, `action`
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
    const { item, again, ended: unread, failure: unreadFailure } = await rerun(card, next);
    let answer;
    let ended = unread;
    let failure = unreadFailure;
    if (ended === undefined) {
      try {
        answer = await l2.merge(item, again);
        ended = named(answer);
      } catch (thrown) {
        failure = new Error(`card #${card.number}'s merge of pull request #${next.pull} failed: ${thrown.message}`, { cause: thrown });
        ended = { outcome: 'failed', reason: thrown.message };
      }
    }
    const reached = { card: card.number, action: 'merge', ...fields, merge: ended };
    try {
      record('merge.end', { ...fields, ...ended }, card.number);
    } catch (refusal) {
      const unrecorded = refused(`card #${card.number}'s merge of pull request #${next.pull} ended ${ended.outcome}, and the event sink refused to record its end, so nothing more is done for it`, refusal);
      return { reached, failure: beside(failure, unrecorded, `card #${card.number}'s merge failed, and its end went unrecorded`) };
    }
    if (answer !== undefined) {
      try {
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
      return { item, again, ...(unchanged ? {} : { ended: { outcome: 'not merged', action: again.action } }), failure: null };
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
