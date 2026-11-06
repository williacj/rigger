// ABOUTME: Proves drain-time stream pushes and their queue through controlled pushes and an injected clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import config from '../rigger.config.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { pushAtReturn } from '../src/observation/push.mjs';
import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { pushStream } from '../src/substrate/data-ref.mjs';
import { EVENT_REFUSED } from '../src/substrate/process.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { boardOf, handleOn, waitFor, KINDS } from './loop-world.mjs';
import { createFakeRepository } from './fake-repository.mjs';
import { markerComment } from './fake-repository.mjs';
import { cardIn, COLUMNS, PASSING } from './loop-world.mjs';
import { gitIn, repositoryAt, withOrigin } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { manualClock, START } from './clock-report-world.mjs';
import { keptUp } from './kept-up-run.mjs';
import { recording } from '../src/cli/recording.mjs';
import { onClock } from './clock-report-verb-world.mjs';

/** L0's documented command answer, using only the deterministic tier's real git. */
const realGit = async ({ command, args, cwd, env, input }) => {
  const answer = spawnSync(command, args, { cwd, env, input });
  if (answer.error) throw answer.error;
  return { exit: answer.status, timedOut: false, stdout: answer.stdout, stderr: answer.stderr };
};

/** Real L2/L3 over forge doubles, with a recorded stream and the L5 step injected as by the verb. */
function drainWorld(t, { side = pushStream, telemetry = true, triggers = true, refuse = () => false, drained, cards = [], forge = {}, kinds = KINDS } = {}) {
  const directory = temporaryDirectory('rigger-drain-push-', { context: t });
  const repository = withOrigin(repositoryAt(join(directory, 'consumer'), { README: 'consumer\n' }), join(directory, 'origin.git'));
  const state = join(repository, '.rigger');
  const clock = manualClock();
  const settings = { ...config, concurrency: 1, kinds, telemetry: { push: telemetry } };
  delete settings.clock;
  if (triggers) settings.clock = { poll: 1000, triggers: { hourly: {
    interval: 3_600_000, anchor: new Date(START).toISOString(), catchUp: 'skip', job: 'report',
  } } };
  const run = 'r-drain';
  const real = openSink({ directory: state, run, now: clock.now });
  const sink = { ...real, emitter: (context) => ({ emit(event, fields) {
    if (refuse(event, fields)) throw new Error(`refused ${event}`);
    return real.emitter(context).emit(event, fields);
  } }) };
  const events = () => existsSync(streamPath(state)) ? readEvents(state) : [];
  const fake = boardOf(cards);
  const decide = (card, outcomes, options = {}) => nextAction(card, settings.kinds, undefined, { roles: settings.roles, provisioning: {}, outcomes, sink, ...options });
  const forgeRepository = createFakeRepository(forge);
  const facts = factsCall({ config: settings, reads: forgeRepository.operations, decide });
  const l2 = columnChanges({ config: settings, sink, items: fake.operations, reads: forgeRepository.operations, repositoryWrites: forgeRepository });
  const calls = [];
  const starts = [];
  const written = [];
  const push = pushAtReturn({ side: async (given) => {
    calls.push(Buffer.from(given.stream));
    starts.push(readFileSync(join(state, 'events.jsonl')));
    return side(given);
  }, spawn: realGit, now: clock.now, write: (line) => written.push(line) });
  const context = { sink, run, config: settings, repository, directory: state };
  const built = loop({ config: settings, board: { ...fake.operations, ...handleOn(fake) }, decide, facts, l2,
    sink, state, run, clock, environment: {}, kill: async () => {},
    workspace: async () => assert.fail('an empty board makes no workspace'),
    judgeDirectory: async () => assert.fail('an empty board makes no judge directory'), removeDirectories: async () => {},
    readRecord: Object.assign(events, { stream: streamPath(state) }),
    drained: drained ?? ((handOver) => push({ ...context, handOver })),
  });
  return { loop: built, clock, calls, starts, written, push, context, events, fake, forgeRepository, origin: join(directory, 'origin.git') };
}

/** The independent original at each side's start must equal every byte the copy received. */
const assertCopies = (w) => assert.deepEqual(w.calls, w.starts, 'each copy holds every byte the original held at its start');

