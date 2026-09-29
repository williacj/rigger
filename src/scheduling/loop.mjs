// ABOUTME: L3's loop: the pull trigger that reads the board, claims up to N cards in pull order
// before any await, has L2 move each claimed card, dispatches it, and hands L2 its outcome, and
// the run that fires that trigger again each time a slot frees; the drain trigger; L3's events;
// and L3's claim-only call, which claims up to a limit capped at N and dispatches nothing.

import { pullOrder } from './pull-order.mjs';

/** N when the config declares none (`ARCHITECTURE.md`, the Engine settings row). */
const DEFAULT_CONCURRENCY = 3;

/**
 * What the loop and the claim-only call share over the board `config` names: N, the claims held
 * in memory, L3's events, the start's kill, and the steps that take a claim, start it and release
 * it. The arguments are `loop`'s, less the dispatch.
 *
 * `kill` is L1's kill of the process groups a dead engine left, injected. A handle is refused
 * where it is not a function, when the handle is built, because a start that could not kill has
 * nothing to stop it recording and reading over what the dead engine left (`ARCHITECTURE.md`,
 * "Failure model").
 */
function claiming({ config, board, decide, l2, sink, kill }) {
  if (typeof kill !== 'function') throw new Error(`L3 was handed no kill of recorded process groups, so it cannot start: kill is ${typeof kill}`);
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const claims = new Set();
  let killing;

  /**
   * Settles once the start's kill has settled, calling it on this handle's first call and never
   * again, and rejects with its failure on that call and every later one: a kill that failed
   * stops the start, and nothing on this handle then records or reads.
   */
  const killed = () => {
    killing ??= (async () => kill())();
    return killing;
  };

  /**
   * Appends one of L3's events, under `card` where it concerns one. An append the sink refuses
   * throws the sink's own error, and no caller here drops it (`ARCHITECTURE.md`, "Telemetry").
   */
  const record = (event, fields, card) => sink.emitter({ layer: 'L3', card }).emit(event, fields);

  /** The failure L3 reports for an append the sink refused: `sentence`, then the sink's error, kept as the cause. */
  const refused = (sentence, refusal) => new Error(`${sentence}: ${refusal.message}`, { cause: refusal });

  return {
    concurrency,
    claims,
    killed,
    record,
    refused,

    /**
     * Fires the pull trigger's read: records the trigger, reads the board, and claims as many
     * cards as there are free slots and no more than `limit`, first pulled first. Every claim is
     * taken in the same synchronous step as the pull order it follows, so no other trigger can
     * claim a card between the two. Answers `claims`, each with its pull, its card, the pullable
     * cards it left waiting and the cards in flight with it, and `failures`, holding the trigger
     * event's refusal where the sink refused it. A trigger is no start, so its refusal stops
     * nothing: each start still tries its own event, which is what names the cards not started,
     * and the refusal is reported beside theirs. A read that fails rejects with the read's own
     * error, and no card is claimed. It first awaits the start's kill, as `killed` says.
     */
    take: async (limit) => {
      await killed();
      const failures = [];
      try {
        record('trigger', { trigger: 'pull' });
      } catch (refusal) {
        failures.push(refused('the event sink refused to record the pull trigger', refusal));
      }
      const columns = await board.readColumns();
      const { items, declared } = await board.readPriority();
      const unclaimed = items.filter((item) => !claims.has(item.number));
      const { pulls } = pullOrder({ items: unclaimed, columns, declared }, decide);
      const taken = pulls.slice(0, Math.max(0, Math.min(limit, concurrency - claims.size))).map((pull, index) => {
        claims.add(pull.card);
        const card = unclaimed.find((item) => item.number === pull.card);
        return { ...pull, card, queueDepth: pulls.length - index - 1, inFlight: claims.size };
      });
      return { claims: taken, failures };
    },

    /**
     * Records a claim's pull event, then has L2 move a card pulled from Ready into Coding. The
     * event follows the claim and comes before the move, as `ARCHITECTURE.md`, "Failure model",
     * orders a start. A pull event the sink refuses is the halt: the start is not made, the
     * claim is released, nothing is recorded for it, since no pull holds a slot in the record,
     * and the failure names the card not started and the sink's error.
     */
    start: async ({ card, kind, redo, queueDepth, inFlight }) => {
      try {
        record('pull', { kind, queueDepth, inFlight }, card.number);
      } catch (refusal) {
        claims.delete(card.number);
        throw refused(`card #${card.number} was not started, because the event sink refused to record its pull`, refusal);
      }
      if (!redo) await l2.claimed(card);
    },

    /**
     * Releases `card`'s slot, which ends its claim, and records the release. A claim already
     * released, as a refused pull event releases one, holds no slot in the record, so nothing is
     * recorded for it. A release event the sink refuses is reported naming the card.
     */
    release: (card) => {
      if (!claims.delete(card.number)) return;
      try {
        record('slot.release', {}, card.number);
      } catch (refusal) {
        throw refused(`card #${card.number}'s slot was released, and the event sink refused to record it`, refusal);
      }
    },
  };
}

/** The reasons of every rejected result among `settled`, as `Promise.allSettled` answered them. */
const rejections = (settled) => settled.filter((result) => result.status === 'rejected').map((result) => result.reason);

