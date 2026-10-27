// ABOUTME: Tests environment retries and one-invocation admission after a maker or judge cannot start.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync, readFileSync } from 'node:fs';
import { namesIn, removeClosers } from './admission-world.mjs';
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
import { ownerWrites } from './card-local-world.mjs';
import { makeJudgeDirectory } from '../src/execution/workspace.mjs';
import { GIT, fixture, holding, withFirstOnPath } from './process-fixtures.mjs';
import { answer as judgeStartAnswer } from './judge-start-fixture.mjs';
import { realpathSync, renameSync } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { ADAPTERS } from '../src/substrate/providers/adapters.mjs';
import { standInCodex } from './stub-claude.mjs';
import { refuseSpawn } from './judge-start-fixture.mjs';
import { dispatch as judgeDispatchOnL1 } from '../src/execution/run.mjs';

const { 60_000: SETTLES_WITHIN } = BOUNDS;

// The counterexample throws away L2's escalation answer or records its move from Ready.
// proves R-ESCALATE-12
test('a card-local workspace refusal escalates under its claim and records its move from Coding', SETTLES_WITHIN, async () => {
  const path = join(temporaryDirectory('rigger-card-local-attempt-'), 'rigger-7');
  const reason = `R-WORK-13 refuses ${path}\nowner's [file] remains`;
  let attempts = 0;
  const built = ownerWrites(judgeWorld({ cards: [cardIn(7, COLUMNS.ready)], workspace: async () => {
    attempts += 1;
    throw Object.assign(new Error(reason), { code: 'WORKSPACE_REFUSED', path });
  } }));

  const [reached] = await built.loop.pull(1);

  assert.equal(reached.action, 'escalate');
  assert.equal(attempts, 1);
  assert.deepEqual(await columnsOf(built.fake), { 7: COLUMNS.owner });
  assert.deepEqual(built.owner.held().issues[0].labels, ['type:change', 'rigger:escalated']);
  assert.equal(built.owner.held().issues[0].comments.length, 1);
  assert.ok(built.owner.held().issues[0].comments[0].body.includes(reason));
  assert.deepEqual(recorded(built, 'L2', 'transition').map(({ from, to }) => [from, to]), [['ready', 'coding'], ['coding', 'owner']]);
  assert.equal(recorded(built, 'L3', 'slot.release').length, 1);
});

/** A refused reviewer and a held architect, with the real loop, transitions and stand-in provider. */
function refusedPanel({ ready = false, scratchRefusal = false, other = 'verdict', refuseWrite } = {}) {
  const built = ownerWrites(judgeWorld({ cards: [cardIn(7, ready ? COLUMNS.ready : COLUMNS.review)],
    forge: ready ? {} : { pullRequests: [pullFor(7)] },
    kinds: { change: { ...KINDS.change, judges: ['reviewer', 'architect'] } },
    refuse: ({ layer, event, fields }) => other === 'no outcome' && layer === 'L3' && event === 'dispatch' && fields.role === 'architect',
  }), { refuse: refuseWrite });
  const reports = {};
  const judgeDirectory = async (card, role, head) => {
    if (role === 'reviewer' || other === 'both refused') {
      if (!scratchRefusal) {
        const reason = Object.assign(new Error(`R-WORK-20 refuses ${role}'s directory`), { code: 'WORKSPACE_REFUSED', path: join(built.scratch, role) });
        reports[role] = reason.message;
        throw reason;
      }
      const made = await built.handed.judgeDirectory(card, role, head);
      mkdirSync(made.scratch, { recursive: true });
      writeFileSync(join(made.scratch, role), `${role}'s preserved file\n`);
      return made;
    }
    if (other === 'host withheld') throw Object.assign(new Error('EACCES reading architect directory'), { code: WORKSPACE_NOT_MADE, path: join(built.scratch, role) });
    return built.handed.judgeDirectory(card, role, head);
  };
  const decide = (card, outcomes, options) => {
    for (const [role, report] of Object.entries(options?.directories ?? {})) reports[role] = report.reason.message;
    return built.handed.decide(card, outcomes, options);
  };
  const engine = loop({ ...built.handed, decide, judgeDirectory });
  return { built, engine, reports };
}

// The counterexample escalates as soon as one judge is refused, dropping its peer's verdict.
// proves R-ESCALATE-12
test('a refused judge waits for the other judge and keeps its verdict before one owner escalation', SETTLES_WITHIN, async () => {
  const { built, engine, reports } = refusedPanel();
  built.agent.plan(7, 'architect', { hold: true, exit: 0 });
  const running = engine.pull(1).then((reached) => ({ reached }), (failure) => ({ failure }));
  await waitFor(() => built.agent.held(7, 'architect'), 20_000);
  assert.equal(built.owner.held().issues[0].comments.length, 0, 'the owner write waits for the running judge');
  built.agent.release(7, 'architect');
  const { reached, failure } = await running;

  assert.equal(failure, undefined, failure?.stack);
  assert.equal(built.owner.held().issues[0].comments.length, 1, 'exactly one owner escalation');
  assert.ok(built.owner.held().issues[0].comments[0].body.includes(reports.reviewer));
  assert.deepEqual(reached[0].judges.map(({ role }) => role), ['reviewer', 'architect']);
  assert.equal(reached[0].judges[1].outcome.value.exit, 0);
  assert.ok(built.repository.pull(1007).comments.some(({ body }) => body.includes('Sound, by architect')));
  assert.deepEqual(await columnsOf(built.fake), { 7: COLUMNS.owner });
});

// The counterexample reports a real refused scratch path as NOT_STARTED, so neither refusal escalates.
// proves R-ESCALATE-12
test('two real judge scratch refusals stay distinct from not made and produce one escalation naming both', SETTLES_WITHIN, async () => {
  const { built, engine } = refusedPanel({ scratchRefusal: true, other: 'both refused' });
  const [reached] = await engine.pull(1);
  assert.equal(built.owner.held().issues[0].comments.length, 1);
  const comment = built.owner.held().issues[0].comments[0].body;
  assert.deepEqual(reached.judges.map(({ outcome }) => outcome.reason.code), ['SCRATCH_REFUSED', 'SCRATCH_REFUSED']);
  for (const role of ['reviewer', 'architect']) {
    assert.ok(comment.includes(reached.judges.find((judge) => judge.role === role).outcome.reason.message), comment);
    assert.equal(readFileSync(join(built.scratch, 'workspaces', 'scratch', 'rigger-7', role), 'utf8'), `${role}'s preserved file\n`);
  }
  assert.deepEqual(recorded(built, 'L2', 'judge.withheld'), []);
  assert.deepEqual(recorded(built, 'L1', 'dispatch.start'), []);
});

// The counterexample loses the answered replace-rule refusal in WORKSPACE_NOT_MADE.
// proves R-ESCALATE-12
test('a real judge directory refused as a file is reported apart from not made and escalates without changing it', SETTLES_WITHIN, async () => {
  const built = ownerWrites(judgeWorld({ cards: [cardIn(7, COLUMNS.review)], forge: { pullRequests: [pullFor(7)] } }));
  const root = join(built.scratch, 'refused');
  const repository = repositoryAt(join(built.scratch, 'repository'), { README: 'fixture\n' });
  const path = join(root, 'judges', 'rigger-7', 'reviewer');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'owner file\n');
  const judgeDirectory = (card, role, head) => role === 'reviewer'
    ? makeJudgeDirectory({ root, topic: 'rigger-{number}', card, role, head, repository, sink: built.handed.sink })
    : built.handed.judgeDirectory(card, role, head);

  const [reached] = await loop({ ...built.handed, judgeDirectory }).pull(1);

  assert.equal(built.owner.held().issues[0].comments.length, 1);
  const refused = reached.judges.find(({ role }) => role === 'reviewer').outcome.reason;
  assert.equal(refused.code, 'WORKSPACE_REFUSED');
  assert.ok(built.owner.held().issues[0].comments[0].body.includes(refused.message));
  assert.equal(readFileSync(path, 'utf8'), 'owner file\n');
  assert.deepEqual(recorded(built, 'L2', 'judge.withheld'), []);
});

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

