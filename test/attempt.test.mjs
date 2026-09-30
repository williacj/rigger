// ABOUTME: Tests L3 driving a card's attempt under one claim: it has L1 make the workspace, dispatches
// each step L2's next action names one at a time, each under an id and a start event of its own,
// halts on a refused append, and reaches the maker, injected or not, only once no required step failed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import {
  COLUMNS, KINDS, columnsOf, handleOn, makingWorkspaces, quiesce, readyCard, world,
} from './loop-world.mjs';
import { until } from './process-fixtures.mjs';

// A bound on a test that waits on a real command, so one whose condition never holds fails here
// rather than holding the suite.
const SETTLES_WITHIN = { timeout: 60_000 };

/** The kind every card here carries, listing `steps`, in the order a test gives them. */
const kindListing = (steps) => ({ change: { ...KINDS.change, provisioning: steps } });

/** A step that runs `run` in the workspace, required unless `required` is false. */
const step = (run, required = true) => ({ run, required });

/**
 * A world in which L3's real loop drives cards through the real L2 next action and column
 * changes, L1's real dispatch, a fake board holding `cards` and one real sink, under N
 * `concurrency`. The card's kind lists `steps`, each of which `provisioning` declares, or the
 * function `provisioning` answers for the world's state directory. `maker`
 * is the maker L3 is handed, none where it is undefined, and `makerCalls` records each call's
 * argument with the number of events recorded when it was made. The workspace handle is
 * `workspace`, or one that makes and answers `workspaces/rigger-<card>` under the world's
 * directory, recording each call in `made`. `decide` stands in for L2's next action where it is
 * given, handed the real one; `config` is what L3 and L2's column changes are handed, the live
 * config under N `concurrency` where none is given; and `refuseMoves` has the board refuse every move.
 *
 * `refuse(context, event, fields)` answers whether the sink refuses that append, which it then
 * refuses with an error naming it. `asks` counts `decide`'s calls by card, and `settled` records
 * each card `settled` was handed. `requests` counts the board reads L3 made.
 */
function attemptWorld({
  cards = [1], concurrency = 1, steps = [], provisioning = {}, maker, refuse = () => false, workspace, decide: standIn, settings = { ...config, concurrency }, refuseMoves = false,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rigger-attempt-'));
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: cards.map((number) => readyCard(number)), refuseMoves });
  const real = openSink({ directory, run: 'r-attempt', now: Date.now });
  const sink = {
    emitter: (context) => {
      const emitter = real.emitter(context);
      return {
        emit: (event, fields) => {
          if (refuse(context, event, fields)) throw new Error(`the sink refuses ${context.layer} ${event}`);
          emitter.emit(event, fields);
        },
      };
    },
  };
  const events = () => (existsSync(streamPath(directory)) ? readEvents(directory) : []);
  const settledCards = [];
  const changes = columnChanges({ config: settings, sink, items: fake.operations });
  const l2 = {
    claimed: changes.claimed,
    settled: (card, outcome) => {
      settledCards.push(card.number);
      return changes.settled(card, outcome);
    },
  };
  const asks = {};
  const kinds = kindListing(steps);
  const declared = typeof provisioning === 'function' ? provisioning(directory) : provisioning;
  const l2Answer = (card, outcomes) => nextAction(card, kinds, undefined, { columns: COLUMNS, provisioning: declared, outcomes, sink });
  const decide = (card, outcomes) => {
    asks[card.number] = (asks[card.number] ?? 0) + 1;
    return standIn ? standIn(card, outcomes, l2Answer) : l2Answer(card, outcomes);
  };
  const making = workspace ?? makingWorkspaces(join(directory, 'workspaces'));
  const makerCalls = [];
  const injected = maker === undefined ? undefined : async (start) => {
    makerCalls.push({ start, at: events().length });
    return maker(start);
  };
  const handle = handleOn(fake);
  let requests = 0;
  const board = {
    readColumns: () => { requests += 1; return handle.readColumns(); },
    readPriority: () => { requests += 1; return handle.readPriority(); },
  };
  const built = loop({ config: settings, board, decide, l2, dispatch: injected, sink, kill: async () => {}, workspace: making, state: directory });
  return { directory, fake, loop: built, events, asks, made: making.made, makerCalls, settled: settledCards, requests: () => requests };
}

