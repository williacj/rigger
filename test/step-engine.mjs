// ABOUTME: What stands in for Rigger while a provisioning step runs: L3's loop over a consumer's board
// through the `gh` on PATH, dispatching one required step, `hold`, which runs a command L3 hands L1.

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { killRecordedGroups } from '../src/execution/run.mjs';
import { openSink } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { factsCall } from '../src/workflow/facts.mjs';

/**
 * Fires one pull of L3's loop over the board the config in `repository` names, recording to that
 * repository's state directory `.rigger/`, as `rigger once` records there. Every kind of that
 * config lists one step, `hold`, which runs `command`. L3 dispatches it through L1 under an id L3
 * allocates, in the workspace the stand-in answers, `directory`, and injects no maker. The start's
 * kill L3 is handed is L1's, as a verb's is.
 */
export async function engine({ directory, repository, command }) {
  const { default: config } = await import(pathToFileURL(join(repository, 'rigger.config.mjs')).href);
  const state = join(repository, '.rigger');
  const sink = openSink({ directory: state, run: randomUUID(), now: Date.now });
  const board = readSide({ ...config.board, repo: config.repo }, { emitter: sink.emitter({ layer: 'L0' }) });
  const reads = repositoryReads({ ...config.board, repo: config.repo }, { emitter: sink.emitter({ layer: 'L0' }) });
  const l2 = columnChanges({ config, sink });
  const kinds = Object.fromEntries(Object.entries(config.kinds).map(([name, kind]) => [name, { ...kind, provisioning: ['hold'] }]));
  const provisioning = { hold: { run: command, required: true } };
  const decide = (card, outcomes) => nextAction(card, kinds, config.epicLabel, { provisioning, outcomes, sink });
  const kill = () => killRecordedGroups({ directory: state, sink });
  await loop({ config, board, decide, facts: factsCall({ config, reads, decide }), l2, sink, kill, workspace: async () => ({ path: directory }), state }).pull();
}