// proves R-FAIL-8
test('L2 escalates a card-local refusal on its first attempt and records its class', () => {
  const directory = temporaryDirectory('rigger-card-local-');
  const sink = openSink({ directory, run: 'r-card-local', now: Date.now });
  const path = join(directory, 'rigger-7');
  const workspace = { status: 'rejected', reason: Object.assign(new Error('R-WORK-13 R-WORK-14 refused the path'), { code: 'WORKSPACE_REFUSED', path }) };

  const answer = nextAction(readyCard(7), KINDS, undefined, {
    columns: COLUMNS, roles: config.roles, provisioning: {}, sink, workspace, attempt: 1,
  });

  assert.equal(answer.action, 'escalate');
  assert.deepEqual(answer.failure, { class: 'card-local', workspace: path, code: 'WORKSPACE_REFUSED', reason: workspace.reason.message });
  assert.deepEqual(readEvents(directory).filter(({ layer }) => layer === 'L2').map(({ event, class: failureClass, decision }) => [event, failureClass, decision]), [
    ['attempt.failed', 'card-local', undefined], ['attempt.decided', undefined, 'escalate'],
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
  ownerWrites(built);
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

// proves R-FAIL-8
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

// proves R-FAIL-8
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

// proves R-FAIL-8
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

// proves R-FAIL-8
test('run does not pull again a card escalated for each card-local refusal or stopped for an out branch or root', SETTLES_WITHIN, async (t) => {
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

      const failure = await loop({ ...built.handed, workspace }).run().then(() => undefined, (thrown) => thrown);

      const out = code === 'BRANCH_REFUSED' || code === 'ROOT_NOT_ABSOLUTE';
      const stopped = out ? stopOf(failure, 1) : { attemptFailures: recorded(built, 'L2', 'attempt.failed') };
      assert.equal(stopped.attemptFailures.length, 1);
      assert.equal(stopped.attemptFailures[0].code, code);
      assert.deepEqual(recorded(built, 'L2', 'attempt.decided').map(({ decision }) => decision), [out ? 'stop' : 'escalate']);
      assert.deepEqual(recorded(built, 'L2', 'attempt.failed').map(({ class: named }) => named), [code === 'BRANCH_REFUSED' || code === 'ROOT_NOT_ABSOLUTE' ? 'out' : 'card-local']);
    });
  }
});

// proves R-FAIL-8
test('run escalates one card-local refusal while another card is held for two workspace host failures', SETTLES_WITHIN, async () => {
  const built = failingWorld('workspace');
  const path = join(temporaryDirectory('rigger-card-local-beside-host-'), 'rigger-1');
  const workspace = async (number) => {
    if (number === 1) throw Object.assign(new Error('R-WORK-13 refused'), { code: 'WORKSPACE_REFUSED', path });
    throw Object.assign(new Error('the host disk gave no answer'), { code: WORKSPACE_NOT_MADE, path: join(dirname(path), 'rigger-2') });
  };

  const failure = await loop({ ...built.handed, workspace }).run().then(() => assert.fail('run succeeded'), (thrown) => thrown);

  assert.equal(recorded(built, 'L2', 'attempt.failed', (each) => each.card === 1).length, 1);
  assert.equal(stopOf(failure, 2).decision, 'hold');
  assert.deepEqual(recorded(built, 'L2', 'attempt.decided', (each) => each.card === 1).map(({ decision }) => decision), ['escalate']);
  assert.deepEqual(recorded(built, 'L2', 'attempt.decided', (each) => each.card === 2).map(({ decision }) => decision), ['again', 'hold']);
});

// proves R-ESCALATE-12
test('a judge scratch refusal remains SCRATCH_REFUSED and escalates its card', SETTLES_WITHIN, async () => {
  let built;
  const judgeDirectory = async (card, role, head) => {
    const made = await built.handed.judgeDirectory(card, role, head);
    mkdirSync(made.scratch, { recursive: true });
    writeFileSync(join(made.scratch, role), 'kept\n');
    return made;
  };
  built = judgeWorld({ cards: [cardIn(7, COLUMNS.review)], forge: { pullRequests: [pullFor(7)] },
    kinds: { change: { ...KINDS.change, judges: ['reviewer'] } } });
  ownerWrites(built);
  const engine = loop({ ...built.handed, judgeDirectory });

  const [reached] = await engine.pull(1);

  assert.equal(reached.judges[0].outcome.reason.code, 'SCRATCH_REFUSED');
  assert.equal(built.owner.held().issues[0].comments.length, 1);
  assert.equal(recorded(built, 'L2', 'attempt.decided', (each) => each.card === 7).length, 0);
  assert.equal(readFileSync(join(built.scratch, 'workspaces', 'scratch', 'rigger-7', 'reviewer'), 'utf8'), 'kept\n');
});

// proves R-FAIL-8
test('two once invocations over the same board and state count the held card afresh', SETTLES_WITHIN, async () => {
  const built = failingWorld('workspace', { other: false });
  const first = await built.loop.pull(1).then(() => assert.fail('the first pull fulfilled'), (failure) => failure);
  // The hold closed admission, so the owner resumes before the second invocation.
  removeClosers(built.directory);
  const second = await built.loop.pull(1).then(() => assert.fail('the second pull fulfilled'), (failure) => failure);

  assert.equal(stopOf(first, 1).decision, 'hold');
  assert.equal(stopOf(second, 1).decision, 'hold');
  assert.deepEqual(recorded(built, 'L2', 'attempt.decided').map(({ attempt, decision }) => [attempt, decision]), [[1, 'again'], [2, 'hold'], [1, 'again'], [2, 'hold']]);
});

// proves R-FAIL-8
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

// proves R-FAIL-8
test('a held card writes one hold closer under admission state', SETTLES_WITHIN, async () => {
  const built = failingWorld('workspace', { other: false });
  await assert.rejects(built.loop.pull(1));
  assert.deepEqual(namesIn(built.directory).map((name) => name.split('-')[0]), ['hold']);
});

// proves R-FAIL-8
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

// proves R-FAIL-8
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
    // The hold closed admission, so the owner resumes before the later invocation.
    removeClosers(built.directory);

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

// proves R-FAIL-8
test('L1 reports a judge\'s scratch directory not made, whose contents the file system would not list, as a dispatch that did not start naming that directory as missing', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  const path = unlisted(t, placed.base, 'reviewer');

  const failure = await rejection(placed);

  assert.equal(failure?.code, NOT_STARTED, failure?.stack);
  assert.equal(failure.missing, path);
  assert.ok(failure.message.includes(path), failure.message);
});

// proves R-FAIL-8
test('L1 reports neither a judge\'s scratch directory refused under R-WORK-26 nor an invocation its adapter rejected as a judge\'s scratch directory not made', SETTLES_WITHIN, async (t) => {
  const placed = layout(t);
  mkdirSync(placed.base, { recursive: true });
  writeFileSync(join(placed.base, 'reviewer'), 'kept\n');
  const refused = await rejection(placed);
  const other = await rejection(placed, { base: join(placed.root, 'other', 'rigger-7'), adapters: { 'stand-in': { async invocation() { throw new Error('the adapter refuses this invocation'); } } } });

  assert.equal(refused?.code, 'SCRATCH_REFUSED', refused?.stack);
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
  ownerWrites(built);
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

// proves R-FAIL-8
test('run withholds a judge whose scratch directory was not made because the file system would not list it, and pulls its card no more in that invocation', SETTLES_WITHIN, async (t) => {
  let path;
  const world = spoiledWorld({ spoil: (made, role) => { path = unlisted(t, made.scratch, role); } });

  const failure = await ran(world.invocation());

  withheldOnce(world.built, failure, path);
});

// proves R-FAIL-8
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

// proves R-FAIL-8
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

// proves R-FAIL-8
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

// proves R-FAIL-8
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

// proves R-FAIL-8
test('run dispatches a judge whose scratch directory was made, as it did before a judge\'s scratch directory not made was withheld', SETTLES_WITHIN, async () => {
  const world = spoiledWorld();

  const failure = await ran(world.invocation());

  assert.equal(failure, undefined, failure?.stack);
  assert.deepEqual(withheldOf(world.built), []);
  const starts = recorded(world.built, 'L1', 'dispatch.start', (each) => each.card === 7);
  assert.equal(starts.length, 1);
  assert.equal(recorded(world.built, 'L1', 'dispatch.end', (each) => each.dispatch === starts[0].dispatch)[0]?.exit, 0);
});

// proves R-FAIL-8
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

// proves R-FAIL-8
test('L3 carries a judge withheld because its scratch directory was not made among none of the judges it dispatched, as it carries one withheld for its directory', SETTLES_WITHIN, async (t) => {
  const world = spoiledWorld({ judges: ['reviewer', 'architect'], spoil: (made, role) => {
    if (role === 'reviewer') unlisted(t, made.scratch, role);
  } });

  const [reached] = await world.invocation().pull(1);

  assert.deepEqual(reached.judges.map(({ role, outcome }) => [role, outcome?.status, outcome?.value?.exit]), [['architect', 'fulfilled', 0]], JSON.stringify(reached.judges));
});

// proves R-FAIL-8
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
    reviewer: [NOT_STARTED, path], architect: ['SCRATCH_REFUSED', undefined], pm: [NOT_STARTED, undefined],
  });
  assert.deepEqual(withheldOf(world.built), [{ role: 'reviewer', missing: path, classed: 'environment' }]);
});

// proves R-FAIL-8
test('a judge whose adapter rejects its invocation is not withheld for scratch and holds after its matching second dispatch failure', SETTLES_WITHIN, async () => {
  const roles = { ...config.roles, reviewer: { ...config.roles.reviewer, agent: '../outside/reviewer.md' } };
  let path;
  const world = spoiledWorld({ roles, spoil: (made, role) => { path = join(made.scratch, role); } });

  const failure = await world.invocation().pull(1).then(() => assert.fail('the matching pair must hold'), (failure) => failure);
  const [reached] = failure.reached;
  assert.equal(reached.judges.length, 1, JSON.stringify(reached.judges));
  assert.equal(reached.judges[0].role, 'reviewer');
  assert.equal(reached.judges[0].failure.decision, 'hold');
  assert.ok(reached.judges[0].failure.failure.reason.includes('R-SAFE-6'), reached.judges[0].failure.message);
  assert.ok(existsSync(path), 'L1 made the judge\'s scratch directory');
  assert.deepEqual(withheldOf(world.built), []);
});

