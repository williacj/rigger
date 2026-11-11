// ABOUTME: The `report` verb: prints L5's derived signals, one section per layer, and unmatched
// marker reads from the consumer's event stream, and refuses its own source tree.

import { join } from 'node:path';

import { HOUR, report as derive } from '../observation/report.mjs';
import { PACKAGE, outsideText, settled } from './doctor.mjs';
import { STATE, recording } from './recording.mjs';

/** A figure as printed: to four decimal places at most, which states every value a test sets exactly. */
const figure = (value) => String(Number(value.toFixed(4)));

/** A duration in milliseconds, printed in hours. */
const hours = (ms) => `${figure(ms / HOUR)} h`;

/**
 * A value from the stream as a JSON-quoted site prints it. Any of them comes from the stream, where
 * any string can stand (boundary rule 4), so a number prints as itself, -0 as `-0`, which `String`
 * would print as `0`, and every other value as JSON, through `outsideText`. JSON quotes every string
 * and escapes the quotes and backslashes in it, and `outsideText` the line breaks JSON leaves raw,
 * so no value can print a boundary of the list or line it stands in: one dispatch, role or author
 * never prints as two, and none breaks a line. A value printed unquoted passes through
 * `outsideText` alone, which keeps it as written but for its breaks and controls.
 */
const shown = (value) => {
  if (Object.is(value, -0)) return '-0';
  return typeof value === 'number' ? String(value) : outsideText(JSON.stringify(value) ?? String(value));
};

/** The lines one run's queue carried prints as: one per L3 `pull`, in line order, or one saying it recorded none. */
const queueLines = (queue) => (queue.length === 0
  ? ['    the run recorded no pull, so L3 has no queue carried for it']
  : queue.map(({ card, queueDepth }) => `    queue carried at the pull of card #${outsideText(card)}: ${outsideText(queueDepth)}`));

