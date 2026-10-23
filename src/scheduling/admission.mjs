// ABOUTME: L3's admission record, one immutable file per closer in `.rigger/admission/`: the one
// module that reads it, closes it, opens it and removes its closers on `resume`, recording each change.

import * as nodeFs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/** The kinds of closer, each by the word its file's name starts with. */
const KINDS = ['owner', 'hold'];

/** An id: a non-empty run of `0`-`9` and `a`-`z`, holding no `-` and no `.`. */
const ID = /^[0-9a-z]+$/;

/** A closer's name, by its kind; a hold's may carry the number after `after-` or `issue-`. */
const OWNER = /^owner-([0-9a-z]+)\.json$/;
const HOLD = /^hold-([0-9a-z]+)(?:-(after|issue)-([1-9][0-9]*))?\.json$/;

/** The admission directory inside state directory `directory`. */
export const admissionPath = (directory) => join(directory, 'admission');

/** A fresh id, random enough that no other closer or temporary file has had it. */
const randomId = () => randomBytes(16).toString('hex');

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
export function admission({ directory, run, now, ids = randomId, fs = nodeFs }) {
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

  /** The admission directory, made where it is absent, refused where it is not one. */
  function directoryToWrite() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.lstatSync(dir).isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
    } catch (error) {
      throw new Error(`admission cannot close through ${dir}: ${causeOf(error)}`, { cause: error });
    }
  }

  /**
   * Closes admission as `kind` for `reason`: writes a temporary file of its own, links its closer
   * to it, and removes the temporary file, so the closer is then the file's only name.
   */
  async function close({ kind, reason }) {
    if (!KINDS.includes(kind)) throw new Error(`admission closes only as owner or hold, not as ${JSON.stringify(kind)}`);
    const content = { reason, time: now(), run };
    if (!isContent(content)) throw new Error(`admission cannot record the closer ${JSON.stringify(content)}: it needs a reason, a time and a run`);
    const id = ids();
    if (typeof id !== 'string' || !ID.test(id)) throw new Error(`admission was handed the id ${JSON.stringify(id)}, which is not a run of 0-9 and a-z`);
    directoryToWrite();
    const name = `${kind}-${id}.json`;
    const path = join(dir, name);
    const temporary = join(dir, `.tmp-${id}`);
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx');
    } catch (error) {
      throw new Error(`admission cannot write ${temporary}: ${causeOf(error)}`, { cause: error });
    }
    const discard = (at, error) => {
      try { fs.unlinkSync(temporary); } catch { /* a temporary file left is never read */ }
      return new Error(`admission cannot close at ${at}: ${causeOf(error)}`, { cause: error });
    };
    try {
      fs.writeFileSync(fd, JSON.stringify(content));
    } catch (error) {
      fs.closeSync(fd);
      throw discard(temporary, error);
    }
    fs.closeSync(fd);
    try {
      fs.linkSync(temporary, path);
    } catch (error) {
      throw discard(path, error);
    }
    fs.unlinkSync(temporary);
    return { name, path, kind, id, ...content };
  }

  return { read, close };
}
