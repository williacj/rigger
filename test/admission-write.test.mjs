// ABOUTME: Tests the writes of L3's admission module on real directories: a close links a closer of
// its own from a temporary file of its own, an opening removes one hold closer, and `resume`'s
// removal removes every closer it read, each leaving every other file byte-for-byte unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

import {
  admissionOf, asRoot, closerText, fsWith, moduleOver, namesIn, picture, seed, stateOf,
} from './admission-world.mjs';

/** A closer name of `kind` and a temporary file's name, as the Terms state them. */
const CLOSER = { owner: /^owner-[0-9a-z]+\.json$/, hold: /^hold-[0-9a-z]+\.json$/ };
const TEMPORARY = /^\.tmp-[0-9a-z]+$/;

/** The names in `state`'s admission directory that `before` did not hold. */
const added = (state, before) => namesIn(state).filter((name) => !(name in before));

/** An error carrying `code`, as `node:fs` throws one. */
const failure = (code, syscall) => Object.assign(new Error(`${code}: injected, ${syscall}`), { code, syscall });

/** An id source yielding each of `ids` in turn. */
const idsFrom = (...ids) => () => ids.shift();

/** Every path the module hands to the `node:fs` call `name`, recorded into `into`. */
const watching = (name, into) => ({ [name]: (path, ...rest) => { into.push(path); return fsWith({})[name](path, ...rest); } });

test('a close as the owner with no state directory makes .rigger/admission/ holding one owner closer and no temporary file', async () => {
  const state = stateOf();
  await moduleOver(state).close({ kind: 'owner', reason: 'lunch' });
  const names = namesIn(state);
  assert.equal(names.length, 1);
  assert.match(names[0], CLOSER.owner);
});

test('a close as the owner with no admission directory makes it, holding one owner closer and no temporary file', async () => {
  const state = stateOf();
  mkdirSync(state, { recursive: true });
  await moduleOver(state).close({ kind: 'owner', reason: 'lunch' });
  const names = namesIn(state);
  assert.equal(names.length, 1);
  assert.match(names[0], CLOSER.owner);
});

test('a close as the owner beside an owner closer adds a second, leaving the first byte-for-byte unchanged', async () => {
  const state = stateOf();
  seed(state, 'owner-a1.json');
  const before = picture(admissionOf(state));
  await moduleOver(state).close({ kind: 'owner', reason: 'again' });
  const after = picture(admissionOf(state));
  assert.equal(after['owner-a1.json'], before['owner-a1.json']);
  const fresh = added(state, before);
  assert.equal(fresh.length, 1);
  assert.match(fresh[0], CLOSER.owner);
});

test('a close as the owner beside a hold closer or an unreadable closer adds its own, leaving every other file unchanged', async () => {
  for (const [name, content] of [['hold-b1-issue-4.json', closerText()], ['hold-b1.json', '{ torn'], ['stray.txt', 'x']]) {
    const state = stateOf();
    seed(state, name, content);
    seed(state, '.DS_Store', 'finder');
    const before = picture(admissionOf(state));
    await moduleOver(state).close({ kind: 'owner', reason: 'pause' });
    const after = picture(admissionOf(state));
    const fresh = added(state, before);
    assert.equal(fresh.length, 1, name);
    assert.match(fresh[0], CLOSER.owner);
    delete after[fresh[0]];
    assert.deepEqual(after, before, name);
  }
});

test('a close as a hold adds one hold closer, open or closed by any closer, leaving every other file unchanged', async () => {
  for (const seeded of [[], ['owner-a1.json'], ['hold-b1-after-3.json'], ['owner-a1.json', 'hold-b2-issue-7.json']]) {
    const state = stateOf();
    for (const name of seeded) seed(state, name);
    mkdirSync(admissionOf(state), { recursive: true });
    const before = picture(admissionOf(state));
    await moduleOver(state).close({ kind: 'hold', reason: 'two environment failures' });
    const after = picture(admissionOf(state));
    const fresh = added(state, before);
    assert.equal(fresh.length, 1, seeded.join(' '));
    assert.match(fresh[0], CLOSER.hold);
    delete after[fresh[0]];
    assert.deepEqual(after, before);
  }
});