// proves R-FAIL-8
test('a judge\'s scratch directory refused under R-WORK-26 is not withheld as not made and escalates its card', SETTLES_WITHIN, async () => {
  const world = spoiledWorld({ spoil: (made, role) => {
    mkdirSync(made.scratch, { recursive: true });
    writeFileSync(join(made.scratch, role), 'kept\n');
  } });

  const [reached] = await world.invocation().pull(1);

  assert.equal(reached.judges[0].outcome?.reason?.code, 'SCRATCH_REFUSED', JSON.stringify(reached.judges));
  assert.ok(reached.judges[0].outcome.reason.message.includes('R-WORK-26'), reached.judges[0].outcome.reason.message);
  assert.deepEqual(withheldOf(world.built), []);
});

// proves R-FAIL-8
test('for a judge withheld because its scratch directory was not made, L2 answers neither again nor hold', SETTLES_WITHIN, async (t) => {
  const world = spoiledWorld({ spoil: (made, role) => { unlisted(t, made.scratch, role); } });

  await ran(world.invocation());

  assert.equal(withheldOf(world.built).length, 1);
  const actions = world.built.decisions.filter(({ card }) => card === 7).map(({ answer }) => answer.action);
  assert.deepEqual(actions.filter((action) => action === 'again' || action === 'hold'), [], JSON.stringify(actions));
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided', (each) => each.card === 7), []);
});

// proves R-FAIL-8
test('after an invocation withholding a judge whose scratch directory was not made, admission stays open', SETTLES_WITHIN, async (t) => {
  const world = spoiledWorld({ spoil: (made, role) => { unlisted(t, made.scratch, role); } });

  await ran(world.invocation());

  assert.equal(withheldOf(world.built).length, 1);
  const state = admission({ directory: world.built.directory, sink: { emitter: () => ({ emit: () => {} }) } }).read();
  assert.deepEqual(state, { state: 'open' });
});

// proves R-FAIL-8
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

// Each panel cell retains its peer's result even when the refused judge finishes first.
// proves R-ESCALATE-12
test('each judge entry point and directory refusal retains every panel outcome before one escalation', SETTLES_WITHIN, async (t) => {
  for (const ready of [false, true]) for (const scratchRefusal of [false, true]) {
    for (const other of ['verdict', 'both refused', 'host withheld', 'no outcome']) {
      await t.test(`${ready ? 'after maker' : 'Review pull'} / ${scratchRefusal ? 'scratch' : 'directory'} / ${other}`, async () => {
        const { built, engine } = refusedPanel({ ready, scratchRefusal, other });
        const result = await engine.pull(1).then((reached) => ({ reached }), (failure) => ({ failure, reached: failure.reached }));
        assert.equal(Boolean(result.failure), other === 'no outcome', result.failure?.stack);
        const [reached] = result.reached;
        assert.deepEqual(reached.judges.map(({ role }) => role), ['reviewer', 'architect']);
        const issue = built.owner.held().issues[0];
        assert.equal(issue.comments.length, 1);
        assert.deepEqual(issue.labels, ['type:change', 'rigger:escalated']);
        for (const judge of reached.judges.filter(({ outcome }) => ['WORKSPACE_REFUSED', 'SCRATCH_REFUSED'].includes(outcome?.reason?.code))) {
          assert.ok(issue.comments[0].body.includes(judge.outcome.reason.message), issue.comments[0].body);
        }
        const architect = reached.judges[1];
        if (other === 'verdict') {
          assert.equal(architect.outcome.value.exit, 0);
          assert.ok(built.repository.pull(1007).comments.some(({ body }) => body.includes('Sound, by architect')));
        } else if (other === 'host withheld') assert.equal(architect.withheld.directory.reason.code, WORKSPACE_NOT_MADE);
        else if (other === 'no outcome') assert.match(architect.failure.message, /handed back no outcome/);
        else assert.ok(['WORKSPACE_REFUSED', 'SCRATCH_REFUSED'].includes(architect.outcome.reason.code));
        assert.equal(recorded(built, 'L2', 'review.escalate').length, 1);
        assert.equal(recorded(built, 'L3', 'pull').length, 1);
        const events = built.events();
        const escalation = events.findIndex(({ event }) => event === 'review.escalate');
        assert.ok(events.slice(escalation + 1).every(({ event }) => event !== 'dispatch.start'));
        assert.equal(recorded(built, 'L2', 'transition').at(-1).from, 'review');
      });
    }
  }
});

// Removing the invocation exclusion would retry refused writes as soon as the claim releases.
// proves R-ESCALATE-12
test('run excludes attempt and judge escalations after each refused owner write and retains the exact refusal', SETTLES_WITHIN, async (t) => {
  for (const stage of ['attempt', 'judges']) for (const write of ['comment', 'move', 'label']) {
    await t.test(`${stage} / ${write}`, async () => {
      const base = stage === 'judges' ? refusedPanel({ refuseWrite: write }) : (() => {
        const built = ownerWrites(judgeWorld({ cards: [cardIn(7, COLUMNS.ready)], workspace: async () => {
          throw Object.assign(new Error('R-WORK-13 refuses this path'), { code: 'WORKSPACE_REFUSED', path: '/work/rigger-7' });
        } }), { refuse: write });
        return { built, engine: built.loop };
      })();
      const { built } = base;
      let reads = 0;
      const read = built.handed.board.readPriority;
      built.handed.board.readPriority = async () => {
        reads += 1;
        if (reads > 6) throw new Error('the refused escalation was pulled repeatedly');
        return read();
      };
      const failure = await base.engine.run().then(() => assert.fail('the refused owner write succeeded'), (failure) => failure);
      assert.ok(leaves(failure).some(({ message }) => message.includes(`the forge refused ${write}`)), failure.stack);
      assert.ok(leaves(failure).every(({ message }) => !message.includes('pulled repeatedly')));
      assert.equal(recorded(built, 'L3', 'pull').length, 1);
      assert.equal(recorded(built, 'L2', 'review.escalate').length, 1);
      assert.equal(built.owner.held().issues[0].comments.length, write === 'comment' ? 0 : 1);
      assert.deepEqual(built.owner.held().issues[0].labels, ['type:change']);
    });
  }
});

// The counterexample treats the first host failure as a withheld scratch directory and never retries step 4.
// proves R-FAIL-8
test('a Review judge whose CLI is missing is retried once under its claim and ends held', SETTLES_WITHIN, async () => {
  const built = judgeWorld({ cards: [cardIn(7, COLUMNS.review)], forge: { pullRequests: [pullFor(7)] }, kinds: kindJudgedBy(['reviewer']) });
  const engine = loop({ ...built.handed, environment: { ...process.env, PATH: temporaryDirectory('rigger-empty-path-') } });
  const failure = await engine.pull(1).then(() => undefined, (failure) => failure);
  assert.ok(failure, 'two missing CLI dispatches hold the card');
  assert.deepEqual(recorded(built, 'L3', 'dispatch').map(({ role }) => role), ['reviewer', 'reviewer']);
  assert.deepEqual(recorded(built, 'L2', 'attempt.decided').map(({ decision }) => decision), ['again', 'hold']);
  assert.equal(namesIn(built.directory).length, 1);
  assert.equal(recorded(built, 'L3', 'pull').length, 1);
  assert.equal(recorded(built, 'L3', 'slot.release').length, 1);
  assert.equal(built.log.filter(({ made }) => made?.role === 'reviewer').length, 2);
  assert.deepEqual(built.agent.runs(), []);
});

/** Makes a role request under real L1 scratch checks and the named shipped provider adapter. */
function judgeStartRequest(t, provider = 'claude') {
  const placed = layout(t);
  const cwd = join(placed.directory, 'main');
  writeFileSync(join(cwd, 'agent.md'), '# Agent\n');
  const request = { answer: { ...JUDGE, provider, agent: 'agent.md' }, cwd, directory: placed.directory, scratch: placed.base, repository: placed.repository, reach: [], env: process.env, sink: placed.sink, id: 'd-judge', card: 7 };
  return { placed, request };
}

/** Checks L1's report, the configured identity where counted, L2's row and a matching pair. */
function judgeStartClass(outcome, cause, row) {
  assert.equal(outcome.reason?.code, NOT_STARTED);
  assert.deepEqual(outcome.reason.startCause, cause);
  assert.equal(judgeStartAnswer({ reviewer: outcome }).next.failure.row, row);
  assert.equal(judgeStartAnswer({ reviewer: outcome }, { firstFailures: { reviewer: outcome } }).next.action, 'hold');
  assert.doesNotMatch(JSON.stringify({ ...outcome.reason, message: outcome.reason.message }), /R-FAIL-8|\bR\d+\b/);
}

/** Installs a controlled builtin refusal across ESM imports for one source-cause test. */
function judgeStartBuiltin(t, target, name, replacement) {
  t.mock.method(target, name, replacement);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

// The counterexample loses the configured file's identity when the adapter refuses its real path.
// proves R-FAIL-8
test('Claude agent outside the repository is tagged at L0 and reported by L1 by the configured file for R6', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t);
  request.answer.agent = '../outside.md';
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'agent-outside', file: '../outside.md' }, 'R6');
});

// The counterexample treats an existing unresolved agent link as a missing file or a generic adapter error.
// proves R-FAIL-8
test('Claude unresolved agent link is tagged at L0 and reported by L1 by the configured file for R7', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t);
  rmSync(join(request.cwd, 'agent.md'));
  symlinkSync('agent.md', join(request.cwd, 'agent.md'));
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'agent-unresolved', file: 'agent.md' }, 'R7');
});

