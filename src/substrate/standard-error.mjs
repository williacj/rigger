// ABOUTME: A write to standard error that returns only once all of it is written, or once its
// reader has left it undrained too long, for the writes L5's sink and L0's exit cleanup make as the
// process exits.

import { writeSync } from 'node:fs';

/**
 * The longest a write to standard error waits on a reader that takes nothing, before it gives up
 * and drops what it has not written. It gives up sooner, once the reader has taken nothing for this
 * less `SPARE` and a `PAUSE`, 899 ms, so that it has returned by this even where a pause ends late.
 * A judgment, not a measurement. Its premise is a measurement: over 20 writes of 2,000,000 bytes,
 * each by a loop that tried a full pipe again at once, to a reader draining the pipe
 * (`spawnSync`'s), the longest the reader left the pipe full was 1.04 ms, with Node 26.5.0 on macOS
 * 27.0 on 2026-09-28, at a load average of about 42. Nine tenths of a second is over 800 times
 * that, room for a loaded host, and a process whose reader never drains ends within one second.
 */
export const UNDRAINED_BOUND = 1_000;

/**
 * How long a write pauses before it tries a full pipe again, so a wait on the reader uses next to
 * no processor time. A judgment, not a measurement. A pause ends late: over five writes of
 * 2,000,000 bytes to `spawnSync`'s reader with Node 20.20.2 on macOS 27.0 on 2026-09-28, each 1 ms
 * pause took 2.3 ms on average, and a write met the full pipe up to 186 times. So a draining
 * reader is kept waiting some milliseconds a write, and never charged the bound.
 */
const PAUSE = 1;

/**
 * How much of `UNDRAINED_BOUND` a write keeps in hand for a host that ends a pause late, and for
 * what its caller does next. A judgment, not a measurement. Its premise is a measurement: in CI's
 * Node 20 job on 2026-09-28 (run 36478413721), a write that paused 10 ms at a time and kept one
 * pause in hand still returned 30.7 ms past the bound. A tenth of the bound is three times that
 * overrun.
 */
const SPARE = UNDRAINED_BOUND / 10;

/** What a write pauses on: a cell nothing ever wakes, so each wait lasts its whole timeout. */
const idle = new Int32Array(new SharedArrayBuffer(4));

/**
 * Whether the last write gave up on the reader. A write then gives up at the first full pipe, so a
 * reader that never drains holds the process once, however many writes it makes. A write the
 * reader takes bytes of clears it, so a reader that drains again is waited on again. That is seen
 * only where the pipe has room when a write starts: a reader that has begun draining, and has not
 * yet made room, loses that write.
 */
let abandoned = false;

/**
 * Write all of `text` to standard error before returning, even as the process exits, or until its
 * reader has taken nothing for most of `UNDRAINED_BOUND`. What it could not write is dropped:
 * standard error is the last place left to report to.
 *
 * A standard error Node has not opened is the descriptor the process inherited, and on a pipe that
 * is blocking: a write to a full pipe waits in the kernel for as long as the reader does, and no
 * bound here reaches it. Opening `process.stderr` leaves a pipe non-blocking, so the write first
 * opens it. Measured with Node 20.20.2 and 26.5.0 on macOS 27.0 on 2026-09-28, standard error a
 * FIFO nothing read: a `writeSync` of 200,000 bytes with `process.stderr` untouched was still
 * blocked after 3 s, and with it opened, each was refused with EAGAIN once the pipe was full.
 * Reopening `/dev/fd/2` non-blocking does not do it: it shares the inherited, blocking file.
 *
 * A write to a full non-blocking pipe comes back short or refused with EAGAIN.
 * `process.stderr.write` queues the rest, which an exit drops. Measured on macOS 27.0 with Node
 * 20.20.2, 24.21.0 and 26.5.0, one `writeSync` of 200,000 bytes after `process.stderr` was touched
 * delivered 8,192 bytes on Node 20 and 65,536 on 24 and 26. A loop that wrote again until every
 * byte was taken delivered 2,000,000 bytes whole on all three, from an `exit` listener and from a
 * re-raised `SIGTERM`. `test/event-sink.test.mjs` and `test/exit-cleanup.test.mjs` each write
 * past 65,536 bytes at exit.
 *
 * There is nothing to wait on at exit, so a full pipe is waited on synchronously, a `PAUSE` at a
 * time. The wait runs from the last time the reader took anything, so a slow reader that keeps
 * draining gets every byte. A pause is begun only where it would end `SPARE` before the bound, so
 * the write gives up within the bound even where the host ends its last pause late by up to that.
 */
export function writeWhole(text) {
  // Opened for what it leaves the descriptor, not to write through.
  void process.stderr;
  let rest = Buffer.from(text);
  let deadline = performance.now() + UNDRAINED_BOUND;
  while (rest.length > 0) {
    try {
      rest = rest.subarray(writeSync(2, rest));
      abandoned = false;
      deadline = performance.now() + UNDRAINED_BOUND;
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