// A drain must reach git before the kept-up run returns; a return-only push misses the copy.
// proves R-RECORD-13
test('D3: a recorded drain of a clock-held run pushes its starting stream through git to the bare origin', async (t) => {
  const w = drainWorld(t);
  const run = keptUp(w);
  t.after(() => run.stop());
  await waitFor(() => run.handed.some(({ settled }) => settled !== undefined));
  assert.equal(w.calls.length, 1, 'the recorded drain starts one push before return');
  await waitFor(() => w.events().some(({ event }) => event === 'push.end'));
  const end = w.events().find(({ event }) => event === 'push.end');
  assert.equal(end.outcome, 'pushed', end.reason);
  assert.equal(gitIn(w.origin, 'rev-parse', 'refs/rigger/events').trim(), end.commit, 'the pushed ref names the recorded commit');
  assert.deepEqual(Buffer.from(gitIn(w.origin, 'cat-file', 'blob', 'refs/rigger/events:events.jsonl')), w.calls[0]);
  assert.equal(JSON.parse(w.calls[0].toString().trim().split('\n').at(-1)).trigger, 'drain');
  assert.equal(w.calls.length, 1);
  assertCopies(w);
});

// The network copy must not hold back the next poll on the injected schedule.
// proves R-RECORD-14
test('D4: a held drain push does not delay the next poll on the injected clock', async (t) => {
  const controlled = heldSide();
  const w = drainWorld(t, { side: controlled.side });
  const run = keptUp(w);
  t.after(async () => { controlled.held.forEach((held) => held.release()); await run.stop(); });
  await waitFor(() => run.handed.some(({ settled }) => settled !== undefined) && w.clock.pending() > 0);
  assert.equal(w.calls.length, 1, 'the drain started the held push');
  await w.clock.advance(START + 999);
  assert.equal(w.events().filter(({ trigger }) => trigger === 'pull').length, 1);
  await w.clock.advance(START + 1000);
  assert.equal(w.events().filter(({ trigger }) => trigger === 'pull').length, 2, 'the next poll fires at its scheduled instant');
  assert.equal(w.events().filter(({ event }) => event === 'push.end').length, 0, 'the push is still held');
  controlled.held[0].release({ outcome: 'failed', reason: 'offline' });
  await waitFor(() => w.events().some(({ event }) => event === 'push.end'));
  await w.clock.advance(START + 2000);
  assert.equal(w.events().filter(({ trigger }) => trigger === 'pull').length, 3, 'polling continues after the push failed');
});

// These pre-existing exclusions must survive the injected step.
// proves R-SAFE-3
test('D1 D2 D5: a terminating run or a single pull makes no drain push, and telemetry off reaches no push side', async (t) => {
  for (const mode of ['terminating run', 'single pull', 'telemetry off']) {
    const w = drainWorld(t, { triggers: mode !== 'terminating run', telemetry: mode !== 'telemetry off' });
    if (mode === 'telemetry off') {
      const run = keptUp(w);
      await waitFor(() => run.handed.some(({ settled }) => settled !== undefined));
      await run.stop();
    } else await (mode === 'single pull' ? w.loop.pull() : w.loop.run());
    assert.equal(w.events().filter(({ trigger }) => trigger === 'drain').length, 1, mode);
    assert.equal(w.calls.length, 0, mode);
    const answer = { text: 'done', code: 0 };
    assert.deepEqual(await w.push({ ...w.context, answer }), answer);
    assert.equal(w.calls.length, mode === 'telemetry off' ? 0 : 1, 'only the normal return pushes');
  }
});

