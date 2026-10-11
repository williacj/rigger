// ABOUTME: The `report` verb: prints L5's derived signals and unmatched marker reads from the
// consumer's event stream, and refuses its own source tree.

import { join } from 'node:path';

import { HOUR, report as derive } from '../observation/report.mjs';
import { PACKAGE, settled } from './doctor.mjs';
import { STATE, recording } from './recording.mjs';

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

/**
 * What the command prints for a `report` run, and the status it exits with. It writes nothing but
 * what L0 records of a process it kills, through the sink `recording` opens.
 */
export const report = (options) => recording((opened) => reporting(opened, options));

/** `report`'s work, recording through the sink `opened` holds once the guard has settled. */
async function reporting(opened, { target = process.cwd(), packageRoot = PACKAGE, ask } = {}) {
  const { named, refusal } = await settled('report', opened, { target, packageRoot, ask });
  if (refusal) return refusal;
  let derived;
  try {
    derived = derive(join(named, STATE));
  } catch (refused) {
    return { text: `rigger report: ${refused.message}, so no signal is derived`, code: 1 };
  }
  const { path, runs, markers } = derived;
  if (runs === null) return { text: `rigger report: no events are recorded; there is no stream at ${path}`, code: 0 };
  const markerLines = markers.map(({ card, role, head, dispatch, reason }) =>
    `  card #${card}, ${role}, head ${head}, dispatch ${dispatch}${reason === undefined ? '' : `: ${reason}`}`);
  return { text: [
    `rigger report: the events recorded at ${path}`,
    ...runs.flatMap(runLines),
    'markers no dispatch wrote',
    ...markerLines,
    '  only markers L2 recorded in this state directory are named',
    '  markers of role owner are never checked',
  ].join('\n'), code: 0 };
}
