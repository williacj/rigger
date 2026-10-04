// ABOUTME: L3's loop: the pull trigger that reads the board, claims up to N cards in pull order
// before any await, has L2 move each claimed card, and drives its attempts: L1 makes the workspace,
// L3 dispatches each step L2 names one at a time, then the maker through L1, or attempts the card again as L2
// says, and then the judges L2 names, under the one claim and slot; the run that fires that trigger
// again each time a slot frees; the drain trigger; and L3's events.

import { randomUUID } from 'node:crypto';

import { roleDispatch } from '../execution/role.mjs';
import { dispatch as dispatchOnL1 } from '../execution/run.mjs';
import { stepDispatch } from '../execution/step.mjs';
import { pullOrder } from './pull-order.mjs';

/** N when the config declares none (`ARCHITECTURE.md`, the Engine settings row). */
const DEFAULT_CONCURRENCY = 3;

/**
 * What the loop holds over the board `config` names: N, the claims held
 * in memory, L3's events, the start's kill, and the steps that take a claim, start it and release
 * it. The arguments are `loop`'s, less those only a dispatch reads.
 *
 * `kill` is L1's kill of the process groups a dead engine left, injected. A handle is refused
 * where it is not a function, when the handle is built, because a start that could not kill has
 * nothing to stop it recording and reading over what the dead engine left (`ARCHITECTURE.md`,
 * "Failure model").
 */
