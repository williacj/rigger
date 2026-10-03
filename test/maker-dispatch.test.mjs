// ABOUTME: Tests L3 dispatching a claimed card's maker through L1 when none is injected: its start
// event, what it hands L1, the environment every dispatch gets, refusals, and the maker's outcome.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, constants as files, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { COLUMNS, KINDS, columnsOf, factsOverNothing, handleOn, makingWorkspaces, readyCard } from './loop-world.mjs';
import { until } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { standInAgent } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

// A bound on a test that waits on real processes, so one whose pull never settles fails here
// rather than holding the suite.
const { 60_000: SETTLES_WITHIN } = BOUNDS;

/** What `loop` is handed, over a fake board holding card 1, with every handle valid. */
const handed = () => ({
  config: { ...config, concurrency: 1 },
  board: handleOn(createFakeBoard({ columns: Object.values(COLUMNS), items: [readyCard(1)] })),
  decide: (card) => nextAction(card, KINDS),
  facts: factsOverNothing({ ...config, concurrency: 1 }, (card) => nextAction(card, KINDS)),
  l2: { claimed: async () => {}, settled: async () => {} },
  sink: { emitter: () => ({ emit: () => {} }) },
  kill: async () => {},
  workspace: async () => ({ path: '/nowhere' }),
  state: '/nowhere/.rigger',
  environment: {},
});

test('given an environment that is not an object, loop throws when built, naming the environment', () => {
  for (const environment of [undefined, null, 'PATH=/bin', 7]) {
    assert.throws(() => loop({ ...handed(), environment }), /\benvironment\b/, String(environment));
  }
});

test('given neither a kill nor an environment, loop throws when built naming the kill, which it checks first', () => {
  const { kill, environment, ...rest } = handed();
  assert.throws(() => loop(rest), (failure) => /\bkill\b/.test(failure.message) && !/\benvironment\b/.test(failure.message));
});

/** The value of the variable set only in the environment a world's loop is handed. */
const MARK = 'set-only-in-the-loop-environment';

/** The card number a line of work under the default topic rule names, or NaN for any other branch. */
const cardOf = (branch) => Number(/^rigger-(\d+)$/.exec(branch)?.[1]);

/**
 * A world in which L3's real loop drives ready `cards` through L2's real next action, given this
 * repository's roles, and real column changes, L1's real dispatch and a fake board, under N
 * `concurrency`, with no maker injected. Each card's kind lists `steps`, as `provisioning`
 * declares them. The maker runs as `agent`, a stand-in agent first on the PATH of the environment
 * the loop is handed, which also sets `RIGGER_STAND_IN_MARK` to `MARK`. Workspaces are plain
 * directories made under the world's own, `workspaces/rigger-<card>`.
 *
 * The forge holds, from a card's line of work, one open pull request once its maker has run where
 * the test set its stand-in to open one, and nothing otherwise: the loop world records the pull
 * request from the maker's outcome, since a plain directory has no `origin` to push to. It answers
 * a turn of the event loop after it is asked.
 *
 * `refuse(context, event, fields)` answers whether the sink refuses that append, which it then
 * refuses naming it; `onAppend(context, event, fields)` runs after each append the sink accepts.
 * `roles` replaces this repository's roles where a test gives them.
 */
