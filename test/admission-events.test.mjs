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

test('a close whose event the sink refuses rejects naming the refused event, and the closer it linked still exists', async () => {
  const state = stateOf();
  const { sink } = refusingSink();
  const admissions = moduleOver(state, { sink, ids: () => 'beef' });
  await assert.rejects(admissions.close({ kind: 'owner', reason: 'r' }), (error) => error.message.includes('admission.close') && error.message.includes('owner-beef.json'));
  assert.deepEqual(namesIn(state), ['owner-beef.json']);
  assert.equal(moduleOver(state).read().state, 'closed');
});