function claiming({ config, board, facts, l2, sink, kill }) {
  if (typeof kill !== 'function') throw new Error(`L3 was handed no kill of recorded process groups, so it cannot start: kill is ${typeof kill}`);
  if (typeof facts !== 'function') throw new Error(`L3 was handed no facts call of L2's, so it cannot ask L2 about a card before claiming it: the facts call is ${typeof facts}`);
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
     * Fires the pull trigger's read: records the trigger, reads the board, awaits L2's facts call
     * over the cards no claim holds, and claims as many cards as there are free slots and no more
     * than `limit`, first pulled first, deciding each with the `decide` that call answered. L3
     * reads nothing of that answer but calls it (the architect's ruling 2, P2, on #467). Every
     * claim is taken in the same synchronous step as the pull order it follows, so no other trigger
     * can claim a card between the two. Answers `claims`, each with its pull, its card, L2's answer
     * for it, the `decide` the facts call answered, the pullable cards it left waiting and the cards
     * in flight with it, and `failures`, holding the trigger
     * event's refusal where the sink refused it. A trigger is no start, so its refusal stops
     * nothing: each start still tries its own event, which is what names the cards not started,
     * and the refusal is reported beside theirs. A read that fails, the facts call's included,
     * rejects with the read's own error, and no card is claimed. It first awaits the start's kill,
     * as `killed` says.
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
      const decide = await facts(items.filter((item) => !claims.has(item.number)));
      // Another trigger may have claimed a card while the facts were read, so the cards no claim
      // holds are read again here, in the synchronous step that takes the claims.
      const unclaimed = items.filter((item) => !claims.has(item.number));
      // Each card's answer is kept as L2 gave it at the pull, so L3 asks nothing again to begin.
      const answers = new Map();
      const { pulls } = pullOrder({ items: unclaimed, columns, declared }, (card) => {
        const next = decide(card);
        answers.set(card.number, next);
        return next;
      });
      const taken = pulls.slice(0, Math.max(0, Math.min(limit, concurrency - claims.size))).map((pull, index) => {
        claims.add(pull.card);
        const card = unclaimed.find((item) => item.number === pull.card);
        return { ...pull, card, next: answers.get(pull.card), decide, queueDepth: pulls.length - index - 1, inFlight: claims.size };
      });
      return { claims: taken, failures };
    },

    /**
     * Records a claim's pull event, then hands the claim to L2 with L2's answer for it, unread, and
     * L2 moves the card as its column and that answer ask (the architect's ruling 2, AQ3, on #467). The event follows the claim and comes before
     * the move, as `ARCHITECTURE.md`, "Failure model", orders a start. A pull event the sink
     * refuses is the halt: the start is not made, the claim is released, nothing is recorded for
     * it, since no pull holds a slot in the record, and the failure names the card not started and
     * the sink's error.
     */
    start: async ({ card, kind, next, queueDepth, inFlight }) => {
      try {
        record('pull', { kind, queueDepth, inFlight }, card.number);
      } catch (refusal) {
        claims.delete(card.number);
        throw refused(`card #${card.number} was not started, because the event sink refused to record its pull`, refusal);
      }
      await l2.claimed(card, next);
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

/** Refuses a claim limit that is given and is not a positive whole number, naming it. */
function refuseLimit(limit) {
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    const shown = typeof limit === 'string' ? `'${limit}'` : String(limit);
    throw new Error(`the claim limit must be a positive whole number, and ${shown} is not one`);
  }
}

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
 * declared order, which is what L0 hands L3 for the pull order. `facts` is L2's facts call, which
 * L3 awaits over the cards it read, between its board read and its claims, and which answers the
 * next action L3 asks once for each card at the pull, as `take` says. `decide` is L2's next action
 * for a card, which L3 asks within each attempt as `decide(card, outcomes, { attempt, workspace })`: with the attempt's outcomes after each step, with none once a later
 * attempt's workspace is made, and with L1's failure as `workspace` where it could not be made,
 * `attempt` numbering the attempt from 1. It alone names the steps L3 dispatches, and whether the
 * card is attempted again (the architect's ruling 6, Q-A and Q-D, and ruling 1, A1, on #423). After
 * the maker's settle, L3 asks it again with the facts the settle answered as `forge`, and, while
 * the judges it names are made and run, with `directories` and `judged`, as `attempt` and `judged`
 * say. `l2` is L2's column changes, whose `claimed` takes each claim and whose `settled` takes the
 * maker's outcome alone, and answers what it read of the forge, which L3 reads nothing of. The
 * maker is always the role L2's maker answer names, dispatched through L1, as `dispatchRole` says
 * (the architect's ruling 1, Q1, on #467). `environment` is the environment L3 hands
 * every dispatch it makes, each step's, the maker's and each judge's (ruling 2, AQ1). `ps` and
 * `readTimeout` stand in for L0's own process-table reader and read bound, and L3 hands both to L1
 * unread for every dispatch it makes, where neither is given L0 using its own
 * (ruling 3, AQ7). `workspace(card)` is L1's
 * workspace handle, injected, and
 * answers the attempt's workspace as `{ path }`, with the card's scratch base as `scratch` and the
 * repository it made from as `repository` (ruling 5, P4; the architect's rulings 19 and 21 on
 * #467). `judgeDirectory(card, role, head)` is L1's make of a judge's directory, injected, as
 * `judged` says (the architect's ruling 4's addendum on #467). `state` is the state directory L1
 * records each dispatch's process group in, which L3 hands L1's `dispatch` unread (ruling 10).
 * `kill()` is L1's kill of recorded process groups, injected, and the first call on the handle
 * awaits it before L3 records or reads anything, as `claiming` says. A handle is refused when it
 * is built where `kill` or the facts call is not a function, checked in that order, and then, each
 * after those, where the workspace handle or `judgeDirectory` is not a function, `state` not a
 * non-empty string, or `environment` not an object.
 * `sink` is L5's, and L3 writes its own events through it under layer `L3`:
 *
 * - `run.start`, with `concurrency`, the run's N, as a run starts.
 * - `trigger`, with `trigger` naming which fired: `pull` each time the pull trigger fires, before
 *   it reads the board, and `drain` when a pull finds nothing in flight and nothing to pull, once
 *   per idle period.
 * - `pull`, under the card, with its `kind`, `queueDepth`, the pullable cards the pull left
 *   waiting, and `inFlight`, the cards in flight with this one. It follows the card's claim and
 *   comes before L2 moves the card, as `ARCHITECTURE.md`, "Failure model", orders a start.
 * - `slot.release`, under the card, as its slot is released, however its work ended.
 * - `dispatch`, under its own dispatch id and the card, before anything acts on what it starts, in
 *   one of three kinds:
 *   - a step's, with the `step`'s name and either the `attempt` number, for a step in an attempt's
 *     workspace, or the judge's `role`, for a step in a judge's `head`, before L1 acts on the step
 *     (ruling 1, A8);
 *   - the maker's, with its `role`, its `tier` and the `attempt` number, and no `step`, before the
 *     provider adapter or L1 acts on it (ruling 1, Q10, and ruling 5, on #467);
 *   - a judge's, with its `role` and its `tier`, and neither a `step` nor an `attempt`, before the
 *     provider adapter or L1 acts on it.
 *
 *   One the sink refuses starts nothing, and the failure names the card and the step or the role.
 *
 * A claim is held in memory from the moment L3 pulls a card until its slot is released, and no
 * longer (the architect's ruling 4, §4): nothing here remembers a card once its slot is free.
 */
export function loop({ config, board, decide, facts, l2, sink, kill, workspace, judgeDirectory, state, environment, ps, readTimeout }) {
  const { concurrency, claims, killed, record, refused, take, start, release } = claiming({ config, board, facts, l2, sink, kill });
  if (typeof workspace !== 'function') throw new Error(`L3 was handed no workspace handle of L1's, so it cannot make an attempt's workspace: the workspace handle is ${typeof workspace}`);
  if (typeof judgeDirectory !== 'function') throw new Error(`L3 was handed no judgeDirectory of L1's, so it cannot make a judge's directory: judgeDirectory is ${typeof judgeDirectory}`);
  if (typeof state !== 'string' || state === '') throw new Error(`L3 was handed no state directory for L1's record of process groups, so it cannot dispatch: the state directory is ${JSON.stringify(state)}`);
  if (environment === null || typeof environment !== 'object') throw new Error(`L3 was handed no environment for the dispatches it makes, so it cannot dispatch: the environment is ${environment === null ? 'null' : typeof environment}`);

  /**
   * Whether the drain trigger has fired in this idle period. Drain fires once per idle period, by
   * the owner's U21 ruling, and several pulls can find the board empty in one. A claim ends an
   * idle period, and so does a run's start, since drain fires at a start that finds nothing.
   */
  let idle = false;

  /**
   * Dispatches `step`, as L2's next action names it, for `card`, in the directory at `path`, and
   * settles on its outcome as `Promise.allSettled` records it. L3 allocates the dispatch's id and
   * appends its start, under the id and the card, naming the step and `fields`, the attempt
   * numbered `attempt` for a step in an attempt's workspace, or the judge `role` for one in a
   * judge's `head`, before L1 acts (`ARCHITECTURE.md`, "Failure model" and "Telemetry"). A start
   * the sink refuses starts nothing, and rejects naming the card and the step.
   */
  const dispatchStep = async (card, step, path, fields) => {
    const id = `d-${randomUUID()}`;
    try {
      sink.emitter({ layer: 'L3', card: card.number, dispatch: id }).emit('dispatch', { step: step.name, ...fields });
    } catch (refusal) {
      throw refused(`card #${card.number}'s step \`${step.name}\` was not started, because the event sink refused to record its start`, refusal);
    }
    const [outcome] = await Promise.allSettled([dispatchOnL1({ id, card: card.number, directory: state, sink, ps, readTimeout, ...stepDispatch(step, path, environment) })]);
    return outcome;
  };

  /**
   * Dispatches the role L2's role answer `answer` names, for `card`, with `cwd` as its working
   * directory, `directory` as the dispatch's directory, `reach` the directories it may reach, and
   * the card's scratch base `scratch` and the `repository` L1 made from, each as L1's make answered
   * it, and settles on its outcome as `Promise.allSettled` records it. L3 allocates the dispatch's
   * id and appends its start, under the id and the card, naming the role, its tier and `fields`,
   * the attempt number for a maker, then awaits `roleDispatch` and L1's `dispatch` as one settled
   * unit, so anything the provider adapter runs runs after that start (the architect's ruling 5 on
   * #467). `roleDispatch` is handed the answer unread, the directories, the scratch base and the
   * repository unread (the architect's rulings 19 and 21, and ruling 3, P8), and `environment`. A
   * start the sink refuses starts nothing, and rejects naming the card and the role.
   */
  const dispatchRole = async (card, answer, { cwd, directory, reach, scratch, repository }, fields) => {
    const id = `d-${randomUUID()}`;
    try {
      sink.emitter({ layer: 'L3', card: card.number, dispatch: id }).emit('dispatch', { role: answer.role, tier: answer.tier, ...fields });
    } catch (refusal) {
      throw refused(`card #${card.number}'s role \`${answer.role}\` was not started, because the event sink refused to record its start`, refusal);
    }
    const run = async () => {
      const handed = await roleDispatch({ answer, cwd, directory, scratch, repository, reach, env: environment, sink, id, card: card.number });
      return dispatchOnL1({ id, card: card.number, directory: state, sink, ps, readTimeout, ...handed });
    };
    const [outcome] = await Promise.allSettled([run()]);
    return outcome;
  };

  /**
   * Has L1 make `card`'s workspace for the attempt numbered `number`, and answers it as `{ path,
   * scratch, repository }`, the card's scratch base and repository beside it as L1 answered them,
   * or, where L1 could not make it, L2's answer for that attempt, handed the failure unread.
   */
  const made = async (card, number) => {
    const [outcome] = await Promise.allSettled([new Promise((resolve) => resolve(workspace(card.number)))]);
    if (outcome.status === 'fulfilled') return { path: outcome.value.path, scratch: outcome.value.scratch, repository: outcome.value.repository };
    return { answer: decide(card, [], { attempt: number, workspace: outcome }) };
  };

  /**
   * The attempts at `card`, from `next`, L2's answer for it at the pull, under its
   * one claim. Each attempt has L1 make the workspace, then dispatches each step L2 names, one at a
   * time, handing L2 each outcome unread with the attempt's number and asking it again, until L2
   * names no step. A later attempt asks L2 for its first step once its workspace is made.
   *
   * An answer that dispatches no step is the maker: the role the answer's `maker` names,
   * dispatched through L1 as `dispatchRole` says. That outcome is handed to
   * L2's `settled` unread, and the attempt answers the card, its workspace, the maker's `outcome`
   * and L2's `settled`, each as `Promise.allSettled` records it, neither read here. Where the settle
   * answered facts and L2, asked again with them, names judges, they are dispatched under the same
   * claim, as `judges` says, and the answer also carries them as `judges`. The maker's result is
   * handed to `kept` as soon as the settle answers, before L2 is asked about judges, so a judge's
   * failure, or L2's judge answer throwing, still leaves its caller the maker's result while the
   * attempt rejects with that failure. An answer naming the
   * next attempt has L3 make it; one naming the card stopped fails, naming the card and each
   * attempt's failure, in order. Any other answer stops the attempts, naming the card and what L2
   * answered.
   */
  const attempt = async (card, next, kept) => {
    const failures = [];
    let answer = next;
    for (let number = 1; ; number += 1) {
      const { path, scratch, repository, answer: unmade } = await made(card, number);
      if (unmade !== undefined) {
        answer = unmade;
      } else {
        if (number > 1) answer = decide(card, [], { attempt: number });
        const outcomes = [];
        while (answer.action === 'dispatch' && answer.step !== undefined) {
          outcomes.push(await dispatchStep(card, answer.step, path, { attempt: number }));
          answer = decide(card, [...outcomes], { attempt: number });
        }
      }
      if (answer.action === 'again' && answer.attempt === number + 1) {
        failures.push(answer.failure);
        continue;
      }
      if (answer.action === 'stop') {
        const each = [...failures, answer.failure].map((failure, at) => `attempt ${at + 1}: ${JSON.stringify(failure)}`);
        throw new Error(`card #${card.number} was stopped after ${each.length} attempts, each failing before the maker:\n${each.join('\n')}`);
      }
      if (answer.action !== 'dispatch') {
        throw new Error(`card #${card.number}'s attempt stopped, as L2 answered: ${JSON.stringify(answer)}`);
      }
      const outcome = await dispatchRole(card, answer.maker, { cwd: path, directory: path, reach: [], scratch, repository }, { attempt: number });
      const [settled] = await Promise.allSettled([l2.settled(card, outcome)]);
      const reached = { card: card.number, workspace: path, outcome, settled };
      kept(reached);
      if (settled.status !== 'fulfilled' || settled.value === undefined) return reached;
      // The facts L2's settle answered go back to L2 unread, so one read decides both the move and
      // the judges (the architect's ruling 3, AQ4, on #467).
      const ask = (options) => decide(card, [], { ...options, forge: settled.value });
      const judging = ask({});
      if (judging.action !== 'judge') return reached;
      return { ...reached, judges: await judges(card, judging, ask) };
    }
  };

  /**
   * The judge L2's answer `answer` names as `role`, or nothing where it names none, being no judge
   * answer or one that withholds that judge.
   */
  const named = (answer, role) => (answer.action === 'judge' ? answer.judges.find((judge) => judge.role === role) : undefined);

  /**
   * The judge `judge`, as L2's judge answer names it, of `card`, under the card's one claim, asking
   * L2 again through `ask`. L3 has L1 make the judge's directory through `judgeDirectory`, handed the
   * card, the role and the head SHA L2 named, before any of the judge's dispatches start. Where L1
   * could not make it, L3 hands the failure unread to L2 as the role's in `directories`, and the
   * judge is not dispatched. Otherwise L3 dispatches each step L2 named in the directory's `head`,
   * one at a time, handing L2 the role's outcomes so far unread in `judged` after each, and the judge
   * is not dispatched once L2's answer no longer names it. Then the judge, as L2 last named it, is
   * dispatched with `main` as its working directory, its judge directory as the dispatch's, and
   * `head` as the directory it may reach, each as L1's make answered it, never from L2's answer (the
   * architect's ruling 3, P8, and ruling 4's addendum). Answers `{ role, outcome }`, the judge's
   * outcome as `Promise.allSettled` records it, or nothing for a judge not dispatched.
   */
  const judged = async (card, judge, ask) => {
    const { role } = judge;
    const [made] = await Promise.allSettled([new Promise((resolve) => resolve(judgeDirectory(card.number, role, judge.facts.head)))]);
    if (made.status === 'rejected') {
      ask({ directories: { [role]: made } });
      return undefined;
    }
    const { path, main, head, scratch, repository } = made.value;
    const outcomes = [];
    let current = judge;
    while (outcomes.length < current.steps.length) {
      outcomes.push(await dispatchStep(card, current.steps[outcomes.length], head, { role }));
      current = named(ask({ judged: { [role]: [...outcomes] } }), role);
      if (current === undefined) return undefined;
    }
    return { role, outcome: await dispatchRole(card, current, { cwd: main, directory: path, reach: [head], scratch, repository }, {}) };
  };

  /**
   * Dispatches every judge L2's judge answer `answer` names for `card`, at once, under the card's
   * one claim, as `judged` says, asking L2 again through `ask`, and settles once every one of them
   * has handed back its outcome. Answers the judges dispatched, each `{ role, outcome }`, in the
   * order L2 named them. Where one failed to hand back an outcome, its start refused or L2 answering
   * no action for it, it rejects once every other has, with an AggregateError naming the card and
   * each such judge, carrying the judges dispatched as `judges`, so no judge's outcome is dropped
   * for another's failure.
   */
  const judges = async (card, answer, ask) => {
    const settled = await Promise.allSettled(answer.judges.map((judge) => judged(card, judge, ask)));
    const dispatched = settled.filter((each) => each.status === 'fulfilled' && each.value !== undefined).map((each) => each.value);
    const failed = settled.flatMap((each, at) => (each.status === 'rejected'
      ? [new Error(`card #${card.number}'s judge \`${answer.judges[at].role}\` handed back no outcome: ${each.reason?.message}`, { cause: each.reason })]
      : []));
    if (failed.length > 0) throw Object.assign(new AggregateError(failed, `card #${card.number}'s judges did not all hand back an outcome`), { judges: dispatched });
    return dispatched;
  };

  /**
   * One claimed card's work: its start, then its attempt and L2's handling of the maker's outcome,
   * handed over unread, or, for a card L2 answered with its judges at the pull, those judges alone,
   * with no workspace made and no maker dispatched, asking L2 again through the `decide` the facts
   * call answered. The slot is released however it ends, and then `freed` runs, unless the start
   * was not made: a claim the board refused to move, or whose pull event the sink refused, waits
   * for the next trigger rather than starting another pull at once, by the owner's ruling on
   * #228, so a board refusing every claim, or a sink refusing every event, cannot keep a run
   * pulling. Settles on `{ reached, failure }`: `reached`, what the card answers as `trigger` says,
   * or nothing for a card whose maker never ran and whose work failed; and `failure`, the work's
   * failure and a refused release event, both reported as `released` says, or null where there was
   * neither. A card whose maker ran keeps its maker's result in `reached` though its judges then
   * failed, as `attempt` says. L2's report of a refused transition event passes through unchanged
   * as the work's failure where it comes from the claim; from the maker's settle it comes back in
   * the card's `settled`, as `attempt` says.
   */
  const work = async (claim, freed) => {
    const { card, next, decide: atPull } = claim;
    // Whether the start was made: for a redo as for a Ready card, only once `start` returns.
    let claimed = false;
    let failure = null;
    let reached;
    try {
      await start(claim);
      claimed = true;
      reached = next.action === 'judge'
        ? { card: card.number, judges: await judges(card, next, (options) => atPull(card, [], options)) }
        : await attempt(card, next, (made) => { reached = made; });
    } catch (thrown) {
      failure = thrown;
    }
    failure = released(release, claim, failure);
    if (claimed) await freed();
    return { reached, failure };
  };

  /**
   * Fires the pull trigger once: claims as many cards as there are free slots, as `take` says, and
   * works each. `freed` runs as each claimed card's slot is released, as `work` says, and that
   * card's work is not over until it settles.
   *
   * It claims no more than `limit` cards, N where none is given. Settles once every card it
   * claimed has been worked, on what each card it claimed answers, in one of these shapes:
   *
   * - a card whose maker ran: `{ card, workspace, outcome, settled }`, naming its number, its
   *   workspace's path, the maker's outcome and L2's settle of it, as `attempt` answers them, and
   *   `judges` beside them, each `{ role, outcome }`, where L2 named judges after the settle and
   *   every one dispatched handed back;
   * - a card pulled for its judges alone: `{ card, judges }`, the judges as `judges` answers them,
   *   with no workspace made and no maker dispatched.
   *
   * A card that failed before its maker ran, and a card pulled for its judges alone whose judges
   * failed, answer nothing. A read that fails
   * rejects with the read's own error, and no card is claimed. A card whose work fails, and a trigger event the
   * sink refused, are reported in one AggregateError naming how many failed, each failure
   * unchanged in its `errors`, and carrying as `reached` what every card answered, as the pull
   * would have settled on them, so no card's outcome is dropped for another's failure. A card whose
   * maker ran and whose judges then failed, or for which L2's judge answer threw, is in `reached`
   * with its maker's result and no `judges`, and its failure, carrying the judges that did hand
   * back where there were any, is in `errors`.
   */
  const trigger = async (freed = () => {}, limit = concurrency) => {
    const { claims: claimed, failures } = await take(limit);
    if (claimed.length > 0) idle = false;
    if (claims.size === 0 && !idle) {
      idle = true;
      try {
        record('trigger', { trigger: 'drain' });
      } catch (refusal) {
        failures.push(refused('the event sink refused to record the drain trigger', refusal));
      }
    }
    const worked = await Promise.allSettled(claimed.map((claim) => work(claim, freed)));
    const ended = worked.map((result) => (result.status === 'fulfilled' ? result.value : { failure: result.reason }));
    failures.push(...ended.filter((each) => each.failure !== null).map((each) => each.failure));
    const reached = ended.map((each) => each.reached).filter((each) => each !== undefined);
    if (failures.length > 0) {
      throw Object.assign(new AggregateError(failures, `${failures.length} failures across the ${claimed.length} cards this pull claimed`), { reached });
    }
    return reached;
  };

  return {
    /**
     * Fires the pull trigger once, as `trigger` says, claiming no more than `limit` cards where one
     * is given, which caps the limit at N. A limit that is not a positive whole number is refused,
     * naming it, before the board is read.
     */
    pull: async (limit) => {
      refuseLimit(limit);
      return trigger(() => {}, limit ?? concurrency);
    },

    /**
     * Fires the pull trigger, and fires it again each time a slot this run filled is released, so
     * a card freeing its slot lets the next pullable card start while the others still run. A slot
     * freed by a claim move the board refused fires nothing, as `work` says. Ends
     * once every pull it fired has settled, which is once a pull fired on a freed slot claims
     * nothing and no card it claimed is still being worked.
     *
     * Settles on what every card its pulls answered, in the shapes `trigger` says. A pull that
     * fails stops no other, and its cards are carried in its own failure's `reached`. Once the run has ended, every failed pull is reported in
     * one AggregateError naming how many failed, each pull's own failure unchanged in its `errors`.
     * A start's kill that failed rejects the run with its failure, before `run.start`.
     */
    run: async () => {
      await killed();
      record('run.start', { concurrency });
      idle = false;
      const failures = [];
      const reached = [];
      const fire = () => trigger(fire).then((each) => {
        reached.push(...each);
      }, (failure) => {
        failures.push(failure);
      });
      await fire();
      if (failures.length > 0) {
        throw new AggregateError(failures, `${failures.length} of the pulls this run fired failed`);
      }
      return reached;
    },
  };
}
