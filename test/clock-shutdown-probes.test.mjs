// ABOUTME: Reviewer counterexamples for recovered catch-up occurrences and queued shutdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START, at, firingWorld, cardTrigger, firings, outcomes, until } from './clock-firing-world.mjs';
import { manualClock } from './clock-report-world.mjs';
import { line } from './clock-arming-world.mjs';
const schedule = cardTrigger({ interval: 10_000, anchor: at(START + 123), catchUp: 'fire' });
const record = line(START, 'trigger.armed', { name: 'hourly', interval: schedule.interval, anchor: schedule.anchor })
  + line(START + 123, 'trigger', { trigger: 'clock', name: 'hourly', occurrence: at(START + 123), after: 0 });
test('reviewer: recovery of the newest missed occurrence must exclude catch-up of that same occurrence', async (t) => {
  const world = firingWorld({ clock: manualClock(START + 500), triggers: { hourly: schedule }, record });
  const run = await world.start();
  try {
    await new Promise(resolve => setImmediate(resolve));
    t.diagnostic(JSON.stringify({ issues: world.fake.issues, starts: firings(world), outcomes: outcomes(world) }));
    assert.equal(world.fake.issues.filter(issue => issue.body.startsWith('Rigger clock: ["hourly",1793275200123]\n')).length, 1,
      'recovery and catch-up must not open two cards with the exact same occurrence mark');
  } finally { await run.stop(); }
});
test('reviewer: stop while catch-up queues behind recovery must not start the queued occurrence', async (t) => {
  const world = firingWorld({ clock: manualClock(START + 15_000), triggers: { hourly: schedule }, record });
  const read = world.reads.readNewestNumber;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered = false;
  world.reads.readNewestNumber = async () => { entered = true; await gate; return read(); };
  const run = await world.start();
  await until(() => entered);
  let ended = false;
  const stopping = run.stop().then(() => { ended = true; });
  await new Promise(resolve => setImmediate(resolve));
  const startsAtStop = firings(world).length;
  release();
  await stopping;
  await new Promise(resolve => setImmediate(resolve));
  t.diagnostic(JSON.stringify({ ended, startsAtStop, starts: firings(world), outcomes: outcomes(world) }));
  assert.equal(firings(world).length, startsAtStop, 'a catch-up firing queued before abort must not start after abort');
});
// A completed run must not retain recovery capable of racing the next run's scan.
test('reviewer: a stopped run must not leave recovery that duplicates a card after the next start', async (t) => {
  const world = firingWorld({ clock: manualClock(START + 500), triggers: { hourly: { ...schedule, catchUp: 'skip' } }, record });
  const read = world.reads.readNewestNumber;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let firstRead = true;
  let entered = false;
  world.reads.readNewestNumber = async () => {
    const number = await read();
    if (firstRead) { firstRead = false; entered = true; await gate; }
    return number;
  };
  const first = await world.start();
  await until(() => entered);
  let firstEnded = false;
  const stopping = first.stop().then(() => { firstEnded = true; });
  await new Promise(resolve => setImmediate(resolve));
  t.diagnostic('first run returned while its recovery newest-number read is held: ' + firstEnded);
  let second;
  try {
    assert.equal(firstEnded, false, 'stop waits for the held recovery read');
    release();
    await stopping;
    assert.equal(world.fake.issues.length, 0, 'no opening began after stop');
    second = await world.start();
    await until(() => world.fake.issues.length === 1);
    await new Promise(resolve => setImmediate(resolve));
    t.diagnostic(JSON.stringify({ firstEndedBeforeRelease: firstEnded, issues: world.fake.issues, outcomes: outcomes(world) }));
    assert.equal(world.fake.issues.length, 1, 'sequential run invocations must not leave two cards for one pending occurrence');
  } finally { release(); await stopping; await second?.stop(); }
});
