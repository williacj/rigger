// ABOUTME: Proves what a start under `run` does with each clock trigger from the event record:
// arming, re-arming, catch-up of a missed occurrence, a pending report firing, an unreadable record.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { START, manualClock } from './clock-report-world.mjs';
import { RUN, armingWorld, line } from './clock-arming-world.mjs';
import { failuresIn, keptUp } from './kept-up-run.mjs';
import { waitFor } from './loop-world.mjs';
import { streamPath } from '../src/observation/sink.mjs';

const SECOND = 1000;
const ANCHOR = new Date(START).toISOString();
const at = (instant) => new Date(instant).toISOString();
/** A report trigger firing each second from START, under `catchUp`. */
const report = (catchUp, fields = {}) => ({ interval: SECOND, anchor: ANCHOR, catchUp, job: 'report', ...fields });
/** The record's opening event, so the stream exists. */
const opening = line(START, 'run.start', { concurrency: 1 });

/** This run's events named `event`, as the fields a test reads. */
const ofRun = (built, event) => built.events().filter((each) => each.run === RUN && each.event === event);
const armings = (built) => ofRun(built, 'trigger.armed').map(({ ts, name, interval, anchor }) => ({ ts, name, interval, anchor }));
const firings = (built) => ofRun(built, 'trigger').filter(({ trigger }) => trigger === 'clock').map(({ name, occurrence }) => ({ name, occurrence }));
const outcomes = (built) => ofRun(built, 'trigger.outcome').map(({ name, occurrence, outcome }) => ({ name, occurrence, outcome }));

/**
 * Starts `built`'s run kept up, waits for its start to finish its first pull, or for the run to
 * end, so a start that throws fails the test's assertions rather than its wait, and answers its
 * handle with the run's rejection, where it rejected, as `rejected`.
 */
async function started(built) {
  const run = keptUp(built);
  let ended = false;
  run.running.then(() => { ended = true; }, (reason) => { ended = true; run.rejected = reason; });
  await waitFor(() => ended || built.emitted.some(({ event, trigger }) => event === 'trigger' && trigger === 'drain'));
  return run;
}

// proves R-SCHED-36
test('A1: a trigger no arming names is armed at the start, and no occurrence at or before the arming fires', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record: opening });
  const { stop } = await started(built);
  try {
    assert.deepEqual(armings(built), [{ ts: at(START + 5500), name: 'hourly', interval: SECOND, anchor: ANCHOR }]);
    assert.deepEqual(firings(built), [], 'the five occurrences before the arming are never due');
    await clock.advance(START + 6 * SECOND);
    assert.deepEqual(firings(built), [{ name: 'hourly', occurrence: at(START + 6000) }]);
  } finally {
    await stop();
  }
});

/** Each `[name, trigger]` arming line at `when`, holding that trigger's schedule. */
const armed = (when, name, { interval = SECOND, anchor = ANCHOR } = {}) => line(when, 'trigger.armed', { name, interval, anchor });
const outcome = (when, name, occurrence, result = 'job') => line(when, 'trigger.outcome', { name, occurrence: at(occurrence), outcome: result });
const fired = (when, name, occurrence) => line(when, 'trigger', { trigger: 'clock', name, occurrence: at(occurrence) });
/** A card-shaped trigger firing each second from START. */
const cardShaped = (fields = {}) => ({ interval: SECOND, anchor: ANCHOR, catchUp: 'fire', card: { title: 'Audit', labels: ['type:change'], acceptance: '- The audit writes a result.', ...fields } });

// proves R-SCHED-37
test('A2: a trigger whose newest arming holds another interval is re-armed, and its missed occurrences never fire', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record: opening + armed(START, 'hourly', { interval: 2 * SECOND }) });
  const { stop } = await started(built);
  try {
    assert.deepEqual(armings(built), [{ ts: at(START + 5500), name: 'hourly', interval: SECOND, anchor: ANCHOR }]);
    assert.deepEqual(firings(built), []);
  } finally {
    await stop();
  }
});

// proves R-SCHED-37
test('A2: a trigger whose newest arming holds another anchor is re-armed', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record: opening + armed(START, 'hourly', { anchor: at(START - 500) }) });
  const { stop } = await started(built);
  try {
    assert.deepEqual(armings(built), [{ ts: at(START + 5500), name: 'hourly', interval: SECOND, anchor: ANCHOR }]);
    assert.deepEqual(firings(built), []);
  } finally {
    await stop();
  }
});

