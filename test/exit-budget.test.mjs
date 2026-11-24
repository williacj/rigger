// ABOUTME: Tests what L0's exit cleanup decides against its fixed budget, in this process, from a
// stand-in host's answers and clock: which groups it reads, kills bare and records, and what L1 keeps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { readGroups } from '../src/execution/groups.mjs';
import { killRecordedGroups } from '../src/execution/run.mjs';
import { atExit } from '../src/substrate/process.mjs';
import { BUDGET, budgetWorld, groupOf } from './exit-budget-world.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { trackerWorld, turn } from './process-fixtures.mjs';
import { manualClock } from './clock-report-world.mjs';

/**
 * L0's exit cleanup, taken off the `exit` event L0 installs it on (`ARCHITECTURE.md`, "Failure
 * model"). A test emits no `exit`, because the test runner listens to that event too.
 */
function exitCleanup() {
  const cleanup = process.listeners('exit').find(({ name }) => name === 'cleanup');
  assert.equal(typeof cleanup, 'function', 'L0 has not installed its exit cleanup');
  cleanup();
}

/** A sink that holds what it is given, and counts its ends. */
function heldSink() {
  const events = [];
  const held = { events, ends: 0, end() { held.ends += 1; }, emitter: ({ layer, card, dispatch }) => ({ emit: (event, fields) => events.push({ layer, card, dispatch, event, ...fields }) }) };
  return held;
}

/** The world of `plan`, once its dispatches stand as it says and L0's exit cleanup has run over them. */
async function cleanedUp(t, plan) {
  const directory = realpathSync(temporaryDirectory('rigger-budget-', { context: t }));
  const sink = heldSink();
  const world = budgetWorld(directory, plan, sink);
  atExit(sink.end);
  await world.settled();
  world.exit();
  exitCleanup();
  const state = join(directory, 'state');
  return { world, sink, state, events: sink.events, stderr: JSON.stringify(sink.events), record: readGroups(state), ...world.report() };
}

/** `check`, one case of `BUDGET`, over a `run` that hands it the worlds it asks for, each cleaned up first. */
async function each(t, check, ...rest) {
  // A case runs synchronously and asks for worlds as it goes, so it is run once to learn its plans,
  // each world is built and cleaned up, and it is run again over what they left.
  const plans = [];
  const asked = (plan) => { plans.push(plan); throw ASKED; };
  const done = [];
  for (;;) {
    let next = 0;
    try {
      check((plan) => (next < done.length ? done[next++] : asked(plan)), ...rest);
      return;
    } catch (error) {
      if (error !== ASKED) throw error;
      done.push(await cleanedUp(t, plans.at(-1)));
    }
  }
}
const ASKED = Symbol('a case asked for a world not yet built');

test('with no group held at the exit, the cleanup makes no read, sends no signal, and the sink still ends', async (t) => {
  const ran = await cleanedUp(t, { groups: [{ label: 1, finishes: true }] });
  assert.ok(ran.sink.ends >= 1, 'the sink did not end');
  BUDGET.noGroup(ran);
});

// proves R-STATE-9, R-STATE-17
test('nine ordinary groups at the exit each have their census and sweep inside EXIT_CARE_BOUND', async (t) => {
  await each(t, BUDGET.nineOrdinary);
});

// proves R-STATE-28
test('past EXIT_CARE_BOUND a stuck group finishes its cleanup, and each remaining group has the bare kill, its record and a reason', async (t) => {
  await each(t, BUDGET.stuckGroup);
});

// proves R-STATE-12, R-STATE-19
test('a process table that hangs at the exit is waited on once, and each group is recorded in place of what it could not read', async (t) => {
  await each(t, BUDGET.hungOnce);
});

// proves R-STATE-28
test('where the budget runs out during a hung read, the group that read began is finished and the next has the bare kill', async (t) => {
  await each(t, BUDGET.hungPastBudget);
});

// proves R-STATE-28
test('the budget is spent at EXIT_CARE_BOUND exactly, and a millisecond under it the next group has its census and sweep', async (t) => {
  await each(t, BUDGET.exactBound);
});

// proves R-STATE-28
test('a group already empty past the budget has no kill, keeps its entry, and ends with its own exit code', async (t) => {
  await each(t, BUDGET.alreadyEmpty);
});

// proves R-STATE-28
test('a group its call already ended and swept, reached past the budget, has no kill and its entry goes', async (t) => {
  await each(t, BUDGET.alreadySwept);
});

