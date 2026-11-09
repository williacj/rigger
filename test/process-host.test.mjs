// ABOUTME: Tests L0's injected process-host answers, deadlines, clock validation and byte results.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as processAdapter from '../src/substrate/process.mjs';
import { runCommand } from '../src/substrate/process.mjs';
import { realHost } from '../src/substrate/host.mjs';

// ARCHITECTURE.md's L0 clock contract supplies callback handles without native timers.
function manualClock() {
  const pending = new Map();
  return {
    now: () => 0,
    pause: async () => {},
    schedule(done, delay) { const handle = {}; pending.set(handle, { done, delay }); return handle; },
    cancel(handle) { pending.delete(handle); },
  };
}

test('a supplied host clock is validated before process operations', async () => {
  // The four callable members come from the L0 clock contract. All other host methods
  // are inert tripwires, so a missing guard cannot reach a real process, path or timer.
  const methods = ['now', 'pause', 'schedule', 'cancel'];
  const complete = () => ({ now: () => 0, pause: async () => {}, schedule() {}, cancel() {} });
  const cells = [
    ['now/pause only', { now: () => 0, pause: async () => {} }, 'schedule|cancel'],
    ['absent clock', undefined, 'clock'],
    ['null clock', null, 'clock'],
    ...methods.flatMap((method) => {
      const absent = complete();
      delete absent[method];
      return [[`absent ${method}`, absent, method], [`non-callable ${method}`, { ...complete(), [method]: 17 }, method]];
    }),
  ];
  for (const [cell, clock, invalid] of cells) {
    for (const entry of ['containNow', 'runCommand', 'killRecordedGroup']) {
      const operations = [];
      const tripwire = (name) => (...args) => {
        operations.push(name);
        throw new Error(`unexpected inert host operation: ${name}`);
      };
      const host = { ps: '/controlled/ps', lsof: '/controlled/lsof', clock };
      for (const method of ['spawn', 'execFile', 'spawnSync', 'signal', 'killChild', 'stat', 'realpath', 'access', 'uid', 'pid']) host[method] = tripwire(method);
      if (clock) {
        host.clock = Object.fromEntries(Object.entries(clock).map(([name, value]) => [name, typeof value === 'function' ? tripwire(`clock.${name}`) : value]));
      }
      const emitter = { emit: tripwire('emit') };
      const invoke = () => entry === 'containNow'
        ? processAdapter.containNow(999999999, { host, readTimeout: 7 })
        : entry === 'runCommand'
          ? processAdapter.runCommand({ command: '/controlled/command', args: [], cwd: '/', env: {}, timeout: 7, emitter, host })
          : processAdapter.killRecordedGroup({ group: 999999999, started: 0, emitter, host, readTimeout: 7 });
      await assert.rejects(
        Promise.resolve().then(invoke),
        { name: 'TypeError', message: new RegExp(invalid) },
        `expected TypeError naming ${invalid} for ${entry}: ${cell}`,
      );
      assert.deepEqual(operations, [], `${entry}: ${cell} performed an operation before clock refusal`);
    }
  }
});

test('a supplied host cancels an answered identity read deadline', async () => {
  // schedule returns an opaque fixture token; cancel must remove that exact token.
  // The documented execFile callback is deferred until after schedule returns.
  const token = Object.freeze({ timer: 'identity-read' });
  const pending = new Map();
  const cancelled = [];
  const scheduled = [];
  const killed = [];
  const host = {
    ps: '/controlled/ps',
    execFile(_tool, _args, _options, done) {
      queueMicrotask(() => done(Object.assign(new Error('no match'), { code: 1 }), '', ''));
      return { stdout: { destroy() {} }, stderr: { destroy() {} } };
    },
    signal() { throw Object.assign(new Error('scripted absence'), { code: 'ESRCH' }); },
    killChild(_child, name) { killed.push(name); },
    clock: {
      now: () => 0,
      pause: async () => {},
      schedule(done, delay) { scheduled.push(delay); pending.set(token, done); return token; },
      cancel(handle) { cancelled.push(handle); pending.delete(handle); },
    },
  };
  await processAdapter.killRecordedGroup({ group: 999999999, started: 0, emitter: { emit() {} }, host, readTimeout: 7 });
  assert.deepEqual(scheduled, [7]);
  assert.equal(cancelled[0], token, 'the answered identity read did not cancel its supplied opaque handle');
  assert.equal(cancelled.length, 1, 'the answered identity read did not cancel exactly one deadline');
  for (const done of [...pending.values()]) done();
  assert.deepEqual(killed, [], 'an answered identity read retained a child-killing deadline');
});

test('a supplied host owns the synchronous group-presence answer', async () => {
  const asked = [];
  const host = {
    ...realHost,
    clock: manualClock(),
    signal(target, name) {
      asked.push([target, name]);
      throw Object.assign(new Error('the scripted group is absent'), { code: 'ESRCH' });
    },
  };
  assert.deepEqual(processAdapter.containNow(999999999, { host, readTimeout: 10 }), { kills: [] });
  assert.deepEqual(asked, [[-999999999, 0]]);
});

