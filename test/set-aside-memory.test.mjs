// ABOUTME: Proves a run's memory of the cards it set aside: when a clock-held run's read of the board
// ends a card's skip (R-SCHED-43, R-LOOP-19), and when a line-moved stop is remembered (R-FAIL-8).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';

import config from '../rigger.config.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { BRANCH_REFUSED, LINE_DELETED, LINE_MOVED, WORKSPACE_NOT_MADE, WORKSPACE_REFUSED } from '../src/execution/workspace.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createFakeRepository, markerComment } from './fake-repository.mjs';
import { forge } from './notice-forge.mjs';
import { line } from './clock-arming-world.mjs';
import { composeClockMark } from '../src/workflow/clock-mark.mjs';
import { validate } from '../src/config/validate.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { manualClock, START } from './clock-report-world.mjs';
import { postedNote } from './escalation-world.mjs';
import { COLUMNS, KINDS, boardOf, handleOn, positive } from './loop-world.mjs';

/** The poll interval each clock-held world declares, in milliseconds. */
const POLL = 100;

/**
 * The most reads of the board a world answers. Each test reads far fewer, so a run that pulls a
 * skipped card again at every release fails its next read, and its pulls show, rather than spinning.
 */
const READ_CAP = 40;

/** The workspace failure codes a script names, each as L1 hands L2 a failed make (`unmade` in next-action.mjs). */
const FAILURES = { refused: BRANCH_REFUSED, moved: LINE_MOVED, deleted: LINE_DELETED, local: WORKSPACE_REFUSED };

/** L1's outcome for a maker that ran and exited `exit`, as L2's `settled` documents a fulfilled dispatch. */
const ran = (exit) => ({ status: 'fulfilled', value: { exit, stdout: '', stderr: '' } });

/** A maker that ran and exited 7. */
const RAN = ran(7);

/** Every gate not yet opened, which a world's teardown opens, as a refused workspace, before it stops its runs. */
const unopened = new Set();

/**
 * The failure an L0 write side throws where the forge made the write and the sink refused its
 * event: `refused` in process.mjs carries `code`, `unrecorded` and `result`, and `written` in
 * write-made.mjs marks it `made`, holding the write's `answer`.
 */
const made = (what, answer, stdout) => Object.assign(new Error(`the sink refused ${what}'s event`), {
  code: 'EVENT_REFUSED',
  unrecorded: [{ event: 'command.end', cause: new Error('the sink refuses command.end') }],
  result: { exit: 0, timedOut: false, stdout, stderr: '' },
  made: { answer },
});

/** A promise the test settles by hand, for holding a workspace or a board read. */
function gate() {
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });
  const each = { promise, open: (value) => { unopened.delete(each); settle(value); } };
  unopened.add(each);
  return each;
}

/**
 * A loop over a fake board and forge with real L2, starting no process. `script(card, claim, {
 * repository })` answers what the card's workspace does at its `claim`th claim, counted from 1: a
 * key of `FAILURES`, whose code L1's make rejects with; `maker`, a workspace whose path does not
 * exist, so the maker L2 names never starts; or a promise of either. A maker the world dispatches
 * is handed to L2, at its settle and its next action alike, as one that ran and exited `exit`.
 * `judges` are the change kind's judges. `refuseMove(column)` has the board refuse a move to that
 * column, and `madeAnyway` has it make the move it refused. `refuseLabel` has the forge refuse the
 * escalation label, and `refuseRecord(event, fields)` has the sink refuse that append. `escalate`
 * is the config's escalation routing, and `beforeSettle({ repository, card, dispatch })` runs as L2
 * is asked to settle a maker, as a maker's own forge writes would land before it exits. An escalation
 * role is handed to L2's role settle as one that ran and exited `exit`. A judge's directory is not
 * made, and where `judgeRefused`, L1 refused its replace rule, which L2 escalates as card-local.
 * `madeMove(column)` and `madeLabel` have the forge make that move, or add the escalation label,
 * and refuse only its event, as `made` below shapes the failure. `merge`, where given, answers the
 * lane's next merge call in place of the fake repository's merge. `beforeMove(column)` is awaited as
 * each move of a card reaches the board, so a test can hold that move.
 */
function world(t, { cards = [12], clockHeld = true, concurrency = 1, script = () => 'refused', branches = [], refuseMove = () => false, madeAnyway = false, refuseLabel = false, exit = 7, judges = KINDS.change.judges, refuseRecord = () => false, escalate = {}, beforeSettle = () => {}, judgeRefused = false, madeMove = () => false, madeLabel = false, merge, beforeMove = async () => {} } = {}) {
  const clock = manualClock();
  const directory = temporaryDirectory('rigger-set-aside-', { context: t });
  const kinds = { change: { ...KINDS.change, judges } };
  const settings = { ...config, kinds, concurrency, escalate };
  delete settings.clock;
  if (clockHeld) settings.clock = { poll: POLL, triggers: { later: { interval: 3_600_000, anchor: new Date(START).toISOString(), catchUp: 'skip', job: 'report' } } };
  const fake = boardOf(cards);
  const repository = createFakeRepository({ repo: settings.repo, issues: fake.issues(), branches });
  const opened = openSink({ directory, run: 'r-aside', now: clock.now });
  const sink = { emitter: (context) => {
    const emitter = opened.emitter(context);
    return { emit: (event, fields) => {
      if (refuseRecord(event, fields ?? {})) throw new Error(`the sink refuses ${event}`);
      return emitter.emit(event, fields);
    } };
  } };
  const items = {
    ...fake.operations,
    moveItem: async (id, column) => {
      await beforeMove(column);
      if (madeMove(column)) {
        await fake.operations.moveItem(id, column);
        throw made('the move', {}, '{}');
      }
      if (!refuseMove(column)) return fake.operations.moveItem(id, column);
      if (madeAnyway) await fake.operations.moveItem(id, column);
      throw new Error(`the board refuses the move of ${id} to ${column}`);
    },
  };
  const l2 = columnChanges({ config: settings, sink, items, reads: repository.operations, roleReads: () => repository.operations, repositoryWrites: {
    postComment: repository.postComment, mergePullRequest: repository.mergePullRequest,
    postIssueComment: (...args) => repository.postIssueComment(...args),
    addIssueLabel: async (number, label) => {
      if (refuseLabel) throw new Error(`the forge refuses label ${label}`);
      const labels = await repository.addIssueLabel(number, label);
      if (madeLabel) throw made('the label', labels, '[]');
      fake.setIssueLabels(settings.repo, number, labels.map(({ name }) => name));
      return labels;
    },
  } });
  const settle = l2.settled;
  l2.settled = async (card, outcome, options = {}) => {
    await beforeSettle({ repository, card: card.number, dispatch: options.dispatch });
    return settle(card, ran(exit), options);
  };
  if (merge !== undefined) repository.answerMerge(merge(repository));
  const roleSettle = l2.roleSettled;
  l2.roleSettled = (card, next, outcome, options) => roleSettle(card, next, ran(exit), options);
  const decide = (card, outcomes, options = {}) => nextAction(card, kinds, undefined, { roles: settings.roles, provisioning: {}, outcomes, sink, ...options, ...(options.maker === undefined ? {} : { maker: ran(exit) }) });
  const claimsOf = new Map();
  const workspace = async (number) => {
    const claim = (claimsOf.get(number) ?? 0) + 1;
    claimsOf.set(number, claim);
    const given = await script(number, claim, { repository });
    if (given === 'maker') return { path: join(directory, 'never-made', `rigger-${number}`) };
    throw Object.assign(new Error(`scripted ${given} workspace for card ${number}`), { code: FAILURES[given], path: join(directory, 'workspaces', `rigger-${number}`) });
  };
  // Each board read waits on the gate the test queued for it, if any, before reading the board.
  const held = [];
  const base = handleOn(fake);
  let begun = 0;
  let ended = 0;
  const board = {
    readColumns: base.readColumns,
    // The lane's read of a card it reaches, which counts as no read of a pull.
    readItems: fake.operations.readItems,
    readPriority: async () => {
      begun += 1;
      if (begun > READ_CAP) throw new Error(`the world answers at most ${READ_CAP} reads of the board`);
      const hold = held.shift();
      if (hold !== undefined) await hold;
      try { return await base.readPriority(); } finally { ended += 1; }
    },
  };
  // How many of L3's reads handed card 12 to L2's facts call, which a skipped card never is.
  let offered = 0;
  const facts = factsCall({ config: settings, reads: repository.operations, decide });
  // Gates the test queues for the next calls of L2's facts call, which a pull awaits after its read answers.
  const factsHolds = [];
  const offering = async (items) => {
    const hold = factsHolds.shift();
    if (hold !== undefined) { hold.waiting = true; await hold.promise; }
    if (items.some((item) => item.number === 12)) offered += 1;
    return facts(items);
  };
  const built = loop({ config: settings, board, decide, facts: offering, l2, sink,
    kill: async () => {}, workspace, // A judge's directory fails as L1's make fails one (`makeDetachedDirectory` in workspace.mjs), so L2 withholds the judge.
    judgeDirectory: async (number, role) => { throw Object.assign(new Error(`scripted judge directory for ${role} of card ${number} not made`), { code: judgeRefused ? WORKSPACE_REFUSED : WORKSPACE_NOT_MADE, path: join(directory, 'judges', `rigger-${number}`, role) }); },
    removeDirectories: async () => {}, state: directory, environment: {}, run: 'r-aside', clock });
  const events = () => (existsSync(streamPath(directory)) ? readEvents(directory) : []);
  const pulls = (number = 12) => events().filter((event) => event.layer === 'L3' && event.event === 'pull' && event.card === number).length;
  const makers = (number = 12) => events().filter((event) => event.layer === 'L3' && event.event === 'dispatch' && event.role !== undefined && event.card === number).length;
  const column = async (number = 12) => (await fake.operations.readItems()).find((item) => item.number === number).column;
  const move = async (number, to) => {
    const item = (await fake.operations.readItems()).find((each) => each.number === number);
    await fake.operations.moveItem(item.id, to);
  };
  const runs = [];
  t.after(async () => {
    // A test that failed while a gate held a read or a workspace still lets its runs end.
    for (const each of [...unopened]) each.open('refused');
    for (const each of runs) await each.stop();
  });
  const start = () => {
    const controller = new AbortController();
    const handed = [];
    const running = built.run({ handOver: (value) => handed.push(value), stop: controller.signal });
    running.catch(() => {});
    const each = { handed, running, stop: () => { controller.abort(); return running.catch(() => {}); } };
    runs.push(each);
    return each;
  };
  /** One poll of an idle clock-held run: settles once the poll has claimed, or settled claiming nothing. */
  const poll = () => clock.advance(clock.now() + POLL);
  return { start, poll, pulls, makers, column, move, events, repository, fake, clock, holdNextRead: (promise) => held.push(promise), reads: () => ({ begun, ended }), offered: () => offered,
    holdFacts: () => { const g = gate(); factsHolds.push(g); return g; },
    // A person removing every label but the kind's, as the board's issue labels change, moving nothing.
    unlabel: () => fake.setIssueLabels(settings.repo, 12, ['type:change']) };
}

