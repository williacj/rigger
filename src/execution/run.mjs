// ABOUTME: L1's dispatching function, in its minimal form: it runs one dispatch's command through
// L0's process adapter, recording the dispatch's process group while the command runs.

import { addGroup, readGroups, removeGroup, writeGroups } from './groups.mjs';
import { EVENT_REFUSED, runCommand } from '../substrate/process.mjs';

/**
 * Runs dispatch `id`'s `command` with `args` in `cwd` under exactly `env`, for at most `timeout`
 * milliseconds, and settles on L0's result for it. `card` is the dispatch's card, where it has one. `directory` is the state
 * directory of the repository the dispatch serves, and `sink` is L5's, through which L0 records
 * what it kills under this dispatch and its card.
 *
 * While the command runs, the record in `directory` holds an entry naming its process group, the
 * dispatch and the card (`ARCHITECTURE.md`, "Failure model"). The entry is removed once L0 has
 * emptied the group, which it has done when it settles, or rejects naming a refused event, and on
 * Rigger's own exit, once L0's exit cleanup has killed the group. Any other rejection leaves the
 * entry it wrote, and so does an ending that runs no code, for a later start to settle. Where the record
 * refuses the removal after a refused event, the refusal still reaches the caller, carrying the
 * record's failure as `recordFailure`.
 */
export async function dispatch({ id, card, directory, sink, command, args, cwd, env, timeout }) {
  // L3 allocates the id (the architect's ruling 1, P4 on #332), and an entry without one could
  // not be told from another dispatch's. Null and the empty string are no id either.
  if (id === undefined || id === null || id === '') throw new Error(`L1 was given no dispatch id, so it did not start ${command}`);
  // The record is shown writable before anything starts, by writing it back as it stands, so a
  // dispatch whose group could not be recorded runs no command.
  const entries = readGroups(directory);
  try {
    writeGroups(directory, entries);
  } catch (cause) {
    throw new Error(`L1 cannot write its record of process groups in the state directory ${directory}, so dispatch ${id} did not start ${command}: ${cause.message}`, { cause });
  }
  let recorded;
  let settled;
  try {
    settled = await runCommand({
      command,
      args,
      cwd,
      env,
      timeout,
      emitter: sink.emitter({ layer: 'L0', card, dispatch: id }),
      onGroup: (group) => {
        // The window this leaves open. L0 spawns, then hands the group over in the same step, and
        // this writes the entry before anything else runs. So between the spawn and the write
        // there is one synchronous step, and no await. An engine killed by SIGKILL inside it leaves
        // a group that no entry names, and no later start ends it. The dispatch's start event,
        // which L1 appends before the spawn once #347 (M2-08) lands, still shows that dispatch, as
        // a start with no end and no kill.
        // The window is left open, not closed by holding the spawn until the write (the owner,
        // round 4, and the architect's ruling 3, §6, on #332). Either of two findings reverses
        // that: a production incident, in which an unpaired start's processes outlive a restart;
        // or #335 (M2-S1) finding that an environment marker read through `ps` reaches a
        // dispatch's processes, so a restart could find them without the record. #335 read the
        // marker only from binaries that are not Apple's, and every survivor the Claude CLI left
        // was one of Apple's (`docs/spikes/what-leaves-the-process-group.md`).
        addGroup(directory, { group, dispatch: id, card });
        recorded = group;
      },
      // On Rigger's own exit, L0 kills the group, and then hands it here to remove its entry.
      onExit: (group) => removeGroup(directory, group),
    });
  } catch (failure) {
    // L0 rejects with `EVENT_REFUSED` only once it has emptied the group, so that entry goes too,
    // and the refusal still reaches the caller. Any other rejection leaves the entry, because
    // L0 has not said the group is empty, and a later start settles it.
    // A removal the record refuses rides on the refusal rather than replacing it, so the caller
    // still learns which events went unrecorded.
    if (failure.code === EVENT_REFUSED && recorded !== undefined) {
      try {
        removeGroup(directory, recorded);
      } catch (recordFailure) {
        failure.message += `\nand the record of process groups in ${directory} kept the entry for group ${recorded}: ${recordFailure.message}`;
        failure.recordFailure = recordFailure;
      }
    }
    throw failure;
  }
  // L0 settles only once the group is empty, so nothing is left in it to end.
  if (recorded !== undefined) removeGroup(directory, recorded);
  return settled;
}
