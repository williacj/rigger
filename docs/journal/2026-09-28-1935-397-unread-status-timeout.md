ABOUTME: Journal for #397 (M2-06c): why the exit cleanup's unanswered-status-read test sometimes
timed out, and the fix to the test that caused it.

# #397 — The unanswered-status-read test waited for a command L0 had already ended

## What was found

- **The test was wrong, not the product.** The test handed L0 a read bound of 300 ms. L0 applies
  a call's bound to every read the call makes, and the read of the leader's start time is one of
  them. On a loaded host that read took longer than 300 ms. L0 then ended the dispatch's group
  before the command was up, as its contract says it must.
- **The harness then waited for ever.** The caller waited for `child.1` without watching its own
  call. The call had already rejected, so the child never came up, the caller never said `ready`,
  and the test never sent `SIGTERM`. The test's own 30 s bound was the first thing to end it.
- **The evidence** is an instrumented clone of `f9d57f7`, running the whole `npm test` on macOS
  27.0 with Node 26.5.0 at load averages of 45 to 108. It failed once in four runs. At 20 s, the
  watchdog read the following:
  - The caller was alive and had printed nothing.
  - Only command 2's group was left.
  - L0's trace held one line: `startOf 49608 took=303 error=ETIMEDOUT`.
  - The caller's stack was in `existsSync`, in the wait for `child.1`.
- **#402's cause is ruled out for this failure.** #402 is the window before `install()`, where a
  `SIGTERM` takes the default action. That needs a `SIGTERM`, and none was sent here: the test
  sends one only after `ready`. A caller the default action had ended would also have been gone,
  where this one was still running at 20 s.

## What was built

- The caller stops waiting for a command whose call has settled, and throws, saying why. The test
  then fails in under a second, naming the cause, rather than at its 30 s bound.
- The four status-read tests run under L0's own `READ_TIMEOUT`. The stand-ins hold the status
  read of the first command's group only, so each test waits out one bound rather than two.
- A new test forces the cause. Its stand-in never answers the start-time read, and its command
  never comes up.
  - At base it times out at 30 s, as the coordinator's run did.
  - At head it passes, with no edit to the test.

## What we learned

- **A test's bound is not the bound on one read.** `readTimeout` is L0's bound on every read a
  call makes. A test that shortens it for the one read it means to fail shortens every other read
  too.
- **Wait on the call as well as the effect.** A harness that waits for an effect of a call has to
  stop when the call settles, or a rejection it never reads turns into a hang.
