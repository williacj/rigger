// ABOUTME: L3's loop: the pull trigger that reads the board, claims up to N cards in pull order
// before any await, has L2 carry each claimed answer, and drives its attempts: L1 makes the workspace,
// L3 dispatches each step L2 names one at a time, then the maker through L1, or attempts the card again as L2
// says, and then the judges or escalation role L2 names, under the one claim and slot; the run that fires that trigger
// again each time a slot frees, excluding stopped cards and withheld judges for that run; the merge claims
// it hands the repo lane; the drain trigger; and L3's events.

import { randomUUID } from 'node:crypto';

import { roleDispatch } from '../execution/role.mjs';
import { SCRATCH_REFUSED } from '../execution/workspace.mjs';
import { dispatch as dispatchOnL1 } from '../execution/run.mjs';
import { stepDispatch } from '../execution/step.mjs';
import { EVENT_REFUSED, NOT_STARTED, whenElapsed } from '../substrate/process.mjs';
import { dispatched } from '../workflow/marker.mjs';
import { dispatchedEscalation } from '../workflow/escalation.mjs';
import { causeOf } from '../workflow/status-issue.mjs';
import { admission, admissionPath, admissions } from './admission.mjs';
import { lane } from './lane.mjs';
import { pullOrder } from './pull-order.mjs';
import { DEFAULT_CONCURRENCY } from '../config/validate.mjs';
import { report as deriveReport } from '../observation/report.mjs';
import { clockReports } from './clock.mjs';

/** The states an issue's state read answers. */
const ISSUE_STATES = ['open', 'closed', 'none'];

/** The most entries L3 reads of one list; it names how many more a longer list held, unread. */
const WIDEST = 10_000;

/** How deep L3 follows a value it did not build, which bounds its nesting and nothing else. */
const DEEPEST = 16;

const isObject = (value) => value !== null && (typeof value === 'object' || typeof value === 'function');

/**
 * One snapshot of values L3 did not build, as L3 hands them on, and the only code in L3 that runs
 * any code such a value supplies. Each operation on a foreign object, a field read, its prototype
 * chain, its keys, its string conversion, is made once in the snapshot however many paths reach the
 * object, and each list's entries and each failure's snapshot are made once and shared by every
 * path that meets it again, so a value that answers differently a second time is never asked twice.
 */
function snapshotting() {
  const memo = new Map();
  // The entries L3 could not read, each an Error of L3's own naming it, and the values copied for the
  // value this snapshot is copying, which it bounds so a value that makes a fresh value at each read ends.
  const unread = new WeakSet();
  // What this snapshot made, which it hands on as it is when it meets it again.
  const produced = new WeakSet();
  const kept = (value) => {
    if (isObject(value)) produced.add(value);
    return value;
  };
  let nodes = 0;
  const past = `a value L3 did not copy, past the ${WIDEST} values it copies of one value it hands on`;
  /** What `make()` answers for `value` under `what`, made once in this snapshot and never throwing. */
  const held = (value, what, make, otherwise) => {
    const made = () => {
      try {
        return make();
      } catch {
        return otherwise;
      }
    };
    if (!isObject(value)) return made();
    if (!memo.has(value)) memo.set(value, new Map());
    const of = memo.get(value);
    if (!of.has(what)) {
      of.set(what, otherwise);
      of.set(what, made());
    }
    return of.get(what);
  };
  const read = (value, key) => held(value, `.${String(key)}`, () => value?.[key], undefined);
  const chain = (value) => held(value, 'chain', () => {
    const prototypes = [];
    for (let at = value; isObject(at) && prototypes.length < DEEPEST;) prototypes.push((at = Reflect.getPrototypeOf(at)));
    return prototypes;
  }, []);

  /**
   * One printable line saying what `value` was, as `causeOf` says it: an Error's message, a
   * string, a Symbol's description, `null` or `undefined` as written, and otherwise the value's own
   * string, each made through this snapshot. A value whose line could not be made, or met again
   * while its own line is being made, is said by its kind.
   */
  const text = (value) => held(value, 'text', () => {
    if (!isObject(value)) return causeOf(value);
    const message = chain(value).includes(Error.prototype) ? read(value, 'message') : undefined;
    const said = message === undefined || message === '' ? (chain(value).includes(Error.prototype) ? '' : String(value)) : text(message);
    return said === '' ? `a thrown ${typeof value}` : said;
  }, `a thrown ${typeof value}`);

  /**
   * The entries of `list` as `{ entries, missing }`: `entries` a fresh array of its first WIDEST
   * entries, its `length` and each index read once, never through a method of its own; and
   * `missing`, where `list` held more, claimed a length no array can have or could not be read, a
   * line saying which entries went unread, so a caller says so rather than dropping them.
   * Undefined where `list` is no array.
   */
  const entries = (list) => {
    let array = false;
    try {
      array = Array.isArray(list);
    } catch {
      array = false;
    }
    return array ? held(list, 'entries', () => {
      const length = read(list, 'length');
      if (!Number.isSafeInteger(length) || length < 0) return { entries: [], missing: `entries L3 could not read, as the list claimed a length of ${text(length)}` };
      // Each index is read once, without a memo of its own: the list's entries are made once.
      const answer = { entries: Array.from({ length: Math.min(length, WIDEST) }, (_, at) => {
        try {
          return list[at];
        } catch {
          const failed = new Error(`entry ${at} of the list L3 could not read`);
          unread.add(failed);
          return failed;
        }
      }) };
      if (length > WIDEST) answer.missing = `and ${length - WIDEST} more entries L3 did not read, past the first ${WIDEST} of the ${length} the list held`;
      return answer;
    }, { entries: [], missing: 'entries L3 could not read' }) : undefined;
  };
  const own = (value) => held(value, 'keys', () => Object.keys(value), []);

  /** `view`'s bytes as a fresh Buffer, read through the language's own getters, never the view's. */
  const bytes = (view) => {
    const proto = chain(view).includes(DataView.prototype) ? DataView.prototype : Object.getPrototypeOf(Uint8Array.prototype);
    const [buffer, offset, length] = ['buffer', 'byteOffset', 'byteLength'].map((key) => Reflect.apply(Object.getOwnPropertyDescriptor(proto, key).get, view, []));
    return kept(Buffer.from(Buffer.from(buffer, offset, length)));
  };

  /**
   * A fresh copy of `value`: its strings, numbers and booleans kept, a failure as `failure`
   * snapshots it, a list's entries and an object's own fields copied to DEEPEST levels, a list's
   * `missing` line carried as its last entry, and anything else its line. An object met again is
   * the same copy, and one met again within itself is said as such.
   */
  const copy = (value, depth = 0) => {
    if (!isObject(value)) return typeof value === 'symbol' ? text(value) : value;
    if (unread.has(value)) return value.message;
    if (produced.has(value)) return value;
    if (chain(value).includes(Error.prototype)) return failure(value, depth);
    // Bytes, such as a dispatch's output, are copied as bytes.
    if (ArrayBuffer.isView(value)) return held(value, 'copy', () => bytes(value), text(value));
    if (depth >= DEEPEST) return text(value);
    return held(value, 'copy', () => kept((() => {
      if ((nodes += 1) > WIDEST) return past;
      const list = entries(value);
      if (list !== undefined) return [...list.entries.map((each) => copy(each, depth + 1)), ...(list.missing === undefined ? [] : [list.missing])];
      return Object.fromEntries(own(value).map((key) => [key, copy(read(value, key), depth + 1)]));
    })()), 'a value met again within itself');
  };

  /**
   * A snapshot of `thrown`, whatever was thrown, as a failure L3 built itself, holding only fresh
   * values made from this snapshot: its message `text`'s line; its `code` a string where `thrown`'s
   * was; its `unreadable` admission's entries as fresh `{ path, cause }` of strings; its `cause` the
   * snapshot of `thrown`'s; and, for an AggregateError, its errors the snapshots of every one of
   * `thrown`'s. A failure met again among its own causes or errors, or nested past DEEPEST levels,
   * is said as such, so a cycle ends and nothing beneath it goes unsaid.
   */
  const failure = (thrown, depth) => {
    if (produced.has(thrown)) return thrown;
    const message = text(thrown);
    const met = new Error(`${message} (a failure met again among its own causes, or nested past ${DEEPEST} levels; its causes are named above)`);
    if (depth >= DEEPEST) return met;
    return held(thrown, 'failure', () => {
      if ((nodes += 1) > WIDEST) return new Error(past);
      const code = read(thrown, 'code');
      const unreadable = entries(read(thrown, 'unreadable'));
      const errors = chain(thrown).includes(AggregateError.prototype) ? entries(read(thrown, 'errors')) : undefined;
      const cause = read(thrown, 'cause');
      const options = cause === undefined ? undefined : { cause: failure(cause, depth + 1) };
      const leaves = errors?.entries.map((each) => failure(each, depth + 1));
      if (errors?.missing !== undefined) leaves.push(new Error(`and failures it held that L3 could not read: ${errors.missing}`));
      const made = leaves === undefined ? new Error(message, options) : new AggregateError(leaves, message, options);
      if (typeof code === 'string') made.code = code;
      if (unreadable !== undefined) made.unreadable = unreadable.entries.map((entry) => ({ path: field(entry, 'path'), cause: unread.has(entry) ? 'it could not be read' : field(entry, 'cause') }));
      if (unreadable?.missing !== undefined) made.unreadable.push({ path: 'the rest of the admission directory', cause: unreadable.missing });
      kept(made);
      // Its other own fields, such as the card, closer and attempt failures L3 reports, are copies.
      for (const key of own(thrown)) if (!['message', 'code', 'unreadable', 'errors', 'cause', 'stack'].includes(key)) made[key] = copy(read(thrown, key), depth + 1);
      return made;
    }, met);
  };

  /** `entry`'s `key` as a printable line, or, for an entry L3 could not read, the line saying so. */
  const field = (entry, key) => (unread.has(entry) ? entry.message : text(read(entry, key)));

  // Each value handed on is copied within its own bound, so one that exhausts it leaves the others whole.
  const root = (make) => (value) => {
    nodes = 0;
    return make(value, 0);
  };
  return { read, text, entries, copy: root(copy), field, kept, failure: root(failure) };
}

