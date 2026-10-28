// ABOUTME: L2's status issue: the title, body and comment a hold's notice writes, the hold's id
// parsed back from them, and the notice function, phased so that L3 makes every rename it answers,
// which also follows the notice on an issue a closer names and closes the status issues for `resume`.

import { FIXED_LABELS } from '../config/validate.mjs';

import { WRITERS } from './marker.mjs';

/** The status issue's title (`R-SCHED-20`). */
export const TITLE = 'Rigger closed admission';

/** The line naming a hold's id, which `holdOf` parses back. */
const holdLine = (id) => `Hold: \`${id}\``;

/** What failed in an attempt, as L2's failure names it: a step, the maker, the workspace or the judge. */
const failedPart = (failure) => (failure.step !== undefined ? `step \`${failure.step}\``
  : failure.maker !== undefined ? `maker \`${failure.maker}\`` : failure.judge !== undefined ? `judge \`${failure.judge}\`` : failure.workspace !== undefined ? 'workspace' : 'dispatch');

/**
 * The status issue's body for hold `id`: its closer's `reason` and `run`, and, where it is opened at
 * the hold, from L2's `hold` answer, the failing card, each attempt's class and what failed, the
 * dispatch ids of the attempts that recorded one, and `admission`, the admission directory's path.
 */
export function holdBody({ id, reason, run, hold, admission }) {
  const attempts = hold === undefined ? [] : [hold.firstFailure, hold.failure];
  const dispatches = attempts.map((failure) => failure?.dispatch).filter((dispatch) => dispatch !== undefined);
  const lines = [
    ...(hold === undefined ? [] : [`- Card: #${hold.card}`]),
    ...attempts.map((failure, at) => `- Attempt ${at + 1}: ${failure.class}, ${failedPart(failure)}`),
    ...(dispatches.length === 0 ? [] : [`- Dispatch ids: ${dispatches.join(', ')}`]),
    `- Run: ${run}`,
    ...(admission === undefined ? [] : [`- Admission record: ${admission}`]),
  ];
  return `${TITLE}: ${reason}\n\n${lines.join('\n')}\n\n${holdLine(id)}\n`;
}

/**
 * The comment for hold `id` on a status issue already open (`R-SCHED-25`): its closer's `reason`,
 * and the failing `card` where the hold names one.
 */
export const holdComment = ({ id, reason, card }) => `Rigger closed admission again: ${reason}\n\n${card === undefined ? '' : `- Card: #${card}\n\n`}${holdLine(id)}\n`;

/** The hold's id the body or comment `text` names, or null where it names none. */
export const holdOf = (text) => /^Hold: `([0-9a-z]+)`$/m.exec(String(text ?? ''))?.[1] ?? null;

/**
 * Where hold `id`'s notice stands on an issue L2 read: `closed` where the timeline shows a close
 * after the notice reached it, made while the issue carried the status label `status`; otherwise
 * `reached` where the opening or a comment names the hold's id. `opened` is whether the issue's
 * opening names it, by an account with write access. A comment counts only where an account with
 * write access wrote it and it was never edited. The timeline's order is the order that counts, so
 * a close and a reopen between two reads still count, and a label applied at the opening is carried
 * from it.
 */
function noticeIn(id, status, opened, timeline) {
  let reached = opened;
  let labelled = false;
  for (const entry of timeline) {
    if (entry.label === status) labelled = entry.kind === 'labeled';
    if (entry.kind === 'comment' && holdOf(entry.body) === id && WRITERS.includes(entry.permission) && !entry.edited) reached = true;
    if (entry.kind === 'closed' && reached && labelled) return { closed: true, reached };
  }
  return { closed: false, reached };
}

/**
 * L2's notice function, over the forge adapter's `reads`, repository `writes`, `board` reads and
 * item writes `items`, placing by `columns` and recording through `sink`. It answers, for one hold's
 * `closer` as L3 listed it, an async generator L3 drives (the architect's placement ruling on
 * #1016): each value it yields is the rename the closer is to take, `{ rename: 'after' | 'issue',
 * number }`, which L3 makes through `admission.mjs` and hands back unread, as `next(outcome)`, before
 * L2 writes again. L2 holds no admission handle and no callback. Where a rename found its closer
 * gone, L3 ends the call, and L2 writes nothing more. It returns `{ issue }`, the status issue, or
 * `{ failed }`, naming the step it stopped at and the cause, and, where the forge made that step's
 * write and the sink refused its events, its `made` mark and those `unrecorded` events.
 *
 * For a closer naming an issue, L3 hands over `state`, the issue's state as it read it, and L2
 * follows the notice there, as `ARCHITECTURE.md`, "Failure model", says: it answers `{ issue,
 * closed: true }` where the notice closed for that hold, for L3 to remove its closer; places the
 * issue in Owner where it is still the notice, first commenting where the notice never reached it;
 * and otherwise finds or opens another, as the hold's steps 2 to 6 do.
 *
 * The function also carries `close`, `rigger resume`'s third step.
 */
