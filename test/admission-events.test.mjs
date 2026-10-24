// ABOUTME: Tests the L3 events L3's admission module records for each change of admission: one per
// close, opening and closer `resume` removes, each after its write, and a refused one failing the call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  admissionOf, fsWith, moduleOver, namesIn, recordingSink, refusingSink, seed, stateOf,
} from './admission-world.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';

test('each close records exactly one L3 admission.close event through L5\'s sink, naming its kind, id and reason', async () => {
  const state = stateOf();
  const sink = openSink({ directory: state, run: 'r-events', now: () => 1_764_000_000_000 });
  const admissions = moduleOver(state, { sink });
  const owner = await admissions.close({ kind: 'owner', reason: 'the owner paused' });
  const hold = await admissions.close({ kind: 'hold', reason: 'two failures' });
  const events = readEvents(state).map(({ ts, ...event }) => event);
  assert.deepEqual(events, [
    { run: 'r-events', layer: 'L3', event: 'admission.close', kind: 'owner', id: owner.id, name: owner.name, reason: 'the owner paused' },
    { run: 'r-events', layer: 'L3', event: 'admission.close', kind: 'hold', id: hold.id, name: hold.name, reason: 'two failures' },
  ]);
});

test('a close that rejects records no admission event', async () => {
  const state = stateOf();
  const { sink, events } = recordingSink();
  await assert.rejects(moduleOver(state, { sink }).close({ kind: 'ci', reason: 'x' }));
  // Injected at the module's link, which no real directory here refuses on demand.
  const fs = fsWith({ linkSync: () => { throw Object.assign(new Error('EIO: injected, link'), { code: 'EIO' }); } });
  await assert.rejects(moduleOver(state, { sink, fs }).close({ kind: 'hold', reason: 'x' }));
  assert.deepEqual(events, []);
});

test('each opening that removes a hold closer records exactly one L3 admission.open event naming its kind and id', async () => {
  const state = stateOf();
  seed(state, 'hold-b1-issue-4.json');
  seed(state, 'owner-a1.json');
  const { events, ...admissions } = moduleOver(state);
  await admissions.open('hold-b1-issue-4.json');
  assert.deepEqual(events, [{ layer: 'L3', event: 'admission.open', kind: 'hold', id: 'b1', name: 'hold-b1-issue-4.json', by: 'opening' }]);
});

test('a resume removal records one L3 admission.open event for each closer it removes, naming its kind and id and that resume raised it', async () => {
  const state = stateOf();
  seed(state, 'owner-a1.json');
  seed(state, 'hold-b1-after-2.json');
  const { events, ...admissions } = moduleOver(state);
  await admissions.resume();
  assert.deepEqual(events.sort((a, b) => a.id.localeCompare(b.id)), [
    { layer: 'L3', event: 'admission.open', kind: 'owner', id: 'a1', name: 'owner-a1.json', by: 'resume' },
    { layer: 'L3', event: 'admission.open', kind: 'hold', id: 'b1', name: 'hold-b1-after-2.json', by: 'resume' },
  ]);
});

test('a resume removal records one event for each closer name it removes, where two hold names carry one id', async () => {
  const state = stateOf();
  seed(state, 'hold-a1.json');
  seed(state, 'hold-a1-issue-3.json');
  const { events, ...admissions } = moduleOver(state);
  await admissions.resume();
  assert.deepEqual(namesIn(state), []);
  assert.deepEqual(events.map(({ name }) => name).sort(), ['hold-a1-issue-3.json', 'hold-a1.json']);
  assert.deepEqual(events.map(({ kind, id, by }) => [kind, id, by]), [['hold', 'a1', 'resume'], ['hold', 'a1', 'resume']]);
});

test('each event is recorded after its write: the sink finds a close\'s closer linked, and an opening\'s or resume\'s gone', async () => {
  const state = stateOf();
  const seen = [];
  const { sink } = recordingSink((event, fields) => {
    seen.push({ event, by: fields.by, present: existsSync(join(admissionOf(state), fields.name)), names: readdirSync(admissionOf(state)) });
  });
  const admissions = moduleOver(state, { sink });
  const made = await admissions.close({ kind: 'hold', reason: 'r' });
  await admissions.open(made.name);
  await admissions.close({ kind: 'owner', reason: 'r' });
  await admissions.resume();
  assert.deepEqual(seen.map(({ event, by, present }) => [event, by, present]), [
    ['admission.close', undefined, true],
    ['admission.open', 'opening', false],
    ['admission.close', undefined, true],
    ['admission.open', 'resume', false],
  ]);
  assert.equal(seen[0].names.some((name) => name.startsWith('.tmp-')), false);
});

test('a close whose event the sink refuses rejects naming the refused event, and the closer it linked still exists', async () => {
  const state = stateOf();
  const { sink } = refusingSink();
  const admissions = moduleOver(state, { sink, ids: () => 'beef' });
  await assert.rejects(admissions.close({ kind: 'owner', reason: 'r' }), (error) => error.message.includes('admission.close') && error.message.includes('owner-beef.json'));
  assert.deepEqual(namesIn(state), ['owner-beef.json']);
  assert.equal(moduleOver(state).read().state, 'closed');
});

test('an opening or a resume removal whose event the sink refuses rejects naming the refused event, and each closer it removed is still gone', async () => {
  const opened = stateOf();
  seed(opened, 'hold-b1.json');
  await assert.rejects(moduleOver(opened, { sink: refusingSink().sink }).open('hold-b1.json'), (error) => error.message.includes('admission.open') && error.message.includes('hold-b1.json'));
  assert.deepEqual(namesIn(opened), []);

  const resumed = stateOf();
  seed(resumed, 'owner-a1.json');
  await assert.rejects(moduleOver(resumed, { sink: refusingSink().sink }).resume(), (error) => error.message.includes('admission.open') && error.message.includes('owner-a1.json'));
  assert.deepEqual(namesIn(resumed), []);
});
