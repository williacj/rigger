// ABOUTME: L2's status issue: the title, body and comment a hold's notice writes, the hold's id
// parsed back from them, and the notice function, phased so that L3 makes every rename it answers.

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
 * L2's notice function, over the forge adapter's `reads`, repository `writes`, `board` reads and
 * item writes `items`, placing by `columns` and recording through `sink`. It answers, for one hold's
 * `closer` as L3 listed it, an async generator L3 drives (the architect's placement ruling on
 * #1016): each value it yields is the rename the closer is to take, `{ rename: 'after' | 'issue',
 * number }`, which L3 makes through `admission.mjs` and hands back unread, as `next(outcome)`, before
 * L2 writes again. L2 holds no admission handle and no callback. Where a rename found its closer
 * gone, L3 ends the call, and L2 writes nothing more. It returns `{ issue }`, the status issue.
 */
export function statusNotice({ reads, writes, board, items, columns, sink }) {
  const status = FIXED_LABELS.status;
  /** Whether `issue`, as `readIssue` answers it, is open and carries the status label. */
  const isStatus = (issue) => issue !== null && issue.state === 'open' && issue.labels.includes(status);
  return async function* notice({ closer, others = [], hold, admission }) {
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
    try {
      let number = closer.after === undefined ? undefined : await scanned();
      if (number !== undefined) yield* renamed('issue', number);
      else number = yield* written();
      const item = (await step('read the board', () => board.readItems())).find((each) => each.number === number);
      if (item?.column !== columns.owner) {
        const id = item?.id ?? await step(`add issue #${number} to the board`, () => items.addIssue(number));
        await step(`move issue #${number} to Owner`, () => items.moveItem(id, columns.owner));
      }
      return { issue: number };
    } catch (failure) {
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
  };
}