/** Waits until `run` has handed over its `count`th busy period, which ends with the drain once its claims are released. */
const busy = (run, count) => positive(() => run.handed.length >= count);

// R-SCHED-43 rows S1 and S3: a read begun before the setting aside keeps the skip whatever it
// shows, and the first read begun after that finds the card in Ready claims it.
// proves R-SCHED-43
test('S1 S3: a read begun before the setting aside keeps the skip, and a later read finding Ready ends it', async (t) => {
  const workspaces = { 12: gate(), 13: gate() };
  const here = world(t, { cards: [12, 13], concurrency: 2, script: async (number, claim) => (claim === 1 ? workspaces[number].promise : 'refused') });
  const run = here.start();
  await positive(() => here.pulls(12) === 1 && here.pulls(13) === 1);
  const before = gate();
  const after = gate();
  here.holdNextRead(before.promise);
  here.holdNextRead(after.promise);
  workspaces[13].open('refused');
  await positive(() => here.reads().begun === 2);
  workspaces[12].open('refused');
  await positive(() => here.reads().begun === 3);
  assert.equal(await here.column(12), COLUMNS.coding, 'the claim moved card 12 to Coding');
  await here.move(12, COLUMNS.ready);
  before.open();
  await positive(() => here.reads().ended >= 2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(here.pulls(12), 1, 'S1: the read begun before card 12 was set aside must keep its skip, though it shows Ready');
  after.open();
  await positive(() => here.pulls(12) === 2);
  assert.equal(here.pulls(13), 1, 'S2: card 13, still in its compared column Coding, stays skipped');
  await busy(run, 1);
});

// R-SCHED-43 rows S2, S3, S6 and S7: each poll begun after the setting aside compares the card's
// column with its compared column, and a skip that ends starts the card's entry afresh.
// proves R-SCHED-43
test('S2 S3 S6 S7: polls keep the skip in the compared column, end it in Ready, and start a later skip afresh', async (t) => {
  const here = world(t);
  const run = here.start();
  await busy(run, 1);
  assert.equal(here.pulls(), 1);
  for (let each = 0; each < 3; each += 1) await here.poll();
  assert.equal(here.pulls(), 1, 'S2: polls finding the card in its compared column keep the skip');
  await here.move(12, COLUMNS.ready);
  await here.move(12, COLUMNS.coding);
  await here.poll();
  assert.equal(here.pulls(), 1, 'S6: a move undone between two reads is not seen');
  await here.move(12, COLUMNS.ready);
  await here.poll();
  await busy(run, 2);
  assert.equal(here.pulls(), 2, 'S3: a poll finding the card in Ready, its compared column Coding, claims it');
  for (let each = 0; each < 3; each += 1) await here.poll();
  assert.equal(here.pulls(), 2, 'S7: the card set aside again is skipped from its later setting aside');
  await here.move(12, COLUMNS.ready);
  await here.poll();
  await busy(run, 3);
  assert.equal(here.pulls(), 3, 'S7: the later entry ends as the first did');
});

// R-SCHED-43 row S4: a read finding the card in a column other than Ready and its compared column
// ends the skip, and the pull answers the card as it answers any card in that column.
// proves R-SCHED-43
test('S4: a poll finding the card in Owner ends the skip, and the pull answers it as an Owner card', async (t) => {
  const here = world(t);
  const run = here.start();
  await busy(run, 1);
  await here.move(12, COLUMNS.owner);
  await here.poll();
  await busy(run, 2);
  assert.equal(here.pulls(), 2, 'the Owner card is claimed again');
  assert.equal(here.makers(), 0, 'an Owner card holding nothing on the forge is answered without a maker');
  assert.ok(here.events().some((event) => event.event === 'review.escalate' && event.card === 12), 'L2 answers an Owner card with no pull request by escalating it');
});

// R-SCHED-43 rows S5 and S2: a change the board refused leaves the compared column, Ready here,
// so every later read finding Ready keeps the skip.
// proves R-SCHED-43
test('S5 S2: a refused escalation move leaves the compared column at Ready, and the skip holds there', async (t) => {
  const here = world(t, { branches: ['rigger-12'], refuseMove: (column) => column === COLUMNS.owner });
  const run = here.start();
  await busy(run, 1);
  assert.equal(here.pulls(), 1);
  assert.equal(await here.column(), COLUMNS.ready, 'the board refused the escalation move');
  for (let each = 0; each < 3; each += 1) await here.poll();
  assert.equal(here.pulls(), 1, 'the skip holds while each read finds the card in Ready, its compared column');
});

// R-SCHED-43 rows S5 and S8: a move the board accepted moves the compared column, though a later
// write of the same change failed; a refused move the board made anyway is seen at the next read.
// proves R-SCHED-43
test('S5 S8: an accepted move sets the compared column, and a refused move made anyway ends the skip', async (t) => {
  for (const cell of ['accepted', 'made-anyway']) {
    await t.test(cell, async (t) => {
      const here = world(t, cell === 'accepted'
        ? { branches: ['rigger-12'], refuseLabel: true }
        : { branches: ['rigger-12'], refuseMove: (column) => column === COLUMNS.owner, madeAnyway: true });
      const run = here.start();
      await busy(run, 1);
      assert.equal(await here.column(), COLUMNS.owner, `${cell}: the board holds the card in Owner`);
      for (let each = 0; each < 3; each += 1) await here.poll();
      assert.equal(here.pulls(), cell === 'accepted' ? 1 : 2, cell === 'accepted'
        ? 'S5: the accepted move to Owner is the compared column, so reads finding Owner keep the skip'
        : 'S8: the refused move left Ready as the compared column, so the read finding Owner ends the skip');
    });
  }
});

// R-SCHED-43 row S8′ (the architect's ruling 1178#6605091082): the lane's move to Done at a merge's
// end, which the board refused but made; a read begun before that card was set aside that answers
// after it showing Done; and a poll begun after that. The first read keeps the skip under S1 and
// changes no compared column, so the poll, finding the card in Done, the refused move's target,
// ends the skip. A merge claim's end begins no read of its own, so card 13's stop begins the first.
// proves R-SCHED-43
test('S8′: a read begun before the setting aside changes no compared column, so the next read ends the skip at a refused move made anyway', async (t) => {
  const done = gate();
  const workspace = gate();
  let moving = false;
  const here = world(t, { cards: [12, 13], concurrency: 2, refuseMove: (column) => column === COLUMNS.done, madeAnyway: true,
    beforeMove: (column) => { if (column !== COLUMNS.done) return undefined; moving = true; return done.promise; },
    script: async (number, claim) => (number === 13 && claim === 1 ? workspace.promise : 'refused') });
  await ownerSound(here);
  const run = here.start();
  await positive(() => moving && here.pulls(13) === 1);
  assert.equal(here.pulls(), 1, 'the run claimed card 12 for its merge, whose move to Done waits');
  const before = gate();
  here.holdNextRead(before.promise);
  const begun = here.reads().begun;
  workspace.open('refused');
  await positive(() => here.reads().begun === begun + 1);
  done.open();
  // The lane ends the merge, and card 12 is set aside, while card 13's release read waits.
  await positive(() => here.events().some((event) => event.event === 'merge.end' && event.card === 12));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await here.column(), COLUMNS.done, 'the board made the move to Done it refused');
  const offered = here.offered();
  before.open();
  await positive(() => here.reads().ended === begun + 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(here.offered(), offered, 'S1: the read begun before the setting aside keeps the skip, though it shows Done');
  await busy(run, 1);
  await here.poll();
  assert.equal(here.offered(), offered + 1, 'the poll begun after the setting aside finds Done, the refused move\'s target, and ends the skip');
});

// R-LOOP-19 row S6a: a failed maker's card the board shows moved to Ready has its maker dispatched again.
// proves R-LOOP-19, R-SCHED-43
test('S6a: a failed maker set aside and moved back to Ready is dispatched again in the same run', async (t) => {
  const here = world(t, { script: () => 'maker' });
  const run = here.start();
  await busy(run, 1);
  assert.equal(here.makers(), 1);
  await here.poll();
  assert.equal(here.makers(), 1, 'the set-aside maker is not dispatched again while the card stays in Coding');
  await here.move(12, COLUMNS.ready);
  await here.poll();
  await busy(run, 2);
  assert.equal(here.makers(), 2, 'the read finding Ready ends the skip, and the run dispatches the maker again');
});

// R-LOOP-19 rows S6b and S6c: a failed maker's skip holds in its compared column, and a read
// finding it in a column other than Ready ends the skip, the pull answering it as any card there:
// an Owner card holding nothing is escalated, and a Review card holding nothing is done again from
// the beginning (`R-WORK-24`).
// proves R-LOOP-19, R-SCHED-43
test('S6b S6c: a failed maker stays skipped in Coding, and a read finding it elsewhere answers it as any card there', async (t) => {
  const cells = {
    [COLUMNS.coding]: { pulls: 1, makers: 1, escalated: false },
    [COLUMNS.owner]: { pulls: 2, makers: 1, escalated: true },
    [COLUMNS.review]: { pulls: 2, makers: 2, escalated: false },
  };
  for (const [column, expected] of Object.entries(cells)) {
    await t.test(column, async (t) => {
      const here = world(t, { script: () => 'maker' });
      const run = here.start();
      await busy(run, 1);
      if (column !== COLUMNS.coding) await here.move(12, column);
      for (let each = 0; each < 3; each += 1) await here.poll();
      if (column !== COLUMNS.coding) await busy(run, 2);
      assert.equal(here.pulls(), expected.pulls, `${column}: the claims of the card`);
      assert.equal(here.makers(), expected.makers, `${column}: the maker dispatches for the card`);
      assert.equal(here.events().some((event) => event.event === 'review.escalate' && event.card === 12), expected.escalated, `${column}: whether L2 escalated the card`);
    });
  }
});

// R-FAIL-8's row for a line of work moved or deleted, rows S8a and S8b: a workspace rejecting the
// code on every attempt has the card claimed exactly twice, then set aside, in either run.
// proves R-FAIL-8, R-SCHED-43
test('S8a S8b: a line-moved or line-deleted stop is claimed again once, then set aside', async (t) => {
  for (const code of ['moved', 'deleted']) {
    for (const clockHeld of [true, false]) {
      await t.test(`${code} ${clockHeld ? 'clock-held' : 'drained'}`, async (t) => {
        const here = world(t, { clockHeld, script: () => code });
        if (clockHeld) {
          const run = here.start();
          await busy(run, 1);
          for (let each = 0; each < 3; each += 1) await here.poll();
        } else {
          // A drained run ends on the stops it reports, so its rejection is the expected end.
          await here.start().running.catch(() => {});
        }
        assert.equal(here.pulls(), 2, `${code}: the first stop re-reads the forge, and the second is remembered`);
      });
    }
  }
});

// R-SCHED-43 row S8c: the line-moved count starts with the invocation and again at each skip's
// end, whatever set the card aside, across repeated person moves.
// proves R-FAIL-8, R-SCHED-43
test('S8c: each skip a person ends makes the next line-moved stop a first', async (t) => {
  const cells = {
    'set aside by a refused branch': ['moved', 'refused', 'moved', 'moved', 'moved', 'moved'],
    'set aside by its second line-moved stop': ['moved', 'moved', 'moved', 'moved', 'moved', 'moved'],
    'set aside by a line-deleted stop after a line-moved one': ['moved', 'deleted', 'deleted', 'moved', 'deleted', 'deleted'],
  };
  for (const [name, answers] of Object.entries(cells)) {
    await t.test(name, async (t) => {
      const here = world(t, { script: (number, claim) => answers[claim - 1] ?? 'refused' });
      const run = here.start();
      await busy(run, 1);
      assert.equal(here.pulls(), 2, 'the first stop is re-read, and the second claim sets the card aside');
      for (const [move, claimed] of [[2, 4], [3, 6]]) {
        await here.move(12, COLUMNS.ready);
        await here.poll();
        await busy(run, move);
        assert.equal(here.pulls(), claimed, `person's move ${move - 1}: the next line stop is a first, so the forge is read once more`);
      }
      await here.move(12, COLUMNS.ready);
      await here.move(12, COLUMNS.coding);
      for (let each = 0; each < 3; each += 1) await here.poll();
      assert.equal(here.pulls(), 6, 'the second stop after each skip ends is remembered');
    });
  }
  await t.test('a new invocation', async (t) => {
    const here = world(t, { script: () => 'moved' });
    const first = here.start();
    await busy(first, 1);
    await first.stop();
    assert.equal(here.pulls(), 2);
    const second = here.start();
    await busy(second, 1);
    assert.equal(here.pulls(), 4, 'the count starts again with the invocation');
  });
});


// R-FAIL-8 rows S8b and S8c with two pulls ending one skip (the round-7 attacker's P5): a read whose
// first comparison ended card 12's skip waits in L2's facts call, while another pull ends the same
// skip, claims the card and counts its first line stop. The waiting read's `done` must not reset
// that count, so the card's second line stop sets it aside: claimed exactly twice after its skip.
// proves R-SCHED-43
test('S8b S8c: a pull whose read ended a skip another pull already ended resets no line-stop count taken since', async (t) => {
  const g13 = gate();
  const g14 = gate();
  const g12 = gate();
  const here = world(t, { cards: [12, 13, 14], concurrency: 2, script: (number, claim) => {
    if (number === 12) return claim === 1 ? 'refused' : claim === 3 ? g12.promise : 'moved';
    if (number === 13) return claim === 1 ? g13.promise : 'refused';
    return claim === 1 ? g14.promise : 'refused';
  } });
  here.start();
  await positive(() => here.pulls(12) === 1 && here.pulls(13) === 1 && here.pulls(14) === 1);
  assert.equal(await here.column(12), COLUMNS.coding, 'card 12 set aside in Coding');
  await here.move(12, COLUMNS.ready);
  const facts = here.holdFacts();
  g14.open('refused');
  await positive(() => facts.waiting === true);
  g13.open('refused');
  await positive(() => here.pulls(12) === 3);
  facts.open();
  for (let each = 0; each < 5; each += 1) await new Promise((resolve) => setImmediate(resolve));
  g12.open('moved');
  await positive(() => here.events().filter((event) => event.event === 'slot.release' && event.card === 12).length >= 3);
  for (let each = 0; each < 3; each += 1) await here.poll();
  assert.equal(here.pulls(12), 3, 'S8b/S8c: after the skip ends, the card is claimed exactly twice, then set aside at its second line stop');
});
// R-SCHED-43 row S9: with no clock trigger declared, a set-aside card stays skipped for the run's
// life, though a read after the setting aside finds it in Ready.
// proves R-SCHED-43
test('S9: a run with no clock trigger keeps a set-aside card skipped though the board shows it moved', async (t) => {
  for (const clockHeld of [false, true]) {
    await t.test(clockHeld ? 'clock-held' : 'no clock', async (t) => {
      const workspaces = { 13: gate() };
      const here = world(t, { clockHeld, cards: [12, 13], concurrency: 2, script: async (number, claim) => (number === 13 && claim === 1 ? workspaces[13].promise : 'refused') });
      const run = here.start();
      await positive(() => here.pulls(12) === 1 && here.reads().begun === 2);
      await here.move(12, COLUMNS.ready);
      workspaces[13].open('refused');
      await positive(() => here.reads().begun >= 3);
      if (!clockHeld) await run.running.catch(() => {});
      else await busy(run, 1);
      assert.equal(here.pulls(12), clockHeld ? 2 : 1);
    });
  }
});

// R-SCHED-43 row S10: a new run on the same loop starts with no card set aside.
// proves R-SCHED-43
test('S10: a second run on the same loop claims the card the first set aside', async (t) => {
  const here = world(t);
  const first = here.start();
  await busy(first, 1);
  await first.stop();
  assert.equal(here.pulls(), 1);
  const second = here.start();
  await busy(second, 1);
  assert.equal(here.pulls(), 2, 'the later run claims the card afresh');
});

// R-LOOP-19 row S6d: a forge holding no branch and only closed pull requests holds nothing of the
// line of work, while a branch, or an open or merged pull request, is something (M7-U24).
// proves R-LOOP-19
test('S6d: a failed maker leaving only closed pull requests and no branch is set aside', async (t) => {
  const cells = [
    { name: 'nothing', pulls: [], branch: false, answer: 'set-aside' },
    { name: 'closed, no branch', pulls: [{ closed: true }], branch: false, answer: 'set-aside' },
    { name: 'two closed, no branch', pulls: [{ closed: true }, { closed: true }], branch: false, answer: 'set-aside' },
    { name: 'closed, with the branch', pulls: [{ closed: true }], branch: true, answer: undefined },
    { name: 'branch alone', pulls: [], branch: true, answer: undefined },
    { name: 'open, no branch', pulls: [{}], branch: false, answer: undefined },
    { name: 'merged, no branch', pulls: [{ merged: true }], branch: false, answer: undefined },
    { name: 'closed and merged, no branch', pulls: [{ closed: true }, { merged: true }], branch: false, answer: undefined },
  ];
  for (const cell of cells) {
    await t.test(cell.name, async (t) => {
      const directory = temporaryDirectory('rigger-set-aside-settle-', { context: t });
      const fake = boardOf([12]);
      const repository = createFakeRepository({ repo: config.repo, issues: fake.issues() });
      cell.pulls.forEach((pull, at) => repository.open({ number: 70 + at, head: 'rigger-12', sha: String(at + 1).repeat(40), ...pull }));
      // The fake's `open` holds each pull request's head as a branch; the cell decides the branch alone.
      const reads = { ...repository.operations, readBranches: async (names) => Object.fromEntries(names.map((name) => [name, cell.branch])) };
      const l2 = columnChanges({ config: { ...config, kinds: KINDS }, sink: openSink({ directory, run: 'r-settle', now: () => START }), items: fake.operations, reads });
      const [card] = await fake.operations.readItems();
      const answer = await l2.settled(card, RAN);
      assert.equal(answer?.action, cell.answer, `${cell.name}: L2's settle answer`);
      if (cell.answer === 'set-aside') assert.match(answer.reason, /card #12.*exited 7.*no branch of its line of work rigger-12.*no open or merged pull request/);
      assert.deepEqual(fake.writes(), [], 'the classification moves nothing');
    });
  }
});

/** The head the continuing worlds' pull request stands at as the run starts, and the head its maker pushes. */
const HEADS = { judged: 'a'.repeat(40), pushed: 'b'.repeat(40) };

/**
 * Puts card 12 in `column` with pull request 77 open from its line of work at `HEADS.judged`,
 * carrying a needs-revision marker at that head, so L2 answers it a continuing attempt: the
 * reviewer's, or where `owner`, the owner's beside the reviewer's sound one.
 */
async function judgedPull(here, column, owner = false) {
  const [card] = await here.fake.operations.readItems();
  await here.move(12, column);
  here.repository.open({ number: 77, head: 'rigger-12', sha: HEADS.judged, mergeBase: 'c'.repeat(40), diff: 'diff --git a/help b/help\n', mergeable: 'mergeable',
    comments: owner
      ? [markerComment({ card: 12, pull: 77, head: HEADS.judged, body: card.body }), markerComment({ card: 12, pull: 77, head: HEADS.judged, body: card.body, role: 'owner', verdict: 'needs revision', items: ['unmet'], toSound: 'Fix help.' })]
      : [markerComment({ card: 12, pull: 77, head: HEADS.judged, body: card.body, verdict: 'needs revision', items: ['unmet'], toSound: 'Fix help.' })] });
}

/**
 * How an L2 column change can end, each as the world options that end it and the column the board
 * then holds, given the change's `from` and `target` columns and its transition's `cause`:
 * - `fulfilled`: the change answered its column;
 * - `made, its event refused`: the board made the move and only its L0 event was refused;
 * - `recorded nothing`: the board took the move and the sink refused its transition;
 * - `refused before any move`: the board refused the move;
 * - `label refused` and `label made, its event refused`: the move to Owner was taken, and the
 *   escalation label then refused, or added with only its event refused.
 */
const OUTCOMES = {
  fulfilled: ({ target }) => ({ options: {}, column: target }),
  'made, its event refused': ({ target }) => ({ options: { madeMove: (column) => column === target }, column: target }),
  'recorded nothing': ({ target, cause }) => ({ options: { refuseRecord: (event, fields) => event === 'transition' && fields.cause === cause }, column: target }),
  'refused before any move': ({ from, target }) => ({ options: { refuseMove: (column) => column === target }, column: from }),
  'label refused': ({ target }) => ({ options: { refuseLabel: true }, column: target }),
  'label made, its event refused': ({ target }) => ({ options: { madeLabel: true }, column: target }),
};

/** Every outcome but the escalation label's, for a change that adds no label. */
const MOVES_ONLY = ['fulfilled', 'made, its event refused', 'recorded nothing', 'refused before any move'];

/** Every outcome, for an escalation, whose move to Owner the label follows. */
const ESCALATION = [...MOVES_ONLY, 'label refused', 'label made, its event refused'];

/**
 * Each site at which an L2 column change reaches L3's compared column, as the S5 table drives it:
 * the change moves the card `from` one column to its `target`, recording `cause`, through each of
 * `outcomes`. `options` build the world and `setup` stages the card. A fulfilled escalation leaves
 * the escalation label on the card (`labelled`). Where `kept` is false, a fulfilled change sets
 * nothing aside. `handed` is how many times the claim itself hands the card to L2's facts call:
 * once at its pull, and for a merge, once more as the lane reaches it. `sites` names the `src/`
 * lines whose column handoff the row exercises, as the PR body classifies them.
 */
const COLUMN_STEPS = {
  'a fresh claim moving the card to Coding': {
    from: COLUMNS.ready, target: COLUMNS.coding, cause: 'claimed', outcomes: ['fulfilled'],
    options: { script: () => 'refused' },
    setup: async () => {},
  },
  'a removal whose following claim moves the card to Coding': {
    from: COLUMNS.review, target: COLUMNS.coding, cause: 'redone', outcomes: ['fulfilled'],
    options: { script: () => 'refused' },
    setup: async (here) => {
      await here.move(12, COLUMNS.review);
      here.repository.open({ number: 77, head: 'rigger-12', sha: HEADS.judged, closed: true });
      // The closed pull request's branch was deleted, as GitHub's delete-on-close leaves it.
      here.repository.operations.readBranches = async (names) => Object.fromEntries(names.map((name) => [name, false]));
    },
  },
  'a continuing claim moving the card to Coding': {
    from: COLUMNS.review, target: COLUMNS.coding, cause: 'continued', outcomes: MOVES_ONLY,
    options: { judges: ['reviewer'], script: () => 'refused' },
    setup: (here) => judgedPull(here, COLUMNS.review),
  },
  'a continuing settle to Review': {
    from: COLUMNS.coding, target: COLUMNS.review, cause: 'returned', outcomes: MOVES_ONLY,
    options: { judges: ['reviewer'], exit: 0, script: (number, claim, { repository }) => {
      // The maker pushed before L2 settles it, so the old marker no longer names the head.
      if (claim === 1) repository.update(77, { sha: HEADS.pushed });
      return 'maker';
    } },
    setup: (here) => judgedPull(here, COLUMNS.review),
  },
  'a handled escalation the role returns to Review': {
    from: COLUMNS.coding, target: COLUMNS.review, cause: 'returned', outcomes: MOVES_ONLY,
    options: { escalate: { ambiguous: 'pm' }, exit: 0, script: () => 'maker', beforeSettle: ({ repository, card, dispatch }) => {
      // The maker opened its pull request and left a note escalating an item for the PM role.
      repository.open({ number: 77, head: 'rigger-12', sha: HEADS.pushed });
      repository.postIssueComment(card, postedNote(dispatch).body.replace('item: 2', 'item: 1'));
    } },
    setup: async () => {},
  },
  'a move to Done for a merged pull request': {
    from: COLUMNS.review, target: COLUMNS.done, cause: 'merged', outcomes: MOVES_ONLY, kept: false,
    options: {},
    setup: async (here) => {
      await here.move(12, COLUMNS.review);
      here.repository.open({ number: 77, head: 'rigger-12', sha: HEADS.judged, merged: true });
    },
  },
  'the end of a merge in the lane': {
    from: COLUMNS.owner, target: COLUMNS.done, cause: 'mergedFromOwner', outcomes: MOVES_ONLY, handed: 2,
    options: {},
    setup: (here) => ownerSound(here),
  },
  'a merge the lane found conflicting': {
    from: COLUMNS.owner, target: COLUMNS.coding, cause: 'conflictedFromOwner', outcomes: MOVES_ONLY, handed: 2,
    // Another merge landed between L2's read and the merge call, so the forge refuses it as conflicting.
    options: { merge: (repository) => () => {
      repository.update(77, { mergeable: 'conflicting' });
      return { outcome: 'refused', reason: 'conflict' };
    } },
    setup: (here) => ownerSound(here),
  },
  'an escalation of the judges L1 could not give a directory': {
    from: COLUMNS.review, target: COLUMNS.owner, cause: 'escalated', outcomes: ESCALATION, labelled: true,
    options: { judges: ['reviewer'], judgeRefused: true },
    setup: async (here) => {
      await here.move(12, COLUMNS.review);
      here.repository.open({ number: 77, head: 'rigger-12', sha: HEADS.judged, mergeBase: 'c'.repeat(40), diff: 'diff --git a/help b/help\n', mergeable: 'mergeable' });
    },
  },
  'an escalation at the pull': {
    from: COLUMNS.ready, target: COLUMNS.owner, cause: 'escalated', outcomes: ESCALATION, labelled: true,
    options: { branches: ['rigger-12'] },
    setup: async () => {},
  },
  'an escalation within an attempt': {
    from: COLUMNS.coding, target: COLUMNS.owner, cause: 'escalated', outcomes: ESCALATION, labelled: true,
    options: { script: () => 'local' },
    setup: async () => {},
  },
};

/** Puts card 12 in Owner with pull request 77 open from its line of work, the owner's sound marker at its head, so L2 answers it a merge. */
async function ownerSound(here) {
  const [card] = await here.fake.operations.readItems();
  await here.move(12, COLUMNS.owner);
  here.repository.open({ number: 77, head: 'rigger-12', sha: HEADS.judged, mergeBase: 'c'.repeat(40), mergeable: 'mergeable',
    comments: [markerComment({ card: 12, pull: 77, head: HEADS.judged, body: card.body, role: 'owner' })] });
}

// R-SCHED-43 row S5, at every L2 column change L3 observes: each column the board accepted is the
// compared column, whether L2's step then answered or rejected, and a step rejected before any move
// leaves it where it was. The test watches L3 hand the card to L2's facts call, which a skipped card
// never is, so neither L2's escalation label nor its no-action answer can mask the compared column.
// A label's removal ends no skip, and a person's move to any other column ends it.
// proves R-SCHED-43
test('S5 table: every column the board accepted is the compared column, however the step ended', async (t) => {
  for (const [step, { from, target, cause, outcomes, labelled: escalation = false, kept = true, handed = 1, options, setup }] of Object.entries(COLUMN_STEPS)) {
    for (const end of outcomes) {
      const { options: ending, column } = OUTCOMES[end]({ from, target, cause });
      const fulfilled = end === 'fulfilled';
      const labelled = escalation && fulfilled;
      const aside = kept || !fulfilled;
      await t.test(`${step}, ${end}`, async (t) => {
        const here = world(t, { ...options, ...ending });
        await setup(here);
        const run = here.start();
        // A merge claim frees no slot, so no release pull drains it: the first poll after it does.
        for (let turn = 0; run.handed.length < 1; turn += 1) {
          assert.ok(turn < 50, `${step}, ${end}: the first busy period ends`);
          await here.poll();
          await new Promise((resolve) => setImmediate(resolve));
        }
        assert.equal(await here.column(), column, `${step}, ${end}: the board holds the card in ${column}`);
        const recorded = here.events().some((event) => event.event === 'transition' && event.cause === cause);
        assert.equal(recorded, fulfilled || end === 'made, its event refused' || end.startsWith('label'), `${step}, ${end}: L2 recorded its ${cause} transition only where the board took the move and the sink took the record`);
        assert.equal(here.pulls(), 1, `${step}, ${end}: the run claims the card once`);
        // The claim's release reads the board at once; a card it set aside is skipped there.
        const settled = aside ? handed : handed + 1;
        assert.equal(here.offered(), settled, aside
          ? `${step}, ${end}: every read after the setting aside finds the card in ${column}, its compared column, and skips it`
          : `${step}, ${end}: nothing set the card aside, so the claim's release read hands it to L2`);
        const makers = here.makers();
        assert.ok(makers <= 1, `${step}, ${end}: one maker at most`);
        for (let each = 0; each < 3; each += 1) await here.poll();
        if (!aside) {
          assert.equal(here.offered(), settled + 3, `${step}, ${end}: nothing set the card aside, so every read hands it to L2`);
          return;
        }
        assert.equal(here.offered(), settled, `${step}, ${end}: reads finding the card in ${column} keep its skip`);
        assert.equal(here.makers(), makers, `${step}, ${end}: no maker starts again without a person's move`);
        if (labelled) {
          here.unlabel();
          await here.poll();
          assert.equal(here.offered(), settled, `${step}, ${end}: a person removing the escalation label moves nothing, so the skip holds`);
        }
        // A person's move to a column other than the compared one ends the skip at the next read.
        await here.move(12, column === target ? from : target);
        await here.poll();
        assert.equal(here.offered(), settled + 1, `${step}, ${end}: a person's move away from ${column} ends the skip`);
      });
    }
  }
});

/**
 * Each kind of claim whose attempt makes a workspace, so can stop for a line of work moved or
 * deleted: `setup` stages the card so L2 answers it that claim, and `cause` is the transition its
 * claim records, where it moves the card. A person's move back to `restart` ends its skip. Where
 * `reclaimed` is false, L2 answers the card no claim at the read after its first stop, so the card
 * is never stopped a second time and is handed to L2 at every read.
 */
const LINE_CLAIMS = {
  'a fresh claim from Ready': { setup: async () => {}, judges: KINDS.change.judges, cause: 'claimed', restart: COLUMNS.ready },
  'a fresh claim done again from Review': { setup: (here) => here.move(12, COLUMNS.review), judges: KINDS.change.judges, cause: 'redone', restart: COLUMNS.review },
  'a continuing claim from Review': { setup: (here) => judgedPull(here, COLUMNS.review), judges: ['reviewer'], cause: 'continued', restart: COLUMNS.review },
  // Left in Coding by its first stop, its owner's marker unread there, L2 answers it no claim.
  'a continuing claim from Owner': { setup: (here) => judgedPull(here, COLUMNS.owner, true), judges: ['reviewer', 'owner'], cause: 'continuedFromOwner', restart: COLUMNS.owner, reclaimed: false },
  'a continuing claim from Coding': { setup: (here) => judgedPull(here, COLUMNS.coding), judges: ['reviewer'], cause: undefined, restart: COLUMNS.review },
};

// R-FAIL-8's row for a line of work moved or deleted, rows S8a to S8c, for every kind of claim that
// makes a workspace: the first stop re-reads the forge, the second sets the card aside, and a
// person's move that ends the skip starts the count again.
// proves R-FAIL-8, R-SCHED-43
test('S8a S8b S8c table: every claim that makes a workspace is re-read once at a line stop, and counts again after its skip', async (t) => {
  for (const [claim, { setup, judges, cause, restart, reclaimed = true }] of Object.entries(LINE_CLAIMS)) {
    for (const code of ['moved', 'deleted']) {
      await t.test(`${claim}, ${code}`, async (t) => {
        const here = world(t, { judges, script: () => code });
        await setup(here);
        const run = here.start();
        await busy(run, 1);
        if (cause !== undefined) assert.ok(here.events().some((event) => event.event === 'transition' && event.cause === cause), `${claim}: L2 answered the claim it names`);
        const offered = here.offered();
        for (let each = 0; each < 3; each += 1) await here.poll();
        if (reclaimed) {
          assert.equal(here.pulls(), 2, `${claim}, ${code}: the first stop re-reads the forge, and the second sets the card aside`);
          assert.equal(here.offered(), offered, `${claim}, ${code}: the set-aside card is handed to L2 at no later read`);
        } else {
          assert.equal(here.pulls(), 1, `${claim}, ${code}: L2 answers the re-read card no claim`);
          assert.equal(here.offered(), offered + 3, `${claim}, ${code}: the first stop sets nothing aside, so every read hands the card to L2`);
        }
        await here.move(12, restart);
        await here.poll();
        await busy(run, 2);
        for (let each = 0; each < 3; each += 1) await here.poll();
        assert.equal(here.pulls(), reclaimed ? 4 : 2, reclaimed
          ? `${claim}, ${code}: after a person's move ends the skip, the count starts again`
          : `${claim}, ${code}: no skip ended, so the stop after the person's move is the second, and sets the card aside`);
      });
    }
  }
});

/**
 * The architect's round-4 interleaving (1192#6591402707), as a world: the record holds a card
 * firing of trigger `gone` pending from an earlier start, and its marked issue 12 stands in Ready.
 * Recovery waits at its newest-number read while the first pull claims issue 12, moves it to Coding,
 * and sets it aside on L1's BRANCH_REFUSED for the admitted topic `bad {number}`. A person then
 * removes the card from the board, and recovery adds it back and makes its `created` move to Ready.
 * `ending` gives the world options for how that move ends, as `OUTCOMES` names them.
 */
function recoveryWorld(t, { madeMove = () => false, refuseMove = () => false, refuseRecord = () => false, holdWorkspace = false, create, other = false, holdCard } = {}) {
  const clock = manualClock(START + 500);
  const directory = temporaryDirectory('rigger-set-aside-recovery-', { context: t });
  const template = { title: 'Clock work', labels: ['type:change'], acceptance: '- Do the work.' };
  // A card trigger fires at START + 600 where `create` is `firing`; one pending since START + 123 is recovered otherwise.
  const trigger = create === undefined ? { later: { interval: 3_600_000, anchor: new Date(START).toISOString(), catchUp: 'skip', job: 'report' } }
    : { pending: { interval: 3_600_000, anchor: new Date(START + (create === 'firing' ? 600 : 123)).toISOString(), catchUp: 'skip', card: template } };
  const settings = { ...config, kinds: KINDS, concurrency: other ? 2 : 1, worktrees: { ...config.worktrees, topic: 'bad {number}' }, clock: { poll: POLL, triggers: trigger } };
  assert.deepEqual(validate(settings), [], 'the config validator admits the topic rule and the trigger');
  const columns = settings.board.columns;
  const marked = { number: 12, title: 'Clock work', labels: ['type:change'], state: 'open', author: 'rigger-bot',
    body: `${composeClockMark('gone', START + 123)}\n\n## Acceptance\n\n- Do the work.\n` };
  const plain = { number: 13, title: 'Other work', labels: ['type:change'], state: 'open', author: 'rigger-bot', body: '## Acceptance\n\n- Do other work.\n' };
  const issues = [...(create === undefined ? [marked] : []), ...(other ? [plain] : [])];
  const fake = forge({ issues, items: issues.map(({ number }) => ({ id: `item-${number}`, number, column: columns.ready })) });
  // The card the test follows: the marked issue 12, or the one creation opens, the forge's next number.
  const number = create === undefined ? 12 : Math.max(0, ...issues.map((issue) => issue.number)) + 1;
  const repository = createFakeRepository({ repo: settings.repo, issues: issues.map(({ number: n, title, body, labels }) => ({ number: n, title, body, labels })) });
  const recovery = gate();
  const added = gate();
  const work = gate();
  // Gates the test queues: the next read of the board waits before its snapshot (`holdPre`), or
  // takes its snapshot and then waits (`holdSnap`), so a change can land at either point.
  const snaps = [];
  const pres = [];
  // Gates the test queues for the next calls of L2's facts call, which a pull awaits after its read answers.
  const factsHolds = [];
  let readsBegun = 0;
  let answered = 0;
  let waiting = false;
  let adding = false;
  const reads = { ...repository.operations, ...fake.reads, readNewestNumber: async () => {
    if (create !== undefined) return fake.reads.readNewestNumber();
    waiting = true;
    await recovery.promise;
    return 12;
  } };
  let offered = 0;
  // The board's items as the read side answers them, each with its issue's facts.
  const cards = async () => (await fake.board.readItems()).map((item) => ({ ...fake.issues.find((issue) => issue.number === item.number), ...item, type: 'issue', repository: settings.repo, priority: null }));
  const board = { ...fake.board, readColumns: async () => columns, readItems: cards,
    readPriority: async () => {
      // A run that claims a skipped card again at every release fails its next read here, rather than spinning.
      readsBegun += 1;
      if (readsBegun > READ_CAP) throw new Error(`the world answers at most ${READ_CAP} reads of the board`);
      const pre = pres.shift();
      if (pre !== undefined) { pre.waiting = true; await pre.promise; }
      const answer = { declared: null, options: null, items: await cards() };
      const snap = snaps.shift();
      if (snap !== undefined) { snap.snapped = true; await snap.promise; }
      answered += 1;
      return answer;
    } };
  const items = {
    ...fake.items,
    // L0's addIssue answers only the item's id once the forge added it, so the board can show the
    // item, and a person move it, before L2 makes its `created` move (item-write.mjs).
    addIssue: async (n) => {
      const id = await fake.items.addIssue(n);
      if (create === undefined) return id;
      adding = true;
      await added.promise;
      return id;
    },
    moveItem: async (id, column) => {
      if (madeMove(column)) {
        await fake.items.moveItem(id, column);
        throw made('the move', {}, '{}');
      }
      if (refuseMove(column)) throw new Error(`the board refuses the move of ${id} to ${column}`);
      return fake.items.moveItem(id, column);
    },
  };
  mkdirSync(dirname(streamPath(directory)), { recursive: true });
  writeFileSync(streamPath(directory), create === 'firing' ? '' : create === 'recovery'
    ? line(START, 'trigger.armed', { name: 'pending', interval: 3_600_000, anchor: new Date(START + 123).toISOString() })
      + line(START + 123, 'trigger', { trigger: 'clock', name: 'pending', occurrence: new Date(START + 123).toISOString(), after: 0 })
    : line(START + 123, 'trigger', { trigger: 'clock', name: 'gone', occurrence: new Date(START + 123).toISOString(), after: 0 }));
  const opened = openSink({ directory, run: 'r-recovery', now: clock.now });
  const sink = { emitter: (context) => {
    const emitter = opened.emitter(context);
    return { emit: (event, fields) => {
      if (refuseRecord(event, fields ?? {})) throw new Error(`the sink refuses ${event}`);
      return emitter.emit(event, fields);
    } };
  } };
  const l2 = columnChanges({ config: settings, sink, reads, items, board, repositoryWrites: fake.writes });
  const decide = (card, outcomes, options = {}) => nextAction(card, settings.kinds, undefined, { roles: settings.roles, provisioning: {}, outcomes, sink, ...options });
  const facts = factsCall({ config: settings, reads, decide });
  const events = () => readEvents(directory);
  let workspaces = 0;
  const built = loop({ config: settings, board, decide, l2, sink, state: directory, readRecord: events, clock, run: 'r-recovery', environment: {}, kill: async () => {},
    facts: async (cards) => {
      if (cards.some((card) => card.number === number)) offered += 1;
      const hold = factsHolds.shift();
      // A hold opened with 'reject' fails the facts call, as a forge read under it can fail.
      if (hold !== undefined) { hold.waiting = true; if (await hold.promise === 'reject') throw new Error('the facts call failed'); }
      return facts(cards);
    },
    // makeWorkspace rejects BRANCH_REFUSED where git refuses the admitted topic's derived name, as `bad 12` (workspace.mjs).
    // Where `holdWorkspace`, the first workspace asked for waits for the test, holding its claim; where
    // `holdCard`, that card's workspace waits instead.
    workspace: async (n) => {
      workspaces += 1;
      if (holdCard === undefined ? (holdWorkspace && workspaces === 1) : n === holdCard) await work.promise;
      throw Object.assign(new Error(`git refuses bad ${n} as a branch name`), { code: BRANCH_REFUSED });
    },
    judgeDirectory: async () => { throw new Error('no judge is dispatched'); }, removeDirectories: async () => {} });
  const stop = new AbortController();
  const handed = [];
  const running = built.run({ stop: stop.signal, handOver: (answer) => handed.push(answer) });
  running.catch(() => {});
  t.after(async () => { recovery.open(); added.open(); work.open(); stop.abort(); await running.catch(() => {}); });
  const pulls = (n = number) => events().filter((event) => event.event === 'pull' && event.card === n).length;
  const item = () => fake.onBoard.find((each) => each.number === number);
  return { holdPre: () => { const g = gate(); pres.push(g); return g; }, holdSnap: () => { const g = gate(); snaps.push(g); return g; },
    holdFacts: () => { const g = gate(); factsHolds.push(g); return g; }, answered: () => answered,
    clock, columns, fake, recovery, added, work, handed, events, pulls, item, number, offered: () => offered, waiting: () => waiting, adding: () => adding };
}

// R-SCHED-43 row S5 at a move no claim makes: recovery's `created` move of a pending firing's card
// that this run already set aside. The column the board accepted is the compared column, whether
// the move answered or rejected after the board took it, and the pull stays independent of the
// firing. A move the board refused leaves the compared column where the claim left it.
// proves R-SCHED-43
test('S5 recovery: a card this run set aside keeps the column recovery placed it in as its compared column', async (t) => {
  const created = (event, fields) => event === 'transition' && fields.cause === 'created';
  const ends = {
    fulfilled: { options: {}, placed: true },
    'made, its event refused': { options: { madeMove: (column) => column === COLUMNS.ready }, placed: true },
    'recorded nothing': { options: { refuseRecord: created }, placed: true },
    'refused before any move': { options: { refuseMove: (column) => column === COLUMNS.ready }, placed: false },
  };
  for (const [end, { options, placed }] of Object.entries(ends)) {
    await t.test(end, async (t) => {
      const here = recoveryWorld(t, options);
      // The first pull is independent of the firing still waiting on the forge.
      await positive(() => here.waiting() && here.handed.some((answer) => answer.settled));
      assert.equal(here.pulls(), 1, `${end}: the first pull claimed the card and set it aside`);
      assert.equal(here.item().column, here.columns.coding, `${end}: its claim's accepted Coding is its compared column`);
      const offered = here.offered();
      here.fake.onBoard.splice(0, 1);
      here.recovery.open();
      await positive(() => here.events().some((event) => event.event === 'trigger.outcome' && event.name === 'gone') || here.handed.some((answer) => answer.failure));
      assert.equal(here.item()?.column ?? null, placed ? here.columns.ready : null, `${end}: the board holds the card ${placed ? 'in Ready' : 'in no column'}`);
      // Where the board refused the move, a person puts the card back in Coding before any read,
      // so every read finds it in the column its claim left it in, its compared column still.
      if (!placed) here.item().column = here.columns.coding;
      const compared = placed ? 'Ready, the column recovery placed it in' : 'Coding, the column the refused move left its compared column at';
      for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.pulls(), 1, `${end}: reads after recovery claim the card no second time`);
      assert.equal(here.offered(), offered, `${end}: reads finding the card in ${compared} keep its skip`);
      // A person's move to Review ends the skip at the next read.
      here.item().column = here.columns.review;
      await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered + 1, `${end}: a person's move away from Ready ends the skip`);
    });
  }
});

