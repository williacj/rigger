// ABOUTME: L2's facts call: what the forge holds of each pullable card's line of work, read before
// L3 claims, and the one read of a card's pull requests L2's settle makes.

import { worktreeTopic } from '../config/validate.mjs';
import { topicFor } from '../execution/workspace.mjs';

/**
 * What `read` answers, or a failure naming `cards`, the numbers it was reading for, and the read's
 * own error, kept as the cause.
 */
async function forCards(cards, read) {
  try {
    return await read();
  } catch (failure) {
    const named = cards.map((number) => `#${number}`).join(', ');
    throw new Error(`L2 could not read what the forge holds for card ${named}: ${failure.message}`, { cause: failure });
  }
}

/**
 * The pull requests from card `number`'s line of work `line`, as `{ line, open, merged }`, read once
 * through `readPullRequests`, the forge adapter's read side's. A read that fails rejects naming the
 * card and the read.
 */
export async function pullRequestsFrom(number, line, readPullRequests) {
  const { open, merged } = await forCards([number], () => readPullRequests(line));
  return { line, open, merged };
}

/**
 * L2's facts call over the board `config` names, through `reads`, the forge adapter's repository
 * reads (`repositoryReads`), of which it uses `readBranches` and `readPullRequests`. `decide` is
 * L2's next action for a card, as the verb built it.
 *
 * Handed the cards L3 read, it reads, for each card in the `ready`, `coding` or `review` column,
 * what the forge holds of its line of work, the branch the topic rule names: whether the branch is
 * there, read once for every such card, and the open and merged pull requests from it, read for
 * each card in turn (the architect's ruling 2, P1, on #467). A read that fails rejects naming each
 * card it was reading for and the read, and answers no facts at all.
 *
 * It answers the `decide` L3 calls at the pull, synchronously: `decide` handed each card read with
 * its facts as `forge`, `{ stage, line, branch, open, merged }`, `stage` naming the column's key,
 * and any other card as it was. L3 reads nothing of this answer but calls it (the architect's
 * ruling 1, Q4, and ruling 2, P2).
 */
export function factsCall({ config, reads, decide }) {
  const { columns } = config.board;
  const topic = worktreeTopic(config);
  const stages = new Map(['ready', 'coding', 'review'].map((stage) => [columns[stage], stage]));
  return async (cards) => {
    const offered = cards.filter((card) => stages.has(card.column));
    const lines = new Map(offered.map((card) => [card.number, topicFor(topic, card.number)]));
    const branches = offered.length === 0 ? {} : await forCards([...lines.keys()], () => reads.readBranches([...lines.values()]));
    const held = new Map();
    for (const card of offered) {
      const line = lines.get(card.number);
      const { open, merged } = await pullRequestsFrom(card.number, line, reads.readPullRequests);
      held.set(card.number, { stage: stages.get(card.column), line, branch: branches[line] === true, open, merged });
    }
    return (card, ...rest) => decide(held.has(card.number) ? { ...card, forge: held.get(card.number) } : card, ...rest);
  };
}
