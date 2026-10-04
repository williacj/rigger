// ABOUTME: Tests L3's pull over L2's facts call, driven through the loop world: L3 awaits the call
// before it claims, a card the forge's facts refuse is never claimed, moved or given a workspace,
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
  const l3 = loop({ config: { ...config, concurrency: 1 }, board, decide: (card) => nextAction(card, KINDS, undefined, { roles: config.roles, provisioning: {} }), facts, l2: built.l2, sink: built.sink, kill: async () => {}, workspace: makingWorkspaces(temporaryDirectory('rigger-facts-held-')), judgeDirectory: makingJudgeDirectories(temporaryDirectory('rigger-judge-directories-')), state: built.directory, environment: { ...process.env, PATH: built.agent.first() } });

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
 * L2 refused it at the pull, its reason matching `names`: the write record holds no move of it, the
 * stream holds no L3 pull event for it, no workspace is made for it, and the forge is unchanged.
 */
async function refusedAtPull(card, forge, names) {
  const workspace = recordingWorkspaces();
  const built = world({ cards: [card], concurrency: 1, forge, workspace });
  const before = built.repository.held();

  assert.deepEqual(await built.loop.pull(), []);

  const [decision] = built.decisions;
  assert.equal(decision.action.action, 'refuse', JSON.stringify(decision));
  assert.equal(decision.action.card, card.number);
  assert.match(decision.action.reason, names);
  assert.deepEqual(built.fake.writes(), []);
  assert.deepEqual(pulledIn(built), []);
  assert.deepEqual(workspace.asked, []);
  assert.deepEqual(built.repository.held(), before);
}

// proves R-WORK-19
test('given a Ready card whose line of work the forge holds, L2 refuses it at the pull: no move, no L3 pull event and no workspace for it, and the forge unchanged', () => refusedAtPull(cardIn(1, COLUMNS.ready), { branches: ['rigger-1'] }, /rigger-1/));

// proves R-WORK-19
test('given a Coding card whose line of work the forge holds, L2 refuses it at the pull: no move, no L3 pull event and no workspace for it, and the forge unchanged', () => refusedAtPull(cardIn(2, COLUMNS.coding), { branches: ['rigger-2'] }, /rigger-2/));

// proves R-WORK-19
test('given a Ready, Coding or Review card with a merged pull request from its line of work, L2 refuses it at the pull: no move, no L3 pull event and no workspace for it, and the forge unchanged', async () => {
  for (const column of [COLUMNS.ready, COLUMNS.coding, COLUMNS.review]) await refusedAtPull(cardIn(3, column), { pullRequests: [pullFrom(3, 31, true)] }, /#31\b/);
});

// proves R-WORK-19
test('given a Review card with two open pull requests from its line of work, L2 refuses it at the pull: no move, no L3 pull event and no workspace for it, and the forge unchanged', () => refusedAtPull(cardIn(4, COLUMNS.review), { pullRequests: [pullFrom(4, 41), pullFrom(4, 42)] }, /#41\b.*#42\b/));

// proves R-WORK-19
test('given a Review card with no pull request and its line of work on the forge, L2 refuses it at the pull: no move, no L3 pull event and no workspace for it, and the forge unchanged', () => refusedAtPull(cardIn(5, COLUMNS.review), { branches: ['rigger-5'] }, /rigger-5/));

test('a Review card with one open pull request whose kind\'s only judge is `owner` is ignored', async () => {
  const workspace = recordingWorkspaces();
  const built = world({ cards: [cardIn(7, COLUMNS.review)], concurrency: 1, forge: { pullRequests: [pullFrom(7, 71)] }, workspace });

  assert.deepEqual(await built.loop.pull(), []);

  assert.deepEqual(built.decisions.map(({ action }) => action), [{ action: 'ignore' }]);
  assert.deepEqual(pulledIn(built), []);
  assert.deepEqual(built.fake.writes(), []);
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
  const built = loop({ config: settings, board: handleOn(fake), decide, facts: factsOverNothing(settings, decide), l2: columnChanges({ config: settings, sink, items: fake.operations }), sink, kill: async () => {}, workspace, judgeDirectory: makingJudgeDirectories(temporaryDirectory('rigger-judge-directories-')), state: directory, environment: { ...process.env, PATH: agent.first() } });
  const reached = await built.pull();
  return { fake, reached, events: () => readEvents(directory), asked: workspace.asked };
}

// proves R-LOOP-13
test('given a card carrying two labels the maker role\'s labels maps to two different tiers, the fake board\'s write record holds no move of it, and the stream holds no L3 pull event for it', async () => {
  const roles = { ...config.roles, engineer: { ...config.roles.engineer, labels: { 'tier:high': 'high', 'tier:low': 'standard' } } };
  const conflicted = { ...readyCard(21), labels: ['type:change', 'tier:high', 'tier:low'] };

  const { fake, reached, events, asked } = await pullWithRoles([conflicted, readyCard(22)], roles);

  assert.deepEqual(reached.map(({ card, outcome }) => ({ card, status: outcome.status, code: outcome.reason?.code })), [{ card: 22, status: 'rejected', code: NOT_STARTED }]);
  const moved = fake.writes().map(({ args: [id] }) => id);
  assert.ok(!moved.includes((await fake.operations.readItems()).find((item) => item.number === 21).id), JSON.stringify(fake.writes()));
  assert.deepEqual(events().filter((event) => event.layer === 'L3' && event.event === 'pull').map((event) => event.card), [22]);
  assert.deepEqual(asked, [22]);
});
