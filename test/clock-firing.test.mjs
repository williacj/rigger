// ABOUTME: Proves card-shaped clock firings and their recovery through the real scheduling loop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START, at, firingWorld, firings, outcomes } from './clock-firing-world.mjs';
import { cardTrigger } from './clock-firing-world.mjs';
import { failuresIn } from './kept-up-run.mjs';
import { until, TEMPLATE } from './clock-firing-world.mjs';
import { checkAcceptanceForm } from '../src/workflow/form-check.mjs';
import { line } from './clock-arming-world.mjs';
import { manualClock } from './clock-report-world.mjs';
import { madeFailure } from './write-made-fixtures.mjs';

// B1 B22: a created issue must enter the ordinary maker, judge and merge loop with an admitted body.
// proves R-SCHED-5, R-SCHED-31
test('B1 B22: a firing opens an admitted marked card and run takes it through maker, judges and merge to Done', async (t) => {
  const world = firingWorld({ context: t, admitted: true, triggers: { hourly: cardTrigger({ interval: 3_600_000 }) } });
  const run = await world.start();
  try {
    await world.clock.advance(START + 3_600_000);
    assert.equal(world.fake.issues.length, 1, 'the due occurrence opened its card');
    const issue = world.fake.issues[0];
    assert.equal(issue.body, 'Rigger clock: ["hourly",1793278800000]\n\n**Author:** owner\n\n## Acceptance\n\n' + TEMPLATE.acceptance);
    assert.deepEqual(checkAcceptanceForm(issue), { admitted: true });
    await until(() => world.events().filter(({ event }) => event === 'dispatch.end').length === 3);
    await world.clock.advance(START + 3_601_000);
    await until(() => world.fake.onBoard[0].column === 'Done');
    assert.deepEqual(world.agents.map(({ role }) => role).sort(), ['architect', 'engineer', 'reviewer']);
    assert.equal(world.repository.merges().length, 1);
    assert.deepEqual(world.events().filter(({ event }) => event === 'transition').map(({ to }) => to), ['ready', 'coding', 'review', 'done']);
    t.diagnostic(JSON.stringify({ start: firings(world)[0], outcome: outcomes(world)[0], mark: issue.body.split('\n')[0] }));
  } catch (error) {
    t.diagnostic(JSON.stringify({ events: world.events(), forge: world.repository.held(), handed: run.handed }, (_key, value) => value instanceof Error ? { message: value.message, errors: value.errors } : value));
    throw error;
  } finally { await run.stop(); }
});

// B3: treating a firing as a pull would suppress the card under closed admission.
// proves R-SCHED-33
test('B3: closed admission still creates the due card in Ready and claims no card', async () => {
  const world = firingWorld();
  const run = await world.start();
  try {
    await world.clock.advance(START + 1000);
    assert.equal(world.fake.issues.length, 1, 'closed admission still opens the occurrence card');
    assert.deepEqual(world.fake.onBoard, [{ id: 'item-1', number: 1, column: 'Ready' }]);
    assert.deepEqual(firings(world).map(({ name, occurrence, after }) => ({ name, occurrence, after })),
      [{ name: 'hourly', occurrence: at(START + 1000), after: 0 }]);
    assert.deepEqual(outcomes(world).map(({ outcome, issue }) => ({ outcome, issue })), [{ outcome: 'card', issue: 1 }]);
    assert.deepEqual(world.events().filter(({ event }) => event === 'pull'), [], 'closed admission claims nothing');
  } finally {
    await run.stop();
  }
});