// proves R-SCHED-4
test('a close accepts only the kinds owner and hold, and one naming any other kind rejects naming it and writes nothing', async () => {
  for (const kind of ['ci', 'Owner', 'admin', '', undefined]) {
    const state = stateOf();
    await assert.rejects(moduleOver(state).close({ kind, reason: 'x' }), (error) => error.message.includes(JSON.stringify(kind)));
    assert.equal(existsSync(state), false, String(kind));
  }
  for (const kind of ['owner', 'hold']) {
    const state = stateOf();
    const made = await moduleOver(state).close({ kind, reason: 'x' });
    assert.equal(made.kind, kind);
    assert.deepEqual(namesIn(state), [made.name]);
  }
});

test('a close where admission is a regular file or a symbolic link rejects naming the path, writing nothing through it', async () => {
  const file = stateOf();
  mkdirSync(file, { recursive: true });
  writeFileSync(admissionOf(file), 'not a directory');
  const { events, ...onFile } = moduleOver(file);
  await assert.rejects(onFile.close({ kind: 'owner', reason: 'x' }), (error) => error.message.includes(admissionOf(file)));
  assert.equal(readFileSync(admissionOf(file), 'utf8'), 'not a directory');
  assert.deepEqual(events, []);

  const linked = stateOf();
  const elsewhere = join(linked, 'elsewhere');
  mkdirSync(elsewhere, { recursive: true });
  symlinkSync(elsewhere, admissionOf(linked));
  await assert.rejects(moduleOver(linked).close({ kind: 'owner', reason: 'x' }), (error) => error.message.includes(admissionOf(linked)));
  assert.deepEqual(picture(elsewhere), {});
});

test('a close where the admission directory may not be written rejects naming the path and EACCES, writing nothing', { skip: asRoot && 'root writes past every permission bit, so no write is refused' }, async (t) => {
  const state = stateOf();
  mkdirSync(admissionOf(state), { recursive: true });
  chmodSync(admissionOf(state), 0o500);
  t.after(() => chmodSync(admissionOf(state), 0o700));
  const { events, ...admissions } = moduleOver(state);
  await assert.rejects(admissions.close({ kind: 'owner', reason: 'x' }), (error) => error.message.includes(admissionOf(state)) && error.message.includes('EACCES'));
  assert.deepEqual(namesIn(state), []);
  assert.deepEqual(events, []);
});

test('two closes at once in one process, through one module or two, give two ids and two temporary files of their own', async () => {
  for (const instances of [1, 2]) {
    const state = stateOf();
    const opened = [];
    const fs = fsWith(watching('openSync', opened));
    const first = moduleOver(state, { fs });
    const second = instances === 1 ? first : moduleOver(state, { fs });
    const made = await Promise.all([first.close({ kind: 'owner', reason: 'a' }), second.close({ kind: 'hold', reason: 'b' })]);
    assert.notEqual(made[0].id, made[1].id);
    const temporaries = opened.filter((path) => path.startsWith(join(admissionOf(state), '.tmp-')));
    assert.equal(temporaries.length, 2);
    assert.notEqual(temporaries[0], temporaries[1]);
    assert.deepEqual(namesIn(state), [made[0].name, made[1].name].sort());
  }
});

test('every closer name and temporary file name the module writes is of the Terms\' id form', async () => {
  const state = stateOf();
  const opened = [];
  const linked = [];
  const fs = fsWith({
    ...watching('openSync', opened),
    linkSync: (from, to) => { linked.push(to); return fsWith({}).linkSync(from, to); },
  });
  const admissions = moduleOver(state, { fs });
  for (const kind of ['owner', 'hold', 'owner', 'hold']) await admissions.close({ kind, reason: 'r' });
  const temporaries = opened.filter((path) => path.startsWith(join(admissionOf(state), '.tmp-')));
  assert.equal(temporaries.length, 4);
  for (const path of temporaries) assert.match(path.slice(admissionOf(state).length + 1), TEMPORARY);
  assert.equal(linked.length, 4);
  for (const path of linked) assert.match(path.slice(admissionOf(state).length + 1), /^(owner|hold)-[0-9a-z]+\.json$/);
});

test('ids are not reused across module instances over one state directory', async () => {
  const state = stateOf();
  const first = await moduleOver(state).close({ kind: 'hold', reason: 'one' });
  const second = await moduleOver(state).close({ kind: 'hold', reason: 'two' });
  assert.notEqual(first.id, second.id);
  assert.deepEqual(namesIn(state), [first.name, second.name].sort());
});

