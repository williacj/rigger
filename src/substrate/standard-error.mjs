// ABOUTME: A write to standard error that returns only once all of it is written, or once its
// reader has left it undrained too long, for the writes L5's sink and L0's exit cleanup make as the
// process exits.

import { writeSync } from 'node:fs';

/**
 * How long a write to standard error waits on a reader that takes nothing before it gives up, and
 * drops what it has not written. A judgment, not a measurement. Its premise is a measurement: over
 * 20 writes of 2,000,000 bytes, each by a loop that tried a full pipe again at once, to a reader
 * draining the pipe (`spawnSync`'s), the longest the reader left the pipe full was 1.04 ms, with
 * Node 26.5.0 on macOS 27.0 on 2026-09-28, at a load average of about 42. One second is nearly a
 * thousand times that, room for a loaded host, and costs a process whose reader never drains one
 * second before it ends.
 */
export const UNDRAINED_BOUND = 1_000;

/**
 * How long a write pauses before it tries a full pipe again, so a wait on the reader uses next to
 * no processor time. A judgment, not a measurement.
 */
const PAUSE = 10;

/**
 * How much of `UNDRAINED_BOUND` a write keeps in hand for a host that ends a pause late, and for
 * what its caller does next. A judgment, not a measurement. Its premise is a measurement: in CI's
 * Node 20 job on 2026-09-28 (run 36478413721), a write that kept one pause in hand, 10 ms, still
 * returned 30.7 ms past the bound. A tenth of the bound is three times that overrun.
 */
const SPARE = UNDRAINED_BOUND / 10;

/** What a write pauses on: a cell nothing ever wakes, so each wait lasts its whole timeout. */
const idle = new Int32Array(new SharedArrayBuffer(4));

/**
 * Whether a write has given up on the reader. Every later write then gives up at the first full
 * pipe, so the process as a whole waits on that reader for no longer than `UNDRAINED_BOUND`. A
 * reader that drains again later still takes, at each write, what the pipe has room for.
 */
let abandoned = false;

/**
 * Write all of `text` to standard error before returning, even as the process exits, or as much
 * of it as a reader that stops draining the pipe takes within `UNDRAINED_BOUND` of the write's
 * start. What it could not write is dropped: standard error is the last place left to report to.
 *
 * A verb that has printed has left the descriptor non-blocking, and a write to a full pipe then
 * comes back short or refused with EAGAIN. `process.stderr.write` queues the rest, which an exit
 * drops. Measured on macOS 27.0 with Node 20.20.2, 24.21.0 and 26.5.0, one `writeSync` of
 * 200,000 bytes after `process.stderr` was touched delivered 8,192 bytes on Node 20 and 65,536
 * on 24 and 26. A loop that wrote again until every byte was taken delivered 2,000,000 bytes whole
 * on all three, from an `exit` listener and from a re-raised `SIGTERM`. `test/event-sink.test.mjs`
 * and `test/exit-cleanup.test.mjs` each write past 65,536 bytes at exit.
 *
 * There is nothing to wait on at exit, so a full pipe is waited on synchronously, a `PAUSE` at a
 * time. A pause is begun only where it would end `SPARE` before the bound, so the write returns
 * within the bound even where the host ends its last pause late by up to that.
 */
export function writeWhole(text) {
  let rest = Buffer.from(text);
  const deadline = performance.now() + UNDRAINED_BOUND;
  while (rest.length > 0) {
    try {
      rest = rest.subarray(writeSync(2, rest));
    } catch (error) {
      if (error.code !== 'EAGAIN') throw error;
      if (abandoned || performance.now() + PAUSE + SPARE > deadline) {
        abandoned = true;
        return;
      }
      Atomics.wait(idle, 0, 0, PAUSE);
    }
  }
}