// proves R-STATE-19
test('one dispatch whose every read answers at its last moment ends within EXIT_BOUND less EXIT_CARE_BOUND, recording what the kill did not end', async (t) => {
  await each(t, BUDGET.lastMoment, (shown) => t.diagnostic(shown));
});

// proves R-STATE-28
test('a group killed bare keeps its entry and its survivors, and the next start sweeps both its directories and removes the entry', async (t) => {
  const ran = await cleanedUp(t, { groups: [{ label: 1, spent: 15_000 }, { label: 2, survivors: true }] });
  const group = groupOf(2);
  assert.deepEqual(ran.record.map(({ dispatch, group: held }) => [dispatch, held]), [['d-2', group]]);
  assert.deepEqual(ran.left.filter(({ group: of }) => of === 0).map(({ pid }) => pid), [group + 2, group + 3]);

  ran.world.reap();
  await killRecordedGroups({ directory: ran.state, sink: ran.sink, host: ran.world.host });

  assert.deepEqual(ran.sink.events.filter(({ event }) => event === 'recorded.killed').map(({ pid, dispatch }) => [pid, dispatch]), [[group + 2, 'd-2'], [group + 3, 'd-2']]);
  assert.deepEqual(ran.world.report().left, []);
  assert.deepEqual(readGroups(ran.state), []);
});

// A second directory must not buy another read deadline after the careful budget is spent.
test('T15: after the care bound passes both directories share one sweep of the loop', async (t) => {
  const { assertSweepTogether } = await import('./exit-budget-world.mjs');
  const plan = { label: 1, speed: 500, survivors: true, tracked: true, outlives: ['member', 'survivors', 'tracked'] };
  const two = await cleanedUp(t, { groups: [plan] });
  const one = await cleanedUp(t, { groups: [{ ...plan, noScratch: true }] });
  assertSweepTogether(two, one);
});

// Native T1–T6 keep the OS proof; these table answers isolate the decisions they exercise.
test('dispatch descendant decisions preserve identities, endings, isolation and the known escape', async (t) => {
  for (const ending of ['return', 'timeout', 'reparented', 'exit', 'isolation', 'known escape']) {
    await t.test(ending, async (t) => {
      const clock = manualClock(0);
      const world = trackerWorld(clock);
      const sibling = world.escaped + 1;
      world.table.set(sibling, { ...world.table.get(world.escaped), pid: sibling, group: sibling });
      const peer = ending === 'isolation' ? trackerWorld(clock, world.group + 100, world.table) : undefined;
      let starts = 0;
      const host = { ...world.host,
        spawn: () => (++starts === 1 ? world : peer).host.spawn(),
        signal: (target, name) => (target === -peer?.group ? peer : world).host.signal(target, name),
      };
      const sink = heldSink();
      const state = temporaryDirectory('rigger-tracker-decisions-', { context: t });
      const start = (id) => dispatch({ id, card: 1466, directory: state, sink,
        command: '/controlled/command', args: [], cwd: '/', env: {}, timeout: 3000, host, clock: clock.now });
      const running = start('decision');
      let other;
      t.after(async () => { world.finish(); peer?.finish(); await Promise.all([running, other]); });
      await turn(t);
      if (ending === 'isolation') { other = start('peer'); await turn(t); }
      if (ending === 'reparented') {
        world.table.get(world.escaped).parent = 1;
        await clock.advance(1000);
        await turn(t);
      }
      const unseen = world.escaped + 1000;
      if (ending === 'known escape') {
        world.table.set(unseen, { ...world.table.get(world.escaped), pid: unseen, parent: 1, group: unseen });
      }
      if (ending === 'timeout') await clock.advance(3000);
      else if (ending === 'exit') exitCleanup();
      else world.finish();
      await running;
      for (const pid of [world.escaped, sibling]) {
        assert.equal(world.table.get(pid).state, 'Z', 'a dispatch descendant outlived its ending');
        assert.deepEqual(sink.events.filter((event) => event.pid === pid).map(({ layer, dispatch, card, event, name, cmd }) => ({ layer, dispatch, card, event, name, cmd })), [
          { layer: 'L0', dispatch: 'decision', card: 1466, event: 'survivor.killed', name: 'controlled', cmd: `controlled ${world.escaped}` },
        ], 'each descendant needs exactly one named kill under its dispatch and card');
      }
      if (ending === 'timeout') {
        for (const row of world.table.values()) if (row.group === world.group) assert.equal(row.state, 'Z', 'a group member outlived the timeout');
      }
      if (peer) {
        assert.equal(world.table.get(peer.escaped).state, 'S', 'the running peer descendant was stopped or ended');
        assert.deepEqual(sink.events.filter(({ pid }) => pid === peer.escaped), []);
        peer.finish();
        await other;
      }
      if (ending === 'known escape') {
        assert.equal(world.table.get(unseen).state, 'S', 'the unattributed orphan was stopped or ended');
        assert.deepEqual(world.signals.filter(({ target }) => target === unseen), []);
        assert.deepEqual(sink.events.filter(({ pid }) => pid === unseen), []);
      }
      await turn(t);
    });
  }
});

