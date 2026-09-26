// ABOUTME: The harness L3's loop is proven through: the fake board with ready, redo and other
// cards, L0's handle on it, L2's column changes and next action, a held injected dispatch, and
// one sink, wired into a loop, with the helpers that drive a run to its end and stop one mid-dispatch.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
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

/**
 * Lets every step already queued run to its end. The fake board, L2 and the injected dispatch
 * answer through promises alone, with no timer and no I/O, so once this returns every start the
 * loop could make without a held dispatch returning has been made. It waits on no clock.
 */
export const quiesce = () => new Promise((resolve) => setImmediate(resolve));

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
 * L2's column changes over `fake`, and L3's loop over both under `concurrency` (none declared
 * where it is undefined), for a config whose board declares `columns` by key and whose L0 handle
 * reads priority under `priority`. L2's next action is the real one with freshness injected
 * through its own input: once a card's dispatch has returned in this world, `fresh` says whether
 * L2 has nothing more to do for it, standing in for the verdict marker M5 reads. `board` is L0's
 * handle, and `items` stands in for the board's writes. The sink writes to the state directory
 * `directory`, a new temporary one where none is given, under the run id `run`. A `fresh` given
 * as a function is L2's freshness input itself, answering for each Coding or Review card.
 *
 * `handed` records every start the dispatch was handed, whole, and `decisions` every next action
 * L2 gave L3, as `{ card, action, pull }`, where `pull` counts the pull triggers fired so far.
 *
 * `sequence` records, in the one order they happened, each board move once the board has made
 * it, as `{ move, column }` with the item's id and the column's display name, and each dispatch
 * start, as `{ start }` with the item's id.
 *
 * L2 and L3 share one sink, whose clock ticks once per event, so no two events share a time.
 * `layers` records the layer of every emitter L3 asks the sink for.
 */
export function world({
  cards = [1, 2, 3, 4], columns = COLUMNS, priority, fake = boardOf(cards, columns), concurrency, fresh = true, answer, run = 'r-test',
  items = fake.operations, board = handleOn(fake, { columns, priority }), directory = mkdtempSync(join(tmpdir(), 'rigger-loop-')),
} = {}) {
  const settings = { ...config, board: { ...config.board, columns } };
  delete settings.concurrency;
  if (concurrency !== undefined) settings.concurrency = concurrency;
  const sequence = [];
  const recorded = {
    ...items,
    moveItem: async (id, column) => {
      await items.moveItem(id, column);
      sequence.push({ move: id, column });
    },
  };
  let tick = 0;
  const sink = openSink({ directory, run, now: () => (tick += 1) });
  const layers = [];
  const l3Sink = {
    emitter: (context) => {
      layers.push(context.layer);
      return sink.emitter(context);
    },
  };
  const l2 = columnChanges({ config: settings, sink, items: recorded });
  const returned = new Set();
  const freshness = typeof fresh === 'function' ? fresh : (held) => fresh && returned.has(held.number);
  const decisions = [];
  const pulls = () => readEvents(directory).filter((event) => event.run === run && event.trigger === 'pull').length;
  const decide = (card) => {
    const action = nextAction(card, KINDS, undefined, { columns, fresh: freshness });
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
    /** Every event the run has recorded so far, in the order recorded. */
    events: () => readEvents(directory),
    /** The events L3 recorded so far, in order. */
    l3Events: () => readEvents(directory).filter((event) => event.layer === 'L3'),
    loop: loop({ config: settings, board, decide, l2, dispatch, sink: l3Sink }),
  };
}

/** Each card on `fake` by number, with the display name of the column it is in now. */
export const columnsOf = async (fake) => Object.fromEntries((await fake.operations.readItems()).map((item) => [item.number, item.column]));

/**
 * Starts one run of `built`'s loop, and releases every held dispatch each time the loop has made
 * every start it can, until the run ends. Answers the run's own settling, so a run that fails
 * rejects here with its failure unchanged.
 */
export async function drive(built) {
  let ended = false;
  const run = built.loop.run().finally(() => {
    ended = true;
  });
  run.catch(() => {});
  while (!ended) {
    await quiesce();
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
  await quiesce();
  if (first.dispatches.holding().join() !== '1,2') throw new Error(`the first run was not stopped mid-dispatch of cards 1 and 2: ${first.dispatches.holding()}`);
  return fake;
}
