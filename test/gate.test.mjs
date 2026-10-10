// ABOUTME: Tests the L2 gate's decision from verdict comments, required judges, and check states.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { composeMarker, parseMarker } from '../src/workflow/marker.mjs';
import { gateAnswer, GATE_CONTEXT } from '../src/workflow/gate.mjs';
import config from '../rigger.config.mjs';

const HEAD = '1'.repeat(40);
const OLD_HEAD = '2'.repeat(40);
const DIGEST = 'a'.repeat(64);
const OLD_DIGEST = 'b'.repeat(64);
const JUDGES = ['reviewer', 'engineer', 'architect'];
const CHECKS = { 'check (20)': { state: 'passed', creator: null } };

/** One forge comment carrying a marker for a judge, with overridable marker and comment fields. */
function marker(role, fields = {}, comment = {}) {
  const { items = ['met', 'met'], ...rest } = fields;
  return {
    body: composeMarker({ card: 655, pull: 900, head: HEAD, digest: DIGEST, role, verdict: 'sound', items, coverage: 'covered', ...rest }, `Verdict by ${role}`),
    createdAt: '2026-10-10T12:00:00Z', id: `IC_${role}`, author: 'williacj', permission: 'write', edited: false,
    ...comment,
  };
}

/** The rule's named inputs in the forge and marker-reader shapes. */
function input(comments = JUDGES.map((role) => marker(role)), changes = {}) {
  return { comments, card: 655, pull: 900, head: HEAD, digest: DIGEST, count: 2, judges: JUDGES, checks: CHECKS, ...changes };
}

// proves R-GATE-4
test('three fresh sound judges and passed required checks admit', () => {
  assert.deepEqual(gateAnswer(input()), { admit: true });
});

// proves R-GATE-5
test('a missing marker refuses by judge, while the other judges are sound', () => {
  const answer = gateAnswer(input(JUDGES.slice(0, 2).map((role) => marker(role))));
  assert.deepEqual(answer, { admit: false, refusals: [{ judge: 'architect', reason: 'no marker' }] });
});

// proves R-GATE-2, R-GATE-7
test('a marker at an older head refuses and names the current and latest older head', () => {
  const comments = [marker('reviewer'), marker('engineer'), marker('architect', { head: OLD_HEAD })];
  const answer = gateAnswer(input(comments));
  assert.deepEqual(answer, { admit: false, refusals: [{ judge: 'architect', reason: `stale head: ${OLD_HEAD}; current head: ${HEAD}` }] });
});

// proves R-GATE-7
test('a marker at an older acceptance digest refuses and names the latest older digest', () => {
  const comments = [marker('reviewer'), marker('engineer'), marker('architect', { digest: OLD_DIGEST })];
  assert.deepEqual(gateAnswer(input(comments)), { admit: false, refusals: [{ judge: 'architect', reason: `stale digest: ${OLD_DIGEST}; current digest: ${DIGEST}` }] });
});

// proves R-VERDICT-4, R-GATE-6
test('a sound verdict with an unmet item refuses by judge and item', () => {
  const comments = [marker('reviewer'), marker('engineer', { items: ['met', 'unmet'] }), marker('architect')];
  assert.deepEqual(gateAnswer(input(comments)), { admit: false, refusals: [{ judge: 'engineer', reason: 'item 2 unmet' }] });
});

// proves R-GATE-6
test('a critical verdict refuses by judge despite two sound judges', () => {
  const comments = [marker('reviewer'), marker('engineer', { verdict: 'critical', toSound: 'Fix the fault.' }), marker('architect')];
  assert.deepEqual(gateAnswer(input(comments)), { admit: false, refusals: [{ judge: 'engineer', reason: 'verdict critical' }] });
});

