// ABOUTME: Tests L3's pull over L2's facts call, driven through the loop world: L3 awaits the call
// before it claims, a card-local forge refusal escalates under its claim without a workspace,
// a Review card with one open pull request answers its agent judges, and is ignored where its kind's
// only judge is `owner`, and a Review card with none is done again.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from '../rigger.config.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository, markerComment } from './fake-repository.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { acceptanceDigest } from '../src/workflow/marker.mjs';
import {
  COLUMNS, KINDS, cardIn, columnsOf, factsOverNothing, handleOn, makingWorkspaces, readyCard, waitFor, world,
} from './loop-world.mjs';
import { until } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { standInAgent } from './stub-claude.mjs';
import { positive } from './loop-world.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { makingJudgeDirectories } from './loop-world.mjs';
import { PASSING } from './loop-world.mjs';

/** The stand-in agent every maker in this file runs as, first on the PATH a loop is handed. */
const agent = standInAgent();

// A bound on the test that waits on a real step, so one whose condition never holds fails here
// rather than holding the suite.
const { 60_000: SETTLES_WITHIN } = BOUNDS;

/** A pull request from card `number`'s line of work, numbered `pull`, merged where `merged` says. */
const pullFrom = (number, pull, merged = false) => ({ number: pull, head: `rigger-${number}`, sha: `${pull}`.padStart(40, 'c'), merged });

/** A workspace stand-in answering a path it never makes, recording each card it was asked for in `asked`. */
function recordingWorkspaces() {
  const asked = [];
  const handle = async (card) => {
    asked.push(card);
    return { path: `/nowhere/rigger-${card}` };
  };
  return Object.assign(handle, { asked });
}

/** The cards L3 recorded a `pull` event under in `built`'s stream. */
const pulledIn = (built) => built.l3Events().filter((event) => event.event === 'pull').map((event) => event.card);

test('loop throws when built, naming the facts call, where the facts call it is handed is not a function', () => {
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: [readyCard(1)] });
  const handed = {
    config: { ...config, concurrency: 1 },
    board: handleOn(fake),
    decide: (card) => nextAction(card, KINDS),
    l2: { claimed: async () => {}, settled: async () => {} },
    sink: { emitter: () => ({ emit: () => {} }) },
    kill: async () => {},
    workspace: async () => ({ path: '/nowhere' }),
    judgeDirectory: async () => ({ path: '/nowhere', main: '/nowhere/main', head: '/nowhere/head' }),
    removeDirectories: async () => {},
    state: '/nowhere/.rigger',
  };
  for (const facts of [undefined, null, {}, 'facts']) {
    assert.throws(() => loop({ ...handed, facts }), /\bfacts call\b/, String(facts));
  }
});

test('L3 awaits L2\'s facts call between its board read and its claims: while the call is held, no card is claimed, moved or dispatched', async () => {
  const built = world({ cards: [1], concurrency: 1 });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const board = handleOn(built.fake);
  const read = [];
  const facts = async (cards) => {
    read.push(cards.map((card) => card.number));
    await held;
    return (card) => nextAction(card, KINDS, undefined, { roles: config.roles, provisioning: {} });
  };
  built.agent.plan(1, 'engineer', { hold: true });
  const l3 = loop({ config: { ...config, concurrency: 1 }, board, decide: (card) => nextAction(card, KINDS, undefined, { roles: config.roles, provisioning: {} }), facts, l2: built.l2, sink: built.sink, kill: async () => {}, workspace: makingWorkspaces(temporaryDirectory('rigger-facts-held-')), judgeDirectory: makingJudgeDirectories(temporaryDirectory('rigger-judge-directories-')), removeDirectories: async () => {}, state: built.directory, environment: { ...process.env, PATH: built.agent.first() } });

  const pulled = l3.pull();
  // Positive: until the facts call is held.
  await positive(() => read.length === 1);
  assert.deepEqual(read, [[1]], 'the facts call was handed the cards L3 read');
  assert.deepEqual(built.fake.writes(), []);
  assert.deepEqual(built.dispatches.started, []);

  release();
  // Positive: until card 1's stand-in is held.
  await positive(() => built.dispatches.held() === 1);
  built.dispatches.releaseAll();
  await pulled.catch(() => {});
  assert.deepEqual(built.dispatches.started, [1]);
  assert.equal(built.fake.writes()[0].args[1], COLUMNS.coding);
});

