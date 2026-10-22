// ABOUTME: Tests L2's next action for a card: ignored when no kind selects it or, in Coding or
// Review, when its markers say a fresh verdict covers it, refused when two kinds select it
// or the form check refuses it, and otherwise dispatched under its one kind.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import config from '../rigger.config.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { acceptanceDigest, composeMarker } from '../src/workflow/marker.mjs';
import { panelOf, providerOf } from '../src/workflow/next-action.mjs';
import * as nextActionModule from '../src/workflow/next-action.mjs';

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

/**
 * Card `number` in the column displayed as `column`, `stage` its key, with the facts L2's facts
 * call holds for it: where `sound`, one open pull request whose reviewer's marker at its head is
 * sound and whose mergeability the forge cannot yet say, and otherwise nothing on the forge.
 */
function withFacts(number, column, stage, sound) {
  const head = 'a'.repeat(40);
  const marker = composeMarker({ card: number, pull: 10 * number, head, digest: acceptanceDigest(PASSING), role: 'reviewer', provider: 'claude', verdict: 'sound', items: ['met'], coverage: 'covered' }, 'Sound, by reviewer');
  const read = (value) => ({ status: 'fulfilled', value });
  const forge = sound
    ? {
      stage, line: `rigger-${number}`, branch: true, open: [{ number: 10 * number, head, base: 'main' }], merged: [],
      pull: read({ number: 10 * number, base: 'c'.repeat(40), head }), diff: read(''), mergeable: read('unknown'), rules: read([]), checks: read({}),
      comments: read([{ body: marker, createdAt: '2026-10-01T11:00:00Z', id: 'IC_1', author: 'williacj', permission: 'write', edited: false }]),
    }
    : { stage, line: `rigger-${number}`, branch: false, open: [], merged: [] };
  return { ...cardInColumn(number, column), forge };
}

/** An L5 sink that records nothing, for an answer that records a marker it read. */
const quiet = { emitter: () => ({ emit: () => {} }) };

test('an unclaimed Coding card and an unclaimed Review card whose markers make them fresh are ignored', () => {
  for (const [stage, column] of [['coding', COLUMNS.coding], ['review', COLUMNS.review]]) {
    assert.equal(nextAction(withFacts(20, column, stage, true), KINDS, undefined, { sink: quiet }).action, 'ignore', column);
  }
});