/** The outcomes of a clock card's `created` move the board accepted, as `recoveryWorld` takes them. */
const CREATED_ACCEPTED = {
  fulfilled: {},
  'made, its event refused': { madeMove: (column) => column === COLUMNS.ready },
  'recorded nothing': { refuseRecord: (event, fields) => event === 'transition' && fields.cause === 'created' },
};

// R-SCHED-43 row S5 while a claim is still working the card: recovery's `created` move, accepted
// before the claim sets the card aside, is the compared column it is set aside with (the reviewer
// 1192#6592601382 and the architect 1192#6592472670, round 5). The claim keeps no column of its own.
// proves R-SCHED-43
test('S5 recovery during a claim: a move recovery made while the claim worked is the compared column it is set aside with', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = recoveryWorld(t, { ...options, holdWorkspace: true });
      await positive(() => here.waiting() && here.pulls() === 1 && here.item()?.column === here.columns.coding);
      // The claim holds the card in Coding while its workspace waits; a person removes it from the board.
      here.fake.onBoard.splice(here.fake.onBoard.indexOf(here.item()), 1);
      here.recovery.open();
      await positive(() => here.events().some((event) => event.event === 'trigger.outcome' && event.name === 'gone') || here.handed.some((answer) => answer.failure));
      assert.equal(here.item()?.column, here.columns.ready, `${end}: recovery placed the card in Ready while the claim worked`);
      here.work.open();
      await positive(() => here.events().some((event) => event.event === 'slot.release' && event.card === here.number));
      for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.pulls(), 1, `${end}: the claim set the card aside with Ready, so reads finding Ready claim it no second time`);
      assert.equal(here.offered(), 1, `${end}: reads finding the card in Ready keep its skip`);
      here.item().column = here.columns.review;
      await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), 2, `${end}: a person's move away from Ready ends the skip`);
    });
  }
});

