// ABOUTME: Emits test progress and process completion records for flake diagnosis.

import { beforeEach as registerBeforeEach } from 'node:test';
import { writeSync } from 'node:fs';
import { tracingChannel } from 'node:diagnostics_channel';

export function traceFile(file, { beforeEach = registerBeforeEach, completed = tracingChannel('node.test').end, runtime = process,
  now = () => new Date().toISOString(), write = (line) => writeSync(1, line) } = {}) {
  const pending = new Map();
  const counts = { passed: 0, failed: 0, cancelled: 0 };
  const cancelled = new Set(['testAborted', 'cancelledByParent', 'testTimeoutFailure']);
  const record = (kind, fields) => {
    const line = 'RIGGER_TEST_' + kind + ' ' + JSON.stringify({ ...fields, time: now() }) + '\n';
    // A closed diagnostic pipe must not change the test or process outcome.
    try { write(line); } catch {}
  };
  beforeEach((context) => {
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
      counts[outcome] += 1;
      if (nesting === 0) {
        record('FINISH', { name, outcome });
      }
    });
  });
  runtime.once('exit', (exitCode) => {
    record('EXIT', { name: file, exitCode, duration: runtime.uptime(), ...counts });
  });
}
