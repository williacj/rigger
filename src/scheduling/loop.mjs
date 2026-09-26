// ABOUTME: L3's loop: the pull trigger that reads the board, claims up to N cards in pull order
// before any await, has L2 move each claimed card, dispatches it, and hands L2 its outcome, and
// the run that fires that trigger again each time a slot frees; the drain trigger; L3's events;
// and L3's claim-only call, which claims up to a limit capped at N and dispatches nothing.

import { pullOrder } from './pull-order.mjs';

/** N when the config declares none (`ARCHITECTURE.md`, the Engine settings row). */
const DEFAULT_CONCURRENCY = 3;

/**
 * What the loop and the claim-only call share over the board `config` names: N, the claims held
 * in memory, L3's events, and the steps that take a claim, start it and release it. The arguments
 * are `loop`'s, less the dispatch.
 */
function claiming({ config, board, decide, l2, sink }) {
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const claims = new Set();

  /** Appends one of L3's events, under `card` where it concerns one. */
  const record = (event, fields, card) => sink.emitter({ layer: 'L3', card }).emit(event, fields);

  return {
    concurrency,
    claims,
    record,

    /**
     * Fires the pull trigger's read: records the trigger, reads the board, and claims as many
     * cards as there are free slots and no more than `limit`, first pulled first. Every claim is
     * taken in the same synchronous step as the pull order it follows, so no other trigger can
     * claim a card between the two. Answers each claim with its pull, its card, the pullable cards
     * it left waiting and the cards in flight with it. A read that fails rejects with the read's
     * own error, and no card is claimed.
     */
    take: async (limit) => {
      record('trigger', { trigger: 'pull' });
      const columns = await board.readColumns();
      const { items, declared } = await board.readPriority();
      const unclaimed = items.filter((item) => !claims.has(item.number));
      const { pulls } = pullOrder({ items: unclaimed, columns, declared }, decide);
      return pulls.slice(0, Math.max(0, Math.min(limit, concurrency - claims.size))).map((pull, index) => {
        claims.add(pull.card);
        const card = unclaimed.find((item) => item.number === pull.card);
        return { ...pull, card, queueDepth: pulls.length - index - 1, inFlight: claims.size };
      });
    },

    /**
     * Records a claim's pull event, then has L2 move a card pulled from Ready into Coding. The
     * event follows the claim and comes before the move, as `ARCHITECTURE.md`, "Failure model",
     * orders a start.
     */
    start: async ({ card, kind, redo, queueDepth, inFlight }) => {
      record('pull', { kind, queueDepth, inFlight }, card.number);
      if (!redo) await l2.claimed(card);
    },

    /** Releases `card`'s slot, which ends its claim, and records the release. */
    release: (card) => {
      claims.delete(card.number);
      record('slot.release', {}, card.number);
    },
  };
}

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
 *   it reads the board, and `drain` when a pull finds nothing in flight and nothing to pull, once
 *   per idle period.
 * - `pull`, under the card, with its `kind`, `queueDepth`, the pullable cards the pull left
 *   waiting, and `inFlight`, the cards in flight with this one. It follows the card's claim and
 *   comes before L2 moves the card, as `ARCHITECTURE.md`, "Failure model", orders a start.
 * - `slot.release`, under the card, as its slot is released, however its work ended.
 *
 * A claim is held in memory from the moment L3 pulls a card until its slot is released, and no
 * longer (the architect's ruling 4, §4): nothing here remembers a card once its slot is free.
 */
export function loop({ config, board, decide, l2, dispatch, sink }) {
  const { concurrency, claims, record, take, start, release } = claiming({ config, board, decide, l2, sink });

  /**
   * Whether the drain trigger has fired in this idle period. Drain fires once per idle period, by
   * the owner's U21 ruling, and several pulls can find the board empty in one. A claim ends an
   * idle period, and so does a run's start, since drain fires at a start that finds nothing.
   */
  let idle = false;

  /**
   * One claimed card's work: its start, the dispatch, and L2's handling of its outcome, handed
   * over unread. The slot is released however it ends, and then `freed` runs, unless the board
   * refused the claim move: a refused claim waits for the next trigger rather than starting
   * another pull at once, by the owner's ruling on #228, so a board refusing every claim cannot
   * keep a run pulling.
   */
  const work = async (claim, freed) => {
    const { card, kind } = claim;
    let claimed = claim.redo;
    try {
      await start(claim);
      claimed = true;
      const [outcome] = await Promise.allSettled([new Promise((resolve) => resolve(dispatch({ card, kind })))]);
      await l2.settled(card, outcome);
    } finally {
      release(card);
      if (claimed) await freed();
    }
  };

  /**
   * Fires the pull trigger once: claims as many cards as there are free slots, as `take` says, and
   * works each. `freed` runs as each claimed card's slot is released, as `work` says, and that
   * card's work is not over until it settles.
   *
   * Settles once every card it claimed has been worked. A read that fails rejects with the
   * read's own error, and no card is claimed. A card whose work fails is reported in an
   * AggregateError naming how many failed, each failure unchanged in its `errors`.
   */
  const trigger = async (freed = () => {}) => {
    const claimed = await take(concurrency);
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
      idle = false;
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

/**
 * L3's claim-only call, over the board `config` names, handed everything `loop` is but a
 * dispatch: there is none to hand (the architect's ruling 1, B5). It is a separate export from
 * `loop`, so a verb outside `src/scheduling/` may call it without holding L3's dispatching entry
 * point (the boundary test's rule 8).
 *
 * `claim(limit)` fires the pull trigger's read once and claims as many cards as there are free
 * slots, and no more than `limit` where one is given, which caps the limit at N (the architect's
 * ruling 5, R5-B1). A limit that is not a positive whole number is refused, naming it, before
 * the board is read. It starts each claim as the loop does, recording its pull event before L2
 * moves it, and answers the cards it claimed, as the board read them, first pulled first. It
 * dispatches nothing, and it is no run of the loop, so it fires no drain trigger (review r3-N1).
 *
 * A claim is held in memory until its slot is released, as the loop holds one. Nothing here
 * releases a claim whose card L2 moved, since no work follows it, so calls on one handle never
 * claim a card twice and never together hold more than N. A card whose claim move the board
 * refuses has its slot released, and every such refusal is reported in one AggregateError once
 * the others have moved.
 */
export function claimOnly({ config, board, decide, l2, sink }) {
  const { take, start, release } = claiming({ config, board, decide, l2, sink });
  return {
    claim: async (limit) => {
      if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
        const shown = typeof limit === 'string' ? `'${limit}'` : String(limit);
        throw new Error(`the claim limit must be a positive whole number, and ${shown} is not one`);
      }
      const claimed = await take(limit ?? Infinity);
      const failures = (await Promise.allSettled(claimed.map(async (claim) => {
        try {
          await start(claim);
        } catch (refusal) {
          release(claim.card);
          throw refusal;
        }
      })))
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, `${failures.length} of the ${claimed.length} cards this call claimed failed`);
      }
      return claimed.map((claim) => claim.card);
    },
  };
}
