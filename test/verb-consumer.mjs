// ABOUTME: The consumer the claiming verbs' bin tests run over: its repository and board, the cards on
// that board, and its config, the template's with kinds listing no provisioning step.

import template from '../templates/rigger.config.mjs';

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
export const REPO = 'acme/widgets';
export const PROJECT = 3;

/** The board's columns, the config's display names among them, and its priority field. */
export const COLUMNS = ['Backlog', 'Ready', 'Coding', 'Review', 'Owner', 'Done'];
export const FIELDS = [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }];

/** A body whose acceptance the form check admits: one item that is not the title. */
export const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** A card on the consumer's board that L2 would dispatch: an issue in its repository, selected by the `change` kind. */
export const card = (number, column, extra = {}) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: ADMITTED, labels: ['type:change'], column, ...extra,
});

/** A ready card L2 refuses: its body holds no acceptance, so the form check refuses it. */
export const REFUSED = card(11, 'Ready', { body: 'Why this matters, and nothing more.' });

/** The template's kinds, each listing no provisioning step, so a claimed card's attempt runs none. */
export const KINDS = Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }]));

/** The consumer's config: the template's, with its repository, its board and N `concurrency` filled in, and kinds listing no provisioning. */
export const consumerConfig = (concurrency) => ({ ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency, kinds: KINDS });