/** The events of `layer` named `event` among `events`. */
const named = (events, layer, event) => events.filter((each) => each.layer === layer && each.event === event);

/** The index in `events` of L1's `dispatch.start` or `dispatch.end` of the dispatch whose L3 start named `stepName`. */
function l1Index(events, stepName, event) {
  const start = named(events, 'L3', 'dispatch').find((each) => each.step === stepName);
  assert.ok(start, `L3 recorded no start of step ${stepName}: ${JSON.stringify(events)}`);
  return events.findIndex((each) => each.layer === 'L1' && each.event === event && each.dispatch === start.dispatch);
}

/** What `loop` is handed, over a fake board holding card 1, with the kill, workspace and state all valid. */
const handed = () => ({
  config: { ...config, concurrency: 1 },
  board: handleOn(createFakeBoard({ columns: Object.values(COLUMNS), items: [readyCard(1)] })),
  decide: (card) => nextAction(card, KINDS),
  l2: { claimed: async () => {}, settled: async () => {} },
  sink: { emitter: () => ({ emit: () => {} }) },
  kill: async () => {},
  workspace: async () => ({ path: '/nowhere' }),
  state: '/nowhere/.rigger',
});

test('given a workspace handle that is not a function, loop throws when built, naming the handle', () => {
  for (const workspace of [undefined, null, '/a/path', { path: '/a/path' }]) {
    assert.throws(() => loop({ ...handed(), workspace }), /\bworkspace handle\b/, String(workspace));
  }
});

test('given a state directory that is not a non-empty string, loop throws when built, naming the state directory', () => {
  for (const state of [undefined, null, '', 7]) {
    assert.throws(() => loop({ ...handed(), state }), /\bstate directory\b/, String(state));
  }
});

// proves R-PROV-4
test('given a kind listing steps a then b, step b\'s dispatch.start comes after step a\'s dispatch.end in the event stream', async () => {
  const built = attemptWorld({ steps: ['a', 'b'], provisioning: { a: step('true'), b: step('true') } });

  await built.loop.pull();

  const events = built.events();
  const aEnd = l1Index(events, 'a', 'dispatch.end');
  const bStart = l1Index(events, 'b', 'dispatch.start');
  assert.ok(aEnd >= 0 && bStart > aEnd, JSON.stringify(events));
});

// proves R-PROV-4
test('given a kind listing steps c, a, b, their dispatch.start events come in the order c, a, b', async () => {
  const built = attemptWorld({ steps: ['c', 'a', 'b'], provisioning: { a: step('true'), b: step('true'), c: step('true') } });

  await built.loop.pull();

  const events = built.events();
  const order = named(events, 'L3', 'dispatch').map((each) => each.step);
  assert.deepEqual(order, ['c', 'a', 'b']);
  const starts = ['c', 'a', 'b'].map((name) => l1Index(events, name, 'dispatch.start'));
  assert.deepEqual([...starts].sort((x, y) => x - y), starts, JSON.stringify(events));
});

