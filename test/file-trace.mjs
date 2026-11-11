// ABOUTME: Emits test progress and process completion records for flake diagnosis.

import { beforeEach as registerBeforeEach, after as registerAfter } from 'node:test';
import { executionAsyncResource } from 'node:async_hooks';
import { writeSync } from 'node:fs';
import { tracingChannel } from 'node:diagnostics_channel';

// Node v26.13.0's TestHook carries its parent's harness (internal/test_runner/test.js).
// Keep the live counters: Node also finalizes tests that never enter a beforeEach hook.
function nodeTotals() {
  return executionAsyncResource().harness.counters;
}

export function traceFile(file, { beforeEach = registerBeforeEach, after = registerAfter, readTotals = nodeTotals,
  completed = tracingChannel('node.test').end, runtime = process,
  now = () => new Date().toISOString(), write = (line) => writeSync(1, line) } = {}) {
  const pending = new Map();
  let totals = { passed: 0, failed: 0, cancelled: 0 };
  after(() => { totals = readTotals(); });
  const cancelled = new Set(['testAborted', 'cancelledByParent', 'testTimeoutFailure']);
  const record = (kind, fields) => {
    const line = 'RIGGER_TEST_' + kind + ' ' + JSON.stringify({ ...fields, time: now() }) + '\n';
    // A closed diagnostic pipe must not change the test or process outcome.
    try { write(line); } catch {}
  };
  beforeEach((context) => {
    totals = readTotals();
    const sameName = pending.get(context.name) ?? [];
    sameName.push(context);
    pending.set(context.name, sameName);
    if (context.fullName === context.name) {
      record('START', { name: context.name, uptime: runtime.uptime() });
    }
  });
  completed.subscribe(({ name, nesting, type }) => {
    if (type !== 'test') return;
    const sameName = pending.get(name);
    const context = sameName?.pop();
    if (!context) return;
    if (sameName.length === 0) pending.delete(name);
    // Node publishes end after teardown, then finalizes nested failures in postRun.
    queueMicrotask(() => {
      const outcome = context.passed ? 'passed' : cancelled.has(context.error?.failureType) ? 'cancelled' : 'failed';
      if (nesting === 0) {
        record('FINISH', { name, outcome });
      }
    });
  });
  runtime.once('exit', (exitCode) => {
    const { passed, failed, cancelled } = totals;
    record('EXIT', { name: file, exitCode, duration: runtime.uptime(), passed, failed, cancelled });
  });
}
