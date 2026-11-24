#!/usr/bin/env node
// ABOUTME: Refuses a push that would publish content of four shapes or an entry of the owner's
// private list, read off what `pre-push` was handed. It reads every commit, tag and ref name the
// push adds, and a refusal names a row and a place and never what it matched.
//
// The rows, the list and what is read are card #1486's. A host without the list can push nothing
// but a deletion. The limits, none of which it sees past:
//
// - the web editor, API commits, the forge's own merge commit, CI logs, the engine's data-ref push,
//   which uses `--no-verify`, a push to another repository or gist, and a host without the hook;
// - a clone that runs its own branch's copy, where that branch edits the code or was cut before it;
// - a default-branch tracking ref that did not come from that remote, which can pass content unread;
// - `HOME`, `PATH`, `GIT_*` and `core.hooksPath`, which can redirect it;
// - base64, hexadecimal, an image, an archive, a listing with no header or a translated one, a file
//   split to stay under C4, and a list that is out of date.
//
// A clean result is no privacy check under #1485.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** C1: an account's SID. The prefix alone, with no digit after it, is prose and passes. */
const ACCOUNT_ID = /(?:S-1-5-21-|S-1-12-1-)\d/i;

const LOCAL = /[A-Za-z0-9._%+-]/;
const DOMAIN = /(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/y;
const RESERVED = /\.(?:example|test|invalid|localhost)$|^example\.(?:com|net|org)$/;
const UNIT = /\.(?:service|scope|slice|socket|target|timer)$/;

/**
 * C2: whether the line holds an address C2's passing cell does not cover. It walks out from each
 * `@`, so two addresses that overlap are both read, and no character is read again for a pattern
 * that does not match, which would be quadratic on a long line.
 */
function holdsAddress(line) {
  for (let at = line.indexOf('@'); at !== -1; at = line.indexOf('@', at + 1)) {
    let start = at;
    while (start > 0 && LOCAL.test(line[start - 1])) start -= 1;
    if (start === at) continue;
    DOMAIN.lastIndex = at + 1;
    const found = DOMAIN.exec(line);
    if (!found) continue;
    const local = line.slice(start, at).toLowerCase();
    const domain = found[0].toLowerCase();
    if (local === 'noreply' || local === 'no-reply' || domain === 'users.noreply.github.com') continue;
    if (RESERVED.test(domain) || UNIT.test(domain) || /^\d/.test(domain) || line[DOMAIN.lastIndex] === ':') continue;
    return true;
  }
  return false;
}

const word = (...names) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names.join('|')})(?![\\p{L}\\p{N}_])`, 'u');
const ID_COLUMN = word('PID', 'ProcessId');
const BARE_ID_COLUMN = word('Id');
const NAME_COLUMN = word('ProcessName');
const COMMAND_COLUMN = word(
  'COMMAND', 'CMD', 'COMM', 'ARGS', 'Image Name', 'ProcessName', 'CommandLine', 'ExecutablePath',
);

/** C3: whether the line is a process table's header, by its process-id and command column names. */
const holdsProcessHeader = (line) => (ID_COLUMN.test(line) && COMMAND_COLUMN.test(line))
  || (BARE_ID_COLUMN.test(line) && NAME_COLUMN.test(line));

const WORD = /[\p{L}\p{N}]+/gu;
const ASCII = /^[\x00-\x7f]*$/;

/**
 * Text as C5 compares it: in NFC, with each character folded alone. A whole string's lowercase
 * turns on the letters around a Greek sigma, so an entry and a line that holds it could differ.
 */
function folded(text) {
  if (ASCII.test(text)) return text.toLowerCase();
  return Array.from(text.normalize('NFC'), (character) => Array.from(character.toLowerCase().toUpperCase(), (one) => one.toLowerCase()).join('')).join('');
}

/** The list's entries by the first word each holds, so a line looks up its own words only. */
const indexes = new WeakMap();
function indexOf(entries) {
  let index = indexes.get(entries);
  if (!index) {
    index = new Map();
    for (const { text } of entries) {
      const [first] = text.matchAll(WORD);
      const key = first?.[0] ?? '';
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ text, offset: first?.index ?? 0 });
    }
    indexes.set(entries, index);
  }
  return index;
}

const BEFORE = /[\p{L}\p{N}]$/u;
const AFTER = /^[\p{L}\p{N}]/u;
const standsAt = (line, text, start) => start >= 0 && line.startsWith(text, start)
  && !BEFORE.test(line.slice(Math.max(0, start - 2), start))
  && !AFTER.test(line.slice(start + text.length, start + text.length + 2));

/** C5: whether the line holds an entry that is no part of a longer word. */
function holdsEntry(line, entries) {
  if (entries.length === 0) return false;
  const index = indexOf(entries);
  const text = folded(line);
  for (const { 0: found, index: start } of text.matchAll(WORD)) {
    if (index.get(found)?.some((entry) => standsAt(text, entry.text, start - entry.offset))) return true;
  }
  return (index.get('') ?? []).some((entry) => {
    for (let start = text.indexOf(entry.text); start !== -1; start = text.indexOf(entry.text, start + 1)) {
      if (standsAt(text, entry.text, start)) return true;
    }
    return false;
  });
}

/** The private list's entries, or why a push cannot be checked against it. */
export function listState(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return { refusal: 'the private list is not UTF-8' }; }
  const lines = text.split(/\r\n|\n|\r/).map((line) => line.trim().normalize('NFC'))
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines.length === 0) return { refusal: 'the private list holds no entry' };
  // Before folding, which can lengthen a line.
  if (lines.some((line) => [...line].length < 4)) return { refusal: 'the private list holds an entry under four characters' };
  return { entries: lines.map((line) => ({ text: folded(line) })) };
}

/** The rows a line of text falls in, of C1, C2, C3 and C5. */
export function rowsIn(line, entries) {
  const rows = [];
  if (ACCOUNT_ID.test(line)) rows.push('C1');
  if (holdsAddress(line)) rows.push('C2');
  if (holdsProcessHeader(line)) rows.push('C3');
  if (holdsEntry(line, entries)) rows.push('C5');
  return rows;
}

const lossy = { 'utf-8': new TextDecoder('utf-8'), 'utf-16le': new TextDecoder('utf-16le'), 'utf-16be': new TextDecoder('utf-16be') };
const linesOf = (text) => text.split(/\r\n|\n|\r/);

/** The lines the bytes hold that none of the parents' bytes hold, read in each encoding. */
export function addedLines(bytes, parents) {
  return Object.entries(lossy).flatMap(([encoding, decoder]) => {
    const held = new Set(parents.flatMap((parent) => linesOf(decoder.decode(parent))));
    return linesOf(decoder.decode(bytes))
      .map((line, index) => ({ encoding, line, number: index + 1 }))
      .filter(({ line }) => !held.has(line));
  });
}

const EVIDENCE = /^docs\/(?:spikes|journal)\//;
const LIMIT = 500_000;

/** C4: whether an evidence file is over the limit and no parent holds it at least as large. */
export const oversize = (path, size, parentSizes) => EVIDENCE.test(path) && size > LIMIT
  && !parentSizes.some((held) => held >= size);

/**
 * A commit's or tag's identity lines, and the rest of its text, a merged tag's included. Each is
 * read in every encoding, and in the one a commit declares besides, so none it declares hides it.
 */
export function commitParts(bytes) {
  const object = bytes.toString('latin1');
  const decoders = Object.values(lossy);
  const declared = /^encoding (\S+)$/m.exec(object.split('\n\n', 1)[0])?.[1];
  try { if (declared) decoders.push(new TextDecoder(declared)); } catch { /* an unknown label adds no reading */ }
  const read = (piece) => decoders.map((decoder) => decoder.decode(Buffer.from(piece, 'latin1')));
  const { identities, texts } = partsOf(object);
  return { identities: identities.flatMap(read), text: texts.flatMap(read).join('\n') };
}

function partsOf(object) {
  const end = object.indexOf('\n\n');
  const head = end === -1 ? object : object.slice(0, end);
  const identities = [];
  const texts = [end === -1 ? '' : object.slice(end + 2)];
  for (const header of head.replace(/\n$/, '').split(/\n(?! )/)) {
    const space = header.indexOf(' ');
    const name = header.slice(0, space);
    const value = header.slice(space + 1).replace(/\n /g, '\n');
    if (['author', 'committer', 'tagger'].includes(name)) identities.push(value);
    else if (name === 'mergetag') {
      const merged = partsOf(value);
      identities.push(...merged.identities);
      texts.push(...merged.texts);
    } else texts.push(header);
  }
  return { identities, texts };
}

/** A path as a refusal may print it: never one that holds what the check refuses. */
export function placeName(path, entries) {
  const text = folded(path);
  const safe = rowsIn(path, entries).length === 0 && !entries.some((entry) => text.includes(entry.text));
  return safe ? JSON.stringify(path) : 'a path this message does not print';
}

const ROWS = {
  C1: 'an account id', C2: 'an email address', C3: 'a process-table header', C4: 'an oversized evidence file', C5: 'an entry of the private list',
};

/** The first wording, and so the fullest, that holds no entry of the list. */
const wording = (entries, ...wordings) => wordings.find((text) => !entries.some((entry) => folded(text).includes(entry.text)));

/** The row and the place on lines of at most three characters, which no entry of four can be in. */
const shortest = (row, ordinal) => [row, '#', ...String(ordinal).match(/.{1,3}/g)].join('\n');

/** One refusal: its row and its place, in the fullest words that hold no entry of the list. */
export const refusalLine = (row, place, ordinal, entries) => wording(
  entries, `refused: ${row}, ${ROWS[row]}: ${place}.`, `refused: ${row}: ${place}.`, `refused: ${row} #${ordinal}.`, `${row} #${ordinal}`,
) ?? shortest(row, ordinal);

