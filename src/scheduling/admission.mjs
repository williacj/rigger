// ABOUTME: L3's admission record, one immutable file per closer in `.rigger/admission/`: the one
// module that reads it, closes it, opens it and removes its closers on `resume`, recording each change.

import * as nodeFs from 'node:fs';
import { join } from 'node:path';

/** A closer's name, by its kind; a hold's may carry the number after `after-` or `issue-`. */
const OWNER = /^owner-([0-9a-z]+)\.json$/;
const HOLD = /^hold-([0-9a-z]+)(?:-(after|issue)-([1-9][0-9]*))?\.json$/;

/** The admission directory inside state directory `directory`. */
export const admissionPath = (directory) => join(directory, 'admission');

/**
 * What a closer's name says of it, or undefined where the name is of no closer form. A hold's
 * number is the string of digits its name writes, so a number of any length reads back exactly.
 */
function parseName(name) {
  const owner = OWNER.exec(name);
  if (owner) return { kind: 'owner', id: owner[1] };
  const hold = HOLD.exec(name);
  if (!hold) return undefined;
  return { kind: 'hold', id: hold[1], ...(hold[2] && { [hold[2]]: hold[3] }) };
}

/** Whether `content` is a closer's: an object with a non-empty reason and run, and a finite time. */
const isContent = (content) => typeof content === 'object' && content !== null && !Array.isArray(content)
  && typeof content.reason === 'string' && content.reason !== ''
  && typeof content.time === 'number' && Number.isFinite(content.time)
  && typeof content.run === 'string' && content.run !== '';

/** A failure's code where it has one, so an answer names the cause. */
const causeOf = (error) => error.code ?? error.message;

/**
 * The admission module over state directory `directory`, as its caller resolved it. `fs` is the
 * `node:fs` calls it makes, each replaceable so a test can inject what the file system will not
 * give on demand.
 *
 * `read` is synchronous, so that `take` can list inside its synchronous claim.
 */
export function admission({ directory, fs = nodeFs }) {
  const dir = admissionPath(directory);

  /** The admission directory's entries, or why it cannot be listed as a directory. */
  function list() {
    try {
      if (!fs.lstatSync(dir).isDirectory()) return { failed: 'not a directory' };
      return { entries: fs.readdirSync(dir, { withFileTypes: true }) };
    } catch (error) {
      if (error.code === 'ENOENT') return { entries: [] };
      return { failed: causeOf(error) };
    }
  }

  /** A closer file's content, opened without following a link, or `gone` where it vanished. */
  function contentOf(path) {
    let fd;
    try {
      fd = fs.openSync(path, nodeFs.constants.O_RDONLY | nodeFs.constants.O_NOFOLLOW);
    } catch (error) {
      if (error.code === 'ENOENT') return { gone: true };
      return { failed: causeOf(error) };
    }
    try {
      if (!fs.fstatSync(fd).isFile()) return { failed: 'not a regular file' };
      return { content: JSON.parse(fs.readFileSync(fd, 'utf8')) };
    } catch (error) {
      return { failed: causeOf(error) };
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Whether admission is open, closed naming every closer, or unreadable naming every entry it
   * could not read. A name starting with `.` is no closer and is never opened. A closer listed and
   * gone at its read sends the read back to list again, so the answer comes from one listing
   * every name of which it read, and a closer renamed between the two is never read as open.
   */
  function read() {
    for (;;) {
      const listing = list();
      if (listing.failed) return { state: 'unreadable', unreadable: [{ path: dir, cause: listing.failed }], closers: [] };
      const closers = [];
      const unreadable = [];
      let vanished = false;
      for (const entry of listing.entries) {
        if (entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        const named = parseName(entry.name);
        if (!named) { unreadable.push({ path, cause: 'no closer form' }); continue; }
        if (!entry.isFile()) { unreadable.push({ path, cause: 'not a regular file' }); continue; }
        const found = contentOf(path);
        if (found.gone) { vanished = true; break; }
        if (found.failed || !isContent(found.content)) { unreadable.push({ path, cause: found.failed ?? 'no reason, time or run' }); continue; }
        const { reason, time, run: by } = found.content;
        closers.push({ name: entry.name, path, ...named, reason, time, run: by });
      }
      if (vanished) continue;
      if (unreadable.length > 0) return { state: 'unreadable', unreadable, closers };
      return closers.length === 0 ? { state: 'open' } : { state: 'closed', closers };
    }
  }

  return { read };
}
