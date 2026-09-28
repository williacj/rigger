// ABOUTME: L1's dispatching function: it records a dispatch's start, runs its command through L0's
// process adapter while recording the command's process group, and records the dispatch's end.

import { addGroup, readGroups, removeGroup, writeGroups } from './groups.mjs';
import { EVENT_REFUSED, NOT_STARTED, runCommand } from '../substrate/process.mjs';

/**
 * Runs dispatch `id`'s `command` with `args` in `cwd` under exactly `env`, for at most `timeout`
 * milliseconds, and settles on L0's result for it: the exit code `exit`, whether the timeout
 * ended it, and the output as bytes, `stdout` and `stderr`. `card` is the dispatch's card, where
 * it has one. `directory` is the state directory of the repository the dispatch serves, and `sink`
 * is L5's, through which L1 records the dispatch and L0 what it kills, under this dispatch and its
 * card. `clock` reads milliseconds for the dispatch's duration, and is the process's own unless a
 * test gives one.
 *
 * The order is fixed (the architect's ruling 2, §4, on #332): L1 appends `dispatch.start`; shows
 * the record writable; has L0 spawn the command, and writes the entry; L0 runs the command, kills
 * what is left of its group, and settles; L1 removes the entry, appends `dispatch.timeout` where
 * the timeout ended the command, then `dispatch.end`, and settles. Every start L1 records gets
 * exactly one end, which carries the exit code and the duration where the command ran, and why it
 * did not start where it never did.
 *
 * A refused start starts nothing, and the call rejects with an `EVENT_REFUSED` failure naming it.
 * A command that never started rejects with a `NOT_STARTED` failure, a state directory whose
 * record cannot be written included. Where the sink refuses the timeout or the end, every append is
 * still tried, and the call rejects with an `EVENT_REFUSED` failure naming the dispatch, its card
 * and each unrecorded event, carrying the result where the command ran. L0's own refusal takes
 * those events onto it; any other failure becomes the refusal's `cause`.
 *
 * While the command runs, the record in `directory` holds an entry naming its process group, the
 * dispatch and the card (`ARCHITECTURE.md`, "Failure model"). The entry is removed once L0 has
 * emptied the group, which it has done when it settles, or rejects naming a refused event. Any
 * other rejection leaves the entry it wrote, for a later start to settle. Where the record
 * refuses the removal after a refused event, the refusal still reaches the caller, carrying the
 * record's failure as `recordFailure`.
 */
export async function dispatch({ id, card, directory, sink, command, args, cwd, env, timeout, clock = () => performance.now() }) {
  // L3 allocates the id (the architect's ruling 1, P4 on #332), and an entry without one could
  // not be told from another dispatch's. Null and the empty string are no id either.
  if (id === undefined || id === null || id === '') throw new Error(`L1 was given no dispatch id, so it did not start ${command}`);
  const events = sink.emitter({ layer: 'L1', card, dispatch: id });
  const began = clock();
  try {
    events.emit('dispatch.start', { command });
  } catch (cause) {
    throw refused(id, card, [{ event: 'dispatch.start', command, cause }]);
  }
  let recorded;
  let result;
  let failure;
  try {
    // The record is shown writable before anything starts, by writing it back as it stands, so a
    // dispatch whose group could not be recorded runs no command.
    try {
      writeGroups(directory, readGroups(directory));
    } catch (cause) {
      throw Object.assign(new Error(`L1 cannot write its record of process groups in the state directory ${directory}, so dispatch ${id} did not start ${command}: ${cause.message}`, { cause }), { code: NOT_STARTED });
    }
    result = await runCommand({
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
        // which L1 appended before the spawn, still shows that dispatch, as a start with no end
        // and no kill.
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
    });
  } catch (thrown) {
    failure = thrown;
    result = thrown.result;
  }
  // L0 settles, or rejects with `EVENT_REFUSED`, only once it has emptied the group, so the entry
  // goes. Any other rejection leaves the entry, because L0 has not said the group is empty, and a
  // later start settles it. A removal the record refuses after a refused event rides on the
  // refusal rather than replacing it, so the caller still learns which events went unrecorded.
  if (recorded !== undefined && (failure === undefined || failure.code === EVENT_REFUSED)) {
    try {
      removeGroup(directory, recorded);
    } catch (recordFailure) {
      if (failure === undefined) failure = recordFailure;
      else {
        failure.message += `\nand the record of process groups in ${directory} kept the entry for group ${recorded}: ${recordFailure.message}`;
        failure.recordFailure = recordFailure;
      }
    }
  }
  // Every append is tried whatever became of those before it, so a refused timeout event still
  // leaves the dispatch its end.
  const unrecorded = [];
  const record = (event, fields) => {
    try {
      events.emit(event, fields);
    } catch (cause) {
      unrecorded.push({ event, ...fields, cause });
    }
  };
  if (result?.timedOut) record('dispatch.timeout', { timeout });
  // One end for every start L1 recorded, carrying the exit code where the command ran, or why it
  // did not start (the architect's ruling 2, §4, on #332).
  const ms = Math.round(clock() - began);
  record('dispatch.end', result === undefined ? { reason: failure.message, ms } : { exit: result.exit, ms });
  if (unrecorded.length > 0) failure = alongside(failure, refused(id, card, unrecorded, result));
  if (failure !== undefined) throw failure;
  return result;
}

/**
 * `refusal`, L1's failure for its unrecorded events, carried alongside the `failure` the dispatch
 * already had, where it had one. L0's own refusal takes L1's unrecorded events onto it, so the
 * caller reads every unrecorded event in one place. Any other failure becomes the refusal's cause,
 * and its message leads the refusal's.
 */
function alongside(failure, refusal) {
  if (failure === undefined) return refusal;
  if (failure.code === EVENT_REFUSED) {
    failure.message += `\n${refusal.message}`;
    failure.unrecorded.push(...refusal.unrecorded);
    return failure;
  }
  refusal.message = `${failure.message}\nand ${refusal.message}`;
  refusal.cause = failure;
  return refusal;
}

/**
 * The failure for dispatch `id`, of `card` where it has one, whose `unrecorded` L1 events the sink
 * refused, each with its fields and why, carrying the dispatch's `result` where its command ran. Its
 * `code` tells the caller it from a command that never started without reading the message.
 */
function refused(id, card, unrecorded, result) {
  const lines = unrecorded.map(({ event, cause, ...fields }) => `${event} ${JSON.stringify(fields)}: ${cause.message}`);
  const under = `dispatch ${id}${card === undefined ? '' : `, card #${card}`}`;
  return Object.assign(new Error(`the sink refused ${unrecorded.length} L1 event(s) of ${under}, so they went unrecorded:\n${lines.join('\n')}`), { code: EVENT_REFUSED, unrecorded, result });
}
