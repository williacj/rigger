// ABOUTME: L1's record of the process group each running dispatch holds, one file in the state
// directory, so that a later start can end what a dead engine left.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RECORD = 'groups.json';

/** The record's file, inside the state directory the caller names. */
export const recordPath = (directory) => join(directory, RECORD);

/**
 * Every entry the record in `directory` holds, or none where there is no record. A record whose
 * content is not a list of entries fails whole, naming its file, so nothing acts on part of it.
 */
export function readGroups(directory) {
  const path = recordPath(directory);
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
 * Whether `entry` names a group a dispatch can hold, the start of its leader, and its dispatch.
 * No group Rigger creates has an id of 1 or less, and L0 signals a group by its id negated, so
 * 1, 0 or a negative id would reach launchd, the caller's own group, or every process.
 */
const isEntry = (entry) => typeof entry === 'object' && entry !== null
  && Number.isSafeInteger(entry.group) && entry.group > 1
  && Number.isSafeInteger(entry.started)
  && typeof entry.dispatch === 'string' && entry.dispatch !== '';

/**
 * Replaces the record in `directory` with `entries`.
 *
 * The whole record is written beside it and renamed over it, so a reader finds it as it was
 * before the write or as it is after, never part of one: a rename within one directory replaces
 * the name in one step (POSIX `rename`). A writer stopped before the rename leaves the partial
 * file beside the record, and the next write replaces it. Nothing is flushed to the disk, as in
 * L5's stream: what this buys is surviving the engine's death, not the machine's.
 */
export function writeGroups(directory, entries) {
  mkdirSync(directory, { recursive: true });
  const partial = `${recordPath(directory)}.partial`;
  writeFileSync(partial, JSON.stringify(entries));
  renameSync(partial, recordPath(directory));
}

/** Adds `entry` to the record in `directory`. */
export const addGroup = (directory, entry) => writeGroups(directory, [...readGroups(directory), entry]);

/** Removes the entry for `group` from the record in `directory`. */
export const removeGroup = (directory, group) => writeGroups(directory, readGroups(directory).filter((entry) => entry.group !== group));
