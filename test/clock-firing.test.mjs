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

// Judge probe: recovery must retain the issue it just opened when its outcome is refused.
test('architect probe: a recovery opening retains its issue floor after outcome refusal', async () => {
  const world = recovering();
  const open = world.writes.openIssue;
  world.writes.openIssue = async (...args) => { const number = await open(...args); world.reads.readNewestNumber = async () => 0; return number; };
  let refuseOnce = true;
  world.refuseEvents(({ event }) => {
    if (event !== 'trigger.outcome' || !refuseOnce) return false;
    refuseOnce = false;
    return true;
  });
  const run = await world.start();
  try {
    assert.equal(world.fake.issues.filter(({ body }) => body.startsWith(MARK + '\n')).length, 1,
      'an outcome refusal after recovery opened issue #1 must not produce issue #2 at the next same-run scan');
  } finally { await run.stop(); }
});

// A known occurrence issue must survive every later failure before the outcome is recorded.
test('F1: every known issue remains the scan floor through refused and successful later steps', async (t) => {
  for (const origin of ['fresh', 'recovery']) for (const discovery of ['opened', 'found', 'placed', 'closed']) {
    const steps = discovery === 'opened' ? ['addIssue', 'made addIssue', 'moveItem', 'made moveItem', 'transition', 'outcome']
      : discovery === 'found' ? ['readItems', 'addIssue', 'made addIssue', 'moveItem', 'made moveItem', 'transition', 'outcome'] : ['outcome'];
    for (const step of steps) await t.test(`${origin} ${discovery} ${step}`, async () => {
      const trigger = RECOVERY;
      const found = discovery !== 'opened';
      const issue = marked(1, discovery === 'closed' ? { state: 'closed' } : {});
      const items = discovery === 'placed' ? [{ id: 'item-1', number: 1, column: 'Coding' }] : [];
      const world = origin === 'recovery' ? recovering({ issues: found ? [issue] : [], items })
        : firingWorld({ triggers: { hourly: trigger } });
      let blocked = true;
      let refused = 0;
      let zeroReads = 0;
      let known = false;
      const lagging = () => { world.reads.readNewestNumber = async () => { zeroReads += 1; return 0; }; };
      const read = world.reads.readIssue;
      world.reads.readIssue = async (...args) => { const answer = await read(...args); if (answer !== null) { known = true; lagging(); } return answer; };
      const open = world.writes.openIssue;
      let opening = true;
      world.writes.openIssue = async (...args) => {
        const number = await open(...args);
        known = true;
        lagging();
        if (origin === 'fresh' && found && opening) {
          opening = false;
          if (discovery === 'placed') world.fake.onBoard.push({ id: 'item-1', number, column: 'Coding' });
          Object.assign(world.fake.issues.find(each => each.number === number), discovery === 'closed' ? { state: 'closed' } : {});
          throw madeFailure('the fresh opening was made', number);
        }
        return number;
      };
      if (step === 'readItems') {
        const readItems = world.fake.board.readItems;
        world.fake.board.readItems = async (...args) => { if (blocked && known) { refused += 1; throw new Error('refused known issue readItems'); } return readItems(...args); };
      } else if (['addIssue', 'made addIssue', 'moveItem', 'made moveItem'].includes(step)) {
        const operation = step.split(' ').at(-1);
        const write = world.fake.items[operation];
        world.fake.items[operation] = async (...args) => {
          if (!blocked || !known) return write(...args);
          refused += 1;
          if (step.startsWith('made ')) throw madeFailure('refused known issue ' + step, await write(...args));
          throw new Error('refused known issue ' + step);
        };
      }
      world.refuseEvents(({ event }) => {
        if (event === 'transition' && step === 'transition' && blocked) { refused += 1; return true; }
        if (event === 'trigger.outcome') { if (step === 'outcome') refused += 1; return true; }
        return false;
      });
      let run;
      const count = () => world.fake.issues.filter(({ body }) => body.startsWith(MARK + '\n')).length;
      try {
        run = await world.start();
        if (origin === 'fresh') await world.clock.advance(START + 123);
        await world.clock.advance(START + 1500);
        assert.ok(refused > 0, 'the post-success step reached its refused phase');
        assert.equal(count(), 1, 'a refused step after knowing the issue must not create another marked card');
        blocked = false;
        await world.clock.advance(START + 2500);
        assert.equal(count(), 1, 'successful placement followed by a refused outcome keeps the same issue');
        assert.deepEqual(outcomes(world), [], 'the outcome remains refused after its earlier steps succeed');
        assert.ok(zeroReads > 0, 'later scans actually receive a lagging newest-number answer of zero');
        world.accept();
        await world.clock.advance(START + 3500);
        assert.equal(count(), 1, 'the succeeding outcome still names the only marked card');
        assert.deepEqual(outcomes(world).map(({ issue }) => issue), [1]);
      } finally { await run?.stop(); }
    });
  }
});