// A successfully escalated card must also stay out of the invocation's next pulls.
// proves R-ESCALATE-12
test('run pulls a successfully escalated attempt only once while retaining its one comment', SETTLES_WITHIN, async () => {
  const built = ownerWrites(judgeWorld({ cards: [cardIn(7, COLUMNS.ready)], workspace: async () => {
    throw Object.assign(new Error('R-WORK-13 refuses this path'), { code: 'WORKSPACE_REFUSED', path: '/work/rigger-7' });
  } }));
  const reached = await built.loop.run();
  assert.equal(reached[0].action, 'escalate');
  assert.equal(recorded(built, 'L3', 'pull').length, 1);
  assert.equal(built.owner.held().issues[0].comments.length, 1);
});

// The counterexample loses the adapter preparation cause or the identity L2 must count.
// proves R-FAIL-8
test('source cause R6 codex-outside is tagged at L0 and reported by L1 with its counted identity', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  request.answer.agent = '../outside.md';
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'agent-outside', file: '../outside.md' }, 'R6');
});

// The counterexample loses the adapter preparation cause or the identity L2 must count.
// proves R-FAIL-8
test('source cause R7 codex-link is tagged at L0 and reported by L1 with its counted identity', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  rmSync(join(request.cwd, 'agent.md')); symlinkSync('agent.md', join(request.cwd, 'agent.md'));
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'agent-unresolved', file: 'agent.md' }, 'R7');
});

// The counterexample loses the adapter preparation cause or the identity L2 must count.
// proves R-FAIL-8
test('source cause R8 codex-agent-read is tagged at L0 and reported by L1 with its counted identity', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  rmSync(join(request.cwd, 'agent.md'));
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'agent-unreadable', file: 'agent.md' }, 'R8');
});

// The counterexample loses the adapter preparation cause or the identity L2 must count.
// proves R-FAIL-8
test('source cause R9 claude-settings-json is tagged at L0 and reported by L1 with its counted identity', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'claude');
  mkdirSync(join(request.cwd, '.claude')); writeFileSync(join(request.cwd, '.claude', 'settings.json'), 'not JSON');
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'claude-settings-unreadable' }, 'R9');
});

// The counterexample loses the adapter preparation cause or the identity L2 must count.
// proves R-FAIL-8
test('source cause R9 claude-settings-object is tagged at L0 and reported by L1 with its counted identity', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'claude');
  mkdirSync(join(request.cwd, '.claude')); writeFileSync(join(request.cwd, '.claude', 'settings.json'), 'null');
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'claude-settings-unreadable' }, 'R9');
});

// The counterexample loses the adapter preparation cause or the identity L2 must count.
// proves R-FAIL-8
test('source cause R10 claude-compound-rule is tagged at L0 and reported by L1 with its counted identity', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'claude');
  mkdirSync(join(request.cwd, '.claude')); writeFileSync(join(request.cwd, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm ci && npm test)'] } })); const head = join(request.directory, 'head'); mkdirSync(head); request.reach = [head];
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'claude-compound-rule' }, 'R10');
});

// The counterexample loses the adapter preparation cause or the identity L2 must count.
// proves R-FAIL-8
test('source cause R33 claude-permission-text is tagged at L0 and reported by L1 with its counted identity', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'claude');
  mkdirSync(join(request.cwd, '.claude')); writeFileSync(join(request.cwd, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: [{ toString: null }] } })); const head = join(request.directory, 'head'); mkdirSync(head); request.reach = [head];
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'claude-rule-unreadable' }, 'R33');
});

// The counterexample loses the adapter preparation cause or the identity L2 must count.
// proves R-FAIL-8
test('source cause R12 claude-glob-path is tagged at L0 and reported by L1 with its counted identity', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'claude');
  const moved = `${request.directory}[host]`; renameSync(request.directory, moved); request.directory = moved; request.cwd = join(moved, 'main');
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'claude-exclusion-path', path: request.directory }, 'R12');
});

// The counterexample loses the adapter preparation cause or the identity L2 must count.
// proves R-FAIL-8
test('source cause R13 claude-head-path is tagged at L0 and reported by L1 with its counted identity', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'claude');
  const head = join(request.directory, 'head[host]'); mkdirSync(head); request.reach = [head];
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'claude-reached-path', path: head }, 'R13');
});

// The counterexample drops a preparation cause before L2 can apply its own row.
// proves R-FAIL-8
test('source cause R26 codex-home-mkdir is tagged where preparation fails and reaches L2 through L1', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  const original = fs.mkdirSync; judgeStartBuiltin(t, fs, 'mkdirSync', (path, ...args) => { if (String(path).endsWith('/codex-home')) throw Object.assign(new Error('ENOSPC preparing Codex directory'), { code: 'ENOSPC' }); return original(path, ...args); });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'codex-directory-unmade' }, 'R26');
});

// The counterexample drops a preparation cause before L2 can apply its own row.
// proves R-FAIL-8
test('source cause R11 codex-config-read is tagged where preparation fails and reaches L2 through L1', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  mkdirSync(join(request.cwd, '.codex', 'config.toml'), { recursive: true });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'codex-config-unreadable' }, 'R11');
});

// The counterexample drops a preparation cause before L2 can apply its own row.
// proves R-FAIL-8
test('source cause R27 codex-config-write is tagged where preparation fails and reaches L2 through L1', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  const original = fs.writeFileSync; judgeStartBuiltin(t, fs, 'writeFileSync', (path, ...args) => { if (String(path).endsWith('/codex-home/config.toml')) throw Object.assign(new Error('EROFS writing Codex config'), { code: 'EROFS' }); return original(path, ...args); });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'codex-home-file-unwritten' }, 'R27');
});

// The counterexample drops a preparation cause before L2 can apply its own row.
// proves R-FAIL-8
test('source cause R27 codex-auth-link is tagged where preparation fails and reaches L2 through L1', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  const original = fs.symlinkSync; judgeStartBuiltin(t, fs, 'symlinkSync', (from, to, ...args) => { if (String(to).endsWith('/codex-home/auth.json')) throw Object.assign(new Error('EROFS linking Codex auth'), { code: 'EROFS' }); return original(from, to, ...args); });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'codex-home-file-unwritten' }, 'R27');
});

// The counterexample drops a preparation cause before L2 can apply its own row.
// proves R-FAIL-8
test('source cause R26 codex-tmp-mkdir is tagged where preparation fails and reaches L2 through L1', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  const original = fs.mkdirSync; judgeStartBuiltin(t, fs, 'mkdirSync', (path, ...args) => { if (String(path).endsWith('/tmp')) throw Object.assign(new Error('ENOSPC preparing Codex directory'), { code: 'ENOSPC' }); return original(path, ...args); });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'codex-directory-unmade' }, 'R26');
});

// The counterexample drops a preparation cause before L2 can apply its own row.
// proves R-FAIL-8
test('source cause R29 claude-main-realpath is tagged where preparation fails and reaches L2 through L1', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'claude');
  rmSync(request.cwd, { recursive: true });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'directory-unusable' }, 'R29');
});

// The counterexample drops a preparation cause before L2 can apply its own row.
// proves R-FAIL-8
test('source cause R29 codex-main-realpath is tagged where preparation fails and reaches L2 through L1', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  rmSync(request.cwd, { recursive: true });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'directory-unusable' }, 'R29');
});

// The counterexample drops a preparation cause before L2 can apply its own row.
// proves R-FAIL-8
test('source cause R29 codex-scratch-realpath is tagged where preparation fails and reaches L2 through L1', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  request.adapters = { codex: { invocation: (input) => { rmSync(input.scratch, { recursive: true }); return ADAPTERS.codex.invocation(input); } } };
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'directory-unusable' }, 'R29');
});

// The counterexample attributes an unavailable owner home to the subsequent auth-link write.
// proves R-FAIL-8
test('source cause R34 missing owner home is tagged before the Codex auth link and reported through L1', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  const inherited = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME;
  t.after(() => { if (inherited === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = inherited; });
  judgeStartBuiltin(t, os, 'homedir', () => { throw new Error('the owner home is unavailable'); });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'owner-home-missing' }, 'R34');
});

// The counterexample leaves join's argument error unclassified, losing the invalid declaration.
// proves R-FAIL-8
test('source cause R35 a non-string agent name is reported by L1 and classed as a host cause', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t);
  request.answer.agent = null;
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'agent-name-invalid' }, 'R35');
});

/** Makes the observed stand-in invocation set only the variables this source case supplies. */
function judgeStartEnvironment(request, env, unset = []) {
  request.answer.provider = 'stand-in';
  request.adapters = { 'stand-in': { invocation: async () => ({ ...await ANSWERING['stand-in'].invocation(), env, unset }) } };
}

// The counterexample reports an adapter's forbidden value or loses the variable name L2 counts.
// proves R-FAIL-8
test('source cause R20 reports a forbidden variable name and keeps its sentinel value out of the L1 report and every event', SETTLES_WITHIN, async (t) => {
  const { placed, request } = judgeStartRequest(t);
  const sentinel = 'TOKEN-SENTINEL-1000-NEVER-RECORD';
  judgeStartEnvironment(request, { ADAPTER_TOKEN: sentinel });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'adapter-variable', variable: 'ADAPTER_TOKEN' }, 'R20');
  assert.ok(!JSON.stringify({ report: outcome.reason, message: outcome.reason.message, events: readEvents(join(placed.root, '.rigger')) }).includes(sentinel));
});

// The counterexample lets a programming error escape the environment report.
// proves R-FAIL-8
test('source cause R21 nonabsolute scratch is tagged by L1 before preparation', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t);
  request.scratch = 'relative';
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'dispatch-location' }, 'R21');
});

