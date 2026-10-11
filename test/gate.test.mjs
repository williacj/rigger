// ABOUTME: Tests the L2 gate's decision from verdict comments, required judges, and check states.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

import { composeMarker, parseMarker } from '../src/workflow/marker.mjs';
import { gateAnswer, GATE_CONTEXT } from '../src/workflow/gate.mjs';
import config from '../rigger.config.mjs';
import { OWNER as GATE_OWNER } from '../src/workflow/gate.mjs';
import { OWNER } from '../src/config/validate.mjs';
import { panelOf } from '../src/workflow/next-action.mjs';

const HEAD = '1'.repeat(40);
const OLD_HEAD = '2'.repeat(40);
const DIGEST = 'a'.repeat(64);
const OLD_DIGEST = 'b'.repeat(64);
const JUDGES = [{ role: 'reviewer', provider: 'claude' }, { role: 'engineer', provider: 'claude' }, { role: 'architect', provider: 'claude' }];
const CHECKS = { 'check (20)': { state: 'passed', creator: null } };

/** One forge comment carrying a marker for a judge, with overridable marker and comment fields. */
function marker(role, fields = {}, comment = {}) {
  const { items = ['met', 'met'], ...rest } = fields;
  return {
    body: composeMarker({ card: 655, pull: 900, head: HEAD, digest: DIGEST, role, provider: role === 'owner' ? undefined : 'claude', verdict: 'sound', items, coverage: 'covered', ...rest }, `Verdict by ${role}`),
    createdAt: '2026-10-10T12:00:00Z', id: `IC_${role}`, author: 'williacj', permission: 'write', edited: false,
    ...comment,
  };
}

/** The rule's named inputs in the forge and marker-reader shapes. */
function input(comments = JUDGES.map(({ role }) => marker(role)), changes = {}) {
  return { comments, card: 655, pull: 900, head: HEAD, digest: DIGEST, count: 2, judges: JUDGES, checks: CHECKS, ...changes };
}

// proves R-GATE-4
test('three fresh sound judges and passed required checks admit', () => {
  assert.deepEqual(gateAnswer(input()), { admit: true });
});

// proves R-GATE-5
test('a missing marker refuses by judge, while the other judges are sound', () => {
  const answer = gateAnswer(input(JUDGES.slice(0, 2).map(({ role }) => marker(role))));
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

// proves R-GATE-2
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
  const sets = [[JUDGES[0]], JUDGES, [...JUDGES, { role: 'owner' }], [{ role: 'owner' }]];
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
  for (const judges of sets) for (const { role } of judges) for (const scenario of cases) {
    const comments = judges.map(({ role: judge }) => judge === role ? scenario.change(marker(judge), judge) : marker(judge)).filter(Boolean);
    const answer = gateAnswer(input(comments, { judges }));
    assert.equal(answer.admit, false, `${JSON.stringify(judges)}: ${role}: ${scenario.name}`);
    assert.equal(answer.refusals.length, 1, `${JSON.stringify(judges)}: ${role}: ${scenario.name}: ${JSON.stringify(answer)}`);
    assert.equal(answer.refusals[0].judge, role);
    assert.match(answer.refusals[0].reason, scenario.reason);
  }
});

// proves R-GATE-4
test('one judge, three judges, three plus owner, and owner alone admit when every marker is sound', () => {
  for (const judges of [[JUDGES[0]], JUDGES, [...JUDGES, { role: 'owner' }], [{ role: 'owner' }]]) {
    assert.deepEqual(gateAnswer(input(judges.map(({ role }) => marker(role)), { judges })), { admit: true }, JSON.stringify(judges));
  }
});

