// ABOUTME: L1's record of the process group each running dispatch holds, one file in the state
// directory, so that a later start can end what a dead engine left.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RECORD = 'groups.json';

/** The record's file, inside the state directory the caller names. */
export const recordPath = (directory) => join(directory, RECORD);

/** Every entry the record in `directory` holds, or none where there is no record. */
export function readGroups(directory) {
  let text;
  try {
    text = readFileSync(recordPath(directory), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return JSON.parse(text);
}

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
