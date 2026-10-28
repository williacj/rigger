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

/** An issue Rigger opened for hold `id`, numbered `number`, carrying the status label and on the board in Owner, with `timeline` where given. */
const opened = (number, id, fields = {}) => ({ number, title: 'Rigger closed admission', body: `Why.\n\nHold: \`${id}\`\n`, author: 'rigger-bot', labels: [STATUS], comments: [], ...fields });

/** A timeline entry of `kind` by `actor`, at the time every entry here carries: their order is what counts. */
const entry = (kind, fields = {}) => ({ kind, createdAt: '2026-10-01T00:00:00Z', actor: 'rigger-bot', ...fields });

/** A comment entry naming `body`, by `author` holding `permission`, edited where `edited` says. */
const said = (body, { author = 'rigger-bot', permission = 'write', edited = false } = {}) => ({ kind: 'comment', body, createdAt: '2026-10-01T00:00:00Z', id: `IC_${body.length}`, author, permission, edited });

/** The status label applied at the issue's opening, as the timeline answers it. */
const LABELLED = entry('labeled', { label: STATUS });

/**
 * Follows hold `id`'s closer naming issue `number` on `world`, whose state L3 read as `state`, as
 * L3 does at a trigger, and answers the call's run, its events and the forge's writes by name.
 */
async function followed(world, id, number, state = 'open', others = []) {
  const { notice, events } = noticeOver(world);
  const name = `hold-${id}-issue-${number}.json`;
  const ran = await drive(notice({ closer: closerOf(id, name), others, state }), name);
  return { ...ran, events, writes: world.calls.filter(([call]) => [...WRITES, 'removeIssueLabel', 'closeIssue'].includes(call)).map(([call, first]) => [call, first]) };
}

// proves R-SCHED-23
test('a hold\'s closer naming an open issue its notice reached keeps admission closed: L2 answers the issue, still the notice, places it in Owner where it is not, and writes nothing else', async () => {
  const world = forge({ issues: [opened(12, 'a1', { timeline: [LABELLED] })], items: [{ id: 'item-12', number: 12, column: 'Review' }] });

  const ran = await followed(world, 'a1', 12);

  assert.deepEqual(ran.value, { issue: 12 });
  assert.deepEqual(ran.names, ['hold-a1-issue-12.json']);
  assert.deepEqual(ran.writes, [['moveItem', 'item-12']]);
});

// proves R-SCHED-4, R-SCHED-23
test('a close of the status issue after the hold\'s notice reached it, made while it carried the label, is the notice closed for that hold, whoever made it, even reopened since', async () => {
  // The owner, another account with write or triage access, a bot, a deleted account, a closing
  // keyword in a merged pull request (its merger's account), and a board workflow's automation.
  const closers = ['williacj', 'triager', 'dependabot[bot]', null, 'merger', 'github-project-automation[bot]'];
  for (const actor of closers) {
    for (const reopened of [false, true]) {
      const timeline = [LABELLED, entry('closed', { actor }), ...(reopened ? [entry('reopened', { actor })] : [])];
      const world = forge({ issues: [opened(12, 'a1', { state: reopened ? 'open' : 'closed', timeline })] });

      const ran = await followed(world, 'a1', 12, reopened ? 'open' : 'closed');

      assert.deepEqual(ran.value, { issue: 12, closed: true }, `${actor}, reopened ${reopened}`);
      assert.deepEqual(ran.writes, [], `${actor}, reopened ${reopened}`);
      assert.deepEqual(ran.names, ['hold-a1-issue-12.json']);
    }
  }
});

// proves R-SCHED-23
test('a close that came before the hold\'s notice reached the issue is not that hold\'s: open and labelled, it stays the notice; closed, L2 opens another and the closer is renamed to it', async () => {
  const before = [LABELLED, entry('closed', { actor: 'williacj' }), entry('reopened', { actor: 'williacj' }), said('Rigger closed admission again: x\n\nHold: `a1`\n')];
  const open = forge({ issues: [opened(12, 'z9', { timeline: before })], items: [{ id: 'item-12', number: 12, column: 'Owner' }] });
  const closed = forge({ issues: [opened(12, 'z9', { state: 'closed', timeline: [...before, entry('unlabeled', { label: STATUS }), entry('closed')] })] });

  const stays = await followed(open, 'a1', 12);
  const moves = await followed(closed, 'a1', 12, 'closed');

  assert.deepEqual(stays.value, { issue: 12 });
  assert.deepEqual(stays.writes, []);
  assert.deepEqual(moves.names, ['hold-a1-issue-12.json', 'hold-a1-after-12.json', 'hold-a1-issue-13.json']);
  assert.deepEqual(moves.value, { issue: 13 });
});

// proves R-SCHED-23
test('a close made while the issue carried the label, the label then removed, still counts for the hold', async () => {
  const world = forge({ issues: [opened(12, 'a1', { state: 'closed', labels: [], timeline: [LABELLED, entry('closed', { actor: 'williacj' }), entry('unlabeled', { actor: 'williacj', label: STATUS })] })] });

  const ran = await followed(world, 'a1', 12, 'closed');

  assert.deepEqual(ran.value, { issue: 12, closed: true });
  assert.deepEqual(ran.writes, []);
});

