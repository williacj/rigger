// ABOUTME: Tests the harness L3's loop is proven through: its held maker is a stand-in process run
// through L1, its waits reject on time naming their condition and bound, a settling wait lets a
// wrong dispatch show before a test reads, and its stand-ins end with the test that started them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NOT_STARTED } from '../src/substrate/process.mjs';
import { heldCard } from './stop-failure.mjs';
import {
  COLUMNS, boardOf, drive, endStandIns, positive, settledOf, settling, stoppedRun, waitFor, world,
} from './loop-world.mjs';
import { alive, running, sweep } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

// A bound on a test that waits on stand-in processes, so one whose condition never holds fails
// here rather than holding the suite.
const { 20_000: SETTLES_WITHIN } = BOUNDS;

/**
 * Settles on how many milliseconds the promise `waiting()` answers took to reject, with its
 * failure. The clock is read before `waiting` is called, so the wait's own clock starts no earlier.
 */
async function rejection(waiting) {
  const began = performance.now();
  const failure = await waiting().then(() => assert.fail('the wait settled'), (thrown) => thrown);
  return { took: performance.now() - began, failure };
}

test('a wait on a condition that never holds, in a test that takes no bound, rejects once 5,000 ms has passed, naming the condition and its bound', async () => {
  const { took, failure } = await rejection(() => waitFor(() => 'the board' === 'empty'));

  assert.match(failure.message, /'the board' === 'empty'/);
  assert.match(failure.message, /\b5000 ms\b/);
  assert.ok(took >= 5_000, `the wait rejected after ${took} ms`);
});

/** The actual supplied samples of one wait, starting away from zero. */
function sampledWaitTime(elapsed) {
  const samples = [];
  return {
    now: () => {
      const sample = samples.length === 0 ? 40_000 : 40_000 + elapsed;
      samples.push(sample);
      return sample;
    },
    observedElapsed: () => samples.length < 2 ? 0 : samples.at(-1) - samples[0],
  };
}

test('a false wait rejects at supplied elapsed 5000 before yielding', SETTLES_WITHIN, async () => {
  const time = sampledWaitTime(5_000);
  let released = false;
  function namedDeadlineCondition() { return released; }
  const waiting = waitFor(namedDeadlineCondition, undefined, time.now);
  try {
    assert.equal(time.observedElapsed(), 5_000, 'waitFor used the supplied elapsed time');
    released = true;
    await assert.rejects(waiting, /namedDeadlineCondition.*5000 ms/s);
  } finally {
    released = true;
    await waiting.catch(() => {});
  }
});


test('a false wait reaches its next condition check at supplied elapsed 4999', SETTLES_WITHIN, async () => {
  const checkpoint = Promise.withResolvers();
  const samples = [];
  let current = 100_000;
  let checks = 0;
  let released = false;
  function beforeDeadlineCondition() {
    if (released) return true;
    current = 104_999;
    if (++checks === 2) checkpoint.resolve();
    return false;
  }
  const waiting = waitFor(beforeDeadlineCondition, undefined, () => {
    samples.push(current);
    return current;
  });
  const outcome = waiting.then(() => ({ kind: 'resolved' }), (failure) => ({ kind: 'rejected', failure }));
  try {
    const observed = await Promise.race([checkpoint.promise.then(() => ({ kind: 'condition' })), outcome]);
    assert.equal(observed.kind, 'condition', 'the wait reaches its next false-condition check before the deadline');
    assert.equal(samples.at(-1), 104_999, 'the before-deadline read uses supplied time');
    assert.equal(samples.at(-1) - samples[0], 4_999);
  } finally {
    released = true;
    await outcome;
  }
});

test('a false wait rejects after supplied elapsed 5001', SETTLES_WITHIN, async () => {
  const time = sampledWaitTime(5_001);
  let released = false;
  function afterDeadlineCondition() { return released; }
  const waiting = waitFor(afterDeadlineCondition, undefined, time.now);
  try {
    assert.equal(time.observedElapsed(), 5_001, 'the after-deadline read uses supplied time');
    released = true;
    await assert.rejects(waiting, /afterDeadlineCondition.*5000 ms/s);
  } finally {
    released = true;
    await waiting.catch(() => {});
  }
});

test('positive gives a true condition priority at and beyond the supplied deadline', SETTLES_WITHIN, async () => {
  await assert.doesNotReject(() => positive(() => true));
  for (const elapsed of [5_000, 5_001]) {
    let current = 90_000;
    let checkedAt;
    function readyAtDeadline() {
      current = 90_000 + elapsed;
      checkedAt = current;
      return true;
    }
    await assert.doesNotReject(() => positive(readyAtDeadline, 5_000, () => current));
    assert.equal(checkedAt - 90_000, elapsed);
  }
});

