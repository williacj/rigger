// ABOUTME: The `plan` verb: what the next run would pull from the board, first pulled first, and
// the cards it refuses, read through L0 and ordered by L2 and L3's own functions. It writes nothing.

import { validate } from '../config/validate.mjs';
import { pullOrder } from '../scheduling/pull-order.mjs';
import { readSide } from '../substrate/forge/read.mjs';
import { nextAction } from '../workflow/next-action.mjs';
import { CONFIG } from './init.mjs';
import { PACKAGE, consumerConfig, sourceTreeGuard } from './doctor.mjs';

/** One line per card: what the run does with it, its number, and the kind or the reason. */
const pullLine = ({ card, kind, redo }) => `  pull    #${card}  ${kind}${redo ? '  (redo)' : ''}`;
/** Exported because `run` names the cards it refuses in this verb's words. */
export const refusalLine = ({ card, reason }) => `  refuse  #${card}  ${reason}`;

/** What the command prints for a `plan` run, and the status it exits with. */
export async function plan({ target = process.cwd(), packageRoot = PACKAGE, ask, send } = {}) {
  const { named, refusal } = sourceTreeGuard('plan', { target, packageRoot, ask });
  if (refusal) return refusal;
  const { config, problem } = await consumerConfig(named);
  if (problem) return { text: `rigger plan: ${problem}`, code: 1 };
  const refusals = validate(config);
  if (refusals.length > 0) return { text: `rigger plan: \`${CONFIG}\`: ${refusals.join('; ')}`, code: 1 };

  const { project } = config.board;
  const side = readSide({ ...config.board, repo: config.repo }, { send });
  let read;
  try {
    read = { columns: await side.readColumns(), ...(await side.readPriority()) };
  } catch (threw) {
    return { text: `rigger plan: board ${project} could not be read: ${threw.message}`, code: 1 };
  }
  const order = pullOrder(read, (card) => nextAction(card, config.kinds, config.epicLabel));

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
