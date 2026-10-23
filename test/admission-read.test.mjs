// ABOUTME: Tests what L3's admission module answers on reading `.rigger/admission/`: open, closed
// naming each closer, or unreadable naming each entry it could not read, on real directories.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RUN, TIME, admissionOf, asRoot, closerText, fsWith, moduleOver, seed, stateOf,
} from './admission-world.mjs';

/** The answer's unreadable paths, sorted. */
const unreadablePaths = (answer) => answer.unreadable.map(({ path }) => path).sort();

/** The answer's closers by name, sorted. */
const closerNames = (answer) => answer.closers.map(({ name }) => name).sort();

test('admission reads open where the state directory it is handed does not exist', () => {
  assert.deepEqual(moduleOver(stateOf()).read(), { state: 'open' });
});

test('admission reads open where the state directory holds no admission entry', () => {
  const state = stateOf();
  mkdirSync(state, { recursive: true });
  assert.deepEqual(moduleOver(state).read(), { state: 'open' });
});

test('admission reads open where the admission directory is empty', () => {
  const state = stateOf();
  mkdirSync(admissionOf(state), { recursive: true });
  assert.deepEqual(moduleOver(state).read(), { state: 'open' });
});

test('admission reads open past entries whose names start with a dot, opening none and following no link', () => {
  const state = stateOf();
  seed(state, '.tmp-0a1b', closerText());
  seed(state, '.tmp-2c3d', '{ not json');
  seed(state, '.DS_Store', 'finder');
  mkdirSync(join(admissionOf(state), '.Trash'));
  symlinkSync(join(admissionOf(state), 'nowhere'), join(admissionOf(state), '.x'));
  const touched = [];
  const watch = (name) => (path, ...rest) => {
    touched.push(`${name} ${path}`);
    return fsWith({})[name](path, ...rest);
  };
  const admissions = moduleOver(state, { fs: fsWith({ openSync: watch('openSync'), readFileSync: watch('readFileSync'), statSync: watch('statSync'), lstatSync: watch('lstatSync') }) });
  assert.deepEqual(admissions.read(), { state: 'open' });
  assert.deepEqual(touched.filter((call) => call.includes(`${admissionOf(state)}/.`)), []);
});

test('admission reads closed beside a dot-named file, naming the closer and not the file', () => {
  const state = stateOf();
  seed(state, '.DS_Store', 'finder');
  seed(state, 'owner-a1.json');
  const answer = moduleOver(state).read();
  assert.equal(answer.state, 'closed');
  assert.deepEqual(closerNames(answer), ['owner-a1.json']);
});

test('admission reads one owner closer as closed, naming its kind, id, reason, time and run id', () => {
  const state = stateOf();
  seed(state, 'owner-7f3e.json', JSON.stringify({ reason: 'owner went to lunch', time: 1_700_000_000_000, run: 'r-earlier' }));
  assert.deepEqual(moduleOver(state).read(), {
    state: 'closed',
    closers: [{
      name: 'owner-7f3e.json', path: join(admissionOf(state), 'owner-7f3e.json'), kind: 'owner', id: '7f3e',
      reason: 'owner went to lunch', time: 1_700_000_000_000, run: 'r-earlier',
    }],
  });
});

test('admission reads a hold closer under each of its three names, naming its kind, id and number', () => {
  for (const [name, named] of [
    ['hold-b2.json', {}],
    ['hold-b2-after-41.json', { after: 41 }],
    ['hold-b2-issue-907.json', { issue: 907 }],
  ]) {
    const state = stateOf();
    seed(state, name, closerText({ reason: 'two environment failures' }));
    assert.deepEqual(moduleOver(state).read(), {
      state: 'closed',
      closers: [{
        name, path: join(admissionOf(state), name), kind: 'hold', id: 'b2', ...named,
        reason: 'two environment failures', time: TIME, run: RUN,
      }],
    }, name);
  }
});

