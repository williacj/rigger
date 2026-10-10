// ABOUTME: Tests L2's verdict marker: its syntax, the parse of each marker state, the acceptance
// and evidence digests, the instruction that asks a judge for one, and the one read of a pull
// request's comments that finds each role's governing marker.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { acceptanceDigest, composeMarker, dispatched, evidenceDigest, markerInstruction, parseMarker, readMarkers, VERDICTS } from '../src/workflow/marker.mjs';

/** A body whose acceptance holds two items, with a section after it, and its digest, from `shasum -a 256` over the two items each followed by LF. */
const BODY = '## Acceptance\n\n- The verb prints its help.\n- The verb exits 0.\n\n## Notes\n\n- Not an item.\n';
const DIGEST = 'e083e751931787e01f4710d2a5068c3a4eaaf329fa3d50ceaca815c71b5cf525';

/** A head SHA, an evidence digest and a dispatch id in the form L3 mints, each written by hand. */
const HEAD = '1111111111111111111111111111111111111111';
const EARLIER = '3333333333333333333333333333333333333333';
const EVIDENCE = 'abababababababababababababababababababababababababababababababab';
const DISPATCH = 'd-0f8e3c1a-4b2d-4c6e-9a7b-1d2e3f4a5b6c';

/** The lines of a well-formed marker block's body for `role`, every item of two ruled met, `changes` replacing or, as null, removing a field. */
function fieldLines(changes = {}) {
  const fields = {
    card: '7', pull: '70', head: HEAD, digest: DIGEST, role: 'reviewer', verdict: 'sound', 'item 1': 'met', 'item 2': 'met', coverage: 'covered', dispatch: DISPATCH, evidence: EVIDENCE, ...changes,
  };
  return Object.entries(fields).filter(([, value]) => value !== null).map(([key, value]) => `${key}: ${value}`);
}

/** A comment body: the free first line, then a marker block holding `lines`, then a closing paragraph. */
const bodyOf = (lines, first = 'Verdict of reviewer') => [first, '```rigger-marker', ...lines, '```', '', 'The reasons, in prose.'].join('\n');

/** The parse of a comment holding a marker block of `fieldLines(changes)`, against two acceptance items. */
const parsedWith = (changes) => parseMarker(bodyOf(fieldLines(changes)), 2);

/** Asserts `parsed` is unreadable, with a reason matching `names`. */
function unreadable(parsed, names) {
  assert.equal(parsed.state, 'unreadable', JSON.stringify(parsed));
  assert.match(parsed.reason, names);
}

// proves R-VERDICT-5
test('a marker composed from the instruction\'s fields, with toSound and coverageReason filled, and parsed back yields every field unchanged', () => {
  const marker = {
    card: 7, pull: 70, head: HEAD, digest: DIGEST, role: 'reviewer', verdict: 'needs revision', items: ['met', 'unmet'],
    coverage: 'insufficient', coverageReason: 'It asks for help text: but names no exit code | anywhere.', toSound: 'Exit 0 after printing the help.', dispatch: DISPATCH, evidence: EVIDENCE,
  };

  const parsed = parseMarker(composeMarker(marker, 'Needs revision, by reviewer'), 2);

  assert.deepEqual(parsed, { state: 'marker', marker, absent: [] });
});

// proves R-VERDICT-5
test('a composed block opens on the comment\'s second line with a rigger-marker fence, holds one key: value per line and an item line per ordinal, and closes with a bare fence', () => {
  const body = composeMarker({ card: 7, pull: 70, head: HEAD, digest: DIGEST, role: 'reviewer', verdict: 'sound', items: ['met', 'unmet'], coverage: 'covered' }, 'Sound, by reviewer');

  assert.deepEqual(body.split('\n'), [
    'Sound, by reviewer',
    '```rigger-marker',
    'card: 7',
    'pull: 70',
    `head: ${HEAD}`,
    `digest: ${DIGEST}`,
    'role: reviewer',
    'verdict: sound',
    'item 1: met',
    'item 2: unmet',
    'coverage: covered',
    '```',
    '',
  ]);
  assert.equal(parseMarker(body, 2).state, 'marker');
});

