// ABOUTME: L2's column changes: which column a card moves to when L3 claims it or hands L2 its
// dispatch's outcome, the move itself through the forge adapter's item-write side, and its event.

import { worktreeTopic } from '../config/validate.mjs';
import { FIXED_LABELS, roleTimeout } from '../config/validate.mjs';
import { topicFor, SCRATCH_REFUSED, WORKSPACE_REFUSED } from '../execution/workspace.mjs';
import { readSide, repositoryReads } from '../substrate/forge/read.mjs';
import { itemWriteSide } from '../substrate/forge/item-write.mjs';
import { repositoryWriteSide } from '../substrate/forge/repository-write.mjs';
import { NOT_STARTED } from '../substrate/process.mjs';
import { escalationDestination, makerEscalation, makerNote, routingComment, escalationRoleInstruction } from './escalation.mjs';
import { acceptanceItems } from './form-check.mjs';
import { pullRequestsFrom } from './facts.mjs';
import { statusNotice } from './status-issue.mjs';
import { kindOf, providerOf, tierOf } from './next-action.mjs';
import { composeClockMark } from './clock-mark.mjs';

/**
 * Each change L2 makes to a card's column, by its cause, as the column keys it leaves and enters.
 * Only `created`, for a card L2 opens from a clock firing, enters `ready` in code.
 */
const CHANGES = {
  created: { to: 'ready' },
  claimed: { from: 'ready', to: 'coding' },
  redone: { from: 'review', to: 'coding' },
  returned: { from: 'coding', to: 'review' },
  sound: { from: 'review', to: 'owner' },
  continued: { from: 'review', to: 'coding' },
  continuedFromOwner: { from: 'owner', to: 'coding' },
  rejudged: { from: 'owner', to: 'review' },
  merged: { from: 'review', to: 'done' },
  mergedFromOwner: { from: 'owner', to: 'done' },
  conflicted: { from: 'review', to: 'coding' },
  conflictedFromOwner: { from: 'owner', to: 'coding' },
  escalated: { to: 'owner' },
};

/**
 * How many events a forge write's failure names as unrecorded, and each with its fields and the
 * sink's error, as a report of a write the forge made names them. A write side marks such a failure `made` where
 * the forge took the write and only its record was refused (`ARCHITECTURE.md`, "L0's call events").
 */
export const unrecordedNamed = ({ unrecorded }) => `${unrecorded.length} L0 event(s) went unrecorded: ${unrecorded
  .map(({ event, cause, ...fields }) => `${event} ${JSON.stringify(fields)}: ${cause?.message ?? cause}`).join('; ')}`;

/**
 * The report of `what`, a forge write the forge made, whose record the sink refused as `failure`
 * names, followed by `also`, any further event that went unrecorded.
 */
const madeUnrecorded = (what, failure, also = '') => new Error(`${what}, and the event sink refused to record it: ${unrecordedNamed(failure)}${also}`, { cause: failure });

/** The changes L2's `move` answers make, each the one change from its column to the column the answer names. */
const MOVES = ['sound', 'rejudged', 'merged', 'mergedFromOwner'];

/**
 * The `code` of the failure `settled` rejects with where a maker exited 0 and L2 left the card in
 * coding for what the forge holds, so its caller tells it from a refused event or a failed read
 * without reading the message. The failure carries the facts L2 read as `facts`.
 */
export const REVIEW_WITHHELD = 'REVIEW_WITHHELD';

/**
 * L2's column changes on the board `config` names, each recorded through `sink`. `items` is the
 * forge adapter's item-write side for that board, whose move L2 hands an `L0` emitter it opens
 * from `sink`, and a test passes the fake board's operations in its place, or `send` in place of
 * the runners' spawn. `reads` is the forge adapter's repository reads (`repositoryReads`), by which
 * L2 settles a maker's outcome when injected. `cardReads(card, dispatch)` builds a reader under
 * that card and optional dispatch, defaulting to the injected `reads` or the repository read side.
 * Maker settlement and refused-merge reads use it. `roleReads(card, dispatch)` supplies the
 * contextual reader for a completed escalation role. `board` is the read side's board reads, by
 * which L2's notice finds where the status issue stands on the board.
 */