export function statusNotice({ reads, writes, board, items, columns, sink }) {
  const status = FIXED_LABELS.status;
  /** Whether `issue`, as `readIssue` answers it, is open and carries the status label. */
  const isStatus = (issue) => issue !== null && issue.state === 'open' && issue.labels.includes(status);
  async function* notice({ closer, others = [], hold, admission, state }) {
    let at;
    /** Answers `act`'s answer as the step `named`, so that a failure names that step. */
    const step = (named, act) => {
      at = named;
      return act();
    };
    /** Answers the rename to `rename` `number`, for L3 to make; the outcome L3 hands back failing it fails the call. */
    async function* renamed(rename, number) {
      const outcome = yield { rename, number };
      at = 'rename the closer';
      if (outcome?.status === 'rejected') throw outcome.reason;
    }
    /**
     * The number of the issue above the after-name's `k` and up to the newest whose body names the
     * hold's id, written by an account with write access, or undefined where none is.
     */
    const scanned = async () => {
      const newest = await step('read the newest number', () => reads.readNewestNumber());
      for (let candidate = Number(closer.after) + 1; candidate <= newest; candidate += 1) {
        const issue = await step(`read issue #${candidate}`, () => reads.readIssue(candidate));
        if (issue === null || holdOf(issue.body) !== closer.id || issue.author === null) continue;
        if (WRITERS.includes(await step(`read ${issue.author}'s permission`, () => reads.readPermission(issue.author)))) return candidate;
      }
      return undefined;
    };
    /**
     * How the notice stands on the issue the closer names: `closed`, `notice` once L2 has commented
     * where the notice never reached the open labelled issue, or `gone` where it is no longer the
     * hold's notice.
     */
    const followed = async (number) => {
      if (state === 'none') return 'gone';
      const issue = await step(`read issue #${number}`, () => reads.readIssue(number));
      if (issue === null) return 'gone';
      const timeline = await step(`read issue #${number}'s timeline`, () => reads.readIssueTimeline(number));
      const opened = holdOf(issue.body) === closer.id && issue.author !== null
        && WRITERS.includes(await step(`read ${issue.author}'s permission`, () => reads.readPermission(issue.author)));
      const { closed, reached } = noticeIn(closer.id, status, opened, timeline);
      if (closed) return 'closed';
      if (!isStatus(issue)) return 'gone';
      if (!reached) await step(`comment on issue #${number}`, () => writes.postIssueComment(number, holdComment({ id: closer.id, reason: closer.reason, card: hold?.card })));
      return 'notice';
    };
    try {
      let number = closer.after === undefined ? undefined : await scanned();
      const named = closer.issue === undefined ? undefined : Number(closer.issue);
      const follows = named === undefined ? undefined : await followed(named);
      if (follows === 'closed') return { issue: named, closed: true };
      if (follows === 'notice') number = named;
      else if (number !== undefined) yield* renamed('issue', number);
      else number = yield* written();
      const item = (await step('read the board', () => board.readItems())).find((each) => each.number === number);
      if (item?.column !== columns.owner) {
        const id = item?.id ?? await step(`add issue #${number} to the board`, () => items.addIssue(number));
        await step(`move issue #${number} to Owner`, () => items.moveItem(id, columns.owner));
      }
      return { issue: number };
    } catch (failure) {
      // A write the forge made, whose event the sink refused, failed nowhere: L2 records no
      // notice.failed of it, since the sink is refusing, and returns it under the `failed` L3 passes
      // on, with its mark and its unrecorded events, for the verb to say (the architect's placement
      // ruling on #1056).
      if (failure?.made !== undefined) return { failed: { step: at, cause: failure.message, made: failure.made, unrecorded: failure.unrecorded } };
      const failed = { step: at, cause: failure.message };
      sink.emitter({ layer: 'L2' }).emit('notice.failed', { hold: closer.id, ...failed });
      return { failed };
    }

    /** The hold's steps 2 to 5: picks an issue and comments on it, or opens one, answering its number. */
    async function* written() {
      let number;
      for (const other of others) {
        if (isStatus(await step(`read issue #${other}`, () => reads.readIssue(other)))) {
          number = other;
          break;
        }
      }
      number ??= (await step(`read the open issues labelled ${status}`, () => reads.readLabelledIssues(status)))[0];
      if (number !== undefined) {
        yield* renamed('issue', number);
        await step(`comment on issue #${number}`, () => writes.postIssueComment(number, holdComment({ id: closer.id, reason: closer.reason, card: hold?.card })));
      } else {
        yield* renamed('after', await step('read the newest number', () => reads.readNewestNumber()));
        number = await step('open the status issue', () => writes.openIssue(TITLE, holdBody({ id: closer.id, reason: closer.reason, run: closer.run, hold, admission }), status));
        yield* renamed('issue', number);
      }
      return number;
    }
  }

  /**
   * `rigger resume`'s third step, once it has removed the closers it read: closes each issue in
   * `named`, the numbers the closers' file names gave, and every other open issue carrying the
   * status label. For each, it removes the label where the issue carries it, then closes it. An
   * issue the repository no longer holds, or already closed, takes no write. A read or write refused
   * for one issue leaves it open, and L2 goes on to the next. Answers `{ closed, left, unread }`:
   * the numbers it closed, each issue left open as `{ issue, why }`, and, where the read of the
   * labelled issues was refused, why, in which case only the issues `named` gave were closed.
   */
  notice.close = async (named) => {
    let labelled = [];
    let unread;
    try {
      labelled = await reads.readLabelledIssues(status);
    } catch (failure) {
      unread = failure.message;
    }
    const closed = [];
    const left = [];
    for (const number of [...new Set([...named, ...labelled])]) {
      try {
        const issue = await reads.readIssue(number);
        if (issue === null || issue.state === 'closed') continue;
        if (issue.labels.includes(status)) await writes.removeIssueLabel(number, status);
        await writes.closeIssue(number);
        closed.push(number);
      } catch (failure) {
        left.push({ issue: number, why: failure.message });
      }
    }
    return { closed, left, ...(unread === undefined ? {} : { unread }) };
  };
  return notice;
}