// B10: losing after at a restart forgets the opened card; truncating the ISO instant loses its mark.
// proves R-SCHED-32
test('B10: restart finds the fractional-second occurrence once and reads its settled record again', async () => {
  const world = firingWorld({ triggers: { hourly: cardTrigger({ interval: 10_000, anchor: at(START + 123) }) } });
  world.refuseEvents(({ event }) => event === 'trigger.outcome');
  const first = await world.start();
  try {
    await world.clock.advance(START + 123);
    assert.equal(world.fake.issues.length, 1, 'the crash window follows a real opening');
    assert.equal(outcomes(world).length, 0, 'the first run could not record its outcome');
  } finally { await first.stop(); }
  world.accept();
  await world.clock.advance(START + 500);
  const second = await world.start();
  try {
    assert.deepEqual(outcomes(world).map(({ occurrence, outcome, issue }) => ({ occurrence, outcome, issue })),
      [{ occurrence: '2026-10-29T12:00:00.123Z', outcome: 'card', issue: 1 }]);
    assert.equal(world.fake.issues.filter(({ body }) => body.startsWith('Rigger clock: ["hourly",1793275200123]\n')).length, 1,
      'the same state and forge have at most one card with this occurrence mark');
    assert.deepEqual(failuresIn(second.handed), [], 'the pending start was readable');
  } finally { await second.stop(); }
  await world.clock.advance(START + 600);
  const third = await world.start();
  try {
    assert.deepEqual(failuresIn(third.handed), [], 'the card start and outcome round trip through the record');
    assert.equal(world.fake.issues.length, 1);
    assert.equal(outcomes(world).length, 1);
  } finally { await third.stop(); }
});

// B7: forgetting an opened firing after a refused opening loses that occurrence forever.
test('B7: an opening failure keeps the firing pending and the next poll settles it', async () => {
  const world = firingWorld({ triggers: { hourly: cardTrigger({ interval: 10_000 }) } });
  const run = await world.start();
  try {
    world.refuse.openIssue = 'opening denied';
    await world.clock.advance(START + 10_000);
    assert.equal(firings(world).length, 1, 'the start was recorded');
    assert.deepEqual(outcomes(world), [], 'a refused opening has no outcome');
    assert.ok(failuresIn(run.handed).some(({ message }) => message.includes('opening denied')), 'run hands over the opening failure');
    delete world.refuse.openIssue;
    await world.clock.advance(START + 11_000);
    assert.equal(world.fake.issues.length, 1, 'the next trigger opens the pending occurrence');
    assert.deepEqual(outcomes(world).map(({ occurrence, outcome, issue }) => ({ occurrence, outcome, issue })),
      [{ occurrence: at(START + 10_000), outcome: 'card', issue: 1 }]);
    assert.equal(firings(world).length, 1, 'settling records no second start');
  } finally {
    await run.stop();
  }
});

// B6: retrying only at the next occurrence loses the configured poll bound while every slot is held.
test('B6: a failed newest-number read records no start and retries after poll even with every slot held', async (t) => {
  const world = firingWorld({ context: t, admitted: true, hold: [10],
    issues: [{ number: 10, title: 'Existing work', body: '## Acceptance\n\n- The widget turns blue.\n', labels: ['type:change'] }],
    items: [{ number: 10, id: 'item-10', column: 'Ready' }], triggers: { hourly: cardTrigger({ interval: 10_000 }) } });
  const run = await world.start();
  try {
    await until(() => world.held.has(10));
    world.refuse.readNewestNumber = 'newest read denied';
    await world.clock.advance(START + 10_000);
    assert.deepEqual(firings(world), [], 'a failed fence read records no start');
    assert.equal(world.fake.issues.length, 1, 'the failed read opens nothing');
    assert.ok(failuresIn(run.handed).some(({ message }) => message.includes('newest read denied')));
    delete world.refuse.readNewestNumber;
    await world.clock.advance(START + 11_000);
    assert.equal(world.fake.issues.length, 2, 'the occurrence retries at poll without an idle board poll');
    assert.equal(firings(world)[0].occurrence, at(START + 10_000));
  } finally { await run.stop(); }
});