function makerWorld({
  cards = [1], concurrency = 1, steps = [], provisioning = {}, refuse = () => false, onAppend = () => {}, roles = config.roles,
} = {}) {
  const agent = standInAgent();
  const directory = temporaryDirectory('rigger-maker-');
  const settings = { ...config, concurrency };
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: cards.map((number) => readyCard(number)) });
  const real = openSink({ directory, run: 'r-maker', now: Date.now });
  const sink = {
    emitter: (context) => {
      const emitter = real.emitter(context);
      return {
        emit: (event, fields) => {
          if (refuse(context, event, fields)) throw new Error(`the sink refuses ${context.layer} ${event}`);
          emitter.emit(event, fields);
          onAppend(context, event, fields);
        },
      };
    },
  };
  const ran = (number) => agent.runs().some((run) => run.card === number);
  // The read answers a turn of the event loop later, as a read of the real forge would, so a pull
  // that settled without awaiting L2's settle would settle before the move it makes.
  const pullRequests = async (branch) => {
    await new Promise((resolve) => { setImmediate(resolve); });
    const number = cardOf(branch);
    const open = agent.act(number, 'engineer')?.pr && ran(number) ? [{ number: 500 + number, head: String(number).padStart(40, 'a'), base: 'main' }] : [];
    return { open, merged: [] };
  };
  const l2 = columnChanges({ config: settings, sink, items: fake.operations, pullRequests });
  const kinds = { change: { ...KINDS.change, provisioning: steps } };
  const decide = (card, outcomes, attempt) => nextAction(card, kinds, undefined, { columns: COLUMNS, roles, provisioning, outcomes, sink, ...attempt });
  const workspaces = join(directory, 'workspaces');
  const environment = { ...process.env, PATH: agent.first(), RIGGER_STAND_IN_MARK: MARK };
  const built = loop({
    config: settings, board: handleOn(fake), decide, facts: factsOverNothing(settings, decide), l2, sink, kill: async () => {}, workspace: makingWorkspaces(workspaces), state: directory, environment,
  });
  const events = () => (existsSync(streamPath(directory)) ? readEvents(directory) : []);
  return { loop: built, fake, agent, events, directory, workspace: (number) => join(workspaces, `rigger-${number}`) };
}

/** The events of `layer` named `event` among `events`. */
const named = (events, layer, event) => events.filter((each) => each.layer === layer && each.event === event);

test('L3 hands a step\'s dispatch the environment loop was handed, as a variable set only there shows', SETTLES_WITHIN, async () => {
  const built = makerWorld({ steps: ['mark'], provisioning: { mark: { run: 'printf %s "$RIGGER_STAND_IN_MARK" > mark', required: true } } });

  await built.loop.pull();

  assert.equal(readFileSync(join(built.workspace(1), 'mark'), 'utf8'), MARK);
});

test('given a claimed card whose steps all pass and no maker injected, L3 appends a dispatch event under a new dispatch id and the card, naming the role and tier and no step, before L1 records the maker\'s dispatch.start', SETTLES_WITHIN, async () => {
  const built = makerWorld({ steps: ['a'], provisioning: { a: { run: 'true', required: true } } });

  await built.loop.pull();

  const events = built.events();
  const starts = named(events, 'L3', 'dispatch');
  assert.equal(starts.length, 2, JSON.stringify(starts));
  const [step, maker] = starts;
  assert.deepEqual({ card: maker.card, role: maker.role, tier: maker.tier, step: maker.step }, { card: 1, role: 'engineer', tier: 'standard', step: undefined });
  assert.ok(typeof maker.dispatch === 'string' && maker.dispatch !== '' && maker.dispatch !== step.dispatch, JSON.stringify(starts));
  const l1 = events.findIndex((each) => each.layer === 'L1' && each.event === 'dispatch.start' && each.dispatch === maker.dispatch);
  assert.ok(l1 > events.indexOf(maker), JSON.stringify(events));
});