/** The updates a push asks for, its deletions left out, from what git hands the hook. */
export function updatesIn(text) {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.pop() !== '') throw new Unchecked('an update line is cut short');
  return lines.flatMap((line) => {
    const fields = line.split(' ');
    const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
    if (fields.length !== 4 || !sha.test(fields[1]) || !sha.test(fields[3])) throw new Unchecked('an update line is not one the check can read');
    const [, tip, ref, held] = fields;
    if (/^0+$/.test(tip)) return [];
    return [{ tip, ref, old: /^0+$/.test(held) ? undefined : held }];
  });
}

/** A reason to refuse that is safe to print: it holds nothing the push or the list holds. */
class Unchecked extends Error {}

/** Git reads the commits the push sends, never a replacement or a graft of them. */
const ENVIRONMENT = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null' };

function git(args, input) {
  const answer = spawnSync('git', args, { input, maxBuffer: Infinity, env: ENVIRONMENT });
  if (answer.status !== 0) throw new Unchecked('git did not answer what the push would send');
  return answer.stdout;
}

/** The bytes of each blob, in the order asked for. */
function blobs(names) {
  if (names.length === 0) return [];
  const answer = git(['cat-file', '--batch'], `${names.join('\n')}\n`);
  let at = 0;
  return names.map(() => {
    const end = answer.indexOf('\n', at);
    const [, type, size] = answer.toString('latin1', at, end).split(' ');
    if (type !== 'blob') throw new Unchecked('git did not answer a file the push would send');
    const bytes = answer.subarray(end + 1, end + 1 + Number(size));
    at = end + 1 + Number(size) + 1;
    return bytes;
  });
}

