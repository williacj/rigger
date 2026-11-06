// ABOUTME: Tests L2's clock card opening, body and author, ordered writes and failure boundaries.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from '../rigger.config.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { composeClockMark, carriesClockMark } from '../src/workflow/clock-mark.mjs';
import { checkAcceptanceForm } from '../src/workflow/form-check.mjs';
import { refusedCall, madeFailure } from './write-made-fixtures.mjs';
import { unrecordedKill } from './write-made-fixtures.mjs';

const NAME = 'nightly\n# ``` "quoted"';
const OCCURRENCE = 1793178000123;
const TEMPLATE = { title: 'Refresh widgets', labels: ['type:change'], acceptance: '- The widget turns blue.\n' };
const ok = (answer) => ({ status: 0, stdout: JSON.stringify(answer), stderr: '' });

/** Every attempted opening has the exact body, mark and form answer the card's readings require. */
function assertBody(title, body, { template, name, occurrence, authorLine }) {
  assert.equal(title, template.title);
  assert.equal(body, `${composeClockMark(name, occurrence)}\n\n${authorLine}\n\n## Acceptance\n\n${template.acceptance}`);
  assert.equal(carriesClockMark(body, name, occurrence), true);
  assert.deepEqual(checkAcceptanceForm({ number: 214, title, body }),
    checkAcceptanceForm({ number: 214, title, body: `## Acceptance\n\n${template.acceptance}` }));
}

/**
 * Stub transport answers the documented create-issue shape; item sides answer their public
 * number-to-item and move contracts. Opening call.end follows the supplied result and projects
 * its status/timedOut envelope as ARCHITECTURE.md, L0's call events, and forge/runners.mjs specify.
 */
function world({ template = TEMPLATE, name = NAME, occurrence = OCCURRENCE, authorLine = '**Author:** owner',
  opening, adding, moving, refuseTransition = false, settings = config } = {}) {
  const writes = [];
  const events = [];
  const sink = { emitter: (context) => ({ emit: (event, fields) => {
    if (refuseTransition && context.layer === 'L2' && event === 'transition') throw new Error('transition disk full');
    events.push({ ...context, event, ...fields });
  } }) };
  const recordCall = (emitter, side, result = { status: 0 }) => emitter.emit('call.end', { system: 'forge', side, ms: 0,
    outcome: result.timedOut ? 'timed-out' : result.status === 0 ? 'ok' : 'failed' });
  const send = async (command, args, { emitter }) => {
    writes.push(['open', command, ...args]);
    assertBody(args[5].slice('title='.length), args[7].slice('body='.length), { template, name, occurrence, authorLine });
    const result = opening ? await opening() : ok({ number: 214, labels: template.labels.map((name) => ({ name })) });
    recordCall(emitter, 'repository-write', result);
    return result;
  };
  const items = {
    addIssue: async (number, emitter) => {
      writes.push(['add', number]);
      recordCall(emitter, 'item-write');
      return adding ? adding() : 'PVTI_214';
    },
    moveItem: async (id, column, emitter) => {
      writes.push(['move', id, column]);
      recordCall(emitter, 'item-write');
      if (moving) return moving();
    },
  };
  const l2 = columnChanges({ config: settings, sink, send, items });
  return { writes, events, l2, open: () => l2.openClockCard(name, occurrence, template) };
}

const transitions = (run) => run.events.filter(({ layer, event }) => layer === 'L2' && event === 'transition');

// O1/A1: skipping a board step, copying a mark incorrectly, or inventing a prior column loses the firing.
test('a clock opening writes the marked owner card, adds it, moves it to Ready and records created', async () => {
  const run = world();
  assert.equal(typeof run.l2.openClockCard, 'function', 'L2 exposes the clock card opener');
  assert.equal(await run.open(), 214);
  assert.deepEqual(run.writes, [
    ['open', 'gh', 'api', 'repos/williacj/rigger/issues', '-X', 'POST', '-f', `title=${TEMPLATE.title}`,
      '-f', `body=${composeClockMark(NAME, OCCURRENCE)}\n\n**Author:** owner\n\n## Acceptance\n\n${TEMPLATE.acceptance}`,
      '-f', 'labels[]=type:change'],
    ['add', 214], ['move', 'PVTI_214', 'Ready'],
  ]);
  assert.deepEqual(transitions(run), [{ layer: 'L2', event: 'transition', card: 214, dispatch: null, to: 'ready', cause: 'created' }]);
  const opening = run.events.find(({ layer, event, side }) => layer === 'L0' && event === 'call.end' && side === 'repository-write');
  assert.equal(Object.hasOwn(opening, 'card'), false);
  for (const event of run.events.filter(({ layer, event, side }) => layer === 'L0' && event === 'call.end' && side === 'item-write')) {
    assert.equal(event.card, 214);
  }
});

