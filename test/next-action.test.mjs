// ABOUTME: Tests L2's next action for a card: ignored when no kind selects it or, in Coding or
// Review, when injected freshness says a fresh verdict covers it, refused when two kinds select it
// or the form check refuses it, and otherwise dispatched under its one kind.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import config from '../rigger.config.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';

/** Two kinds, each selected by one label, in the shape a config's `kinds` takes. */
const KINDS = {
  change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] },
  spec: { select: { labels: ['type:spec'] }, maker: 'pm', judges: ['reviewer', 'owner'] },
};

/** A body whose acceptance passes the form check under the title `Add a verb`. */
const PASSING = '## Acceptance\n\n- The verb prints its help.\n';

/** A ready card titled `Add a verb`, numbered `number`, carrying `labels` and `body`. */
const card = (number, labels, body = PASSING) => ({ number, title: 'Add a verb', body, labels });

test('a ready card one kind selects and the form check admits is dispatched under that kind', () => {
  assert.deepEqual(nextAction(card(7, ['type:change']), KINDS), { action: 'dispatch', kind: 'change' });
});

test('a ready card selected by a kind other than the first is dispatched under that kind', () => {
  assert.deepEqual(nextAction(card(15, ['type:spec']), KINDS), { action: 'dispatch', kind: 'spec' });
});

// proves R-SCHED-13
test('a two-label kind selects a card carrying either one of its labels without the other', () => {
  const kinds = { ...KINDS, change: { ...KINDS.change, select: { labels: ['type:change', 'type:fix'] } } };
  assert.deepEqual(nextAction(card(17, ['type:fix']), kinds), { action: 'dispatch', kind: 'change' });
  assert.deepEqual(nextAction(card(18, ['type:change']), kinds), { action: 'dispatch', kind: 'change' });
});

// proves R-SCHED-11, R-SCHED-13
test('a ready card no kind selects is ignored, not refused', () => {
  assert.deepEqual(nextAction(card(8, ['area:demo']), KINDS), { action: 'ignore' });
});

test('a ready card one kind selects and the form check refuses is refused with the form check reason', () => {
  const given = card(9, ['type:change'], 'Context, and no acceptance.');
  assert.deepEqual(nextAction(given, KINDS), { action: 'refuse', card: 9, reason: 'missing acceptance' });
});

test('a ready card one kind selects whose acceptance restates its title is refused with that reason', () => {
  const given = card(10, ['type:change'], '## Acceptance\n\n- Add a verb.\n');
  assert.deepEqual(nextAction(given, KINDS), { action: 'refuse', card: 10, reason: 'restated title' });
});

// proves R-SCHED-11
test('a ready card no kind selects and that has no acceptance is ignored, not refused', () => {
  assert.deepEqual(nextAction(card(11, [], 'Context, and no acceptance.'), KINDS), { action: 'ignore' });
});

// proves R-SCHED-12
test('a ready card two kinds select and the form check admits is refused with a reason naming both kinds', () => {
  const given = card(16, ['type:spec', 'type:change']);
  assert.deepEqual(nextAction(given, KINDS), {
    action: 'refuse',
    card: 16,
    reason: 'selected by more than one kind: change, spec',
  });
});

// proves R-SCHED-12
test('a ready card two kinds select and the form check would refuse is refused with a reason naming both kinds', () => {
  const given = card(12, ['type:spec', 'type:change'], 'Context, and no acceptance.');
  assert.deepEqual(nextAction(given, KINDS), {
    action: 'refuse',
    card: 12,
    reason: 'selected by more than one kind: change, spec',
  });
});

// proves R-SCHED-11
test('a ready card labelled type:epic is ignored under this repository config', () => {
  assert.deepEqual(nextAction(card(13, ['type:epic']), config.kinds), { action: 'ignore' });
});

// proves R-SCHED-11
test('a ready card carrying the declared epic label and type:change is ignored under this repository config, not pulled and not refused', () => {
  const given = card(19, ['type:epic', 'type:change']);
  assert.deepEqual(nextAction(given, config.kinds, config.epicLabel), { action: 'ignore' });
});

test('a ready card carrying the epic label and the labels of two kinds is ignored, not refused for being selected by two kinds', () => {
  const given = card(20, ['type:epic', 'type:change', 'type:spec']);
  assert.deepEqual(nextAction(given, KINDS, 'type:epic'), { action: 'ignore' });
});

test('a config declaring kind:epic has cards carrying kind:epic ignored, and type:epic read as an ordinary label', () => {
  assert.deepEqual(nextAction(card(21, ['kind:epic', 'type:change']), KINDS, 'kind:epic'), { action: 'ignore' });
  assert.deepEqual(
    nextAction(card(22, ['type:epic', 'type:change']), KINDS, 'kind:epic'),
    { action: 'dispatch', kind: 'change' },
  );
});

// ARCHITECTURE.md, below the extension-point table: where the declaration is absent no label marks
// an epic, and every card is selected by the kinds' own labels alone.
test('a config declaring no epic label marks no card an epic, so type:epic is an ordinary label', () => {
  assert.deepEqual(
    nextAction(card(23, ['type:epic', 'type:change']), KINDS),
    { action: 'dispatch', kind: 'change' },
  );
  assert.deepEqual(nextAction(card(24, ['type:epic']), KINDS), { action: 'ignore' });
});