// proves R-STATE-4
test('each close writes the reason it is handed, the time from its clock in epoch milliseconds, and its run id', async () => {
  const state = stateOf();
  const times = [1_761_111_111_111, 1_762_222_222_222];
  const admissions = moduleOver(state, { run: 'r-written', now: () => times.shift() });
  const owner = await admissions.close({ kind: 'owner', reason: 'the owner paused' });
  const hold = await admissions.close({ kind: 'hold', reason: 'two failures of one class' });
  const written = (made) => JSON.parse(readFileSync(join(admissionOf(state), made.name), 'utf8'));
  assert.deepEqual(written(owner), { reason: 'the owner paused', time: 1_761_111_111_111, run: 'r-written' });
  assert.deepEqual(written(hold), { reason: 'two failures of one class', time: 1_762_222_222_222, run: 'r-written' });
  for (const made of [owner, hold]) {
    const content = written(made);
    assert.equal(typeof content.reason, 'string');
    assert.equal(Number.isFinite(content.time), true);
    assert.equal(typeof content.run, 'string');
  }
});

// proves R-STATE-4
test('a closer one module instance wrote reads closed with the same kind, id, reason, time and run through a second made after it', async () => {
  const state = stateOf();
  const { kind, id, name } = await moduleOver(state, { run: 'r-before-restart', now: () => 1_763_000_000_000 }).close({ kind: 'owner', reason: 'kept across a restart' });
  assert.deepEqual(moduleOver(state, { run: 'r-after-restart' }).read(), {
    state: 'closed',
    closers: [{
      name, path: join(admissionOf(state), name), kind, id,
      reason: 'kept across a restart', time: 1_763_000_000_000, run: 'r-before-restart',
    }],
  });
});

test('deleting the state directory after a close leaves the next read open', async () => {
  const state = stateOf();
  const admissions = moduleOver(state);
  await admissions.close({ kind: 'owner', reason: 'pause' });
  await admissions.close({ kind: 'hold', reason: 'hold' });
  assert.equal(admissions.read().state, 'closed');
  rmSync(state, { recursive: true });
  assert.deepEqual(admissions.read(), { state: 'open' });
});

test('a close whose temporary file cannot be written rejects naming the path and cause, adding no closer and no event', async () => {
  for (const [code, at] of [['ENOSPC', 'writeFileSync'], ['EACCES', 'openSync']]) {
    const state = stateOf();
    seed(state, 'owner-a1.json');
    const before = picture(admissionOf(state));
    // Injected at the module's write of the temporary file, or at its creation, which no real
    // directory here refuses on demand.
    const fs = fsWith({ [at]: () => { throw failure(code, at); } });
    const { events, ...admissions } = moduleOver(state, { fs, ids: idsFrom('c0de') });
    await assert.rejects(admissions.close({ kind: 'hold', reason: 'x' }), (error) => error.message.includes(join(admissionOf(state), '.tmp-c0de')) && error.message.includes(code));
    assert.deepEqual(picture(admissionOf(state)), before, code);
    assert.deepEqual(events, []);
  }
});

test('a close whose link fails rejects naming the closer\'s path and cause, adding no closer and no event', async () => {
  const state = stateOf();
  seed(state, 'owner-a1.json');
  const before = picture(admissionOf(state));
  // Injected at the module's link, which no real directory here refuses on demand.
  const fs = fsWith({ linkSync: () => { throw failure('EMLINK', 'link'); } });
  const { events, ...admissions } = moduleOver(state, { fs, ids: idsFrom('11ac') });
  await assert.rejects(admissions.close({ kind: 'owner', reason: 'x' }), (error) => error.message.includes(join(admissionOf(state), 'owner-11ac.json')) && error.message.includes('EMLINK'));
  assert.deepEqual(picture(admissionOf(state)), before);
  assert.deepEqual(events, []);
});

test('a close whose temporary file cannot be removed after its link resolves, its closer reading as closed', async () => {
  const state = stateOf();
  const temporary = join(admissionOf(state), '.tmp-1ef7');
  // Injected at the module's removal of its own temporary file, after the link.
  const fs = fsWith({ unlinkSync: (path) => { if (path === temporary) throw failure('EBUSY', 'unlink'); return fsWith({}).unlinkSync(path); } });
  const { events, ...admissions } = moduleOver(state, { fs, ids: idsFrom('1ef7') });
  const made = await admissions.close({ kind: 'owner', reason: 'pause' });
  assert.equal(made.name, 'owner-1ef7.json');
  assert.deepEqual(namesIn(state), ['.tmp-1ef7', 'owner-1ef7.json']);
  assert.equal(admissions.read().state, 'closed');
  assert.equal(made.leftover, temporary);
  assert.equal(events.length, 1);
  assert.equal(events[0].leftover, temporary);
});