// B10b: a lagging newest-number answer must not hide the issue L2's made error already names.
test('B10b: a made opening floors the scan even when the newest-number read trails that issue', async () => {
  const world = firingWorld({ triggers: { hourly: cardTrigger({ interval: 10_000 }) } });
  const run = await world.start();
  const open = world.writes.openIssue;
  let first = true;
  world.writes.openIssue = async (...args) => {
    const number = await open(...args);
    if (first) {
      first = false;
      world.reads.readNewestNumber = async () => 0;
      throw madeFailure('opened but unrecorded', number);
    }
    return number;
  };
  try {
    await world.clock.advance(START + 10_000);
    await world.clock.advance(START + 11_000);
    assert.equal(world.fake.issues.length, 1, 'the known opened issue is found without a second opening');
    assert.deepEqual(outcomes(world).map(({ outcome, issue }) => ({ outcome, issue })), [{ outcome: 'card', issue: 1 }]);
    assert.ok(failuresIn(run.handed).some(({ message }) => message.includes('opened issue #1')));
  } finally { await run.stop(); }
});

// B2: an earlier open occurrence must not suppress a later one.
// proves R-SCHED-31
test('B2: another occurrence creates another card while the earlier occurrence card remains open', async (t) => {
  const trigger = cardTrigger();
  const record = line(START - 2000, 'trigger.armed', { name: 'hourly', interval: 1000, anchor: at(START) })
    + line(START - 1000, 'trigger', { trigger: 'clock', name: 'hourly', occurrence: at(START - 1000), after: 9 })
    + line(START - 1000, 'trigger.outcome', { name: 'hourly', occurrence: at(START - 1000), outcome: 'card', issue: 10 });
  const world = firingWorld({ context: t, admitted: true, hold: [11], triggers: { hourly: trigger }, record,
    issues: [{ number: 10, title: TEMPLATE.title, body: 'Rigger clock: ["hourly",1793275199000]', labels: TEMPLATE.labels }] });
  const run = await world.start();
  try {
    await world.clock.advance(START + 1000);
    assert.equal(world.fake.issues.length, 2, 'the earlier open card does not suppress creation');
    assert.equal(world.fake.issues[0].state ?? 'open', 'open');
    assert.equal(world.fake.issues[1].body.split('\n')[0], 'Rigger clock: ["hourly",1793275201000]');
    assert.equal(outcomes(world).at(-1).issue, 11);
    await until(() => world.held.has(11));
    assert.equal(world.events().find(({ event }) => event === 'pull').card, 11);
  } finally { await run.stop(); }
});

// B4: reopening admission must make the already-created Ready card claimable.
// proves R-SCHED-33
test('B4: reopening admission lets the next poll claim the card created while closed', async (t) => {
  const world = firingWorld({ context: t, hold: [1], triggers: { hourly: cardTrigger({ interval: 10_000 }) } });
  const run = await world.start();
  try {
    await world.clock.advance(START + 10_000);
    assert.equal(world.fake.issues.length, 1);
    assert.deepEqual(world.events().filter(({ event }) => event === 'pull'), []);
    world.reopen();
    await world.clock.advance(START + 11_000);
    await until(() => world.held.has(1));
    assert.deepEqual(world.events().filter(({ event }) => event === 'pull').map(({ card }) => card), [1]);
  } finally { await run.stop(); }
});

// B5: a firing consumes no claim slot, even while all configured slots are occupied.
test('B5: a due card firing takes no slot while an ordinary maker holds every slot', async (t) => {
  const world = firingWorld({ context: t, admitted: true, hold: [10],
    issues: [{ number: 10, title: 'Existing work', body: '## Acceptance\n\n- The widget turns blue.\n', labels: ['type:change'] }],
    items: [{ number: 10, id: 'item-10', column: 'Ready' }] });
  const run = await world.start();
  try {
    await until(() => world.held.has(10));
    await world.clock.advance(START + 1000);
    assert.equal(world.fake.issues.length, 2, 'the due card was created while its slot was occupied');
    assert.deepEqual(world.events().filter(({ event }) => event === 'pull').map(({ card, inFlight }) => [card, inFlight]), [[10, 1]]);
    assert.equal(outcomes(world)[0].issue, 11);
  } finally { await run.stop(); }
});

