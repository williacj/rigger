<!-- ABOUTME: Records why the stand-in's marker wait missed a write on macOS, and the FIFO handshake that replaced its watch (#622). -->

# A macOS directory watch is not ready when `fs.watch` returns

The stand-in's `await` act used `written` (`test/stub-claude.mjs`). It set an `fs.watch` on the marker's directory and then read once whether the marker was there. On macOS, libuv v1.53.0 (`src/unix/kqueue.c`, `uv_fs_event_start`) hands a directory to `uv__fsevents_init`. That function only queues a signal to the CoreFoundation thread (`src/unix/fsevents.c`, `uv__cf_loop_signal`) and returns. The thread creates the FSEvents stream later, with `kFSEventStreamEventIdSinceNow` and 0.05 s latency (`uv__fsevents_create_stream`). So `watch()` returning does not mean the watch is ready. A write that lands after the one read and before the stream starts produces no callback, ever.

Two measurements bound the window, both of them on the new host, macOS 26.6.2, Node v26.12.0.

- **Writes before `watch()` returns go unreported.** Source: instrumented attempt B-1 of `test/judge-dispatch.test.mjs` alone, at `21344c5`, on 2026-10-16, indexed with its trace in PR #798's first evidence comment. The reviewer wrote its own marker 1.89 ms before its `watch()` returned (0.436 ms against 2.326 ms in the trace). It got no callback for that write, though its watch later reported other files.
- **Writes just after `watch()` returns are reported.** Source: the measurement script `readiness.mjs`, run in 20 fresh processes on 2026-10-16 at one-minute load 7.39 to 8.17. A file written 13.8 to 33.6 µs after `watch()` returned produced a callback in all 20.

So the window that loses a write is small, and a hang needs the other role's write to land inside it. That fits the historical rate. #574's maker measured 1 hang in 20, 71 and 18 runs at `fe26fd7` on another host, as card #622's "Why" records.

The wait no longer watches. Before its read, it makes and opens a FIFO beside the marker (`<marker>.awaited`). The `write` act, once its marker is written, opens that FIFO without blocking and writes `w`. If the writer finds no FIFO, or none open, the waiter has yet to read and will see the file. Otherwise the writer's word reaches it. A forcing that blocks the writer until the waiter's first read has failed, and silences every watch, fails `judge-dispatch`'s two `await` tests at the base and passes them at the head. The pull request for #622 gives the counts.

The first judge of PR #798 found a cleanup gap. If the stand-in's directory is made read-only while the wait is pending, the FIFO cannot be removed. The wait then failed although it had been told of the file. Removing the FIFO is now best effort: the wait settles as it would have, the FIFO stays behind closed, and the run says so on its standard error.

What the FIFO cannot do: a waiter ended by `SIGKILL` leaves its FIFO behind until the stand-in's directory is removed. A failure to publish reaches the writer, not a waiter that has already read the file or one still pending.
