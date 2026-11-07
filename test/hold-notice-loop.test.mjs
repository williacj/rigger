// ABOUTME: Tests L3 driving L2's notice function for a hold's closer: each rename made through
// admission.mjs and handed back before L2 writes again, one call at a time, and the calls at a trigger.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { holdBody } from '../src/workflow/status-issue.mjs';
import { moduleOver, removeClosers, seed } from './admission-world.mjs';
import { forge } from './notice-forge.mjs';
import { KINDS, boardOf, handleOn } from './loop-world.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { refusedCall, unrecordedKill } from './write-made-fixtures.mjs';

/** The run id the loops here are built under. */
const RUN = 'r-hold-notice';

/** The failures L2 names for a card's two attempts whose workspace was not made, each written by hand. */
const FIRST = { class: 'environment', workspace: '/nowhere/rigger-1', reason: 'no workspace here' };

/** L2 asked within an attempt: `again` after the first workspace not made, `hold` after the second. */
const holdingOnWorkspace = (card, outcomes, options = {}) => {
  if (options.workspace === undefined) return { action: 'none' };
  return options.attempt === 1
    ? { action: 'again', attempt: 2, failure: FIRST }
    : { action: 'hold', card: card.number, firstFailure: options.firstFailure, failure: FIRST };
};

/** The names in state directory `state`'s admission directory. */
const namesIn = (state) => readdirSync(join(state, 'admission')).filter((name) => !name.startsWith('.')).sort();

/**
 * Everything `loop` takes, over a fake board holding `cards` ready, every card held on its second
 * workspace not made, with `notice` as L2's notice function. `overrides` replaces any of them.
 */
function handles({ cards = [1], notice, ...overrides } = {}) {
  const state = temporaryDirectory('rigger-hold-notice-');
  return {
    config,
    board: handleOn(boardOf(cards)),
    decide: holdingOnWorkspace,
    facts: async () => () => ({ action: 'dispatch', kind: 'change' }),
    l2: { claimed: async () => {}, settled: async () => ({}), escalated: async () => {}, notice },
    sink: openSink({ directory: state, run: RUN, now: () => 1 }),
    kill: async () => {},
    workspace: async () => { throw new Error('no workspace here'); },
    judgeDirectory: async () => { throw new Error('no judge directory here'); },
    removeDirectories: async () => {},
    state,
    environment: {},
    run: RUN,
    ...overrides,
  };
}

