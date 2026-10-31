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

// proves R-SCHED-23
test('a state read, or a later read of the trigger, that throws a value no template can print is still reported with a printable cause, beside the trigger\'s earlier made opening', async () => {
  const hostile = new Proxy({}, Object.fromEntries(['get', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf'].map((name) => [name, () => { throw new Error(`the proxy refused ${name}`); }])));
  const { board } = stateBoard([], { 12: 'closed', 14: Symbol('unreadable') });
  board.readIssueState = async (number) => {
    if (number === 14) throw Symbol('unreadable');
    return { state: 'closed' };
  };
  board.readColumns = async () => { throw hostile; };
  const handed = handles({ cards: [], board, notice: followingNotice({ 12: { issue: 12, closed: true } }) });
  refusingEvents(handed, ['admission.open']);
  for (const name of ['hold-a1-issue-12.json', 'hold-b2-issue-14.json']) seed(handed.state, name);

  const outcome = await loop(handed).pull().then((value) => ({ value }), (error) => ({ error }));

  const reported = messagesOf(outcome.error).join('; ');
  assert.match(reported, /EIO while recording admission\.open/);
  assert.match(reported, /the notice for hold b2 failed to read issue #14's state: Symbol\(unreadable\)/);
  assert.match(reported, /a thrown object/);
  assert.ok(outcome.error.errors.every((each) => each instanceof Error), 'every failure the caller is handed is an Error it can read');
});

/** Each hostile value a thrower or an answer can hand L3, by name (round 7 on #1079). */
const HOSTILE = () => {
  const cyclic = new Error('cyclic');
  cyclic.cause = cyclic;
  return {
    undefined,
    null: null,
    'a Symbol': Symbol('hostile'),
    'an Error': new Error('a plain failure'),
    'an Error whose message getter throws': Object.defineProperty(new Error('x'), 'message', { get() { throw new Error('message getter refused'); } }),
    'an Error whose message is a Symbol': Object.defineProperty(new Error('x'), 'message', { value: Symbol('symbol message') }),
    'a Proxy throwing on every trap': new Proxy({}, Object.fromEntries(['get', 'set', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'defineProperty', 'deleteProperty', 'isExtensible', 'preventExtensions', 'setPrototypeOf'].map((name) => [name, () => { throw new Error(`the proxy refused ${name}`); }]))),
    'a frozen object': Object.freeze({ reason: 'frozen' }),
    'an Error whose cause is itself': cyclic,
  };
};

/** Whether every failure `error` holds, through its errors and causes, is an Error whose message reads as a string. */
const readable = (error, seen = new Set()) => {
  if (seen.has(error)) return true;
  seen.add(error);
  if (!(error instanceof Error) || typeof error.message !== 'string') return false;
  return (error.errors ?? []).every((each) => readable(each, seen)) && (error.cause === undefined || readable(error.cause, seen));
};

// proves R-SCHED-23
test('a state read that rejects with any value, undefined among them, or answers no state, is unreadable: the closer stays, L2 is handed nothing, and notice.failed names the issue', async () => {
  // The reviewer's and the architect's round-7 B1 probe on #1079, over every hostile value.
  const STATUS = 'rigger:status';
  const rejections = Object.entries(HOSTILE()).map(([what, value]) => [`rejects with ${what}`, () => Promise.reject(value)]);
  const answers = [['answers undefined', undefined], ['answers an empty object', {}], ['answers a state it does not name', { state: 'bogus' }], ['answers a Proxy', HOSTILE()['a Proxy throwing on every trap']]]
    .map(([what, value]) => [what, async () => value]);
  for (const [what, read] of [...rejections, ...answers]) {
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
test('every failure the pull hands its caller after a made opening and a later read that throws any value is a fresh Error whose message reads, the opening\'s refused record among them', async () => {
  // The reviewer's and the architect's round-7 B2 probe on #1079, over every hostile value.
  for (const [what, value] of Object.entries(HOSTILE())) {
    const { board } = stateBoard([], { 12: 'closed' });
    board.readColumns = async () => { throw value; };
    const handed = handles({ cards: [], board, notice: followingNotice({ 12: { issue: 12, closed: true } }) });
    refusingEvents(handed, ['admission.open']);
    seed(handed.state, 'hold-a1-issue-12.json');

    const outcome = await loop(handed).pull().then((answer) => ({ answer }), (error) => ({ error }));

    assert.deepEqual(namesIn(handed.state), [], what);
    assert.ok(readable(outcome.error), `${what}: a failure handed on cannot be read`);
    for (const each of outcome.error.errors) assert.notEqual(each, value, `${what}: the original thrown value was handed on`);
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

for (const [what, unrecorded] of Object.entries({ 'no unrecorded events': undefined, 'a Symbol event': [{ event: Symbol('event') }], 'a string in place of a list': 'call.end' })) {
  test(`a made comment on the follow path whose failure carries ${what} is answered in notices that once's notice line can print`, async () => {
    const world = forge({ issues: [{ number: 12, title: 'Rigger closed admission', body: 'Hold: `z9`', author: 'rigger-bot', labels: ['rigger:status'], comments: [] }] });
    const { board } = stateBoard([], { 12: 'open' });
    const handed = handles({ cards: [], board });
    handed.l2.notice = changesOver(world, handed.sink).notice;
    const comment = world.writes.postIssueComment;
    world.writes.postIssueComment = async (...args) => {
      await comment(...args);
      throw Object.assign(new Error('call.end went unrecorded'), { code: 'EVENT_REFUSED', made: { answer: { id: 1 } }, unrecorded });
    };
    seed(handed.state, 'hold-a1-issue-12.json');

    const pulled = await loop(handed).pull();

    assert.equal(pulled.admission.state, 'closed');
    const lines = pulled.notices.map((failed) => noticeLine('once', failed.id, failed));
    assert.equal(lines.length, 1, what);
    assert.match(lines[0], /made its step to comment on issue #12/, what);
  });
}

// proves R-SCHED-23
test('after a made opening whose record was accepted, a later read rejecting with undefined has the pull reject with a readable Error', async () => {
  const { board } = stateBoard([], { 12: 'closed' });
  board.readColumns = async () => { throw undefined; };
  const handed = handles({ cards: [], board, notice: closedNotice() });
  seed(handed.state, 'hold-a1-issue-12.json');

  const outcome = await loop(handed).pull().then((answer) => ({ answer }), (error) => ({ error }));

  assert.deepEqual(namesIn(handed.state), []);
  assert.ok(readable(outcome.error), `the pull rejected with ${String(outcome.error)}`);
  assert.deepEqual(readEvents(handed.state).filter(({ event }) => event === 'admission.open').map(({ name, by }) => ({ name, by })), [{ name: 'hold-a1-issue-12.json', by: 'issue' }]);
});

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

/** An Error carrying `props`, as `Object.defineProperties` defines them. */
const errorWith = (props) => Object.defineProperties(new Error('EIO readable'), props);

/** Errors that read as Errors with a string message, yet throw where a presenter reads further. */
const READABLE_HOSTILE = {
  'an AggregateError of undefined and null': () => new AggregateError([undefined, null], 'two bad'),
  'an Error whose reached getter throws': () => errorWith({ reached: { get() { throw new Error('reached getter'); } } }),
  'an Error whose unreadable getter throws': () => errorWith({ unreadable: { get() { throw new Error('unreadable getter'); } } }),
  'an Error whose attemptFailures getter throws': () => errorWith({ attemptFailures: { get() { throw new Error('attemptFailures getter'); } } }),
  'a Proxy over an Error answering message and throwing for everything else': () => new Proxy(new Error('m'), { get(target, key) { if (key === 'message') return 'm'; throw new Error(`trap ${String(key)}`); } }),
  'an Error whose message reads once, then throws': () => { let reads = 0; return errorWith({ message: { get() { reads += 1; if (reads > 1) throw new Error('second read'); return 'first'; } } }); },
  'an Error whose unreadable holds null': () => Object.assign(new Error('gh: HTTP 502'), { unreadable: [null] }),
};

for (const [what, value] of Object.entries(READABLE_HOSTILE)) {
  test(`a later read rejecting with ${what} is handed on in a form once's catch reads without throwing`, async () => {
    const { board } = stateBoard([], {});
    board.readColumns = async () => { throw value(); };
    const handed = handles({ cards: [], board });

    const outcome = await loop(handed).pull().then((answer) => ({ answer }), (error) => ({ error }));

    assert.doesNotThrow(() => onceReads(outcome.error), what);
  });
}

/** A Proxy throwing on every read of it, as an L2 answer's `failed` can be. */
const hostileFailed = () => new Proxy({}, { get() { throw new Error('failed trap'); }, ownKeys() { throw new Error('failed keys'); }, getOwnPropertyDescriptor() { throw new Error('failed descriptor'); } });

// proves R-SCHED-23
test('a refused opening record stays reported when another closer\'s notice answers a failed that cannot be read, on the follow path and on the trigger\'s', async () => {
  for (const [what, other] of [['naming an issue', 'hold-b2-issue-13.json'], ['naming none', 'hold-c3.json']]) {
    const { board } = stateBoard([], { 12: 'closed', 13: 'open' });
    const handed = handles({ cards: [], board, notice: async function* answering({ closer }) { return closer.issue === '12' ? { issue: 12, closed: true } : { failed: hostileFailed() }; } });
    refusingEvents(handed, ['admission.open']);
    seed(handed.state, 'hold-a1-issue-12.json');
    seed(handed.state, other);

    const outcome = await loop(handed).pull().then((answer) => ({ answer }), (error) => ({ error }));

    const said = outcome.error === undefined ? JSON.stringify(outcome.answer?.notices) : safeMessages(outcome.error).join(' | ');
    assert.match(said, /EIO while recording admission\.open/, `${what}: ${said}`);
    assert.doesNotThrow(() => onceReads(outcome.error ?? new Error('none')), what);
  }
});

// proves R-SCHED-23
test('a refused opening record stays reported when a later notice answers a failed that reads undefined once and throws the next time', async () => {
  // The architect's round-8 B2 probe on #1079: no field of L2's answer is read twice.
  const { board } = stateBoard([], { 12: 'closed', 13: 'open' });
  let reads = 0;
  const answer = Object.defineProperty({ issue: 13 }, 'failed', { get() {
    reads += 1;
    if (reads === 1) return undefined;
    throw new Error('failed getter read twice');
  } });
  const handed = handles({ cards: [], board, notice: async function* answering({ closer }) { return closer.issue === '12' ? { issue: 12, closed: true } : answer; } });
  refusingEvents(handed, ['admission.open']);
  seed(handed.state, 'hold-a1-issue-12.json');
  seed(handed.state, 'hold-b2-issue-13.json');

  const outcome = await loop(handed).pull().then((answered) => ({ answered }), (error) => ({ error }));

  assert.deepEqual(namesIn(handed.state), ['hold-b2-issue-13.json']);
  assert.equal(reads, 1, 'a field of L2\'s answer was read twice');
  assert.match(safeMessages(outcome.error).join(' | '), /EIO while recording admission\.open/);
});

// proves R-SCHED-23
test('a refused opening record stays reported when a later notice\'s answer carries an unrecorded getter that throws, and when a later read throws an AggregateError with an accessor entry', async () => {
  // The reviewer's two exploratory round-8 probes on #1079.
  {
    const { board } = stateBoard([], { 12: 'closed', 13: 'open' });
    const answer = Object.defineProperty({ issue: 13 }, 'unrecorded', { get() { throw new Error('unrecorded getter refused'); } });
    const handed = handles({ cards: [], board, notice: async function* answering({ closer }) { return closer.issue === '12' ? { issue: 12, closed: true } : answer; } });
    refusingEvents(handed, ['admission.open']);
    seed(handed.state, 'hold-a1-issue-12.json');
    seed(handed.state, 'hold-b2-issue-13.json');
    const outcome = await loop(handed).pull().then((answered) => ({ answered }), (error) => ({ error }));
    assert.match(safeMessages(outcome.error).join(' | '), /EIO while recording admission\.open/);
  }
  {
    const { board } = stateBoard([], { 12: 'closed' });
    let reads = 0;
    const errors = Object.defineProperty([], '0', { enumerable: true, configurable: true, get() { reads += 1; return reads === 1 ? new Error('HTTP 502') : undefined; } });
    board.readColumns = async () => { const failure = new AggregateError([], 'facts could not be read'); failure.errors = errors; throw failure; };
    const handed = handles({ cards: [], board, notice: closedNotice() });
    seed(handed.state, 'hold-a1-issue-12.json');
    const outcome = await loop(handed).pull().then((answered) => ({ answered }), (error) => ({ error }));
    assert.doesNotThrow(() => onceReads(outcome.error));
    assert.match(safeMessages(outcome.error).join(' | '), /HTTP 502/);
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

// proves R-SCHED-23
test('a list that claims a length L3 cannot read is said so, never dropped silently: in unreadable entries, failures and refused records', async () => {
  const lying = () => new Proxy([], { get(target, key) { return key === 'length' ? Number.MAX_SAFE_INTEGER + 2 : target[key]; } });
  for (const [what, thrown] of [
    ['unreadable entries', () => Object.assign(new Error('board refused'), { unreadable: lying() })],
    ['an aggregate\'s failures', () => { const failure = new AggregateError([], 'board refused'); Object.defineProperty(failure, 'errors', { value: lying() }); return failure; }],
  ]) {
    const { board } = stateBoard([], {});
    board.readColumns = async () => { throw thrown(); };
    const handed = handles({ cards: [], board });
    const failure = await loop(handed).pull().then(() => assert.fail('accepted'), (error) => error);
    assert.match(onceReads(failure), /L3 could not read, as the list claimed a length of 900719925474099\d/, what);
  }
  const world = forge({ issues: [{ number: 12, title: 'Rigger closed admission', body: 'Hold: `z9`', author: 'rigger-bot', labels: ['rigger:status'], comments: [] }] });
  const { board } = stateBoard([], { 12: 'open' });
  const handed = handles({ cards: [], board });
  handed.l2.notice = changesOver(world, handed.sink).notice;
  const original = world.writes.postIssueComment;
  world.writes.postIssueComment = async (...args) => {
    await original(...args);
    throw Object.assign(new Error('records refused'), { code: 'EVENT_REFUSED', made: { answer: { id: 1 } }, unrecorded: lying() });
  };
  seed(handed.state, 'hold-a1-issue-12.json');
  const pulled = await loop(handed).pull();
  assert.match(noticeLine('once', pulled.notices[0].id, pulled.notices[0]), /L3 could not read, as the list claimed a length of 900719925474099\d/);
});


// The reviewer's round-10 probe on #1079: a value met on two paths of one snapshot is read once.

/**
 * An Error whose every field is counted as it is read, its message answering `first` on the first
 * read and something else after, and `reads`, the count of reads of each field.
 */
function countedLeaf(first = 'HTTP 502') {
  const reads = {};
  const leaf = new Proxy(new Error(first), {
    get(target, key, receiver) {
      reads[key] = (reads[key] ?? 0) + 1;
      if (key === 'message') return reads[key] === 1 ? first : 'original failure lost on reread';
      return Reflect.get(target, key, receiver);
    },
  });
  return { leaf, reads };
}

/** The trees, each built over `leaf`, in which `leaf` is met on more than one path. */
const SHARED_TREES = {
  'as the cause and an errors entry': (leaf) => new AggregateError([leaf], 'facts could not be read', { cause: leaf }),
  'as two errors entries': (leaf) => new AggregateError([leaf, leaf], 'facts could not be read'),
  'as a sibling and a sibling\'s cause': (leaf) => new AggregateError([new Error('wrapper', { cause: leaf }), leaf], 'facts could not be read'),
  'nested in an aggregate within an aggregate, and as the outer cause': (leaf) => new AggregateError([new AggregateError([leaf], 'inner', { cause: leaf })], 'outer', { cause: new Error('wrapper', { cause: leaf }) }),
  'as an unreadable entry\'s cause in two failures': (leaf) => new AggregateError([Object.assign(new Error('one'), { unreadable: [{ path: 'a.json', cause: leaf }] }), Object.assign(new Error('two'), { unreadable: [{ path: 'b.json', cause: leaf }] }), leaf], 'facts could not be read'),
};

for (const [what, tree] of Object.entries(SHARED_TREES)) {
  test(`a rejected read whose failure holds one Error ${what} reads each of its fields once, and once reads its first message`, async () => {
    const { leaf, reads } = countedLeaf();
    const { board } = stateBoard([], {});
    board.readColumns = async () => { throw tree(leaf); };
    const handed = handles({ cards: [], board });

    const failure = await loop(handed).pull().then(() => assert.fail('the rejection was accepted'), (error) => error);

    for (const [key, count] of Object.entries(reads)) assert.equal(count, 1, `${String(key)} was read ${count} times`);
    assert.match(onceReads(failure), /HTTP 502/);
    assert.doesNotMatch(onceReads(failure), /lost on reread/);
  });
}

// proves R-SCHED-23
test('a notice answer whose failed holds one object as its step, its cause and two of its unrecorded events reads each of that object\'s fields once', async () => {
  const { leaf, reads } = countedLeaf('EIO');
  const shared = { event: leaf };
  const { board } = stateBoard([], { 12: 'open' });
  const handed = handles({ cards: [], board, notice: followingNotice({ 12: { issue: 12, failed: { step: leaf, cause: leaf, made: { answer: { id: 1 } }, unrecorded: [shared, shared, { event: leaf }] } } }) });
  seed(handed.state, 'hold-a1-issue-12.json');

  const pulled = await loop(handed).pull();

  for (const [key, count] of Object.entries(reads)) assert.equal(count, 1, `${String(key)} was read ${count} times`);
  assert.doesNotMatch(noticeLine('once', pulled.notices[0].id, pulled.notices[0]), /lost on reread/);
});

// The judges' round-11 probes on #1079: a conversion of a foreign value, as well as a field read,
// runs once in a snapshot, whichever path of the snapshot reaches it.

/** An object whose string conversion is counted, answering `first` once and something else after. */
function countedConversion(first = 'HTTP 502 first reason') {
  const reads = { conversions: 0 };
  const value = { [Symbol.toPrimitive]() { reads.conversions += 1; return reads.conversions === 1 ? first : 'original failure lost on reread'; } };
  return { value, reads };
}

/** Lists, built over `shared`, whose `length` answers `shared`, a value no list can have as its length. */
const sharedLength = (shared) => new Proxy([], { get(target, key) { return key === 'length' ? shared : Reflect.get(target, key); } });

/** Trees in which the one changing value `shared` is reached by a conversion on more than one path. */
const CONVERTED_TREES = {
  'as the aggregate\'s message and its errors entry': (shared) => Object.defineProperty(new AggregateError([shared], 'outer'), 'message', { value: shared }),
  'as two lists\' length': (shared) => Object.assign(Object.defineProperty(new AggregateError([], 'facts failed'), 'errors', { value: sharedLength(shared) }), { unreadable: sharedLength(shared) }),
  'as an errors entry\'s message and its cause': (shared) => new AggregateError([Object.defineProperty(new Error('inner', { cause: shared }), 'message', { value: shared })], 'outer'),
  'as an unreadable path and a thrown errors entry': (shared) => Object.assign(new AggregateError([shared], 'facts failed'), { unreadable: [{ path: shared, cause: 'EIO' }] }),
};

for (const [what, tree] of Object.entries(CONVERTED_TREES)) {
  for (const [kind, make] of [['an Error whose message getter changes', () => { const { leaf, reads } = countedLeaf('HTTP 502 first reason'); return { shared: leaf, reads }; }], ['an object whose string conversion changes', () => { const { value, reads } = countedConversion(); return { shared: value, reads }; }]]) {
    test(`a rejected read whose failure holds ${kind} ${what} reads it once, and once reads its first line`, async () => {
      const { shared, reads } = make();
      const { board } = stateBoard([], {});
      board.readColumns = async () => { throw tree(shared); };
      const handed = handles({ cards: [], board });

      const failure = await loop(handed).pull().then(() => assert.fail('the rejection was accepted'), (error) => error);

      for (const [key, count] of Object.entries(reads)) assert.ok(count <= 1, `${String(key)} was read ${count} times`);
      assert.match(onceReads(failure), /HTTP 502 first reason/);
      assert.doesNotMatch(onceReads(failure), /lost on reread/);
    });
  }
}

// proves R-SCHED-23
test('a notice mark that cannot be cloned keeps the first answer it read, and its closer, step and unrecorded event stay', async () => {
  let reads = 0;
  const made = Object.defineProperties({}, {
    answer: { enumerable: true, get() { reads += 1; return reads === 1 ? 'write-confirmed' : 'original answer lost on reread'; } },
    extra: { enumerable: true, value: Symbol('not cloneable') },
  });
  const { board } = stateBoard([], { 12: 'open' });
  const handed = handles({ cards: [], board, notice: followingNotice({ 12: { issue: 12, failed: { step: 'comment on issue #12', cause: 'call.end refused', made, unrecorded: [{ event: 'call.end' }] } } }) });
  seed(handed.state, 'hold-a1-issue-12.json');

  const pulled = await loop(handed).pull();

  assert.equal(reads, 1);
  assert.equal(pulled.notices[0].made.answer, 'write-confirmed');
  assert.deepEqual(namesIn(handed.state), ['hold-a1-issue-12.json']);
  assert.match(noticeLine('once', pulled.notices[0].id, pulled.notices[0]), /made its step to comment on issue #12.*call\.end/);
});

// proves R-SCHED-23
test('a sink refusal of admission.open whose conversion changes is said as it first converted, in the failure and in its cause', async () => {
  const { value, reads } = countedConversion('EIO first refusal');
  const { board } = stateBoard([], { 12: 'closed' });
  const handed = handles({ cards: [], board, notice: closedNotice() });
  refusingWith(handed, { 'admission.open': () => ({ value }) });
  seed(handed.state, 'hold-a1-issue-12.json');

  const outcome = await loop(handed).pull().then((answer) => ({ answer }), (error) => ({ error }));

  assert.equal(reads.conversions, 1);
  assert.match(safeMessages(outcome.error).join(' | '), /EIO first refusal/);
  assert.doesNotMatch(safeMessages(outcome.error).join(' | '), /lost on reread/);
});

// The pre-judge attack of round 12 on #1079 (C1 to C5 and C8) and the one copy of each trigger's settle.

/** A notice answering, for the issue-less closer it is handed, a failed step the forge made, its mark `made`. */
const madeNotice = (made) => async function* notice() { return { failed: { step: 'comment on issue #12', cause: 'EIO record', made, unrecorded: [{ event: 'notice.comment' }] } }; };

// proves R-SCHED-23
test('a made notice mark of four keys each naming the mark itself is copied once, each key said as met again, and the pull settles at once', async () => {
  const made = {};
  for (let at = 0; at < 4; at += 1) made[`k${at}`] = made;
  const handed = handles({ cards: [], notice: madeNotice(made) });
  seed(handed.state, 'hold-c3.json');

  const pulled = await loop(handed).pull();

  assert.deepEqual(pulled.notices[0].made, { k0: 'a value met again within itself', k1: 'a value met again within itself', k2: 'a value met again within itself', k3: 'a value met again within itself' });
  assert.match(noticeLine('once', pulled.notices[0].id, pulled.notices[0]), /notice\.comment/);
});

// proves R-SCHED-23
test('a made notice mark holding a list that claims length -1 carries the line saying its entries could not be read', async () => {
  const writes = new Proxy(['comment #12'], { get(target, key) { return key === 'length' ? -1 : target[key]; } });
  const handed = handles({ cards: [], notice: madeNotice({ writes }) });
  seed(handed.state, 'hold-c3.json');

  const pulled = await loop(handed).pull();

  assert.deepEqual(pulled.notices[0].made, { writes: ['entries L3 could not read, as the list claimed a length of -1'] });
});

// proves R-SCHED-23
test('a rejected read whose failures, or whose unreadable admission entries, are a sparse list longer than L3 reads keeps the real entry at 0 and says how many it did not read', async () => {
  const length = 10_005;
  const errors = [new Error('EIO the real refusal')];
  errors.length = length;
  const unreadable = [{ path: '/x/hold-a1.json', cause: 'EACCES the real one' }];
  unreadable.length = length;
  for (const [what, thrown] of [
    ['errors', Object.defineProperty(new AggregateError([], 'two reads failed'), 'errors', { value: errors })],
    ['unreadable', Object.assign(new Error('admission cannot be read'), { unreadable })],
  ]) {
    const { board } = stateBoard([], {});
    board.readColumns = async () => { throw thrown; };
    const failure = await loop(handles({ cards: [], board })).pull().then(() => assert.fail('accepted'), (error) => error);
    const said = onceReads(failure);
    assert.match(said, what === 'errors' ? /EIO the real refusal/ : /EACCES the real one/, what);
    assert.match(said, /and 5 more entries L3 did not read, past the first 10000 of the 10005 the list held/, what);
  }
});

for (const [what, value] of Object.entries({
  'an Error whose unreadable getter throws': () => Object.defineProperty(new Error('EIO claimed'), 'unreadable', { get() { throw new Error('unreadable getter'); } }),
  'a Proxy over an Error whose getPrototypeOf throws': () => new Proxy(new Error('EIO claimed'), { getPrototypeOf() { throw new Error('proto trap'); } }),
  'an Error whose message getter throws': () => Object.defineProperty(new Error('x'), 'message', { get() { throw new Error('message getter'); } }),
})) {
  test(`a refused opening record stays presented when a claimed card's l2.claimed then rejects with ${what}`, async () => {
    const { board } = stateBoard([1], { 12: 'closed' });
    const handed = handles({ cards: [1], board, notice: closedNotice() });
    handed.l2.claimed = async () => { throw value(); };
    refusingWith(handed, { 'admission.open': () => ({ value: new Error('EIO admission.open') }) });
    seed(handed.state, 'hold-a1-issue-12.json');

    const failure = await loop(handed).pull().then(() => assert.fail('accepted'), (error) => error);

    assert.deepEqual(namesIn(handed.state), []);
    assert.match(onceReads(failure), /EIO admission\.open/);
  });
}

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

// proves R-SCHED-23
test('a cycle of causes, and a chain of causes past the depth L3 follows, are said, never thrown', async () => {
  const a = new Error('EIO a');
  const b = new Error('EIO b', { cause: a });
  a.cause = b;
  let deep = new Error('EIO bottom');
  for (let at = 0; at < 40; at += 1) deep = new Error(`EIO level ${at}`, { cause: deep });
  for (const thrown of [a, deep]) {
    const { board } = stateBoard([], {});
    board.readColumns = async () => { throw thrown; };
    const failure = await loop(handles({ cards: [], board })).pull().then(() => assert.fail('accepted'), (error) => error);
    assert.ok(messagesOf(failure).some((message) => /met again among its own causes, or nested past 16 levels/.test(message)));
  }
});

// proves R-SCHED-23
test('a trigger\'s settle is one copy: a value two cards\' answers share is one copy, read once, and is not the value L2 answered', async () => {
  let reads = 0;
  const shared = { get detail() { reads += 1; return reads === 1 ? 'first reason' : 'reason lost on reread'; } };
  const handed = handles({ cards: [1, 2], board: stateBoard([1, 2], {}).board, facts: async () => () => ({ action: 'escalate', reason: shared }) });

  const reached = await loop(handed).pull();

  assert.equal(reached.length, 2);
  assert.equal(reached[0].reason, reached[1].reason);
  assert.notEqual(reached[0].reason, shared);
  assert.deepEqual(reached[0].reason, { detail: 'first reason' });
  assert.equal(reads, 1);
});

// The pre-judge attack of round 14 on #1079 (D1, D2, D3, D5 and D6).

// proves R-SCHED-23
test('a rename ask whose read throws an Error carrying renamed, naming another hold\'s closer, is no refused rename of L3\'s: that closer stays and its hold stays closed', async () => {
  const thrown = Object.assign(new Error('L2 broke reading its own ask'), { renamed: 'hold-b2-issue-30.json' });
  const { board } = stateBoard([], { 12: 'closed', 30: 'open' });
  const handed = handles({
    cards: [],
    board,
    notice: async function* notice({ closer }) {
      if (closer.id === 'a1') {
        yield { get rename() { throw thrown; }, number: 13 };
        return { issue: 12, closed: true };
      }
      return { issue: 30 };
    },
  });
  seed(handed.state, 'hold-a1-issue-12.json');
  seed(handed.state, 'hold-b2-issue-30.json');

  await loop(handed).pull().then(() => {}, () => {});

  assert.deepEqual(namesIn(handed.state), ['hold-b2-issue-30.json']);
  assert.deepEqual(readEvents(handed.state).filter(({ event }) => event === 'admission.open').map(({ name }) => name), ['hold-a1-issue-12.json']);
});

// proves R-SCHED-23
test('what take throws, a later read failing after L2 threw from its own ask, reaches the caller as L3\'s copy, never the value L2 threw', async () => {
  const thrown = Object.assign(new Error('L2 broke reading its own ask'), { renamed: 'hold-a1-after-0.json' });
  const { board } = stateBoard([], { 12: 'closed' });
  board.readColumns = async () => { throw new Error('EIO columns'); };
  const handed = handles({ cards: [], board, notice: async function* notice() { yield { get rename() { throw thrown; }, number: 13 }; return { issue: 12 }; } });
  seed(handed.state, 'hold-a1-issue-12.json');

  const failure = await loop(handed).pull().then(() => assert.fail('accepted'), (error) => error);

  const leaves = (each) => [each, ...(Array.isArray(each.errors) ? each.errors.flatMap(leaves) : []), ...(each.cause === undefined ? [] : leaves(each.cause))];
  assert.ok(!leaves(failure).includes(thrown));
  assert.match(onceReads(failure), /EIO columns/);
});

// proves R-SCHED-23
test('a made notice mark that makes a fresh value of four keys at each read is copied within one bound, the notice stays whole, and the copy says where it stopped', async () => {
  let made = 0;
  const fresh = () => {
    made += 1;
    const value = {};
    for (let at = 0; at < 4; at += 1) Object.defineProperty(value, `k${at}`, { enumerable: true, get: fresh });
    return value;
  };
  const handed = handles({ cards: [], notice: madeNotice(fresh()) });
  seed(handed.state, 'hold-c3.json');

  const pulled = await loop(handed).pull();

  // Each of the 10,000 values the copy makes reads its four keys once, each read making one value.
  assert.ok(made <= 4 * 10_000 + 1, `the copy made ${made} values`);
  assert.match(JSON.stringify(pulled.notices[0].made), /a value L3 did not copy, past the 10000 values it copies of one value it hands on/);
});

// proves R-SCHED-23
test('one object as the made mark of two notices of one trigger is read once, and both notices carry the same copy', async () => {
  let reads = 0;
  const shared = { get f() { reads += 1; return reads === 1 ? 'first' : 'second'; } };
  const handed = handles({ cards: [], notice: madeNotice(shared) });
  seed(handed.state, 'hold-c3.json');
  seed(handed.state, 'hold-c4.json');

  const pulled = await loop(handed).pull();

  assert.equal(reads, 1);
  assert.deepEqual(pulled.notices.map((each) => each.made.f), ['first', 'first']);
});

// proves R-SCHED-23
test('a list entry L3 cannot read is said as such, in a made mark, an aggregate\'s failures and the unrecorded events', async () => {
  const refusing = (list) => new Proxy(list, { get(target, key) { if (key === '0') throw new Error('entry refused'); return target[key]; } });
  const handed = handles({ cards: [], notice: async function* notice() { return { failed: { step: 'comment on issue #12', cause: 'EIO record', made: { writes: refusing(['comment #12', 'label #12']) }, unrecorded: refusing([{ event: 'notice.comment' }, { event: 'call.end' }]) } }; } });
  seed(handed.state, 'hold-c3.json');
  const pulled = await loop(handed).pull();
  assert.deepEqual(pulled.notices[0].made.writes, ['entry 0 of the list L3 could not read', 'label #12']);
  assert.deepEqual(pulled.notices[0].unrecorded, [{ event: 'entry 0 of the list L3 could not read' }, { event: 'call.end' }]);

  const { board } = stateBoard([], {});
  board.readColumns = async () => { throw Object.defineProperty(new AggregateError([], 'reads failed'), 'errors', { value: refusing([new Error('EIO 0'), new Error('EIO 1')]) }); };
  const failure = await loop(handles({ cards: [], board })).pull().then(() => assert.fail('accepted'), (error) => error);
  assert.match(onceReads(failure), /entry 0 of the list L3 could not read[\s\S]*EIO 1/);
});

// proves R-SCHED-23
test('a made notice mark holding bytes whose own slice answers another value is copied as the bytes, through the language\'s getters', async () => {
  const foreign = { secret: 'raw' };
  const bytes = Object.assign(new Uint8Array([1, 2]), { slice: () => foreign });
  const handed = handles({ cards: [], notice: madeNotice({ bytes }) });
  seed(handed.state, 'hold-c3.json');

  const pulled = await loop(handed).pull();

  assert.notEqual(pulled.notices[0].made.bytes, foreign);
  assert.deepEqual([...pulled.notices[0].made.bytes], [1, 2]);
});
