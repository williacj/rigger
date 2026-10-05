// ABOUTME: Tests environment retries and one-invocation admission after a maker or judge cannot start.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { WORKSPACE_NOT_MADE, workspaceHandle } from '../src/execution/workspace.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { cardIn, judgeWorld, pullFor, recorded } from './judge-world.mjs';
import { clonedFromOrigin } from './git-repository.mjs';
import { COLUMNS, KINDS, columnsOf, makingWorkspaces, readyCard, waitFor } from './loop-world.mjs';
import { scratch } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const { 60_000: SETTLES_WITHIN } = BOUNDS;

// proves R-FAIL-2
test('L2 ends an attempt for a maker outcome other than a dispatch that never started', () => {
  const outcomes = [
    { status: 'fulfilled', value: { exit: 0 } },
    { status: 'rejected', reason: Object.assign(new Error('the record refused an end'), { code: 'EVENT_NOT_RECORDED' }) },
  ];
  for (const maker of outcomes) {
    assert.deepEqual(nextAction(readyCard(7), KINDS, undefined, {
      columns: COLUMNS, roles: config.roles, provisioning: {}, maker,
    }), { action: 'settled' });
  }
});

// proves R-FAIL-2
test('L2 ends a maker attempt even when the kind declares no provisioning steps', () => {
  assert.deepEqual(nextAction(readyCard(7), KINDS, undefined, {
    columns: COLUMNS, roles: config.roles, maker: { status: 'fulfilled', value: { exit: 0 } },
  }), { action: 'settled' });
});

// proves R-FAIL-2
test('L3 hands a maker outcome to L2 after settle without reading its contents', SETTLES_WITHIN, async () => {
  const built = judgeWorld({
    cards: [cardIn(7, COLUMNS.ready)],
    kinds: { change: { ...KINDS.change, judges: ['owner'] } },
  });
  const handed = [];
  const decide = (card, outcomes, options) => {
    if (options?.maker !== undefined) handed.push(options.maker);
    return built.handed.decide(card, outcomes, options);
  };

  const [reached] = await loop({ ...built.handed, decide }).pull(1);

  assert.equal(handed.length, 1);
  assert.equal(handed[0], reached.outcome);
  assert.equal(reached.outcome.status, 'fulfilled');
});

// proves R-FAIL-2
test('L2 retries a maker dispatch that never started and stops it after the second environment failure', () => {
  const directory = temporaryDirectory('rigger-environment-retry-');
  const sink = openSink({ directory, run: 'r-environment-retry', now: Date.now });
  const maker = { status: 'rejected', reason: Object.assign(new Error('the maker could not start'), { code: NOT_STARTED }) };
  const answer = (attempt) => nextAction(readyCard(7), KINDS, undefined, {
    columns: COLUMNS, roles: config.roles, provisioning: {}, sink, maker, attempt,
  });

  assert.deepEqual(answer(1), {
    action: 'again', card: 7, attempt: 2,
    failure: { class: 'environment', maker: 'engineer', status: 'rejected', code: NOT_STARTED, reason: 'the maker could not start' },
  });
  assert.deepEqual(answer(2), {
    action: 'stop', card: 7,
    failure: { class: 'environment', maker: 'engineer', status: 'rejected', code: NOT_STARTED, reason: 'the maker could not start' },
  });
  assert.deepEqual(readEvents(directory).filter(({ layer }) => layer === 'L2').map(({ event, attempt, decision, class: classed, maker: role }) => ({ event, attempt, decision, class: classed, maker: role })), [
    { event: 'attempt.failed', attempt: 1, decision: undefined, class: 'environment', maker: 'engineer' },
    { event: 'attempt.decided', attempt: 1, decision: 'again', class: undefined, maker: undefined },
    { event: 'attempt.failed', attempt: 2, decision: undefined, class: 'environment', maker: 'engineer' },
    { event: 'attempt.decided', attempt: 2, decision: 'stop', class: undefined, maker: undefined },
  ]);
});

// proves R-FAIL-2
test('a fresh verdict does not hide a maker that never started or its second attempt', () => {
  const directory = temporaryDirectory('rigger-environment-fresh-');
  const sink = openSink({ directory, run: 'r-environment-fresh', now: Date.now });
  const card = { ...readyCard(7), column: COLUMNS.coding };
  const maker = { status: 'rejected', reason: Object.assign(new Error('the maker could not start'), { code: NOT_STARTED }) };
  const answer = (attempt) => nextAction(card, KINDS, undefined, {
    columns: COLUMNS, fresh: () => true, roles: config.roles, provisioning: {}, sink, maker, attempt,
  });

  assert.equal(answer(1).action, 'again');
  assert.equal(answer(2).action, 'stop');
});

