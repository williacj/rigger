// ABOUTME: Ordinary controls for fixture-owned child lifetime and raw process observations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { ownedChild, processIds, reaped, running, sweep } from './process-fixtures.mjs';

// These are repository fixture diagnostics, outside deployment requirements' Scope.
// Raw fields follow Node's spawnSync contract; STAT Z/S follow the PS producer contract.
const observation = (status, stdout, extra = {}) => ({ status, stdout, stderr: '', signal: null, error: undefined, ...extra });

test('PS observation distinguishes a successful zombie row from a live row', () => {
  assert.equal(reaped(observation(0, 'Z\n')), true);
  assert.equal(reaped(observation(0, 'S\n')), false);
});

test('PS observation refuses an unsupported nonzero status with empty output', () => {
  assert.equal(reaped(observation(2, '')), false, 'an unsupported PS status cannot prove absence');
});

test('PS observation refuses failed malformed contradictory and live raw results', () => {
  const cases = [
    observation(null, '', { signal: 'SIGTERM' }),
    observation(0, 'Z\n', { error: new Error('failed PS') }),
    observation(0, 'Z\n', { error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }),
    observation(0, 'Z\n', { signal: 'SIGTERM' }),
    observation(0, 'Z\n', { stderr: 'warning\n' }),
    observation(0, ''), observation(0, '   '), observation(0, 'Zombie\n'),
    observation(0, 'Z\nS\n'), observation(0, 'Z\nZ\n'), observation(0, 'Z\n\n'),
    observation(0, 'R\n'), observation(0, 'S+\n'), observation(0, 'T\n'),
    observation(1, 'Z\n'), observation(2, 'Z\n'), observation(255, ''),
    observation('0', 'Z\n'), observation(0.5, 'Z\n'),
    observation(0, undefined), observation(0, null), observation(0, Buffer.from('Z\n')),
    observation(0, 'Z\n', { stderr: undefined }),
    observation(0, 'Z\n', { signal: undefined }), undefined, null,
  ];
  for (const result of cases) assert.equal(reaped(result), false, 'unqualified PS observation: ' + String(result?.stdout));
});

// Linux ps(1) STAT modifiers and Apple's adv_cmds/ps/print.c define these rows.
// Native PS absence is separately qualified against an independently reaped child.
test('PS observation accepts qualified no-match and single zombie states', () => {
  assert.equal(reaped(observation(1, '')), true);
  for (const state of ['Z', 'Z<', 'ZN', 'ZL', 'Zs', 'Zl', 'Z+', 'Z<Lsl+', 'ZX', 'ZV', 'ZNXVLs+']) {
    assert.equal(reaped(observation(0, state + '\n')), true, state);
  }
});

// pgrep manuals define 0 as PID matches and 1 as no matches, with newline-separated PIDs.
// Missing/nonstring fields below are refusal diagnostics, not asserted native producer answers.
test('pgrep observation preserves valid PID strings and only qualified no-match is empty', () => {
  assert.deepEqual(processIds(observation(0, '4242\n')), ['4242']);
  assert.deepEqual(processIds(observation(0, '4242\n8484\n')), ['4242', '8484']);
  assert.deepEqual(processIds(observation(1, '')), []);
  for (const result of [
    observation(0, ''), observation(0, 'not-a-pid\n'), observation(0, '42\nno\n'),
    observation(0, '0\n'), observation(0, '-42\n'), observation(0, ' 42\n'),
    observation(0, '42\n\n'), observation(0, '9007199254740992\n'),
    observation(1, '42\n'), observation(2, ''), observation(3, ''), observation(255, ''),
    observation(null, '', { signal: 'SIGTERM' }),
    observation(0, '42\n', { error: new Error('failed') }),
    observation(0, '42\n', { error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }),
    observation(0, '42\n', { signal: 'SIGTERM' }),
    observation(0, '42\n', { stderr: 'warning' }),
    observation('0', '42\n'), observation(0.5, '42\n'),
    observation(0, undefined), observation(0, null), observation(0, Buffer.from('42\n')),
    observation(0, '42\n', { signal: undefined }), observation(0, '42\n', { stderr: undefined }),
    undefined, null,
  ]) assert.throws(() => processIds(result), /unqualified pgrep observation/);
});

