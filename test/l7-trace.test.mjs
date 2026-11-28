// ABOUTME: Checks the diagnostic record's release interval, start load and single emission.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { l7Trace } from './l7-trace.mjs';

test('L7 trace excludes setup and teardown and records the start load once', (t) => {
  let time = 10;
  let load = 3.5;
  const written = [];
  // Controlled millisecond readings: https://nodejs.org/api/perf_hooks.html#performancenow
  t.mock.method(performance, 'now', () => time);
  // Node returns [1, 5, 15]-minute averages: https://nodejs.org/api/os.html#osloadavg
  t.mock.method(os, 'loadavg', () => [load, 0, 0]);
  // An unbuffered capture stays below highWaterMark: https://nodejs.org/api/stream.html#buffering
  t.mock.method(process.stderr, 'write', (text) => { written.push(text); return true; });
  l7Trace.start();
  time = 100;
  load = 20;
  l7Trace.released();
  time = 137.5;
  l7Trace.ended();
  time = 900;
  l7Trace.ended();
  assert.equal(written.length, 1);
  assert.match(written[0], /^L7 trace: /);
  assert.deepEqual(JSON.parse(written[0].slice('L7 trace: '.length)), { releaseToPullMs: 37.5, load1: 3.5 });
});
