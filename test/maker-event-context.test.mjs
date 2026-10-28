// ABOUTME: Tests card and optional dispatch identity on the maker settlement's own L2 events.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const CARD = { number: 12, id: 'item-12', column: 'Coding', body: '## Acceptance\n\n- A widget turns blue.\n' };
const CONFIG = { repo: 'acme/widgets', board: { project: 3, columns: { coding: 'Coding', review: 'Review' } } };
const DISPATCH = 'd-11111111-2222-3333-4444-555555555555';
const EXITED = { status: 'fulfilled', value: { exit: 0 } };

/** The injected reader seam answers empty issue comments and caller-selected pull facts. */
function eventWorld(reads = { readIssueComments: async () => [], readPullRequests: async () => ({ open: [], merged: [], closed: [] }) }) {
  const directory = temporaryDirectory('rigger-maker-context-');
  const sink = openSink({ directory, run: 'r-context', now: () => 0 });
  const l2 = columnChanges({ config: CONFIG, sink, reads, items: { moveItem: async () => {} } });
  return { l2, events: () => readEvents(directory) };
}

// A failed start has an allocated maker dispatch even though no dispatch.start was written.
// proves R-RECORD-7
test('maker.failed names the maker dispatch that could not start', async () => {
  const here = eventWorld();
  await here.l2.settled(CARD, { status: 'rejected', reason: Object.assign(new Error('adapter refused'), { code: 'NOT_STARTED' }) }, { dispatch: DISPATCH });
  const [event] = here.events();
  assert.equal(event.event, 'maker.failed');
  assert.equal(event.card, 12);
  assert.equal(event.dispatch, DISPATCH);
});

// Each withholding cause must retain the same dispatch, including failures before PR facts exist.
// proves R-RECORD-7
test('every maker review.withheld cause retains the completed dispatch', async () => {
  const one = { number: 77, head: 'b'.repeat(40), base: 'main' };
  const reviewed = (open) => ({
    readIssueComments: async () => [], readPullRequests: async () => ({ open, merged: [], closed: [] }),
    readMergeBase: async () => ({ head: one.head, mergeBase: 'a'.repeat(40) }), readDiff: async () => '',
    readComments: async () => [], readMergeable: async () => 'mergeable', readEffectiveRules: async () => [], readCheckStates: async () => ({}),
  });
  const cases = [
    ['tip unreadable', reviewed([one]), { tipFailure: new Error('tip unreadable') }],
    ['PR read failed', { readIssueComments: async () => [], readPullRequests: async () => { throw new Error('PR read failed'); } }, { expectedHead: one.head }],
    ['no open pull', reviewed([]), {}],
    ['multiple open pulls', reviewed([one, { ...one, number: 78 }]), {}],
    ['stale head', reviewed([one]), { expectedHead: 'c'.repeat(40), last: true }],
  ];
  for (const [what, reads, options] of cases) {
    const here = eventWorld(reads);
    await assert.rejects(here.l2.settled(CARD, EXITED, { ...options, dispatch: DISPATCH }), { code: 'REVIEW_WITHHELD' });
    const [event] = here.events();
    assert.equal(event.event, 'review.withheld', what);
    assert.equal(event.card, 12, what);
    assert.equal(event.dispatch, DISPATCH, what);
  }
});

// Supplying no dispatch must preserve key absence, rather than inventing a null identity.
// proves R-RECORD-7
test('maker settle without a dispatch omits the dispatch key on failed and withheld events', async () => {
  const failed = eventWorld();
  await failed.l2.settled(CARD, { status: 'rejected', reason: Object.assign(new Error('adapter refused'), { code: 'NOT_STARTED' }) });
  const withheld = eventWorld();
  await assert.rejects(withheld.l2.settled(CARD, EXITED), { code: 'REVIEW_WITHHELD' });
  const events = [...failed.events(), ...withheld.events()];
  assert.deepEqual(events.map((event) => event.event), ['maker.failed', 'review.withheld']);
  for (const event of events) {
    assert.equal(event.card, 12);
    assert.equal(Object.hasOwn(event, 'dispatch'), false);
  }
});