// ChildProcess event shapes follow Node's contract. Kill records a request only;
// exit and close are separate controlled events, not native timing observations.
function controlledChild() {
  const trace = [];
  const hooks = [];
  const child = Object.assign(new EventEmitter(), {
    pid: 4242, exitCode: null, signalCode: null,
    kill: (signal) => { trace.push(['kill', signal]); return true; },
  });
  return {
    child, trace, hooks, context: { after: (hook) => hooks.push(hook) },
    exit: (code, signal) => { child.exitCode = code; child.signalCode = signal; trace.push(['exit', code, signal]); child.emit('exit', code, signal); },
    close: (code, signal) => { trace.push(['close', code, signal]); child.emit('close', code, signal); },
  };
}

test('owned child requests stop and retains its normal close result', async () => {
  const held = controlledChild();
  const ran = ownedChild(held.context, held.child, () => held.trace.push(['owner']));
  const cleanup = held.hooks[0]();
  assert.deepEqual(held.trace, [['kill', 'SIGKILL']]);
  held.exit(null, 'SIGKILL');
  held.close(null, 'SIGKILL');
  assert.deepEqual(await ran, [null, 'SIGKILL']);
  await cleanup;
});

test('owned teardown stays pending through exit and owner cleanup until recorded close', async () => {
  const held = controlledChild();
  const ran = ownedChild(held.context, held.child, () => held.trace.push(['owner']));
  const cleanup = Promise.resolve(held.hooks[0]()).then(() => held.trace.push(['cleaned']));
  try {
    assert.deepEqual(held.trace, [['kill', 'SIGKILL']]);
    held.exit(null, 'SIGKILL');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(held.trace.some(([event]) => event === 'cleaned'), false, 'owned teardown completed before actual close');
    assert.deepEqual(held.trace, [['kill', 'SIGKILL'], ['exit', null, 'SIGKILL'], ['owner']]);
  } finally {
    held.close(null, 'SIGKILL');
    await ran;
    await cleanup;
  }
  assert.deepEqual(held.trace, [['kill', 'SIGKILL'], ['exit', null, 'SIGKILL'], ['owner'], ['close', null, 'SIGKILL'], ['cleaned']]);
});

test('owned teardown uses recorded exit and close without an unnecessary kill', async () => {
  for (const alreadyClosed of [false, true]) {
    const held = controlledChild();
    const ran = ownedChild(held.context, held.child, () => held.trace.push(['owner']));
    held.exit(0, null);
    if (alreadyClosed) held.close(0, null);
    const cleanup = Promise.resolve(held.hooks[0]()).then(() => held.trace.push(['cleaned']));
    try {
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(held.trace.some(([event]) => event === 'kill'), false);
      assert.equal(held.trace.some(([event]) => event === 'owner'), true);
      if (!alreadyClosed) assert.equal(held.trace.some(([event]) => event === 'cleaned'), false);
    } finally {
      if (!alreadyClosed) held.close(0, null);
      await ran;
      await cleanup;
    }
    assert.deepEqual(held.trace, alreadyClosed
      ? [['exit', 0, null], ['close', 0, null], ['owner'], ['cleaned']]
      : [['exit', 0, null], ['owner'], ['close', 0, null], ['cleaned']]);
  }
});