/**
 * A snapshot of `thrown`, whatever was thrown, as a failure L3 built itself, made by one
 * `snapshotting`: no caller or presenter is ever handed `thrown` itself, or anything it holds.
 */
export const readableFailure = (thrown) => snapshotting().failure(thrown);

/** `value`'s printable line, made by one `snapshotting`, the only code that converts a value L3 did not build. */
const said = (value) => snapshotting().text(value);

/** The failure `sentence` names, its cause the snapshot of `reason`, which is converted once for both. */
const noOutcome = (sentence, reason) => {
  const cause = readableFailure(reason);
  return new Error(`${sentence}: ${cause.message}`, { cause });
};


/**
 * L2's notice answer `answer`, a value L3 did not build, as L3 hands it on: `failed`, `issue` and
 * `closed` each read once, into a fresh answer of L3's own.
 */
function noticeAnswer(answer, snapshot = snapshotting()) {
  const failed = snapshot.read(answer, 'failed');
  const issue = snapshot.read(answer, 'issue');
  const closed = snapshot.read(answer, 'closed');
  // What L3 made of the answer is its own, which the settle's copy hands on as it is.
  return snapshot.kept({
    ...(failed === undefined ? {} : { failed: noticeFailed(failed, snapshot) }),
    ...(Number.isSafeInteger(issue) ? { issue } : {}),
    ...(closed === true ? { closed: true } : {}),
  });
}

/**
 * L2's `failed`, a value L3 did not build, as L3 hands it on: its step and cause as printable
 * strings, and, for a step the forge made, a fresh copy of its mark and its unrecorded events, each
 * named printably. Each field is read once.
 */
function noticeFailed(failed, snapshot) {
  const step = snapshot.text(snapshot.read(failed, 'step'));
  const cause = snapshot.text(snapshot.read(failed, 'cause'));
  const made = snapshot.read(failed, 'made');
  if (made === undefined) return { step, cause };
  const unrecorded = snapshot.entries(snapshot.read(failed, 'unrecorded'));
  const events = unrecorded === undefined ? [{ event: 'events it could not name' }] : [
    ...unrecorded.entries.map((each) => ({ event: snapshot.field(each, 'event') })),
    ...(unrecorded.missing === undefined ? [] : [{ event: unrecorded.missing }]),
  ];
  return { step, cause, made: snapshot.copy(made), unrecorded: events };
}

/**
 * The failure L3 reports for hold `id`'s notice, as its caller would otherwise answer it under a
 * closed admission's `notices`: a step L2's notice failed to take, and its cause, or a step the
 * forge made whose record the sink refused, with its unrecorded events. It carries the notice as
 * `notice`, so nothing of it is lost where admission is open or a later read fails.
 */
const noticeFailure = ({ id, step, cause, made, unrecorded }) => Object.assign(new Error(made === undefined
  ? `the notice for hold ${id} failed to ${step}: ${cause}`
  : `the notice for hold ${id} made its step to ${step}, but the sink refused its record, so these events went unrecorded: ${eventsOf(unrecorded)}: ${cause}`), { notice: { id, step, cause, ...(made === undefined ? {} : { made, unrecorded }) } });

/** The names of the unrecorded events `unrecorded` holds, as one printable list, whatever it holds. */
function eventsOf(unrecorded) {
  const snapshot = snapshotting();
  const read = snapshot.entries(unrecorded);
  if (read === undefined) return snapshot.text(unrecorded);
  return [...read.entries.map((each) => snapshot.text(snapshot.read(each, 'event'))), ...(read.missing === undefined ? [] : [read.missing])].join(', ');
}

/**
 * What the loop holds over the board `config` names: N, the claims held
 * in memory, L3's events, the start's kill, and the steps that take a claim, start it and release
 * it. The arguments are `loop`'s, less those only a dispatch reads.
 *
 * `follow` is L3's act on the hold closers naming an issue, which `take` awaits at each trigger.
 *
 * `kill` is L1's kill of the process groups a dead engine left, injected. A handle is refused
 * where it is not a function, when the handle is built, because a start that could not kill has
 * nothing to stop it recording and reading over what the dead engine left (`ARCHITECTURE.md`,
 * "Failure model").
 */
function claiming({ config, board, facts, l2, sink, kill, readAdmission, follow, halted }) {
  if (typeof kill !== 'function') throw new Error(`L3 was handed no kill of recorded process groups, so it cannot start: kill is ${typeof kill}`);
  if (typeof facts !== 'function') throw new Error(`L3 was handed no facts call of L2's, so it cannot ask L2 about a card before claiming it: the facts call is ${typeof facts}`);
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const claims = new Set();
  const slots = new Set();
  let killing;

  /**
   * Settles once the start's kill has settled, calling it on this handle's first call and never
   * again, and rejects with its failure on that call and every later one: a kill that failed
   * stops the start, and nothing on this handle then records or reads.
   */
  const killed = () => {
    killing ??= (async () => kill())();
    return killing;
  };

  /**
   * Appends one of L3's events, under `card` where it concerns one. An append the sink refuses
   * throws the sink's own error, and no caller here drops it (`ARCHITECTURE.md`, "Telemetry").
   */
  const record = (event, fields, card) => sink.emitter({ layer: 'L3', card }).emit(event, fields);

  /** The failure L3 reports for an append the sink refused: `sentence`, then the sink's error, kept as the cause. */
  const refused = noOutcome;

  /**
   * The rest of a trigger's read once `take` has recorded the trigger and `follow` has acted:
   * reads the board, awaits L2's facts call, reads admission and takes the claims, answering as
   * `take` does with `failures` and `notices` beside them.
   */
  const claim = async (limit, excluded, failures, notices) => {
    const columns = await board.readColumns();
    const { items, declared } = await board.readPriority();
    /** A board item neither claimed nor withheld from another pull in this run. */
    const available = (item) => !claims.has(item.number) && !excluded.has(item.number);
    const decide = await facts(items.filter(available));
    // Another trigger may have claimed a card while the facts were read, so the cards no claim
    // holds are read again here, in the synchronous step that takes the claims.
    const unclaimed = items.filter(available);
    // Each card's answer is kept as L2 gave it at the pull, so L3 asks nothing again to begin.
    const answers = new Map();
    const { pulls } = pullOrder({ items: unclaimed, columns, declared }, (card) => {
      const next = decide(card);
      answers.set(card.number, next);
      return next;
    });
    if (halted()) return { claims: [], failures, notices };
    const admissionState = readAdmission();
    if (admissionState.state === 'unreadable') {
      const { unreadable } = admissionState;
      throw Object.assign(new Error(`admission cannot be read, so this pull claims nothing: ${unreadable.map(({ path, cause }) => `${path} (${cause})`).join(', ')}`), { unreadable });
    }
    if (admissionState.state === 'closed') return { claims: [], failures, admission: admissionState, notices };
    const taken = [];
    for (const pull of pulls) {
      if (limit !== undefined && taken.length >= limit) break;
      const next = answers.get(pull.card);
      // A merge claim holds no slot, so N does not bound it (the architect's r2 ruling 3); a limit
      // given counts every card claimed, since each claim finishes a card.
      const merge = next.action === 'merge';
      if (!merge && slots.size >= concurrency) continue;
      claims.add(pull.card);
      if (!merge) slots.add(pull.card);
      const card = unclaimed.find((item) => item.number === pull.card);
      taken.push({ ...pull, card, next, decide, queueDepth: pulls.length - taken.length - 1, inFlight: slots.size });
    }
    return { claims: taken, failures, notices };
  };

  return {
    concurrency,
    claims,
    killed,
    record,
    refused,

    /**
     * Fires the pull trigger's read: records the trigger, acts on each hold's closer naming an issue
     * through `follow`, whose failed notices it answers as `notices`, reads the board, awaits L2's facts call
     * over the cards no claim holds, and claims as many cards as there are free slots and no more
     * than `limit` where one is given, first pulled first, deciding each with the `decide` that call
     * answered. A card L2 answered `merge` holds no slot, so N does not bound it (the architect's r2
     * ruling 3), and a limit given counts it like any other claim. L3
     * reads nothing of that answer but calls it (the architect's ruling 2, P2, on #467). Every
     * claim is taken in the same synchronous step as the pull order it follows, so no other trigger
     * can claim a card between the two. Admission is read after L2 answers and before a claim is
     * taken. A closed admission answers its closers with no claims; an unreadable one rejects,
     * naming each path and cause, and carrying as `unreadable` the entries admission's read
     * answered, unchanged, for the verb to print as it prints them (the architect's placement
     * ruling on #981). Otherwise answers `claims`, each with its pull, its card, L2's answer
     * for it, the `decide` the facts call answered, as `queueDepth` the pullable cards it left
     * unclaimed as it took this one, whatever L2 answered them, and as `inFlight` the slots held, and
     * `failures`, holding the trigger
     * event's refusal where the sink refused it. A trigger is no start, so its refusal stops
     * nothing: each start still tries its own event, which is what names the cards not started,
     * and the refusal is reported beside theirs. A read that fails, the facts call's included,
     * rejects with the read's own error, and no card is claimed. It first awaits the start's kill,
     * as `killed` says. `excluded` omits cards stopped or withheld in this run, and is empty for a
     * single pull.
     */
    take: async (limit, excluded = new Set(), snapshot = snapshotting()) => {
      await killed();
      const failures = [];
      try {
        record('trigger', { trigger: 'pull' });
      } catch (refusal) {
        failures.push(refused('the event sink refused to record the pull trigger', refusal));
      }
      const { notices, unrecorded } = await follow(snapshot);
      failures.push(...unrecorded);
      try {
        return await claim(limit, excluded, failures, notices);
      } catch (thrown) {
        // A later read that fails keeps what this trigger already did and could not record.
        const kept = [...failures, ...notices.map(noticeFailure)];
        // The read's own failure goes on as a snapshot L3 built, so its caller reads it whatever was thrown.
        const reason = snapshot.failure(thrown);
        throw kept.length === 0 ? reason : Object.assign(new AggregateError([...kept, reason], `${reason.message}, after ${kept.length} earlier failure${kept.length === 1 ? '' : 's'} of this trigger`), { cause: reason });
      }
    },

    /**
     * Records a claim's pull event, then hands the claim to L2 with L2's answer for it, unread, and
     * L2 moves the card as its column and that answer ask (the architect's ruling 2, AQ3, on #467). The event follows the claim and comes before
     * the move, as `ARCHITECTURE.md`, "Failure model", orders a start. A pull event the sink
     * refuses is the halt: the start is not made, the claim is released, nothing is recorded for
     * it, since no pull holds a slot in the record, and the failure names the card not started and
     * the sink's error.
     */
    start: async ({ card, kind, next, queueDepth, inFlight }) => {
      try {
        record('pull', { kind, queueDepth, inFlight }, card.number);
      } catch (refusal) {
        claims.delete(card.number);
        slots.delete(card.number);
        throw refused(`card #${card.number} was not started, because the event sink refused to record its pull`, refusal);
      }
      if (['dispatch', 'judge', 'continue'].includes(next.action)) await l2.claimed(card, next);
    },

    /**
     * Releases `card`'s slot, which ends its claim, and records the release. A claim already
     * released, as a refused pull event releases one, holds no slot in the record, so nothing is
     * recorded for it. A release event the sink refuses is reported naming the card.
     */
    release: (card) => {
      if (!claims.delete(card.number)) return;
      if (!slots.delete(card.number)) return;
      try {
        record('slot.release', {}, card.number);
      } catch (refusal) {
        throw refused(`card #${card.number}'s slot was released, and the event sink refused to record it`, refusal);
      }
    },
  };
}