export function columnChanges({
  config, sink, send, items = itemWriteSide({ repo: config.repo, project: config.board.project }, { send }),
  repositoryWrites,
  roleReads = (card, dispatch) => repositoryReads({ ...config.board, repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0', card, dispatch: dispatch ?? null }) }),
  reads,
  cardReads = (card, dispatch) => reads ?? repositoryReads({ ...config.board, repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0', card, dispatch }) }),
  board = readSide({ ...config.board, repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0' }) }),
}) {
  const { columns } = config.board;
  const topic = worktreeTopic(config);
  const repositoryFor = (card) => repositoryWrites ?? repositoryWriteSide({ repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0', card: card.number }) });

  /**
   * Appends `card`'s transition event, or fails naming the card, both columns and the sink's
   * error. When Rigger has acted and cannot record it, it fails loudly and the event stays
   * missing, by the owner's ruling (#220; #277): written later, it would carry the wrong time.
   * Starting no further work is L3's halt, not L2's, so L2 keeps no note of the missing event.
   */
  const record = (card, transition, context = {}) => {
    try {
      sink.emitter({ layer: 'L2', card: card.number, ...context }).emit('transition', transition);
    } catch (refusal) {
      const { from, to } = transition;
      throw new Error(`card #${card.number} moved ${from === undefined ? `to ${to} (${columns[to]})` : `from ${from} to ${to}`}, and the event sink refused to record it: ${refusal.message}`, { cause: refusal });
    }
  };

  /**
   * Moves `card` for `cause`, then records the move as one `transition` event. A move the board
   * refuses is recorded as nothing, and its caller is told which card and column it was. A move the
   * item-write side marks made still records its transition, and rejects naming the card, both
   * columns and each event that went unrecorded. The move
   * is handed an `L0` emitter L2 opens from `sink` under the card, so every kill L0 makes in it is
   * recorded with the card's number.
   */
  const change = async (card, cause, fields = {}, given = {}) => {
    const { from: declaredFrom, to } = CHANGES[cause];
    const from = cause === 'escalated' ? Object.keys(columns).find((key) => columns[key] === card.column) : declaredFrom;
    const context = cause === 'escalated' || cause === 'created' ? { dispatch: null } : given;
    const transitionFields = { ...(from === undefined ? {} : { from }), to, cause, ...fields };
    try {
      await items.moveItem(card.id, columns[to], sink.emitter({ layer: 'L0', card: card.number, ...context }));
    } catch (refusal) {
      if (!refusal.made) throw new Error(`card #${card.number}'s move ${from === undefined ? '' : `from ${from} `}to ${to} (${columns[to]}) was refused: ${refusal.message}`, { cause: refusal });
      // The board took the move, so its transition is still recorded where the sink takes it (`R-RECORD-6`).
      let transition = '';
      try {
        record(card, transitionFields, context);
      } catch (unrecorded) {
        transition = `; its transition went unrecorded too: ${unrecorded.cause.message}`;
      }
      throw madeUnrecorded(`card #${card.number} moved ${from === undefined ? `to ${to} (${columns[to]})` : `from ${from} to ${to}`}`, refusal, transition);
    }
    record(card, transitionFields, context);
  };

  /**
   * Appends `event`, carrying `fields`, under `card`, or fails naming the card, what the event
   * said and the sink's error.
   */
  const note = (card, event, fields, context = {}) => {
    try {
      sink.emitter({ layer: 'L2', card: card.number, ...context }).emit(event, fields);
    } catch (refusal) {
      throw new Error(`card #${card.number}: ${fields.reason ?? event}, and the event sink refused to record it: ${refusal.message}`, { cause: refusal });
    }
  };

  /**
   * Leaves `card` in coding after a maker exited 0, because `why`: records a `review.withheld`
   * event under the card saying why, and tells its caller the card and why, with the `facts` L2
   * read, as a `REVIEW_WITHHELD` failure.
   */
  const withheld = (card, why, facts, fields = {}, context = {}) => {
    note(card, 'review.withheld', { reason: why, ...fields }, context);
    throw Object.assign(new Error(`card #${card.number} stays in coding: ${why}`), { code: REVIEW_WITHHELD, facts });
  };

  /**
   * L3 hands over `next`, L2's `move` answer for `card` at the pull, unread: the card moves from
   * its column to the column the answer names, by the one change L2 makes between them. A move
   * L2 makes no change for is refused, naming the card and both columns, and nothing moves.
   */
  const moved = async (card, next) => {
    const from = Object.keys(columns).find((key) => columns[key] === card.column);
    const cause = MOVES.find((each) => CHANGES[each].from === from && CHANGES[each].to === next.to);
    if (cause === undefined) throw new Error(`card #${card.number} has no move from ${from ?? card.column} to ${next.to}`);
    await change(card, cause);
  };

  /** Records the destination and evidence before either escalation write. */
  const recordEscalation = (card, next) => {
    const evidence = {
      category: next.category, reason: next.reason, raiser: next.raiser ?? 'loop',
      ...(next.item === undefined ? {} : { item: next.item }),
      ...Object.fromEntries(['pull', 'head', 'line', 'destination'].filter((key) => next[key] !== undefined).map((key) => [key, next[key]])),
    };
    try {
      sink.emitter({ layer: 'L2', card: card.number, dispatch: next.dispatch ?? null }).emit('review.escalate', evidence);
    } catch (refusal) {
      throw new Error(`card #${card.number}'s escalation in category ${next.category} was refused: review.escalate could not be recorded: ${refusal.message}`, { cause: refusal });
    }
    return evidence;
  };

  return {
    /** Open the due firing's card, add it to the board and place it in Ready. */
    openClockCard: async (name, occurrence, template) => {
      const author = (template.author ?? 'owner').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
      const body = `${composeClockMark(name, occurrence)}\n\n**Author:** ${author}\n\n## Acceptance\n\n${template.acceptance}`;
      const writes = repositoryWrites ?? repositoryWriteSide({ repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0' }) });
      let number;
      try {
        number = await writes.openIssue(template.title, body, ...template.labels);
      } catch (refusal) {
        if (refusal.made) throw madeUnrecorded(`clock trigger ${name} at ${new Date(occurrence).toISOString()} opened issue #${refusal.made.answer}`, refusal);
        throw new Error(`clock trigger ${name} at ${new Date(occurrence).toISOString()} could not open its card: ${refusal.message}`, { cause: refusal });
      }
      let id;
      try {
        id = await items.addIssue(number, sink.emitter({ layer: 'L0', card: number }));
      } catch (refusal) {
        if (refusal.made) throw madeUnrecorded(`issue #${number} was added to the board`, refusal);
        throw new Error(`opened issue #${number}'s board add was refused: ${refusal.message}`, { cause: refusal });
      }
      await change({ number, id }, 'created');
      return number;
    },

    /** L2's notice function for a hold's closer, as `statusNotice` says, its item writes recorded under `L0`. */
    notice: statusNotice({ reads: reads ?? repositoryReads({ ...config.board, repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0' }) }), writes: repositoryWrites ?? repositoryWriteSide({ repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0' }) }), board, items: { addIssue: (number) => items.addIssue(number, sink.emitter({ layer: 'L0' })), moveItem: (id, column) => items.moveItem(id, column, sink.emitter({ layer: 'L0' })) }, columns, sink }),

    /**
     * L3 has claimed `card`, a board item as the forge adapter read it, on `next`, L2's answer for
     * it at the pull, which L3 hands over unread. A card claimed from coding is there already, and
     * is not moved, and so is one claimed for its judges, which stays in review. One otherwise
     * claimed from review is done again from the beginning, and moves to coding, where it shows
     * while it is (`R-WORK-24`). Any other claim is of a ready card, which moves to coding. A card
     * L2 answered as a continuing attempt moves to coding from review or owner by its continuing
     * change, never as `redone`, since its work goes on from what was pushed; from coding it stays.
     */
    claimed: async (card, next) => {
      if (next?.action === 'continue' && card.column !== columns.coding) {
        await change(card, card.column === columns.owner ? 'continuedFromOwner' : 'continued');
        return;
      }
      if (card.column === columns.coding || next?.action === 'judge') return;
      await change(card, card.column === columns.review ? 'redone' : 'claimed');
    },

    moved,

    /**
     * L3's lane hands over `next`, L2's `merge` answer for `card` from its rule run again at the
     * lane: L2 merges the pull request it names at the head it names through the repository-write
     * side, and marks an unknown-mergeability refusal for L3's full re-read. Other answers pass
     * through unread, and a failed call rejects as it did.
     */
    merge: async (card, next) => {
      const answer = await repositoryFor(card).mergePullRequest(next.pull, next.head);
      return answer.outcome === 'refused' && answer.reason === 'unknown' ? { ...answer, unknownMergeability: true } : answer;
    },

    /**
     * L3's lane hands over `answer`, what L2's `merge` answered for `card` on `next`, once it has
     * recorded the merge's end. A merge the forge made, or had made already, moves the card to Done
     * from its column, as `moved` moves it. A refused merge has L2 read the pull request's
     * mergeability, and only that read decides a conflict, never the refusal's reason (the
     * architect's r3 ruling 5): read as conflicting, the card moves to coding, its transition's cause
     * naming the conflict, where its maker continues on the pull request (`R-CONFLICT-1`). Any other
     * refusal leaves the card where it is. A read that fails leaves it there too, and rejects naming
     * the card and the read.
     */
    mergeEnded: async (card, next, answer) => {
      if (['merged', 'already merged'].includes(answer.outcome)) {
        await moved(card, { to: 'done' });
        return;
      }
      if (answer.outcome !== 'refused' || answer.unknownMergeability) return;
      let mergeable;
      try {
        mergeable = await cardReads(card.number).readMergeable(next.pull);
      } catch (failure) {
        throw new Error(`card #${card.number}'s merge of pull request #${next.pull} was refused, and L2 could not read its mergeability: ${failure.message}`, { cause: failure });
      }
      if (mergeable === 'conflicting') await change(card, card.column === columns.owner ? 'conflictedFromOwner' : 'conflicted');
    },

    /** Posts L2's return comment on its pull request, without changing the card's column. */
    returned: async (card, next) => {
      try {
        await repositoryFor(card).postComment(next.pull, next.comment);
      } catch (refusal) {
        if (refusal.made) throw madeUnrecorded(`card #${card.number}'s return comment on pull request #${next.pull} was posted`, refusal);
        throw new Error(`card #${card.number}'s return comment on pull request #${next.pull} was refused: ${refusal.message}`, { cause: refusal });
      }
    },

    /** Posts the route before L3 makes any directory or dispatches the role. */
    routed: async (card, next) => {
      const name = next.destination;
      const declared = config.roles[name];
      const { provider, conflict } = providerOf(card, name, declared, 'escalation');
      if (conflict !== undefined) return ownerEscalation(next, { category: 'ambiguous', reason: conflict });
      const { tier, conflict: tierConflict } = tierOf(card, name, declared, 'escalation');
      if (tierConflict !== undefined) return ownerEscalation(next, { category: 'ambiguous', reason: tierConflict });
      recordEscalation(card, next);
      const writes = repositoryWrites ?? repositoryWriteSide({ repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0', card: card.number, dispatch: next.dispatch ?? null }) });
      try {
        await writes.postIssueComment(card.number, routingComment(next));
      } catch (refusal) {
        if (refusal.made) throw madeUnrecorded(`card #${card.number}'s routing comment was posted`, refusal);
        const reason = `card #${card.number}'s routing comment was refused: ${refusal.message}`;
        note(card, 'escalation.route-refused', { reason }, { dispatch: next.dispatch ?? null });
        throw new Error(reason, { cause: refusal });
      }
      return { ...next, action: 'dispatch', role: { role: name, agent: declared.agent, provider, tier, timeout: roleTimeout(declared), ...escalationRoleInstruction(card, next) } };
    },

    /** Settles the escalation role against the forge under the card's existing claim. */
    roleSettled: async (card, next, outcome, { dispatch, firstFailure } = {}) => {
      if (outcome.status === 'rejected' && [WORKSPACE_REFUSED, SCRATCH_REFUSED].includes(outcome.reason?.code)) return ownerEscalation(next, { category: 'ambiguous', reason: outcome.reason.message, dispatch });
      if (outcome.status === 'rejected' && outcome.reason?.code === NOT_STARTED) {
        if (firstFailure === undefined) return { action: 'again' };
        return ownerEscalation(next, { category: 'ambiguous', reason: `role ${next.destination} did not start twice: ${firstFailure.reason.message}; ${outcome.reason.message}`, dispatch });
      }
      if (outcome.status === 'rejected') return undefined;
      const reading = roleReads(card.number, dispatch);
      const comments = await reading.readIssueComments(card.number);
      const note = makerNote(comments, dispatch, acceptanceItems(card.body ?? '').length);
      const facts = await pullRequestsFrom(card.number, next.line, reading, false);
      const { pull: priorPull, head: priorHead, ...route } = next;
      const current = { ...route, ...(facts.open.length === 1 ? { pull: facts.open[0].number, head: facts.open[0].head } : {}) };
      if (note !== null) return ownerEscalation(current, note);
      if (outcome.value.exit !== 0) return ownerEscalation(current, { category: 'ambiguous', reason: `role ${next.destination} exited ${outcome.value.exit}`, dispatch });
      if (facts.open.length === 1) await change(card, 'returned', {}, { dispatch: dispatch ?? null });
      return { action: 'handled', facts };
    },

    /** Records the escalation, then comments on its issue, moves to Owner and labels it. */
    escalated: async (card, next) => {
      const evidence = recordEscalation(card, next);
      const writes = repositoryWrites ?? repositoryWriteSide({ repo: config.repo }, { send, emitter: sink.emitter({ layer: 'L0', card: card.number, dispatch: null }) });
      try {
        await writes.postIssueComment(card.number, escalationComment(card, evidence));
      } catch (refusal) {
        if (refusal.made) throw madeUnrecorded(`card #${card.number}'s escalation issue comment was posted`, refusal);
        throw new Error(`card #${card.number}'s escalation issue comment was refused: ${refusal.message}`, { cause: refusal });
      }
      await change(next.from === undefined ? card : { ...card, column: columns[next.from] }, 'escalated');
      try {
        await writes.addIssueLabel(card.number, FIXED_LABELS.escalated);
      } catch (refusal) {
        if (refusal.made) throw madeUnrecorded(`card #${card.number}'s escalation label ${FIXED_LABELS.escalated} was added`, refusal);
        throw new Error(`card #${card.number}'s escalation label ${FIXED_LABELS.escalated} was refused: ${refusal.message}`, { cause: refusal });
      }
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
     * For a fulfilled outcome, the forge's issue comments are read before the exit code. A valid
     * note under the maker's dispatch answers an escalation without a move, with any one open pull
     * request and its head read from the line of work. Otherwise the exit code and the forge alone
     * decide, never the output (the owner's ruling on #220, refined by O5 on #467). Anything but
     * zero leaves the card in coding. Zero has L2 read the pull requests from the card's line of work
     * and, where exactly one is open, what L2's judge answer reads of it, as
     * `pullRequestsFrom` reads them. For a continuing attempt, a head other than `expectedHead`
     * answers `waiting` until L3's last read, when L2 withholds review and names both heads.
     * With exactly one open at the expected head, the card moves to review (`R-WORK-18`),
     * and L2 answers the facts it read, `{ line, open, merged, closed }` with those beside them, to its
     * caller, which hands them back unread to L2's next action (the architect's ruling 3, AQ4). With
     * none open, or more than one, the card stays in coding, and L2 records why and
     * tells its caller the card and why, as `withheld` says. A read that fails leaves it in coding too, and its
     * caller is told the card and the read.
     */
    settled: async (card, outcome, { dispatch, expectedHead, tipFailure, lastForgeHead, last = false, reads: readCount, elapsedMs } = {}) => {
      if (outcome?.status === 'rejected') {
        if (outcome.reason?.code === NOT_STARTED) note(card, 'maker.failed', { class: 'environment', reason: outcome.reason.message }, { dispatch });
        return undefined;
      }
      const exit = outcome?.status === 'fulfilled' ? outcome.value?.exit : undefined;
      if (!Number.isInteger(exit)) {
        throw new Error(`card #${card.number}'s dispatch outcome is neither a dispatch that ran with an exit code nor one that threw: ${JSON.stringify(outcome)}`);
      }
      const reading = cardReads(card.number, dispatch);
      let comments;
      try {
        comments = await reading.readIssueComments(card.number);
      } catch (failure) {
        throw new Error(`card #${card.number}'s issue comments could not be read: ${failure.message}`, { cause: failure });
      }
      const escalation = makerNote(comments, dispatch, acceptanceItems(card.body ?? '').length);
      if (escalation !== null) {
        let facts;
        try {
          facts = await pullRequestsFrom(card.number, topicFor(topic, card.number), reading);
        } catch (failure) {
          throw new Error(`card #${card.number}'s pull requests could not be read for its escalation: ${failure.message}`, { cause: failure });
        }
        const kinds = config.kinds ?? {};
        const { kind } = kindOf({ ...card, labels: card.labels ?? [] }, kinds, config.epicLabel);
        const answer = makerEscalation(escalation, facts);
        return { ...answer, destination: escalationDestination({ ...answer, escalate: config.escalate, maker: kinds[kind]?.maker, judges: kinds[kind]?.judges, comments }) };
      }
      if (exit !== 0) return undefined;
      if (tipFailure !== undefined) withheld(card, `card #${card.number}'s maker exited 0, but L1 could not read the tip of its line of work in the workspace: ${tipFailure.message}`, undefined, {}, { dispatch });
      let facts;
      try {
        facts = await pullRequestsFrom(card.number, topicFor(topic, card.number), reading);
      } catch (failure) {
        if (expectedHead === undefined) throw failure;
        withheld(card, failure.message, undefined, {
          ...(lastForgeHead === undefined ? {} : { forgeHead: lastForgeHead }),
          ...(readCount > 1 ? { reads: readCount, elapsedMs } : {}),
        }, { dispatch });
      }
      const { line, open } = facts;
      const observed = expectedHead === undefined ? {} : {
        ...(open.length === 1 ? { forgeHead: open[0].head } : lastForgeHead === undefined ? {} : { forgeHead: lastForgeHead }),
        ...(readCount > 1 ? { reads: readCount, elapsedMs } : {}),
      };
      if (open.length === 0) withheld(card, `its maker exited 0, and the forge holds no open pull request from its line of work ${line}`, facts, observed, { dispatch });
      if (open.length > 1) withheld(card, `its maker exited 0, and the forge holds more than one open pull request from its line of work ${line}: ${open.map((pull) => `#${pull.number}`).join(', ')}`, facts, observed, { dispatch });
      if (expectedHead !== undefined && open[0].head !== expectedHead) {
        if (!last) return { waiting: true, forgeHead: open[0].head };
        withheld(card, `card #${card.number}'s maker exited 0 at head ${expectedHead}, but the forge last showed pull request #${open[0].number} at head ${open[0].head}`, facts, observed, { dispatch });
      }
      await change(card, 'returned', observed, { dispatch });
      return facts;
    },
  };
}

/** The selected reason and available work identifiers, as data on the card's issue. */
function escalationComment(card, { category, item, reason, pull, head, line }) {
  const work = [
    ...(item === undefined ? [] : [`Acceptance item: ${item}`]),
    ...(pull === undefined ? [] : [`Pull request: #${pull}`]),
    ...(head === undefined ? [] : [`Head: ${head}`]),
    ...(line === undefined ? [] : [`Line of work: ${line}`]),
  ];
  return `Rigger escalates card #${card.number} to the owner (${category}).\n\n${reason}${work.length === 0 ? '' : `\n\n${work.join('\n')}`}\n`;
}

/** A role's unresolved card always returns through L2's one destination function as loop-raised. */
function ownerEscalation(next, fields) {
  const answer = { ...next, ...fields, action: 'escalate', raiser: 'loop' };
  return { ...answer, destination: escalationDestination(answer) };
}
