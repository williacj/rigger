// ABOUTME: A write to standard error that returns only once all of it is written, for the writes
// L5's sink and L0's exit cleanup make as the process exits.

import { writeSync } from 'node:fs';

/**
 * Write all of `text` to standard error before returning, even as the process exits.
 *
 * A verb that has printed has left the descriptor non-blocking, and a write to a full pipe then
 * comes back short or refused with EAGAIN. `process.stderr.write` queues the rest, which an exit
 * drops. Measured on macOS 27.0 with Node 20.20.2, 24.21.0 and 26.5.0, one `writeSync` of
 * 200,000 bytes after `process.stderr` was touched delivered 8,192 bytes on Node 20 and 65,536
 * on 24 and 26. This loop delivered 2,000,000 bytes whole on all three, from an `exit` listener
 * and from a re-raised `SIGTERM`. `test/event-sink.test.mjs` and `test/exit-cleanup.test.mjs`
 * each write past 65,536 bytes at exit.
 */
export function writeWhole(text) {
  let rest = Buffer.from(text);
  while (rest.length > 0) {
    try {
      rest = rest.subarray(writeSync(2, rest));
    } catch (error) {
      // The reader has not drained the pipe yet, and there is nothing to wait on at exit. A reader
      // that never drains it holds the process here.
      if (error.code !== 'EAGAIN') throw error;
    }
  }
}
