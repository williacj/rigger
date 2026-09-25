// ABOUTME: L2's column changes: which column a card moves to when L3 claims it or hands L2 its
// dispatch's outcome, the move itself through the forge adapter's item-write side, and its event.

import { itemWriteSide } from '../substrate/forge/item-write.mjs';

/**
 * L2's column changes on the board `config` names. `items` is the forge adapter's item-write
 * side for that board, and a test passes the fake board's operations in its place.
 */
export function columnChanges({ config, items = itemWriteSide({ repo: config.repo, project: config.board.project }) }) {
  const { columns } = config.board;

  const move = async (card, to) => {
    await items.moveItem(card.id, columns[to]);
  };

  return {
    /** L3 has claimed `card`, a board item as the forge adapter read it. */
    claimed: (card) => move(card, 'coding'),

    /**
     * L3 hands over `card`'s dispatch `outcome` unread, as `Promise.allSettled` records it. A
     * returned dispatch's card moves to review. A failed one's is not moved, so it stays in coding.
     */
    settled: async (card, outcome) => {
      if (outcome.status === 'fulfilled') return move(card, 'review');
      if (outcome.status !== 'rejected') {
        throw new Error(`card #${card.number}'s dispatch outcome is neither returned nor failed: ${JSON.stringify(outcome)}`);
      }
    },
  };
}
