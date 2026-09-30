// ABOUTME: Tests a card's attempt tried once more when anything before the maker fails: L2 decides
// the retry and records it, L3 attempts the card again under its one claim and slot in a fresh
// workspace L1 makes at the same path, and a card whose retry fails stays in Coding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { workspaceHandle } from '../src/execution/workspace.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { bareCloneInto, cloneInto, gitIn, repositoryAt } from './git-repository.mjs';
import { COLUMNS, KINDS, columnsOf, handleOn, readyCard } from './loop-world.mjs';
import { scratch } from './process-fixtures.mjs';

// A bound on a test that waits on real commands and real git, so one whose condition never holds
// fails here rather than holding the suite.
const SETTLES_WITHIN = { timeout: 60_000 };

/** A step that runs `run` in the workspace, required unless `required` is false. */
const step = (run, required = true) => ({ run, required });

/**
 * A world in which L3's real loop drives card `card` through the real L2 next action and column
 * changes, L1's real dispatch and L1's real workspace handle, over a repository whose `origin` is
 * a local bare repository, a fake board holding the card in Ready and one real sink, all in a
 * scratch directory torn down with every process naming it. The card's kind lists `steps`, each
 * of which `provisioning` declares, or the function `provisioning` answers for the scratch
 * directory. `maker` is the maker stand-in L3 is handed, none where it is undefined, and
 * `makerCalls` records each call with the number of events recorded when it was made.
 *
 * `made` records each call L3 made on the workspace handle, in order. `before(call)` runs as each
 * call begins, numbered from 1, before L1 makes anything. `refuse(context, event, fields)` answers
 * whether the sink refuses that append, which it then refuses with an error naming it.
 */
async function retryWorld(t, { card = 1, steps = [], provisioning = {}, maker, refuse = () => false, before = () => {} } = {}) {
  const directory = scratch(t);
  const source = repositoryAt(join(directory, 'source'), { README: 'one\n' });
  gitIn(source, 'branch', '-M', 'main');
  const origin = bareCloneInto(source, join(directory, 'origin.git'));
  const repository = cloneInto(origin, join(directory, 'repository'));
  const root = join(directory, 'worktrees');
  const state = join(directory, 'state');
  mkdirSync(state);
  const real = openSink({ directory: state, run: 'r-retry', now: Date.now });
  const sink = {
    emitter: (context) => {
      const emitter = real.emitter(context);
      return {
        emit: (event, fields) => {
          if (refuse(context, event, fields)) throw new Error(`the sink refuses ${context.layer} ${event}`);
          emitter.emit(event, fields);
        },
      };
    },
  };
  const events = () => (existsSync(streamPath(state)) ? readEvents(state) : []);
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: [readyCard(card)] });
  const settings = { ...config, concurrency: 1 };
  const changes = columnChanges({ config: settings, sink, items: fake.operations });
  const settled = [];
  const l2 = {
    claimed: changes.claimed,
    settled: (held, outcome) => {
      settled.push(held.number);
      return changes.settled(held, outcome);
    },
  };
  const kinds = { change: { ...KINDS.change, provisioning: steps } };
  const declared = typeof provisioning === 'function' ? provisioning(directory) : provisioning;
  const decide = (held, outcomes, attempt) => nextAction(held, kinds, undefined, { columns: COLUMNS, provisioning: declared, outcomes, sink, ...attempt });
  const handle = await workspaceHandle({ root, topic: 'rigger-{number}', repository, sink });
  const made = [];
  const workspace = async (number) => {
    made.push(number);
    before(made.length);
    return handle(number);
  };
  const makerCalls = [];
  const injected = maker === undefined ? undefined : async (start) => {
    makerCalls.push({ start, at: events().length });
    return maker(start);
  };
  const built = loop({ config: settings, board: handleOn(fake), decide, l2, dispatch: injected, sink, kill: async () => {}, workspace, state });
  return { directory, root, path: join(root, `rigger-${card}`), fake, loop: built, events, made, makerCalls, settled };
}

/** The events of `layer` named `event` among `events`. */
const named = (events, layer, event) => events.filter((each) => each.layer === layer && each.event === event);

// proves R-PROV-3
test('given a required step that exits non-zero on both attempts, the injected maker stand-in is never called', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, { steps: ['a'], provisioning: { a: step('exit 3') }, maker: async () => ({ exit: 0 }) });

  await assert.rejects(built.loop.pull());

  assert.deepEqual(built.makerCalls, []);
});