/** The start `trackerWorld` gives every row, `Thu Oct 29 12:00:00 2026` in UTC, in seconds. */
const WORLD_STARTED = Date.UTC(2026, 9, 29, 12, 0, 0) / 1000;

/**
 * A later start over one entry a dead engine left for `world`'s group, recording `world.escaped` as
 * tracked unless `entry` says otherwise: what it signalled and what it recorded.
 */
async function restartedOver(t, world, entry = {}) {
  const state = temporaryDirectory('rigger-tracked-restart-', { context: t });
  const { writeGroups } = await import('../src/execution/groups.mjs');
  writeGroups(state, [{ group: world.group, started: WORLD_STARTED, dispatch: 'd-dead', card: 1467, tracked: [{ pid: world.escaped, started: WORLD_STARTED }], ...entry }]);
  const sink = heldSink();
  const failure = await killRecordedGroups({ directory: state, sink, host: world.host }).then(() => undefined, (error) => error);
  return { failure, state, events: sink.events, signalled: (pid) => world.signals.filter(({ target }) => target === pid).map(({ name }) => name) };
}

// Native R3 to R8 keep the OS proof; these table answers isolate what a later start decides.
test('a later start ends a recorded tracked process it confirms, leaves one it cannot, and refuses a malformed tracked set', async (t) => {
  await t.test('R3: a confirmed group and a confirmed tracked process are both ended and recorded', async (t) => {
    const world = trackerWorld(manualClock(0));
    const ran = await restartedOver(t, world);
    assert.equal(ran.failure, undefined);
    assert.deepEqual(ran.signalled(world.escaped), ['SIGSTOP', 'SIGKILL'], 'the tracked process was not stopped and killed');
    assert.deepEqual(ran.events.filter(({ pid }) => pid === world.escaped).map(({ layer, dispatch, card, event, name, cmd }) => ({ layer, dispatch, card, event, name, cmd })), [
      { layer: 'L0', dispatch: 'd-dead', card: 1467, event: 'recorded.killed', name: 'controlled', cmd: `controlled ${world.escaped}` },
    ]);
  });
  await t.test('R4: a tracked process is ended and recorded though its recorded group is not confirmed', async (t) => {
    const world = trackerWorld(manualClock(0));
    const ran = await restartedOver(t, world, { started: WORLD_STARTED - 1 });
    assert.equal(ran.failure, undefined);
    assert.deepEqual(ran.signalled(-world.group), [], 'the unconfirmed group was killed');
    assert.equal(world.table.get(world.group).state, 'S', 'the unconfirmed group\'s leader was ended');
    assert.deepEqual(ran.signalled(world.escaped), ['SIGSTOP', 'SIGKILL'], 'the tracked process was not stopped and killed');
    assert.deepEqual(ran.events.filter(({ pid }) => pid === world.escaped).map(({ dispatch, event }) => [dispatch, event]), [['d-dead', 'recorded.killed']]);
  });
  // ps(1) prints `lstart` as C's `%c`; a row whose column is not that form is a start time L0 cannot read.
  for (const [row, change] of [
    ['R5: a recorded tracked pid whose process started a second later', (world) => { world.table.get(world.escaped).started = 'Thu Oct 29 12:00:01 2026'; }],
  ]) {
    await t.test(`${row} is left alive and not stopped, and recorded as not ended`, async (t) => {
      const world = trackerWorld(manualClock(0));
      change(world);
      const ran = await restartedOver(t, world);
      assert.equal(ran.failure, undefined, ran.failure?.message);
      assert.deepEqual(ran.signalled(world.escaped), [], 'the process at the recorded pid was signalled');
      assert.equal(world.table.get(world.escaped).state, 'S');
      const named = ran.events.filter(({ pid }) => pid === world.escaped);
      assert.deepEqual(named.map(({ layer, dispatch, card, event }) => ({ layer, dispatch, card, event })), [{ layer: 'L0', dispatch: 'd-dead', card: 1467, event: 'recorded.unended' }]);
      assert.match(named[0].reason, /start time/);
    });
  }
  // Ambiguous identities stop the start; a mismatching identity above still goes on.
  for (const [row, change] of [
    ['R12: a listed recorded tracked pid whose start-time read cannot be read', (world) => world.inject((_tool, args) => (args.at(-1) === 'pid=,lstart=' ? { status: 0, stdout: `${world.escaped} not a start time\n`, stderr: '' } : undefined))],
    ['a recorded tracked pid whose start-time read fails', (world) => world.inject((_tool, args) => (args.at(-1) === 'pid=,lstart=' ? { error: Object.assign(new Error('ps refused'), { code: 2 }), stdout: '', stderr: 'ps refused' } : undefined))],
  ]) await t.test(`${row} is left alive and not stopped, and recorded as not ended`, async (t) => {
    const world = trackerWorld(manualClock(0));
    change(world);
    const ran = await restartedOver(t, world);
    assert.ok(ran.failure?.signs?.some(({ kind, pid, name, cmd }) => kind === 'unended' && pid === world.escaped && name === 'controlled' && cmd === `controlled ${world.escaped}`), ran.failure?.message);
    assert.equal(world.signals.some(({ target }) => target === world.escaped), false, 'the unconfirmed identity was signalled');
    assert.equal(world.table.get(world.escaped).state, 'S');
    const event = ran.events.find(({ event, pid }) => event === 'recorded.unended' && pid === world.escaped);
    assert.ok(event, 'the start did not record its unended process');
    for (const [key, value] of Object.entries({ layer: 'L0', dispatch: 'd-dead', card: 1467 })) assert.equal(event[key], value);
    assert.match(event.reason, /start time/);
    assert.ok(readGroups(ran.state)[0].unended.some(({ pid }) => pid === world.escaped), 'the sign was not retained');
  });
  await t.test('R11: a recorded tracked pid no read lists is sent no signal and named by no event', async (t) => {
    const world = trackerWorld(manualClock(0));
    world.table.delete(world.escaped);
    const ran = await restartedOver(t, world);
    assert.equal(ran.failure, undefined);
    assert.ok(world.reads.some(({ args }) => args.at(-1) === 'pid=,lstart=' && args.includes(String(world.escaped))), 'the start never read the recorded pid, so this proves nothing');
    assert.deepEqual(ran.signalled(world.escaped), []);
    assert.deepEqual(ran.events.filter(({ pid }) => pid === world.escaped), []);
  });
  await t.test('R7: an entry with no tracked-set field has its group ended as before, and no tracked read', async (t) => {
    const world = trackerWorld(manualClock(0));
    const ran = await restartedOver(t, world, { tracked: undefined });
    assert.equal(ran.failure, undefined);
    assert.ok(ran.signalled(-world.group).includes('SIGKILL'), 'the confirmed group was not killed');
    assert.deepEqual(readGroups(ran.state), [], 'the entry outlived its kill');
    assert.deepEqual(world.reads.filter(({ args }) => args.at(-1) === 'pid=,lstart='), [], 'a tracked process was read for an entry that records none');
    assert.deepEqual(ran.signalled(world.escaped), []);
  });
  for (const [what, tracked] of [
    ['no start time', [{ pid: 900_000_020 }]],
    ...[0, -1, 1, 2.5, '900000020'].map((pid) => [`the pid ${JSON.stringify(pid)}`, [{ pid, started: WORLD_STARTED }]]),
  ]) {
    await t.test(`R8: a record whose tracked process has ${what} is refused, naming the record, and ends nothing`, async (t) => {
      const world = trackerWorld(manualClock(0));
      const ran = await restartedOver(t, world, { tracked });
      assert.ok(ran.failure?.message.includes(join(ran.state, 'groups.json')), `the start did not name the record: ${ran.failure?.message}`);
      assert.deepEqual(world.signals, [], 'the start signalled a process');
    });
  }
});

