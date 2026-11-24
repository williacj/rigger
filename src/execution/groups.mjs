// ABOUTME: L1's record of the process group each running dispatch holds, one file in the state
// directory, including signs a settled dispatch leaves for the next start to resolve.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { atExit } from '../substrate/process.mjs';
import { writeWhole } from '../substrate/standard-error.mjs';
import { processSigns } from '../substrate/process.mjs';
import { isAbsolute, join } from 'node:path';

const RECORD = 'groups.json';
const written = new Map();
const failedWrites = new Map();

/** The record's file, inside the state directory the caller names. */
export const recordPath = (directory) => join(directory, RECORD);

/** The file a write of the record in `directory` fills before it renames it over the record. */
export const partialPath = (directory) => `${recordPath(directory)}.partial`;

/**
 * Every entry the record in `directory` holds, or none where there is no record. A record whose
 * content is not a list of entries fails whole, naming its file, so nothing acts on part of it.
 */
export const readGroups = (directory) => readEntries(recordPath(directory));

/** Reads an unfinished write without removing or replacing it. */
export const readPartial = (directory) => readEntries(partialPath(directory));

/** Validates a whole record before any entry reaches a caller. */
function readEntries(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  let entries;
  try {
    entries = JSON.parse(text);
  } catch (cause) {
    throw new Error(`L1's record of process groups ${path} cannot be read as entries: ${cause.message}`, { cause });
  }
  const unreadable = Array.isArray(entries) ? entries.find((entry) => !isEntry(entry)) : entries;
  if (!Array.isArray(entries) || unreadable !== undefined) {
    throw new Error(`L1's record of process groups ${path} cannot be read as entries: it holds ${JSON.stringify(unreadable)}`);
  }
  return entries;
}

/**
 * Whether `entry` names a group a dispatch can hold, the start of its leader, the dispatch's
 * directory by an absolute path where it has one, with its device and inode as decimal strings
 * where it has them, its scratch directory as `scratch`, an absolute `path` with its device and
 * inode likewise, where it has one, its tracked processes as `tracked` where it has any, and a
 * dispatch the record can hold. No group
 * Rigger creates has an id of 1 or less, and L0 signals a group by its id negated, so 1, 0 or a
 * negative id would reach launchd, the caller's own group, or every process.
 */
const isEntry = (entry) => typeof entry === 'object' && entry !== null
  && Number.isSafeInteger(entry.group) && entry.group > 1
  && Number.isSafeInteger(entry.started)
  && (entry.workspace === undefined || (typeof entry.workspace === 'string' && isAbsolute(entry.workspace)))
  && [entry.device, entry.inode].every(isDecimal)
  && (entry.scratch === undefined || (typeof entry.scratch === 'object' && entry.scratch !== null && typeof entry.scratch.path === 'string' && isAbsolute(entry.scratch.path) && [entry.scratch.device, entry.scratch.inode].every(isDecimal)))
  && (entry.tracked === undefined || (Array.isArray(entry.tracked) && entry.tracked.every(isTracked)))
  && (entry.settled === undefined || typeof entry.settled === 'boolean')
  && (entry.unended === undefined || (Array.isArray(entry.unended) && entry.unended.every(isUnended)))
  && (entry.unread === undefined || (Array.isArray(entry.unread) && entry.unread.every(isUnread)))
  && holdsDispatch(entry.dispatch, entry.card);

/**
 * Whether `each` names a tracked process by a pid L0 may signal and its start time. A pid of 1 or
 * less would reach launchd, the caller's own group, or every process, as a group's id would.
 */
const isTracked = (each) => typeof each === 'object' && each !== null && Number.isSafeInteger(each.pid) && each.pid > 1 && Number.isSafeInteger(each.started);

/** Whether `field` is absent or a decimal string, as a device or an inode is recorded. */
const isDecimal = (field) => field === undefined || (typeof field === 'string' && /^\d+$/.test(field));

/**
 * Whether the record can hold dispatch `id` of `card`: an id is a string that is not empty, and a
 * card is an issue number, where there is one. L1 asks before it starts a dispatch, because an
 * entry the record would refuse on its next read would refuse every later dispatch and start.
 */
export const holdsDispatch = (id, card) => typeof id === 'string' && id !== ''
  && (card === undefined || (Number.isSafeInteger(card) && card > 0));

/**
 * Replaces the record in `directory` with `entries`.
 *
 * The whole record is written beside it and renamed over it, so a reader finds it as it was
 * before the write or as it is after, never part of one: a rename within one directory replaces
 * the name in one step (POSIX `rename`). A writer stopped before the rename leaves the partial
 * file beside the record. A start reads it before reaping and replaces it with its kept entries. Nothing
 * is flushed to the disk, as in L5's stream: what this buys is surviving the engine's death, not
 * the machine's.
 */