test('an unclaimed Coding card and an unclaimed Review card no marker makes fresh are dispatched under their kind', () => {
  for (const [stage, column] of [['coding', COLUMNS.coding], ['review', COLUMNS.review]]) {
    assert.deepEqual(nextAction(withFacts(21, column, stage, false), KINDS, undefined, { sink: quiet }), { action: 'dispatch', kind: 'change' }, column);
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

test('nextAction no longer accepts an injected fresh: given { fresh: () => true } and markers at an older head, it still answers a judge dispatch', () => {
  const body = PASSING;
  const older = composeMarker({ card: 25, pull: 250, head: 'b'.repeat(40), digest: acceptanceDigest(body), role: 'reviewer', verdict: 'sound', items: ['met'], coverage: 'covered' }, 'Sound, by reviewer');
  const given = {
    ...cardInColumn(25, COLUMNS.review),
    forge: {
      stage: 'review', line: 'rigger-25', branch: true, open: [{ number: 250, head: 'a'.repeat(40), base: 'main' }], merged: [],
      pull: { status: 'fulfilled', value: { number: 250, base: 'c'.repeat(40), head: 'a'.repeat(40) } },
      diff: { status: 'fulfilled', value: 'diff --git a/x b/x\n' },
      comments: { status: 'fulfilled', value: [{ body: older, createdAt: '2026-10-01T11:00:00Z', id: 'IC_1', author: 'williacj', permission: 'write', edited: false }] },
    },
  };

  for (const options of [{ fresh: () => true }, { columns: COLUMNS, fresh: () => true }]) {
    const next = nextAction(given, KINDS, undefined, { ...options, roles: config.roles });

    assert.equal(next.action, 'judge', JSON.stringify(next));
    assert.deepEqual(next.judges.map((judge) => judge.role), ['reviewer']);
  }
});

/**
 * Roles for the provider cells below, written by hand: the maker `engineer` on `claude` unless a
 * `maker:codex` card label selects `codex`, and `reviewer` and `architect` on `claude`, `reviewer`
 * selecting `codex` where a card carries `judge:codex`.
 */
const PROVIDER_ROLES = {
  engineer: { agent: '.claude/agents/engineer.md', provider: 'claude', tier: 'standard', providerLabels: { 'maker:codex': 'codex', 'maker:claude': 'claude' } },
  reviewer: { agent: '.claude/agents/reviewer.md', provider: 'claude', tier: 'high', providerLabels: { 'judge:codex': 'codex', 'judge:claude': 'claude' } },
  architect: { agent: '.claude/agents/architect.md', provider: 'claude', tier: 'high' },
};

/** A `change` kind made by `engineer` and judged by `judges`. */
const judgedBy = (judges) => ({ select: { labels: ['type:change'] }, maker: 'engineer', judges });

// proves R-LOOP-16
test('a maker carrying none of its providerLabels runs on its provider, and one carrying a selecting label on the provider it selects', () => {
  assert.deepEqual(providerOf(card(1, ['type:change']), 'engineer', PROVIDER_ROLES.engineer), { provider: 'claude' });
  assert.deepEqual(providerOf(card(1, ['type:change', 'maker:codex']), 'engineer', PROVIDER_ROLES.engineer), { provider: 'codex' });
  assert.deepEqual(providerOf(card(1, ['type:change', 'Maker:Codex']), 'engineer', PROVIDER_ROLES.engineer), { provider: 'codex' });
});

// proves R-LOOP-16
test('a card carrying two labels that select different providers for one role is a conflict naming the role and each label', () => {
  const answer = providerOf(card(1, ['type:change', 'maker:codex', 'maker:claude']), 'engineer', PROVIDER_ROLES.engineer);
  assert.equal(answer.provider, undefined);
  assert.match(answer.conflict, /`engineer`/);
  assert.match(answer.conflict, /maker:codex \(codex\)/);
  assert.match(answer.conflict, /maker:claude \(claude\)/);
});

// proves R-LOOP-16
test('nextAction refuses a card whose labels select two providers for its maker, naming the role and each label, and dispatches its maker on the provider providerOf answers', () => {
  const kinds = { change: judgedBy(['reviewer']) };
  const given = card(30, ['type:change', 'maker:codex', 'maker:claude']);
  const before = structuredClone(given);
  const refused = nextAction(given, kinds, undefined, { roles: PROVIDER_ROLES });
  assert.deepEqual(given, before, 'L2 changed the card it refused');
  assert.equal(refused.action, 'refuse', JSON.stringify(refused));
  assert.match(refused.reason, /`engineer`.*maker:codex \(codex\).*maker:claude \(claude\)/);
  const sink = { emitter: () => ({ emit: () => {} }) };
  for (const [labels, provider] of [[[], 'claude'], [['maker:codex'], 'codex']]) {
    const next = nextAction(card(31, ['type:change', ...labels]), kinds, undefined, { roles: PROVIDER_ROLES, provisioning: {}, sink });
    assert.equal(next.maker?.provider, provider, JSON.stringify(next));
    assert.equal(next.maker.agent, '.claude/agents/engineer.md');
  }
});

// proves R-LOOP-16, R-LOOP-17
test('the panel function answers each judge entry in the kind\'s order: the owner by its role, a plain name on its role\'s provider label-selected, a fixed rule on its provider, and a map on its value for the maker\'s provider', () => {
  const kind = judgedBy([
    'reviewer',
    { role: 'architect', provider: 'codex' },
    'owner',
  ]);
  assert.deepEqual(panelOf(card(1, ['type:change']), kind, PROVIDER_ROLES), [{ role: 'reviewer', provider: 'claude' }, { role: 'architect', provider: 'codex' }, { role: 'owner' }]);
  assert.deepEqual(panelOf(card(1, ['type:change', 'judge:codex']), kind, PROVIDER_ROLES), [{ role: 'reviewer', provider: 'codex' }, { role: 'architect', provider: 'codex' }, { role: 'owner' }]);
  const mapped = judgedBy([{ role: 'reviewer', provider: { claude: 'codex', codex: 'claude' } }, 'owner']);
  assert.deepEqual(panelOf(card(1, ['type:change']), mapped, PROVIDER_ROLES), [{ role: 'reviewer', provider: 'codex' }, { role: 'owner' }]);
  assert.deepEqual(panelOf(card(1, ['type:change', 'maker:codex']), mapped, PROVIDER_ROLES), [{ role: 'reviewer', provider: 'claude' }, { role: 'owner' }]);
});

// proves R-LOOP-17
test('a judge entry carrying a rule reads neither its role\'s provider nor its providerLabels, so labels selecting two providers for that role are no conflict', () => {
  const given = card(1, ['type:change', 'judge:codex', 'judge:claude']);
  assert.deepEqual(panelOf(given, judgedBy([{ role: 'reviewer', provider: 'codex' }]), PROVIDER_ROLES), [{ role: 'reviewer', provider: 'codex' }]);
  assert.deepEqual(panelOf(given, judgedBy([{ role: 'reviewer', provider: { claude: 'claude' } }]), { ...PROVIDER_ROLES, reviewer: { ...PROVIDER_ROLES.reviewer, provider: 'codex' } }), [{ role: 'reviewer', provider: 'claude' }]);
});

// proves R-LOOP-16
test('the panel function answers one conflict in place of every entry where the card\'s labels select two providers for the maker or for a plain-named judge', () => {
  const kind = judgedBy(['reviewer', { role: 'architect', provider: 'codex' }, 'owner']);
  const maker = panelOf(card(1, ['type:change', 'maker:codex', 'maker:claude']), kind, PROVIDER_ROLES);
  assert.equal(maker.length, 1, JSON.stringify(maker));
  assert.deepEqual(Object.keys(maker[0]), ['conflict']);
  assert.match(maker[0].conflict, /`engineer`.*maker:codex \(codex\).*maker:claude \(claude\)/);
  const judge = panelOf(card(1, ['type:change', 'judge:codex', 'judge:claude']), kind, PROVIDER_ROLES);
  assert.equal(judge.length, 1, JSON.stringify(judge));
  assert.match(judge[0].conflict, /judge role `reviewer`.*judge:codex \(codex\).*judge:claude \(claude\)/);
});

test('the panel function and providerOf are exported from next-action.mjs beside tierOf', () => {
  for (const name of ['panelOf', 'providerOf', 'tierOf']) assert.equal(typeof nextActionModule[name], 'function', name);
});

// proves R-LOOP-16, R-GATE-9
test('handed this repository\'s config, the panel function requires codex of every agent judge without maker:codex and answers the owner by its role', () => {
  for (const [name, kind] of Object.entries(config.kinds)) {
    const panel = panelOf(card(1, kind.select.labels), kind, config.roles);
    assert.equal(panel.length, kind.judges.length, `${name}: ${JSON.stringify(panel)}`);
    for (const entry of panel) {
      if (entry.role === 'owner') assert.deepEqual(entry, { role: 'owner' }, name);
      else assert.equal(entry.provider, 'codex', `${name}: ${entry.role}`);
    }
  }
});

test('a maker:codex change card requires codex of its reviewer and of its architect', () => {
  const kind = config.kinds.change;
  const given = card(1, [...kind.select.labels, 'maker:codex']);
  assert.deepEqual(providerOf(given, 'engineer', config.roles.engineer), { provider: 'codex' });
  assert.deepEqual(panelOf(given, kind, config.roles), [{ role: 'reviewer', provider: 'codex' }, { role: 'architect', provider: 'codex' }]);
});

// proves R-ESCALATE-10
test('an escalation label leaves every unmerged active-stage card waiting before selection and form refusals', () => {
  const roles = {
    ...config.roles,
    engineer: {
      ...config.roles.engineer,
      labels: { 'tier:standard': 'standard', 'tier:high': 'high' },
      providerLabels: { 'provider:claude': 'claude', 'provider:codex': 'codex' },
    },
  };
  const cases = [
    { name: 'valid', labels: ['type:change'], body: PASSING },
    { name: 'missing acceptance', labels: ['type:change'], body: '' },
    { name: 'restated title', labels: ['type:change'], body: '## Acceptance\n\n- Add a verb.\n' },
    { name: 'unselected', labels: ['area:other'], body: PASSING },
    { name: 'several kinds', labels: ['type:change', 'type:spec'], body: PASSING },
    { name: 'epic', labels: ['type:change', 'type:epic'], body: PASSING },
    { name: 'tier conflict', labels: ['type:change', 'tier:standard', 'tier:high'], body: PASSING },
    { name: 'provider conflict', labels: ['type:change', 'provider:claude', 'provider:codex'], body: PASSING },
  ];
  for (const stage of ['ready', 'coding', 'review', 'owner']) {
    for (const label of ['rigger:escalated', 'RIGGER:ESCALATED']) {
      for (const branch of [false, true]) {
        for (const each of cases) {
          const given = {
            ...card(7, [...each.labels, label], each.body),
            forge: { stage, line: 'rigger-7', branch, open: [], merged: [] },
          };
          assert.deepEqual(nextAction(given, KINDS, 'type:epic', { roles }),
            { action: 'ignore', escalated: true }, `${stage}/${label}/${branch}/${each.name}`);
        }
      }
    }
  }
});

// proves R-ESCALATE-10
test('a labelled merged card keeps its ordinary stage answer and an escalation diagnostic', () => {
  for (const stage of ['ready', 'coding', 'review', 'owner']) {
    for (const label of ['rigger:escalated', 'Rigger:Escalated']) {
      for (const branch of [false, true]) {
        for (const labels of [['type:change'], ['area:other'], ['type:change', 'type:epic']]) {
          const forge = { stage, line: 'rigger-7', branch, open: [], merged: [{ number: 71 }] };
          const given = { ...card(7, labels), forge };
          const answer = nextAction({ ...given, labels: [...labels, label] }, KINDS, 'type:epic');
          assert.equal(answer.escalated, true, `${stage}/${label}/${branch}/${labels}`);
          if (!labels.includes('type:change') || labels.includes('type:epic')) assert.deepEqual(answer, { action: 'ignore', escalated: true });
          else if (['review', 'owner'].includes(stage)) assert.deepEqual(answer, { action: 'move', to: 'done', escalated: true });
          else {
            assert.equal(answer.action, 'refuse');
            assert.equal(answer.card, 7);
            assert.match(answer.reason, /#71, merged/);
          }
        }
      }
    }
  }
});


/** Facts of an open pull whose markers and merge gate admit the requested ordinary decision. */
function openPullDecision(stage, { reviewer, owner, ownerPanel = false, rounds } = {}) {
  const head = '6'.repeat(40);
  const comment = (role, ruling) => ({
    body: composeMarker({ card: 7, pull: 71, head, digest: acceptanceDigest(PASSING), role,
      ...(role === 'owner' ? {} : { provider: 'claude' }), verdict: 'sound', items: ['met'], coverage: 'covered', ...ruling }, `Ruled by ${role}`),
    createdAt: '2026-10-01T11:00:00Z', id: `IC_${role}`, author: 'williacj', permission: 'write', edited: false,
  });
  const comments = [
    ...(reviewer === undefined ? [] : [comment('reviewer', reviewer)]),
    ...(owner === undefined ? [] : [comment('owner', owner)]),
  ];
  const read = (value) => ({ status: 'fulfilled', value });
  return {
    given: { ...card(7, ['type:change']), forge: {
      stage, line: 'rigger-7', branch: true, open: [{ number: 71, head, base: 'main' }], merged: [],
      pull: read({ number: 71, base: '7'.repeat(40), head }), diff: read('diff --git a/x b/x\n'),
      comments: read(comments), mergeable: read('mergeable'), rules: read([]), checks: read({}),
    } },
    kinds: { change: { ...KINDS.change, judges: ownerPanel ? ['reviewer', 'owner'] : ['reviewer'], ...(rounds === undefined ? {} : { rounds }) } },
  };
}

// proves R-ESCALATE-10
test('the label guard crosses every active stage and zero, one or several open pulls independently of branch presence', () => {
  for (const stage of ['ready', 'coding', 'review', 'owner']) {
    for (const branch of [false, true]) {
      for (const count of [0, 1, 2]) {
        for (const label of ['rigger:escalated', 'RIGGER:ESCALATED']) {
          const given = { ...card(7, ['type:change', label]), forge: {
            stage, line: 'rigger-7', branch, merged: [],
            open: Array.from({ length: count }, (_, at) => ({ number: 71 + at, head: '6'.repeat(40), base: 'main' })),
          } };
          assert.deepEqual(nextAction(given, KINDS, undefined, { roles: PROVIDER_ROLES, sink: quiet }),
            { action: 'ignore', escalated: true }, `${stage}/${branch}/${count}/${label}`);
        }
      }
    }
  }
});

// proves R-ESCALATE-10, R-ESCALATE-11
test('an open-pull label withholds each reachable ordinary judge, merge, escalation, return and column move', () => {
  const critical = { verdict: 'critical', toSound: 'Keep the user files.' };
  const revision = { verdict: 'needs revision', items: ['unmet'], toSound: 'Print a help line.' };
  const insufficient = { coverage: 'insufficient', coverageReason: 'The card asks for two verbs.' };
  const cases = [
    { name: 'Review owed judge', stage: 'review', action: 'judge' },
    { name: 'Review merge', stage: 'review', reviewer: {}, action: 'merge' },
    { name: 'Owner merge', stage: 'owner', reviewer: {}, owner: {}, ownerPanel: true, action: 'merge' },
    { name: 'Review critical', stage: 'review', reviewer: critical, action: 'escalate', category: 'critical' },
    { name: 'Owner agent critical', stage: 'owner', reviewer: critical, ownerPanel: true, action: 'escalate', category: 'critical' },
    { name: 'Owner owner critical', stage: 'owner', reviewer: {}, owner: critical, ownerPanel: true, action: 'escalate', category: 'critical' },
    { name: 'Review spent round', stage: 'review', reviewer: revision, rounds: 1, action: 'escalate', category: 'ambiguous' },
    { name: 'Review return', stage: 'review', reviewer: insufficient, action: 'return' },
    { name: 'Owner return', stage: 'owner', reviewer: {}, owner: insufficient, ownerPanel: true, action: 'return' },
    { name: 'Review move to Owner', stage: 'review', reviewer: {}, ownerPanel: true, action: 'move', to: 'owner' },
    { name: 'Owner move to Review', stage: 'owner', owner: {}, ownerPanel: true, action: 'move', to: 'review' },
    { name: 'Coding revision', stage: 'coding', reviewer: revision, action: 'continue' },
    { name: 'Review revision', stage: 'review', reviewer: revision, action: 'continue' },
    { name: 'Owner revision', stage: 'owner', reviewer: {}, owner: revision, ownerPanel: true, action: 'continue' },
  ];
  for (const each of cases) {
    const { given, kinds } = openPullDecision(each.stage, each);
    const options = { roles: PROVIDER_ROLES, sink: quiet };
    const ordinary = nextAction(given, kinds, undefined, options);
    assert.equal(ordinary.action, each.action, `${each.name}: ${JSON.stringify(ordinary)}`);
    if (each.category !== undefined) assert.equal(ordinary.category, each.category, each.name);
    if (each.to !== undefined) assert.equal(ordinary.to, each.to, each.name);
    for (const label of ['rigger:escalated', 'RIGGER:ESCALATED']) {
      const labelled = { ...given, labels: [...given.labels, label] };
      assert.deepEqual(nextAction(labelled, kinds, undefined, options), { action: 'ignore', escalated: true }, each.name);
    }
  }
});
