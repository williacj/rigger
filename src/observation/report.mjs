// ABOUTME: L5's report: L0's, L1's, L2's, L3's and L4's signals and marker dispatch checks derived
// from one state directory's event stream.

import { existsSync } from 'node:fs';

import { readEvents, streamPath } from './sink.mjs';

/** Milliseconds in an hour: the unit throughput is counted per, and a duration is printed in. */
export const HOUR = 3_600_000;

/** `events` grouped by run, each run's events in line order, the runs in the order each first appears. */
function byRun(events) {
  const runs = new Map();
  for (const event of events) {
    if (!runs.has(event.run)) runs.set(event.run, []);
    runs.get(event.run).push(event);
  }
  return runs;
}

/**
 * L0's substrate fault rate, for the forge and for git, per run in the order each run first
 * appears and across the stream: `faults` of `calls`. `calls` is the L0 `call.end` events whose
 * `system` is that system, excluding none; `faults` is those whose `outcome` is `failed` or
 * `timed-out`. Beyond the `layer` and `event` that select a `call.end`, it reads `run`, `system`
 * and `outcome`, and no other event or field.
 */
function l0Signals(events) {
  const rate = (recorded, system) => {
    const calls = recorded.filter((event) => event.layer === 'L0' && event.event === 'call.end' && event.system === system);
    return { faults: calls.filter((event) => ['failed', 'timed-out'].includes(event.outcome)).length, calls: calls.length };
  };
  const rates = (recorded) => ({ forge: rate(recorded, 'forge'), git: rate(recorded, 'git') });
  return { runs: [...byRun(events)].map(([run, recorded]) => ({ run, ...rates(recorded) })), stream: rates(events) };
}

/**
 * L1's signals per run, in the order each run first appears, and across the stream.
 *
 * - **Execution duration:** each L1 `dispatch.end`'s `dispatch`, `card` where it carries one, and
 *   `ms`. The stream's figure is the count of those ends, each listed under its run.
 * - **Survivor rate:** `killed` of `of`. `of` is the L1 `dispatch.end` events, less those carrying
 *   `reason`, which L1 records where it got no result for the command. `killed` is those whose id an
 *   L0 `survivor.killed` or `group.killed` carries as its `dispatch`, anywhere in the stream; a kill
 *   naming no dispatch, null or absent alike, is counted nowhere.
 * - **Attempts:** work claims that dispatched, across the stream, with redos after an
 *   interruption counted and named apart from first attempts.
 */
function l1Signals(events) {
  const ends = (recorded) => recorded.filter((event) => event.layer === 'L1' && event.event === 'dispatch.end');
  const killed = new Set(events
    .filter((event) => event.layer === 'L0' && ['survivor.killed', 'group.killed'].includes(event.event) && event.dispatch != null)
    .map((event) => event.dispatch));
  const survivors = (recorded) => {
    const counted = ends(recorded).filter((event) => event.reason === undefined);
    return { killed: counted.filter((event) => killed.has(event.dispatch)).length, of: counted.length };
  };
  const runs = [...byRun(events)].map(([run, recorded]) => ({
    run, durations: ends(recorded).map(({ dispatch, card, ms }) => ({ dispatch, card, ms })), survivors: survivors(recorded),
  }));
  return { runs, stream: { ended: ends(events).length, survivors: survivors(events), ...attempts(events) } };
}

/** Whether `event` is a host fault L2 recorded under a card: `R-RECORD-2`'s "how often a host fault interrupted it". */
const hostFault = (event) => event.layer === 'L2' && event.card != null && (['maker.failed', 'judge.withheld'].includes(event.event)
  || (event.event === 'attempt.failed' && event.class === 'environment' && event.maker === undefined));

/**
 * The work claims among one run's events. A claim of a card runs from an L3 `pull` under it to its
 * next, and is a work claim where no L3 `merge.start` under the card falls within it. Only L3's
 * `dispatch` says it did something, and only its own run's `slot.release` says it was not interrupted.
 */
function workClaims(recorded) {
  const current = new Map();
  const claims = [];
  for (const event of recorded) {
    if (event.layer !== 'L3' || event.card == null) continue;
    if (event.event === 'pull') {
      const claim = { pull: event, merging: false, didSomething: false, interrupted: true };
      current.set(event.card, claim);
      claims.push(claim);
    }
    const claim = current.get(event.card);
    if (!claim) continue;
    if (event.event === 'merge.start') claim.merging = true;
    if (event.event === 'dispatch') claim.didSomething = true;
    if (event.event === 'slot.release') claim.interrupted = false;
  }
  return claims.filter((claim) => !claim.merging);
}

/** First attempts and redos, in stream line order, as "Redos after an interruption" defines them. */
function attempts(events) {
  const claims = new Map([...byRun(events).values()].flatMap(workClaims).map((claim) => [claim.pull, claim]));
  const previous = new Map();
  const redos = [];
  let firstAttempts = 0;
  for (const event of events) {
    const claim = claims.get(event);
    if (!claim?.didSomething) continue;
    const earlier = previous.get(event.card);
    if (earlier && earlier.pull.run !== event.run && earlier.interrupted) redos.push({ card: event.card, run: event.run });
    else firstAttempts += 1;
    previous.set(event.card, claim);
  }
  return { firstAttempts, redos };
}