const RECOVERY = cardTrigger({ interval: 10_000, anchor: at(START + 123) });
const MARK = 'Rigger clock: ["hourly",1793275200123]';
const marked = (number = 1, fields = {}) => ({ number, title: TEMPLATE.title, body: MARK + '\n\n## Acceptance\n\n' + TEMPLATE.acceptance,
  labels: TEMPLATE.labels, ...fields });
const pendingRecord = (name = 'hourly', schedule = RECOVERY, after = 0) => line(START, 'trigger.armed', { name, interval: schedule.interval, anchor: schedule.anchor })
  + line(START + 123, 'trigger', { trigger: 'clock', name, occurrence: at(START + 123), after });
const recovering = (options = {}) => firingWorld({ clock: manualClock(START + 500), triggers: { hourly: RECOVERY }, record: pendingRecord(), ...options });

// B7 B9: a failed board add must recover the existing issue rather than open it again.
test('B7 B9: a failed board add leaves the opened issue pending and the next trigger places it in Ready', async () => {
  const world = firingWorld({ triggers: { hourly: cardTrigger({ interval: 10_000 }) } });
  const run = await world.start();
  try {
    world.refuse.addIssue = 'add denied';
    await world.clock.advance(START + 10_000);
    assert.equal(world.fake.issues.length, 1);
    assert.deepEqual(outcomes(world), []);
    assert.deepEqual(world.fake.onBoard, []);
    assert.ok(failuresIn(run.handed).some(({ message }) => message.includes('add denied')));
    delete world.refuse.addIssue;
    await world.clock.advance(START + 11_000);
    assert.equal(world.fake.issues.length, 1);
    assert.equal(world.fake.onBoard[0].column, 'Ready');
    assert.deepEqual(outcomes(world).map(({ issue }) => issue), [1]);
  } finally { await run.stop(); }
});

// B8 B8a: a refused outcome is still pending and holds back the next occurrence of that trigger.
test('B8 B8a: a refused card outcome blocks later occurrences until the scan settles the same card', async () => {
  const world = firingWorld();
  world.refuseEvents(({ event }) => event === 'trigger.outcome');
  const run = await world.start();
  try {
    await world.clock.advance(START + 1000);
    await world.clock.advance(START + 2000);
    assert.equal(world.fake.issues.length, 1, 'no second occurrence opens while the first is pending');
    assert.equal(firings(world).length, 1);
    assert.deepEqual(outcomes(world), []);
    assert.ok(failuresIn(run.handed).some(({ message }) => message.includes('trigger.outcome')));
    world.accept();
    await world.clock.advance(START + 3000);
    assert.deepEqual(outcomes(world).map(({ occurrence, issue }) => [occurrence, issue]), [[at(START + 1000), 1], [at(START + 3000), 2]]);
    const events = world.events();
    assert.ok(events.findIndex(({ event }) => event === 'trigger.outcome') < events.findIndex(({ trigger, occurrence }) => trigger === 'clock' && occurrence === at(START + 3000)));
  } finally { await run.stop(); }
});

