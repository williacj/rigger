// ABOUTME: Tests environment retries and one-invocation admission after a maker or judge cannot start.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';

import config from '../rigger.config.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { WORKSPACE_NOT_MADE, workspaceHandle } from '../src/execution/workspace.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { cardIn, judgeWorld, pullFor, recorded } from './judge-world.mjs';
import { markerComment } from './fake-repository.mjs';
import { clonedFromOrigin } from './git-repository.mjs';
import { COLUMNS, KINDS, columnsOf, makingWorkspaces, readyCard, waitFor } from './loop-world.mjs';
import { scratch } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { chmodSync, symlinkSync } from 'node:fs';
import { setImmediate as oneTurn } from 'node:timers/promises';
import { roleDispatch } from '../src/execution/role.mjs';
import { admission } from '../src/scheduling/admission.mjs';
import { GIT_TIMEOUT } from '../src/substrate/worktrees.mjs';
import { repositoryAt } from './git-repository.mjs';
import { GIT, fixture, holding, withFirstOnPath } from './process-fixtures.mjs';

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
test('L2 retries a maker dispatch that never started and holds it after the second environment failure', () => {
  const directory = temporaryDirectory('rigger-environment-retry-');
  const sink = openSink({ directory, run: 'r-environment-retry', now: Date.now });
  const maker = { status: 'rejected', reason: Object.assign(new Error('the maker could not start'), { code: NOT_STARTED }) };
  const firstFailure = { class: 'environment', maker: 'engineer', status: 'rejected', code: NOT_STARTED, reason: 'the maker could not start' };
  const answer = (attempt) => nextAction(readyCard(7), KINDS, undefined, {
    columns: COLUMNS, roles: config.roles, provisioning: {}, sink, maker, attempt, firstFailure,
  });

  assert.deepEqual(answer(1), {
    action: 'again', card: 7, attempt: 2,
    failure: { class: 'environment', maker: 'engineer', status: 'rejected', code: NOT_STARTED, reason: 'the maker could not start' },
  });
  assert.deepEqual(answer(2), {
    action: 'hold', card: 7, firstFailure,
    failure: { class: 'environment', maker: 'engineer', status: 'rejected', code: NOT_STARTED, reason: 'the maker could not start' },
  });
  assert.deepEqual(readEvents(directory).filter(({ layer }) => layer === 'L2').map(({ event, attempt, decision, class: classed, maker: role }) => ({ event, attempt, decision, class: classed, maker: role })), [
    { event: 'attempt.failed', attempt: 1, decision: undefined, class: 'environment', maker: 'engineer' },
    { event: 'attempt.decided', attempt: 1, decision: 'again', class: undefined, maker: undefined },
    { event: 'attempt.failed', attempt: 2, decision: undefined, class: 'environment', maker: 'engineer' },
    { event: 'attempt.decided', attempt: 2, decision: 'hold', class: undefined, maker: undefined },
  ]);
});