test('supplied expiry names its condition and a nondefault 17 ms bound', SETTLES_WITHIN, async () => {
  const time = sampledWaitTime(17);
  let released = false;
  function namedDeadlineCondition() { return released; }
  const waiting = waitFor(namedDeadlineCondition, 17, time.now);
  try {
    assert.equal(time.observedElapsed(), 17, 'nondefault expiry uses supplied time');
    released = true;
    const failure = await waiting.then(() => assert.fail('the wait settled'), (thrown) => thrown);
    assert.match(failure.message, /namedDeadlineCondition/, 'expiry names the actual condition');
    assert.match(failure.message, /\b17 ms\b/, 'expiry names the actual nondefault bound');
  } finally {
    released = true;
    await waiting.catch(() => {});
  }
});

test('drive\'s wait on a run that never settles rejects at supplied elapsed 5000 ms, naming its condition and its bound', SETTLES_WITHIN, async () => {
  // Card 1's workspace is never answered, so its claim is never held at a stand-in.
  const built = world({ cards: [1], concurrency: 1, workspace: () => new Promise(() => {}) });

  const time = sampledWaitTime(5_000);
  const failure = await drive(built, time.now).then(() => assert.fail('the wait settled'), (thrown) => thrown);

  assert.match(failure.message, /settles\(\)/);
  assert.match(failure.message, /\b5000 ms\b/);
  assert.equal(time.observedElapsed(), 5_000, 'drive routed the supplied wait time');
});

test('stoppedRun\'s wait on makers that never hold rejects at supplied elapsed 5000 ms, naming its condition and its bound', SETTLES_WITHIN, async () => {
  // A file stands where the world makes its workspaces, so no card's workspace can be made.
  const scratch = temporaryDirectory('rigger-loop-world-');
  writeFileSync(join(scratch, 'workspaces'), '');

  assert.equal(readFileSync(join(scratch, 'workspaces'), 'utf8'), '');
  const time = sampledWaitTime(5_000);
  const failure = await stoppedRun({ scratch, now: time.now }).then(() => assert.fail('the wait settled'), (thrown) => thrown);

  assert.match(failure.message, /held\(\) === 2/);
  assert.match(failure.message, /\b5000 ms\b/);
  assert.equal(time.observedElapsed(), 5_000, 'stoppedRun routed the supplied wait time');
});

test('given a world in which L3 makes a dispatch the test says it should not, a settling wait lets that dispatch start before the assertion that nothing happened reads, and the assertion fails', SETTLES_WITHIN, async () => {
  // The test asserts, as a test of a refused claim move does, that card 8 was never dispatched;
  // but this board takes the move, so L3 dispatches card 8.
  const built = world({ cards: [8], concurrency: 1 });

  const pull = built.loop.pull();
  await settling(built, settledOf(pull));

  assert.throws(() => assert.deepEqual(built.dispatches.started, []), /8/);
  assert.equal(built.dispatches.heldNow(8), true, 'card 8\'s maker stand-in had started');
  built.dispatches.releaseAll();
  await pull;
});

// The world's held maker, as `world` describes it.

/** The events of `layer` named `event` among `events`. */
const named = (events, layer, event) => events.filter((each) => each.layer === layer && each.event === event);

test('the world\'s held maker is a stand-in process run through L1: every card the world dispatched has its L1 dispatch.start and dispatch.end under its maker\'s dispatch id, and its stand-in ran in its workspace', SETTLES_WITHIN, async () => {
  const built = world({ cards: [1, 2, 3], concurrency: 2 });

  await drive(built);

  const events = built.events();
  const makers = named(events, 'L3', 'dispatch').filter((each) => each.role !== undefined);
  assert.deepEqual(makers.map((each) => each.card).sort(), [1, 2, 3]);
  for (const maker of makers) {
    const own = events.filter((each) => each.layer === 'L1' && each.dispatch === maker.dispatch).map((each) => each.event);
    assert.deepEqual(own, ['workspace.made', 'dispatch.start', 'dispatch.end'], `card ${maker.card}: ${JSON.stringify(events)}`);
  }
  assert.deepEqual(built.agent.runs().map((run) => run.card).sort(), [1, 2, 3]);
  assert.deepEqual(built.agent.runs().map((run) => run.role), ['engineer', 'engineer', 'engineer']);
});

test('given an answer that is an Error, that card\'s maker dispatch rejects with NOT_STARTED, no stand-in runs for it, and the outcome L2 receives is rejected', SETTLES_WITHIN, async () => {
  const built = world({ cards: [1], concurrency: 1, answer: () => new Error('the dispatch could not start') });
  const received = [];
  const settled = built.l2.settled;
  built.l2.settled = (card, outcome) => {
    received.push(outcome);
    return settled(card, outcome);
  };

  await assert.rejects(drive(built), heldCard(1));

  assert.deepEqual(received.map((outcome) => [outcome.status, outcome.reason?.code]), [['rejected', NOT_STARTED], ['rejected', NOT_STARTED]]);
  assert.deepEqual(built.agent.runs(), []);
  assert.deepEqual(built.dispatches.started, [1, 1], 'each attempt whose maker never starts still counts as started');
});

