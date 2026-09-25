// ABOUTME: L2's column changes: which column a card moves to when L3 claims it or hands L2 its
// dispatch's outcome, the move itself through the forge adapter's item-write side, and its event.

import { itemWriteSide } from '../substrate/forge/item-write.mjs';

/**
 * Each change L2 makes to a card's column, by its cause, as the column keys it leaves and enters.
 * No change enters `ready`: moving a card there is the owner's, never code's.
 */
const CHANGES = {
  claimed: { from: 'ready', to: 'coding' },
  returned: { from: 'coding', to: 'review' },
};

/**
 * L2's column changes on the board `config` names, each recorded through `sink`. `items` is the
 * forge adapter's item-write side for that board, and a test passes the fake board's operations
 * in its place, or `send` in place of the runners' spawn.
 */
export function columnChanges({ config, sink, send, items = itemWriteSide({ repo: config.repo, project: config.board.project }, { send }) }) {
  const { columns } = config.board;

  /**
   * Each move the board took whose event the sink refused, by board item, as the event it owes.
   * The owner ruled that when Rigger has acted and cannot record it, it fails loudly and starts no
   * further work until it can (#220; #277), so a card here moves again only once its event is in.
   */
  const unrecorded = new Map();

  /** Appends `card`'s transition event, or fails naming the card, both columns and the sink's error. */
  const record = (card, transition) => {
    try {
      sink.emitter({ layer: 'L2', card: card.number }).emit('transition', transition);
      unrecorded.delete(card.id);
    } catch (refusal) {
      unrecorded.set(card.id, transition);
      const { from, to } = transition;
      throw new Error(`card #${card.number} moved from ${from} to ${to}, and the event sink refused to record it: ${refusal.message}`, { cause: refusal });
    }
  };

  /**
   * Moves `card` for `cause`, then records the move as one `transition` event. A move the board
   * refuses is recorded as nothing, and its caller is told which card and column it was. A card
   * whose last move went unrecorded has that event recorded first, and is not moved while it can't be.
   */
  const change = async (card, cause) => {
    if (unrecorded.has(card.id)) record(card, unrecorded.get(card.id));
    const { from, to } = CHANGES[cause];
    try {
      await items.moveItem(card.id, columns[to]);
    } catch (refusal) {
      throw new Error(`card #${card.number}'s move from ${from} to ${to} (${columns[to]}) was refused: ${refusal.message}`, { cause: refusal });
    }
    record(card, { from, to, cause });
  };

  return {
    /** L3 has claimed `card`, a board item as the forge adapter read it. */
    claimed: (card) => change(card, 'claimed'),

    /**
     * L3 hands over `card`'s dispatch `outcome` unread, as `Promise.allSettled` records it: a
     * dispatch that ran is fulfilled with L1's result, `{ exit, output }`, and one that threw
     * before it ran is rejected. The exit code alone decides, by the owner's ruling on #220: zero
     * moves the card to review, whatever the output says, and anything else leaves it in coding.
     */
    settled: async (card, outcome) => {
      if (outcome?.status === 'rejected') return;
      const exit = outcome?.status === 'fulfilled' ? outcome.value?.exit : undefined;
      if (!Number.isInteger(exit)) {
        throw new Error(`card #${card.number}'s dispatch outcome is neither a dispatch that ran with an exit code nor one that threw: ${JSON.stringify(outcome)}`);
      }
      if (exit === 0) await change(card, 'returned');
    },
  };
}
