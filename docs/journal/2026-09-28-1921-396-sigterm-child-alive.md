ABOUTME: Journal for #396 (M2-07f): why a verb's SIGTERM test sometimes saw the forge stand-in's
child alive, and the fix, which installs L0's exit cleanup before the spawn rather than after it.

# #396 — L0 installs its exit cleanup before it creates a group

## What was wrong

- The product was wrong, not the test. `runCommand` in `src/substrate/process.mjs` spawned the
  command's group first and installed the exit cleanup's signal listeners a few statements later.
- A `SIGTERM` that landed in between found no listener. So it ended the verb by the signal's
  default action at once, and nothing killed or recorded the new group. The stand-in's child ran
  on, which breaks `R-STATE-9` and `R-STATE-12`.
- A loaded host opens that window. The verb only has to be descheduled between the spawn's return
  and the install until the stand-in marks `ready`. That came 28 to 211 ms after the install
  (measured below), and the test sends the signal as soon as it sees `ready`.

## Evidence

- **Instrumented run.** The clone's L0 wrote a marker as it installed the cleanup. The failing
  test printed that marker and `ps` for the child and the stand-in.
  - Where: a fresh clone of `main` at `f9cd71f`, macOS 27.0, Node 26.5.0, the whole `npm test`.
  - Load: averages of 81 to 107 on 12 cores, most of it from other sessions on the host.
  - Result: 1 failure, on `once`, over 2 whole runs and a third stopped part-way once the
    failure was in hand. The marker was absent. The child `tail` was running
    (state `S`, not killed and not stopped by a census). Its parent, the stand-in's shell, was
    alive with parent pid 1. The stream held no `L0` event, and the verb had written nothing.
  - In the 14 instances over those runs that passed, the stand-in marked `ready` 28 to 211 ms after the install.
- **Forced reproduction.** A preload on the verb's Node wraps `node:child_process`'s `spawn`. On
  the spawn of `gh` it waits until the stand-in is ready, then sends the process `SIGTERM` before
  handing the child back. At the base all five verbs fail as in the coordinator's run: "child N is
  alive" after the 10 s wait, with the verb ended by `SIGTERM`. At the head all five pass.

## What we learned

- **A signal listener has to exist before the thing it cleans up.** Node gives a signal with no
  listener its default action in the kernel, before any JavaScript runs. So no code after the
  spawn can close the window. Installing before the spawn does, and a signal then waits for the
  event loop, by which time the call is in `calls`.
- **The failure needed the whole suite's load.** 20 runs of the test file alone passed, and so did
  45 more across three concurrent loops, at loads of 57 to 109. The whole suite, with its files
  running side by side, reproduced it. The full-suite run also timed out once in
  `test/exit-cleanup.test.mjs:872`, which is outside this card.
