ABOUTME: Journal for #526: three suite failures came from other sessions filling the per-user
process limit; the two census tests now name the census's failed read rather than "proves nothing".

# #526 — a full process table, and two reached checks that blamed themselves

**The cause was outside the suite.** PR #522's fresh-clone run, started at a one-minute load of
23.81, failed `test/worktrees.test.mjs:377` and `test/retry.test.mjs:423` with `EAGAIN` from git's
spawn, and `test/process-adapter.test.mjs:1436` with "no read of the kill was cut". It ran from
about 08:16:42 to 08:19:30 on 2026-10-02. In that window #525's maker ran 12 copies of
`directory-census` and `process-adapter` at once (`c525-diag/logs/ld1–12.log` in the coordinator's
scratchpad, ending 08:19:00 to 08:19:05). One of those copies failed its own chain test with
`spawn /bin/ps EAGAIN` (`ld8.log`), and two failed `:1464`. Each copy's chain tests hold 251 and 201
processes, so 12 copies alone approach 3,000. The user's baseline ran 970 to 1,558 processes in my
samples that day, against a per-user limit of 4,000 (`kern.maxprocperuid`, `ulimit -u`).

**The suite alone is far from the limit.** A fresh-clone run at base `01c4ad0`, sampled at 5 Hz,
peaked at 236 processes descended from the run, and passed 1,720 of 1,720 at a starting load of
55.08.

**The census's read bound was not the cause at that load.** 8 copies of `process-adapter` at
once, started at a one-minute load of 37.42, made 15,176 `ps` reads that were not held on
purpose. Their p99.9 was 90 ms and their longest 164 ms, against these tests' `readTimeout` of
1,000 ms for a census of four or five reads.

**What a refused fork does to the two census tests.** A census read whose fork the host refuses
fails, and the census gives up and has the group killed unnamed. That is designed (O48, which O50
extends to a census whose read fails). The kill then makes no read at all, so the reached checks
at `:1436` and `:1464` found no cut read and said the test proved nothing. That was wrong about
which part failed. Forcing it at the base, a stand-in whose census branch runs `ulimit -u 1` before
it forks reproduces both messages.

**The change.** Each stand-in now also marks every read of the kill in `kill.read`. Where the kill
made no read, the reached check names the census as having given up, with the reason the stream
records on the group's kill. Where the kill did read but nothing was cut, it still says the test
proves nothing. `:377` and `:423` are unchanged (O50). Their failure messages already name the
refused spawn, and the fix for them is the coordinator's rule against parallel copies of the
process-heavy tests.

**What would reverse this.** A census that no longer gives up when a read fails, which is a change
to `contain`'s design and not to these tests.