test('recorded-group identity reads use the supplied host and clock', async () => {
  const asked = [];
  let ticks = 0;
  const host = {
    ...realHost,
    ps: '/controlled/ps',
    signal(target, name) {
      asked.push(['signal', target, name]);
      throw Object.assign(new Error('scripted absence'), { code: 'ESRCH' });
    },
    execFile(tool, args, options, done) {
      asked.push(['read', tool, args]);
      queueMicrotask(() => done(Object.assign(new Error('no match'), { code: 1 }), '', ''));
      return { kill() {}, stdout: { destroy() {} }, stderr: { destroy() {} } };
    },
    clock: { ...manualClock(), now: () => { ticks += 1; return 0; } },
  };
  await processAdapter.killRecordedGroup({ group: 999999999, started: 0, emitter: { emit() {} }, host, readTimeout: 10 });
  assert.deepEqual(asked[0], ['read', '/controlled/ps', ['-ww', '-g', '999999999', '-o', 'pid=,stat=,lstart=']]);
  assert.ok(asked.some(([kind, target, name]) => kind === 'signal' && target === -999999999 && name === 0), 'the host did not answer group presence');
  assert.ok(asked.slice(1).every(([kind]) => kind === 'signal'), 'an unprovided process-table read occurred');
  assert.ok(ticks > 0, 'the controlled clock was not consulted for the identity-read deadline');
});

test('a supplied host clock cuts off a stalled start-identity read without wall time', async () => {
  const scheduled = [];
  const killed = [];
  let complete;
  const host = {
    ...realHost,
    ps: '/controlled/ps',
    execFile(_tool, _args, _options, done) {
      complete = done;
      return { stdout: { destroy() {} }, stderr: { destroy() {} } };
    },
    killChild(_child, name) {
      killed.push(name);
      queueMicrotask(() => complete(Object.assign(new Error('scripted read ended'), { code: 'SIGKILL' }), '', ''));
    },
    clock: {
      now: () => 0,
      pause: async () => {},
      schedule(done, delay) { scheduled.push(delay); queueMicrotask(done); return { unref() {} }; },
      cancel() {},
    },
  };
  await assert.rejects(
    processAdapter.killRecordedGroup({ group: 999999999, started: 0, emitter: { emit() {} }, host, readTimeout: 7 }),
    (failure) => failure.code === 'ETIMEDOUT',
  );
  assert.deepEqual(scheduled, [7]);
  assert.deepEqual(killed, ['SIGKILL']);
});

// proves R-STATE-14
test('a supplied host starts a controlled command without a real process', async () => {
  // Node EventEmitter and PassThrough provide the scripted child's event and byte contracts.
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const asked = [];
  const host = {
    ...realHost,
    clock: manualClock(),
    spawn(command, args, options) {
      asked.push(['spawn', command, args, options.detached]);
      const child = new EventEmitter();
      child.pid = 999999999;
      child.exitCode = null;
      child.signalCode = null;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        child.stdout.end(Buffer.from([65, 0, 255, 10]));
        child.stderr.end(Buffer.from([66, 254, 0, 13]));
      });
      return child;
    },
    signal(target, name) {
      asked.push(['signal', target, name]);
      throw Object.assign(new Error('scripted absence'), { code: 'ESRCH' });
    },
  };
  const result = await processAdapter.runCommand({
    command: '/controlled/command', args: [], cwd: '/', env: {}, timeout: 100,
    emitter: { emit() {} }, host,
  });
  assert.deepEqual([...result.stdout], [65, 0, 255, 10], 'the controlled command stdout bytes differ');
  assert.deepEqual([...result.stderr], [66, 254, 0, 13], 'the controlled command stderr bytes differ');
  assert.deepEqual([result.exit, result.timedOut, result.stdout.length, result.stderr.length], [0, false, 4, 4]);
  assert.deepEqual(asked[0], ['spawn', '/controlled/command', [], true]);
  assert.ok(asked.some(([kind, target, name]) => kind === 'signal' && target === -999999999 && name === 0), 'the host did not answer containment');
});

// proves R-STATE-14
test('a supplied host clock ends the output drain without wall time', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const scheduled = [];
  const events = [];
  const host = {
    ...realHost,
    spawn() {
      const child = new EventEmitter();
      child.pid = 999999999;
      child.exitCode = null;
      child.signalCode = null;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        child.stderr.end();
      });
      return child;
    },
    signal() { throw Object.assign(new Error('scripted absence'), { code: 'ESRCH' }); },
    clock: {
      now: () => 0,
      pause: async () => {},
      schedule(done, delay) {
        scheduled.push(delay);
        if (delay === 7) queueMicrotask(done);
        return { unref() {} };
      },
      cancel() {},
    },
  };
  const result = await processAdapter.runCommand({
    command: '/controlled/holder', args: [], cwd: '/', env: {}, timeout: 100,
    outputBound: 7, emitter: { emit: (name) => events.push(name) }, host,
  });
  assert.deepEqual(scheduled, [100, 7], 'the host did not schedule both command and output deadlines');
  assert.equal(result.exit, 0);
  assert.deepEqual(events, ['output.held']);
});

// proves R-STATE-16
test('a supplied host clock ends a running command at its deadline without wall time', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const scheduled = [];
  const cancelled = [];
  let child;
  const host = {
    ...realHost,
    spawn() {
      child = new EventEmitter();
      child.pid = 999999999;
      child.exitCode = null;
      child.signalCode = null;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      return child;
    },
    signal() { throw Object.assign(new Error('scripted absence'), { code: 'ESRCH' }); },
    clock: {
      now: () => 0,
      pause: async () => {},
      schedule(done, delay) {
        scheduled.push(delay);
        if (delay === 5) queueMicrotask(() => {
          done();
          queueMicrotask(() => {
            child.signalCode = 'SIGKILL';
            child.emit('exit', null, 'SIGKILL');
            child.stdout.end();
            child.stderr.end();
          });
        });
        return { unref() {}, delay };
      },
      cancel(timer) { cancelled.push(timer.delay); },
    },
  };
  const result = await runCommand({
    command: '/controlled/hung', args: [], cwd: '/', env: {}, timeout: 5,
    emitter: { emit() {} }, host,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exit, 0);
  assert.equal(scheduled[0], 5);
  assert.deepEqual(cancelled, scheduled);
});