test('given L2\'s facts call failing on one card\'s read, the pull rejects naming the card and the read, no card is claimed, and the fake board\'s write record is unchanged', async () => {
  const workspace = recordingWorkspaces();
  const built = world({ cards: [1, 2], concurrency: 2, workspace });
  const failing = built.repository.operations.readPullRequests;
  built.repository.operations.readPullRequests = async (branch) => {
    if (branch === 'rigger-2') throw new Error(`readPullRequests on board 6 failed: reading the pull requests from branch ${branch} in williacj/rigger, gh: HTTP 502`);
    return failing(branch);
  };

  await assert.rejects(built.loop.pull(), (error) => /card #2\b/.test(error.message) && /pull requests from branch rigger-2/.test(error.message));

  assert.deepEqual(built.fake.writes(), []);
  assert.deepEqual(pulledIn(built), []);
  assert.deepEqual(built.dispatches.started, []);
  assert.deepEqual(workspace.asked, []);
});

/**
 * Pulls once over a board holding `card` alone, with the forge seeded with `forge`, and asserts that
 * L2 escalated it at the pull, its reason matching `names`: it moves to Owner under one claim,
 * with one comment and its escalation label. No workspace or line-of-work change is made.
 */
async function escalatedAtPull(card, forge, names) {
  const workspace = recordingWorkspaces();
  const built = world({ cards: [card], concurrency: 1, forge, workspace });
  const before = built.repository.held();

  const reached = await built.loop.pull();
  assert.equal(reached[0].action, 'escalate');

  const [decision] = built.decisions;
  assert.equal(decision.action.action, 'escalate', JSON.stringify(decision));
  assert.equal(decision.action.line, `rigger-${card.number}`);
  assert.match(decision.action.reason, names);
  assert.deepEqual(built.fake.writes(), [{ operation: 'moveItem', args: [card.id ?? 'item-1', COLUMNS.owner] }]);
  assert.deepEqual(pulledIn(built), [card.number]);
  assert.deepEqual(workspace.asked, []);
  const after = built.repository.held();
  assert.deepEqual(after.pullRequests, before.pullRequests);
  assert.deepEqual(after.branches, before.branches);
  assert.equal(after.issues[0].comments.length, 1);
  assert.match(after.issues[0].comments[0].body, names);
  assert.ok(after.issues[0].labels.includes('rigger:escalated'));
}

// proves R-WORK-19
test('given a Ready card whose line of work the forge holds, L2 escalates it at the pull without a workspace and preserves its line of work', () => escalatedAtPull(cardIn(1, COLUMNS.ready), { branches: ['rigger-1'] }, /rigger-1/));

// proves R-WORK-19
test('given a Coding card whose line of work the forge holds, L2 escalates it at the pull without a workspace and preserves its line of work', () => escalatedAtPull(cardIn(2, COLUMNS.coding), { branches: ['rigger-2'] }, /rigger-2/));

// proves R-WORK-19
test('given a Ready or Coding card with a merged pull request from its line of work, L2 escalates it at the pull without a workspace and preserves its line of work', async () => {
  for (const column of [COLUMNS.ready, COLUMNS.coding]) await escalatedAtPull(cardIn(3, column), { pullRequests: [pullFrom(3, 31, true)] }, /#31\b/);
});

// proves R-WORK-5
test('given a Review card with a merged pull request, L3 has L2 move it to Done without a workspace', async () => {
  const workspace = recordingWorkspaces();
  const built = world({ cards: [cardIn(3, COLUMNS.review)], concurrency: 1, forge: { pullRequests: [pullFrom(3, 31, true)] }, workspace });
  const before = built.repository.held();

  assert.deepEqual(await built.loop.pull(), [{ card: 3, action: 'move', to: 'done' }]);

  assert.deepEqual(built.decisions.map(({ action }) => action), [{ action: 'move', to: 'done' }]);
  assert.deepEqual(pulledIn(built), [3]);
  assert.deepEqual(await columnsOf(built.fake), { 3: COLUMNS.done });
  assert.deepEqual(built.events().filter(({ event }) => event === 'transition').map(({ card, from, to, cause }) => ({ card, from, to, cause })), [
    { card: 3, from: 'review', to: 'done', cause: 'merged' },
  ]);
  assert.deepEqual(workspace.asked, []);
  assert.deepEqual(built.repository.held(), before);
});

// proves R-WORK-5
test('given an Owner card with a merged pull request, L3 has L2 move it to Done and records mergedFromOwner', async () => {
  const workspace = recordingWorkspaces();
  const built = world({ cards: [cardIn(8, COLUMNS.owner)], concurrency: 1, forge: { pullRequests: [pullFrom(8, 81, true)] }, workspace });
  const before = built.repository.held();

  assert.deepEqual(await built.loop.pull(), [{ card: 8, action: 'move', to: 'done' }]);
  assert.deepEqual(await columnsOf(built.fake), { 8: COLUMNS.done });
  assert.deepEqual(built.events().filter(({ event }) => event === 'transition').map(({ card, from, to, cause }) => ({ card, from, to, cause })), [
    { card: 8, from: 'owner', to: 'done', cause: 'mergedFromOwner' },
  ]);
  assert.deepEqual(workspace.asked, []);
  assert.deepEqual(built.repository.held(), before);
});

// proves R-WORK-19
test('given a Review card with two open pull requests from its line of work, L2 escalates it at the pull without a workspace and preserves its line of work', () => escalatedAtPull(cardIn(4, COLUMNS.review), { pullRequests: [pullFrom(4, 41), pullFrom(4, 42)] }, /#41\b.*#42\b/));

// proves R-WORK-19
test('given a Review card with no pull request and its line of work on the forge, L2 escalates it at the pull without a workspace and preserves its line of work', () => escalatedAtPull(cardIn(5, COLUMNS.review), { branches: ['rigger-5'] }, /rigger-5/));

// proves R-WORK-5
test('a Review card with one open pull request whose only judge is owner moves to Owner through L2', async () => {
  const workspace = recordingWorkspaces();
  const built = world({ cards: [cardIn(7, COLUMNS.review)], concurrency: 1, forge: { pullRequests: [pullFrom(7, 71)] }, workspace });

  assert.deepEqual(await built.loop.pull(), [{ card: 7, action: 'move', to: 'owner' }]);

  assert.deepEqual(built.decisions.map(({ action }) => action), [{ action: 'move', to: 'owner' }]);
  assert.deepEqual(pulledIn(built), [7]);
  assert.deepEqual(await columnsOf(built.fake), { 7: COLUMNS.owner });
  assert.deepEqual(built.fake.writes(), [{ operation: 'moveItem', args: ['item-1', COLUMNS.owner] }]);
  assert.deepEqual(workspace.asked, []);
});

// proves R-WORK-24
test('given a Review card with no pull request and no line of work on the forge, L3 makes its workspace and dispatches its steps and maker, and the card is in coding while its maker runs', SETTLES_WITHIN, async (t) => {
  const kinds = { change: { ...KINDS.change, provisioning: ['ready'] } };
  const workspace = makingWorkspaces(temporaryDirectory('rigger-review-redo-'));
  const built = world({ cards: [cardIn(8, COLUMNS.review)], concurrency: 1, kinds, provisioning: { ready: { run: 'true', required: true } }, workspace });
  const columnsAtStart = [];

  const pulled = built.loop.pull();
  // Positive: until card 8's stand-in is held, when the board is read as its maker started.
  await positive(() => built.dispatches.holding().includes(8), SETTLES_WITHIN.timeout / 2);
  columnsAtStart.push(await columnsOf(built.fake));
  built.dispatches.releaseAll();
  await pulled;

  assert.deepEqual(workspace.made.map(({ card }) => card), [8]);
  const starts = built.l3Events().filter((event) => event.event === 'dispatch');
  assert.deepEqual(starts.filter((event) => event.step !== undefined).map((event) => event.step), ['ready']);
  assert.equal(starts.at(-1).role, 'engineer', 'the maker\'s dispatch follows the step\'s');
  assert.deepEqual(built.dispatches.started, [8]);
  assert.deepEqual(columnsAtStart, [{ 8: COLUMNS.coding }], 'the board as the maker stand-in was dispatched');
});

// proves R-WORK-24
test('given a Review card the forge holds nothing for, L2 moves it from review to coding when its claim starts, with one transition event under the card naming its cause, before its maker is dispatched', async () => {
  const built = world({ cards: [cardIn(9, COLUMNS.review)], concurrency: 1 });

  const pulled = built.loop.pull();
  // Positive: until card 9's stand-in is held.
  await positive(() => built.dispatches.holding().includes(9));
  const transitions = built.events().filter((event) => event.layer === 'L2' && event.event === 'transition');
  built.dispatches.releaseAll();
  await pulled;

  assert.deepEqual(transitions.map(({ card, from, to, cause }) => ({ card, from, to, cause })), [{ card: 9, from: 'review', to: 'coding', cause: 'redone' }]);
  const moves = built.sequence.filter((step) => step.move !== undefined || step.start !== undefined);
  assert.deepEqual(moves.slice(0, 2).map((step) => (step.move ? `move ${step.column}` : 'start')), [`move ${COLUMNS.coding}`, 'start']);
});

/**
 * A pull over a fake board holding `cards`, through L3's real loop and L2's real next action, with
 * `roles` declared, through a facts call over a forge holding nothing. A pulled card's maker is
 * dispatched through L1 to this file's stand-in agent, first on the PATH L3 hands it, and since
 * the workspace stand-in makes no directory, the maker does not start. Answers the board, the
 * recorded events, and the cards a workspace was asked for.
 */
async function pullWithRoles(cards, roles) {
  const directory = temporaryDirectory('rigger-tier-pull-');
  const sink = openSink({ directory, run: 'r-tier', now: Date.now });
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: cards });
  const settings = { ...config, concurrency: 3 };
  const decide = (card, outcomes, attempt) => nextAction(card, KINDS, undefined, { columns: COLUMNS, roles, provisioning: {}, outcomes, sink, ...attempt });
  const workspace = recordingWorkspaces();
  const built = loop({ config: settings, board: handleOn(fake), decide, facts: factsOverNothing(settings, decide), l2: columnChanges({ config: settings, sink, items: fake.operations }), sink, kill: async () => {}, workspace, judgeDirectory: makingJudgeDirectories(temporaryDirectory('rigger-judge-directories-')), removeDirectories: async () => {}, state: directory, environment: { ...process.env, PATH: agent.first() } });
  const reached = await built.pull().then(() => assert.fail('the stopped pull fulfilled'), (failure) => failure.errors.filter((each) => each.attemptFailures));
  return { fake, reached, events: () => readEvents(directory), asked: workspace.asked };
}

// proves R-LOOP-13
test('given a card carrying two labels the maker role\'s labels maps to two different tiers, the fake board\'s write record holds no move of it, and the stream holds no L3 pull event for it', async () => {
  const roles = { ...config.roles, engineer: { ...config.roles.engineer, labels: { 'tier:high': 'high', 'tier:low': 'standard' } } };
  const conflicted = { ...readyCard(21), labels: ['type:change', 'tier:high', 'tier:low'] };

  const { fake, reached, events, asked } = await pullWithRoles([conflicted, readyCard(22)], roles);

  assert.deepEqual(reached.map(({ card, attemptFailures }) => ({ card, attempts: attemptFailures.map(({ status, code }) => ({ status, code })) })), [
    { card: 22, attempts: [{ status: 'rejected', code: NOT_STARTED }, { status: 'rejected', code: NOT_STARTED }] },
  ]);
  const moved = fake.writes().map(({ args: [id] }) => id);
  assert.ok(!moved.includes((await fake.operations.readItems()).find((item) => item.number === 21).id), JSON.stringify(fake.writes()));
  assert.deepEqual(events().filter((event) => event.layer === 'L3' && event.event === 'pull').map((event) => event.card), [22]);
  assert.deepEqual(asked, [22, 22]);
});

test('L2\'s facts call reads, for an Owner card and for a Coding card holding one open pull request, what it reads for a Review card: the pull request, its comments for its markers, its check states and its mergeable state', async () => {
  const comments = [{ body: 'A comment', createdAt: '2026-10-01T09:00:00Z' }];
  const opened = (number, pull) => ({ ...pullFrom(number, pull), diff: 'diff --git a/x b/x\n', mergeBase: 'b'.repeat(40), comments, mergeable: 'conflicting', checks: { ci: { state: 'failed', creator: null } } });
  const repository = createFakeRepository({ pullRequests: [opened(31, 311), opened(32, 321), opened(33, 331)], rules: [{ context: 'ci', integration_id: null }] });
  const forges = new Map();
  const decide = (card) => {
    forges.set(card.number, card.forge);
    return { action: 'ignore' };
  };
  const cards = [cardIn(31, COLUMNS.review), cardIn(32, COLUMNS.owner), cardIn(33, COLUMNS.coding)];

  const atPull = await factsCall({ config, reads: repository.operations, decide })(cards);
  for (const card of cards) atPull(card);

  const read = (number) => {
    const { stage, pull, comments: held, mergeable, rules, checks } = forges.get(number);
    return { stage, pull: pull.value.number, comments: held.value.map((comment) => comment.body), mergeable: mergeable.value, rules: rules.value, checks: checks.value };
  };
  const expected = (stage, pull) => ({ stage, pull, comments: ['A comment'], mergeable: 'conflicting', rules: [{ context: 'ci', integration_id: null }], checks: { ci: { state: 'failed', creator: null } } });
  assert.deepEqual([read(31), read(32), read(33)], [expected('review', 311), expected('owner', 321), expected('coding', 331)]);
});

// proves R-LOOP-6
test('given a governing coverage ruled insufficient, L2 answers one return comment on the open pull request; once it is posted, a second pass reading the pull request\'s comments answers no further comment', async () => {
  const kinds = { change: { ...KINDS.change, judges: ['reviewer'] } };
  const sha = pullFrom(41, 411).sha;
  const marker = reviewerMarker(41, 411, sha, { coverage: 'insufficient', coverageReason: 'The card asked for two verbs.' });
  const repository = createFakeRepository({ pullRequests: [{ ...pullFrom(41, 411), mergeable: 'mergeable', comments: [marker] }] });
  const sink = { emitter: () => ({ emit: () => {} }) };
  const decide = (card) => nextAction(card, kinds, undefined, { sink });
  const card = cardIn(41, COLUMNS.review);
  const pass = async () => (await factsCall({ config, reads: repository.operations, decide })([card]))(card);

  const first = await pass();
  assert.equal(first.action, 'return', JSON.stringify(first));
  assert.equal(first.pull, 411);
  await repository.postComment(first.pull, first.comment);
  const second = await pass();

  assert.equal(second.action, 'ignore', JSON.stringify(second));
  assert.equal(repository.pull(411).comments.length, 2, 'the return comment was posted once');
});

/** An L5 sink that records nothing, for an answer that records a marker it read. */
const quiet = { emitter: () => ({ emit: () => {} }) };

/** A kind like the world's, judged by the agent judge `reviewer`. */
const REVIEWED = { change: { ...KINDS.change, judges: ['reviewer'] } };

/**
 * A comment holding the reviewer's marker on card `number`'s pull request `pull` at head `sha`
 * and the acceptance `PASSING`, ruling as `ruling` gives.
 */
const reviewerMarker = (number, pull, sha, ruling = {}) => markerComment({ card: number, pull, head: sha, body: PASSING, ...ruling });

// proves R-LOOP-6
test('L3 has L2 post its return comment once, byte for byte, and leaves the card in Review', async () => {
  const number = 63;
  const pull = 631;
  const sha = pullFrom(number, pull).sha;
  const marker = reviewerMarker(number, pull, sha, { coverage: 'insufficient', coverageReason: 'The card asks for two verbs.' });
  const built = world({
    cards: [cardIn(number, COLUMNS.review)], kinds: REVIEWED, concurrency: 1,
    forge: { pullRequests: [{ ...pullFrom(number, pull), mergeable: 'mergeable', comments: [marker] }] },
  });

  assert.deepEqual(await built.loop.pull(), [{ card: number, action: 'return', pull }]);
  const [answer] = built.decisions.map(({ action }) => action);
  assert.equal(built.repository.pull(pull).comments[1].body, answer.comment);
  assert.deepEqual(await columnsOf(built.fake), { [number]: COLUMNS.review });
  assert.deepEqual(built.fake.writes(), []);

  assert.deepEqual(await built.loop.pull(), []);
  assert.equal(built.repository.pull(pull).comments.length, 2);
});

// proves R-ESCALATE-6
test('run records one L2 escalation and settles without pulling that Review card again', async () => {
  const number = 64;
  const pull = 641;
  const marker = reviewerMarker(number, pull, pullFrom(number, pull).sha, { verdict: 'critical', toSound: 'Keep the user files.' });
  const built = world({
    cards: [cardIn(number, COLUMNS.review)], kinds: REVIEWED, concurrency: 1,
    forge: { pullRequests: [{ ...pullFrom(number, pull), mergeable: 'mergeable', comments: [marker] }] },
  });

  assert.deepEqual(await built.loop.run(), [{ card: number, action: 'escalate', category: 'critical', raiser: 'loop', reason: 'reviewer (critical): Keep the user files.', pull, head: pullFrom(number, pull).sha }]);
  assert.deepEqual(pulledIn(built), [number]);
  assert.deepEqual(built.events().filter(({ event }) => event === 'review.escalate').map(({ layer, card, category }) => ({ layer, card, category })), [
    { layer: 'L2', card: number, category: 'critical' },
  ]);
  assert.deepEqual(built.fake.writes(), [{ operation: 'moveItem', args: ['item-1', COLUMNS.owner] }]);
  assert.match(built.repository.held().issues[0].comments[0].body, /card #64.*\(critical\).*\n\nreviewer \(critical\): Keep the user files\./);
  assert.deepEqual(built.repository.held().issues[0].labels, ['type:change', 'rigger:escalated']);
});

test('run leaves out a continuing maker that exits without returning its card to Review', async () => {
  const number = 65;
  const pull = 651;
  const marker = reviewerMarker(number, pull, pullFrom(number, pull).sha, { verdict: 'needs revision', toSound: 'Print a help line.' });
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: [cardIn(number, COLUMNS.review)] });
  let reads = 0;
  const board = handleOn(fake, { beforeRead: () => {
    reads += 1;
    if (reads > 2) throw new Error('the continuing maker was pulled again');
  } });
  const built = world({
    fake, board, cards: [], kinds: REVIEWED, concurrency: 1, answer: () => ({ exit: 1 }),
    forge: { pullRequests: [{ ...pullFrom(number, pull), mergeable: 'mergeable', comments: [marker] }] },
  });

  const running = built.loop.run();
  await positive(() => built.dispatches.holding().includes(number));
  built.dispatches.releaseAll();
  await running;

  assert.deepEqual(built.dispatches.started, [number]);
  assert.deepEqual(await columnsOf(fake), { [number]: COLUMNS.coding });
  assert.equal(reads, 2);
});

/**
 * Pulls once over a board holding `card` alone, under `kinds`, with the forge seeded with `forge`,
 * and checks L2's answer through the facts call over that forge. An Owner card escalates with
 * a comment naming `names`; the Coding card's ordinary refusal leaves everything unchanged.
 * Neither is given a workspace or changes its line of work.
 */
async function refusedOnTheBoard(card, forge, names, kinds = KINDS) {
  const workspace = recordingWorkspaces();
  const built = world({ cards: [card], concurrency: 1, forge, kinds, workspace });
  const before = built.repository.held();

  await built.loop.pull();
  const decide = (each) => nextAction(each, kinds, undefined, { sink: quiet });
  const next = (await factsCall({ config: { ...config, board: { ...config.board, columns: COLUMNS } }, reads: built.repository.operations, decide })([card]))(card);

  const escalates = card.column === COLUMNS.owner;
  assert.equal(next.action, escalates ? 'escalate' : 'refuse', JSON.stringify(next));
  assert.equal(escalates ? next.line : next.card, escalates ? `rigger-${card.number}` : card.number);
  assert.match(next.reason, names);
  for (const { action } of built.decisions) assert.equal(action.action, escalates ? 'escalate' : 'refuse', JSON.stringify(built.decisions));
  assert.deepEqual(built.fake.writes(), escalates ? [{ operation: 'moveItem', args: [card.id ?? 'item-1', COLUMNS.owner] }] : []);
  assert.deepEqual(pulledIn(built), escalates ? [card.number] : []);
  assert.deepEqual(workspace.asked, []);
  if (!escalates) assert.deepEqual(built.repository.held(), before);
  else {
    const after = built.repository.held();
    assert.deepEqual(after.pullRequests, before.pullRequests);
    assert.deepEqual(after.branches, before.branches);
    assert.equal(after.issues[0].comments.length, 1);
    assert.match(after.issues[0].comments[0].body, names);
  }
}

// proves R-WORK-19
test('given an Owner card the forge holds no pull request for, more than one open for, or only its line of work for, L2 escalates it naming what the forge holds and preserves its line of work without a workspace, a row each', async () => {
  await refusedOnTheBoard(cardIn(51, COLUMNS.owner), {}, /no pull request.*rigger-51/);
  await refusedOnTheBoard(cardIn(52, COLUMNS.owner), { pullRequests: [pullFrom(52, 521), pullFrom(52, 522)] }, /#521\b.*#522\b/);
  await refusedOnTheBoard(cardIn(53, COLUMNS.owner), { branches: ['rigger-53'] }, /\brigger-53\b/);
});

// proves R-WORK-19
test('given a Coding card with one open pull request and no marker, its reviewer sound with the pull request mergeable, coverage ruled insufficient, or a critical marker, L2 refuses it as at the base, and nothing moves, is claimed, is given a workspace or changes on the forge, a row each', async () => {
  const sha = pullFrom(54, 541).sha;
  const rows = {
    none: [],
    m1: [reviewerMarker(54, 541, sha)],
    m8: [reviewerMarker(54, 541, sha, { coverage: 'insufficient', coverageReason: 'The card asked for two verbs.' })],
    m10: [reviewerMarker(54, 541, sha, { verdict: 'critical', toSound: 'Never delete the user\'s files.' })],
  };
  for (const [state, comments] of Object.entries(rows)) {
    await refusedOnTheBoard(cardIn(54, COLUMNS.coding), { pullRequests: [{ ...pullFrom(54, 541), mergeable: 'mergeable', comments }] }, /\brigger-54\b/, REVIEWED).catch((failure) => {
      failure.message = `${state}: ${failure.message}`;
      throw failure;
    });
  }
});

/** The kind `spec`, judged by the agent judge `reviewer` and then the owner. */
const OWNED = { spec: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer', 'owner'] } };

/** An acceptance digest other than `PASSING`'s, as an earlier revision of the acceptance would carry. */
const OLD_DIGEST = 'f'.repeat(64);

/** `written`, a marker comment, moved to the acceptance digest `digest`, at `createdAt`. */
const atDigest = (written, digest, createdAt = written.createdAt) => ({ body: written.body.replace(`digest: ${acceptanceDigest(PASSING)}`, `digest: ${digest}`), createdAt });

/** L2's answer for `card`, through its facts call over a forge holding `pullRequests`, under `kinds`. */
async function answeredFromTheForge(card, pullRequests, kinds) {
  const repository = createFakeRepository({ pullRequests });
  const decide = (each) => nextAction(each, kinds, undefined, { roles: config.roles, sink: quiet });
  return (await factsCall({ config, reads: repository.operations, decide })([card]))(card);
}

test('through L2\'s facts call, an Owner card\'s markers are read at the card\'s acceptance digest: a marker at that digest governs, and one at an older digest does not', async () => {
  const sha = pullFrom(61, 611).sha;
  const opened = (comments) => [{ ...pullFrom(61, 611), mergeable: 'mergeable', comments }];
  const reviewer = reviewerMarker(61, 611, sha);
  const owner = { ...reviewerMarker(61, 611, sha), body: reviewerMarker(61, 611, sha).body.replace('role: reviewer\nprovider: claude', 'role: owner'), createdAt: '2026-10-01T11:05:00Z' };
  const card = cardIn(61, COLUMNS.owner);

  assert.deepEqual(await answeredFromTheForge(card, opened([reviewer, owner]), OWNED), { action: 'merge', pull: 611, head: sha });
  const olderOwner = await answeredFromTheForge(card, opened([reviewer, atDigest(owner, OLD_DIGEST)]), OWNED);
  assert.equal(olderOwner.action, 'ignore', JSON.stringify(olderOwner));
  assert.deepEqual(await answeredFromTheForge(card, opened([atDigest(reviewer, OLD_DIGEST), owner]), OWNED), { action: 'move', to: 'review' });
});

// proves R-WORK-5
test('run dispatches the owed reviewer on the pull fired by an Owner to Review move', async () => {
  const number = 66;
  const pull = 661;
  const sha = pullFrom(number, pull).sha;
  const reviewer = atDigest(reviewerMarker(number, pull, sha), OLD_DIGEST);
  const owner = reviewerMarker(number, pull, sha, { role: 'owner', createdAt: '2026-10-01T11:05:00Z' });
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: [cardIn(number, COLUMNS.owner)] });
  let reads = 0;
  const underlying = handleOn(fake);
  const board = {
    readColumns: underlying.readColumns,
    readPriority: async () => {
      reads += 1;
      const answer = await underlying.readPriority();
      return reads > 2 ? { ...answer, items: [] } : answer;
    },
  };
  const built = world({
    fake, board, kinds: OWNED, concurrency: 1,
    forge: { pullRequests: [{ ...pullFrom(number, pull), mergeBase: '7'.repeat(40), mergeable: 'mergeable', comments: [reviewer, owner] }] },
  });

  await built.loop.run();

  assert.deepEqual(await columnsOf(fake), { [number]: COLUMNS.review });
  assert.deepEqual(built.events().filter(({ layer, event, role }) => layer === 'L3' && event === 'dispatch' && role !== undefined).map(({ role }) => role), ['reviewer']);
  assert.equal(reads, 3);
});

test('through L2\'s facts call, a Coding card\'s markers are read at the card\'s acceptance digest: needs revision at that digest continues, and at an older digest only it is refused', async () => {
  const sha = pullFrom(62, 621).sha;
  const revising = reviewerMarker(62, 621, sha, { verdict: 'needs revision', toSound: 'Print the help on stderr.' });
  const opened = (comments) => [{ ...pullFrom(62, 621), mergeable: 'mergeable', comments }];
  const card = cardIn(62, COLUMNS.coding);

  const current = await answeredFromTheForge(card, opened([revising]), REVIEWED);
  assert.equal(current.action, 'continue', JSON.stringify(current));
  assert.equal(current.head, sha);
  const older = await answeredFromTheForge(card, opened([atDigest(revising, OLD_DIGEST)]), REVIEWED);
  assert.equal(older.action, 'refuse', JSON.stringify(older));
});


// proves R-WORK-36
test('closed history in Done null or Backlog causes neither workflow reads nor cleanup while an otherwise identical Owner card cleans', async () => {
  for (const column of [COLUMNS.done, null, 'Backlog', COLUMNS.owner]) {
    let removals = 0;
    const built = world({ cards: [cardIn(96, column)], forge: { pullRequests: [{ ...pullFrom(96, 1096), closed: true }] }, removeDirectories: async () => { removals += 1; } });
    const reads = [];
    for (const operation of ['readBranches', 'readPullRequests']) {
      const read = built.repository.operations[operation];
      built.repository.operations[operation] = async (...args) => { reads.push(operation); return read(...args); };
    }
    const reached = await built.loop.pull();
    if (column === COLUMNS.owner) {
      assert.deepEqual(reads, ['readBranches', 'readPullRequests']);
      assert.equal(removals, 1);
      assert.equal(reached[0].action, 'escalate');
    } else {
      assert.deepEqual(reads, []);
      assert.equal(removals, 0);
      assert.deepEqual(reached, []);
      assert.deepEqual(pulledIn(built), []);
      assert.deepEqual(built.fake.writes(), []);
    }
  }
});

// proves R-WORK-36
test('a failed branch or later closed-history pull read rejects the whole facts snapshot before any cleanup or claim', async () => {
  for (const operation of ['readBranches', 'readPullRequests']) for (const message of ['gh: HTTP 502', 'gh: request timed out']) {
    let removals = 0;
    const built = world({ cards: [cardIn(97, COLUMNS.owner), cardIn(98, COLUMNS.owner)], concurrency: 2,
      forge: { pullRequests: [{ ...pullFrom(97, 1097), closed: true }, { ...pullFrom(98, 1098), closed: true }] },
      removeDirectories: async () => { removals += 1; },
    });
    const read = built.repository.operations[operation];
    const failure = new Error(`${operation}: ${message}`);
    const completed = [];
    built.repository.operations[operation] = async (argument) => {
      if (operation === 'readBranches' || argument === 'rigger-98') throw failure;
      const answer = await read(argument);
      completed.push(answer);
      return answer;
    };
    await assert.rejects(built.loop.pull(), (error) => {
      assert.equal(error.cause, failure);
      assert.match(error.message, /card #/);
      assert.ok(error.message.includes(operation));
      assert.ok(error.message.includes(message));
      return true;
    });
    if (operation === 'readPullRequests') assert.equal(completed[0].closed[0].number, 1097, 'the earlier genuinely eligible prefix was read but not acted on');
    assert.equal(removals, 0);
    assert.deepEqual(pulledIn(built), []);
    assert.deepEqual(built.dispatches.started, []);
    assert.deepEqual(built.fake.writes(), []);
  }
});
