// ABOUTME: The forge adapter's item-write side: the one write that changes a board item in M1,
// the column move, sent through the item-write runner. Only L2 reaches it.

import { literal } from './graphql.mjs';
import { answerOf, boardOf } from './read.mjs';
import { COLUMNS, graphqlRequest, itemWriteRunner } from './runners.mjs';

/**
 * The item writes on `board`, which names its `repo`, its `project` number and, where the config
 * declares one, its `owner`, each read and write sent with `timeout` as the read side sends its
 * reads. `send` stands in for the runners' spawn in tests.
 */
export function itemWriteSide(board, { send, timeout } = {}) {
  return {
    /**
     * Moves board item `itemId` to the column the board displays as `column`: one write, setting
     * that column's option of the field holding the columns.
     *
     * Nothing reads the board back to confirm it. #212's spike saw a read straight after a write
     * miss that write, twice (`docs/spikes/status-option-through-gh.md`, "Incidental finding"), so
     * a read-back could report a move that landed as one that did not. The write's own answer is
     * what is read: `gh` exiting 0 is the move, and anything else fails the call.
     *
     * `emitter` is the `L0` emitter every kill in the move's reads and write is recorded through.
     * Its caller opens it for the moved card, so a kill carries the card L0 never knows.
     */
    moveItem: async (itemId, column, emitter) => {
      const via = { send, emitter, timeout };
      const { id, columns } = await boardOf('moveItem', board, via);
      const option = columns.options.find((held) => held.name === column);
      if (!option) {
        throw new Error(`moveItem on board ${board.project} failed: its ${COLUMNS} field has no option named ${column}`);
      }
      const move = `mutation { updateProjectV2ItemFieldValue(input: {projectId: ${literal(id)}, itemId: ${literal(itemId)}, fieldId: ${literal(columns.id)}, value: {singleSelectOptionId: ${literal(option.id)}}}) { projectV2Item { id } } }`;
      answerOf('moveItem', board, await itemWriteRunner(graphqlRequest(move), via));
    },
  };
}
