// ABOUTME: The forge adapter's item-write side: adding an issue and moving an item on the board,
// sent through the item-write runner. Only L2 reaches it.

import { literal } from './graphql.mjs';
import { answerOf, boardOf } from './read.mjs';
import { COLUMNS, firstLine, graphqlRequest, itemWriteRunner, readRunner } from './runners.mjs';
import { carried, written } from './write-made.mjs';

/**
 * The check a refused event on an item write's call is marked made by: the call `said` exited 0
 * within its timeout, and its answer's `data` holds the mutation's `root` field, non-null. The
 * root tells the write's answer from that of the runner's own read inside the same call
 * (`columnsField`), whose `data` holds no such field. Answers that field.
 */
function mutated(operation, board, root) {
  return (said) => {
    if (said.timedOut) throw new Error(firstLine(said));
    const answer = answerOf(operation, board, said)?.[root];
    if (answer == null) throw new Error(`${operation} on board ${board.project} answered no ${root}`);
    return answer;
  };
}

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
        const added = mutated('addIssue', board, 'addProjectV2ItemById');
        const said = await written(itemWriteRunner(graphqlRequest(add), via), (answer) => added(answer).item.id);
        if (said.timedOut) throw new Error(firstLine(said));
        return answerOf('addIssue', board, said).addProjectV2ItemById.item.id;
      } catch (error) {
        throw carried(new Error(`addIssue on issue #${number} failed: ${error.message}`, { cause: error }), error);
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
      const moved = mutated('moveItem', board, 'updateProjectV2ItemFieldValue');
      answerOf('moveItem', board, await written(itemWriteRunner(graphqlRequest(move), via), (said) => { moved(said); }));
    },
  };
}