// proves R-FAIL-2
test('given a required step that exits non-zero on both attempts, the card is attempted exactly twice in that call', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, { steps: ['a'], provisioning: { a: step('exit 3') }, maker: async () => ({ exit: 0 }) });

  await assert.rejects(built.loop.pull());

  assert.deepEqual(built.made, [1, 1]);
  assert.deepEqual(named(built.events(), 'L3', 'dispatch').map((each) => each.attempt), [1, 2]);
});

/** The index in `events` of L1's `event`, `dispatch.start` or `dispatch.end`, of the last dispatch L3 started. */
function lastL1(events, event) {
  const starts = named(events, 'L3', 'dispatch');
  const last = starts[starts.length - 1];
  assert.ok(last, `L3 recorded no dispatch: ${JSON.stringify(events)}`);
  return events.findIndex((each) => each.layer === 'L1' && each.event === event && each.dispatch === last.dispatch);
}

/**
 * A step's run line that exits 0 once the file `once` exists, and otherwise makes it and then runs
 * `first`, so the step does what `first` says on its first attempt alone.
 */
const firstOnly = (once, first) => `if [ -e '${once}' ]; then exit 0; fi; : > '${once}'; ${first}`;

/**
 * A run line that appends to the file `seen` whether the workspace holds `left` as it begins,
 * `held` if it does and `clean` if not.
 */
const looksFor = (left, seen) => `if [ -e ${left} ]; then echo held >> '${seen}'; else echo clean >> '${seen}'; fi`;

/** The lines of the file at `path`, or none where there is no file. */
const linesOf = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);

// proves R-FAIL-1
test('given a required step that exits non-zero on the first attempt and 0 on the second, the injected maker stand-in is called exactly once, after the second attempt\'s last step has ended', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, { steps: ['a', 'b'], provisioning: (dir) => ({ a: step('true'), b: step(firstOnly(join(dir, 'failed-once'), 'exit 3')) }), maker: async () => ({ exit: 0 }) });

  await built.loop.pull();

  const events = built.events();
  assert.deepEqual(named(events, 'L3', 'dispatch').map(({ step: name, attempt }) => [name, attempt]), [['a', 1], ['b', 1], ['a', 2], ['b', 2]]);
  assert.equal(built.makerCalls.length, 1);
  const lastEnd = lastL1(events, 'dispatch.end');
  assert.ok(lastEnd >= 0 && built.makerCalls[0].at > lastEnd, `the maker was called with ${built.makerCalls[0].at} events recorded: ${JSON.stringify(events)}`);
});

// proves R-FAIL-1
test('given a required step that writes a file into the workspace and then exits non-zero on the first attempt, the second attempt\'s workspace holds no file at that path when its first step starts', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, {
    steps: ['a'],
    provisioning: (dir) => ({ a: step(`${looksFor('left', join(dir, 'seen'))}; ${firstOnly(join(dir, 'failed-once'), ': > left; exit 3')}`) }),
    maker: async () => ({ exit: 0 }),
  });

  await built.loop.pull();

  assert.deepEqual(named(built.events(), 'L3', 'dispatch').map((each) => each.attempt), [1, 2]);
  assert.deepEqual(linesOf(join(built.directory, 'seen')), ['clean', 'clean']);
});

// proves R-FAIL-1
test('given a workspace that cannot be made on the first attempt and can on the second, the card\'s steps run once, in the second attempt\'s workspace, at the same derived path', SETTLES_WITHIN, async (t) => {
  let path;
  const built = await retryWorld(t, {
    steps: ['a'],
    provisioning: { a: step('true') },
    maker: async () => ({ exit: 0 }),
    // A directory that is not a workspace of the repository stands where the first attempt's
    // workspace goes, so L1 refuses to replace it; it is gone before the second attempt.
    before: (call) => (call === 1 ? mkdirSync(path, { recursive: true }) : rmSync(path, { recursive: true })),
  });
  ({ path } = built);

  await built.loop.pull();

  const events = built.events();
  assert.deepEqual(built.made, [1, 1]);
  assert.deepEqual(named(events, 'L1', 'workspace.failed').map((each) => each.path), [path]);
  assert.deepEqual(named(events, 'L1', 'workspace.made').map((each) => each.path), [path]);
  assert.deepEqual(named(events, 'L3', 'dispatch').map(({ step: name, attempt }) => [name, attempt]), [['a', 2]]);
  assert.deepEqual(named(events, 'L1', 'dispatch.start').map((each) => each.workspace), [path]);
});

