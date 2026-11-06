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