test('given a held stand-in released while its group is still being contained, drive does not release the next round until that card\'s slot.release is recorded', SETTLES_WITHIN, async () => {
  // Card 1's stand-in leaves a process outside its group holding its output open, so L0 contains
  // card 1 for its output bound, a second, before its census kills that process. Cards 1 and 2
  // are released together, card 2's slot frees and card 3 is pulled and held while card 1 is
  // contained. Each release drive makes records the slot releases tried by then.
  const built = world({ cards: [1, 2, 3], concurrency: 2 });
  const plan = built.agent.plan;
  built.agent.plan = (card, role, act) => plan(card, role, card === 1 ? { ...act, leave: true } : act);
  const rounds = [];
  const releaseAll = built.dispatches.releaseAll;
  built.dispatches.releaseAll = () => {
    rounds.push({ holding: built.dispatches.holding(), released: built.attempts.filter((each) => each.event === 'slot.release').map((each) => each.card) });
    releaseAll();
  };

  await drive(built);

  const third = rounds.find((round) => round.holding.includes(3));
  assert.ok(third, JSON.stringify(rounds));
  assert.ok(third.released.includes(1), `card 3 was released before card 1's slot.release was recorded: ${JSON.stringify(rounds)}`);
  assert.equal(existsSync(join(built.agent.dir, 'left-1')), true, 'card 1\'s stand-in left a process');
});

test('endStandIns ends every stand-in a world made in a scratch directory its caller gave, for a caller with no test to end them', SETTLES_WITHIN, async () => {
  // Its teardown ends what this test failed to, so a failure here ends rather than hangs.
  const scratch = temporaryDirectory('rigger-loop-world-given-', { beforeRemoval: () => sweep(scratch) });
  const built = world({ cards: [1], concurrency: 1, scratch });
  const pull = built.loop.pull();
  pull.catch(() => {});
  await positive(() => built.dispatches.held() === 1);
  const pid = built.agent.holder(1);

  endStandIns();

  await positive(() => !alive(pid));
  assert.deepEqual(running(scratch), []);
  await pull.catch(() => {});
});

/**
 * The source of a test file whose one test holds a world's maker, writes its pid, and then fails.
 * A teardown hook of its own, registered after the world's, writes to `aliveFile` whether that
 * maker is alive once the world's teardown has run, before the child's own exit can end it.
 */
const failingWorld = (harness, fixtures, pidFile, aliveFile) => [
  "import { test } from 'node:test';",
  "import { writeFileSync } from 'node:fs';",
  `const { positive, world } = await import(${JSON.stringify(harness)});`,
  `const { alive } = await import(${JSON.stringify(fixtures)});`,
  "test('a world that fails while its maker is held', async (t) => {",
  '  const built = world({ cards: [1], concurrency: 1 });',
  '  built.loop.pull().catch(() => {});',
  '  await positive(() => built.dispatches.held() === 1);',
  '  const pid = built.agent.holder(1);',
  `  writeFileSync(${JSON.stringify(pidFile)}, String(pid));`,
  `  t.after(() => writeFileSync(${JSON.stringify(aliveFile)}, String(alive(pid))));`,
  "  throw new Error('this world fails');",
  '});',
  '',
].join('\n');

test('every stand-in a failing test\'s worlds started is gone once that test has ended', SETTLES_WITHIN, () => {
  const directory = temporaryDirectory('rigger-loop-world-failing-');
  // The child's TMPDIR, whose teardown here ends whatever the child's own teardown left.
  const temporary = temporaryDirectory('rigger-loop-world-tmp-', { beforeRemoval: () => sweep(temporary) });
  const pidFile = join(directory, 'held.pid');
  const file = join(directory, 'failing.test.mjs');
  const aliveFile = join(directory, 'alive-after-teardown');
  writeFileSync(file, failingWorld(new URL('./loop-world.mjs', import.meta.url).href, new URL('./process-fixtures.mjs', import.meta.url).href, pidFile, aliveFile));

  // A child inheriting `NODE_TEST_CONTEXT` would report to this run rather than run its own.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  // `--test-force-exit` ends the child once its tests and their teardown are done, so a stand-in
  // the teardown left alive is seen alive here rather than holding the child open.
  const ran = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-reporter=spec', file], { cwd: directory, encoding: 'utf8', env: { ...env, TMPDIR: temporary }, timeout: 15_000 });

  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /this world fails/);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  // A teardown hook that throws stops every hook after it, the one writing this file included.
  const afterTeardown = existsSync(aliveFile) ? readFileSync(aliveFile, 'utf8') : 'unwritten, as a teardown hook before it threw';
  assert.equal(afterTeardown, 'false', `whether the stand-in ${pid} was alive once its test's teardown had run: ${afterTeardown}\n${ran.stdout}`);
  assert.ok(pid > 1, `the failing test held a stand-in: ${pid}`);
  assert.equal(alive(pid), false, `the stand-in ${pid} outlived its test`);
  assert.deepEqual(running(temporary), []);
});

test('a world records what each maker was handed as the board item L3 read at the pull that claimed it', SETTLES_WITHIN, async () => {
  const built = world({ fake: boardOf([1]), concurrency: 1 });

  const pull = built.loop.pull();
  await positive(() => built.dispatches.holding().includes(1));

  assert.deepEqual(built.handed.map(({ card }) => [card.number, card.id, card.column]), [[1, 'item-1', COLUMNS.ready]]);
  built.dispatches.releaseAll();
  await pull;
});
