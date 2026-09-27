// ABOUTME: Builds the world `docs/demo.tape` records in: this checkout installed from its tarball
// outside it, a consumer repository outside it whose config names a fake board, and a bin
// directory on which the fake `gh` is the only `gh`. Test-only, and never named from src/.

import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import template from '../templates/rigger.config.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt } from './git-repository.mjs';
import { installFromTarball } from './installed-rigger.mjs';

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/**
 * The world, built under `into`, a directory outside the checkout at `root`: `bin`, the whole
 * PATH the tape runs under, holding node, git, the installed `rigger` and the fake `gh`; and
 * `target`, the consumer's repository, holding the template's config with its repository and
 * board filled in.
 */
export function demoWorld(root, into) {
  const { rigger, path: bin } = installFromTarball(root, into);
  symlinkSync(rigger, join(bin, 'rigger'));
  installFakeGh(bin, { repo: REPO, project: PROJECT });
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT } };
  const target = repositoryAt(join(into, 'target'), { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` });
  return { bin, target };
}