test('admission reads several closers as closed, naming every one', () => {
  for (const names of [
    ['owner-a1.json', 'owner-a2.json'],
    ['hold-b1.json', 'hold-b2-issue-3.json'],
    ['hold-b1-after-9.json', 'owner-a1.json'],
  ]) {
    const state = stateOf();
    for (const name of names) seed(state, name);
    const answer = moduleOver(state).read();
    assert.equal(answer.state, 'closed', names.join(' '));
    assert.deepEqual(closerNames(answer), names);
  }
});

test('admission reads a file of no closer form, its name not starting with a dot, as unreadable naming it', () => {
  for (const name of ['paused.json', 'hold-.json', 'hold-a-b.json']) {
    const state = stateOf();
    seed(state, name);
    const answer = moduleOver(state).read();
    assert.equal(answer.state, 'unreadable', name);
    assert.deepEqual(unreadablePaths(answer), [join(admissionOf(state), name)]);
  }
});

test('admission reads a hold name whose number is not a positive decimal without a leading zero as unreadable', () => {
  for (const name of ['hold-a-issue-0.json', 'hold-a-issue-x.json', 'hold-a-after-07.json']) {
    const state = stateOf();
    seed(state, name);
    const answer = moduleOver(state).read();
    assert.equal(answer.state, 'unreadable', name);
    assert.deepEqual(unreadablePaths(answer), [join(admissionOf(state), name)]);
  }
});

test('admission reads a closer whose content is not JSON, is empty, or lacks a reason, time or run as unreadable', () => {
  for (const content of [
    '{ not json', '', 'null', '[]', '"text"',
    JSON.stringify({ time: TIME, run: RUN }),
    JSON.stringify({ reason: 'r', run: RUN }),
    JSON.stringify({ reason: 'r', time: TIME }),
  ]) {
    const state = stateOf();
    seed(state, 'owner-a1.json', content);
    const answer = moduleOver(state).read();
    assert.equal(answer.state, 'unreadable', content);
    assert.deepEqual(unreadablePaths(answer), [join(admissionOf(state), 'owner-a1.json')]);
  }
});

test('admission reads a closer whose reason, time or run has another type as unreadable', () => {
  for (const content of [
    '{"reason":1,"time":"x","run":null}',
    JSON.stringify({ reason: '', time: TIME, run: RUN }),
    JSON.stringify({ reason: 'r', time: 'soon', run: RUN }),
    '{"reason":"r","time":1e999,"run":"r-1"}',
    JSON.stringify({ reason: 'r', time: TIME, run: '' }),
    JSON.stringify({ reason: 'r', time: TIME, run: 7 }),
  ]) {
    const state = stateOf();
    seed(state, 'hold-c3.json', content);
    const answer = moduleOver(state).read();
    assert.equal(answer.state, 'unreadable', content);
    assert.deepEqual(unreadablePaths(answer), [join(admissionOf(state), 'hold-c3.json')]);
  }
});

test('admission reads a closer that is a directory as unreadable naming it', () => {
  const state = stateOf();
  mkdirSync(join(admissionOf(state), 'owner-a1.json'), { recursive: true });
  const answer = moduleOver(state).read();
  assert.equal(answer.state, 'unreadable');
  assert.deepEqual(unreadablePaths(answer), [join(admissionOf(state), 'owner-a1.json')]);
});

test('admission reads a closer that is a symbolic link as unreadable naming it, without following the link', () => {
  const state = stateOf();
  const outside = join(state, 'outside.json');
  mkdirSync(admissionOf(state), { recursive: true });
  writeFileSync(outside, closerText());
  for (const target of [outside, join(admissionOf(state), 'nowhere.json')]) {
    const link = join(admissionOf(state), 'owner-a1.json');
    symlinkSync(target, link);
    const opened = [];
    const fs = fsWith({ openSync: (path, ...rest) => { opened.push(path); return fsWith({}).openSync(path, ...rest); } });
    const answer = moduleOver(state, { fs }).read();
    assert.equal(answer.state, 'unreadable', target);
    assert.deepEqual(unreadablePaths(answer), [link]);
    assert.deepEqual(opened.filter((path) => path === link || path === target), []);
    unlinkSync(link);
  }
});