// proves R-SCHED-23, R-SCHED-27
test('an issue whose status label was removed before it was closed, or that is still open without it, is no longer the notice: L2 finds or opens another and the closer is renamed to it; its close reopens nothing', async () => {
  for (const [state, extra] of [['closed', [entry('closed', { actor: 'williacj' })]], ['open', []]]) {
    const timeline = [LABELLED, entry('unlabeled', { actor: 'williacj', label: STATUS }), ...extra];
    const world = forge({ issues: [opened(12, 'a1', { state, labels: [], timeline }), opened(20, 'z9')] });

    const ran = await followed(world, 'a1', 12, state);

    assert.deepEqual(ran.names, ['hold-a1-issue-12.json', 'hold-a1-issue-20.json'], state);
    assert.deepEqual(ran.value, { issue: 20 }, state);
    assert.deepEqual(ran.writes.map(([call]) => call), ['postIssueComment', 'addIssue', 'moveItem'], state);
  }
});

// proves R-SCHED-23
test('an issue `resume` removed the label from and then closed is no longer the notice of a closer `resume` did not read: L2 opens another, and the closer survives', async () => {
  const world = forge({ issues: [opened(12, 'a1', { state: 'closed', labels: [], timeline: [LABELLED, entry('unlabeled', { label: STATUS }), entry('closed')] })] });

  const ran = await followed(world, 'a1', 12, 'closed');

  assert.deepEqual(ran.names, ['hold-a1-issue-12.json', 'hold-a1-after-12.json', 'hold-a1-issue-13.json']);
  assert.notEqual(ran.value.closed, true);
});

// proves R-SCHED-23
test('an issue deleted or transferred is no longer the notice: L2 opens another and the closer is renamed to it, and deleting never clears the hold', async () => {
  // L3 read `none`; and, read again by L2 between the two, `readIssue` answering null.
  for (const [state, issues] of [['none', []], ['open', []]]) {
    const world = forge({ issues });

    const ran = await followed(world, 'a1', 12, state);

    assert.deepEqual(ran.names, ['hold-a1-issue-12.json', 'hold-a1-after-0.json', 'hold-a1-issue-1.json'], state);
    assert.deepEqual(ran.value, { issue: 1 }, state);
  }
});

// proves R-SCHED-23
test('an open labelled issue the notice never reached, as after a crash in step 4, gets L2\'s comment naming the hold, then is placed in Owner', async () => {
  const world = forge({ issues: [opened(12, 'z9', { timeline: [LABELLED] })] });

  const ran = await followed(world, 'a1', 12);

  assert.deepEqual(ran.value, { issue: 12 });
  assert.deepEqual(ran.writes, [['postIssueComment', 12], ['addIssue', 12], ['moveItem', 'item-12']]);
  assert.equal(holdOf(world.issues[0].comments[0]), 'a1');
});

// proves R-SCHED-23
test('an open issue whose placing on the board was refused is placed in Owner at the next trigger', async () => {
  const issue = opened(12, 'a1', { timeline: [LABELLED] });
  const refused = forge({ issues: [structuredClone(issue)], refuse: { addIssue: 'gh: addProjectV2ItemById timed out' } });
  const next = forge({ issues: [structuredClone(issue)] });

  const first = await followed(refused, 'a1', 12);
  const second = await followed(next, 'a1', 12);

  assert.deepEqual(first.value, { failed: { step: 'add issue #12 to the board', cause: 'gh: addProjectV2ItemById timed out' } });
  assert.deepEqual(second.value, { issue: 12 });
  assert.deepEqual(next.onBoard, [{ id: 'item-12', number: 12, column: 'Owner' }]);
});

// proves R-SCHED-23
test('an issue whose read or timeline read is refused, or a page of it, counts as unreadable: L2 claims no close, names the issue in notice.failed, and writes nothing', async () => {
  for (const [refused, step] of [['readIssue', 'read issue #12'], ['readIssueTimeline', 'read issue #12\'s timeline']]) {
    const world = forge({ issues: [opened(12, 'a1', { state: 'closed', timeline: [LABELLED, entry('closed')] })], refuse: { [refused]: 'gh: HTTP 502' } });

    const ran = await followed(world, 'a1', 12, 'closed');

    assert.deepEqual(ran.value, { failed: { step, cause: 'gh: HTTP 502' } }, refused);
    assert.deepEqual(ran.events, [{ layer: 'L2', event: 'notice.failed', hold: 'a1', step, cause: 'gh: HTTP 502' }], refused);
    assert.deepEqual(ran.writes, [], refused);
  }
});