// proves R-SCHED-37
test('A3: a schedule changed back to one an earlier arming holds is re-armed, because the newest arming holds another', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const record = opening + armed(START, 'hourly') + armed(START + SECOND, 'hourly', { interval: 2 * SECOND });
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record });
  const { stop } = await started(built);
  try {
    assert.deepEqual(armings(built), [{ ts: at(START + 5500), name: 'hourly', interval: SECOND, anchor: ANCHOR }]);
    assert.deepEqual(firings(built), []);
  } finally {
    await stop();
  }
});

test('A4: a trigger removed, then declared again under its newest arming\'s schedule, is not re-armed and catches up once', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  // The start at START + 2s declared no trigger, so it armed nothing.
  const record = opening + armed(START, 'hourly') + outcome(START + SECOND, 'hourly', START + SECOND) + line(START + 2 * SECOND, 'run.start', { concurrency: 1 });
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record });
  const { stop } = await started(built);
  try {
    assert.deepEqual(armings(built), []);
    assert.deepEqual(firings(built), [{ name: 'hourly', occurrence: at(START + 5000) }]);
  } finally {
    await stop();
  }
});

// proves R-SCHED-37
test('A5: a changed card template, author, internal job or catch-up policy, its schedule not, does not re-arm', async () => {
  const variants = {
    'catch-up policy': report('skip'),
    'internal job, now a card': cardShaped(),
    'card template': cardShaped({ title: 'Another audit', labels: ['type:change', 'area:audit'], acceptance: '- The audit writes two results.' }),
    'author': cardShaped({ author: 'owner' }),
  };
  for (const [change, trigger] of Object.entries(variants)) {
    const clock = manualClock(START + 5 * SECOND + 500);
    const built = armingWorld(clock, { triggers: { hourly: trigger }, record: opening + armed(START, 'hourly') });
    const { stop } = await started(built);
    try {
      assert.deepEqual(armings(built), [], change);
    } finally {
      await stop();
    }
  }
});

// proves R-SCHED-37
test('A6: a renamed trigger is armed under its new name, and nothing fires for the old one', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const built = armingWorld(clock, { triggers: { renamed: report('fire') }, record: opening + armed(START, 'hourly') });
  const { stop } = await started(built);
  try {
    assert.deepEqual(armings(built), [{ ts: at(START + 5500), name: 'renamed', interval: SECOND, anchor: ANCHOR }]);
    assert.deepEqual(firings(built), [], 'the new name has missed nothing, and the old one is not declared');
    await clock.advance(START + 6 * SECOND);
    assert.deepEqual(firings(built), [{ name: 'renamed', occurrence: at(START + 6000) }]);
  } finally {
    await stop();
  }
});

// proves R-SCHED-36
test('A1a: a card-shaped trigger is armed and re-armed as a report trigger is, and nothing fires for it', async () => {
  for (const [record, why] of [[opening, 'no arming names it'], [opening + armed(START, 'daily', { interval: 2 * SECOND }), 'its newest arming holds another interval']]) {
    const clock = manualClock(START + 5 * SECOND + 500);
    const built = armingWorld(clock, { triggers: { daily: cardShaped() }, record });
    const { stop } = await started(built);
    try {
      assert.deepEqual(armings(built), [{ ts: at(START + 5500), name: 'daily', interval: SECOND, anchor: ANCHOR }], why);
      await clock.advance(START + 8 * SECOND);
      assert.deepEqual(firings(built), [], why);
    } finally {
      await stop();
    }
  }
});

// proves R-SCHED-8
test('A7: occurrences missed under catchUp fire make one firing at the start, carrying the newest, before the first pull', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const record = opening + armed(START, 'hourly') + outcome(START + SECOND, 'hourly', START + SECOND);
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record });
  const { stop } = await started(built);
  try {
    assert.deepEqual(armings(built), []);
    assert.deepEqual(firings(built), [{ name: 'hourly', occurrence: at(START + 5000) }], 'one firing for the four missed occurrences');
    assert.deepEqual(outcomes(built), [{ name: 'hourly', occurrence: at(START + 5000), outcome: 'job' }]);
    const order = built.events().filter((each) => each.run === RUN && each.event === 'trigger').map(({ trigger }) => trigger);
    assert.deepEqual(order.slice(0, 2), ['clock', 'pull'], 'the catch-up firing precedes the start\'s first pull');
    await clock.advance(START + 6 * SECOND);
    assert.deepEqual(firings(built), [{ name: 'hourly', occurrence: at(START + 5000) }, { name: 'hourly', occurrence: at(START + 6000) }]);
  } finally {
    await stop();
  }
});