// GitHub holds label names case-insensitively (#301's measurement), so a card carrying `type:bug`
// carries the label a kind declares as `Type:Bug`.

// proves R-SCHED-13
test('a card carrying a kind\'s label under another letter case is dispatched under that kind', () => {
  const kinds = { ...KINDS, bug: { ...KINDS.change, select: { labels: ['Type:Bug'] } } };
  assert.deepEqual(nextAction(card(25, ['type:bug']), kinds), { action: 'dispatch', kind: 'bug' });
});

// proves R-SCHED-11
test('a card carrying a label that differs from a kind\'s by more than letter case is ignored', () => {
  const kinds = { ...KINDS, bug: { ...KINDS.change, select: { labels: ['type:bug'] } } };
  assert.deepEqual(nextAction(card(26, ['type:bugs']), kinds), { action: 'ignore' });
});

// proves R-SCHED-12
test('a card two kinds select under different letter cases is refused naming both, in the config\'s order', () => {
  const kinds = {
    lower: { ...KINDS.change, select: { labels: ['bug'] } },
    title: { ...KINDS.change, select: { labels: ['Bug'] } },
  };
  assert.deepEqual(nextAction(card(27, ['BUG']), kinds), {
    action: 'refuse',
    card: 27,
    reason: 'selected by more than one kind: lower, title',
  });
});

// proves R-SCHED-11
test('a card carrying the epic label under another letter case is ignored, whatever kind it is selected by', () => {
  assert.deepEqual(nextAction(card(28, ['type:epic', 'type:change']), KINDS, 'Type:Epic'), { action: 'ignore' });
});

test('the body of issue #182, labelled type:change, is dispatched under the change kind', () => {
  const issue = JSON.parse(readFileSync(new URL('./fixtures/issue-182.json', import.meta.url), 'utf8'));
  assert.equal(issue.number, 182);
  const given = { ...issue, labels: ['type:change'] };
  assert.deepEqual(nextAction(given, config.kinds), { action: 'dispatch', kind: 'change' });
});

test('two cards differing only in priority and in the column they came from receive the same next action', () => {
  const bodies = [PASSING, 'Context, and no acceptance.'];
  const labelSets = [['type:change'], ['type:epic'], ['type:change', 'type:spec']];
  for (const body of bodies) {
    for (const labels of labelSets) {
      const high = { ...card(14, labels, body), column: 'Ready', fieldValues: { Priority: 'High' } };
      const low = { ...card(14, labels, body), column: 'Coding', fieldValues: { Priority: 'Low' } };
      assert.deepEqual(nextAction(low, KINDS), nextAction(high, KINDS));
    }
  }
});

/** The columns this repository's config declares, by key. */
const COLUMNS = config.board.columns;

/** `card(number, ['type:change'])`, in the column displayed as `column`. */
const cardInColumn = (number, column) => ({ ...card(number, ['type:change']), column });

test('an unclaimed Coding card and an unclaimed Review card that freshness answers "fresh" for are ignored', () => {
  const fresh = () => true;
  for (const column of [COLUMNS.coding, COLUMNS.review]) {
    assert.deepEqual(nextAction(cardInColumn(20, column), KINDS, undefined, { columns: COLUMNS, fresh }), { action: 'ignore' }, column);
  }
});

test('an unclaimed Coding card and an unclaimed Review card that freshness answers "not fresh" for are dispatched under their kind', () => {
  const fresh = () => false;
  for (const column of [COLUMNS.coding, COLUMNS.review]) {
    assert.deepEqual(nextAction(cardInColumn(21, column), KINDS, undefined, { columns: COLUMNS, fresh }), { action: 'dispatch', kind: 'change' }, column);
  }
});

test('with no freshness injected, L2 treats every unclaimed Coding or Review card as not fresh', () => {
  for (const column of [COLUMNS.coding, COLUMNS.review]) {
    assert.deepEqual(nextAction(cardInColumn(22, column), KINDS, undefined, { columns: COLUMNS }), { action: 'dispatch', kind: 'change' }, column);
    assert.deepEqual(nextAction(cardInColumn(22, column), KINDS), { action: 'dispatch', kind: 'change' }, column);
  }
});

test('freshness is read for Coding and Review cards alone: a Ready card is dispatched whatever it answers', () => {
  const asked = [];
  const fresh = (given) => {
    asked.push(given.number);
    return true;
  };
  assert.deepEqual(nextAction(cardInColumn(23, COLUMNS.ready), KINDS, undefined, { columns: COLUMNS, fresh }), { action: 'dispatch', kind: 'change' });
  assert.deepEqual(asked, []);
});

test('freshness injected with no declared columns is refused, rather than read for no card', () => {
  assert.throws(() => nextAction(cardInColumn(24, COLUMNS.coding), KINDS, undefined, { fresh: () => true }), /freshness was injected with no declared columns/);
});
