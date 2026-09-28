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

/** Replaces the record in `directory` with `entries`. */
export function writeGroups(directory, entries) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(recordPath(directory), JSON.stringify(entries));
}

/** Adds `entry` to the record in `directory`. */
export const addGroup = (directory, entry) => writeGroups(directory, [...readGroups(directory), entry]);

/** Removes the entry for `group` from the record in `directory`. */
export const removeGroup = (directory, group) => writeGroups(directory, readGroups(directory).filter((entry) => entry.group !== group));