// An unsuccessful copy must not stop real L2/L3 work or suppress the next drain's attempt.
// proves R-RECORD-14, R-RECORD-16
test('D12: after a failed drain push a newly pullable merge starts and finishes, and the next drain tries again', async (t) => {
  let copies = 0;
  const w = drainWorld(t, {
    cards: [cardIn(1, COLUMNS.backlog)], kinds: { change: { ...KINDS.change, judges: ['reviewer'] } },
    forge: { pullRequests: [{ number: 11, head: 'rigger-1', sha: 'a'.repeat(40), mergeable: 'mergeable',
      comments: [markerComment({ card: 1, pull: 11, head: 'a'.repeat(40), body: PASSING })] }] },
    side: async () => (++copies === 1 ? { outcome: 'failed', reason: 'offline' } : { outcome: 'pushed', commit: 'b'.repeat(40) }),
  });
  const run = keptUp(w);
  let ended = false;
  run.running.then(() => { ended = true; }, () => { ended = true; });
  t.after(() => run.stop());
  await waitFor(() => ended || (run.handed.some(({ settled }) => settled !== undefined) && w.clock.pending() > 0));
  assert.equal(ended, false, 'a failed push must not end the run before later work');
  assert.equal(w.events().filter(({ event }) => event === 'push.end').length, 1, 'the first drain records its failed push');
  assert.equal(w.events().find(({ event }) => event === 'push.end').outcome, 'failed');
  await w.fake.operations.moveItem('item-1', COLUMNS.review);
  await w.clock.advance(START + 1000);
  await waitFor(() => w.events().some(({ event }) => event === 'merge.end') && w.clock.pending() > 0);
  assert.deepEqual(w.forgeRepository.merges(), [{ number: 11, head: 'a'.repeat(40) }], 'work still reaches the forge');
  assert.equal((await w.fake.operations.readItems())[0].column, COLUMNS.done, 'the work finishes');
  await w.clock.advance(START + 2000);
  assert.equal(w.calls.length, 2, 'the next drain tries the push again');
  assert.ok(w.calls[1].includes('"outcome":"failed"'), 'the next push includes the failed copy outcome');
  assert.equal(w.events().filter(({ event }) => event === 'push.end').at(-1).outcome, 'pushed');
});

// A failed push owes a follow-up only if a drain arrived during it.
// proves R-RECORD-16
test('D16: a failed held push serves one waiting drain, and without a waiting drain retries only at the next drain', async (t) => {
  for (const waiting of [false, true]) {
    const controlled = heldSide();
    const w = drainWorld(t, { side: controlled.side });
    const handOver = () => {};
    w.context.sink.emitter({ layer: 'L3' }).emit('trigger', { trigger: 'drain' });
    const first = w.push({ ...w.context, handOver });
    if (waiting) w.push({ ...w.context, handOver });
    assert.equal(w.calls.length, 1, 'the next copy waits for the failed copy to settle');
    controlled.held[0].release({ outcome: 'failed', reason: 'offline' });
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(w.calls.length, waiting ? 2 : 1, 'only a waiting drain owes an automatic follow-up');
    if (!waiting) w.push({ ...w.context, handOver });
    await waitFor(() => controlled.held.length === 2);
    assert.ok(controlled.held[1].stream.includes('offline'));
    controlled.held[1].release();
    await waitFor(() => w.events().filter(({ event }) => event === 'push.end').length === 2);
  }
});

// A supplied push that rejects must be observed and handed over, without an unhandled promise.
test('a rejected drain step is handed over once and raises no unhandled rejection', async (t) => {
  const failure = new Error('the injected push rejected');
  const w = drainWorld(t, { drained: async () => { throw failure; } });
  const unhandled = [];
  const observe = (error) => unhandled.push(error);
  process.on('unhandledRejection', observe);
  t.after(() => process.off('unhandledRejection', observe));
  const run = keptUp(w);
  t.after(() => run.stop());
  await waitFor(() => run.handed.some(({ settled }) => settled !== undefined));
  assert.deepEqual(run.handed.filter(({ failure }) => failure !== undefined), [{ failure }], 'the rejecting step reaches the verb once');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(unhandled, []);
});