// proves R-GATE-2, R-LOOP-5, R-LOOP-6
test('a governing unreadable marker refuses by judge with the parse reason for missing coverage or item', () => {
  for (const [line, reason] of [['coverage: covered\n', 'the field coverage is missing'], ['item 2: met\n', 'item 2 is missing']]) {
    const broken = marker('engineer');
    broken.body = broken.body.replace(line, '');
    assert.deepEqual(gateAnswer(input([marker('reviewer'), broken, marker('architect')])), { admit: false, refusals: [{ judge: 'engineer', reason: `unreadable: ${reason}` }] });
  }
});

// proves R-GATE-2, R-GATE-6
test('an edited governing marker refuses despite its sound verdict', () => {
  const comments = [marker('reviewer'), marker('engineer', {}, { edited: true }), marker('architect')];
  assert.deepEqual(gateAnswer(input(comments)), { admit: false, refusals: [{ judge: 'engineer', reason: 'marker edited' }] });
});

// proves R-LOOP-6, R-GATE-6
test('insufficient coverage refuses by judge and its reason', () => {
  const comments = [marker('reviewer'), marker('engineer', { coverage: 'insufficient', coverageReason: 'The card omits a failure case.' }), marker('architect')];
  assert.deepEqual(gateAnswer(input(comments)), { admit: false, refusals: [{ judge: 'engineer', reason: 'coverage insufficient: The card omits a failure case.' }] });
});

// proves R-GATE-2, R-GATE-4
test('an empty configured judge list refuses', () => {
  assert.deepEqual(gateAnswer(input([], { judges: [] })), { admit: false, refusals: [{ judge: '(none)', reason: 'no judges configured' }] });
});

// proves R-GATE-8
test('passed and empty check maps admit; failed, pending, absent and unknown states refuse by check', () => {
  assert.deepEqual(gateAnswer(input(undefined, { checks: {} })), { admit: true });
  for (const state of ['failed', 'pending', 'absent', 'unknown']) {
    const reason = state === 'unknown' ? 'unknown check state: unknown' : state;
    assert.deepEqual(gateAnswer(input(undefined, { checks: { build: { state, creator: null } } })), { admit: false, refusals: [{ check: 'build', reason }] }, state);
  }
});

// proves R-GATE-2, R-GATE-5, R-GATE-6, R-GATE-7, R-VERDICT-4, R-LOOP-5, R-LOOP-6
test('each missing, unreadable, stale, unmet, insufficient, revision, critical and edited state refuses at every judge position', () => {
  const sets = [['reviewer'], JUDGES, [...JUDGES, 'owner'], ['owner']];
  const cases = [
    { name: 'missing', change: () => null, reason: /no marker/ },
    { name: 'unreadable', change: (held) => ({ ...held, body: held.body.replace('verdict: sound\n', '') }), reason: /unreadable: the field verdict is missing/ },
    { name: 'older head', change: (held, role) => marker(role, { head: OLD_HEAD }), reason: /stale head/ },
    { name: 'older digest', change: (held, role) => marker(role, { digest: OLD_DIGEST }), reason: /stale digest/ },
    { name: 'unmet item', change: (held, role) => marker(role, { items: ['met', 'unmet'] }), reason: /item 2 unmet/ },
    { name: 'missing coverage', change: (held) => ({ ...held, body: held.body.replace('coverage: covered\n', '') }), reason: /unreadable: the field coverage is missing/ },
    { name: 'missing item', change: (held) => ({ ...held, body: held.body.replace('item 2: met\n', '') }), reason: /unreadable: item 2 is missing/ },
    { name: 'insufficient coverage', change: (held, role) => marker(role, { coverage: 'insufficient', coverageReason: 'Acceptance omits the exit status.' }), reason: /coverage insufficient/ },
    { name: 'needs revision', change: (held, role) => marker(role, { verdict: 'needs revision', toSound: 'Fix the output.' }), reason: /verdict needs revision/ },
    { name: 'critical', change: (held, role) => marker(role, { verdict: 'critical', toSound: 'Resolve the blocker.' }), reason: /verdict critical/ },
    { name: 'edited', change: (held) => ({ ...held, edited: true }), reason: /marker edited/ },
  ];
  for (const judges of sets) for (const role of judges) for (const scenario of cases) {
    const comments = judges.map((judge) => judge === role ? scenario.change(marker(judge), judge) : marker(judge)).filter(Boolean);
    const answer = gateAnswer(input(comments, { judges }));
    assert.equal(answer.admit, false, `${judges.join(', ')}: ${role}: ${scenario.name}`);
    assert.equal(answer.refusals.length, 1, `${judges.join(', ')}: ${role}: ${scenario.name}: ${JSON.stringify(answer)}`);
    assert.equal(answer.refusals[0].judge, role);
    assert.match(answer.refusals[0].reason, scenario.reason);
  }
});

