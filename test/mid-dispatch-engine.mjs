// ABOUTME: What stands in for Rigger mid-dispatch until a verb dispatches a maker (M4): L3's loop over a
// consumer's board through the `gh` on PATH, whose dispatch allocates an id and calls L1's function.

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { dispatch, killRecordedGroups } from '../src/execution/run.mjs';
import { openSink } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { readSide } from '../src/substrate/forge/read.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';

/**
 * A timeout no dispatch here reaches: the test ends the engine, or the command exits, first.
 * Ten minutes, a judgment whose premise is that no test in this suite runs that long.
 */
const UNREACHED = 600_000;

/**
 * Fires one pull of L3's loop over the board the config in `repository` names, recording to that
 * repository's state directory `.rigger/`, as `rigger once` records there. Each card it pulls is
 * dispatched through L1's function under an id this allocates, a UUID, so that no other dispatch
 * in that state directory, in this run or another, holds it. The dispatch runs `/bin/sh` on
 * `command` in `directory`, or in `workspace` as the dispatch's directory where it is given, and
 * reads the process table through `ps` where it is given. The start's kill L3 is handed is L1's,
 * as a verb's is.
 */
export async function engine({ directory, repository, command, ps, workspace }) {
  const { default: config } = await import(pathToFileURL(join(repository, 'rigger.config.mjs')).href);
  const state = join(repository, '.rigger');
  const sink = openSink({ directory: state, run: randomUUID(), now: Date.now });
  const board = readSide({ ...config.board, repo: config.repo }, { emitter: sink.emitter({ layer: 'L0' }) });
  const l2 = columnChanges({ config, sink });
  const decide = (card, outcomes) => nextAction(card, Object.fromEntries(Object.entries(config.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }])), config.epicLabel, { provisioning: config.provisioning ?? {}, outcomes, sink });
  const dispatching = ({ card }) => dispatch({
    id: `d-${randomUUID()}`, card: card.number, directory: state, sink, command: '/bin/sh', args: [command], cwd: workspace ?? directory, workspace, env: { PATH: '/usr/bin:/bin' }, timeout: UNREACHED, ps,
  });
  const kill = () => killRecordedGroups({ directory: state, sink });
  await loop({ config, board, decide, l2, dispatch: dispatching, sink, kill, workspace: async () => ({ path: directory }), state }).pull();
}
