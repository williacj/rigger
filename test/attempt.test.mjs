// ABOUTME: Tests L3 driving a card's attempt under one claim: it has L1 make the workspace, dispatches
// each step L2's next action names one at a time, each under an id and a start event of its own,
// halts on a refused append, and reaches the maker, injected or not, only once no required step failed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { COLUMNS, KINDS, boardOf, columnsOf, handleOn } from './loop-world.mjs';

/** The kind every card here carries, listing `steps`, in the order a test gives them. */
const kindListing = (steps) => ({ change: { ...KINDS.change, provisioning: steps } });

/** A step that runs `run` in the workspace, required unless `required` is false. */
const step = (run, required = true) => ({ run, required });

/**
 * A world in which L3's real loop drives cards through the real L2 next action and column
 * changes, L1's real dispatch, a fake board holding `cards` and one real sink, under N
 * `concurrency`. The card's kind lists `steps`, each of which `provisioning` declares. `maker`
 * is the maker L3 is handed, none where it is undefined, and `makerCalls` records each call's
 * argument with the number of events recorded when it was made. The workspace handle makes and
 * answers `workspaces/rigger-<card>` under the world's directory, recording each call in `made`.
 *
 * `refuse(context, event, fields)` answers whether the sink refuses that append, which it then
 * refuses with an error naming it. `asks` counts `decide`'s calls by card, and `settled` records
 * each card `settled` was handed.
 */
function attemptWorld({ cards = [1], concurrency = 1, steps = [], provisioning = {}, maker, refuse = () => false, workspace } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'rigger-attempt-'));
  const fake = boardOf(cards);
  const settings = { ...config, concurrency };
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
  const decide = (card, outcomes) => {
    asks[card.number] = (asks[card.number] ?? 0) + 1;
    return nextAction(card, kinds, undefined, { columns: COLUMNS, provisioning, outcomes, sink });
  };
  const made = [];
  const making = workspace ?? (async (card) => {
    const path = join(directory, 'workspaces', `rigger-${card}`);
    mkdirSync(path, { recursive: true });
    made.push({ card, path });
    return { path };
  });
  const makerCalls = [];
  const injected = maker === undefined ? undefined : async (start) => {
    makerCalls.push({ start, at: events().length });
    return maker(start);
  };
  const built = loop({ config: settings, board: handleOn(fake), decide, l2, dispatch: injected, sink, kill: async () => {}, workspace: making, state: directory });
  return { directory, fake, loop: built, events, asks, made, makerCalls, settled: settledCards };
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
  board: handleOn(boardOf([1])),
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