// proves R-GATE-4
test('one judge, three judges, three plus owner, and owner alone admit when every marker is sound', () => {
  for (const judges of [['reviewer'], JUDGES, [...JUDGES, 'owner'], ['owner']]) {
    assert.deepEqual(gateAnswer(input(judges.map((role) => marker(role)), { judges })), { admit: true }, judges.join(', '));
  }
});

// proves R-GATE-5
test('each configured kind refuses when any one of its judges has no marker', () => {
  for (const [kind, { judges }] of Object.entries(config.kinds)) for (const absent of judges) {
    const answer = gateAnswer(input(judges.filter((role) => role !== absent).map((role) => marker(role)), { judges }));
    assert.deepEqual(answer, { admit: false, refusals: [{ judge: absent, reason: 'no marker' }] }, `${kind}: ${absent}`);
  }
});

// proves R-GATE-4, R-GATE-8
test('one failed check and one critical judge both appear in the refusal', () => {
  const comments = [marker('reviewer'), marker('engineer', { verdict: 'critical', toSound: 'Resolve the blocker.' }), marker('architect')];
  assert.deepEqual(gateAnswer(input(comments, { checks: { build: { state: 'failed', creator: null } } })), { admit: false, refusals: [{ judge: 'engineer', reason: 'verdict critical' }, { check: 'build', reason: 'failed' }] });
});

// proves R-GATE-2, R-GATE-5
test('two judges in different refusing states are both named', () => {
  const comments = [marker('reviewer', { head: OLD_HEAD }), marker('architect')];
  const answer = gateAnswer(input(comments));
  assert.deepEqual(answer, { admit: false, refusals: [{ judge: 'reviewer', reason: `stale head: ${OLD_HEAD}; current head: ${HEAD}` }, { judge: 'engineer', reason: 'no marker' }] });
});

// proves R-GATE-7
test('a current sound marker admits beside an older head marker or an older digest revision', () => {
  for (const stale of [marker('engineer', { head: OLD_HEAD }), marker('engineer', { digest: OLD_DIGEST, verdict: 'needs revision', toSound: 'Fix the earlier work.' })]) {
    assert.deepEqual(gateAnswer(input([marker('reviewer'), stale, marker('engineer'), marker('architect')])), { admit: true });
  }
});

// proves R-GATE-6, R-GATE-7
test('a later marker at the current head and digest governs over an earlier sound or revision marker', () => {
  const earlier = marker('engineer', {}, { id: 'IC_1', createdAt: '2026-10-10T11:00:00Z' });
  const revision = marker('engineer', { verdict: 'needs revision', toSound: 'Fix it.' }, { id: 'IC_2', createdAt: '2026-10-10T12:00:00Z' });
  const unreadable = marker('engineer', {}, { id: 'IC_3', createdAt: '2026-10-10T13:00:00Z' });
  unreadable.body = unreadable.body.replace('coverage: covered\n', '');
  const edited = marker('engineer', {}, { id: 'IC_4', createdAt: '2026-10-10T14:00:00Z', edited: true });
  const other = [marker('reviewer'), marker('architect')];
  assert.deepEqual(gateAnswer(input([...other, earlier, revision])), { admit: false, refusals: [{ judge: 'engineer', reason: 'verdict needs revision' }] });
  assert.deepEqual(gateAnswer(input([...other, earlier, unreadable])), { admit: false, refusals: [{ judge: 'engineer', reason: 'unreadable: the field coverage is missing' }] });
  assert.deepEqual(gateAnswer(input([...other, earlier, edited])), { admit: false, refusals: [{ judge: 'engineer', reason: 'marker edited' }] });
  assert.deepEqual(gateAnswer(input([...other, revision, marker('engineer', {}, { id: 'IC_5', createdAt: '2026-10-10T15:00:00Z' })])), { admit: true });
  assert.deepEqual(gateAnswer(input([...other, edited, marker('engineer', {}, { id: 'IC_5', createdAt: '2026-10-10T15:00:00Z' })])), { admit: true });
});