// proves R-SCHED-8
test('A8: occurrences missed under catchUp skip make no firing, and none of them fires later in the run', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const record = opening + armed(START, 'hourly') + outcome(START + SECOND, 'hourly', START + SECOND);
  const built = armingWorld(clock, { triggers: { hourly: report('skip') }, record });
  const { stop } = await started(built);
  try {
    assert.deepEqual(firings(built), []);
    await clock.advance(START + 5 * SECOND + 900);
    assert.deepEqual(firings(built), [], 'a wake inside the run finds no missed occurrence due');
    await clock.advance(START + 6 * SECOND);
    assert.deepEqual(firings(built), [{ name: 'hourly', occurrence: at(START + 6000) }]);
  } finally {
    await stop();
  }
});

test('A9: the last firing is the outcome naming the newest occurrence, never the one recorded last', async () => {
  const clock = manualClock(START + 4 * SECOND + 500);
  const record = opening + armed(START, 'hourly') + outcome(START + 4 * SECOND, 'hourly', START + 4 * SECOND)
    + outcome(START + 4 * SECOND + 100, 'hourly', START + 2 * SECOND, 'failed');
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record });
  const { stop } = await started(built);
  try {
    assert.deepEqual(firings(built), [], 'the occurrence at START + 4s has fired already');
  } finally {
    await stop();
  }
});

// proves R-SCHED-36
test('A10: a state directory holding no stream reads as a record holding no event, so each trigger is armed', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, named: false });
  const { stop } = await started(built);
  try {
    built.name();
    assert.deepEqual(armings(built), [{ ts: at(START + 5500), name: 'hourly', interval: SECOND, anchor: ANCHOR }]);
    assert.deepEqual(firings(built), []);
  } finally {
    await stop();
  }
});

/** A record whose second line is not one event, holding an arming whose occurrences were missed. */
const unreadable = opening + 'not one event\n' + armed(START, 'hourly');

// proves R-SCHED-38
test('A11: an unreadable record arms and fires no trigger for the run, and the start names the stream, the line and why', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const built = armingWorld(clock, { triggers: { hourly: report('fire'), fresh: report('fire') }, record: unreadable });
  const { handed, stop } = await started(built);
  try {
    const failures = failuresIn(handed).map(({ message }) => message);
    assert.equal(failures.length, 1, failures.join('\n'));
    assert.ok(failures[0].includes(`${streamPath(built.directory)} line 2 is not a recorded event`), failures[0]);
    assert.match(failures[0], /JSON/, 'it says why the line would not parse');
    assert.match(failures[0], /no clock trigger arms or fires/);
    await clock.advance(START + 9 * SECOND);
    assert.deepEqual(built.emitted.filter(({ event, trigger }) => event === 'trigger.armed' || trigger === 'clock'), []);
  } finally {
    await stop();
  }
});

// proves R-SCHED-39
test('A12: a start that cannot read the record still pulls cards', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record: unreadable, cards: [1] });
  const { handed, running, stop } = keptUp(built);
  let ended = false;
  running.then(() => { ended = true; }, () => { ended = true; });
  const pulled = () => built.emitted.some(({ event, card }) => event === 'pull' && card === 1);
  try {
    await waitFor(() => pulled() || ended);
    assert.ok(pulled(), 'the run pulled card 1 at the start that could not read the record');
    assert.match(failuresIn(handed)[0].message, /could not be read/, 'the record was unreadable at this start');
  } finally {
    const stopping = stop();
    built.releaseWorkspaces();
    // The card's refused workspace fails its pull, which this row does not read.
    await stopping.catch(() => {});
  }
});

test('A13: an arming the sink refuses is the halt: the trigger fires nothing, and run hands the refusal over', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record: opening + armed(START, 'hourly', { interval: 2 * SECOND }) });
  built.refuse((event) => event === 'trigger.armed');
  const { handed, stop } = await started(built);
  try {
    built.accept();
    await clock.advance(START + 9 * SECOND);
    assert.deepEqual(firings(built), []);
    assert.deepEqual(armings(built), []);
    const failures = failuresIn(handed).map(({ message }) => message);
    assert.ok(failures.some((message) => /hourly/.test(message) && /refused its arming/.test(message)), failures.join('\n'));
  } finally {
    await stop();
  }
});

