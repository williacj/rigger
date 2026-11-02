// ABOUTME: Proves a run's memory of the cards it set aside: when a clock-held run's read of the board
// ends a card's skip (R-SCHED-43, R-LOOP-19), and when a line-moved stop is remembered (R-FAIL-8).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { BRANCH_REFUSED, LINE_DELETED, LINE_MOVED, WORKSPACE_REFUSED } from '../src/execution/workspace.mjs';
import { existsSync } from 'node:fs';
import { createFakeRepository } from './fake-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { manualClock, START } from './clock-report-world.mjs';
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

/** L1's outcome for a maker that ran and exited 7, as L2's `settled` documents a fulfilled dispatch. */
const RAN = { status: 'fulfilled', value: { exit: 7, stdout: '', stderr: '' } };

/** Every gate not yet opened, which a world's teardown opens, as a refused workspace, before it stops its runs. */
const unopened = new Set();

/** A promise the test settles by hand, for holding a workspace or a board read. */
function gate() {
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });
  const each = { promise, open: (value) => { unopened.delete(each); settle(value); } };
  unopened.add(each);
  return each;
}

/**
 * A loop over a fake board and forge with real L2, starting no process. `script(card, claim)`
 * answers what the card's workspace does at its `claim`th claim, counted from 1: a key of
 * `FAILURES`, whose code L1's make rejects with; `maker`, a workspace whose path does not exist, so
 * the maker L2 names never starts; or a promise of either. A maker the world dispatches is handed to
 * L2, at its settle and its next action alike, as `RAN`. `refuseMove(column)` has the board refuse a move to that column, and `madeAnyway`
 * has it make the move it refused. `refuseLabel` has the forge refuse the escalation label.
 */
function world(t, { cards = [12], clockHeld = true, concurrency = 1, script = () => 'refused', branches = [], refuseMove = () => false, madeAnyway = false, refuseLabel = false } = {}) {
  const clock = manualClock();
  const directory = temporaryDirectory('rigger-set-aside-', { context: t });
  const settings = { ...config, kinds: KINDS, concurrency, escalate: {} };
  delete settings.clock;
  if (clockHeld) settings.clock = { poll: POLL, triggers: { later: { interval: 3_600_000, anchor: new Date(START).toISOString(), catchUp: 'skip', job: 'report' } } };
  const fake = boardOf(cards);
  const repository = createFakeRepository({ repo: settings.repo, issues: fake.issues(), branches });
  const sink = openSink({ directory, run: 'r-aside', now: clock.now });
  const items = {
    ...fake.operations,
    moveItem: async (id, column) => {
      if (!refuseMove(column)) return fake.operations.moveItem(id, column);
      if (madeAnyway) await fake.operations.moveItem(id, column);
      throw new Error(`the board refuses the move of ${id} to ${column}`);
    },
  };
  const l2 = columnChanges({ config: settings, sink, items, reads: repository.operations, repositoryWrites: {
    postComment: repository.postComment, mergePullRequest: repository.mergePullRequest,
    postIssueComment: (...args) => repository.postIssueComment(...args),
    addIssueLabel: async (number, label) => {
      if (refuseLabel) throw new Error(`the forge refuses label ${label}`);
      const labels = await repository.addIssueLabel(number, label);
      fake.setIssueLabels(settings.repo, number, labels.map(({ name }) => name));
      return labels;
    },
  } });
  const settle = l2.settled;
  l2.settled = (card, outcome, options) => settle(card, RAN, options);
  const decide = (card, outcomes, options = {}) => nextAction(card, KINDS, undefined, { roles: settings.roles, provisioning: {}, outcomes, sink, ...options, ...(options.maker === undefined ? {} : { maker: RAN }) });
  const claimsOf = new Map();
  const workspace = async (number) => {
    const claim = (claimsOf.get(number) ?? 0) + 1;
    claimsOf.set(number, claim);
    const given = await script(number, claim);
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
    readPriority: async () => {
      begun += 1;
      if (begun > READ_CAP) throw new Error(`the world answers at most ${READ_CAP} reads of the board`);
      const hold = held.shift();
      if (hold !== undefined) await hold;
      try { return await base.readPriority(); } finally { ended += 1; }
    },
  };
  const built = loop({ config: settings, board, decide, facts: factsCall({ config: settings, reads: repository.operations, decide }), l2, sink,
    kill: async () => {}, workspace, judgeDirectory: async () => { throw new Error('no agent judge is configured'); },
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
  return { start, poll, pulls, makers, column, move, events, repository, fake, clock, holdNextRead: (promise) => held.push(promise), reads: () => ({ begun, ended }) };
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