// B10a: catch-up cannot run before a pending firing, even when settlement keeps failing.
test('B10a: a pending start settles before catch-up and blocks catch-up while it stays pending', async (t) => {
  for (const fault of ['openIssue', 'readNewestNumber', 'moveItem']) await t.test(fault, async () => {
    const world = recovering({ clock: manualClock(START + 35_000), triggers: { hourly: { ...RECOVERY, catchUp: 'fire' } },
      ...(fault === 'moveItem' && { issues: [marked()] }) });
    world.refuse[fault] = 'settling denied';
    const run = await world.start();
    try {
      assert.equal(firings(world).length, 1, 'catch-up is blocked by the pending start');
      assert.deepEqual(outcomes(world), []);
      assert.ok(failuresIn(run.handed).some(({ message }) => message.includes('settling denied')));
      delete world.refuse[fault];
      await world.clock.advance(START + 36_000);
      assert.deepEqual(outcomes(world).map(({ occurrence }) => occurrence), [at(START + 123), at(START + 30_123)]);
      const events = world.events();
      assert.ok(events.findIndex(({ event }) => event === 'trigger.outcome') < events.findIndex(({ trigger, occurrence }) => trigger === 'clock' && occurrence === at(START + 30_123)));
    } finally { await run.stop(); }
  });
});

// B11: found cards retain every existing column and closed state.
test('B11: a found card in any column or closed is recorded without moving it', async (t) => {
  for (const column of ['Ready', 'Coding', 'Review', 'Owner', 'Done', null]) for (const state of ['open', 'closed']) {
    if (column === null && state === 'open') continue;
    await t.test(`${column} ${state}`, async () => {
      const items = column === null ? [] : [{ number: 1, id: 'item-1', column }];
      const before = structuredClone(items);
      const world = recovering({ issues: [marked(1, { state })], items });
      const run = await world.start();
      try {
        assert.deepEqual(outcomes(world).map(({ outcome, issue }) => [outcome, issue]), [['card', 1]]);
        assert.deepEqual(world.fake.onBoard, before);
        assert.deepEqual(world.fake.calls.filter(([name]) => ['openIssue', 'addIssue', 'moveItem'].includes(name)), []);
      } finally { await run.stop(); }
    });
  }
});

// B12 B16: an unchanged schedule keeps the pending firing, while its current template supplies the card.
test('B12 B16: a missing card opens from the current template and author without re-arming', async (t) => {
  for (const template of [TEMPLATE, { title: 'Audit changed widgets', labels: ['type:change', 'customer:blue'], acceptance: '- The audit records its result.\n', author: 'pm' }]) {
    await t.test(template.author ?? 'owner', async () => {
      const world = recovering({ triggers: { hourly: { ...RECOVERY, card: template } } });
      const run = await world.start();
      try {
        assert.equal(world.fake.issues.length, 1);
        assert.equal(world.fake.issues[0].title, template.title);
        assert.deepEqual(world.fake.issues[0].labels, template.labels);
        assert.equal(world.fake.issues[0].body, MARK + `\n\n**Author:** ${template.author ?? 'owner'}\n\n## Acceptance\n\n` + template.acceptance);
        assert.equal(world.events().filter(({ event }) => event === 'trigger.armed').length, 1, 'the original arming is retained');
        assert.deepEqual(outcomes(world).map(({ outcome, issue }) => [outcome, issue]), [['card', 1]]);
      } finally { await run.stop(); }
    });
  }
});

// B13 B15: absence of the card declaration abandons the old start without inventing a job.
test('B13 B15: removed, renamed, absent-clock and report declarations abandon a missing pending card', async (t) => {
  for (const [kind, triggers] of [['removed', {}], ['renamed', { other: RECOVERY }], ['absent clock', null],
    ['report', { hourly: { interval: RECOVERY.interval, anchor: RECOVERY.anchor, catchUp: 'skip', job: 'report' } }]]) await t.test(kind, async () => {
    const world = recovering({ triggers });
    const run = await world.start();
    try {
      assert.deepEqual(outcomes(world).map(({ name, occurrence, outcome }) => ({ name, occurrence, outcome })),
        [{ name: 'hourly', occurrence: at(START + 123), outcome: 'abandoned' }]);
      assert.deepEqual(world.fake.issues, []);
      assert.deepEqual(run.handed.filter(({ report }) => report !== undefined), []);
    } finally { await run.stop(); }
  });
});

