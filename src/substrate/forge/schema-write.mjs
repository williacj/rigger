// ABOUTME: The forge adapter's schema-write side: creating a board field and a repository label,
// each sent through the schema-write runner. Only the CLI's verbs reach it.

import { literal } from './graphql.mjs';
import { answerOf, boardOf, repositoryOf } from './read.mjs';
import { graphqlRequest, schemaWriteRunner } from './runners.mjs';

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
 * declares one, its `owner`. `send` stands in for the runners' spawn in tests. Neither write is read back to confirm it, for the reason the
 * column move gives (`item-write.mjs`): `gh` exiting 0 is the write.
 */
export function schemaWriteSide(board, { send } = {}) {
  return {
    /** Creates the single-select field `name` holding `options`, in the order given. */
    createField: async (name, options) => {
      const { id } = boardOf('createField', board, send);
      const held = options.map((option) => `{name: ${literal(option)}, color: ${OPTION_COLOUR}, description: ""}`);
      const create = `mutation { createProjectV2Field(input: {projectId: ${literal(id)}, dataType: SINGLE_SELECT, name: ${literal(name)}, singleSelectOptions: [${held.join(', ')}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }`;
      answerOf('createField', board, schemaWriteRunner(graphqlRequest(create), { send }));
    },
    /** Creates the label `name` in the board's repository. */
    createLabel: async (name) => {
      const repositoryId = repositoryOf('createLabel', board, send);
      const create = `mutation { createLabel(input: {repositoryId: ${literal(repositoryId)}, name: ${literal(name)}, color: ${literal(LABEL_COLOUR)}}) { label { id } } }`;
      answerOf('createLabel', board, schemaWriteRunner(graphqlRequest(create), { send }));
    },
  };
}
