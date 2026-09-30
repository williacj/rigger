// ABOUTME: L1's step runner: what L1's dispatching function is handed to run one provisioning step
// under `/bin/sh` in a card's workspace, or in the step's `cwd` under it, for the step's time.

import { join } from 'node:path';

import { stepTimeout } from '../config/validate.mjs';

/**
 * What L1's `dispatch` is handed to run `step`, a provisioning step as the config declares it, in
 * the card's `workspace`, under `env`, the engine's own environment unless the caller gives one.
 * The caller adds the dispatch's id, card, state directory and sink.
 *
 * The step's `run` line runs as `/bin/sh -c`, never under the user's `$SHELL`, so a step behaves
 * the same whatever the login shell (the architect's ruling 1, A7, on #423). Its working directory
 * is `cwd` joined under the workspace, or the workspace itself, and is joined here so that
 * `dispatch` derives nothing (A9). The workspace is handed on as well, which is what `dispatch`
 * records the step as running in, and holds its working directory to.
 */
export const stepDispatch = (step, workspace, env = process.env) => ({
  command: '/bin/sh',
  args: ['-c', step.run],
  cwd: join(workspace, step.cwd ?? '.'),
  workspace,
  env,
  timeout: stepTimeout(step),
});