// The counterexample lets a programming error escape the environment report.
// proves R-FAIL-8
test('source cause R21 nonabsolute repository is tagged by L1 before preparation', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t);
  request.repository = 'relative';
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'dispatch-location' }, 'R21');
});

// The counterexample loses a probe failure behind a generic adapter refusal.
// proves R-FAIL-8
test('source cause R16 probe-exit comes from the Codex probe and is carried by L1', SETTLES_WITHIN, async (t) => {
  const { placed, request } = judgeStartRequest(t, 'codex');
  const stand = standInCodex({ exit: 3 });
  const [outcome] = await withFirstOnPath(stand.dir, () => Promise.allSettled([roleDispatch(request)]));
  assert.equal(stand.probes().length, 1, 'the stand-in probe actually ran');
  judgeStartClass(outcome, { kind: 'codex-probe-exit' }, 'R16');
});

// The counterexample loses a probe failure behind a generic adapter refusal.
// proves R-FAIL-8
test('source cause R17 probe-answer comes from the Codex probe and is carried by L1', SETTLES_WITHIN, async (t) => {
  const { placed, request } = judgeStartRequest(t, 'codex');
  const stand = standInCodex({ answer: 'not JSON' });
  const [outcome] = await withFirstOnPath(stand.dir, () => Promise.allSettled([roleDispatch(request)]));
  assert.equal(stand.probes().length, 1, 'the stand-in probe actually ran');
  judgeStartClass(outcome, { kind: 'codex-probe-answer' }, 'R17');
});

// The counterexample loses a probe failure behind a generic adapter refusal.
// proves R-FAIL-8
test('source cause R18 probe-skill-path comes from the Codex probe and is carried by L1', SETTLES_WITHIN, async (t) => {
  const { placed, request } = judgeStartRequest(t, 'codex');
  const skill = join(placed.root, 'skill', 'SKILL.md'); mkdirSync(dirname(skill)); symlinkSync(skill, skill); const stand = standInCodex({ skills: [skill] });
  const [outcome] = await withFirstOnPath(stand.dir, () => Promise.allSettled([roleDispatch(request)]));
  assert.equal(stand.probes().length, 1, 'the stand-in probe actually ran');
  judgeStartClass(outcome, { kind: 'codex-skill-unresolved' }, 'R18');
});

/** Advances the probe's algorithmic deadline only after the actual stand-in records readiness. */
async function judgeTimedProbe(t, refused = false) {
  const { request } = judgeStartRequest(t, 'codex');
  const stand = standInCodex({ hang: true });
  request.adapters = { codex: { invocation: (input) => ADAPTERS.codex.invocation({ ...input, probeTimeout: 1000 }) } };
  if (refused) {
    const sink = request.sink;
    request.sink = { emitter: (context) => {
      const emitter = sink.emitter(context);
      return { emit: (event, fields) => {
        if (context.layer === 'L0' && event === 'timeout.killed') throw new Error('the sink refuses the probe timeout kill');
        emitter.emit(event, fields);
      } };
    } };
  }
  return withFirstOnPath(stand.dir, async () => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let settled = false;
    const running = Promise.allSettled([roleDispatch(request)]).then(([outcome]) => { settled = true; return outcome; });
    while (stand.probes().length === 0 && !settled) await oneTurn();
    assert.equal(stand.probes().length, 1, 'the probe was ready before its deadline was advanced');
    t.mock.timers.tick(1000);
    while (!settled) { t.mock.timers.tick(25); await oneTurn(); }
    const outcome = await running;
    t.mock.timers.reset();
    return outcome;
  });
}

// The counterexample classes a timed-out probe as an ordinary nonzero probe exit.
// proves R-FAIL-8
test('source cause R19 the Codex skill probe outlives its deadline and reaches L2 through L1', SETTLES_WITHIN, async (t) => {
  const outcome = await judgeTimedProbe(t);
  judgeStartClass(outcome, { kind: 'codex-probe-timeout' }, 'R19');
});

// The counterexample retries a probe timeout whose kill could not be recorded, treating it as R19.
// proves R-FAIL-8
test('R38 a refused probe timeout kill is reported as an event refusal and L2 halts without a retry or hold', SETTLES_WITHIN, async (t) => {
  const outcome = await judgeTimedProbe(t, true);
  assert.equal(outcome.reason?.code, NOT_STARTED, 'the L1 wrapping and printed report keep their established shape');
  assert.deepEqual(outcome.reason.startCause, { kind: 'event-unrecorded' });
  const { next, events } = judgeStartAnswer({ reviewer: outcome });
  assert.equal(next.action, 'judge');
  assert.equal(next.halt, true);
  assert.deepEqual(events.filter(({ event }) => event === 'attempt.decided'), []);
});

/** A real L1/L2/L3 judge pair whose directory preparations supply the named source faults. */
function judgePairWorld(t, { ready = false, plans = { reviewer: ['host', 'host'] }, refuse = () => false, provisioning = {}, steps = [] } = {}) {
  const roles = Object.keys(plans);
  const built = ownerWrites(judgeWorld({ cards: [cardIn(7, ready ? COLUMNS.ready : COLUMNS.review)], forge: ready ? {} : { pullRequests: [pullFor(7)] }, kinds: { change: { ...kindJudgedBy(roles).change, provisioning: steps } }, provisioning, refuse }));
  const calls = [];
  const workspaces = [];
  const counts = new Map();
  const directory = async (card, role, head) => {
    const number = (counts.get(role) ?? 0) + 1;
    counts.set(role, number);
    const stateFiles = Object.fromEntries(fs.readdirSync(built.directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== 'events.jsonl')
      .map((entry) => [join(entry.parentPath, entry.name), readFileSync(join(entry.parentPath, entry.name), 'utf8')]));
    const admissionFiles = Object.fromEntries(Object.entries(stateFiles).filter(([path]) => path.startsWith(`${join(built.directory, 'admission')}/`)));
    calls.push({ role, number, events: built.events(), stateFiles, admissionFiles });
    const mode = plans[role][number - 1] ?? 'success';
    if (mode === 'directory-refused') throw Object.assign(new Error('R-WORK-20 refuses the judge directory'), { code: 'WORKSPACE_REFUSED', path: join(built.scratch, role) });
    if (mode === 'directory-unmade') throw Object.assign(new Error('the judge directory cannot be made'), { code: WORKSPACE_NOT_MADE, path: join(built.scratch, role) });
    const made = await built.handed.judgeDirectory(card, role, head);
    if (mode === 'host') rmSync(made.main, { recursive: true });
    if (mode === 'other-host') {
      mkdirSync(join(made.main, '.claude'), { recursive: true });
      writeFileSync(join(made.main, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm ci && npm test)'] } }));
    }
    if (mode === 'scratch-refused') {
      mkdirSync(made.scratch, { recursive: true });
      rmSync(join(made.scratch, role), { recursive: true, force: true });
      writeFileSync(join(made.scratch, role), 'kept\n');
    }
    if (mode === 'scratch-unmade') unlisted(t, made.scratch, role);
    if (mode === 'head-step-exit') writeFileSync(join(made.head, 'broken'), 'fail\n');
    if (mode === 'head-step-not-started') rmSync(join(made.head, 'step-dir'), { recursive: true, force: true });
    else mkdirSync(join(made.head, 'step-dir'), { recursive: true });
    return made;
  };
  const workspace = async (...args) => {
    workspaces.push(args[0]);
    const made = await built.handed.workspace(...args);
    mkdirSync(join(made.path, 'step-dir'), { recursive: true });
    return made;
  };
  const invocation = () => loop({ ...built.handed, judgeDirectory: directory, workspace });
  return { built, calls, workspaces, invocation };
}

/** Retains both the result and all reported failures without dropping a panel member. */
const judgePairResult = (engine, run = false) => (run ? engine.run() : engine.pull(1))
  .then((reached) => ({ reached }), (failure) => ({ failure, reached: failure.reached }));

/** Refuses before the world's accepted-start observer, which pairs accepted L1 starts with ends. */
function judgePairRefusal(world, refuses) {
  const sink = world.built.handed.sink;
  world.built.handed.sink = { emitter: (context) => {
    const emitter = sink.emitter(context);
    return { emit: (event, fields) => {
      if (refuses({ ...context, event, fields })) throw new Error(`the sink refuses ${event}`);
      emitter.emit(event, fields);
    } };
  } };
}

// The counterexample retries the host-failed reviewer after its peer's start event was refused.
// proves R-FAIL-8
test('a panel containing an R38 dispatch refusal performs no retry of its other judge', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'host'], architect: ['success'] }, refuse: ({ layer, event, fields }) => layer === 'L3' && event === 'dispatch' && fields.role === 'architect' });
  const result = await judgePairResult(world.invocation());
  assert.ok(result.failure);
  assert.equal(world.calls.filter(({ role }) => role === 'reviewer').length, 1, 'R-RECORD-9 stops further dispatch work');
  assert.deepEqual(admission({ directory: world.built.directory, sink: world.built.handed.sink }).read(), { state: 'open' });
  assert.deepEqual(result.reached[0].judges.map(({ role }) => role), ['reviewer', 'architect']);
});