// Judge probe: a firing must not hold up the next freed-slot pull.
test('architect probe: an asynchronous card firing does not hold back a freed-slot pull', async (t) => {
  const world = firingWorld({ context: t, admitted: true, hold: [10, 20],
    issues: [{ number: 10, title: 'Existing work', body: '## Acceptance\n\n- The widget turns blue.\n', labels: ['type:change'] },
      { number: 20, title: 'Waiting work', body: '## Acceptance\n\n- The widget turns green.\n', labels: ['type:change'] }],
    items: [{ number: 10, id: 'item-10', column: 'Ready' }] });
  const run = await world.start();
  await until(() => world.held.has(10));
  const open = world.writes.openIssue;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered = false;
  world.writes.openIssue = async (...args) => { entered = true; await gate; return open(...args); };
  const advanced = world.clock.advance(START + 1000);
  try {
    await until(() => entered);
    world.fake.onBoard.push({ number: 20, id: 'item-20', column: 'Ready' });
    const before = world.events().filter(e => e.event === 'trigger' && e.trigger === 'pull').length;
    world.held.get(10)();
    world.held.delete(10);
    await until(() => world.events().some(e => e.event === 'slot.release' && e.card === 10));
    await new Promise(resolve => setImmediate(resolve));
    const claimedBeforeRelease = world.events().some(e => e.event === 'pull' && e.card === 20);
    t.diagnostic(JSON.stringify({ openingStillHeld: true, pulls: world.events().filter(e => e.event === 'pull').map(e => e.card),
      triggerPulls: world.events().filter(e => e.event === 'trigger' && e.trigger === 'pull').length,
      waitingColumn: world.fake.onBoard.find(e => e.number === 20).column }));
    release();
    await advanced;
    await until(() => world.held.has(20));
    t.diagnostic('after releasing the clock opening, the same freed-slot pull claims card #20');
    assert.ok(claimedBeforeRelease, 'the freed-slot pull must claim existing Ready card #20 before the unrelated clock opening completes');
  } finally { release(); await advanced; await run.stop(); }
});