// proves R-VERDICT-2
test('the parse accepts exactly the three verdicts, sound, needs revision and critical, and refuses a fourth', () => {
  assert.deepEqual(VERDICTS, ['sound', 'needs revision', 'critical']);
  for (const verdict of ['sound', 'needs revision', 'critical']) {
    const parsed = parsedWith({ verdict, toSound: 'Exit 0.' });
    assert.equal(parsed.state, 'marker', `${verdict}: ${JSON.stringify(parsed)}`);
    assert.equal(parsed.marker.verdict, verdict);
  }
  unreadable(parsedWith({ verdict: 'approved', toSound: 'Exit 0.' }), /verdict/);
});

test('the marker table: a well-formed marker with every item ruled and coverage ruled is a marker', () => {
  const parsed = parsedWith({});

  assert.deepEqual(parsed, {
    state: 'marker',
    marker: { card: 7, pull: 70, head: HEAD, digest: DIGEST, role: 'reviewer', verdict: 'sound', items: ['met', 'met'], coverage: 'covered', dispatch: DISPATCH, evidence: EVIDENCE },
    absent: [],
  });
});

test('the marker table: a well-formed marker with no dispatch or no evidence is a marker, naming each absent field', () => {
  assert.deepEqual(parsedWith({ dispatch: null }).absent, ['dispatch']);
  assert.deepEqual(parsedWith({ evidence: null }).absent, ['evidence']);
  const neither = parsedWith({ dispatch: null, evidence: null, role: 'owner' });
  assert.equal(neither.state, 'marker');
  assert.deepEqual(neither.absent, ['dispatch', 'evidence']);
});

test('the marker table: a comment with no marker block is no marker', () => {
  assert.deepEqual(parseMarker('Looks fine to me.\n\nSound.', 2), { state: 'none' });
  assert.deepEqual(parseMarker('', 2), { state: 'none' });
});

test('the marker table: a marker block not directly under the comment\'s first line is no marker', () => {
  assert.deepEqual(parseMarker(['Verdict', '', '```rigger-marker', ...fieldLines(), '```'].join('\n'), 2), { state: 'none' });
  assert.deepEqual(parseMarker(['```rigger-marker', ...fieldLines(), '```'].join('\n'), 2), { state: 'none' });
});

test('the marker table: a marker block quoted inside another fence, such as a four-backtick block, is no marker', () => {
  assert.deepEqual(parseMarker(['Verdict', '````', '```rigger-marker', ...fieldLines(), '```', '````'].join('\n'), 2), { state: 'none' });
  assert.deepEqual(parseMarker(['Verdict', '````markdown', '```rigger-marker', ...fieldLines(), '```', '````'].join('\n'), 2), { state: 'none' });
});

test('the marker table: two marker blocks in one comment are unreadable, naming both', () => {
  const body = [bodyOf(fieldLines()), '```rigger-marker', ...fieldLines(), '```'].join('\n');

  unreadable(parseMarker(body, 2), /two marker blocks.*line 2.*line 17/);
});

test('a second marker block quoted inside another fence after the first leaves the first a marker', () => {
  const body = [bodyOf(fieldLines()), '````', '```rigger-marker', ...fieldLines(), '```', '````'].join('\n');

  assert.equal(parseMarker(body, 2).state, 'marker');
});

test('the marker table: a block that does not parse is unreadable, naming why', () => {
  unreadable(parseMarker(bodyOf([...fieldLines(), 'this line is no field']), 2), /line 14.*this line is no field/);
  unreadable(parseMarker(['Verdict', '```rigger-marker', ...fieldLines()].join('\n'), 2), /never closed/);
});

test('the marker table: a field the schema does not name is unreadable, naming it', () => {
  unreadable(parseMarker(bodyOf([...fieldLines(), 'confidence: high']), 2), /confidence/);
});

test('the marker table: one field given twice is unreadable, naming it', () => {
  unreadable(parseMarker(bodyOf([...fieldLines(), 'role: architect']), 2), /role.*twice/);
});

test('the marker table: a head that is not 40 lowercase hex characters is unreadable, naming the field', () => {
  for (const head of ['A'.repeat(40), HEAD.slice(1), `${HEAD}1`, `${HEAD.slice(1)}g`]) unreadable(parsedWith({ head }), /\bhead\b/);
});

