// ABOUTME: L3's loop: the pull trigger that reads the board, claims up to N cards in pull order
// before any await, has L2 move each claimed card, dispatches it, and hands L2 its outcome, and
// the run that fires that trigger again each time a slot frees; the drain trigger; and L3's events.

import { pullOrder } from './pull-order.mjs';

/** N when the config declares none (`ARCHITECTURE.md`, the Engine settings row). */
const DEFAULT_CONCURRENCY = 3;

/**
 * L3's dispatching entry point, over the board `config` names.
 *
 * `board` is L0's handle on it, the forge adapter's read side: `readColumns()` answers the
 * declared columns by key, and `readPriority()` answers the cards with their priority and the
 * declared order, which is what L0 hands L3 for the pull order. `decide` is L2's next action for a
 * card, and `l2` is L2's column changes. `dispatch({ card, kind })` is L1's, injected (the
 * architect's ruling 1, B5), and answers the dispatch's result or throws. `sink` is L5's, and L3
 * writes its own events through it under layer `L3`:
 *
 * - `run.start`, with `concurrency`, the run's N, as a run starts.
 * - `trigger`, with `trigger` naming which fired: `pull` each time the pull trigger fires, before
 *   it reads the board, and `drain` when a pull finds nothing in flight and nothing to pull.
 * - `pull`, under the card, with its `kind`, `queueDepth`, the pullable cards the pull left
 *   waiting, and `inFlight`, the cards in flight with this one. It follows the card's claim and
 *   comes before L2 moves the card, as `ARCHITECTURE.md`, "Failure model", orders a start.
 * - `slot.release`, under the card, as its slot is released, however its work ended.
 *
 * A claim is held in memory from the moment L3 pulls a card until its slot is released, and no
 * longer (the architect's ruling 4, §4): nothing here remembers a card once its slot is free.
 */
export function loop({ config, board, decide, l2, dispatch, sink }) {
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const claims = new Set();

  /**
   * Whether the drain trigger has fired since L3 last claimed a card. Drain fires once per idle
   * period, by the owner's U21 ruling, and several pulls can find the board empty in one.
   */
  let idle = false;

  /** Appends one of L3's events, under `card` where it concerns one. */
  const record = (event, fields, card) => sink.emitter({ layer: 'L3', card }).emit(event, fields);

  /**
   * One claimed card's work: L2's claim move for a card pulled from Ready, the dispatch, and L2's
   * handling of its outcome, handed over unread. The slot is released however it ends, and then
   * `freed` runs, unless the board refused the claim move: a refused claim waits for the next
   * trigger rather than starting another pull at once, by the owner's ruling on #228, so a board
   * refusing every claim cannot keep a run pulling.
   */
  const work = async ({ card, kind, redo, queueDepth, inFlight }, freed) => {
    let claimed = redo;
    try {
      record('pull', { kind, queueDepth, inFlight }, card.number);
      if (!redo) await l2.claimed(card);
      claimed = true;
      const [outcome] = await Promise.allSettled([new Promise((resolve) => resolve(dispatch({ card, kind })))]);
      await l2.settled(card, outcome);
    } finally {
      claims.delete(card.number);
      record('slot.release', {}, card.number);
      if (claimed) await freed();
    }
  };

  /**
   * Fires the pull trigger once: reads the board, claims as many cards as there are free slots,
   * first pulled first, and works each. Every claim is taken in the same synchronous step as the
   * pull order it follows, so no other trigger can claim a card between the two. `freed` runs as
   * each claimed card's slot is released, as `work` says, and that card's work is not over until
   * it settles.
   *
   * Settles once every card it claimed has been worked. A read that fails rejects with the
   * read's own error, and no card is claimed. A card whose work fails is reported in an
   * AggregateError naming how many failed, each failure unchanged in its `errors`.
   */
  const trigger = async (freed = () => {}) => {
    record('trigger', { trigger: 'pull' });
    const columns = await board.readColumns();
    const { items, declared } = await board.readPriority();
    const unclaimed = items.filter((item) => !claims.has(item.number));
    const { pulls } = pullOrder({ items: unclaimed, columns, declared }, decide);
    const claimed = pulls.slice(0, Math.max(0, concurrency - claims.size)).map((pull, index) => {
      claims.add(pull.card);
      const card = unclaimed.find((item) => item.number === pull.card);
      return { ...pull, card, queueDepth: pulls.length - index - 1, inFlight: claims.size };
    });
    if (claimed.length > 0) idle = false;
    if (claims.size === 0 && !idle) {
      idle = true;
      record('trigger', { trigger: 'drain' });
    }
    const failures = (await Promise.allSettled(claimed.map((claim) => work(claim, freed))))
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} of the ${claimed.length} cards this pull claimed failed`);
    }
  };

  return {
    /** Fires the pull trigger once, as `trigger` says. */
    pull: () => trigger(),

    /**
     * Fires the pull trigger, and fires it again each time a slot this run filled is released, so
     * a card freeing its slot lets the next pullable card start while the others still run. A slot
     * freed by a claim move the board refused fires nothing, as `work` says. Ends
     * once every pull it fired has settled, which is once a pull fired on a freed slot claims
     * nothing and no card it claimed is still being worked.
     *
     * A pull that fails stops no other. Once the run has ended, every failed pull is reported in
     * one AggregateError naming how many failed, each pull's own failure unchanged in its `errors`.
     */
    run: async () => {
      record('run.start', { concurrency });
      const failures = [];
      const fire = () => trigger(fire).catch((failure) => {
        failures.push(failure);
      });
      await fire();
      if (failures.length > 0) {
        throw new AggregateError(failures, `${failures.length} of the pulls this run fired failed`);
      }
    },
  };
}
