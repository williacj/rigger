// ABOUTME: Tests L2's next action within an attempt at a card: which provisioning steps it selects
// and in what order, and what each step's outcome means: the next step, the maker, or the card stopped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';

/** A body whose acceptance passes the form check under the title `Add a verb`. */
const PASSING = '## Acceptance\n\n- The verb prints its help.\n';

/** A ready card titled `Add a verb`, numbered `number`, carrying `labels`, selected by `type:change`. */
const card = (number, labels = []) => ({ number, title: 'Add a verb', body: PASSING, labels: ['type:change', ...labels] });

/** One kind, `change`, whose maker is `engineer` and which lists `steps` as its provisioning. */
const kindsListing = (steps) => ({
  change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'], provisioning: steps },
});

/** A step's outcome as `Promise.allSettled` records L1's result for a command that exited `exit`. */
const exited = (exit) => ({ status: 'fulfilled', value: { exit, timedOut: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } });

/**
 * The next actions L2 answers for `given` across an attempt in which each selected step exits 0,
 * one per outcome so far, until it answers something other than a step: the steps it selected, in
 * order, and what it answered last.
 */
function walk(given, kinds, provisioning) {
  const outcomes = [];
  const steps = [];
  for (;;) {
    const next = nextAction(given, kinds, undefined, { provisioning, outcomes: [...outcomes] });
    if (next.step === undefined) return { steps, last: next };
    steps.push(next.step.name);
    outcomes.push(exited(0));
  }
}

test('given a kind listing steps a then b, where b selects label x, L2 selects for a card not carrying x step a and no other', () => {
  const provisioning = { a: { run: 'true' }, b: { run: 'true', select: { labels: ['x'] } } };
  assert.deepEqual(walk(card(1), kindsListing(['a', 'b']), provisioning).steps, ['a']);
});

test('given a kind listing steps a, b and c, where b selects label x and c selects nothing, L2 selects for a card carrying x steps a, b and c, in that order', () => {
  const provisioning = { a: { run: 'true' }, b: { run: 'true', select: { labels: ['x'] } }, c: { run: 'true' } };
  assert.deepEqual(walk(card(2, ['x']), kindsListing(['a', 'b', 'c']), provisioning).steps, ['a', 'b', 'c']);
});

test('given a kind listing steps c, a, b, L2 selects them in the order c, a, b', () => {
  const provisioning = { a: { run: 'true' }, b: { run: 'true' }, c: { run: 'true' } };
  assert.deepEqual(walk(card(3), kindsListing(['c', 'a', 'b']), provisioning).steps, ['c', 'a', 'b']);
});

test('given a step that selects label x and that no kind lists, L2 does not select it for a card carrying x', () => {
  const provisioning = { a: { run: 'true' }, unlisted: { run: 'true', select: { labels: ['x'] } } };
  assert.deepEqual(walk(card(4, ['x']), kindsListing(['a']), provisioning).steps, ['a']);
});