const typeOf = (object) => git(['cat-file', '-t', object]).toString().trim();

const ABSENT = '000000';
const SUBMODULE = '160000';
const LINK = '120000';

/** Each file a commit leaves different from every parent: its path, and it and its parents' blobs. */
function changes(commit) {
  const raw = git(['diff-tree', '-r', '-z', '-c', '--raw', '--root', '--no-renames', '--no-abbrev', '--no-commit-id', '--ignore-submodules=none', commit]);
  const fields = raw.toString('latin1').split('\0');
  const found = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const colons = /^:+/.exec(fields[index])[0].length;
    const values = fields[index].slice(colons).split(' ');
    const modes = values.slice(0, colons + 1);
    const names = values.slice(colons + 1, 2 * colons + 2);
    found.push({
      path: Buffer.from(fields[index + 1], 'latin1'),
      mode: modes.at(-1),
      blob: names.at(-1),
      parents: modes.slice(0, -1).flatMap((mode, at) => (mode === ABSENT || mode === SUBMODULE ? [] : [names[at]])),
      added: modes.slice(0, -1).every((mode) => mode === ABSENT),
    });
  }
  return found;
}

const textRows = (text, entries) => new Set(linesOf(text).flatMap((line) => rowsIn(line, entries)));

/** What one file holds, as added to the blobs its parents hold, that a row refuses. */
function fileFindings(name, { path: bytes, mode, blob, parents, added }, entries) {
  if (mode === ABSENT) return [];
  const path = bytes.toString('utf8');
  const place = `${name}, ${placeName(path, entries)}`;
  const found = added ? [...textRows(path, entries)].map((row) => ({ row, place: `${name}, a path` })) : [];
  if (mode === SUBMODULE) return found;
  const [now, ...before] = blobs([blob, ...parents]);
  if (oversize(path, now.length, before.map((held) => held.length))) found.push({ row: 'C4', place });
  return [...found, ...lineFindings(now, before, (number) => (mode === LINK ? `${place}, its link target` : `${place} line ${number}`), entries)];
}

