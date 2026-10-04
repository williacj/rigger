// ABOUTME: What stands in for Rigger mid-dispatch: L3's loop over a consumer's board through the
// `gh` on PATH, whose maker L1 dispatches to a stand-in `claude` that runs the test's command.

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
import { oneOpenFromEveryLine } from './loop-world.mjs';
import { mkdirSync } from 'node:fs';
import { installStandInAgent } from './stub-claude.mjs';
import { readsWith } from './loop-world.mjs';
import { judgeDirectoryHandle } from '../src/execution/workspace.mjs';
import { worktreeTopic } from '../src/config/validate.mjs';

/**
 * Fires one pull of L3's loop over the board the config in `repository` names, recording to that
 * repository's state directory `.rigger/`, as `rigger once` records there. L3 allocates each
 * maker dispatch its id, and L1 dispatches the maker the config's roles name, under the role's
 * own timeout, to a stand-in `claude` first on the `PATH` of the engine's `environment`. The
 * stand-in replaces itself with `/bin/sh` on `command`, so the shell keeps its pid and leads the
 * dispatch's process group. L3's workspace handle answers `workspace` where it is given, and
 * otherwise makes and answers `workspaces/rigger-<card>` under `directory`. That keeps each
 * dispatch's directory, whose processes L0's census kills, apart from the consumer's repository
 * and the fake `gh`, where the engine's own reads run. `ps` is handed to `loop`, which hands it
 * to L1 for the process table's reads where it is given. The start's kill L3 is handed is L1's,
 * as a verb's is.
 */
export async function engine({ directory, repository, command, ps, workspace }) {
  const { default: config } = await import(pathToFileURL(join(repository, 'rigger.config.mjs')).href);
  const state = join(repository, '.rigger');
  const sink = openSink({ directory: state, run: randomUUID(), now: Date.now });
  const board = readSide({ ...config.board, repo: config.repo }, { emitter: sink.emitter({ layer: 'L0' }) });
  const reads = repositoryReads({ ...config.board, repo: config.repo }, { emitter: sink.emitter({ layer: 'L0' }) });
  const l2 = columnChanges({ config, sink, reads: readsWith(oneOpenFromEveryLine) });
  const decide = (card, outcomes) => nextAction(card, Object.fromEntries(Object.entries(config.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }])), config.epicLabel, { roles: config.roles, provisioning: config.provisioning ?? {}, outcomes, sink });
  const stand = join(directory, 'stand-in');
  mkdirSync(stand, { recursive: true });
  const agent = installStandInAgent(stand, { '*': { engineer: { exec: ['/bin/sh', command] } } });
  const handle = async (number) => {
    if (workspace !== undefined) return { path: workspace, scratch: join(directory, 'workspaces', 'scratch', `rigger-${number}`), repository };
    const path = join(directory, 'workspaces', `rigger-${number}`);
    mkdirSync(path, { recursive: true });
    return { path, scratch: join(directory, 'workspaces', 'scratch', `rigger-${number}`), repository };
  };
  const kill = () => killRecordedGroups({ directory: state, sink });
  await loop({ config, board, decide, facts: factsCall({ config, reads, decide }), l2, sink, kill, workspace: handle, judgeDirectory: judgeDirectoryHandle({ root: directory, topic: worktreeTopic(config), repository, sink }), state, environment: { ...process.env, PATH: agent.first() }, ps }).pull();
}