test('L3 hands L1 what roleDispatch answered for L2\'s role answer, in the card\'s workspace and under the environment loop was handed, as the stand-in\'s working directory, its prompt and a variable set only in that environment show', SETTLES_WITHIN, async () => {
  const built = makerWorld();

  await built.loop.pull();

  const runs = built.agent.runs();
  assert.equal(runs.length, 1, JSON.stringify(runs));
  const [run] = runs;
  assert.equal(run.cwd, realpathSync(built.workspace(1)));
  assert.match(run.input, /^Rigger dispatched this session, unattended, as the maker for card #1\./);
  assert.match(run.input, /Card #1: Add a verb/);
  assert.equal(run.role, 'engineer');
  assert.deepEqual(run.env, { RIGGER_STAND_IN_MARK: MARK });
  const start = named(built.events(), 'L1', 'dispatch.start').find((each) => each.command === 'claude');
  assert.equal(start?.workspace, realpathSync(built.workspace(1)), JSON.stringify(built.events()));
});

/** Whether `context` and `event` are L3's start of a role's dispatch for card `number`. */
const makerStart = (number) => (context, event, fields) => context.layer === 'L3' && event === 'dispatch' && fields.role !== undefined && context.card === number;

test('given the maker\'s dispatch event refused by the sink, no maker process starts, and the pull\'s failure names the card and the role', SETTLES_WITHIN, async () => {
  const built = makerWorld({ refuse: makerStart(1) });

  const failure = await built.loop.pull().then(() => assert.fail('the pull settled'), (thrown) => thrown);

  const said = failure.errors.map((each) => each.message).join('\n');
  assert.match(said, /card #1\b/);
  assert.match(said, /`engineer`/);
  assert.deepEqual(built.agent.runs(), []);
  assert.deepEqual(named(built.events(), 'L1', 'dispatch.start'), []);
});

test('for a role\'s dispatch, anything the provider adapter reads it reads after L3\'s dispatch event, as a settings file written when that event is appended shows in the stand-in\'s arguments', SETTLES_WITHIN, async () => {
  // The Claude Code adapter carries the workspace's own permission rules across in `--settings`,
  // so a rule written as L3's start is appended reaches the stand-in only if the adapter ran after.
  let built;
  built = makerWorld({
    onAppend: (context, event, fields) => {
      if (!makerStart(1)(context, event, fields)) return;
      mkdirSync(join(built.workspace(1), '.claude'), { recursive: true });
      writeFileSync(join(built.workspace(1), '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }));
    },
  });

  await built.loop.pull();

  const [run] = built.agent.runs();
  const settings = JSON.parse(run.args[run.args.indexOf('--settings') + 1]);
  assert.deepEqual(settings.permissions.allow, ['Bash(npm test)']);
});

test('given roleDispatch rejecting with NOT_STARTED, L3 hands that outcome to L2 unread, and the stream holds L3\'s dispatch event and no L1 dispatch.start for that dispatch', SETTLES_WITHIN, async () => {
  const roles = { ...config.roles, engineer: { ...config.roles.engineer, provider: 'nowhere' } };
  const built = makerWorld({ roles });

  const [reached] = await built.loop.pull();

  assert.equal(reached.outcome.status, 'rejected');
  assert.equal(reached.outcome.reason.code, NOT_STARTED);
  const events = built.events();
  const [start] = named(events, 'L3', 'dispatch');
  assert.equal(start.role, 'engineer');
  assert.deepEqual(events.filter((each) => each.layer === 'L1' && each.dispatch === start.dispatch), []);
  const failed = named(events, 'L2', 'maker.failed');
  assert.deepEqual(failed.map(({ card, class: classed }) => ({ card, class: classed })), [{ card: 1, class: 'environment' }]);
  assert.equal(failed[0].reason, reached.outcome.reason.message);
  assert.deepEqual(built.agent.runs(), []);
});

// proves R-WORK-6
test('given a card whose maker stand-in exits 0 and the fake forge holds an open pull request from its line of work, the card ends in Review', SETTLES_WITHIN, async () => {
  const built = makerWorld();
  built.agent.plan(1, 'engineer', { pr: true });

  await built.loop.pull();

  assert.deepEqual(await columnsOf(built.fake), { 1: COLUMNS.review });
});

test('given a card whose maker stand-in exits 0 and the fake forge holds no pull request, the card ends in Coding, and the pull\'s answer names the card and that no pull request was found', SETTLES_WITHIN, async () => {
  const built = makerWorld();

  const reached = await built.loop.pull();

  assert.deepEqual(await columnsOf(built.fake), { 1: COLUMNS.coding });
  assert.deepEqual(reached.map(({ card, workspace }) => ({ card, workspace })), [{ card: 1, workspace: built.workspace(1) }]);
  assert.equal(reached[0].outcome.value.exit, 0);
  assert.match(reached[0].settled.reason.message, /no open pull request from its line of work rigger-1\b/);
});

test('given a card whose maker stand-in exits non-zero, the card ends in Coding, and the pull\'s answer names the card and the exit code', SETTLES_WITHIN, async () => {
  const built = makerWorld();
  built.agent.plan(1, 'engineer', { exit: 3 });

  const reached = await built.loop.pull();

  assert.deepEqual(await columnsOf(built.fake), { 1: COLUMNS.coding });
  assert.deepEqual(reached.map(({ card, workspace }) => ({ card, workspace })), [{ card: 1, workspace: built.workspace(1) }]);
  assert.equal(reached[0].outcome.value.exit, 3);
});

/**
 * Opens the FIFO at `path` for writing without blocking and closes it at once, which ends a `read`
 * waiting on it; answers whether it could, which it cannot until a reader has it open.
 */
function opened(path) {
  try {
    closeSync(openSync(path, files.O_WRONLY | files.O_NONBLOCK));
    return true;
  } catch (failure) {
    if (failure.code === 'ENXIO') return false;
    throw failure;
  }
}

/**
 * Cards 1 and 2 claimed in one pull, where the sink refuses card 1's maker dispatch event while
 * card 2's maker runs: card 2's stand-in holds as `plan` says, and card 1 is held at a step, a
 * `read` on a FIFO, until card 2's stand-in holds, so card 1's refusal comes while card 2's maker
 * runs. It answers once card 1's slot is released, which is once its refusal has done all it does:
 * the world, what the refusal saw of card 2's stand-in as `atRefusal`, and the pull, settled on its
 * failure and the L2 transition events recorded in the step its rejection is handled, once the
 * test releases card 2.
 */
async function refusedWhileTwoRuns(t, plan) {
  const gate = join(temporaryDirectory('rigger-maker-gate-'), 'gate');
  execFileSync('/usr/bin/mkfifo', [gate]);
  let atRefusal;
  let built;
  built = makerWorld({
    cards: [1, 2],
    concurrency: 2,
    steps: ['gate'],
    provisioning: { gate: { run: `case "$PWD" in */rigger-1) read _ < '${gate}' || true ;; esac`, required: true } },
    refuse: (context, event, fields) => {
      if (!makerStart(1)(context, event, fields)) return false;
      atRefusal = { held: built.agent.held(2), runs: built.agent.runs().filter((run) => run.card === 2).length, wrote: built.agent.wrote(2) };
      return true;
    },
  });
  built.agent.plan(2, 'engineer', plan);
  let settled = false;
  const pull = built.loop.pull().then(() => assert.fail('the pull settled'), (thrown) => ({ failure: thrown, transitions: named(built.events(), 'L2', 'transition') }));
  pull.then(() => { settled = true; }, () => { settled = true; });
  await until(() => built.agent.held(2) || settled, t);
  assert.ok(built.agent.held(2), `card 2's maker never held: ${JSON.stringify(built.events())}`);
  await until(() => opened(gate) || settled, t);
  await until(() => atRefusal !== undefined || settled, t);
  assert.deepEqual(atRefusal, { held: true, runs: 1, wrote: false }, 'card 1\'s refusal came while card 2\'s maker held');
  // Card 1's slot is released only once its work has failed, after whatever its refusal did.
  await until(() => named(built.events(), 'L3', 'slot.release').some((event) => event.card === 1) || settled, t);
  return { built, atRefusal, pull };
}

test('given two cards claimed in one pull, where the sink refuses card 1\'s maker dispatch event while card 2\'s maker runs, card 2\'s outcome reaches L2 before the pull settles and card 2 moves as it says, and the pull\'s failure carries card 2\'s outcome', SETTLES_WITHIN, async (t) => {
  const { built, pull } = await refusedWhileTwoRuns(t, { hold: true, write: true, pr: true });
  assert.equal(built.agent.alive(2), true, 'card 2\'s stand-in was killed after card 1\'s refusal');
  built.agent.release(2);
  const { failure, transitions } = await pull;

  assert.ok(transitions.some((each) => each.card === 2 && each.to === 'review'), JSON.stringify(transitions));
  assert.deepEqual(await columnsOf(built.fake), { 1: COLUMNS.coding, 2: COLUMNS.review });
  assert.deepEqual(failure.reached.map(({ card, workspace }) => ({ card, workspace })), [{ card: 2, workspace: built.workspace(2) }]);
  assert.equal(failure.reached[0].outcome.value.exit, 0);
});

test('in that pull, card 2\'s maker process is not killed by card 1\'s refusal: holding when the refusal came, its stand-in writes a file once released after it', SETTLES_WITHIN, async (t) => {
  const { built, pull } = await refusedWhileTwoRuns(t, { hold: true, write: true });
  assert.equal(built.agent.alive(2), true, 'card 2\'s stand-in was killed after card 1\'s refusal');
  built.agent.release(2);
  const { failure } = await pull;

  assert.equal(built.agent.wrote(2), true, JSON.stringify(failure.reached));
  assert.equal(failure.reached[0]?.outcome.value?.exit, 0, JSON.stringify(failure.reached));
});
