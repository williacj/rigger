// ABOUTME: The `run` verb: claims cards through L3's claim-only call until the slots are full or
// nothing is left to pull, dispatches nothing, and says so. It reads the board through L0, moves
// each card claimed from Ready through L2, and records through L5.

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { validate } from '../config/validate.mjs';
import { openSink } from '../observation/sink.mjs';
import { claimOnly } from '../scheduling/loop.mjs';
import { readSide } from '../substrate/forge/read.mjs';
import { nextAction } from '../workflow/next-action.mjs';
import { columnChanges } from '../workflow/transitions.mjs';
import { CONFIG } from './init.mjs';
import { PACKAGE, consumerConfig, sourceTreeGuard } from './doctor.mjs';
import { refusalLine } from './plan.mjs';
import { STATE } from './report.mjs';

/** What the command prints for a `run` run, and the status it exits with. */
export async function run({ target = process.cwd(), packageRoot = PACKAGE, ask, send } = {}) {
  const { named, refusal } = sourceTreeGuard('run', { target, packageRoot, ask });
  if (refusal) return refusal;
  const { config, problem } = await consumerConfig(named);
  if (problem) return { text: `rigger run: ${problem}`, code: 1 };
  const invalid = validate(config);
  if (invalid.length > 0) return { text: `rigger run: \`${CONFIG}\`: ${invalid.join('; ')}`, code: 1 };

  const board = readSide({ ...config.board, repo: config.repo }, { send });
  const sink = openSink({ directory: join(named, STATE), run: randomUUID(), now: Date.now });
  const l2 = columnChanges({ config, sink, send });
  // L3's claim-only call answers the cards it claimed and nothing about the rest, so every card
  // L2 refuses is seen here, through the next action this verb hands L3 (the reviewer's ruling
  // on #312).
  const refusals = [];
  const decide = (card) => {
    const next = nextAction(card, config.kinds, config.epicLabel);
    if (next.action === 'refuse') refusals.push(next);
    return next;
  };
  // One handle per invocation: two over one board would each claim the same card. No limit is
  // given, so the call claims until the slots are full: L3 reads N from the config it is handed.
  const claimed = await claimOnly({ config, board, decide, l2, sink }).claim();
  const { project } = config.board;
  const refused = refusals.map(refusalLine);
  // Nothing to pull is the one outcome this verb meets in full, so it alone exits zero.
  if (claimed.length === 0) return { text: [`rigger run: from board ${project}, no card was pullable`, ...refused].join('\n'), code: 0 };
  // Non-zero, because a card claimed and not worked is short of what the README promises of
  // this verb, and a zero exit would read to whoever called it as work that was done.
  return {
    text: [
      ...claimed.map((card) => `rigger run: claimed #${card.number} from board ${project}, and it was not worked: dispatch arrives with M2 and M4`),
      ...refused,
    ].join('\n'),
    code: 1,
  };
}