// A forge opening may wait; a pull, poll and drain must make progress before that wait ends.
test('F2: a gated clock opening holds back neither a freed-slot pull, a poll nor a drain', async (t) => {
  for (const occasion of ['freed-slot pull', 'poll', 'drain']) await t.test(occasion, async (t) => {
    const existing = number => ({ number, title: 'Existing work', body: '## Acceptance\n\n- The widget turns blue.\n', labels: ['type:change'] });
    const world = occasion === 'freed-slot pull' ? firingWorld({ context: t, admitted: true, hold: [10, 20],
      issues: [existing(10), existing(20)], items: [{ number: 10, id: 'item-10', column: 'Ready' }] })
      : occasion === 'drain' ? firingWorld({ clock: manualClock(START + 500), triggers: { hourly: { ...RECOVERY, catchUp: 'fire' } },
        record: line(START, 'trigger.armed', { name: 'hourly', interval: RECOVERY.interval, anchor: RECOVERY.anchor }) }) : firingWorld();
    const open = world.writes.openIssue;
    let release;
    let entered = false;
    let released = false;
    const gate = new Promise(resolve => { release = () => { released = true; resolve(); }; });
    world.writes.openIssue = async (...args) => { entered = true; await gate; return open(...args); };
    let run;
    let starting;
    let advanced;
    try {
      if (occasion === 'drain') starting = world.start();
      else {
        run = await world.start();
        if (occasion === 'freed-slot pull') await until(() => world.held.has(10));
        advanced = world.clock.advance(START + 1000);
      }
      await until(() => entered);
      if (occasion === 'freed-slot pull') {
        world.fake.onBoard.push({ number: 20, id: 'item-20', column: 'Ready' });
        world.held.get(10)();
        world.held.delete(10);
        await until(() => world.events().some(({ event, card }) => event === 'slot.release' && card === 10));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(released, false, 'the checkpoint precedes releasing the opening');
        assert.ok(world.events().some(({ event, card }) => event === 'pull' && card === 20), 'the freed slot claims existing Ready work while the opening is held');
      } else if (occasion === 'poll') {
        const before = world.events().filter(({ event, trigger }) => event === 'trigger' && trigger === 'pull').length;
        await world.clock.advance(START + 2000);
        assert.equal(released, false, 'the checkpoint precedes releasing the opening');
        assert.ok(world.events().filter(({ event, trigger }) => event === 'trigger' && trigger === 'pull').length > before, 'the next poll completes while the opening is held');
      } else {
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(released, false, 'the checkpoint precedes releasing the opening');
        assert.ok(world.events().some(({ event, trigger }) => event === 'trigger' && trigger === 'drain'), 'the initial drain is recorded while the catch-up opening is held');
      }
      assert.deepEqual(outcomes(world), [], 'the firing has not completed at the checkpoint');
    } finally {
      release();
      await advanced;
      run ??= await starting;
      await run?.stop();
    }
  });
});


// Judge probe: stopping during startup recovery must prevent a queued new occurrence from firing.
test('architect r2: stop cancels a catch-up firing queued behind startup recovery', async (t) => {
  const world = recovering({ clock: manualClock(START + 35_000), triggers: { hourly: { ...RECOVERY, catchUp: 'fire' } } });
  const newest = world.reads.readNewestNumber;
  let entered = false;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  world.reads.readNewestNumber = async (...args) => {
    if (!entered) { entered = true; await gate; }
    return newest(...args);
  };
  const run = await world.start();
  try {
    assert.equal(entered, true, 'startup recovery is held before a forge read completes');
    assert.equal(firings(world).length, 1, 'only the recorded pending start exists before stop');
    const stopped = run.stop();
    release();
    await stopped;
    t.diagnostic(JSON.stringify({ firings: firings(world).map(({ occurrence }) => occurrence), issues: world.fake.issues.map(({ number, body }) => [number, body.split('\n')[0]]) }));
    assert.equal(firings(world).length, 1, 'a queued catch-up must not record a new firing after stop');
  } finally { release(); await run.stop(); }
});

