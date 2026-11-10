// ABOUTME: Checks the diagnostic trace schema and its independence from test and process outcomes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Channel } from 'node:diagnostics_channel';
import { EventEmitter } from 'node:events';
import { traceFile } from './file-trace.mjs';

const STAMP = '2026-11-10T12:00:00.000Z';

// Channel payloads and TestContext getters follow Node's documented test instrumentation:
// https://nodejs.org/docs/v26.13.0/api/test.html#test-instrumentation-and-opentelemetry
// Cancellation failureType values and final postRun ordering are observed in Node v26.13.0:
// https://github.com/nodejs/node/blob/v26.13.0/lib/internal/test_runner/test.js
// The live count fields and TestHook harness are observed in the same release:
// https://github.com/nodejs/node/blob/v26.13.0/lib/internal/test_runner/harness.js
// The process stand-in uses the real EventEmitter contract and a supplied uptime reading.
function world(options = {}) {
  let start;
  let finish;
  const lines = [];
  const completed = new Channel('file-trace-fixture');
  const runtime = Object.assign(new EventEmitter(), { uptime: () => 3.5 });
  traceFile('test/subject.mjs', {
    beforeEach: (hook) => { start = hook; }, after: (hook) => { finish = hook; }, completed, runtime,
    readTotals: () => ({ tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0, topLevel: 0, suites: 0 }),
    now: () => STAMP, write: (line) => lines.push(line), ...options,
  });
  return {
    lines, runtime,
    start: (context) => start?.(context),
    end: (name, nesting = 0) => completed.publish({ name, nesting, type: 'test', file: '/test/subject.mjs' }),
    finishProcess: (code) => { finish?.(); return runtime.emit('exit', code); },
    rows: (kind) => lines.filter((line) => line.startsWith('RIGGER_TEST_' + kind + ' '))
      .map((line) => JSON.parse(line.slice(line.indexOf(' ') + 1))),
  };
}

// Missing start records or text concatenation would lose progress or split a special title.
test('a trace starts each top-level test with its exact name time and process uptime in one JSON line', () => {
  const seen = world();
  const name = 'a title\nwith "quotes" and \\';
  seen.start({ name, fullName: name, passed: false, error: null });
  seen.start({ name: 'inner', fullName: name + ' > inner', passed: false, error: null });

  assert.deepEqual(seen.rows('START'), [{ name, time: STAMP, uptime: 3.5 }]);
  assert.equal(seen.lines.length, 1);
  assert.equal(seen.lines[0].split('\n').length, 2, 'one physical line and its terminator');
});

// Sampling in afterEach or synchronously at end misses failures finalized during postRun.
test('a trace finishes top-level tests with the final outcome after teardown and nested results', async () => {
  const seen = world();
  const outer = { name: 'outer', fullName: 'outer', passed: false, error: null };
  const inner = { name: 'inner', fullName: 'outer > inner', passed: false, error: null };
  seen.start(outer);
  seen.start(inner);
  inner.error = { failureType: 'testCodeFailure' };
  seen.end('inner', 1);
  outer.passed = true;
  seen.end('outer');
  outer.passed = false;
  outer.error = { failureType: 'subtestsFailed' };
  await Promise.resolve();

  assert.deepEqual(seen.rows('FINISH'), [{ name: 'outer', time: STAMP, outcome: 'failed' }]);
});

// An exit callback must report cancellation separately and must never rewrite the process result.
test('the exit trace reports code duration and completed counts without changing process state or hooks', async (t) => {
  // Node also counts a cancellation that never supplied a beforeEach context.
  const totals = { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0, topLevel: 0, suites: 0 };
  const seen = world({ readTotals: () => totals });
  const processCode = process.exitCode;
  t.after(() => { process.exitCode = processCode; });
  let code = 17;
  const writes = [], exits = [];
  Object.defineProperty(seen.runtime, 'exitCode', { get: () => code, set: (value) => { writes.push(value); code = value; } });
  seen.runtime.exit = (...args) => exits.push(['exit', ...args]);
  seen.runtime.reallyExit = (...args) => exits.push(['reallyExit', ...args]);
  const outer = { name: 'outer', fullName: 'outer', passed: false, error: null };
  const inner = { name: 'inner', fullName: 'outer > inner', passed: false, error: null };
  seen.start(outer);
  seen.start(inner);
  inner.passed = true;
  seen.end('inner', 1);
  await Promise.resolve();
  outer.passed = true;
  seen.end('outer');
  await Promise.resolve();
  for (const [name, nesting, passed, error] of [
    ['failure', 0, false, { failureType: 'testCodeFailure' }],
    ['cancelled', 0, false, { failureType: 'testTimeoutFailure' }],
  ]) {
    const context = { name, fullName: nesting ? 'outer > inner' : name, passed: false, error: null };
    seen.start(context);
    context.passed = passed;
    context.error = error;
    seen.end(name, nesting);
    await Promise.resolve();
  }
  assert.deepEqual(seen.runtime.eventNames(), ['exit'], 'only one exit hook is admitted');
  assert.equal(seen.runtime.listenerCount('exit'), 1);
  seen.runtime.uptime = () => 71.25;
  // An explicit process exit can bypass the global after hook.
  Object.assign(totals, { tests: 5, passed: 2, failed: 1, cancelled: 2, topLevel: 4 });
  seen.runtime.emit('exit', 17);
  t.diagnostic(JSON.stringify({ exitCode: code, assignments: writes, exitCalls: exits,
    processExitCode: process.exitCode ?? null, originalProcessExitCode: processCode ?? null }));
  assert.equal(process.exitCode, processCode, 'the trace changed the actual process exitCode');
  assert.equal(code, 17, 'the trace changed the process exitCode');
  assert.deepEqual(writes, [], 'the trace assigned exitCode');
  assert.deepEqual(exits, [], 'the trace called a process exit method');
  assert.deepEqual(seen.rows('EXIT'), [{ name: 'test/subject.mjs', time: STAMP,
    exitCode: 17, duration: 71.25, passed: 2, failed: 1, cancelled: 2 }]);
  assert.deepEqual(seen.rows('FINISH').map(({ name, outcome }) => [name, outcome]), [
    ['outer', 'passed'], ['failure', 'failed'], ['cancelled', 'cancelled'],
  ]);
});

// A broken diagnostic pipe must not turn a passing test or process into a failure.
test('an unavailable diagnostic writer does not throw from test progress or the exit listener', () => {
  const seen = world({ write: () => { throw new Error('diagnostic pipe closed'); } });
  assert.doesNotThrow(() => seen.start({ name: 'passing', fullName: 'passing', passed: false, error: null }));
  assert.doesNotThrow(() => seen.finishProcess(0));
});