// Node v26.12.0 subprocess.kill() documents true/false as kill(2)'s request result,
// separately from the exit/close events that establish observed lifecycle facts.
test('a false kill return cannot complete owned teardown before actual exit and close', async () => {
  const held = controlledChild();
  held.child.kill = (signal) => { held.trace.push(['kill', signal, false]); return false; };
  const ran = ownedChild(held.context, held.child, () => held.trace.push(['owner']));
  const cleanup = Promise.resolve(held.hooks[0]()).then(() => held.trace.push(['cleaned']));
  try {
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(held.trace, [['kill', 'SIGKILL', false]], 'a signal request result cannot supply exit or owner absence');
    held.exit(null, 'SIGKILL');
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(held.trace, [['kill', 'SIGKILL', false], ['exit', null, 'SIGKILL'], ['owner']]);
  } finally {
    if (held.child.signalCode === null) held.exit(null, 'SIGKILL');
    held.close(null, 'SIGKILL');
    await ran;
    await cleanup;
  }
  assert.deepEqual(held.trace, [['kill', 'SIGKILL', false], ['exit', null, 'SIGKILL'], ['owner'], ['close', null, 'SIGKILL'], ['cleaned']]);
});

// Node v26.12.0 onexit stores the negative spawn errno before error, then emits close without exit.
test('failed spawn retains its error and observes close without kill or an exit wait', async () => {
  const held = controlledChild();
  held.child.pid = undefined;
  const failure = Object.assign(new Error('spawn failed'), { code: 'ENOENT', errno: -2 });
  const ran = ownedChild(held.context, held.child, () => held.trace.push(['owner']));
  const normalFailure = ran.catch((error) => error);
  let outcome;
  const cleanup = Promise.resolve(held.hooks[0]()).then(() => { outcome = 'success'; }, (error) => { outcome = error; });
  let errorEmitted = false;
  let closeEmitted = false;
  try {
    assert.deepEqual(held.trace.slice(), [], 'a failed spawn cannot be killed as a live child');
    errorEmitted = true;
    held.child.exitCode = failure.errno;
    held.child.emit('error', failure);
    assert.equal(await normalFailure, failure);
    await Promise.resolve();
    assert.equal(outcome, undefined, 'failed spawn close is not yet observed');
    closeEmitted = true;
    held.close(-2, null);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(outcome, failure, 'failed spawn must report its error after close without an exit event');
    await cleanup;
    assert.deepEqual(held.trace, [['owner'], ['close', -2, null]]);
  } finally {
    if (!errorEmitted) { held.child.exitCode = failure.errno; held.child.emit('error', failure); }
    if (!closeEmitted) held.close(-2, null);
    await normalFailure;
  }
});

test('termination and owner throws fail teardown without inventing close', async () => {
  for (const source of ['termination', 'owner']) {
    const held = controlledChild();
    const failure = new Error(source + ' failed');
    if (source === 'termination') held.child.kill = (signal) => { held.trace.push(['kill', signal]); throw failure; };
    const ran = ownedChild(held.context, held.child, () => { held.trace.push(['owner']); if (source === 'owner') throw failure; });
    let outcome;
    const cleanup = Promise.resolve(held.hooks[0]()).then(() => { outcome = 'success'; }, (error) => { outcome = error; });
    try {
      if (source === 'owner') held.exit(null, 'SIGKILL');
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(outcome, failure, 'a concrete failure cannot be concealed behind pending close');
      assert.equal(held.trace.some(([event]) => event === 'close'), false, 'close remains unobserved at failure');
      assert.deepEqual(held.trace, source === 'termination'
        ? [['kill', 'SIGKILL']]
        : [['kill', 'SIGKILL'], ['exit', null, 'SIGKILL'], ['owner']]);
    } finally {
      if (held.child.signalCode === null) held.exit(null, 'SIGKILL');
      held.close(null, 'SIGKILL');
      await ran;
      await cleanup;
    }
  }
});

test('an emitted termination error fails before exit without claiming owner cleanup or close', async () => {
  for (const duringKill of [false, true]) {
    const held = controlledChild();
    const failure = new Error('signal request failed');
    if (duringKill) held.child.kill = (signal) => {
      held.trace.push(['kill', signal]);
      held.child.emit('error', failure);
      return false;
    };
    const ran = ownedChild(held.context, held.child, () => held.trace.push(['owner']));
    const normalFailure = ran.catch((error) => error);
    let outcome;
    const cleanup = Promise.resolve(held.hooks[0]()).then(() => { outcome = 'success'; }, (error) => { outcome = error; });
    try {
      assert.deepEqual(held.trace, [['kill', 'SIGKILL']]);
      if (!duringKill) held.child.emit('error', failure);
      assert.equal(await normalFailure, failure);
      await Promise.resolve();
      assert.equal(outcome, failure);
      assert.deepEqual(held.trace, [['kill', 'SIGKILL']], 'failed termination has proved neither exit nor owner absence nor close');
    } finally {
      held.exit(null, 'SIGKILL');
      held.close(null, 'SIGKILL');
      await normalFailure;
      await cleanup;
    }
  }
});

