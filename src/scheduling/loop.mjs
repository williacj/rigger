// ABOUTME: L3's loop: the pull trigger that reads the board, claims up to N cards in pull order
// before any await, has L2 move each claimed card, dispatches it, and hands L2 its outcome.

import { pullOrder } from './pull-order.mjs';

/** N when the config declares none (`ARCHITECTURE.md`, the Engine settings row). */
const DEFAULT_CONCURRENCY = 3;

/**
 * L3's dispatching entry point, over the board `config` names.
 *
 * `board` is L0's handle on it, the forge adapter's read side: `readColumns()` answers the
 * declared columns by key, and `readPriority()` answers the cards with their priority and the
 * declared order, which is what L0 hands L3 for the pull order. `decide` is L2's next action for a
 * card, and `l2` is L2's column changes. `dispatch({ card, kind })` is L1's, injected (the
 * architect's ruling 1, B5), and answers the dispatch's result or throws.
 *
 * A claim is held in memory from the moment L3 pulls a card until its slot is released, and no
 * longer (the architect's ruling 4, §4): nothing here remembers a card once its slot is free.
 */
export function loop({ config, board, decide, l2, dispatch }) {
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const claims = new Set();

  /**
   * One claimed card's work: L2's claim move for a card pulled from Ready, the dispatch, and L2's
   * handling of its outcome, handed over unread. The slot is released however it ends.
   */
  const work = async ({ card, kind, redo }) => {
    try {
      if (!redo) await l2.claimed(card);
      const [outcome] = await Promise.allSettled([new Promise((resolve) => resolve(dispatch({ card, kind })))]);
      await l2.settled(card, outcome);
    } finally {
      claims.delete(card.number);
    }
  };

  return {
    /**
     * Fires the pull trigger once: reads the board, claims as many cards as there are free slots,
     * first pulled first, and works each. Every claim is taken in the same synchronous step as the
     * pull order it follows, so no other trigger can claim a card between the two.
     *
     * Settles once every card it claimed has been worked. A read that fails rejects with the
     * read's own error, and no card is claimed. A card whose work fails is reported in an
     * AggregateError naming how many failed, each failure unchanged in its `errors`.
     */
    pull: async () => {
      const columns = await board.readColumns();
      const { items, declared } = await board.readPriority();
      const unclaimed = items.filter((item) => !claims.has(item.number));
      const { pulls } = pullOrder({ items: unclaimed, columns, declared }, decide);
      const claimed = pulls.slice(0, Math.max(0, concurrency - claims.size)).map((pull) => {
        claims.add(pull.card);
        return { ...pull, card: unclaimed.find((item) => item.number === pull.card) };
      });
      const failures = (await Promise.allSettled(claimed.map(work)))
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, `${failures.length} of the ${claimed.length} cards this pull claimed failed`);
      }
    },
  };
}
