// ABOUTME: L1 records each dispatch around L0's process adapter, sweeps its provider folder after
// L0 settles, and kills groups a dead engine left in its record.

import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';

import { addGroup, addTracked, holdsDispatch, recordPath, partialPath, readGroups, writeGroups } from './groups.mjs';
import { failedWriteSigns, readPartial, entrySigns, signFailure, settleGroup } from './groups.mjs';
import { listCliFolder, sweepCliFolder } from './workspace.mjs';
import { gitEnvironment } from '../substrate/git-environment.mjs';
import { EVENT_REFUSED, NOT_STARTED, identityOf, killRecordedGroup, runCommand } from '../substrate/process.mjs';
import { processSigns } from '../substrate/process.mjs';
import { startFailure } from '../substrate/process.mjs';

/**
 * The `code` of the failure a dispatch rejects with when its command ran and the record refused
 * its entry's removal, so its caller tells it from a command that never started and from a refused
 * event without reading the message.
 */
export const RECORD_REFUSED = 'RECORD_REFUSED';

/**
 * Runs one dispatch through L0, pairing every recorded start with its end and preserving the
 * command's exit code and output through refused events and containment that leaves a sign.
 * `workspace` and `scratch` identify the dispatch's directories, `folder` its provider folder,
 * and `facts` and `digest` the evidence L2 composed. A workspace's command inherits `gitEnvironment`.
 *
 * The record is checked before its writability probe, after workspace placement and immediately
 * before L0's synchronous spawn. A sign refuses the command without classing an environment
 * failure. L0 hands containment signs through `onSigns` before emitting events; L1 retains their
 * entry even where the sink refuses those events. Each outcome carries the signs still standing.
 *
 * Once whole containment settles, an entry without a sign goes; one kept for its signs is marked
 * `settled`. Exit cleanup past its budget keeps the entry unmarked. `dispatch.end.kept` describes
 * an unsearched directory or a record write refused, not ordinary sign retention. Provider-folder
 * sweeping and event refusals preserve the command result as before. ARCHITECTURE.md, "Signs of
 * an earlier dispatch's process", owns the ordering and removal conditions.
 */
