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
   * Moves `card` for `cause`, then records the move as one `transition` event. A move the board
   * refuses is recorded as nothing, and its caller is told which card and column it was.
   */
  const change = async (card, cause) => {
    const { from, to } = CHANGES[cause];
    try {
      await items.moveItem(card.id, columns[to]);
    } catch (refusal) {
      throw new Error(`card #${card.number}'s move from ${from} to ${to} (${columns[to]}) was refused: ${refusal.message}`, { cause: refusal });
    }
    sink.emitter({ layer: 'L2', card: card.number }).emit('transition', { from, to, cause });
  };

  return {
    /** L3 has claimed `card`, a board item as the forge adapter read it. */
    claimed: (card) => change(card, 'claimed'),

    /**
     * L3 hands over `card`'s dispatch `outcome` unread, as `Promise.allSettled` records it. A
     * returned dispatch's card moves to review. A failed one's is not moved, so it stays in coding.
     */
    settled: async (card, outcome) => {
      if (outcome.status === 'fulfilled') return change(card, 'returned');
      if (outcome.status !== 'rejected') {
        throw new Error(`card #${card.number}'s dispatch outcome is neither returned nor failed: ${JSON.stringify(outcome)}`);
      }
    },
  };
}