/** A dispatch through L1's function over `world`, with its record in a state directory of its own. */
function trackedThroughL1(t, world, clock) {
  const state = temporaryDirectory('rigger-tracked-record-', { context: t });
  const sink = heldSink();
  const running = dispatch({ id: 'd-tracked', card: 1467, directory: state, sink,
    command: '/controlled/command', args: [], cwd: '/', env: {}, timeout: 600_000, host: world.host, clock: clock.now });
  running.catch(() => {});
  t.after(async () => { world.inject(() => undefined); world.finish(); await running.catch(() => {}); });
  return { state, sink, running, tracked: () => readGroups(state).find(({ dispatch: id }) => id === 'd-tracked')?.tracked };
}

// Native R1, R2 and R6 keep the OS proof; these table answers isolate what L0 hands L1 and what L1 keeps.
test('a dispatch\'s entry names each process the tracker adds, keeps it whatever later reads show, and its exit ends one whose rewrite failed', async (t) => {
  await t.test('R13: a tracked process that ends while its dispatch runs is still named by pid and start time', async (t) => {
    const clock = manualClock(0);
    const world = trackerWorld(clock);
    const ran = trackedThroughL1(t, world, clock);
    await turn(t);
    assert.deepEqual(ran.tracked(), [{ pid: world.escaped, started: WORLD_STARTED }], 'the first read\'s tracked process is not in the entry');
    // The tracked process ends, and the next read shows a later descendant in its place.
    const later = world.escaped + 100;
    world.table.set(later, { ...world.table.get(world.escaped), pid: later, group: later, started: 'Thu Oct 29 12:00:01 2026', cmd: `controlled ${later}` });
    world.table.delete(world.escaped);
    await clock.advance(1000);
    await turn(t);
    assert.ok(world.reads.filter(({ args }) => args.includes('-A')).length >= 2, 'no tracker read followed the process\'s end, so this proves nothing');
    // The entry is a set of identities: its order is not the record's to keep.
    const byPid = (identities) => [...(identities ?? [])].sort((one, other) => one.pid - other.pid);
    assert.deepEqual(byPid(ran.tracked()), byPid([{ pid: world.escaped, started: WORLD_STARTED }, { pid: later, started: WORLD_STARTED + 1 }]), 'the entry was pruned');
  });
  await t.test('R9: an entry keeps a tracked process through failed reads after its parent exits, and the next start ends it', async (t) => {
    const clock = manualClock(0);
    const world = trackerWorld(clock);
    const ran = trackedThroughL1(t, world, clock);
    await turn(t);
    assert.deepEqual(ran.tracked(), [{ pid: world.escaped, started: WORLD_STARTED }], 'the first read\'s tracked process is not in the entry');
    world.table.get(world.escaped).parent = 1;
    world.inject((_tool, args) => (args.includes('-A') ? { error: Object.assign(new Error('ps refused'), { code: 2 }), stdout: '', stderr: 'ps refused' } : undefined));
    for (const at of [1000, 2000, 3000]) {
      await clock.advance(at);
      await turn(t);
    }
    assert.ok(world.reads.filter(({ args }) => args.includes('-A')).length >= 4, 'no tracker read failed, so this proves nothing');
    const [entry] = readGroups(ran.state);
    assert.deepEqual(entry.tracked, [{ pid: world.escaped, started: WORLD_STARTED }], 'failed reads lost the tracked process');
    // The engine is killed outright here: the next start reads this entry over the same table, whose read confirms the start.
    const next = trackerWorld(manualClock(0), world.group, new Map([...world.table].map(([pid, row]) => [pid, { ...row }])));
    const restarted = await restartedOver(t, next, entry);
    assert.equal(restarted.failure, undefined);
    assert.deepEqual(restarted.signalled(world.escaped), ['SIGSTOP', 'SIGKILL']);
    assert.deepEqual(restarted.events.filter(({ pid }) => pid === world.escaped).map(({ dispatch, card, event }) => [dispatch, card, event]), [['d-tracked', 1467, 'recorded.killed']]);
  });
  await t.test('R10: a tracked process whose entry rewrite failed is killed and recorded by the exit within its budget', async (t) => {
    const clock = manualClock(0);
    const world = trackerWorld(clock);
    const row = world.table.get(world.escaped);
    world.table.delete(world.escaped);
    const ran = trackedThroughL1(t, world, clock);
    await turn(t);
    // The record's rewrite goes through its partial file, which a directory at that path refuses.
    mkdirSync(join(ran.state, 'groups.json.partial'));
    world.table.set(world.escaped, row);
    await clock.advance(1000);
    await turn(t);
    assert.ok(world.reads.filter(({ args }) => args.includes('-A')).length >= 2, 'no tracker read followed the refusal, so this proves nothing');
    assert.equal(ran.tracked(), undefined, 'the rewrite naming the process did not fail, so this proves nothing');
    // Its parent exits, so the exit's final read no longer shows it as the dispatch's.
    row.parent = 1;
    exitCleanup();
    await ran.running.catch(() => {});
    assert.ok(world.signals.some(({ target, name }) => target === world.escaped && name === 'SIGKILL'), 'the exit did not kill the tracked process');
    assert.deepEqual(ran.sink.events.filter(({ pid }) => pid === world.escaped).map(({ dispatch, card, event }) => [dispatch, card, event]), [['d-tracked', 1467, 'survivor.killed']]);
  });
});
