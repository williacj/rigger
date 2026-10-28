// ABOUTME: Tests L2's notice function for a hold's closer on an in-memory forge: which issue it picks,
// comments on or opens, each rename it answers for L3 to make, its placing in Owner, and notice.failed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FIXED_LABELS } from '../src/config/validate.mjs';
import { statusNotice, holdOf } from '../src/workflow/status-issue.mjs';
import { recordingSink } from './admission-world.mjs';
import { forge } from './notice-forge.mjs';

const STATUS = FIXED_LABELS.status;

/** The columns the notice places by, as a config declares them. */
const COLUMNS = { ready: 'Ready', coding: 'Coding', review: 'Review', owner: 'Owner', done: 'Done' };

/** A notice function over `world`, recording its events through a sink of its own. */
function noticeOver(world) {
  const { sink, events } = recordingSink();
  const notice = statusNotice({ reads: world.reads, writes: world.writes, board: world.board, items: world.items, columns: COLUMNS, sink });
  return { notice, events };
}

/**
 * Drives one notice call as L3 does: makes each rename it answers on `name`, the closer's name,
 * unless `gone` says the closer is gone at that rename, handing back the outcome before the next
 * step. Answers the names the closer took, the outcome each rename handed back, what the call
 * answered at its end, and whether L3 ended it.
 */
async function drive(steps, name, { gone = () => false } = {}) {
  const names = [name];
  const handed = [];
  for (let step = await steps.next(); ;) {
    if (step.done) return { names, handed, value: step.value };
    if (gone(step.value)) {
      await steps.return();
      return { names, handed, ended: true };
    }
    const renamed = `${names.at(-1).replace(/(-(after|issue)-[0-9]+)?\.json$/, '')}-${step.value.rename}-${step.value.number}.json`;
    names.push(renamed);
    const outcome = { status: 'fulfilled', value: { name: renamed } };
    handed.push(outcome);
    step = await steps.next(outcome);
  }
}

/** The closer of hold `id`, as admission reads it, under `name`. */
const closerOf = (id, name = `hold-${id}.json`, reason = `card #9 was held after two failures the same way (${id})`) => {
  const [, after, issue] = /-(?:after-([0-9]+)|issue-([0-9]+))\.json$/.exec(name) ?? [];
  return { name, kind: 'hold', id, ...(after && { after }), ...(issue && { issue }), reason, time: 1, run: 'r-1' };
};

/** L2's hold answer for card #9. */
const HOLD = { action: 'hold', card: 9, firstFailure: { class: 'environment', step: 'install', reason: 'x' }, failure: { class: 'environment', step: 'install', reason: 'x' } };

// proves R-SCHED-7, R-SCHED-20
test('with no open issue carrying the status label, L2 answers after the newest number, opens the issue in one request, answers its number, and places it in Owner', async () => {
  const world = forge({ issues: [{ number: 99, title: 'Card', body: '', labels: ['type:change'] }], pulls: [100] });
  const { notice } = noticeOver(world);

  const ran = await drive(notice({ closer: closerOf('a1'), others: [], hold: HOLD, admission: '/s/.rigger/admission' }), 'hold-a1.json');

  assert.deepEqual(ran.names, ['hold-a1.json', 'hold-a1-after-100.json', 'hold-a1-issue-101.json']);
  assert.deepEqual(ran.value, { issue: 101 });
  const opens = world.calls.filter(([name]) => name === 'openIssue');
  assert.equal(opens.length, 1);
  const [[, title, body, label]] = opens;
  assert.equal(title, 'Rigger closed admission');
  assert.equal(label, STATUS);
  assert.equal(holdOf(body), 'a1');
  assert.deepEqual(world.onBoard, [{ id: 'item-101', number: 101, column: 'Owner' }]);
});