// proves R-SCHED-23
test('a comment naming the hold\'s id by an account without write access, or one edited after it was posted, is not the notice reaching the issue, so a close after it is not the hold\'s', async () => {
  for (const comment of [said('Hold: `a1`', { author: 'stranger', permission: 'read' }), said('Hold: `a1`', { edited: true }), said('Hold: `a1`', { author: null, permission: 'none' })]) {
    const world = forge({ issues: [opened(12, 'z9', { timeline: [LABELLED, comment, entry('closed', { actor: 'williacj' }), entry('reopened', { actor: 'williacj' })] })] });

    const ran = await followed(world, 'a1', 12);

    assert.notEqual(ran.value.closed, true, JSON.stringify(comment));
    // The notice never reached the open labelled issue, so L2 comments as step 4 says.
    assert.equal(ran.writes[0][0], 'postIssueComment', JSON.stringify(comment));
  }
});

// proves R-SCHED-23
test('a label event for another label is not a status-label change: a close after another label\'s removal still counts', async () => {
  const world = forge({ issues: [opened(12, 'a1', { state: 'closed', timeline: [LABELLED, entry('labeled', { label: 'type:change' }), entry('unlabeled', { label: 'type:change' }), entry('closed')] })] });

  assert.deepEqual((await followed(world, 'a1', 12, 'closed')).value, { issue: 12, closed: true });
});

// proves R-SCHED-23
test('the status label applied at the issue\'s opening is read as carried from the opening: a close with no later label event counts', async () => {
  // The timeline the read answers for an issue opened carrying the label: its label event first.
  const world = forge({ issues: [opened(12, 'a1', { state: 'closed', timeline: [LABELLED, entry('closed', { actor: 'github-project-automation[bot]' })] })] });

  assert.deepEqual((await followed(world, 'a1', 12, 'closed')).value, { issue: 12, closed: true });
});

/** The status issue's close for `resume` over `world`: what L2's notice function's `close` answers for `named`, and the forge's writes by name and issue. */
async function closedFor(world, named) {
  const { notice } = noticeOver(world);
  const answer = await notice.close(named);
  return { answer, writes: world.calls.filter(([call]) => ['removeIssueLabel', 'closeIssue'].includes(call)).map(([call, number]) => [call, number]) };
}

// proves R-SCHED-24
test('resume\'s close removes the status label from each issue a closer named and every other open labelled issue, then closes it, label first', async () => {
  const world = forge({ issues: [opened(12, 'a1'), opened(20, 'z9'), { number: 30, title: 'Copied', body: '', labels: [STATUS, 'type:change'], comments: [] }] });

  const { answer, writes } = await closedFor(world, [12]);

  assert.deepEqual(answer, { closed: [12, 20, 30], left: [] });
  assert.deepEqual(writes, [['removeIssueLabel', 12], ['closeIssue', 12], ['removeIssueLabel', 20], ['closeIssue', 20], ['removeIssueLabel', 30], ['closeIssue', 30]]);
  assert.deepEqual(world.issues.map(({ state, labels }) => [state, labels]), [['closed', []], ['closed', []], ['closed', ['type:change']]]);
});

// proves R-SCHED-24
test('resume\'s close closes a named issue that no longer carries the label with no label write, and writes nothing for one already closed, deleted or transferred', async () => {
  const world = forge({ issues: [opened(12, 'a1', { labels: [] }), opened(14, 'b2', { state: 'closed' })] });

  const { answer, writes } = await closedFor(world, [12, 14, 16]);

  assert.deepEqual(answer, { closed: [12], left: [] });
  assert.deepEqual(writes, [['closeIssue', 12]]);
});

// proves R-SCHED-24
test('resume\'s close leaves an issue open whose read, label removal or close is refused, and goes on to the next', async () => {
  for (const refused of ['readIssue', 'removeIssueLabel', 'closeIssue']) {
    const world = forge({ issues: [opened(12, 'a1')], refuse: { [refused]: `gh: ${refused} timed out` } });

    const { answer } = await closedFor(world, [12]);

    assert.deepEqual(answer, { closed: [], left: [{ issue: 12, why: `gh: ${refused} timed out` }] }, refused);
  }
  // One refused issue does not stop the next.
  const world = forge({ issues: [opened(12, 'a1'), opened(14, 'b2')] });
  const removeIssueLabel = world.writes.removeIssueLabel;
  world.writes.removeIssueLabel = async (number, label) => {
    if (number === 12) throw new Error('gh: HTTP 403');
    return removeIssueLabel(number, label);
  };
  assert.deepEqual((await closedFor(world, [12, 14])).answer, { closed: [14], left: [{ issue: 12, why: 'gh: HTTP 403' }] });
});

// proves R-SCHED-24
test('where the read of the labelled issues is refused, resume\'s close still closes each issue a closer named, and names the read', async () => {
  const world = forge({ issues: [opened(12, 'a1'), opened(20, 'z9')], refuse: { readLabelledIssues: 'gh: HTTP 502' } });

  const { answer, writes } = await closedFor(world, [12]);

  assert.deepEqual(answer, { closed: [12], left: [], unread: 'gh: HTTP 502' });
  assert.deepEqual(writes, [['removeIssueLabel', 12], ['closeIssue', 12]]);
  assert.equal(world.issues[1].state ?? 'open', 'open');
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
