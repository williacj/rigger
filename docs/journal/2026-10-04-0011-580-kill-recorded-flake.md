ABOUTME: Journal for #580 (M4-F25): why `test/kill-recorded.test.mjs`'s leaderless-read test failed
once at a load of 16.91, the forcing that shows it, and the stand-in that no longer waits on `ps`.

# #580 — a start-time read that timed out instead of answering short

**Why.** The test at `:542` (at `51c46c9`; `:544` at `e9a5eca`, the base this branch now merges) failed once, in #576's
pre-commit suite, at a one-minute load of 16.91. Its `ps` stand-in ran the real `/bin/ps` through
`grep` inside the call's 300 ms read bound. The full output was lost.

**Which assertion.** Every failure names the entry, and nothing is killed when `startsIn` throws,
so of the test's assertions only `:554`'s (`:556` at `e9a5eca`) `assert.match` on "left out its leader" depends on how
the reads go. The run took 1,248.86 ms, far inside the test's 20 s bound, so the bound did not
end it. In my judgment, then, `:554` is the assertion that failed. The output that would confirm it
was lost, and no unforced run here made the failure recur.

**Cause, from the code.** `startsIn` reads the group's start times until the deadline. A read that
answers short records why (`short`), and the failure then names it. A read still running at the
deadline, before any read has answered, fails with only "the process-table read timed out after
300 ms". The first read went through the real `ps`, whose time grows with the host's process table
and load, so under load it can outlast 300 ms before answering. The `ANSWERED_SHORT` case "leaves
out its live leader" (`:570`; `:572` at `e9a5eca`) has the same stand-in under the same bound, so the same cause reaches
it.

**Forcing.** Every real `ps` the two tests reach runs through a stand-in, `real-ps`. It passes
through to `/bin/ps` until the test marks that the call has started, and from then on holds every
read on `tail -f` of a file nothing writes to. It uses no load, no sleep and no timer, and raises no
bound. At the base both tests fail at their message match, with "timed out after 300 ms". At the
head they pass, because the call's reads never reach the real `ps`. The runs, on macOS on this
host, are in the pull request.

**Fix.** The head reads the group's table once, before the call, with no bound on it, and writes it
less the leader's row. The stand-in prints that file with shell builtins alone. So the read the
call makes answers short however loaded the host is, and the test still proves the same thing: a
read that leaves out a live leader is not taken as the group's.

**A second way to the same assertion, found in passing.** An earlier head of this branch was forced
on macOS CI before this host ran it. One of those runs failed: run 5 of the `:542` test, in the
`pull_request` run of `7318f33`, with "listed no process of the group while signal 0 still reached
it". There the stand-in printed a table of at least one row from a file. In my judgment the cause
is in L0's `run`, not in the test. When `execFile`'s timeout fires it destroys the child's output
streams and kills it. Its exit handler still reports success where the child exited 0, with
whatever output was read by then (Node v26.5.0's `lib/child_process.js`, `exithandler` and `kill`,
read on 2026-10-03). So a read cut at the deadline can come back as an empty or partial table,
taken as complete. It can reach `:554` at the base as at the head, so it cannot be ruled out for
#576's failure either. It lies in `src/substrate/process.mjs`, not in the lines this card changes,
and is reported for a card of its own.

**What the cloud host could not show.** The first maker ran in a Linux container whose `ps`
(procps-ng 4.0.4) selects `-g` by session or group name, not by process group, so every run there
failed for that reason alone. Those runs are history. The evidence is the macOS runs at the final
head.
