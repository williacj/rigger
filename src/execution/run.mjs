// ABOUTME: L1's dispatching function: it records a dispatch's start, runs its command through L0's
// process adapter while recording the command's process group, and records the dispatch's end.
// And L1's kill of recorded groups, which on a start ends what a dead engine's dispatches left.

import { realpathSync } from 'node:fs';
import { sep } from 'node:path';

import { addGroup, holdsDispatch, partialPath, readGroups, removeGroup, removePartial, writeGroups } from './groups.mjs';
import { gitEnvironment } from '../substrate/git-environment.mjs';
import { EVENT_REFUSED, NOT_STARTED, killRecordedGroup, runCommand } from '../substrate/process.mjs';

/**
 * The `code` of the failure a dispatch rejects with when its command ran and the record refused
 * its entry's removal, so its caller tells it from a command that never started and from a refused
 * event without reading the message.
 */
export const RECORD_REFUSED = 'RECORD_REFUSED';

/**
 * Runs dispatch `id`'s `command` with `args` in `cwd` under exactly `env`, for at most `timeout`
 * milliseconds, and settles on L0's result for it: the exit code `exit`, whether the timeout
 * ended it, and the output as bytes, `stdout` and `stderr`. `card` is the dispatch's card, where
 * it has one. `directory` is the state directory of the repository the dispatch serves, and `sink`
 * is L5's, through which L1 records the dispatch and L0 what it kills, under this dispatch and its
 * card. `clock` reads milliseconds for the dispatch's duration, and is the process's own unless a
 * test gives one. `ps` and `readTimeout` stand in for L0's own where the caller gives them.
 *
 * `workspace`, where the caller gives one, is the card's workspace the dispatch runs in, and `cwd`
 * is then its working directory there. `dispatch.start` names the workspace, the command's
 * environment is `env` less every variable that redirects git (`gitEnvironment`), and a `cwd`
 * whose real path lies outside the workspace starts nothing, as a command that never started
 * (the architect's ruling 1, A7 and A8, on #423). Every `dispatch.start` carries the timeout.
 *
 * The workspace's real path is the dispatch's directory. L1 hands it to L0, whose census kills
 * every process of Rigger's own user working there once the group is empty, and records it in the
 * entry, so a later start does the same (`ARCHITECTURE.md`, "Failure model"). A workspace that is
 * an entry's directory, or lies under one, or holds one, starts nothing, as a command that never
 * started, naming the directory. `lsof` stands in for L0's census tool where the caller gives it.
 *
 * The order is fixed (the architect's ruling 2, §4, on #332): L1 appends `dispatch.start`; shows
 * the record writable; has L0 spawn the command, and writes the entry; L0 runs the command, kills
 * what is left of its group, and settles; L1 removes the entry, appends `dispatch.timeout` where
 * the timeout ended the command, then `dispatch.end`, and settles. Every start L1 records gets
 * exactly one end, which carries the exit code and the duration where the command ran, and why it
 * did not start where it never did.
 *
 * On Rigger's own exit before L1 has recorded the end, whether the command is still running or has
 * exited while the call is in flight, the order is L0's exit cleanup's: L0 kills what is left of
 * the group and records each kill; L1 removes the entry and appends `dispatch.end`, carrying the
 * exit code L0 hands it, which is the command's own where it had exited. Where L0 could not read
 * the command's status, the end carries no exit code, and says as `unread` why. Where the record
 * refuses the removal, the end still goes, saying as `kept` which entry was kept and why. The sink's
 * refusal of that end has no caller left to reach, so L0 writes it to standard error, on a line
 * naming the event, the dispatch and its card. A process kept running past its ending has the call
 * settle as before, and records nothing more of the dispatch.
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
 * emptied the group, which it has done when it settles, or rejects naming a refused event, and on
 * Rigger's own exit, once L0's exit cleanup has killed the group. Any other rejection leaves the
 * entry it wrote, and so does an ending that runs no code, for a later start to settle. Where the record
 * refuses the removal after a refused event, the refusal still reaches the caller, carrying the
 * record's failure as `recordFailure`. Where it refuses the removal after the command settled, the
 * call rejects with a `RECORD_REFUSED` failure carrying the result, and the record's failure as
 * `recordFailure`.
 */