test('given a kind that lists no provisioning, L2\'s next action for a claimed card is the maker, with no step before it', () => {
  const kinds = { change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer'] } };
  assert.deepEqual(walk(card(5), kinds, { a: { run: 'true' } }), { steps: [], last: { action: 'dispatch', kind: 'change', maker: 'engineer' } });
});

/** Two steps, `first` and `later`, which a card of kind `change` both runs, `first` required where `required` says. */
const twoSteps = (required) => ({
  kinds: kindsListing(['first', 'later']),
  provisioning: { first: { run: 'exit 3', ...(required ? { required: true } : {}) }, later: { run: 'true' } },
});

/**
 * An L5 sink over a state directory of the test's own under `TMPDIR`, removed at the test's
 * teardown, and a reader of the events it holds.
 */
function sinkFor(t) {
  const directory = mkdtempSync(join(tmpdir(), 'rigger-steps-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { sink: openSink({ directory, run: 'r-test', now: () => 0 }), events: () => (existsSync(streamPath(directory)) ? readEvents(directory) : []) };
}

test('given a required step\'s outcome of exit 3, L2\'s next action is neither a later step nor the maker', (t) => {
  const { kinds, provisioning } = twoSteps(true);
  const next = nextAction(card(20), kinds, undefined, { provisioning, outcomes: [exited(3)], sink: sinkFor(t).sink });
  assert.equal(next.step, undefined, `L2 answered a step: ${JSON.stringify(next)}`);
  assert.equal(next.maker, undefined, `L2 answered the maker: ${JSON.stringify(next)}`);
  assert.notEqual(next.action, 'dispatch');
});

// proves R-PROV-2
test('given an optional step\'s outcome of exit 3 and a later selected step, L2\'s next action is that later step', (t) => {
  const { kinds, provisioning } = twoSteps(false);
  const next = nextAction(card(21), kinds, undefined, { provisioning, outcomes: [exited(3)], sink: sinkFor(t).sink });
  assert.deepEqual(next, { action: 'dispatch', kind: 'change', step: { name: 'later', run: 'true' } });
});

// proves R-PROV-2
test('given an optional step\'s outcome of exit 3, the event stream holds an L2 event under the card naming the step, the exit code 3, and that the step is optional', (t) => {
  const { kinds, provisioning } = twoSteps(false);
  const { sink, events } = sinkFor(t);
  nextAction(card(22), kinds, undefined, { provisioning, outcomes: [exited(3)], sink });
  const recorded = events().filter((each) => each.layer === 'L2' && each.card === 22);
  assert.deepEqual(recorded.map(({ event, step, exit, optional }) => ({ event, step, exit, optional })), [{ event: 'step.failed', step: 'first', exit: 3, optional: true }]);
});

// proves R-PROV-2
test('given an optional step\'s outcome of exit 3 as the last selected step, L2\'s next action is the maker', (t) => {
  const provisioning = { only: { run: 'exit 3' } };
  const next = nextAction(card(23), kindsListing(['only']), undefined, { provisioning, outcomes: [exited(3)], sink: sinkFor(t).sink });
  assert.deepEqual(next, { action: 'dispatch', kind: 'change', maker: 'engineer' });
});

/** Why the commands in these outcomes never started, as L1 says it. */
const WHY = 'its working directory /nowhere cannot be used: ENOENT';

/** A step's outcome as `Promise.allSettled` records L1's rejection for a command that never started. */
const neverStarted = () => ({ status: 'rejected', reason: Object.assign(new Error(WHY), { code: NOT_STARTED }) });

// proves R-PROV-2
test('given an optional step\'s outcome that it never started and a later selected step, L2\'s next action is that later step', (t) => {
  const { kinds, provisioning } = twoSteps(false);
  const next = nextAction(card(24), kinds, undefined, { provisioning, outcomes: [neverStarted()], sink: sinkFor(t).sink });
  assert.deepEqual(next, { action: 'dispatch', kind: 'change', step: { name: 'later', run: 'true' } });
});

// proves R-PROV-2
test('given an optional step\'s outcome that it never started, the event stream holds an L2 event under the card naming the step, why it did not start, and that the step is optional', (t) => {
  const { kinds, provisioning } = twoSteps(false);
  const { sink, events } = sinkFor(t);
  nextAction(card(25), kinds, undefined, { provisioning, outcomes: [neverStarted()], sink });
  const recorded = events().filter((each) => each.layer === 'L2' && each.card === 25);
  assert.deepEqual(recorded.map(({ event, step, reason, optional }) => ({ event, step, reason, optional })), [{ event: 'step.failed', step: 'first', reason: WHY, optional: true }]);
});

test('given a required step\'s outcome of exit 3, L2 classifies the failure as its environment\'s, naming the step and the exit code 3', (t) => {
  const { kinds, provisioning } = twoSteps(true);
  const next = nextAction(card(26), kinds, undefined, { provisioning, outcomes: [exited(3)], sink: sinkFor(t).sink, attempt: 2 });
  assert.deepEqual(next, { action: 'stop', card: 26, failure: { class: 'environment', step: 'first', exit: 3 } });
});

test('given a required step\'s outcome that it never started, L2 classifies the failure as its environment\'s, naming the step and why it did not start', (t) => {
  const { kinds, provisioning } = twoSteps(true);
  const next = nextAction(card(27), kinds, undefined, { provisioning, outcomes: [neverStarted()], sink: sinkFor(t).sink, attempt: 2 });
  assert.deepEqual(next, { action: 'stop', card: 27, failure: { class: 'environment', step: 'first', reason: WHY } });
});

/** A step's outcome as `Promise.allSettled` records L1's result for a command its timeout ended. */
const timedOut = () => ({ status: 'fulfilled', value: { exit: 143, timedOut: true, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } });

// proves R-PROV-2, R-PROV-5
test('given an optional step\'s outcome that its timeout ended it, L2\'s next action is the next selected step or the maker, and the event stream records the step as failed, naming its time', (t) => {
  const provisioning = { first: { run: 'sleep 60', timeout: 50 }, later: { run: 'true' } };
  const { sink, events } = sinkFor(t);
  const next = nextAction(card(28), kindsListing(['first', 'later']), undefined, { provisioning, outcomes: [timedOut()], sink });
  assert.deepEqual(next, { action: 'dispatch', kind: 'change', step: { name: 'later', run: 'true' } });
  const last = nextAction(card(28), kindsListing(['first']), undefined, { provisioning, outcomes: [timedOut()], sink });
  assert.deepEqual(last, { action: 'dispatch', kind: 'change', maker: 'engineer' });
  const recorded = events().filter((each) => each.layer === 'L2' && each.card === 28);
  assert.deepEqual(recorded.map(({ event, step, timeout, optional }) => ({ event, step, timeout, optional })), [
    { event: 'step.failed', step: 'first', timeout: 50, optional: true },
    { event: 'step.failed', step: 'first', timeout: 50, optional: true },
  ]);
});

// proves R-PROV-5
test('given a required step\'s outcome that its timeout ended it, L2 classifies the failure as its environment\'s, naming the step and its time', (t) => {
  // The step declares no timeout, so its time is the 1,800,000 ms `ARCHITECTURE.md` gives one that declares none.
  const provisioning = { first: { run: 'sleep 60', required: true }, later: { run: 'true' } };
  const next = nextAction(card(29), kindsListing(['first', 'later']), undefined, { provisioning, outcomes: [timedOut()], sink: sinkFor(t).sink, attempt: 2 });
  assert.deepEqual(next, { action: 'stop', card: 29, failure: { class: 'environment', step: 'first', timeout: 1_800_000 } });
});

test('given an optional step\'s outcome that is neither L1\'s result nor a command that never started, such as a refused event, L2 answers no action, naming the card and the step, and records no failure of the step', (t) => {
  const { kinds, provisioning } = twoSteps(false);
  const { sink, events } = sinkFor(t);
  const refusedEvent = { status: 'rejected', reason: Object.assign(new Error('the sink refused 1 L1 event(s)'), { code: 'EVENT_REFUSED' }) };
  assert.throws(() => nextAction(card(30), kinds, undefined, { provisioning, outcomes: [refusedEvent], sink }), (failure) => /#30/.test(failure.message) && /`first`/.test(failure.message) && /refused 1 L1 event/.test(failure.message));
  assert.deepEqual(events().filter((each) => each.layer === 'L2'), []);
});

test('given an optional step\'s failure the sink refuses to record, L2 answers no action, and its failure names the card, the step and the sink\'s refusal', () => {
  const { kinds, provisioning } = twoSteps(false);
  const refusing = { emitter: () => ({ emit: () => { throw new Error('the disk is full'); } }) };
  assert.throws(() => nextAction(card(31), kinds, undefined, { provisioning, outcomes: [exited(3)], sink: refusing }), (failure) => /#31/.test(failure.message) && /`first`/.test(failure.message) && /the disk is full/.test(failure.message));
});

test('given more outcomes than L2 selected steps for the card, L2 answers no action, naming the card and both counts', (t) => {
  const provisioning = { only: { run: 'true' } };
  assert.throws(() => nextAction(card(32), kindsListing(['only']), undefined, { provisioning, outcomes: [exited(0), exited(0)], sink: sinkFor(t).sink }), (failure) => /#32/.test(failure.message) && /2 outcome/.test(failure.message) && /1 step/.test(failure.message));
});
