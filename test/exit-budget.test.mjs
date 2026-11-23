// ABOUTME: Tests what L0's exit cleanup decides against its fixed budget, in this process, from a
// stand-in host's answers and clock: which groups it reads, kills bare and records, and what L1 keeps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
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