test('the marker table: a digest or evidence that is not 64 lowercase hex characters is unreadable, naming the field', () => {
  for (const value of [DIGEST.toUpperCase(), DIGEST.slice(1), `${DIGEST}0`]) {
    unreadable(parsedWith({ digest: value }), /\bdigest\b/);
    unreadable(parsedWith({ evidence: value }), /\bevidence\b/);
  }
});

test('the marker table: a card or pull that is not a positive integer is unreadable, naming the field', () => {
  for (const value of ['0', '-7', '7.5', 'seven', '07', '']) {
    unreadable(parsedWith({ card: value }), /\bcard\b/);
    unreadable(parsedWith({ pull: value }), /\bpull\b/);
  }
});

test('the marker table: a role that is empty or holds whitespace is unreadable, naming the field', () => {
  for (const role of ['', 'code reviewer', 'reviewer\tone']) unreadable(parsedWith({ role }), /\brole\b/);
});

test('the marker table: a dispatch present but not d- and a UUID is unreadable, naming the field', () => {
  for (const dispatch of ['0f8e3c1a-4b2d-4c6e-9a7b-1d2e3f4a5b6c', 'd-0f8e3c1a', 'd-0F8E3C1A-4B2D-4C6E-9A7B-1D2E3F4A5B6C', '']) unreadable(parsedWith({ dispatch }), /\bdispatch\b/);
});

test('the marker table: a verdict outside the three values is unreadable', () => {
  for (const verdict of ['approved', 'Sound', '']) unreadable(parsedWith({ verdict, toSound: 'Exit 0.' }), /verdict/);
});

// proves R-LOOP-5
test('the marker table: an item ordinal missing from the marker is unreadable, naming it', () => {
  unreadable(parsedWith({ 'item 2': null }), /item 2/);
});

// proves R-LOOP-5
test('the marker table: an item ordinal given twice, or outside 1 to the item count, is unreadable, naming it', () => {
  unreadable(parseMarker(bodyOf([...fieldLines(), 'item 1: unmet']), 2), /item 1.*twice/);
  unreadable(parseMarker(bodyOf([...fieldLines(), 'item 3: met']), 2), /item 3/);
  unreadable(parseMarker(bodyOf([...fieldLines(), 'item 0: met']), 2), /item 0/);
  unreadable(parsedWith({ 'item 2': 'partly' }), /item 2/);
});

test('the marker table: no coverage ruling is unreadable', () => {
  unreadable(parsedWith({ coverage: null }), /coverage/);
  unreadable(parsedWith({ coverage: 'mostly' }), /coverage/);
});

test('the marker table: coverage ruled insufficient with no coverageReason is unreadable', () => {
  unreadable(parsedWith({ coverage: 'insufficient' }), /coverageReason/);
  assert.equal(parsedWith({ coverage: 'insufficient', coverageReason: 'It never names the exit code.' }).state, 'marker');
});

// proves R-VERDICT-3
test('the marker table: a verdict other than sound with no toSound is unreadable', () => {
  unreadable(parsedWith({ verdict: 'needs revision' }), /toSound/);
  unreadable(parsedWith({ verdict: 'critical' }), /toSound/);
  assert.equal(parsedWith({ verdict: 'critical', toSound: 'Only the owner can decide the exit code.' }).state, 'marker');
});

test('the marker table: CRLF line endings answer as LF does', () => {
  const lf = bodyOf(fieldLines());
  assert.deepEqual(parseMarker(lf.replaceAll('\n', '\r\n'), 2), parseMarker(lf, 2));
  const broken = bodyOf([...fieldLines(), 'confidence: high']);
  assert.deepEqual(parseMarker(broken.replaceAll('\n', '\r\n'), 2), parseMarker(broken, 2));
});

test('the marker table: an item whose text holds a backtick fence, a pipe or a colon is a marker, since items are keyed by ordinal', () => {
  const body = '## Acceptance\n\n- The help prints ```fenced``` text.\n- It reads `a | b`: one colon.\n';
  const marker = { card: 7, pull: 70, head: HEAD, digest: acceptanceDigest(body), role: 'reviewer', verdict: 'sound', items: ['met', 'met'], coverage: 'covered' };

  assert.equal(parseMarker(composeMarker(marker, 'Sound'), 2).state, 'marker');
});

test('the marker table: sound with an item unmet is a marker', () => {
  const parsed = parsedWith({ 'item 2': 'unmet' });

  assert.equal(parsed.state, 'marker');
  assert.deepEqual(parsed.marker.items, ['met', 'unmet']);
});