test('a close handed the id of a temporary file a dead write left rejects naming EEXIST, never opening the leftover or adding a closer', async () => {
  const state = stateOf();
  seed(state, '.tmp-dead1', 'half a closer');
  seed(state, 'owner-a1.json');
  const before = picture(admissionOf(state));
  const read = [];
  const fs = fsWith(watching('readFileSync', read));
  const { events, ...admissions } = moduleOver(state, { fs, ids: idsFrom('dead1') });
  await assert.rejects(admissions.close({ kind: 'hold', reason: 'x' }), (error) => error.message.includes('EEXIST'));
  assert.deepEqual(picture(admissionOf(state)), before);
  assert.deepEqual(read, []);
  assert.deepEqual(events, []);
});

test('an opening by a hold closer\'s name removes exactly that closer, leaving every other file unchanged', async () => {
  for (const name of ['hold-b1.json', 'hold-b1-after-8.json', 'hold-b1-issue-12.json']) {
    const state = stateOf();
    seed(state, name);
    seed(state, 'hold-b2-issue-13.json');
    seed(state, 'owner-a1.json');
    seed(state, '.tmp-99', 'left');
    const before = picture(admissionOf(state));
    const answer = await moduleOver(state).open(name);
    assert.equal(answer.alreadyGone, false);
    delete before[name];
    assert.deepEqual(picture(admissionOf(state)), before, name);
  }
});

test('an opening whose hold closer is already gone resolves, answers so, and adds no event to the sink', async () => {
  const state = stateOf();
  seed(state, 'owner-a1.json');
  const before = picture(admissionOf(state));
  const { events, ...admissions } = moduleOver(state);
  const answer = await admissions.open('hold-b1-issue-4.json');
  assert.equal(answer.alreadyGone, true);
  assert.deepEqual(events, []);
  assert.deepEqual(picture(admissionOf(state)), before);
});

test('an opening by a name that is not a hold closer\'s rejects naming it and removes nothing', async () => {
  for (const name of ['owner-a1.json', 'paused.json', 'hold-.json', '.tmp-a1', '../owner-a1.json']) {
    const state = stateOf();
    seed(state, 'owner-a1.json');
    seed(state, 'paused.json');
    seed(state, '.tmp-a1', 'left');
    const before = picture(admissionOf(state));
    const { events, ...admissions } = moduleOver(state);
    await assert.rejects(admissions.open(name), (error) => error.message.includes(JSON.stringify(name)));
    assert.deepEqual(picture(admissionOf(state)), before, name);
    assert.deepEqual(events, []);
  }
});

test('a resume removal over closers that all read removes every closer it listed', async () => {
  const state = stateOf();
  for (const name of ['owner-a1.json', 'owner-a2.json', 'hold-b1.json', 'hold-b2-after-5.json', 'hold-b3-issue-6.json']) seed(state, name);
  seed(state, '.DS_Store', 'finder');
  const answer = await moduleOver(state).resume();
  assert.equal(answer.removed.length, 5);
  assert.deepEqual(namesIn(state), ['.DS_Store']);
});

test('a resume removal where any closer is unreadable removes nothing, naming each unreadable closer', async () => {
  const state = stateOf();
  seed(state, 'owner-a1.json');
  seed(state, 'hold-b1.json', '{ torn');
  seed(state, 'stray.json');
  const before = picture(admissionOf(state));
  const { events, ...admissions } = moduleOver(state);
  await assert.rejects(admissions.resume(), (error) => error.message.includes(join(admissionOf(state), 'hold-b1.json'))
    && error.message.includes(join(admissionOf(state), 'stray.json')));
  assert.deepEqual(picture(admissionOf(state)), before);
  assert.deepEqual(events, []);
});

test('a resume removal leaves a closer linked after its listing', async () => {
  const state = stateOf();
  seed(state, 'owner-a1.json');
  let linkedLate = false;
  // Injected at the module's first removal: a pause links its closer after resume listed.
  const fs = fsWith({
    unlinkSync: (path) => {
      if (!linkedLate) { linkedLate = true; seed(state, 'owner-late.json'); }
      return fsWith({}).unlinkSync(path);
    },
  });
  const answer = await moduleOver(state, { fs }).resume();
  assert.deepEqual(answer.removed.map(({ name }) => name), ['owner-a1.json']);
  assert.deepEqual(namesIn(state), ['owner-late.json']);
});