// The counterexample sees a settled event refusal as a normal judge result and retries its peer.
// proves R-FAIL-8
test('a panel containing an R38 dispatch.start refusal performs no retry of its other judge', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'host'], architect: ['success'] } });
  judgePairRefusal(world, ({ layer, event, fields }) => layer === 'L1' && event === 'dispatch.start' && fields.facts !== undefined);
  const result = await judgePairResult(world.invocation());
  assert.equal(world.calls.filter(({ role }) => role === 'reviewer').length, 1, 'R-RECORD-9 stops further dispatch work');
  assert.deepEqual(admission({ directory: world.built.directory, sink: world.built.handed.sink }).read(), { state: 'open' });
  const architect = result.reached[0].judges.find(({ role }) => role === 'architect');
  assert.equal(architect.outcome.reason.code, 'EVENT_REFUSED');
  assert.match(architect.outcome.reason.message, /dispatch.start/);
});

// The counterexample calls the second, different host failure a withheld judge and succeeds.
// proves R-FAIL-8
test('a judge whose retry meets another host cause stops the card and leaves admission open', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'other-host'] } });
  const result = await judgePairResult(world.invocation());
  assert.ok(result.failure, 'different host causes stop the card');
  assert.ok(leaves(result.failure).some(({ decision }) => decision === 'stop'));
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided').map(({ decision }) => decision), ['again', 'stop']);
  assert.deepEqual(admission({ directory: world.built.directory, sink: world.built.handed.sink }).read(), { state: 'open' });
});

// The counterexample releases a stopped card and immediately pulls its still-owed judge again.
// proves R-FAIL-8
test('a run keeps a card stopped for two different judge host causes out of later pulls', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'other-host'] } });
  const read = world.built.handed.board.readPriority;
  let reads = 0;
  world.built.handed.board.readPriority = () => { if (++reads > 5) throw new Error('the test bounds repeated pulls'); return read(); };
  const result = await judgePairResult(world.invocation(), true);
  assert.ok(result.failure);
  assert.equal(world.calls.length, 2);
  assert.equal(recorded(world.built, 'L3', 'pull').length, 1);
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B entry-review-host', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { ready: false, plans: { reviewer: ['host', 'host'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(Boolean(result.failure), true, result.failure?.stack);
  assert.equal(world.calls.length, 2);
  assert.equal(world.workspaces.length, 0);
  assert.equal(world.built.agent.runs().filter((run) => run.role === 'engineer').length, 0);
  assert.equal(recorded(world.built, 'L3', 'dispatch', (event) => event.role === 'reviewer').length, 2);
  assert.equal(recorded(world.built, 'L3', 'pull').length, 1);
  assert.equal(recorded(world.built, 'L3', 'slot.release').length, 1);
  assert.equal(recorded(world.built, 'L2', 'attempt.decided').at(-1).decision, 'hold');
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B entry-review-success', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { ready: false, plans: { reviewer: ['host', 'success'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(Boolean(result.failure), false, result.failure?.stack);
  assert.equal(world.calls.length, 2);
  assert.equal(world.workspaces.length, 0);
  assert.equal(world.built.agent.runs().filter((run) => run.role === 'engineer').length, 0);
  assert.equal(recorded(world.built, 'L3', 'dispatch', (event) => event.role === 'reviewer').length, 2);
  assert.equal(recorded(world.built, 'L3', 'pull').length, 1);
  assert.equal(recorded(world.built, 'L3', 'slot.release').length, 1);
  assert.equal(recorded(world.built, 'L2', 'attempt.decided').at(-1).decision, 'again');
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B entry-maker-host', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { ready: true, plans: { reviewer: ['host', 'host'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(Boolean(result.failure), true, result.failure?.stack);
  assert.equal(world.calls.length, 2);
  assert.equal(world.workspaces.length, 1);
  assert.equal(world.built.agent.runs().filter((run) => run.role === 'engineer').length, 1);
  assert.equal(recorded(world.built, 'L3', 'dispatch', (event) => event.role === 'reviewer').length, 2);
  assert.equal(recorded(world.built, 'L3', 'pull').length, 1);
  assert.equal(recorded(world.built, 'L3', 'slot.release').length, 1);
  assert.equal(recorded(world.built, 'L2', 'attempt.decided').at(-1).decision, 'hold');
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B entry-maker-success', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { ready: true, plans: { reviewer: ['host', 'success'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(Boolean(result.failure), false, result.failure?.stack);
  assert.equal(world.calls.length, 2);
  assert.equal(world.workspaces.length, 1);
  assert.equal(world.built.agent.runs().filter((run) => run.role === 'engineer').length, 1);
  assert.equal(recorded(world.built, 'L3', 'dispatch', (event) => event.role === 'reviewer').length, 2);
  assert.equal(recorded(world.built, 'L3', 'pull').length, 1);
  assert.equal(recorded(world.built, 'L3', 'slot.release').length, 1);
  assert.equal(recorded(world.built, 'L2', 'attempt.decided').at(-1).decision, 'again');
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B retry-directory-refused', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'directory-refused'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.equal(world.built.owner.held().issues[0].comments.length, 1);
  assert.equal(recorded(world.built, 'L2', 'review.escalate').length, 1);
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided').map((event) => event.decision), ['again']);
  assert.deepEqual(admission({ directory: world.built.directory, sink: world.built.handed.sink }).read(), { state: 'open' });
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B retry-scratch-refused', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'scratch-refused'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.equal(world.built.owner.held().issues[0].comments.length, 1);
  assert.equal(recorded(world.built, 'L2', 'review.escalate').length, 1);
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided').map((event) => event.decision), ['again']);
  assert.deepEqual(admission({ directory: world.built.directory, sink: world.built.handed.sink }).read(), { state: 'open' });
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B retry-directory-unmade', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'directory-unmade'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.deepEqual(result.reached[0].judges, []);
  assert.equal(world.calls.length, 2);
  assert.equal(recorded(world.built, 'L2', 'judge.withheld').length, 1);
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided').map((event) => event.decision), ['again']);
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B retry-scratch-unmade', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'scratch-unmade'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.deepEqual(result.reached[0].judges, []);
  assert.equal(world.calls.length, 2);
  assert.equal(recorded(world.built, 'L2', 'judge.withheld').length, 1);
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided').map((event) => event.decision), ['again']);
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B retry-head-step-exit', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'head-step-exit'] }, steps: ['check'], provisioning: { check: { run: 'test ! -f broken', required: true } } });
  const result = await judgePairResult(world.invocation());
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.deepEqual(result.reached[0].judges, []);
  assert.equal(world.calls.length, 2);
  assert.equal(recorded(world.built, 'L2', 'judge.withheld').length, 1);
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided').map((event) => event.decision), ['again']);
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B retry-head-step-not-started', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'head-step-not-started'] }, steps: ['check'], provisioning: { check: { run: 'test ! -f broken', required: true, cwd: 'step-dir' } } });
  const result = await judgePairResult(world.invocation());
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.deepEqual(result.reached[0].judges, []);
  assert.equal(world.calls.length, 2);
  assert.equal(recorded(world.built, 'L2', 'judge.withheld').length, 1);
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided').map((event) => event.decision), ['again']);
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B sequential-panel', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'success'], architect: ['host', 'success'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.deepEqual(world.calls.filter(({ number }) => number === 2).map(({ role }) => role), ['reviewer', 'architect']);
  assert.deepEqual(world.built.agent.runs().map(({ role }) => role).sort(), ['architect', 'reviewer']);
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided').map(({ decision }) => decision), ['again', 'again']);
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B keeps-peer-result', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'success'], architect: ['success'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.equal(world.calls.filter(({ role }) => role === 'architect').length, 1);
  assert.equal(world.built.agent.runs().filter(({ role }) => role === 'architect').length, 1);
  assert.deepEqual(result.reached[0].judges.map(({ role, outcome }) => [role, outcome.value.exit]), [['reviewer', 0], ['architect', 0]]);
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B peer-withheld', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'success'], architect: ['directory-unmade'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.equal(world.calls.filter(({ role }) => role === 'reviewer').length, 2);
  assert.deepEqual(result.reached[0].judges.map(({ role }) => role), ['reviewer']);
  assert.equal(recorded(world.built, 'L2', 'judge.withheld').length, 1);
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B initial-peer-refusal', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'host'], architect: ['directory-refused'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.equal(world.calls.filter(({ role }) => role === 'reviewer').length, 1);
  assert.equal(world.built.owner.held().issues[0].comments.length, 1);
  assert.deepEqual(admission({ directory: world.built.directory, sink: world.built.handed.sink }).read(), { state: 'open' });
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B initial-peer-scratch-refusal', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'host'], architect: ['scratch-refused'] } });
  const result = await judgePairResult(world.invocation());
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.equal(world.calls.filter(({ role }) => role === 'reviewer').length, 1);
  assert.equal(world.built.owner.held().issues[0].comments.length, 1);
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B two-holds', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'host'], architect: ['host', 'host'] } });
  const result = await judgePairResult(world.invocation());
  assert.ok(result.failure);
  assert.equal(namesIn(world.built.directory).length, 1);
  assert.equal(recorded(world.built, 'L3', 'admission.close').length, 1);
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided').filter(({ decision }) => decision === 'hold').map(({ failures }) => failures[0].judge), ['reviewer', 'architect']);
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B hold-and-escalation-False', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'host'], architect: ['host', 'directory-refused'] } });
  const result = await judgePairResult(world.invocation());
  assert.ok(result.failure);
  assert.equal(world.built.owner.held().issues[0].comments.length, 1);
  assert.ok(recorded(world.built, 'L2', 'attempt.decided').some((event) => event.decision === 'hold'));
  assert.equal(namesIn(world.built.directory).length, 1);
  const events = world.built.events();
  assert.ok(events.findIndex(({ event }) => event === "admission.close") < events.findIndex(({ event }) => event === "review.escalate"));
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B hold-and-escalation-True', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'directory-refused'], architect: ['host', 'host'] } });
  const result = await judgePairResult(world.invocation());
  assert.ok(result.failure);
  assert.equal(world.built.owner.held().issues[0].comments.length, 1);
  assert.ok(recorded(world.built, 'L2', 'attempt.decided').some((event) => event.decision === 'hold'));
  assert.equal(namesIn(world.built.directory).length, 1);
  const events = world.built.events();
  assert.ok(events.findIndex(({ event }) => event === "admission.close") < events.findIndex(({ event }) => event === "review.escalate"));
});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B stop-and-escalation-False', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'other-host'], architect: ['host', 'directory-refused'] } });
  const result = await judgePairResult(world.invocation());
  assert.ok(result.failure);
  assert.equal(world.built.owner.held().issues[0].comments.length, 1);
  assert.ok(recorded(world.built, 'L2', 'attempt.decided').some((event) => event.decision === 'stop'));
  assert.deepEqual(admission({ directory: world.built.directory, sink: world.built.handed.sink }).read(), { state: 'open' });
  const events = world.built.events();

});

