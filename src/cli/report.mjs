// ABOUTME: The `report` verb: prints the signals L5's report derives from the event stream in the
// consumer's state directory, each beside the facts it was computed from, and refuses its own source tree.

import { join } from 'node:path';

import { HOUR, report as derive } from '../observation/report.mjs';
import { PACKAGE, sourceTreeGuard } from './doctor.mjs';

/**
 * The state directory, where L5's stream lives. `ARCHITECTURE.md`'s Engine settings row names
 * `.rigger/` as its default, and the published config shape offers no key to name another.
 * Exported because `once` writes the stream this verb reads.
 */
export const STATE = '.rigger';

/** A figure as printed: to four decimal places at most, which states every value a test sets exactly. */
const figure = (value) => String(Number(value.toFixed(4)));

/** A duration in milliseconds, printed in hours. */
const hours = (ms) => `${figure(ms / HOUR)} h`;

/** The lines one run's L3 signals print as, each figure beside the facts it was computed from. */
function runLines({ run, from, to, releases, pulled, n, throughput, utilization }) {
  const span = to - from;
  const heading = `run ${run}: from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}, a span of ${hours(span)}`;
  if (span === 0) return [heading, '  the span is zero, so L3 has no throughput and no utilization for this run'];
  return [
    heading,
    `  L3 throughput: ${figure(throughput)} slot releases per hour (${releases} slot releases over ${hours(span)})`,
    utilization === null
      ? '  the run recorded no N, so L3 has no utilization for it'
      : `  L3 utilization: ${figure(utilization)} (${hours(pulled)} from pull to release, over N ${n} x ${hours(span)})`,
  ];
}

/** What the command prints for a `report` run, and the status it exits with. */
export async function report({ target = process.cwd(), packageRoot = PACKAGE, ask } = {}) {
  const { named, refusal } = sourceTreeGuard('report', { target, packageRoot, ask });
  if (refusal) return refusal;
  let derived;
  try {
    derived = derive(join(named, STATE));
  } catch (refused) {
    return { text: `rigger report: ${refused.message}, so no signal is derived`, code: 1 };
  }
  const { path, runs } = derived;
  if (runs === null) return { text: `rigger report: no events are recorded; there is no stream at ${path}`, code: 0 };
  return { text: [`rigger report: the events recorded at ${path}`, ...runs.flatMap(runLines)].join('\n'), code: 0 };
}