// proves R-GATE-4, R-GATE-7
test('an unreadable later marker with invalid head, digest or role cannot displace an earlier sound marker', () => {
  const earlier = marker('engineer', {}, { id: 'IC_1', createdAt: '2026-10-10T11:00:00Z' });
  for (const field of ['head', 'digest', 'role']) {
    const later = marker('engineer', {}, { id: 'IC_2', createdAt: '2026-10-10T12:00:00Z' });
    later.body = later.body.replace(new RegExp(`${field}: [^\\n]+`), `${field}: bad value`);
    assert.equal(parseMarker(later.body, 2).state, 'unreadable', field);
    assert.deepEqual(gateAnswer(input([marker('reviewer'), earlier, later, marker('architect')])), { admit: true }, field);
  }
});

// proves R-GATE-7
test('equal creation times use the later comment id to choose the governing marker', () => {
  const first = marker('engineer', {}, { id: 'IC_8' });
  const second = marker('engineer', { verdict: 'needs revision', toSound: 'Fix it.' }, { id: 'IC_9' });
  for (const order of [[first, second], [second, first]]) {
    assert.deepEqual(gateAnswer(input([marker('reviewer'), ...order, marker('architect')])), { admit: false, refusals: [{ judge: 'engineer', reason: 'verdict needs revision' }] });
  }
});

// proves R-GATE-2, R-GATE-7
test('the latest readable older marker is named, while an unreadable stale marker counts as none', () => {
  const oldFirst = marker('engineer', { head: OLD_HEAD, digest: OLD_DIGEST }, { id: 'IC_1', createdAt: '2026-10-10T11:00:00Z' });
  const oldLast = marker('engineer', { head: '3'.repeat(40) }, { id: 'IC_2', createdAt: '2026-10-10T12:00:00Z' });
  assert.deepEqual(gateAnswer(input([marker('reviewer'), oldLast, oldFirst, marker('architect')])), { admit: false, refusals: [{ judge: 'engineer', reason: `stale head: ${'3'.repeat(40)}; current head: ${HEAD}` }] });
  const broken = { ...oldLast, body: oldLast.body.replace('coverage: covered\n', '') };
  assert.deepEqual(gateAnswer(input([marker('reviewer'), broken, marker('architect')])), { admit: false, refusals: [{ judge: 'engineer', reason: 'no marker' }] });
});

// proves R-GATE-7
test('the latest readable older digest is named in marker order', () => {
  const first = marker('engineer', { digest: OLD_DIGEST }, { id: 'IC_1', createdAt: '2026-10-10T11:00:00Z' });
  const last = marker('engineer', { digest: 'c'.repeat(64) }, { id: 'IC_2', createdAt: '2026-10-10T12:00:00Z' });
  assert.deepEqual(gateAnswer(input([marker('reviewer'), last, first, marker('architect')])), { admit: false, refusals: [{ judge: 'engineer', reason: `stale digest: ${'c'.repeat(64)}; current digest: ${DIGEST}` }] });
});

