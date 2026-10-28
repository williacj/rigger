// ABOUTME: The forge adapter's schema-write side: creating a board field, adding a column and
// creating a repository label, each sent through the schema-write runner. Only the CLI's verbs
// reach it.

import { literal } from './graphql.mjs';
import { answerOf, boardOf, repositoryOf } from './read.mjs';
import { firstLine, graphqlRequest, schemaWriteRunner } from './runners.mjs';
import { written } from './write-made.mjs';

/**
 * The colours a new field option and a new label are given. GitHub requires one for each (the
 * `color` of `ProjectV2SingleSelectFieldOptionInput` and of `CreateLabelInput` are both non-null,
 * introspected on 2026-09-25), and nothing in the config declares one, so these are a choice: the
 * neutral grey each palette offers.
 */
const OPTION_COLOUR = 'GRAY';
const LABEL_COLOUR = 'ededed';

/**
 * The schema writes on `board`, which names its `repo`, its `project` number and, where the config
 * declares one, its `owner`, each read and write sent with `emitter` and `timeout` as the read side
 * sends its reads. `send` stands in for the runners' spawn in tests. No write here is
 * read back to confirm it, for the reason the column move gives (`item-write.mjs`): `gh` exiting
 * 0 is the write.
 */
export function schemaWriteSide(board, { send, emitter, timeout } = {}) {
  const via = { send, emitter, timeout };
  /**
   * Sends the mutation `document` for `operation`, whose root field is `root`, and reads its answer.
   * A refused event on the call is marked made where the call exited 0 within its timeout and its
   * answer's `data` holds `root`, non-null. The root tells the write's answer from that of the
   * runner's own read inside the same call (`heldOptions`), whose `data` holds no such field.
   */
  const write = async (operation, root, document) => {
    const made = (said) => {
      if (said.timedOut) throw new Error(firstLine(said));
      if (answerOf(operation, board, said)?.[root] == null) throw new Error(`${operation} on board ${board.project} answered no ${root}`);
    };
    answerOf(operation, board, await written(schemaWriteRunner(graphqlRequest(document), via), made));
  };
  return {
    /** Creates the single-select field `name` holding `options`, in the order given. */
    createField: async (name, options) => {
      const { id } = await boardOf('createField', board, via);
      const held = options.map((option) => `{name: ${literal(option)}, color: ${OPTION_COLOUR}, description: ""}`);
      const create = `mutation { createProjectV2Field(input: {projectId: ${literal(id)}, dataType: SINGLE_SELECT, name: ${literal(name)}, singleSelectOptions: [${held.join(', ')}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }`;
      await write('createField', 'createProjectV2Field', create);
    },
    /**
     * Adds the column `name`, an option of the field holding the columns, after the options the
     * field holds. It sends every held option back with its `id`, name, colour and description,
     * and the new one without an `id`: #212's way B, which kept every item's column where way C,
     * the same options without their `id`, cleared them all
     * (`docs/spikes/status-option-through-gh.md`, "Conclusion").
     */
    createColumn: async (name) => {
      const { columns } = await boardOf('createColumn', board, via);
      const held = columns.options.map((option) => `{id: ${literal(option.id)}, name: ${literal(option.name)}, color: ${option.color}, description: ${literal(option.description)}}`);
      const added = `{name: ${literal(name)}, color: ${OPTION_COLOUR}, description: ""}`;
      const update = `mutation { updateProjectV2Field(input: {fieldId: ${literal(columns.id)}, singleSelectOptions: [${[...held, added].join(', ')}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }`;
      await write('createColumn', 'updateProjectV2Field', update);
    },
    /** Creates the label `name` in the board's repository. */
    createLabel: async (name) => {
      const repositoryId = await repositoryOf('createLabel', board, via);
      const create = `mutation { createLabel(input: {repositoryId: ${literal(repositoryId)}, name: ${literal(name)}, color: ${literal(LABEL_COLOUR)}}) { label { id } } }`;
      await write('createLabel', 'createLabel', create);
    },
  };
}