// proves R-SCHED-25
test('an open labelled issue another hold\'s closer names is read by its number and picked: the closer is renamed to it, then one comment names the reason, the card and the hold\'s id', async () => {
  const world = forge({ issues: [{ number: 40, title: 'Rigger closed admission', body: 'Hold: `z9`', labels: [STATUS], comments: [] }], items: [{ id: 'item-40', number: 40, column: 'Owner' }] });
  const { notice } = noticeOver(world);
  const closer = closerOf('a1');

  const ran = await drive(notice({ closer, others: [40], hold: HOLD, admission: '/s' }), 'hold-a1.json');

  assert.deepEqual(ran.names, ['hold-a1.json', 'hold-a1-issue-40.json']);
  assert.deepEqual(ran.value, { issue: 40 });
  assert.deepEqual(world.calls.filter(([name]) => !['readItems'].includes(name)).map(([name, first]) => [name, typeof first === 'string' && first.length > 40 ? 'text' : first]), [
    ['readIssue', 40],
    ['postIssueComment', 40],
  ]);
  const [comment] = world.issues[0].comments;
  for (const named of [closer.reason, '#9', 'Hold: `a1`']) assert.ok(comment.includes(named), comment);
  assert.equal(world.calls.filter(([name]) => name === 'openIssue').length, 0);
});

// proves R-SCHED-20, R-SCHED-25
test('with two open labelled issues and none named, L2 reads them by label, comments on exactly one, and opens none', async () => {
  const world = forge({ issues: [
    { number: 12, title: 'Rigger closed admission', body: '', labels: [STATUS], comments: [] },
    { number: 31, title: 'Rigger closed admission', body: '', labels: ['type:change', STATUS], comments: [] },
  ] });
  const { notice } = noticeOver(world);

  const ran = await drive(notice({ closer: closerOf('a1'), others: [], hold: HOLD, admission: '/s' }), 'hold-a1.json');

  assert.deepEqual(ran.names, ['hold-a1.json', 'hold-a1-issue-12.json']);
  assert.deepEqual(world.calls.filter(([name]) => name === 'readLabelledIssues'), [['readLabelledIssues', STATUS]]);
  assert.deepEqual(world.issues.map(({ comments }) => comments.length), [1, 0]);
  assert.equal(world.calls.filter(([name]) => name === 'openIssue').length, 0);
});

// proves R-SCHED-20
test('an issue another closer names that is now closed, unlabelled, or deleted or transferred is not picked: one found by label is, or else one is opened', async () => {
  const named = [
    { number: 40, title: 'T', body: '', state: 'closed', labels: [STATUS], comments: [] },
    { number: 41, title: 'T', body: '', labels: ['type:change'], comments: [] },
  ];
  const found = forge({ issues: [...structuredClone(named), { number: 50, title: 'T', body: '', labels: [STATUS], comments: [] }] });
  const opened = forge({ issues: structuredClone(named) });

  const byLabel = await drive(noticeOver(found).notice({ closer: closerOf('a1'), others: [40, 41, 42], hold: HOLD }), 'hold-a1.json');
  const anew = await drive(noticeOver(opened).notice({ closer: closerOf('a1'), others: [40, 41, 42], hold: HOLD }), 'hold-a1.json');

  assert.deepEqual(byLabel.names, ['hold-a1.json', 'hold-a1-issue-50.json']);
  assert.deepEqual(found.calls.filter(([name]) => name === 'readIssue').map(([, number]) => number), [40, 41, 42]);
  assert.deepEqual(anew.names, ['hold-a1.json', 'hold-a1-after-41.json', 'hold-a1-issue-42.json']);
  assert.deepEqual([...found.issues, ...opened.issues].filter(({ number }) => [40, 41].includes(number)).map(({ comments }) => comments.length), [0, 0, 0, 0]);
});

// proves R-SCHED-20
test('the picked issue not on the board is added and moved to Owner; one in another column is moved to Owner', async () => {
  const absent = forge({ issues: [{ number: 12, title: 'T', body: '', labels: [STATUS], comments: [] }] });
  const elsewhere = forge({ issues: [{ number: 12, title: 'T', body: '', labels: [STATUS], comments: [] }], items: [{ id: 'item-x', number: 12, column: 'Review' }] });

  await drive(noticeOver(absent).notice({ closer: closerOf('a1'), others: [], hold: HOLD }), 'hold-a1.json');
  await drive(noticeOver(elsewhere).notice({ closer: closerOf('a1'), others: [], hold: HOLD }), 'hold-a1.json');

  assert.deepEqual(absent.calls.filter(([name]) => ['addIssue', 'moveItem'].includes(name)), [['addIssue', 12], ['moveItem', 'item-12', 'Owner']]);
  assert.deepEqual(elsewhere.calls.filter(([name]) => ['addIssue', 'moveItem'].includes(name)), [['moveItem', 'item-x', 'Owner']]);
});