test('admission reads an admission entry that is a regular file or a symbolic link as unreadable naming its path', () => {
  const file = stateOf();
  mkdirSync(file, { recursive: true });
  writeFileSync(admissionOf(file), 'not a directory');
  assert.deepEqual(unreadablePaths(moduleOver(file).read()), [admissionOf(file)]);

  const linked = stateOf();
  const elsewhere = join(linked, 'elsewhere');
  mkdirSync(elsewhere, { recursive: true });
  writeFileSync(join(elsewhere, 'owner-a1.json'), closerText());
  symlinkSync(elsewhere, admissionOf(linked));
  const listed = [];
  const fs = fsWith({ readdirSync: (path, ...rest) => { listed.push(path); return fsWith({}).readdirSync(path, ...rest); } });
  const answer = moduleOver(linked, { fs }).read();
  assert.equal(answer.state, 'unreadable');
  assert.deepEqual(unreadablePaths(answer), [admissionOf(linked)]);
  assert.deepEqual(listed, []);
});

test('admission reads an admission directory or a closer the process may not read as unreadable naming its path', { skip: asRoot && 'root reads past every permission bit, so no read is refused' }, (t) => {
  const directory = stateOf();
  seed(directory, 'owner-a1.json');
  chmodSync(admissionOf(directory), 0o000);
  t.after(() => chmodSync(admissionOf(directory), 0o700));
  const blocked = moduleOver(directory).read();
  assert.equal(blocked.state, 'unreadable');
  assert.deepEqual(unreadablePaths(blocked), [admissionOf(directory)]);
  assert.match(blocked.unreadable[0].cause, /EACCES/);

  const closer = stateOf();
  seed(closer, 'owner-a1.json');
  chmodSync(join(admissionOf(closer), 'owner-a1.json'), 0o000);
  const refused = moduleOver(closer).read();
  assert.equal(refused.state, 'unreadable');
  assert.deepEqual(unreadablePaths(refused), [join(admissionOf(closer), 'owner-a1.json')]);
  assert.match(refused.unreadable[0].cause, /EACCES/);
});

test('admission reads an unreadable closer beside a readable one as unreadable, naming the unreadable one', () => {
  const state = stateOf();
  seed(state, 'owner-a1.json');
  seed(state, 'hold-b1.json', '{ torn');
  const answer = moduleOver(state).read();
  assert.equal(answer.state, 'unreadable');
  assert.deepEqual(unreadablePaths(answer), [join(admissionOf(state), 'hold-b1.json')]);
});

test('admission never reads open where its only listed closer is renamed between the listing and its read', () => {
  const state = stateOf();
  seed(state, 'hold-d4.json');
  const listed = join(admissionOf(state), 'hold-d4.json');
  let moved = false;
  // Injected at the module's open of the closer: the rename lands after the listing named it.
  const fs = fsWith({
    openSync: (path, ...rest) => {
      if (path === listed && !moved) {
        moved = true;
        renameSync(listed, join(admissionOf(state), 'hold-d4-issue-5.json'));
      }
      return fsWith({}).openSync(path, ...rest);
    },
  });
  const answer = moduleOver(state, { fs }).read();
  assert.equal(moved, true);
  assert.equal(answer.state, 'closed');
  assert.deepEqual(closerNames(answer), ['hold-d4-issue-5.json']);
});

test('admission lists again where a listed closer is gone at its read, answering from a listing it read whole', () => {
  const state = stateOf();
  seed(state, 'owner-a1.json');
  seed(state, 'hold-d4.json');
  const listed = join(admissionOf(state), 'hold-d4.json');
  let listings = 0;
  let gone = false;
  // Injected at the module's open of the closer: a removal lands after the listing named it.
  const fs = fsWith({
    readdirSync: (...args) => { listings += 1; return fsWith({}).readdirSync(...args); },
    openSync: (path, ...rest) => {
      if (path === listed && !gone) {
        gone = true;
        rmSync(listed);
      }
      return fsWith({}).openSync(path, ...rest);
    },
  });
  const answer = moduleOver(state, { fs }).read();
  assert.equal(gone, true);
  assert.equal(listings, 2);
  assert.equal(answer.state, 'closed');
  assert.deepEqual(closerNames(answer), ['owner-a1.json']);
});
