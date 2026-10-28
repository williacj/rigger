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