// proves R-PROV-4
test('given a required step exiting non-zero, no later step of that attempt has a dispatch.start', async () => {
  const built = attemptWorld({ steps: ['a', 'b', 'c'], provisioning: { a: step('true'), b: step('exit 3'), c: step('true') } });

  await assert.rejects(built.loop.pull(), (failure) => /#1\b/.test(failure.errors.map((each) => each.message).join('\n')));

  const events = built.events();
  assert.deepEqual(named(events, 'L3', 'dispatch').map((each) => each.step), ['a', 'b']);
  assert.equal(named(events, 'L1', 'dispatch.start').length, 2, JSON.stringify(events));
});

test('given a card\'s attempt, every step\'s dispatch has an id L3 allocated, and no two dispatches in the event stream share one', async () => {
  const built = attemptWorld({ cards: [1, 2], concurrency: 2, steps: ['a', 'b'], provisioning: { a: step('true'), b: step('true') } });

  await built.loop.pull();

  const events = built.events();
  const allocated = named(events, 'L3', 'dispatch').map((each) => each.dispatch);
  const started = named(events, 'L1', 'dispatch.start').map((each) => each.dispatch);
  assert.equal(allocated.length, 4);
  assert.ok(allocated.every((id) => typeof id === 'string' && id !== ''), JSON.stringify(allocated));
  assert.equal(new Set(allocated).size, 4, JSON.stringify(allocated));
  assert.deepEqual([...started].sort(), [...allocated].sort());
});

test('given a card\'s attempt, each step\'s L3 start event, carrying its dispatch id, the card, the step\'s name and the attempt number, precedes that dispatch\'s L1 dispatch.start', async () => {
  const built = attemptWorld({ steps: ['a', 'b'], provisioning: { a: step('true'), b: step('true') } });

  await built.loop.pull();

  const events = built.events();
  const starts = named(events, 'L3', 'dispatch');
  assert.deepEqual(starts.map(({ card, step: name, attempt }) => ({ card, step: name, attempt })), [{ card: 1, step: 'a', attempt: 1 }, { card: 1, step: 'b', attempt: 1 }]);
  for (const start of starts) {
    const l3 = events.indexOf(start);
    const l1 = events.findIndex((each) => each.layer === 'L1' && each.event === 'dispatch.start' && each.dispatch === start.dispatch);
    assert.ok(l1 > l3, JSON.stringify(events));
  }
});

test('given a sink that refuses a step\'s L3 start event, that step\'s command never starts, and the card\'s attempt stops, with the refusal reported naming the card', async () => {
  const built = attemptWorld({
    cards: [4],
    steps: ['a', 'b'],
    provisioning: { a: step('true'), b: step('touch b-ran') },
    maker: async () => ({ exit: 0 }),
    refuse: ({ layer }, event, fields) => layer === 'L3' && event === 'dispatch' && fields.step === 'b',
  });

  await assert.rejects(built.loop.pull(), (failure) => failure.errors.some((each) => /card #4\b/.test(each.message) && /sink refuses L3 dispatch/.test(each.message)));

  const events = built.events();
  assert.equal(existsSync(join(built.directory, 'workspaces', 'rigger-4', 'b-ran')), false, 'step b ran');
  assert.equal(named(events, 'L1', 'dispatch.start').length, 1, JSON.stringify(events));
  assert.deepEqual(built.makerCalls, []);
});

test('given no maker injected, a card whose steps all exit 0 ends with L3 reporting that it reached the maker, naming the card', async () => {
  const built = attemptWorld({ cards: [5], steps: ['a'], provisioning: { a: step('true') } });

  const reached = await built.loop.pull();

  assert.deepEqual(reached.map(({ card }) => card), [5]);
  assert.equal(reached[0].workspace, join(built.directory, 'workspaces', 'rigger-5'));
});

test('given every selected step exits 0 and no maker injected, the card is in the coding column afterwards', async () => {
  const built = attemptWorld({ cards: [5], steps: ['a', 'b'], provisioning: { a: step('true'), b: step('true') } });

  await built.loop.pull();

  assert.deepEqual(await columnsOf(built.fake), { 5: COLUMNS.coding });
});

test('given every selected step exits 0 and no maker injected, the fake board\'s write record holds no move of that card to the review column', async () => {
  const built = attemptWorld({ cards: [5], steps: ['a', 'b'], provisioning: { a: step('true'), b: step('true') } });

  await built.loop.pull();

  assert.deepEqual(built.fake.writes().filter(({ operation, args: [id, column] }) => operation === 'moveItem' && id === 'item-5' && column === COLUMNS.review), []);
});

test('given a step\'s dispatch exits 0 with a later step selected, the event stream holds no L2 transition event for the card between that step\'s dispatch.end and the next step\'s dispatch.start', async () => {
  const built = attemptWorld({ cards: [6], steps: ['a', 'b'], provisioning: { a: step('true'), b: step('true') }, maker: async () => ({ exit: 0 }) });

  await built.loop.pull();

  const events = built.events();
  const between = events.slice(l1Index(events, 'a', 'dispatch.end'), l1Index(events, 'b', 'dispatch.start'));
  assert.ok(between.length > 0, JSON.stringify(events));
  assert.deepEqual(between.filter((each) => each.layer === 'L2' && each.event === 'transition'), []);
});

// proves R-PROV-4
test('given a maker stand-in injected and every required step exiting 0, the stand-in is called once, after the last step\'s dispatch.end', async () => {
  const built = attemptWorld({ cards: [7], steps: ['a', 'b'], provisioning: { a: step('true'), b: step('true') }, maker: async () => ({ exit: 0 }) });

  await built.loop.pull();

  const events = built.events();
  assert.equal(built.makerCalls.length, 1);
  const lastEnd = l1Index(events, 'b', 'dispatch.end');
  assert.ok(lastEnd >= 0 && built.makerCalls[0].at > lastEnd, `the maker was called with ${built.makerCalls[0].at} events recorded: ${JSON.stringify(events)}`);
});

test('the injected maker is handed an object whose keys are exactly card and kind', async () => {
  const built = attemptWorld({ cards: [7], steps: ['a'], provisioning: { a: step('true') }, maker: async () => ({ exit: 0 }) });

  await built.loop.pull();

  assert.deepEqual(Object.keys(built.makerCalls[0].start).sort(), ['card', 'kind']);
  assert.equal(built.makerCalls[0].start.card.number, 7);
  assert.equal(built.makerCalls[0].start.kind, 'change');
});

/** The cards L3 recorded a pull of among `events`. */
const pulled = (events) => named(events, 'L3', 'pull').map((each) => each.card);

test('given four pullable cards and N of 3, L3\'s single pull handed a limit of 1 claims exactly one card', async () => {
  const built = attemptWorld({ cards: [1, 2, 3, 4], concurrency: 3 });

  const reached = await built.loop.pull(1);

  assert.deepEqual(pulled(built.events()), [1]);
  assert.deepEqual(reached.map(({ card }) => card), [1]);
});

test('given four pullable cards and N of 3, L3\'s single pull handed a limit of 5 claims exactly three cards', async () => {
  const built = attemptWorld({ cards: [1, 2, 3, 4], concurrency: 3 });

  await built.loop.pull(5);

  assert.deepEqual(pulled(built.events()), [1, 2, 3]);
});

test('given a limit that is not a positive whole number, loop\'s single pull refuses it with a failure naming the claim limit and the value, before any board request', async () => {
  for (const [limit, shown] of [[0, '0'], [-1, '-1'], [1.5, '1.5'], ['1', "'1'"], [NaN, 'NaN'], [null, 'null']]) {
    const built = attemptWorld({ cards: [1] });

    await assert.rejects(built.loop.pull(limit), (failure) => failure.message.includes('claim limit') && failure.message.includes(shown), String(limit));

    assert.equal(built.requests(), 0, String(limit));
    assert.deepEqual(built.events(), [], String(limit));
  }
});

test('settled is called once for a claimed card whose maker ran, and never for a card whose claim move the board refuses', async () => {
  const moved = attemptWorld({ cards: [1], steps: ['a'], provisioning: { a: step('true') }, maker: async () => ({ exit: 0 }) });
  await moved.loop.pull();
  assert.deepEqual(moved.settled, [1]);

  const refused = attemptWorld({ cards: [2], steps: ['a'], provisioning: { a: step('true') }, maker: async () => ({ exit: 0 }), refuseMoves: true });
  await assert.rejects(refused.loop.pull(), (failure) => failure.errors.some((each) => /card #2's move from ready to coding/.test(each.message)));
  assert.deepEqual(refused.settled, []);
  assert.deepEqual(refused.made, [], 'no workspace was made for a card whose start was not made');
});

test('settled is never called for a card whose steps all exit 0 with no maker injected', async () => {
  const built = attemptWorld({ cards: [3], steps: ['a', 'b'], provisioning: { a: step('true'), b: step('true') } });

  await built.loop.pull();

  assert.deepEqual(built.settled, []);
});

test('for a card selecting no step, L3 asks decide once, at the pull, and the answer carries action dispatch', async () => {
  const answers = [];
  const built = attemptWorld({
    cards: [1], maker: async () => ({ exit: 0 }), decide: (card, outcomes, answer) => { const given = answer(card, outcomes); answers.push(given); return given; },
  });

  await built.loop.pull();

  assert.deepEqual(built.asks, { 1: 1 });
  assert.equal(answers[0].action, 'dispatch');
  assert.equal(built.makerCalls.length, 1);
});

test('for a card selecting two steps, L3 asks decide once at the pull and once after each step\'s outcome', async () => {
  const built = attemptWorld({ cards: [1], steps: ['a', 'b'], provisioning: { a: step('true'), b: step('true') }, maker: async () => ({ exit: 0 }) });

  await built.loop.pull();

  assert.deepEqual(built.asks, { 1: 3 });
});

test('the steps loop dispatches, and whether it dispatches another after an outcome, come only from the next action decide answers', async () => {
  // L2's real answer selects no step here; this decide names one at the pull, and another after its outcome.
  const script = [
    { action: 'dispatch', kind: 'change', step: { name: 'first', run: 'true' } },
    { action: 'dispatch', kind: 'change', step: { name: 'second', run: 'exit 5' } },
    { action: 'dispatch', kind: 'change', maker: 'engineer' },
  ];
  const handedOutcomes = [];
  const built = attemptWorld({
    cards: [1],
    maker: async () => ({ exit: 0 }),
    decide: (card, outcomes = []) => { handedOutcomes.push(outcomes.map((outcome) => outcome.value.exit)); return script[outcomes.length]; },
  });

  await built.loop.pull();

  assert.deepEqual(named(built.events(), 'L3', 'dispatch').map((each) => each.step), ['first', 'second']);
  assert.deepEqual(handedOutcomes, [[], [0], [0, 5]], 'each outcome was handed back unread, a non-zero exit included');
  assert.equal(built.makerCalls.length, 1, 'the maker ran because decide answered it, whatever the second step exited');
});

test('given an l2 built on a config whose kinds list a required step, and a decide built on kinds listing none, no step is dispatched', async () => {
  const { change } = config.kinds;
  assert.ok(change.provisioning.some((name) => config.provisioning[name].required === true), 'the config handed lists a required step for the card\'s kind');
  const built = attemptWorld({ cards: [1], maker: async () => ({ exit: 0 }), settings: { ...config, concurrency: 1 } });

  await built.loop.pull();

  const events = built.events();
  assert.deepEqual(named(events, 'L3', 'dispatch'), []);
  assert.deepEqual(named(events, 'L1', 'dispatch.start'), []);
  assert.equal(built.makerCalls.length, 1);
});

test('columnChanges reads neither kinds nor provisioning', async () => {
  const read = [];
  const settings = new Proxy({ ...config, concurrency: 1 }, {
    get: (target, key) => {
      read.push(key);
      if (key === 'kinds' || key === 'provisioning') throw new Error(`columnChanges read ${String(key)}`);
      return target[key];
    },
  });
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: [readyCard(1)] });
  const changes = columnChanges({ config: settings, sink: { emitter: () => ({ emit: () => {} }) }, items: fake.operations });
  const [card] = (await fake.operations.readPriority()).items;

  await changes.claimed(card);
  await changes.settled({ ...card, column: COLUMNS.coding }, { status: 'fulfilled', value: { exit: 0 } });

  assert.ok(read.includes('board'), JSON.stringify(read));
  assert.deepEqual(read.filter((key) => key === 'kinds' || key === 'provisioning'), []);
});

test('given an optional step whose L1 dispatch.end the sink refuses, the refusal reaches loop\'s caller naming the unrecorded event, the step\'s dispatch and the card, and the event stream does not record it as the optional step\'s failure', async () => {
  let optional;
  const built = attemptWorld({
    cards: [8],
    steps: ['opt'],
    provisioning: { opt: step('exit 1', false) },
    refuse: (context, event, fields) => {
      if (context.layer === 'L3' && event === 'dispatch' && fields.step === 'opt') optional = context.dispatch;
      return context.layer === 'L1' && event === 'dispatch.end' && context.dispatch === optional;
    },
  });

  const failure = await built.loop.pull().then(() => assert.fail('the pull settled'), (thrown) => thrown);

  const said = failure.errors.map((each) => each.message).join('\n');
  assert.match(said, /dispatch\.end/);
  assert.ok(said.includes(optional), said);
  assert.match(said, /card #8\b/);
  assert.deepEqual(built.events().filter((each) => each.event === 'step.failed'), []);
});

test('given a card whose kind selects an optional step followed by a second selected step, with a maker stand-in injected, where the sink refuses the optional step\'s L1 dispatch.end, neither the second step, nor the maker stand-in, nor a second attempt starts', async () => {
  let optional;
  const built = attemptWorld({
    cards: [8],
    steps: ['opt', 'b'],
    provisioning: { opt: step('exit 1', false), b: step('true') },
    maker: async () => ({ exit: 0 }),
    refuse: (context, event, fields) => {
      if (context.layer === 'L3' && event === 'dispatch' && fields.step === 'opt') optional = context.dispatch;
      return context.layer === 'L1' && event === 'dispatch.end' && context.dispatch === optional;
    },
  });

  await assert.rejects(built.loop.pull());

  const events = built.events();
  assert.deepEqual(named(events, 'L3', 'dispatch').map((each) => each.step), ['opt']);
  assert.equal(named(events, 'L1', 'dispatch.start').length, 1);
  assert.deepEqual(built.makerCalls, []);
  assert.equal(built.made.length, 1, 'one attempt made one workspace');
  assert.deepEqual(named(events, 'L3', 'pull').map((each) => each.card), [8]);
});

test('given a step whose command ran and whose record removal L1\'s record refuses, the refusal reaches loop\'s caller naming the card, and neither a later step nor the maker starts', SETTLES_WITHIN, async () => {
  // The step waits until the record names its group, whose leader is its shell, then makes the
  // path the record's next write fills a directory. So L1 shows the record writable and records
  // the entry, and cannot remove it once the step has run. The step's timeout ends it inside the
  // test's own bound where the record never names it.
  const built = attemptWorld({
    cards: [9],
    steps: ['a', 'b'],
    provisioning: (state) => ({
      a: { ...step(`until /usr/bin/grep -q "\\"group\\":$$," '${join(state, 'groups.json')}'; do :; done; mkdir '${join(state, 'groups.json.partial')}'`), timeout: 30_000 },
      b: step('true'),
    }),
    maker: async () => ({ exit: 0 }),
  });

  const failure = await built.loop.pull().then(() => assert.fail('the pull settled'), (thrown) => thrown);

  const said = failure.errors.map((each) => each.message).join('\n');
  assert.match(said, /card #9\b/);
  assert.match(said, /kept the entry/);
  assert.deepEqual(named(built.events(), 'L3', 'dispatch').map((each) => each.step), ['a']);
  assert.deepEqual(built.makerCalls, []);
});

test('given a loop world whose kinds option lists one step for the card\'s kind, and whose workspace stand-in makes the directory it answers, L3 dispatches that step in that directory, as the event stream shows', SETTLES_WITHIN, async (t) => {
  const under = mkdtempSync(join(tmpdir(), 'rigger-attempt-workspaces-'));
  const workspace = makingWorkspaces(under);
  const built = world({ cards: [1], concurrency: 1, kinds: kindListing(['mark']), provisioning: { mark: step('pwd -P > where') }, workspace });

  const pull = built.loop.pull();
  // The step runs as a real command, so the maker's hold is released once it is reached.
  await until(() => built.dispatches.held() > 0, t);
  built.dispatches.releaseAll();
  await pull;

  const [made] = workspace.made;
  const starts = built.events().filter((each) => each.layer === 'L1' && each.event === 'dispatch.start');
  assert.deepEqual(starts.map((each) => each.workspace), [made.path]);
  const l3 = built.events().find((each) => each.layer === 'L3' && each.event === 'dispatch');
  assert.equal(l3.step, 'mark');
  assert.equal(starts[0].dispatch, l3.dispatch);
  assert.equal(readFileSync(join(made.path, 'where'), 'utf8').trim(), realpathSync(made.path));
});

test('given a loop world whose kinds option lists no step, L3 still calls its workspace stand-in once per attempt, and dispatches no step', async () => {
  const calls = [];
  const built = world({ cards: [1, 2], concurrency: 2, workspace: async (card) => { calls.push(card); return { path: `/nowhere/rigger-${card}` }; } });

  const pull = built.loop.pull();
  await quiesce();
  built.dispatches.releaseAll();
  await pull;

  assert.deepEqual([...calls].sort(), [1, 2]);
  assert.deepEqual(built.events().filter((each) => each.layer === 'L1' || (each.layer === 'L3' && each.event === 'dispatch')), []);
  assert.deepEqual([...built.dispatches.started].sort(), [1, 2]);
});

/** Three cards attempted at once, each through steps a and b, which mark the workspace they ran in. */
async function threeAtOnce() {
  const built = attemptWorld({
    cards: [1, 2, 3], concurrency: 3, steps: ['a', 'b'], provisioning: { a: step('touch ran-a'), b: step('touch ran-b') },
  });
  await built.loop.pull();
  return built;
}

// proves R-WORK-12
test('given three cards attempted at once, each card\'s steps run in that card\'s own workspace, and the three workspaces are three different real paths', async () => {
  const built = await threeAtOnce();

  assert.deepEqual(built.made.map(({ card }) => card).sort(), [1, 2, 3]);
  const events = built.events();
  for (const { card, path } of built.made) {
    const named1 = named(events, 'L1', 'dispatch.start').filter((each) => each.card === card);
    assert.equal(named1.length, 2);
    assert.ok(named1.every((each) => each.workspace === path), JSON.stringify(named1));
    assert.ok(existsSync(join(path, 'ran-a')) && existsSync(join(path, 'ran-b')), path);
  }
  assert.equal(new Set(built.made.map(({ path }) => realpathSync(path))).size, 3);
});

// proves R-WORK-12
test('given three cards attempted at once, every dispatch.start in the run names a workspace', async () => {
  const built = await threeAtOnce();

  const starts = named(built.events(), 'L1', 'dispatch.start');
  assert.equal(starts.length, 6);
  assert.ok(starts.every((each) => typeof each.workspace === 'string' && each.workspace !== ''), JSON.stringify(starts));
});

// proves R-WORK-12
test('given three cards attempted at once, no two dispatches recorded in the event stream name one workspace over overlapping intervals', async () => {
  const built = await threeAtOnce();

  const events = built.events();
  const intervals = named(events, 'L1', 'dispatch.start').map((start) => ({
    dispatch: start.dispatch,
    workspace: realpathSync(start.workspace),
    from: events.indexOf(start),
    to: events.findIndex((each) => each.layer === 'L1' && each.event === 'dispatch.end' && each.dispatch === start.dispatch),
  }));
  assert.ok(intervals.every(({ to }) => to >= 0), JSON.stringify(intervals));
  const overlapping = intervals.flatMap((one, index) => intervals.slice(index + 1)
    .filter((other) => other.workspace === one.workspace && one.from < other.to && other.from < one.to)
    .map((other) => [one.dispatch, other.dispatch]));
  assert.deepEqual(overlapping, []);
  // The three cards' dispatches do overlap in time, so the check above is not met by their running one after another.
  const acrossCards = intervals.some((one) => intervals.some((other) => other.workspace !== one.workspace && one.from < other.to && other.from < one.to));
  assert.ok(acrossCards, JSON.stringify(intervals));
});
