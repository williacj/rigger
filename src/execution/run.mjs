// ABOUTME: L1's dispatching function, in its minimal form: it runs one dispatch's command through
// L0's process adapter, recording the dispatch's process group while the command runs. And L1's
// kill of recorded groups, which on a start ends what a dead engine's dispatches left.

import { addGroup, holdsDispatch, readGroups, removeGroup, writeGroups } from './groups.mjs';
import { EVENT_REFUSED, killRecordedGroup, runCommand } from '../substrate/process.mjs';

/**
 * Runs dispatch `id`'s `command` with `args` in `cwd` under exactly `env`, and settles on L0's
 * result for it. `card` is the dispatch's card, where it has one. `directory` is the state
 * directory of the repository the dispatch serves, and `sink` is L5's, through which L0 records
 * what it kills under this dispatch and its card.
 *
 * While the command runs, the record in `directory` holds an entry naming its process group, the
 * dispatch and the card (`ARCHITECTURE.md`, "Failure model"). The entry is removed once L0 has
 * emptied the group, which it has done when it settles, or rejects naming a refused event. Any
 * other rejection leaves the entry it wrote, for a later start to settle. Where the record
 * refuses the removal after a refused event, the refusal still reaches the caller, carrying the
 * record's failure as `recordFailure`.
 */
export async function dispatch({ id, card, directory, sink, command, args, cwd, env }) {
  // L3 allocates the id (the architect's ruling 1, P4 on #332), and an entry without one could
  // not be told from another dispatch's. Null and the empty string are no id either.
  if (id === undefined || id === null || id === '') throw new Error(`L1 was given no dispatch id, so it did not start ${command}`);
  if (!holdsDispatch(id, card)) throw new Error(`L1's record of process groups cannot hold dispatch id ${JSON.stringify(id)} with card ${JSON.stringify(card)}, so it did not start ${command}`);
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
      emitter: sink.emitter({ layer: 'L0', card, dispatch: id }),
      onGroup: (group, started) => {
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
        addGroup(directory, { group, started, dispatch: id, card });
        recorded = group;
      },
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

/**
 * Ends what a dead engine left: each process group the record in `directory` names, where L0
 * confirms the group is the one recorded, recording each kill through `sink` under the entry's
 * dispatch and card (`ARCHITECTURE.md`, "Failure model"). `ps` and `readTimeout` stand in for L0's
 * own where the caller gives them.
 *
 * A record that cannot be read as entries fails whole, naming its file, before anything is killed.
 * Every entry is tried whatever became of those before it. Afterwards the record keeps only the
 * entries whose group L0 could not confirm, because a later start may: L0 has confirmed every
 * other group empty, killed it, or found it is not the one recorded. The call then rejects naming
 * each entry it kept and each kill the sink refused, with its dispatch id and card. A group whose
 * kill went unrecorded is dead, so its entry goes too: keeping it would record nothing later
 * (the architect's ruling 2, §5, on #332). Where the record then refuses its rewrite, that
 * failure is added to the rejection and carried on it as `recordFailure`.
 */
export async function killRecordedGroups({ directory, sink, ps, readTimeout }) {
  const entries = readGroups(directory);
  if (entries.length === 0) return;
  const kept = [];
  const unconfirmed = [];
  const unrecorded = [];
  for (const entry of entries) {
    const { group, started, dispatch, card } = entry;
    const under = `dispatch ${dispatch}${card === undefined ? '' : `, card #${card}`}`;
    try {
      await killRecordedGroup({ group, started, ps, readTimeout, emitter: sink.emitter({ layer: 'L0', card, dispatch }) });
    } catch (failure) {
      if (failure.code !== EVENT_REFUSED) {
        kept.push(entry);
        unconfirmed.push(`the entry for group ${group}, ${under}: ${failure.message}`);
        continue;
      }
      for (const { event, cause, ...fields } of failure.unrecorded) unrecorded.push(`${under}: ${event} ${JSON.stringify(fields)}: ${cause.message}`);
    }
  }
  const failures = [];
  if (unconfirmed.length > 0) failures.push(`L1 could not confirm ${unconfirmed.length} recorded group(s) as the one recorded, so it killed nothing in them and kept their entries:`, ...unconfirmed);
  if (unrecorded.length > 0) failures.push(`the sink refused ${unrecorded.length} kill(s) of recorded groups, so they went unrecorded:`, ...unrecorded);
  // A rewrite the record refuses rides on the failure rather than replacing it, so the caller
  // still learns which kills went unrecorded and which groups went unconfirmed.
  let recordFailure;
  try {
    writeGroups(directory, kept);
  } catch (cause) {
    if (failures.length === 0) throw cause;
    recordFailure = cause;
    failures.push(`and the record of process groups in ${directory} was not rewritten, so it still holds every entry it held: ${cause.message}`);
  }
  if (failures.length > 0) throw Object.assign(new Error(failures.join('\n')), { recordFailure });
}