// R-SCHED-43 row S5 for a card creation opens: the board shows the new item before L2's add has
// answered, a person puts it in Ready, a pull claims it and sets it aside, and creation's delayed
// `created` move to Ready then lands (the architect 1192#6592472670, round 5). That move is the
// compared column, whether creation runs in recovery of a pending firing or in a firing of its own.
// proves R-SCHED-43
test('S5 creation: a card set aside before the delayed created move of its creation keeps the column of that move', async (t) => {
  for (const create of ['recovery', 'firing']) {
    for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
      await t.test(`${create}, ${end}`, async (t) => {
        // A firing waits on its add inside the clock's wake, which holds every poll, so a second card
        // holds a slot, and its release fires the pull that claims the new card.
        const here = recoveryWorld(t, { ...options, create, other: create === 'firing', holdWorkspace: create === 'firing' });
        if (create === 'firing') {
          await positive(() => here.pulls(13) === 1);
          here.clock.advance(START + 600);
        }
        await positive(() => here.adding() && here.item() !== undefined);
        assert.equal(here.item().column, null, `${create}, ${end}: the add placed the new card in no column yet`);
        here.item().column = here.columns.ready;
        if (create === 'firing') here.work.open();
        else await here.clock.advance(here.clock.now() + POLL);
        await positive(() => here.events().some((event) => event.event === 'slot.release' && event.card === here.number));
        assert.equal(here.pulls(), 1, `${create}, ${end}: a pull claimed the new card and set it aside`);
        const offered = here.offered();
        here.added.open();
        await positive(() => here.events().some((event) => event.event === 'trigger.outcome' && event.name === 'pending') || here.handed.some((answer) => answer.failure));
        assert.equal(here.item().column, here.columns.ready, `${create}, ${end}: creation's created move placed the card in Ready`);
        for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
        assert.equal(here.pulls(), 1, `${create}, ${end}: reads finding the card in Ready claim it no second time`);
        assert.equal(here.offered(), offered, `${create}, ${end}: reads finding the card in Ready, creation's column, keep its skip`);
        here.item().column = here.columns.review;
        await here.clock.advance(here.clock.now() + POLL);
        assert.equal(here.offered(), offered + 1, `${create}, ${end}: a person's move away from Ready ends the skip`);
      });
    }
  }
});