// proves R-PROV-3, R-FAIL-2
test('given a required step whose command cannot be started on either attempt, the injected maker stand-in is never called, and the card is attempted exactly twice', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, { steps: ['a'], provisioning: { a: { ...step('true'), cwd: 'missing' } }, maker: async () => ({ exit: 0 }) });

  await assert.rejects(built.loop.pull());

  assert.deepEqual(built.makerCalls, []);
  assert.deepEqual(built.made, [1, 1]);
  assert.deepEqual(named(built.events(), 'L1', 'dispatch.end').map((each) => each.exit === undefined && typeof each.reason === 'string'), [true, true]);
});

test('given an optional step that exits non-zero and every required step exiting 0, the card is attempted once, and the injected maker stand-in is called once', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, { steps: ['opt', 'b'], provisioning: { opt: step('exit 4', false), b: step('true') }, maker: async () => ({ exit: 0 }) });

  await built.loop.pull();

  assert.deepEqual(built.made, [1]);
  assert.equal(built.makerCalls.length, 1);
});

test('given an optional step whose command cannot be started, followed by a required step, the required step\'s dispatch.start follows, the card is attempted once, and the event stream records the optional step\'s failure', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, { steps: ['opt', 'b'], provisioning: { opt: { ...step('true', false), cwd: 'missing' }, b: step('true') }, maker: async () => ({ exit: 0 }) });

  await built.loop.pull();

  const events = built.events();
  assert.deepEqual(named(events, 'L3', 'dispatch').map((each) => each.step), ['opt', 'b']);
  assert.ok(lastL1(events, 'dispatch.start') > events.findIndex((each) => each.layer === 'L1' && each.event === 'dispatch.end'), JSON.stringify(events));
  assert.deepEqual(built.made, [1]);
  const failed = named(events, 'L2', 'step.failed');
  assert.deepEqual(failed.map(({ card, step: name, optional }) => ({ card, step: name, optional })), [{ card: 1, step: 'opt', optional: true }]);
  assert.equal(typeof failed[0].reason, 'string');
});

test('given an optional step whose command cannot be started as the last selected step, the injected maker stand-in is called once', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, { steps: ['a', 'opt'], provisioning: { a: step('true'), opt: { ...step('true', false), cwd: 'missing' } }, maker: async () => ({ exit: 0 }) });

  await built.loop.pull();

  assert.equal(built.makerCalls.length, 1);
  assert.deepEqual(built.made, [1]);
});

/**
 * The time a step here is given before its timeout ends it. A judgment: the step's shell runs a
 * few builtins before it blocks, which take milliseconds, so it has blocked well within this.
 */
const BLOCKED_WITHIN = 2_000;

/** A run line that blocks on following the file `hold` until the step's timeout ends it. */
const blocking = (hold) => `exec /usr/bin/tail -f '${hold}'`;

// proves R-FAIL-1
test('given a required step its timeout ends on the first attempt and that exits 0 on the second, the injected maker stand-in is called once, after the second attempt\'s last step, and the second attempt\'s workspace holds no file the first attempt\'s step wrote', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, {
    steps: ['a'],
    provisioning: (dir) => {
      writeFileSync(join(dir, 'hold'), '');
      return { a: { ...step(`${looksFor('written', join(dir, 'seen'))}; ${firstOnly(join(dir, 'timed-once'), `: > written; ${blocking(join(dir, 'hold'))}`)}`), timeout: BLOCKED_WITHIN } };
    },
    maker: async () => ({ exit: 0 }),
  });

  await built.loop.pull();

  const events = built.events();
  assert.equal(named(events, 'L1', 'dispatch.timeout').length, 1, JSON.stringify(events));
  assert.equal(built.makerCalls.length, 1);
  const lastEnd = lastL1(events, 'dispatch.end');
  assert.ok(lastEnd >= 0 && built.makerCalls[0].at > lastEnd, JSON.stringify(events));
  assert.deepEqual(linesOf(join(built.directory, 'seen')), ['clean', 'clean']);
});

// proves R-PROV-3, R-FAIL-2
test('given a required step its timeout ends on both attempts, the injected maker stand-in is never called, and the card is attempted exactly twice', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, {
    steps: ['a'],
    provisioning: (dir) => {
      writeFileSync(join(dir, 'hold'), '');
      return { a: { ...step(blocking(join(dir, 'hold'))), timeout: 500 } };
    },
    maker: async () => ({ exit: 0 }),
  });

  await assert.rejects(built.loop.pull());

  assert.equal(named(built.events(), 'L1', 'dispatch.timeout').length, 2);
  assert.deepEqual(built.makerCalls, []);
  assert.deepEqual(built.made, [1, 1]);
});