/** The individual failures inside L3's pull and run failures, retaining each card's stop. */
const leaves = (failure) => (failure instanceof AggregateError ? failure.errors.flatMap(leaves) : [failure]);

/**
 * Two ready cards under real L2 and L3. Card 1 meets `kind` of environment failure; card 2's
 * stand-in maker holds until its test releases it. The board's read cap ends a base run that
 * re-pulls card 1, keeping the base-red runner bounded without a timer or sleep.
 */
function failingWorld(kind, { other = true } = {}) {
  const under = temporaryDirectory('rigger-environment-workspaces-');
  const making = makingWorkspaces(under);
  const workspace = async (number) => {
    if (number === 1 && kind === 'workspace') {
      throw Object.assign(new Error('the workspace disk is full'), { code: WORKSPACE_NOT_MADE, path: join(under, 'rigger-1') });
    }
    const made = await making(number);
    if (number === 1 && kind === 'maker') rmSync(made.path, { recursive: true });
    return made;
  };
  const step = kind === 'step-not-started'
    ? { run: 'true', cwd: 'missing', required: true, select: { labels: ['broken'] } }
    : { run: 'exit 3', required: true, select: { labels: ['broken'] } };
  const steps = kind.startsWith('step-') ? ['broken'] : [];
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['owner'], provisioning: steps } };
  const cards = [cardIn(1, COLUMNS.ready, ['broken']), ...(other ? [cardIn(2, COLUMNS.ready)] : [])];
  const built = judgeWorld({ cards, kinds, provisioning: steps.length === 0 ? {} : { broken: step }, concurrency: 2, workspace });
  if (other) built.agent.plan(2, 'engineer', { hold: true, exit: 0 });
  const board = built.handed.board;
  let reads = 0;
  const guarded = { ...board, readPriority: async () => {
    reads += 1;
    if (reads > 8) throw new Error('the base pulled the failing card repeatedly');
    return board.readPriority();
  } };
  return { ...built, loop: loop({ ...built.handed, board: guarded }), made: making.made, reads: () => reads };
}

/** Runs card 1's failure while card 2 holds a slot, then releases card 2 and captures the run. */
async function runFailure(kind) {
  const built = failingWorld(kind);
  const result = built.loop.run().then((value) => ({ value }), (failure) => ({ failure }));
  await waitFor(() => built.agent.held(2, 'engineer'), 20_000);
  built.agent.release(2, 'engineer');
  return { built, ...(await result) };
}

/** The structured stop for `card`, among all failures L3 reported. */
function stopOf(failure, card) {
  const stop = leaves(failure).find((each) => each.card === card && Array.isArray(each.attemptFailures));
  assert.ok(stop, `no stop for card #${card}: ${failure?.stack}`);
  return stop;
}

test('a maker that never starts is tried twice in a fresh workspace, and its pull reports both failures only in the stop', SETTLES_WITHIN, async () => {
  const built = failingWorld('maker', { other: false });

  const failure = await built.loop.pull(1).then(() => assert.fail('the stopped pull fulfilled'), (thrown) => thrown);
  const stop = stopOf(failure, 1);

  assert.deepEqual(built.made.map(({ path }) => path), [join(built.made[0].path), join(built.made[0].path)]);
  assert.deepEqual(recorded(built, 'L3', 'dispatch', (each) => each.card === 1 && each.role === 'engineer').map(({ attempt }) => attempt), [1, 2]);
  assert.deepEqual(stop.attemptFailures.map(({ class: classed, maker }) => [classed, maker]), [['environment', 'engineer'], ['environment', 'engineer']]);
  assert.deepEqual(failure.reached, []);
  assert.deepEqual(built.agent.runs().filter(({ card }) => card === 1), []);
});