// A counterexample changes the table outcome or loses another judge under the same claim.
// proves R-FAIL-8
test('Table A and B stop-and-escalation-True', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'directory-refused'], architect: ['host', 'other-host'] } });
  const result = await judgePairResult(world.invocation());
  assert.ok(result.failure);
  assert.equal(world.built.owner.held().issues[0].comments.length, 1);
  assert.ok(recorded(world.built, 'L2', 'attempt.decided').some((event) => event.decision === 'stop'));
  assert.deepEqual(admission({ directory: world.built.directory, sink: world.built.handed.sink }).read(), { state: 'open' });
  const events = world.built.events();

});

// The counterexample starts a retry while the initial panel still has a running judge.
// proves R-FAIL-8
test('the retry waits for every initial judge to settle before starting step 4 again', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'host'], architect: ['success'] } });
  world.built.agent.plan(7, 'architect', { hold: true, exit: 0 });
  const pending = judgePairResult(world.invocation());
  await waitFor(() => world.built.agent.held(7, 'architect'), 20_000);
  await waitFor(() => recorded(world.built, 'L2', 'attempt.decided').some(({ decision }) => decision === 'again'), 20_000);
  const before = world.calls.filter(({ role }) => role === 'reviewer').length;
  world.built.agent.release(7, 'architect');
  const result = await pending;
  assert.equal(before, 1, 'the host-failed judge was not retried while its peer was running');
  assert.ok(result.failure);
  const peer = recorded(world.built, 'L3', 'dispatch', ({ role }) => role === 'architect')[0];
  assert.ok(world.calls.find(({ role, number }) => role === 'reviewer' && number === 2).events.some(({ event, dispatch }) => event === 'dispatch.end' && dispatch === peer.dispatch));
});

// The counterexample rebuilds the workspace, reprovisions it, or releases the claim for a retry.
// proves R-FAIL-8
test('the retry reprovisions only the judge head while retaining the claim slot and unpersisted first failure', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { ready: true, plans: { reviewer: ['host', 'host'] }, steps: ['check'], provisioning: { check: { run: 'true', required: true } } });
  const result = await judgePairResult(world.invocation());
  assert.ok(result.failure);
  assert.equal(world.workspaces.length, 1);
  const steps = recorded(world.built, 'L3', 'dispatch', ({ step }) => step === 'check');
  assert.deepEqual(steps.map(({ role }) => role), [undefined, 'reviewer', 'reviewer']);
  const second = world.calls[1].events;
  const at = second.findIndex(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role === 'reviewer');
  assert.deepEqual(second.slice(at + 1).filter(({ event }) => ['pull', 'transition', 'slot.release'].includes(event)), []);
  const first = second.find(({ event, judge }) => event === 'attempt.failed' && judge === 'reviewer');
  assert.ok(first);
  assert.ok(!second.some(({ event }) => event === 'admission.close'));
  assert.equal(second.filter(({ event }) => event === 'pull').length, 1);
  assert.deepEqual(world.calls[0].admissionFiles, world.calls[1].admissionFiles, 'admission is unchanged between the two dispatches');
  for (const [path, text] of Object.entries(world.calls[1].stateFiles)) {
    assert.ok(!text.includes(first.reason), `${path} persisted the first failure`);
    assert.ok(!text.includes('directory-unusable'), `${path} persisted the first cause`);
  }
});

// The counterexample reads a first failure from a prior run and holds the current first dispatch.
// proves R-FAIL-8
test('a recorded first failure from another invocation is not read to count the current judge pair', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'success'] } });
  openSink({ directory: world.built.directory, run: 'r-earlier', now: () => 0 }).emitter({ layer: 'L2', card: 7 }).emit('attempt.failed', { attempt: 1, class: 'environment', judge: 'reviewer', row: 'R29', reason: 'earlier invocation' });
  const original = fs.readFileSync;
  let reads = 0;
  judgeStartBuiltin(t, fs, 'readFileSync', (path, ...args) => {
    if (path === join(world.built.directory, 'events.jsonl')) reads += 1;
    return original(path, ...args);
  });
  const result = await judgePairResult(world.invocation());
  t.mock.restoreAll();
  syncBuiltinESMExports();
  assert.equal(result.failure, undefined, result.failure?.stack);
  assert.equal(reads, world.calls.length, 'only the fixture snapshots read the record; L2 adds no read');
  assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided').map(({ attempt, decision }) => [attempt, decision]), [[1, 'again']]);
});

// The counterexample ignores a scratch event refusal and retries the other judge.
// proves R-FAIL-8
test('a panel containing an R38 scratch event refusal performs no retry of its other judge', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'host'], architect: ['success'] } });
  judgePairRefusal(world, ({ layer, event, fields }) => layer === 'L1' && event === 'workspace.made' && fields.role === 'architect');
  const result = await judgePairResult(world.invocation());
  assert.equal(world.calls.filter(({ role }) => role === 'reviewer').length, 1);
  const architect = result.reached[0].judges.find(({ role }) => role === 'architect');
  assert.equal(architect.outcome.reason.code, 'EVENT_REFUSED');
  assert.match(architect.outcome.reason.message, /workspace.made/);
  assert.deepEqual(admission({ directory: world.built.directory, sink: world.built.handed.sink }).read(), { state: 'open' });
});

// The counterexample keeps retrying the second judge after the first retry loses its start event.
// proves R-FAIL-8
test('an R38 on a retry stops the remaining judge retries before a hold can be reached', SETTLES_WITHIN, async (t) => {
  const world = judgePairWorld(t, { plans: { reviewer: ['host', 'success'], architect: ['host', 'host'] } });
  let starts = 0;
  judgePairRefusal(world, ({ layer, event, fields }) => layer === 'L3' && event === 'dispatch' && fields.role === 'reviewer' && ++starts === 2);
  const result = await judgePairResult(world.invocation());
  assert.ok(result.failure);
  assert.equal(world.calls.filter(({ role }) => role === 'architect').length, 1);
  assert.deepEqual(admission({ directory: world.built.directory, sink: world.built.handed.sink }).read(), { state: 'open' });
});

// The counterexample catches an earlier read but misses this later directory read.
// proves R-FAIL-8
test('source cause R29 claude-head-realpath is attached where its directory read fails', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'claude');
  request.reach = [join(request.directory, 'missing-head')];
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'directory-unusable' }, 'R29');
});

// The counterexample catches an earlier read but misses this later directory read.
// proves R-FAIL-8
test('source cause R29 codex-tmp-realpath is attached where its directory read fails', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  let active = false; let reads = 0; const original = fs.realpathSync.native; judgeStartBuiltin(t, fs.realpathSync, 'native', (path, ...args) => { if (active && path === join(request.scratch, request.answer.role) && ++reads === 2) throw Object.assign(new Error('EIO rereading scratch'), { code: 'EIO' }); return original(path, ...args); }); request.adapters = { codex: { invocation: (input) => { active = true; return ADAPTERS.codex.invocation(input); } } };
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'directory-unusable' }, 'R29');
});

// The counterexample carries the command name through an adapter refusal instead of its provider.
// proves R-FAIL-8
test('source cause R2 a missing Codex probe CLI is reported by L1 with the configured provider', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t, 'codex');
  refuseSpawn(t, { command: 'codex', code: 'ENOENT' });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'command-missing', provider: 'codex' }, 'R2');
});

// The counterexample uses an adapter command path as the provider identity of the dispatch itself.
// proves R-FAIL-8
test('source cause R2 the role provider survives L1 invocation handoff when the adapter command has another name', SETTLES_WITHIN, async (t) => {
  const { placed, request } = judgeStartRequest(t);
  request.answer.provider = 'stand-in';
  request.adapters = { 'stand-in': { invocation: async () => ({ ...await ANSWERING['stand-in'].invocation(), command: join(placed.root, 'missing-cli') }) } };
  const handed = await roleDispatch(request);
  const [outcome] = await Promise.allSettled([judgeDispatchOnL1({ ...handed, id: request.id, card: 7, directory: join(placed.root, '.rigger'), sink: placed.sink })]);
  judgeStartClass(outcome, { kind: 'command-missing', provider: 'stand-in' }, 'R2');
});

