// ABOUTME: Tests admission.mjs renaming a hold's closer to attach where its notice can be: each name
// carries the hold's id, its content stays, another closer is untouched, and a gone closer says so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { admissionOf, closerText, moduleOver, namesIn, picture, seed, stateOf } from './admission-world.mjs';

/** A hold closer's content, as `seed` writes it, naming the card it held. */
const HELD = closerText({ reason: 'card #9 was held' });

// proves R-SCHED-20
test('a hold\'s closer renamed to after a number, then to an issue, then to another issue, carries the hold\'s id in every name and keeps its content', () => {
  const state = stateOf();
  seed(state, 'hold-a1.json', HELD);
  const module = moduleOver(state);

  const after = module.rename('hold-a1.json', { rename: 'after', number: 100 });
  const issue = module.rename(after.name, { rename: 'issue', number: 102 });
  const moved = module.rename(issue.name, { rename: 'issue', number: 140 });

  assert.deepEqual([after.name, issue.name, moved.name], ['hold-a1-after-100.json', 'hold-a1-issue-102.json', 'hold-a1-issue-140.json']);
  assert.deepEqual(namesIn(state), ['hold-a1-issue-140.json']);
  assert.equal(readFileSync(join(admissionOf(state), 'hold-a1-issue-140.json'), 'utf8'), HELD);
  assert.deepEqual(module.events.map(({ event, id, from, to }) => ({ event, id, from, to })), [
    { event: 'admission.rename', id: 'a1', from: 'hold-a1.json', to: 'hold-a1-after-100.json' },
    { event: 'admission.rename', id: 'a1', from: 'hold-a1-after-100.json', to: 'hold-a1-issue-102.json' },
    { event: 'admission.rename', id: 'a1', from: 'hold-a1-issue-102.json', to: 'hold-a1-issue-140.json' },
  ]);
  assert.ok(module.events.every(({ layer }) => layer === 'L3'));
});

// proves R-SCHED-20
test('a rename that finds its closer gone answers so, records nothing and makes no file', () => {
  const state = stateOf();
  seed(state, 'owner-o1.json');
  const module = moduleOver(state);

  const renamed = module.rename('hold-a1.json', { rename: 'after', number: 100 });

  assert.deepEqual(renamed, { gone: true });
  assert.deepEqual(namesIn(state), ['owner-o1.json']);
  assert.deepEqual(module.events, []);
});

// proves R-SCHED-20
test('no rename touches another closer\'s file, the owner\'s or another hold\'s', () => {
  const state = stateOf();
  seed(state, 'owner-o1.json');
  seed(state, 'hold-b2-issue-7.json', closerText({ reason: 'card #4 was held' }));
  seed(state, 'hold-a1.json', HELD);
  const others = () => Object.fromEntries(Object.entries(picture(admissionOf(state))).filter(([name]) => !name.startsWith('hold-a1')));
  const before = others();
  const module = moduleOver(state);

  module.rename('hold-a1.json', { rename: 'issue', number: 7 });

  assert.deepEqual(others(), before);
  assert.deepEqual(namesIn(state), ['hold-a1-issue-7.json', 'hold-b2-issue-7.json', 'owner-o1.json']);
});

// proves R-SCHED-20
test('admission refuses to rename an owner\'s closer, or to a name carrying no number, and changes nothing', () => {
  const state = stateOf();
  seed(state, 'owner-o1.json');
  seed(state, 'hold-a1.json', HELD);
  const before = picture(admissionOf(state));
  const module = moduleOver(state);

  assert.throws(() => module.rename('owner-o1.json', { rename: 'issue', number: 7 }), /renames only a hold closer/);
  assert.throws(() => module.rename('hold-a1.json', { rename: 'issue', number: 0 }), /renames only a hold closer/);
  assert.throws(() => module.rename('hold-a1.json', { rename: 'elsewhere', number: 7 }), /renames only a hold closer/);
  assert.deepEqual(picture(admissionOf(state)), before);
  assert.deepEqual(module.events, []);
});