export async function dispatch({ id, card, directory, sink, command, args, cwd, workspace, env, timeout, ps, lsof, readTimeout, clock = () => performance.now() }) {
  // L3 allocates the id (the architect's ruling 1, P4 on #332), and an entry without one could
  // not be told from another dispatch's. Null and the empty string are no id either.
  if (id === undefined || id === null || id === '') throw new Error(`L1 was given no dispatch id, so it did not start ${command}`);
  // An id or card the record would refuse on its next read would refuse every later dispatch and
  // start, so it is refused here, before anything is recorded or started.
  if (!holdsDispatch(id, card)) throw new Error(`L1's record of process groups cannot hold dispatch id ${JSON.stringify(id)} with card ${JSON.stringify(card)}, so it did not start ${command}`);
  const events = sink.emitter({ layer: 'L1', card, dispatch: id });
  const began = clock();
  const start = { command, timeout, ...(workspace === undefined ? {} : { workspace }) };
  try {
    events.emit('dispatch.start', start);
  } catch (cause) {
    throw refused(id, card, [{ event: 'dispatch.start', ...start, cause }]);
  }
  let recorded;
  let result;
  let failure;
  // Whether L1 has recorded the dispatch's end, or is about to in the step it is taking.
  let ended = false;
  try {
    // The record is shown writable before anything starts, by writing it back as it stands, so a
    // dispatch whose group could not be recorded runs no command.
    try {
      writeGroups(directory, readGroups(directory));
    } catch (cause) {
      throw Object.assign(new Error(`L1 cannot write its record of process groups in the state directory ${directory}, so dispatch ${id} did not start ${command}: ${cause.message}`, { cause }), { code: NOT_STARTED });
    }
    // The dispatch's directory, its workspace's real path, as the record names it and L0's census
    // of it compares.
    const { escape, place } = workspace === undefined ? {} : placed(cwd, workspace, directory);
    if (escape !== undefined) throw Object.assign(new Error(`dispatch ${id} did not start ${command}: ${escape}`), { code: NOT_STARTED });
    result = await runCommand({
      command,
      args,
      cwd,
      // In a card's workspace, an inherited redirecting variable would send the command's git to
      // another repository, which is #151's fault (the architect's ruling 1, A7, on #423).
      env: workspace === undefined ? env : gitEnvironment(env),
      timeout,
      ps,
      lsof,
      readTimeout,
      directory: place,
      emitter: sink.emitter({ layer: 'L0', card, dispatch: id }),
      onGroup: (group, started) => {
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
        addGroup(directory, { group, started, dispatch: id, card, ...(place === undefined ? {} : { workspace: place }) });
        recorded = group;
      },
      // On Rigger's own exit, L0 kills and records the group, and then hands it here with how the
      // command ended, its exit code or why its status could not be read, to remove its entry and
      // record the dispatch's end, which says why the entry was kept where the record refused its
      // removal. No caller is left to hear of a
      // refused end, so L0 writes this refusal to standard error. L0 can hand over a dispatch
      // whose end L1 has already recorded, which is left as it is.
      onExit: (group, ending) => {
        if (ended) return;
        ended = true;
        const fields = { ...ending, ms: Math.round(clock() - began) };
        try {
          removeGroup(directory, group);
        } catch (cause) {
          fields.kept = keptEntry(directory, group, cause);
        }
        try {
          events.emit('dispatch.end', fields);
        } catch (cause) {
          throw refused(id, card, [{ event: 'dispatch.end', ...fields, cause }]);
        }
      },
    });
  } catch (thrown) {
    failure = thrown;
    result = thrown.result;
  }
  // The exit cleanup has ended the dispatch, and a process kept running past its ending records
  // nothing more of it.
  if (ended) {
    if (failure !== undefined) throw failure;
    return result;
  }
  ended = true;
  // L0 settles, or rejects with `EVENT_REFUSED`, only once it has emptied the group, so the entry
  // goes. Any other rejection leaves the entry, because L0 has not said the group is empty, and a
  // later start settles it. A removal the record refuses after a refused event rides on the
  // refusal rather than replacing it, so the caller still learns which events went unrecorded.
  // One the record refuses after the command settled carries the result, because the command ran.
  if (recorded !== undefined && (failure === undefined || failure.code === EVENT_REFUSED)) {
    try {
      removeGroup(directory, recorded);
    } catch (recordFailure) {
      const kept = keptEntry(directory, recorded, recordFailure);
      if (failure === undefined) {
        failure = Object.assign(new Error(`${named(id, card)} ran ${command}, which exited ${result.exit}, and ${kept}`), { code: RECORD_REFUSED, result, recordFailure });
      } else {
        failure.message += `\nand ${kept}`;
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
 * Why `cwd` is no directory in `workspace`, or nothing where it is one: its real path is the
 * workspace's, or lies under it. Paths are compared by real path, so a symbolic link out of the
 * workspace is caught, and so is macOS's `/tmp` read as `/private/tmp`.
 *
 * The check and the spawn read the directory at two moments, so a link made between them is not
 * caught, as `unusable` in L0's process adapter says of its own check.
 */
function escapes(cwd, workspace) {
  let real;
  let root;
  try {
    real = realpathSync(cwd);
    root = realpathSync(workspace);
  } catch (cause) {
    return `its working directory ${cwd} in the workspace ${workspace} cannot be read: ${cause.message}`;
  }
  if (real === root || real.startsWith(`${root}${sep}`)) return undefined;
  return `its working directory ${cwd} is ${real}, which lies outside the workspace ${workspace}`;
}

/**
 * The real path of `workspace` as `place`, the directory of a dispatch working in `cwd` there, or
 * as `escape` why it cannot be one now: `cwd` is no directory in it (`escapes`), the workspace
 * cannot be resolved, or an entry in the record in `directory` names a directory that is it, or
 * that it lies under, or that lies under it. L0's census of either would end the other's processes
 * (`ARCHITECTURE.md`, "Failure model"). Paths are compared by real path, as `escapes` compares them.
 */
function placed(cwd, workspace, directory) {
  const escape = escapes(cwd, workspace);
  if (escape !== undefined) return { escape };
  let place;
  try {
    place = realpathSync.native(workspace);
  } catch (cause) {
    return { escape: `its workspace ${workspace} cannot be read: ${cause.message}` };
  }
  const within = (inner, outer) => inner === outer || inner.startsWith(`${outer}${sep}`);
  const holder = readGroups(directory).find((entry) => entry.workspace !== undefined && (within(place, entry.workspace) || within(entry.workspace, place)));
  if (holder === undefined) return { place };
  return { escape: `its directory ${place} is held by ${named(holder.dispatch, holder.card)}, whose entry in the record names ${holder.workspace}` };
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

/** What L1 says of the record in `directory` keeping `group`'s entry, its removal refused by `failure`. */
const keptEntry = (directory, group, failure) => `the record of process groups in ${directory} kept the entry for group ${group}: ${failure.message}`;

/** Dispatch `id` as a failure names it, with its card where it has one. */
const named = (id, card) => `dispatch ${id}${card === undefined ? '' : `, card #${card}`}`;

/**
 * The failure for dispatch `id`, of `card` where it has one, whose `unrecorded` L1 events the sink
 * refused, each on a line of its own naming the dispatch and card, its fields and why, carrying the
 * dispatch's `result` where its command ran. Its `code` tells the caller it from a command that
 * never started without reading the message.
 */
function refused(id, card, unrecorded, result) {
  const under = named(id, card);
  const lines = unrecorded.map(({ event, cause, ...fields }) => `${event} of ${under} ${JSON.stringify(fields)}: ${cause.message}`);
  return Object.assign(new Error(`the sink refused ${unrecorded.length} L1 event(s) of ${under}, so they went unrecorded:\n${lines.join('\n')}`), { code: EVENT_REFUSED, unrecorded, result });
}

/**
 * Ends what a dead engine left: each process group the record in `directory` names, where L0
 * confirms the group is the one recorded, recording each kill through `sink` under the entry's
 * dispatch and card (`ARCHITECTURE.md`, "Failure model"), and where the entry names the dispatch's
 * directory, every process working there. `ps`, `lsof` and `readTimeout` stand in for L0's own
 * where the caller gives them.
 *
 * A record that cannot be read as entries fails whole, naming its file, before anything is killed.
 * Every entry is tried whatever became of those before it. Afterwards the record keeps only the
 * entries whose group L0 could not confirm, because a later start may: L0 has confirmed every
 * other group empty, killed it, or found it is not the one recorded. The call then rejects naming
 * each entry it kept and each kill the sink refused, with its dispatch id and card. A group whose
 * kill went unrecorded is dead, so its entry goes too: keeping it would record nothing later
 * (the architect's ruling 2, §5, on #332). Where the record then refuses its rewrite, that
 * failure is added to the rejection and carried on it as `recordFailure`.
 *
 * Once every entry has been acted on, the partial file a writer stopped before its rename left
 * beside the record goes, because `.rigger/` holds no file but the three things `ARCHITECTURE.md`
 * names ("Failure model"). Where it cannot be removed, the call appends an L1 `record.partial-kept`
 * event naming it and why, and fails on that alone only where the sink refuses the event.
 */
export async function killRecordedGroups({ directory, sink, ps, lsof, readTimeout }) {
  const entries = readGroups(directory);
  let failure;
  try {
    await killEntries({ directory, sink, ps, lsof, readTimeout, entries });
  } catch (thrown) {
    failure = thrown;
  }
  // The partial file goes once every entry has been acted on, so one that cannot be removed stops
  // no kill. Its removal is not the start's to fail on, because nothing reads it: the call records
  // why it stayed, and fails only where the sink refuses that.
  try {
    removePartial(directory);
  } catch (cause) {
    const kept = { path: partialPath(directory), reason: cause.message };
    try {
      sink.emitter({ layer: 'L1' }).emit('record.partial-kept', kept);
    } catch (refusal) {
      const unrecorded = `the sink refused L1's record.partial-kept ${JSON.stringify(kept)}, so it went unrecorded: ${refusal.message}`;
      if (failure === undefined) failure = new Error(unrecorded);
      else failure.message += `\nand ${unrecorded}`;
    }
  }
  if (failure !== undefined) throw failure;
}

/** Acts on each of the record's `entries`, as `killRecordedGroups` says. */
async function killEntries({ directory, sink, ps, lsof, readTimeout, entries }) {
  if (entries.length === 0) return;
  const kept = [];
  const unconfirmed = [];
  const unrecorded = [];
  for (const entry of entries) {
    const { group, started, dispatch, card, workspace } = entry;
    const under = named(dispatch, card);
    try {
      await killRecordedGroup({ group, started, directory: workspace, ps, lsof, readTimeout, emitter: sink.emitter({ layer: 'L0', card, dispatch }) });
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
