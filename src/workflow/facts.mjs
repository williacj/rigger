// ABOUTME: L2's facts call: what the forge holds of each pullable card's line of work, read before
// L3 claims, and the one read of a card's pull requests, and of the one open among them, L2's settle makes.

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
 * What the forge holds of card `number`'s one open pull request `pull`, read through `reads`, the
 * forge adapter's repository reads, each as `Promise.allSettled` records its outcome: `pull`, the
 * pull request's `{ number, base, head }`, `base` the merge base its diff is taken from and `head`
 * its head SHA, both as the forge answers them; `diff`; `comments`; and `editedAt`, the card's body's
 * last edit. These are the facts L2's judge answer reads, and a read that fails is answered as its
 * failure, which the judge answer names (`judgeAnswer`).
 */
async function reviewed(number, pull, reads) {
  const [base, diff, comments, editedAt] = await Promise.allSettled([
    reads.readMergeBase(pull.number), reads.readDiff(pull.number), reads.readComments(pull.number), reads.readEditedAt(number),
  ]);
  const read = base.status === 'fulfilled' ? { status: 'fulfilled', value: { number: pull.number, base: base.value.mergeBase, head: base.value.head } } : base;
  return { pull: read, diff, comments, editedAt };
}

/**
 * What the forge holds of card `number`'s line of work `line`, as `{ line, open, merged }`, the
 * pull requests from it read once through `reads.readPullRequests`, the forge adapter's read
 * side's, and, where exactly one is open and `review` holds, what `reviewed` reads of it beside
 * them. A read of the pull requests that fails rejects naming the card and the read.
 */
export async function pullRequestsFrom(number, line, reads, review = true) {
  const { open, merged } = await forCards([number], () => reads.readPullRequests(line));
  return { line, open, merged, ...(review && open.length === 1 ? await reviewed(number, open[0], reads) : {}) };
}

/**
 * L2's facts call over the board `config` names, through `reads`, the forge adapter's repository
 * reads (`repositoryReads`). `decide` is
 * L2's next action for a card, as the verb built it.
 *
 * Handed the cards L3 read, it reads, for each card in the `ready`, `coding` or `review` column,
 * what the forge holds of its line of work, the branch the topic rule names: whether the branch is
 * there, read once for every such card, and the open and merged pull requests from it, read for
 * each card in turn (the architect's ruling 2, P1, on #467). For a card in the `review` column
 * holding exactly one open pull request from it, it also reads what `reviewed` reads of that pull
 * request, the facts L2's judge answer reads. A read of the branches or the pull requests that
 * fails rejects naming each card it was reading for and the read, and answers no facts at all.
 *
 * It answers the `decide` L3 calls at the pull, synchronously: `decide` handed each card read with
 * its facts as `forge`, `{ stage, line, branch, open, merged }` with `reviewed`'s beside them where
 * they were read, `stage` naming the column's key, and any other card as it was. L3 reads nothing of this answer but calls it (the architect's
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
      const stage = stages.get(card.column);
      const facts = await pullRequestsFrom(card.number, line, reads, stage === 'review');
      held.set(card.number, { stage, branch: branches[line] === true, ...facts });
    }
    return (card, ...rest) => decide(held.has(card.number) ? { ...card, forge: held.get(card.number) } : card, ...rest);
  };
}
