// ABOUTME: Tests dispatch descendant tracking with an injected process table and clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../src/substrate/process.mjs';
import { trackerWorld, turn } from './process-fixtures.mjs';
import { manualClock } from './clock-report-world.mjs';

test('T11: the tracker reads every injected second and serializes a read that outlasts the period', { timeout: 10_000 }, async (t) => {
  await t.test('a slow periodic read defers the next until it settles', async (t) => {
    const clock = manualClock(0);
    const world = trackerWorld(clock);
    let release;
    const running = runCommand({ command: '/controlled/command', args: [], cwd: '/', env: {}, timeout: 60_000, track: true, host: world.host, emitter: world.emitter });
    t.after(async () => { world.inject(() => undefined); release?.(); world.finish(); await running; });
    const observed = () => world.reads.filter(({ args }) => args.includes('-A'));
    await turn(t);
    assert.equal(observed().length, 1, 'the first dispatch had no immediate tracker read');
    await clock.advance(999);
    await turn(t);
    assert.equal(observed().length, 1, 'the tracker read before its period');
    world.inject((_tool, args) => args.includes('-A') ? { hold: (done) => { release = done; }, stdout: '' } : undefined);
    const advancing = clock.advance(1000);
    await turn(t);
    assert.equal(observed().length, 2);
    await clock.advance(2500);
    await turn(t);
    assert.equal(observed().length, 2, 'a tracker read overlapped the slow read');
    world.inject(() => undefined);
    release();
    await advancing;
    await turn(t);
    await clock.advance(2500);
    await turn(t);
    assert.deepEqual(observed().map(({ at }) => at), [0, 1000, 2500], 'the overdue read did not start once the slow read settled');
    world.finish();
    await running;
  });
  await t.test('exit final reads serve dispatches not yet reached', async (t) => {
    const { EventEmitter } = await import('node:events');
    const { PassThrough } = await import('node:stream');
    const clock = manualClock(0);
    const world = trackerWorld(clock);
    const finalOnly = world.table.get(world.escaped);
    world.table.delete(world.escaped);
    const secondGroup = world.group + 100;
    const second = Object.assign(new EventEmitter(), { pid: secondGroup, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
    let spawned = false;
    const host = { ...world.host, spawn: () => {
      if (spawned) return second;
      spawned = true;
      return world.host.spawn();
    } };
    const finishSecond = () => {
      if (second.exitCode !== null) return;
      world.table.delete(secondGroup);
      second.exitCode = 0;
      second.emit('exit', 0, null);
      second.stdout.end();
      second.stderr.end();
    };
    const options = { command: '/controlled/command', args: [], cwd: '/', env: {}, timeout: 60_000, track: true, host, emitter: world.emitter };
    const firstRunning = runCommand(options);
    let secondRunning;
    t.after(async () => { world.inject(() => undefined); finishSecond(); world.finish(); await Promise.all([firstRunning, secondRunning]); });
    await turn(t);
    world.table.set(secondGroup, { ...finalOnly, pid: secondGroup, parent: 1, group: secondGroup });
    secondRunning = runCommand(options);
    await turn(t);
    finalOnly.parent = secondGroup;
    world.table.set(world.escaped, finalOnly);
    // A's final read alone sees B's descendant before A's group cleanup reparents it.
    world.inject((_tool, args) => {
      if (args.includes('-g') && Number(args[args.indexOf('-g') + 1]) === world.group) finalOnly.parent = 1;
      return undefined;
    });
    const cleanup = process.listeners('exit').find(({ name }) => name === 'cleanup');
    assert.equal(typeof cleanup, 'function');
    cleanup();
    finishSecond();
    world.finish();
    await Promise.all([firstRunning, secondRunning]);
    assert.ok(world.signals.some(({ target, name }) => target === world.escaped && name === 'SIGKILL'), "A's exit read did not retain B's descendant");
    assert.deepEqual(world.events.filter(({ pid }) => pid === world.escaped).map(({ event }) => event), ['survivor.killed']);
  });
  // A final read belongs to C, so A can end on either side of its settlement.
  // Each held answer is generated at release, as ps may execute after its spawn.
  for (const kind of ['periodic', 'final'])
    for (const admission of ['before', 'during', 'after'])
      for (const failure of [false, true])
        for (const ending of ['before', 'after'])
          for (const late of [false, true])
            for (const stoppedLate of late && ending === 'before' ? [false, true] : [false])
              for (const peerEnding of admission === 'after' ? ['after'] : ['before', 'after']) await t.test(
            `${stoppedLate ? 'turnover after deadline; ' : ''}${kind}; B admitted ${admission}; ${failure ? 'failure' : 'success'}; A ends ${ending}; B ends ${peerEnding}; release ${late ? 'after' : 'before'} deadline`, async (t) => {
    const { EventEmitter } = await import('node:events');
    const { PassThrough } = await import('node:stream');
    const clock = manualClock(0);
    const timers = new Map();
    const live = new Set();
    const peerCancellations = [];
    let maxTimers = 0;
    const world = trackerWorld({ ...clock,
      schedule(callback, delay) {
        const timer = clock.schedule(() => {
          timers.delete(timer.id);
          return callback();
        }, delay);
        if (callback.tracker) timers.set(timer.id, clock.now() + delay);
        maxTimers = Math.max(maxTimers, timers.size);
        return timer;
      },
      cancel(timer) {
        if (timers.has(timer.id) && live.size > 0) peerCancellations.push(clock.now());
        timers.delete(timer.id);
        return clock.cancel(timer);
      },
    });
    const exemplar = { ...world.table.get(world.escaped) };
    const b = world.group + 100;
    const c = world.group + 200;
    const children = new Map();
    const runs = [];
    let count = 0;
    let release;
    let armed = false;
    let inFlight = 0;
    let maxReads = 0;
    const starts = [];
    const heldGroups = new Set();
    const finish = (group) => {
      live.delete(group);
      if (group === world.group) { world.finish(); return; }
      const child = children.get(group);
      if (!child || child.exitCode !== null) return;
      world.table.delete(group);
      child.exitCode = 0;
      child.emit('exit', 0, null);
      child.stdout.end(); child.stderr.end();
    };
    const host = { ...world.host,
      spawn() {
        const group = count++ === 0 ? world.group : count === 2 && kind === 'final' ? c : b;
        live.add(group);
        if (group === world.group) return world.host.spawn();
        const child = Object.assign(new EventEmitter(), { pid: group, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
        children.set(group, child);
        world.table.set(group, { ...exemplar, pid: group, parent: 1, group });
        return child;
      },
      execFile(tool, args, options, done) {
        if (!args.includes('-A')) return world.host.execFile(tool, args, options, done);
        starts.push(clock.now());
        maxReads = Math.max(maxReads, ++inFlight);
        const answer = () => world.host.execFile(tool, args, options, (...result) => { inFlight -= 1; done(...result); });
        if (!armed) return answer();
        armed = false;
        release = () => {
          for (const group of [world.group, c, b].filter((group) => group === world.group || children.has(group))) {
            const parent = group + 1;
            const pid = group + 20;
            world.table.set(parent, { ...exemplar, pid: parent, parent: group, group });
            world.table.set(pid, { ...exemplar, pid, parent, group: pid });
            heldGroups.add(group);
          }
          world.inject((_tool, argv) => argv.includes('-A') && failure ? { error: new Error('shared tracker refused'), stdout: '' } : undefined);
          const result = answer();
          world.inject(() => undefined);
          // Only the released response can establish these descendants' attribution.
          for (const group of heldGroups) {
            world.table.delete(group + 1);
            world.table.get(group + 20).parent = 1;
          }
          return result;
        };
        return { stdout: { destroy() {} }, stderr: { destroy() {} } };
      },
    };
    const start = () => {
      const run = runCommand({ command: '/controlled/command', args: [], cwd: '/', env: {}, timeout: 60_000, track: true, host, emitter: world.emitter });
      runs.push(run);
      return run;
    };
    const wakes = [];
    const advance = async (at) => { wakes.push(clock.advance(at)); await turn(t); };
    t.after(async () => {
      armed = false; world.inject(() => undefined);
      release?.(); release = undefined;
      for (const group of [...live]) finish(group);
      await Promise.all([...runs, ...wakes]);
    });
    start();
    await turn(t);
    if (kind === 'final') { start(); await turn(t); }
    const began = kind === 'final' ? 500 : 1000;
    const deadline = kind === 'final' ? 1000 : 2000;
    if (admission === 'before') { await advance(began - 100); start(); await turn(t); }
    armed = true;
    if (kind === 'final') { await advance(began); finish(c); await turn(t); }
    else await advance(began);
    assert.equal(typeof release, 'function', 'the chosen read was not held');
    if (admission === 'during' && ending === 'after') { await advance(began + 100); start(); await turn(t); }
    if (stoppedLate) await advance(deadline);
    if (ending === 'before') {
      await advance(stoppedLate ? deadline + 50 : began + 50);
      finish(world.group); await turn(t);
    }
    if (admission === 'during' && ending === 'before') { await advance(stoppedLate ? deadline + 100 : began + 100); start(); await turn(t); }
    if (peerEnding === 'before') { finish(b); await turn(t); }
    const released = deadline + (late ? 250 : -250);
    await advance(released);
    assert.equal(maxReads, 1, 'a whole-table read overlapped the held read');
    const settle = release; release = undefined; settle();
    await turn(t);
    // Cleanup may spend injected time before the overdue read actually starts.
    const settledRead = starts.at(-1);
    const periodicNeeded = (late && (ending === 'after' || admission !== 'after')) || (ending === 'before' && admission === 'during');
    if (peerEnding === 'after') assert.equal(starts.length, 2 + (ending === 'before' ? 1 : 0) + (periodicNeeded ? 1 : 0), 'turnover queued duplicate periodic service');
    if (ending === 'after') { await advance(released + 50); finish(world.group); await turn(t); }
    if (admission === 'after') {
      await advance(released + 100); start(); await turn(t);
      world.table.set(b + 20, { ...exemplar, pid: b + 20, parent: 1, group: b + 20 });
    }
    assert.equal(maxTimers, 1, 'more than one periodic timer was pending');
    assert.equal(maxReads, 1, 'more than one whole-table read was in flight');
    assert.deepEqual(peerCancellations, [], 'an ending cancelled a running peer timer');
    if (live.size === 0) assert.equal(timers.size, 0, 'the last ending retained periodic service');
    else {
      assert.equal(timers.size, 1, 'settlement did not arm exactly one periodic timer');
      const turnover = ending === 'before' && admission === 'during';
      const expectedDue = admission === 'after' ? released + 1100
        : turnover ? settledRead + 1000 : late ? settledRead + 1000 : deadline;
      assert.deepEqual([...timers.values()], [expectedDue], 'a final read or ending moved the shared period');
      const before = starts.length;
      await advance(expectedDue - 1);
      assert.equal(starts.length, before, 'periodic service ran early');
      await advance(expectedDue);
      assert.equal(starts.length, before + 1, 'periodic service did not run exactly once at its deadline');
    }
    finish(b);
    await Promise.all(runs);
    for (const group of [world.group, b, ...(kind === 'final' ? [c] : [])]) {
      const shown = heldGroups.has(group);
      const killed = world.signals.filter(({ target, name }) => target === group + 20 && name === 'SIGKILL');
      assert.equal(killed.length, failure || !shown ? 0 : 1, `descendant attribution differs for ${group}`);
      const unread = world.events.filter(({ event, group: recorded }) => event === 'descendants.unread' && recorded === group);
      assert.equal(unread.length, failure && shown ? 1 : 0, `read failure delivery differs for ${group}`);
      if (failure && shown) assert.match(unread[0].census, /shared tracker refused/);
    }
    assert.ok(world.signals.some(({ target, name }) => target === world.escaped && name === 'SIGKILL'), 'a shared failure lost the earlier tracked identity');
    assert.equal(maxReads, 1);
    assert.equal(maxTimers, 1);
    assert.equal(timers.size, 0, 'an idle tracker retained a timer');
  });

});

/** A running controlled dispatch with a first observation before the test changes the host. */
async function trackedDispatch(t) {
  const clock = manualClock(0);
  const world = trackerWorld(clock);
  const running = runCommand({ command: '/controlled/command', args: [], cwd: '/', env: {}, timeout: 60_000, track: true, host: world.host, emitter: world.emitter });
  t.after(async () => { world.inject(() => undefined); world.finish(); await running; });
  await turn(t);
  return { ...world, clock, running };
}

test('T8: a tracked pid reused before its stopped identity check is resumed without a kill record', { timeout: 10_000 }, async (t) => {
  const world = await trackedDispatch(t);
  world.inject((_tool, args) => {
    const row = world.table.get(world.escaped);
    if (args.at(-1) === 'pid=,stat=' && row.state === 'T') row.started = 'Thu Oct 29 12:00:01 2026';
    return undefined;
  });
  world.finish();
  await world.running;

  for (const read of ['periodic', 'final', 'reparented']) {
    for (const reused of [false, true]) {
      await t.test(`${read} read; ${reused ? 'reused' : 'unchanged'} tracked parent`, async (t) => {
        const world = await trackedDispatch(t);
        const original = { ...world.table.get(world.escaped) };
        const retained = world.escaped + 100;
        const newcomer = world.escaped + 1000;
        world.table.set(retained, { ...original, pid: retained, parent: world.escaped, group: retained, cmd: 'original descendant' });
        await world.clock.advance(1000);
        await turn(t);
        if (read === 'reparented') {
          world.table.get(world.escaped).parent = 1;
          await world.clock.advance(2000);
          await turn(t);
        }
        world.table.set(world.escaped, { ...world.table.get(world.escaped),
          started: reused ? 'Thu Oct 29 12:00:01 2026' : original.started });
        world.table.set(newcomer, { ...original, pid: newcomer, parent: world.escaped, group: newcomer,
          started: 'Thu Oct 29 12:00:02 2026', cmd: 'later child' });
        if (read !== 'final') {
          await world.clock.advance(world.clock.now() + 1000);
          await turn(t);
        }
        world.finish();
        await world.running;
        assert.deepEqual(world.events.filter(({ pid }) => pid === retained).map(({ event }) => event), ['survivor.killed'], 'the original descendant lost its attribution');
        if (reused) {
          assert.deepEqual(world.signals.filter(({ target }) => target === newcomer), [], 'the child of a reused unrelated parent was signalled as a dispatch descendant');
          assert.deepEqual(world.events.filter(({ pid }) => pid === newcomer), [], 'the unrelated child was recorded');
        } else {
          assert.deepEqual(world.events.filter(({ pid }) => pid === newcomer).map(({ event }) => event), ['survivor.killed'], 'the unchanged parent did not attribute its child');
        }
      });
    }
  }
  assert.deepEqual(world.signals.filter(({ target }) => target === world.escaped).map(({ name }) => name), ['SIGSTOP', 'SIGCONT']);
  assert.equal(world.events.some(({ pid }) => pid === world.escaped), false, 'the reused pid was recorded as killed');

});

test('T9: a tracked process refusing signals and one outliving the kill are recorded as unended', { timeout: 10_000 }, async (t) => {
  for (const property of ['refuses', 'outlives']) {
    const world = await trackedDispatch(t);
    world.table.get(world.escaped)[property] = true;
    world.finish();
    await world.running;
    assert.deepEqual(world.events.filter(({ pid }) => pid === world.escaped).map(({ event }) => event), ['survivor.unended'], property);
  }
});

test('T10: failed, timed-out and malformed tracker reads preserve the set and report why without failing the dispatch', { timeout: 10_000 }, async (t) => {
  for (const fault of [
    { error: Object.assign(new Error('tracker refused'), { code: 2 }), stdout: '', stderr: 'tracker refused' },
    { error: Object.assign(new Error('tracker timed out'), { code: 'ETIMEDOUT' }), stdout: '' },
    { stdout: 'not a process row\n' },
  ]) {
    const world = await trackedDispatch(t);
    world.table.get(world.escaped).parent = 1;
    world.inject((_tool, args) => args.includes('-A') ? fault : undefined);
    await world.clock.advance(1000);
    await turn(t);
    world.finish();
    const result = await world.running;
    assert.equal(result.exit, 0, 'the tracker failure failed the dispatch');
    assert.deepEqual(world.events.filter(({ pid }) => pid === world.escaped).map(({ event }) => event), ['survivor.killed'], 'the failed read lost a tracked process');
    const unread = world.events.filter(({ event }) => event === 'descendants.unread');
    assert.equal(unread.length, 1);
    assert.equal(unread[0].group, world.group);
    assert.match(unread[0].census, /tracker refused|tracker timed out|cannot read/);
  }
});

test('T10b: later periodic failures retain the reparented identity for the answering final read', { timeout: 10_000 }, async (t) => {
  const world = await trackedDispatch(t);
  world.table.get(world.escaped).parent = 1;
  world.inject((_tool, args) => args.includes('-A') ? { error: new Error('periodic failed'), stdout: '' } : undefined);
  await world.clock.advance(1000);
  await turn(t);
  world.inject(() => undefined);
  world.finish();
  await world.running;
  assert.ok(world.signals.some(({ target, name }) => target === world.escaped && name === 'SIGKILL'), 'the retained M6x was not killed');
  assert.deepEqual(world.events.filter(({ pid }) => pid === world.escaped).map(({ event }) => event), ['survivor.killed']);
});

test('T12: the tracker reads nothing while no dispatch is running', { timeout: 10_000 }, async (t) => {
  const world = await trackedDispatch(t);
  world.finish();
  await world.running;
  const before = world.reads.length;
  await world.clock.advance(world.clock.now() + 10_000);
  await turn(t);
  assert.equal(world.reads.length, before, 'an idle tracker read the table');
});

test('T13: a descendant first shown by the final read is killed before the group', { timeout: 10_000 }, async (t) => {
  const clock = manualClock(0);
  const world = trackerWorld(clock);
  const row = world.table.get(world.escaped);
  world.table.delete(world.escaped);
  const running = runCommand({ command: '/controlled/command', args: [], cwd: '/', env: {}, timeout: 60_000, track: true, host: world.host, emitter: world.emitter });
  t.after(async () => { world.finish(); await running; });
  await turn(t);
  assert.equal(world.reads.filter(({ args }) => args.includes('-A')).length, 1);
  world.table.set(world.escaped, row);
  world.finish();
  await running;
  const kills = world.signals.filter(({ name }) => name === 'SIGKILL').map(({ target }) => target);
  assert.ok(kills.indexOf(world.escaped) >= 0, 'the final-read descendant was not killed');
  assert.ok(kills.indexOf(world.escaped) < kills.indexOf(-world.group), 'the group was killed before its descendant');
});

test('T14: a tracked process absent at the ending gets no signal and no survivor event', { timeout: 10_000 }, async (t) => {
  const world = await trackedDispatch(t);
  world.table.delete(world.escaped);
  world.finish();
  await world.running;
  assert.equal(world.signals.some(({ target }) => target === world.escaped), false);
  assert.equal(world.events.some(({ pid }) => pid === world.escaped), false);
});