export async function dispatch({ id, card, directory, sink, provider, command, args, input, cwd, workspace, scratch, env, folder, timeout, facts, digest, host, readTimeout, clock = () => performance.now() }) {
  // L3 allocates the id (the architect's ruling 1, P4 on #332), and an entry without one could
  // not be told from another dispatch's. Null and the empty string are no id either.
  if (id === undefined || id === null || id === '') throw startFailure(Object.assign(new Error(`L1 was given no dispatch id, so it did not start ${command}`), { code: NOT_STARTED }), 'dispatch-identity');
  // An id or card the record would refuse on its next read would refuse every later dispatch and
  // start, so it is refused here, before anything is recorded or started.
  if (!holdsDispatch(id, card)) throw startFailure(Object.assign(new Error(`L1's record of process groups cannot hold dispatch id ${JSON.stringify(id)} with card ${JSON.stringify(card)}, so it did not start ${command}`), { code: NOT_STARTED }), 'dispatch-identity');
  const events = sink.emitter({ layer: 'L1', card, dispatch: id });
  const began = clock();
  const start = { command, timeout, ...(workspace === undefined ? {} : { workspace }), ...(facts === undefined ? {} : { facts }), ...(digest === undefined ? {} : { digest }) };
  try {
    events.emit('dispatch.start', start);
  } catch (cause) {
    throw refused(id, card, [{ event: 'dispatch.start', ...start, cause }]);
  }
  let recorded;
  let attemptedEntry;
  let folderListing;
  let result;
  let failure;
  let containmentSigns;
  // Whether L1 has recorded the dispatch's end, or is about to in the step it is taking.
  let ended = false;
  try {
    // The record is shown writable before anything starts, by writing it back as it stands, so a
    // dispatch whose group could not be recorded runs no command.
    const entries = startingGroups(directory, { host, readTimeout });
    try {
      writeGroups(directory, entries);
    } catch (cause) {
      throw startFailure(Object.assign(new Error(`L1 cannot write its record of process groups in the state directory ${directory}, so dispatch ${id} did not start ${command}: ${cause.message}`, { cause }), { code: NOT_STARTED }), 'groups-unwritable');
    }
    // The dispatch's directory, its workspace's real path, as the record names it and L0's census
    // of it compares.
    const { escape, place, identity, startCause } = workspace === undefined ? {} : dispatchPlacement(cwd, workspace, directory);
    if (escape !== undefined) throw Object.assign(new Error(`dispatch ${id} did not start ${command}: ${escape}`), { code: NOT_STARTED, startCause });
    // A role's scratch directory, by its real path, device and inode, as the record names it and
    // L0's census of it compares (the architect's ruling 20 on #467).
    const { unread, held } = scratch === undefined ? {} : scratchHeld(scratch);
    if (unread !== undefined) throw startFailure(Object.assign(new Error(`dispatch ${id} did not start ${command}: ${unread}`), { code: NOT_STARTED }), 'directory-unusable');
    if (folder !== undefined) folderListing = listCliFolder(folder);
    startingGroups(directory, { host, readTimeout });
    result = await runCommand({
      command,
      args,
      input,
      cwd,
      // In a card's workspace, an inherited redirecting variable would send the command's git to
      // another repository, which is #151's fault (the architect's ruling 1, A7, on #423).
      env: workspace === undefined ? env : gitEnvironment(env),
      timeout,
      host,
      readTimeout,
      track: true,
      directory: place,
      scratch: held?.path,
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
        attemptedEntry = { group, started, dispatch: id, card, ...(place === undefined ? {} : { workspace: place, ...identity }), ...(held === undefined ? {} : { scratch: held }) };
        addGroup(directory, attemptedEntry);
        recorded = group;
      },
      // Each process L0's tracker adds is named in the entry, so a later start ends it after Rigger
      // was killed outright or its exit ran past its budget. A rewrite that fails leaves it
      // tracked in L0's memory alone ("Failure model").
      onTracked: (group, added) => addTracked(directory, group, added, { host, readTimeout }),
      onSigns: (group, signs) => {
        containmentSigns = signs;
        if (recorded === undefined && attemptedEntry !== undefined) {
          try { writeGroups(directory, [...readGroups(directory), { ...attemptedEntry, ...signs, settled: true }], { host, readTimeout }); }
          catch { /* The writer retains the omitted processes in its failed-write memory. */ }
        }
      },
      // On Rigger's own exit, L0 kills and records the group, and then hands it here with how the
      // command ended, its exit code or why its status could not be read, to remove its entry and
      // record the dispatch's end, which says why the entry was kept where the record refused its
      // removal. No caller is left to hear of a
      // refused end, so L0 writes this refusal to standard error. L0 can hand over a dispatch
      // whose end L1 has already recorded, which is left as it is.
      onExit: (group, { unswept, ...ending }) => {
        if (ended) return;
        ended = true;
        const fields = { ...ending, ms: Math.round(clock() - began) };
        if (folder !== undefined) fields.folderLeft = [unsweptFolder(folder, folderListing, 'Rigger exited before the CLI folder sweep')];
        try {
          // A group L0 killed bare has directories nothing swept, so the next start's kill needs its entry.
          if (unswept === undefined) settleGroup(directory, group, containmentSigns);
          else fields.kept = keptEntry(directory, group, { message: unswept });
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
    if (failure.startCause?.command !== undefined) {
      const { command: named, ...cause } = failure.startCause;
      failure.startCause = { ...cause, provider: provider ?? named };
    }
    result = thrown.result;
  }
  // The exit cleanup has ended the dispatch, and a process kept running past its ending records
  // nothing more of it.
  if (ended) {
    if (failure !== undefined) throw failure;
    return result;
  }
  ended = true;
  // Whole containment keeps only the dispatch's remaining signs. A failure before containment
  // settles keeps the running entry for the next start. A refused rewrite accompanies the
  // original event refusal, or carries the result where the command ran.
  if (recorded !== undefined && (failure === undefined || failure.code === EVENT_REFUSED)) {
    try {
      settleGroup(directory, recorded, containmentSigns);
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
  const folderLeft = folder === undefined ? [] : folderListing === undefined
    ? [unsweptFolder(folder, folderListing, `L1 did not list or sweep its CLI folder: ${failure.message}`)]
    : result === undefined
    ? [unsweptFolder(folder, folderListing, `the command did not start or settle, so its CLI folder was not swept: ${failure.message}`)]
    : sweepCliFolder(folderListing);
  const folderFields = folderLeft.length === 0 ? {} : { folderLeft };
  record('dispatch.end', result === undefined ? { reason: failure.message, ms, ...folderFields } : { exit: result.exit, ms, ...folderFields });
  if (unrecorded.length > 0) failure = alongside(failure, refused(id, card, unrecorded, result));
  const signs = failure?.signs ?? signsStanding(directory, { host, readTimeout });
  if (signs.length > 0) {
    if (failure !== undefined) failure.signs = signs;
    else result = { ...result, signs };
  }
  if (failure !== undefined) throw failure;
  return result;
}

/** The safe folder path, where one can be named, and why L1 left it without a sweep. */
function unsweptFolder(folder, listing, reason) {
  const { home, name } = folder;
  const path = listing?.path ?? (typeof home === 'string' && isAbsolute(home) && typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !name.includes(sep)
    ? join(home, 'projects', name) : undefined);
  return { ...(path === undefined ? {} : { path }), reason };
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
    return { escape: `its working directory ${cwd} in the workspace ${workspace} cannot be read: ${cause.message}`, startCause: { kind: 'directory-unusable' } };
  }
  if (within(real, root)) return undefined;
  return { escape: `its working directory ${cwd} is ${real}, which lies outside the workspace ${workspace}`, startCause: { kind: 'working-directory-outside' } };
}

/**
 * The real path of `workspace` as `place`, the directory of a dispatch working in `cwd` there, with
 * its device and inode as `identity`, which a later start checks before it sweeps it; or
 * as `escape` why it cannot be one now: `cwd` is no directory in it (`escapes`), the workspace
 * cannot be resolved, or an entry in the record in `directory` names a directory that is it, or
 * that it lies under, or that lies under it. L0's census of either would end the other's processes
 * (`ARCHITECTURE.md`, "Failure model"). Paths are compared by real path, as `escapes` compares them.
 */
function dispatchPlacement(cwd, workspace, directory) {
  const escape = escapes(cwd, workspace);
  if (escape !== undefined) return escape;
  let place;
  let identity;
  try {
    place = realpathSync.native(workspace);
    identity = identityOf(place);
  } catch (cause) {
    return { escape: `its workspace ${workspace} cannot be read: ${cause.message}`, startCause: { kind: 'directory-unusable' } };
  }
  const entries = startingGroups(directory);
  const holder = entries.find((entry) => entry.workspace !== undefined && (within(place, entry.workspace) || within(entry.workspace, place)));
  if (holder === undefined) return { place, identity };
  return { escape: `its directory ${place} is held by ${named(holder.dispatch, holder.card)}, whose entry in the record names ${holder.workspace}`, startCause: { kind: 'directory-occupied' } };
}

/** Reads the groups before a dispatch starts, including a reread after the writability check. */
function startingGroups(directory, options = {}) {
  try {
    const entries = readGroups(directory);
    const signs = [...entrySigns(entries), ...failedWriteSigns(directory, options)];
    if (signs.length > 0) throw signFailure(signs);
    return entries;
  } catch (cause) {
    if (cause.signs !== undefined) throw cause;
    throw signFailure([{ kind: 'record', path: recordPath(directory), reason: cause.message }]);
  }
}

/**
 * The scratch directory `scratch` as `held`, its real path as `path` with its device and inode,
 * which a later start checks before it sweeps it, or as `unread` why it cannot be read.
 */
function scratchHeld(scratch) {
  try {
    const path = realpathSync.native(scratch);
    return { held: { path, ...identityOf(path) } };
  } catch (cause) {
    return { unread: `its scratch directory ${scratch} cannot be read: ${cause.message}` };
  }
}

/** Whether the path `inner` is `outer` or lies under it, each a real path. */
export const within = (inner, outer) => inner === outer || inner.startsWith(`${outer}${sep}`);

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
 * Reaps a previous run's record, reading both it and an unfinished write before acting on either.
 * Every entry is tried. Settled entries owe only their signs; the rest owe their whole cleanup.
 * A successful rewrite retains only outstanding signs and entries whose group was unconfirmed.
 * An unreadable file is untouched and kills nothing. A surviving sign refuses all work at this
 * start. ARCHITECTURE.md, "Signs of an earlier dispatch's process", gives the start's steps.
 */
export async function killRecordedGroups({ directory, sink, host, readTimeout }) {
  let entries;
  let partial;
  let path = recordPath(directory);
  try {
    entries = readGroups(directory);
    path = partialPath(directory);
    if (existsSync(path)) partial = readPartial(directory);
  } catch (cause) { throw signFailure([{ kind: 'record', path, reason: cause.message }]); }
  if (partial !== undefined) {
    for (const added of partial) {
      const at = entries.findIndex((entry) => entry.group === added.group);
      if (at < 0) entries.push(added);
      else {
        const entry = entries[at];
        entries[at] = { ...entry, ...added };
        for (const field of ['tracked', 'unended', 'unread']) if (entry[field] !== undefined || added[field] !== undefined) entries[at][field] = [...new Map([...(entry[field] ?? []), ...(added[field] ?? [])].map((each) => [JSON.stringify(each), each])).values()];
      }
    }
  }
  try { await killEntries({ directory, sink, host, readTimeout, entries, partial }); }
  catch (failure) {
    if (partial !== undefined && failure.signs !== undefined) {
      failure.signs.push({ kind: 'write', path: recordPath(directory), reason: 'an unfinished write named processes not shown gone' });
      failure.message = signFailure(failure.signs).message;
    }
    throw failure;
  }
}

/** Acts on each of the record's `entries`, as `killRecordedGroups` says. */
async function killEntries({ directory, sink, host, readTimeout, entries, partial }) {
  if (entries.length === 0 && partial === undefined) return;
  const kept = [];
  const unconfirmed = [];
  const unrecorded = [];
  for (const entry of entries) {
    const { group, started, dispatch, card, workspace, device, inode, scratch, tracked } = entry;
    const under = named(dispatch, card);
    let observed = {};
    try {
      await killRecordedGroup({ group, started, tracked, settled: entry.settled, unended: entry.unended, unread: entry.unread, onSigns: (_group, signs) => { observed = signs; }, directory: workspace, identity: { device, inode }, scratch, host, readTimeout, emitter: sink.emitter({ layer: 'L0', card, dispatch }) });
    } catch (failure) {
      if (failure.code !== EVENT_REFUSED) {
        kept.push(entry);
        unconfirmed.push(`the entry for group ${group}, ${under}: ${failure.message}`);
        continue;
      }
      for (const { event, cause, ...fields } of failure.unrecorded) unrecorded.push(`${under}: ${event} ${JSON.stringify(fields)}: ${cause.message}`);
    }
    const candidates = [...(entry.unended ?? []), ...(observed.unended ?? [])];
    const unended = candidates.length === 0 ? [] : processSigns([...new Map(candidates.map((each) => [each.pid, each])).values()], { host, readTimeout }).unended;
    const unread = observed.unread ?? [];
    if (unended.length + unread.length > 0) kept.push({ ...entry, settled: true, unended, unread });
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
  const signs = entrySigns(kept);
  if (signs.length > 0) failures.push(signFailure(signs).message);
  if (failures.length > 0) throw Object.assign(new Error(failures.join('\n')), { recordFailure, ...(signs.length > 0 ? { signs } : {}) });
}

/** L1's synchronous read at a claim or after a dispatch, including an unreadable record itself. */
export function signsStanding(directory, options = {}) {
  try {
    return [...entrySigns(readGroups(directory).map((entry) => ({ ...entry, unended: entry.unended?.length > 0 ? processSigns(entry.unended, options).unended : [] }))), ...failedWriteSigns(directory, options)];
  } catch (cause) {
    return [{ kind: 'record', path: recordPath(directory), reason: cause.message }];
  }
}