/**
 * Each refused step of a notice call: the call refused, the forge it is refused on, the names the
 * closer then took, the step `notice.failed` names, and every write the call sent, in order, the
 * refused one among them where it is a write.
 */
const REFUSALS = [
  ['readIssue', { issues: [] }, [40], ['hold-a1.json'], 'read issue #40', []],
  ['readLabelledIssues', { issues: [] }, [], ['hold-a1.json'], 'read the open issues labelled rigger:status', []],
  ['readNewestNumber', { issues: [] }, [], ['hold-a1.json'], 'read the newest number', []],
  ['openIssue', { issues: [] }, [], ['hold-a1.json', 'hold-a1-after-0.json'], 'open the status issue', ['openIssue']],
  ['postIssueComment', { issues: [{ number: 12, title: 'T', body: '', labels: [STATUS], comments: [] }] }, [], ['hold-a1.json', 'hold-a1-issue-12.json'], 'comment on issue #12', ['postIssueComment']],
  ['readItems', { issues: [] }, [], ['hold-a1.json', 'hold-a1-after-0.json', 'hold-a1-issue-1.json'], 'read the board', ['openIssue']],
  ['addIssue', { issues: [] }, [], ['hold-a1.json', 'hold-a1-after-0.json', 'hold-a1-issue-1.json'], 'add issue #1 to the board', ['openIssue', 'addIssue']],
  ['moveItem', { issues: [] }, [], ['hold-a1.json', 'hold-a1-after-0.json', 'hold-a1-issue-1.json'], 'move issue #1 to Owner', ['openIssue', 'addIssue', 'moveItem']],
];

/** The calls of the in-memory forge that write to it. */
const WRITES = ['openIssue', 'postIssueComment', 'addIssue', 'moveItem'];

/** What the forge holds of its issues, the fields a notice's write can change, so two pictures are equal only where no write landed. */
const issuesOf = (world) => world.issues.map(({ number, title, labels, comments = [] }) => ({ number, title, labels, comments }));

// proves R-SCHED-20
test('each refused or timed-out step ends the call, records one notice.failed naming the step and the cause, leaves the closer at the name it reached, and sends no write beyond those before it', async () => {
  for (const [refused, given, others, names, step, writes] of REFUSALS) {
    const world = forge({ ...structuredClone(given), refuse: { [refused]: `gh: ${refused} timed out` } });
    const before = issuesOf(world);
    const { notice, events } = noticeOver(world);

    const ran = await drive(notice({ closer: closerOf('a1'), others, hold: HOLD }), 'hold-a1.json');

    assert.deepEqual(ran.names, names, refused);
    assert.deepEqual(ran.value, { failed: { step, cause: `gh: ${refused} timed out` } }, refused);
    assert.deepEqual(events, [{ layer: 'L2', event: 'notice.failed', hold: 'a1', step, cause: `gh: ${refused} timed out` }], refused);
    assert.equal(world.calls.at(-1)[0], refused, `${refused} was not the call's last`);
    assert.deepEqual(world.calls.filter(([name]) => WRITES.includes(name)).map(([name]) => name), writes, refused);
    // Only an opening the forge took changes its issues, and only a board add its board.
    const opened = writes.includes('openIssue') && refused !== 'openIssue';
    assert.deepEqual(issuesOf(world), [...before, ...(opened ? [{ number: 1, title: 'Rigger closed admission', labels: [STATUS], comments: [] }] : [])], refused);
    assert.deepEqual(world.onBoard, refused === 'moveItem' ? [{ id: 'item-1', number: 1, column: null }] : [], refused);
  }
});

// proves R-SCHED-20
test('a rename L3 hands back as failed ends the call before L2 writes again, naming the rename in notice.failed', async () => {
  const world = forge();
  const { notice, events } = noticeOver(world);
  const steps = notice({ closer: closerOf('a1'), others: [], hold: HOLD });

  const first = await steps.next();
  const ended = await steps.next({ status: 'rejected', reason: new Error('EACCES') });

  assert.deepEqual(first.value, { rename: 'after', number: 0 });
  assert.deepEqual(ended, { done: true, value: { failed: { step: 'rename the closer', cause: 'EACCES' } } });
  assert.deepEqual(world.calls.filter(([name]) => WRITES.includes(name)), []);
  assert.deepEqual([world.issues, world.onBoard], [[], []]);
  assert.deepEqual(events.map(({ event, step }) => [event, step]), [['notice.failed', 'rename the closer']]);
});