// proves R-FAIL-7
test('L2 stops a card-local refusal on its first attempt and records its class', () => {
  const directory = temporaryDirectory('rigger-card-local-');
  const sink = openSink({ directory, run: 'r-card-local', now: Date.now });
  const path = join(directory, 'rigger-7');
  const workspace = { status: 'rejected', reason: Object.assign(new Error('R-WORK-13 R-WORK-14 refused the path'), { code: 'WORKSPACE_REFUSED', path }) };

  const answer = nextAction(readyCard(7), KINDS, undefined, {
    columns: COLUMNS, roles: config.roles, provisioning: {}, sink, workspace, attempt: 1,
  });

  assert.equal(answer.action, 'stop');
  assert.deepEqual(answer.failure, { class: 'card-local', workspace: path, code: 'WORKSPACE_REFUSED', reason: workspace.reason.message });
  assert.deepEqual(readEvents(directory).filter(({ layer }) => layer === 'L2').map(({ event, class: failureClass, decision }) => [event, failureClass, decision]), [
    ['attempt.failed', 'card-local', undefined], ['attempt.decided', undefined, 'stop'],
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
    firstFailure: { class: 'environment', maker: 'engineer', status: 'rejected', code: NOT_STARTED, reason: 'the maker could not start' },
  });

  assert.equal(answer(1).action, 'again');
  assert.equal(answer(2).action, 'hold');
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

// proves R-FAIL-2
test('a rejected maker settle does not record an attempt retry that L3 will not make', SETTLES_WITHIN, async () => {
  const built = failingWorld('maker', { other: false });
  const refusal = new Error('the second maker settle was refused');
  let settles = 0;
  const l2 = { ...built.handed.l2, settled: async (card, outcome) => {
    settles += 1;
    if (settles === 2) throw refusal;
    return built.handed.l2.settled(card, outcome);
  } };

  const [reached] = await loop({ ...built.handed, l2 }).pull(1);

  assert.equal(settles, 2);
  assert.equal(reached.outcome.status, 'rejected');
  assert.equal(reached.outcome.reason.code, NOT_STARTED);
  assert.equal(reached.settled.status, 'rejected');
  assert.equal(reached.settled.reason, refusal);
  assert.equal(built.made.length, 2);
  assert.deepEqual(recorded(built, 'L2', 'attempt.failed').map(({ attempt }) => attempt), [1]);
  assert.deepEqual(recorded(built, 'L2', 'attempt.decided').map(({ attempt, decision }) => [attempt, decision]), [[1, 'again']]);
});

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

// proves R-FAIL-7
test('L3 hands L2 the first workspace failure beside the second attempt', SETTLES_WITHIN, async () => {
  const built = failingWorld('workspace', { other: false });
  let first;
  let handed;
  const decide = (card, outcomes, options) => {
    if (options?.attempt === 2 && options.workspace !== undefined) handed = options.firstFailure;
    const answer = built.handed.decide(card, outcomes, options);
    if (answer.action === 'again') first = answer.failure;
    return answer;
  };

  await assert.rejects(loop({ ...built.handed, decide }).pull(1));

  assert.deepEqual(handed, first);
  assert.equal(handed.workspace, first.workspace);
});

// proves R-FAIL-7
test('L3 hands L2 the first workspace failure beside the second attempt of a run', SETTLES_WITHIN, async () => {
  const built = failingWorld('workspace', { other: false });
  let first;
  let handed;
  const decide = (card, outcomes, options) => {
    if (options?.attempt === 2 && options.workspace !== undefined) handed = options.firstFailure;
    const answer = built.handed.decide(card, outcomes, options);
    if (answer.action === 'again') first = answer.failure;
    return answer;
  };

  await assert.rejects(loop({ ...built.handed, decide }).run());

  assert.deepEqual(handed, first);
});

// proves R-FAIL-7
test('a continuing attempt whose workspace fetch fails twice answers hold at L1s current report', SETTLES_WITHIN, async () => {
  const card = cardIn(1, COLUMNS.review);
  const pull = pullFor(1);
  const fetched = [];
  const path = join(temporaryDirectory('rigger-fetch-retry-'), 'rigger-1');
  const marker = markerComment({ card: 1, pull: pull.number, head: pull.sha, body: card.body, role: 'reviewer', verdict: 'needs revision', items: ['unmet'], toSound: 'Fix the help line.' });
  const built = judgeWorld({
    cards: [card],
    forge: { pullRequests: [{ ...pull, comments: [marker] }] },
    kinds: { change: { ...KINDS.change, judges: ['reviewer'] } },
    workspace: async (number, head) => {
      fetched.push([number, head]);
      throw Object.assign(new Error('fetch failed before it answered'), { code: 'FETCH_FAILED', path });
    },
  });

  const failure = await built.loop.pull(1).then(() => assert.fail('the continuing pull fulfilled'), (thrown) => thrown);

  assert.equal(built.decisions[0].answer.action, 'continue');
  assert.equal(stopOf(failure, 1).decision, 'hold');
  assert.deepEqual(fetched, [[1, pull.sha], [1, pull.sha]]);
  assert.deepEqual(recorded(built, 'L2', 'attempt.failed').map(({ code }) => code), ['FETCH_FAILED', 'FETCH_FAILED']);
  assert.deepEqual(recorded(built, 'L2', 'attempt.decided').map(({ decision }) => decision), ['again', 'hold']);
  assert.deepEqual(recorded(built, 'L3', 'dispatch', (each) => each.role === 'engineer'), []);
});

// proves R-FAIL-7
test('run does not pull again a card stopped for each card-local refusal or an out branch or root', SETTLES_WITHIN, async (t) => {
  for (const code of ['WORKSPACE_REFUSED', 'BRANCH_ELSEWHERE', 'SCRATCH_REFUSED', 'BRANCH_REFUSED', 'ROOT_NOT_ABSOLUTE']) {
    await t.test(code, async () => {
      const built = failingWorld('workspace', { other: false });
      const making = makingWorkspaces(temporaryDirectory('rigger-stopped-run-'));
      const path = join(temporaryDirectory('rigger-stopped-path-'), 'rigger-1');
      const workspace = async (number) => {
        if (code === 'SCRATCH_REFUSED') {
          const made = await making(number);
          mkdirSync(made.scratch, { recursive: true });
          writeFileSync(join(made.scratch, 'engineer'), 'kept\n');
          return made;
        }
        throw Object.assign(new Error(`${code} at ${path}`), { code, path });
      };

      const failure = await loop({ ...built.handed, workspace }).run().then(() => assert.fail('run succeeded'), (thrown) => thrown);

      const stopped = stopOf(failure, 1);
      assert.equal(stopped.attemptFailures.length, 1);
      assert.equal(stopped.attemptFailures[0].code, code);
      assert.deepEqual(recorded(built, 'L2', 'attempt.decided').map(({ decision }) => decision), ['stop']);
      assert.deepEqual(recorded(built, 'L2', 'attempt.failed').map(({ class: named }) => named), [code === 'BRANCH_REFUSED' || code === 'ROOT_NOT_ABSOLUTE' ? 'out' : 'card-local']);
    });
  }
});

// proves R-FAIL-7
test('run stops one card-local refusal while another card is held for two workspace host failures', SETTLES_WITHIN, async () => {
  const built = failingWorld('workspace');
  const path = join(temporaryDirectory('rigger-card-local-beside-host-'), 'rigger-1');
  const workspace = async (number) => {
    if (number === 1) throw Object.assign(new Error('R-WORK-13 refused'), { code: 'WORKSPACE_REFUSED', path });
    throw Object.assign(new Error('the host disk gave no answer'), { code: WORKSPACE_NOT_MADE, path: join(dirname(path), 'rigger-2') });
  };

  const failure = await loop({ ...built.handed, workspace }).run().then(() => assert.fail('run succeeded'), (thrown) => thrown);

  assert.equal(stopOf(failure, 1).attemptFailures.length, 1);
  assert.equal(stopOf(failure, 2).decision, 'hold');
  assert.deepEqual(recorded(built, 'L2', 'attempt.decided', (each) => each.card === 1).map(({ decision }) => decision), ['stop']);
  assert.deepEqual(recorded(built, 'L2', 'attempt.decided', (each) => each.card === 2).map(({ decision }) => decision), ['again', 'hold']);
});

// proves R-FAIL-7
test('a judge scratch refusal remains NOT_STARTED and causes no card stop', SETTLES_WITHIN, async () => {
  let built;
  const judgeDirectory = async (card, role, head) => {
    const made = await built.handed.judgeDirectory(card, role, head);
    mkdirSync(made.scratch, { recursive: true });
    writeFileSync(join(made.scratch, role), 'kept\n');
    return made;
  };
  built = judgeWorld({ cards: [cardIn(7, COLUMNS.review)], forge: { pullRequests: [pullFor(7)] },
    kinds: { change: { ...KINDS.change, judges: ['reviewer'] } } });
  const engine = loop({ ...built.handed, judgeDirectory });

  const [reached] = await engine.pull(1);

  assert.equal(reached.judges[0].outcome.reason.code, NOT_STARTED);
  assert.equal(recorded(built, 'L2', 'attempt.decided', (each) => each.card === 7).length, 0);
  assert.equal(readFileSync(join(built.scratch, 'workspaces', 'scratch', 'rigger-7', 'reviewer'), 'utf8'), 'kept\n');
});

// proves R-FAIL-7
test('two once invocations over the same board and state count the held card afresh', SETTLES_WITHIN, async () => {
  const built = failingWorld('workspace', { other: false });
  const first = await built.loop.pull(1).then(() => assert.fail('the first pull fulfilled'), (failure) => failure);
  const second = await built.loop.pull(1).then(() => assert.fail('the second pull fulfilled'), (failure) => failure);

  assert.equal(stopOf(first, 1).decision, 'hold');
  assert.equal(stopOf(second, 1).decision, 'hold');
  assert.deepEqual(recorded(built, 'L2', 'attempt.decided').map(({ attempt, decision }) => [attempt, decision]), [[1, 'again'], [2, 'hold'], [1, 'again'], [2, 'hold']]);
});

// proves R-FAIL-7
test('a held Ready card stays in Coding with only its claim move', SETTLES_WITHIN, async () => {
  const built = failingWorld('workspace', { other: false });
  await assert.rejects(built.loop.pull(1));

  assert.deepEqual(built.fake.writes().filter(({ operation }) => operation === 'moveItem').map(({ args: [, column] }) => column), [COLUMNS.coding]);
  assert.deepEqual(await columnsOf(built.fake), { 1: COLUMNS.coding });
});

// proves R-FAIL-4
test('a held card records no escalation and writes no comment on its issue', SETTLES_WITHIN, async () => {
  const path = join(temporaryDirectory('rigger-hold-issue-'), 'rigger-1');
  const built = judgeWorld({
    cards: [cardIn(1, COLUMNS.ready)], forge: { issues: [{ number: 1, comments: [] }] },
    workspace: async () => { throw Object.assign(new Error('git gave no answer'), { code: WORKSPACE_NOT_MADE, path }); },
  });
  await assert.rejects(built.loop.pull(1));

  assert.deepEqual(recorded(built, 'L2', 'review.escalate'), []);
  assert.deepEqual(built.repository.held().issues[0].comments, []);
});

// proves R-FAIL-7
test('a held card writes nothing under admission state', SETTLES_WITHIN, async () => {
  const built = failingWorld('workspace', { other: false });
  await assert.rejects(built.loop.pull(1));
  assert.equal(existsSync(join(built.directory, 'admission')), false);
});

// proves R-FAIL-7
test('two cards that each fail once in the same host way each get another attempt and neither is held', SETTLES_WITHIN, async () => {
  const root = temporaryDirectory('rigger-two-retries-');
  const making = makingWorkspaces(root);
  const attempts = new Map();
  const workspace = async (number) => {
    const count = (attempts.get(number) ?? 0) + 1;
    attempts.set(number, count);
    if (count === 1) throw Object.assign(new Error('git gave no answer'), { code: WORKSPACE_NOT_MADE, path: join(root, `rigger-${number}`) });
    return making(number);
  };
  const kinds = { change: { ...KINDS.change, judges: ['owner'] } };
  const built = judgeWorld({ cards: [cardIn(1, COLUMNS.ready), cardIn(2, COLUMNS.ready)], kinds, concurrency: 2, workspace });

  const reached = await built.loop.pull(2);

  assert.deepEqual(reached.map(({ card }) => card).sort(), [1, 2]);
  assert.deepEqual([...attempts], [[1, 2], [2, 2]]);
  assert.deepEqual(recorded(built, 'L2', 'attempt.decided').map(({ card, attempt, decision }) => [card, attempt, decision]).sort(), [[1, 1, 'again'], [2, 1, 'again']]);
  assert.equal(built.decisions.some(({ answer }) => answer.action === 'hold'), false);
});

// proves R-FAIL-7
test('a card still holds for two matching host failures beside a card whose maker succeeds', SETTLES_WITHIN, async () => {
  const { built, failure } = await runFailure('workspace');

  assert.equal(stopOf(failure, 1).decision, 'hold');
  assert.ok(built.repository.pull(1002), 'card 2 opened its pull request after a successful maker');
  assert.deepEqual(recorded(built, 'L2', 'attempt.decided', (each) => each.card === 1).map(({ decision }) => decision), ['again', 'hold']);
});

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
  test(`run holds a ${kind} failure after two attempts while another maker frees a slot`, SETTLES_WITHIN, async () => {
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
  test(`a later invocation pulls a card held for ${kind} again`, SETTLES_WITHIN, async () => {
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

/** A judge's role answer as L2 gives one, carrying the facts that make it a judge's, naming the stand-in provider. */
const JUDGE = {
  role: 'reviewer', agent: '.claude/agents/reviewer.md', provider: 'stand-in', tier: 'high', timeout: 60_000,
  instruction: 'Judge card #7.\n', evidence: 'Card #7: the acceptance.\n', digest: 'd', facts: { card: 7, head: 'h' },
};

/** A provider adapter that answers `/usr/bin/true` for every role. */
const ANSWERING = { 'stand-in': { async invocation() { return { command: '/usr/bin/true', args: [], input: Buffer.from(''), unset: [], env: {} }; } } };

/**
 * A judge's layout in the test's own temporary directory: the judge's directory `judge/` with its
 * `main/`, a repository L1 made from at `repository/`, a sink over `.rigger/`, and the card's
 * scratch base `scratch/rigger-7/`, which is not made.
 */
function layout(t) {
  const root = scratch(t);
  const directory = join(root, 'judge');
  mkdirSync(join(directory, 'main'), { recursive: true });
  const repository = repositoryAt(join(root, 'repository'));
  const sink = openSink({ directory: join(root, '.rigger'), run: 'r-judge-scratch', now: () => 0 });
  return { root, directory, base: join(root, 'scratch', 'rigger-7'), repository, sink };
}

/** What L1's role dispatch of the judge in `placed`, over scratch base `base`, rejected with, or nothing where it answered. */
const rejection = (placed, { base = placed.base, adapters = ANSWERING } = {}) => roleDispatch({
  answer: JUDGE, cwd: join(placed.directory, 'main'), directory: placed.directory, scratch: base, repository: placed.repository, reach: [], env: {}, sink: placed.sink, id: 'd-judge', card: 7, adapters,
}).then(() => undefined, (failure) => failure);

/** Makes `<base>/<role>` a directory whose contents the file system will not list, putting its mode back once `t` ends. */
function unlisted(t, base, role) {
  const path = join(base, role);
  mkdirSync(path, { recursive: true });
  chmodSync(path, 0o000);
  t.after(() => chmodSync(path, 0o700));
  return path;
}

// proves R-FAIL-7
test('L1 reports a judge\'s scratch directory not made, whose contents the file system would not list, as a dispatch that did not start naming that directory as missing', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  const path = unlisted(t, placed.base, 'reviewer');

  const failure = await rejection(placed);

  assert.equal(failure?.code, NOT_STARTED, failure?.stack);
  assert.equal(failure.missing, path);
  assert.ok(failure.message.includes(path), failure.message);
});

// proves R-FAIL-7
test('L1 reports neither a judge\'s scratch directory refused under R-WORK-26 nor an invocation its adapter rejected as a judge\'s scratch directory not made', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  mkdirSync(placed.base, { recursive: true });
  writeFileSync(join(placed.base, 'reviewer'), 'kept\n');
  const refused = await rejection(placed);
  const other = await rejection(placed, { base: join(placed.root, 'other', 'rigger-7'), adapters: { 'stand-in': { async invocation() { throw new Error('the adapter refuses this invocation'); } } } });

  assert.equal(refused?.code, NOT_STARTED, refused?.stack);
  assert.ok(refused.message.includes('R-WORK-26'), refused.message);
  assert.equal(other?.code, NOT_STARTED, other?.stack);
  assert.ok(other.message.includes('the adapter refuses this invocation'), other.message);
  assert.ok(existsSync(join(placed.root, 'other', 'rigger-7', 'reviewer')), 'L1 made the scratch directory before the adapter rejected');
  assert.deepEqual([Object.hasOwn(refused, 'missing'), Object.hasOwn(other, 'missing')], [false, false]);
});

/** The kind every card of the loop's world is selected by, judged by `judges` alone. */
const kindJudgedBy = (judges) => ({ change: { select: { labels: ['type:change'] }, maker: 'engineer', judges } });

/**
 * A world holding card 7 in Review with its one open pull request, judged by `judges` under
 * `roles`, whose judge directories are made as the harness makes them, after which `spoil(made,
 * role)` runs on each before L3 dispatches its judge, answering the scratch base L3 is handed, or
 * nothing for the one made. `invocation()` answers a fresh loop over the world, as a new
 * invocation of the verb starts one, whose board refuses its ninth read of priorities, so a run
 * that pulls the card again at once ends rather than pulling it for ever. `handed` records what
 * each of L3's asks of L2 handed it as `directories` through the `decide` L3 is handed, which it
 * asks after a maker's attempt; with `ready`, card 7 starts in Ready, with no pull request until its
 * maker exits 0, so its judges are asked through it.
 */
function spoiledWorld({ judges = ['reviewer'], spoil = () => undefined, roles, ready = false } = {}) {
  let built;
  const handed = [];
  const judgeDirectory = async (card, role, head) => {
    const made = await built.handed.judgeDirectory(card, role, head);
    return { ...made, scratch: (await spoil(made, role)) ?? made.scratch };
  };
  built = judgeWorld({ cards: [cardIn(7, ready ? COLUMNS.ready : COLUMNS.review)], forge: ready ? {} : { pullRequests: [pullFor(7)] }, kinds: kindJudgedBy(judges), ...(roles === undefined ? {} : { roles }) });
  const decide = (card, outcomes, options) => {
    if (options?.directories !== undefined) handed.push(options.directories);
    return built.handed.decide(card, outcomes, options);
  };
  const invocation = () => {
    const { board } = built.handed;
    let reads = 0;
    const guarded = { ...board, readPriority: async () => {
      reads += 1;
      if (reads > 8) throw new Error('the run pulled card 7 again and again');
      return board.readPriority();
    } };
    return loop({ ...built.handed, board: guarded, decide, judgeDirectory });
  };
  return { built, handed, invocation };
}

/** What a run of `engine` rejected with, or nothing where it fulfilled. */
const ran = (engine) => engine.run().then(() => undefined, (failure) => failure);

/** The `judge.withheld` events of card 7 in `built`, each as its role, its scratch directory and its class. */
const withheldOf = (built) => recorded(built, 'L2', 'judge.withheld', (each) => each.card === 7)
  .map(({ role, scratch: missing, class: classed }) => ({ role, missing, classed }));

/**
 * Asserts that `failure`, the run's, is none, that the run over `built` withheld card 7's
 * `reviewer` once for its scratch directory `path`, naming it and the cause, started no dispatch of
 * it, and pulled the card once.
 */
function withheldOnce(built, failure, path) {
  const withheld = recorded(built, 'L2', 'judge.withheld', (each) => each.card === 7);
  assert.deepEqual(withheldOf(built), [{ role: 'reviewer', missing: path, classed: 'environment' }], JSON.stringify(withheld));
  assert.ok(withheld[0].reason.includes(path), withheld[0].reason);
  assert.equal(recorded(built, 'L1', 'dispatch.start', (each) => each.card === 7).length, 0);
  assert.equal(recorded(built, 'L3', 'pull', (each) => each.card === 7).length, 1);
  assert.equal(failure, undefined, failure?.stack);
}

// proves R-FAIL-7
test('run withholds a judge whose scratch directory was not made because the file system would not list it, and pulls its card no more in that invocation', SETTLES_WITHIN, async (t) => {
  let path;
  const world = spoiledWorld({ spoil: (made, role) => { path = unlisted(t, made.scratch, role); } });

  const failure = await ran(world.invocation());

  withheldOnce(world.built, failure, path);
});

// proves R-FAIL-7
test('run withholds a judge whose scratch directory was not made because the file system answered EACCES on its scratch base', SETTLES_WITHIN, async (t) => {
  let path;
  const world = spoiledWorld({ spoil: (made, role) => {
    mkdirSync(made.scratch, { recursive: true });
    chmodSync(made.scratch, 0o000);
    t.after(() => chmodSync(made.scratch, 0o700));
    path = join(made.scratch, role);
  } });

  const failure = await ran(world.invocation());

  withheldOnce(world.built, failure, path);
  assert.ok(recorded(world.built, 'L2', 'judge.withheld')[0].reason.includes('EACCES'));
});

// proves R-FAIL-7
test('run withholds a judge whose scratch directory was not made because the file system answered an error to its mkdir', SETTLES_WITHIN, async (t) => {
  let path;
  const world = spoiledWorld({ spoil: (made, role) => {
    const above = join(made.path, 'read-only');
    mkdirSync(above);
    chmodSync(above, 0o500);
    t.after(() => chmodSync(above, 0o700));
    path = join(above, 'rigger-7', role);
    return join(above, 'rigger-7');
  } });

  const failure = await ran(world.invocation());

  withheldOnce(world.built, failure, path);
  assert.ok(recorded(world.built, 'L2', 'judge.withheld')[0].reason.includes('mkdir'));
});

// proves R-FAIL-7
test('run withholds a judge whose scratch directory was not made because its scratch base lies on a path the file system cannot resolve', SETTLES_WITHIN, async () => {
  let path;
  const world = spoiledWorld({ spoil: (made, role) => {
    const loopAt = join(made.path, 'loop');
    symlinkSync(loopAt, loopAt);
    path = join(loopAt, 'rigger-7', role);
    return join(loopAt, 'rigger-7');
  } });

  const failure = await ran(world.invocation());

  withheldOnce(world.built, failure, path);
  assert.ok(recorded(world.built, 'L2', 'judge.withheld')[0].reason.includes('ELOOP'));
});

// proves R-FAIL-7
test('run withholds a judge whose scratch directory was not made because git\'s worktree listing for the R-WORK-29 check ran past its time', SETTLES_WITHIN, async (t) => {
  const stand = holding(t);
  fixture(stand, 'git', [
    'if [ "$1" = worktree ] && [ "$2" = list ]; then : > "$here/listing"; exec /usr/bin/tail -f "$here/hold"; fi',
    `exec '${GIT}' "$@"`,
  ].join('\n'));
  let path;
  const world = spoiledWorld({ spoil: (made, role) => { path = join(made.scratch, role); } });
  const engine = world.invocation();

  const failure = await withFirstOnPath(stand, async () => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let settled = false;
    const running = ran(engine).then((value) => { settled = true; return value; });
    while (!existsSync(join(stand, 'listing'))) await oneTurn();
    t.mock.timers.tick(GIT_TIMEOUT);
    while (!settled) {
      t.mock.timers.tick(50);
      await oneTurn();
    }
    return running;
  });

  withheldOnce(world.built, failure, path);
  assert.ok(recorded(world.built, 'L2', 'judge.withheld')[0].reason.includes(`ran past its timeout of ${GIT_TIMEOUT} ms`));
});

// proves R-FAIL-7
test('run dispatches a judge whose scratch directory was made, as it did before a judge\'s scratch directory not made was withheld', SETTLES_WITHIN, async () => {
  const world = spoiledWorld();

  const failure = await ran(world.invocation());

  assert.equal(failure, undefined, failure?.stack);
  assert.deepEqual(withheldOf(world.built), []);
  const starts = recorded(world.built, 'L1', 'dispatch.start', (each) => each.card === 7);
  assert.equal(starts.length, 1);
  assert.equal(recorded(world.built, 'L1', 'dispatch.end', (each) => each.dispatch === starts[0].dispatch)[0]?.exit, 0);
});

// proves R-FAIL-7
test('of two judges, run withholds the one whose scratch directory was not made and keeps the other\'s verdict', SETTLES_WITHIN, async (t) => {
  let path;
  const world = spoiledWorld({ judges: ['reviewer', 'architect'], spoil: (made, role) => {
    if (role === 'reviewer') path = unlisted(t, made.scratch, role);
  } });

  const failure = await ran(world.invocation());

  assert.equal(failure, undefined, failure?.stack);
  assert.deepEqual(withheldOf(world.built), [{ role: 'reviewer', missing: path, classed: 'environment' }]);
  const [architect] = recorded(world.built, 'L3', 'dispatch', (each) => each.card === 7 && each.role === 'architect');
  assert.equal(recorded(world.built, 'L1', 'dispatch.end', (each) => each.dispatch === architect?.dispatch)[0]?.exit, 0);
  const markers = world.built.repository.held().pullRequests.find(({ number }) => number === 1007).comments.map(({ body }) => body);
  assert.equal(markers.filter((body) => body.includes('Sound, by architect')).length, 1, JSON.stringify(markers));
  assert.equal(recorded(world.built, 'L3', 'pull', (each) => each.card === 7).length, 1);
});

// proves R-FAIL-7
test('L3 carries a judge withheld because its scratch directory was not made among none of the judges it dispatched, as it carries one withheld for its directory', SETTLES_WITHIN, async (t) => {
  const world = spoiledWorld({ judges: ['reviewer', 'architect'], spoil: (made, role) => {
    if (role === 'reviewer') unlisted(t, made.scratch, role);
  } });

  const [reached] = await world.invocation().pull(1);

  assert.deepEqual(reached.judges.map(({ role, outcome }) => [role, outcome?.status, outcome?.value?.exit]), [['architect', 'fulfilled', 0]], JSON.stringify(reached.judges));
});

// proves R-FAIL-7
test('L2 is handed a judge\'s scratch directory not made apart from one refused under R-WORK-26 and one whose dispatch never started for another cause, and withholds only the first', SETTLES_WITHIN, async (t) => {
  let path;
  const roles = { ...config.roles, pm: { ...config.roles.pm, agent: '../outside/pm.md' } };
  const world = spoiledWorld({ judges: ['reviewer', 'architect', 'pm'], roles, ready: true, spoil: (made, role) => {
    if (role === 'reviewer') path = unlisted(t, made.scratch, role);
    if (role === 'architect') {
      mkdirSync(made.scratch, { recursive: true });
      writeFileSync(join(made.scratch, role), 'kept\n');
    }
  } });

  await ran(world.invocation());

  const reports = Object.assign({}, ...world.handed);
  assert.deepEqual(Object.keys(reports).sort(), ['architect', 'pm', 'reviewer']);
  assert.deepEqual(Object.fromEntries(Object.entries(reports).map(([role, { reason }]) => [role, [reason.code, reason.missing]])), {
    reviewer: [NOT_STARTED, path], architect: [NOT_STARTED, undefined], pm: [NOT_STARTED, undefined],
  });
  assert.deepEqual(withheldOf(world.built), [{ role: 'reviewer', missing: path, classed: 'environment' }]);
});

// proves R-FAIL-7
test('a judge whose adapter rejects its invocation is not withheld as a judge whose scratch directory was not made, since its scratch directory was made, and its outcome is a dispatch that did not start', SETTLES_WITHIN, async () => {
  const roles = { ...config.roles, reviewer: { ...config.roles.reviewer, agent: '../outside/reviewer.md' } };
  let path;
  const world = spoiledWorld({ roles, spoil: (made, role) => { path = join(made.scratch, role); } });

  const [reached] = await world.invocation().pull(1);

  assert.equal(reached.judges.length, 1, JSON.stringify(reached.judges));
  assert.equal(reached.judges[0].role, 'reviewer');
  assert.equal(reached.judges[0].outcome?.reason?.code, NOT_STARTED);
  assert.ok(reached.judges[0].outcome.reason.message.includes('R-SAFE-6'), reached.judges[0].outcome.reason.message);
  assert.ok(existsSync(path), 'L1 made the judge\'s scratch directory');
  assert.deepEqual(withheldOf(world.built), []);
});

// proves R-FAIL-7
test('a judge\'s scratch directory refused under R-WORK-26 is not withheld as a judge\'s scratch directory not made, and its outcome is a dispatch that did not start', SETTLES_WITHIN, async () => {
  const world = spoiledWorld({ spoil: (made, role) => {
    mkdirSync(made.scratch, { recursive: true });
    writeFileSync(join(made.scratch, role), 'kept\n');
  } });

  const [reached] = await world.invocation().pull(1);

  assert.equal(reached.judges[0].outcome?.reason?.code, NOT_STARTED, JSON.stringify(reached.judges));
  assert.ok(reached.judges[0].outcome.reason.message.includes('R-WORK-26'), reached.judges[0].outcome.reason.message);
  assert.deepEqual(withheldOf(world.built), []);
});

// proves R-FAIL-7
test('for a judge withheld because its scratch directory was not made, L2 answers neither again nor hold', SETTLES_WITHIN, async (t) => {
  const world = spoiledWorld({ spoil: (made, role) => { unlisted(t, made.scratch, role); } });

  await ran(world.invocation());

  assert.equal(withheldOf(world.built).length, 1);
  const actions = world.built.decisions.filter(({ card }) => card === 7).map(({ answer }) => answer.action);
  assert.deepEqual(actions.filter((action) => action === 'again' || action === 'hold'), [], JSON.stringify(actions));
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided', (each) => each.card === 7), []);
});

// proves R-FAIL-7
test('after an invocation withholding a judge whose scratch directory was not made, admission stays open', SETTLES_WITHIN, async (t) => {
  const world = spoiledWorld({ spoil: (made, role) => { unlisted(t, made.scratch, role); } });

  await ran(world.invocation());

  assert.equal(withheldOf(world.built).length, 1);
  const state = admission({ directory: world.built.directory, sink: { emitter: () => ({ emit: () => {} }) } }).read();
  assert.deepEqual(state, { state: 'open' });
});

// proves R-FAIL-7
test('the invocation after one that withheld a judge whose scratch directory was not made dispatches that judge again', SETTLES_WITHIN, async (t) => {
  let spoiling = true;
  const world = spoiledWorld({ spoil: (made, role) => {
    if (spoiling) unlisted(t, made.scratch, role);
  } });
  await ran(world.invocation());
  assert.equal(withheldOf(world.built).length, 1);
  chmodSync(withheldOf(world.built)[0].missing, 0o700);
  spoiling = false;

  const failure = await ran(world.invocation());

  assert.equal(failure, undefined, failure?.stack);
  assert.equal(recorded(world.built, 'L3', 'pull', (each) => each.card === 7).length, 2);
  const starts = recorded(world.built, 'L1', 'dispatch.start', (each) => each.card === 7);
  assert.equal(starts.length, 1);
  assert.equal(recorded(world.built, 'L1', 'dispatch.end', (each) => each.dispatch === starts[0].dispatch)[0]?.exit, 0);
});