// A1–A3: hardcoding owner loses a declared author; body prefixes must preserve both refusal reasons.
// proves R-CARD-41
test('a clock card names its configured author or owner and preserves the template form answer', async () => {
  for (const [author, authorLine] of [[undefined, '**Author:** owner'], ['owner', '**Author:** owner'], ['pm', '**Author:** pm']]) {
    for (const [acceptance, reason] of [[TEMPLATE.acceptance, undefined], ['- <!-- pending -->', 'missing acceptance'], ['- Refresh widgets', 'restated title']]) {
      const template = { ...TEMPLATE, acceptance, ...(author === undefined ? {} : { author }) };
      const run = world({ template, authorLine });
      await assert.doesNotReject(async () => assert.equal(await run.open(), 214));
      const body = run.writes[0][9].slice('body='.length);
      assert.equal(body.split('\n')[2], authorLine);
      assert.equal(checkAcceptanceForm({ number: 214, title: template.title, body }).reason, reason);
    }
  }
});

// A4/A6: a role's LF or CR must not start a heading/fence; literal backslashes stay as spelled.
test('a declared author with CR and LF stays on one line without changing acceptance', async () => {
  for (const [author, authorLine] of [['pm\n## Acceptance\r```', '**Author:** pm\\n## Acceptance\\r```'],
    ['pm\\n## Acceptance\\r```', '**Author:** pm\\n## Acceptance\\r```']]) {
    const settings = { ...config, roles: { ...config.roles, [author]: config.roles.pm } };
    const run = world({ template: { ...TEMPLATE, author }, authorLine, settings });
    await assert.doesNotReject(async () => assert.equal(await run.open(), 214));
    assert.equal(run.writes[0][9].slice('body='.length).split('\n')[2], authorLine);
  }
});

// O3: a transport-only error loses the firing's identity; a refused opening must stop board writes.
test('a refused opening names its trigger, occurrence and forge reason and makes no board write', async () => {
  for (const [opening, reason, outcome] of [
    [() => ({ status: 1, stdout: '', stderr: 'gh: forbidden 403' }), 'forbidden 403', 'failed'],
    [() => ({ status: 0, stdout: '', timedOut: true, timeout: 42 }), 'timeout of 42 ms', 'timed-out'],
    [() => { throw new Error('spawn gh ENOENT'); }, 'spawn gh ENOENT'],
  ]) {
    let endsAtEvaluation;
    const openingEnds = () => run.events.filter(({ layer, event, system, side }) =>
      layer === 'L0' && event === 'call.end' && system === 'forge' && side === 'repository-write');
    const run = world({ opening: () => {
      const result = opening();
      endsAtEvaluation = openingEnds().length;
      return result;
    } });
    await assert.rejects(run.open(), (error) => {
      for (const expected of [NAME, new Date(OCCURRENCE).toISOString(), reason]) assert.ok(error.message.includes(expected), error.message);
      return true;
    });
    assert.equal(run.writes.length, 1);
    assert.deepEqual(transitions(run), []);
    if (outcome) {
      assert.deepEqual(openingEnds().map(({ outcome }) => outcome), [outcome], 'EVENT-OUTCOME: returned opening result');
      assert.equal(endsAtEvaluation, 0, 'call.end follows evaluation of the supplied opening result');
    }
  }
});

/** Two different unrecorded events, so a report naming only the first loses evidence. */
const unrecorded = () => [...unrecordedKill(), { event: 'call.end', system: 'forge', side: 'repository-write',
  ms: 7, outcome: 'ok', cause: new Error('call record disk full') }];

/** A made write names the action, each event's fields and each sink error, without reporting refusal. */
function assertMade(error, action) {
  assert.ok(error.message.includes(action), error.message);
  assert.doesNotMatch(error.message, /was refused|could not|from undefined/);
  for (const { event, cause, ...fields } of unrecorded()) {
    for (const expected of [event, JSON.stringify(fields), cause.message]) assert.ok(error.message.includes(expected), error.message);
  }
  return true;
}

// O5: case folding must also decide made; a sink refusal after creation must stop all board writes.
test('a made opening names the new issue and every unrecorded event and stops before the board', async () => {
  for (const label of ['tier:high', 'TIER:HIGH']) {
    const run = world({ template: { ...TEMPLATE, labels: ['type:change', 'tier:high', 'customer:one'] },
      opening: () => { throw refusedCall({ number: 214, labels: [{ name: 'type:change' }, { name: label }, { name: 'customer:one' }] }, { unrecorded: unrecorded() }); } });
    await assert.rejects(run.open(), (error) => assertMade(error, 'opened issue #214'));
    assert.equal(run.writes.length, 1);
    assert.deepEqual(transitions(run), []);
  }
});