/**
 * Releases `claim`'s slot through `release` once `failure`, or nothing, ended its work, and
 * answers what its caller reports: `failure` as it is, the release's own refusal where there
 * was no failure, or the two in one AggregateError, since neither may hide the other.
 */
function released(release, claim, failure) {
  try {
    release(claim.card);
    return failure;
  } catch (refusal) {
    return failure === null ? refusal : new AggregateError([failure, refusal], `card #${claim.card.number} failed, and its release went unrecorded`);
  }
}

/**
 * L3's dispatching entry point, over the board `config` names.
 *
 * `board` is L0's handle on it, the forge adapter's read side: `readColumns()` answers the
 * declared columns by key, and `readPriority()` answers the cards with their priority and the
 * declared order, which is what L0 hands L3 for the pull order. `decide` is L2's next action for a
 * card, and `l2` is L2's column changes. `dispatch({ card, kind })` is L1's, injected (the
 * architect's ruling 1, B5), and answers the dispatch's result or throws. `kill()` is L1's kill of
 * recorded process groups, injected, and the first call on the handle awaits it before L3
 * records or reads anything, as `claiming` says. `sink` is L5's, and L3 writes its own events
 * through it under layer `L3`:
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
export function loop({ config, board, decide, l2, dispatch, sink, kill }) {
  const { concurrency, claims, killed, record, refused, take, start, release } = claiming({ config, board, decide, l2, sink, kill });

  /**
   * Whether the drain trigger has fired in this idle period. Drain fires once per idle period, by
   * the owner's U21 ruling, and several pulls can find the board empty in one. A claim ends an
   * idle period, and so does a run's start, since drain fires at a start that finds nothing.
   */
  let idle = false;

  /**
   * One claimed card's work: its start, the dispatch, and L2's handling of its outcome, handed
   * over unread. The slot is released however it ends, and then `freed` runs, unless the start
   * was not made: a claim the board refused to move, or whose pull event the sink refused, waits
   * for the next trigger rather than starting another pull at once, by the owner's ruling on
   * #228, so a board refusing every claim, or a sink refusing every event, cannot keep a run
   * pulling. A failure of the work and a refused release event are both reported, as `released`
   * says, and L2's report of a refused transition event passes through unchanged.
   */
  const work = async (claim, freed) => {
    const { card, kind } = claim;
    // Whether the start was made: for a redo as for a Ready card, only once `start` returns.
    let claimed = false;
    let failure = null;
    try {
      await start(claim);
      claimed = true;
      const [outcome] = await Promise.allSettled([new Promise((resolve) => resolve(dispatch({ card, kind })))]);
      await l2.settled(card, outcome);
    } catch (thrown) {
      failure = thrown;
    }
    failure = released(release, claim, failure);
    if (claimed) await freed();
    if (failure !== null) throw failure;
  };

  /**
   * Fires the pull trigger once: claims as many cards as there are free slots, as `take` says, and
   * works each. `freed` runs as each claimed card's slot is released, as `work` says, and that
   * card's work is not over until it settles.
   *
   * Settles once every card it claimed has been worked. A read that fails rejects with the
   * read's own error, and no card is claimed. A card whose work fails, and a trigger event the
   * sink refused, are reported in one AggregateError naming how many failed, each failure
   * unchanged in its `errors`.
   */
  const trigger = async (freed = () => {}) => {
    const { claims: claimed, failures } = await take(concurrency);
    if (claimed.length > 0) idle = false;
    if (claims.size === 0 && !idle) {
      idle = true;
      try {
        record('trigger', { trigger: 'drain' });
      } catch (refusal) {
        failures.push(refused('the event sink refused to record the drain trigger', refusal));
      }
    }
    failures.push(...rejections(await Promise.allSettled(claimed.map((claim) => work(claim, freed)))));
    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} failures across the ${claimed.length} cards this pull claimed`);
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
     * A start's kill that failed rejects the run with its failure, before `run.start`.
     */
    run: async () => {
      await killed();
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
 * dispatch, the start's kill included: there is no dispatch to hand (the architect's ruling 1,
 * B5). It is a separate export from `loop`, so a verb outside `src/scheduling/` may call it
 * without holding L3's dispatching entry point (the boundary test's rule 8).
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
 * the others have moved. So is every event the sink refused: a start not made, as `start`
 * says, a transition L2 reported, passed on unchanged, and a trigger or release event, each
 * beside the others rather than in place of one (`ARCHITECTURE.md`, "Failure model").
 */
export function claimOnly({ config, board, decide, l2, sink, kill }) {
  const { take, start, release } = claiming({ config, board, decide, l2, sink, kill });
  return {
    claim: async (limit) => {
      if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
        const shown = typeof limit === 'string' ? `'${limit}'` : String(limit);
        throw new Error(`the claim limit must be a positive whole number, and ${shown} is not one`);
      }
      const { claims: claimed, failures } = await take(limit ?? Infinity);
      failures.push(...rejections(await Promise.allSettled(claimed.map(async (claim) => {
        try {
          await start(claim);
        } catch (failure) {
          throw released(release, claim, failure);
        }
      }))));
      if (failures.length > 0) {
        throw new AggregateError(failures, `${failures.length} failures across the ${claimed.length} cards this call claimed`);
      }
      return claimed.map((claim) => claim.card);
    },
  };
}