// Judge probe: a queued recovery must not begin a new forge opening after run has stopped.
test('architect r2: stop cancels recovery queued behind a refused opening', async (t) => {
  const world = firingWorld({ triggers: { hourly: cardTrigger({ interval: 10_000 }) } });
  let release;
  let entered = false;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const open = world.writes.openIssue;
  world.writes.openIssue = async (...args) => {
    calls += 1;
    if (!entered) { entered = true; await gate; throw new Error('opening refused'); }
    return open(...args);
  };
  const run = await world.start();
  const advanced = world.clock.advance(START + 10_000);
  try {
    await until(() => entered);
    await world.clock.advance(START + 11_000);
    const before = calls;
    let ended = false;
    const stopping = run.stop().then(() => { ended = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ended, false, 'stop waits for the held opening');
    release();
    await Promise.all([stopping, advanced]);
    await new Promise(resolve => setImmediate(resolve));
    t.diagnostic(JSON.stringify({ callsAtStop: before, callsAfterStop: calls, issuesAfterStop: world.fake.issues.length }));
    assert.equal(calls, before, 'no queued recovery starts another opening after run has ended');
  } finally { release(); await advanced; await run.stop(); }
});


// Shutdown must join issued clock work and discard every queued continuation before the next run.
test('B24 shutdown: stop and abort join clock work without starting another scan, firing or opening', async (t) => {
  const states = ['startup recovery with catch-up queued', 'fresh opening success with recovery queued', 'fresh opening refusal with recovery queued',
    'recovery opening success', 'recovery opening refusal', 'detached recovery newest read', 'recovery newest read', 'fresh newest read',
    'recovery issue read', 'recovery permission read', 'recovery board read', 'recovery board add', 'recovery board move', 'firing start append'];
  for (const method of ['stop', 'abort']) for (const state of states) await t.test(`${method}: ${state}`, async () => {
    const controller = new AbortController();
    const startup = state.startsWith('startup');
    const recovery = startup || state.startsWith('recovery') || state.startsWith('detached');
    let entered = false;
    let released = false;
    let release;
    const gate = new Promise(resolve => { release = () => { released = true; resolve(); }; });
    let run;
    let stopping;
    let ended = false;
    let atStop;
    const calls = { newest: 0, open: 0, issue: 0, permission: 0, board: 0, add: 0, move: 0 };
    const checkpoint = () => ({ ...calls, starts: firings(world).length });
    const requestStop = () => {
      atStop = checkpoint();
      const done = method === 'stop' ? run.stop() : (controller.abort(), run.running);
      stopping = done.then(() => { ended = true; });
    };
    const trigger = { ...RECOVERY, ...(startup && { catchUp: 'fire' }) };
    const world = firingWorld({ clock: manualClock(START + (startup ? 35_000 : recovery ? 500 : 0)),
      triggers: { hourly: trigger }, ...(recovery && { record: pendingRecord() }),
      ...(state.startsWith('recovery') && !state.includes('opening') ? { issues: [marked()] } : {}),
      afterEmit: ({ event, trigger }) => {
        if (state !== 'firing start append' || event !== 'trigger' || trigger !== 'clock' || stopping) return;
        entered = true;
        requestStop();
        assert.equal(ended, false, 'stop cannot settle while the start append is still on the stack');
        release();
      } });
    const newest = world.reads.readNewestNumber;
    const open = world.writes.openIssue;
    let holdRead = startup || state.includes('newest read');
    let holdOpen = state.includes('opening');
    world.reads.readNewestNumber = async (...args) => {
      calls.newest += 1;
      const answer = await newest(...args);
      if (holdRead) { holdRead = false; entered = true; await gate; }
      return answer;
    };
    world.writes.openIssue = async (...args) => {
      calls.open += 1;
      if (holdOpen) {
        holdOpen = false;
        entered = true;
        await gate;
        if (state.includes('refusal')) throw new Error('the issued opening was refused');
      }
      return open(...args);
    };
    for (const [reader, operation, key] of [[world.reads, 'readIssue', 'issue'], [world.reads, 'readPermission', 'permission'],
      [world.clockBoard, 'readItems', 'board'], [world.fake.items, 'addIssue', 'add'], [world.fake.items, 'moveItem', 'move']]) {
      const call = reader[operation];
      reader[operation] = (...args) => { calls[key] += 1; return call(...args); };
    }
    for (const [stage, reader, operation] of [['recovery issue read', world.reads, 'readIssue'],
      ['recovery permission read', world.reads, 'readPermission'], ['recovery board read', world.clockBoard, 'readItems'],
      ['recovery board add', world.fake.items, 'addIssue'], ['recovery board move', world.fake.items, 'moveItem']]) {
      if (state !== stage) continue;
      const read = reader[operation];
      let first = true;
      reader[operation] = async (...args) => {
        const answer = await read(...args);
        if (first) { first = false; entered = true; await gate; }
        return answer;
      };
    }
    let advanced;
    let second;
    try {
      run = await world.start({ signal: controller.signal });
      if (!recovery) advanced = world.clock.advance(START + 10_123);
      await until(() => entered);
      if (state.startsWith('fresh')) await world.clock.advance(START + 11_123);
      if (state !== 'firing start append') {
        requestStop();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(released, false, 'the issued request is still held at the checkpoint');
        assert.equal(ended, false, 'stop waits until the held clock request settles');
        release();
      }
      await Promise.all([advanced, stopping]);
      assert.deepEqual(checkpoint(), atStop, 'no new clock read, start, issue open or board write begins after stop');
      const issueCount = world.fake.issues.length;
      await world.clock.advance(world.clock.now() + 1000);
      assert.equal(world.fake.issues.length, issueCount, 'returned clock work has no later effects');
      assert.deepEqual(checkpoint(), atStop, 'a later timer advance begins no clock work after return');
      world.accept();
      second = await world.start();
      if (state === 'fresh newest read') {
        assert.equal(world.fake.issues.length, 0, 'the stopped fence read never started a firing');
        await world.clock.advance(START + 20_123);
      }
      const occurrence = state === 'fresh newest read' ? START + 20_123 : recovery ? START + 123 : START + 10_123;
      const mark = `Rigger clock: ["hourly",${occurrence}]`;
      assert.equal(world.fake.issues.filter(({ body }) => body.startsWith(mark + '\n')).length, 1,
        'the following run reuses the occurrence touched before stop');
      const marks = world.fake.issues.map(({ body }) => body.split('\n')[0]);
      assert.equal(new Set(marks).size, marks.length, 'every occurrence has exactly one card across the restart');
    } finally { release(); await advanced; await stopping; await second?.stop(); await run?.stop(); }
  });
});

const runTriggers = (world, run) => world.events().filter((each) => each.run === run && each.event === 'trigger').map(({ trigger, name }) => trigger === 'clock' ? `clock:${name}` : trigger);
const REPORT = { interval: 1000, anchor: at(START), catchUp: 'fire', job: 'report' };
test('attack: P1 report-only catch-up still precedes the first pull when the record holds a pending card start of a removed trigger', async (t) => {
  for (const withPending of [false, true]) await t.test(String(withPending), async () => {
    const record = line(START, 'trigger.armed', { name: 'daily', interval: 1000, anchor: at(START) })
      + line(START + 1000, 'trigger.outcome', { name: 'daily', occurrence: at(START + 1000), outcome: 'job' })
      + (withPending ? line(START + 1500, 'trigger', { trigger: 'clock', name: 'gone', occurrence: at(START + 1500), after: 0 }) : '');
    const world = firingWorld({ clock: manualClock(START + 5500), triggers: { daily: REPORT }, record });
    const run = await world.start();
    try {
      await until(() => firings(world).some(({ name, run }) => name === 'daily' && run === 'r-clock-1'));
      const order = runTriggers(world, 'r-clock-1');
      t.diagnostic(JSON.stringify({ order, outcomes: outcomes(world).map(({ name, outcome }) => [name, outcome]) }));
      assert.deepEqual(order.slice(0, 2), ['clock:daily', 'pull'], 'the report catch-up precedes the first pull, as at the merge base');
    } finally { await run.stop(); }
  });
});

// B20 B24: unrelated pending recovery cannot reorder report catch-ups or hold their first pull.
test('B20 B24: every report catch-up precedes the first pull while unrelated card recovery is held', async (t) => {
  for (const retained of [false, true]) await t.test(String(retained), async () => {
    const sleeping = cardTrigger({ interval: 3_600_000 });
    const name = retained ? 'sleeping' : 'gone';
    const record = line(START, 'trigger.armed', { name: 'daily', interval: 1000, anchor: at(START) })
      + line(START, 'trigger.armed', { name: 'dawn', interval: 1500, anchor: at(START) })
      + line(START, 'trigger.armed', { name: 'noon', interval: 2000, anchor: at(START) })
      + line(START, 'trigger.armed', { name, interval: sleeping.interval, anchor: sleeping.anchor })
      + line(START + 500, 'trigger', { trigger: 'clock', name, occurrence: at(START + 500), after: 0 });
    const world = firingWorld({ clock: manualClock(START + 5500), record,
      triggers: { daily: REPORT, dawn: { ...REPORT, interval: 1500 }, noon: { ...REPORT, interval: 2000 }, ...(retained && { sleeping }) } });
    let release;
    let entered = false;
    let released = false;
    const gate = new Promise(resolve => { release = () => { released = true; resolve(); }; });
    const newest = world.reads.readNewestNumber;
    world.reads.readNewestNumber = async (...args) => { entered = true; await gate; return newest(...args); };
    let run;
    try {
      run = await world.start();
      await until(() => entered);
      assert.equal(released, false, 'recovery is still held at the checkpoint');
      assert.deepEqual(runTriggers(world, 'r-clock-1').slice(0, 4), ['clock:noon', 'clock:dawn', 'clock:daily', 'pull'],
        'all report catch-ups precede the first pull, even with a declared card whose occurrence is not due');
      assert.ok(runTriggers(world, 'r-clock-1').includes('drain'), 'the first pull drains without waiting for pending card recovery');
    } finally { release(); await run?.stop(); }
  });
});

// K43: its own pending card blocks the report, while the first pull remains independent.
// https://github.com/williacj/rigger/issues/1009#issuecomment-6579208376
test('B20 B21 K43: a report blocked by its own pending card start fires after recovery, without holding the first pull', async (t) => {
  const record = line(START, 'trigger.armed', { name: 'daily', interval: 1000, anchor: at(START) })
    + line(START + 1500, 'trigger', { trigger: 'clock', name: 'daily', occurrence: at(START + 1500), after: 0 });
  const world = firingWorld({ clock: manualClock(START + 5500), triggers: { daily: REPORT }, record });
  let release;
  let entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  const newest = world.reads.readNewestNumber;
  world.reads.readNewestNumber = async (...args) => { entered = true; await gate; return newest(...args); };
  const starting = world.start();
  let run;
  try {
    await until(() => entered);
    await new Promise(resolve => setImmediate(resolve));
    const heldOrder = runTriggers(world, 'r-clock-1');
    t.diagnostic(JSON.stringify({ whileRecoveryHeld: heldOrder }));
    assert.deepEqual(heldOrder, ['pull', 'drain'], 'the first pull drains without waiting for its report trigger’s pending card recovery');
    assert.deepEqual(outcomes(world), [], 'the report cannot fire before its own pending card settles');
    release();
    run = await starting;
    await until(() => firings(world).some(({ name, run }) => name === 'daily' && run === 'r-clock-1'));
    const order = runTriggers(world, 'r-clock-1');
    t.diagnostic(JSON.stringify({ order, outcomes: outcomes(world).map(({ name, outcome }) => [name, outcome]) }));
    assert.deepEqual(order, ['pull', 'drain', 'clock:daily'], 'the blocked report follows recovery without holding the first pull');
    assert.deepEqual(outcomes(world).map(({ name, outcome }) => [name, outcome]), [['daily', 'abandoned'], ['daily', 'job']]);
    assert.equal(world.fake.issues.length, 0, 'the changed report declaration opens no missing card');
  } finally { release(); run ??= await starting; await run.stop(); }
});
