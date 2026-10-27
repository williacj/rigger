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
export function admission({ directory, run, now, sink, ids = randomId, fs = nodeFs }) {
  const dir = admissionPath(directory);
  const emitter = sink.emitter({ layer: 'L3' });

  /** Records `event` after its write, a refusal failing the call and naming the event. */
  function record(event, fields) {
    try {
      emitter.emit(event, fields);
    } catch (cause) {
      throw new Error(`admission changed at ${fields.name}, and the sink refused its ${event} event: ${cause.message}`, { cause });
    }
  }

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
   * The name of a closer present that carries `id`, under any name form, or undefined. Only the
   * closers present can be checked; a removed closer's id rests on the id source (K39 D4).
   */
  function carrying(id) {
    const listing = list();
    if (listing.failed) throw new Error(`admission cannot list ${dir}: ${listing.failed}`);
    return listing.entries.map((entry) => entry.name).find((name) => parseName(name)?.id === id);
  }

  /**
   * Closes admission as `kind` for `reason`: writes a temporary file of its own, links its closer
   * to it, and removes the temporary file, so the closer is then the file's only name. It records
   * one `admission.close` event. A temporary file it cannot remove after the link is named in the
   * answer and the event, and the close still stands. An id a present closer already carries is
   * refused, and no other id is drawn.
   */
  async function close({ kind, reason }) {
    if (!KINDS.includes(kind)) throw new Error(`admission closes only as owner or hold, not as ${JSON.stringify(kind)}`);
    const content = { reason, time: now(), run };
    if (!isContent(content)) throw new Error(`admission cannot record the closer ${JSON.stringify(content)}: it needs a reason, a time and a run`);
    const id = ids();
    if (typeof id !== 'string' || !ID.test(id)) throw new Error(`admission was handed the id ${JSON.stringify(id)}, which is not a run of 0-9 and a-z`);
    directoryToWrite();
    const carrier = carrying(id);
    if (carrier) throw new Error(`admission was handed the id ${id}, which the closer ${join(dir, carrier)} already carries`);
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
    let leftover;
    try {
      fs.unlinkSync(temporary);
    } catch {
      leftover = temporary;
    }
    record('admission.close', { kind, id, name, reason, ...(leftover && { leftover }) });
    return { name, path, kind, id, ...content, ...(leftover && { leftover }) };
  }

  /** Removes `name` from the directory: true where it removed it, false where it was already gone. */
  function remove(name) {
    try {
      fs.unlinkSync(join(dir, name));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  /**
   * Opens admission by one hold closer's name: removes exactly that closer and records one
   * `admission.open` event. A name that is no hold closer's is refused, so no opening lifts the
   * owner's `pause`. An entry under that name that is no readable closer, a directory, a link or a
   * file that does not parse, is refused and left in place, as `resume` leaves an unreadable
   * admission. A closer already gone answers so, and records nothing, since nothing changed.
   */
  async function open(name) {
    const named = parseName(name);
    if (named?.kind !== 'hold') throw new Error(`admission opens only by a hold closer's name, not ${JSON.stringify(name)}`);
    const path = join(dir, name);
    const found = contentOf(path);
    if (found.gone) return { name, ...named, alreadyGone: true };
    if (found.failed || !isContent(found.content)) {
      throw new Error(`admission opens only a readable closer, and ${path} is not one (${found.failed ?? 'no reason, time or run'}), so it removes nothing`);
    }
    if (!remove(name)) return { name, ...named, alreadyGone: true };
    record('admission.open', { kind: named.kind, id: named.id, name, by: 'opening' });
    return { name, ...named, alreadyGone: false };
  }

  /**
   * Renames the hold closer `name` to attach where its notice can be, as L2's notice answered:
   * `rename` is `after` or `issue`, and `number` the number the new name carries beside the hold's
   * id. Answers `{ name }`, the new name, and records one `admission.rename` event; or `{ gone }`
   * where the closer was gone, recording nothing.
   */
  function rename(name, { rename: to, number }) {
    const named = parseName(name);
    if (named?.kind !== 'hold' || !['after', 'issue'].includes(to) || !Number.isSafeInteger(number) || number < 1) {
      throw new Error(`admission renames only a hold closer to after or issue a number, not ${JSON.stringify(name)} to ${JSON.stringify({ to, number })}`);
    }
    const renamed = `hold-${named.id}-${to}-${number}.json`;
    try {
      fs.renameSync(join(dir, name), join(dir, renamed));
    } catch (error) {
      if (error.code === 'ENOENT') return { gone: true };
      throw new Error(`admission cannot rename ${join(dir, name)}: ${causeOf(error)}`, { cause: error });
    }
    record('admission.rename', { kind: 'hold', id: named.id, from: name, to: renamed, name: renamed });
    return { name: renamed };
  }

  /** The names in the directory now carrying hold id `id`. */
  function holdNames(id) {
    const listing = list();
    if (listing.failed) throw new Error(`admission cannot list ${dir}: ${listing.failed}`);
    return listing.entries.map((entry) => entry.name).filter((name) => {
      const named = parseName(name);
      return named?.kind === 'hold' && named.id === id;
    });
  }

  /**
   * Removes `closer`, a hold's under whatever name its id now carries, adding to `removed` each name
   * this call unlinked, so that a failure partway still leaves every removal it made named.
   */
  function removeCloser(closer, removed) {
    if (remove(closer.name)) removed.push(closer.name);
    if (closer.kind !== 'hold') return;
    for (let names = holdNames(closer.id); names.length > 0; names = holdNames(closer.id)) {
      for (const name of names) if (remove(name)) removed.push(name);
    }
  }

  /**
   * The names now carrying the ids of `closers`, which a `resume` that failed partway left: a hold
   * renamed since its listing is named as it now is. Where the directory cannot be listed, the
   * names as listed.
   */
  function leftOf(closers) {
    const listing = list();
    if (listing.failed) return closers.map(({ name }) => name);
    const ids = new Set(closers.map(({ kind, id }) => `${kind}-${id}`));
    return listing.entries.map((entry) => entry.name).filter((name) => {
      const named = parseName(name);
      return named && ids.has(`${named.kind}-${named.id}`);
    });
  }

  /**
   * `resume`'s removal: where every closer reads, removes each closer it read, a hold's under
   * whatever name its id then carries, and records one `admission.open` event raised by `resume`
   * for each name it unlinked, so two names carrying one hold's id are two events. A closer already
   * gone counts as removed, with no event. Where any closer is unreadable, it removes nothing and
   * rejects naming each, carrying as `unreadable` the entries `read` answered, unescaped.
   */
  async function resume() {
    const answer = read();
    if (answer.state === 'unreadable') {
      const { unreadable } = answer;
      throw Object.assign(new Error(`admission cannot be read, so resume removes nothing: ${unreadable.map(({ path, cause }) => `${path} (${cause})`).join(', ')}`), { unreadable });
    }
    const closers = answer.closers ?? [];
    const unlinked = new Set();
    const removed = [];
    const gone = [];
    /** One event for each name in `names`, the kind and id its name carries, after its unlink. */
    const recordEach = (names) => {
      for (const name of names) {
        unlinked.add(name);
        const { kind, id } = parseName(name);
        record('admission.open', { kind, id, name, by: 'resume' });
      }
    };
    for (const [index, closer] of closers.entries()) {
      const names = [];
      try {
        removeCloser(closer, names);
      } catch (cause) {
        recordEach(names);
        throw new Error(`resume left ${leftOf(closers.slice(index)).join(', ')}: ${cause.message}`, { cause });
      }
      recordEach(names);
      if (names.length > 0 || unlinked.has(closer.name)) removed.push(closer);
      else gone.push(closer);
    }
    return { removed, gone };
  }

  return { read, close, open, resume, rename };
}