/**
 * Runs a creation-in-recovery world until a pull has claimed the new card from Ready and set it
 * aside in Coding, the claim's accepted move, with creation's own `created` move still held.
 */
async function setAsideBeforeCreation(t, options) {
  const here = recoveryWorld(t, { ...options, create: 'recovery' });
  await positive(() => here.adding() && here.item() !== undefined);
  here.item().column = here.columns.ready;
  await here.clock.advance(here.clock.now() + POLL);
  await positive(() => here.events().some((event) => event.event === 'slot.release' && event.card === here.number));
  assert.equal(here.pulls(), 1, 'a pull claimed the new card and set it aside');
  assert.equal(here.item().column, here.columns.coding, 'set aside in Coding, the claim\'s accepted move');
  return here;
}

/** Lets creation's held `created` move land, and waits for its firing to settle. */
async function landCreation(here) {
  here.added.open();
  await positive(() => here.events().some((event) => event.event === 'trigger.outcome' && event.name === 'pending') || here.handed.some((answer) => answer.failure));
  assert.equal(here.item().column, here.columns.ready, 'creation\'s created move, this run\'s own, placed the card in Ready');
}

/**
 * Runs B1's interleaving (row S5a) to its setting aside: creation adds a new card in no column and
 * its `created` move waits; a person puts the unclaimed card in Coding; a pull's read snapshots
 * Coding and is held while the `created` move into Ready lands; the read answers, the pull claims
 * the card from Coding, and `BRANCH_REFUSED` sets it aside, its compared columns Coding and Ready.
 * The board then shows the card in Ready. Where `holdRelease`, the read the card's release begins
 * waits before its snapshot, as `release`.
 */