// B14: a re-arming after the start survives later restarts, including a schedule changed back.
test('B14: current or historical re-arming abandons a missing card but never discards a found one', async (t) => {
  const rearmed = line(START + 200, 'trigger.armed', { name: 'hourly', interval: 20_000, anchor: RECOVERY.anchor });
  for (const historical of [false, true]) for (const found of [false, true]) await t.test(`${historical} ${found}`, async () => {
    const world = recovering({ record: pendingRecord() + (historical ? rearmed + line(START + 300, 'trigger.armed', { name: 'hourly', interval: RECOVERY.interval, anchor: RECOVERY.anchor }) : ''),
      triggers: { hourly: historical ? RECOVERY : { ...RECOVERY, interval: 20_000 } }, issues: found ? [marked(1, { state: 'closed' })] : [] });
    const run = await world.start();
    try {
      assert.deepEqual(outcomes(world).map(({ outcome }) => outcome), [found ? 'card' : 'abandoned']);
      assert.equal(world.fake.issues.length, found ? 1 : 0);
    } finally { await run.stop(); }
  });
});

// B17: a mark on a non-writer's issue, or at the fence itself, is not the firing's card.
test('B17: the scan skips the fence, PR gaps, deleted authors, wrong marks and every non-writer permission', async (t) => {
  for (const [permission, expected] of [['none', 15], ['read', 15], ['triage', 15], ['write', 13], ['maintain', 13], ['admin', 13]]) await t.test(permission, async () => {
    const world = recovering({ record: pendingRecord('hourly', RECOVERY, 10), permissions: { stranger: permission }, pulls: [12], issues: [
      marked(10), marked(11, { author: null }), marked(13, { author: 'stranger' }), marked(14, { body: 'Rigger clock: ["different",1793275200123]' }),
    ] });
    const run = await world.start();
    try {
      assert.equal(outcomes(world)[0]?.issue, expected, 'only a trusted exact mark prevents another opening');
      assert.equal(world.fake.issues.length, expected === 15 ? 5 : 4);
      assert.deepEqual(world.fake.calls.filter(([name]) => name === 'readIssue').map(([, number]) => number), expected === 15 ? [11, 12, 13, 14] : [11, 12, 13]);
    } finally { await run.stop(); }
  });
});

// B18 B19: an uncertain scan or failed placement must leave the start pending without opening a card.
test('B18 B19: every scan read and Ready placement refusal leaves no outcome and retries at the next trigger', async (t) => {
  for (const fault of ['readNewestNumber', 'readIssue', 'readPermission', 'readItems', 'addIssue', 'moveItem']) await t.test(fault, async () => {
    const world = recovering({ issues: [marked()] });
    world.refuse[fault] = 'scan or placement denied';
    const run = await world.start();
    try {
      assert.deepEqual(outcomes(world), [], 'no outcome is recorded for an uncertain scan or failed placement');
      assert.equal(world.fake.issues.length, 1);
      assert.equal(world.fake.calls.filter(([name]) => name === 'openIssue').length, 0);
      assert.ok(failuresIn(run.handed).some(({ message }) => message.includes('scan or placement denied')));
      delete world.refuse[fault];
      await world.clock.advance(START + 1500);
      assert.deepEqual(outcomes(world).map(({ issue }) => issue), [1]);
      assert.equal(world.fake.onBoard.length, 1);
      assert.equal(world.fake.onBoard[0].column, 'Ready');
    } finally { await run.stop().catch(() => {}); }
  });
});

// B21: the recorded after field, not today's declaration, determines how a pending start settles.
test('B21: a pending card start now declaring report is scanned as a card and never runs a job', async () => {
  const world = recovering({ triggers: { hourly: { interval: RECOVERY.interval, anchor: RECOVERY.anchor, catchUp: 'skip', job: 'report' } }, issues: [marked()] });
  const run = await world.start();
  try {
    assert.deepEqual(outcomes(world).map(({ outcome, issue }) => [outcome, issue]), [['card', 1]]);
    assert.equal(world.fake.onBoard[0].column, 'Ready');
    assert.deepEqual(run.handed.filter(({ report }) => report !== undefined), []);
    assert.equal(world.fake.issues.length, 1);
  } finally { await run.stop(); }
});

