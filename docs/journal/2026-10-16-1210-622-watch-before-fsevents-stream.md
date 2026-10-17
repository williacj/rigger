<!-- ABOUTME: Records why the stand-in's marker wait missed a write on macOS, and the FIFO handshake that replaced its watch (#622). -->

# A macOS directory watch is not ready when `fs.watch` returns

The stand-in's `await` act used `written` (`test/stub-claude.mjs`). It set an `fs.watch` on the marker's directory and then read once whether the marker was there. On macOS, libuv v1.53.0 (`src/unix/kqueue.c`, `uv_fs_event_start`) hands a directory to `uv__fsevents_init`. That function only queues a signal to the CoreFoundation thread (`src/unix/fsevents.c`, `uv__cf_loop_signal`) and returns. The thread creates the FSEvents stream later, with `kFSEventStreamEventIdSinceNow` and 0.05 s latency (`uv__fsevents_create_stream`). So `watch()` returning does not mean the watch is ready. A write that lands after the one read and before the stream starts produces no callback, ever.

An instrumented base run at `21344c5` showed the gap from both sides. The reviewer's own marker, written 1.9 ms before its `watch()` returned, never produced a callback for it. A file written within 15 µs after `watch()` returned was reported in 20 of 20 fresh processes at load 7–8. The window is therefore small, and a hang needs the other role's write to land inside it. That fits the measured rate of about 1 in 20 to 100 runs.

The wait no longer watches. Before its read, it makes and opens a FIFO beside the marker (`<marker>.awaited`). The `write` act, once its marker is written, opens that FIFO without blocking and writes `w`. If the writer finds no FIFO, or none open, the waiter has yet to read and will see the file. Otherwise the writer's word reaches it. A forcing that blocks the writer until the waiter's first read has failed, and silences every watch, fails `judge-dispatch`'s two `await` tests at the base and passes them at the head. The pull request for #622 gives the counts.

What the FIFO cannot do: a waiter ended by `SIGKILL` leaves its FIFO behind until the stand-in's directory is removed. A failure to publish reaches the writer, not a waiter that has already read the file or one still pending.