async function setAsideAtS5a(t, options, holdRelease = false) {
  const here = recoveryWorld(t, { ...options, create: 'recovery' });
  await positive(() => here.adding() && here.item() !== undefined);
  here.item().column = here.columns.coding;
  const snap = here.holdSnap();
  const polling = here.clock.advance(here.clock.now() + POLL);
  await positive(() => snap.snapped === true);
  const release = holdRelease ? here.holdPre() : undefined;
  await landCreation(here);
  snap.open();
  await polling;
  await positive(() => here.events().some((event) => event.event === 'slot.release' && event.card === here.number));
  assert.equal(here.pulls(), 1, 'the pull claimed the card from Coding and set it aside');
  assert.equal(here.item().column, here.columns.ready, 'the board shows the card in Ready, where creation placed it');
  return { ...here, release };
}

// R-SCHED-43 row S5a1, the judge's B1 probe (the reviewer 1192#6594679358), unchanged: the claim
// takes Coding, the column its read showed, and Ready, the `created` move accepted while that read
// was in flight, so reads finding Ready keep the skip.
// proves R-SCHED-43
test('S5a1: a card claimed from a stale read keeps the column creation placed it in while that read was in flight', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = recoveryWorld(t, { ...options, create: 'recovery' });
      await positive(() => here.adding() && here.item() !== undefined);
      assert.equal(here.item().column, null, 'creation added the item without a column');
      here.item().column = here.columns.coding;
      const snap = here.holdSnap();
      const polling = here.clock.advance(here.clock.now() + POLL);
      await positive(() => snap.snapped === true);
      assert.equal(here.pulls(), 0, 'the read has snapshotted Coding, but has taken no claim');
      await landCreation(here);
      assert.equal(here.pulls(), 0, 'creation placed the unclaimed card in Ready');
      snap.open();
      await polling;
      await positive(() => here.events().some((event) => event.event === 'slot.release' && event.card === here.number));
      for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.pulls(), 1, `${end}: this run's accepted Ready placement must keep its skip; no person moved the card after creation`);
      assert.equal(here.item().column, here.columns.ready, 'no second claim may move the skipped card to Coding');
    });
  }
});