/** The lines one run's L3 signals print as, each figure beside the facts it was computed from, then its queue carried. */
function runLines({ run, from, to, releases, pulled, n, throughput, utilization, queue }) {
  const span = to - from;
  const heading = `  run ${outsideText(run)}: from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}, a span of ${hours(span)}`;
  if (span === 0) return [heading, '    the span is zero, so L3 has no throughput and no utilization for this run', ...queueLines(queue)];
  return [
    heading,
    `    L3 throughput: ${figure(throughput)} slot releases per hour (${releases} slot releases over ${hours(span)})`,
    utilization === null
      ? '    the run recorded no N, so L3 has no utilization for it'
      : `    L3 utilization: ${figure(utilization)} (${hours(pulled)} from pull to release, over N ${outsideText(n)} x ${hours(span)})`,
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

/** A system's fault rate line, `where` naming the run or the stream it is over. */
const faultLine = (system, { faults, calls }, where) => rateLine(`${system} fault rate`,
  `${system} calls that failed or timed out`, `${system} calls`, { counted: faults, of: calls, none: `no ${system} call in ${where}` });

/** The lines L0's section prints under its heading: each run's forge and git fault rates, then the stream's. */
function l0Lines({ runs, stream }) {
  return [
    ...runs.flatMap(({ run, forge, git }) => [`  run ${outsideText(run)}`, faultLine('forge', forge, 'this run'), faultLine('git', git, 'this run')]),
    '  across the stream',
    faultLine('forge', stream.forge, 'the stream'),
    faultLine('git', stream.git, 'the stream'),
  ];
}

/** The lines L1's section prints under its heading: each run's durations and survivor rate, then the stream's. */
function l1Lines({ runs, stream }) {
  return [
    ...runs.flatMap(({ run, durations, survivors }) => [
      `  run ${outsideText(run)}`,
      ...durations.map(({ dispatch, card, ms }) => `    dispatch ${outsideText(dispatch)}${card === undefined ? '' : `, card #${outsideText(card)}`}: ${outsideText(ms)} ms`),
      survivorLine(survivors, 'this run'),
    ]),
    '  across the stream',
    `    dispatch.end events: ${stream.ended}, each listed under its run`,
    survivorLine(stream.survivors, 'the stream'),
    `    redos after an interruption: ${stream.redos.length}, first attempts: ${stream.firstAttempts}`,
    ...stream.redos.map(({ card, run }) => `    redo after an interruption: card #${outsideText(card)}, run ${outsideText(run)}`),
  ];
}

/** The escalation rate over the named span, beside its distinct card counts. */
const escalationLine = ({ escalated, pulled }, where) => rateLine('escalation rate', 'cards escalated', 'cards pulled',
  { counted: escalated, of: pulled, none: `no card pulled in ${where}` });

/** Each escalation in line order, with subsequent reason lines indented two spaces further. */
function escalationLines(entries) {
  return entries.flatMap(({ card, category, raiser, reason, destination }) => {
    const [first, ...later] = String(reason).split('\n');
    return [
      `    card #${outsideText(card)}, category ${outsideText(category)}, raiser ${outsideText(raiser)}${destination == null ? '' : `, destination ${shown(destination)}`}: ${outsideText(first)}`,
      ...later.map((line) => `      ${outsideText(line)}`),
    ];
  });
}

/** Across-stream rounds grouped by kind; only cards the rounds derivation supplies are listed. */
function roundLines(rounds) {
  const kinds = new Map();
  for (const row of rounds) {
    if (!kinds.has(row.kind)) kinds.set(row.kind, []);
    kinds.get(row.kind).push(row);
  }
  return ['    rounds per card, by kind of work', ...[...kinds].flatMap(([kind, cards]) => [
    kind === null ? '      no kind' : `      kind ${shown(kind)}`,
    ...cards.map(({ card, rounds: count }) => `        card #${outsideText(card)}: ${count} round${count === 1 ? '' : 's'}`),
  ])];
}

/** Event counts by recorded class, with infrastructure totals beside each run and stream count. */
function causeLines({ runs, stream }) {
  const counted = (where, { classes, infrastructure }) => [
    `    escalations by cause ${where}: ${classes.map(({ class: cause, count }) => `${cause === null ? 'unclassified' : shown(cause)} ${count}`).join(', ') || 'none'}`,
    `    infrastructure-caused escalations ${where}: ${infrastructure}`,
  ];
  return [...runs.flatMap((each) => counted(`in run ${shown(each.run)}`, each)), ...counted('across the stream', stream)];
}

/** Fresh-verdict proof's card rate, and each merged card without qualifying proof. */
function freshLines({ fresh, of, flagged }) {
  return [
    rateLine('merges with fresh verdicts', 'proved cards', 'merged cards', { counted: fresh, of, none: 'no card merged in the stream' }),
    ...flagged.map((card) => `    flagged merged card #${outsideText(card)}: no qualifying merge decision and later merged end`),
  ];
}

/** Admission hold counts, with literal ids and reasons and any matching open beside each hold. */
function holdLines({ runs, stream }) {
  return [
    `  admission holds across the stream: ${stream.count}`,
    ...runs.flatMap(({ run, count, entries }) => [
      `  admission holds in run ${shown(run)}: ${count}`,
      ...entries.map(({ id, reason, opened }) => `    hold ${shown(id)}: ${shown(reason)}${opened ? `; admission.open ${shown(id)}` : ''}`),
    ]),
  ];
}

/** A heading and its lines, or `none` beneath it where there are none. */
const listed = (heading, lines) => [heading, ...(lines.length === 0 ? ['      none'] : lines)];

/** The acceptance changes across the stream, as L2 prints them: changes, deleted content, growth, the maker's changes, and authors. */
function acceptanceLines({ changes, deleted, grew, authors }) {
  const by = (dispatches) => dispatches.map(({ dispatch, role }) => `, dispatch ${shown(dispatch)} (role ${shown(role)})`).join('');
  const at = (card, editedAt) => `      card #${shown(card)} at ${shown(editedAt)}`;
  return [
    ...listed('    acceptance changes, each with who made it', changes.map(({ card, editedAt, editor, dispatches }) =>
      `${at(card, editedAt)}: editor ${shown(editor)}${by(dispatches)}`)),
    ...listed('    content deleted from a card\'s history', deleted.map(({ card, editedAt, editor }) =>
      `${at(card, editedAt)}: editor ${shown(editor)}`)),
    ...listed('    acceptances that grew after admission', grew.map(({ card, editedAt, items, admitted }) =>
      `${at(card, editedAt)}: ${shown(items)} items, over ${shown(admitted)} at its first pull`)),
    ...listed('    acceptance changes made during the card\'s maker dispatch', changes.filter(({ duringMaker }) => duringMaker)
      .map(({ card, editedAt }) => at(card, editedAt))),
    ...listed('    each card\'s author', authors.map(({ card, source, names }) => {
      if (source === 'author') return `      card #${shown(card)}: ${shown(names[0])}, as its acceptance.history records`;
      if (source === 'dispatches') return `      card #${shown(card)}: roles ${names.map(shown).join(', ')}, whose dispatch windows hold its opening`;
      return `      card #${shown(card)}: the owner, since no role dispatch window holds its opening`;
    })),
  ];
}

/** The lines L2 prints: rates and escalations per run, then stream rates, acceptance changes and rounds by kind. */
function l2Lines({ runs, escalationCauses, stream }) {
  const line = ({ faults, claims }, where) => rateLine('host-fault rate', 'host faults', 'work claims', { counted: faults, of: claims, none: `no work claim in ${where}` });
  return [
    ...runs.flatMap(({ run, hostFaults, escalations }) => [
      `  run ${outsideText(run)}`, line(hostFaults, 'this run'), escalationLine(escalations, 'this run'), ...escalationLines(escalations.entries),
    ]),
    '  across the stream',
    line(stream.hostFaults, 'the stream'),
    escalationLine(stream.escalations, 'the stream'),
    '    each escalation is listed under its run',
    ...causeLines(escalationCauses),
    ...freshLines(stream.freshMerges),
    ...acceptanceLines(stream.acceptance),
    ...roundLines(stream.rounds),
  ];
}

/** The lines L4 prints: each run's rework, then the stream's rework, first-pass rate and tier accuracy. */
function l4Lines({ runs, stream: { rework, firstPass, tierAccuracy } }) {
  return [
    ...runs.flatMap((each) => [`  run ${outsideText(each.run)}`, `    rework: ${each.rework}`]),
    '  across the stream',
    `    rework: ${rework}`,
    rateLine('first-pass rate', 'cards merged after one round', 'cards judged and merged',
      { counted: firstPass.first, of: firstPass.of, none: 'no card in the stream was judged and merged' }),
    rateLine('tier accuracy', 'card and role pairs with no tier correction', 'card and role pairs dispatched at a tier',
      { counted: tierAccuracy.accurate, of: tierAccuracy.of, none: 'no card and role in the stream was dispatched at a tier' }),
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
  return { text: reportText(derived), code: 0 };
}

/** The report lines shared by the report verb and a clock firing handed to run. */
export function reportText({ path, l0, l1, l2, runs, holds, l4, markers }) {
  if (runs === null) return `rigger report: no events are recorded; there is no stream at ${path}`;
  const markerLines = markers.map(({ card, role, head, dispatch, reason }) =>
    `  card #${outsideText(card)}, ${outsideText(role)}, head ${outsideText(head)}, dispatch ${outsideText(dispatch)}${reason === undefined ? '' : `: ${outsideText(reason)}`}`);
  return [
    `rigger report: the events recorded at ${path}`,
    'L0',
    ...l0Lines(l0),
    'L1',
    ...l1Lines(l1),
    'L2',
    ...l2Lines(l2),
    'L3',
    ...holdLines(holds),
    ...runs.flatMap(runLines),
    'L4',
    ...l4Lines(l4),
    'markers no dispatch wrote',
    ...markerLines,
    '  only markers L2 recorded in this state directory are named',
    '  markers of role owner are never checked',
  ].join('\n');
}