test('a resume removal removes a hold closer renamed before its removal under whatever name its id then carries', async () => {
  for (const [listed, renamed] of [
    ['hold-e5.json', 'hold-e5-after-3.json'],
    ['hold-e5-after-3.json', 'hold-e5-issue-4.json'],
    ['hold-e5-issue-4.json', 'hold-e5-issue-9.json'],
  ]) {
    const state = stateOf();
    seed(state, listed);
    seed(state, 'hold-f6.json');
    const at = join(admissionOf(state), listed);
    let moved = false;
    // Injected at the module's removal of the listed name: L3's rename lands just before it.
    const fs = fsWith({
      unlinkSync: (path) => {
        if (path === at && !moved) { moved = true; renameSync(at, join(admissionOf(state), renamed)); }
        return fsWith({}).unlinkSync(path);
      },
    });
    const { events, ...admissions } = moduleOver(state, { fs });
    const answer = await admissions.resume();
    assert.equal(moved, true);
    assert.deepEqual(namesIn(state), [], listed);
    assert.deepEqual(answer.removed.map(({ name }) => name).sort(), ['hold-f6.json', listed].sort());
    assert.deepEqual(events.map(({ id }) => id).sort(), ['e5', 'f6']);
  }
});

test('a resume removal counts a closer already gone at its removal as removed, with no failure and no event for it', async () => {
  const state = stateOf();
  seed(state, 'owner-a1.json');
  seed(state, 'hold-b1-issue-2.json');
  const at = join(admissionOf(state), 'hold-b1-issue-2.json');
  let removedFirst = false;
  // Injected at the module's removal: an issue-close opening removed the closer first.
  const fs = fsWith({
    unlinkSync: (path) => {
      if (path === at && !removedFirst) { removedFirst = true; rmSync(at); }
      return fsWith({}).unlinkSync(path);
    },
  });
  const { events, ...admissions } = moduleOver(state, { fs });
  const answer = await admissions.resume();
  assert.equal(removedFirst, true);
  assert.deepEqual(answer.gone.map(({ name }) => name), ['hold-b1-issue-2.json']);
  assert.deepEqual(answer.removed.map(({ name }) => name), ['owner-a1.json']);
  assert.deepEqual(events.map(({ name }) => name), ['owner-a1.json']);
  assert.deepEqual(namesIn(state), []);
});

test('a resume removal that fails partway rejects naming the closer left, which still reads closed, and a second removes it', async () => {
  const state = stateOf();
  seed(state, 'owner-a1.json');
  seed(state, 'owner-a2.json');
  const failing = join(admissionOf(state), 'owner-a2.json');
  // Injected at the module's removal of the second closer, which no real directory refuses on demand.
  const fs = fsWith({ unlinkSync: (path) => { if (path === failing) throw failure('EIO', 'unlink'); return fsWith({}).unlinkSync(path); } });
  await assert.rejects(moduleOver(state, { fs }).resume(), (error) => error.message.includes('owner-a2.json') && error.message.includes('EIO'));
  const left = moduleOver(state).read();
  assert.equal(left.state, 'closed');
  assert.deepEqual(left.closers.map(({ name }) => name), ['owner-a2.json']);
  await moduleOver(state).resume();
  assert.deepEqual(moduleOver(state).read(), { state: 'open' });
});

test('an opening by an owner closer\'s name rejects naming it and leaves that closer byte-for-byte in place', async () => {
  const state = stateOf();
  seed(state, 'owner-a1.json', closerText({ reason: 'the owner\'s own pause' }));
  const before = readFileSync(join(admissionOf(state), 'owner-a1.json'));
  await assert.rejects(moduleOver(state).open('owner-a1.json'), /owner-a1\.json/);
  assert.deepEqual(readFileSync(join(admissionOf(state), 'owner-a1.json')), before);
});

