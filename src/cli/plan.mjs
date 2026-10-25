// ABOUTME: The `plan` verb: what the next run would pull from the board, first pulled first, and
// the cards it refuses, read through L0 and ordered by L2 and L3's own functions. It writes nothing.

import { validate } from '../config/validate.mjs';
import { pullOrder } from '../scheduling/pull-order.mjs';
import { readSide, repositoryReads } from '../substrate/forge/read.mjs';
import { factsCall } from '../workflow/facts.mjs';
import { escalationStatus, nextAction } from '../workflow/next-action.mjs';
import { CONFIG } from './init.mjs';
import { PACKAGE, consumerConfig, settled } from './doctor.mjs';
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
  const { config, problem } = await consumerConfig(named);
  if (problem) return { text: `rigger plan: ${problem}`, code: 1 };
  const refusals = validate(config);
  if (refusals.length > 0) return { text: `rigger plan: \`${CONFIG}\`: ${refusals.join('; ')}`, code: 1 };

  const { project } = config.board;
  const forge = { ...config.board, repo: config.repo };
  const side = readSide(forge, { send, emitter: sink.emitter({ layer: 'L0' }) });
  let read;
  try {
    read = { columns: await side.readColumns(), ...(await side.readPriority()) };
  } catch (threw) {
    return { text: `rigger plan: board ${project} could not be read: ${threw.message}`, code: 1 };
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
    return { text: `rigger plan: ${threw.message}`, code: 1 };
  }
  const order = pullOrder(read, decided);
  const escalated = read.items.map((card) => [card.number,
    answers.has(card.number) ? answers.get(card.number) : escalationStatus(card)])
    .filter(([, answer]) => answer?.escalated);
  const namedRefusals = order.refusals.filter(({ card }) => !answers.get(card)?.escalated);

  const counted = (n, what) => `${n} ${what}${n === 1 ? '' : 's'}`;
  const heading = order.pulls.length === 0
    ? `rigger plan: from board ${project}, nothing would be pulled`
    : `rigger plan: from board ${project}, the next run would pull ${counted(order.pulls.length, 'card')}, first pulled first`;
  const refused = namedRefusals.length === 0 ? '' : `, and refuses ${counted(namedRefusals.length, 'card')}`;
  return {
    text: [`${heading}${refused}`, ...order.pulls.map(pullLine), ...namedRefusals.map(refusalLine),
      ...escalated.map(([card, answer]) => `  escalated #${card}${answer.reason ? `  ${answer.reason}` : ''}`)].join('\n'),
    code: 0,
  };
}