/** A world whose card's workspace can be made on neither attempt: a directory that is no workspace stands at its path. */
async function neverMade(t) {
  let path;
  const built = await retryWorld(t, {
    steps: ['a'], provisioning: { a: step('true') }, maker: async () => ({ exit: 0 }), before: () => mkdirSync(path, { recursive: true }),
  });
  ({ path } = built);
  const failure = await built.loop.pull().then(() => assert.fail('the pull settled'), (thrown) => thrown);
  return { ...built, failure };
}

// proves R-FAIL-2
test('given a workspace that cannot be made on either attempt, the card is attempted exactly twice', SETTLES_WITHIN, async (t) => {
  const built = await neverMade(t);

  assert.deepEqual(built.made, [1, 1]);
  assert.equal(named(built.events(), 'L1', 'workspace.failed').length, 2);
});

// proves R-PROV-3
test('given a workspace that cannot be made on either attempt, the injected maker stand-in is never called', SETTLES_WITHIN, async (t) => {
  const built = await neverMade(t);

  assert.deepEqual(built.makerCalls, []);
});

test('given a workspace that cannot be made on either attempt, the card is in the coding column afterwards', SETTLES_WITHIN, async (t) => {
  const built = await neverMade(t);

  assert.deepEqual(await columnsOf(built.fake), { 1: COLUMNS.coding });
});

test('given a workspace that cannot be made on either attempt, the card\'s slot is released exactly once', SETTLES_WITHIN, async (t) => {
  const built = await neverMade(t);

  assert.equal(named(built.events(), 'L3', 'slot.release').filter((each) => each.card === 1).length, 1);
});

test('given a workspace that cannot be made on either attempt, the call\'s failure names the card and both workspace failures, each naming the path', SETTLES_WITHIN, async (t) => {
  const built = await neverMade(t);

  const said = built.failure.errors.map((each) => each.message).join('\n');
  assert.match(said, /card #1\b/);
  const lines = said.split('\n');
  for (const number of [1, 2]) {
    const line = lines.find((each) => each.startsWith(`attempt ${number}: `));
    assert.ok(line && line.includes(built.path) && /workspace/.test(line), said);
  }
});

/** A refusal of L1's `dispatch.end` for the dispatch L3 started of the step named `name`, on its first attempt. */
function refusingEnd(name) {
  let dispatch;
  return (context, event, fields) => {
    if (context.layer === 'L3' && event === 'dispatch' && fields.step === name && dispatch === undefined) dispatch = context.dispatch;
    return context.layer === 'L1' && event === 'dispatch.end' && context.dispatch === dispatch;
  };
}

test('given a card whose first step\'s L1 dispatch.end the sink refuses, the card is not attempted a second time', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, { steps: ['a'], provisioning: { a: step('exit 3') }, maker: async () => ({ exit: 0 }), refuse: refusingEnd('a') });

  await assert.rejects(built.loop.pull(), (failure) => failure.errors.some((each) => /dispatch\.end/.test(each.message)));

  assert.deepEqual(built.made, [1]);
  assert.deepEqual(named(built.events(), 'L3', 'dispatch').map((each) => each.attempt), [1]);
});

test('given a card whose kind selects two steps, with a maker stand-in injected, where the sink refuses the first step\'s L1 dispatch.end, neither the second step nor the maker stand-in starts', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, { steps: ['a', 'b'], provisioning: { a: step('true'), b: step('true') }, maker: async () => ({ exit: 0 }), refuse: refusingEnd('a') });

  await assert.rejects(built.loop.pull());

  const events = built.events();
  assert.deepEqual(named(events, 'L3', 'dispatch').map((each) => each.step), ['a']);
  assert.equal(named(events, 'L1', 'dispatch.start').length, 1);
  assert.deepEqual(built.makerCalls, []);
});

// proves R-FAIL-1
test('the event stream holds an L2 event per failed attempt under the card, naming its attempt number, what failed, the workspace or a step, why, and that its class is the environment\'s', SETTLES_WITHIN, async (t) => {
  let path;
  const built = await retryWorld(t, {
    steps: ['a'], provisioning: { a: step('exit 3') }, maker: async () => ({ exit: 0 }), before: (call) => (call === 1 ? mkdirSync(path, { recursive: true }) : rmSync(path, { recursive: true })),
  });
  ({ path } = built);

  await assert.rejects(built.loop.pull());

  const failed = named(built.events(), 'L2', 'attempt.failed');
  assert.deepEqual(failed.map(({ card, attempt, workspace, step: name, exit }) => ({ card, attempt, workspace, step: name, exit })), [
    { card: 1, attempt: 1, workspace: path, step: undefined, exit: undefined },
    { card: 1, attempt: 2, workspace: undefined, step: 'a', exit: 3 },
  ]);
  assert.ok(failed[0].reason.includes(path), failed[0].reason);
  assert.deepEqual(failed.map((each) => each.class), ['environment', 'environment']);
});