// proves R-SCHED-20
test('the after scan reads each number above k up to the newest, passes over a pull request\'s, and attaches the issue whose body names the hold\'s id by a writer, opening no second issue', async () => {
  const world = forge({ issues: [{ number: 102, title: 'Rigger closed admission', body: 'x\n\nHold: `a1`\n', author: 'rigger-bot', labels: [STATUS], comments: [] }], pulls: [101] });
  const { notice } = noticeOver(world);

  const ran = await drive(notice({ closer: closerOf('a1', 'hold-a1-after-100.json'), others: [] }), 'hold-a1-after-100.json');

  assert.deepEqual(ran.names, ['hold-a1-after-100.json', 'hold-a1-issue-102.json']);
  assert.deepEqual(ran.value, { issue: 102 });
  assert.deepEqual(world.calls.filter(([name]) => name.startsWith('read') && name !== 'readItems'), [['readNewestNumber'], ['readIssue', 101], ['readIssue', 102], ['readPermission', 'rigger-bot']]);
  assert.equal(world.calls.filter(([name]) => ['openIssue', 'postIssueComment'].includes(name)).length, 0);
  assert.deepEqual(world.onBoard, [{ id: 'item-102', number: 102, column: 'Owner' }]);
});

// proves R-SCHED-20
test('the after scan answers none for a deleted author or a reader\'s issue, passes over a deleted number, and then runs the hold\'s steps again', async () => {
  const world = forge({
    issues: [
      { number: 102, title: 'T', body: 'Hold: `a1`', author: null, state: 'closed', labels: [], comments: [] },
      { number: 103, title: 'T', body: 'Hold: `a1`', author: 'someone', state: 'closed', labels: [], comments: [] },
      { number: 104, title: 'T', body: 'Hold: `b2`', author: 'rigger-bot', state: 'closed', labels: [], comments: [] },
    ],
    pulls: [105],
    permissions: { someone: 'read' },
  });
  const { notice } = noticeOver(world);

  const ran = await drive(notice({ closer: closerOf('a1', 'hold-a1-after-100.json'), others: [] }), 'hold-a1-after-100.json');

  assert.deepEqual(world.calls.filter(([name]) => name === 'readIssue').map(([, number]) => number), [101, 102, 103, 104, 105]);
  assert.deepEqual(world.calls.filter(([name]) => name === 'readPermission'), [['readPermission', 'someone']]);
  assert.deepEqual(ran.names, ['hold-a1-after-100.json', 'hold-a1-after-105.json', 'hold-a1-issue-106.json']);
  assert.equal(world.calls.filter(([name]) => name === 'openIssue').length, 1);
});

// proves R-SCHED-20
test('only the after scan reads a permission: a hold\'s first call, picking or opening, reads none', async () => {
  const picked = forge({ issues: [{ number: 12, title: 'T', body: 'Hold: `z9`', labels: [STATUS], comments: [] }] });
  const opened = forge();

  await drive(noticeOver(picked).notice({ closer: closerOf('a1'), others: [12], hold: HOLD }), 'hold-a1.json');
  await drive(noticeOver(opened).notice({ closer: closerOf('a1'), others: [], hold: HOLD }), 'hold-a1.json');

  assert.deepEqual([...picked.calls, ...opened.calls].filter(([name]) => name === 'readPermission'), []);
});

/**
 * The failure a forge write side rejects with where the forge took the write and only an event of
 * it was refused: `refused` in `src/substrate/process.mjs` builds its message, `code`, `unrecorded`
 * and `result`, and `written` in `src/substrate/forge/write-made.mjs` adds `made`, holding the
 * side's parsed `answer`. Where `answer` is omitted, the failure carries no `made`, as one whose
 * result the side's check refused does.
 */