/** Distinct cards escalated by L2 and pulled by L3, counted independently over the given span. */
function escalationsIn(recorded) {
  const escalations = recorded.filter((event) => event.layer === 'L2' && event.event === 'review.escalate' && event.card != null);
  const pulls = recorded.filter((event) => event.layer === 'L3' && event.event === 'pull' && event.card != null);
  return {
    escalated: new Set(escalations.map((event) => event.card)).size, pulled: new Set(pulls.map((event) => event.card)).size,
    entries: escalations.map(({ card, category, raiser, reason, destination }) => ({ card, category, raiser, reason, destination })),
  };
}

/** The one rounds derivation: distinct head/digest pairs per card over all L2 marker reads. */
function roundsPerCard(events) {
  const cards = new Map();
  const kinds = new Map();
  for (const event of events) {
    if (event.layer === 'L3' && event.event === 'pull' && event.card != null && event.kind != null) kinds.set(event.card, event.kind);
    if (event.layer !== 'L2' || event.event !== 'marker.read' || event.card == null) continue;
    if (!cards.has(event.card)) cards.set(event.card, new Set());
    cards.get(event.card).add(JSON.stringify([event.head, event.digest]));
  }
  return [...cards].map(([card, pairs]) => ({ card, kind: kinds.get(card) ?? null, rounds: pairs.size }));
}

/**
 * L2's host faults per run, in the order each run first appears, and across the stream: `faults`
 * of `claims`. `faults` counts each `maker.failed`, each `judge.withheld`, and each
 * `attempt.failed` carrying `class: 'environment'` and no `maker`, under a card; one carrying
 * `maker` records the fault its `maker.failed` already counts. `claims` is the work claims, by
 * `run` and `card`, so the stream's is the sum of its runs'. Escalations count distinct cards
 * independently in each span; rounds read the whole stream once through roundsPerCard.
 */
function l2Signals(events) {
  const runs = [...byRun(events)].map(([run, recorded]) => ({
    run, hostFaults: { faults: recorded.filter(hostFault).length, claims: workClaims(recorded).length }, escalations: escalationsIn(recorded),
  }));
  const claims = runs.reduce((sum, { hostFaults }) => sum + hostFaults.claims, 0);
  return { runs, stream: {
    hostFaults: { faults: events.filter(hostFault).length, claims },
    escalations: escalationsIn(events), rounds: roundsPerCard(events),
  } };
}

/**
 * L3's signals for each run in `events`, in the order each run first appears.
 *
 * - **Throughput:** slot-release events per hour, over the span from the run's first event to its
 *   last, whichever layer recorded them.
 * - **Utilization:** the sum of each card's pull-to-release interval, divided by the run's
 *   recorded N, the `concurrency` its `run.start` carries, multiplied by that span.
 * - **Queue carried:** each L3 `pull`'s `card` and `queueDepth`, the pullable cards it left
 *   unclaimed, in line order, a merge claim's among them, as `queue`.
 *
 * Each run answers the facts the two are computed from as well as the two, so a reader can check
 * the arithmetic: `from` and `to` in epoch milliseconds, `releases`, `pulled` (the summed
 * intervals, in milliseconds) and `n`. Where the span is zero neither signal is a number, and
 * `throughput` and `utilization` are null. A run that recorded no `run.start`, which a pull fired
 * alone does not, has no N, and its `n` is undefined and its `utilization` null.
 */
function l3Signals(events) {
  return [...byRun(events)].map(([run, recorded]) => {
    const times = recorded.map((event) => Date.parse(event.ts));
    const [from, to] = [times[0], times.at(-1)];
    const l3 = recorded.filter((event) => event.layer === 'L3');
    const n = l3.find((event) => event.event === 'run.start')?.concurrency;
    const pulledAt = new Map();
    let releases = 0;
    let pulled = 0;
    for (const event of l3) {
      if (event.event === 'pull') pulledAt.set(event.card, Date.parse(event.ts));
      if (event.event === 'slot.release') {
        releases += 1;
        pulled += Date.parse(event.ts) - pulledAt.get(event.card);
        pulledAt.delete(event.card);
      }
    }
    const span = to - from;
    const queue = l3.filter((event) => event.event === 'pull').map(({ card, queueDepth }) => ({ card, queueDepth }));
    return {
      run, from, to, releases, pulled, n, queue,
      throughput: span === 0 ? null : releases / (span / HOUR),
      utilization: span === 0 || n === undefined ? null : pulled / (n * span),
    };
  });
}

/** The four `transition` causes that send a card back for more work: L4's rework. */
const REWORK = new Set(['continued', 'continuedFromOwner', 'conflicted', 'conflictedFromOwner']);