test('the acceptance digest of a two-item acceptance is SHA-256 of the two items\' text, each followed by one LF', () => {
  assert.equal(acceptanceDigest(BODY), DIGEST);
});

// proves R-VERDICT-5
test('the acceptance digest changes when an acceptance item\'s text changes', () => {
  assert.equal(acceptanceDigest(BODY.replace('exits 0', 'exits 1')), '312aa039c5bea0b1e1c9d004caa570359a4bede942c07d20c26aa75b5e2437fe');
});

test('the acceptance digest does not change when the card\'s body changes outside its Acceptance section', () => {
  assert.equal(acceptanceDigest(`# Why\n\nA new paragraph.\n\n${BODY}\n- Another note.\n`), DIGEST);
});

test('the evidence digest is SHA-256 of the evidence\'s UTF-8 bytes', () => {
  // From `printf 'The diff.\n' | shasum -a 256`.
  assert.equal(evidenceDigest('The diff.\n'), 'ea62cc88c5a9a5aea94304f1e3b2f8e17ecdec34689226f4c908415ddb0debf7');
});

// proves R-LOOP-5, R-VERDICT-5
test('the instruction asks for one pull request comment holding a marker, names the card, pull request, head, acceptance digest and role it must carry, and lists every item by its ordinal', () => {
  const instruction = markerInstruction({ card: 7, pull: 70, head: HEAD, digest: DIGEST, role: 'reviewer', items: ['The verb prints its help.', 'The verb exits 0.'], evidence: EVIDENCE });

  assert.match(instruction, /one comment on pull request #70/);
  for (const line of ['```rigger-marker', 'card: 7', 'pull: 70', `head: ${HEAD}`, `digest: ${DIGEST}`, 'role: reviewer', `evidence: ${EVIDENCE}`, 'item 1: <met or unmet>', 'item 2: <met or unmet>']) {
    assert.ok(instruction.split('\n').includes(line), `${line} is not a line of ${instruction}`);
  }
  assert.ok(instruction.includes('1. The verb prints its help.\n2. The verb exits 0.'), instruction);
  assert.ok(!instruction.split('\n').includes('item 3: <met or unmet>'), instruction);
});

test('given a dispatch id, the instruction a judge is handed names it as the marker\'s dispatch, and nothing else of its answer changes', () => {
  const answer = { role: 'reviewer', instruction: markerInstruction({ card: 7, pull: 70, head: HEAD, digest: DIGEST, role: 'reviewer', items: ['One.'], evidence: EVIDENCE }), evidence: 'The diff.\n' };

  const stamped = dispatched(answer, DISPATCH);

  assert.ok(stamped.instruction.split('\n').includes(`dispatch: ${DISPATCH}`), stamped.instruction);
  assert.deepEqual({ ...stamped, instruction: undefined }, { ...answer, instruction: undefined });
});

/** A comment on pull request #70 in the shape the forge's read answers, holding `body`, by a writer, never edited. */
const comment = (body, changes = {}) => ({ body, createdAt: '2026-10-01T11:00:00Z', id: 'IC_1', author: 'williacj', permission: 'write', edited: false, ...changes });

/** A comment holding a well-formed marker of `role`, `changes` to its fields, at the head and digest above. */
const markerComment = (role, changes = {}, commentChanges = {}) => comment(bodyOf(fieldLines({ role, ...changes })), commentChanges);

/** The governing markers on `comments`, read for card 7's pull request #70 at the head and digest above, by role, as their states. */
const governing = (comments) => Object.fromEntries([...readMarkers(comments, { card: 7, pull: 70, head: HEAD, digest: DIGEST, count: 2 }).governing].map(([role, held]) => [role, held.state]));

test('the governing marker for a role is the latest by createdAt at the head and current digest', () => {
  const earlier = markerComment('reviewer', { verdict: 'needs revision', toSound: 'Exit 0.' }, { createdAt: '2026-10-01T11:00:00Z', id: 'IC_1' });
  const later = markerComment('reviewer', {}, { createdAt: '2026-10-01T12:00:00Z', id: 'IC_2' });

  for (const order of [[earlier, later], [later, earlier]]) {
    const held = readMarkers(order, { card: 7, pull: 70, head: HEAD, digest: DIGEST, count: 2 }).governing.get('reviewer');
    assert.equal(held.marker.verdict, 'sound');
  }
});

test('two markers of one role with one createdAt are ordered by comment id, the later id governing', () => {
  const first = markerComment('reviewer', { verdict: 'needs revision', toSound: 'Exit 0.' }, { id: 'IC_8' });
  const second = markerComment('reviewer', {}, { id: 'IC_9' });

  for (const order of [[first, second], [second, first]]) {
    assert.equal(readMarkers(order, { card: 7, pull: 70, head: HEAD, digest: DIGEST, count: 2 }).governing.get('reviewer').marker.verdict, 'sound');
  }
});

// proves R-VERDICT-5
test('a marker at another head or another digest governs nothing at the current head and digest', () => {
  assert.deepEqual(governing([markerComment('reviewer', { head: EARLIER }), markerComment('architect', { digest: EVIDENCE })]), {});
});

test('a marker naming a card or pull request the comment\'s pull request does not hold counts as no marker of that judge\'s', () => {
  assert.deepEqual(governing([markerComment('reviewer', { card: '8' }), markerComment('architect', { pull: '71' })]), {});
  assert.equal(parsedWith({ card: '8' }).state, 'marker');
});

test('a marker counts only where its comment\'s permission is admin, maintain or write', () => {
  for (const permission of ['admin', 'maintain', 'write']) assert.deepEqual(governing([markerComment('reviewer', {}, { permission })]), { reviewer: 'marker' }, permission);
  for (const permission of ['triage', 'read', 'none']) assert.deepEqual(governing([markerComment('reviewer', {}, { permission })]), {}, permission);
});

test('a marker whose comment\'s author is null counts for none', () => {
  assert.deepEqual(governing([markerComment('reviewer', {}, { author: null, permission: 'none' })]), {});
  assert.deepEqual(governing([markerComment('reviewer', {}, { author: null })]), {});
});

test('a later unreadable marker of a role governs over an earlier readable one, and the earlier head another readable marker named is answered', () => {
  const readable = markerComment('reviewer', {}, { createdAt: '2026-10-01T11:00:00Z', id: 'IC_1' });
  const broken = comment(bodyOf([...fieldLines({ role: 'reviewer' }), 'confidence: high']), { createdAt: '2026-10-01T12:00:00Z', id: 'IC_2' });
  const before = markerComment('architect', { head: EARLIER }, { createdAt: '2026-10-01T10:00:00Z', id: 'IC_0' });

  const read = readMarkers([readable, broken, before], { card: 7, pull: 70, head: HEAD, digest: DIGEST, count: 2 });

  assert.equal(read.governing.get('reviewer').state, 'unreadable');
  assert.deepEqual(read.markers.map((each) => [each.role, each.head]), [['architect', EARLIER], ['reviewer', HEAD]]);
});

test('an edited comment\'s governing marker is answered as edited', () => {
  const held = readMarkers([markerComment('reviewer', {}, { edited: true })], { card: 7, pull: 70, head: HEAD, digest: DIGEST, count: 2 }).governing.get('reviewer');

  assert.equal(held.state, 'marker');
  assert.equal(held.edited, true);
});

test('a later unclosed marker block whose identity is readable governs as unreadable over an earlier readable marker of its role', () => {
  const readable = markerComment('reviewer', {}, { createdAt: '2026-10-01T11:00:00Z', id: 'IC_1' });
  const unclosed = comment(['Sound, by reviewer', '```rigger-marker', ...fieldLines({ role: 'reviewer' })].join('\n'), { createdAt: '2026-10-01T12:00:00Z', id: 'IC_2' });

  const held = readMarkers([readable, unclosed], { card: 7, pull: 70, head: HEAD, digest: DIGEST, count: 2 }).governing.get('reviewer');

  assert.equal(held.state, 'unreadable');
  assert.match(held.reason, /never closed/);
});

test('the marker table: a marker block quoted inside a fence that opens on the comment\'s first line is no marker', () => {
  for (const outer of ['````', '````markdown', '~~~', '```text']) {
    assert.deepEqual(parseMarker([outer, '```rigger-marker', ...fieldLines(), '```', outer].join('\n'), 2), { state: 'none' }, outer);
  }
});