function sinkRefused(name, made) {
  const unrecorded = [{ event: 'call.end', command: 'gh', exit: 0, cause: new Error('EIO') }];
  const failure = Object.assign(new Error(`the sink refused 1 L0 event(s), so they went unrecorded:\ncall.end {"command":"gh","exit":0}: EIO (${name})`), {
    code: 'EVENT_REFUSED',
    unrecorded,
    result: { exit: 0, timedOut: false, stdout: '', stderr: '' },
  });
  return made === undefined ? failure : Object.assign(failure, { made });
}

/**
 * `world` with its write `name` taken by the forge and then rejected with `failure`, as a write side
 * rejects a write whose event the sink refused.
 */
function takenThenRejected(world, name, failure) {
  const side = name in world.writes ? 'writes' : 'items';
  const take = world[side][name];
  return { ...world, [side]: { ...world[side], [name]: async (...args) => { await take(...args); throw failure; } } };
}

/** Each write step's made answer, as its side's check parses it, `moveItem`'s `undefined` among them. */
const ANSWERS = { openIssue: 1, postIssueComment: { id: 'IC_1', body: 'x' }, addIssue: 'item-1', moveItem: undefined };

test('a write step the forge made, whose event the sink refused, records nothing, ends the call there, and returns its step, cause, made mark and unrecorded events under failed', async () => {
  for (const [name, given, others, names, step, writes] of REFUSALS.filter(([refused]) => WRITES.includes(refused))) {
    const world = forge(structuredClone(given));
    const failure = sinkRefused(name, { answer: ANSWERS[name] });
    const { notice, events } = noticeOver(takenThenRejected(world, name, failure));

    const ran = await drive(notice({ closer: closerOf('a1'), others, hold: HOLD }), 'hold-a1.json');

    assert.deepEqual(events, [], name);
    assert.deepEqual(ran.value, { failed: { step, cause: failure.message, made: { answer: ANSWERS[name] }, unrecorded: failure.unrecorded } }, name);
    assert.deepEqual(ran.names, names, name);
    assert.equal(world.calls.at(-1)[0], name, `${name} was not the call's last`);
    assert.deepEqual(world.calls.filter(([called]) => WRITES.includes(called)).map(([called]) => called), writes, name);
  }
});

test('an opening the forge made, whose event the sink refused, leaves the closer at its after-name, and the next call\'s after scan attaches the opened issue and opens no second', async () => {
  const world = forge();
  const failure = sinkRefused('openIssue', { answer: 1 });

  const first = await drive(noticeOver(takenThenRejected(world, 'openIssue', failure)).notice({ closer: closerOf('a1'), others: [], hold: HOLD }), 'hold-a1.json');
  const opened = world.calls.length;
  const { notice, events } = noticeOver(world);
  const next = await drive(notice({ closer: closerOf('a1', 'hold-a1-after-0.json'), others: [], hold: HOLD }), 'hold-a1-after-0.json');

  assert.deepEqual(first.names, ['hold-a1.json', 'hold-a1-after-0.json']);
  assert.deepEqual(first.value, { failed: { step: 'open the status issue', cause: failure.message, made: { answer: 1 }, unrecorded: failure.unrecorded } });
  assert.deepEqual(next.names, ['hold-a1-after-0.json', 'hold-a1-issue-1.json']);
  assert.deepEqual(next.value, { issue: 1 });
  assert.deepEqual(world.calls.slice(opened).filter(([name]) => name === 'openIssue'), []);
  assert.deepEqual(events, []);
});

test('a write step rejected with no made mark, a refused event whose result exited 0 among them, records one notice.failed and returns its step and cause alone, as before', async () => {
  for (const [name, given, others, names, step] of REFUSALS.filter(([refused]) => WRITES.includes(refused))) {
    const world = forge(structuredClone(given));
    const failure = sinkRefused(name);
    const { notice, events } = noticeOver(takenThenRejected(world, name, failure));

    const ran = await drive(notice({ closer: closerOf('a1'), others, hold: HOLD }), 'hold-a1.json');

    assert.deepEqual(ran.value, { failed: { step, cause: failure.message } }, name);
    assert.deepEqual(events, [{ layer: 'L2', event: 'notice.failed', hold: 'a1', step, cause: failure.message }], name);
    assert.deepEqual(ran.names, names, name);
  }
});