// proves R-FAIL-2
test('a maker command that never starts records two L1 ends and a clean second workspace', SETTLES_WITHIN, async (t) => {
  const directory = scratch(t);
  const { repository } = clonedFromOrigin(directory);
  const bad = temporaryDirectory('rigger-bad-maker-');
  writeFileSync(join(bad, 'claude'), `#!${join(bad, 'absent-interpreter')}\n`, { mode: 0o755 });
  let handle;
  let calls = 0;
  let clean = false;
  const workspace = async (number) => {
    const made = await handle(number);
    calls += 1;
    if (calls === 1) writeFileSync(join(made.path, 'left-by-first-attempt'), 'old');
    else clean = !existsSync(join(made.path, 'left-by-first-attempt'));
    return made;
  };
  const built = judgeWorld({ cards: [cardIn(1, COLUMNS.ready)], workspace });
  handle = await workspaceHandle({ root: join(directory, 'worktrees'), topic: 'rigger-{number}', repository, sink: built.handed.sink });
  const engine = loop({ ...built.handed, environment: { ...process.env, PATH: bad } });

  const failure = await engine.pull(1).then(() => assert.fail('the stopped pull fulfilled'), (thrown) => thrown);
  const stop = stopOf(failure, 1);
  const maker = recorded(built, 'L3', 'dispatch', (each) => each.card === 1 && each.role === 'engineer');
  const ends = maker.map((each) => recorded(built, 'L1', 'dispatch.end', (end) => end.dispatch === each.dispatch)[0]);

  assert.equal(calls, 2);
  assert.equal(clean, true, 'the second workspace does not hold the first attempt\'s file');
  assert.deepEqual(maker.map(({ attempt }) => attempt), [1, 2]);
  assert.ok(ends.every((end) => end && end.exit === undefined && typeof end.reason === 'string'), JSON.stringify(ends));
  assert.deepEqual(stop.attemptFailures.map(({ code }) => code), [NOT_STARTED, NOT_STARTED]);
});

for (const kind of ['maker', 'workspace', 'step-not-started', 'step-exit']) {
  test(`run stops a ${kind} failure after two attempts while another maker frees a slot`, SETTLES_WITHIN, async () => {
    const { built, failure } = await runFailure(kind);
    const stop = stopOf(failure, 1);

    assert.equal(stop.attemptFailures.length, 2);
    assert.deepEqual(recorded(built, 'L2', 'attempt.failed', (each) => each.card === 1).map(({ attempt }) => attempt), [1, 2]);
    assert.deepEqual(recorded(built, 'L3', 'pull', (each) => each.card === 1).map(({ card }) => card), [1]);
    assert.equal(recorded(built, 'L3', 'slot.release', (each) => each.card === 1).length, 1);
    assert.equal((await columnsOf(built.fake))[1], COLUMNS.coding);
    assert.equal(built.agent.runs().filter(({ card }) => card === 2).length, 1);
  });
}

for (const kind of ['maker', 'workspace']) {
  test(`a later invocation pulls a card stopped for ${kind} again`, SETTLES_WITHIN, async () => {
    const { built, failure } = await runFailure(kind);
    stopOf(failure, 1);

    const later = await built.loop.pull(1).then(() => assert.fail('the later pull fulfilled'), (thrown) => thrown);

    assert.equal(stopOf(later, 1).attemptFailures.length, 2);
    assert.deepEqual(recorded(built, 'L3', 'pull', (each) => each.card === 1).map(({ card }) => card), [1, 1]);
  });
}

test('run withholds a failed judge only once while another maker frees a slot', SETTLES_WITHIN, async () => {
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer', 'owner'], provisioning: ['broken'] } };
  const provisioning = { broken: { run: 'exit 3', required: true, select: { labels: ['broken'] } } };
  const cards = [cardIn(1, COLUMNS.review, ['broken']), cardIn(2, COLUMNS.ready)];
  const built = judgeWorld({ cards, forge: { pullRequests: [pullFor(1)] }, kinds, provisioning, concurrency: 2 });
  built.agent.plan(2, 'engineer', { hold: true, exit: 0 });
  const board = built.handed.board;
  let reads = 0;
  const guarded = { ...board, readPriority: async () => {
    reads += 1;
    if (reads > 8) throw new Error('the base re-pulled the withheld judge repeatedly');
    return board.readPriority();
  } };
  const engine = loop({ ...built.handed, board: guarded });
  const result = engine.run().then((value) => ({ value }), (failure) => ({ failure }));
  await waitFor(() => built.agent.held(2, 'engineer'), 20_000);
  built.agent.release(2, 'engineer');
  const finished = await result;

  assert.equal(finished.failure, undefined, finished.failure?.stack);
  assert.deepEqual(recorded(built, 'L3', 'pull', (each) => each.card === 1).map(({ card }) => card), [1]);
  assert.equal(recorded(built, 'L2', 'judge.withheld', (each) => each.card === 1).length, 1);
  assert.equal(recorded(built, 'L3', 'dispatch', (each) => each.card === 1 && each.role === 'reviewer' && each.step === undefined).length, 0);
  assert.equal(built.agent.runs().filter(({ card, role }) => card === 2 && role === 'engineer').length, 1);
});