// B20 invariant: report ordering already holds at the merge base; the later card is not yet due.
test('B20 invariant: report firings beside a later card retain occurrence and code-unit name order', async () => {
  const report = (interval) => ({ interval, anchor: at(START), catchUp: 'skip', job: 'report' });
  const world = firingWorld({ triggers: { Beta: report(1000), Alpha: report(1000), earlier: report(1500), card: cardTrigger({ interval: 3_600_000 }) } });
  const run = await world.start();
  try {
    await world.clock.advance(START + 2500);
    assert.deepEqual(world.events().filter(({ trigger, event }) => trigger === 'clock' || event === 'trigger.outcome')
      .map(({ event, name, occurrence }) => [event, name, occurrence]), [
      ['trigger', 'earlier', at(START + 1500)], ['trigger.outcome', 'earlier', at(START + 1500)],
      ['trigger', 'Alpha', at(START + 2000)], ['trigger.outcome', 'Alpha', at(START + 2000)],
      ['trigger', 'Beta', at(START + 2000)], ['trigger.outcome', 'Beta', at(START + 2000)],
    ]);
    assert.equal(run.handed.filter(({ report }) => report !== undefined).length, 3);
    assert.deepEqual(world.fake.issues, []);
  } finally { await run.stop(); }
});

// B20: asynchronous card opening must finish before either a tied firing or a later report starts.
test('B20: mixed card and report firings never overlap and follow occurrence then name', async () => {
  const report = { interval: 1000, anchor: at(START), catchUp: 'skip', job: 'report' };
  const world = firingWorld({ triggers: { Beta: report, Alpha: cardTrigger(), earlier: cardTrigger({ interval: 1500 }) } });
  const open = world.writes.openIssue;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered = 0;
  world.writes.openIssue = async (...args) => { entered += 1; await gate; return open(...args); };
  const run = await world.start();
  const advanced = world.clock.advance(START + 2500);
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(entered, 1, 'the earlier card opening has started');
    assert.deepEqual(firings(world).map(({ name }) => name), ['earlier'], 'no second firing starts before the first finishes');
    assert.equal(run.handed.filter(({ report }) => report !== undefined).length, 0);
    release();
    await advanced;
    assert.deepEqual(world.events().filter(({ trigger, event }) => trigger === 'clock' || event === 'trigger.outcome')
      .map(({ event, name }) => [event, name]), [
      ['trigger', 'earlier'], ['trigger.outcome', 'earlier'], ['trigger', 'Alpha'], ['trigger.outcome', 'Alpha'], ['trigger', 'Beta'], ['trigger.outcome', 'Beta'],
    ]);
  } finally { release(); await advanced; await run.stop(); }
});

// B24: a slot release while an opening is in flight must not scan it as an interrupted firing.
test('B24: a freed-slot pull cannot recover an opening still in flight and create its card twice', async (t) => {
  const world = firingWorld({ context: t, admitted: true, hold: [10], issues: [{ number: 10, title: 'Existing work',
    body: '## Acceptance\n\n- The widget turns blue.\n', labels: ['type:change'] }], items: [{ number: 10, id: 'item-10', column: 'Ready' }] });
  const run = await world.start();
  await until(() => world.held.has(10));
  const open = world.writes.openIssue;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered = 0;
  world.writes.openIssue = async (...args) => { entered += 1; await gate; return open(...args); };
  const advanced = world.clock.advance(START + 1000);
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(entered, 1, 'the clock opening is in flight');
    world.held.get(10)();
    world.held.delete(10);
    await until(() => world.events().filter(({ event, card }) => event === 'dispatch.end' && card === 10).length === 3);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(entered, 1, 'a freed-slot pull did not open a second card');
    release();
    await advanced;
    assert.equal(world.fake.issues.filter(({ body }) => body.startsWith('Rigger clock: ["hourly",1793275201000]\n')).length, 1);
  } finally { release(); await advanced; await run.stop(); }
});

