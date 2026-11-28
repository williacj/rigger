// ABOUTME: Reports the L7 test's release interval and load at test start once per run.
import os from 'node:os';
import { after } from 'node:test';

let load1;
let released;
let reported;

export const l7Trace = {
  start() {
    load1 = os.loadavg()[0];
    released = undefined;
    reported = false;
    after(() => l7Trace.ended());
  },
  released() {
    released = performance.now();
  },
  ended() {
    if (reported) return;
    reported = true;
    const releaseToPullMs = released === undefined ? null : performance.now() - released;
    process.stderr.write(`L7 trace: ${JSON.stringify({ releaseToPullMs, load1 })}\n`);
  },
};
