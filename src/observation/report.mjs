// ABOUTME: L5's report: the signals derived from the events a state directory's stream holds. L3's
// two so far, throughput and utilization, per run, as #237 defines them where `ARCHITECTURE.md`,
// "Telemetry", names them without a definition.

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

/**
 * The report over the state directory `directory`: the stream's `path`, and the L3 signals of each
 * run it records as `runs`, or null where there is no stream. It reads the stream through the
 * sink's reader and writes nothing, so a stream with a line that is not an event throws as the
 * reader does, naming that line.
 */
export function report(directory) {
  const path = streamPath(directory);
  if (!existsSync(path)) return { path, runs: null };
  return { path, runs: l3Signals(readEvents(directory)) };
}