// B24: every name and extended ISO instant L3 writes must be accepted on a later start.
test('B24: empty, prototype and escaped trigger names round trip fractional occurrences past year 9999', async (t) => {
  const epoch = Date.parse('+010000-01-01T00:00:00.000Z');
  for (const name of ['', '__proto__', 'nightly\n"quoted"']) await t.test(JSON.stringify(name), async () => {
    const clock = manualClock(epoch - 500);
    const trigger = cardTrigger({ anchor: at(epoch - 877) });
    const world = firingWorld({ clock, triggers: { [name]: trigger } });
    const first = await world.start();
    try {
      await clock.advance(epoch + 123);
      assert.equal(world.fake.issues.length, 1, 'the named occurrence opened its card');
      assert.equal(firings(world)[0].occurrence, '+010000-01-01T00:00:00.123Z');
      assert.equal(firings(world)[0].name, name);
      assert.equal(outcomes(world)[0].issue, 1);
    } finally { await first.stop(); }
    await clock.advance(epoch + 500);
    const second = await world.start();
    try {
      assert.deepEqual(failuresIn(second.handed), [], 'the written start/outcome are readable');
      assert.equal(world.fake.issues.length, 1);
    } finally { await second.stop(); }
  });
});

// B10b B24: every failure after a known opening must retain its issue number for a lagging scan.
test('B10b B24: made board writes and an unrecorded created transition retain the opened issue floor', async (t) => {
  for (const fault of ['addIssue', 'moveItem', 'transition']) await t.test(fault, async () => {
    const world = firingWorld({ triggers: { hourly: cardTrigger({ interval: 10_000 }) } });
    const run = await world.start();
    const open = world.writes.openIssue;
    world.writes.openIssue = async (...args) => {
      const number = await open(...args);
      world.reads.readNewestNumber = async () => 0;
      return number;
    };
    let first = true;
    if (fault === 'transition') world.refuseEvents(({ event }) => {
      if (event !== 'transition' || !first) return false;
      first = false;
      return true;
    });
    else {
      const operation = world.fake.items[fault];
      world.fake.items[fault] = async (...args) => {
        const answer = await operation(...args);
        if (first) { first = false; throw madeFailure('board write unrecorded', answer); }
        return answer;
      };
    }
    try {
      await world.clock.advance(START + 10_000);
      await world.clock.advance(START + 11_000);
      assert.equal(world.fake.issues.length, 1, 'the scan retains the opened issue through every later failure');
      assert.deepEqual(outcomes(world).map(({ issue }) => issue), [1]);
      assert.equal(world.fake.onBoard.length, 1);
    } finally { await run.stop(); }
  });
});

// B8a: both a failed opening and a failed board add hold back later occurrences in the same run.
test('B8a: opening and board-add failures block the next occurrence until the pending one settles', async (t) => {
  for (const fault of ['openIssue', 'addIssue']) await t.test(fault, async () => {
    const world = firingWorld();
    const run = await world.start();
    try {
      world.refuse[fault] = 'opening or add denied';
      await world.clock.advance(START + 1000);
      await world.clock.advance(START + 2000);
      assert.equal(firings(world).length, 1);
      assert.deepEqual(outcomes(world), []);
      delete world.refuse[fault];
      await world.clock.advance(START + 3000);
      assert.deepEqual(outcomes(world).map(({ occurrence }) => occurrence), [at(START + 1000), at(START + 3000)]);
      assert.equal(world.fake.issues.length, 2);
    } finally { await run.stop(); }
  });
});
