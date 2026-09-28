ABOUTME: Records card #338, which has L0's process adapter end a command at its timeout and reject a
command that never started with a failure its caller tells apart by code.

# 2026-09-27 — The adapter ends a command at its timeout, and reports one that never started

**The timeout reuses the containment the exit already had.** At the timeout the adapter runs the
same census, kill and confirmation it runs once a command exits. The group is stopped and read
while the command is still in it, so the command itself is named alongside its children. Each kill
is recorded as `timeout.killed` rather than `survivor.killed`, because the command is not a survivor
of itself. Once the command's exit arrives, the usual containment after the exit finds the group
empty and records nothing more.

**The kill is `SIGKILL`, with no `SIGTERM` first.** No ruling asks for a grace period, and H2 has a
command L0 ended at its timeout carry a non-zero exit code, whatever it then exited with. A command
that traps `SIGTERM` and exits 0 is the case that reading guards. A guarded mutation that sent
`SIGTERM` to the group at the timeout redded that test on an exit code of 0. With `SIGKILL`, the
exit code is 137.

**A signalled command's exit code is 128 plus the signal's number.** Node reports such an exit as
`code: null`. L2 reads the exit code alone (the owner's #220 ruling), so `null` is not a value it
can read. 128 plus the signal's number is what a shell reports, and it is never 0.

**`timedOut` is true only where the kill ended the command.** Between the timer firing and the
census stopping the group, the command can exit on its own. It then has its own exit code, which
can be 0, and reporting it as timed out would pair "the timeout ended it" with success. So the
result says the timeout ended it only where the exit shows a signal. The engineer judge on #364
forced that race by blocking Node's loop past the timer. The test does the same on a condition:
it holds the thread until the command is a zombie Node has not reaped. When the loop resumes, Node
runs the due timer before it reaps the command. Because that wait holds the thread, no test
timeout can end it, and the suite runs with `--test-timeout=0`. So the wait carries a deadline of
its own. The engineer judge's mutation, which rejects before the command runs when `timeout` is
1, then reds the test after 5 seconds rather than hanging the suite.

**A timeout longer than one of Node's timers is kept over a chain of them.** Past 2^31−1 ms,
Node warns with a `TimeoutOverflowWarning` and sets the delay to 1 ms. So a command given such a
timeout was ended almost at once and reported as timed out, although it would have finished in its
time (Codex on #364, round 3). Round 4 refused such a timeout, and Codex ruled that a command
which would finish inside it then gets no result (round 4). So `whenElapsed` now keeps any positive
finite delay by re-arming a timer of at most `TIMER_MAX` until the whole delay has passed. The
adapter still refuses 0, negative numbers, `NaN`, `Infinity` and anything that is not a number.

**The chain is tested with timers that run only when told.** A test hands `whenElapsed` a scheduler
that fires one armed timer at a time. So a delay of twice `TIMER_MAX` plus 5 ms is seen to elapse
over timers of `TIMER_MAX`, `TIMER_MAX` and 5 ms, with nothing slept. Node exports no name for the
maximum, so `TIMER_MAX` is a copy. A test asks a Node process of its own whether its timer warns at
`TIMER_MAX` and at one past it (`D16` rule 2).

**A cancel that does nothing holds the test file open.** A guarded mutation that made the
cancel a no-op redded the cancel test, and the file never exited: the test running a command at
`TIMER_MAX` left a 24-day timer armed. So a regression there shows as a hung file as well as a red
test.

**The check refuses every `cwd` the spawn reads as unset.** Node's spawn runs the command in the
caller's own directory for `undefined`, `null`, `''` and an empty `Buffer`, and the check refuses
all four. The judges on #364 found these one value at a time, first `undefined` and then `null`.
So the note now states the class, with every value measured, including those for which the two
agree.

**Node reports a spawn failure two ways.** Measured with Node 26.5.0 on macOS 27.0, a `cwd` that is
a file, a link loop and an executable of garbage bytes each throw synchronously (`ENOTDIR`,
`ELOOP`, `ENOEXEC`). A missing command, a missing `cwd`, a command that is not executable and an
unenterable `cwd` each fail after the spawn returns, as an `error` event (`ENOENT`, `EACCES`), and
the child Node returned has no pid. The adapter catches the throw, and reads a child with no pid
as the second kind and awaits its error. So both kinds become one `NOT_STARTED` failure naming the
command.

**The spawn stays synchronous because of #339.** A first cut awaited Node's `spawn` event before
going on. #339 (M2-05a) merged meanwhile, and it hands L1 the group through `onGroup` before the
call first yields, so that nothing but one synchronous step falls between the spawn and L1's
entry. An await there would have widened that window. The spawn therefore returns its child
synchronously, and only a child with no pid is awaited, because it has no group to hand over.
#339's `dispatch` called the adapter with no timeout, which the adapter now refuses. So it takes a
`timeout` and passes it through, and its tests pass one of their own.

**Node names the command, not the directory, for a missing `cwd`.** Ruling 1 P3 recalled this; the
first test measured it (`spawn <command> ENOENT`). So the adapter asks the file system before the
spawn (`D16` rule 1), and the note beside that check records where the two answers differ (rule 3).
An empty-string `cwd` is one such case. The check refuses it, while Node's spawn runs the command in
the caller's own directory.

**The repository's spawn sweep reads the call's tokens.** A first cut passed `spawn` its options as
one variable. `test/git-environment.test.mjs` then failed the commit, because a spawn of a command
decided at run time must name `env` in its own call. So the `spawn` call stays inline in
`runCommand`, and `started` receives it as a thunk.

**Exec'ing a freshly written script is slow on this host.** The fixture whose child writes to both
streams took 51 to 1,481 ms to become ready over 40 calls, all of it before the child's first line.
The same child, run as `/bin/sh "$here/child"`, was ready in 10.8 to 13.8 ms. The timeout tests
pass 1,000 ms and fail with a message naming the timeout wherever the fixture was not ready. So that
difference decided whether they were sound or flaky, and the fixture runs its child's script under
`/bin/sh` by name.