// proves R-SCHED-20
test('L3 makes each rename L2\'s notice answers through admission and hands L2 its outcome before L2 writes again', async () => {
  const seen = [];
  let handed;
  async function* notice({ closer }) {
    seen.push({ at: 'start', closer: closer.name, names: namesIn(handed.state) });
    const after = yield { rename: 'after', number: 5 };
    seen.push({ at: 'after', outcome: after, names: namesIn(handed.state) });
    const issue = yield { rename: 'issue', number: 6 };
    seen.push({ at: 'issue', outcome: issue, names: namesIn(handed.state) });
    return { issue: 6 };
  }
  handed = handles({ notice });

  await assert.rejects(loop(handed).pull(), (failure) => failure.errors.some(({ message }) => /card #1 was held/.test(message)));

  const [{ closer }] = seen;
  const id = /^hold-([0-9a-f]+)\.json$/.exec(closer)[1];
  assert.deepEqual(seen, [
    { at: 'start', closer, names: [closer] },
    { at: 'after', outcome: { status: 'fulfilled', value: { name: `hold-${id}-after-5.json` } }, names: [`hold-${id}-after-5.json`] },
    { at: 'issue', outcome: { status: 'fulfilled', value: { name: `hold-${id}-issue-6.json` } }, names: [`hold-${id}-issue-6.json`] },
  ]);
  assert.deepEqual(readEvents(handed.state).filter(({ event }) => event === 'admission.rename').map(({ layer, from, to }) => [layer, from, to]), [
    ['L3', closer, `hold-${id}-after-5.json`],
    ['L3', `hold-${id}-after-5.json`, `hold-${id}-issue-6.json`],
  ]);
});

/** A notice function recording each closer it is called for, by name, and the others it was handed, answering `answer`. */
function recordingNotice(answer = { issue: 1 }) {
  const calls = [];
  async function* notice({ closer, others, hold }) {
    calls.push({ name: closer.name, others, hold });
    return answer;
  }
  return Object.assign(notice, { calls });
}

// The counterexample drops closed admission when its pull also has an unrecorded trigger.
// proves R-SCHED-3, R-SCHED-7
test('a no-clock failed closed pull keeps both closers and their failed notices beside the original trigger refusal', async () => {
  const notice = recordingNotice({ failed: { step: 'open the status issue', cause: 'forge refused the notice' } });
  const handed = handles({ notice, clock: { now: () => 1, pause: async () => {} } });
  seed(handed.state, 'hold-a1.json');
  seed(handed.state, 'hold-b2.json');
  const refusal = new Error('the pull trigger could not be recorded');
  const emitter = handed.sink.emitter.bind(handed.sink);
  const pulls = [];
  handed.sink.emitter = (context) => {
    const actual = emitter(context);
    return { emit: (event, fields) => {
      if (context.layer === 'L3' && event === 'trigger' && fields.trigger === 'pull') throw refusal;
      if (context.layer === 'L3' && event === 'pull') pulls.push(context.card);
      return actual.emit(event, fields);
    } };
  };
  await assert.rejects(loop(handed).run(), (failure) => {
    assert.equal(failure.admission?.state, 'closed', 'failed no-clock pull retains the actual closed read');
    assert.deepEqual(failure.admission.closers.map(({ id }) => id).sort(), ['a1', 'b2']);
    const leaves = (error) => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
    const held = leaves(failure);
    assert.ok(held.some(({ cause }) => cause === refusal), 'the original refused event is retained');
    assert.deepEqual(held.filter(({ notice }) => notice !== undefined).map(({ notice }) => notice.id).sort(), ['a1', 'b2']);
    assert.deepEqual(failure.reached, []);
    return true;
  });
  assert.deepEqual(pulls, [], 'closed admission takes no new claim despite the refused trigger record');
  assert.deepEqual(notice.calls.map(({ name }) => name).sort(), ['hold-a1.json', 'hold-b2.json']);
});

// proves R-SCHED-20
test('at a trigger, L3 calls L2\'s notice for each hold closer naming no issue, after or not, handing it the numbers other hold closers name, and for no other closer', async () => {
  const notice = recordingNotice();
  const handed = handles({ notice });
  for (const name of ['hold-a1.json', 'hold-b2-after-9.json', 'hold-c3-issue-12.json', 'owner-o4.json']) seed(handed.state, name);

  const pulled = await loop(handed).pull();

  assert.equal(pulled.admission.state, 'closed');
  assert.deepEqual(notice.calls.sort((one, other) => one.name.localeCompare(other.name)), [
    { name: 'hold-a1.json', others: [12], hold: undefined },
    { name: 'hold-b2-after-9.json', others: [12], hold: undefined },
  ]);
});

// proves R-SCHED-20
test('at a trigger with only the owner\'s pause closer, L3 makes no notice call', async () => {
  const notice = recordingNotice();
  const handed = handles({ notice });
  seed(handed.state, 'owner-o4.json');

  const pulled = await loop(handed).pull();

  assert.equal(pulled.admission.state, 'closed');
  assert.deepEqual(notice.calls, []);
});

/** The issues the cards here are, as the forge holds them, so the newest number counts them. */
const CARDS = () => [1, 2].map((number) => ({ number, title: `Card ${number}`, body: '', labels: ['type:change'] }));

/** L2's column changes over the in-memory forge `world`, whose notice function L3 is handed. */
const changesOver = (world, sink) => columnChanges({ config, sink, items: world.items, reads: world.reads, repositoryWrites: world.writes, board: world.board });

// proves R-SCHED-7, R-SCHED-20, R-SCHED-23
test('a hold with no status issue open has L2 open one through its column changes, and L3 renames the closer to name it; admission stays closed', async () => {
  const world = forge({ issues: [{ number: 3, title: 'Card', body: '', labels: ['type:change'] }] });
  const handed = handles();
  handed.l2.notice = changesOver(world, handed.sink).notice;

  await assert.rejects(loop(handed).pull());

  const [name] = namesIn(handed.state);
  assert.match(name, /^hold-[0-9a-f]+-issue-4\.json$/);
  assert.deepEqual(world.issues.map(({ number, title, labels }) => ({ number, title, labels })), [
    { number: 3, title: 'Card', labels: ['type:change'] },
    { number: 4, title: 'Rigger closed admission', labels: ['rigger:status'] },
  ]);
  // The opened body names the admission directory, which L3 holds under its state directory.
  assert.ok(world.issues[1].body.includes(`- Admission record: ${join(handed.state, 'admission')}\n`), world.issues[1].body);
  assert.deepEqual(world.onBoard, [{ id: 'item-4', number: 4, column: 'Owner' }]);
  assert.equal(moduleOver(handed.state).read().state, 'closed');
});

/** A workspace that L1 answers at a path that does not exist, so no step L3 dispatches there starts. */
const absentWorkspace = async (number) => ({ path: `/nowhere/rigger-${number}`, scratch: '/nowhere/scratch', repository: '/nowhere/repository' });

// proves R-SCHED-20
test('L3 tags each step\'s outcome with its dispatch id, so the hold-time body L2 composes names both attempts\' dispatch ids', async () => {
  const notice = recordingNotice();
  const handed = handles({ notice, workspace: absentWorkspace });
  const kinds = { change: { ...KINDS.change, provisioning: ['ready'] } };
  const provisioning = { ready: { run: 'true', required: true } };
  handed.decide = (card, outcomes, options = {}) => nextAction(card, kinds, undefined, { provisioning, outcomes, sink: handed.sink, ...options });
  handed.facts = async () => (card) => handed.decide(card, []);

  await assert.rejects(loop(handed).pull(), (failure) => failure.errors.some(({ message }) => /card #1 was held/.test(message)));

  const ids = readEvents(handed.state).filter(({ event, step }) => event === 'dispatch' && step === 'ready').map(({ dispatch }) => dispatch);
  assert.equal(ids.length, 2, JSON.stringify(readEvents(handed.state).map(({ event, layer, ...rest }) => [layer, event, rest.decision ?? rest.step ?? rest.reason ?? ''])));
  const [{ hold }] = notice.calls;
  assert.deepEqual([hold.firstFailure.dispatch, hold.failure.dispatch], ids);
  const body = holdBody({ id: 'a1', reason: 'r', run: RUN, hold, admission: '/s' });
  for (const id of ids) assert.ok(body.includes(id), body);
});

// proves R-SCHED-20, R-SCHED-25
test('two holds in one invocation: the second notice call starts after the first ends, even where the first failed partway, so one issue is opened and commented on for the second card', async () => {
  const world = forge({ issues: CARDS(), refuse: { moveItem: 'the board refused the move' } });
  const handed = handles({ cards: [1, 2] });
  const notice = changesOver(world, handed.sink).notice;
  const spans = [];
  handed.l2.notice = async function* spanned(input) {
    const span = { card: input.hold?.card, start: spans.length };
    spans.push(span);
    const ended = yield* notice(input);
    span.end = spans.length;
    spans.push(null);
    return ended;
  };

  await assert.rejects(loop(handed).pull());

  assert.deepEqual(world.issues.map(({ number, title }) => ({ number, title })).slice(2), [{ number: 3, title: 'Rigger closed admission' }]);
  const { comments } = world.issues[2];
  const second = spans.find((span) => span?.start === 2)?.card;
  assert.equal(comments.length, 1);
  assert.ok(comments[0].includes(`#${second}`), comments[0]);
  assert.deepEqual(spans.filter((span) => span !== null).map(({ start, end }) => [start, end]), [[0, 1], [2, 3]]);
  assert.deepEqual(namesIn(handed.state).map((name) => name.replace(/^hold-[0-9a-f]+-/, '')), ['issue-3.json', 'issue-3.json']);
});

// proves R-SCHED-20
test('a second call for the same hold in one run, made at a trigger while the hold\'s own call runs, acts on the name listed at its start, and no second issue is opened', async () => {
  const world = forge({ issues: CARDS() });
  const handed = handles({ cards: [1, 2] });
  const notice = changesOver(world, handed.sink).notice;
  let started;
  const noticeStarted = new Promise((resolve) => { started = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  handed.l2.notice = async function* gated(input) {
    calls.push(input.closer.name);
    started();
    const inner = notice(input);
    let step = await inner.next();
    for (let first = true; !step.done; first = false) {
      const outcome = yield step.value;
      if (first) await gate;
      step = await inner.next(outcome);
    }
    return step.value;
  };
  // Card #2 is moved, and its slot freed, only once card #1's notice call has begun; the trigger
  // that frees fires a pull, whose facts call lets card #1's call go on once every task queued
  // behind that pull's admission read has run.
  let pulls = 0;
  handed.facts = async () => {
    pulls += 1;
    if (pulls === 2) setImmediate(release);
    return (card) => (card.number === 2 ? { action: 'move', to: 'review' } : { action: 'dispatch', kind: 'change' });
  };
  handed.l2.moved = async () => { await noticeStarted; };

  await assert.rejects(loop(handed).run());

  assert.ok(pulls >= 2, `${pulls} pulls`);
  assert.equal(calls.length, 1, JSON.stringify(calls));
  assert.equal(world.calls.filter(([name]) => name === 'openIssue').length, 1);
  assert.match(namesIn(handed.state).join(), /^hold-[0-9a-f]+-issue-3\.json$/);
});

// proves R-SCHED-20
test('where a rename finds its closer gone, L3 ends that call and L2 writes nothing more for it', async () => {
  const world = forge({ issues: CARDS() });
  const handed = handles();
  const notice = changesOver(world, handed.sink).notice;
  let ended = false;
  handed.l2.notice = async function* removing(input) {
    const inner = notice(input);
    try {
      const step = await inner.next();
      // The closer is removed, as a `resume` removes it, before L3 makes the rename L2 answered.
      removeClosers(handed.state);
      const outcome = yield step.value;
      yield* inner;
      return outcome;
    } finally {
      ended = true;
    }
  };

  await assert.rejects(loop(handed).pull());

  assert.equal(ended, true);
  assert.deepEqual(world.calls.map(([name]) => name), ['readLabelledIssues', 'readNewestNumber']);
  assert.deepEqual(namesIn(handed.state), []);
  assert.deepEqual(readEvents(handed.state).filter(({ event }) => ['admission.rename', 'notice.failed'].includes(event)), []);
});

// proves R-SCHED-20
test('a hold whose closer was not saved makes no notice call', async () => {
  const notice = recordingNotice();
  const handed = handles({ notice });
  mkdirSync(join(handed.state, 'admission'), { recursive: true });
  chmodSync(join(handed.state, 'admission'), 0o555);

  try {
    await assert.rejects(loop(handed).pull());
  } finally {
    chmodSync(join(handed.state, 'admission'), 0o755);
  }

  assert.deepEqual(notice.calls, []);
  assert.deepEqual(namesIn(handed.state), []);
});

/** The issue a notice Rigger opened for hold `id` is, as the forge holds it: labelled, its body naming the id. */
const noticeIssue = (number, id, extra = {}) => ({ number, title: 'Rigger closed admission', body: holdBody({ id, reason: 'r', run: 'r-0' }), author: 'rigger-bot', labels: ['rigger:status'], comments: [], ...extra });

// proves R-SCHED-20
test('after a crash between the opening and the rename to its number, or an opening that timed out but completed, the next trigger\'s scan attaches that issue and opens no second', async () => {
  const world = forge({ issues: [...CARDS(), noticeIssue(3, 'a1')], pulls: [4] });
  const handed = handles({ cards: [] });
  handed.l2.notice = changesOver(world, handed.sink).notice;
  seed(handed.state, 'hold-a1-after-2.json');

  const pulled = await loop(handed).pull();

  assert.deepEqual(pulled.notices, []);
  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-3.json']);
  assert.equal(world.calls.filter(([name]) => ['openIssue', 'postIssueComment'].includes(name)).length, 0);
  assert.deepEqual(world.onBoard, [{ id: 'item-3', number: 3, column: 'Owner' }]);
});

// proves R-SCHED-20
test('a pull request, or a deleted issue, numbered between k and the notice is passed over, and the notice is still attached', async () => {
  const world = forge({ issues: [...CARDS(), noticeIssue(5, 'a1')], pulls: [3] });
  const handed = handles({ cards: [] });
  handed.l2.notice = changesOver(world, handed.sink).notice;
  seed(handed.state, 'hold-a1-after-2.json');

  await loop(handed).pull();

  assert.deepEqual(world.calls.filter(([name]) => name === 'readIssue').map(([, number]) => number), [3, 4, 5]);
  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-5.json']);
});

// proves R-SCHED-20, R-SCHED-23, R-SCHED-25
test('Rigger\'s notice open for an earlier hold, then a second card\'s hold: L2 reads that issue by the number its closer names, and comments naming the second card', async () => {
  const world = forge({ issues: [...CARDS(), noticeIssue(3, 'z9')] });
  // The earlier hold's closer names issue #3, linked while this card's attempts run.
  const handed = handles({ workspace: async () => { seed(handed.state, 'hold-z9-issue-3.json'); throw new Error('no workspace here'); } });
  handed.l2.notice = changesOver(world, handed.sink).notice;

  await assert.rejects(loop(handed).pull());

  assert.deepEqual(world.calls.filter(([name]) => name.startsWith('read') && name !== 'readItems'), [['readIssue', 3]]);
  assert.equal(world.calls.filter(([name]) => name === 'openIssue').length, 0);
  assert.equal(world.issues[2].comments.length, 1);
  assert.ok(world.issues[2].comments[0].includes('#1'), world.issues[2].comments[0]);
  assert.equal(namesIn(handed.state).filter((name) => /-issue-3\.json$/.test(name)).length, 2);
});

// proves R-SCHED-23
test('the owner\'s pause, then a card\'s hold: an issue is opened naming that card', async () => {
  const world = forge({ issues: CARDS() });
  const handed = handles({ workspace: async () => { seed(handed.state, 'owner-o1.json'); throw new Error('no workspace here'); } });
  handed.l2.notice = changesOver(world, handed.sink).notice;

  await assert.rejects(loop(handed).pull());

  const opened = world.issues.find(({ title }) => title === 'Rigger closed admission');
  assert.ok(opened?.body.includes('#1'), opened?.body);
  assert.match(namesIn(handed.state).join(), /^hold-[0-9a-f]+-issue-3\.json,owner-o1\.json$/);
});

// proves R-SCHED-23, R-SCHED-25
test('Rigger\'s notice left open after its state directory was lost: a later hold comments on that stale issue, naming the new card, and opens none', async () => {
  const world = forge({ issues: [...CARDS(), noticeIssue(3, 'z9')] });
  const handed = handles();
  handed.l2.notice = changesOver(world, handed.sink).notice;

  await assert.rejects(loop(handed).pull());

  assert.equal(world.calls.filter(([name]) => name === 'openIssue').length, 0);
  assert.equal(world.issues[2].comments.length, 1);
  assert.ok(world.issues[2].comments[0].includes('#1'), world.issues[2].comments[0]);
  assert.match(namesIn(handed.state).join(), /^hold-[0-9a-f]+-issue-3\.json$/);
});

/** Every value `value` holds, however deep, that is a function. */
const functionsIn = (value, seen = new Set()) => {
  if (typeof value === 'function') return [value];
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap((held) => functionsIn(held, seen));
};

// proves R-SCHED-20
test('L3 hands L2\'s notice function no means to rename a closer: nothing it is handed, or handed back, is a function', async () => {
  const handedOver = [];
  async function* notice(input) {
    handedOver.push(input);
    handedOver.push(yield { rename: 'after', number: 5 });
    handedOver.push(yield { rename: 'issue', number: 6 });
    return { issue: 6 };
  }
  const handed = handles({ notice });

  await assert.rejects(loop(handed).pull());

  assert.equal(handedOver.length, 3);
  assert.deepEqual(functionsIn(handedOver), []);
});

// proves R-SCHED-7, R-SCHED-20
test('a bare hold closer at a trigger, once every issue of the repository is gone, takes the name after 0, which admission reads back, and its notice is opened and attached', async () => {
  const world = forge();
  const handed = handles({ cards: [] });
  const notice = changesOver(world, handed.sink).notice;
  const readBack = [];
  handed.l2.notice = async function* reading(input) {
    const inner = notice(input);
    let step = await inner.next();
    while (!step.done) {
      const outcome = yield step.value;
      readBack.push(moduleOver(handed.state).read());
      step = await inner.next(outcome);
    }
    return step.value;
  };
  seed(handed.state, 'hold-a1.json');

  const pulled = await loop(handed).pull();

  assert.deepEqual(pulled.notices, []);
  assert.deepEqual(readBack.map(({ state, closers }) => [state, closers?.map(({ name, after, issue }) => ({ name, after, issue }))]), [
    ['closed', [{ name: 'hold-a1-after-0.json', after: '0', issue: undefined }]],
    ['closed', [{ name: 'hold-a1-issue-1.json', after: undefined, issue: '1' }]],
  ]);
  assert.deepEqual(world.issues.map(({ number, title }) => ({ number, title })), [{ number: 1, title: 'Rigger closed admission' }]);
  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-1.json']);
});

// proves R-SCHED-20
test('a closer left after 0 by a crash after the opening is recovered: the scan attaches issue #1, and no second issue is opened', async () => {
  const world = forge({ issues: [noticeIssue(1, 'a1')] });
  const handed = handles({ cards: [] });
  handed.l2.notice = changesOver(world, handed.sink).notice;
  seed(handed.state, 'hold-a1-after-0.json');

  const pulled = await loop(handed).pull().catch((failure) => ({ failure: failure.message }));

  assert.equal(pulled.failure, undefined);
  assert.deepEqual(pulled.notices, []);
  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-1.json']);
  assert.equal(world.calls.filter(([name]) => name === 'openIssue').length, 0);
});

/**
 * L0's handle on a board holding `cards`, whose issue state read answers `states`, by number, a
 * state given as an Error refusing that read, and which records each number it was asked for.
 */
function stateBoard(cards, states) {
  const asked = [];
  const board = {
    ...handleOn(boardOf(cards)),
    readIssueState: async (number) => {
      asked.push(number);
      if (states[number] instanceof Error) throw states[number];
      return { state: states[number] ?? 'none' };
    },
  };
  return { board, asked };
}

/** A notice function answering, for each closer naming an issue, `answers[issue]`, and recording what it was handed. */
function followingNotice(answers) {
  const calls = [];
  async function* notice({ closer, others, state }) {
    calls.push({ name: closer.name, others, state });
    return answers[closer.issue];
  }
  return Object.assign(notice, { calls });
}

// proves R-SCHED-23
test('at each trigger L3 reads each issue a hold\'s closer names once, through board.readIssueState, whatever number of closers name it, and hands L2\'s notice each closer\'s hold with the state it read', async () => {
  const { board, asked } = stateBoard([], { 12: 'open', 14: 'closed' });
  const notice = followingNotice({ 12: { issue: 12 }, 14: { issue: 14 } });
  const handed = handles({ cards: [], notice, board });
  for (const name of ['hold-a1-issue-12.json', 'hold-b2-issue-12.json', 'hold-c3-issue-14.json', 'owner-o4.json']) seed(handed.state, name);
  const built = loop(handed);

  await built.pull();
  await built.pull();

  // Two triggers, two issues: four reads, never one per closer or per claim.
  assert.deepEqual(asked, [12, 14, 12, 14]);
  assert.deepEqual(notice.calls.slice(0, 3).sort((one, other) => one.name.localeCompare(other.name)), [
    { name: 'hold-a1-issue-12.json', others: [12, 14], state: 'open' },
    { name: 'hold-b2-issue-12.json', others: [12, 14], state: 'open' },
    { name: 'hold-c3-issue-14.json', others: [12, 12], state: 'closed' },
  ]);
});

// proves R-SCHED-4, R-SCHED-23
test('where L2 answers that the notice closed for a hold, L3 removes that hold\'s closer, the event naming the issue\'s close as what reopened admission, and the same trigger then claims', async () => {
  const { board } = stateBoard([1], { 12: 'closed' });
  const notice = followingNotice({ 12: { issue: 12, closed: true } });
  const handed = handles({ cards: [1], notice, board });
  seed(handed.state, 'hold-a1-issue-12.json');

  await assert.rejects(loop(handed).pull(), (failure) => failure.errors.some(({ message }) => /card #1 was held/.test(message)));

  const opened = readEvents(handed.state).filter(({ event }) => event === 'admission.open');
  assert.deepEqual(opened.map(({ layer, kind, id, name, by, issue }) => ({ layer, kind, id, name, by, issue })), [{ layer: 'L3', kind: 'hold', id: 'a1', name: 'hold-a1-issue-12.json', by: 'issue', issue: 12 }]);
  // Admission opened, so this trigger claimed card #1, which then held again under a closer of its own.
  assert.ok(readEvents(handed.state).some(({ event, card }) => event === 'pull' && card === 1));
  assert.ok(!namesIn(handed.state).includes('hold-a1-issue-12.json'));
});

// proves R-SCHED-23
test('a closed notice removes only that hold\'s closer: the owner\'s pause, before or after the hold, stays, and admission stays closed', async () => {
  for (const names of [['hold-a1-issue-12.json', 'owner-o4.json'], ['owner-o4.json', 'hold-a1-issue-12.json']]) {
    const { board } = stateBoard([1], { 12: 'closed' });
    const handed = handles({ cards: [1], notice: followingNotice({ 12: { issue: 12, closed: true } }), board });
    for (const name of names) seed(handed.state, name);

    const pulled = await loop(handed).pull();

    assert.deepEqual(namesIn(handed.state), ['owner-o4.json'], names.join(', '));
    assert.equal(pulled.admission.state, 'closed', names.join(', '));
    assert.ok(!readEvents(handed.state).some(({ event }) => event === 'pull'), names.join(', '));
  }
});

// proves R-SCHED-23
test('an issue whose state read is refused or times out is unreadable: L3 hands L2 nothing for it, claims nothing, records notice.failed naming the issue, answers it, and reads again at the next trigger', async () => {
  const { board, asked } = stateBoard([1], { 12: new Error('gh: readIssueState timed out after 30000 ms') });
  const notice = followingNotice({});
  const handed = handles({ cards: [1], notice, board });
  seed(handed.state, 'hold-a1-issue-12.json');
  const built = loop(handed);

  const pulled = await built.pull();
  await built.pull();

  assert.deepEqual(notice.calls, []);
  assert.deepEqual(asked, [12, 12]);
  assert.equal(pulled.admission.state, 'closed');
  const step = "read issue #12's state";
  assert.deepEqual(pulled.notices, [{ id: 'a1', step, cause: 'gh: readIssueState timed out after 30000 ms' }]);
  const failed = readEvents(handed.state).filter(({ event }) => event === 'notice.failed');
  assert.deepEqual(failed.map(({ layer, hold, issue, step: named }) => ({ layer, hold, issue, step: named })), [{ layer: 'L3', hold: 'a1', issue: 12, step }, { layer: 'L3', hold: 'a1', issue: 12, step }]);
  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-12.json']);
  assert.ok(!readEvents(handed.state).some(({ event }) => event === 'pull'));
});

// proves R-SCHED-23
test('with no closer, a status issue a person reopened changes nothing: L3 reads no issue\'s state and makes no notice call', async () => {
  const { board, asked } = stateBoard([], { 12: 'open' });
  const notice = followingNotice({});
  const handed = handles({ cards: [], notice, board });

  await loop(handed).pull();

  assert.deepEqual(asked, []);
  assert.deepEqual(notice.calls, []);
});

// proves R-SCHED-23
test('through L2\'s column changes, an issue no longer the notice has L2 open another and L3 rename the closer to it, and a close after the notice reached it removes the closer', async () => {
  const STATUS = 'rigger:status';
  // #3 carried the label and lost it, then was closed; #5 is the notice, closed while labelled.
  const labelled = { kind: 'labeled', createdAt: '2026-10-01T00:00:00Z', actor: 'rigger-bot', label: STATUS };
  const world = forge({
    issues: [
      ...CARDS(),
      { number: 3, title: 'Rigger closed admission', body: 'Hold: `a1`', author: 'rigger-bot', state: 'closed', labels: [], comments: [], timeline: [labelled, { ...labelled, kind: 'unlabeled' }, { kind: 'closed', createdAt: '2026-10-01T00:00:00Z', actor: 'williacj' }] },
      { number: 5, title: 'Rigger closed admission', body: 'Hold: `b2`', author: 'rigger-bot', state: 'closed', labels: [STATUS], comments: [], timeline: [labelled, { kind: 'closed', createdAt: '2026-10-01T00:00:00Z', actor: 'github-project-automation[bot]' }] },
    ],
  });
  const { board } = stateBoard([], { 3: 'closed', 5: 'closed' });
  const handed = handles({ cards: [], board });
  handed.l2.notice = changesOver(world, handed.sink).notice;
  for (const name of ['hold-a1-issue-3.json', 'hold-b2-issue-5.json']) seed(handed.state, name);

  const pulled = await loop(handed).pull();

  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-6.json']);
  assert.equal(pulled.admission.state, 'closed');
  assert.deepEqual(world.issues.at(-1).labels, [STATUS]);
  assert.deepEqual(readEvents(handed.state).filter(({ event }) => event === 'admission.open').map(({ name, by, issue }) => ({ name, by, issue })), [{ name: 'hold-b2-issue-5.json', by: 'issue', issue: 5 }]);
});

// proves R-SCHED-23
test('a close made while the issue carried the label, then the label removed, still counts for a closer that had not yet attached the issue: the scan attaches it, and the next trigger removes the closer', async () => {
  const STATUS = 'rigger:status';
  const at = '2026-10-01T00:00:00Z';
  // #3 is the hold's notice, opened before a crash left the closer after 2; it was closed while
  // labelled, and its label then removed.
  const world = forge({
    issues: [...CARDS(), { number: 3, title: 'Rigger closed admission', body: 'Why.\n\nHold: `a1`\n', author: 'rigger-bot', state: 'closed', labels: [], comments: [], timeline: [
      { kind: 'labeled', createdAt: at, actor: 'rigger-bot', label: STATUS },
      { kind: 'closed', createdAt: at, actor: 'williacj' },
      { kind: 'unlabeled', createdAt: at, actor: 'williacj', label: STATUS },
    ] }],
  });
  const { board, asked } = stateBoard([], { 3: 'closed' });
  const handed = handles({ cards: [], board });
  handed.l2.notice = changesOver(world, handed.sink).notice;
  seed(handed.state, 'hold-a1-after-2.json');
  const built = loop(handed);

  await built.pull();
  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-3.json']);
  await built.pull();

  assert.deepEqual(namesIn(handed.state), []);
  assert.deepEqual(asked, [3]);
  assert.deepEqual(readEvents(handed.state).filter(({ event }) => event === 'admission.open').map(({ name, by, issue }) => ({ name, by, issue })), [{ name: 'hold-a1-issue-3.json', by: 'issue', issue: 3 }]);
  assert.equal(world.calls.filter(([name]) => name === 'openIssue').length, 0);
});

// proves R-SCHED-23
test('a state read stays bound to the issue it was read for: a trigger queued behind a notice call that renamed the closer hands L2 nothing, and the replacement\'s close then reopens admission', async () => {
  // The architect's round-1 probe on #1079: two triggers read #12 as deleted; the first call opens
  // and attaches #14, which a person then closes; the second must not follow #14 with #12's state.
  const world = forge({ issues: CARDS(), pulls: [13] });
  const states = { 12: 'none' };
  const { board, asked } = stateBoard([], states);
  const handed = handles({ cards: [], board });
  const notice = changesOver(world, handed.sink).notice;
  let entered;
  const firstEntered = new Promise((resolve) => { entered = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const readLabelled = world.reads.readLabelledIssues;
  let firstRead = true;
  world.reads.readLabelledIssues = async (...args) => {
    if (firstRead) {
      firstRead = false;
      entered();
      await gate;
    }
    return readLabelled(...args);
  };
  let calls = 0;
  handed.l2.notice = async function* followed(input) {
    const value = yield* notice(input);
    calls += 1;
    if (calls === 1) {
      // A person closes the replacement as soon as its notice reaches it.
      await world.writes.closeIssue(value.issue);
      states[value.issue] = 'closed';
    }
    return value;
  };
  seed(handed.state, 'hold-a1-issue-12.json');
  const built = loop(handed);
  const one = built.pull();
  await firstEntered;
  const two = built.pull();
  // A condition, not elapsed time, establishes the second trigger's read of #12.
  while (asked.length < 2) await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([one, two]);

  const opened = world.issues.filter(({ title }) => title === 'Rigger closed admission').map(({ number }) => number);
  assert.deepEqual(opened, [14], 'the stale state of #12 opened a second issue');
  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-14.json']);
  assert.equal(calls, 1, 'the second trigger handed L2 a state read for another issue');
  await built.pull();
  assert.deepEqual(namesIn(handed.state), [], 'the close of the replacement must reopen admission');
  assert.deepEqual(asked, [12, 12, 14]);
});

// proves R-SCHED-23
test('where the sink refuses the admission.open event of an issue close that removed the last closer, the closer stays removed and the pull rejects naming the refused event', async () => {
  // The architect's round-1 event probe on #1079.
  const { board } = stateBoard([], { 12: 'closed' });
  const handed = handles({ cards: [], notice: followingNotice({ 12: { issue: 12, closed: true } }), board });
  const original = handed.sink;
  let refused = 0;
  handed.sink = {
    ...original,
    emitter: (where) => {
      const emitter = original.emitter(where);
      return {
        ...emitter,
        emit: (event, fields) => {
          if (event === 'admission.open') {
            refused += 1;
            throw new Error('the stream refused admission.open');
          }
          return emitter.emit(event, fields);
        },
      };
    },
  };
  seed(handed.state, 'hold-a1-issue-12.json');

  const outcome = await loop(handed).pull().then((value) => ({ value }), (error) => ({ error }));

  assert.equal(refused, 1);
  assert.deepEqual(namesIn(handed.state), []);
  assert.deepEqual(readEvents(handed.state).filter(({ event }) => event === 'admission.open'), []);
  const messages = (error) => (error === undefined ? [] : [error.message, ...(error.errors ?? []).flatMap(messages)]);
  assert.match(messages(outcome.error).join('; '), /hold-a1-issue-12\.json, and the sink refused its admission\.open event: the stream refused admission\.open/);
});

// proves R-SCHED-23
test('a notice step the forge made whose record the sink refused, on a closer naming an issue, reaches the pull\'s notices with its made mark and unrecorded events, and the closer stays', async () => {
  const failed = { step: 'comment on issue #12', cause: 'the sink refused 1 L0 event', made: { answer: { id: 1 } }, unrecorded: [{ event: 'call.end' }] };
  const { board } = stateBoard([], { 12: 'open' });
  const handed = handles({ cards: [], notice: followingNotice({ 12: { failed } }), board });
  seed(handed.state, 'hold-a1-issue-12.json');

  const pulled = await loop(handed).pull();

  assert.deepEqual(pulled.notices, [{ id: 'a1', ...failed }]);
  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-12.json']);
});

// proves R-SCHED-23
test('a rename made on a closer naming an issue whose admission.rename event the sink refused keeps the closer under its new name, hands L2 the refusal, which names the change as made, and L3 reports the refusal itself', async () => {
  const { board } = stateBoard([], { 12: 'none' });
  const handed = handles({ cards: [], board });
  const handedBack = [];
  handed.l2.notice = async function* renaming() {
    handedBack.push(yield { rename: 'issue', number: 13 });
    return { failed: { step: 'rename the closer', cause: handedBack[0].reason.message } };
  };
  const original = handed.sink;
  handed.sink = {
    ...original,
    emitter: (where) => {
      const emitter = original.emitter(where);
      return { ...emitter, emit: (event, fields) => { if (event === 'admission.rename') throw new Error('the stream refused admission.rename'); return emitter.emit(event, fields); } };
    },
  };
  seed(handed.state, 'hold-a1-issue-12.json');

  const failure = await loop(handed).pull().then(() => assert.fail('the refused rename record was absorbed'), (error) => error);

  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-13.json']);
  assert.equal(handedBack[0].status, 'rejected');
  const said = 'admission renamed hold-a1-issue-12.json to hold-a1-issue-13.json, and its record was refused: admission changed at hold-a1-issue-13.json, and the sink refused its admission.rename event: the stream refused admission.rename';
  assert.equal(handedBack[0].reason.message, said);
  assert.ok(messagesOf(failure).includes(said), 'L3 did not report the refused record of the rename it made');
  assert.ok(messagesOf(failure).includes(`the notice for hold a1 failed to rename the closer: ${said}`), 'L2\'s failed notice was lost');
});

/** Every message a pull's failure holds, through each AggregateError and cause. */
const messagesOf = (error) => (error === undefined ? [] : [error.message, ...(error.errors ?? []).flatMap(messagesOf), ...(error.cause === undefined ? [] : messagesOf(error.cause))]);

/** `handed`'s sink, refusing each event `events` names with `EIO while recording <event>`, and recording each refusal in `refused`. */
function refusingEvents(handed, events) {
  const original = handed.sink;
  const refused = [];
  handed.sink = {
    ...original,
    emitter: (where) => {
      const emitter = original.emitter(where);
      return {
        ...emitter,
        emit: (event, fields) => {
          if (events.includes(event)) {
            refused.push({ event, fields });
            throw new Error(`EIO while recording ${event}`);
          }
          return emitter.emit(event, fields);
        },
      };
    },
  };
  return refused;
}

// proves R-SCHED-23
test('a closer rename made on the follow path whose admission.rename record was refused stays reported when L2\'s notice.failed record is refused too', async () => {
  // The architect's round-3 B1 probe on #1079.
  const world = forge({ issues: [{ number: 20, title: 'Rigger closed admission', body: 'Hold: `z9`', author: 'rigger-bot', labels: ['rigger:status'], comments: [] }] });
  const { board } = stateBoard([], { 12: 'none' });
  const handed = handles({ cards: [], board });
  const refused = refusingEvents(handed, ['admission.rename', 'notice.failed']);
  handed.l2.notice = changesOver(world, handed.sink).notice;
  seed(handed.state, 'hold-a1-issue-12.json');

  const failure = await loop(handed).pull().then(() => assert.fail('the refused rename record was absorbed'), (error) => error);

  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-20.json']);
  assert.deepEqual(refused.map(({ event }) => event), ['admission.rename', 'notice.failed']);
  const reported = messagesOf(failure).join(' | ');
  assert.match(reported, /admission changed at hold-a1-issue-20\.json/);
  assert.match(reported, /EIO while recording admission\.rename/);
  assert.match(reported, /EIO while recording notice\.failed/);
});

// proves R-SCHED-23
test('a closer opening made on the follow path whose admission.open record was refused stays reported when a later read of the trigger fails', async () => {
  // The architect's round-3 B2 probe on #1079, and the same for each later read of the trigger:
  // the columns, the priority read, L2's facts call, and an admission read that cannot be read.
  const later = {
    columns: (handed) => { handed.board.readColumns = async () => { throw new Error('HTTP 502 reading board columns after opening'); }; },
    priority: (handed) => { handed.board.readPriority = async () => { throw new Error('HTTP 502 reading board columns after opening'); }; },
    facts: (handed) => { handed.facts = async () => { throw new Error('HTTP 502 reading board columns after opening'); }; },
  };
  for (const [what, failLater] of Object.entries(later)) {
    const { board } = stateBoard([], { 12: 'closed' });
    const handed = handles({ cards: [], board, notice: followingNotice({ 12: { issue: 12, closed: true } }) });
    const refused = refusingEvents(handed, ['admission.open']);
    failLater(handed);
    seed(handed.state, 'hold-a1-issue-12.json');

    const outcome = await loop(handed).pull().then((value) => ({ value }), (error) => ({ error }));

    assert.deepEqual(namesIn(handed.state), [], what);
    assert.equal(refused.length, 1, what);
    const reported = messagesOf(outcome.error).join('; ');
    assert.match(reported, /admission changed at hold-a1-issue-12\.json/, what);
    assert.match(reported, /EIO while recording admission\.open/, what);
    assert.match(reported, /HTTP 502 reading board columns after opening/, what);
  }
});

// proves R-SCHED-23
test('a notice write the forge made whose record was refused stays reported when a concurrent resume opens admission while the write is in flight', async () => {
  // The reviewer's round-3 B1 interleaving on #1079: L2 comments on #12, whose notice never
  // reached it; during that write `resume` removes the closer; the write is made and its call.end
  // refused. The trigger then reads admission open and claims; the refused record must still reach
  // the caller.
  const STATUS = 'rigger:status';
  const world = forge({ issues: [{ number: 12, title: 'Rigger closed admission', body: 'Hold: `z9`', author: 'rigger-bot', labels: [STATUS], comments: [] }] });
  const { board } = stateBoard([], { 12: 'open' });
  const handed = handles({ cards: [], board });
  handed.l2.notice = changesOver(world, handed.sink).notice;
  const comment = world.writes.postIssueComment;
  world.writes.postIssueComment = async (...args) => {
    await comment(...args);
    await moduleOver(handed.state).resume();
    throw Object.assign(new Error('the sink refused 1 L0 event: call.end went unrecorded: EIO'), { code: 'EVENT_REFUSED', made: { answer: { id: 1 } }, unrecorded: [{ event: 'call.end' }] });
  };
  seed(handed.state, 'hold-a1-issue-12.json');

  const outcome = await loop(handed).pull().then((value) => ({ value }), (error) => ({ error }));

  assert.equal(world.issues[0].comments.length, 1, 'the comment was made');
  assert.deepEqual(namesIn(handed.state), [], 'resume removed the closer');
  assert.equal(world.issues[0].state ?? 'open', 'open');
  assert.match(messagesOf(outcome.error).join('; '), /hold a1.*comment on issue #12.*call\.end/, JSON.stringify(outcome.value ?? null));
});

// proves R-SCHED-23
test('an unreadable state read whose notice.failed record is refused stays reported, beside an earlier made opening on the same trigger', async () => {
  const { board } = stateBoard([], { 12: 'closed', 14: new Error('gh: HTTP 502') });
  const handed = handles({ cards: [], board, notice: followingNotice({ 12: { issue: 12, closed: true } }) });
  const refused = refusingEvents(handed, ['admission.open', 'notice.failed']);
  for (const name of ['hold-a1-issue-12.json', 'hold-b2-issue-14.json']) seed(handed.state, name);

  const outcome = await loop(handed).pull().then((value) => ({ value }), (error) => ({ error }));

  assert.deepEqual(refused.map(({ event }) => event), ['admission.open', 'notice.failed']);
  assert.deepEqual(namesIn(handed.state), ['hold-b2-issue-14.json']);
  const reported = [...messagesOf(outcome.error), JSON.stringify(outcome.value?.notices ?? outcome.error?.notices ?? [])].join('; ');
  assert.match(reported, /EIO while recording admission\.open/);
  assert.match(reported, /read issue #14's state/);
  assert.match(reported, /EIO while recording notice\.failed/);
});

// The architect's round-4 probes on #1079: `loop.run` must carry every trigger's notices to its
// caller, as `pull` does, a made write's refused record among them.
for (const write of ['postIssueComment', 'addIssue', 'moveItem']) {
  test(`loop.run reports a made ${write} on the follow path whose call.end record was refused`, async () => {
    const world = forge({ issues: [{ number: 12, title: 'Rigger closed admission', body: 'Hold: `z9`', author: 'rigger-bot', labels: ['rigger:status'], comments: [] }] });
    const { board } = stateBoard([], { 12: 'open' });
    const handed = handles({ cards: [], board });
    handed.l2.notice = changesOver(world, handed.sink).notice;
    const side = write === 'postIssueComment' ? world.writes : world.items;
    const original = side[write];
    let made = false;
    side[write] = async (...args) => {
      const answer = await original(...args);
      made = true;
      throw Object.assign(new Error(`call.end went unrecorded: EIO (${write})`), { code: 'EVENT_REFUSED', made: { answer }, unrecorded: [{ event: 'call.end' }] });
    };
    seed(handed.state, 'hold-a1-issue-12.json');

    const outcome = await loop(handed).run().then((value) => ({ value }), (error) => ({ error }));

    assert.equal(made, true, `${write} was made`);
    assert.equal(world.issues[0].comments.length, 1);
    if (write !== 'postIssueComment') assert.equal(world.onBoard.length, 1);
    if (write === 'moveItem') assert.equal(world.onBoard[0].column, 'Owner');
    assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-12.json']);
    assert.deepEqual(readEvents(handed.state).filter(({ event }) => event === 'notice.failed'), []);
    assert.match([...messagesOf(outcome.error), JSON.stringify(outcome.value)].join('; '), /call\.end/, `${write}: loop.run lost the made write and its refused record`);
  });
}

// proves R-SCHED-23
test('loop.run reports a made closer rename on the follow path whose admission.rename record was refused', async () => {
  const world = forge({ issues: [{ number: 20, title: 'Rigger closed admission', body: 'Hold: `z9`', author: 'rigger-bot', labels: ['rigger:status'], comments: [] }] });
  const { board } = stateBoard([], { 12: 'none' });
  const handed = handles({ cards: [], board });
  const refused = refusingEvents(handed, ['admission.rename']);
  handed.l2.notice = changesOver(world, handed.sink).notice;
  seed(handed.state, 'hold-a1-issue-12.json');

  const outcome = await loop(handed).run().then((value) => ({ value }), (error) => ({ error }));

  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-20.json']);
  assert.equal(refused.length, 1);
  assert.match([...messagesOf(outcome.error), JSON.stringify(outcome.value)].join('; '), /admission\.rename/, 'loop.run lost the made rename and its refused record');
});




/** The ordinary Error shared by the retained refusal controls. */
const HOSTILE = () => ({ 'an Error': new Error('a plain failure') });

/** Whether every failure `error` holds, through its errors and causes, is an Error whose message reads as a string. */
const readable = (error, seen = new Set()) => {
  if (seen.has(error)) return true;
  seen.add(error);
  if (!(error instanceof Error) || typeof error.message !== 'string') return false;
  return (error.errors ?? []).every((each) => readable(each, seen)) && (error.cause === undefined || readable(error.cause, seen));
};

// proves R-SCHED-23
test('a state read rejecting with an ordinary Error keeps the closer, calls no notice, and names the issue in notice.failed', async () => {
  // The reviewer's and the architect's round-7 B1 probe on #1079, over every hostile value.
  const STATUS = 'rigger:status';
  for (const [what, read] of [['rejects with an Error', () => Promise.reject(HOSTILE()['an Error'])]]) {
    const world = forge({ issues: [{ number: 12, title: 'Rigger closed admission', body: 'Hold: `a1`', author: 'rigger-bot', state: 'closed', labels: [STATUS], comments: [], timeline: [{ kind: 'labeled', createdAt: 'x', actor: 'rigger-bot', label: STATUS }, { kind: 'closed', createdAt: 'x', actor: 'williacj' }] }] });
    const board = { ...handleOn(boardOf([])), readIssueState: read };
    const handed = handles({ cards: [], board });
    let calls = 0;
    const notice = changesOver(world, handed.sink).notice;
    handed.l2.notice = async function* counted(input) { calls += 1; return yield* notice(input); };
    seed(handed.state, 'hold-a1-issue-12.json');

    const pulled = await loop(handed).pull();

    assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-12.json'], what);
    assert.equal(calls, 0, `${what}: L2 was handed a state that was never read`);
    assert.equal(pulled.admission?.state, 'closed', what);
    assert.equal(pulled.notices.length, 1, what);
    assert.equal(pulled.notices[0].step, "read issue #12's state", what);
    assert.equal(typeof pulled.notices[0].cause, 'string', what);
    assert.ok(readEvents(handed.state).some(({ event, issue }) => event === 'notice.failed' && issue === 12), what);
  }
});

// proves R-SCHED-23
test('an actual later read Error stays original beside the earlier made opening and its refused record', async (t) => {
  // The reviewer's and the architect's round-7 B2 probe on #1079, over every hostile value.
  for (const what of ['actual later readColumns refusal']) {
    const world = relayWorld(t, { issues: [relayIssue(12, 'a1', 'closed')], failRead: 'readColumns' });
    world.refuse(({ event }) => event === 'admission.open');
    world.seed('hold-a1-issue-12.json');
    const handed = world.options;
    const outcome = await loop(handed).pull().then((answer) => ({ answer }), (error) => ({ error }));
    const value = world.failures.find(({ name }) => name === 'readColumns').reason;



    assert.deepEqual(namesIn(handed.state), [], what);
    assert.ok(readable(outcome.error), `${what}: a failure handed on cannot be read`);
    assert.ok(outcome.error.errors.includes(value), `${what}: the actual original read Error must be handed on`);
    assert.match(messagesOf(outcome.error).join('; '), /EIO while recording admission\.open/, what);
  }
});

// The pre-judge attack of round 8 on #1079: a made outside action stays reported, with its refused
// record, whatever fails afterwards, and reporting never throws.
import { noticeLine } from '../src/cli/once.mjs';

/** A sink over `handed`'s that refuses the events `refuse` names, each with the value `refuse[event](fields)` answers; undefined answers accept it. */
function refusingWith(handed, refuse) {
  const original = handed.sink;
  handed.sink = {
    ...original,
    emitter: (where) => {
      const emitter = original.emitter(where);
      return {
        ...emitter,
        emit: (event, fields) => {
          if (event in refuse) {
            const refusal = refuse[event](fields);
            if (refusal !== undefined) throw refusal.value;
          }
          return emitter.emit(event, fields);
        },
      };
    },
  };
}

/** Every message `error` holds, read safely, through its errors and causes. */
const safeMessages = (error, seen = new Set()) => {
  if (error === undefined || error === null || seen.has(error)) return [];
  seen.add(error);
  let message;
  try { message = String(error.message); } catch (failure) { message = `<unreadable: ${failure.message}>`; }
  return [message, ...(Array.isArray(error.errors) ? error.errors.flatMap((each) => safeMessages(each, seen)) : []), ...(error.cause === undefined ? [] : safeMessages(error.cause, seen))];
};

/** L2's notice answering, for a closer naming an issue, that its notice closed. */
const closedNotice = () => async function* closing({ closer }) { return { issue: Number(closer.issue), closed: true }; };

for (const [what, value] of Object.entries(HOSTILE())) {
  test(`a closer removed on the follow path whose admission.open record the sink refuses with ${what} stays named in what the pull rejects with`, async () => {
    const { board } = stateBoard([], { 12: 'closed' });
    const handed = handles({ cards: [], board, notice: closedNotice() });
    refusingWith(handed, { 'admission.open': () => ({ value }) });
    seed(handed.state, 'hold-a1-issue-12.json');

    const outcome = await loop(handed).pull().then((answer) => ({ answer }), (error) => ({ error }));

    assert.deepEqual(namesIn(handed.state), []);
    assert.match(safeMessages(outcome.error).join(' | '), /admission changed at hold-a1-issue-12\.json, and the sink refused its admission\.open event/, what);
    assert.ok(readable(outcome.error), `${what}: a failure handed on cannot be read`);
  });

  if (['undefined', 'an Error', 'an Error whose cause is itself'].includes(what)) {
  test(`a made opening whose record was refused stays reported when the drain trigger's record is refused with ${what}`, async () => {
    const { board } = stateBoard([], { 12: 'closed' });
    const handed = handles({ cards: [], board, notice: closedNotice() });
    refusingWith(handed, { 'admission.open': () => ({ value: new Error('EIO admission.open') }), trigger: (fields) => (fields.trigger === 'drain' ? { value } : undefined) });
    seed(handed.state, 'hold-a1-issue-12.json');

    const outcome = await loop(handed).pull().then((answer) => ({ answer }), (error) => ({ error }));

    assert.deepEqual(namesIn(handed.state), []);
    const said = safeMessages(outcome.error).join(' | ');
    assert.match(said, /EIO admission\.open/, what);
    assert.match(said, /the event sink refused to record the drain trigger/, what);
    assert.ok(readable(outcome.error), `${what}: a failure handed on cannot be read`);
  });
  }

  test(`a closer renamed on the follow path whose admission.rename record the sink refuses with ${what} stays named in what the pull rejects with`, async () => {
    const world = forge({ issues: [{ number: 20, title: 'Rigger closed admission', body: 'Hold: `z9`', author: 'rigger-bot', labels: ['rigger:status'], comments: [] }] });
    const { board } = stateBoard([], { 12: 'none' });
    const handed = handles({ cards: [], board });
    refusingWith(handed, { 'admission.rename': () => ({ value }) });
    handed.l2.notice = changesOver(world, handed.sink).notice;
    seed(handed.state, 'hold-a1-issue-12.json');

    const failure = await loop(handed).pull().then(() => assert.fail('the refused rename record was absorbed'), (error) => error);

    assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-20.json']);
    assert.match(safeMessages(failure).join(' | '), /admission renamed hold-a1-issue-12\.json to hold-a1-issue-20\.json, and its record was refused: admission changed at hold-a1-issue-20\.json, and the sink refused its admission\.rename event/, what);
  });

  test(`resume's removal whose admission.open record the sink refuses with ${what} names the closer it removed`, async () => {
    const state = join(temporaryDirectory('rigger-hold-notice-'), '.rigger');
    seed(state, 'hold-a1-issue-12.json');
    const sink = { emitter: () => ({ emit: () => { throw value; } }) };

    const outcome = await moduleOver(state, { sink }).resume().then((answer) => ({ answer }), (error) => ({ error }));

    assert.deepEqual(namesIn(state), []);
    assert.equal(outcome.error, undefined, what);
    assert.deepEqual(outcome.answer?.unrecorded.map(({ name }) => name), ['hold-a1-issue-12.json'], what);
    assert.ok(outcome.answer.unrecorded.every(({ name, why }) => typeof name === 'string' && typeof why === 'string'
      && /hold-a1-issue-12\.json.*sink refused its admission\.open event/.test(why)), `${what}: the refused record's string fields must name the closer and event`);
  });
}





// proves R-SCHED-23
test('two concurrent pulls over one closed notice make one opening and report no failure', async () => {
  let calls = 0;
  const { board } = stateBoard([], { 12: 'closed' });
  const handed = handles({ cards: [], board, notice: async function* counted({ closer }) { calls += 1; return { issue: Number(closer.issue), closed: true }; } });
  seed(handed.state, 'hold-a1-issue-12.json');
  const built = loop(handed);

  const outcomes = await Promise.allSettled([built.pull(), built.pull()]);

  assert.equal(readEvents(handed.state).filter(({ event }) => event === 'admission.open').length, 1);
  assert.equal(calls, 1);
  assert.ok(outcomes.every(({ status }) => status === 'fulfilled'));
});

// The pre-judge re-attack of round 9 on #1079.
import { unreadableAdmission } from '../src/cli/doctor.mjs';

/** What `once`'s catch reads of a pull's failure, as `src/cli/once.mjs` reads it: `reached`, then each failure's `unreadable`, `attemptFailures` and `message`. */
const onceReads = (failure) => {
  const failuresIn = (each) => (each instanceof AggregateError ? each.errors.flatMap(failuresIn) : [each]);
  const reached = failure.reached ?? [];
  const lines = failuresIn(failure).map((held) => {
    if (Array.isArray(held.unreadable)) return unreadableAdmission(held.unreadable);
    const attempts = held.attemptFailures;
    if (!Array.isArray(attempts) || attempts.at(-1)?.maker === undefined) return `rigger once: ${held.message}`;
    return 'held';
  });
  return [reached.length, ...lines].join('\n');
};



// proves R-SCHED-23
test('a refused opening record stays reported beside another closer\'s normal notice failure, on the follow path and on the trigger\'s', async () => {
  for (const [what, other, id] of [['naming an issue', 'hold-b2-issue-13.json', 'b2'], ['naming none', 'hold-c3.json', 'c3']]) {
    const { board } = stateBoard([], { 12: 'closed', 13: 'open' });
    const handed = handles({ cards: [], board, notice: async function* answering({ closer }) { return closer.issue === '12' ? { issue: 12, closed: true } : { failed: { step: 'publish the normal hold notice', cause: 'forge refused the notice' } }; } });
    refusingEvents(handed, ['admission.open']);
    seed(handed.state, 'hold-a1-issue-12.json');
    seed(handed.state, other);

    const outcome = await loop(handed).pull().then((answer) => ({ answer }), (error) => ({ error }));

    const said = outcome.error === undefined ? JSON.stringify(outcome.answer?.notices) : safeMessages(outcome.error).join(' | ');
    assert.match(said, /EIO while recording admission\.open/, `${what}: ${said}`);
    assert.deepEqual(namesIn(handed.state), [other], what);
    const carried = outcome.error.errors.flatMap(({ notice }) => (notice === undefined ? [] : [notice]));
    assert.deepEqual(carried, [{ id, step: 'publish the normal hold notice', cause: 'forge refused the notice' }], what);
    const line = `rigger once: the notice for hold ${id} failed to publish the normal hold notice: forge refused the notice`;
    assert.equal(noticeLine('once', id, carried[0]), line, what);
    assert.ok(onceReads(outcome.error).split('\n').includes(line), what);
  }
});



// The judges' round-9 probes on #1079: no reportable entry is ever dropped, however many there are.
// proves R-SCHED-23
test('a made notice comment with 101 refused records names every one of them, its final call.end among them', async () => {
  const world = forge({ issues: [{ number: 12, title: 'Rigger closed admission', body: 'Hold: `z9`', author: 'rigger-bot', labels: ['rigger:status'], comments: [] }] });
  const { board } = stateBoard([], { 12: 'open' });
  const handed = handles({ cards: [], board });
  handed.l2.notice = changesOver(world, handed.sink).notice;
  const original = world.writes.postIssueComment;
  const unrecorded = [...Array.from({ length: 100 }, () => ({ event: 'survivor.killed' })), { event: 'call.end' }];
  world.writes.postIssueComment = async (...args) => {
    await original(...args);
    throw Object.assign(new Error('101 records refused'), { code: 'EVENT_REFUSED', made: { answer: { id: 1 } }, unrecorded });
  };
  seed(handed.state, 'hold-a1-issue-12.json');

  const pulled = await loop(handed).pull();

  assert.equal(world.issues[0].comments.length, 1);
  assert.equal(pulled.notices[0].unrecorded.length, 101);
  assert.match(noticeLine('once', pulled.notices[0].id, pulled.notices[0]), /call\.end/);
});

// proves R-SCHED-23
test('a made notice comment retains its parsed JSON answer and refused records through the real write-side contract', async () => {
  const world = forge({ issues: [{ number: 12, title: 'Rigger closed admission', body: 'Hold: `z9`', author: 'rigger-bot', labels: ['rigger:status'], comments: [] }] });
  const { board } = stateBoard([], { 12: 'open' });
  const handed = handles({ cards: [], board });
  const saved = unrecordedKill();
  const [{ cause: savedCause }] = saved;
  // send follows repositoryWriteRunner's seam, and refusedCall the rejection runCommand gives a
  // call the forge made whose kill event the sink refused. The side marks it made itself.
  const send = async (command, args) => {
    const [api, path, flag, verb, field, body] = args;
    if (command !== 'gh' || api !== 'api' || path !== 'repos/acme/widgets/issues/12/comments' || flag !== '-X' || verb !== 'POST' || field !== '-f' || args.length !== 6) throw new Error(`this forge answers no ${command} ${args.join(' ')}`);
    await world.writes.postIssueComment(12, body.slice('body='.length));
    throw refusedCall('{"id":1,"bytes":[1,2],"slice":"ordinary JSON text","constructor":"ordinary key","__proto__":"ordinary prototype data"}', { unrecorded: saved });
  };
  handed.l2.notice = changesOver({ ...world, writes: relayRepositoryWriteSide({ repo: 'acme/widgets' }, { send }) }, handed.sink).notice;
  seed(handed.state, 'hold-a1-issue-12.json');

  const pulled = await loop(handed).pull();

  const [notice] = pulled.notices;
  assert.notEqual(notice?.made, undefined, 'MADE-JSON actual made answer retained');
  assert.equal(pulled.notices.length, 1);
  assert.deepEqual(Object.entries(notice.made.answer), [['id', 1], ['bytes', [1, 2]], ['slice', 'ordinary JSON text'], ['constructor', 'ordinary key'], ['__proto__', 'ordinary prototype data']]);
  assert.equal(Object.getPrototypeOf(notice.made.answer), Object.prototype);
  assert.equal(world.issues[0].comments.length, 1);
  assert.equal(pulled.admission.state, 'closed');
  assert.deepEqual(pulled.admission.closers.map(({ id }) => id), ['a1']);
  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-12.json']);
  assert.equal(notice.unrecorded, saved);
  assert.equal(notice.unrecorded[0].cause, savedCause);
  assert.deepEqual(notice.unrecorded.map(({ event, pid, name, cmd, cause }) => [event, pid, name, cmd, cause.message]), [['survivor.killed', 4243, 'tail', '/usr/bin/tail -f /tmp/hold', 'EISDIR: illegal operation on a directory, open']]);
  for (const named of ['survivor.killed', '4243', 'tail', '/usr/bin/tail -f /tmp/hold', 'EISDIR: illegal operation on a directory, open']) assert.ok(notice.cause.includes(named), named);
  assert.match(noticeLine('once', notice.id, notice), /made its step to comment on issue #12, but the sink refused its record, so these events went unrecorded: survivor\.killed/);
});

// proves R-SCHED-23
test('an admission directory of 101 malformed entries is refused naming every one of them, the 101st among them, as once reads it', async () => {
  const { board } = stateBoard([], {});
  const handed = handles({ cards: [], board });
  for (let at = 0; at < 101; at += 1) seed(handed.state, `bad-${String(at).padStart(3, '0')}.json`, 'not json');
  const before = namesIn(handed.state);

  const failure = await loop(handed).pull().then(() => assert.fail('an unreadable admission was accepted'), (error) => error);

  assert.deepEqual(namesIn(handed.state), before);
  const said = onceReads(failure);
  for (const name of before) assert.ok(said.includes(name), `${name} is not named`);
});

// proves R-SCHED-23
test('a rejected read whose AggregateError holds 101 failures is handed on with every leaf, the 101st among them', async () => {
  const { board } = stateBoard([], {});
  const errors = [...Array.from({ length: 100 }, () => new Error('earlier read failed')), new Error('last-read-failure')];
  board.readColumns = async () => { throw new AggregateError(errors, 'all facts failed'); };
  const handed = handles({ cards: [], board });

  const failure = await loop(handed).pull().then(() => assert.fail('the rejection was accepted'), (error) => error);

  assert.equal(failure.errors.length, 101);
  assert.match(onceReads(failure), /last-read-failure/);
});

test('actual unreadable admission entries and actual aggregated read failures reject the pull', async (t) => {
  for (const [what, fixture] of [
    ['unreadable entries', () => { const world = relayWorld(t, { observeAppend: false }); fs.mkdirSync(join(world.state, 'admission'), { recursive: true }); fs.writeFileSync(join(world.state, 'admission', 'bad-N1.json'), '{}'); return world; }],
    ['an aggregate\'s failures', () => { const world = relayWorld(t, { failRead: 'readColumns', failureText: 'N1 aggregate readColumns refusal' }); world.refuse(({ event, trigger }) => event === 'trigger' && trigger === 'pull'); return world; }],
  ]) {
    const world = fixture();
    const handed = world.options;
    const failure = await loop(handed).pull().then(() => assert.fail('accepted'), (error) => error);
    assert.ok(readable(failure), `${what}: actual rejection stays readable`);
    assert.doesNotThrow(() => onceReads(failure));
    if (what === 'unreadable entries') {
      const path = join(world.state, 'admission', 'bad-N1.json');
      assert.deepEqual(failure.unreadable, [{ path, cause: 'no closer form' }]);
      assert.ok(onceReads(failure).includes(path), 'C-N1 original invalid path reported');
      assert.match(onceReads(failure), /no closer form/);
    } else {
      assert.ok(failure instanceof AggregateError);
      assert.ok(failure.errors.includes(world.failures.find(({ name }) => name === 'readColumns').reason), 'C-N1 actual original reader Error retained');
      assert.match(onceReads(failure), /HTTP 502 N1 aggregate readColumns refusal/);
      assert.match(onceReads(failure), /record the pull trigger/);
    }
  }
});























for (const [what, closer, states] of [['a closer naming an issue, on the follow path', 'hold-a1-issue-12.json', { 12: 'closed' }], ['an issue-less closer, at the trigger', 'hold-c3.json', {}]]) {
  for (const [after, notice] of [
    ['throws', async function* thrower() { yield { rename: 'issue', number: 13 }; throw new Error('L2 broke after the rename'); }],
    ['ignores the outcome and answers its issue', async function* ignorer() { yield { rename: 'issue', number: 13 }; return { issue: 13 }; }],
  ]) {
    test(`a rename L3 made for ${what}, whose record the sink refused, stays reported by L3 when L2 then ${after}`, async () => {
      const { board } = stateBoard([], states);
      const handed = handles({ cards: [], board, notice });
      refusingWith(handed, { 'admission.rename': () => ({ value: new Error('EIO admission.rename') }) });
      seed(handed.state, closer);

      const failure = await loop(handed).pull().then(() => assert.fail('the refused rename record was absorbed'), (error) => error);

      assert.match(safeMessages(failure).join(' | '), /admission renamed .* to hold-[a-z0-9]+-issue-13\.json, and its record was refused: .*EIO admission\.rename/);
    });
  }
}





// The pre-judge attack of round 14 on #1079 (D1, D2, D3, D5 and D6).


// proves R-SCHED-23
test('a later read failing after a closed notice reopened admission reaches the caller as its original Error', async () => {
  const later = new Error('EIO columns');
  const { board } = stateBoard([], { 12: 'closed' });
  board.readColumns = async () => { throw later; };
  const handed = handles({ cards: [], board, notice: closedNotice() });
  seed(handed.state, 'hold-a1-issue-12.json');

  const failure = await loop(handed).pull().then(() => assert.fail('accepted'), (error) => error);

  const leaves = (each) => [each, ...(Array.isArray(each.errors) ? each.errors.flatMap(leaves) : []), ...(each.cause === undefined ? [] : leaves(each.cause))];
  assert.ok(leaves(failure).includes(later));
  assert.match(onceReads(failure), /EIO columns/);
  assert.deepEqual(namesIn(handed.state), []);
  assert.deepEqual(readEvents(handed.state).filter(({ event }) => event === 'admission.open').map(({ name }) => name), ['hold-a1-issue-12.json']);
});










import { readSide as relayReadSide } from '../src/substrate/forge/read.mjs';

// Boundary rule 4 infrastructure checks retain actual references. R-RECORD-9 describes
// event reporting and R-SCHED-23 describes reopening; neither requires same-object identity.
for (const read of ['readColumns', 'facts']) for (const earlier of [false, true]) {
  test(`P1 actual ${read} error identity; earlier trigger refusal=${earlier}`, async (t) => {
    const world = relayWorld(t, { failRead: read, cards: read === 'facts' ? [relayCard(3, 'Ready')] : [] });
    if (earlier) world.refuse((record) => record.event === 'trigger' && record.trigger === 'pull');
    const failure = await world.build().pull().then(() => assert.fail('the actual read refusal was accepted'), (error) => error);
    const original = world.failures.find(({ name }) => name === read).reason;
    assert.match(original.message, new RegExp(`HTTP 502 raw ${read} refusal`));
    if (earlier) {
      assert.ok(failure.errors.includes(original), 'P1 aggregate retains actual board Error');
      assert.match(messagesOf(failure).join('; '), /record the pull trigger/);
    } else assert.strictEqual(failure, original, 'P1 direct carrier must be actual board Error');
    assert.doesNotThrow(() => onceReads(failure));
    assert.match(onceReads(failure), new RegExp(`HTTP 502 raw ${read} refusal`));
  });
}

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { repositoryReads as relayRepositoryReads } from '../src/substrate/forge/read.mjs';
import { itemWriteSide as relayItemWriteSide } from '../src/substrate/forge/item-write.mjs';
import { repositoryWriteSide as relayRepositoryWriteSide } from '../src/substrate/forge/repository-write.mjs';
import { factsCall as relayFactsCall } from '../src/workflow/facts.mjs';
import { consumerConfig as relayConfig, card as relayCard } from './verb-consumer.mjs';
import { withObservedAdmission } from './loop-admission-observer.mjs';

const relayAppendAtImport = fs.appendFileSync;

/** Raw gh fixtures follow forge-read's recorded pages and fake-gh's issue/timeline/write contracts. */
function relayWorld(t, { issues = [], cards = [], failRead, failIssue, timedOut = false, failureText, refuse = () => false, observeAppend = true } = {}) {
  const settings = relayConfig(2);
  const state = temporaryDirectory('rigger-relay-');
  const realAppend = fs.appendFileSync;
  let refuseRecord = () => false;
  const refused = [];
  const operations = [];
  if (observeAppend) {
    fs.appendFileSync = (path, bytes, ...rest) => {
      let record;
      try { record = JSON.parse(String(bytes)); } catch {}
      if (record && String(path).startsWith(state) && refuseRecord(record)) {
        const error = Object.assign(new Error(`EIO while recording ${record.event}`), { code: 'EIO' });
        refused.push({ record, error });
        throw error;
      }
      if (record && String(path).startsWith(state)) operations.push({ event: record.event });
      return realAppend(path, bytes, ...rest);
    };
    syncBuiltinESMExports();
    t.after(() => { fs.appendFileSync = realAppend; syncBuiltinESMExports(); });
  }
  const sink = openSink({ directory: state, run: 'r-relay', now: () => 1 });
  const page = (nodes) => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes });
  const answer = (value, graph = true) => ({ status: 0, stdout: JSON.stringify(graph ? { data: value } : value), stderr: '', timedOut: false });
  const columns = Object.values(settings.board.columns);
  let active;
  let inFacts = false;
  const failures = [];
  const noticed = [];
  const writes = [];
  const send = (_command, args, options = {}) => {
    const path = args[1];
    const query = path === 'graphql' ? args[3] : '';
    operations.push({ read: active, args });
    const number = Number(/issue\(number: (\d+)/.exec(query)?.[1]);
    if ((failRead !== undefined && active === failRead) || (failRead === 'facts' && inFacts) || (active === 'readIssueState' && number === failIssue) || refuse(args, active)) {
      return { status: 1, stdout: '', stderr: `gh: HTTP 502 ${failureText ?? `raw ${inFacts ? 'facts' : active} refusal`}`, timedOut: active === 'readIssueState' && timedOut, timeout: options.timeout };
    }
    if (path.includes('/permission')) return answer({ role_name: 'write' }, false);
    if (path.includes('issues?state=all')) return answer(issues.length ? [{ number: Math.max(...issues.map((issue) => issue.number)) }] : [], false);
    if (path === 'graphql') {
      if (query.includes('updateProjectV2ItemFieldValue')) return answer({ updateProjectV2ItemFieldValue: { projectV2Item: { id: 'item-notice' } } });
      if (query.includes('addProjectV2ItemById')) return answer({ addProjectV2ItemById: { item: { id: 'item-notice' } } });
      if (query.includes('project: node(')) return answer({ project: { field: { id: 'F-Status' } }, target: { name: 'Status' } });
      if (query.includes('field(name:')) return answer({ repositoryOwner: { projectV2: { id: 'P', field: { id: 'F-Status', options: columns.map((name, at) => ({ id: `O-${at}`, name })) } } } });
      if (query.includes('fields(')) return answer({ repositoryOwner: { projectV2: { fields: page([{ name: 'Status', dataType: 'SINGLE_SELECT', options: columns.map((name) => ({ name })) }, { name: 'Priority', dataType: 'SINGLE_SELECT', options: ['High', 'Normal', 'Low'].map((name) => ({ name })) }]) } } });
      if (query.includes('items(')) return answer({ repositoryOwner: { projectV2: { items: page(cards.map((card) => ({ id: `item-${card.number}`, fieldValues: page([{ name: card.column, field: { name: 'Status' } }]), content: { __typename: 'Issue', number: card.number, title: card.title, body: card.body, repository: { nameWithOwner: settings.repo }, labels: page(card.labels.map((name) => ({ name }))) } }))) } } });
      if (query.includes('issues(states:')) return answer({ repository: { issues: page(issues.filter((issue) => issue.state !== 'closed').map(({ number }) => ({ number }))) } });
      if (query.includes('issue(number:')) {
        const issue = issues.find((each) => each.number === number);
        if (!issue) return { status: 1, stdout: JSON.stringify({ data: { repository: { issue: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'issue'] }] }), stderr: `gh: Could not resolve to an Issue with the number of ${number}.` };
        if (query.includes('timelineItems(')) return answer({ repository: { issue: { timelineItems: page([
          { __typename: 'LabeledEvent', createdAt: '2026-10-01T00:00:00Z', actor: { login: 'rigger-bot' }, label: { name: 'rigger:status' } },
          ...(issue.state === 'closed' ? [{ __typename: 'ClosedEvent', createdAt: '2026-10-01T00:00:01Z', actor: { login: 'owner' } }] : []),
        ]) } } });
        return answer({ repository: { issue: { number, title: issue.title, body: issue.body, state: (issue.state ?? 'open').toUpperCase(), author: { login: 'rigger-bot' }, repository: { nameWithOwner: settings.repo }, labels: page(issue.labels.map((name) => ({ name }))) } } });
      }
      if (query.includes('refs(')) return answer({ repository: { refs: page([]) } });
      if (query.includes('ref(')) return answer({ repository: Object.fromEntries([...query.matchAll(/(\w+): ref\(/g)].map(([, alias]) => [alias, null])) });
      if (query.includes('pullRequests(')) return answer({ repository: { pullRequests: page([]) } });
    }
    if (/\/issues\/\d+\/comments$/.test(path)) { writes.push({ operation: 'comment', args }); return answer({ id: 1 }, false); }
    if (/\/issues\/\d+$/.test(path)) return answer({ node_id: `I_issue${path.split('/').at(-1)}` }, false);
    if (path.endsWith('/issues') && args[3] === 'POST') {
      const fields = Object.fromEntries(args.filter((_, at) => args[at - 1] === '-f').map((field) => { const at = field.indexOf('='); return [field.slice(0, at), field.slice(at + 1)]; }));
      const number = Math.max(0, ...issues.map((issue) => issue.number)) + 1;
      issues.push({ number, title: fields.title, body: fields.body, labels: ['rigger:status'] });
      writes.push({ operation: 'open', number });
      return answer({ number, labels: [{ name: 'rigger:status' }] }, false);
    }
    throw new Error(`raw relay fixture has no answer for ${JSON.stringify(args)}`);
  };
  const watch = (name, operation) => async (...args) => {
    const before = active;
    active = name;
    try { return await operation(...args); }
    catch (reason) { failures.push({ name, reason }); throw reason; }
    finally { active = before; }
  };
  const given = { ...settings.board, repo: settings.repo };
  const board = Object.fromEntries(Object.entries(relayReadSide(given, { send })).map(([name, operation]) => [name, watch(name, operation)]));
  const repository = Object.fromEntries(Object.entries(relayRepositoryReads(given, { send })).map(([name, operation]) => [name, watch(name, operation)]));
  const changes = columnChanges({ config: settings, sink, reads: repository, board, items: relayItemWriteSide(given, { send }), repositoryWrites: relayRepositoryWriteSide({ repo: settings.repo }, { send }) });
  const notice = changes.notice;
  const l2 = { ...changes, notice: (input) => {
    const actual = notice(input);
    const call = { input, handed: [], returned: false };
    noticed.push(call);
    return {
      async next(outcome) { if (outcome !== undefined) call.handed.push(outcome); const step = await actual.next(outcome); if (step.done) call.answer = step.value; return step; },
      async return(...args) { call.returned = true; return actual.return(...args); },
      [Symbol.asyncIterator]() { return this; },
    };
  } };
  const decide = (card, outcomes, options = {}) => nextAction(card, settings.kinds, undefined, { columns: settings.board.columns, roles: settings.roles, provisioning: settings.provisioning, outcomes, sink, ...options });
  const actualFacts = relayFactsCall({ config: settings, reads: repository, decide });
  const facts = watch('facts', async (...args) => { inFacts = true; try { return await actualFacts(...args); } finally { inFacts = false; } });
  const options = { ...handles({ cards: [], state, sink }), config: settings, board, l2, decide, facts, clock: { now: () => 1, pause: async () => {} }, run: 'r-relay' };
  return { state, options, board, l2, changes, noticed, failures, refused, writes, operations,
    build: (make = loop) => make(options), seed: (name) => seed(state, name), names: () => namesIn(state),
    refuse: (predicate) => { refuseRecord = predicate; },
  };
}

/** A raw forge status issue, whose label/close events are supplied at the transport boundary. */
const relayIssue = (number, id, state = 'open') => ({ number, title: 'Rigger closed admission', body: `Hold: \`${id}\`\n`, labels: ['rigger:status'], state });

// Identity remains an Architecture boundary diagnostic; reporting and removed files below
// separately preserve the R-RECORD-9/R-SCHED-23 duties without borrowing their product claims.
for (const later of ['none', 'readColumns', 'readPriority', 'facts', 'admission']) {
  test(`P6 actual admission.open refusal followed by ${later}`, async (t) => withObservedAdmission(async (make, captures) => {
    const world = relayWorld(t, { issues: [relayIssue(12, 'a1', 'closed')], cards: later === 'facts' ? [relayCard(3, 'Ready')] : [], failRead: ['readColumns', 'readPriority', 'facts'].includes(later) ? later : undefined });
    world.seed('hold-a1-issue-12.json');
    world.refuse((record) => {
      if (record.event !== 'admission.open') return false;
      if (later === 'admission') fs.writeFileSync(join(world.state, 'admission', 'bad.json'), 'bad');
      return true;
    });
    const failure = await world.build(make).pull().then(() => assert.fail('the refused opening was accepted'), (error) => error);
    const original = captures.get(world.state).calls.find((call) => call.method === 'open').reason;
    assert.ok(original instanceof Error, 'P6 capture actual admission rejection');
    assert.ok(Array.isArray(failure.errors) && failure.errors.includes(original), 'P6 aggregate retains actual admission Error A');
    assert.ok(!world.names().includes('hold-a1-issue-12.json'), 'P6 actual closer removed');
    assert.match(onceReads(failure), /admission\.open/);
    if (['readColumns', 'readPriority', 'facts'].includes(later)) assert.ok(failure.errors.includes(world.failures.find(({ name }) => name === later).reason), 'P6 later actual read retained');
    if (later === 'admission') assert.match(onceReads(failure), /bad\.json.*no closer form/);
  }));
}

for (const outcome of ['fulfilled', 'gone', 'refused']) {
  test(`P4 actual notice generator rename outcome=${outcome}`, async (t) => withObservedAdmission(async (make, captures) => {
    const world = relayWorld(t);
    world.seed('hold-a1.json');
    if (outcome === 'refused') world.refuse((record) => record.event === 'admission.rename');
    let resumed;
    if (outcome === 'gone') {
      const original = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (String(from).startsWith(world.state)) resumed = moduleOver(world.state).resume();
        return original(from, to);
      };
      syncBuiltinESMExports();
      t.after(() => { fs.renameSync = original; syncBuiltinESMExports(); });
    }
    const result = await world.build(make).pull().then((value) => ({ value }), (failure) => ({ failure }));
    if (resumed) await resumed;
    const renames = captures.get(world.state).calls.filter(({ method }) => method === 'rename');
    const notice = world.noticed[0];
    assert.ok(renames.length > 0, 'P4 actual admission.rename reached');
    if (outcome === 'gone') {
      assert.equal(renames[0].value.gone, true);
      assert.equal(notice.returned, true, 'P4 gone closes actual generator');
      assert.equal(notice.handed.length, 0, 'P4 no later generator step');
      assert.deepEqual(world.names(), []);
      assert.deepEqual(world.writes, [], 'P4 gone performs no later write');
    } else {
      assert.equal(notice.handed[0].status, outcome === 'refused' ? 'rejected' : 'fulfilled');
      const key = outcome === 'refused' ? 'reason' : 'value';
      assert.strictEqual(notice.handed[0][key], renames[0][key], 'P4 original rename settlement handed on');
      assert.deepEqual(world.names(), [outcome === 'refused' ? 'hold-a1-after-0.json' : 'hold-a1-issue-1.json'], JSON.stringify(notice.answer));
      if (outcome === 'refused') assert.ok(result.failure.errors.includes(renames[0].reason), 'P4 original refused rename retained');
      else {
        assert.equal(notice.answer.issue, 1);
        assert.equal(notice.handed.length, 2);
        for (let at = 0; at < renames.length; at += 1) assert.strictEqual(notice.handed[at].value, renames[at].value);
      }
    }
  }));
}

for (const kind of ['issue', 'closed', 'ordinary-failed']) {
  test(`P5 actual statusNotice return ${kind}`, async (t) => {
    const world = relayWorld(t, { issues: kind === 'closed' ? [relayIssue(12, 'a1', 'closed')] : [], failRead: kind === 'ordinary-failed' ? 'readItems' : undefined });
    world.seed(kind === 'closed' ? 'hold-a1-issue-12.json' : 'hold-a1.json');
    const pulled = await world.build().pull();
    const actual = world.noticed[0].answer;
    if (kind === 'closed') {
      assert.deepEqual(actual, { issue: 12, closed: true });
      assert.deepEqual(world.names(), []);
      assert.deepEqual(relayOpeningEvents(world.state), relayExpectedOpening, 'P5 selected issue reaches the actual opening event');
    }
    else {
      assert.deepEqual(world.names(), ['hold-a1-issue-1.json']);
      if (kind === 'issue') assert.deepEqual(actual, { issue: 1 });
      else {
        assert.equal(actual.failed.step, 'read the board');
        assert.match(actual.failed.cause, /HTTP 502/);
        assert.equal(pulled.notices[0].step, 'read the board');
        assert.equal(pulled.notices[0].cause, actual.failed.cause, 'P5 ordinary failure retains its actual report');
        assert.match(noticeLine('once', pulled.notices[0].id, pulled.notices[0]), /failed to read the board.*HTTP 502/);
      }
    }
  });
}

for (const timedOut of [false, true]) for (const refused of [false, true]) {
  test(`P7 actual issue-state timeout=${timedOut}; notice.failed refusal=${refused}; earlier opening`, async (t) => {
    const world = relayWorld(t, { issues: [relayIssue(12, 'a1', 'closed'), relayIssue(14, 'b2')], failIssue: 14, timedOut });
    world.seed('hold-a1-issue-12.json'); world.seed('hold-b2-issue-14.json');
    world.refuse((record) => record.event === 'admission.open' || (refused && record.event === 'notice.failed'));
    const failure = await world.build().pull().then(() => assert.fail('the earlier opening refusal was lost'), (error) => error);
    const report = messagesOf(failure).join('; ');
    assert.match(report, /admission\.open/);
    assert.match(report, /hold b2.*read issue #14's state/);
    assert.match(report, timedOut ? /ran past its timeout of 60000 ms/ : /HTTP 502/);
    if (refused) assert.match(report, /notice\.failed/);
    assert.deepEqual(world.names(), ['hold-b2-issue-14.json']);
    assert.ok(world.noticed.every(({ input }) => input.closer.id !== 'b2'), 'P7 failed state never reaches L2 notice');
  });
}

// Same-object relay/cutoff is infrastructure under boundary rule 4, not the reporting/reopen
// claims of R-RECORD-9 or R-SCHED-23. Each path/cause oracle comes from its actual file name.
test('P13 actual admission.read dense 10005 entries retains original list and last name', async (t) => withObservedAdmission(async (make, captures) => {
  const world = relayWorld(t);
  fs.mkdirSync(join(world.state, 'admission'), { recursive: true });
  for (let at = 0; at < 10005; at += 1) fs.writeFileSync(join(world.state, 'admission', `bad-${String(at).padStart(5, '0')}.json`), 'bad');
  const failure = await world.build(make).pull().then(() => assert.fail('unreadable admission was accepted'), (error) => error);
  const read = captures.get(world.state).calls.filter(({ method }) => method === 'read').at(-1).value;
  assert.equal(read.state, 'unreadable');
  assert.equal(read.unreadable.length, 10005);
  assert.strictEqual(failure.unreadable, read.unreadable, 'P13 original actual admission list');
  let report;
  assert.doesNotThrow(() => { report = onceReads(failure); });
  for (const entry of read.unreadable) {
    assert.equal(entry.cause, 'no closer form');
    assert.ok(failure.message.includes(`${entry.path} (no closer form)`), 'P13 every actual malformed path/cause named');
    assert.ok(report.includes(entry.path), 'P13 presenter retains every path');
  }
  assert.equal(failure.unreadable[0].path, join(world.state, 'admission', 'bad-00000.json'));
  assert.equal(failure.unreadable.at(-1).path, join(world.state, 'admission', 'bad-10004.json'));
  assert.doesNotMatch(failure.message, /did not read|first 10000/);
}));

// contentOf's closeSync is the actual throw site; no throwing generator is invented.
test('P14 notify chain catch reports actual admission.read filesystem close failure', async (t) => withObservedAdmission(async (make, captures) => {
  const world = relayWorld(t); world.seed('hold-a1.json');
  const open = fs.openSync, close = fs.closeSync;
  const descriptors = new Set();
  let count = 0, injected;
  fs.openSync = (path, ...args) => { const fd = open(path, ...args); if (String(path).startsWith(join(world.state, 'admission'))) descriptors.add(fd); return fd; };
  fs.closeSync = (fd) => {
    const owned = descriptors.delete(fd);
    const result = close(fd);
    if (owned && ++count === 3) { injected = Object.assign(new Error('EIO actual admission read close boundary'), { code: 'EIO' }); throw injected; }
    return result;
  };
  syncBuiltinESMExports();
  t.after(() => { fs.openSync = open; fs.closeSync = close; syncBuiltinESMExports(); });
  const pulled = await world.build(make).pull();
  assert.ok(injected, 'P14 actual close failure reached');
  assert.equal(world.noticed.length, 0);
  assert.strictEqual(captures.get(world.state).calls.find(({ reason }) => reason !== undefined).reason, injected);
  assert.deepEqual(pulled.notices, [{ id: 'a1', step: 'notice', cause: 'EIO actual admission read close boundary' }]);
  assert.deepEqual(world.names(), ['hold-a1.json']);
}));

const relayOpeningEvents = (state) => readEvents(state).filter(({ event }) => event === 'admission.open')
  .map(({ layer, kind, id, name, by, issue }) => ({ layer, kind, id, name, by, issue }));
const relayExpectedOpening = [{ layer: 'L3', kind: 'hold', id: 'a1', name: 'hold-a1-issue-12.json', by: 'issue', issue: 12 }];

// Complete actual opening/read/report guards, distinct from the identity-only infrastructure claim.
test('an accepted admission.open record survives an actual later readColumns failure in pull', async (t) => {
  const world = relayWorld(t, { issues: [relayIssue(12, 'a1', 'closed')], failRead: 'readColumns', failureText: 'accepted-open readColumns refusal' });
  world.seed('hold-a1-issue-12.json');
  const failure = await world.build().pull().then(() => assert.fail('the later read was accepted'), (error) => error);
  assert.strictEqual(failure, world.failures.find(({ name }) => name === 'readColumns').reason);
  assert.ok(readable(failure), 'ACCEPTED-OPEN pull rejection remains readable');
  assert.doesNotThrow(() => onceReads(failure));
  assert.match(onceReads(failure), /readColumns.*HTTP 502 accepted-open readColumns refusal/);
  assert.deepEqual(world.names(), []);
  assert.deepEqual(relayOpeningEvents(world.state), relayExpectedOpening);
  const opened = world.operations.findIndex(({ event }) => event === 'admission.open');
  const failedRead = world.operations.findIndex(({ read }) => read === 'readColumns');
  assert.ok(opened >= 0 && failedRead > opened, 'ACCEPTED-OPEN accepted append precedes failed reader');
});

test('an opening refusal, an actual state-read failure and an actual later board-read failure stay reported together', async (t) => withObservedAdmission(async (make, captures) => {
  const world = relayWorld(t, { issues: [relayIssue(12, 'a1', 'closed'), relayIssue(14, 'b2')], failIssue: 14, failRead: 'readColumns' });
  world.seed('hold-a1-issue-12.json'); world.seed('hold-b2-issue-14.json');
  world.refuse(({ event }) => event === 'admission.open');
  const failure = await world.build(make).pull().then(() => assert.fail('combined actual failures were accepted'), (error) => error);
  const opening = captures.get(world.state).calls.find(({ method }) => method === 'open').reason;
  const read = world.failures.find(({ name }) => name === 'readColumns').reason;
  assert.ok(failure.errors.includes(opening), 'OPEN-STATE-READ original A retained');
  assert.ok(failure.errors.includes(read), 'OPEN-STATE-READ original E retained');
  assert.ok(readable(failure));
  assert.doesNotThrow(() => onceReads(failure));
  const report = onceReads(failure);
  assert.match(report, /admission\.open/);
  assert.match(report, /hold b2.*read issue #14's state.*HTTP 502 raw readIssueState refusal/);
  assert.match(report, /readColumns.*HTTP 502 raw readColumns refusal/);
  assert.deepEqual(world.names(), ['hold-b2-issue-14.json']);
  assert.ok(world.noticed.every(({ input }) => input.closer.id !== 'b2'));
}));

test('a sole actual state-read refusal leaves one closed admission notice and its accepted notice.failed event', async (t) => {
  const world = relayWorld(t, { issues: [relayIssue(12, 'a1')], failIssue: 12 });
  world.seed('hold-a1-issue-12.json');
  const pulled = await world.build().pull();
  assert.equal(pulled.admission.state, 'closed');
  assert.deepEqual(world.names(), ['hold-a1-issue-12.json']);
  assert.equal(world.noticed.length, 0);
  assert.equal(pulled.notices.length, 1);
  const [notice] = pulled.notices;
  assert.equal(notice.id, 'a1');
  assert.equal(notice.step, "read issue #12's state");
  assert.equal(typeof notice.cause, 'string');
  assert.match(notice.cause, /HTTP 502 raw readIssueState refusal/);
  assert.deepEqual(readEvents(world.state).filter(({ event }) => event === 'notice.failed').map(({ layer, hold, issue, step }) => ({ layer, hold, issue, step })), [{ layer: 'L3', hold: 'a1', issue: 12, step: "read issue #12's state" }]);
});

test('a real drain append refusal retains an earlier actual admission.open refusal', async (t) => {
  const world = relayWorld(t, { issues: [relayIssue(12, 'a1', 'closed')] });
  world.seed('hold-a1-issue-12.json');
  world.refuse((record) => record.event === 'admission.open' || (record.event === 'trigger' && record.trigger === 'drain'));
  const failure = await world.build().pull().then(() => assert.fail('combined drain/open refusal was accepted'), (error) => error);
  assert.deepEqual(world.names(), []);
  assert.equal(world.refused.length, 2);
  assert.deepEqual(world.refused.map(({ record }) => record.event), ['admission.open', 'trigger']);
  assert.ok(readable(failure));
  assert.doesNotThrow(() => onceReads(failure));
  assert.match(onceReads(failure), /admission\.open/);
  assert.match(onceReads(failure), /record the drain trigger/);
});

test('P6 actual l2.claimed move refusal after earlier actual admission.open refusal', async (t) => withObservedAdmission(async (make, captures) => {
  const world = relayWorld(t, { issues: [relayIssue(12, 'a1', 'closed')], cards: [relayCard(3, 'Ready')], refuse: (args) => String(args[3]).includes('updateProjectV2ItemFieldValue') });
  world.seed('hold-a1-issue-12.json');
  world.refuse(({ event }) => event === 'admission.open');
  const original = world.l2.claimed;
  let claimed;
  world.l2.claimed = async (...args) => { try { return await original(...args); } catch (reason) { claimed = reason; throw reason; } };
  const failure = await world.build(make).pull().then(() => assert.fail('claimed refusal was accepted'), (error) => error);
  assert.match(claimed.message, /move from ready to coding.*refused/);
  assert.ok(failure.errors.includes(claimed), 'P6 actual claimed Error retained');
  assert.ok(failure.errors.includes(captures.get(world.state).calls.find(({ method }) => method === 'open').reason), 'P6 actual opening Error retained beside claim');
  assert.deepEqual(world.names(), []);
  assert.doesNotThrow(() => onceReads(failure));
  assert.match(onceReads(failure), /admission\.open/);
  assert.match(onceReads(failure), /move from ready to coding.*refused/);
}));

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { realHost } from '../src/substrate/host.mjs';

/** Node child streams/events and documented ps/lsof absence, as process-host.test models them. */
function relayProcessHost() {
  let pid = 990000000;
  const starts = [];
  const host = {
    ...realHost,
    clock: { now: () => 1, pause: async () => {}, schedule: () => ({ unref() {} }), cancel() {} },
    spawn(command, args, options) {
      const child = new EventEmitter();
      child.pid = ++pid;
      child.exitCode = null; child.signalCode = null;
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
      starts.push({ command, args, options, child });
      queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0, null); child.stdout.end('controlled output\n'); child.stderr.end(); });
      return child;
    },
    spawnSync(_tool, args) {
      // process-host's start-identity contract; all other ps/lsof reads answer no matches.
      return args.includes('lstart=') ? { status: 0, stdout: 'Mon Jan  1 00:00:00 2024\n', stderr: '' } : { status: 1, stdout: '', stderr: '' };
    },
    execFile(_tool, _args, _options, done) {
      queueMicrotask(() => done(Object.assign(new Error('no matching processes'), { code: 1 }), '', ''));
      return { stdout: { destroy() {} }, stderr: { destroy() {} } };
    },
    signal() { throw Object.assign(new Error('controlled process absent'), { code: 'ESRCH' }); },
    killChild() { throw new Error('the completed controlled child needs no kill'); },
  };
  return { host, starts };
}

/** Literal documented L2 role/settlement answers, with L1 driven by the injected process host. */
function relayControlled({ refusedRelease = false } = {}) {
  const state = temporaryDirectory('rigger-relay-controlled-');
  const under = join(state, 'workspaces');
  const process = relayProcessHost();
  const settings = { ...config, concurrency: 2, clock: undefined };
  // L1's documented directory answer; no checkout or native git is needed by a step.
  const makeWorkspace = async (card) => { const path = join(under, String(card)); mkdirSync(path, { recursive: true }); return { path, scratch: join(under, 'scratch', String(card)), repository: under }; };
  const role = (name) => ({ role: name, provider: 'not-configured', tier: 'standard', agent: `.claude/agents/${name}.md`, instruction: `controlled ${name}`, evidence: '', timeout: 10000, steps: [], facts: { head: '4'.repeat(40) } });
  const settled = new Map();
  const ordinary = openSink({ directory: state, run: 'r-controlled', now: () => 1 });
  const sink = { emitter: (context) => {
    const emitter = ordinary.emitter(context);
    return { emit(event, fields) { if (refusedRelease && context.card === 3 && event === 'slot.release') throw new Error(`controlled refusal ${event}`); return emitter.emit(event, fields); } };
  } };
  const decide = (card, outcomes, options = {}) => {
    if (options.forge === undefined) return outcomes.length === 0
      ? { action: 'dispatch', kind: 'change', step: { name: 'prepare', run: 'literal controlled step', timeout: 10000 } }
      : { action: 'dispatch', kind: 'change', maker: role('engineer') };
    return { action: 'ignore' };
  };
  const claimed = new Set();
  const fake = boardOf([3, 4]);
  const board = handleOn(fake, { onRead: (items) => { for (let i = items.length - 1; i >= 0; i -= 1) if (claimed.has(items[i].number)) items.splice(i, 1); } });
  const handed = { ...handles({ cards: [3, 4], board, state, config: settings, sink, decide, facts: async () => (card) => decide(card, []) }), host: process.host,
    workspace: makeWorkspace, clock: { now: () => 1, pause: async () => {} },
    l2: { claimed: async (card) => { claimed.add(card.number); }, settled: async (card) => {
      const value = { settled: card.number }; settled.set(card.number, value); return value;
    } },
  };
  return { state, handed, settled, starts: process.starts };
}

// D29 infrastructure companions use literal contract inputs. R-RECORD-9 concerns actual event
// refusals; R-SCHED-23 concerns actual reopening, neither of which these carrier controls claim.
test('controlled pull and run preserve settlement and sibling carriers', async () => {
  for (const verb of ['pull', 'run']) for (const failed of [false, true]) {
    const world = relayControlled({ refusedRelease: failed });
    const result = await loop(world.handed)[verb]().then((value) => ({ value }), (failure) => ({ failure }));
    assert.ok(world.starts.length >= 2, 'controlled L1 host actually used');
    const reached = failed ? (verb === 'pull' ? result.failure.reached : result.failure.errors.find((failure) => failure.reached?.some(({ card }) => card === 3)).reached) : result.value;
    assert.deepEqual(reached.map(({ card }) => card).sort(), [3, 4]);
    for (const entry of reached) {
      assert.equal(entry.outcome.status, 'rejected');
      assert.equal(entry.outcome.reason.code, 'NOT_STARTED');
      assert.match(entry.outcome.reason.message, /no provider adapter named "not-configured"/);
    }
    assert.ok(world.starts.every(({ child }) => child.exitCode === 0), 'controlled provisioning steps completed');
    assert.strictEqual(reached.find(({ card }) => card === 3).settled.value, world.settled.get(3), 'controlled original successful settlement carrier');
    if (failed) assert.match(messagesOf(result.failure).join('\n'), /controlled refusal slot\.release/, 'controlled failed sibling retained');
    assert.strictEqual(reached.find(({ card }) => card === 4).settled.value, world.settled.get(4));
  }
});

// D29 diagnostic: literal directory/start refusals exercise carrier choice, not native J/D provenance.
test('controlled judge refusals retain siblings without retry or hold', async () => {
  for (const route of ['directory', 'dispatch-result', 'dispatch-start', 'L3-start']) {
    const world = relayControlled();
    const directoryFailure = Object.assign(new Error('controlled judge directory refusal'), { code: 'WORKSPACE_NOT_MADE' });
    const made = [];
    const role = (name) => ({ role: name, provider: 'not-configured', tier: 'standard', agent: `${name}.md`, instruction: '', evidence: '', timeout: 10000, facts: { head: '4'.repeat(40) }, steps: [{ name: 'prepare', run: 'controlled judge step', timeout: 10000 }] });
    const roles = [role('reviewer'), role('architect')];
    const asks = [];
    const decide = (_card, _outcomes, options = {}) => {
      asks.push(options);
      if (Object.values(options.directories ?? {}).some(({ status }) => status === 'rejected')) return { action: 'judge', judges: [], halt: true };
      if (route === 'dispatch-start' && options.judged?.reviewer?.[0]?.status === 'rejected') return { action: 'judge', judges: [roles[1]] };
      return { action: 'judge', judges: roles };
    };
    const ordinary = world.handed.sink;
    const reviewerSteps = new Set();
    world.handed.sink = { emitter(context) { const writer = ordinary.emitter(context); return { emit(event, fields) {
      if (context.layer === 'L3' && fields.role === 'reviewer' && fields.step !== undefined) reviewerSteps.add(context.dispatch);
      if (route === 'L3-start' && context.layer === 'L3' && fields.role === 'reviewer' && fields.step === undefined && event === 'dispatch') throw new Error('controlled L3 start refusal');
      if (route === 'dispatch-start' && context.layer === 'L1' && fields.step === undefined && event === 'dispatch.start' && reviewerSteps.has(context.dispatch)) throw new Error('controlled L1 start refusal');
      return writer.emit(event, fields);
    } }; } };
    world.handed.board = handleOn(boardOf([3]));
    world.handed.decide = decide;
    world.handed.facts = async () => decide;
    world.handed.judgeDirectory = async (_card, name) => {
      made.push(name);
      if (route === 'directory' && name === 'reviewer') throw directoryFailure;
      const path = join(world.state, name); mkdirSync(path, { recursive: true });
      return { path, main: path, head: path, scratch: join(path, 'scratch'), repository: world.state };
    };
    const answer = await loop(world.handed).pull().then((value) => ({ value }), (failure) => ({ failure }));
    const reached = answer.failure?.reached ?? answer.value;
    const judges = reached[0].judges;
    assert.deepEqual(made.sort(), ['architect', 'reviewer'], `${route}: no directory retry`);
    assert.deepEqual(judges.map(({ role }) => role), route === 'dispatch-start' ? ['architect'] : ['reviewer', 'architect'], `${route}: sibling and non-withheld carriers retained`);
    const sibling = judges.find(({ role }) => role === 'architect');
    assert.equal(sibling.outcome.status, 'rejected');
    assert.equal(sibling.outcome.reason.code, 'NOT_STARTED');
    assert.match(sibling.outcome.reason.message, /not-configured/);
    assert.ok(asks.some(({ directories }) => directories?.architect), `${route}: sibling start refusal handed to L2`);
    assert.equal(fs.existsSync(join(world.state, 'admission')), false, `${route}: no hold`);
    if (route === 'directory') {
      assert.strictEqual(judges[0].failure.cause, directoryFailure, 'controlled noOutcome preserves directory reason');
      assert.ok(answer.failure);
    } else if (route === 'L3-start') {
      assert.ok(answer.failure);
      assert.match(judges[0].failure.message, /controlled L3 start refusal/);
    } else if (route === 'dispatch-result') {
      assert.equal(judges[0].halt, true, 'controlled L2 halt retained');
      assert.equal(judges[0].outcome.reason.code, 'NOT_STARTED');
      assert.equal(answer.failure, undefined);
    } else {
      const declined = asks.find(({ judged }) => judged?.reviewer?.[0]?.status === 'rejected').judged.reviewer[0];
      assert.equal(declined.reason.code, 'EVENT_REFUSED');
      assert.match(declined.reason.message, /controlled L1 start refusal/);
      assert.equal(answer.failure, undefined, 'withheld step is not retried or held');
    }
  }
});

// D29 diagnostic: literal notice contract inputs; actual M/U provenance belongs to the host cases.
test('controlled notice carriers retain made actions and refused events', async () => {
  for (const carrier of ['closed-pull', 'run', 'resume', 'later-read']) for (const count of [1, 2]) {
    const originals = new Map();
    let handed;
    async function* notice({ closer }) {
      const made = { operation: 'postIssueComment', number: 12, answer: { id: closer.id } };
      const unrecorded = [{ event: 'call.end', cause: new Error('controlled first record refusal') }, { event: 'notice.fixture', cause: new Error('controlled last record refusal') }];
      originals.set(closer.id, { made, unrecorded });
      if (carrier === 'resume') await moduleOver(handed.state).resume();
      return { failed: { step: 'comment on issue #12', cause: 'controlled records refused', made, unrecorded } };
    }
    handed = handles({ cards: [], notice, clock: { now: () => 1, pause: async () => {} } });
    const later = new Error('controlled later read refusal');
    if (carrier === 'later-read') {
      handed.board = stateBoard([], { 12: 'closed' }).board;
      handed.board.readColumns = async () => { throw later; };
      const ordinary = handed.sink;
      handed.sink = { emitter(context) { const writer = ordinary.emitter(context); return { emit(event, fields) { if (event === 'admission.open') throw new Error('controlled opening record refusal'); return writer.emit(event, fields); } }; } };
    }
    for (const id of ['c3', 'c4'].slice(0, count)) seed(handed.state, carrier === 'later-read' ? `hold-${id}-issue-12.json` : `hold-${id}.json`);
    const result = await loop(handed)[carrier === 'run' ? 'run' : 'pull']().then((value) => ({ value }), (failure) => ({ failure }));
    const notices = [];
    const visit = (failure) => { if (failure.notice) notices.push(failure.notice); for (const each of failure.errors ?? []) visit(each); };
    if (result.failure) visit(result.failure);
    else notices.push(...result.value.notices);
    // A concurrent resume removes every closer; the second may already be gone before notice.
    const expected = carrier === 'resume' ? 1 : count;
    assert.equal(notices.length, expected, `${carrier}: exact retained notice count`);
    assert.equal(originals.size, expected);
    for (const notice of notices) {
      const original = originals.get(notice.id);
      assert.strictEqual(notice.made, original.made, `${carrier}: original controlled action`);
      assert.strictEqual(notice.unrecorded, original.unrecorded, `${carrier}: original controlled refused list`);
      assert.deepEqual(notice.unrecorded.map(({ event }) => event), ['call.end', 'notice.fixture'], `${carrier}: last refused event retained`);
      assert.match(noticeLine('once', notice.id, notice), /made its step to comment on issue #12.*call\.end.*notice\.fixture/);
    }
    if (carrier === 'later-read') assert.ok(result.failure.errors.includes(later), 'controlled original later failure retained beside notices');
    if (carrier === 'closed-pull') {
      assert.equal(result.value.admission.state, 'closed');
      assert.deepEqual(notices.map(({ id }) => id).sort(), ['c3', 'c4'].slice(0, count));
    }
  }
});

import moduleForObserverCheck from 'node:module';

// Infrastructure evidence for r4's observer isolation; no product requirement claim.
test('the admission observer releases captures and leaves canonical imports and the suite guard alone', async (t) => {
  assert.strictEqual(fs.appendFileSync, relayAppendAtImport, 'N1 fixture cleanup restores the original appendFileSync binding');
  const actualRegister = moduleForObserverCheck.registerHooks;
  const registrations = [];
  moduleForObserverCheck.registerHooks = (options) => {
    assert.deepEqual(Object.keys(options), ['resolve'], 'observer installs no load hook');
    const hook = actualRegister(options);
    const record = { deregistered: false };
    registrations.push(record);
    return { deregister() { record.deregistered = true; hook.deregister(); } };
  };
  syncBuiltinESMExports();
  t.after(() => { moduleForObserverCheck.registerHooks = actualRegister; syncBuiltinESMExports(); });
  await import('./loop-admission-observer.mjs?inert-import');
  assert.equal(registrations.length, 0, 'importing the helper installs no hook');
  let released, expiredMake;
  await withObservedAdmission(async (make, captures) => {
    released = captures; expiredMake = make;
    assert.equal(registrations.at(-1).deregistered, true, 'hook is deregistered before use begins');
    const observed = handles({ cards: [], clock: { now: () => 1, pause: async () => {} } });
    await make(observed).pull();
    assert.ok(captures.has(observed.state), 'one tagged loop edge is observed');
    const canonical = handles({ cards: [], clock: { now: () => 1, pause: async () => {} } });
    await loop(canonical).pull();
    assert.equal(captures.has(canonical.state), false, 'unrelated canonical loop imports remain unobserved');
    const admission = await import('../src/scheduling/admission.mjs');
    assert.strictEqual(admission.admissions, (await import('../src/scheduling/admission.mjs')).admissions);
    const directState = temporaryDirectory('rigger-relay-direct-');
    await moduleOver(directState).read();
    assert.equal(captures.has(directState), false, 'direct admission imports stay canonical');
    const { spawnSync } = await import('node:child_process');
    assert.throws(() => spawnSync('/bin/echo', ['observer guard tripwire']), /deterministic tier.*cannot start/, 'normal suite guard still refuses a non-git\/tar start');
  });
  assert.equal(released.size, 0, 'successful invocation releases captures');
  assert.throws(() => expiredMake(handles({ cards: [] })), /observation has ended/, 'expired invocation state is released');
  const sentinel = new Error('observer callback refusal');
  let refused;
  await assert.rejects(withObservedAdmission(async (_make, captures) => { refused = captures; captures.set('test-owned sentinel', {}); throw sentinel; }), (failure) => failure === sentinel);
  assert.equal(refused.size, 0, 'failed invocation releases captures');
  await withObservedAdmission(async (_make, captures) => { assert.notStrictEqual(captures, released); assert.equal(captures.size, 0, 'next invocation starts empty'); });
  assert.ok(registrations.every(({ deregistered }) => deregistered), 'every installed hook is deregistered');
});

