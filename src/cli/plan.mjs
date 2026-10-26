// ABOUTME: The `plan` verb: what the next run would pull from the board, first pulled first, and
// the cards it refuses, read through L0 and ordered by L2 and L3's own functions. It writes nothing.

import { validate } from '../config/validate.mjs';
import { pullOrder } from '../scheduling/pull-order.mjs';
import { readSide, repositoryReads } from '../substrate/forge/read.mjs';
import { factsCall } from '../workflow/facts.mjs';
import { escalationStatus, nextAction } from '../workflow/next-action.mjs';
import { CONFIG } from './init.mjs';
import { PACKAGE, admissionIn, closerLine, consumerConfig, settled, unreadableAdmission } from './doctor.mjs';
import { recording } from './recording.mjs';

/**
 * One line per card: what the run does with it, its number, and the kind or the reason, and for a
 * card pulled for its judges, the judges it would dispatch.
 */
const pullLine = ({ card, kind, redo, judges, action, to, pull, head, category, reason, following }) => {
  const prefix = `  pull    #${card}  `;
  const suffix = redo ? '  (redo)' : '';
  if (action === 'remove') return `${prefix}remove directories, then ${pullLine({ card, redo, ...following }).slice(prefix.length)}`;
  if (action === 'refuse') return `${prefix}refuse: ${reason}${suffix}`;
  if (action === 'move') return `${prefix}move to ${to}${suffix}`;
  if (action === 'continue') return `${prefix}continue pull request #${pull} at ${head}${suffix}`;
  if (action === 'return') return `${prefix}return pull request #${pull}${suffix}`;
  if (action === 'escalate') return `${prefix}escalate ${category}${suffix}`;
  if (action === 'merge') return `${prefix}merge pull request #${pull} at ${head}${suffix}`;
  if (judges !== undefined) return `  pull    #${card}  ${kind}  judges ${judges.join(', ')}`;
  return `${prefix}${kind}${suffix}`;
};

/**
 * The sink `plan` hands L2's next action, which records nothing: a judge answer records a diff the
 * forge would not serve, and `plan` writes nothing but what L0 records of a process it kills.
 */
const UNRECORDED = { emitter: () => ({ emit: () => {} }) };
/** Exported because `once` names the cards it refuses in this verb's words. */
export const refusalLine = ({ card, reason }) => `  refuse  #${card}  ${reason}`;

/**
 * What the command prints for a `plan` run, and the status it exits with. It writes nothing but
 * what L0 records of a process it kills, through the sink `recording` opens.
 */
export const plan = (options) => recording((opened) => planning(opened, options));

/** `plan`'s work, recording through the sink `opened` holds once `settled` has named its state directory. */
async function planning(opened, { target = process.cwd(), packageRoot = PACKAGE, ask, send } = {}) {
  const { named, refusal } = await settled('plan', opened, { target, packageRoot, ask });
  if (refusal) return refusal;
  const { sink } = opened;
  // Admission is read first, so `plan` names its state whatever else it fails to read
  // (`R-SCHED-18`). A closed admission is no failure of the pull and an unreadable one is
  // ("Failure model"), so only the second fails the verb.
  const admission = admissionIn(named, sink);
  let admissionLines = [];
  if (admission.state === 'closed') admissionLines = admission.closers.map((closer) => `rigger plan: ${closerLine(closer)}`);
  if (admission.state === 'unreadable') admissionLines = [`rigger plan: ${unreadableAdmission(admission.unreadable)}`];
  const failed = (said) => ({ text: [said, ...admissionLines].join('\n'), code: 1 });
  const { config, problem } = await consumerConfig(named);
  if (problem) return failed(`rigger plan: ${problem}`);
  const refusals = validate(config);
  if (refusals.length > 0) return failed(`rigger plan: \`${CONFIG}\`: ${refusals.join('; ')}`);

  const { project } = config.board;
  const forge = { ...config.board, repo: config.repo };
  const side = readSide(forge, { send, emitter: sink.emitter({ layer: 'L0' }) });
  let read;
  try {
    read = { columns: await side.readColumns(), ...(await side.readPriority()) };
  } catch (threw) {
    return failed(`rigger plan: board ${project} could not be read: ${threw.message}`);
  }
  // The same facts call and next action the claiming verbs hand L3, so `plan` refuses each card
  // they would: for what the forge holds of its line of work, and for its maker's or a judge's
  // tier; and names the judges they would dispatch for a Review card.
  const answers = new Map();
  const decide = (card) => {
    const answer = nextAction(card, config.kinds, config.epicLabel, { roles: config.roles, provisioning: config.provisioning ?? {}, sink: UNRECORDED });
    answers.set(card.number, answer);
    return answer;
  };
  let decided;
  try {
    decided = await factsCall({ config, reads: repositoryReads(forge, { send, emitter: sink.emitter({ layer: 'L0' }) }), decide })(read.items);
  } catch (threw) {
    return failed(`rigger plan: ${threw.message}`);
  }
  const order = pullOrder(read, decided);
  // A closed or unreadable admission changes only what the next run would pull: the refusals and
  // the escalated cards are reported in every state, so the owner sees in one run all to fix.
  const pulls = admission.state === 'open' ? order.pulls : [];
  const escalated = read.items.map((card) => [card.number,
    answers.has(card.number) ? answers.get(card.number) : escalationStatus(card)])
    .filter(([, answer]) => answer?.escalated);
  const namedRefusals = order.refusals.filter(({ card }) => !answers.get(card)?.escalated);

  const counted = (n, what) => `${n} ${what}${n === 1 ? '' : 's'}`;
  const heading = pulls.length === 0
    ? `rigger plan: from board ${project}, nothing would be pulled`
    : `rigger plan: from board ${project}, the next run would pull ${counted(pulls.length, 'card')}, first pulled first`;
  const refused = namedRefusals.length === 0 ? '' : `, and refuses ${counted(namedRefusals.length, 'card')}`;
  return {
    text: [`${heading}${refused}`, ...admissionLines, ...pulls.map(pullLine), ...namedRefusals.map(refusalLine),
      ...escalated.map(([card, answer]) => `  escalated #${card}${answer.reason ? `  ${answer.reason}` : ''}`)].join('\n'),
    code: admission.state === 'unreadable' ? 1 : 0,
  };
}
