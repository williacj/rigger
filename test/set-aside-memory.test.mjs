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
 * lane's next merge call in place of the fake repository's merge.
 */
function world(t, { cards = [12], clockHeld = true, concurrency = 1, script = () => 'refused', branches = [], refuseMove = () => false, madeAnyway = false, refuseLabel = false, exit = 7, judges = KINDS.change.judges, refuseRecord = () => false, escalate = {}, beforeSettle = () => {}, judgeRefused = false, madeMove = () => false, madeLabel = false, merge } = {}) {
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
  const offering = (items) => {
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
function recoveryWorld(t, { madeMove = () => false, refuseMove = () => false, refuseRecord = () => false, holdWorkspace = false, create, other = false, owner = false } = {}) {
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
  const fake = forge({ issues, items: issues.map(({ number }) => ({ id: `item-${number}`, number, column: owner ? columns.owner : columns.ready })) });
  // The card the test follows: the marked issue 12, or the one creation opens, the forge's next number.
  const number = create === undefined ? 12 : Math.max(0, ...issues.map((issue) => issue.number)) + 1;
  const repository = createFakeRepository({ repo: settings.repo, issues: issues.map(({ number: n, title, body, labels }) => ({ number: n, title, body, labels })) });
  const recovery = gate();
  const added = gate();
  const work = gate();
  const read = gate();
  let reading = false;
  if (owner) {
    // The owner's sound marker on pull request 77 at its head, so L2 answers the Owner card a merge.
    repository.open({ number: 77, head: 'bad 12', sha: HEADS.judged, mergeBase: 'c'.repeat(40), mergeable: 'mergeable',
      comments: [markerComment({ card: 12, pull: 77, head: HEADS.judged, body: marked.body, role: 'owner' })] });
  }
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
      const answer = { declared: null, options: null, items: await cards() };
      // Where `owner`, the first read answers what it read only once the test lets it, so a change
      // the run accepts meanwhile lands after that read began.
      if (owner && !reading) {
        reading = true;
        await read.promise;
      }
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
    facts: (cards) => { if (cards.some((card) => card.number === number)) offered += 1; return facts(cards); },
    // makeWorkspace rejects BRANCH_REFUSED where git refuses the admitted topic's derived name, as `bad 12` (workspace.mjs).
    // Where `holdWorkspace`, the first workspace asked for waits for the test, holding its claim.
    workspace: async (n) => {
      workspaces += 1;
      if (holdWorkspace && workspaces === 1) await work.promise;
      throw Object.assign(new Error(`git refuses bad ${n} as a branch name`), { code: BRANCH_REFUSED });
    },
    judgeDirectory: async () => { throw new Error('no judge is dispatched'); }, removeDirectories: async () => {} });
  const stop = new AbortController();
  const handed = [];
  const running = built.run({ stop: stop.signal, handOver: (answer) => handed.push(answer) });
  running.catch(() => {});
  t.after(async () => { recovery.open(); added.open(); work.open(); read.open(); stop.abort(); await running.catch(() => {}); });
  const pulls = (n = number) => events().filter((event) => event.event === 'pull' && event.card === n).length;
  const item = () => fake.onBoard.find((each) => each.number === number);
  return { clock, columns, fake, recovery, added, work, read, handed, events, pulls, item, number, offered: () => offered, waiting: () => waiting, adding: () => adding, reading: () => reading };
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

// R-SCHED-43 row S5 at a claim that makes no move: the claiming read found the card in Owner, and
// recovery's `created` move to Ready landed while that read was still answering. The claim takes
// the read's Owner as its column only where the run accepted no change since the read began, so
// the merge claim sets the card aside with Ready.
// proves R-SCHED-43
test('S5 claiming read: a change the run accepted while the claiming read answered outlives that read', async (t) => {
  for (const [end, options] of Object.entries(CREATED_ACCEPTED)) {
    await t.test(end, async (t) => {
      const here = recoveryWorld(t, { ...options, owner: true });
      await positive(() => here.waiting() && here.reading());
      // The read holds the card in Owner; a person removes it, and recovery puts it back in Ready.
      here.fake.onBoard.splice(here.fake.onBoard.indexOf(here.item()), 1);
      here.recovery.open();
      await positive(() => here.events().some((event) => event.event === 'trigger.outcome' && event.name === 'gone') || here.handed.some((answer) => answer.failure));
      assert.equal(here.item()?.column, here.columns.ready, `${end}: recovery placed the card in Ready`);
      here.read.open();
      await positive(() => here.events().some((event) => event.event === 'merge.end' && event.card === 12));
      assert.equal(here.pulls(), 1, `${end}: the read claimed the Owner card for its merge`);
      const offered = here.offered();
      for (let each = 0; each < 3; each += 1) await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.pulls(), 1, `${end}: reads finding the card in Ready claim it no second time`);
      assert.equal(here.offered(), offered, `${end}: reads finding the card in Ready, the column recovery placed it in, keep its skip`);
      here.item().column = here.columns.review;
      await here.clock.advance(here.clock.now() + POLL);
      assert.equal(here.offered(), offered + 1, `${end}: a person's move away from Ready ends the skip`);
    });
  }
});