export function writeGroups(directory, entries, options = {}) {
  try {
    mkdirSync(directory, { recursive: true });
    const partial = partialPath(directory);
    const text = JSON.stringify(entries);
    writeFileSync(partial, text);
    renameSync(partial, recordPath(directory));
    written.set(directory, JSON.parse(text));
  } catch (cause) {
    const before = new Set((written.get(directory) ?? []).filter(isEntry).flatMap(processesOf).map(keyOf));
    const failures = failedWrites.get(directory) ?? [];
    for (const entry of entries.filter(isEntry)) {
      const processes = processesOf(entry).filter((each) => !before.has(keyOf(each)));
      if (processes.length > 0) failures.push({ entry, processes, reason: cause.message, options });
    }
    if (failures.length > 0) failedWrites.set(directory, failures);
    throw cause;
  }
}

/** The identities a record names, including its group leader. */
const processesOf = (entry) => [{ pid: entry.group, started: entry.started }, ...(entry.tracked ?? []), ...(entry.unended ?? [])];
const keyOf = ({ pid, started }) => `${pid}:${started}`;

/** A failed write remains a sign until L0's successful whole-table read shows its omitted processes gone. */
export function failedWriteSigns(directory, options = {}) {
  const failures = failedWrites.get(directory) ?? [];
  for (const failure of failures) failure.processes = processSigns(failure.processes, { ...failure.options, ...options }).unended;
  const standing = failures.filter(({ processes }) => processes.length > 0);
  if (standing.length === 0) failedWrites.delete(directory);
  else failedWrites.set(directory, standing);
  return standing.map(({ reason }) => ({ kind: 'write', path: recordPath(directory), reason }));
}

/** Adds `entry` to the record in `directory`. */
export const addGroup = (directory, entry) => writeGroups(directory, [...readGroups(directory), entry]);

/** Names the tracked processes `added` in the entry for `group` in the record in `directory`, after those it names. */
export const addTracked = (directory, group, added, options) => writeGroups(directory, readGroups(directory).map((entry) => (entry.group === group ? { ...entry, tracked: [...(entry.tracked ?? []), ...added] } : entry)), options);

/** Signs held by entries, in L3's reporting vocabulary. */
export const entrySigns = (entries) => entries.flatMap((entry) => [
  ...(entry.unended ?? []).map(({ pid, name, cmd }) => ({ kind: 'unended', pid, name, cmd })),
  ...(entry.unread ?? []).map(({ kind, reason, ...identity }) => ({ kind: 'read', reason, ...(kind === 'dispatch' ? { dispatch: entry.dispatch } : kind === 'group' ? { group: identity.group } : { directory: identity.directory }) })),
]);

/** The refusal whose command a sign kept from starting. */
export const SIGN_STOPPED = 'SIGN_STOPPED';

/** A refusal distinct from an environment failure; L3 counts no attempt for it. */
export const signFailure = (signs) => Object.assign(new Error(`signs of an earlier dispatch's process: ${JSON.stringify(signs)}`), { code: SIGN_STOPPED, signs });

/** Keeps a dispatch's signs after its containment settles. */
export function settleGroup(directory, group, signs = {}) {
  const entries = readGroups(directory).flatMap((entry) => {
    if (entry.group !== group) return [entry];
    const unended = [...(entry.unended ?? []), ...(signs.unended ?? [])];
    const unread = [...(entry.unread ?? []), ...(signs.unread ?? [])];
    return unended.length + unread.length === 0 ? [] : [{ ...entry, settled: true, ...(unended.length > 0 ? { unended } : {}), ...(unread.length > 0 ? { unread } : {}) }];
  });
  writeGroups(directory, entries);
}

/** The normal exit makes omitted processes durable, without marking budget-limited cleanup settled. */
atExit(() => {
  for (const directory of failedWrites.keys()) {
    const signs = failedWriteSigns(directory);
    if (signs.length === 0) continue;
    try {
      const entries = readGroups(directory);
      for (const { entry, processes } of failedWrites.get(directory)) {
        let kept = entries.find(({ group }) => group === entry.group);
        if (kept === undefined) { kept = { ...entry }; entries.push(kept); }
        kept.unended = [...new Map([...(kept.unended ?? []), ...processes].map((each) => [keyOf(each), each])).values()];
      }
      writeGroups(directory, entries);
    } catch (cause) { signs.push({ kind: 'write', path: recordPath(directory), reason: cause.message }); }
    writeWhole(`${signFailure(signs).message}\n`);
  }
});

/** Sign identities may omit a start time only where no read gave one. */
const isUnended = (each) => each !== null && typeof each === 'object' && Number.isSafeInteger(each.pid) && each.pid > 1
  && (each.started === undefined || Number.isSafeInteger(each.started)) && [each.name, each.cmd].every((field) => field === undefined || typeof field === 'string');
const isUnread = (each) => each !== null && typeof each === 'object' && typeof each.reason === 'string'
  && (each.kind === 'dispatch' || (each.kind === 'group' && Number.isSafeInteger(each.group) && each.group > 1)
    || (each.kind === 'directory' && typeof each.directory === 'string' && isAbsolute(each.directory)));