test('failed spawn uses recorded error and close without requiring an exit event', async () => {
  for (const alreadyClosed of [false, true]) {
    const held = controlledChild();
    held.child.pid = undefined;
    const failure = Object.assign(new Error('spawn failed'), { code: 'ENOENT', errno: -2 });
    const ran = ownedChild(held.context, held.child, () => held.trace.push(['owner']));
    const normalFailure = ran.catch((error) => error);
    held.child.exitCode = failure.errno;
    held.child.emit('error', failure);
    if (alreadyClosed) held.close(-2, null);
    let outcome;
    const cleanup = Promise.resolve(held.hooks[0]()).then(() => { outcome = 'success'; }, (error) => { outcome = error; });
    try {
      assert.equal(await normalFailure, failure);
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(held.trace.some(([event]) => event === 'kill' || event === 'exit'), false);
      assert.equal(held.trace.some(([event]) => event === 'owner'), true);
      assert.equal(outcome, alreadyClosed ? failure : undefined);
    } finally {
      if (!alreadyClosed) held.close(-2, null);
      await normalFailure;
    }
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(outcome, failure, 'recorded failure and close must not require an event that cannot occur');
    await cleanup;
  }
});

const childProcess = createRequire(import.meta.url)('node:child_process');

function withProcessTableResults(results, check) {
  const original = childProcess.spawnSync;
  const calls = [];
  childProcess.spawnSync = (command, args, options) => {
    if (command !== '/usr/bin/pgrep' && command !== '/usr/bin/pkill') return original(command, args, options);
    calls.push({ command, args, options });
    const answer = results.shift();
    assert.ok(answer, `unexpected ${command} after ${calls.length} commands`);
    return answer;
  };
  syncBuiltinESMExports();
  try {
    check(calls);
    assert.equal(results.length, 0, 'a process-table answer was not read');
  } finally {
    childProcess.spawnSync = original;
    syncBuiltinESMExports();
  }
}

const processTableResult = (status, stdout, extra = {}) => ({ status, stdout, stderr: '', signal: null, error: undefined, ...extra });

test('control: a process-table read preserves raw fields and refuses unqualified results', () => {
  for (const status of [0, 1, 2, 3, 255, null]) {
    for (const stdout of ['', '4242\n', 'not-a-pid\n']) {
      const result = processTableResult(status, stdout, status === null ? { signal: 'SIGTERM' } : {});
      const before = { ...result };
      withProcessTableResults([result], (calls) => {
        if (status === 0 && stdout === '4242\n') assert.deepEqual(running('rigger-779-absent'), ['4242']);
        else if (status === 1 && stdout === '') assert.deepEqual(running('rigger-779-absent'), []);
        else assert.throws(() => running('rigger-779-absent'), /unqualified pgrep observation/);
        assert.deepEqual(calls.map(({ command }) => command), ['/usr/bin/pgrep']);
        assert.equal(result.status, status);
        assert.equal(result.stdout, stdout);
        assert.deepEqual(result, before);
      });
    }
  }
  withProcessTableResults([processTableResult(null, undefined, { error: new Error('failed launch') })], (calls) => {
    assert.throws(() => running('rigger-779-absent'), /unqualified pgrep observation/);
    assert.equal(calls.length, 1);
  });
});

