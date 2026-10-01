// ABOUTME: The harness L3's loop is proven through: the fake board with ready, redo and other
// cards, L0's handle on it, L2's column changes and next action, a held injected dispatch, and
// one sink, wired into a loop, with the helpers that drive a run to its end and stop one mid-dispatch.

import { existsSync, mkdtempSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { loop } from '../src/scheduling/loop.mjs';

/** One kind, selected by one label, in the shape a config's `kinds` takes. */
export const KINDS = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };

/** The columns this repository's config declares, by key, as the read side's column read answers them. */
export const COLUMNS = config.board.columns;

/** A body whose acceptance passes L2's form check under the title `Add a verb`. */
export const PASSING = '## Acceptance\n\n- The verb prints its help.\n';

/**
 * An issue numbered `number` that L2 would dispatch, one kind selecting it and its acceptance
 * passing, in the column displayed as `column`, holding `fieldValues`.
 */
export const cardIn = (number, column, fieldValues) => ({
  type: 'issue', repository: config.repo, number, title: 'Add a verb', body: PASSING, labels: ['type:change'], column, ...(fieldValues && { fieldValues }),
});

/** A ready issue numbered `number` that L2 would dispatch, on a board whose columns are `columns` by key. */
export const readyCard = (number, columns = COLUMNS) => cardIn(number, columns.ready);

/** One turn of the event loop: every step already queued runs before it ends. */
const oneTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * The most turns of the event loop `waitFor` waits for its condition. A judgment, whose premise is
 * a measurement: across three full `npm test` runs with Node 26.5.0 on macOS 27.0 on 2026-10-01, at
 * one-minute loads of 5.9, 12.7 and 14.9 on 12 CPUs, no wait needed more than 2 turns, over 220
 * waits a run. The bound is 500 times that, so a loaded host stretching a wait fails nothing,
 * while a condition that never holds still fails within a moment.
 */
export const WAIT_TURNS = 1_000;

/**
 * Settles once `condition` holds, checked at once and then once per turn of the event loop, and
 * rejects naming the condition once it has not held after `WAIT_TURNS` turns. It reads no clock and
 * sleeps for no time.
 */
export async function waitFor(condition) {
  for (let turns = 0; !condition(); turns += 1) {
    if (turns === WAIT_TURNS) throw new Error(`the condition ${condition} did not hold within ${WAIT_TURNS} turns of the event loop`);
    await oneTurn();
  }
}

/** A function answering whether `promise` has settled, fulfilled or rejected, for a wait to read. */
export function settledOf(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  return () => settled;
}

/**
 * A dispatch that holds every card it is handed until the test releases it, recording each start
 * and the most dispatches held open at once. `answer(card)` is what a released dispatch settles
 * with: a result `{ exit, output }` to return, or an Error to throw.
 */
export function heldDispatch(answer = () => ({ exit: 0, output: '' })) {
  const started = [];
  const open = [];
  let most = 0;
  const dispatch = ({ card }) => new Promise((resolve, reject) => {
    started.push(card.number);
    open.push({
      number: card.number,
      release: () => {
        const given = answer(card);
        if (given instanceof Error) reject(given);
        else resolve(given);
      },
    });
    most = Math.max(most, open.length);
  });
  return {
    dispatch,
    started,
    held: () => open.length,
    /** The numbers of the cards whose dispatches are held now, in the order they started. */
    holding: () => open.map(({ number }) => number),
    most: () => most,
    /** Releases every dispatch held now, each settling as `answer` says. */
    releaseAll: () => open.splice(0).forEach(({ release }) => release()),
    /** Releases the held dispatch of card `number` alone, settling as `answer` says. */
    release: (number) => open.splice(open.findIndex((held) => held.number === number), 1)[0].release(),
  };
}

/**
 * The fake board whose columns are `columns` by key, holding `cards`: each a number, for a ready
 * card L2 would dispatch, or a board item as `cardIn` makes one.
 */
export const boardOf = (cards, columns = COLUMNS) => createFakeBoard({
  columns: Object.values(columns),
  items: cards.map((card) => (typeof card === 'number' ? readyCard(card, columns) : card)),
});

/**
 * L0's handle on `fake`, as L3 reads it: the column read reads the board's columns and answers
 * `columns` by key, as the read side's does for a config declaring them on a board holding them
 * all, and the priority read answers as the read side's
 * `readPriority` does for a config declaring `priority`, where none declared leaves every card's
 * `priority`, `declared` and `options` null. `beforeRead` runs as each priority read begins, and
 * `onRead` sees the items each one answers.
 */