test('no closer\'s content changes after it first appears, across every write the module makes', async () => {
  const state = stateOf();
  const seen = {};
  const changed = [];
  /**
   * Closer `name`'s bytes now, compared with its bytes when first seen, or recorded as first seen.
   * A change is kept rather than thrown, so a step that swallows its own failure cannot hide it.
   */
  const compare = (name, bytes, step) => {
    if (name.startsWith('.')) return;
    if (!(name in seen)) seen[name] = bytes;
    else if (bytes !== seen[name]) changed.push(`${name} changed at ${step}`);
  };
  /** Every closer now present, compared with its bytes when first seen, and no change seen so far. */
  const check = (step) => {
    for (const [name, bytes] of Object.entries(picture(admissionOf(state)))) compare(name, bytes, step);
    assert.deepEqual(changed, []);
  };
  let step = 'start';
  /**
   * `fs` with the module's links and removals observed: a closer's bytes are taken as it is linked
   * and again just before any removal, so a rewrite is caught even where the same call removes the
   * closer it rewrote and no picture taken after the call could still see it.
   */
  const observed = (fs = fsWith({})) => ({
    ...fs,
    linkSync: (from, to) => {
      const result = fs.linkSync(from, to);
      compare(basename(to), readFileSync(to).toString('hex'), `${step}, at its link`);
      return result;
    },
    unlinkSync: (path) => {
      if (existsSync(path) && lstatSync(path).isFile()) compare(basename(path), readFileSync(path).toString('hex'), `${step}, before its removal`);
      return fs.unlinkSync(path);
    },
  });
  const over = (options = {}) => moduleOver(state, { ...options, fs: observed(options.fs) });
  const admissions = over();
  const steps = [
    ['owner close', () => admissions.close({ kind: 'owner', reason: 'one' })],
    ['hold close', () => admissions.close({ kind: 'hold', reason: 'two' })],
    ['second owner close', () => admissions.close({ kind: 'owner', reason: 'three' })],
    ['close of another kind', () => admissions.close({ kind: 'ci', reason: 'x' }).catch(() => {})],
    ['close beside a leftover', () => over({ ids: idsFrom('dead2') }).close({ kind: 'hold', reason: 'x' }).catch(() => {})],
    ['close whose link fails', () => over({ fs: fsWith({ linkSync: () => { throw failure('EIO', 'link'); } }) }).close({ kind: 'hold', reason: 'x' }).catch(() => {})],
    ['close leaving its temporary file', () => over({ fs: fsWith({ unlinkSync: () => { throw failure('EBUSY', 'unlink'); } }) }).close({ kind: 'hold', reason: 'leftover' })],
    ['opening of a hold', () => admissions.open(namesIn(state).find((name) => name.startsWith('hold-')))],
    ['opening already gone', () => admissions.open('hold-zz.json')],
    ['opening of an owner', () => admissions.open(namesIn(state).find((name) => name.startsWith('owner-'))).catch(() => {})],
    ['resume failing partway', () => over({ fs: fsWith({ unlinkSync: (path) => { if (path.endsWith('.json') && path.includes('hold-')) throw failure('EIO', 'unlink'); return fsWith({}).unlinkSync(path); } }) }).resume().catch(() => {})],
    ['resume', () => admissions.resume()],
  ];
  seed(state, '.tmp-dead2', 'left');
  check(step);
  for (const [name, write] of steps) {
    step = name;
    await write();
    check(step);
  }
  assert.deepEqual(namesIn(state).filter((name) => !name.startsWith('.')), []);
  assert.ok(Object.keys(seen).length >= 4);
});

test('a close handed an id outside the Terms\' id form rejects naming it and writes nothing', async () => {
  for (const id of ['a-b', 'a.b', 'A1', '', undefined, '../x']) {
    const state = stateOf();
    await assert.rejects(moduleOver(state, { ids: () => id }).close({ kind: 'owner', reason: 'x' }), (error) => error.message.includes(JSON.stringify(id)));
    assert.equal(existsSync(state), false, String(id));
  }
});

test('a close that would write an unreadable closer, with no reason, no finite time or no run, rejects and writes nothing', async () => {
  for (const [options, reason] of [[{}, ''], [{}, 7], [{ now: () => Number.NaN }, 'r'], [{ run: '' }, 'r']]) {
    const state = stateOf();
    await assert.rejects(moduleOver(state, options).close({ kind: 'owner', reason }), /reason, a time and a run/);
    assert.equal(existsSync(state), false, JSON.stringify({ ...options, reason }));
  }
});

test('a close handed an id a present closer already carries, under any name form, rejects naming both, draws no other id and adds no closer', async () => {
  for (const existing of ['owner-a1.json', 'hold-a1-issue-3.json']) {
    const state = stateOf();
    seed(state, existing);
    const before = picture(admissionOf(state));
    let asked = 0;
    const ids = () => { asked += 1; return asked === 1 ? 'a1' : 'b2'; };
    const { events, ...admissions } = moduleOver(state, { ids });
    await assert.rejects(admissions.close({ kind: 'hold', reason: 'x' }), (error) => error.message.includes('a1') && error.message.includes(existing), existing);
    assert.equal(asked, 1, existing);
    assert.deepEqual(picture(admissionOf(state)), before, existing);
    assert.deepEqual(events, []);
  }
});
