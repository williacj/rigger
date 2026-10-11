// ABOUTME: L5's report: L3's per-run signals and marker dispatch checks derived from one state
// directory's event stream.

import { existsSync } from 'node:fs';

import { readEvents, streamPath } from './sink.mjs';

/** Milliseconds in an hour: the unit throughput is counted per, and a duration is printed in. */
export const HOUR = 3_600_000;

/**
 * L3's signals for each run in `events`, in the order each run first appears.
 *
 * - **Throughput:** slot-release events per hour, over the span from the run's first event to its
 *   last, whichever layer recorded them.
 * - **Utilization:** the sum of each card's pull-to-release interval, divided by the run's
 *   recorded N, the `concurrency` its `run.start` carries, multiplied by that span.
 *
 * Each run answers the facts the two are computed from as well as the two, so a reader can check
 * the arithmetic: `from` and `to` in epoch milliseconds, `releases`, `pulled` (the summed
 * intervals, in milliseconds) and `n`. Where the span is zero neither signal is a number, and
 * `throughput` and `utilization` are null. A run that recorded no `run.start`, which a pull fired
 * alone does not, has no N, and its `n` is undefined and its `utilization` null.
 */
function l3Signals(events) {
  const runs = new Map();
  for (const event of events) {
    if (!runs.has(event.run)) runs.set(event.run, []);
    runs.get(event.run).push(event);
  }
  return [...runs].map(([run, recorded]) => {
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
    return {
      run, from, to, releases, pulled, n,
      throughput: span === 0 ? null : releases / (span / HOUR),
      utilization: span === 0 || n === undefined ? null : pulled / (n * span),
    };
  });
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
    const key = JSON.stringify([event.card, event.role, event.head, event.digest, event.evidence, event.dispatch, event.verdict, event.reason, event.edited]);
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
 * The report over the state directory `directory`: its stream's `path`, L3 signals per run, and
 * agent markers with no unique matching recorded dispatch. The latter joins the whole stream,
 * across runs. It reads through the sink and writes nothing; an unreadable line throws as the
 * reader does, naming that line.
 */
export function report(directory) {
  const path = streamPath(directory);
  if (!existsSync(path)) return { path, runs: null, markers: null };
  const events = readEvents(directory);
  return { path, runs: l3Signals(events), markers: unwrittenMarkers(events) };
}