export function handleOn(fake, { columns = COLUMNS, priority, beforeRead = () => {}, onRead = () => {} } = {}) {
  return {
    readColumns: async () => {
      await fake.operations.readColumns();
      return { ...columns };
    },
    readPriority: async () => {
      beforeRead();
      const answer = await fake.operations.readPriority(priority);
      onRead(answer.items);
      return answer;
    },
  };
}

/**
 * L0's handle on `fake`, as `handleOn` makes it with nothing given, but whose column read answers
 * one turn of the event loop later, as a board read slower than the fake's would.
 */
export function readingLater(fake) {
  const handle = handleOn(fake);
  return {
    ...handle,
    readColumns: async () => {
      await oneTurn();
      return handle.readColumns();
    },
  };
}

/**
 * L2's column changes over `fake`, and L3's loop over both under `concurrency` (none declared
 * where it is undefined), for a config whose board declares `columns` by key and whose L0 handle
 * reads priority under `priority`. L2's next action is the real one with freshness injected
 * through its own input: once a card's dispatch has returned in this world, `fresh` says whether
 * L2 has nothing more to do for it, standing in for the verdict marker M5 reads. `board` is L0's
 * handle, and `items` stands in for the board's writes. The sink writes to the state directory
 * `directory`, a new temporary one where none is given, under the run id `run`. A `fresh` given
 * as a function is L2's freshness input itself, answering for each Coding or Review card.
 * `kill` is the start's kill L3 is handed, standing in for L1's kill of recorded groups, and
 * kills nothing where none is given, since no process of this world outlives it.
 *
 * `decide` hands L2's next action the card, the attempt's outcomes so far, `kinds`, the kinds it
 * selects from, `KINDS` where none are given, and `provisioning`, the steps those kinds may list,
 * none where none are given, so a card of this world selects no step unless a test lists one.
 * `workspace` is L1's workspace handle L3 is handed, and where none is given a stand-in answers a
 * path under this world's own temporary directory without creating it, and records nothing.
 * `state` is the state directory L3 hands L1's dispatch, which is `directory`, as in production
 * the stream and L1's record of process groups share one directory.
 *
 * `handed` records every start the dispatch was handed, whole, and `decisions` every next action
 * L2 gave L3, as `{ card, action, pull }`, where `pull` counts the pull triggers fired so far.
 *
 * `sequence` records, in the one order they happened, each board move once the board has made
 * it, as `{ move, column }` with the item's id and the column's display name, each dispatch
 * start, as `{ start }` with the item's id, and each append the sink accepted, as
 * `{ append, layer, card }` with the event's name.
 *
 * L2 and L3 share one sink, whose clock ticks once per event, so no two events share a time.
 * `layers` records the layer of every emitter L3 asks the sink for. `refuseAppends(reason, next)`
 * has the shared sink refuse the next `next` appends, or every append from then on where no
 * count is given, each with an error carrying `reason`, and `acceptAppends()` has it accept
 * again; the sink itself is the real one throughout, and what the two switch is whether an
 * append reaches it.
 */
