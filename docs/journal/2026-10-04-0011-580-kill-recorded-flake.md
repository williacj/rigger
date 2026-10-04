ABOUTME: Journal for #580 (M4-F25): why `test/kill-recorded.test.mjs`'s leaderless-read test failed
once at a load of 16.91, the forcing that shows it, and the stand-in that no longer waits on `ps`.

# #580 — a start-time read that timed out instead of answering short

**Why.** The test at `:542` (at `51c46c9`) failed once, in #576's pre-commit suite, at a one-minute
load of 16.91. Its `ps` stand-in ran the real `/bin/ps` through `grep` inside the call's 300 ms read
bound. The full output was lost.

**Cause, from the code.** `startsIn` reads the group's start times until the deadline. A read that
answers short records why (`short`), and the failure then names it. A read still running at the
deadline, before any read has answered, fails with only "the process-table read timed out after
300 ms". Every failure names the entry, and nothing is killed when `startsIn` throws, so of the
test's assertions only `:554`'s `assert.match` on "left out its leader" depends on how fast the
read answers. The run took 1,248.86 ms, far inside the test's 20 s bound. So, in my judgment, the
assertion that failed is `:554`'s, and the cause is that the first read through the real `ps` took
longer than 300 ms under that load. The output that would confirm it was lost, and no run here
made the failure recur unforced. The `ANSWERED_SHORT` case "leaves out its live leader" (`:570`) has the same
stand-in under the same bound, so the same cause reaches it.

**Forcing.** Every real `ps` the two tests reach runs through a stand-in, `real-ps`. It passes
through to `/bin/ps` until the test marks that the call has started, and from then on holds every
read on `tail -f` of a file nothing writes to. It uses no load, no sleep and no timer, and raises
no bound. At the base, both tests fail at their message match, with "timed out after 300 ms". At
the head they pass, because the call's reads never reach the real `ps`.

**Fix.** The head reads the group's table once, before the call, with no bound on it, and writes
it less the leader's row. The stand-in prints that file with shell builtins alone. So the read the
call makes answers short whatever the host's load, and the test still proves the same thing: a
read that leaves out a live leader is not taken as the group's.

**What this host could not show.** The cloud container's `ps` is procps-ng 4.0.4, whose `-g` selects
by "session or effective group name", by its `--help all` on 2026-10-04, not by process group. So both tests fail here at the base and at the head for that reason alone. The
forced-base runs here are still evidence, because the forcing changes the failure to the timeout
message. The forced-head runs and the mutations came from macOS CI on the pull request's branch.