// proves R-GATE-4, R-GATE-6
test('a later sound marker governs at every judge position in each judge set', () => {
  for (const judges of [['reviewer'], JUDGES, [...JUDGES, 'owner'], ['owner']]) for (const role of judges) {
    const earlier = marker(role, { verdict: 'needs revision', toSound: 'Fix it.' }, { id: 'IC_1', createdAt: '2026-10-10T11:00:00Z' });
    const later = marker(role, {}, { id: 'IC_2', createdAt: '2026-10-10T12:00:00Z' });
    const comments = [...judges.filter((judge) => judge !== role).map((judge) => marker(judge)), earlier, later];
    assert.deepEqual(gateAnswer(input(comments, { judges })), { admit: true }, `${judges.join(', ')}: ${role}`);
  }
});

// proves R-GATE-3, R-GATE-4
test('a role outside the configured judge set is ignored at every judge position', () => {
  for (const judges of [['reviewer'], JUDGES, [...JUDGES, 'owner'], ['owner']]) {
    const comments = [...judges.map((role) => marker(role)), marker('outsider', { verdict: 'critical', toSound: 'Fix it.' })];
    assert.deepEqual(gateAnswer(input(comments, { judges })), { admit: true }, judges.join(', '));
  }
});

// proves R-GATE-3, R-GATE-5
test('text outside marker blocks and markers for other cards, pulls or roles do not admit', () => {
  const ordinary = { body: 'admit', createdAt: '2026-10-10T13:00:00Z', id: 'IC_text', author: 'williacj', permission: 'write', edited: false };
  const comments = [marker('reviewer'), marker('engineer', { card: 656 }), marker('engineer', { pull: 901 }), marker('outsider'), marker('architect'), ordinary];
  assert.deepEqual(gateAnswer(input(comments)), { admit: false, refusals: [{ judge: 'engineer', reason: 'no marker' }] });
  assert.deepEqual(gateAnswer(input([marker('reviewer'), marker('engineer'), marker('architect'), ordinary])), { admit: true });
});

// proves R-GATE-3, R-GATE-5
test('markers posted without write permission count as no marker', () => {
  for (const permission of ['triage', 'read', 'none']) {
    const comments = [marker('reviewer'), marker('engineer', {}, { permission }), marker('architect')];
    assert.deepEqual(gateAnswer(input(comments)), { admit: false, refusals: [{ judge: 'engineer', reason: 'no marker' }] }, permission);
  }
});

// proves R-GATE-3, R-GATE-6
test('a revision marker cannot say admit in free text, toSound or coverageReason', () => {
  const revision = marker('engineer', { verdict: 'needs revision', toSound: 'admit', coverageReason: 'admit' });
  revision.body = revision.body.replace('Verdict by engineer', 'admit');
  assert.deepEqual(gateAnswer(input([marker('reviewer'), revision, marker('architect')])), { admit: false, refusals: [{ judge: 'engineer', reason: 'verdict needs revision' }] });
});

// proves R-GATE-6
test('an owner sound marker does not offset an agent revision marker', () => {
  const judges = [...JUDGES, 'owner'];
  const comments = judges.map((role) => role === 'engineer' ? marker(role, { verdict: 'needs revision', toSound: 'Fix it.' }) : marker(role));
  assert.deepEqual(gateAnswer(input(comments, { judges })), { admit: false, refusals: [{ judge: 'engineer', reason: 'verdict needs revision' }] });
});

// proves R-GATE-3, R-GATE-4
test('the gate context is fixed and the rule imports only the marker reader and reads no clock', () => {
  assert.equal(GATE_CONTEXT, 'rigger/gate');
  const source = readFileSync(new URL('../src/workflow/gate.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/\bfrom ['"]([^'"]+)['"]/g)].map((match) => match[1]), ['./marker.mjs']);
  assert.doesNotMatch(source, /\b(?:Date|performance)\b/);
});

// proves R-GATE-3
test('two runs of the gate on the same inputs give equal answers', () => {
  const facts = input([marker('reviewer'), marker('engineer', { head: OLD_HEAD }), marker('architect')]);
  assert.deepEqual(gateAnswer(facts), gateAnswer(facts));
});