export function world({
  cards = [1, 2, 3, 4], columns = COLUMNS, priority, fake = boardOf(cards, columns), concurrency, fresh = true, answer, run = 'r-test',
  items = fake.operations, board = handleOn(fake, { columns, priority }), directory = mkdtempSync(join(tmpdir(), 'rigger-loop-')),
  kill = async () => {}, kinds = KINDS, provisioning = {},
  workspace = async (card) => ({ path: join(directory, 'workspaces', `rigger-${card}`) }),
} = {}) {
  const settings = { ...config, board: { ...config.board, columns } };
  delete settings.concurrency;
  if (concurrency !== undefined) settings.concurrency = concurrency;
  const sequence = [];
  // No stream is a stream holding no event: the sink writes the file at its first accepted append.
  const recorded = () => (existsSync(streamPath(directory)) ? readEvents(directory) : []);
  const moving = {
    ...items,
    moveItem: async (id, column) => {
      await items.moveItem(id, column);
      sequence.push({ move: id, column });
    },
  };
  let tick = 0;
  const real = openSink({ directory, run, now: () => (tick += 1) });
  /** Why the sink refuses an append now, or null while it accepts them, and how many more it refuses. */
  let refusing = null;
  let refusals = Infinity;
  const sink = {
    emitter: (context) => {
      const emitter = real.emitter(context);
      return {
        emit: (event, fields) => {
          if (refusing !== null && refusals > 0) {
            refusals -= 1;
            throw new Error(refusing);
          }
          emitter.emit(event, fields);
          sequence.push({ append: event, layer: context.layer, card: context.card });
        },
      };
    },
  };
  const layers = [];
  const l3Sink = {
    emitter: (context) => {
      layers.push(context.layer);
      return sink.emitter(context);
    },
  };
  const l2 = columnChanges({ config: settings, sink, items: moving });
  const returned = new Set();
  const freshness = typeof fresh === 'function' ? fresh : (held) => fresh && returned.has(held.number);
  const decisions = [];
  const pulls = () => recorded().filter((event) => event.run === run && event.trigger === 'pull').length;
  const decide = (card, outcomes) => {
    const action = nextAction(card, kinds, undefined, { columns, fresh: freshness, provisioning, outcomes, sink });
    decisions.push({ card: card.number, action, pull: pulls() });
    return action;
  };
  const dispatches = heldDispatch(answer);
  const handed = [];
  const dispatch = async (start) => {
    handed.push(structuredClone(start));
    sequence.push({ start: start.card.id });
    try {
      return await dispatches.dispatch(start);
    } finally {
      returned.add(start.card.number);
    }
  };
  return {
    fake, l2, dispatches, sequence, layers, handed, decisions, directory,
    /** Has the shared sink refuse the next `next` appends, or every one from now on, each with an error carrying `reason`. */
    refuseAppends: (reason = 'the event sink refuses every append', next = Infinity) => {
      refusing = reason;
      refusals = next;
    },
    /** Has the shared sink accept appends again. */
    acceptAppends: () => { refusing = null; },
    /** Every event the run has recorded so far, in the order recorded. */
    events: recorded,
    /** The events L3 recorded so far, in order. */
    l3Events: () => recorded().filter((event) => event.layer === 'L3'),
    loop: loop({ config: settings, board, decide, l2, dispatch, sink: l3Sink, kill, workspace, state: directory }),
  };
}

/**
 * A workspace stand-in that makes the directory it answers, `rigger-<card>` under `under`, and
 * answers it as L1's workspace handle does, recording in its `made` each card and path it made.
 */
export function makingWorkspaces(under) {
  const made = [];
  const handle = async (card) => {
    const path = join(under, `rigger-${card}`);
    await mkdir(path, { recursive: true });
    made.push({ card, path });
    return { path };
  };
  return Object.assign(handle, { made });
}

/** Each card on `fake` by number, with the display name of the column it is in now. */
export const columnsOf = async (fake) => Object.fromEntries((await fake.operations.readItems()).map((item) => [item.number, item.column]));

/**
 * The most rounds a run is driven before the test gives up on it. A judgment, whose premise is a
 * measurement: with Node 26.5.0 on macOS 27.0 on 2026-09-28, each of the 27 drives and 3 runs to
 * an end in `loop.test.mjs` and `restart.test.mjs` ended within 6 rounds. A round waits on nothing
 * but steps already queued, so a run still going after this many never ends.
 */
export const DRIVEN_ROUNDS = 100;

/**
 * Starts one run of `built`'s loop, and releases every held dispatch each time the loop has made
 * every start it can, until the run ends. Answers the run's own settling, so a run that fails
 * rejects here with its failure unchanged. A run still going after `DRIVEN_ROUNDS` rounds rejects
 * here, naming the dispatches it started.
 */
export async function drive(built) {
  let ended = false;
  const run = built.loop.run().finally(() => {
    ended = true;
  });
  run.catch(() => {});
  for (let round = 0; !ended; round += 1) {
    if (round === DRIVEN_ROUNDS) throw new Error(`the run had not ended after ${DRIVEN_ROUNDS} rounds, having started dispatches ${built.dispatches.started}`);
    await waitFor(() => ended || built.dispatches.held() > 0);
    built.dispatches.releaseAll();
  }
  return run;
}

/**
 * A first engine's run over a new fake board holding ready cards 1, 2 and 3, at concurrency 2,
 * stopped while the dispatches of cards 1 and 2 are unfinished: they are held and never released,
 * so nothing more of that engine reaches the board, which is left with 1 and 2 in the coding
 * column and 3 in the ready column. Its sink writes to the state directory `directory`. Answers
 * the board, the only thing a second engine is to share with the first.
 */
export async function stoppedRun({ directory } = {}) {
  const fake = boardOf([1, 2, 3]);
  const first = world({ fake, concurrency: 2, directory, run: 'r-first' });
  first.loop.run().catch(() => {});
  await waitFor(() => first.dispatches.held() === 2);
  if (first.dispatches.holding().join() !== '1,2') throw new Error(`the first run was not stopped mid-dispatch of cards 1 and 2: ${first.dispatches.holding()}`);
  return fake;
}