// O6: a raw board error loses the newly opened issue; moving after a refused add invents an item.
test('a refused board add names the opened issue and board add and never moves', async () => {
  const run = world({ adding: () => { throw new Error('board not found'); } });
  await assert.rejects(run.open(), (error) => {
    assert.match(error.message, /#214.*board add.*board not found/);
    return true;
  });
  assert.deepEqual(run.writes.map(([step]) => step), ['open', 'add']);
  assert.deepEqual(transitions(run), []);
});

// O7: an add whose event was refused still happened; it must not be reported as a board refusal.
test('a made board add names the issue added and every unrecorded event and never moves', async () => {
  const run = world({ adding: () => { throw madeFailure('addIssue record refused', 'PVTI_214', unrecorded()); } });
  await assert.rejects(run.open(), (error) => assertMade(error, 'issue #214 was added to the board'));
  assert.deepEqual(run.writes.map(([step]) => step), ['open', 'add']);
  assert.deepEqual(transitions(run), []);
});

// O8: created has no prior column; a refused move records no transition and says no 'from undefined'.
test('a refused Ready move names the card, Ready and reason without inventing a source column', async () => {
  const run = world({ moving: () => { throw new Error('move denied'); } });
  await assert.rejects(run.open(), (error) => {
    assert.match(error.message, /#214.*Ready.*move denied/);
    assert.doesNotMatch(error.message, /from undefined/);
    return true;
  });
  assert.deepEqual(run.writes.map(([step]) => step), ['open', 'add', 'move']);
  assert.deepEqual(transitions(run), []);
});

// O9: the forge took the move even when its call record was refused, so its transition still belongs.
test('a made Ready move still records created and names the move and every unrecorded event', async () => {
  const run = world({ moving: () => { throw madeFailure('move record refused', undefined, unrecorded()); } });
  await assert.rejects(run.open(), (error) => assertMade(error, 'card #214 moved to ready (Ready)'));
  assert.deepEqual(run.writes.map(([step]) => step), ['open', 'add', 'move']);
  assert.deepEqual(transitions(run), [{ layer: 'L2', event: 'transition', card: 214, dispatch: null, to: 'ready', cause: 'created' }]);
});

// O10: the transition may fail after all writes succeed; the rejection must report that actual move.
test('a refused created transition names the card, Ready move and sink error', async () => {
  const run = world({ refuseTransition: true });
  await assert.rejects(run.open(), (error) => {
    assert.match(error.message, /card #214 moved to ready \(Ready\).*transition disk full/);
    assert.doesNotMatch(error.message, /from undefined/);
    return true;
  });
  assert.deepEqual(run.writes.map(([step]) => step), ['open', 'add', 'move']);
  assert.deepEqual(transitions(run), []);
});

// O2: the complete template must survive the opening even when GitHub folds one label's spelling.
test('a three-label clock opening accepts a case-folded answer and sends every label in order', async () => {
  const template = { ...TEMPLATE, labels: ['type:change', 'tier:high', 'customer:one'] };
  const run = world({ template, opening: () => ok({ number: 214,
    labels: [{ name: 'type:change' }, { name: 'TIER:HIGH' }, { name: 'customer:one' }] }) });
  await assert.doesNotReject(async () => assert.equal(await run.open(), 214));
  assert.deepEqual(run.writes[0].slice(10), ['-f', 'labels[]=type:change', '-f', 'labels[]=tier:high', '-f', 'labels[]=customer:one']);
  assert.deepEqual(run.writes.slice(1), [['add', 214], ['move', 'PVTI_214', 'Ready']]);
  assert.deepEqual(transitions(run), [{ layer: 'L2', event: 'transition', card: 214, dispatch: null, to: 'ready', cause: 'created' }]);
});

// O4: checking only the first label permits a partly labelled marked card to reach Ready.
test('an opening missing template labels names the issue and every missing label and stops', async () => {
  const template = { ...TEMPLATE, labels: ['type:change', 'tier:high', 'customer:one'] };
  for (const labels of [[], [{ name: 'TYPE:CHANGE' }]]) {
    const run = world({ template, opening: () => ok({ number: 214, labels }) });
    await assert.rejects(run.open(), (error) => {
      for (const expected of ['#214', 'tier:high', 'customer:one']) assert.ok(error.message.includes(expected), error.message);
      return true;
    });
    assert.equal(run.writes.length, 1);
    assert.deepEqual(transitions(run), []);
  }
});

// O15: a successful transport can still return malformed JSON; it never yields an invented number.
test('an unreadable opening answer rejects with the firing and parse failure before any board write', async () => {
  const run = world({ opening: () => ({ status: 0, stdout: '{not JSON', stderr: '' }) });
  await assert.rejects(run.open(), (error) => {
    for (const expected of [NAME, new Date(OCCURRENCE).toISOString(), 'JSON']) assert.ok(error.message.includes(expected), error.message);
    return true;
  });
  assert.equal(run.writes.length, 1);
  assert.deepEqual(transitions(run), []);
});
