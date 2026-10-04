// ABOUTME: The `plan` verb: what the next run would pull from the board, first pulled first, and
// the cards it refuses, read through L0 and ordered by L2 and L3's own functions. It writes nothing.

import { validate } from '../config/validate.mjs';
import { pullOrder } from '../scheduling/pull-order.mjs';
import { readSide, repositoryReads } from '../substrate/forge/read.mjs';
import { factsCall } from '../workflow/facts.mjs';
import { nextAction } from '../workflow/next-action.mjs';
import { CONFIG } from './init.mjs';
import { PACKAGE, consumerConfig, settled } from './doctor.mjs';
import { recording } from './recording.mjs';

/**
 * One line per card: what the run does with it, its number, and the kind or the reason, and for a
 * card pulled for its judges, the judges it would dispatch.
 */
const pullLine = ({ card, kind, redo, judges }) => {
  if (judges !== undefined) return `  pull    #${card}  ${kind}  judges ${judges.join(', ')}`;
  return `  pull    #${card}  ${kind}${redo ? '  (redo)' : ''}`;
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
  const decide = (card) => nextAction(card, config.kinds, config.epicLabel, { roles: config.roles, provisioning: config.provisioning ?? {}, sink: UNRECORDED });
  let decided;
  try {
    decided = await factsCall({ config, reads: repositoryReads(forge, { send, emitter: sink.emitter({ layer: 'L0' }) }), decide })(read.items);
  } catch (threw) {
    return { text: `rigger plan: ${threw.message}`, code: 1 };
  }
  const order = pullOrder(read, decided);

  const counted = (n, what) => `${n} ${what}${n === 1 ? '' : 's'}`;
  const heading = order.pulls.length === 0
    ? `rigger plan: from board ${project}, nothing would be pulled`
    : `rigger plan: from board ${project}, the next run would pull ${counted(order.pulls.length, 'card')}, first pulled first`;
  const refused = order.refusals.length === 0 ? '' : `, and refuses ${counted(order.refusals.length, 'card')}`;
  return {
    text: [`${heading}${refused}`, ...order.pulls.map(pullLine), ...order.refusals.map(refusalLine)].join('\n'),
    code: 0,
  };
}
