// ABOUTME: L1's dispatching function, in its minimal form: it runs one dispatch's command through
// L0's process adapter, recording the dispatch's process group while the command runs.

import { addGroup, removeGroup } from './groups.mjs';
import { runCommand } from '../substrate/process.mjs';

export async function dispatch({ id, card, directory, sink, command, args, cwd, env }) {
  if (id === undefined) throw new Error(`L1 was given no dispatch id, so it did not start ${command}`);
  let recorded;
  const result = await runCommand({
    command,
    args,
    cwd,
    env,
    emitter: sink.emitter({ layer: 'L0', card, dispatch: id }),
    onGroup: (group) => {
      addGroup(directory, { group, dispatch: id, card });
      recorded = group;
    },
  });
  // L0 settles only once the group is empty, so nothing is left in it to end.
  if (recorded !== undefined) removeGroup(directory, recorded);
  return result;
}
