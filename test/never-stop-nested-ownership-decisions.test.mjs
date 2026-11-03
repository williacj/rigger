// ABOUTME: Exercises nested ownership capture through the complete host module's registered callbacks, with in-process process answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDirectory } from './temporary-directory.mjs';

let evaluation = 0;

/** ChildProcess's nullable statuses and error/close streams, without a native process. */
function childAnswer(pid) {
  const child = new EventEmitter();
  Object.assign(child, { pid, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
  child.stdout.setEncoding = child.stderr.setEncoding = function () { return this; };
  child.close = (status, signal = null) => {
    child.exitCode = status;
    child.signalCode = signal;
    child.emit('close', status, signal);
  };
  return child;
}

// Harness diagnostic admitted by #1194 E/T; these assertions concern capture, not engine dispatch records.
// Break: omit a targeted read's actual return while the original real-close assertions still pass.
test('nested ownership capture retains targeted read originals alongside unchanged decisions', { timeout: 20_000 }, async (t) => {
  const directory = temporaryDirectory('rigger-1194-capture-', { context: t });
  const trace = join(directory, 'capture.jsonl');
  const title = 'nested ownership real close: answered, live descendant';
  const entry = new URL('./never-stop.test.mjs', import.meta.url);
  entry.searchParams.set('ownership-capture', String(++evaluation));
  const key = `nestedOwnershipAnswers${evaluation}`;
  const callbacks = new Map();
  const teardowns = [];
  const diagnostics = [];
  const calls = [];
  const birth = 'Wed Oct 28 12:00:00 2026';
  const command = 'recorded controlled payload';
  let state = 'S';
  let toolPid = 5000;
  // The payload's checked IPC schema and targeted ps argv come from the original host callback.
  // Answers model its documented ChildProcess contract; they are controlled, never native evidence.
  const collaborators = {
    test(name, ...args) { callbacks.set(name, args.at(-1)); },
    spawn(program, args) {
      calls.push({ program, args });
      if (args[0] === '-e') {
        assert.equal(program, process.execPath);
        const child = childAnswer(4242);
        child.send = (message) => {
          assert.equal(message, 'identified');
          queueMicrotask(() => child.close(7));
        };
        queueMicrotask(() => child.stdout.emit('data', '{"pid":4242,"descendant":4343}\n'));
        return child;
      }
      assert.deepEqual(args, ['-ww', '-p', '4343', '-o', 'lstart=,stat=,command=']);
      const child = childAnswer(++toolPid);
      const stdout = `${birth} ${state} ${command}\n`;
      queueMicrotask(() => { child.stdout.emit('data', stdout); child.close(0); });
      return child;
    },
    unexpected() { assert.fail('unexpected synchronous process start'); },
  };
  const modules = {
    'node:test': `export const test = globalThis[${JSON.stringify(key)}].test;`,
    'node:child_process': `export const spawn = globalThis[${JSON.stringify(key)}].spawn; export const spawnSync = globalThis[${JSON.stringify(key)}].unexpected;`,
  };
  const urls = new Map(Object.keys(modules).map((name) => [name, `nested-ownership-capture:${evaluation}/${name}`]));
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  const environment = new Map(['RIGGER_1194_CAPTURE', 'RIGGER_1194_RESULT'].map((name) => [name, { present: Object.hasOwn(process.env, name), value: process.env[name] }]));
  let hooks;
  let loaded = false;
  try {
    globalThis[key] = collaborators;
    process.env.RIGGER_1194_CAPTURE = trace;
    process.env.RIGGER_1194_RESULT = 'controlled-capture';
    t.mock.method(process, 'kill', (pid, signal) => {
      if (pid === 4343 && signal === 'SIGKILL') { state = 'Z'; return true; }
      assert.equal(pid, 4242);
      assert.equal(signal, 0);
      throw Object.assign(new Error('controlled reaped runner'), { code: 'ESRCH' });
    });
    hooks = registerHooks({
      resolve(specifier, context, next) {
        if (context.parentURL === entry.href && urls.has(specifier)) return { url: urls.get(specifier), shortCircuit: true };
        return next(specifier, context);
      },
      load(url, context, next) {
        for (const [name, value] of urls) if (url === value) return { format: 'module', source: modules[name], shortCircuit: true };
        const result = next(url, context);
        if (url === entry.href) {
          assert.deepEqual(Buffer.from(result.source), readFileSync(entry), 'actual helper module bytes must remain untransformed');
          loaded = true;
        }
        return result;
      },
    });
    await import(entry.href);
    assert.equal(loaded, true);
    assert.equal(typeof callbacks.get(title), 'function', 'the original registration must be captured');
    await callbacks.get(title)({ name: title, signal: t.signal, after: (hook) => teardowns.push(hook), diagnostic: (line) => diagnostics.push(line) });
    for (const hook of teardowns) await hook();
    assert.ok(diagnostics.some((line) => line.includes('"event":"complete","outcome":7')), 'the unchanged original outcome assertions must finish');
    assert.ok(existsSync(trace), 'targeted read originals were not retained');
    const rows = readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(rows.map(({ sequence }) => sequence), rows.map((_, index) => index + 1), 'capture emitter ordinals must be contiguous in append order');
    assert.deepEqual(rows.map(({ event }) => event), [
      'runner.spawn', 'ps.returned', 'identity', 'descendant.recorded', 'runner.close',
      'ps.returned', 'identity', 'descendant.signal', 'ps.returned', 'identity',
      'ps.returned', 'identity', 'descendant.final', 'complete', 'ps.returned',
    ], 'capture event identity must survive the inner payload');
    const reads = rows.filter(({ event }) => event === 'ps.returned');
    assert.deepEqual(reads.map(({ payload }) => payload.observation.stdout), [
      `${birth} S ${command}\n`, `${birth} S ${command}\n`,
      `${birth} Z ${command}\n`, `${birth} Z ${command}\n`, `${birth} Z ${command}\n`,
    ]);
    assert.ok(reads.every(({ payload: { observation } }) => observation.status === 0 && observation.signal === null && observation.stderr === '' && observation.error === null));
    assert.deepEqual(reads.map(({ payload }) => payload.readId), [1, 2, 3, 4, 5]);
    assert.ok(rows.every(({ result, caseName, writer }) => result === 'controlled-capture' && caseName === title && writer === process.pid), 'capture envelope identities must remain stable');
    const identities = rows.filter(({ event }) => event === 'identity');
    assert.deepEqual(identities.map(({ payload }) => [payload.readId, payload.phase]), [[1, 'recorded'], [2, 'before-signal'], [3, 'after-signal'], [4, 'final']]);
    const cleanup = identities.filter(({ payload }) => ['before-signal', 'after-signal'].includes(payload.phase));
    assert.deepEqual(cleanup.map(({ payload }) => payload.sequence), [1, 2], 'inner cleanup read sequence must remain available');
    assert.ok(cleanup.every(({ sequence, payload }) => sequence !== payload.sequence), 'inner cleanup read ordinals must remain distinct from emitter ordinals');
    for (const { payload } of identities) {
      const read = reads.find((row) => row.payload.readId === payload.readId);
      assert.equal(payload.requestedPid, Number(read.payload.observation.args[2]), 'identity must correlate with the same targeted read');
    }
    assert.deepEqual(rows.find(({ event }) => event === 'descendant.signal').payload.signal, { requestedPid: 4343, result: 'returned' });
    assert.equal(calls.length, 6, 'capture must add no tool call');
    const captured = readFileSync(trace);
    delete process.env.RIGGER_1194_CAPTURE;
    state = 'S';
    calls.length = 0;
    teardowns.length = 0;
    diagnostics.length = 0;
    await callbacks.get(title)({ name: title, signal: t.signal, after: (hook) => teardowns.push(hook), diagnostic: (line) => diagnostics.push(line) });
    for (const hook of teardowns) await hook();
    assert.ok(diagnostics.some((line) => line.includes('"event":"complete","outcome":7')), 'the unchanged original outcome assertions must finish without capture');
    assert.equal(calls.length, 6, 'disabled capture must retain the original tool-call count');
    assert.deepEqual(readFileSync(trace), captured, 'disabled capture must append no evidence');
  } finally {
    hooks?.deregister();
    t.mock.restoreAll();
    for (const [name, cell] of environment) {
      if (cell.present) process.env[name] = cell.value;
      else delete process.env[name];
    }
    if (previous) Object.defineProperty(globalThis, key, previous);
    else delete globalThis[key];
  }
});