test('A14: a report firing found pending at a start is recorded abandoned, whatever the trigger now declares, and no job runs', async () => {
  const declarations = {
    'unchanged': { hourly: report('fire') },
    'no longer declared': { other: report('fire') },
    'now a card': { hourly: cardShaped() },
    're-armed': { hourly: report('fire', { interval: 2 * SECOND }) },
  };
  for (const [now, triggers] of Object.entries(declarations)) {
    const clock = manualClock(START + 3 * SECOND + 500);
    const record = opening + armed(START, 'hourly') + fired(START + 3 * SECOND, 'hourly', START + 3 * SECOND);
    const built = armingWorld(clock, { triggers, record });
    const { handed, stop } = await started(built);
    try {
      assert.deepEqual(outcomes(built), [{ name: 'hourly', occurrence: at(START + 3000), outcome: 'abandoned' }], now);
      assert.deepEqual(firings(built), [], now);
      assert.deepEqual(handed.filter(({ report: made }) => made !== undefined), [], now);
    } finally {
      await stop();
    }
  }
});

test('A14a: an abandoned outcome the sink refuses leaves the firing pending, and the trigger fires nothing until a later trigger settles it', async () => {
  const clock = manualClock(START + 3 * SECOND + 500);
  const record = opening + armed(START, 'hourly') + fired(START + 3 * SECOND, 'hourly', START + 3 * SECOND);
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record });
  built.refuse((event, { outcome: result }) => event === 'trigger.outcome' && result === 'abandoned');
  const { handed, stop } = await started(built);
  try {
    const failures = failuresIn(handed).map(({ message }) => message);
    assert.ok(failures.some((message) => /hourly/.test(message) && /stayed pending/.test(message)), failures.join('\n'));
    await clock.advance(START + 4 * SECOND);
    assert.deepEqual(firings(built), [], 'a pending firing holds back its trigger');
    assert.deepEqual(outcomes(built), []);
    built.accept();
    await clock.advance(START + 5 * SECOND);
    assert.deepEqual(outcomes(built), [
      { name: 'hourly', occurrence: at(START + 3000), outcome: 'abandoned' },
      { name: 'hourly', occurrence: at(START + 5000), outcome: 'job' },
    ]);
    assert.deepEqual(firings(built), [{ name: 'hourly', occurrence: at(START + 5000) }]);
  } finally {
    await stop();
  }
});

test('A15: under once, an unreadable record and a trigger never armed arm nothing, write nothing of the record, and leave the answer as it was', async () => {
  const answers = [];
  for (const record of [opening, opening + 'not one event\n']) {
    const clock = manualClock(START + 5 * SECOND + 500);
    const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record });
    answers.push(await built.loop.pull());
    assert.deepEqual(built.emitted.filter(({ event }) => event === 'trigger.armed'), []);
    assert.equal(clock.pending(), 0, 'once arms no timer');
  }
  assert.deepEqual(answers[1], answers[0], 'the unreadable record changes nothing once answers');
  assert.doesNotMatch(JSON.stringify(answers[1]), /could not be read|not a recorded event/);
});

test('A16: several triggers at one start each follow their own row', async () => {
  const clock = manualClock(START + 5 * SECOND + 500);
  const record = opening + armed(START, 'rescheduled', { interval: 2 * SECOND }) + armed(START, 'caught') + armed(START, 'skipped');
  const triggers = { fresh: report('fire'), rescheduled: report('fire'), caught: report('fire'), skipped: report('skip') };
  const built = armingWorld(clock, { triggers, record });
  const { stop } = await started(built);
  try {
    assert.deepEqual(armings(built).map(({ name }) => name).sort(), ['fresh', 'rescheduled']);
    assert.deepEqual(firings(built), [{ name: 'caught', occurrence: at(START + 5000) }]);
    await clock.advance(START + 6 * SECOND);
    assert.deepEqual(firings(built).slice(1), ['caught', 'fresh', 'rescheduled', 'skipped'].map((name) => ({ name, occurrence: at(START + 6000) })));
  } finally {
    await stop();
  }
});