/** How many of `recorded`'s L2 `transition` events send a card back, by their `cause`. */
const rework = (recorded) => recorded.filter((event) => event.layer === 'L2' && event.event === 'transition' && REWORK.has(event.cause)).length;

/**
 * L4's first-pass rate across the stream: `first` of `of`. `of` is the cards under which an L2
 * `transition` whose `cause` is `merged` or `mergedFromOwner` is recorded, less those with no
 * `marker.read`; `first` is those with exactly one round, as L2's roundsPerCard counts rounds.
 */
function firstPass(events) {
  const merged = new Set(events
    .filter((event) => event.layer === 'L2' && event.event === 'transition' && ['merged', 'mergedFromOwner'].includes(event.cause))
    .map((event) => event.card));
  const judged = roundsPerCard(events).filter(({ card }) => merged.has(card));
  return { first: judged.filter(({ rounds }) => rounds === 1).length, of: judged.length };
}

/**
 * L4's tier accuracy across the stream: `accurate` of `of`. `of` is the pairs of a card and a role
 * with an L3 `dispatch` carrying `role` and `tier` and no `step`; `accurate` is those with no tier
 * correction, a dispatch at another `tier` than the pair's nearest earlier one carrying a `tier`.
 * A role dispatch carrying no `tier` is not read (the architect's ruling, 1067#6459717512).
 */
function tierAccuracy(events) {
  const tiers = new Map();
  const corrected = new Set();
  for (const event of events) {
    if (event.layer !== 'L3' || event.event !== 'dispatch' || event.card == null || event.step !== undefined
      || event.role === undefined || event.tier === undefined) continue;
    const pair = JSON.stringify([event.card, event.role]);
    if (tiers.has(pair) && tiers.get(pair) !== event.tier) corrected.add(pair);
    tiers.set(pair, event.tier);
  }
  return { accurate: tiers.size - corrected.size, of: tiers.size };
}

/** L4's signals: rework per run, in the order each run first appears, and rework, the first-pass rate and tier accuracy across the stream. */
function l4Signals(events) {
  return {
    runs: [...byRun(events)].map(([run, recorded]) => ({ run, rework: rework(recorded) })),
    stream: { rework: rework(events), firstPass: firstPass(events), tierAccuracy: tierAccuracy(events) },
  };
}

/** Whether L3 and L1 recorded the judge dispatch that could have written this marker. */
function wroteMarker(marker, dispatches, starts) {
  if (typeof marker.dispatch !== 'string' || marker.dispatch === '') return false;
  const l3 = dispatches.get(marker.dispatch);
  const l1 = starts.get(marker.dispatch);
  return l3?.card === marker.card && l3.role === marker.role
    && l1?.facts?.pull === marker.pull && l1.facts.head === marker.head
    && typeof l1.digest === 'string' && l1.digest === marker.evidence;
}

/** Agent marker reads with no unique matching dispatch, counted once across repeated reads. */
function unwrittenMarkers(events) {
  const dispatches = new Map(events.filter((event) => event.layer === 'L3' && event.event === 'dispatch').map((event) => [event.dispatch, event]));
  const starts = new Map(events.filter((event) => event.layer === 'L1' && event.event === 'dispatch.start').map((event) => [event.dispatch, event]));
  const distinct = new Map();
  for (const event of events) {
    if (event.layer !== 'L2' || event.event !== 'marker.read' || event.role === 'owner') continue;
    const key = JSON.stringify([event.card, event.role, event.head, event.digest, event.evidence, event.dispatch, event.verdict, event.reason]);
    if (!distinct.has(key)) distinct.set(key, event);
  }
  const uses = new Map();
  for (const marker of distinct.values()) {
    if (typeof marker.dispatch !== 'string' || marker.dispatch === '') continue;
    uses.set(marker.dispatch, (uses.get(marker.dispatch) ?? 0) + 1);
  }
  return [...distinct.values()]
    .filter((marker) => (uses.get(marker.dispatch) ?? 0) > 1 || !wroteMarker(marker, dispatches, starts))
    .map(({ card, role, head, dispatch, reason }) => ({ card, role, head, dispatch, reason }));
}

/**
 * The report over the state directory `directory`: its stream's `path`, L0's, L1's and L2's
 * signals per run and across the stream, L3's signals per run, L4's rework per run and its signals
 * across the stream, and agent markers with no unique matching recorded dispatch. The latter joins
 * the whole stream, across runs. It reads through the sink and writes nothing; an unreadable line throws as the
 * reader does, naming that line.
 */
export function report(directory) {
  const path = streamPath(directory);
  if (!existsSync(path)) return { path, l0: null, l1: null, l2: null, runs: null, l4: null, markers: null };
  const events = readEvents(directory);
  return { path, l0: l0Signals(events), l1: l1Signals(events), l2: l2Signals(events), runs: l3Signals(events), l4: l4Signals(events), markers: unwrittenMarkers(events) };
}