/** Refuses a claim limit that is given and is not a positive whole number, naming it. */
function refuseLimit(limit) {
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    const shown = typeof limit === 'string' ? `'${limit}'` : String(limit);
    throw new Error(`the claim limit must be a positive whole number, and ${shown} is not one`);
  }
}

/**
 * Releases `claim`'s slot through `release` once `failure`, or nothing, ended its work, and
 * answers what its caller reports: `failure` as it is, the release's own refusal where there
 * was no failure, or the two in one AggregateError, since neither may hide the other.
 */
function released(release, claim, failure) {
  try {
    release(claim.card);
    return failure;
  } catch (refusal) {
    return failure === null ? refusal : new AggregateError([failure, refusal], `card #${claim.card.number} failed, and its release went unrecorded`);
  }
}

/**
 * L3's dispatching entry point, over the board `config` names.
 *
 * `board` is L0's handle on it, the forge adapter's read side: `readColumns()` answers the
 * declared columns by key, and `readPriority()` answers the cards with their priority and the
 * declared order, which is what L0 hands L3 for the pull order. `readIssueState(number)` answers
 * one issue's state, which L3 reads for each issue a hold's closer names, as `follow` says.
 * `readItems()` answers the cards, which the repo lane reads again as it reaches a merge, as `lane` says. `facts` is L2's facts call, which
 * L3 awaits over the cards it read, between its board read and its claims, and which answers the
 * next action L3 asks once for each card at the pull, as `take` says. `decide` is L2's next action
 * for a card, which L3 asks within each attempt as `decide(card, outcomes, options)`: with the
 * attempt's outcomes after each step, with none once a later attempt's workspace is made, and
 * with L1's failure as `workspace` where it could not be made. After each maker dispatch,
 * L3 hands its outcome back unread as `maker`; `attempt` numbers each attempt from 1. L2 alone
 * names the steps L3 dispatches, and whether the
 * card is attempted again (the architect's ruling 6, Q-A and Q-D, and ruling 1, A1, on #423). After
 * the maker's settle, L3 asks it again with the facts the settle answered as `forge`, and, while
 * the judges it names are made and run, with `directories` and `judged`, as `attempt` and `judged`
 * say. `l2` is L2's column changes, whose `claimed` takes each claim and whose `settled` takes the
 * maker's outcome and, for a continuing maker that exited 0, L1's workspace tip and the read
 * measure. It answers what it read of the forge, which L3 reads nothing of. The
 * maker is always the role L2's maker answer names, dispatched through L1, as `dispatchRole` says
 * (the architect's ruling 1, Q1, on #467). `environment` is the environment L3 hands
 * every dispatch it makes, each step's, the maker's and each judge's (ruling 2, AQ1). `ps` and
 * `readTimeout` stand in for L0's own process-table reader and read bound, and L3 hands both to L1
 * unread for every dispatch it makes, where neither is given L0 using its own
 * (ruling 3, AQ7). `workspace(card)` is L1's
 * workspace handle, injected, and
 * answers the attempt's workspace as `{ path, branch }`, with the card's scratch base as `scratch`
 * and the repository it made from as `repository` (ruling 5, P4; the architect's rulings 19 and
 * 21 on #467). `workspaceTip` is L1's read of the branch's tip in that workspace after a continuing
 * maker exits 0. `clock` supplies the time and pause for a repeated forge read.
 * `escalationDirectory(card, role, head)` makes an escalation role's detached directory before
 * dispatch, and its retry makes both directories fresh under the same routing comment.
 * `judgeDirectory(card, role, head)` is L1's make of a judge's directory, injected, as
 * `judged` says (the architect's ruling 4's addendum on #467). `removeDirectories(card)` is L1's
 * shared guarded directory removal, injected. `state` is the state directory L1 records each dispatch's process
 * group in, which L3 hands L1's `dispatch` unread (ruling 10).
 * `kill()` is L1's kill of recorded process groups, injected, and the first call on the handle
 * awaits it before L3 records or reads anything, as `claiming` says. A handle is refused when it
 * is built where `kill` or the facts call is not a function, checked in that order, and then, each
 * after those, where the workspace handle, `judgeDirectory` or `removeDirectories` is not a
 * function, `state` not a non-empty string, `environment` not an object, or `run` not a non-empty
 * string. `run` is the invocation's run id, which `recording` drew, and L3 builds its one admission
 * handle over `state` with it and the clock's `now`, so a hold's closer names the run that linked it.
 * `sink` is L5's, and L3 writes its own events through it under layer `L3`:
 *
 * - `run.start`, with `concurrency`, the run's N, as a run starts.
 * - `trigger`, with `trigger` naming which fired: `pull` each time the pull trigger fires, before
 *   it reads the board, and `drain` when a pull finds nothing in flight and nothing to pull, once
 *   per idle period.
 * - `pull`, under the card, with its `kind`, `queueDepth`, the pullable cards the pull left
 *   unclaimed, and `inFlight`, the slots held, a merge claim holding none. It follows the card's
 *   claim and comes before L2 moves the card or the lane merges it, as `ARCHITECTURE.md`,
 *   "Failure model", orders a start.
 * - `slot.release`, under the card, as its slot is released, however its work ended. A merge claim
 *   holds no slot, and records none.
 * - `merge.start` and `merge.end`, under the card, around its merge in the repo lane, as `lane` says.
 * - `dispatch`, under its own dispatch id and the card, before anything acts on what it starts, in
 *   one of three kinds:
 *   - a step's, with the `step`'s name and either the `attempt` number, for a step in an attempt's
 *     workspace, or the judge's `role`, for a step in a judge's `head`, before L1 acts on the step
 *     (ruling 1, A8);
 *   - the maker's, with its `role`, its `tier` and the `attempt` number, and no `step`, before the
 *     provider adapter or L1 acts on it (ruling 1, Q10, and ruling 5, on #467);
 *   - a judge's, with its `role` and its `tier`, and neither a `step` nor an `attempt`, before the
 *     provider adapter or L1 acts on it.
 *
 *   One the sink refuses starts nothing, and the failure names the card and the step or the role.
 *
 * A claim and its slot are held in memory from the moment L3 pulls a card until its work settles.
 * A card L2 answers `merge` takes a claim and no slot, and is handed to the repo lane, which merges
 * one card at a time in the order L3 pulled them (`R-SCHED-15`), as `lane` says. Its claim is
 * released once its merge ends, and the card is left out of this run's later pulls.
 * One run also remembers stopped cards and cards whose
 * judges L2 withheld, leaving them out of its later pulls; a later invocation starts empty. A held
 * card needs no memory, because its hold closes admission ("Failure model"): L3 follows L2's `hold`
 * at every point it asks L2 within a claim, as `attempt` and `judged` say, and links one closer for
 * the card through that handle on its first `hold` answer, as `holding` says. Where a hold's close
 * rejects, no pull of this loop claims a card after it, and claims already held finish.
 */