// Repeated drains owe one follow-up; keeping a count would produce too many copies.
// proves R-RECORD-13
test('D7: several drains during a held push coalesce into exactly one follow-up', async (t) => {
  const controlled = heldSide();
  const w = drainWorld(t, { side: controlled.side });
  w.context.sink.emitter({ layer: 'L3' }).emit('trigger', { trigger: 'drain' });
  const first = w.push({ ...w.context, handOver: () => {} });
  for (let drain = 0; drain < 3; drain += 1) w.push({ ...w.context, handOver: () => {} });
  assert.equal(w.calls.length, 1, 'several drains start no concurrent push');
  controlled.held[0].release();
  await first;
  await waitFor(() => controlled.held.length === 2);
  controlled.held[1].release();
  await waitFor(() => w.events().filter(({ event }) => event === 'push.end').length === 2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(w.calls.length, 2, 'only one follow-up is owed');
  assertCopies(w);
});

// A return must join the same queue, never overlap, and serve any follow-up still waiting there.
// proves R-RECORD-13
test('D8 D9: the return waits for the held push and serves a queued drain follow-up with one copy', async (t) => {
  for (const followUp of [false, true]) {
    const controlled = heldSide();
    const w = drainWorld(t, { side: controlled.side });
    w.context.sink.emitter({ layer: 'L3' }).emit('trigger', { trigger: 'drain' });
    const first = w.push({ ...w.context, handOver: () => {} });
    if (followUp) w.push({ ...w.context, handOver: () => {} });
    const answer = { text: 'work passed', code: 0 };
    let returned = false;
    const returning = w.push({ ...w.context, answer }).then((value) => { returned = true; return value; });
    assert.equal(w.calls.length, 1, 'the return starts no overlapping push');
    assert.equal(returned, false);
    controlled.held[0].release();
    await first;
    await waitFor(() => controlled.held.length === 2);
    assert.equal(returned, false, 'the return waits for its own push too');
    controlled.held[1].release();
    assert.deepEqual(await returning, answer);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(w.calls.length, 2, 'the return serves the follow-up instead of making a third push');
    assertCopies(w);
  }
});

// Each unsuccessful result must be handed over once as a push, without entering work failures.
// proves R-RECORD-15
test('D10: refused, timed-out and failed drain pushes are recorded and handed over once outside run failures', async (t) => {
  for (const outcome of ['refused', 'timed-out', 'failed']) {
    const w = drainWorld(t, { side: async () => ({ outcome, reason: 'the copy failed\nwith details' }) });
    const run = keptUp(w);
    t.after(() => run.stop());
    await waitFor(() => run.handed.some(({ settled }) => settled !== undefined));
    assert.deepEqual(run.handed.filter(({ push }) => push !== undefined), [{ push: { outcome, reason: 'the copy failed\nwith details' } }]);
    assert.equal(run.handed.some(({ failure }) => failure !== undefined), false, 'a failed push is no work failure');
    assert.equal(w.events().filter(({ event }) => event === 'push.end').length, 1);
    assert.equal(w.events().find(({ event }) => event === 'push.end').outcome, outcome);
    await w.clock.advance(START + 1000);
    assert.equal(run.handed.filter(({ push }) => push !== undefined).length, 1, 'a later poll repeats no failed push');
    assert.deepEqual(await run.stop(), []);
    assert.deepEqual(w.written, [], 'L5 leaves the drain line to the verb writer');
  }
});

// A refused event must retain its failure identity, rather than becoming a failed-push line.
test('D13: refused push.end and refused L0 events are handed over as failures without a failed-push line', async (t) => {
  for (const event of ['push.end', 'survivor.killed']) {
    const failure = Object.assign(new Error('survivor.killed went unrecorded: EIO'), { code: EVENT_REFUSED });
    const w = drainWorld(t, { refuse: (kind) => kind === event,
      side: async () => { if (event === 'survivor.killed') throw failure; return { outcome: 'pushed', commit: 'a'.repeat(40) }; } });
    const run = keptUp(w);
    t.after(() => run.stop());
    await waitFor(() => run.handed.some(({ settled }) => settled !== undefined));
    const failures = run.handed.filter(({ failure }) => failure !== undefined);
    assert.equal(failures.length, 1, 'the refused event is handed to the verb');
    assert.match(failures[0].failure.message, /went unrecorded/);
    if (event === 'survivor.killed') assert.equal(failures[0].failure, failure);
    assert.equal(run.handed.some(({ push }) => push !== undefined), false);
    assert.deepEqual(w.written, []);
    assert.deepEqual(await run.stop(), []);
  }
});

// drains increments before the append, so observing the counter would push an unrecorded drain.
test('D14: a refused drain trigger starts no push even though the drain counter advanced', async (t) => {
  const w = drainWorld(t, { refuse: (event, fields) => event === 'trigger' && fields.trigger === 'drain' });
  const run = keptUp(w);
  t.after(() => run.stop());
  await waitFor(() => run.handed.some(({ settled }) => settled !== undefined));
  assert.equal(w.calls.length, 0, 'an unrecorded drain starts no push');
  assert.equal(run.handed.find(({ settled }) => settled !== undefined).settled.status, 'rejected');
  assert.deepEqual(await run.stop(), []);
});

/** A push side held by the test, answering the documented push-side result when released. */
function heldSide() {
  const held = [];
  return {
    held,
    side: ({ stream }) => new Promise((release) => held.push({ stream, release: (answer = { outcome: 'pushed', commit: 'a'.repeat(40), bytes: stream.length }) => release(answer) })),
  };
}

// Another drain must queue one fresh copy, rather than starting a concurrent push or losing it.
// proves R-RECORD-13
test('D6: a drain during a held push starts one follow-up after settlement, reading the stream then', async (t) => {
  const controlled = heldSide();
  const w = drainWorld(t, { side: controlled.side });
  const handed = [];
  const handOver = (each) => handed.push(each);
  w.context.sink.emitter({ layer: 'L3' }).emit('trigger', { trigger: 'drain' });
  const first = w.push({ ...w.context, handOver });
  t.after(() => { for (const held of controlled.held) held.release(); });
  w.push({ ...w.context, handOver });
  assert.equal(w.calls.length, 1, 'a drain while held starts no second push');
  w.context.sink.emitter({ layer: 'L3' }).emit('later.event', { value: 'after the queued drain' });
  controlled.held[0].release();
  await first;
  await waitFor(() => controlled.held.length === 2);
  assert.equal(controlled.held[0].stream.includes('later.event'), false);
  assert.ok(controlled.held[1].stream.includes('later.event'), 'the follow-up reads the stream when it leaves the queue');
  assert.ok(controlled.held[1].stream.includes('push.end'), 'the follow-up carries the preceding outcome');
  controlled.held[1].release();
  await waitFor(() => w.events().filter(({ event }) => event === 'push.end').length === 2);
  assert.equal(w.calls.length, 2);
  assert.deepEqual(handed, []);
  assertCopies(w);
});

// Once a follow-up has left the queue it is an in-flight push, so the return owes a later copy.
// proves R-RECORD-13
test('D8: a return after the follow-up starts waits for it and then pushes once', async (t) => {
  const controlled = heldSide();
  const w = drainWorld(t, { side: controlled.side });
  const handOver = () => {};
  w.context.sink.emitter({ layer: 'L3' }).emit('trigger', { trigger: 'drain' });
  const first = w.push({ ...w.context, handOver });
  w.push({ ...w.context, handOver });
  controlled.held[0].release();
  await first;
  await waitFor(() => controlled.held.length === 2);
  const answer = { text: 'passed', code: 0 };
  const returning = w.push({ ...w.context, answer });
  assert.equal(w.calls.length, 2, 'the return waits for the already-started follow-up');
  controlled.held[1].release();
  await waitFor(() => controlled.held.length === 3);
  controlled.held[2].release();
  assert.deepEqual(await returning, answer);
  assert.equal(w.calls.length, 3);
  assertCopies(w);
});

// A throwing verb skips its return push; ending a named sink does not revoke an in-flight append.
// proves R-RECORD-13
test('D20: a throwing verb ends its sink and makes no return push while the existing copy settles', async (t) => {
  const controlled = heldSide();
  const w = drainWorld(t, { side: controlled.side });
  const failure = new Error('the verb threw');
  let ended = 0;
  const verb = onClock(w.clock, () => recording(async (opened) => {
    opened.name(w.context.repository);
    opened.admitted(w.context.config);
    const end = opened.sink.end;
    opened.sink.end = () => { ended += 1; end(); };
    opened.sink.emitter({ layer: 'L3' }).emit('trigger', { trigger: 'drain' });
    w.push({ ...w.context, sink: opened.sink, run: opened.run, handOver: () => {} });
    throw failure;
  }, w.push));
  await assert.rejects(verb, (error) => error === failure);
  assert.equal(ended, 1, 'recording finally ended the sink on the throw');
  assert.equal(w.calls.length, 1, 'the throw started no return push');
  assert.equal(w.events().filter(({ event }) => event === 'push.end').length, 0);
  controlled.held[0].release();
  await waitFor(() => w.events().filter(({ event }) => event === 'push.end').length === 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(w.calls.length, 1, 'settlement after the throw starts no extra copy');
  const copied = w.calls[0].toString().trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(copied, w.events().slice(0, -1), 'the in-flight copy held every event at its start');
  assertCopies(w);
});
