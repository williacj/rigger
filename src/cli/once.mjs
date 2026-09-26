// ABOUTME: The `once` verb: claims one card through L3's claim-only call, dispatches nothing, and
// says so. It reads the board through L0, moves the card through L2, and records through L5.

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

/** What the command prints for a `once` run, and the status it exits with. */
export async function once({ target = process.cwd(), packageRoot = PACKAGE, ask, send } = {}) {
  const { named, refusal } = sourceTreeGuard('once', { target, packageRoot, ask });
  if (refusal) return refusal;
  const { config, problem } = await consumerConfig(named);
  if (problem) return { text: `rigger once: ${problem}`, code: 1 };
  const invalid = validate(config);
  if (invalid.length > 0) return { text: `rigger once: \`${CONFIG}\`: ${invalid.join('; ')}`, code: 1 };

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
  // One handle per invocation: two over one board would each claim the same card. The limit is
  // this verb's own literal: `once` claims one card, whatever N the config declares.
  const claimed = await claimOnly({ config, board, decide, l2, sink }).claim(1);
  const { project } = config.board;
  const refused = refusals.map(refusalLine);
  // Nothing to pull is the one outcome this verb meets in full, so it alone exits zero (U29).
  if (claimed.length === 0) return { text: [`rigger once: from board ${project}, no card was pullable`, ...refused].join('\n'), code: 0 };
  // Non-zero, because a card claimed and not worked is short of what the README promises of
  // this verb, and a zero exit would read to whoever called it as work that was done.
  return {
    text: [
      ...claimed.map((card) => `rigger once: claimed #${card.number} from board ${project}, and it was not worked: dispatch arrives with M2 and M4`),
      ...refused,
    ].join('\n'),
    code: 1,
  };
}
