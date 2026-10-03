// ABOUTME: L2's column changes: which column a card moves to when L3 claims it or hands L2 its
// dispatch's outcome, the move itself through the forge adapter's item-write side, and its event.

import { worktreeTopic } from '../config/validate.mjs';
import { topicFor } from '../execution/workspace.mjs';
import { repositoryReads } from '../substrate/forge/read.mjs';
import { itemWriteSide } from '../substrate/forge/item-write.mjs';
import { NOT_STARTED } from '../substrate/process.mjs';
import { pullRequestsFrom } from './facts.mjs';

/**
 * Each change L2 makes to a card's column, by its cause, as the column keys it leaves and enters.
 * No change enters `ready`: moving a card there is the owner's, never code's.
 */
const CHANGES = {
  claimed: { from: 'ready', to: 'coding' },
  redone: { from: 'review', to: 'coding' },
  returned: { from: 'coding', to: 'review' },
};

/**
 * L2's column changes on the board `config` names, each recorded through `sink`. `items` is the
 * forge adapter's item-write side for that board, whose move L2 hands an `L0` emitter it opens
 * from `sink`, and a test passes the fake board's operations in its place, or `send` in place of
 * the runners' spawn. `pullRequests` is the read side's read of the pull requests from a branch,
 * by which L2 settles a maker's outcome, and is the read side's own over `config`'s repository
 * where none is given.
 */
export function columnChanges({
  config, sink, send, items = itemWriteSide({ repo: config.repo, project: config.board.project }, { send }),
  pullRequests = repositoryReads({ ...config.board, repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0' }) }).readPullRequests,
}) {
  const { columns } = config.board;
  const topic = worktreeTopic(config);

  /**
   * Appends `card`'s transition event, or fails naming the card, both columns and the sink's
   * error. When Rigger has acted and cannot record it, it fails loudly and the event stays
   * missing, by the owner's ruling (#220; #277): written later, it would carry the wrong time.
   * Starting no further work is L3's halt, not L2's, so L2 keeps no note of the missing event.
   */
  const record = (card, transition) => {
    try {
      sink.emitter({ layer: 'L2', card: card.number }).emit('transition', transition);
    } catch (refusal) {
      const { from, to } = transition;
      throw new Error(`card #${card.number} moved from ${from} to ${to}, and the event sink refused to record it: ${refusal.message}`, { cause: refusal });
    }
  };

  /**
   * Moves `card` for `cause`, then records the move as one `transition` event. A move the board
   * refuses is recorded as nothing, and its caller is told which card and column it was. The move
   * is handed an `L0` emitter L2 opens from `sink` under the card, so every kill L0 makes in it is
   * recorded with the card's number.
   */
  const change = async (card, cause) => {
    const { from, to } = CHANGES[cause];
    try {
      await items.moveItem(card.id, columns[to], sink.emitter({ layer: 'L0', card: card.number }));
    } catch (refusal) {
      throw new Error(`card #${card.number}'s move from ${from} to ${to} (${columns[to]}) was refused: ${refusal.message}`, { cause: refusal });
    }
    record(card, { from, to, cause });
  };

  /**
   * Appends `event`, carrying `fields`, under `card`, or fails naming the card, what the event
   * said and the sink's error.
   */
  const note = (card, event, fields) => {
    try {
      sink.emitter({ layer: 'L2', card: card.number }).emit(event, fields);
    } catch (refusal) {
      throw new Error(`card #${card.number}: ${fields.reason ?? event}, and the event sink refused to record it: ${refusal.message}`, { cause: refusal });
    }
  };

  /**
   * Leaves `card` in coding after a maker exited 0, because `why`: records a `review.withheld`
   * event under the card saying why, and tells its caller the card and why.
   */
  const withheld = (card, why) => {
    note(card, 'review.withheld', { reason: why });
    throw new Error(`card #${card.number} stays in coding: ${why}`);
  };

  return {
    /**
     * L3 has claimed `card`, a board item as the forge adapter read it. A card claimed from coding
     * is there already, and is not moved. One claimed from review is done again from the
     * beginning, and moves to coding, where it shows while it is (`R-WORK-24`). Any other claim is
     * of a ready card, which moves to coding.
     */
    claimed: async (card) => {
      if (card.column === columns.coding) return;
      await change(card, card.column === columns.review ? 'redone' : 'claimed');
    },

    /**
     * L3 hands over `card`'s maker `outcome` unread, as `Promise.allSettled` records it: a
     * dispatch that ran and recorded its events is fulfilled with L1's result, its exit code
     * `exit` and its output `stdout` and `stderr`. The failure's `code` names three kinds of
     * rejection: a command that never started (`NOT_STARTED`), a refused event
     * (`EVENT_REFUSED`), which may carry the result of a command that ran, and a record that
     * refused a removal after the command ran (`RECORD_REFUSED`), which carries its result. L2
     * moves nothing on a rejection of any kind, and records one that never started as a
     * `maker.failed` event under the card, classed as the environment's, as it classes a step
     * that never started (the architect's ruling 5 on #467).
     *
     * For a fulfilled outcome, the exit code and the forge alone decide, never the output (the
     * owner's ruling on #220, refined by O5 on #467). Anything but zero leaves the card in coding,
     * and the forge is not read. Zero has L2 read once the pull requests from the card's line of
     * work: with exactly one open, the card moves to review (`R-WORK-18`), and L2 answers the
     * facts it read, `{ line, open, merged }`, to its caller; L3's handing them on unread is
     * #488's (the architect's ruling 3, AQ4). With none open, or more than one, the card stays in coding, and L2 records why and
     * tells its caller the card and why. A read that fails leaves it in coding too, and its
     * caller is told the card and the read.
     */
    settled: async (card, outcome) => {
      if (outcome?.status === 'rejected') {
        if (outcome.reason?.code === NOT_STARTED) note(card, 'maker.failed', { class: 'environment', reason: outcome.reason.message });
        return undefined;
      }
      const exit = outcome?.status === 'fulfilled' ? outcome.value?.exit : undefined;
      if (!Number.isInteger(exit)) {
        throw new Error(`card #${card.number}'s dispatch outcome is neither a dispatch that ran with an exit code nor one that threw: ${JSON.stringify(outcome)}`);
      }
      if (exit !== 0) return undefined;
      const facts = await pullRequestsFrom(card.number, topicFor(topic, card.number), pullRequests);
      const { line, open } = facts;
      if (open.length === 0) withheld(card, `its maker exited 0, and the forge holds no open pull request from its line of work ${line}`);
      if (open.length > 1) withheld(card, `its maker exited 0, and the forge holds more than one open pull request from its line of work ${line}: ${open.map((pull) => `#${pull.number}`).join(', ')}`);
      await change(card, 'returned');
      return facts;
    },
  };
}