// R-SCHED-43 row S5a2, the attacker's probe B (round 6), unchanged: this run's `created` move lands
// once the claiming read has begun, a person then moves the card to Coding, which the read shows,
// and the claim sets it aside. Reads finding Coding keep the skip.
// proves R-SCHED-43
test('S5a2: a person move the claiming read saw is not taken as a second move once the card is set aside', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = recoveryWorld(t, { ...options, create: 'recovery' });
      await positive(() => here.adding() && here.item() !== undefined);
      const pre = here.holdPre();
      const polling = here.clock.advance(here.clock.now() + POLL);
      await positive(() => pre.waiting === true);
      here.added.open();
      await positive(() => here.events().some((event) => event.event === 'trigger.outcome' && event.name === 'pending') || here.handed.some((answer) => answer.failure));
      assert.equal(here.item().column, here.columns.ready, 'creation placed the card in Ready');
      here.item().column = here.columns.coding;
      pre.open();
      await polling;
      await positive(() => here.events().some((event) => event.event === 'slot.release' && event.card === here.number));
      for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
      console.log('DIAG-B', end, 'pulls', here.pulls(), 'column', here.item().column);
      assert.equal(here.pulls(), 1, `${end}: the card stays in Coding, the column its claim read, so no read claims it again`);
    });
  }
});

// R-SCHED-43 row S5a3: after B1's interleaving, a person moves the card to Review before the next
// read, which finds it outside both its compared columns and ends the skip.
// proves R-SCHED-43
test('S5a3: a card set aside with two compared columns ends its skip at a read finding it in a third', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = await setAsideAtS5a(t, options);
      const offered = here.offered();
      here.item().column = here.columns.review;
      await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered + 1, `${end}: a read finding Review, neither Coding nor Ready, ends the skip and hands the card to L2`);
    });
  }
});

/** Holds the next read before its snapshot, lets creation's held `created` move land, then lets the read answer. */
async function landDuringRead(here, person) {
  const pre = here.holdPre();
  const polling = here.clock.advance(here.clock.now() + POLL);
  await positive(() => pre.waiting === true);
  await landCreation(here);
  if (person !== undefined) here.item().column = person;
  pre.open();
  await polling;
}

// R-SCHED-43 row S5b: a card set aside with one compared column, Coding; this run's change to Ready
// is accepted while a read begun after the setting aside is in flight, and the read shows Ready.
// The skip holds, and the change, not the read, makes Ready the compared column: a later person's
// move to Coding ends the skip.
// proves R-SCHED-43
test('S5b: a read showing the target of a run change accepted while it was in flight keeps the skip', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = await setAsideBeforeCreation(t, options);
      const offered = here.offered();
      await landDuringRead(here);
      assert.equal(here.offered(), offered, `${end}: the read finding Ready, the change's target, keeps the skip`);
      here.item().column = here.columns.coding;
      await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered + 1, `${end}: Ready is now the one compared column, so a read finding Coding ends the skip`);
    });
  }
});

// R-SCHED-43 row S5b′, the attacker's probe A (round 6), unchanged: the read begun after the
// setting aside shows Coding, the compared column as it began, while this run's `created` move into
// Ready lands. The skip holds, and the next reads, finding Ready, keep it.
// proves R-SCHED-43
test('S5b′: a read whose snapshot predates the run\'s own accepted move does not end the skip', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = recoveryWorld(t, { ...options, create: 'recovery' });
      await positive(() => here.adding() && here.item() !== undefined);
      here.item().column = here.columns.ready;
      await here.clock.advance(here.clock.now() + POLL);
      await positive(() => here.events().some((event) => event.event === 'slot.release' && event.card === here.number));
      assert.equal(here.pulls(), 1, 'a pull claimed the new card and set it aside');
      assert.equal(here.item().column, here.columns.coding, 'set aside in Coding, the claim\'s accepted move');
      const offered = here.offered();
      const snap = here.holdSnap();
      const polling = here.clock.advance(here.clock.now() + POLL);
      await positive(() => snap.snapped === true);
      // The read, begun after the setting aside, has read the card in Coding. Only this run writes from here on.
      here.added.open();
      await positive(() => here.events().some((event) => event.event === 'trigger.outcome' && event.name === 'pending') || here.handed.some((answer) => answer.failure));
      assert.equal(here.item().column, here.columns.ready, 'creation\'s created move, this run\'s own, placed the card in Ready');
      snap.open();
      await polling;
      for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
      console.log('DIAG', end, 'pulls', here.pulls(), 'offered', here.offered() - offered, 'column', here.item().column);
      assert.equal(here.offered(), offered, `${end}: no column the run did not set was ever read, so the card is never handed to L2 again`);
      assert.equal(here.pulls(), 1, `${end}: and never claimed again`);
    });
  }
});

// R-SCHED-43 row S5c: as S5b, a person having moved the card to Review, which the read shows. Review
// is neither the compared column as the read began nor the change's target, so the skip ends.
// proves R-SCHED-43
test('S5c: a read showing a column neither its compared column nor a run change\'s target ends the skip', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = await setAsideBeforeCreation(t, options);
      const offered = here.offered();
      await landDuringRead(here, here.columns.review);
      assert.equal(here.offered(), offered + 1, `${end}: the read finding Review ends the skip and hands the card to L2`);
    });
  }
});

// R-SCHED-43 row S5d, the collapse: after B1's interleaving, the first read with no change in
// flight finds Ready, keeps the skip, and makes Ready the one compared column, so a later read
// finding Coding ends it.
// proves R-SCHED-43
test('S5d: a read with no change in flight makes the column it shows the one compared column', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = await setAsideAtS5a(t, options);
      const offered = here.offered();
      await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered, `${end}: the first read, finding Ready, keeps the skip`);
      here.item().column = here.columns.coding;
      await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered + 1, `${end}: Coding is no longer a compared column, so the read finding it ends the skip`);
    });
  }
});

// R-SCHED-43 row S5e, the residual M7-U27 accepts: after B1's interleaving, a person moves the card
// from Ready to Coding before any read with no change in flight. The next read finds Coding, a
// compared column, keeps the skip and makes Coding the one compared column, so a later read finding
// Ready ends it.
// proves R-SCHED-43
test('S5e: a person move into a compared column before the collapse goes unseen', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      // The read the card's release begins, the first after the setting aside, waits while a person moves the card.
      const here = await setAsideAtS5a(t, options, true);
      await positive(() => here.release.waiting === true);
      const offered = here.offered();
      const answered = here.answered();
      here.item().column = here.columns.coding;
      here.release.open();
      await positive(() => here.answered() > answered);
      await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered, `${end}: the reads finding Coding, a compared column, keep the skip`);
      here.item().column = here.columns.ready;
      await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered + 1, `${end}: Coding became the one compared column, so the read finding Ready ends the skip`);
    });
  }
});

