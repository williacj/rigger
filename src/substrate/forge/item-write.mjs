// ABOUTME: The forge adapter's item-write side: adding an issue and moving an item on the board,
// sent through the item-write runner. Only L2 reaches it.

import { literal } from './graphql.mjs';
import { answerOf, boardOf } from './read.mjs';
import { COLUMNS, firstLine, graphqlRequest, itemWriteRunner, readRunner } from './runners.mjs';

/**
 * The item writes on `board`, which names its `repo`, its `project` number and, where the config
 * declares one, its `owner`, each read and write sent with `timeout` as the read side sends its
 * reads. `send` stands in for the runners' spawn in tests.
 */
export function itemWriteSide(board, { send, timeout } = {}) {
  return {
    /** Add one issue to the board by number, reading its node ID before the mutation. */
    addIssue: async (number, emitter) => {
      if (!Number.isSafeInteger(number) || number < 1) throw new Error(`addIssue on issue #${number} failed: not an issue number`);
      const via = { send, emitter, timeout };
      try {
        const issue = await readRunner(['api', `repos/${board.repo}/issues/${number}`, '-X', 'GET'], via);
        if (issue.status !== 0 || issue.timedOut) throw new Error(firstLine(issue));
        const contentId = JSON.parse(issue.stdout).node_id;
        if (typeof contentId !== 'string' || !contentId) throw new Error('the read answered no node id');
        const { id } = await boardOf('addIssue', board, via);
        const add = `mutation { addProjectV2ItemById(input: {projectId: ${literal(id)}, contentId: ${literal(contentId)}}) { item { id } } }`;
        const said = await itemWriteRunner(graphqlRequest(add), via);
        if (said.timedOut) throw new Error(firstLine(said));
        return answerOf('addIssue', board, said).addProjectV2ItemById.item.id;
      } catch (error) {
        const failure = new Error(`addIssue on issue #${number} failed: ${error.message}`, { cause: error });
        if (error.code !== undefined) failure.code = error.code;
        throw failure;
      }
    },
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
