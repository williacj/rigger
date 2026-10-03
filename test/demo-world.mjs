// ABOUTME: Builds the world `docs/demo.tape` records in: this checkout installed from its tarball
// outside it, a consumer repository outside it whose config names a fake board, and a bin
// directory on which the fake `gh` is the only `gh` and the stand-in agent the only `claude`.
// Test-only, and never named from src/.

import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import template from '../templates/rigger.config.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { installFromTarball } from './installed-rigger.mjs';
import { installStandInAgent } from './stub-claude.mjs';

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/** A card on the consumer's board the `change` kind selects, with an acceptance the form check admits. */
const card = (number, column, title, priority) => ({
  type: 'issue', repository: REPO, number, title, labels: ['type:change'], column, fieldValues: { Priority: priority },
  body: `## Acceptance\n\n- ${title}, and a test proves it.\n`,
});

/**
 * The board as its owner left it: the config's columns among others, its priority field, and
 * two Ready cards of which `once` claims the higher-priority one, #12.
 */
const BOARD = {
  columns: ['Backlog', 'Ready', 'Coding', 'Review', 'Owner', 'Done'],
  fields: [{ name: 'Priority', options: ['High', 'Normal', 'Low'] }],
  items: [
    card(9, 'Done', 'Ship the widget', 'Normal'),
    card(12, 'Ready', 'Turn the widget blue when pressed', 'High'),
    card(15, 'Ready', 'Name the widget in the title bar', 'Normal'),
  ],
};

/**
 * The world, built under `into`, a directory outside the checkout at `root`: `bin`, the whole
 * PATH the tape runs under, holding node, git, the installed `rigger`, the fake `gh` and the
 * stand-in agent as `claude`, which runs under node by its absolute path and exits 0; and
 * `target`, the consumer's repository, with a local bare `origin` beside it, holding the
 * template's config with its repository and board filled in, and one provisioning step, whose
 * `run` is `true`, which the demo card's kind lists and which reaches no network.
 */
export function demoWorld(root, into) {
  const { rigger, path: bin } = installFromTarball(root, into);
  symlinkSync(rigger, join(bin, 'rigger'));
  installFakeGh(bin, { repo: REPO, project: PROJECT, board: BOARD });
  installStandInAgent(bin);
  const kinds = Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: name === 'change' ? ['ready'] : [] }]));
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT }, kinds, provisioning: { ready: { run: 'true', required: true } } };
  const target = withOrigin(repositoryAt(join(into, 'target'), { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` }), join(into, 'origin.git'));
  return { bin, target };
}