export function loop({ config, board, decide, facts, l2, sink, kill, workspace, workspaceTip, judgeDirectory, escalationDirectory, removeDirectories, state, environment, run, host, readTimeout, clock }) {
  let admissionRecord;
  const { concurrency, claims, killed, record, refused, take, start, release } = claiming({ config, board, facts, l2, sink, kill, readAdmission: () => admissionRecord.read(), follow: (snapshot) => follow(snapshot), halted: () => unsaved !== undefined });
  const { merge } = lane({ board, facts, l2, record, refused, removeDirectories, clock });
  const now = clock?.now ?? Date.now;
  const pause = clock?.pause ?? ((delay) => new Promise((resolve) => { whenElapsed(delay, resolve, { hold: true }); }));
  if (typeof workspace !== 'function') throw new Error(`L3 was handed no workspace handle of L1's, so it cannot make an attempt's workspace: the workspace handle is ${typeof workspace}`);
  if (typeof judgeDirectory !== 'function') throw new Error(`L3 was handed no judgeDirectory of L1's, so it cannot make a judge's directory: judgeDirectory is ${typeof judgeDirectory}`);
  if (typeof removeDirectories !== 'function') throw new Error(`L3 was handed no removeDirectories handle of L1's, so it cannot remove a merged card's directories: removeDirectories is ${typeof removeDirectories}`);
  if (typeof state !== 'string' || state === '') throw new Error(`L3 was handed no state directory for L1's record of process groups, so it cannot dispatch: the state directory is ${JSON.stringify(state)}`);
  if (environment === null || typeof environment !== 'object') throw new Error(`L3 was handed no environment for the dispatches it makes, so it cannot dispatch: the environment is ${environment === null ? 'null' : typeof environment}`);
  if (typeof run !== 'string' || run === '') throw new Error(`L3 was handed no run id, so it cannot record a hold's closer: the run id is ${JSON.stringify(run) ?? 'undefined'}`);
  admissionRecord = admission({ directory: state, run, now, sink });

  /**
   * Whether the drain trigger has fired in this idle period. Drain fires once per idle period, by
   * the owner's U21 ruling, and several pulls can find the board empty in one. A claim ends an
   * idle period, and so does a run's start, since drain fires at a start that finds nothing.
   */
  let idle = false;

  /**
   * Dispatches `step`, as L2's next action names it, for `card`, in the directory at `path`, and
   * settles on its outcome as `Promise.allSettled` records it. L3 allocates the dispatch's id and
   * appends its start, under the id and the card, naming the step and `fields`, the attempt
   * numbered `attempt` for a step in an attempt's workspace, or the judge `role` for one in a
   * judge's `head`, before L1 acts (`ARCHITECTURE.md`, "Failure model" and "Telemetry"). A start
   * the sink refuses starts nothing, and rejects naming the card and the step. The outcome carries
   * the id as `dispatch`, from which L2 composes a hold's dispatch ids.
   */
  const dispatchStep = async (card, step, path, fields) => {
    const id = `d-${randomUUID()}`;
    try {
      sink.emitter({ layer: 'L3', card: card.number, dispatch: id }).emit('dispatch', { step: step.name, ...fields });
    } catch (refusal) {
      throw refused(`card #${card.number}'s step \`${step.name}\` was not started, because the event sink refused to record its start`, refusal);
    }
    const [outcome] = await Promise.allSettled([dispatchOnL1({ id, card: card.number, directory: state, sink, host, readTimeout, ...stepDispatch(step, path, environment) })]);
    return { ...outcome, dispatch: id };
  };

  /**
   * Dispatches the role L2's role answer `answer` names, for `card`, with `cwd` as its working
   * directory, `directory` as the dispatch's directory, `reach` the directories it may reach, and
   * the card's scratch base `scratch` and the `repository` L1 made from, each as L1's make answered
   * it, and settles on its outcome as `Promise.allSettled` records it. L3 allocates the dispatch's
   * id and appends its start, under the id and the card, naming the role, its tier and `fields`,
   * the attempt number for a maker, then awaits `roleDispatch` and L1's `dispatch` as one settled
   * unit, so anything the provider adapter runs runs after that start (the architect's ruling 5 on
   * #467). `roleDispatch` is handed the answer unread, the directories, the scratch base and the
   * repository unread (the architect's rulings 19 and 21, and ruling 3, P8), and `environment`. A
   * start the sink refuses starts nothing, and rejects naming the card and the role. `stamp`, handed
   * the answer and the id, answers the answer `roleDispatch` is handed, so that L2's `dispatched`
   * writes a judge's id into its instruction (the architect's r2 ruling 6 on #642). The outcome
   * carries the id as `dispatch`, as `dispatchStep`'s does.
   */
  const dispatchRole = async (card, answer, { cwd, directory, reach, scratch, repository }, fields, stamp = (given) => given) => {
    const id = `d-${randomUUID()}`;
    try {
      sink.emitter({ layer: 'L3', card: card.number, dispatch: id }).emit('dispatch', { role: answer.role, tier: answer.tier, ...fields });
    } catch (refusal) {
      throw refused(`card #${card.number}'s role \`${answer.role}\` was not started, because the event sink refused to record its start`, refusal);
    }
    const run = async () => {
      const handed = await roleDispatch({ answer: stamp(answer, id), cwd, directory, scratch, repository, reach, env: environment, sink, id, card: card.number });
      return dispatchOnL1({ id, card: card.number, directory: state, sink, host, readTimeout, ...handed });
    };
    const [outcome] = await Promise.allSettled([run()]);
    return { ...outcome, dispatch: id };
  };

  /** Each claimed card's close for its first `hold` answer under its claim, by card, until the claim is released. */
  const holds = new Map();

  /** The snapshot of the trigger settle that claimed each card, by card, which its hold's notice is read by. */
  const settles = new Map();

  /**
   * The failure of a hold's close, once one has rejected: from then on no pull of this loop claims
   * a card ("Failure model", "Where a hold's closer could not be saved").
   */
  let unsaved;

  /**
   * Closes admission for L2's `hold` answer `answer`, linking the hold's closer through this loop's
   * one admission handle, and answers `{ closer }`, or `{ failure }` where the close rejected,
   * keeping that failure as `unsaved`. Its reason names the card, and each of L2's two failures as
   * `JSON.stringify` writes it. Only a card's first `hold` under its claim links a closer; a later
   * one answers that close.
   */
  const holding = (answer) => {
    if (!holds.has(answer.card)) holds.set(answer.card, closing(answer));
    return holds.get(answer.card);
  };

  /**
   * Links the closer for `holding`'s first `hold` answer of a card, then, under the card's claim,
   * awaits L2's notice call for it, as `notify` says. A notice that failed is carried on the closer
   * as `notice`, naming the step and its cause.
   */
  const closing = async ({ card, role, firstFailure, failure }) => {
    const whose = role === undefined ? `card #${card}` : `card #${card}'s judge \`${role}\``;
    const reason = `${whose} was held after two failures the same way: ${JSON.stringify(firstFailure)}, then ${JSON.stringify(failure)}`;
    let closer;
    try {
      closer = await admissionRecord.close({ kind: 'hold', reason });
    } catch (thrown) {
      unsaved ??= thrown;
      return { failure: thrown };
    }
    const notice = await notify(closer.id, { card, firstFailure, failure }, undefined, settles.get(card));
    return { closer: notice?.failed === undefined ? closer : { ...closer, notice: notice.failed }, unrecorded: notice?.unrecorded ?? [] };
  };

  /** The tail of L3's calls to L2's notice function, which run one at a time ("Failure model"). */
  let noticing = Promise.resolve();

  /**
   * Queues a call to L2's notice function for hold `id`, handed `hold`, L2's `hold` answer, where
   * the call is the hold's own, and answers how it ended: undefined where, as it starts, no closer
   * carries the id or the closer names an issue; `{ gone }` where a rename found the closer gone and
   * L3 ended the call; otherwise what L2 answered, a call that threw answering as `failed`.
   */
  const notify = (id, hold, issueState, snapshot = snapshotting()) => {
    noticing = noticing.then(() => noticed(id, hold, issueState, snapshot)).catch((thrown) => ({ failed: { step: 'notice', cause: said(thrown) } }));
    return noticing;
  };

  /**
   * One notice call for hold `id`, on its closer as L3 lists it as the call starts, handing L2 the
   * issue numbers the other hold closers name. L3 makes each rename L2 answers through `admission.mjs`
   * and hands L2 the outcome unread, as `Promise.allSettled` records it, before L2 writes again.
   * A closer naming an issue is followed only where L3 read that issue's state, `issueState`, as `{
   * issue, state }`, and only while the closer still names the issue that state was read for: a
   * call queued behind another that renamed the closer hands L2 nothing, and the next trigger reads
   * the issue it now names. L3 hands L2 that state; where L2 answers that the notice closed for that
   * hold, L3 removes its closer through `admission.mjs`, the event naming the issue's close as what
   * reopened admission. A removal whose event the sink refused answers as `unrecorded`, the refusal.
   */
  const noticed = async (id, hold, issueState, snapshot) => {
    const closers = admissionRecord.read().closers ?? [];
    const closer = closers.find((each) => each.id === id);
    if (closer === undefined || closer.issue !== issueState?.issue) return undefined;
    const others = closers.filter((each) => each.issue !== undefined && each.id !== id).map((each) => Number(each.issue));
    let { name } = closer;
    // Each action L3 makes whose record the sink refused, kept by L3 whatever L2 does next.
    const unrecorded = [];
    try {
      const steps = l2.notice({ closer, others, hold, admission: admissionPath(state), ...(issueState === undefined ? {} : { state: issueState.state }) });
      // Each step L2 hands back is read once, its `done` and its `value`, into locals of L3's own.
      const read = (step) => ({ done: snapshot.read(step, 'done') !== false, value: snapshot.read(step, 'value') });
      let { done, value } = read(await steps.next());
      while (!done) {
        const asked = value;
        const [outcome] = await Promise.allSettled([(async () => admissionRecord.rename(name, asked))()]);
        if (outcome.value?.gone) {
          await steps.return();
          return { gone: true, unrecorded };
        }
        if (outcome.status === 'fulfilled') ({ name } = outcome.value);
        // A rename made whose record the sink refused: the closer is at its new name, and the refusal is L3's to report.
        else if (admissions(outcome.reason) && outcome.reason.renamed !== undefined) {
          name = outcome.reason.renamed;
          unrecorded.push(outcome.reason);
        }
        ({ done, value } = read(await steps.next(outcome)));
      }
      // L2's answer is read once, into a fresh answer of L3's own, which is all L3 hands on.
      const answer = noticeAnswer(value, snapshot);
      if (answer.closed) {
        const [opened] = await Promise.allSettled([admissionRecord.open(name, answer.issue === undefined ? {} : { issue: answer.issue })]);
        if (opened.status === 'rejected') unrecorded.push(readableFailure(opened.reason));
      }
      return { ...answer, unrecorded };
    } catch (thrown) {
      return { failed: { step: 'notice', cause: said(thrown) }, unrecorded };
    }
  };

  /**
   * Issue `number`'s state as `board.readIssueState` answers it, tagged `ok` with the state where the
   * read fulfilled with a state it names, and otherwise not `ok`, with a printable `failure`: the
   * tag, never the rejected value, tells the two apart, since a read can reject with anything,
   * undefined among it.
   */
  const stateOf = async (number) => {
    let answer;
    try {
      answer = await board.readIssueState(number);
    } catch (thrown) {
      return { ok: false, failure: said(thrown) };
    }
    const snapshot = snapshotting();
    const state = snapshot.read(answer, 'state');
    if (!ISSUE_STATES.includes(state)) return { ok: false, failure: `board.readIssueState answered no state: ${snapshot.text(answer)}` };
    return { ok: true, read: state };
  };

  /**
   * L3's act at a trigger on each hold's closer naming an issue, after it lists admission: it reads
   * each issue those closers name by its number, once whatever number of closers name it, through
   * `board.readIssueState`, and hands L2's notice function each closer's hold and that state, as
   * `noticed` says. A read that fails or times out counts as unreadable: L3 hands L2 nothing for that
   * closer, records `notice.failed` naming the issue, and the next trigger reads again. Answers
   * `notices`, each failed notice as `{ id, step, cause }`, and `unrecorded`, the failure of each
   * opening whose event the sink refused, which the trigger reports whether or not admission opened.
   */
  const follow = async (snapshot) => {
    const listed = admissionRecord.read();
    const notices = [];
    const unrecorded = [];
    if (listed.state !== 'closed') return { notices, unrecorded };
    const states = new Map();
    for (const { kind, id, issue } of listed.closers) {
      if (kind !== 'hold' || issue === undefined) continue;
      if (!states.has(issue)) states.set(issue, stateOf(Number(issue)));
      const { ok, read, failure } = await states.get(issue);
      if (!ok) {
        const failed = { step: `read issue #${issue}'s state`, cause: failure };
        try {
          record('notice.failed', { hold: id, issue: Number(issue), ...failed });
          notices.push({ id, ...failed });
        } catch (refusal) {
          notices.push({ id, ...failed, cause: `${failed.cause}; and the sink refused its notice.failed event: ${said(refusal)}` });
        }
        continue;
      }
      const ended = await notify(id, undefined, { issue, state: read }, snapshot);
      if (ended?.failed !== undefined) notices.push({ id, ...ended.failed });
      unrecorded.push(...(ended?.unrecorded ?? []));
    }
    return { notices, unrecorded };
  };

  /**
   * Closes admission for L2's `hold` answer `answer` for `card`'s judge `role`, as `holding` says,
   * and answers the failure the card ends held with: it names the card, the judge, that it was held
   * and both of L2's failures, carrying them, the decision and the closer as fields, or as
   * `unsaved` the close's failure where it rejected.
   */
  const heldJudge = async (card, role, answer) => {
    const { closer, failure: unsavedBy, unrecorded = [] } = await holding({ ...answer, role });
    const { firstFailure, failure } = answer;
    return Object.assign(new Error(`card #${card.number}'s judge \`${role}\` was held after two dispatches that failed the same way:\nfirst: ${JSON.stringify(firstFailure)}\nsecond: ${JSON.stringify(failure)}`), {
      card: card.number, role, decision: 'hold', firstFailure, failure, unrecorded, ...(unsavedBy === undefined ? { closer } : { unsaved: unsavedBy }),
    });
  };

  /**
   * Has L1 make `card`'s workspace for the attempt numbered `number`, and answers it as `{ path,
   * scratch, repository }`, the card's scratch base and repository beside it as L1 answered them,
   * or, where L1 could not make it, L2's answer for that attempt, handed the failure unread.
   */
  const made = async (card, number, continuing, firstFailure) => {
    const [outcome] = await Promise.allSettled([new Promise((resolve) => resolve(workspace(card.number, continuing?.head)))]);
    if (outcome.status === 'fulfilled') return { path: outcome.value.path, branch: outcome.value.branch, scratch: outcome.value.scratch, repository: outcome.value.repository };
    return { answer: decide(card, [], { attempt: number, firstFailure, workspace: outcome, continuing }) };
  };

  /**
   * The attempts at `card`, from `next`, L2's answer for it at the pull, under its
   * one claim. Each attempt has L1 make the workspace, then dispatches each step L2 names, one at a
   * time, handing L2 each outcome unread with the attempt's number and asking it again, until L2
   * names no step. A later attempt asks L2 for its first step once its workspace is made.
   *
   * An answer that dispatches no step is the maker: the role the answer's `maker` names,
   * dispatched through L1 as `dispatchRole` says. After a continuing maker exits 0, L3 reads its
   * workspace tip through L1. L3 hands L2 each maker outcome unread, with that tip where read.
   * A stale forge head has L3 pause and ask L2 to settle again under the same claim and slot.
   * Where the settle succeeded, L3 hands its facts to `decide` with the attempt number. L3 follows
   * L2's `again`, `hold`, `stop` or `escalate` answer; a retry makes a fresh workspace. Otherwise the attempt
   * answers the card, its
   * workspace, the maker's `outcome` and L2's `settled`, each as `Promise.allSettled` records it.
   * Where the settle
   * answered facts and L2, asked again with them, names judges, they are dispatched under the same
   * claim, as `judges` says, and the answer also carries them as `judges`. The maker's result is
   * handed to `kept` as soon as the settle answers, before L2 is asked about judges, so a judge's
   * failure, or L2's judge answer throwing, still leaves its caller the maker's result while the
   * attempt rejects with that failure. Where a judge failed to hand back, the maker's result is
   * handed to `kept` again with every judge L2 named beside it as `judges`, as `judges` hands them
   * to its `keep`. An answer naming the
   * next attempt has L3 make it; one holding or stopping the card fails, naming the card and each
   * attempt's failure, in order, both in the message and as fields `card` and `attemptFailures`.
   * A hold first closes admission, and its failure carries the closer as `closer`, or, where the
   * close rejected, fails as an AggregateError holding it beside the close's failure.
   * A held or stopped card is absent from `reached`. Any other answer stops the attempts, naming the card
   * and what L2 answered. `remember` marks a card whose judges L2 withheld for this run.
   */
  const attempt = async (card, next, kept, remember, excluded) => {
    const continuing = next.action === 'continue' ? next : undefined;
    const failures = [];
    const askAttempt = (outcomes, options) => decide(card, outcomes, { ...options, firstFailure: failures[0], continuing });
    const escalated = async (answer) => {
      remember(answer);
      await l2.escalated(card, answer);
      return { card: card.number, ...answer };
    };
    /** The failure naming the card as held or stopped after its attempts, each attempt's failure in order. */
    const ended = (answer, held) => {
      const attemptFailures = [...failures, answer.failure];
      const each = attemptFailures.map((failure, at) => `attempt ${at + 1}: ${JSON.stringify(failure)}`);
      return Object.assign(new Error(`card #${card.number} was ${held ? 'held' : 'stopped'} after ${each.length} attempts, each failing before the maker:\n${each.join('\n')}`), { card: card.number, attemptFailures, ...(held ? { decision: 'hold' } : {}) });
    };
    /**
     * Follows L2's retry, hold or stop answer, retaining each failure for the final report. A hold
     * closes admission first, through `holding`, and the card then ends held.
     */
    const advance = async (answer, number) => {
      if (answer.action === 'again' && answer.attempt === number + 1) {
        failures.push(answer.failure);
        return true;
      }
      if (answer.action === 'hold') {
        const { closer, failure: unsavedBy, unrecorded = [] } = await holding(answer);
        if (unsavedBy !== undefined) throw new AggregateError([ended(answer, true), unsavedBy], `card #${card.number} was held, and its closer was not saved`);
        // A notice step L3 made for the closer whose record the sink refused stays beside the held card.
        if (unrecorded.length > 0) throw new AggregateError([Object.assign(ended(answer, true), { closer }), ...unrecorded], `card #${card.number} was held, and a step of its notice went unrecorded`);
        throw Object.assign(ended(answer, true), { closer });
      }
      if (answer.action === 'stop') throw ended(answer, false);
      return false;
    };
    let answer = next;
    for (let number = 1; ; number += 1) {
      const { path, branch, scratch, repository, answer: unmade } = await made(card, number, continuing, failures[0]);
      if (unmade !== undefined) {
        answer = unmade;
      } else {
        if (number > 1 || continuing !== undefined) answer = askAttempt([], { attempt: number });
        const outcomes = [];
        while (answer.action === 'dispatch' && answer.step !== undefined) {
          outcomes.push(await dispatchStep(card, answer.step, path, { attempt: number }));
          answer = askAttempt([...outcomes], { attempt: number });
        }
      }
      if (await advance(answer, number)) continue;
      if (answer.action === 'escalate') return escalated(answer);
      if (answer.action !== 'dispatch') {
        throw new Error(`card #${card.number}'s attempt stopped, as L2 answered: ${JSON.stringify(answer)}`);
      }
      let dispatch;
      const outcome = await dispatchRole(card, answer.maker, { cwd: path, directory: path, reach: [], scratch, repository }, { attempt: number }, (given, id) => {
        dispatch = id;
        return dispatchedEscalation(given, id);
      });
      let settled;
      if (continuing !== undefined && outcome.status === 'fulfilled' && outcome.value.exit === 0) {
        let expectedHead;
        let tipFailure;
        try {
          if (typeof workspaceTip !== 'function') throw new Error('L3 was handed no L1 workspace-tip reader');
          expectedHead = await workspaceTip({ card: card.number, dispatch, path, branch, repository });
          if (typeof expectedHead !== 'string' || expectedHead === '') throw new Error(`L1 found no tip for card #${card.number}'s line of work`);
        } catch (failure) {
          if (failure.code === EVENT_REFUSED) throw failure;
          tipFailure = failure;
        }
        const first = now();
        let reads = 0;
        let lastForgeHead;
        for (;;) {
          const elapsedMs = now() - first;
          reads += 1;
          [settled] = await Promise.allSettled([l2.settled(card, outcome, { dispatch, expectedHead, tipFailure, lastForgeHead, last: elapsedMs >= 60_000, reads, elapsedMs })]);
          if (settled.status !== 'fulfilled' || !settled.value?.waiting) break;
          lastForgeHead = settled.value.forgeHead;
          // D16 rule 3: the forge can still show the old head after a push. #664's journal/P58
          // saw old facts at about 2, 2.4, 6 and 7 seconds. #664's stream saw new facts on later
          // invocations by 103.5 and 91.7 seconds (#758); no forge lag was measured.
          await pause(5_000);
        }
      } else {
        [settled] = await Promise.allSettled([l2.settled(card, outcome, { dispatch })]);
      }
      if (settled.status === 'fulfilled' && settled.value?.action === 'escalate') {
        const escalation = settled.value;
        remember(escalation);
        const reached = { card: card.number, workspace: path, outcome, settled };
        kept(reached);
        if (escalation.destination !== 'owner') {
          let routed;
          try {
            routed = await l2.routed(card, escalation);
          } catch (failure) {
            excluded?.add(card.number);
            throw failure;
          }
          if (routed.action === 'escalate') return { ...reached, ...await escalated(routed) };
          let firstFailure;
          for (;;) {
            const [made] = await Promise.allSettled([new Promise((resolve) => resolve(escalationDirectory(card.number, routed.role.role, escalation.head)))]);
            let roleId;
            let roleOutcome = made;
            if (made.status === 'fulfilled') {
              const directory = made.value;
              roleOutcome = await dispatchRole(card, routed.role, {
                cwd: directory.main, directory: directory.path, reach: directory.head === undefined ? [] : [directory.head], scratch: directory.scratch, repository: directory.repository,
              }, {}, (given, id) => { roleId = id; return dispatchedEscalation(given, id); });
            }
            const ended = await l2.roleSettled(card, escalation, roleOutcome, { dispatch: roleId, firstFailure });
            if (ended?.action === 'again') {
              firstFailure = roleOutcome;
              continue;
            }
            const handled = { ...reached, action: 'handled', escalationRole: { role: routed.role.role, outcome: roleOutcome, settled: ended } };
            kept(handled);
            if (ended?.action === 'escalate') return { ...handled, ...await escalated(ended) };
            return handled;
          }
        }
        const ended = { ...reached, ...await escalated(escalation) };
        kept(ended);
        return ended;
      }
      if (settled.status === 'fulfilled') {
        answer = askAttempt([], { attempt: number, maker: outcome });
        if (await advance(answer, number)) continue;
        if (answer.action === 'escalate') return escalated(answer);
      }
      const reached = { card: card.number, workspace: path, outcome, settled, ...(continuing === undefined ? {} : { action: 'continue', pull: continuing.pull, head: continuing.head }) };
      kept(reached);
      if (settled.status !== 'fulfilled' || settled.value === undefined) return reached;
      // The facts L2's settle answered go back to L2 unread, so one read decides both the move and
      // the judges (the architect's ruling 3, AQ4, on #467).
      const ask = (options) => decide(card, [], { ...options, forge: settled.value });
      const judging = ask({});
      if (judging.action !== 'judge') return reached;
      return { ...reached, judges: await judges(card, judging, ask, (ended) => kept({ ...reached, judges: ended }), remember) };
    }
  };

  /**
   * The judge L2's answer `answer` names as `role`, or nothing where it names none, being no judge
   * answer or one that withholds that judge.
   */
  const named = (answer, role) => (answer.action === 'judge' ? answer.judges.find((judge) => judge.role === role) : undefined);

  /**
   * The judge `judge`, as L2's judge answer names it, of `card`, under the card's one claim, asking
   * L2 again through `ask`. L3 has L1 make the judge's directory through `judgeDirectory`, handed the
   * card, the role and the head SHA L2 named, before any of the judge's dispatches start. Where L1
   * could not make it, L3 hands the failure unread to L2 as the role's in `directories`, and the
   * judge is not dispatched. Otherwise L3 dispatches each step L2 named in the directory's `head`,
   * one at a time, handing L2 the role's outcomes so far unread in `judged` after each, and the judge
   * is not dispatched once L2's answer no longer names it. Then the judge, as L2 last named it, is
   * dispatched with `main` as its working directory, its judge directory as the dispatch's, and
   * `head` as the directory it may reach, each as L1's make answered it, never from L2's answer (the
   * architect's ruling 3, P8, and ruling 4's addendum), its instruction carrying its dispatch id as
   * L2's `dispatched` writes it. Where L1 reports that the judge's dispatch did not start, L3 hands
   * that report unread to L2 as the role's in `directories`, and L2 withholds the judge where the
   * report names its scratch directory as missing ("Failure model", step 4). Where L2 answers either
   * of those two asks `hold`, L3 closes admission at once, without waiting for the card's other
   * judges, and answers `{ role, held }`, `held` the failure `heldJudge` names. Answers `{ role,
   * outcome }`, the judge's
   * outcome as `Promise.allSettled` records it, or, for a judge L2 withheld, `{ role, withheld }`,
   * `withheld` holding what L3 handed L2 that L2 withheld it for: `{ directory }`, L1's failure to
   * make its directory, `{ scratch }`, L1's report that its dispatch did not start, or `{ step,
   * outcome }`, the step in its `head` whose outcome L2 was handed
   * last, by name, and that outcome, since L3 asks after each step.
   */
  const judged = async (card, judge, ask) => {
    const { role } = judge;
    const [made] = await Promise.allSettled([new Promise((resolve) => resolve(judgeDirectory(card.number, role, judge.facts.head)))]);
    if (made.status === 'rejected') {
      const answer = ask({ directories: { [role]: made } });
      if (answer.halt) throw readableFailure(made.reason);
      if (answer.action === 'hold') return { role, held: await heldJudge(card, role, answer), decision: answer };
      if (answer.action === 'escalate') return { role, outcome: made, escalation: answer, decision: answer };
      return { role, withheld: { directory: made }, decision: answer };
    }
    const { path, main, head, scratch, repository } = made.value;
    const outcomes = [];
    let current = judge;
    while (outcomes.length < current.steps.length) {
      const step = current.steps[outcomes.length];
      outcomes.push(await dispatchStep(card, step, head, { role }));
      const answer = ask({ judged: { [role]: [...outcomes] } });
      current = named(answer, role);
      if (current === undefined) return { role, withheld: { step: step.name, outcome: outcomes.at(-1) }, decision: answer };
    }
    const outcome = await dispatchRole(card, current, { cwd: main, directory: path, reach: [head], scratch, repository }, {}, dispatched);
    if (outcome.status === 'rejected' && [NOT_STARTED, SCRATCH_REFUSED, EVENT_REFUSED].includes(outcome.reason?.code)) {
      const answer = ask({ directories: { [role]: outcome } });
      if (answer.halt) return { role, outcome, halt: true, decision: answer };
      if (answer.action === 'hold') return { role, held: await heldJudge(card, role, answer), decision: answer };
      if (answer.action === 'escalate') return { role, outcome, escalation: answer, decision: answer };
      if (answer.action === 'again') return { role, retry: { judge: current, failure: outcome } };
      if (answer.action === 'stop') return { role, decision: answer, failure: Object.assign(new Error(`card #${card.number}'s judge \`${role}\` was stopped after two dispatches:\nfirst: ${JSON.stringify(answer.firstFailure)}\nsecond: ${JSON.stringify(answer.failure)}`), { card: card.number, role, decision: 'stop', firstFailure: answer.firstFailure, failure: answer.failure }) };
      if (named(answer, role) === undefined) return { role, withheld: { scratch: outcome }, decision: answer };
    }
    return { role, outcome };
  };

  /**
   * Dispatches every judge L2's judge answer `answer` names for `card`, at once, under the card's
   * one claim, as `judged` says, asking L2 again through `ask`, and settles once every one of them
   * has handed back its outcome. Answers the judges dispatched, each `{ role, outcome }`, in the
   * order L2 named them, a judge L2 withheld among none of them.
   *
   * Where one failed to hand back an outcome, its start refused or L2 answering no action for it,
   * it waits for every other, then hands `keep` every judge L2 named, in the order it named them,
   * each in one of three shapes:
   *
   * - `{ role, outcome }`, for a judge that handed back;
   * - `{ role, failure }`, for one that failed to, `failure` being the error that names it in the
   *   rejection;
   * - `{ role, withheld }`, for one L2 withheld, as `judged` answers it.
   *
   * A judge L2 held is one that failed to hand back, its failure the held one, beside the close's
   * own where that rejected, so the card ends held once every judge it dispatched has handed back.
   *
   * Where L2 answered an escalation, every outcome is kept before one write through L2, after
   * all the named judges finish, and so after any hold's close. L2 is handed every refusal report together for that answer.
   * Then it rejects with an AggregateError naming the card and each judge that failed, and why, in
   * its `errors`, so no judge's outcome is dropped for another's failure.
   */
  const judges = async (card, answer, ask, keep, remember) => {
    const settled = await Promise.allSettled(answer.judges.map((judge) => judged(card, judge, ask)));
    let interrupted = settled.some((each) => each.status === 'rejected' || each.value.escalation !== undefined || each.value.halt);
    for (const [at, each] of settled.entries()) {
      if (each.status !== 'fulfilled' || each.value.retry === undefined) continue;
      const { judge, failure } = each.value.retry;
      if (interrupted) {
        settled[at] = { status: 'fulfilled', value: { role: judge.role, outcome: failure } };
        continue;
      }
      const repeat = (options) => ask({ ...options, ...(options.directories === undefined ? {} : {
        directories: Object.fromEntries(Object.entries(options.directories).map(([role, outcome]) => [role, { ...outcome, firstFailure: failure }])),
      }) });
      [settled[at]] = await Promise.allSettled([judged(card, judge, repeat)]);
      interrupted ||= settled[at].status === 'rejected' || settled[at].value.halt;
    }
    remember(ask({ judged: Object.fromEntries(settled.map((each, at) => [answer.judges[at].role, { decision: each.status === 'fulfilled' ? each.value.decision : undefined }])) }));
    // A judge L2 held fails the card held, as one that handed back no outcome fails it.
    const ended = settled.map((each, at) => (each.status === 'fulfilled'
      ? (each.value.held === undefined ? each.value : { role: each.value.role, failure: each.value.held })
      : { role: answer.judges[at].role, failure: noOutcome(`card #${card.number}'s judge \`${answer.judges[at].role}\` handed back no outcome`, each.reason) }));
    const failed = ended.filter((each) => each.failure !== undefined).flatMap((each) => [each.failure, ...(each.failure.unsaved === undefined ? [] : [each.failure.unsaved]), ...(each.failure.unrecorded ?? [])]);
    const escalating = ended.filter((each) => each.escalation !== undefined);
    const carried = ended.map(({ escalation, decision, ...each }) => each);
    if (escalating.length > 0) {
      keep(carried);
      const answer = ask({ directories: Object.fromEntries(escalating.map(({ role, outcome }) => [role, outcome])) });
      try {
        await l2.escalated(card, answer);
      } catch (failure) {
        failed.push(failure);
      }
      if (failed.length === 0) return carried;
    }
    if (failed.length === 0) return carried.filter((each) => each.outcome !== undefined);
    keep(carried);
    throw new AggregateError(failed, `card #${card.number}'s judges did not all hand back an outcome`);
  };

  /**
   * One claimed card's work: its start, then its attempt and L2's handling of the maker's outcome,
   * handed over unread, or, for a card L2 answered with its judges at the pull, those judges alone,
   * with no workspace made and no maker dispatched, asking L2 again through the `decide` the facts
   * call answered. The slot is released however it ends, and then `freed` runs, unless the start
   * was not made: a claim the board refused to move, or whose pull event the sink refused, waits
   * for the next trigger rather than starting another pull at once, by the owner's ruling on
   * #228, so a board refusing every claim, or a sink refusing every event, cannot keep a run
   * pulling. Settles on `{ reached, failure }`: `reached`, what the card answers as `trigger` says,
   * or nothing for a card whose maker never ran and whose work failed; and `failure`, the work's
   * failure and a refused release event, both reported as `released` says, or null where there was
   * neither. A card whose maker ran keeps its maker's result in `reached` though its judges then
   * failed, as `attempt` says. A card one of whose judges failed to hand back carries in `reached`
   * every judge L2 named beside its number, as `judges` hands them to its `keep`, whichever way it
   * was claimed, and whether or not its release event was refused. L2's report of a refused
   * transition event passes through unchanged as the work's failure where it comes from the claim;
   * from the maker's settle it comes back in the card's `settled`, as `attempt` says. `excluded`
   * receives a stopped card, a card whose judges L2 withheld, or a removal's following refusal
   * or ignore before `freed` fires another trigger, and lives for this run alone.
   * A removal keeps this claim through guarded cleanup and its following ordinary action.
   * Cleanup failure is retained beside that action's failure and never replaces the action;
   * a following Coding move is attempted only after cleanup.
   */
  const work = async (claim, freed, excluded) => {
    const { card, decide: atPull } = claim;
    let next = claim.next;
    /** Keeps L2's withheld or escalating card out of later pulls, including a refused escalation write. */
    const remember = (answer) => {
      if (answer.action === 'escalate' || answer.action === 'stop' || answer.withheld?.length > 0) excluded?.add(card.number);
      return answer;
    };
    // Whether the start was made: for a redo as for a Ready card, only once `start` returns.
    let claimed = false;
    let failure = null;
    let removalFailure = null;
    let reached;
    // Whether L2 held the card under this claim. A held card needs no memory, because its hold
    // closed admission; removing the closer is what lets a later pull claim it again.
    let held = false;
    try {
      await start(claim);
      claimed = true;
      if (next.action === 'remove') {
        try {
          await removeDirectories(card.number);
        } catch (failure) {
          removalFailure = failure;
        }
        next = next.following;
        if (['dispatch', 'judge', 'continue'].includes(next.action)) {
          claimed = false;
          await l2.claimed(card, next);
          claimed = true;
        }
      }
      const kept = (made) => { reached = made; };
      if (next.action === 'move') {
        if (next.to === 'done') await removeDirectories(card.number);
        await l2.moved(card, next);
        reached = { card: card.number, ...next };
      } else if (next.action === 'return') {
        await l2.returned(card, next);
        reached = { card: card.number, action: 'return', pull: next.pull };
      } else if (next.action === 'escalate') {
        await l2.escalated(card, next);
        excluded?.add(card.number);
        reached = { card: card.number, ...next };
      } else if (['refuse', 'ignore'].includes(next.action)) {
        excluded?.add(card.number);
        reached = { card: card.number, ...next };
      } else {
        reached = next.action === 'judge'
          ? { card: card.number, judges: await judges(card, next, (options) => atPull(card, [], options), (ended) => kept({ card: card.number, judges: ended }), remember) }
          : await attempt(card, next, kept, remember, excluded);
      }
    } catch (thrown) {
      failure = thrown;
      held = thrown.card === card.number && thrown.decision === 'hold';
      if (['move', 'return', 'escalate'].includes(next.action)) excluded?.add(card.number);
      // A stopped card is remembered; a held one is not.
      if (thrown.card === card.number && Array.isArray(thrown.attemptFailures) && !held) excluded?.add(card.number);
    }
    if (removalFailure !== null) {
      failure = failure === null ? removalFailure : new AggregateError([removalFailure, failure], `card #${card.number}'s directory removal and following action failed`);
    }
    if (next.action === 'continue' && !held && !(reached?.settled?.status === 'fulfilled' && reached.settled.value !== undefined)) {
      excluded?.add(card.number);
    }
    failure = released(release, claim, failure);
    holds.delete(card.number);
    settles.delete(card.number);
    if (claimed) await freed();
    return { reached, failure };
  };

  /**
   * One merge claim's work: its start, which records its pull, then its merge in the lane, as the
   * lane's `merge` says. Its claim is released however it ends, with no `slot.release`, since it
   * holds no slot, and fires no trigger, since it frees none. Settles on `{ reached, failure }` as
   * `work` does.
   */
  const merged = async (claim, excluded) => {
    let ended;
    try {
      await start(claim);
      ended = await merge(claim);
    } catch (failure) {
      ended = { failure };
    }
    claims.delete(claim.card.number);
    // Whatever its merge answered, the card waits for the next invocation rather than this run's next pull.
    excluded?.add(claim.card.number);
    return { reached: ended.reached, failure: ended.failure };
  };

  /**
   * Fires the pull trigger once: claims as many cards as there are free slots, as `take` says, and
   * works each. `freed` runs as each claimed card's slot is released, as `work` says, and that
   * card's work is not over until it settles. `excluded` is this run's cards omitted from later
   * pulls; without it, a single pull keeps no admission memory.
   *
   * It claims no more than `limit` cards where one is given, merges among them, and otherwise as
   * many as there are free slots, beside every card L2 answered `merge`. Settles once every card it
   * claimed has been worked, on what each card it claimed answers, in one of these shapes:
   *
   * - a card whose maker ran: `{ card, workspace, outcome, settled }`, naming its number, its
   *   workspace's path, the maker's outcome and L2's settle of it, as `attempt` answers them, and
   *   `judges` beside them, each `{ role, outcome }`, where L2 named judges after the settle and
   *   every one dispatched handed back;
   * - a card pulled for its judges alone: `{ card, judges }`, the judges as `judges` answers them,
   *   with no workspace made and no maker dispatched.
   * - a card pulled for its merge: `{ card, action: 'merge', pull, head, merge }`, as the lane
   *   answers it, `merge` being what its `merge.end` named.
   *
   * A closed admission answers `{ admission, reached: [] }`, with the closers `take` read. A card
   * that failed before its maker ran answers nothing. A read that fails
   * rejects with the read's own error, and no card is claimed. A card whose work fails, and a trigger event the
   * sink refused, are reported in one AggregateError naming how many failed, each failure
   * unchanged in its `errors`, and carrying as `reached` what every card answered, as the pull
   * would have settled on them, so no card's outcome is dropped for another's failure. A card for
   * which L2's judge answer threw is in `reached` with its maker's result and no `judges`. A card
   * one of whose judges failed to hand back is in `reached` under its number, in the shape its
   * claim gives it above, its `judges` holding every judge L2 named, in the order L2 named them,
   * each `{ role, outcome }`, `{ role, failure }` or `{ role, withheld }`, as `judges` hands them to
   * its `keep`. Its failure, naming the card and each judge that failed to hand back, and why, is
   * in `errors`, inside an AggregateError beside the refusal where its release event was refused,
   * as `released` says.
   */
  const trigger = async (freed = () => {}, limit = undefined, excluded, settlePending = () => {}) => {
    // The settle goes to the caller as one copy L3 made, by the one snapshot every notice of this
    // trigger was read by, its failures and cards together, whether it fulfils or rejects, so a
    // value met in both is one copy, and nothing another layer gave L3 reaches the caller unread.
    const snapshot = snapshotting();
    try {
      return snapshot.copy(await settle(freed, limit, excluded, snapshot, settlePending));
    } catch (thrown) {
      throw snapshot.failure(thrown);
    }
  };

  /** The trigger's settle, as `trigger` says, before its copy: its answer, or the failure it throws. */
  const settle = async (freed, limit, excluded, snapshot, settlePending) => {
    settlePending();
    const { claims: claimed, failures, admission: closed, notices = [] } = await take(limit, excluded, snapshot);
    for (const { card } of claimed) settles.set(card.number, snapshot);
    // Where admission is open, as after a concurrent `resume`, no closed admission carries the
    // notices, so each is a failure of this pull and reaches the caller there.
    if (closed === undefined) failures.push(...notices.map(noticeFailure));
    for (const { kind, id, issue } of closed?.closers ?? []) {
      const ended = kind === 'hold' && issue === undefined ? await notify(id, undefined, undefined, snapshot) : undefined;
      if (ended?.failed !== undefined) notices.push({ id, ...ended.failed });
      failures.push(...(ended?.unrecorded ?? []));
    }
    if (claimed.length > 0) idle = false;
    if (claims.size === 0 && !idle) {
      idle = true;
      try {
        settlePending();
        record('trigger', { trigger: 'drain' });
      } catch (refusal) {
        failures.push(refused('the event sink refused to record the drain trigger', refusal));
      }
    }
    const worked = await Promise.allSettled(claimed.map((claim) => (claim.next.action === 'merge' ? merged(claim, excluded) : work(claim, freed, excluded))));
    const ended = worked.map((result) => (result.status === 'fulfilled' ? result.value : { failure: result.reason }));
    failures.push(...ended.filter((each) => each.failure !== null).map((each) => each.failure));
    const reached = ended.map((each) => each.reached).filter((each) => each !== undefined);
    if (failures.length > 0) {
      // A closed admission's notices would otherwise go only with the answer this throw replaces.
      if (closed !== undefined) failures.push(...notices.map(noticeFailure));
      throw Object.assign(new AggregateError(failures, `${failures.length} failures across the ${claimed.length} cards this pull claimed`), { reached });
    }
    return closed === undefined ? reached : { admission: closed, reached, notices };
  };

  return {
    /**
     * Fires the pull trigger once, as `trigger` says, claiming no more than `limit` cards where one
     * is given, merges among them, and never more slots than N. A limit that is not a positive whole number is refused,
     * naming it, before the board is read.
     */
    pull: async (limit) => {
      refuseLimit(limit);
      return trigger(() => {}, limit);
    },

    /**
     * Fires the pull trigger, and fires it again each time a slot this run filled is released, so
     * a card freeing its slot lets the next pullable card start while the others still run. A slot
     * freed by a claim move the board refused fires nothing, as `work` says. Ends
     * once every pull it fired has settled, which is once a pull fired on a freed slot claims
     * nothing and no card it claimed is still being worked. A stopped card or one whose judges L2
     * withheld stays out of later pulls in this run; the next invocation starts without that memory.
     *
     * Settles on what every card its pulls answered, in the shapes `trigger` says. A pull that
     * fails stops no other, and its cards are carried in its own failure's `reached`. Once the run has ended, every failed pull is reported in
     * one AggregateError naming how many failed, each pull's own failure unchanged in its `errors`,
     * and carrying as `reached` what every pull that settled answered, so no card's outcome is
     * dropped for another pull's failure, and, where a pull read admission closed, as `admission`
     * what that read answered, so a run that ended on a hold answers its closer.
     * A closed pull's notices, which `pull` answers beside its admission, are failures of the run.
     * A start's kill that failed rejects the run with its failure, before `run.start`.
     */
    run: async ({ singlePull = false } = {}) => {
      if (singlePull && !Object.values(config.clock?.triggers ?? {}).some((one) => one.job === 'report')) return trigger();
      await killed();
      record('run.start', { concurrency });
      idle = false;
      const failures = [];
      const clockFailures = [];
      const reached = [];
      const reports = [];
      const handoffs = [];
      const excluded = new Set();
      const pending = new Map();
      let closed;
      const clockFailed = (failure) => { clockFailures.push(failure); handoffs.push({ failure }); };
      const settlePending = () => {
        for (const [name, at] of pending) {
          try { record('trigger.outcome', { name, occurrence: at, outcome: 'abandoned' }); }
          catch (refusal) {
            clockFailed(refused(`clock trigger ${name} at ${at} stayed pending, because the event sink refused its abandoned outcome`, refusal));
            continue;
          }
          pending.delete(name);
        }
      };
      const stopClock = clockReports(config.clock?.triggers, clock, ({ name, occurrence }) => {
        const at = new Date(occurrence).toISOString();
        settlePending();
        if (pending.has(name)) return false;
        try { record('trigger', { trigger: 'clock', name, occurrence: at }); }
        catch (refusal) {
          clockFailed(refused(`clock trigger ${name} at ${at} did not start, because the event sink refused its firing start`, refusal));
          return false;
        }
        let report;
        let failure;
        try { report = deriveReport(state); }
        catch (thrown) { failure = thrown; }
        try { record('trigger.outcome', { name, occurrence: at, outcome: failure ? 'failed' : 'job' }); }
        catch (refusal) {
          pending.set(name, at);
          clockFailed(refused(`clock trigger ${name} at ${at} stayed pending, because the event sink refused its outcome`, refusal));
          return true;
        }
        if (failure) clockFailed(new Error(`clock trigger ${name} at ${at}: ${failure.message}`, { cause: failure }));
        else { reports.push(report); handoffs.push({ report }); }
        return true;
      });
      const fire = () => trigger(singlePull ? () => {} : fire, undefined, excluded, settlePending).then((each) => {
        reached.push(...(Array.isArray(each) ? each : each.reached));
        if (!Array.isArray(each)) closed = each.admission;
        // A closed pull's notices are its failures to report, a made write's refused record among
        // them, so the run passes each on to its caller rather than ending with `reached` alone.
        if (!Array.isArray(each)) failures.push(...(each.notices ?? []).map(noticeFailure));
      }, (failure) => {
        failures.push(failure);
      });
      try {
        await fire();
        if (failures.length + clockFailures.length > 0) {
          const all = [...failures, ...clockFailures];
          const message = clockFailures.length === 0 ? `${failures.length} of the pulls this run fired failed` : `${all.length} failures in this run`;
          throw Object.assign(new AggregateError(all, message), { reached, reports, handoffs, ...(closed && { admission: closed }) });
        }
        return handoffs.length === 0 ? reached : Object.assign(reached, { reports, handoffs });
      } finally {
        stopClock();
      }
    },
  };
}