// Each source in the inventory must retain its own cause, even when another path reaches the same row.
// proves R-FAIL-8
test('source inventory covers every Codex probe spawn errno', SETTLES_WITHIN, async (t) => {
  for (const [errno, kind, row] of [
    ['EACCES', 'command-not-executable', 'R3'], ['E2BIG', 'command-too-long', 'R4'],
    ['EAGAIN', 'process-resources', 'R28'], ['ENOMEM', 'process-resources', 'R28'],
    ['EMFILE', 'file-descriptors', 'R36'], ['ENFILE', 'file-descriptors', 'R36'],
    ['EUNRECOGNIZED', 'host-error', 'R37'],
  ]) await t.test(errno, async (t) => {
    const { request } = judgeStartRequest(t, 'codex');
    refuseSpawn(t, { command: 'codex', code: errno });
    const [outcome] = await Promise.allSettled([roleDispatch(request)]);
    judgeStartClass(outcome, { kind, ...(row === 'R3' ? { provider: 'codex' } : {}) }, row);
  });
});

// R1 is outside the host retry, including each adapter's invalid tier and a missing adapter.
// proves R-FAIL-8
test('R1 missing adapter and each provider unmapped model never request a retry or hold', SETTLES_WITHIN, async (t) => {
  for (const provider of ['absent', 'claude', 'codex']) await t.test(provider, async (t) => {
    const { request } = judgeStartRequest(t, provider);
    request.answer.tier = 'unmapped';
    const [outcome] = await Promise.allSettled([roleDispatch(request)]);
    assert.equal(outcome.reason.code, NOT_STARTED);
    assert.equal(outcome.reason.startCause, undefined);
    const { next, events } = judgeStartAnswer({ reviewer: outcome });
    assert.equal(next.action, 'judge');
    assert.deepEqual(events.filter(({ event }) => event === 'attempt.decided'), []);
    assert.deepEqual(judgeStartAnswer({ reviewer: outcome }, { firstFailures: { reviewer: outcome } }).next.action, 'judge');
  });
});

// Parsing failures and an unreadable settings file are separate inventory causes of the same row.
// proves R-FAIL-8
test('source cause R9 an unreadable Claude settings file reaches L2 through L1', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t);
  mkdirSync(join(request.cwd, '.claude', 'settings.json'), { recursive: true });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'claude-settings-unreadable' }, 'R9');
});

// Each malformed answer shape comes from the probe and must retain R17 rather than a generic adapter error.
// proves R-FAIL-8
test('source inventory covers each unreadable Codex skill answer shape', SETTLES_WITHIN, async (t) => {
  const block = (text) => JSON.stringify([{ type: 'message', role: 'developer', content: [{ type: 'input_text', text }] }]);
  const answers = {
    'no JSON': 'not JSON', 'no skill list': '[]',
    'no heading': block('<skills_instructions>\nno heading\n</skills_instructions>'),
    'malformed line': block('<skills_instructions>\n### Available skills\nnot a skill\n</skills_instructions>'),
    'unbound root': block('<skills_instructions>\n### Available skills\n- skill: A skill. (file: r8/skill/SKILL.md)\n</skills_instructions>'),
  };
  for (const [shape, answer] of Object.entries(answers)) await t.test(shape, async (t) => {
    const { request } = judgeStartRequest(t, 'codex');
    const stand = standInCodex({ answer });
    const [outcome] = await withFirstOnPath(stand.dir, () => Promise.allSettled([roleDispatch(request)]));
    assert.equal(stand.probes().length, 1);
    judgeStartClass(outcome, { kind: 'codex-probe-answer' }, 'R17');
  });
});

// Forbidden variables count by name, while unresolvable paths have their own directory row.
// proves R-FAIL-8
test('source inventory covers each adapter environment refusal', SETTLES_WITHIN, async (t) => {
  for (const mode of ['git redirect', 'unset', 'nonabsolute', 'outside', 'unresolvable value', 'unresolvable directory']) await t.test(mode, async (t) => {
    const { request } = judgeStartRequest(t);
    const variable = mode === 'git redirect' ? 'GIT_DIR' : 'ADAPTER_PATH';
    let value = request.cwd;
    if (mode === 'nonabsolute') value = 'relative';
    if (mode === 'outside') value = dirname(request.directory);
    if (mode === 'unresolvable value') { value = join(request.directory, 'loop'); symlinkSync(value, value); }
    judgeStartEnvironment(request, { [variable]: value }, mode === 'unset' ? [variable] : []);
    if (mode === 'unresolvable directory') {
      const invocation = request.adapters['stand-in'].invocation;
      request.adapters['stand-in'].invocation = async () => { const result = await invocation(); rmSync(request.directory, { recursive: true }); return result; };
    }
    const [outcome] = await Promise.allSettled([roleDispatch(request)]);
    const directory = mode.startsWith('unresolvable');
    judgeStartClass(outcome, directory ? { kind: 'directory-unusable' } : { kind: 'adapter-variable', variable }, directory ? 'R29' : 'R20');
  });
});

// The probe can lose main before its spawn or after answering, at two independent reads.
// proves R-FAIL-8
test('source inventory covers Codex probe working directory and post-probe directory reads', SETTLES_WITHIN, async (t) => {
  for (const mode of ['before probe', 'after probe']) await t.test(mode, async (t) => {
    const { request } = judgeStartRequest(t, 'codex');
    const stand = standInCodex();
    if (mode === 'before probe') {
      const original = fs.mkdirSync;
      judgeStartBuiltin(t, fs, 'mkdirSync', (path, ...args) => { const result = original(path, ...args); if (String(path).endsWith('/tmp')) rmSync(request.cwd, { recursive: true }); return result; });
    } else {
      let active = false; let reads = 0;
      const original = fs.realpathSync.native;
      judgeStartBuiltin(t, fs.realpathSync, 'native', (path, ...args) => { if (active && path === request.cwd && ++reads === 2) throw Object.assign(new Error('EIO after probe'), { code: 'EIO' }); return original(path, ...args); });
      request.adapters = { codex: { invocation: (input) => { active = true; return ADAPTERS.codex.invocation(input); } } };
    }
    const [outcome] = await withFirstOnPath(stand.dir, () => Promise.allSettled([roleDispatch(request)]));
    assert.equal(stand.probes().length, mode === 'before probe' ? 0 : 1);
    judgeStartClass(outcome, { kind: 'directory-unusable' }, 'R29');
  });
});

// A missing adapter or unmapped tier is R1, and L3 must never turn its outcome into another dispatch.
// proves R-FAIL-8
test('L3 does not retry any R1 source on a judge first dispatch', SETTLES_WITHIN, async (t) => {
  for (const provider of ['absent', 'claude', 'codex']) await t.test(provider, async () => {
    const roles = { ...config.roles, reviewer: { ...config.roles.reviewer, provider, tier: 'unmapped' } };
    const built = judgeWorld({ cards: [cardIn(7, COLUMNS.review)], forge: { pullRequests: [pullFor(7)] }, kinds: kindJudgedBy(['reviewer']), roles });
    const { reached, failure } = await judgePairResult(built.loop);
    assert.equal(failure, undefined, failure?.stack);
    assert.equal(reached[0].judges[0].outcome.reason.code, NOT_STARTED);
    assert.equal(recorded(built, 'L3', 'dispatch').length, 1);
    assert.deepEqual(recorded(built, 'L2', 'attempt.decided'), []);
    assert.equal(existsSync(join(built.directory, 'admission')), false);
    assert.deepEqual(admission({ directory: built.directory, sink: { emitter: () => ({ emit() {} }) } }).read(), { state: 'open' });
  });
});

// The card's hold must dominate its stopped peer whatever order L2 named the judges.
// proves R-FAIL-8
test('a panel hold dominates a different-host stop in each judge order', SETTLES_WITHIN, async (t) => {
  for (const stoppedFirst of [false, true]) await t.test(String(stoppedFirst), async (t) => {
    const plans = stoppedFirst ? { reviewer: ['host', 'other-host'], architect: ['host', 'host'] } : { reviewer: ['host', 'host'], architect: ['host', 'other-host'] };
    const world = judgePairWorld(t, { plans });
    const result = await judgePairResult(world.invocation());
    assert.ok(result.failure);
    assert.deepEqual(recorded(world.built, 'L2', 'attempt.decided').map(({ decision }) => decision), ['again', 'again', ...(stoppedFirst ? ['stop', 'hold'] : ['hold', 'stop'])]);
    assert.equal(recorded(world.built, 'L3', 'admission.close').length, 1);
    const summary = world.built.decisions.at(-1).answer;
    assert.equal(summary.action, 'hold');
    assert.equal(summary.role, stoppedFirst ? 'architect' : 'reviewer');
  });
});

// Resolving a counted exclusion path can itself fail after main was read successfully.
// proves R-FAIL-8
test('source cause R29 Claude exclusion ancestor realpath failure is tagged before L1 reports it', SETTLES_WITHIN, async (t) => {
  const { request } = judgeStartRequest(t);
  const moved = `${request.directory}[host]`;
  renameSync(request.directory, moved);
  request.directory = moved;
  request.cwd = join(moved, 'main');
  const original = fs.realpathSync.native;
  judgeStartBuiltin(t, fs.realpathSync, 'native', (path, ...args) => { if (path === moved) throw Object.assign(new Error('EIO resolving exclusion ancestor'), { code: 'EIO' }); return original(path, ...args); });
  const [outcome] = await Promise.allSettled([roleDispatch(request)]);
  judgeStartClass(outcome, { kind: 'directory-unusable' }, 'R29');
});