test('control: sweep refuses unqualified initial reads and accepts qualified absence', () => {
  for (const status of [2, 0, 1, 3, 255, null]) {
    const result = processTableResult(status, '', status === null ? { signal: 'SIGTERM' } : {});
    withProcessTableResults([result], (calls) => {
      if (status === 1) sweep('rigger-779-absent');
      else assert.throws(() => sweep('rigger-779-absent'), /unqualified pgrep observation/, 'an unknown initial read cannot prove owner absence');
      assert.deepEqual(calls.map(({ command }) => command), ['/usr/bin/pgrep']);
      assert.equal(result.status, status);
      assert.equal(result.stdout, '');
    });
  }
  withProcessTableResults([processTableResult(null, undefined, { error: new Error('failed launch') })], (calls) => {
    assert.throws(() => sweep('rigger-779-absent'), /unqualified pgrep observation/);
    assert.deepEqual(calls.map(({ command }) => command), ['/usr/bin/pgrep']);
  });
});

test('control: sweep checks first later and final qualified reads despite failed pkill returns', () => {
  for (const status of [0, 1, 2, 3, 255, null]) {
    for (const stdout of ['4242\n', 'not-a-pid\n']) {
      const first = processTableResult(status, stdout, status === null ? { signal: 'SIGTERM' } : {});
      const occupied = status === 0 && stdout === '4242\n';
      withProcessTableResults(occupied ? [first, processTableResult(0, ''), processTableResult(1, '')] : [first], (calls) => {
        if (occupied) sweep('rigger-779-absent');
        else assert.throws(() => sweep('rigger-779-absent'), /unqualified pgrep observation/);
        assert.deepEqual(calls.map(({ command }) => command), occupied
          ? ['/usr/bin/pgrep', '/usr/bin/pkill', '/usr/bin/pgrep'] : ['/usr/bin/pgrep']);
      });
    }
  }
  for (const occupied of [1, 2, 10]) {
    const answers = Array.from({ length: occupied }, () => [processTableResult(0, '4242\n'), processTableResult(2, '')]).flat();
    answers.push(processTableResult(1, ''));
    withProcessTableResults(answers, (calls) => {
      sweep('rigger-779-absent');
      assert.equal(calls.filter(({ command }) => command === '/usr/bin/pgrep').length, occupied + 1);
      assert.equal(calls.filter(({ command }) => command === '/usr/bin/pkill').length, occupied);
    });
  }
  const answers = Array.from({ length: 10 }, () => [processTableResult(0, '4242\n'), processTableResult(2, '')]).flat();
  answers.push(processTableResult(0, '4242\n'));
  withProcessTableResults(answers, (calls) => {
    assert.throws(() => sweep('rigger-779-absent'), /4242/);
    assert.equal(calls.filter(({ command }) => command === '/usr/bin/pgrep').length, 11);
    assert.equal(calls.filter(({ command }) => command === '/usr/bin/pkill').length, 10);
  });
  withProcessTableResults([
    processTableResult(0, '4242\n'),
    processTableResult(null, undefined, { error: new Error('pkill failed to launch') }),
    processTableResult(1, ''),
  ], (calls) => {
    sweep('rigger-779-absent');
    assert.deepEqual(calls.map(({ command }) => command), ['/usr/bin/pgrep', '/usr/bin/pkill', '/usr/bin/pgrep']);
  });
  for (const occupied of [2, 10]) {
    for (const unknown of [
      processTableResult(2, ''),
      processTableResult(null, '', { signal: 'SIGTERM' }),
      processTableResult(null, undefined, { error: new Error('pgrep failed to launch') }),
    ]) {
      const answers = Array.from({ length: occupied }, () => [processTableResult(0, '4242\n'), processTableResult(2, '')]).flat();
      answers.push(unknown);
      withProcessTableResults(answers, (calls) => {
        assert.throws(() => sweep('rigger-779-absent'), /unqualified pgrep observation/, 'an unknown later or final read cannot prove owner absence');
        assert.deepEqual(calls.map(({ command }) => command),
          [...Array.from({ length: occupied }, () => ['/usr/bin/pgrep', '/usr/bin/pkill']).flat(), '/usr/bin/pgrep']);
      });
    }
  }
});