// proves R-FAIL-2
test('the event stream holds an L2 event under the card for each decision to attempt it again or stop it, naming the attempt number', SETTLES_WITHIN, async (t) => {
  const built = await retryWorld(t, { steps: ['a'], provisioning: { a: step('exit 3') }, maker: async () => ({ exit: 0 }) });

  await assert.rejects(built.loop.pull());

  assert.deepEqual(named(built.events(), 'L2', 'attempt.decided').map(({ card, attempt, decision }) => ({ card, attempt, decision })), [
    { card: 1, attempt: 1, decision: 'again' },
    { card: 1, attempt: 2, decision: 'stop' },
  ]);
});

/** A world whose card's one required step exits 3 on both attempts, pulled once. */
async function bothFail(t) {
  const built = await retryWorld(t, { steps: ['a'], provisioning: { a: step('exit 3') }, maker: async () => ({ exit: 0 }) });
  const failure = await built.loop.pull().then(() => assert.fail('the pull settled'), (thrown) => thrown);
  return { ...built, failure };
}

// proves R-FAIL-1
test('given a card whose attempts both fail, the board stand-in shows no move of that card to the owner column, and the event stream holds no escalation for it', SETTLES_WITHIN, async (t) => {
  const built = await bothFail(t);

  assert.deepEqual(built.fake.writes().filter(({ operation, args: [, column] }) => operation === 'moveItem' && column === COLUMNS.owner), []);
  assert.deepEqual(built.events().filter((each) => /escalat/i.test(each.event)), []);
  assert.deepEqual(built.settled, []);
});

test('given a card whose attempts both fail, the card is in the coding column afterwards', SETTLES_WITHIN, async (t) => {
  const built = await bothFail(t);

  assert.deepEqual(await columnsOf(built.fake), { 1: COLUMNS.coding });
});

test('given a card whose attempts both fail, the call\'s failure names the card and both attempts\' failures', SETTLES_WITHIN, async (t) => {
  const built = await bothFail(t);

  const said = built.failure.errors.map((each) => each.message).join('\n');
  assert.match(said, /card #1\b/);
  const lines = said.split('\n');
  for (const number of [1, 2]) {
    const line = lines.find((each) => each.startsWith(`attempt ${number}: `));
    assert.ok(line && line.includes('"step":"a"') && line.includes('"exit":3'), said);
  }
});

test('given a card attempted twice, its slot is released exactly once, after the last attempt, as the event stream\'s slot.release events show', SETTLES_WITHIN, async (t) => {
  const built = await bothFail(t);

  const events = built.events();
  const releases = named(events, 'L3', 'slot.release').filter((each) => each.card === 1);
  assert.equal(releases.length, 1);
  const lastDecision = events.findLastIndex((each) => each.layer === 'L2' && each.event === 'attempt.decided');
  assert.ok(lastDecision >= 0 && events.indexOf(releases[0]) > lastDecision && events.indexOf(releases[0]) > lastL1(events, 'dispatch.end'), JSON.stringify(events));
});

/** L2's next action for card 7 within its attempt numbered `attempt`, whose kind lists the one required step `a`, handed `given`. */
const answerFor = (given, sink, attempt = 1) => nextAction(readyCard(7), { change: { ...KINDS.change, provisioning: ['a'] } }, undefined, { provisioning: { a: step('true') }, sink, attempt, ...given });

/** A sink that refuses every append, with an error saying so. */
const refusing = { emitter: () => ({ emit: () => { throw new Error('the disk is full'); } }) };

test('given a workspace outcome that is not L1\'s failure to make it, L2 answers no action, naming the card', () => {
  const outcome = { status: 'rejected', reason: new Error('the handle broke') };
  assert.throws(() => answerFor({ workspace: outcome }, { emitter: () => ({ emit: () => {} }) }), (failure) => /#7\b/.test(failure.message) && /the handle broke/.test(failure.message));
});

test('given a failed attempt whose record the sink refuses, L2 answers no action, naming the card, the attempt and the refusal, rather than an attempt again', () => {
  const exited = { status: 'fulfilled', value: { exit: 3, timedOut: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } };
  assert.throws(() => answerFor({ outcomes: [exited] }, refusing), (failure) => /#7\b/.test(failure.message) && /attempt 1\b/.test(failure.message) && /the disk is full/.test(failure.message));
});