test('A17: after the start, a wake fires each trigger due once, carrying the newest occurrence after the start', async () => {
  const clock = manualClock(START + 500);
  const built = armingWorld(clock, { triggers: { hourly: report('fire') }, record: opening + armed(START, 'hourly') });
  const { stop } = await started(built);
  try {
    assert.deepEqual(firings(built), []);
    await clock.advance(START + 3 * SECOND + 500);
    assert.deepEqual(firings(built), [{ name: 'hourly', occurrence: at(START + 3000) }]);
  } finally {
    await stop();
  }
});

/** A clock that stands at `start` and moves to `then` once the sink has written `event`. */
function movedAfter(start, then, event) {
  const clock = manualClock(start);
  return { clock, afterEmit: (written) => { if (written === event) void clock.advance(then); } };
}

// proves R-SCHED-36
test('A1: time passing while the sink writes the arming leaves the arming at its event\'s ts', async () => {
  for (const catchUp of ['fire', 'skip']) {
    const { clock, afterEmit } = movedAfter(START + 6 * SECOND - 1, START + 6 * SECOND, 'trigger.armed');
    const built = armingWorld(clock, { triggers: { hourly: report(catchUp) }, record: opening, afterEmit });
    const { stop } = await started(built);
    try {
      assert.deepEqual(armings(built).map(({ ts }) => ts), [at(START + 5999)], catchUp);
      assert.deepEqual(firings(built), [{ name: 'hourly', occurrence: at(START + 6000) }], `${catchUp}: the occurrence after the arming's ts is due`);
    } finally {
      await stop();
    }
  }
});

test('A14: a report firing found pending at a start under run with no trigger declared is recorded abandoned', async () => {
  const record = opening + armed(START, 'hourly') + fired(START + 3 * SECOND, 'hourly', START + 3 * SECOND);
  for (const [declared, triggers] of [['an empty trigger set', {}], ['no clock declaration', undefined]]) {
    for (const singlePull of [false, true]) {
      const built = armingWorld(manualClock(START + 3 * SECOND + 500), { triggers, record });
      const handed = [];
      await built.loop.run({ singlePull, handOver: (each) => handed.push(each) });
      built.name();
      assert.deepEqual(outcomes(built), [{ name: 'hourly', occurrence: at(START + 3000), outcome: 'abandoned' }], `${declared}, singlePull ${singlePull}`);
      assert.deepEqual(handed, [], `${declared}, singlePull ${singlePull}`);
    }
  }
});

// proves R-SCHED-38
test('A11: a start under run with no trigger declared that cannot read the record names it', async () => {
  for (const singlePull of [false, true]) {
    const built = armingWorld(manualClock(START + 3 * SECOND + 500), { triggers: {}, record: unreadable });
    const handed = [];
    await built.loop.run({ singlePull, handOver: (each) => handed.push(each) });
    const failures = failuresIn(handed).map(({ message }) => message);
    assert.equal(failures.length, 1, `singlePull ${singlePull}: ${failures.join('\n')}`);
    assert.ok(failures[0].includes(`${streamPath(built.directory)} line 2 is not a recorded event`), failures[0]);
  }
});

// proves R-SCHED-38
test('A11: a line that parses to something other than one event makes the record unreadable', async () => {
  for (const value of ['null', '7', '"text"', '[]', 'true', '{}', '{"event":"trigger.armed","name":"hourly","interval":1000,"anchor":"x"}']) {
    const clock = manualClock(START + 5 * SECOND + 500);
    const record = opening + `${value}\n` + armed(START, 'hourly');
    const built = armingWorld(clock, { triggers: { hourly: report('fire'), fresh: report('fire') }, record });
    const { handed, stop, rejected } = await started(built);
    try {
      assert.equal(rejected, undefined, `${value}: the start threw ${rejected?.message}`);
      const failures = failuresIn(handed).map(({ message }) => message);
      assert.equal(failures.length, 1, `${value}: ${failures.join('\n')}`);
      assert.ok(failures[0].includes(`${streamPath(built.directory)} line 2 is not a recorded event`), `${value}: ${failures[0]}`);
      await clock.advance(START + 9 * SECOND);
      assert.deepEqual(built.emitted.filter(({ event, trigger }) => event === 'trigger.armed' || trigger === 'clock'), [], value);
    } finally {
      await stop();
    }
  }
});
