// ABOUTME: The `report` verb: prints L5's derived signals, one section per layer, and unmatched
// marker reads from the consumer's event stream, and refuses its own source tree.

import { join } from 'node:path';

import { HOUR, report as derive } from '../observation/report.mjs';
import { PACKAGE, settled } from './doctor.mjs';
import { STATE, recording } from './recording.mjs';

/** A figure as printed: to four decimal places at most, which states every value a test sets exactly. */
const figure = (value) => String(Number(value.toFixed(4)));

/** A duration in milliseconds, printed in hours. */
const hours = (ms) => `${figure(ms / HOUR)} h`;

/** The lines one run's queue carried prints as: one per L3 `pull`, in line order, or one saying it recorded none. */
const queueLines = (queue) => (queue.length === 0
  ? ['    the run recorded no pull, so L3 has no queue carried for it']
  : queue.map(({ card, queueDepth }) => `    queue carried at the pull of card #${card}: ${queueDepth}`));

/** The lines one run's L3 signals print as, each figure beside the facts it was computed from, then its queue carried. */
function runLines({ run, from, to, releases, pulled, n, throughput, utilization, queue }) {
  const span = to - from;
  const heading = `  run ${run}: from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}, a span of ${hours(span)}`;
  if (span === 0) return [heading, '    the span is zero, so L3 has no throughput and no utilization for this run', ...queueLines(queue)];
  return [
    heading,
    `    L3 throughput: ${figure(throughput)} slot releases per hour (${releases} slot releases over ${hours(span)})`,
    utilization === null
      ? '    the run recorded no N, so L3 has no utilization for it'
      : `    L3 utilization: ${figure(utilization)} (${hours(pulled)} from pull to release, over N ${n} x ${hours(span)})`,
    ...queueLines(queue),
  ];
}

/** A rate's line, beside its numerator and denominator, or why there is none where the denominator is zero. */
const rateLine = (name, part, whole, { counted, of, none }) => (of === 0
  ? `    no ${name}: ${none}`
  : `    ${name}: ${figure(counted / of)} (${part} ${counted}, over ${whole} ${of})`);

/** The survivor rate's line, `where` naming the run or the stream it is over. */
const survivorLine = ({ killed, of }, where) => rateLine('survivor rate', 'dispatches with a survivor or group killed', 'dispatches that ended with a result',
  { counted: killed, of, none: `no dispatch in ${where} ended with a result` });

/** The lines L1's section prints under its heading: each run's durations and survivor rate, then the stream's. */
function l1Lines({ runs, stream }) {
  return [
    ...runs.flatMap(({ run, durations, survivors }) => [
      `  run ${run}`,
      ...durations.map(({ dispatch, card, ms }) => `    dispatch ${dispatch}${card === undefined ? '' : `, card #${card}`}: ${ms} ms`),
      survivorLine(survivors, 'this run'),
    ]),
    '  across the stream',
    `    dispatch.end events: ${stream.ended}, each listed under its run`,
    survivorLine(stream.survivors, 'the stream'),
  ];
}

/** The lines L2's section prints under its heading: each run's host-fault rate, then the stream's. */
function l2Lines({ runs, stream }) {
  const line = ({ faults, claims }, where) => rateLine('host-fault rate', 'host faults', 'work claims', { counted: faults, of: claims, none: `no work claim in ${where}` });
  return [
    ...runs.flatMap(({ run, hostFaults }) => [`  run ${run}`, line(hostFaults, 'this run')]),
    '  across the stream',
    line(stream.hostFaults, 'the stream'),
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
  const { path, l1, l2, runs, markers } = derived;
  if (runs === null) return { text: `rigger report: no events are recorded; there is no stream at ${path}`, code: 0 };
  const markerLines = markers.map(({ card, role, head, dispatch, reason }) =>
    `  card #${card}, ${role}, head ${head}, dispatch ${dispatch}${reason === undefined ? '' : `: ${reason}`}`);
  return { text: [
    `rigger report: the events recorded at ${path}`,
    'L1',
    ...l1Lines(l1),
    'L2',
    ...l2Lines(l2),
    'L3',
    ...runs.flatMap(runLines),
    'markers no dispatch wrote',
    ...markerLines,
    '  only markers L2 recorded in this state directory are named',
    '  markers of role owner are never checked',
  ].join('\n'), code: 0 };
}