// proves R-GATE-5
test('each configured kind refuses when any one of its judges has no marker', () => {
  for (const [kind, declared] of Object.entries(config.kinds)) {
    const judges = panelOf({ number: 655, labels: declared.select.labels }, declared, config.roles);
    for (const { role: absent } of judges) {
      const answer = gateAnswer(input(judges.filter(({ role }) => role !== absent).map(({ role, provider }) => marker(role, { provider })), { judges }));
      assert.deepEqual(answer, { admit: false, refusals: [{ judge: absent, reason: 'no marker' }] }, `${kind}: ${absent}`);
    }
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
    stale.createdAt = '2026-10-10T13:00:00Z';
    assert.deepEqual(gateAnswer(input([marker('reviewer'), marker('engineer'), stale, marker('architect')])), { admit: true });
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

// proves R-GATE-4
test('an unreadable later marker with invalid head, digest or role cannot displace an earlier sound marker', () => {
  const earlier = marker('engineer', {}, { id: 'IC_1', createdAt: '2026-10-10T11:00:00Z' });
  for (const field of ['head', 'digest', 'role']) {
    const later = marker('engineer', {}, { id: 'IC_2', createdAt: '2026-10-10T12:00:00Z' });
    later.body = later.body.replace(new RegExp(`${field}: [^\\n]+`), `${field}: bad value`);
    assert.equal(parseMarker(later.body, 2).state, 'unreadable', field);
    assert.deepEqual(gateAnswer(input([marker('reviewer'), earlier, later, marker('architect')])), { admit: true }, field);
  }
});

// proves R-GATE-6
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

// proves R-GATE-4
test('a later sound marker governs at every judge position in each judge set', () => {
  for (const judges of [[JUDGES[0]], JUDGES, [...JUDGES, { role: 'owner' }], [{ role: 'owner' }]]) for (const { role } of judges) {
    const earlier = marker(role, { verdict: 'needs revision', toSound: 'Fix it.' }, { id: 'IC_1', createdAt: '2026-10-10T11:00:00Z' });
    const later = marker(role, {}, { id: 'IC_2', createdAt: '2026-10-10T12:00:00Z' });
    const comments = [...judges.filter(({ role: judge }) => judge !== role).map(({ role: judge }) => marker(judge)), earlier, later];
    assert.deepEqual(gateAnswer(input(comments, { judges })), { admit: true }, `${JSON.stringify(judges)}: ${role}`);
  }
});

// proves R-GATE-3, R-GATE-4
test('a role outside the configured judge set is ignored at every judge position', () => {
  for (const judges of [[JUDGES[0]], JUDGES, [...JUDGES, { role: 'owner' }], [{ role: 'owner' }]]) {
    const comments = [...judges.map(({ role }) => marker(role)), marker('outsider', { verdict: 'critical', toSound: 'Fix it.' })];
    assert.deepEqual(gateAnswer(input(comments, { judges })), { admit: true }, JSON.stringify(judges));
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
  const judges = [...JUDGES, { role: 'owner' }];
  const comments = judges.map(({ role }) => role === 'engineer' ? marker(role, { verdict: 'needs revision', toSound: 'Fix it.' }) : marker(role));
  assert.deepEqual(gateAnswer(input(comments, { judges })), { admit: false, refusals: [{ judge: 'engineer', reason: 'verdict needs revision' }] });
});

// proves R-GATE-3
test('the gate context is fixed and the rule imports only the marker reader and reads no clock', () => {
  assert.equal(GATE_CONTEXT, 'rigger/gate');
  const source = readFileSync(new URL('../src/workflow/gate.mjs', import.meta.url), 'utf8');
  const loads = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportDeclaration') loads.push(['import', node.source.value]);
    if (node.type === 'ImportExpression') loads.push(['dynamic import']);
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) loads.push(['re-export', node.source.value]);
    if (node.type === 'CallExpression' && (
      node.callee.name === 'require' || node.callee.name === 'createRequire' ||
      (node.callee.type === 'MemberExpression' && (node.callee.property.name === 'require' || node.callee.property.value === 'require'))
    )) loads.push(['require']);
    for (const child of Object.values(node)) {
      for (const held of Array.isArray(child) ? child : [child]) visit(held);
    }
  }
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  assert.deepEqual(loads, [['import', './marker.mjs']]);
  assert.doesNotMatch(source, /\b(?:Date|performance)\b/);
});

// proves R-GATE-3
test('two runs of the gate on the same inputs give equal answers', () => {
  const facts = input([marker('reviewer'), marker('engineer', { head: OLD_HEAD }), marker('architect')]);
  assert.deepEqual(gateAnswer(facts), gateAnswer(facts));
});

/**
 * The gate's answer for `facts`, asserting the rule left its inputs as they were: the comments,
 * the judges and the checks deep-equal their copies from before it ran.
 */
function answered(facts) {
  const before = structuredClone(facts);
  const answer = gateAnswer(facts);
  assert.deepEqual(facts, before, 'the gate rule changed the facts it was handed');
  return answer;
}

/** An agent judge entry, as the panel function hands the rule one, and the owner's. */
const agent = (role, provider) => ({ role, provider });
const OWNER_ENTRY = { role: 'owner' };

/** `marker(role)` with its `provider` line rewritten to hold `lines`, one line each, or none. */
function withProviderLines(role, lines) {
  const held = marker(role, { provider: undefined });
  held.body = held.body.replace(`role: ${role}\n`, [`role: ${role}`, ...lines.map((line) => `provider: ${line}`), ''].join('\n'));
  return held;
}

// proves R-GATE-9
test('an agent judge\'s marker naming no provider refuses, naming the provider the config requires; the owner\'s naming none admits', () => {
  assert.deepEqual(answered(input([withProviderLines('reviewer', [])], { judges: [agent('reviewer', 'codex')] })), { admit: false, refusals: [{ judge: 'reviewer', reason: 'names no provider; the config requires codex' }] });
  assert.deepEqual(answered(input([withProviderLines('owner', [])], { judges: [OWNER_ENTRY] })), { admit: true });
});

// proves R-GATE-9, R-VERDICT-7
test('a marker whose provider is empty, holds whitespace or is given twice refuses as unreadable, for an agent judge and for the owner', () => {
  for (const lines of [[''], [' codex'], ['co dex'], ['codex', 'codex']]) {
    for (const [role, judges] of [['reviewer', [agent('reviewer', 'codex')]], ['owner', [OWNER_ENTRY]]]) {
      const answer = answered(input([withProviderLines(role, lines)], { judges }));
      assert.equal(answer.admit, false, `${role}: ${JSON.stringify(lines)}`);
      assert.equal(answer.refusals.length, 1, JSON.stringify(answer));
      assert.match(answer.refusals[0].reason, /^unreadable: .*\bprovider\b/, `${role}: ${JSON.stringify(lines)}`);
    }
  }
});

// proves R-GATE-9
test('an agent judge\'s marker on the provider the config requires admits, and one on another provider, a case difference included, refuses naming both', () => {
  assert.deepEqual(answered(input([marker('reviewer', { provider: 'codex' })], { judges: [agent('reviewer', 'codex')] })), { admit: true });
  for (const provider of ['claude', 'Codex']) {
    assert.deepEqual(answered(input([marker('reviewer', { provider })], { judges: [agent('reviewer', 'codex')] })), { admit: false, refusals: [{ judge: 'reviewer', reason: `provider ${provider}; the config requires codex` }] }, provider);
  }
});

// proves R-GATE-9
test('an owner\'s marker naming any well-formed provider refuses, naming it', () => {
  for (const provider of ['codex', 'claude', 'Codex']) {
    assert.deepEqual(answered(input([marker('owner', { provider })], { judges: [OWNER_ENTRY] })), { admit: false, refusals: [{ judge: 'owner', reason: `the owner's marker names a provider: ${provider}` }] }, provider);
  }
});

// proves R-GATE-9
test('an agent entry handed no provider, or one that is not a well-formed name, refuses naming the judge, as a malformed panel', () => {
  for (const entry of [{ role: 'reviewer' }, agent('reviewer', ''), agent('reviewer', 'co dex'), agent('reviewer', 7), agent('reviewer', null)]) {
    assert.deepEqual(answered(input([marker('reviewer')], { judges: [entry] })), { admit: false, refusals: [{ judge: 'reviewer', reason: 'no provider is required of it, so the panel is malformed' }] }, JSON.stringify(entry));
  }
});

// proves R-LOOP-16
test('a conflict in place of every entry refuses the card with the conflict\'s reason and reads no marker', () => {
  const conflict = 'carries labels selecting different providers for its maker role `engineer`: maker:codex (codex), maker:claude (claude)';
  // `null` comments would throw were any marker read.
  assert.deepEqual(answered(input(null, { judges: [{ conflict }], checks: {} })), { admit: false, refusals: [{ judge: '(panel)', reason: conflict }] });
});

// proves R-GATE-9
test('a later marker on another provider displaces an earlier sound one on the required provider, and the gate refuses naming the provider', () => {
  const earlier = marker('reviewer', { provider: 'codex' }, { id: 'IC_1', createdAt: '2026-10-10T11:00:00Z' });
  const later = marker('reviewer', { provider: 'claude' }, { id: 'IC_2', createdAt: '2026-10-10T12:00:00Z' });
  assert.deepEqual(answered(input([earlier, later], { judges: [agent('reviewer', 'codex')] })), { admit: false, refusals: [{ judge: 'reviewer', reason: 'provider claude; the config requires codex' }] });
});

// proves R-GATE-9
test('a marker on the wrong provider with verdict critical refuses naming the provider, not the verdict, and an unreadable one refuses as unreadable first', () => {
  const critical = marker('reviewer', { provider: 'claude', verdict: 'critical', toSound: 'Resolve the blocker.' });
  assert.deepEqual(answered(input([critical], { judges: [agent('reviewer', 'codex')] })), { admit: false, refusals: [{ judge: 'reviewer', reason: 'provider claude; the config requires codex' }] });
  const unreadable = marker('reviewer', { provider: 'claude' });
  unreadable.body = unreadable.body.replace('coverage: covered\n', '');
  assert.deepEqual(answered(input([unreadable], { judges: [agent('reviewer', 'codex')] })), { admit: false, refusals: [{ judge: 'reviewer', reason: 'unreadable: the field coverage is missing' }] });
});

test('the owner\'s name the gate rule spells equals OWNER as the config validator spells it', () => {
  assert.equal(GATE_OWNER, OWNER);
});

// proves R-GATE-3
test('the gate rule reads no config: it imports only the marker reader and names no process, file or config module', () => {
  const source = readFileSync(new URL('../src/workflow/gate.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(([, from]) => from);
  assert.deepEqual(imports, ['./marker.mjs']);
  assert.doesNotMatch(source, /\bprocess\b|readFileSync|rigger\.config|validate\.mjs/);
});