const lineFindings = (now, before, placeAt, entries) => addedLines(now, before)
  .flatMap(({ line, number }) => rowsIn(line, entries).map((row) => ({ row, place: placeAt(number) })));

/** Every file a tree holds, each as added. */
function treeFiles(tree) {
  return git(['ls-tree', '-r', '-z', '--full-tree', tree]).toString('latin1').split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, , blob] = line.slice(0, tab).split(' ');
    return { path: Buffer.from(line.slice(tab + 1), 'latin1'), mode, blob, parents: [], added: true };
  });
}

function commitFindings(commit, entries) {
  const name = `commit ${commit.slice(0, 12)}`;
  const { identities, text } = commitParts(git(['cat-file', 'commit', commit]));
  const found = [...textRows(text, entries)].map((row) => ({ row, place: `${name}, its message` }));
  if (identities.some((line) => rowsIn(line, entries).includes('C5'))) found.push({ row: 'C5', place: `${name}, an author or committer field` });
  return [...found, ...changes(commit).flatMap((file) => fileFindings(name, file, entries))];
}

/** What a push of these updates would publish that a row refuses. */
function findings(updates, defaultRef, entries) {
  const found = [];
  const commits = new Set();
  for (const { tip, ref, old } of updates) {
    found.push(...[...textRows(ref, entries)].map((row) => ({ row, place: 'the name of a pushed ref' })));
    let object = tip;
    let type = typeOf(object);
    while (type === 'tag') {
      const bytes = git(['cat-file', 'tag', object]);
      const { identities, text } = commitParts(bytes);
      const place = `tag object ${object.slice(0, 12)}`;
      found.push(...[...textRows(text, entries)].map((row) => ({ row, place: `${place}, its message` })));
      if (identities.some((line) => rowsIn(line, entries).includes('C5'))) found.push({ row: 'C5', place: `${place}, its tagger field` });
      object = /^object (\S+)$/m.exec(bytes.toString('latin1'))[1];
      type = typeOf(object);
    }
    const name = `${type} ${object.slice(0, 12)}`;
    if (type === 'tree') found.push(...treeFiles(object).flatMap((file) => fileFindings(name, file, entries)));
    if (type === 'blob') found.push(...lineFindings(blobs([object])[0], [], (number) => `${name} line ${number}`, entries));
    if (type !== 'commit') continue;
    const held = old && spawnSync('git', ['rev-parse', '-q', '--verify', `${old}^{commit}`], { env: ENVIRONMENT }).status === 0 ? [old] : [];
    const added = git(['rev-list', object, '--not', defaultRef, ...held]).toString().split('\n').filter(Boolean);
    for (const commit of added) commits.add(commit);
  }
  for (const commit of commits) found.push(...commitFindings(commit, entries));
  return found;
}

function readList() {
  if (!process.env.HOME) return { refusal: 'the private list is absent' };
  try { return listState(readFileSync(join(process.env.HOME, '.config', 'rigger', 'private-list'))); }
  catch (error) {
    const absent = error.code === 'ENOENT' || error.code === 'ENOTDIR';
    return { refusal: `the private list is ${absent ? 'absent' : 'unreadable'}` };
  }
}

/** Why this push is refused, one line each. */
function refusals(defaultRef) {
  let entries = [];
  try {
    const updates = updatesIn(readFileSync(0, 'utf8'));
    if (updates.length === 0) return [];
    const list = readList();
    if (list.refusal) return [`refused: ${list.refusal}.`];
    entries = list.entries;
    const distinct = new Map(findings(updates, defaultRef, entries).map((found) => [`${found.row} ${found.place}`, found]));
    return [...distinct.values()].map(({ row, place }, index) => refusalLine(row, place, index + 1, entries));
  } catch (error) {
    const reason = error instanceof Unchecked ? error.message : 'the check failed';
    return [wording(entries, `refused: the push could not be checked: ${reason}.`, 'refused.') ?? 'no'];
  }
}

if (import.meta.main) {
  const lines = refusals(process.argv[2]);
  for (const line of lines) process.stderr.write(`${line}\n`);
  if (lines.length > 0) process.exitCode = 1;
}