// R-SCHED-43 row S5f (the architect's ruling 1178#6605091082): a pull's read answers showing the
// unclaimed card in Coding, and this run's `created` move into Ready lands while the pull awaits
// L2's facts call. The pull claims the card from Coding, its compared columns Coding and Ready, so
// once it is set aside, reads finding Ready keep the skip.
// proves R-SCHED-43
test('S5f: a run change accepted while the pull awaits the facts call is a compared column of the card it claims', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = recoveryWorld(t, { ...options, create: 'recovery' });
      await positive(() => here.adding() && here.item() !== undefined);
      here.item().column = here.columns.coding;
      const facts = here.holdFacts();
      const polling = here.clock.advance(here.clock.now() + POLL);
      await positive(() => facts.waiting === true);
      assert.equal(here.pulls(), 0, `${end}: the read answered Coding, and the pull has taken no claim`);
      await landCreation(here);
      facts.open();
      await polling;
      await positive(() => here.events().some((event) => event.event === 'slot.release' && event.card === here.number));
      assert.equal(here.pulls(), 1, `${end}: the pull claimed the card from Coding and set it aside`);
      const offered = here.offered();
      for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered, `${end}: reads finding Ready, a compared column, keep the skip`);
      assert.equal(here.pulls(), 1, `${end}: and claim the card no second time`);
    });
  }
});

// R-SCHED-43 row S5g (the architect's ruling 1178#6605091082): a card set aside with one compared
// column, Coding. A pull's read answers showing Coding, and this run's `created` move into Ready
// lands before that pull compares again, after L2's facts call. The read keeps the skip and leaves
// Ready, the change's target, the one compared column, so later reads finding Ready keep it too.
// proves R-SCHED-43
test('S5g: a run change accepted after a read answers and before its pull compares counts for that read', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = await setAsideBeforeCreation(t, options);
      const offered = here.offered();
      const facts = here.holdFacts();
      const polling = here.clock.advance(here.clock.now() + POLL);
      await positive(() => facts.waiting === true);
      await landCreation(here);
      facts.open();
      await polling;
      assert.equal(here.offered(), offered, `${end}: the read that showed Coding keeps the skip`);
      for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered, `${end}: Ready, the change's target, is the compared column, so reads finding it keep the skip`);
      assert.equal(here.pulls(), 1, `${end}: and claim the card no second time`);
    });
  }
});

// R-SCHED-43 row S5g, where the pull's first comparison would end the skip (the attacker's P1 on
// round 7): a card set aside with one compared column, Coding, which the board already shows in
// Ready, as the forge shows the `created` move it made before answering it. The pull's read finds
// Ready, and this run's `created` move into Ready is accepted while the pull awaits L2's facts call,
// before it claims. The read is in flight until its pull has compared and claimed, so Ready counts
// for it, the skip holds, and the card is claimed once.
// proves R-SCHED-43
test('S5g′: a run change accepted after the pull first compares and before it claims keeps a skip that comparison would end', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = await setAsideBeforeCreation(t, options);
      const offered = here.offered();
      here.item().column = here.columns.ready;
      const facts = here.holdFacts();
      const polling = here.clock.advance(here.clock.now() + POLL);
      await positive(() => facts.waiting === true);
      await landCreation(here);
      facts.open();
      await polling;
      assert.equal(here.pulls(), 1, `${end}: Ready, the target of a run change accepted before the pull claimed, keeps the skip, so the card is claimed once`);
      for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.pulls(), 1, `${end}: and later reads finding Ready, its compared column, claim it no second time`);
      assert.equal(here.offered(), offered + 1, `${end}: only the first comparison, which the change then overtook, handed the card to L2's facts call`);
    });
  }
});

// R-SCHED-43 row S5h, the attacker's P3 probe on round 7, unchanged (the architect's ruling
// 1178#6606219866): at concurrency 2, two reads in flight at once, and the older one's collapse
// landing after the newer one's. Only the latest-begun collapsing read writes the compared columns.
// proves R-SCHED-43
test('S5h: an older read collapsing after a newer one does not end the skip at the column the newer read saw', async (t) => {
  const here = recoveryWorld(t, { other: true, holdCard: 13 });
  // A person puts card 12 in Coding before the first read snapshots it.
  here.item().column = here.columns.coding;
  const snap0 = here.holdSnap();
  await positive(() => snap0.snapped === true && here.waiting());
  // Recovery's created move into Ready is accepted while that read is in flight.
  here.fake.onBoard.splice(here.fake.onBoard.indexOf(here.item()), 1);
  here.recovery.open();
  await positive(() => here.events().some((event) => event.event === 'trigger.outcome' && event.name === 'gone') || here.handed.some((answer) => answer.failure));
  assert.equal(here.item().column, here.columns.ready, 'recovery placed card 12 in Ready');
  const snap1 = here.holdSnap();
  snap0.open();
  // Card 12 is claimed from Coding, its compared columns {Coding, Ready}, and set aside; its release read R1 snapshots Ready and holds.
  await positive(() => snap1.snapped === true);
  assert.equal(here.pulls(12), 1, 'card 12 claimed once');
  assert.equal(here.pulls(13), 1, 'card 13 claimed, its workspace held');
  console.log('P3 R1 snapshot taken; card 12 column', here.item().column);
  const offered = here.offered();
  // A person moves card 12 to Coding, the column its claim read showed.
  here.item().column = here.columns.coding;
  const before = here.answered();
  // Card 13's stop releases its slot, whose read R2 begins after R1 and answers first.
  here.work.open();
  await positive(() => here.answered() > before && here.events().some((event) => event.event === 'slot.release' && event.card === 13));
  await new Promise((resolve) => setImmediate(resolve));
  console.log('P3 R2 answered; offered delta', here.offered() - offered);
  snap1.open();
  await positive(() => here.answered() > before + 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(here.offered(), offered, 'R1 and R2 each found card 12 in a compared column, so the skip held');
  // Nobody moves card 12 again: it stays in Coding, where R2, the newer read, saw it.
  for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
  console.log('P3 final offered delta', here.offered() - offered, 'pulls', here.pulls(12), 'column', here.item().column);
  assert.equal(here.offered(), offered, 'no column change since R2 found Coding, the claim read\'s own column, so no later read finding Coding may end the skip');
});

// R-SCHED-43 row S5g where the pull fails before its last comparison (the round-7 attacker's P4):
// as S5g′, but L2's facts call fails after this run's `created` move into Ready lands. The read was
// in flight until `done`, so Ready, a change it overlapped, still keeps the skip.
// proves R-SCHED-43
test('S5g″: a run change accepted while a pull whose facts call fails is in flight keeps the skip', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = await setAsideBeforeCreation(t, options);
      here.item().column = here.columns.ready;
      const facts = here.holdFacts();
      const polling = here.clock.advance(here.clock.now() + POLL);
      await positive(() => facts.waiting === true);
      await landCreation(here);
      facts.open('reject');
      await polling;
      for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.pulls(), 1, `${end}: Ready is the target of a run change accepted while the read was in flight, so the skip holds`);
    });
  }
});

// R-SCHED-43 rows S3 and S4 against the compared column (the ruling's row 5): a read that overlapped
// no run-owned change ends the skip at any column but the compared one, the column a run change moved the
// card away from included.
// proves R-SCHED-43
test('S5 record: a read overlapping no run change ends the skip at the column the run moved the card away from', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = await setAsideBeforeCreation(t, options);
      await landCreation(here);
      const offered = here.offered();
      await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered, `${end}: a read finding Ready, the record, keeps the skip`);
      here.item().column = here.columns.coding;
      await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered + 1, `${end}: a read finding Coding, which the run's own move left, ends the skip`);
    });
  }
});

// R-SCHED-43 row S1 with a run change in flight (the ruling's row 6): a read begun before the
// setting aside never ends the skip, though a run change landed while it was in flight and it
// shows a column a person moved the card to, other than any the run set.
// proves R-SCHED-43
test('S1 with a change in flight: a read begun before the setting aside keeps the skip whatever it shows', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      // Card 12's claim holds its workspace, and card 13's stop fires a release read held at its snapshot.
      const here = recoveryWorld(t, { ...options, holdWorkspace: true, other: true });
      // The first read, which claims both cards, passes; the release read after card 13's stop is
      // held before its snapshot, and again after it.
      here.holdPre().open();
      here.holdSnap().open();
      const pre = here.holdPre();
      const snap = here.holdSnap();
      await positive(() => here.waiting() && here.pulls() === 1 && here.pulls(13) === 1 && pre.waiting === true);
      assert.equal(here.item()?.column, here.columns.coding, `${end}: card 12's claim holds it in Coding`);
      // A person moves card 12 to Review, which the held read snapshots.
      here.item().column = here.columns.review;
      pre.open();
      await positive(() => snap.snapped === true);
      // While that read is in flight, a person removes card 12, recovery puts it in Ready, and its claim sets it aside.
      here.fake.onBoard.splice(here.fake.onBoard.indexOf(here.item()), 1);
      here.recovery.open();
      await positive(() => here.events().some((event) => event.event === 'trigger.outcome' && event.name === 'gone') || here.handed.some((answer) => answer.failure));
      here.work.open();
      await positive(() => here.events().some((event) => event.event === 'slot.release' && event.card === 12));
      const offered = here.offered();
      snap.open();
      for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.pulls(), 1, `${end}: the read begun before the setting aside, showing Review, ends no skip`);
      assert.equal(here.offered(), offered, `${end}: nor do later reads finding Ready`);
    });
  }
});
